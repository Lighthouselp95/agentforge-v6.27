# ĐỀ XUẤT GIẢI PHÁP KỸ THUẬT & THIẾT KẾ GIAO DIỆN (UI/UX) ĐỌC PDF TRÊN DI ĐỘNG

**Dự án:** Xemmanhinh / md_reader  
**Ngày lập:** 04/09/2026  
**Đơn vị thực hiện:** AgentForge Team (Orchestrator, Researcher, Searcher, Idea)  
**Trạng thái:** Hoàn tất nghiên cứu & Đề xuất (Chờ phê duyệt triển khai)  

---

## I. TỔNG QUAN YÊU CẦU & BỐI CẢNH
Người dùng yêu cầu nghiên cứu đề xuất giải pháp kỹ thuật và thiết kế giao diện (UI/UX) để tích hợp tính năng đọc tài liệu PDF trên điện thoại di động vào hệ thống đọc tài liệu hiện có (`md_reader`, cổng 8770).

**Ràng buộc vận hành:**
- Tận dụng hạ tầng máy chủ HTTP nhẹ cổng 8770 (`md_server.py`).
- Đồng bộ hoàn hảo với phong cách thiết kế Dark Slate Theme (`#0d1117` / `#161b22`), các cử chỉ vuốt chạm và cơ chế Full Immersive Auto-Hide (ẩn thanh panel và bubble sau 3.5s) của `mobile_md_reader.html`.
- Không gây tràn RAM trên thiết bị di động khi mở các cuốn sách PDF dung lượng lớn (>100MB, hàng trăm trang).
- Đảm bảo đầy đủ tính năng tra cứu: bôi đen, copy chữ, tìm kiếm toàn văn, xem mục lục và phóng to sắc nét trên màn hình Retina/OLED.

---

## II. ĐÁNH GIÁ KỸ THUẬT & LỰA CHỌN CÔNG NGHỆ

### 1. So sánh các phương án Web PDF Viewer trên Mobile

| Tiêu chí | Native `<iframe>` / `<embed>` | Server-side Image Conversion | Thư viện `PDF-LIB` | Mozilla `PDF.js` (Khuyến nghị) |
|---|---|---|---|---|
| **Cơ chế** | Thẻ HTML nhúng trực tiếp | Server Python convert trang ra ảnh | Thao tác file nhị phân | Render Canvas 2D + TextLayer DOM |
| **Hỗ trợ Mobile Safari** | Kém (khóa kích thước, giật) | Tốt | Không hỗ trợ | Rất tốt (mượt mà, chuẩn WebKit) |
| **Hỗ trợ Mobile Chrome** | **Rất kém (Tự động tải file về)** | Tốt | Không hỗ trợ | Rất tốt (chuẩn Blink engine) |
| **Bôi đen & Copy chữ** | Phụ thuộc viewer trình duyệt | ❌ **Không thể** | ❌ Không có render |  **Đầy đủ qua lớp TextLayer** |
| **Tìm kiếm từ khóa** | Hạn chế | ❌ Không thể | ❌ Không có render |  **Rất mạnh (PDFFindController)** |
| **Tải tài nguyên** | Nặng theo cả file | Tốn băng thông gửi nhiều ảnh | N/A | **Nhẹ (PDF.js ~280KB, Worker ~1.8MB)** |
| **Đánh giá** | ❌ **Loại bỏ** | ❌ **Loại bỏ** | ❌ **Loại bỏ** |  **CHỌN TRIỂN KHAI** |

### 2. Kiến trúc Tối ưu Hiệu năng & Bộ nhớ (Zero-Lag & Low-RAM)
1. **Streaming HTTP Range Requests 206 (Mở PDF lớn tức thì):**
   - Server `md_server.py` bổ sung endpoint `/api/fs/raw?path=...` hỗ trợ header `Accept-Ranges: bytes` và trả về mã `206 Partial Content`.
   - Client nạp từng phân đoạn byte theo nhu cầu. File sách 100MB hiển thị ngay trang 1 trong 0.5 giây mà không cần đợi tải toàn bộ file.
