# REACT + TYPESCRIPT + SCALE - Full Course 2024-2025

## Xây Web App Server-Side Dễ Scale - Từ Zero đến Production

**Stack:** React 19 + TypeScript 5.5+ + Next.js 15 (App Router) + Vite 6 + Tailwind 4 + Prisma 6 + Turborepo + NestJS + tRPC + XState
**Mục tiêu:** Học xong tự build + deploy app chịu được 1M user, dễ mở rộng team.

**Yêu cầu đầu vào:** Biết JS cơ bản (biến, hàm, async/await, DOM).
**Lộ trình:** 6 tuần - mỗi chương 3-5 giờ học + code thực hành.

---

## 18 Chương - 5 Phần Lớn

```
PHẦN A - NỀN TẢNG (Chương 0-2)
─────────────────────────────────────────────────────────
Ch 0: Nhập môn & Cài đặt
Ch 1: TypeScript Cơ Bản cho React
Ch 2: TypeScript Nâng Cao (Generics, Conditional, Utility)

PHẦN B - REACT CORE (Chương 3-7)
─────────────────────────────────────────────────────────
Ch 3: React Modern & Concurrent
Ch 4: Component Patterns (10+ patterns)
Ch 5: State Management Toàn Diện
Ch 6: Form & Validation
Ch 7: Data Fetching & Cache (TanStack Query)

PHẦN C - SERVER & SCALE (Chương 8-11)
─────────────────────────────────────────────────────────
Ch 8:  Server Concepts (CSR/SSR/SSG/ISR/PPR)
Ch 9:  Vite Build System (4 kiểu build)
Ch 10: Next.js App Router Full
Ch 11: Kiến Trúc Scale 1M User (Monorepo, FSD)

PHẦN D - TYPESCRIPT ARCHITECTURE (Chương 12-15)
─────────────────────────────────────────────────────────
Ch 12: Testing & CI/CD
Ch 13: DevOps & Production
Ch 14: Server-Side Node.js (Express/NestJS/tRPC/Hono)
Ch 15: TypeScript Architecture Patterns
       (Design Patterns, Clean Architecture, DDD, CQRS, State Machines, DI)

PHẦN E - INTEGRATION & MICROSERVICES (Chương 16-17)
─────────────────────────────────────────────────────────
Ch 16: Database ORM & Real-time (Prisma/WebSocket/SSE)
Ch 17: Microservices & Integration
       (Message Queue, Payment, Email, File Upload, Micro-frontend)
```

---

## Cải tiến so với bản cũ

| Tiêu chí | Bản cũ | Bản mới (18 chương) |
|:---|:---|:---|
| Số chương | 12 | **18** (+6 chương mới) |
| TypeScript Architecture | Không có | **Design Patterns, Clean Arch, DDD, CQRS** |
| Server-side | Cơ bản | **Express, NestJS, tRPC, Hono** |
| Database ORM | Không có | **Prisma, Drizzle** |
| Real-time | Không có | **WebSocket, SSE** |
| Microservices | Không có | **Message Queue, Payment, Email** |
| Testing | Không có | **Vitest, RTL, Playwright** |
| DevOps | Không có | **Docker, CI/CD, Monitoring** |

---

## Cấu trúc sách

```
react-ts-scale-full-book/
├── README.md                    (file này)
├── chuong/
│   ├── 00-nhap-mon.md
│   ├── 01-typescript-co-ban.md
│   ├── 02-typescript-nang-cao.md
│   ├── 03-react-modern.md
│   ├── 04-component-patterns.md
│   ├── 05-state-management.md
│   ├── 06-form-validation.md
│   ├── 07-data-fetching.md
│   ├── 08-server-app-concepts.md
│   ├── 09-vite-build.md
│   ├── 10-nextjs-app-router.md
│   ├── 11-kien-truc-scale.md
│   ├── 12-testing-cicd.md
│   ├── 13-devops-production.md
│   ├── 14-server-nodejs-architecture.md
│   ├── 15-typescript-architecture-patterns.md
│   ├── 16-database-realtime.md
│   └── 17-microservices-integration.md
├── code-mau/
│   ├── vite-spa/
│   ├── vite-lib/
│   ├── nextjs-app/
│   ├── nestjs-app/
│   └── monorepo/
└── phu-luc/
    ├── checklist-scale.md
    ├── cau-hoi-phong-van.md
    └── error-handling-patterns.md
```

## Cách học

1. **Đọc theo thứ tự 0 → 17**
2. **Mỗi chương:** Đọc lý thuyết → Code theo mẫu → Làm bài tập cuối chương → Viết notes cá nhân
3. **Phần A (Ch 0-2):** Nền tảng, không được skip
4. **Phần B (Ch 3-7):** React core, phải làm hết bài tập
5. **Phần C (Ch 8-11):** Server & Scale, áp dụng vào project thật
6. **Phần D (Ch 12-15):** Architecture, hiểu design patterns & clean architecture
7. **Phần E (Ch 16-17):** Integration, build real-world features

## Yêu cầu cài đặt

```powershell
# Node 20 LTS
winget install OpenJS.NodeJS.LTS
node -v && pnpm --version

# VSCode extensions
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
code --install-extension bradlc.vscode-tailwindcss
code --install-extension dsznajder.es7-react-js-snippets
code --install-extension prisma.prisma
```

Bắt đầu từ `chuong/00-nhap-mon.md`.
