# Chương 2: TypeScript Nâng Cao - Bậc Thầy Type System

> "Bậc thầy TypeScript không phải là viết được type phức tạp. Mà là viết type đơn giản đến mức ai cũng hiểu."

## 2.1 Generics Nâng Cao

### Generic với Constraint (extends)

```ts
// T phải có field id
function findById<T extends { id: string }>(
  items: T[],
  id: string
): T | undefined {
  return items.find(item => item.id === id);
}

// T extends keyof U - keyof type phải match U
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

const user = { name: "Hai", age: 25 };
const name = getProperty(user, "name");  // string
const age = getProperty(user, "age");    // number
// getProperty(user, "email"); // LỖI: "email" không có trong User
```

### Generic với Default

```ts
type ApiResponse<T = unknown, E = Error> = {
  data: T;
  error?: E;
  status: number;
  timestamp: Date;
};

// Dùng với default
const res1: ApiResponse = await fetchSomething();
// res1.data là unknown

// Dùng với type cụ thể
const res2: ApiResponse<User[]> = await fetchUsers();
// res2.data là User[]
```

### Generic trong Interface

```ts
interface Repository<T> {
  findAll(): Promise<T[]>;
  findById(id: string): Promise<T | null>;
  create(item: Omit<T, "id" | "createdAt">): Promise<T>;
  update(id: string, item: Partial<T>): Promise<T>;
  delete(id: string): Promise<boolean>;
}

// Implement
class UserRepository implements Repository<User> {
  async findAll(): Promise<User[]> {
    const res = await fetch("/api/users");
    return res.json();
  }
  // ... các method khác
}

// Generic trong class
class Cache<T> {
  private store = new Map<string, { data: T; expiry: number }>();

  set(key: string, value: T, ttl: number): void {
    this.store.set(key, { data: value, expiry: Date.now() + ttl });
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }
}

const userCache = new Cache<User>();
userCache.set("user:1", user, 60000); // 60s TTL
```

---

## 2.2 Conditional Types

Kiểu phụ thuộc vào điều kiện - như if/else nhưng cho type.

```ts
// Cơ bản
type IsString<T> = T extends string ? "yes" : "no";
type A = IsString<string>;  // "yes"
type B = IsString<number>;  // "no"

// Nested conditional
type Flatten<T> = T extends Array<infer U> ? U : T;
type C = Flatten<string[]>;   // string
type D = Flatten<number[]>;   // number
type E = Flatten<boolean>;    // boolean

// Conditional với infer - extract function return type
type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
type F = UnwrapPromise<Promise<string>>;  // string
type G = UnwrapPromise<number>;           // number

// Nested infer
type DeepUnwrap<T> = T extends Promise<infer U> ? DeepUnwrap<U> : T;
type H = DeepUnwrap<Promise<Promise<string>>>;  // string
```

### Conditional trong React

```tsx
// Props merger - type-safe merge props
type MergeProps<T, U> = Omit<T, keyof U> & U;

function mergeProps<T extends object, U extends object>(
  base: T,
  overrides: U
): MergeProps<T, U> {
  return { ...base, ...overrides };
}

const base = { className: "btn", disabled: false };
const overrides = { className: "btn-primary", onClick: () => {} };
const merged = mergeProps(base, overrides);
// typeof merged = { className: string; disabled: boolean; onClick: () => void }
```

---

## 2.3 Mapped Types

Duyệt từng field để tạo type mới.

```ts
// Cơ bản - map từ T sang T[K] với modifier
type ReadOnly<T> = {
  readonly [K in keyof T]: T[K];
};

type Optional<T> = {
  [K in keyof T]?: T[K];
};

type Nullable<T> = {
  [K in keyof T]: T[K] | null;
};

// Map với remap key
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

interface User {
  name: string;
  age: number;
}

type UserGetters = Getters<User>;
// { getName: () => string; getAge: () => number }

// Map với filter
type StringKeys<T> = {
  [K in keyof T as T[K] extends string ? K : never]: T[K];
};

type UserStrings = StringKeys<User>;
// { name: string } - age bị loại vì number
```

### Mapped trong React

```tsx
// Tạo component với tất cả props optional
type OptionalProps<T> = {
  [K in keyof T]?: T[K];
};

// Tạo event handler type từ props
type EventHandlerProps<T> = {
  [K in keyof T as K extends `on${string}` ? K : never]: T[K];
};

// Ví dụ: extract tất cả event handlers từ props
interface ButtonProps {
  label: string;
  onClick: () => void;
  onMouseEnter: () => void;
  disabled: boolean;
}

type ButtonEventHandlers = EventHandlerProps<ButtonProps>;
// { onClick: () => void; onMouseEnter: () => void }
```

---

## 2.4 Template Literal Types

Tạo type từ string template.

