import React, { useState, useEffect } from 'react';

interface StartupModalProps {
  isOpen: boolean;
  initialSettings: {
    engineMode?: string;
    enableWatchdog?: boolean;
    autoContinue?: boolean;
    smartClarifyEnabled?: boolean;
    watchdogStreamTimeoutSec?: number;
    taskQueueIdleCheckSec?: number;
  };
  onStart: (settings: {
    engineMode: string;
    enableWatchdog: boolean;
    autoContinue: boolean;
    smartClarifyEnabled: boolean;
    watchdogStreamTimeoutSec: number;
    taskQueueIdleCheckSec: number;
    rememberChoice: boolean;
  }) => Promise<void>;
}

export const StartupModal: React.FC<StartupModalProps> = ({ isOpen, initialSettings, onStart }) => {
  const [engineMode, setEngineMode] = useState(initialSettings.engineMode || 'attach');
  const [enableWatchdog, setEnableWatchdog] = useState(initialSettings.enableWatchdog ?? true);
  const [autoContinue, setAutoContinue] = useState(initialSettings.autoContinue ?? true);
  const [smartClarifyEnabled, setSmartClarifyEnabled] = useState(initialSettings.smartClarifyEnabled ?? false);
  const [watchdogSec, setWatchdogSec] = useState(initialSettings.watchdogStreamTimeoutSec || 60);
  const [idleSec, setIdleSec] = useState(initialSettings.taskQueueIdleCheckSec || 120);
  const [rememberChoice, setRememberChoice] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  // Đồng bộ giá trị từ initialSettings khi modal mở hoặc khi backend nạp xong settings
  useEffect(() => {
    if (initialSettings && isOpen) {
      if (initialSettings.engineMode) setEngineMode(initialSettings.engineMode);
      if (initialSettings.enableWatchdog !== undefined) setEnableWatchdog(initialSettings.enableWatchdog);
      if (initialSettings.autoContinue !== undefined) setAutoContinue(initialSettings.autoContinue);
      if (initialSettings.smartClarifyEnabled !== undefined) setSmartClarifyEnabled(initialSettings.smartClarifyEnabled);
      if (initialSettings.watchdogStreamTimeoutSec !== undefined) setWatchdogSec(initialSettings.watchdogStreamTimeoutSec);
      if (initialSettings.taskQueueIdleCheckSec !== undefined) setIdleSec(initialSettings.taskQueueIdleCheckSec);
    }
  }, [initialSettings, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsStarting(true);
    try {
      await onStart({
        engineMode,
        enableWatchdog,
        autoContinue,
        smartClarifyEnabled,
        watchdogStreamTimeoutSec: Number(watchdogSec) || 60,
        taskQueueIdleCheckSec: Number(idleSec) || 120,
        rememberChoice
      });
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(9, 9, 11, 0.85)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100000,
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{
        width: '520px',
        maxWidth: '92vw',
        background: '#18181b',
        border: '1px solid #3f3f46',
        borderRadius: '20px',
        padding: '24px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
        color: '#f4f4f5'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px'
          }}>
            🚀
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Khởi động AgentForge</h2>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#a1a1aa' }}>
              Chọn chế độ vận hành và tính năng trước khi hệ thống bắt đầu làm việc
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Engine Mode */}
          <div style={{ marginBottom: '16px', background: '#27272a', padding: '12px', borderRadius: '12px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: '#e4e4e7' }}>
              Chế độ vận hành (Engine Mode)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              {[
                { id: 'attach', label: 'Attach (Khuyên dùng)', desc: 'Gắn vào OpenCode server' },
                { id: 'http', label: 'HTTP REST', desc: 'Direct API & SSE' },
                { id: 'run', label: 'Standalone CLI', desc: 'Spawn CLI độc lập' }
              ].map((m) => (
                <div
                  key={m.id}
                  onClick={() => setEngineMode(m.id)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: `1px solid ${engineMode === m.id ? '#3b82f6' : '#3f3f46'}`,
                    background: engineMode === m.id ? 'rgba(59, 130, 246, 0.15)' : '#18181b',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 600, color: engineMode === m.id ? '#60a5fa' : '#d4d4d8' }}>
                    {m.label}
                  </div>
                  <div style={{ fontSize: '10px', color: '#71717a', marginTop: '2px' }}>{m.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Toggles */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
            {/* Watchdog Stream Inactivity */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#27272a',
              padding: '12px',
              borderRadius: '12px'
            }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f4f4f5' }}>Bật Watchdog (Stream Inactivity & Idle Job)</div>
                <div style={{ fontSize: '11px', color: '#a1a1aa' }}>Timer 1: Ngắt & nhắc khi working bị treo stream ({watchdogSec}s) | Timer 2: Nhắc khi idle có task ({idleSec}s)</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {enableWatchdog && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      min={5}
                      max={3600}
                      value={watchdogSec}
                      onChange={(e) => setWatchdogSec(Number(e.target.value))}
                      style={{
                        width: '54px',
                        background: '#18181b',
                        border: '1px solid #52525b',
                        borderRadius: '6px',
                        color: '#fafafa',
                        fontSize: '12px',
                        padding: '4px 6px',
                        textAlign: 'center'
                      }}
                    />
                    <span style={{ fontSize: '11px', color: '#71717a' }}>s /</span>
                    <input
                      type="number"
                      min={5}
                      max={3600}
                      value={idleSec}
                      onChange={(e) => setIdleSec(Number(e.target.value))}
                      style={{
                        width: '54px',
                        background: '#18181b',
                        border: '1px solid #52525b',
                        borderRadius: '6px',
                        color: '#fafafa',
                        fontSize: '12px',
                        padding: '4px 6px',
                        textAlign: 'center'
                      }}
                    />
                    <span style={{ fontSize: '11px', color: '#71717a' }}>s</span>
                  </div>
                )}
                <input
                  type="checkbox"
                  checked={enableWatchdog}
                  onChange={(e) => setEnableWatchdog(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
              </div>
            </div>

            {/* Auto-continue Startup */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#27272a',
              padding: '12px',
              borderRadius: '12px'
            }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f4f4f5' }}>Auto-Continue Khi Mở App</div>
                <div style={{ fontSize: '11px', color: '#a1a1aa' }}>Tiếp tục lại đúng agent đang working hoặc có tin nhắn dở dang trong queue từ phiên trước</div>
              </div>
              <input
                type="checkbox"
                checked={autoContinue}
                onChange={(e) => setAutoContinue(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
            </div>

            {/* Smart Clarify */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#27272a',
              padding: '12px',
              borderRadius: '12px'
            }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f4f4f5' }}>Smart Clarify Mode</div>
                <div style={{ fontSize: '11px', color: '#a1a1aa' }}>Tự đóng gói câu hỏi xác minh làm rõ ý người dùng</div>
              </div>
              <input
                type="checkbox"
                checked={smartClarifyEnabled}
                onChange={(e) => setSmartClarifyEnabled(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
            </div>
          </div>

          {/* Remember Choice */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', paddingLeft: '4px' }}>
            <input
              type="checkbox"
              id="rememberChoice"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            />
            <label htmlFor="rememberChoice" style={{ fontSize: '12px', color: '#a1a1aa', cursor: 'pointer' }}>
              Ghi nhớ lựa chọn này và không hiển thị lại khi mở app
            </label>
          </div>

          <button
            type="submit"
            disabled={isStarting}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '12px',
              border: 'none',
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              color: '#fff',
              fontSize: '15px',
              fontWeight: 700,
              cursor: isStarting ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 14px rgba(59, 130, 246, 0.4)',
              transition: 'opacity 0.2s'
            }}
          >
            {isStarting ? 'Đang khởi động hệ thống...' : '🚀 Bắt đầu làm việc (Start Session)'}
          </button>
        </form>
      </div>
    </div>
  );
};
