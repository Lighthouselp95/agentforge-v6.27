# CHANGELOG v7.0.45

## Bản phát hành v7.0.45 (2026-09-06)

### 1. Giao Diện Toàn Diện & Căn Lề Trái Bất Biến (`web/src/components/ChatPanel.tsx`)
- **Căn Lề 1 Bên Trái**: Toàn bộ tin nhắn User, Agent, Orchestrator được căn lề trái nhất quán, thiết kế thẻ giao việc mịn tối giản nền đen `#0d111a`.
- **Khử Duplicate User 3 Lớp**: Ngăn chặn triệt để hiện tượng trùng bóng chat User trên UI bằng Set rendering và so khớp ID/timestamp chuẩn.

### 2. Chu Trình Xả Queue & Gán Timestamp Khi Respawn Lượt Mới (`src/server.ts`)
- **Điều Kiện Dequeue Chặt Chẽ**: Chỉ xả queue khi tiến trình cũ của Agent đã đóng hoàn toàn (`!client.isBusy()` và `agent.status !== 'working'`).
- **Gán Timestamp Tại Thời Khắc Respawn**: Timestamp của tin nhắn trong queue được gán tại chính xác thời điểm respawn lượt mới (`Date.now()`), sau đó mới ghi vào DB, history và broadcast ra UI timeline, đảm bảo dòng thời gian 1 sợi chỉ tuần tự.

### 3. Stream Persistence & Không Chặn Task Limit Đối Với User (`src/routes/chat.ts`, `src/server.ts`)
- **Gỡ Bỏ Task Limit Đối Với User**: Người dùng có toàn quyền gửi tin nhắn bất kỳ lúc nào; nếu Agent bận thì tin tự động vào hàng đợi `backendUserQueues` mà không bao giờ bị báo lỗi `TASK_LIMIT_EXCEEDED`.
- **Stream Persistence**: Lưu tức thì các tin nhắn User và các cập nhật live stream xuống database, chống mất dữ liệu khi restart hoặc crash.

### 4. Đóng Gói Binary Single Executable v7.0.45
- Đóng gói single binary executable `release/agentforge-web-v7.0.45.exe` và `release/agentforge-web.exe` thông qua Node SEA và postject blob injection (>106MB).
