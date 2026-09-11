// src/agents/stream-event-filter.ts
// Bộ lọc và chuẩn hóa các sự kiện streaming từ các backend AI (OpenCode Serve, CLI JSONL, v.v.)
// Tách biệt hoàn toàn khỏi server.ts để giữ kiến trúc Clean & Modular.

import type { TokenUsage } from './types.js';

// Danh sách các event type nội bộ / metadata kỹ thuật không hiển thị trên chat UI
const IGNORED_EVENT_TYPES = new Set([
  'step_start',
  'session_idle',
  'session_error',
  'session_status',
  'session_diff',
  'user',
  'system',
  'session',
  'init',
  'message_updated',
  'session_created',
  'session_updated'
]);

/**
 * Kiểm tra xem một event có phải là metadata nội bộ cần bỏ qua hay không
 */
export function isIgnoredStreamEvent(e: any): boolean {
  if (!e || typeof e !== 'object') return true;
  const t = String(e.type || e.evt || '').toLowerCase().trim();
  const tt = t.replace(/-/g, '_');
  return IGNORED_EVENT_TYPES.has(t) || IGNORED_EVENT_TYPES.has(tt);
}

/**
 * Trích xuất thống kê TokenUsage từ event step_finish (nếu có)
 */
export function extractTokenUsageFromEvent(e: any): TokenUsage | null {
  if (!e || typeof e !== 'object') return null;
  const t = String(e.type || e.evt || '').toLowerCase().replace(/-/g, '_');
  if (t !== 'step_finish') return null;

  const tokenSrc = e.part?.tokens || e.tokens || e.usage || e.part?.usage;
  if (!tokenSrc || typeof tokenSrc !== 'object') return null;

  const inp = tokenSrc.input_tokens || tokenSrc.prompt_tokens || tokenSrc.input || tokenSrc.prompt || 0;
  const out = tokenSrc.output_tokens || tokenSrc.completion_tokens || tokenSrc.output || tokenSrc.completion || 0;
  const rea = tokenSrc.reasoning_tokens || tokenSrc.thought_tokens || tokenSrc.reasoning || tokenSrc.thought || tokenSrc.completion_tokens_details?.reasoning_tokens;
  const cr = tokenSrc.cache_read_input_tokens || tokenSrc.cached_tokens || tokenSrc.cache?.read || tokenSrc.cache_read || tokenSrc.prompt_tokens_details?.cached_tokens;
  const cw = tokenSrc.cache_write_input_tokens || tokenSrc.cache?.write || tokenSrc.cache_write;
  const tot = tokenSrc.total_tokens || tokenSrc.total || tokenSrc.tokens || (inp + out);

  if (tot <= 0 && inp <= 0 && out <= 0) return null;

  return {
    input: inp,
    output: out,
    inputTokens: inp,
    outputTokens: out,
    reasoningTokens: rea,
    cacheReadTokens: cr,
    cacheWriteTokens: cw,
    totalTokens: tot,
    total: tot
  };
}
