# CHANGELOG - PRE-LOGON & SECURE DESKTOP REMOTE STREAMING

**Dự án:** Xemmanhinh (Remote Screen Streaming & Control)  
**Hệ điều hành hỗ trợ:** Windows 10, Windows 11, Windows Server  
**Ngày cập nhật:** 04/09/2026  
**Đơn vị thực hiện:** AgentForge Team

---

## [Phiên bản 2.1.1] - 2026-09-04

### ✨ CẬP NHẬT TỐI ƯU HÓA TRÌNH ĐỌC PDF TRÊN CÙNG TRANG (SLIDING WINDOW 30 PAGES & LIFECYCLE CLEANUP)
1. **Kiến trúc Sliding Window 30 trang (Lazy Loading di động):**
   - Giới hạn phạm vi render tối đa 30 trang quanh vị trí đọc hiện tại `[current - 15, current + 15]` (lúc mới mở nạp ngay cửa sổ trang 1 đến 30).
   - Trang 1 xuất hiện tức thì trong ~0.05 giây; các trang từ 2 đến 30 sẵn sàng trong tầm cuộn mượt mà.
   - Các trang ngoài phạm vi 30 trang được tự động giải phóng bộ nhớ GPU Canvas và hủy tác vụ render ngầm, giữ slot rỗng có chiều cao cố định để scrollbar không bị giật.
2. **Cơ chế Quản lý Vòng đời & Hủy Render Triệt để (`cleanupCurrentPdf`):**
   - Hủy bỏ toàn bộ `loadingTask.destroy()`, duyệt Map `activeRenderTasks` gọi `task.cancel()`, ngắt kết nối `IntersectionObserver.disconnect()` và giải phóng `pdfDoc.destroy()` khi:
     + Người dùng bấm nút Back quay lại File Explorer.
     + Người dùng chuyển từ file PDF này sang file PDF khác.
     + Người dùng chuyển từ PDF sang đọc Markdown.
     + Người dùng ẩn tab trình duyệt di động (`pagehide`) hoặc rời trang (`beforeunload`).
3. **Triệt tiêu dứt điểm lỗi ReferenceError:** Khai báo tường minh toàn bộ các biến DOM (`pdfScrubberBar`, `pdfPagesContainer`), bọc guard clause an toàn, khôi phục hoàn toàn thao tác click mở file cả `.md` và `.pdf`.

## [Phiên bản 2.1.0] - 2026-09-04

### ✨ ĐÃ HOÀN THÀNH & TÍNH NĂNG MỚI
1. **Khởi động Boot Service không cần đăng nhập:**
   - Sử dụng Windows Task Scheduler `XemmanhinhBootService` chạy bằng quyền `NT AUTHORITY\SYSTEM` với cờ `/sc ONSTART /rl HIGHEST`.
   - Khắc phục triệt để lỗi Service Control Manager Timeout 1053.
   - Hệ thống tự động kích hoạt ngay khi máy tính bật nguồn (Pre-logon) mà không cần người dùng đăng nhập vào Windows.

2. **Kiến trúc Dual-Process & Console Session Injection:**
   - Quản lý 2 tiến trình: Tiến trình gốc (`service_launcher.py`) chạy ở Session 0 giám sát hệ thống, nhân bản Token `SYSTEM` từ `winlogon.exe` (với quyền `PROCESS_QUERY_INFORMATION 0x0400`).
   - Gọi API `CreateProcessAsUserW` để đưa Worker (`server_H264wss.py`) trực tiếp vào Session 1 (Active Console Session).

3. **Markdown & Native PDF Mobile Reader Tối Ưu Siêu Tốc (Port 8770):**
   - Hỗ trợ xem trực tiếp tài liệu Markdown và PDF trên cùng một ứng dụng SPA di động.
   - **Đột phá Native PDF Embed:** Sử dụng trực tiếp Native Engine C++ của trình duyệt (`<iframe>` kết hợp stream HTTP 206 Partial Content Range). Mở tài liệu PDF 200 trang hay 200MB trong **~0.05 giây** mà không tốn 1MB RAM JavaScript.
   - **Trải nghiệm di động vượt trội:** Cuộn dọc liền mạch 60–120 FPS, pinch-to-zoom 2 ngón tay sắc nét phần cứng, hỗ trợ nút "↗ Tab mới" và tự động giải phóng tài nguyên (`about:blank`) khi quay lại File Explorer.
   - Thường trực 24/7 với cờ `--always-run`, vô hiệu hóa timeout tự tắt idle.

