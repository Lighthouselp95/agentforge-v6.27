# Các loại định dạng JSON & biến thể — Tài liệu tổng hợp

> Ngày: 2026-09-08
> Tác giả: Orchestrator-5182 (agent-f4a57460)
> Mục đích: Tổng hợp các loại JSON/định dạng liên quan, cú pháp, ứng dụng

---

## 1. JSON chuẩn (Standard JSON)

- **Chuẩn:** RFC 8259 (trước đó RFC 7159, RFC 4627)
- **MIME type:** `application/json`
- **Đặc điểm:**
  - Chỉ hỗ trợ 6 kiểu dữ liệu: `object`, `array`, `string`, `number`, `boolean`, `null`
  - **KHÔNG được phép comment**
  - **KHÔNG được phép trailing comma**
  - **KHÔNG được phép viết hoa/khác boolean** (chỉ `true`/`false`)
  - String bắt buộc dùng `"..."` (không dùng `'...'`)
  - Phải hợp lệ toàn bộ mới parse được (parse 1 lần cả document)

```json
{
  "name": "AgentForge",
  "version": "7.0.57",
  "active": true,
  "ports": [4001, 8765],
  "config": null
}
```

---

## 2. JSON Lines / NDJSON (Newline-Delimited JSON)

- **Còn gọi:** JSONL, `.jsonl`, NDJSON
- **MIME type:** `application/x-ndjson` (chưa chuẩn hóa chính thức, thường `application/jsonl`)
- **Đặc điểm:**
  - **Mỗi dòng = 1 JSON object/giá trị hợp lệ riêng biệt**
  - Phân cách bằng `\n` hoặc `\r\n`
  - **KHÔNG có mảng bọc ngoài**, không dấu `,` nối
  - Trong 1 dòng KHÔNG được xuống dòng thật (phải escape `\n`)
  - **Stream-friendly**: parse từng dòng ngay khi nhận được
- **Ứng dụng:** log, event streaming, **opencode stdout JSONL** (AgentForge parse `handleStdoutStream`), BigQuery export, Datadog logs

```json
{"kind": "text", "content": "Xin chào"}
{"kind": "tool_use", "name": "bash", "input": {"cmd": "ls"}}
{"kind": "step_finish", "type": "done"}
```

---

## 3. JSONC (JSON with Comments)

- **Đặc điểm:** = JSON chuẩn nhưng **cho phép comment** `//` và `/* ... */`, thường có **trailing comma**
- **MIME type:** `application/jsonc` (đề xuất), thực tế nhiều tool dùng `.jsonc`
- **Ứng dụng:** file cấu hình (VS Code `settings.json` mặc định hỗ trợ JSONC, `tsconfig.json` — thực tế là JSON strict nhưng nhiều editors cho phép comment; launch.json...)

```jsonc
{
  // Đây là comment dòng
  "name": "app", /* comment khối */
  "debug": true,
  "env": "dev", // trailing comma được phép
}
```

---

## 4. JSON5 (JSON for Humans)

- **Chuẩn đề xuất:** `json5.org`
- **Mở rộng JSON gồm:**
  - Comment `//` và `/* */`
  - Trailing comma
  - **Keys không cần quotes** (`{ name: "x" }`)
  - String dùng được `'...'` hoặc `"..."`
  - Hỗ trợ số hex `0xFF`, số vô hạn `Infinity`, `NaN`, số `+1`, `.5`
  - Multiline string
- **MIME type:** `application/json5`
- **Ứng dụng:** file cấu hình humans-viết dễ đọc hơn (Babel config từng dùng, ...)

```json5
{
  name: 'AgentForge',        // key không quotes, string dùng nháy đơn
  version: 7.0,              // số không cần string
  active: true,
  ports: [4001, 8765,],      // trailing comma
  // có comment
}
```

---

## 5. JSONP (JSON with Padding)

- **Đặc điểm:** JSON được bọc trong 1 function call JavaScript — tải qua `<script>` để **vượt CORS** (kiểu cũ)
- **KHÔNG phải chuẩn JSON thuần** — là kỹ thuật tránh same-origin policy trước thời CORS
- **Bảo mật:** dễ bị lạm dụng; token/api key không nên qua JSONP

```javascript
callback({
  "name": "AgentForge",
  "version": "7.0.57"
});
```

---

## 6. JSONP / JSON-Patch (RFC 6902)

- **JSON Patch:** định dạng mô tả **thao tác thay đổi** tài liệu JSON: `add`, `remove`, `replace`, `move`, `copy`, `test`
- **MIME type:** `application/json-patch+json`
- **Ứng dụng:** API PATCH (vd: CouchDB, JSON Merge Patch RFC 7396)

```json
[
  { "op": "replace", "path": "/version", "value": "7.0.58" },
  { "op": "add", "path": "/features/-", "value": "SSE" }
]
```

---

## 7. JSON Schema

