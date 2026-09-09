import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dashboard } from './components/Dashboard';
import { ChatPanel } from './components/ChatPanel';
import { SpawnDialog } from './components/SpawnDialog';
import { ModelSettingsDialog } from './components/ModelSettingsDialog';
import { TeamSettingsDialog } from './components/TeamSettingsDialog';
import { smartRuleRegistry } from './utils/smartClarify';
import { TabBar } from './components/TabBar';
import { StartupModal } from './components/StartupModal';
import { FloatingBroadcastBar } from './components/FloatingBroadcastBar';
import { parseAgentTaskList, renderAgentTaskList, ParsedAgentTask } from './utils/taskUtils';

const API = window.location.port === '5173' ? '' : (window.location.origin.startsWith('http') ? window.location.origin : 'http://localhost:4001');

// ============ UNIFIED DEDUP HELPERS (re-apply coder-relay v7.0.55) ============
// Triệt tiêu duplicate user messages mọi nguồn: optimistic push, SSE echo,
// fetchHistory, force-send. Key chuẩn hoá bằng normText (NFC + lowercase +
// collapse whitespace, loại bỏ prefix trích dẫn copy: > 🕒 [hh:mm:ss] **You**:) + timeBucket 30s cho temp/stream ID.
const stripCopyPrefix = (s: any) => {
  if (!s || typeof s !== 'string') return '';
  return s.replace(/^>\s*(?:🕒\s*)?\[\d{1,2}:\d{2}(?::\d{2})?\]\s*(?:\*\*[^*]+\*\*|__[^_]+__|[^\n:]+):\s*\n*/iu, '').trim();
};
const normText = (s: any) => stripCopyPrefix(s).toLowerCase().normalize('NFC').replace(/[\r\n\s]+/g, ' ');
const timeBucket = (t: number | undefined, bucketMs = 30000) => Math.floor((Number(t) || Date.now()) / bucketMs);

const getMessageKey = (msg: any) => {
  if (msg?.id && !String(msg.id).startsWith('temp-') && !String(msg.id).startsWith('stream-')) {
    return `id:${msg.id}`;
  }
  const content = normText(msg?.content);
  if (!content) return `from:${msg?.from || 'unknown'}:empty`;
  return `${msg?.from || 'unknown'}:${content}:${timeBucket(msg?.timestamp)}`;
};

const mergeMessage = (prev: any[], incoming: any): any[] => {
  const incomingId = incoming?.id ? String(incoming.id) : '';
  const incomingTime = incoming?.timestamp || Date.now();
  const incomingFrom = incoming?.from || 'unknown';
  const incomingContent = normText(incoming?.content);

  // 1) Match chính xác theo ID (nếu ID không phải temp- hoặc nếu cùng ID)
  let existingIdx = prev.findIndex(p => {
    if (!p) return false;
    if (incomingId && p.id === incomingId) return true;
    return false;
  });

  // 2) Nếu là tin nhắn User hoặc tin nhắn trùng nội dung + người gửi gần nhau trong 120s (đặc biệt optimistic temp-* vs canonical id)
  // Cũng deduplicate tin nhắn lỗi (msgType === 'error' hoặc content chứa Connection error) nếu cùng lỗi xuất hiện liên tiếp trong 30s
  if (existingIdx === -1 && incomingContent) {
    existingIdx = prev.findIndex(p => {
      if (!p) return false;
      const pFrom = p.from || 'unknown';
      const pContent = normText(p.content);
      if (!pContent) return false;

      // Dedup lỗi (ví dụ Connection error hoặc ❌) trong vòng 30s kể cả khác id
      const isErrorMsg = (incoming?.msgType === 'error' || p.msgType === 'error') ||
                         incomingContent.includes('connection error') ||
                         pContent.includes('connection error');
      if (isErrorMsg && pContent === incomingContent) {
        const timeDiff = Math.abs((p.timestamp || 0) - incomingTime);
        if (timeDiff < 30000) return true;
      }

      if (pFrom !== incomingFrom) return false;
      if (pContent !== incomingContent) return false;
      // Nếu 1 trong 2 là temp-id và cùng nội dung, hoặc timestamp gần nhau trong 120s
      const pId = p.id ? String(p.id) : '';
      if (incomingId.startsWith('temp-') || pId.startsWith('temp-')) {
        return true;
      }
      const timeDiff = Math.abs((p.timestamp || 0) - incomingTime);
      return timeDiff < 120000;
    });
  }

  if (existingIdx !== -1) {
    const updated = [...prev];
    // Ưu tiên giữ ID canonical thực nếu incoming là ID server
    const targetId = (incomingId && !incomingId.startsWith('temp-')) ? incomingId : (updated[existingIdx].id || incomingId);
    updated[existingIdx] = {
      ...updated[existingIdx],
      ...incoming,
      id: targetId,
      timestamp: updated[existingIdx].timestamp || incomingTime
    };
    return updated;
  }
  return [...prev, incoming];
};
// ============ END UNIFIED DEDUP HELPERS ============

interface ChatMsg {
  id: string;
  from: string;
  to: string;
  content: string;
  task?: string;
  timestamp?: number;
  agentName?: string;
  agentRole?: string;
  msgType?: string;
  showOnUI?: boolean;
  toolCalls?: Array<{ tool: string; input?: string; output?: string }>;
  thinking?: string;
  // Ordered parts (Option C): text + tool xen kẽ theo ĐÚNG thứ tự opencode emit — server gửi trong final snapshot.
  // Client render trực tiếp theo array, không cần split content. OPTIONAL (không có → render theo cách cũ).
  parts?: Array<{ type: 'text' | 'tool'; content?: string; tool?: string; input?: string; output?: string }>;
  teamId?: string;
}

export interface TokenUsage {
  input?: number;
  output?: number;
  total?: number;
  contextLimit?: number;
}

interface Agent {
  id: string;
  name: string;
  role: string;
  type: string;
  status: string;
  task?: string;
  tasks?: Array<{ id?: string; task: string; status: string }>;
  spawnedBy?: string;
  sessionId?: string;
  sessionTitle?: string;
  model?: string;
  createdAt: number;
  workingSince?: number;
  tokenUsage?: TokenUsage | number;
  contextLength?: number;
  teamId?: string;
}

