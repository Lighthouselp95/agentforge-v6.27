import React, { useState, useMemo, useCallback } from 'react';
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
  isStreaming?: boolean;
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
  isStreaming = false
}: UnifiedDirectiveCardProps) {
  const [copiedDirective, setCopiedDirective] = useState(false);

  const isSpawn = type === 'spawn';
  const isReport = type === 'report';

  const typeLabel = isSpawn ? '🚀 Khởi tạo agent' : isReport ? '📊 Báo cáo' : '🎯 Giao việc';
  const targetLabel = targetName || role || 'Worker';
  const senderLabel = senderName || 'Orchestrator';

  const copyDirectiveMarkdown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const md = `> ${typeLabel}: ${senderLabel} ➔ ${targetLabel}${title ? ` | ${title}` : ''}\n\n${(content || title || '').trim()}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(() => {
        setCopiedDirective(true);
        setTimeout(() => setCopiedDirective(false), 1500);
      }).catch(() => {});
    }
  }, [typeLabel, senderLabel, targetLabel, title, content]);

  const cleanDisplayContent = useMemo(() => {
    if (!content) return '';
    return String(content)
      .replace(/<\s*talk\b[^>]*>/gi, '')
      .replace(/<\/\s*talk\s*>/gi, '')
      .replace(/\[\/?TALK\b[^\]]*\]/gi, '')
      .replace(/<\s*spawn\b[^>]*>/gi, '')
      .replace(/<\/\s*spawn\s*>/gi, '')
      .replace(/\[\/?SPAWN\b[^\]]*\]/gi, '')
      .replace(/<\s*report(?:\s+[^>]*)?>/gi, '')
      .replace(/<\/\s*report\s*>/gi, '')
      .replace(/\[\/?REPORT\b[^\]]*\]/gi, '')
      .trim();
  }, [content]);

  const displayTitle = title && title.trim() !== cleanDisplayContent.trim() ? title.trim() : '';

  return (
    <div
      className={`af-bubble${isAlignRight ? ' af-bubble-user' : ''}`}
      style={{
        background: bubbleBg || '#ffffff',
        color: textColor || '#0f172a',
        padding: '10px 14px',
        borderRadius: 8,
        width: 'fit-content',
        maxWidth: isMobile ? '98%' : '88%',
        minWidth: 0,
        overflowWrap: 'anywhere',
        boxSizing: 'border-box',
        fontSize: isOpenCode ? 12 : 12.5,
        lineHeight: 1.55,
        whiteSpace: 'normal',
        border: bubbleBorder || '1px solid #e2e8f0',
        boxShadow: bubbleShadow || '0 1px 3px rgba(0, 0, 0, 0.05)',
        wordBreak: 'break-word',
        userSelect: 'text',
        alignSelf: isAlignRight ? 'flex-end' : 'flex-start',
        marginLeft: isAlignRight ? 'auto' : undefined,
        marginRight: isAlignRight ? undefined : 'auto',
        marginBottom: 6
      }}
    >
      {/* 1 thanh Header phẳng duy nhất */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        paddingBottom: 6,
        marginBottom: 8,
        borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
        fontSize: 11.5,
        fontWeight: 600
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ color: isSpawn ? '#7c3aed' : isReport ? '#059669' : '#4f46e5' }}>
            {typeLabel}
          </span>
          <span style={{ color: '#94a3b8' }}>·</span>
          <span style={{ color: '#64748b' }}>{senderLabel}</span>
          <span style={{ color: '#94a3b8' }}>➔</span>
          <span style={{ color: isSpawn ? '#7c3aed' : isReport ? '#059669' : '#4f46e5' }}>
            {targetLabel}
          </span>
        </div>
        <button
          onClick={copyDirectiveMarkdown}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 7px',
            borderRadius: 4,
            background: copiedDirective ? 'rgba(34, 197, 94, 0.15)' : '#f8fafc',
            border: copiedDirective ? '1px solid #22c55e' : '1px solid #cbd5e1',
            color: copiedDirective ? '#16a34a' : '#64748b',
            fontSize: 10.5,
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0
          }}
          title="Sao chép"
        >
          {copiedDirective ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Tiêu đề nhiệm vụ (nếu có) */}
      {displayTitle && (
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: '#0f172a' }}>
          {displayTitle}
        </div>
      )}

      {/* Nội dung trực tiếp, thuần 1 ô khung chat, không lồng thêm bất kỳ card nào */}
      {(cleanDisplayContent || isStreaming) && (
        <div style={{ color: textColor || '#1e293b' }}>
          <MarkdownRenderer content={cleanDisplayContent} isMobile={isMobile} />
        </div>
      )}
    </div>
  );
});
