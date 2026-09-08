# Chương 7: Data Fetching & Cache - TanStack Query v5

### 7.1 Vấn đề khi fetch raw

- Loading state lộn xộn khắp component
- Error handling mỗi nơi phải copy
- Không cache -> mỗi navigate lại fetch lại
- Race condition khi nhanh chuyển trang
- Không retry, không stale-while-revalidate

### 7.2 TanStack Query - Nền Tảng

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Query - fetch data với cache
const { data, isLoading, error, isFetching } = useQuery({
  queryKey: ['users', userId],  // cache key duy nhất
  queryFn: () => fetch(`/api/users/${userId}`).then(r => r.json()),
  staleTime: 5 * 60 * 1000,     // 5 phút không fetch lại
  gcTime: 10 * 60 * 1000,       // 10 phút xóa khỏi cache khi không dùng
  retry: 2,                      // retry 2 lần khi fail
  retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),  // exponential backoff
});

// Mutation - POST/PUT/DELETE
const mutation = useMutation({
  mutationFn: (newUser: User) => api.post('/api/users', newUser),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['users'] });  // cập nhật cache
  },
});
```

### 7.3 Query Dependencies & Parallel

```tsx
// Query phụ thuộc - chỉ fetch user khi userId có
const { data: user } = useQuery({
  queryKey: ['user', userId],
  queryFn: () => fetchUser(userId),
  enabled: !!userId,  // chỉ chạy khi userId truthy
});

// Parallel queries - fetch nhiều nơi cùng lúc
const { data: posts } = useQuery({ queryKey: ['posts'], queryFn: fetchPosts });
const { data: comments } = useQuery({ queryKey: ['comments'], queryFn: fetchComments });
```

### 7.4 Paginated Query

```tsx
function PaginatedList() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['posts', page],
    queryFn: () => fetch(`/api/posts?page=${page}&limit=20`).then(r => r.json()),
    keepPreviousData: true,  // giữ data cũ khi page đổi (tránh flash)
  });
  return <>{data?.items.map(p => <Post key={p.id} post={p} />)}</>;
}
```

### 7.5 Infinite Query - Scroll Load More

```tsx
import { useInfiniteQuery } from '@tanstack/react-query';

const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
  queryKey: ['messages'],
  queryFn: ({ pageParam = 0 }) => fetch(`/api/messages?cursor=${pageParam}`).then(r => r.json()),
  getNextPageParam: (lastPage) => lastPage.nextCursor,
});

// Render
const allMessages = data.pages.flatMap(p => p.items);
return (
  <>
    {allMessages.map(m => <Message key={m.id} msg={m} />)}
    <button onClick={() => fetchNextPage()} disabled={!hasNextPage || isFetchingNextPage}>
      {isFetchingNextPage ? 'Loading...' : 'Load More'}
    </button>
  </>
);
```

### 7.6 Optimistic Update - UX Mượt

```tsx
const mutation = useMutation({
  mutationFn: (newTask: Task) => api.post('/tasks', newTask),
  onMutate: async (newTask) => {
    // 1. Cancel previous queries
    await queryClient.cancelQueries({ queryKey: ['tasks'] });
    // 2. Snapshot cũ
    const prevTasks = queryClient.getQueryData<Task[]>(['tasks']);
    // 3. Optimistic update
    queryClient.setQueryData(['tasks'], (old = []) => [newTask, ...old]);
    // 4. Return context cho onError
    return { prevTasks };
  },
  onError: (err, newTask, context) => {
    // Rollback nếu fail
    queryClient.setQueryData(['tasks'], context?.prevTasks);
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });  // sync server
  },
});
```

### 7.7 Dependent Queries

```tsx
function UserTasks({ userId }) {
  const { data: user } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => fetchUser(userId),
    enabled: !!userId,
  });
  const { data: tasks } = useQuery({
    queryKey: ['tasks', userId],
    queryFn: () => fetchTasks(userId),
    enabled: !!user,  // chỉ chạy sau khi user có data
  });
  return <TasksList tasks={tasks} />;
}
```

### 7.8 Bài tập
Tạo page với Infinite Query load comments, mỗi comment có nút like dùng optimistic update.

> Sang Chương 8 để học Server App Concepts.
