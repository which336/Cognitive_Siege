import { TowerKind } from '../../types';

export interface TowerDef {
  kind: TowerKind;
  displayName: string;
  emoji: string;
  cost: number;
  // L1 stats. Upgrades multiply.
  range: number;       // pixels
  fireRate: number;    // shots per second
  damage: number;
  splashRadius: number; // 0 = single target
  color: number;
  // Special tag handled in tower update logic
  special: 'aoe' | 'single' | 'slow_reveal' | 'support' | 'percent_current' | 'blocker';
  placement: 'build' | 'path';
  percentCurrentHp?: number;
  blockHp?: number;
  desc: string;
  radius: number;
}

export const TOWER_DEFS: Record<TowerKind, TowerDef> = {
  memory: {
    kind: 'memory',
    displayName: '美好回忆塔',
    emoji: '✿',
    cost: 30,
    range: 110,
    fireRate: 0.9,
    damage: 14,
    splashRadius: 36,
    color: 0xfde68a,
    special: 'aoe',
    placement: 'build',
    desc: '一段温暖回忆，对范围内所有敌人造成伤害。克制密集编队的焦虑潮。',
    radius: 16,
  },
  belief: {
    kind: 'belief',
    displayName: '信念塔',
    emoji: '☼',
    cost: 50,
    range: 160,
    fireRate: 0.55,
    damage: 48,
    splashRadius: 0,
    color: 0xf472b6,
    special: 'single',
    placement: 'build',
    desc: '坚定的核心信念，单体高伤、慢射速。专破抑郁重雾的高血量。',
    radius: 16,
  },
  resonance: {
    kind: 'resonance',
    displayName: '共鸣塔',
    emoji: '◈',
    cost: 40,
    range: 130,
    fireRate: 1.4,
    damage: 6,
    splashRadius: 0,
    color: 0x67e8f9,
    special: 'slow_reveal',
    placement: 'build',
    desc: '与心魔共振——减速 35%、揭穿伪装、降低自身命中焦虑。低伤害但战略价值高。',
    radius: 16,
  },
  acceptance: {
    kind: 'acceptance',
    displayName: '自我接纳塔',
    emoji: '❀',
    cost: 60,
    range: 0,
    fireRate: 0.3,
    damage: 0,
    splashRadius: 0,
    color: 0x34d399,
    special: 'support',
    placement: 'build',
    desc: '一种安住的力量，缓慢回复理智值，并在半径内驱散心魔光环。生存命脉，但无法单独抹平后期压力。',
    radius: 16,
  },
  insight: {
    kind: 'insight',
    displayName: '洞察塔',
    emoji: '◇',
    cost: 70,
    range: 145,
    fireRate: 0.72,
    damage: 0,
    splashRadius: 0,
    color: 0xc4b5fd,
    special: 'percent_current',
    placement: 'build',
    percentCurrentHp: 0.18,
    desc: '没有固定伤害，只剥离目标当前生命值的一部分。越厚重的心魔越怕被看见。',
    radius: 16,
  },
  boundary: {
    kind: 'boundary',
    displayName: '边界桩',
    emoji: '▣',
    cost: 60,
    range: 0,
    fireRate: 0,
    damage: 0,
    splashRadius: 0,
    color: 0x9fe870,
    special: 'blocker',
    placement: 'path',
    blockHp: 75,
    desc: '只能种在路线上的肉盾塔。没有攻击力，会短暂挡住心魔，直到耐久归零后消失。',
    radius: 17,
  },
};

export const ALL_TOWER_KINDS: TowerKind[] = ['memory', 'belief', 'resonance', 'acceptance', 'insight', 'boundary'];
