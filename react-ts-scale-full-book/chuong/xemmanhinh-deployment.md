# Chương 5: Server Deployment & Ops

## 5.1 PowerShell Startup Script

```powershell
# start-xemmanhinh.ps1
$serverDir = "C:\Users\Hai Dang\Xemmanhinh\server"
$serverScript = "server_H264wss_testP_new.py"
$pythonw = "pythonw.exe"

# Kill old processes
Get-Process pythonw -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2

# Start server
Set-Location $serverDir
$ws = New-Object -ComObject WScript.Shell
$ws.Run("$pythonw $serverScript --always-run", 0, $false)

# Wait and verify
Start-Sleep 3
$listening = netstat -ano | Select-String ":8765.*LISTENING"
if ($listening) {
    Write-Host "Server started successfully"
} else {
    Write-Host "Server failed to start"
}
```

## 5.2 Service Installation

```powershell
# Install as Windows service (NSSM)
nssm install XemmanhinhService "C:\Python39\python.exe" "C:\Users\Hai Dang\Xemmanhinh\server\server_H264wss_testP_new.py --always-run"
nssm start XemmanhinhService
```

## 5.3 Firewall Rules

```powershell
# Open ports
New-NetFirewallRule -DisplayName "Xemmanhinh HTTPS" -Direction Inbound -Protocol TCP -LocalPort 8765 -Action Allow
New-NetFirewallRule -DisplayName "Xemmanhinh WSS Video" -Direction Inbound -Protocol TCP -LocalPort 8766 -Action Allow
New-NetFirewallRule -DisplayName "Xemmanhinh WSS Audio" -Direction Inbound -Protocol TCP -LocalPort 8767 -Action Allow
```

## 5.4 Environment Variables

```powershell
# .env
SERVER_HOST=0.0.0.0
SERVER_PORT_HTTPS=8765
SERVER_PORT_WSS_VIDEO=8766
SERVER_PORT_WSS_AUDIO=8767
CERT_FILE=cert.pem
KEY_FILE=key.pem
LOG_LEVEL=INFO
ENCODER_PRESET=veryfast
```
