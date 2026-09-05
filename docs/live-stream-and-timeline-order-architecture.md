# KIẾN TRÚC ĐỒNG BỘ TIMELINE TUYỆT ĐỐI & STREAMING REALTIME KHÔNG ĐỘ TRỄ
**AgentForge Architecture Specification: Deterministic Causal Timeline & Zero-Delay Streaming**  
*Ngày cập nhật: 04/09/2026*

---

## 1. TỔNG QUAN BỐI CẢNH & NGUYÊN NHÂN SỰ CỐ CŨ

### 1.1 Hiện tượng đã phát hiện
1. **Tiến trình ngâm text tin nhắn của user & Orchestrator thứ 2 không xuất tin ngay**:
   - Khi User gửi tin nhắn trong lúc Orchestrator đang xử lý lượt trước (`client.isBusy() === true`), hệ thống kích hoạt nhánh `injectPromptAsync`.
   - Nhánh này spawn một subprocess detached chạy ngầm nạp vào session database nhưng hàm `dispatchUserChat` lập tức trả về `{ response: '' }` (rỗng).
   - Không có event stream (`chat:chunk`), không có bubble trả lời ra UI, đồng thời trạng thái agent bị khóa ở `working`.
   - Phía Web UI thấy Orchestrator `working`, tiếp tục nhốt tin nhắn kế tiếp của user vào hàng đợi client `agentQueues`, gây hiện tượng ngâm tin nhắn vĩnh viễn.
2. **Ra tin rồi ra ngoài vào sau lại biến mất (Mất tin khi Focus Tab)**:
   - Khi User chuyển tab ra ngoài hoặc chuyển cửa sổ rồi quay lại, sự kiện `window.addEventListener('focus')` kích hoạt `fetchHistory()` kéo toàn bộ lịch sử từ SQLite DB về.
   - Hàm lọc `applyOacDedup` ở Client chứa điều kiện lỗi:
     ```typescript
     if ((fullText !== undefined && trimmedContent === fullText) || (hasParts && fullText !== undefined)) {
       continue; // DROP TOÀN BỘ TIN NHẮN CANONICAL TỪ DB!
     }
     ```
   - Biến `oacHasParts` là Map toàn cục theo `from` (`'orchestrator'`). Chỉ cần trong quá khứ có 1 tin snapshot OpenCode, điều kiện `(hasParts && fullText !== undefined)` trở thành `true` cho toàn bộ các tin nhắn sau đó. Toàn bộ câu trả lời hoàn chỉnh kéo về từ DB bị vứt bỏ sạch khỏi UI!
3. **Hiện tượng nhảy cóc dòng thời gian (Timeline Ghost Jumping & Out-of-Order)**:
   - Do sắp xếp theo `Date.now()` (mili-giây): Hai tin nhắn sinh ra cùng mili-giây bị đảo lộn ngẫu nhiên.
   - Lệch pha thời điểm kết thúc ($T_{finish}$ vs $T_{start}$): Khi đang stream, bong bóng mang timestamp lúc bắt đầu ($T_{start}$). Khi xong 15 giây sau, server lưu DB với timestamp kết thúc ($T_{finish}$), làm bong bóng nhảy thụt xuống dưới các tin nhắn khác diễn ra trong 15 giây đó.

---

## 2. BỐN QUY LUẬT BẤT BIẾN (THE 4 IMMUTABLE LAWS OF TIMELINE & STREAM)

Để đạt được trạng thái **LIVE NHẤT (0ms)** và **ĐÚNG ORDER TIMELINE TUYỆT ĐỐI (Causal Consistency 100%)**, kiến trúc hệ thống thiết lập 4 quy luật bất biến:

```
                  ┌─────────────────────────────────────────────────────────┐
                  │          SERVER MONOTONIC SEQUENCE COUNTER              │
                  │              seq = 1, 2, 3, 4, 5, 6...                  │
                  └────────────────────────────┬────────────────────────────┘
                                               │
       ┌───────────────────────────────────────┴───────────────────────────────────────┐
       ▼                                                                               ▼
[LIVE STREAMING (0ms)]                                                   [DB PERSISTENCE (SQLite)]
• Cấp `turnId` duy nhất ngay lúc T_start                                 • Lưu cùng `turnId` đó
• Cấp `seq` đơn điệu tăng dần                                            • Lưu cùng `seq` đơn điệu đó
• Khóa cứng `timestamp = T_start`                                        • Khóa cứng `timestamp = T_start`
• WebSocket phát `chat:chunk` kèm {turnId, seq}                          • Trật tự trong DB = Trật tự Stream
       │                                                                               │
       └───────────────────────────────────────┬───────────────────────────────────────┘
                                               │
                                               ▼
                              ┌─────────────────────────────────┐
                              │       CLIENT SORTING RULE       │
                              │    sort((a, b) => a.seq - b.seq) │
                              └─────────────────────────────────┘
                              BẤT BIẾN 100% - KHÔNG THỂ XÁO TRỘN
```

### Quy luật 1: Bộ đếm Trật tự Nhân quả Đơn điệu (`seq` - Lamport Logical Clock)
- Máy chủ duy trì một biến đếm số nguyên duy nhất `globalMessageSeq`.
- Bất kỳ một tin nhắn hoặc hành động nào phát sinh (User chat, Stream khởi phát, Directive card, Worker report) đều được đóng dấu một số `seq` tăng dần nghiêm ngặt: $1, 2, 3, 4...$
- Về mặt toán học: Không bao giờ có 2 tin nhắn trùng số `seq`. Sự kiện sinh ra sau vĩnh viễn có `seq` lớn hơn sự kiện sinh ra trước.
- **Tiêu chuẩn sắp xếp UI**:
  ```typescript
  list.sort((a, b) => {
    if (a.seq !== undefined && b.seq !== undefined) return a.seq - b.seq;
    return (a.timestamp || 0) - (b.timestamp || 0);
  });
  ```

