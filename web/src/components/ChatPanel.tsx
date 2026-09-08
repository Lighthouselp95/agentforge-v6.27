import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback, Component } from 'react';
import { UnifiedDirectiveCard } from './chat/UnifiedDirectiveCard';
import { MarkdownRenderer, renderInlineMarkdown, splitMarkdownSections } from './chat/MarkdownRenderer';
import { CodeBlock, clampToolLines } from './chat/CodeBlock';
import {
  extractAllDirectivesAndText,
  parseXmlAttributes,
  stripSystemTaskTags,
  splitReportAndConversation,
  DirectiveItem
} from '../utils/directiveParser';

interface Message {
  id: string;
  agentId?: string;
  role?: string;
  content: string;
  timestamp?: number | string;
  thinking?: string;
}

interface ChatMsg {
  id: string;
  from: string;
  to?: string;
  content: string;
  task?: string;
  timestamp?: number | string;
  sourceCreatedAt?: number | string;
  agentName?: string;
  agentRole?: string;
  msgType?: string;
  showOnUI?: boolean;
  // Toolcall cấu trúc từ event gốc opencode (backend gửi kèm trong payload)
  toolCalls?: Array<{ tool: string; input?: string; output?: string }>;
  thinking?: string;
  // Ordered parts (Option C): text + tool xen kẽ theo ĐÚNG thứ tự opencode emit — server gửi trong final snapshot.
  // Client render trực tiếp theo array. OPTIONAL (không có → render theo cách cũ).
  parts?: Array<{ type: 'text' | 'tool' | 'thinking'; content?: string; tool?: string; input?: string; output?: string }>;
}

interface AgentInfo {
  id: string;
  name: string;
  role?: string;
  type?: string;
  task?: string;
  status?: string;
}

function stripTalkTags(text: string): string {
  if (!text) return '';
  let result = String(text);

  // Mask code blocks
  const codeBlocks: string[] = [];
  result = result.replace(/```[\s\S]*?```|`[^`\n]+`/g, (m) => {
    const t = `__AF_CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(m);
    return t;
  });

  // Doc Line Masking: bảo vệ dòng trích dẫn, danh sách markdown giải thích/hướng dẫn về thẻ
  // (ví dụ: "- Dùng thẻ <spawn role=... />", "> trích dẫn <talk ...>", "Hướng dẫn (ví dụ: gán agent.task = ...):")
  const docLines: string[] = [];
  result = result.replace(/^[ \t]*(?:>|[-*+]|\d+\.|\([^\n)]*|.*(?:ví dụ|hướng dẫn|cú pháp|lệnh|thẻ|dùng|tag|syntax|example|instruction|task_update)[^\n]*)[ \t]+.*(?:<|\b(?:TALK|SPAWN|TASK_UPDATE)\b).*$/gmi, (m) => {
    const t = `__AF_DOC_LINE_${docLines.length}__`;
    docLines.push(m);
    return t;
  });

  // 1. Strip full XML command blocks: <talk ...>...</talk>, <spawn ...>...</spawn>, <stop ...>...</stop>
  result = result.replace(/^[ \t]*<\s*(?:talk|spawn|stop|resume|create_role|create-role|delete_agent)\b[^>]*\b(?:target|target-id|target_id|agent-id|agent_id|agent|to|id|role|name|task)\s*=[^>]*>[\s\S]*?<\/\s*(?:talk|spawn|stop|resume|create_role|create-role|delete_agent)\s*>[ \t]*\n?/gmi, '');
  result = result.replace(/<\s*(?:talk|spawn)\b[^>]*>[\s\S]*?<\/\s*(?:talk|spawn)\s*>/gmi, '');
  // 2. Strip standalone self-closing dispatch commands
  result = result.replace(/^[ \t]*<\s*(?:talk|spawn|stop|resume|create_role|create-role|delete_agent)\b[^>]*\b(?:target|target-id|target_id|agent-id|agent_id|agent|to|id|role|name|task)\s*=[^>]*\/>[ \t]*\n?/gmi, '');
  result = result.replace(/<\s*(?:talk|spawn)\b[^>]*\/>/gmi, '');
  // 3. Strip unclosed opening dispatch tags (with routing) at line start or anywhere
  result = result.replace(/<\s*(?:talk|spawn)\b[^>]*>/gmi, '');
  result = result.replace(/<\/\s*(?:talk|spawn)\s*>/gmi, '');
  result = result.replace(/^[ \t]*<\s*spawn\b[^>]*\b(?:target|target-id|target_id|agent-id|agent_id|agent|to|id|role|name|task)\s*=[^>]*>[ \t]*\n?/gmi, '');

  // 4. Strip bracket [TALK target=...] tags on standalone lines
  const strText = result;
  let out = '';
  let pos = 0;
  const lower = strText.toLowerCase();
  while (pos < strText.length) {
    const talkIdx = lower.indexOf('[talk', pos);
    if (talkIdx === -1) {
      out += strText.substring(pos);
      break;
    }
    out += strText.substring(pos, talkIdx);
    let i = talkIdx + 5; // length of '[talk'
    let inQuotes: string | null = null;
    let foundClose = false;
    while (i < strText.length) {
      const char = strText[i];
      if (inQuotes) {
        if (char === inQuotes && strText[i - 1] !== '\\') {
          inQuotes = null;
        }
      } else {
        if (char === '"' || char === "'") {
          inQuotes = char;
        } else if (char === ']') {
          foundClose = true;
          break;
        }
      }
      i++;
    }
    if (foundClose) {
      // Check if it's a real command tag with attributes or just conversational [TALK]
      const tagContent = strText.substring(talkIdx, i + 1);
      const isRealCommand = /\b(?:target|agent|agent-id|agent_id|target-id|target_id|to|id)\s*=/i.test(tagContent);
      if (isRealCommand) {
        pos = i + 1;
      } else {
        out += strText.substring(talkIdx, i + 1);
        pos = i + 1;
      }
    } else {
      const fallbackMatch = strText.substring(talkIdx).match(/^\[talk\s+[\s\S]*?\]/i);
      if (fallbackMatch) {
        pos = talkIdx + fallbackMatch[0].length;
      } else {
        out += strText.substring(talkIdx, talkIdx + 5);
        pos = talkIdx + 5;
      }
    }
  }
  // Strip bracket closing tag [/TALK]
  out = out.replace(/\[\/talk\]/gi, '');

  // Unmask
  for (let i = 0; i < docLines.length; i++) out = out.replace(`__AF_DOC_LINE_${i}__`, docLines[i]);
  for (let i = 0; i < codeBlocks.length; i++) out = out.replace(`__AF_CODE_BLOCK_${i}__`, codeBlocks[i]);

  return out.replace(/^\s+/, '').replace(/\n{3,}/g, '\n\n').trim();
}

function formatTimestamp(timestamp?: number | string): string {
  if (!timestamp) return '';
  const num = typeof timestamp === 'string' ? (Number(timestamp) || Date.parse(timestamp)) : timestamp;
  if (!num || isNaN(num) || num <= 0) return '';
  const d = new Date(num);
  if (isNaN(d.getTime())) return '';
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function formatFullDate(timestamp?: number | string): string {
  if (!timestamp) return '';
  const num = typeof timestamp === 'string' ? (Number(timestamp) || Date.parse(timestamp)) : timestamp;
  if (!num || isNaN(num) || num <= 0) return '';
  const d = new Date(num);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

// ============ TOOL CALL BLOCK ============
// Hiển thị toolcall của opencode dạng ô riêng biệt: badge tên tool + Collapse/Expand.
// Nguồn dữ liệu là PROP CÓ CẤU TRÚC (message.toolCalls), KHÔNG dò chuỗi trong content.
export interface ToolCallData {
  tool: string;
  input?: string;
  output?: string;
}

// Làm sạch mã ANSI escape rác từ output terminal (VD: [2m, [32m, ô vuông...)
function stripAnsi(text: any): string {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

// Parse input của toolcall thành object (input có thể là chuỗi JSON hoặc object sẵn)
function parseToolInputObject(input: string | undefined | null): Record<string, any> | null {
  if (input === undefined || input === null) return null;
  if (typeof input === 'object') return input as Record<string, any>;
  if (typeof input !== 'string') return null;
  try {
    const p = JSON.parse(input);
    return p && typeof p === 'object' ? (p as Record<string, any>) : null;
  } catch {
    return null;
  }
}

// Một dòng diff kiểu git: KHÔNG dùng tiền tố +/- — chỉ phân biệt bằng nền đỏ/xanh + viền trái,
// giữ nguyên thụt lề gốc của code. Dòng thêm (+) có syntax highlight (lang) như Write/Read viewer.
function DiffLine({ sign, text, tokens }: { sign: '-' | '+'; text: string; tokens?: any[] }) {
  const isRemove = sign === '-';
  const hasTokens = !isRemove && tokens && tokens.length > 0;
  return (
    <div style={{
      background: isRemove ? 'rgba(239, 68, 68, 0.14)' : 'rgba(34, 197, 94, 0.14)',
      color: isRemove ? '#fca5a5' : '#86efac',
      borderLeft: isRemove ? '3px solid #ef4444' : '3px solid #22c55e',
      padding: '1px 8px',
      fontFamily: 'monospace',
      fontSize: 11,
      lineHeight: 1.55,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word'
    }}>
      {hasTokens ? tokens.map((t, i) => (
        <span key={i} style={{ color: t.color || undefined, fontStyle: t.italic ? 'italic' : undefined, fontWeight: t.bold ? 700 : undefined }}>{t.text}</span>
      )) : (text || ' ')}
    </div>
  );
}

// Dòng ngữ cảnh giống nhau giữa old/new — xám nhạt, không bôi nền
function ContextLine({ text }: { text: string }) {
  return (
    <div style={{
      color: '#94a3b8',
      borderLeft: '3px solid transparent',
      padding: '1px 8px',
      fontFamily: 'monospace',
      fontSize: 11,
      lineHeight: 1.55,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word'
    }}>
      {text || ' '}
    </div>
  );
}

// CONTEXT-AWARE DIFF: so khớp LCS theo dòng — chỉ tô đỏ/xanh dòng THẬT SỰ khác nhau,
// các dòng giống nhau hiển thị xám làm ngữ cảnh (giống GitHub).
function computeDiffRows(oldStr: string, newStr: string): Array<{ type: 'ctx' | 'del' | 'add'; text: string }> {
  const a = oldStr.split('\n');
  const b = newStr.split('\n');
  // Guard file quá lớn: LCS O(n*m) tốn bộ nhớ — fallback render cũ (đỏ rồi xanh)
  if (a.length * b.length > 640000) {
    return [
      ...a.map(t => ({ type: 'del' as const, text: t })),
      ...b.map(t => ({ type: 'add' as const, text: t }))
    ];
  }
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: Array<{ type: 'ctx' | 'del' | 'add'; text: string }> = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ type: 'ctx', text: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', text: a[i] });
      i++;
    } else {
      rows.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < a.length) rows.push({ type: 'del', text: a[i++] });
  while (j < b.length) rows.push({ type: 'add', text: b[j++] });
  return rows;
}

// Helper chuyển đổi vùng chọn / node sang Markdown đơn giản
function htmlToMarkdown(html: string): string {
  if (!html) return '';
  const container = document.createElement('div');
  container.innerHTML = html;

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const inner = Array.from(el.childNodes).map(walk).join('');

    switch (tag) {
      case 'strong':
      case 'b':
        return `**${inner.trim()}**`;
      case 'em':
      case 'i':
        return `*${inner.trim()}*`;
      case 'del':
      case 's':
        return `~~${inner.trim()}~~`;
      case 'code':
        if (el.parentElement && el.parentElement.tagName.toLowerCase() === 'pre') {
          return inner;
        }
        return `\`${inner}\``;
      case 'pre': {
        const lang = el.getAttribute('data-language') || '';
        return `\n\`\`\`${lang}\n${el.textContent || ''}\n\`\`\`\n`;
      }
      case 'blockquote':
        return `\n> ${inner.trim().split('\n').join('\n> ')}\n`;
      case 'h1': return `\n# ${inner.trim()}\n`;
      case 'h2': return `\n## ${inner.trim()}\n`;
      case 'h3': return `\n### ${inner.trim()}\n`;
      case 'h4': return `\n#### ${inner.trim()}\n`;
      case 'h5': return `\n##### ${inner.trim()}\n`;
      case 'h6': return `\n###### ${inner.trim()}\n`;
      case 'p': return `\n\n${inner.trim()}\n\n`;
      case 'li': return `\n- ${inner.trim()}`;
      case 'ul':
      case 'ol': return `\n${inner}\n`;
      case 'br': return '\n';
      case 'hr': return '\n\n---\n\n';
      case 'a': {
        const href = el.getAttribute('href') || '';
        return `[${inner.trim()}](${href})`;
      }
      default:
        return inner;
    }
  };

  return walk(container).replace(/\n{3,}/g, '\n\n').trim();
}

// ============ ANSI COLOR RENDERER ============
// Gỡ CSI điều khiển không phải màu; giữ SGR (...m) để tô màu như terminal thật.
const ANSI_NOISE_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-NPRZcf-nqry=><]/g;
const ANSI_SGR_SPLIT = /((?:\u001b\[|\u009b\[|\[)\d{1,3}(?:;\d{1,3}){0,8}m)/g;

// Hàm dọn dẹp các lệnh hệ thống (delete_task, task_update, directives) khỏi text hiển thị
export function stripSystemTaskTags(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/<\s*delete_task\b[^>]*\/>/gi, '')
    .replace(/<\s*delete_task\b[^>]*>[\s\S]*?<\/\s*delete_task\s*>/gi, '')
    .replace(/\[DELETE\s+TASK\b[^\]]*\]/gi, '')
    .replace(/<\s*task_update\b[^>]*\/>/gi, '')
    .replace(/<\s*task_update\b[^>]*>[\s\S]*?<\/\s*task_update\s*>/gi, '')
    .replace(/\[TASK\s+UPDATE\b[^\]]*\]/gi, '')
    .trim();
}

function ansiApplyCode(code: number, style: React.CSSProperties): React.CSSProperties {
  const s = { ...style };
  switch (code) {
    case 0: return {};
    case 1: s.fontWeight = 'bold'; break;
    case 2: s.opacity = 0.6; break;
    case 22: delete s.fontWeight; delete s.opacity; break;
    case 39: delete s.color; break;
    case 30: case 90: s.color = '#94a3b8'; break;
    case 31: case 91: s.color = '#f87171'; break;
    case 32: case 92: s.color = '#4ade80'; break;
    case 33: case 93: s.color = '#facc15'; break;
    case 34: case 94: s.color = '#60a5fa'; break;
    case 35: case 95: s.color = '#c084fc'; break;
    case 36: case 96: s.color = '#38bdf8'; break;
    case 37: s.color = '#e2e8f0'; break;
    default: break;
  }
  return s;
}

function AnsiRenderer({ text }: { text: string }) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.replace(ANSI_NOISE_RE, '');
  const tokens = cleaned.split(ANSI_SGR_SPLIT).filter(p => p !== '');
  let style: React.CSSProperties | undefined;
  const out: React.ReactNode[] = [];
  for (const p of tokens) {
    const m = p.match(/^(?:\u001b\[|\u009b\[|\[)(\d{1,3}(?:;\d{1,3}){0,8})m$/);
    if (m) {
      let cur: React.CSSProperties = style || {};
      for (const c of m[1].split(';')) {
        cur = ansiApplyCode(parseInt(c || '0', 10), cur);
      }
      style = Object.keys(cur).length ? cur : undefined;
      continue;
    }
    out.push(style ? <span key={out.length} style={style}>{p}</span> : <span key={out.length}>{p}</span>);
  }
  if (out.length === 0) return null;
  return <>{out}</>;
}

// ============ MARKDOWN RENDERER ============
function getLangBadge(lang: string) {
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

// ============ FILE PATH → LANG (cho highlight WriteFileViewer / ReadFileViewer) ============
// Map extension sang chuỗi lang khớp registry highlight.ts (js/jsx/ts/tsx/json/md/html/css/scss/py).
// Trả về '' nếu không nhận diện → fallback plain (không highlight), giữ hiệu năng.
function langFromPath(path: string): string {
  if (!path) return '';
  const base = String(path).toLowerCase().trim();
  const extMatch = base.match(/(?:^|[.])([a-z0-9]+)$/);
  if (!extMatch) return '';
  const ext = extMatch[1];
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'js';
  if (ext === 'ts' || ext === 'tsx' || ext === 'mts' || ext === 'cts') return 'ts';
  if (ext === 'json' || ext === 'jsonc') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'html' || ext === 'htm' || ext === 'xml' || ext === 'svg') return 'html';
  if (ext === 'css' || ext === 'scss' || ext === 'sass' || ext === 'less') return 'css';
  if (ext === 'py' || ext === 'python') return 'py';
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh' || ext === 'ps1') return 'bash';
  return '';
}

// ============ FILE EXTENSION → ICON GLYPH + MÀU (VS Code style) ============
// Tạo box glyph nhỏ có màu riêng theo extension cho tiêu đề tool read/write.
// KHÔNG dùng thư viện icon (app nhẹ theo tiêu chí) — chỉ ký tự unicode + màu.
const EXT_ICON: Record<string, { glyph: string; color: string; bg: string }> = {
  ts:  { glyph: 'TS',  color: '#ffffff', bg: '#3178c6' },
  tsx: { glyph: 'TSX', color: '#ffffff', bg: '#3178c6' },
  mts: { glyph: 'TS',  color: '#ffffff', bg: '#3178c6' },
  cts: { glyph: 'TS',  color: '#ffffff', bg: '#3178c6' },
  js:  { glyph: 'JS',  color: '#000000', bg: '#f7df1e' },
  jsx: { glyph: 'JSX', color: '#000000', bg: '#f7df1e' },
  mjs: { glyph: 'JS',  color: '#000000', bg: '#f7df1e' },
  cjs: { glyph: 'JS',  color: '#000000', bg: '#f7df1e' },
  json: { glyph: '{ }', color: '#f97316', bg: 'transparent' },
  jsonc: { glyph: '{ }', color: '#f97316', bg: 'transparent' },
  md:  { glyph: 'M↓',  color: '#ffffff', bg: '#4aa3df' },
  markdown: { glyph: 'M↓', color: '#ffffff', bg: '#4aa3df' },
  html: { glyph: '</>', color: '#ffffff', bg: '#e34f26' },
  htm:  { glyph: '</>', color: '#ffffff', bg: '#e34f26' },
  xml:  { glyph: '</>', color: '#ffffff', bg: '#e34f26' },
  svg:  { glyph: 'SVG', color: '#ffffff', bg: '#ffb13b' },
  css:  { glyph: '#',   color: '#ffffff', bg: '#1572b6' },
  scss: { glyph: '#',   color: '#ffffff', bg: '#cd6799' },
  sass: { glyph: '#',   color: '#ffffff', bg: '#cd6799' },
  less: { glyph: '#',   color: '#ffffff', bg: '#1d365d' },
  py:   { glyph: 'PY',  color: '#ffffff', bg: '#3776ab' },
  python: { glyph: 'PY', color: '#ffffff', bg: '#3776ab' },
  sh:   { glyph: '>_',  color: '#ffffff', bg: '#3e8635' },
  bash: { glyph: '>_',  color: '#ffffff', bg: '#3e8635' },
  zsh:  { glyph: '>_',  color: '#ffffff', bg: '#3e8635' },
  ps1:  { glyph: '>_',  color: '#ffffff', bg: '#3e8635' }
};

function extIcon(path: string): React.ReactNode {
  if (!path) return <span style={{ marginRight: 6, color: '#94a3b8' }}>◇</span>;
  const base = String(path).toLowerCase().trim();
  const m = base.match(/(?:^|[.])([a-z0-9]+)$/);
  const ext = m ? m[1] : '';
  const cfg = EXT_ICON[ext];
  if (!cfg) return <span style={{ marginRight: 6, color: '#94a3b8' }}>📄</span>;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 18, height: 16, marginRight: 6, borderRadius: 3, padding: '0 3px',
      background: cfg.bg, color: cfg.color, fontWeight: 700, fontSize: 10,
      fontFamily: 'monospace', boxSizing: 'border-box'
    }}>{cfg.glyph}</span>
  );
}

