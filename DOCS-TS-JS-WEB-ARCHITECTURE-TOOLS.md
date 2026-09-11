# CẨM NANG CÔNG CỤ QUẢN LÝ DỰ ÁN TYPESCRIPT/JAVASCRIPT VÀ KIẾN TRÚC WEB SERVER

> **Tài liệu tổng hợp & Hướng dẫn thực chiến**  
> **Cập nhật:** Tháng 9/2026  
> **Môi trường ứng dụng:** Node.js, Bun, TypeScript, OpenCode AI, AgentForge Multi-Agent.

---

## 1. Bối cảnh & Vấn đề Cốt Lõi Khi Làm Việc Cùng AI Coding Agent

Khi phát triển các hệ thống Web Server bằng TypeScript/JavaScript với sự tham gia của AI Coding Agent (OpenCode, Claude Code, Cursor, AgentForge):
- **Phá vỡ kiến trúc (Architecture Drift)**: AI có xu hướng import chéo trực tiếp giữa các tầng (ví dụ: `controller` chọc thẳng vào `repository`, hoặc `model` gọi ngược `router`).
- **Phụ thuộc vòng (Circular Dependencies)**: Rất dễ phát sinh các vòng lặp import (`A -> B -> C -> A`), gây lỗi crash khó debug hoặc rò rỉ bộ nhớ (memory leak) lúc runtime.
- **Rác mã nguồn & Thất thoát Token**: Xuất hiện nhiều type mồ côi, function thừa không ai dùng, làm phình context window của LLM.

Để giải quyết triệt để, hệ thống cần được trang bị các công cụ quản lý kiến trúc chuyên biệt dưới đây.

---

## 2. Nhóm 1: Kiểm Soát & Ràng Buộc Kiến Trúc Mã Nguồn (Architecture Linter & Graph)

### 2.1. `dependency-cruiser` — Đỉnh Cao Kiểm Soát Phụ Thuộc & Circular Dependencies
- **Mục tiêu**: Ràng buộc kiến trúc phân lớp (Clean Architecture / Hexagonal Architecture) bằng code, cấm các import vi phạm quy ước.
- **Tính năng nổi bật**:
  - Tự động phát hiện và chặn đứng 100% **Circular Dependencies**.
  - Định nghĩa luật kiểm tra chặt chẽ: `controllers` chỉ được gọi `services`, `services` chỉ được gọi `repositories`.
  - Xuất biểu đồ trực quan kiến trúc (Graphviz, Mermaid, HTML).
- **Cài đặt & Khởi tạo**:
  ```bash
  npm install -D dependency-cruiser
  npx depcruise --init
  ```
- **Chạy kiểm tra**:
  ```bash
  npx depcruise --config .dependency-cruiser.js src
  ```
- **Tích hợp vào `package.json`**:
  ```json
  "scripts": {
    "lint:arch": "depcruise --config .dependency-cruiser.js src"
  }
  ```

---

### 2.2. `knip` — Dọn Dẹp Code Thừa, Type Rác & Dependencies Mồ Côi
- **Mục tiêu**: Tối ưu hóa dự án sạch 100%, giảm tải token tối đa khi AI đọc codebase.
- **Tính năng nổi bật**:
  - Tìm file không được file nào import.
  - Tìm export functions, classes, interfaces, types bị bỏ quên.
  - Tìm các npm package khai báo trong `package.json` nhưng không sử dụng trong code.
- **Cài đặt & Sử dụng**:
  ```bash
  npm install -D knip
  npx knip
  ```

---

### 2.3. `ast-grep` (sg) — Tìm Kiếm & Refactor Theo Cây Cú Pháp (AST)
- **Mục tiêu**: Phân tích ngữ nghĩa mã nguồn thay cho Regex thuần túy.
- **Tính năng nổi bật**:
  - Tìm các đoạn code vi phạm mẫu thiết kế (ví dụ: route handler thiếu `try/catch` hoặc chưa bọc middleware xác thực).
  - Tốc độ cực nhanh (viết bằng Rust), hỗ trợ tốt cho cả người lẫn AI Agent khi thực hiện refactor quy mô lớn.
- **Sử dụng**:
  ```bash
  npx @ast-grep/cli scan
  ```

---

## 3. Nhóm 2: Tích Hợp Thẳng Vào OpenCode AI Agent

