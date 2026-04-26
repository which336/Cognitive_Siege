import Phaser from 'phaser';
import { Grid, buildDefaultLevel } from '../systems/Grid';
import { Tower } from '../entities/Tower';
import { Enemy } from '../entities/Enemy';
import { ALL_TOWER_KINDS, TOWER_DEFS } from '../data/towers';
import {
  GridPos,
  TowerKind,
  ReviewResult,
  ChoiceTag,
  NegotiationResolution,
  WaveSpec,
  BattleSummary,
  CombatLogEntry,
} from '../../types';
import { buildBaseWaves, TOTAL_WAVES } from '../data/waves';
import { PathPool } from '../systems/WaveSystem';
import { BattleLog } from '../systems/BattleLog';
import { applyStrategy } from '../systems/EvolutionApplier';
import { runReviewAgent } from '../llm/reviewAgent';
import { runDirector } from '../llm/directorAgent';
import { runNegotiation } from '../llm/negotiationAgent';
import { showVignette } from '../../ui/VignettePanel';
import { showReview } from '../../ui/ReviewPanel';
import { openNegotiation } from '../../ui/NegotiationPanel';
import { showSettings } from '../../ui/SettingsPanel';
import { showHelp } from '../../ui/HelpPanel';
import { loadSettings } from '../../settings';
import { applyChoiceTag, BOSS_PERSONAS, fallbackVignette, NEUTRAL_RESOLUTION, totalDialogueTurns } from '../data/fallback';
import { Sound } from '../systems/Audio';
import { showTowerActionPopup } from '../../ui/TowerActionPopup';

const TILE = 48;
const GRID_COLS = 24;
const GRID_ROWS = 12;

type Phase = 'intro' | 'build' | 'combat' | 'review' | 'gameover' | 'victory';
type RouteKey = 'short' | 'long' | 'edge';

interface SanityCfg { start: number; max: number; }

const SANITY_BY_DIFF: Record<'easy' | 'normal' | 'hard', SanityCfg> = {
  easy:   { start: 100, max: 120 },
  normal: { start: 80,  max: 100 },
  hard:   { start: 60,  max: 80 },
};

const SPEED_PRESETS: Array<1 | 2 | 4> = [1, 2, 4];

export class BattleScene extends Phaser.Scene {
  // Layout
  private grid!: Grid;
  private pathPool!: PathPool;
  private corePos!: GridPos;
  private spawnPos!: GridPos;

  // Game state
  private waves: WaveSpec[] = [];
  private currentWaveIdx = 0;
  private phase: Phase = 'intro';
  private mind = 60;
  private sanity = 80;
  private sanityMax = 100;

  // Game-time. Increments by deltaMs * speedMul each frame. ALL gameplay
  // timers (tower cooldown, spawn schedule, slow expiry, hallucination) live
  // in this frame so the speed toggle affects them uniformly.
  public gameTime = 0;
  private speedMul: 1 | 2 | 4 = 1;
  private hallucinationCheckAt = 0;

  // Wave runtime
  private spawnQueue: { spawnAt: number; spec: import('../../types').EnemySpawnSpec; isBossSpawn: boolean }[] = [];
  private battleLog: BattleLog | null = null;
  private bossNegotiationApplied: NegotiationResolution = { ...NEUTRAL_RESOLUTION };
  private nextBossCoreTickAt = 0;

  // Entities
  private towers: Tower[] = [];
  private enemies: Enemy[] = [];

  // UI
  private hudText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private mindText!: Phaser.GameObjects.Text;
  private sanityBar!: Phaser.GameObjects.Rectangle;
  private sanityBarBg!: Phaser.GameObjects.Rectangle;
  private sanityLabel!: Phaser.GameObjects.Text;
  private startWaveBtn!: Phaser.GameObjects.Container;
  private speedBtn!: Phaser.GameObjects.Container;
  private speedLabel!: Phaser.GameObjects.Text;
  private settingsBtn!: Phaser.GameObjects.Container;
  private codexBtn!: Phaser.GameObjects.Container;
  private menuBtn!: Phaser.GameObjects.Container;
  private toolbarButtons: { kind: TowerKind; container: Phaser.GameObjects.Container }[] = [];
  private selectedTowerKind: TowerKind | null = null;
  private hoverPreview!: Phaser.GameObjects.Container;
  private msgText!: Phaser.GameObjects.Text;

