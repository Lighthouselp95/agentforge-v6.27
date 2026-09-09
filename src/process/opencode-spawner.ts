import { spawn, type ChildProcess } from 'child_process';
import net from 'net';
import http from 'http';
import { assignProcessToJob } from './job-object.js';

let opencodeProcess: ChildProcess | null = null;
let currentServePort = 4096;
let isSpawning = false;

/**
 * Tìm cổng rảnh bắt đầu từ startPort (mặc định 4096)
 */
export function findFreePortFrom(startPort = 4096, maxAttempts = 100): Promise<number> {
  return new Promise((resolve) => {
    const tryPort = (port: number, remaining: number) => {
      if (remaining <= 0) {
        resolve(startPort);
        return;
      }
      const srv = net.createServer();
      srv.once('error', () => {
        tryPort(port + 1, remaining - 1);
      });
      srv.once('listening', () => {
        srv.close(() => resolve(port));
      });
      try {
        srv.listen(port, '0.0.0.0');
      } catch {
        try { srv.close(); } catch {}
        tryPort(port + 1, remaining - 1);
      }
    };
    tryPort(startPort, maxAttempts);
  });
}

/**
 * Đợi server phản hồi endpoint /global/health
 */
function waitForOpenCodeHealth(port: number, timeoutMs = 15000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = () => {
      const req = http.get(`http://127.0.0.1:${port}/global/health`, { timeout: 1500 }, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
          resolve(true);
        } else {
          retry();
        }
      });
      req.once('error', retry);
      req.once('timeout', () => { req.destroy(); retry(); });

      function retry() {
        if (Date.now() - start > timeoutMs) resolve(false);
        else setTimeout(poll, 400);
      }
    };
    poll();
  });
}

/**
 * Khởi chạy tiến trình opencode serve và gắn chặt vào Windows Kernel Job Object
 * Khi AgentForge kết thúc hoặc crash, toàn bộ opencode serve tự động chết theo.
 */
export async function ensureOpenCodeServer(): Promise<{ port: number; url: string }> {
  if (opencodeProcess && !opencodeProcess.killed) {
    return { port: currentServePort, url: `http://127.0.0.1:${currentServePort}` };
  }
  if (isSpawning) {
    while (isSpawning) {
      await new Promise(r => setTimeout(r, 200));
    }
    return { port: currentServePort, url: `http://127.0.0.1:${currentServePort}` };
  }

  isSpawning = true;
  try {
    const freePort = await findFreePortFrom(4096);
    currentServePort = freePort;
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'cmd.exe' : 'sh';
    const args = isWin
      ? ['/c', `opencode serve --hostname 0.0.0.0 --port ${freePort}`]
      : ['-c', `opencode serve --hostname 0.0.0.0 --port ${freePort}`];

    console.log(`[OpenCodeSpawner] Spawning: opencode serve --hostname 0.0.0.0 --port ${freePort}...`);

    const proc = spawn(cmd, args, {
      cwd: process.cwd(),
      env: { ...process.env, OPENCODE_SERVE_PORT: String(freePort) },
      stdio: 'pipe',
      windowsHide: true,
      detached: false
    });

    opencodeProcess = proc;

    if (proc.pid) {
      console.log(`[OpenCodeSpawner] PID ${proc.pid} assigned to Job Object.`);
      assignProcessToJob(proc.pid);
    }

    proc.stdout?.on('data', (d) => {
      const line = d.toString().trim();
      if (line) console.log(`[OpenCode:${freePort}] ${line}`);
    });
    proc.stderr?.on('data', (d) => {
      const line = d.toString().trim();
      if (line) console.error(`[OpenCode:${freePort}:err] ${line}`);
    });

    proc.on('exit', (code) => {
      console.log(`[OpenCodeSpawner] opencode serve PID ${proc.pid} exited with code ${code}`);
      opencodeProcess = null;
    });

    // Chờ health check
    const ready = await waitForOpenCodeHealth(freePort, 15000);
    const serveUrl = `http://127.0.0.1:${freePort}`;
    process.env.OPENCODE_SERVE_PORT = String(freePort);
    process.env.OPENCODE_SERVE_URL = serveUrl;

    if (ready) {
      console.log(`[OpenCodeSpawner] ✅ opencode serve ready at ${serveUrl}`);
    } else {
      console.warn(`[OpenCodeSpawner] ⚠️ opencode serve started but health check timeout. Proceeding with ${serveUrl}`);
    }

    return { port: freePort, url: serveUrl };
  } finally {
    isSpawning = false;
  }
}

/**
 * Dọn dẹp thủ công khi shutdown
 */
export function killOpenCodeServer(): void {
  if (opencodeProcess && opencodeProcess.pid) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', opencodeProcess.pid.toString(), '/f', '/t'], { stdio: 'ignore' });
      } else {
        opencodeProcess.kill('SIGKILL');
      }
    } catch {}
    opencodeProcess = null;
  }
}
