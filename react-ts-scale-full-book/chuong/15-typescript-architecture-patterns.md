# Chương 15: TypeScript Architecture Patterns

> "Code chạy được là 1 chuyện. Code giữ được mới là kiến trúc."

## 15.1 Design Patterns trong TypeScript

### Singleton Pattern

```ts
// Đảm bảo chỉ có 1 instance duy nhất
class Database {
  private static instance: Database;

  private constructor(private config: Config) {}

  static getInstance(config?: Config): Database {
    if (!Database.instance) {
      if (!config) throw new Error("Config required for first initialization");
      Database.instance = new Database(config);
    }
    return Database.instance;
  }

  async query(sql: string) {
    // ...
  }
}

// Dùng
const db = Database.getInstance({ host: "localhost", port: 5432 });
```

### Factory Pattern

```ts
// Tạo object mà không cần expose constructor logic
interface Notification {
  send(message: string): void;
}

class EmailNotification implements Notification {
  send(message: string) { console.log(`Email: ${message}`); }
}

class SMSNotification implements Notification {
  send(message: string) { console.log(`SMS: ${message}`); }
}

class PushNotification implements Notification {
  send(message: string) { console.log(`Push: ${message}`); }
}

class NotificationFactory {
  static create(type: "email" | "sms" | "push"): Notification {
    switch (type) {
      case "email": return new EmailNotification();
      case "sms": return new SMSNotification();
      case "push": return new PushNotification();
    }
  }
}

// Dùng
const notifier = NotificationFactory.create("email");
notifier.send("Hello!");
```

### Observer Pattern

```ts
// Pub/Sub event system
type EventCallback<T> = (data: T) => void;

class EventEmitter<Events extends Record<string, unknown>> {
  private listeners = new Map<string, Set<EventCallback<any>>>();

  on<K extends keyof Events>(event: K, callback: EventCallback<Events[K]>) {
    if (!this.listeners.has(event as string)) {
      this.listeners.set(event as string, new Set());
    }
    this.listeners.get(event as string)!.add(callback);
    return () => this.listeners.get(event as string)?.delete(callback);
  }

  emit<K extends keyof Events>(event: K, data: Events[K]) {
    this.listeners.get(event as string)?.forEach(cb => cb(data));
  }
}

// Dùng
type UserEvents = {
  login: { userId: string; timestamp: number };
  logout: { userId: string };
};

const emitter = new EventEmitter<UserEvents>();
const unsub = emitter.on("login", (data) => {
  console.log(data.userId);  // type-safe
});
```

### Strategy Pattern

```ts
// Thuật toán có thể thay đổi runtime
interface SortStrategy<T> {
  sort(items: T[], compareFn: (a: T, b: T) => number): T[];
}

class BubbleSort<T> implements SortStrategy<T> {
  sort(items: T[], compareFn: (a: T, b: T) => number): T[] {
    const arr = [...items];
    for (let i = 0; i < arr.length; i++) {
      for (let j = 0; j < arr.length - i - 1; j++) {
        if (compareFn(arr[j], arr[j + 1]) > 0) {
          [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
        }
      }
    }
    return arr;
  }
}

class QuickSort<T> implements SortStrategy<T> {
  sort(items: T[], compareFn: (a: T, b: T) => number): T[] {
    if (items.length <= 1) return items;
    const pivot = items[0];
    const left = items.slice(1).filter(x => compareFn(x, pivot) <= 0);
    const right = items.slice(1).filter(x => compareFn(x, pivot) > 0);
    return [...this.sort(left, compareFn), pivot, ...this.sort(right, compareFn)];
  }
}

class Sorter<T> {
  constructor(private strategy: SortStrategy<T>) {}

  setStrategy(strategy: SortStrategy<T>) {
    this.strategy = strategy;
  }

  sort(items: T[], compareFn: (a: T, b: T) => number): T[] {
    return this.strategy.sort(items, compareFn);
  }
}

// Dùng
const sorter = new Sorter(new QuickSort());
sorter.setStrategy(new BubbleSort());  // thay đổi runtime
```

