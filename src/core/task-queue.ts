// src/core/task-queue.ts
/**
 * TaskQueueManager — tự động nhắc agent tiếp tục task nhỏ nhất chưa hoàn thành.
 *
 * Nguyên tắc hoạt động (theo yêu cầu user):
 * - Khi 1 agent đang có việc làm nhưng về trạng thái idle >= 30s
 *   (hoặc ngừng sinh stream >= 1 phút), hệ thống gửi 1 tin nhắc tiếp tục task "x"
 *   với x là task nhỏ nhất chưa xong.
 * - Lặp lại theo lịch retry: 30s -> 1p -> 1p -> 3p -> 5p cho đến khi task hoàn thành.
 * - Tôn trọng toggle setting `autoContinue` (gom vào toggle UI đã có sẵn).
 * - Tách biệt hoàn toàn khỏi AgentStatusManager & không phụ thuộc circular import
 *   (nhận broadcast/assign callbacks qua constructor).
 */

import { storage } from '../storage.js';
import type { TaskQueueConfig } from './task-queue-config.js';

export type { TaskQueueConfig } from './task-queue-config.js';

/**
 * Đơn giản Task entity — mapping từ Task ở agent-manager nếu cần.
 */
export interface SimpleTask {
  id: string;
  description: string;
  assignedTo?: string;
  assignedBy?: string;
  status: 'pending' | 'assigned' | 'working' | 'completed' | 'failed';
  priority?: number; // optional: để sắp xếp, thấp = nhỏ nhất
  teamId?: string; // team context cho business logic
  createdAt: number;
  source?: 'backend' | 'agent' | 'system'; // nguồn gốc
}

/**
 * Lịch retry mặc định: 30s -> 1p -> 1p -> 3p -> 5p (theo yêu cầu user).
 */
export const DEFAULT_RETRY_SCHEDULE_MS = [30_000, 60_000, 60_000, 180_000, 300_000];

/**
 * TaskQueueManager chính — biệt lập, chạy nền.
 */
export class TaskQueueManager {
  private config: TaskQueueConfig;
  private lastIdleCheckTime: number;
  private readonly statusDebounce = new Map<string, NodeJS.Timeout>();
  private readonly retryTimers = new Map<string, NodeJS.Timeout>();
  private readonly retryAttempts = new Map<string, number>();
  private readonly taskCheckTimer?: NodeJS.Timeout;
  private readonly broadcastFn: (type: string, data: any) => void;
  private onAssignTask?: (task: SimpleTask) => void | Promise<void>;
  private readonly retryScheduleMs: number[];

  constructor(
    config: TaskQueueConfig,
    broadcastFn?: (type: string, data: any) => void,
    onAssignTask?: (task: SimpleTask) => void | Promise<void>,
    retryScheduleMs?: number[]
  ) {
    this.config = config;
    this.lastIdleCheckTime = Date.now();
    this.broadcastFn = broadcastFn || (() => {});
    this.onAssignTask = onAssignTask;
    this.retryScheduleMs = retryScheduleMs || DEFAULT_RETRY_SCHEDULE_MS;
    // bắt đầu timer kiểm tra task queue định kỳ (ví dụ: mỗi 1 phút)
    if (this.config.taskCheckIntervalMs > 0) {
      this.taskCheckTimer = setInterval(() => this.checkAndAssignTask(), this.config.taskCheckIntervalMs);
    }
  }

  /**
   * Hook gửi tin nhắc agent thực sự (inject từ core/app để tránh circular import).
   */
  public setOnAssignTask(fn: (task: SimpleTask) => void | Promise<void>): void {
    this.onAssignTask = fn;
  }

