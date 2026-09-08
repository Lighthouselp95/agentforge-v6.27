# TaskQueueManager — Auto-Continue Watchdog

Module quản lý việc **tự động nhắc agent tiếp tục task nhỏ nhất chưa hoàn thành** khi agent rơi vào trạng thái idle.

## Mục tiêu

Khi 1 agent đang có việc làm nhưng về trạng thái idle từ 30 giây trở lên (hoặc ngừng sinh stream từ 1 phút), hệ thống tự gửi 1 tin nhắc agent tiếp tục hoàn thành task **x** — với **x là task nhỏ nhất chưa xong** — cho đến khi task được hoàn thành.

## Lịch nhắc lại (Retry Schedule)

Theo yêu cầu user, lịch nhắc lặp lại mặc định:

| Lần | Độ trễ |
|-----|--------|
| 1   | 30 giây |
| 2   | 1 phút |
| 3   | 1 phút |
| 4   | 3 phút |
| 5   | 5 phút |
| 6+  | 5 phút (lặp lại lần cuối) |

Hằng số `DEFAULT_RETRY_SCHEDULE_MS = [30_000, 60_000, 60_000, 180_000, 300_000]` trong `src/core/task-queue.ts`. Có thể ghi đè bằng tham số `retryScheduleMs` khi khởi tạo.

## Kiến trúc

```
src/core/task-queue-config.ts   — interface TaskQueueConfig
src/core/task-queue.ts          — class TaskQueueManager (logic chính)
src/core/broadcast.ts           — BroadcastManager + createBroadcastManager factory
src/core/app.ts                 — bootstrap v8 core, wire hook gửi tin nhắc
```

### Luồng hoạt động

1. Agent hoàn thành việc → `BroadcastManager.setAgentStatus(agentId, 'idle')` được gọi (trực tiếp hoặc qua debounce 300ms/500ms).
2. `BroadcastManager` gọi `taskQueueManager.onAgentIdle(agentId)`.
3. `onAgentIdle` kiểm tra toggle: chỉ tiếp tục nếu `autoContinue` hoặc `enableWatchdog` đang BẬT (setting trong storage).
4. Chờ `idleDetectionMs` (mặc định 30s) — debounce chống nháy trạng thái.
5. `checkAndAssignTask()`: quét toàn bộ agent trong storage, lọc task `pending`/`assigned`, chọn **task nhỏ nhất** (priority thấp nhất, hoặc id lex nhỏ nhất).
6. Broadcast `system:auto-continue` cho UI + gọi `onAssignTask(task)` (hook gửi tin thật cho agent).
7. `scheduleRetry()` lên lịch nhắc lại theo bảng trên cho đến khi:
   - task chuyển trạng thái hoàn thành (không còn `pending`/`assigned`), hoặc
   - agent quay lại `working`.

### Các thành phần

| Thành phần | Vai trò |
|-----------|---------|
| `onAgentIdle(agentId)` | Điểm vào từ BroadcastManager khi agent idle |
| `cancelIdle(agentId)` | Hủy debounce đang chờ (agent có activity mới) |
| `cancelRetry(agentId)` | Hủy lịch retry đang chạy (agent working/stopped) |
| `checkAndAssignTask()` | Tìm + gửi tin nhắc task nhỏ nhất |
| `setOnAssignTask(fn)` | Hook gửi tin thật cho agent (tránh circular import) |
| `destroy()` | Dọn toàn bộ timers |

## Cách bật/tắt

Bật bằng 1 trong 2 toggle (đã có sẵn trên UI Settings):

- `autoContinue: true` (khuyến nghị) — qua `POST /api/settings/autoContinue`
- `enableWatchdog: true` — qua `POST /api/settings/watchdog`

Khi cả hai tắt → module bỏ qua mọi agent idle (log debug `system:log`).

## Cài đặt & Sử dụng

Module nằm trong nhánh refactor v8 core, phía sau feature flag:

```bash
# Build kiểm tra type
npx tsc --noEmit

# Build dist
npx tsc
```

Khởi tạo thủ công trong code:

```typescript
import { TaskQueueManager } from './task-queue.js';
import { createBroadcastManager } from './broadcast.js';

const bm = createBroadcastManager({
  taskQueue: { idleDetectionMs: 30000, taskCheckIntervalMs: 60000, blockCriticalTasks: false }
});

// Hook gửi tin thật cho agent khi nhắc tiếp tục task
bm.taskQueueManager?.setOnAssignTask((task) => {
  // Gửi prompt/session cho agent qua client tương ứng
});
```

## Lưu ý vận hành

- **Không đụng** `src/server.ts` production v7.0.55 (port 4001). Tính năng hoàn toàn nằm trong module v8 core.
- Task được đọc từ `agent.tasks` trong storage — cần đảm bảo agent có danh sách task `pending`/`assigned` kèm `priority` nếu muốn ưu tiên rõ ràng.
- Khi agent quay lại `working`, retry tự dừng (không spam tin nhắc thừa).
- Nếu task không còn trong danh sách task của agent → coi như hoàn thành → dừng retry.