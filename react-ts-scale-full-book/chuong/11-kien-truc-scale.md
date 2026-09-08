# Chương 11: Kiến Trúc App Easy Scale

> "App nhỏ code kiểu gì cũng chạy. App lớn mà kiến trúc sai thì càng code càng chết."

## 11.1 Kiến Trúc Tổng Quan

```
[Browser] → [CDN] → [Load Balancer] → [Next.js Server (Stateless)] → [tRPC/Hono API] → [PostgreSQL + Redis + S3]
```

**Quy tắc Scale:**
- Server stateless → thêm server là xong
- Cache 3 tầng: Browser → CDN → Redis → DB
- Database read replica cho read-heavy

## 11.2 Monorepo với Turborepo

```
my-app/
├── apps/
│   ├── web/           # Next.js 15
│   └── admin/         # Vite SPA
├── packages/
│   ├── ui/            # Design System
│   ├── database/      # Prisma
│   └── tsconfig/      # Shared config
├── turbo.json
└── package.json
```

```json
{
  "pipeline": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "lint": { "dependsOn": ["^build"] }
  }
}
```

## 11.3 Feature-Sliced Design

```
app/
├── features/          # Business features
│   ├── task/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── api/
├── shared/            # Shared utilities
│   ├── lib/
│   ├── hooks/
│   └── components/
└── widgets/           # Page blocks
```

**Quy tắc:** features không import features khác.

## 11.4 Database Design

- PostgreSQL Primary + Read Replicas
- Redis cache layer
- S3/R2 cho media

## 11.5 Bài tập

### Bài 1: Monorepo Setup
Tạo monorepo với Turborepo, 2 apps, 1 shared package.

### Bài 2: FSD Architecture
Tạo feature với FSD: components, hooks, api, model.

### Bài 3: Database Design
Thiết kế schema cho app task management.

> Sang Chương 12 để học Testing & CI/CD.
