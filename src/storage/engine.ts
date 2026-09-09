import { existsSync, statSync, readFileSync, copyFileSync } from 'fs';
import { STATE_FILE, BAK_FILE, MAX_PERSISTED_MESSAGES, MAX_LOGS_ENTRIES } from './constants.js';
import { atomicWriteFile } from './file-utils.js';
import { chatWAL } from './chat-wal.js';
import type { ChatMessage } from './chat-wal.js';
import type { StorageSchema, OutboxReport, ChatQueueItem, SystemLogEntry } from './types.js';

export class StorageEngine {
  inMemoryAgents = new Map<string, any>();
  inMemoryHistory: any[] = [];
  inMemorySettings: Record<string, any> = {};
  inMemoryOutbox: OutboxReport[] = [];
  inMemoryChatQueue: ChatQueueItem[] = [];
  inMemoryUnprocessedUserMessages: Record<string, string[]> = {};
  inMemoryLogs: SystemLogEntry[] = [];
  outboxInFlightAt = new Map<string, number>();

  isDirty = false;
  isWriting = false;
  saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.loadStateFromDisk();
    this.registerProcessHooks();
  }

  validateSchema(data: any): data is StorageSchema {
    return (
      data !== null &&
      typeof data === 'object' &&
      Array.isArray(data.agents) &&
      Array.isArray(data.history)
    );
  }

  parseStateContent(raw: string): StorageSchema | null {
    if (!raw || raw.trim().length === 0) return null;
    try {
      const data = JSON.parse(raw);
      if (this.validateSchema(data)) {
        return data;
      }
    } catch {}
    return null;
  }

  loadStateFromDisk(): void {
    let loadedState: StorageSchema | null = null;
    let loadedFromBackup = false;

    // 1. Try reading primary state file
    if (existsSync(STATE_FILE)) {
      try {
        const stats = statSync(STATE_FILE);
        if (stats.size > 0) {
          const raw = readFileSync(STATE_FILE, 'utf-8');
          loadedState = this.parseStateContent(raw);
          if (!loadedState) {
            console.warn(`[Storage] Primary state file ${STATE_FILE} contains invalid or corrupted JSON.`);
          }
        } else {
          console.warn(`[Storage] Primary state file ${STATE_FILE} is 0 bytes (empty).`);
        }
      } catch (e: any) {
        console.warn(`[Storage] Failed to read primary state file: ${e.message}`);
      }
    }

    // 2. If primary file missing or corrupted, attempt recovery from backup
    if (!loadedState && existsSync(BAK_FILE)) {
      try {
        const stats = statSync(BAK_FILE);
        if (stats.size > 0) {
          const rawBak = readFileSync(BAK_FILE, 'utf-8');
          loadedState = this.parseStateContent(rawBak);
          if (loadedState) {
            loadedFromBackup = true;
            console.log(`[Storage] Successfully auto-recovered state from backup file: ${BAK_FILE}`);
          } else {
            console.warn(`[Storage] Backup file ${BAK_FILE} is also corrupted.`);
          }
        }
      } catch (e: any) {
        console.warn(`[Storage] Failed to read backup file: ${e.message}`);
      }
    }

    // 3. Populate in-memory structures
    if (loadedState) {
      this.inMemoryAgents.clear();
      const loadedSettings = (loadedState as any).settings || {};
      const autoContinue = loadedSettings.autoContinue === true;
      for (const a of loadedState.agents) {
        if (a && a.id) {
          if (a.status === 'working' && !autoContinue) {
            a.status = 'idle';
            a.workingSince = undefined;
            if (Array.isArray(a.tasks)) {
              for (const t of a.tasks) {
                if (t && t.status === 'working') t.status = 'pending';
              }
            }
          } else if (a.status === 'working' && autoContinue) {
            a.workingSince = Date.now();
          }
          if (a.sessionId || a.session_id) {
            a.sessionId = a.sessionId || a.session_id;
            a.session_id = a.session_id || a.sessionId;
          }
          this.inMemoryAgents.set(a.id, a);
        }
      }
      this.inMemoryHistory = Array.isArray(loadedState.history) ? loadedState.history : [];
      // Hydrate inMemoryHistory từ ChatWAL — chạy 1 lần duy nhất (hydrateOnce()),
      // tránh lặp lại "Hydrated N messages" ~20 lần lúc boot khi loadStateFromDisk được gọi nhiều lần.
      const walMessages = chatWAL.hydrateOnce();
      if (walMessages.length > 0) {
        const map = new Map<string, any>();
        for (const m of this.inMemoryHistory) { if (m && m.id) map.set(m.id, m); }
        for (const m of walMessages) { if (m && m.id) map.set(m.id, m); }
        this.inMemoryHistory = Array.from(map.values());
      } else if (this.inMemoryHistory.length > 0 && !chatWAL.isHydrated()) {
        // Migration: state.json có history nhưng chat.jsonl chưa tồn tại -> dump sang WAL
        chatWAL.rewriteAll(this.inMemoryHistory);
      }
      this.inMemorySettings = loadedSettings;
      this.inMemoryOutbox = (loadedState.outbox || []).map((r: any) => {
        if (r.status === 'in_flight') {
          return { ...r, status: 'pending', inFlightSince: undefined };
        }
        return r;
      });
      this.inMemoryChatQueue = (loadedState as any).chatQueue || [];
      this.inMemoryUnprocessedUserMessages = (loadedState as any).unprocessedUserMessages || {};
      this.inMemoryLogs = (loadedState as any).logs || [];

      if (loadedFromBackup) {
        this.writeStateSync();
      } else if (!existsSync(BAK_FILE) && existsSync(STATE_FILE)) {
        try {
          copyFileSync(STATE_FILE, BAK_FILE);
        } catch {}
      }
    } else {
      this.inMemoryAgents.clear();
      this.inMemoryHistory = [];
    }
  }

  writeStateSync(): void {
    if (this.isWriting) return;
    this.isWriting = true;

    try {
      const data: StorageSchema = {
        agents: Array.from(this.inMemoryAgents.values()),
        history: [], // Tách lịch sử chat sang data/chat.jsonl (Append-Only WAL), giải phóng state.json
        settings: this.inMemorySettings,
        outbox: this.inMemoryOutbox.slice(-500),
        chatQueue: this.inMemoryChatQueue.slice(-200),
        unprocessedUserMessages: (() => {
          const clean: Record<string, string[]> = {};
          for (const [k, v] of Object.entries(this.inMemoryUnprocessedUserMessages || {})) {
            if (Array.isArray(v)) {
              const valid = v.filter(m => typeof m === 'string' && m.trim() && !m.trim().startsWith('[TEAM]') && !m.includes('Your ID:'));
              if (valid.length > 0) clean[k] = valid;
            }
          }
          return clean;
        })(),
        logs: this.inMemoryLogs.slice(-MAX_LOGS_ENTRIES)
      };
      const content = JSON.stringify(data, null, 2);

      // 1. Maintain backup: if primary state file exists and is non-empty, back it up
      if (existsSync(STATE_FILE)) {
        try {
          const stats = statSync(STATE_FILE);
          if (stats.size > 0) {
            atomicWriteFile(BAK_FILE, readFileSync(STATE_FILE, 'utf-8'));
          }
        } catch {}
      }

      // 2. Atomically write new state to primary file
      atomicWriteFile(STATE_FILE, content);
      this.isDirty = false;
    } catch (e: any) {
      console.error(`[Storage] State write error: ${e.message}`);
    } finally {
      this.isWriting = false;
    }
  }

  schedulePersist(immediate = false): void {
    this.isDirty = true;
    if (immediate) {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      this.writeStateSync();
      return;
    }
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.writeStateSync();
    }, 100);
    if (this.saveTimer.unref) {
      this.saveTimer.unref();
    }
  }

  flushSync(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.isDirty) {
      this.writeStateSync();
    }
  }

  private registerProcessHooks(): void {
    // Guard MODULE-LEVEL (không phải per-instance): dù StorageEngine được khởi tạo lại
    // bao nhiêu lần, mỗi signal CHỈ đăng ký 1 listener duy nhất → hết MaxListenersExceededWarning.
    if (engineProcessHooksRegistered) return;
    engineProcessHooksRegistered = true;
    process.on('beforeExit', () => this.flushSync());
    process.on('exit', () => this.flushSync());
    process.on('SIGINT', () => this.flushSync());
    process.on('SIGTERM', () => this.flushSync());
  }
}

// Module-level flag: bảo đảm chỉ đăng ký hooks 1 lần cho TOÀN BỘ tiến trình,
// bất kể có bao nhiêu instance StorageEngine được tạo ra trong vòng đời.
let engineProcessHooksRegistered = false;
