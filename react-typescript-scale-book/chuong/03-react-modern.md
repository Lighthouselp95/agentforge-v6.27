# Chương 3: React Modern - Từ Gốc Đến Nâng Cao

### 3.1 JSX Là Gì? - Bài học sai lầm phổ biến

JSX không phải HTML. JSX transpile thành `React.createElement(type, props, children)`.

```tsx
// <div className="x">Hello</div>
// trở thành:
React.createElement('div', { className: 'x' }, 'Hello');
```

**Quy tắc JSX:**
- Chỉ trả về 1 element cha -> dùng `<>...</>` Fragment
- `className` không phải `class` (React dùng JSX thuộc tính camelCase)
- `htmlFor` không phải `for`
- Tất cả tag phải đóng: `<br />`, `<img />`

### 3.2 Virtual DOM & Reconciliation - Cơ Chế React

1. **React Element** = mô tả nhẹ (`{ type: 'div', props: ... }`)
2. **React Fiber** = cây linked-list nội bộ, cho phép pause/resume render
3. **Reconciliation**: So sánh cây cũ - mới, chỉ update nơi thay đổi (diffing algorithm O(n))

### 3.3 Hooks Nâng Cao

```tsx
// useReducer - state phức tạp hơn useState
type State = { count: number; step: number };
type Action = { type: 'inc' } | { type: 'dec'; amount: number };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'inc': return { ...state, count: state.count + state.step };
    case 'dec': return { ...state, count: state.count - action.amount };
  }
}

const [state, dispatch] = useReducer(reducer, { count: 0, step: 1 });

// useContext - tránh prop drilling
const ThemeContext = createContext<{ theme: string; setTheme: (t: string) => void } | null>(null);
function App() {
  const [theme, setTheme] = useState('light');
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <Toolbar />
    </ThemeContext.Provider>
  );
}
function Toolbar() {
  const { theme, setTheme } = useContext(ThemeContext)!;
  return <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>Toggle</button>;
}

// useMemo / useCallback - tối ưu performance
const memoizedValue = useMemo(() => computeExpensiveValue(a, b), [a, b]);
const memoizedCallback = useCallback(() => { doSomething(a); }, [a]);

// useRef - giữ giá trị xuyên render, không trigger re-render
const inputRef = useRef<HTMLInputElement>(null);
useEffect(() => { inputRef.current?.focus(); }, []);

// useId - unique id cho accessibility (React 18+)
const id = useId();
<label htmlFor={id}>Name:</label>;
<input id={id} />
```

### 3.4 Lifecycle - Khi Nào Gọi Gì

```tsx
function Component({ url }) {
  const [data, setData] = useState(null);

  // 1. Render đầu tiên (mount)
  // 2. useEffect -> chạy sau khi DOM render xong (async, side-effect)
  useEffect(() => {
    fetch(url).then(r => r.json()).then(setData);
    return () => { /* cleanup khi unmount hoặc url thay đổi */ };
  }, [url]); // dependency array

  // 3. Render tiếp theo nếu url thay đổi
  // 4. Cleanup khi unmount hoặc url thay đổi trước khi useEffect mới chạy
  // 5. Unmount -> cleanup cuối cùng
}
```

### 3.5 Custom Hook - Tái Sử Dụng Logic

```tsx
// Custom hook dùng "use" prefix, có thể gọi hook khác
function useFetch<T>(url: string): { data: T | null; loading: boolean; error: Error | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(url)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e); setLoading(false); } });
    return () => { cancelled = true; };
  }, [url]);

  return { data, loading, error };
}

// Dùng
function UserProfile({ userId }) {
  const { data: user, loading, error } = useFetch<User>(`/api/users/${userId}`);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  return <UserCard user={user} />;
}
```

### 3.6 Bài tập
Viết `useDebounce<T>(value: T, delay: number): T` - trả về value đã debounce.

### 3.7 Kiến thức sâu: Concurrent Features (React 18+)
```tsx
// useTransition - đánh dấu update không khẩn cấp
const [isPending, startTransition] = useTransition();
startTransition(() => { setSearchResults(filter(query)); }); // không block UI

// useDeferredValue - deferred version của value
const deferredQuery = useDeferredValue(query);

// Suspense - chờ trước khi render
<Suspense fallback={<Spinner />}>
  <DataComponent url={url} />
</Suspense>
```

> Sang Chương 4 để học Component Design Patterns.
