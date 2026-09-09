import { WebSocketServer, WebSocket } from 'ws';

export interface WebSocketServiceOptions {
  heartbeatIntervalMs?: number;
}

export class WebSocketService {
  private wss: WebSocketServer;
  private wsClients: Set<WebSocket>;
  private heartbeatIntervalMs: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(wss: WebSocketServer, wsClients: Set<WebSocket>, options: WebSocketServiceOptions = {}) {
    this.wss = wss;
    this.wsClients = wsClients;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 45000;
  }

  public init(): void {
    this.wss.on('error', (err: any) => {
      console.error(`[WS] WebSocket server error:`, err?.message || err);
    });

    this.wss.on('connection', (ws: WebSocket, req: any) => {
      // Ép tắt Nagle algorithm để truyền gói tin thời gian thực không độ trễ
      const underlyingSocket = (ws as any)._socket || req?.socket;
      if (underlyingSocket && typeof underlyingSocket.setNoDelay === 'function') {
        try { underlyingSocket.setNoDelay(true); } catch {}
      }

      this.wsClients.add(ws);
      (ws as any)._isAlive = true;
      (ws as any)._connectedAt = Date.now();
      (ws as any)._clientIp = req?.socket?.remoteAddress || 'unknown';

      // Extract teamId and log subscriber flag from query params e.g. ws://host/?teamId=xyz&logs=1
      try {
        if (req && req.url) {
          const urlObj = new URL(req.url, 'http://localhost');
          const tId = urlObj.searchParams.get('teamId');
          if (tId) (ws as any).teamId = tId;
          else (ws as any).teamId = 'default'; // Đặt default teamId nếu không có
          if (urlObj.pathname === '/terminal' || urlObj.pathname.startsWith('/terminal/') || urlObj.searchParams.get('logs') === '1' || urlObj.searchParams.get('channel') === 'terminal') {
            (ws as any).isLogSubscriber = true;
          }
        }
      } catch {}

      ws.on('message', (raw: any) => {
        try {
          const parsed = JSON.parse(raw.toString());
          if (parsed && typeof parsed === 'object') {
            if (parsed.type === 'subscribe') {
              if (parsed.teamId) (ws as any).teamId = parsed.teamId;
              else (ws as any).teamId = 'default'; // Đặt default teamId nếu không có
              if (parsed.logs || parsed.subscribeLogs || parsed.channel === 'terminal' || parsed.channel === 'logs') {
                (ws as any).isLogSubscriber = true;
              }
            } else if (parsed.type === 'unsubscribe') {
              if (parsed.logs || parsed.channel === 'terminal' || parsed.channel === 'logs') {
                (ws as any).isLogSubscriber = false;
              }
            }
          }
        } catch {}
      });

      ws.on('pong', () => {
        (ws as any)._isAlive = true;
      });
      ws.on('close', () => this.wsClients.delete(ws));
      ws.on('error', () => {
        try {
          ws.terminate();
        } catch {}
      });
    });

    this.startHeartbeat();
  }

  public startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.wss.clients.forEach((c: any) => {
        if (c._isAlive === false) {
          const durationSec = c._connectedAt ? Math.round((Date.now() - c._connectedAt) / 1000) : 0;
          const clientInfo = `ip=${c._clientIp || 'unknown'}, teamId=${c.teamId || 'unknown'}, duration=${durationSec}s`;
          console.warn(`[WS Heartbeat] Terminating inactive connection (${clientInfo}) - missing pong`);
          try {
            c.terminate();
          } catch {}
          return;
        }
        c._isAlive = false;
        try {
          c.ping();
        } catch {}
      });
    }, this.heartbeatIntervalMs);
    (this.heartbeatTimer as any).unref?.();
  }

  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Broadcast payload tới tất cả kết nối WS hoặc có lọc theo teamId.
   * Team Isolation (khớp semantics src/server.ts broadcast):
   * - Nếu event có teamId (filterTeamId > data.teamId > data.msg.teamId): 
   *   client team-specific chỉ nhận event đúng team; client 'default'/'all' (supervisor) nhận tất cả.
   * - Nếu event KHÔNG có teamId → chặn (tránh leak cross-team), trừ system events global.
   */
  public broadcast(type: string, data: any, filterTeamId?: string): void {
    const isLogMsg = type === 'terminal:line' || type === 'log:entry';

    // Resolve effective teamId từ filterTeamId > data.teamId > data.msg.teamId
    let effectiveTeamId = filterTeamId || data?.teamId;
    if (!effectiveTeamId && data?.msg?.teamId) effectiveTeamId = data.msg.teamId;
    if (!effectiveTeamId && data?.agent?.teamId) effectiveTeamId = data.agent.teamId;

    // System events (system:started, agent:updated, team-settings) được phép broadcast broad (không teamId)
    const isSystemBroad = type.startsWith('system:') || type === 'agent:updated' || type === 'team-settings:updated';

    // Chặn event thường thiếu teamId (same policy as server.ts broadcast line 841)
    if (!effectiveTeamId && !isSystemBroad) {
      console.log(`[WS] Bỏ qua broadcast không có teamId (tránh leak): type=${type}`);
      return;
    }

    const payload = JSON.stringify({ type, data, timestamp: Date.now() });
    for (const ws of this.wsClients) {
      if (ws.readyState === 1) { // WebSocket.OPEN = 1
        if (isLogMsg && !(ws as any).isLogSubscriber) {
          continue;
        }
        const wsTeam = (ws as any).teamId;
        // Giữ nguyên semantics: 'default' và 'all' client = supervisor nhận toàn bộ system.
        // Client team-specific (wsTeam !== default/all) chỉ nhận event đúng team của mình.
        if (effectiveTeamId && wsTeam && wsTeam !== 'default' && wsTeam !== 'all' && wsTeam !== effectiveTeamId) {
          continue;
        }
        try {
          ws.send(payload);
        } catch {}
      }
    }
  }

  public getClientsCount(): number {
    return this.wsClients.size;
  }
}
