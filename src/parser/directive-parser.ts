/**
 * Pure Directive & Command Parser for AgentForge
 * Pure parsing logic (zero side-effects, zero network/db I/O).
 * Handles Dual-Syntax scanning (Bracket [TAG] & XML <tag>), command extraction, and sanitization.
 */

export interface BracketCommand {
  tag: string;           // Tên thẻ: 'TALK', 'SPAWN', 'CREATE ROLE', etc.
  content?: string;      // Nội dung bên trong cặp ngoặc ngoài cùng (bracket syntax)
  attributes?: string;   // Chuỗi thuộc tính (XML syntax)
  body?: string;         // Nội dung bên trong cặp thẻ <tag>...</tag> (XML syntax)
  fullMatch: string;     // Chuỗi đầy đủ bao gồm cả cặp ngoặc [TAG ...] hoặc <tag>...</tag>
  startIndex: number;
  endIndex: number;
  syntax?: 'bracket' | 'xml';
}

export interface BracketRange {
  tag: string;
  startIndex: number;
  closeIndex: number;
  endIndex: number;
  raw: string;
  content: string;
}

export const INVALID_TARGET_PLACEHOLDERS = new Set([
  'target-id', 'agent-id', 'your-target', '<target-id>', '<agent-id>',
  'target_id', 'agent_id', 'id', 'name', 'agent-name', 'target',
  'peer-id', 'sub-orchestrator', 'other-agent', 'someone', 'nobody',
  'none', 'null', 'undefined', '<id>', '<name>', 'all', 'everyone',
  'agent'
]);

export function cleanTargetIdentifier(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  s = stripQuotes(s);
  s = s.replace(/^<+|>+$/g, '').trim();
  s = s.replace(/^@+/, '').trim();
  return s;
}

export function stripQuotes(v: string): string {
  if (!v) return '';
  let t = v.trim();
  if (t.length >= 2 &&
      ((t.startsWith('"') && t.endsWith('"')) ||
       (t.startsWith("'") && t.endsWith("'")) ||
       (t.startsWith('“') && t.endsWith('”')) ||
       (t.startsWith('‘') && t.endsWith('’')))) {
    return t.substring(1, t.length - 1).trim();
  }
  if (t.startsWith('"') || t.startsWith("'") || t.startsWith('“') || t.startsWith('‘')) {
    const startChar = t[0];
    const closingQuote = startChar === '“' ? '”' : (startChar === '‘' ? '’' : startChar);
    const lastQuote = t.lastIndexOf(closingQuote);
    if (lastQuote > 0) return t.substring(1, lastQuote).trim();
    return t.substring(1).trim();
  }
  if (t.endsWith(']')) {
    t = t.substring(0, t.length - 1).trim();
  }
  return t;
}

export function getCodeFenceRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  if (!text) return ranges;
  let i = 0;
  const len = text.length;
  while (i < len) {
    // 1. Check backticks: ` or `` or ```+
    if (text[i] === '`') {
      let runLen = 0;
      while (i + runLen < len && text[i + runLen] === '`') {
        runLen++;
      }
      const fenceMarker = '`'.repeat(runLen);
      if (runLen >= 3) {
        // Multi-line code fence: ``` or ````
        const end = text.indexOf(fenceMarker, i + runLen);
        if (end !== -1) {
          ranges.push([i, end + runLen]);
          i = end + runLen;
          continue;
        } else {
          // Unclosed fence extends to end of buffer
          ranges.push([i, len]);
          break;
        }
      } else {
        // Inline code: `...` or ``...``
        let searchPos = i + runLen;
        let foundEnd = -1;
        while (searchPos < len) {
          const nextMatch = text.indexOf(fenceMarker, searchPos);
          if (nextMatch === -1) break;
          const beforeOk = nextMatch === 0 || text[nextMatch - 1] !== '`';
          const afterOk = nextMatch + runLen >= len || text[nextMatch + runLen] !== '`';
          if (beforeOk && afterOk) {
            foundEnd = nextMatch + runLen;
            break;
          }
          searchPos = nextMatch + 1;
        }
        if (foundEnd !== -1) {
          ranges.push([i, foundEnd]);
          i = foundEnd;
          continue;
        }
      }
      i += runLen;
      continue;
    }

    // 2. Check tildes: ~~~+
    if (text.startsWith('~~~', i)) {
      let runLen = 0;
      while (i + runLen < len && text[i + runLen] === '~') {
        runLen++;
      }
      const fenceMarker = '~'.repeat(runLen);
      const end = text.indexOf(fenceMarker, i + runLen);
      if (end !== -1) {
        ranges.push([i, end + runLen]);
        i = end + runLen;
        continue;
      } else {
        ranges.push([i, len]);
        break;
      }
    }

    i++;
  }
  return ranges;
}

