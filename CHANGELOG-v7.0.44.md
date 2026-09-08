# CHANGELOG v7.0.44

## Bản phát hành v7.0.44 (2026-09-06)

### 1. Khắc Phục Lỗi TypeScript TS2367 & Hoàn Thiện Cơ Chế Xử Lý Task (`src/server.ts`)
- **Sửa Lỗi Type Narrowing**: Khắc phục lỗi so sánh dead-code tại dòng 2722 trong `src/server.ts`, thay đổi sang `newStatus === 'completed' || newStatus === 'idle'`, đảm bảo lệnh biên dịch `tsc --noEmit` đạt 0 lỗi 100%.
- **Chặt Chẽ Cơ Chế Quản Lý Task**: Ràng buộc kiểm tra tuần tự và kiểm tra trạng thái nhiệm vụ hợp lệ, ngăn ngừa lỗi cập nhật sai số thứ tự task.

### 2. Triệt Tiêu Hoàn Toàn Final Pass Broadcast & Chuyển Dịch 100% Sang Live Stream
- **Stream-First Directives**: Directives `<talk>`, `<task_update>`, `<spawn>` được phát hiện và kích hoạt ngay trong lúc stream (`scanStreamForDispatch`).
- **Xóa Bỏ Broadcast Cuối Turn**: Loại bỏ hoàn toàn `broadcast('chat:message')` ở cuối turn trong `handleOrchestratorResponse` và `handleAgentResponse`, triệt tiêu triệt để hiện tượng double message / duplicate talk card.

### 3. Tự Động Xả Queue & Reset Agent Idle Khi Khởi Động
- **Khử Zombie Working**: Reset 100% agent về `idle` khi nạp DB (`loadState`), ngăn chặn tình trạng kẹt hàng đợi sau khi khởi động lại mà không cần người dùng can thiệp bấm nút STOP.
- **Tự Động Kích Hoạt Xả Hàng Đợi**: Kích hoạt `processNextBackendUserQueue` trong Bước 5 của Boot Sequence.

### 4. Đóng Gói Binary Thực Thi Độc Lập
- Đóng gói single binary executable `release/agentforge-web-v7.0.44.exe` và `release/agentforge-web.exe` thông qua Node SEA và postject blob injection (>100MB).
