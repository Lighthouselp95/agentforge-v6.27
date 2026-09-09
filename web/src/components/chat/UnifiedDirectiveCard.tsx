import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';

export interface UnifiedDirectiveCardProps {
  type: 'talk' | 'spawn' | 'report';
  title?: string;
  role?: string;
  targetName?: string;
  senderName?: string;
  content: string;
  isMobile?: boolean;
  bubbleBg: string;
  bubbleBorder: string;
  bubbleShadow: string;
  textColor: string;
  isAlignRight?: boolean;
  isOpenCode?: boolean;
  defaultExpanded?: boolean;
}

export const UnifiedDirectiveCard = React.memo(function UnifiedDirectiveCard({
  type,
  title,
  role,
  targetName,
  senderName,
  content,
  isMobile = false,
  bubbleBg,
  bubbleBorder,
  bubbleShadow,
  textColor,
  isAlignRight = false,
  isOpenCode = false,
  defaultExpanded = false
}: UnifiedDirectiveCardProps) {
  // Khi có detail content: tuân theo defaultExpanded (hoặc user click)
  // Khi KHÔNG có title: nếu defaultExpanded=false thì vẫn có thể thu gọn preview content
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Sync khi prop defaultExpanded thay đổi từ settings
  useEffect(() => {
    setIsExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const [copiedDirective, setCopiedDirective] = useState(false);

  const isSpawn = type === 'spawn';
  const isReport = type === 'report';

  const copyDirectiveMarkdown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const typeLabel = isSpawn ? 'KHỞI TẠO AGENT' : isReport ? 'BÁO CÁO' : 'GIAO VIỆC';
    const targetLabel = targetName || 'Agent';
    const senderLabel = senderName || 'Orchestrator';
    const header = `> 🎯 **[${typeLabel}]** ${senderLabel} ➔ **${targetLabel}**${title ? ` | ${title}` : ''}`;
    const md = `${header}\n\n${(content || title || '').trim()}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(() => {
        setCopiedDirective(true);
        setTimeout(() => setCopiedDirective(false), 1500);
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = md;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopiedDirective(true);
        setTimeout(() => setCopiedDirective(false), 1500);
      });
    }
  }, [isSpawn, isReport, targetName, senderName, title, content]);

  const badgeTheme = isSpawn ? {
    icon: '🚀',
    label: 'Khởi Tạo Agent (Spawn)',
    headerColor: '#7c3aed',
    borderColor: '#e2e8f0',
    borderHover: '#cbd5e1',
    taskBg: '#f1f5f9',
    taskBorder: '#cbd5e1',
    taskText: '#0f172a',
    contentBg: '#ffffff',
    contentBorder: '#e2e8f0',
    contentText: '#1e293b'
  } : isReport ? {
    icon: '📊',
    label: 'Báo Cáo Tiến Độ / Kết Quả (Report)',
    headerColor: '#059669',
    borderColor: '#e2e8f0',
    borderHover: '#cbd5e1',
    taskBg: '#f1f5f9',
    taskBorder: '#cbd5e1',
    taskText: '#0f172a',
    contentBg: '#ffffff',
    contentBorder: '#e2e8f0',
    contentText: '#1e293b'
  } : {
    icon: '🎯',
    label: 'Giao Việc / Chỉ Đạo (Talk)',
    headerColor: '#4f46e5',
    borderColor: '#e2e8f0',
    borderHover: '#cbd5e1',
    taskBg: '#f1f5f9',
    taskBorder: '#cbd5e1',
    taskText: '#0f172a',
    contentBg: '#ffffff',
    contentBorder: '#e2e8f0',
    contentText: '#1e293b'
  };

  const hasDetailContent = !!(content && content.trim() && content.trim() !== (title || '').trim());

  const cleanDisplayContent = useMemo(() => {
    if (!content) return '';
    return String(content)
      .replace(/<\s*report(?:\s+[^>]*)?>/gi, '')
      .replace(/<\/\s*report\s*>/gi, '')
      .replace(/\[\/?REPORT\b[^\]]*\]/gi, '')
      .trim();
  }, [content]);

  return (
    <div
      className={`af-bubble${isAlignRight ? ' af-bubble-user' : ''}`}
      style={{
        background: bubbleBg || '#ffffff',
        color: textColor || '#0f172a',
        padding: '10px 14px',
        paddingRight: 36,
        borderRadius: 8,
        width: 'fit-content',
        maxWidth: isMobile ? '98%' : '88%',
        minWidth: 0,
        overflowWrap: 'anywhere',
        boxSizing: 'border-box',
        fontSize: isOpenCode ? 12 : 12.5,
        lineHeight: 1.55,
        whiteSpace: 'normal',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        border: bubbleBorder || '1px solid #e2e8f0',
        boxShadow: bubbleShadow || '0 1px 3px rgba(0, 0, 0, 0.05)',
        wordBreak: 'break-word',
        position: 'relative',
        userSelect: 'text',
        alignSelf: isAlignRight ? 'flex-end' : 'flex-start',
        marginLeft: isAlignRight ? 'auto' : undefined,
        marginRight: isAlignRight ? undefined : 'auto',
        marginBottom: 4
      }}
    >
      {/* Nút copy markdown dạng chữ đặt ở góc trên bên phải bên trong của thẻ */}
      <button
        onClick={copyDirectiveMarkdown}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2px 8px',
          borderRadius: 4,
          background: copiedDirective ? 'rgba(34, 197, 94, 0.15)' : '#f8fafc',
          border: copiedDirective ? '1px solid #22c55e' : '1px solid #cbd5e1',
          color: copiedDirective ? '#16a34a' : '#475569',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          zIndex: 2,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          userSelect: 'none'
        }}
        title={copiedDirective ? 'Đã sao chép vào clipboard!' : 'Sao chép nội dung Markdown'}
      >
        {copiedDirective ? 'Copied!' : 'Copy'}
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: isMobile ? '100%' : 380, maxWidth: isMobile ? '100%' : '90%' }}>
        {/* Header Thẻ: Icon + Loại Thẻ + Luồng Giao Việc */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          paddingBottom: 6,
          borderBottom: '1px solid #f1f5f9'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14 }}>{badgeTheme.icon}</span>
            <span style={{
              fontWeight: 700,
              fontSize: 12,
              color: badgeTheme.headerColor,
              letterSpacing: '0.02em',
              textTransform: 'uppercase'
            }}>
              {badgeTheme.label}
            </span>

            {/* Luồng người gửi -> người nhận dạng Badge mềm mại */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#f8fafc',
              padding: '2px 8px',
              borderRadius: 6,
              border: '1px solid #e2e8f0',
              fontSize: 11
            }}>
              <span style={{ fontWeight: 600, color: '#334155' }}>
                {senderName || 'Orchestrator'}
              </span>
              <span style={{ color: '#94a3b8', fontSize: 10 }}>➔</span>
              <span style={{ fontWeight: 700, color: badgeTheme.headerColor }}>
                {targetName || role || 'Worker'}
              </span>
              {role && role !== targetName && (
                <span style={{ color: '#64748b', fontSize: 10 }}>({role})</span>
              )}
            </div>
          </div>
        </div>

        {/* Tiêu Đề / Task Chính */}
        {title && (
          <div
            onClick={() => hasDetailContent && setIsExpanded(!isExpanded)}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              background: badgeTheme.taskBg,
              border: `1px solid ${badgeTheme.taskBorder}`,
              color: badgeTheme.taskText,
              cursor: hasDetailContent ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              transition: 'background 0.15s ease'
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 12.5, flex: 1, wordBreak: 'break-word', color: '#0f172a' }}>
              {title}
            </div>
            {hasDetailContent && (
              <span style={{
                fontSize: 11,
                color: '#64748b',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                padding: '2px 8px',
                borderRadius: 4,
                userSelect: 'none',
                flexShrink: 0
              }}>
                {isExpanded ? '▲ Thu gọn' : '▼ Xem chi tiết'}
              </span>
            )}
          </div>
        )}

        {/* Chi Tiết Mở Rộng: Chỉ hiển thị khi có content thực sự và (được mở rộng HOẶC không có title) */}
        {hasDetailContent && isExpanded && (
          <div
            className="af-directive-expanded-content"
            style={{
              background: badgeTheme.contentBg,
              color: badgeTheme.contentText,
              padding: '10px 14px',
              borderRadius: 6,
              border: `1px solid ${badgeTheme.contentBorder}`,
              marginTop: 2,
              boxShadow: 'none',
              lineHeight: 1.6
            }}
          >
            <div style={{ color: badgeTheme.contentText }}>
              <MarkdownRenderer content={cleanDisplayContent} isMobile={isMobile} />
            </div>
          </div>
        )}

        {/* Trường hợp không có title riêng mà chỉ có content: nếu không mở rộng thì cho thu gọn/xem chi tiết */}
        {!title && cleanDisplayContent && (
          <div>
            <div
              onClick={() => setIsExpanded(!isExpanded)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 8px',
                marginBottom: isExpanded ? 4 : 0,
                background: badgeTheme.taskBg,
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 11,
                color: '#64748b',
                userSelect: 'none'
              }}
            >
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                {isExpanded ? 'Chi tiết nội dung:' : cleanDisplayContent.slice(0, 70) + '...'}
              </span>
              <span style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                padding: '1px 6px',
                borderRadius: 4,
                flexShrink: 0
              }}>
                {isExpanded ? '▲ Thu gọn' : '▼ Xem chi tiết'}
              </span>
            </div>

            {isExpanded && (
              <div
                className="af-directive-expanded-content"
                style={{
                  background: badgeTheme.contentBg,
                  color: badgeTheme.contentText,
                  padding: '10px 14px',
                  borderRadius: 6,
                  border: `1px solid ${badgeTheme.contentBorder}`,
                  boxShadow: 'none',
                  lineHeight: 1.6
                }}
              >
                <div style={{ color: badgeTheme.contentText }}>
                  <MarkdownRenderer content={cleanDisplayContent} isMobile={isMobile} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
