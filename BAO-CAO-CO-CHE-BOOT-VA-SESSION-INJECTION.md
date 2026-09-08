# BÁO CÁO KỸ THUẬT: CƠ CHẾ TỰ KHỞI ĐỘNG PRE-LOGON & KIẾN TRÚC DUAL-PROCESS (SESSION INJECTION)

**Dự án:** Xemmanhinh - Pre-logon & Lock Screen H.264 Remote Streaming  
**Ngày lập:** 04/09/2026  
**Đơn vị thực hiện:** Đội ngũ AgentForge (res-verify-boot, verif-boot-status, Orchestrator)

---

## 1. TIẾN TRÌNH ĐÃ TỰ KHỞI ĐỘNG SAU KHI REBOOT Ở MÀN HÌNH LOGIN ĐẦY ĐỦ CHƯA?

👉 **XÁC NHẬN: ĐÃ TỰ KHỞI ĐỘNG ĐẦY ĐỦ 100%.**

### 1.1. Cơ chế kích hoạt tự động lúc khởi động máy (Boot Time):
- Trong script cài đặt `service/install_service.bat`, hệ thống thiết lập:
  ```cmd
  schtasks /create /tn "XemmanhinhBootService" /tr "\"%PYTHON_EXE%\" \"%LAUNCHER_PY%\"" /sc ONSTART /ru "NT AUTHORITY\SYSTEM" /rl HIGHEST /f
  ```
- **Thời điểm kích hoạt:** Trigger `/sc ONSTART` chạy dưới tài khoản `NT AUTHORITY\SYSTEM`. Ngay khi nhân kernel Windows nạp xong và Windows Service/Task subsystem khởi chạy (trước khi bất kỳ người dùng nào đăng nhập, máy tính đang ở màn hình khóa / Pre-logon / LogonUI), Windows Task Scheduler tự động khởi động tiến trình giám sát `service_launcher.py`.
- **Khắc phục lỗi SCM Timeout:** Khác với service truyền thống qua `sc.exe` (vốn bị Windows SCM tự kill sau 30-45s vì thiếu hàm Win32 Service Dispatcher - Lỗi 1053), Task Scheduler `ONSTART` chạy độc lập, duy trì thường trực và không bị giới hạn thời gian handshake.

### 1.2. Khả năng hoạt động tại màn hình Login (Pre-logon):
- Khi chưa có tài khoản nào đăng nhập vào máy tính, Windows không có token người dùng (`WTSQueryUserToken` trả về lỗi).
- `service_launcher.py` sử dụng cơ chế fallback: Quét tìm `PID` của tiến trình `winlogon.exe` thuộc session console hiện hành (thường là Session 1), dùng các đặc quyền hệ thống (`SeDebugPrivilege`, `SeTcbPrivilege`, `SeAssignPrimaryTokenPrivilege`) để nhân bản (`DuplicateTokenEx`) token `SYSTEM` gắn với Console Session đó.
- Nhờ vậy, server streaming (`server_H264wss.py`) được khởi chạy ngay tại màn hình đăng nhập.
- Đồng thời, cấu hình Registry `SoftwareSASGeneration = 3` cho phép nhận lệnh bấm **`[ 🔓 Ctrl+Alt+Del ]`** từ xa qua `sas.dll` để đánh thức màn hình đăng nhập Windows.

---

## 2. KIẾN TRÚC DUAL-PROCESS & CƠ CHẾ SESSION INJECTION

Để vượt qua rào cản **Session 0 Isolation** (tính năng bảo mật của Windows từ Windows Vista trở lên, cô lập các dịch vụ chạy ngầm trong Session 0 không cho phép truy cập màn hình đồ họa và chuột/phím của người dùng), hệ thống được thiết kế theo mô hình tiến trình kép (Dual-Process) kết hợp tiêm token xuyên Session (Cross-Session Token Injection).

### 2.1. Sơ đồ kiến trúc hoạt động:

```
+-------------------------------------------------------------------------+
|                        SESSION 0 (Service / Background)                 |
|  [Windows Task Scheduler ONSTART]                                       |
|                         |                                               |
|                         v                                               |
|        Root Service Launcher (service_launcher.py)                      |
|        - Chạy dưới tài khoản: NT AUTHORITY\SYSTEM                       |
|        - Đặc quyền: SeDebugPrivilege, SeTcbPrivilege, SeAssignPrimary   |
|        - Vòng lặp giám sát: WTSGetActiveConsoleSessionId()              |
+-------------------------------------------------------------------------+
                                  |
            (Cross-Session Injection & Watchdog Monitoring)
                                  |
                                  v
+-------------------------------------------------------------------------+
|                 SESSION 1 (Console Session - Màn hình thật)             |
|                                                                         |
|  [Trường hợp A: Pre-Logon / Lock Screen (Chưa đăng nhập)]               |
|  winlogon.exe (Session 1) ---> OpenProcessToken ---> DuplicateTokenEx   |
|                                                              |          |
|  [Trường hợp B: User đã đăng nhập]                          |          |
|  WTSQueryUserToken(session_id) ------------------------------+          |
|                                                              |          |
|                                                              v          |
|                     SetTokenInformation(TokenSessionId = 1)             |
|                     CreateEnvironmentBlock (userenv.dll)                |
|                     CreateProcessAsUserW                                |
|                               |                                         |
|                               v                                         |
|                 Core Worker: server_H264wss.py                          |
|                 - Nằm trực tiếp trong Desktop Session 1                 |
|                 - Desktop đích: "winsta0\\default" (hoặc Winlogon)      |
|                 - Quyền hạn: NT AUTHORITY\SYSTEM                        |
|                 - Chế độ: --always-run (IDLE_PROCESS_EXIT = 0.0)        |
|                 - Lắng nghe thường trực: Ports 8765, 8766, 8767 24/7    |
|                 - Chụp màn hình DXGI + GDI Capture Fallback             |
+-------------------------------------------------------------------------+
```

