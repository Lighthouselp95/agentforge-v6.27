# Chương 17: Microservices & Integration

> "Monolith dễ code, microservices dễ scale. Biết chọn lúc nào."

## 17.1 Monolith vs Microservices

| Tiêu chí | Monolith | Microservices |
|:---|:---|:---|
| Development | Nhanh đầu tiên | Chậm đầu tiên |
| Deployment | Đơn giản | Phức tạp |
| Scaling | Scale toàn bộ | Scale từng service |
| Debug | Dễ | Khó (distributed) |
| Team | Nhóm nhỏ | Nhóm lớn |

**Rule:** Bắt đầu với monolith. Tách khi cần.

## 17.2 Message Queue với RabbitMQ

```ts
// Publisher
import amqplib from "amqplib";

const conn = await amqplib.connect("amqp://localhost");
const channel = await conn.createChannel();

await channel.assertQueue("order.created", { durable: true });

channel.sendToQueue("order.created", Buffer.from(JSON.stringify({
  orderId: "123",
  userId: "user-1",
  total: 99.99,
})), { persistent: true });

// Consumer
channel.consume("order.created", async (msg) => {
  const data = JSON.parse(msg.content.toString());
  await processOrder(data);
  channel.ack(msg);
});
```

### Event-Driven với Message Queue

```ts
// Order Service
class OrderService {
  async createOrder(data: CreateOrderDTO) {
    const order = await this.orderRepo.create(data);
    await this.eventBus.publish("order.created", {
      orderId: order.id,
      items: order.items,
    });
    return order;
  }
}

// Email Service (consumer)
class EmailConsumer {
  async start() {
    await this.channel.consume("order.created", async (msg) => {
      const data = JSON.parse(msg.content.toString());
      await this.emailService.sendOrderConfirmation(data);
      this.channel.ack(msg);
    });
  }
}

// Inventory Service (consumer)
class InventoryConsumer {
  async start() {
    await this.channel.consume("order.created", async (msg) => {
      const data = JSON.parse(msg.content.toString());
      await this.inventoryService.reserveItems(data.items);
      this.channel.ack(msg);
    });
  }
}
```

---

## 17.3 Payment Integration (Stripe)

```ts
// Stripe Payment
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Create Checkout Session
async function createCheckoutSession(items: CartItem[]) {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: items.map(item => ({
      price_data: {
        currency: "usd",
        product_data: { name: item.name },
        unit_amount: item.price * 100,
      },
      quantity: item.quantity,
    })),
    mode: "payment",
    success_url: `${process.env.CLIENT_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.CLIENT_URL}/cart`,
  });
  return session;
}

// Webhook Handler
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "checkout.session.completed":
      const session = event.data.object;
      await fulfillOrder(session);
      break;
  }

  res.json({ received: true });
});
```

---

## 17.4 Email Integration (Nodemailer)

```ts
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 587,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function sendEmail(to: string, subject: string, html: string) {
  await transporter.sendMail({
    from: '"MyApp" <noreply@myapp.com>',
    to,
    subject,
    html,
  });
}

// Template engine
function welcomeTemplate(name: string) {
  return `
    <h1>Welcome ${name}!</h1>
    <p>Thank you for joining our platform.</p>
  `;
}
```

---

## 17.5 File Upload (S3/Cloudflare R2)

```ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

// Presigned URL for upload
async function getUploadUrl(key: string, contentType: string) {
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn: 3600 });
}

// Direct upload from client
async function uploadFile(file: File) {
  const key = `uploads/${crypto.randomUUID()}-${file.name}`;
  const url = await getUploadUrl(key, file.type);
  await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  return `${process.env.CDN_URL}/${key}`;
}
```

---

## 17.6 Micro-Frontend Architecture

### Module Federation (Webpack 5)

```ts
// Host (Main App)
// webpack.config.js
new ModuleFederationPlugin({
  name: "host",
  remotes: {
    dashboard: "dashboard@http://localhost:3001/remoteEntry.js",
    admin: "admin@http://localhost:3002/remoteEntry.js",
  },
  shared: { react: { singleton: true }, "react-dom": { singleton: true } },
});

// Remote (Dashboard App)
new ModuleFederationPlugin({
  name: "dashboard",
  filename: "remoteEntry.js",
  exposes: { "./App": "./src/App" },
  shared: { react: { singleton: true }, "react-dom": { singleton: true } },
});

// Host Component
const Dashboard = React.lazy(() => import("dashboard/App"));

function App() {
  return (
    <Layout>
      <Navbar />
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/dashboard/*" element={<Dashboard />} />
          <Route path="/admin/*" element={<Admin />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
```

---

## 17.7 Rate Limiting & Security

```ts
import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";

// Rate limiter
const limiter = rateLimit({
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args) }),
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests",
});

app.use("/api/", limiter);

// CORS
import cors from "cors";
app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true,
}));

// Helmet
import helmet from "helmet";
app.use(helmet());

// JWT Auth Middleware
function authenticate(req: Request, res: Response, next: NextFunction) {
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
```

---

## 17.8 Logging & Monitoring

```ts
// Winston Logger
import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

// Structured logging
logger.info("User created", { userId: "123", email: "test@example.com" });
logger.error("Payment failed", { orderId: "456", error: "Card declined" });

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});
```

---

## 17.9 Bài tập

### Bài 1: Payment Flow
Tạo Stripe checkout flow: create session, webhook, fulfill order.

### Bài 2: File Upload
Tạo file upload với presigned URL, image resize, CDN.

### Bài 3: Microservices
Tạo 2 services (Order + Inventory) communicate qua message queue.

---

# Tổng Kết Sách

Bạn đã hoàn thành **17 chương** từ Zero đến Production.

## Lộ trình học

```
PHẦN A: Nền tảng (Ch 0-2)
  → TypeScript type system, generics, utility types

PHẦN B: React Core (Ch 3-7)
  → Hooks, patterns, state management, forms, data fetching

PHẦN C: Server & Scale (Ch 8-11)
  → SSR/SSR/SSG/ISR/PPR, Vite, Next.js, Monorepo

PHẦN D: TypeScript Architecture (Ch 12-15)
  → Testing, CI/CD, DevOps, Server Frameworks, Design Patterns,
    Clean Architecture, DDD, CQRS, State Machines

PHẦN E: Integration & Microservices (Ch 16-17)
  → Database ORM, Real-time, Payment, Email, File Upload,
    Microservices, Message Queue, Micro-frontend
```

## Next Steps
1. Build 1 project thực tế với Clean Architecture
2. Deploy lên cloud (Vercel + Railway)
3. Viết blog chia sẻ kinh nghiệm
4. Đọc source code开源 projects
5. Học thêm: Kubernetes, Terraform, AWS/GCP
