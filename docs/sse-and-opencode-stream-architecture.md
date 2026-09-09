# SSE & Bản chất Stream của OpenCode — Tài liệu Kiến trúc

> Ngày: 2026-09-08
> Tác giả: Orchestrator-5182 (agent-f4a57460)
> Nguồn: Điều tra song song `res-codebase` (đọc mã nguồn) + `src-uac` (tra cứu tài liệu opencode.ai / ACP / ai-sdk.dev / GitHub)
> Liên quan: CHANGELOG-MAXLISTENERS-DISCONNECT.md (sự cố disconnect/stream)

---

## 1. Giao thức SSE là gì?

**SSE (Server-Sent Events)** — giao thức đẩy dữ liệu **một chiều** (server → client) qua HTTP.

| Tiêu chí | SSE | WebSocket |
|---|---|---|
| Hướng truyền | 1 chiều (server → client) | 2 chiều (client ⇄ server) |
| Giao thức | HTTP thuần (`Content-Type: text/event-stream`, keep-alive) | Nâng cấp HTTP `Upgrade` → frame WS |
| Tự reconnect | Có sẵn (EventSource tự reconnect) | Phải tự code |
| Format message | Text `data: JSON\n\n`, hỗ trợ `: keepalive` | Text hoặc Binary |
| Ứng dụng | Push log, notification, stream 1 chiều | Chat realtime, game, 2 chiều |

---

## 2. HAI KẾT NỐI RIÊNG BIỆT (trả lời câu hỏi user)

Hệ thống AgentForge có **2 luồng kết nối độc lập**:

### KẾT NỐI ①: Core opencode → LLM (internet/localhost)

| Câu hỏi | Trả lời |
|---|---|
| Giao thức | **HTTP fetch streaming (SSE/NDJSON qua HTTPS)** qua **Vercel AI SDK** (`ai-sdk.dev`). KHÔNG phải WebSocket, không phải JSON-RPC |
| Stream token | ✅ CÓ — AI SDK nhận stream chunks (text/reasoning/tool-call) từ provider API → emit vào core agent loop |
| Provider | 75+ qua Models.dev: openai, anthropic, gemini, google-vertex, azure-openai, amazon-bedrock, groq, openrouter, ollama, lmstudio, llama.cpp, deepseek, mistral, together-ai, fireworks, huggingface, xai(Grok), github-copilot, v.v. |
| baseURL tùy chỉnh | ✅ CÓ — `{ "provider": { "anthropic": { "options": { "baseURL": "..." } } } }`; custom provider dùng `npm: "@ai-sdk/openai-compatible"` (gắn được localhost Ollama/LM Studio) |
| Nơi thực hiện model call | **Trong process local của `opencode` core** (TUI hoặc `opencode serve`). Core agent loop chạy local, dùng AI SDK HTTP fetch trực tiếp tới provider API. Model call KHÔNG đi qua ACP/stdio |

### KẾT NỐI ②: AgentForge → opencode

| Câu hỏi | Trả lời | Bằng chứng |
|---|---|---|
| Mode mặc định | `attach` — subprocess CLI stdio | `src/server.ts:19-31` |
| Cú pháp | `opencode run --attach <serverUrl> --dir <dir> --agent <a> --thinking --model <m> --auto --format json` | `src/agents/opencode-serve-client.ts:373-441,449` |
| Mỗi turn | **Spawn subprocess MỚI mỗi turn**; session giữ bằng `--session <id>`; process đóng khi stdout end | L364-369, L414-417, L496 |
| Truyền model | ✅ CÓ — cờ `--model "<model>"` (mặc định nếu không đặt: `antigravity/gemini-3.7-flash-high`) | L406-417 |
| Dùng SSE? | ❌ **KHÔNG** — kênh stdin/stdout (JSONL) | toàn file |
| Mode http (tùy chọn) | `POST /session/{id}/message` → `await res.json()` (1-shot) | L545-627 |

---

## 3. Pipeline stream đầy đủ khi OpenCode chạy

```
[AgentForge Web App]
       │ ② subprocess stdio: opencode run --attach --dir <dir> --model <m> --format json
       │    (MỖI TURN spawn mới; stdin=prompt, stdout=JSONL dòng-by-dòng)
       ▼
[opencode core]  ←─────────────────────────┐
       │ ① HTTP fetch (Vercel AI SDK)        │
       │   SSE/NDJSON streaming token        │
       ▼                                     │
[LLM Provider API]  (OpenAI/Anthropic/Gemini/Ollama...) ─┘
```

