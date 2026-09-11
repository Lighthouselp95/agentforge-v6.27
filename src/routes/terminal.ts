import { Router } from 'express';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Pha 1 refactor: GET /logs + /terminal dời verbatim từ src/server.ts (HTML giữ nguyên 1:1).
export interface TerminalRouteDeps {
  storage: any;
  logBuffer: string[];
  maxLogBuffer: number;
}

export function createTerminalRouter(deps: TerminalRouteDeps): Router {
  const router = Router();
  const SERVER_LOG_FILE = join(process.cwd(), 'logs', 'server.log');

  // Helper đảm bảo dòng log luôn có timestamp chuẩn ISO nếu chưa có
  const ensureTimestamp = (l: any): string => {
    if (!l) return '';
    const str = typeof l === 'string' ? l : (l.message || JSON.stringify(l));
    if (/^\[\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/.test(str)) {
      return str;
    }
    const ts = l.timestamp ? new Date(l.timestamp).toISOString() : (l.createdAt ? new Date(l.createdAt).toISOString() : new Date().toISOString());
    return `[${ts}] ${str}`;
  };

  // Helper lấy logs kết hợp từ RAM ring-buffer và file trên đĩa cứng
  const getCombinedLogs = (): string[] => {
    if (deps.logBuffer.length > 0) {
      return deps.logBuffer.map(ensureTimestamp);
    }
    // Nếu RAM trống (server vừa khởi động lại hoặc crash), nạp từ logs/server.log trên đĩa cứng
    if (existsSync(SERVER_LOG_FILE)) {
      try {
        const content = readFileSync(SERVER_LOG_FILE, 'utf8');
        const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
        return lines.slice(-deps.maxLogBuffer).map(ensureTimestamp);
      } catch {}
    }
    return [];
  };

  // Trả toàn bộ log kèm timestamp chuẩn (kết hợp RAM + đĩa cứng)
  router.get('/logs', (_req, res) => {
    const linesWithTs = getCombinedLogs();
    res.json({ lines: linesWithTs, max: deps.maxLogBuffer, count: linesWithTs.length });
  });

  // Alias /api/terminal/logs hỗ trợ client fetch trực tiếp endpoint terminal
  router.get('/api/terminal/logs', (_req, res) => {
    const linesWithTs = getCombinedLogs();
    res.json({ lines: linesWithTs, max: deps.maxLogBuffer, count: linesWithTs.length });
  });

  // Trang HTML nhúng xem terminal realtime: fetch /api/logs + /logs + EventSource(/api/events) lọc terminal:line / log:entry.
  router.get('/terminal', (_req, res) => {
    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>agentforge — terminal</title>
<style>
  * { box-sizing: border-box; }
  html, body { height:100%; margin:0; background:#090d14; color:#d4d6d9; font-family:'JetBrains Mono','Consolas','Menlo','Courier New',monospace; font-size:12.5px; }
  /* terminal titlebar */
  #bar { position:sticky; top:0; display:flex; align-items:center; justify-content:space-between; padding:6px 12px; background:#0e131d; color:#94a3b8; border-bottom:1px solid rgba(255,255,255,0.08); user-select:none; z-index:10; }
  #bar b { color:#38bdf8; font-weight:700; }
  #actions { display:flex; align-items:center; gap:8px; }
  #cnt { font-size:11px; color:#64748b; }
  .btn-clear { background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.35); color:#f87171; border-radius:4px; padding:2px 8px; font-size:11px; font-weight:600; cursor:pointer; font-family:inherit; }
  .btn-clear:hover { background:rgba(239,68,68,0.25); color:#fca5a5; }
  /* log area */
  #log { padding:10px 14px; white-space:pre-wrap; word-break:break-all; line-height:1.55; }
  #log div { margin:0; padding:1px 0; }
  #log .ts { color:#38bdf8; }        /* timestamp sáng xanh */
  #log .err { color:#f87171; font-weight:600; }       /* lỗi đỏ */
  #log .warn { color:#fbbf24; }      /* cảnh báo vàng */
  #wrap { height:calc(100% - 34px); overflow-y:auto; }
  /* prompt + blinking caret */
  #prompt { display:flex; align-items:center; gap:6px; padding:2px 14px 10px; color:#38bdf8; white-space:nowrap; }
  #prompt .ps { color:#4ade80; font-weight:600; }
  #caret { display:inline-block; width:8px; height:15px; background:#4ade80; animation:blink 1s step-end infinite; vertical-align:middle; }
  @keyframes blink { 50% { opacity:0; } }
</style>
</head>
<body>
<div id="bar">
  <b>agentforge@terminal: ~</b>
  <div id="actions">
    <span id="cnt">0 dòng — /api/logs</span>
    <button class="btn-clear" onclick="clearLogs()">🗑️ Clear Logs</button>
  </div>
</div>
<div id="wrap"><div id="log">đang kết nối và tải lịch sử logs…</div></div>
<div id="prompt"><span class="ps">[agentforge@terminal ~]$</span><span id="caret"></span></div>
<script>
  var box = document.getElementById('log');
  var cnt = document.getElementById('cnt');
  var wrap = document.getElementById('wrap');

  function appendLine(line, level, ts){
    if (line === undefined || line === null) return;
    var d = document.createElement('div');
    var str = String(line);
    
    // Nếu là dòng trống (dòng cách giữa các phiên mở app)
    if (!str.trim()) {
      d.innerHTML = '&nbsp;';
      d.style.height = '14px';
      box.appendChild(d);
      wrap.scrollTop = wrap.scrollHeight;
      return;
    }

    var hasLeadingTs = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str);

    if (!hasLeadingTs) {
      var timeFormatted = '';
      if (ts) {
        try {
          timeFormatted = '[' + new Date(ts).toLocaleTimeString() + '] ';
        } catch(e){}
      }
      if (!timeFormatted) {
        timeFormatted = '[' + new Date().toLocaleTimeString() + '] ';
      }
      var spanTs = document.createElement('span');
      spanTs.className = 'ts';
      spanTs.textContent = timeFormatted;
      d.appendChild(spanTs);
      d.appendChild(document.createTextNode(str));
    } else {
      // Tô màu timestamp có sẵn ở đầu chuỗi
      var match = str.match(/^(\[[^\]]+\])\s*(.*)$/);
      if (match) {
        var spanTs = document.createElement('span');
        spanTs.className = 'ts';
        spanTs.textContent = match[1] + ' ';
        d.appendChild(spanTs);
        d.appendChild(document.createTextNode(match[2]));
      } else {
        d.textContent = str;
      }
    }

    if (level === 'error' || str.indexOf('[ERROR]') >= 0 || str.indexOf('❌') >= 0 || str.indexOf('Error:') >= 0) {
      d.className = 'err';
    } else if (level === 'warn' || str.indexOf('[WARN]') >= 0 || str.indexOf('⚠️') >= 0) {
      d.className = 'warn';
    }
    box.appendChild(d);
    cnt.textContent = box.childElementCount + ' dòng — /api/logs';
    wrap.scrollTop = wrap.scrollHeight;
  }

  function clearLogs(){
    if (!confirm('Bạn có chắc muốn xóa toàn bộ logs?')) return;
    fetch('/api/logs/clear', { method: 'POST' }).then(function(r){ return r.json(); }).then(function(d){
      box.innerHTML = '';
      appendLine('[System] Logs cleared at ' + new Date().toLocaleTimeString());
    }).catch(function(e){
      alert('Lỗi xóa logs: ' + e.message);
    });
  }

  // 1. Tải log lịch sử: ưu tiên /logs (kết hợp RAM + đĩa cứng) và /api/logs
  function loadInitialLogs(){
    box.innerHTML = '';
    fetch('/logs').then(function(r){ return r.json(); }).then(function(d){
      box.innerHTML = '';
      if (d && Array.isArray(d.lines) && d.lines.length > 0) {
        d.lines.forEach(function(l){ appendLine(l); });
      } else {
        // Fallback /api/logs
        fetch('/api/logs?limit=500').then(function(r2){ return r2.json(); }).then(function(data){
          if (data && Array.isArray(data.logs) && data.logs.length > 0) {
            box.innerHTML = '';
            data.logs.forEach(function(item){
              var line = typeof item === 'string' ? item : (item.message || JSON.stringify(item));
              appendLine(line, item.level, item.timestamp);
            });
          }
        });
      }
      if (box.childElementCount === 0) {
        appendLine('[System] Terminal ready. Log stream active.');
      }
      wrap.scrollTop = wrap.scrollHeight;
    }).catch(function(){
      fetch('/api/logs?limit=500').then(function(r){ return r.json(); }).then(function(data){
        box.innerHTML = '';
        if (data && Array.isArray(data.logs) && data.logs.length > 0) {
          data.logs.forEach(function(item){
            var line = typeof item === 'string' ? item : (item.message || JSON.stringify(item));
            appendLine(line, item.level, item.timestamp);
          });
        } else {
          appendLine('[System] Terminal ready. Log stream active.');
        }
        wrap.scrollTop = wrap.scrollHeight;
      });
    });
  }

  loadInitialLogs();

  // 2. Lắng nghe log realtime qua WebSocket (chính) và EventSource (dự phòng)
  var ws = null;
  function connectTerminalWS(){
    try {
      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(proto + '//' + location.host + '/terminal?logs=1');
      ws.onopen = function(){
        try { ws.send(JSON.stringify({ type: 'subscribe', logs: true, channel: 'terminal' })); } catch(e){}
      };
      ws.onmessage = function(ev){
        try {
          var m = JSON.parse(ev.data);
          if (m.type === 'terminal:line' && m.line) {
            appendLine(m.line, undefined, m.timestamp);
          } else if (m.type === 'log:entry' && m.entry) {
            var txt = typeof m.entry === 'string' ? m.entry : (m.entry.message || JSON.stringify(m.entry));
            appendLine(txt, m.entry.level, m.entry.timestamp);
          }
        } catch(e){}
      };
      ws.onclose = function(){
        setTimeout(connectTerminalWS, 2000);
      };
      ws.onerror = function(){
        try { ws.close(); } catch(e){}
      };
    } catch(e){
      setTimeout(connectTerminalWS, 3000);
    }
  }

  connectTerminalWS();

  // Fallback song song EventSource nếu WebSocket bị chặn
  var es = new EventSource('/api/events?logs=1');
  es.onmessage = function(ev){
    try {
      // Nếu WS đang mở và truyền tin bình thường thì bỏ qua SSE để tránh đúp dòng log
      if (ws && ws.readyState === 1) return;
      var m = JSON.parse(ev.data);
      if (m.type === 'terminal:line' && m.line) {
        appendLine(m.line, undefined, m.timestamp);
      } else if (m.type === 'log:entry' && m.entry) {
        var txt = typeof m.entry === 'string' ? m.entry : (m.entry.message || JSON.stringify(m.entry));
        appendLine(txt, m.entry.level, m.entry.timestamp);
      }
    } catch(e){}
  };
  es.onerror = function(){ /* keepalive reconnect tự động */ };
</script>
</body>
</html>
`;
    res.type('html').send(html);
  });

  return router;
}