const CodeBlock = React.memo(function CodeBlock({ code, lang, isMobile }: { code: string; lang: string; isMobile?: boolean }) {
  const [copied, setCopied] = useState(false);

  // USER: giới hạn tối đa 90 dòng hiển thị code (cắt trước khi tokenize)
  const displayCode = clampToolLines(code).text;

  // Chỉ tokenize khi ngôn ngữ được hỗ trợ — fallback plain text giữ hiệu năng tối đa
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

// ============ WRITE FILE VIEWER ============
// Hiển thị tool write dạng khung file đẹp: header nổi bật, nội dung code có expand/collapse, badge thành công.
function WriteFileViewer({ input, output, isMobile }: { input?: string; output?: string; isMobile?: boolean }) {
  const rawOut = typeof output === 'string' ? stripAnsi(output) : '';
  const rawInp = typeof input === 'string' ? stripAnsi(input) : '';

  // Parse JSON input để lấy filePath + content
  let filePath = '';
  let fileContent = '';
  try {
    const j = JSON.parse(rawInp);
    if (j && typeof j.filePath === 'string') filePath = j.filePath;
    else if (j && typeof j.path === 'string') filePath = j.path;
    if (typeof j.content === 'string') fileContent = j.content;
  } catch {}

  if (!filePath && rawInp && !rawInp.startsWith('{') && !rawInp.includes('\n')) {
    filePath = rawInp.trim();
  }

  // USER: giới hạn tối đa 90 dòng hiển thị (cắt TRƯỚC khi highlight/count)
  const clampedFile = clampToolLines(fileContent);
  const displayContent = clampedFile.text;
  const lines = displayContent.split('\n');
  const lineCount = lines.length;

  // Syntax highlight: lang từ filePath → highlight như CodeBlock; fallback plain nếu không hỗ trợ
  const lang = langFromPath(filePath);
  const supported = useMemo(() => isSupportedLang(lang), [lang]);
  const tokens = useMemo(() => (supported ? highlight(displayContent, lang) : []), [supported, displayContent, lang]);

  return (
    <div style={{ width: '100%', boxSizing: 'border-box' }}>
      <pre style={{
        margin: 0,
        padding: '8px 12px',
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
        fontSize: 11.5,
        fontWeight: 500,
        lineHeight: 1.48,
        letterSpacing: '0.2px',
        WebkitFontSmoothing: 'antialiased',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: 'var(--text-primary)',
        maxWidth: '100%',
        boxSizing: 'border-box'
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
          displayContent || '(empty)'
        )}
      </pre>
      {/* Footer: badge thành công */}
      <div style={{
        padding: '4px 10px 6px',
        fontSize: 11,
        color: '#86efac',
        fontFamily: 'monospace',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTop: '1px solid var(--af-border)',
        gap: 8
      }}>
        <span>✓ Ghi file thành công</span>
        <span style={{ color: 'var(--text-muted)' }}>{lineCount} dòng</span>
      </div>
    </div>
  );
}

// ============ READ FILE VIEWER ============
// Hiển thị kết quả tool read dạng khung file đẹp: bỏ XML thô (<path>/<content>), có header đường dẫn.
function ReadFileViewer({ input, output, isMobile }: { input?: string; output?: string; isMobile?: boolean }) {
  const rawOut = typeof output === 'string' ? stripAnsi(output) : '';
  const rawInp = typeof input === 'string' ? stripAnsi(input) : '';

  // 1) filePath: ưu tiên thẻ <path>, rồi đến input chuỗi trần / JSON {filePath}
  let filePath = '';
  const pm = rawOut.match(/<path>([\s\S]*?)<\/path>/i) || rawInp.match(/<path>([\s\S]*?)<\/path>/i);
  if (pm) {
    filePath = pm[1].trim();
  } else if (rawInp && !rawInp.startsWith('{') && !rawInp.includes('\n')) {
    filePath = rawInp.trim();
  } else {
    try {
      const j = JSON.parse(rawInp);
      if (j && typeof j.filePath === 'string') filePath = j.filePath;
      else if (j && typeof j.path === 'string') filePath = j.path;
    } catch {}
  }

  // 2) Nội dung code nằm giữa <content>...</content> (hoặc toàn bộ phần sau nếu thiếu thẻ đóng)
  const cm = rawOut.match(/<content>([\s\S]*?)<\/content>/i) || rawOut.match(/<content>([\s\S]*)$/i);
  const code = cm ? cm[1].replace(/^\r?\n/, '').replace(/\s+$/, '') : '';

  // 3) Dòng ghi chú cuối "(Showing lines ...)"
  const nm = rawOut.match(/\((Showing lines[\s\S]*?)\)/i);
  const note = nm ? nm[1].trim() : '';

  // USER: giới hạn tối đa 90 dòng hiển thị (cắt TRƯỚC khi highlight)
  const clamped = clampToolLines(code);
  const displayCode = clamped.text;

  // Syntax highlight: lang từ filePath → highlight như CodeBlock; fallback plain nếu không hỗ trợ
  const lang = langFromPath(filePath);
  const supported = useMemo(() => isSupportedLang(lang), [lang]);
  const tokens = useMemo(() => (supported ? highlight(displayCode, lang) : []), [supported, displayCode, lang]);

  return (
    <div style={{ width: '100%', boxSizing: 'border-box' }}>
      <pre style={{
        margin: 0,
        padding: '8px 12px',
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
        fontSize: 11.5,
        fontWeight: 500,
        lineHeight: 1.48,
        letterSpacing: '0.2px',
        WebkitFontSmoothing: 'antialiased',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: 'var(--text-primary)',
        maxWidth: '100%',
        boxSizing: 'border-box'
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
          displayCode || rawOut || '(empty)'
        )}
      </pre>
      {/* Dòng tóm tắt chân khung */}
      {note && (
        <div style={{ padding: '4px 10px 6px', fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'monospace', borderTop: '1px solid var(--af-border)' }}>
          {note}
        </div>
      )}
    </div>
  );
}

// ============ BASH COMMAND VIEWER ============
// Hiển thị tool bash dạng terminal: dòng prompt "$ command" + output giữ màu ANSI.
function BashCommandViewer({ input, output }: { input?: string; output?: string }) {
  let command = '';
  const obj = parseToolInputObject(input);
  if (obj) {
    if (typeof obj.command === 'string') command = obj.command;
    else if (typeof obj.cmd === 'string') command = obj.cmd;
  }
  if (!command && typeof input === 'string' && input.trim()) {
    command = input.trim();
  }
  const rawOutText = typeof output === 'string' ? output : '';
  // USER: giới hạn tối đa 90 dòng hiển thị (cắt output trước khi render ANSI)
  const outText = clampToolLines(rawOutText).text;

  return (
    <div
      className="af-toolblock"
      style={{
      display: 'block',
      width: '100%',
      boxSizing: 'border-box',
      borderRadius: 10,
      border: '1px solid var(--toolblock-border, var(--af-border))',
      background: 'var(--toolblock-bg, var(--bg-card))',
      boxShadow: 'var(--toolblock-shadow, 0 4px 20px rgba(0, 0, 0, 0.35))',
      overflow: 'hidden',
      marginBottom: 6
    }}>
      {/* Header Prompt bar */}
      <div style={{
        padding: '5px 9px',
        background: 'var(--toolblock-head-bg, var(--bg-input))',
        borderBottom: '1px solid var(--toolblock-head-border, var(--af-border))',
        color: '#4ade80',
        fontWeight: 600,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
        fontSize: 11.5,
        wordBreak: 'break-all'
      }}>
        <span style={{ color: '#4ade80', fontWeight: 600, fontSize: 11 }}>$</span> <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 11.5 }}>{command}</span>
      </div>
      {/* Output: giữ màu ANSI trên nền tối sâu, scroll tối đa 600px */}
      {outText && (
        <div style={{
          maxHeight: 600,
          overflowY: 'auto',
          overflowX: 'auto',
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
          background: 'var(--toolblock-code-bg, var(--bg-inset))',
          padding: '8px 12px',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
          fontSize: 11.5,
          fontWeight: 500,
          lineHeight: 1.48,
          letterSpacing: '0.2px',
          WebkitFontSmoothing: 'antialiased',
          color: 'var(--text-primary)'
        }}>
          <AnsiRenderer text={outText} />
        </div>
      )}
    </div>
  );
}

