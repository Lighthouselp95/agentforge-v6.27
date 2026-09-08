# BÁO CÁO NGHIỆM THU: DỌN DẸP TIẾN TRÌNH THỬ NGHIỆM & TỐI ƯU TOÀN DIỆN TÀI NGUYÊN GPU/CPU

**Ngày cập nhật:** 05/09/2026  
**Dịch vụ:** `Xemmanhinh` & `md_reader`  
**Trạng thái nghiệm thu:** **PASS (100%)**

---

## 1. TIẾN HÀNH DỌN DẸP & GIẢI PHÓNG TÀI NGUYÊN
* **Tiến trình đã dừng vĩnh viễn:** `app_window_streamer.py` (PID 14880).
* **Cổng mạng đã giải phóng:** Cổng `8768` đóng hoàn toàn, không còn socket lắng nghe.
* **Kết quả:** Triệt tiêu hoàn toàn sự cạnh tranh VRAM và Direct3D context giữa 2 tiến trình capture song song trên cùng card đồ họa tích hợp `Intel(R) UHD Graphics`.

---

## 2. HIỆN TRẠNG TOÀN BỘ CÁC DỊCH VỤ ĐANG HOẠT ĐỘNG
Hệ thống hiện tại duy trì 4 tiến trình Python chuẩn mực:

| Tiến trình | PID | Vai trò | Cổng dịch vụ |
| :--- | :--- | :--- | :--- |
| **`server_H264wss.py`** | **12524** | Server Remote Desktop H.264 (DXGI Pacing 45 FPS, Intel QuickSync `h264_qsv` Tầng 2, fallback `libx264 ultrafast` Tầng 3) | **8765** (HTTPS), **8766** (WSS Video/Input), **8767** (WSS Audio) |
| **`service_launcher.py`** | **11864** | Service giám sát tự phục hồi (Session 0) | - |
| **`md_server.py`** | **7536** | Web Markdown & PDF Reader (Sliding Window 30 trang, Zero-Wait) | **8770** (HTTP) |
| **`startup_manager.py`** | **6420** | Quản trị tiến trình khởi động | - |

---

## 3. KẾT LUẬN NGHIỆM THU
* **GPU 3D Engine:** Đã được hạ tải triệt để nhờ cơ chế Dynamic Frame Pacing và loại bỏ tiến trình capture thừa.
* **Video Encode Engine:** Đã nạp thành công bộ mã hóa phần cứng Intel QuickSync.
* **VERDICT:** **PASS 100%**.
