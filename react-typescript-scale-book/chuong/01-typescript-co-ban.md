# Chương 1: TypeScript Cơ Bản Cho React

### 1.1 Tại sao phải TypeScript?

React + TS = tự phát hiện lỗi trước khi chạy, tự tài liệu hóa props, dễ refactor. Không cần khai báo type 100 lần nhờ `infer` và `ComponentProps`.

### 1.2 Cài đặt TypeScript

```powershell
pnpm add -D typescript @types/react @types/react-dom
npx tsc --init
```

```json
// tsconfig.json bắt buộc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src"]
}
```

### 1.3 Type Primitive cho React Props

```tsx
interface ButtonProps {
  label: string;
  disabled?: boolean;          // optional
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: 'primary' | 'secondary' | 'ghost';  // union type
}
```

### 1.4 Array, Record, Tuple

```ts
// Array
const users: User[] = [];
const names: string[] = [];
const readOnly: readonly number[] = [1,2,3];

// Record (dictionary)
const roles: Record<string, boolean> = { admin: true, user: false };

// Tuple (cố định size, mỗi vị trí có type riêng)
const userTuple: [string, number, boolean] = ["Hai", 25, true];
```

### 1.5 Generic Props - Component Có Thể Tái Dùng

```tsx
function List<T extends { id: string }>({
  items,
  render,
}: {
  items: T[];
  render: (item: T) => React.ReactNode;
}) {
  return <ul>{items.map(item => <li key={item.id}>{render(item)}</li>)}</ul>;
}

// Dùng
<List<User> items={users} render={u => <UserCard user={u} />} />
```

### 1.6 ReactNode, ReactElement, JSX.Element - Phân Biệt

* `React.ReactNode` = bất kỳ gì render được (string, number, element, fragment, null, boolean)
* `React.ReactElement` = 1 JSX element cụ thể
* `JSX.Element` = synonym của ReactElement
* Dùng `React.ReactNode` cho `children` vì nó nhận đủ mọi thứ

### 1.7 Bài tập
Tạo component `<Modal<T>>` generic nhận `isOpen`, `onClose`, `children`, render title tùy type T.

### 1.8 Kiến thức sâu: Utility Types trong React
```ts
// Khi cần tạo props con từ props cha
type ModalProps = Omit<DialogProps, 'onClose'>;  // bỏ onClose
type PartialModal = Partial<ModalProps>;          // tất cả optional
type PickModal = Pick<ModalProps, 'title' | 'isOpen'>;  // chỉ lấy 2 field
```

> Sang Chương 2 để học TypeScript Nâng cao (Generics, Conditional Types, Mapped Types).
