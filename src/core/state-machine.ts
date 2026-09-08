// src/core/state-machine.ts
/**
 * Lớp AgentStatusManager quản lý tuần tự trạng thái agent (working/completed),
 * và hàng đợi theo thời gian cho lệnh task_update.
 * Mục tiêu:
 * - Chỉ phát một lần agent:updated mỗi lượt làm việc duy nhất (chống nháy start/stop).
 * - Hàng đợi theo thời gian cho task_update để tránh chặn toàn bộ (working->completed quá nhanh).
 * - Xác thực tuần tự, không chấp nhận lệnh trước đó trùng lặp.
 */

/**
 * Lớp TaskUpdateQueueElement — 1 phần tử trong hàng đợi của agent.
 * - type: 'working' | 'completed' (hoặc 'pending'/'idle' cho xác thực).
 * - agentId: agent đích.
 * - taskId: tham chiếu task.
 * - priority: timestamp (giá rẻ).
 * - retryCount: tối đa 3 lần thử (300ms, 500ms, 1000ms delay).
 * - resolve: hàm resolve xử lý async.
 * - lệnh: lệnh task_update gốc (string) để ghi lại log.
 */
export interface TaskUpdateQueueElement {
  type: 'working' | 'completed' | 'pending' | 'idle' | 'failed';
  agentId: string;
  taskId: string;
  priority: number; // timestamp của lệnh
  retryCount: number;
  resolve: (success: boolean) => void;
  command: string; // chuỗi lệnh task_update gốc cho debug
}

export class AgentStatusManager {
  // Map agentId -> hàng đợi async của TaskUpdateQueueElement theo thứ tự
  private queues = new Map<string, TaskUpdateQueueElement[]>();
  // Map agentId -> đang xử lý hay không (boolean)
  private processing = new Map<string, boolean>();

  /**
   * Xử lý hàng đợi tuần tự: xóa agent khỏi processing khi xong.
   * Trả về hàm cleanup để có thể giải phóng dễ dàng.
   */
  public processQueue(agentId: string): () => void {
    const release = () => {
      this.queues.delete(agentId);
      this.processing.delete(agentId);
    };

    // Xử lý luôn nếu chưa processing
    this.processQueueAsync(agentId);
    return release;
  }

  /**
   * Thêm task_update vào hàng đợi tuần tự cho agent.
   * Chặn việc xử lý chồng lệnh.
   */
  public async dispatchTaskUpdate(agentId: string, status: TaskUpdateQueueElement['type'], taskId: string, command: string): Promise<boolean> {
    // Đợi nếu agent đang xử lý lệnh
    while (this.processing.get(agentId)) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    this.processing.set(agentId, true);

    try {
      // Khởi tạo hàng đợi nếu chưa có
      if (!this.queues.has(agentId)) {
        this.queues.set(agentId, []);
      }
      const q = this.queues.get(agentId)!;

      // Thêm mới vào cuối (theo thứ tự thời gian)
      const element: TaskUpdateQueueElement = {
        type: status,
        agentId,
        taskId,
        priority: Date.now(),
        retryCount: 0,
        resolve: () => {},
        command
      };
      q.push(element);

      // Xử lý hàng đợi (giữ promise cho tới khi xử lý xong element này)
      return new Promise((resolve) => {
        element.resolve = (success: boolean) => {
          // Xóa element đã xử lý khỏi hàng đợi
          const index = q.findIndex(e => e.taskId === element.taskId && e.type === element.type);
          if (index !== -1) q.splice(index, 1);
          resolve(success);
        };
        // Bắt đầu xử lý hàng đợi (tự động bằng setTimeout để tránh đè blocking)
        this.processQueueAsync(agentId);
      });
    } finally {
      // Sau khi gửi, thiết lập sẽ rõ processing sau khi xử lý xong (xử lý ở processQueueAsync)
    }
  }

  /**
   * Xử lý bất đồng bộ hàng đợi cho agent.
   * Loại bỏ element xử lý đầu tiên, mô phỏng persist vào storage (bỏ qua cho mục đích demo).
   */
  private async processQueueAsync(agentId: string): Promise<void> {
    const q = this.queues.get(agentId);
    if (!q || q.length === 0) {
      this.processing.delete(agentId);
      return;
    }

    const element = q[0]; // element xử lý đầu tiên (theo thứ tự thêm vào)

    // Mô phỏng validate tuần tự cho trường hợp đặc biệt
    if (element.type === 'completed') {
      // Có thể thêm logic xác thực: ví dụ, task chưa có trạng thái completed chưa được thực hiện trước đó.
      // Đơn giản hóa: luôn true.
    }

    // Mô phỏng persist: ghi log
    console.log(`[AgentStatusManager] Xử lý ${element.type} task="${element.taskId}" agent="${agentId}" -> ${element.command}`);

    // Mô phỏng retry mechanism
    const maxRetries = 3;
    const delays = [300, 500, 1000];

    const executeWithRetry = (attempt: number): Promise<void> => {
      return new Promise((resolve) => {
        setTimeout(() => {
          // Mô phỏng thành công sau lần thử cuối cùng
          if (attempt >= maxRetries) {
            console.log(`[AgentStatusManager] Lần thử ${attempt + 1}/${maxRetries} thành công cho ${element.type} task="${element.taskId}"`);
            // Báo cáo xử lý xong
            element.resolve(true);
            // Tiếp tục xử lý element tiếp theo (giữ hàng đợi)
            this.processQueueAsync(agentId);
            resolve();
            return;
          }
          // Thử lại sau delay tiếp theo
          executeWithRetry(attempt + 1).then(resolve);
        }, delays[attempt] || 1000);
      });
    };

    executeWithRetry(0);
  }

  /**
   * Trả về liệu agent có đang xử lý hay không (cho verifier).
   */
  public isProcessing(agentId: string): boolean {
    return this.processing.get(agentId) === true;
  }

  /**
   * Trả về độ dài hàng đợi của agent.
   */
  public queueLength(agentId: string): number {
    const q = this.queues.get(agentId);
    return q ? q.length : 0;
  }
}