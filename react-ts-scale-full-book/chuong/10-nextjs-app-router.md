# Chương 10: Next.js App Router - Server App Trong Tay

> "Next.js không phải framework. Nó là ecosystem."

## 10.1 File-Based Routing

```
app/
├── layout.tsx          # Root layout
├── page.tsx            # /
├── about/page.tsx      # /about
├── blog/[slug]/page.tsx # /blog/my-post
└── api/users/route.ts  # /api/users
```

## 10.2 Server vs Client Component

**Server Component (mặc định):** Chạy trên server, fetch DB, không có state/hooks.

```tsx
export default async function Page() {
  const posts = await fetchPosts();  // fetch trực tiếp
  return <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>;
}
```

**Client Component:** Cần `"use client"`, dùng hooks, state, event.

```tsx
"use client";
import { useState } from "react";
export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c + 1)}>Count: {count}</button>;
}
```

## 10.3 Layout & Nested Layout

```tsx
// Root layout
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}

// Nested layout
export default function DashboardLayout({ children }) {
  return <div className="dashboard"><Sidebar />{children}</div>;
}
```

## 10.4 Streaming & Suspense

```tsx
import { Suspense } from "react";

async function SlowComponent() {
  const data = await fetch("https://api.example.com/data").then(r => r.json());
  return <Dashboard data={data} />;
}

export default async function Page() {
  return (
    <>
      <Header />
      <Suspense fallback={<Skeleton />}>
        <SlowComponent />
      </Suspense>
    </>
  );
}
```

## 10.5 Server Actions

```tsx
// Server Action
"use server";
import { revalidatePath } from "next/cache";

export async function createTask(formData: FormData) {
  const title = formData.get("title") as string;
  await db.task.create({ title });
  revalidatePath("/tasks");
}

// Client Component gọi
"use client";
import { createTask } from "@/app/actions";

export function TaskForm() {
  return (
    <form action={createTask}>
      <input name="title" />
      <button type="submit">Create</button>
    </form>
  );
}
```

## 10.6 Data Fetching Cache

```tsx
// Không cache
const data = await fetch(url, { cache: "no-store" });

// ISR 60s
const data = await fetch(url, { next: { revalidate: 60 } });
```

## 10.7 Middleware

```ts
// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const token = request.cookies.get("token")?.value;
  if (request.nextUrl.pathname.startsWith("/dashboard") && !token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}
```

## 10.8 Bài tập

### Bài 1: Auth App
Tạo app Next.js với auth middleware, Server Component, Server Action.

### Bài 2: Blog with ISR
Tạo blog ISR revalidate 60s, dynamic routes.

### Bài 3: Dashboard Streaming
Tạo dashboard streaming với Suspense.

> Sang Chương 11 để học Kiến Trúc Scale.