// ============ SEARCH COMMAND VIEWER (glob / grep / searcher) ============
// GitHub-style: header 🔍 TOOL pattern + danh sách kết quả tách số dòng/nội dung gọn gàng.
function SearchCommandViewer({ tool, input, output }: { tool: string; input?: string; output?: string }) {
  const rawInp = typeof input === 'string' ? stripAnsi(input) : '';
  const rawOut = typeof output === 'string' ? output : '';

  // Parse pattern / path / include từ input JSON (hoặc chuỗi trần làm pattern)
  let pattern = '', sPath = '', include = '';
  const obj = parseToolInputObject(rawInp);
  if (obj) {
    if (typeof obj.pattern === 'string') pattern = obj.pattern;
    else if (typeof obj.query === 'string') pattern = obj.query;
    if (typeof obj.path === 'string') sPath = obj.path;
    if (typeof obj.include === 'string') include = obj.include;
  }
  if (!pattern && rawInp.trim()) pattern = rawInp.trim();

  const allRows = rawOut.split(/\r?\n/)
    .map(l => l.replace(ANSI_NOISE_RE, '').replace(/[\u001b\u009b]/g, ''))
    .filter(l => l.trim() !== '');
  // USER: giới hạn tối đa 90 dòng hiển thị kết quả tìm kiếm
  const rows = allRows.slice(0, MAX_TOOL_LINES);
  const rowCut = allRows.length - rows.length;

  return (
    <div
      className="af-toolblock"
      style={{
      display: 'block',
      width: '100%',
      maxWidth: '100%',
      boxSizing: 'border-box',
      borderRadius: 10,
      border: '1px solid var(--toolblock-border, var(--af-border))',
      background: 'var(--toolblock-bg, var(--bg-card))',
      boxShadow: 'var(--toolblock-shadow, 0 4px 20px rgba(0, 0, 0, 0.35))',
      overflowX: 'auto',
      overflowY: 'hidden',
      marginBottom: 6
    }}>
      {/* Header: 🔍 TOOL pattern: "..." in path */}
      <div style={{
        padding: '5px 9px',
        background: 'var(--toolblock-head-bg, var(--bg-input))',
        borderBottom: '1px solid var(--toolblock-head-border, var(--af-border))',
        color: 'var(--text-primary)',
        fontWeight: 600,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
        fontSize: 11.5,
        wordBreak: 'break-all'
      }}>
        <span style={{ color: '#22d3ee', fontWeight: 600, fontSize: 11 }}>🔍 {String(tool).toUpperCase()}</span> <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: 11.5 }}>{pattern ? ` pattern: "${pattern}"` : ''}{sPath ? ` in ${sPath}` : ''}{include ? ` · ${include}` : ''}{rowCut > 0 ? ` · (${rowCut} dòng bị cắt, tổng ${allRows.length})` : ''}</span>
      </div>
      {/* Danh sách kết quả — scroll 600px */}
      <div style={{
        maxHeight: 600,
        overflowY: 'auto',
        overflowX: 'auto',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        background: 'var(--toolblock-code-bg, var(--bg-inset))',
        padding: '6px 4px'
      }}>
        {rows.length === 0 ? (
          <div style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11.5, color: 'var(--text-muted)' }}>(no results)</div>
        ) : rows.map((l, i) => {
          // grep -n style: "path/file.tsx:580:nội dung"
          const fm = l.match(/^([^\s:]+\.[A-Za-z0-9]{1,6}):(\d+):(.*)$/);
          if (fm) {
            return (
              <div key={i} style={{ display:'flex', gap:8, padding:'2px 8px', fontFamily:"'JetBrains Mono', monospace", fontSize:11.5, fontWeight:500, lineHeight:1.48 }}>
                <span style={{ color:'#38bdf8', flexShrink:0 }}>📄 {fm[1]}</span>
                <span style={{ color:'var(--text-muted)', flexShrink:0, minWidth:44, textAlign:'right' }}>{fm[2]}</span>
                <span style={{ color:'var(--text-primary)', whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{fm[3]}</span>
              </div>
            );
          }
          // dòng có số thứ tự: "Line 580:" hoặc "580:"
          const lm = l.match(/^(?:Line\s*)?(\d+)\s*[:：]\s*([\s\S]*)$/i);
          if (lm) {
            return (
              <div key={i} style={{ display:'flex', gap:8, padding:'2px 8px', fontFamily:"'JetBrains Mono', monospace", fontSize:11.5, fontWeight:500, lineHeight:1.48 }}>
                <span style={{ color:'var(--text-muted)', flexShrink:0, minWidth:36, textAlign:'right' }}>{lm[1]}</span>
                <span style={{ color:'var(--text-primary)', whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{lm[2]}</span>
              </div>
            );
          }
          // đường dẫn file / thư mục trần
          const isFile = /\.[A-Za-z0-9]{1,6}$/.test(l.trim()) && !l.includes(' ');
          return (
            <div key={i} style={{ padding:'2px 8px', fontFamily:"'JetBrains Mono', monospace", fontSize:11.5, fontWeight:500, lineHeight:1.48, color:'var(--text-primary)' }}>
              {isFile ? `📄 ${l.trim()}` : (/\.[A-Za-z0-9]{1,6}/.test(l) || l.includes('/') || l.includes('\\') ? `📁 ${l.trim()}` : l)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============ TOOL BLOCK SAFE BOUNDARY ============
// Fallback an toàn: nếu render một ToolCallBlock lỗi cú pháp/logic, không làm sập panel chat
// mà fallback hiển thị trực tiếp dữ liệu thô (raw data) trong khung code để người dùng vẫn đọc được trọn vẹn.
class ToolBlockSafe extends Component<{ tool?: string; input?: any; output?: any; children: React.ReactNode }, { hasError: boolean; errorInfo?: string }> {
  public state: { hasError: boolean; errorInfo?: string } = { hasError: false };
  public static getDerivedStateFromError(error: unknown) {
    return { hasError: true, errorInfo: String(error) };
  }
  public componentDidCatch(error: unknown) {
    console.warn('[ToolBlockSafe] Caught render error in tool block, fallback to defensive raw viewer:', error);
  }
  public render() {
    if (this.state.hasError) {
      const toolName = this.props.tool || 'tool';
      const formatRawData = (data: any) => {
        if (data === undefined || data === null) return '';
        if (typeof data === 'object') {
          try {
            return JSON.stringify(data, null, 2);
          } catch {
            return String(data);
          }
        }
        const str = String(data);
        try {
          const parsed = JSON.parse(str);
          return JSON.stringify(parsed, null, 2);
        } catch {
          return str;
        }
      };

      const rawIn = formatRawData(this.props.input);
      const rawOut = formatRawData(this.props.output);

      return (
        <div style={{
          borderRadius: 8,
          border: '1px solid rgba(148, 163, 184, 0.25)',
          background: 'var(--bg-inset)',
          padding: '8px 12px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: 'var(--text-primary)',
          marginBottom: 6,
          boxSizing: 'border-box',
          width: '100%',
          overflowX: 'auto'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: '#38bdf8', fontWeight: 600 }}>
            <span>🔧</span>
            <span>{toolName} (Raw View)</span>
          </div>
          {rawIn && (
            <div style={{ marginBottom: rawOut ? 8 : 0 }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: 10, fontWeight: 600, marginBottom: 2 }}>INPUT:</div>
              <pre style={{ margin: 0, padding: '6px 8px', background: 'rgba(0,0,0,0.25)', borderRadius: 6, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <code>{rawIn}</code>
              </pre>
            </div>
          )}
          {rawOut && (
            <div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 10, fontWeight: 600, marginBottom: 2 }}>OUTPUT:</div>
              <pre style={{ margin: 0, padding: '6px 8px', background: 'rgba(0,0,0,0.25)', borderRadius: 6, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <code>{rawOut}</code>
              </pre>
            </div>
          )}
          {!rawIn && !rawOut && (
            <div style={{ color: 'var(--text-muted)' }}>(empty tool call)</div>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

// ============ TODO CHECKLIST VIEWER ============
// Format output cua tool todowrite/todoread thanh danh sach checklist dep mat
// thay vi in mang JSON tho. Parse duoc ca shape: mang truc tiep, {todos:[...]},
// hoac object bat ky chua mang o field dau tien.
function parseTodosFrom(raw?: string): any[] {
  if (!raw || !raw.trim()) return [];
  const tryParse = (s: string): any => { try { return JSON.parse(s); } catch { return undefined; } };
  let v = tryParse(raw);
  if (v === undefined) {
    // Output co the kem text bao quanh -> tim doan JSON dau tien [..] hoac {..}
    const start = raw.search(/[[{]/);
    const endBrk = Math.max(raw.lastIndexOf(']'), raw.lastIndexOf('}'));
    if (start >= 0 && endBrk > start) v = tryParse(raw.slice(start, endBrk + 1));
  }
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    if (Array.isArray((v as any).todos)) return (v as any).todos;
    for (const k of Object.keys(v as any)) {
      const inner = (v as any)[k];
      if (Array.isArray(inner)) return inner;
    }
  }
  return [];
}

const TODO_STATUS_ICON: Record<string, string> = {
  in_progress: '🟡',
  completed: '✅',
  pending: '⬜'
};

const TODO_PRIORITY_BADGE: Record<string, React.CSSProperties> = {
  high: { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.4)' },
  medium: { background: 'rgba(250,204,21,0.12)', color: '#facc15', border: '1px solid rgba(250,204,21,0.4)' },
  low: { background: 'rgba(148,163,184,0.12)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.35)' }
};

function TodoListViewer({ input, output }: { input?: string; output?: string }) {
  let todos = parseTodosFrom(output);
  if (todos.length === 0) todos = parseTodosFrom(input);
  // USER: giới hạn tối đa 90 todo hiển thị
  const todoCut = todos.length - MAX_TOOL_LINES;
  const shownTodos = todos.slice(0, MAX_TOOL_LINES);
  return (
    <div style={{
      width: '100%', boxSizing: 'border-box', borderRadius: 10,
      border: '1px solid var(--af-border)', background: '#0d1117',
      overflow: 'hidden', margin: '4px 0'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', background: 'var(--bg-panel)',
        borderBottom: '1px solid var(--af-border)',
        fontSize: 11, fontWeight: 700, color: '#a5b4fc'
      }}>
        📋 Task Checklist ({todos.length} tasks){todoCut > 0 ? ` · (${todoCut} bị cắt)` : ''}
      </div>
      {/* Danh sach todo */}
      <div style={{
        maxHeight: 280, overflowY: 'auto', width: '100%',
        padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 6
      }}>
        {todos.length === 0 && (
          <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', padding: '2px 4px' }}>
            (không parse được danh sách todo từ dữ liệu tool)
          </div>
        )}
        {shownTodos.map((t: any, i: number) => {
          const status = String(t?.status || 'pending').toLowerCase();
          const icon = TODO_STATUS_ICON[status] || '⬜';
          const pr = String(t?.priority || '').toLowerCase();
          const badge = TODO_PRIORITY_BADGE[pr];
          const label = String(t?.content ?? t?.task ?? t?.title ?? '');
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '5px 8px', borderRadius: 8,
              background: 'rgba(148,163,184,0.06)',
              border: '1px solid rgba(148,163,184,0.12)'
            }}>
              <span style={{ fontSize: 13, lineHeight: '17px', flexShrink: 0 }}>{icon}</span>
              <span style={{
                flex: 1, fontSize: 12, color: '#e2e8f0', lineHeight: '17px',
                textDecoration: status === 'completed' ? 'line-through' : 'none',
                opacity: status === 'completed' ? 0.72 : 1,
                wordBreak: 'break-word'
              }}>
                {label || JSON.stringify(t)}
              </span>
              {badge && (
                <span style={{
                  ...badge, fontSize: 9, fontWeight: 700, borderRadius: 9999,
                  padding: '1px 7px', fontFamily: 'monospace',
                  textTransform: 'uppercase', flexShrink: 0, lineHeight: '14px'
                }}>
                  {pr}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderToolBadge(tool: string, parsedInput: any, safeInput: string, isMobile?: boolean): React.ReactNode {
  const norm = String(tool || '').toLowerCase().trim();

  // Extract file path if present
  const filePath = (parsedInput && (typeof parsedInput.filePath === 'string' ? parsedInput.filePath : (typeof parsedInput.path === 'string' ? parsedInput.path : ''))) || '';

  // ══ FIX UX mobile: path file bị cắt cụt không đọc được trọn tên file ══
  // Mobile: inline-block + overflowX:auto + maxWidth → tạo BOX scroll ngang THẬT (span inline
  // thuần KHÔNG tạo scroll được — overflow chỉ hiệu lực trên block/inline-block có box riêng).
  // Desktop: inline-block + ellipsis + maxWidth 360px giữ gọn (ellipsis cũng chỉ chạy trên inline-block).
  const pathStyle: React.CSSProperties = isMobile
    ? { display: 'inline-block', overflowX: 'auto', overflowY: 'hidden', whiteSpace: 'nowrap', color: 'var(--text-primary)', fontWeight: 500, fontSize: 11.5, maxWidth: '100%', verticalAlign: 'bottom', scrollbarWidth: 'thin' }
    : { display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', fontWeight: 500, fontSize: 11.5, maxWidth: 360, verticalAlign: 'bottom' };

  if (norm === 'edit') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        {extIcon(filePath)}
        <span style={{ color: '#fb923c', fontWeight: 600, fontSize: 11 }}>Edit:</span>
        <span style={pathStyle} title={filePath || 'file'}>{filePath || 'file'}</span>
      </span>
    );
  }

  if (norm === 'write' || norm === 'write_file' || norm === 'writefile' || norm === 'create_file' || norm === 'write_to_file' || norm === 'writefile') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        {extIcon(filePath)}
        <span style={{ color: '#fde047', fontWeight: 600, fontSize: 11 }}>Write:</span>
        <span style={pathStyle} title={filePath || 'file'}>{filePath || 'file'}</span>
      </span>
    );
  }

  if (norm === 'read') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        {extIcon(filePath)}
        <span style={{ color: '#38bdf8', fontWeight: 600, fontSize: 11 }}>Read:</span>
        <span style={pathStyle} title={filePath || 'file'}>{filePath || 'file'}</span>
      </span>
    );
  }

  if (norm === 'bash' || norm === 'shell' || norm === 'cmd') {
    const cmd = (parsedInput && (typeof parsedInput.command === 'string' ? parsedInput.command : (typeof parsedInput.cmd === 'string' ? parsedInput.cmd : ''))) || safeInput || '';
    const cleanCmd = cmd.trim().replace(/\r?\n/g, ' ');
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <span>💻</span>
        <span style={{ color: '#4ade80', fontWeight: 600, fontSize: 11 }}>Bash:</span>
        <span style={{ ...pathStyle, maxWidth: isMobile ? '100%' : 360 }} title={cleanCmd || 'command'}>{cleanCmd || 'command'}</span>
      </span>
    );
  }

  if (norm === 'glob') {
    const pattern = (parsedInput && typeof parsedInput.pattern === 'string' ? parsedInput.pattern : '') || '';
    const path = (parsedInput && typeof parsedInput.path === 'string' ? parsedInput.path : '') || '';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <span>📁</span>
        <span style={{ color: '#22d3ee', fontWeight: 600, fontSize: 11 }}>Glob:</span>
        <span style={pathStyle} title={path || pattern || '*'}>{pattern || '*'}{path ? ` in ${path}` : ''}</span>
      </span>
    );
  }

  if (norm === 'grep') {
    const pattern = (parsedInput && typeof parsedInput.pattern === 'string' ? parsedInput.pattern : '') || '';
    const path = (parsedInput && typeof parsedInput.path === 'string' ? parsedInput.path : '') || '';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <span>🔍</span>
        <span style={{ color: '#f472b6', fontWeight: 600, fontSize: 11 }}>Grep:</span>
        <span style={pathStyle} title={path || pattern || ''}>/{pattern}/{path ? ` in ${path}` : ''}</span>
      </span>
    );
  }

  if (norm === 'searcher' || norm === 'search') {
    const query = (parsedInput && (typeof parsedInput.pattern === 'string' ? parsedInput.pattern : (typeof parsedInput.query === 'string' ? parsedInput.query : ''))) || '';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <span>🔍</span>
        <span style={{ color: '#f472b6', fontWeight: 600, fontSize: 11 }}>Search:</span>
        <span style={pathStyle} title={query || 'query'}>{query || 'query'}</span>
      </span>
    );
  }

  if (norm.includes('fetch') || norm.includes('webfetch')) {
    const url = (parsedInput && (typeof parsedInput.url === 'string' ? parsedInput.url : (typeof parsedInput.link === 'string' ? parsedInput.link : ''))) || '';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <span>🌐</span>
        <span style={{ color: '#38bdf8', fontWeight: 600, fontSize: 11 }}>Fetch:</span>
        <span style={{ ...pathStyle, maxWidth: isMobile ? '100%' : 320 }} title={url || 'url'}>{url || 'url'}</span>
      </span>
    );
  }

  if (norm.includes('web_search') || norm.includes('websearch')) {
    const query = (parsedInput && (typeof parsedInput.query === 'string' ? parsedInput.query : (typeof parsedInput.q === 'string' ? parsedInput.q : ''))) || '';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <span>🌐</span>
        <span style={{ color: '#38bdf8', fontWeight: 600, fontSize: 11 }}>WebSearch:</span>
        <span style={pathStyle} title={query || 'search'}>{query || 'search'}</span>
      </span>
    );
  }

  if (norm === 'todowrite' || norm.includes('todo')) {
    const count = Array.isArray(parsedInput?.todos) ? parsedInput.todos.length : '';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <span>📋</span>
        <span style={{ color: '#fb923c', fontWeight: 600, fontSize: 11 }}>TodoList:</span>
        <span style={pathStyle} title={count ? `${count} tasks` : 'update'}>{count ? `${count} tasks` : 'update'}</span>
      </span>
    );
  }

  if (norm === 'skill') {
    const name = (parsedInput && typeof parsedInput.name === 'string' ? parsedInput.name : '') || '';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <span>⚡</span>
        <span style={{ color: '#facc15', fontWeight: 600, fontSize: 11 }}>Skill:</span>
        <span style={pathStyle} title={name || 'custom'}>{name || 'custom'}</span>
      </span>
    );
  }

  // Fallback
  const target = filePath || (parsedInput && typeof parsedInput.target === 'string' ? parsedInput.target : '') || '';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
      <span>🔧</span>
      <span style={{ color: '#38bdf8', fontWeight: 600, fontSize: 11 }}>{String(tool || 'tool')}:</span>
      {target && <span style={pathStyle} title={target}>{target}</span>}
    </span>
  );
}

function ToolCallBlock({ tool, input, output, isMobile, defaultExpanded = false }: ToolCallData & { isMobile?: boolean; defaultExpanded?: boolean }) {
  // FIX CRASH toLowerCase: tool có thể undefined khi payload lỗi → bọc an toàn 100%
  const safeTool = String(tool || 'unknown').toLowerCase();
  // Input có thể là object (nếu server gửi raw object) → stringify an toàn, tránh [object Object]
  const inputStr = typeof input === 'string' ? input : (input != null ? (typeof input === 'object' ? JSON.stringify(input, null, 2) : String(input)) : '');
  const outputStr = typeof output === 'string' ? output : (output != null ? (typeof output === 'object' ? JSON.stringify(output, null, 2) : String(output)) : '');
  const safeInput = stripAnsi(inputStr || '');
  const rawOutput = outputStr || '';

  // TodoListViewer cho tool todowrite/todoread — checklist đẹp thay vì JSON thô
  if (safeTool.includes('todo')) {
    return <TodoListViewer input={safeInput} output={rawOutput} />;
  }

  const content = [
    safeInput ? `▶ input:\n${safeInput}` : '',
    rawOutput ? `◀ output:\n${rawOutput}` : ''
  ].filter(Boolean).join('\n\n');
  // USER: giới hạn tối đa 90 dòng hiển thị (cắt content dùng cho lineCount/fallback)
  const clampedContent = clampToolLines(content);
  const displayContent = clampedContent.text;
  const lineCount = Math.max(1, displayContent.split('\n').length);

  // Git-style diff cho tool edit: parse input lấy {filePath, oldString, newString}
  const parsedInput = parseToolInputObject(safeInput);
  const isEditDiff =
    safeTool === 'edit' ||
    !!(parsedInput && ('oldString' in parsedInput || 'newString' in parsedInput));

  // ReadFileViewer cho tool read (hoặc output chứa khối <content>)
  const isReadView = safeTool === 'read' || /<content>/i.test(rawOutput);

  // WriteFileViewer cho tool write / write_file / create_file
  const isWriteView =
    safeTool === 'write' ||
    safeTool === 'write_file' ||
    safeTool === 'writefile' ||
    safeTool === 'create_file' ||
    safeTool === 'write_to_file' ||
    (!isEditDiff && !isReadView && parsedInput && typeof parsedInput.filePath === 'string' && typeof parsedInput.content === 'string');
  // BashCommandViewer cho tool bash/shell — dạng terminal $ command + output màu
  const isBashView = safeTool === 'bash' || safeTool === 'shell';

  // SearchCommandViewer cho glob/grep/searcher — GitHub-style kết quả tìm kiếm
  const isSearchView = safeTool === 'glob' || safeTool === 'grep' || safeTool === 'searcher';

  // Edit: lang từ filePath → syntax highlight cho dòng THÊM (+), giống Write/Read (fallback plain).
  const editFilePath = parsedInput && typeof parsedInput.filePath === 'string' ? parsedInput.filePath : '';
  const editLang = langFromPath(editFilePath);
  const editSupported = useMemo(() => isSupportedLang(editLang), [editLang]);

  const targetFilePath =
    editFilePath ||
    (parsedInput && (typeof parsedInput.filePath === 'string' ? parsedInput.filePath : (typeof parsedInput.path === 'string' ? parsedInput.path : ''))) ||
    '';
  const targetLang = targetFilePath ? langFromPath(targetFilePath) : '';

  const oldLines: string[] =
    isEditDiff && parsedInput && typeof parsedInput.oldString === 'string' && parsedInput.oldString !== ''
      ? clampToolLines(parsedInput.oldString).text.split('\n')
      : [];
  const newLines: string[] =
    isEditDiff && parsedInput && typeof parsedInput.newString === 'string' && parsedInput.newString !== ''
      ? clampToolLines(parsedInput.newString).text.split('\n')
      : [];

  // Mặc định COLLAPSED (thu gọn, hiện hint click để mở) — user bấm/click header để mở rộng.
  // Nếu setting "Expand Toolcalls by default" bật → khởi tạo expanded=true để mở sẵn.
  const [expanded, setExpanded] = useState(defaultExpanded);
  // Sync khi prop defaultExpanded thay đổi (setting UI toggle) — tránh trạng thái sticky cũ
  const prevDefaultExpandedRef = useRef(defaultExpanded);
  useEffect(() => {
    if (prevDefaultExpandedRef.current !== defaultExpanded) {
      prevDefaultExpandedRef.current = defaultExpanded;
      setExpanded(defaultExpanded);
    }
  }, [defaultExpanded]);
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const copyText =
      isEditDiff && parsedInput && typeof parsedInput.newString === 'string'
        ? parsedInput.newString
        : (isWriteView && parsedInput && typeof parsedInput.content === 'string')
        ? parsedInput.content
        : rawOutput || safeInput || content;
    if (!copyText) return;
    navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <div
      className="af-toolblock"
      style={{
      display: 'block',
      width: '100%',
      maxWidth: '100%',
      boxSizing: 'border-box',
      borderRadius: 10,
      border: '1px solid var(--toolblock-border, var(--af-border))',
      background: 'var(--toolblock-bg, var(--bg-card))',
      boxShadow: 'var(--toolblock-shadow, 0 4px 20px rgba(0, 0, 0, 0.35))',
      overflowX: 'auto',
      overflowY: 'hidden',
      marginBottom: 6
    }}>
      {/* Header DUY NHẤT 1 DÒNG: badge tên tool + target path + lang + nút Copy + nút Thu/Phóng */}
      <div
        className="af-toolblock-head"
        onClick={() => setExpanded(e => !e)}
        role="button"
        aria-expanded={expanded}
        title={expanded ? 'Thu gọn' : 'Mở rộng'}
        style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '5px 10px',
        background: 'var(--toolblock-head-bg, var(--bg-input))',
        borderBottom: expanded ? '1px solid var(--toolblock-head-border, var(--af-border))' : 'none',
        position: 'sticky',
        top: 0,
        cursor: 'pointer',
        userSelect: 'none'
      }}>
        {/* Bên trái: Badge loại tool + Tên/Đường dẫn tệp tin */}
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 11,
          fontWeight: 600,
          background: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid var(--af-border)',
          borderRadius: 9999,
          padding: '2px 8px',
          fontFamily: 'monospace',
          whiteSpace: 'nowrap',
          // FIX UX mobile: mobile → overflow-x auto (kéo ngang xem trọn path), không ellipsis.
          //   Cần minWidth:0 để flex container thu nhỏ được, con inline-block scroll ngang.
          //   Desktop → giữ gọn: ellipsis + maxWidth 70%.
          ...(isMobile
            ? { overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'thin', maxWidth: '100%', minWidth: 0 }
            : { overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '70%' })
        }}>
          {renderToolBadge(safeTool, parsedInput, safeInput, isMobile)}
        </span>

        {/* Bên phải: Ngôn ngữ nhỏ gọn + Nút Copy + Nút Thu/Phóng */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {targetLang && (
            <span style={{
              fontSize: 9.5,
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: 3,
              background: 'rgba(255, 255, 255, 0.08)',
              color: 'var(--text-secondary)',
              fontFamily: 'monospace',
              textTransform: 'uppercase'
            }}>
              {targetLang}
            </span>
          )}
          <button
            onClick={handleCopy}
            style={{
              background: copied ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.12)',
              border: copied ? '1px solid rgba(34, 197, 94, 0.35)' : '1px solid var(--af-border)',
              color: copied ? '#4ade80' : 'var(--text-secondary)',
              borderRadius: 4,
              padding: '1px 6px',
              fontSize: 10,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontFamily: 'monospace',
              fontWeight: 600,
              transition: 'all 0.15s ease'
            }}
            title="Sao chép nội dung"
          >
            <span>{copied ? '✓' : '📋'}</span>
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <span
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
            style={{
              background: 'rgba(148, 163, 184, 0.15)',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              color: 'var(--text-primary)',
              borderRadius: 4,
              padding: '1px 6px',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'monospace'
            }}
            role="button"
            aria-label={expanded ? 'Thu gọn' : 'Mở rộng'}
          >
            {expanded ? 'Collapse' : `Expand (${lineCount} dòng)`}
          </span>
        </div>
      </div>
      {/* Body: monospace 11.5px, scroll tối đa 600px khi mở */}
      {expanded && (
        <div
          className="af-toolblock-body"
          style={{
          maxHeight: 600,
          overflowY: 'auto',
          overflowX: 'hidden',
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
          padding: '8px 12px',
          background: 'var(--toolblock-code-bg, var(--bg-inset))',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
          fontSize: 11.5,
          fontWeight: 500,
          lineHeight: 1.48,
          letterSpacing: '0.2px',
          WebkitFontSmoothing: 'antialiased',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: 'var(--text-primary)'
        }}>
          {isEditDiff && parsedInput && ((oldLines.length > 0 || newLines.length > 0) || typeof parsedInput.filePath === 'string') ? (
            /* GIT-STYLE DIFF VIEW (context-aware) — không lặp lại header file */
            <div style={{ maxHeight: 600, overflowY: 'auto', overflowX: 'auto', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
              {computeDiffRows(
                oldLines.join('\n'),
                newLines.join('\n')
              ).map((row, i) =>
                row.type === 'ctx'
                  ? <ContextLine key={`c${i}`} text={row.text} />
                  : <DiffLine key={`d${i}`} sign={row.type === 'del' ? '-' : '+'} text={row.text}
                      tokens={row.type === 'add' && editSupported ? highlight(row.text, editLang) : undefined} />
              )}
              {/* Footer trạng thái: badge thành công + số dòng thêm/xóa */}
              <div style={{
                padding: '4px 10px 6px',
                fontSize: 11,
                color: '#86efac',
                fontFamily: 'monospace',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8
              }}>
                <span>✓ Sửa file thành công</span>
                <span style={{ color: '#94a3b8' }}>
                  +{newLines.length} −{oldLines.length} dòng
                </span>
              </div>
            </div>
          ) : isWriteView ? (
            /* WRITE FILE VIEWER — header nổi bật + expand/collapse + badge thành công */
            <WriteFileViewer input={safeInput} output={rawOutput} isMobile={isMobile} />
          ) : isReadView ? (
            /* READ FILE VIEWER — khung file đẹp thay XML thô */
            <ReadFileViewer input={safeInput} output={rawOutput} isMobile={isMobile} />
          ) : isBashView ? (
            /* BASH COMMAND VIEWER — $ command + output màu ANSI */
            <BashCommandViewer input={safeInput} output={rawOutput} />
          ) : isSearchView ? (
            /* SEARCH COMMAND VIEWER — GitHub-style cho glob/grep/searcher */
            <SearchCommandViewer tool={tool} input={safeInput} output={rawOutput} />
          ) : (
            content ? <AnsiRenderer text={displayContent} /> : '(empty)'
          )}
        </div>
      )}
    </div>
  );
}

// ============ THINKING BLOCK ============
// Hiển thị suy luận nội tại của model, kiểu coding-agent: block mềm, nền nhẹ, tối giản.
// Mặc định thu gọn thành 1 dòng có nhãn rõ ràng + nút mở rộng. Chữ đọc rõ, tương phản tốt.
function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);

  // Preview: trích 1 dòng gọn đầu tiên, cắt tại 500 ký tự
  const preview = thinking.split('\n').map(l => l.trim()).filter(Boolean)[0] || thinking.slice(0, 500);

  return (
    <div
      className="af-thinking"
      onClick={() => setExpanded(e => !e)}
      style={{
        display: 'block',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        borderRadius: 8,
        background: 'rgba(30,41,59,0.35)',
        border: '1px solid rgba(99,102,241,0.25)',
        overflow: 'hidden',
        cursor: 'pointer',
        marginBottom: 4
      }}
    >
      {/* Header: nhãn rõ ràng + nút mở rộng — KHÔNG hiển thị dòng rỗng. Toggle do root container xử lý (click cả vùng). */}
      <div
        role="button"
        aria-expanded={expanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '6px 10px',
          cursor: 'pointer',
          userSelect: 'none'
        }}
      >
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#cbd5e1',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          letterSpacing: '0.02em'
        }}>
          <span style={{ fontSize: 11, opacity: 0.8 }}>🧠</span>
          {expanded ? 'Thinking' : 'Đã suy nghĩ'}
        </span>
        <span style={{
          fontSize: 10,
          color: '#94a3b8',
          fontFamily: 'monospace',
          flexShrink: 0,
          fontWeight: 500,
          display: 'inline-flex',
          alignItems: 'center'
        }}>
          {expanded ? '▲ Thu gọn' : '▼'}
        </span>
      </div>

      {/* Collapsed: 1 dòng gọn, chữ rõ ràng — không hiển thị dòng rỗng/cục tròn xấu */}
      {!expanded && preview && (
        <div style={{
          padding: '0 10px 7px',
          fontSize: 11.5,
          color: '#b6c2d1',
          lineHeight: 1.5,
          fontWeight: 450,
          opacity: 1,
          overflow: 'hidden',
          maxHeight: 20,
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          cursor: 'pointer'
        }}>
          {preview}
        </div>
      )}

      {/* Expanded: card nền mờ nhẹ kiểu coding-agent, scroll vừa phải (200-240px), chữ sáng rõ */}
      {expanded && (
        <div style={{
          width: '100%',
          padding: '9px 12px',
          borderTop: '1px solid rgba(148,163,184,0.14)',
          background: 'rgba(15,23,42,0.75)',
          color: '#d7dee9',
          fontSize: 12.5,
          fontWeight: 420,
          lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 600,
          overflowY: 'auto'
        }}>
          {thinking}
        </div>
      )}
    </div>
  );
}

