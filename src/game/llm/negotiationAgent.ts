import {
  BossPersona,
  ChoiceTag,
  DialogueTurn,
  UserSettings,
} from '../../types';
import { chatCompletion, extractJson } from './client';
import { fallbackDialogue } from '../data/fallback';

const NEGOTIATION_SYSTEM = `你是一个塔防游戏中的 BOSS 心魔。你将与"认知工程师"（玩家）进行多轮谈判。
角色设定（由用户消息提供）：包括你的 displayName / 性格 / 动机。
你的回应必须严格输出 JSON：
{
  "boss_line": "≤90 字的中文台词，文学化，符合人设。允许使用换行 \\n。",
  "choices": [
    { "text": "玩家的选项 A，≤30 字", "tag": "empathy" | "confront" | "deceive" },
    { "text": "玩家的选项 B，≤30 字", "tag": "empathy" | "confront" | "deceive" },
    { "text": "玩家的选项 C，≤30 字", "tag": "empathy" | "confront" | "deceive" }
  ]
}
不要输出任何 JSON 以外的内容。三个选项的 tag 必须各不相同（empathy / confront / deceive）。`;

const VALID_TAGS: ChoiceTag[] = ['empathy', 'confront', 'deceive'];

export interface NegotiationContext {
  settings: UserSettings;
  persona: BossPersona;
  /** 上一轮玩家选择的 tag（首轮为 null） */
  lastPlayerTag: ChoiceTag | null;
  turnIndex: number; // 从 0 开始计数，匹配 UI 展示的对话轮次。
  signal?: AbortSignal;
}

function fallback(turn: number, waveIndex: number, levelId: string): DialogueTurn {
  return fallbackDialogue(levelId, waveIndex, turn);
}

function sanitizeTurn(parsed: any): DialogueTurn | null {
  // BOSS 台词可以自由发挥，但玩家选项必须落在固定三类谈判标签里。
  if (!parsed) return null;
  const line = typeof parsed.boss_line === 'string' ? parsed.boss_line.trim() : '';
  const choicesRaw = Array.isArray(parsed.choices) ? parsed.choices : [];
  const choices: { text: string; tag: ChoiceTag }[] = [];
  for (const c of choicesRaw) {
    if (!c || typeof c.text !== 'string') continue;
    if (!VALID_TAGS.includes(c.tag)) continue;
    choices.push({ text: c.text.trim(), tag: c.tag });
  }
  if (!line || choices.length < 3) return null;

  // 保证三种标签都出现；模型重复给标签时补齐最小可用选项。
  const tagSet = new Set(choices.map(x => x.tag));
  if (tagSet.size < 3) {
    const missing = VALID_TAGS.filter(t => !tagSet.has(t));
    for (const t of missing) {
      choices.push({ text: t === 'empathy' ? '我理解你。' : t === 'confront' ? '让开。' : '先休战。', tag: t });
    }
  }
  return { bossLine: line, choices: choices.slice(0, 3) };
}

export async function runNegotiation(
  ctx: NegotiationContext,
  waveIndex: number,
  levelId = 'level_1',
): Promise<DialogueTurn> {
  const { settings, persona, lastPlayerTag, turnIndex, signal } = ctx;

  if (settings.demoMode || !settings.apiKey) {
    return fallback(turnIndex, waveIndex, levelId);
  }

  try {
    const personaBlock = JSON.stringify({
      displayName: persona.displayName,
      kind: persona.kindHint,
      description: persona.description,
    }, null, 2);
    const lastBlock = lastPlayerTag
      ? `玩家上一轮的语气是「${lastPlayerTag}」，请据此调整你的反应（受冲击/感动/警觉）。`
      : `这是第一轮对话，请按你的性格主动开场。`;

    const userMsg = `BOSS 角色：\n${personaBlock}\n\n${lastBlock}\n\n请返回严格的 JSON 单对象。`;

    const res = await chatCompletion(settings, {
      messages: [
        { role: 'system', content: NEGOTIATION_SYSTEM },
        { role: 'user', content: userMsg },
      ],
      responseFormat: 'json',
      temperature: 0.95,
      maxTokens: 500,
      signal,
    });

    const parsed = extractJson<any>(res.content);
    const sanitized = sanitizeTurn(parsed);
    if (!sanitized) throw new Error('parse_failed');
    return sanitized;
  } catch (err) {
    console.warn('[negotiationAgent] falling back:', err);
    return fallback(turnIndex, waveIndex, levelId);
  }
}
