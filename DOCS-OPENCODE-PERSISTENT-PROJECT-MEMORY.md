# TỔNG HỢP CÁC GIẢI PHÁP BỘ NHỚ BỀN VỮNG CHO TỪNG DỰ ÁN (PERSISTENT PROJECT MEMORY) TRONG OPENCODE

> **Tài liệu tổng hợp & Đánh giá kiến trúc**  
> **Cập nhật:** Tháng 9/2026  
> **Phạm vi áp dụng:** OpenCode Core, OpenCode Serve (`mode: 'http'`), AgentForge Multi-Agent Ecosystem.

---

## 1. Bối cảnh & Vấn đề Cốt lõi (The Problem)

Các AI Coding Agent truyền thống (như Claude Code, Cursor, Windsurf, Aider, OpenCode mặc định) hoạt động theo từng phiên làm việc (session). Khi kết thúc phiên hoặc đạt giới hạn context window:
- **Mất ngữ cảnh dài hạn**: Agent quên các quyết định kiến trúc quan trọng đã thống nhất tuần trước.
- **Lặp lại sai lầm**: Agent thử lại các giải pháp/thư viện đã từng bị lỗi và bị loại bỏ ở các phiên trước.
- **Lẫn lộn đa dự án (Cross-project pollution)**: Quy chuẩn code, biến môi trường hoặc thư viện của Dự án A bị tiêm nhầm sang Dự án B.

**Bộ nhớ bền vững cho từng dự án (Persistent Project Memory)** giải quyết triệt để vấn đề này bằng cách lưu trữ, phân loại và tái hiện ngữ cảnh kỹ thuật theo từng kho mã nguồn (repository/project directory).

---

## 2. Hai Phương Thức Gắn Vào OpenCode

OpenCode hỗ trợ 2 cơ chế chính để tích hợp hệ thống bộ nhớ:

1. **Native OpenCode Plugin (`"plugin": [...]`)**:
   - Được nạp trực tiếp vào runtime của OpenCode thông qua Bun/Node khi khởi động.
   - Có thể can thiệp sâu vào vòng đời của session: hook trước/sau khi prompt, tự động bắt sự kiện khi session `idle`, tự động tiêm context vào system prompt.
   - Cấu hình tại file `~/.config/opencode/opencode.json` (hoặc `%USERPROFILE%\.config\opencode\opencode.json` trên Windows).

2. **Model Context Protocol Server (`"mcp": {...}`)**:
   - Chuẩn mở Model Context Protocol do Anthropic khởi xướng.
   - Tương thích chéo giữa OpenCode, Claude Code, Cursor, Windsurf.
   - Khởi chạy dưới dạng tiến trình độc lập hoặc container, giao tiếp qua stdio / HTTP SSE.

---

## 3. Chi Tiết Các Repository Nổi Bật Mới Nổi Trên GitHub

### 3.1. `tickernelz/opencode-mem` (Toàn diện nhất về Vector Search & Web UI)

