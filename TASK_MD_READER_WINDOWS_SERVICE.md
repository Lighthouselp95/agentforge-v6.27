# TASK: Tạo Windows Service cho md_reader (port 8770)

## Repo / entry point (ĐÃ XÁC NHẬN)
- **Repo:** `C:\Users\Hai Dang\Xemmanhinh`
- **Entry:** `C:\Users\Hai Dang\Xemmanhinh\md_reader\md_server.py`
- **Host/Port:** `0.0.0.0:8770`
- **Python:** `C:\Users\Dang\AppData\Local\Python\bin\python.exe` (Python 3.14.7)
- **Hiện trạng:** KHÔNG có `MDReaderService`. Port 8770 đang LISTENING thủ công (PID 7644 `pythonw`). Thiếu 3 file installer.

## KHÔNG dùng raw `sc create ... pythonw`
`pythonw.exe` không phải Windows service binary (không gọi `StartServiceCtrlDispatcher`). SCM sẽ start rồi coi process hung/fail.

## Cách làm bắt buộc (theo thứ tự ưu tiên)
1. **NSSM** nếu có (`nssm` trên PATH hoặc `C:\nssm\win64\nssm.exe` / chocolatey).
2. Nếu không có NSSM: **Task Scheduler** chạy **user hiện tại** (KHÔNG dùng SYSTEM + CreateProcessAsUserW). Lý do: service Xemmanhinh cũ fail `AdjustTokenPrivileges SeTcbPrivilege GetLastError=1300`.
3. Cấm copy nguyên `service\service_launcher.py` của Xemmanhinh (cách đó đã fail).

## Files phải tạo trong `C:\Users\Hai Dang\Xemmanhinh\md_reader\`
1. `install_md_reader_service.bat` — tạo + start + recovery restart
2. `uninstall_md_reader_service.bat` — stop + delete + cleanup
3. `README_SERVICE.md` — cài / gỡ / kiểm tra / auto-restart / troubleshooting

## Recovery
```
sc failure MDReaderService reset= 86400 actions= restart/5000/restart/5000/restart/5000
sc config MDReaderService start= auto
```
(Nếu dùng Task Scheduler: trigger At startup + Restart on failure.)

## VERIFY (bắt buộc, chạy thật)
1. `sc query MDReaderService` → RUNNING (hoặc `schtasks /Query` nếu dùng Task Scheduler — ghi rõ tên task)
2. `netstat -ano | findstr :8770` → LISTENING
3. `curl http://localhost:8770` → HTTP 200
4. 3 file installer/README tồn tại trên đĩa
5. `sc qfailure MDReaderService` (hoặc task restart settings)

Báo cáo: PASS/FAIL từng mục + output lệnh thật.
