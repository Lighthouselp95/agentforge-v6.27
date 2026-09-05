# Phân Tích & Kế Hoạch Sửa Lỗi Font Chữ Thô Monospace, Nhân Đôi Tin Nhắn & Nuốt Nội Dung Card Giao Việc

## 1. Vấn Đề Gặp Phải
1. **Lệch Font Chữ và Định Dạng (Font Discrepancy & Raw Monospace Rendering)**:
   - Tin nhắn thứ nhất hoặc tin nhắn lưu trong cơ sở dữ liệu hiển thị font chữ hệ thống mềm mại, căn dòng đẹp mắt và render qua Markdown Renderer (`<h1>`, `<h2>`, in đậm, danh sách gạch đầu dòng, code block).
   - Tin nhắn thứ hai (hoặc khi nhận stream OpenCode trực tiếp) bị hiển thị bằng font máy đánh chữ monospace (`ui-monospace`, `Courier New`), text thô ráp, không phân tích Markdown và khoảng cách dòng bị co rúm.
2. **Trùng Lặp Tin Nhắn Realtime Trên UI (Orchestrator Message Duplication)**:
   - Khi Orchestrator trả lời, trên giao diện có thể xuất hiện đồng thời cả bong bóng tạm của stream (`stream-orchestrator-...`) và bong bóng canonical từ server (`uuid-...`), khiến người dùng thấy 2 tin nhắn có cùng nội dung.
3. **Lỗi Nuốt Nội Dung Card Giao Việc Hiển Thị Dạng Cụt Lủn `{segConvText`**:
   - Khi Orchestrator giao việc chứa đoạn code hoặc prop JSX (ví dụ `content={segConvText || segText}`), Card Giao Việc trên giao diện bị nuốt sạch toàn bộ nội dung hướng dẫn dài và chỉ còn hiển thị đúng vỏn vẹn `{segConvText`.

---

## 2. Nguyên Nhân Gốc Rễ (Root Cause Analysis)

### 2.1. Lỗi Nuốt Nội Dung Card Giao Việc Biến Thành `{segConvText` (`web/src/components/ChatPanel.tsx`)
- **Vị trí**: Dòng 2302–2310 của `web/src/components/ChatPanel.tsx`.
- **Cơ chế gây lỗi**:
  ```ts
  // 2. XML format: <talk target="..." task="...">body</talk> or self-closing <talk target="..." task="..." message="..." />
  if (!talkTaskDesc) {
    const xmlTaskMatch = rawContentStr.match(/\btask\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    const xmlMsgMatch = rawContentStr.match(/\b(?:message|msg|content)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    const xmlBodyMatch = rawContentStr.match(/<\s*talk\b[^>]*>([\s\S]*?)<\/\s*talk\s*>/i);
    const tAttr = xmlTaskMatch ? (xmlTaskMatch[1] || xmlTaskMatch[2] || xmlTaskMatch[3] || '') : '';
    const mAttr = xmlMsgMatch ? (xmlMsgMatch[1] || xmlMsgMatch[2] || xmlMsgMatch[3] || '') : '';
    const bText = xmlBodyMatch ? xmlBodyMatch[1].trim() : '';
    talkTaskDesc = [mAttr, bText].filter(Boolean).join('\n\n') || tAttr;
  }
  ```
- Khi server dispatch lệnh qua `deliverTalk`, `msg.content` chính là phần nội dung văn bản unboxed (không còn bọc thẻ `<talk>` ngoài cùng).
- Vì không có thẻ `<talk>`, `xmlBodyMatch` trả về `null` (`bText = ""`).
- Nhưng biểu thức `xmlMsgMatch` lại quét trên **toàn bộ văn bản** `rawContentStr` để tìm `\b(?:message|msg|content)\s*=\s*([^\s>]+)`.
- Khi trong hướng dẫn có nhắc tới JSX/HTML code: `content={segConvText || segText}`, regex này nhận nhầm `content={segConvText` là thuộc tính `content="..."` của lệnh talk!
- Kết quả: `mAttr = "{segConvText"`. Biến `talkTaskDesc` bị gán bằng `"{segConvText"`, biến `if (!talkTaskDesc)` ở bước fallback phía dưới không được chạy ➔ Toàn bộ nội dung nhiệm vụ thực sự bị xóa sổ và thay thế bằng chuỗi rác `{segConvText`!

