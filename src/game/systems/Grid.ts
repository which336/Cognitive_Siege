import {
  GridPos,
  MapProjection,
  MapProjectionSummary,
  PathBias,
  PixelPos,
  RouteVariant,
} from '../../types';

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
    return this.canPlaceTower(col, row, 'build');
  }

  canPlaceTower(col: number, row: number, placement: 'build' | 'path'): boolean {
    if (!this.inBounds(col, row)) return false;
    if (this.towerAt[row][col] !== 0) return false;
    return this.cells[row][col] === placement;
  }

  placeTower(col: number, row: number, towerId: number, placement: 'build' | 'path' = 'build'): boolean {
    if (!this.canPlaceTower(col, row, placement)) return false;
    this.towerAt[row][col] = towerId;
    return true;
  }

  preserveTower(col: number, row: number, towerId: number, placement: 'build' | 'path' = 'build'): boolean {
    if (!this.inBounds(col, row)) return false;
    if (placement === 'path') {
      if (this.cells[row][col] !== 'path') return false;
      this.towerAt[row][col] = towerId;
      return true;
    }
    if (this.cells[row][col] === 'path' || this.cells[row][col] === 'spawn' || this.cells[row][col] === 'core') {
      return false;
    }
    this.towerAt[row][col] = towerId;
    return true;
  }

  removeTower(col: number, row: number): void {
    if (this.inBounds(col, row)) this.towerAt[row][col] = 0;
  }

  getTowerId(col: number, row: number): number {
    if (!this.inBounds(col, row)) return 0;
    return this.towerAt[row][col];
  }
}

export interface ProjectedLevel {
  grid: Grid;
  pathCells: GridPos[];
  altPathCells: GridPos[];
  edgePathCells: GridPos[];
  spawn: GridPos;
  core: GridPos;
  projection: MapProjection;
}

export interface MapProjectionOptions {
  pathBias?: PathBias;
  activeRoute?: RouteVariant;
  waveIndex?: number;
  aggression?: number;
  occupiedCells?: GridPos[];
  extraBuildCells?: GridPos[];
}

const ROUTES: RouteVariant[] = ['short', 'long', 'edge'];

interface RouteBlueprint {
  spawn: GridPos;
  core: GridPos;
  routes: Record<RouteVariant, GridPos[]>;
}

export interface RouteOpenRule {
  minWave: number;
  maxWave: number | null;
  primaryRoute: RouteVariant;
  openRoutes: RouteVariant[];
}

export interface MapConfigData {
  routeWaypoints: Record<RouteVariant, GridPos[]>;
  buildCells: Record<RouteVariant, GridPos[]>;
  routeOpenRules: RouteOpenRule[];
}

let configuredMapConfig: MapConfigData | null = null;

export function setConfiguredMapConfig(config: MapConfigData): void {
  configuredMapConfig = {
    routeWaypoints: {
      short: config.routeWaypoints.short.map((cell) => ({ ...cell })),
      long: config.routeWaypoints.long.map((cell) => ({ ...cell })),
      edge: config.routeWaypoints.edge.map((cell) => ({ ...cell })),
    },
    buildCells: {
      short: config.buildCells.short.map((cell) => ({ ...cell })),
      long: config.buildCells.long.map((cell) => ({ ...cell })),
      edge: config.buildCells.edge.map((cell) => ({ ...cell })),
    },
    routeOpenRules: config.routeOpenRules.map((rule) => ({
      ...rule,
      openRoutes: [...rule.openRoutes],
    })),
  };
}

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

function pathFromWaypoints(waypoints: GridPos[]): GridPos[] {
  const out: GridPos[] = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i++) {
    const seg = lineCells(waypoints[i - 1], waypoints[i]);
    for (let j = 1; j < seg.length; j++) out.push(seg[j]);
  }
  return uniqueCells(out);
}

function keyOf(p: GridPos): string {
  return `${p.col},${p.row}`;
}

function cellFromKey(key: string): GridPos {
  const [col, row] = key.split(',').map(Number);
  return { col, row };
}

function uniqueCells(cells: GridPos[]): GridPos[] {
  const seen = new Set<string>();
  const out: GridPos[] = [];
  for (const cell of cells) {
    const key = keyOf(cell);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cell);
  }
  return out;
}

