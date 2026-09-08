# ĐỀ XUẤT CẢI TIẾN HỆ THỐNG: XỬ LÝ SỰ CỐ UAC / FIREWALL & STREAMING MÀN HÌNH ĐĂNG NHẬP WINDOWS

> **Dự án áp dụng:** Xemmanhinh - H264 Screen Viewer  
> **Đường dẫn dự án:** `C:\Users\Hai Dang\Xemmanhinh`  
> **Ngày lập tài liệu:** 04/09/2026  
> **Người lập:** Main Orchestrator & Specialist Research Team

---

## MỤC LỤC
1. [VẤN ĐỀ 1: SỰ CỐ MẤT KẾT NỐI KHI HIỂN THỊ HỘP THOẠI BẢO MẬT UAC & FIREWALL](#1-vấn-đề-1-sự-cố-mất-kết-nối-khi-hiển-thị-hộp-thoại-bảo-mật-uac--firewall)
   - [1.1. Hiện tượng thực tế](#11-hiện-tượng-thực-tế)
   - [1.2. Nguyên nhân gốc rễ (Root Causes)](#12-nguyên-nhân-gốc-rễ-root-causes)
   - [1.3. Giải pháp khắc phục đề xuất](#13-giải-pháp-khắc-phục-đề-xuất)
2. [VẤN ĐỀ 2: KHẢ NĂNG VÀ PHƯƠNG ÁN STREAM TỪ MÀN HÌNH ĐĂNG NHẬP (PRE-LOGON & LOCK SCREEN)](#2-vấn-đề-2-khả-năng-và-phương-án-stream-từ-màn-hình-đăng-nhập-pre-logon--lock-screen)
   - [2.1. Đánh giá tính khả thi](#21-đánh-giá-tính-khả-thi)
   - [2.2. Rào cản kỹ thuật của Windows (Session 0 Isolation & Winlogon Desktop)](#22-rào-cản-kỹ-thuật-của-windows-session-0-isolation--winlogon-desktop)
   - [2.3. Kiến trúc chuẩn công nghiệp (RustDesk / AnyDesk / TeamViewer)](#23-kiến-trúc-chuẩn-công-nghiệp-rustdesk--anydesk--teamviewer)
   - [2.4. Phương án triển khai chi tiết cho dự án Xemmanhinh](#24-phương-án-triển-khai-chi-tiết-cho-dự-án-xemmanhinh)
3. [LỘ TRÌNH TRIỂN KHAI THỰC TẾ (ACTIONABLE ROADMAP)](#3-lộ-trình-triển-khai-thực-tế-actionable-roadmap)

---

## 1. VẤN ĐỀ 1: SỰ CỐ MẤT KẾT NỐI KHI HIỂN THỊ HỘP THOẠI BẢO MẬT UAC & FIREWALL

### 1.1. Hiện tượng thực tế
- Khi máy tính chủ (Host) xuất hiện hộp thoại UAC (User Account Control - bảng hỏi Yes/No để cấp quyền Admin) hoặc hộp thoại Windows Defender Firewall (hỏi cấp quyền truy cập mạng cho ứng dụng khác):
  1. Người xem từ xa trên trình duyệt lập tức bị **đóng băng hình ảnh (Freeze)** ở khung hình cuối cùng.
  2. Nếu người xem F5 tải lại trang hoặc có thiết bị mới kết nối vào qua mạng LAN/Internet: **Bị ngắt kết nối hoàn toàn**, trình duyệt báo `WebSocket connection closed (code 1006 / 1011)` hoặc `Connection timed out`.
  3. Sau khi hộp thoại UAC được người ngồi tại máy bấm tắt, remote stream vẫn không phục hồi được hoặc server bị treo luồng capture.

---

### 1.2. Nguyên nhân gốc rễ (Root Causes)

#### A. Cơ chế bảo vệ Secure Desktop của Windows
- Mặc định, khi có thông báo UAC, Windows chuyển toàn bộ giao diện từ Desktop người dùng thông thường (`WinSta0\Default`) sang **Secure Desktop (`WinSta0\Winlogon`)** do tiến trình `consent.exe` và `AppInfo` Service (`SYSTEM`) độc quyền kiểm soát.
- Ngay khi chuyển Desktop, giao diện **DXGI Desktop Duplication API** (`dxcam`) của Windows lập tức thu hồi quyền truy cập đồ họa và trả về mã lỗi phần cứng:
  $$\text{DXGI\_ERROR\_ACCESS\_LOST } (0x887A0026)$$
- Đồng thời, cơ chế **UIPI (User Interface Privilege Isolation)** chặn 100% các thông điệp chuột/phím ảo (`SendInput`) từ các ứng dụng chạy ở Medium/High Integrity Level của User vào cửa sổ UAC.

#### B. Lỗ hổng xử lý ngoại lệ trong mã nguồn `server/server_H264wss.py`
Qua điều tra mã nguồn thực tế:
1. **Chết vĩnh viễn luồng Capture (`_capture_loop` - dòng 644-668):**
   - Khi DXGI bị thu hồi, `_camera.get_latest_frame()` trả về `None`. Sau 2 giây không có frame mới, code nhảy vào khối `except Exception as e:` để phục hồi.
   - Tại dòng 665: `_camera = dxcam.create(output_color="BGR")` được gọi lại **nhưng không có khối try-except bọc ngoài**. Khi UAC đang mở, hàm này ném ngoại lệ `Exception` (Access Denied).
   - Ngoại lệ không được bắt (Unhandled Exception) khiến luồng `_capture_loop` **DỪNG VĨNH VIỄN (Dead Thread)**.
2. **Sập kết nối WebSocket khi có client mới hoặc F5 trang (`ws_handler` - dòng 1597):**
   - Lệnh `await asyncio.get_event_loop().run_in_executor(None, _ensure_streaming)` gọi `_init_capture()`.
   - Do UAC đang bật, `_init_capture` ném ngoại lệ làm văng hàm `ws_handler` trước khi hoàn tất handshake. Kết nối WebSocket bị đóng bất thường với CloseCode 1006.

#### C. Cơ chế lọc gói tin của Windows Firewall (WFP)
- Khi Windows Firewall hiện popup hỏi người dùng có cho phép ứng dụng mở cổng mạng không, nền tảng **Windows Filtering Platform (WFP)** sẽ **chặn tạm thời (Drop)** toàn bộ các gói tin TCP Inbound từ bên ngoài vào cho đến khi người dùng bấm nút "Allow". Thiết bị từ ngoài cố kết nối vào thời điểm này sẽ bị `Connection refused` hoặc `Timed out`.

---

### 1.3. Giải pháp khắc phục đề xuất

#### Giải pháp 1: Khắc phục mã nguồn Server (Graceful Fallback & Anti-Crash) — *Bắt buộc & Triển khai ngay*
1. **Bọc an toàn tuyệt đối cho luồng Capture:**
   - Trong `_capture_loop()`, bao bọc lệnh `dxcam.create()` và `_start_camera_safe()` trong try-except có kiểm tra mã lỗi `DXGI_ERROR_ACCESS_LOST`.
   - Khi phát hiện đang ở Secure Desktop / UAC, **không cho crash luồng** mà đưa luồng vào trạng thái chờ nhẹ (polling mỗi 0.5s bằng `time.sleep(0.5)`).
   - Ngay khi người dùng đóng UAC và desktop trở về `WinSta0\Default`, tự động tái khởi tạo `dxcam` mượt mà không cần restart server.
2. **Bọc an toàn cho `_ensure_streaming()`:**
   - Trong `ws_handler`, bọc `try...except` quanh `_ensure_streaming()`. Nếu capture chưa sẵn sàng do UAC, WebSocket vẫn chấp nhận kết nối, gửi bản tin `init` và phát khung hình chờ.
3. **Phát khung hình tĩnh thông báo (Placeholder Frame):**
   - Trong lúc UAC hiển thị, thay vì không gửi gì khiến client tưởng bị đứt mạng, server gửi định kỳ 1 khung hình H.264 tĩnh (Black frame hoặc ảnh thông báo: *"Màn hình UAC / Bảo mật đang mở trên máy chủ. Vui lòng thao tác trên máy thật..."*).
   - Giúp kết nối WebSocket luôn duy trì ping/pong, không bị timeout.
4. **Tự động mở cổng Windows Firewall bằng lệnh Admin:**
   - Trong launcher `server_manager.py` hoặc file script khởi động, tự động chạy lệnh cấu hình Firewall trước:
     ```cmd
     netsh advfirewall firewall add rule name="Xemmanhinh_Server" dir=in action=allow protocol=TCP localport=8765,8766,8767 profile=any
     ```
   - Tránh việc Windows phải hiện popup hỏi mở port làm gián đoạn mạng.

#### Giải pháp 2: Tắt Secure Desktop qua Registry (Cho môi trường máy cá nhân / nội bộ)
- Cấu hình Registry để UAC hiển thị ngay trên Desktop thông thường thay vì chuyển Desktop:
  - Khóa: `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System`
  - Giá trị: `PromptOnSecureDesktop = 0` (DWORD)
- **Hiệu quả:** Hộp thoại UAC xuất hiện như một cửa sổ thông thường. DXGI chụp được toàn bộ cửa sổ UAC bình thường mà không bị `ACCESS_LOST`.

---

## 2. VẤN ĐỀ 2: KHẢ NĂNG VÀ PHƯƠNG ÁN STREAM TỪ MÀN HÌNH ĐĂNG NHẬP (PRE-LOGON & LOCK SCREEN)

### 2.1. Đánh giá tính khả thi
- **CÂU TRẢ LỜI: HOÀN TOÀN CÓ THỂ LÀM ĐƯỢC.**
- Đây là tính năng tiêu chuẩn của các phần mềm Remote Desktop thương mại (AnyDesk, TeamViewer, RustDesk, UltraViewer) cho phép quản trị viên xem và đăng nhập vào máy tính từ xa ngay khi máy vừa bật nguồn (chưa có user nào login) hoặc khi máy đang bị khóa màn hình (`Win + L`).

---

### 2.2. Rào cản kỹ thuật của Windows (Session 0 Isolation & Winlogon Desktop)

1. **Session 0 Isolation (Từ Windows Vista đến Windows 11):**
   - Tất cả các Windows Services đều chạy trong **Session 0**.
   - Session 0 là môi trường cô lập, hoàn toàn **phi tương tác (Non-interactive)**: Không có card màn hình vật lý, không có giao diện hiển thị, không thể gọi DXGI Desktop Duplication (`dxcam` sẽ báo lỗi không tìm thấy màn hình).
2. **Màn hình Đăng nhập nằm ở đâu?**
   - Màn hình đăng nhập (`LogonUI.exe`) và màn hình khóa nằm trong **Session Console (Session 1)** trên Window Station `WinSta0`, thuộc Desktop **`Winlogon`**.
   - Các ứng dụng chạy dưới tài khoản User thông thường (Startup thông thường) sẽ bị hệ thống **treo hoặc ngắt quyền chụp** khi máy bị khóa màn hình. Khi máy vừa boot mà chưa login, ứng dụng của User thậm chí **chưa được khởi chạy**.

---

### 2.3. Kiến trúc chuẩn công nghiệp (RustDesk / AnyDesk / TeamViewer)

Để stream được màn hình đăng nhập, kiến trúc bắt buộc phải gồm **2 tiến trình (Dual-Process Model)** phối hợp:

```
┌─────────────────────────────────────────────────────────────┐
│                       SESSION 0                             │
│  [Windows Service (NT AUTHORITY\SYSTEM)]                    │
│   - Quản lý vòng đời (Lifecycle)                            │
│   - Quản lý kết nối mạng / WebSocket listener               │
│   - Giám sát sự kiện: WTSRegisterSessionNotification        │
└──────────────────────────────┬──────────────────────────────┘
                               │ CreateProcessAsUserW
                               │ (với token của Winlogon.exe)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 SESSION 1 (CONSOLE SESSION)                 │
│  [Worker Capture Agent]                                     │
│   - Gắn kết với GPU Context (D3D11 / NVENC)                 │
│   - Chuyển Desktop: OpenInputDesktop + SetThreadDesktop     │
│   - Khi Desktop = "Default"  --> Chụp User Desktop bằng DXGI│
│   - Khi Desktop = "Winlogon" --> Chụp Màn hình Login/Lock   │
│   - Gửi frame H.264 qua Named Pipe / Shared Memory          │
└─────────────────────────────────────────────────────────────┘
```

---

### 2.4. Phương án triển khai chi tiết cho dự án Xemmanhinh

Có 2 phương án tùy theo mức độ đầu tư kiến trúc:

#### PHƯƠNG ÁN A: Kiến trúc Dual-Process Service (Chuẩn công nghiệp — Khuyên dùng cho bản cài đặt)
1. **Tạo Windows Service (Root Service):**
   - Đóng gói service bằng Python (`pywin32` `win32serviceutil`) hoặc dùng wrapper siêu nhẹ **WinSW / NSSM**.
   - Cài đặt Service chạy với quyền `NT AUTHORITY\SYSTEM`, chế độ khởi động `Automatic` (chạy ngay khi boot trước khi người dùng đăng nhập).
2. **Cơ chế Spawn Worker vào Session Console:**
   - Service trong Session 0 dùng hàm Win32 API:
     - `WTSGetActiveConsoleSessionId()` để lấy ID phiên màn hình vật lý (Session 1).
     - Tìm tiến trình `winlogon.exe` trong Session đó $\rightarrow$ `OpenProcess` $\rightarrow$ `OpenProcessToken` $\rightarrow$ `DuplicateTokenEx`.
     - Gọi `CreateProcessAsUserW` để kích hoạt tiến trình `server_H264wss.exe` chạy trong Session 1 với quyền SYSTEM.
3. **Cơ chế bắt hình linh hoạt (Desktop Switcher):**
   - Trong `server_H264wss.py`, sử dụng thread monitor desktop:
     ```python
     import win32service, win32gui, win32process

     def switch_to_input_desktop():
         hdesk = win32gui.OpenInputDesktop(0, False, win32service.MAXIMUM_ALLOWED)
         if hdesk:
             win32gui.SetThreadDesktop(hdesk)
             return True
         return False
     ```
   - Khi ở Desktop `Winlogon`: Nếu DXGI không hỗ trợ capture màn hình login trên một số dòng GPU cũ, tự động chuyển sang cơ chế **GDI Screen Capture fallback** (`CreateDC("DISPLAY")` + `BitBlt`) để chụp giao diện đăng nhập và nạp vào bộ mã hóa H.264.

#### PHƯƠNG ÁN B: Triển khai nhanh qua Windows Task Scheduler (Không cần viết Service phức tạp)
Nếu chưa muốn viết kiến trúc Service đa tiến trình:
1. Sử dụng **Windows Task Scheduler** (hoặc ứng dụng `startup-manager` vừa hoàn thiện):
   - Tạo tác vụ mới với Trigger: **At system startup (Khi máy khởi động)**.
   - Tài khoản chạy: **`NT AUTHORITY\SYSTEM`**.
   - Cấu hình thẻ XML: `<RunLevel>HighestAvailable</RunLevel>`.
2. Hạn chế của Phương án B: Cần cấu hình cho phép task tương tác với Session Console của Windows, nếu không sẽ bị kẹt tại Session 0. Do đó, Phương án A vẫn là chuẩn mực tối ưu nhất.

---

## 3. LỘ TRÌNH TRIỂN KHAI THỰC TẾ (ACTIONABLE ROADMAP)

| Giai đoạn | Nhiệm vụ cụ thể | Thời gian / Mức độ | File liên quan |
| :--- | :--- | :---: | :--- |
| **Giai đoạn 1 (Ngay lập tức)** | **Vá lỗi Crash UAC & Firewall trong Server:**<br>- Bọc try-except chống chết luồng tại dòng 644-668 trong `_capture_loop()`.<br>- Bọc try-except cho `_ensure_streaming()` tại dòng 1597 trong `ws_handler()`.<br>- Tự động thêm rule Windows Firewall mở port 8765/8766/8767 trong `server_manager.py`. | **Ưu tiên 1** (Dễ làm, hiệu quả ngay) | `server/server_H264wss.py`<br>`server/server_manager.py` |
| **Giai đoạn 2 (Hoàn thiện UX)** | **Placeholder Frame & Phục hồi tự động:**<br>- Phát khung hình thông báo tĩnh khi DXGI bị `ACCESS_LOST`.<br>- Tự động re-attach camera sau khi người dùng bấm xong UAC mà không cần reload trang. | **Ưu tiên 2** | `server/server_H264wss.py`<br>`web/viewer_H264wss_P_new.html` |
| **Giai đoạn 3 (Nâng cao)** | **Stream Màn hình Đăng nhập (Pre-logon):**<br>- Xây dựng launcher Windows Service (`NSSM` / `WinSW` / C++ injector).<br>- Tích hợp cơ chế `OpenInputDesktop` và GDI fallback cho màn hình `LogonUI.exe`. | **Ưu tiên 3** (Kiến trúc lớn) | Thư mục `service/`<br>`server/server_H264wss.py` |

---
*Tài liệu được tổng hợp và lưu trữ chính thức tại kho tài liệu của hệ thống.*
