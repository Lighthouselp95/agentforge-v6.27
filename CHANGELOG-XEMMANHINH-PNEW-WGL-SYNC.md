# CHANGELOG: ĐỒNG BỘ TOÀN DIỆN HỆ THỐNG P_NEW VÀ WGL (SERVER & 2 WEB CLIENTS)

**Ngày thực hiện:** 06/09/2026  
**Thành phần cập nhật:**  
- `C:\Users\Hai Dang\Xemmanhinh\web\viewer_H264wss_P_new.html`
- `C:\Users\Hai Dang\Xemmanhinh\web\viewer_H264wss_P_wgl.html`
- `C:\Users\Hai Dang\Xemmanhinh\server\server_H264wss_testP_new.py` (server chính thức đang chạy)
- `C:\Users\Hai Dang\Xemmanhinh\server\server_H264wss.py` (file cũ, đã đánh dấu DEPRECATED)
- `C:\Users\Hai Dang\Xemmanhinh\service\service_launcher.py`

---

## 1. MỤC TIÊU TRIỂN KHAI
- Đánh dấu nhận diện file cũ `server_H264wss.py`.
- Tích hợp và đồng bộ hóa toàn diện các cải tiến hiệu năng sang hệ sinh thái client phục vụ cả 2 phiên bản web:
  1. **`viewer_H264wss_P_new.html`**: Client Canvas 2D Broadway / WebCodecs.
  2. **`viewer_H264wss_P_wgl.html`**: Client WebGL Hardware Renderer (GPU Shaders).

---

## 2. NỘI DUNG NÂNG CẤP VÀ ĐỒNG BỘ CHI TIẾT

### A. Đồng bộ 2 Web Client (`P_new` và `wgl`):
1. **Khắc phục lỗi tụt 1 FPS khi Double-tap Drag:**
   - Cả 2 client khi thực hiện thao tác double-tap kéo chuột (`doubleTapSelecting || _mouseHeld`) không còn gọi thô `sendMsg({ type: 'mouse_move' })`.
   - Đã chuyển sang gọi `sendMouseMove(...)` có cơ chế throttle cố định **33ms (~30fps)**.
2. **Tối ưu hóa thao tác cuộn (Scroll Accumulator & Clamping):**
   - Tích hợp hàm `sendThrottledScroll(dy)` với bộ tích lũy `_pendingScrollDy`, throttle timer **35ms (~30fps)** và ngưỡng chặn an toàn `Math.max(-5, Math.min(5, rawClicks))`.
   - Áp dụng thống nhất cho cả sự kiện lăn bánh xe chuột PC (`wheel`) và thao tác vuốt cuộn chạm trên thiết bị di động (`onTouchMove`).
3. **Hiển thị trạng thái Bộ mã hóa Phần cứng (Encoder Metadata Badge):**
   - Bổ sung thẻ trạng thái `#encoder-status-badge` trên thanh status bar.
   - Thêm bảng chi tiết "Hardware Encoder Status" trong Settings panel, cập nhật trực tiếp theo gói tin handshake `init` và `encoder_info` từ server.

### B. Phía Server & Service Launcher:
1. **Server chính thức chuyển sang P_new:**
   - File chạy thực tế: `C:\Users\Hai Dang\Xemmanhinh\server\server_H264wss_testP_new.py`
   - `service_launcher.py` dòng 347 ưu tiên `py_worker = os.path.join(server_dir, "server_H264wss_testP_new.py")`.
2. **Đánh dấu file cũ `server_H264wss.py`:**
   - Chèn banner cảnh báo header rõ ràng ở đầu file:
     ```python
     # ==============================================================================
     # ⚠️ DEPRECATED / KHÔNG DÙNG - FILE BỊ BỎ RƠI / UNUSED ARCHIVED FILE ⚠️
     # ==============================================================================
     ```
3. **Các bản vá hiệu năng đã chuyển sang P_new:**
   - 3-tier Fallback Encoder: Tầng 1 `h264_nvenc`, Tầng 2 `h264_qsv` (Intel UHD Graphics với `preset='veryfast'`, `tune='zerolatency'`, `profile='baseline'`, `async_depth='1'`), Tầng 3 `libx264`.
   - Bitrate Clamping: `maxrate='4000000'`, `bufsize='2000000'` chống nghẽn đường truyền khi cuộn trang.
   - Win32 Input: Thao tác cuộn chuột truyền thẳng `mouseData = int(dy * 120)` vào `SendInput`.
   - Lệnh khóa màn hình Win+L: `lock_workstation()`.
   - HTTP Handler phục vụ cả `/` → `viewer_H264wss_P_new.html` và `/viewer_H264wss_P_wgl.html`.

---

## 3. KẾT QUẢ NGHIỆM THU ĐỘC LẬP TỪ VERIFIER
- **Cú pháp mã nguồn:** Node.js AST Script Validator đạt **0 syntax error** trên cả 2 tệp HTML.
- **Tiến trình Runtime:** Worker PID **16316** (Session 1) chạy lệnh `"python.exe" "...\server\server_H264wss_testP_new.py" --always-run`.
- **Cổng mạng:** **8765** (HTTPS), **8766** (WSS Video), **8767** (WSS Audio) đều `Listen`.
- **HTTPS:** Cả 3 URL `/`, `/viewer_H264wss_P_new.html`, `/viewer_H264wss_P_wgl.html` trả về HTTP 200 OK.
- **Kiểm thử WebSocket:** Handshake trả về chính xác `Intel QuickSync (h264_qsv)` và chuỗi ưu tiên `NVENC > Intel QSV > libx264`.
- **Xử lý lỗi disconnect/lag FPS:** Tăng timeout gửi frame thường lên 0.15s, keyframe lên 0.3s; bổ sung catch Exception toàn diện trong `send_video_to_clients`; đánh dấu client cần keyframe khi timeout để phục hồi decode.
- **Kết luận:** **PASS 100%**.