### Quy luật 2: Đồng nhất Danh tính từ Khởi thủy đến Database (Turn-ID Binding)
- Ngay khi bắt đầu một lượt phản hồi, Server cấp một định danh duy nhất:
  `turnId = msg_${agentId}_${timestamp}_${seq}`
- Mọi event streaming (`chat:chunk`, `chat:thinking`, `chat:tool_call`) đều gửi kèm `id: turnId` và `seq`.
- Khi lượt kết thúc, Server lưu vào Database với **ĐÚNG `id: turnId` VÀ `seq` ĐÓ**.
- **Ý nghĩa**: Bong bóng live stream chính là bản ghi database tương lai. Khi `fetchHistory()` kéo về, thao tác `map.set(m.id, m)` tự động cập nhật bản ghi tại chỗ mà không sinh ID mới, không nhảy vị trí, không nhân đôi và không mất tin.

### Quy luật 3: Khóa cứng Mốc Khởi thủy (Inception-Time Anchor)
- Timestamp của một tin nhắn được chốt cứng ngay tại thời điểm bắt đầu phát sinh ($T_{start}$).
- **Nghiêm cấm cập nhật timestamp thành thời điểm kết thúc ($T_{finish}$)**.
- Dù câu trả lời suy nghĩ mất 5 giây hay 30 giây, vị trí của nó trên dòng thời gian vẫn nằm chính xác ngay sau câu hỏi của User.

### Quy luật 4: Pipeline Zero-Delay (Hiển thị tức thì 0ms)
- **Optimistic UI ở Frontend**: Khi User nhấn gửi, tin nhắn của User xuất hiện lập tức trên màn hình ở $t=0ms$.
- **Loại bỏ hàng đợi ngậm tin client**: Gửi ngay request lên Server để Server đưa vào FIFO Queue `client.enqueue()`.
- **Stream trực tiếp từng token**: OpenCode nhả token nào, WebSocket phát ngay token đó (`chat:chunk`), độ trễ hiển thị dưới 10ms.

---

## 3. THIẾT KẾ CẤU TRÚC DỮ LIỆU & GIAO THỨC TRUYỀN THÔNG

### 3.1 Mở rộng kiểu dữ liệu `ChatMsg`
```typescript
export interface ChatMsg {
  id: string;              // Định danh duy nhất (turnId thống nhất từ live đến db)
  seq?: number;            // Số thứ tự đơn điệu tăng dần (Lamport sequence)
  from: string;
  to?: string;
  content: string;
  timestamp: number;       // Neo tại thời điểm khởi phát (T_start)
  agentName?: string;
  agentRole?: string;
  msgType?: string;
  teamId?: string;
  thinking?: string;
  toolCalls?: any[];
  parts?: any[];
  showOnUI?: boolean;
}
```

### 3.2 Giao thức WebSocket Events
1. **`chat:chunk` (Live text delta)**:
   ```json
   {
     "type": "chat:chunk",
     "id": "msg_orch_1725430000000_101",
     "seq": 101,
     "agentId": "orchestrator",
     "textDelta": "Tôi đang phân tích...",
     "teamId": "default"
   }
   ```
2. **`chat:thinking` (Live reasoning delta)**:
   ```json
   {
     "type": "chat:thinking",
     "id": "msg_orch_1725430000000_101",
     "seq": 101,
     "agentId": "orchestrator",
     "thinkingText": "Cần kiểm tra file...",
     "teamId": "default"
   }
   ```
3. **`chat:message` (Canonical completion)**:
   ```json
   {
     "type": "chat:message",
     "msg": {
       "id": "msg_orch_1725430000000_101",
       "seq": 101,
       "from": "orchestrator",
       "to": "user",
       "content": "Tôi đã hoàn thành kiểm tra.",
       "timestamp": 1725430000000,
       "teamId": "default"
     }
   }
   ```

---

## 4. MA TRẬN XỬ LÝ SỰ CỐ & NGĂN NGỪA TÁI DIỄN

| Tình huống rủi ro | Cơ chế bảo vệ cũ (Lỗi) | Cơ chế bảo vệ mới (Chuẩn hóa) |
| :--- | :--- | :--- |
| User chat khi agent đang bận turn trước | `injectPromptAsync` ngầm nuốt tin, trả về `response: ''`, khóa `working` vĩnh viễn | `client.enqueue()` đưa vào FIFO queue; tự động chạy turn 2 khi turn 1 xong; stream đầy đủ |
| Chuyển tab ra ngoài rồi quay lại (Focus window) | `applyOacDedup` quét toàn cục, drop sạch tin canonical kéo từ DB về | Loại bỏ boolean toàn cục; chỉ dedup khi trùng text 100% cùng lượt; ID DB khớp ID stream |
| Nhiều event phát sinh trong cùng 1 mili-giây | Sort theo `timestamp` làm đảo lộn thứ tự ngẫu nhiên | Sort tuyệt đối theo `seq` đơn điệu tăng dần; trật tự nhân quả bất biến 100% |
| Tin nhắn dài suy nghĩ nhiều giây | Đổi timestamp thành lúc kết thúc làm bubble nhảy cóc xuống đáy | Khóa cứng timestamp tại $T_{start}$, bubble đứng yên vững chắc |

---

*Tài liệu này là đặc tả kỹ thuật nền tảng của hệ thống điều phối AgentForge v7.x.*
