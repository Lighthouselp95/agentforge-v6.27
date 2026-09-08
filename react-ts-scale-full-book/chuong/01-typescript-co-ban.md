# Chương 1: TypeScript Cơ Bản Cho React

> "TypeScript không phải optional. Nó là cách duy nhất để giữ code React lớn không cháy."

## 1.1 Tại sao phải TypeScript?

React alone chỉ check runtime. TypeScript check **compile-time** - trước khi chạy.

| Vấn đề | JavaScript | TypeScript |
|:---|:---|:---|
| Sai props | Crash runtime | Lỗi ở editor ngay |
| Rename field | Phải tìm sửa 100 chỗ | Rename 1 lần, TS suggest sửa |
| Collaborate | Đọc code mới biết props | Tự có gợi ý props |
| Refactor | Sợ break | Tự động suggest fix |
| Debug | Alert('xxx') | Compiler catch |

**Mức độ nghiêm trọng khi không dùng TS:**
- App nhỏ (< 500 LOC): Vẫn chạy được
- App trung bình (500-5000 LOC): Bắt đầu lộn xộn
- App lớn (> 5000 LOC): **Cực kỳ khó maintain**

---

## 1.2 Cài đặt TypeScript cho React

```powershell
# Bước 1: Cài packages
pnpm add -D typescript @types/react @types/react-dom

# Bước 2: Tạo tsconfig.json
npx tsc --init

# Bước 3: Chỉnh sửa tsconfig.json (xem ở Chương 0)
```

**Lưu ý quan trọng:**
- `@types/react`: Type definitions cho React
- `@types/react-dom`: Type definitions cho ReactDOM
- `@types/*` được cài riêng vì React là JS library, không phải TS native

---

## 1.3 Primitive Types Cho React

### Type cơ bản

```ts
// String
const name: string = "Hai";
const template: string = `Hello ${name}`;

// Number
const age: number = 25;
const price: number = 99.99;
const hex: number = 0xff;

// Boolean
const isActive: boolean = true;

// Null & Undefined
const nothing: null = null;
const notDefined: undefined = undefined;

// Void (hàm không return)
function log(message: string): void {
  console.log(message);
}

// Never (hàm không bao giờ return)
function throwError(msg: string): never {
  throw new Error(msg);
}

// Any (tránh dùng!)
const data: any = "anything"; // KHÔNG NÊN

// Unknown (an toàn hơn any)
const input: unknown = getUserInput();
if (typeof input === "string") {
  console.log(input.toUpperCase()); // OK sau khi check type
}
```

### Array & Tuple

```ts
// Array - 2 cách
const names: string[] = ["Alice", "Bob"];
const ages: Array<number> = [25, 30];

// Readonly Array
const readonly: readonly number[] = [1, 2, 3];
// readonly.push(4); // LỖI!

// Tuple - cố định size, mỗi vị trí có type riêng
const user: [string, number] = ["Hai", 25];
const [userName, userAge] = user; // Destructuring

// Named Tuple (đọc dễ hơn)
type UserTuple = [name: string, age: number, email: string];
const admin: UserTuple = ["Admin", 30, "admin@test.com"];

// Rest Tuple
type Numbers = [string, ...number[]];
const mixed: Numbers = ["start", 1, 2, 3];
```

### Object & Interface

```ts
// Object literal
const user: { name: string; age: number } = { name: "Hai", age: 25 };

// Interface - cách tốt nhất cho object
interface User {
  name: string;
  age: number;
  email?: string;           // Optional
  readonly id: number;      // ReadOnly
}

const user1: User = { name: "Hai", age: 25, id: 1 };
// user1.id = 2; // LỖI: readonly

// Interface extending
interface Admin extends User {
  role: "admin" | "superadmin";
  permissions: string[];
}

// Interface merging (Declaration Merging)
interface Window {
  myCustomProp: string;
}
// Now window.myCustomProp is valid
```

### Union & Intersection

```ts
// Union - hoặc A hoặc B
type Status = "loading" | "success" | "error";
type ID = string | number;
type Result = { ok: true; data: User } | { ok: false; error: string };

// Dùng với type guard
function handleResult(result: Result) {
  if (result.ok) {
    console.log(result.data);  // TS biết đây là { ok: true; data: User }
  } else {
    console.log(result.error); // TS biết đây là { ok: false; error: string }
  }
}

// Intersection - A và B cùng lúc
type Timestamped = { createdAt: Date; updatedAt: Date };
type UserWithTimestamp = User & Timestamped;

// Dùng trong practice
type APIResponse = {
  status: number;
  headers: Record<string, string>;
} & (
  | { ok: true; data: unknown }
  | { ok: false; error: string }
);
```

---

## 1.4 Type cho React Props

### Props cơ bản

