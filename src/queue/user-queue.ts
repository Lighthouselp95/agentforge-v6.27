// ============ SERVER-SIDE FIFO USER QUEUE ============
import { v4 as uuidv4 } from 'uuid';

export interface BackendQueuedMsg {
  targetId: string;
  rawMsg: string;
  isSlash: boolean;
  messageId?: string;
  timestamp: number;
  sourceCreatedAt?: number;
  fromAgentId?: string;
  fromAgentName?: string;
  fromAgentRole?: string;
  task?: string;
  msgType?: string;
  reportId?: string;
}

export type DispatchUserChatFn = (params: {
  targetAgentId: string;
  rawMsg: string;
  isSlashCommand: boolean;
  isRetry?: boolean;
  customTurnId?: string;
}) => Promise<any>;

export interface UserQueueOptions {
  dispatchUserChat: DispatchUserChatFn;
  isAgentBusy: (targetId: string) => boolean;
  chatHistory?: any[];
  saveMessage?: (msg: any) => void;
  removeUnprocessedMessage?: (targetId: string, rawMsg: string) => void;
  saveUnprocessedMessage?: (targetId: string, text: string) => void;
  broadcast?: (event: string, payload: any) => void;
  getAgent?: (targetId: string) => any;
  processOrchestratorTriggerQueue?: () => Promise<void>;
  deliverTalk?: (target: any, sender: any, data: any, reportId?: string) => Promise<any>;
}

export class UserQueueManager {
  private backendUserQueues: Record<string, Array<BackendQueuedMsg>> = {};
  private options: UserQueueOptions;
  private static instance: UserQueueManager | null = null;
  private retryTimers: Record<string, any> = {};

  constructor(options: UserQueueOptions) {
    this.options = options;
    UserQueueManager.instance = this;
  }

  public static getInstance(): UserQueueManager | null {
    return UserQueueManager.instance;
  }

  public setOptions(opts: Partial<UserQueueOptions>): void {
    this.options = { ...this.options, ...opts };
  }

  public getAllQueues(): Record<string, Array<BackendQueuedMsg>> {
    return this.backendUserQueues;
  }

  public normalizeQueueKey(targetId?: string): string {
    if (!targetId || targetId === 'orchestrator') return 'orchestrator';
    return targetId;
  }

  public enqueue(msg: BackendQueuedMsg): void {
    const key = this.normalizeQueueKey(msg.targetId);
    // Sử dụng setQueue để đảm bảo Proxy set trap được kích hoạt (gán giá trị cho backendUserQueues[key])
    if (!this.backendUserQueues[key]) {
      this.setQueue(key, []);
    }
    const q = this.backendUserQueues[key] as BackendQueuedMsg[];
    q.push(msg);
  }

  public getQueue(rawTargetId: string): BackendQueuedMsg[] {
    const key = this.normalizeQueueKey(rawTargetId);
    return this.backendUserQueues[key] || [];
  }

  public getQueueLength(rawTargetId: string): number {
    return this.getQueue(rawTargetId).length;
  }

  public hasPending(rawTargetId: string): boolean {
    return this.getQueueLength(rawTargetId) > 0;
  }

  public setQueue(rawTargetId: string, queue: BackendQueuedMsg[]): void {
    const key = this.normalizeQueueKey(rawTargetId);
    this.backendUserQueues[key] = queue;
  }

  public clearQueue(rawTargetId: string): void {
    const key = this.normalizeQueueKey(rawTargetId);
    this.backendUserQueues[key] = [];
  }

  public drainAll(rawTargetId: string): BackendQueuedMsg[] {
    const key = this.normalizeQueueKey(rawTargetId);
    const queue = this.backendUserQueues[key] || [];
    const items: BackendQueuedMsg[] = [];
    while (queue.length > 0) {
      const item = queue.shift();
      if (item) items.push(item);
    }
    return items;
  }

