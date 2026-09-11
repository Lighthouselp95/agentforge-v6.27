// src/agents/opencode-sse-gate.ts
// Real-time SSE Gate Module for OpenCode Serve
// Biên dịch luồng SSE (Server-Sent Events) từ OpenCode Serve (GET /event)
// sang các streaming event thời gian thực chuẩn của AgentForge (textDelta, thinking, tool_use).

import http from 'http';
import https from 'https';
import { StringDecoder } from 'string_decoder';

export type SSETranslatedEvent = 
  | { type: 'text'; sessionID: string; part: { type: 'text'; text: string; id?: string } }
  | { type: 'reasoning'; sessionID: string; part: { type: 'reasoning'; text: string; thinking: string; id?: string } }
  | { type: 'tool_use'; sessionID: string; part: { type: 'tool'; tool: string; callID?: string; state?: { input?: any; output?: any } } }
  | { type: 'step_finish'; sessionID: string; part: { tokens: any } }
  | { type: 'session_idle'; sessionID: string }
  | { type: 'session_error'; sessionID: string; error?: any };

export type SSEEventListener = (event: SSETranslatedEvent) => void;

export class OpenCodeSSEGate {
  private static instance: OpenCodeSSEGate | null = null;

  private serverUrl: string = 'http://127.0.0.1:4096';
  private req: http.ClientRequest | null = null;
  private isConnected: boolean = false;
  private isConnecting: boolean = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private retryCount: number = 0;

  // Session subscribers: sessionID -> Set<listener>
  private subscribers = new Map<string, Set<SSEEventListener>>();
  // Global listeners (nhận toàn bộ event đã dịch)
  private globalSubscribers = new Set<SSEEventListener>();
  // Danh sách ID các message có role='user' để chặn stream ngược user prompt
  private userMessageIds = new Set<string>();

  // Bộ nhớ theo dõi độ dài text đã phát để tính delta chính xác từng token
  // Key format: `${sessionID}:${partId}`
  private partTextLengths = new Map<string, number>();
  private partThinkingLengths = new Map<string, number>();

  // Đánh dấu session đã stream được ít nhất 1 token hay chưa
  private streamedSessions = new Set<string>();

  // Buffer đọc SSE stream
  private buffer: string = '';
  private decoder = new StringDecoder('utf8');

  private constructor() {}

  public static getInstance(): OpenCodeSSEGate {
    if (!OpenCodeSSEGate.instance) {
      OpenCodeSSEGate.instance = new OpenCodeSSEGate();
    }
    return OpenCodeSSEGate.instance;
  }

  /**
   * Đảm bảo gate đã kết nối tới OpenCode Serve SSE endpoint (/event)
   */
  public ensureConnected(serverUrl?: string): void {
    if (serverUrl) {
      const clean = serverUrl.replace(/\/$/, '');
      if (clean !== this.serverUrl) {
        this.serverUrl = clean;
        // Đổi URL server -> đóng kết nối cũ để kết nối lại
        this.disconnect();
      }
    }

    if (this.isConnected || this.isConnecting) return;
    this.connect();
  }