- **Repository**: [https://github.com/tickernelz/opencode-mem](https://github.com/tickernelz/opencode-mem)
- **Gói npm**: `opencode-mem`
- **Loại hình**: Native OpenCode Plugin

#### Kiến trúc kỹ thuật:
- **Embedded Turso / libSQL Vector Index**: Sử dụng trực tiếp embedded Turso/libSQL với định dạng vector gốc `F32_BLOB` và giải thuật tìm kiếm xấp xỉ DiskANN (`vector_top_k`). Hoàn toàn 100% local, không cần cài đặt Postgres/Qdrant/Milvus bên ngoài.
- **Local Embedding**: Mặc định dùng `@huggingface/transformers` với mô hình ONNX `Xenova/nomic-embed-text-v1` (768 chiều, 8192 context) hoặc cấu hình gọi remote embedding API (OpenAI text-embedding-3-small).

#### Cơ chế phân tách dự án (Project Isolation):
- Mặc định băm (SHA16 hash) Git Remote URL hoặc thư mục gốc dự án để tạo shard SQLite riêng biệt trong thư mục `~/.opencode-mem/data/projects/<hash>.db`.
- **Hỗ trợ Monorepo / Multi-repo**: Chỉ cần tạo file trống `.opencode-mem-project` ở thư mục gốc của workspace, mọi sub-repo bên dưới sẽ tự động hội tụ về cùng một shard bộ nhớ chung.
- **Phạm vi truy vấn**:
  - `scope: "project"` (mặc định): Chỉ tìm kiếm và tiêm ký ức của dự án hiện tại.
  - `scope: "all-projects"`: Mở rộng tìm kiếm trên toàn bộ các shard dự án.

#### Tính năng nổi bật:
- **Auto-Capture**: Khi phiên làm việc chuyển sang trạng thái `idle`, plugin gửi một request nền (dùng chính provider của OpenCode hoặc API riêng) để tóm tắt các quyết định kỹ thuật vừa diễn ra và lưu vào vector database.
- **Auto-Inject**: Đầu phiên chat mới, plugin tự động tìm k ký ức tương đồng nhất và tiêm vào ngữ cảnh prompt (`chatMessage.injectOn: "first"`).
- **Web UI Dashboard**: Tích hợp sẵn web server chạy cổng `http://127.0.0.1:4747`, hiển thị timeline bộ nhớ, quản lý profile thói quen code, xem chi tiết score và vector embedding.

#### Hướng dẫn cài đặt:
Thêm vào file `~/.config/opencode/opencode.json` (Windows: `%USERPROFILE%\.config\opencode\opencode.json`):
```jsonc
{
  "plugin": ["opencode-mem"]
}
```

Tùy chọn cấu hình chi tiết tại `~/.config/opencode/opencode-mem.jsonc`:
```jsonc
{
  "storagePath": "~/.opencode-mem/data",
  "embeddingModel": "Xenova/nomic-embed-text-v1",
  "memory": {
    "defaultScope": "project"
  },
  "webServerEnabled": true,
  "webServerPort": 4747,
  "autoCaptureEnabled": true,
  "opencodeProvider": "anthropic",
  "opencodeModel": "inherit",
  "chatMessage": {
    "enabled": true,
    "maxMemories": 3,
    "injectOn": "first"
  }
}
```

---

### 3.2. `cioffiAI/opencode-memory` (Kiến trúc Sạch: WRITE → DREAM → SURFACE)

- **Repository**: [https://github.com/cioffiAI/opencode-memory](https://github.com/cioffiAI/opencode-memory)
- **Gói npm**: `@cioffi_ai/opencode-memory`
- **Loại hình**: Native OpenCode Plugin

#### Kiến trúc kỹ thuật:
- **Zero External Database**: Hoàn toàn không dùng database phức tạp, chỉ dùng file JSON local kèm cơ chế File Locking (`store.json` + lockfile), triệt tiêu nguy cơ lỗi crash C++/ONNX hay phiên bản runtime.
- **Vòng đời 3 giai đoạn (WRITE → DREAM → SURFACE)**:
  - **WRITE**: Bộ công cụ tường minh (`memory_write`, `memory_update`, `memory_forget`, `memory_why`).
  - **DREAM**: Khi phiên chat kết thúc hoặc rảnh, hệ thống tự động spawn một child-session ngầm hoàn toàn bị cô lập (`tools: { "*": false }` - không thể chạy shell hay đọc sửa file) để đọc transcript, cô đọng các sự thật kỹ thuật mới.
  - **SURFACE**: Lọc và tiêm thông tin vào prompt tiếp theo bằng pipeline kết hợp lexical matching và semantic reranking.

#### Cơ chế phân tách dự án (Project Isolation):
- Gắn chặt với `projectID = OpenCode session directory`.
- Mọi công cụ đọc/ghi chỉ thấy dữ liệu global + dữ liệu của dự án hiện tại.
- **Chống ghi đè mù quáng (Contradiction Lifecycle)**: Khi một sự thật mới xung đột với sự thật cũ, hệ thống gán nhãn `CONFLICTED` để kiểm tra nguồn gốc (provenance), không bao giờ âm thầm ghi đè làm mất lịch sử.
- **Phân tầng ký ức (Memory Tiers)**:
  - `core`: Luôn luôn xuất hiện trong prompt.
  - `archival`: Chỉ xuất hiện khi có ngữ cảnh phù hợp.
  - `temporary`: Tự hết hạn sau TTL.
  - `pinned`: Không bao giờ bị suy giảm điểm số theo thời gian (decay).

#### Hướng dẫn cài đặt:
Thêm vào `~/.config/opencode/opencode.json`:
```json
{
  "plugin": ["@cioffi_ai/opencode-memory"]
}
```

---

### 3.3. `Sprintra-io/sprintra-mcp` (Project Brain Quản Lý Kiến Trúc & Sprint qua MCP)

- **Repository**: [https://github.com/Sprintra-io/sprintra-mcp](https://github.com/Sprintra-io/sprintra-mcp)
- **Gói npm**: `@sprintra/cli`
- **Loại hình**: MCP Server (Model Context Protocol)

#### Kiến trúc kỹ thuật:
- Đóng vai trò là **Project Brain** tập trung, cung cấp 17–20 công cụ MCP chuẩn hóa.
- Quản lý ngữ cảnh theo cấu trúc nghiệp vụ phát triển phần mềm thay vì chỉ lưu trữ text tự do.

#### Các thành phần bộ nhớ quản lý:
- **Architecture Decision Records (ADRs)**: Lưu vết các quyết định cấu trúc (ví dụ: lý do chọn ORM, mô hình xác thực, database) kèm tính năng phát hiện xung đột bằng AI khi agent đưa ra giải pháp trái ngược với ADR.
- **Work Sessions Delta**: Theo dõi chính xác tiến độ giữa các buổi làm việc: phiên trước đã làm tới đâu, các file nào đã sửa, tiêu chí nghiệm thu nào chưa đạt.
- **Acceptance Criteria & Task Graph**: Quản lý quan hệ phụ thuộc giữa các chức năng và kiểm tra tự động trước khi đóng task.
- Tích hợp Dashboard Kanban, Burndown chart, và tự động tạo Standup Report từ commit/session log.

#### Hướng dẫn cấu hình vào OpenCode:
Thêm vào mục `mcp` trong `opencode.json`:
```json
{
  "mcp": {
    "sprintra": {
      "command": "npx",
      "args": ["@sprintra/cli", "mcp"]
    }
  }
}
```

---

### 3.4. `tickernelz/opencode-memory-md` (Đơn giản, Minh bạch dạng Markdown)

- **Repository**: [https://github.com/tickernelz/opencode-memory-md](https://github.com/tickernelz/opencode-memory-md)
- **Gói npm**: `@zhafron/opencode-memory-md`
- **Loại hình**: Native OpenCode Plugin

#### Kiến trúc kỹ thuật:
- Không dùng database hay vector phức tạp. Lưu trữ bộ nhớ dưới dạng các file Markdown thuần:
  - `MEMORY.md`: Ký ức dài hạn, quyết định kỹ thuật, quy tắc code.
  - `IDENTITY.md`: Persona và hướng dẫn vai trò.
  - `USER.md`: Thông tin thói quen của lập trình viên.
  - `daily/YYYY-MM-DD.md`: Nhật ký công việc theo ngày.
- **Lưu trữ**: Nằm tại `~/.config/opencode/memory/` (hoặc `%APPDATA%/opencode/memory/` trên Windows).
- **Ưu điểm lớn nhất**: Con người hoàn toàn có thể mở ra đọc, chỉnh sửa trực tiếp bằng VS Code hoặc commit vào Git mà không cần bất kỳ công cụ chuyên dụng nào.

#### Hướng dẫn cài đặt:
```json
{
  "plugin": ["@zhafron/opencode-memory-md"]
}
```

---

## 4. Bảng So Sánh Chi Tiết Giữa Các Giải Pháp

| Tiêu chí | `opencode-mem` (tickernelz) | `opencode-memory` (cioffiAI) | `sprintra-mcp` (Sprintra) | `opencode-memory-md` |
| :--- | :--- | :--- | :--- | :--- |
| **Cơ chế lưu trữ** | Embedded Turso/libSQL + DiskANN | Local JSON + Lockfile | SQLite / Cloud Server | Markdown Files (`.md`) |
| **Tìm kiếm ngữ nghĩa (Vector/Semantic)** | Có (Local ONNX hoặc Remote Embeddings) | Có (Hybrid Lexical + LLM Rerank) | Có (Semantic Search qua API) | Không (Text search / Grep) |
| **Phân tách theo dự án** | Tự động qua Git SHA / `.opencode-mem-project` | Tự động theo Session Directory | Tự động theo Project ID trong MCP | Thủ công theo file/thư mục |
| **Giao diện quản trị (UI)** | Web UI tích hợp (`:4747`) | CLI / Command `/memory` | Web Dashboard Kanban/ADR | Trực tiếp xem file `.md` |
| **Giao thức tích hợp** | Native OpenCode Plugin | Native OpenCode Plugin | Model Context Protocol (MCP) | Native OpenCode Plugin |
| **Mức tiêu hao tài nguyên** | Vừa (nạp model ONNX nếu chạy local) | Rất nhẹ (thuần JSON) | Tùy thuộc client/server | Cực nhẹ (I/O file text) |
| **Độ tin cậy khi chạy lâu dài** | Cao (ACID database, WAL) | Cực cao (không phụ thuộc binary C++) | Cao (kiến trúc microservice/MCP) | Cao (dễ backup, dễ sửa tay) |

---

## 5. Khuyến Nghị Áp Dụng Cho AgentForge

Trong môi trường AgentForge Multi-Agent với chế độ HTTP Engine (`mode: 'http'`), cấu trúc bộ nhớ dự án tối ưu có thể được phân tầng như sau:

1. **Khuyến nghị số 1 cho Coding & Bug-fixing thông thường:**
   - Sử dụng **`cioffiAI/opencode-memory`** nếu muốn sự ổn định tuyệt đối trên Windows, không gây nặng CPU khi tính toán vector local, đảm bảo mỗi thư mục dự án có một không gian ký ức riêng biệt không bao giờ rò rỉ sang dự án khác.
2. **Khuyến nghị số 2 cho Dự án lớn với tìm kiếm Semantic nâng cao:**
   - Sử dụng **`tickernelz/opencode-mem`** nếu muốn có Dashboard Web trực quan theo dõi những gì agent đã ghi nhớ sau mỗi turn, đồng thời muốn agent tự động nhớ các quyết định kiến trúc qua vector search.
3. **Khuyến nghị số 3 cho Quản lý quy trình & Quyết định kỹ thuật (ADRs):**
   - Sử dụng **`Sprintra-io/sprintra-mcp`** thông qua cấu hình MCP Server của OpenCode để phục vụ vai trò Orchestrator, Planner và Reviewer khi cần kiểm soát sự tuân thủ các quyết định thiết kế dài hạn.
