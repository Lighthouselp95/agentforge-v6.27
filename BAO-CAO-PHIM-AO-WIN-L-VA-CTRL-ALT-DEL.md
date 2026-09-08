# BÁO CÁO CẬP NHẬT: TỐI ƯU HÓA CƠ CHẾ PHÍM TẮT KHÓA MÁY (WIN+L) VÀ MỞ MÀN HÌNH BẢO MẬT (CTRL+ALT+DEL / SAS)

**Dự án:** Xemmanhinh  
**Thời gian:** 04/09/2026  
**Thực hiện:** Orchestrator, res-codebase, coder-fix-lock, verif-sched

---

## 1. NGUYÊN NHÂN KỸ THUẬT GỐC RỄ
1. **Phím ảo `Super + L` (Win + L):**
   - Windows Kernel chặn tuyệt đối việc sử dụng `SendInput` để giả lập tổ hợp `Win + L` vì lý do bảo mật chống mã độc chiếm quyền hoặc tự ý khóa máy.
   - Khi người dùng sử dụng Bàn phím ảo (`On-Screen Keyboard`), phím `Super` được giữ trong `armedMods`, nhưng khi bấm tiếp phím `L`, giao diện Web Viewer gửi riêng rẽ gói tin `{ type: 'key_press', key: 'l' }` sang server. Phía server nhận phím `l` rời rạc nên gọi `SendInput` gõ chữ "l", không thể khóa máy.
2. **Tổ hợp phím ảo `Ctrl + Alt + Del`:**
   - Tương tự như `Win + L`, `SendInput(Ctrl+Alt+Del)` bị nhân hệ điều hành Windows hủy bỏ (drop) ngay lập tức.
   - Bàn phím ảo trên web có 3 nút riêng lẻ `Ctrl`, `Alt`, `Del`. Người dùng bấm tuần tự 3 nút này sẽ sinh ra 3 sự kiện phím thông thường thay vì gửi lệnh điều khiển bảo mật `SendSAS`.
   - Đối với hàm Windows API `sas.dll!SendSAS(BOOL AsUser)`: Chữ ký chuẩn của Microsoft là hàm trả về kiểu `VOID`. Trong Python ctypes nếu không khai báo `restype = None` sẽ đọc giá trị rác trong thanh ghi CPU khiến logic kiểm tra kết quả bị sai lệch.

---

## 2. GIẢI PHÁP ĐÃ TRIỂN KHAI VÀ NGHIỆM THU

### 2.1. Phía Frontend (`web/viewer_H264wss_P_new.html`):
- **Bổ sung nhận diện tổ hợp thông minh trong `sendKey()`:**
  - Nếu `armedMods` đang giữ phím `Super`/`Meta`/`Win` và người dùng bấm tiếp phím `L` $\rightarrow$ Tự động hủy gửi phím thường, gửi ngay thông điệp đặc biệt `{ type: 'lock_workstation' }` và reset trạng thái phím.
  - Nếu `armedMods` đang giữ cả 2 phím `Ctrl` và `Alt` và người dùng bấm tiếp phím `Delete`/`Del` $\rightarrow$ Tự động chuyển thành thông điệp `{ type: 'send_sas' }` và reset trạng thái phím.
- **Bắt phím tắt bàn phím vật lý:**
  - Bổ sung listener lắng nghe `keydown`: Nếu người dùng bấm `Ctrl + Alt + Delete` hoặc `Win + L` từ bàn phím máy tính đang điều khiển, lập tức gửi lệnh tương ứng sang server.
- **Nút bấm trực quan trên Toolbar:**
  - Nút **`[ 🔓 Ctrl+Alt+Del ]`** (`#btn-sas`) gửi trực tiếp `{ type: 'send_sas' }`.
  - Bổ sung nút bấm một chạm **`[ 🔒 Khóa máy (Win+L) ]`** gửi `{ type: 'lock_workstation' }`.

### 2.2. Phía Backend (`server/server_H264wss.py`):
- **Khóa máy chuẩn Win32 API (`lock_workstation`):**
  - Gọi trực tiếp hàm Windows API `ctypes.windll.user32.LockWorkStation()` khi nhận message `lock_workstation` hoặc chuỗi phím `win+l` / `super+l`.
- **Chuẩn hóa chữ ký `SendSAS` trong `trigger_sas()`:**
  ```python
  sas = ctypes.WinDLL("sas.dll")
  sas.SendSAS.argtypes = [ctypes.c_bool]
  sas.SendSAS.restype = None
  sas.SendSAS(False) # FALSE cho tiến trình chạy quyền SYSTEM
  ```

---

## 3. KẾT QUẢ KIỂM CHỨNG THỰC TẾ (VERIFIER PASS 100%)
- **Báo cáo nghiệm thu độc lập:** Verifier (`verif-sched`) đã kiểm tra toàn diện và xác nhận đạt chuẩn PASS (4/4 tiêu chí).
- **Tiến trình Runtime:** Worker PID `15436` (Session 1, SYSTEM), 3 cổng TCP `8765`, `8766`, `8767` đều `LISTEN`.
- **Thực nghiệm Bàn phím ảo (On-Screen Keyboard):**
  - Giữ phím ảo `Super` + bấm `L` $\rightarrow$ Server bắt combo, ghi log:
    ```text
    [WS INPUT] key_down: x=None y=None key=super
    [LOCK] LockWorkStation result: 1
    ```
    Màn hình khóa kích hoạt thành công tức thì.
- **Thực nghiệm gửi `send_sas`:**
  - Nhấn nút toolbar `[ 🔓 Ctrl+Alt+Del ]` hoặc giữ phím ảo `Ctrl` + `Alt` + bấm `Del` $\rightarrow$ Server ghi nhận:
    ```text
    [WS] Nhận lệnh send_sas từ client -> gọi trigger_sas()
    [SAS] SendSAS(False) executed successfully
    ```
    Màn hình đăng nhập chuyển sang trạng thái mở khóa thành công.
- **Nút bấm trực quan:** Nút `[ 🔒 Khóa máy (Win+L) ]` (`#btn-lock`) đã hiển thị sẵn sàng trên thanh công cụ Web Viewer.
