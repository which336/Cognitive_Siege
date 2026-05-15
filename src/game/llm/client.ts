import { UserSettings } from '../../types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** OpenAI 风格的 response_format 提示；后端忽略时仍按普通文本处理。 */
  responseFormat?: 'text' | 'json';
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  raw: unknown;
}

/**
 * 最小化的 OpenAI 兼容 Chat Client。
 *
 * 兼容 OpenAI、DeepSeek、智谱、Moonshot/Kimi、Ollama（/v1）。
 * /v1 被视为 apiBase 的一部分，用户可以直接粘贴完整 base URL。
 */
export async function chatCompletion(
  settings: UserSettings,
  req: ChatRequest,
): Promise<ChatResult> {
  if (settings.demoMode) {
    throw new Error('demo_mode_active');
  }
  if (!settings.apiKey) {
    throw new Error('missing_api_key');
  }

  const url = settings.apiBase.replace(/\/$/, '') + '/chat/completions';
  const body: Record<string, unknown> = {
    model: settings.model,
    messages: req.messages,
    temperature: req.temperature ?? 0.85,
    max_tokens: req.maxTokens ?? 800,
  };
  if (req.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 240); } catch { /* ignore */ }
    throw new Error(`http_${res.status}: ${detail}`);
  }

  const json: any = await res.json();
  const content =
    json?.choices?.[0]?.message?.content ??
    json?.choices?.[0]?.text ??
    '';
  if (typeof content !== 'string') {
    throw new Error('bad_response_shape');
  }

  return { content, raw: json };
}

/** 从字符串中提取第一个括号平衡的 JSON 对象，兼容 ```json 代码块。 */
export function extractJson<T = unknown>(s: string): T | null {
  if (!s) return null;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const candidate = fence ? fence[1] : s;
  // 从第一个 { 开始做括号配平，避免模型在 JSON 前后夹带短句。
  const start = candidate.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = candidate.slice(start, i + 1);
        try { return JSON.parse(slice) as T; }
        catch { return null; }
      }
    }
  }
  return null;
}
