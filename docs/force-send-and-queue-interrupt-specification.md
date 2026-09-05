# ĐẶC TẢ TÍNH NĂNG: NÚT GỬI NGAY (INTERRUPT & FORCE DISPATCH)
**AgentForge UX & Engine Specification: Single-Message Interrupt & Batch Queue Flush**  
*Ngày thiết kế: 04/09/2026*

---

## 1. TỔNG QUAN & MỤC TIÊU THIẾT KẾ

Chuyển đổi hoàn toàn cơ chế `inject` từ trạng thái "nạp ngầm im lặng vào SQLite" (nguy cơ nuốt tin/treo tiến trình) thành **Cơ chế Can thiệp Chủ động (Interrupt & Steer)** dưới sự điều khiển trực tiếp của người dùng.

### Hai loại nút thao tác trên UI:
1. **Nút "Gửi ngay" Đơn Tin (Single-Message Force Send)**:
   - Xuất hiện trên từng bubble tin nhắn đang ở trạng thái chờ `[QUEUED]`.
   - Mục đích: Ngắt ngay tiến trình đang chạy của Agent đích và ưu tiên thực thi duy nhất tin nhắn này lập tức.
2. **Nút "Gửi ngay Toàn Bộ" (Batch Queue Flush)**:
   - Xuất hiện trên banner thông báo hàng đợi khi có $\ge 2$ tin nhắn đang chờ.
   - Mục đích: Ngắt tiến trình cũ, tự động gộp (merge) toàn bộ các tin nhắn trong hàng đợi thành một ngữ cảnh chỉ đạo thống nhất và spawn lượt thực thi mới ngay lập tức.

---

## 2. LUỒNG XỬ LÝ KỸ THUẬT (EXECUTION FLOW)

```
[User Click "GỬI NGAY"]
          │
          ▼
1. Frontend UI:
   ├── Đánh dấu tin nhắn chuyển từ [QUEUED] ➔ [DISPATCHING]
   └── Gửi API POST /api/chat/force-send { targetAgentId, messageId?, mode: 'single' | 'all' }
          │
          ▼
2. Backend Server (dispatchUserChat with forceInterrupt=true):
   ├── Bước 2.1: Lấy `client` của target agent
   ├── Bước 2.2: Gọi `await client.abort()`
   │              └── Kill chính xác cây PID đang chạy (taskkill /pid ${pid} /T /F)
   │              └── Giải phóng cờ this.busy = false, this.proc = null
   ├── Bước 2.3: Reset buffer stream & dọn sạch lượt dở dang
   ├── Bước 2.4: Trích xuất Prompt cần gửi:
   │              • Mode 'single': Lấy đúng nội dung của tin nhắn được chọn
   │              • Mode 'all': Gộp toàn bộ queue qua `combineBatchPrompts()`
   ├── Bước 2.5: Gọi `client.enqueue(prompt)`
   │              └── Do proc đã giải phóng, lệnh chạy ngay `runQueued(prompt)`
   │              └── Spawn process OpenCode mới lập tức
   └── Bước 2.6: Mở pipeline stream realtime (chat:chunk, chat:thinking) ra UI
```

---

## 3. THIẾT KẾ GIAO DIỆN NGƯỜI DÙNG (UI/UX)

### 3.1 Nút "Gửi ngay" trên Bubble đơn lẻ (`ChatPanel.tsx`):
- Khi tin nhắn có cờ `isQueued` (hoặc nằm trong `agentQueues`):
  ```tsx
  <div className="queue-action-bar" style={{ display: 'flex', gap: 6, marginTop: 4 }}>
    <span style={{ fontSize: 11, color: '#f59e0b' }}>⏳ Đang chờ agent rảnh...</span>
    <button
      onClick={() => handleForceSendSingle(msg.id)}
      style={{
        background: '#ef4444',
        color: '#fff',
        border: 'none',
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 11,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4
      }}
    >
      ⚡ Gửi ngay (Ngắt lượt cũ)
    </button>
  </div>
  ```

### 3.2 Banner "Gửi ngay Toàn Bộ" (`ChatPanel.tsx` / `App.tsx`):
- Hiển thị ở trên thanh input chat khi `agentQueues[targetId]?.length > 0`:
  ```tsx
  {pendingCount > 0 && (
    <div className="queue-banner" style={{
      background: 'rgba(30, 41, 59, 0.95)',
      border: '1px solid #3b82f6',
      padding: '6px 12px',
      borderRadius: 8,
      marginBottom: 6,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <span style={{ fontSize: 12, color: '#93c5fd' }}>
        📥 Đang có <b>{pendingCount}</b> tin nhắn trong hàng đợi
      </span>
      <button
        onClick={() => handleForceSendAll(targetId)}
        style={{
          background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          padding: '4px 12px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer'
        }}
      >
        🚀 Gửi ngay toàn bộ ({pendingCount})
      </button>
    </div>
  )}
  ```

---

## 4. THIẾT KẾ BACKEND API (`src/server.ts`)

### Endpoint: `POST /api/chat/force-send`
- **Request Body**:
  ```json
  {
    "targetAgentId": "orchestrator",
    "mode": "single",
    "messageId": "temp-172543...",
    "content": "Sửa lại hàm X ngay lập tức"
  }
  ```
- **Xử lý**:
  1. Abort tiến trình hiện tại của `targetAgentId`.
  2. Bỏ qua hàng đợi chờ, spawn tiến trình OpenCode mới với nội dung yêu cầu.
  3. Trả về `{ ok: true, abortedPrev: true, newSessionId: sid }`.

---

## 5. LỢI ÍCH KIẾN TRÚC

1. **Triệt tiêu hoàn toàn zombie process**: Mỗi khi người dùng bấm "Gửi ngay", tiến trình cũ được dọn sạch trước khi spawn tiến trình mới, không bao giờ có 2 tiến trình cùng tranh chấp 1 session SQLite.
2. **Quyền kiểm soát 100% thuộc về User**: Người dùng không bị ức chế vì AI làm sai mà vẫn phải ngồi chờ nó gõ xong mới được sửa.
3. **Bảo toàn dữ liệu**: Nội dung cũ vẫn lưu trong lịch sử chat dưới dạng `[Cancelled by User]`, không bị biến mất vào hư vô.