```ts
// Cơ bản
type EventName<E extends string> = `on${Capitalize<E>}`;
type ClickEvent = EventName<"click">;     // "onClick"
type HoverEvent = EventName<"hover">;     // "onHover"
type FocusEvent = EventName<"focus">;     // "onFocus"

// Kết hợp với union
type CSSProperty = "margin" | "padding";
type CSSDirection = "top" | "right" | "bottom" | "left";
type CSSSpacing = `${CSSProperty}-${CSSDirection}`;
// "margin-top" | "margin-right" | ... | "padding-left"

// REST API endpoint type
type APIVersion = "v1" | "v2";
type Resource = "users" | "posts" | "comments";
type APIEndpoint = `/${APIVersion}/${Resource}`;
// "/v1/users" | "/v1/posts" | ... | "/v2/comments"

// Component prop naming
type ComponentProp<T extends string> = `${T}Props`;
type ButtonComponentProps = ComponentProp<"Button">;  // "ButtonProps"
```

### Template trong React

```tsx
// Tự động tạo handler type từ event name
type HandlerProps<T extends string> = {
  [K in T as `on${Capitalize<K>}`]: (event: any) => void;
};

type DragHandlers = HandlerProps<"drag" | "dragEnd" | "dragStart">;
// {
//   onDrag: (event: any) => void;
//   onDragEnd: (event: any) => void;
//   onDragStart: (event: any) => void;
// }

// Tạo CSS class type từ variant + size
type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";
type ButtonClass = `btn-${ButtonVariant}-${ButtonSize}`;
// "btn-primary-sm" | "btn-primary-md" | ... | "btn-ghost-lg"
```

---

## 2.5 Type Guards & Narrowing

```ts
// typeof guard
function format(value: string | number) {
  if (typeof value === "string") {
    return value.toUpperCase();  // TS biết value là string
  }
  return value.toFixed(2);      // TS biết value là number
}

// instanceof guard
function handleError(error: Error | string) {
  if (error instanceof Error) {
    console.log(error.message);  // TS biết là Error
    console.log(error.stack);
  } else {
    console.log(error);          // TS biết là string
  }
}

// in guard
interface Cat { meow(): void; }
interface Dog { bark(): void; }

function makeSound(animal: Cat | Dog) {
  if ("meow" in animal) {
    animal.meow();   // TS biết là Cat
  } else {
    animal.bark();   // TS biết là Dog
  }
}

// Custom type guard (type predicate)
function isUser(obj: unknown): obj is User {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "name" in obj &&
    "email" in obj
  );
}

function process(data: unknown) {
  if (isUser(data)) {
    console.log(data.name);   // TS biết là User
    console.log(data.email);
  }
}

// Assertion function
function assertIsString(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Expected string, got ${typeof value}`);
  }
}

function processString(input: unknown) {
  assertIsString(input);
  console.log(input.toUpperCase());  // TS biết là string
}
```

### Type Guard trong React

```tsx
// Discriminated Union với type guard
type ApiResponse =
  | { status: "loading" }
  | { status: "success"; data: User[] }
  | { status: "error"; error: string };

