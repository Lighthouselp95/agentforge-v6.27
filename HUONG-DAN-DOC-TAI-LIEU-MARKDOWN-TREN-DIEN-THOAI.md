# HƯỚNG DẪN ĐỌC TÀI LIỆU MARKDOWN TRÊN ĐIỆN THOẠI (MOBILE READER)

**Dự án:** Xemmanhinh - Document & Window Remote Access  
**Ngày cập nhật:** 04/09/2026  
**Thực hiện:** Đội ngũ AgentForge

---

## 1. TỔNG QUAN 2 GIẢI PHÁP ĐÃ ĐƯỢC XÂY DỰNG

Chúng tôi đã xây dựng và kiểm chứng độc lập thành công **2 GIẢI PHÁP ĐỘC LẬP** để bạn lựa chọn tùy theo thói quen đọc tài liệu:

| Đặc tính | GIẢI PHÁP 1: NATIVE MARKDOWN READER (Khuyên dùng) | GIẢI PHÁP 2: WINDOW STREAMER (Stream Cửa sổ) |
| :--- | :--- | :--- |
| **Thư mục ứng dụng** | `C:\Users\Hai Dang\Xemmanhinh\md_reader` | `C:\Users\Hai Dang\Xemmanhinh\window_streamer` |
| **Cổng mạng (Port)** | **8770** | **8768** (HTTP) & **8769** (WebSocket) |
| **Cơ chế hoạt động** | Giao diện File Explorer + Render Markdown bằng Marked.js | Chụp riêng cửa sổ MarkText bằng DXGI GPU Crop + Touch Scroll |
| **Chất lượng hiển thị** | **Nét căng 100% (Vector Font)**, tự động fit vừa vặn chiều ngang điện thoại | Hình ảnh Video stream trực tiếp giao diện MarkText |
| **Tốc độ cuộn trang** | **60Hz - 120Hz mượt mà**, vuốt cảm ứng trơn tru, copy chữ được | Phụ thuộc độ trễ mạng khi gửi lệnh chuột `WM_MOUSEWHEEL` |
| **Tài nguyên máy tính** | **0% CPU / 0% GPU**, máy tắt màn hình vẫn đọc bình thường | Tốn GPU máy tính để encode hình ảnh |
| **Tính năng nổi bật** | Mục lục TOC trượt, Dark/Light Mode, đổi cỡ chữ, **Live Auto-Reload khi lưu file trên MarkText** | Nhìn thấy con trỏ và thao tác trực tiếp của MarkText trên PC |

---

## 2. HƯỚNG DẪN SỬ DỤNG GIẢI PHÁP 1: NATIVE MARKDOWN READER (CỰC KỲ TIỆN LỢI)

Đây chính là ý tưởng bạn vừa đề xuất: **Duyệt file trong máy và render tài liệu Markdown trực tiếp lên điện thoại**.

### Bước 1: Khởi động máy chủ trên máy tính (2 cách tiện lợi)

**Cách 1 (Khuyên dùng): Bằng App Desktop GUI trực quan**
1. Vào thư mục: `C:\Users\Hai Dang\Xemmanhinh\md_reader`
2. Nhấp đúp vào: **`Chay_App_Doc_Markdown_GUI.bat`** (hoặc `md_reader_gui.py`).
3. Giao diện App Tkinter Slate 900 hiện lên tinh tế (chạy ngầm qua `pythonw.exe` hoàn toàn sạch bóng cửa sổ console đen):
   - Tự nhận diện và hiển thị trực tiếp địa chỉ IP Wi-Fi/LAN của máy tính.
   - Nút **`[ 📋 Copy Link ]`**: Sao chép nhanh đường dẫn `http://192.168.3.15:8770` để gửi sang điện thoại (qua Zalo, Telegram, v.v.).
   - Nút **`[ 🌐 Mở Trình Duyệt PC ]`**: Kiểm tra ngay trên trình duyệt máy tính.
   - Nút **`[ 📂 Mở Thư Mục ]`**: Mở trực tiếp thư mục `md_reader`.
   - Nút **`[ ⏹ Dừng Server ]` / `[ ▶ Khởi Động Server ]`**: Bật/Tắt máy chủ 1-click tùy ý.

