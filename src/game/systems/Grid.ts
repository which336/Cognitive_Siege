import {
  GridPos,
  MapElementKind,
  MapElementSpec,
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

// Grid 只负责格子占用和坐标换算；路线开放规则在下方投影函数中处理。
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
    // 地图重投影后恢复已有塔位：普通塔不能落在路线/核心/出生点，边界塔必须仍在线路上。
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
  spawnPositions: Record<RouteVariant, GridPos>;
  core: GridPos;
  projection: MapProjection;
}

export interface MapProjectionOptions {
  pathBias?: PathBias;
  activeRoute?: RouteVariant;
  waveIndex?: number;
  aggression?: number;
  forceOpenRoutes?: RouteVariant[];
  occupiedCells?: GridPos[];
  extraBuildCells?: GridPos[];
  levelId?: string;
  disabledMapElementIds?: string[];
}

const ROUTES: RouteVariant[] = ['short', 'long', 'edge'];

interface RouteBlueprint {
  spawn: GridPos;
  spawnPositions: Record<RouteVariant, GridPos>;
  core: GridPos;
  routes: Record<RouteVariant, GridPos[]>;
}

export interface RouteOpenRule {
  minWave: number;
  maxWave: number | null;
  primaryRoute: RouteVariant;
  openRoutes: RouteVariant[];
}

export interface LevelMapConfig {
  routeWaypoints: Record<RouteVariant, GridPos[]>;
  buildCells: Record<RouteVariant, GridPos[]>;
  routeOpenRules: RouteOpenRule[];
  elements: MapElementSpec[];
}

export interface MapConfigData {
  levels: Record<string, LevelMapConfig>;
  defaultLevelId: string;
}

let configuredMapConfig: MapConfigData | null = null;

export function setConfiguredMapConfig(config: MapConfigData): void {
  // 外部 CSV 配置会被克隆进内存，避免运行时修改污染原始配置对象。
  configuredMapConfig = {
    defaultLevelId: config.defaultLevelId,
    levels: Object.fromEntries(
      Object.entries(config.levels).map(([levelId, level]) => [levelId, cloneLevelMapConfig(level)]),
    ),
  };
}

function cloneLevelMapConfig(config: LevelMapConfig): LevelMapConfig {
  return {
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
    elements: config.elements.map((element) => ({
      ...element,
      cell: { ...element.cell },
    })),
  };
}

function configuredLevelMap(levelId?: string): LevelMapConfig | null {
  if (!configuredMapConfig) return null;
  return configuredMapConfig.levels[levelId ?? configuredMapConfig.defaultLevelId]
    ?? configuredMapConfig.levels[configuredMapConfig.defaultLevelId]
    ?? null;
}

