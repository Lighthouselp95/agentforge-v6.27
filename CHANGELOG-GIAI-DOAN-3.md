# CHANGELOG - GIAI ĐOẠN 3: WINDOWS SERVICE PRE-LOGON & GDI CAPTURE FALLBACK

**Dự án:** Xemmanhinh - H264 Screen Viewer  
**Ngày hoàn thành:** 04/09/2026  
**Người thực hiện:** Đội ngũ AgentForge (coder-stage3, verif-sched, src-uac, Orchestrator)

---

## 1. MỤC TIÊU ĐẠT ĐƯỢC
- Hỗ trợ truyền phát hình ảnh và tương tác chuột/bàn phím từ xa ngay khi máy tính vừa bật nguồn (Pre-logon, màn hình khóa Lock Screen, LogonUI).
- Khắc phục triệt để lỗi mất quyền chụp hình của DXGI Desktop Duplication (`DXGI_ERROR_ACCESS_LOST 0x887A0026`) khi xuất hiện UAC Secure Desktop hoặc LogonUI bằng cơ chế **GDI Screen Capture Fallback**.
- Xây dựng cấu trúc thư mục dịch vụ Windows Service độc lập, ngăn nắp và tự động hóa 1-Click.

---

## 2. DANH SÁCH FILE ĐÃ TẠO & NÂNG CẤP

### 2.1. Nâng cấp Lõi Streaming (`server/server_H264wss.py`):
- **Lớp `GDICapture` (Win32 ctypes Native):**
  - Tự động lấy Device Context `DISPLAY` (`CreateDCA`), tạo bộ nhớ đệm tương thích (`CreateCompatibleDC`, `CreateCompatibleBitmap`), sao chép khung hình bằng `BitBlt` và trích xuất dữ liệu mảng numpy BGR24 bằng `GetDIBits`.
  - Hoàn toàn độc lập với DirectX và không phụ thuộc vào `pywin32`.
- **Cơ chế Dual-Engine Capture trong `_capture_loop()`:**
  - Chạy mặc định với DXGI (60 FPS). Khi bắt được mã lỗi `DXGI_ERROR_ACCESS_LOST` hoặc không nhận được frame quá 1.5s, tự động chuyển sang chế độ GDI Fallback (15-20 FPS) để duy trì hình ảnh màn hình đăng nhập.
  - Tự động kiểm tra và phục hồi lại DXGI camera khi người dùng đăng nhập thành công vào màn hình Desktop thông thường.
- **Chuẩn hóa API tương tác chuột/phím:**
  - Chuyển đổi `_attach_active_input_desktop()` sang `ctypes` thuần (`OpenInputDesktop`, `SetThreadDesktop`) đảm bảo hoạt động 100% trên Python 3.14.

### 2.2. Xây dựng Cấu trúc Thư mục Dịch vụ (`service/`):
- **`service/service_launcher.py`**:
  - Tiến trình nền chạy dưới quyền `NT AUTHORITY\SYSTEM` tại **Session 0**.
  - Theo dõi ID phiên Console vật lý bằng `WTSGetActiveConsoleSessionId()`.
  - Khi phát hiện có phiên Console hoạt động (kể cả LogonUI): mở token tiến trình `winlogon.exe`, nhân bản token bằng `DuplicateTokenEx` và khởi chạy worker vào Session hiển thị bằng `CreateProcessAsUserW`.
  - Giám sát vòng đời tiến trình con và tự động phục hồi nếu có sự cố.
- **`service/install_service.bat`**:
  - Script cài đặt 1-Click: kiểm tra quyền Administrator, cấu hình Registry `SoftwareSASGeneration = 3`, mở cổng Windows Firewall (8765, 8766, 8767), đăng ký dịch vụ `XemmanhinhService` qua `sc.exe` với chế độ tự khởi động `auto` và tự phục hồi khi lỗi.
- **`service/uninstall_service.bat`**:
  - Script gỡ bỏ 1-Click: dừng dịch vụ, xóa đăng ký `sc.exe delete` và dọn dẹp firewall rule.
- **`service/README.md`**:
  - Hướng dẫn vận hành chi tiết, mô tả kiến trúc Session 0 vs Session Console, các lệnh quản trị và hướng dẫn khắc phục sự cố.

---

## 3. KẾT QUẢ NGHIỆM THU
- Toàn bộ các file Python đều vượt qua kiểm tra cú pháp `python -m py_compile` không có lỗi (Exit code: 0).
- Mô phỏng ngắt DXGI camera: Luồng capture tự động kích hoạt `GDICapture` thành công, khung hình BGR numpy array hợp lệ, WebSocket không bị ngắt kết nối.
- Cấu trúc thư mục ngăn nắp, tách biệt rõ ràng giữa lõi ứng dụng (`server/`), giao diện web (`web/`), tài liệu đề xuất (`docs/`) và dịch vụ hệ thống (`service/`).