### Decorator Pattern

```ts
// TypeScript decorator (experimental)
function Log(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const original = descriptor.value;
  descriptor.value = function (...args: any[]) {
    console.log(`Calling ${propertyKey} with`, args);
    const result = original.apply(this, args);
    console.log(`Result:`, result);
    return result;
  };
}

function Validate(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const original = descriptor.value;
  descriptor.value = function (name: string) {
    if (name.length < 2) throw new Error("Name must be at least 2 characters");
    return original.apply(this, [name]);
  };
}

class UserService {
  @Log
  @Validate
  createUser(name: string) {
    return { id: "1", name };
  }
}
```

### Builder Pattern

```ts
// Tạo object phức tạp step by step
class QueryBuilder<T> {
  private conditions: string[] = [];
  private orderByField?: string;
  private orderDirection: "asc" | "desc" = "asc";
  private limitValue?: number;
  private offsetValue?: number;

  where(field: keyof T, operator: string, value: any): this {
    this.conditions.push(`${String(field)} ${operator} '${value}'`);
    return this;
  }

  orderBy(field: keyof T, direction: "asc" | "desc" = "asc"): this {
    this.orderByField = String(field);
    this.orderDirection = direction;
    return this;
  }

  limit(n: number): this {
    this.limitValue = n;
    return this;
  }

  offset(n: number): this {
    this.offsetValue = n;
    return this;
  }

  build(): string {
    let sql = "SELECT * FROM users";
    if (this.conditions.length) {
      sql += ` WHERE ${this.conditions.join(" AND ")}`;
    }
    if (this.orderByField) {
      sql += ` ORDER BY ${this.orderByField} ${this.orderDirection}`;
    }
    if (this.limitValue) sql += ` LIMIT ${this.limitValue}`;
    if (this.offsetValue) sql += ` OFFSET ${this.offsetValue}`;
    return sql;
  }
}

// Dùng
const query = new QueryBuilder<User>()
  .where("age", ">", 18)
  .where("status", "=", "active")
  .orderBy("name", "asc")
  .limit(10)
  .build();
```

---

## 15.2 Clean Architecture

```
┌─────────────────────────────────────────────┐
│              Frameworks & Drivers            │
│  (Express, React, Prisma, Redis)            │
├─────────────────────────────────────────────┤
│              Interface Adapters              │
│  (Controllers, Presenters, Gateways)        │
├─────────────────────────────────────────────┤
│              Application Business Rules      │
│  (Use Cases, Interactors)                   │
├─────────────────────────────────────────────┤
│              Enterprise Business Rules       │
│  (Entities, Domain Models)                  │
└─────────────────────────────────────────────┘
```

### Folder Structure

```
src/
├── domain/                  # Enterprise business rules
│   ├── entities/
│   │   └── User.ts
│   ├── value-objects/
│   │   ├── Email.ts
│   │   └── Password.ts
│   └── errors/
│       └── DomainError.ts
├── application/             # Application business rules
│   ├── use-cases/
│   │   ├── CreateUser.ts
│   │   ├── GetUser.ts
│   │   └── UpdateUser.ts
│   ├── dto/
│   │   ├── CreateUserDTO.ts
│   │   └── UserResponseDTO.ts
│   └── interfaces/
│       ├── UserRepository.ts
│       └── EmailService.ts
├── infrastructure/          # Frameworks & Drivers
│   ├── database/
│   │   └── prisma/
│   │       └── PrismaUserRepository.ts
│   ├── email/
│   │   └── SMTPEmailService.ts
│   └── cache/
│       └── RedisCacheService.ts
├── presentation/            # Interface Adapters
│   ├── controllers/
│   │   └── UserController.ts
│   ├── presenters/
│   │   └── UserPresenter.ts
│   └── routes/
│       └── userRoutes.ts
└── shared/
    ├── types/
    └── utils/
```

