import type { Agent } from './agents.js';

export interface ModelResolverDeps {
  storage: any;
  agents: Map<string, any>;
}

function findTeamOrchestrator(teamId: string | undefined, deps: ModelResolverDeps): Agent | undefined {
  if (teamId) {
    for (const [, a] of deps.agents) {
      if (a && (a.role === 'orchestrator' || a.type === 'orchestrator') && a.teamId === teamId) {
        return a;
      }
    }
  }
  const root = deps.agents.get('orchestrator') || deps.storage.getAgent('orchestrator');
  if (root) return root;

  for (const [, a] of deps.agents) {
    if (a && (a.role === 'orchestrator' || a.type === 'orchestrator')) {
      return a;
    }
  }

  if (deps.storage.getAllAgents) {
    const list = deps.storage.getAllAgents();
    if (teamId) {
      const matchTeam = list.find((a: any) => (a.role === 'orchestrator' || a.type === 'orchestrator') && a.teamId === teamId);
      if (matchTeam) return matchTeam;
    }
    const anyOrch = list.find((a: any) => a.role === 'orchestrator' || a.type === 'orchestrator' || a.id === 'orchestrator');
    if (anyOrch) return anyOrch;
  }
  return undefined;
}

/**
 * Phân cấp thừa kế Model chuẩn xác từ CỤ THỂ đến TỔNG QUÁT:
 * 
 * 1. Model riêng trên card của chính Orchestrator đó (nếu có):
 *    - orchAgent.model (khác 'default', khác rỗng)
 * 2. Team Settings của team Orchestrator trực thuộc:
 *    - teamSettings.defaultModel
 * 3. Settings bảng ModelSettings / Global Settings (từ bé đến lớn):
 *    - agentModelOverrides (theo agentId, name, role)
 *    - storage.getSetting('orchestratorModel')
 * 4. Biến môi trường / Fallback hệ thống:
 *    - process.env.ORCHESTRATOR_MODEL || process.env.DEFAULT_MODEL
 *    - 'antigravity/gemini-3.7-flash-high'
 */
export function resolveOrchestratorModel(deps: ModelResolverDeps, targetOrch?: Agent | string): string {
  let orchAgent: Agent | undefined;
  if (typeof targetOrch === 'object' && targetOrch) {
    orchAgent = targetOrch;
  } else if (typeof targetOrch === 'string' && targetOrch.trim()) {
    orchAgent = deps.agents.get(targetOrch) || deps.storage.getAgent(targetOrch);
    if (!orchAgent && targetOrch === 'orchestrator') {
      orchAgent = findTeamOrchestrator(undefined, deps);
    }
  } else {
    orchAgent = findTeamOrchestrator(undefined, deps);
  }

  // 1. Model trực tiếp trên Card của Orchestrator
  if (orchAgent?.model && orchAgent.model.trim() && orchAgent.model.trim().toLowerCase() !== 'default') {
    return orchAgent.model.trim();
  }

  // 2. Team Settings của team mà Orchestrator đó trực thuộc
  const teamId = orchAgent?.teamId || 'default';
  const teamSettings = deps.storage.getTeamSettings ? deps.storage.getTeamSettings(teamId) : null;
  if (teamSettings?.defaultModel && teamSettings.defaultModel.trim() && teamSettings.defaultModel.trim().toLowerCase() !== 'default') {
    return teamSettings.defaultModel.trim();
  }

  // 3. Settings từ bé đến lớn (Overrides riêng theo ID/Name/Role -> Setting Orchestrator Model chung)
  if (orchAgent) {
    const overrides: Record<string, string> = deps.storage.getSetting('agentModelOverrides', {});
    if (orchAgent.id && overrides[orchAgent.id]?.trim() && overrides[orchAgent.id].trim().toLowerCase() !== 'default') {
      return overrides[orchAgent.id].trim();
    }
    if (orchAgent.name && overrides[orchAgent.name]?.trim() && overrides[orchAgent.name].trim().toLowerCase() !== 'default') {
      return overrides[orchAgent.name].trim();
    }
    if (overrides['role:orchestrator']?.trim() && overrides['role:orchestrator'].trim().toLowerCase() !== 'default') {
      return overrides['role:orchestrator'].trim();
    }
    if (overrides['orchestrator']?.trim() && overrides['orchestrator'].trim().toLowerCase() !== 'default') {
      return overrides['orchestrator'].trim();
    }
  }

  const saved = deps.storage.getSetting('orchestratorModel', process.env.ORCHESTRATOR_MODEL);
  if (saved && String(saved).trim() && String(saved).trim().toLowerCase() !== 'default') {
    return String(saved).trim();
  }

  // 4. Fallback môi trường / mặc định
  const envModel = process.env.ORCHESTRATOR_MODEL || process.env.DEFAULT_MODEL;
  if (envModel && envModel.trim() && envModel.trim().toLowerCase() !== 'default') {
    return envModel.trim();
  }
  return 'antigravity/gemini-3.7-flash-high';
}

