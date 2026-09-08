# KẾ HOẠCH ĐÓNG GÓI ĐƠN TỆP: GÓI TOÀN BỘ HỆ THỐNG THÀNH 1 FILE EXE DUY NHẤT (ALL-IN-ONE EXE)

> **Dự án:** Xemmanhinh - Remote Desktop & Screen Viewer  
> **Mục tiêu:** Thay vì tách rời nhiều file (`server_manager.exe`, `server_H264wss.exe`, file web HTML/JS, chứng chỉ SSL, batch script), toàn bộ hệ thống được đóng gói thành **1 FILE EXE DUY NHẤT** (`Xemmanhinh_AllInOne.exe` hoặc `Xemmanhinh.exe`).

---

## 1. THÁCH THỨC KỸ THUẬT HIỆN TẠI & NGUYÊN NHÂN TÁCH FILE TRƯỚC ĐÂY
1. **Kiến trúc Multi-Process / Windows Service:**
   - Trước đây cần `server_manager.exe` để quản lý và spawn `server_H264wss.exe` qua lệnh riêng biệt.
   - Khi ở Session 0 (Windows Service), tiến trình mẹ phải gọi `CreateProcessAsUserW` trỏ vào một file thực thi trên đĩa cứng để chạy bên trong Console Session (Session 1).
2. **Tài nguyên tĩnh (Web Assets, Certs):**
   - File `viewer_H264wss_P_new.html`, thư viện `broadway/`, chứng chỉ SSL `cert.pem`, `key.pem`.
3. **Thư viện C-Extensions & Drivers:**
   - `dxcam`, `av` (PyAV FFmpeg DLLs), `cv2`, `numpy`, `soundcard` (WASAPI COM).

---

## 2. GIẢI PHÁP KIẾN TRÚC: "SELF-EXEC MULTI-MODE" (CHẾ ĐỘ TỰ THỰC THI ĐA NĂNG)

Thay vì cần nhiều file EXE khác nhau, **1 file EXE duy nhất** sẽ tự nhận diện vai trò dựa trên đối số dòng lệnh (CLI Arguments) hoặc ngữ cảnh phiên làm việc:

```
                  ┌─────────────────────────────────────────────────┐
                  │          Xemmanhinh.exe (1 File duy nhất)        │
                  └───────────────────────┬─────────────────────────┘
                                          │
       ┌──────────────────────────────────┼──────────────────────────────────┐
       │ (Không truyền tham số / GUI)    │ (--service)                      │ (--worker / --capture)
       ▼                                  ▼                                  ▼
[Chế độ Desktop Standalone]       [Chế độ Windows Service]          [Chế độ Screen Worker]
- Chạy trực tiếp người dùng       - Chạy ngầm Session 0 (SYSTEM)     - Chạy trong Console Session
- Tự mở Firewall nếu Admin         - Lắng nghe WTS Session Console    - Chụp DXGI / GDI Fallback
- Tích hợp Web Server + Capture   - Tự gọi chính nó:                 - H264 Encode + WebSocket
  trong cùng tiến trình/luồng      CreateProcessAsUser(              - Xử lý chuột/phím & SAS
                                     "Xemmanhinh.exe --worker")
```

---

## 3. KẾ HOẠCH TRIỂN KHAI CHI TIẾT (4 BƯỚC)

### BƯỚC 1: HỢP NHẤT MÃ NGUỒN VÀO MỘT ENTRYPOINT DUY NHẤT (`main.py` / `app_entry.py`)
- **Tích hợp router CLI argument:**
  ```python
  if __name__ == "__main__":
      parser = argparse.ArgumentParser()
      parser.add_argument("--mode", choices=["standalone", "service", "worker", "install", "uninstall"], default="standalone")
      args = parser.parse_args()

      if args.mode == "install":
          # Tự cấu hình Firewall, Registry SoftwareSASGeneration, tạo Windows Service trỏ vào chính sys.executable --service
          install_system_service()
      elif args.mode == "uninstall":
          uninstall_system_service()
      elif args.mode == "service":
          # Chạy Root Service Session 0: theo dõi Console Session, gọi CreateProcessAsUser(sys.executable, "--mode worker")
          run_service_dispatcher()
      elif args.mode == "worker":
          # Chạy lõi streaming (DXGI/GDI + SendInput + WebSockets)
          run_streaming_worker()
      else:
          # Chế độ Standalone mặc định: Tự mở Firewall và khởi chạy cả Web Server lẫn Streaming
          run_standalone_server()
  ```
