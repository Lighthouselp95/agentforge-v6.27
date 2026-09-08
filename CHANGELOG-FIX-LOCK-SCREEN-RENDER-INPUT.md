# CHANGELOG - SỬA DỨT ĐIỂM RENDER HÌNH ẢNH VÀ BÀN PHÍM/CHUỘT TẠI MÀN HÌNH KHÓA (LOCK SCREEN)

**Dự án:** Xemmanhinh - H264 Screen Viewer  
**Ngày hoàn thành:** 04/09/2026  
**Người thực hiện:** Đội ngũ AgentForge (coder-stage3, coder-fix-lock, res-codebase, verif-sched, Orchestrator)

---

## 1. VẤN ĐỀ GẶP PHẢI
Khi người dùng bấm khóa màn hình (`Win + L` hoặc Pre-logon / LogonUI):
- **Web Viewer:** Báo trạng thái `Connected` nhưng video canvas đen kịt hoặc không hiển thị khung hình mới.
- **Bàn phím & Chuột:** Các thao tác click chuột và gõ phím từ Web Viewer không tác động được vào màn hình khóa Windows.

---

## 2. NGUYÊN NHÂN TẬN GỐC (ROOT CAUSE)
1. **Thiếu IDR Keyframe khi chuyển sang GDI:**
   - Khi màn hình bị khóa, DXGI mất quyền truy cập (`DXGI_ERROR_ACCESS_LOST`). Server tự động chuyển sang `GDICapture`.
   - Tuy nhiên, server không ép gửi IDR Keyframe (chứa SPS/PPS) mà chỉ gửi delta frames hoặc ping giữ nhịp JSON `uac_wait`. Trình duyệt web (`JMuxer` / `WebCodecs`) không có IDR frame nên không thể khởi tạo decoder và không render được hình ảnh.
2. **Handle Desktop bị đóng quá sớm (`CloseDesktop`):**
   - Trong `_attach_active_input_desktop()`, hàm gọi `CloseDesktop(hdesk)` ngay sau `SetThreadDesktop(hdesk)`. Theo quy ước Win32 API, việc giải phóng handle này khiến việc gán Desktop của thread bị hủy, dẫn tới lệnh `SendInput` và lệnh chụp `BitBlt` bị mất ngữ cảnh của màn hình khóa `Winlogon`.
3. **Quyền truy cập Token của Worker:**
   - `service_launcher.py` mở `winlogon.exe` bằng access mask quá cao `PROCESS_ALL_ACCESS (0x1F0FFF)`, bị kernel Windows từ chối với lỗi `Access Denied (Error 5)`.

---

## 3. GIẢI PHÁP ĐÃ TRIỂN KHAI VÀ NGHIỆM THU

### 3.1. Ép gửi Keyframe tức thì (`_force_keyframe_next = True`):
- Trong `server_H264wss.py`: Bật cờ `_force_keyframe_next = True` tại mọi điểm chuyển sang GDI Fallback.
- Encoder x264/PyAV lập tức sinh IDR Keyframe kèm thông số SPS/PPS, gửi tới client qua WebSocket để Web Viewer giải mã và vẽ ngay giao diện màn hình khóa lên canvas.

### 3.2. Quản lý Desktop Handle bền vững:
- Trong `server_H264wss.py`: Lưu `_current_active_desktop_handle`, chỉ đóng handle desktop cũ khi có desktop mới thực sự thay đổi, **tuyệt đối không đóng handle desktop hiện đang active của thread**.
- Gọi `_attach_active_input_desktop()` đồng bộ trước mỗi khung hình GDI `BitBlt` và trước mỗi lệnh phím/chuột `SendInput`.

### 3.3. Chuẩn hóa quyền nhân bản Token SYSTEM:
- Trong `service_launcher.py`: Sử dụng access mask chuẩn `PROCESS_QUERY_INFORMATION (0x0400)` để mở `winlogon.exe`. Nhân bản thành công token SYSTEM gắn vào Console Session để worker chạy với quyền tối cao, tự do tương tác với Desktop `winsta0\Winlogon`.

---

## 4. KẾT QUẢ THỰC NGHIỆM
- Boot Task `XemmanhinhBootService`: Chạy ổn định dưới quyền `SYSTEM`.
- Worker mới (PID 15884): Nhân bản thành công từ `winlogon.exe` (PID 436).
- Cả 3 cổng `8765`, `8766`, `8767`: `LISTENING` trên `0.0.0.0`.
- HTTPS Web Viewer: Phản hồi `200 OK`, hiển thị hình ảnh màn hình khóa và tiếp nhận tương tác chuột/phím bình thường.
