# Chương 5: State Management Toàn Diện

> "State management không phải problem. Problem là chọn sai tool."

## 5.1 Quy Tắc Chọn State Manager

```
State chỉ dùng 1 component? → useState/useReducer
State chia sẻ nhiều component, ít thay đổi? → Context
State chia sẻ nhiều, hay thay đổi? → Zustand
State phức tạp với middleware, devtools? → Redux Toolkit
State cần persistent + sync tabs? → Zustand (persist)
State atomic, riêng biệt? → Jotai
```

---

## 5.2 useState & useReducer - Nền Tảng

```tsx
// useState - state đơn giản
const [count, setCount] = useState(0);
const [user, setUser] = useState<User | null>(null);

// useReducer - state phức tạp với nhiều action
type State = { items: Item[]; filter: string; sort: "asc" | "desc" };
type Action =
  | { type: "ADD"; item: Item }
  | { type: "REMOVE"; id: string }
  | { type: "FILTER"; filter: string }
  | { type: "SORT"; sort: "asc" | "desc" }
  | { type: "RESET" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD":
      return { ...state, items: [...state.items, action.item] };
    case "REMOVE":
      return { ...state, items: state.items.filter(i => i.id !== action.id) };
    case "FILTER":
      return { ...state, filter: action.filter };
    case "SORT":
      return { ...state, sort: action.sort };
    case "RESET":
      return { items: [], filter: "", sort: "asc" };
  }
}
```

---

## 5.3 Context - Khi Nào Dùng?

```tsx
// Context tốt cho:
// 1. Theme (light/dark)
// 2. Language (vi/en)
// 3. Auth (user, token)
// 4. Routing (current route)

// Context KHÔNG tốt cho:
// 1. State hay thay đổi (gây re-render toàn bộ tree)
// 2. State phức tạp với nhiều update
// 3. Performance-critical state

const AppContext = createContext<{
  theme: "light" | "dark";
  locale: string;
  user: User | null;
} | null>(null);

// Custom hook
function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be inside AppProvider");
  return ctx;
}
```

---

## 5.4 Zustand - State Manager Hiện Đại (Khuyến Nghị)

### Tại sao Zustand?

- Không cần Provider wrapper
- Selector - chỉ re-render khi field cần thiết thay đổi
- Middleware: persist, devtools, immer
- Lightweight (~1KB)
- TypeScript-first

### Zustand Cơ Bản

```tsx
import { create } from "zustand";

interface CounterState {
  count: number;
  increment: () => void;
  decrement: () => void;
  reset: () => void;
}

const useCounterStore = create<CounterState>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 })),
  reset: () => set({ count: 0 }),
}));

// Dùng
function Counter() {
  const count = useCounterStore((state) => state.count);
  const increment = useCounterStore((state) => state.increment);
  return <button onClick={increment}>{count}</button>;
}
```

### Zustand với Middleware

```tsx
import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

interface AuthState {
  user: User | null;
  token: string | null;
  login: (credentials: Credentials) => Promise<void>;
  logout: () => void;
  updateProfile: (data: Partial<User>) => void;
}

const useAuthStore = create<AuthState>()(
  devtools(
    persist(
      immer((set, get) => ({
        user: null,
        token: null,
        login: async (credentials) => {
          const { user, token } = await api.login(credentials);
          set((state) => {
            state.user = user;      // immer: mutable syntax
            state.token = token;
          });
        },
        logout: () => set({ user: null, token: null }),
        updateProfile: (data) =>
          set((state) => {
            if (state.user) {
              Object.assign(state.user, data);  // immer
            }
          }),
      })),
      { name: "auth-storage" }  // persist vào localStorage
    ),
    { name: "AuthStore" }  // devtools name
  )
);
```

### Zustand Selectors

```tsx
// BAD - re-render mọi khi store thay đổi
function UserCard() {
  const { user } = useAuthStore();
  return <div>{user?.name}</div>;
}

// GOOD - chỉ re-render khi user thay đổi
function UserCard() {
  const user = useAuthStore((state) => state.user);
  return <div>{user?.name}</div>;
}

// Selector complex
const useUserTasks = useAuthStore(
  (state) => state.tasks.filter((t) => t.userId === state.user?.id)
);

// Shallow comparison cho object
import { useShallow } from "zustand/react/shallow";

function Dashboard() {
  const { user, tasks } = useAuthStore(
    useShallow((state) => ({
      user: state.user,
      tasks: state.tasks,
    }))
  );
}
```

