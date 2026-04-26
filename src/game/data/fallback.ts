import {
  EnemyKind,
  ReviewResult,
  NextStrategy,
  PathBias,
  Formation,
  SkillFlag,
  BattleSummary,
  VignetteContext,
  DialogueTurn,
  ChoiceTag,
  NegotiationResolution,
  BossPersona,
} from '../../types';

// ===================== Review fallback library =====================
// 12 hand-written "classic monologues" indexed by dominant cause-of-death.
// When LLM is unavailable, we pick the most thematically appropriate one
// based on which tower kind produced the most kills last wave.

interface FallbackEntry {
  monologue: string;
  lesson: string[];
  next: NextStrategy;
}

const FALLBACK_LIBRARY: Record<string, FallbackEntry[]> = {
  memory: [
    {
      monologue:
        '——花瓣，又是花瓣。\n你给她讲了那个夏天的故事，所以我们一靠近就被烧了。\n\n那么，下次我们就分开走。',
      lesson: ['集中=被覆盖', '回忆塔范围伤害克制密集', '改散兵线'],
      next: {
        path_weight_shift: 'edge',
        skill_priority: ['stealth', 'split'],
        formation: 'scattered',
        aggression: 0.2,
        preferred_kinds: ['guilt', 'obsession'],
      },
    },
    {
      monologue:
        '美好的回忆并不是永生的。\n我数过你那朵花的余烬，撑不到我们三波连击。\n\n下次……我们一起冲。',
      lesson: ['范围伤害有冷却', '我们想用数量压垮它'],
      next: {
        path_weight_shift: 'short',
        skill_priority: ['rush', 'swarm'],
        formation: 'clustered',
        aggression: 0.7,
        preferred_kinds: ['anxiety', 'anxiety', 'depression'],
      },
    },
  ],
  belief: [
    {
      monologue:
        '那束光直直地射穿了我中间最大的姐姐。\n它瞄得很准，但慢——很慢。\n\n下一次，我们让她去吸引那道光，剩下的从两边走。',
      lesson: ['信念塔单体高伤但慢', '诱饵+分散是反制'],
      next: {
        path_weight_shift: 'edge',
        skill_priority: ['taunt', 'split'],
        formation: 'scattered',
        aggression: 0.4,
        preferred_kinds: ['depression', 'anxiety', 'anxiety'],
      },
    },
    {
      monologue:
        '你坚信的东西，我并不真的怕。\n我只是怕，被它一击穿透——所以下次我们披一层伪装。',
      lesson: ['伪装绕过单体高伤', '隐身优先'],
      next: {
        path_weight_shift: 'edge',
        skill_priority: ['stealth'],
        formation: 'scattered',
        aggression: 0.3,
        preferred_kinds: ['guilt', 'guilt', 'obsession'],
      },
    },
  ],
  resonance: [
    {
      monologue:
        '我披着别人的脸过来，但你听见了我的心跳。\n那种共鸣……让我整个慢了下来。\n\n下次我们装作不存在地走。',
      lesson: ['共鸣塔揭穿伪装', '需要更分散更隐蔽'],
      next: {
        path_weight_shift: 'long',
        skill_priority: ['stealth', 'split'],
        formation: 'scattered',
        aggression: 0.1,
        preferred_kinds: ['guilt', 'depression'],
      },
    },
  ],
  acceptance: [
    {
      monologue:
        '你接纳得太多了。\n我们一直在前进，可你的核心几乎没在掉血。\n\n这一次，我们必须打到核心边上。',
      lesson: ['接纳塔续航强', '需要突破到底线'],
      next: {
        path_weight_shift: 'short',
        skill_priority: ['rush'],
        formation: 'wedge',
        aggression: 0.8,
        preferred_kinds: ['anxiety', 'ptsd', 'anxiety'],
      },
    },
  ],
  // Generic / mixed
  mixed: [
    {
      monologue:
        '我们死得很均匀——这意味着你的布防是整体的。\n那么这次，我们先派一只走最远的小路探探。',
      lesson: ['防线均匀=有死角试探价值'],
      next: {
        path_weight_shift: 'long',
        skill_priority: ['stealth'],
        formation: 'scattered',
        aggression: 0.3,
        preferred_kinds: ['guilt', 'obsession'],
      },
    },
    {
      monologue:
        '你赢了这一轮，但我们都没有放弃。\n下次我会让最弱的姐妹先上，看你的塔有没有"最讨厌的目标"。',
      lesson: ['探测塔的攻击优先级'],
      next: {
        path_weight_shift: 'short',
        skill_priority: ['taunt', 'rush'],
        formation: 'rear_first',
        aggression: 0.5,
        preferred_kinds: ['anxiety', 'depression', 'obsession'],
      },
    },
  ],
  // Bad-defense (player nearly lost)
  losing: [
    {
      monologue:
        '我能闻到你核心的颤抖。\n再来一次，我们就到了——不要犹豫，全员前压。',
      lesson: ['玩家防线脆弱', '集结突破'],
      next: {
        path_weight_shift: 'short',
        skill_priority: ['rush', 'swarm'],
        formation: 'clustered',
        aggression: 0.95,
        preferred_kinds: ['anxiety', 'anxiety', 'depression', 'ptsd'],
      },
    },
  ],
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function fallbackReview(summary: BattleSummary): ReviewResult {
  // Find most-killed-by tower
  const tally: Record<string, number> = {};
  for (const e of summary.log) {
    if (e.killedBy === 'reached_core' || e.killedBy === 'unknown') continue;
    tally[e.killedBy] = (tally[e.killedBy] ?? 0) + 1;
  }
  let dominant = 'mixed';
  let max = -1;
  for (const k in tally) {
    if (tally[k] > max) { max = tally[k]; dominant = k; }
  }
  // If sanity is critical, bias toward "losing"
  if (summary.sanityAfter <= 25) dominant = 'losing';

  const pool = FALLBACK_LIBRARY[dominant] ?? FALLBACK_LIBRARY.mixed;
  const entry = pick(pool);

  return {
    monologue: entry.monologue,
    lesson: [...entry.lesson],
    next_strategy: { ...entry.next, skill_priority: [...entry.next.skill_priority], preferred_kinds: [...entry.next.preferred_kinds] },
    fromLLM: false,
  };
}

// ===================== Vignette fallback =====================

const VIGNETTES: VignetteContext[] = [
  {
    patientName: '林晚',
    night: 1,
    emotion: '焦虑',
    hint: '今晚的她在凌晨两点醒过三次，每次都觉得自己漏了什么重要的事情。她希望你，不要让那些声音再追到她耳边。',
  },
  {
    patientName: '林晚',
    night: 2,
    emotion: '抑郁',
    hint: '她躺了一整天，没拉开窗帘。心里有一片湿冷的雾，慢慢往她最在意的人身上漫。请别让那些雾，盖住她还想回应的那个名字。',
  },
  {
    patientName: '林晚',
    night: 3,
    emotion: '强迫',
    hint: '她从下午开始反复回想三年前的一次会议，已经在脑里重演了 47 遍。她需要你帮她，把那张磁带按停。',
  },
  {
    patientName: '林晚',
    night: 4,
    emotion: '自责',
    hint: '她接到母亲的电话，挂掉之后第一反应是道歉。她说，"我也不知道我在道什么歉"。请把伪装成善意的影子认出来。',
  },
  {
    patientName: '林晚',
    night: 5,
    emotion: '焦虑·临界',
    hint: '今晚她要见那个人。她在镜子前练了 30 遍开场白。她意识到——她真正怕的，不是说错，而是被认真听。',
  },
  {
    patientName: '林晚',
    night: 6,
    emotion: '抑郁·复发',
    hint: '昨晚的对峙没有想象中惨烈，但今天她比昨晚更累。她说"我撑不住的时候，请帮我多撑一会儿"。',
  },
  {
    patientName: '林晚',
    night: 7,
    emotion: '回忆',
    hint: '她梦到了七岁的自己。一个安静地坐在饭桌角落、把碗里的肉夹给弟弟的小女孩。她没哭，只说了句：辛苦你了。',
  },
  {
    patientName: '林晚',
    night: 8,
    emotion: '混合',
    hint: '今晚的潜意识不再分类——焦虑披着抑郁的外套，强迫和自责手挽着手。但她也变得不那么害怕"看见它们"了。',
  },
  {
    patientName: '林晚',
    night: 9,
    emotion: '动摇',
    hint: '她差一点就把那段录音删了。她想问你：那些"不被看见的痛"，到底要不要被自己看见？',
  },
  {
    patientName: '林晚',
    night: 10,
    emotion: '执念·终',
    hint: '所有故事都要面对那个最深的房间。她答应过自己，今晚一定要进去——但她需要你陪着，一起。',
  },
];

export function fallbackVignette(night: number): VignetteContext {
  return VIGNETTES[(night - 1) % VIGNETTES.length];
}

// ===================== Boss negotiation library =====================

export const BOSS_PERSONAS: Record<number, BossPersona> = {
  5: {
    id: 'anxiety_core',
    displayName: '焦虑之核',
    kindHint: 'anxiety',
    emoji: '✦',
    description: '由所有"如果……怎么办"汇聚而成的中央枢纽，会用最理性的语气说最折磨人的话。',
    baseHp: 800,
    baseSpeed: 22,
  },
  10: {
    id: 'final_obsession',
    displayName: '执念',
    kindHint: 'obsession',
    emoji: '✺',
    description: '她为自己设的最深的房间——把所有"我本来可以"封存在里面，从不开门。',
    baseHp: 1400,
    baseSpeed: 18,
  },
};

const FALLBACK_DIALOGUES: Record<number, DialogueTurn[]> = {
  5: [
    {
      bossLine: '你来了。我等你很久了。\n\n我并不是来伤害她的——我只是想确认，她准备好了。',
      choices: [
        { text: '我懂你。你是怕她再受一次伤，所以宁愿先吓住她。', tag: 'empathy' },
        { text: '你假装是保护，其实是控制。让开。', tag: 'confront' },
        { text: '是的，她还没准备好。所以你先放过她，下一次再说。', tag: 'deceive' },
      ],
    },
    {
      bossLine: '你那么会说话——也许你比我更懂她。\n\n那就告诉我：如果今晚她又面对那个场景，我应不应该把她叫醒？',
      choices: [
        { text: '不需要叫醒她，她已经能从噩梦里自己走出来。', tag: 'empathy' },
        { text: '叫醒她是你的工作？她的事不需要你越权。', tag: 'confront' },
        { text: '你叫醒她吧。这样她会感谢你。', tag: 'deceive' },
      ],
    },
  ],
  10: [
    {
      bossLine: '门是从里面锁的。\n你以为打开它就是治愈，可你没问过那个把它锁上的小女孩——\n\n她，愿不愿意被人看到？',
      choices: [
        { text: '我们可以陪她在门里坐一会儿，不一定要立刻打开。', tag: 'empathy' },
        { text: '一直锁着，她就一直困在里面。该开了。', tag: 'confront' },
        { text: '门可以暂时不开。但这一晚我们要先把这层走廊清空。', tag: 'deceive' },
      ],
    },
    {
      bossLine: '如果……我说"我撑不住"会怎么样？\n\n你们这些「治愈者」，是不是只爱那个能笑着治愈的版本的我？',
      choices: [
        { text: '我爱你撑不住的那一版。她比谁都勇敢。', tag: 'empathy' },
        { text: '撑不住就先放下来，没人要你扛。', tag: 'confront' },
        { text: '你撑不住也没关系，但请先让我们走完这一晚。', tag: 'deceive' },
      ],
    },
  ],
};

export function fallbackDialogue(waveIndex: number, turn: number): DialogueTurn {
  const set = FALLBACK_DIALOGUES[waveIndex] ?? FALLBACK_DIALOGUES[5];
  return set[Math.min(turn, set.length - 1)];
}

export function totalDialogueTurns(waveIndex: number): number {
  return (FALLBACK_DIALOGUES[waveIndex] ?? FALLBACK_DIALOGUES[5]).length;
}

// Choices map to combat parameters. Aggregated across turns.
export function applyChoiceTag(
  resolution: NegotiationResolution,
  tag: ChoiceTag,
): NegotiationResolution {
  const next = { ...resolution };
  switch (tag) {
    case 'empathy':
      next.hpMul *= 0.78;
      next.damageMul *= 0.85;
      next.specialNote = '共情之路：Boss 攻防均下降';
      next.endingTag = 'empathy';
      break;
    case 'confront':
      next.hpMul *= 1.15;
      next.damageMul *= 1.2;
      next.speedMul *= 1.1;
      next.specialNote = '对峙之路：Boss 全面狂暴';
      next.endingTag = 'confront';
      break;
    case 'deceive':
      next.hpMul *= 0.92;
      next.damageMul *= 1.05;
      next.speedMul *= 0.92;
      next.specialNote = '诱导之路：Boss 行动迟疑但偶尔暴击';
      next.endingTag = 'deceive';
      break;
  }
  return next;
}

export const NEUTRAL_RESOLUTION: NegotiationResolution = {
  hpMul: 1,
  speedMul: 1,
  damageMul: 1,
  specialNote: '未谈判：Boss 默认参数',
  endingTag: 'confront',
};