  public processNext(rawTargetId: string): void {
    const targetId = this.normalizeQueueKey(rawTargetId);
    const queue = this.backendUserQueues[targetId];
    if (!queue || queue.length === 0) return;

    if (this.options.isAgentBusy(targetId)) {
      // Agent đang bận: KHÔNG bỏ queue. Hẹn retry sau 3s để tự xả khi agent về idle
      // (nguồn gốc bug "queue tích lũy không tự spawn" khi các trigger rời rạc bị bỏ lỡ).
      // Dedup: nếu đã có timer retry cho target này thì không tạo thêm (tránh chồng timer).
      if (this.retryTimers[targetId]) return;
      const t: any = setTimeout(() => {
        delete this.retryTimers[targetId];
        this.processNext(targetId);
      }, 3000);
      if (typeof t.unref === 'function') t.unref();
      this.retryTimers[targetId] = t;
      return;
    }

    queue.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const messagesToDispatch: BackendQueuedMsg[] = [];
    while (queue.length > 0) {
      const item = queue.shift();
      if (item) messagesToDispatch.push(item);
    }
    if (messagesToDispatch.length === 0) return;

    if (this.options.removeUnprocessedMessage) {
      for (const m of messagesToDispatch) {
        this.options.removeUnprocessedMessage(targetId, m.rawMsg);
      }
    }

    setImmediate(async () => {
      let failedItems: BackendQueuedMsg[] = [];
      let dispatchFailed = false;
      try {
        const now = Date.now();
        const targetAgent = this.options.getAgent ? this.options.getAgent(targetId) : undefined;
        const dispatchedMsgIds: string[] = [];
        const userMsgsToCombine: BackendQueuedMsg[] = [];
        const agentTalksToDeliver: BackendQueuedMsg[] = [];

        for (let idx = 0; idx < messagesToDispatch.length; idx++) {
          const m = messagesToDispatch[idx];
          const msgId = m.messageId || '';
          if (msgId) {
            dispatchedMsgIds.push(msgId);
            const existing = this.options.chatHistory ? this.options.chatHistory.find(x => x.id === msgId) : null;
            if (existing) {
              if ((existing as any).isQueued) {
                existing.timestamp = now + idx;
                (existing as any).isQueued = false;
                if (this.options.saveMessage) this.options.saveMessage(existing);
                if (this.options.broadcast) this.options.broadcast('chat:message', { msg: existing });
              }
            }
          }
          if (m.fromAgentId) {
            agentTalksToDeliver.push(m);
          } else {
            userMsgsToCombine.push(m);
          }
        }

        if (this.options.broadcast) {
          this.options.broadcast('chat:queue:dispatched', {
            targetAgentId: targetId,
            messageIds: dispatchedMsgIds,
            count: messagesToDispatch.length,
            timestamp: now
          });
        }

        const isOrch = targetId === 'orchestrator' || (targetAgent && (targetAgent.role === 'orchestrator' || targetAgent.type === 'orchestrator'));

        if (userMsgsToCombine.length > 0) {
          let combinedUserMsg = '';
          if (userMsgsToCombine.length === 1) {
            combinedUserMsg = userMsgsToCombine[0].rawMsg;
          } else {
            combinedUserMsg = userMsgsToCombine
              .map((m, idx) => `[Tin nhắn người dùng #${idx + 1} - Gửi lúc ${new Date(m.timestamp).toLocaleTimeString()}]:\n${m.rawMsg}`)
              .join('\n\n---\n\n');
          }

          console.log(`[UserQueueManager] Auto-dispatching queued user message(s) (${userMsgsToCombine.length} msg(s)) for ${targetId}: "${combinedUserMsg.slice(0, 80)}"`);
          try {
            const firstMsgId = userMsgsToCombine[0]?.messageId;
            const turnResponseId = firstMsgId ? `turn-${targetId}-${firstMsgId}` : undefined;
            await this.options.dispatchUserChat({
              targetAgentId: targetId,
              rawMsg: combinedUserMsg,
              isSlashCommand: userMsgsToCombine.length === 1 ? userMsgsToCombine[0].isSlash : false,
              isRetry: false,
              customTurnId: turnResponseId
            });
          } catch (err: any) {
            dispatchFailed = true;
            failedItems = [...userMsgsToCombine];
            console.error(`[UserQueueManager] dispatchUserChat failed for ${targetId}; re-queuing ${userMsgsToCombine.length} msg(s) to avoid loss:`, err?.message || err);
          }
        } else if (isOrch && this.options.processOrchestratorTriggerQueue) {
          await this.options.processOrchestratorTriggerQueue();
          return;
        }

        if (dispatchFailed) {
          this.backendUserQueues[targetId] = this.backendUserQueues[targetId] || [];
          for (const item of failedItems) {
            this.backendUserQueues[targetId].push(item);
            if (this.options.saveUnprocessedMessage && item.rawMsg) {
              this.options.saveUnprocessedMessage(targetId, item.rawMsg);
            }
          }
          return;
        }

        for (const talkItem of agentTalksToDeliver) {
          if (this.options.deliverTalk && targetAgent) {
            const sender = (this.options.getAgent ? this.options.getAgent(talkItem.fromAgentId!) : null) || {
              id: talkItem.fromAgentId!,
              name: talkItem.fromAgentName || 'Agent',
              role: talkItem.fromAgentRole || 'worker',
              type: 'worker',
              status: 'idle',
              createdAt: Date.now()
            };
            console.log(`[UserQueueManager] Auto-dispatching queued talk message from ${sender.name} to ${targetAgent.name} (${targetId})`);
            try {
              await this.options.deliverTalk(targetAgent, sender, { to: targetId, message: talkItem.rawMsg, task: talkItem.task }, talkItem.reportId || uuidv4());
            } catch (err: any) {
              console.error(`[UserQueueManager] deliverTalk failed for queued talk from ${sender.name} to ${targetId}; re-queuing to avoid loss:`, err?.message || err);
              const q = this.backendUserQueues[targetId] || (this.backendUserQueues[targetId] = []);
              q.push(talkItem);
              if (this.options.saveUnprocessedMessage && talkItem.rawMsg) {
                this.options.saveUnprocessedMessage(targetId, talkItem.rawMsg);
              }
            }
          }
        }
      } catch (err: any) {
        console.error(`[UserQueueManager] Error processing queued chat for ${targetId}:`, err);
      } finally {
        if (this.backendUserQueues[targetId]?.length > 0) {
          setImmediate(() => this.processNext(targetId));
        }
      }
    });
  }

  public processQueue(rawTargetId: string): void {
    this.processNext(rawTargetId);
  }
}
