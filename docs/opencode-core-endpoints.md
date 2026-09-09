# Tổng Hợp Danh Sách Endpoint HTTP Của OpenCode Serve Core (Port 4096)

Tài liệu này tổng hợp toàn bộ các endpoint HTTP REST API hữu ích được cung cấp trực tiếp bởi OpenCode Serve Core (`http://127.0.0.1:4096`), được phân loại theo nhóm chức năng để thuận tiện tra cứu và tái sử dụng cho các tính năng tương lai.

---

## 1. Nhóm Điều Khiển Phiên Làm Việc (Session Control & Lifecycle)

| Phương thức | Endpoint | Tóm tắt chức năng | Mô tả chi tiết & Ứng dụng |
| :--- | :--- | :--- | :--- |
| `POST` | `/session/{sessionID}/abort` | **Abort session (Dừng khẩn cấp)** | Lập tức ngắt xử lý AI và câu lệnh shell/tool đang chạy dở của session. Dùng cho tính năng Stop / Watchdog. |
| `POST` | `/api/session/{sessionID}/interrupt` | **Interrupt execution** | Ngắt lượt thực thi hiện tại của session. Nếu session đang idle thì là no-op. |
| `POST` | `/session` | **Create session** | Tạo một phiên làm việc mới cho AI assistant. |
| `GET` | `/session` | **List sessions** | Lấy danh sách tất cả các session, sắp xếp theo thời gian cập nhật gần nhất. |
| `GET` | `/session/status` | **Get session status** | Xem trạng thái của toàn bộ sessions (`active`, `idle`, `completed`). |
| `GET` | `/session/{sessionID}` | **Get session info** | Lấy thông tin chi tiết của session theo ID. |
| `DELETE` | `/session/{sessionID}` | **Delete session** | Xóa hoàn toàn một session cùng lịch sử chat và dữ liệu liên quan. |
| `PATCH` | `/session/{sessionID}` | **Update session** | Cập nhật tiêu đề (`title`) hoặc metadata của session. |
| `POST` | `/session/{sessionID}/fork` | **Fork session** | Phân nhánh (fork) một session từ một mốc tin nhắn cụ thể. |
| `POST` | `/session/{sessionID}/summarize` | **Summarize session** | Tạo tóm tắt nội dung hội thoại bằng AI compaction. |
| `POST` | `/api/session/{sessionID}/compact` | **Compact session** | Nén ngữ cảnh hội thoại để giảm độ dài context / tiết kiệm token. |
| `POST` | `/api/session/{sessionID}/agent` | **Switch session agent** | Đổi cấu hình agent (`coder`, `researcher`, `orchestrator`...) cho lượt chat tiếp theo. |
| `POST` | `/api/session/{sessionID}/model` | **Switch session model** | Đổi model LLM cho lượt tiếp theo của session. |
| `POST` | `/api/session/{sessionID}/wait` | **Wait for session** | Chờ cho đến khi vòng lặp agent hoàn tất và trở về trạng thái idle. |

---

## 2. Nhóm Nhắn Tin & Tương Tác AI (Messages & Prompts)

| Phương thức | Endpoint | Tóm tắt chức năng | Mô tả chi tiết & Ứng dụng |
| :--- | :--- | :--- | :--- |
| `POST` | `/session/{sessionID}/message` | **Send message (Sync/Stream)** | Gửi tin nhắn đến session và stream kết quả phản hồi của AI. |
| `POST` | `/session/{sessionID}/prompt_async` | **Send async message** | Gửi tin nhắn bất đồng bộ, trả về ngay mà không chặn luồng chờ. |
| `POST` | `/api/session/{sessionID}/prompt` | **Durable prompt input** | Nhận đầu vào và xếp lịch thực thi theo vòng lặp agent loop. |
| `GET` | `/session/{sessionID}/message` | **Get session messages** | Lấy toàn bộ lịch sử tin nhắn của session (lời nhắc, kết quả tool, phản hồi, reasoning, token). |
| `GET` | `/session/{sessionID}/message/{messageID}` | **Get message** | Lấy chi tiết một tin nhắn cụ thể theo ID. |
| `DELETE` | `/session/{sessionID}/message/{messageID}` | **Delete message** | Xóa một tin nhắn khỏi session mà không revert thay đổi tệp tin. |
| `POST` | `/session/{sessionID}/command` | **Send command** | Gửi một lệnh chuyên biệt đến session cho AI thực thi. |
| `POST` | `/session/{sessionID}/shell` | **Run shell command** | Thực thi lệnh shell trong ngữ cảnh của session và trả về phản hồi của AI. |

