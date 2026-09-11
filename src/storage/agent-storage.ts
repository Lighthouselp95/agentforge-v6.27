import type { StorageEngine } from './engine.js';
import type { UpdateAgentOptions } from './types.js';

export class AgentStorage {
  constructor(private engine: StorageEngine) {}

  saveAgent(agent: any): void {
    const norm = {
      ...agent,
      sessionId: agent.sessionId || agent.session_id || null,
      session_id: agent.session_id || agent.sessionId || null,
      sessionTitle: agent.sessionTitle || agent.session_title || null,
      session_title: agent.session_title || agent.sessionTitle || null
    };
    this.engine.inMemoryAgents.set(agent.id, norm);
    this.engine.schedulePersist(true);
  }

  updateAgent(id: string, updates: UpdateAgentOptions): void {
    const existing = this.engine.inMemoryAgents.get(id) || {};
    
    // NGUYÊN TẮC BẤT DI BẤT DỊCH (IMMUTABLE SESSION & TITLE):
    // sessionId và sessionTitle chỉ được tạo/gán 1 lần duy nhất lúc tạo agent.
    // Nếu agent đã có sessionId hoặc sessionTitle hợp lệ, TUYỆT ĐỐI KHÔNG ghi đè, không cập nhật lại, không xóa về null!
    const effectiveSessionId = (existing.sessionId || existing.session_id)
      ? (existing.sessionId || existing.session_id)
      : ('sessionId' in updates && updates.sessionId ? updates.sessionId : null);

    const effectiveSessionTitle = (existing.sessionTitle || existing.session_title)
      ? (existing.sessionTitle || existing.session_title)
      : ('sessionTitle' in updates && updates.sessionTitle ? updates.sessionTitle : null);

    const updated = {
      ...existing,
      status: 'status' in updates ? updates.status : existing.status,
      sessionId: effectiveSessionId,
      session_id: effectiveSessionId,
      session_title: effectiveSessionTitle,
      sessionTitle: effectiveSessionTitle,
      model: 'model' in updates ? (updates.model !== undefined ? updates.model : null) : existing.model,
      working_since: 'workingSince' in updates ? (updates.workingSince !== undefined ? updates.workingSince : null) : existing.working_since,
      token_usage: 'tokenUsage' in updates ? (updates.tokenUsage !== undefined ? updates.tokenUsage : null) : existing.token_usage,
      context_length: 'contextLength' in updates ? (updates.contextLength !== undefined ? updates.contextLength : null) : existing.context_length,
      task: 'task' in updates ? updates.task : existing.task,
      tasks: 'tasks' in updates ? updates.tasks : existing.tasks,
      teamId: 'teamId' in updates ? updates.teamId : (existing.teamId || (id === 'orchestrator' ? 'default' : undefined)),
      spawnedBy: 'spawnedBy' in updates ? updates.spawnedBy : existing.spawnedBy
    };
    this.engine.inMemoryAgents.set(id, updated);
    // Khi có thay đổi trạng thái nhạy cảm (status, task, tasks, workingSince), sync tức thì xuống disk (immediate)
    const isCriticalStatusChange = 'status' in updates || 'task' in updates || 'tasks' in updates || 'workingSince' in updates;
    this.engine.schedulePersist(isCriticalStatusChange);
  }

  deleteAgent(id: string): void {
    this.engine.inMemoryAgents.delete(id);
    this.engine.schedulePersist(true);
  }

  getAllAgents(): any[] {
    return Array.from(this.engine.inMemoryAgents.values());
  }

  getAgent(id: string): any {
    return this.engine.inMemoryAgents.get(id);
  }

  updateAgentModel(id: string, model: string | null): boolean {
    const existing = this.engine.inMemoryAgents.get(id);
    if (!existing) return false;
    existing.model = model;
    this.engine.schedulePersist();
    return true;
  }

  loadAgents(): any[] {
    return Array.from(this.engine.inMemoryAgents.values());
  }
}

// ============ TASK COUNT & EVICTION (pure helpers, dùng chung server.ts + routes) ============

