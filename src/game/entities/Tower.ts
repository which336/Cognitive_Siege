import Phaser from 'phaser';
import { TowerKind, GridPos, PixelPos } from '../../types';
import { TOWER_DEFS, TowerDef } from '../data/towers';
import { Enemy } from './Enemy';
import { Grid } from '../systems/Grid';

export interface TowerOpts {
  kind: TowerKind;
  cell: GridPos;
  grid: Grid;
}

let TOWER_ID = 1;

const MAX_LEVEL = 3;

const LEVEL_DAMAGE_MUL = [1, 1.55, 2.4];     // L1, L2, L3
const LEVEL_RANGE_MUL  = [1, 1.12, 1.25];
const LEVEL_FIRERATE_MUL = [1, 1.12, 1.28];
/** Cost to upgrade FROM level i TO level i+1, as multiplier of base cost. */
const LEVEL_UPGRADE_COST_MUL = [1.0, 1.6];   // L1→L2, L2→L3

export class Tower {
  static next(): number { return TOWER_ID++; }

  scene: Phaser.Scene;
  id: number;
  def: TowerDef;
  kind: TowerKind;
  cell: GridPos;
  pos: PixelPos;
  level = 1;
  totalInvested: number;

  range: number;
  fireRate: number;
  damage: number;
  splashRadius: number;

  cooldownEndAt = 0;     // gameTime ms
  hallucinated = false;
  hallucinationEndAt = 0;

  // Visuals
  body: Phaser.GameObjects.Container;
  base: Phaser.GameObjects.Arc;
  glyph: Phaser.GameObjects.Text;
  rangeRing: Phaser.GameObjects.Arc;
  level2Ring: Phaser.GameObjects.Arc | null = null;
  level3Star: Phaser.GameObjects.Text | null = null;

  constructor(scene: Phaser.Scene, opts: TowerOpts) {
    this.scene = scene;
    this.id = Tower.next();
    this.def = TOWER_DEFS[opts.kind];
    this.kind = opts.kind;
    this.cell = opts.cell;
    this.pos = opts.grid.cellCenter(opts.cell.col, opts.cell.row);

    this.range = this.def.range;
    this.fireRate = this.def.fireRate;
    this.damage = this.def.damage;
    this.splashRadius = this.def.splashRadius;
    this.totalInvested = this.def.cost;

    this.body = scene.add.container(this.pos.x, this.pos.y);
    this.base = scene.add.circle(0, 0, this.def.radius, this.def.color, 0.85)
      .setStrokeStyle(2, 0xffffff, 0.55);
    this.glyph = scene.add.text(0, 0, this.def.emoji, {
      fontSize: '18px',
      color: '#0b0a18',
    }).setOrigin(0.5, 0.5);
    this.rangeRing = scene.add.circle(0, 0, this.range, this.def.color, 0.06)
      .setStrokeStyle(1, this.def.color, 0.25);
    this.body.add([this.rangeRing, this.base, this.glyph]);
    this.body.setDepth(15);

    // Tower must be interactive so the scene can pop the upgrade/sell menu.
    const hitR = this.def.radius + 4;
    this.body.setSize(hitR * 2, hitR * 2);
    this.body.setInteractive(new Phaser.Geom.Circle(0, 0, hitR), Phaser.Geom.Circle.Contains);
  }

  destroy(): void {
    this.body.destroy();
  }

  /** Returns next-level upgrade cost in mind power, or null if maxed. */
  getUpgradeCost(): number | null {
    if (this.level >= MAX_LEVEL) return null;
    const mul = LEVEL_UPGRADE_COST_MUL[this.level - 1];
    return Math.round(this.def.cost * mul);
  }

  /** Refund value when selling: 70% of total invested. */
  getSellValue(): number {
    return Math.floor(this.totalInvested * 0.7);
  }

  /** Apply level-up: bumps stats, repaints, charges nothing here (caller handles cost). */
  upgrade(): boolean {
    if (this.level >= MAX_LEVEL) return false;
    const cost = this.getUpgradeCost() ?? 0;
    this.totalInvested += cost;
    this.level++;
    // Recompute stats from base × level multipliers
    const idx = this.level - 1;
    this.range = this.def.range * LEVEL_RANGE_MUL[idx];
    this.fireRate = this.def.fireRate * LEVEL_FIRERATE_MUL[idx];
    this.damage = this.def.damage * LEVEL_DAMAGE_MUL[idx];
    // Refresh range ring
    this.rangeRing.setRadius(this.range);
    // Visual upgrade
    if (this.level === 2 && !this.level2Ring) {
      this.level2Ring = this.scene.add.circle(0, 0, this.def.radius + 4, this.def.color, 0)
        .setStrokeStyle(1.5, this.def.color, 0.95);
      this.body.add(this.level2Ring);
      this.body.bringToTop(this.glyph);
    }
    if (this.level === 3) {
      this.body.setScale(1.18);
      this.base.setFillStyle(this.def.color, 1);
      this.base.setStrokeStyle(2.5, 0xfde68a, 0.95);
      if (!this.level3Star) {
        this.level3Star = this.scene.add.text(0, -this.def.radius - 8, '★', {
          fontSize: '14px', color: '#fde68a',
        }).setOrigin(0.5);
        this.body.add(this.level3Star);
      }
    }
    // Pulse animation
    this.scene.tweens.add({
      targets: this.body,
      scale: this.level === 3 ? 1.32 : 1.16,
      duration: 130,
      yoyo: true,
      ease: 'Cubic.easeOut',
    });
    return true;
  }