---

## 5.5 Redux Toolkit - Khi Cần Middleware Phức Tạp

```tsx
import { configureStore, createSlice, createAsyncThunk } from "@reduxjs/toolkit";

// Async thunk
const fetchUsers = createAsyncThunk("users/fetch", async () => {
  const res = await fetch("/api/users");
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json() as Promise<User[]>;
});

// Slice
interface UsersState {
  list: User[];
  loading: boolean;
  error: string | null;
}

const usersSlice = createSlice({
  name: "users",
  initialState: { list: [], loading: false, error: null } as UsersState,
  reducers: {
    addUser: (state, action) => { state.list.push(action.payload); },
    removeUser: (state, action) => {
      state.list = state.list.filter((u) => u.id !== action.payload);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchUsers.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchUsers.fulfilled, (state, action) => {
        state.list = action.payload;
        state.loading = false;
      })
      .addCase(fetchUsers.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Unknown error";
      });
  },
});

const store = configureStore({
  reducer: { users: usersSlice.reducer },
});

// Dùng với React-Redux
function UserList() {
  const dispatch = useDispatch();
  const { list, loading, error } = useSelector((state) => state.users);
  useEffect(() => { dispatch(fetchUsers()); }, [dispatch]);
  // ...
}
```

---

## 5.6 Jotai - Atomic State

```tsx
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";

// Primitive atom
const userAtom = atom<User | null>(null);
const themeAtom = atom<"light" | "dark">("light");

// Derived atom (read-only)
const displayNameAtom = atom((get) => get(userAtom)?.name ?? "Guest");
const isDarkAtom = atom((get) => get(themeAtom) === "dark");

// Writable derived atom
const userGreetingAtom = atom(
  (get) => `Hello, ${get(userAtom)?.name ?? "Guest"}`,
  (get, set, newName: string) => {
    const user = get(userAtom);
    if (user) {
      set(userAtom, { ...user, name: newName });
    }
  }
);

// Async atom
const userDataAtom = atom(async () => {
  const res = await fetch("/api/user");
  return res.json() as Promise<User>;
});

// Dùng
function Header() {
  const [user, setUser] = useAtom(userAtom);
  const name = useAtomValue(displayNameAtom);  // read-only
  const isDark = useAtomValue(isDarkAtom);
  const setTheme = useSetAtom(themeAtom);       // write-only
  return <header className={isDark ? "dark" : "light"}>{name}</header>;
}
```

---

## 5.7 So Sánh Zustand vs Redux vs Jotai

| Tiêu chí | Zustand | Redux Toolkit | Jotai |
|:---|:---|:---|:---|
| Boilerplate | Ít nhất | Nhiều nhất | Ít |
| Provider | Không cần | Cần | Không cần |
| Selector | Built-in | react-redux | useAtomValue |
| Persist | Middleware |redux-persist | atom-with-storage |
| DevTools | Middleware | Redux DevTools | Jotai DevTools |
| Bundle size | ~1KB | ~11KB | ~3KB |
| Learning curve | Dễ | Trung bình | Dễ |
| Best for | General state | Complex middleware | Atomic state |

---

## 5.8 Bài tập

### Bài 1: Shopping Cart với Zustand
Tạo store shopping cart:
- `items: CartItem[]`
- `addItem(item, quantity)`
- `removeItem(id)`
- `updateQuantity(id, quantity)`
- `clearCart()`
- `total: number` (computed)
- Persist vào localStorage

### Bài 2: Undo/Redo với Redux Toolkit
Tạo Redux slice có undo/redo:
- `present: State`
- `past: State[]`
- `future: State[]`
- Actions: `undo`, `redo`, `set`

### Bài 3: Real-time Notifications với Jotai
Tạo notification system:
- Atom cho notifications list
- Atom cho unread count
- Atom cho filter (all/unread/read)
- Auto-dismiss sau 5s

> Sang Chương 6 để học Form & Validation.
