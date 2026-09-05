# ĐIỀU TRA & GIẢI PHÁP: TRÙNG LẶP DIRECTIVE CARD KHI GIAO VIỆC QUA THẺ <TALK>

**Ngày ghi nhận**: 04/09/2026  
**Trạng thái**: Đã xác định nguyên nhân gốc rễ — Đang chờ triển khai bản vá  

---

## 1. HIỆN TƯỢNG (OBSERVED BEHAVIOR)
Khi Orchestrator phát lệnh `<talk target="...">` để giao việc kèm câu trả lời hướng dẫn:
- Giao diện người dùng (ChatPanel) xuất hiện **2 bong bóng giao việc** liên tiếp:
  - **Bong bóng 1 (15:17:11 - Ngắn)**: Xuất hiện tức thì khi Orchestrator đang stream.
  - **Bong bóng 2 (15:17:17 - Dài hơn)**: Xuất hiện 6 giây sau khi Orchestrator stream xong và lưu tin canonical vào database.

---

## 2. NGUYÊN NHÂN GỐC RỄ (ROOT CAUSE)
1. **Bong bóng 1 (Realtime Stream Dispatcher)**:
   - Khi luồng stream LLM của Orchestrator vừa xuất hiện thẻ `<talk ...>`, bộ `stream-scanner` tại backend quét được và kích hoạt ngay một bản tin sự kiện độc lập (`msgType: 'talk'`) tại $t=0s$ đẩy qua WebSocket để worker nhận việc ngay.
   - Frontend nhận event `chat:message` (`msgType: 'talk'`) và render thành 1 Directive Card độc lập.
2. **Bong bóng 2 (Canonical Orchestrator Response Parser)**:
   - Khi Orchestrator gõ xong toàn bộ câu trả lời, server lưu toàn bộ văn bản phản hồi vào SQLite (`from: 'orchestrator'`).
   - Phía Frontend (`web/src/components/ChatPanel.tsx`), hàm render bong bóng lại quét nội dung text của tin nhắn Orchestrator, tìm thấy thẻ `<talk ...>` và parse lần thứ hai thành 1 Directive Card nữa.
   - Do đó, người dùng nhìn thấy 2 card giao việc cho cùng một lần bấm.

---

## 3. GIẢI PHÁP TRIỂN KHAI (PROPOSED FIX)
1. **Tại `ChatPanel.tsx` (Parser Dedup)**:
   - Khi render tin nhắn từ Orchestrator (`from: 'orchestrator'`), nếu nội dung có chứa `<talk ...>`, kiểm tra xem trong danh sách `allMessages` đã có tin nhắn `msgType: 'talk'` độc lập tương ứng (khớp `to` và cùng time-window $\pm 10s$) chưa.
   - Nếu đã có tin `msgType: 'talk'` riêng biệt: Tự động gọt sạch (strip) khối `<talk>...</talk>` khỏi nội dung tin nhắn Orchestrator, chỉ giữ lại phần văn bản giải thích/nói chuyện thông thường, tránh vẽ lại Directive Card lần thứ hai.
2. **Tại `src/server.ts` (Backend Tag Stripping)**:
   - Khi lưu tin nhắn canonical của Orchestrator vào DB, tự động loại bỏ thẻ `<talk>` đã được dispatch thành `msgType: 'talk'` riêng biệt để DB chỉ lưu phần đối thoại thuần túy.
