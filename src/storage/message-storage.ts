import type { StorageEngine } from './engine.js';
import type { HistoryPageOptions } from './types.js';
import { MAX_PERSISTED_MESSAGES } from './constants.js';
import { resolveTeamIdForMsg } from './team-resolver.js';
import { chatWAL } from './chat-wal.js';

export class MessageStorage {
  private jsonlInitialized = false;

  constructor(private engine: StorageEngine) {}

  /**
   * Khởi tạo và nạp lịch sử từ chat.jsonl WAL (Append-only).
   * Nếu có migration từ inMemoryHistory cũ của state.json, tự động dump sang chat.jsonl.
   */
  public initChatJsonl(): void {
    if (this.jsonlInitialized) return;
    this.jsonlInitialized = true;

    // Hydrate từ ChatWAL — Single Source of Truth (hydrateOnce để tránh log lặp)
    const walMessages = chatWAL.hydrateOnce();
    if (walMessages.length > 0) {
      const map = new Map<string, any>();
      for (const m of this.engine.inMemoryHistory) {
        if (m && m.id) map.set(m.id, { ...m, isStreaming: false });
      }
      for (const m of walMessages) {
        if (m && m.id) {
          let cleanContent = m.content;
          if (typeof cleanContent === 'string') {
            cleanContent = cleanContent.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim();
          }
          let cleanParts = m.parts;
          if (Array.isArray(cleanParts)) {
            cleanParts = cleanParts
              .filter((p: any) => p && (p.type === 'tool' || p.type === 'text' || p.type === 'thinking'))
              .map((p: any) => {
                if (p.type === 'text' && typeof p.content === 'string') {
                  return { ...p, content: p.content.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim() };
                }
                return p;
              })
              .filter((p: any) => !(p.type === 'text' && !p.content));
          }
          map.set(m.id, { ...m, isStreaming: false, content: cleanContent, parts: cleanParts });
        }
      }
      this.engine.inMemoryHistory = Array.from(map.values());
      console.log(`[ChatWAL] Đã nạp ${this.engine.inMemoryHistory.length} tin nhắn từ ${walMessages.length} WAL entries`);
    } else if (this.engine.inMemoryHistory.length > 0 && !chatWAL.isHydrated()) {
      // Migration: state.json có history nhưng chat.jsonl chưa tồn tại -> dump sang WAL
      chatWAL.rewriteAll(this.engine.inMemoryHistory);
      chatWAL.clearCache();
      console.log(`[ChatWAL] Migrated ${this.engine.inMemoryHistory.length} messages from state.json to chat.jsonl`);
    }
  }

  // Xác định teamId của một tin nhắn dựa trên agent liên quan (from/to).
  // Ủy quyền hoàn toàn cho team-resolver.ts để đảm bảo một nguồn chân lý (Single Source of Truth)
  resolveTeamIdForMsg(msg: any): string {
    return resolveTeamIdForMsg(
      msg,
      (id: string) => this.engine.inMemoryAgents.get(id),
      () => Array.from(this.engine.inMemoryAgents.values())
    );
  }

  saveMessage(msg: any): void {
    if (!this.jsonlInitialized) this.initChatJsonl();
    const m = { ...msg };
    if (!m.teamId) {
      const tid = this.resolveTeamIdForMsg(msg);
      if (tid) m.teamId = tid;
    }
    const existingIdx = m.id ? this.engine.inMemoryHistory.findIndex((x: any) => x.id === m.id) : -1;
    if (existingIdx !== -1) {
      this.engine.inMemoryHistory[existingIdx] = m;
      // Cập nhật lại toàn bộ file nếu tin nhắn đã tồn tại được sửa (update)
      // Sử dụng rewriteAll(..., false) để tránh backup disk cho hot-path update (Option A fix)
      chatWAL.rewriteAll(this.engine.inMemoryHistory, false);
    } else {
      this.engine.inMemoryHistory.push(m);
      if (Number.isFinite(MAX_PERSISTED_MESSAGES) && this.engine.inMemoryHistory.length > MAX_PERSISTED_MESSAGES) {
        this.engine.inMemoryHistory.shift();
      }
      // Ghi nối đuôi (Append-only) tức thì siêu tốc độ vào JSONL WAL!
      chatWAL.appendMessage(m);
    }
    // Không cần persist toàn bộ state JSON cồng kềnh cho mỗi message nữa!
  }

  getHistory(limit?: number, teamId?: string): any[] {
    if (!this.jsonlInitialized) this.initChatJsonl();
    let list = this.engine.inMemoryHistory;
    if (teamId) {
      list = list.filter(m => {
        const t = m.teamId || 'default';
        if (teamId === 'default') return t === 'default';
        return t === teamId;
      });
    }
    if (typeof limit === 'number' && limit > 0) {
      return list.slice(-limit);
    }
    return list;
  }

  getHistoryByAgent(agentId: string, limit = 100): any[] {
    if (!this.jsonlInitialized) this.initChatJsonl();
    return this.engine.inMemoryHistory
      .filter(m => m.from_id === agentId || m.to_id === agentId || m.from === agentId || m.to === agentId)
      .slice(-limit);
  }

  getHistoryPage(opts: HistoryPageOptions = {}): any[] {
    if (!this.jsonlInitialized) this.initChatJsonl();
    let list = this.engine.inMemoryHistory;
    const aid = opts.agentId;
    if (aid) {
      list = list.filter(m => m.from_id === aid || m.to_id === aid || m.from === aid || m.to === aid);
    }
    if (opts.teamId) {
      const teamFilter = opts.teamId === 'default'
        ? (m: any) => (m.teamId || 'default') === 'default'
        : (m: any) => (m.teamId || 'default') === opts.teamId;
      list = list.filter(teamFilter);
    }
    if (opts.beforeId !== undefined && opts.beforeId !== null && String(opts.beforeId).length > 0) {
      const beforeStr = String(opts.beforeId);
      const idx = list.findIndex(m => String(m.id) === beforeStr);
      if (idx > 0) list = list.slice(0, idx);
      else if (idx === 0) return [];
    }
    const lim = Math.max(1, Math.min(opts.limit ?? 200, 1000));
    return list.slice(-lim);
  }

  clearOrchestratorConversation(): void {
    if (!this.jsonlInitialized) this.initChatJsonl();
    this.engine.inMemoryHistory = this.engine.inMemoryHistory.filter(m =>
      (m.to_id !== 'orchestrator' && m.to !== 'orchestrator') &&
      (m.from_id !== 'orchestrator' && m.from !== 'orchestrator')
    );
    chatWAL.rewriteAll(this.engine.inMemoryHistory);
  }

  clearAgentConversation(agentId: string): void {
    if (!this.jsonlInitialized) this.initChatJsonl();
    this.engine.inMemoryHistory = this.engine.inMemoryHistory.filter(m =>
      (m.to_id !== agentId && m.to !== agentId) &&
      (m.from_id !== agentId && m.from !== agentId)
    );
    chatWAL.rewriteAll(this.engine.inMemoryHistory);
  }

  loadHistory(limit?: number): any[] {
    if (!this.jsonlInitialized) this.initChatJsonl();
    if (typeof limit === 'number' && limit > 0) {
      return this.engine.inMemoryHistory.slice(-limit);
    }
    return this.engine.inMemoryHistory;
  }
}