- **Đặc điểm:** KHÔNG phải dữ liệu — mà là **ngôn ngữ mô tả cấu trúc/validate** tài liệu JSON
- **Chuẩn:** `json-schema.org`, draft 2020-12
- **Ứng dụng:** validate request/response API, generate form/docs/code, OpenAPI

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "name": { "type": "string", "minLength": 1 },
    "version": { "type": "string" },
    "active": { "type": "boolean" }
  },
  "required": ["name"]
}
```

---

## 8. JSON-LD (Linked Data)

- **JSON for Linking Data** — biểu diễn **dữ liệu liên kết (linked data / semantics)**
- **MIME type:** `application/ld+json`
- **Đặc điểm:** gắn `@context`, `@type`, `@id` để máy hiểu ý nghĩa dữ liệu
- **Ứng dụng:** SEO structured data (schema.org), Knowledge Graph, RDF/Web Semantics

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "AgentForge",
  "version": "7.0.57"
}
```

---

## 9. GeoJSON

- **Chuẩn:** RFC 7946 — JSON cho dữ liệu địa lý
- **MIME type:** `application/geo+json`
- **Kiểu:** Point, LineString, Polygon, MultiPoint, ..., Feature, FeatureCollection

```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "properties": { "name": "Hà Nội" },
    "geometry": { "type": "Point", "coordinates": [105.85, 21.03] }
  }]
}
```

---

## 10. JSON Object trên các định dạng serialize khác (KHÔNG phải JSON text thuần)

Các định dạng **kế thừa ý tưởng JSON** nhưng encode binary (tốc độ/kích thước):

| Định dạng | Bản chất | MIME | Ứng dụng |
|---|---|---|---|
| **BSON** | JSON-like encode binary (MongoDB) | `application/bson` | MongoDB, Mongo GridFS |
| **MessagePack** | Binary serialization nhỏ nhanh | `application/msgpack` | Redis, gRPC payload, cache |
| **CBOR (RFC 8949)** | Binary giống JSON, có type tag | `application/cbor` | IoT (COSE), WebAuthn, wasm |
| **UBJSON** | Universal Binary JSON | `application/ubjson` | Trao đổi dữ liệu binary |
| **Smile** | Binary JSON của Jackson (Java) | — | Hệ thống Java/JVM |
| **YAML** | Superset của JSON (con người đọc dễ) | `application/yaml` | Config Kubernetes/Docker/Ansible |
| **TOML** | Config đơn giản (không phải JSON) | `application/toml` | Config hiện đại (Cargo, pyproject) |

---

## 11. Bảng tổng hợp nhanh

| # | Loại | Comment? | Trailing comma? | Streaming? | Ứng dụng chính |
|---|---|---|---|---|---|
| 1 | JSON chuẩn | ❌ | ❌ | ❌ (parse cả doc) | API, dữ liệu web |
| 2 | NDJSON/JSONL | ❌ | ❌ | ✅ | Log, event stream, opencode stdout |
| 3 | JSONC | ✅ | ✅ | ❌ | File cấu hình editor |
| 4 | JSON5 | ✅ | ✅ | ❌ | Config humans-friendly |
| 5 | JSONP | — | — | — | Cross-domain kiểu cũ |
| 6 | JSON Patch | — | — | — | API PATCH |
| 7 | JSON Schema | — | — | — | Validate/cấu trúc |
| 8 | JSON-LD | ❌ | ❌ | ❌ | Linked data / SEO |
| 9 | GeoJSON | ❌ | ❌ | ❌ | Dữ liệu địa lý |
| 10 | BSON/MsgPack/CBOR... | Binary | — | ✅ | Hiệu năng, storage |

---

## 12. Liên hệ thực tế với AgentForge

- **opencode → AgentForge:** `--format json` = **NDJSON/JSONL** trên stdout (mỗi dòng 1 event)
- **AgentForge → UI:** tái phát qua **SSE** (`/api/events`) — dữ liệu payload là JSON thuần trong `data:` dòng
- **opencode core → LLM:** HTTP stream (**SSE/NDJSON**) qua Vercel AI SDK
- **Config AgentForge:** `config.json` / settings = JSON thuần (hoặc JSONC nếu có comment)

---

## 13. Chuẩn/URL tham khảo

1. JSON: RFC 8259 — https://datatracker.ietf.org/doc/html/rfc8259
2. NDJSON: http://ndjson.org
3. JSON Lines: https://jsonlines.org
4. JSON5: https://json5.org
5. JSONC: https://code.visualstudio.com/docs/languages/json (json.schemas)
6. JSON Patch: RFC 6902 — https://datatracker.ietf.org/doc/html/rfc6902
7. JSON Schema: https://json-schema.org
8. JSON-LD: https://json-ld.org
9. GeoJSON: RFC 7946 — https://datatracker.ietf.org/doc/html/rfc7946
10. BSON: https://bsonspec.org
11. MessagePack: https://msgpack.org
12. CBOR: RFC 8949 — https://datatracker.ietf.org/doc/html/rfc8949
13. Vercel AI SDK: https://ai-sdk.dev