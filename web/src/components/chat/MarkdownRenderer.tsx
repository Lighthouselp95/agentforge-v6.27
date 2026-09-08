import React from 'react';
import { CodeBlock } from './CodeBlock';

export function renderInlineMarkdown(text: string): React.ReactNode[] {
  if (!text) return [];
  const safeText = String(text).normalize('NFC');
  const nodes: React.ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|(?<!\w)__[^_]+__(?!\w)|\*[^*]+\*|(?<!\w)_[^_]+_(?!\w)|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/gu;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(safeText)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(safeText.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `inline-${match.index}-${token.length}`;

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code key={key} style={{
          background: 'rgba(255, 255, 255, 0.08)',
          color: '#93c5fd',
          padding: '2px 6px',
          borderRadius: 4,
          fontSize: '0.9em',
          fontFamily: 'monospace'
        }}>
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('***') && token.endsWith('***')) {
      nodes.push(<strong key={key} style={{ color: 'var(--text-primary)', fontWeight: 700 }}><em>{token.slice(3, -3)}</em></strong>);
    } else if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
      nodes.push(<strong key={key} style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{token.slice(2, -2)}</strong>);
    } else if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      nodes.push(<del key={key} style={{ opacity: 0.6 }}>{token.slice(2, -2)}</del>);
    } else if (token.startsWith('[') && token.includes('](')) {
      const parts = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/u);
      if (parts) {
        nodes.push(
          <a key={key} href={parts[2]} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline' }}>
            {parts[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(token);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < safeText.length) {
    nodes.push(safeText.slice(lastIndex));
  }

  return nodes;
}

export function splitMarkdownSections(content: string): Array<{ type: 'code' | 'md'; content: string; lang?: string }> {
  const sections: Array<{ type: 'code' | 'md'; content: string; lang?: string }> = [];
  const safeContent = String(content || '').normalize('NFC');
  const lines = safeContent.split(/\r?\n/);
  
  let inCode = false;
  let codeFenceLength = 0;
  let codeLang = '';
  let codeLines: string[] = [];
  let mdLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (!inCode) {
      const match = line.match(/^\s*(`{3,}|~{3,})([a-zA-Z0-9_+#.-]*)\s*$/);
      if (match) {
        if (mdLines.length > 0) {
          sections.push({ type: 'md', content: mdLines.join('\n') });
          mdLines = [];
        }
        inCode = true;
        codeFenceLength = match[1].length;
        codeLang = match[2] || '';
        codeLines = [];
      } else {
        mdLines.push(line);
      }
    } else {
      const closeMatch = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (closeMatch && closeMatch[1].length === codeFenceLength) {
        sections.push({ type: 'code', lang: codeLang, content: codeLines.join('\n') });
        inCode = false;
        codeFenceLength = 0;
        codeLang = '';
        codeLines = [];
      } else {
        codeLines.push(line);
      }
    }
  }

  if (inCode) {
    sections.push({ type: 'code', lang: codeLang, content: codeLines.join('\n') });
  } else if (mdLines.length > 0) {
    sections.push({ type: 'md', content: mdLines.join('\n') });
  }

  return sections;
}

export const MarkdownRenderer = React.memo(function MarkdownRenderer({ content, isMobile }: { content: string; isMobile?: boolean }) {
  if (!content) return null;

  const cleanContent = String(content)
    .replace(/<\s*report(?:\s+[^>]*)?>/gi, '')
    .replace(/<\/\s*report\s*>/gi, '')
    .replace(/\[\/?REPORT\b[^\]]*\]/gi, '')
    .trim();

  if (!cleanContent) return null;

  const sections = splitMarkdownSections(cleanContent);

  return (
    <div className="af-markdown" style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      fontSize: isMobile ? 12 : 12.5,
      lineHeight: 1.45,
      minWidth: 0,
      maxWidth: '100%',
      color: 'var(--text-primary)'
    }}>
      {sections.map((sec, secIdx) => {
        if (sec.type === 'code') {
          return <CodeBlock key={`sec-${secIdx}`} code={sec.content} lang={sec.lang || ''} isMobile={isMobile} />;
        }

        const lines = sec.content.split(/\r?\n/);
        const elements: React.ReactNode[] = [];
        let i = 0;

        while (i < lines.length) {
          const line = lines[i];
          const trimmed = line.trim();

          if (!trimmed) {
            i++;
            continue;
          }

          if (/^(?:(?:\s*-\s*){3,}|(?:\s*\*\s*){3,}|(?:\s*_\s*){3,})$/.test(trimmed)) {
            elements.push(
              <hr
                key={`hr-${i}`}
                style={{
                  border: 'none',
                  borderTop: '1px solid var(--af-border)',
                  margin: '10px 0',
                  opacity: 0.8
                }}
              />
            );
            i++;
            continue;
          }

          if (line.startsWith('# ')) {
            elements.push(<h1 key={`h1-${i}`} style={{ fontSize: 14.5, fontWeight: 800, letterSpacing: '-0.015em', margin: '14px 0 6px', color: 'inherit', borderBottom: '1px solid currentColor', opacity: 0.95, paddingBottom: 4, lineHeight: 1.4 }}>{renderInlineMarkdown(line.slice(2))}</h1>);
            i++;
            continue;
          }
          if (line.startsWith('## ')) {
            elements.push(<h2 key={`h2-${i}`} style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '-0.01em', margin: '12px 0 5px', color: 'inherit', opacity: 0.95, lineHeight: 1.4, borderBottom: '1px dashed rgba(148, 163, 184, 0.3)', paddingBottom: 3 }}>{renderInlineMarkdown(line.slice(3))}</h2>);
            i++;
            continue;
          }
          if (line.startsWith('### ')) {
            elements.push(<h3 key={`h3-${i}`} style={{ fontSize: 13, fontWeight: 700, margin: '10px 0 4px', color: 'inherit', opacity: 0.9, lineHeight: 1.4 }}>{renderInlineMarkdown(line.slice(4))}</h3>);
            i++;
            continue;
          }
          if (line.startsWith('#### ')) {
            elements.push(<h4 key={`h4-${i}`} style={{ fontSize: 12.5, fontWeight: 700, margin: '8px 0 3px', color: 'inherit', opacity: 0.85, lineHeight: 1.4 }}>{renderInlineMarkdown(line.slice(5))}</h4>);
            i++;
            continue;
          }

          const isAllCapsHeader = /^[A-Z0-9_\sÀ-ỸÁ-ỴĂ-ỮĐ]{3,}:?\s*$/.test(trimmed) && trimmed.length > 2 && trimmed.length < 80 && !trimmed.startsWith('HTTP');
          const isColonHeader = /^([A-ZÀ-Ỹa-zà-ỹ0-9_ -]{2,50}):$/.test(trimmed);
          if (isAllCapsHeader || isColonHeader) {
            elements.push(
              <div key={`head-${i}`} style={{ fontWeight: 700, fontSize: 12.5, color: 'inherit', marginTop: 8, marginBottom: 4, lineHeight: 1.4, letterSpacing: '0.01em' }}>
                {renderInlineMarkdown(line)}
              </div>
            );
            i++;
            continue;
          }

          if (/^(?:-{3,}|\*{3,}|_{3,}|(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(trimmed)) {
            elements.push(
              <hr
                key={`hr-${i}`}
                style={{
                  border: 'none',
                  borderTop: '1px solid rgba(148, 163, 184, 0.25)',
                  margin: '12px 0',
                  width: '100%'
                }}
              />
            );
            i++;
            continue;
          }

          if (line.startsWith('> ') || line === '>') {
            const bqLines: string[] = [];
            while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
              bqLines.push(lines[i].replace(/^>\s?/, ''));
              i++;
            }
            elements.push(
              <blockquote key={`bq-${i}`} style={{
                borderLeft: '3px solid #3b82f6',
                background: 'rgba(59, 130, 246, 0.06)',
                padding: '8px 14px',
                margin: '8px 0',
                borderRadius: '0 6px 6px 0',
                color: 'inherit',
                opacity: 0.9,
                lineHeight: 1.55
              }}>
                {bqLines.map((bql, bqIdx) => <div key={bqIdx}>{renderInlineMarkdown(bql)}</div>)}
              </blockquote>
            );
            continue;
          }

          if (trimmed.startsWith('|') && trimmed.endsWith('|') && i + 1 < lines.length && lines[i + 1].includes('---')) {
            const tableLines: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
              tableLines.push(lines[i].trim());
              i++;
            }
            if (tableLines.length >= 2) {
              const headerCols = tableLines[0].slice(1, -1).split('|').map(c => c.trim());
              const bodyRows = tableLines.slice(2).map(r => r.slice(1, -1).split('|').map(c => c.trim()));
              elements.push(
                <div key={`tbl-${i}`} style={{ overflowX: 'auto', margin: '10px 0' }}>
                  <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 12.5,
                    border: '1px solid rgba(148, 163, 184, 0.25)',
                    borderRadius: 6
                  }}>
                    <thead>
                      <tr style={{ background: 'rgba(148, 163, 184, 0.1)' }}>
                        {headerCols.map((hc, hcIdx) => (
                          <th key={hcIdx} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid rgba(148, 163, 184, 0.25)', color: 'inherit' }}>
                            {renderInlineMarkdown(hc)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bodyRows.map((row, rowIdx) => (
                        <tr key={rowIdx} style={{ background: rowIdx % 2 === 1 ? 'rgba(148, 163, 184, 0.04)' : 'transparent', borderBottom: '1px solid rgba(148, 163, 184, 0.15)' }}>
                          {row.map((cell, cellIdx) => (
                            <td key={cellIdx} style={{ padding: '8px 12px', color: 'inherit', opacity: 0.9 }}>
                              {renderInlineMarkdown(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
              continue;
            }
          }

          if (/^(\s*)[*+-•\u2022]\s+/.test(line)) {
            const listItems: Array<{ text: string; isNested: boolean }> = [];
            while (i < lines.length && /^(\s*)[*+-•\u2022]\s+/.test(lines[i])) {
              const rawLine = lines[i];
              const isNested = /^\s{2,}[*+-•\u2022]\s+/.test(rawLine) || /^\t+[*+-•\u2022]\s+/.test(rawLine);
              listItems.push({
                text: rawLine.replace(/^(\s*)[*+-•\u2022]\s+/, ''),
                isNested
              });
              i++;
            }
            elements.push(
              <div key={`ul-${i}`} style={{ margin: '6px 0 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {listItems.map((li, liIdx) => (
                  <div key={liIdx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingLeft: li.isNested ? 28 : 16, lineHeight: 1.6 }}>
                    <span style={{ color: '#38bdf8', fontSize: 13, flexShrink: 0, marginTop: -1 }}>•</span>
                    <div style={{ flex: 1 }}>{renderInlineMarkdown(li.text)}</div>
                  </div>
                ))}
              </div>
            );
            continue;
          }

          if (/^\s*\d+\.\s+/.test(line)) {
            const listItems: Array<{ num: string; text: string; isNested: boolean }> = [];
            while (i < lines.length && /^\s*(\d+)\.\s+(.*)$/.test(lines[i])) {
              const rawLine = lines[i];
              const isNested = /^\s{2,}\d+\.\s+/.test(rawLine) || /^\t+\d+\.\s+/.test(rawLine);
              const lm = rawLine.match(/^\s*(\d+)\.\s+(.*)$/);
              if (lm) {
                listItems.push({ num: lm[1], text: lm[2], isNested });
              }
              i++;
            }
            elements.push(
              <div key={`ol-${i}`} style={{ margin: '6px 0 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {listItems.map((li, liIdx) => (
                  <div key={liIdx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingLeft: li.isNested ? 28 : 16, lineHeight: 1.6 }}>
                    <span style={{ color: '#38bdf8', fontWeight: 700, fontFamily: 'monospace', minWidth: 20, flexShrink: 0 }}>
                      {li.num}.
                    </span>
                    <div style={{ flex: 1 }}>{renderInlineMarkdown(li.text)}</div>
                  </div>
                ))}
              </div>
            );
            continue;
          }

          elements.push(
            <div key={`p-${i}`} style={{ margin: '4px 0', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {renderInlineMarkdown(line)}
            </div>
          );
          i++;
        }

        return <React.Fragment key={`sec-${secIdx}`}>{elements}</React.Fragment>;
      })}
    </div>
  );
});
