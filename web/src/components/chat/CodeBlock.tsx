import React, { useState, useMemo } from 'react';
import { highlight, isSupportedLang } from '../../utils/highlight';

export function getLangBadge(lang: string) {
  const l = (lang || '').toLowerCase().trim();
  if (l === 'ts' || l === 'tsx' || l === 'typescript') return <span style={{ background: '#3178c6', color: '#ffffff', padding: '1px 5px', borderRadius: 3, fontWeight: 700, fontSize: 10, marginRight: 6 }}>TS</span>;
  if (l === 'js' || l === 'jsx' || l === 'javascript') return <span style={{ background: '#f7df1e', color: '#000000', padding: '1px 5px', borderRadius: 3, fontWeight: 700, fontSize: 10, marginRight: 6 }}>JS</span>;
  if (l === 'bash' || l === 'sh' || l === 'shell' || l === 'zsh') return <span style={{ color: '#22c55e', fontWeight: 700, fontSize: 11, marginRight: 6 }}>&gt;_</span>;
  if (l === 'json') return <span style={{ color: '#f97316', fontWeight: 700, fontSize: 11, marginRight: 6 }}>&#123; &#125;</span>;
  if (l === 'py' || l === 'python') return <span style={{ marginRight: 6 }}>🐍</span>;
  if (l === 'html' || l === 'xml') return <span style={{ marginRight: 6 }}>🌐</span>;
  if (l === 'css' || l === 'scss') return <span style={{ marginRight: 6 }}>🎨</span>;
  if (l === 'md' || l === 'markdown') return <span style={{ marginRight: 6 }}>📝</span>;
  return <span style={{ marginRight: 6 }}>📄</span>;
}

export function clampToolLines(text: string, max: number = 200): { text: string; cut: number; total: number } {
  if (!text) return { text, cut: 0, total: 0 };
  const str = String(text);
  const lines = str.split('\n');
  const total = lines.length;
  if (total <= max) return { text: str, cut: 0, total };
  const kept = lines.slice(0, max).join('\n');
  return { text: `${kept}\n… (đã cắt ${total - max} dòng, tổng ${total} dòng)`, cut: total - max, total };
}

export const CodeBlock = React.memo(function CodeBlock({ code, lang, isMobile }: { code: string; lang: string; isMobile?: boolean }) {
  const [copied, setCopied] = useState(false);

  // Giới hạn tối đa hiển thị code trước khi tokenize
  const displayCode = clampToolLines(code, 90).text;

  // Chỉ tokenize khi ngôn ngữ được hỗ trợ
  const supported = useMemo(() => isSupportedLang(lang), [lang]);
  const tokens = useMemo(() => (supported ? highlight(displayCode, lang) : []), [supported, displayCode, lang]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div style={{
      borderRadius: 8,
      border: '1px solid var(--af-border)',
      background: 'var(--bg-inset)',
      margin: '8px 0',
      overflow: 'hidden',
      width: '100%',
      boxSizing: 'border-box'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        background: 'rgba(255, 255, 255, 0.03)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        fontSize: 11,
        color: 'var(--text-secondary)',
        fontFamily: 'monospace'
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {getLangBadge(lang)}
          <span style={{ fontWeight: 600, textTransform: 'lowercase' }}>{lang || 'code'}</span>
        </div>
        <button
          onClick={handleCopy}
          style={{
            background: copied ? 'rgba(34, 197, 94, 0.15)' : 'transparent',
            border: copied ? '1px solid rgba(34, 197, 94, 0.3)' : 'none',
            color: copied ? '#10b981' : '#93c5fd',
            borderRadius: 4,
            padding: '2px 6px',
            fontSize: 11,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            transition: 'all 0.15s ease'
          }}
        >
          <span>{copied ? '✓' : '📋'}</span>
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre style={{
        margin: 0,
        padding: '10px 14px',
        overflowX: 'auto',
        maxWidth: '100%',
        fontSize: isMobile ? 12 : 11.5,
        lineHeight: 1.55,
        color: 'var(--text-primary)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
      }}>
        {supported ? (
          <code>{tokens.map((t, i) => (
            <span
              key={i}
              style={{
                color: t.color || undefined,
                fontStyle: t.italic ? 'italic' : undefined,
                fontWeight: t.bold ? 700 : undefined
              }}
            >
              {t.text}
            </span>
          ))}</code>
        ) : (
          <code>{displayCode}</code>
        )}
      </pre>
    </div>
  );
});
