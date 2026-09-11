// src/core/dispatch.ts
/**
 * Lõi xử lý tin nhắn người dùng (dispatchUserChat) cho agentforge.
 * Tách riêng từ src/server.ts để hợp nhất trong refactor v8.
 * Xuất type DispatchDeps và export function dispatchUserChat(core implementation).
 * Bao gồm logic preserve & auto-merge unprocessed messages, retry, queue management,
 * agent state updates, prompt building, và retry queue.
 * Có thể hoạt động độc lập từ server.ts khi feature flag USE_V8_CORE được bật.
 */

import type { Agent } from '../agents/agent-manager.js';
import type { ChatMsg } from '../agents/agent-manager.js';
import type { AgentConfig } from '../agents/types.js';
import { ACPClient, OpenCodeServeClient } from '../agents/index.js';

/**
 * Type phụ thuộc cho core dispatch.
 * Bao gồm: agents map, storage, broadcast, clients, lịch sử chat,
 * hàng đợi backend user, userQueueManager, và nhiều hàm trợ giúp.
 */
export interface DispatchDeps {
  agents: Map<string, Agent>;
  storage: any; // @todo: tinh chỉnh kiểu storage sau
  broadcast: (type: string, data: any) => void;
  clients: Map<string, ACPClient | OpenCodeServeClient>;
  chatHistory: ChatMsg[];
  backendUserQueues: Record<string, any[]>;
  userQueueManager: {
    enqueue: (msg: any) => void;
    getQueueLength: (targetId: string) => number;
    getQueue: (targetId: string) => any[];
    clearQueue: (targetId: string) => void;
    processNext: (targetId: string) => void;
  };
  findAgentByIdNameOrRole: (identifier: string, preferredTeamId?: string) => Agent | undefined;
  isOrchestratorLike: (agent: Agent) => boolean;
  getOrchClient: (orchId: string) => ACPClient | OpenCodeServeClient;
  getClient: (agent: Agent) => ACPClient | OpenCodeServeClient;
  normalizeQueueKey: (targetId?: string) => string;
  drainDispatchState: (agentId: string) => void;
  updateOrchStateSafe: (orchId: string, status: 'idle' | 'working' | 'error', taskDesc?: string) => void;
  isRetriableError: (err: any) => boolean;
  getEffectiveTaskLimit: (teamId?: string) => number;
  processNextBackendUserQueue?: (rawTargetId: string) => void;
}

/**
 * Xuất implementation của dispatchUserChat, chấp nhận Dependency Injection.
 * Logic được sao chép từ src/server.ts:
 *   - Preserve & auto-merge unprocessed messages (lượt trước bị stop/abort).
 *   - Xác thực agent mục tiêu, zombie state rescue.
 *   - Xác định xử lý hàng đợi backend cho target.
 *   - Xây dựng prompt bao gồm team context.
 *   - Gửi tin nhắn cho agent/client.
 *   - Retry logic cho error.
 *   - Xử lý slash commands.
 */
