// src/core/broadcast.ts
/**
 * Lõi broadcast WS/SSE với deduplication và trạng thái agent, chống nháy start/stop.
 * Triển khai logic từ src/server.ts:
 *   - broadcast(type, data)
 *   - broadcastOACEvent(agentId, ev)
 *   - set agent status (working/idle) trên mỗi event.
 * Thêm:
 *   - Wrappers WS và SSE được wrapp per connection với version cấp cao.
 *   - Map trạng thái agent mà chỉ phát một lần mỗi event liên tiếp ổn định.
 *   - Gộp broadcast trùng lặp (cùng event + cùng payload) trong cùng frame.
 *   - Bỏ deduplicate bản tin, giữ nguyên logic message processing.
 *   - Audit log bảo trì.
 */

import { WebSocket } from 'ws';
import type { Agent } from '../agents/agent-manager.js';
import { TaskQueueManager } from './task-queue.js';
import type { TaskQueueConfig } from './task-queue-config.js';

/**
 * Khởi tạo manager WS/SSE mới.
 * Bọc cùng một logic như trong server.js nhưng với một layer nhỏ để có thể thay thế.
 */
export class BroadcastManager {
  private wsClients = new Set<WebSocket>();
  private sseClients = new Set<{ res: any; onClose?: () => void }>();
  private broadcastLog: { ts: number; type: string; data: any }[] = [];

  // Trạng thái agent cho mỗi agentId — chỉ set working khi event đến,
  // thiết lập debounce 300ms trước khi set idle.
  private agentStatusMap = new Map<string, { status: 'idle' | 'working' | 'error' | 'stopped'; lastUpdated: number }>();
  private statusTimeoutMap = new Map<string, NodeJS.Timeout>();

  // Quản lý task queue — tự động chuyển task khi agent idle
  public taskQueueManager?: TaskQueueManager;

  constructor() {
    // TaskQueueManager sẽ được khởi tạo khi tạo instance
    this.taskQueueManager = undefined;
  }

  // Bảo trì: xóa client chết, expired log sau 1h
  private readonly MAX_LOG_AGE = 60 * 60 * 1000;

  // Broadcast qua tất cả các kết nối WS sẵn sàng.
  public broadcast(type: string, data: any): void {
    if (typeof data !== 'object' || data === null) {
      data = { message: String(data) };
    }
    // YÊU CẦU: broadcast bắt buộc có teamId, nếu không có → không phát (tránh leak team)
    if (!data?.teamId && !data?.msg?.teamId && !data?.agent?.teamId && !data?.toolCall?.teamId) {
      console.log(`[Broadcast] Bỏ qua broadcast không có teamId (tránh leak): type=${type}`);
      return;
    }

    // Gộp log
    const entry = { ts: Date.now(), type, data };
    this.broadcastLog.push(entry);
    this.cleanOldLogs();

    // Deduplicate: phát chỉ một lần nếu có trong queue task vi xử lý mà chưa flush.
    if (this.shouldDeduplicate(type, data)) {
      console.log(`[Broadcast] skip duplicate ${type}`);
      return;
    }

    // Phát WS (nếu đã subscribe) — lồng try/catch cho mỗi client để tránh một client gâỵ lỗi tất cả
    const wsArray = Array.from(this.wsClients);
    for (const ws of wsArray) {
      if (ws.readyState === 1) {
        try {
          ws.send(JSON.stringify({ type, data }));
        } catch (err) {
          console.warn('[Broadcast] lỗi khi gửi WS:', err);
          this.wsClients.delete(ws);
        }
      } else {
        this.wsClients.delete(ws);
      }
    }

    // Phát SSE (nếu đã subscribe) — sử dụng truyền JSON gốc, giống như HTTP push
    const sseArray = Array.from(this.sseClients);
    for (const sub of sseArray) {
      if (!sub.res.headersSent) {
        sub.res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
      }
      try {
        sub.res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
      } catch (err) {
        console.warn('[Broadcast] lỗi khi gửi SSE:', err);
        this.sseClients.delete(sub);
        if (sub.onClose) sub.onClose();
      }
    }

    // Log audit cho analytics
    console.log(`[Broadcast] đã broadcast ${type}`);
  }