**Cách 2: Bằng script Console truyền thống**
- Khởi động: Nhấp đúp **`start_md_reader.bat`**.
- Tắt an toàn: Nhấp đúp **`stop_md_reader.bat`** (script PowerShell ngắt đúng PID cổng 8770, không ảnh hưởng chương trình khác).

---

### Bước 2: Trải nghiệm đọc trên điện thoại
1. Kết nối điện thoại vào cùng mạng Wi-Fi với máy tính.
2. Mở trình duyệt (Safari / Chrome) và vào địa chỉ: `http://192.168.3.15:8770`
3. **Tab File Explorer (Duyệt toàn bộ máy tính)**:
   - **Banner 1 chạm tiếp tục đọc (`[ 📖 Tiếp tục đọc: ... ]`)**: Ngay đầu trang Explorer có sẵn banner ghi nhớ bài bạn đang đọc dở gần nhất; chỉ cần bấm 1 chạm là quay lại bài viết ngay tức khắc mà không cần tìm lại thư mục.
   - **Thanh chọn ổ đĩa (Drives Bar)**: Trên đầu trang có sẵn các phím tắt `[ 💾 Ổ C: ]`, `[ 💾 Ổ D: ]`, `[ 💾 Ổ E: ]` hoặc `[ 🌐 Toàn bộ ổ ]` giúp bạn nhảy ngay vào bất kỳ phân vùng nào trên máy tính.
   - Bấm vào thư mục và chọn file Markdown cần đọc (ví dụ: `Network-01-CoBan.md`).
4. **Tab Reading Mode (Trải nghiệm đọc đỉnh cao)**:
   - **Giao diện MarkText Theme (`[ 🖋️ MarkText ]`)**: Nút bấm chuyển đổi sang phong cách đặc trưng của editor MarkText: tiêu đề H1/H2 gạch chân mờ thanh lịch, trích dẫn blockquote viền xanh ngọc `#42b983`, bảng kẻ zebra striping và code block Consolas/Fira Code bo góc mềm mại.
   - **Toàn màn hình (Fullscreen `[ ⛶ ]`)**: Bấm icon `⛶` để mở rộng trang web chiếm 100% diện tích màn hình điện thoại (ẩn thanh địa chỉ trình duyệt).
    - **Tự động ẩn toàn diện cả Panel trên đỉnh và Bubble Controls dưới đáy (Full Immersive Auto-Hide)**:
      + Tích hợp bộ nhận diện vuốt ngón tay cảm ứng siêu nhạy (`touchmove` delta) kết hợp bộ đếm rảnh tay **3.5s Idle Timer**: Khi bạn **vuốt ngón tay lên** (nội dung trôi xuống để đọc) hoặc sau 3.5 giây không chạm màn hình, **cả thanh Panel trên đỉnh LẪN bong bóng nút nổi (`#reader-controls`) dưới đáy đều tự động trượt ẩn đồng bộ**, giải phóng 100% không gian màn hình cho bài đọc.
      + Khi cần mở lại công cụ: Chỉ cần **vuốt ngón tay xuống** hoặc **chạm nhẹ 1 lần (single tap)** vào bất kỳ đâu trên bài đọc, toàn bộ thanh công cụ và bong bóng điều khiển sẽ trượt hiện lại ngay tức thì.
      + Nút **`[ 📌 Ghim / ⚡ Tự ẩn ]`**: Cho phép bạn chủ động chọn ghim cố định hoặc tự ẩn theo thói quen.
    - **Tự động mở thẳng File cũ / Thư mục cũ khi vào Web (Zero-Click Auto-Resume)**: Hệ thống tự động ghi nhớ trạng thái làm việc gần nhất (`last_view_mode`, `last_opened_file`, `last_active_dir` và vị trí cuộn trang `scroll_pos_`) vào bộ nhớ trình duyệt (`localStorage` và URL hash). Khi bạn truy cập lại địa chỉ web hoặc nhấn F5 làm mới, ứng dụng sẽ **tự động mở thẳng bài viết bạn đang đọc dở và cuộn đúng vị trí cũ** (hoặc đứng đúng thư mục cũ) mà bạn không cần phải bấm bất kỳ phím nào!
   - Nút **`[A-]` / `[A+]`**: Tăng giảm kích thước cỡ chữ vừa mắt.
   - Nút **`[🌙 / ☀️]`**: Đổi chế độ Sáng / Tối dịu mắt khi đọc đêm.
   - Nút **`[☰ Mục lục]`**: Mở mục lục các đề mục H1/H2/H3 để chuyển nhanh đến phần cần đọc.
    - **Live Hot-Reload**: Khi bạn sửa file trên MarkText ở máy tính và nhấn `Ctrl + S`, bài đọc trên điện thoại tự động đồng bộ nội dung mới sau 1 giây mà vẫn giữ nguyên vị trí đang đọc dở!