function formatTokens(tokens?: number): string {
  if (tokens === undefined || tokens === null || tokens < 0) return '0';
  if (tokens === 0) return '0';
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return tokens.toLocaleString();
}

function formatCost(cost?: number): string {
  if (!cost || cost <= 0) return '';
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

export interface TokenUsageDetail {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  cost?: number;
  contextLength?: number;
  input?: number;
  output?: number;
  total?: number;
  contextLimit?: number;
}

// ============ MEMOIZED MESSAGE ITEM ============
// Bọc React.memo để khi có tin nhắn mới stream tới, chỉ tin nhắn mới được re-render,
// toàn bộ danh sách cũ giữ nguyên DOM (props msg/agents/isCollapsed/onToggleReport đều ổn định tham chiếu).
interface MessageItemProps {
  msg: any;
  agents: AgentInfo[];
  isCollapsed: boolean;
  onToggleReport: (msgId: string) => void;
  isMobile?: boolean;
  showToolBlocks?: boolean;
  defaultExpandToolcalls?: boolean;
  selectedAgentId?: string | null;
  queuedMessages?: ChatMsg[];
  onForceSendSingle?: (msgId: string, content: string, targetId: string) => void;
  allMessagesList?: any[];
}

const MessageItem = React.memo(function MessageItem({ msg, agents, isCollapsed, onToggleReport, isMobile = false, showToolBlocks = true, defaultExpandToolcalls = false, selectedAgentId = null, queuedMessages = [], onForceSendSingle, allMessagesList = [] }: MessageItemProps) {
  const srcAgent = agents.find(a => a.id === msg.from || a.name === msg.from);
  let targetAgent = agents.find(a => a.id === msg.to || a.name === msg.to);
  const isUser = msg.from === 'user' || msg.role === 'user';
  const isOrchestrator = msg.from === 'orchestrator' ||
    agents.some(a => (a.id === msg.from || a.name === msg.from) && (a.role === 'orchestrator' || a.type === 'orchestrator')) ||
    msg.agentRole === 'orchestrator' ||
    (msg as any).fromRole === 'orchestrator';
  const isError = msg.msgType === 'error' || msg.from === 'error' || (typeof msg.content === 'string' && msg.content.startsWith('❌ Error'));
  const isOpenCode = msg.msgType === 'opencode';
  const isQueued = typeof msg.content === 'string' && msg.content.startsWith('[QUEUED]');
  const isStopUser = msg.msgType === 'stop_user';
  const isStopOrchestrator = msg.msgType === 'stop_orchestrator';
  const isStopError = msg.msgType === 'stop_error';
  const isOrchestratorPlanning = isOrchestrator && /(?:\[TALK\]|\[SPAWN\]|^\[TASK\]|^\[RESEARCH\]|^\[VERIFICATION\])/i.test(msg.content || '');
  const isOrchestratorInternal = msg.msgType === 'orchestrator_internal' || (isOrchestrator && msg.msgType === 'internal');
  // Lệnh giao task của Orchestrator (spawn/talk do server tạo): render thành CỤC RIÊNG distinct,
  // kèm receiver là agent. KHÔNG lẫn vào bubble chat thường.
  const hasDirectiveInContent = typeof msg.content === 'string' && /(?:\[(?:TALK|SPAWN|TASK)\]|<\s*(?:talk|spawn)\b)/i.test(msg.content);
  
  const selAgentObj = agents.find(a => a.id === selectedAgentId);
  const isSelectedOrch = !selectedAgentId || selectedAgentId === 'orchestrator' || selAgentObj?.role === 'orchestrator' || selAgentObj?.type === 'orchestrator';
  const isSubOrchView = Boolean(selectedAgentId && selectedAgentId !== 'orchestrator' && (selAgentObj?.role === 'orchestrator' || selAgentObj?.type === 'orchestrator'));
  const isFromCurrentSubOrch = isSubOrchView && (msg.from === selectedAgentId || (srcAgent && srcAgent.id === selectedAgentId) || (selAgentObj && msg.from === selAgentObj.name));

  // Khi ở tab Sub-Orch: CHỈ coi là orchestratorTask do chính Sub-Orch phát ra khi msg.from chính là Sub-Orch đó
  const isEligibleOrchSender = isSubOrchView
    ? isFromCurrentSubOrch
    : (isOrchestrator || msg.from === 'orchestrator');

  // FIX 2: Bóc tách danh sách các directives trong content và kiểm tra trùng lặp từng directive
  const contentDirectives = useMemo(() => {
    if (msg.msgType === 'talk') return [];
    if (typeof msg.content !== 'string') return [];
    const all = extractAllDirectivesAndText(msg.content);
    return all;
  }, [msg.msgType, msg.content]);

  // FIX: Kích hoạt Dedup Directives
  // Nếu một directive (Talk/Spawn) đã được phát thành tin nhắn độc lập trong hội thoại (hoặc đã được hiển thị ngoài luồng chat),
  // thì bên trong bubble tổng hợp của Orchestrator PHẢI ĐƯỢC ẨN ĐI (đưa vào duplicateDirectivesSet), không render lặp lại lần thứ 3!
  const duplicateDirectivesSet = useMemo(() => {
    const dups = new Set<number>();
    if (!allMessagesList || allMessagesList.length === 0) return dups;

    contentDirectives.forEach((dir, idx) => {
      if (dir.type === 'text') return;
      const targetAgent = (dir.data?.target || dir.data?.name || '').toLowerCase().trim();
      const taskBody = (dir.data?.task || dir.data?.message || '').toLowerCase().trim();

      // Kiểm tra xem đã có message độc lập nào trùng target hoặc nội dung/task không
      const exists = allMessagesList.some((other: any) => {
        if (!other || other.id === msg.id) return false;
        const otherTo = (other.to || '').toLowerCase().trim();
        const otherFrom = (other.from || '').toLowerCase().trim();
        const otherMsgType = other.msgType || '';
        const otherContent = typeof other.content === 'string' ? other.content.toLowerCase().trim() : '';

        // Khớp lệnh Talk độc lập: nếu bên ngoài đã có tin nhắn gửi tới worker (to === targetAgent hoặc otherMsgType === 'talk')
        if (dir.type === 'talk') {
          const isTargetMatch = otherTo === targetAgent || (agents.some(a => (a.id.toLowerCase() === targetAgent || a.name.toLowerCase() === targetAgent) && (otherTo === a.id.toLowerCase() || otherTo === a.name.toLowerCase())));
          if (isTargetMatch) {
            // Đã có message độc lập gửi cho agent này: ẩn ngay directive trong Orchestrator
            if (otherMsgType === 'talk' || other.task) return true;
            if (taskBody && (otherContent.includes(taskBody.substring(0, 30)) || taskBody.includes(otherContent.substring(0, 30)))) return true;
          }
        }

        // Khớp lệnh Spawn độc lập
        if (dir.type === 'spawn') {
          const isSpawnItem = otherContent.startsWith('[spawn]') || otherMsgType === 'spawn';
          if (isSpawnItem && (otherTo === targetAgent || otherContent.includes(targetAgent))) {
            return true;
          }
        }

        return false;
      });

      if (exists) {
        dups.add(idx);
      }
    });

    return dups;
  }, [contentDirectives, allMessagesList, msg.id, agents]);

  // Còn ít nhất 1 directive chưa có tin độc lập
  const activeDirectives = useMemo(() => {
    return contentDirectives.filter((dir, idx) => {
      if (dir.type === 'text') return true;
      return !duplicateDirectivesSet.has(idx);
    });
  }, [contentDirectives, duplicateDirectivesSet]);

  const hasDirectiveInItems = contentDirectives.some(d => d.type === 'talk' || d.type === 'spawn');
  const hasActiveDirectives = activeDirectives.some(d => d.type === 'talk' || d.type === 'spawn');
  const hasDuplicateIndependentTalk = hasDirectiveInItems && !hasActiveDirectives;

  const isOrchestratorTask = isEligibleOrchSender && (
    (msg.msgType === 'talk' && msg.to && msg.to !== 'user' && msg.to !== 'broadcast') ||
    hasActiveDirectives
  );
  const isSpawnMsg = isOrchestratorTask && (
    (typeof msg.content === 'string' && msg.content.trim().startsWith('[SPAWN]')) ||
    (typeof (msg as any).content === 'string' && /^\s*\[SPAWN\]/i.test((msg as any).content)) ||
    (typeof msg.content === 'string' && /<\s*spawn\b/i.test(msg.content) && !/<\s*talk\b/i.test(msg.content))
  );

  const isOrchView = isSelectedOrch;
  const isIncomingToOrch = (isOrchView && !isOrchestrator && !isUser) ||
    (isSubOrchView ? (msg.to === 'orchestrator' && !isUser && !isFromCurrentSubOrch) : (msg.to === 'orchestrator' && !isOrchestrator && !isUser));
  const effectiveShowToolBlocks = showToolBlocks && !isIncomingToOrch;

  // QUY TẮC CĂN LỀ THỐNG NHẤT BẤT BIẾN:
  // 1. DUY NHẤT User (isUser === true): LUÔN CĂN PHẢI (isAlignRight = true).
  // 2. TẤT CẢ các tin nhắn khác (bao gồm Orchestrator, Worker, Thẻ giao việc, Thẻ kết quả):
  //    LUÔN CĂN TRÁI (isAlignRight = false)!
  // Triệt tiêu 100% hiện tượng cùng 1 lượt giao việc nhưng bóng chat nhảy sang 2 bên trái/phải đối nghịch.
  const isAlignRight = Boolean(isUser);

  // Resolve task label for header with full defensive guards (đặt trước spawn/talk card để tránh TDZ)
  let rawTaskStr = '';
  if (typeof (msg as any)?.task === 'string' && (msg as any).task.trim()) {
    rawTaskStr = (msg as any).task;
  } else if (typeof (msg as any)?.taskName === 'string' && (msg as any).taskName.trim()) {
    rawTaskStr = (msg as any).taskName;
  } else {
    // Trích xuất task attribute từ XML <talk> hoặc <spawn> nếu msg.content chứa
    const xmlTagMatch = typeof msg.content === 'string' ? msg.content.match(/<\s*(?:talk|spawn)\b([^>]*)/i) : null;
    const tagAttrs = xmlTagMatch ? xmlTagMatch[1] : '';
    const xmlTaskAttr = tagAttrs ? tagAttrs.match(/\btask\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i) : null;
    if (xmlTaskAttr && (xmlTaskAttr[1] || xmlTaskAttr[2] || xmlTaskAttr[3])) {
      rawTaskStr = xmlTaskAttr[1] || xmlTaskAttr[2] || xmlTaskAttr[3];
    } else if (srcAgent && srcAgent.type !== 'orchestrator' && srcAgent.id !== 'orchestrator' && typeof srcAgent.task === 'string' && srcAgent.task.trim()) {
      rawTaskStr = srcAgent.task;
    } else if (targetAgent && targetAgent.type !== 'orchestrator' && targetAgent.id !== 'orchestrator' && typeof targetAgent.task === 'string' && targetAgent.task.trim()) {
      rawTaskStr = targetAgent.task;
    }
  }

  const cleanTaskTitle = rawTaskStr
    ? rawTaskStr.split('\n')[0].replace(/^#?\d+[\.:\s-]*\s*/, '').replace(/^\[(?:working|pending|completed|blocked)\]\s*/i, '').replace(/^(?:⚙️|⏳|✅|⚠️|⚡|🎯)\s*/, '').trim()
    : '';

  let spawnRole = '';
  let spawnAgentName = '';
  let spawnTaskDesc = '';
  if (isSpawnMsg) {
    const rawMatch = (msg.content || '').match(/^\s*\[SPAWN\]\s*(\S+)\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s*(?:assigned:\s*([\s\S]*))?$/i);
    if (rawMatch) {
      spawnRole = rawMatch[1] || '';
      spawnAgentName = rawMatch[2] || rawMatch[3] || rawMatch[4] || '';
      spawnTaskDesc = (rawMatch[5] || '').trim();
    } else {
      const xmlRole = (msg.content || '').match(/\brole\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
      const xmlName = (msg.content || '').match(/\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
      const xmlTask = (msg.content || '').match(/\btask\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
      const xmlBody = (msg.content || '').match(/<\s*spawn\b[^>]*>([\s\S]*?)<\/\s*spawn\s*>/i);
      spawnRole = xmlRole ? (xmlRole[1] || xmlRole[2] || xmlRole[3] || '') : ((msg as any).role || '');
      spawnAgentName = xmlName ? (xmlName[1] || xmlName[2] || xmlName[3] || '') : ((msg as any).name || '');
      const tDesc = xmlTask ? (xmlTask[1] || xmlTask[2] || xmlTask[3] || '') : '';
      const bDesc = xmlBody ? xmlBody[1].trim() : '';
      // FIX 3: Không nuốt toàn bộ content nếu không có task/body
      spawnTaskDesc = [tDesc, bDesc].filter(Boolean).join('\n\n') || cleanTaskTitle || (msg as any).task || '';
    }
  }

  let talkTaskDesc = '';
  if (isOrchestratorTask && !isSpawnMsg) {
    const rawContentStr = typeof msg.content === 'string' ? msg.content : '';
    // 1. Bracket format: [TALK target=... task=... message=...] or [TALK ...]...[/TALK]
    const bracketMatch = rawContentStr.match(/^\s*\[TALK\b([^\]]*)\]([\s\S]*?)(?:\[\/TALK\])?$/i);
    if (bracketMatch) {
      const bAttrs = bracketMatch[1] || '';
      const bBody = (bracketMatch[2] || '').replace(/\[\/TALK\]\s*$/i, '').trim();
      const msgMatch = bAttrs.match(/\b(?:message|msg|content)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s\]]+))/i);
      const taskMatch = bAttrs.match(/\btask\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s\]]+))/i);
      const attrMsg = msgMatch ? (msgMatch[1] || msgMatch[2] || msgMatch[3] || '') : '';
      const attrTask = taskMatch ? (taskMatch[1] || taskMatch[2] || taskMatch[3] || '') : '';
      talkTaskDesc = [attrMsg, bBody].filter(Boolean).join('\n\n') || attrTask;
    }
    // 2. XML format: <talk target="..." task="...">body</talk> or self-closing <talk target="..." task="..." message="..." />
    if (!talkTaskDesc) {
      const hasTalkTag = /<\s*talk\b/i.test(rawContentStr);
      if (hasTalkTag) {
        const xmlBodyMatch = rawContentStr.match(/<\s*talk\b[^>]*>([\s\S]*?)<\/\s*talk\s*>/i);
        const xmlTagMatch = rawContentStr.match(/<\s*talk\b([^>]*)(?:\/?>|<\/\s*talk\s*>)/i);
        const tagAttrs = xmlTagMatch ? xmlTagMatch[1] : '';
        const xmlTaskMatch = tagAttrs.match(/\btask\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
        const xmlMsgMatch = tagAttrs.match(/\b(?:message|msg|content)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
        const tAttr = xmlTaskMatch ? (xmlTaskMatch[1] || xmlTaskMatch[2] || xmlTaskMatch[3] || '') : '';
        const mAttr = xmlMsgMatch ? (xmlMsgMatch[1] || xmlMsgMatch[2] || xmlMsgMatch[3] || '') : '';
        const bText = xmlBodyMatch ? xmlBodyMatch[1].trim() : '';
        talkTaskDesc = [mAttr, bText].filter(Boolean).join('\n\n') || tAttr;
      }
    }
    // 3. Fallback: Nếu không phải bracket hay XML, hiển thị rawContentStr (body nội dung giao việc), nếu không có thì fallback sang task/title
    if (!talkTaskDesc) {
      talkTaskDesc = rawContentStr.trim() || (msg as any).task || cleanTaskTitle || '';
    }
  }

  let sender = msg.from;
  let senderColor = '#38bdf8';
  let roleBadge = '';

  if (isError) {
    sender = 'System Error';
    senderColor = '#f87171';
  } else if (isOpenCode) {
    sender = msg.agentName || (srcAgent ? srcAgent.name : (msg.from === 'orchestrator' ? 'Orchestrator' : (msg.from || 'Agent')));
    const isSenderOrch = isOrchestrator || msg.agentRole === 'orchestrator' || srcAgent?.role === 'orchestrator' || srcAgent?.type === 'orchestrator' || msg.from === 'orchestrator';
    senderColor = isSenderOrch ? '#a5b4fc' : '#22d3ee';
    roleBadge = isSenderOrch ? 'main' : (msg.agentRole || (srcAgent ? srcAgent.role : ''));
  } else if (isOrchestrator) {
    sender = msg.agentName || (srcAgent ? srcAgent.name : (msg.from === 'orchestrator' ? 'Orchestrator' : msg.from));
    senderColor = '#a5b4fc';
    roleBadge = 'main';
  } else if (isUser) {
    sender = 'You';
    senderColor = '#60a5fa';
  } else if (msg.from === 'system') {
    sender = 'System';
    senderColor = '#f87171';
  } else if (msg.agentName) {
    sender = msg.agentName;
    roleBadge = msg.agentRole || 'agent';
    senderColor = '#34d399';
  } else {
    if (srcAgent) {
      sender = srcAgent.name;
      roleBadge = srcAgent.role || 'agent';
    } else {
      sender = msg.from;
    }
    senderColor = '#34d399';
  }

  // Parse and strip internal prompt wrappers ([TEAM]...[/TEAM], [TASK], === INCOMING MESSAGE ===, === SYSTEM REMINDER ===, etc.)
  let rawContent: string = (msg.content || '').normalize('NFC');
  if (rawContent.includes('=== INCOMING MESSAGE ===') && rawContent.includes('=== MESSAGE ===')) {
    const msgIdx = rawContent.indexOf('=== MESSAGE ===');
    let inner = rawContent.substring(msgIdx + '=== MESSAGE ==='.length);
    const remIdx = inner.indexOf('=== SYSTEM REMINDER ===');
    if (remIdx !== -1) inner = inner.substring(0, remIdx);
    rawContent = inner.trim();
  }
  
  if (rawContent.includes('[TEAM]') && rawContent.includes('[/TEAM]')) {
    rawContent = rawContent.replace(/\[TEAM\][\s\S]*?\[\/TEAM\]/g, '').trim();
  }
  rawContent = rawContent.replace(/\[TASK\][^\n]*\n?/g, '').trim();
  if (rawContent.includes('=== SYSTEM REMINDER ===')) {
    const sRemIdx = rawContent.indexOf('=== SYSTEM REMINDER ===');
    rawContent = rawContent.substring(0, sRemIdx).trim();
  }
  if (rawContent.includes('=== INCOMING MESSAGE ===')) {
    rawContent = rawContent.replace(/=== INCOMING MESSAGE ===[\s\S]*?=== MESSAGE ===/g, '').trim();
  }

  // Parse [TO: xxx] prefix or <talk target="..."> prefix
  let toTag: string | null = null;
  const toMatch = rawContent.match(/^\s*\[TO:\s*([^\]]+)\]\s*/iu);
  if (toMatch) {
    toTag = toMatch[1].trim();
  } else {
    const xmlTalkMatch = rawContent.match(/<talk\s+[^>]*\btarget\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/iu);
    if (xmlTalkMatch) {
      toTag = (xmlTalkMatch[1] || xmlTalkMatch[2] || xmlTalkMatch[3] || '').trim();
    }
  }
  let body = rawContent
    .replace(/^\s*(?:\[FROM:\s*[^\]]+\]\s*)?\[TO:\s*[^\]]+\]\s*/iu, '')
    .replace(/^\s*<talk\b[^>]*>\s*/iu, '')
    .replace(/<\/talk>\s*$/iu, '');
  
  // TUYỆT ĐỐI KHÔNG gọi stripTalkTags trên tin nhắn báo cáo / phản hồi từ Worker gửi về Orchestrator
  // vì stripTalkTags sẽ xóa sạch toàn bộ nội dung nằm trong thẻ <talk target="orchestrator">...</talk>!
  const isWorkerReportToOrch = !isUser && !isOrchestrator && (msg.to === 'orchestrator' || toTag === 'orchestrator' || isIncomingToOrch);

  if (isWorkerReportToOrch) {
    // Chỉ loại bỏ các thẻ bọc mở/đóng <talk...>, </talk> và thẻ hệ thống delete_task, task_update
    body = rawContent
      .replace(/^\s*(?:\[FROM:\s*[^\]]+\]\s*)?\[TO:\s*[^\]]+\]\s*/iu, '')
      .replace(/<\s*talk\b[^>]*>/gi, '')
      .replace(/<\/\s*talk\s*>/gi, '')
      .replace(/\[\/?TALK\b[^\]]*\]/gi, '')
      .replace(/<\s*report(?:\s+[^>]*)?>/gi, '')
      .replace(/<\/\s*report\s*>/gi, '')
      .replace(/\[\/?REPORT\b[^\]]*\]/gi, '');
    body = stripSystemTaskTags(body);
  } else {
    // Luôn dùng stripTalkTags cho tin nhắn từ Orchestrator phát lệnh để loại sạch toàn bộ thẻ lẫn body đã tách vào directive card
    body = isUser ? body : stripTalkTags(body);
    body = isUser ? body : stripSystemTaskTags(body);
    if (!isUser) {
      body = body
        .replace(/<\s*report(?:\s+[^>]*)?>/gi, '')
        .replace(/<\/\s*report\s*>/gi, '')
        .replace(/\[\/?REPORT\b[^\]]*\]/gi, '');
    }
  }

  if (isOrchestratorInternal && !msg.showOnUI) {
    body = '_(Internal orchestrator planning hidden)_';
  }
  if (isOrchestratorTask && !isOpenCode) {
    // Khi đã render thành thẻ Giao việc / Directive Card, nếu không còn nội dung trao đổi ngoài thì dọn sạch để không in đè text rác
    body = body.replace(/^[ \t]*(?:=== AGENT MESSAGE ===[\s\S]*?=== END MESSAGE ===|\[TALK[^\]]*\][\s\S]*?\[\/TALK\]|<\s*talk\b[^>]*>[\s\S]*?<\/\s*talk\s*>|\[SPAWN\][\s\S]*?(?=(?:\[SPAWN\]|\[TALK\]|<\s*(?:talk|spawn)|$))|<\s*spawn\b[^>]*>[\s\S]*?<\/\s*spawn\s*>|<\s*spawn\b[^>]*\/>)\s*/gmi, '').trim();
    // Loại bỏ triệt để các directive tag <spawn ...>...</spawn>, <spawn .../> khỏi body để không sinh bubble text thừa
    body = body.replace(/<\s*spawn\b[^>]*>[\s\S]*?<\/\s*spawn\s*>/gmi, '').replace(/<\s*spawn\b[^>]*\/>/gmi, '').trim();
  }
  // Nếu tin nhắn là Spawn message hoặc chỉ chứa duy nhất lệnh Spawn/Talk, loại bỏ body text rác để không sinh thêm bubble text thứ 2
  if ((isSpawnMsg || contentDirectives.some(d => d.type === 'spawn')) && !isOpenCode) {
    body = '';
  }
  // Nếu đã render các directive/text theo thứ tự trong activeDirectives, tránh render lặp lại conversationText/body ở cuối
  if ((hasActiveDirectives || isOrchestratorTask) && !isOpenCode) {
    body = '';
  }
  const effectiveTo = msg.to && msg.to !== 'user' ? msg.to : toTag;

  // Resolve target display
  let displayTo = effectiveTo;
  if (effectiveTo) {
    if (effectiveTo === 'orchestrator') {
      displayTo = 'Orchestrator';
    } else if (effectiveTo === 'user') {
      displayTo = 'You';
    } else {
      targetAgent = agents.find(a => a?.id === effectiveTo || ((a?.name || '').toLowerCase() === String(effectiveTo).toLowerCase()));
      if (targetAgent) {
        displayTo = targetAgent.name;
      }
    }
  } else if (!effectiveTo && isOrchestrator && !isUser) {
    // Nếu Orchestrator/Sub-Orchestrator nói chung không chỉ định người nhận riêng, mặc định là trả lời You
    displayTo = 'You';
  }

  // Visual Bubble Themes — Full Flat Conversation Style (Cursor / Claude / v0 style)
  let bubbleBg = 'linear-gradient(135deg, rgba(30, 41, 59, 0.75) 0%, rgba(15, 23, 42, 0.75) 100%)';
  let bubbleBorder = '1px solid rgba(148, 163, 184, 0.15)';
  let textColor = 'var(--text-primary)';
  let bubbleShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';

  if (isOpenCode) {
    bubbleBg = 'rgba(30, 41, 59, 0.7)';
    bubbleBorder = '1px solid rgba(148, 163, 184, 0.18)';
    textColor = 'var(--text-secondary)';
    bubbleShadow = 'none';
  } else if (isOrchestratorTask) {
    if (isSpawnMsg) {
      // Card SPAWN AGENT: nền tím gradient sang trọng, viền tím phát sáng nhẹ
      bubbleBg = 'linear-gradient(135deg, rgba(168, 85, 247, 0.16) 0%, rgba(99, 102, 241, 0.12) 100%)';
      bubbleBorder = '1px solid rgba(168, 85, 247, 0.4)';
      textColor = 'var(--text-primary)';
      bubbleShadow = '0 4px 20px rgba(168, 85, 247, 0.15)';
    } else {
      // Card GIAO VIỆC (Talk/Task): nền chàm cyan gradient, viền chàm nét căng
      bubbleBg = 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(14, 165, 233, 0.1) 100%)';
      bubbleBorder = '1px solid rgba(99, 102, 241, 0.45)';
      textColor = 'var(--text-primary)';
      bubbleShadow = '0 4px 18px rgba(99, 102, 241, 0.14)';
    }
  } else if (isUser) {
    bubbleBg = 'linear-gradient(135deg, rgba(59, 130, 246, 0.18) 0%, rgba(37, 99, 235, 0.12) 100%)';
    bubbleBorder = '1px solid rgba(96, 165, 250, 0.3)';
    textColor = '#f0fdf4';
    bubbleShadow = '0 2px 10px rgba(37, 99, 235, 0.15)';
  } else if (isAlignRight) {
    // Agent báo cáo về Orchestrator / talk hiển thị căn phải
    bubbleBg = 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(30, 41, 59, 0.8) 100%)';
    bubbleBorder = '1px solid rgba(52, 211, 153, 0.25)';
    textColor = 'var(--text-primary)';
    bubbleShadow = '0 2px 10px rgba(16, 185, 129, 0.12)';
  } else if (isError || isStopError) {
    bubbleBg = 'rgba(239, 68, 68, 0.1)';
    bubbleBorder = '1px solid rgba(239, 68, 68, 0.3)';
    textColor = '#f87171';
    bubbleShadow = 'none';
  } else if (isQueued) {
    bubbleBg = 'rgba(245, 158, 11, 0.1)';
    bubbleBorder = '1px solid rgba(245, 158, 11, 0.3)';
    textColor = 'var(--text-primary)';
  } else if (isStopUser || isStopOrchestrator) {
    bubbleBg = 'rgba(234, 179, 8, 0.1)';
    bubbleBorder = '1px solid rgba(234, 179, 8, 0.3)';
    textColor = 'var(--text-primary)';
  }

  const formattedTime = formatTimestamp(msg.timestamp);
  const formattedSourceTime = msg.sourceCreatedAt ? formatTimestamp(msg.sourceCreatedAt) : '';
  const fullDateTime = formatFullDate(msg.timestamp);
  const hasQueueLatency = Boolean(msg.sourceCreatedAt && msg.timestamp && (Number(msg.timestamp) - Number(msg.sourceCreatedAt) > 3000));
  const timeTooltip = hasQueueLatency
    ? `${fullDateTime} (gốc tạo lúc ${formattedSourceTime}, trễ hàng đợi ${Math.round((Number(msg.timestamp) - Number(msg.sourceCreatedAt)) / 1000)}s)`
    : fullDateTime;

  const normBody = (body || '').normalize('NFC');
  // Split conversation text and structured report card
  const splitResult = useMemo(() => {
    if (isSpawnMsg || hasActiveDirectives || contentDirectives.some(d => d.type === 'spawn')) return { conversationText: '', hasReport: false };
    return isUser ? { conversationText: normBody, hasReport: false } : splitReportAndConversation(normBody);
  }, [normBody, isUser, isSpawnMsg, hasActiveDirectives, contentDirectives]);

  const { conversationText, hasReport, reportTitle, reportContent } = splitResult;

  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  const copyFullMarkdown = useCallback((e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    const rawContentStr = typeof msg.content === 'string' ? msg.content : '';
    const cleanContent = stripSystemTaskTags(conversationText || rawContentStr || body || '').trim();
    const timeStr = formattedTime || (msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '');
    const headerPrefix = timeStr ? `> 🕒 [${timeStr}] **${sender}**:` : `> **${sender}**:`;
    const fullMd = `${headerPrefix}\n\n${cleanContent}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(fullMd).then(() => {
        setCopiedMsgId(msg.id);
        setTimeout(() => setCopiedMsgId(null), 2000);
      }).catch(() => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = fullMd;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopiedMsgId(msg.id);
        setTimeout(() => setCopiedMsgId(null), 2000);
      });
    }
  }, [msg.id, msg.content, msg.timestamp, conversationText, body, formattedTime, sender]);

  // Handler tự động gán nhãn thời gian và định dạng Markdown khi bôi đen và bấm Ctrl+C / copy
  const handleBubbleCopy = useCallback((e: React.ClipboardEvent) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

    // Lấy html của vùng bôi đen
    const range = sel.getRangeAt(0);
    const div = document.createElement('div');
    div.appendChild(range.cloneContents());
    const rawSelectedHtml = div.innerHTML;
    const selectedMd = htmlToMarkdown(rawSelectedHtml);
    const plainText = sel.toString();
    const contentToCopy = selectedMd || plainText;
    if (!contentToCopy) return;

    const timeStr = formattedTime || (msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '');
    const headerPrefix = timeStr ? `> 🕒 [${timeStr}] **${sender}**:` : `> **${sender}**:`;
    const formattedResult = `${headerPrefix}\n\n${contentToCopy}`;

    if (e.clipboardData) {
      e.clipboardData.setData('text/plain', formattedResult);
      e.clipboardData.setData('text/markdown', formattedResult);
      e.preventDefault();
      e.stopPropagation();
    }
  }, [formattedTime, msg.timestamp, sender]);

  // Tin có toolCalls (hoặc log opencode) — các khối tool/thinking render ĐỘC LẬP ngoài bubble
  const hasToolBlocks = effectiveShowToolBlocks && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0;
  // Option C: server gửi msg.parts (text + tool xen kẽ theo đúng thứ tự emit). Nếu có → render interleaved,
  // bỏ qua Khối 2 (toolCalls block riêng) + Khối 3 (bubble text) để không in trùng.
  const hasParts = Array.isArray((msg as any).parts) && (msg as any).parts.length > 0;
  // Option A: parts có chứa 1+ phần 'thinking' → thinking nằm trong mảng interleaved, render đúng vị trí.
  // Khi đó ta ẨN Khối 1 fixed-top (trùng thinking) để không in 2 lần.
  const hasThinkingInParts = hasParts && ((msg as any).parts as any[]).some((p: any) => p && p.type === 'thinking' && String(p.content || '').trim().length > 0);
  const isRawCommandOutput = isOpenCode && /(?:<talk\s+|<spawn\s+|\[TALK\s+|\[SPAWN\s+|===\s*(?:TASK|ERROR|VERIFICATION)\s+REPORT\s*===)/i.test(msg.content || '');
  // Guard bubble rỗng: message chỉ có thinking/toolCall (content rỗng) KHÔNG tạo bubble text rỗng (cục tròn)
  const hasBubbleContent = (!!body && String(body).trim().length > 0) || isOrchestratorTask || (!!conversationText && conversationText.trim().length > 0) || (!!talkTaskDesc && talkTaskDesc.trim().length > 0);

  // Ẩn tin nội bộ: (1) orchestrator gửi lệnh nội bộ, (2) system broadcast nội bộ cho orchestrator
  // (from:'system' + to:'orchestrator' + msgType:'internal' do forwardToOrchestrator tạo).
  // GIỮ tin system hướng tới user (to:'user', msgType:'error', to:'all') — user cần thấy.
  const isSystemToOrchestrator = msg.from === 'system' && (msg.to === 'orchestrator' || agents.some(a => a.id === msg.to && (a.role === 'orchestrator' || a.type === 'orchestrator')));
  if ((isOrchestratorInternal && isOrchestrator && !msg.showOnUI) ||
      (isSystemToOrchestrator && !msg.showOnUI)) {
    return null;
  }

  if (isOpenCode && isRawCommandOutput && !hasToolBlocks && (!msg.thinking || !String(msg.thinking).trim())) {
    return null;
  }

  // Guard tin nhắn rỗng: nếu sau khi làm sạch không còn conversationText, không có report,
  // không có body, không có thinking, không có toolCalls và không có parts -> ẨN TOÀN BỘ MessageItem,
  // tránh sinh ra header mồ côi (chỉ hiện tên người gửi mà không có bong bóng nội dung nào).
  const cleanConvText = stripSystemTaskTags(conversationText || '').trim();
  const cleanBodyText = stripSystemTaskTags(body || '').trim();
  const hasAnyThinking = typeof msg.thinking === 'string' && msg.thinking.trim().length > 0;
  const hasAnyText = !!cleanConvText || 
                     !!(hasReport && reportContent && reportContent.trim()) || 
                     !!cleanBodyText ||
                     !!(spawnTaskDesc && spawnTaskDesc.trim()) ||
                     !!(talkTaskDesc && talkTaskDesc.trim()) ||
                     !!(cleanTaskTitle && cleanTaskTitle.trim());
  // Đảm bảo tin nhắn giao việc (isOrchestratorTask) KHÔNG BAO GIỜ bị nuốt bởi guard rỗng
  const hasAnyContent = hasAnyText || hasAnyThinking || hasToolBlocks || hasParts || isOrchestratorTask;

  if (!hasAnyContent) {
    return null;
  }

  return (
    <div
      className="fade-in af-message-item-container"
      onCopy={handleBubbleCopy}
      data-msg-id={msg.id}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isAlignRight ? 'flex-end' : 'flex-start',
        alignSelf: isAlignRight ? 'flex-end' : 'flex-start',
        width: '100%',
        minWidth: 0,
        overflowWrap: 'anywhere',
        marginBottom: 14,
        // Fix copy 6.33: chặn selection lan sang cả khối (sender header/tool thinking header là
        // tiện ích không cần copy). Root kế thừa none; các bubble content element bên dưới
        // override userSelect:'text' để user vẫn chọn được đúng text tin nhắn, không nhảy ra
        // toàn bộ panel/block khi kéo qua nhiều tin liền kề.
        userSelect: 'none'
      }}
    >
      {/* Sender Header: Clean, Spacious, High-Contrast Routing Pills */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: isAlignRight ? 'flex-end' : 'flex-start',
        alignSelf: isAlignRight ? 'flex-end' : 'flex-start',
        gap: 8,
        fontSize: 11,
        marginBottom: 6,
        fontWeight: 600,
        paddingLeft: isAlignRight ? 0 : 2,
        paddingRight: isAlignRight ? 2 : 0,
        flexDirection: isAlignRight ? 'row-reverse' : 'row',
        flexWrap: 'nowrap',
        overflowX: 'auto',
        maxWidth: '100%',
        scrollbarWidth: 'none'
      }}>
        {/* Sender Capsule Pill */}
        <span
          className={`af-sender-pill ${isUser ? 'af-sender-user' : isOrchestrator ? 'af-sender-orch' : 'af-sender-worker'}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 10px',
            borderRadius: 6,
            fontSize: 11.5,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            background: '#000000',
            border: isUser
              ? '1px solid rgba(96, 165, 250, 0.4)'
              : isOrchestrator
              ? '1px solid rgba(129, 140, 248, 0.4)'
              : '1px solid rgba(52, 211, 153, 0.4)',
            color: isUser ? '#93c5fd' : isOrchestrator ? '#c7d2fe' : '#6ee7b7'
          }}
        >
          {isOrchestrator && <span>👑</span>}
          {isUser && <span>👤</span>}
          {!isOrchestrator && !isUser && <span>🤖</span>}
          <span>{sender}</span>
          {!isOrchestrator && !isUser && roleBadge && (
            <span style={{ opacity: 0.85, fontWeight: 500, fontSize: 10 }}>· {roleBadge}</span>
          )}
        </span>

        {/* Direction Arrow & Receiver Capsule Pill */}
        {displayTo && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span className="af-receiver-arrow" style={{ color: '#818cf8', fontWeight: 700, fontSize: 12, lineHeight: 1 }}>➜</span>
            <span
              className="af-receiver-pill"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 10px',
                borderRadius: 6,
                fontSize: 11.5,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                background: '#000000',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#f8fafc'
              }}
            >
              {String(displayTo || '').toLowerCase() === 'you' || String(displayTo || '').toLowerCase() === 'user' ? <span>👤</span> : <span>🤖</span>}
              <span>{displayTo}</span>
            </span>
          </span>
        )}

        {/* Task Capsule Pill - Chỉ hiển thị khi KHÔNG phải là thẻ giao việc orchestratorTask để tránh lặp 2 lần tiêu đề */}
        {!isOrchestratorTask && cleanTaskTitle && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              borderRadius: 6,
              background: 'rgba(59, 130, 246, 0.12)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              color: 'var(--af-primary, #60a5fa)',
              fontSize: 11,
              fontWeight: 500,
              maxWidth: 280,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flexShrink: 1
            }}
            title={`Nhiệm vụ: ${cleanTaskTitle}`}
          >
            <span>🎯</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cleanTaskTitle}
            </span>
          </span>
        )}

        {/* Queued Status & Force Send Button on Bubble Header */}
        {(() => {
          const queuedItem = queuedMessages.find(q => q.id === msg.id);
          if (!queuedItem) return null;
          return (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                fontSize: 10.5,
                color: '#fde68a',
                flexShrink: 0
              }}
            >
              <span>⏳ Đang trong hàng đợi</span>
              {onForceSendSingle && (
                <button
                  onClick={() => onForceSendSingle(queuedItem.id, queuedItem.content, queuedItem.to || selectedAgentId || 'orchestrator')}
                  style={{
                    background: 'rgba(245, 158, 11, 0.3)',
                    border: '1px solid rgba(245, 158, 11, 0.6)',
                    color: '#fff',
                    borderRadius: 3,
                    padding: '1px 5px',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                  title="Ngắt lượt hiện tại và gửi ngay tin này"
                >
                  ⚡ Gửi ngay
                </button>
              )}
            </span>
          );
        })()}

        {/* Monospace Timestamp */}
        {formattedTime && (
          <span
            style={{
              color: 'var(--text-muted)',
              fontSize: 10,
              fontWeight: 500,
              fontFamily: 'monospace',
              opacity: 0.85,
              flexShrink: 0,
              marginLeft: isUser ? 0 : 4,
              marginRight: isUser ? 4 : 0
            }}
            title={timeTooltip}
          >
            {formattedTime}
            {hasQueueLatency && formattedSourceTime && (
              <span style={{ opacity: 0.65, fontSize: 9, marginLeft: 3 }}>
                (gốc {formattedSourceTime})
              </span>
            )}
          </span>
        )}

        {/* Action Button: Copy Markdown (nhãn chữ rõ nét) */}
        <button
          onClick={copyFullMarkdown}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2px 8px',
            borderRadius: 4,
            background: copiedMsgId === msg.id ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.06)',
            border: copiedMsgId === msg.id ? '1px solid rgba(34, 197, 94, 0.5)' : '1px solid rgba(255, 255, 255, 0.12)',
            color: copiedMsgId === msg.id ? '#4ade80' : 'var(--text-muted, #94a3b8)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            flexShrink: 0,
            marginLeft: isUser ? 0 : 4,
            marginRight: isUser ? 4 : 0,
            userSelect: 'none'
          }}
          title={copiedMsgId === msg.id ? 'Đã sao chép vào clipboard!' : 'Sao chép Markdown'}
        >
          {copiedMsgId === msg.id ? 'Copied!' : 'Copy'}
        </button>
      </div>

