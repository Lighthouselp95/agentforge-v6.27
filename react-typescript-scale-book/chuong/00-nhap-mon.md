# Chương 0: Nhập Môn - Lộ Trình & Cài Đặt

### 1.1 Bạn đang ở đâu?

Quyển sách này dành cho bạn:
- Đã biết JS cơ bản nhưng chưa biết React
- Biết React nhưng chưa biết TypeScript
- Biết cả 2 nhưng chưa biết làm Server App để scale
- Đã biết nhưng muốn học đúng cách, chuẩn industry 2024-2025

### 1.2 Lộ trình 12 chương

```
PHẦN A - NỀN TẢNG          PHẦN B - REACT CORE          PHẦN C - SERVER & SCALE
────────────────────────     ──────────────────────────     ──────────────────────────
Chương 0: Nhập môn           Chương 3: React Modern         Chương 8: Server App
Chương 1: TS cơ bản         Chương 4: Component Patterns   Chương 9: Vite Build
Chương 2: TS nâng cao       Chương 5: State Management     Chương 10: Next.js App Router
                            Chương 6: Form & Validation    Chương 11: Kiến trúc Scale
                            Chương 7: Data Fetching
```

### 1.3 Cài đặt môi trường

```powershell
# 1. Cài Node 20 LTS
winget install OpenJS.NodeJS.LTS
node -v   # v20.x+
pnpm --version  # >= 9

# 2. VSCode extensions
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
code --install-extension bradlc.vscode-tailwindcss
code --install-extension dsznajder.es7-react-js-snippets

# 3. Tạo repo đầu tiên
mkdir my-app && cd my-app
pnpm init
pnpm add -D typescript @types/react @types/react-dom
```

### 1.4 VSCode config chuẩn
```json
// .vscode/settings.json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  }
}
```

### 1.5 Bài tập cuối chương
1. Cài Node 20+, pnpm, VSCode extensions vào máy
2. Tạo file `hello.ts`: `console.log("Hello React TypeScript Scale")`
3. Chạy `npx tsc hello.ts && node hello.js` -> ra "Hello" là ok

> Sang Chương 1 để học TypeScript cho React.
