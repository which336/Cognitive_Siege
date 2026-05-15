import { LevelSpec, WaveSpec } from '../../types';

// 手工调好的基础波次表。EvolutionApplier 会根据 LLM 的 next_strategy
// 改写路线倾向、阵型、技能和心魔种类。
export const TOTAL_WAVES = 10;
export const DEFAULT_LEVEL_ID = 'level_1';

let configuredLevelSpecs: LevelSpec[] | null = null;

export function setConfiguredBaseWaves(waves: WaveSpec[]): void {
  configuredLevelSpecs = [makeDefaultLevelSpec(cloneWaves(waves))];
}

export function setConfiguredLevelSpecs(levels: LevelSpec[]): void {
  configuredLevelSpecs = cloneLevels(levels);
}

function cloneWaves(waves: WaveSpec[]): WaveSpec[] {
  return waves.map((wave) => ({
    ...wave,
    spawns: wave.spawns.map((spawn) => ({
      ...spawn,
      skills: [...spawn.skills],
    })),
  }));
}

function cloneLevels(levels: LevelSpec[]): LevelSpec[] {
  return levels.map((level) => ({
    ...level,
    waves: cloneWaves(level.waves),
  }));
}

function makeDefaultLevelSpec(waves: WaveSpec[]): LevelSpec {
  return {
    id: DEFAULT_LEVEL_ID,
    name: '失眠首夜',
    theme: '基础教学',
    rule: 'tutorial',
    globalHpMul: 1,
    globalSpeedMul: 1,
    mindGiftMul: 1,
    waves,
  };
}

export function getLevelSpecs(): LevelSpec[] {
  return cloneLevels(configuredLevelSpecs ?? [makeDefaultLevelSpec(buildDefaultWaves())]);
}

export function getLevelSpec(levelId = DEFAULT_LEVEL_ID): LevelSpec {
  const levels = getLevelSpecs();
  return levels.find((level) => level.id === levelId) ?? levels[0];
}

export function buildBaseWaves(levelId = DEFAULT_LEVEL_ID): WaveSpec[] {
  return getLevelSpec(levelId).waves;
}