export function App() {
  const [agents, setAgents] = useState<Agent[]>(() => {
    // Cache nhẹ: hiện token/status ngay lập tức khi F5, chờ fetch mạng đè lên sau
    try {
      const raw = localStorage.getItem('af-agents-cache');
      const arr = raw ? JSON.parse(raw) : null;
      return Array.isArray(arr) ? (arr as Agent[]) : [];
    } catch {
      return [];
    }
  });
  const [allMessages, setAllMessages] = useState<ChatMsg[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showSpawn, setShowSpawn] = useState(false);
  const [spawnParentId, setSpawnParentId] = useState<string | null>(null);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [showTeamSettings, setShowTeamSettings] = useState(false);
  const [showStartupModal, setShowStartupModal] = useState(false);
  const [startupInitialSettings, setStartupInitialSettings] = useState<any>({});
  const [connected, setConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [disconnectedAt, setDisconnectedAt] = useState<number | null>(null);
  const [serverStartTime, setServerStartTime] = useState<number | null>(null);
  const [serverCwd, setServerCwd] = useState<string>('');
  const [serverVersion, setServerVersion] = useState<string>('');
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [, setStatusTick] = useState(0);

  // Tick mỗi giây (cả online lẫn offline) để uptime/offline duration cập nhật trực tiếp
  useEffect(() => {
    const t = setInterval(() => setStatusTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const formatElapsed = (ms: number): string => {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} phút`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} giờ`;
    return `${Math.floor(h / 24)} ngày`;
  };
  const offlineForText = connectionStatus === 'disconnected' && disconnectedAt ? formatElapsed(Date.now() - disconnectedAt) : '';
  // Ưu tiên uptime TỪ SERVER (serverStartTime); fallback về thời điểm connect cục bộ
  const uptimeText = connectionStatus === 'connected'
    ? (serverStartTime ? formatElapsed(Date.now() - serverStartTime) : '')
    : '';

  const fetchServerInfo = async () => {
    try {
      const res = await fetch(`${API}/api/server-info`);
      const data = await res.json();
      if (data && typeof data.serverStartTime === 'number') setServerStartTime(data.serverStartTime);
      if (data && typeof data.cwd === 'string') setServerCwd(data.cwd);
      if (data && typeof data.version === 'string') setServerVersion(data.version);
    } catch {}
  };
  const [loading, setLoading] = useState(false);
  const [agentQueues, setAgentQueues] = useState<Record<string, ChatMsg[]>>({});
  const lastSendAtRef = useRef(0);
  // In-flight per-target: agentId -> đang gửi queued message. Thay gate loading GLOBAL (theo tab hiện tại)
  // bằng check riêng theo agent đích của queue để tin queue không bị giữ lại khi chuyển tab.
  const inflightTargetRef = useRef<Record<string, boolean>>({});
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('agentforge_sidebar_width');
      return saved ? Math.max(220, Math.min(650, parseInt(saved, 10))) : 320;
    } catch {
      return 320;
    }
  });
  const [enableWatchdog, setEnableWatchdog] = useState(true);
  const [autoContinue, setAutoContinue] = useState(false);
  const [expandOpenCodeTools, setExpandOpenCodeTools] = useState(() => {
    try {
      const stored = localStorage.getItem('af-expandOpenCodeTools');
      if (stored !== null) return stored === 'true';
      // fallback migrate từ af-collapseToolCalls cũ nếu có
      const oldCollapse = localStorage.getItem('af-collapseToolCalls');
      return oldCollapse !== null ? oldCollapse !== 'true' : false;
    } catch { return false; }
  });
  // Setting cho directives (Talk, Spawn, Report...)
  const [defaultExpandToolcalls, setDefaultExpandToolcalls] = useState(false);
  // Setting mở rộng Thinking Block
  const [expandThinking, setExpandThinking] = useState(() => {
    try {
      return localStorage.getItem('af-expand-thinking') === 'true';
    } catch { return false; }
  });
  const [smartModeEnabled, setSmartModeEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem('af-smart-mode-master');
      return stored === 'true';
    } catch { return false; }
  });
  const wsRef = useRef<WebSocket | null>(null);
  // Bản đồ agentKey -> id tin nhắn stream đang chạy (chat:chunk / chat:tool_call)
  const streamRef = useRef<Record<string, string>>({});
  // Timestamp của chunk/event cuối cùng nhận được từ agentKey (để ngắt stream phân turn)
  const lastChunkAtRef = useRef<Record<string, number>>({});
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return localStorage.getItem('af-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  // Workbench (VS Code-like) layout state
  const [activeView, setActiveView] = useState<'agents' | 'files' | 'settings'>('agents');
  const [panelOpen, setPanelOpen] = useState(false);
  const [showWorkingPopover, setShowWorkingPopover] = useState(false);
  const [panelHeight, setPanelHeight] = useState<number>(() => {
    try {
      const v = parseInt(localStorage.getItem('agentforge_panel_height') || '', 10);
      return Number.isFinite(v) ? Math.max(120, Math.min(240, v)) : 160;
    } catch { return 160; }
  });
  const [activityLog, setActivityLog] = useState<{ id: string; agentId: string; name: string; status: string; ts: number }[]>([]);

  // Fix underbar 6.43: KHÔNG tự mở bottom panel khi hàng đợi/agent working.
  // Panel chỉ mở khi user CHỦ ĐỘNG toggle (nút "▸/▾ Hoạt động & Hàng đợi" ở status bar).
  // Trước đây effect này tự setPanelOpen(true) khi queue 0->>0 → đẩy/bóp khung chat khó chịu.

  // Áp theme lên <html data-theme> + lưu lựa chọn (reload giữ nguyên)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('af-theme', theme); } catch {}
  }, [theme]);


  // Spinner khớp trạng thái agent đích — debounce 700ms sau khi gửi để tránh flicker
  useEffect(() => {
    const defaultOrch = agents.find(a => a.type === 'orchestrator' || a.role === 'orchestrator' || a.id === 'orchestrator');
    const tid = selectedAgentId || defaultOrch?.id || 'orchestrator';
    const cur = agents.find(a => a.id === tid || (tid === 'orchestrator' && (a.type === 'orchestrator' || a.role === 'orchestrator')));
    const serverBusy = cur ? cur.status === 'working' : false;
    if (serverBusy) setLoading(true);
    else {
      if (Date.now() - lastSendAtRef.current < 700) return;
      setLoading(false);
    }
  }, [agents, selectedAgentId]);

  // Mount: fetch NGAY khi mở trang — không chờ WS/SSE bắt tay xong mới có token
  useEffect(() => {
    fetchAgents();
    fetchServerInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phát hiện màn hình điện thoại (<768px) để chuyển sidebar thành drawer
  useEffect(() => {
    const onResize = () => {
      const m = window.innerWidth < 768;
      setIsMobile(m);
      if (!m) setSidebarOpen(false);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const MAX_DISPLAY_MESSAGES = 1000;
  // Chỉ tải N tin nhắn mới nhất lúc khởi động → payload nhỏ, render nhanh
  const HISTORY_FETCH_LIMIT = 500;

  // Fetch settings
  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API}/api/settings`);
      if (res.ok) {
        const data = await res.json();
        if (typeof data.enableWatchdog === 'boolean') setEnableWatchdog(data.enableWatchdog);
        if (typeof data.autoContinue === 'boolean') setAutoContinue(data.autoContinue);
        if (typeof data.smartClarifyEnabled === 'boolean') setSmartModeEnabled(data.smartClarifyEnabled);
        
        // Kiểm tra xem hệ thống đã được start chưa (hoặc người dùng đã chọn bỏ qua modal)
        const skipStartup = localStorage.getItem('af-skip-startup-modal') === 'true';
        if (!data.isSystemStarted && !skipStartup) {
          setStartupInitialSettings({
            engineMode: data.engineMode || 'attach',
            enableWatchdog: data.enableWatchdog ?? true,
            autoContinue: data.autoContinue ?? true,
            smartClarifyEnabled: data.smartClarifyEnabled ?? false,
            watchdogStreamTimeoutSec: data.watchdogStreamTimeoutSec || 45,
            taskQueueIdleCheckSec: data.taskQueueIdleCheckSec || 30
          });
          setShowStartupModal(true);
        }
      }
    } catch (e) {
      console.error('Failed to fetch general settings:', e);
    }
    try {
      const res = await fetch(`${API}/api/settings/watchdog`);
      const data = await res.json();
      if (typeof data.enableWatchdog === 'boolean') {
        setEnableWatchdog(data.enableWatchdog);
      }
    } catch (e) {
      console.error('Failed to fetch watchdog settings:', e);
    }
    try {
      const res2 = await fetch(`${API}/api/settings/autoContinue`);
      const data2 = await res2.json();
      if (typeof data2.autoContinue === 'boolean') {
        setAutoContinue(data2.autoContinue);
      }
    } catch (e) {
      console.error('Failed to fetch autoContinue settings:', e);
    }
    try {
      const res3 = await fetch(`${API}/api/settings/defaultExpandToolcalls`);
      const data3 = await res3.json();
      if (typeof data3.defaultExpandToolcalls === 'boolean') {
        setDefaultExpandToolcalls(data3.defaultExpandToolcalls);
      }
    } catch (e) {
      console.error('Failed to fetch defaultExpandToolcalls settings:', e);
    }
  };

  const toggleWatchdog = async (enabled: boolean) => {
    setEnableWatchdog(enabled);
    try {
      await fetch(`${API}/api/settings/watchdog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enableWatchdog: enabled })
      });
    } catch (e) {
      console.error('Failed to update watchdog settings:', e);
    }
  };

  const toggleAutoContinue = async (enabled: boolean) => {
    setAutoContinue(enabled);
    try {
      await fetch(`${API}/api/settings/autoContinue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoContinue: enabled })
      });
    } catch (e) {
      console.error('Failed to update autoContinue settings:', e);
    }
  };

  const toggleDefaultExpandToolcalls = async (enabled: boolean) => {
    setDefaultExpandToolcalls(enabled);
    try {
      await fetch(`${API}/api/settings/defaultExpandToolcalls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultExpandToolcalls: enabled })
      });
    } catch (e) {
      console.error('Failed to update defaultExpandToolcalls settings:', e);
    }
  };

  const toggleExpandThinking = (expand: boolean) => {
    setExpandThinking(expand);
    try {
      localStorage.setItem('af-expand-thinking', String(expand));
    } catch (e) {
      console.error('Failed to persist expandThinking setting:', e);
    }
  };

  const toggleExpandOpenCodeTools = async (expand: boolean) => {
    setExpandOpenCodeTools(expand);
    try {
      localStorage.setItem('af-expandOpenCodeTools', String(expand));
    } catch (e) {
      console.error('Failed to persist expandOpenCodeTools setting:', e);
    }
  };

  const toggleSmartMode = async (enabled: boolean) => {
    setSmartModeEnabled(enabled);
    smartRuleRegistry.setMasterEnabled(enabled);
    try {
      await fetch(`${API}/api/settings/smartClarify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smartClarifyEnabled: enabled, smartClarifyTimeoutSec: 30 })
      });
    } catch (e) {
      console.error('Failed to update smart clarify setting:', e);
    }
  };

  // Cập nhật agents + ghi cache localStorage (hiện tức thì ở lần mở sau)
  const applyAgents = (data: Agent[]) => {
    setAgents(data);
    try { localStorage.setItem('af-agents-cache', JSON.stringify(data)); } catch {}
  };

  // Fetch agents
  const fetchAgents = async () => {
    try {
      const res = await fetch(`${API}/api/agents`);
      const data = await res.json();
      if (Array.isArray(data)) {
        applyAgents(data);
      }
    } catch (e) {
      console.error('Failed to fetch agents:', e);
    }
  };

  // Fetch history from DB — merge (not overwrite) to avoid race with WS messages arriving during fetch
  const fetchHistory = async (agentId?: string | null) => {
    try {
      // Truyền teamId tường minh (backend ép team isolation — không còn fallback 'default' ngầm):
      // - Có agentId → backend tự resolve teamId theo agent.
      // - Không agentId (main view) → gửi đúng teamId của main orchestrator (defaultOrch?.teamId || 'default').
      const mainOrch = agents.find(a => a.type === 'orchestrator' || a.role === 'orchestrator' || a.id === 'orchestrator');
      const mainTeamId = mainOrch?.teamId || 'default';
      const targetParam = agentId
        ? `&agentId=${encodeURIComponent(agentId)}`
        : `&teamId=${encodeURIComponent(mainTeamId)}`;
      const res = await fetch(`${API}/api/history?limit=${HISTORY_FETCH_LIMIT}${targetParam}`);
      const data: ChatMsg[] = await res.json();
      if (!Array.isArray(data)) return;
      setAllMessages(prev => {
        if (prev.length === 0) return data.slice(-MAX_DISPLAY_MESSAGES);
        let merged = [...prev];
        for (const m of data) {
          merged = mergeMessage(merged, m);
        }
        const sorted = merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        return sorted.slice(-MAX_DISPLAY_MESSAGES);
      });
    } catch (e) {
      console.error('Failed to fetch history:', e);
    }
  };

  // Tạo/lấy tin nhắn stream của 1 agent rồi mutate nội dung (dùng cho chat:chunk / chat:tool_call / chat:thinking)
  const upsertStreamMsg = (key: string, mut: (m: ChatMsg) => ChatMsg, teamId?: string, isNewTurn?: boolean, customMsgId?: string) => {
    const now = Date.now();
    const lastActive = lastChunkAtRef.current[key] || 0;
    // Tự động phân tách turn stream mới nếu server gắn cờ isNewTurn hoặc gián đoạn > 10 giây
    if (isNewTurn || (lastActive > 0 && now - lastActive > 10000)) {
      delete streamRef.current[key];
    }
    lastChunkAtRef.current[key] = now;

    setAllMessages(prev => {
      let sid = customMsgId || streamRef.current[key];
      let list = prev;
      const existing = sid ? prev.find(p => p.id === sid) : undefined;

      if (!existing) {
        sid = sid || `stream-${key}-${Date.now()}`;
        streamRef.current[key] = sid;
        const targetAgent = agents.find(a => a.id === key || a.name === key);
        const agentRole = targetAgent?.role || targetAgent?.type || (key === 'orchestrator' ? 'orchestrator' : undefined);
        const agentTeamId = teamId || targetAgent?.teamId || (key === 'orchestrator' ? 'default' : `team-${key.slice(-8)}`);

        // Áp dụng mutation lên message tạm để kiểm tra nội dung THỰC trước khi tạo bubble
        const tempMsg: ChatMsg = {
          id: sid,
          from: key,
          to: 'user',
          content: '',
          timestamp: Date.now(),
          teamId: agentTeamId,
          agentRole,
          isStreaming: true
        };
        const mutated = { ...mut(tempMsg), isStreaming: true };
        const hasRealContent =
          (typeof mutated.content === 'string' && mutated.content.trim().length > 0) ||
          (Array.isArray(mutated.parts) && mutated.parts.some((p: any) => p && typeof p.content === 'string' && p.content.trim().length > 0)) ||
          (typeof mutated.thinking === 'string' && mutated.thinking.trim().length > 0) ||
          (Array.isArray(mutated.toolCalls) && mutated.toolCalls.length > 0);

        if (!hasRealContent) {
          // Không tạo bubble rỗng khi stream chưa có chữ/tool/thinking thực
          return prev;
        }

        list = [...prev, mutated];
      } else {
        if (sid) streamRef.current[key] = sid;
        return list.map(m => m.id === sid ? mut(m) : m);
      }

      return list;
    });
  };

  // Handle realtime events from WS or SSE
  const handleRealtimeEvent = useCallback((msg: any) => {
    if (!msg || typeof msg !== 'object') return;

    // Khi backend xả queue và gửi thực sự đến OpenCode: dứt khoát xóa khỏi UI queue của agent tương ứng
    if (msg.type === 'chat:queue:dispatched' && msg.targetAgentId) {
      const key = String(msg.targetAgentId);
      const isOrch = key === 'orchestrator' || agents.some(a => a.id === key && (a.role === 'orchestrator' || a.type === 'orchestrator'));
      const targetKeys = isOrch ? Array.from(new Set([key, 'orchestrator'])) : [key];
      const msgIds = Array.isArray(msg.messageIds) ? new Set(msg.messageIds.map(String)) : null;

      setAgentQueues(prev => {
        const updated = { ...prev };
        let hasChanges = false;

        targetKeys.forEach(tKey => {
          const q = prev[tKey];
          if (!q || q.length === 0) return;
          hasChanges = true;
          if (!msgIds || msgIds.size === 0) {
            delete updated[tKey];
          } else {
            // Lọc theo id trước; nếu không khớp id do lệch temp-id thì kiểm tra khớp content
            let remaining = q.filter(item => !msgIds.has(String(item.id)) && !msgIds.has(String(item.messageId)));
            // Fallback: nếu sau khi lọc ID mà độ dài queue không đổi, hoặc số tin dispatch bằng tổng queue, clear sạch để tránh kẹt temp ID cũ
            if (remaining.length === q.length && msgIds.size >= q.length) {
              delete updated[tKey];
            } else {
              if (remaining.length === 0) delete updated[tKey];
              else updated[tKey] = remaining;
            }
          }
        });

        return hasChanges ? updated : prev;
      });

      // Gỡ bỏ tag [QUEUED] trên bubble user nếu có
      setAllMessages(prev => prev.map(m => {
        const isMsgTarget = targetKeys.includes(String(m.to));
        if (m.from === 'user' && isMsgTarget && (m.isQueued || (typeof m.content === 'string' && m.content.startsWith('[QUEUED]')))) {
          if (!msgIds || msgIds.has(String(m.id)) || (msgIds.size > 0 && (!m.id || String(m.id).startsWith('temp-')))) {
            return {
              ...m,
              isQueued: false,
              content: typeof m.content === 'string' ? m.content.replace(/^\[QUEUED\]\s*/, '') : m.content
            };
          }
        }
        return m;
      }));
    }

    // Safety: Khi nhận chat:message trùng ID hoặc content nằm trong agentQueues, xóa khỏi queue luôn
    // (đảm bảo khi server auto-drain sau STOP gửi chat:message mà không có chat:queue:dispatched)
    if (msg.type === 'chat:message' && msg.msg) {
      const m = msg.msg;
      if (m.from === 'user' && (m.id || m.content)) {
        const rawKey = String(m.to || 'orchestrator');
        const isOrch = rawKey === 'orchestrator' || agents.some(a => a.id === rawKey && (a.role === 'orchestrator' || a.type === 'orchestrator'));
        const checkKeys = isOrch ? Array.from(new Set([rawKey, 'orchestrator'])) : [rawKey];

        setAgentQueues(prev => {
          const updated = { ...prev };
          let changed = false;

          checkKeys.forEach(tKey => {
            const q = prev[tKey];
            if (!q || q.length === 0) return;
            const remaining = q.filter(item => {
              const idMatch = m.id && (item.id === m.id || item.messageId === m.id);
              const contentMatch = m.content && item.content === m.content && (item.to === m.to || (isOrch && (item.to === 'orchestrator' || !item.to)));
              return !idMatch && !contentMatch;
            });

            if (remaining.length !== q.length) {
              changed = true;
              if (remaining.length === 0) delete updated[tKey];
              else updated[tKey] = remaining;
            }
          });

          return changed ? updated : prev;
        });
      }
    }

    // Stream chữ chạy trực tuyến: chat:chunk { agentId?, from?, textDelta }
    if (msg.type === 'chat:chunk' && typeof msg.textDelta === 'string') {
      const key = String(msg.agentId || msg.from || 'orchestrator');
      // Gỡ bỏ tag [QUEUED] trên bubble user nếu có
      setAllMessages(prev => {
        const idx = prev.findIndex(m => m.from === 'user' && m.to === key && (m.isQueued || (typeof m.content === 'string' && m.content.startsWith('[QUEUED]'))));
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          isQueued: false,
          content: typeof next[idx].content === 'string' ? next[idx].content.replace(/^\[QUEUED\]\s*/, '') : next[idx].content
        };
        return next;
      });
      const delta = msg.textDelta;
      const turnMsgId = msg.msgId || msg.id;
      upsertStreamMsg(key, m => {
        const newParts = [...(m.parts || [])];
        const lastPart = newParts.length > 0 ? newParts[newParts.length - 1] : null;
        if (lastPart && (lastPart as any).type === 'text') {
          newParts[newParts.length - 1] = {
            ...lastPart,
            content: ((lastPart as any).content || '') + delta
          } as any;
        } else {
          newParts.push({ type: 'text' as any, content: delta });
        }
        return {
          ...m,
          ...(turnMsgId ? { id: turnMsgId } : {}),
          content: (m.content || '') + delta,
          parts: newParts
        };
      }, msg.teamId, msg.isNewTurn, turnMsgId);
    }

    // Thinking realtime: chat:thinking { agentId?, from?, thinkingText } — hiện hộp thinking live
    // trong CÙNG message stream với text (cùng key) để thinking tới TRƯỚC khi text chạy, không
    // chờ snapshot cuối (fix: text tới trước, thinking tới sau dù model reasoning trước).
    // Option A: push thinking vào parts xen kẽ đúng thứ tự emit (gộp consecutive thinking).
    if (msg.type === 'chat:thinking' && typeof msg.thinkingText === 'string' && msg.thinkingText.trim()) {
      const key = String(msg.agentId || msg.from || 'orchestrator');
      // Khi có event thinking stream từ server, tiến trình đã bắt đầu chạy -> giải phóng tin nhắn khỏi UI queue
      setAgentQueues(prev => {
        const q = prev[key];
        if (!q || q.length === 0) return prev;
        const updated = { ...prev };
        delete updated[key];
        return updated;
      });
      // Gỡ bỏ tag [QUEUED] trên bubble user nếu có
      setAllMessages(prev => {
        const idx = prev.findIndex(m => m.from === 'user' && m.to === key && (m.isQueued || (typeof m.content === 'string' && m.content.startsWith('[QUEUED]'))));
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          isQueued: false,
          content: typeof next[idx].content === 'string' ? next[idx].content.replace(/^\[QUEUED\]\s*/, '') : next[idx].content
        };
        return next;
      });
      const thinkingDelta = msg.thinkingText;
      const turnMsgId = msg.msgId || msg.id;
      upsertStreamMsg(key, m => {
        const newParts = [...(m.parts || [])];
        const lastPart = newParts.length > 0 ? newParts[newParts.length - 1] : null;
        if (lastPart && (lastPart as any).type === 'thinking') {
          // Merge consecutive thinking parts: concatenate content
          newParts[newParts.length - 1] = {
            ...lastPart,
            content: ((lastPart as any).content || '') + '\n' + thinkingDelta
          } as any;
        } else {
          // Push new thinking part
          newParts.push({ type: 'thinking' as any, content: thinkingDelta });
        }
        return {
          ...m,
          ...(turnMsgId ? { id: turnMsgId } : {}),
          thinking: (m.thinking ? m.thinking + '\n' : '') + thinkingDelta,
          parts: newParts
        };
      }, msg.teamId, msg.isNewTurn, turnMsgId);
    }

    // Tool call realtime: chat:tool_call { agentId?, toolCall? | tool/input/output }
    if (msg.type === 'chat:tool_call') {
      const tcRaw = msg.toolCall ?? msg.tool_call ?? {};
      const key = String(msg.agentId || msg.from || 'orchestrator');
      const callId = tcRaw.callId || tcRaw.id || msg.callId;
      const toolName = String(tcRaw.tool ?? msg.tool ?? 'tool');
      const input = tcRaw.input ?? msg.input;
      const output = tcRaw.output ?? msg.output;

      const tc = {
        tool: toolName,
        input,
        output,
        ...(callId ? { callId } : {})
      };

      const turnMsgId = msg.msgId || msg.id;
      upsertStreamMsg(key, m => {
        const existingList = Array.isArray(m.toolCalls) ? [...m.toolCalls] : [];
        // Tìm xem toolcall này đã có chưa (theo callId hoặc match toolName đang chờ output)
        const matchIdx = callId
          ? existingList.findIndex((x: any) => x.callId === callId)
          : existingList.findLastIndex((x: any) => x.tool === toolName && !x.output && output);

        if (matchIdx !== -1) {
          // Đã có: Cập nhật output/input thay vì thêm mới
          existingList[matchIdx] = {
            ...existingList[matchIdx],
            input: input !== undefined ? input : existingList[matchIdx].input,
            output: output !== undefined ? output : existingList[matchIdx].output
          };
        } else {
          existingList.push(tc);
        }

        // Cập nhật tương tự cho m.parts
        const existingParts = Array.isArray(m.parts) ? [...m.parts] : [];
        const partMatchIdx = callId
          ? existingParts.findIndex((p: any) => p && p.type === 'tool' && p.callId === callId)
          : existingParts.findLastIndex((p: any) => p && p.type === 'tool' && p.tool === toolName && !p.output && output);

        if (partMatchIdx !== -1) {
          existingParts[partMatchIdx] = {
            ...existingParts[partMatchIdx],
            input: input !== undefined ? input : existingParts[partMatchIdx].input,
            output: output !== undefined ? output : existingParts[partMatchIdx].output
          };
        } else {
          existingParts.push({ type: 'tool', tool: tc.tool, input: tc.input, output: tc.output, ...(callId ? { callId } : {}) });
        }

        return {
          ...m,
          ...(turnMsgId ? { id: turnMsgId } : {}),
          toolCalls: existingList,
          parts: existingParts
        };
      }, msg.teamId, false, turnMsgId);
    }

    // Chấp nhận nhiều tên sự kiện: chat:message (chuẩn server), message:new / message (tương thích)
    if (
      (msg.type === 'chat:message' || msg.type === 'message:new' || msg.type === 'message') &&
      (msg.msg || msg.message)
    ) {
      const m = msg.msg || msg.message;
       console.log('received chat:message content:', m.content);
      const fkey = String(m.from || '');
      let mergedIntoStream = false;
      let staleThinking: string | undefined;
      let staleParts: any[] | undefined;
      // Single Stream-Message Flow: Bất kể tin chứa directive hay text thường,
      // nếu caller đang có stream active thì LUÔN merge/finalize trực tiếp vào streamRef đó hoặc match theo m.id.
      const staleId = (fkey && streamRef.current[fkey]) ? streamRef.current[fkey] : undefined;
      const hasExistingMsg = allMessages.some(x => x.id === m.id || (staleId && x.id === staleId));
      if (staleId || hasExistingMsg) {
        if (fkey) delete streamRef.current[fkey];
        mergedIntoStream = true;
        setAllMessages(prev => prev.map(x => {
          if (x.id !== staleId && x.id !== m.id) return x;
          return {
            ...x,
            id: m.id,
            from: m.from || x.from,
            to: m.to || x.to,
            content: (m.content && m.content.trim()) ? m.content : x.content,
            timestamp: m.timestamp || x.timestamp || Date.now(),
            agentName: m.agentName || x.agentName,
            agentRole: m.agentRole || x.agentRole,
            msgType: m.msgType || x.msgType,
            isStreaming: false,
            toolCalls: (m.toolCalls && m.toolCalls.length) ? m.toolCalls : x.toolCalls,
            thinking: m.thinking || x.thinking,
            parts: (m.parts && m.parts.length) ? m.parts : x.parts,
            teamId: m.teamId || x.teamId,
            task: (m as any).task || (x as any).task,
            showOnUI: (m as any).showOnUI !== undefined ? (m as any).showOnUI : (x as any).showOnUI
          };
        }));
      }
      if (!mergedIntoStream) {
        // Tự động giải phóng streamRef khi nhận tin canonical không merge (tránh stale stream cho turn sau)
        if (fkey) {
          delete streamRef.current[fkey];
        }
        setAllMessages(prev => {
          return mergeMessage(prev, m);
        });
      }
      // Ghi nhận mốc thời gian tin nhắn mới (kể cả agent phản hồi hay user) để đồng hồ tính đúng khoảng cách
      smartRuleRegistry.recordMessageActivity();
      // KHÔNG tắt spinner vì tin trung gian; chỉ lỗi mới tắt (spinner do agent status điều phối)
      if (m.msgType === 'error' || m.from === 'error') {
        setLoading(false);
      }
    }

    if (msg.type === 'chat:message' && msg.action === 'clear') {
      const clearedId = msg.agentId || 'orchestrator';
      setAllMessages(prev => prev.filter(m => m.from !== clearedId && m.to !== clearedId));
      fetchHistory();
    }

    if (msg.type === 'settings:updated' && typeof msg.enableWatchdog === 'boolean') {
      setEnableWatchdog(msg.enableWatchdog);
    }

    if (msg.type === 'settings:updated' && typeof msg.autoContinue === 'boolean') {
      setAutoContinue(msg.autoContinue);
    }

if (msg.type === 'settings:updated' && typeof msg.defaultExpandToolcalls === 'boolean') {
       setDefaultExpandToolcalls(msg.defaultExpandToolcalls);
     }

     if (msg.type === 'settings:updated' && typeof msg.smartClarifyEnabled === 'boolean') {
       setSmartModeEnabled(msg.smartClarifyEnabled);
       smartRuleRegistry.setMasterEnabled(msg.smartClarifyEnabled);
     }

     if (msg.type === 'settings:updated' && typeof msg.smartClarifyPromptTemplate === 'string') {
       smartRuleRegistry.setPromptTemplate(msg.smartClarifyPromptTemplate);
     }

    if (msg.type === 'agent:created' || msg.type === 'agent:updated' || msg.type === 'agent:deleted') {
      if (msg.type === 'agent:deleted') {
        const deletedId = msg.id || msg.agentId;
        if (deletedId) {
          setAgents(prev => prev.filter(a => a.id !== deletedId));
          // Agent bị xoá: dọn cờ in-flight để queue không bị kẹt vĩnh viễn bởi flag của agent đã mất
          delete inflightTargetRef.current[deletedId];
          if (selectedAgentId === deletedId) {
            setSelectedAgentId(null);
          }
        }
      }
      if (msg.agent) {
        const ag = msg.agent;
        const defaultOrch = agents.find(a => a.type === 'orchestrator' || a.role === 'orchestrator' || a.id === 'orchestrator');
        const currentTarget = selectedAgentId || defaultOrch?.id || 'orchestrator';
        // Khi agent đích không còn working → xoá cờ in-flight để drain tin queue kế tiếp (nếu có).
        // Điều này cho phép tuple 2+ tin tới CÙNG agent vẫn được gửi tuần tự, không bị kẹt bởi 
        // cờ in-flight còn nguyên của lần gửi trước.
        if (ag.status !== 'working') {
          delete inflightTargetRef.current[ag.id];
          // Giải phóng streamRef dứt điểm khi agent chuyển trạng thái không còn working (idle/stopped/error)
          delete streamRef.current[ag.id];
          if (ag.name) delete streamRef.current[ag.name];
          const isOrch = ag.id === 'orchestrator' || ag.role === 'orchestrator' || ag.type === 'orchestrator';
          if (isOrch) {
            delete streamRef.current['orchestrator'];
            delete inflightTargetRef.current['orchestrator'];
          }
          // Dọn dẹp khay hàng đợi (agentQueues) để tránh tin queue bị kẹt khi agent stopped/idle
          setAgentQueues(prev => {
            const key = ag.id;
            const updated = { ...prev };
            let hasDel = false;
            if (updated[key]) {
              delete updated[key];
              hasDel = true;
            }
            if (isOrch && updated['orchestrator']) {
              delete updated['orchestrator'];
              hasDel = true;
            }
            return hasDel ? updated : prev;
          });
        }
        // Sync 2 chiều: spinner BẬT khi working, TẮT khi idle/error/stopped
        const isTargetMatch = ag.id === currentTarget || (!selectedAgentId && (ag.type === 'orchestrator' || ag.role === 'orchestrator'));
        if (isTargetMatch) {
          setLoading(ag.status === 'working');
        }
        // Ghi activity log cho bottom panel (giữ ~200 dòng gần nhất)
        if (ag.id && ag.name) {
          const entry = { id: `${Date.now()}-${ag.id}`, agentId: ag.id, name: ag.name, status: ag.status, ts: Date.now() };
          setActivityLog(prev => [...prev.slice(-199), entry]);
        }
      }
      fetchAgents();
    }
  }, [selectedAgentId]);

  // Giữ handler mới nhất trong ref để effect realtime KHÔNG phụ thuộc selectedAgentId:
  // trước đây mỗi lần đổi tab agent là WS ngắt/kết nối lại -> tin gửi trong khoảng đó bị mất.
  const handleRealtimeEventRef = useRef(handleRealtimeEvent);
  useEffect(() => { handleRealtimeEventRef.current = handleRealtimeEvent; }, [handleRealtimeEvent]);

  // Realtime transport: WebSocket with SSE fallback
  useEffect(() => {
    let ws: WebSocket | null = null;
    let es: EventSource | null = null;
    let reconnectTimer: number;
    let reconnectAttempts = 0;
    let isCleanedUp = false;

    const connectSSE = () => {
      if (isCleanedUp || es) return;
      try {
        es = new EventSource(`${API}/api/events`);
        es.onopen = () => {
          setConnected(true);
          setConnectionStatus('connected');
          setConnectedAt(Date.now());
          setDisconnectedAt(null); // xóa timing offline cũ
          fetchServerInfo(); // nạp lại serverStartTime mới sau reconnect
          fetchAgents();
          fetchHistory();
          fetchSettings();
        };
        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            handleRealtimeEventRef.current(data);
          } catch {}
        };
        es.onerror = () => {
          setConnectionStatus('disconnected');
          setDisconnectedAt(Date.now());
          if (es) {
            es.close();
            es = null;
          }
        };
      } catch {}
    };

    const connectWS = () => {
      if (isCleanedUp) return;
      try {
        const wsHost = window.location.port === '5173' ? 'localhost:4001' : window.location.host;
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${wsHost}`;
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          setConnectionStatus('connected');
          setConnectedAt(Date.now());
          setDisconnectedAt(null); // xóa timing offline cũ
          fetchServerInfo(); // nạp lại serverStartTime mới sau reconnect
          reconnectAttempts = 0;
          fetchAgents();
          fetchHistory();
          fetchSettings();
          if (es) {
            es.close();
            es = null;
          }
        };

        ws.onclose = () => {
          setConnected(false);
          setConnectionStatus('disconnected');
          setDisconnectedAt(Date.now());
          connectSSE();
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          reconnectAttempts += 1;
          reconnectTimer = window.setTimeout(connectWS, delay);
        };

        ws.onerror = () => {
          setConnected(false);
          setConnectionStatus('disconnected');
          setDisconnectedAt(Date.now());
          connectSSE();
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            handleRealtimeEventRef.current(msg);
          } catch (e) {
            console.error('WS parse error:', e);
          }
        };
      } catch {
        connectSSE();
      }
    };

    connectWS();

    // An toàn kép: quay lại tab / mạng trở lại / mobile resume từ sleep -> kéo lịch sử mới nhất
    // và kiểm tra nếu WebSocket đã bị ngắt ngầm trên điện thoại thì tự chủ động kết nối lại
    const safeRefresh = () => {
      try {
        fetchAgents();
        fetchHistory();
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          connectWS();
        }
      } catch {}
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        safeRefresh();
      }
    };

    window.addEventListener('focus', safeRefresh);
    window.addEventListener('online', safeRefresh);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isCleanedUp = true;
      clearTimeout(reconnectTimer);
      window.removeEventListener('focus', safeRefresh);
      window.removeEventListener('online', safeRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (ws) ws.close();
      if (es) es.close();
    };
  }, []);

  // Send queued message helper (actual network)
  const sendQueuedMessage = async (qmsg: ChatMsg) => {
    lastSendAtRef.current = Date.now();
    setAllMessages(prev => mergeMessage(prev, qmsg));
    setLoading(true);
    const targetId = qmsg.to || 'orchestrator';
    // Đánh dấu agent đích đang có 1 queued message in-flight
    inflightTargetRef.current[targetId] = true;
    const done = () => { delete inflightTargetRef.current[targetId]; };
    try {
      const body: any = { message: (qmsg.content || '').normalize('NFC') };
      if (targetId !== 'orchestrator') body.targetAgentId = targetId;
      await fetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      // Control Plane: HTTP chỉ làm nhiệm vụ trigger gửi lệnh
      // Toàn bộ tin phản hồi, luồng stream và tin nhắn lỗi đều đi qua kênh WebSocket
      setLoading(false);
      done();
    } catch (e: any) {
      console.error('[sendQueuedMessage] Network error:', e);
      setLoading(false);
      done();
    }
  };

  // Helper thêm tin vào hàng đợi riêng của từng agent
  const enqueueMessage = useCallback((targetId: string, msg: ChatMsg) => {
    setAgentQueues(prev => ({
      ...prev,
      [targetId]: [...(prev[targetId] || []), msg]
    }));
  }, []);

  // Xả gộp và gửi hàng đợi cho riêng 1 Agent
  const flushQueueForAgent = useCallback((targetId: string) => {
    setAgentQueues(prev => {
      const queue = prev[targetId] || [];
      if (queue.length === 0) return prev;
      const combined = queue.length === 1 ? queue[0].content : queue.map((m, i) => `[Message ${i + 1}]:\n${m.content}`).join('\n\n---\n\n');
      const batchMsg: ChatMsg = {
        id: `temp-batch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        from: 'user',
        to: targetId,
        content: combined,
        timestamp: Date.now()
      };
      sendQueuedMessage(batchMsg);
      const updated = { ...prev };
      delete updated[targetId];
      return updated;
    });
  }, []);

  // Xóa riêng hàng đợi của 1 Agent
  const clearQueueForAgent = useCallback((targetId: string) => {
    setAgentQueues(prev => {
      const updated = { ...prev };
      delete updated[targetId];
      return updated;
    });
  }, []);

  // Xóa toàn bộ hàng đợi của tất cả agents
  const clearAllQueues = useCallback(() => {
    setAgentQueues({});
  }, []);

  // Send message
  const sendMessage = async (text: string) => {
    const trimmedText = (text || '').trim().normalize('NFC');
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const targetId = selectedAgentId || 'orchestrator';

    // Reset stream cũ để không bao giờ bị merge lộn ngược vào turn trước
    delete streamRef.current[targetId];
    delete streamRef.current['orchestrator'];

    const targetAgentObj = agents.find(a => a.id === targetId) || (targetId === 'orchestrator' ? agents.find(a => a.type === 'orchestrator' || a.role === 'orchestrator' || a.id === 'orchestrator') : undefined);
    const targetTeamId = targetAgentObj?.teamId || (targetId === 'orchestrator' ? 'default' : `team-${targetId.slice(-8)}`);
    const resolvedTargetId = targetAgentObj?.id || targetId;
    // Xử lý qua Smart Rules Engine (Inactivity Clarify sau 30s timeout)
    const smartProcessed = smartRuleRegistry.processMessage(trimmedText, resolvedTargetId);
    const textToSend = smartProcessed.text;
    // Cập nhật đồng hồ hoạt động mới nhất cho Smart Clarify
    smartRuleRegistry.recordMessageActivity();

    const userMsg: ChatMsg = {
      id: tempId,
      from: 'user',
      to: resolvedTargetId,
      content: trimmedText,
      timestamp: Date.now(),
      teamId: targetTeamId
    };
    
    // Streamline Queue: Luôn gửi thẳng request POST /api/chat lên server ngay lập tức
    // Không chặn bởi state React (isTargetBusy / hasPendingQueue / inflightTargetRef)
    // Hiển thị ngay lập tức tin nhắn của User lên UI (Optimistic update)
    lastSendAtRef.current = Date.now();
    setAllMessages(prev => mergeMessage(prev, userMsg));

    setLoading(true);

    try {
      const body: any = { message: textToSend, teamId: targetTeamId, messageId: userMsg.id };
      if (selectedAgentId) body.targetAgentId = selectedAgentId;

      // 1. Phán đoán lạc quan: Nếu agent đích hiện tại đang bận (status === 'working')
      // thì đưa ngay vào hàng đợi UI lập tức để phản hồi tức thì với thao tác người dùng
      const isOptimisticBusy = targetAgentObj?.status === 'working';
      if (isOptimisticBusy) {
        setAgentQueues(prev => ({
          ...prev,
          [targetId]: [...(prev[targetId] || []), userMsg]
        }));
      }

      const res = await fetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => null);

      if (data?.queued) {
        // Server xác nhận đã đưa vào hàng đợi: đảm bảo item có mặt trong agentQueues và đồng bộ ID nếu server trả về ID khác
        const finalId = (data?.messageId || userMsg.id).toString();
        const queuedItem = finalId !== userMsg.id ? { ...userMsg, id: finalId } : userMsg;

        setAgentQueues(prev => {
          const cur = prev[targetId] || [];
          const exists = cur.some(item => item.id === userMsg.id || item.id === finalId || item.content === userMsg.content);
          if (exists) {
            // Nếu đã tồn tại nhưng mang tempId cũ, update sang finalId
            return {
              ...prev,
              [targetId]: cur.map(item => (item.id === userMsg.id ? queuedItem : item))
            };
          }
          return {
            ...prev,
            [targetId]: [...cur, queuedItem]
          };
        });
        setLoading(false);
        return;
      }

      // Nếu server không queue (agent thực tế đang idle):
      // Nếu trước đó đã lỡ add lạc quan vào queue thì dọn ra
      if (isOptimisticBusy) {
        setAgentQueues(prev => {
          const cur = prev[targetId] || [];
          const remaining = cur.filter(item => item.id !== userMsg.id);
          const updated = { ...prev };
          if (remaining.length === 0) delete updated[targetId];
          else updated[targetId] = remaining;
          return updated;
        });
      }

      // Control Plane: HTTP response chỉ báo trạng thái gửi lệnh và đóng loading spinner
      // 100% nội dung trả về, tool calls và tin nhắn lỗi thực tế sẽ được phát qua WebSocket duy nhất
      setLoading(false);
    } catch (e: any) {
      console.error('[handleSend] Request failed:', e);
      setLoading(false);
    }
  };

  const handleForceSendSingle = useCallback(async (msgId: string, content: string, targetId: string) => {
    setAgentQueues(prev => {
      const q = prev[targetId] || [];
      const updatedQ = q.filter(m => m.id !== msgId);
      const updated = { ...prev };
      if (updatedQ.length === 0) delete updated[targetId];
      else updated[targetId] = updatedQ;
      return updated;
    });
    setLoading(true);
    try {
      await fetch(`${API}/api/chat/force-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetAgentId: targetId,
          content,
          messageId: msgId,
          mode: 'single'
        })
      });
    } catch (e) {
      console.error('Force send single failed:', e);
    }
  }, []);

  const handleForceSendAll = useCallback(async (targetId: string) => {
    const q = agentQueues[targetId] || [];
    if (q.length === 0) return;
    const combined = q.length === 1 ? q[0].content : q.map((m, i) => `[Message ${i + 1}]:\n${m.content}`).join('\n\n---\n\n');
    setAgentQueues(prev => {
      const updated = { ...prev };
      delete updated[targetId];
      return updated;
    });
    setLoading(true);
    try {
      await fetch(`${API}/api/chat/force-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetAgentId: targetId,
          content: combined,
          mode: 'all'
        })
      });
    } catch (e) {
      console.error('Force send all failed:', e);
    }
  }, [agentQueues]);

  const isSystemMsg = (m: ChatMsg) => {
    if (!m) return true;
    if (m.showOnUI) return false;
    const content = (m.content || '').trim();
    // Tin hệ thống NỘI BỘ (from:'system') cho orchestrator (to:'orchestrator', msgType:'internal') → Ẩn khỏi UI.
    // GIỮ tin lỗi hệ thống hướng tới user (msgType:'error' / to:'user') để user vẫn thấy.
    if (m.from === 'system' && !(m.msgType === 'error') && m.to !== 'user') return true;
    return (
      m.msgType === 'transcript' ||
      m.msgType === 'heartbeat' ||
      m.msgType === 'ping' ||
      m.msgType === 'opencode_input' ||
      m.msgType === 'internal_prompt' ||
      content.startsWith('▶ INPUT (gửi opencode)') ||
      content.startsWith('=== TURN TRANSCRIPT') ||
      content.startsWith('=== SYSTEM STATUS CHECK') ||
      content.startsWith('=== SYSTEM CHECK') ||
      content.startsWith('=== RECOVERY ATTEMPT')
    );
  };

  const isInternalMsg = (m: ChatMsg) => {
    if (!m) return false;
    if (m.showOnUI) return false;
    // Only hide true internal planning messages from the main chat view.
    // Final summaries/reports from the orchestrator should remain visible.
    if (m.msgType === 'orchestrator_internal') return true;

    // Nếu là tin nhắn giao việc (Directive, Talk, Spawn), TUYỆT ĐỐI KHÔNG ẨN:
    const content = String(m.content || '');
    const isDirective = m.msgType === 'talk' || /(?:\[(?:TALK|SPAWN|TASK)\]|<\s*(?:talk|spawn)\b)/i.test(content);
    if (isDirective) return false;

    // Chỉ ẩn các chỉ thị NỘI BỘ thuần túy do orchestrator gửi ĐI cho agent mà không phải directive giao việc
    if (m.from === 'orchestrator' && m.to && m.to !== 'user' && m.to !== 'broadcast') return true;
    // Tin hệ thống NỘI BỘ hướng tới orchestrator (forwardToOrchestrator: to='orchestrator', msgType='internal')
    // → không hiển thị trong main chat. Tin system hướng tới user (to:'user', msgType:'error') vẫn hiện.
    if (m.from === 'system' && m.to === 'orchestrator') return true;
    return false;
  };

  // Fix UI-dup: loại bỏ duplicate theo id và duplicate theo nội dung / timestamp
  const applyOacDedup = (list: typeof allMessages) => {
    const seenIds = new Set<string>();
    const seenContentKeys = new Set<string>();
    const out: typeof list = [];
    for (const m of list) {
      if (m.id) {
        if (seenIds.has(m.id)) continue;
        seenIds.add(m.id);
      }
      const trimmedContent = (m.content || '').trim();
      // Tránh lặp tin nhắn giống hệt nhau cùng người gửi trong cùng timestamp / gần nhau
      if (trimmedContent && m.from) {
        const normContent = stripCopyPrefix(trimmedContent).toLowerCase().normalize('NFC').replace(/\s+/g, ' ').slice(0, 200);
        // Với tin nhắn của user: nếu cùng content và thời gian cách nhau < 120s thì gộp triệt để
        const isUserMsg = m.from === 'user' || (m as any).role === 'user';
        const bucketSize = isUserMsg ? 120000 : 5000;
        const timeBucket = Math.floor((m.timestamp || 0) / bucketSize);
        const contentKey = `${m.from}|${normContent}|${timeBucket}`;
        if (seenContentKeys.has(contentKey)) continue;
        seenContentKeys.add(contentKey);
      }
      out.push(m);
    }
    return out;
  };

  const filteredMessages = applyOacDedup(selectedAgentId
    ? (() => {
        const sel = agents.find(a => a.id === selectedAgentId);
        const isSubOrch = sel?.type === 'orchestrator' || sel?.role === 'orchestrator';
        const base = allMessages.filter(m => {
          if (isSystemMsg(m)) return false;
          if (isSubOrch) {
            if (isInternalMsg(m)) return false;
            const orchTeamId = sel?.teamId || (sel?.id === 'orchestrator' ? 'default' : `team-${sel?.id.slice(-8)}`);
            const isDirectedToSelected = m.to === selectedAgentId || m.from === selectedAgentId || (sel && (m.to === sel.name || m.from === sel.name));
            if (m.teamId && m.teamId !== orchTeamId && !isDirectedToSelected) return false;

            const isWorkerOpen = (m.msgType === 'opencode') && (m.from !== 'user') && (m.from !== selectedAgentId) && (m.agentRole !== 'orchestrator');
            // GIỮ LẠI opencode events của worker nếu chúng có toolCalls, parts hoặc thinking để hiển thị trên UI
            if (isWorkerOpen && !((m.toolCalls && m.toolCalls.length > 0) || (m.parts && m.parts.length > 0) || m.thinking)) return false;

            if (m.msgType === 'opencode') {
              // Live stream từ stdio: chỉ hiển thị snapshot của CHÍNH orchestrator đang xem
              return m.from === selectedAgentId && !!(m.content || m.thinking || (m.toolCalls && m.toolCalls.length > 0) || (m.parts && m.parts.length > 0));
            }
            if (selectedAgentId !== 'orchestrator') {
              // Orchestrator số 2 trở đi (Sub-Orchestrator riêng biệt): Tuyệt đối KHÔNG gộp với 'orchestrator' gốc
              const isToSelf = m.to === selectedAgentId || (sel && m.to === sel.name);
              const isFromSelf = m.from === selectedAgentId || (sel && m.from === sel.name);
              const isFromRootOrch = m.from === 'orchestrator' || (!isFromSelf && (m.agentRole === 'orchestrator' || agents.some(a => a.id === m.from && (a.role === 'orchestrator' || a.type === 'orchestrator'))));
              const isFromWorker = m.from !== 'user' && !isFromSelf && !isFromRootOrch && m.from !== 'system' && m.from !== 'error';

              return (
                // Tin nhắn user gửi đích danh cho Sub-Orch này
                (m.from === 'user' && Boolean(isToSelf)) ||
                // Tin nhắn Sub-Orch này trả lời user hoặc broadcast
                (Boolean(isFromSelf) && (m.to === 'user' || m.to === 'broadcast')) ||
                // Chỉ đạo / directive do chính Sub-Orch này phát ra
                (Boolean(isFromSelf) && (
                  m.msgType === 'talk' ||
                  (typeof m.content === 'string' && /(?:\[(?:TALK|SPAWN|TASK)\]|<\s*(?:talk|spawn)\b)/i.test(m.content)) ||
                  (m.to && m.to !== 'user' && m.to !== 'broadcast')
                )) ||
                // Tin nhắn chỉ đạo từ Root Orchestrator gửi đến Sub-Orch này
                (Boolean(isFromRootOrch && isToSelf) && Boolean(m.showOnUI !== false)) ||
                // Báo cáo từ worker gửi riêng cho Sub-Orch này
                (isFromWorker && Boolean(isToSelf)) ||
                // Lỗi liên quan trực tiếp đến Sub-Orch này
                (m.msgType === 'error' && (Boolean(isToSelf) || Boolean(isFromSelf))) ||
                (m.from === 'error' && Boolean(isToSelf))
              );
            }

            const isFromWorker = m.from !== 'user' && m.from !== selectedAgentId && m.agentRole !== 'orchestrator' && m.from !== 'system' && m.from !== 'error';
            if (isFromWorker) {
              // Giữ lại báo cáo / trao đổi từ worker gửi về Orchestrator hoặc broadcast
              const isToOrch = m.to === selectedAgentId || m.to === 'orchestrator' || m.to === 'broadcast' || !m.to;
              const isReportOrTask = m.msgType === 'talk' || /(?:REPORT|HOÀN THÀNH|KẾT QUẢ|TIẾN ĐỘ|TASK|ERROR)/i.test(m.content || '');
              if (!isToOrch && !isReportOrTask) {
                return false;
              }
            }
            const isRootOrchSender = m.from === selectedAgentId || m.from === 'orchestrator';
            return (
              (m.from === 'user' && (m.to === selectedAgentId || m.to === 'orchestrator' || m.to === 'broadcast' || !m.to)) ||
              (isRootOrchSender && (m.to === 'user' || m.to === 'broadcast' || !m.to)) ||
              // Lệnh giao task (spawn/talk) của Root Orchestrator → agent: HIỂN THỊ thành cục riêng
              (isRootOrchSender &&
               (m.msgType === 'talk' || (typeof m.content === 'string' && /(?:\[(?:TALK|SPAWN|TASK)\]|<\s*(?:talk|spawn)\b)/i.test(m.content)) || (m.to && m.to !== 'user' && m.to !== 'broadcast'))) ||
              (isFromWorker && (m.to === selectedAgentId || m.to === 'orchestrator' || m.to === 'broadcast' || !m.to)) ||
              (m.msgType === 'error' && (m.to === 'user' || m.from === selectedAgentId || m.to === selectedAgentId || m.from === 'orchestrator')) ||
              (m.from === 'error' && (m.to === 'user' || m.to === selectedAgentId || m.to === 'orchestrator'))
            );
          }
          if (m.msgType === 'opencode') {
            // Live stream từ stdio: chỉ hiển thị snapshot của CHÍNH agent đang xem (from === selectedAgentId),
            // tránh thinking/tool của agent khác hiện lẫn vào view. Ẩn event tool-only (content rỗng).
            return m.from === selectedAgentId && !!(m.content || m.thinking || (m.toolCalls && m.toolCalls.length > 0) || (m.parts && m.parts.length > 0));
          }
          const isFromSel = m.from === selectedAgentId || (sel && (m.from === sel.id || m.from === sel.name));
          const isToSel = m.to === selectedAgentId || (sel && (m.to === sel.id || m.to === sel.name));
          return (
            Boolean(isFromSel) ||
            Boolean(isToSel) ||
            (m.msgType === 'error' && (Boolean(isFromSel) || Boolean(isToSel))) ||
            (m.from === 'error' && Boolean(isToSel))
          );
        });
        return base;
      })()
    : allMessages.filter(m => {
        if (isSystemMsg(m)) return false;
        if (isInternalMsg(m)) return false;
        // Fix 6.36: MAIN view chỉ hiển thị msg thuộc TEAM của Orchestrator đang active.
        // Mọi Main Orchestrator đều ngang hàng, không hardcode id 'orchestrator'.
        const defaultOrch = agents.find(a => a.type === 'orchestrator' || a.role === 'orchestrator' || a.id === 'orchestrator');
        const orchId = defaultOrch?.id || 'orchestrator';
        const mainTeamId = defaultOrch?.teamId || 'default';
        // Team isolation safe: target-based check — chỉ cho phép tin từ orchestrator hiện tại hoặc gửi đến orchestrator hiện tại
        // khi teamId không match. Tránh leak talk/spawn của orchestrator khác sang team này.
        // User messages có to === 'orchestrator' hoặc to === orchId hoặc teamId === 'default' luôn hợp lệ trên main view.
        const isDirectedToMain = m.to === orchId || m.to === 'orchestrator' || m.from === orchId || m.from === 'orchestrator';
        if (m.teamId && m.teamId !== mainTeamId && !isDirectedToMain) return false;
        // Tab Main: hiển thị snapshot 'opencode' của ROOT ORCHESTRATOR, và cho phép các worker opencode event có toolCalls/thinking/parts
        const isNotRootOrch = (m.from !== orchId) && (m.from !== 'orchestrator');
        if (m.msgType === 'opencode' && isNotRootOrch && !((m.toolCalls && m.toolCalls.length > 0) || (m.parts && m.parts.length > 0) || m.thinking)) {
          return false;
        }
        if (m.msgType === 'opencode') {
          return (m.from === orchId || m.from === 'orchestrator') && !!(m.content || m.thinking || (m.toolCalls && m.toolCalls.length > 0) || (m.parts && m.parts.length > 0));
        }
        const isFromWorker = m.from !== 'user' && isNotRootOrch && m.from !== 'system' && m.from !== 'error';
        if (isFromWorker) {
          // Giữ lại báo cáo / phản hồi từ worker hoặc Sub-Orch gửi về Main Orchestrator hoặc broadcast
          const isToOrch = m.to === orchId || m.to === 'orchestrator' || m.to === 'broadcast' || !m.to;
          const isReportOrTask = m.msgType === 'talk' || /(?:REPORT|HOÀN THÀNH|KẾT QUẢ|TIẾN ĐỘ|TASK|ERROR)/i.test(m.content || '');
          if (!isToOrch && !isReportOrTask) {
            return false;
          }
        }
        const isDirective = (
          (m.from === orchId || m.from === 'orchestrator') &&
          (
            m.msgType === 'talk' ||
            (typeof m.content === 'string' && /(?:\[(?:TALK|SPAWN|TASK)\]|<\s*(?:talk|spawn)\b)/i.test(m.content)) ||
            (m.to && m.to !== 'user' && m.to !== 'orchestrator' && m.to !== 'broadcast')
          )
        );

        return (
          isDirective ||
          (m.from === 'user' && (m.to === orchId || m.to === 'orchestrator' || m.to === 'broadcast' || !m.to)) ||
          ((m.from === orchId || m.from === 'orchestrator') && (m.to === 'user' || m.to === 'broadcast' || !m.to)) ||
          (isFromWorker && (m.to === orchId || m.to === 'orchestrator' || m.to === 'broadcast' || !m.to)) ||
          (m.msgType === 'error' && (m.to === 'user' || m.from === orchId || m.from === 'orchestrator')) ||
          (m.from === 'error' && (m.to === 'user' || m.to === orchId || m.to === 'orchestrator'))
        );
      })
  );

  const formatMessage = (msg: ChatMsg): { sender: string; content: string; isUser: boolean; timestamp?: number } => {
    const isUser = msg.from === 'user';
    let sender = msg.from;

    if (msg.from === 'orchestrator') sender = 'Orchestrator';
    else if (msg.from === 'user') sender = 'You';
    else if (msg.agentName) sender = `${msg.agentName} (${msg.agentRole || 'agent'}) [${msg.from}]`;
    else {
      const agent = agents.find(a => a.id === msg.from);
      if (agent) sender = `${agent.name} (${agent.role}) [${agent.id}]`;
    }

    return { sender, content: msg.content, isUser, timestamp: msg.timestamp };
  };

  const addAgent = async (config: any) => {
    try {
      const res = await fetch(`${API}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        alert(data?.error || 'Không thể tạo agent');
        return;
      }
      setShowSpawn(false);
      fetchAgents();
    } catch (e: any) {
      console.error('Failed to add agent:', e);
      alert(`Lỗi khi tạo agent: ${e.message}`);
    }
  };

  const startAgent = async (agentId: string) => {
    try {
      await fetch(`${API}/api/agents/${agentId}/start`, { method: 'POST' });
      fetchAgents();
    } catch (e) {
      console.error('Failed to start agent:', e);
    }
  };

  const isAbortingRef = useRef(false);
  const lastAbortTimeRef = useRef(0);
  const ABORT_DEBOUNCE_MS = 800;

  const stopAgent = useCallback(async () => {
    const now = Date.now();
    if (isAbortingRef.current || (now - lastAbortTimeRef.current < ABORT_DEBOUNCE_MS)) {
      return;
    }

    const currentAgent = selectedAgentId
      ? agents.find(a => a.id === selectedAgentId)
      : agents.find(a => a.id === 'orchestrator');
    const isWorking = loading || currentAgent?.status === 'working';

    if (!isWorking) return;

    isAbortingRef.current = true;
    lastAbortTimeRef.current = now;
    const agentId = selectedAgentId || 'orchestrator';

    try {
      const res = await fetch(`${API}/api/agents/${agentId}/abort`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (data && data.ok) {
        setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'idle', workingSince: undefined } : a));
      }
      setLoading(false);
    } catch (e) {
      console.error('Failed to abort agent:', e);
    } finally {
      setTimeout(() => {
        isAbortingRef.current = false;
      }, 600);
    }
  }, [selectedAgentId, agents, loading]);

  const updateAgentModel = async (agentId: string, model: string | null) => {
    // Optimistic UI update for instant feedback
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, model: model || undefined } : a));
    try {
      const res = await fetch(`${API}/api/agents/${agentId}/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model })
      });
      const data = await res.json();
      if (!data.ok) {
        fetchAgents();
      }
    } catch (e) {
      console.error('Failed to update agent model:', e);
      fetchAgents();
    }
  };

  const deleteAgent = async (agentId: string) => {
    setAgents(prev => prev.filter(a => a.id !== agentId));
    if (selectedAgentId === agentId) {
      setSelectedAgentId(null);
    }
    try {
      const res = await fetch(`${API}/api/agents/${agentId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) {
        fetchAgents();
      }
    } catch (e) {
      console.error('Failed to delete agent:', e);
      fetchAgents();
    }
  };

  const deleteTask = async (agentId: string, taskId: string | number) => {
    try {
      const res = await fetch(`${API}/api/agents/${encodeURIComponent(agentId)}/tasks/${encodeURIComponent(String(taskId))}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.ok && data.agent) {
        setAgents(prev => prev.map(a => a.id === agentId ? { ...a, ...data.agent } : a));
      } else {
        fetchAgents();
      }
    } catch (e) {
      console.error('Failed to delete task:', e);
      fetchAgents();
    }
  };

  const clearChat = async () => {
    try {
      const endpoint = selectedAgentId ? `${API}/api/agents/${selectedAgentId}/clear` : `${API}/api/orchestrator/clear`;
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setAllMessages(prev => {
          const clearedId = selectedAgentId || 'orchestrator';
          return prev.filter(m => m.from !== clearedId && m.to !== clearedId);
        });
        fetchAgents();
      }
    } catch (e) {
      console.error('Failed to clear chat:', e);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (e.repeat) return;
        if (showSpawn || showModelSettings || showTeamSettings) return;
        
        const currentAgent = selectedAgentId
          ? agents.find(a => a.id === selectedAgentId)
          : agents.find(a => a.id === 'orchestrator');
        const isWorking = loading || currentAgent?.status === 'working';
        
        if (!isWorking) return;
        
        stopAgent();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stopAgent, showSpawn, showModelSettings, showTeamSettings, selectedAgentId, agents, loading]);

  const selectAgent = (agentId: string | null) => {
    setSelectedAgentId(agentId);
    if (isMobile) setSidebarOpen(false);
    fetchHistory(agentId);
  };

  const sidebarStyle: React.CSSProperties = isMobile
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        height: '100%',
        width: 'min(82vw, 320px)',
        zIndex: 50,
        borderRight: '1px solid var(--af-border)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-panel)',
        overflowX: 'hidden',
        transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s ease',
        boxShadow: sidebarOpen ? '4px 0 24px rgba(0,0,0,0.5)' : 'none'
      }
    : {
        width: sidebarWidth,
        minWidth: 180,
        maxWidth: 600,
        borderRight: '1px solid var(--af-border)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-panel)',
        overflowX: 'hidden'
      };

  return (
    <div className="af-shell" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-main)', color: 'var(--text-primary)', overflow: 'hidden', position: 'relative', minHeight: 0 }}>

      {/* ===== TOP ROW: Activity bar + Sidebar + Resizer + Chat column ===== */}
      <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Activity Bar (ẩn trên mobile) */}
        {!isMobile && (
          <div className="af-activitybar" role="navigation" aria-label="Activity bar">
            {[
              { id: 'agents', icon: '👥', label: 'Agents' },
              { id: 'files', icon: '📄', label: 'Files' },
              { id: 'settings', icon: '⚙️', label: 'Settings' }
            ].map(item => (
              <div key={item.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 48 }}>
                <button
                  className={`af-activitybar-item${activeView === item.id ? ' af-active' : ''}`}
                  onClick={() => setActiveView(item.id as 'agents' | 'files' | 'settings')}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={activeView === item.id ? 'page' : undefined}
                >
                  {item.icon}
                </button>
                <span className="af-activitybar-title">{item.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Sidebar — nội dung đổi theo activeView */}
        <div className="af-sidebar" style={sidebarStyle}>
          {/* Header luôn hiển thị logo + tên app */}
          <div style={{ padding: '16px 14px', borderBottom: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }}>
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)'
                }}>
                  🤖
                </div>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
                  AgentForge
                </h2>
              </div>
              {/* Theme toggle giữ ở header sidebar */}
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                title={theme === 'dark' ? 'Chuyển giao diện sáng' : 'Chuyển giao diện tối'}
                aria-label="Toggle theme"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: '1px solid rgba(15,23,42,0.12)',
                  background: theme === 'dark' ? 'var(--bg-input)' : '#ffffff',
                  color: theme === 'dark' ? '#fbbf24' : '#3b82f6',
                  fontSize: 15,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s'
                }}
              >
                {theme === 'dark' ? '☀️' : '🌙'}
              </button>
              {/* Settings icon: toggle giữa Settings và Agents view */}
              <button
                onClick={() => setActiveView(activeView === 'settings' ? 'agents' : 'settings')}
                title={activeView === 'settings' ? 'Về danh sách Agent' : 'Cài đặt / Settings'}
                aria-label="Settings"
                aria-current={activeView === 'settings' ? 'page' : undefined}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: activeView === 'settings' ? '1px solid var(--accent)' : '1px solid rgba(15,23,42,0.12)',
                  background: activeView === 'settings' ? 'var(--accent-soft)' : (theme === 'dark' ? 'var(--bg-input)' : '#ffffff'),
                  color: activeView === 'settings' ? 'var(--accent)' : (theme === 'dark' ? '#94a3b8' : '#64748b'),
                  fontSize: 15,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s'
                }}
              >
                ⚙️
              </button>
            </div>
          </div>

          {/* View: Agents */}
          {activeView === 'agents' && (
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', flex: 1 }}>
              <Dashboard
                agents={agents}
                onStart={startAgent}
                onSpawn={(parentId) => {
                  setSpawnParentId(parentId || selectedAgentId || 'orchestrator');
                  setShowSpawn(true);
                }}
                onSelect={selectAgent}
                selectedAgentId={selectedAgentId}
                onUpdateModel={updateAgentModel}
                onDeleteAgent={deleteAgent}
                onDeleteTask={deleteTask}
              />
            </div>
          )}

          {/* View: Settings */}
          {activeView === 'settings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', overflowY: 'auto', flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                Cài đặt
              </div>

              {/* Watchdog Toggle Switch */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'var(--bg-inset)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--af-border)'
              }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', userSelect: 'none' }} title="Tự động nhắc nhở và can thiệp khi agent làm việc quá lâu">
                  ⏰ Nhắc việc / Watchdog
                </span>
                <label style={{ position: 'relative', display: 'inline-block', width: 34, height: 18, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={enableWatchdog}
                    onChange={(e) => toggleWatchdog(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: enableWatchdog ? '#2563eb' : '#475569',
                    borderRadius: 18,
                    transition: '0.2s'
                  }}>
                    <span style={{
                      position: 'absolute',
                      content: '""',
                      height: 14,
                      width: 14,
                      left: enableWatchdog ? 17 : 2,
                      bottom: 2,
                      backgroundColor: 'white',
                      borderRadius: '50%',
                      transition: '0.2s'
                    }} />
                  </span>
                </label>
              </div>

              {/* Auto Continue Toggle Switch */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'var(--bg-inset)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--af-border)'
              }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', userSelect: 'none' }} title="Khi mở app lại, tự động ping các agent đang working để tiếp tục task dở (không cần thao tác lại)">
                  ▶️ Auto Continue
                </span>
                <label style={{ position: 'relative', display: 'inline-block', width: 34, height: 18, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={autoContinue}
                    onChange={(e) => toggleAutoContinue(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: autoContinue ? '#2563eb' : '#475569',
                    borderRadius: 18,
                    transition: '0.2s'
                  }}>
                    <span style={{
                      position: 'absolute',
                      content: '""',
                      height: 14,
                      width: 14,
                      left: autoContinue ? 17 : 2,
                      bottom: 2,
                      backgroundColor: 'white',
                      borderRadius: '50%',
                      transition: '0.2s'
                    }} />
                  </span>
                </label>
              </div>

              {/* Smart Clarify Mode Toggle Switch */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'var(--bg-inset)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--af-border)'
              }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', userSelect: 'none' }} title="Tự động yêu cầu xác minh và hỏi lại nếu người dùng không chat trong hơn 30s">
                  💡 Smart Mode (30s)
                </span>
                <label style={{ position: 'relative', display: 'inline-block', width: 34, height: 18, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={smartModeEnabled}
                    onChange={(e) => toggleSmartMode(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: smartModeEnabled ? '#10b981' : '#475569',
                    borderRadius: 18,
                    transition: '0.2s'
                  }}>
                    <span style={{
                      position: 'absolute',
                      content: '""',
                      height: 14,
                      width: 14,
                      left: smartModeEnabled ? 17 : 2,
                      bottom: 2,
                      backgroundColor: 'white',
                      borderRadius: '50%',
                      transition: '0.2s'
                    }} />
                  </span>
                </label>
              </div>

              {/* Expand Tool Calls Toggle Switch */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'var(--bg-inset)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--af-border)'
              }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', userSelect: 'none' }} title="Tự động mở rộng các khối công cụ OpenCode (read, glob, grep, edit, bash...)">
                  📦 Expand Tool Calls (OpenCode)
                </span>
                <label style={{ position: 'relative', display: 'inline-block', width: 34, height: 18, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={expandOpenCodeTools}
                    onChange={(e) => toggleExpandOpenCodeTools(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: expandOpenCodeTools ? '#2563eb' : '#475569',
                    borderRadius: 18,
                    transition: '0.2s'
                  }}>
                    <span style={{
                      position: 'absolute',
                      content: '""',
                      height: 14,
                      width: 14,
                      left: expandOpenCodeTools ? 17 : 2,
                      bottom: 2,
                      backgroundColor: 'white',
                      borderRadius: '50%',
                      transition: '0.2s'
                    }} />
                  </span>
                </label>
              </div>

              {/* Expand Thinking Block Toggle Switch */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'var(--bg-inset)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--af-border)'
              }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', userSelect: 'none' }} title="Tự động mở rộng khối suy nghĩ (Thinking) của model">
                  🧠 Expand Thinking Block
                </span>
                <label style={{ position: 'relative', display: 'inline-block', width: 34, height: 18, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={expandThinking}
                    onChange={(e) => toggleExpandThinking(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: expandThinking ? '#2563eb' : '#475569',
                    borderRadius: 18,
                    transition: '0.2s'
                  }}>
                    <span style={{
                      position: 'absolute',
                      content: '""',
                      height: 14,
                      width: 14,
                      left: expandThinking ? 17 : 2,
                      bottom: 2,
                      backgroundColor: 'white',
                      borderRadius: '50%',
                      transition: '0.2s'
                    }} />
                  </span>
                </label>
              </div>

              {/* Model Hierarchy Settings Button */}
              <button
                onClick={() => setShowModelSettings(true)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--af-border)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = '#3b82f6';
                  e.currentTarget.style.background = '#273549';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = 'var(--af-border)';
                  e.currentTarget.style.background = 'var(--bg-inset)';
                }}
              >
                <span>⚙️</span>
                <span>Cấu hình Phân cấp Model</span>
              </button>

              {/* Team Settings Button */}
              <button
                onClick={() => setShowTeamSettings(true)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--af-border)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = '#3b82f6';
                  e.currentTarget.style.background = '#273549';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = 'var(--af-border)';
                  e.currentTarget.style.background = 'var(--bg-inset)';
                }}
              >
                <span>👥</span>
                <span>Cấu hình Team Settings</span>
              </button>
            </div>
          )}

          {/* View: Files (placeholder cho tương lai) */}
          {activeView === 'files' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 14px', overflowY: 'auto', flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Files
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                📄 Explorer file sẽ được bổ sung trong phiên bản sau.
              </div>
            </div>
          )}
        </div>

        {/* Resizer (chỉ desktop) */}
        {!isMobile && (
        <div
          onMouseDown={(e) => {
            const startX = e.clientX;
            const startW = sidebarWidth;
            const onMove = (ev: MouseEvent) => {
              const nw = Math.max(220, Math.min(650, startW + ev.clientX - startX));
              setSidebarWidth(nw);
              try { localStorage.setItem('agentforge_sidebar_width', String(nw)); } catch {}
            };
            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          }}
          style={{
            width: 5,
            cursor: 'col-resize',
            background: 'var(--af-border)',
            flexShrink: 0,
            transition: 'background 0.2s'
          }}
          className="af-resizer"
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#3b82f6'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--af-border)'; }}
        />
        )}

        {/* Chat column: ChatPanel (gỡ bỏ top TabBar để tối đa hóa không gian đọc & soạn thảo) */}
        {(() => {
          const activeTargetId = selectedAgentId || 'orchestrator';
          const currentQueue = agentQueues[activeTargetId] || [];
          return (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
              <ChatPanel
                messages={filteredMessages.map(m => ({
                  id: m.id,
                  agentId: m.from,
                  role: m.from === 'user' ? 'user' : 'assistant',
                  content: m.content,
                  timestamp: m.timestamp,
                  thinking: m.thinking
                }))}
                onSend={sendMessage}
                onStop={stopAgent}
                onClear={clearChat}
                loading={loading}
                selectedAgentId={selectedAgentId}
                title={selectedAgentId ? (() => {
                  const a = agents.find(x => x.id === selectedAgentId);
                  if (!a) return 'Agent';
                  return a.name || a.id;
                })() : (() => {
                  const a = agents.find(x => x.type === 'orchestrator' || x.role === 'orchestrator' || x.id === 'orchestrator');
                  if (!a) return 'Chưa có Orchestrator';
                  return a.name || 'Orchestrator';
                })()}
                sessionTitle={selectedAgentId ? (agents.find(x => x.id === selectedAgentId)?.sessionTitle) : (agents.find(x => x.type === 'orchestrator' || x.role === 'orchestrator' || x.id === 'orchestrator')?.sessionTitle)}
                tokenUsage={selectedAgentId ? agents.find(x => x.id === selectedAgentId)?.tokenUsage : (agents.find(x => x.type === 'orchestrator' || x.role === 'orchestrator' || x.id === 'orchestrator')?.tokenUsage)}
                contextLength={selectedAgentId ? agents.find(x => x.id === selectedAgentId)?.contextLength : (agents.find(x => x.type === 'orchestrator' || x.role === 'orchestrator' || x.id === 'orchestrator')?.contextLength)}
                model={selectedAgentId ? agents.find(x => x.id === selectedAgentId)?.model : (agents.find(x => x.type === 'orchestrator' || x.role === 'orchestrator' || x.id === 'orchestrator')?.model)}
                status={selectedAgentId ? agents.find(x => x.id === selectedAgentId)?.status : (agents.find(x => x.type === 'orchestrator' || x.role === 'orchestrator' || x.id === 'orchestrator')?.status || 'idle')}
                formatMessage={formatMessage}
                allMessages={filteredMessages}
                agents={agents}
                isMobile={isMobile}
                connStatus={connectionStatus}
                offlineForText={offlineForText}
                uptimeText={uptimeText}
                showToolBlocks={true}
                defaultExpandToolcalls={expandOpenCodeTools}
                expandDirectives={defaultExpandToolcalls}
                expandThinking={expandThinking}
                queuedMessages={currentQueue}
                onFlushQueue={() => handleForceSendAll(activeTargetId)}
                onClearQueue={() => clearQueueForAgent(activeTargetId)}
                onForceSendSingle={handleForceSendSingle}
                onRemoveQueueItem={(idx) => {
                  setAgentQueues(prev => {
                    const q = prev[activeTargetId] || [];
                    if (idx < 0 || idx >= q.length) return prev;
                    const nextQ = q.filter((_, i) => i !== idx);
                    if (nextQ.length === 0) {
                      const updated = { ...prev };
                      delete updated[activeTargetId];
                      return updated;
                    }
                    return { ...prev, [activeTargetId]: nextQ };
                  });
                }}
              />
            </div>
          );
        })()}
      </div>

      {/* Backdrop + Hamburger cho mobile (nằm ngoài sidebar vì sidebar có transform) */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40 }}
        />
      )}
      {isMobile && !sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="Mở danh sách agent"
          style={{
            position: 'fixed',
            top: 10,
            left: 10,
            zIndex: 50,
            width: 44,
            height: 44,
            borderRadius: 10,
            border: '1px solid #334155',
            background: '#111827',
            color: '#f8fafc',
            fontSize: 20,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 10px rgba(0,0,0,0.4)'
          }}
        >
          ☰
        </button>
      )}
      {/* Nút chuyển đổi View Cài đặt / Agents trên mobile */}
      {isMobile && (
        <button
          onClick={() => {
            if (activeView === 'settings') {
              setActiveView('agents');
            } else {
              setActiveView('settings');
              setSidebarOpen(true);
            }
          }}
          aria-label={activeView === 'settings' ? 'Đóng cài đặt, về danh sách Agent' : 'Cài đặt'}
          title={activeView === 'settings' ? 'Về danh sách Agent' : 'Cài đặt'}
          style={{
            position: 'fixed',
            top: 8,
            right: 8,
            zIndex: 60,
            width: 36,
            height: 36,
            borderRadius: 8,
            border: activeView === 'settings' ? '1px solid var(--accent)' : '1px solid #334155',
            background: activeView === 'settings' ? 'var(--accent)' : '#1e293b',
            color: '#f8fafc',
            fontSize: 15,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            transition: 'all 0.2s'
          }}
        >
          {activeView === 'settings' ? '✕' : '⚙️'}
        </button>
      )}

      {/* ===== CORNER FLOATING WIDGET (X working · Live) & POPOVER ===== */}
      {(() => {
        const workingAgents = agents.filter(a => a.status === 'working');
        const workingCount = workingAgents.length;
        const totalQueuedCount = Object.values(agentQueues).reduce((sum, q) => sum + (q ? q.length : 0), 0);

        return (
          <>
            {/* Popover Window khi bấm vào Widget */}
            {showWorkingPopover && (() => {
              const activeCount = agents.length;
              return (
                <div
                  style={{
                    position: 'fixed',
                    bottom: 48,
                    right: 16,
                    width: isMobile ? 'calc(100vw - 32px)' : 380,
                    maxHeight: 520,
                    background: 'var(--bg-panel, #0e131d)',
                    border: '1px solid var(--af-border-strong)',
                    borderRadius: 12,
                    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.55)',
                    zIndex: 75,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    animation: 'fadeIn 0.15s ease-out'
                  }}
                >
                  {/* Popover Header */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: 'var(--bg-input, #151d2c)',
                    borderBottom: '1px solid var(--af-border)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14 }}>👥</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                        Thành viên & Nhiệm vụ ({activeCount})
                      </span>
                    </div>
                    <button
                      onClick={() => setShowWorkingPopover(false)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: 14,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4
                      }}
                      title="Đóng cửa sổ"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Popover Content — All Agents Grouped */}
                  <div style={{
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    overflowY: 'auto',
                    maxHeight: 400
                  }}>
                    {agents.length === 0 ? (
                      <div style={{
                        textAlign: 'center',
                        padding: '20px 10px',
                        color: 'var(--text-muted)',
                        fontSize: 12
                      }}>
                        <div style={{ fontSize: 24, marginBottom: 6 }}>👥</div>
                        Chưa có agent nào trong team.
                      </div>
                    ) : (
                      // Sắp xếp: working lên đầu, sau đó đến blocked/error, rồi idle, stopped
                      [...agents].sort((a, b) => {
                        const rank = (s: string) => s === 'working' ? 0 : (s === 'error' || s === 'blocked') ? 1 : s === 'idle' ? 2 : 3;
                        return rank(a.status) - rank(b.status);
                      }).map(ag => {
                        const isWorking = ag.status === 'working';
                        const isError = ag.status === 'error' || ag.status === 'blocked';
                        const isIdle = ag.status === 'idle';
                        const statusColor = isWorking ? '#4ade80' : isError ? '#f87171' : isIdle ? '#94a3b8' : '#64748b';
                        const statusBg = isWorking ? 'rgba(34, 197, 94, 0.15)' : isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(148, 163, 184, 0.12)';
                        const statusBorder = isWorking ? 'rgba(34, 197, 94, 0.35)' : isError ? 'rgba(239, 68, 68, 0.35)' : 'rgba(148, 163, 184, 0.25)';
                        const elapsed = isWorking && ag.workingSince ? formatElapsed(Date.now() - ag.workingSince) : '';
                        const parsedTasks = parseAgentTaskList(ag);

                        return (
                          <div
                            key={ag.id}
                            onClick={() => {
                              selectAgent(ag.id);
                              setShowWorkingPopover(false);
                            }}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                              padding: '10px 12px',
                              background: isWorking
                                ? 'rgba(59, 130, 246, 0.08)'
                                : isError
                                ? 'rgba(239, 68, 68, 0.08)'
                                : 'rgba(255, 255, 255, 0.02)',
                              border: `1px solid ${isWorking ? 'rgba(59, 130, 246, 0.4)' : isError ? 'rgba(239, 68, 68, 0.4)' : 'var(--af-border)'}`,
                              borderRadius: 8,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = 'var(--accent, #3b82f6)';
                              e.currentTarget.style.background = isWorking ? 'rgba(59, 130, 246, 0.14)' : 'rgba(59, 130, 246, 0.06)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = isWorking ? 'rgba(59, 130, 246, 0.4)' : isError ? 'rgba(239, 68, 68, 0.4)' : 'var(--af-border)';
                              e.currentTarget.style.background = isWorking ? 'rgba(59, 130, 246, 0.08)' : isError ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255, 255, 255, 0.02)';
                            }}
                            title="Bấm để chuyển nhanh sang tab agent này"
                          >
                            {/* Header: Agent Name + Role + Status Badge */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                                {ag.type === 'orchestrator' || ag.id === 'orchestrator' ? '👑' : '🤖'} {ag.name} <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)' }}>({ag.role})</span>
                              </span>
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                fontSize: 10,
                                fontWeight: 700,
                                color: statusColor,
                                background: statusBg,
                                padding: '1px 6px',
                                borderRadius: 4,
                                border: `1px solid ${statusBorder}`,
                                textTransform: 'uppercase'
                              }}>
                                {isWorking && <span className="pulsing-green" style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e' }} />}
                                {isError && <span>⚠️</span>}
                                {ag.status}{elapsed ? ` (${elapsed})` : ''}
                              </span>
                            </div>

                            {/* Task Content with #1, #2, #3 numbering */}
                            {Array.isArray(parsedTasks) && parsedTasks.length > 0 ? (
                              <div style={{
                                maxHeight: 110,
                                overflowY: 'auto',
                                paddingRight: 2
                              }}>
                                {renderAgentTaskList(parsedTasks, {
                                  agentId: ag.id,
                                  onDeleteTask: (tId) => deleteTask(ag.id, tId)
                                })}
                              </div>
                            ) : (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', paddingLeft: 4 }}>
                                (Chưa gán nhiệm vụ cụ thể)
                              </div>
                            )}

                            <div style={{ fontSize: 10, color: 'var(--accent, #3b82f6)', textAlign: 'right', fontWeight: 600 }}>
                              👉 Bấm để chuyển tab
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Popover Footer Info */}
                  <div style={{
                    padding: '8px 12px',
                    background: 'var(--bg-input, #151d2c)',
                    borderTop: '1px solid var(--af-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    color: 'var(--text-muted)'
                  }}>
                    <span>📁 {serverCwd ? serverCwd.split('\\').pop() : 'cwd'}</span>
                    {serverVersion && <span>v{serverVersion}</span>}
                  </div>
                </div>
              );
            })()}

            {/* Corner Floating Widget */}
            <div
              onClick={() => setShowWorkingPopover(prev => !prev)}
              style={{
                position: 'fixed',
                bottom: 8,
                right: 14,
                zIndex: 70,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 11px',
                background: showWorkingPopover ? 'var(--bg-input, #151d2c)' : 'rgba(14, 19, 29, 0.88)',
                backdropFilter: 'blur(12px)',
                border: `1px solid ${workingCount > 0 ? 'rgba(34, 197, 94, 0.45)' : 'var(--af-border-strong)'}`,
                borderRadius: 9999,
                boxShadow: workingCount > 0 ? '0 4px 20px rgba(34, 197, 94, 0.25)' : '0 4px 20px rgba(0, 0, 0, 0.4)',
                cursor: 'pointer',
                userSelect: 'none',
                transition: 'all 0.2s ease'
              }}
              title="Bấm để mở danh sách task & agent đang chạy"
            >
              <span
                className={connected ? (workingCount > 0 ? 'pulsing-green' : '') : 'pulsing-red'}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: connected ? (workingCount > 0 ? '#22c55e' : '#4ade80') : '#ef4444',
                  display: 'inline-block'
                }}
              />
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                color: connected ? (workingCount > 0 ? '#4ade80' : 'var(--text-primary)') : '#f87171',
                maxWidth: isMobile ? 220 : 340,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {`${workingCount} working · ${connected ? "Live" : "Offline"}`}
              </span>
              <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>
                {showWorkingPopover ? '▾' : '▴'}
              </span>
            </div>
          </>
        );
      })()}

      {/* Floating Broadcast Bar */}
      <FloatingBroadcastBar
        agentsCount={agents.length}
        onSendBroadcast={async (message) => {
          const res = await fetch(`${API}/api/broadcast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
          });
          if (!res.ok) throw new Error('Broadcast request failed');
        }}
      />

      {/* Startup Modal */}
      <StartupModal
        isOpen={showStartupModal}
        initialSettings={startupInitialSettings}
        onStart={async (settings) => {
          if (settings.rememberChoice) {
            localStorage.setItem('af-skip-startup-modal', 'true');
          }
          await fetch(`${API}/api/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              engineMode: settings.engineMode,
              enableWatchdog: settings.enableWatchdog,
              autoContinue: settings.autoContinue,
              smartClarifyEnabled: settings.smartClarifyEnabled,
              watchdogStreamTimeoutSec: settings.watchdogStreamTimeoutSec,
              taskQueueIdleCheckSec: settings.taskQueueIdleCheckSec
            })
          });
          await fetch(`${API}/api/settings/start-system`, { method: 'POST' });
          setShowStartupModal(false);
          fetchAgents();
          fetchSettings();
        }}
      />

      {/* Spawn Dialog */}
      {showSpawn && (
        <SpawnDialog
          onAdd={addAgent}
          onClose={() => setShowSpawn(false)}
          agents={agents}
          defaultSpawnedBy={spawnParentId || (selectedAgentId && agents.find(a => a.id === selectedAgentId)?.type === 'orchestrator' ? selectedAgentId : 'orchestrator')}
        />
      )}

      {/* Model Hierarchy Settings Dialog */}
      {showModelSettings && (
        <ModelSettingsDialog
          agents={agents}
          onClose={() => setShowModelSettings(false)}
          onSaved={() => {
            fetchAgents();
            fetch(`${API}/api/settings/defaultExpandToolcalls`)
              .then(r => r.ok ? r.json() : null)
              .then(d => {
                if (d && typeof d.defaultExpandToolcalls === 'boolean') {
                  setDefaultExpandToolcalls(d.defaultExpandToolcalls);
                }
              })
              .catch(() => {});
          }}
        />
      )}

      {/* Team Settings Dialog */}
      {showTeamSettings && (
        <TeamSettingsDialog
          teamId={selectedAgentId && agents.find(a => a.id === selectedAgentId)?.teamId ? (agents.find(a => a.id === selectedAgentId)?.teamId || 'default') : 'default'}
          agents={agents}
          onClose={() => setShowTeamSettings(false)}
          onSaved={fetchAgents}
        />
      )}
    </div>
  );
}
