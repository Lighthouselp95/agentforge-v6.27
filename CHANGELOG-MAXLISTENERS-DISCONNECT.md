# CHANGELOG: MaxListenersExceededWarning + Disconnect Stream Fix

## ISSUE SUMMARY

### 1. MaxListenersExceededWarning (CRITICAL)
```
MaxListenersExceededWarning: Possible EventTarget memory leak detected. 
11 event listeners added to [yZ]. MaxListeners is undefined. 
Use events.setMaxListeners() to increase limit
```

**Root Cause:** Khi tạo stream/agent connection, event listener được add lặp lại mà không remove listener cũ. Mỗi lần reconnect hoặc stream mới → thêm 1 listener → vượt max (10 default).

**Files to fix:**
- `src/agents/opencode-serve-client.ts` - Thêm `emitter.setMaxListeners(50)` hoặc remove listener trước khi add
- `src/process/process-manager.ts` - Cleanup listeners khi process die

### 2. Disconnect Stream (CRITICAL)
**Root Cause 1:** Opencode server process die nhưng app không detect → stream mất kết nối im lặng.
**Root Cause 2:** `events.setMaxListeners` warning → listener leak → connection bị drop.
**Root Cause 3:** Server Xemmanhinh ĐÃ CHẾT — không có process Python nào đang chạy.