export async function dispatchUserChat(deps: DispatchDeps, params: {
  targetAgentId: string;
  rawMsg: string;
  isSlashCommand: boolean;
  isRetry?: boolean;
}): Promise<{ response: string; sid: string | null; commands: string[] }> {
  const { targetAgentId, rawMsg, isSlashCommand, isRetry = false } = params;
  let resolvedTargetId = targetAgentId || '';
  let targetAgent: Agent | null | undefined = (resolvedTargetId && resolvedTargetId !== 'orchestrator')
    ? (deps.agents.get(resolvedTargetId) || deps.findAgentByIdNameOrRole(resolvedTargetId) || null)
    : null;

  const isOrchTarget = !targetAgent || deps.isOrchestratorLike(targetAgent) || resolvedTargetId === 'orchestrator';
  let orchId = targetAgent ? targetAgent.id : (resolvedTargetId || 'orchestrator');
  if (isOrchTarget && !deps.agents.has(orchId)) {
    const existingOrch = findExistingOrchestrator(deps);
    if (existingOrch) {
      targetAgent = existingOrch;
      orchId = existingOrch.id;
    }
  }

  let agentName = targetAgent ? targetAgent.name : 'Orchestrator';
  let agentRole = targetAgent ? targetAgent.role : 'orchestrator';
  let prompt: string;
  let sid: string | null = null;
  const client = isOrchTarget ? deps.getOrchClient(orchId) : (targetAgent ? deps.getClient(targetAgent) : null);
  const commandResults: string[] = [];

  if (!client) {
    const errorTargetId = isOrchTarget ? orchId : (targetAgent ? targetAgent.id : (resolvedTargetId || 'orchestrator'));
    console.error(`[Dispatch] No client available for target ${errorTargetId}`);
    return { response: '', sid: null, commands: [] };
  }

  // ============ PRESERVE & AUTO-MERGE UNPROCESSED USER MESSAGES ============
  // Nếu lượt trước bị Stop / Abort mà còn tin nhắn chưa được xử lý,
  // tự động gộp toàn bộ tin cũ cùng tin mới vào lượt này để không bao giờ mất yêu cầu của người dùng.
  let effectiveMsg = rawMsg;
  const targetKey = isOrchTarget ? orchId : (targetAgent ? targetAgent.id : (resolvedTargetId || 'orchestrator'));
  const storedOldMsgs = isRetry ? deps.storage.getUnprocessedMessages(targetKey) : [];
  const clientOldPrompts = isRetry ? client.getUnprocessedPrompts() : [];
  const combinedOld = Array.from(new Set([...storedOldMsgs, ...clientOldPrompts])).filter(p => p && p.trim() && p.trim() !== rawMsg.trim());

  if (isRetry && combinedOld.length > 0 && !isSlashCommand) {
    const oldFormatted = combinedOld.map((m, idx) => `[Tin ${idx + 1} chưa xử lý trước đó]:\n${m}`).join('\n\n---\n\n');
    effectiveMsg = `${oldFormatted}\n\n---\n\n[Yêu cầu mới nhất]:\n${rawMsg}`;
    deps.storage.clearUnprocessedMessages(targetKey);
    client.clearUnprocessedPrompts();

    const mergeNotice: ChatMsg = createChatMsg(targetKey, 'system',
      `🔄 Đã tự động gộp ${combinedOld.length} yêu cầu chưa được xử lý từ lượt trước vào lượt chat này để bảo toàn công việc.`,
      { agentName: 'System', agentRole: 'system' });
    deps.chatHistory.push(mergeNotice);
    deps.storage.saveMessage(mergeNotice);
    deps.broadcast('chat:message', { msg: mergeNotice });
  } else if (!isRetry) {
    deps.storage.clearUnprocessedMessages(targetKey);
    client.clearUnprocessedPrompts();
  }

  // Xử lý zombie state (working flag nhưng không có process)
  const isOrch = isOrchTarget;
  const targetIdKey = isOrch ? (resolvedTargetId || 'orchestrator') : (targetAgent ? targetAgent.id : resolvedTargetId || 'orchestrator');
  const targetClient = isOrch ? deps.getOrchClient(targetIdKey) : (targetAgent ? deps.getClient(targetAgent) : null);
  const hasRealProcess = targetClient ? targetClient.isBusy() : false;
  let targetStatus = targetAgent ? (targetAgent.status || 'idle') : (isOrch ? (deps.agents.get(targetIdKey)?.status || (targetIdKey === 'orchestrator' ? deps.agents.get('orchestrator')?.status : undefined) || 'idle') : (deps.agents.get(targetIdKey)?.status || 'idle'));

  if (targetStatus === 'working' && !hasRealProcess) {
    console.log(`[Dispatch] Tự động giải cứu Zombie Working state cho ${targetIdKey}`);
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
    deps.processNextBackendUserQueue?.(targetIdKey);
  }

  const queueKey = targetIdKey;
  const hasPendingQueue = Boolean(deps.backendUserQueues[queueKey] && deps.backendUserQueues[queueKey].length > 0);
  const isTargetBusy = hasRealProcess || targetStatus === 'working' || hasPendingQueue;

  // Xử lý slash command
  if (isSlashCommand) {
    client.setNeedPromptReinject(true);
  }

  const shouldReinject = (client.getNeedPromptReinject() || (targetAgent ? !targetAgent.sessionId : !client.getSessionId())) && !isSlashCommand;
  if (client.getNeedPromptReinject() && !isSlashCommand) {
    client.setNeedPromptReinject(false);
  }

  // Ghi lại tin user (giống như trong server.ts)
  const now = Date.now();
  const clientMessageId = '';
  const userMsg: ChatMsg = {
    id: clientMessageId || uuidv4(),
    from: 'user',
    to: targetIdKey,
    content: rawMsg,
    timestamp: now,
    sourceCreatedAt: now,
    teamId: targetAgent?.teamId || 'default',
    isQueued: isTargetBusy
  };
  deps.chatHistory.push(userMsg);
  deps.storage.saveMessage(userMsg);
  (deps.storage as any).schedulePersist?.(true);
  if (!isTargetBusy) {
    deps.broadcast('chat:message', { msg: userMsg });
  }

  if (isSlashCommand) {
    prompt = effectiveMsg;
  } else {
    const includeTeam = shouldIncludeTeamContext(targetAgent as Agent | undefined, shouldReinject);
    if (includeTeam) {
      const team = buildTeam(deps, targetAgent as Agent | undefined, shouldReinject);
prompt = (targetAgent?.sessionId && !shouldReinject && targetAgent)
      ? `[TEAM UPDATE]\n${team}\n\n[FROM: user] [TO: ${targetAgent.id}] ${effectiveMsg}`
      : `[TEAM]\n${team}\n[/TEAM]\n\n[FROM: user] [TO: ${targetAgent?.id ?? resolvedTargetId}] ${effectiveMsg}`;
    } else {
      prompt = `[FROM: user] [TO: ${targetAgent ? targetAgent.id : resolvedTargetId}] ${effectiveMsg}`;
    }
  }

  // Gửi tin nhắn cho agent/client — cả 2 client type đều có enqueue()
  const result = await client.enqueue(prompt);
  sid = (result as any).sessionId || (client as any).getSessionId?.() || null;

  // PERSIST SESSION NGAY LẬP TỨC: Cập nhật sessionId vào targetAgent và Storage
  if (sid) {
    if (targetAgent) {
      targetAgent.sessionId = sid;
      if ((result as any)?.tokenUsage) targetAgent.tokenUsage = (result as any).tokenUsage;
      if ((result as any)?.contextLength) targetAgent.contextLength = (result as any).contextLength;
      deps.storage.updateAgent(targetAgent.id, {
        sessionId: sid,
        tokenUsage: targetAgent.tokenUsage,
        contextLength: targetAgent.contextLength
      });
      deps.broadcast('agent:updated', { agent: targetAgent });
    } else if (isOrchTarget) {
      const orchAgent = deps.agents.get(targetKey) || deps.agents.get('orchestrator');
      if (orchAgent) {
        orchAgent.sessionId = sid;
        if ((result as any)?.tokenUsage) orchAgent.tokenUsage = (result as any).tokenUsage;
        if ((result as any)?.contextLength) orchAgent.contextLength = (result as any).contextLength;
        deps.storage.updateAgent(orchAgent.id, {
          sessionId: sid,
          tokenUsage: orchAgent.tokenUsage,
          contextLength: orchAgent.contextLength
        });
        deps.broadcast('agent:updated', { agent: orchAgent });
      }
    }
  }

  // Xử lý reply từ client (broadcast kết quả, lưu storage, error handling/retry).
  // KHÔNG để dead code: result được truyền qua handleClientReply để:
  //   - Phát nội dung phản hồi agent → user qua WS.
  //   - Nếu client trả error → lưu unprocessed + broadcast error, retry 1 lần nếu chưa phải retry.
  const replyHandled = await handleClientReply(client, result, deps, targetKey, isSlashCommand, isRetry);
  if (!replyHandled && !isRetry) {
    // Retry một lần khi lượt đầu thất bại (tránh mất tin, không lặp vô hạn).
    await handleClientReply(client, result, deps, targetKey, isSlashCommand, true);
  }

  // Trả về response thật (nếu có) thay cho chuỗi rỗng — caller (HTTP/API) cần nội dung phản hồi.
  const responseText = typeof (result as any)?.text === 'string'
    ? (result as any).text
    : typeof (result as any)?.content === 'string'
      ? (result as any).content
      : (typeof result === 'string' ? result : '');
  return { response: responseText || '', sid, commands: commandResults };
}

