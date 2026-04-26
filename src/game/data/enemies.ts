import { EnemyKind } from '../../types';

export interface EnemyDef {
  kind: EnemyKind;
  displayName: string;
  emoji: string;
  // Base stats. Final stats apply spec multipliers from waves.
  hp: number;
  speed: number; // pixels per second (pre-multiplier)
  bounty: number; // mind power on kill
  damage: number; // sanity damage on reach
  // Visual color (tinted on a generic disc sprite)
  color: number;
  // Distinct behavior tag interpreted by Enemy.update()
  behavior:
    | 'rush'        // anxiety: prefers shortest path, fast
    | 'aura'        // depression: slow, debuffs nearby tower fire rate
    | 'loop'        // obsession: occasionally backtracks N tiles
    | 'cloak'       // guilt: invisible until detected; minor damage if reaches
    | 'flicker';    // ptsd (boss-supporting): teleports forward on damage
  // Localized description used in help/UI
  desc: string;
  // Approx radius
  radius: number;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  anxiety: {
    kind: 'anxiety',
    displayName: '焦虑·疾走者',
    emoji: '⚡',
    hp: 28,
    speed: 78,
    bounty: 8,
    damage: 4,
    color: 0xfb7185,
    behavior: 'rush',
    desc: '心跳过速的薄影，永远奔向最短的退路。血量低、速度极快，怕范围伤害。',
    radius: 12,
  },
  depression: {
    kind: 'depression',
    displayName: '抑郁·重雾',
    emoji: '☁',
    hp: 90,
    speed: 28,
    bounty: 14,
    damage: 8,
    color: 0x6366f1,
    behavior: 'aura',
    desc: '湿冷的重雾，缓慢前行；近旁念头塔射速降低 40%。需要爆发性单体伤害。',
    radius: 18,
  },
  obsession: {
    kind: 'obsession',
    displayName: '强迫·循环者',
    emoji: '◯',
    hp: 50,
    speed: 50,
    bounty: 12,
    damage: 5,
    color: 0xfde68a,
    behavior: 'loop',
    desc:
      '反复回头确认的执念。每隔一段路会倒退一格"复习"，' +
      '回头瞬间向半径约 3 格内的所有同伴释放金色光芒，使其获得 +20% 移速 1.2 秒——' +
      '它在的时候，整条战线都会被它的节奏带快。BOSS 形态不会回头。',
    radius: 14,
  },
  guilt: {
    kind: 'guilt',
    displayName: '自责·伪装者',
    emoji: '✦',
    hp: 36,
    speed: 44,
    bounty: 16,
    damage: 6,
    color: 0xa78bfa,
    behavior: 'cloak',
    desc: '披着善意外衣的影子，对未配置共鸣塔的玩家近乎隐形。共鸣塔可揭穿伪装。',
    radius: 13,
  },
  ptsd: {
    kind: 'ptsd',
    displayName: '创伤·闪回',
    emoji: '✺',
    hp: 70,
    speed: 36,
    bounty: 20,
    damage: 10,
    color: 0xf472b6,
    behavior: 'flicker',
    desc: '受伤瞬间会向前闪现两格的旧记忆碎片，难以围堵。',
    radius: 14,
  },
};

export const ALL_ENEMY_KINDS: EnemyKind[] = ['anxiety', 'depression', 'obsession', 'guilt', 'ptsd'];
