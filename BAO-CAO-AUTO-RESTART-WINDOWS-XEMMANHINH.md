# BÁO CÁO: Auto-restart Windows cho Xemmanhinh

**Ngày kiểm tra:** 09/09/2026 ~19:28  
**Agent:** src-uac (searcher, agent-c8d1bc14)  
**Phạm vi:** Cơ chế Windows tự khởi động / tự phục hồi (Task Scheduler, SCM, Run keys, NSSM) — không sửa mã nguồn.

---

## 1. KẾT LUẬN NGẮN

| Lớp | Cơ chế | Trạng thái thực tế |
|-----|--------|--------------------|
| **Boot OS** | Task Scheduler `\XemmanhinhBootService` `/sc ONSTART` as SYSTEM | **ĐANG HOẠT ĐỘNG** — đã auto-start sau reboot hôm nay |
| **Crash worker** | Vòng lặp `service_launcher.py` (poll 2s, `CreateProcessAsUserW`) | **ĐANG HOẠT ĐỘNG** — restart worker ~mỗi 5 phút |
| **Crash launcher / Task fail** | Task Scheduler `RestartCount` / `RestartInterval` | **KHÔNG CẤU HÌNH** (`RestartCount=0`) |
| **Windows Service SCM** | `XemmanhinhService` + `sc failure ... restart` | **KHÔNG TỒN TẠI** (Error 1060) |
| **NSSM / WinSW / HKLM Run** | Service wrapper / Run key / Startup folder | **KHÔNG DÙNG** cho server 8765 |

**Windows KHÔNG có SCM auto-restart.** Auto-start khi bật máy dựa 100% vào Task Scheduler ONSTART. Auto-restart khi worker chết dựa 100% vào vòng lặp Python của launcher (không phải Windows recovery).

---

## 2. BẰNG CHỨNG BOOT AUTO-START (HOẠT ĐỘNG)

Boot OS hôm nay:

```
Win32_OperatingSystem.LastBootUpTime = 9/9/2026 10:04:13 AM
Task Last Run Time                    = 9/9/2026 10:04:23 AM   (+10 giây)
```

Tiến trình launcher:

```
PID 4092  python.exe  SessionId=0
Parent    PID 1876  svchost.exe -k netsvcs -p -s Schedule
Creation  9/9/2026 10:04:23 AM
Command   "C:\Users\Dang\scoop\apps\python\current\python.exe"
          "C:\Users\Hai Dang\Xemmanhinh\service\service_launcher.py"
```

`LastTaskResult=267009` (`0x41301` = `SCHED_S_TASK_RUNNING`) — task vẫn đang chạy, không phải lỗi.

Worker hiện tại do launcher spawn:

```
PID 7552 (tại thời điểm netstat) → python.exe server_H264wss_testP_new.py --always-run
Parent = 4092 (launcher)
Ports  0.0.0.0:8765 / 8766 / 8767 LISTENING
```

Log launcher (dòng cuối lúc kiểm tra):

```
[2026-09-09 19:19:56] Worker khởi chạy thành công! PID=7552
[2026-09-09 19:25:39] Worker PID=7552 đã dừng hoặc bị ngắt, đang khởi động lại...
[2026-09-09 19:25:39] Worker khởi chạy thành công! PID=21152
```

---

## 3. TASK SCHEDULER — CẤU HÌNH THỰC TẾ

Nguồn: `schtasks /query /tn "XemmanhinhBootService" /xml` + COM `Schedule.Service`.

| Setting | Giá trị thực | Ý nghĩa |
|---------|--------------|---------|
| TaskName | `\XemmanhinhBootService` | Unique |
| Enabled | True | Được phép chạy |
| State | Running (4) | Đang chạy |
| Trigger | `BootTrigger` (Type=8) | Chỉ fire lúc **system startup** |
| UserId | SYSTEM (`S-1-5-18`) | Session 0 |
| RunLevel | HighestAvailable | Highest |
| LogonType | 5 (Service / S4U) | Không cần user logon |
| Action | scoop `python.exe` + `service_launcher.py` | Đúng file launcher |
| RestartCount | **0** | **Không auto-restart task khi fail** |
| RestartInterval | *(empty)* | Không có interval recovery |
| ExecutionTimeLimit | **PT72H** | Windows **kill task sau 72 giờ** |
| StartWhenAvailable | **False** | Missed start **không** được bù |
| DisallowStartIfOnBatteries | **true** | Laptop pin → **không start** |
| StopIfGoingOnBatteries | **true** | Rút sạc → **kill task** |
| MultipleInstances | IgnoreNew (2) | Không spawn instance thứ 2 |
| Repeat | không có | Không phải periodic task |