function routeBlueprint(cfg: GridConfig): RouteBlueprint {
  if (configuredMapConfig) {
    const routes = {
      short: pathFromWaypoints(configuredMapConfig.routeWaypoints.short),
      long: pathFromWaypoints(configuredMapConfig.routeWaypoints.long),
      edge: pathFromWaypoints(configuredMapConfig.routeWaypoints.edge),
    };
    return {
      spawn: configuredMapConfig.routeWaypoints.short[0],
      core: configuredMapConfig.routeWaypoints.short[configuredMapConfig.routeWaypoints.short.length - 1],
      routes,
    };
  }

  const W = cfg.cols;
  const spawn: GridPos = { col: 1, row: 5 };
  const core: GridPos = { col: W - 2, row: 8 };
  const fork: GridPos = { col: 4, row: 5 };
  const merge: GridPos = { col: W - 5, row: 7 };
  const finalBend: GridPos = { col: W - 2, row: 7 };

  const sharedEnd = [merge, finalBend, core];

  const short = pathFromWaypoints([
    spawn,
    fork,
    { col: 4, row: 3 },
    { col: 9, row: 3 },
    { col: 9, row: 5 },
    { col: 13, row: 5 },
    { col: 13, row: 7 },
    ...sharedEnd,
  ]);

  const long = pathFromWaypoints([
    spawn,
    fork,
    { col: 4, row: 8 },
    { col: 7, row: 8 },
    { col: 7, row: 10 },
    { col: 14, row: 10 },
    { col: 14, row: 8 },
    { col: 18, row: 8 },
    { col: 18, row: 7 },
    ...sharedEnd,
  ]);

  const edge = pathFromWaypoints([
    spawn,
    fork,
    { col: 4, row: 2 },
    { col: 16, row: 2 },
    { col: 16, row: 4 },
    { col: 19, row: 4 },
    ...sharedEnd,
  ]);

  return {
    spawn,
    core,
    routes: { short, long, edge },
  };
}

export function resolveRouteVariant(pathBias: PathBias = 'short', waveIndex = 1): RouteVariant {
  switch (pathBias) {
    case 'long':
      return 'long';
    case 'edge':
      return 'edge';
    case 'random':
      // Map projection needs a stable primary route. Per-enemy randomization is
      // handled in WaveSystem when each spawn picks its concrete branch.
      return ROUTES[Math.max(0, waveIndex - 1) % ROUTES.length];
    case 'center':
    case 'short':
    default:
      return 'short';
  }
}

export function routeVariantLabel(route: RouteVariant): string {
  switch (route) {
    case 'long':
      return '长绕路线';
    case 'edge':
      return '边偷路线';
    case 'short':
    default:
      return '短快主干';
  }
}

export function openRoutesForPrimary(route: RouteVariant, waveIndex = 1): RouteVariant[] {
  if (configuredMapConfig?.routeOpenRules.length) {
    const rule = configuredMapConfig.routeOpenRules.find((item) => (
      item.primaryRoute === route &&
      waveIndex >= item.minWave &&
      (item.maxWave == null || waveIndex <= item.maxWave)
    ));
    if (rule) return uniqueRoutes(rule.openRoutes);
  }

  if (waveIndex >= 6) return ['short', 'long', 'edge'];
  if (waveIndex <= 1) return [route];
  if (waveIndex === 2) return uniqueRoutes(['short', route]);
  if (waveIndex === 3) return uniqueRoutes(['short', 'long', route]);
  switch (route) {
    case 'long':
      return ['short', 'long', 'edge'];
    case 'edge':
      return ['short', 'edge'];
    case 'short':
    default:
      return ['short', 'long'];
  }
}

function uniqueRoutes(routes: RouteVariant[]): RouteVariant[] {
  return Array.from(new Set(routes));
}

function routeAttackIntent(route: RouteVariant): string {
  switch (route) {
    case 'long':
      return '拉长战线，试探中后段火力覆盖';
    case 'edge':
      return '绕开主防线，压迫自我核心前区';
    case 'short':
    default:
      return '走最短主干，逼迫主要火力区立刻响应';
  }
}

function corruptionFromAggression(aggression = 0): number {
  if (aggression >= 0.65) return 3;
  if (aggression >= 0.25) return 2;
  if (aggression <= -0.35) return 0;
  return 1;
}

const FIXED_BUILD_CELLS: Record<RouteVariant, GridPos[]> = {
  short: [
    { col: 2, row: 3 }, { col: 3, row: 3 }, { col: 2, row: 4 }, { col: 3, row: 4 },
    { col: 5, row: 4 }, { col: 6, row: 4 }, { col: 5, row: 5 }, { col: 6, row: 5 },
    { col: 8, row: 2 }, { col: 9, row: 2 },
    { col: 12, row: 4 }, { col: 13, row: 4 }, { col: 14, row: 4 },
    { col: 12, row: 5 }, { col: 13, row: 5 }, { col: 14, row: 5 },
    { col: 17, row: 6 }, { col: 18, row: 6 }, { col: 19, row: 6 },
    { col: 19, row: 7 }, { col: 19, row: 8 },
    { col: 20, row: 10 }, { col: 21, row: 10 },
  ],
  long: [
    { col: 3, row: 3 }, { col: 4, row: 3 }, { col: 3, row: 4 }, { col: 4, row: 4 },
    { col: 5, row: 5 }, { col: 5, row: 6 },
    { col: 7, row: 8 }, { col: 8, row: 8 }, { col: 9, row: 8 },
    { col: 10, row: 9 }, { col: 11, row: 9 }, { col: 12, row: 9 },
    { col: 14, row: 8 }, { col: 15, row: 8 }, { col: 16, row: 8 },
    { col: 17, row: 6 }, { col: 18, row: 6 },
    { col: 19, row: 7 }, { col: 20, row: 7 },
    { col: 20, row: 10 }, { col: 21, row: 10 },
  ],
  edge: [
    { col: 4, row: 1 }, { col: 5, row: 1 }, { col: 6, row: 1 },
    { col: 3, row: 3 }, { col: 4, row: 3 },
    { col: 7, row: 3 }, { col: 8, row: 3 }, { col: 9, row: 3 },
    { col: 12, row: 3 }, { col: 13, row: 3 }, { col: 14, row: 3 },
    { col: 16, row: 4 }, { col: 18, row: 4 }, { col: 19, row: 4 },
    { col: 18, row: 6 }, { col: 19, row: 6 },
    { col: 19, row: 7 }, { col: 19, row: 8 },
    { col: 20, row: 10 }, { col: 21, row: 10 },
  ],
};

