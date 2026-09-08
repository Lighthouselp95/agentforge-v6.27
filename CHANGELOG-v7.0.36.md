# CHANGELOG - Phiên bản v7.0.36 (Release Note)

**Ngày phát hành:** 05/09/2026  
**File thực thi độc lập:** `release/agentforge-web-v7.0.36.exe` (106,088,960 bytes)  
**Cổng phục vụ:** `4001` (PID `17200`)

---

## Các cải tiến & Bản vá trọng tâm

### 1. Sửa dứt điểm lỗi `workingSince 100k+ giây` & Bảo toàn Auto Continue
- **Hiện tượng**: Khi server crash hoặc khởi động lại, `loadState()` nạp lại timestamp cũ từ database của nhiều ngày trước, làm bảng `[TEAM]` hiển thị $171,899\text{s working}$ và kích hoạt cơ chế timeout 10 phút tự hủy task.
- **Giải pháp**: Khi restart/crash hoặc auto-resume, `workingSince` luôn được gán bằng `Date.now()` (thời điểm khởi động thực tế), bảo đảm đồng hồ đếm chuẩn xác từ $0\text{s}$ và tính năng Auto Continue hoạt động thông suốt.
- **Tệp sửa đổi**: `src/server.ts`, `src/storage/engine.ts`.

### 2. Ràng buộc Hoàn thành Task Tuần tự (Sequential Task Completion)
- Ràng buộc cứng: Task sau chỉ được phép đánh dấu `completed` khi toàn bộ các task trước nó ($1 \dots K-1$) đã hoàn thành.
- Thông báo lỗi chuẩn 1 dòng: `[ERROR: TASK_SEQUENCE] Vui lòng hoàn thành task trước (task #N) trước khi đánh dấu hoàn thành task #K.`
- **Tệp sửa đổi**: `src/storage/agent-storage.ts`, `src/server.ts`.

### 3. Chuẩn hóa Thông báo Quota Task & Tự động dọn sạch All-Completed
- Bãi bỏ vĩnh viễn tính năng, cảnh báo và hướng dẫn `delete_task`.
- Cấu trúc thông báo lỗi quota chuẩn mực:
  `[ERROR: TASK_LIMIT_EXCEEDED] Agent '{agent.name}' ({agent.id}) đã đạt giới hạn tối đa nhiệm vụ. Vui lòng hãy hoàn thành các task trước (sử dụng <task_update agent="{agent.id}" task="N" status="completed" />) trước khi giao thêm nhiệm vụ mới. Toàn bộ danh sách task sẽ tự động được dọn sạch khi tất cả các task đều hoàn tất.`
- Task hoàn thành tiếp tục hiển thị với huy hiệu `completed`; khi tất cả task của agent đã xong thì toàn bộ danh sách mới tự động được xóa về rỗng ($0/6$).
- **Tệp sửa đổi**: `src/server.ts`, `src/prompts/orchestrator.md`, `src/prompts/worker-base.md`.

### 4. Khử triệt để lỗi User Message bị nhân đôi (2 Lớp bảo vệ)
- **Lớp 1 (WebSocket Handler - `App.tsx`)**: Loại bỏ sự phụ thuộc vào trường `to` (`'orchestrator'` vs UUID), so khớp bằng nội dung chuẩn hóa NFC trong cửa sổ $60\text{s}$ và cập nhật ID tại chỗ, không append bản thứ 2.
- **Lớp 2 (ChatPanel Render - `ChatPanel.tsx`)**: Tự động lọc sạch mọi bản sao trùng nội dung của `user` trước khi render lên DOM.

### 5. Render 100% tất cả các Thẻ lệnh (`<talk>`, `<spawn>`, `<report>`)
- Bộ parser bóc tách đầy đủ tất cả các biến thể XML & Bracket của các directive.
- Bổ sung Card directive type `report` với phong cách emerald/green chuyên nghiệp, hiển thị trọn vẹn Markdown body, checklist, kết quả kiểm thử mà không bị nuốt mất hay cắt xén.
- **Tệp sửa đổi**: `web/src/components/ChatPanel.tsx`.

### 6. Giao diện Tinh tế & Chuẩn hóa Trật tự Timeline Queue
- Gỡ bỏ hoàn toàn các badge chữ `🟢 ĐANG CHỌN`, thay bằng hiệu ứng quầng sáng phát quang Cyan Glow (`rgba(56, 189, 248, ...)`) đa tầng hiện đại.
- Dời `delete streamRef.current` ra sau khi tính `isTargetBusy` để tin nhắn gửi lúc agent bận nằm ở thanh hàng đợi chờ dưới đáy và chỉ nối tiếp sau câu trả lời của Main khi lượt cũ kết thúc.
- **Tệp sửa đổi**: `web/src/components/Dashboard.tsx`, `web/src/components/TabBar.tsx`, `web/src/components/ChatPanel.tsx`, `web/src/App.tsx`.

### 7. Cấu hình Per-Team Role Limits Độc Lập
- Mỗi team sở hữu bảng giới hạn số lượng từng vai trò (`roleLimits`) riêng biệt trong cơ sở dữ liệu và API cấu hình (`/api/teams/:id/settings`).
- **Tệp sửa đổi**: `src/storage/team-settings.ts`, `src/relay/team-isolation.ts`, `src/routes/team-settings.ts`.
