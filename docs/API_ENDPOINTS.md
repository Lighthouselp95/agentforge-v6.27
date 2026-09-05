# AgentForge HTTP REST API & Endpoint Reference

Tài liệu đặc tả toàn bộ các HTTP REST API endpoints, slash commands, WebSocket/SSE events và cơ chế vòng đời hệ thống của AgentForge Server.

---

## 1. Điều Khiển Vòng Đời Máy Chủ (Server Lifecycle & System Control)

### `POST /api/restart`
Khởi động lại toàn bộ tiến trình AgentForge Server một cách an toàn và tự động thông qua tiến trình tách biệt (detached child process).

- **Phương thức**: `POST`
- **URL**: `/api/restart`
- **Headers**: `Content-Type: application/json`
- **Body**: Không bắt buộc (trống).
- **Cơ chế hoạt động**:
  1. Trả về phản hồi JSON ngay lập tức cho client.
  2. Kích hoạt bộ đếm thời gian trễ 500ms (`setTimeout`).
  3. Khởi tạo một tiến trình con độc lập hoàn toàn (`detached: true`, `stdio: 'ignore'`), gọi file thực thi `start.bat` trên Windows (hoặc lệnh `npm start` trên Linux/macOS) từ thư mục gốc `process.cwd()`.
  4. Tiến trình con tự tách rời (`child.unref()`), không bị ràng buộc bởi tiến trình cha.
  5. Tiến trình server hiện tại tự đóng an toàn với mã thoát `process.exit(0)`. Tiến trình mới kế thừa cổng mạng sau khi cổng được giải phóng.
- **Phản hồi mẫu**:
```json
{
  "success": true,
  "message": "Restarting AgentForge server..."
}
```

### Lệnh Slash Command `/restart` trong Chat
Người dùng có thể gõ trực tiếp `/restart` vào ô nhập chat trên giao diện Web UI:
- **Cơ chế**: Endpoint `POST /api/chat` bắt regex `rawMsg.toLowerCase() === '/restart'`.
- **Hành vi**:
  1. Gửi tin nhắn thông báo từ hệ thống tới UI: `"🔄 Đang khởi động lại AgentForge server..."`.
  2. Broadcast sự kiện `chat:message` qua WebSocket/SSE.
  3. Kích hoạt lệnh spawn detached tương tự `POST /api/restart`.

---

## 2. Giao Tiếp & Hội Thoại (Chat & Messaging Endpoints)

### `POST /api/chat`
Endpoint trung tâm tiếp nhận tin nhắn từ người dùng gửi cho Orchestrator hoặc các Agent thành viên.

- **Phương thức**: `POST`
- **URL**: `/api/chat`
- **Headers**: `Content-Type: application/json`
- **Tham số Body**:
  | Trường | Kiểu | Bắt buộc | Mô tả |
  |--------|------|----------|-------|
  | `message` | `string` | Có | Nội dung câu lệnh hoặc hướng dẫn của người dùng (tự động chuẩn hóa NFC và cắt khoảng trắng thừa). |
  | `targetAgentId` | `string` | Không | ID của Agent mục tiêu nhận tin nhắn. Nếu bỏ trống, mặc định gửi tới `orchestrator`. |
  | `agentId` | `string` | Không | Định danh thay thế cho `targetAgentId` (tương thích ngược). |
  | `teamId` | `string` | Không | ID của team tương ứng (mặc định `'default'`). |

- **Các lệnh Slash Command đặc biệt hỗ trợ qua `/api/chat`**:
  - `/restart`: Khởi động lại server như mô tả ở Mục 1.
  - `/compact`: Gửi yêu cầu thu gọn session context trực tiếp tới OpenCode engine của Agent mục tiêu:
    - Nếu thành công: `{ ok: true, sessionId: string, compacted: true }`.
    - Tự động phát tin nhắn trạng thái `✅ Đã gửi lệnh /compact chính thức tới session...`.

- **Phản hồi mẫu**:
```json
{
  "ok": true,
  "response": "Nội dung phản hồi từ Orchestrator hoặc Agent...",
  "sessionId": "ses-abc123xyz",
  "commands": [
    "<talk target=\"agent-xxx\">Nội dung giao việc</talk>"
  ]
}
```

### `GET /api/history`
Truy xuất lịch sử trò chuyện từ cơ sở dữ liệu bền vững trên đĩa.

- **Phương thức**: `GET`
- **URL**: `/api/history`
- **Query Parameters**:
  - `limit` (number, tùy chọn, mặc định 100): Giới hạn số lượng tin nhắn tối đa trả về.
  - `agentId` (string, tùy chọn): Lọc tin nhắn liên quan trực tiếp đến một Agent (bao gồm tin nhắn gửi đi và nhận về của Agent đó).
  - `teamId` (string, tùy chọn): Lọc tin nhắn thuộc phân vùng Team cụ thể.
