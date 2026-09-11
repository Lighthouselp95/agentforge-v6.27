# CHANGELOG — OpenCode Serve Dynamic Spawner + Team Isolation Fixes

**Ngày:** 2026-09-09
**Agent:** relay-fix (agent-6496905a, coder)
**Branch:** refactor/backend-v8

---

## 1. OpenCode Serve Dynamic Spawner (`src/process/opencode-spawner.ts`)

Thay thế spawner tĩnh (spawn 1 lần rồi bỏ) bằng spawner **động** với vòng đời quản lý đầy đủ:

### Tính năng mới
| Tính năng | Chi tiết |
|-----------|----------|
| **Auto-restart** | Khi `opencode serve` exit bất thường (code ≠ 0), tự spawn lại tối đa 5 lần, backoff lũy tiến 2s→4s→8s→16s→32s (cap 60s) |
| **Health monitor** | Poll `/global/health` mỗi 30s; 2 lần thất bại liên tiếp → force kill + auto-restart |
| **Graceful shutdown** | `killOpenCodeServer()` set cờ `isShuttingDown`, tắt health monitor, disable auto-restart, taskkill /T |
| **Force-kill restart path** | `forceKillForRestart()` kill process KHÔNG set `isShuttingDown` (chỉ dùng khi health check trigger restart) |
| **Status API** | `getOpenCodeServerStatus()` + endpoint `GET /api/opencode-status` trả `{ running, port, url, restartCount, pid }` |
| **REUSE-FIRST adopt** | Trước khi spawn mới, probe các URL đang cấu hình (env `OPENCODE_SERVE_URL` → storage `opencodeServeUrl`/`serveUrl` → default `http://127.0.0.1:4096`); nếu có serve healthy → **ADOPT** (không spawn trùng) |
| **Persist URL động** | `persistServeUrl()` ghi URL cấu hình (`opencodeServeUrl` + `serveUrl`) vào storage sau khi adopt/spawn → `createAgentClient` dùng ĐÚNG port động (storage ưu tiên hơn env) |
| **Adopted-state awareness** | `adoptedServePort` tách biệt tiến trình bên ngoài vs tiến trình tự manage; health monitor/và `killOpenCodeServer()` không kill serve adopt (không thuộc quyền sở hữu); health fail 2 lần ở adopted → bỏ adopt + spawn riêng |

### Chống double-spawn
- Exit handler chỉ clear reference khi `opencodeProcess === proc` (không clobber process mới).
- Auto-restart từ exit handler có guard `!opencodeProcess` — health monitor KHÔNG tự gọi `ensureOpenCodeServer()`, chỉ kill; exit handler là nguồn restart duy nhất → tránh sinh 2 tiến trình song song.

### Xuất export
- `src/process/index.ts` thêm `export * from './opencode-spawner.js'`.

---

## 2. Team Isolation Fixes (từ research `docs/v8-routes-research.md` §3.2)

### 2a. Sub-Orchestrator ToolCall Drop Bug (§3.2.4) — `web/src/components/ChatPanel.tsx`
- **Trước:** `effectiveShowToolBlocks = showToolBlocks && !isIncomingToOrch` → khi xem tab Orchestrator/Sub-Orch, toolCalls của worker bị ẩn hoàn toàn.
- **Sau:** `effectiveShowToolBlocks = showToolBlocks` — toolCalls LUÔN hiển thị bất kể `isIncomingToOrch`. Cờ `isIncomingToOrch` chỉ còn ảnh hưởng header styling (`isWorkerReportToOrch`), không ảnh hưởng render toolCall.

### 2b. WebSocket Broadcast Filter Leak (§3.2.1) — `src/ws/ws-service.ts`
- **Trước:** nếu `filterTeamId` không truyền → broadcast tới TẤT CẢ client mọi team.
- **Sau:** resolve `effectiveTeamId` từ `filterTeamId > data.teamId > data.msg.teamId > data.agent.teamId`; event KHÔNG có teamId → chặn (trừ system events global). Semantics khớp `broadcast()` trong `server.ts` line 841: client team-specific chỉ nhận event đúng team; client `default`/`all` = supervisor nhận toàn bộ.

### 2c. History API Cross-Team Leak (§3.2.2) — `src/routes/chat.ts`
- `GET /api/messages` — **Trước:** không truyền `?teamId=` → trả toàn bộ `chatHistory` (trộn lẫn mọi team). **Sau:** mặc định lọc về `'default'` khi thiếu `teamId` — CHỈ trả tin thuộc team yêu cầu, không còn leak cross-team.
- `GET /api/history` — **Trước:** không truyền `teamId`/`agentId` → `teamFilter = undefined` → trả history toàn bộ mọi team (DB cross-team leak). **Sau:** khi không có `teamId` lẫn `agentId`, mặc định `teamFilter = 'default'` — backend ép team luôn, không phụ thuộc client.

---

## 3. Endpoint mới