### 3.1. Kích Hoạt TypeScript LSP (Language Server Protocol)
- **Mục tiêu**: Trao cho AI Agent khả năng hiểu sâu kiểu dữ liệu mà không cần chạy `npm run build`.
- **Lợi ích**:
  - Agent tự nhảy tới định nghĩa gốc (`jump to definition`).
  - Tự kiểm tra type (`hover type`), tìm kiếm reference (`find references`).
  - Phát hiện lỗi compile TypeScript ngay khi vừa sửa code.
- **Cách kích hoạt trong OpenCode**:
  Mở file cấu hình `~/.config/opencode/opencode.jsonc` (hoặc `.opencode/opencode.jsonc`), chuyển:
  ```jsonc
  "lsp": true
  ```

---

### 3.2. Quản Lý Quyết Định Kiến Trúc Bằng ADR (Architecture Decision Records)
- **Mục tiêu**: Lưu vết các quyết định kỹ thuật vào thư mục dự án (ví dụ `docs/adr/0001-use-drizzle-orm.md`).
- **Lợi ích**:
  - AI Agent sẽ đọc các file ADR trước khi code, triệt tiêu nguy cơ đề xuất các giải pháp trái ngược với định hướng của dự án.
- **Công cụ hỗ trợ**:
  - Dùng CLI `adr-tools` hoặc tạo file markdown mẫu chuẩn:
    - **Status**: Accepted / Deprecated / Superseded.
    - **Context**: Vấn đề gặp phải.
    - **Decision**: Giải pháp đã chọn.
    - **Consequences**: Ưu điểm và nhược điểm.

---

### 3.3. Sprintra MCP (`@sprintra/cli`)
- **Mục tiêu**: Đồng bộ hóa kiến trúc, User Story và Sprint cho AI Agent qua chuẩn Model Context Protocol.
- **Tính năng**:
  - Quản lý ADR, Sprint, Feature Graph.
  - Giúp AI Agent tự định hình phạm vi công việc cần thực hiện tiếp theo (`sprintra next`).

---

### 3.4. Các Bộ Repository Skill & Agent Rules Nổi Bật Cho TypeScript

Bên cạnh LSP và MCP, việc nạp các **Skill (.md)** giúp định hướng và ép Agent tuân thủ các quy tắc viết code TypeScript nghiêm ngặt nhất:

1. **`everydaydevopsio/opencode-typescript-linting-agent`**:
   - **Repository**: [https://github.com/everydaydevopsio/opencode-typescript-linting-agent](https://github.com/everydaydevopsio/opencode-typescript-linting-agent)
   - **Đặc điểm**: Bộ skill & subagent chuyên trách audit chất lượng TypeScript, rà soát type-safety, bắt lỗi ép kiểu ngầm định và tối ưu hóa cấu hình `tsconfig.json`.

2. **`martinalmeida/playables-youtube-sdk`**:
   - **Repository**: [https://github.com/martinalmeida/playables-youtube-sdk](https://github.com/martinalmeida/playables-youtube-sdk)
   - **Đặc điểm**: Kho mẫu triển khai thực tế hệ thống skill cho AI Agent (Claude Code, OpenCode) chuyên sâu về TypeScript, tự động chạy test xác minh chứng chỉ (certification) và code generator.

3. **`@tarquinen/opencode-dcp` (Dynamic Context Pruning)**:
   - **Gói npm**: `@tarquinen/opencode-dcp`
   - **Đặc điểm**: Plugin cắt tỉa thông minh log build / typecheck dài hàng ngàn dòng của TypeScript compiler (`tsc`) và test runner, giúp tiết kiệm 40–60% token context window của Agent.

4. **Bộ Skill Cục Bộ: `.opencode/skills/typescript-standards/SKILL.md`**:
   - Tích hợp trực tiếp trong dự án tại `.opencode/skills/typescript-standards/SKILL.md`.
   - **Quy chuẩn bao hàm**:
     - Cấm triệt để `any`, bắt buộc dùng `unknown` + Type Narrowing.
     - Discriminated Unions cho quản lý State.
     - Chống Circular Dependency (`A -> B -> A`).
     - Tách biệt `import type` để tối ưu Tree-Shaking.
     - Bắt buộc Self-Verification Loop: tự chạy `npm run typecheck` trước khi báo hoàn thành.

5. **Bộ Skill Thiết Kế Backend: `.opencode/skills/backend-design-standards/SKILL.md`**:
   - Tích hợp các mẫu thiết kế chuẩn từ cộng đồng backend (kozz36/backend-architect, clean SSE, resilient WS).
   - Chống đệm SSE proxy (`X-Accel-Buffering: no`), chống rò rỉ bộ nhớ với `req.on('close')`.
   - Chu trình Ping-Pong diệt Dead Sockets, bọc an toàn `try/catch` cho toàn bộ payload WebSocket.

---

### 3.5. Bộ Công Cụ Tùy Chỉnh (Custom Tools) Trong `.opencode/tools/`

1. **`trace_ts_symbol_links.ts` (Call Graph & Cross-File Symbol Linker cho TypeScript)**:
   - Dựng khung xương kết nối giữa các hàm và biến xuyên suốt toàn bộ các file `.ts`/`.tsx` trong dự án.
   - Bóc tách quan hệ: Hàm A gọi Hàm B, Biến C được dùng trong Hàm D, Class E được khởi tạo ở File F.
   - Xuất sơ đồ luồng Mermaid Flowchart trực quan và bảng tra cứu dòng code chính xác.
2. **`inspect_api_endpoints.ts`**: Quét toàn bộ REST, SSE streams, WebSocket events.
3. **`inspect_db_schema.ts`**: Quét SQLite/JSON DB xuất Mermaid ERD.
4. **`zod_to_mermaid.ts`**: Quét TypeScript Interface/Zod Schema thành Mermaid diagram.
5. **`madge.ts`**: Quét đồ thị module, phát hiện circular imports (`A -> B -> A`).
6. **`depcruise.ts`**: Kiểm tra vi phạm phân tầng kiến trúc.

---

## 4. Nhóm 3: Kiến Trúc Web Server Hiện Đại & Type-Safe API

### 4.1. Type-Safe API Endpoints: Zod + OpenAPI / Scalar
- **Mô hình kiến trúc khuyến nghị**:
  - Fastify: `@fastify/type-provider-zod`
  - Hono: `@hono/zod-openapi` + `@scalar/hono-api-reference`
- **Lợi ích vượt trội**:
  - **Single Source of Truth**: Viết schema một lần bằng Zod, tự động có:
    1. Validation dữ liệu đầu vào / đầu ra runtime.
    2. Tự suy luận kiểu TypeScript tĩnh cho Backend và Frontend.
    3. Tự sinh tài liệu OpenAPI / Swagger UI / Scalar tương tác trực tiếp.

---

### 4.2. Database & Data Layer Architecture: Drizzle ORM
- **Mục tiêu**: Quản lý schema database bằng code TypeScript thuần, nhẹ và kiểm soát trực quan.
- **Công cụ**:
  - `drizzle-kit generate`: Tạo migration file.
  - `drizzle-kit studio`: Mở Web UI cục bộ xem sơ đồ quan hệ thực thể (ERD) và duyệt dữ liệu.
  ```bash
  npx drizzle-kit studio
  ```

---

## 5. Bảng So Sánh & Tổng Kết Khuyến Nghị

| Nhóm Công Cụ | Tên Công Cụ | Vai Trò Chính | Điểm Mạnh Nhất |
| :--- | :--- | :--- | :--- |
| **Code Architecture** | `dependency-cruiser` | Linter kiến trúc & phụ thuộc | Chặn đứng Circular Dependency & vi phạm tầng |
| **Code Hygiene** | `knip` | Quét dọn code & package thừa | Tiết kiệm token, giữ codebase tinh gọn |
| **Semantic Search** | `ast-grep` | Tìm kiếm & refactor theo AST | Nắm cấu trúc code vượt trội so với Regex |
| **AI Integration** | `OpenCode LSP (TS)` | Kiểm tra tĩnh cho Agent | Agent tự sửa lỗi type theo thời gian thực |
| **Project Context** | `ADR + Sprintra` | Quản lý quyết định & sprint | Chống drift kiến trúc khi làm việc dài hạn |
| **Web Server API** | `Zod + OpenAPI` | Type-safe Endpoint Schema | Single source of truth cho toàn bộ API |

---

## 6. Lộ Trình Áp Dụng Thực Tế (Action Plan)

1. **Bước 1**: Cài đặt `knip` và `dependency-cruiser` làm công cụ kiểm tra tự động trước mỗi lần commit.
2. **Bước 2**: Bật `"lsp": true` trong file cấu hình OpenCode để tăng sức mạnh cho AI Agent.
3. **Bước 3**: Chuẩn hóa các route của Web Server bằng mô hình Schema-First với Zod/OpenAPI.
4. **Bước 4**: Lưu lại các quyết định thiết kế cốt lõi vào thư mục `docs/adr/` để duy trì bộ nhớ kiến trúc bền vững.
