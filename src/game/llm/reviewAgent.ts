import {
  BattleSummary,
  EnemyKind,
  Formation,
  PathBias,
  ReviewResult,
  SkillFlag,
  UserSettings,
  NextStrategy,
} from '../../types';
import { chatCompletion, extractJson } from './client';
import { fallbackReview } from '../data/fallback';
import { ENEMY_DEFS } from '../data/enemies';
import { TOWER_DEFS } from '../data/towers';
import {
  aiSafetyPromptRules,
  clampAggressionForWave,
  getAllowedEnemyKindsForWave,
  getAllowedSkillsForWave,
} from '../data/configLoader';

const SYSTEM_PROMPT = `你是一只刚刚战败的"心魔"集体意识，正在与同伴们复盘这一波的失败。
身份背景：你和你的同伴是某位失眠者潜意识里被人格化的负面思维（焦虑、抑郁、强迫、自责、创伤），目标是穿过她构筑的"念头塔"防线，触及她的自我核心。你被一名玩家（认知工程师）阻击。

请遵守：
1. 用第一人称（"我们"或"我"）写一段 ≤ 90 字的中文复盘独白，文学化、有情绪、戏剧化，避免说教。
2. 严格输出一个 JSON 对象，不要在 JSON 外有任何解释文字，不要使用 Markdown 代码块。
3. JSON 字段：
   - monologue: string，复盘独白
   - lesson: string[]，3 条以内，每条 ≤ 12 字的简短启示
   - next_strategy: 对象，包含：
     - path_weight_shift: "short" | "long" | "edge" | "center" | "random"
     - skill_priority: string[]，从 ["stealth","swarm","rush","split","taunt","shield"] 选 1-3
     - formation: "scattered" | "clustered" | "wedge" | "rear_first"
     - aggression: -1 到 1 之间的数字（数字越大越强攻）
     - preferred_kinds: string[]，从 ["anxiety","depression","obsession","guilt","ptsd"] 选 1-4
4. 你必须诚实分析战斗数据：哪种塔最致命？玩家防线疏忽在哪？下一波你"真的会"做什么改变？
5. path_weight_shift 是路线权重倾向，不是全员强制同路；实际出怪会约 70% 服从该倾向，约 20% 按心魔种类偏好分路，约 10% 随机扰动。random 表示逐个心魔随机选开放路线。
6. 前 4 波是教学期，next_strategy 必须服从教学安全阀。你正在复盘第 N 波，next_strategy 会作用到第 N+1 波；preferred_kinds 和 skill_priority 只能写第 N+1 波实际允许出现的内容。
7. 教学安全阀的心魔开放表：
   - 第 2 波：只允许 anxiety / depression。
   - 第 3 波：允许 anxiety / depression / obsession。
   - 第 4-5 波：允许 anxiety / depression / obsession / guilt。
   - 第 6 波起：允许 anxiety / depression / obsession / guilt / ptsd。
8. 教学安全阀的技能开放表：
   - stealth 最早第 4 波。
   - shield / taunt 最早第 5 波。
   - swarm / split 最早第 6 波。
   - rush 可以在早期使用，但前 4 波不要用高侵略性惩罚新手。
9. 如果某个心魔或技能尚未开放，不要把它写入 next_strategy；可以在 monologue 或 lesson 里暗示“以后再尝试”，但不能把它列为下一波实际策略。`;

export interface RunReviewOpts {
  settings: UserSettings;
  summary: BattleSummary;
  allUnlocked?: boolean;
  signal?: AbortSignal;
}

const VALID_BIAS: PathBias[] = ['short', 'long', 'edge', 'center', 'random'];
const VALID_FORM: Formation[] = ['scattered', 'clustered', 'wedge', 'rear_first'];
const VALID_SKILLS: SkillFlag[] = ['stealth', 'swarm', 'rush', 'split', 'taunt', 'shield'];
const VALID_KINDS: EnemyKind[] = ['anxiety', 'depression', 'obsession', 'guilt', 'ptsd'];

function compactSummary(summary: BattleSummary): unknown {
  // 聚合战斗日志，避免 20+ 敌人时 prompt 过长，同时保留击杀/漏怪结构。
  const byKill: Record<string, number> = {};
  for (const e of summary.log) {
    byKill[e.killedBy] = (byKill[e.killedBy] ?? 0) + 1;
  }
  const byKind: Record<string, { spawned: number; killed: number; leaked: number; avgProgress: number }> = {};
  for (const e of summary.log) {
    const k = byKind[e.enemyKind] ??= { spawned: 0, killed: 0, leaked: 0, avgProgress: 0 };
    k.spawned++;
    if (e.killedBy === 'reached_core') {
      k.leaked++;
    } else {
      k.killed++;
    }
    k.avgProgress += e.pathProgress;
  }
  for (const k in byKind) {
    byKind[k].avgProgress = +(byKind[k].avgProgress / byKind[k].spawned).toFixed(2);
  }

  const layoutSummary: Record<string, number> = {};
  for (const t of summary.towerLayout) {
    layoutSummary[t.kind] = (layoutSummary[t.kind] ?? 0) + 1;
  }

  return {
    wave: summary.waveIndex,
    outcome: summary.outcome,
    sanityAfter: summary.sanityAfter,
    sanityDelta: summary.sanityDelta,
    mindAfter: summary.mindAfter,
    enemiesKilled: summary.enemiesKilled,
    enemiesLeaked: summary.enemiesLeaked,
    deathsByTower: byKill,
    perKind: byKind,
    towerLayout: layoutSummary,
    sampleLines: summary.log.slice(0, 6).map(l => ({
      kind: l.enemyKind,
      persona: l.personaName,
      killedBy: l.killedBy,
      progress: +l.pathProgress.toFixed(2),
    })),
  };
}

