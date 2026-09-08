# Báo Cáo Phát Hành Phiên Bản v7.0.38 (2026-09-05)

## 1. Mục Tiêu & Điểm Nhấn Phiên Bản
Phiên bản **v7.0.38** giải quyết triệt để vấn đề rò rỉ tin nhắn đa team, nâng cấp giao diện Thẻ Giao Việc Độc Lập 3 tầng chuẩn xác, tối ưu hóa cơ chế Multi-Orchestrator đồng đẳng (Peer Orchestrator Parity) và bổ sung tính năng tiện ích Copy chuẩn Markdown kèm thời gian thực.

---

## 2. Các Thay Đổi & Nâng Cấp Chi Tiết

### A. Cô Lập Tin Nhắn Đa Team (Strict Team Isolation & Auto Team Resolution)
- **Frontend (`web/src/App.tsx`)**:
  - Khóa chặt bộ lọc hiển thị tin nhắn theo `teamId` của active tab, ngăn ngừa tuyệt đối hiện tượng tin nhắn của Team khác xuất hiện lẫn lộn.
  - Tự động nhận diện và gán đúng ngữ cảnh team khi chuyển tab hoặc nhận tin nhắn mới từ WebSocket.

### B. Thẻ Giao Việc Độc Lập Chuẩn 3 Tầng & Copy Markdown
- **Frontend (`web/src/components/ChatPanel.tsx`)**:
  - Giao diện thẻ giao việc độc lập (`UnifiedDirectiveCard`) với 3 tầng màu sắc rõ rệt:
    1. **Badge Tên Agent**: Nền đen béo sang trọng (`bg-slate-900 text-white px-2.5 py-1 rounded font-bold`).
    2. **Tiêu Đề Task**: Nền xám tinh tế (`bg-slate-100 text-slate-800 font-medium px-2 py-1 rounded`).
    3. **Nội Dung Chỉ Đạo Chi Tiết**: Khối `<details>` mở rộng/thu gọn với nền trắng tuyền và chữ tối màu (`#0f172a !important`).
  - Nút **Copy Markdown** kèm nhãn thời gian thực `🕒 [HH:MM:SS]` giúp dễ dàng trích dẫn biên bản làm việc.
  - Khử triệt để hiện tượng double-fire phím Enter với cooldown 800ms, chống nuốt chữ dở dang.

### C. Backend Multi-Orchestrator Parity & Thừa Hưởng Model 3 Tầng
- **Backend (`src/server.ts`, `src/relay/router.ts`)**:
  - Đồng bộ 1 cổng giao tiếp duy nhất cho tất cả các Orchestrator (Main Orchestrator và Sub-Orchestrator hoạt động hoàn toàn bình đẳng).
  - Khắc phục triệt để lỗi hardcode Orchestrator 1 trong hàm `checkAndSynthesize`.
  - Phân cấp thừa hưởng Model 3 tầng từ Main Card (Flash 3.7) và truyền cờ `--model` chuẩn xác.
  - Triệt tiêu bão broadcast log với cờ `isLogSubscriber`, giảm thiểu tối đa tải CPU trên trình duyệt.
  - Loại bỏ hoàn toàn xung đột BootReconcile và AutoResume sau khi khởi động lại.

---

## 3. Quy Trình Đóng Gói An Toàn (Safe Packaging Pipeline)
- Sử dụng trực tiếp Node runner cho `postject` CLI với cờ `--overwrite`, thời gian đóng gói chỉ mất vài giây.
- Tuyệt đối tuân thủ quy tắc an toàn: **Chỉ kill tiến trình cũ sau khi file binary mới đã được ghi hoàn tất trên đĩa cứng**.
