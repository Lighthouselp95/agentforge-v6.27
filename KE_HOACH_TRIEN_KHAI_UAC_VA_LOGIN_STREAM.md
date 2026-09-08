# KẾ HOẠCH TRIỂN KHAI TOÀN DIỆN: KHẮC PHỤC SỰ CỐ UAC / FIREWALL & NÂNG CẤP STREAM MÀN HÌNH ĐĂNG NHẬP WINDOWS

> **Dự án:** Xemmanhinh - H264 Screen Viewer  
> **Đường dẫn dự án:** `C:\Users\Hai Dang\Xemmanhinh`  
> **Ngày lập kế hoạch:** 04/09/2026  
> **Trạng thái:** Sẵn sàng triển khai (Ready for Implementation)

---

## 1. MỤC TIÊU DỰ ÁN

1. **Khắc phục triệt để sự cố UAC & Firewall:**
   - Khi máy chủ xuất hiện hộp thoại UAC (cấp quyền Administrator) hoặc cảnh báo Windows Defender Firewall, kết nối từ xa qua WebSocket/WebRTC không bao giờ bị crash, không bị ngắt kết nối (CloseCode 1006) hay mất luồng capture vĩnh viễn.
   - Tự động phục hồi khung hình mượt mà ngay khi người dùng đóng hộp thoại.
2. **Hỗ trợ tương tác chuột và bàn phím tại Winlogon:**
   - Cho phép click chọn tài khoản, click focus vào ô mật khẩu và gõ mật khẩu đăng nhập từ xa.
   - Hỗ trợ gửi tín hiệu `Ctrl + Alt + Del` (SAS) đối với các máy tính bật chính sách bảo mật bắt buộc.
3. **Hiện thực hóa tính năng Stream màn hình Đăng nhập (Pre-logon & Lock screen):**
   - Nâng cấp kiến trúc lên mô hình **Dual-Process Windows Service** (chuẩn công nghiệp như AnyDesk, RustDesk, TeamViewer), cho phép remote stream hoạt động ngay khi máy vừa khởi động (chưa ai đăng nhập) hoặc khi máy bị khóa (`Win + L`).

---

## 2. KẾ HOẠCH PHÂN KỲ CHI TIẾT (3 GIAI ĐOẠN)

