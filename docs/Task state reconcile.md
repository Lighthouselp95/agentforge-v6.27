THIẾT KẾ THỰC THI KIẾN TRÚC: AI ĐÁNH GIÁ TIẾN ĐỘ, AI RA VIỆC VÀ CƠ CHẾ QUẢN LÝ VÒNG ĐỜI TASK
Dưới đây là lời giải thực tế, tường minh và khả thi 100% về mặt kỹ thuật cho 3 câu hỏi lớn của bạn:
CÂU HỎI 1: Tiến độ Sub-step Telemetry (20%, 60%, 90%) thực tế triển khai thế nào, và AI LÀ NGƯỜI ĐÁNH GIÁ? Agent hay Main?
🎯 Bản chất thực tế:
Nếu để Main đánh giá: Main không thể nhìn vào đầu Agent khi Agent đang chạy (Main chỉ là LLM, không thể túc trực soi từng mili-giây).
Nếu để Agent tự nhẩm phần trăm (tự bịa số $20\%$, $60\%$): LLM hallucinate rất nặng, sẽ sinh ra số ảo không đáng tin cậy.
💡 Giải pháp thực tế: HỆ THỐNG ENGINE (Runtimes/Hooks) + AGENT TOOL HOOKS ĐÁNH GIÁ TỰ ĐỘNG
Hệ thống KHÔNG DỰA VÀO CẢM TÍNH CỦA LLM, mà dựa vào Tool Call Telemetry thực tế từ Server:
1.
Server tự động bắt Event Tool Calls của Agent (Zero-effort từ Agent):
Khi OpenCode nhả event stdout:
•
Thấy event tool_use: { name: 'read' | 'glob' | 'grep' } $\rightarrow$ Server tự động phát:
     progress: { step: 'Reading & Investigating Codebase', percent: 25 }
•
Thấy event tool_use: { name: 'edit' | 'write' } $\rightarrow$ Server tự động phát:
     progress: { step: 'Modifying & Writing Code Diffs', percent: 65 }
•
Thấy event tool_use: { name: 'bash' | 'test' } $\rightarrow$ Server tự động phát:
     progress: { step: 'Running Verification & Tests', percent: 90 }
•
Nhận được thẻ `` $\rightarrow$ Server đánh dấu $100\%$.
2.
Agent có thể chủ động cập nhật checkpoint (Tùy chọn):
   Agent có thể nhả thẻ nhẹ <step name="Refactoring AST" /> nếu muốn định danh rõ bước làm, nhưng Server luôn là trọng tài xác thực dựa trên hành vi gọi tool thực tế.
👉 KẾT LUẬN: Hệ thống Runtime (Server Hooks) là người đo lường khách quan nhất, tự động ánh xạ Tool Call ra thanh tiến trình thực tế trên UI mà không làm tốn thêm token hay công sức của LLM!
CÂU HỎI 2: dependsOn: ["task-1"] làm sao ra việc, AI QUYẾT ĐỊNH VÀ VIẾT RA?
🎯 Ai là người quyết định?
CHÍNH LÀ MAIN ORCHESTRATOR.
Bởi vì: Main Orchestrator là thực thể duy nhất nắm bức tranh toàn cảnh (Architectural Vision) và có nhiệm vụ phân rã bài toán lớn thành các subtasks. Worker Agent chỉ nhìn thấy góc hẹp của mình, không thể biết công việc của agent khác.
🛠️ Cơ chế ra việc cụ thể trong cú pháp lệnh:
Main Orchestrator khi giao việc cho Agent sẽ viết thuộc tính dependsOn (hoặc after) ngay trong lệnh <task_add> hoặc <spawn> / <talk>:
🌐
xml

📋
Copy
<!-- Task 1: Làm trước -->


<!-- Task 2: Phụ thuộc vào Task 1 -->
⚙️ Server Engine quản lý thực thi ra sao?
•
Khi Task t2 có dependsOn="t1":
•
Máy chủ (Backend Queue Engine) tự động khóa t2 ở trạng thái pending (blocked).
•
Agent không thể chạm vào `t2`.
•
Ngay khi t1 được chuyển sang completed $\rightarrow$ Engine tự động mở khóa t2 sang trạng thái ready (sẵn sàng kích hoạt)!
CÂU HỎI 3: Hiện tại AI LÀ NGƯỜI ĐÁNH working? Tiến tới cho Agent hay Main đánh working?
🔍 Hiện tại hệ thống đang làm thế nào?
1.
Khi Main gửi `<spawn>` hoặc `<talk task="...">`:
•
Máy chủ tự động tạo task trong agent.tasks và gán status ban đầu là working (nếu là task đầu tiên) hoặc pending (nếu agent đang có task khác).
•
Khi Agent chạy xong, Agent gửi báo cáo $\rightarrow$ Main gửi ``.
•
Như vậy hiện tại: Main và Server là bên áp đặt trạng thái `working` cho Agent.
🚀 TIẾN TỚI NÊN LÀM THẾ NÀO? MÔ HÌNH LÝ TƯỞNG NHẤT:
1. Main là bên "Giao Hàng Đợi" (pending) — Không ép working ngay:
•
Main Orchestrator khi giao việc chỉ đưa task vào trạng thái pending (danh sách chờ thực hiện theo thứ tự ưu tiên hoặc phụ thuộc).
2. Agent là bên "Nhận Việc & Đánh working" (Pull-based Execution):
•
Khi Agent rảnh (idle) và sẵn sàng bắt tay vào làm:
•
Agent tự động (hoặc qua lệnh) kích hoạt task đầu tiên trong hàng đợi:
    ``
•
Lợi ích to lớn:
•
Tránh tình trạng Main vừa giao việc là Agent bị ép working trong khi tiến trình thực tế chưa sẵn sàng hoặc đang dọn dẹp context cũ.
•
Agent chủ động làm chủ nhịp độ làm việc (Tự nhận việc $\rightarrow$ Đánh dấu working $\rightarrow$ Làm $\rightarrow$ Báo cáo $\rightarrow$ Đánh dấu completed $\rightarrow$ Tự bốc task pending kế tiếp lên working).
3. Main đóng vai trò "Trọng Tài Nghiệm Thu" (Verifier/Gatekeeper):
- Khi Agent hoàn thành và báo cáo:
•
Agent chỉ đề xuất status="review_needed" hoặc báo cáo kết quả.
•
Chính Main Orchestrator (kết hợp với Verifier Agent) mới là người có quyền tối thượng đóng dấu status="completed".
•
Nếu Main/Verifier thấy chưa đạt $\rightarrow$ Trả về status="working" (yêu cầu sửa tiếp).
📊 TỔNG KẾT MÔ HÌNH PHÂN QUYỀN CHUẨN MỰC
Hành động	Thực thể quyết định	Cơ chế kỹ thuật
Tạo task & Gán `dependsOn`	👑 Main Orchestrator	Viết thẻ lệnh giao việc <talk task="..." dependsOn="...">
Kích hoạt sang `working`	🤖 Worker Agent (hoặc Server Auto-Dispatch)	Agent pull task pending lên working khi bắt đầu chạy
Đo lường tiến độ % Sub-step	⚙️ Server Runtime Engine	Tự động bắt Tool Call (read $\rightarrow$ edit $\rightarrow$ test)
Chốt hạ `completed`	👑 Main Orchestrator (qua Verifier)	Thẩm định báo cáo thực chứng trên đĩa trước khi nghiệm thu