XML trên đĩa (export): `C:\Users\Dang\AppData\Local\Temp\opencode\XemmanhinhBootService.xml`

Installer tạo task bằng lệnh tối thiểu, **không** set recovery / unlimited runtime:

```90:90:C:\Users\Hai Dang\Xemmanhinh\service\install_service.bat
schtasks /create /tn "%TASK_NAME%" /tr "\"%PYTHON_EXE%\" \"%LAUNCHER_PY%\"" /sc ONSTART /ru "NT AUTHORITY\SYSTEM" /rl HIGHEST /f >nul 2>&1
```

`schtasks /create` mặc định Windows: `ExecutionTimeLimit=72h`, `StopIfGoingOnBatteries=true`, `RestartCount=0`.

---

## 4. WINDOWS SERVICE SCM — KHÔNG CÒN

```
sc query XemmanhinhService  →  [SC] OpenService FAILED 1060
sc qc     XemmanhinhService  →  1060
sc qfailure XemmanhinhService → 1060
Get-CimInstance Win32_Service (Name/PathName match Xemmanhinh) → rỗng
nssm trong C:\Users\Hai Dang\Xemmanhinh → không có
```

`install_service.bat` **cố ý xóa** SCM cũ rồi chuyển sang schtasks:

```39:43:C:\Users\Hai Dang\Xemmanhinh\service\install_service.bat
sc stop %OLD_SERVICE% >nul 2>&1
sc delete %OLD_SERVICE% >nul 2>&1
schtasks /end /tn "%TASK_NAME%" >nul 2>&1
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1
```

Tài liệu cũ (`service/README.md` dòng 76-77, `CHANGELOG-GIAI-DOAN-3.md`) vẫn ghi `sc.exe create ... start= auto` + `sc failure ... restart/5000`. **Lệnh đó không còn trên máy.** Đã bị thay bằng Task Scheduler từ `CHANGELOG-SCHTASKS-CLEAN-RECOVER.md`.

---

## 5. RUN KEY / STARTUP FOLDER — KHÔNG PHỤC VỤ SERVER

- `HKLM\...\Run`: SecurityHealth, RtkAudUService, CloudflareWARP — **không có Xemmanhinh**.
- `HKCU\...\Run`: UniKey, OneDrive, Edge — **không có Xemmanhinh**.
- Startup user: có shortcut `Chay_App_Doc_Markdown_GUI.bat` (md_reader GUI), **không** phải server 8765.
- Startup common: RustDesk, Tailscale.

Kết luận: server streaming **không** auto-start qua Run key.

---

## 6. AUTO-RESTART TẦNG ỨNG DỤNG (LAUNCHER)

File: `C:\Users\Hai Dang\Xemmanhinh\service\service_launcher.py`

- Vòng `while True` (line 379), sleep 2s.
- Nếu worker handle không còn `STILL_ACTIVE` (259) → log `"đã dừng hoặc bị ngắt, đang khởi động lại..."` → `launch_worker_in_session()`.
- Worker cmdline: `python.exe server_H264wss_testP_new.py --always-run`.

**Đây là cơ chế auto-restart duy nhất khi process worker chết.** Không đi qua SCM `failure-actions`.

Quan sát log 09/09: worker chết lặp lại ~5 phút/lần (14:27 → 19:25, hàng trăm lần). Launcher **luôn** spawn lại thành công (token winlogon PID=980). Đây là **restart đang chạy**, nhưng cũng là **bug vòng đời worker** (ngoài scope searcher — cần coder điều tra vì sao process thoát sau ~5 phút).

