# Chương 9: Vite Build System - 4 Kiểu Build Phải Biết

### 9.1 Tại sao Vite nhanh?

**Dev:** `esbuild` (Go) bundle siêu nhanh (~50ms cho app 1000 module). HMR chỉ update JS changed chunk.

**Build:** `Rollup` (JS) tree-shaking, code splitting, tối ưu tối đa.

**So với Webpack:** Webpack dùng `babel-loader` chậm hơn nhiều ở dev. Vite dùng native ESM, không cần bundler ở dev.

### 9.2 Cài đặt Vite + React + TS

```powershell
pnpm create vite@latest my-app -- --template react-ts
cd my-app
pnpm add -D @vitejs/plugin-react
pnpm add react react-dom
pnpm dev  # dev server tại http://localhost:5173
pnpm build  # build ra dist/
pnpm preview  # preview build locally
```

### 9.3 vite.config.ts Full Config

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  // Alias cho import sạch
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@lib': path.resolve(__dirname, './src/lib'),
    },
  },

  // Dev server proxy
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },

  // Build config
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,  // sourcemap cho debug production
    minify: 'terser',  // hoặc 'esbuild' (nhanh hơn)
    target: 'es2022',
    rollupOptions: {
      output: {
        // Code splitting thủ công
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          ui: ['@radix-ui', '@headlessui'],
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    chunkSizeWarningLimit: 500,  // warning nếu chunk > 500KB
  },

  // CSS
  css: {
    modules: {
      localsConvention: 'camelCaseOnly',
    },
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/variables" as *;`,
      },
    },
  },

  // Env
  envPrefix: 'VITE_',  // chỉ biến VITE_ mới truy cập client được
});
```

### 9.4 Env Management

```
// .env.development
VITE_API_URL=http://localhost:8080/api
VITE_APP_NAME=MyApp

// .env.production
VITE_API_URL=https://api.myapp.com
VITE_APP_NAME=MyApp

// Truy cập trong code
const apiUrl = import.meta.env.VITE_API_URL;
const isProd = import.meta.env.PROD;
```

### 9.5 4 Kiểu Build

#### Kiểu 1: SPA (Mặc định)
```ts
// vite.config.ts - mặc định
export default defineConfig({ plugins: [react()] });
// Build ra dist/index.html + assets/
```

#### Kiểu 2: Library Mode (cho Design System)
```ts
// packages/ui/vite.config.ts
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'MyUI',
      fileName: (format) => `my-ui.${format}.js`,
    },
    rollupOptions: {
      external: ['react', 'react-dom'],  // không bundle React
      output: { globals: { react: 'React', 'react-dom': 'ReactDOM' } },
    },
  },
});
```

#### Kiểu 3: SSR Build
```ts
// build server-side
import svgr from 'vite-plugin-svgr';
export default defineConfig({
  plugins: [react()],
  build: {
    ssr: 'src/entry-server.tsx',
    outDir: 'dist/server',
  },
});
```

#### Kiểu 4: Multi-Page App
```ts
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        admin: 'admin.html',
        dashboard: 'dashboard.html',
      },
    },
  },
});
```

### 9.6 Tối ưu Build cho Production

```ts
// Bundle analyzer
pnpm add -D rollup-plugin-visualizer

// vite.config.ts
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    react(),
    visualizer({
      filename: 'dist/stats.html',
      open: true,
      gzipSize: true,
      brotliSize: true,
    }),
  ],
});
```

```ts
// Compression plugin
pnpm add -D vite-plugin-compression

import viteCompression from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    react(),
    viteCompression({ algorithm: 'gzip' }),      // .gz files
    viteCompression({ algorithm: 'brotliCompress' }),  // .br files
  ],
});
```

### 9.7 Vite vs Next.js Khi Nào Dùng

| Tiêu chí | Vite SPA | Next.js App Router |
|:---|:---|:---|
| SEO cần thiết | ✗ | ✓ |
| Server component | ✗ | ✓ |
| API routes | Cần thêm Express | ✓ Tích hợp |
| Static export | ✓ `vite build --mode` | ✓ `output: 'export'` |
| Server rendering | ✗ | ✓ |
| Bundle size | Nhỏ hơn (chỉ client) | Lớn hơn (server + client) |
| HMR tốc độ | ★★★★★ | ★★★★ |
| Deploy đơn giản | Chỉ cần S3/CDN | Vercel/Fly.io |

### 9.8 Bài tập
Tạo Vite SPA với alias @/, proxy /api -> localhost:8080, sourcemap, code splitting.

> Sang Chương 10 để học Next.js App Router.
