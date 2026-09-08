// OpenCode Serve Client — Multi-mode client supporting CLI --attach and direct HTTP/SSE serve
import { exec, spawn, execSync } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { openSync, writeSync, fsyncSync, closeSync, unlinkSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import http from 'http';
import { StringDecoder } from 'string_decoder';
import type { AgentConfig, AgentMessage, MessagePart, TokenUsage, ToolCallInfo } from './types.js';
import { storage } from '../storage.js';
import { assignProcessToJob } from '../process/job-object.js';

const execAsync = promisify(exec);
const isWin = process.platform === 'win32';
const MAX_PENDING = 20;

export type ServeMode = 'attach' | 'http';

export interface OpenCodeServeClientOptions {
  serverUrl?: string;          // Mặc định: process.env.OPENCODE_SERVE_URL || 'http://127.0.0.1:4096'
  mode?: ServeMode;            // Mặc định: (process.env.OPENCODE_SERVE_MODE as ServeMode) || 'attach'
  autoFallbackToCli?: boolean; // Tự động fallback sang CLI thông thường nếu server không online
}

function getAgentForgeTmpDir(): string {
  const dir = join(tmpdir(), 'agentforge', 'tmp');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export class OpenCodeServeClient {
  private static agentSessions = new Map<string, string>();
  public static activeChildPids = new Set<number>();

  /** Kill toàn bộ tiến trình con đang chạy khi shutdown / crash */
  static killAllChildProcesses() {
    if (OpenCodeServeClient.activeChildPids.size === 0) return;
    const pids = Array.from(OpenCodeServeClient.activeChildPids);
    for (const pid of pids) {
      try {
        if (isWin) {
          execSync(`taskkill /pid ${pid} /T /F`, { timeout: 3000, stdio: 'ignore' });
        } else {
          try { process.kill(-pid, 'SIGKILL'); } catch {}
          try { process.kill(pid, 'SIGKILL'); } catch {}
        }
      } catch {}
    }
    OpenCodeServeClient.activeChildPids.clear();
  }

  /** Đăng ký session cho agent */
  static registerSession(agentId: string, sessionId: string) {
    OpenCodeServeClient.agentSessions.set(agentId, sessionId);
  }

  static getRegisteredSession(agentId: string): string | undefined {
    return OpenCodeServeClient.agentSessions.get(agentId);
  }

  static unregisterSession(agentId: string) {
    OpenCodeServeClient.agentSessions.delete(agentId);
  }

  // ============ HTTP STATIC HELPERS (OPENCODE SERVE REST API) ============

  /** Kiểm tra trạng thái máy chủ OpenCode Serve qua endpoint GET /global/health */
  static async checkServeHealth(serverUrl: string = 'http://127.0.0.1:4096'): Promise<{ healthy: boolean; version?: string }> {
    try {
      const url = `${serverUrl.replace(/\/$/, '')}/global/health`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { healthy: false };
      const data = await res.json() as any;
      return { healthy: !!data?.healthy, version: data?.version };
    } catch {
      return { healthy: false };
    }
  }

  /** Lấy danh sách session hiện hữu từ OpenCode Serve (GET /session) */
  static async getSessionsHttp(serverUrl: string = 'http://127.0.0.1:4096'): Promise<any[]> {
    try {
      const url = `${serverUrl.replace(/\/$/, '')}/session`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (e: any) {
      console.warn(`[OpenCodeServeClient] getSessionsHttp failed: ${e.message}`);
      return [];
    }
  }

  /** Tạo session mới qua HTTP (POST /session) */
  static async createSessionHttp(serverUrl: string = 'http://127.0.0.1:4096', params?: { title?: string; directory?: string }): Promise<string> {
    const url = `${serverUrl.replace(/\/$/, '')}/session`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      throw new Error(`Failed to create session on OpenCode Serve (HTTP ${res.status}): ${await res.text()}`);
    }
    const data = await res.json() as any;
    const sid = data?.id || data?.sessionId;
    if (!sid) throw new Error('No session ID returned from OpenCode Serve POST /session');
    return sid;
  }

  /** Gửi message trực tiếp qua HTTP REST API (POST /session/{sessionID}/message) */
  static async sendHttpMessage(serverUrl: string, sessionId: string, payload: any): Promise<any> {
    const cleanUrl = serverUrl.replace(/\/$/, '');
    const url = `${cleanUrl}/session/${sessionId}/message`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) {
      throw new Error(`HTTP message dispatch failed (${res.status}): ${await res.text()}`);
    }
    return res.json();
  }

  /** Abort session qua HTTP (POST /session/{sessionID}/abort) */
  static async abortSessionHttp(serverUrl: string, sessionId: string): Promise<boolean> {
    try {
      const cleanUrl = serverUrl.replace(/\/$/, '');
      const url = `${cleanUrl}/session/${sessionId}/abort`;
      const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Xoá session trên OpenCode Serve qua HTTP (DELETE /session/{sessionID}) */
  static async deleteSessionHttp(serverUrl: string, sessionId: string): Promise<boolean> {
    try {
      const cleanUrl = serverUrl.replace(/\/$/, '');
      const url = `${cleanUrl}/session/${sessionId}`;
      const res = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ============ INSTANCE PROPERTIES ============
  private config: AgentConfig;
  private serverUrl: string;
  private mode: ServeMode;
  private autoFallbackToCli: boolean;

  private sessionId: string | null = null;
  private proc: ReturnType<typeof spawn> | null = null;
  private busy = false;
  private pending: Array<{ prompt: string; resolve: (m: AgentMessage) => void; reject: (e: any) => void }> = [];
  private aborting = false;
  public isCompacting = false;
  private needPromptReinject = false;
  private unprocessedPrompts: string[] = [];
  private onStatusChange?: (busy: boolean) => void;

  // Streaming terminal I/O lên UI
  private onEvent?: (ev: any) => void;
  private eventSeq = 0;
  private eventBuf: any[] = [];
  private eventTimer: any = null;
  private lineBuf = '';
  private _aborted = false;

  constructor(config: AgentConfig, options: OpenCodeServeClientOptions = {}) {
    this.config = config;
    this.serverUrl = options.serverUrl || process.env.OPENCODE_SERVE_URL || 'http://127.0.0.1:4096';
    this.mode = options.mode || (process.env.OPENCODE_SERVE_MODE as ServeMode) || 'attach';
    this.autoFallbackToCli = options.autoFallbackToCli ?? true;

    // Load registered session if exists
    const reg = OpenCodeServeClient.getRegisteredSession(config.id);
    if (reg) this.sessionId = reg;
  }

  public getServerUrl(): string {
    return this.serverUrl;
  }

  public setServerUrl(url: string): void {
    this.serverUrl = url;
  }

  public getMode(): ServeMode {
    return this.mode;
  }

  public setMode(mode: ServeMode): void {
    this.mode = mode;
  }

  public setOnEvent(cb: (ev: any) => void) {
    this.onEvent = cb;
  }

  public setOnStatusChange(cb: (busy: boolean) => void) {
    this.onStatusChange = cb;
  }

  public setNeedPromptReinject(val: boolean = true) {
    this.needPromptReinject = val;
  }

  public getNeedPromptReinject(): boolean {
    return this.needPromptReinject;
  }

  public async getSessionStats(sessionId?: string): Promise<{ title?: string; tokenUsage?: TokenUsage; contextLength?: number } | null> {
    const sid = sessionId || this.sessionId;
    if (!sid) return null;
    try {
      const title = await this.getSessionTitle(sid);
      return { title: title || undefined };
    } catch {
      return null;
    }
  }

  public async getSessionTitle(sessionId?: string): Promise<string | null> {
    const sid = sessionId || this.sessionId;
    if (!sid) return null;
    try {
      const sessions = await OpenCodeServeClient.getSessionsHttp(this.serverUrl);
      const found = sessions.find((s: any) => s.id === sid);
      return found?.title || found?.slug || null;
    } catch {
      return null;
    }
  }

  public addUnprocessedPrompt(prompt: string) {
    if (!prompt || !prompt.trim()) return;
    const clean = prompt.trim();
    if (!this.unprocessedPrompts.includes(clean)) {
      this.unprocessedPrompts.push(clean);
    }
  }

  public clearUnprocessedPrompts() {
    this.unprocessedPrompts = [];
  }

  public getUnprocessedPrompts(): string[] {
    return [...this.unprocessedPrompts];
  }

  public setSession(id: string | null) {
    this.sessionId = id;
    if (id) {
      OpenCodeServeClient.registerSession(this.config.id, id);
      storage.updateAgent(this.config.id, { sessionId: id });
    } else {
      OpenCodeServeClient.unregisterSession(this.config.id);
      storage.updateAgent(this.config.id, { sessionId: null });
    }
  }

  public getSessionId(): string | null {
    return this.sessionId;
  }

  public setModel(model?: string) {
    this.config.model = model;
  }

  public getModel(): string | undefined {
    return this.config.model;
  }

  public getConfig(): AgentConfig {
    return this.config;
  }

  public isBusy(): boolean {
    return this.busy;
  }

  public getPendingCount(): number {
    return this.pending.length;
  }

  /** Huỷ tiến trình con hoặc lượt request đang xử lý */
  public abort(): boolean {
    if (this.aborting) return false;
    this.aborting = true;
    this._aborted = true;

    try {
      if (this.mode === 'http' && this.sessionId) {
        OpenCodeServeClient.abortSessionHttp(this.serverUrl, this.sessionId).catch(() => {});
      }

      if (this.proc) {
        const p = this.proc;
        this.proc = null;
        if (p.pid) {
          OpenCodeServeClient.activeChildPids.delete(p.pid);
          if (isWin) {
            try { execSync(`taskkill /pid ${p.pid} /T /F`, { timeout: 2000, stdio: 'ignore' }); } catch {}
          } else {
            try { p.kill('SIGKILL'); } catch {}
          }
        }
      }

      if (this.pending.length > 0) {
        const cancelled = this.pending.splice(0);
        cancelled.forEach(item => {
          item.reject(new Error('Agent operation aborted by user'));
        });
      }

      this.busy = false;
      this.onStatusChange?.(false);
      return true;
    } finally {
      this.aborting = false;
    }
  }

  /** Đưa yêu cầu vào hàng đợi và thực thi tuần tự */
  public enqueue(prompt: string): Promise<AgentMessage> {
    return new Promise((resolve, reject) => {
      if (this.pending.length >= MAX_PENDING) {
        return reject(new Error(`Agent ${this.config.name} queue is full (${MAX_PENDING} messages limit)`));
      }
      this.pending.push({ prompt, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.busy || this.pending.length === 0) return;
    this.busy = true;
    this.onStatusChange?.(true);

    const { prompt, resolve, reject } = this.pending.shift()!;
    try {
      const res = await this.executeTurn(prompt);
      resolve(res);
    } catch (err) {
      reject(err);
    } finally {
      this.busy = false;
      this.onStatusChange?.(false);
      setImmediate(() => this.processQueue());
    }
  }

  private async executeTurn(prompt: string): Promise<AgentMessage> {
    if (this.mode === 'http') {
      return this.runHttp(prompt);
    }
    return this.runAttachCli(prompt);
  }

  // ============ CHẾ ĐỘ 1: ATTACH CLI (OPENCODE RUN --ATTACH) ============

  private async runAttachCli(prompt: string, attempt = 0): Promise<AgentMessage> {
    const projectDir = this.config.projectDir || process.cwd();
    const isSlash = prompt.startsWith('/');
    let cleanCmd = '';
    let cmdArgsRest = '';

    if (isSlash) {
      const match = prompt.match(/^\/([^\s]+)(?:\s+(.*))?$/s);
      if (match) {
        cleanCmd = match[1];
        cmdArgsRest = match[2] ? match[2].trim() : '';
      }
    }

    const tmpDir = getAgentForgeTmpDir();
    const tmpFile = join(tmpDir, `prompt_${this.config.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`);

    if (!isSlash) {
      const utf8Buffer = Buffer.from(prompt, 'utf8');
      const fd = openSync(tmpFile, 'w');
      writeSync(fd, utf8Buffer, 0, utf8Buffer.length, null);
      fsyncSync(fd);
      closeSync(fd);
    }

    const roleToAgent: Record<string, string> = {
      coder: 'coder', reviewer: 'reviewer', tester: 'tester',
      docs: 'docs', planner: 'planner', orchestrator: 'orchestrator',
      researcher: 'researcher', verifier: 'verifier', debugger: 'debugger',
      searcher: 'searcher', idea: 'idea'
    };
    const agentName = roleToAgent[this.config.role] || this.config.role || (this.config.type === 'orchestrator' ? 'orchestrator' : 'coder');

    let modelToUse = this.config.model;
    if (!modelToUse || !modelToUse.trim() || modelToUse.trim().toLowerCase() === 'default') {
      modelToUse = process.env.ORCHESTRATOR_MODEL || process.env.DEFAULT_MODEL || 'antigravity/gemini-3.7-flash-high';
    }

    // Xây dựng các cờ lệnh hỗ trợ --attach và remote directory
    let attachArgs = `--attach "${this.serverUrl}" --dir "${projectDir}"`;
    let agentFlag = ` --agent ${agentName} --thinking`;
    if (this.sessionId) {
      agentFlag += ` --session "${this.sessionId}"`;
    }
    agentFlag += ` --model "${modelToUse}"`;

    const utf8Env = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      NODE_OPTIONS: '--enable-source-maps',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8'
    };

    let cmdArgs: string[] = [];
    if (isSlash) {
      const sessionFlag = this.sessionId ? ` --session "${this.sessionId}"` : '';
      const modelFlag = modelToUse ? ` --model "${modelToUse}"` : '';
      const messageArg = cmdArgsRest ? ` "${cmdArgsRest.replace(/"/g, '`"')}"` : '';
      const fullCmd = `opencode run${messageArg} ${attachArgs} --command "${cleanCmd}"${sessionFlag}${modelFlag} --thinking --auto --format json`;
      cmdArgs = isWin
        ? ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `$OutputEncoding = [Console]::OutputEncoding = [Console]::InputEncoding = [System.Text.Encoding]::UTF8; ${fullCmd}`]
        : ['-c', fullCmd];
    } else {
      const safeTmpPath = tmpFile.replace(/'/g, "''");
      cmdArgs = isWin
        ? ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `$OutputEncoding = [Console]::OutputEncoding = [Console]::InputEncoding = [System.Text.Encoding]::UTF8; Get-Content -Raw -Encoding utf8 '${safeTmpPath}' | opencode run ${attachArgs} --auto --format json${agentFlag}`]
        : ['-c', `cat "${tmpFile}" | opencode run ${attachArgs} --auto --format json${agentFlag}`];
    }

    try {
      this.lineBuf = '';
      this.pushOACEvent({ kind: 'in', prompt: prompt.length > 4000 ? prompt.slice(0, 4000) + '\n…(truncated)' : prompt });

      const stdout = await new Promise<string>((resolve, reject) => {
        const proc = spawn(
          isWin ? 'powershell.exe' : 'sh',
          cmdArgs,
          {
            cwd: projectDir,
            env: utf8Env,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe']
          }
        );
        this.proc = proc as any;
        if (proc.pid) {
          OpenCodeServeClient.activeChildPids.add(proc.pid);
          assignProcessToJob(proc.pid);
        }

        proc.stdin?.on('error', () => {
          try {
            if (proc.pid) {
              if (isWin) execSync(`taskkill /pid ${proc.pid} /T /F`, { timeout: 3000, stdio: 'ignore' });
              else proc.kill('SIGKILL');
            }
          } catch {}
        });

        const stdoutDecoder = new StringDecoder('utf8');
        const stderrDecoder = new StringDecoder('utf8');
        let stdoutStr = '';
        let stderrStr = '';

        proc.stdout?.on('data', (chunk: Buffer) => {
          const piece = stdoutDecoder.write(chunk);
          stdoutStr += piece;
          this.handleStdoutStream(piece);
        });

        proc.stderr?.on('data', (chunk: Buffer) => {
          const piece = stderrDecoder.write(chunk);
          stderrStr += piece;
        });

        proc.on('error', (err) => {
          if (proc.pid) OpenCodeServeClient.activeChildPids.delete(proc.pid);
          this.proc = null;
          reject(err);
        });

        proc.on('close', (code) => {
          if (proc.pid) OpenCodeServeClient.activeChildPids.delete(proc.pid);
          this.proc = null;
          stdoutStr += stdoutDecoder.end();
          stderrStr += stderrDecoder.end();
          this.stopOACEvents();

          if (code !== 0 && code !== null) {
            const errDetails = stderrStr.trim() || stdoutStr.trim();
            const e: any = new Error(`Attach command failed (${code}): ${errDetails || 'Process exited with error'}`);
            e.stdout = stdoutStr; e.stderr = stderrStr; e.code = code;
            reject(e);
          } else {
            resolve(stdoutStr);
          }
        });
      });

      const { content, transcript, sessionId, toolCalls, tokenUsage, contextLength, thinking, parts, firstEventTimestamp } = this.parseJsonlEvents(stdout);

      if (!this.sessionId && sessionId) {
        this.sessionId = sessionId;
        OpenCodeServeClient.registerSession(this.config.id, sessionId);
        storage.updateAgent(this.config.id, { sessionId });
      }

      return {
        id: uuidv4(),
        from: this.config.id,
        to: 'orchestrator',
        content: content || '(No response)',
        timestamp: firstEventTimestamp || Date.now(),
        transcript: transcript || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        thinking,
        parts: parts && parts.length > 0 ? parts : undefined,
        tokenUsage,
        contextLength
      };
    } finally {
      if (!isSlash) {
        try { unlinkSync(tmpFile); } catch {}
      }
    }
  }

  // ============ CHẾ ĐỘ 2: HTTP SERVE (DIRECT REST & SSE) ============

  /** Chạy qua HTTP endpoint của OpenCode Serve (không spawn tiến trình con CLI) */
  private async runHttp(prompt: string): Promise<AgentMessage> {
    // 1. Đảm bảo session đã được tạo
    if (!this.sessionId) {
      const projectDir = this.config.projectDir || process.cwd();
      this.sessionId = await OpenCodeServeClient.createSessionHttp(this.serverUrl, {
        title: `${this.config.name} (${this.config.role})`,
        directory: projectDir
      });
      OpenCodeServeClient.registerSession(this.config.id, this.sessionId);
      storage.updateAgent(this.config.id, { sessionId: this.sessionId });
    }

    // 2. Map model "provider/model" sang đúng định dạng OpenCode Serve API { providerID, modelID }.
    //    Gửi model dạng string sẽ bị Serve trả HTTP 400 (validation) — đây là bug cũ.
    let modelToUse = this.config.model;
    if (!modelToUse || !modelToUse.trim() || modelToUse.trim().toLowerCase() === 'default') {
      modelToUse = process.env.ORCHESTRATOR_MODEL || process.env.DEFAULT_MODEL || 'antigravity/gemini-3.7-flash-high';
    }
    modelToUse = modelToUse.trim();
    const modelObj = modelToUse.includes('/')
      ? { providerID: modelToUse.split('/')[0], modelID: modelToUse.split('/').slice(1).join('/') }
      : { providerID: modelToUse, modelID: modelToUse };

    const payload: any = {
      parts: [
        { type: 'text', text: prompt }
      ]
    };
    // Chỉ gửi model khi khác trống; để Serve tự chọn nếu không có
    if (modelToUse && modelToUse !== 'default') {
      payload.model = modelObj;
    }

    this.pushOACEvent({ kind: 'in', prompt: prompt.length > 4000 ? prompt.slice(0, 4000) + '\n…(truncated)' : prompt });

    // 3. Gửi message qua HTTP
    let res: any;
    try {
      res = await OpenCodeServeClient.sendHttpMessage(this.serverUrl, this.sessionId, payload);
    } catch (e: any) {
      const hint = (e && e.message && e.message.includes('HTTP')) ? e.message : `OpenCode Serve reply failed: ${e?.message || e}`;
      // Gửi message thất bại — trả AgentMessage lỗi để orchestrator biết thay vì nuốt im lặng
      throw new Error(`[${this.config.name} HTTP] ${hint}`);
    }

    let content = '';
    const parts: MessagePart[] = [];
    // 4. Parse toàn bộ part của response: text + thinking + tool (giống parseJsonlEvents)
    if (res && Array.isArray(res.parts)) {
      for (const p of res.parts) {
        const type = String(p.type || '').toLowerCase();
        if ((type === 'text' || type === 'reasoning' || type === 'thinking' || type === 'thought')) {
          if (type !== 'text') {
            parts.push({ type: 'thinking', content: p.text || '' });
          } else if (typeof p.text === 'string' && p.text) {
            content += p.text;
            parts.push({ type: 'text', content: p.text });
          }
        } else if (type === 'tool_use' || type === 'tool_call') {
          const tool = p.name || p.tool || 'tool';
          const rawInput = p.state?.input ?? p.input ?? p.args;
          const rawOutput = p.state?.output ?? p.output;
          parts.push({
            type: 'tool',
            tool,
            callId: p.id ?? p.callID,
            input: typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput ?? ''),
            ...(rawOutput ? { output: typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput) } : {})
          });
        }
      }
    } else if (res && typeof res.content === 'string') {
      content = res.content;
    }

    return {
      id: uuidv4(),
      from: this.config.id,
      to: 'orchestrator',
      content: content || '(HTTP response)',
      timestamp: Date.now(),
      parts: parts.length > 0 ? parts : undefined
    };
  }

  // ============ STREAM PARSING & HELPERS ============

  private handleStdoutStream(chunk: string) {
    this.lineBuf += chunk;
    const lines = this.lineBuf.split(/\r?\n/);
    this.lineBuf = lines.pop() || '';

    for (const ln of lines) {
      const trimmed = ln.trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;
      try {
        const ev = JSON.parse(trimmed);
        this.pushOACEvent({ kind: 'out', event: ev });
      } catch {}
    }
  }

  private pushOACEvent(ev: { kind: 'in' | 'out'; prompt?: string; event?: any }) {
    if (!this.onEvent) return;
    const item = { seq: ++this.eventSeq, ...ev };
    this.eventBuf.push(item);
    if (!this.eventTimer) {
      this.eventTimer = setTimeout(() => {
        const flushed = this.eventBuf.splice(0);
        this.eventTimer = null;
        for (const it of flushed) this.onEvent?.(it);
      }, 50);
    }
  }

  private stopOACEvents() {
    if (this.eventTimer) {
      clearTimeout(this.eventTimer);
      this.eventTimer = null;
    }
    if (this.eventBuf.length > 0) {
      const flushed = this.eventBuf.splice(0);
      for (const it of flushed) this.onEvent?.(it);
    }
  }

  private parseJsonlEvents(stdout: string): {
    content: string;
    transcript: string;
    sessionId?: string;
    toolCalls: ToolCallInfo[];
    tokenUsage?: TokenUsage;
    contextLength?: number;
    thinking?: string;
    parts?: MessagePart[];
    firstEventTimestamp?: number;
  } {
    let content = '';
    let transcript = '';
    let sessionId: string | undefined;
    const toolCalls: ToolCallInfo[] = [];
    let tokenUsage: TokenUsage | undefined;
    let contextLength: number | undefined;
    let thinking = '';
    const parts: MessagePart[] = [];
    let firstEventTimestamp: number | undefined;

    const lines = stdout.split(/\r?\n/);
    for (const ln of lines) {
      const trimmed = ln.trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;
      try {
        const ev = JSON.parse(trimmed);
        if (ev.sessionID || ev.sessionId) {
          sessionId = ev.sessionID || ev.sessionId;
        }
        // Extract timestamp from first event
        if (ev.timestamp && !firstEventTimestamp) {
          firstEventTimestamp = ev.timestamp;
        }
        // OpenCode Serve trả event JSON dạng { type, part:{...} } — mọi nội dung (text,
        // thinking, tool) nằm trong ev.part (khác với dạng { type, text } của CLI thường).
        // Đọc từ ev.part trước rồi fallback ev.text để tương thích cả 2 cấu trúc (giống ACPClient).
        const evType = String(ev.type || ev.evt || '').toLowerCase().replace(/-/g, '_');
        if (evType === 'text' || evType === 'assistant') {
          const txt = ev.part?.text ?? ev.text ?? ev.message ?? ev.content;
          if (typeof txt === 'string' && txt) {
            content += txt;
            parts.push({ type: 'text', content: txt });
          }
        } else if (evType === 'thinking' || evType === 'reasoning' || evType === 'thought') {
          const rt = ev.part?.text ?? ev.text ?? ev.part?.thinking ?? ev.thinking;
          if (typeof rt === 'string' && rt) {
            thinking += rt;
            parts.push({ type: 'thinking', content: rt });
          }
        } else if (evType === 'tool_use' || evType === 'tool_call') {
          const p = ev.part ?? ev;
          const tool = p.tool || p.name || ev.tool || ev.name || 'tool';
          const rawInput = p.state?.input ?? p.input ?? ev.input ?? ev.args ?? p.args;
          const rawOutput = p.state?.output ?? p.output ?? ev.output;
          const callId = p.id ?? p.callID ?? ev.id;
          toolCalls.push({
            tool,
            input: typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput ?? ''),
            output: rawOutput !== undefined ? (typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput)) : undefined
          });
          parts.push({
            type: 'tool',
            tool,
            callId,
            input: typeof rawInput === 'string' ? rawInput : (rawInput != null ? JSON.stringify(rawInput) : rawInput),
            output: typeof rawOutput === 'string' ? rawOutput : (rawOutput != null ? JSON.stringify(rawOutput) : rawOutput)
          });
        } else if (evType === 'tool_result' || evType === 'tool') {
          const p = ev.part ?? ev;
          const callId = p.callID || p.call_id || p.id || p.state?.callID || p.state?.id || ev.callID || ev.id;
          const rawOutput = p.state?.output ?? p.output ?? p.content ?? ev.data?.output;
          let matchedPart: MessagePart | undefined;
          if (callId) {
            matchedPart = [...parts].reverse().find(part => part.type === 'tool' && part.callId === String(callId));
          }
          if (!matchedPart) {
            matchedPart = [...parts].reverse().find(part => part.type === 'tool' && part.output === undefined);
          }
          if (matchedPart) {
            matchedPart.output = rawOutput;
          }
          const lastTc = toolCalls[toolCalls.length - 1];
          if (lastTc && !lastTc.output && rawOutput !== undefined) {
            lastTc.output = typeof rawOutput === 'string' ? rawOutput : (typeof rawOutput === 'object' ? JSON.stringify(rawOutput) : String(rawOutput));
          }
        }
        // Token usage: ưu tiên ev.part.tokens (step_finish trong attach trả dạng này)
        const tokenSrc = ev.part?.tokens ?? ev.part?.usage ?? ev.tokens ?? ev.usage;
        if (tokenSrc) {
          const u = tokenSrc;
          tokenUsage = {
            input: u.input ?? u.inputTokens ?? u.prompt_tokens ?? 0,
            output: u.output ?? u.outputTokens ?? u.completion_tokens ?? 0,
            cacheReadTokens: u.cache?.read ?? u.cacheReadTokens ?? 0,
            cacheWriteTokens: u.cache?.write ?? u.cacheWriteTokens ?? 0
          };
        }
      } catch {}
    }

    return { content, transcript, sessionId, toolCalls, tokenUsage, contextLength, thinking, parts, firstEventTimestamp };
  }

  public async compactSession(sid?: string): Promise<boolean> {
    const targetSid = sid || this.sessionId;
    if (!targetSid) return false;
    try {
      await this.enqueue('/compact');
      return true;
    } catch {
      return false;
    }
  }

  public async deleteSession(sid?: string): Promise<boolean> {
    const targetSid = sid || this.sessionId;
    if (!targetSid) return false;
    const ok = await OpenCodeServeClient.deleteSessionHttp(this.serverUrl, targetSid);
    if (targetSid === this.sessionId) {
      this.sessionId = null;
      OpenCodeServeClient.unregisterSession(this.config.id);
    }
    return ok;
  }
}
