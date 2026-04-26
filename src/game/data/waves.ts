import { WaveSpec } from '../../types';

// Hand-tuned base wave book. The Evolution Applier mutates these in place
// (path bias / formation / skills / kinds) based on LLM next_strategy.
export const TOTAL_WAVES = 10;

export function buildBaseWaves(): WaveSpec[] {
  const w: WaveSpec[] = [];

  // Wave 1: tutorial - 6 anxiety
  w.push({
    index: 1,
    isBoss: false,
    formation: 'scattered',
    mindGift: 0,
    spawns: Array.from({ length: 6 }, (_, i) => ({
      kind: 'anxiety' as const,
      delayMs: 800 + i * 700,
      hpMul: 1,
      speedMul: 1,
      pathBias: 'short' as const,
      skills: [],
    })),
  });

  // Wave 2: anxiety + first depression
  w.push({
    index: 2,
    isBoss: false,
    formation: 'scattered',
    mindGift: 8,
    spawns: [
      ...Array.from({ length: 5 }, (_, i) => ({
        kind: 'anxiety' as const,
        delayMs: 600 + i * 600,
        hpMul: 1.05,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: [],
      })),
      { kind: 'depression', delayMs: 4500, hpMul: 1, speedMul: 1, pathBias: 'short', skills: [] },
      { kind: 'depression', delayMs: 6500, hpMul: 1, speedMul: 1, pathBias: 'short', skills: [] },
    ],
  });

  // Wave 3: introduce obsession
  w.push({
    index: 3,
    isBoss: false,
    formation: 'scattered',
    mindGift: 12,
    spawns: [
      ...Array.from({ length: 4 }, (_, i) => ({
        kind: 'obsession' as const,
        delayMs: 700 + i * 900,
        hpMul: 1,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: [],
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        kind: 'anxiety' as const,
        delayMs: 1300 + i * 600,
        hpMul: 1.1,
        speedMul: 1.05,
        pathBias: 'short' as const,
        skills: [],
      })),
    ],
  });

  // Wave 4: introduce guilt (cloak)
  w.push({
    index: 4,
    isBoss: false,
    formation: 'scattered',
    mindGift: 14,
    spawns: [
      ...Array.from({ length: 3 }, (_, i) => ({
        kind: 'guilt' as const,
        delayMs: 1200 + i * 1200,
        hpMul: 1,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: ['stealth'] as ('stealth' | 'swarm' | 'rush' | 'split' | 'taunt' | 'shield')[],
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        kind: 'anxiety' as const,
        delayMs: 600 + i * 600,
        hpMul: 1.15,
        speedMul: 1.05,
        pathBias: 'short' as const,
        skills: [],
      })),
      { kind: 'depression', delayMs: 5500, hpMul: 1.1, speedMul: 1, pathBias: 'short', skills: [] },
    ],
  });

  // Wave 5: BOSS — Anxiety Core (negotiation) + filler
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
      // Boss enemy uses kind anxiety with massive hp; flagged via skills.
      { kind: 'anxiety', delayMs: 4000, hpMul: 14, speedMul: 0.7, pathBias: 'short', skills: ['shield'] },
    ],
  });

  // Wave 6: aftershock - mostly depression (LLM may rebalance)
  w.push({
    index: 6,
    isBoss: false,
    formation: 'clustered',
    mindGift: 16,
    spawns: [
      ...Array.from({ length: 5 }, (_, i) => ({
        kind: 'depression' as const,
        delayMs: 700 + i * 1000,
        hpMul: 1.05,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: [],
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        kind: 'obsession' as const,
        delayMs: 1100 + i * 1300,
        hpMul: 1.1,
        speedMul: 1,
        pathBias: 'short' as const,
        skills: [],
      })),
    ],
  });

  // Wave 7: introduce ptsd
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

  // Wave 8: mixed pressure
  w.push({
    index: 8,
    isBoss: false,
    formation: 'scattered',
    mindGift: 20,
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

  // Wave 9: pre-final swarm
  w.push({
    index: 9,
    isBoss: false,
    formation: 'clustered',
    mindGift: 22,
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

  // Wave 10: BOSS — Obsession "执念"
  w.push({
    index: 10,
    isBoss: true,
    formation: 'rear_first',
    mindGift: 30,
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
      // Final boss
      { kind: 'obsession', delayMs: 5000, hpMul: 22, speedMul: 0.6, pathBias: 'short', skills: ['shield'] },
    ],
  });

  return w;
}
