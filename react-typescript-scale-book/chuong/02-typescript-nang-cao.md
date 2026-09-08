# Chương 2: TypeScript Nâng Cao - Bậc Thầy Type

### 2.1 Generics Nâng Cao

```ts
// Generic với constraint + default
type ApiResponse<T = unknown, E = Error> = {
  data: T;
  error?: E;
  status: number;
};

// Conditional Types - kiểu phụ thuộc điều kiện
type IsString<T> = T extends string ? "yes" : "no";
type A = IsString<string>;  // "yes"
type B = IsString<number>;  // "no"

// Mapped Types - duyệt từng field để tạo type mới
type ReadOnly<T> = {
  readonly [K in keyof T]: T[K];
};

type Optional<T> = {
  [K in keyof T]?: T[K];
};

// Template Literal Types - tạo type từ string template
type EventName<E extends string> = `on${Capitalize<E>}`;
type ClickEvent = EventName<"click">;  // "onClick"
```

### 2.2 Utility Types React Hay Dùng Nhất

```ts
// React.FC deprecated, dùng ComponentProps thay
type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary';
};

// ReactNode vs ReactElement - phân biệt cho children
type CardProps = {
  children: React.ReactNode;      // nhận đủ: string, element, fragment, null
  header: React.ReactElement;     // phải là 1 JSX element cụ thể
};
```

### 2.3 Type Guards & Assertions

```ts
// Type Guard - runtime check, TS hiểu type
function isAdmin(user: User): user is AdminUser {
  return (user as AdminUser).role === 'admin';
}

// Non-null assertion - dùng khi chắc chắn không null
const div = document.getElementById('app')!;  // ! để TS biết không null
```

### 2.4 Declaration Merging - Gộp Type Cho Thư Viện

```ts
// Khi dùng thư viện bên ngoài mà thiếu type
declare module 'some-lib' {
  interface SomeInterface {
    newField: string;
  }
}
```

### 2.5 Type Safety Cho Event Handler

```tsx
// Change event input
const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const value: string = e.target.value;
};

// Submit event form
const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const formData = new FormData(e.currentTarget);
};

// Custom event
interface MyCustomEvent extends CustomEvent {
  detail: { userId: string };
}
const handler = (e: MyCustomEvent) => console.log(e.detail.userId);
```

### 2.6 Bài tập
Tạo custom hook `useToggle<T>(initial: T, toggles: [T, T])` trả về `[current, toggle, set]`.

### 2.7 Kiến thức sâu: `satisfies` Operator (TS 4.9+)
```ts
// Đảm bảo object đúng shape mà KHÔNG thay đổi type để dùng sau
const themes = {
  primary: '#000',
  secondary: '#fff',
} satisfies Record<string, string>;  // lỗi nếu value không phải string
```

> Sang Chương 3 để học React Modern.
