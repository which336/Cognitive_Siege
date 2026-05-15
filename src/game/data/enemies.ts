import { EnemyKind } from '../../types';

export interface EnemyDef {
  kind: EnemyKind;
  displayName: string;
  emoji: string;
  // 基础数值；最终数值会再乘以波次刷怪倍率。
  hp: number;
  speed: number; // 基础像素/秒。
  bounty: number; // 击杀后获得的念力。
  damage: number; // 抵达核心时造成的理智伤害。
  // 通用圆形表现的染色。
  color: number;
  // Enemy.update() 中解释的独特行为标签。
  behavior:
    | 'rush'        // 焦虑：偏好短路，速度快。
    | 'aura'        // 抑郁：移动慢，削弱附近塔射速。
    | 'loop'        // 强迫：周期性后退若干距离。
    | 'cloak'       // 自责：被发现前隐身，漏怪伤害较低。
    | 'flicker';    // 创伤：受击后向前闪烁。
  // 帮助面板和 UI 使用的本地化描述。
  desc: string;
  // 近似碰撞/表现半径。
  radius: number;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  anxiety: {
    kind: 'anxiety',
    displayName: '焦虑·疾走者',
    emoji: '⚡',
    hp: 28,
    speed: 78,
    bounty: 6,
    damage: 4,
    color: 0xfb7185,
    behavior: 'rush',
    desc: '心跳过速的薄影，偏好短快主干，其次会贴边突进。血量低、速度极快，怕范围伤害。',
    radius: 12,
  },
  depression: {
    kind: 'depression',
    displayName: '抑郁·重雾',
    emoji: '☁',
    hp: 90,
    speed: 28,
    bounty: 10,
    damage: 8,
    color: 0x6366f1,
    behavior: 'aura',
    desc: '湿冷的重雾，偏好长绕路线拖慢防线；近旁念头塔射速降低 40%。需要爆发性单体伤害。',
    radius: 18,
  },
  obsession: {
    kind: 'obsession',
    displayName: '强迫·循环者',
    emoji: '◯',
    hp: 50,
    speed: 50,
    bounty: 9,
    damage: 5,
    color: 0xfde68a,
    behavior: 'loop',
    desc:
      '反复回头确认的执念，偏好边偷路线。每隔一段路会倒退一格"复习"，' +
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
    bounty: 12,
    damage: 6,
    color: 0xa78bfa,
    behavior: 'cloak',
    desc: '披着善意外衣的影子，偏好长绕或贴边渗透；对未配置共鸣塔的玩家近乎隐形。共鸣塔可揭穿伪装。',
    radius: 13,
  },
  ptsd: {
    kind: 'ptsd',
    displayName: '创伤·闪回',
    emoji: '✺',
    hp: 70,
    speed: 36,
    bounty: 15,
    damage: 10,
    color: 0xf472b6,
    behavior: 'flicker',
    desc: '受伤瞬间会向前闪现两格的旧记忆碎片，偏好边偷路线，其次长绕，难以围堵。',
    radius: 14,
  },
};

export const ALL_ENEMY_KINDS: EnemyKind[] = ['anxiety', 'depression', 'obsession', 'guilt', 'ptsd'];
