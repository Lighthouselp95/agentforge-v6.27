// src/core/task-queue-config.ts
/**
 * Cấu hình cho TaskQueueManager.
 * - idleDetectionMs: thời gian tối thiểu để agent được coi là idle (default: 30s)
 * - taskCheckIntervalMs: khoảng thời gian để agent tìm task mới từ queue (default: 1min)
 * - blockCriticalTasks: có giữ lại các task critical (ví dụ: task type system-critical) hay không
 */
export interface TaskQueueConfig {
  idleDetectionMs: number;
  taskCheckIntervalMs: number;
  blockCriticalTasks?: boolean;
}