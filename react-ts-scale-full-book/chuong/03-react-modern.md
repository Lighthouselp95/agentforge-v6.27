# Chương 3: React Modern - Hooks, Lifecycle & Concurrent

> "React không phải framework. Nó là cách suy nghĩ về UI."

## 3.1 JSX - Không Phải HTML

JSX transpile thành `React.createElement(type, props, children)`.

```tsx
// <div className="x">Hello</div> trở thành:
React.createElement("div", { className: "x" }, "Hello");

// JSX rules - PHẢI NHỚ:
// 1. Chỉ trả về 1 element cha -> dùng <></> Fragment
// 2. className không phải class
// 3. htmlFor không phải for
// 4. Tất cả tag phải đóng: <br />, <img />
// 5. style phải là object: style={{ color: 'red' }}
// 6. Event handlers camelCase: onClick, onChange
// 7. comments trong JSX: {/* ... */}
```

---

## 3.2 Virtual DOM & Reconciliation

**Cơ chế 3 bước:**
1. **React Element** = mô tả nhẹ (`{ type: 'div', props: { children: 'Hello' } }`)
2. **React Fiber** = cây linked-list nội bộ, cho phép pause/resume render
3. **Reconciliation** = diffing algorithm O(n), chỉ update nơi thay đổi

**Key prop quyết định diff:**
- Có key → React so sánh key → tìm được node di chuyển
- Không key → React so sánh theo index → phải recreate toàn bộ

---

## 3.3 Tất Cả Hooks Phải Biết

### useState

```tsx
// Cơ bản
const [count, setCount] = useState(0);

// Lazy initializer (chỉ chạy 1 lần)
const [expensive, setExpensive] = useState(() => computeExpensiveValue());

// Object state - PHẢI spread
const [user, setUser] = useState({ name: "Hai", age: 25 });
setUser(prev => ({ ...prev, age: prev.age + 1 }));

// Functional update - đọc state trước đó
setCount(prev => prev + 1);  // an toàn hơn count + 1

// Array state
const [items, setItems] = useState<string[]>([]);
const addItem = (item: string) => setItems(prev => [...prev, item]);
const removeItem = (id: string) => setItems(prev => prev.filter(i => i.id !== id));
```

### useRef

```tsx
// DOM reference
const inputRef = useRef<HTMLInputElement>(null);
useEffect(() => { inputRef.current?.focus(); }, []);

// Mutable value (không trigger re-render)
const renderCount = useRef(0);
renderCount.current++;

// Lưu giá trị cũ
const prevValue = useRef(value);
useEffect(() => {
  prevValue.current = value;
}, [value]);

// Lưu interval/timeout ID
const intervalRef = useRef<NodeJS.Timeout | null>(null);
useEffect(() => {
  intervalRef.current = setInterval(() => { /* ... */ }, 1000);
  return () => clearInterval(intervalRef.current!);
}, []);

// Lưu subscription
const subscriptionRef = useRef<Subscription | null>(null);
```

### useEffect

```tsx
// Chạy sau khi render (async, side-effect)
useEffect(() => {
  document.title = `Count: ${count}`;
}, [count]); // dependency array

// Cleanup function
useEffect(() => {
  const controller = new AbortController();
  fetch(url, { signal: controller.signal })
    .then(r => r.json())
    .then(setData);
  return () => controller.abort(); // cleanup khi unmount hoặc url thay đổi
}, [url]);

// Dependency array rules:
// - Luôn include tất cả external values
// - Omit nếu muốn chạy 1 lần (mount)
// - Không include object/function mới mỗi render
const fetchData = useCallback(() => { /* ... */ }, [id]);
useEffect(() => { fetchData(); }, [fetchData]);
```

### useMemo & useCallback

```tsx
// useMemo - cache computed value
const sortedItems = useMemo(() => {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}, [items]);

// useCallback - cache function reference
const handleClick = useCallback(() => {
  doSomething(a, b);
}, [a, b]);

// Khi nào dùng?
// useMemo: computation đắt tiền (sort, filter lớn, calculations)
// useCallback: callback truyền xuống child component hoặc dependency của useEffect
// KHÔNG dùng cho mọi thứ - thêm overhead có thể chậm hơn
```

### useContext

```tsx
// Tránh prop drilling
interface ThemeContextType {
  theme: "light" | "dark";
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

// Custom hook để check null
function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}

function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === "light" ? "dark" : "light");
  }, []);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
      <Toolbar />
    </ThemeContext.Provider>
  );
}
```

### useReducer