2. **Ảo hóa Trang & Hủy ngoài Viewport (Virtualized Lazy Rendering):**
   - Sử dụng `IntersectionObserver`: Mỗi trang PDF bọc trong 1 slot container tính trước tỷ lệ trang.
   - Chỉ render Canvas 2D khi trang cách màn hình $< 300\text{px}$.
   - Khi cuộn ra xa quá 2 trang, Canvas được dọn sạch (`context.clearRect()`, giải phóng VRAM). Bộ nhớ RAM trên điện thoại luôn giữ ở mức an toàn ($\le 3$ trang active).
3. **Hiển thị nét căng trên màn hình Retina/OLED (HiDPI Scaling):**
   - Áp dụng hệ số `outputScale = window.devicePixelRatio || 1` vào độ phân giải vẽ canvas, sau đó khóa kích thước hiển thị CSS bằng kích thước logic.

---

## III. THIẾT KẾ GIAO DIỆN & TRẢI NGHIỆM NGƯỜI DÙNG (UI/UX)

### 1. Sơ đồ Wireframe ASCII

#### A. Giao diện Đầy đủ Công cụ (Active State)
```text
┌────────────────────────────────────────────────────────┐  ◄── env(safe-area-inset-top)
│ [ ◀ ]   Network-Security-Handbook.pdf   [⛶] [🌓] [☰]  │  ◄── Sticky Top Header (#161b22)
│ ────────────────────────────────────────────────────── │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │                                                  │  │
│  │             TRANG 12 / 145                       │  │
│  │                                                  │  │
│  │   Chương 3: Phân tích Giao thức TLS 1.3          │  │  ◄── PDF Viewport (Fit-Width 100%)
│  │   ─────────────────────────────────────          │  │      Nền sẫm dịu mắt #0d1117
│  │   Giao thức TLS 1.3 lược bỏ hoàn toàn các bộ mã  │  │      Chữ trắng sáng tương phản cao
│  │   hóa yếu, rút ngắn quá trình bắt tay còn 1 RTT  │  │
│  │                                                  │  │
│  │   [ Hình 3.1: Sơ đồ Handshake TLS 1.3 ]         │  │
│  │                                                  │  │
│  │   1. ClientHello + Key Share                     │  │
│  │   2. ServerHello + EncryptedExtensions           │  │
│  │                                                  │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│                           ┌─────────────────────────┐  │
│                           │  [A] Vừa màn hình       │  │  ◄── Menu bung khi chạm nút tròn
│                           │  [📖] Lật trang / Cuộn   │  │
│                           │  [🌙] Đổi Theme Đêm/Sepia│  │
│                           │  [🔍] Tìm kiếm từ khóa  │  │
│                           └────────────┬────────────┘  │
│                                        │               │
│                                   ┌────┴────┐          │
│                                   │  ( ⚙️ )  │          │  ◄── Floating Action Bubble (#58a6ff)
│                                   └─────────┘          │
│            ┌───────────────┐                           │
│            │ Trang 12/145  │ ◄── Tooltip xem trang     │
│            └───────┬───────┘                           │
│  [ ◀ Trang ] ──────●──────────────────── [ Trang ▶ ]   │  ◄── Bottom Scrubbing Slider Bar
└────────────────────────────────────────────────────────┘  ◄── env(safe-area-inset-bottom)
```

#### B. Trải nghiệm Đọc Đắm Chìm (Immersive Fullscreen - Tự ẩn sau 3.5s hoặc Vuốt lên)
```text
┌────────────────────────────────────────────────────────┐
│                                                        │
│   Chương 3: Phân tích Giao thức TLS 1.3                │
│   ─────────────────────────────────────                │
│   Giao thức TLS 1.3 lược bỏ hoàn toàn các bộ mã hóa    │  ◄── 100% diện tích màn hình điện thoại
│   yếu, rút ngắn quá trình bắt tay còn 1 RTT...         │      Header Bar trượt lên translateY(-100%)
│                                                        │      Controls Bubble trượt xuống translateY(140%)
│   [ Hình 3.1: Sơ đồ Handshake TLS 1.3 ]               │      Không có thanh điều khiển nào che chữ!
│                                                        │
│   Chạm nhẹ 1 lần (Single Tap) vào màn hình             │
│   hoặc vuốt ngón tay xuống ➔ Hiện lại thanh công cụ!   │
│                                                        │
└────────────────────────────────────────────────────────┘
```