  private gridGfx!: Phaser.GameObjects.Graphics;
  private pathGfx!: Phaser.GameObjects.Graphics;
  private decorationGfx!: Phaser.GameObjects.Graphics;
  private synapses: Phaser.GameObjects.Arc[] = [];
  private fragmentTimer: Phaser.Time.TimerEvent | null = null;

  // Cached list of buildable cells for ambient decoration spawning.
  private buildCells: GridPos[] = [];

  // One visible / active route per wave. Keeping route display and actual spawn
  // behavior locked together avoids the "many paths at once" readability issue.
  private activePathKey: RouteKey = 'short';

  // Tower interaction
  private activePopupClose: (() => void) | null = null;

  constructor() { super({ key: 'BattleScene' }); }

  create(): void {
    this.resetRunState();
    this.cameras.main.setBackgroundColor('#0b0a18');
    const settings = loadSettings();
    const sanCfg = SANITY_BY_DIFF[settings.difficulty];
    this.sanityMax = sanCfg.max;
    this.sanity = sanCfg.max;
    this.mind = 60 + (settings.difficulty === 'easy' ? 20 : settings.difficulty === 'hard' ? -10 : 0);
    this.tweens.timeScale = 1;
    this.time.timeScale = 1;

    const offsetY = 70;
    const offsetX = (this.scale.width - GRID_COLS * TILE) / 2;
    const built = buildDefaultLevel({ cols: GRID_COLS, rows: GRID_ROWS, tileSize: TILE, offsetX, offsetY });
    this.grid = built.grid;
    this.pathPool = { short: built.pathCells, long: built.altPathCells, edge: built.edgePathCells };
    this.corePos = built.core;
    this.spawnPos = built.spawn;

    this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x0b0a18);

    this.gridGfx = this.add.graphics().setDepth(0);
    this.decorationGfx = this.add.graphics().setDepth(1);
    this.pathGfx = this.add.graphics().setDepth(2);
    this.drawGrid();
    this.collectBuildCells();
    this.drawDecoration();
    this.startFloatingFragments();

