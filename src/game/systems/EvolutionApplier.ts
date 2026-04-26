import {
  EnemyKind,
  NextStrategy,
  WaveSpec,
  EnemySpawnSpec,
  Formation,
  PathBias,
} from '../../types';

/**
 * Applies a NextStrategy from the review agent to a base WaveSpec.
 *
 * Mutations:
 *  - path_weight_shift overrides each spawn's pathBias (the wave system
 *    consults this when picking which path variant to follow)
 *  - formation overrides spawn timing pattern (clustered = burst, scattered = even)
 *  - skill_priority adds tags to spawns probabilistically
 *  - aggression scales hp/speed multipliers and shrinks delays
 *  - preferred_kinds replaces a fraction of "filler" spawns with the listed kinds
 *    while preserving any boss spawns (large hpMul) intact
 */
export interface ApplyResult {
  applied: WaveSpec;
  changes: string[]; // human-readable list shown in the review UI / next-wave preview
}

const isBossSpawn = (s: EnemySpawnSpec): boolean => s.hpMul >= 5;

export function applyStrategy(base: WaveSpec, strat: NextStrategy): ApplyResult {
  const changes: string[] = [];
  const cloned: WaveSpec = {
    ...base,
    spawns: base.spawns.map(s => ({ ...s, skills: [...s.skills] })),
  };

  // 1) Path bias
  if (cloned.spawns[0]?.pathBias !== strat.path_weight_shift) {
    for (const s of cloned.spawns) {
      if (!isBossSpawn(s)) s.pathBias = strat.path_weight_shift;
    }
    changes.push(pathBiasLabel(strat.path_weight_shift));
  }

  // 2) Formation -> rewrite delays
  applyFormation(cloned, strat.formation);
  changes.push(formationLabel(strat.formation));

  // 3) Skill priority -> tag a fraction of spawns
  if (strat.skill_priority.length) {
    const stamp = strat.skill_priority.slice(0, 2);
    let tagged = 0;
    for (const s of cloned.spawns) {
      if (isBossSpawn(s)) continue;
      // 60% of non-boss spawns get the new tags
      if (Math.random() < 0.6) {
        for (const t of stamp) if (!s.skills.includes(t)) s.skills.push(t);
        tagged++;
      }
    }
    if (tagged) changes.push(`${tagged} 个心魔学到 [${stamp.join('/')}] 技能`);
  }

  // 4) Aggression scales
  const a = strat.aggression;
  // map -1..1 -> hp 0.85..1.25 ; speed 0.9..1.2 ; delay 1.25..0.7
  const hpMulX = 1 + 0.2 * a;
  const spdMulX = 1 + 0.15 * a;
  const delayX = 1 - 0.3 * a;
  for (const s of cloned.spawns) {
    if (isBossSpawn(s)) continue;
    s.hpMul = +(s.hpMul * hpMulX).toFixed(3);
    s.speedMul = +(s.speedMul * spdMulX).toFixed(3);
    s.delayMs = Math.max(150, Math.round(s.delayMs * delayX));
  }
  if (Math.abs(a) > 0.25) {
    changes.push(a > 0 ? `攻势加剧 (+${Math.round(a * 100)}%)` : `转入潜伏 (${Math.round(a * 100)}%)`);
  }

  // 5) Preferred kinds -> swap some non-boss spawns
  if (strat.preferred_kinds.length) {
    const fillerIdx: number[] = [];
    cloned.spawns.forEach((s, i) => { if (!isBossSpawn(s)) fillerIdx.push(i); });
    const swapCount = Math.min(fillerIdx.length, Math.ceil(fillerIdx.length * 0.45));
    const swapped: Record<EnemyKind, number> = {
      anxiety: 0, depression: 0, obsession: 0, guilt: 0, ptsd: 0,
    };
    for (let n = 0; n < swapCount; n++) {
      const pickIdx = fillerIdx[Math.floor(Math.random() * fillerIdx.length)];
      const newKind = strat.preferred_kinds[n % strat.preferred_kinds.length];
      cloned.spawns[pickIdx].kind = newKind;
      swapped[newKind]++;
    }
    const list = Object.entries(swapped)
      .filter(([_, n]) => n > 0)
      .map(([k, n]) => `${kindLabel(k as EnemyKind)}×${n}`)
      .join(' / ');
    if (list) changes.push(`阵容变化：${list}`);
  }

  return { applied: cloned, changes };
}

function applyFormation(w: WaveSpec, f: Formation): void {
  const fillers = w.spawns.filter(s => !isBossSpawn(s));
  const baseStart = fillers.length ? Math.min(...fillers.map(s => s.delayMs)) : 600;
  const totalSpan = fillers.length ? Math.max(...fillers.map(s => s.delayMs)) - baseStart : 4000;

  switch (f) {
    case 'clustered': {
      // tight bursts of 3 with gaps
      fillers.sort((a, b) => a.delayMs - b.delayMs);
      let t = baseStart;
      for (let i = 0; i < fillers.length; i++) {
        fillers[i].delayMs = t;
        if ((i + 1) % 3 === 0) t += 1400;
        else t += 200;
      }
      break;
    }
    case 'scattered': {
      // even spread across the same total span
      fillers.sort((a, b) => a.delayMs - b.delayMs);
      const step = fillers.length > 1 ? totalSpan / (fillers.length - 1) : 0;
      fillers.forEach((s, i) => { s.delayMs = Math.round(baseStart + i * step); });
      break;
    }
    case 'wedge': {
      // accelerating spawns
      fillers.sort((a, b) => a.delayMs - b.delayMs);
      let t = baseStart;
      let gap = Math.max(220, Math.round(totalSpan / Math.max(1, fillers.length) * 1.1));
      for (let i = 0; i < fillers.length; i++) {
        fillers[i].delayMs = t;
        t += gap;
        gap = Math.max(180, Math.round(gap * 0.92));
      }
      break;
    }
    case 'rear_first': {
      // reverse order: heaviest first
      fillers.sort((a, b) => (b.hpMul - a.hpMul) || (a.delayMs - b.delayMs));
      let t = baseStart;
      for (let i = 0; i < fillers.length; i++) {
        fillers[i].delayMs = t;
        t += 600 + Math.round(Math.random() * 200);
      }
      break;
    }
  }
}

function pathBiasLabel(b: PathBias): string {
  return ({
    short: '改走最短路径',
    long: '绕远路探防线',
    edge: '贴边迂回',
    center: '正面强突',
    random: '路径混乱化',
  } as Record<PathBias, string>)[b];
}

function formationLabel(f: Formation): string {
  return ({
    scattered: '散兵线推进',
    clustered: '密集成团',
    wedge: '楔形加速',
    rear_first: '重型先行',
  } as Record<Formation, string>)[f];
}

function kindLabel(k: EnemyKind): string {
  return ({
    anxiety: '焦虑',
    depression: '抑郁',
    obsession: '强迫',
    guilt: '自责',
    ptsd: '创伤',
  } as Record<EnemyKind, string>)[k];
}
