/**
 * Process Lifecycle Management for AgentForge
 * Manages subprocesses, ACPClient execution lifecycles, graceful termination, and tree-kills.
 */
import { spawn, execSync, type ChildProcess } from 'child_process';
import { createServer } from 'net';
import { assignProcessToJob } from './job-object.js';

const isWin = process.platform === 'win32';

export interface ProcessMeta {
  pid: number;
  agentId: string;
  command: string;
  startedAt: number;
  child?: ChildProcess;
}

export class ProcessManager {
  private static instance: ProcessManager;
  private activeProcesses = new Map<number, ProcessMeta>();
  private agentProcessMap = new Map<string, Set<number>>();

  public static getInstance(): ProcessManager {
    if (!ProcessManager.instance) {
      ProcessManager.instance = new ProcessManager();
    }
    return ProcessManager.instance;
  }

  /**
   * Đăng ký một tiến trình con đang chạy
   */
  public registerProcess(agentId: string, pid: number, command: string, child?: ChildProcess): void {
    if (pid) {
      assignProcessToJob(pid);
    }
    const meta: ProcessMeta = {
      pid,
      agentId,
      command,
      startedAt: Date.now(),
      child
    };
    this.activeProcesses.set(pid, meta);
    if (!this.agentProcessMap.has(agentId)) {
      this.agentProcessMap.set(agentId, new Set());
    }
    this.agentProcessMap.get(agentId)!.add(pid);

    if (child) {
      child.on('exit', () => {
        this.unregisterProcess(pid);
      });
    }
  }

  /**
   * Hủy đăng ký tiến trình sau khi đã hoàn tất
   */
  public unregisterProcess(pid: number): void {
    const meta = this.activeProcesses.get(pid);
    if (meta) {
      this.activeProcesses.delete(pid);
      const set = this.agentProcessMap.get(meta.agentId);
      if (set) {
        set.delete(pid);
        if (set.size === 0) {
          this.agentProcessMap.delete(meta.agentId);
        }
      }
    }
  }

  /**
   * Dừng an toàn (tree kill) toàn bộ tiến trình thuộc về một agent
   */
  public abortAgentProcesses(agentId: string): boolean {
    const pids = this.agentProcessMap.get(agentId);
    if (!pids || pids.size === 0) return false;

    let allKilled = true;
    for (const pid of Array.from(pids)) {
      const ok = this.killProcessTree(pid);
      if (!ok) allKilled = false;
      this.unregisterProcess(pid);
    }
    return allKilled;
  }

  /**
   * Tree kill một process theo PID (cross-platform)
   */
  public killProcessTree(pid: number): boolean {
    try {
      if (isWin) {
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
        } catch {
          try { process.kill(pid, 0); } catch {}
        }
      } else {
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          process.kill(pid, 'SIGTERM');
        }
        setTimeout(() => {
          try { process.kill(-pid, 'SIGKILL'); } catch {}
          try { process.kill(pid, 'SIGKILL'); } catch {}
        }, 1500);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Tìm cổng TCP rảnh để spawn server ephemeral
   */
  public async findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          const port = address.port;
          server.close(() => resolve(port));
        } else {
          server.close(() => reject(new Error('Failed to obtain port')));
        }
      });
      server.on('error', reject);
    });
  }

  /**
   * Danh sách tiến trình đang hoạt động
   */
  public getActiveProcesses(): ProcessMeta[] {
    return Array.from(this.activeProcesses.values());
  }

  /**
   * Dọn dẹp tất cả tiến trình khi server shutdown
   */
  public cleanupAll(): void {
    for (const pid of Array.from(this.activeProcesses.keys())) {
      this.killProcessTree(pid);
    }
    this.activeProcesses.clear();
    this.agentProcessMap.clear();
  }
}

export const processManager = ProcessManager.getInstance();
