// ============================================================================
// DIRECTIVE PARSER UTILITY (GỘP & CHUẨN HÓA TOÀN BỘ CÁC BỘ BÓC TÁCH CHỈ THỊ)
// ============================================================================

export function parseXmlAttributes(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!attrStr) return attrs;
  const regex = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(attrStr)) !== null) {
    const key = String(match[1] || '').toLowerCase();
    const val = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : (match[4] || ''));
    attrs[key] = val;
  }
  return attrs;
}

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

export interface DirectiveItem {
  type: 'text' | 'talk' | 'spawn' | 'report';
  start: number;
  end: number;
  text?: string;
  data: {
    target?: string;
    role?: string;
    name?: string;
    task?: string;
    title?: string;
    message?: string;
    raw: string;
  };
}

export function extractAllDirectivesAndText(content: string): DirectiveItem[] {
  if (!content) return [];
  const rawText = String(content).normalize('NFC');
  const items: DirectiveItem[] = [];

  // BẢO VỆ NỘI DUNG TRONG CODE SPAN / CODE BLOCK KHÔNG BỊ PARSE THÀNH DIRECTIVE:
  const codeMasks: string[] = [];
  const text = rawText.replace(/```[\s\S]*?```|`[^`\n]*`/g, (match) => {
    const token = `__AF_INLINE_OR_FENCED_CODE_${codeMasks.length}__`;
    codeMasks.push(match);
    return token;
  });

  const restoreMasks = (str: string): string => {
    if (!str || codeMasks.length === 0) return str;
    return str.replace(/__AF_INLINE_OR_FENCED_CODE_(\d+)__/g, (_, idx) => codeMasks[Number(idx)] || '');
  };

  const directiveRegex = /(?:<\s*spawn\b([^>]*)\/>|<\s*spawn\b([^>]*)>([\s\S]*?)<\/\s*spawn(?:\s+[^>]*)?>|\[SPAWN\]\s*(\S+)\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s*(?:assigned:\s*([\s\S]*?))?(?=(?:<\s*(?:talk|spawn|report)|\[(?:TALK|SPAWN|REPORT)|$))|<\s*talk\b([^>]*)\/>|<\s*talk\b([^>]*)>([\s\S]*?)<\/\s*talk(?:\s+[^>]*)?>|\[TALK\b([^\]]*)\]([\s\S]*?)(?:\[\/TALK\]|(?=\[(?:TALK|SPAWN|REPORT)|<\s*(?:talk|spawn|report)|$))|<\s*report\b([^>]*)\/>|<\s*report\b([^>]*)>([\s\S]*?)<\/\s*report(?:\s+[^>]*)?>|\[REPORT\b([^\]]*)\]([\s\S]*?)(?:\[\/REPORT\]|(?=\[(?:TALK|SPAWN|REPORT)|<\s*(?:talk|spawn|report)|$)))/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = directiveRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    const matchStr = match[0];
    const matchEnd = matchIndex + matchStr.length;

    if (matchIndex > lastIndex) {
      const precedingText = text.substring(lastIndex, matchIndex);
      if (precedingText.trim().length > 0) {
        items.push({
          type: 'text',
          start: lastIndex,
          end: matchIndex,
          text: precedingText,
          data: { raw: precedingText }
        });
      }
    }

    if (match[1] !== undefined) {
      // Self-closing <spawn ... />
      const attrs = parseXmlAttributes(match[1]);
      items.push({
        type: 'spawn',
        start: matchIndex,
        end: matchEnd,
        data: {
          role: attrs.role || '',
          name: attrs.name || attrs.target || '',
          task: attrs.task || attrs.message || '',
          target: attrs.name || attrs.target || '',
          raw: matchStr
        }
      });
    } else if (match[2] !== undefined) {
      // Full XML <spawn ...>body</spawn>
      const attrs = parseXmlAttributes(match[2]);
      const body = (match[3] || '').trim();
      const combinedTask = [attrs.task, body].filter(Boolean).join('\n\n') || attrs.task || body;
      items.push({
        type: 'spawn',
        start: matchIndex,
        end: matchEnd,
        data: {
          role: attrs.role || '',
          name: attrs.name || attrs.target || '',
          task: combinedTask,
          message: body,
          target: attrs.name || attrs.target || '',
          raw: matchStr
        }
      });
    } else if (match[4] !== undefined) {
      // Bracket [SPAWN]
      const role = match[4] || '';
      const name = match[5] || match[6] || match[7] || '';
      const task = (match[8] || '').trim();
      items.push({
        type: 'spawn',
        start: matchIndex,
        end: matchEnd,
        data: {
          role,
          name,
          task,
          target: name,
          raw: matchStr
        }
      });
    } else if (match[9] !== undefined) {
      // Self-closing <talk ... />
      const attrs = parseXmlAttributes(match[9]);
      items.push({
        type: 'talk',
        start: matchIndex,
        end: matchEnd,
        data: {
          target: attrs.target || attrs.agent || attrs.to || '',
          task: attrs.task || '',
          message: attrs.message || attrs.msg || attrs.content || '',
          raw: matchStr
        }
      });
    } else if (match[10] !== undefined) {
      // Full XML <talk ...>body</talk>
      const attrs = parseXmlAttributes(match[10]);
      const body = (match[11] || '').trim();
      items.push({
        type: 'talk',
        start: matchIndex,
        end: matchEnd,
        data: {
          target: attrs.target || attrs.agent || attrs.to || '',
          task: attrs.task || '',
          message: body || attrs.message || attrs.msg || attrs.content || '',
          raw: matchStr
        }
      });
    } else if (match[12] !== undefined) {
      // Bracket [TALK attrs]body[/TALK]
      const attrs = parseXmlAttributes(match[12]);
      const body = (match[13] || '').replace(/\[\/TALK\]\s*$/i, '').trim();
      items.push({
        type: 'talk',
        start: matchIndex,
        end: matchEnd,
        data: {
          target: attrs.target || attrs.agent || attrs.to || '',
          task: attrs.task || '',
          message: body || attrs.message || attrs.msg || attrs.content || '',
          raw: matchStr
        }
      });
    } else if (match[14] !== undefined) {
      // Self-closing <report ... />
      const attrs = parseXmlAttributes(match[14]);
      items.push({
        type: 'report',
        start: matchIndex,
        end: matchEnd,
        data: {
          target: attrs.target || attrs.to || 'orchestrator',
          title: attrs.title || attrs.task || 'Báo cáo',
          message: attrs.message || attrs.msg || attrs.content || '',
          raw: matchStr
        }
      });
    } else if (match[15] !== undefined) {
      // Full XML <report ...>body</report>
      const attrs = parseXmlAttributes(match[15]);
      let body = (match[16] || '').trim()
        .replace(/<\s*report(?:\s+[^>]*)?>/gi, '')
        .replace(/<\/\s*report\s*>/gi, '')
        .trim();
      items.push({
        type: 'report',
        start: matchIndex,
        end: matchEnd,
        data: {
          target: attrs.target || attrs.to || 'orchestrator',
          title: attrs.title || attrs.task || 'Báo cáo',
          message: body || attrs.message || attrs.msg || attrs.content || '',
          raw: matchStr
        }
      });
    } else if (match[17] !== undefined) {
      // Bracket [REPORT attrs]body[/REPORT]
      const attrs = parseXmlAttributes(match[17]);
      const body = (match[18] || '').replace(/\[\/REPORT\]\s*$/i, '').trim();
      items.push({
        type: 'report',
        start: matchIndex,
        end: matchEnd,
        data: {
          target: attrs.target || attrs.to || 'orchestrator',
          title: attrs.title || attrs.task || 'Báo cáo',
          message: body || attrs.message || attrs.msg || attrs.content || '',
          raw: matchStr
        }
      });
    }

    lastIndex = matchEnd;
  }

  // Live streaming unclosed tag support
  const remainingStream = text.substring(lastIndex);
  const unclosedTalkMatch = remainingStream.match(/<\s*talk\b([^>]*)>([\s\S]*)$/i);
  const unclosedSpawnMatch = remainingStream.match(/<\s*spawn\b([^>]*)>([\s\S]*)$/i);

  if (unclosedTalkMatch) {
    const unclosedStart = lastIndex + (unclosedTalkMatch.index || 0);
    if (unclosedStart > lastIndex) {
      const prec = text.substring(lastIndex, unclosedStart);
      if (prec.trim().length > 0) {
        items.push({
          type: 'text',
          start: lastIndex,
          end: unclosedStart,
          text: prec,
          data: { raw: prec }
        });
      }
    }
    const attrs = parseXmlAttributes(unclosedTalkMatch[1]);
    let bodyStreaming = (unclosedTalkMatch[2] || '').replace(/<\/\s*talk(?:\s+[^>]*)?>\s*$/i, '');
    items.push({
      type: 'talk',
      start: unclosedStart,
      end: text.length,
      data: {
        target: attrs.target || attrs.agent || attrs.to || '',
        task: attrs.task || '',
        message: bodyStreaming || attrs.message || attrs.msg || attrs.content || '',
        raw: unclosedTalkMatch[0]
      }
    });
    lastIndex = text.length;
  } else if (unclosedSpawnMatch) {
    const unclosedStart = lastIndex + (unclosedSpawnMatch.index || 0);
    if (unclosedStart > lastIndex) {
      const prec = text.substring(lastIndex, unclosedStart);
      if (prec.trim().length > 0) {
        items.push({
          type: 'text',
          start: lastIndex,
          end: unclosedStart,
          text: prec,
          data: { raw: prec }
        });
      }
    }
    const attrs = parseXmlAttributes(unclosedSpawnMatch[1]);
    let bodyStreaming = (unclosedSpawnMatch[2] || '').trim().replace(/<\/\s*spawn(?:\s+[^>]*)?>\s*$/i, '');
    const combinedTask = [attrs.task, bodyStreaming].filter(Boolean).join('\n\n') || attrs.task || bodyStreaming;
    items.push({
      type: 'spawn',
      start: unclosedStart,
      end: text.length,
      data: {
        role: attrs.role || '',
        name: attrs.name || attrs.target || '',
        task: combinedTask,
        message: bodyStreaming,
        target: attrs.name || attrs.target || '',
        raw: unclosedSpawnMatch[0]
      }
    });
    lastIndex = text.length;
  }

  if (lastIndex < text.length) {
    const trailingText = text.substring(lastIndex);
    if (trailingText.trim().length > 0) {
      items.push({
        type: 'text',
        start: lastIndex,
        end: text.length,
        text: trailingText,
        data: { raw: trailingText }
      });
    }
  }

  items.sort((a, b) => a.start - b.start);

  return items.map(item => {
    if (item.type === 'text') {
      return {
        ...item,
        text: restoreMasks(item.text || ''),
        data: item.data ? { ...item.data, raw: restoreMasks(item.data.raw) } : item.data
      };
    }
    return {
      ...item,
      data: item.data ? {
        ...item.data,
        task: restoreMasks(item.data.task || ''),
        message: restoreMasks(item.data.message || ''),
        raw: restoreMasks(item.data.raw || '')
      } : item.data
    };
  });
}

export interface SplitMessageResult {
  conversationText: string;
  hasReport: boolean;
  reportTitle?: string;
  reportContent?: string;
}

export function splitReportAndConversation(content: string): SplitMessageResult {
  if (!content) return { conversationText: '', hasReport: false };

  let text = String(content || '').normalize('NFC');

  const codeBlocks: string[] = [];
  text = text.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
    const token = `__AF_CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(match);
    return token;
  });

  const docLines: string[] = [];
  text = text.replace(/^[ \t]*(?:>|[-*+]|\d+\.|\([^\n)]*|.*(?:ví dụ|hướng dẫn|cú pháp|lệnh|thẻ|dùng|tag|syntax|example|instruction|task_update)[^\n]*)[ \t]+.*(?:<|\b(?:TALK|SPAWN|TASK_UPDATE)\b).*$/gmi, (match) => {
    const token = `__AF_DOC_LINE_${docLines.length}__`;
    docLines.push(match);
    return token;
  });

  text = text.replace(/^[ \t]*<\s*(?:talk|spawn|stop|resume|create_role|create-role|delete_agent)\b[^>]*\b(?:target|target-id|target_id|agent-id|agent_id|agent|to|id|role|name|task)\s*=[^>]*>[\s\S]*?<\/\s*(?:talk|spawn|stop|resume|create_role|create-role|delete_agent)\s*>[ \t]*\n?/gmi, '');
  text = text.replace(/<\s*(?:talk|spawn)\b[^>]*>[\s\S]*?<\/\s*(?:talk|spawn)\s*>/gmi, '');
  text = text.replace(/^[ \t]*<\s*(?:spawn|stop|resume|create_role|create-role|delete_agent)\b[^>]*\b(?:target|target-id|target_id|agent-id|agent_id|agent|to|id|role|name|task)\s*=[^>]*\/>[ \t]*\n?/gmi, '');
  text = text.replace(/<\s*(?:talk|spawn)\b[^>]*\/>/gmi, '');
  text = text.replace(/^[ \t]*\[(?:TALK|SPAWN|STOP|RESUME|CREATE ROLE)\b[^\]]*\][ \t]*\n?/gmi, '');

  text = text.replace(/(?:\[FROM:\s*[^\]]+\]\s*)?\[TO:\s*[^\]]+\]\s*(?:Task complete\.?)?/gi, '');
  text = text.replace(/^\s*\[TASK\][^\n]*\n?/gmi, '');

  text = text.replace(/<\s*spawn\b[^>]*>[\s\S]*?<\/\s*spawn\s*>/gi, '');
  text = text.replace(/<\s*spawn\b[^>]*\/>/gi, '');
  text = text.replace(/<\s*talk\b[^>]*>[\s\S]*?<\/\s*talk\s*>/gi, '');
  text = text.replace(/<\s*talk\b[^>]*\/>/gi, '');
  text = text.replace(/\[SPAWN\][^\n]*\n?/gi, '');
  text = text.replace(/\[TALK\b[^\]]*\][\s\S]*?\[\/TALK\]/gi, '');
  text = stripSystemTaskTags(text);

  for (let i = 0; i < docLines.length; i++) {
    text = text.replace(`__AF_DOC_LINE_${i}__`, docLines[i]);
  }

  for (let i = 0; i < codeBlocks.length; i++) {
    text = text.replace(`__AF_CODE_BLOCK_${i}__`, codeBlocks[i]);
  }

  const conversationText = text.trim().replace(/__AF_CODE_BLOCK_(\d+)__/g, (_, idx) => codeBlocks[Number(idx)] || '');

  return {
    conversationText,
    hasReport: false
  };
}
