/**
 * Directive & Command Parser Service for AgentForge
 * Extracted from server.ts to maintain a clean, modular architecture.
 * Handles Dual-Syntax scanning (Bracket & XML), command extraction, and validation.
 */

import { INVALID_TARGET_PLACEHOLDERS, cleanTargetIdentifier } from './team-isolation.js';

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
      const valueStart = cmd.startIndex + cmd.raw.indexOf(attrMatch[1]);
      ranges.push([valueStart, valueStart + attrMatch[1].length] as [number, number]);
    }
    scan = cmd.endIndex;
  }
  const bqRe = /^[ \t]*>[ \t]?\S.*$/gm;
  let bm: RegExpExecArray | null;
  while ((bm = bqRe.exec(text)) !== null) {
    ranges.push([bm.index, bm.index + bm[0].length] as [number, number]);
  }
  const docListRe = /^[ \t]*(?:[-*+]|\d+\.)[ \t]+.*$/gm;
  let dlm: RegExpExecArray | null;
  while ((dlm = docListRe.exec(text)) !== null) {
    if (/<(?:talk|spawn|stop|resume|create_role|create-role|delete_agent)\b|\[(?:TALK|SPAWN|STOP|RESUME|CREATE ROLE)\b/i.test(dlm[0])) {
      ranges.push([dlm.index, dlm.index + dlm[0].length] as [number, number]);
    }
  }
  return ranges;
}

export function isInCodeSpan(idx: number, ranges: Array<[number, number]>): boolean {
  for (const [s, e] of ranges) if (idx >= s && idx < e) return true;
  return false;
}

export function findBalancedBracketRange(text: string, startIndex: number): BracketRange | null {
  if (!text || startIndex < 0 || startIndex >= text.length || text[startIndex] !== '[') return null;

  const remaining = text.substring(startIndex + 1);
  const multiMatch = remaining.match(/^(CREATE\s+ROLE|STOP\s+AGENT|RESUME\s+AGENT|DELETE\s+AGENT)\b/i);
  let tag = '';
  let tagLen = 0;
  if (multiMatch) {
    tag = multiMatch[1].toUpperCase();
    tagLen = multiMatch[1].length;
  } else {
    const singleMatch = remaining.match(/^([A-Za-z_]+)\b/);
    if (!singleMatch) return null;
    tag = singleMatch[1].toUpperCase();
    tagLen = singleMatch[1].length;
  }

  let depth = 0;
  let inQuote: string | null = null;
  let inCodeBlock = false;
  let closeIndex = -1;
  const len = text.length;

  for (let j = startIndex; j < len; j++) {
    const char = text[j];
    const prev = j > startIndex ? text[j - 1] : '';

    if (prev === '\\') continue;

    if (text.startsWith('```', j)) {
      inCodeBlock = !inCodeBlock;
      j += 2;
      continue;
    }
    if (inCodeBlock) continue;

    if (char === '"' || char === "'" || char === '`' || char === '“' || char === '”') {
      const matchQuote = char === '“' ? '”' : char;
      if (!inQuote) {
        inQuote = matchQuote;
        continue;
      } else if (inQuote === char || (inQuote === '”' && char === '”')) {
        inQuote = null;
        continue;
      }
    }
    if (inQuote) continue;

    if (char === '[') {
      depth++;
    } else if (char === ']') {
      depth--;
      if (depth === 0) {
        closeIndex = j;
        break;
      }
    }
  }

  if (closeIndex !== -1) {
    const raw = text.substring(startIndex, closeIndex + 1);
    const inner = raw.substring(1, raw.length - 1).trim();
    const content = inner.substring(tagLen).trim();

    const tagUpper = tag.toUpperCase();
    if (tagUpper === 'TALK') {
      if (!/\b(?:target|agent|agent-id|agent_id|target-id|target_id|to|id)\s*=/i.test(content)) {
        return null;
      }
    } else if (tagUpper === 'SPAWN') {
      if (!/\b(?:role|name)\s*=/i.test(content)) {
        return null;
      }
    }

    return {
      tag,
      startIndex,
      closeIndex,
      endIndex: closeIndex + 1,
      raw,
      content
    };
  }

  return null;
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
  if (tagLower === 'talk' && !hasRoutingAttr && !closeMatch) {
    return null;
  }
  if (tagLower === 'spawn' && !hasRoutingAttr && !closeMatch) {
    return null;
  }

  if (closeMatch && closeMatch.index !== undefined) {
    const bodyContent = afterOpen.substring(0, closeMatch.index);
    const fullMatched = openTag + bodyContent + closeMatch[0];
    return {
      tag: tagUpper,
      attributes: attrText,
      body: bodyContent,
      fullMatch: fullMatched,
      startIndex,
      endIndex: startIndex + fullMatched.length,
      syntax: 'xml'
    };
  }

  return {
    tag: tagUpper,
    attributes: attrText,
    body: afterOpen,
    fullMatch: text.substring(startIndex),
    startIndex,
    endIndex: text.length,
    syntax: 'xml'
  };
}