### Entity (Domain Layer)

```ts
// domain/entities/User.ts
import { Email } from "../value-objects/Email";
import { Password } from "../value-objects/Password";

export class User {
  private constructor(
    public readonly id: string,
    public readonly email: Email,
    private _name: string,
    private _password: Password,
    public readonly createdAt: Date
  ) {}

  static create(props: { id: string; email: string; name: string; password: string }): User {
    return new User(
      props.id,
      new Email(props.email),
      props.name,
      Password.create(props.password),
      new Date()
    );
  }

  get name(): string { return this._name; }
  set name(value: string) {
    if (value.length < 2) throw new Error("Name too short");
    this._name = value;
  }

  changePassword(newPassword: string) {
    this._password = Password.create(newPassword);
  }

  verifyPassword(password: string): boolean {
    return this._password.verify(password);
  }
}
```

### Use Case (Application Layer)

```ts
// application/use-cases/CreateUser.ts
import { User } from "../../domain/entities/User";
import { UserRepository } from "../interfaces/UserRepository";
import { EmailService } from "../interfaces/EmailService";
import { CreateUserDTO } from "../dto/CreateUserDTO";
import { UserResponseDTO } from "../dto/UserResponseDTO";

export class CreateUser {
  constructor(
    private userRepo: UserRepository,
    private emailService: EmailService
  ) {}

  async execute(dto: CreateUserDTO): Promise<UserResponseDTO> {
    // Check if email exists
    const existing = await this.userRepo.findByEmail(dto.email);
    if (existing) throw new Error("Email already exists");

    // Create user
    const user = User.create({
      id: crypto.randomUUID(),
      email: dto.email,
      name: dto.name,
      password: dto.password,
    });

    // Save
    await this.userRepo.save(user);

    // Send welcome email
    await this.emailService.sendWelcome(user.email.value, user.name);

    // Return DTO
    return {
      id: user.id,
      email: user.email.value,
      name: user.name,
      createdAt: user.createdAt,
    };
  }
}
```

### Repository Interface (Application Layer)

```ts
// application/interfaces/UserRepository.ts
import { User } from "../../domain/entities/User";

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<void>;
  delete(id: string): Promise<void>;
}
```

### Repository Implementation (Infrastructure Layer)

```ts
// infrastructure/database/prisma/PrismaUserRepository.ts
import { PrismaClient } from "@prisma/client";
import { UserRepository } from "../../../application/interfaces/UserRepository";
import { User } from "../../../domain/entities/User";

export class PrismaUserRepository implements UserRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    const data = await this.prisma.user.findUnique({ where: { id } });
    if (!data) return null;
    return User.create({
      id: data.id,
      email: data.email,
      name: data.name,
      password: data.passwordHash,  //注意:需要处理hash
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    const data = await this.prisma.user.findUnique({ where: { email } });
    if (!data) return null;
    return User.create({
      id: data.id,
      email: data.email,
      name: data.name,
      password: data.passwordHash,
    });
  }

  async save(user: User): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email.value,
        name: user.name,
        passwordHash: "hashed",  //实际应用中需要hash
      },
      update: {
        name: user.name,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
  }
}
```

### Controller (Presentation Layer)

```ts
// presentation/controllers/UserController.ts
import { Request, Response } from "express";
import { CreateUser } from "../../application/use-cases/CreateUser";
import { GetUser } from "../../application/use-cases/GetUser";

export class UserController {
  constructor(
    private createUser: CreateUser,
    private getUser: GetUser
  ) {}

  async create(req: Request, res: Response) {
    try {
      const user = await this.createUser.execute(req.body);
      res.status(201).json(user);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async get(req: Request, res: Response) {
    const user = await this.getUser.execute(req.params.id);
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json(user);
  }
}
```

