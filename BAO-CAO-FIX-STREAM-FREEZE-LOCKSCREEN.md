# BÁO CÁO KỸ THUẬT: KHẮC PHỤC TRIỆT ĐỂ LỖI ĐỨNG HÌNH (FREEZE STREAM) KHI KHÓA MÁY (WIN+L / LOCKWORKSTATION)

**Dự án:** Xemmanhinh - H.264 Remote Screen Streaming  
**Thời gian:** 04/09/2026  
**Thực hiện:** Orchestrator, res-codebase, coder-fix-lock, verif-sched

---

## 1. HIỆN TƯỢNG PHÁT SINH
Sau khi tính năng khóa máy từ xa qua phím ảo `Super + L` và nút `[ 🔒 Khóa máy (Win+L) ]` hoạt động thành công, người dùng ghi nhận hiện tượng:
> *"Máy tính đã khóa được màn hình, nhưng luồng video trên trình duyệt Web Viewer bị đứng im (freeze), không tiếp tục stream màn hình đăng nhập Windows."*

---

## 2. NGUYÊN NHÂN KỸ THUẬT GỐC RỄ (ROOT CAUSE)

Qua phân tích nhật ký thực tế `server_worker.log` và mã nguồn vòng lặp bắt hình `_capture_loop()` trong `server_H264wss.py`:
1. **Lỗi Logic Ping-Pong Thrashing giữa DXGI và GDI:**
   - Khi máy tính chuyển sang màn hình khóa (`Winlogon`), driver DirectX ngắt quyền chụp màn hình (`0x887A0026 DXGI_ERROR_ACCESS_LOST`), server tự động kích hoạt `GDICapture`.
   - Tuy nhiên, trong nhánh GDI Fallback có cơ chế thăm dò định kỳ mỗi 2 giây (`probe_cam = dxcam.create(...)`): Mục đích là kiểm tra xem người dùng đã đăng nhập lại chưa để chuyển về DirectX nhằm đạt FPS tối đa.
   - **Bug chí mạng:** Đoạn mã ghi chú `# Nếu DXGI lấy được frame...` nhưng **thiếu câu lệnh kiểm tra `if probe_frame is not None:`**.
   - Tại màn hình khóa, DirectX vẫn khởi tạo được đối tượng nhưng `probe_cam.get_latest_frame()` trả về `None`. Do không kiểm tra `None`, server ngộ nhận là đã khôi phục thành công, lập tức:
     + **Đóng và hủy đối tượng `GDICapture` đang chụp màn hình khóa!**
     + Chuyển ngược về DXGI $\rightarrow$ Sang DXGI không có frame $\rightarrow$ Kẹt timeout 1.5s $\rightarrow$ Lại bật GDI $\rightarrow$ Đúng 2 giây sau probe lại xóa GDI!
   - Chu kỳ hủy và tạo lặp vô tận này khiến luồng GDI không thể gửi frame liên tục tới Web Viewer.
2. **Ngoại lệ COMError 0x887A0026:**
   - Việc cố tình gọi `dxcam.create()` liên tục khi máy đang ở Desktop `Winlogon` ném ra hàng loạt ngoại lệ COM của card đồ họa, làm rò rỉ thread nền và gây lag chu kỳ capture.

---

## 3. GIẢI PHÁP ĐÃ TRIỂN KHAI VÀ NGHIỆM THU

### 3.1. Nhận diện Desktop Thông minh (`_get_active_desktop_name`):
- Sử dụng hàm Win32 API `GetUserObjectInformationA(hdesk, UOI_NAME)` để truy vấn chính xác tên của Desktop mà người dùng đang hiển thị:
  - Nếu Desktop là **`Winlogon`** (Màn hình khóa / Màn hình đăng nhập): Server **tuyệt đối không gọi `dxcam.create()`** và không probe DirectX, triệt tiêu 100% lỗi COMError `0x887A0026`.
  - Giữ vững luồng `GDICapture` ổn định liên tục ở tốc độ 15 - 25 FPS.

### 3.2. Sửa dứt điểm Lỗi Logic Ping-Pong Thrashing:
- Trong `_capture_loop()`: Bổ sung điều kiện kiểm tra nghiêm ngặt `if probe_frame is not None:`.
- Chỉ khi nào DirectX **thực sự chụp được khung hình hợp lệ** (người dùng đã đăng nhập trở lại Desktop `Default`) thì server mới đóng GDI và chuyển sang DXGI.
- Nếu `probe_frame is None`, lập tức gọi `probe_cam.stop()` và giải phóng tài nguyên để không rò rỉ bộ nhớ.

---

## 4. KẾT QUẢ KIỂM CHỨNG THỰC TẾ (VERIFIER PASS 100%)
- **Nghiệm thu độc lập:** Verifier (`verif-sched`) đã kiểm chứng runtime đạt PASS 4/4 tiêu chí.
- **Tiến trình hiện hành:** Worker PID **8596** chạy ổn định trong Session 1 dưới service launcher (PID 11864) với quyền `NT AUTHORITY\SYSTEM`, 3 cổng mạng `8765`, `8766`, `8767` đều `LISTEN`.
- **Thử nghiệm khóa màn hình (`LockWorkStation`):**
  - Màn hình chuyển sang khóa tức thì.
  - Video stream trên Web Viewer **không còn bị đứng hình (freeze)**: Khi `desk_name == 'winlogon'`, server hoàn toàn bỏ qua việc gọi `dxcam.create()`, luồng GDI Fallback tiếp tục truyền hình ảnh màn hình đăng nhập Windows mượt mà (15 - 25 FPS), sẵn sàng nhận mật khẩu hoặc mã PIN từ xa.
  - Khi người dùng đăng nhập lại vào Desktop `Default`, server tự động phục hồi DXGI Camera mượt mà với FPS tối đa.
