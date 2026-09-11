// src/core/watchdog.ts
/**
 * WatchdogManager - monitors agent activity and sends reminders for stalled work
 * 
 * Features:
 * - Tracks stream activity per agent (resets on each stream:chunk)
 * - If no stream activity for 30s AND task not completed → send reminder
 * - If agent idle for 15s AND task not completed → send reminder
 * 
 * Integrates with:
 * - StreamController (via stream:chunk events to reset activity timer)
 * - AgentStatusManager (via status changes to detect idle)
 * - Storage (to check task completion status)
 */

import { storage } from '../storage.js';
import type { Agent } from '../agents/agent-manager.js';

const getStorage = () => storage;

// Reminder message templates
const REMINDER_MESSAGES = {
  streamInactivity: (agentId: string, taskDescription: string) =>
    `[WATCHDOG REMINDER] Bạn đang có công việc chưa hoàn thành: "${taskDescription}". Tiến trình đã ngừng sinh stream quá 30s (đã reset ngắt tiến trình cũ để tiếp tục).
- Nếu bắt đầu làm việc: hãy dùng <task_update task="1" status="working" />.
- Nếu công việc đã xong: hãy đánh giá hoàn tất bằng: <task_update task="1" status="completed" /> (yêu cầu task phải ở trạng thái working trước khi completed).
- Nếu hủy bỏ/không thực hiện task này: dùng: <task_update task="1" status="cancel" /> (có thể hủy trực tiếp từ pending hoặc working).
- Nếu phát sinh việc mới cho chính mình: có thể tự lên task bằng: <talk target="${agentId}" task="Tên task mới">Chi tiết công việc...</talk>`,
  
  idleTimeout: (agentId: string, taskDescription: string) =>
    `[WATCHDOG REMINDER] Bạn đang có công việc chưa hoàn thành trong danh sách: "${taskDescription}" nhưng đã ở trạng thái idle hơn 15 giây.
- Nếu bắt đầu xử lý: hãy cập nhật tiến độ bằng: <task_update task="1" status="working" />.
- Nếu công việc đã xong: hãy đánh giá hoàn tất bằng: <task_update task="1" status="completed" /> (yêu cầu task phải ở trạng thái working trước khi completed).
- Nếu hủy bỏ/không cần làm task này nữa: dùng: <task_update task="1" status="cancel" /> (hủy trực tiếp được từ pending).
- Nếu cần lên task mới cho bản thân: hãy dùng thẻ: <talk target="${agentId}" task="Tên task mới">Chi tiết nhiệm vụ...</talk>`
};

// Singleton AgentStatusManager để tránh cấp phát lặp đi lặp lại và rò rỉ bộ nhớ
let cachedStatusManager: any = null;
async function getStatusManagerInstance() {
  if (!cachedStatusManager) {
    const { AgentStatusManager } = await import('./state-machine.js');
    cachedStatusManager = new AgentStatusManager();
  }
  return cachedStatusManager;
}

export class WatchdogManager {
  private streamActivityTimers = new Map<string, NodeJS.Timeout>();
  private idleTimers = new Map<string, NodeJS.Timeout>();
  private lastStreamActivity = new Map<string, number>(); // timestamp of last stream chunk
  // QUY TẮC MỚI CỦA TIMER 1:
  // - Chỉ bắt đầu tính giờ khi agent đã có ít nhất 1 chunk/response trả về thành công trong phiên làm việc hiện tại
  // - Chỉ nhắc tối đa 1 lần nếu sau đó stream bị ngưng hoàn toàn
  // - Cờ này chỉ được reset khi agent tiếp tục có chunk/response mới trả về thành công
  private hasReceivedStreamResponse = new Map<string, boolean>();
  private streamReminderSent = new Map<string, boolean>();

  // QUY TẮC MỚI CỦA TIMER 2 (Idle with incomplete job):
  // - Chỉ bắt đầu tính time idle khi agent ĐÃ CÓ ít nhất 1 request/response thành công trước đó
  // - Chỉ nhắc tối đa 1 lần duy nhất khi agent đang idle mà còn job
  // - Nếu đã nhắc 1 lần mà chưa có request/response thành công mới trả về -> Tuyệt đối không tính time và không nhắc lại
  // - Cờ này CHỈ ĐƯỢC RESET khi agent có request/response mới trả về thành công (onStreamActivity), sau đó mới bắt đầu tính time lại
  private hasReceivedResponseForIdle = new Map<string, boolean>();
  private idleReminderSent = new Map<string, boolean>();

