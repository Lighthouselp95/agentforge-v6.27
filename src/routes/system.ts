import { Router } from 'express';
import { join } from 'path';
import { spawn } from 'child_process';
import fs from 'fs';

export interface ClientLogEntry {
  id: string;
  timestamp: number;
  type: string;
  message: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  details?: any;
}

const MAX_CLIENT_LOGS = 300;
const clientLogsRingBuffer: ClientLogEntry[] = [];
const clientLogFile = join(process.cwd(), 'logs', 'client.log');

export interface SystemRouteDeps {
  appVersion: string;
  port: number;
  serverStartTime: number;
  sseClients: Set<any>;
  wsClients: Set<any>;
  agents: Map<string, any>;
  storage: any;
  logBuffer: string[];
  getOpenCodeStatus?: () => { running: boolean; port: number; url: string; restartCount: number; pid: number | null };
}

export function createSystemRouter(deps: SystemRouteDeps): Router {
  const router = Router();

  // GET /api/server-info
  router.get('/server-info', (_req, res) => {
    res.json({
      serverStartTime: deps.serverStartTime,
      uptimeMs: Date.now() - deps.serverStartTime,
      cwd: process.cwd(),
      version: deps.appVersion
    });
  });

  // GET /api/opencode-status — trạng thái OpenCode serve (dynamic spawner / auto-restart)
  router.get('/opencode-status', (_req, res) => {
    const status = deps.getOpenCodeStatus ? deps.getOpenCodeStatus() : { running: false, port: 0, url: '', restartCount: 0, pid: null };
    res.json({ ok: true, ...status });
  });

  // GET /api/logs
  router.get('/logs', (req, res) => {
    const { level, source, agentId, limit, beforeId } = req.query;
    const logs = deps.storage.getLogs({
      level: typeof level === 'string' ? level : undefined,
      source: typeof source === 'string' ? source : undefined,
      agentId: typeof agentId === 'string' ? agentId : undefined,
      limit: typeof limit === 'string' ? parseInt(limit, 10) : undefined,
      beforeId: typeof beforeId === 'string' ? beforeId : undefined,
    });
    res.json({ logs, count: logs.length });
  });

  // POST /api/logs/clear
  router.post('/logs/clear', (_req, res) => {
    deps.storage.clearLogs();
    deps.logBuffer.length = 0;
    res.json({ success: true, message: 'Logs cleared successfully' });
  });

  // POST /api/debug/client-log — Client-side error & diagnostic collector
  router.post('/debug/client-log', (req, res) => {
    try {
      const { type = 'error', message = '', stack = '', url = '', userAgent = '', details } = req.body || {};
      const entry: ClientLogEntry = {
        id: 'cl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        timestamp: Date.now(),
        type: String(type).slice(0, 50),
        message: String(message || 'Unknown error').slice(0, 2000),
        stack: stack ? String(stack).slice(0, 4000) : undefined,
        url: url ? String(url).slice(0, 500) : undefined,
        userAgent: userAgent ? String(userAgent).slice(0, 300) : undefined,
        details: typeof details === 'object' && details !== null ? details : undefined,
      };

      // In-memory circular buffer
      clientLogsRingBuffer.unshift(entry);
      if (clientLogsRingBuffer.length > MAX_CLIENT_LOGS) {
        clientLogsRingBuffer.pop();
      }

      // Persist to logs/client.log defensively
      try {
        const dir = join(process.cwd(), 'logs');
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.appendFile(clientLogFile, JSON.stringify(entry) + '\n', () => {});
      } catch {}

      res.status(200).json({ ok: true, id: entry.id });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || 'Failed to record client log' });
    }
  });

  // GET /api/debug/client-logs — Query recent client-side errors & events
  router.get('/debug/client-logs', (req, res) => {
    const { limit = '50', type } = req.query;
    const max = Math.min(200, Math.max(1, parseInt(String(limit), 10) || 50));
    let filtered = clientLogsRingBuffer;
    if (typeof type === 'string' && type.trim()) {
      const t = type.trim().toLowerCase();
      filtered = filtered.filter(l => l.type.toLowerCase().includes(t));
    }
    res.json({
      ok: true,
      count: filtered.length,
      logs: filtered.slice(0, max),
    });
  });

  // POST /api/debug/client-logs/clear — Clear client logs buffer and file
  router.post('/debug/client-logs/clear', (_req, res) => {
    clientLogsRingBuffer.length = 0;
    try {
      if (fs.existsSync(clientLogFile)) {
        fs.writeFileSync(clientLogFile, '');
      }
    } catch {}
    res.json({ ok: true, message: 'Client logs cleared' });
  });

  // POST /api/restart — Restart Server Endpoint (Detached Spawn), dời verbatim từ server.ts
  router.post('/restart', (_req, res) => {
    res.json({ success: true, message: 'Restarting AgentForge server...' });
    setTimeout(() => {
      try {
        const batPath = join(process.cwd(), 'start.bat');
        const isWin = process.platform === 'win32';
        const child = spawn(
          isWin ? 'cmd.exe' : 'sh',
          isWin ? ['/c', batPath] : ['-c', 'npm start'],
          {
            detached: true,
            stdio: 'ignore',
            cwd: process.cwd()
          }
        );
        child.unref();
      } catch (e: any) {
        console.error('[Restart] Failed to spawn restart process:', e);
      }
      process.exit(0);
    }, 500);
  });

  return router;
}
