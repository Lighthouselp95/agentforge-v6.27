# Chương 12: Testing & CI/CD (Chương Mới)

> "Không test = không biết code mình có chạy đúng không."

## 12.1 Tại Sao Phải Test?

- Phát hiện bug trước khi deploy
- Refactor an toàn
- Document code bằng test
- Confident khi thay đổi

## 12.2 Testing Pyramid

```
        E2E (10%)           ← Cypress, Playwright
       Integration (30%)     ← React Testing Library
      Unit (60%)             ← Vitest
```

## 12.3 Unit Testing với Vitest

```tsx
// Install
pnpm add -D vitest @testing-library/react @testing-library/jest-dom

// vite.config.ts
export default defineConfig({
  test: { globals: true, environment: "jsdom" },
});

// Math utility
function add(a: number, b: number): number { return a + b; }

// Math.test.ts
import { describe, it, expect } from "vitest";
import { add } from "./math";

describe("add", () => {
  it("adds two numbers", () => expect(add(1, 2)).toBe(3));
  it("handles negative numbers", () => expect(add(-1, -2)).toBe(-3));
});
```

## 12.4 Component Testing với React Testing Library

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Counter } from "./Counter";

describe("Counter", () => {
  it("renders with initial count", () => {
    render(<Counter initialCount={0} />);
    expect(screen.getByText("Count: 0")).toBeInTheDocument();
  });

  it("increments on click", async () => {
    const user = userEvent.setup();
    render(<Counter initialCount={0} />);
    await user.click(screen.getByRole("button", { name: /increment/i }));
    expect(screen.getByText("Count: 1")).toBeInTheDocument();
  });
});
```

## 12.5 Integration Testing

```tsx
// Test component + hook together
import { renderHook, act } from "@testing-library/react";
import { useCounter } from "./useCounter";

describe("useCounter", () => {
  it("increments", () => {
    const { result } = renderHook(() => useCounter(0));
    act(() => result.current.increment());
    expect(result.current.count).toBe(1);
  });
});
```

## 12.6 E2E Testing với Playwright

```tsx
// Install
pnpm add -D @playwright/test

// playwright.config.ts
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
});

// e2e/login.spec.ts
import { test, expect } from "@playwright/test";

test("login flow", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', "test@example.com");
  await page.fill('input[name="password"]', "password123");
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL("/dashboard");
});
```

## 12.7 CI/CD với GitHub Actions

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
```

## 12.8 Bài tập

### Bài 1: Unit Test cho Utils
Viết test cho utility functions: formatDate, debounce, throttle.

### Bài 2: Component Test
Viết test cho `<LoginForm>` component.

### Bài 3: E2E Test
Viết E2E test cho login flow.

> Sang Chương 13 để học DevOps & Production.
