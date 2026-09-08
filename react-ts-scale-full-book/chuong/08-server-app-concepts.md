# Chương 8: Server App Concepts - CSR vs SSR vs SSG vs ISR vs PPR

> "CSR vs SSR không phải vấn đề technology. Vấn đề là business requirements."

## 8.1 CSR (Client-Side Rendering)

```
Server gửi HTML trống + JS bundle → Browser tải JS → React render
```

**Ưu điểm:** Đơn giản, chỉ cần S3/CDN, bundle nhỏ
**Nhược:**白屏 2-5s, SEO kém, mobile yếu
**Dùng cho:** Dashboard nội bộ, admin, SPA không cần SEO

## 8.2 SSR (Server-Side Rendering)

Server render HTML trên mỗi request.

```tsx
// Next.js App Router - Server Component
export default async function Page() {
  const data = await fetch("https://api.example.com/data", { cache: "no-store" });
  return <Dashboard data={await data.json()} />;
}
```

**Ưu điểm:** TTFB nhanh, SEO tốt, content có sẵn
**Nhược:** Server tốn resources, phải có Node.js runtime
**Dùng cho:** Blog, news, e-commerce, marketing

## 8.3 SSG (Static Site Generation)

Render HTML tĩnh 1 lần khi build.

```tsx
export async function generateStaticParams() {
  const posts = await fetchPosts();
  return posts.map(post => ({ slug: post.slug }));
}

export default async function Page({ params }) {
  const post = await fetchPost(params.slug);
  return <Article post={post} />;
}
```

**Ưu điểm:** CDN cache, toàn cầu < 100ms, zero server cost
**Nhược:** Nội dung cũ sau khi update
**Dùng cho:** Landing page, docs, blog cũ

## 8.4 ISR (Incremental Static Regeneration)

SSG + auto revalidate theo thời gian.

```tsx
export const revalidate = 60;  // 60 giây

export default async function Page() {
  const data = await fetch("https://api.example.com/data");
  return <Dashboard data={await data.json()} />;
}
```

**Cơ chế:** Build time → cache → sau 60s request tiếp theo revalidate background → user nhận cached HTML trong khi tạo HTML mới.

## 8.5 PPR (Partial Prerendering) - React 19 + Next.js 15

Mix SSR + static page.

```tsx
import { Suspense } from "react";

export default async function Page() {
  return (
    <>
      <Header />  {/* Static - prerendered */}
      <Suspense fallback={<Skeleton />}>
        <LiveDashboard />  {/* Dynamic - SSR mỗi request */}
      </Suspense>
      <Footer />  {/* Static */}
    </>
  );
}
```

## 8.6 Lựa Chọn Chi Tiết

| Trang | Strategy | Lý do |
|:---|:---|:---|
| Marketing landing | SSG | CDN, nhanh |
| Blog/news | ISR | Tự update |
| Dashboard nội bộ | CSR | Không cần SEO |
| E-commerce product | SSR + ISR | SEO + real-time |
| App lớn mix | PPR | Static shell + dynamic |

## 8.7 Bài tập

### Bài 1: Phân tích 3 website
Phân tích 3 trang web bạn dùng: CSR, SSR, SSG hay ISR? Tại sao?

### Bài 2: ISR với on-demand
Implement ISR với on-demand revalidation qua webhook.

### Bài 3: Streaming SSR
Implement streaming SSR với Suspense cho dashboard.

> Sang Chương 9 để học Vite Build System.