// ========== Helper functions (trích từ server.ts) ==========

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function createChatMsg(to: string, from: string, content: string, opts?: any): ChatMsg {
  const msg: ChatMsg = {
    id: uuidv4(),
    from,
    to,
    content,
    timestamp: Date.now(),
    sourceCreatedAt: Date.now(),
    ...(opts?.agentName && { agentName: opts.agentName }),
    ...(opts?.agentRole && { agentRole: opts.agentRole }),
    teamId: opts?.teamId || 'default',
    msgType: opts?.msgType || 'chat',
    showOnUI: true,
    ...opts
  };
  return msg;
}

function findExistingOrchestrator(deps: any): Agent | undefined {
  for (const [, a] of deps.agents) {
    if (a.type === 'orchestrator') return a;
  }
  return undefined;
}

// ===== TEAM CONTEXT VERSIONING (self-contained, tách từ server.ts) =====
// membershipVersion: CHỈ tăng khi SPAWN hoặc DELETE agent (thay đổi thành phần team).
// Status đổi (idle/working/stopped) KHÔNG tăng version.
const membershipVersionByTeam = new Map<string, number>();
function getMembershipVersion(teamId?: string): number {
  return membershipVersionByTeam.get(teamId || 'default') || 1;
}
function bumpMembershipVersion(teamId?: string): void {
  const tid = teamId || 'default';
  membershipVersionByTeam.set(tid, getMembershipVersion(tid) + 1);
}
// lastTeamVersionDelivered: version [TEAM UPDATE] cuối cùng đã được inject cho từng agent.
const lastTeamVersionDelivered = new Map<string, number>();

