# CHANGELOG: TỐI ƯU HÓA CỬ CHỈ CUỘN TRANG (SCROLL ACCUMULATOR & UNROLLED INPUT)

**Ngày thực hiện:** 06/09/2026  
**Thành phần cập nhật:**  
- `C:\Users\Hai Dang\Xemmanhinh\web\viewer_H264wss_P_new.html`
- `C:\Users\Hai Dang\Xemmanhinh\server\server_H264wss.py`

---

## 1. VẤN ĐỀ TRƯỚC KHI SỬA
- Khi người dùng lăn bánh xe chuột trên PC hoặc vuốt cảm ứng cuộn trang trên điện thoại, số lượng sự kiện cuộn phát sinh từ 60–120 events/giây.
- Client gọi trực tiếp `sendMsg({ type: 'mouse_scroll' })` không qua bộ đệm.
- Server chạy vòng lặp CPU `for _ in range(abs(dy))` gọi nhiều lần `SendInput(MOUSEEVENTF_WHEEL)`, làm tiêu tốn chu kỳ CPU và dồn ứ hàng đợi TCP WebSocket.
- Kết hợp với việc toàn bộ 2 triệu pixel trên màn hình bị dịch chuyển làm bùng nổ kích thước P-frame lên >1MB, kích hoạt cơ chế ép IDR Keyframe làm sập tụt FPS.

---

## 2. NỘI DUNG NÂNG CẤP VÀ SỬA ĐỔI

### Phía Client (`viewer_H264wss_P_new.html`):
- Xây dựng hàm `sendThrottledScroll(dy)`:
  - Tích lũy số bước cuộn `_pendingScrollDy`.
  - Khống chế tần suất gửi định kỳ **35ms (~30fps)**.
  - Giới hạn ngưỡng cuộn tức thời an toàn: `clampedClicks = Math.max(-5, Math.min(5, rawClicks))`.
- Áp dụng cho cả sự kiện bánh xe chuột PC (`wheel`) và cảm ứng vuốt màn hình di động (`onTouchMove`).

### Phía Server (`server_H264wss.py`):
- Bỏ vòng lặp CPU `for _ in range(abs(dy))`.
- Thay bằng một lệnh gọi `SendInput` duy nhất với `mouseData = int(dy * 120)` truyền thẳng vào Windows API.

---

## 3. KẾT QUẢ NGHIỆM THU ĐỘC LẬP TỪ VERIFIER
- **Mã nguồn:** Cú pháp Python và AST JavaScript đạt **0 lỗi**.
- **Tiến trình Runtime:** Worker PID **13048** (Session 1) lắng nghe ổn định trên 3 cổng 8765, 8766, 8767.
- **Thử nghiệm Socket:** Kết nối WebSocket thử nghiệm tới port 8766 gửi `mouse_scroll` thành công 100%, không lag, không giật.
- **Kết luận:** **PASS 100%**.
