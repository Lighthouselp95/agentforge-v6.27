# Báo Cáo Nghiên Cứu v8 Routes: Message Flow & Data Architecture

## Tổng Quan

Tài liệu này ghi lại các phát hiện từ **ROUTE-RESEARCH-1** (Nghiên cứu v8 Routes - Message Flow Mapping). Mục tiêu: Bản đồ luồng dữ liệu AgentForge chi tiết nhằm xác định các điểm single-source-of-truth (SSOT) và các redundant paths có thể gây lỗi như lặp message, tool calls không hiển thị, lỗi timestamp.

---

## 1. Message Flow Diagram (Bản đồ Luồng Dữ Liệu)

### 1.1 Sơ Đồ Tổng Thể

```
[Client Input]
   │
   ▼ HTTP POST /api/chat (hoặc /api/chat/force-send)
┌─────────────────────────────────────────────────────────────────────┐
│                 Express Router: src/routes/chat.ts                   │
│                                                                     │
│      ┌─────────────────────┐    ┌─────────────────────────────┐      │
│      │  LƯU TRẠNG MỚI     │    │     QUY TRÌNH XỬ LÝ       │      │
│      │   userMsg lưu    │    │     backend (dispatch)     │      │
│      │   vào chatHistory  │    │                             │
│      └─────────────────────┘    │                             │
│        │                       │                             │
│        ├─► Target RẢNH (isTargetBusy=false)                     │
│        │   - Broadcast chat:message (WS/SSE)                    │
│        │   - Client: handleRealtimeEvent('chat:message')        │
│        │         └─► setAllMessages(prev => mergeMessage(prev, userMsg)) │
│        │                                                       │
│        └─► Target BẬN (isTargetBusy=true)                      │
│            - Đưa vào queue (userQueueManager)                │
│            - Lưu storage.saveUnprocessedMessage(...)         │
│            - HTTP response: { ok: true, queued: true }          │
│            - KHÔNG broadcast chat:message (ở UI: hiện trong queue bar)│
│                                                             │
│   ┌─────────────────────┐    ┌─────────────────────────────┐      │
│   │     XỬ LÝ BACKEND    │    │       SSE/WS HANDLER         │      │
│   │      (dispatchUserChat)│   │   (stream: chunk/thinking/tool_call) │
│   └─────────────────────┘    └─────────────────────────────┘      │
│           │                       │                             │
│           ├─► Assistant turn complete -> broadcast(chat:message) │
│           │   (assistant reply)                             │
│           └─► Client: handleRealtimeEvent('chat:message')    │
│                 └─► mergeMessage vào allMessages            │
│                                                             │
│   ┌─────────────────────┐    ┌─────────────────────────────┐      │
│   │       UI RENDER      │    │        CHAT PANEL          │      │
│   │   (App.tsx filteredMessages)│   │   (ChatPanel.tsx displayMessages)│
│   └─────────────────────┘    └─────────────────────────────┘      │
```

### 1.2 Chi Tiết Dòng Chảy

#### A. Frontend Router (`web/src/App.tsx`)
- **Component:** `filteredMessages` computed prop (selectedAgentId > 1 -> filtered)
- **Nguồn dữ liệu:** `allMessages` (state mới nhất từ WS/SSE + fetchHistory)
- **Logic:** Ứng dụng quy tắc team isolation, lọc tin nhắn rỗng, xử lý tin nhắn user optimistic vs canonical
- **Input:** `handleRealtimeEvent(msg)` xử lý sự kiện WS/SSE `chat:message`, `chat:chunk`, `chat:thinking`, `chat:tool_call`, `chat:queue:dispatched`