```tsx
// ButtonProps với tất cả kiểu prop
interface ButtonProps {
  // String
  label: string;
  variant?: "primary" | "secondary" | "ghost";  // Union optional

  // Boolean
  disabled?: boolean;
  loading?: boolean;

  // Number
  size?: number;

  // Function
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onHover?: (isHovered: boolean) => void;

  // ReactNode - bất kỳ gì render được
  children: React.ReactNode;
  icon?: React.ReactNode;

  // Union complex
  type?: "button" | "submit" | "reset";

  // Class name
  className?: string;

  // HTML attribute
  "data-testid"?: string;
}

// Component
function Button({
  label,
  variant = "primary",
  disabled = false,
  loading = false,
  onClick,
  children,
  icon,
  type = "button",
  className,
  "data-testid": testId,
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`btn btn-${variant} ${className ?? ""}`}
      data-testid={testId}
    >
      {loading ? <Spinner size={16} /> : icon}
      {label}
      {children}
    </button>
  );
}

// Dùng
<Button
  label="Click me"
  variant="primary"
  onClick={() => console.log("clicked")}
>
  Extra content
</Button>
```

### Children Types

```tsx
// TRƯỜNG HỢP 1: Children bất kỳ (phổ biến nhất)
interface ContainerProps {
  children: React.ReactNode;  // string, number, element, fragment, null, boolean
}

// TRƯỜNG HỢP 2: Children phải là JSX Element cụ thể
interface CardProps {
  header: React.ReactElement;  // phải là 1 JSX element
  body: React.ReactElement;
  footer?: React.ReactElement;
}

// TRƯỜNG HỢP 3: Children function (render props)
interface DataFetcherProps {
  children: (data: { items: Item[]; loading: boolean }) => React.ReactNode;
}

// TRƯỜNG HỢP 4: Không có children
interface InputProps {
  value: string;
  onChange: (value: string) => void;
  // Không có children - input self-closing
}
```

---

## 1.5 Generic Components

Khi component cần linh hoạt với nhiều kiểu data khác nhau.

### Basic Generic

```tsx
// Generic component - T là kiểu data truyền vào
interface ListProps<T> {
  items: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  emptyMessage?: string;
}

function List<T>({
  items,
  keyExtractor,
  renderItem,
  emptyMessage = "No items",
}: ListProps<T>) {
  if (items.length === 0) {
    return <div className="empty">{emptyMessage}</div>;
  }
  return (
    <ul>
      {items.map(item => (
        <li key={keyExtractor(item)}>{renderItem(item)}</li>
      ))}
    </ul>
  );
}

// Dùng với type cụ thể
interface User {
  id: string;
  name: string;
  email: string;
}

<List<User>
  items={users}
  keyExtractor={user => user.id}
  renderItem={user => <UserCard user={user} />}
  emptyMessage="No users found"
/>
```

### Generic với Constraint

```tsx
// T phải có field id
interface SelectProps<T extends { id: string }> {
  items: T[];
  value: string;
  onChange: (id: string) => void;
  getLabel: (item: T) => string;
}

function Select<T extends { id: string }>({
  items,
  value,
  onChange,
  getLabel,
}: SelectProps<T>) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}>
      {items.map(item => (
        <option key={item.id} value={item.id}>
          {getLabel(item)}
        </option>
      ))}
    </select>
  );
}

// Dùng - T extends { id: string } => phải có id
<Select
  items={users}           // User có id
  value={selectedId}
  onChange={setSelectedId}
  getLabel={user => user.name}
/>
```

### Generic với Default

```tsx
// Default là unknown nếu không truyền T
interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  message: string;
}

// Tự infer type từ data
const response: ApiResponse<User> = await fetchUser();
// response.data là User

// Không truyền T -> T = unknown
const generic: ApiResponse = await fetchSomething();
// generic.data là unknown
```

---

## 1.6 ReactNode vs ReactElement vs JSX.Element

**Phân biệt RÕ RÀNG vì nhầm là bug:**

```tsx
// ReactNode = bất kỳ gì render được
type ReactNode = React.ReactNode;
// - string
// - number
// - boolean
// - null
// - undefined
// - ReactElement
// - ReactFragment (Fragment, Array)
// - ReactPortal

// ReactElement = 1 JSX element cụ thể
type ReactElement = React.ReactElement;
// - <div>...</div>
// - <MyComponent />
// - React.createElement(...)

// JSX.Element = synonym của ReactElement
type JSXElement = JSX.Element;
// Giống hệt ReactElement

// KHI NÀO DÙNG CÁI NÀO?
// children: React.ReactNode    ← Luôn luôn dùng cái này
// header: React.ReactElement   ← Khi muốn nhận JSX cụ thể, không nhận string
// return type: JSX.Element     ← Cho function component
```

```tsx
// Ví dụ thực tế
interface ModalProps {
  title: string;            // string
  children: React.ReactNode; // bất kỳ
  header?: React.ReactElement; // phải là JSX
}

function Modal({ title, children, header }: ModalProps) {
  return (
    <div className="modal">
      <div className="modal-header">
        {header ?? <h2>{title}</h2>}
      </div>
      <div className="modal-body">{children}</div>
    </div>
  );
}

// Dùng
<Modal title="Confirm">
  <p>Are you sure?</p>           {/* children = JSX element */}
</Modal>

<Modal
  title="Confirm"
  header={<CustomHeader icon="trash" />}  {/* header = ReactElement */}
>
  <p>Are you sure?</p>
</Modal>
```

