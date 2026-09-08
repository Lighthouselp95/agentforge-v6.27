# Chương 7: Data Fetching & Cache - TanStack Query v5

> "Fetch data đúng cách = app mượt. Fetch sai = app chết."

## 7.1 Vấn Đề Khi Fetch Raw

- Loading state lộn xộn
- Error handling mỗi nơi phải copy
- Không cache -> fetch lại mỗi navigate
- Race condition
- Không retry, không stale-while-revalidate

## 7.2 TanStack Query - Nền Tảng

### Query Cơ Bản

```tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Query
const { data, isLoading, error, isFetching } = useQuery({
  queryKey: ["users", userId],
  queryFn: () => fetch(`/api/users/${userId}`).then(r => r.json()),
  staleTime: 5 * 60 * 1000,  // 5 phút
  gcTime: 10 * 60 * 1000,    // 10 phút xóa khỏi cache
  retry: 2,
  retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
});

// Mutation
const mutation = useMutation({
  mutationFn: (newUser: User) => api.post("/api/users", newUser),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["users"] });
  },
});
```

### Query Dependencies

```tsx
const { data: user } = useQuery({
  queryKey: ["user", userId],
  queryFn: () => fetchUser(userId),
  enabled: !!userId,
});
```

### Paginated Query

```tsx
function PaginatedList() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["posts", page],
    queryFn: () => fetch(`/api/posts?page=${page}`).then(r => r.json()),
    keepPreviousData: true,
  });
  return <>{data?.items.map(p => <Post key={p.id} post={p} />)}</>;
}
```

### Infinite Query

```tsx
const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
  queryKey: ["messages"],
  queryFn: ({ pageParam = 0 }) => fetch(`/api/messages?cursor=${pageParam}`).then(r => r.json()),
  getNextPageParam: (lastPage) => lastPage.nextCursor,
});
const allMessages = data.pages.flatMap(p => p.items);
```

### Optimistic Update

```tsx
const mutation = useMutation({
  mutationFn: (newTask: Task) => api.post("/tasks", newTask),
  onMutate: async (newTask) => {
    await queryClient.cancelQueries({ queryKey: ["tasks"] });
    const prevTasks = queryClient.getQueryData<Task[]>(["tasks"]);
    queryClient.setQueryData(["tasks"], (old = []) => [newTask, ...old]);
    return { prevTasks };
  },
  onError: (err, newTask, context) => {
    queryClient.setQueryData(["tasks"], context?.prevTasks);
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  },
});
```

## 7.3 Bài tập

### Bài 1: Infinite Scroll
Tạo page load comments无限滚动, nút like optimistic.

### Bài 2: Search với debounce
Tạo search input debounce 300ms, fetch results, cache.

### Bài 3: Offline support
Tạo query work offline với cache.

> Sang Chương 8 để học Server Concepts.