```tsx
// State phức tạp hơn useState
interface State {
  count: number;
  step: number;
}

type Action =
  | { type: "inc" }
  | { type: "dec"; amount: number }
  | { type: "setStep"; step: number }
  | { type: "reset" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "inc":
      return { ...state, count: state.count + state.step };
    case "dec":
      return { ...state, count: state.count - action.amount };
    case "setStep":
      return { ...state, step: action.step };
    case "reset":
      return { count: 0, step: 1 };
  }
}

function Counter() {
  const [state, dispatch] = useReducer(reducer, { count: 0, step: 1 });
  return (
    <div>
      <p>Count: {state.count}</p>
      <button onClick={() => dispatch({ type: "inc" })}>+</button>
      <button onClick={() => dispatch({ type: "dec", amount: 1 })}>-</button>
      <button onClick={() => dispatch({ type: "reset" })}>Reset</button>
    </div>
  );
}
```

### useId

```tsx
// Unique ID cho accessibility (React 18+)
function FormField({ label }: { label: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" />
    </div>
  );
}
```

### useLayoutEffect

```tsx
// Chạy同步 sau render, trước browser paint
// Dùng khi cần measure DOM trước khi render
function Tooltip({ target, text }: { target: RefObject<HTMLElement>; text: string }) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!target.current || !tooltipRef.current) return;
    const targetRect = target.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    setPosition({
      top: targetRect.top - tooltipRect.height - 8,
      left: targetRect.left + (targetRect.width - tooltipRect.width) / 2,
    });
  }, [target]);

  return <div ref={tooltipRef} style={{ position: "fixed", top: position.top, left: position.left }}>{text}</div>;
}
```

### useImperativeHandle

```tsx
// Custom handle cho ref
interface InputHandle {
  focus: () => void;
  clear: () => void;
}

const FancyInput = forwardRef<InputHandle, InputProps>((props, ref) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    clear: () => { if (inputRef.current) inputRef.current.value = ""; },
  }));

  return <input ref={inputRef} {...props} />;
});

// Dùng
function App() {
  const inputRef = useRef<InputHandle>(null);
  return (
    <>
      <FancyInput ref={inputRef} />
      <button onClick={() => inputRef.current?.focus()}>Focus</button>
      <button onClick={() => inputRef.current?.clear()}>Clear</button>
    </>
  );
}
```

---

## 3.4 Lifecycle - Khi Nào Gọi Gì

```
Mount:
  render → DOM update → useEffect(() => { /* mount */ }, [])
                        → useLayoutEffect(() => { /* mount */ }, [])

Update:
  render → DOM update → useEffect cleanup (deps changed)
                        → useEffect(() => { /* update */ }, [deps])
                        → useLayoutEffect(...)

Unmount:
  useEffect cleanup → useLayoutEffect cleanup → DOM removed
```

---

## 3.5 Custom Hooks - Tái Sử Dụng Logic

```tsx
// useDebounce
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// useMediaQuery
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

// useClickOutside
function useClickOutside(
  ref: RefObject<HTMLElement>,
  handler: () => void
) {
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      handler();
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [ref, handler]);
}

// useKeyboard
function useKeyboard(
  key: string,
  callback: () => void,
  modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean }
) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== key) return;
      if (modifiers?.ctrl && !e.ctrlKey) return;
      if (modifiers?.shift && !e.shiftKey) return;
      if (modifiers?.alt && !e.altKey) return;
      callback();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [key, callback, modifiers]);
}
```

---

## 3.6 Concurrent Features (React 18+)

```tsx
// useTransition - đánh dấu update không khẩn cấp
const [isPending, startTransition] = useTransition();
startTransition(() => {
  setSearchResults(filter(query));  // không block UI
});

// useDeferredValue - deferred version của value
const deferredQuery = useDeferredValue(query);

// Suspense - chờ trước khi render
<Suspense fallback={<Spinner />}>
  <DataComponent />
</Suspense>

// Server-side: await trong Server Component
async function Page() {
  const data = await fetchData();  // await trực tiếp
  return <Dashboard data={data} />;
}
```

---

## 3.7 Bài tập

### Bài 1: useLocalStorage
Viết hook `useLocalStorage<T>(key: string, initialValue: T)`:
- Lưu vào localStorage
- Sync giữa các tab (sử dụng `storage` event)
- Type-safe

### Bài 2: useIntersectionObserver
Viết hook `useIntersectionObserver(options: IntersectionObserverInit)`:
- Return `[ref, isIntersecting]`
- Dùng cho lazy loading, infinite scroll

### Bài 3: useAsync
Viết hook `useAsync<T>(asyncFn: () => Promise<T>, deps: DependencyList)`:
- Return `{ data, loading, error, refetch }`
- Handle race condition (cancel previous request)

> Sang Chương 4 để học Component Patterns.