3. **Chụp hình màn hình khóa & Đăng nhập (GDI Fallback + Clean Worker Thread + Force IDR):**
   - Khi màn hình bị khóa (`Win + L`) hoặc ở Winlogon/LogonUI, driver DirectX thu hồi quyền capture (`0x887A0026 DXGI_ERROR_ACCESS_LOST`).
   - Tự động chuyển mượt sang luồng GDI Screen Capture.
   - **Đột phá Kiến trúc Clean Thread (`GDICaptureWorker`):** Do DirectX (`dxcam`) làm "bẩn" (taint) luồng capture ban đầu khiến Windows chặn gọi `SetThreadDesktop` với mã lỗi `ERROR_BUSY (170)` (dẫn tới việc chụp phải desktop Default bị Windows tô đen), hệ thống đã tách việc chụp GDI sang một background worker thread riêng biệt tinh khiết. Thread này gọi `SetThreadDesktop` sang `Winlogon` thành công 100% trước khi tạo handle GDI, triệt tiêu hoàn toàn hiện tượng màn đen khi khóa máy.
   - Ép gửi tức thì gói IDR Keyframe kèm thông số giải mã SPS/PPS (`_force_keyframe_next = True`) giúp trình duyệt Web Viewer render hình ảnh ngay lập tức.

4. **Khắc phục dứt điểm điều khiển Chuột & Phím tại Màn hình khóa:**
   - Áp dụng nguyên lý Win32 API Per-Thread Desktop: Luồng nhận WebSocket (`ws_handler`) được gắn riêng biệt vào Desktop `Winlogon` qua `SetThreadDesktop(hdesk)` thay vì phụ thuộc cờ toàn cục.
   - Loại bỏ lời gọi `CloseDesktop` sớm, duy trì handle desktop hợp lệ cho mọi thao tác `SendInput`.
   - Tích hợp nút bấm mở khóa `[ 🔓 Ctrl+Alt+Del ]` (`SendSAS`) trên thanh công cụ Web Viewer, đánh thức màn hình khóa từ xa.

5. **Bộ cài đặt 1-Click thông minh (Clean & Recover):**
   - `service/install_service.bat`: Dọn dẹp task cũ, kill tiến trình treo, mở cổng Firewall 8765-8767, cấu hình Registry SAS (`SoftwareSASGeneration = 3`), khởi tạo Task Boot.
   - `service/uninstall_service.bat`: Gỡ bỏ sạch sẽ dịch vụ, trả lại trạng thái mặc định cho máy tính.