/**
 * true nếu entry trong agent.tasks chỉ là tin nhắn user thường, KHÔNG phải task giao việc.
 * Task giao việc thật có nguồn talk/spawn/task; entry chat thường mang role='user'/type='chat'.
 */
export function isUserChatTask(t: any): boolean {
  if (!t || typeof t !== 'object') return false;
  const role = String((t as any).role || '').toLowerCase().trim();
  if (role === 'user') return true;
  const type = String((t as any).type || '').toLowerCase().trim();
  if (type === 'chat') return true;
  return false;
}

/** Đếm task giao việc thực sự (loại trừ tin nhắn user thường; completed vẫn tính để trần 6 có ý nghĩa). */
export function countRealTasks(tasks: any[]): number {
  if (!Array.isArray(tasks)) return 0;
  let n = 0;
  for (const t of tasks) {
    if (!isUserChatTask(t)) n++;
  }
  return n;
}

/**
 * Đẩy task completed CŨ NHẤT (theo createdAt, bỏ qua entry user-chat) ra khỏi list
 * + re-index id 1..N. Trả true nếu đã đẩy (caller push task mới tiếp),
 * false nếu không còn task completed nào để dọn.
 */
export function evictOldestCompletedTask(tasks: any[]): boolean {
  if (!Array.isArray(tasks) || tasks.length === 0) return false;
  let oldestIdx = -1;
  let oldestTs = Infinity;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (!t || isUserChatTask(t) || t.status !== 'completed') continue;
    const ts = typeof t.createdAt === 'number' ? t.createdAt : i;
    if (ts < oldestTs) {
      oldestTs = ts;
      oldestIdx = i;
    }
  }
  if (oldestIdx === -1) return false;
  tasks.splice(oldestIdx, 1);
  tasks.forEach((t, idx) => {
    if (!t || typeof t !== 'object') return;
    (t as any).id = String(idx + 1);
    if (typeof (t as any).task === 'string' && /^#\d+\b/.test((t as any).task)) {
      (t as any).task = (t as any).task.replace(/^#\d+/, `#${(t as any).id}`);
    }
  });
  return true;
}

/**
 * Kiểm tra ràng buộc hoàn thành task tuần tự và hợp lệ:
 * 1. Task tại targetIndexZeroBased không được phép đóng nếu đang ở trạng thái 'pending' (bắt buộc phải chuyển sang 'working' trước).
 * 2. Task tại targetIndexZeroBased chỉ được phép đánh dấu status='completed' nếu TẤT CẢ các task trước nó (0..targetIndexZeroBased-1) đều đã có status === 'completed' hoặc 'cancelled'.
 */
export function checkSequentialTaskCompletion(tasks: any[], targetIndexZeroBased: number): { ok: boolean; error?: string; uncompletedTaskNum?: number } {
  if (!Array.isArray(tasks) || targetIndexZeroBased < 0 || targetIndexZeroBased >= tasks.length) return { ok: true };

  const curTask = tasks[targetIndexZeroBased];
  const curTaskNum = targetIndexZeroBased + 1;

  // 1. Chặn nhảy cóc từ pending -> completed (bắt buộc phải chuyển sang working trước)
  if (curTask && curTask.status === 'pending') {
    return {
      ok: false,
      uncompletedTaskNum: curTaskNum,
      error: `[TASK_UPDATE_REJECTED] Không thể đóng task #${curTaskNum}: Task đang ở trạng thái 'pending'. Hãy bắt đầu thực hiện task bằng cú pháp: <task_update task="${curTaskNum}" status="working" /> trước khi đóng task này! (Nếu muốn hủy bỏ task: <task_update task="${curTaskNum}" status="cancel" />)`
    };
  }

  // 2. Chặn nhảy cóc thứ tự tuần tự (các task trước phải completed hoặc cancelled)
  for (let i = 0; i < targetIndexZeroBased; i++) {
    const prev = tasks[i];
    if (prev && prev.status !== 'completed' && prev.status !== 'cancelled') {
      const prevTaskNum = i + 1;
      return {
        ok: false,
        uncompletedTaskNum: prevTaskNum,
        error: `[TASK_UPDATE_REJECTED] Không thể đóng task #${curTaskNum}: Hãy hoàn thành hoặc hủy task trước (#${prevTaskNum}) để có thể đóng task này! Quy định: Các task phải được hoàn thành tuần tự từ trước ra sau.`
      };
    }
  }
  return { ok: true };
}

