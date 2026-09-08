# Báo Cáo Phát Hành Phiên Bản v7.0.41 (2026-09-05)

## 1. Mục Tiêu Phiên Bản
Phiên bản **v7.0.41** giải quyết dứt điểm hiện tượng 2 bóng chat giao việc xuất hiện ở 2 bên giao diện, khắc phục triệt để lỗi nhân đôi tin nhắn người dùng khi focus hoặc reload trang, đồng thời siết chặt quy trình khởi động lại để bảo toàn tính nhất quán của hàng đợi và quét dọn các tiến trình mồ côi.

---

## 2. Chi Tiết Các Cải Tiến Trọng Yếu

### A. Triệt Tiêu Bóng Chat Giao Việc Kép 2 Bên (Unified Single Directive Card)
- **Frontend (`web/src/components/ChatPanel.tsx`)**:
  - Áp dụng guard clause cứng `if (isOrchestratorTask) return null;` trong hàm render bong bóng tin nhắn văn bản thông thường.
  - Khi Orchestrator phát lệnh `<talk target="..." task="...">`, hệ thống chỉ hiển thị **DUY NHẤT 1 Thẻ Giao Việc Độc Lập** (`UnifiedDirectiveCard`) với đầy đủ Badge tên Agent, Tiêu đề nhiệm vụ và nội dung Markdown mở rộng, loại bỏ hoàn toàn bong bóng text song song bên cạnh.

### B. Khử Double User Message Khi Focus / Reload Trang
- **Frontend (`web/src/App.tsx`)**:
  - Cải tiến logic `fetchHistory()`: Khi nhận danh sách lịch sử tin nhắn từ server, frontend tự động tìm kiếm các tin nhắn tạm thời mang tiền tố `temp-` có cùng nội dung trong cửa sổ thời gian 60 giây và **thay thế trực tiếp tại chỗ (in-place replacement)** bằng ID chuẩn canonical UUID.
  - Loại bỏ triệt để hành vi nối tiếp bản ghi (append duplicates) gây ra việc người dùng nhìn thấy 2 tin nhắn giống nhau.

### C. Siết Chặt Restart Lifecycle & Bảo Toàn Hàng Đợi (Outbox Drain Safe)
- **Backend (`src/storage/engine.ts`, `src/server.ts`)**:
  - Tự động chuyển toàn bộ các bản ghi Outbox đang ở trạng thái `in_flight` về `pending` khi server khởi động lại, bảo đảm không bị mất mát tác vụ dang dở.
  - Tích hợp tác vụ dọn dẹp các tiến trình nền `opencode.exe` mồ côi (zombie processes) sót lại từ phiên làm việc trước.

---

## 3. Quy Trình Đóng Gói An Toàn (Safe Packaging)
- Sử dụng trực tiếp module `postject/dist/api.js` với cờ `--overwrite` và sentinel fuse của Node.js SEA.
- Tuyệt đối giữ nguyên tiến trình v7.0.40 phục vụ người dùng cho đến khi file `release/agentforge-web-v7.0.41.exe` đã nằm trọn vẹn trên đĩa cứng.
