# Chương 4: Component Design Patterns - 10+ Patterns Chuyên Nghiệp

> "Component tốt là component nhỏ, linh hoạt, và có thể tái sử dụng."

## 4.1 Props Drilling Problem & Giải Pháp

```tsx
// BAD - Props Drilling
function App() {
  const [user, setUser] = useState<User>();
  return <Dashboard user={user} setUser={setUser} />;
}
function Dashboard({ user, setUser }) {
  return <Sidebar user={user} onLogout={() => setUser(null)} />;
}
function Sidebar({ user, onLogout }) {
  return <UserInfo user={user} onLogout={onLogout} />;
}

// GOOD 1: Context
// GOOD 2: Composition
// GOOD 3: State Manager (Zustand)
```

---

## 4.2 Pattern 1: Compound Component

Component cha quản lý state, component con sử dụng qua Context.

```tsx
interface TabContextValue {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const TabContext = createContext<TabContextValue | null>(null);

function useTabContext() {
  const context = useContext(TabContext);
  if (!context) throw new Error("Tab compound components must be used within <Tabs>");
  return context;
}

// --- Components ---

function Tabs({ children, defaultTab = "" }: { children: ReactNode; defaultTab?: string }) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const value = useMemo(() => ({ activeTab, setActiveTab }), [activeTab]);
  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
}

function TabList({ children }: { children: ReactNode }) {
  return <div role="tablist">{children}</div>;
}

function Tab({ id, children, disabled = false }: { id: string; children: ReactNode; disabled?: boolean }) {
  const { activeTab, setActiveTab } = useTabContext();
  return (
    <button
      role="tab"
      aria-selected={activeTab === id}
      disabled={disabled}
      onClick={() => setActiveTab(id)}
    >
      {children}
    </button>
  );
}

function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  const { activeTab } = useTabContext();
  return activeTab === id ? <div role="tabpanel">{children}</div> : null;
}

// Dùng
<Tabs defaultTab="profile">
  <TabList>
    <Tab id="profile">Profile</Tab>
    <Tab id="settings">Settings</Tab>
    <Tab id="notifications">Notifications</Tab>
  </TabList>
  <TabPanel id="profile">Profile content</TabPanel>
  <TabPanel id="settings">Settings content</TabPanel>
  <TabPanel id="notifications">Notifications content</TabPanel>
</Tabs>
```

---

## 4.3 Pattern 2: Render Props

Component nhận function children để render linh hoạt.

```tsx
interface DataFetcherProps<T> {
  url: string;
  children: (props: { data: T | null; loading: boolean; error: Error | null; refetch: () => void }) => ReactNode;
}

function DataFetcher<T>({ url, children }: DataFetcherProps<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown"));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return <>{children({ data, loading, error, refetch: fetchData })}</>;
}

// Dùng
<DataFetcher<User[]> url="/api/users">
  {({ data: users, loading, error }) => {
    if (loading) return <Spinner />;
    if (error) return <ErrorMessage error={error} />;
    return <UserList users={users ?? []} />;
  }}
</DataFetcher>
```

---

## 4.4 Pattern 3: Polymorphic Component (as prop)

Component render thành tag bất kỳ.

```tsx
import { type ComponentPropsWithoutRef, type ElementType, type ReactNode } from "react";

type AsProp<C extends ElementType> = { as?: C };

type Props<C extends ElementType> = {
  children: ReactNode;
  className?: string;
} & AsProp<C> &
  Omit<ComponentPropsWithoutRef<C>, "children" | "className">;

function Text<C extends ElementType = "span">({
  as,
  children,
  className,
  ...rest
}: Props<C>) {
  const Component = as || "span";
  return <Component className={className} {...rest}>{children}</Component>;
}

// Dùng
<Text as="h1" className="title">Heading</Text>
<Text as="p" className="text">Paragraph</Text>
<Text as="a" href="/about">Link</Text>
<Text as={RouterLink} to="/dashboard">Router Link</Text>
```

---

## 4.5 Pattern 4: Controlled vs Uncontrolled

