import { BattleSummary, CombatLogEntry, TowerKind, GridPos } from '../../types';

/**
 * 收集单波战斗中的逐敌人数据，供 LLM 复盘 Agent 结构化分析。
 * 每一波创建一个实例。
 */
export class BattleLog {
  waveIndex: number;
  log: CombatLogEntry[] = [];
  enemiesKilled = 0;
  enemiesLeaked = 0;
  sanityStart: number;
  mindStart: number;

  constructor(waveIndex: number, sanityStart: number, mindStart: number) {
    this.waveIndex = waveIndex;
    this.sanityStart = sanityStart;
    this.mindStart = mindStart;
  }

  recordKilled(entry: CombatLogEntry): void {
    this.enemiesKilled++;
    this.log.push(entry);
  }

  recordLeaked(entry: CombatLogEntry): void {
    this.enemiesLeaked++;
    this.log.push(entry);
  }

  finalize(opts: {
    sanityAfter: number;
    mindAfter: number;
    towerLayout: Array<{ kind: TowerKind; col: number; row: number; level: number }>;
    outcome: 'cleared' | 'survived' | 'failed';
  }): BattleSummary {
    return {
      waveIndex: this.waveIndex,
      outcome: opts.outcome,
      enemiesKilled: this.enemiesKilled,
      enemiesLeaked: this.enemiesLeaked,
      sanityDelta: opts.sanityAfter - this.sanityStart,
      sanityAfter: opts.sanityAfter,
      mindAfter: opts.mindAfter,
      log: this.log,
      towerLayout: opts.towerLayout,
    };
  }
}