#### C. Ngăn Kéo Tiện Ích Đa Năng (Side Drawer Trượt Từ Phải Sang - Width 82%)
```text
┌───────────────────────────────┬────────────────────────┐
│                               │  [📑 Mục lục] [🖼️ Thumb] [🔍 Tìm]│
│                               ├────────────────────────┤
│                               │ 🔍 [ Nhập từ khóa... ] │
│                               │ ────────────────────── │
│         VÙNG ĐỌC MỜ           │ ▾ Chương 1: Tổng quan  │
│        (Backdrop Blur)        │   • 1.1 Mô hình OSI   │
│                               │   • 1.2 TCP/IP        │
│    Chạm ra ngoài để đóng      │ ▸ Chương 2: Giao thức  │
│                               │ ▾ Chương 3: TLS 1.3   │
│                               │   • 3.1 Handshake (p12)│ ◄── Đang đọc (Highlight màu xanh)
│                               │   • 3.2 0-RTT Mode     │
│                               │                        │
│                               │ ─── LƯỚI THUMBNAILS ── │
│                               │ ┌─────┐   ┌─────┐      │
│                               │ │ p11 │   │[p12]│      │ ◄── Lưới 2 cột trực quan
│                               │ └─────┘   └─────┘      │
└───────────────────────────────┴────────────────────────┘
```

---

### 2. Các Tính Năng Trải Nghiệm Cốt Lõi (Core UX Features)
1. **3 Chế độ Xem (Viewing Modes):**
   - **Continuous Scroll (Cuộn dọc):** Cuộn tự nhiên như đọc trang web, có quán tính mượt mà.
   - **Page Flip (Lật trang eBook):** Vuốt ngang trái/phải (`deltaX > 45px`) để lật từng trang sách, có hiệu ứng snap.
   - **Fit-Width (Vừa khít chiều ngang):** Căn chỉnh văn bản vừa khít 100% màn hình, không bị tràn ngang ở cả 2 hướng xoay màn hình dọc/ngang.
2. **Smart Dark Mode & Sepia (Đọc đêm chống chói):**
   - Dark Mode: Sử dụng GPU CSS Filter `filter: invert(0.92) hue-rotate(180deg) contrast(1.05)` giúp chuyển nền trắng thành xám đen `#121212`, chữ trắng sáng nhưng bảo toàn màu sắc tự nhiên của sơ đồ, hình ảnh.
   - Sepia Mode: Tông màu giấy ngà dịu mắt `sepia(0.55)` cho ban ngày.
3. **Thanh Trượt Nhanh (Bottom Scrubbing Bar):**
   - Kéo trượt thanh slider ở đáy màn hình kèm bong bóng xem trước số trang mục tiêu.
4. **Tự Ẩn Hoàn Toàn (Full Immersive Auto-Hide):**
   - Tự động ẩn cả Header và Bubble Controls sau 3.5s hoặc khi vuốt lên. Chạm 1 chạm hoặc vuốt xuống để hiện lại. Có nút ghim cố định nếu người dùng muốn.
5. **Cử chỉ Cảm ứng (Touch Gestures):**
   - Pinch-to-zoom (chụm 2 ngón tay) phóng to mượt mà không vỡ hạt.
   - Double Tap (chạm đúp) phóng to nhanh 1.75x vào vị trí biểu đồ/bảng số liệu.

---

## IV. CHI TIẾT TRIỂN KHAI PHƯƠNG ÁN TRANG RIÊNG (`mobile_pdf_reader.html`)

### 1. Kiến trúc Server & Định tuyến URL (`md_server.py`)
- **Route phục vụ trang web:**
  Trong `md_server.py`, bổ sung route `/pdf` và `/mobile_pdf_reader.html`:
  ```python
  if path in ["/pdf", "/pdf_viewer", "/mobile_pdf_reader.html"]:
      pdf_html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mobile_pdf_reader.html")
      # Trả về mã 200, Content-Type: text/html; charset=utf-8
  ```
  Người dùng có thể truy cập trực tiếp bằng URL ngắn: `http://<IP_LAN>:8770/pdf`.
