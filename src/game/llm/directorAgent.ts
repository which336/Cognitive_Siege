import { UserSettings, VignetteContext } from '../../types';
import { chatCompletion, extractJson } from './client';
import { fallbackVignette } from '../data/fallback';

const DIRECTOR_SYSTEM = `你是一个游戏剧情导演。请基于一个"失眠者"今晚的情绪标签，生成一段 80-120 字中文情境文案：第三人称、文学化、有具体生活细节（一杯凉透的茶、未读消息、走廊声响等），不要直接谈论游戏机制，不要用第二人称。最后返回 JSON：
{
  "patientName": string,
  "night": number,
  "emotion": string,  // 你被告知的情绪标签
  "hint": string      // 80-120 字的情境文案
}
绝对不要输出 JSON 以外的内容。`;

export interface DirectorOpts {
  settings: UserSettings;
  night: number;
  emotionHint: string; // e.g. "焦虑·临界" or "抑郁·复发"
  signal?: AbortSignal;
}

export async function runDirector(opts: DirectorOpts): Promise<VignetteContext> {
  const { settings, night, emotionHint, signal } = opts;
  if (settings.demoMode || !settings.apiKey) {
    return fallbackVignette(night);
  }
  try {
    const res = await chatCompletion(settings, {
      messages: [
        { role: 'system', content: DIRECTOR_SYSTEM },
        { role: 'user', content: `Night #${night}，情绪标签：${emotionHint}。请返回 JSON。` },
      ],
      responseFormat: 'json',
      temperature: 0.9,
      maxTokens: 300,
      signal,
    });
    const parsed = extractJson<any>(res.content);
    if (!parsed || typeof parsed.hint !== 'string') throw new Error('parse_failed');
    return {
      patientName: typeof parsed.patientName === 'string' ? parsed.patientName : '林晚',
      night: typeof parsed.night === 'number' ? parsed.night : night,
      emotion: typeof parsed.emotion === 'string' ? parsed.emotion : emotionHint,
      hint: parsed.hint.slice(0, 200),
    };
  } catch (err) {
    console.warn('[directorAgent] falling back:', err);
    return fallbackVignette(night);
  }
}