  /**
   * Kích hoạt idle detection cho một agent (gọi từ BroadcastManager khi status idle).
   * Sau idleDetectionMs (mặc định 30s), hệ thống tự tìm task nhỏ nhất và nhắc agent.
   */
  public onAgentIdle(agentId: string): void {
    // Hủy retry cũ nếu agent vừa mới về idle (tránh chồng lịch)
    this.cancelRetry(agentId);

    // hủy bỏ mọi timeout check cũ cho agent này
    const prev = this.statusDebounce.get(agentId);
    if (prev) clearTimeout(prev);

    // Kiểm tra toggle autoContinue từ storage (UI setting) — autoContinue hoặc enableWatchdog đều bật tính năng này
    const autoContinue = storage.getSetting('autoContinue', false) === true;
    const watchdogEnabled = storage.getSetting('enableWatchdog', false) === true;
    if (!autoContinue && !watchdogEnabled) {
      this.broadcastFn('system:log', { level: 'debug', message: `[TaskQueue] autoContinue/watchdog OFF — bỏ qua agent idle ${agentId}` });
      return;
    }

    // Đợi debounce thời gian idleDetectionMs để tránh nháy trạng thái (hỗ trợ tuỳ biến từ Settings)
    const customIdleSec = Number(storage.getSetting('taskQueueIdleCheckSec', 30)) || 30;
    const idleMs = Math.max(5000, customIdleSec * 1000);
    const timeout = setTimeout(() => {
      this.lastIdleCheckTime = Date.now();
      this.checkAndAssignTask().catch(() => {});
    }, idleMs);
    this.statusDebounce.set(agentId, timeout);
  }

  /**
   * Hủy lịch retry đang chạy cho một agent (gọi khi agent quay lại working / stopped).
   */
  public cancelRetry(agentId: string): void {
    const timer = this.retryTimers.get(agentId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(agentId);
    }
    this.retryAttempts.delete(agentId);
  }

  /**
   * Xóa debounce idle đang chờ cho agent (gọi khi có activity mới).
   */
  public cancelIdle(agentId: string): void {
    const prev = this.statusDebounce.get(agentId);
    if (prev) {
      clearTimeout(prev);
      this.statusDebounce.delete(agentId);
    }
  }

  /**
   * Tìm và nhắc thực hiện task nhỏ nhất chưa hoàn thành. Trả về Task | null.
   */
  public async checkAndAssignTask(): Promise<SimpleTask | null> {
    // Chỉ chạy khi toggle autoContinue/watchdog bật
    const autoContinue = storage.getSetting('autoContinue', false) === true;
    const watchdogEnabled = storage.getSetting('enableWatchdog', false) === true;
    if (!autoContinue && !watchdogEnabled) return null;

    const candidate = await this.findSmallestUncompletedTask();
    if (!candidate) return null;

    // Bảo vệ: agent mới bận (do task khác) có thể bỏ qua
    if (candidate.assignedTo) {
      const agent = storage.getAgent(candidate.assignedTo);
      if (agent?.status === 'working') return null;
    }

    const agentId = candidate.assignedTo || 'orchestrator';
    console.log(`[TaskQueueManager] Nhắc tiếp tục task "${candidate.description}" (id=${candidate.id}) cho agent "${agentId}" sau idle ${Date.now() - this.lastIdleCheckTime}ms`);

    const targetAgent = storage.getAgent(agentId);
    const teamId = targetAgent?.teamId || 'default';

    // Broadcast sự kiện hệ thống để UI biết (kèm teamId để không bị filter chặn)
    this.broadcastFn('system:auto-continue', {
      agentId,
      teamId,
      taskId: candidate.id,
      task: candidate.description,
      assignedTo: agentId,
      attempt: this.retryAttempts.get(agentId) || 0
    });

    // Nếu có callback onAssignTask (inject từ core/app), gọi để gửi tin thật cho agent
    if (this.onAssignTask) {
      try {
        const result = this.onAssignTask(candidate);
        if (result && typeof (result as any).catch === 'function') {
          (result as any).catch((e: any) => {
            console.warn(`[TaskQueueManager] onAssignTask async promise failed cho ${agentId}:`, e);
          });
        }
      } catch (e) {
        console.warn(`[TaskQueueManager] onAssignTask failed cho ${agentId}:`, e);
      }
    }

    // Lên lịch retry cho đến khi task hoàn thành
    this.scheduleRetry(candidate, agentId);

    return candidate;
  }

