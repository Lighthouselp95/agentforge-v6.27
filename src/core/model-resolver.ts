import type { Agent } from './agents.js';

export interface ModelResolverDeps {
  storage: any;
  agents: Map<string, any>;
}

export function resolveOrchestratorModel(deps: ModelResolverDeps): string {
  const orchAgent = deps.agents.get('orchestrator') || deps.storage.getAgent('orchestrator');
  if (orchAgent?.model && orchAgent.model.trim() && orchAgent.model.trim().toLowerCase() !== 'default') {
    return orchAgent.model.trim();
  }
  const saved = deps.storage.getSetting('orchestratorModel', process.env.ORCHESTRATOR_MODEL);
  if (saved && String(saved).trim() && String(saved).trim().toLowerCase() !== 'default') {
    return String(saved).trim();
  }
  const envModel = process.env.ORCHESTRATOR_MODEL || process.env.DEFAULT_MODEL;
  if (envModel && envModel.trim() && envModel.trim().toLowerCase() !== 'default') {
    return envModel.trim();
  }
  return 'antigravity/gemini-3.7-flash-high';
}

/**
 * Phân cấp thừa kế Model chuẩn xác 100% theo chỉ đạo người dùng:
 * "Mặc định agent con trên card thừa hưởng model main trên card, nếu không có thì bắt đầu đi vào thừa kế trong setting"
 *
 * 1. Tầng 1 (Cấu hình riêng của Agent con):
 *    Nếu agent.model được gán rõ ràng (khác undefined, khác rỗng, khác 'default'): dùng ngay agent.model.
 * 2. Tầng 2 (MẶC ĐỊNH — Kế thừa trực tiếp Model Main trên Card):
 *    Lấy model đang hiển thị/cấu hình của Main (Orchestrator) trên Card.
 *    Nếu mainAgent?.model có giá trị cụ thể: DÙNG NGAY MODEL NÀY CỦA MAIN!
 * 3. Tầng 3 (Chỉ khi Main Card không có model mới đi vào Setting):
 *    - Override riêng agentModelOverrides
 *    - storage.getSetting('defaultSubagentModel')
 *    - storage.getSetting('orchestratorModel')
 *    - teamSettings.defaultModel
 *    - Fallback về process.env.DEFAULT_MODEL (hoặc antigravity/gemini-3.7-flash-high)
 */
export function resolveModelForAgent(agent: Agent, deps: ModelResolverDeps): string {
  if (agent.id === 'orchestrator' || agent.type === 'orchestrator' || agent.role === 'orchestrator') {
    return resolveOrchestratorModel(deps);
  }

  // Tầng 1: Cấu hình riêng của Agent con trên Card
  if (agent.model && agent.model.trim() && agent.model.trim().toLowerCase() !== 'default') {
    return agent.model.trim();
  }

  // Tầng 2: MẶC ĐỊNH — Kế thừa trực tiếp Model Main trên Card
  const mainAgent = deps.agents.get('orchestrator') ||
                    deps.storage.getAgent('orchestrator') ||
                    (deps.storage.getAllAgents ? deps.storage.getAllAgents().find((a: any) => a.role === 'orchestrator' || a.type === 'orchestrator') : undefined);
  if (mainAgent?.model && mainAgent.model.trim() && mainAgent.model.trim().toLowerCase() !== 'default') {
    return mainAgent.model.trim();
  }

  // Tầng 3: Đi vào Setting
  // 3a. Override riêng theo agent / role trong ModelSettingsDialog
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

  // 3b. Default subagent setting
  const defSubagent = deps.storage.getSetting('defaultSubagentModel', process.env.DEFAULT_SUBAGENT_MODEL);
  if (defSubagent && String(defSubagent).trim() && String(defSubagent).trim().toLowerCase() !== 'default') {
    return String(defSubagent).trim();
  }

  // 3c. Main setting / Team defaultModel
  const orchModelSetting = deps.storage.getSetting('orchestratorModel', process.env.ORCHESTRATOR_MODEL);
  if (orchModelSetting && String(orchModelSetting).trim() && String(orchModelSetting).trim().toLowerCase() !== 'default') {
    return String(orchModelSetting).trim();
  }
  const teamSettings = deps.storage.getTeamSettings ? deps.storage.getTeamSettings(agent.teamId || 'default') : null;
  if (teamSettings?.defaultModel && teamSettings.defaultModel.trim() && teamSettings.defaultModel.trim().toLowerCase() !== 'default') {
    return teamSettings.defaultModel.trim();
  }

  // 3d. Fallback cuối cùng
  return process.env.DEFAULT_MODEL || resolveOrchestratorModel(deps);
}
