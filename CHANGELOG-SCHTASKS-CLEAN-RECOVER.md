# CHANGELOG - NÂNG CẤP DỊCH VỤ BOOT QUA TASK SCHEDULER & CƠ CHẾ CLEAN-RECOVER

**Dự án:** Xemmanhinh - H264 Screen Viewer  
**Ngày hoàn thành:** 04/09/2026  
**Người thực hiện:** Đội ngũ AgentForge (coder-stage3, verif-sched, src-uac, Orchestrator)

---

## 1. NGUYÊN NHÂN SỰ CỐ SAU KHI KHỞI ĐỘNG LẠI MÁY (REBOOT)
- **SCM Handshake Timeout (Error 1053):** Khi đăng ký bằng `sc.exe create`, Windows Service Control Manager (SCM) yêu cầu tiến trình phải gọi API C `StartServiceCtrlDispatcher` trong vòng 30-45 giây. Do script Python launcher không có SCM dispatcher, Windows SCM đã tự động ngắt (kill) tiến trình sau khi boot với Event ID 7000/7009.
- **Lệch đường dẫn binary (Path Mismatch):** `service_launcher.py` trỏ vào `server\dist\` (thư mục thiếu file worker exe), trong khi bản build release đầy đủ nằm ở `release\server\dist\`.
- **Vòng lặp UAC Elevation:** Tiến trình manager cũ tự gọi `ShellExecuteW(..., "runas")` để xin quyền Admin, nhưng khi máy vừa khởi động chưa có ai đăng nhập để bấm chấp thuận nên tiến trình bị treo.

---

## 2. GIẢI PHÁP ĐÃ TRIỂN KHAI HOÀN HẢO

### 2.1. Chuyển Đổi Sang Windows Task Scheduler ONSTART (Quyền SYSTEM):
- Sử dụng lệnh Windows Task Scheduler native:
  ```cmd
  schtasks /create /tn "XemmanhinhBootService" /tr "\"%PYTHON_EXE%\" \"%LAUNCHER_PY%\"" /sc ONSTART /ru "NT AUTHORITY\SYSTEM" /rl HIGHEST /f
  ```
- **Ưu điểm:**
  - Chạy ngay khi máy tính vừa bật nguồn (Boot time / Pre-logon), trước khi có bất kỳ ai đăng nhập.
  - Chạy với quyền tối cao `NT AUTHORITY\SYSTEM` tại Session 0.
  - **Không bị giới hạn thời gian 30-45 giây của SCM**, không bao giờ bị Windows ép dừng tiến trình.

### 2.2. Khởi Chạy Worker Trực Tiếp (Bỏ qua hoàn toàn UAC Prompt):
- Cập nhật `service_launcher.py`: Trỏ trực tiếp vào file worker `server_H264wss_testP_new.exe` (hoặc script `server_H264wss.py`), nạp thẳng vào Console Session (Session 1) qua `WTSQueryUserToken` / duplicate token từ `winlogon.exe`.
- Loại bỏ hoàn toàn khâu gọi `_relaunch_as_admin()`, giúp server khởi động trơn tru ngay cả khi không có người ngồi trước màn hình.
- Đồng bộ đầy đủ cả 2 file EXE sang cả 2 thư mục `server\dist\` và `release\server\dist\`.

### 2.3. Tích Hợp Cơ Chế Tự Quét Rác & Hồi Phục (Self-Healing / Clean & Recover):
- **Trong `install_service.bat` (Khâu Quét & Dọn Dẹp Trước Khi Cài):**
  - Tự động đóng toàn bộ tiến trình cũ đang chạy hoặc bị treo chiếm cổng (`taskkill` các tiến trình `server_manager_P_new.exe`, `server_H264wss_testP_new.exe`, `server_H264wss.exe`).
  - Xóa sạch các file lock `.pid` cũ để tránh xung đột đơn phiên bản.
  - Xóa sạch service SCM cũ bị lỗi timeout `sc delete XemmanhinhService`.
  - Xóa sạch các rule tường lửa cũ hoặc trùng lặp trước khi tạo mới rule duy nhất `Xemmanhinh_ScreenViewer_Ports`.
  - Ghi đè cấu hình Registry `SoftwareSASGeneration = 3`.
- **Trong `uninstall_service.bat` (Khâu Gỡ Bỏ Sạch Sẽ 100%):**
  - Dừng và xóa Scheduled Task `XemmanhinhBootService`.
  - Dọn dẹp cả service cũ và đóng toàn bộ tiến trình liên quan.
  - Xóa sạch các file lock và firewall rule.
  - Khôi phục (Recover) Registry `SoftwareSASGeneration` về mặc định ban đầu.

---

## 3. KẾT QUẢ NGHIỆM THU THỰC TẾ
- Lệnh `schtasks /query /tn "XemmanhinhBootService"`: Đang ở trạng thái `Running`.
- Cả 3 cổng mạng `8765` (HTTPS), `8766` (WSS Video), `8767` (WSS Audio) đều đang `LISTENING` ổn định trên `0.0.0.0`.
- Kiểm thử truy cập web HTTPS `https://127.0.0.1:8765/`: Trả về `200 OK`, nạp đầy đủ giao diện Web Viewer mới nhất kèm nút bấm `[ 🔓 Ctrl+Alt+Del ]`.
- Đã được Verifier độc lập nghiệm thu thực tế: **100% PASSED**.