---

## 1.7 Event Handler Types

```tsx
// React.MouseEvent - click events
const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.preventDefault();
  e.stopPropagation();
  console.log(e.clientX, e.clientY);
};

// React.ChangeEvent - input changes
const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const value: string = e.target.value;
  const checked: boolean = (e.target as HTMLInputElement).checked;
};

// React.FormEvent - form submit
const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const formData = new FormData(e.currentTarget);
  const title = formData.get("title") as string;
};

// React.KeyboardEvent - keyboard
const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter" && !e.shiftKey) {
    // Submit on Enter
  }
  if (e.key === "Escape") {
    // Cancel on Escape
  }
};

// React.FocusEvent
const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
  e.target.select(); // Select all on focus
};

// React.DragEvent
const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
  e.preventDefault();
  const files = e.dataTransfer.files;
};

// React.TouchEvent (mobile)
const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
  const touch = e.touches[0];
  console.log(touch.clientX, touch.clientY);
};

// SyntheticEvent (base của tất cả)
const handleAny = (e: React.SyntheticEvent) => {
  e.stopPropagation();
  e.preventDefault();
};
```

---

## 1.8 Type cho Component State

```tsx
// useState với type tự infer
const [count, setCount] = useState(0);           // inferred: number
const [name, setName] = useState("Hai");         // inferred: string
const [items, setItems] = useState<Item[]>([]);   // explicit: Item[]

// useState với object
interface FormState {
  name: string;
  email: string;
  errors: Record<string, string>;
}

const [form, setForm] = useState<FormState>({
  name: "",
  email: "",
  errors: {},
});

// Update object state - PHẢI spread
setForm(prev => ({ ...prev, name: "New Name" }));

// useState với union
type Status = "idle" | "loading" | "success" | "error";
const [status, setStatus] = useState<Status>("idle");

// useState với null (lazy init)
const [user, setUser] = useState<User | null>(null);
// hoặc dùng lazy initializer
const [expensive, setExpensive] = useState(() => computeExpensiveValue());
```

---

## 1.9 Type cho Custom Hooks

```tsx
// Hook trả về object - type rõ ràng
interface UseToggleReturn {
  value: boolean;
  toggle: () => void;
  setTrue: () => void;
  setFalse: () => void;
}

function useToggle(initial = false): UseToggleReturn {
  const [value, setValue] = useState(initial);
  return {
    value,
    toggle: () => setValue(v => !v),
    setTrue: () => setValue(true),
    setFalse: () => setValue(false),
  };
}

// Hook với generic
interface UseFetchReturn<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

function useFetch<T>(url: string): UseFetchReturn<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

// Dùng
const { data: users, loading, error } = useFetch<User[]>("/api/users");
```

---

## 1.10 Utility Types Cơ Bản

```ts
// Partial<T> - tất cả field thành optional
type PartialUser = Partial<User>;
// { name?: string; age?: number; email?: string }

// Required<T> - tất cả field thành required
type RequiredUser = Required<User>;

// Pick<T, K> - chỉ lấy field cụ thể
type UserBasic = Pick<User, "name" | "email">;
// { name: string; email: string }

// Omit<T, K> - bỏ field cụ thể
type UserWithoutEmail = Omit<User, "email">;
// { name: string; age: number }

// Record<K, V> - dictionary
type UserRoles = Record<string, "admin" | "user" | "guest">;
// { [key: string]: "admin" | "user" | "guest" }

// Exclude<T, U> - loại bỏ type
type NonNull = Exclude<string | number | null | undefined, null | undefined>;
// string | number

// Extract<T, U> - chỉ giữ type match
type StringOrNumber = Extract<string | number | boolean, string | number>;
// string | number

// ReturnType<T> - lấy return type của hàm
type FetchReturnType = ReturnType<typeof fetch>;  // Promise<Response>

// Parameters<T> - lấy parameter type của hàm
type FetchParams = Parameters<typeof fetch>;  // [input: RequestInfo, init?: RequestInit]

// Awaited<T> - unwrap Promise
type UserData = Awaited<Promise<User>>;  // User
```

---

## 1.11 Bài tập

### Bài 1: Component typing
Tạo `<Avatar>` component với props:
- `src: string` (bắt buộc)
- `alt: string` (bắt buộc)
- `size?: number` (default 40)
- `fallback?: React.ReactNode`
- `onError?: () => void`

### Bài 2: Generic List
Tạo `<SearchableList<T extends { id: string }>>` component:
- Nhận `items: T[]`
- Nhận `searchBy: (item: T) => string`
- Nhận `renderItem: (item: T) => React.ReactNode`
- Tự filter theo search input

### Bài 3: Custom Hook
Viết `useLocalStorage<T>(key: string, initialValue: T)` hook:
- Lưu value vào localStorage
- Sync giữa các tab
- Return `[value, setValue]`

### Bài 4: Event Handler
Tạo `<DraggableList>` component:
- List item có thể kéo thả
- Type tất cả event handlers
- `onReorder: (newOrder: Item[]) => void`

> Sang Chương 2 để học TypeScript Nâng Cao.
