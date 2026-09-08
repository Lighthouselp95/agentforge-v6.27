# Chương 0: Nhập Môn & Cài Đặt Chi Tiết

> "Đừng bắt đầu code khi chưa setup đúng môi trường."

## 0.1 Bạn đang ở đâu? Học xong được gì?

Quyển sách này dành cho bạn:
- Đã biết JS cơ bản nhưng **chưa biết React**
- Biết React nhưng **chưa biết TypeScript**
- Biết cả 2 nhưng **chưa biết làm Server App để scale**
- Đã biết nhưng muốn học đúng cách, **chuẩn industry 2024-2025**

**Học xong 14 chương, bạn sẽ:**
- Viết TypeScript type system thành thạo (generics, conditional, utility types)
- Viết React component chuyên nghiệp (compound, render props, polymorphic)
- Hiểu rõ CSR vs SSR vs SSG vs ISR vs PPR và biết chọn cái nào
- Build app với Vite + Next.js 15 App Router
- Tối ưu performance cho 1M+ user
- Setup monorepo với Turborepo, shared packages
- Viết test, setup CI/CD, deploy production

---

## 0.2 Lộ trình 14 chương

```
PHẦN A - NỀN TẢNG
─────────────────────────────────────────────────────────
Chương 0: Nhập môn & Cài đặt               ← Bạn đang ở đây
Chương 1: TypeScript Cơ Bản cho React
Chương 2: TypeScript Nâng Cao (Generics, Conditional, Mapped)

PHẦN B - REACT CORE
─────────────────────────────────────────────────────────
Chương 3: React Modern & Concurrent
Chương 4: Component Patterns (10+ patterns)
Chương 5: State Management Toàn Diện
Chương 6: Form & Validation
Chương 7: Data Fetching & Cache (TanStack Query)

PHẦN C - SERVER & SCALE
─────────────────────────────────────────────────────────
Chương 8: Server Concepts (CSR/SSR/SSG/ISR/PPR)
Chương 9: Vite Build System (4 kiểu build)
Chương 10: Next.js App Router (Full Guide)
Chương 11: Kiến Trúc Scale 1M User (Monorepo, FSD)

PHẦN D - DEVOPS & PRODUCTION (MỚI)
─────────────────────────────────────────────────────────
Chương 12: Testing & CI/CD
Chương 13: DevOps & Production
```

**Thời gian dự kiến:** 4 tuần × 3-5 giờ/tuần = 12-20 giờ

---

## 0.3 Cài đặt môi trường chi tiết

### Bước 1: Cài Node.js 20 LTS

```powershell
# Windows (winget)
winget install OpenJS.NodeJS.LTS

# Verify
node -v    # v20.x.x
npm -v     # 10.x.x

# Cài pnpm (package manager tốt hơn npm)
corepack enable
corepack prepare pnpm@latest --activate
pnpm --version   # >= 9.0
```

### Bước 2: Cài Git

```powershell
winget install Git.Git
git --version   # 2.x.x

# Git config cơ bản
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
git config --global init.defaultBranch main
```

### Bước 3: Cài VSCode + Extensions

```powershell
# Editor
winget install Microsoft.VisualStudioCode

# Extensions
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
code --install-extension bradlc.vscode-tailwindcss
code --install-extension dsznajder.es7-react-js-snippets
code --install-extension prisma.prisma
code --install-extension bradlc.vscode-tailwindcss
code --install-extension christian-kohler.path-intellisense
code --install-extension usernamehw.errorlens
code --install-extension formulahendry.auto-rename-tag
code --install-extension formulahendry.auto-close-tag
```

### Bước 4: VSCode Settings chuẩn

```json
// .vscode/settings.json
{
  // Formatter
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.formatOnPaste": false,
  "editor.defaultRenderWhitespace": "boundary",

  // TypeScript
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,

  // ESLint
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit",
    "source.organizeImports": "explicit"
  },

  // Error Lens (hiển thị lỗi inline)
  "errorLens.gutterIconsEnabled": true,
  "errorLens.enabledDiagnosticLevels": ["error", "warning"],

  // Search exclude
  "search.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/build": true,
    "**/.next": true,
    "**/coverage": true,
    "**/pnpm-lock.yaml": true
  }
}
```

---

## 0.4 Tạo project đầu tiên

### Cách 1: Vite SPA (nhanh, nhẹ)

```powershell
pnpm create vite@latest my-app -- --template react-ts
cd my-app
pnpm install
pnpm dev    # http://localhost:5173
```

### Cách 2: Next.js App Router (Server App)

```powershell
pnpm create next-app@latest my-app --typescript --tailwind --app --src-dir --import-alias "@/*"
cd my-app
pnpm install
pnpm dev    # http://localhost:3000
```

### Cách 3: Tạo từ đầu (hiểu sâu nhất)

```powershell
mkdir my-app && cd my-app
pnpm init

# TypeScript
pnpm add -D typescript @types/react @types/react-dom
npx tsc --init

# React
pnpm add react react-dom

# Vite
pnpm add -D vite @vitejs/plugin-react

# ESLint + Prettier
pnpm add -D eslint @eslint/js typescript-eslint
pnpm add -D prettier eslint-config-prettier
```

---

## 0.5 tsconfig.json bắt buộc cho React

```json
{
  "compilerOptions": {
    // Target & Module
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",

    // React
    "jsx": "react-jsx",
    "jsxImportSource": "react",

    // Strict mode - BẮT BUỘC
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": false,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,

    // Module resolution
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,

    // Output
    "noEmit": true,

    // Path alias
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@components/*": ["./src/components/*"],
      "@hooks/*": ["./src/hooks/*"],
      "@lib/*": ["./src/lib/*"],
      "@types/*": ["./src/types/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "build"]
}
```

---

## 0.6 ESLint + Prettier Config

```js
// eslint.config.js (flat config - ESLint 9+)
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  { ignores: ['dist/', 'build/', '.next/', 'node_modules/'] }
);
```

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 80,
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

---

## 0.7 Gitignore chuẩn

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build
dist/
build/
.next/
out/

# IDE
.vscode/*
!.vscode/settings.json
!.vscode/extensions.json
.idea/

# Environment
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# OS
.DS_Store
Thumbs.db

# Testing
coverage/

# Misc
*.tsbuildinfo
```

---

## 0.8 Bài tập cuối chương

1. **Cài đặt đầy đủ:** Node 20+, pnpm, Git, VSCode + extensions
2. **Tạo project:** `my-app` với Vite + React + TypeScript
3. **Hiểu config:** Đọc kỹ `tsconfig.json`, `vite.config.ts` - giải thích từng field
4. **Hello World:** Tạo file `src/App.tsx` với component `<App>` render "Hello React TypeScript Scale"
5. **Chạy dev server:** `pnpm dev` -> mở browser -> F12 -> Console không lỗi

**Kiểm tra:**
- ✅ `node -v` hiện v20+
- ✅ `pnpm -v` hiện 9+
- ✅ VSCode hiện "TypeScript" ở status bar
- ✅ `pnpm dev` chạy không lỗi
- ✅ Browser hiện nội dung bạn viết

> Sang Chương 1 để học TypeScript Cơ Bản Cho React.
