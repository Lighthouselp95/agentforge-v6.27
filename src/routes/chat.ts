import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { spawn } from 'child_process';
import { countRealTasks } from '../storage/agent-storage.js';

// Pha 1 refactor: toàn bộ HTTP handlers /api/history, /api/messages, /api/chat,
// /api/chat/force-send dời verbatim từ src/server.ts. Mount tại `/` của /api
// (giữ nguyên full path /api/history, /api/chat...). dispatchUserChat giữ lại
// trong server.ts (domain function) và inject qua deps.
export interface ChatRouteDeps {
  agents: Map<string, any>;
  storage: any;
  broadcast: (type: string, data: any) => void;
  clients: Map<string, any>;
  chatHistory: any[];
  backendUserQueues: Record<string, any[]>;
  userQueueManager: { enqueue: (msg: any) => void; getQueueLength: (targetId: string) => number; getQueue: (targetId: string) => any[]; clearQueue: (targetId: string) => void; processNext: (targetId: string) => void };
  findAgentByIdNameOrRole: (identifier: string, preferredTeamId?: string) => any;
  isOrchestratorLike: (agent: any) => boolean;
  getOrchClient: (orchId: string) => any;
  getClient: (agent: any) => any;
  normalizeQueueKey: (targetId?: string) => string;
  drainDispatchState: (agentId: string) => void;
  updateOrchStateSafe: (orchId: string, status: 'idle' | 'working' | 'error', taskDesc?: string) => void;
  isRetriableError: (err: any) => boolean;
  getEffectiveTaskLimit: (teamId?: string) => number;
  dispatchUserChat: (params: { targetAgentId: string; rawMsg: string; isSlashCommand: boolean; isRetry?: boolean; customTurnId?: string }) => Promise<{ response: string; sid: string | null; commands: string[] }>;
  processNextBackendUserQueue?: (rawTargetId: string) => void;
}

