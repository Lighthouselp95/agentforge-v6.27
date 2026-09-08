# Chương 3: Keepalive Fix & Server Runtime

## 3.1 Keepalive Ping/Pong

Server code (websockets.serve):
```python
websockets.serve(
    handler,
    host="0.0.0.0",
    port=8766,
    ssl=ssl_context,
    ping_interval=2,      # Gửi ping mỗi 2s
    ping_timeout=5,       # Chờ pong 5s
    max_size=2**24,       # 16MB max message
    max_queue=10,         # Max queued messages
)
```

## 3.2 Why Keepalive?

- NAT/firewall timeout
- Connection idle detection
- Prevent proxy timeout

## 3.3 Client-Side

```javascript
const ws = new WebSocket(url, protocols);
ws.binaryType = 'arraybuffer';

// Client tự ping nếu server không ping
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 5000);
```

## 3.4 Server Runtime

- Port 8765: HTTPS control
- Port 8766: WSS Video
- Port 8767: WSS Audio
- Encoder: NVENC → QSV → x264 fallback
- Backpressure: WRITE_BUFFER_LIMIT=2MiB

## 3.5 Restart Method

```powershell
$ws = New-Object -ComObject WScript.Shell
$ws.Run('python "server_H264wss_testP_new.py" --always-run', 0, $false)
```