{/* Khối 1: Thinking (nếu có) — nằm riêng độc lập, NGOÀI bubble.
        ẨN hoàn toàn khi tin nhắn đã có parts (hasParts) — thinking, tool, text đều được render xen kẽ tuần tự trong mảng parts. */}
      {!hasParts && typeof msg.thinking === 'string' && msg.thinking.trim() && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: '100%',
          alignSelf: isUser ? 'flex-end' : 'flex-start',
          marginBottom: 4,
          userSelect: 'text'
        }}>
          <ThinkingBlock thinking={msg.thinking} />
        </div>
      )}

      {/* Khối 2: ToolCallBlocks — các hộp công cụ độc lập, NGOÀI bubble (bỏ qua khi đã render interleaved parts) */}
      {!hasParts && effectiveShowToolBlocks && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          width: isMobile ? '100%' : '58%',
          minWidth: isMobile ? '100%' : '52%',
          maxWidth: isMobile ? '100%' : '95%',
          alignSelf: isAlignRight ? 'flex-end' : 'flex-start',
          marginBottom: 4,
          userSelect: 'text'
        }}>
          {(msg.toolCalls as any[]).map((tc, i) => {
            // Chuẩn hóa entry — entry lỗi định dạng không được làm sập panel
            const safe = {
              tool: typeof tc?.tool === 'string' && tc.tool ? tc.tool : 'tool',
              input: tc?.input === undefined || tc?.input === null ? undefined : String(tc.input),
              output: tc?.output === undefined || tc?.output === null ? undefined : String(tc.output)
            };
            return (
              <ToolBlockSafe key={safe.tool + '-' + i} tool={safe.tool} input={safe.input} output={safe.output}>
                <ToolCallBlock tool={safe.tool} input={safe.input} output={safe.output} isMobile={isMobile} defaultExpanded={defaultExpandToolcalls} />
              </ToolBlockSafe>
            );
          })}
        </div>
      )}

      {/* Khối 2.5: Option C — render parts xen kẽ text + tool theo ĐÚNG thứ tự opencode emit.
          Server gửi msg.parts = [ {type:'text',content}, {type:'tool',tool,input,output}, ... ].
          Text segment render như bubble text; tool segment render ToolCallBlock. */}
      {hasParts && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          width: isMobile ? '100%' : '58%',
          minWidth: isMobile ? '100%' : '52%',
          maxWidth: isMobile ? '100%' : '95%',
          alignSelf: isAlignRight ? 'flex-end' : 'flex-start',
          gap: 4,
          userSelect: 'text'
        }}>
          {((msg as any).parts as any[]).map((part, i) => {
            if (!part) return null;
            if (part.type === 'tool') {
              if (!effectiveShowToolBlocks) return null;
              const safeTool = {
                tool: typeof part.tool === 'string' && part.tool ? part.tool : 'tool',
                input: part.input === undefined || part.input === null ? undefined : String(part.input),
                output: part.output === undefined || part.output === null ? undefined : String(part.output)
              };
              return (
                <div key={'pt-' + i} style={{ width: '100%', maxWidth: '100%' }}>
                  <ToolBlockSafe tool={safeTool.tool} input={safeTool.input} output={safeTool.output}>
                    <ToolCallBlock tool={safeTool.tool} input={safeTool.input} output={safeTool.output} isMobile={isMobile} defaultExpanded={defaultExpandToolcalls} />
                  </ToolBlockSafe>
                </div>
              );
            }
            // Option A: phần 'thinking' interleaved — render collapsible ĐÚNG vị trí trong mảng parts.
            if (part.type === 'thinking') {
              const thinkContent = String(part.content || '').trim();
              if (!thinkContent) return null;
              return (
                <div key={'pt-' + i} style={{ width: '100%', maxWidth: '100%' }}>
                  <ThinkingBlock thinking={thinkContent} />
                </div>
              );
            }
            // Fix interleave 6.44 (rework 6.33): GIỮ render text segments của snapshot opencode trong
            // Khối 2.5 để xen kẽ text + tool ĐÚNG thứ tự emit. Server giờ giữ text+tool trong parts.
            // text không nhân đôi vì Khối 2 + Khối 3 bị ẩn khi hasParts, và canonical reply trùng được
            // lọc ở agent view (App.tsx). Đoạn text dạng "TYPE: ..." (assistant/user/system metadata)
            // được bỏ tiền tố TYPE để hiển thị sạch; event text thô giữ nguyên.
            let segText = String(part.content || '');
            if (!segText) return null;
            // Bỏ tiền tố "TYPE: " (ASSISTANT:/USER:/SYSTEM:...) trên segment text meta — hiển thị nội dung thật
            if (isOpenCode && /^[A-Z_]+:\s/u.test(segText) && !/^✖|^◆/u.test(segText)) {
              segText = segText.replace(/^[A-Z_]+:\s?/u, '');
            }

            // Kiểm tra xem segment này có chứa thẻ điều phối (<spawn> hoặc <talk>) không
            const hasDirectiveInPart = /(?:\[(?:TALK|SPAWN|TASK)\]|<\s*(?:talk|spawn)\b)/i.test(segText);

            if (hasDirectiveInPart && isEligibleOrchSender) {
              const items = extractAllDirectivesAndText(segText);

              return (
                <React.Fragment key={'pt-' + i}>
                  {items.map((item, subIdx) => {
                    if (item.type === 'text') {
                      const cleanT = stripTalkTags(item.text).trim();
                      if (!cleanT) return null;
                      return (
                        <div
                          key={`pt-${i}-txt-${subIdx}`}
                          className={`af-bubble${isAlignRight ? ' af-bubble-user' : ''}`}
                          style={{
                            background: bubbleBg,
                            color: textColor,
                            padding: '10px 14px',
                            paddingRight: 48,
                            borderRadius: isAlignRight ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                            width: 'fit-content',
                            maxWidth: isMobile ? '96%' : '82%',
                            minWidth: 0,
                            overflowWrap: 'anywhere',
                            boxSizing: 'border-box',
                            fontSize: 12.5,
                            lineHeight: 1.45,
                            whiteSpace: 'normal',
                            fontFamily: 'inherit',
                            border: bubbleBorder,
                            boxShadow: bubbleShadow,
                            wordBreak: 'break-word',
                            position: 'relative',
                            alignSelf: isAlignRight ? 'flex-end' : 'flex-start',
                            marginLeft: isAlignRight ? 'auto' : undefined,
                            marginRight: isAlignRight ? undefined : 'auto',
                            marginBottom: 4
                          }}
                        >
                          <button
                            onClick={copyFullMarkdown}
                            style={{
                              position: 'absolute',
                              top: 6,
                              right: 6,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: copiedMsgId === msg.id ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                              border: copiedMsgId === msg.id ? '1px solid rgba(34, 197, 94, 0.5)' : '1px solid rgba(255, 255, 255, 0.12)',
                              color: copiedMsgId === msg.id ? '#4ade80' : 'var(--text-muted, #94a3b8)',
                              fontSize: 10,
                              fontWeight: 600,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              zIndex: 2,
                              userSelect: 'none'
                            }}
                            title={copiedMsgId === msg.id ? 'Đã sao chép vào clipboard!' : 'Sao chép Markdown'}
                          >
                            {copiedMsgId === msg.id ? 'Copied!' : 'Copy'}
                          </button>
                          <MarkdownRenderer content={cleanT} isMobile={isMobile} />
                        </div>
                      );
                    }

                    if (item.type === 'spawn') {
                      const pSpawnRole = item.data.role || '';
                      const pSpawnAgentName = item.data.name || '';
                      const pSpawnTaskDesc = item.data.task || cleanTaskTitle || '';
                      const displayTargetName = pSpawnAgentName || pSpawnRole || 'Agent';

                      return (
                        <UnifiedDirectiveCard
                          key={`pt-${i}-sp-${subIdx}`}
                          type="spawn"
                          title={pSpawnTaskDesc}
                          role={pSpawnRole}
                          targetName={displayTargetName}
                          senderName={srcAgent?.name || 'Orchestrator'}
                          content={item.data.message || pSpawnTaskDesc || item.raw}
                          isMobile={isMobile}
                          bubbleBg={bubbleBg}
                          bubbleBorder={bubbleBorder}
                          bubbleShadow={bubbleShadow}
                          textColor={textColor}
                          isAlignRight={isAlignRight}
                          isOpenCode={isOpenCode}
                          defaultExpanded={defaultExpandToolcalls}
                        />
                      );
                    }

                    if (item.type === 'report') {
                      const pReportTarget = item.data.target || 'orchestrator';
                      const pReportTitle = item.data.title || item.data.task || 'Báo Cáo Tiến Độ / Kết Quả';
                      const pReportContent = item.data.message || item.raw;

                      return (
                        <UnifiedDirectiveCard
                          key={`pt-${i}-rp-${subIdx}`}
                          type="report"
                          title={pReportTitle}
                          targetName={pReportTarget}
                          senderName={srcAgent?.name || msg.from || 'Agent'}
                          content={pReportContent}
                          isMobile={isMobile}
                          bubbleBg={bubbleBg}
                          bubbleBorder={bubbleBorder}
                          bubbleShadow={bubbleShadow}
                          textColor={textColor}
                          isAlignRight={isAlignRight}
                          isOpenCode={isOpenCode}
                          defaultExpanded={defaultExpandToolcalls}
                        />
                      );
                    }

                    if (item.type === 'talk') {
                      const pTalkTarget = item.data.target || '';
                      const pTalkTaskTitle = item.data.task || '';
                      const pTalkBody = item.data.message || '';
                      const displayTargetName = pTalkTarget || displayTo || 'Agent';

                      return (
<UnifiedDirectiveCard
                           key={`pt-${i}-tk-${subIdx}`}
                           type="talk"
                           title={pTalkTaskTitle || (pTalkBody ? (pTalkBody.split('\n')[0].substring(0, 80) + '...') : '')}
                           targetName={displayTargetName}
                           senderName={srcAgent?.name || (msg.agentRole === 'orchestrator' ? 'Orchestrator' : 'Orchestrator')}
                           content={pTalkBody || pTalkTaskTitle || item.raw}
                           isMobile={isMobile}
                           bubbleBg={bubbleBg}
                           bubbleBorder={bubbleBorder}
                           bubbleShadow={bubbleShadow}
                           textColor={textColor}
                           isAlignRight={isAlignRight}
                           isOpenCode={isOpenCode}
                           defaultExpanded={defaultExpandToolcalls}
                         />
                      );
                    }

                    return null;
                  })}
                </React.Fragment>
              );
            }

            // Gọt sạch các thẻ lệnh điều phối (<talk>, <spawn>) nếu lọt vào segment text thường
            segText = stripTalkTags(segText);
            if (!String(segText).trim()) return null;

            // Bóc tách cấu trúc report nếu segment này chứa <report>...</report> hoặc === TASK REPORT ===
            const segSplit = splitReportAndConversation(segText);
            const segConvText = segSplit.conversationText;
            const segHasReport = segSplit.hasReport;
            const segReportTitle = segSplit.reportTitle;
            const segReportContent = segSplit.reportContent;

            return (
              <div
                key={'pt-' + i}
                className={`af-bubble${isAlignRight ? ' af-bubble-user' : ''}`}
                style={{
                background: bubbleBg,
                color: textColor,
                padding: '10px 14px',
                borderRadius: isAlignRight ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                width: 'fit-content',
                maxWidth: isMobile ? '96%' : '82%',
                minWidth: 0,
                overflowWrap: 'anywhere',
                boxSizing: 'border-box',
                fontSize: isOpenCode ? 12 : (isMobile ? 12 : 12.5),
                lineHeight: 1.45,
                whiteSpace: 'normal',
                fontFamily: 'inherit',
                border: bubbleBorder,
                boxShadow: bubbleShadow,
                wordBreak: 'break-word',
                position: 'relative',
                alignSelf: isAlignRight ? 'flex-end' : 'flex-start',
                marginLeft: isAlignRight ? 'auto' : undefined,
                marginRight: isAlignRight ? undefined : 'auto'
              }}>
                <MarkdownRenderer content={segConvText || segText} isMobile={isMobile} />
              </div>
            );
          })}
        </div>
      )}

      {/* Khối 3: Bubble text — dạng flat stream chuyên nghiệp. Chỉ render khi có nội dung text thật */}
      {!hasParts && ((hasBubbleContent || isOrchestratorTask) && (!isOpenCode || !isRawCommandOutput || (!hasToolBlocks && (!msg.thinking || !String(msg.thinking).trim())))) && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            maxWidth: '100%',
            alignSelf: isAlignRight ? 'flex-end' : 'flex-start',
            alignItems: isAlignRight ? 'flex-end' : 'flex-start',
            gap: 6,
            userSelect: 'text'
          }}
        >
          {/* A. Render tuần tự theo đúng thứ tự xuất hiện của từng Directive/Text item trong CÙNG 1 KHỐI BUBBLE THỐNG NHẤT */}
          {activeDirectives.length > 0 ? (
            <div
              className={`af-bubble${isAlignRight ? ' af-bubble-user' : ''}`}
              style={{
                background: isOrchestratorTask ? '#ffffff' : bubbleBg,
                color: isOrchestratorTask ? '#0f172a' : textColor,
                padding: '12px 14px',
                paddingRight: 48,
                borderRadius: '16px 16px 16px 4px',
                width: 'fit-content',
                maxWidth: isMobile ? '96%' : '85%',
                minWidth: 0,
                overflowWrap: 'anywhere',
                boxSizing: 'border-box',
                fontSize: isOpenCode ? 12 : 12.5,
                lineHeight: 1.5,
                whiteSpace: 'normal',
                fontFamily: 'inherit',
                border: isOrchestratorTask ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.08)',
                boxShadow: isOrchestratorTask ? '0 1px 3px rgba(0, 0, 0, 0.05)' : bubbleShadow,
                wordBreak: 'break-word',
                position: 'relative',
                userSelect: 'text',
                alignSelf: isAlignRight ? 'flex-end' : 'flex-start',
                marginLeft: isAlignRight ? 'auto' : undefined,
                marginRight: isAlignRight ? undefined : 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }}
            >
              {/* Nút Copy cho bubble Orchestrator Directive */}
              <button
                onClick={copyFullMarkdown}
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: copiedMsgId === msg.id ? 'rgba(34, 197, 94, 0.2)' : (isOrchestratorTask ? '#f1f5f9' : 'rgba(255, 255, 255, 0.08)'),
                  border: copiedMsgId === msg.id ? '1px solid rgba(34, 197, 94, 0.5)' : (isOrchestratorTask ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.12)'),
                  color: copiedMsgId === msg.id ? '#16a34a' : (isOrchestratorTask ? '#475569' : 'var(--text-muted, #94a3b8)'),
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  zIndex: 2,
                  userSelect: 'none'
                }}
                title={copiedMsgId === msg.id ? 'Đã sao chép vào clipboard!' : 'Sao chép Markdown'}
              >
                {copiedMsgId === msg.id ? 'Copied!' : 'Copy'}
              </button>
              {activeDirectives.map((dir, dIdx) => {
                if (dir.type === 'text') {
                  const cleanT = stripSystemTaskTags(stripTalkTags(dir.text || dir.data?.raw || '')).trim();
                  if (!cleanT) return null;
                  return (
                    <div key={`msg-dir-txt-${dIdx}`} style={{ width: '100%', lineHeight: 1.55, color: isOrchestratorTask ? '#0f172a' : textColor }}>
                      <MarkdownRenderer content={cleanT} isMobile={isMobile} />
                    </div>
                  );
                }

                if (dir.type === 'spawn') {
                  const curRole = dir.data.role || '';
                  const curName = dir.data.name || '';
                  const curTask = dir.data.task || cleanTaskTitle || '';
                  const dTarget = curName || curRole || 'New Agent';

                  return (
<UnifiedDirectiveCard
                       key={`msg-dir-sp-${dIdx}`}
                       type="spawn"
                       title={curTask}
                       role={curRole}
                       targetName={dTarget}
                       senderName={srcAgent?.name || 'Orchestrator'}
                       content={dir.data.message || curTask || dir.raw}
                       isMobile={isMobile}
                       bubbleBg="#ffffff"
                       bubbleBorder="1px solid #e2e8f0"
                       bubbleShadow="0 1px 3px rgba(0, 0, 0, 0.05)"
                       textColor="#0f172a"
                       isAlignRight={isAlignRight}
                       isOpenCode={isOpenCode}
                       defaultExpanded={defaultExpandToolcalls}
                     />
                  );
                }

                if (dir.type === 'report') {
                  const curReportTarget = dir.data.target || 'orchestrator';
                  const curReportTitle = dir.data.title || dir.data.task || 'Báo Cáo Tiến Độ / Kết Quả';
                  const curReportContent = dir.data.message || dir.raw;

                  return (
                    <UnifiedDirectiveCard
                      key={`msg-dir-rp-${dIdx}`}
                      type="report"
                      title={curReportTitle}
                      targetName={curReportTarget}
                      senderName={srcAgent?.name || msg.from || 'Agent'}
                      content={curReportContent}
                      isMobile={isMobile}
                      bubbleBg="#ffffff"
                      bubbleBorder="1px solid #e2e8f0"
                      bubbleShadow="0 1px 3px rgba(0, 0, 0, 0.05)"
                      textColor="#0f172a"
                      isAlignRight={isAlignRight}
                      isOpenCode={isOpenCode}
                      defaultExpanded={defaultExpandToolcalls}
                    />
                  );
                }

                // dir.type === 'talk'
                const curTarget = dir.data.target || displayTo || 'Agent';
                const curTaskTitle = dir.data.task || '';
                const curBody = dir.data.message || '';
                const fullTalkContent = curBody || curTaskTitle || dir.raw;

                return (
                  <UnifiedDirectiveCard
                    key={`msg-dir-tk-${dIdx}`}
                    type="talk"
                    title={curTaskTitle || (curBody ? (curBody.split('\n')[0].substring(0, 80) + '...') : '')}
                    targetName={curTarget}
                    senderName={srcAgent?.name || (msg.agentRole === 'orchestrator' ? 'Orchestrator' : 'Orchestrator')}
content={fullTalkContent}
                      isMobile={isMobile}
                      bubbleBg="#ffffff"
                      bubbleBorder="1px solid #e2e8f0"
                      bubbleShadow="0 1px 3px rgba(0, 0, 0, 0.05)"
                      textColor="#0f172a"
                      isAlignRight={isAlignRight}
                      isOpenCode={isOpenCode}
                      defaultExpanded={defaultExpandToolcalls}
                    />
                  );
              })}
            </div>
          ) : isOrchestratorTask ? (
            <div
              className={`af-bubble${isAlignRight ? ' af-bubble-user' : ''}`}
              style={{
                background: isOrchestratorTask ? '#ffffff' : bubbleBg,
                color: isOrchestratorTask ? '#0f172a' : textColor,
                padding: '12px 14px',
                paddingRight: 48,
                borderRadius: '16px 16px 16px 4px',
                width: 'fit-content',
                maxWidth: isMobile ? '96%' : '85%',
                minWidth: 0,
                overflowWrap: 'anywhere',
                boxSizing: 'border-box',
                fontSize: isOpenCode ? 12 : 12.5,
                lineHeight: 1.5,
                whiteSpace: 'normal',
                fontFamily: 'inherit',
                border: isOrchestratorTask ? '1px solid #e2e8f0' : '1px solid rgba(255, 255, 255, 0.08)',
                boxShadow: isOrchestratorTask ? '0 1px 3px rgba(0, 0, 0, 0.05)' : bubbleShadow,
                wordBreak: 'break-word',
                position: 'relative',
                userSelect: 'text',
                alignSelf: isAlignRight ? 'flex-end' : 'flex-start',
                marginLeft: isAlignRight ? 'auto' : undefined,
                marginRight: isAlignRight ? undefined : 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }}
            >
              {/* Nút Copy cho bubble dẫn dắt Orchestrator */}
              <button
                onClick={copyFullMarkdown}
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: copiedMsgId === msg.id ? 'rgba(34, 197, 94, 0.2)' : (isOrchestratorTask ? '#f1f5f9' : 'rgba(255, 255, 255, 0.08)'),
                  border: copiedMsgId === msg.id ? '1px solid rgba(34, 197, 94, 0.5)' : (isOrchestratorTask ? '1px solid #cbd5e1' : '1px solid rgba(255, 255, 255, 0.12)'),
                  color: copiedMsgId === msg.id ? '#16a34a' : (isOrchestratorTask ? '#475569' : 'var(--text-muted, #94a3b8)'),
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  zIndex: 2,
                  userSelect: 'none'
                }}
                title={copiedMsgId === msg.id ? 'Đã sao chép vào clipboard!' : 'Sao chép Markdown'}
              >
                {copiedMsgId === msg.id ? 'Copied!' : 'Copy'}
              </button>
              {/* Nếu có lời dẫn tự sự conversationText, LUÔN LUÔN RENDER bảo toàn 100% */}
              {(() => {
                const convText = stripSystemTaskTags(conversationText).trim();
                if (!convText) return null;
                return (
                  <div style={{ width: '100%', lineHeight: 1.55, color: isOrchestratorTask ? '#0f172a' : textColor }}>
                    <MarkdownRenderer content={convText} isMobile={isMobile} />
                  </div>
                );
              })()}

              {/* Directive Card nhúng */}
              {!hasDuplicateIndependentTalk && (
                isSpawnMsg ? (
                  <UnifiedDirectiveCard
                    type="spawn"
                    title={spawnTaskDesc || cleanTaskTitle || 'Khởi tạo agent'}
                    role={spawnRole}
                    targetName={spawnAgentName || displayTo || 'New Agent'}
                    senderName={srcAgent?.name || 'Orchestrator'}
                    content={spawnTaskDesc || cleanTaskTitle || 'Khởi tạo agent'}
                    isMobile={isMobile}
                    bubbleBg="#ffffff"
                    bubbleBorder="1px solid #e2e8f0"
                    bubbleShadow="0 1px 3px rgba(0, 0, 0, 0.05)"
                    textColor="#0f172a"
                    isAlignRight={isAlignRight}
                    isOpenCode={isOpenCode}
                    defaultExpanded={defaultExpandToolcalls}
                  />
                ) : (
                  <UnifiedDirectiveCard
                    type="talk"
                    title={cleanTaskTitle || (talkTaskDesc ? (talkTaskDesc.split('\n')[0].substring(0, 80) + '...') : '')}
                    targetName={displayTo || 'Agent'}
                    senderName={srcAgent?.name || (msg.agentRole === 'orchestrator' ? 'Orchestrator' : 'Orchestrator')}
                    content={talkTaskDesc || cleanTaskTitle || (typeof msg.content === 'string' ? msg.content : '')}
                    isMobile={isMobile}
                    bubbleBg="#ffffff"
                    bubbleBorder="1px solid #e2e8f0"
                    bubbleShadow="0 1px 3px rgba(0, 0, 0, 0.05)"
                    textColor="#0f172a"
                    isAlignRight={isAlignRight}
                    isOpenCode={isOpenCode}
                    defaultExpanded={defaultExpandToolcalls}
                  />
                )
              )}
            </div>
          ) : null}

          {/* Render riêng bubble trò chuyện cho conversationText hoặc body (nếu có lời thoại) */}
          {(() => {
            // Khi đây là tin nhắn giao việc đã có Thẻ Giao Việc (UnifiedDirectiveCard):
            // TUYỆT ĐỐI KHÔNG vẽ thêm bong bóng text nữa nếu conversationText trùng với nội dung thẻ!
            if (isOrchestratorTask) return null;

            const rawDisplayText = conversationText || body;
            const cleanDisplayText = stripSystemTaskTags(rawDisplayText).trim();
            if (!cleanDisplayText) return null;

            return (
              <div
                className={`af-bubble${isAlignRight ? ' af-bubble-user' : ''}`}
                style={{
                  background: bubbleBg,
                  color: textColor,
                  padding: '10px 14px',
                  paddingRight: 48,
                  borderRadius: isAlignRight ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                  width: 'fit-content',
                  maxWidth: isMobile ? '96%' : '82%',
                  minWidth: 0,
                  overflowWrap: 'anywhere',
                  boxSizing: 'border-box',
                  fontSize: isOpenCode ? 12 : 12.5,
                  lineHeight: 1.45,
                  whiteSpace: 'normal',
                  fontFamily: 'inherit',
                  border: bubbleBorder,
                  boxShadow: bubbleShadow,
                  wordBreak: 'break-word',
                  position: 'relative',
                  userSelect: 'text',
                  alignSelf: isAlignRight ? 'flex-end' : 'flex-start',
                  marginLeft: isAlignRight ? 'auto' : undefined,
                  marginRight: isAlignRight ? undefined : 'auto'
                }}
              >
                {/* Nút Copy đặt ở góc trên bên phải của Bubble text */}
                <button
                  onClick={copyFullMarkdown}
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: copiedMsgId === msg.id ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                    border: copiedMsgId === msg.id ? '1px solid rgba(34, 197, 94, 0.5)' : '1px solid rgba(255, 255, 255, 0.12)',
                    color: copiedMsgId === msg.id ? '#4ade80' : 'var(--text-muted, #94a3b8)',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    zIndex: 2,
                    userSelect: 'none'
                  }}
                  title={copiedMsgId === msg.id ? 'Đã sao chép vào clipboard!' : 'Sao chép Markdown'}
                >
                  {copiedMsgId === msg.id ? 'Copied!' : 'Copy'}
                </button>
                <MarkdownRenderer content={cleanDisplayText} isMobile={isMobile} />
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
});