```tsx
// Controlled - state ở parent
interface ControlledInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  error?: string;
}

function ControlledInput({ value, onChange, label, error }: ControlledInputProps) {
  return (
    <div>
      <label>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} />
      {error && <span className="error">{error}</span>}
    </div>
  );
}

// Uncontrolled - state trong component, dùng ref để đọc
interface UncontrolledInputProps {
  defaultValue?: string;
  label: string;
}

const UncontrolledInput = forwardRef<HTMLInputElement, UncontrolledInputProps>(
  ({ defaultValue, label }, ref) => (
    <div>
      <label>{label}</label>
      <input ref={ref} defaultValue={defaultValue} />
    </div>
  )
);

// Hybrid - controlled khi có value, uncontrolled khi không
interface HybridInputProps {
  value?: string;
  onChange?: (value: string) => void;
  defaultValue?: string;
}
```

---

## 4.6 Pattern 5: Container/Presentational

```tsx
// Container - logic, state, data fetching
function UserListContainer() {
  const { data: users, loading, error } = useFetch<User[]>("/api/users");
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () => users?.filter(u => u.name.toLowerCase().includes(search.toLowerCase())) ?? [],
    [users, search]
  );

  return <UserListPresentation users={filtered} loading={loading} error={error} search={search} onSearchChange={setSearch} />;
}

// Presentational - chỉ UI, không logic
interface UserListPresentationProps {
  users: User[];
  loading: boolean;
  error: Error | null;
  search: string;
  onSearchChange: (value: string) => void;
}

function UserListPresentation({ users, loading, error, search, onSearchChange }: UserListPresentationProps) {
  if (loading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;
  return (
    <div>
      <input value={search} onChange={e => onSearchChange(e.target.value)} placeholder="Search..." />
      <ul>
        {users.map(user => <UserCard key={user.id} user={user} />)}
      </ul>
    </div>
  );
}
```

---

## 4.7 Pattern 6: HOC (Higher-Order Component)

```tsx
// HOC - function nhận component, trả về component mới
function withAuth<P extends object>(
  Component: React.ComponentType<P>
) {
  return function AuthenticatedComponent(props: P) {
    const { user, loading } = useAuth();
    if (loading) return <Spinner />;
    if (!user) return <Redirect to="/login" />;
    return <Component {...props} />;
  };
}

// Dùng
const ProtectedDashboard = withAuth(Dashboard);

// HOC với generics
function withLoading<T>(
  Component: React.ComponentType<T>,
  LoadingComponent: React.FC = Spinner
) {
  return function WithLoadingComponent(props: T & { isLoading: boolean }) {
    const { isLoading, ...rest } = props;
    if (isLoading) return <LoadingComponent />;
    return <Component {...(rest as T)} />;
  };
}
```

---

## 4.8 Pattern 7: Provider Pattern

```tsx
interface AuthContextType {
  user: User | null;
  login: (credentials: Credentials) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const login = useCallback(async (credentials: Credentials) => {
    const { user } = await api.login(credentials);
    setUser(user);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    api.logout();
  }, []);

  const value = useMemo(
    () => ({ user, login, logout, isAuthenticated: !!user }),
    [user, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Custom hook
function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

// Dùng
function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}

function Header() {
  const { user, logout } = useAuth();
  return user ? <button onClick={logout}>Logout</button> : <Link to="/login">Login</Link>;
}
```

---

## 4.9 Pattern 8: Render Optimization (memo, useMemo, useCallback)

```tsx
// React.memo - skip re-render nếu props không thay đổi
const ExpensiveList = React.memo(function ExpensiveList({ items }: { items: Item[] }) {
  return items.map(item => <ExpensiveItem key={item.id} item={item} />);
});

// useCallback - cache function reference
function Parent() {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<Item[]>([]);

  // useCallback đảm bảo handleClick không tạo mới mỗi render
  // nên Child không re-render khi count thay đổi
  const handleClick = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  return (
    <div>
      <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>
      <MemoizedChild items={items} onItemClick={handleClick} />
    </div>
  );
}

const MemoizedChild = React.memo(function Child({
  items,
  onItemClick,
}: {
  items: Item[];
  onItemClick: (id: string) => void;
}) {
  return items.map(item => (
    <div key={item.id} onClick={() => onItemClick(item.id)}>
      {item.name}
    </div>
  ));
});
```

---

## 4.10 Pattern 9: Error Boundary