#### B. Backend Router (`src/routes/chat.ts`)
- **Route:** `router.post('/chat')` (http://localhost:4001/api/chat) + `router.post('/chat/force-send')`
- **Tác vụ chính:**
  - Lưu tin nhắn user vào `deps.chatHistory` + `deps.storage.saveMessage(userMsg)` (JSONL WAL)
  - Xác định target (agent hoặc orchestrator) và kiểm tra tình trạng bận/rảnh (`isTargetBusy`)
  - Nếu rảnh: broadcast `chat:message` -> client
  - Nếu bận: đưa vào queue (`deps.userQueueManager.enqueue`) + lưu disk + phản hồi queued
- **WebSocket Broadcast:** Sử dụng `deps.broadcast()` (wrapper của WebSocketService) để gửi `chat:message`, `chat:chunk`, `chat:thinking`, `chat:tool_call`

#### C. WebSocket Service (`src/ws/ws-service.ts`)
- **Class:** `WebSocketService`
- **Phương thức:** `broadcast(type, data, filterTeamId)` (L101)
- **Logic:** Gửi payload JSON đến tất cả kết nối WebSocket sẵn sàng, với tùy chọn lọc theo `teamId` query param
- **Subscribed Events:** `chat:message`, `chat:chunk`, `chat:thinking`, `chat:tool_call`, `agent:updated`, `chat:queue:dispatched`

#### D. Client SSE Handler (`web/src/App.tsx` handleRealtimeEvent)
- **Event Types:**
  - `chat:message`: xử lý merge vào allMessages (logic phức tạp nhất, gồm merge vào stream bubble, fallback tìm stream, final add)
  - `chat:chunk`, `chat:thinking`, `chat:tool_call`: update stream bubble (`upsertStreamMsg`)
  - `chat:queue:dispatched`: dọn UI queue
- **File:** `web/src/App.tsx` (thực tế hơn 2000 dòng, đoạn trích L336-797 cho handleRealtimeEvent)

---

## 2. ROUTE-RESEARCH-2: Phân Tích Dedup Hiện Tại & Đề Xuất Unified Strategy cho v8

> **Trạng thái codebase tham chiếu:** v7.0.55 (post-hotfix). Một hàm `mergeMessage` đã được tập trung hoá ở `web/src/App.tsx` L25-34, nhưng tầng "lọc cảm tính" vẫn còn và gây ra race condition. Mục này phân tích chi tiết các gaps còn sót và đề xuất kiến trúc dedup dựa trên **canonical ID duy nhất** cho v8.

---

### 2.1 Bản Đồ 5 Điểm Ingestion (Hiện Trạng v7.0.55)

Mặc dù v7.0.55 đã hợp nhất 1 helper `mergeMessage` (App.tsx L25-34) sử dụng ở 5 điểm ingestion khác nhau, mỗi điểm vẫn tự quyết định "có nên push hay skip" mà không có cơ chế đồng bộ canonical-id. Sơ đồ:

```
[1] sendMessage — Optimistic Push (App.tsx L1105-1121)
       │  - userMsg.id = client UUID sinh trước khi gửi (l.1071)
       │  - Push qua mergeMessage → setAllMessages
       ▼
[2] handleForceSendSingle — Optimistic Push (App.tsx L1218)
       │  - userMsg.id = msgId hoặc fallback `force-${Date.now()}` (l.1210)
       ▼
[3] handleForceSendAll — Optimistic Push (App.tsx L1260)
       │  - userMsg.id = `force-all-${Date.now()}` (l.1252) — KHÔNG ổn định
       ▼
[4] handleRealtimeEvent('chat:message') — Server Push (App.tsx L736-744)
       │  - mergeMessage(prev, incoming) — ID canonical từ server
       ▼
[5] fetchHistory() — Startup/Reconnect (App.tsx L300-316)
       │  - mergeMessage(prev, data[0]) + loop với existingKeys Set
       ▼
     [allMessages state]
       │
       ▼
[6] applyOacDedup() — Filter Pass (App.tsx L1320-1367) — App-level O(n) quét
       │
       ▼
[7] displayMessages (ChatPanel.tsx L3282-3340) — Render-time O(n²) dedup
       │
       ▼
[8] deduplicatedMessages (ChatPanel.tsx L3735-3768) — Final render O(n²) user dedup
```

#### Code thực tế của `mergeMessage` (App.tsx L25-34):

```typescript
const mergeMessage = (prev: any[], incoming: any): any[] => {
  const incomingKey = getMessageKey(incoming);
  const existingIdx = prev.findIndex(p =>
    getMessageKey(p) === incomingKey &&
    Math.abs((p.timestamp || 0) - (incoming.timestamp || 0)) < 5000  // 5s window!
  );
  if (existingIdx !== -1) {
    const updated = [...prev];
    updated[existingIdx] = { ...updated[existingIdx], ...incoming, id: incoming.id || updated[existingIdx].id };
    return updated;
  }
  return [...prev, incoming];
};
```

Và `getMessageKey` (App.tsx L16-23):

```typescript
const getMessageKey = (msg: any) => {
  if (msg?.id && !String(msg.id).startsWith('temp-') && !String(msg.id).startsWith('stream-')) {
    return `id:${msg.id}`;  // ✅ Canonical ID path
  }
  // ⚠️ Fallback: content fingerprint + 30s timeBucket
  return `${msg?.from || 'unknown'}:${content}:${timeBucket(msg?.timestamp)}`;
};
```

---

### 2.2 Phân Tích 4 Gaps Nghiêm Trọng Còn Sót

#### Gap #1: Client sinh ID **trước khi server phản hồi**, nhưng `force-all-${Date.now()}` là id **không ổn định**
- `handleForceSendAll` (App.tsx L1252): `id: 'force-all-' + Date.now()` — mỗi lần gọi sinh id mới.
- `handleForceSendSingle` (App.tsx L1210): `id: msgId || 'force-' + Date.now()` — nếu `msgId` truyền vào KHÔNG phải UUID, fallback cũng không ổn định.
- **Hệ quả:** Khi backend broadcast `chat:message` về, server có thể tự sinh UUID mới (`msg-uuid-xxx`) thay vì echo lại `messageId` client. Client nhận 2 id khác nhau, `getMessageKey` chỉ rẽ vào nhánh content-fingerprint → có thể match hoặc miss tuỳ 5s window.

#### Gap #2: Hàm `mergeMessage` có cửa sổ 5 giây, nhưng `applyOacDedup` dùng cửa sổ 120 giây (User) / 4-5 giây (Agent)
- `mergeMessage` (L27): `Math.abs(...) < 5000` — chỉ merge nếu timestamp trong vòng 5s.
- `applyOacDedup` (L1342): `Math.abs((Number(prev.timestamp) || 0) - mTime) < 120000` — merge nếu trong vòng 120s cho user.
- `displayMessages` ChatPanel.tsx (L3303): `Math.abs(prevTime - mTime) > 300000` — coi là 2 tin riêng biệt nếu cách >5 phút.
- **Hệ quả:** Một tin nhắn broadcast trễ 5.001 giây sẽ KHÔNG bị merge ở `mergeMessage` (sinh bản sao), nhưng LẠI bị khử ở `applyOacDedup` hoặc `displayMessages` nếu vẫn trong 120s/300s. Kết quả: tuỳ tốc độ render mà bubble hiện/không hiện — gây trải nghiệm không nhất quán giữa các client khác nhau.

#### Gap #3: Race `chat:message` vs `chat:queue:dispatched` vs `fetchHistory`
- Khi user gửi tin vào target bận → server trả `{ queued: true, messageId: 'X' }` (L1134-1156).
- Server tự xả queue → broadcast `chat:queue:dispatched` (xử lý ở L361-401) + broadcast `chat:message` cho tin được xả.
- Nếu client vừa mở lại tab → `fetchHistory` nạp lại lịch sử, có thể chứa cùng `id = X` với payload canonical.
- `fetchHistory` (L300-316) gọi `mergeMessage(prev, data[0])` rồi loop `data[1..]` với `existingKeys = new Set(updated.map(m => getMessageKey(m)))`. Nhưng `getMessageKey` ưu tiên `id:X` — nếu `data[0]` chính là tin có `id = X` đã có trong `prev` thì OK, nhưng nếu tin đó ở `data[i]` với `i > 0` thì `existingKeys` đã có → skip đúng.
- **Tuy nhiên**, nếu `prev` chỉ chứa **optimistic** (id = `force-...` thay vì `X`), thì `existingKeys` chỉ chứa `id:force-...`. Khi loop tới `data[i].id = X`, `getMessageKey` trả về `id:X` — **không có trong existingKeys** → push thêm 1 bản ghi nữa. Cặp `force-...` + `X` cùng tồn tại trong `allMessages` cho tới khi `applyOacDedup` quét và khử (trong 120s).

#### Gap #4: Wrapper + Report merge ở tầng render (ChatPanel.tsx L3757-3764)
```typescript
if (isWrapper) {
  const next = visibleMessages[idx + 1];
  if (next) {
    const sameAgent = !!msg.agentId && msg.agentId === next.agentId;
    const nextIsReport = !!next.content && (
      next.content.includes('=== TASK REPORT ===') ||
      next.content.includes('=== ERROR REPORT ===') ||
      next.content.includes('=== AGENT MESSAGE ===')
    );
    if (sameAgent && nextIsReport) return false;
  }
}
```
- **Hệ quả:** Logic "wrapper + report merge" dựa trên **content string** (heuristic), không dựa trên **structured field** `msgType` hay `msg.reportAttached`. Một wrapper có content không chứa "TASK REPORT" nhưng bản chất là report sẽ KHÔNG bị merge. Hoặc ngược lại, 2 tin độc lập cùng agent với content tình cờ chứa "TASK REPORT" sẽ bị merge nhầm.

---

### 2.3 Bảng Tổng Hợp Hằng Số Dedup Trong v7.0.55

| Hằng số | Giá trị | Vị trí | Đối tượng | Vấn đề |
|---------|---------|--------|-----------|--------|
| `mergeMessage` window | **5s** | App.tsx L27 | Tất cả | Quá hẹp cho optimistic push; race với WS trễ |
| `applyOacDedup` user window | **120s** | App.tsx L1342 | User | Quá rộng → nuốt 2 tin hợp lệ cách nhau >2 phút |
| `applyOacDedup` agent window | **4s (talk) / 5s (general)** | App.tsx L1354 | Agent | Mâu thuẫn với mergeMessage |
| `displayMessages` user window | **300s (5 phút)** | ChatPanel.tsx L3303 | User | Quá rộng, tin nhắn hợp lệ cách 6 phút bị coi là "dup" |
| `displayMessages` agent window | **15s / 30s** (streaming) | ChatPanel.tsx L3316, 3321 | Agent | Streaming bubble vs canonical race |
| `deduplicatedMessages` user window | **300s** | ChatPanel.tsx L3751 | User | Trùng với displayMessages — dư thừa |
| `BROADCAST_DEDUP_TTL_MS` | **30s** | src/relay/dedup.ts L4 | Backend broadcast | Server chặn broadcast 30s nếu content trùng |
| `OUTBOX_DELIVER_TALK_DEDUP_MS` | **2s** | src/relay/dedup.ts L5 | Backend outbox | Chặn 2s cho deliverTalk |
| `ORCH_TRIGGER_DEDUP_MS` | **5s** | src/relay/dedup.ts L6 | Backend orch trigger | Chặn 5s cho orchestrator trigger |

**Quan sát:** Có tới **9 hằng số dedup rải rác** ở 3 layer (frontend merge, frontend filter, backend relay), mỗi cái có giá trị khác nhau và bán kính ảnh hưởng khác nhau. Đây là triệu chứng của việc vá lỗi tại chỗ qua nhiều version mà không có chiến lược tổng thể.

---

### 2.4 Đề Xuất v8: Kiến Trúc "Single Ingestion Point" + Canonical ID

#### Nguyên tắc cốt lõi:
**ID là điều kiện cần và đủ. Nội dung & timestamp chỉ là thuộc tính tham khảo.**

#### 2.4.1 Backend phải gán `clientMsgId` canonical ngay tại ingestion point

**Hiện tại (v7.0.55):** Client sinh UUID → gửi kèm `messageId` trong body. Nhưng backend (`src/routes/chat.ts` route `/chat`) **có thể bỏ qua** `messageId` này và tự sinh UUID mới khi lưu vào `chat.jsonl`.

**Đề xuất v8:**

```typescript
// src/routes/chat.ts — POST /api/chat
router.post('/chat', async (req, res) => {
  const { message, teamId, messageId, targetAgentId } = req.body;
  
  // 1. BẮT BUỘC dùng messageId từ client. Nếu thiếu → reject.
  if (!messageId || !isUuid(messageId)) {
    return res.status(400).json({ error: 'messageId (UUID) is required' });
  }
  
  const userMsg: ChatMsg = {
    id: messageId,           // ← Canonical ID từ client
    from: 'user',
    to: targetAgentId || 'orchestrator',
    content: message,
    timestamp: Date.now(),
    teamId,
    // ... các field khác
  };
  
  // 2. Lưu storage với id = messageId
  await deps.storage.saveMessage(userMsg);
  
  // 3. Broadcast với id = messageId
  deps.broadcast('chat:message', userMsg);
  
  res.json({ ok: true, messageId });
});
```

**Lợi ích:**
- Client push optimistic với `id = X` → backend lưu + broadcast với cùng `id = X` → `mergeMessage` khử trùng lặp O(1) bằng key `id:X` ở mọi layer.
- Không còn race giữa client-id và server-id.
- Force-send cũng phải dùng cùng cơ chế: backend KHÔNG tự sinh id mới.

#### 2.4.2 Frontend: 1 hàm `ingestMessage` duy nhất, deterministic, không cửa sổ thời gian

```typescript
// web/src/utils/ingestMessage.ts (mới cho v8)
export function ingestMessage(prev: ChatMsg[], incoming: ChatMsg): ChatMsg[] {
  if (!incoming.id) {
    // Defensive: backend luôn gán id, nếu thiếu → log + skip
    console.warn('[ingest] missing id, skip', incoming);
    return prev;
  }
  const idx = prev.findIndex(m => m.id === incoming.id);
  if (idx !== -1) {
    // Merge: ưu tiên field non-null/non-empty từ incoming
    const existing = prev[idx];
    const merged: ChatMsg = {
      ...existing,
      ...incoming,
      // Bảo toàn các field "client-side state"
      isOptimistic: incoming.isOptimistic ?? existing.isOptimistic,
    };
    const next = [...prev];
    next[idx] = merged;
    return next;
  }
  return [...prev, incoming];
}
```

**Mọi điểm ingestion** (sendMessage, handleForceSend*, handleRealtimeEvent, fetchHistory) đều gọi `ingestMessage` thay vì tự quyết định push/skip.

#### 2.4.3 Xoá bỏ toàn bộ 4 layer dedup heuristic

| Layer cũ (xoá) | Lý do xoá |
|-----------------|-----------|
| `mergeMessage` với `Math.abs(...) < 5000` (App.tsx L27) | Canonical ID đủ để khử; window 5s gây race |
| `applyOacDedup` với 120s/4s/5s window (App.tsx L1320-1367) | Canonical ID đã khử ở ingestion |
| `displayMessages` với 300s/15s/30s (ChatPanel.tsx L3282-3340) | Canonical ID đã khử ở ingestion |
| `deduplicatedMessages` với 300s (ChatPanel.tsx L3735-3768) | Canonical ID đã khử ở ingestion; chỉ giữ "wrapper+report merge" nếu chuyển thành logic dựa trên `msgType === 'wrapper'` thay vì content regex |

#### 2.4.4 Optimistic Push vẫn được phép, nhưng với cùng canonical ID

```typescript
// sendMessage (v8) — Pseudo-code
async function sendMessage(text: string, targetId: string) {
  // 1. Client tự sinh UUID — đây là canonical ID từ đầu
  const messageId = crypto.randomUUID();
  
  // 2. Push optimistic bubble với id = messageId
  const optimisticMsg: ChatMsg = {
    id: messageId,
    from: 'user',
    to: targetId,
    content: text,
    timestamp: Date.now(),
    isOptimistic: true,
  };
  setAllMessages(prev => ingestMessage(prev, optimisticMsg));
  
  // 3. Gửi lên server với cùng messageId
  const res = await fetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: text, messageId, targetAgentId: targetId })
  });
  
  // 4. Server broadcast chat:message với cùng messageId
  //    → ingestMessage tìm thấy id trùng → merge (gỡ cờ isOptimistic)
  //    → KHÔNG tạo bubble mới
}
```

**Kết quả:** Optimistic push hiển thị 0ms, khi server phản hồi cùng `id` thì `ingestMessage` update tại chỗ, không sinh bubble thứ hai.

#### 2.4.5 Migration Path (an toàn, từng bước)

| Bước | Hành động | Rủi ro | Rollback |
|------|-----------|--------|----------|
| 1 | Backend enforce `messageId` UUID ở `/api/chat` (reject nếu thiếu) | Thấp: client hiện tại đã gửi `messageId` (App.tsx L1124) | Tạm thời default UUID nếu thiếu |
| 2 | Backend dùng `messageId` làm `id` trong storage + broadcast | Thấp: trùng với client UUID | So sánh UUID trùng với id trong storage |
| 3 | Frontend thay `mergeMessage` cũ bằng `ingestMessage` mới | Trung bình: có thể lộ bug nếu backend chưa hoàn tất bước 1-2 | Fallback về `mergeMessage` nếu ingest throw |
| 4 | Frontend xoá `applyOacDedup` window heuristic, giữ phần `seenIds` Set | Thấp | Giữ window làm safety net |
| 5 | Frontend xoá `displayMessages`/`deduplicatedMessages` window heuristic | Thấp | Còn nguyên 2 lớp trên làm safety net |
| 6 | Backend tắt các DedupManager TTL (`broadcastDedup`, `orchTriggerDedup`) | Trung bình: có thể sinh message trùng nội dung nếu tool gọi 2 lần | Giữ TTL, chỉ chuyển sang log thay vì skip |

---

### 2.5 Tóm Tắt & Khuyến Nghị Cuối Cùng

| # | Khuyến nghị | Mức độ ưu tiên | File tham chiếu |
|---|-------------|----------------|-----------------|
| 1 | Backend enforce canonical `clientMsgId` tại `/api/chat` + `/api/chat/force-send` | **P0** | src/routes/chat.ts (chưa rõ dòng cụ thể — cần đọc sâu) |
| 2 | Frontend: 1 hàm `ingestMessage` O(1) dựa trên `id` | **P0** | web/src/App.tsx L25-34 (thay thế) |
| 3 | Xoá `applyOacDedup` window 120s/4s/5s | **P1** | web/src/App.tsx L1320-1367 |
| 4 | Xoá `displayMessages` window 300s/15s/30s | **P1** | web/src/components/ChatPanel.tsx L3282-3340 |
| 5 | Xoá `deduplicatedMessages` window 300s (giữ logic wrapper+report nếu chuyển sang `msgType === 'wrapper'`) | **P2** | web/src/components/ChatPanel.tsx L3735-3768 |
| 6 | Backend: giữ `OUTBOX_DELIVER_TALK_DEDUP_MS=2s` (an toàn) nhưng thêm log để trace | **P2** | src/relay/dedup.ts L5 |
| 7 | Backend: xem xét tắt `BROADCAST_DEDUP_TTL_MS=30s` (chỉ phòng case tool gọi 2 lần) | **P3** | src/relay/dedup.ts L4 |

**Nguyên tắc thiết kế v8:** Nếu 2 message có cùng `id` → merge. Nếu 2 message có `id` khác → là 2 message khác nhau, KHÔNG cần so sánh nội dung. Mọi ngoại lệ phải có lý do rõ ràng và được document.

---

## 3. ROUTE-RESEARCH-3: Team Isolation Redesign cho v8

### 3.1 Hiện Trạng Cấu Trúc Team & Điểm Yếu Cách Lý

Hệ thống AgentForge hiện tại hỗ trợ tính năng **Multi-Team** (chạy đồng thời nhiều Orchestrator và nhóm Agent riêng biệt, ví dụ: `default` vs `team-aba40d4f`). Tuy nhiên, cơ chế cách ly (team isolation) hiện nay đang bị phân tán giữa Frontend và Backend, dẫn đến nhiều lỗ hổng rò rỉ dữ liệu và hiển thị sai logic:

```
[WebSocket Client] ─── ws://host/?teamId=team-A ───► [WebSocketService]
                                                             │
                                                             ▼
                                                broadcast(type, data, filterTeamId)
                                                             │
                              ┌──────────────────────────────┴──────────────────────────────┐
                              ▼                                                             ▼
                ws.teamId === filterTeamId                                    ws.teamId KHÔNG CÓ / KHÔNG LỌC
                (Được lọc tin realtime)                                        (Vẫn nhận tất cả sự kiện!)
                              │
                              ▼
                   [Frontend: App.tsx (allMessages)]
                              │
                              ├─► fetchHistory(): REST API GET /api/history (KHÔNG TRUYỀN teamId mặc định)
                              │
                              ▼
                   [filteredMessages Computed Prop]
                              │  - Fallback đoán teamId qua sender/receiver (L1412)
                              │  - Drop tin nhắn cross-team ở UI (L1419)
                              │  - Filter sub-orchestrator cực kỳ rắc rối (L1427-1480)
                              ▼
                   [ChatPanel.tsx MessageItem Render]
                              │  - isIncomingToOrch (L1778-1780) làm ẨN toolCalls hiển thị!
```

---

### 3.2 Phân Tích 4 Lỗ Hổng Cách Lý Dữ Liệu (Cross-Team Leaks)

#### 1. Rò Rỉ WebSocket (WebSocket Broadcast Filter Leak)
- **Vấn đề:** Trong `src/ws/ws-service.ts` (L101-117), hàm `broadcast(type, data, filterTeamId)` chỉ lọc tin nếu `filterTeamId` được truyền vào **và** client đã set `ws.teamId`.
- **Rủi ro:** Khi Backend gọi `broadcast('chat:message', msg)` ở rất nhiều nơi (ví dụ: `src/routes/chat.ts` L152) mà **không truyền tham số `filterTeamId`**, toàn bộ WebSocket client của TẤT CẢ các team đều nhận được tin nhắn này.
- **Hậu quả:** Frontend của Team A phải gánh trách nhiệm tự lọc bỏ tin nhắn của Team B (Frontend-heavy filtering), gây tốn RAM, CPU và nguy cơ lộ dữ liệu nhạy cảm ở phía Client inspector.

#### 2. REST API History Không Cách Lý Ở Database (History API Cross-Team Leak)
- **Vấn đề:** API `GET /api/history` (`src/routes/chat.ts` L50-55) chỉ nhận parameter `agentId` và `limit`. File WAL storage `data/chat.jsonl` có ghi nhận `teamId` hay không phụ thuộc vào từng bản tin, nhưng query engine của Backend **chưa hề lọc theo `teamId`**.
- **Hậu quả:** Khi Client của Team A gọi `fetchHistory()` lúc khởi động hoặc reconnect, Backend trả về lịch sử trộn lẫn của CẢ Team A lẫn Team B. Client lại phải dùng logic `applyOacDedup` & `filteredMessages` để lọc thủ công.

#### 3. Đoán TeamId Cảm Tính Ở Frontend (Client-side TeamId Fallback Guessing)
- **Vấn đề:** Trong `web/src/App.tsx` (L1411-1415), nếu một tin nhắn `m` từ WS/SSE bị thiếu thuộc tính `m.teamId`, Frontend đành phải tự suy luận (`msgTeamId = senderAgent?.teamId || receiverAgent?.teamId || 'default'`).
- **Hậu quả:** Khi một Agent vừa mới được spawn hoặc vừa bị xóa, `agents.find(...)` trả về `undefined`, tin nhắn lập tức bị gán về team `'default'`. Kết quả là tin nhắn của Team 2 bị văng sang khung chat của Team 1!

#### 4. Lỗi Drop ToolCalls Khi Hiển Thị Sub-Orchestrator (Sub-Orch ToolCall Drop Bug)
- **Vấn đề 1:** Tại `web/src/App.tsx` (L1413 cũ/v7.0.52), bộ lọc sub-orchestrator cho rằng sub-orchestrator chỉ cần nhận tin nhắn `to === 'user'` hoặc `to === 'broadcast'`. Kết quả: Các tin nhắn chứa `toolCalls` do sub-orchestrator tự thực thi gửi cho chính nó hoặc worker bị **DROP HOÀN TOÀN** khỏi `allMessages`.
- **Vấn đề 2:** Tại `web/src/components/ChatPanel.tsx` (L1778-1780):
  ```typescript
  const isIncomingToOrch = (isOrchView && !isOrchestrator && !isUser) ||
    (isSubOrchView ? (msg.to === 'orchestrator' && !isUser && !isFromCurrentSubOrch) : (msg.to === 'orchestrator' && !isOrchestrator && !isUser));
  const effectiveShowToolBlocks = showToolBlocks && !isIncomingToOrch;
  ```
  Biến `effectiveShowToolBlocks` ép cờ ẩn thẻ ToolCall nếu tin nhắn được coi là `isIncomingToOrch`, khiến cho người dùng xem tab Sub-Orchestrator hoàn toàn KHÔNG thấy được các block tool block (như execute command, write file).

---

### 3.3 Đề Xuất v8: Backend-Enforced Team Isolation Architecture

Mô hình v8 chuyển toàn bộ trách nhiệm cô lập dữ liệu về **Backend (Single Point of Access Control)**:

```
[WebSocket Client: Team A] ── ws://host/?teamId=team-A ──► [WS Gateway (Backend)]
                                                                  │
                                                Strict Room-based Broadcast
                                                                  │
                                            ┌─────────────────────┴─────────────────────┐
                                            ▼                                           ▼
                                 [Client Team A State]                       [Client Team B State]
                                (Chỉ chứa tin Team A)                       (Chỉ chứa tin Team B)
```

#### Các Thay Đổi Kiến Trúc Cốt Lõi Cho v8:

1. **WS Subscriptions theo Phòng (Team Room-Based WS Gateway):**
   - Mọi kết nối WebSocket BẮT BUỘC phải đăng ký `teamId`. Nếu không cung cấp, mặc định gán `teamId = 'default'`.
   - Hàm `broadcast(type, data, filterTeamId)` trên Backend **bắt buộc** phải chuyển thành Strict Team Filter: Sự kiện của team nào CHỈ được đẩy về WebSocket client của team đó.
2. **Database Query Level Isolation (`chat.jsonl` Query Filter):**
   - Bổ sung trường `teamId` làm thuộc tính **BẮT BUỘC (Required Field)** trong schema `ChatMsg`.
   - API REST `/api/history?teamId=XYZ` sẽ thực hiện filter dòng dữ liệu ngay từ đĩa/in-memory index trước khi trả về JSON cho Frontend.
3. **Payload Chuẩn Hóa 100% (Standardized Event Payload):**
   - Mọi bản tin `chat:message`, `chat:chunk`, `chat:tool_call` do Backend phát ra BẮT BUỘC chứa cặp thuộc tính duy nhất:
     ```typescript
     {
       clientMsgId: "uuid-v4",  // Đảm bảo dedup
       teamId: "team-aba40d4f", // Đảm bảo cô lập team
       // ...
     }
     ```
4. **Đơn Giản Hóa Bộ Lọc Frontend (Lightweight Frontend Render):**
   - Frontend loại bỏ hoàn toàn các hàm đoán `msgTeamId` cảm tính và các dòng code điều kiện phức tạp dài hàng trăm dòng trong `filteredMessages`.
   - Frontend chỉ làm nhiệm vụ duy nhất: Hiển thị đúng những gì Backend đẩy về cho team hiện tại.
   - Sửa dứt điểm cờ `isIncomingToOrch` / `effectiveShowToolBlocks` ở `ChatPanel.tsx` để luôn luôn render `toolCalls` bất kể sender là sub-orchestrator hay worker.

---

## 4. Bảng Tổng Hợp So Sánh Kiến Trúc v7 vs v8

| Tiêu chí | Kiến Trúc v7 (Hiện tại) | Kiến Trúc v8 (Đề xuất) |
|----------|-------------------------|------------------------|
| **Cơ chế Dedup** | 4-5 tầng hỗn hợp (content regex, 5s/120s/300s window) | Single Ingestion Point, O(1) Map Dedup qua **Canonical UUID** |
| **Team Isolation** | Frontend tự đoán & tự filter tin nhắn cross-team | Backend cô lập 100% tại WS Gateway & History DB Query |
| **Optimistic Push** | Không đồng nhất ID (sinh `force-*` / `temp-*` gây lặp) | Client gán `clientMsgId` chuẩn ngay từ đầu, Server giữ nguyên ID |
| **Hiển Thị Tool Call** | Dễ bị drop bởi filter sub-orch & cờ `isIncomingToOrch` | Structured `parts` & `toolCalls` render bất biến theo `teamId` |
| **Độ Phức Tạp Code** | Rất cao (>500 dòng logic filter rải rác ở Frontend) | Rất thấp (Frontend chỉ render data từ Backend) |

---

*Tài liệu hoàn tất: `docs/v8-routes-research.md`*
*Đã bao gồm đầy đủ 3 phần nghiên cứu:*
- **ROUTE-RESEARCH-1:** Message Flow Mapping (Mục 1)
- **ROUTE-RESEARCH-2:** Unified Dedup Strategy (Mục 2)
- **ROUTE-RESEARCH-3:** Team Isolation Redesign (Mục 3 & 4)