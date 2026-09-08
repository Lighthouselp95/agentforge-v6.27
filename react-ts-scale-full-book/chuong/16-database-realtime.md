# Chương 16: Database ORM & Real-time

> "Database sai = app chết. Real-time sai = user bỏ đi."

## 16.1 ORM - Tại Sao Cần?

- Type-safe database queries
- Migration system
-避免 SQL injection
- Easy relationship handling

## 16.2 Prisma - ORM Tiêu Chuẩn 2024

### Schema

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String
  posts     Post[]
  profile   Profile?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("users")
}

model Post {
  id        String   @id @default(cuid())
  title     String
  content   String?
  published Boolean  @default(false)
  author    User     @relation(fields: [authorId], references: [id])
  authorId  String
  tags      Tag[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([authorId])
  @@map("posts")
}

model Tag {
  id    String @id @default(cuid())
  name  String @unique
  posts Post[]

  @@map("tags")
}

model Profile {
  id     String  @id @default(cuid())
  bio    String?
  user   User    @relation(fields: [userId], references: [id])
  userId String  @unique

  @@map("profiles")
}
```

### CRUD Operations

```ts
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// Create
const user = await prisma.user.create({
  data: {
    email: "test@example.com",
    name: "Hai",
    profile: { create: { bio: "Developer" } },
  },
  include: { profile: true },
});

// Read
const users = await prisma.user.findMany({
  where: {
    posts: { some: { published: true } },
  },
  include: {
    posts: { where: { published: true }, take: 5 },
  },
  orderBy: { createdAt: "desc" },
  take: 10,
});

// Update
const updated = await prisma.user.update({
  where: { id: user.id },
  data: { name: "Updated Name" },
});

// Delete
await prisma.user.delete({ where: { id: user.id } });

// Transaction
const [newUser, newPost] = await prisma.$transaction([
  prisma.user.create({ data: { email: "a@test.com", name: "A" } }),
  prisma.post.create({ data: { title: "First Post", authorId: "user-id" } }),
]);

// Raw query
const result = await prisma.$queryRaw`
  SELECT u.name, COUNT(p.id) as post_count
  FROM users u
  LEFT JOIN posts p ON p.author_id = u.id
  GROUP BY u.id
`;
```

### Prisma with tRPC

```ts
// routers/user.ts
import { z } from "zod";
import { router, publicProcedure } from "../trpc";

export const userRouter = router({
  getAll: publicProcedure.query(async ({ ctx }) => {
    return ctx.prisma.user.findMany({
      include: { profile: true, _count: { select: { posts: true } } },
    });
  }),

  getById: publicProcedure.input(z.string()).query(async ({ input, ctx }) => {
    return ctx.prisma.user.findUnique({
      where: { id: input },
      include: { posts: true, profile: true },
    });
  }),

  create: publicProcedure
    .input(z.object({ email: z.string().email(), name: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.prisma.user.create({ data: input });
    }),
});
```

---

## 16.3 Drizzle ORM - Lightweight Alternative

```ts
// schema.ts
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

// query
import { drizzle } from "drizzle-orm/node-postgres";

const db = drizzle(pool);

const result = await db.select().from(users).where(eq(users.email, "test@example.com"));
```

---

## 16.4 Real-time với WebSocket

```ts
// Server (ws)
import { WebSocketServer, WebSocket } from "ws";

const wss = new WebSocketServer({ port: 8080 });

interface Message {
  type: "join" | "message" | "leave";
  room: string;
  payload: unknown;
}

const rooms = new Map<string, Set<WebSocket>>();

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    const msg: Message = JSON.parse(data.toString());

    switch (msg.type) {
      case "join":
        if (!rooms.has(msg.room)) rooms.set(msg.room, new Set());
        rooms.get(msg.room)!.add(ws);
        break;

      case "message":
        rooms.get(msg.room)?.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(msg.payload));
          }
        });
        break;

      case "leave":
        rooms.get(msg.room)?.delete(ws);
        break;
    }
  });

  ws.on("close", () => {
    rooms.forEach((clients) => clients.delete(ws));
  });
});
```

### Client-side WebSocket

```ts
// hooks/useWebSocket.ts
function useWebSocket(url: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      setMessages(prev => [...prev, msg]);
    };

    ws.onclose = () => {
      // Reconnect after 3s
      setTimeout(() => new WebSocket(url), 3000);
    };

    return () => ws.close();
  }, [url]);

  const send = useCallback((msg: Message) => {
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  return { messages, send };
}
```

---

## 16.5 Server-Sent Events (SSE)

```ts
// Server
app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sendEvent = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send initial data
  sendEvent({ type: "connected" });

  // Listen for database changes
  const unsubscribe = db.$on("update", (event) => {
    sendEvent({ type: "update", table: event.table, data: event.data });
  });

  req.on("close", () => unsubscribe());
});

// Client
function useSSE(url: string) {
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    const source = new EventSource(url);
    source.onmessage = (event) => {
      setEvents(prev => [...prev, JSON.parse(event.data)]);
    };
    return () => source.close();
  }, [url]);

  return events;
}
```

---

## 16.6 Caching Strategy

```ts
// Redis cache layer
import { Redis } from "ioredis";

const redis = new Redis();

async function getCached<T>(key: string, fetcher: () => Promise<T>, ttl = 3600): Promise<T> {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const data = await fetcher();
  await redis.setex(key, ttl, JSON.stringify(data));
  return data;
}

// Dùng
const users = await getCached("users:all", () => db.user.findMany(), 300);
```

---

## 16.7 Bài tập

### Bài 1: Prisma CRUD
Tạo API CRUD với Prisma, includes, transactions.

### Bài 2: WebSocket Chat
Tạo real-time chat với WebSocket, rooms, typing indicator.

### Bài 3: SSE Dashboard
Tạo live dashboard với SSE, charts update real-time.

> Sang Chương 17 để học Microservices & Integration.