export function extractDualCommands(
  text: string,
  targetTags: string[] = ['TALK', 'SPAWN', 'CREATE ROLE', 'STOP', 'RESUME', 'STOP AGENT', 'RESUME AGENT', 'DELETE AGENT'],
  ignoreMarkdownDoc: boolean = false
): BracketCommand[] {
  const commands: BracketCommand[] = [];
  if (!text) return commands;
  const codeRanges = ignoreMarkdownDoc ? getCodeFenceRanges(text) : getCodeSpanRanges(text);

  let pos = 0;
  while (pos < text.length) {
    let earliestMatch: { type: 'bracket' | 'xml'; tag: string; searchTag: string } | null = null;
    let earliestIdx = -1;

    for (const tag of targetTags) {
      let searchBracket = pos;
      while (true) {
        const idx = text.indexOf(`[${tag}`, searchBracket);
        if (idx === -1) break;
        const nextChar = text[idx + 1 + tag.length];
        const boundaryOk = !nextChar || /\s|:|\]|=/.test(nextChar);
        if (boundaryOk && !isInCodeSpan(idx, codeRanges)) {
          if (earliestIdx === -1 || idx < earliestIdx) {
            earliestIdx = idx;
            earliestMatch = { type: 'bracket', tag, searchTag: tag };
          }
          break;
        }
        searchBracket = idx + 1;
      }

      let searchXml = pos;
      const tagLower = tag.toLowerCase().replace(/\s+/g, '_');
      const tagLowerDash = tag.toLowerCase().replace(/\s+/g, '-');
      const xmlVariants = [tagLower];
      if (tagLowerDash !== tagLower) xmlVariants.push(tagLowerDash);

      for (const variant of xmlVariants) {
        let sXml = searchXml;
        while (true) {
          const idxLower = text.toLowerCase().indexOf(`<${variant}`, sXml);
          if (idxLower === -1) break;
          const nextChar = text[idxLower + 1 + variant.length];
          const boundaryOk = !nextChar || /\s|>|\//.test(nextChar);
          if (boundaryOk && !isInCodeSpan(idxLower, codeRanges)) {
            if (earliestIdx === -1 || idxLower < earliestIdx) {
              earliestIdx = idxLower;
              earliestMatch = { type: 'xml', tag, searchTag: variant };
            }
            break;
          }
          sXml = idxLower + 1;
        }
      }
    }

    if (!earliestMatch || earliestIdx === -1) break;

    if (earliestMatch.type === 'bracket') {
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
    } else {
      const parsed = extractXmlCommand(text, earliestIdx, earliestMatch.searchTag);
      if (parsed) {
        commands.push(parsed);
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
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/^\s*>.*$/gm, '');
}

export function parseTalkTag(tagContent: string): { agentId: string; message: string; task?: string } | null {
  if (!tagContent) return null;

  const targetMatch = tagContent.match(/(?:agent-id|agent_id|target-id|target_id|target|agent|to|id)\s*=\s*(?:"([^"]+)"|'([^']+)'|[“]([^”]+)[”]|([^\s\]]+))/i);
  const rawId = targetMatch ? (targetMatch[1] || targetMatch[2] || targetMatch[3] || targetMatch[4]) : '';
  const agentId = cleanTargetIdentifier(rawId);
  if (!agentId) return null;

  let task: string | undefined = undefined;
  const taskMarkerMatch = tagContent.match(/\btask\s*=\s*/i);
  if (taskMarkerMatch && taskMarkerMatch.index !== undefined) {
    const afterTask = tagContent.substring(taskMarkerMatch.index + taskMarkerMatch[0].length);
    const q = afterTask[0];
    if (q === '"' || q === "'" || q === '“' || q === '‘') {
      const closeQ = q === '“' ? '”' : (q === '‘' ? '’' : q);
      const endQ = afterTask.indexOf(closeQ, 1);
      if (endQ !== -1) task = afterTask.substring(1, endQ).trim();
    } else {
      const spaceIdx = afterTask.search(/\s/);
      task = (spaceIdx === -1 ? afterTask : afterTask.substring(0, spaceIdx)).trim();
    }
  }

  let message: string | undefined = undefined;
  const msgMarkerMatch = tagContent.match(/\b(?:message|msg|content)\s*=\s*/i);
  if (msgMarkerMatch && msgMarkerMatch.index !== undefined) {
    const afterMsg = tagContent.substring(msgMarkerMatch.index + msgMarkerMatch[0].length);
    const q = afterMsg[0];
    if (q === '"' || q === "'" || q === '“' || q === '‘') {
      const closeQ = q === '“' ? '”' : (q === '‘' ? '’' : q);
      const endQ = afterMsg.indexOf(closeQ, 1);
      if (endQ !== -1) message = afterMsg.substring(1, endQ).trim();
    } else {
      message = afterMsg.trim();
    }
  }

  if (!message) {
    let stripped = tagContent;
    if (targetMatch) stripped = stripped.replace(targetMatch[0], '');
    if (taskMarkerMatch && task) stripped = stripped.replace(new RegExp(`\\btask\\s*=\\s*(?:"[^"]*"|'[^']*'|\\S+)`, 'i'), '');
    message = stripped.trim();
    message = stripQuotes(message);
  }

  const finalMessage = message?.trim() || (task ? `New task: ${task}` : '');
  if (finalMessage) {
    return { agentId, message: finalMessage, ...(task ? { task: task.trim() } : {}) };
  }
  return null;
}

export function parseTalkCommand(
  cmd: BracketCommand,
  onBarrierViolation?: (reason: string, targetOrchId: string) => void,
  targetOrchId: string = 'orchestrator'
): { agentId: string; message: string; task?: string } | null {
  if (!cmd) return null;

  if (cmd.syntax === 'xml') {
    const attrText = cmd.attributes || '';
    const targetMatch = attrText.match(/(?:agent-id|agent_id|target-id|target_id|target|agent|to|id)\s*=\s*(?:"([^"]+)"|'([^']+)'|[“]([^”]+)[”]|[‘]([^’]+)[’]|([^\s>]+))/i);
    const rawTarget = targetMatch ? (targetMatch[1] || targetMatch[2] || targetMatch[3] || targetMatch[4] || targetMatch[5]) : '';
    const cleanRaw = cleanTargetIdentifier(rawTarget);
    if (!cleanRaw || INVALID_TARGET_PLACEHOLDERS.has(cleanRaw.toLowerCase())) {
      return null;
    }
    const agentId = cleanRaw;

    const taskMatch = attrText.match(/\btask\s*=\s*(?:"([^"]+)"|'([^']+)'|[“]([^”]+)[”]|[‘]([^’]+)[’]|([^\s>]+))/i);
    let task = '';
    if (taskMatch) {
      task = stripQuotes(taskMatch[1] || taskMatch[2] || taskMatch[3] || taskMatch[4] || taskMatch[5] || '');
    }

    let message = cmd.body || '';
    if (task && message) {
      const taskTagMatch = message.match(/<task>([\s\S]*?)<\/task>/i);
      if (taskTagMatch) {
        task = taskTagMatch[1].trim();
        message = message.replace(/<task>[\s\S]*?<\/task>/i, '').trim();
      }
    }
    if (!task && message) {
      const taskTagMatch2 = message.match(/<task>([\s\S]*?)<\/task>/i);
      if (taskTagMatch2) {
        task = taskTagMatch2[1].trim();
        message = message.replace(/<task>[\s\S]*?<\/task>/i, '').trim();
      }
    }
    if (!message) {
      const msgAttrMatch = attrText.match(/\b(?:message|msg|content)\s*=\s*(?:"([^"]+)"|'([^']+)'|[“]([^”]+)[”]|[‘]([^’]+)[’]|([^\s>]+))/i);
      if (msgAttrMatch) {
        message = stripQuotes(msgAttrMatch[1] || msgAttrMatch[2] || msgAttrMatch[3] || msgAttrMatch[4] || msgAttrMatch[5] || '');
      }
    }

    // Tự động strip bỏ thẻ thô <report status="..."> và </report> nếu lọt vào nội dung giao việc/báo cáo
    message = message
      .replace(/<\s*report(?:\s+[^>]*)?>/gi, '')
      .replace(/<\/\s*report\s*>/gi, '')
      .trim();

    const finalMessage = message.trim() || (task ? `New task: ${task}` : '');
    if (agentId && finalMessage) {
      if (task) {
        const words = task.trim().split(/\s+/).filter(Boolean);
        if (words.length > 30) {
          if (onBarrierViolation) {
            onBarrierViolation(
              `❌ [BARRIER REJECT] Thuộc tính task="..." vượt quá giới hạn 30 từ (${words.length} từ). Thuộc tính task chỉ được dùng làm tiêu đề ngắn (<= 30 từ). Toàn bộ hướng dẫn chi tiết phải đặt trong body thẻ!`,
              targetOrchId
            );
          }
          return null;
        }
      }
      return { agentId, message: finalMessage, ...(task ? { task: task.trim() } : {}) };
    }
    return null;
  }

  return parseTalkTag(cmd.content || '');
}

export function parseSpawnCommand(
  cmd: BracketCommand,
  onBarrierViolation?: (reason: string, targetOrchId: string) => void,
  targetOrchId: string = 'orchestrator'
): { role: string; name: string; task: string } | null {
  if (!cmd) return null;

  const INVALID_PLACEHOLDERS = new Set(['<role>', '<name>', '<task>', 'role', 'name', 'task', '...', 'none', 'undefined', 'null', 'your-name', '<your-name>']);

  if (cmd.syntax === 'xml') {
    const attrText = cmd.attributes || '';
    const roleMatch = attrText.match(/\brole\s*=\s*(?:"([^"]+)"|'([^']+)'|[“]([^”]+)[”]|([^\s>]+))/i);
    const nameMatch = attrText.match(/\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|[“]([^”]+)[”]|([^\s>]+))/i);
    const taskMatch = attrText.match(/\btask\s*=\s*(?:"([^"]+)"|'([^']+)'|[“]([^”]+)[”]|([^\s>]+))/i);

    const role = cleanTargetIdentifier(roleMatch ? (roleMatch[1] || roleMatch[2] || roleMatch[3] || roleMatch[4]) : '').toLowerCase();
    const name = cleanTargetIdentifier(nameMatch ? (nameMatch[1] || nameMatch[2] || nameMatch[3] || nameMatch[4]) : '');
    let rawTaskAttr = stripQuotes(taskMatch ? (taskMatch[1] || taskMatch[2] || taskMatch[3] || taskMatch[4]) : '');
    if (rawTaskAttr) {
      const words = rawTaskAttr.trim().split(/\s+/).filter(Boolean);
      if (words.length > 30) {
        if (onBarrierViolation) {
          onBarrierViolation(
            `❌ [BARRIER REJECT] Thuộc tính task="..." vượt quá giới hạn 30 từ (${words.length} từ). Thuộc tính task chỉ được dùng làm tiêu đề ngắn (<= 30 từ). Toàn bộ hướng dẫn chi tiết phải đặt trong body thẻ!`,
            targetOrchId
          );
        }
        return null;
      }
    }
    let task = rawTaskAttr;
    let bodyContent = '';
    if (cmd.body) {
      const taskTagMatch = cmd.body.match(/<task>([\s\S]*?)<\/task>/i);
      if (taskTagMatch) {
        if (!task) task = taskTagMatch[1].trim();
        bodyContent = cmd.body.replace(/<task>[\s\S]*?<\/task>/i, '').trim();
      } else {
        bodyContent = cmd.body.trim();
      }
    }
    if (task && bodyContent) {
      task = `${task} — ${bodyContent}`;
    } else if (!task && bodyContent) {
      task = bodyContent;
    }

    if (role && name && task && !INVALID_PLACEHOLDERS.has(role) && !INVALID_PLACEHOLDERS.has(name.toLowerCase())) {
      return { role, name, task };
    }
    return null;
  }

  // Bracket syntax
  const attrsText = cmd.content || '';
  const roleMatch = attrsText.match(/role=(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  const nameMatch = attrsText.match(/name=(?:"([^"]+)"|'([^']+)'|[“]([^”]+)[”]|(\S+))/i);
  const taskRegex = /task\s*=\s*/i;
  const taskMatch = attrsText.match(taskRegex);

  if (roleMatch && nameMatch && taskMatch) {
    let role = (roleMatch[1] || roleMatch[2] || roleMatch[3] || '').trim().toLowerCase();
    let name = (nameMatch[1] || nameMatch[2] || nameMatch[3] || nameMatch[4] || '').trim();
    role = cleanTargetIdentifier(role);
    name = cleanTargetIdentifier(name);
    if (!role || !name || INVALID_PLACEHOLDERS.has(role) || INVALID_PLACEHOLDERS.has(name.toLowerCase())) {
      return null;
    }
    const taskIndex = attrsText.search(taskRegex);
    const valStart = taskIndex + taskMatch[0].length;
    let rawTask = attrsText.substring(valStart).trim();
    rawTask = stripQuotes(rawTask);
    const task = rawTask.trim().normalize('NFC');
    if (task && !INVALID_PLACEHOLDERS.has(task.toLowerCase())) {
      return { role, name, task };
    }
  }
  return null;
}