---

## 3. Nhóm Revert & Rollback Mã Nguồn (Code Revert)

| Phương thức | Endpoint | Tóm tắt chức năng | Mô tả chi tiết & Ứng dụng |
| :--- | :--- | :--- | :--- |
| `GET` | `/session/{sessionID}/diff` | **Get message diff** | Lấy diff các tệp tin đã thay đổi do tin nhắn của user tạo ra. |
| `POST` | `/session/{sessionID}/revert` | **Revert message** | Hoàn tác (undo) các thay đổi file do một tin nhắn cụ thể gây ra. |
| `POST` | `/session/{sessionID}/unrevert` | **Restore reverted messages** | Khôi phục lại các thay đổi đã từng bị revert trước đó. |
| `POST` | `/api/session/{sessionID}/revert/stage` | **Stage revert** | Chuẩn bị mốc hoàn tác file có thể đảo ngược. |
| `POST` | `/api/session/{sessionID}/revert/commit` | **Commit revert** | Xác nhận và áp dụng vĩnh viễn việc hoàn tác. |

---

## 4. Nhóm Terminal Trực Tiếp (PTY - Pseudo Terminal)

| Phương thức | Endpoint | Tóm tắt chức năng | Mô tả chi tiết & Ứng dụng |
| :--- | :--- | :--- | :--- |
| `GET` | `/pty/shells` | **List available shells** | Danh sách shell có sẵn trên hệ thống (PowerShell, CMD, Bash...). |
| `GET` | `/pty` | **List PTY sessions** | Xem tất cả các phiên PTY đang chạy ngầm. |
| `POST` | `/pty` | **Create PTY session** | Mở một terminal ảo PTY mới để chạy câu lệnh. |
| `DELETE` | `/pty/{ptyID}` | **Remove PTY session** | Hủy và tắt hẳn một tiến trình terminal PTY đang chạy. |
| `GET` | `/pty/{ptyID}/connect` | **Connect PTY WebSocket** | Kết nối WebSocket để stream trực tiếp input/output terminal theo thời gian thực. |
| `POST` | `/pty/{ptyID}/connect-token` | **Create PTY connect token** | Tạo token xác thực ngắn hạn cho kết nối WebSocket PTY. |

---

## 5. Nhóm Thao Tác Tệp Tin & Dự Án (Files & Project)

| Phương thức | Endpoint | Tóm tắt chức năng | Mô tả chi tiết & Ứng dụng |
| :--- | :--- | :--- | :--- |
| `GET` | `/find/file` | **Find files** | Tìm kiếm tệp hoặc thư mục theo tên / pattern trong dự án. |
| `GET` | `/file` | **List files** | Liệt kê danh sách thư mục và file tại đường dẫn chỉ định. |
| `GET` | `/file/content` | **Read file** | Đọc nội dung thô của file trong dự án. |
| `GET` | `/file/status` | **Get git status** | Lấy trạng thái git status của các tệp tin trong thư mục làm việc. |
| `GET` | `/session/{sessionID}/todo` | **Get session todos** | Lấy danh sách việc cần làm (todo list) của session. |

---

## 6. Nhóm Sự Kiện Trực Tiếp & Toàn Cục (Events & Global)

| Phương thức | Endpoint | Tóm tắt chức năng | Mô tả chi tiết & Ứng dụng |
| :--- | :--- | :--- | :--- |
| `GET` | `/event` hoặc `/global/event` | **Subscribe to events (SSE)** | Kết nối Server-Sent Events (SSE) để lắng nghe sự kiện thời gian thực từ OpenCode (step_finish, token, tool_calls, text-delta). |
| `GET` | `/api/session/{sessionID}/event` | **Session event stream** | Lắng nghe dòng sự kiện chỉ riêng cho 1 session cụ thể. |
| `GET` | `/api/model` | **List models** | Lấy danh sách toàn bộ các model LLM hỗ trợ và thông tin chi phí. |
| `POST` | `/instance/dispose` | **Dispose instance** | Dọn dẹp và giải phóng tài nguyên của instance OpenCode hiện tại. |