### `GET /api/opencode-status`
- `src/routes/system.ts`: thêm route trả trạng thái live của OpenCode serve.
- `src/server.ts`: wire `getOpenCodeStatus: () => getOpenCodeServerStatus()` vào `createApiRouter` system deps.

---

## 4. Kiểm thử

- Backend: `npx tsc --noEmit` → **EXIT 0** (sạch lỗi TypeScript).
- Frontend: `npx tsc --noEmit` → **EXIT 0**; `npm run build` (vite) → **built in ~2-3.65s, EXIT 0**.
- Toàn bộ `npm run build` (tsc + vite + tsc electron) → **EXIT 0**.
- **Empirical adopt test:** chạy spawner độc lập với serve 4096 đang healthy → log `🔁 Reusing existing healthy opencode serve at http://127.0.0.1:4096`, trả `{ port: 4096, url: "http://127.0.0.1:4096" }`, status `{ running: true, pid: null }`; sau `killOpenCodeServer()` serve 4096 VẪN sống (`{"healthy":true,"version":"1.18.25"}`) và KHÔNG spawn tiến trình trùng.

## 5. Files changed

```
src/process/opencode-spawner.ts   (dynamic spawner: auto-restart + health monitor + status + REUSE-FIRST adopt + persist URL)
src/process/index.ts              (export opencode-spawner)
src/ws/ws-service.ts              (team isolation WS broadcast — strict effectiveTeamId resolve)
src/routes/chat.ts                (GET /api/messages + GET /api/history strict team filter default 'default')
src/routes/system.ts              (GET /api/opencode-status)
src/server.ts                     (wire getOpenCodeServerStatus)
web/src/components/ChatPanel.tsx  (toolCall always visible)
```

---

## 6. Cập nhật bổ sung (session relay-fix #2)

**Ngày:** 2026-09-11

### 6a. Electron dynamic OpenCode Serve spawn — `src/electron/main.ts`
- Thêm `spawnOpenCodeServe()`: tự chọn cổng trống bằng `findFreePort()`, spawn `opencode serve --hostname 0.0.0.0 --port <free>`, set `process.env.OPENCODE_SERVE_PORT` + `OPENCODE_SERVE_URL`, chờ serve sẵn sàng (`waitForServer`).
- Gọi ngay đầu `app.on('ready')` trước `ensureServerRunning()`.
- Cleanup: `cleanup()` kill opencode serve (taskkill /T trên Windows, SIGTERM+SIGKILL fallback); `app.on('before-quit')` + `window-all-closed` → dọn cả `opencodeServeProcess` lẫn `serverProcess`.
- IPC mới: `get-opencode-serve-port` trả cổng động.

### 6b. Broadcast signature với teamId — relay type safety
- `src/relay/types.ts`: `RelayContext.broadcast` → `(type, data, teamId?)`.
- `src/relay/outbox-dispatcher.ts`: `OutboxDispatcherOptions.broadcast` nhận `teamId?`; hoist `const teamId = targetAgent.teamId || 'default'` lên đầu để dùng cho MỌI `agent:updated` (kể cả lúc set status/session); bỏ broadcast thiếu team → tránh bị `broadcast()` chặn do thiếu teamId (leak fix).
- `src/relay/router.ts`: `RouterOptions.broadcast` nhận `teamId?`.
- `src/relay/broadcast-bus.ts`: `BroadcastHandler` + `BroadcastBus.broadcast(type, data, teamId?)`; custom listeners nhận `broadcastTeamId`; bảo toàn filter WS/SSE theo team.

### 6c. Orchestrator talk ẩn UI — `src/server.ts` (talkMsg)
- `showOnUI: true` → `showOnUI: false` cho `talkMsg` orchestrator→agent. Agent VẪN nhận nội dung qua `tc.enqueue(talkPrompt)`; chỉ KHÔNG hiện bubble trên UI người nhận.

### 6d. Live stream chunk-by-chunk
- `src/server.ts` (`broadcastOACEvent`): `chat:chunk` giờ tách `textDelta` thành **từng ký tự** (`Array.from(rawPart)`) — không còn gói thành block lớn; `dispatchTextBuf` vẫn accumulate đủ để scan + snapshot WAL.
- `src/agents/stream-controller.ts` (`emitChunk`): payload `kind=text` tách từng ký tự; non-text (thinking/tool/metadata) gửi nguyên chunk.

### 6e. Null-safety & type fixes
- `src/server.ts`: `taskQueueManager?.cancelIdle(target.id)` (tránh TS18047 possibly-null).
- `src/agents/opencode-serve-client.ts`: constructor resolve serverUrl theo `options → env OPENCODE_SERVE_URL → storage opencodeServeUrl → default`.

### 6f. Kiểm thử
- `npx tsc --noEmit` → **EXIT 0**
- `npx tsc -p tsconfig.electron.json --noEmit` → **EXIT 0**
- `npx vite build --config web/vite.config.ts` → **built in ~6-14s, EXIT 0**