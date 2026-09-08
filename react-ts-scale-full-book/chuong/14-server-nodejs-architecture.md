# Chương 14: Server-Side Node.js Architecture

> "Frontend đẹp mà backend yếu thì app cũng chết."

## 14.1 Tại Sao Cần Hiểu Server-Side?

- React/Next.js chạy trên client hoặc Edge
- Business logic phức tạp cần server riêng
- Microservices cần backend独立
- Background jobs cần server xử lý

## 14.2 So Sánh Server Frameworks

| Framework | Type | Best For | Learning Curve |
|:---|:---|:---|:---|
| Express | Minimal | Small API, prototypes | Dễ |
| Fastify | Fast | High-performance API | Trung bình |
| NestJS | Enterprise |大型 app, microservices | Khó |
| tRPC | Type-safe | Full-stack TypeScript | Dễ |
| Hono | Edge | Cloudflare Workers, Edge | Dễ |
| AdonisJS | Full-stack | Laravel-like experience | Trung bình |

## 14.3 Express.js - Cơ Bản

```ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const app = express();

// Middleware
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json({ limit: "10mb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/users", async (req, res) => {
  const users = await db.user.findMany();
  res.json(users);
});

app.post("/api/users", async (req, res) => {
  const { name, email } = req.body;
  const user = await db.user.create({ data: { name, email } });
  res.status(201).json(user);
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

app.listen(3001, () => console.log("Server running on port 3001"));
```

### Express Router

```ts
// routes/users.ts
import { Router } from "express";
const router = Router();

router.get("/", async (req, res) => {
  const users = await db.user.findMany();
  res.json(users);
});

router.get("/:id", async (req, res) => {
  const user = await db.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json(user);
});

router.put("/:id", async (req, res) => {
  const user = await db.user.update({
    where: { id: req.params.id },
    data: req.body,
  });
  res.json(user);
});

router.delete("/:id", async (req, res) => {
  await db.user.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// app.ts
app.use("/api/users", router);
```

## 14.4 Fastify -高性能

```ts
import Fastify from "fastify";

const app = Fastify({ logger: true });

// Schema validation (built-in)
app.get("/api/users", {
  schema: {
    response: {
      200: {
        type: "array",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          email: { type: "string" },
        },
      },
    },
  },
  handler: async () => {
    return db.user.findMany();
  },
});

// Plugin system
async function userPlugin(fastify: FastifyInstance) {
  fastify.get("/", async () => db.user.findMany());
  fastify.get("/:id", async (req) => {
    return db.user.findUnique({ where: { id: req.params.id } });
  });
}

app.register(userPlugin, { prefix: "/api/users" });
```

## 14.5 NestJS - Enterprise

```ts
// users/users.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, NotFoundException } from "@nestjs/common";
import { UsersService } from "./users.service";

@Controller("api/users")
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  async findAll() {
    return this.usersService.findAll();
  }

  @Get(":id")
  async findOne(@Param("id") id: string) {
    const user = await this.usersService.findOne(id);
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  @Post()
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }
}

// users/users.service.ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany();
  }

  async findOne(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async create(data: CreateUserDto) {
    return this.prisma.user.create({ data });
  }
}

// users/users.module.ts
import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
```

## 14.6 tRPC - Type-Safe API

```ts
// server/trpc.ts
import { initTRPC } from "@trpc/server";
const t = initTRPC.context<Context>().create();

// routers/users.ts
import { z } from "zod";

export const userRouter = t.router({
  getAll: t.procedure.query(async ({ ctx }) => {
    return ctx.db.user.findMany();
  }),

  getById: t.procedure.input(z.string()).query(async ({ input, ctx }) => {
    return ctx.db.user.findUnique({ where: { id: input } });
  }),

  create: t.procedure
    .input(z.object({ name: z.string(), email: z.string().email() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.db.user.create({ data: input });
    }),
});

// Client-side (Next.js)
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../server/routers/_app";

export const trpc = createTRPCReact<AppRouter>();

// Dùng trong component
function UserList() {
  const { data: users, isLoading } = trpc.user.getAll.useQuery();
  if (isLoading) return <Spinner />;
  return users?.map(u => <div key={u.id}>{u.name}</div>);
}
```

## 14.7 Hono - Edge Runtime

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { jwt } from "hono/jwt";

const app = new Hono();

app.use("/*", cors());
app.use("/api/*", jwt({ secret: process.env.JWT_SECRET }));

app.get("/api/users", async (c) => {
  const users = await db.user.findMany();
  return c.json(users);
});

export default app;  // Cloudflare Workers / Deno / Bun
```

## 14.8 Middleware Pattern

```ts
// Middleware chain
function logger(req: Request, res: Response, next: NextFunction) {
  console.log(`${req.method} ${req.url}`);
  next();
}

function auth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// Route với middleware
app.get("/api/profile", auth, (req, res) => {
  res.json(req.user);
});
```

## 14.9 Error Handling Pattern

```ts
// Custom error classes
class AppError extends Error {
  constructor(message: string, public statusCode: number, public code: string) {
    super(message);
  }
}

class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, "NOT_FOUND");
  }
}

class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

// Global error handler
function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}
```

## 14.10 Bài tập

### Bài 1: Express CRUD API
Tạo REST API với Express: CRUD users, validation, error handling, rate limiting.

### Bài 2: tRPC + Next.js
Tạo full-stack app với tRPC: type-safe API từ server đến client.

### Bài 3: NestJS Module
Tạo NestJS app với Users module, Auth module, Prisma service.

> Sang Chương 15 để học API Design & Authentication.
