import { spawn, type ChildProcess } from 'child_process';
import net from 'net';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { assignProcessToJob } from './job-object.js';
import { storage } from '../storage.js';

let opencodeProcess: ChildProcess | null = null;
let currentServePort = 4096;
let isSpawning = false;
let isShuttingDown = false;
let healthCheckInterval: NodeJS.Timeout | null = null;
let autoRestartEnabled = true;
/** Port of an externally-started healthy opencode serve we are reusing (not owned by us). */
let adoptedServePort: number | null = null;

// Auto-restart config
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BACKOFF_BASE_MS = 2000; // 2s, 4s, 8s, 16s, 32s
const HEALTH_CHECK_INTERVAL_MS = 30000; // 30s periodic health check
const HEALTH_CHECK_TIMEOUT_MS = 12000; // 12s timeout (tránh false-positive khi model LLM inference nặng)

let restartCount = 0;
let lastSpawnTime = 0;

/**
 * Find a free port starting from startPort (default 4096)
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
        console.log(`[OpenCodeSpawner] Port ${port} bận/đang có tiến trình khác sử dụng -> tăng port lên ${port + 1}...`);
        tryPort(port + 1, remaining - 1);
      });
      srv.once('listening', () => {
        srv.close(() => resolve(port));
      });
      try {
        srv.listen(port, '0.0.0.0');
      } catch {
        try { srv.close(); } catch {}
        console.log(`[OpenCodeSpawner] Port ${port} không listen được -> tăng port lên ${port + 1}...`);
        tryPort(port + 1, remaining - 1);
      }
    };
    tryPort(startPort, maxAttempts);
  });
}

/**
 * Check if server responds at /global/health
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
 * Quick health probe (non-blocking, for periodic checks)
 */
