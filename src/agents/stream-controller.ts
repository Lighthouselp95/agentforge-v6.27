// src/agents/stream-controller.ts
/**
 * Lớp StreamController tổng hợp cho cả 3 luồng: CLI (dòng lệnh thông thường),
 * ATTACH (dòng lệnh kèm gắn), và HTTP (REST).
 *
 * Mục tiêu: chuẩn hóa 3 luồng thành cùng một interface cho tính năng chống nháy start/stop
 * và duplicate event. Mỗi luồng cho ra cùng một bộ sự kiện:
 *   - stream:start(agentId, sessionId, metadata)
 *   - stream:chunk(event)
 *   - stream:end(agentId, sessionId, metadata)
 *
 * Chỉ một luồng duy nhất được phát mỗi sự kiện, đảm bảo UI chỉ nhận được một trạng thái agent:
 *   - "working" khi stream:start, đưa về "idle" sau khoảng delay ổn định (debounce ~500ms).
 *   - Chặn render 2 lần bằng cách gộp cùng một event/message vào một chunk.
 *
 * Thiết kế:
 *   - AttachStreamController: wrapper cho OpenCodeServeClient (chế độ attach).
 *   - CliStreamController: triển khai CLI bằng child_process spawn + JSONL parse.
 *   - HttpStreamController: triển khai HTTP SSE.
 *
 * Gắn kết với core/state-machine cho hàng đợi task_update (working→completed).
 * Feature flag USE_V8_CORE=false mặc định — không ảnh hưởng production v7.0.55.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { join } from 'path';
import { Writable } from 'stream';
import type { Agent } from './agent-manager.js';
import type { MessagePart } from './types.js';
import type { AgentStatusManager } from '../core/state-machine.js';
import { watchdogManager } from '../core/watchdog.js';

// ============ Loại sự kiện ============
export enum StreamEventType {
  START = 'stream:start',
  CHUNK = 'stream:chunk',
  END = 'stream:end'
}

export interface StreamChunk {
  type: StreamEventType.CHUNK;
  agentId: string;
  sessionId?: string;
  timestamp: number;
  source: 'cli' | 'attach' | 'http';
  raw?: string;
  payload: {
    kind: 'text' | 'tool_call' | 'thinking' | 'tool_result' | 'metadata';
    text?: string;
    tool?: {
      name: string;
      input: any;
      output: any;
      id?: string;
    };
    thinking?: string;
    metadata?: Record<string, any>;
  };
}

export interface StreamEvent {
  type: StreamEventType;
  agentId: string;
  sessionId?: string;
  timestamp: number;
  source: 'cli' | 'attach' | 'http';
  metadata?: Record<string, any>;
}

// ============ Interface chung ============
export interface StreamClient {
  start(agentId: string, prompt: string, sessionId?: string): Promise<void>;
  stop(): void;
  isRunning(): boolean;
}

// ============ StreamController cơ sở ============
export abstract class StreamController extends EventEmitter {
  protected abstract readonly source: 'cli' | 'attach' | 'http';
  private stableStatusSet = new Set<string>();
  private statusTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    protected agentStatusManager: AgentStatusManager,
    protected broadcast: (type: string, data: any) => void,
    protected storage: any
  ) {
    super();
  }

  public async startStream(agentId: string, sessionId?: string): Promise<void> {
    this.stableStatusSet.add(agentId);
    const timestamp = Date.now();
    const event: StreamEvent = {
      type: StreamEventType.START,
      agentId,
      sessionId,
      timestamp,
      source: this.source,
      metadata: { turn: 0 }
    };
    this.broadcast(StreamEventType.START, event);
    await this.agentStatusManager.dispatchTaskUpdate(
      agentId, 'working', `stream-${Date.now()}`,
      `<task_update agent="${agentId}" task="stream" status="working" />`
    );
    this.scheduleIdle(agentId, 500);
  }

  public emitChunk(agentId: string, raw: string, payload: StreamChunk['payload']): void {
    // Notify watchdog of stream activity (resets 30s inactivity timer)
    watchdogManager.onStreamActivity(agentId);

    // LIVE STREAM CHUNK-BY-CHUNK: nội dung text được tách thành TỪNG KÝ TỰ riêng lẻ
    // (thay vì gói thành block lớn) để UI render mượt theo thời gian thực.
    if (payload.kind === 'text' && payload.text) {
      const textChars = Array.from(payload.text);
      for (const ch of textChars) {
        const chunk: StreamChunk = {
          type: StreamEventType.CHUNK,
          agentId,
          timestamp: Date.now(),
          source: this.source,
          raw,
          payload: { kind: 'text', text: ch }
        };
        this.broadcast(StreamEventType.CHUNK, chunk);
      }
    } else {
      // Non-text (thinking / tool_call / tool_result / metadata): gửi nguyên chunk
      const chunk: StreamChunk = {
        type: StreamEventType.CHUNK,
        agentId,
        timestamp: Date.now(),
        source: this.source,
        raw,
        payload
      };
      this.broadcast(StreamEventType.CHUNK, chunk);
    }

    if (this.stableStatusSet.has(agentId)) {
      this.scheduleIdle(agentId, 500);
    }
  }

  public async endStream(agentId: string, sessionId?: string): Promise<void> {
    this.stableStatusSet.delete(agentId);
    const event: StreamEvent = {
      type: StreamEventType.END,
      agentId,
      sessionId,
      timestamp: Date.now(),
      source: this.source,
      metadata: { turn: 1 }
    };
    this.broadcast(StreamEventType.END, event);
    await this.agentStatusManager.dispatchTaskUpdate(
      agentId, 'completed', `stream-${Date.now()}`,
      `<task_update agent="${agentId}" task="stream" status="completed" />`
    );
    this.clearIdleTimeout(agentId);
    this.removeAllListeners();
  }

  protected scheduleIdle(agentId: string, delay: number): void {
    this.clearIdleTimeout(agentId);
    const t = setTimeout(() => {
      if (this.stableStatusSet.has(agentId)) {
        this.stableStatusSet.delete(agentId);
        this.agentStatusManager.dispatchTaskUpdate(
          agentId, 'completed', `idle-timeout-${Date.now()}`,
          `<task_update agent="${agentId}" task="stream" status="completed" />`
        );
      }
    }, delay);
    this.statusTimeouts.set(agentId, t);
  }

  protected clearIdleTimeout(agentId: string): void {
    const t = this.statusTimeouts.get(agentId);
    if (t) { clearTimeout(t); this.statusTimeouts.delete(agentId); }
  }

  protected parseJsonlLine(line: string): StreamChunk['payload'] | null {
    let obj: any;
    try { obj = JSON.parse(line); } catch { return null; }
    if (!obj || typeof obj !== 'object') return null;

    // OpenCode JSONL event types
    if (obj.type === 'text' || obj.kind === 'text') {
      return { kind: 'text', text: String(obj.content ?? obj.text ?? '') };
    }
    if (obj.type === 'thinking' || obj.kind === 'thinking') {
      return { kind: 'thinking', thinking: String(obj.content ?? '') };
    }
    if (obj.type === 'tool_call' || obj.kind === 'tool_call' || obj.tool) {
      return {
        kind: 'tool_call',
        tool: {
          name: obj.tool?.name ?? obj.name ?? 'unknown',
          input: typeof obj.tool?.input === 'string' ? obj.tool.input : (obj.tool?.input ?? obj.input ?? '{}'),
          output: typeof obj.tool?.output === 'string' ? obj.tool.output : (obj.tool?.output ?? obj.output ?? ''),
          id: obj.tool?.id ?? obj.id
        }
      };
    }
    if (obj.type === 'tool_result' || obj.kind === 'tool_result' || obj.result) {
      return {
        kind: 'tool_result',
        tool: {
          name: obj.tool ?? obj.name ?? 'unknown',
          input: '{}',
          output: typeof obj.result === 'string' ? obj.result : JSON.stringify(obj.result ?? '')
        }
      };
    }
    if (obj.type === 'metadata' || obj.kind === 'metadata') {
      return { kind: 'metadata', metadata: obj };
    }

    // Fallback: content field
    if (obj.content !== undefined) {
      return { kind: 'text', text: String(obj.content) };
    }
    return null;
  }
}

// ============ AttachStreamController (wrapper OpenCodeServeClient) ============
export class AttachStreamController extends StreamController {
  readonly source: 'attach' = 'attach';
  private client: any = null;
  private running = false;

  constructor(
    agentStatusManager: AgentStatusManager,
    broadcast: (type: string, data: any) => void,
    storage: any,
    private opencodeServeClientClass: new (config: any, opts: any) => any
  ) {
    super(agentStatusManager, broadcast, storage);
  }

  public async start(agentId: string, prompt: string, sessionId?: string): Promise<void> {
    if (this.running) {
      console.warn('[AttachStream] Already running, skipping start');
      return;
    }
    this.running = true;
    await this.startStream(agentId, sessionId);

    try {
      // Import động để tránh circular dependency
      const { OpenCodeServeClient } = await import('./opencode-serve-client.js');
      this.client = new OpenCodeServeClient(
        { id: agentId, name: agentId, role: 'worker', type: 'worker' },
        { mode: 'attach', serverUrl: process.env.OPENCODE_SERVE_URL || 'http://127.0.0.1:4096' }
      );

      // Wrap client.parseJsonlEvents để emit chunks
      const origHandler = (this.client as any).onChunk;
      (this.client as any).onChunk = (ev: any) => {
        const raw = JSON.stringify(ev);
        const payload = this.parseJsonlLine(raw);
        if (payload) this.emitChunk(agentId, raw, payload);
        if (origHandler) origHandler.call(this.client, ev);
      };

      const result = await this.client.run(prompt);
      await this.endStream(agentId, result?.sessionId ?? sessionId);
    } catch (err) {
      console.error('[AttachStream] Error:', err);
      await this.endStream(agentId, sessionId);
    } finally {
      this.running = false;
      this.client = null;
    }
  }

  public stop(): void {
    if (this.client) {
      try { this.client.abort(); } catch {}
    }
    this.running = false;
  }

  public isRunning(): boolean { return this.running; }
}

// ============ CliStreamController (child_process spawn) ============
export class CliStreamController extends StreamController {
  readonly source: 'cli' = 'cli';
  private proc: ChildProcess | null = null;
  private running = false;
  private buffer = '';
  private agentId = '';

  constructor(
    agentStatusManager: AgentStatusManager,
    broadcast: (type: string, data: any) => void,
    storage: any,
    private opencodeBin?: string,
    private projectDir?: string
  ) {
    super(agentStatusManager, broadcast, storage);
  }

  public async start(agentId: string, prompt: string, sessionId?: string): Promise<void> {
    if (this.running) { this.stop(); }
    this.running = true;
    this.agentId = agentId;
    this.buffer = '';
    await this.startStream(agentId, sessionId);

    const opencodeBin = this.opencodeBin || 'opencode';
    const args = ['run', '--session', sessionId || agentId];
    const opts: any = {
      cwd: this.projectDir || process.cwd(),
       env: { ...process.env, OPENCODE_SERVER_URL: process.env.OPENCODE_SERVE_URL || 'http://127.0.0.1:4096' },
      stdio: ['pipe', 'pipe', 'pipe']
    };

    return new Promise((resolve) => {
      this.proc = spawn(opencodeBin, args, opts);

      this.proc.stdout?.pipe(this.createLineSplitter()).on('data', (line: string) => {
        const payload = this.parseJsonlLine(line);
        if (payload) this.emitChunk(agentId, line, payload);
      });

      this.proc.stderr?.on('data', (chunk: Buffer) => {
        const raw = chunk.toString();
        const payload = this.parseJsonlLine(raw);
        if (payload) this.emitChunk(agentId, raw, payload);
      });

      this.proc.on('close', async (code) => {
        await this.endStream(agentId, sessionId);
        this.running = false;
        this.proc = null;
        resolve();
      });

      this.proc.on('error', async (err) => {
        console.error('[CliStream] Error:', err);
        await this.endStream(agentId, sessionId);
        this.running = false;
        this.proc = null;
        resolve();
      });

      if (this.proc.stdin) {
        this.proc.stdin.write(prompt);
        this.proc.stdin.end();
      }
    });
  }

  public stop(): void {
    if (this.proc) {
      try { this.proc.kill(); } catch {}
      this.proc = null;
    }
    this.running = false;
  }

  public isRunning(): boolean { return this.running; }

  /** Tạo writable stream để split stdout thành từng dòng */
  private createLineSplitter(): Writable {
    let buffer = '';
    const splitter = new Writable({
      write(chunk: Buffer, _enc: string, cb: () => void) {
        const text = chunk.toString();
        let i = 0;
        while (i < text.length) {
          const nl = text.indexOf('\n', i);
          if (nl === -1) { buffer += text.slice(i); break; }
          const line = buffer + text.slice(i, nl).trim();
          buffer = '';
          if (line) (splitter as any).emit('line', line);
          i = nl + 1;
        }
        cb();
      }
    });
    return splitter;
  }
}