/**
 * Xác định có cần inject block [TEAM]/[TEAM UPDATE] cho agent hay không.
 * Logic khớp server.ts: trả true khi (a) có thay đổi thành phần team kể từ lần
 * inject trước cho agent này, hoặc (b) bị ép inject (shouldReinject / session mới).
 * Hỗ trợ per-team version để tránh team A spawn làm team B bị inject thừa.
 */
function shouldIncludeTeamContext(agent?: Agent, shouldReinject?: boolean): boolean {
  if (!agent) return false;
  // Luôn inject khi cần reinject (session mới / prompt chưa từng được gửi) — đảm bảo
  // agent luôn có ngữ cảnh team đúng cho lần đầu.
  if (shouldReinject) {
    const tid = agent.teamId || 'default';
    lastTeamVersionDelivered.set(agent.id, getMembershipVersion(tid));
    return true;
  }
  const tid = agent.teamId || 'default';
  const curVer = getMembershipVersion(tid);
  const lastDelivered = lastTeamVersionDelivered.get(agent.id) || 0;
  if (lastDelivered < curVer) {
    lastTeamVersionDelivered.set(agent.id, curVer);
    return true;
  }
  // Nếu agent chưa từng nhận team context nào → inject lần đầu.
  if (!lastTeamVersionDelivered.has(agent.id)) {
    lastTeamVersionDelivered.set(agent.id, curVer);
    return true;
  }
  return false;
}

// Khối định dạng bắt buộc cho worker — dạy agent cách route tin nhắn.
const WORKER_FORMAT_BLOCK = `
=== RESPONSE FORMAT (MANDATORY) ===
End your reply with one or more routing lines, each on its own line:
<talk target="<target-id>">your message</talk>
(or [TO: <target-id>] <your message>)
- To report your result to the Main Orchestrator, you MUST end with: <talk target="orchestrator">Task complete. === TASK REPORT === ...</talk> (or [TO: orchestrator] <concise report>)
- To message another agent, use its exact ID from the Members list.
- NEVER spawn subagents. Only the Orchestrator spawns.
====================================`;

