# Chương 9: Vite Build System - 4 Kiểu Build Phải Biết

> "Vite không chỉ nhanh. Vite là cách build app hiện đại."

## 9.1 Tại Sao Vite Nhanh?

**Dev:** `esbuild` (Go) bundle siêu nhanh (~50ms cho 1000 module). HMR chỉ update JS changed chunk.
**Build:** `Rollup` tree-shaking, code splitting, tối ưu.
**So với Webpack:** Webpack dùng `babel-loader` chậm hơn nhiều.

## 9.2 Cài Đặt

```powershell
pnpm create vite@latest my-app -- --template react-ts
cd my-app
pnpm dev    # http://localhost:5173
pnpm build  # dist/
pnpm preview
```

## 9.3 vite.config.ts Full

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@components": path.resolve(__dirname, "./src/components"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
  envPrefix: "VITE_",
});
```

## 9.4 Env Management

```ts
// .env.development
VITE_API_URL=http://localhost:8080/api

// .env.production
VITE_API_URL=https://api.myapp.com

// Truy cập
const apiUrl = import.meta.env.VITE_API_URL;
const isProd = import.meta.env.PROD;
```

## 9.5 4 Kiểu Build

### Kiểu 1: SPA (Mặc định)
```ts
export default defineConfig({ plugins: [react()] });
```

### Kiểu 2: Library Mode
```ts
export default defineConfig({
  build: {
    lib: { entry: "src/index.ts", name: "MyUI", fileName: (f) => `my-ui.${f}.js` },
    rollupOptions: { external: ["react", "react-dom"] },
  },
});
```

### Kiểu 3: SSR Build
```ts
export default defineConfig({
  build: { ssr: "src/entry-server.tsx", outDir: "dist/server" },
});
```

### Kiểu 4: Multi-Page
```ts
export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: "index.html", admin: "admin.html" },
    },
  },
});
```

## 9.6 Tối Ưu

```ts
// Bundle analyzer
import { visualizer } from "rollup-plugin-visualizer";
plugins: [react(), visualizer({ filename: "dist/stats.html", open: true })];

// Compression
import viteCompression from "vite-plugin-compression";
plugins: [react(), viteCompression({ algorithm: "gzip" })];
```

## 9.7 Bài tập

### Bài 1: Vite SPA
Tạo Vite SPA với alias, proxy, sourcemap, code splitting.

### Bài 2: Library Mode
Tạo design system với Vite library mode.

### Bài 3: SSR + Streaming
Implement SSR với streaming.

> Sang Chương 10 để học Next.js App Router.