// ============ HttpStreamController (SSE) ============
export class HttpStreamController extends StreamController {
  readonly source: 'http' = 'http';
  private abortController: AbortController | null = null;
  private running = false;

  constructor(
    agentStatusManager: AgentStatusManager,
    broadcast: (type: string, data: any) => void,
    storage: any,
    private baseUrl = process.env.OPENCODE_SERVE_URL || 'http://127.0.0.1:4096'
  ) {
    super(agentStatusManager, broadcast, storage);
  }

  public async start(agentId: string, prompt: string, sessionId?: string): Promise<void> {
    if (this.running) this.stop();
    this.running = true;
    this.abortController = new AbortController();
    await this.startStream(agentId, sessionId);

    try {
      const res = await fetch(`${this.baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, sessionId }),
        signal: this.abortController.signal
      });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          const payload = this.parseJsonlLine(line);
          if (payload) this.emitChunk(agentId, line, payload);
        }
      }
      await this.endStream(agentId, sessionId);
    } catch (err) {
      if ((err as any).name !== 'AbortError') {
        console.error('[HttpStream] Error:', err);
      }
      await this.endStream(agentId, sessionId);
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }

  public stop(): void {
    this.abortController?.abort();
    this.running = false;
  }

  public isRunning(): boolean { return this.running; }
}
