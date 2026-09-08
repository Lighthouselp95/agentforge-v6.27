# CHANGELOG v7.0.47 (2026-09-06)

### Kiến Trúc Routing Early-First, Final-As-Fallback & Thuần Túy Windows Kernel Job Object

---

### 1. Kiến Trúc Early-First với Final-As-Fallback (`src/server.ts`)
- **Triết lý Early-First hoàn chỉnh**:
  - `scanStreamForDispatch` ưu tiên phát hiện thẻ `<talk>` đóng hoàn chỉnh ngay trong luồng token stream.
  - **Kiểm tra trạng thái Target**:
    - **Target bận (`isTargetBusy: true`)**: Đánh dấu `isQueued: true`, lưu vào SQLite/JSON storage, đưa vào queue nội bộ (`pendingOrchTriggers` / `backendUserQueues`), và **tuyệt đối không broadcast `chat:message` ra UI timeline** khi target đang bận xử lý.
    - **Target rảnh (`isTargetBusy: false`)**: Đánh dấu `isQueued: false`, lưu storage, broadcast `chat:message` ra timeline tức thì, và dispatch ngay lập tức (`triggerOrchestrator` hoặc `deliverTalk`).
  - Cắt bỏ phần talk đã dispatch khỏi stream buffer để UI không stream lại thẻ XML thô.
  - Ghi nhận chữ ký qua `recordDispatchedTalk(...)` đa chiều.
- **Final Pass (`handleAgentResponse`) đóng vai trò Fallback**:
  - Kiểm tra `isTalkAlreadyDispatched(...)` ở đầu mỗi message.
  - Nếu đã được Early Pass xử lý: **Skip 100%**, không tạo thêm ChatMsg, không lưu trùng, không broadcast lại, triệt tiêu hoàn toàn duplicate bubble.
  - Nếu Early Pass chưa xử lý (stream bị đứt quãng, không stream hoặc EOF không đóng tag): chạy logic Fallback đầy đủ.

### 2. Thuần Túy Windows Kernel Job Object — Hủy Bỏ Toàn Bộ Watchdog Polling (`src/process/job-object.ts`, `scripts/bin/`)
- **Loại bỏ hoàn toàn Watchdog**:
  - Không sử dụng tiến trình PowerShell background job hay vòng lặp polling kiểm tra PID cha.
  - Zero CPU overhead, không tạo tiến trình phụ ngầm định kỳ.
- **Windows Kernel Job Object Native**:
  - Khởi tạo Job Object `AgentForge_ChildJob_<parentPid>` với cờ `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000`.
  - Tự động gán toàn bộ tiến trình con (`powershell.exe`, `opencode.exe`, `opencode serve`) vào Job Object qua `assignProcessToJob`.
  - Nhân bản handle Job Object vào tiến trình cha Node.js (`DuplicateHandle`).
  - Khi tiến trình cha bị tắt đột ngột (End Task trong Task Manager, `taskkill /f`, crash, ngắt điện), Windows Kernel tự động tiêu diệt sạch sẽ 100% cây tiến trình con `opencode` và `powershell`.

### 3. Tự Động Xả Queue & Respawn Đúng Chu Trình
- Báo cáo và tin nhắn bị hoãn trong queue được xả tuần tự và gán timestamp mới tại thời điểm respawn chính thức.
- Loại bỏ hoàn toàn hiện tượng worker reports nhảy xen ngang timeline khi Orchestrator đang xử lý lượt cũ.

### 4. Khắc Phục Lỗi Xả Hàng Đợi Khởi Động (BootSequence Step 5 & UserQueueManager)
- **Sửa lỗi bypass `dispatchUserChat` trong `src/queue/user-queue.ts`**:
  - Khắc phục điều kiện `isOrch && processOrchestratorTriggerQueue` trả về sớm (`early return`) khiến tin nhắn người dùng tồn đọng (`userMsgsToCombine`) bị nuốt chửng và không kích hoạt spawn tiến trình `opencode`.
  - Đảm bảo khi có `userMsgsToCombine > 0`, toàn bộ tin nhắn người dùng được gộp và kích hoạt ngay qua `dispatchUserChat({ targetAgentId: 'orchestrator', ... })`.
  - Cập nhật hàm `isAgentBusy` tại `src/server.ts` để nhận diện Orchestrator đa team qua `findExistingOrchestrator()`.

### 5. Kiểm Thử & Đóng Gói Binary
- `npx tsc --noEmit` tại Root: PASS 0 lỗi.
- `npx tsc --noEmit` tại Web: PASS 0 lỗi.
- `scripts/test-parser-suite.mjs`: PASS 7/7 tests.
- `npm run build:exe`: Tạo thành công `release/agentforge-web.exe` (106 MB) với chữ ký SEA blob hợp lệ.
- Verifier-Audit nghiệm thu độc lập đạt chuẩn PASS 100%.