function UserList({ response }: { response: ApiResponse }) {
  if (response.status === "loading") {
    return <Spinner />;
  }
  if (response.status === "error") {
    return <Error message={response.error} />;
  }
  // TS biết response.status === "success" ở đây
  return (
    <ul>
      {response.data.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

---

## 2.6 Declaration Merging

Gộp type khi dùng thư viện bên ngoài.

```ts
// Khi dùng thư viện thiếu type
declare module "some-lib" {
  interface Config {
    debug: boolean;
  }
}

// Gộp vào module đã có
declare module "react" {
  interface ComponentProps<T> {
    "data-analytics"?: string;
  }
}

// Gộp vào global
declare global {
  interface Window {
    __DEV__: boolean;
    __ENV__: Record<string, string>;
  }
}
```

---

## 2.7 satisfies Operator (TypeScript 4.9+)

```ts
// Đảm bảo object đúng shape MÀ KHÔNG thay đổi type

// Cách cũ - có thể mất type info
const themes = {
  primary: "#000",
  secondary: "#fff",
} as Record<string, string>;
// themes.primary có type string - mất info cụ thể

// Cách mới với satisfies - giữ nguyên type cụ thể
const themes = {
  primary: "#000",
  secondary: "#fff",
} satisfies Record<string, string>;
// themes.primary vẫn là "#000" (literal type)

// Type-safe config
const config = {
  apiUrl: "https://api.example.com",
  timeout: 5000,
  retries: 3,
} satisfies Record<string, string | number>;
// Lỗi nếu value không phải string | number

// Union với satisfies
type Route = "/" | "/about" | "/contact";
const routes = {
  home: "/",
  about: "/about",
  contact: "/contact",
} satisfies Record<string, Route>;
// routes.home có type "/" (literal) thay vì string
```

---

## 2.8 Infer Keyword

```ts
// Infer - "đoán" type từ position

// Extract function return type
type ReturnOf<T> = T extends (...args: any[]) => infer R ? R : never;
type A = ReturnOf<() => string>;  // string

// Extract function params
type ParamsOf<T> = T extends (...args: infer P) => any ? P : never;
type B = ParamsOf<(a: string, b: number) => void>;  // [a: string, b: number]

// Extract array element type
type ElementOf<T> = T extends (infer E)[] ? E : never;
type C = ElementOf<string[]>;  // string

// Extract Promise type
type Unwrap<T> = T extends Promise<infer U> ? U : T;
type D = Unwrap<Promise<User>>;  // User

// Extract object value type
type ValueOf<T> = T[keyof T];
type E = ValueOf<{ name: string; age: number }>;  // string | number

// Deep extract
type DeepExtract<T, K extends string> =
  K extends `${infer Head}.${infer Tail}`
    ? Head extends keyof T
      ? DeepExtract<T[Head], Tail>
      : never
    : K extends keyof T
      ? T[K]
      : never;

type Config = { db: { host: string; port: number } };
type Host = DeepExtract<Config, "db.host">;  // string
```

### Infer trong React

```tsx
// Extract props từ component
type ExtractProps<T> = T extends React.ComponentType<infer P> ? P : never;

type ButtonProps = ExtractProps<typeof Button>;
// Lấy type props từ Button component

// Extract context value
type ExtractContext<T> = T extends React.Context<infer V> ? V : never;

const ThemeContext = createContext<{ theme: string }>({ theme: "light" });
type Theme = ExtractContext<typeof ThemeContext>;  // { theme: string }
```

---

## 2.9 Practical Examples

### Type-safe API Layer

```ts
// Define API endpoints với type
interface APIEndpoints {
  "/users": {
    GET: { response: User[]; query: { page?: number } };
    POST: { response: User; body: Omit<User, "id"> };
  };
  "/users/:id": {
    GET: { response: User };
    PUT: { response: User; body: Partial<User> };
    DELETE: { response: void };
  };
}

// Type-safe fetch function
async function api<
  Path extends keyof APIEndpoints,
  Method extends keyof APIEndpoints[Path]
>(
  path: Path,
  method: Method,
  options?: {
    body?: APIEndpoints[Path][Method] extends { body: infer B } ? B : never;
    query?: APIEndpoints[Path][Method] extends { query: infer Q } ? Q : never;
  }
): Promise<
  APIEndpoints[Path][Method] extends { response: infer R } ? R : never
> {
  // Implementation
  const url = new URL(path, "https://api.example.com");
  if (options?.query) {
    Object.entries(options.query).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });
  }
  const res = await fetch(url.toString(), {
    method: method as string,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  return res.json();
}

// Dùng - type-safe hoàn toàn
const users = await api("/users", "GET");
// users: User[]

const newUser = await api("/users", "POST", {
  body: { name: "Hai", email: "hai@test.com" },
});
// newUser: User
```

### Type-safe Event Emitter

```ts
type EventMap = {
  "user:login": { userId: string; timestamp: number };
  "user:logout": { userId: string };
  "message:new": { from: string; content: string };
};

class TypedEventEmitter<Events extends Record<string, unknown>> {
  private listeners = new Map<string, Set<(data: any) => void>>();

  on<K extends keyof Events>(
    event: K,
    listener: (data: Events[K]) => void
  ): () => void {
    if (!this.listeners.has(event as string)) {
      this.listeners.set(event as string, new Set());
    }
    this.listeners.get(event as string)!.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event as string)?.delete(listener);
    };
  }

  emit<K extends keyof Events>(event: K, data: Events[K]): void {
    this.listeners.get(event as string)?.forEach(listener => listener(data));
  }
}

// Dùng - type-safe event handling
const emitter = new TypedEventEmitter<EventMap>();

const unsub = emitter.on("user:login", (data) => {
  console.log(data.userId);    // string
  console.log(data.timestamp); // number
});

emitter.emit("user:login", { userId: "123", timestamp: Date.now() });
// emitter.emit("user:login", { wrong: "data" }); // LỖI!
```

---

## 2.10 Bài tập

### Bài 1: Type-safe Store
Tạo `TypedStore<T>` class với:
- `get(key: keyof T): T[keyof T]`
- `set<K extends keyof T>(key: K, value: T[K]): void`
- `getAll(): T`

### Bài 2: Conditional Type cho Props
Tạo `InferProps<T>` type:
- Nếu T là React component → trả về props type
- Nếu T là function → trả về parameter types
- Nếu T là object → trả về `{ [K in keyof T]: InferProps<T[K]> }`

### Bài 3: Template Literal Router
Tạo type `RouteParams<T>` từ template literal:
- `"/users/:id/posts/:postId"` → `{ id: string; postId: string }`
- `"/posts"` → `{}`

### Bài 4: Type-safe Builder
Tạo `QueryBuilder<T>` builder pattern:
```ts
const query = new QueryBuilder<User>()
  .select("name", "email")
  .where("age", ">", 18)
  .orderBy("name", "asc")
  .build();
// type-safe: chỉ select được field có trong User
```

> Sang Chương 3 để học React Modern.
