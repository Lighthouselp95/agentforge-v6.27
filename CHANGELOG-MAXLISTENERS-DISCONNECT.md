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