async function quickHealthCheck(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/global/health`, { timeout: HEALTH_CHECK_TIMEOUT_MS }, (res) => {
      resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 400);
    });
    req.once('error', () => resolve(false));
    req.once('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Start periodic health check every 30s
 */
function startHealthMonitor(): void {
  stopHealthMonitor();
  healthCheckInterval = setInterval(async () => {
    if (isShuttingDown) return;
    const ownedAlive = !!opencodeProcess && !opencodeProcess.killed;
    const adoptedAlive = !ownedAlive && adoptedServePort !== null;
    if (!ownedAlive && !adoptedAlive) return;
    const healthy1 = await quickHealthCheck(currentServePort);
    if (!healthy1 && !isShuttingDown) {
      console.warn(`[OpenCodeSpawner] ⚠️ Health check #1 failed for port ${currentServePort}. Process may be busy with LLM inference. Waiting 4s before retry #2...`);
      await new Promise((r) => setTimeout(r, 4000));

      const healthy2 = await quickHealthCheck(currentServePort);
      if (!healthy2 && !isShuttingDown) {
        console.warn(`[OpenCodeSpawner] ⚠️ Health check #2 failed for port ${currentServePort}. Waiting 5s before final retry #3...`);
        await new Promise((r) => setTimeout(r, 5000));

        const healthy3 = await quickHealthCheck(currentServePort);
        if (!healthy3 && !isShuttingDown) {
          console.error(`[OpenCodeSpawner] ❌ Three consecutive health check failures over ~25s on port ${currentServePort}. Restarting/re-spawning...`);
          if (adoptedServePort !== null && adoptedServePort === currentServePort) {
            // serve được adopt (không thuộc quyền quản lý) → bỏ adopt, spawn serve riêng
            adoptedServePort = null;
            autoRestartEnabled = true;
            ensureOpenCodeServer().catch((err) => {
              console.error(`[OpenCodeSpawner] Re-spawn after adopted-serve failure:`, err?.message || err);
            });
          } else {
            // serve do chính spawner quản lý → kill để exit handler restart
            forceKillForRestart();
            autoRestartEnabled = true;
          }
        }
      }
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

function stopHealthMonitor(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

/**
 * Calculate backoff delay for restart attempts
 */
function getRestartBackoff(): number {
  const delay = RESTART_BACKOFF_BASE_MS * Math.pow(2, Math.min(restartCount, MAX_RESTART_ATTEMPTS - 1));
  return Math.min(delay, 60000); // Cap at 60s
}

/**
 * Persist resolved opencode serve URL into settings so createAgentClient / OpenCodeServeClient
 * pick the SAME dynamic port chosen by this spawner (storage takes precedence on client side).
 */
function persistServeUrl(url: string): void {
  try {
    storage.setSetting('opencodeServeUrl', url);
    storage.setSetting('serveUrl', url);
  } catch (e: any) {
    console.warn(`[OpenCodeSpawner] Failed to persist serve URL '${url}':`, e?.message || e);
  }
}

/**
 * REUSE-FIRST: Nếu đã có một opencode serve healthy tại URL đang cấu hình
 * (env OPENCODE_SERVE_URL → storage 'opencodeServeUrl' → mặc định 4096) thì ADOPT thay vì spawn
 * thêm một tiến trình trùng lặp. Tránh chạy nhiều serve song song khi AgentForge restart trong khi
 * serve cũ vẫn sống (Windows Kernel Job Object có thể không kịp dọn khi server bị kill cứng).
 */
async function tryAdoptExistingServe(): Promise<{ port: number; url: string } | null> {
  const candidates: string[] = [];
  const envUrl = process.env.OPENCODE_SERVE_URL;
  if (envUrl) candidates.push(envUrl);
  try {
    const storedUrl = storage.getSetting('opencodeServeUrl') || storage.getSetting('serveUrl');
    if (storedUrl) candidates.push(storedUrl);
  } catch {}
  candidates.push('http://127.0.0.1:4096'); // default fallback

  const seen = new Set<string>();
  for (const url of candidates) {
    if (!url || !/^https?:\/\//.test(url)) continue;
    const cleanUrl = url.replace(/\/+$/, '');
    if (seen.has(cleanUrl)) continue;
    seen.add(cleanUrl);
    try {
      const parsed = new URL(cleanUrl);
      const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
      if (!Number.isFinite(port) || port <= 0) continue;
      // quick detect mới đủ (timeout ngắn ~1.5s) để không chậm boot
      if (await quickHealthCheck(port)) {
        console.log(`[OpenCodeSpawner] 🔁 Reusing existing healthy opencode serve at ${cleanUrl}`);
        adoptedServePort = port;
        currentServePort = port;
        process.env.OPENCODE_SERVE_PORT = String(port);
        process.env.OPENCODE_SERVE_URL = cleanUrl;
        persistServeUrl(cleanUrl);
        startHealthMonitor();
        return { port, url: cleanUrl };
      }
    } catch {}
  }
  return null;
}

/**
 * Spawn opencode serve and bind to Windows Kernel Job Object.
 * When AgentForge exits or crashes, all opencode serve processes die automatically.
 * 
 * Dynamic features:
 * - Reuse-first: adopt an already-healthy serve instead of spawning a duplicate
 * - Auto-restart on unexpected exit (with exponential backoff)
 * - Periodic health monitoring every 30s
 * - Graceful shutdown support
 */
export async function ensureOpenCodeServer(): Promise<{ port: number; url: string }> {
  if (isShuttingDown) {
    throw new Error('[OpenCodeSpawner] Server is shutting down, cannot spawn.');
  }
  if (opencodeProcess && !opencodeProcess.killed) {
    return { port: currentServePort, url: `http://127.0.0.1:${currentServePort}` };
  }
  if (isSpawning) {
    while (isSpawning) {
      await new Promise(r => setTimeout(r, 200));
    }
    return { port: currentServePort, url: `http://127.0.0.1:${currentServePort}` };
  }

  // CHÍNH SÁCH VẬN HÀNH: Không tái sử dụng tiến trình opencode bên ngoài.
  // Bắt buộc AgentForge tự spawn tiến trình riêng và gắn PID vào Windows Kernel Job Object.
  // Khi AgentForge tắt hoặc bị ngắt, Windows Kernel tự động hủy toàn bộ tiến trình serve, đảm bảo không có agent chạy ngầm.

  isSpawning = true;
  try {
    // Check restart backoff
    const now = Date.now();
    if (restartCount > 0) {
      const elapsed = now - lastSpawnTime;
      const backoff = getRestartBackoff();
      if (elapsed < backoff) {
        const waitMs = backoff - elapsed;
        console.log(`[OpenCodeSpawner] Backoff: waiting ${waitMs}ms before restart attempt #${restartCount + 1}...`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }

    // Mặc định khởi động ở port 4096, nếu đã bị chiếm thì tự động tăng port đến khi tìm được free và gán cứng
    const freePort = await findFreePortFrom(4096);
    currentServePort = freePort;

    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'cmd.exe' : 'sh';
    const args = isWin
      ? ['/c', `opencode serve --hostname 0.0.0.0 --port ${freePort}`]
      : ['-c', `opencode serve --hostname 0.0.0.0 --port ${freePort}`];

    console.log(`[OpenCodeSpawner] Spawning: opencode serve --hostname 0.0.0.0 --port ${freePort} (attempt #${restartCount + 1})...`);

    const proc = spawn(cmd, args, {
      cwd: process.cwd(),
      env: { ...process.env, OPENCODE_SERVE_PORT: String(freePort) },
      stdio: 'pipe',
      windowsHide: true,
      detached: false
    });

    opencodeProcess = proc;
    lastSpawnTime = Date.now();

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

    proc.on('exit', (code, signal) => {
      console.log(`[OpenCodeSpawner] opencode serve PID ${proc.pid} exited with code ${code} (signal: ${signal})`);
      // Chỉ clear reference nếu process exit này vẫn là process đang quản lý.
      // Tránh clobber process mới khi forceKillForRestart() được gọi giữa chừng.
      if (opencodeProcess === proc) {
        opencodeProcess = null;
      }

      // Auto-restart on unexpected exit (not during shutdown)
      // Guard `!opencodeProcess` chống double-spawn (health monitor + exit handler cùng trigger).
      if (!isShuttingDown && autoRestartEnabled && code !== 0 && !opencodeProcess) {
        restartCount++;
        if (restartCount <= MAX_RESTART_ATTEMPTS) {
          console.log(`[OpenCodeSpawner] 🔄 Auto-restarting opencode serve (attempt #${restartCount}/${MAX_RESTART_ATTEMPTS})...`);
          ensureOpenCodeServer().catch((err) => {
            console.error(`[OpenCodeSpawner] Auto-restart failed:`, err?.message || err);
          });
        } else {
          console.error(`[OpenCodeSpawner] ❌ Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached. Manual intervention required.`);
          autoRestartEnabled = false;
        }
      } else if (!isShuttingDown && code === 0) {
        // Clean exit (signal 0) — don't restart, but log
        console.log(`[OpenCodeSpawner] opencode serve exited cleanly (code 0).`);
      }
    });

    proc.on('error', (err) => {
      console.error(`[OpenCodeSpawner] Process error:`, err?.message || err);
      opencodeProcess = null;
    });

    // Wait for health check
    const ready = await waitForOpenCodeHealth(freePort, 15000);
    const serveUrl = `http://127.0.0.1:${freePort}`;
    process.env.OPENCODE_SERVE_PORT = String(freePort);
    process.env.OPENCODE_SERVE_URL = serveUrl;
    adoptedServePort = null; // giờ chúng ta tự quản lý serve mới
    persistServeUrl(serveUrl); // sync storage để createAgentClient dùng ĐÚNG port cố định

    if (ready) {
      console.log(`[OpenCodeSpawner] ✅ opencode serve ready at ${serveUrl}`);
      restartCount = 0; // Reset restart counter on successful start
      startHealthMonitor(); // Start periodic health checks
    } else {
      console.warn(`[OpenCodeSpawner] ⚠️ opencode serve started but health check timeout. Proceeding with ${serveUrl}`);
      startHealthMonitor(); // Still monitor even if initial check timed out
    }

    return { port: freePort, url: serveUrl };
  } finally {
    isSpawning = false;
  }
}

/**
 * Graceful shutdown — stop health monitor, disable auto-restart, kill process
 */
export function killOpenCodeServer(): void {
  isShuttingDown = true;
  stopHealthMonitor();
  autoRestartEnabled = false;
  adoptedServePort = null; // serve adopt không thuộc quyền sở hữu → không kill, chỉ bỏ tham chiếu

  forceKillForRestart();
}

/**
 * Kill process WITHOUT setting isShuttingDown — used for health-check-triggered
 * restarts where the process must be terminated but the spawner remains active.
 */
function forceKillForRestart(): void {
  stopHealthMonitor();
  if (opencodeProcess && opencodeProcess.pid) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', opencodeProcess.pid.toString(), '/f', '/t'], { stdio: 'ignore' });
      } else {
        opencodeProcess.kill('SIGTERM');
        // Force kill after 3s if still alive
        setTimeout(() => {
          try { opencodeProcess?.kill('SIGKILL'); } catch {}
        }, 3000);
      }
    } catch {}
    opencodeProcess = null;
  }
}

/**
 * Lấy URL động chính xác của OpenCode Serve đang chạy
 */
export function getOpenCodeServerUrl(): string {
  const port = adoptedServePort || currentServePort;
  return process.env.OPENCODE_SERVE_URL || `http://127.0.0.1:${port}`;
}

/**
 * Get current server status (for monitoring / API)
 */
export function getOpenCodeServerStatus(): { running: boolean; port: number; url: string; restartCount: number; pid: number | null } {
  const url = getOpenCodeServerUrl();
  const port = adoptedServePort || currentServePort;
  return {
    running: adoptedServePort !== null || (!!opencodeProcess && !opencodeProcess.killed),
    port,
    url,
    restartCount,
    pid: opencodeProcess?.pid || null
  };
}

export interface SpawnOpencodeRunOptions {
  agentName?: string;
  sessionId?: string | null;
  model?: string;
  projectDir?: string;
  attachUrl?: string;
  isSlash?: boolean;
  slashCleanCmd?: string;
  slashArgsRest?: string;
  promptTmpFile?: string;
  extraEnv?: Record<string, string>;
}

/**
 * Hàm tập trung duy nhất để spawn tiến trình `opencode run` cho toàn bộ AgentForge.
 * Ghi log chi tiết 100% câu lệnh thực tế được spawn, cờ session, model, pid.
 */
export function spawnOpencodeRunProcess(options: SpawnOpencodeRunOptions): { proc: ChildProcess; cmdLineLogged: string } {
  const isWin = process.platform === 'win32';
  const projectDir = options.projectDir || process.cwd();
  const sessionFlag = options.sessionId ? ` --session "${options.sessionId}"` : '';
  const modelFlag = options.model ? ` --model "${options.model}"` : '';
  const attachArgs = options.attachUrl ? `--attach "${options.attachUrl}" --dir "${projectDir}"` : '';

  let spawnCmd = isWin ? 'powershell.exe' : 'sh';
  let cmdArgs: string[] = [];
  let displayCmd = '';

  if (options.isSlash) {
    const cleanCmd = options.slashCleanCmd || '';
    const messageArg = options.slashArgsRest ? ` "${options.slashArgsRest.replace(/"/g, '`"')}"` : '';
    const attachPart = attachArgs ? ` ${attachArgs}` : '';
    const fullCmd = `opencode run${messageArg}${attachPart} --command "${cleanCmd}"${sessionFlag}${modelFlag} --thinking --auto --format json`;
    displayCmd = fullCmd;
    cmdArgs = isWin
      ? ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `$OutputEncoding = [Console]::OutputEncoding = [Console]::InputEncoding = [System.Text.Encoding]::UTF8; ${fullCmd}`]
      : ['-c', fullCmd];
  } else {
    const safeTmpPath = (options.promptTmpFile || '').replace(/'/g, "''");
    const agentFlag = options.agentName ? ` --agent ${options.agentName}` : '';
    const attachPart = attachArgs ? ` ${attachArgs}` : '';
    displayCmd = `Get-Content -Raw '${options.promptTmpFile}' | opencode run${attachPart}${sessionFlag}${modelFlag} --thinking --auto --format json${agentFlag}`;
    cmdArgs = isWin
      ? ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `$OutputEncoding = [Console]::OutputEncoding = [Console]::InputEncoding = [System.Text.Encoding]::UTF8; Get-Content -Raw -Encoding utf8 '${safeTmpPath}' | opencode run${attachPart}${sessionFlag}${modelFlag} --thinking --auto --format json${agentFlag}`]
      : ['-c', `cat "${options.promptTmpFile}" | opencode run${attachPart}${sessionFlag}${modelFlag} --thinking --auto --format json${agentFlag}`];
  }

  console.log(`[SPAWN-LOG] 🚀 Spawn opencode run:`);
  console.log(`  - Agent: ${options.agentName || '(none)'}`);
  console.log(`  - SessionId: ${options.sessionId || '(NONE - SẼ TỰ SINH SESSION MỚI NẾU KHÔNG CÓ)'}`);
  console.log(`  - Model: ${options.model || '(default)'}`);
  console.log(`  - Attach: ${options.attachUrl || '(none)'}`);
  console.log(`  - Command: ${displayCmd}`);

  const utf8Env = {
    ...process.env,
    NODE_NO_WARNINGS: '1',
    FORCE_COLOR: '0',
    NODE_OPTIONS: '--enable-source-maps',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    ...(options.extraEnv || {})
  };

  const proc = spawn(spawnCmd, cmdArgs, {
    cwd: projectDir,
    env: utf8Env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (proc.pid) {
    console.log(`  - Spawned PID: ${proc.pid}`);
    assignProcessToJob(proc.pid);
  }

  const logEntry = `[${new Date().toISOString()}] [SPAWN] PID=${proc.pid || 'unknown'} Agent="${options.agentName || ''}" SessionId="${options.sessionId || ''}" Model="${options.model || ''}" Attach="${options.attachUrl || ''}"\nCMD: ${displayCmd}\n------------------------------------------------------------\n`;
  try {
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'opencode-spawn.log'), logEntry, 'utf8');
  } catch {}

  return { proc, cmdLineLogged: displayCmd };
}
