import { GridPos, PixelPos } from '../../types';

export interface GridConfig {
  cols: number;
  rows: number;
  tileSize: number;
  offsetX: number;
  offsetY: number;
}

export type CellKind = 'path' | 'build' | 'spawn' | 'core' | 'block';

export class Grid {
  readonly cfg: GridConfig;
  readonly cells: CellKind[][];
  readonly towerAt: number[][];

  constructor(cfg: GridConfig) {
    this.cfg = cfg;
    this.cells = Array.from({ length: cfg.rows }, () =>
      Array.from({ length: cfg.cols }, () => 'block' as CellKind),
    );
    this.towerAt = Array.from({ length: cfg.rows }, () =>
      Array.from({ length: cfg.cols }, () => 0),
    );
  }

  set(col: number, row: number, kind: CellKind): void {
    if (this.inBounds(col, row)) this.cells[row][col] = kind;
  }

  get(col: number, row: number): CellKind {
    if (!this.inBounds(col, row)) return 'block';
    return this.cells[row][col];
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.cfg.cols && row >= 0 && row < this.cfg.rows;
  }

  cellCenter(col: number, row: number): PixelPos {
    return {
      x: this.cfg.offsetX + col * this.cfg.tileSize + this.cfg.tileSize / 2,
      y: this.cfg.offsetY + row * this.cfg.tileSize + this.cfg.tileSize / 2,
    };
  }

  pixelToCell(x: number, y: number): GridPos {
    return {
      col: Math.floor((x - this.cfg.offsetX) / this.cfg.tileSize),
      row: Math.floor((y - this.cfg.offsetY) / this.cfg.tileSize),
    };
  }

  canBuild(col: number, row: number): boolean {
    if (!this.inBounds(col, row)) return false;
    if (this.cells[row][col] !== 'build') return false;
    return this.towerAt[row][col] === 0;
  }

  placeTower(col: number, row: number, towerId: number): boolean {
    if (!this.canBuild(col, row)) return false;
    this.towerAt[row][col] = towerId;
    return true;
  }

  removeTower(col: number, row: number): void {
    if (this.inBounds(col, row)) this.towerAt[row][col] = 0;
  }

  /** Returns the towerId at this cell, or 0. */
  getTowerId(col: number, row: number): number {
    if (!this.inBounds(col, row)) return 0;
    return this.towerAt[row][col];
  }
}

/** Helper: emit cells along a straight line from a (inclusive) to b (inclusive). */
function lineCells(a: GridPos, b: GridPos): GridPos[] {
  const out: GridPos[] = [];
  if (a.col === b.col) {
    const step = b.row > a.row ? 1 : -1;
    for (let r = a.row; r !== b.row + step; r += step) out.push({ col: a.col, row: r });
  } else if (a.row === b.row) {
    const step = b.col > a.col ? 1 : -1;
    for (let c = a.col; c !== b.col + step; c += step) out.push({ col: c, row: a.row });
  } else {
    out.push(a);
  }
  return out;
}

/** Build a piecewise path from a list of waypoints (right-angle moves). */
function pathFromWaypoints(waypoints: GridPos[]): GridPos[] {
  const out: GridPos[] = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i++) {
    const seg = lineCells(waypoints[i - 1], waypoints[i]);
    // Skip the first cell of seg since it duplicates last out cell
    for (let j = 1; j < seg.length; j++) out.push(seg[j]);
  }
  return out;
}

/**
 * Builds the level layout. 24 cols x 12 rows = larger battlefield.
 * Returns three distinct paths from spawn to core, all guaranteed to end at the core.
 */
export function buildDefaultLevel(cfg: GridConfig): {
  grid: Grid;
  pathCells: GridPos[];
  altPathCells: GridPos[];
  edgePathCells: GridPos[];
  spawn: GridPos;
  core: GridPos;
} {
  const g = new Grid(cfg);
  const W = cfg.cols, H = cfg.rows;

  // Mark all cells as 'build' first, then carve paths
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      g.set(c, r, 'build');
    }
  }
  // Frame as 'block' to keep towers off the very edge
  for (let c = 0; c < W; c++) { g.set(c, 0, 'block'); g.set(c, H - 1, 'block'); }
  for (let r = 0; r < H; r++) { g.set(0, r, 'block'); g.set(W - 1, r, 'block'); }

  const spawn: GridPos = { col: 1, row: 2 };
  const core:  GridPos = { col: 1, row: H - 2 };  // bottom-left interior

  // ---- Path A: "short" — center S shape, two big horizontal sweeps
  // (1,2) → (W-2,2) → (W-2,5) → (5,5) → (5,8) → (W-2,8) → (W-2, H-2) → (1, H-2)
  const A = pathFromWaypoints([
    spawn,
    { col: W - 2, row: 2 },
    { col: W - 2, row: 5 },
    { col: 5,     row: 5 },
    { col: 5,     row: 8 },
    { col: W - 2, row: 8 },
    { col: W - 2, row: H - 2 },
    core,
  ]);

  // ---- Path B: "long" — interior detour with extra loop
  // Goes through some inside cells the short doesn't.
  const B = pathFromWaypoints([
    spawn,
    { col: 8,     row: 2 },
    { col: 8,     row: 4 },
    { col: 14,    row: 4 },
    { col: 14,    row: 2 },
    { col: W - 2, row: 2 },
    { col: W - 2, row: 6 },
    { col: 10,    row: 6 },
    { col: 10,    row: 9 },
    { col: W - 2, row: 9 },
    { col: W - 2, row: H - 2 },
    core,
  ]);

  // ---- Path C: "edge" — hugs outer perimeter
  const C = pathFromWaypoints([
    spawn,
    { col: 1,     row: H - 2 },  // straight down left edge -> straight to core
  ]);
  // The straight C is too short. Make it actually hug the perimeter.
  const Cfull = pathFromWaypoints([
    spawn,
    { col: W - 2, row: 2 },
    { col: W - 2, row: H - 2 },
    core,
  ]);
  // Use Cfull as the canonical "edge" path
  void C;

  // Mark all cells from any path as 'path'
  const seen = new Set<string>();
  const markAll = (cells: GridPos[]) => {
    for (const p of cells) {
      const k = `${p.col},${p.row}`;
      if (seen.has(k)) continue;
      seen.add(k);
      g.set(p.col, p.row, 'path');
    }
  };
  markAll(A);
  markAll(B);
  markAll(Cfull);

  // Spawn and core overrides
  g.set(spawn.col, spawn.row, 'spawn');
  g.set(core.col, core.row, 'core');

  return {
    grid: g,
    pathCells: A,
    altPathCells: B,
    edgePathCells: Cfull,
    spawn,
    core,
  };
}