- **Tự giải nén hoặc nạp Web Assets từ bộ nhớ:**
  - Nhúng trực tiếp nội dung `viewer_H264wss_P_new.html`, `Broadway.js`, chứng chỉ SSL vào `sys._MEIPASS` (tính năng Onefile của PyInstaller) hoặc nhúng chuỗi string / byte trực tiếp trong mã nguồn Python.
  - Tự động sinh chứng chỉ tự ký (Self-signed SSL Cert) trong RAM bằng `cryptography` nếu file cert chưa tồn tại, không phụ thuộc vào file `.pem` ngoài.

### BƯỚC 2: CƠ CHẾ NẠP TIẾN TRÌNH CON TỪ CHÍNH FILE EXE (SELF-SPAWN)
- Khi `service_launcher` cần nạp worker vào Session Console bằng `CreateProcessAsUserW`:
  - Tham số `lpApplicationName`: Lấy trực tiếp từ `sys.executable` (đường dẫn tuyệt đối của chính file `Xemmanhinh.exe` đang chạy).
  - Tham số `lpCommandLine`: `f'"{sys.executable}" --mode worker'`
  - **Lợi ích:** Không cần sinh ra thêm bất kỳ file EXE phụ nào (`server_H264wss_testP_new.exe` được xóa bỏ hoàn toàn).

### BƯỚC 3: TÍCH HỢP GIAO DIỆN TRAY HOẶC TỰ ĐỘNG CÀI ĐẶT 1-CLICK TRONG EXE
- Bổ sung lệnh CLI hoặc GUI nhỏ:
  - Chạy `Xemmanhinh.exe` bình thường: Mở server stream ngay lập tức.
  - Chạy `Xemmanhinh.exe --install`: Tự động cài thành Windows Service chạy ngầm cùng máy tính (không cần file `.bat`).
  - Chạy `Xemmanhinh.exe --uninstall`: Tự động gỡ sạch service và firewall rule.

### BƯỚC 4: CẤU HÌNH PYINSTALLER SPEC FILE TỐI ƯU ONEFILE
- Tạo file cấu hình `xemmanhinh_onefile.spec`:
  - Cấu hình `onefile=True` (nén tất cả DLL, Python runtime, PyAV, OpenCV, dxcam vào 1 file `.exe` duy nhất).
  - Tự động nhúng icon, metadata bản quyền, và nhúng `uac_admin=False` (tự elevate khi cần cài service).
  - Loại bỏ các module thừa (tests, docutils, tkinter...) để giảm dung lượng file EXE xuống mức tối ưu (~25-35 MB).

---

## 4. KẾT QUẢ ĐẦU RA KỲ VỌNG

| Tiêu chí | Trước đây (Nhiều file) | Sau khi đóng gói 1 File EXE |
| :--- | :--- | :--- |
| **Số lượng file** | 8-10 files (`.exe`, `.bat`, `.pem`, `.html`, `.py`) | **Duy nhất 1 file:** `Xemmanhinh.exe` |
| **Tính tiện dụng** | Phải copy cả thư mục release, chạy batch script | **Chỉ cần gửi 1 file EXE duy nhất**, double click là chạy |
| **Stream Pre-logon** | Cần `install_service.bat` + `service_launcher.py` | Gõ `Xemmanhinh.exe --install` là xong |
| **Thẩm mỹ & Phân phối** | Dễ thất lạc file `.html` hoặc `.exe` con | Chuyên nghiệp như TeamViewer/AnyDesk |

---

## 5. CÁC BƯỚC TRIỂN KHAI TIẾP THEO
1. Coder tạo file hợp nhất `server/app_all_in_one.py` tích hợp cả Manager, Service và Worker dựa trên cờ `--mode`.
2. Tích hợp nạp tài nguyên Web trực tiếp qua `sys._MEIPASS` và cơ chế self-spawn `sys.executable`.
3. Viết file `xemmanhinh_onefile.spec` và thực thi PyInstaller đóng gói thành `dist/Xemmanhinh.exe`.
4. Verifier kiểm chứng độc lập: test chạy trực tiếp, test chạy `--install`, test stream màn hình và điều khiển chuột/phím.
