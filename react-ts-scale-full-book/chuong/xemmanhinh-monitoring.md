# Chương 6: Server Monitoring & Debugging

## 6.1 Log Monitoring

```python
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('server.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)

# Usage
logger.info(f"Server started on port 8765")
logger.warning(f"High CPU usage: {cpu_percent}%")
logger.error(f"Encoder error: {e}")
```

## 6.2 Health Check Endpoint

```python
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "uptime": time.time() - start_time,
        "connections": active_connections,
        "encoder": encoder_status,
        "memory": psutil.virtual_memory().percent
    }
```

## 6.3 Performance Monitoring

```python
import psutil
import time

class PerformanceMonitor:
    def __init__(self):
        self.start_time = time.time()
    
    def get_stats(self):
        return {
            "cpu_percent": psutil.cpu_percent(),
            "memory": psutil.virtual_memory()._asdict(),
            "network": psutil.net_io_counters()._asdict(),
            "uptime": time.time() - self.start_time
        }
```

## 6.4 Debug Commands

```bash
# Check server status
netstat -ano | findstr ":8765"

# Check process
tasklist | findstr pythonw

# View logs
tail -f server.log

# Test SSL
openssl s_client -connect localhost:8765

# Test WSS
wscat -c wss://localhost:8766

# Check encoder
ffmpeg -encoders | grep -E "h264|nvenc|qsv"
```

## 6.5 Common Issues

| Issue | Symptom | Fix |
|:---|:---|:---|
| Port in use | OSError | Kill old process, retry |
| SSL error | SSL renegotiation | Increase buffer, disable renegotiation |
| Encoder fallback | Low FPS | Install NVENC/QSV driver |
| Memory leak | RAM increases | Check buffer limits, fix leaks |
| High CPU | Lag | Use hardware encoder |

## 6.6 Troubleshooting Checklist

- [ ] Port 8765/8766/8767 listening
- [ ] cert.pem và key.pem đúng
- [ ] Encoder driver installed (NVENC/QSV)
- [ ] Python version 3.8+
- [ ] Required packages installed (websockets, opencv, numpy)
- [ ] Firewall not blocking ports
- [ ] No other process using same ports
