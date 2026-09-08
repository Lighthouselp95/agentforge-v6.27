# Chương 2: Encoder Config Deep Dive

> "Encoder sai = video lag, FPS tụt, viewer disconnect."

## 2.1 3-Tier Fallback Encoder

Server Xemmanhinh dùng chuỗi fallback:
```
NVENC (NVIDIA) → QSV (Intel) → libx264 (CPU fallback)
```

## 2.2 NVENC Config

preset=p5
tune=ll
rc=constqp
qp=16
bitrate=20M
maxrate=20M
bufsize=12M
keyint=150

## 2.3 QSV Config

preset=veryfast
tune=zerolatency
maxrate=4M
bufsize=2M

## 2.4 libx264 Config

preset=ultrafast
crf=26
maxrate=4M
bufsize=2M