- **Endpoint Streaming Binary HTTP 206 Range (`/api/fs/raw?path=...`):**
  - Hỗ trợ header `Range: bytes=start-end`.
  - Trả về mã `206 Partial Content` kèm `Accept-Ranges: bytes` và `Content-Range: bytes start-end/file_size`.
  - Giúp PDF.js tải phân đoạn từng trang, mở tức thì file lớn (>100MB) mà không tràn RAM.

### 2. Luồng Người dùng & Điều hướng Hai chiều (Two-Way Navigation Flow)
- **Từ File Explorer (`mobile_md_reader.html`) sang Trang PDF:**
  - Nhận diện file `.pdf`, hiển thị icon `📕 [PDF]` màu đỏ cam.
  - Khi người dùng chạm vào file:
    ```javascript
    const parentDir = currentPath;
    localStorage.setItem('last_active_dir', parentDir);
    const lastPage = localStorage.getItem('pdf_last_page_' + fullPath) || 1;
    window.location.href = `/pdf?file=${encodeURIComponent(fullPath)}&from_dir=${encodeURIComponent(parentDir)}#page=${lastPage}&zoom=fit`;
    ```
- **Từ Trang PDF quay lại File Explorer:**
  - Nút `[ ◀ Thư mục ]` ở góc trên bên trái Header Bar:
    ```javascript
    const returnDir = urlParams.get('from_dir') || localStorage.getItem('last_active_dir') || '';
    window.location.href = `/?dir=${encodeURIComponent(returnDir)}`;
    ```
  - Trình duyệt quay về đúng thư mục cha mà người dùng vừa đứng trước đó, giữ nguyên vị trí cuộn danh sách file, không bị reset về thư mục gốc hay ổ đĩa ngoài.
- **URL Hash & Deep Linking Đồng bộ Thời gian thực:**
  - Cấu trúc URL: `/pdf?file=C%3A%2FData%2FHandbook.pdf#page=12&zoom=fit&mode=scroll&theme=dark`
  - Tự động cập nhật hash bằng `history.replaceState()` khi cuộn trang, tránh làm phình lịch sử duyệt web.
  - Hỗ trợ lưu bookmark hoặc gửi link mở thẳng đúng trang sách đang đọc.

### 3. So sánh Đánh giá Kỹ thuật: Tách Trang Riêng vs Gộp Chung

| Tiêu chí | Tách Trang Riêng `mobile_pdf_reader.html` (Khuyên dùng) | Gộp chung vào `mobile_md_reader.html` |
|---|---|---|
| **Độ độc lập & Chống hồi quy** | **Tuyệt đối an toàn:** Không động tới mã nguồn Markdown đang chạy ổn định. | Rủi ro: Làm phình file HTML Markdown (>1300 dòng), dễ xung đột CSS/DOM. |
| **Tiết kiệm RAM & Tốc độ tải** | **Tối ưu vượt bậc:** Đọc Markdown không phải nạp 2MB PDF.js. Chỉ tải PDF.js khi mở trang PDF. | Kém hơn: Luôn phải nạp đồng thời Marked.js, Highlight.js và PDF.js ngay từ đầu. |
| **Trải nghiệm Đa nhiệm** | **Tiện lợi:** Có thể mở PDF ở 1 tab riêng để vừa đọc sách vừa tra cứu ghi chú Markdown bên tab kia. | Bị gò bó trong 1 tab duy nhất. |

---

## V. CHI TIẾT TRIỂN KHAI PHƯƠNG ÁN LÀM TRÊN CÙNG 1 TRANG (`mobile_md_reader.html` - Context-Aware SPA)

### 1. Kiến trúc DOM 3 Ngữ cảnh (Multi-View Single Page Architecture)
Tổ chức 3 container View ngang hàng trong cùng 1 trang `mobile_md_reader.html`:
- `#explorer-view`: Cây duyệt thư mục máy tính.
- `#reader-view`: Đọc tài liệu Markdown (Marked.js).
- `#pdf-view`: Đọc tài liệu PDF (PDF.js Canvas + TextLayer).
Chuyển đổi view tức thì bằng hàm `switchView(viewName)` với hiệu ứng mượt mà (Fade & Slide Transition), **hoàn toàn không tải lại trang web (0ms latency)**.