/**
 * Kiểm tra ràng buộc hủy task ('cancelled'):
 * QUY TẮC:
 * 1. Cho phép hủy trực tiếp từ 'pending' hoặc 'working'.
 * 2. Không được phép hủy task đã hoàn thành ('completed').
 * 3. Các task trước nó (0..targetIndexZeroBased-1) phải đã kết thúc (completed hoặc cancelled).
 */
export function checkSequentialTaskCancellation(tasks: any[], targetIndexZeroBased: number): { ok: boolean; error?: string; uncompletedTaskNum?: number } {
  if (!Array.isArray(tasks) || targetIndexZeroBased < 0 || targetIndexZeroBased >= tasks.length) return { ok: true };

  const curTask = tasks[targetIndexZeroBased];
  const curTaskNum = targetIndexZeroBased + 1;

  if (curTask && curTask.status === 'completed') {
    return {
      ok: false,
      uncompletedTaskNum: curTaskNum,
      error: `[TASK_UPDATE_REJECTED] Không thể hủy task #${curTaskNum}: Task này đã ở trạng thái hoàn thành ('completed').`
    };
  }

  // Chặn nhảy cóc thứ tự tuần tự: Các task trước nó phải hoàn thành hoặc đã hủy
  for (let i = 0; i < targetIndexZeroBased; i++) {
    const prev = tasks[i];
    if (prev && prev.status !== 'completed' && prev.status !== 'cancelled') {
      const prevTaskNum = i + 1;
      return {
        ok: false,
        uncompletedTaskNum: prevTaskNum,
        error: `[TASK_UPDATE_REJECTED] Không thể hủy task #${curTaskNum}: Vui lòng xử lý task #${prevTaskNum} trước (<task_update task="${prevTaskNum}" status="working|completed|cancel" />)!`
      };
    }
  }
  return { ok: true };
}

/**
 * Kiểm tra ràng buộc bắt đầu thực hiện task ('working'):
 * QUY TẮC: Task sau (targetIndexZeroBased) CHỈ CÓ THỂ chuyển thành 'working' khi trước nó KHÔNG CÓ task nào đang 'pending' hoặc 'working'.
 * Nghĩa là tất cả các task trước nó (0..targetIndexZeroBased-1) đều phải đã completed hoặc cancelled.
 */
export function checkSequentialTaskWorking(tasks: any[], targetIndexZeroBased: number): { ok: boolean; error?: string; pendingTaskNum?: number; pendingTaskDesc?: string } {
  if (!Array.isArray(tasks) || targetIndexZeroBased <= 0 || targetIndexZeroBased >= tasks.length) return { ok: true };

  const curTaskNum = targetIndexZeroBased + 1;

  for (let i = 0; i < targetIndexZeroBased; i++) {
    const prev = tasks[i];
    if (prev && prev.status !== 'completed' && prev.status !== 'cancelled') {
      const pendingTaskNum = i + 1;
      return {
        ok: false,
        pendingTaskNum,
        pendingTaskDesc: prev.task || '',
        error: `[TASK_UPDATE_REJECTED] Không thể bắt đầu task #${curTaskNum}: Task trước nó (#${pendingTaskNum}: "${prev.task || ''}") vẫn chưa kết thúc (${prev.status}). Vui lòng giải quyết hoặc hủy task #${pendingTaskNum} trước (<task_update task="${pendingTaskNum}" status="working" /> rồi status="completed", hoặc <task_update task="${pendingTaskNum}" status="cancel" />)!`
      };
    }
  }

  return { ok: true };
}
