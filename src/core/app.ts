// src/core/app.ts
/**
 * Bootstrap ứng dụng AgentForge v8 — tách từ src/server.ts.
 * Chịu trách nhiệm:
 *   - Tạo express app, http server, wss
 *   - Khởi tạo BroadcastManager, WebSocketManager
 *   - Mount routes (api, terminal, chat, agents, system, models, settings...)
 *   - Khởi chạy server trên port có thể cấu hình
 *
 * Feature flag:
 *   - USE_V8_CORE=false mặc định → giữ nguyên production v7.0.55
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { BroadcastManager, createBroadcastManager } from './broadcast.js';
import { AgentStatusManager } from './state-machine.js';
import { createApiRouter } from '../routes/index.js';
import { createTerminalRouter } from '../routes/terminal.js';
import { WebSocketManager } from '../ws/index.js';
import type { SimpleTask } from './task-queue.js';

export interface CoreAppOptions {
  port?: number;
  useV8Core?: boolean;
  projectRoot?: string;
  // Hook xử lý khi TaskQueueManager muốn gửi tin nhắc agent tiếp tục task
  onAutoContinueTask?: (task: SimpleTask) => void;
}

export interface CoreApp {
  app: express.Express;
  server: ReturnType<typeof createServer>;
  broadcast: BroadcastManager;
  statusManager: AgentStatusManager;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createCoreApp(opts: CoreAppOptions = {}): CoreApp {
  const port = opts.port || parseInt(process.env.PORT || '4001', 10);
  const useV8Core = opts.useV8Core ?? (process.env.USE_V8_CORE === 'true');

  const app = express();
  app.use(express.json());

  // CORS
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  const broadcast = createBroadcastManager({
    taskQueue: {
      idleDetectionMs: 30000, // 30s
      taskCheckIntervalMs: 60000, // 1p
      blockCriticalTasks: false
    }
  });
  // Nếu caller cung cấp hook, wire vào TaskQueueManager để thực sự gửi tin cho agent
  if (opts.onAutoContinueTask) {
    broadcast.taskQueueManager?.setOnAssignTask(opts.onAutoContinueTask);
  }
  const statusManager = new AgentStatusManager();

  const wsClients = new Set<import('ws').WebSocket>();
  const wsManager = new WebSocketManager(wss, wsClients);
  wsManager.init();

  // Routes
  app.use('/api', createApiRouter({
    broadcast: (type: string, data: any) => broadcast.broadcast(type, data),
    // @todo: inject đầy đủ deps khi wiring v8
  } as any));

  app.use('/terminal', createTerminalRouter({
    broadcast: (type: string, data: any) => broadcast.broadcast(type, data),
    // @todo: inject terminal deps khi wiring v8
  } as any));

  // Health
  app.get('/api/server-info', (req, res) => {
    res.json({ version: useV8Core ? '8.0.0' : '7.0.55', status: 'OK', mode: useV8Core ? 'v8-core' : 'legacy' });
  });

  const coreApp: CoreApp = {
    app,
    server,
    broadcast,
    statusManager,
    async start() {
      await new Promise<void>((resolve) => {
        server.listen(port, '0.0.0.0', () => {
          console.log(`[CoreApp] listening on :${port} mode=${useV8Core ? 'v8' : 'legacy'}`);
          resolve();
        });
      });
    },
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  };

  return coreApp;
}
