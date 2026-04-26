import { GridPos, PathBias, WaveSpec, EnemySpawnSpec } from '../../types';

export interface PathPool {
  short: GridPos[];
  long: GridPos[];
  edge: GridPos[];
}

/** Picks the actual grid path used by an enemy based on its spec.pathBias. */
export function pickPath(spec: EnemySpawnSpec, pool: PathPool): GridPos[] {
  const bias: PathBias = spec.pathBias;
  switch (bias) {
    case 'long': return pool.long;
    case 'edge': return pool.edge;
    case 'random':
      return [pool.short, pool.long, pool.edge][Math.floor(Math.random() * 3)];
    case 'center':
    case 'short':
    default:
      return pool.short;
  }
}

/** Returns the total wave duration (last spawn delay + 8s buffer) for UI hints. */
export function estimateWaveDuration(w: WaveSpec): number {
  const last = w.spawns.reduce((m, s) => Math.max(m, s.delayMs), 0);
  return last + 8000;
}