function buildDefaultWaves(): WaveSpec[] {

  const w: WaveSpec[] = [];

  // 第 1 波：教学波，单路线焦虑，便于玩家读懂基础节奏。
  w.push({
    index: 1,
    isBoss: false,
    formation: 'scattered',
    mindGift: 0,
    spawns: Array.from({ length: 5 }, (_, i) => ({
      kind: 'anxiety' as const,
      delayMs: 900 + i * 900,
      hpMul: 0.85,
      speedMul: 0.9,
      pathBias: 'short' as const,
      skills: [],
    })),
  });

  // 第 2 波：焦虑 + 首次抑郁。保持容错，避免玩家第一波放错后直接崩盘。
  w.push({
    index: 2,
    isBoss: false,
    formation: 'scattered',
    mindGift: 20,
    spawns: [
      ...Array.from({ length: 4 }, (_, i) => ({
        kind: 'anxiety' as const,
        delayMs: 800 + i * 750,
        hpMul: 0.95,
        speedMul: 0.95,
        pathBias: 'short' as const,
        skills: [],
      })),
      { kind: 'depression', delayMs: 5200, hpMul: 0.9, speedMul: 1, pathBias: 'short', skills: [] },
      { kind: 'depression', delayMs: 7600, hpMul: 0.9, speedMul: 1, pathBias: 'short', skills: [] },
    ],
  });

  // 第 3 波：引入强迫反刍。
  w.push({
    index: 3,
    isBoss: false,
    formation: 'scattered',
    mindGift: 18,
    spawns: [
      ...Array.from({ length: 3 }, (_, i) => ({
        kind: 'obsession' as const,
        delayMs: 900 + i * 1100,
        hpMul: 0.95,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: [],
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        kind: 'anxiety' as const,
        delayMs: 1600 + i * 750,
        hpMul: 1,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: [],
      })),
    ],
  });

  // 第 4 波：引入自责伪装。
  w.push({
    index: 4,
    isBoss: false,
    formation: 'scattered',
    mindGift: 22,
    spawns: [
      ...Array.from({ length: 2 }, (_, i) => ({
        kind: 'guilt' as const,
        delayMs: 1500 + i * 1500,
        hpMul: 0.95,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: ['stealth'] as ('stealth' | 'swarm' | 'rush' | 'split' | 'taunt' | 'shield')[],
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        kind: 'anxiety' as const,
        delayMs: 900 + i * 700,
        hpMul: 1.05,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: [],
      })),
      { kind: 'depression', delayMs: 6800, hpMul: 1, speedMul: 1, pathBias: 'short', skills: [] },
    ],
  });

  // 第 5 波：BOSS 焦虑之核（带谈判）+ 普通掩护单位。
  w.push({
    index: 5,
    isBoss: true,
    formation: 'wedge',
    mindGift: 20,
    spawns: [
      ...Array.from({ length: 4 }, (_, i) => ({
        kind: 'anxiety' as const,
        delayMs: 800 + i * 500,
        hpMul: 1.2,
        speedMul: 1.1,
        pathBias: 'short' as const,
        skills: ['rush'] as ('stealth' | 'swarm' | 'rush' | 'split' | 'taunt' | 'shield')[],
      })),
      // Boss 复用 anxiety 类型，但用超高 hpMul 和技能标记区分。
      { kind: 'anxiety', delayMs: 4000, hpMul: 14, speedMul: 0.7, pathBias: 'short', skills: ['shield'] },
    ],
  });

  // 第 6 波：Boss 后余震，引入创伤闪回。
  w.push({
    index: 6,
    isBoss: false,
    formation: 'clustered',
    mindGift: 16,
    spawns: [
      ...Array.from({ length: 4 }, (_, i) => ({
        kind: 'depression' as const,
        delayMs: 700 + i * 1000,
        hpMul: 1.05,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: [],
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        kind: 'obsession' as const,
        delayMs: 1100 + i * 1300,
        hpMul: 1.1,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: [],
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        kind: 'ptsd' as const,
        delayMs: 3600 + i * 1500,
        hpMul: 0.9,
        speedMul: 1,
        pathBias: 'edge' as const,
        skills: [],
      })),
    ],
  });

  // 第 7 波：创伤进入常规压力组成。
  w.push({
    index: 7,
    isBoss: false,
    formation: 'scattered',
    mindGift: 18,
    spawns: [
      ...Array.from({ length: 3 }, (_, i) => ({
        kind: 'ptsd' as const,
        delayMs: 900 + i * 1300,
        hpMul: 1,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: [],
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        kind: 'guilt' as const,
        delayMs: 800 + i * 900,
        hpMul: 1.1,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: ['stealth'] as ('stealth' | 'swarm' | 'rush' | 'split' | 'taunt' | 'shield')[],
      })),
    ],
  });

  // 第 8 波：多类型混合压力。
  w.push({
    index: 8,
    isBoss: false,
    formation: 'scattered',
    mindGift: 16,
    spawns: [
      ...Array.from({ length: 4 }, (_, i) => ({
        kind: 'anxiety' as const,
        delayMs: 500 + i * 450,
        hpMul: 1.2,
        speedMul: 1.1,
        pathBias: 'short' as const,
        skills: [],
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        kind: 'depression' as const,
        delayMs: 1200 + i * 1100,
        hpMul: 1.15,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: [],
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        kind: 'obsession' as const,
        delayMs: 800 + i * 1000,
        hpMul: 1.15,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: [],
      })),
      { kind: 'guilt', delayMs: 4000, hpMul: 1.2, speedMul: 1, pathBias: 'short', skills: ['stealth'] },
      { kind: 'guilt', delayMs: 6500, hpMul: 1.2, speedMul: 1, pathBias: 'short', skills: ['stealth'] },
    ],
  });

  // 第 9 波：终战前的集群压力。
  w.push({
    index: 9,
    isBoss: false,
    formation: 'clustered',
    mindGift: 16,
    spawns: [
      ...Array.from({ length: 7 }, (_, i) => ({
        kind: 'anxiety' as const,
        delayMs: 400 + i * 350,
        hpMul: 1.25,
        speedMul: 1.15,
        pathBias: 'short' as const,
        skills: ['swarm'] as ('stealth' | 'swarm' | 'rush' | 'split' | 'taunt' | 'shield')[],
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        kind: 'ptsd' as const,
        delayMs: 1100 + i * 1100,
        hpMul: 1.1,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: [],
      })),
    ],
  });

  // 第 10 波：BOSS 强迫“执念”。
  w.push({
    index: 10,
    isBoss: true,
    formation: 'rear_first',
    mindGift: 20,
    spawns: [
      ...Array.from({ length: 5 }, (_, i) => ({
        kind: 'obsession' as const,
        delayMs: 600 + i * 500,
        hpMul: 1.3,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: [],
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        kind: 'guilt' as const,
        delayMs: 1100 + i * 900,
        hpMul: 1.3,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: ['stealth'] as ('stealth' | 'swarm' | 'rush' | 'split' | 'taunt' | 'shield')[],
      })),
      // 终局 Boss。
      { kind: 'obsession', delayMs: 5000, hpMul: 22, speedMul: 0.6, pathBias: 'short', skills: ['shield'] },
    ],
  });

  return w;
}