  /**
   * Đồng bộ trạng thái agent: sử dụng để emit 'agent:updated' từ agent manager.
   * - Nếu status === 'working': set ngay lập tức, thiết lập timeout để đưa về 'idle' sau 300ms.
   * - Nếu status === 'idle': chỉ clear timeout nếu có.
   */
  public setAgentStatus(agentId: string, status: 'working' | 'idle' | 'error' | 'stopped'): void {
    const now = Date.now();
    const cur = this.agentStatusMap.get(agentId);
    const isIdle = status === 'idle';

    // Cancel bất kỳ timeout xóa nào trước đó
    const prevTimeout = this.statusTimeoutMap.get(agentId);
    if (prevTimeout) {
      clearTimeout(prevTimeout);
      this.statusTimeoutMap.delete(agentId);
    }

    if (isIdle) {
      // Ngay lập tức set idle; clear any working đang chờ
      this.agentStatusMap.set(agentId, { status: 'idle', lastUpdated: now });
      // Khi agent về idle, kích hoạt task queue manager xử lý task nhỏ nhất chưa hoàn thành
      this.taskQueueManager?.onAgentIdle(agentId);
    } else {
      // Chặn phát nhiều lần cho cùng working/trạng thái error/stopped liên tiếp
      if (cur?.status === status) {
        cur.lastUpdated = now;
        this.agentStatusMap.set(agentId, cur);
        return;
      }
      // Set working (hoặc error/stopped) ngay lập tức
      this.agentStatusMap.set(agentId, { status, lastUpdated: now });

      // Sau 300ms, nếu agent vẫn ở trạng thái đó, đưa về idle (trừ khi đã thay đổi)
      const timeoutMs = status === 'error' || status === 'stopped' ? 500 : 300;
      const timeout = setTimeout(() => {
        const curAgain = this.agentStatusMap.get(agentId);
        if (curAgain?.status === status) {
          // Nếu agent đã chuyển trạng thái (có thể do broadcast khác), giữ nguyên
          this.agentStatusMap.set(agentId, { status: 'idle', lastUpdated: Date.now() });
          // Khi agent về idle, kích hoạt task queue manager xử lý task nhỏ nhất chưa hoàn thành
          this.taskQueueManager?.onAgentIdle(agentId);
        }
      }, timeoutMs);
      this.statusTimeoutMap.set(agentId, timeout);
    }

    // Phát event cho UI theo cùng một key, dùng một lần mỗi trạng thái agent (giảm nháy start/stop)
    this.broadcast('agent:updated', { agent: { id: agentId, status, lastUpdated: now } });
  }

  public addWSClient(ws: WebSocket, isLogSubscriber = false): void {
    (ws as any).isLogSubscriber = isLogSubscriber;
    this.wsClients.add(ws);

    // Tự động gửi lại logs hiện tại
    if (isLogSubscriber) {
      for (const entry of this.broadcastLog) {
        try {
          ws.send(JSON.stringify({ type: entry.type, data: entry.data }));
        } catch {}
      }
    }

    ws.on('close', () => {
      this.wsClients.delete(ws);
    });
    ws.on('error', () => {
      this.wsClients.delete(ws);
    });
  }

  public addSSEClient(res: any, onClose?: () => void): void {
    (res as any).isLogSubscriber = false;
    this.sseClients.add({ res, onClose });
    // Giữ kết nối mở
    res.on('close', () => {
      const entry = Array.from(this.sseClients).find((e: any) => e.res === res);
      if (entry) this.sseClients.delete(entry);
      if (onClose) onClose();
    });
    res.on('error', () => {
      const entry = Array.from(this.sseClients).find((e: any) => e.res === res);
      if (entry) this.sseClients.delete(entry);
    });
  }

  private cleanOldLogs(): void {
    const now = Date.now();
    while (this.broadcastLog.length > 0 && this.broadcastLog[0].ts < now - this.MAX_LOG_AGE) {
      this.broadcastLog.shift();
    }
  }

  // Đơn giản: chỉ deduplicate event-type + data đơn giản nhất để bắt đầu
  private shouldDeduplicate(type: string, data: any): boolean {
    // Chặn gửi nhiều lần giống nhau trong vòng 50ms
    return false; // Bỏ qua cho bây giờ, giữ logic đơn giản
  }

  // Tiện ích: trả về số lượng hiện tại cho debug
  public getClientCount(): { ws: number; sse: number } {
    return {
      ws: this.wsClients.size,
      sse: this.sseClients.size
    };
  }

  // Cleanup
  public destroy(): void {
    for (const timeout of this.statusTimeoutMap.values()) clearTimeout(timeout);
    this.statusTimeoutMap.clear();
    this.wsClients.clear();
    this.sseClients.clear();
    this.taskQueueManager?.destroy?.();
  }
}

/**
 * Tạo instance BroadcastManager với config mặc định bao gồm TaskQueue.
 */
export function createBroadcastManager(config?: { taskQueue?: TaskQueueConfig }): BroadcastManager {
  const taskQueueConfig: TaskQueueConfig = config?.taskQueue ?? {
    idleDetectionMs: 30000, // 30 giây
    taskCheckIntervalMs: 60000, // 1 phút
    blockCriticalTasks: false
  };

  const instance = new BroadcastManager();
  // Khởi tạo TaskQueueManager cho instance — truyền broadcast callback để tránh circular import
  instance.taskQueueManager = new TaskQueueManager(taskQueueConfig, (type, data) => instance.broadcast(type, data));
  return instance;
}
