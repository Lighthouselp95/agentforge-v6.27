import React, { useState } from 'react';

interface FloatingBroadcastProps {
  agentsCount: number;
  onSendBroadcast: (message: string) => Promise<boolean | void>;
}

export const FloatingBroadcastBar: React.FC<FloatingBroadcastProps> = ({ agentsCount, onSendBroadcast }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    setFeedback(null);
    try {
      await onSendBroadcast(trimmed);
      setFeedback('Đã phát tin thành công tới toàn bộ agents!');
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
      bottom: '24px',
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
          <span>Broadcast All ({agentsCount})</span>
        </button>
      ) : (
        <div style={{
          width: '380px',
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
              <span style={{ fontWeight: 600, fontSize: '14px' }}>Gửi tin tới toàn bộ Agent ({agentsCount})</span>
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

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                handleSend();
              }
            }}
            placeholder="Nhập nội dung thông báo khẩn cấp / chỉ thị chung (Ctrl+Enter để gửi)..."
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
              {isSending ? 'Đang phát tin...' : 'Gửi đồng loạt'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