interface Props {
  messages: Message[];
  onSend: (text: string) => void;
  onStop?: () => void;
  onClear?: () => void;
  loading?: boolean;
  title?: string;
  selectedAgentId?: string | null;
  tokenUsage?: number | TokenUsageDetail;
  contextLength?: number;
  cost?: number;
  model?: string;
  status?: string;
  formatMessage?: (msg: ChatMsg) => { sender: string; content: string; isUser: boolean; timestamp?: number };
  allMessages?: ChatMsg[];
  agents?: AgentInfo[];
  isMobile?: boolean;
  connStatus?: 'connected' | 'disconnected';
  offlineForText?: string;
  uptimeText?: string;
  showToolBlocks?: boolean;
  defaultExpandToolcalls?: boolean;
  queuedMessages?: ChatMsg[];
  onFlushQueue?: () => void;
  onClearQueue?: () => void;
  onRemoveQueueItem?: (index: number) => void;
  onForceSendSingle?: (msgId: string, content: string, targetId: string) => void;
}

// ============ CHAT INPUT BAR COMPONENT (ISOLATED STATE) ============
// Tách biệt hoàn toàn state ô gõ văn bản khỏi luồng re-render của ChatPanel (khi stream token)
// Đảm bảo gõ phím mượt mà 60 FPS, không lag giật, bảo toàn nhịp gõ tiếng Việt / Unikey / IME
interface ChatInputBarProps {
  loading: boolean;
  isMobile?: boolean;
  onSend: (message: string) => void;
  onStop?: () => void;
}