### 2.2. Bảng phân định 2 tầng tiến trình:

| Thông số | Tầng 1: Root Supervisor | Tầng 2: Core Worker |
| :--- | :--- | :--- |
| **Tên tiến trình** | `service_launcher.py` | `server_H264wss.py` |
| **Cơ chế khởi động** | Windows Task Scheduler (`/sc ONSTART`) | Win32 API `CreateProcessAsUserW` (do Root tiêm vào) |
| **Tài khoản / Quyền** | `NT AUTHORITY\SYSTEM` (Elevated Highest) | `NT AUTHORITY\SYSTEM` (hoặc User Token tùy trạng thái login) |
| **Đặc quyền kích hoạt** | `SeDebugPrivilege`, `SeTcbPrivilege`, `SeAssignPrimaryTokenPrivilege` | Thừa hưởng token SYSTEM đầy đủ quyền điều khiển hệ thống |
| **Session ID** | **Session 0** (Non-interactive) | **Session 1** (Physical Console Session - Màn hình thật) |
| **WindowStation / Desktop** | `winsta0\default` (chạy ngầm không UI) | `winsta0\default` (hoặc `winsta0\Winlogon` khi lock) |
| **Nhiệm vụ chính** | Canh gác (Watchdog), phát hiện đổi session, tiêm worker | Chụp màn hình DXGI/GDI, stream H.264, nhận chuột & phím |

---

## 3. CHI TIẾT CÁC BƯỚC THỰC HIỆN TRONG CODE (SESSION INJECTION)

1. **Khởi tạo và kích hoạt đặc quyền tại Session 0:**
   - Khi boot máy, `service_launcher.py` chạy lên ở Session 0.
   - Hàm `enable_privilege()` sử dụng `advapi32.AdjustTokenPrivileges` với type signatures chuẩn 64-bit (`wintypes.HANDLE`) để kích hoạt `SeDebugPrivilege` và `SeTcbPrivilege`.
2. **Thăm dò Session vật lý:**
   - Vòng lặp chính liên tục gọi `WTSGetActiveConsoleSessionId()` để theo dõi session gắn với màn hình thật (khi boot màn hình login là Session 1).
3. **Trích xuất Token và Tiêm tiến trình (Injection):**
   - Khi chưa login: Quét danh sách tiến trình bằng `CreateToolhelp32Snapshot`, tìm PID của `winlogon.exe` thuộc session đó.
   - Mở tiến trình `OpenProcess(PROCESS_ALL_ACCESS)` và gọi `advapi32.DuplicateTokenEx` để nhân bản token mức SYSTEM.
   - Gán lại session cho token: `SetTokenInformation(TokenSessionId = session_id)`.
   - Chuẩn bị môi trường người dùng: `userenv.CreateEnvironmentBlock`.
   - Khởi tạo tiến trình bằng `advapi32.CreateProcessAsUserW` với `STARTUPINFOW.lpDesktop = "winsta0\\default"`.
4. **Duy trì thường trực & Tự phục hồi (Watchdog):**
   - Worker chạy với cờ `--always-run` (đặt `IDLE_PROCESS_EXIT = 0.0`), không tự tắt khi không có client.
   - Root supervisor theo dõi tiến trình con bằng `GetExitCodeProcess(STILL_ACTIVE = 259)`. Nếu người dùng đăng nhập/đăng xuất làm đổi session, supervisor tự động tái khởi động worker vào session mới mà không làm gián đoạn dịch vụ.

---

## 4. KẾT LUẬN THỰC NGHIỆM
- **Task Scheduler:** `\XemmanhinhBootService` ở trạng thái **`Running`** as `SYSTEM`.
- **Cổng mạng:** `8765`, `8766`, `8767` đều ở trạng thái **`LISTEN`** thường trực.
- **Pre-logon Viewer:** Giao diện `viewer_H264wss_P_new.html` tải mượt qua HTTPS 200 OK với đầy đủ nút SAS mở khóa màn hình.