  // QUY TẮC GLOBAL THROTTLE: Bất kể agent nào, các lượt gửi nhắc việc (ping reminder)
  // phải cách nhau tối thiểu 3 giây (3000ms) để không dồn ứ hệ thống
  private lastGlobalReminderTime = 0;
  private reminderQueue: Promise<void> = Promise.resolve();

  private checkInterval: NodeJS.Timeout | null = null;
  private broadcastFn: (type: string, data: any) => void = () => {};
  private storageRef: any = null;

  private onDeliverReminder?: (agent: Agent, message: string) => Promise<void>;

  constructor(broadcastFn?: (type: string, data: any) => void, onDeliverReminder?: (agent: Agent, message: string) => Promise<void>) {
    if (broadcastFn) {
      this.broadcastFn = broadcastFn;
    }
    if (onDeliverReminder) {
      this.onDeliverReminder = onDeliverReminder;
    }
  }

  public start(): void {
    if (this.checkInterval) return;
    // Chu kỳ quét trạng thái: 5 giây cho mode HTTP (nhẹ nhàng), 15 giây cho mode CLI subprocess
    this.checkInterval = setInterval(() => {
      this.checkAllAgents();
    }, 5000);

    // KHI KHỞI ĐỘNG APP:
    // Tuyệt đối không gửi nhắc dồn dập hàng loạt cho các agent cũ để tránh gây bão tiến trình và quá tải socket.
    // Watchdog chỉ bắt đầu theo dõi khi agent có hoạt động (active/working) trong phiên làm việc hiện tại.
  }

  /**
   * Quét và nhắc 1 lượt duy nhất lúc khởi động cho các agent đang idle nhưng còn task dở dang.
   */
  private async checkStartupIdleAgents(): Promise<void> {
    const isWatchdogEnabled = storage.getSetting('enableWatchdog', false) === true;
    if (!isWatchdogEnabled) return;

    const agents = storage.getAllAgents() || [];
    for (const agent of agents) {
      if (agent.type === 'orchestrator' || agent.status === 'stopped' || agent.status === 'error') {
        continue;
      }
      // Agent đang idle mà còn việc chưa hoàn thành
      if (agent.status === 'idle' && this.hasIncompleteTasks(agent)) {
        // Khởi tạo cờ lúc khởi động
        const alreadyReminded = this.idleReminderSent.get(agent.id) === true;
        if (!alreadyReminded) {
          console.log(`[WatchdogStartup] Phát hiện agent '${agent.name}' (${agent.id}) đang idle có task dở dang -> Gửi nhắc 1 lượt đầu tiên lúc boot.`);
          this.idleReminderSent.set(agent.id, true);
          this.hasReceivedResponseForIdle.set(agent.id, false); // Chưa có response mới
          await this.sendReminder(agent, 'idle');
          this.setLastReminderTime(agent.id, 'idle');
        }
      }
    }
  }

  public setDeliverReminder(fn: (agent: Agent, message: string) => Promise<void>): void {
    this.onDeliverReminder = fn;
  }

  public setBroadcast(fn: (type: string, data: any) => void): void {
    this.broadcastFn = fn;
  }

  public setStorage(storage: any): void {
    this.storageRef = storage;
  }

  /**
   * Gọi khi có stream chunk/request trả về thành công:
   * 1. Đánh dấu đã nhận được request/response đầu tiên thành công -> bắt đầu cho phép tính timeout stream (Timer 1)
   * 2. Đánh dấu agent đã có request thành công -> cho phép Timer 2 (Idle) bắt đầu tính time khi agent về idle
   * 3. Reset cờ streamReminderSent về false (cho phép nhắc lại nếu sau này lại bị nghẽn tiếp)
   * 4. Reset cờ idleReminderSent về false (vì agent đã có request/response thành công mới)
   * 5. Cập nhật thời điểm lastStreamActivity
   */
  public onStreamActivity(agentId: string): void {
    this.lastStreamActivity.set(agentId, Date.now());
    this.hasReceivedStreamResponse.set(agentId, true);
    this.hasReceivedResponseForIdle.set(agentId, true);
    this.streamReminderSent.set(agentId, false);
    this.idleReminderSent.set(agentId, false);
    
    // Clear existing stream inactivity timer nếu có
    const streamTimer = this.streamActivityTimers.get(agentId);
    if (streamTimer) {
      clearTimeout(streamTimer);
      this.streamActivityTimers.delete(agentId);
    }
  }

