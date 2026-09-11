import React, { useState, useMemo } from 'react';

interface AgentItem {
  id: string;
  name: string;
  role?: string;
  type?: string;
  teamId?: string;
}

interface FloatingBroadcastProps {
  agentsCount: number;
  agents?: AgentItem[];
  onSendBroadcast: (message: string, teamId?: string) => Promise<boolean | void>;
}

export const FloatingBroadcastBar: React.FC<FloatingBroadcastProps> = ({ agentsCount, agents = [], onSendBroadcast }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [isSending, setIsSending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Trích xuất danh sách team khả dụng từ danh sách agents
  const teamsList = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number; orchName?: string }>();
    
    // Luôn có option All Teams
    for (const a of agents) {
      const tid = a.teamId || 'default';
      if (!map.has(tid)) {
        map.set(tid, { id: tid, name: tid === 'default' ? 'Team Default' : `Team ${tid}`, count: 0 });
      }
      const item = map.get(tid)!;
      item.count++;
      if (a.type === 'orchestrator' || a.id === 'orchestrator' || a.role === 'orchestrator') {
        item.orchName = a.name;
      }
    }
    return Array.from(map.values());
  }, [agents]);

  // Số lượng agent trong team đang được chọn
  const currentTargetCount = useMemo(() => {
    if (selectedTeam === 'all') return agents.length || agentsCount;
    return agents.filter(a => (a.teamId || 'default') === selectedTeam).length;
  }, [selectedTeam, agents, agentsCount]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    setFeedback(null);
    try {
      await onSendBroadcast(trimmed, selectedTeam);
      setFeedback(`Đã phát tin thành công tới ${selectedTeam === 'all' ? 'toàn bộ' : `Team [${selectedTeam}]`} (${currentTargetCount} agents)!`);
      setMessage('');
      setTimeout(() => {
        setFeedback(null);
        setIsOpen(false);
      }, 1500);
    } catch (err: any) {
      setFeedback(`Lỗi: ${err?.message || 'Không thể gửi'}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: '64px',
      right: '24px',
      zIndex: 9999,
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'linear-gradient(135deg, #ec4899, #8b5cf6)',
            color: '#fff',
            border: 'none',
            borderRadius: '9999px',
            padding: '10px 18px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(236, 72, 153, 0.4)',
            transition: 'transform 0.15s ease'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <span style={{ fontSize: '16px' }}>📢</span>
          <span>Broadcast ({agentsCount})</span>
        </button>
      ) : (
        <div style={{
          width: '390px',
          background: '#18181b',
          border: '1px solid #3f3f46',
          borderRadius: '16px',
          padding: '16px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
          color: '#f4f4f5'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>📢</span>
              <span style={{ fontWeight: 600, fontSize: '14px' }}>
                Phát tin Broadcast ({currentTargetCount} agents)
              </span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#a1a1aa',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '4px'
              }}
            >
              ✕
            </button>
          </div>

          {/* Chọn Team gửi tin */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#a1a1aa', display: 'block', marginBottom: '4px' }}>
              Gửi tới đối tượng:
            </label>
            <select
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
              style={{
                width: '100%',
                background: '#27272a',
                border: '1px solid #52525b',
                borderRadius: '8px',
                color: '#fafafa',
                padding: '6px 10px',
                fontSize: '12.5px',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="all">🌐 Toàn bộ hệ thống ({agents.length || agentsCount} agents)</option>
              {teamsList.map(t => (
                <option key={t.id} value={t.id}>
                  👥 {t.name} ({t.count} agents{t.orchName ? ` · Orch: ${t.orchName}` : ''})
                </option>
              ))}
            </select>
          </div>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                handleSend();
              }
            }}
            placeholder="Nhập nội dung thông báo / chỉ thị (Ctrl+Enter để gửi)..."
            rows={3}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: '#27272a',
              border: '1px solid #52525b',
              borderRadius: '8px',
              color: '#fafafa',
              padding: '10px',
              fontSize: '13px',
              resize: 'vertical',
              outline: 'none',
              marginBottom: '10px'
            }}
          />

          {feedback && (
            <div style={{
              fontSize: '12px',
              marginBottom: '8px',
              color: feedback.startsWith('Lỗi') ? '#f87171' : '#4ade80'
            }}>
              {feedback}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              style={{
                background: '#27272a',
                border: '1px solid #3f3f46',
                borderRadius: '8px',
                color: '#d4d4d8',
                padding: '6px 12px',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={!message.trim() || isSending}
              onClick={() => handleSend()}
              style={{
                background: isSending || !message.trim() ? '#52525b' : 'linear-gradient(135deg, #ec4899, #8b5cf6)',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                padding: '6px 16px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: isSending || !message.trim() ? 'not-allowed' : 'pointer'
              }}
            >
              {isSending ? 'Đang phát tin...' : selectedTeam === 'all' ? 'Gửi toàn bộ' : 'Gửi cho Team'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
