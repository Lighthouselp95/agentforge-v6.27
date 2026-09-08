# Chương 11: Kiến Trúc App Easy Scale

> App nhỏ code kiểu gì cũng chạy. App lớn mà kiến trúc sai thì càng code càng chết.

### 11.1 Kiến trúc tổng quan cho Scale 1M user

```
[ User Browser ]
       |
       v
[ CDN / Cloudflare Edge ]  <-- Cache static assets, HTML tĩnh
       |
       v
[ Load Balancer ]           <-- Phân phối traffic đến server
       |
       v
[ Next.js Server (Stateless) ]  <-- SSR, ISR, API
       |
       v
[ tRPC / Hono API ]       <-- Validate, Business logic
       |
       v
[ PostgreSQL + Redis + S3 ]  <-- DB + Cache + Media
```

**Quy tắc Scale:**
- Server **stateless** -> thêm server là xong
- Cache 3 tầng: Browser Cache -> CDN -> Redis -> DB
- Database read replica cho read-heavy

### 11.2 Monorepo với Turborepo

Cấu trúc chuẩn 2024 cho nhiều team:

```
my-app/
├── apps/
│   ├── web/                 # Next.js 15 App Router (Server App chính)
│   │   ├── app/
│   │   ├── app/api/
│   │   └── next.config.mjs
│   └── admin/               # Vite SPA (Admin nội bộ, không cần SEO)
│       ├── src/
│       └── vite.config.ts
├── packages/
│   ├── ui/                  # Design System (Tailwind + CVA) - Vite Library Mode
│   │   ├── src/components/
│   │   └── package.json     # publish npm private
│   ├── database/            # Prisma schema + client
│   │   ├── prisma/
│   │   └── package.json
│   ├── eslint-config/       # Shared ESLint config
│   └── tsconfig/            # Shared TS config
├── turbo.json
├── package.json
└── docker-compose.yml
```

**Turborepo pipeline:**
```json
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "lint": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```
```powershell
# Build tất cả
pnpm turbo run build

# Build chỉ web
pnpm turbo run build --filter=web
```

### 11.3 Feature-Sliced Design (FSD)

Tránh folder `components/` 200 file rối. Chia theo feature:

```
app/
├── features/
│   ├── task/
│   │   ├── components/TaskCard.tsx
│   │   ├── hooks/useTasks.ts
│   │   ├── api/task.api.ts
│   │   ├── model/task.schema.ts  (Zod)
│   │   └── ui/TaskList.tsx
│   └── auth/
│       ├── components/LoginForm.tsx
│       ├── hooks/useAuth.ts
│       └── api/auth.api.ts
├── shared/
│   ├── lib/
│   │   ├── fetcher.ts
│   │   ├── api-client.ts
│   │   └── cn.ts  (classnames helper)
│   ├── hooks/
│   │   ├── useDebounce.ts
│   │   └── useMediaQuery.ts
│   └── components/
│       ├── Button.tsx
│       ├── Input.tsx
│       └── Spinner.tsx
└── widgets/
    ├── Header/
    └── Sidebar/
```

**Quy tắc FSD:**
- `features` KHÔNG được import code của `features` khác
- `features` chỉ import từ `shared` và `widgets`
- `widgets` import từ `features` và `shared`
- `app` import từ `features`, `widgets`, `shared`

### 11.4 Next.js Server Architecture Chi Tiết

```
Request -> Middleware (Auth, i18n) -> Layout (Server Component, async)
-> Page (Server Component, async fetch DB)
-> Streaming + Suspense cho chậm
-> Client Component (interactive)
```

**Server Component:**
- Mặc định, không cần `"use client"`
- `async` được, `await` fetch DB trực tiếp
- Không dùng `useState`, `useEffect`, `onClick`
- Có thể `import` Client Component

**Client Component:**
- Phải có `"use client"` ở đầu file
- Dùng hooks, state, event
- Không fetch DB trực tiếp (phải qua Server Component hoặc API)

### 11.5 Database Design cho Scale

```
PostgreSQL (Primary)
├── Read Replica 1
├── Read Replica 2
└── Read Replica 3

Redis (Cache Layer)
├── Session cache
├── Query cache (TanStack Query server cache)
└── Rate limiter

S3 / Cloudflare R2 (Media)
├── User avatars
├── Uploaded files
└── Static assets
```

### 11.6 Caching Strategy Chi Tiết

```ts
// 1. Browser Cache - static assets
// vite.config.ts
build: {
  rollupOptions: {
    output: {
      entryFileNames: 'assets/[name]-[hash].js',
      chunkFileNames: 'assets/[name]-[hash].js',
      assetFileNames: 'assets/[name]-[hash].[ext]',
    },
  },
}
// CDKNginx config: proxy_cache_valid 200 30d;

// 2. CDN Cache - HTML tĩnh
// Next.js ISR revalidate 60s -> CDN cache 60s

// 3. Redis Cache - Query cache
// TanStack Query Server Cache -> Redis
import { QueryClient, QueryCache } from '@tanstack/react-query';

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    defaults: {
      gcTime: 10 * 60 * 1000,    // 10 phút xóa khỏi memory cache
      staleTime: 5 * 60 * 1000,  // 5 phút không fetch lại
    },
  }),
});
```

### 11.7 Bài tập
Thiết kế kiến trúc cho app clone Jira mini:
- Team A làm Web (Next.js)
- Team B làm Admin (Vite SPA)
- Team C làm Mobile API (NestJS)
- Shared packages: `ui`, `database`, `types`
Vẽ diagram và giải thích tại sao mỗi team không đụng code nhau.

> Xem code mẫu chi tiết ở `code-mau/vite-spa/`, `code-mau/vite-lib/`, `code-mau/nextjs-app/`

---

## Phụ Lục

### Checklist Scale
- [ ] TypeScript strict mode
- [ ] ESLint + Prettier
- [ ] Code splitting (Vite/Next.js)
- [ ] CDN cho static
- [ ] Redis cache layer
- [ ] PostgreSQL read replicas
- [ ] Health check endpoint
- [ ] CI/CD pipeline
- [ ] Docker + compose
- [ ] Error monitoring (Sentry)
- [ ] Rate limiter
- [ ] CORS config

### Câu hỏi phỏng vấn thường gặp
1. **Difference between useMemo and useCallback?**
   - `useMemo` cache **value** (result of computation)
   - `useCallback` cache **function reference** (so child doesn't re-render)

2. **When to use Server Component vs Client Component?**
   - Server: fetch data, SEO, static
   - Client: interactivity, hooks, state

3. **ISR vs SSR?**
   - SSR: fetch every request
   - ISR: serve cached, revalidate after time

4. **Why Monorepo?**
   - Share code, single install, coordinated changes, easier refactor

5. **Zustand vs Redux?**
   - Zustand: simpler, no Provider, selectors built-in
   - Redux: more middleware, larger ecosystem

---

## Tài Liệu Tham Khảo
- [React Docs](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs)
- [Next.js Docs](https://nextjs.org/docs)
- [TanStack Query](https://tanstack.com/query)
- [Zustand](https://github.com/pmndrs/zustand)
- [Turborepo](https://turbo.build/repo)
- [Feature-Sliced Design](https://feature-sliced.design)