function lineCells(a: GridPos, b: GridPos): GridPos[] {
  // 路线配置只允许横竖折线；若误传斜线，保守地只保留起点，避免生成穿格路径。
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
  // 将少量折点展开成逐格路径，供敌人寻路和地图绘制共用。
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

function routeBlueprint(cfg: GridConfig, levelId?: string): RouteBlueprint {
  const mapConfig = configuredLevelMap(levelId);
  if (mapConfig) {
    // 优先使用 CSV 配置的路线蓝图；缺失配置时才回退到代码内置路线。
    const routes = {
      short: pathFromWaypoints(mapConfig.routeWaypoints.short),
      long: pathFromWaypoints(mapConfig.routeWaypoints.long),
      edge: pathFromWaypoints(mapConfig.routeWaypoints.edge),
    };
    return {
      spawn: mapConfig.routeWaypoints.short[0],
      spawnPositions: {
        short: mapConfig.routeWaypoints.short[0],
        long: mapConfig.routeWaypoints.long[0],
        edge: mapConfig.routeWaypoints.edge[0],
      },
      core: mapConfig.routeWaypoints.short[mapConfig.routeWaypoints.short.length - 1],
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
    spawnPositions: { short: spawn, long: spawn, edge: spawn },
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
      // 地图投影需要稳定主路线；逐个敌人的随机分路交给 WaveSystem 处理。
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

export function openRoutesForPrimary(route: RouteVariant, waveIndex = 1, levelId?: string): RouteVariant[] {
  const mapConfig = configuredLevelMap(levelId);
  if (mapConfig?.routeOpenRules.length) {
    // CSV 可以精确控制“主路线 -> 实际开放分支”的教学节奏。
    const rule = mapConfig.routeOpenRules.find((item) => (
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

function fixedBuildCells(route: RouteVariant, levelId?: string): GridPos[] {
  // 可建造格跟随主路线切换，减少玩家能长期无脑覆盖全图的固定点。
  const mapConfig = configuredLevelMap(levelId);
  if (mapConfig) return uniqueCells(mapConfig.buildCells[route]);
  return uniqueCells(FIXED_BUILD_CELLS[route]);
}

function activeMapElementsForWave(levelId: string | undefined, waveIndex: number): MapElementSpec[] {
  const mapConfig = configuredLevelMap(levelId);
  if (!mapConfig) return [];
  return mapConfig.elements
    .filter((element) => waveIndex >= element.waveStart && (element.waveEnd == null || waveIndex <= element.waveEnd))
    .map((element) => ({
      ...element,
      cell: { ...element.cell },
    }));
}

function uniqueElementKinds(elements: MapElementSpec[]): MapElementKind[] {
  return Array.from(new Set(elements.map((element) => element.kind)));
}

function cellWithinElementRadius(cell: GridPos, element: MapElementSpec): boolean {
  const radius = Math.max(0, element.radiusCells || 0);
  const dx = cell.col - element.cell.col;
  const dy = cell.row - element.cell.row;
  return dx * dx + dy * dy <= radius * radius;
}

export function createMapProjection(cfg: GridConfig, opts: MapProjectionOptions = {}): MapProjection {
  // 这里产出“本波实际地图视图”：开放哪些路、哪些塔位有效、哪些格子阻塞。
  const levelId = opts.levelId;
  const waveIndex = opts.waveIndex ?? 1;
  const disabledMapElementIds = new Set(opts.disabledMapElementIds ?? []);
  const mapElements = activeMapElementsForWave(levelId, waveIndex)
    .filter((element) => !disabledMapElementIds.has(element.id));
  const blueprint = routeBlueprint(cfg, levelId);
  const activeRoute = opts.activeRoute ?? resolveRouteVariant(opts.pathBias, waveIndex);
  const activeRoutes = opts.forceOpenRoutes?.length
    ? uniqueRoutes(opts.forceOpenRoutes)
    : openRoutesForPrimary(activeRoute, waveIndex, levelId);
  const inactiveRoutes = ROUTES.filter((route) => !activeRoutes.includes(route));
  const activePath = uniqueCells(activeRoutes.flatMap((route) => blueprint.routes[route]));
  const activeKeys = new Set(activePath.map(keyOf));
  const allRouteKeys = new Set<string>();
  for (const route of ROUTES) {
    for (const cell of blueprint.routes[route]) allRouteKeys.add(keyOf(cell));
  }

  const buildKeys = new Set<string>();
  for (const cell of fixedBuildCells(activeRoute, levelId)) buildKeys.add(keyOf(cell));
  for (const cell of opts.extraBuildCells ?? []) buildKeys.add(keyOf(cell));

  const dryWells = mapElements.filter((element) => element.kind === 'dry_well');
  for (const key of Array.from(buildKeys)) {
    const cell = cellFromKey(key);
    const border = cell.col <= 0 || cell.row <= 0 || cell.col >= cfg.cols - 1 || cell.row >= cfg.rows - 1;
    // 防止塔位覆盖边界或任意路线格，保证敌人路线不会被普通塔堵死。
    // 存活枯井会压制半径内塔位；打掉后由场景把释放格加入 extraBuildCells。
    if (border || allRouteKeys.has(key) || dryWells.some((well) => cellWithinElementRadius(cell, well))) {
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
    mapElementCount: mapElements.length,
    mapElementKinds: uniqueElementKinds(mapElements),
  };

  return {
    activeRoute,
    activeRoutes,
    inactiveRoutes,
    pathCells: activePath,
    inactivePathCells,
    buildCells,
    blockedCells,
    mapElements,
    corruptionLevel,
    summary,
  };
}

export function buildProjectedLevel(cfg: GridConfig, opts: MapProjectionOptions = {}): ProjectedLevel {
  // Phaser 场景最终消费的是实体 Grid；Projection 则保留给 UI 和复盘证明面板。
  const blueprint = routeBlueprint(cfg, opts.levelId);
  const projection = createMapProjection(cfg, opts);
  const grid = new Grid(cfg);

  for (const cell of projection.buildCells) grid.set(cell.col, cell.row, 'build');
  for (const route of ROUTES) {
    for (const cell of blueprint.routes[route]) grid.set(cell.col, cell.row, 'path');
  }

  for (const spawn of uniqueCells(Object.values(blueprint.spawnPositions))) {
    grid.set(spawn.col, spawn.row, 'spawn');
  }
  grid.set(blueprint.core.col, blueprint.core.row, 'core');

  return {
    grid,
    pathCells: blueprint.routes.short,
    altPathCells: blueprint.routes.long,
    edgePathCells: blueprint.routes.edge,
    spawn: blueprint.spawn,
    spawnPositions: {
      short: { ...blueprint.spawnPositions.short },
      long: { ...blueprint.spawnPositions.long },
      edge: { ...blueprint.spawnPositions.edge },
    },
    core: blueprint.core,
    projection,
  };
}

export function buildDefaultLevel(cfg: GridConfig): ProjectedLevel {
  return buildProjectedLevel(cfg, { pathBias: 'short', waveIndex: 1, aggression: 0 });
}