export function maskCodeSpans(text: string, ranges?: Array<[number, number]>): string {
  if (!text) return '';
  const codeRanges = ranges || getCodeSpanRanges(text);
  if (codeRanges.length === 0) return text;
  
  const chars = text.split('');
  for (const [start, end] of codeRanges) {
    const s = Math.max(0, start);
    const e = Math.min(chars.length, end);
    for (let j = s; j < e; j++) {
      if (chars[j] !== '\n') {
        chars[j] = ' ';
      }
    }
  }
  return chars.join('');
}

export function getCodeSpanRanges(text: string): Array<[number, number]> {
  const ranges = getCodeFenceRanges(text);
  const reportStartRe = /(?:===\s*(?:TASK|RESEARCH|VERIFICATION|ERROR)\s+REPORT\s*===|<\s*(?:report|task_report|task-report|error_report|error-report)\b[^>]*>)/gi;
  const reportEndRe = /(?:===\s*END[^=\n]*REPORT\s*===|<\/\s*(?:report|task_report|task-report|error_report|error-report)\s*>)/gi;
  let rm: RegExpExecArray | null;
  while ((rm = reportStartRe.exec(text)) !== null) {
    const startIdx = rm.index;
    reportEndRe.lastIndex = startIdx + rm[0].length;
    const em = reportEndRe.exec(text);
    if (em) {
      ranges.push([startIdx, em.index + em[0].length] as [number, number]);
    }
  }
  let scan = 0;
  while (scan < text.length) {
    const talkIdx = text.indexOf('[TALK', scan);
    const spawnIdx = text.indexOf('[SPAWN', scan);
    const nextTag = Math.min(
      talkIdx === -1 ? Infinity : talkIdx,
      spawnIdx === -1 ? Infinity : spawnIdx
    );
    if (nextTag === Infinity) break;
    const cmd = findBalancedBracketRange(text, nextTag);
    if (!cmd) { scan = nextTag + 1; continue; }
    const attrMatch = cmd.content.match(/\b(?:message|msg|content)\s*=\s*(?:"|'|“)([\s\S]*?)(?:"|'|”)/);
    if (attrMatch && attrMatch[1] !== undefined) {
      const valOffset = cmd.raw.indexOf(attrMatch[0]);
      if (valOffset !== -1) {
        const payloadStart = cmd.startIndex + valOffset + attrMatch[0].indexOf(attrMatch[1]);
        const payloadEnd = payloadStart + attrMatch[1].length;
        ranges.push([payloadStart, payloadEnd] as [number, number]);
      }
    }
    scan = cmd.endIndex;
  }
  return ranges;
}

export function isInCodeSpan(idx: number, ranges: Array<[number, number]>): boolean {
  for (const [start, end] of ranges) {
    if (idx >= start && idx < end) return true;
  }
  return false;
}

export function findBalancedBracketRange(text: string, startIndex: number): BracketRange | null {
  if (text[startIndex] !== '[') return null;
  const tagMatch = text.substring(startIndex).match(/^\[([A-Z][A-Z0-9_ -]*?)(?:\s|\]|=)/);
  if (!tagMatch) return null;
  const tag = tagMatch[1].trim();

  let depth = 0;
  let inDoubleQuote = false;
  let inSingleQuote = false;
  let inCurlyQuote = false;
  let inCodeSpan = false;
  let closeIndex = -1;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];
    const prevChar = i > startIndex ? text[i - 1] : '';

    if (char === '`' && !inDoubleQuote && !inSingleQuote && !inCurlyQuote) {
      inCodeSpan = !inCodeSpan;
      continue;
    }
    if (inCodeSpan) continue;

    if (char === '"' && prevChar !== '\\' && !inSingleQuote && !inCurlyQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (char === "'" && prevChar !== '\\' && !inDoubleQuote && !inCurlyQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if ((char === '“' || char === '”') && !inDoubleQuote && !inSingleQuote) {
      inCurlyQuote = !inCurlyQuote;
      continue;
    }

    if (!inDoubleQuote && !inSingleQuote && !inCurlyQuote) {
      if (char === '[') {
        depth++;
      } else if (char === ']') {
        depth--;
        if (depth === 0) {
          closeIndex = i;
          break;
        }
      }
    }
  }

  if (closeIndex === -1) {
    const nextTagIdx = text.substring(startIndex + 1).search(/\[[A-Z][A-Z0-9_ -]*?\s/);
    if (nextTagIdx !== -1) {
      closeIndex = startIndex + 1 + nextTagIdx;
    } else {
      closeIndex = text.length;
    }
  }

  const raw = text.substring(startIndex, closeIndex + 1);
  const content = text.substring(startIndex + 1, closeIndex);
  return {
    tag,
    startIndex,
    closeIndex,
    endIndex: closeIndex + 1,
    raw,
    content
  };
}

export function extractBracketCommand(text: string, startIndex: number): { tag: string; content: string; fullMatch: string; startIndex: number; endIndex: number } | null {
  const match = findBalancedBracketRange(text, startIndex);
  if (!match) return null;
  return {
    tag: match.tag,
    content: match.content,
    fullMatch: match.raw,
    startIndex: match.startIndex,
    endIndex: match.endIndex
  };
}

export function extractXmlCommand(text: string, startIndex: number, targetTag: string): BracketCommand | null {
  const normTag = targetTag.toLowerCase().replace(/[\s_-]+/g, '[-_\\s]?');
  const openPattern = new RegExp(`^<(${normTag})(?:\\s+(?:[^>"']|"[^"]*"|'[^']*')*)?(?:>|\\/>)`, 'i');
  const match = text.substring(startIndex).match(openPattern);
  if (!match) return null;

  const openTag = match[0];
  const isSelfClosing = openTag.endsWith('/>') || openTag.endsWith('/ >');
  const tagUpper = targetTag.toUpperCase().replace(/[-_]+/g, ' ');

  const rawTagMatch = openTag.match(/^<([a-zA-Z0-9_-]+)/);
  const matchedTagName = rawTagMatch ? rawTagMatch[1] : targetTag;
  const attrText = openTag.slice(matchedTagName.length + 1, isSelfClosing ? (openTag.endsWith('/ >') ? -3 : -2) : -1).trim();

  const tagLower = tagUpper.toLowerCase();
  const hasRoutingAttr = /\b(?:target|target-id|target_id|agent-id|agent_id|agent|role|name|to|id)\s*=/i.test(attrText);

  const lineStart = text.lastIndexOf('\n', startIndex) + 1;
  const linePrefix = text.substring(lineStart, startIndex).trim();
  const isInlineInProse = linePrefix.length > 0 && !/^(?:<\/[a-z0-9_-]+>|\[\/[A-Z\s]+\])$/i.test(linePrefix);
  if (isInlineInProse && isSelfClosing) {
    return null;
  }

  if (isSelfClosing) {
    if (!hasRoutingAttr && (tagLower === 'talk' || tagLower === 'spawn')) return null;
    return {
      tag: tagUpper,
      attributes: attrText,
      body: '',
      fullMatch: openTag,
      startIndex,
      endIndex: startIndex + openTag.length,
      syntax: 'xml'
    };
  }

  const closeTagPattern = new RegExp(`</${normTag}>`, 'i');
  const afterOpen = text.substring(startIndex + openTag.length);
  const closeMatch = afterOpen.match(closeTagPattern);

  if (!closeMatch && !hasRoutingAttr && !isSelfClosing) {
    return null;
  }

  if (closeMatch) {
    const body = afterOpen.substring(0, closeMatch.index);
    const closeTag = closeMatch[0];
    const fullMatch = openTag + body + closeTag;
    return {
      tag: tagUpper,
      attributes: attrText,
      body: body,
      fullMatch: fullMatch,
      startIndex,
      endIndex: startIndex + fullMatch.length,
      syntax: 'xml'
    };
  }

  let nextTagIndex = afterOpen.length;
  const nextOpenIdx = afterOpen.search(/<(?:talk|spawn|stop|resume|create_role|delete)\b/i);
  if (nextOpenIdx !== -1) {
    nextTagIndex = nextOpenIdx;
  }
  const body = afterOpen.substring(0, nextTagIndex);
  const fullMatch = openTag + body;
  return {
    tag: tagUpper,
    attributes: attrText,
    body: body,
    fullMatch: fullMatch,
    startIndex,
    endIndex: startIndex + fullMatch.length,
    syntax: 'xml'
  };
}

export function extractDualCommands(
  text: string,
  targetTags: string[] = ['TALK', 'SPAWN', 'CREATE ROLE', 'STOP', 'RESUME', 'STOP AGENT', 'RESUME AGENT', 'DELETE AGENT', 'DELETE_TASK', 'DELETE TASK', 'TASK_UPDATE', 'TASK UPDATE'],
  ignoreMarkdownDoc: boolean = false
): BracketCommand[] {
  const commands: BracketCommand[] = [];
  if (!text) return commands;

  const codeSpans = getCodeSpanRanges(text);
  let pos = 0;
  const len = text.length;

  const normTargetTags = targetTags.map(t => t.replace(/[-_]+/g, '[\\s-_]?'));
  const tagPatternStr = normTargetTags.join('|');
  const searchPattern = new RegExp(`(?:\\[(?:${tagPatternStr})\\b|<(?:${tagPatternStr})\\b)`, 'i');

  while (pos < len) {
    const sub = text.substring(pos);
    const searchMatch = sub.match(searchPattern);
    if (!searchMatch || searchMatch.index === undefined) {
      break;
    }

    const earliestIdx = pos + searchMatch.index;

    if (isInCodeSpan(earliestIdx, codeSpans)) {
      pos = earliestIdx + 1;
      continue;
    }

    if (!ignoreMarkdownDoc) {
      const lineStart = text.lastIndexOf('\n', earliestIdx) + 1;
      const linePrefix = text.substring(lineStart, earliestIdx).trim();
      const isMarkdownDocLine = /^[-*+>]\s*$/.test(linePrefix) ||
                                /^\d+\.\s*$/.test(linePrefix) ||
                                /^[-*+>]\s+`*\[*$/.test(linePrefix) ||
                                /^[-*+>]\s+<*$/.test(linePrefix);
      if (isMarkdownDocLine) {
        pos = earliestIdx + 1;
        continue;
      }
    }

    const isXml = text[earliestIdx] === '<';

    if (isXml) {
      let matchedTag = '';
      for (const t of targetTags) {
        const regex = new RegExp(`^<${t.toLowerCase().replace(/[\s_-]+/g, '[-_\\s]?')}\\b`, 'i');
        if (regex.test(text.substring(earliestIdx))) {
          matchedTag = t;
          break;
        }
      }

      if (matchedTag) {
        const cmd = extractXmlCommand(text, earliestIdx, matchedTag);
        if (cmd) {
          commands.push(cmd);
          pos = cmd.endIndex;
          continue;
        }
      }
      pos = earliestIdx + 1;
    } else {
      const parsed = extractBracketCommand(text, earliestIdx);
      if (parsed) {
        commands.push({
          tag: parsed.tag,
          content: parsed.content,
          fullMatch: parsed.fullMatch,
          startIndex: parsed.startIndex,
          endIndex: parsed.endIndex,
          syntax: 'bracket'
        });
        pos = parsed.endIndex;
      } else {
        pos = earliestIdx + 1;
      }
    }
  }

  return commands;
}

export function extractBracketCommands(
  text: string,
  targetTags: string[] = ['TALK', 'SPAWN', 'CREATE ROLE', 'STOP', 'RESUME', 'STOP AGENT', 'RESUME AGENT', 'DELETE AGENT', 'TASK_UPDATE', 'TASK UPDATE']
): BracketCommand[] {
  return extractDualCommands(text, targetTags);
}

export function stripCommandTags(text: string): string {
  if (!text) return '';
  const commands = extractDualCommands(text, ['TALK', 'SPAWN', 'CREATE ROLE', 'STOP', 'RESUME', 'STOP AGENT', 'RESUME AGENT', 'DELETE AGENT', 'TASK_UPDATE', 'TASK UPDATE'], false);
  if (commands.length === 0) return text.trim();
  let result = '';
  let lastIndex = 0;
  for (const cmd of commands) {
    result += text.substring(lastIndex, cmd.startIndex);
    lastIndex = cmd.endIndex;
  }
  result += text.substring(lastIndex);
  
  // Remove orphaned closing tags ONLY outside code spans/backticks
  const codeRanges = getCodeSpanRanges(result);
  const closingRegex = /(?:\[\/(?:TALK|SPAWN|STOP|RESUME|CREATE ROLE|STOP AGENT|RESUME AGENT|DELETE AGENT|TASK_UPDATE|TASK UPDATE)\]|<\/(?:talk|spawn|stop|stop_agent|stop-agent|resume|resume_agent|resume-agent|create_role|create-role|delete|delete_agent|delete-agent|task_update|task-update)>)/gi;
  let m: RegExpExecArray | null;
  let cleanedResult = '';
  let curIdx = 0;
  while ((m = closingRegex.exec(result)) !== null) {
    if (!isInCodeSpan(m.index, codeRanges)) {
      cleanedResult += result.substring(curIdx, m.index);
      curIdx = m.index + m[0].length;
    }
  }
  cleanedResult += result.substring(curIdx);
  return cleanedResult.trim();
}

export function sanitizeCommandInput(text: string): string {
  if (!text) return '';
  return text.normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export function parseTalkTag(tagContent: string): { agentId: string; message: string; task?: string } | null {
  const content = tagContent.trim();
  const targetMatch = content.match(/\btarget\s*=\s*([^\s\]]+)/i) ||
                      content.match(/\bto\s*=\s*([^\s\]]+)/i) ||
                      content.match(/\b(agent-[a-f0-9]+)\b/i) ||
                      content.match(/\bagentId\s*=\s*([^\s\]]+)/i) ||
                      content.match(/\b([a-z0-9_-]+)\s+message=/i) ||
                      content.match(/^([a-z0-9_-]+)\b/i);

  const rawId = targetMatch ? (targetMatch[1] || targetMatch[2]) : '';
  const agentId = cleanTargetIdentifier(rawId);

  if (!agentId || INVALID_TARGET_PLACEHOLDERS.has(agentId.toLowerCase()) || agentId === 'worker') {
    return null;
  }

  const msgIdx = content.search(/\bmessage\s*=\s*/i);
  let message = '';
  if (msgIdx !== -1) {
    const match = content.substring(msgIdx).match(/\bmessage\s*=\s*/i);
    const valStart = msgIdx + (match ? match[0].length : 8);
    message = content.substring(valStart).trim();
  } else {
    const afterTarget = content.substring(content.indexOf(rawId) + rawId.length).trim();
    message = afterTarget;
  }

  message = stripQuotes(message);

  let task: string | undefined = undefined;
  const taskIdx = content.search(/\btask\s*=\s*/i);
  if (taskIdx !== -1) {
    const match = content.substring(taskIdx).match(/\btask\s*=\s*/i);
    const valStart = taskIdx + (match ? match[0].length : 5);
    const taskEnd = content.indexOf('message=', valStart);
    const rawTask = taskEnd !== -1 ? content.substring(valStart, taskEnd).trim() : content.substring(valStart).trim();
    task = stripQuotes(rawTask);
  }

  if (message) {
    return { agentId, message, task };
  }
  return null;
}

export function parseTalkCommand(
  cmd: BracketCommand,
  resolver?: (target: string) => { id: string } | null | undefined
): { agentId: string; message: string; task?: string } | null {
  if (cmd.syntax === 'xml') {
    const attrsText = cmd.attributes || '';
    const body = (cmd.body || '').trim();

    const targetMatch = attrsText.match(/(?:agent-id|agent_id|target-id|target_id|target|agent|to|id)\s*=\s*(?:"([^"]+)"|'([^']+)'|[“]([^”]+)[”]|[‘]([^’]+)[’]|([^\s>]+))/i);
    const rawTarget = targetMatch ? (targetMatch[1] || targetMatch[2] || targetMatch[3] || targetMatch[4] || targetMatch[5]) : '';
    const cleanRaw = cleanTargetIdentifier(rawTarget);

    if (!cleanRaw || INVALID_TARGET_PLACEHOLDERS.has(cleanRaw.toLowerCase()) || cleanRaw === 'worker' || cleanRaw === 'target-id' || cleanRaw === 'agent-id') {
      return null;
    }

    const resolved = resolver ? resolver(cleanRaw) : null;
    const agentId = resolved ? resolved.id : cleanRaw;

    const taskMatch = attrsText.match(/task\s*=\s*(?:"([^"]+)"|'([^']+)'|[“]([^”]+)[”]|[‘]([^’]+)[’]|([^\s>]+))/i);
    const task = taskMatch ? stripQuotes(taskMatch[1] || taskMatch[2] || taskMatch[3] || taskMatch[4] || taskMatch[5]) : undefined;

    let message = body;
    if (!message) {
      const msgMatch = attrsText.match(/message\s*=\s*(?:"([^"]+)"|'([^']+)'|[“]([^”]+)[”]|[‘]([^’]+)[’]|([^\s>]+))/i);
      message = msgMatch ? (msgMatch[1] || msgMatch[2] || msgMatch[3] || msgMatch[4] || msgMatch[5]) : '';
    }
    message = stripQuotes(message);

    if (message) {
      return { agentId, message, task };
    }
    return null;
  }

  const content = (cmd.content || '').trim();
  const parsed = parseTalkTag(content);
  if (!parsed) return null;

  const resolved = resolver ? resolver(parsed.agentId) : null;
  if (resolved) {
    parsed.agentId = resolved.id;
  }
  return parsed;
}

export function parseSpawnCommand(
  cmd: BracketCommand
): { role: string; name: string; task: string } | null {
  const INVALID_PLACEHOLDERS = new Set(['<role>', '<name>', '<task>', 'role', 'name', 'task', '...', 'none', 'undefined', 'null', 'your-name', '<your-name>']);

  if (cmd.syntax === 'xml') {
    const attrsText = cmd.attributes || '';
    const body = (cmd.body || '').trim();

    const roleMatch = attrsText.match(/role\s*=\s*(?:"([^"]+)"|'([^']+)'|[“]([^”]+)[”]|[‘]([^’]+)[’]|([^\s>]+))/i);
    const nameMatch = attrsText.match(/name\s*=\s*(?:"([^"]+)"|'([^']+)'|[“]([^”]+)[”]|[‘]([^’]+)[’]|([^\s>]+))/i);

    let role = cleanTargetIdentifier(roleMatch ? (roleMatch[1] || roleMatch[2] || roleMatch[3] || roleMatch[4] || roleMatch[5]) : '').toLowerCase();
    let name = cleanTargetIdentifier(nameMatch ? (nameMatch[1] || nameMatch[2] || nameMatch[3] || nameMatch[4] || nameMatch[5]) : '');

    let task = body;
    if (!task) {
      const taskMatch = attrsText.match(/task\s*=\s*(?:"([^"]+)"|'([^']+)'|[“]([^”]+)[”]|[‘]([^’]+)[’]|([^\s>]+))/i);
      task = taskMatch ? (taskMatch[1] || taskMatch[2] || taskMatch[3] || taskMatch[4] || taskMatch[5]) : '';
    }
    task = stripQuotes(task).trim().normalize('NFC');

    if (role && name && task && !INVALID_PLACEHOLDERS.has(role) && !INVALID_PLACEHOLDERS.has(name.toLowerCase())) {
      return { role, name, task };
    }
    return null;
  }

  const content = (cmd.content || '').trim();
  const roleMatch = content.match(/\brole\s*=\s*(?:"([^"]+)"|'([^']+)'|[“]([^”]+)[”]|[‘]([^’]+)[’]|([^\s\]]+))/i);
  const nameMatch = content.match(/\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|[“]([^”]+)[”]|[‘]([^’]+)[’]|([^\s\]]+))/i);

  let role = cleanTargetIdentifier(roleMatch ? (roleMatch[1] || roleMatch[2] || roleMatch[3] || roleMatch[4] || roleMatch[5]) : '').toLowerCase();
  let name = cleanTargetIdentifier(nameMatch ? (nameMatch[1] || nameMatch[2] || nameMatch[3] || nameMatch[4] || nameMatch[5]) : '');

  if (!role || !name || INVALID_PLACEHOLDERS.has(role) || INVALID_PLACEHOLDERS.has(name.toLowerCase())) {
    return null;
  }

  const taskIdx = content.search(/\btask\s*=\s*/i);
  if (taskIdx !== -1) {
    const match = content.substring(taskIdx).match(/\btask\s*=\s*/i);
    const valStart = taskIdx + (match ? match[0].length : 5);
    const attrsText = content;
    let rawTask = attrsText.substring(valStart).trim();
    rawTask = stripQuotes(rawTask);
    const task = rawTask.trim().normalize('NFC');
    if (task && !INVALID_PLACEHOLDERS.has(task.toLowerCase())) {
      return { role, name, task };
    }
  }
  return null;
}

export function parseTaskUpdateCommand(
  cmd: BracketCommand
): { agent?: string; task?: string; status: 'completed' | 'working' | 'pending' | 'failed' } | null {
  const attrs = cmd.attributes || cmd.content || '';
  const agentMatch = attrs.match(/(?:agent|target|agent-id|id)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  const taskMatch = attrs.match(/(?:task|taskId|task-id|index)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  const statusMatch = attrs.match(/(?:status|state)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);

  const rawStatus = (statusMatch ? (statusMatch[1] || statusMatch[2] || statusMatch[3]) : 'completed').toLowerCase().trim();
  const validStatus = (rawStatus === 'working' || rawStatus === 'pending' || rawStatus === 'failed') ? rawStatus : 'completed';

  const agent = agentMatch ? cleanTargetIdentifier(agentMatch[1] || agentMatch[2] || agentMatch[3]) : undefined;
  const task = taskMatch ? stripQuotes(taskMatch[1] || taskMatch[2] || taskMatch[3]).trim() : undefined;

  return { agent, task, status: validStatus };
}

export function parseDeleteTaskCommand(
  cmd: BracketCommand
): { agent?: string; task: string } | null {
  const attrs = cmd.attributes || cmd.content || '';
  const agentMatch = attrs.match(/(?:agent|target|agent-id|id)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  const taskMatch = attrs.match(/(?:task|taskId|task-id|index)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);

  const task = taskMatch ? stripQuotes(taskMatch[1] || taskMatch[2] || taskMatch[3]).trim() : '';
  if (!task) return null;

  const agent = agentMatch ? cleanTargetIdentifier(agentMatch[1] || agentMatch[2] || agentMatch[3]) : undefined;
  return { agent, task };
}
