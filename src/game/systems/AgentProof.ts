import {
  AgentProofBattleSummary,
  AgentProofWaveSummary,
  BattleSummary,
  EnemyKind,
  SkillFlag,
  WaveSpec,
} from '../../types';

export function summarizeBattleForProof(summary: BattleSummary): AgentProofBattleSummary {
  const deathsByTower: AgentProofBattleSummary['deathsByTower'] = {};
  const perKind: AgentProofBattleSummary['perKind'] = {};
  const towerLayout: AgentProofBattleSummary['towerLayout'] = {};

  for (const e of summary.log) {
    deathsByTower[e.killedBy] = (deathsByTower[e.killedBy] ?? 0) + 1;

    const kindStats = perKind[e.enemyKind] ??= {
      spawned: 0,
      killed: 0,
      leaked: 0,
      avgProgress: 0,
    };
    kindStats.spawned++;
    if (e.killedBy === 'reached_core') kindStats.leaked++;
    else kindStats.killed++;
    kindStats.avgProgress += e.pathProgress;
  }

  for (const kind of Object.keys(perKind) as EnemyKind[]) {
    const stats = perKind[kind];
    if (!stats || stats.spawned <= 0) continue;
    stats.avgProgress = +(stats.avgProgress / stats.spawned).toFixed(2);
  }

  for (const t of summary.towerLayout) {
    towerLayout[t.kind] = (towerLayout[t.kind] ?? 0) + 1;
  }

  return {
    wave: summary.waveIndex,
    outcome: summary.outcome,
    sanityAfter: summary.sanityAfter,
    sanityDelta: summary.sanityDelta,
    mindAfter: summary.mindAfter,
    enemiesKilled: summary.enemiesKilled,
    enemiesLeaked: summary.enemiesLeaked,
    deathsByTower,
    perKind,
    towerLayout,
  };
}

export function summarizeWaveForProof(wave: WaveSpec): AgentProofWaveSummary {
  const kinds: AgentProofWaveSummary['kinds'] = {};
  const skills: AgentProofWaveSummary['skills'] = {};
  const pathBiases = new Set(wave.spawns.map(s => s.pathBias));
  let firstSpawnMs = 0;
  let lastSpawnMs = 0;
  let minHp = 0;
  let maxHp = 0;
  let minSpeed = 0;
  let maxSpeed = 0;

  if (wave.spawns.length) {
    firstSpawnMs = Math.min(...wave.spawns.map(s => s.delayMs));
    lastSpawnMs = Math.max(...wave.spawns.map(s => s.delayMs));
    minHp = Math.min(...wave.spawns.map(s => s.hpMul));
    maxHp = Math.max(...wave.spawns.map(s => s.hpMul));
    minSpeed = Math.min(...wave.spawns.map(s => s.speedMul));
    maxSpeed = Math.max(...wave.spawns.map(s => s.speedMul));
  }

  for (const spawn of wave.spawns) {
    kinds[spawn.kind] = (kinds[spawn.kind] ?? 0) + 1;
    for (const skill of spawn.skills as SkillFlag[]) {
      skills[skill] = (skills[skill] ?? 0) + 1;
    }
  }

  return {
    wave: wave.index,
    isBoss: wave.isBoss,
    formation: wave.formation,
    mindGift: wave.mindGift,
    spawnCount: wave.spawns.length,
    firstSpawnMs,
    lastSpawnMs,
    pathBiases: [...pathBiases],
    kinds,
    skills,
    hpMulRange: [+minHp.toFixed(3), +maxHp.toFixed(3)],
    speedMulRange: [+minSpeed.toFixed(3), +maxSpeed.toFixed(3)],
  };
}
