import { Router } from 'express';

export interface SettingsRouteDeps {
  storage: any;
  broadcast: (type: string, data: any) => void;
  agents: Map<string, any>;
  clients: Map<string, any>;
  resolveModelForAgent: (agent: any) => string | undefined;
  triggerSystemStart?: () => void;
}

export function createSettingsRouter(deps: SettingsRouteDeps): Router {
  const router = Router();

  // GET /api/settings
  router.get('/', (_req, res) => {
    const engineMode = deps.storage.getSetting('engineMode', 'http');
    const opencodeServeUrl = deps.storage.getSetting('opencodeServeUrl', deps.storage.getSetting('serveUrl', 'http://127.0.0.1:4096'));
    res.json({
      engineMode,
      opencodeServeUrl,
      serveUrl: opencodeServeUrl,
      autoContinue: deps.storage.getSetting('autoContinue', false) === true,
      enableWatchdog: deps.storage.getSetting('enableWatchdog', false) === true,
      watchdogStreamTimeoutSec: Number(deps.storage.getSetting('watchdogStreamTimeoutSec', 60)) || 60,
      watchdogIdleTimeoutSec: Number(deps.storage.getSetting('watchdogIdleTimeoutSec', deps.storage.getSetting('taskQueueIdleCheckSec', 120))) || 120,
      taskQueueIdleCheckSec: Number(deps.storage.getSetting('watchdogIdleTimeoutSec', deps.storage.getSetting('taskQueueIdleCheckSec', 120))) || 120,
      taskUpdateThrottleMs: Number(deps.storage.getSetting('taskUpdateThrottleMs', 600)) || 600,
      smartClarifyEnabled: deps.storage.getSetting('smartClarifyEnabled', false) === true,
      smartClarifyTimeoutSec: Number(deps.storage.getSetting('smartClarifyTimeoutSec', 120)) || 120,
      smartClarifyPromptTemplate: deps.storage.getSetting('smartClarifyPromptTemplate', 'Người dùng nói rằng "{content}", bạn hãy xác minh theo sự hiểu của bạn và hỏi lại người dùng xem có đúng ý bạn không một lần nữa.'),
      smartClarifyScope: deps.storage.getSetting('smartClarifyScope', 'orchestrator'),
      workerReminderPrompt: deps.storage.getSetting('workerReminderPrompt', '=== SYSTEM REMINDER ===\nUse <talk target="<target-id>">your message</talk> for communications.\nKhi bắt đầu xử lý, hãy dùng: <task_update task="N" status="working" />\nKhi hoàn thành và nghiệm thu xong, hãy dùng: <task_update task="N" status="completed" />\n(Lưu ý: Các lệnh điều phối AgentForge phải viết trực tiếp dưới dạng thẻ văn bản ngoài trường text, tuyệt đối không gọi qua toolcalls)'),
      isSystemStarted: deps.storage.getSetting('isSystemStarted', false) === true,
      models: deps.storage.getModelSettings()
    });
  });

  // POST /api/settings
  router.post('/', (req, res) => {
    const {
      engineMode,
      opencodeServeUrl,
      serveUrl,
      autoContinue,
      enableWatchdog,
      watchdogStreamTimeoutSec,
      watchdogIdleTimeoutSec,
      taskQueueIdleCheckSec,
      taskUpdateThrottleMs,
      smartClarifyEnabled,
      smartClarifyTimeoutSec,
      smartClarifyPromptTemplate,
      smartClarifyScope,
      workerReminderPrompt,
      isSystemStarted
    } = req.body || {};
    const validModes = ['run', 'attach', 'http'];
    let changed = false;

    if (engineMode && validModes.includes(engineMode)) {
      deps.storage.setSetting('engineMode', engineMode);
      changed = true;
    }
    const url = (typeof opencodeServeUrl === 'string' && opencodeServeUrl.trim())
      ? opencodeServeUrl.trim()
      : (typeof serveUrl === 'string' && serveUrl.trim() ? serveUrl.trim() : null);
    if (url) {
      deps.storage.setSetting('opencodeServeUrl', url);
      deps.storage.setSetting('serveUrl', url);
      changed = true;
    }
    if (autoContinue !== undefined) {
      deps.storage.setSetting('autoContinue', Boolean(autoContinue));
    }
    if (enableWatchdog !== undefined) {
      deps.storage.setSetting('enableWatchdog', Boolean(enableWatchdog));
    }
    if (watchdogStreamTimeoutSec !== undefined) {
      deps.storage.setSetting('watchdogStreamTimeoutSec', Math.max(5, Number(watchdogStreamTimeoutSec) || 60));
    }
    if (watchdogIdleTimeoutSec !== undefined) {
      const idleVal = Math.max(5, Number(watchdogIdleTimeoutSec) || 120);
      deps.storage.setSetting('watchdogIdleTimeoutSec', idleVal);
      deps.storage.setSetting('taskQueueIdleCheckSec', idleVal);
    } else if (taskQueueIdleCheckSec !== undefined) {
      const idleVal = Math.max(5, Number(taskQueueIdleCheckSec) || 120);
      deps.storage.setSetting('watchdogIdleTimeoutSec', idleVal);
      deps.storage.setSetting('taskQueueIdleCheckSec', idleVal);
    }
    if (taskUpdateThrottleMs !== undefined) {
      deps.storage.setSetting('taskUpdateThrottleMs', Math.max(100, Number(taskUpdateThrottleMs) || 600));
    }
    if (smartClarifyEnabled !== undefined) {
      deps.storage.setSetting('smartClarifyEnabled', Boolean(smartClarifyEnabled));
    }
    if (smartClarifyTimeoutSec !== undefined) {
      deps.storage.setSetting('smartClarifyTimeoutSec', Math.max(5, Number(smartClarifyTimeoutSec) || 120));
    }
    if (smartClarifyPromptTemplate !== undefined && typeof smartClarifyPromptTemplate === 'string') {
      deps.storage.setSetting('smartClarifyPromptTemplate', smartClarifyPromptTemplate);
    }
    if (smartClarifyScope !== undefined && typeof smartClarifyScope === 'string') {
      deps.storage.setSetting('smartClarifyScope', smartClarifyScope === 'all' ? 'all' : 'orchestrator');
    }
    if (workerReminderPrompt !== undefined && typeof workerReminderPrompt === 'string') {
      deps.storage.setSetting('workerReminderPrompt', workerReminderPrompt);
    }
    if (isSystemStarted !== undefined) {
      deps.storage.setSetting('isSystemStarted', Boolean(isSystemStarted));
    }

    if (changed) {
      for (const client of deps.clients.values()) {
        try { client.abort(); } catch {}
      }
      deps.clients.clear();
    }

    const currentMode = deps.storage.getSetting('engineMode', 'http');
    const currentUrl = deps.storage.getSetting('opencodeServeUrl', deps.storage.getSetting('serveUrl', 'http://127.0.0.1:4096'));

    const updatedPayload = {
      engineMode: currentMode,
      opencodeServeUrl: currentUrl,
      serveUrl: currentUrl,
      autoContinue: deps.storage.getSetting('autoContinue', false),
      enableWatchdog: deps.storage.getSetting('enableWatchdog', false),
      watchdogStreamTimeoutSec: Number(deps.storage.getSetting('watchdogStreamTimeoutSec', 60)),
      watchdogIdleTimeoutSec: Number(deps.storage.getSetting('watchdogIdleTimeoutSec', deps.storage.getSetting('taskQueueIdleCheckSec', 120))),
      taskQueueIdleCheckSec: Number(deps.storage.getSetting('watchdogIdleTimeoutSec', deps.storage.getSetting('taskQueueIdleCheckSec', 120))),
      smartClarifyEnabled: deps.storage.getSetting('smartClarifyEnabled', false),
      smartClarifyTimeoutSec: Number(deps.storage.getSetting('smartClarifyTimeoutSec', 30)),
      smartClarifyPromptTemplate: deps.storage.getSetting('smartClarifyPromptTemplate', ''),
      smartClarifyScope: deps.storage.getSetting('smartClarifyScope', 'orchestrator'),
      workerReminderPrompt: deps.storage.getSetting('workerReminderPrompt', ''),
      isSystemStarted: deps.storage.getSetting('isSystemStarted', false)
    };

    deps.broadcast('settings:updated', updatedPayload);

    res.json({
      ok: true,
      success: true,
      ...updatedPayload
    });
  });

  // POST /api/settings/start-system — Trigger boot sequence sau khi user bấm OK ở popup
  router.post('/start-system', (req, res) => {
    try {
      if (typeof (deps as any).triggerSystemStart === 'function') {
        (deps as any).triggerSystemStart();
      } else {
        deps.storage.setSetting('isSystemStarted', true);
        deps.broadcast('system:started', { ok: true, timestamp: Date.now() });
      }
      res.json({ success: true, message: 'System started successfully' });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || e });
    }
  });

  // GET /api/settings/watchdog
  router.get('/watchdog', (_req, res) => {
    res.json({ enableWatchdog: deps.storage.getSetting('enableWatchdog', false) === true });
  });

  // POST /api/settings/watchdog
  router.post('/watchdog', (req, res) => {
    const { enableWatchdog } = req.body || {};
    const enabled = Boolean(enableWatchdog);
    deps.storage.setSetting('enableWatchdog', enabled);
    deps.broadcast('settings:updated', { enableWatchdog: enabled });
    res.json({ success: true, enableWatchdog: enabled });
  });

  // GET /api/settings/autoContinue
  router.get('/autoContinue', (_req, res) => {
    res.json({ autoContinue: deps.storage.getSetting('autoContinue', false) === true });
  });

  // POST /api/settings/autoContinue
  router.post('/autoContinue', (req, res) => {
    const { autoContinue } = req.body || {};
    const enabled = Boolean(autoContinue);
    deps.storage.setSetting('autoContinue', enabled);
    deps.broadcast('settings:updated', { autoContinue: enabled });
    res.json({ success: true, autoContinue: enabled });
  });

  // GET /api/settings/smartClarify
  router.get('/smartClarify', (_req, res) => {
    res.json({
      smartClarifyEnabled: deps.storage.getSetting('smartClarifyEnabled', false) === true,
      smartClarifyTimeoutSec: Number(deps.storage.getSetting('smartClarifyTimeoutSec', 120)) || 120,
      smartClarifyPromptTemplate: deps.storage.getSetting('smartClarifyPromptTemplate', 'Người dùng nói rằng "{content}", bạn hãy xác minh theo sự hiểu của bạn và hỏi lại người dùng xem có đúng ý bạn không một lần nữa.'),
      smartClarifyScope: deps.storage.getSetting('smartClarifyScope', 'orchestrator')
    });
  });

  // POST /api/settings/smartClarify
  router.post('/smartClarify', (req, res) => {
    const { smartClarifyEnabled, smartClarifyTimeoutSec, smartClarifyPromptTemplate, smartClarifyScope } = req.body || {};
    const enabled = smartClarifyEnabled !== undefined ? Boolean(smartClarifyEnabled) : true;
    const timeoutSec = Math.max(5, Number(smartClarifyTimeoutSec) || 120);
    deps.storage.setSetting('smartClarifyEnabled', enabled);
    deps.storage.setSetting('smartClarifyTimeoutSec', timeoutSec);
    if (smartClarifyPromptTemplate !== undefined && typeof smartClarifyPromptTemplate === 'string') {
      deps.storage.setSetting('smartClarifyPromptTemplate', smartClarifyPromptTemplate);
    }
    if (smartClarifyScope !== undefined && typeof smartClarifyScope === 'string') {
      deps.storage.setSetting('smartClarifyScope', smartClarifyScope === 'all' ? 'all' : 'orchestrator');
    }
    const template = deps.storage.getSetting('smartClarifyPromptTemplate', 'Người dùng nói rằng "{content}", bạn hãy xác minh theo sự hiểu của bạn và hỏi lại người dùng xem có đúng ý bạn không một lần nữa.');
    const scope = deps.storage.getSetting('smartClarifyScope', 'orchestrator');
    deps.broadcast('settings:updated', { smartClarifyEnabled: enabled, smartClarifyTimeoutSec: timeoutSec, smartClarifyPromptTemplate: template, smartClarifyScope: scope });
    res.json({ success: true, smartClarifyEnabled: enabled, smartClarifyTimeoutSec: timeoutSec, smartClarifyPromptTemplate: template, smartClarifyScope: scope });
  });

  // GET /api/settings/defaultExpandToolcalls
  router.get('/defaultExpandToolcalls', (_req, res) => {
    res.json({ defaultExpandToolcalls: deps.storage.getSetting('defaultExpandToolcalls', false) === true });
  });

  // POST /api/settings/defaultExpandToolcalls
  router.post('/defaultExpandToolcalls', (req, res) => {
    const { defaultExpandToolcalls } = req.body || {};
    const enabled = Boolean(defaultExpandToolcalls);
    deps.storage.setSetting('defaultExpandToolcalls', enabled);
    deps.broadcast('settings:updated', { defaultExpandToolcalls: enabled });
    res.json({ success: true, defaultExpandToolcalls: enabled });
  });

  // GET /api/settings/rawResultTool
  router.get('/rawResultTool', (_req, res) => {
    res.json({ rawResultTool: deps.storage.getSetting('rawResultTool', false) === true });
  });

  // POST /api/settings/rawResultTool
  router.post('/rawResultTool', (req, res) => {
    const { rawResultTool } = req.body || {};
    const enabled = Boolean(rawResultTool);
    deps.storage.setSetting('rawResultTool', enabled);
    deps.broadcast('settings:updated', { rawResultTool: enabled });
    res.json({ success: true, rawResultTool: enabled });
  });

  // GET /api/settings/engineMode
  router.get('/engineMode', (_req, res) => {
    const engineMode = deps.storage.getSetting('engineMode', 'http');
    const opencodeServeUrl = deps.storage.getSetting('opencodeServeUrl', deps.storage.getSetting('serveUrl', 'http://127.0.0.1:4096'));
    res.json({ engineMode, opencodeServeUrl, serveUrl: opencodeServeUrl });
  });

  // POST /api/settings/engineMode
  router.post('/engineMode', (req, res) => {
    const { engineMode, serveUrl, opencodeServeUrl } = req.body || {};
    const validMode = (engineMode === 'attach' || engineMode === 'http' || engineMode === 'run') ? engineMode : 'http';
    const rawUrl = (typeof opencodeServeUrl === 'string' && opencodeServeUrl.trim())
      ? opencodeServeUrl.trim()
      : (typeof serveUrl === 'string' && serveUrl.trim() ? serveUrl.trim() : 'http://127.0.0.1:4096');

    deps.storage.setSetting('engineMode', validMode);
    deps.storage.setSetting('opencodeServeUrl', rawUrl);
    deps.storage.setSetting('serveUrl', rawUrl);

    for (const client of deps.clients.values()) {
      try { client.abort(); } catch {}
    }
    deps.clients.clear();

    deps.broadcast('settings:updated', { engineMode: validMode, opencodeServeUrl: rawUrl, serveUrl: rawUrl });
    res.json({ success: true, engineMode: validMode, opencodeServeUrl: rawUrl, serveUrl: rawUrl });
  });

  // GET /api/settings/models
  router.get('/models', (_req, res) => {
    const modelSettings = deps.storage.getModelSettings();
    res.json(modelSettings);
  });

  // POST /api/settings/models
  router.post('/models', (req, res) => {
    const { orchestratorModel, defaultSubagentModel, agentModelOverrides } = req.body || {};

    if (orchestratorModel !== undefined) {
      if (orchestratorModel) process.env.ORCHESTRATOR_MODEL = orchestratorModel;
      else delete process.env.ORCHESTRATOR_MODEL;
      const orchAgent = deps.agents.get('orchestrator');
      if (orchAgent) {
        orchAgent.model = orchestratorModel || undefined;
        deps.storage.updateAgent('orchestrator', { model: orchestratorModel || null });
      }
      const orchClient = deps.clients.get('orchestrator');
      if (orchClient) orchClient.setModel(orchestratorModel || undefined);
    }

    const updated = deps.storage.setModelSettings({
      orchestratorModel: orchestratorModel !== undefined ? (orchestratorModel || null) : undefined,
      defaultSubagentModel: defaultSubagentModel !== undefined ? (defaultSubagentModel || null) : undefined,
      agentModelOverrides: agentModelOverrides !== undefined ? agentModelOverrides : undefined
    });

    // Re-apply resolved models to all active clients
    for (const [id, agent] of deps.agents.entries()) {
      if (id === 'orchestrator') continue;
      const client = deps.clients.get(id);
      if (client) {
        const resolved = deps.resolveModelForAgent(agent);
        client.setModel(resolved || undefined);
      }
    }

    deps.broadcast('settings:updated', { models: updated });
    res.json({ ok: true, settings: updated });
  });

  return router;
}