Pipeline JSONL trong AgentForge (attach mode):
```
opencode run --attach <serverUrl> ...          (subprocess, mỗi turn 1 cái)
   └─ stdout JSONL (text / thinking / tool_use / tool_result / step_finish)
        └─ OpenCodeServeClient.handleStdoutStream()  → pushOACEvent({kind:'out', event})
             └─ setOnEvent(cb)                        → server.ts:1913 broadcastOACEvent(agent.id, ev)
                  └─ server.ts:1566 broadcastOACEvent():
                       ├─ set agent.status='working'              (server.ts:1585-1593)
                       ├─ watchdogManager.onStreamActivity(agentId) (server.ts:1596)
                       ├─ filter step_start/step_finish, tách tool_call/text
                       └─ broadcast('stream:chunk' / 'agent:updated')
                            └─ WS + SSE ("/api/events")          → UI mobile
```

---

## 4. SSE xuất hiện ở đâu trong hệ thống?

| Lớp | Loại | Endpoint | Bằng chứng |
|---|---|---|---|
| AgentForge ↔ opencode | ❌ KHÔNG (stdio subprocess / HTTP POST) | — | opencode-serve-client.ts |
| opencode core → LLM provider | ✅ HTTP stream (SSE/NDJSON) | provider API endpoint | AI SDK / docs/providers |
| opencode server → client SDK (internal) | ✅ SSE event bus | `/event`, `/global/event` | opencode.ai/docs/server |
| AgentForge server → UI | ✅ SSE | `/api/events`, `/events` (keepalive 15s) | server.ts:5415-5457 |

---

## 5. Trả lời giả thuyết của User (lần 1)

> **Giả thuyết:** "Bản chất thực sự khi opencode stream là bên trong nó gửi nhiều lượt request HTTP SSE chứ không phải 1 stream liên tục — mỗi lượt run = 1 request SSE mở-đóng riêng."

| Ý trong giả thuyết | Đúng/Sai | Bằng chứng |
|---|---|---|
| "Mỗi lượt chạy là kênh/request RIÊNG, mở-đóng theo lượt" | ✅ **ĐÚNG** (cho AgentForge) | `executeTurn()` (L364-369): mỗi turn = 1 subprocess `runAttachCli` mới |
| "KHÔNG có 1 stream liên tục duy nhất cho toàn bộ phiên" | ✅ **ĐÚNG** (cho AgentForge) | Mỗi turn spawn/close; session logic giữ qua `--session` |
| "Kênh đó là SSE" (AgentForge ↔ OpenCode) | ❌ **CHƯA CHÍNH XÁC** | Lớp này là stdio JSONL (attach) hoặc HTTP POST (http mode) |
| "OpenCode upstream dùng SSE nội bộ" | ✅ **ĐÚNG (upstream)** | `/event` + `/global/event` SSE bus; `/session/:id/prompt_async` trả 204 rồi push qua SSE |

---

## 6. Nguyên nhân "disconnect sau một lúc" (MaxListenersExceededWarning)

- SSE connection dài dễ **idle/timeout** nếu thiếu heartbeat/keepalive.
- **Listener leak** → `MaxListenersExceededWarning` (log user: "11 event listeners added to [yZ]").
- Proxy / load-balancer ngắt connection không hoạt động âm thầm.
- Đã xử lý trong AgentForge: heartbeat 45s (ws-service), `removeAllListeners()` trong `endStream()`, singleton `AgentStatusManager` (watchdog).

---

## 7. Nguồn tham khảo

1. `src/server.ts` (AgentForge) — L19-31 (engine mode), L1566 (broadcastOACEvent), L1913, L5415-5457 (SSE handler)
2. `src/agents/opencode-serve-client.ts` — L364-369 (executeTurn), L373-441 (runAttachCli), L406-417 (--model), L414-417 (--session), L449 (spawn), L496 (close), L545-627 (runHttp), L632-645 (handleStdoutStream)
3. https://opencode.ai/docs/providers/ — 75+ providers, baseURL, custom provider `@ai-sdk/openai-compatible`
4. https://opencode.ai/docs/models/ — model selection, variants, loading priority
5. https://opencode.ai/docs/server/ — `/event` SSE stream, `prompt_async`, architecture TUI=client/server=core
6. https://opencode.ai/docs/sdk/ — `event.subscribe()` SSE
7. https://opencode.ai/docs/acp/ — `opencode acp` (JSON-RPC over stdio)
8. https://agentclientprotocol.com — ACP: local = JSON-RPC over stdio, remote = HTTP/WebSocket
9. https://ai-sdk.dev/ — Vercel AI SDK: HTTP fetch streaming, OpenAI-compatible adapters
10. https://github.com/sst/opencode (nay anomalyco/opencode)