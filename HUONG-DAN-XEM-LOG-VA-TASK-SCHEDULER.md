# HƯỚNG DẪN QUẢN LÝ TASK SCHEDULER VÀ TRA CỨU NHẬT KÝ (LOGGING)

**Dự án:** Xemmanhinh (Pre-logon & Lock Screen Streaming)  
**Ngày lập:** 04/09/2026  
**Đơn vị thực hiện:** Orchestrator (AgentForge Team)

---

## 1. CÁCH TÌM VÀ QUẢN LÝ TASK SCHEDULER `XemmanhinhBootService`

### 1.1. Xem bằng Giao diện Trực quan (GUI - Task Scheduler)
1. Bấm tổ hợp phím **`Win + R`** $\rightarrow$ gõ **`taskschd.msc`** $\rightarrow$ bấm **Enter**.
2. **Lưu ý quan trọng:** Để xem được các task hệ thống `SYSTEM`, bạn nên mở Task Scheduler dưới quyền Administrator:
   - Bấm nút **Start** $\rightarrow$ gõ tìm **Task Scheduler** $\rightarrow$ Click chuột phải chọn **Run as administrator**.
3. Tại khung danh mục bên trái: Click chọn thư mục **`Task Scheduler Library`** (Thư viện Task Scheduler).
4. Tại bảng danh sách chính giữa: Tìm tác vụ có tên:
   👉 **`XemmanhinhBootService`**
   - **Status (Trạng thái):** `Running` hoặc `Ready`.
   - **Author (Tác giả):** `NT AUTHORITY\SYSTEM`.
   - **Triggers (Thời điểm chạy):** `At system startup` (Chạy tự động ngay khi bật máy trước khi đăng nhập).
5. **Mẹo:** Nếu vừa cài đặt xong mà chưa thấy tên task xuất hiện, bạn hãy bấm phím **`F5`** hoặc nhìn sang cột **Actions** bên phải ngoài cùng bấm **`Refresh`**.

### 1.2. Tra cứu nhanh bằng Dòng lệnh (CMD / PowerShell)
Mở cửa sổ Command Prompt hoặc PowerShell và chạy:
```cmd
schtasks /query /tn "XemmanhinhBootService" /fo LIST /v
```
Lệnh sẽ in ra toàn bộ tham số chi tiết của task (đường dẫn file python thực thi, quyền hạn `SYSTEM`, trạng thái tiến trình).

---

## 2. CÁCH TRA CỨU VÀ ĐỌC NHẬT KÝ (LOGS) HỆ THỐNG

Hệ thống ghi nhận hoạt động qua **3 tầng nhật ký** riêng biệt phục vụ mục đích theo dõi và chẩn đoán sự cố:

---

### TẦNG 1: NHẬT KÝ SERVER WORKER (QUAN TRỌNG NHẤT)
Đây là nơi ghi lại toàn bộ hoạt động thực tế theo thời gian thực: lượt client kết nối từ xa, tốc độ khung hình (FPS), các thao tác chuột, phím bấm, lệnh mở khóa SAS và chuyển đổi màn hình khóa.

- **Đường dẫn tệp nhật ký:**
  ```text
  C:\Users\Hai Dang\Xemmanhinh\server\server_worker.log
  ```
- **Cách mở xem nhanh:**
  - **Cách 1 (Mở bằng Notepad):** Bấm **`Win + R`** $\rightarrow$ dán đường dẫn trên $\rightarrow$ bấm **Enter**.
  - **Cách 2 (Xem dòng mới nhất trực tiếp trên PowerShell - Live Tail):**
    ```powershell
    Get-Content "C:\Users\Hai Dang\Xemmanhinh\server\server_worker.log" -Tail 50 -Wait
    ```
  - **Cách 3 (Xem bằng lệnh CMD):**
    ```cmd
    type "C:\Users\Hai Dang\Xemmanhinh\server\server_worker.log"
    ```

---

### TẦNG 2: NHẬT KÝ SERVICE LAUNCHER (TIẾN TRÌNH GỐC SYSTEM)
Ghi nhận quá trình tự động khởi chạy lúc bật nguồn máy tính, cơ chế tiêm Session (Session Injection từ Session 0 sang Session 1) và cơ chế tự phục hồi (Watchdog) nếu worker gặp sự cố.

- **Đường dẫn tệp nhật ký:**
  ```text
  C:\Users\Hai Dang\Xemmanhinh\service\service_launcher.log
  ```
- **Cách mở xem:**
  - Bấm **`Win + R`** $\rightarrow$ dán `C:\Users\Hai Dang\Xemmanhinh\service\service_launcher.log` $\rightarrow$ bấm **Enter**.

---

### TẦNG 3: NHẬT KÝ SỰ KIỆN WINDOWS (EVENT VIEWER)
Lưu trữ lịch sử kích hoạt của hệ điều hành Windows đối với Task `XemmanhinhBootService`.

1. Trong cửa sổ **`taskschd.msc`**, click chọn dòng **`XemmanhinhBootService`**.
2. Nhìn xuống khung bên dưới, click vào tab **`History`** (Lịch sử).
3. Nếu tab History hiển thị dòng *“History is disabled”*:
   - Nhìn sang bảng **Actions** bên phải ngoài cùng $\rightarrow$ Click vào **`Enable All Tasks History`**.
   - Kể từ thời điểm này, mỗi lần máy tính khởi động lại, Windows sẽ tự động lưu lại toàn bộ mã Event ID kích hoạt task (Task Started, Action Started, Task Completed) vào Windows Event Viewer.

---

## 3. CÁCH KÍCH HOẠT LẠI HOẶC GỠ BỎ TASK DỊCH VỤ

Toàn bộ các tác vụ cài đặt, dọn dẹp và khôi phục đều được tích hợp sẵn dưới dạng file script 1-Click:
- **Cài đặt lại hoặc sửa lỗi:**
  Chạy file `C:\Users\Hai Dang\Xemmanhinh\service\install_service.bat` (Run as administrator).
- **Gỡ bỏ hoàn toàn dịch vụ:**
  Chạy file `C:\Users\Hai Dang\Xemmanhinh\service\uninstall_service.bat` (Run as administrator).