/**
 * Phân cấp thừa kế Model chuẩn xác 100% từ NHỎ ĐẾN LỚN, từ CỤ THỂ đến TỔNG QUÁT:
 *
 * Tầng 1: Model cấu hình riêng ở thẻ (Card) của Agent
 * Tầng 2: Thừa hưởng model của Orchestrator quản lý Team của Agent đó (trên card Orchestrator)
 * Tầng 3: Thừa hưởng setting của Team (Team Settings)
 * Tầng 4: Thừa hưởng các setting bên trong bảng Settings từ bé đến lớn:
 *         - Override cụ thể theo agentId, name, role (agentModelOverrides)
 *         - Setting mặc định cho subagent (defaultSubagentModel)
 *         - Setting orchestratorModel
 * Tầng 5: Biến môi trường & Fallback hệ thống (DEFAULT_MODEL / gemini)
 */
export function resolveModelForAgent(agent: Agent, deps: ModelResolverDeps): string {
  if (agent.id === 'orchestrator' || agent.type === 'orchestrator' || agent.role === 'orchestrator') {
    return resolveOrchestratorModel(deps, agent);
  }

  // Tầng 1: Cấu hình riêng của Agent con trên Card
  if (agent.model && agent.model.trim() && agent.model.trim().toLowerCase() !== 'default') {
    return agent.model.trim();
  }

  // Tầng 2: Kế thừa trực tiếp Model của Orchestrator trong Team đó (Card Orchestrator của Team)
  const teamId = agent.teamId || 'default';
  const teamOrch = findTeamOrchestrator(teamId, deps);
  if (teamOrch?.model && teamOrch.model.trim() && teamOrch.model.trim().toLowerCase() !== 'default') {
    return teamOrch.model.trim();
  }

  // Tầng 3: Kế thừa setting của Team (Team Settings)
  const teamSettings = deps.storage.getTeamSettings ? deps.storage.getTeamSettings(teamId) : null;
  if (teamSettings?.defaultModel && teamSettings.defaultModel.trim() && teamSettings.defaultModel.trim().toLowerCase() !== 'default') {
    return teamSettings.defaultModel.trim();
  }

  // Tầng 4: Đi vào Settings từ bé đến lớn
  // 4a. Override riêng theo agentId / name / role trong ModelSettingsDialog
  const overrides: Record<string, string> = deps.storage.getSetting('agentModelOverrides', {});
  if (agent.id && overrides[agent.id]?.trim() && overrides[agent.id].trim().toLowerCase() !== 'default') {
    return overrides[agent.id].trim();
  }
  if (agent.name && overrides[agent.name]?.trim() && overrides[agent.name].trim().toLowerCase() !== 'default') {
    return overrides[agent.name].trim();
  }
  if (agent.role && overrides[`role:${agent.role}`]?.trim() && overrides[`role:${agent.role}`].trim().toLowerCase() !== 'default') {
    return overrides[`role:${agent.role}`].trim();
  }
  if (agent.role && overrides[agent.role]?.trim() && overrides[agent.role].trim().toLowerCase() !== 'default') {
    return overrides[agent.role].trim();
  }

  // 4b. Default subagent setting trong bảng settings
  const defSubagent = deps.storage.getSetting('defaultSubagentModel', process.env.DEFAULT_SUBAGENT_MODEL);
  if (defSubagent && String(defSubagent).trim() && String(defSubagent).trim().toLowerCase() !== 'default') {
    return String(defSubagent).trim();
  }

  // 4c. Setting orchestratorModel trong bảng settings
  const orchModelSetting = deps.storage.getSetting('orchestratorModel', process.env.ORCHESTRATOR_MODEL);
  if (orchModelSetting && String(orchModelSetting).trim() && String(orchModelSetting).trim().toLowerCase() !== 'default') {
    return String(orchModelSetting).trim();
  }

  // Tầng 5: Fallback cuối cùng
  return process.env.DEFAULT_MODEL || resolveOrchestratorModel(deps, teamOrch);
}
