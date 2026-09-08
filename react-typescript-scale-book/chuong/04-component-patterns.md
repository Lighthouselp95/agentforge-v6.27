# Chương 4: Component Design Patterns - Chuyên Nghiệp

### 4.1 Props Drilling Problem & Giải Pháp

```tsx
// BAD - props drilling
function App() {
  const [user, setUser] = useState<User>();
  return <Dashboard user={user} setUser={setUser} />;
}
function Dashboard({ user, setUser }) {
  return <Sidebar user={user} onLogout={() => setUser(null)} />;
}

// GOOD - Context hoặc Composition
```

### 4.2 Compound Component Pattern

Component cha quản lý state, component con sử dụng qua Context.

```tsx
interface TabContextValue {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const TabContext = createContext<TabContextValue | null>(null);

// Cha
function Tabs({ children, defaultTab = '' }: { children: ReactNode; defaultTab?: string }) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  return (
    <TabContext.Provider value={{ activeTab, setActiveTab }}>
      <div className="tabs">{children}</div>
    </TabContext.Provider>
  );
}

// Con
function TabList({ children }: { children: ReactNode }) {
  return <div className="tab-list">{children}</div>;
}
function Tab({ id, children }: { id: string; children: ReactNode }) {
  const { activeTab, setActiveTab } = useContext(TabContext)!;
  return (
    <button
      className={activeTab === id ? 'active' : ''}
      onClick={() => setActiveTab(id)}
    >
      {children}
    </button>
  );
}
function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  const { activeTab } = useContext(TabContext)!;
  return activeTab === id ? <div>{children}</div> : null;
}

// Dùng đẹp
<Tabs defaultTab="profile">
  <TabList>
    <Tab id="profile">Profile</Tab>
    <Tab id="settings">Settings</Tab>
  </TabList>
  <TabPanel id="profile">...</TabPanel>
  <TabPanel id="settings">...</TabPanel>
</Tabs>
```

### 4.3 Render Props Pattern

```tsx
type RenderProps<T> = {
  data: T;
  loading: boolean;
};

function DataFetcher<T>({
  url,
  children,
}: { url: string; children: (props: RenderProps<T>) => ReactNode }) {
  const { data, loading } = useFetch<T>(url);
  return <>{children({ data, loading })}</>;
}

// Dùng
<DataFetcher url="/api/users">
  {({ data: users, loading }) => loading ? <Spinner /> : <UserList users={users} />}
</DataFetcher>
```

### 4.4 Polymorphic Component

Component nhận `as` prop để render thành tag bất kỳ.

```tsx
import { type ComponentPropsWithoutRef, type ReactNode } from 'react';

type AsProp<C extends React.ElementType> = {
  as?: C;
};

type Props<C extends React.ElementType> = {
  children: ReactNode;
} & AsProp<C> &
  Omit<ComponentPropsWithoutRef<C>, 'children'>;

function Button<C extends React.ElementType = 'button'>({
  as,
  children,
  ...rest
}: Props<C>) {
  const Component = as || 'button';
  return <Component {...rest}>{children}</Component>;
}

// Dùng linh hoạt
<Button>Click me</Button>
<Button as="a" href="/login">Login</Button>
<Button as={RouterLink} to="/dashboard">Go</Button>
```

### 4.5 Controlled vs Uncontrolled Component

```tsx
// Controlled - state ở cha
function Input({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input value={value} onChange={e => onChange(e.target.value)} />;
}

// Uncontrolled - state trong chính nó, dùng ref để đọc
function SearchInput() {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={inputRef} />
      <button onClick={() => alert(inputRef.current?.value)}>Search</button>
    </>
  );
}
```

### 4.6 Bài tập
Tạo component `<DataTable>` sử dụng Compound Component + Polymorphic + Custom Hook.

> Sang Chương 5 để học State Management toàn diện.