  setHallucination(active: boolean, durationMs: number, gameTimeNow: number): void {
    if (active && !this.hallucinated) {
      this.hallucinated = true;
      this.hallucinationEndAt = gameTimeNow + durationMs;
      this.base.setFillStyle(0xf87171, 0.95);
      this.glyph.setText('!?');
      this.scene.tweens.add({
        targets: this.body,
        angle: { from: -8, to: 8 },
        duration: 220,
        yoyo: true,
        repeat: -1,
      });
    } else if (!active && this.hallucinated) {
      this.hallucinated = false;
      this.scene.tweens.killTweensOf(this.body);
      this.body.setAngle(0);
      this.base.setFillStyle(this.def.color, 0.85);
      this.glyph.setText(this.def.emoji);
    }
  }

  /** Per-frame logic, driven by gameTime (which respects timeScale). */
  update(gameTime: number, enemies: Enemy[], depressionDebuffFn: (t: Tower) => number): void {
    if (this.hallucinated && gameTime > this.hallucinationEndAt) {
      this.setHallucination(false, 0, gameTime);
    }
    if (this.kind === 'acceptance') return;

    if (gameTime < this.cooldownEndAt) return;

    const debuff = depressionDebuffFn(this);
    const effectiveFireRate = this.fireRate * (1 - debuff);
    const cdMs = effectiveFireRate <= 0.001 ? 99999 : 1000 / effectiveFireRate;

    const target = this.pickTarget(enemies);
    if (!target) return;

    this.cooldownEndAt = gameTime + cdMs;
    this.fire(target, enemies);
  }

  private pickTarget(enemies: Enemy[]): Enemy | null {
    let best: Enemy | null = null;
    let bestProgress = -1;
    const candidates: Enemy[] = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      if (e.cloaked && !e.revealed && this.kind !== 'resonance') continue;
      const dx = e.body.x - this.pos.x;
      const dy = e.body.y - this.pos.y;
      if (dx * dx + dy * dy > this.range * this.range) continue;
      candidates.push(e);
      const p = e.pathProgress;
      if (p > bestProgress) { bestProgress = p; best = e; }
    }
    if (this.hallucinated && candidates.length) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    return best;
  }

  private fire(target: Enemy, allEnemies: Enemy[]): void {
    if (this.kind === 'memory')        this.fireAOE(target, allEnemies);
    else if (this.kind === 'belief')   this.fireSingle(target);
    else if (this.kind === 'resonance')this.fireResonance(target, allEnemies);
  }

  private fireAOE(target: Enemy, all: Enemy[]): void {
    const tx = target.body.x;
    const ty = target.body.y;
    const burst = this.scene.add.circle(tx, ty, this.splashRadius, this.def.color, 0.55).setDepth(25);
    burst.setScale(0.1);
    this.scene.tweens.add({
      targets: burst,
      scale: 1,
      alpha: 0,
      duration: 360,
      ease: 'Cubic.easeOut',
      onComplete: () => burst.destroy(),
    });
    for (const e of all) {
      if (!e.alive) continue;
      const dx = e.body.x - tx;
      const dy = e.body.y - ty;
      if (dx * dx + dy * dy <= this.splashRadius * this.splashRadius) {
        e.takeDamage(this.damage, 'memory');
      }
    }
  }

  private fireSingle(target: Enemy): void {
    const projectile = this.scene.add.circle(this.pos.x, this.pos.y, 3, this.def.color, 1).setDepth(25);
    this.scene.tweens.add({
      targets: projectile,
      x: target.body.x,
      y: target.body.y,
      duration: 180,
      onComplete: () => {
        projectile.destroy();
        if (target.alive) target.takeDamage(this.damage, 'belief');
      },
    });
  }

  private fireResonance(target: Enemy, all: Enemy[]): void {
    const line = this.scene.add.line(0, 0, this.pos.x, this.pos.y, target.body.x, target.body.y, this.def.color, 0.7)
      .setOrigin(0, 0).setLineWidth(1.5).setDepth(24);
    this.scene.tweens.add({
      targets: line, alpha: 0, duration: 200, onComplete: () => line.destroy(),
    });
    const gtNow = (this.scene as Phaser.Scene & { gameTime?: number }).gameTime ?? 0;
    for (const e of all) {
      if (!e.alive) continue;
      const dx = e.body.x - target.body.x;
      const dy = e.body.y - target.body.y;
      if (dx * dx + dy * dy < 38 * 38) {
        e.reveal();
        e.applySlow(0.65, 1500, gtNow);
        e.takeDamage(this.damage, 'resonance');
      }
    }
  }
}