- **Phản hồi**: Mảng danh sách các đối tượng `ChatMsg[]`:
```json
[
  {
    "id": "uuid-1",
    "from": "user",
    "to": "orchestrator",
    "content": "Phân tích và sửa lỗi",
    "timestamp": 1725450000000,
    "teamId": "default"
  }
]
```

### `GET /api/messages`
Lấy toàn bộ tin nhắn đang được lưu trữ trong bộ nhớ đệm RAM (`chatHistory`).

---

## 3. Quản Lý Vòng Đời Agent (Agent Lifecycle Management)

### `GET /api/agents`
Liệt kê toàn bộ các Agent đang hoạt động và đã được cấu hình trong hệ thống.

- **Phương thức**: `GET`
- **URL**: `/api/agents`
- **Phản hồi**: Mảng các đối tượng `Agent`:
```json
[
  {
    "id": "agent-c42f9790",
    "name": "coder-core",
    "role": "coder",
    "type": "worker",
    "status": "idle",
    "task": "Refactor core modules",
    "teamId": "default",
    "tokenUsage": {
      "inputTokens": 15200,
      "outputTokens": 3400,
      "cost": 0.045
    },
    "contextLength": 28000,
    "model": "gemini-2.5-pro",
    "createdAt": 1725440000000
  }
]
```

### `POST /api/agents`
Tạo và cấu hình một Agent hoặc Role tùy chỉnh mới trong hệ thống.

- **Phương thức**: `POST`
- **URL**: `/api/agents`
- **Tham số Body**:
```json
{
  "name": "frontend-dev",
  "role": "coder",
  "task": "Phát triển giao diện mới",
  "model": "claude-3-7-sonnet",
  "teamId": "default"
}
```

### Điều Khiển Trạng Thái Agent
- `POST /api/agents/:id/start`: Khởi động một Agent đang chờ.
- `POST /api/agents/:id/stop`: Dừng khẩn cấp tiến trình của Agent (`status: 'stopped'`).
- `POST /api/agents/:id/resume`: Khôi phục trạng thái hoạt động của Agent sau khi bị dừng.
- `POST /api/agents/:id/abort`: Ngắt lượt thực thi OpenCode đang chạy của Agent.
- `DELETE /api/agents/:id`: Xóa bỏ hoàn toàn Agent, hủy session OpenCode và dọn dẹp bộ nhớ.
- `PATCH /api/agents/:id`: Cập nhật thông tin cấu hình (`name`, `role`, `task`, `model`).
- `POST /api/agents/:id/model`: Thay đổi mô hình AI (`model`) chỉ định cho Agent đó.
- `POST /api/orchestrator/model`: Thay đổi mô hình AI dành riêng cho Orchestrator.

### Quản Lý Nhiệm Vụ & Bộ Nhớ Agent
- `POST /api/agents/:id/clear`: Xóa trắng lịch sử trò chuyện của Agent chỉ định.
- `POST /api/orchestrator/clear`: Xóa trắng lịch sử trò chuyện của Main Orchestrator.
- `DELETE /api/agents/:id/tasks/:taskId`: Xóa bỏ một nhiệm vụ trong danh sách task của Agent.
- `POST /api/agents/:id/tasks/:taskId/delete`: Endpoint tương thích ngược để xóa task.

---

## 4. Giám Sát Terminal, Nhật Ký & Realtime Stream

### `GET /logs`
Truy vấn bộ đệm vòng tròn (Ring Buffer) chứa nhật ký hệ thống của tiến trình Server.

- **Phương thức**: `GET`
- **URL**: `/logs`
- **Phản hồi**:
```json
{
  "lines": [
    "[Storage] Loaded 8 agents",
    "[Route] Deliver talk to coder-core..."
  ],
  "max": 2000,
  "count": 142
}
```

### `GET /terminal`
Giao diện trực quan nhúng sẵn HTML/CSS/JS chạy trực tiếp trên trình duyệt để theo dõi luồng nhật ký và terminal output theo thời gian thực mà không cần mở console máy chủ.

### `GET /api/events` & `GET /events`
Kênh Server-Sent Events (SSE) phát sóng liên tục các sự kiện tới UI:
- `chat:chunk`: Stream từng ký tự văn bản của model.
- `chat:thinking`: Stream luồng suy luận nội tâm (Thinking process).
- `chat:tool_call`: Thông báo kích hoạt công cụ (ReadFile, Edit, Bash...).
- `chat:message`: Tin nhắn hoàn chỉnh được xác nhận.
- `agent:updated`: Cập nhật trạng thái (`idle`, `working`, `stopped`) của Agent.

---

## 5. Phục Vụ Ứng Dụng Frontend (Static Assets)

- `GET /`: Giao diện chính React Web UI của AgentForge.
- `GET /v2` hoặc `GET /v2/*`: Tuyến đường dự phòng cho giao diện Web V2.
- `GET /assets/*`: Cung cấp các gói tệp tĩnh (JavaScript bundle, CSS, Icons, Fonts) đã được biên dịch qua Vite.
