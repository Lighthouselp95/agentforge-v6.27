import React, { useState, useEffect } from 'react';

interface Agent {
  id: string;
  name: string;
  role: string;
  model?: string;
}

interface Props {
  agents: Agent[];
  onClose: () => void;
  onSaved?: () => void;
}

const STANDARD_ROLES = [
  { value: 'coder', label: '🔨 Coder', desc: 'Lập trình, sửa bug, triển khai code' },
  { value: 'researcher', label: '🔬 Researcher', desc: 'Nghiên cứu tài liệu, phân tích codebase' },
  { value: 'tester', label: '🧪 Tester', desc: 'Viết unit test, kiểm thử chức năng' },
  { value: 'reviewer', label: '🔍 Reviewer', desc: 'Đánh giá chất lượng và kiến trúc code' },
  { value: 'verifier', label: '✅ Verifier', desc: 'Xác minh sự chính xác và chuẩn đầu ra' },
  { value: 'debugger', label: '🐛 Debugger', desc: 'Điều tra nguyên nhân gốc rễ và vết lỗi' },
  { value: 'searcher', label: '🔎 Searcher', desc: 'Tìm kiếm code, tham chiếu và pattern' },
  { value: 'idea', label: '💡 Idea', desc: 'Đề xuất giải pháp và ý tưởng sáng tạo' },
  { value: 'planner', label: '📋 Planner', desc: 'Lập kế hoạch phân rã công việc' },
  { value: 'docs', label: '📝 Docs', desc: 'Viết tài liệu kỹ thuật' }
];