  /**
   * Gọi khi agent chuyển sang trạng thái active/working mới:
   * Reset trạng thái chờ response ban đầu cho phiên làm việc mới
   */
  public onAgentActive(agentId: string): void {
    const idleTimer = this.idleTimers.get(agentId);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.idleTimers.delete(agentId);
    }
    // Khi bắt đầu một lượt prompt/task mới, chưa tính timeout cho đến khi có chunk đầu tiên trả về
    this.hasReceivedStreamResponse.set(agentId, false);
    this.streamReminderSent.set(agentId, false);
    this.lastStreamActivity.delete(agentId);
  }

  /**
   * Call when agent becomes idle (starts idle timer cho agent có incomplete tasks):
   * - Chỉ bắt đầu tính time khi agent ĐÃ CÓ request/response trả về thành công trước đó (hasReceivedResponseForIdle)
   * - Nếu agent chưa có response thành công nào hoặc đã bị nhắc 1 lần rồi mà chưa có response mới -> KHÔNG TÍNH TIME
   */
  public onAgentIdle(agentId: string): void {
    // Reset các cờ của stream khi agent về idle
    this.hasReceivedStreamResponse.delete(agentId);
    this.streamReminderSent.delete(agentId);
    this.lastStreamActivity.delete(agentId);

    const isWatchdogEnabled = storage.getSetting('enableWatchdog', false) === true;
    if (!isWatchdogEnabled) return;

    // Clear existing idle timer
    const idleTimer = this.idleTimers.get(agentId);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.idleTimers.delete(agentId);
    }

    // QUY TẮC TIMER 2:
    // 1. Phải có request/response thành công trước đó thì mới bắt đầu tính time
    if (this.hasReceivedResponseForIdle.get(agentId) !== true) {
      return; // Chưa có response thành công -> Không bắt đầu đếm giờ idle
    }

    // 2. Nếu đã nhắc 1 lần rồi mà chưa có request mới nào thành công trả về -> Không đếm giờ nhắc lại
    if (this.idleReminderSent.get(agentId) === true) {
      return;
    }

    // Lấy cấu hình idle timeout từ setting (mặc định 120s / 2 phút theo yêu cầu người dùng)
    const configuredIdleSec = Number(storage.getSetting('watchdogIdleTimeoutSec', storage.getSetting('taskQueueIdleCheckSec', 120))) || 120;
    const idleMs = Math.max(5000, configuredIdleSec * 1000);

    const timeout = setTimeout(() => {
      this.handleIdleTimeout(agentId);
    }, idleMs);
    
    this.idleTimers.set(agentId, timeout);
  }

  /**
   * Call when task is completed (stops all timers for agent)
   */
  public onTaskCompleted(agentId: string): void {
    this.clearAgentTimers(agentId);
  }

  /**
   * Clear all timers for an agent
   */
  private clearAgentTimers(agentId: string): void {
    const streamTimer = this.streamActivityTimers.get(agentId);
    if (streamTimer) {
      clearTimeout(streamTimer);
      this.streamActivityTimers.delete(agentId);
    }

    const idleTimer = this.idleTimers.get(agentId);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.idleTimers.delete(agentId);
    }

    this.lastStreamActivity.delete(agentId);
    this.hasReceivedStreamResponse.delete(agentId);
    this.streamReminderSent.delete(agentId);
  }

  /**
   * Check all agents for reminder conditions
   */
  private async checkAllAgents(): Promise<void> {
    const isWatchdogEnabled = storage.getSetting('enableWatchdog', false) === true;
    if (!isWatchdogEnabled) return;

    const agents = storage.getAllAgents() || [];
    
    for (const agent of agents) {
      // Skip orchestrator and stopped/error agents
      if (agent.type === 'orchestrator' || 
          agent.status === 'stopped' || 
          agent.status === 'error') {
        continue;
      }

      // Check if agent has any incomplete tasks
      const hasIncompleteTasks = this.hasIncompleteTasks(agent);
      if (!hasIncompleteTasks) {
        // Clear timers if all tasks are completed
        this.clearAgentTimers(agent.id);
        continue;
      }

      // Check stream inactivity (30s)
      await this.checkStreamInactivity(agent);
      
      // Note: Idle timeout is handled by onAgentIdle -> setTimeout -> handleIdleTimeout
    }
  }

  /**
   * Check if agent has any incomplete tasks
   */
  private hasIncompleteTasks(agent: Agent): boolean {
    // 1. Kiểm tra mảng tasks (SSoT cho danh sách task của agent)
    if (Array.isArray(agent.tasks) && agent.tasks.length > 0) {
      return agent.tasks.some(task => 
        (task.status as string) !== 'completed' && 
        task.task && 
        typeof task.task === 'string' && 
        task.task.trim().length > 0
      );
    }

    // 2. Chỉ khi không có mảng tasks, mới kiểm tra chuỗi agent.task
    if (agent.task && typeof agent.task === 'string' && agent.task.trim().length > 0) {
      const lower = agent.task.trim().toLowerCase();
      // Bỏ qua các chuỗi trạng thái không phải task dở dang
      if (
        lower === 'sẵn sàng' || 
        lower === 'san sang' || 
        lower === 'ready' || 
        lower === 'idle' || 
        lower === 'chờ việc' ||
        lower.startsWith('đã hoàn thành') ||
        lower.startsWith('hoàn tất')
      ) {
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Check stream inactivity for an agent (Timer 1: Working Stalled):
   * - Chỉ bắt đầu tính giờ KHI ĐÃ CÓ request/chunk đầu tiên trả về thành công trong phiên làm việc hiện tại
   * - Nếu bị ngưng stream quá threshold, chỉ nhắc ĐÚNG 1 LẦN DUY NHẤT.
   * - Tuyệt đối không nhắc lại nếu không có thêm bất kỳ request/response nào trả về thành công từ agent.
   */
  private async checkStreamInactivity(agent: Agent): Promise<void> {
    if (agent.status !== 'working') return;

    // 1. Chỉ tính giờ khi ĐÃ CÓ request/response đầu tiên trả về thành công
    const hasReceivedFirstResponse = this.hasReceivedStreamResponse.get(agent.id) === true;
    if (!hasReceivedFirstResponse) {
      return; // Chưa có request/chunk nào trả về -> Không tính thời gian treo stream
    }

    // 2. Nếu đã gửi nhắc việc 1 lần rồi mà chưa có request mới nào trả về thành công -> Không nhắc tiếp (không spam)
    const alreadyReminded = this.streamReminderSent.get(agent.id) === true;
    if (alreadyReminded) {
      return;
    }

    // 3. Cooldown guard: Tối thiểu 60s giữa các lần nhắc cùng loại cho 1 agent
    const lastReminder = this.getLastReminderTime(agent.id, 'stream');
    if (lastReminder && (Date.now() - lastReminder < 60000)) {
      return;
    }

    const lastActivity = this.lastStreamActivity.get(agent.id);
    if (!lastActivity) return;

    const inactiveFor = Date.now() - lastActivity;
    const configuredTimeoutSec = Number(storage.getSetting('watchdogStreamTimeoutSec', 60)) || 60; // Mặc định 60s (1 phút)
    const thresholdMs = Math.max(5000, configuredTimeoutSec * 1000);

    if (inactiveFor >= thresholdMs) {
      // Đánh dấu đã nhắc 1 lần duy nhất cho đợt nghẽn này
      this.streamReminderSent.set(agent.id, true);
      await this.sendReminder(agent, 'stream');
      this.setLastReminderTime(agent.id, 'stream');
      console.log(`[Watchdog] Timer 1: Đã nhắc 1 lần duy nhất cho agent '${agent.name}' (${agent.id}). Sẽ không nhắc lại trừ khi có request/response mới thành công.`);
    }
  }

  /**
   * Handle idle timeout (Timer 2: Idle With Incomplete Job)
   * - Chỉ nhắc tối đa 1 lần duy nhất khi agent đang idle mà còn job
   * - Nếu đã nhắc 1 lần mà chưa có request/response thành công trả về -> Không nhắc tiếp (không spam)
   * - Phải cách lượt ping của agent khác tối thiểu 3 giây
   */
  private async handleIdleTimeout(agentId: string): Promise<void> {
    const agent = storage.getAgent(agentId);
    if (!agent) return;

    // Skip if not worker or if in error/stopped state
    if (agent.type === 'orchestrator' || 
        agent.status === 'stopped' || 
        agent.status === 'error') {
      return;
    }

    // Check if agent has any incomplete tasks
    if (!this.hasIncompleteTasks(agent)) {
      return; // All tasks completed, no reminder needed
    }

    // Nếu đã gửi nhắc việc idle 1 lần rồi mà chưa có phản hồi/response thành công -> Không nhắc tiếp
    if (this.idleReminderSent.get(agentId) === true) {
      return;
    }

    // Đánh dấu đã gửi nhắc idle 1 lần duy nhất
    this.idleReminderSent.set(agentId, true);
    await this.sendReminder(agent, 'idle');
    this.setLastReminderTime(agentId, 'idle');
    console.log(`[Watchdog] Timer 2: Đã nhắc 1 lần duy nhất cho agent '${agent.name}' (${agentId}). Sẽ không nhắc lại trừ khi có request/response mới thành công.`);
  }

  /**
   * Send reminder to agent:
   * Giãn cách hàng đợi thông minh:
   * - Chế độ HTTP: fetch REST/SSE thuần cực nhẹ, chỉ cần giãn cách ngắn (~300ms) để không dồn cục kết nối.
   * - Chế độ CLI (attach/run): cần giãn cách ~3 giây để OS không bị quá tải khi spawn subprocess.
   */
  private async sendReminder(agent: Agent, type: 'stream' | 'idle'): Promise<void> {
    this.reminderQueue = this.reminderQueue.then(async () => {
      try {
        const mode = storage.getSetting('engineMode', 'http');
        const minSpacingMs = (mode === 'http') ? 300 : 3000;
        const now = Date.now();
        const timeSinceLast = now - this.lastGlobalReminderTime;
        if (timeSinceLast < minSpacingMs) {
          const delayMs = minSpacingMs - timeSinceLast;
          await new Promise(res => setTimeout(res, delayMs));
        }
        this.lastGlobalReminderTime = Date.now();

        // Get the agent's current task description
        let taskDescription = 'No active task';
        
        if (Array.isArray(agent.tasks) && agent.tasks.length > 0) {
          // Find first incomplete task
          const incompleteTask = agent.tasks.find(task => 
            task.status !== 'completed' && 
            task.status !== 'cancelled' &&
            task.task && 
            typeof task.task === 'string' && 
            task.task.trim().length > 0
          );
          if (incompleteTask) {
            taskDescription = incompleteTask.task;
          }
        }
        
        if (taskDescription === 'No active task' && agent.task && typeof agent.task === 'string' && agent.task.trim().length > 0) {
          taskDescription = agent.task;
        }

        // Select appropriate reminder message
        const messageTemplate = REMINDER_MESSAGES[
          type === 'stream' ? 'streamInactivity' : 'idleTimeout'
        ];
        
        const reminderMessage = messageTemplate(agent.id, taskDescription);

        // Send task_update reminder via singleton AgentStatusManager
        const statusManager = await getStatusManagerInstance();
        
        const taskId = `watchdog-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        statusManager.dispatchTaskUpdate(
          agent.id,
          'working', // status
          taskId,
          `<task_update agent="${agent.id}" task="${reminderMessage}" status="working" />`
        ).catch(() => {});
   
        // Also broadcast as system message for visibility
        this.broadcastFn('system:watchdog', {
          agentId: agent.id,
          teamId: agent.teamId,
          type,
          message: reminderMessage,
          timestamp: Date.now()
        });

        // Nếu có registered deliver reminder hook (deliverTalk vào context thật của agent), gọi gửi trực tiếp
        if (this.onDeliverReminder) {
          console.log(`[Watchdog] Invoking onDeliverReminder for ${agent.name} (${agent.id}) [Global 3s Spacing]...`);
          await this.onDeliverReminder(agent, reminderMessage);
        } else {
          console.warn(`[Watchdog] Warning: onDeliverReminder is NOT registered in WatchdogManager!`);
        }

        console.log(`[Watchdog] Sent ${type} reminder to agent ${agent.id}`);
      } catch (error) {
        console.error(`[Watchdog] Failed to send reminder to agent ${agent.id}:`, error);
      }
    });

    return this.reminderQueue;
  }

  private lastReminders = new Map<string, number>();

  /**
   * Get last reminder time for agent and type
   */
  private getLastReminderTime(agentId: string, type: 'stream' | 'idle'): number | null {
    const key = `${agentId}:${type}`;
    return this.lastReminders.get(key) || null;
  }

  /**
   * Set last reminder time for agent and type
   */
  private setLastReminderTime(agentId: string, type: 'stream' | 'idle'): void {
    const key = `${agentId}:${type}`;
    this.lastReminders.set(key, Date.now());
  }

  /**
   * Cleanup when shutting down
   */
  public destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Clear all timers
    for (const timer of this.streamActivityTimers.values()) {
      clearTimeout(timer);
    }
    this.streamActivityTimers.clear();

    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();

    this.lastStreamActivity.clear();
  }
}

// Export a singleton instance
export const watchdogManager = new WatchdogManager();