# Chương 4: Xemmanhinh Server Architecture

## 4.1 Server File Structure

```
C:\Users\Hai Dang\Xemmanhinh\
├── server\
│   ├── server_H264wss_testP_new.py  # Main server
│   └── service\
│       └── service_launcher.py      # Service launcher
├── wgl\
│   └── P_wgl.html                   # WebGL viewer
└── web\
    └── P_new.html                   # New viewer
```

## 4.2 Server Components

- HTTPS control server (8765)
- WSS Video server (8766)
- WSS Audio server (8767)
- H.264 encoder pipeline
- Session management
- Keepalive monitor

## 4.3 Service Launcher

```python
# service_launcher.py line 347
# Prioritizes server_H264wss_testP_new.py
if os.path.exists("server_H264wss_testP_new.py"):
    run("pythonw.exe server_H264wss_testP_new.py --always-run")
else:
    run("pythonw.exe server_H264wss.py")
```

## 4.4 Client Viewers

- P_new.html: Latest viewer
- P_wgl.html: WebGL viewer
- Connect via WSS 8766/8767
- Receive H.264 frames
- Decode and render