export function createChatRouter(deps: ChatRouteDeps): Router {
  const router = Router();

  // GET /api/history (hỗ trợ lọc theo teamId, agentId, limit, beforeId)
  router.get('/history', (req, res) => {
    // Pagination support: ?limit=N (mặc định 200, tối đa 1000) & ?beforeId=<msgId> (tin nhắn cũ hơn id này) & ?agentId=<id> & ?teamId=<id>
    const qLimit = req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : undefined;
    const qBeforeId = req.query.beforeId !== undefined ? String(req.query.beforeId) : undefined;
    const qAgentId = req.query.agentId !== undefined ? String(req.query.agentId) : undefined;
    const qTeamId = req.query.teamId !== undefined ? String(req.query.teamId) : undefined;
    // Phương án 1: khi client chỉ gửi agentId (không gửi teamId) → server tự resolve teamId từ agent
    // trong agents map để lọc history theo đúng team của agent đó → tách cross-team triệt để (worker
    // team cũ / tin team khác không lẫn), KHÔNG cần sửa App.tsx client.
    let teamFilter: string | undefined = qTeamId;
    if (qAgentId && teamFilter === undefined) {
      const agent = deps.agents.get(qAgentId);
      if (agent) teamFilter = agent.teamId || 'default';
    }
    const history = deps.storage.getHistoryPage({
      limit: Number.isFinite(qLimit) ? qLimit : undefined,
      beforeId: qBeforeId,
      agentId: qAgentId,
      teamId: teamFilter
    });
    // Fix interleave 6.44 (rework 6.33): khi trả history về client, GIỮ text + tool trong parts cho mọi
    // snapshot opencode (msgType==='opencode') để sau restart/reconnect vẫn render xen kẽ đúng thứ tự.
    // Chỉ guard bỏ entry null — KHÔNG lọc text. Dedup với canonical reply do client xử lý (agent view
    // lọc reply trùng nội dung khi đã có snapshot interleave; Khối 2/3 ẩn khi hasParts).
    const sanitized = history.map((m: any) => {
      if (m && m.msgType === 'opencode' && Array.isArray(m.parts)) {
        return { ...m, parts: m.parts.filter((p: any) => p && (p.type === 'tool' || p.type === 'text' || p.type === 'thinking')) };
      }
      return m;
    });
    res.json(sanitized);
  });

  // GET /api/messages
  router.get('/messages', (req, res) => {
    const qTeamId = req.query.teamId as string | undefined;
    if (qTeamId) {
      const filtered = deps.chatHistory.filter(m => (m.teamId || 'default') === qTeamId);
      return res.json(filtered);
    }
    res.json(deps.chatHistory);
  });

  // POST /api/chat
  router.post('/chat', async (req, res) => {
    let resolvedTargetId = '';
    let targetAgent: any | null = null;
    let rawMsg = '';
    let isSlashCommand = false;

    try {
      const { message, targetAgentId, agentId } = req.body || {};
      resolvedTargetId = targetAgentId || agentId || '';
      targetAgent = (resolvedTargetId && resolvedTargetId !== 'orchestrator') ? (deps.agents.get(resolvedTargetId) || deps.findAgentByIdNameOrRole(resolvedTargetId) || null) : null;

      rawMsg = (message || '').toString().trim().normalize('NFC');
      if (!rawMsg) {
        return res.status(400).json({ ok: false, error: 'Message cannot be empty' });
      }

      // User nhắn vào là người điều khiển tối cao: KHÔNG BAO GIỜ bị chặn bởi task limit!
      // Nếu agent bận, tin nhắn sẽ tự động vào backendUserQueues.

      const targetTeamId = targetAgent?.teamId || req.body?.teamId || 'default';
      const isTargetOrch = !targetAgent || deps.isOrchestratorLike(targetAgent) || targetAgent.id === 'orchestrator' || resolvedTargetId === 'orchestrator';
      const targetIdKey = targetAgent ? targetAgent.id : (resolvedTargetId || 'orchestrator');
      const targetClient = isTargetOrch ? deps.getOrchClient(targetIdKey) : (targetAgent ? deps.getClient(targetAgent) : null);
      const hasRealProcess = targetClient ? targetClient.isBusy() : false;
      let targetStatus = targetAgent ? (targetAgent.status || 'idle') : (isTargetOrch ? (deps.agents.get(targetIdKey)?.status || (targetIdKey === 'orchestrator' ? deps.agents.get('orchestrator')?.status : undefined) || 'idle') : (deps.agents.get(targetIdKey)?.status || 'idle'));

// PHÁT HIỆN & TỰ ĐỘNG GIẢI CỨU ZOMBIE WORKING STATE:
  // Nếu cờ trong DB/Memory là 'working' nhưng thực tế ACPClient không có tiến trình nào đang chạy (hasRealProcess === false):
  if (targetStatus === 'working' && !hasRealProcess) {
    console.log(`[ChatRoute] Tự động giải cứu Zombie Working state cho ${targetIdKey} (cờ working nhưng không có process thực) -> reset về idle và dispatch ngay!`);
    if (targetAgent) {
      targetAgent.status = 'idle';
      targetAgent.workingSince = undefined;
      deps.storage.updateAgent(targetAgent.id, { status: 'idle', workingSince: null });
      deps.broadcast('agent:updated', { agent: targetAgent });
    } else {
      const matchedAgent = deps.agents.get(targetIdKey) || (targetIdKey === 'orchestrator' ? deps.agents.get('orchestrator') : undefined);
      if (matchedAgent) {
        matchedAgent.status = 'idle';
        matchedAgent.workingSince = undefined;
        deps.storage.updateAgent(matchedAgent.id, { status: 'idle', workingSince: null });
        deps.broadcast('agent:updated', { agent: matchedAgent });
      }
    }
    targetStatus = 'idle';
    // Sau khi giải cứu zombie: xả ngay queue còn tồn đọng (fix bug "queue tích lũy
    // nhưng không spawn tiến trình mới" — trước đây reset idle nhưng không drain).
    // Drain the entire queue to ensure no messages are left behind.
    while (deps.userQueueManager.getQueueLength(targetIdKey) > 0) {
      deps.processNextBackendUserQueue?.(targetIdKey);
    }
  }

      const queueKey = targetIdKey;
      const hasPendingQueue = Boolean(deps.backendUserQueues[queueKey] && deps.backendUserQueues[queueKey].length > 0);
      const isTargetBusy = hasRealProcess || targetStatus === 'working' || hasPendingQueue;

      const now = Date.now();
      const clientMessageId = (req.body?.messageId || req.body?.id || '').toString().trim();
      const userMsg: any = {
        id: clientMessageId || uuidv4(),
        from: 'user',
        to: targetIdKey,
        content: rawMsg,
        timestamp: now,
        sourceCreatedAt: now,
        teamId: targetTeamId,
        isQueued: isTargetBusy
      };

      // Lưu tin nhắn User vào DB và memory ngay lập tức (bất kể target rảnh hay bận)
      deps.chatHistory.push(userMsg);
      deps.storage.saveMessage(userMsg);
      (deps.storage as any).schedulePersist?.(true);
      // CHỈ broadcast chat:message tạo bubble trên timeline khi agent rảnh.
      // Nếu agent bận, tin nằm trong floating queue bar và CHỈ broadcast tạo bubble khi resolve lúc respawn.
      if (!isTargetBusy) {
        deps.broadcast('chat:message', { msg: userMsg });
      }

      isSlashCommand = rawMsg.startsWith('/');

      // Xử lý riêng lệnh /restart để khởi động lại máy chủ
      if (rawMsg.toLowerCase() === '/restart') {
        const restartTeamId = req.body?.teamId || targetAgent?.teamId || 'default';
        const restartMsg: any = {
          id: uuidv4(),
          from: 'system',
          to: 'user',
          content: '🔄 Đang khởi động lại AgentForge server...',
          timestamp: Date.now(),
          agentName: 'System',
          agentRole: 'system',
          teamId: restartTeamId
        };
        deps.chatHistory.push(restartMsg);
        deps.storage.saveMessage(restartMsg);
        deps.broadcast('chat:message', { msg: restartMsg, teamId: restartTeamId });

        res.json({ ok: true, result: 'Restarting AgentForge server...' });

        setTimeout(() => {
          try {
            const batPath = join(process.cwd(), 'start.bat');
            const isWin = process.platform === 'win32';
            const child = spawn(
              isWin ? 'cmd.exe' : 'sh',
              isWin ? ['/c', batPath] : ['-c', 'npm start'],
              { detached: true, stdio: 'ignore', cwd: process.cwd() }
            );
            child.unref();
          } catch (err) {
            console.error('[Restart] Error spawning start.bat:', err);
          }
          process.exit(0);
        }, 500);
        return;
      }

      // Xử lý thông báo tức thời cho lệnh /compact (chỉ kích hoạt khi là lệnh đứng độc lập)
      if (/^\s*\/compact\s*$/i.test(rawMsg)) {
        const isOrch = !targetAgent || targetAgent.id === 'orchestrator' || resolvedTargetId === 'orchestrator';
        const targetName = isOrch ? 'Orchestrator' : (targetAgent ? targetAgent.name : 'Agent');
        const targetId = isOrch ? (resolvedTargetId || 'orchestrator') : (targetAgent ? targetAgent.id : resolvedTargetId);
        const compactTeamId = req.body?.teamId || targetAgent?.teamId || (isOrch ? deps.agents.get(targetId)?.teamId : undefined) || 'default';

        const compactNotice: any = {
          id: uuidv4(),
          from: 'system',
          to: targetId,
          content: `⚡ Đang gửi lệnh /compact chính thức tới session của ${targetName}...`,
          timestamp: Date.now(),
          agentName: 'System',
          agentRole: 'system',
          teamId: compactTeamId
        };
        deps.chatHistory.push(compactNotice);
        deps.storage.saveMessage(compactNotice);
        deps.broadcast('chat:message', { msg: compactNotice, teamId: compactTeamId });

        try {
          const client = isOrch ? deps.getOrchClient(targetId) : (targetAgent ? deps.getClient(targetAgent) : null);
          const sid = client?.getSessionId() || targetAgent?.sessionId || (isOrch ? deps.agents.get('orchestrator')?.sessionId : undefined);
          if (!sid) {
            const errMsg: any = {
              id: uuidv4(),
              from: 'system',
              to: 'user',
              content: `⚠️ Không thể thực hiện /compact: ${targetName} chưa có sessionId đang hoạt động.`,
              timestamp: Date.now(),
              agentName: 'System',
              agentRole: 'system',
              teamId: compactTeamId
            };
            deps.chatHistory.push(errMsg); deps.storage.saveMessage(errMsg);
            deps.broadcast('chat:message', { msg: errMsg, teamId: compactTeamId });
            if (!res.headersSent) res.json({ ok: false, error: 'no_active_session' });
            return;
          }

          const ok = client ? await client.compactSession(sid) : false;
          const doneMsg: any = {
            id: uuidv4(),
            from: 'system',
            to: 'user',
            content: ok
              ? `✅ Đã gửi lệnh /compact chính thức tới session ${sid}.`
              : `❌ Gửi lệnh /compact tới session ${sid} thất bại hoặc không thể kết nối OpenCode Serve.`,
            timestamp: Date.now(),
            agentName: 'System',
            agentRole: 'system',
            teamId: compactTeamId
          };
          deps.chatHistory.push(doneMsg); deps.storage.saveMessage(doneMsg);
          deps.broadcast('chat:message', { msg: doneMsg, teamId: compactTeamId });
          if (!res.headersSent) res.json({ ok, sessionId: sid, compacted: ok });
          return;
        } catch (err: any) {
          const failMsg: any = {
            id: uuidv4(),
            from: 'system',
            to: 'user',
            content: `❌ Lỗi /compact: ${err?.message || err}`,
            timestamp: Date.now(),
            agentName: 'System',
            agentRole: 'system',
            msgType: 'error',
            teamId: compactTeamId
          };
          deps.chatHistory.push(failMsg); deps.storage.saveMessage(failMsg);
          deps.broadcast('chat:message', { msg: failMsg, teamId: compactTeamId });
          if (!res.headersSent) res.json({ ok: false, error: err?.message || 'compact_failed' });
          return;
        }
      }

      // Nếu agent đích đang bận (status working hoặc client isBusy):
      // Đưa tin nhắn vào hàng đợi backendUserQueues, lưu tin nhắn vào DB/history để UI vẫn thấy, và phản hồi { ok: true, queued: true }
      if (isTargetBusy) {
        // Validate trước enqueue/persist: rawMsg + targetId phải hợp lệ; teamId resolve đúng
        // từ targetAgent (không persist khi thiếu) — giữ nguyên auto-continue.
        if (!rawMsg || !rawMsg.trim() || !targetIdKey) {
          return res.status(400).json({ ok: false, error: 'Message or target is empty' });
        }
        const enqueueTeamId = targetAgent?.teamId || deps.agents.get(resolvedTargetId)?.teamId || req.body?.teamId || 'default';
        userMsg.teamId = enqueueTeamId;
        // FIX (v7.0.55): Sử dụng userQueueManager để đảm bảo Proxy set trap được kích hoạt.
        // backendUserQueues là Proxy, get() trả `getQueue()` = `|| []` (truthy) → set trap không kích hoạt
        // → `.push()` ghi vào array rác bị vứt bỏ → in-memory queue rỗng vĩnh viễn → auto-drain không bao giờ xả.
        // Sử dụng enqueue() method của UserQueueManager thay vì gán trực tiếp vào backendUserQueues.
        deps.userQueueManager.enqueue({
          targetId: targetIdKey,
          rawMsg,
          isSlash: isSlashCommand,
          messageId: userMsg.id,
          timestamp: userMsg.timestamp,
          sourceCreatedAt: userMsg.sourceCreatedAt || userMsg.timestamp
        });
        // Lưu xuống đĩa cứng để sống sót qua crash / restart
        deps.storage.saveUnprocessedMessage(targetIdKey, rawMsg);
        console.log(`[BackendQueue] Target ${targetIdKey} is busy (status: ${targetStatus}). Queued message (queue length: ${deps.userQueueManager.getQueueLength(targetIdKey)}, timestamp: ${userMsg.timestamp}). Persisted to disk.`);
        // Kick drain ngay: nếu agent thực tế đang rảnh (zombie/error) thì queue sẽ xả
        // ngay thay vì chờ đợi; nếu agent thật sự bận thì đây chỉ là no-op health check.
        deps.processNextBackendUserQueue?.(targetIdKey);
        return res.json({ ok: true, queued: true, messageId: userMsg.id, message: 'Message queued in server for execution as soon as agent becomes idle.' });
      }

      // Bật ngay trạng thái working cho targetAgent trên UI trước khi dispatch
      if (targetAgent) {
        targetAgent.status = 'working';
        targetAgent.workingSince = targetAgent.workingSince || Date.now();
        deps.storage.updateAgent(targetAgent.id, { status: 'working', workingSince: targetAgent.workingSince });
        deps.broadcast('agent:updated', { agent: targetAgent });
      } else if (isTargetOrch) {
        deps.updateOrchStateSafe(targetIdKey, 'working', 'Đang phân tích yêu cầu & xử lý');
      }

      const turnResponseId = `turn-${targetIdKey}-${userMsg.id}`;
      const { response, sid, commands: commandResults } = await deps.dispatchUserChat({ targetAgentId: targetIdKey, rawMsg, isSlashCommand, isRetry: false, customTurnId: turnResponseId });
      if (!res.headersSent) {
        res.json({ ok: true, response, sessionId: sid, commands: commandResults });
      }
    } catch (err: any) {
      // Lỗi backend (LLM) sập / mạng → lưu queue disk, tự gửi lại khi backend sống
      if (deps.isRetriableError(err)) {
        if (!rawMsg || !rawMsg.trim() || !resolvedTargetId) {
          if (!res.headersSent) res.status(400).json({ ok: false, error: 'Message or target is empty' });
          return;
        }
        const id = uuidv4();
        deps.storage.enqueueChatRetry({
          id,
          targetAgentId: resolvedTargetId,
          rawMsg,
          isSlashCommand,
          attempts: 0,
          nextAttemptAt: Date.now() + 5000,
          createdAt: Date.now(),
          lastError: err?.message || String(err)
        });
        const retryTeamId = targetAgent?.teamId || deps.agents.get(resolvedTargetId)?.teamId || req.body?.teamId || 'default';
        const qMsg: any = {
          id: uuidv4(),
          from: 'system',
          to: 'user',
          content: `⏳ Tin nhắn của bạn đã được lưu và sẽ tự động gửi lại khi backend (LLM) sẵn sàng: "${rawMsg.slice(0, 100)}${rawMsg.length > 100 ? '...' : ''}"`,
          timestamp: Date.now(),
          agentName: 'System',
          agentRole: 'system',
          teamId: retryTeamId
        };
        deps.chatHistory.push(qMsg); deps.storage.saveMessage(qMsg);
        deps.broadcast('chat:message', { msg: qMsg, teamId: retryTeamId });
        if (!res.headersSent) res.json({ ok: true, queued: true, message: 'saved for retry when backend is available' });
        return;
      }

      // Lỗi thường (không retry): kiểm tra nếu là lỗi abort thì KHÔNG broadcast tin lỗi ra UI
      const isAbortError = err?.message && /agent operation aborted by user|aborted by user/i.test(err.message);
      const errorText = `❌ Error: ${err.message || 'Model execution or request failed'}`;
      const fromId = targetAgent ? targetAgent.id : (resolvedTargetId || 'orchestrator');

      if (!isAbortError) {
        const errorMsg: any = {
          id: uuidv4(),
          from: fromId,
          to: 'user',
          content: errorText,
          timestamp: Date.now(),
          agentName: targetAgent ? targetAgent.name : 'Orchestrator',
          agentRole: targetAgent ? targetAgent.role : 'orchestrator',
          msgType: 'error',
          teamId: targetAgent?.teamId || deps.agents.get(fromId)?.teamId || 'default'
        };
        deps.chatHistory.push(errorMsg);
        deps.storage.saveMessage(errorMsg);
        deps.broadcast('chat:message', { msg: errorMsg });
      } else {
        console.log(`[Chat] Suppressed user-visible error for aborted turn: ${err.message}`);
      }

      const errTargetIdKey = targetAgent ? targetAgent.id : (resolvedTargetId || 'orchestrator');
      if (targetAgent) {
        targetAgent.status = isAbortError ? 'idle' : 'error';
        targetAgent.workingSince = undefined;
        deps.storage.updateAgent(targetAgent.id, { status: targetAgent.status, workingSince: null });
        deps.broadcast('agent:updated', { agent: targetAgent });
        if (targetAgent.status === 'idle') {
          deps.processNextBackendUserQueue?.(targetAgent.id);
        }
      } else {
        const orchAgent = deps.agents.get(errTargetIdKey) || deps.agents.get('orchestrator');
        if (orchAgent) {
          orchAgent.status = 'idle';
          orchAgent.workingSince = undefined;
          deps.storage.updateAgent(orchAgent.id, { status: 'idle', workingSince: null });
          deps.broadcast('agent:updated', { agent: orchAgent });
          deps.processNextBackendUserQueue?.(orchAgent.id);
        } else {
          deps.broadcast('agent:updated', { agent: { id: errTargetIdKey, status: 'idle' } } as any);
          deps.processNextBackendUserQueue?.(errTargetIdKey);
        }
      }
      if (!res.headersSent) {
        res.json({ ok: false, error: err.message, response: isAbortError ? undefined : errorText, aborted: isAbortError });
      }
    }
  });

  // POST /api/chat/force-send
  router.post('/chat/force-send', async (req, res) => {
    let resolvedTargetId = '';
    let targetAgent: any | null = null;
    let rawMsg = '';
    try {
      const { message, content, targetAgentId, agentId, mode, messageId } = req.body || {};
      resolvedTargetId = targetAgentId || agentId || 'orchestrator';
      targetAgent = (resolvedTargetId && resolvedTargetId !== 'orchestrator')
        ? (deps.agents.get(resolvedTargetId) || deps.findAgentByIdNameOrRole(resolvedTargetId) || null)
        : null;

      const isOrch = !targetAgent || targetAgent.id === 'orchestrator' || resolvedTargetId === 'orchestrator';
      const targetName = isOrch ? 'Orchestrator' : (targetAgent ? targetAgent.name : 'Agent');
      const targetId = isOrch ? 'orchestrator' : (targetAgent ? targetAgent.id : resolvedTargetId);
      const targetIdKey = deps.normalizeQueueKey(targetId);
      const targetTeamId = targetAgent?.teamId || req.body?.teamId || 'default';

      const client = isOrch ? deps.getOrchClient('orchestrator') : (targetAgent ? deps.getClient(targetAgent) : null);
      if (!client) {
        return res.status(400).json({ ok: false, error: `Client not found for ${targetId}` });
      }

      // 0. Xử lý mode: 'single' (bốc 1 tin cụ thể) hoặc 'all' (bốc toàn bộ hàng đợi)
      const queue = deps.backendUserQueues[targetIdKey] || [];
      let promptToSend = ((content || message) || '').toString().trim().normalize('NFC');

      if (mode === 'all') {
        // Bốc toàn bộ hàng đợi của targetIdKey
        if (queue.length > 0) {
          // Gom theo đúng thứ tự thời gian timestamp
          const sorted = [...queue].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          const combined = sorted.map((q, idx) => `[Message ${idx + 1} lúc ${new Date(q.timestamp).toLocaleTimeString()}]:\n${q.rawMsg}`).join('\n\n');
          promptToSend = promptToSend ? `${promptToSend}\n\n${combined}` : combined;
          // Xoá sạch toàn bộ hàng đợi (cờ isQueued trên msg gốc được blanket cleanup phía dưới xử lý)
          deps.backendUserQueues[targetIdKey] = [];
        }
      } else {
        // mode === 'single' (mặc định)
        // Bốc duy nhất tin nhắn tương ứng (theo messageId hoặc nội dung)
        if (messageId && queue.length > 0) {
          deps.backendUserQueues[targetIdKey] = queue.filter(q => q.messageId !== messageId);
        } else if (promptToSend && queue.length > 0) {
          const foundIdx = queue.findIndex(q => q.rawMsg === promptToSend);
          if (foundIdx !== -1) {
            queue.splice(foundIdx, 1);
          }
        }
      }

      // FIX (v7.0.55): Với mode 'all', dọn sạch vĩnh viễn các cờ isQueued=true còn dính trên
      // chatHistory/DB (kể cả khi in-memory queue rỗng do bug proxy cũ đã vứt bỏ array). Nếu không,
      // UI queue bar hiển thị "queue kẹt" vĩnh viễn dù tin đã được gửi. Chỉ áp dụng mode 'all' —
      // 'single' giữ nguyên trạng thái các tin còn trong hàng đợi.
      if (mode === 'all') {
        for (const histMsg of deps.chatHistory) {
          if ((histMsg as any).to === targetId && (histMsg as any).isQueued === true) {
            (histMsg as any).isQueued = false;
            deps.storage.saveMessage(histMsg);
          }
        }
      }

      rawMsg = promptToSend;
      if (!rawMsg) {
        return res.status(400).json({ ok: false, error: 'Message content or queue is empty' });
      }

      // 1. Can thiệp ngắt tiến trình đang chạy (nếu có)
      // FIX (v7.0.55): Attach mode — KHÔNG kill process cũ (giữ session, không compact blocking).
      // Compact via enqueue() sẽ deadlock khi client.busy=true, gây Attach command failed (1).
      // Thay vào đó: bỏ qua abort/compact, chỉ cập nhật status và dispatch prompt mới.
      // Process attach cũ tự kết thúc lượt hiện tại, lượt mới sẽ spawn sau.
      let wasAborted = false;
      const isAttachMode = (client as any).getMode?.() === 'attach';
      if (isAttachMode) {
        wasAborted = false;
        console.log(`[ForceSend] Attach mode: skip kill/compact, keep session for ${targetId}`);
      } else {
        try {
          wasAborted = client.abort();
        } catch (e: any) {
          console.warn(`[ForceSend] Error aborting client for ${targetId}:`, e?.message || e);
        }
      }

      // Tối ưu hóa Force-Send: broadcast t=0ms và không chặn delay cứng 2.5s
      // Xóa sạch bộ đệm rác cũ để không gộp chéo tin cũ khi spawn lượt mới
      deps.storage.clearUnprocessedMessages(targetIdKey);
      client.clearUnprocessedPrompts();

      // 2. Dọn dẹp dispatch buffers & cập nhật trạng thái
      if (isOrch) {
        deps.drainDispatchState(targetId);
        deps.updateOrchStateSafe(targetId, 'working', `⚡ Can thiệp gửi ngay: ${rawMsg.slice(0, 50)}...`);
      } else if (targetAgent) {
        targetAgent.status = 'working';
        targetAgent.workingSince = Date.now();
        deps.storage.updateAgent(targetAgent.id, { status: 'working', workingSince: Date.now() });
        deps.broadcast('agent:updated', { agent: targetAgent });
      }

      // 3. Thông báo can thiệp lên Chat
      const noticeMsg: any = {
        id: uuidv4(),
        from: 'system',
        to: 'user',
        content: mode === 'all'
          ? `⚡ Đã ngắt lượt trước của ${targetName} và gom toàn bộ tin trong hàng đợi để "Gửi ngay".`
          : `⚡ Đã ngắt lượt trước của ${targetName} theo lệnh "Gửi ngay" và bắt đầu thực thi ngay.`,
        timestamp: Date.now(),
        agentName: 'System',
        agentRole: 'system',
        teamId: targetTeamId
      };
      deps.chatHistory.push(noticeMsg);
      deps.storage.saveMessage(noticeMsg);
      deps.broadcast('chat:message', { msg: noticeMsg });

      // 4. Cập nhật tin nhắn User đã có trong lịch sử (KHÔNG tạo mới — tránh dup!)
      // Tin nhắn user đã được lưu vào chatHistory khi gửi POST /api/chat lần đầu.
      // Force-send chỉ cần gỡ cờ isQueued và broadcast lại bubble.
      const existingUserIdx = deps.chatHistory.findIndex(m => m.id === messageId);
      if (existingUserIdx !== -1) {
        // Cập nhật isQueued = false trên tin đã tồn tại
        deps.chatHistory[existingUserIdx].isQueued = false;
        deps.storage.saveMessage(deps.chatHistory[existingUserIdx]);
        deps.broadcast('chat:message', { msg: deps.chatHistory[existingUserIdx] });
      } else {
        // Fallback: nếu không tìm thấy (từ queue backend, không qua POST /api/chat):
        // Lưu mới và broadcast
        const userMsg: any = {
          id: messageId || uuidv4(),
          from: 'user',
          to: targetId,
          content: rawMsg,
          timestamp: Date.now(),
          teamId: targetTeamId
        };
        deps.chatHistory.push(userMsg);
        deps.storage.saveMessage(userMsg);
        deps.broadcast('chat:message', { msg: userMsg });
      }

      // Trả response ngay cho client để UI không chờ
      res.json({ ok: true, aborted: wasAborted, targetId, mode: mode || 'single' });

      // 5. Spawn tiến trình mới chạy đúng nội dung gửi ngay thông qua dispatchUserChat
      const forceTurnId = `turn-${targetId}-${messageId || Date.now()}`;
      deps.dispatchUserChat({
        targetAgentId: targetId,
        rawMsg,
        isSlashCommand: rawMsg.startsWith('/'),
        isRetry: false,
        customTurnId: forceTurnId
      }).catch(err => {
        const isAbort = err?.message && /agent operation aborted by user|aborted by user/i.test(err.message);
        if (isAbort) {
          console.log(`[ForceSend] Ignored abort error from previous run or cancellation: ${err.message}`);
          return;
        }
        console.error(`[ForceSend] Error in dispatchUserChat for ${targetId}:`, err);
        // Cập nhật trạng thái error và thông báo nếu là lỗi thực sự khác abort
        if (targetAgent) {
          targetAgent.status = 'error';
          targetAgent.workingSince = undefined;
          deps.storage.updateAgent(targetAgent.id, { status: 'error', workingSince: null });
          deps.broadcast('agent:updated', { agent: targetAgent });
        } else if (isOrch) {
          deps.updateOrchStateSafe(targetId, 'idle', 'Sẵn sàng');
        }
        const failNotice: any = {
          id: uuidv4(),
          from: targetId,
          to: 'user',
          content: `❌ Lỗi khi thực thi "Gửi ngay": ${err?.message || err}`,
          timestamp: Date.now(),
          agentName: targetName,
          agentRole: isOrch ? 'orchestrator' : (targetAgent?.role || 'worker'),
          msgType: 'error',
          teamId: targetTeamId
        };
        deps.chatHistory.push(failNotice);
        deps.storage.saveMessage(failNotice);
        deps.broadcast('chat:message', { msg: failNotice });
      });

    } catch (err: any) {
      console.error('[ForceSend] Handler error:', err);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: err?.message || 'Force send failed' });
      }
    }
  });

  // POST /api/broadcast — Broadcast a message from the user to ALL agents + orchestrator (khẩn cấp)
  // Gửi đến TẤT CẢ agent trên server (không phân team, không queue — gửi ngay)
  router.post('/broadcast', async (req: any, res: any) => {
    try {
      const rawMsg = ((req.body?.message) || '').toString().trim().normalize('NFC');
      if (!rawMsg) {
        return res.status(400).json({ ok: false, error: 'Message cannot be empty' });
      }

      const now = Date.now();
      const msgId = req.body?.messageId || uuidv4();
      const teamId = req.body?.teamId || 'default';

      // Lưu tin broadcast vào chat history (từ user → broadcast)
      const broadcastMsg: any = {
        id: msgId,
        from: 'user',
        to: 'broadcast',
        content: rawMsg,
        timestamp: now,
        sourceCreatedAt: now,
        teamId,
        isBroadcast: true
      };
      deps.chatHistory.push(broadcastMsg);
      deps.storage.saveMessage(broadcastMsg);
      (deps.storage as any).schedulePersist?.(true);
      deps.broadcast('chat:message', { msg: broadcastMsg });

      // Gửi tới TẤT CẢ agent đang có trên server (không phân team)
      // Kiểm tra client tồn tại trước khi dispatch
      let successCount = 0;
      let failCount = 0;
      const failedAgents: string[] = [];

      for (const agent of deps.agents.values()) {
        // Bỏ orchestrator — xử lý riêng bên dưới
        if (agent.id === 'orchestrator' || agent.type === 'orchestrator') continue;

        // Bỏ agent đã dừng (không thể nhận tin)
        if (agent.status === 'stopped') {
          // Vẫn lưu tin nhắn vào history cho reference
          const agentMsg: any = {
            id: `broadcast-${uuidv4()}`,
            from: 'user',
            to: agent.id,
            content: `[🚨 USER BROADCAST (khẩn cấp)] ${rawMsg}`,
            timestamp: now,
            sourceCreatedAt: now,
            teamId: agent.teamId,
            isBroadcast: true,
            status: 'stopped'
          };
          deps.chatHistory.push(agentMsg);
          deps.storage.saveMessage(agentMsg);
          continue;
        }

        // Kiểm tra client tồn tại
        const client = deps.clients?.get(agent.id);
        if (!client) {
          // Agent không có client — lưu tin nhắn vào storage để xử lý khi agent khởi động lại
          const agentMsg: any = {
            id: `broadcast-${uuidv4()}`,
            from: 'user',
            to: agent.id,
            content: `[🚨 USER BROADCAST (khẩn cấp)] ${rawMsg}`,
            timestamp: now,
            sourceCreatedAt: now,
            teamId: agent.teamId,
            isBroadcast: true,
            status: 'no_client'
          };
          deps.chatHistory.push(agentMsg);
          deps.storage.saveMessage(agentMsg);
          // Lưu vào unprocessed messages để xử lý khi agent có session
          try {
            deps.storage.saveUnprocessedMessage(agent.id, `[🚨 USER BROADCAST (khẩn cấp)] ${rawMsg}`);
          } catch {}
          failCount++;
          failedAgents.push(`${agent.name}(${agent.id})-no_client`);
          console.warn(`[Broadcast] Agent ${agent.name} (${agent.id}) has no client — saved to unprocessed`);
          continue;
        }

        // Lưu tin nhắn vào chat history
        const agentMsg: any = {
          id: `broadcast-${uuidv4()}`,
          from: 'user',
          to: agent.id,
          content: `[🚨 USER BROADCAST (khẩn cấp)] ${rawMsg}`,
          timestamp: now,
          sourceCreatedAt: now,
          teamId: agent.teamId,
          isBroadcast: true
        };
        deps.chatHistory.push(agentMsg);
        deps.storage.saveMessage(agentMsg);

        // Dispatch ngay (không queue thường — khẩn cấp)
        // Force set agent status to 'working' trước khi dispatch
        const prevStatus = agent.status;
        agent.status = 'working';
        agent.workingSince = Date.now();
        deps.storage.updateAgent(agent.id, { status: 'working', workingSince: agent.workingSince });
        deps.broadcast('agent:updated', { agent });

        const bcastTurnId = `turn-${agent.id}-${agentMsg.id}`;
        deps.dispatchUserChat({
          targetAgentId: agent.id,
          rawMsg: `[🚨 USER BROADCAST (khẩn cấp)] ${rawMsg}`,
          isSlashCommand: false,
          isRetry: false,
          customTurnId: bcastTurnId
        }).then(() => {
          successCount++;
          console.log(`[Broadcast] ✅ Đã gửi tới ${agent.name} (${agent.id})`);
        }).catch((err: any) => {
          failCount++;
          failedAgents.push(`${agent.name}(${agent.id})`);
          const isAbort = err?.message && /aborted by user/i.test(err.message);
          if (isAbort) {
            console.log(`[Broadcast] ⏭️ Agent ${agent.name} (${agent.id}) aborted (expected)`);
          } else {
            console.error(`[Broadcast] ❌ Error dispatching to ${agent.name} (${agent.id}):`, err?.message || err);
            // Lưu vào unprocessed messages
            try {
              deps.storage.saveUnprocessedMessage(agent.id, `[🚨 USER BROADCAST (khẩn cấp)] ${rawMsg}`);
            } catch {}
          }
        }).finally(() => {
          // Restore status if needed
          if (prevStatus === 'idle' || prevStatus === 'error') {
            agent.status = prevStatus as any;
            agent.workingSince = undefined;
            deps.storage.updateAgent(agent.id, { status: prevStatus, workingSince: null });
            deps.broadcast('agent:updated', { agent });
          }
        });
      }

      // Dispatch tới orchestrator (luôn luôn, bất kể team)
      const orchAgent = deps.agents.get('orchestrator') || (() => {
        // Tìm orchestrator trong agents map
        for (const [, a] of deps.agents) {
          if (a.type === 'orchestrator' || a.id === 'orchestrator' || a.role === 'orchestrator') return a;
        }
        return null;
      })();

      if (orchAgent) {
        const orchMsg: any = {
          id: `broadcast-${uuidv4()}`,
          from: 'user',
          to: 'orchestrator',
          content: `[🚨 USER BROADCAST (khẩn cấp)] ${rawMsg}`,
          timestamp: now,
          sourceCreatedAt: now,
          teamId,
          isBroadcast: true
        };
        deps.chatHistory.push(orchMsg);
        deps.storage.saveMessage(orchMsg);

        const orchClient = deps.clients?.get('orchestrator');
        if (orchClient) {
          const orchTurnId = `turn-orchestrator-${orchMsg.id}`;
          deps.dispatchUserChat({
            targetAgentId: 'orchestrator',
            rawMsg: `[🚨 USER BROADCAST (khẩn cấp)] ${rawMsg}`,
            isSlashCommand: false,
            isRetry: false,
            customTurnId: orchTurnId
          }).then(() => {
            successCount++;
            console.log(`[Broadcast] ✅ Đã gửi tới orchestrator`);
          }).catch((err: any) => {
            failCount++;
            failedAgents.push(`orchestrator`);
            console.error(`[Broadcast] ❌ Error dispatching to orchestrator:`, err?.message || err);
          });
        } else {
          failCount++;
          failedAgents.push('orchestrator-no_client');
          console.warn(`[Broadcast] Orchestrator has no client`);
        }
      }

      const totalTargets = successCount + failCount;

      // Broadcast hệ thống thông báo kết quả
      const doneMsg: any = {
        id: uuidv4(),
        from: 'system',
        to: 'user',
        content: `📢 Đã broadcast tin nhắn tới ${totalTargets} target (${successCount} thành công, ${failCount} thất bại).`,
        timestamp: Date.now(),
        agentName: 'System',
        agentRole: 'system',
        teamId
      };
      if (failedAgents.length > 0) {
        doneMsg.content += ` Thất bại: ${failedAgents.join(', ')}.`;
      }
      deps.chatHistory.push(doneMsg);
      deps.storage.saveMessage(doneMsg);
      deps.broadcast('chat:message', { msg: doneMsg });

      res.json({ ok: true, broadcastTo: totalTargets, successCount, failCount, failedAgents, messageId: msgId });
    } catch (err: any) {
      console.error('[Broadcast] Error:', err);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: err?.message || 'Broadcast failed' });
      }
    }
  });

  // POST /api/chat/queue/remove — Xoá thật tin nhắn khỏi hàng đợi người dùng (backendUserQueues & pending queue)
  router.post('/queue/remove', (req: any, res: any) => {
    try {
      const { agentId, messageId, rawMsg } = req.body || {};
      const targetId = (agentId || 'orchestrator').toString().trim();
      const isOrch = targetId === 'orchestrator' || deps.agents.get(targetId)?.role === 'orchestrator';
      const targetKeys = isOrch ? Array.from(new Set([targetId, 'orchestrator'])) : [targetId];

      let removedCount = 0;
      targetKeys.forEach(tKey => {
        const queue = deps.backendUserQueues[tKey];
        if (queue && queue.length > 0) {
          const beforeLen = queue.length;
          deps.backendUserQueues[tKey] = queue.filter(item => {
            if (messageId && (item.messageId === messageId || item.id === messageId)) return false;
            if (rawMsg && item.rawMsg === rawMsg) return false;
            return true;
          });
          removedCount += (beforeLen - deps.backendUserQueues[tKey].length);
        }
      });

      // Broadcast để toàn bộ client đồng bộ dọn UI
      if (messageId) {
        deps.broadcast('chat:queue:dispatched', {
          targetAgentId: targetId,
          messageIds: [messageId],
          count: removedCount
        });
      }

      res.json({ ok: true, removedCount });
    } catch (err: any) {
      console.error('[QueueRemove] Error removing item from queue:', err);
      res.status(500).json({ ok: false, error: err?.message || 'Failed to remove from queue' });
    }
  });

  return router;
}
