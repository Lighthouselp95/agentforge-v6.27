# CHANGELOG: NÂNG CẤP DXGI FRAME PACING & HỆ THỐNG FALLBACK 3 TẦNG CHO XEMMANHINH

**Ngày cập nhật:** 05/09/2026  
**Dịch vụ:** `Xemmanhinh` (Cổng 8765, 8766, 8767)  
**Tiến trình mới:** PID 12524  
**Trạng thái:** **HOÀN TẤT & ĐÃ NẠP RUNTIME**

---

## 1. CÁC ĐIỂM TỐI ƯU CỐT LÕI

### A. Hạ tải GPU 3D Engine (DXGI Capture Frame Pacing)
* **Vấn đề trước đó:** Vòng lặp capture của `dxcam` gọi DirectX 11 liên tục kèm nhịp thăm dò dồn dập `sleep(0.001s)`, khiến nhân đồ họa Direct3D (GPU 3D Engine) của chip Intel UHD bị ép chạy ở mức 80% - 100%.
* **Giải pháp đã áp dụng:**
  - Cấu hình DXCam `target_fps = int(MAX_FPS * 1.5)` (45 FPS) để giới hạn số khung hình DirectX cần dựng.
  - Áp dụng **Dynamic Frame Pacing Sleep** trong capture loop:
    ```python
    elapsed_dxgi = time.monotonic() - t_dxgi_start
    target_interval = 1.0 / MAX_FPS
    sleep_time = max(0.005, target_interval - elapsed_dxgi)
    time.sleep(sleep_time)
    ```
  - Khi không có frame mới (`frame is None`), tăng thời gian nghỉ lên **10ms (`time.sleep(0.010)`)** thay vì spin-loop.
* **Kết quả:** Triệt tiêu hoàn toàn hiện tượng vắt kiệt GPU 3D, nhiệt độ và tải GPU hạ về mức an toàn.

---

### B. Chuỗi Fallback 3 Tầng Chuẩn Hóa Cho H.264 Encoder
Đã cấu trúc lại hàm `_pick_encoder()` theo thứ tự ưu tiên 3 tầng:
1. **Tầng 1 (Hardware NVIDIA): `h264_nvenc`**
   - Khai thác tối đa GPU rời NVIDIA khi máy có card GeForce/RTX/Quadro.
2. **Tầng 2 (Hardware Intel QuickSync): `h264_qsv`**
   - Khai thác nhân phần cứng QuickSync của Intel CPU khi môi trường cấp quyền context.
   - Cấu hình: `preset='veryfast'`, `tune='zerolatency'`, `profile='baseline'`.
3. **Tầng 3 (Software Fallback): `libx264`**
   - Bộ nén CPU siêu tốc khi không có GPU rời.
   - Cấu hình: `preset='ultrafast'`, `tune='zerolatency'`, `profile='baseline'`, `crf='26'`.

---

## 2. TRẠNG THÁI RUNTIME NGHIỆM THU
* **PID worker mới:** `12524` (Session 1, khởi tạo tự động bởi `service_launcher.py`).
* **Các cổng kết nối:**
  - `8765`: HTTPS Web Viewer
  - `8766`: WSS Video & Input
  - `8767`: WSS Audio Loopback
