Hướng dẫn điều tra cho res-codebase — kiểm chứng trạng thái team isolation leak trong repo hiện tại

===== MỤC TIÊU =====
Xác định xem team isolation leak ở 3 file này trong repo `C:\Users\Hai Dang\Test-agentforge thoi` đã được fix chưa. Báo cáo PASS/FAIL + git log để orchestrator quyết định tiếp theo.

===== FILE CẦN KIỂM TRA =====
1. C:\Users\Hai Dang\Test-agentforge thoi\src\server.ts — quanh dòng 830-841
2. C:\Users\Hai Dang\Test-agentforge thoi\src\ws\ws-service.ts — quanh dòng 110-120
3. C:\Users\Hai Dang\Test-agentforge thoi\src\relay\team-isolation.ts — dòng 90-105 và 145-165

===== CÁC TIÊU CHÍ KIỂM TRA (verify từng trường hợp) =====
(A) server.ts broadcast team check:
   - WebSocket broadcast: `if (broadcastTeamId && wsTeam !== broadcastTeamId)` (không có `wsTeam &&` ở đầu)
   - SSE broadcast: tương tự
   - PASS nếu: đã là dạng `if (broadcastTeamId && wsTeam !== broadcastTeamId)`
   - FAIL nếu: còn dạng `if (wsTeam && broadcastTeamId && ...)` (vulnerable)

(B) ws-service.ts team filter:
   - `if (filterTeamId && (ws as any).teamId !== filterTeamId) continue;`
   - PASS nếu: có filterTeamId ở đầu, strict `!==`
   - FAIL nếu: logic lỏng lẻo hoặc cross-team mặc định

(C) team-isolation.ts:
   - removed root-orchestrator & global name/role fallback khi preferredTeamId undefined
   - PASS nếu: hàm getTeamOfName/getTeamOfRole trả về null/undefined khi preferredTeamId không match (không fallback to root)
   - FAIL nếu: còn fallback logic cross-team

(D) Git verification:
   - `git log --oneline -15` trong repo để xem commit gần nhất có chứa "team isolation" không
   - `git status` để xem working tree có thay đổi chưa commit không

===== VERIFY =====
Báo cáo: PASS nếu cả 3 file đều đã fix leak + git log xác nhận commit team isolation. Nếu còn bất kỳ file nào chưa fix → FAIL (đưụng file/path/dòng chính xác cần sửa).