### 2. Kỹ thuật Dynamic Lazy-Loading Thư viện (Tối ưu RAM & Tốc độ mạng)
- Khi người dùng chỉ duyệt file hoặc đọc ghi chú Markdown, trang web **hoàn toàn không tải thư viện PDF.js**, giữ nguyên vẹn độ nhẹ và tốc độ hiện tại.
- Chỉ khi người dùng nhấp vào một file `.pdf` lần đầu tiên, hệ thống mới tự động kích hoạt nạp ngầm `<script>` `pdf.min.js` và `pdf.worker.min.js` trong ~0.3s.

### 3. Bong bóng Điều khiển Nổi Tự Biến Hình (Context-Aware Morphing Bubble `#reader-controls`)
- **Khi đọc Markdown:** Bong bóng hiển thị các công cụ Markdown (`[A-] [A+]` chỉnh cỡ chữ, trạng thái đồng bộ Live Hot-Reload với PC).
- **Khi chuyển sang đọc PDF:** Bong bóng tự động biến hình (Morphing animation) sang cụm công cụ chuyên biệt của PDF:
  + `[ 📜 Cuộn dọc / 📖 Lật trang sách ]`: Chuyển đổi giữa Continuous Vertical Scroll và eBook Page Flip.
  + `[ ⚡ Fit ]`: Căn chỉnh vừa khít 100% chiều ngang màn hình điện thoại.
  + `[ 🌙 Smart Dark ]`: Bộ lọc CSS GPU Filter (`invert(0.9) hue-rotate(180deg)`) biến nền trắng thành nền đen dịu mắt `#121212`, chữ trắng sáng mà không làm biến dạng màu sắc hình ảnh/sơ đồ.
  + `[ 📑 Drawer ]`: Mở ngăn kéo tiện ích 3 tab (Mục lục PDF, Lưới ảnh thu nhỏ, Tìm kiếm từ khóa).
  + **Thanh trượt Bottom Scrubber:** Xuất hiện sát đáy màn hình để trượt lướt nhanh qua hàng trăm trang.

### 4. Tái sử dụng 100% Tính năng & Trải nghiệm Đã Hoàn Thiện
- **Full Immersive Auto-Hide:** Kế thừa nguyên vẹn logic timer 3.5s và cảm biến vuốt ngón tay. Sau 3.5s hoặc khi vuốt lên để đọc tiếp, cả Header và Bubble Controls đều tự động ẩn sạch sẽ; chạm 1 chạm để hiện lại.
- **Nút Quay lại (`#btn-back`):** Nhấp quay lại sẽ dọn dẹp canvas PDF để giải phóng RAM, khôi phục ngay tức thì về File Explorer ở **đúng thư mục cha và vị trí cuộn cũ** mà không phải nạp lại mạng.
- **Tương thích nút Back vật lý của điện thoại:** Lắng nghe sự kiện `popstate` để khi bấm nút Back của Android hoặc vuốt cạnh Safari sẽ quay về Explorer thay vì thoát khỏi trang.

---

## VI. LỘ TRÌNH TRIỂN KHAI KHI ĐƯỢC PHÊ DUYỆT
1. **Giai đoạn 1 (Backend):** Cập nhật `md_server.py` lọc thêm file `.pdf`, thêm route `/pdf` (nếu làm trang riêng) và endpoint stream Range 206 `/api/fs/raw`.
2. **Giai đoạn 2 (Frontend):** 
   - Nếu làm trang riêng: Tạo mới file `mobile_pdf_reader.html`.
   - Nếu làm trên cùng 1 trang: Bổ sung container `#pdf-view`, Dynamic Lazy-Loading PDF.js và Morphing Bubble Controls vào `mobile_md_reader.html`.
3. **Giai đoạn 3 (Integration & Verification):** Kiểm chứng thực tế toàn diện bằng Verifier độc lập trên thiết bị di động.


