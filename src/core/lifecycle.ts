// src/core/lifecycle.ts
/**
 * Quản lý vòng đời agent (spawn, resume, stop, kill).
 * Triển khai logic từ src/server.ts:
 *   - spawnAgent/createAgent: khởi tạo client, thiết lập status, lưu, broadcast.
 *   - stopAgent: abort tiến trình, đặt status stopped, broadcast tin nhắn stop, drain queue.
 *   - resumeAgent/resumeAgentWork: phục hồi công việc đang dở.
 *
 * Giao diện đơn giản cho việc gọi từ core/app.ts hoặc từ routes/handlers.
 */

import type { Agent } from '../agents/agent-manager.js';
import { ACPClient, OpenCodeServeClient } from '../agents/index.js';
import { storage } from '../storage.js';
import { processManager } from '../process/process-manager.js';
import { watchdogManager } from '../core/watchdog.js';

export interface LifecycleDeps {
  agents: Map<string, Agent>;
  clients: Map<string, ACPClient | OpenCodeServeClient>;
  chatHistory: any[];
  backendUserQueues: Record<string, any[]>;
  storage: typeof storage;
  broadcast: (type: string, data: any) => void;
  resumeTimeoutMap?: Map<string, NodeJS.Timeout>;
}

/**
 * Spawn một agent mới với cấu hình được cung cấp.
 * Nếu agent đã tồn tại ở trạng thái stopped/idle, hạn chế spawn mới.
 * Trả về agent đã spawn hoặc null nếu không thành công.
 */
export function spawnAgent(
  deps: LifecycleDeps,
  config: {
    id?: string;
    name?: string;
    role: string;
    projectDir?: string;
    model?: string;
    teamId?: string;
    spawnedBy?: string;
    taskId?: string;
  }
): Agent | null | undefined {
  const { id, name, role, projectDir, model, teamId, spawnedBy, taskId } = config;

  // Nếu user cung cấp ID, kiểm tra đã tồn tại chưa
  const existingAgent = id ? deps.agents.get(id) : undefined;
  if (existingAgent) {
    console.log(`[Lifecycle] Agent ${id} đã tồn tại ở trạng thái ${existingAgent.status}`);
    return existingAgent;
  }

  // Tạo ID mới
  const newId = id || `agent-${Date.now()}`;
  const agentName = name || `Agent_${role}`;
  const agentRole = role;
  const agentTeamId = teamId || spawnedBy || 'default';

  const newAgent: Agent = {
    id: newId as any,
    name: agentName,
    role: agentRole,
    type: 'worker',
    spawnedBy: spawnedBy,
    projectDir,
    model,
    teamId: agentTeamId,
    status: 'idle',
    createdAt: Date.now(),
    tasks: taskId ? [{ id: `task-${Date.now()}`, task: 'pending', status: 'pending', createdAt: Date.now() }] : []
  };

  deps.agents.set(newId as string, newAgent);
  deps.storage.saveAgent(newAgent);

  deps.broadcast('agent:updated', { agent: newAgent });

  console.log(`[Lifecycle] Spawned agent ${newAgent.name} (${newAgent.id})`);
  return newAgent;
}

/**
 * Dừng một agent. Gây abort nếu có client, đặt trạng thái stopped.
 */
export function stopAgent(
  deps: LifecycleDeps,
  id: string,
  stoppedBy: 'user' | 'orchestrator' | 'error' = 'user',
  errorDetail?: string
): boolean {
  const a = deps.agents.get(id);
  if (!a || a.status === 'stopped') return false;

  // FIX 3: clear resume timeout nếu có
  if (deps.resumeTimeoutMap?.has(id)) {
    clearTimeout(deps.resumeTimeoutMap.get(id)!);
    deps.resumeTimeoutMap.delete(id);
  }

  // FIX 2: OS PID tracking + zombie cleanup
  const client = deps.clients.get(id);
  if (client) {
    try { client.abort(); } catch {}
  }

  // tree-kill các tiến trình liên quan với agent
  try { processManager.abortAgentProcesses(id); } catch {}

  a.status = (stoppedBy === 'error') ? 'error' : 'stopped';
  a.workingSince = undefined;
  deps.clients.delete(id);
  deps.storage.updateAgent(a.id, { status: a.status, workingSince: null });
  deps.broadcast('agent:updated', { agent: a });

  // Tạo tin nhắn stop
  const stopText = stoppedBy === 'error'
    ? `❌ [CRASHED] Agent ${a.name} stopped due to error: ${errorDetail || 'Unknown error'}`
    : `🛑 [STOPPED] Agent ${a.name} was stopped by ${stoppedBy}.`;
  const targetOrch = a.spawnedBy || 'orchestrator';
  const stopMsg = {
    id: `${Date.now()}-stop-${Math.random().toString(36).slice(2)}`,
    from: a.id,
    to: targetOrch,
    content: stopText,
    timestamp: Date.now(),
    agentName: a.name,
    agentRole: a.role,
    msgType: stoppedBy === 'user' ? 'stop_user' : (stoppedBy === 'orchestrator' ? 'stop_orchestrator' : 'stop_error'),
    teamId: a.teamId || 'default'
  };

  deps.chatHistory.push(stopMsg);
  deps.storage.saveMessage(stopMsg);
  deps.broadcast('chat:message', { msg: stopMsg });

  // Auto-drain backendUserQueues
  const agentQueueKey = a.id;
  const pendingQueue = deps.backendUserQueues[agentQueueKey];
  if (pendingQueue && pendingQueue.length > 0) {
    const queuedMessageIds = pendingQueue.map((m: any) => m.messageId).filter(Boolean);
    deps.backendUserQueues[agentQueueKey] = [];

    // FIX 4: chỉ 1 đường duy nhất — lưu unprocessed thay cho inject+broadcast
    for (const qItem of pendingQueue) {
      try { deps.storage.saveUnprocessedMessage(agentQueueKey, qItem.rawMsg); } catch {}
    }
    deps.broadcast('chat:queue:dispatched', {
      targetAgentId: a.id,
      messageIds: queuedMessageIds,
      count: queuedMessageIds.length
    });
    console.log(`[Stop] Auto-drained ${pendingQueue.length} queued messages for ${a.id}`);
  }

  console.log(`[Stop] ${a.name} (${a.id}) by ${stoppedBy}`);
  return true;
}