  /**
   * Đăng ký lắng nghe các event đã biên dịch cho một session cụ thể
   */
  public subscribe(sessionId: string, listener: SSEEventListener): () => void {
    this.ensureConnected();

    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, new Set());
    }
    this.subscribers.get(sessionId)!.add(listener);

    // Reset trạng thái stream cho session này
    this.streamedSessions.delete(sessionId);

    return () => {
      this.unsubscribe(sessionId, listener);
    };
  }

  /**
   * Hủy đăng ký listener của session
   */
  public unsubscribe(sessionId: string, listener: SSEEventListener): void {
    const subs = this.subscribers.get(sessionId);
    if (subs) {
      subs.delete(listener);
      if (subs.size === 0) {
        this.subscribers.delete(sessionId);
        this.cleanupSession(sessionId);
      }
    }
  }

  /**
   * Kiểm tra session này đã có token nào được stream qua SSE chưa
   */
  public hasStreamed(sessionId: string): boolean {
    return this.streamedSessions.has(sessionId);
  }

  /**
   * Dọn dẹp cache đếm delta cho session khi turn kết thúc
   */
  public cleanupSession(sessionId: string): void {
    for (const key of Array.from(this.partTextLengths.keys())) {
      if (key.startsWith(`${sessionId}:`)) {
        this.partTextLengths.delete(key);
      }
    }
    for (const key of Array.from(this.partThinkingLengths.keys())) {
      if (key.startsWith(`${sessionId}:`)) {
        this.partThinkingLengths.delete(key);
      }
    }
    this.streamedSessions.delete(sessionId);
  }

  /**
   * Đăng ký listener toàn cục
   */
  public onGlobal(listener: SSEEventListener): () => void {
    this.ensureConnected();
    this.globalSubscribers.add(listener);
    return () => {
      this.globalSubscribers.delete(listener);
    };
  }

  /**
   * Khởi tạo kết nối HTTP SSE tới OpenCode Serve
   */
  private connect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.isConnecting = true;
    const urlStr = `${this.serverUrl}/event`;

    try {
      const parsedUrl = new URL(urlStr);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      };

      const req = client.request(options, (res) => {
        if (res.statusCode !== 200) {
          this.isConnecting = false;
          this.isConnected = false;
          res.resume();
          this.scheduleReconnect();
          return;
        }

        this.isConnected = true;
        this.isConnecting = false;
        this.retryCount = 0;
        this.buffer = '';

        res.setEncoding('utf8');

        res.on('data', (chunk: string) => {
          this.buffer += chunk;
          let boundary: number;
          // SSE events được phân tách bởi \n\n hoặc \r\n\r\n
          while ((boundary = this.findEventBoundary(this.buffer)) !== -1) {
            const rawEvent = this.buffer.slice(0, boundary);
            this.buffer = this.buffer.slice(boundary + (this.buffer.startsWith('\r\n\r\n', boundary) ? 4 : 2));
            this.parseSSEFrame(rawEvent);
          }
        });

        res.on('end', () => {
          this.isConnected = false;
          this.isConnecting = false;
          this.scheduleReconnect();
        });

        res.on('error', () => {
          this.isConnected = false;
          this.isConnecting = false;
          this.scheduleReconnect();
        });
      });

      req.on('error', () => {
        this.isConnected = false;
        this.isConnecting = false;
        this.scheduleReconnect();
      });

      req.setTimeout(0); // Vô hiệu hóa timeout socket, duy trì stream
      req.end();
      this.req = req;
    } catch {
      this.isConnected = false;
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private findEventBoundary(str: string): number {
    const idx1 = str.indexOf('\n\n');
    const idx2 = str.indexOf('\r\n\r\n');
    if (idx1 === -1) return idx2;
    if (idx2 === -1) return idx1;
    return Math.min(idx1, idx2);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.retryCount++;
    const delay = Math.min(1000 * Math.pow(1.5, Math.min(this.retryCount, 6)), 15000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Phân tích một khối SSE frame (gồm các dòng event, data, id)
   */
  private parseSSEFrame(frame: string): void {
    const lines = frame.split(/\r?\n/);
    let dataPayload = '';

    for (const line of lines) {
      if (line.startsWith('data:')) {
        const val = line.slice(5).trim();
        dataPayload = dataPayload ? `${dataPayload}\n${val}` : val;
      }
    }

    if (!dataPayload) return;

    try {
      const parsed = JSON.parse(dataPayload);
      this.compileAndDispatch(parsed);
    } catch {
      // Bỏ qua nếu dòng JSON không hợp lệ
    }
  }

  /**
   * BỘ BIÊN DỊCH SSE:
   * Chuyển đổi OpenCode internal event -> AgentForge translated event
   */
  private compileAndDispatch(rawEv: any): void {
    if (!rawEv || typeof rawEv !== 'object') return;

    const eventType = String(rawEv.type || rawEv.evt || '').toLowerCase();
    const props = rawEv.properties || rawEv.props || {};
    const sessionID = String(props.sessionID || rawEv.sessionID || rawEv.sessionId || '');

    // Nếu không xác định được sessionID, bỏ qua vì không thể định tuyến
    if (!sessionID) return;

    // Ghi nhận message role: Nếu message có role='user', lưu ID để không stream bất kỳ part nào của message này
    if (eventType === 'message.updated' || eventType === 'message.created') {
      const msgInfo = props.message || props.info || props;
      const mId = String(msgInfo.id || '');
      const mRole = String(msgInfo.role || '').toLowerCase();
      if (mId && mRole === 'user') {
        this.userMessageIds.add(mId);
      }
    }

    // 1. Biên dịch Event message.part.updated / message.part.delta (STREAM TOKEN CHÍNH)
    if (eventType === 'message.part.updated' || eventType === 'message.part.delta') {
      const messageId = String(props.messageID || props.messageId || rawEv.messageID || '');
      // Bỏ qua nếu part này thuộc về tin nhắn của người dùng / prompt
      if (messageId && this.userMessageIds.has(messageId)) {
        return;
      }

      const part = props.part || rawEv.part || {};
      const partType = String(part.type || '').toLowerCase();
      const partId = String(part.id || part.callID || part.call_id || 'default');
      const cacheKey = `${sessionID}:${partId}`;

      // A. Biên dịch Text Token Delta
      if (partType === 'text') {
        const rawText = typeof part.text === 'string' ? part.text : (typeof part.delta === 'string' ? part.delta : '');
        
        // CHẶN TUYỆT ĐỐI PROMPT LEAK: Không bao giờ stream user prompt, task header, team wrapper
        if (rawText.startsWith('[YOUR TASKS STATUS]') ||
            rawText.includes('=== INCOMING MESSAGE ===') ||
            rawText.includes('=== SYSTEM REMINDER ===') ||
            rawText.startsWith('[TASK]') ||
            rawText.includes('[/YOUR TASKS STATUS]')) {
          if (messageId) this.userMessageIds.add(messageId);
          return;
        }

        // Lọc thẻ think nếu model lỡ leak
        const cleanText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '');

        const prevLen = this.partTextLengths.get(cacheKey) || 0;
        if (cleanText.length > prevLen) {
          const delta = cleanText.slice(prevLen);
          this.partTextLengths.set(cacheKey, cleanText.length);
          this.streamedSessions.add(sessionID);

          const translated: SSETranslatedEvent = {
            type: 'text',
            sessionID,
            part: {
              type: 'text',
              text: delta,
              id: partId
            }
          };
          this.dispatch(sessionID, translated);
        }
      }
      // B. Biên dịch Thinking / Reasoning Token Delta
      else if (partType === 'reasoning' || partType === 'thinking' || partType === 'thought') {
        const rawThinking = typeof part.text === 'string' ? part.text : (typeof part.thinking === 'string' ? part.thinking : '');
        const prevLen = this.partThinkingLengths.get(cacheKey) || 0;
        if (rawThinking.length > prevLen) {
          const delta = rawThinking.slice(prevLen);
          this.partThinkingLengths.set(cacheKey, rawThinking.length);
          this.streamedSessions.add(sessionID);

          const translated: SSETranslatedEvent = {
            type: 'reasoning',
            sessionID,
            part: {
              type: 'reasoning',
              text: delta,
              thinking: delta,
              id: partId
            }
          };
          this.dispatch(sessionID, translated);
        }
      }
      // C. Biên dịch Tool Call
      else if (partType === 'tool' || partType === 'tool_use' || partType === 'tool_call') {
        const tool = part.tool || part.name || 'tool';
        const callID = part.callID || part.id || part.call_id;
        const rawInput = part.state?.input ?? part.input ?? part.args;
        const rawOutput = part.state?.output ?? part.output;

        this.streamedSessions.add(sessionID);
        const translated: SSETranslatedEvent = {
          type: 'tool_use',
          sessionID,
          part: {
            type: 'tool',
            tool,
            callID,
            state: { input: rawInput, output: rawOutput }
          }
        };
        this.dispatch(sessionID, translated);
      }
      // D. Biên dịch Step Finish (Token Usage)
      else if (partType === 'step-finish' || partType === 'step_finish') {
        const tokens = part.tokens || part.usage || props.tokens;
        if (tokens) {
          const translated: SSETranslatedEvent = {
            type: 'step_finish',
            sessionID,
            part: { tokens }
          };
          this.dispatch(sessionID, translated);
        }
      }
    }
    // 2. Biên dịch Trạng thái Session (idle, error)
    else if (eventType === 'session.idle') {
      const translated: SSETranslatedEvent = { type: 'session_idle', sessionID };
      this.dispatch(sessionID, translated);
      this.cleanupSession(sessionID);
    } else if (eventType === 'session.error') {
      const translated: SSETranslatedEvent = {
        type: 'session_error',
        sessionID,
        error: props.error || rawEv.error
      };
      this.dispatch(sessionID, translated);
      this.cleanupSession(sessionID);
    }
  }

  /**
   * Định tuyến event tới đúng subscribers của session và global subscribers
   */
  private dispatch(sessionID: string, event: SSETranslatedEvent): void {
    const subs = this.subscribers.get(sessionID);
    if (subs && subs.size > 0) {
      for (const listener of subs) {
        try {
          listener(event);
        } catch {}
      }
    }

    if (this.globalSubscribers.size > 0) {
      for (const listener of this.globalSubscribers) {
        try {
          listener(event);
        } catch {}
      }
    }
  }

  /**
   * Đóng gate và giải phóng tài nguyên
   */
  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.req) {
      try {
        this.req.destroy();
      } catch {}
      this.req = null;
    }
    this.isConnected = false;
    this.isConnecting = false;
    this.buffer = '';
  }
}

export const opencodeSSEGate = OpenCodeSSEGate.getInstance();