function fixedBuildCells(route: RouteVariant): GridPos[] {
  if (configuredMapConfig) return uniqueCells(configuredMapConfig.buildCells[route]);
  return uniqueCells(FIXED_BUILD_CELLS[route]);
}

export function createMapProjection(cfg: GridConfig, opts: MapProjectionOptions = {}): MapProjection {
  const blueprint = routeBlueprint(cfg);
  const activeRoute = opts.activeRoute ?? resolveRouteVariant(opts.pathBias, opts.waveIndex ?? 1);
  const activeRoutes = openRoutesForPrimary(activeRoute, opts.waveIndex ?? 1);
  const inactiveRoutes = ROUTES.filter((route) => !activeRoutes.includes(route));
  const activePath = uniqueCells(activeRoutes.flatMap((route) => blueprint.routes[route]));
  const activeKeys = new Set(activePath.map(keyOf));
  const allRouteKeys = new Set<string>();
  for (const route of ROUTES) {
    for (const cell of blueprint.routes[route]) allRouteKeys.add(keyOf(cell));
  }

  const buildKeys = new Set<string>();
  for (const cell of fixedBuildCells(activeRoute)) buildKeys.add(keyOf(cell));
  for (const cell of opts.extraBuildCells ?? []) buildKeys.add(keyOf(cell));

  for (const key of Array.from(buildKeys)) {
    const cell = cellFromKey(key);
    const border = cell.col <= 0 || cell.row <= 0 || cell.col >= cfg.cols - 1 || cell.row >= cfg.rows - 1;
    if (border || allRouteKeys.has(key)) {
      buildKeys.delete(key);
    }
  }

  const inactivePathCells = uniqueCells(
    inactiveRoutes
      .flatMap((route) => blueprint.routes[route])
      .filter((cell) => !activeKeys.has(keyOf(cell))),
  );

  const blockedCells: GridPos[] = [];
  for (let row = 0; row < cfg.rows; row++) {
    for (let col = 0; col < cfg.cols; col++) {
      const key = `${col},${row}`;
      if (buildKeys.has(key)) continue;
      if (allRouteKeys.has(key)) continue;
      if (key === keyOf(blueprint.spawn) || key === keyOf(blueprint.core)) continue;
      blockedCells.push({ col, row });
    }
  }

  const buildCells = Array.from(buildKeys).map(cellFromKey);
  const corruptionLevel = corruptionFromAggression(opts.aggression);
  const summary: MapProjectionSummary = {
    activeRoute,
    activeRouteLabel: routeVariantLabel(activeRoute),
    activeRoutes,
    inactiveRoutes,
    buildCellCount: buildCells.length,
    blockedCellCount: blockedCells.length,
    corruptionLevel,
    towerPocketCount: buildCells.length,
    attackIntent: routeAttackIntent(activeRoute),
  };

  return {
    activeRoute,
    activeRoutes,
    inactiveRoutes,
    pathCells: activePath,
    inactivePathCells,
    buildCells,
    blockedCells,
    corruptionLevel,
    summary,
  };
}

export function buildProjectedLevel(cfg: GridConfig, opts: MapProjectionOptions = {}): ProjectedLevel {
  const blueprint = routeBlueprint(cfg);
  const projection = createMapProjection(cfg, opts);
  const grid = new Grid(cfg);

  for (const cell of projection.buildCells) grid.set(cell.col, cell.row, 'build');
  for (const route of ROUTES) {
    for (const cell of blueprint.routes[route]) grid.set(cell.col, cell.row, 'path');
  }

  grid.set(blueprint.spawn.col, blueprint.spawn.row, 'spawn');
  grid.set(blueprint.core.col, blueprint.core.row, 'core');

  return {
    grid,
    pathCells: blueprint.routes.short,
    altPathCells: blueprint.routes.long,
    edgePathCells: blueprint.routes.edge,
    spawn: blueprint.spawn,
    core: blueprint.core,
    projection,
  };
}

export function buildDefaultLevel(cfg: GridConfig): ProjectedLevel {
  return buildProjectedLevel(cfg, { pathBias: 'short', waveIndex: 1, aggression: 0 });
}