---

## 7. LỖ HỔNG WINDOWS-LEVEL (CẦN SỬA NẾU MUỐN AUTO-RESTART ĐÚNG NGHĨA)

### P0 — Task bị Windows giết sau 72 giờ
`ExecutionTimeLimit=PT72H`. Boot lúc 10:04 09/09 → Windows hard-stop launcher ~10:04 **12/09**. Vì `RestartCount=0` và trigger chỉ là BootTrigger, **server sẽ chết đến lần reboot kế tiếp**.

Fix đề xuất (coder, không phải searcher):

```
schtasks /change không đủ. Cần XML:
  <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>   <!-- unlimited -->
  <RestartOnFailure>
    <Interval>PT1M</Interval>
    <Count>999</Count>
  </RestartOnFailure>
  <StartWhenAvailable>true</StartWhenAvailable>
  <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
  <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
  <AllowStartOnDemand>true</AllowStartOnDemand>
```

Cập nhật `install_service.bat` để export XML đầy đủ thay vì `schtasks /create` mặc định.

### P1 — Laptop pin sẽ stop task
Máy có pin `AP19B8K` (BatteryStatus=2, đang cắm AC, 100%). `StopIfGoingOnBatteries=true` → rút sạc = kill streaming.

### P2 — Launcher chết thì không ai nâng lại
Nếu `python.exe` PID 4092 crash / Task Scheduler dừng task: Windows **không** restart (`RestartCount=0`). Chỉ worker được launcher canh. Bản thân launcher **không** có watchdog Windows.

### P3 — Worker crash loop ~5 phút
Không phải lỗi auto-restart Windows, nhưng làm gián đoạn stream. Launcher đang bù bằng spawn lại. Cần coder tìm exit reason của `server_H264wss_testP_new.py`.

---

## 8. SO SÁNH 3 TẦNG RESTART

```
[Windows boot]
    └─ Task Scheduler BootTrigger  (\XemmanhinhBootService)     ✅ đã verify 10:04:23
           └─ python service_launcher.py   (Session 0, PID 4092)
                  └─ loop 2s
                         └─ CreateProcessAsUserW worker          ✅ đang restart
                                └─ server_H264wss_testP_new.py --always-run
                                       ports 8765/8766/8767

[Windows SCM XemmanhinhService + sc failure restart]            ❌ đã xóa
[Task Scheduler RestartOnFailure]                               ❌ RestartCount=0
[HKLM/HKCU Run / Startup]                                       ❌ không đăng ký server
```

---

## 9. FILE LIÊN QUAN

| File | Vai trò |
|------|---------|
| `C:\Users\Hai Dang\Xemmanhinh\service\install_service.bat` | Tạo task ONSTART, xóa SCM cũ |
| `C:\Users\Hai Dang\Xemmanhinh\service\uninstall_service.bat` | Xóa task + SCM |
| `C:\Users\Hai Dang\Xemmanhinh\service\service_launcher.py` | Watchdog worker (app-level restart) |
| `C:\Users\Hai Dang\Xemmanhinh\service\service_launcher.log` | Bằng chứng restart loop |
| `C:\Users\Hai Dang\Xemmanhinh\service\README.md` | Tài liệu **lỗi thời** (vẫn ghi sc.exe + sc failure) |

---

## 10. KHUYẾN NGHỊ CHO ORCHESTRATOR

1. **Giữ** Task Scheduler ONSTART — đây là cơ chế boot đúng và đã verify trên reboot 09/09.
2. Giao **coder** cập nhật `install_service.bat` + re-register task XML: `ExecutionTimeLimit=PT0S`, `RestartOnFailure` Count≥3 Interval=PT1M, tắt battery-stop.
3. **Không** khôi phục `sc.exe XemmanhinhService` trừ khi viết đúng Win32 Service Dispatcher (lịch sử Error 1053).
4. Giao **debugger/coder** điều tra worker exit mỗi ~5 phút (`server_H264wss_testP_new.py`) — auto-restart đang che bug này.
5. Cập nhật `service/README.md` cho khớp schtasks (bỏ đoạn `sc failure`).
