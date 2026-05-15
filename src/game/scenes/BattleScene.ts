import Phaser from 'phaser';
import {
  Grid,
  buildProjectedLevel,
  createMapProjection,
  openRoutesForPrimary,
  resolveRouteVariant,
  routeVariantLabel,
} from '../systems/Grid';
import { Tower } from '../entities/Tower';
import { Enemy } from '../entities/Enemy';
import { MindCache } from '../entities/MindCache';
import { MapElementActor } from '../entities/MapElementActor';
import { ALL_TOWER_KINDS, TOWER_DEFS } from '../data/towers';
import { ENEMY_DEFS } from '../data/enemies';
import {
  getBossCombatConfig,
  getDifficultyConfig,
  getMindCacheConfig,
  getTutorialTip,
  getWaveScalingConfig,
  type BossSkillKind,
  type TutorialTip,
} from '../data/configLoader';
import {
  GridPos,
  TowerKind,
  ReviewResult,
  AgentProofSnapshot,
  ChoiceTag,
  NegotiationResolution,
  WaveSpec,
  BattleSummary,
  CombatLogEntry,
  EnemySpawnSpec,
  LevelSpec,
  MapProjection,
  RouteVariant,
} from '../../types';
import { buildBaseWaves, DEFAULT_LEVEL_ID, getLevelSpec, TOTAL_WAVES } from '../data/waves';
import { PathPool, pickRouteForEnemy } from '../systems/WaveSystem';
import { BattleLog } from '../systems/BattleLog';
import { applyStrategy } from '../systems/EvolutionApplier';
import { summarizeBattleForProof, summarizeWaveForProof } from '../systems/AgentProof';
import { runReviewAgent } from '../llm/reviewAgent';
import { runDirector } from '../llm/directorAgent';
import { runNegotiation } from '../llm/negotiationAgent';
import { showVignette } from '../../ui/VignettePanel';
import { showReview } from '../../ui/ReviewPanel';
import { openNegotiation } from '../../ui/NegotiationPanel';
import { showSettings } from '../../ui/SettingsPanel';
import { showHelp } from '../../ui/HelpPanel';
import { loadSettings } from '../../settings';
import { applyChoiceTag, fallbackVignette, getBossPersona, NEUTRAL_RESOLUTION, totalDialogueTurns } from '../data/fallback';
import { Sound } from '../systems/Audio';
import { showTowerActionPopup } from '../../ui/TowerActionPopup';

const TILE = 48;
const GRID_COLS = 24;
const GRID_ROWS = 12;

type Phase = 'intro' | 'build' | 'combat' | 'review' | 'gameover' | 'victory';
type RouteKey = RouteVariant;

const SPEED_PRESETS: Array<1 | 2 | 4> = [1, 2, 4];
const SCULPT_COST = 25;
const EXPORT_ROUTES: RouteVariant[] = ['short', 'long', 'edge'];
const EXPORT_TOWERS: TowerKind[] = ['memory', 'belief', 'resonance', 'acceptance', 'insight', 'boundary'];

interface WaveStatsDraft {
  waveIndex: number;
  outcome: BattleSummary['outcome'] | null;
  sanityAfter: number;
  enemiesKilled: number;
  enemiesLeaked: number;
  deathsByTower: Partial<Record<TowerKind | 'reached_core' | 'unknown', number>>;
  routeCounts: Record<RouteVariant, number>;
  totalRoutePicks: number;
}

interface ExportedWaveStats {
  waveIndex: number;
  outcome: BattleSummary['outcome'];
  sanityAfter: number;
  enemiesKilled: number;
  enemiesLeaked: number;
  deathsByTower: Partial<Record<TowerKind | 'reached_core' | 'unknown', number>>;
  routeCounts: Record<RouteVariant, number>;
  routeUsagePct: Record<RouteVariant, number>;
}

export class BattleScene extends Phaser.Scene {
  // 地图布局与路径投影。
  private grid!: Grid;
  private pathPool!: PathPool;
  private corePos!: GridPos;
  private spawnPos!: GridPos;
  private spawnPositions!: Record<RouteVariant, GridPos>;
  private mapProjection!: MapProjection;

  // 全局游戏状态。
  private selectedLevelId = DEFAULT_LEVEL_ID;
  private currentLevel: LevelSpec = getLevelSpec(DEFAULT_LEVEL_ID);
  private waves: WaveSpec[] = [];
  private currentWaveIdx = 0;
  private phase: Phase = 'intro';
  private mind = 60;
  private sanity = 80;
  private sanityMax = 100;

  // 游戏时间：每帧按 deltaMs * speedMul 递增。
  // 塔冷却、刷怪、减速过期、幻觉检查等玩法计时都使用它，确保倍速影响一致。
  public gameTime = 0;
  private speedMul: 1 | 2 | 4 = 1;
  private hallucinationCheckAt = 0;

  // 当前波次运行态。
  private spawnQueue: { spawnAt: number; spec: EnemySpawnSpec; isBossSpawn: boolean }[] = [];
  private mirrorEchoQueue: { spawnAt: number; spec: EnemySpawnSpec; route: RouteVariant; progressRatio: number; pairId: string }[] = [];
  private mirrorEchoTriggers = new WeakMap<Enemy, Set<string>>();
  private battleLog: BattleLog | null = null;
  private currentWaveStats: WaveStatsDraft | null = null;
  private runStats: ExportedWaveStats[] = [];
  private bossNegotiationApplied: NegotiationResolution = { ...NEUTRAL_RESOLUTION };
  private nextBossCoreTickAt = 0;
  private nextBossSummonAt = 0;

  // 战场实体。
  private towers: Tower[] = [];
  private enemies: Enemy[] = [];
  private mindCaches: MindCache[] = [];
  private mapElements: MapElementActor[] = [];

  // Phaser 内 UI。
  private hudLeftBg!: Phaser.GameObjects.Rectangle;
  private hudText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private mindText!: Phaser.GameObjects.Text;
  private sanityBar!: Phaser.GameObjects.Rectangle;
  private sanityBarBg!: Phaser.GameObjects.Rectangle;
  private sanityLabel!: Phaser.GameObjects.Text;
  private bossSkillBg!: Phaser.GameObjects.Rectangle;
  private bossSkillText!: Phaser.GameObjects.Text;
  private startWaveBtn!: Phaser.GameObjects.Container;
  private speedBtn!: Phaser.GameObjects.Container;
  private speedLabel!: Phaser.GameObjects.Text;
  private sculptBtn!: Phaser.GameObjects.Container;
  private sculptLabel!: Phaser.GameObjects.Text;
  private tutorialBg!: Phaser.GameObjects.Rectangle;
  private tutorialTitle!: Phaser.GameObjects.Text;
  private tutorialBody!: Phaser.GameObjects.Text;
  private tutorialIcon!: Phaser.GameObjects.Image;
  private tutorialIconLabel!: Phaser.GameObjects.Text;
  private tutorialToggleBg!: Phaser.GameObjects.Rectangle;
  private tutorialToggleText!: Phaser.GameObjects.Text;
  private tutorialToggleHit!: Phaser.GameObjects.Zone;
  private settingsBtn!: Phaser.GameObjects.Container;
  private codexBtn!: Phaser.GameObjects.Container;
  private menuBtn!: Phaser.GameObjects.Container;
  private toolbarButtons: { kind: TowerKind; container: Phaser.GameObjects.Container }[] = [];
  private selectedTowerKind: TowerKind | null = null;
  private sculptMode = false;
  private lastBreathPhase: 'inhale' | 'exhale' | null = null;
  private tutorialCollapsed = false;
  private persistentBuildMessage: { text: string; color: string } | null = null;
  private hoverPreview!: Phaser.GameObjects.Container;
  private msgBg!: Phaser.GameObjects.Rectangle;
  private msgText!: Phaser.GameObjects.Text;

  private gridGfx!: Phaser.GameObjects.Graphics;
  private gridLineGfx!: Phaser.GameObjects.Graphics;
  private pathGfx!: Phaser.GameObjects.Graphics;
  private decorationGfx!: Phaser.GameObjects.Graphics;
  private gridArtLayer!: Phaser.GameObjects.Container;
  private pathArtLayer!: Phaser.GameObjects.Container;
  private synapses: Phaser.GameObjects.Arc[] = [];
  private fragmentTimer: Phaser.Time.TimerEvent | null = null;

  // 缓存可建造格，供环境装饰和念力残堆刷新使用。
  private buildCells: GridPos[] = [];
  private playerBuildCells: GridPos[] = [];
  private destroyedMapElementIds = new Set<string>();

  // 复盘 Agent 选择路线族；路线族会开放 2-3 条实际分支，单个敌人再按权重分路。
  private activePathKey: RouteKey = 'short';
  private waveMapAggression = new Map<number, number>();

  // 塔交互弹层。
  private activePopupClose: (() => void) | null = null;

  constructor() { super({ key: 'BattleScene' }); }

  init(data?: { levelId?: string }): void {
    this.selectedLevelId = data?.levelId || DEFAULT_LEVEL_ID;
  }

  create(): void {
    this.resetRunState();
    this.currentLevel = getLevelSpec(this.selectedLevelId);
    this.cameras.main.setBackgroundColor('#0b0a18');
    const settings = loadSettings();
    const difficultyCfg = getDifficultyConfig(settings.difficulty);
    this.sanityMax = difficultyCfg.sanityMax;
    this.sanity = difficultyCfg.sanityStart;
    this.mind = this.startingMindForLevel(difficultyCfg.mindStart);
    this.tweens.timeScale = 1;
    this.time.timeScale = 1;

    const offsetY = 70;
    const offsetX = (this.scale.width - GRID_COLS * TILE) / 2;
    this.waves = buildBaseWaves(this.currentLevel.id);
    this.activePathKey = this.computeActivePathKey(this.waves[0]);
    const initialForceOpenRoutes = this.openRoutesForWave(this.waves[0], this.activePathKey);
    const built = buildProjectedLevel(
      { cols: GRID_COLS, rows: GRID_ROWS, tileSize: TILE, offsetX, offsetY },
      {
        activeRoute: this.activePathKey,
        waveIndex: 1,
        aggression: 0,
        forceOpenRoutes: initialForceOpenRoutes,
        levelId: this.currentLevel.id,
        disabledMapElementIds: Array.from(this.destroyedMapElementIds),
      },
    );
    this.grid = built.grid;
    this.pathPool = { short: built.pathCells, long: built.altPathCells, edge: built.edgePathCells };
    this.corePos = built.core;
    this.spawnPos = built.spawn;
    this.spawnPositions = built.spawnPositions;
    this.mapProjection = built.projection;

    this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x0b0a18);

    this.gridGfx = this.add.graphics().setDepth(0);
    this.gridArtLayer = this.add.container(0, 0).setDepth(0.35);
    this.gridLineGfx = this.add.graphics().setDepth(0.75);
    this.decorationGfx = this.add.graphics().setDepth(1);
    this.pathGfx = this.add.graphics().setDepth(1.6);
    this.pathArtLayer = this.add.container(0, 0).setDepth(2.1);
    this.drawGrid();
    this.collectBuildCells();
    this.drawDecoration();
    this.startFloatingFragments();

