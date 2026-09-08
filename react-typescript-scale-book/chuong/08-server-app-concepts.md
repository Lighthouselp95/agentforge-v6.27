# Chương 8: Server App Concepts - CSR vs SSR vs SSG vs ISR vs PPR

### 8.1 Vấn đề CSR đơn thuần

```
CSR: Server gửi HTML trống + JS bundle -> Browser tải JS -> React render -> Content hiện
Vấn đề:
- Lên trang trắng ~2-5 giây (Time to Interactive)
- SEO kém: bot google không chờ JS render
- Tải chậm trên mobile yếu
```

### 8.2 5 Mô hình Rendering

```
─────────────────────────────────────────────────────────────────────────────
Model        Server làm gì?       Khi nào dùng?          Ví dụ
─────────────────────────────────────────────────────────────────────────────
CSR          Không làm gì         App nội bộ, dashboard  React SPA
SSR          Render HTML mỗi      Blog, news, e-commerce  Next.js App Router
             request              marketing
SSG          Render HTML tĩnh     Landing page, docs       Next.js, Astro
             một lần khi build
ISR          SSG + auto           Blog, e-commerce         Next.js ISR
             revalidate theo
             thời gian
PPR          Mix SSR +           App lớn, mix page      Next.js 15 App Router
             static page          thường xuyên đổi       (Partial Prerendering)
─────────────────────────────────────────────────────────────────────────────
```

### 8.3 CSR Detail

```tsx
// SPA với Vite
// Server chỉ gửi index.html + JS
function App() {
  const [data, setData] = useState(null);
  useEffect(() => { fetch('/api/data').then(r => r.json()).then(setData); }, []);
  return <div>{data ? <Dashboard data={data} /> : <Spinner />}</div>;
}
```

### 8.4 SSR Detail

```tsx
// Next.js App Router - Server Component mặc định
// Server chạy trên mỗi request, fetch DB, trả HTML đã render
export default async function Page() {
  const data = await fetch('https://api.example.com/data', {
    cache: 'no-store',  // không cache, mỗi request fetch lại
  });
  return <Dashboard data={await data.json()} />;
}
```

**Ưu điểm:**
- HTML có sẵn content -> TTFB nhanh, SEO tốt
- Không cần "hydrate" JS cho những phần tĩnh

**Nhược điểm:**
- Server phải render mỗi request -> tốn resources
- Phải dùng Node.js runtime

### 8.5 SSG Detail

```tsx
// Next.js App Router - build time render
export async function generateStaticParams() {
  const posts = await fetchPosts();
  return posts.map(post => ({ slug: post.slug }));
}

export default async function Page({ params }) {
  const post = await fetchPost(params.slug);
  return <Article post={post} />;
}
```

**Ưu điểm:**
- HTML tĩnh -> CDN cache -> toàn cầu < 100ms
- Zero server cost

**Nhược điểm:**
- Nội dung cũ sau khi update (trừ ISR)

### 8.6 ISR Detail

```tsx
// SSG + auto revalidate mỗi 60s
export const revalidate = 60;  // 60 giây

export default async function Page() {
  const data = await fetch('https://api.example.com/data');
  return <Dashboard data={await data.json()} />;
}
```

Cách hoạt động:
1. Build time -> generate HTML cho tất cả slug
2. Lần đầu truy cập -> serve cached HTML
3. Sau 60s -> request tiếp theo kích hoạt background revalidate
4. User nhận cached HTML trong khi background tạo HTML mới
5. Next request serve HTML mới

### 8.7 PPR (Partial Prerendering) - React 19 + Next.js 15

```tsx
// Phần tĩnh: cached, phần động: SSR live
import { Suspense } from 'react';

export default async function Page() {
  return (
    <>
      {/* Static - prerendered tại build */}
      <Header />
      <Footer />

      {/* Dynamic - SSR mỗi request */}
      <Suspense fallback={<Skeleton />}>
        <LiveDashboard />
      </Suspense>
    </>
  );
}
```

### 8.8 Lựa chọn chiến lược

```
Trang marketing -> SSG (cached trên CDN)
Blog/news -> ISR (revalidate 60s)
Dashboard nội bộ -> CSR (không cần SEO)
E-commerce -> SSR cho search/collection, SSG cho product detail
App lớn mix -> PPR (static shell + dynamic islands)
```

### 8.9 Bài tập
Phân tích 3 trang web bạn hay dùng: mỗi trang dùng CSR, SSR, SSG hay ISR? Tại sao?

> Sang Chương 9 để học Vite Build.