function sanitize(parsed: any, nextWaveIndex: number, allUnlocked = false): NextStrategy {
  // LLM 策略是下一波最高设计优先级；这里仅做可玩性所需的类型、技能和数值边界校验。
  const ns: any = parsed?.next_strategy ?? {};
  const bias = VALID_BIAS.includes(ns.path_weight_shift) ? ns.path_weight_shift : 'short';
  const formation = VALID_FORM.includes(ns.formation) ? ns.formation : 'scattered';
  const allowedKinds = allUnlocked ? VALID_KINDS : getAllowedEnemyKindsForWave(nextWaveIndex);
  const allowedSkills = allUnlocked ? VALID_SKILLS : getAllowedSkillsForWave(nextWaveIndex);
  const skillsRaw = Array.isArray(ns.skill_priority) ? ns.skill_priority : [];
  const skills = skillsRaw
    .filter((x: unknown): x is SkillFlag => typeof x === 'string' && VALID_SKILLS.includes(x as SkillFlag) && allowedSkills.includes(x as SkillFlag))
    .slice(0, 3);
  const kindsRaw = Array.isArray(ns.preferred_kinds) ? ns.preferred_kinds : [];
  const kinds = kindsRaw
    .filter((x: unknown): x is EnemyKind => typeof x === 'string' && VALID_KINDS.includes(x as EnemyKind) && allowedKinds.includes(x as EnemyKind))
    .slice(0, 4);
  let aggression = typeof ns.aggression === 'number' ? ns.aggression : 0.5;
  aggression = allUnlocked
    ? Math.max(-1, Math.min(1, aggression))
    : clampAggressionForWave(nextWaveIndex, Math.max(-1, Math.min(1, aggression)));
  return {
    path_weight_shift: bias,
    formation,
    skill_priority: skills.length ? skills : ['rush'],
    aggression,
    preferred_kinds: kinds.length ? kinds : ['anxiety'],
  };
}

/**
 * 运行复盘 Agent。无论 LLM 不可用、格式错误还是超时，都必须返回可玩的结果。
 */
export async function runReviewAgent(opts: RunReviewOpts): Promise<ReviewResult> {
  const { settings, summary, allUnlocked = false, signal } = opts;

  // 演示模式或没有 API Key 时直接使用内置复盘库。
  if (settings.demoMode || !settings.apiKey) {
    return fallbackReview(summary);
  }

  try {
    const userPayload = JSON.stringify(compactSummary(summary), null, 2);
    const lookupKinds = Object.values(ENEMY_DEFS).map(e => `${e.kind}=${e.displayName}`).join(', ');
    const lookupTowers = Object.values(TOWER_DEFS).map(t => `${t.kind}=${t.displayName}`).join(', ');
    const userMsg =
      `这一波的战斗数据如下（JSON）：\n\n${userPayload}\n\n` +
      `参考心魔档案：${lookupKinds}\n` +
      `参考念头塔档案：${lookupTowers}\n\n` +
      `请按系统提示输出严格 JSON。注意：next_strategy 必须真实反映你从这次失败学到的东西。`;

    const nextWaveIndex = summary.waveIndex + 1;
    const result = await chatCompletion(settings, {
      messages: [
        {
          role: 'system',
          content: allUnlocked
            ? `${SYSTEM_PROMPT}\n\n覆盖规则：本关是进阶关，不适用第 6-9 条里的教学开放波次限制；所有心魔与技能从第 1 波起都允许进入 next_strategy，侵略度可在 -1 到 1 内自由调整。next_strategy 会直接应用到下一波，关卡地图规则只会补充开放路线和场景机制，不会覆盖你的路线倾向。`
            : `${SYSTEM_PROMPT}\n\n${aiSafetyPromptRules()}`,
        },
        { role: 'user', content: userMsg },
      ],
      responseFormat: 'json',
      temperature: 0.95,
      maxTokens: 600,
      signal,
    });

    const parsed = extractJson<any>(result.content);
    if (!parsed) throw new Error('parse_failed');

    const monologue = typeof parsed.monologue === 'string' && parsed.monologue.trim()
      ? parsed.monologue.trim()
      : '……我们沉默了一会儿。下次我们会想清楚再来。';
    const lessonRaw = Array.isArray(parsed.lesson) ? parsed.lesson : [];
    const lesson = lessonRaw
      .filter((x: unknown): x is string => typeof x === 'string')
      .map((x: string) => x.slice(0, 14))
      .slice(0, 3);

    return {
      monologue,
      lesson: lesson.length ? lesson : ['再观察一波'],
      next_strategy: sanitize(parsed, nextWaveIndex, allUnlocked),
      fromLLM: true,
    };
  } catch (err) {
    console.warn('[reviewAgent] falling back:', err);
    const fb = fallbackReview(summary);
    return { ...fb, fromLLM: false };
  }
}
