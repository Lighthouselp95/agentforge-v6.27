# CHANGELOG-v7.0.42.md

## Phiên bản v7.0.42 (Phát hành: 2026-09-06)

Phiên bản `v7.0.42` là một cột mốc kỹ thuật quan trọng của hệ thống AgentForge, tập trung giải quyết triệt để 6 vấn đề lớn về kiến trúc streaming, giao diện thời gian thực và độ chính xác của cơ chế tự điều phối tác vụ:

---

### 1. Cấu Trúc Parts Tuần Tự & Stream-First (`src/agents/acp-client.ts`, `src/agents/types.ts`, `src/server.ts`)
- **Định nghĩa Giao diện Chuẩn `MessagePart`**:
  ```typescript
  export interface MessagePart {
    type: 'thinking' | 'text' | 'tool';
    content?: string;
    tool?: string;
    input?: any;
    output?: any;
    callId?: string;
  }
  ```
- **Xử lý sự kiện JSONL theo trình tự phát sinh thời gian thực**:
  - Không gom thành một khối text duy nhất cuối lượt.
  - Tự động tích lũy các phần suy nghĩ (`thinking`/`thought`) và phản hồi (`text`/`assistant`).
  - Phân tích sự kiện `tool_use`/`tool_call` tạo thẻ tool.
  - Phân tích sự kiện `tool_result`: So khớp chính xác theo `callId` (hoặc thẻ tool chưa có output gần nhất) để cập nhật trường `output` ngay khi công cụ hoàn tất.
- **Lưu trữ Cấu Trúc Bền Vững**:
  - Trường `parts` được đưa vào `ChatMsg` và persist an toàn trong `agentforge-state.json`.

---

### 2. Dung Lỗi (Tolerance) Cho Lệnh `<task_update>` (`src/server.ts`)
- **Tự động nhận diện Agent**:
  - Khi worker phát thẻ `<task_update task="N" status="..." />` mà không kèm thuộc tính `agent="..."`, hệ thống tự động gán mục tiêu là chính agent gửi (`target = fromAgent`).
  - Nếu có thuộc tính `agent="..."` trùng khớp với sender ID hoặc sender name, hệ thống chấp nhận hợp lệ.
  - Chấm dứt hiện tượng lệnh task update của worker bị từ chối chỉ vì thiếu định danh agent.

---

### 3. Ràng Buộc Hoàn Thành Tuần Tự & Phản Hồi Lỗi Trực Tiếp Cho Agent (`src/server.ts`, `src/storage/agent-storage.ts`)
- **Kiểm tra Điều Kiện Tiên Quyết Khi `status === 'completed'`**:
  - Khi agent gọi `<task_update task="N" status="completed" />`, hệ thống duyệt kiểm tra các task từ 1 đến N-1.
  - Nếu có bất kỳ task nào trước đó chưa hoàn thành (`status !== 'completed'`), hệ thống ngăn chặn việc đóng task và trả về thông báo lỗi:
    ```
    [TASK_UPDATE_REJECTED] Không thể đóng task #N: Hãy hoàn thành task/job trước (#M) để có thể đóng task này! Quy định: Các task phải được hoàn thành tuần tự từ trước ra sau.
    ```
- **Phản Hồi Lỗi Hai Chiều Trực Tiếp**:
  - Lỗi được gửi thẳng vào context làm việc của chính worker thông qua `deliverTalk` để agent phát hiện ngay sai sót và tự động hoàn thành task theo thứ tự.

---

### 4. Căn Lề Bất Biến & Chống Nhảy Bong Bóng Chat (`web/src/components/ChatPanel.tsx`)
- **Cố định vị trí hiển thị**:
  - Tin nhắn do agent phát ra luôn giữ vững căn lề trái từ $t=0$ khi stream token đầu tiên cho đến khi kết thúc.
  - Loại bỏ hiện tượng nhảy bong bóng từ phải sang trái khi tin nhắn hoàn tất.

---

### 5. Live Stream Từng Chữ Vào Thẻ Giao Việc (Unclosed Tag Streaming)
- **Render Trực Tuyến Thẻ Giao Việc**:
  - Khi Orchestrator đang stream thẻ lệnh `<talk target="...">` hoặc `<spawn ...>`, giao diện bóc tách và stream từng chữ vào bên trong thẻ giao việc thời gian thực, không chờ thẻ đóng.

---

### 6. Tách Biệt State Bàn Phím Chống Lag & Dedup Triệt Để User Message
- **Input State Độc Lập**:
  - Tách state gõ phím của thanh nhập liệu khỏi re-render cycle của luồng streaming tin nhắn, đảm bảo tốc độ gõ phím đạt 60 FPS mượt mà.
- **Zero-Duplicate Guard Tại Tầng Render**:
  - Khử triệt để trùng lặp tin nhắn người dùng ở cấp độ hiển thị, loại bỏ hoàn toàn tình trạng bóng chat đôi khi chuyển tab hoặc tải lại trang.
