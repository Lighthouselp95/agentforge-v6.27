import { Router } from 'express';

export interface SettingsRouteDeps {
  storage: any;
  broadcast: (type: string, data: any) => void;
  agents: Map<string, any>;
  clients: Map<string, any>;
  resolveModelForAgent: (agent: any) => string | undefined;
}

export function createSettingsRouter(deps: SettingsRouteDeps): Router {
  const router = Router();

  // GET /api/settings
  router.get('/', (_req, res) => {
    const engineMode = deps.storage.getSetting('engineMode', 'attach');
    const opencodeServeUrl = deps.storage.getSetting('opencodeServeUrl', deps.storage.getSetting('serveUrl', 'http://127.0.0.1:4096'));
    res.json({
      engineMode,
      opencodeServeUrl,
      serveUrl: opencodeServeUrl,
      autoContinue: deps.storage.getSetting('autoContinue', false) === true,
      enableWatchdog: deps.storage.getSetting('enableWatchdog', false) === true,
      models: deps.storage.getModelSettings()
    });
  });

  // POST /api/settings
  router.post('/', (req, res) => {
    const { engineMode, opencodeServeUrl, serveUrl, autoContinue } = req.body || {};
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

    if (changed) {
      deps.clients.clear();
    }

    const currentMode = deps.storage.getSetting('engineMode', 'attach');
    const currentUrl = deps.storage.getSetting('opencodeServeUrl', deps.storage.getSetting('serveUrl', 'http://127.0.0.1:4096'));

    deps.broadcast('settings:updated', {
      engineMode: currentMode,
      opencodeServeUrl: currentUrl,
      serveUrl: currentUrl,
      autoContinue: deps.storage.getSetting('autoContinue', false)
    });

    res.json({
      ok: true,
      success: true,
      engineMode: currentMode,
      opencodeServeUrl: currentUrl,
      serveUrl: currentUrl
    });
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

  // GET /api/settings/engineMode
  router.get('/engineMode', (_req, res) => {
    const engineMode = deps.storage.getSetting('engineMode', 'attach');
    const opencodeServeUrl = deps.storage.getSetting('opencodeServeUrl', deps.storage.getSetting('serveUrl', 'http://127.0.0.1:4096'));
    res.json({ engineMode, opencodeServeUrl, serveUrl: opencodeServeUrl });
  });

  // POST /api/settings/engineMode
  router.post('/engineMode', (req, res) => {
    const { engineMode, serveUrl, opencodeServeUrl } = req.body || {};
    const validMode = (engineMode === 'attach' || engineMode === 'http' || engineMode === 'run') ? engineMode : 'attach';
    const rawUrl = (typeof opencodeServeUrl === 'string' && opencodeServeUrl.trim())
      ? opencodeServeUrl.trim()
      : (typeof serveUrl === 'string' && serveUrl.trim() ? serveUrl.trim() : 'http://127.0.0.1:4096');

    deps.storage.setSetting('engineMode', validMode);
    deps.storage.setSetting('opencodeServeUrl', rawUrl);
    deps.storage.setSetting('serveUrl', rawUrl);

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