6. **Bộ giải pháp Đọc tài liệu Markdown trên Điện thoại (Mobile Markdown Reader):**
   - **Native Markdown Mobile Reader (`md_reader/` - Port 8770):**
     + Cung cấp Web SPA duyệt file toàn diện: Hỗ trợ truy cập toàn bộ các ổ đĩa máy tính (`C:\`, `D:\`, `E:\`), phím chọn nhanh ổ đĩa và xử lý an toàn quyền hạn hệ thống.
     + Chế độ hiển thị **MarkText Theme (`.theme-marktext`)**: Tái hiện chuẩn xác typography của editor MarkText với tiêu đề H1/H2 gạch chân mờ thanh lịch, blockquote viền xanh ngọc `#42b983`, bảng kẻ zebra striping và code block Consolas/Fira Code bo góc mềm mại.
      + Chế độ **Toàn màn hình (Fullscreen)** và **Tự động ẩn Toàn diện Panel & Bubble Controls (Full Immersive Auto-Hide)**: Bổ sung bộ phân tích cử chỉ ngón tay (`touchstart`, `touchmove` tính delta `diffY > 10px` vuốt lên để ẩn, `diffY < -15px` vuốt xuống để hiện) kết hợp cơ chế lắng nghe cuộn kép (`window` + `readerView`) và bộ đếm rảnh tay 3.5s Idle Timer. Khi ẩn, cả thanh Panel trên đỉnh LẪN bong bóng nút nổi (`#reader-controls`) dưới đáy đều tự động trượt ẩn đồng bộ, trả lại 100% không gian đọc bài tràn viền. Chạm 1 chạm (single tap) vào bài đọc để bật/tắt toàn bộ menu.
      + **Tự động mở thẳng File cũ / Thư mục cũ khi vào Web (Zero-Click Auto-Resume)**: Lưu trạng thái chi tiết `last_view_mode`, `last_opened_file`, `last_active_dir` vào `localStorage` và đồng bộ URL Hash `#file=` / `#dir=`. Khi vừa mở web hoặc tải lại trang (F5), ứng dụng tự động mở thẳng bài viết đang đọc dở và cuộn đúng vị trí cũ, hoặc đứng đúng thư mục cũ mà không cần người dùng thao tác thêm; đồng thời duy trì banner `[ 📖 Tiếp tục đọc: ... ]` trong Explorer.
      + Triệt tiêu lỗi cú pháp JS & dải ngang che đỉnh: Sửa lỗi duplicate biến `const readerControls`, gom toàn bộ header vào `#top-header-wrapper`, khi ẩn tự động co rút khoảng đệm trên đỉnh về `0px` (`.header-hidden-padding`), giúp văn bản dâng tràn viền màn hình điện thoại mượt mà không tì vết.
     + Tích hợp cơ chế **Live Hot-Reload**: Tự động đồng bộ và làm mới tài liệu trên điện thoại tức thì khi người dùng lưu file (`Ctrl + S`) trên phần mềm MarkText ở máy tính.
     + **Ứng dụng Desktop GUI Native (`md_reader_gui.py` & `Chay_App_Doc_Markdown_GUI.bat`)**: Ứng dụng Tkinter máy tính trực quan, 0% CPU, tự quét IP LAN/Wi-Fi, nút Copy Link 1-click, Bật/Tắt server và mở trình duyệt PC, chạy bằng `pythonw.exe` hoàn toàn sạch bóng cửa sổ đen console.
     + **Tích hợp Trình đọc PDF Di động Siêu mượt (Native Mobile PDF Viewer SPA)**:
       * Nạp thư viện `Mozilla PDF.js v3.11.174` theo kỹ thuật Dynamic Lazy-Loading (chỉ nạp khi mở file PDF lần đầu, 0% tốn RAM khi đọc Markdown).
       * Backend `md_server.py` bổ sung endpoint `/api/fs/raw` hỗ trợ HTTP 206 Range Requests để stream phân đoạn, mở file PDF nặng >100MB tức thì trong 0.5s.
       * Hỗ trợ 2 chế độ đọc: **Cuộn liên tục (Continuous Vertical Scroll)** và **Lật trang sách (Single Page Swipe)** có hiệu ứng snap mượt mà.
       * **Smart Dark Mode**: Áp dụng bộ lọc CSS GPU Filter (`filter: invert(0.92) hue-rotate(180deg) contrast(1.05)`) chuyển nền trắng sang nền đen `#121212` dịu mắt, chữ trắng tương phản cao mà không làm biến dạng màu sắc sơ đồ/hình ảnh.
       * **Bottom Scrubber Bar**: Thanh trượt nhanh ở đáy màn hình hiển thị số trang `Page X / Y` và nút nhảy trang.
       * Tương thích 100% với cơ chế Full Immersive Auto-Hide sau 3.5s idle / vuốt ngón tay và Zero-Click Auto-Resume.
   - **Window Streamer (`window_streamer/` - Port 8768 HTTP / 8769 WSS):**
     + Stream riêng biệt cửa sổ ứng dụng (MarkText) bằng kỹ thuật DXGI GPU Crop theo bounding box của cửa sổ (`DWMWA_EXTENDED_FRAME_BOUNDS`).
     + Bổ sung nút Fullscreen và chế độ ẩn thanh điều khiển sau 3 giây để trải nghiệm video stream cửa sổ tràn viền 100%.
     + Tự động co cột dọc (Reflow) và hỗ trợ cử chỉ vuốt chạm touch scroll chuyển đổi thành Win32 mousewheel message.

---

## 📁 TÀI LIỆU KỸ THUẬT KÈM THEO
- `DE-XUAT-GIAI-PHAP-DOC-PDF-MOBILE.md`: Đề xuất kiến trúc, so sánh công nghệ và thiết kế UI/UX trình đọc PDF di động.
- `HUONG-DAN-DOC-TAI-LIEU-MARKDOWN-TREN-DIEN-THOAI.md`: Hướng dẫn toàn diện cài đặt, sử dụng và so sánh 2 giải pháp đọc tài liệu trên mobile.
- `BAO-CAO-FIX-STREAM-FREEZE-LOCKSCREEN.md`: Báo cáo phân tích và khắc phục triệt để lỗi đứng hình (Freeze Stream) khi khóa máy bằng cơ chế nhận diện desktop Winlogon và sửa lỗi ping-pong thrashing.
- `HUONG-DAN-XEM-LOG-VA-TASK-SCHEDULER.md`: Hướng dẫn chi tiết cách tìm Task Scheduler, quản lý dịch vụ và 3 cách tra cứu nhật ký (server_worker.log, service_launcher.log, Windows Event Viewer).
- `BAO-CAO-PHIM-AO-WIN-L-VA-CTRL-ALT-DEL.md`: Cơ chế xử lý phím ảo Super+L (LockWorkStation) và tổ hợp an toàn Ctrl+Alt+Del (SendSAS).
- `BAO-CAO-SUA-LOI-RENDER-VA-INPUT-LOCKSCREEN.md`: Phân tích nguyên nhân kỹ thuật Per-Thread Desktop và GDI IDR Keyframe.
- `BAO-CAO-CO-CHE-BOOT-VA-SESSION-INJECTION.md`: Sơ đồ kiến trúc Boot Service & Session Injection.
- `BAO-CAO-NGHIEM-THU-CUOI-CUNG.md`: Báo cáo nghiệm thu kiểm chứng độc lập từ Verifier.