export function ModelSettingsDialog({ agents, onClose, onSaved }: Props) {
  const [orchestratorModel, setOrchestratorModel] = useState('');
  const [defaultSubagentModel, setDefaultSubagentModel] = useState('');
  const [agentModelOverrides, setAgentModelOverrides] = useState<Record<string, string>>({});
  const [engineMode, setEngineMode] = useState<'run' | 'attach' | 'http'>('attach');
  const [serveUrl, setServeUrl] = useState('http://127.0.0.1:4096');
  const [defaultExpandToolcalls, setDefaultExpandToolcalls] = useState(false);
  const [activeTab, setActiveTab] = useState<'models' | 'automation' | 'prompts'>('models');
  const [enableWatchdog, setEnableWatchdog] = useState(true);
  const [autoContinue, setAutoContinue] = useState(true);
  const [watchdogSec, setWatchdogSec] = useState(60);
  const [idleSec, setIdleSec] = useState(120);
  const [taskUpdateThrottleMs, setTaskUpdateThrottleMs] = useState(600);
  const [smartClarifyEnabled, setSmartClarifyEnabled] = useState(false);
  const [smartClarifyTimeoutSec, setSmartClarifyTimeoutSec] = useState(120);
  const [smartClarifyPromptTemplate, setSmartClarifyPromptTemplate] = useState('Người dùng nói rằng "{content}", bạn hãy xác minh theo sự hiểu của bạn và hỏi lại người dùng xem có đúng ý bạn không một lần nữa.');
  const [smartClarifyScope, setSmartClarifyScope] = useState<'orchestrator' | 'all'>('orchestrator');
  const [workerReminderPrompt, setWorkerReminderPrompt] = useState('=== SYSTEM REMINDER ===\nUse <talk target="<target-id>">your message</talk> for communications.\nKhi bắt đầu xử lý: <task_update task="N" status="working" />\nKhi hoàn tất: <task_update task="N" status="completed" /> (yêu cầu task phải ở trạng thái working trước khi completed)\nKhi hủy bỏ: <task_update task="N" status="cancel" /> (có thể hủy trực tiếp từ pending hoặc working)\n(Lưu ý: Các lệnh điều phối AgentForge phải viết trực tiếp dưới dạng thẻ văn bản ngoài trường text, tuyệt đối không gọi qua toolcalls)');
  const [models, setModels] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('af-models-cache');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.models)) return parsed.models;
      }
    } catch {}
    return [];
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const API = window.location.port === '5173' ? '' : (window.location.origin.startsWith('http') ? window.location.origin : 'http://localhost:4001');
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        let isCacheFresh = false;
        try {
          const raw = localStorage.getItem('af-models-cache');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed?.models) && parsed.models.length > 0) {
              setModels(parsed.models);
              if (typeof parsed.timestamp === 'number' && Date.now() - parsed.timestamp < 5 * 60 * 1000) {
                isCacheFresh = true;
              }
            }
          }
        } catch {}

        // Song song hóa 2 API calls bằng Promise.all
        const fetchModelsPromise = isCacheFresh
          ? Promise.resolve(null)
          : fetch(`${API}/api/models`).then(r => r.ok ? r.json() : null).catch(() => null);

        const fetchSettingsPromise = fetch(`${API}/api/settings`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null);

        const fetchEnginePromise = fetch(`${API}/api/settings/engineMode`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null);

        const fetchExpandPromise = fetch(`${API}/api/settings/defaultExpandToolcalls`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null);

        const fetchSmartPromise = fetch(`${API}/api/settings/smartClarify`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null);

        const [modelsData, settingsData, engineData, expandData, smartData] = await Promise.all([
          fetchModelsPromise,
          fetchSettingsPromise,
          fetchEnginePromise,
          fetchExpandPromise,
          fetchSmartPromise
        ]);

        if (modelsData) {
          const modelList: string[] = [];
          if (Array.isArray(modelsData.models)) {
            modelList.push(...modelsData.models);
          } else if (Array.isArray(modelsData.providers)) {
            for (const p of modelsData.providers) {
              if (p?.models && typeof p.models === 'object') {
                for (const mId of Object.keys(p.models)) {
                  modelList.push(`${p.id}/${mId}`);
                }
              }
            }
          }
          if (modelList.length > 0) {
            setModels(modelList);
            try {
              localStorage.setItem('af-models-cache', JSON.stringify({
                models: modelList,
                timestamp: Date.now()
              }));
            } catch {}
          }
        }

        if (settingsData) {
          const mod = settingsData.models || settingsData;
          setOrchestratorModel(mod.orchestratorModel || '');
          setDefaultSubagentModel(mod.defaultSubagentModel || '');
          setAgentModelOverrides(mod.agentModelOverrides || {});
          if (settingsData.engineMode === 'run' || settingsData.engineMode === 'attach' || settingsData.engineMode === 'http') {
            setEngineMode(settingsData.engineMode);
          }
          if (typeof settingsData.enableWatchdog === 'boolean') setEnableWatchdog(settingsData.enableWatchdog);
          if (typeof settingsData.autoContinue === 'boolean') setAutoContinue(settingsData.autoContinue);
          if (typeof settingsData.watchdogStreamTimeoutSec === 'number') setWatchdogSec(settingsData.watchdogStreamTimeoutSec);
          if (typeof settingsData.taskQueueIdleCheckSec === 'number') setIdleSec(settingsData.taskQueueIdleCheckSec);
          if (typeof settingsData.taskUpdateThrottleMs === 'number') setTaskUpdateThrottleMs(settingsData.taskUpdateThrottleMs);
          if (typeof settingsData.smartClarifyEnabled === 'boolean') setSmartClarifyEnabled(settingsData.smartClarifyEnabled);
          if (typeof settingsData.smartClarifyTimeoutSec === 'number') setSmartClarifyTimeoutSec(settingsData.smartClarifyTimeoutSec);
          if (settingsData.smartClarifyPromptTemplate) setSmartClarifyPromptTemplate(settingsData.smartClarifyPromptTemplate);
          if (settingsData.smartClarifyScope === 'all' || settingsData.smartClarifyScope === 'orchestrator') setSmartClarifyScope(settingsData.smartClarifyScope);
          if (settingsData.workerReminderPrompt) setWorkerReminderPrompt(settingsData.workerReminderPrompt);
        }

        if (engineData) {
          const mode = engineData.engineMode;
          if (mode === 'run' || mode === 'attach' || mode === 'http') setEngineMode(mode);
          const url = engineData.opencodeServeUrl || engineData.serveUrl;
          if (typeof url === 'string' && url.trim()) setServeUrl(url.trim());
        }

        if (expandData) {
          setDefaultExpandToolcalls(expandData.defaultExpandToolcalls === true);
        }

        if (smartData && typeof smartData.smartClarifyEnabled === 'boolean') {
          setSmartClarifyEnabled(smartData.smartClarifyEnabled);
          if (smartData.smartClarifyScope === 'all' || smartData.smartClarifyScope === 'orchestrator') {
            setSmartClarifyScope(smartData.smartClarifyScope);
          }
        }
      } catch (e) {
        console.error('Failed to load model settings:', e);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleRoleOverrideChange = (role: string, model: string) => {
    const updated = { ...agentModelOverrides };
    if (!model) {
      delete updated[`role:${role}`];
      delete updated[role];
    } else {
      updated[`role:${role}`] = model;
      delete updated[role];
    }
    setAgentModelOverrides(updated);
  };

  const handleAgentOverrideChange = (agentId: string, model: string) => {
    const updated = { ...agentModelOverrides };
    if (!model) {
      delete updated[agentId];
    } else {
      updated[agentId] = model;
    }
    setAgentModelOverrides(updated);
  };

  const getRoleModel = (role: string): string => {
    return agentModelOverrides[`role:${role}`] || agentModelOverrides[role] || '';
  };

  const getAgentModel = (agentId: string): string => {
    return agentModelOverrides[agentId] || '';
  };

  const handleSave = async () => {
    setSaving(true);
    setSavedSuccess(false);
    try {
      const payload = {
        orchestratorModel: orchestratorModel || null,
        defaultSubagentModel: defaultSubagentModel || null,
        agentModelOverrides
      };

      const [resModels, resEngine, resExpand] = await Promise.all([
        fetch(`${API}/api/settings/models`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }),
        fetch(`${API}/api/settings/engineMode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ engineMode, serveUrl, opencodeServeUrl: serveUrl })
        }),
        fetch(`${API}/api/settings/defaultExpandToolcalls`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultExpandToolcalls })
        }),
        fetch(`${API}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enableWatchdog,
            autoContinue,
            watchdogStreamTimeoutSec: watchdogSec,
            taskQueueIdleCheckSec: idleSec,
            taskUpdateThrottleMs,
            smartClarifyEnabled,
            smartClarifyTimeoutSec,
            smartClarifyPromptTemplate,
            smartClarifyScope,
            workerReminderPrompt
          })
        }),
        fetch(`${API}/api/settings/smartClarify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ smartClarifyEnabled, smartClarifyTimeoutSec, smartClarifyPromptTemplate, smartClarifyScope })
        })
      ]);

      if (resModels.ok && resEngine.ok && resExpand.ok) {
        setSavedSuccess(true);
        if (onSaved) onSaved();
        setTimeout(() => {
          setSavedSuccess(false);
          onClose();
        }, 600);
      }
    } catch (e) {
      console.error('Failed to save model settings:', e);
    } finally {
      setSaving(false);
    }
  };

  const workerAgents = (agents || []).filter(a => a.id !== 'orchestrator');

  return (
    <div className="af-overlay" style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    }}>
      <div className="fade-in af-dialog-box" style={{
        background: 'var(--bg-panel)',
        borderRadius: 16,
        padding: 24,
        width: 600,
        maxWidth: '92vw',
        maxHeight: '90vh',
        overflow: 'auto',
        border: '1px solid var(--af-border-strong)',
        boxShadow: '0 20px 45px rgba(0,0,0,0.6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--bg-inset)', paddingBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)', fontWeight: 700, letterSpacing: '-0.01em' }}>
              ⚙️ Cấu hình Phân cấp Model (Model Hierarchy)
            </h3>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
              Thứ tự ưu tiên: Instance Override → Role Override → Default Subagent Model → System Default
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: 16,
              cursor: 'pointer',
              padding: 4
            }}
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--bg-inset)', paddingBottom: 8 }}>
          {[
            { id: 'models', label: '🤖 Models & Engine' },
            { id: 'automation', label: '⏱️ Thời gian & Tự động hoá' },
            { id: 'prompts', label: '📝 Mẫu Prompt Tuỳ biến' }
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id as any)}
              style={{
                background: activeTab === t.id ? 'var(--accent)' : 'transparent',
                color: activeTab === t.id ? '#fff' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: 8,
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'automation' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: 'var(--bg-inset)', borderRadius: 10, padding: 14, border: '1px solid var(--af-border-strong)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>
                ⏱️ Cấu hình Thời gian Watchdog & TaskQueue
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>
                    Watchdog Stream Inactivity (giây)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={3600}
                    value={watchdogSec}
                    onChange={(e) => setWatchdogSec(Number(e.target.value))}
                    style={{
                      width: '100%',
                      background: 'var(--bg-panel)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--af-border-strong)',
                      borderRadius: 6,
                      padding: '6px 10px',
                      fontSize: 12
                    }}
                  />
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Timer 1 của Watchdog: Agent đang WORKING mà ngưng sinh stream/bị treo quá ngưỡng này sẽ tự ngắt & nhắc tiếp tục (mặc định: 60s / 1 phút)</span>
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>
                    Watchdog Idle With Incomplete Job (giây)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={3600}
                    value={idleSec}
                    onChange={(e) => setIdleSec(Number(e.target.value))}
                    style={{
                      width: '100%',
                      background: 'var(--bg-panel)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--af-border-strong)',
                      borderRadius: 6,
                      padding: '6px 10px',
                      fontSize: 12
                    }}
                  />
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Timer 2 của Watchdog: Agent còn JOB/TASK dở dang mà ở trạng thái IDLE quá ngưỡng này sẽ tự động nhắc làm tiếp (mặc định: 120s / 2 phút)</span>
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>
                    Ngưỡng gom lệnh Task Update / Throttle (mili-giây)
                  </label>
                  <input
                    type="number"
                    min={100}
                    max={5000}
                    step={50}
                    value={taskUpdateThrottleMs}
                    onChange={(e) => setTaskUpdateThrottleMs(Number(e.target.value))}
                    style={{
                      width: '100%',
                      background: 'var(--bg-panel)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--af-border-strong)',
                      borderRadius: 6,
                      padding: '6px 10px',
                      fontSize: 12
                    }}
                  />
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Khoảng thời gian tối thiểu debounce / gom nhóm các lệnh task_update liên tiếp (mặc định: 600ms)</span>
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>
                    Smart Clarify Inactivity Timeout (giây)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={3600}
                    value={smartClarifyTimeoutSec}
                    onChange={(e) => setSmartClarifyTimeoutSec(Number(e.target.value))}
                    style={{
                      width: '100%',
                      background: 'var(--bg-panel)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--af-border-strong)',
                      borderRadius: 6,
                      padding: '6px 10px',
                      fontSize: 12
                    }}
                  />
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Thời gian người dùng không chat trước khi tự động kích hoạt rule hỏi lại (mặc định: 30s)</span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                    Phạm vi áp dụng (Target Scope)
                  </label>
                  <select
                    value={smartClarifyScope}
                    onChange={(e) => setSmartClarifyScope(e.target.value as 'orchestrator' | 'all')}
                    style={{
                      width: '100%',
                      background: 'var(--bg-panel)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--af-border-strong)',
                      borderRadius: 6,
                      padding: '6px 10px',
                      fontSize: 12
                    }}
                  >
                    <option value="orchestrator">Chỉ Orchestrator (Khuyên dùng)</option>
                    <option value="all">Cả Team (Tất cả agent)</option>
                  </select>
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Chọn gửi câu xác minh chỉ tới Orchestrator hay tới mọi agent trong team</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'prompts' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: 'var(--bg-inset)', borderRadius: 10, padding: 14, border: '1px solid var(--af-border-strong)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>
                💬 Mẫu Prompt Smart Clarify
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                Sử dụng biến <code>{'{content}'}</code> đại diện cho nội dung người dùng nhập.
              </div>
              <textarea
                value={smartClarifyPromptTemplate}
                onChange={(e) => setSmartClarifyPromptTemplate(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  background: 'var(--bg-panel)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--af-border-strong)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: 12,
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ background: 'var(--bg-inset)', borderRadius: 10, padding: 14, border: '1px solid var(--af-border-strong)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>
                🛡️ Mẫu Worker System Reminder
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                Đoạn nhắc nhở quy chuẩn cuối mỗi turn gửi cho worker agent.
              </div>
              <textarea
                value={workerReminderPrompt}
                onChange={(e) => setWorkerReminderPrompt(e.target.value)}
                rows={5}
                style={{
                  width: '100%',
                  background: 'var(--bg-panel)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--af-border-strong)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: 12,
                  boxSizing: 'border-box'
                }}
              />
            </div>
          </div>
        )}

        {activeTab === 'models' && (
          <>
        <div style={{ background: 'var(--bg-inset)', borderRadius: 10, padding: 14, border: '1px solid var(--af-border-strong)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>
            ⚡ Chế độ thực thi (Engine Mode)
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
            Cách AgentForge giao tiếp với OpenCode engine.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: 12 }}>
              <input
                type="radio"
                name="engineMode"
                value="run"
                checked={engineMode === 'run'}
                onChange={() => setEngineMode('run')}
                style={{ marginTop: 2 }}
              />
              <div>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>1. opencode run</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>
                  Spawn tiến trình CLI độc lập cho từng agent.
                </span>
              </div>
            </label>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: 12 }}>
              <input
                type="radio"
                name="engineMode"
                value="attach"
                checked={engineMode === 'attach'}
                onChange={() => setEngineMode('attach')}
                style={{ marginTop: 2 }}
              />
              <div>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>2. opencode attach (Mặc định)</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>
                  Gắn CLI vào daemon OpenCode Serve qua cờ --attach.
                </span>
              </div>
            </label>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: 12 }}>
              <input
                type="radio"
                name="engineMode"
                value="http"
                checked={engineMode === 'http'}
                onChange={() => setEngineMode('http')}
                style={{ marginTop: 2 }}
              />
              <div>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>3. http stream</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>
                  Giao tiếp HTTP/SSE trực tiếp tới OpenCode Serve (không qua CLI).
                </span>
              </div>
            </label>
          </div>

          {(engineMode === 'attach' || engineMode === 'http') && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--af-border-strong)' }}>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                URL OpenCode Serve:
              </label>
              <input
                type="text"
                value={serveUrl}
                onChange={(e) => setServeUrl(e.target.value)}
                placeholder="http://127.0.0.1:4096"
                style={{
                  width: '100%',
                  background: 'var(--bg-panel)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--af-border-strong)',
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>
                Chạy opencode serve --port 4096 trên máy để khởi động daemon.
              </div>
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            ⏳ Đang tải danh sách model và cấu hình...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 1. Global Hierarchy Settings */}
            <div style={{ background: 'var(--bg-inset)', borderRadius: 10, padding: 14, border: '1px solid var(--af-border-strong)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 12 }}>
                🌐 Model Cốt lõi & Mặc định
              </div>

              {/* Orchestrator Model */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  👑 Orchestrator Model (Model điều phối chính)
                </label>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                  Dùng để tiếp nhận yêu cầu từ người dùng, lập kế hoạch và điều phối các worker.
                </div>
                <select
                  value={orchestratorModel}
                  onChange={(e) => setOrchestratorModel(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-panel)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--af-border-strong)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    fontSize: 12,
                    outline: 'none'
                  }}
                >
                  <option value="">— Mặc định hệ thống (System Default / process.env) —</option>
                  {models.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              {/* Default Subagent Model */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  👥 Default Subagent Model (Model chung cho Workers)
                </label>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                  Các worker / subagent sẽ tự động kế thừa model này nếu không có cấu hình riêng.
                </div>
                <select
                  value={defaultSubagentModel}
                  onChange={(e) => setDefaultSubagentModel(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-panel)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--af-border-strong)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    fontSize: 12,
                    outline: 'none'
                  }}
                >
                  <option value="">— Kế thừa Orchestrator Model / System Default —</option>
                  {models.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 2. Role Overrides */}
            <div style={{ background: 'var(--bg-inset)', borderRadius: 10, padding: 14, border: '1px solid var(--af-border-strong)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--wb-success-strong)', marginBottom: 4 }}>
                🎭 Ghi đè Model theo Role (Role Overrides)
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
                Tối ưu hóa model phù hợp theo tính chất từng vai trò.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
                {STANDARD_ROLES.map(r => {
                  const currentModel = getRoleModel(r.value);
                  return (
                    <div key={r.value} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-panel)', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--af-border-strong)' }}>
                      <div style={{ flex: 1, paddingRight: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{r.label}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.desc}</div>
                      </div>
                      <select
                        value={currentModel}
                        onChange={(e) => handleRoleOverrideChange(r.value, e.target.value)}
                        style={{
                          width: 220,
                          background: currentModel ? 'var(--accent-strong)' : 'var(--bg-inset)',
                          color: 'var(--text-primary)',
                          border: currentModel ? '1px solid var(--accent)' : '1px solid var(--af-border-strong)',
                          borderRadius: 6,
                          padding: '6px 8px',
                          fontSize: 11,
                          outline: 'none'
                        }}
                      >
                        <option value="">— Kế thừa ({defaultSubagentModel || orchestratorModel || 'Default'}) —</option>
                        {models.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. Active Agent Overrides */}
            {workerAgents.length > 0 && (
              <div style={{ background: 'var(--bg-inset)', borderRadius: 10, padding: 14, border: '1px solid var(--af-border-strong)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--wb-warn)', marginBottom: 4 }}>
                  🎯 Ghi đè theo Instance Agent Đang chạy
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Cài đặt model riêng cho từng thực thể agent đang hoạt động.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
                  {workerAgents.map(a => {
                    const currentModel = a.model || getAgentModel(a.id);
                    return (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-panel)', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--af-border-strong)' }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {a.name} <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>({a.id})</span>
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Vai trò: {a.role}</div>
                        </div>
                        <select
                          value={currentModel}
                          onChange={(e) => handleAgentOverrideChange(a.id, e.target.value)}
                          style={{
                            width: 220,
                            background: currentModel ? 'var(--accent-strong)' : 'var(--bg-inset)',
                            color: 'var(--text-primary)',
                            border: currentModel ? '1px solid var(--accent)' : '1px solid var(--af-border-strong)',
                            borderRadius: 6,
                            padding: '6px 8px',
                            fontSize: 11,
                            outline: 'none'
                          }}
                        >
                          <option value="">— Kế thừa theo Role / Default —</option>
                          {models.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        </>
        )}

        {/* Footer actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, borderTop: '1px solid var(--bg-inset)', paddingTop: 14 }}>
          {savedSuccess && (
            <span style={{ fontSize: 12, color: 'var(--wb-success-strong)', marginRight: 'auto', fontWeight: 600 }}>
              ✓ Đã lưu cấu hình thành công!
            </span>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--af-border-strong)',
              borderRadius: 8,
              padding: '8px 16px',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 500
            }}
          >
            Đóng
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            style={{
              background: saving ? 'var(--accent-strong)' : 'linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              padding: '8px 20px',
              fontSize: 12,
              fontWeight: 600,
              cursor: saving || loading ? 'wait' : 'pointer',
              boxShadow: '0 2px 10px rgba(37, 99, 235, 0.3)'
            }}
          >
            {saving ? 'Đang lưu...' : '💾 Lưu Cài đặt'}
          </button>
        </div>
      </div>
    </div>
  );
}