```
┌────────────────────────────────────────────────────────────────────────┐
│ GIAI ĐOẠN 1: VÁ LỖI CRASH UAC & TẮT NGHẼN FIREWALL                     │
│ ➔ Mục tiêu: Không bao giờ crash, giữ kết nối thông suốt, auto recovery │
│ ➔ Mức độ ưu tiên: CẤP BÁCH (Ưu tiên 1)                                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ GIAI ĐOẠN 2: TƯƠNG TÁC CHUỘT / PHÍM & TÍN HIỆU CTRL+ALT+DEL            │
│ ➔ Mục tiêu: Click và gõ mật khẩu được trên Winlogon, gửi SendSAS       │
│ ➔ Mức độ ưu tiên: CAO (Ưu tiên 2)                                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ GIAI ĐOẠN 3: KIẾN TRÚC DUAL-PROCESS SERVICE (PRE-LOGON STREAMING)      │
│ ➔ Mục tiêu: Stream được ngay khi máy vừa bật nguồn, chưa có user login │
│ ➔ Mức độ ưu tiên: NÂNG CAO (Ưu tiên 3)                                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

### GIAI ĐOẠN 1: VÁ LỖI CRASH UAC & TẮT NGHẼN FIREWALL

#### 1.1. Nhiệm vụ kỹ thuật cụ thể:
1. **Bọc an toàn luồng Capture (`server/server_H264wss.py` dòng 644–668):**
   - Phát hiện lỗi mất quyền đồ họa `DXGI_ERROR_ACCESS_LOST (0x887A0026)` khi Windows chuyển sang Secure Desktop.
   - Bọc khối `try...except` an toàn quanh lệnh `_camera = dxcam.create(output_color="BGR")` tại dòng 665.
   - Nếu đang ở Secure Desktop, không cho crash thread mà chuyển sang trạng thái chờ thăm dò nhẹ (`time.sleep(0.5)`).
   - Ngay khi UAC đóng lại, tự động khởi tạo lại `dxcam` thành công và tiếp tục phát stream bình thường.
2. **Bảo vệ luồng WebSocket (`server/server_H264wss.py` dòng 1597):**
   - Trong `ws_handler`, bọc `try...except` quanh `await asyncio.get_event_loop().run_in_executor(None, _ensure_streaming)`.
   - Nếu camera chưa sẵn sàng do đang vướng UAC, WebSocket vẫn bắt tay thành công, gửi bản tin `init` và duy trì kết nối bình thường, xóa bỏ hoàn toàn lỗi ngắt socket `CloseCode 1006/1011` khi client mới vào hoặc F5.
3. **Cơ chế Placeholder Frame (Khung hình giữ nhịp):**
   - Trong thời gian UAC hiển thị, server định kỳ phát 1 khung hình tĩnh H.264 (ảnh nền tối kèm dòng chữ: *"Đang hiển thị hộp thoại UAC trên máy chủ. Vui lòng thao tác trên máy thật..."*).
   - Tác dụng: Giữ luồng video liên tục, ngăn trình duyệt bị timeout và thông báo rõ ràng trạng thái cho người dùng từ xa.
4. **Tự động mở cấu hình Windows Firewall (`server/server_manager.py`):**
   - Trước khi kích hoạt server, tự động gọi lệnh hệ thống bằng quyền Administrator:
     ```cmd
     netsh advfirewall firewall add rule name="Xemmanhinh_Server" dir=in action=allow protocol=TCP localport=8765,8766,8767 profile=any
     ```
   - Ngăn Windows hiển thị popup Firewall làm chặn gói tin TCP Inbound từ bên ngoài.
5. **Cung cấp Script Registry tùy chọn (Tắt Secure Desktop):**
   - Tạo file `tools/enable_uac_on_desktop.bat` thiết lập `PromptOnSecureDesktop = 0` tại `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System`.
   - Giúp hộp thoại UAC hiển thị ngay trên desktop thường cho môi trường máy cá nhân/nội bộ, cho phép nhìn thấy và bấm UAC từ xa ngay trong Giai đoạn 1.

#### 1.2. File tác động:
- `C:\Users\Hai Dang\Xemmanhinh\server\server_H264wss.py`
- `C:\Users\Hai Dang\Xemmanhinh\server\server_manager.py`
- `C:\Users\Hai Dang\Xemmanhinh\tools\enable_uac_on_desktop.bat` (tạo mới)

---

### GIAI ĐOẠN 2: TƯƠNG TÁC CHUỘT / PHÍM & TÍN HIỆU CTRL+ALT+DEL TẠI WINLOGON

#### 2.1. Nhiệm vụ kỹ thuật cụ thể:
1. **Gắn Desktop ngữ cảnh trước khi gọi `SendInput` (`server/server_H264wss.py`):**
   - Trong hàm xử lý chuột (`mouse_down`, `mouse_up`, `mouse_click`) và phím (`key_down`, `key_up`), bổ sung kiểm tra và gắn thread vào Active Desktop:
     ```python
     def ensure_input_desktop():
         try:
             hdesk = win32gui.OpenInputDesktop(0, False, win32service.MAXIMUM_ALLOWED)
             if hdesk:
                 win32gui.SetThreadDesktop(hdesk)
         except Exception:
             pass
     ```
   - Đảm bảo con trỏ chuột và bàn phím luôn tác động đúng vào desktop đang hiển thị (kể cả khi là `Winlogon`).
2. **Tích hợp API `SendSAS` (`sas.dll`) cho màn hình khóa:**
   - Xây dựng hàm phát tín hiệu SAS:
     ```python
     def send_sas_signal():
         try:
             return bool(ctypes.windll.sas.SendSAS(False))
         except Exception as e:
             return False
     ```
   - Bổ sung thông điệp WebSocket `{"type": "send_sas"}` để client có thể kích hoạt từ xa.
   - Cấu hình Registry tự động: `SoftwareSASGeneration = 3`.
3. **Nâng cấp giao diện Web Viewer (`web/viewer_H264wss_P_new.html`):**
   - Bổ sung nút bấm trên thanh công cụ điều khiển: **`[ 🔓 Gửi Ctrl+Alt+Del ]`**.
   - Khi người dùng gặp màn hình khóa yêu cầu bấm Ctrl+Alt+Del, chỉ cần bấm nút này để màn hình chuyển sang ô nhập mật khẩu.

#### 2.2. File tác động:
- `C:\Users\Hai Dang\Xemmanhinh\server\server_H264wss.py`
- `C:\Users\Hai Dang\Xemmanhinh\web\viewer_H264wss_P_new.html`

---

### GIAI ĐOẠN 3: KIẾN TRÚC DUAL-PROCESS WINDOWS SERVICE (PRE-LOGON STREAMING)

#### 3.1. Nhiệm vụ kỹ thuật cụ thể:
1. **Xây dựng Root Service (`XemmanhinhService` - Session 0):**
   - Đóng gói service nền chạy dưới tài khoản `NT AUTHORITY\SYSTEM`.
   - Sử dụng wrapper chuyên dụng (**WinSW** hoặc **NSSM**) để đảm bảo tính ổn định tối đa, tự khởi động cùng máy tính (`SERVICE_AUTO_START`).
   - Lắng nghe sự kiện phiên làm việc Windows qua `WTSRegisterSessionNotification()`.
2. **Cơ chế nạp Worker Agent vào Session Console (Session 1):**
   - Khi máy tính boot hoặc chuyển session:
     - Lấy ID phiên màn hình hiển thị: `WTSGetActiveConsoleSessionId()`.
     - Tìm tiến trình `winlogon.exe` trong phiên đó $\rightarrow$ mở token bằng `OpenProcessToken` $\rightarrow$ nhân bản bằng `DuplicateTokenEx`.
     - Gọi `CreateProcessAsUserW` để khởi động `server_H264wss.exe` trực tiếp bên trong Session 1 với quyền `SYSTEM`.
3. **Cơ chế Capture Fallback GDI tại màn hình LogonUI:**
   - Trong `server_H264wss.py`, nếu `dxcam` không hỗ trợ capture màn hình đăng nhập trên một số card đồ họa, tự động chuyển sang cơ chế dự phòng **GDI Screen Capture (`BitBlt` trên Device Context `DISPLAY`)**.
   - Đảm bảo hình ảnh màn hình đăng nhập luôn được gửi về web client với FPS ổn định.
4. **Bộ công cụ Cài đặt / Gỡ bỏ Service 1-Click:**
   - `service/install_service.bat`: Đăng ký service, cấu hình tự động mở port firewall, cấu hình SoftwareSASGeneration.
   - `service/uninstall_service.bat`: Dừng và gỡ bỏ service an toàn.

#### 3.2. File tác động:
- Thư mục `C:\Users\Hai Dang\Xemmanhinh\service\` (tạo mới cấu hình WinSW/NSSM và scripts).
- `C:\Users\Hai Dang\Xemmanhinh\server\server_H264wss.py` (bổ sung GDI fallback).

---

## 3. PHÂN CÔNG TRÁCH NHIỆM TRONG ĐỘI NGŨ AGENT

| Thành viên | Vai trò | Trách nhiệm chính |
| :--- | :--- | :--- |
| **Orchestrator-5182** | Điều phối chính | Quản lý tiến độ 3 giai đoạn, tổng hợp báo cáo và nghiệm thu tổng thể. |
| **coder-sched** | Coder chuyên trách | Sửa mã nguồn `server_H264wss.py`, `server_manager.py`, viết scripts `.bat` và cập nhật web viewer. |
| **verif-sched** | Verifier độc lập | Chạy test suite kiểm chứng cú pháp, giả lập lỗi `DXGI_ERROR_ACCESS_LOST`, kiểm chứng socket và đối soát mã trên đĩa. |
| **res-codebase** | Researcher | Hỗ trợ cấu hình WinSW/Service và đối soát tương thích Windows Internals. |

---

## 4. TIÊU CHÍ NGHIỆM THU (ACCEPTANCE CRITERIA)

| Giai đoạn | Tiêu chí nghiệm thu bắt buộc | Đánh giá |
| :---: | :--- | :---: |
| **GĐ 1** | - Mở hộp thoại UAC bất kỳ: Luồng capture không chết, WebSocket không ngắt kết nối.<br>- Client mới hoặc F5 trang khi đang có UAC: Kết nối thành công, nhận frame thông báo.<br>- Đóng UAC: Stream màn hình desktop phục hồi ngay lập tức sau tối đa 1.0 giây.<br>- Không còn popup Windows Defender Firewall chặn kết nối từ bên ngoài. | **PASS / FAIL** |
| **GĐ 2** | - Click chuột và gõ phím được tại màn hình Lock Screen / LogonUI.<br>- Nút bấm `[ Gửi Ctrl+Alt+Del ]` trên Web Viewer đánh thức được màn hình đăng nhập. | **PASS / FAIL** |
| **GĐ 3** | - Khởi động lại máy tính (Reboot): Người dùng từ xa truy cập được Web Viewer và thấy màn hình đăng nhập Windows mà không cần ai ngồi tại máy login trước.<br>- Nhập mật khẩu từ xa đăng nhập thành công vào màn hình Desktop. | **PASS / FAIL** |

---
*Tài liệu kế hoạch đã được phê duyệt và lưu trữ chính thức trong dự án.*