const ChatInputBar = React.memo(function ChatInputBar({
  loading,
  isMobile = false,
  onSend,
  onStop
}: ChatInputBarProps) {
  const [hasText, setHasText] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const isSubmittingRef = useRef<boolean>(false);

  const handleSend = useCallback((e?: React.SyntheticEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (isSubmittingRef.current) return;
    const rawVal = textareaRef.current ? textareaRef.current.value : '';
    const trimmed = rawVal.trim().normalize('NFC');
    if (!trimmed) return;
    isSubmittingRef.current = true;
    setTimeout(() => {
      isSubmittingRef.current = false;
    }, 800);

    onSend(trimmed);
    if (textareaRef.current) {
      textareaRef.current.value = '';
      textareaRef.current.style.height = 'auto';
    }
    setHasText(false);
  }, [onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Bỏ qua Enter khi đang composition IME (gõ tiếng Việt/Unikey):
    // Native isComposing, isComposingRef hoặc keyCode === 229 (IME pending)
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isComposingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopPropagation();
      handleSend(e);
    } else if (e.key === 'Escape') {
      if (e.repeat) {
        e.preventDefault();
        return;
      }
      if (loading && onStop) {
        onStop();
      }
    }
  }, [handleSend, loading, onStop]);

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
      <textarea
        ref={textareaRef}
        defaultValue=""
        onChange={(e) => {
          const currentHasText = Boolean(e.target.value.trim());
          setHasText(prev => (prev !== currentHasText ? currentHasText : prev));
        }}
        onCompositionStart={() => { isComposingRef.current = true; }}
        onCompositionEnd={() => { isComposingRef.current = false; }}
        onKeyDown={handleKeyDown}
        placeholder={loading ? "Type to queue next message... (Enter to send)" : "Type your message or instructions... (Enter to send, Shift+Enter for newline)"}
        style={{
          flex: 1,
          background: 'var(--bg-input)',
          color: 'var(--text-primary)',
          border: '1px solid var(--af-border-strong)',
          borderRadius: 'var(--radius-lg)',
          padding: '12px 16px',
          fontSize: isMobile ? 16 : 13,
          lineHeight: 1.5,
          resize: 'none',
          minHeight: 44,
          maxHeight: 140,
          fontFamily: 'inherit',
          outline: 'none',
          transition: 'border-color 0.2s, box-shadow 0.2s'
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent)';
          e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--af-border-strong)';
          e.currentTarget.style.boxShadow = 'none';
        }}
        rows={1}
      />

      <button
        onClick={handleSend}
        disabled={!hasText}
        title={loading ? 'Queue' : 'Send'}
        style={{
          background: hasText ? 'linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)' : 'var(--bg-input)',
          color: hasText ? 'var(--text-primary)' : 'var(--text-muted)',
          border: hasText ? 'none' : '1px solid var(--af-border-strong)',
          borderRadius: 'var(--radius-md)',
          width: 44,
          padding: 0,
          fontSize: 20,
          cursor: hasText ? 'pointer' : 'not-allowed',
          fontWeight: 700,
          height: 44,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: hasText ? '0 2px 10px rgba(37, 99, 235, 0.3)' : 'none',
          transition: 'all 0.2s'
        }}
        onMouseOver={(e) => {
          if (hasText) e.currentTarget.style.transform = 'scale(1.04)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
        }}
      >
        <span>↑</span>
      </button>

      {loading && (
        <button
          onClick={onStop}
          title="Stop agent (Esc)"
          style={{
            background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
            color: 'white',
            border: 'none',
            borderRadius: 12,
            padding: '12px 16px',
            fontSize: 13,
            cursor: 'pointer',
            fontWeight: 600,
            height: 44,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: '0 2px 10px rgba(239, 68, 68, 0.3)'
          }}
        >
          <span>⏹</span>
          {!isMobile && <span>Stop</span>}
        </button>
      )}
    </div>
  );
});