```tsx
interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === "function") {
        return this.props.fallback(this.state.error!, () => {
          this.setState({ hasError: false, error: null });
        });
      }
      return this.props.fallback ?? <div>Something went wrong</div>;
    }
    return this.props.children;
  }
}

// Dùng
<ErrorBoundary fallback={(error, reset) => (
  <div>
    <h2>Error: {error.message}</h2>
    <button onClick={reset}>Try Again</button>
  </div>
)}>
  <App />
</ErrorBoundary>
```

---

## 4.11 Pattern 10: Slot Pattern

```tsx
interface PageLayoutProps {
  header?: ReactNode;
  sidebar?: ReactNode;
  content: ReactNode;
  footer?: ReactNode;
}

function PageLayout({ header, sidebar, content, footer }: PageLayoutProps) {
  return (
    <div className="layout">
      {header && <header className="layout-header">{header}</header>}
      <div className="layout-body">
        {sidebar && <aside className="layout-sidebar">{sidebar}</aside>}
        <main className="layout-content">{content}</main>
      </div>
      {footer && <footer className="layout-footer">{footer}</footer>}
    </div>
  );
}

// Dùng
<PageLayout
  header={<Header />}
  sidebar={<Sidebar />}
  content={<Dashboard />}
  footer={<Footer />}
/>
```

---

## 4.12 Pattern 11: State Reducer

```tsx
interface UseToggleState {
  on: boolean;
}

type UseToggleAction = { type: "toggle" } | { type: "set"; value: boolean } | { type: "reset" };

function useToggleReducer(state: UseToggleState, action: UseToggleAction): UseToggleState {
  switch (action.type) {
    case "toggle": return { on: !state.on };
    case "set": return { on: action.value };
    case "reset": return { on: false };
  }
}

// State reducer pattern - cho phép customize reducer từ bên ngoài
function useToggle({
  reducer = useToggleReducer,
}: { reducer?: (state: UseToggleState, action: UseToggleAction) => UseToggleState } = {}) {
  const [state, dispatch] = useReducer(reducer, { on: false });
  const toggle = useCallback(() => dispatch({ type: "toggle" }), []);
  const setOn = useCallback((value: boolean) => dispatch({ type: "set", value }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  return { on: state.on, toggle, setOn, reset };
}

// Dùng với custom reducer
function useDoubleToggle() {
  return useToggle({
    reducer: (state, action) => {
      if (action.type === "toggle") {
        return { on: !state.on }; // Có thể customize behavior
      }
      return useToggleReducer(state, action);
    },
  });
}
```

---

## 4.13 So sánh Patterns

| Pattern | Khi nào dùng | Ví dụ |
|:---|:---|:---|
| Compound | Component có nhiều sub-components | Tabs, Accordion, Dialog |
| Render Props | Logic phức tạp, cần linh hoạt render | DataFetcher, MouseTracker |
| Polymorphic | Component render thành nhiều tag | Button (button/a/link) |
| Controlled/Uncontrolled | Input cần cả 2 mode | Input, Select, DatePicker |
| Container/Presentational | Tách logic khỏi UI | Dashboard, UserList |
| HOC | Cross-cutting concern | withAuth, withLoading |
| Provider | Global state/context | Auth, Theme, Language |
| Error Boundary | Catch render errors | App-wide error handling |
| Slot | Layout linh hoạt | PageLayout, CardLayout |
| State Reducer | Customize hook behavior | useToggle, useCounter |

---

## 4.14 Bài tập

### Bài 1: Dialog Compound Component
Tạo `<Dialog>` compound component:
- `<Dialog>`, `<DialogTrigger>`, `<DialogContent>`, `<DialogTitle>`, `<DialogClose>`
- Handle click outside để close
- Escape key để close
- Focus trap khi open

### Bài 2: List Virtualization
Tạo `<VirtualizedList>` component:
- Hiển thị 1000+ items
- Chỉ render items visible trong viewport
- Smooth scroll
- Type-safe với generic

### Bài 3: Toast Notification System
Tạo toast system với:
- `<ToastProvider>` wrapping app
- `useToast()` hook
- Types: success, error, warning, info
- Auto-dismiss với timer
- Stack multiple toasts

> Sang Chương 5 để học State Management.