/** Truncate task về 1 dòng, tối đa 100 ký tự (khớp server.ts truncateTask). */
function truncateTask(task: string): string {
  return (task || '').split('\n')[0].replace(/^#+\s*/, '').trim().slice(0, 100);
}

/** Format task summary cho [TEAM] context (khớp server.ts formatAgentTasksSummary). */
function formatAgentTasksSummary(a: Agent): string {
  if (Array.isArray(a.tasks) && a.tasks.length > 0) {
    const taskStrs = a.tasks.map((t, idx) => {
      const num = (t as any).id || String(idx + 1);
      const status = (t as any).status || 'working';
      const tNorm = String((t as any).task || '').normalize('NFC').replace(/\s+/g, ' ').trim();
      const text = tNorm.length > 100 ? tNorm.slice(0, 97) + '...' : tNorm;
      return `#${num} [${status}] ${text}`;
    });
    return ` | Tasks: ${taskStrs.join('; ')}`;
  }
  const rawTask = a.task ? String(a.task).normalize('NFC').replace(/\s+/g, ' ').trim() : '';
  return rawTask ? ` | Task: ${rawTask.length > 100 ? rawTask.slice(0, 97) + '...' : rawTask}` : ' | Tasks: (Trống)';
}

/**
 * Xây dựng prompt block [TEAM] từ deps.agents, khớp logic server.ts buildTeam:
 * - Chỉ liệt kê agent cùng team với self (per-team isolation).
 * - Không liệt kê orchestrator trong danh sách members.
 * - Có role counts, list members, và worker format block khi cần.
 */
function buildTeam(deps: DispatchDeps, agent?: Agent, _shouldReinject?: boolean): string {
  const self = agent;
  const selfId = self?.id || '';
  const isOrchestrator = self?.type === 'orchestrator' || selfId === 'orchestrator' ||
    String(selfId || '').toLowerCase() === 'orchestrator' || self?.role === 'orchestrator';
  const selfTeamId = self?.teamId || 'default';

  const others = Array.from(deps.agents.values()).filter(a => {
    if (a.id === selfId) return false;
    if (a.id === 'orchestrator' || a.type === 'orchestrator') return false;
    if ((a.teamId || 'default') !== selfTeamId) return false;
    return true;
  });

  const suffix = isOrchestrator ? '' : WORKER_FORMAT_BLOCK;
  const lines: string[] = [];

  if (self) {
    lines.push(`Your ID: ${self.id}`);
    lines.push(`Your name: ${self.name}`);
    lines.push(`Your role: ${self.role}`);
    if (self.task) {
      const selfTask = String(self.task).normalize('NFC').replace(/\s+/g, ' ').trim();
      lines.push(`Your task: ${selfTask.length > 100 ? selfTask.slice(0, 97) + '...' : selfTask}`);
    }
    if (Array.isArray(self.tasks) && self.tasks.length > 0) {
      const taskStrs = self.tasks.map((t, idx) => {
        const num = (t as any).id || String(idx + 1);
        const status = (t as any).status || 'working';
        const tNorm = String((t as any).task || '').normalize('NFC').replace(/\s+/g, ' ').trim();
        const text = tNorm.length > 100 ? tNorm.slice(0, 97) + '...' : tNorm;
        return `#${num} [${status}] ${text}`;
      });
      lines.push(`Your tasks: ${taskStrs.join('; ')}`);
    } else {
      lines.push(`Your tasks: (Trống)`);
    }

    // Pair Context: Coder ↔ Verifier đồng hành (khớp server.ts)
    const roleLower = (self.role || '').toLowerCase();
    if (roleLower.includes('verif') || roleLower.includes('reviewer')) {
      const coders = others.filter(a => (a.role || '').toLowerCase().includes('coder') || (a.role || '').toLowerCase().includes('debug'));
      let partnerCoder = coders.find(c => self.task && (self.task.includes(c.id) || self.task.includes(c.name)));
      if (!partnerCoder && coders.length > 0) partnerCoder = coders[0];
      if (partnerCoder) {
        lines.push(`Your Partner (Coder): ${partnerCoder.name} (Role: ${partnerCoder.role}, ID: ${partnerCoder.id})`);
      }
    } else if (roleLower.includes('coder') || roleLower.includes('debug')) {
      const verifiers = others.filter(a => (a.role || '').toLowerCase().includes('verif'));
      let partnerVerifier = verifiers.find(v => self.task && (self.task.includes(v.id) || self.task.includes(v.name)));
      if (!partnerVerifier && verifiers.length > 0) partnerVerifier = verifiers[0];
      if (partnerVerifier) {
        lines.push(`Your Partner (Verifier): ${partnerVerifier.name} (Role: ${partnerVerifier.role}, ID: ${partnerVerifier.id})`);
      }
    }
  }

  if (others.length === 0) {
    lines.push(isOrchestrator ? 'No active agents.' : 'No other agents are currently active.');
    return (lines.join('\n') + (self?.sessionId ? '' : suffix)).normalize('NFC');
  }

  const roleCounts: Record<string, number> = {};
  others.forEach(a => { roleCounts[a.role] = (roleCounts[a.role] || 0) + 1; });
  lines.push(`\nActive Team: ${others.length} agents - ${Object.entries(roleCounts).map(([r, c]) => `${c}x ${r}`).join(', ')}`);
  lines.push('\nMembers:');
  others.forEach(a => {
    const wt = a.workingSince ? ` (${Math.round((Date.now() - a.workingSince) / 1000)}s working)` : '';
    const taskInfo = formatAgentTasksSummary(a);
    lines.push(`  - ${a.name} (${a.role}) [${a.status}]${taskInfo}${wt} | ID: ${a.id}`);
  });
  return (lines.join('\n') + (self?.sessionId ? '' : suffix)).normalize('NFC');
}

/**
 * Xử lý reply từ client (log/open-code) sau khi enqueue, không để stub:
 * - Ghi nhận reply vào chat history + storage.
 * - Broadcast qua WS cho UI.
 * - Nếu reply báo lỗi (error) → thử retry một lần qua enqueue, hoặc lưu unprocessed
 *   để lượt sau tự gộp, tránh mất tin nhắn người dùng.
 */
async function handleClientReply(
  client: any,
  reply: any,
  deps: DispatchDeps,
  targetKey: string,
  isSlashCommand: boolean,
  isRetry: boolean
): Promise<boolean> {
  try {
    // Extract nội dung trả về từ client (dạng string hoặc object có .content/.text)
    const content = typeof reply === 'string'
      ? reply
      : (reply && typeof (reply as any).content === 'string')
        ? (reply as any).content
        : (reply && typeof (reply as any).text === 'string')
          ? (reply as any).text
          : reply ? String(reply) : '';

    const hasError = !!(reply && ((reply as any).error || (reply as any).failed || (reply as any).errorMessage));

    // Broadcast reply thành nội dung agent tới user
    if (content && content.trim()) {
      const replyMsg: ChatMsg = createChatMsg(targetKey, targetKey, content.trim(), {
        agentName: deps.agents.get(targetKey)?.name || targetKey,
        agentRole: deps.agents.get(targetKey)?.role || 'worker'
      });
      deps.chatHistory.push(replyMsg);
      deps.storage.saveMessage(replyMsg);
      deps.broadcast('chat:message', { msg: replyMsg });
    }

    if (hasError) {
      // Xử lý lỗi: lưu unprocessed để lượt sau tự gộp, không mất yêu cầu.
      if (!isRetry && deps.storage.saveUnprocessedMessage) {
        try { deps.storage.saveUnprocessedMessage(targetKey, content || String((reply as any).error || 'Unknown error')); } catch {}
      }
      const errMsg = createChatMsg('system', targetKey,
        `⚠️ Agent ${targetKey} gửi phản hồi lỗi: ${content || String((reply as any).error || 'Unknown error')}`,
        { agentName: 'System', agentRole: 'system', msgType: 'error' });
      deps.chatHistory.push(errMsg);
      deps.storage.saveMessage(errMsg);
      deps.broadcast('chat:message', { msg: errMsg });
      return false;
    }

    return true;
  } catch (e) {
    console.error(`[Dispatch] handleClientReply error for ${targetKey}:`, e);
    return false;
  }
}
