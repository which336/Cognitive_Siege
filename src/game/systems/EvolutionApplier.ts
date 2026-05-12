import {
  EnemyKind,
  NextStrategy,
  WaveSpec,
  EnemySpawnSpec,
  Formation,
  PathBias,
  SkillFlag,
} from '../../types';
import {
  clampAggressionForWave,
  getAllowedEnemyKindsForWave,
  getAllowedSkillsForWave,
} from '../data/configLoader';

/**
 * Applies a NextStrategy from the review agent to a base WaveSpec.
 *
 * Mutations:
 *  - path_weight_shift overrides each spawn's pathBias. The wave system treats
 *    that as a strong route weight, then mixes in enemy route personality and
 *    a small amount of per-spawn randomness.
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

const KIND_FRONT_RANK: Record<EnemyKind, number> = {
  depression: 50,
  anxiety: 42,
  obsession: 34,
  guilt: 24,
  ptsd: 18,
};

export function applyStrategy(base: WaveSpec, strat: NextStrategy): ApplyResult {
  const changes: string[] = [];
  const cloned: WaveSpec = {
    ...base,
    formation: strat.formation,
    spawns: base.spawns.map(s => ({ ...s, skills: [...s.skills] })),
  };

  // 1) Path bias. Boss identity/stats stay intact, and the active route is part
  // of the wave projection. Individual spawns still make weighted route picks
  // at runtime so a wave can split across open branches.
  if (cloned.spawns[0]?.pathBias !== strat.path_weight_shift) {
    for (const s of cloned.spawns) {
      s.pathBias = strat.path_weight_shift;
    }
    changes.push(pathBiasLabel(strat.path_weight_shift));
  }

  // 2) Reinforce later waves before timing is assigned. Pressure should come
  // from more bodies and better composition, not only higher stats.
  const added = cloned.index >= 5 ? reinforceWave(cloned, strat) : 0;
  if (added > 0) changes.push(`增援单位 +${added}`);

  // 3) Skill priority -> tag a fraction of spawns
  const allowedSkills = getAllowedSkillsForWave(cloned.index, strat.skill_priority);
  if (allowedSkills.length) {
    const stamp = allowedSkills.slice(0, 2);
    let tagged = 0;
    for (const s of cloned.spawns) {
      if (isBossSpawn(s)) continue;
      const chance = cloned.index <= 4 ? 0.28 : 0.6;
      if (Math.random() < chance) {
        for (const t of stamp) if (!s.skills.includes(t)) s.skills.push(t);
        tagged++;
      }
    }
    if (tagged) changes.push(`${tagged} 个心魔学到 [${stamp.join('/')}] 技能`);
  }

  // 4) Aggression scales
  const a = clampAggressionForWave(cloned.index, strat.aggression);
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
  const preferredKinds = getAllowedEnemyKindsForWave(cloned.index, strat.preferred_kinds);
  if (preferredKinds.length && cloned.index >= 5) {
    const fillerIdx = cloned.spawns
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => !isBossSpawn(s))
      .sort((a, b) => spawnFrontRank(b.s) - spawnFrontRank(a.s))
      .map(({ i }) => i);
    const swapCount = Math.min(fillerIdx.length, Math.ceil(fillerIdx.length * 0.45));
    const swapped: Record<EnemyKind, number> = {
      anxiety: 0, depression: 0, obsession: 0, guilt: 0, ptsd: 0,
    };
    for (let n = 0; n < swapCount; n++) {
      const pickIdx = fillerIdx[n];
      const newKind = preferredKinds[n % preferredKinds.length];
      cloned.spawns[pickIdx].kind = newKind;
      swapped[newKind]++;
    }
    const list = Object.entries(swapped)
      .filter(([_, n]) => n > 0)
      .map(([k, n]) => `${kindLabel(k as EnemyKind)}×${n}`)
      .join(' / ');
    if (list) changes.push(`阵容变化：${list}`);
  }

  // 6) Formation -> rewrite delays after composition is finalized. This keeps
  // review-driven formation changes meaningful after kind swaps/reinforcements.
  applyFormation(cloned, strat.formation);
  changes.push(formationLabel(strat.formation));

  return { applied: cloned, changes };
}

function applyFormation(w: WaveSpec, f: Formation): void {
  const ordered = tacticalSpawnOrder(w.spawns);
  const baseStart = ordered.length ? Math.min(...ordered.map(s => s.delayMs)) : 600;
  const totalSpan = ordered.length ? Math.max(...ordered.map(s => s.delayMs)) - baseStart : 4000;

  switch (f) {
    case 'clustered': {
      // Tight bursts; each burst still starts with durable frontliners.
      let t = baseStart;
      for (let i = 0; i < ordered.length; i++) {
        ordered[i].delayMs = t;
        if ((i + 1) % 3 === 0) t += 1400;
        else t += 200;
      }
      break;
    }
    case 'scattered': {
      // Even spread across the same total span, front to back.
      const step = ordered.length > 1 ? totalSpan / (ordered.length - 1) : 0;
      ordered.forEach((s, i) => { s.delayMs = Math.round(baseStart + i * step); });
      break;
    }
    case 'wedge': {
      // Accelerating spawns, with the front screen entering before backline.
      let t = baseStart;
      let gap = Math.max(220, Math.round(totalSpan / Math.max(1, ordered.length) * 1.1));
      for (let i = 0; i < ordered.length; i++) {
        ordered[i].delayMs = t;
        t += gap;
        gap = Math.max(180, Math.round(gap * 0.92));
      }
      break;
    }
    case 'rear_first': {
      // Rear-pressure still needs a screen: frontliners enter first, then
      // fragile/specialized units ride behind them.
      let t = baseStart;
      for (let i = 0; i < ordered.length; i++) {
        ordered[i].delayMs = t;
        t += 600 + Math.round(Math.random() * 200);
      }
      break;
    }
  }
}

function reinforceWave(w: WaveSpec, strat: NextStrategy): number {
  const nonBoss = w.spawns.filter(s => !isBossSpawn(s));
  if (!nonBoss.length) return 0;

  const wavePressure = Math.max(0, w.index - 1);
  const aggressionPressure = Math.max(0, Math.round(strat.aggression * 3));
  const latePressure = Math.max(0, w.index - 7);
  const targetNonBoss = nonBoss.length + Math.floor(wavePressure * 0.8) + latePressure * 2 + aggressionPressure;
  const addCount = Math.min(14, Math.max(0, targetNonBoss - nonBoss.length));
  if (addCount <= 0) return 0;

  const templates = tacticalSpawnOrder(nonBoss);
  const firstDelay = Math.min(...nonBoss.map(s => s.delayMs));
  const lastDelay = Math.max(...nonBoss.map(s => s.delayMs));

  for (let i = 0; i < addCount; i++) {
    const template = templates[i % templates.length];
    const kind = strat.preferred_kinds[i % strat.preferred_kinds.length] ?? template.kind;
    const delayMs = Math.round(firstDelay + ((lastDelay - firstDelay) * (i + 1)) / (addCount + 1));
    w.spawns.push({
      ...template,
      kind,
      delayMs,
      hpMul: +(template.hpMul * 0.96).toFixed(3),
      speedMul: +(template.speedMul * 0.98).toFixed(3),
      skills: [...template.skills],
    });
  }

  return addCount;
}

function kindsAllowedForWave(waveIndex: number, kinds: EnemyKind[]): EnemyKind[] {
  const allowed: EnemyKind[] = ['anxiety'];
  if (waveIndex >= 2) allowed.push('depression');
  if (waveIndex >= 3) allowed.push('obsession');
  if (waveIndex >= 4) allowed.push('guilt');
  if (waveIndex >= 6) allowed.push('ptsd');
  return kinds.filter((kind) => allowed.includes(kind));
}

function skillsAllowedForWave(waveIndex: number, skills: SkillFlag[]): SkillFlag[] {
  return skills.filter((skill) => {
    if (skill === 'stealth') return waveIndex >= 4;
    if (skill === 'shield' || skill === 'taunt') return waveIndex >= 5;
    if (skill === 'swarm' || skill === 'split') return waveIndex >= 6;
    return true;
  });
}

function tacticalSpawnOrder(spawns: EnemySpawnSpec[]): EnemySpawnSpec[] {
  const nonBoss = spawns.filter(s => !isBossSpawn(s));
  const bosses = spawns.filter(isBossSpawn);
  const ordered = [...nonBoss].sort((a, b) => spawnFrontRank(b) - spawnFrontRank(a));
  for (const boss of bosses.sort((a, b) => spawnFrontRank(b) - spawnFrontRank(a))) {
    ordered.splice(Math.min(2, ordered.length), 0, boss);
  }
  return ordered;
}

function spawnFrontRank(s: EnemySpawnSpec): number {
  return (
    KIND_FRONT_RANK[s.kind] +
    s.hpMul * 12 +
    (s.skills.includes('shield') ? 35 : 0) +
    (s.skills.includes('rush') ? 8 : 0) -
    (s.skills.includes('stealth') ? 10 : 0) +
    (isBossSpawn(s) ? 90 : 0)
  );
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