    this.waves = buildBaseWaves();
    // Initial path display: show exactly one main route for wave 1.
    this.activePathKey = this.computeActivePathKey(this.waves[0]);
    this.drawPath(this.activePathKey);
    this.drawSpawnAndCore();
    this.buildHUD();
    this.buildToolbar();
    this.buildHoverPreview();
    this.buildMessageBanner();

    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.keyboard?.on('keydown-ESC', () => {
      this.selectedTowerKind = null;
      this.refreshToolbar();
      this.closePopup();
    });
    this.input.keyboard?.on('keydown-SPACE', () => {
      if (this.phase === 'build') this.startWave();
    });
    // Keyboard speed shortcut: 1 / 2 / 4
    this.input.keyboard?.on('keydown-ONE',   () => this.setSpeed(1));
    this.input.keyboard?.on('keydown-TWO',   () => this.setSpeed(2));
    this.input.keyboard?.on('keydown-FOUR',  () => this.setSpeed(4));

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanupOnExit());
    this.events.once(Phaser.Scenes.Events.DESTROY,  () => this.cleanupOnExit());

    // Obsession's "compulsive repeat" aura: when one of them loop-backs, every
    // ally close to it on the field gets a short +20% speed kick, so the loop
    // reads as collective rumination accelerating the wave instead of a bug.
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
    this.spawnQueue = [];
    this.battleLog = null;
    this.bossNegotiationApplied = { ...NEUTRAL_RESOLUTION };
    this.nextBossCoreTickAt = 0;
    this.gameTime = 0;
    this.speedMul = 1;
    this.hallucinationCheckAt = 0;
    this.toolbarButtons = [];
    this.selectedTowerKind = null;
    this.buildCells = [];
    this.synapses = [];
    this.fragmentTimer = null;
    this.activePathKey = 'short';
    this.activePopupClose = null;
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
      // Brief radial flash from the origin so the player can SEE the aura propagate.
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

  // ===================== Layout drawing =====================

  private drawGrid(): void {
    const g = this.gridGfx;
    g.clear();
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const cell = this.grid.get(c, r);
        const center = this.grid.cellCenter(c, r);
        const x = center.x - TILE / 2, y = center.y - TILE / 2;
        if (cell === 'build') {
          // Buildable: warm indigo "deployment slot" with bright corner brackets.
          // The slightly brighter fill + clearly drawn corners read as "I CAN
          // place a tower here" at a glance.
          const tone = ((c + r) % 2 === 0) ? 0x282252 : 0x221c47;
          g.fillStyle(tone, 0.95).fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
          // Soft outer border
          g.lineStyle(1, 0x3a3273, 0.75).strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
          // Bright corner brackets (4 corners) so the cell reads as a deployment slot
          g.lineStyle(1.5, 0x8a7adb, 0.85);
          const inset = 4, brk = 5;
          // top-left
          g.beginPath(); g.moveTo(x + inset, y + inset + brk); g.lineTo(x + inset, y + inset); g.lineTo(x + inset + brk, y + inset); g.strokePath();
          // top-right
          g.beginPath(); g.moveTo(x + TILE - inset - brk, y + inset); g.lineTo(x + TILE - inset, y + inset); g.lineTo(x + TILE - inset, y + inset + brk); g.strokePath();
          // bottom-left
          g.beginPath(); g.moveTo(x + inset, y + TILE - inset - brk); g.lineTo(x + inset, y + TILE - inset); g.lineTo(x + inset + brk, y + TILE - inset); g.strokePath();
          // bottom-right
          g.beginPath(); g.moveTo(x + TILE - inset - brk, y + TILE - inset); g.lineTo(x + TILE - inset, y + TILE - inset); g.lineTo(x + TILE - inset, y + TILE - inset - brk); g.strokePath();
        } else if (cell === 'block') {
          // Blocked: nearly-black with diagonal hash lines that read as "off-limits void".
          g.fillStyle(0x06050f, 0.95).fillRect(x, y, TILE, TILE);
          g.lineStyle(1, 0x18142e, 0.75);
          // Diagonal hatching every 6px
          const step = 7;
          for (let d = -TILE; d < TILE * 2; d += step) {
            const x1 = x + d, y1 = y;
            const x2 = x + d + TILE, y2 = y + TILE;
            // Clip line to cell bounds
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
          // Outer border
          g.lineStyle(1, 0x2a2548, 0.45).strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        }
      }
    }
  }

  private computeActivePathKey(wave: WaveSpec): RouteKey {
    const score: Record<RouteKey, number> = { short: 0, long: 0, edge: 0 };
    for (const s of wave.spawns) {
      switch (s.pathBias) {
        case 'long': score.long++; break;
        case 'edge': score.edge++; break;
        case 'random':
          // Random still resolves to ONE route for the whole wave so the
          // player never sees multiple route overlays at once.
          score[['short', 'long', 'edge'][wave.index % 3] as RouteKey]++;
          break;
        case 'center':
        case 'short':
        default:
          score.short++;
      }
    }
    const candidates: RouteKey[] = ['long', 'edge', 'short'];
    return candidates.reduce((best, k) => (score[k] > score[best] ? k : best), 'short');
  }

  /**
   * Renders only the one route the current wave will actually use.
   */
  private drawPath(activeKey: RouteKey): void {
    this.activePathKey = activeKey;
    const g = this.pathGfx;
    g.clear();

    const cells = this.pathPool[activeKey];
    const routeCells = new Set<string>();
    const collect = (route: GridPos[]) => {
      for (const p of route) {
        const k = `${p.col},${p.row}`;
        routeCells.add(k);
      }
    };
    collect(cells);

    // Skip the spawn / core cells — they have dedicated colored visuals drawn
    // at higher depth and we don't want a flat purple tile washing them out.
    const spawnKey = `${this.spawnPos.col},${this.spawnPos.row}`;
    const coreKey  = `${this.corePos.col},${this.corePos.row}`;

    for (const k of routeCells) {
      if (k === spawnKey || k === coreKey) continue;
      const [c, r] = k.split(',').map(Number);
      const center = this.grid.cellCenter(c, r);
      g.fillStyle(0x3a2d62, 0.95)
        .fillRect(center.x - TILE / 2, center.y - TILE / 2, TILE, TILE);
    }

    const drawPoly = (route: GridPos[], color: number, alpha: number) => {
      if (route.length < 2) return;
      g.lineStyle(2, color, alpha);
      const pts = route.map(c => this.grid.cellCenter(c.col, c.row));
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.strokePath();
    };
    const color = activeKey === 'short' ? 0xa78bfa : activeKey === 'long' ? 0xf472b6 : 0x67e8f9;
    drawPoly(cells, color, 0.75);
  }

  // ===================== Ambient decoration =====================

  private collectBuildCells(): void {
    this.buildCells = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (this.grid.get(c, r) === 'build') this.buildCells.push({ col: c, row: r });
      }
    }
  }

  /**
   * Static decoration baked into a single Graphics: a tiny "neuron dust" dot in
   * each build cell + corner accents on a subset, plus pulsing synapse rings on
   * ~6% of cells. Brings the empty boardroom to life without dragging FPS.
   */
  private drawDecoration(): void {
    const g = this.decorationGfx;
    g.clear();

    // Tiny center dot per build cell — neuron dust. The grid itself now has
    // bright corner brackets so we skip the redundant corner accents and rely
    // on synapse rings + floating fragments for life.
    g.fillStyle(0x6d5fb0, 0.55);
    for (const c of this.buildCells) {
      const p = this.grid.cellCenter(c.col, c.row);
      g.fillCircle(p.x, p.y, 1.4);
    }

    // Pulsing synapse rings on a sparse subset
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
   * Periodically materializes a faint glyph in a random build cell that drifts
   * upward and fades — visually connects the empty space to the "subconscious
   * tissue" theme without distracting the player.
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
    const sp = this.grid.cellCenter(this.spawnPos.col, this.spawnPos.row);
    const cp = this.grid.cellCenter(this.corePos.col, this.corePos.row);

    // Spawn marker — solid pink-magenta tile + breathing rings + label, all
    // pushed above pathGfx (depth 2) so the path tile never washes it out.
    this.add.rectangle(sp.x, sp.y, TILE - 4, TILE - 4, 0x3a1d2c, 0.92)
      .setStrokeStyle(1.5, 0xf472b6, 0.85).setDepth(5);
    // Inner solid disc — gives the cell a distinct hot-pink "wound" feel.
    this.add.circle(sp.x, sp.y, 9, 0xf472b6, 0.85).setDepth(6);
    this.add.circle(sp.x, sp.y, 4, 0xfdf2f8, 0.95).setDepth(7);
    // Breathing ring overlay
    const spawnRing = this.add.circle(sp.x, sp.y, 22, 0xf472b6, 0)
      .setStrokeStyle(2, 0xf472b6, 0.85).setDepth(6);
    spawnRing.setScale(0.6);
    this.tweens.add({
      targets: spawnRing, scale: 1.4, alpha: { from: 0.85, to: 0 },
      duration: 1300, repeat: -1, ease: 'Cubic.easeOut',
    });
    this.add.text(sp.x, sp.y - 32, '入侵点', { fontSize: '11px', color: '#f472b6' })
      .setOrigin(0.5).setDepth(7);

    // Core - golden disc with breathing rings, all on depth 6 so the path
    // tile under it never obscures it.
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
    // Solid golden disc & a small white "pupil" so it reads as the player's eye.
    this.add.circle(cp.x, cp.y, 11, 0xfde68a, 1).setDepth(6);
    this.add.circle(cp.x, cp.y, 4, 0xfffbeb, 1).setDepth(7);
    this.add.text(cp.x, cp.y + 32, '自我核心', { fontSize: '11px', color: '#fde68a' })
      .setOrigin(0.5).setDepth(6);
  }

  // ===================== HUD =====================

  private buildHUD(): void {
    const w = this.scale.width;
    // HUD background bar — set to a high depth so nothing in the playfield can cover it.
    const hudBg = this.add.rectangle(w / 2, 30, w, 60, 0x0b0a18, 0.92)
      .setStrokeStyle(1, 0x2a2548).setDepth(80);

    const HUD_DEPTH = 81;

    this.waveText = this.add.text(20, 12, '', {
      fontSize: '14px', color: '#a78bfa',
    }).setLetterSpacing(2).setDepth(HUD_DEPTH);
    this.mindText = this.add.text(20, 32, '', {
      fontSize: '14px', color: '#fde68a',
    }).setDepth(HUD_DEPTH);
    this.hudText = this.add.text(180, 22, '', {
      fontSize: '13px', color: '#a39bc7',
    }).setDepth(HUD_DEPTH);

    // Right-side icon cluster goes FIRST (so we know its left edge), then SAN bar fits left of them.
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

    // SAN bar lives LEFT of the icon cluster with comfortable spacing.
    const iconLeftEdge = iconRight - iconStep * 2 - 18;     // x of leftmost icon's left edge
    const sanBarWidth = 200;
    const sanBarX = iconLeftEdge - sanBarWidth - 12;
    const sanBarY = 22;
    this.add.text(sanBarX - 64, sanBarY - 10, '理智值 SAN', {
      fontSize: '12px', color: '#a39bc7',
    }).setLetterSpacing(2).setDepth(HUD_DEPTH);
    this.sanityBarBg = this.add.rectangle(sanBarX, sanBarY, sanBarWidth, 14, 0x000000, 0.55)
      .setOrigin(0, 0).setStrokeStyle(1, 0x2a2548).setDepth(HUD_DEPTH);
    this.sanityBar = this.add.rectangle(sanBarX + 1, sanBarY + 1, sanBarWidth - 2, 12, 0x34d399, 1)
      .setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.sanityLabel = this.add.text(sanBarX + sanBarWidth / 2, sanBarY + 7, '', {
      fontSize: '11px', color: '#fff',
    }).setOrigin(0.5).setDepth(HUD_DEPTH + 1);

    void hudBg;
    this.updateHUD();
  }

  private makeIconButton(x: number, y: number, glyph: string, onClick: () => void): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    // Larger visual disc (r=16) so the target reads as a real button, plus an
    // even larger invisible hit-circle (r=18) for some forgiveness on the edges.
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
    let bx = startX;
    for (const k of ALL_TOWER_KINDS) {
      const def = TOWER_DEFS[k];
      const btn = this.add.container(bx + 65, barY);
      const bg = this.add.rectangle(0, 0, 130, 56, 0xa78bfa, 0.06).setStrokeStyle(1, 0xa78bfa, 0.35);
      const glyph = this.add.text(-46, 0, def.emoji, { fontSize: '24px', color: '#fff' }).setOrigin(0.5);
      const name = this.add.text(-22, -10, def.displayName, { fontSize: '12px', color: '#f5f3ff' }).setOrigin(0, 0.5);
      const cost = this.add.text(-22, 8, `${def.cost} 念力`, { fontSize: '11px', color: '#fde68a' }).setOrigin(0, 0.5);
      const hit = this.add.zone(0, 0, 146, 72).setOrigin(0.5);
      btn.add([bg, glyph, name, cost, hit]);
      btn.setSize(130, 56);
      // A real Zone child catches clicks instead of relying on Container
      // hitArea math; this fixes missed clicks on rectangle corners.
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
        this.refreshToolbar();
      });
      this.toolbarButtons.push({ kind: k, container: btn });
      bx += 138;
    }

    // Speed toggle button
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

    // Start wave button
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
  }

  private buildHoverPreview(): void {
    this.hoverPreview = this.add.container(0, 0).setVisible(false).setDepth(50);
    const ring = this.add.circle(0, 0, 16, 0xa78bfa, 0.4).setStrokeStyle(2, 0xa78bfa, 0.8);
    const range = this.add.circle(0, 0, 100, 0xa78bfa, 0.05).setStrokeStyle(1, 0xa78bfa, 0.3);
    this.hoverPreview.add([range, ring]);
  }

  private buildMessageBanner(): void {
    this.msgText = this.add.text(this.scale.width / 2, 70, '', {
      fontSize: '16px',
      color: '#fde68a',
    }).setOrigin(0.5).setDepth(40).setAlpha(0);
  }

  private flashMessage(text: string, color = '#fde68a', durationMs = 1800): void {
    this.msgText.setText(text);
    this.msgText.setColor(color);
    this.msgText.setAlpha(0);
    this.tweens.killTweensOf(this.msgText);
    this.tweens.add({
      targets: this.msgText,
      alpha: 1,
      duration: 220,
      onComplete: () => {
        this.tweens.add({
          targets: this.msgText,
          alpha: 0,
          delay: durationMs,
          duration: 600,
        });
      },
    });
  }

  private updateHUD(): void {
    this.waveText.setText(`WAVE  ${this.currentWaveIdx + 1} / ${TOTAL_WAVES}`);
    this.mindText.setText(`念力 ${this.mind}`);
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
    this.hudText.setText(`${phaseLabel[this.phase]}  ·  存活心魔 ${this.enemies.filter(e => e.alive).length}`);
  }

  // ===================== Phase: intro / vignette =====================

  private async openVignetteForCurrentWave(): Promise<void> {
    this.phase = 'intro';
    this.updateHUD();
    const settings = loadSettings();
    const v = await runDirector({
      settings,
      night: this.currentWaveIdx + 1,
      emotionHint: fallbackVignette(this.currentWaveIdx + 1).emotion,
    });
    showVignette(v, () => this.enterBuildPhase());
  }

  private enterBuildPhase(): void {
    this.phase = 'build';
    const wave = this.waves[this.currentWaveIdx];
    this.mind += wave.mindGift;
    // Reflect the single route this specific wave will use.
    this.activePathKey = this.computeActivePathKey(wave);
    this.drawPath(this.activePathKey);
    const routeLabel = this.routeLabelFromKey(this.activePathKey);
    this.flashMessage(`第 ${this.currentWaveIdx + 1} 波 · 布防阶段  ·  ${routeLabel}（[空格] 开始）`, '#a78bfa', 2600);
    this.updateHUD();
  }

  private routeLabelFromKey(key: RouteKey): string {
    const label: Record<RouteKey, string> = {
      short: '短路径',
      long: '绕远路',
      edge: '边路',
    };
    return `路线：${label[key]}`;
  }

  // ===================== Phase: combat =====================

  private async startWave(): Promise<void> {
    if (this.phase !== 'build') return;

    const wave = this.waves[this.currentWaveIdx];
    if (wave.isBoss) {
      const persona = BOSS_PERSONAS[wave.index];
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
    this.nextBossCoreTickAt = this.gameTime + 900;
    // Schedule spawns in gameTime space; gameTime starts at 0 each scene and just keeps growing.
    this.spawnQueue = wave.spawns.map(s => ({
      spawnAt: this.gameTime + s.delayMs,
      spec: s,
      isBossSpawn: s.hpMul >= 5,
    }));
    this.spawnQueue.sort((a, b) => a.spawnAt - b.spawnAt);
    this.flashMessage(`第 ${this.currentWaveIdx + 1} 波  ·  心魔降临`, '#f472b6', 2400);
    Sound.play('wave_start');
    this.updateHUD();
  }

  private async runBossNegotiation(waveIndex: number, persona: import('../../types').BossPersona): Promise<NegotiationResolution> {
    return new Promise((resolve) => {
      const totalTurns = totalDialogueTurns(waveIndex);
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
        }, waveIndex);
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
  }

  private spawnEnemyFromSpec(spec: import('../../types').EnemySpawnSpec, isBoss: boolean): void {
    const path = this.pathPool[this.activePathKey];
    const scale = this.computeWaveScale(this.currentWaveIdx, isBoss);
    const enemy = new Enemy(this, {
      spec,
      path,
      grid: this.grid,
      isBoss,
      bossDamageMul: this.bossNegotiationApplied.damageMul,
      bossHpMul: this.bossNegotiationApplied.hpMul,
      bossSpeedMul: this.bossNegotiationApplied.speedMul,
      waveHpMul: scale.hp,
      waveSpeedMul: scale.spd,
      waveDamageMul: scale.dmg,
      waveBountyMul: scale.bounty,
    });
    this.enemies.push(enemy);
  }

  /**
   * Per-wave escalation multipliers. Wave 1 sits at the design baseline (1.0)
   * and each subsequent wave compounds threat — HP and damage rise the most so
   * the player must keep upgrading and rebuilding, while speed grows gently to
   * stay readable. Bosses get an extra layer of muscle on top because every
   * boss is also the gatekeeper of a story beat.
   */
  private computeWaveScale(waveIdx: number, isBoss: boolean): {
    hp: number; spd: number; dmg: number; bounty: number;
  } {
    const i = Math.max(0, waveIdx);
    let hp     = 1 + 0.18 * i;
    let spd    = 1 + 0.04 * i;
    let dmg    = 1 + 0.16 * i;
    const bounty = 1 + 0.10 * i;
    if (isBoss) {
      hp  *= 1.55;
      dmg *= 1.30;
      // speed unchanged for bosses — keep the pacing.
    }
    return { hp, spd, dmg, bounty };
  }

  // ===================== Frame update =====================

  update(_realTime: number, deltaMs: number): void {
    // Cap deltaMs to avoid huge jumps after tab refocus then scale by speedMul.
    const cappedDelta = Math.min(deltaMs, 80);
    const gd = cappedDelta * this.speedMul;
    this.gameTime += gd;

    if (this.phase === 'combat') {
      this.spawnNext();
      for (const e of this.enemies) e.update(this.gameTime, gd);
      this.processBossCoreAttacks();
      if (this.phase !== 'combat') {
        this.updateHUD();
        return;
      }
      this.processArrivals();
      for (const t of this.towers) t.update(this.gameTime, this.enemies, (tower) => this.depressionDebuffFor(tower));
      this.processAcceptance(gd);
      this.processHallucination(this.gameTime);
      if (this.spawnQueue.length === 0 && this.enemies.length === 0) {
        this.endWave();
      }
    }
    this.updateHUD();
  }

  private processBossCoreAttacks(): void {
    const attackers = this.enemies.filter(e => e.alive && e.isBoss && e.attackingCore);
    if (!attackers.length) return;
    if (this.gameTime < this.nextBossCoreTickAt) return;

    this.nextBossCoreTickAt = this.gameTime + 900;
    const totalDamage = attackers.reduce((sum, e) => {
      return sum + Math.max(2, Math.round(e.damage * 0.35));
    }, 0);
    this.sanity = Math.max(0, this.sanity - totalDamage);
    this.flashSanityHit();
    Sound.play('sanity_hit');
    this.flashMessage(`BOSS 正在压迫自我核心：SAN -${totalDamage}`, '#fb7185', 800);

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
          this.sanity = Math.max(0, this.sanity - e.damage);
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
        regen += (gameDelta / 1000) * (1 + 0.4 * (t.level - 1));
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

  // ===================== End of wave / Review / Game over =====================

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
    const result: ReviewResult = await runReviewAgent({ settings, summary });

    let changes: string[] = [];
    if (this.currentWaveIdx + 1 < this.waves.length) {
      const apply = applyStrategy(this.waves[this.currentWaveIdx + 1], result.next_strategy);
      this.waves[this.currentWaveIdx + 1] = apply.applied;
      changes = apply.changes;
    }

    loadingHandle.close();
    setTimeout(() => {
      showReview({
        result,
        changes,
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

  private gameOver(): void {
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
        body: '理智值归零。她在凌晨醒来，浑身是汗。\n但她记得你曾走到过这里——下一晚再来一次吧。',
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

  private showEndPanel(opts: { title: string; subtitle: string; body: string; primaryLabel: string; primaryAction: () => void; }): void {
    const dw = this.cameras.main.displayWidth;
    const dh = this.cameras.main.displayHeight;
    const cx = dw / 2;
    const cy = dh / 2;
    const PANEL_MAX_W = Math.min(dw - 60, 580);
    const PANEL_PADDING = 36;

    const dim = this.add.rectangle(cx, cy, dw, dh, 0x0b0a18, 0.92).setDepth(900);
    const panelBg = this.add.rectangle(cx, cy, PANEL_MAX_W + PANEL_PADDING * 2, 0, 0x1a1630, 0.95)
      .setDepth(901).setAlpha(0);

    // 计算内容高度
    const titleT = this.add.text(0, 0, opts.title, { fontSize: '42px', color: '#a78bfa', letterSpacing: 10 }).setOrigin(0.5);
    const subT = this.add.text(0, 0, opts.subtitle, { fontSize: '13px', color: '#a39bc7', letterSpacing: 6 }).setOrigin(0.5);
    const bodyT = this.add.text(0, 0, opts.body, {
      fontSize: '14px', color: '#f5f3ff', align: 'center', lineSpacing: 6,
      wordWrap: { width: PANEL_MAX_W },
    }).setOrigin(0.5);
    const btnT = this.add.text(0, 0, opts.primaryLabel, { fontSize: '15px', color: '#f5f3ff', letterSpacing: 5 }).setOrigin(0.5);

    const contentH = titleT.height + subT.height + bodyT.height + btnT.height + 60; // 60 = gaps
    panelBg.setDisplaySize(PANEL_MAX_W + PANEL_PADDING * 2, contentH + PANEL_PADDING * 2);
    panelBg.setAlpha(0);

    const startY = cy - contentH / 2;
    titleT.setPosition(cx, startY + titleT.height / 2).setDepth(902).setAlpha(0);
    subT.setPosition(cx, startY + titleT.height + 10 + subT.height / 2).setDepth(902).setAlpha(0);
    bodyT.setPosition(cx, startY + titleT.height + subT.height + 20 + bodyT.height / 2).setDepth(902).setAlpha(0);

    const btnY = startY + titleT.height + subT.height + bodyT.height + 50;
    const btn = this.add.container(cx, btnY).setDepth(902).setAlpha(0);
    const btnBg = this.add.rectangle(0, 0, 200, 44, 0xa78bfa, 0.2).setStrokeStyle(1, 0xa78bfa, 0.7);
    const hit = this.add.zone(0, 0, 240, 64).setOrigin(0.5);
    btn.add([btnBg, btnT, hit]);
    btn.setSize(200, 44);
    hit.setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => { btnBg.setFillStyle(0xa78bfa, 0.35); this.input.manager.canvas.style.cursor = 'pointer'; });
    hit.on('pointerout', () => { btnBg.setFillStyle(0xa78bfa, 0.2); this.input.manager.canvas.style.cursor = 'default'; });
    hit.on('pointerdown', () => opts.primaryAction());

    const allFade = [dim, panelBg, titleT, subT, bodyT, btn];
    this.tweens.add({ targets: allFade, alpha: 1, duration: 600, ease: 'Cubic.easeOut' });

    // 销毁旧残留
    if ((this as any)._endPanelObjs) {
      ((this as any)._endPanelObjs as Phaser.GameObjects.GameObject[]).forEach(o => o.destroy());
    }
    (this as any)._endPanelObjs = allFade;
  }

  // ===================== Mouse interactions =====================

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (!this.selectedTowerKind) {
      this.hoverPreview.setVisible(false);
      return;
    }
    const cell = this.grid.pixelToCell(p.x, p.y);
    if (!this.grid.canBuild(cell.col, cell.row)) {
      this.hoverPreview.setVisible(false);
      return;
    }
    const center = this.grid.cellCenter(cell.col, cell.row);
    const def = TOWER_DEFS[this.selectedTowerKind];
    const ring = this.hoverPreview.list[1] as Phaser.GameObjects.Arc;
    const range = this.hoverPreview.list[0] as Phaser.GameObjects.Arc;
    ring.fillColor = def.color;
    ring.setStrokeStyle(2, def.color, 0.85);
    range.setRadius(def.range);
    range.fillColor = def.color;
    range.setStrokeStyle(1, def.color, 0.4);
    this.hoverPreview.setPosition(center.x, center.y);
    this.hoverPreview.setVisible(true);
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (this.phase === 'gameover' || this.phase === 'victory') return;

    // Right-click is a universal "cancel": clears the placement cursor or
    // closes the management popup, never tries to place / open anything.
    if (p.rightButtonDown()) {
      if (this.selectedTowerKind) {
        this.selectedTowerKind = null;
        this.refreshToolbar();
        this.hoverPreview.setVisible(false);
      }
      this.closePopup();
      return;
    }

    // 1) If we currently have a tower selected for placement, try placing.
    if (this.selectedTowerKind) {
      const cell = this.grid.pixelToCell(p.x, p.y);
      if (this.grid.canBuild(cell.col, cell.row)) {
        this.placeTowerAt(this.selectedTowerKind, cell);
      }
      return;
    }

    // 2) Otherwise, did the user click an existing tower? Open management popup.
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
    this.mind -= def.cost;
    const tower = new Tower(this, { kind, cell, grid: this.grid });
    this.towers.push(tower);
    this.grid.placeTower(cell.col, cell.row, tower.id);
    this.flashBuildEffect(tower.pos.x, tower.pos.y, def.color);
    Sound.play('tower_place');
  }

  private openTowerPopup(tower: Tower, _p: Phaser.Input.Pointer): void {
    this.closePopup();
    // Convert game-canvas pixel position to viewport CSS pixels.
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
      damage: tower.damage,
      range: tower.range,
      fireRate: tower.fireRate,
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
        this.activePopupClose = null;
      },
      onSell: () => {
        this.mind += sellRefund;
        this.removeTower(tower);
        this.flashMessage(`已拆除（返还 ${sellRefund} 念力）`, '#a78bfa', 1300);
        Sound.play('tower_place');
        this.activePopupClose = null;
      },
      onClose: () => {
        this.activePopupClose = null;
      },
    });
    this.activePopupClose = handle.close;
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
    // Dust burst
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
