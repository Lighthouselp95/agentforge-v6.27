# Chương 10: Next.js App Router - Server App Trong Tay

### 10.1 Next.js 15 App Router - Cơ Chế

App Router sử dụng **File-based routing** + **React Server Components** mặc định.

```
app/
├── layout.tsx          # Root layout (wrap toàn bộ app)
├── page.tsx            # Trang chủ /
├── about/
│   ├── page.tsx        # Trang /about
│   └── layout.tsx      # Layout cho /about
├── blog/
│   ├── [slug]/
│   │   └── page.tsx    # Trang động /blog/my-post
│   └── page.tsx        # Trang /blog
└── api/
    └── users/
        └── route.ts    # API route (Server Action)
```

### 10.2 Server Component vs Client Component

**Mặc định là Server Component** - chạy trên server, có thể fetch DB, cache.

```tsx
// Server Component (mặc định) - không thể dùng useState, useEffect
export default async function Page() {
  const posts = await fetchPosts();  // fetch trực tiếp, không cần API layer
  return (
    <ul>
      {posts.map(post => <PostCard key={post.id} post={post} />)}
    </ul>
  );
}
```

```tsx
// Client Component - cần "use client" ở đầu file
'use client';
import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c + 1)}>Count: {count}</button>;
}
```

**Quy tắc:**
- Server Component: fetch dữ liệu, render HTML tĩnh, không cần interactivity
- Client Component: `useState`, `useEffect`, `onClick`, `onChange`...
- Không thể truyền Server Component con vào Client Component cha

### 10.3 Layout & Nested Layout

```tsx
// app/layout.tsx - Root layout (bắt buộc)
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

// app/dashboard/layout.tsx - Nested layout
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dashboard">
      <Sidebar />
      {children}
    </div>
  );
}
```

### 10.4 Streaming & Suspense

```tsx
import { Suspense } from 'react';

// Server Component chậm -> bọc trong Suspense để stream
async function SlowComponent() {
  const data = await fetch('https://api.example.com/data').then(r => r.json());
  return <Dashboard data={data} />;
}

export default async function Page() {
  return (
    <>
      <Header />  {/* render ngay */}
      <Suspense fallback={<Skeleton height={400} />}>
        <SlowComponent />  {/* render khi data sẵn */}
      </Suspense>
    </>
  );
}
```

### 10.5 Server Actions - Mutate Không Cần API Route

```tsx
// 'use server' ở trên cùng file hoặc hàm
import { revalidatePath } from 'next/cache';

export async function createTask(formData: FormData) {
  'use server';
  const title = formData.get('title') as string;
  await db.task.create({ title });
  revalidatePath('/tasks');  // invalidate cache, ISR revalidate
}

// Client Component gọi
'use client';
import { createTask } from '@/app/actions';
import { useFormState } from 'react-dom';

export function TaskForm() {
  const [state, formAction] = useFormState(createTask, null);
  return (
    <form action={formAction}>
      <input name="title" />
      <button type="submit">Create</button>
    </form>
  );
}
```

### 10.6 Data Fetching với Cache

```tsx
// Mặc định: cache (like SSG, revalidate theo fetch)
const data = await fetch('https://api.example.com/data');

// Không cache (like SSR, mỗi request fetch lại)
const data = await fetch('https://api.example.com/data', { cache: 'no-store' });

// ISR - revalidate 60s
const data = await fetch('https://api.example.com/data', { next: { revalidate: 60 } });
```

### 10.7 Route Groups & Parallel Routes

```tsx
// Route Groups (không ảnh hưởng URL)
app/
├── (marketing)/
│   ├── page.tsx        # / (không có /marketing trong URL)
│   └── about/
├── (shop)/
│   ├── cart/
│   └── products/
└── layout.tsx

// Parallel Routes - render nhiều page cùng lúc
// app/dashboard/layout.tsx
export default function Layout({ children, analytics, notifications }: {
  children: ReactNode;
  analytics: ReactNode;
  notifications: ReactNode;
}) {
  return (
    <div>
      {children}
      <Sidebar>{analytics}</Sidebar>
      <Panel>{notifications}</Panel>
    </div>
  );
}
```

### 10.8 Middleware - Auth, i18n, A/B Testing

```ts
// middleware.ts - chạy ở Edge
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('token')?.value;

  // Auth check
  if (request.nextUrl.pathname.startsWith('/dashboard') && !token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // i18n
  const locale = request.cookies.get('locale')?.value || 'vi';
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith('/' + locale)) {
    return NextResponse.rewrite(new URL(`/${locale}${pathname}`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

### 10.9 Bài tập
Tạo app Next.js 15 với:
- Auth middleware
- Server Component fetch posts
- Client Component thêm comment (Server Action)
- ISR cho blog với revalidate 60s
- Suspense streaming

> Sang Chương 11 để học Kiến trúc Scale.
