# Báo Cáo Phát Hành Phiên Bản v7.0.40 (2026-09-05)

## 1. Mục Tiêu Phiên Bản
Phiên bản **v7.0.40** giải quyết triệt để vấn đề spinner xoay vô hạn khi agent hoàn tất tác vụ, dập tắt tận gốc hiện tượng nhân đôi tin nhắn người dùng và nhân ba tin nhắn agent, đồng thời hoàn thiện hệ thống hàng đợi chuyên biệt với nút xóa thật kết nối trực tiếp backend.

---

## 2. Chi Tiết Các Cải Tiến

### A. Dập Tắt Triệt Để Treo Stream Xoay Xoay (Stream Hang Fix)
- **Frontend (`web/src/components/ChatPanel.tsx`)**:
  - Tích hợp hook listener giám sát trạng thái vòng đời agent.
  - Ngay khi agent chuyển sang trạng thái `idle` hoặc `completed`, cờ `isStreaming` lập tức được reset về `false`, xóa sạch animation xoay loading kéo dài.

### B. Khử Trùng Lặp Đa Tầng (Multi-Tier Deduplication)
- **Frontend & Backend (`src/server.ts`, `web/src/components/ChatPanel.tsx`)**:
  - Đối soát nội dung chuẩn hóa NFC với cửa sổ thời gian 60 giây đối với tin nhắn người dùng và 15-30 giây đối với tin nhắn agent.
  - Tuyệt đối không broadcast bong bóng tin nhắn giao việc lên UI của agent khi task đó vẫn đang nằm trong hàng đợi chờ spawn.

### C. Queue UI Chuyên Biệt & Nút [X] Xóa Thật Khỏi Backend
- **Frontend & API (`web/src/components/ChatPanel.tsx`, `src/routes/agents.ts`)**:
  - Loại bỏ hoàn toàn hiển thị hàng đợi gây rối trên giao diện của các Agent con.
  - Nút [X] trên bong bóng hàng đợi của người dùng gửi yêu cầu HTTP DELETE xóa trực tiếp khỏi mảng `backendUserQueues` ở backend.

### D. Tối Ưu Hóa Giao Diện Phẳng Nghệ Thuật
- Thẻ Tên đen tuyền `#000000` bo góc thanh thoát 6px, Thẻ Task xám tro `#475569`.
- Nút copy `📋` phủ rộng 100% trên toàn bộ các loại bong bóng chat.

### E. Quyền Hạn Task Status & Khử Lặp Directive (Stream vs Final Pass)
- **Quyền Hạn Cập Nhật Task Status**:
  - Chỉ agent sở hữu nhiệm vụ mới có quyền cập nhật trạng thái nhiệm vụ (`pending` -> `working` -> `completed`) thông qua cú pháp `<task_update task="N" status="..." />`.
  - Tước bỏ hoàn toàn quyền sửa trạng thái task của worker từ Orchestrator (chặn và phản hồi `TASK_UPDATE_UNAUTHORIZED`).
  - Cho phép worker gọi `<task_update>` không bắt buộc truyền thuộc tính `agent` (mặc định lấy `fromAgent`), chặn can thiệp task chéo giữa các worker.
  - Bổ sung hướng dẫn tự cập nhật task vào `WORKER_REMINDER`.
  - Loại bỏ hoàn toàn cú pháp `<task_update>` dành cho worker khỏi `ORCH_REMINDER`.
- **Deduplication Directive (Stream vs Final Pass)**:
  - Tích hợp hàm `isTalkAlreadyDispatched()` và `recordDispatchedTalk()` với đối soát 3 chiều: exact signature, base occurrence index, và fuzzy sender-receiver-content.
  - Ngăn chặn hoàn toàn việc dispatch lặp lệnh `<talk>` và `<spawn>` giữa luồng streaming chunk (`scanStreamForDispatch`) và lượt tổng hợp cuối (`handleAgentResponse` / `handleOrchestratorResponse`).
  - Bỏ kích hoạt enqueue prompt kép khi Orchestrator vừa phát lệnh `<spawn>` vừa phát `<talk>` hướng tới cùng một worker trong cùng một response.
  - Tự động đặt agent status về `idle` an toàn trong khối `finally` và phát sự kiện `chat:stream:end` kết thúc lượt.

---

## 3. Quy Trình Đóng Gói An Toàn (Safe Packaging)
- Sử dụng trực tiếp module `postject/dist/api.js` với cờ `--overwrite` và sentinel fuse của Node.js SEA.
- Tuyệt đối giữ nguyên tiến trình v7.0.39 phục vụ người dùng cho đến khi file `release/agentforge-web-v7.0.40.exe` đã nằm trọn vẹn trên đĩa cứng.
