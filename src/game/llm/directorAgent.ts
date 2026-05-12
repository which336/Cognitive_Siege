import { UserSettings, VignetteContext } from '../../types';
import { chatCompletion, extractJson } from './client';
import { fallbackVignette } from '../data/fallback';

const DIRECTOR_SYSTEM = `你是一个游戏剧情导演。你正在为同一位女性失眠者「林晚」写连续十晚的梦境会话开场，不是每一晚换一个患者。请基于林晚今晚的情绪标签，生成一段 80-120 字中文情境文案：第三人称、文学化、有具体生活细节（一杯凉透的茶、未读消息、走廊声响等），不要直接谈论游戏机制，不要用第二人称。

连续性要求：
- patientName 必须固定为 "林晚"。
- 林晚是女性，中文代词必须使用“她 / 她的 / 她会”等女性指代。
- 禁止使用“他 / 他的 / 他会”等男性代词指代林晚。
- 所有夜晚都属于林晚同一个人的故事，可以延续前后情绪，但不要创造新的主角、患者、姓名或职业。
- 可以写“她”“林晚”，不要写成另一个人的经历。

最后返回 JSON：
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
    return normalizeVignette({
      patientName: '林晚',
      night: typeof parsed.night === 'number' ? parsed.night : night,
      emotion: typeof parsed.emotion === 'string' ? parsed.emotion : emotionHint,
      hint: parsed.hint.slice(0, 200),
    });
  } catch (err) {
    console.warn('[directorAgent] falling back:', err);
    return fallbackVignette(night);
  }
}

export function normalizeVignette(vignette: VignetteContext): VignetteContext {
  return {
    ...vignette,
    patientName: '林晚',
    hint: normalizeLinWanPronouns(vignette.hint),
  };
}

function normalizeLinWanPronouns(text: string): string {
  return text
    .replace(/林晚他/g, '林晚她')
    .replace(/(^|[，。！？；：、“”\s])他(?=的|也|在|还|会|把|被|从|对|说|想|怕|没|需要|希望|意识|听|看|走|睡|醒|躺|接|差|答|比|要|不|能|已经|终于|仍|只|又|再|最|真正)/g, '$1她');
}
