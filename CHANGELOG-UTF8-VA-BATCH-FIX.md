# CHANGELOG - CẤU HÌNH UTF-8 HỆ THỐNG & SỬA LỖI BATCH SCRIPTS

**Dự án:** Xemmanhinh - H264 Screen Viewer & Remote Desktop  
**Ngày hoàn thành:** 04/09/2026  
**Người thực hiện:** Đội ngũ AgentForge (coder-stage3, verif-sched, src-uac, Orchestrator)

---

## 1. MỤC TIÊU ĐẠT ĐƯỢC
- Khắc phục triệt để lỗi phân tích cú pháp ký tự Unicode tiếng Việt trong Command Prompt Windows (`'ạy'`, `'iểm' is not recognized as an internal or external command`).
- Loại bỏ hoàn toàn sự cố bị rơi vào Python REPL interactive shell (`Python 3.14.7 ... >>>`) khi chạy `install_service.bat`.
- Cấu hình chuẩn hóa bảng mã **UTF-8 toàn diện** cho mọi terminal trên hệ thống: PowerShell Profiles, Command Prompt AutoRun, và các biến môi trường của Python.

---

## 2. CHI TIẾT CÁC THAY ĐỔI & THIẾT LẬP

### 2.1. Cấu hình UTF-8 Toàn diện Hệ thống:
- **PowerShell Profiles:**
  - Đã tạo và cấu hình tự động tại:
    - `C:\Users\Dang\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`
    - `C:\Users\Dang\Documents\PowerShell\Microsoft.PowerShell_profile.ps1`
    - `C:\Users\Hai Dang\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`
    - `C:\Users\Hai Dang\Documents\PowerShell\Microsoft.PowerShell_profile.ps1`
  - Thiết lập:
    ```powershell
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding  = [System.Text.Encoding]::UTF8
    $OutputEncoding           = [System.Text.Encoding]::UTF8
    ```
- **Command Prompt (CMD.EXE) AutoRun Registry:**
  - Khóa Registry: `HKCU\Software\Microsoft\Command Processor`
  - Giá trị: `Autorun = chcp 65001 >nul`
  - Đảm bảo mọi cửa sổ CMD mở ra luôn tự động chạy ở mã trang UTF-8 Code Page 65001.
- **Biến môi trường Windows (User Environment Variables):**
  - `PYTHONUTF8 = 1`
  - `PYTHONIOENCODING = utf-8`
  - Đảm bảo Python luôn đọc/ghi tệp và xuất log dưới dạng UTF-8 chuẩn quốc tế.

### 2.2. Sửa lỗi & Chuẩn hóa Batch Scripts (`service/`):
- **`service/install_service.bat`:**
  - Chuyển toàn bộ các dòng thông báo sang tiếng Việt không dấu chuẩn ASCII, loại bỏ hoàn toàn các ký tự có dấu gây lỗi parser của `cmd.exe`.
  - Bổ sung logic lọc stub `WindowsApps` khi quét `where python` để lấy đường dẫn thực thi Python chính xác, không gọi lệnh `python` trần không tham số.
  - Chuẩn hóa cú pháp lệnh: `sc create %SERVICE_NAME% binPath= "\"%PYTHON_EXE%\" \"%LAUNCHER_PY%\""`.
- **`service/uninstall_service.bat`:**
  - Chuyển sang tiếng Việt không dấu chuẩn ASCII, đóng tiến trình con an toàn, xóa dịch vụ và dọn dẹp tường lửa.

---

## 3. KẾT QUẢ NGHIỆM THU THỰC CHỨNG
- `install_service.bat`: Đã chạy thử nghiệm thực tế thành công 100% (cấu hình Registry `SoftwareSASGeneration = 3`, mở 3 cổng Firewall 8765-8767, đăng ký và khởi động `XemmanhinhService` thành công).
- `uninstall_service.bat`: Đã chạy thử nghiệm thực tế dừng và gỡ bỏ service sạch sẽ (SCM trả về `1060: The specified service does not exist`).
- Verifier độc lập đã kiểm tra và phê duyệt: **100% PASSED**.