---

## 15.3 Domain-Driven Design (DDD)

### Building Blocks

```ts
// Value Object - không có identity, so sánh bằng value
class Money {
  private constructor(
    public readonly amount: number,
    public readonly currency: string
  ) {}

  static create(amount: number, currency: string): Money {
    if (amount < 0) throw new Error("Amount cannot be negative");
    return new Money(amount, currency);
  }

  add(other: Money): Money {
    if (this.currency !== other.currency) throw new Error("Currency mismatch");
    return new Money(this.amount + other.amount, this.currency);
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }
}

// Entity - có identity, so sánh bằng id
class Order {
  constructor(
    public readonly id: string,
    public readonly customerId: string,
    private _items: OrderItem[],
    public readonly status: OrderStatus
  ) {}

  get total(): Money {
    return this._items.reduce(
      (sum, item) => sum.add(item.subtotal),
      Money.create(0, "USD")
    );
  }

  addItem(product: Product, quantity: number) {
    if (this.status !== "pending") throw new Error("Cannot modify confirmed order");
    this._items.push(new OrderItem(product, quantity));
  }

  confirm() {
    if (this._items.length === 0) throw new Error("Cannot confirm empty order");
    this.status = "confirmed";
  }
}

// Aggregate Root - chỉ root entity có thể thay đổi aggregate
class OrderAggregate {
  private order: Order;
  private events: DomainEvent[] = [];

  addItem(product: Product, quantity: number) {
    this.order.addItem(product, quantity);
    this.events.push(new ItemAddedEvent(this.order.id, product.id));
  }

  confirm() {
    this.order.confirm();
    this.events.push(new OrderConfirmedEvent(this.order.id));
  }

  getDomainEvents(): DomainEvent[] {
    return this.events;
  }
}

// Domain Event
interface DomainEvent {
  type: string;
  timestamp: Date;
  payload: unknown;
}

class OrderConfirmedEvent implements DomainEvent {
  type = "ORDER_CONFIRMED";
  timestamp = new Date();
  constructor(public readonly orderId: string) {}
}

// Repository (Interface in Domain)
interface OrderRepository {
  findById(id: string): Promise<Order | null>;
  save(order: Order): Promise<void>;
}

// Domain Service
class PricingService {
  calculateDiscount(order: Order, customer: Customer): Money {
    if (customer.isVIP) {
      return order.total.amount * 0.1;  // 10% discount
    }
    return Money.create(0, "USD");
  }
}
```

---

## 15.4 CQRS (Command Query Responsibility Segregation)

```ts
// Commands (Write)
interface CreateUserCommand {
  name: string;
  email: string;
  password: string;
}

class CreateUserHandler {
  constructor(private userRepo: UserRepository) {}

  async handle(command: CreateUserCommand): Promise<string> {
    const user = User.create(command);
    await this.userRepo.save(user);
    return user.id;
  }
}

// Queries (Read)
interface GetUserQuery {
  id: string;
}

class GetUserHandler {
  constructor(private userReadRepo: UserReadRepository) {}

  async handle(query: GetUserQuery): Promise<UserView | null> {
    return this.userReadRepo.findById(query.id);
  }
}

// Separate Read Model
interface UserReadRepository {
  findById(id: string): Promise<UserView | null>;
  findAll(): Promise<UserView[]>;
}

class UserView {
  constructor(
    public id: string,
    public name: string,
    public email: string,
    public orderCount: number,
    public totalSpent: number
  ) {}
}
```

---

## 15.5 State Machines avec XState