  /**
   * Lên lịch retry: 30s -> 1p -> 1p -> 3p -> 5p (lặp lại để ép đến khi xong).
   */
  private scheduleRetry(task: SimpleTask, agentId: string): void {
    this.cancelRetry(agentId);
    const attempt = 0;
    this.retryAttempts.set(agentId, attempt);

    const armNext = (currentAttempt: number) => {
      // Nếu agent đã quay lại làm việc (status working) thì dừng retry
      const curAgent = storage.getAgent(agentId);
      if (curAgent?.status === 'working') {
        this.cancelRetry(agentId);
        return;
      }

      const delay = this.retryScheduleMs[Math.min(currentAttempt, this.retryScheduleMs.length - 1)];
      const timer = setTimeout(async () => {
        // Kiểm tra task đã hoàn thành chưa — nếu xong thì dừng hẳn
        const taskDone = !this.taskStillPending(task.id, agentId);
        if (taskDone) {
          this.cancelRetry(agentId);
          return;
        }

        const nextAttempt = (this.retryAttempts.get(agentId) || 0) + 1;
        this.retryAttempts.set(agentId, nextAttempt);

        const targetAgent = storage.getAgent(agentId);
        const teamId = targetAgent?.teamId || 'default';

        console.log(`[TaskQueueManager] Retry ${nextAttempt} — vẫn idle, nhắc lại task "${task.description}" cho ${agentId} (delay ${delay}ms)`);
        this.broadcastFn('system:auto-continue', {
          agentId,
          teamId,
          taskId: task.id,
          task: task.description,
          assignedTo: agentId,
          attempt: nextAttempt
        });
        if (this.onAssignTask) {
          try {
            const res = this.onAssignTask(task);
            if (res && typeof (res as any).catch === 'function') {
              (res as any).catch((e: any) => console.warn(`[TaskQueueManager] onAssignTask retry promise failed:`, e));
            }
          } catch (e) {
            console.warn(`[TaskQueueManager] onAssignTask retry failed:`, e);
          }
        }
        armNext(nextAttempt);
      }, delay);
      this.retryTimers.set(agentId, timer);
    };

    armNext(attempt);
  }

  /**
   * Kiểm tra task còn pending/assigned hay đã hoàn thành.
   */
  private taskStillPending(taskId: string, agentId: string): boolean {
    try {
      const agent = storage.getAgent(agentId);
      const tasks: any[] = agent?.tasks || [];
      const found = tasks.find((t: any) => String(t.id ?? t.taskId ?? '') === String(taskId));
      if (!found) return false; // không còn trong danh sách -> coi như xong
      return found.status === 'pending' || found.status === 'assigned';
    } catch {
      return false;
    }
  }

  /**
   * Tìm task nhỏ nhất chưa hoàn thành (theo priority thấp / id lex order) từ storage.
   */
  private async findSmallestUncompletedTask(): Promise<SimpleTask | null> {
    // Quét tất cả agent lấy danh sách task (status pending/assigned)
    const agents = storage.getAllAgents() || [];
    const allTasks: SimpleTask[] = [];
    for (const agent of agents) {
      const tasks: any[] = agent?.tasks || [];
      for (const t of tasks) {
        if (t.status === 'pending' || t.status === 'assigned') {
          allTasks.push({
            id: String(t.id ?? t.taskId ?? `${agent.id}-${t.createdAt ?? Date.now()}`),
            description: String(t.task ?? t.description ?? t.id ?? 'task'),
            assignedTo: agent.id,
            assignedBy: t.assignedBy,
            status: t.status,
            priority: typeof t.priority === 'number' ? t.priority : undefined,
            teamId: agent.teamId || 'default',
            createdAt: t.createdAt ?? Date.now(),
            source: t.source || 'backend'
          });
        }
      }
    }
    if (allTasks.length === 0) return null;

    // Ưu tiên nhỏ nhất: ưu tiên thấp nhất (nếu có) hoặc task id lex nhỏ nhất để xác định rõ ràng
    const sorted = allTasks.slice().sort((a, b) => {
      if (a.priority !== undefined && b.priority !== undefined) return a.priority - b.priority;
      if (a.priority !== undefined) return -1;
      if (b.priority !== undefined) return 1;
      // Sort theo id lex để xác định rõ ràng
      return (a.id || '').localeCompare(b.id || '');
    });

    return sorted[0] || null;
  }

  /**
   * Cleanup khi kết thúc
   */
  public destroy(): void {
    if (this.taskCheckTimer) clearInterval(this.taskCheckTimer);
    for (const timeout of this.statusDebounce.values()) clearTimeout(timeout);
    this.statusDebounce.clear();
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    this.retryAttempts.clear();
  }
}