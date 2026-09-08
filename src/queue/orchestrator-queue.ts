// ============ ORCHESTRATOR TRIGGER QUEUE & DEBOUNCE ============
import type { Agent } from '../core/agents.js';
import { DedupManager, defaultDedupManager } from '../relay/dedup.js';
import { isEmptyAgentOutput } from '../relay/report-parser.js';

export const ORCH_TRIGGER_DEBOUNCE_MS = 250;

export interface PendingOrchTrigger {
  fromAgent: Agent;
  message: string;
  reportId: string;
  attempts: number;
  targetOrchId?: string;
}

export interface OrchestratorQueueOptions {
  resolveOrchestratorTarget: (agent: Agent) => string;
  enqueueOutbox: (item: any) => void;
  processQueue: (batch: PendingOrchTrigger[], targetOrchId: string) => Promise<void>;
  getOrchClientBusy: (orchId: string) => boolean;
  dedupManager?: DedupManager;
}

export class OrchestratorTriggerQueue {
  private pendingTriggers: PendingOrchTrigger[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private options: OrchestratorQueueOptions;
  private dedup: DedupManager;

  constructor(options: OrchestratorQueueOptions) {
    this.options = options;
    this.dedup = options.dedupManager || defaultDedupManager;
  }

  public async trigger(fromAgent: Agent, message: string, existingReportId?: string, explicitReportId?: string): Promise<void> {
    const targetOrchId = this.options.resolveOrchestratorTarget(fromAgent);
    if (!existingReportId && isEmptyAgentOutput(message)) {
      console.log(`[Route] Skip triggerOrchestrator: empty message from ${fromAgent.name} (${fromAgent.role})`);
      return;
    }

    if (!existingReportId) {
      if (this.dedup.isOrchTriggerDuplicate(fromAgent.id, message)) {
        console.log(`[Route] Skip duplicate orchestrator trigger from ${fromAgent.name}`);
        return;
      }
    }

    const reportId = existingReportId || explicitReportId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `rep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    if (!existingReportId) {
      this.options.enqueueOutbox({
        id: reportId,
        from: fromAgent.id,
        to: targetOrchId,
        message,
        task: fromAgent.task,
        attempts: 0,
        createdAt: Date.now()
      });
    }

    this.pendingTriggers.push({
      fromAgent,
      message,
      reportId,
      attempts: 0,
      targetOrchId
    });

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flushQueue();
    }, ORCH_TRIGGER_DEBOUNCE_MS);
  }

  public async flushQueue(): Promise<void> {
    if (this.pendingTriggers.length === 0) return;

    const targetOrchId = this.pendingTriggers[0].targetOrchId || 'orchestrator';
    if (this.options.getOrchClientBusy(targetOrchId)) {
      if (!this.debounceTimer) {
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          this.flushQueue();
        }, 1000);
      }
      return;
    }

    const batch = [...this.pendingTriggers];
    this.pendingTriggers = [];

    try {
      await this.options.processQueue(batch, targetOrchId);
    } catch (e: any) {
      console.error('[OrchestratorTriggerQueue] Error processing batch:', e);
    }
  }

  public getPendingCount(): number {
    return this.pendingTriggers.length;
  }

  public clear(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingTriggers = [];
  }
}