```ts
import { createMachine, assign } from "xstate";

// Traffic Light Machine
const trafficLightMachine = createMachine({
  id: "trafficLight",
  initial: "green",
  context: { count: 0 },
  states: {
    green: {
      on: { TIMER: "yellow" },
      entry: assign({ count: (ctx) => ctx.count + 1 }),
    },
    yellow: {
      on: { TIMER: "red" },
    },
    red: {
      on: { TIMER: "green" },
    },
  },
});

// Dùng
const actor = interpret(trafficLightMachine);
actor.start();
actor.send({ type: "TIMER" });  // green -> yellow

// Complex: Order Machine
const orderMachine = createMachine({
  id: "order",
  initial: "pending",
  context: {
    orderId: "",
    items: [],
    total: 0,
  },
  states: {
    pending: {
      on: {
        SUBMIT: { target: "processing", guard: "hasItems" },
        CANCEL: "cancelled",
      },
    },
    processing: {
      invoke: {
        src: "processPayment",
        onDone: "confirmed",
        onError: "failed",
      },
    },
    confirmed: {
      on: {
        SHIP: "shipped",
      },
    },
    shipped: {
      on: {
        DELIVER: "delivered",
      },
    },
    delivered: { type: "final" },
    failed: {
      on: {
        RETRY: "processing",
        CANCEL: "cancelled",
      },
    },
    cancelled: { type: "final" },
  },
}, {
  guards: {
    hasItems: (ctx) => ctx.items.length > 0,
  },
  services: {
    processPayment: async (ctx) => {
      // Call payment API
    },
  },
});
```

---

## 15.6 Dependency Injection

```ts
// Simple DI Container
class Container {
  private services = new Map<string, any>();
  private factories = new Map<string, () => any>();

  register<T>(name: string, factory: () => T) {
    this.factories.set(name, factory);
  }

  resolve<T>(name: string): T {
    if (!this.services.has(name)) {
      const factory = this.factories.get(name);
      if (!factory) throw new Error(`Service ${name} not registered`);
      this.services.set(name, factory());
    }
    return this.services.get(name);
  }
}

// Dùng
const container = new Container();

container.register("userRepository", () => new PrismaUserRepository(prisma));
container.register("emailService", () => new SMTPEmailService(smtpConfig));
container.register("createUser", () => new CreateUser(
  container.resolve("userRepository"),
  container.resolve("emailService")
));

// Resolver
const createUser = container.resolve<CreateUser>("createUser");
```

---

## 15.7 Event-Driven Architecture

```ts
// Event Bus
class EventBus {
  private handlers = new Map<string, Set<(event: any) => Promise<void>>>();

  on(event: string, handler: (event: any) => Promise<void>) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  async emit(event: string, data: unknown) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      await Promise.all([...handlers].map(h => h(data)));
    }
  }
}

// Event Handlers
const eventBus = new EventBus();

eventBus.on("user.created", async (event) => {
  await sendWelcomeEmail(event.email);
});

eventBus.on("user.created", async (event) => {
  await createDefaultWorkspace(event.userId);
});

// Emit
await eventBus.emit("user.created", { userId: "123", email: "test@example.com" });
```

---

## 15.8 Micro-Frontend Architecture

```ts
// Module Federation (Webpack 5)
// webpack.config.js
module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: "host",
      remotes: {
        dashboard: "dashboard@http://localhost:3001/remoteEntry.js",
        admin: "admin@http://localhost:3002/remoteEntry.js",
      },
      shared: { react: { singleton: true }, "react-dom": { singleton: true } },
    }),
  ],
};

// Dùng trong Host
const Dashboard = React.lazy(() => import("dashboard/App"));

function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Dashboard />
    </Suspense>
  );
}
```

---

## 15.9 Bài tập

### Bài 1: Clean Architecture
Tạo app với Clean Architecture: Domain, Application, Infrastructure, Presentation layers.

### Bài 2: DDD Aggregate
Tạo Order Aggregate với Value Objects, Entities, Domain Events.

### Bài 3: State Machine
Tạo checkout flow với XState: Cart → Shipping → Payment → Confirmation.

### Bài 4: Event-Driven
Tạo EventBus với typed events, handlers, error handling.

> Sang Chương 16 để học Database ORM & Real-time.