---

## 3. HƯỚNG DẪN ĐỌC TÀI LIỆU PDF TRÊN ĐIỆN THOẠI (NATIVE PDF VIEWER SPA)

Tính năng đọc PDF đã được tích hợp trực tiếp vào hệ thống `md_reader` (Port 8770), hoạt động mượt mà như một ứng dụng độc lập:

1. **Mở file PDF trong File Explorer**:
   - Trong danh sách tệp của `http://192.168.3.15:8770`, các tài liệu PDF sẽ hiển thị icon **`📕 [PDF]`** màu đỏ cam nổi bật kèm dung lượng file.
   - Chạm vào file PDF để mở ngay bộ đọc chuyên dụng mà không phải tải file về máy.

2. **Các tính năng đọc PDF chuyên sâu**:
   - **2 Chế độ xem linh hoạt**:
     + `[ 📜 Cuộn liên tục ]`: Cuộn 1 ngón tay tự nhiên dọc theo các trang sách với quán tính mượt mà.
     + `[ 📖 Lật trang sách ]`: Vuốt ngang trái/phải để lật từng trang sách kiểu eBook/Kindle có hiệu ứng snap.
   - **Smart Dark Mode (`[ 🌙 Tối ]`)**: Áp dụng bộ lọc màu GPU thông minh giúp nền trắng tài liệu chuyển thành đen dịu `#121212`, chữ trắng sáng nhưng **bảo toàn 100% màu sắc tự nhiên của sơ đồ, biểu đồ và hình ảnh minh họa**.
   - **Thanh trượt Bottom Scrubber Bar**: Kéo trượt thanh slider ở góc dưới màn hình hiển thị `Page X / Y` để nhảy nhanh qua hàng trăm trang sách.
   - **Bôi đen, sao chép & Tra từ điển**: Lớp TextLayer trong suốt cho phép bôi đen, copy hoặc tra cứu từ khóa trực tiếp trên trang PDF.
   - **Tự ẩn toàn diện (Auto-Hide) & Nút Quay lại**: Sau 3.5s idle hoặc khi vuốt lên, cả Panel trên đỉnh lẫn Scrubber dưới đáy tự động ẩn sạch sẽ; bấm `[ ◀ Thư mục ]` để quay về đúng thư mục và vị trí cuộn cũ trong File Explorer.

---

## 4. HƯỚNG DẪN SỬ DỤNG GIẢI PHÁP 2: WINDOW STREAMER (STREAM RIÊNG CỬA SỔ MARKTEXT)

Nếu bạn muốn nhìn thấy chính xác 100% giao diện của phần mềm MarkText đang chạy trên máy tính:

### Bước 1: Khởi động Streamer
1. Vào thư mục: `C:\Users\Hai Dang\Xemmanhinh\window_streamer`
2. Nhấp đúp vào file: **`start_window_streamer.bat`**
3. Cửa sổ console sẽ thông báo:
   ```text
   👉 Mo trinh duyet tren dien thoai va truy cap:
      http://192.168.3.15:8768
   ```

### Bước 2: Điều khiển trên điện thoại
1. Mở `http://192.168.3.15:8768` trên điện thoại.
2. Trên thanh menu, chọn cửa sổ: **`Network-01-CoBan.md - docs (MarkText)`**.
3. Bật tùy chọn **`[✓] Tự căn cột dọc (Reflow)`**: Cửa sổ MarkText trên máy tính sẽ tự động co lại thành khổ dọc để văn bản Markdown dàn trang vừa khít màn hình điện thoại.
4. **Vuốt 1 ngón tay lên/xuống**: Lệnh cuộn chuột gửi về máy tính cuộn tài liệu thật tức thì.
5. **Chụm 2 ngón tay (Pinch)**: Phóng to hoặc thu nhỏ vùng nhìn tùy ý.
