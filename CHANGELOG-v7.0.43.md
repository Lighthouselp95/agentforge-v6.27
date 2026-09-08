# CHANGELOG-v7.0.43.md

## Phiên bản v7.0.43 (Phát hành: 2026-09-06)

Phiên bản `v7.0.43` là bản phát hành hoàn thiện toàn diện về độ ổn định streaming, khả năng xử lý tương tác thời gian thực và độ chính xác của cơ chế tự điều phối tác vụ:

---

### 1. Khử Triệt Để Double User Message (`web/src/components/ChatPanel.tsx`, `web/src/App.tsx`)
- **Duyệt Lịch Sử Chặt Chẽ**:
  - Áp dụng logic `hasPriorUserMsg = visibleMessages.slice(0, idx).some(...)` để ngăn chặn hoàn toàn việc hiển thị trùng lặp tin nhắn của người dùng trong khung chat.
  - Tối ưu hàm `fetchHistory()` quét tìm và thay thế in-place tin tạm `temp-` bằng ID chuẩn canonical từ server trong cửa sổ 60s.

---

### 2. Khắc Phục Ngâm Thẻ Talk & Stream-First Live Render (`src/server.ts`)
- **Cắt Lát & Render Tức Thì**:
  - Tối ưu hàm `scanStreamForDispatch`: Khi phát hiện thẻ `<talk>` trọn vẹn trong luồng stream, hệ thống lập tức tạo `ChatMsg`, lưu vào cơ sở dữ liệu và phát `broadcast('chat:message')` hiển thị bong bóng chat ngay lập tức lên UI mà không cần đợi kết thúc turn.
  - Chuyển trạng thái agent nhận thành `working` ngay lập tức, dập tắt tình trạng ngâm bong bóng giao việc.

---

### 3. Chặn Nhảy Cóc Task `pending` $\rightarrow$ `completed` & Ràng Buộc Tuần Tự (`src/storage/agent-storage.ts`, `src/server.ts`)
- **Ngăn Chặn Đóng Task Chưa Thực Hiện**:
  - Bổ sung chốt chặn trong `checkSequentialTaskCompletion`: Nếu task tại vị trí cần đóng đang ở trạng thái `pending`, hệ thống lập tức từ chối và phản hồi:
    `[TASK_UPDATE_REJECTED] Không thể đóng task #N: Task đang ở trạng thái 'pending' (chưa thực hiện). Hãy thực hiện task (chuyển sang 'working') trước khi đóng task này!`
- **Ràng Buộc Hoàn Thành Tuần Tự**:
  - Task N chỉ được phép đóng khi toàn bộ các task từ 1 đến N-1 đã ở trạng thái `completed`.
- **Phản Hồi Lỗi Hai Chiều Trực Tiếp**:
  - Lỗi được gửi thẳng vào context làm việc của chính worker thông qua `deliverTalk` để agent nắm rõ và tự khắc phục.

---

### 4. Cấu Trúc Parts Tuần Tự Xen Kẽ (`src/agents/acp-client.ts`, `src/agents/types.ts`, `src/server.ts`)
- **MessagePart Chuẩn**:
  - Định nghĩa interface `MessagePart` chuẩn gồm `{ type: 'thinking' | 'text' | 'tool', content, tool, input, output, callId }`.
  - Parse các event OpenCode JSONL tuần tự theo thời gian: gom stream thinking/text, ghép nối output cho tool_result chính xác theo `callId`.
  - Lưu trữ trường `parts` có cấu trúc vào cơ sở dữ liệu `agentforge-state.json`.

---

### 6. Xóa Bỏ Hoàn Toàn Broadcast Cuối Turn & Mở Khóa Stream Toàn Diện (`src/server.ts`)
- **Triệt Tiêu Final Pass Broadcast**:
  - Xóa bỏ hoàn toàn lệnh `broadcast('chat:message')` ở cuối turn trong `handleOrchestratorResponse` và `handleAgentResponse`. Tin nhắn chỉ được lưu vào DB để phục vụ tra cứu lịch sử, không phát lại đè lên stream UI.
- **Mở Khóa Toàn Diện Luồng Stream (`scanStreamForDispatch`)**:
  - Bỏ chặn thẻ `<talk target="orchestrator">` trong stream: Worker báo cáo về Orchestrator được phân tích, lưu DB, phát thẻ giao việc và kích hoạt `triggerOrchestrator` tức thì ngay trong luồng live stream.
  - Quét và thực thi tức thời các lệnh `<task_update>` ngay trong stream khi agent phát ra.
- **Tự Động Reset Idle & Xả Hàng Đợi Khi Boot Sequence Hoàn Tất**:
  - Chuẩn hóa 100% agent về `idle` khi nạp DB (`loadState`), dập tắt triệt để hiện tượng kẹt queue do zombie working state sau khi restart mà không cần người dùng bấm STOP.
  - Tự động kích hoạt `processNextBackendUserQueue` trong Bước 5 của Boot Sequence.