export function ChatPanel({
  messages,
  onSend,
  onStop,
  onClear,
  loading,
  title,
  selectedAgentId,
  tokenUsage,
  contextLength,
  cost,
  model,
  status,
  formatMessage,
  allMessages,
  agents = [],
  isMobile = false,
  queuedMessages = [],
  onFlushQueue,
  onClearQueue,
  onRemoveQueueItem,
  onForceSendSingle,
  connStatus,
  offlineForText,
  uptimeText,
  showToolBlocks = true,
  defaultExpandToolcalls = false
}: Props) {
  const [collapsedReports, setCollapsedReports] = useState<Record<string, boolean>>({});
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const initialLoadRef = useRef(true);
  // Fix B: Lưu vị trí scroll trước khi re-render → restore sau nếu user KHÔNG ở gần đáy
  const scrollPosRef = useRef(0);
  const AUTO_SCROLL_THRESHOLD = 150;

  // ============ VIRTUALIZED TAIL WINDOW ============
  // Chỉ render N tin nhắn MỚI NHẤT khi vào hội thoại → load nhanh (<150ms) kể cả history dài.
  // Giới hạn 100 tin nhắn gần nhất để giữ DOM cực nhẹ, hạ nhiệt RAM Client dưới 80MB.
  const INITIAL_VISIBLE_COUNT = 100;
  const LOAD_OLDER_STEP = 50;
  const TOP_LOAD_TRIGGER_PX = 80;
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const prependAnchorRef = useRef<number | null>(null);
  const loadingOlderRef = useRef(false);

  const tu = typeof tokenUsage === 'object' ? (tokenUsage as TokenUsageDetail) : null;
  const rawTokens = contextLength || tu?.totalTokens || tu?.total || (typeof tokenUsage === 'number' ? tokenUsage : undefined);
  const effectiveCost = cost || tu?.cost;
  const formattedTokens = formatTokens(rawTokens);
  const formattedCost = formatCost(effectiveCost);

  // Build detailed tooltip
  const tooltipParts: string[] = [];
  if (rawTokens) tooltipParts.push(`Total: ${rawTokens.toLocaleString()} tokens`);
  if (tu?.inputTokens || tu?.input) tooltipParts.push(`Input: ${(tu.inputTokens || tu.input)?.toLocaleString()}`);
  if (tu?.outputTokens || tu?.output) tooltipParts.push(`Output: ${(tu.outputTokens || tu.output)?.toLocaleString()}`);
  if (tu?.reasoningTokens) tooltipParts.push(`Reasoning: ${tu.reasoningTokens.toLocaleString()}`);
  if (tu?.cacheReadTokens) tooltipParts.push(`Cache Read: ${tu.cacheReadTokens.toLocaleString()}`);
  if (tu?.cacheWriteTokens) tooltipParts.push(`Cache Write: ${tu.cacheWriteTokens.toLocaleString()}`);
  if (effectiveCost) tooltipParts.push(`Cost: $${effectiveCost.toFixed(4)}`);
  const tooltipText = tooltipParts.length > 0 ? tooltipParts.join(' | ') : `Context: ${rawTokens?.toLocaleString() || 0} tokens`;

  const rawDisplay: any[] = allMessages && allMessages.length >= 0 ? allMessages as any[] : messages as any[];
  const displayMessages = useMemo(() => {
    // Khử trùng lặp triệt để theo ID hoặc content+from+time gần nhau trước khi sắp xếp hiển thị
    const deduped: any[] = [];
    const seenIds = new Set<string>();

    for (const m of rawDisplay) {
      if (!m) continue;
      const mId = m.id ? String(m.id) : '';
      if (mId && seenIds.has(mId)) continue;

      const cleanCur = (m.content || '').trim().toLowerCase().normalize('NFC').replace(/[\r\n\s]+/g, ' ');
      const mTime = Number(m.timestamp) || 0;

      // 1. Tránh lặp tin nhắn user (optimistic temp-id vs server canonical id, hoặc lệch to: orchestrator vs UUID)
      if (m.from === 'user') {
        const isContentDup = deduped.some(prev => {
          if (prev.from !== 'user') return false;
          const cleanPrev = (prev.content || '').trim().toLowerCase().normalize('NFC').replace(/[\r\n\s]+/g, ' ');
          if (!cleanCur || !cleanPrev || cleanCur !== cleanPrev) return false;
          // Nếu cả 2 tin nhắn đều có timestamp và cách nhau > 5 phút thì coi là 2 lần nhập khác nhau
          const prevTime = Number(prev.timestamp) || 0;
          if (mTime && prevTime && Math.abs(prevTime - mTime) > 300000) return false;
          return true;
        });
        if (isContentDup) continue;
      }

      // 2. Tránh lặp tin nhắn Agent / Orchestrator (bị triple hoặc đúp giữa stream bubble và canonical message)
      if (m.from && m.from !== 'user') {
        const isAgentDup = deduped.some(prev => {
          if (prev.from !== m.from) return false;
          // Không so sánh tin nhắn quá rỗng
          if (!cleanCur || cleanCur.length < 5) return false;
          const cleanPrev = (prev.content || '').trim().normalize('NFC').replace(/\s+/g, ' ');
          if (cleanPrev === cleanCur && Math.abs((Number(prev.timestamp) || 0) - mTime) < 15000) {
            return true;
          }
          // Khớp cả trường hợp 1 bên là tin stream đang mở và 1 bên là tin chốt
          const isOneStreaming = prev.isStreaming || m.isStreaming;
          if (isOneStreaming && Math.abs((Number(prev.timestamp) || 0) - mTime) < 30000) {
            if (cleanPrev.startsWith(cleanCur.substring(0, 50)) || cleanCur.startsWith(cleanPrev.substring(0, 50))) {
              return true;
            }
          }
          return false;
        });
        if (isAgentDup) continue;
      }

      if (mId) seenIds.add(mId);
      deduped.push(m);
    }

    return deduped.sort((a, b) => {
      const tA = Number(a.timestamp) || 0;
      const tB = Number(b.timestamp) || 0;
      return tA - tB;
    });
  }, [rawDisplay]);

  // Tail-window slice: chỉ lấy visibleCount tin nhắn cuối cùng
  const totalLen = displayMessages.length;
  const sliceStart = Math.max(0, totalLen - visibleCount);
  const visibleMessages = totalLen > sliceStart ? displayMessages.slice(sliceStart) : displayMessages;
  const hiddenOlderCount = sliceStart;

  const loadOlder = useCallback(() => {
    if (loadingOlderRef.current) return;
    const el = scrollRef.current;
    if (el) prependAnchorRef.current = el.scrollHeight;
    loadingOlderRef.current = true;
    setVisibleCount(c => c + LOAD_OLDER_STEP);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    isNearBottomRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD;
    setShowScrollBtn(distanceFromBottom > AUTO_SCROLL_THRESHOLD);
    // Tự động nạp tin nhắn cũ khi người dùng cuộn sát lên đỉnh
    if (scrollTop <= TOP_LOAD_TRIGGER_PX && totalLen > visibleCount) {
      loadOlder();
    }
  }, [totalLen, visibleCount, loadOlder]);

  // Reset cửa sổ hiển thị khi chuyển agent/hội thoại khác
  useEffect(() => {
    initialLoadRef.current = true;
    setVisibleCount(INITIAL_VISIBLE_COUNT);
    loadingOlderRef.current = false;
    prependAnchorRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  // Sticky scroll: CHỈ auto-scroll xuống đáy khi user đang Ở GẦN ĐÁY (trong AUTO_SCROLL_THRESHOLD).
  // Dùng "signature" của tin cuối (length + id + content length) — ổn định khi App re-render vô cớ
  // (SSE tick/status), nhưng đổi khi CÓ tin mới HOẶC streaming content → không bỏ lỡ theo dõi streaming.
  const lastMsg =
    displayMessages.length > 0 ? (displayMessages[displayMessages.length - 1] as any) : undefined;
  const lastMsgSig = lastMsg
    ? `${displayMessages.length}:${String(lastMsg?.id ?? '')}:${String(lastMsg?.content ?? '').length}`
    : '';
  const prevSigRef = useRef(lastMsgSig);

  // Khi có thay đổi tin nhắn thật (thêm mới / streaming): nếu user ở gần đáy → kéo xuống theo,
  // ngược lại (user đang đọc tin cũ) GIỮ NGUYÊN vị trí.
  useEffect(() => {
    const sig = lastMsgSig;
    const changed = sig !== prevSigRef.current;
    prevSigRef.current = sig;

    if (displayMessages.length === 0) {
      // Không có tin → chờ tin tiếp, đánh dấu để scroll đáy ở lần tin đầu của phiên
      initialLoadRef.current = true;
      return;
    }

    const el = scrollRef.current;
    if (!el) return;

    if (changed && isNearBottomRef.current) {
      // Mobile: KHÔNG auto-scroll smooth khi đang gõ (bàn phím mở làm layout viewport đổi → giật).
      // Giữ vị trí typing ổn định; user vẫn kéo tay hoặc dùng nút ↓ (showScrollBtn) khi cần.
      const activeEl = document.activeElement as HTMLElement | null;
      const typingOnMobile = isMobile && activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT');
      if (typingOnMobile) {
        setShowScrollBtn(true); // có tin mới mà đang gõ → nhá nút ↓ để user tự kéo khi xong
      } else {
        el.scrollTo({ top: el.scrollHeight, behavior: isMobile ? 'auto' : 'smooth' });
        setShowScrollBtn(false);
      }
    }
  }, [lastMsgSig, displayMessages.length, isMobile]);

  // Fix B: Lưu vị trí scroll trước khi App.tsx setAllMessages() re-render,
  // restore sau nếu user không ở gần đáy (tránh nhảy đầu khi tab quay lại/fetchHistory).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Chỉ save khi đang ở xa đáy; nếu ở gần đáy thì auto-scroll là mong muốn.
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > AUTO_SCROLL_THRESHOLD) {
      scrollPosRef.current = el.scrollTop;
    } else {
      scrollPosRef.current = 0;
    }
  }, [allMessages]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = scrollPosRef.current;
    if (saved > 0 && !isNearBottomRef.current) {
      el.scrollTop = saved;
      scrollPosRef.current = 0;
    }
  }, [displayMessages]);

  // Lần mount đầu tiên (hoặc phiên mới sau khi display rỗng) → scroll đáy một lần, không smooth giật.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (initialLoadRef.current && displayMessages.length > 0) {
      el.scrollTop = el.scrollHeight;
      initialLoadRef.current = false;
      isNearBottomRef.current = true;
      setShowScrollBtn(false);
    }
  }, [displayMessages.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distanceFromBottom > AUTO_SCROLL_THRESHOLD);
  }, [lastMsgSig, visibleCount]);

  // Sau khi prepend tin nhắn cũ (load more), giữ nguyên vị trí cuộn của người dùng
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && prependAnchorRef.current !== null) {
      el.scrollTop = Math.max(0, el.scrollHeight - prependAnchorRef.current);
      prependAnchorRef.current = null;
    }
    loadingOlderRef.current = false;
  }, [visibleCount, totalLen]);

  const toggleReport = useCallback((msgId: string) => {
    setCollapsedReports(prev => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  }, []);

  return (
    <div className="af-chatpanel" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-main)' }}>
      {/* Header: fixed 48px, nowrap, overflow-x auto, compact badges */}
      <div className="af-chat-header" style={{
        padding: isMobile ? '8px 12px 8px 56px' : '8px 16px',
        borderBottom: '1px solid var(--af-border)',
        background: 'var(--bg-panel)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'nowrap',
        height: 48,
        minHeight: 48,
        boxSizing: 'border-box',
        gap: 8,
        boxShadow: 'var(--shadow-panel)',
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'none'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexShrink: 1 }}>
          <div style={{
            width: 30,
            height: 30,
            borderRadius: 7,
            background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 15,
            boxShadow: '0 2px 6px rgba(79, 70, 229, 0.3)',
            flexShrink: 0
          }}>
            💬
          </div>
          <div style={{ minWidth: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
              <span className="af-chat-title" style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: 'var(--text-primary)',
                letterSpacing: '-0.01em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {title || 'Orchestrator'}
              </span>

              {/* Status Badge */}
              {status && (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '1px 7px',
                  borderRadius: 9999,
                  background: status === 'working' ? 'rgba(34, 197, 94, 0.15)' : status === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(100, 116, 139, 0.15)',
                  border: `1px solid ${status === 'working' ? 'rgba(34, 197, 94, 0.35)' : status === 'error' ? 'rgba(239, 68, 68, 0.35)' : 'rgba(100, 116, 139, 0.25)'}`,
                  fontSize: 10,
                  fontWeight: 600,
                  color: status === 'working' ? '#4ade80' : status === 'error' ? '#f87171' : '#94a3b8',
                  flexShrink: 0,
                  whiteSpace: 'nowrap'
                }}>
                  <span
                    className={status === 'working' ? 'pulsing-green' : status === 'error' ? 'pulsing-red' : ''}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: status === 'working' ? '#22c55e' : status === 'error' ? '#ef4444' : '#64748b'
                    }}
                  />
                  <span>{status}</span>
                </div>
              )}

              {/* Model Tag */}
              {model && (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '1px 7px',
                  borderRadius: 9999,
                  background: 'rgba(99, 102, 241, 0.12)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  color: '#a5b4fc',
                  fontSize: 10,
                  fontWeight: 500,
                  fontFamily: 'monospace',
                  flexShrink: 0,
                  whiteSpace: 'nowrap'
                }}>
                  <span>🧠</span>
                  <span>{model}</span>
                </div>
              )}

              {/* Token Usage / Context Length Badge */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '1px 7px',
                  borderRadius: 9999,
                  background: 'rgba(56, 189, 248, 0.12)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  color: '#38bdf8',
                  fontSize: 10,
                  fontWeight: 600,
                  fontFamily: 'monospace',
                  flexShrink: 0,
                  whiteSpace: 'nowrap'
                }}
                title={tooltipText}
              >
                <span>⚡</span>
                <span>{formattedTokens} tokens{formattedCost ? ` | ${formattedCost}` : ''}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right side controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Connection Status Badge (WS) */}
          {connStatus && (
            <div
              className={connStatus === 'disconnected' ? 'af-conn-badge-off' : undefined}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 9999,
                background: connStatus === 'connected' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.15)',
                border: `1px solid ${connStatus === 'connected' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.45)'}`,
                fontSize: 10.5,
                fontWeight: 600,
                color: connStatus === 'connected' ? '#4ade80' : '#f87171',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}
            >
              <span
                className={connStatus === 'connected' ? 'pulsing-green' : 'pulsing-red'}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: connStatus === 'connected' ? '#22c55e' : '#ef4444',
                  display: 'inline-block'
                }}
              />
              <span>
                {connStatus === 'connected'
                  ? `Live WS${uptimeText ? ` (${uptimeText})` : ''}`
                  : `Offline${offlineForText ? ` (${offlineForText} trước)` : ''}`}
              </span>
            </div>
          )}

          {onClear && (
            <button
              onClick={() => {
                if (window.confirm('Bạn có chắc muốn xóa toàn bộ cuộc trò chuyện?')) {
                  onClear();
                }
              }}
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 11.5,
                cursor: 'pointer',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.25)';
              }}
            >
              <span>🗑️</span>
              <span>Clear Chat</span>
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="af-chat-scroll" style={{ flex: 1, overflow: 'auto', minWidth: 0, padding: isMobile ? '8px 6px' : '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, userSelect: 'none' }}>
        {displayMessages.length === 0 ? (
          <div style={{
            textAlign: 'center',
            color: 'var(--text-muted)',
            margin: 'auto',
            padding: 32,
            maxWidth: 420
          }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              border: '1px solid #334155',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 32,
              margin: '0 auto 16px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
            }}>
              🤖
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>AgentForge Workspace</div>
            <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)' }}>
              Spawn your autonomous worker agents, coordinate workflows, and command the swarm.
            </div>
          </div>
        ) : (
          <>
            {hiddenOlderCount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '0 0 12px' }}>
                <button
                  onClick={loadOlder}
                  style={{
                    background: 'rgba(30, 41, 59, 0.8)',
                    color: '#93c5fd',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    borderRadius: 9999,
                    padding: '6px 16px',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  ⬆ Tải thêm tin cũ ({hiddenOlderCount} tin nhắn còn lại)
                </button>
              </div>
            )}
            {(() => {
              // BỘ LỌC DEDUP RENDER CUỐI CÙNG (FINAL RENDER PASS DEDUP):
              const deduplicatedMessages = visibleMessages.filter((msg: any, idx: number) => {
                const cleanCur = typeof msg.content === 'string' ? msg.content.trim().toLowerCase().normalize('NFC').replace(/[\r\n\s]+/g, ' ') : '';
                const curTime = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;

                const isUserMsg = msg.from === 'user' || msg.role === 'user';
                const isSystemMsg = msg.from === 'system';
                const isWrapper = msg.msgType === 'opencode' && msg.content;

                // 1. Dedup user/system toàn mảng (không chỉ adjacent)
                if (isUserMsg || isSystemMsg) {
                  const hasDup = visibleMessages.some((prev: any, pIdx: number) => {
                    if (pIdx >= idx) return false;
                    if (prev.from !== msg.from) return false;
                    const cleanPrev = typeof prev.content === 'string' ? prev.content.trim().toLowerCase().normalize('NFC').replace(/[\r\n\s]+/g, ' ') : '';
                    if (!cleanCur || !cleanPrev || cleanCur !== cleanPrev) return false;
                    const prevTime = prev.timestamp ? new Date(prev.timestamp).getTime() : 0;
                    if (curTime && prevTime && Math.abs(curTime - prevTime) > 300000) return false;
                    return true;
                  });
                  if (hasDup) return false;
                }

                // 2. Wrapper + next report merge
                if (isWrapper) {
                  const next = visibleMessages[idx + 1];
                  if (next) {
                    const sameAgent = !!msg.agentId && msg.agentId === next.agentId;
                    const nextIsReport = !!next.content && (next.content.includes('=== TASK REPORT ===') || next.content.includes('=== ERROR REPORT ===') || next.content.includes('=== AGENT MESSAGE ==='));
                    if (sameAgent && nextIsReport) return false;
                  }
                }

                return true;
              });
              return deduplicatedMessages.map((msg: any) => (
                <MessageItem
                  key={msg.id}
                  msg={msg}
                  agents={agents}
                  isCollapsed={!!collapsedReports[msg.id]}
                  onToggleReport={toggleReport}
                  isMobile={isMobile}
                  showToolBlocks={showToolBlocks}
                  defaultExpandToolcalls={defaultExpandToolcalls}
                  selectedAgentId={selectedAgentId}
                  queuedMessages={queuedMessages}
                  onForceSendSingle={onForceSendSingle}
                  allMessagesList={displayMessages}
                />
              ));
            })()}
          </>
        )}

        {loading && (
          <div className="fade-in" style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            color: '#93c5fd',
            fontSize: 12,
            marginTop: 4,
            padding: '8px 16px',
            background: 'rgba(30, 41, 59, 0.8)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: 9999,
            width: 'fit-content',
            boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
            backdropFilter: 'blur(8px)'
          }}>
            <span className="spin-icon">⏳</span>
            <span style={{ fontWeight: 500 }}>Agent is thinking and processing...</span>
          </div>
        )}

        {/* Floating scroll-to-bottom button */}
        {showScrollBtn && (
          <button
            onClick={() => {
              scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
              isNearBottomRef.current = true;
              setShowScrollBtn(false);
            }}
            style={{
              position: 'absolute',
              bottom: '90px',
              right: '24px',
              zIndex: 10,
              borderRadius: '50%',
              width: 36,
              height: 36,
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              lineHeight: 1
            }}
            title="Cuộn xuống cuối"
          >
            ↓
          </button>
        )}

        <div ref={bottomRef} style={{ height: 24, flexShrink: 0 }} />
      </div>

      {/* Input & Queue Bubble */}
      <div className="af-chat-input" style={{
        padding: isMobile ? '8px 10px' : '12px 18px',
        paddingBottom: isMobile ? 'calc(8px + env(safe-area-inset-bottom))' : 12,
        borderTop: '1px solid var(--af-border)',
        background: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        position: 'relative'
      }}>
        {/* Floating Queue Bubble docked directly above the typing box */}
        {queuedMessages.length > 0 && (
          <div style={{
            background: 'var(--bg-inset, #121824)',
            border: '1px solid rgba(59, 130, 246, 0.35)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            boxShadow: '0 4px 18px rgba(0, 0, 0, 0.3)',
            animation: 'fadeIn 0.2s ease-in-out'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13 }}>📨</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--wb-info, #38bdf8)' }}>
                  Hàng đợi tin nhắn ({queuedMessages.length})
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {onFlushQueue && (
                  <button
                    onClick={onFlushQueue}
                    style={{
                      background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25) 0%, rgba(59, 130, 246, 0.25) 100%)',
                      border: '1px solid rgba(245, 158, 11, 0.5)',
                      color: '#fef3c7',
                      borderRadius: 4,
                      padding: '2px 8px',
                      fontSize: 10.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 2px 6px rgba(245, 158, 11, 0.2)'
                    }}
                    title="Ngắt lượt cũ và gộp gửi toàn bộ tin nhắn trong hàng đợi ngay lập tức"
                  >
                    ⚡ Gửi ngay toàn bộ (Ngắt lượt cũ)
                  </button>
                )}
                {onClearQueue && (
                  <button
                    onClick={onClearQueue}
                    style={{
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                      color: '#f87171',
                      borderRadius: 4,
                      padding: '2px 8px',
                      fontSize: 10.5,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                    title="Xóa toàn bộ hàng đợi"
                  >
                    🗑️ Xóa hết
                  </button>
                )}
              </div>
            </div>

            {/* List of queued items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
              {queuedMessages.map((q, i) => {
                const tgtAgent = agents.find(a => a.id === q.to);
                const tgtName = q.to === 'orchestrator' || !q.to ? 'Orchestrator' : (tgtAgent ? tgtAgent.name : q.to);
                return (
                  <div key={`${q.id}-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 11, background: 'rgba(255, 255, 255, 0.03)', padding: '3px 6px', borderRadius: 4, border: '1px solid var(--af-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: 'rgba(99, 102, 241, 0.18)',
                        border: '1px solid rgba(129, 140, 248, 0.4)',
                        color: '#c7d2fe',
                        fontSize: 10,
                        fontWeight: 700,
                        flexShrink: 0
                      }}>
                        Gửi tới: {q.to === 'orchestrator' || !q.to ? '👑' : '🤖'} {tgtName}
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', flex: 1 }}>
                        {q.content.slice(0, 100)}
                      </span>
                    </div>
                    {onForceSendSingle && (
                      <button
                        onClick={() => onForceSendSingle(q.id, q.content, q.to || selectedAgentId || 'orchestrator')}
                        style={{
                          background: 'rgba(245, 158, 11, 0.2)',
                          border: '1px solid rgba(245, 158, 11, 0.45)',
                          color: '#fbbf24',
                          borderRadius: 4,
                          padding: '1px 6px',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: 'pointer',
                          flexShrink: 0
                        }}
                        title="Ngắt lượt hiện tại và gửi ngay tin này lập tức"
                      >
                        ⚡ Gửi ngay
                      </button>
                    )}
                    {onRemoveQueueItem && (
                      <button
                        onClick={() => onRemoveQueueItem(i)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--wb-danger, #f87171)',
                          cursor: 'pointer',
                          padding: '1px 4px',
                          fontSize: 10.5,
                          fontWeight: 700,
                          flexShrink: 0
                        }}
                        title="Xóa tin này khỏi hàng đợi"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <ChatInputBar
          loading={loading}
          isMobile={isMobile}
          onSend={onSend}
          onStop={onStop}
        />
      </div>
    </div>
  );
}