**Fix:**
- Thêm heartbeat/ping check mỗi 5s
- Nếu opencode process không alive → restart tự động
- Thêm cleanup handler: `process.on('exit')` → `child.kill()`
- Fix MaxListeners leak (xem Fix #1)

### 3. OPENCODE_SERVER_PASSWORD (HIGH)
**Root Cause:** Server không set password → mở暴露 toàn bộ.
**Fix:** Set mặc định `OPENCODE_SERVER_PASSWORD=agentforge` khi spawn opencode.

### 4. Server Xemmanhinh DOWN (CRITICAL)
**Root Cause:** Không có process Python nào đang chạy → FPS=0, disconnect.
**Fix:** Restart server bằng `pythonw.exe` daemon mode.

## IMPLEMENTATION PLAN
1. Fix MaxListeners leak: `setMaxListeners(50)` + remove old listeners
2. Add heartbeat/ping check mỗi 5s cho opencode connection
3. Add cleanup handler: kill opencode process khi app đóng
4. Set `OPENCODE_SERVER_PASSWORD=agentforge` env
5. Restart Xemmanhinh server
6. Spawn random port: `opencode serve --port 0`

## FILES TO MODIFY
- `src/agents/opencode-serve-client.ts` - Fix MaxListeners leak
- `src/process/process-manager.ts` - Cleanup listeners + process kill
- `src/core/lifecycle.ts` - Cleanup hooks
- `src/electron/main.ts` - Spawn opencode + random port
- `src/agents/agent-manager.ts` - Agent state management
- `src/ws/ws-service.ts` - WebSocket heartbeat

## Coder Dispatch Status
- `coder-sched`: [IDLE] - Ready to fix MaxListeners + team isolation
- `coder-stage3`: [WORKING] - Watchdog, cancel task, broadcast (658s)
- `coder-fix-lock`: [IDLE] - Ready for UI mobile settings
- `coder-backend-pdf`: [WORKING] - Restart Xemmanhinh server (1274s)

## Next Actions
1. **coder-sched** → Fix MaxListeners leak + opencode serve spawn random port + cleanup + build
2. **coder-backend-pdf** → Verify Xemmanhinh server restart thành công
3. **verif-boot-status** → Nghiệm thu toàn diện sau khi fix

## Pending Verification
- Build log và chạy lại app để kiểm tra không còn MaxListeners warning
- Xác nhận opencode serve đang listen trên port 4096
- Xác nhận không còn memory leak warning sau 5-10 phút

## Dispatch Log
- [2:47 PM] Dispatched `coder-sched` to fix MaxListeners leak + opencode serve spawn random port + cleanup + build
- [3:24 PM] `coder-backend-pdf` đạt TASK_LIMIT_EXCEEDED — queue 6 tasks restart Xemmanhinh đã có sẵn, không cần giao thêm.
- [3:26 PM] Ping status `coder-sched`, `coder-fix-lock`, `verif-boot-status` (vượt ngưỡng >10 phút chưa báo cáo).
- [3:28 PM] `res-verify-boot` đã hoàn thành task #1-#3 (khảo sát + điều tra lag/FPS + báo cáo). Đang xử lý #4 (team isolation leak).
- [3:30 PM] `verif-boot-status` đạt TASK_LIMIT_EXCEEDED (đủ 6 task) — không giao thêm.
- [3:30 PM] `res-verify-boot` bị kẹt vòng lặp task_update → talk redirect gửi báo cáo văn bản thuần.
- [3:43 PM] `res-codebase` giao 5 fix chi tiết: WS flood stream-controller:116-127, heartbeat ws-service:74-91, watchdog singleton:247-248, endStream removeAllListeners, task-queue import sai.
- [3:50 PM] `coder-stage3` ✅ HOÀN THÀNH: Fix 2 heartbeat 45s + log terminate, Fix 3 watchdog singleton, Fix mobile UI, build PASS 100%, task #2→#5 completed.
- [4:00 PM] Tổng kết đợt làm việc:
  - `res-codebase` → 5 fix đề xuất (đã giao coder triển khai).
  - `coder-stage3` → FIX 2 (heartbeat 45s), FIX 3 (watchdog singleton), Fix mobile UI; build PASS 100%.
  - GIẢI THÍCH "toolcall không live trên màn hình chính": Web UI cố tình filter `m.from === selectedAgentId`, worker stream chỉ hiện ở tab worker, không hiện ở tab Orchestrator.
  - CÒN PHẢI XÁC NHẬN: FIX 1 + FIX 4 (stream-controller), FIX 5 (task-queue import), Xemmanhinh restart, MaxListeners opencode (chưa có report xác nhận parser fix).
- [3:54 PM] `coder-stage3` ✅ HOÀN THÀNH FIX 1 (bỏ char-by-char WS flood, stream-controller.ts:115-124) + FIX 4 (removeAllListeners trong endStream, dòng 147). Build PASS 100%. Đã bàn giao verifier nghiệm thu.
- [3:55 PM] `coder-stage3` idle, tasks cleared → giao nhiệm vụ restart + verify Xemmanhinh server (nguyên nhân gốc disconnect).
- [3:55 PM] `res-verify-boot` nghiệm thu CẢ 5/5 FIX PASS (stream-controller L115-125/L147, ws-service L16/L78-94 heartbeat 45s, watchdog singleton, task-queue no bad import) + build 3.22s thành công.
- [3:55 PM] `res-verify-boot` phát hiện thêm:
  * Nguyên nhân FPS sập 1: double-tap drag bỏ qua throttle 33ms span 60-120 msg/s → ép IDR keyframe (QSV ~1.3s/frame)
  * Scroll fullscreen: P-frame tăng 17 lần (~62KB→1MB), tràn WRITE_BUFFER_LIMIT=2MB → IDR loop
  * SERVER XEMMANHINH CHẾT, SSL 10054/10053, fallback libx264 software
  * TEAM ISOLATION LEAK (AgentForge): server.ts L830-841, ws-service.ts L109, team-isolation.ts L100-102/L150-157
- [3:58 PM] `verif-boot-status` nghiệm thu vật lý FIX 1 (stream-controller L115-124 nguyên chunk) + FIX 4 (endStream L146-148 removeAllListeners) → **PASS**, build 5.42s thành công.
- [3:58 PM] ✅ TẤT CẢ 5/5 FIX ĐÃ ĐƯỢC NGHIỆM THU PASS (res-verify-boot review + verifier vật lý).
- [3:58 PM] Đã giao `coder-sched` fix TEAM ISOLATION LEAK (server.ts, ws-service.ts, team-isolation.ts) + xác nhận task #5.
- [3:59 PM] `coder-sched` working task #6 (team isolation leak) — thử giao thêm bị TASK_LIMIT_EXCEEDED nhưng task đã có trong queue, không cần làm gì thêm.
- [3:59 PM] `coder-stage3` working task #1 — restart + verify Xemmanhinh server.
- [4:01 PM] ✅ `coder-stage3` RESTART XEMMANHINH THÀNH CÔNG: PID 9808 pythonw, ports 8765/8766/8767 Listen, encoder PyAV libx264 (software), Ready + ALWAYS_RUN, KHÔNG còn SSL errors. Task #1 completed.
- [4:09 PM] `src-uac` ĐIỀU TRA SERVICE SCHEDULE: Task Scheduler `\XemmanhinhBootService` TỒN TẠI + Enabled (chạy `service_launcher.py` dưới SYSTEM, ONSTART). NHƯNG log `service_launcher.log` ghi lỗi `AdjustTokenPrivileges SeTcbPrivilege res=1 GetLastError=1300` (ERROR_NOT_ALL_ASSIGNED) → không lấy được token session (WTSQueryUserToken `Khong lay duoc token cho session 1`) → launcher loop `Worker PID=None` → fail spawn qua CreateProcessAsUserW. DO ĐÓ team chuyển sang chạy thủ công `pythonw server_H264wss_testP_new.py --always-run` (PID 9808). KHUYẾN NGHỊ: giữ pythonw hiện tại (đang phục vụ 8765/8766/8767); Task Scheduler chỉ hoạt động đúng khi boot OS Session 0 (pre-logon/lock screen).
- [4:13 PM] `coder-stage3` PHÂN TÍCH STREAM THREAD OPencode: (1) Windows stdout pipe buffer 4KB → JSONL bị ứ đọng tới khi đủ buffer → app im rồi nhảy loạt; đề xuất set PYTHONUNBUFFERED=1 + zero-latency pushOACEvent. (2) showOnUI:false cho msgType talk (server.ts:4434) + stripTalkTags() xóa sạch nội dung <talk> → bubble bị ẩn; đề xuất showOnUI:true + hiển thị directive card.