/**
 * Resume một agent đang ở trạng thái stopped.
 */
export function resumeAgent(
  deps: LifecycleDeps,
  id: string
): boolean {
  const a = deps.agents.get(id);
  if (!a || a.status !== 'stopped') return false;

  a.status = 'idle';
  deps.storage.updateAgent(a.id, { status: 'idle' });
  deps.broadcast('agent:updated', { agent: a });

  console.log(`[Resume] ${a.name} (${a.id})`);

  // FIX 3: resumeTimeoutMap + clearTimeout trong stopAgent
  const timeout = setTimeout(() => {
    resumeAgentWork(deps, a).catch(e => console.log(`[Resume] ${a.name} work error: ${e.message}`));
    if (deps.resumeTimeoutMap) deps.resumeTimeoutMap.delete(id);
  }, 300);
  if (deps.resumeTimeoutMap) deps.resumeTimeoutMap.set(id, timeout);

  return true;
}

/**
 * Resume công việc agent đang dở (gọi nội bộ).
 */
async function resumeAgentWork(
  deps: LifecycleDeps,
  agent: Agent
): Promise<void> {
  // FIX 1: resumeAgent — nếu client undefined thì re-instantiate
  let client = deps.clients.get(agent.id);
  if (!client) {
    const isAttach = process.env.OPENCODE_SERVE_MODE === 'attach';
    const mode: 'attach' | 'http' = isAttach ? 'attach' : 'http';
    const serverUrl = process.env.OPENCODE_SERVE_URL || 'http://127.0.0.1:4096';
    const config = {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      type: 'worker' as const,
      projectDir: agent.projectDir,
      model: agent.model,
      teamId: agent.teamId
    };
    try {
      if (mode === 'attach') {
        client = new (require('../agents/opencode-serve-client.js').OpenCodeServeClient)(config, { mode, serverUrl });
      } else {
        client = new (require('../agents/acp-client.js').ACPClient)(config);
      }
    } catch {
      console.warn(`[Resume] Không thể tạo client mới cho ${agent.id}`);
      return;
    }
    if (!client) return;
    deps.clients.set(agent.id, client);
  }

  const needReinject = (client as any).getNeedPromptReinject?.() || !agent.sessionId;
  if (needReinject) (client as any).setNeedPromptReinject?.(false);

  // Build resume prompt
  const team = `[TEAM]\nTeam: ${agent.teamId || 'default'}\n[/TEAM]`;
  const resumeMsg = `=== RESUME WORK ===
You were stopped mid-task. Continue and COMPLETE this task:
${agent.task || 'Continue your previous work.'}

Finish with:
=== TASK REPORT ===
AGENT_ID: ${agent.id}
STATUS: completed
WHAT I DID: <summary>
=== END REPORT ===`;

  const prompt = `[TASK] ${agent.task || 'Continue your previous work.'}\n[TEAM]\n${team}\n[/TEAM]\n\n=== INCOMING MESSAGE ===\nFROM: Orchestrator (orchestrator)\nTO: ${agent.name} (${agent.id})\n=== MESSAGE ===\n${resumeMsg}`;

  try {
    const result = await (client as any).enqueue(`${prompt}\n\nContinue working...`);
    agent.sessionId = result.sessionId || agent.sessionId;
    if (result.tokenUsage) agent.tokenUsage = result.tokenUsage;
    if (result.contextLength) agent.contextLength = result.contextLength;
    deps.storage.updateAgent(agent.id, {
      status: 'working',
      workingSince: Date.now(),
      sessionId: agent.sessionId
    });
    deps.broadcast('agent:updated', { agent });
  } catch (e) {
    console.error(`[Resume] Lỗi khi resume agent ${agent.id}:`, e);
  }
}

// Helper function để tạo agent từ config người dùng (dùng cho API endpoint)
export function createUserAgent(
  deps: LifecycleDeps,
  params: {
    role?: string;
    name?: string;
    projectDir?: string;
    model?: string;
    teamId?: string;
  }
): Agent {
  return spawnAgent(deps, {
    role: params.role || 'worker',
    name: params.name,
    projectDir: params.projectDir,
    model: params.model,
    teamId: params.teamId
  })!;
}
