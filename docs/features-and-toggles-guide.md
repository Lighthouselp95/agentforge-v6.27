# Hướng Dẫn Tính Năng & Các Nút Toggle Trên Giao Diện AgentForge

Tài liệu này tổng hợp và giải thích chi tiết chức năng của các nút bật/tắt (Toggle Switches) và thiết lập trên giao diện người dùng (UI) của AgentForge.

---

## 1. Tổng Quan Về Các Nút Bật/Tắt (Toggles)

Các nút toggle được bố trí chủ yếu ở **Cột Sidebar bên trái (Mục Cài Đặt)** và trong hộp thoại **Cài Đặt Mô Hình (Settings Dialog)**.

| Tên Nút Toggle | Vị trí | Giá trị mặc định | Vai trò chính |
| :--- | :--- | :--- | :--- |
| **⏰ Nhắc việc / Watchdog** | Sidebar bên trái | `BẬT (ON)` | Giám sát tác vụ, tự động nhắc việc khi ngừng hoạt động hoặc idle |
| **▶️ Auto Continue** | Sidebar bên trái | `TẮT (OFF)` | Tự động khôi phục và tiếp tục task dang dở khi khởi động lại app |
| **💡 Smart Mode (30s)** | Sidebar bên trái | `TẮT (OFF)` | Tự động yêu cầu làm rõ ý định nếu người dùng không nhắn tin trong 30s |
| **📦 Expand Tool Calls (OpenCode)** | Sidebar bên trái | `TẮT (OFF)` | Tự động mở rộng toàn bộ chi tiết công cụ hệ thống của OpenCode |
| **🔍 Mở Rộng Thẻ Lệnh AgentForge** | Model Settings Dialog | `TẮT (OFF)` | Tự động mở rộng nội dung chi tiết các thẻ lệnh `<talk>`, `<spawn>`, `<report>` |

---

## 2. Chi Tiết Từng Tính Năng

### 2.1. ⏰ Nhắc việc / Watchdog
- **Mục tiêu:** Đảm bảo không có agent nào bị "quên việc" hoặc bị treo mà không báo cáo tiến độ.
- **Cơ chế hoạt động:**
  1. **Khi agent đang có công việc chưa hoàn thành (`tasks` còn active):**
     - **Ngừng sinh Stream quá 30 giây:** Hệ thống tự động gửi tin nhắn nhắc nhở yêu cầu cập nhật tiến độ.
     - **Ở trạng thái `idle` quá 1 phút (60 giây):** Hệ thống gửi tin nhắc tiếp tục xử lý công việc.
     - **Nội dung tin nhắc:**
       - Nếu đã làm xong: Hướng dẫn tự đóng task bằng cú pháp `<task_update task="N" status="completed" />`.
       - Nếu đang làm: Đánh dấu `<task_update task="N" status="working" />`.
       - Nếu muốn tự tạo việc mới cho mình: Dùng cú pháp `<talk target="agent_id" task="Tên task">Nội dung...</talk>`.
  2. **Khi khởi động ứng dụng (Startup Task Check):**
     - Quét các agent **hoàn toàn không có việc làm dang dở**.
     - Gửi **1 tin nhắn duy nhất** hỏi xác nhận: *"Bạn đã hoàn thành hết các công việc chưa? Nếu còn, hãy cập nhật task list bằng cách tự lên task..."*.
     - Hệ thống lưu ID agent vào bộ nhớ bền vững (`noJobPromptedAgents`) để không bị hỏi lặp lại gây spam.
     - Cờ này sẽ tự động **reset** ngay khi agent nhận được nhiệm vụ mới.

---

### 2.2. ▶️ Auto Continue
- **Mục tiêu:** Tự động phục hồi dòng công việc sau khi tắt/bật app, crash hoặc mất điện.
- **Cơ chế hoạt động:**
  - Khi app vừa khởi động, hệ thống rà soát các agent còn lưu trạng thái `working` từ phiên trước.
  - Tự động gửi prompt khôi phục để agent tiếp tục thực hiện task dang dở mà người dùng không cần phải gõ lệnh kích hoạt lại bằng tay.
  - Kích hoạt Task Queue chạy ngầm để điều phối các công việc tiếp theo khi agent chuyển sang rảnh rỗi.

---

### 2.3. 💡 Smart Mode (Smart Clarify - 30s)
- **Mục tiêu:** Tăng cường tính chủ động của Orchestrator khi trao đổi với người dùng.
- **Cơ chế hoạt động:**
  - Nếu người dùng nhập yêu cầu nhưng sau đó không tương tác gì thêm trong vòng 30 giây, hệ thống sẽ kích hoạt chế độ xác minh thông minh.
  - Agent sẽ tự động tóm tắt lại những gì đã hiểu và đặt câu hỏi làm rõ các điểm nghi vấn trước khi bắt tay vào triển khai thực tế.

---

### 2.4. 📦 Expand Tool Calls (OpenCode)
- **Mục tiêu:** Kiểm soát mức độ chi tiết khi hiển thị các công cụ thao tác tệp tin và lệnh shell của OpenCode (`read`, `grep`, `glob`, `edit`, `bash`...).
- **Cơ chế hoạt động:**
  - Khi **BẬT (ON)**: Mọi khối tool call OpenCode được tự động **mở rộng (expand)** sẵn toàn bộ code, file diff và terminal output.
  - Khi **TẮT (OFF)**: Các khối tool call được **thu gọn (collapse)** thành một thanh tiêu đề gọn gàng (ví dụ: `Read: src/server.ts (15 dòng)`), giúp khung chat không bị choán màn hình. Bạn có thể bấm chuột vào thanh tiêu đề để mở rộng bất cứ lúc nào.

---

### 2.5. 🔍 Mở Rộng Thẻ Lệnh AgentForge (Directives)
- **Vị trí:** Trong hộp thoại Cài Đặt Mô Hình (nút bánh răng / Cài đặt model).
- **Mục tiêu:** Kiểm soát mức độ hiển thị của các thẻ giao việc và báo cáo nội bộ (`<talk>`, `<spawn>`, `<report>`).
- **Cơ chế hoạt động:**
  - Khi **BẬT (ON)**: Các thẻ lệnh giao việc và báo cáo sẽ tự động **mở rộng** toàn bộ nội dung hướng dẫn chi tiết ngay khi xuất hiện trong tin nhắn.
  - Khi **TẮT (OFF)**: Thẻ lệnh hiển thị vắn tắt dưới dạng Card giao việc kèm tiêu đề task và nút `"▼ Xem chi tiết"`. Người dùng bấm vào thẻ để xem toàn bộ nội dung.

---

## 3. Bảng Tóm Tắt Trạng Thái Bật/Tắt

| Trạng Thái | 📦 Expand Tool Calls (OpenCode) | 🔍 Mở Rộng Thẻ Lệnh (Directives) |
| :--- | :--- | :--- |
| **BẬT (ON)** | Mở sẵn mã nguồn, diff và terminal output của OpenCode | Mở sẵn toàn bộ nội dung giao việc/báo cáo của AgentForge |
| **TẮT (OFF)** | Thu gọn tool OpenCode thành 1 dòng (bấm để xem) | Thu gọn thẻ lệnh thành card tóm tắt (bấm để xem) |
