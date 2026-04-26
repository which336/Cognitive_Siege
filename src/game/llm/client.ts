import { UserSettings } from '../../types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** OpenAI-style response_format hint. Falls back to plain text if backend ignores it. */
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
 * Minimal OpenAI-compatible chat client.
 *
 * Compatible with: OpenAI, DeepSeek, ZhipuAI (智谱), Moonshot/Kimi, Ollama (with /v1).
 * The /v1 part is part of `apiBase` so users can paste full base URLs.
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

/** Pulls the first balanced JSON object out of a string (handles ```json fences). */
export function extractJson<T = unknown>(s: string): T | null {
  if (!s) return null;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const candidate = fence ? fence[1] : s;
  // Find first { and balance braces
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
