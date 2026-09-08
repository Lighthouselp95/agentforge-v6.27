# Chương 5: State Management Toàn Diện

### 5.1 Quy tắc chọn state manager

```
Is state used only in one component? -> useState/useReducer
Is state shared by many components at different levels? -> Context (simple) or Zustand/Jotai
Is state complex with async, middleware, devtools? -> Redux Toolkit
Is state need persistent + sync across tabs? -> Zustand (persist middleware)
```

### 5.2 useState & useReducer - Nền Tảng

```tsx
// useState với object - phải spread để update
const [user, setUser] = useState<User>({ name: 'Hai', age: 25 });
setUser(prev => ({ ...prev, age: prev.age + 1 }));

// useReducer phức tạp hơn
type State = { items: Item[]; filter: string };
type Action = { type: 'ADD'; item: Item } | { type: 'FILTER'; filter: string };
const [state, dispatch] = useReducer(reducer, { items: [], filter: '' });
```

### 5.3 Context - Khi Nào Dùng?

```tsx
// Dùng Context cho global state đơn giản (theme, auth)
// Lỗi: dùng Context cho state hay thay đổi (gây re-render mọi con)
const AuthContext = createContext<AuthState | null>(null);
function App() {
  const [user, setUser] = useState<User | null>(null);
  return <AuthContext.Provider value={{ user, setUser }}><Router /></AuthContext.Provider>;
}
```

**Quy tắc:** Không đặt state hay state gây re-render thường xuyên vào Context. Chỉ đặt giá trị tĩnh hoặc ít thay đổi.

### 5.4 Zustand - State Manager Hiện Đại (Khuyên dùng)

```tsx
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  user: User | null;
  token: string | null;
  login: (credentials: Credentials) => Promise<void>;
  logout: () => void;
}

const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      login: async (creds) => {
        const { user, token } = await api.login(creds);
        set({ user, token });  // chỉ re-render component dùng user/token
      },
      logout: () => set({ user: null, token: null }),
    }),
    { name: 'auth-storage' }  // persist vào localStorage
  )
);

// Dùng - chỉ subscribe field mình cần (tránh re-render thừa)
function Profile() {
  const user = useAuthStore(state => state.user);  // re-render chỉ khi user thay đổi
  const login = useAuthStore(state => state.login);
  return <button onClick={() => login({ email, password })}>Login</button>;
}
```

**Ưu điểm Zustand:**
- Không Provider wrapper (gọn hơn Context)
- Selectors - chỉ re-render khi field cần thiết thay đổi
- Middleware: persist, devtools, immer
- Lightweight (~1KB)

### 5.5 Redux Toolkit - Khi Cần Middleware Phức Tạp

```tsx
import { configureStore, createSlice, createAsyncThunk } from '@reduxjs/toolkit';

// Async thunk
const fetchUsers = createAsyncThunk('users/fetch', async () => {
  const res = await fetch('/api/users');
  return res.json();
});

// Slice
const usersSlice = createSlice({
  name: 'users',
  initialState: { list: []; loading: false; error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchUsers.pending, (state) => { state.loading = true; })
      .addCase(fetchUsers.fulfilled, (state, action) => {
        state.list = action.payload;
        state.loading = false;
      });
  },
});

const store = configureStore({ reducer: { users: usersSlice.reducer } });
```

### 5.6 Jotai - Atomic State (Alternative nhẹ)

```tsx
import { atom, useAtom } from 'jotai';

const userAtom = atom<User | null>(null);
const displayNameAtom = atom((get) => get(userAtom)?.name ?? 'Guest');

function Header() {
  const [user, setUser] = useAtom(userAtom);
  const name = useAtomValue(displayNameAtom);  // derived
  return <header>{name}</header>;
}
```

### 5.7 So sánh Zustand vs Redux vs Jotai

| Tiêu chí | Zustand | Redux Toolkit | Jotai |
|:---|:---|:---|:---|
| Boilerplate | Ít | Nhiều | Ít |
| Middleware | Có (persist, immer) | Rất nhiều | Có |
| DevTools | Có | Có | Có |
| Persist | Có sẵn | Cần custom | Có (atom-with-storage) |
| Performance | Tốt (selector) | Tốt (React-Redux) | Tốt (atomic) |
| Học dễ | ★★★★ | ★★ | ★★★★ |

### 5.8 Bài tập
Chọn 1 state manager cho app sau: 10 features, cần auth persist, cần undo/redo. Giải thích lựa chọn.

> Sang Chương 6 để học Form & Validation.