    this.drawPath(this.activePathKey);
    this.syncMapElementsForWave();
    this.drawSpawnAndCore();
    this.buildHUD();
    this.buildToolbar();
    this.buildHoverPreview();
    this.buildMessageBanner();
    this.buildTutorialPanel();

    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.keyboard?.on('keydown-ESC', () => {
      this.selectedTowerKind = null;
      this.sculptMode = false;
      this.refreshToolbar();
      this.refreshSculptButton();
      this.closePopup();
    });
    this.input.keyboard?.on('keydown-SPACE', () => {
      if (this.phase === 'build') this.startWave();
    });
    // 倍速快捷键：1 / 2 / 4。
    this.input.keyboard?.on('keydown-ONE',   () => this.setSpeed(1));
    this.input.keyboard?.on('keydown-TWO',   () => this.setSpeed(2));
    this.input.keyboard?.on('keydown-FOUR',  () => this.setSpeed(4));
    this.input.keyboard?.on('keydown-S', () => this.toggleSculptMode());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanupOnExit());
    this.events.once(Phaser.Scenes.Events.DESTROY,  () => this.cleanupOnExit());

    // 强迫心魔反刍时给附近友军短暂加速，让“回头”读起来像群体反刍而不是寻路问题。
    this.events.off('obsession_loop');
    this.events.on('obsession_loop', (origin: Enemy) => this.applyObsessionLoopAura(origin));

    this.openVignetteForCurrentWave();
  }

  private resetRunState(): void {
    this.currentWaveIdx = 0;
    this.phase = 'intro';
    this.waves = [];
    this.towers = [];
    this.enemies = [];
    this.mindCaches = [];
    this.mapElements = [];
    this.spawnQueue = [];
    this.mirrorEchoQueue = [];
    this.mirrorEchoTriggers = new WeakMap();
    this.battleLog = null;
    this.currentWaveStats = null;
    this.runStats = [];
    this.bossNegotiationApplied = { ...NEUTRAL_RESOLUTION };
    this.nextBossCoreTickAt = 0;
    this.nextBossSummonAt = 0;
    this.gameTime = 0;
    this.speedMul = 1;
    this.hallucinationCheckAt = 0;
    this.toolbarButtons = [];
    this.selectedTowerKind = null;
    this.sculptMode = false;
    this.lastBreathPhase = null;
    this.buildCells = [];
    this.playerBuildCells = [];
    this.destroyedMapElementIds = new Set();
    this.synapses = [];
    this.fragmentTimer = null;
    this.activePathKey = 'short';
    this.waveMapAggression = new Map();
    this.activePopupClose = null;
  }

  private startingMindForLevel(baseMind: number): number {
    if (this.currentLevel.rule !== 'scarcity') return baseMind;
    return Math.max(30, Math.round(baseMind * this.currentLevel.mindGiftMul));
  }

  private levelHasAllUnlocks(): boolean {
    return this.currentLevel.id !== DEFAULT_LEVEL_ID;
  }

  private forcedOpenRoutesForCurrentLevel(waveIndex: number, activeRoute: RouteVariant): RouteVariant[] | undefined {
    if (this.currentLevel.rule !== 'fracture_edge') return undefined;
    const routes: RouteVariant[] = waveIndex <= 2 ? ['short', 'edge'] : ['short', 'long', 'edge'];
    if (!routes.includes(activeRoute)) routes.push(activeRoute);
    return Array.from(new Set(routes));
  }

  private openRoutesForWave(wave: WaveSpec, activeRoute: RouteVariant): RouteVariant[] {
    const ruleRoutes = openRoutesForPrimary(activeRoute, wave.index, this.currentLevel.id);
    const levelForced = this.forcedOpenRoutesForCurrentLevel(wave.index, activeRoute) ?? [];
    const spawnRoutes = wave.spawns.map((spawn) => resolveRouteVariant(spawn.pathBias, wave.index));
    return Array.from(new Set<RouteVariant>([activeRoute, ...ruleRoutes, ...levelForced, ...spawnRoutes]));
  }

  private applyObsessionLoopAura(origin: Enemy): void {
    if (!origin.alive) return;
    const RADIUS = TILE * 3.4;
    const r2 = RADIUS * RADIUS;
    let lit = 0;
    for (const e of this.enemies) {
      if (e === origin) continue;
      if (!e.alive) continue;
      const dx = e.body.x - origin.body.x;
      const dy = e.body.y - origin.body.y;
      if (dx * dx + dy * dy <= r2) {
        e.applySpeedBuff(1.2, 1200, this.gameTime);
        lit++;
      }
    }
    if (lit > 0) {
      // 起点扩散一圈径向闪光，让玩家能看见加速光环的传播。
      const ring = this.add.circle(origin.body.x, origin.body.y, 8, 0xfbbf24, 0)
        .setStrokeStyle(2, 0xfbbf24, 0.8).setDepth(15);
      this.tweens.add({
        targets: ring,
        radius: RADIUS,
        alpha: { from: 0.8, to: 0 },
        duration: 520,
        ease: 'Cubic.easeOut',
        onComplete: () => ring.destroy(),
      });
    }
  }

  private cleanupOnExit(): void {
    this.closePopup();
    Sound.stopAmbient();
  }

  private occupiedTowerCells(): GridPos[] {
    return this.towers.map((tower) => ({ col: tower.cell.col, row: tower.cell.row }));
  }

  private keyOfCell(cell: GridPos): string {
    return `${cell.col},${cell.row}`;
  }

  private restoreTowerOccupancy(): void {
    for (const tower of this.towers) {
      if (this.grid.placeTower(tower.cell.col, tower.cell.row, tower.id, tower.def.placement)) continue;
      this.grid.preserveTower(tower.cell.col, tower.cell.row, tower.id, tower.def.placement);
    }
  }

  private reprojectMapForWave(wave: WaveSpec, animate: boolean): void {
    const previousRoute = this.activePathKey;
    const activeRoute = this.computeActivePathKey(wave);
    const aggression = this.waveMapAggression.get(this.currentWaveIdx) ?? 0;
    const forceOpenRoutes = this.openRoutesForWave(wave, activeRoute);
    const built = buildProjectedLevel(this.grid.cfg, {
      activeRoute,
      waveIndex: wave.index,
      aggression,
      forceOpenRoutes,
      occupiedCells: this.occupiedTowerCells(),
      extraBuildCells: this.playerBuildCells,
      levelId: this.currentLevel.id,
      disabledMapElementIds: Array.from(this.destroyedMapElementIds),
    });

    this.grid = built.grid;
    this.pathPool = { short: built.pathCells, long: built.altPathCells, edge: built.edgePathCells };
    this.corePos = built.core;
    this.spawnPos = built.spawn;
    this.spawnPositions = built.spawnPositions;
    this.mapProjection = built.projection;
    this.restoreTowerOccupancy();

    this.drawGrid();
    this.collectBuildCells();
    this.drawDecoration();
    this.drawPath(activeRoute);
    this.syncMapElementsForWave();
    this.syncMindCachesForMap();
    if (animate) this.playMapRebuildFx(previousRoute, activeRoute);
  }

  private playMapRebuildFx(previousRoute: RouteKey, activeRoute: RouteKey): void {
    this.gridArtLayer.setAlpha(0.82);
    this.pathArtLayer.setAlpha(0.35);
    this.tweens.add({ targets: this.gridArtLayer, alpha: 1, duration: 420, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: this.pathArtLayer, alpha: 1, duration: 620, ease: 'Cubic.easeOut' });

    const color = activeRoute === 'edge' ? 0x67e8f9 : activeRoute === 'long' ? 0xf472b6 : 0xa78bfa;
    const route = this.pathPool[activeRoute];
    const spawnKeys = new Set(
      Object.values(this.spawnPositions ?? { short: this.spawnPos, long: this.spawnPos, edge: this.spawnPos })
        .map((cell) => this.keyOfCell(cell)),
    );
    route.forEach((cell, index) => {
      if (index % 3 !== 0) return;
      if (spawnKeys.has(this.keyOfCell(cell)) ||
          (cell.col === this.corePos.col && cell.row === this.corePos.row)) return;
      const p = this.grid.cellCenter(cell.col, cell.row);
      const pulse = this.add.rectangle(p.x, p.y, TILE - 8, TILE - 8, color, 0.5)
        .setStrokeStyle(1, color, 0.9)
        .setDepth(6)
        .setScale(0.65);
      this.tweens.add({
        targets: pulse,
        scale: 1.1,
        alpha: 0,
        delay: Math.min(360, index * 18),
        duration: 520,
        ease: 'Cubic.easeOut',
        onComplete: () => pulse.destroy(),
      });
    });

    if (previousRoute !== activeRoute) {
      this.flashMessage(`裂隙重构：${routeVariantLabel(previousRoute)} → ${routeVariantLabel(activeRoute)}`, '#67e8f9', 2200);
    }
  }

  // ===================== 地图绘制 =====================

  private drawGrid(): void {
    const g = this.gridGfx;
    const lines = this.gridLineGfx;
    g.clear();
    lines.clear();
    this.gridArtLayer.removeAll(true);
    const hasTileArt = this.textures.exists('tile-build') && this.textures.exists('tile-block');
    const hasPathTileArt = this.textures.exists('tile-path');
    const artSize = TILE - 2;
    const pathArtSize = TILE - 2;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const cell = this.grid.get(c, r);
        const center = this.grid.cellCenter(c, r);
        const x = center.x - TILE / 2, y = center.y - TILE / 2;
        const shade = ((c + r) % 2 === 0) ? 0.04 : 0;
        const fillByCell = {
          build: { color: 0x28452f, alpha: 1 },
          path: { color: 0x332048, alpha: 1 },
          spawn: { color: 0x23172f, alpha: 1 },
          core: { color: 0x1e1a14, alpha: 1 },
          block: { color: 0x111328, alpha: 1 },
        }[cell];
        g.fillStyle(fillByCell.color, fillByCell.alpha)
          .fillRect(x, y, TILE, TILE);
        if (cell === 'build') {
          if (hasTileArt) {
            const glow = this.add.rectangle(center.x, center.y, TILE - 2, TILE - 2, 0x4f7f43, 0.32)
              .setStrokeStyle(1, 0xd5f6a8, 0.52);
            const img = this.add.image(center.x, center.y, 'tile-build')
              .setDisplaySize(artSize, artSize)
              .setAlpha(1);
            const slot = this.add.rectangle(center.x, center.y, TILE - 18, TILE - 18, 0x000000, 0)
              .setStrokeStyle(1, 0xe5ffc8, 0.42);
            this.gridArtLayer.add([glow, img, slot]);
          } else {
            const tone = ((c + r) % 2 === 0) ? 0x315c38 : 0x2a5031;
            g.fillStyle(tone, 1).fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
            g.lineStyle(1.5, 0xd5f6a8, 0.9).strokeRect(x + 7, y + 7, TILE - 14, TILE - 14);
          }
        } else if (cell === 'path') {
          if (hasPathTileArt) {
            const img = this.add.image(center.x, center.y, 'tile-path')
              .setDisplaySize(pathArtSize, pathArtSize)
              .setAlpha(1);
            this.gridArtLayer.add(img);
          }
        } else if (cell === 'block') {
          if (hasTileArt) {
            const isFrame = c === 0 || r === 0 || c === GRID_COLS - 1 || r === GRID_ROWS - 1;
            const img = this.add.image(center.x, center.y, 'tile-block')
              .setDisplaySize(TILE - 8, TILE - 8)
              .setAlpha(isFrame ? 1 : 0.96);
            this.gridArtLayer.add(img);
          } else {
            g.fillStyle(0x12162c, 1).fillRect(x, y, TILE, TILE);
            g.lineStyle(1, 0x26305a, 0.8);
            const step = 7;
            for (let d = -TILE; d < TILE * 2; d += step) {
              const x1 = x + d, y1 = y;
              const x2 = x + d + TILE, y2 = y + TILE;
              const cx1 = Math.max(x, Math.min(x + TILE, x1));
              const cx2 = Math.max(x, Math.min(x + TILE, x2));
              const cy1 = y + (cx1 - x1);
              const cy2 = y + (cx2 - x1);
              if (cx1 < cx2) {
                g.beginPath();
                g.moveTo(cx1, cy1);
                g.lineTo(cx2, cy2);
                g.strokePath();
              }
            }
          }
        }
        lines.lineStyle(1, 0x2f3b70, cell === 'block' ? 0.9 : 1)
          .strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      }
    }
  }

  private computeActivePathKey(wave: WaveSpec): RouteKey {
    const score: Record<RouteKey, number> = { short: 0, long: 0, edge: 0 };
    for (const s of wave.spawns) {
      score[resolveRouteVariant(s.pathBias, wave.index)]++;
    }
    const candidates: RouteKey[] = ['long', 'edge', 'short'];
    return candidates.reduce((best, k) => (score[k] > score[best] ? k : best), 'short');
  }

  /**
   * 绘制本波所有开放路线。
   * 敌人仍会按复盘策略权重、心魔类型偏好和随机扰动选择其中一条实际分支。
   */
  private drawPath(activeKey: RouteKey): void {
    this.activePathKey = activeKey;
    const g = this.pathGfx;
    g.clear();
    this.pathArtLayer.removeAll(true);

    const activeRoutes = this.mapProjection.activeRoutes.length ? this.mapProjection.activeRoutes : [activeKey];
    const routeCells = new Set<string>();
    const collect = (route: GridPos[], target: Set<string>) => {
      for (const p of route) {
        const k = `${p.col},${p.row}`;
        target.add(k);
      }
    };
    for (const route of activeRoutes) collect(this.pathPool[route], routeCells);

    // 出生点和核心有专门的高层级视觉，不用普通路线格覆盖它们。
    const spawnKeys = new Set(
      Object.values(this.spawnPositions ?? { short: this.spawnPos, long: this.spawnPos, edge: this.spawnPos })
        .map((cell) => `${cell.col},${cell.row}`),
    );
    const coreKey  = `${this.corePos.col},${this.corePos.row}`;
    const hasPathArt = this.textures.exists('tile-path') && this.textures.exists('tile-path-active');
    const routeColor = (key: RouteKey) => key === 'short' ? 0xa78bfa : key === 'long' ? 0xf472b6 : 0x67e8f9;
    const drawPoly = (route: GridPos[], color: number, alpha: number, width = 2) => {
      if (route.length < 2) return;
      g.lineStyle(width, color, alpha);
      const pts = route.map(c => this.grid.cellCenter(c.col, c.row));
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.strokePath();
    };

    for (const route of this.mapProjection.inactiveRoutes) {
      const inactiveCells = this.pathPool[route];
      const inactiveKeys = new Set<string>();
      collect(inactiveCells, inactiveKeys);
      for (const k of inactiveKeys) {
        if (spawnKeys.has(k) || k === coreKey || routeCells.has(k)) continue;
        const [c, r] = k.split(',').map(Number);
        const center = this.grid.cellCenter(c, r);
        g.fillStyle(0x2b163c, 0.96)
          .fillRect(center.x - TILE / 2 + 3, center.y - TILE / 2 + 3, TILE - 6, TILE - 6);
        g.lineStyle(1.5, routeColor(route), 0.9)
          .strokeRect(center.x - TILE / 2 + 7, center.y - TILE / 2 + 7, TILE - 14, TILE - 14);
      }
      drawPoly(inactiveCells, routeColor(route), 0.82, 2);
    }

    const drawnActiveCells = new Set<string>();
    for (const route of activeRoutes) {
      const isPrimary = route === activeKey;
      for (const cell of this.pathPool[route]) {
        const k = `${cell.col},${cell.row}`;
        if (spawnKeys.has(k) || k === coreKey || drawnActiveCells.has(k)) continue;
        drawnActiveCells.add(k);
        const center = this.grid.cellCenter(cell.col, cell.row);
        if (hasPathArt) {
          g.fillStyle(isPrimary ? 0x8b3cc7 : 0x6130a0, isPrimary ? 0.96 : 0.9)
            .fillRect(center.x - TILE / 2 + 1, center.y - TILE / 2 + 1, TILE - 2, TILE - 2);
          const img = this.add.image(center.x, center.y, 'tile-path-active')
            .setDisplaySize(TILE - 2, TILE - 2)
            .setAlpha(1);
          this.pathArtLayer.add(img);
          continue;
        }
        g.fillStyle(0x6d36a8, isPrimary ? 1 : 0.92)
          .fillRect(center.x - TILE / 2, center.y - TILE / 2, TILE, TILE);
      }
    }

    for (const route of activeRoutes) {
      drawPoly(this.pathPool[route], routeColor(route), route === activeKey ? 1 : 0.94, route === activeKey ? 4 : 3);
    }
  }

  // ===================== 环境装饰 =====================

  private collectBuildCells(): void {
    this.buildCells = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (this.grid.get(c, r) === 'build') this.buildCells.push({ col: c, row: r });
      }
    }
  }

  /**
   * 静态装饰集中画进一个 Graphics：每个可建造格有微小“神经尘”，少量格子有脉冲突触环。
   * 这样能让棋盘有潜意识组织感，同时不拖慢 FPS。
   */
  private drawDecoration(): void {
    const g = this.decorationGfx;
    g.clear();

    // 每个可建造格中心点一点神经尘；角标由格子本身承担，避免视觉重复。
    g.fillStyle(0x6d5fb0, 0.55);
    for (const c of this.buildCells) {
      const p = this.grid.cellCenter(c.col, c.row);
      g.fillCircle(p.x, p.y, 1.4);
    }

    // 只给少量格子加脉冲突触环，保持画面活性但不扰乱读图。
    for (const ring of this.synapses) ring.destroy();
    this.synapses = [];
    const shuffled = [...this.buildCells].sort(() => Math.random() - 0.5);
    const synapseCount = Math.min(22, Math.floor(this.buildCells.length * 0.07));
    for (let i = 0; i < synapseCount; i++) {
      const cell = shuffled[i];
      if (!cell) break;
      const p = this.grid.cellCenter(cell.col, cell.row);
      const ring = this.add.circle(p.x, p.y, 5, 0xa78bfa, 0.10).setDepth(1)
        .setStrokeStyle(1, 0xa78bfa, 0.3);
      this.tweens.add({
        targets: ring,
        alpha: { from: 0.10, to: 0.42 },
        scale: { from: 0.7, to: 1.5 },
        duration: 1700 + Math.random() * 2400,
        yoyo: true,
        repeat: -1,
        delay: Math.random() * 1500,
        ease: 'Sine.easeInOut',
      });
      this.synapses.push(ring);
    }
  }

  /**
   * 定时在随机可建造格生成淡色符号并向上消散。
   * 这是主题氛围层，不参与玩法，也不会阻挡玩家读路线。
   */
  private startFloatingFragments(): void {
    if (this.fragmentTimer) this.fragmentTimer.remove(false);
    const glyphs = ['✦', '·', '∗', '◦', '⋅', '✧', '❉'];
    this.fragmentTimer = this.time.addEvent({
      delay: 650,
      loop: true,
      callback: () => {
        if (!this.buildCells.length) return;
        const cell = this.buildCells[Math.floor(Math.random() * this.buildCells.length)];
        const p = this.grid.cellCenter(cell.col, cell.row);
        const g = glyphs[Math.floor(Math.random() * glyphs.length)];
        const offX = (Math.random() - 0.5) * (TILE - 12);
        const offY = (Math.random() - 0.5) * (TILE - 12);
        const t = this.add.text(p.x + offX, p.y + offY, g, {
          fontSize: '10px',
          color: '#a78bfa',
        }).setOrigin(0.5).setAlpha(0).setDepth(3);
        this.tweens.add({
          targets: t, alpha: 0.55, y: t.y - 14, duration: 1300, ease: 'Sine.easeOut',
          onComplete: () => {
            this.tweens.add({
              targets: t, alpha: 0, y: t.y - 8, duration: 700,
              onComplete: () => t.destroy(),
            });
          },
        });
      },
    });
  }

  private drawSpawnAndCore(): void {
    const cp = this.grid.cellCenter(this.corePos.col, this.corePos.row);
    const hasSpawnArt = this.textures.exists('art-entry-portal');
    const hasCoreArt = this.textures.exists('art-self-core');

    const spawnCells = Array.from(
      new Map(
        Object.values(this.spawnPositions ?? { short: this.spawnPos, long: this.spawnPos, edge: this.spawnPos })
          .map((cell) => [this.keyOfCell(cell), cell]),
      ).values(),
    );
    for (const spawnCell of spawnCells) {
      const sp = this.grid.cellCenter(spawnCell.col, spawnCell.row);
      if (hasSpawnArt) {
        const portal = this.add.image(sp.x, sp.y, 'art-entry-portal')
          .setOrigin(0.5)
          .setDisplaySize(42, 42)
          .setDepth(7);
        const baseScaleX = portal.scaleX;
        const baseScaleY = portal.scaleY;
        this.tweens.add({
          targets: portal,
          scaleX: { from: baseScaleX, to: baseScaleX * 1.05 },
          scaleY: { from: baseScaleY, to: baseScaleY * 1.05 },
          alpha: { from: 0.98, to: 1 },
          duration: 1400,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      } else {
        this.add.rectangle(sp.x, sp.y, TILE - 4, TILE - 4, 0x3a1d2c, 0.92)
          .setStrokeStyle(1.5, 0xf472b6, 0.85).setDepth(5);
        this.add.circle(sp.x, sp.y, 9, 0xf472b6, 0.85).setDepth(6);
        this.add.circle(sp.x, sp.y, 4, 0xfdf2f8, 0.95).setDepth(7);
        const spawnRing = this.add.circle(sp.x, sp.y, 22, 0xf472b6, 0)
          .setStrokeStyle(2, 0xf472b6, 0.85).setDepth(6);
        spawnRing.setScale(0.6);
        this.tweens.add({
          targets: spawnRing, scale: 1.4, alpha: { from: 0.85, to: 0 },
          duration: 1300, repeat: -1, ease: 'Cubic.easeOut',
        });
      }
      this.add.text(sp.x, sp.y - 27, '入侵点', { fontSize: '11px', color: '#f472b6' })
        .setOrigin(0.5).setDepth(8).setShadow(0, 0, '#0b0a18', 4);
    }

    if (hasCoreArt) {
      const core = this.add.image(cp.x, cp.y, 'art-self-core')
        .setOrigin(0.5)
        .setDisplaySize(46, 46)
        .setDepth(7);
      const baseScaleX = core.scaleX;
      const baseScaleY = core.scaleY;
      this.tweens.add({
        targets: core,
        scaleX: { from: baseScaleX, to: baseScaleX * 1.04 },
        scaleY: { from: baseScaleY, to: baseScaleY * 1.04 },
        alpha: { from: 0.98, to: 1 },
        duration: 1900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else {
      const coreOuter = this.add.circle(cp.x, cp.y, 26, 0xfde68a, 0.10)
        .setStrokeStyle(1.5, 0xfde68a, 0.5).setDepth(5);
      this.tweens.add({
        targets: coreOuter, scale: { from: 1, to: 1.35 }, alpha: { from: 0.7, to: 0.15 },
        duration: 2200, repeat: -1, ease: 'Sine.easeOut',
      });
      const coreRing = this.add.circle(cp.x, cp.y, 20, 0xfde68a, 0.08)
        .setStrokeStyle(2, 0xfde68a, 0.95).setDepth(6);
      this.tweens.add({
        targets: coreRing, scale: { from: 1, to: 1.2 }, alpha: { from: 0.95, to: 0.55 },
        duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      this.add.circle(cp.x, cp.y, 11, 0xfde68a, 1).setDepth(6);
      this.add.circle(cp.x, cp.y, 4, 0xfffbeb, 1).setDepth(7);
    }
    this.add.text(cp.x, cp.y + 28, '自我核心', { fontSize: '11px', color: '#fde68a' })
      .setOrigin(0.5).setDepth(8).setShadow(0, 0, '#0b0a18', 4);
  }

  // ===================== HUD =====================

  private buildHUD(): void {
    const w = this.scale.width;
    // HUD 背景放在高 depth，避免被战场对象遮挡。
    const hudBg = this.add.rectangle(w / 2, 30, w, 60, 0x0b0a18, 0.92)
      .setStrokeStyle(1, 0x2a2548).setDepth(80);

    const HUD_DEPTH = 81;

    this.hudLeftBg = this.add.rectangle(14, 8, 292, 48, 0x120f24, 0.94)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x4c3a7c, 0.62)
      .setDepth(HUD_DEPTH - 0.5);
    this.waveText = this.add.text(28, 11, '', {
      fontSize: '14px', color: '#a78bfa',
    }).setLetterSpacing(1).setDepth(HUD_DEPTH);
    this.mindText = this.add.text(28, 34, '', {
      fontSize: '14px', color: '#fde68a',
    }).setDepth(HUD_DEPTH);
    this.hudText = this.add.text(340, 22, '', {
      fontSize: '13px', color: '#a39bc7',
    }).setDepth(HUD_DEPTH);

    // 先布局右侧图标组，再根据左边缘安放理智条，避免不同宽度屏幕上重叠。
    const iconRight = w - 28;
    const iconStep = 42;
    this.menuBtn = this.makeIconButton(iconRight, 30, '✕', () => {
      this.scene.start('MenuScene');
    }).setDepth(HUD_DEPTH);
    this.settingsBtn = this.makeIconButton(iconRight - iconStep, 30, '⚙', () => {
      showSettings(() => { /* no-op */ });
    }).setDepth(HUD_DEPTH);
    this.codexBtn = this.makeIconButton(iconRight - iconStep * 2, 30, '?', () => {
      showHelp(() => {});
    }).setDepth(HUD_DEPTH);

    // 理智条位于图标组左侧，并保留固定间距。
    const iconLeftEdge = iconRight - iconStep * 2 - 18;     // 最左侧图标的左边缘 x。
    const sanBarWidth = 200;
    const sanBarX = iconLeftEdge - sanBarWidth - 12;
    const sanBarY = 22;
    this.add.text(sanBarX - 64, sanBarY - 10, '理智值', {
      fontSize: '12px', color: '#a39bc7',
    }).setLetterSpacing(2).setDepth(HUD_DEPTH);
    this.sanityBarBg = this.add.rectangle(sanBarX, sanBarY, sanBarWidth, 14, 0x000000, 0.55)
      .setOrigin(0, 0).setStrokeStyle(1, 0x2a2548).setDepth(HUD_DEPTH);
    this.sanityBar = this.add.rectangle(sanBarX + 1, sanBarY + 1, sanBarWidth - 2, 12, 0x34d399, 1)
      .setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.sanityLabel = this.add.text(sanBarX + sanBarWidth / 2, sanBarY + 7, '', {
      fontSize: '11px', color: '#fff',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 1);

    this.bossSkillBg = this.add.rectangle(w / 2, 58, 740, 28, 0x2a1438, 0.9)
      .setStrokeStyle(1, 0xfb7185, 0.72)
      .setDepth(HUD_DEPTH + 1)
      .setVisible(false);
    this.bossSkillText = this.add.text(w / 2, 58, '', {
      fontSize: '12px',
      color: '#fde68a',
      align: 'center',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 2).setVisible(false);

    void hudBg;
    this.updateHUD();
  }

  private makeIconButton(x: number, y: number, glyph: string, onClick: () => void): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    // 可见圆盘让它读起来像按钮；更大的隐形点击区提升边缘点击容错。
    const bg = this.add.circle(0, 0, 16, 0xa78bfa, 0.12).setStrokeStyle(1.2, 0xa78bfa, 0.5);
    const t = this.add.text(0, 0, glyph, { fontSize: '15px', color: '#f5f3ff' }).setOrigin(0.5);
    const hit = this.add.zone(0, 0, 42, 42).setOrigin(0.5);
    c.add([bg, t, hit]);
    c.setSize(36, 36);
    hit.setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => {
      bg.setFillStyle(0xa78bfa, 0.32);
      this.input.manager.canvas.style.cursor = 'pointer';
    });
    hit.on('pointerout', () => {
      bg.setFillStyle(0xa78bfa, 0.12);
      this.input.manager.canvas.style.cursor = 'default';
    });
    hit.on('pointerdown', () => onClick());
    return c;
  }

  private buildToolbar(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const barY = h - 50;
    this.add.rectangle(w / 2, barY, w, 80, 0x0b0a18, 0.92).setStrokeStyle(1, 0x2a2548);

    const startX = 30;
    const towerButtonW = 108;
    const towerButtonStep = 112;
    let bx = startX + towerButtonW / 2;
    for (const k of ALL_TOWER_KINDS) {
      const def = TOWER_DEFS[k];
      const btn = this.add.container(bx, barY);
      const bg = this.add.rectangle(0, 0, towerButtonW, 56, 0xa78bfa, 0.06).setStrokeStyle(1, 0xa78bfa, 0.35);
      const artKey = `tower-${k}-lv1`;
      const icon = this.textures.exists(artKey)
        ? this.add.image(-38, 0, artKey).setDisplaySize(38, 38)
        : this.add.text(-38, 0, def.emoji, { fontSize: '24px', color: '#fff' }).setOrigin(0.5);
      const name = this.add.text(-15, -10, def.displayName, { fontSize: '11px', color: '#f5f3ff' }).setOrigin(0, 0.5);
      const cost = this.add.text(-15, 8, `${def.cost} 念力`, { fontSize: '10px', color: '#fde68a' }).setOrigin(0, 0.5);
      const hit = this.add.zone(0, 0, towerButtonW + 12, 72).setOrigin(0.5);
      btn.add([bg, icon, name, cost, hit]);
      btn.setSize(towerButtonW, 56);
      // 使用真实 Zone 子对象接点击，避免 Container hitArea 在矩形边角漏判。
      hit.setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => {
        if (this.selectedTowerKind !== k) bg.setFillStyle(0xa78bfa, 0.18);
        this.input.manager.canvas.style.cursor = 'pointer';
      });
      hit.on('pointerout', () => {
        if (this.selectedTowerKind !== k) bg.setFillStyle(0xa78bfa, 0.06);
        this.input.manager.canvas.style.cursor = 'default';
      });
      hit.on('pointerdown', () => {
        this.selectedTowerKind = (this.selectedTowerKind === k) ? null : k;
        this.sculptMode = false;
        this.refreshToolbar();
        this.refreshSculptButton();
        if (this.selectedTowerKind === k) {
          this.flashMessage(this.towerSelectionHint(k), '#fde68a', 2200);
        }
      });
      this.toolbarButtons.push({ kind: k, container: btn });
      bx += towerButtonStep;
    }

    // 玩家手动扩展可建造格。
    const sxSculpt = w - 505;
    this.sculptBtn = this.add.container(sxSculpt, barY);
    const scBg = this.add.rectangle(0, 0, 130, 50, 0x9fe870, 0.10).setStrokeStyle(1, 0x9fe870, 0.55);
    const scIcon = this.add.text(-44, 0, '+', { fontSize: '22px', color: '#d9f99d' }).setOrigin(0.5);
    this.sculptLabel = this.add.text(10, -6, '', { fontSize: '13px', color: '#d9f99d' }).setOrigin(0.5);
    const scHint = this.add.text(10, 13, '[S]', { fontSize: '9px', color: '#a39bc7' }).setOrigin(0.5);
    const scHit = this.add.zone(0, 0, 146, 66).setOrigin(0.5);
    this.sculptBtn.add([scBg, scIcon, this.sculptLabel, scHint, scHit]);
    this.sculptBtn.setSize(130, 50);
    scHit.setInteractive({ useHandCursor: true });
    scHit.on('pointerover', () => {
      if (!this.sculptMode) scBg.setFillStyle(0x9fe870, this.canEnterSculptMode() ? 0.22 : 0.08);
      this.input.manager.canvas.style.cursor = this.canEnterSculptMode() ? 'pointer' : 'not-allowed';
    });
    scHit.on('pointerout', () => {
      this.refreshSculptButton();
      this.input.manager.canvas.style.cursor = 'default';
    });
    scHit.on('pointerdown', () => this.toggleSculptMode());
    this.refreshSculptButton();

    // 倍速切换按钮。
    const sxSpeed = w - 350;
    this.speedBtn = this.add.container(sxSpeed, barY);
    const spBg = this.add.rectangle(0, 0, 110, 50, 0x67e8f9, 0.10).setStrokeStyle(1, 0x67e8f9, 0.55);
    const spIcon = this.add.text(-38, 0, '»', { fontSize: '20px', color: '#67e8f9' }).setOrigin(0.5);
    this.speedLabel = this.add.text(8, 0, '1×', { fontSize: '17px', color: '#67e8f9' }).setOrigin(0.5).setLetterSpacing(2);
    const spHint = this.add.text(8, 16, '[1/2/4]', { fontSize: '9px', color: '#a39bc7' }).setOrigin(0.5);
    const spHit = this.add.zone(0, 0, 126, 66).setOrigin(0.5);
    this.speedBtn.add([spBg, spIcon, this.speedLabel, spHint, spHit]);
    this.speedBtn.setSize(110, 50);
    spHit.setInteractive({ useHandCursor: true });
    spHit.on('pointerover', () => {
      spBg.setFillStyle(0x67e8f9, 0.22);
      this.input.manager.canvas.style.cursor = 'pointer';
    });
    spHit.on('pointerout', () => {
      spBg.setFillStyle(0x67e8f9, 0.10);
      this.input.manager.canvas.style.cursor = 'default';
    });
    spHit.on('pointerdown', () => this.cycleSpeed());

    // 开始波次按钮。
    const sx = w - 180;
    this.startWaveBtn = this.add.container(sx, barY);
    const sbg = this.add.rectangle(0, 0, 160, 50, 0x34d399, 0.18).setStrokeStyle(1, 0x34d399, 0.7);
    const stxt = this.add.text(0, 0, '开始下一波\n[Space]', { fontSize: '14px', color: '#34d399', align: 'center' }).setOrigin(0.5);
    const sHit = this.add.zone(0, 0, 178, 66).setOrigin(0.5);
    this.startWaveBtn.add([sbg, stxt, sHit]);
    this.startWaveBtn.setSize(160, 50);
    sHit.setInteractive({ useHandCursor: true });
    sHit.on('pointerover', () => {
      sbg.setFillStyle(0x34d399, 0.32);
      this.input.manager.canvas.style.cursor = 'pointer';
    });
    sHit.on('pointerout', () => {
      sbg.setFillStyle(0x34d399, 0.18);
      this.input.manager.canvas.style.cursor = 'default';
    });
    sHit.on('pointerdown', () => {
      if (this.phase === 'build') this.startWave();
    });
  }

  private cycleSpeed(): void {
    const cur = SPEED_PRESETS.indexOf(this.speedMul);
    const next = SPEED_PRESETS[(cur + 1) % SPEED_PRESETS.length];
    this.setSpeed(next);
  }

  private setSpeed(mul: 1 | 2 | 4): void {
    this.speedMul = mul;
    this.tweens.timeScale = mul;
    this.time.timeScale = mul;
    if (this.speedLabel) {
      this.speedLabel.setText(`${mul}×`);
      this.tweens.add({
        targets: this.speedBtn,
        scale: { from: 1.15, to: 1 },
        duration: 200,
        ease: 'Cubic.easeOut',
      });
    }
  }

  private refreshToolbar(): void {
    for (const t of this.toolbarButtons) {
      const bg = t.container.list[0] as Phaser.GameObjects.Rectangle;
      if (this.selectedTowerKind === t.kind) {
        bg.setFillStyle(0xa78bfa, 0.32);
        bg.setStrokeStyle(1.5, 0xfde68a, 0.95);
      } else {
        bg.setFillStyle(0xa78bfa, 0.06);
        bg.setStrokeStyle(1, 0xa78bfa, 0.35);
      }
    }
    this.refreshSculptButton();
  }

  private towerSelectionHint(kind: TowerKind): string {
    const def = TOWER_DEFS[kind];
    const role = ({
      memory: '范围伤害，适合焦虑群',
      belief: '单体高伤，专打抑郁厚血',
      resonance: '破隐减速，克制自责伪装',
      acceptance: '回复理智，低 SAN 时稳线',
      insight: '按当前生命扣血，适合首领和厚血',
      boundary: '只能放路线格，临时阻挡',
    } as Record<TowerKind, string>)[kind];
    return `${def.displayName}：${role}（右键/ESC 取消）`;
  }

  private canEnterSculptMode(): boolean {
    return this.phase === 'build' && this.mind >= SCULPT_COST;
  }

  private toggleSculptMode(): void {
    if (!this.canEnterSculptMode()) {
      if (this.phase === 'build') this.flashMessage(`念力不足（塑形需要 ${SCULPT_COST}）`, '#fb7185', 1200);
      return;
    }
    this.sculptMode = !this.sculptMode;
    if (this.sculptMode) {
      this.selectedTowerKind = null;
      this.closePopup();
      this.flashMessage(`塑形模式：点击普通阻塞格，消耗 ${SCULPT_COST} 念力改造成可建造格`, '#d9f99d', 2000);
    }
    this.refreshToolbar();
    this.refreshSculptButton();
  }

  private refreshSculptButton(): void {
    if (!this.sculptBtn || !this.sculptLabel) return;
    const bg = this.sculptBtn.list[0] as Phaser.GameObjects.Rectangle;
    const icon = this.sculptBtn.list[1] as Phaser.GameObjects.Text;
    const hint = this.sculptBtn.list[3] as Phaser.GameObjects.Text;
    const enabled = this.canEnterSculptMode();
    if (!enabled && this.sculptMode) this.sculptMode = false;
    this.sculptLabel.setText(`改地形 ${SCULPT_COST}`);
    if (this.sculptMode) {
      bg.setFillStyle(0x9fe870, 0.34);
      bg.setStrokeStyle(1.5, 0xfde68a, 0.95);
      icon.setColor('#fef9c3');
      this.sculptLabel.setColor('#fef9c3');
      hint.setColor('#fef9c3');
    } else if (enabled) {
      bg.setFillStyle(0x9fe870, 0.12);
      bg.setStrokeStyle(1, 0x9fe870, 0.65);
      icon.setColor('#d9f99d');
      this.sculptLabel.setColor('#d9f99d');
      hint.setColor('#a39bc7');
    } else {
      bg.setFillStyle(0x6e6e82, 0.08);
      bg.setStrokeStyle(1, 0x9696b8, 0.32);
      icon.setColor('#777890');
      this.sculptLabel.setColor('#777890');
      hint.setColor('#777890');
    }
  }

  private buildHoverPreview(): void {
    this.hoverPreview = this.add.container(0, 0).setVisible(false).setDepth(50);
    const ring = this.add.circle(0, 0, 16, 0xa78bfa, 0.4).setStrokeStyle(2, 0xa78bfa, 0.8);
    const range = this.add.circle(0, 0, 100, 0xa78bfa, 0.05).setStrokeStyle(1, 0xa78bfa, 0.3);
    this.hoverPreview.add([range, ring]);
  }

  private buildMessageBanner(): void {
    this.msgBg = this.add.rectangle(Math.round(this.scale.width / 2), 96, 420, 36, 0x0b0a18, 0.97)
      .setStrokeStyle(1, 0x4c3a7c, 0.7)
      .setDepth(39)
      .setAlpha(0);
    this.msgText = this.add.text(Math.round(this.scale.width / 2), 96, '', {
      fontSize: '16px',
      color: '#c4b5fd',
      stroke: '#080615',
      strokeThickness: 4,
      resolution: 2,
      align: 'center',
    }).setOrigin(0.5).setPadding(8, 4, 8, 4).setDepth(40).setAlpha(0);
  }

  private flashMessage(text: string, color = '#fde68a', durationMs = 1800): void {
    this.setMessageBannerText(text, color);
    this.msgText.setAlpha(0);
    this.msgBg.setAlpha(0);
    this.tweens.killTweensOf([this.msgText, this.msgBg]);
    this.tweens.add({
      targets: [this.msgText, this.msgBg],
      alpha: 1,
      duration: 220,
      onComplete: () => {
        this.tweens.add({
          targets: [this.msgText, this.msgBg],
          alpha: 0,
          delay: durationMs,
          duration: 600,
          onComplete: () => this.restorePersistentBuildMessage(),
        });
      },
    });
  }

  private showPersistentBuildMessage(text: string, color = '#a78bfa'): void {
    this.persistentBuildMessage = { text, color };
    this.tweens.killTweensOf([this.msgText, this.msgBg]);
    this.setMessageBannerText(text, color);
    this.msgBg.setAlpha(1);
    this.msgText.setAlpha(1);
  }

  private clearPersistentBuildMessage(): void {
    this.persistentBuildMessage = null;
    this.tweens.killTweensOf([this.msgText, this.msgBg]);
    this.msgBg.setAlpha(0);
    this.msgText.setAlpha(0);
  }

  private restorePersistentBuildMessage(): void {
    if (this.phase !== 'build' || !this.persistentBuildMessage) return;
    this.setMessageBannerText(this.persistentBuildMessage.text, this.persistentBuildMessage.color);
    this.msgBg.setAlpha(1);
    this.msgText.setAlpha(1);
  }

  private setMessageBannerText(text: string, color: string): void {
    const maxTextWidth = Math.max(360, Math.min(this.scale.width - 160, 1040));
    this.msgText.setWordWrapWidth(maxTextWidth, true);
    this.msgText.setText(text);
    this.msgText.setColor(color);
    this.msgText.setPosition(Math.round(this.scale.width / 2), 96);

    const bgWidth = Math.min(this.scale.width - 80, Math.max(420, this.msgText.displayWidth + 44));
    const bgHeight = Math.max(36, this.msgText.displayHeight + 14);
    this.msgBg.setPosition(Math.round(this.scale.width / 2), 96);
    this.msgBg.setSize(bgWidth, bgHeight);
  }

  private buildTutorialPanel(): void {
    const x = 20;
    const y = 78;
    const w = 430;
    const h = 122;
    this.tutorialBg = this.add.rectangle(x, y, w, h, 0x120f24, 0.88)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x67e8f9, 0.42)
      .setDepth(82)
      .setVisible(false);
    this.tutorialTitle = this.add.text(x + 16, y + 12, '', {
      fontSize: '13px',
      color: '#67e8f9',
      fontStyle: 'bold',
    }).setDepth(83).setVisible(false);
    this.tutorialBody = this.add.text(x + 16, y + 36, '', {
      fontSize: '12px',
      color: '#d8d3f0',
      lineSpacing: 6,
      wordWrap: { width: w - 32, useAdvancedWrap: true },
    }).setDepth(83).setVisible(false);
    this.tutorialIcon = this.add.image(x + w - 58, y + 68, 'art-mind-cache')
      .setDisplaySize(44, 44)
      .setDepth(84)
      .setVisible(false);
    this.tutorialIconLabel = this.add.text(x + w - 58, y + 96, '念力残堆', {
      fontSize: '10px',
      color: '#fde68a',
    }).setOrigin(0.5).setDepth(84).setVisible(false);
    this.tutorialToggleBg = this.add.rectangle(0, 0, 28, 24, 0x18253a, 0.92)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x67e8f9, 0.55)
      .setDepth(85)
      .setVisible(false);
    this.tutorialToggleText = this.add.text(0, 0, '−', {
      fontSize: '12px',
      color: '#67e8f9',
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(86).setVisible(false);
    this.tutorialToggleHit = this.add.zone(0, 0, 28, 24)
      .setOrigin(0, 0)
      .setDepth(87)
      .setVisible(false);
    this.tutorialToggleHit.setInteractive({ useHandCursor: true });
    this.tutorialToggleHit.on('pointerdown', () => {
      this.tutorialCollapsed = !this.tutorialCollapsed;
      this.updateTutorialPanel();
    });
  }

  private updateTutorialPanel(): void {
    if (!this.tutorialBg) return;
    const tip = (this.phase === 'build' || this.phase === 'combat')
      ? getTutorialTip(this.currentWaveIdx + 1, this.currentLevel.id)
      : null;
    const visible = !!tip;
    if (!visible) {
      this.tutorialBg.setVisible(false);
      this.tutorialTitle.setVisible(false);
      this.tutorialBody.setVisible(false);
      this.tutorialIcon.setVisible(false);
      this.tutorialIconLabel.setVisible(false);
      this.setTutorialToggleVisible(false);
      return;
    }

    if (this.tutorialCollapsed) {
      this.tutorialBg.setVisible(false);
      this.tutorialTitle.setVisible(false);
      this.tutorialBody.setVisible(false);
      this.tutorialIcon.setVisible(false);
      this.tutorialIconLabel.setVisible(false);
      this.layoutTutorialToggle(20, 78, 112, 30, '教学提示');
      return;
    }

    this.tutorialBg.setVisible(true);
    this.tutorialTitle.setVisible(true);
    this.tutorialBody.setVisible(true);
    this.tutorialIcon.setVisible(false);
    this.tutorialIconLabel.setVisible(false);

    const showCacheIcon = this.currentLevel.id === DEFAULT_LEVEL_ID && this.currentWaveIdx === 0;
    this.tutorialBody.setWordWrapWidth(showCacheIcon ? 302 : 398, true);
    this.tutorialTitle.setText(tip.title);
    this.tutorialBody.setText(this.currentTutorialBody(tip));
    this.tutorialIcon.setVisible(showCacheIcon);
    this.tutorialIconLabel.setVisible(showCacheIcon);
    const targetHeight = Math.max(116, 52 + this.tutorialBody.height);
    this.tutorialBg.setSize(this.tutorialBg.width, targetHeight);
    this.layoutTutorialToggle(20 + this.tutorialBg.width - 38, 88, 26, 24, '−');
  }

  private setTutorialToggleVisible(visible: boolean): void {
    this.tutorialToggleBg.setVisible(visible);
    this.tutorialToggleText.setVisible(visible);
    this.tutorialToggleHit.setVisible(visible);
  }

  private layoutTutorialToggle(x: number, y: number, w: number, h: number, label: string): void {
    this.tutorialToggleBg
      .setPosition(x, y)
      .setSize(w, h)
      .setVisible(true);
    this.tutorialToggleText
      .setPosition(x + w / 2, y + h / 2)
      .setText(label)
      .setVisible(true);
    this.tutorialToggleHit
      .setPosition(x, y)
      .setSize(w, h)
      .setVisible(true);
  }

  private currentTutorialBody(tip: TutorialTip): string {
    if (this.currentLevel.id === DEFAULT_LEVEL_ID) return tip.body;
    const wave = this.waves[this.currentWaveIdx];
    if (!wave) return tip.body;

    return [
      tip.body,
      this.currentRouteHint(wave),
      tip.routeNote,
    ].filter(Boolean).join('\n');
  }

  private currentRouteHint(wave: WaveSpec): string {
    const activeRoute = this.computeActivePathKey(wave);
    const openRoutes = this.openRoutesForWave(wave, activeRoute);
    const pressure = this.routePressureHint(wave);
    const openText = openRoutes.map(routeVariantLabel).join(' / ');
    return `当前开放：${openText}；主压力：${pressure}。`;
  }

  private routePressureHint(wave: WaveSpec): string {
    const counts: Record<RouteVariant, number> = { short: 0, long: 0, edge: 0 };
    let randomCount = 0;
    for (const spawn of wave.spawns) {
      if (spawn.pathBias === 'random') {
        randomCount++;
        continue;
      }
      counts[resolveRouteVariant(spawn.pathBias, wave.index)]++;
    }

    const routeEntries = EXPORT_ROUTES
      .filter((route) => counts[route] > 0)
      .sort((a, b) => counts[b] - counts[a])
      .map((route) => `${routeVariantLabel(route)}×${counts[route]}`);
    if (randomCount > 0) routeEntries.push(`随机分路×${randomCount}`);
    return routeEntries.join(' / ') || routeVariantLabel(this.computeActivePathKey(wave));
  }

  private updateHUD(): void {
    const waveNo = this.currentWaveIdx + 1;
    const titleCandidates = [
      `${this.currentLevel.name} · 第 ${waveNo}/${TOTAL_WAVES} 波`,
      `${this.currentLevel.name} · ${waveNo}/${TOTAL_WAVES}`,
      `第 ${waveNo}/${TOTAL_WAVES} 波`,
    ];
    for (const title of titleCandidates) {
      this.waveText.setText(title);
      if (this.waveText.displayWidth <= 390 || title === titleCandidates[titleCandidates.length - 1]) break;
    }
    this.mindText.setText(`念力 ${this.mind}`);
    this.layoutHudLeftPanel();
    const ratio = Math.max(0, this.sanity / this.sanityMax);
    this.sanityBar.width = 198 * ratio;
    if (ratio > 0.5) this.sanityBar.fillColor = 0x34d399;
    else if (ratio > 0.25) this.sanityBar.fillColor = 0xfbbf24;
    else this.sanityBar.fillColor = 0xfb7185;
    this.sanityLabel.setText(`${Math.max(0, Math.ceil(this.sanity))} / ${this.sanityMax}`);

    const phaseLabel: Record<Phase, string> = {
      intro: '梦境会话',
      build: '布防阶段',
      combat: '战斗中',
      review: '复盘中',
      gameover: '失败',
      victory: '胜利',
    };
    this.layoutHudStatus(phaseLabel[this.phase], this.enemies.filter(e => e.alive).length);
    this.updateTutorialPanel();
  }

  private layoutHudLeftPanel(): void {
    const width = Math.min(430, Math.max(220, this.waveText.displayWidth + 28, this.mindText.displayWidth + 28));
    this.hudLeftBg.setSize(width, 50);
  }

  private layoutHudStatus(phaseText: string, aliveCount: number): void {
    const gap = 28;
    const waveRight = this.hudLeftBg.x + this.hudLeftBg.displayWidth;
    const statusX = Math.max(340, waveRight + gap);
    const sanityLeft = this.sanityBarBg.x - 72;
    const maxWidth = Math.max(96, sanityLeft - statusX);
    const candidates = [
      `${phaseText}  ·  存活心魔 ${aliveCount}`,
      `${phaseText} · 心魔 ${aliveCount}`,
      `${phaseText} · ${aliveCount}`,
    ];

    this.hudText.setPosition(statusX, 22);
    for (const text of candidates) {
      this.hudText.setText(text);
      if (this.hudText.displayWidth <= maxWidth || text === candidates[candidates.length - 1]) break;
    }
  }

  // ===================== 阶段：开场剧情 =====================

  private async openVignetteForCurrentWave(): Promise<void> {
    this.phase = 'intro';
    this.updateHUD();
    const settings = loadSettings();
    const v = await runDirector({
      settings,
      wave: this.currentWaveIdx + 1,
      emotionHint: fallbackVignette(this.currentWaveIdx + 1, this.currentLevel.id).emotion,
      levelId: this.currentLevel.id,
      levelName: this.currentLevel.name,
    });
    showVignette(v, () => this.enterBuildPhase());
  }

  private enterBuildPhase(): void {
    this.phase = 'build';
    const wave = this.waves[this.currentWaveIdx];
    this.mind += Math.round(wave.mindGift * this.currentLevel.mindGiftMul);
    this.reprojectMapForWave(wave, this.currentWaveIdx > 0);
    this.refreshSculptButton();
    const routeLabel = this.routeLabelFromKey(this.activePathKey);
    this.showPersistentBuildMessage(`${this.currentLevel.name} · 第 ${this.currentWaveIdx + 1} 波 · ${routeLabel}（[空格] 开始）`, '#a78bfa');
    this.updateHUD();
  }

  private routeLabelFromKey(key: RouteKey): string {
    const routes = this.mapProjection.activeRoutes.map(routeVariantLabel).join(' / ');
    return `地图：${routeVariantLabel(key)} · 开放：${routes}`;
  }

  // ===================== 阶段：战斗 =====================

  private async startWave(): Promise<void> {
    if (this.phase !== 'build') return;
    this.clearPersistentBuildMessage();
    this.sculptMode = false;
    this.refreshToolbar();
    this.refreshSculptButton();

    const wave = this.waves[this.currentWaveIdx];
    if (wave.isBoss) {
      const persona = getBossPersona(this.currentLevel.id, wave.index);
      if (persona) {
        this.bossNegotiationApplied = await this.runBossNegotiation(wave.index, persona);
      } else {
        this.bossNegotiationApplied = { ...NEUTRAL_RESOLUTION };
      }
    } else {
      this.bossNegotiationApplied = { ...NEUTRAL_RESOLUTION };
    }

    this.phase = 'combat';
    this.battleLog = new BattleLog(this.currentWaveIdx + 1, this.sanity, this.mind);
    this.currentWaveStats = this.createWaveStatsDraft(this.currentWaveIdx + 1);
    this.nextBossCoreTickAt = this.gameTime + getBossCombatConfig().coreTickIntervalMs;
    this.nextBossSummonAt = 0;
    this.mirrorEchoQueue = [];
    this.mirrorEchoTriggers = new WeakMap();
    // 刷怪时间写入 gameTime 坐标；gameTime 不随波次清零，方便统一倍速和冷却。
    this.spawnQueue = wave.spawns.map(s => ({
      spawnAt: this.gameTime + s.delayMs,
      spec: s,
      isBossSpawn: s.hpMul >= 5,
    }));
    this.spawnQueue.sort((a, b) => a.spawnAt - b.spawnAt);
    this.flashMessage(`${this.currentLevel.name} · 第 ${this.currentWaveIdx + 1} 波  ·  心魔降临`, '#f472b6', 2400);
    Sound.play('wave_start');
    this.updateHUD();
  }

  private async runBossNegotiation(waveIndex: number, persona: import('../../types').BossPersona): Promise<NegotiationResolution> {
    return new Promise((resolve) => {
      const totalTurns = totalDialogueTurns(this.currentLevel.id, waveIndex);
      let turnIdx = 0;
      let lastTag: ChoiceTag | null = null;
      let resolution: NegotiationResolution = { ...NEUTRAL_RESOLUTION };

      const handle = openNegotiation(persona, turnIdx, totalTurns);
      const settings = loadSettings();

      const renderTurn = async () => {
        handle.showLoading('它正在斟酌……');
        const turn = await runNegotiation({
          settings,
          persona,
          lastPlayerTag: lastTag,
          turnIndex: turnIdx,
        }, waveIndex, this.currentLevel.id);
        await handle.showTurn(turn, (choice) => {
          lastTag = choice.tag;
          resolution = applyChoiceTag(resolution, choice.tag);
          turnIdx++;
          if (turnIdx >= totalTurns) {
            handle.showResolution(resolution.specialNote, () => resolve(resolution));
          } else {
            renderTurn();
          }
        });
      };

      renderTurn();
    });
  }

  private spawnNext(): void {
    while (this.spawnQueue.length && this.spawnQueue[0].spawnAt <= this.gameTime) {
      const s = this.spawnQueue.shift()!;
      this.spawnEnemyFromSpec(s.spec, s.isBossSpawn);
    }
    while (this.mirrorEchoQueue.length && this.mirrorEchoQueue[0].spawnAt <= this.gameTime) {
      const echo = this.mirrorEchoQueue.shift()!;
      const openGateCount = this.mapElements.filter((element) => (
        element.kind === 'mirror_gate' && element.alive && element.spec.pairId === echo.pairId
      )).length;
      if (openGateCount < 2) continue;
      this.spawnEnemyFromSpec(echo.spec, false, echo.route, echo.progressRatio, 0.4);
    }
  }

  private spawnEnemyFromSpec(
    spec: EnemySpawnSpec,
    isBoss: boolean,
    forcedRoute?: RouteVariant,
    progressRatio = 0,
    bountyMul = 1,
  ): Enemy {
    const route = forcedRoute ?? pickRouteForEnemy(spec, this.mapProjection.activeRoutes, this.currentWaveIdx + 1);
    const path = this.pathPool[route];
    this.recordRoutePick(route);
    const scale = this.computeWaveScale(this.currentWaveIdx, isBoss);
    const enemy = new Enemy(this, {
      spec,
      path,
      routeVariant: route,
      grid: this.grid,
      isBoss,
      bossDamageMul: this.bossNegotiationApplied.damageMul,
      bossHpMul: this.bossNegotiationApplied.hpMul,
      bossSpeedMul: this.bossNegotiationApplied.speedMul,
      waveHpMul: scale.hp,
      waveSpeedMul: scale.spd,
      waveDamageMul: scale.dmg,
      waveBountyMul: scale.bounty * bountyMul,
    });
    if (progressRatio > 0) {
      enemy.progressDist = Math.min(enemy.pathLen - 1, Math.max(0, enemy.pathLen * progressRatio));
      enemy.segIdx = 0;
      enemy.update(this.gameTime, 0);
    }
    this.enemies.push(enemy);
    if (isBoss) this.onBossSpawned(enemy);
    return enemy;
  }

  private createWaveStatsDraft(waveIndex: number): WaveStatsDraft {
    return {
      waveIndex,
      outcome: null,
      sanityAfter: this.sanity,
      enemiesKilled: 0,
      enemiesLeaked: 0,
      deathsByTower: {},
      routeCounts: { short: 0, long: 0, edge: 0 },
      totalRoutePicks: 0,
    };
  }

  private recordRoutePick(route: RouteVariant): void {
    if (!this.currentWaveStats) return;
    this.currentWaveStats.routeCounts[route]++;
    this.currentWaveStats.totalRoutePicks++;
  }

  private finalizeWaveStats(summary: BattleSummary): void {
    if (!this.currentWaveStats) return;
    if (this.runStats.some(stats => stats.waveIndex === summary.waveIndex)) return;

    const deathsByTower: WaveStatsDraft['deathsByTower'] = {};
    for (const entry of summary.log) {
      deathsByTower[entry.killedBy] = (deathsByTower[entry.killedBy] ?? 0) + 1;
    }

    const total = Math.max(1, this.currentWaveStats.totalRoutePicks);
    const routeUsagePct: Record<RouteVariant, number> = {
      short: +((this.currentWaveStats.routeCounts.short / total) * 100).toFixed(1),
      long: +((this.currentWaveStats.routeCounts.long / total) * 100).toFixed(1),
      edge: +((this.currentWaveStats.routeCounts.edge / total) * 100).toFixed(1),
    };

    this.runStats.push({
      waveIndex: summary.waveIndex,
      outcome: summary.outcome,
      sanityAfter: Math.max(0, Math.round(summary.sanityAfter)),
      enemiesKilled: summary.enemiesKilled,
      enemiesLeaked: summary.enemiesLeaked,
      deathsByTower,
      routeCounts: { ...this.currentWaveStats.routeCounts },
      routeUsagePct,
    });
    this.currentWaveStats = null;
  }

  private onBossSpawned(boss: Enemy): void {
    const bossCfg = getBossCombatConfig();
    this.nextBossSummonAt = this.gameTime + bossCfg.summonIntervalMs;
    const skill = this.currentBossSkillKind();
    const enraged = this.isBossEnraged();
    const name = skill ? bossCfg.skills[skill].displayName : 'Boss';
    this.flashMessage(`${name} 技能已展开${enraged ? ' · 狂暴' : ''}`, enraged ? '#fb7185' : '#fde68a', 2600);
    const ring = this.add.circle(boss.body.x, boss.body.y, 18, enraged ? 0xfb7185 : 0xfde68a, 0)
      .setStrokeStyle(3, enraged ? 0xfb7185 : 0xfde68a, 0.95)
      .setDepth(35);
    this.tweens.add({
      targets: ring,
      radius: 96,
      alpha: 0,
      duration: 900,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  private currentBossSkillKind(): BossSkillKind | null {
    const boss = this.activeBoss();
    if (boss) {
      return ({
        anxiety: 'anxiety_core',
        depression: 'depression_core',
        obsession: 'obsession_core',
        guilt: 'guilt_core',
        ptsd: 'ptsd_core',
      } as const)[boss.def.kind];
    }
    const waveIndex = this.currentWaveIdx + 1;
    return getBossCombatConfig().waveSkills[waveIndex] ?? null;
  }

  private isBossEnraged(): boolean {
    return this.bossNegotiationApplied.endingTag === 'confront';
  }

  private activeBoss(): Enemy | null {
    return this.enemies.find(e => e.alive && e.isBoss) ?? null;
  }

  private processBossSkills(): void {
    for (const enemy of this.enemies) {
      enemy.bossAuraSpeedMul = 1;
      enemy.bossAuraDamageMul = 1;
      enemy.bossAuraDamageTakenMul = 1;
    }

    const skill = this.currentBossSkillKind();
    const boss = this.activeBoss();
    if (!skill || !boss) {
      this.refreshBossSkillBanner(null, false);
      return;
    }

    const enraged = this.isBossEnraged();
    const bossCfg = getBossCombatConfig();
    const skillCfg = bossCfg.skills[skill];
    if (skill === 'anxiety_core') {
      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        enemy.bossAuraSpeedMul = skillCfg.auraSpeedMul;
        if (enraged) enemy.bossAuraDamageMul = skillCfg.enragedDamageMul;
      }
    } else {
      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        enemy.applyBossHpShield(skillCfg.shieldMaxHpRatio);
        if (enraged) enemy.bossAuraDamageTakenMul = skillCfg.enragedDamageTakenMul;
      }
    }

    this.refreshBossSkillBanner(skill, enraged);
    if (this.nextBossSummonAt <= 0) this.nextBossSummonAt = this.gameTime + bossCfg.summonIntervalMs;
    if (this.gameTime >= this.nextBossSummonAt) {
      this.nextBossSummonAt += bossCfg.summonIntervalMs;
      this.summonBossMinion(skill, boss);
    }
  }

  private refreshBossSkillBanner(skill: BossSkillKind | null, enraged: boolean): void {
    if (!this.bossSkillBg || !this.bossSkillText) return;
    if (!skill) {
      this.bossSkillBg.setVisible(false);
      this.bossSkillText.setVisible(false);
      return;
    }
    const bossCfg = getBossCombatConfig();
    const skillCfg = bossCfg.skills[skill];
    const summonSeconds = Math.round(bossCfg.summonIntervalMs / 1000);
    const minionName = ENEMY_DEFS[skillCfg.minion.kind].displayName;
    const text = skill === 'anxiety_core'
      ? `BOSS 技能：${skillCfg.displayName} · 全场心魔 x${skillCfg.auraSpeedMul.toFixed(2)} 移速${enraged ? ` · 狂暴：攻击 x${skillCfg.enragedDamageMul.toFixed(2)}` : ''} · 每 ${summonSeconds} 秒召唤 ${minionName}`
      : `BOSS 技能：${skillCfg.displayName} · 全场心魔 +${Math.round(skillCfg.shieldMaxHpRatio * 100)}% 最大生命护盾${enraged ? ` · 狂暴：受伤 x${skillCfg.enragedDamageTakenMul.toFixed(2)}` : ''} · 每 ${summonSeconds} 秒召唤 ${minionName}`;
    this.bossSkillText.setText(text);
    this.bossSkillText.setColor(enraged ? '#fecdd3' : '#fde68a');
    this.bossSkillBg.setStrokeStyle(1.5, enraged ? 0xfb7185 : 0xfde68a, 0.85);
    this.bossSkillBg.setVisible(true);
    this.bossSkillText.setVisible(true);
  }

  private summonBossMinion(skill: BossSkillKind, boss: Enemy): void {
    const minionCfg = getBossCombatConfig().skills[skill].minion;
    const spec: EnemySpawnSpec = {
      kind: minionCfg.kind,
      delayMs: 0,
      hpMul: minionCfg.hpMul,
      speedMul: minionCfg.speedMul,
      pathBias: minionCfg.pathBias,
      skills: [...minionCfg.skills],
    };
    const scale = this.computeWaveScale(this.currentWaveIdx, false);
    const minion = new Enemy(this, {
      spec,
      path: boss.pathCells,
      routeVariant: boss.routeVariant,
      grid: this.grid,
      waveHpMul: scale.hp,
      waveSpeedMul: scale.spd,
      waveDamageMul: scale.dmg,
      waveBountyMul: scale.bounty,
    });
    this.recordRoutePick(boss.routeVariant);
    minion.progressDist = Math.min(boss.progressDist, Math.max(0, minion.pathLen - 1));
    minion.segIdx = Math.min(boss.segIdx, Math.max(0, minion.cumDist.length - 2));
    minion.body.setPosition(boss.body.x, boss.body.y);
    minion.pathProgress = minion.getProgress();
    this.enemies.push(minion);

    const color = skill === 'anxiety_core' ? 0xfb7185 : 0x6366f1;
    const ring = this.add.circle(boss.body.x, boss.body.y, 12, color, 0)
      .setStrokeStyle(2, color, 0.9)
      .setDepth(34);
    this.tweens.add({
      targets: ring,
      radius: 46,
      alpha: 0,
      duration: 520,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  /**
   * 每波成长倍率。第 1 波是设计基线，之后逐波提高威胁。
   * 生命和伤害涨幅更明显，迫使玩家升级/改建；速度只小幅增长，避免读图失控。
   * Boss 额外加成，因为每个 Boss 都承担一个剧情关口。
   */
  private computeWaveScale(waveIdx: number, isBoss: boolean): {
    hp: number; spd: number; dmg: number; bounty: number;
  } {
    const cfg = getWaveScalingConfig();
    const i = Math.max(0, waveIdx);
    const late = Math.max(0, i - (cfg.lateStartWave - 1));
    let hp     = 1 + cfg.hpPerWave * i + cfg.hpLatePerWave * late;
    let spd    = 1 + cfg.speedPerWave * i + cfg.speedLatePerWave * late;
    let dmg    = 1 + cfg.damagePerWave * i + cfg.damageLatePerWave * late;
    const bounty = 1 + cfg.bountyPerWave * i;
    hp *= this.currentLevel.globalHpMul;
    spd *= this.currentLevel.globalSpeedMul;
    if (isBoss) {
      hp  *= cfg.bossHpMul;
      dmg *= cfg.bossDamageMul;
      // Boss 不提高速度，保持首领战节奏可读。
    }
    return { hp, spd, dmg, bounty };
  }

  // ===================== 帧更新 =====================

  update(_realTime: number, deltaMs: number): void {
    // 限制 deltaMs，避免浏览器标签页恢复后一次性跳太远，再乘以倍速。
    const cappedDelta = Math.min(deltaMs, 80);
    const gd = cappedDelta * this.speedMul;
    this.gameTime += gd;

    if (this.phase === 'combat') {
      this.spawnNext();
      this.processBossSkills();
      this.processMapElementMovementAuras();
      for (const e of this.enemies) e.update(this.gameTime, gd);
      this.processMirrorGates();
      this.processTrialObelisks();
      this.processBoundaryBlocks(gd);
      this.processBossCoreAttacks();
      if (this.phase !== 'combat') {
        this.updateHUD();
        return;
      }
      this.processArrivals();
      for (const t of this.towers) t.update(this.gameTime, this.enemies, this.mindCaches, this.mapElements, (tower) => this.depressionDebuffFor(tower));
      this.processMindCaches();
      this.processMapElements();
      this.processAcceptance(gd);
      this.processHallucination(this.gameTime);
      if (this.spawnQueue.length === 0 && this.mirrorEchoQueue.length === 0 && this.enemies.length === 0) {
        this.endWave();
      }
    }
    this.updateHUD();
  }

  private processBossCoreAttacks(): void {
    const attackers = this.enemies.filter(e => e.alive && e.isBoss && e.attackingCore);
    if (!attackers.length) return;
    if (this.gameTime < this.nextBossCoreTickAt) return;

    const bossCfg = getBossCombatConfig();
    this.nextBossCoreTickAt = this.gameTime + bossCfg.coreTickIntervalMs;
    const totalDamage = attackers.reduce((sum, e) => {
      return sum + Math.max(bossCfg.coreMinDamage, Math.round(e.effectiveDamage() * bossCfg.coreDamageFactor));
    }, 0);
    this.sanity = Math.max(0, this.sanity - totalDamage);
    this.flashSanityHit();
    Sound.play('sanity_hit');
    this.flashMessage(`首领正在压迫自我核心：理智 -${totalDamage}`, '#fb7185', 800);

    if (this.sanity <= 0) {
      this.gameOver();
    }
  }

  private processArrivals(): void {
    const survivors: Enemy[] = [];
    for (const e of this.enemies) {
      if (!e.alive) {
        const entry: CombatLogEntry = {
          enemyKind: e.def.kind,
          personaName: e.persona.name,
          killedBy: e.deathCause,
          pathProgress: e.pathProgress,
          diedAt: this.grid.pixelToCell(e.diedAtX, e.diedAtY),
          hpRemain: Math.max(0, e.hp),
        };
        if (e.reachedCore) {
          this.sanity = Math.max(0, this.sanity - e.effectiveDamage());
          this.flashSanityHit();
          Sound.play('sanity_hit');
          this.battleLog?.recordLeaked(entry);
          if (this.sanity <= 0) {
            this.gameOver();
            return;
          }
        } else {
          this.mind += e.bounty;
          Sound.play('enemy_die');
          this.battleLog?.recordKilled(entry);
        }
      } else {
        survivors.push(e);
      }
    }
    this.enemies = survivors;
  }

  private flashSanityHit(): void {
    this.cameras.main.flash(220, 248, 113, 113, false);
    this.cameras.main.shake(150, 0.005);
  }

  private processAcceptance(gameDelta: number): void {
    let regen = 0;
    for (const t of this.towers) {
      if (t.kind === 'acceptance' && !t.hallucinated) {
        regen += (gameDelta / 1000) * (0.45 + 0.2 * (t.level - 1));
      }
    }
    if (regen > 0) {
      this.sanity = Math.min(this.sanityMax, this.sanity + regen);
    }
  }

  private processHallucination(gameTime: number): void {
    if (gameTime < this.hallucinationCheckAt) return;
    this.hallucinationCheckAt = gameTime + 1500;
    if (this.sanity / this.sanityMax > 0.3) return;

    const lowness = 1 - (this.sanity / this.sanityMax) / 0.3;
    if (Math.random() < 0.18 * lowness) {
      const candidates = this.towers.filter(t => !t.hallucinated);
      if (!candidates.length) return;
      const t = candidates[Math.floor(Math.random() * candidates.length)];
      t.setHallucination(true, 3500, gameTime);
      this.flashMessage(`${TOWER_DEFS[t.kind].displayName} 出现幻觉！`, '#fb7185', 1800);
    }
  }

  private depressionDebuffFor(tower: Tower): number {
    let max = 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.def.behavior !== 'aura') continue;
      const dx = e.body.x - tower.pos.x;
      const dy = e.body.y - tower.pos.y;
      if (dx * dx + dy * dy < 90 * 90) {
        const mag = tower.kind === 'resonance' ? 0.2 : 0.4;
        if (mag > max) max = mag;
      }
    }
    if (max > 0) {
      for (const t of this.towers) {
        if (t.kind !== 'acceptance' || t.hallucinated) continue;
        const dx = t.pos.x - tower.pos.x;
        const dy = t.pos.y - tower.pos.y;
        if (dx * dx + dy * dy < 110 * 110) {
          max = 0;
          break;
        }
      }
    }
    return max;
  }

  // ===================== 波次结束 / 复盘 / 终局 =====================

  private async endWave(): Promise<void> {
    if (this.phase !== 'combat') return;
    this.phase = 'review';
    Sound.play('review_open');
    this.updateHUD();

    const cleared = this.sanity > 0;
    const summary: BattleSummary = this.battleLog!.finalize({
      sanityAfter: this.sanity,
      mindAfter: this.mind,
      towerLayout: this.towers.map(t => ({ kind: t.kind, col: t.cell.col, row: t.cell.row, level: t.level })),
      outcome: cleared ? 'cleared' : 'failed',
    });
    this.finalizeWaveStats(summary);

    if (this.currentWaveIdx === TOTAL_WAVES - 1 && cleared) {
      this.victory();
      return;
    }

    const loadingHandle = showReview({
      result: { monologue: '', lesson: [], next_strategy: { path_weight_shift: 'short', skill_priority: [], formation: 'scattered', aggression: 0, preferred_kinds: [] }, fromLLM: false },
      changes: [],
      nextWaveLabel: '',
      isLoading: true,
      onLoadingMsg: '心魔们正在低声商议……',
      onContinue: () => {},
    });

    const settings = loadSettings();
    const result: ReviewResult = await runReviewAgent({
      settings,
      summary,
      allUnlocked: this.levelHasAllUnlocks(),
    });

    let changes: string[] = [];
    let nextWaveBefore: AgentProofSnapshot['nextWaveBefore'] = null;
    let nextWaveAfter: AgentProofSnapshot['nextWaveAfter'] = null;
    let mapChange: AgentProofSnapshot['mapChange'];
    if (this.currentWaveIdx + 1 < this.waves.length) {
      const nextWave = this.waves[this.currentWaveIdx + 1];
      nextWaveBefore = summarizeWaveForProof(nextWave);
      const apply = applyStrategy(nextWave, result.next_strategy, { allUnlocked: this.levelHasAllUnlocks() });
      this.waves[this.currentWaveIdx + 1] = apply.applied;
      this.waveMapAggression.set(this.currentWaveIdx + 1, result.next_strategy.aggression);
      const afterRoute = this.computeActivePathKey(apply.applied);
      const forceOpenRoutes = this.openRoutesForWave(apply.applied, afterRoute);
      const afterMap = createMapProjection(this.grid.cfg, {
        activeRoute: afterRoute,
        waveIndex: apply.applied.index,
        aggression: result.next_strategy.aggression,
        forceOpenRoutes,
        occupiedCells: this.occupiedTowerCells(),
        extraBuildCells: this.playerBuildCells,
        levelId: this.currentLevel.id,
        disabledMapElementIds: Array.from(this.destroyedMapElementIds),
      });
      mapChange = {
        before: this.mapProjection.summary,
        after: afterMap.summary,
      };
      changes = [
        ...apply.changes,
        `路线网络：${mapChange.before.activeRouteLabel} → ${mapChange.after.activeRouteLabel}`,
        `开放路线：${mapChange.after.activeRoutes.map(routeVariantLabel).join(' / ')}`,
        `防守塔位：${mapChange.after.buildCellCount} 格（随路线网络重投影）`,
      ];
      changes.push(`塑形改为消耗念力：每次 ${SCULPT_COST} 念力`);
      nextWaveAfter = summarizeWaveForProof(apply.applied);
    }

    const proof: AgentProofSnapshot = {
      summary: summarizeBattleForProof(summary),
      source: result.fromLLM ? 'llm' : 'fallback',
      mode: settings.demoMode ? 'demo' : 'online',
      status: result.fromLLM ? 'llm_parsed' : settings.demoMode ? 'demo_fallback' : 'online_fallback',
      strategy: result.next_strategy,
      changes,
      nextWaveBefore,
      nextWaveAfter,
    };
    if (mapChange) proof.mapChange = mapChange;

    loadingHandle.close();
    setTimeout(() => {
      showReview({
        result,
        changes,
        proof,
        nextWave: this.waves[this.currentWaveIdx + 1],
        nextWaveLabel: `进入第 ${this.currentWaveIdx + 2} 波`,
        onContinue: () => {
          this.currentWaveIdx++;
          if (this.currentWaveIdx >= TOTAL_WAVES) {
            this.victory();
          } else {
            this.openVignetteForCurrentWave();
          }
        },
      });
    }, 220);
  }

  private syncMapElementsForWave(): void {
    for (const element of this.mapElements) element.removeSilently();
    this.mapElements = this.mapProjection.mapElements.map((spec) => (
      new MapElementActor(this, { spec, grid: this.grid })
    ));
  }

  private activeMapElements(kind: MapElementActor['kind']): MapElementActor[] {
    return this.mapElements.filter((element) => element.alive && element.kind === kind);
  }

  private processMapElementMovementAuras(): void {
    this.processBreathVents();
    this.processFractureNodes();
  }

  private processBreathVents(): void {
    const vents = this.activeMapElements('breath_vent');
    if (!vents.length) return;

    const phase: 'inhale' | 'exhale' = Math.floor(this.gameTime / 6000) % 2 === 0 ? 'inhale' : 'exhale';
    if (this.currentLevel.rule === 'breath_phase' && this.lastBreathPhase !== phase) {
      this.lastBreathPhase = phase;
      this.flashMessage(phase === 'inhale' ? '吸气错拍：心魔加速' : '呼气错拍：心魔暴露', phase === 'inhale' ? '#67e8f9' : '#fde68a', 900);
    }

    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.attackingCore) continue;
      for (const vent of vents) {
        if (!this.withinElementRadius(enemy.body.x, enemy.body.y, vent)) continue;
        const effect = vent.spec.effectMul || 1.22;
        if (phase === 'inhale') {
          enemy.applySpeedBuff(effect, 260, this.gameTime);
        } else {
          enemy.bossAuraDamageTakenMul *= Math.max(1, 1 + (effect - 1) * 0.82);
        }
      }
    }
  }

  private processFractureNodes(): void {
    const nodes = this.activeMapElements('fracture_node');
    if (!nodes.length) return;
    for (const node of nodes) {
      if (this.fractureSuppressedByBoundary(node)) continue;
      for (const enemy of this.enemies) {
        if (!enemy.alive || enemy.routeVariant !== 'edge' || enemy.attackingCore) continue;
        if (!this.withinElementRadius(enemy.body.x, enemy.body.y, node)) continue;
        enemy.applySpeedBuff(node.spec.effectMul || 1.3, 260, this.gameTime);
      }
    }
  }

  private processMirrorGates(): void {
    const gates = this.activeMapElements('mirror_gate');
    if (!gates.length) return;

    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.spec.echoClone || enemy.attackingCore) continue;
      for (const gate of gates) {
        if (!this.withinElementRadius(enemy.body.x, enemy.body.y, gate)) continue;
        const triggered = this.mirrorEchoTriggers.get(enemy) ?? new Set<string>();
        if (triggered.has(gate.spec.id)) continue;
        triggered.add(gate.spec.id);
        this.mirrorEchoTriggers.set(enemy, triggered);

        const pair = gates.find((item) => item !== gate && item.spec.pairId && item.spec.pairId === gate.spec.pairId);
        if (!pair) continue;
        const route = pair.spec.route ?? gate.spec.route ?? enemy.routeVariant;
        const echoSpec: EnemySpawnSpec = {
          ...enemy.spec,
          delayMs: 0,
          hpMul: enemy.spec.hpMul * (gate.spec.effectMul || 0.55),
          speedMul: enemy.spec.speedMul,
          skills: [...enemy.spec.skills],
          echoClone: true,
        };
        this.mirrorEchoQueue.push({
          spawnAt: this.gameTime + (gate.spec.cooldownMs || 5500),
          spec: echoSpec,
          route,
          progressRatio: 0.32,
          pairId: gate.spec.pairId,
        });
        this.mirrorEchoQueue.sort((a, b) => a.spawnAt - b.spawnAt);
        this.flashMapElementPulse(gate, 0xa78bfa);
      }
    }
  }

  private processTrialObelisks(): void {
    for (const enemy of this.enemies) enemy.mapElementTaunt = false;
    const obelisks = this.activeMapElements('trial_obelisk');
    if (!obelisks.length) return;

    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.attackingCore) continue;
      const elite = enemy.isBoss || enemy.spec.skills.includes('taunt') || enemy.spec.skills.includes('shield');
      if (!elite) continue;
      for (const obelisk of obelisks) {
        if (!this.withinElementRadius(enemy.body.x, enemy.body.y, obelisk)) continue;
        enemy.mapElementTaunt = true;
        enemy.bossAuraDamageTakenMul *= obelisk.spec.effectMul || 0.75;
        enemy.applyMapHpShield(obelisk.spec.id, 0.1);
      }
    }
  }

  private processMapElements(): void {
    const survivors: MapElementActor[] = [];
    let mapChanged = false;
    for (const element of this.mapElements) {
      if (element.alive) {
        survivors.push(element);
        continue;
      }
      if (element.rewarded) continue;
      element.rewarded = true;
      if (element.reward > 0) {
        this.mind += element.reward;
        this.floatMindReward(element.pos.x, element.pos.y, element.reward);
        Sound.play('enemy_die');
      }
      if (element.kind === 'dry_well') {
        this.destroyedMapElementIds.add(element.spec.id);
        mapChanged = this.openDryWellBuildCells(element) || mapChanged;
      }
    }
    this.mapElements = survivors;
    if (mapChanged) {
      this.drawGrid();
      this.collectBuildCells();
      this.drawDecoration();
      this.drawPath(this.activePathKey);
      this.syncMindCachesForMap();
      this.refreshSculptButton();
    }
  }

  private openDryWellBuildCells(element: MapElementActor): boolean {
    const radius = Math.max(1, Math.round(element.spec.radiusCells || 1));
    const candidates: GridPos[] = [];
    for (let row = element.cell.row - radius; row <= element.cell.row + radius; row++) {
      for (let col = element.cell.col - radius; col <= element.cell.col + radius; col++) {
        const cell = { col, row };
        if (!this.grid.inBounds(col, row)) continue;
        if (this.grid.get(col, row) !== 'block') continue;
        if (this.grid.getTowerId(col, row) > 0) continue;
        if (this.mindCacheAt(cell)) continue;
        if (this.playerBuildCells.some((item) => this.keyOfCell(item) === this.keyOfCell(cell))) continue;
        candidates.push(cell);
      }
    }
    candidates.sort((a, b) => {
      const da = Math.abs(a.col - element.cell.col) + Math.abs(a.row - element.cell.row);
      const db = Math.abs(b.col - element.cell.col) + Math.abs(b.row - element.cell.row);
      return da - db;
    });
    const opened = candidates.slice(0, 6);
    for (const cell of opened) {
      this.playerBuildCells.push({ ...cell });
      this.grid.set(cell.col, cell.row, 'build');
      this.mapProjection.buildCells.push({ ...cell });
    }
    if (opened.length) {
      this.mapProjection.summary.buildCellCount += opened.length;
      this.mapProjection.summary.towerPocketCount += opened.length;
      this.mapProjection.summary.blockedCellCount = Math.max(0, this.mapProjection.summary.blockedCellCount - opened.length);
      this.flashMessage(`枯井释放塔位 +${opened.length}`, '#fde68a', 1400);
    }
    return opened.length > 0;
  }

  private fractureSuppressedByBoundary(node: MapElementActor): boolean {
    const radius = node.radiusPx(TILE) + 18;
    const r2 = radius * radius;
    return this.towers.some((tower) => {
      if (tower.kind !== 'boundary' || tower.hallucinated) return false;
      const dx = tower.pos.x - node.body.x;
      const dy = tower.pos.y - node.body.y;
      return dx * dx + dy * dy <= r2;
    });
  }

  private withinElementRadius(x: number, y: number, element: MapElementActor): boolean {
    const radius = Math.max(TILE * 0.72, element.radiusPx(TILE));
    const dx = x - element.body.x;
    const dy = y - element.body.y;
    return dx * dx + dy * dy <= radius * radius;
  }

  private flashMapElementPulse(element: MapElementActor, color: number): void {
    const ring = this.add.circle(element.body.x, element.body.y, 10, color, 0)
      .setStrokeStyle(2, color, 0.82)
      .setDepth(34);
    this.tweens.add({
      targets: ring,
      radius: Math.max(38, element.radiusPx(TILE)),
      alpha: 0,
      duration: 520,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  private processBoundaryBlocks(gameDelta: number): void {
    const blockers = this.towers.filter(t => t.kind === 'boundary');
    if (!blockers.length) return;
    const destroyed = new Set<Tower>();
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.attackingCore) continue;
      for (const tower of blockers) {
        if (destroyed.has(tower)) continue;
        const attackPerSecond = Math.max(12, enemy.effectiveDamage() * (enemy.isBoss ? 3.0 : 2.1));
        const damage = attackPerSecond * (gameDelta / 1000);
        if (tower.blockEnemy(enemy, this.gameTime, damage)) {
          destroyed.add(tower);
          break;
        }
        const dx = enemy.body.x - tower.pos.x;
        const dy = enemy.body.y - tower.pos.y;
        if (dx * dx + dy * dy <= 28 * 28) break;
      }
    }
    for (const tower of destroyed) {
      if (!this.towers.includes(tower)) continue;
      this.removeTower(tower);
      this.flashMessage('边界桩被心魔击碎', '#fb7185', 900);
    }
  }

  private syncMindCachesForMap(): void {
    const survivors: MindCache[] = [];
    for (const cache of this.mindCaches) {
      if (!cache.alive) continue;
      if (this.canHostMindCache(cache.cell) && !this.isSuppressedByDryWell(cache.cell)) {
        survivors.push(cache);
      } else {
        cache.removeSilently();
      }
    }
    this.mindCaches = survivors;

    const cacheCfg = getMindCacheConfig();
    const scarcity = this.currentLevel.rule === 'scarcity';
    const baseTargetCount = cacheCfg.baseCount + Math.min(
      cacheCfg.maxCountBonus,
      this.currentWaveIdx * cacheCfg.countPerWave,
    );
    const targetCount = scarcity ? Math.max(2, Math.round(baseTargetCount * 0.55)) : baseTargetCount;
    if (this.mindCaches.length >= targetCount) return;

    const occupied = new Set(this.mindCaches.map(cache => this.keyOfCell(cache.cell)));
    const candidates: GridPos[] = [];
    for (let row = 1; row < GRID_ROWS - 1; row++) {
      for (let col = 1; col < GRID_COLS - 1; col++) {
        const cell = { col, row };
        if (!this.canHostMindCache(cell)) continue;
        if (occupied.has(this.keyOfCell(cell))) continue;
        if (this.isSuppressedByDryWell(cell)) continue;
        if (!this.isNearBuildCell(cell, cacheCfg.nearBuildRadiusSq)) continue;
        candidates.push(cell);
      }
    }

    candidates.sort(() => Math.random() - 0.5);
    while (this.mindCaches.length < targetCount && candidates.length) {
      const cell = candidates.pop()!;
      const hp = Math.round((cacheCfg.baseHp
        + this.currentWaveIdx * cacheCfg.hpPerWave
        + Math.floor(Math.random() * cacheCfg.hpRandom)) * (scarcity ? 0.9 : 1));
      const reward = Math.round((cacheCfg.baseReward
        + Math.min(cacheCfg.rewardWaveCap, this.currentWaveIdx * cacheCfg.rewardPerWave)
        + Math.floor(Math.random() * cacheCfg.rewardRandom)) * (scarcity ? 1.75 : 1));
      this.mindCaches.push(new MindCache(this, { cell, grid: this.grid, hp, reward }));
      occupied.add(this.keyOfCell(cell));
    }
  }

  private canHostMindCache(cell: GridPos): boolean {
    if (!this.grid.inBounds(cell.col, cell.row)) return false;
    if (this.grid.get(cell.col, cell.row) !== 'block') return false;
    if (this.grid.getTowerId(cell.col, cell.row) > 0) return false;
    return !this.playerBuildCells.some(c => this.keyOfCell(c) === this.keyOfCell(cell));
  }

  private isSuppressedByDryWell(cell: GridPos): boolean {
    const point = this.grid.cellCenter(cell.col, cell.row);
    return this.mapElements.some((element) => (
      element.alive &&
      element.kind === 'dry_well' &&
      this.withinElementRadius(point.x, point.y, element)
    ));
  }

  private isNearBuildCell(cell: GridPos, radiusSq: number): boolean {
    for (const build of this.buildCells) {
      const dx = build.col - cell.col;
      const dy = build.row - cell.row;
      if (dx * dx + dy * dy <= radiusSq) return true;
    }
    return false;
  }

  private mindCacheAt(cell: GridPos): MindCache | null {
    const key = this.keyOfCell(cell);
    return this.mindCaches.find(cache => cache.alive && this.keyOfCell(cache.cell) === key) ?? null;
  }

  private processMindCaches(): void {
    const survivors: MindCache[] = [];
    for (const cache of this.mindCaches) {
      if (cache.alive) {
        survivors.push(cache);
        continue;
      }
      if (!cache.rewarded) {
        cache.rewarded = true;
        this.mind += cache.reward;
        this.floatMindReward(cache.pos.x, cache.pos.y, cache.reward);
        Sound.play('enemy_die');
      }
    }
    this.mindCaches = survivors;
    this.refreshSculptButton();
  }

  private floatMindReward(x: number, y: number, reward: number): void {
    const t = this.add.text(x, y - 22, `+${reward} 念力`, {
      fontSize: '13px',
      color: '#fde68a',
      fontFamily: 'inherit',
    }).setOrigin(0.5, 1).setDepth(45).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: t.y - 6, duration: 160, ease: 'Sine.easeOut' });
    this.tweens.add({
      targets: t,
      alpha: 0,
      y: t.y - 22,
      delay: 620,
      duration: 420,
      onComplete: () => t.destroy(),
    });
  }

  private gameOver(): void {
    if (this.phase === 'gameover') return;
    if (this.battleLog) {
      const summary = this.battleLog.finalize({
        sanityAfter: this.sanity,
        mindAfter: this.mind,
        towerLayout: this.towers.map(t => ({ kind: t.kind, col: t.cell.col, row: t.cell.row, level: t.level })),
        outcome: 'failed',
      });
      this.finalizeWaveStats(summary);
    }
    this.phase = 'gameover';
    Sound.play('gameover');
    this.updateHUD();

    // 手动遮罩：先渐暗 → 950ms后弹出UI → UI内部再淡入
    const w = this.scale.width, h = this.scale.height;
    const darkOverlay = this.add.rectangle(w / 2, h / 2, w, h, 0x0b0a18, 0).setDepth(899);
    this.tweens.add({ targets: darkOverlay, alpha: 0.95, duration: 900, ease: 'Cubic.easeIn' });
    this.time.delayedCall(950, () => {
      this.showEndPanel({
        title: '梦境溃散',
        subtitle: 'GAME OVER',
        body: '理智值归零。她在凌晨醒来，浑身是汗。\n但她记得你曾走到过这里——下一轮再来一次吧。',
        primaryLabel: '返回主页',
        primaryAction: () => {
          this.cameras.main.fadeFrom(0);
          this.scene.start('MenuScene');
        },
      });
    });
  }

  private victory(): void {
    this.phase = 'victory';
    Sound.play('victory');
    this.updateHUD();
    this.cameras.main.flash(400, 254, 230, 138);
    this.time.delayedCall(450, () => {
      this.showEndPanel({
        title: '黎明',
        subtitle: 'VICTORY',
        body: '所有心魔都被你认了出来。\n她在床头放了一杯温水，今天，她想真的好好睡一觉。',
        primaryLabel: '回到主菜单',
        primaryAction: () => this.scene.start('MenuScene'),
      });
    });
  }

  private formatRunStatsForPanel(): string {
    if (!this.runStats.length) return '';
    const lines = this.runStats.map(stats => {
      const outcome = stats.outcome === 'failed' ? '失败' : '通关';
      const kills = EXPORT_TOWERS
        .map(kind => `${kind}:${stats.deathsByTower[kind] ?? 0}`)
        .filter(part => !part.endsWith(':0'))
        .join(' ');
      const routes = EXPORT_ROUTES
        .map(route => `${route}:${stats.routeUsagePct[route].toFixed(0)}%`)
        .join(' ');
      return `W${String(stats.waveIndex).padStart(2, '0')} ${outcome} SAN ${stats.sanityAfter} 漏怪 ${stats.enemiesLeaked} 击杀塔种 ${kills || '无'} 路线 ${routes}`;
    });
    return ['战斗统计', ...lines].join('\n');
  }

  private exportBattleStatsCsv(): void {
    if (!this.runStats.length) {
      this.flashMessage('暂无可导出的战斗统计', '#fde68a', 1200);
      return;
    }

    const csv = this.buildBattleStatsCsv();
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `cognitive-siege-battle-stats-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    this.flashMessage('战斗统计 CSV 已导出', '#34d399', 1400);
  }

  private buildBattleStatsCsv(): string {
    const headers = [
      'wave',
      'outcome',
      'sanity_after',
      'enemies_killed',
      'enemies_leaked',
      ...EXPORT_TOWERS.map(kind => `kills_${kind}`),
      'kills_unknown',
      'route_short_count',
      'route_long_count',
      'route_edge_count',
      'route_short_pct',
      'route_long_pct',
      'route_edge_pct',
    ];

    const rows = this.runStats.map(stats => [
      stats.waveIndex,
      stats.outcome,
      stats.sanityAfter,
      stats.enemiesKilled,
      stats.enemiesLeaked,
      ...EXPORT_TOWERS.map(kind => stats.deathsByTower[kind] ?? 0),
      stats.deathsByTower.unknown ?? 0,
      stats.routeCounts.short,
      stats.routeCounts.long,
      stats.routeCounts.edge,
      stats.routeUsagePct.short,
      stats.routeUsagePct.long,
      stats.routeUsagePct.edge,
    ]);

    return [headers, ...rows]
      .map(row => row.map(cell => this.csvCell(cell)).join(','))
      .join('\n');
  }

  private csvCell(value: string | number): string {
    const text = String(value);
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  }

  private showEndPanel(opts: { title: string; subtitle: string; body: string; primaryLabel: string; primaryAction: () => void; }): void {
    const dw = this.cameras.main.displayWidth;
    const dh = this.cameras.main.displayHeight;
    const cx = dw / 2;
    const cy = dh / 2;
    const PANEL_MAX_W = Math.min(dw - 80, 780);
    const PANEL_PADDING = 42;
    const TITLE_GAP = 22;
    const BODY_GAP = 28;
    const BUTTON_GAP = 42;
    const BUTTON_H = 48;

    const dim = this.add.rectangle(cx, cy, dw, dh, 0x0b0a18, 0.92).setDepth(900);
    const panelBg = this.add.rectangle(cx, cy, PANEL_MAX_W + PANEL_PADDING * 2, 0, 0x1a1630, 0.95)
      .setDepth(901).setAlpha(0);

    // 计算内容高度
    const titleT = this.add.text(0, 0, opts.title, { fontSize: '36px', color: '#a78bfa' })
      .setOrigin(0.5)
      .setPadding(18, 4, 18, 4);
    const subT = this.add.text(0, 0, opts.subtitle, { fontSize: '13px', color: '#a39bc7', letterSpacing: 6 }).setOrigin(0.5);
    const bodyT = this.add.text(0, 0, opts.body, {
      fontSize: '14px', color: '#f5f3ff', align: 'center', lineSpacing: 10,
      wordWrap: { width: PANEL_MAX_W - 36 },
    }).setOrigin(0.5);
    const statsText = this.formatRunStatsForPanel();
    const statsT = this.add.text(0, 0, statsText, {
      fontSize: '12px', color: '#c4b5fd', align: 'left', lineSpacing: 4,
      wordWrap: { width: PANEL_MAX_W - 24 },
    }).setOrigin(0.5).setVisible(statsText.length > 0);
    const btnT = this.add.text(0, 0, opts.primaryLabel, { fontSize: '15px', color: '#f5f3ff' })
      .setOrigin(0.5)
      .setPadding(10, 2, 10, 2);

    const statsBlockH = statsText.length > 0 ? statsT.height + 16 : 0;
    const contentH = titleT.height + TITLE_GAP + subT.height + BODY_GAP + bodyT.height + statsBlockH + BUTTON_GAP + BUTTON_H;
    panelBg.setDisplaySize(PANEL_MAX_W + PANEL_PADDING * 2, contentH + PANEL_PADDING * 2);
    panelBg.setAlpha(0);

    const startY = cy - contentH / 2;
    let cursorY = startY;
    titleT.setPosition(cx, cursorY + titleT.height / 2).setDepth(902).setAlpha(0);
    cursorY += titleT.height + TITLE_GAP;
    subT.setPosition(cx, cursorY + subT.height / 2).setDepth(902).setAlpha(0);
    cursorY += subT.height + BODY_GAP;
    bodyT.setPosition(cx, cursorY + bodyT.height / 2).setDepth(902).setAlpha(0);
    cursorY += bodyT.height;
    if (statsText.length > 0) {
      cursorY += 16;
      statsT.setPosition(cx, cursorY + statsT.height / 2).setDepth(902).setAlpha(0);
      cursorY += statsT.height;
    } else {
      statsT.setDepth(902).setAlpha(0);
    }
    cursorY += BUTTON_GAP;

    const btnY = cursorY + BUTTON_H / 2;
    const hasExport = this.runStats.length > 0;
    const btn = this.add.container(hasExport ? cx - 150 : cx, btnY).setDepth(902).setAlpha(0);
    const btnBg = this.add.rectangle(0, 0, 260, BUTTON_H, 0xa78bfa, 0.2).setStrokeStyle(1, 0xa78bfa, 0.7);
    const hit = this.add.zone(0, 0, 280, 64).setOrigin(0.5);
    btn.add([btnBg, btnT, hit]);
    btn.setSize(260, BUTTON_H);
    hit.setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => { btnBg.setFillStyle(0xa78bfa, 0.35); this.input.manager.canvas.style.cursor = 'pointer'; });
    hit.on('pointerout', () => { btnBg.setFillStyle(0xa78bfa, 0.2); this.input.manager.canvas.style.cursor = 'default'; });
    hit.on('pointerdown', () => opts.primaryAction());

    let exportBtn: Phaser.GameObjects.Container | null = null;
    if (hasExport) {
      exportBtn = this.add.container(cx + 150, btnY).setDepth(902).setAlpha(0);
      const exportBg = this.add.rectangle(0, 0, 260, BUTTON_H, 0x34d399, 0.16).setStrokeStyle(1, 0x34d399, 0.72);
      const exportT = this.add.text(0, 0, '导出战斗统计 CSV', { fontSize: '15px', color: '#ecfdf5' })
        .setOrigin(0.5)
        .setPadding(10, 2, 10, 2);
      const exportHit = this.add.zone(0, 0, 280, 64).setOrigin(0.5);
      exportBtn.add([exportBg, exportT, exportHit]);
      exportBtn.setSize(260, BUTTON_H);
      exportHit.setInteractive({ useHandCursor: true });
      exportHit.on('pointerover', () => { exportBg.setFillStyle(0x34d399, 0.28); this.input.manager.canvas.style.cursor = 'pointer'; });
      exportHit.on('pointerout', () => { exportBg.setFillStyle(0x34d399, 0.16); this.input.manager.canvas.style.cursor = 'default'; });
      exportHit.on('pointerdown', () => this.exportBattleStatsCsv());
    }

    const allFade = [dim, panelBg, titleT, subT, bodyT, statsT, btn, ...(exportBtn ? [exportBtn] : [])];
    this.tweens.add({ targets: allFade, alpha: 1, duration: 600, ease: 'Cubic.easeOut' });

    // 销毁旧残留
    if ((this as any)._endPanelObjs) {
      ((this as any)._endPanelObjs as Phaser.GameObjects.GameObject[]).forEach(o => o.destroy());
    }
    (this as any)._endPanelObjs = allFade;
  }

  // ===================== 鼠标交互 =====================

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (this.sculptMode) {
      const cell = this.grid.pixelToCell(p.x, p.y);
      if (!this.canSculptCell(cell)) {
        this.hoverPreview.setVisible(false);
        return;
      }
      const center = this.grid.cellCenter(cell.col, cell.row);
      const ring = this.hoverPreview.list[1] as Phaser.GameObjects.Arc;
      const range = this.hoverPreview.list[0] as Phaser.GameObjects.Arc;
      ring.setRadius(18);
      ring.fillColor = 0x9fe870;
      ring.setStrokeStyle(2, 0xd9f99d, 0.95);
      range.setRadius(TILE * 0.55);
      range.fillColor = 0x9fe870;
      range.setStrokeStyle(1, 0xd9f99d, 0.55);
      this.hoverPreview.setPosition(center.x, center.y);
      this.hoverPreview.setVisible(true);
      return;
    }

    if (!this.selectedTowerKind) {
      this.hoverPreview.setVisible(false);
      return;
    }
    const cell = this.grid.pixelToCell(p.x, p.y);
    if (!this.canPlaceTowerAt(this.selectedTowerKind, cell)) {
      this.hoverPreview.setVisible(false);
      return;
    }
    const center = this.grid.cellCenter(cell.col, cell.row);
    const def = TOWER_DEFS[this.selectedTowerKind];
    const ring = this.hoverPreview.list[1] as Phaser.GameObjects.Arc;
    const range = this.hoverPreview.list[0] as Phaser.GameObjects.Arc;
    ring.setRadius(def.placement === 'path' ? 18 : 16);
    ring.fillColor = def.color;
    ring.setStrokeStyle(2, def.color, 0.85);
    range.setRadius(def.placement === 'path' ? TILE * 0.55 : def.range);
    range.fillColor = def.color;
    range.setStrokeStyle(1, def.color, 0.4);
    this.hoverPreview.setPosition(center.x, center.y);
    this.hoverPreview.setVisible(true);
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (this.phase === 'gameover' || this.phase === 'victory') return;

    // 右键是全局取消：清除放置光标或关闭管理弹层，不执行建造/打开操作。
    if (p.rightButtonDown()) {
      if (this.selectedTowerKind) {
        this.selectedTowerKind = null;
        this.refreshToolbar();
        this.hoverPreview.setVisible(false);
      }
      if (this.sculptMode) {
        this.sculptMode = false;
        this.refreshSculptButton();
        this.hoverPreview.setVisible(false);
      }
      this.closePopup();
      return;
    }

    if (this.sculptMode) {
      const cell = this.grid.pixelToCell(p.x, p.y);
      this.sculptCellAt(cell);
      return;
    }

    // 1) 当前选中待放置塔时，优先尝试建造。
    if (this.selectedTowerKind) {
      const cell = this.grid.pixelToCell(p.x, p.y);
      if (this.canPlaceTowerAt(this.selectedTowerKind, cell)) {
        this.placeTowerAt(this.selectedTowerKind, cell);
      }
      return;
    }

    // 2) 未选塔时，点击已有塔则打开管理弹层。
    const cell = this.grid.pixelToCell(p.x, p.y);
    if (!this.grid.inBounds(cell.col, cell.row)) return;
    const towerId = this.grid.getTowerId(cell.col, cell.row);
    if (towerId > 0) {
      const tower = this.towers.find(t => t.id === towerId);
      if (tower) this.openTowerPopup(tower, p);
    }
  }

  private placeTowerAt(kind: TowerKind, cell: GridPos): void {
    const def = TOWER_DEFS[kind];
    if (this.mind < def.cost) {
      this.flashMessage(`念力不足（需要 ${def.cost}）`, '#fb7185', 1300);
      return;
    }
    if (!this.canPlaceTowerAt(kind, cell)) {
      if (this.isSuppressedByDryWell(cell)) {
        this.flashMessage('枯井压制中：先打掉枯井再建塔', '#fde68a', 1400);
        return;
      }
      this.flashMessage(def.placement === 'path' ? '边界桩只能种在路线格上' : '这里不是可建造格', '#fb7185', 1100);
      return;
    }
    this.mind -= def.cost;
    const tower = new Tower(this, { kind, cell, grid: this.grid });
    this.towers.push(tower);
    this.grid.placeTower(cell.col, cell.row, tower.id, def.placement);
    this.flashBuildEffect(tower.pos.x, tower.pos.y, def.color);
    Sound.play('tower_place');
    this.refreshSculptButton();
  }

  private canPlaceTowerAt(kind: TowerKind, cell: GridPos): boolean {
    const def = TOWER_DEFS[kind];
    if (this.isSuppressedByDryWell(cell)) return false;
    return this.grid.canPlaceTower(cell.col, cell.row, def.placement);
  }

  private canSculptCell(cell: GridPos): boolean {
    if (this.phase !== 'build') return false;
    if (this.mind < SCULPT_COST) return false;
    if (!this.grid.inBounds(cell.col, cell.row)) return false;
    if (cell.col <= 0 || cell.row <= 0 || cell.col >= GRID_COLS - 1 || cell.row >= GRID_ROWS - 1) return false;
    if (this.grid.get(cell.col, cell.row) !== 'block') return false;
    if (this.grid.getTowerId(cell.col, cell.row) > 0) return false;
    if (this.mindCacheAt(cell)) return false;
    if (this.isSuppressedByDryWell(cell)) return false;
    return true;
  }

  private sculptCellAt(cell: GridPos): void {
    if (!this.canSculptCell(cell)) {
      if (this.mindCacheAt(cell)) {
        this.flashMessage('这里有念力残堆：先让塔打破它', '#fde68a', 1300);
        return;
      }
      if (this.mind < SCULPT_COST) {
        this.flashMessage(`念力不足（塑形需要 ${SCULPT_COST}）`, '#fb7185', 1200);
        return;
      }
      if (this.isSuppressedByDryWell(cell)) {
        this.flashMessage('枯井压制中：先打掉枯井再开塔位', '#fde68a', 1400);
        return;
      }
      this.flashMessage('这里不能塑形：只能改造普通阻塞格', '#fb7185', 1100);
      return;
    }

    this.mind -= SCULPT_COST;
    const key = this.keyOfCell(cell);
    if (!this.playerBuildCells.some((c) => this.keyOfCell(c) === key)) {
      this.playerBuildCells.push({ col: cell.col, row: cell.row });
    }
    this.grid.set(cell.col, cell.row, 'build');
    this.mapProjection.buildCells.push({ col: cell.col, row: cell.row });
    this.mapProjection.summary.buildCellCount += 1;
    this.mapProjection.summary.towerPocketCount += 1;
    this.mapProjection.summary.blockedCellCount = Math.max(0, this.mapProjection.summary.blockedCellCount - 1);

    this.drawGrid();
    this.collectBuildCells();
    this.drawDecoration();
    this.drawPath(this.activePathKey);
    const p = this.grid.cellCenter(cell.col, cell.row);
    this.flashBuildEffect(p.x, p.y, 0x9fe870);
    this.flashMessage(`新增可建造格（消耗 ${SCULPT_COST} 念力）`, '#d9f99d', 1400);
    Sound.play('tower_place');
    this.refreshToolbar();
    this.refreshSculptButton();
    if (this.mind < SCULPT_COST) this.hoverPreview.setVisible(false);
  }

  private openTowerPopup(tower: Tower, _p: Phaser.Input.Pointer): void {
    this.closePopup();
    tower.setRangeHighlighted(true);
    // 将游戏画布坐标换算成浏览器视口 CSS 像素，供 DOM 弹层定位。
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / this.scale.width;
    const scaleY = rect.height / this.scale.height;
    const screenX = rect.left + tower.pos.x * scaleX;
    const screenY = rect.top + (tower.pos.y - tower.def.radius - 6) * scaleY;

    const upgradeCost = tower.getUpgradeCost();
    const sellRefund = tower.getSellValue();
    const handle = showTowerActionPopup({
      x: screenX,
      y: screenY,
      kind: tower.kind,
      level: tower.level,
      damageLabel: tower.getDamageLabel(),
      rangeLabel: tower.getRangeLabel(),
      fireRateLabel: tower.getFireRateLabel(),
      upgradeCost,
      sellRefund,
      canAfford: upgradeCost != null && this.mind >= upgradeCost,
      onUpgrade: () => {
        if (upgradeCost == null || this.mind < upgradeCost) return;
        this.mind -= upgradeCost;
        const ok = tower.upgrade();
        if (ok) {
          this.flashBuildEffect(tower.pos.x, tower.pos.y, tower.def.color);
          Sound.play('tower_place');
          this.flashMessage(`${TOWER_DEFS[tower.kind].displayName} 升级到 L${tower.level}`, '#34d399', 1400);
        }
        this.refreshSculptButton();
        tower.setRangeHighlighted(false);
        this.activePopupClose = null;
      },
      onSell: () => {
        this.mind += sellRefund;
        tower.setRangeHighlighted(false);
        this.removeTower(tower);
        this.flashMessage(`已拆除（返还 ${sellRefund} 念力）`, '#a78bfa', 1300);
        Sound.play('tower_place');
        this.refreshSculptButton();
        this.activePopupClose = null;
      },
      onClose: () => {
        tower.setRangeHighlighted(false);
        this.activePopupClose = null;
      },
    });
    this.activePopupClose = () => {
      tower.setRangeHighlighted(false);
      handle.close();
    };
  }

  private closePopup(): void {
    if (this.activePopupClose) {
      this.activePopupClose();
      this.activePopupClose = null;
    }
  }

  private removeTower(tower: Tower): void {
    this.grid.removeTower(tower.cell.col, tower.cell.row);
    this.towers = this.towers.filter(t => t !== tower);
    // 拆除时的短促尘埃反馈。
    const r = this.add.circle(tower.pos.x, tower.pos.y, tower.def.radius + 4, 0xa78bfa, 0.55).setDepth(30);
    r.setScale(0.4);
    this.tweens.add({
      targets: r,
      scale: 1.6,
      alpha: 0,
      duration: 360,
      ease: 'Cubic.easeOut',
      onComplete: () => r.destroy(),
    });
    tower.destroy();
  }

  private flashBuildEffect(x: number, y: number, color: number): void {
    if (this.textures.exists('fx-memory')) {
      const fx = this.add.image(x, y, 'fx-memory')
        .setDisplaySize(76, 38)
        .setDepth(30)
        .setAlpha(0.88)
        .setAngle(Math.random() * 360);
      this.tweens.add({
        targets: fx,
        scale: { from: 0.45, to: 1.35 },
        alpha: 0,
        duration: 520,
        ease: 'Cubic.easeOut',
        onComplete: () => fx.destroy(),
      });
      return;
    }
    const r = this.add.circle(x, y, 36, color, 0.7).setDepth(30);
    r.setScale(0.1);
    this.tweens.add({
      targets: r,
      scale: 1,
      alpha: 0,
      duration: 480,
      ease: 'Cubic.easeOut',
      onComplete: () => r.destroy(),
    });
  }
}
