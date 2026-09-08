# Chương 1: Server SSL/TLS - Deep Analysis

> "Server không bật SSL/TLS đúng cách = traffic bị người ngoài đọc được."

## 1.1 SSL/TLS Là Gì?

SSL (Secure Sockets Layer) cũ, TLS (Transport Layer Security) mới. Thư viện Python `ssl` dùng TLS thực tế.

**Mục đích:**
- Mã hóa traffic giữa client ↔ server
- Xác thực server (certificate)
- Đảm bảo data integrity (không bị sửa giữa đường)

## 1.2 Server Xemmanhinh SSL/TLS Flow

```
Client (curl/browser)
    ↓ TLS Handshake
Server (server_H264wss_testP_new.py)
    ↓ SSLContext(PROTOCOL_TLS_SERVER)
    ↓ load_cert_chain(cert.pem, key.pem)
    ↓ TLS 1.2/1.3
Encrypted Connection Established
```

## 1.3 Phân Tích Code `_make_ssl_context()`

```python
def _make_ssl_context(self):
    """Tạo SSL context cho WSS server"""
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    
    # Load certificate chain
    context.load_cert_chain(
        certfile="cert.pem",      # Public certificate
        keyfile="key.pem"         # Private key
    )
    
    # Cipher suites - chọn cipher mạnh
    context.set_ciphers('ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:DHE+CHACHA20:!aNULL:!MD5:!DSS')
    
    # Minimum TLS version
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    
    return context
```

**Phân tích:**
- `PROTOCOL_TLS_SERVER`: dùng TLS mới nhất server hỗ trợ
- `load_cert_chain`: load cert + key từ file
- `set_ciphers`: chỉ cho phép cipher mạnh (AES-GCM, ChaCha20)
- `minimum_version = TLSv1_2`: bỏ TLS 1.0/1.1 (cũ, có lỗ hổng)

## 1.4 Certificate Files

### cert.pem - Public Certificate
```
-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJAKHBfpE...
... (nội dung certificate)
-----END CERTIFICATE-----
```

- Chứa public key
- Có thể chia sẻ công khai
- Client dùng để mã hóa data gửi đến server

### key.pem - Private Key
```
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
... (nội dung private key)
-----END RSA PRIVATE KEY-----
```

- Chứa private key
- **PHẢI GIỮ BÍ MẬT** - không commit lên git
- Server dùng để giải mã data từ client

### Quan hệ Public/Private Key
```
Client → Mã hóa bằng Public Key → Server
Server → Giải mã bằng Private Key → Đọc được data
```

## 1.5 TLS Handshake Process

```
1. Client Hello
   - Client gửi: TLS version, cipher suites, random number

2. Server Hello
   - Server chọn: TLS version, cipher suite
   - Server gửi: Certificate (cert.pem), random number

3. Key Exchange
   - Client tạo pre-master secret
   - Mã hóa bằng public key từ cert.pem
   - Gửi đến server

4. Session Keys
   - Server giải mã bằng private key (key.pem)
   - Cả 2 bên tạo session keys từ 2 random numbers

5. Encrypted Communication
   - Tất cả traffic sau đó mã hóa bằng session keys
```

## 1.6 Lỗi TLS Renegotiation Loop (Đã Phân Tích)

**Triệu chứng:**
```
curl: (35) SSL renegotiation failed
```

**Nguyên nhân:**
- Client gửi request lớn (> 16KB) sau khi handshake xong
- Server yêu cầu TLS renegotiation
- Một số client (curl Windows, schannel) có bug với renegotiation
- Lặp lại liên tục → connection fail

**Giải pháp:**
```python
# Tăng buffer size để tránh renegotiation
context.set_ciphers('ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:DHE+CHACHA20:!aNULL:!MD5:!DSS')
# Hoặc disable renegotiation nếu cần
# context.renegotiate = False  # Python 3.7+
```

## 1.7 SSL/TLS Debug Logging

```python
import ssl
import logging

# Enable SSL debug logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger('ssl')

# Wrap socket với debug
ssl_socket = context.wrap_socket(
    client_socket,
    server_side=True,
    do_handshake_on_connect=True
)

# Log handshake details
logger.debug(f"SSL version: {ssl_socket.version()}")
logger.debug(f"Cipher: {ssl_socket.cipher()}")
logger.debug(f"Peer cert: {ssl_socket.getpeercert()}")
```

## 1.8 Certificate Auto-renewal (Let's Encrypt)

```bash
# Install certbot
sudo apt install certbot

# Get certificate
sudo certbot certonly --standalone -d yourdomain.com

# Auto-renewal (cron job)
0 0 * * 0 certbot renew --quiet

# Test renewal
sudo certbot renew --dry-run
```

## 1.9 SSL/TLS Best Practices

| Check | Status | Lý do |
|:---|:---|:---|
| TLS 1.2 minimum | ✅ | TLS 1.0/1.1 có lỗ hổng |
| Strong ciphers | ✅ | AES-GCM, ChaCha20 |
| Certificate valid | ✅ | Not expired |
| Private key secure | ✅ | 600 permissions |
| HSTS header | ❌ | Chưa có |
| OCSP stapling | ❌ | Chưa có |

### HSTS Header (Thêm vào server)
```python
def add_security_headers(handler):
    handler.send_header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    handler.send_header('X-Content-Type-Options', 'nosniff')
    handler.send_header('X-Frame-Options', 'DENY')
```

## 1.10 Testing SSL/TLS

```bash
# Test with openssl
openssl s_client -connect localhost:8765 -servername localhost

# Test TLS version
openssl s_client -connect localhost:8765 -tls1_2
openssl s_client -connect localhost:8765 -tls1_3

# Test cipher suites
openssl s_client -connect localhost:8765 -cipher 'ECDHE+AESGCM'

# Check certificate
openssl x509 -in cert.pem -text -noout
```

## 1.11 Bài tập

### Bài 1: Generate Self-Signed Cert
Tạo self-signed cert cho development:
```bash
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
```

### Bài 2: Harden SSL/TLS Config
Cải thiện SSL config với:
- TLS 1.3 only
- Strong cipher suites
- HSTS headers
- OCSP stapling

### Bài 3: Debug SSL Issues
Sử dụng Wireshark để capture TLS handshake và phân tích lỗi.

> Sang Chương 2 để học Encoder Config Deep Dive.