### 2.2. Lỗi Font Chữ Thô Monospace (`web/src/components/ChatPanel.tsx`)
- Biến `isOpenCode` được xác định theo `msg.msgType === 'opencode'`.
- Trong `MessageItem`, tại Khối 2.5 (dòng 2806-2826) và Khối 3 (dòng 2865-2866 & 3014-3049), mã nguồn ép cứng:
  ```tsx
  fontFamily: isOpenCode ? 'monospace' : 'inherit',
  whiteSpace: isOpenCode ? 'pre-wrap' : 'normal',
  ```
- Đồng thời khi `isOpenCode === true`, mã nguồn bỏ qua `<MarkdownRenderer />` và đổ text thẳng vào thẻ `<div style={{ fontFamily: 'monospace' }}>`. Hậu quả là tin nhắn phản hồi của Orchestrator bị biến thành font code terminal máy đánh chữ, mất hết cấu trúc tiêu đề và format Markdown.

### 2.3. Lỗi Nhân Đôi Bong Bóng Tin Nhắn Realtime (`web/src/App.tsx`)
1. Trong `handleSend` (dòng 830-831), frontend thực hiện `delete streamRef.current['orchestrator']` ngay khi user vừa bấm gửi tin, xóa mất ref neo của stream trước khi phản hồi kịp stream về.
2. Khi server phát `chat:message` cho tin canonical (với ID ngẫu nhiên `uuidv4()`), do `streamRef` đã bị xóa, frontend không thể so khớp để cập nhật in-place vào bubble `stream-orchestrator-...` mà append thêm 1 tin mới.
3. Trong `applyOacDedup` (dòng 927), logic `if (hasParts && m.from !== 'orchestrator')` cố ý loại trừ `orchestrator`, khiến bubble stream tạm không được lọc sạch khi tin canonical đã xuất hiện.
4. Khi user chuyển tab/quay lại cửa sổ (window focus), `fetchHistory()` kéo dữ liệu từ DB (chỉ có tin canonical) và merge với `allMessages` (vẫn còn `stream-orchestrator-...` do có prefix `stream-`), dẫn đến nhân đôi 2 tin nhắn giống hệt nhau trên giao diện.

---

## 3. Kế Hoạch Sửa Chữa Triệt Để (Action Plan)

### Bước 1: Sửa Triệt Để Bóc Tách `talkTaskDesc` trong `web/src/components/ChatPanel.tsx`
- Chỉ tìm kiếm thuộc tính `task=` và `content=`/`message=` trong phần mở đầu thẻ `<talk ...>` khi và chỉ khi có thẻ mở `<\s*talk\b[^>]*>`.
- Tuyệt đối không quét regex `content=` tự do trên toàn bộ nội dung văn bản unboxed.
- Nếu `msg.content` là unboxed plain text (không chứa thẻ bọc `<talk>`), lấy nguyên vẹn `msg.content` làm `talkTaskDesc`.

### Bước 2: Chuẩn Hóa Font Chữ & Markdown trong `web/src/components/ChatPanel.tsx`
- Bỏ hoàn toàn `fontFamily: isOpenCode ? 'monospace' : 'inherit'` và `whiteSpace: isOpenCode ? 'pre-wrap' : 'normal'` tại Khối 2.5 và Khối 3, chuyển thành `fontFamily: 'inherit'` và `whiteSpace: 'normal'`.
- Chuyển toàn bộ nội dung text của `isOpenCode` sang render qua `<MarkdownRenderer />`.

### Bước 3: Sửa Cơ Chế Khử Trùng Lặp Tin Nhắn Realtime trong `web/src/App.tsx`
- Giữ lại neo `streamRef.current['orchestrator']` trong `handleSend` cho đến khi tin canonical đến hoặc luồng stream kết thúc.
- Khi nhận `chat:message` từ Orchestrator, tìm bubble stream tạm `stream-orchestrator-*` trong `allMessages` và thay thế in-place.
- Mở rộng `applyOacDedup` để xử lý khử trùng lặp cho cả tin nhắn Orchestrator khi đã có bản canonical.

### Bước 4: Kiểm Chứng TypeScript & Build Đóng Gói
- Chạy `npx tsc --noEmit` xác nhận 0 lỗi.
- Build production bundle frontend và đóng gói SEA binary v7.0.14 cục bộ.
