# CHANGELOG: CẬP NHẬT THỨ TỰ ENCODER INTEL CARD VÀ HIỂN THỊ METADATA TRÊN UI

**Ngày thực hiện:** 06/09/2026  
**Thành phần cập nhật:**  
- `C:\Users\Hai Dang\Xemmanhinh\server\server_H264wss.py`
- `C:\Users\Hai Dang\Xemmanhinh\web\viewer_H264wss_P_new.html`

---

## 1. THIẾT LẬP THỨ TỰ ENCODER 3 TẦNG (ƯU TIÊN INTEL CARD VỊ TRÍ SỐ 2)
Theo yêu cầu người dùng, hàm `_pick_encoder()` đã được cấu hình với chuỗi Fallback chuẩn:
1. **Tầng 1 (NVIDIA GPU):** `h264_nvenc` (dành cho máy có card đồ họa rời NVIDIA).
2. **Tầng 2 (Intel GPU):** `h264_qsv` (Intel QuickSync Hardware Acceleration) với tham số tối ưu hóa độ trễ:
   - `preset = 'veryfast'`
   - `tune = 'zerolatency'`
   - `profile = 'baseline'`
   - `async_depth = '1'` (giảm thiểu độ trễ đệm khung hình)
3. **Tầng 3 (CPU Software):** `libx264` (dự phòng CPU với `preset='ultrafast'`, `tune='zerolatency'`, `crf='26'`, `threads='4'`).

---

## 2. CƠ CHẾ TRUYỀN & HIỂN THỊ NHÃN ENCODER TRÊN UI / SETTINGS
- **Phía Server (`server_H264wss.py`):**
  - Tự động lưu `_active_encoder_name` (ví dụ: `Intel QuickSync (h264_qsv)`) và chuỗi `_encoder_priority_str` (`NVENC > QSV > libx264`).
  - Khi client kết nối WebSocket cổng 8766, server gửi kèm thông điệp metadata:
    ```json
    {
      "type": "init",
      "codec": "h264",
      "encoder": "Intel QuickSync (h264_qsv)",
      "encoder_priority": "NVENC > QSV > libx264"
    }
    ```
    và gói tin chuyên biệt `{"type": "encoder_info", "encoder": "...", "priority": "..."}`.
- **Phía Client Viewer (`viewer_H264wss_P_new.html`):**
  - **Thanh trạng thái / Codec Badge:** Cập nhật nhãn động: `H.264 WebCodecs + PCM | Enc: Intel QuickSync (h264_qsv)`.
  - **Bảng Settings (Hardware Encoder Status):** Hiển thị rõ ràng:
    - `Active Encoder: Intel QuickSync (h264_qsv)`
    - `Fallback Priority: NVENC > QSV > libx264`

---

## 3. KẾT QUẢ NGHIỆM THU ĐỘC LẬP TỪ VERIFIER
- **Tiến trình:** Worker PID **9968** (Session 1) hoạt động ổn định trên cả 3 cổng: 8765 (HTTPS), 8766 (WSS Video), 8767 (WSS Audio).
- **Log máy chủ (`server_worker.log`):**
  - `[ENCODER] [Tầng 2] Chọn Intel QuickSync (h264_qsv) thành công!`
  - `[ENCODER] Intel QSV h264: 1920x1080 @ 3Mbps | preset=veryfast tune=zerolatency async_depth=1 bf=0`
- **Thực nghiệm kết nối mạng:** Gửi gói tin WSS và nhận về đầy đủ JSON `encoder_info` và `encoder_priority`.
- **Đánh giá:** **PASS 100%**.
