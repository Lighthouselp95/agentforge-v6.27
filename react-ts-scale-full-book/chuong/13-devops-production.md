# Chương 13: DevOps & Production

> "Deploy xong chưa phải xong. Bảo trì mới là sống."

## 13.1 Docker cho React App

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

```yaml
# docker-compose.yml
services:
  web:
    build: .
    ports: ["3000:80"]
    environment:
      - NODE_ENV=production
```

## 13.2 Nginx Config

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
}
```

## 13.3 Monitoring & Error Tracking

```tsx
// Sentry
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "https://your-dsn@sentry.io/project-id",
  environment: import.meta.env.MODE,
});

// Error Boundary với Sentry
<ErrorBoundary fallback={<ErrorPage />}>
  <App />
</ErrorBoundary>
```

## 13.4 Performance Monitoring

```tsx
// Web Vitals
import { onCLS, onFID, onLCP } from "web-vitals";

function sendToAnalytics(metric) {
  console.log(metric);  // Send to your analytics
}

onCLS(sendToAnalytics);
onFID(sendToAnalytics);
onLCP(sendToAnalytics);
```

## 13.5 Security Checklist

- [ ] HTTPS everywhere
- [ ] CSP headers
- [ ] CORS configured
- [ ] XSS protection
- [ ] Rate limiting
- [ ] Input validation
- [ ] Auth token refresh
- [ ] Environment variables secured

## 13.6 Deployment Platforms

| Platform | Best For | Free Tier |
|:---|:---|:---|
| Vercel | Next.js apps | Yes |
| Netlify | Static/JAMstack | Yes |
| AWS Amplify | Full-stack | Yes |
| Cloudflare Pages | Static + Workers | Yes |
| Fly.io | Docker apps | Yes |
| Railway | Quick deploy | Yes |

## 13.7 Checklist Deploy Production

```markdown
## Pre-deploy
- [ ] All tests passing
- [ ] No console.log in production
- [ ] Environment variables set
- [ ] Build succeeds
- [ ] Lighthouse score > 90

## Deploy
- [ ] Docker image built
- [ ] Container running
- [ ] Health check endpoint
- [ ] SSL/TLS configured

## Post-deploy
- [ ] Smoke test
- [ ] Monitoring active
- [ ] Error tracking active
- [ ] Backup strategy
```

## 13.8 Bài tập

### Bài 1: Docker Setup
Tạo Dockerfile + docker-compose.yml cho Next.js app.

### Bài 2: CI/CD Pipeline
Tạo GitHub Actions workflow: lint → test → build → deploy.

### Bài 3: Monitoring Setup
Setup Sentry + Web Vitals cho production app.

---

# Tổng Kết

Bạn đã hoàn thành 14 chương từ Zero đến Production.

**Nắm vững:**
- TypeScript type system
- React patterns & hooks
- Server rendering strategies
- Build optimization
- State management
- Form validation
- Data fetching & cache
- Testing & CI/CD
- DevOps & Production

**Next Steps:**
1. Build 1 project thực tế (clone 1 app nổi tiếng)
2. Deploy lên Vercel/Netlify
3. Viết blog chia sẻ kinh nghiệm
4. Đọc source code开源 projects

> Hành trình học code không bao giờ kết thúc. Bắt đầu ngay!
