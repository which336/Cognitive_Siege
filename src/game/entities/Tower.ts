import Phaser from 'phaser';
import { TowerKind, GridPos, PixelPos } from '../../types';
import { TOWER_DEFS, TowerDef } from '../data/towers';
import { Enemy } from './Enemy';
import { Grid } from '../systems/Grid';
import { MindCache } from './MindCache';
import { MapElementActor } from './MapElementActor';

type TowerTarget = Enemy | MindCache | MapElementActor;

export interface TowerOpts {
  kind: TowerKind;
  cell: GridPos;
  grid: Grid;
}

let TOWER_ID = 1;

const MAX_LEVEL = 3;

const LEVEL_DAMAGE_MUL = [1, 1.55, 2.4];     // L1、L2、L3 对应倍率。
const LEVEL_RANGE_MUL  = [1, 1.12, 1.25];
const LEVEL_FIRERATE_MUL = [1, 1.12, 1.28];
const LEVEL_PERCENT_MUL = [1, 1.24, 1.52];
const LEVEL_BLOCK_HP_MUL = [1, 1.45, 2.05];
const TOWER_ART_DISPLAY_WIDTH = [96, 102, 108];
const TOWER_ART_DISPLAY_HEIGHT = [84, 88, 92];
const BLOCK_HP_BAR_WIDTH = 42;
const BLOCK_HP_BAR_HEIGHT = 5;
/** 从当前等级升到下一等级的费用倍率，基于塔的基础价格计算。 */
const LEVEL_UPGRADE_COST_MUL = [1.0, 1.6];   // L1 -> L2、L2 -> L3。

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

  cooldownEndAt = 0;     // gameTime 毫秒。
  hallucinated = false;
  hallucinationEndAt = 0;
  blockHpMax = 0;
  blockHp = 0;
  blockHitFxAt = 0;

  // 视觉对象由 Tower 自己管理，场景只负责创建/销毁和数组持有。
  body: Phaser.GameObjects.Container;
  base: Phaser.GameObjects.Arc;
  shadow: Phaser.GameObjects.Ellipse;
  pedestalGlow: Phaser.GameObjects.Ellipse;
  glyph: Phaser.GameObjects.Text;
  artSprite: Phaser.GameObjects.Image | null = null;
  rangeRing: Phaser.GameObjects.Arc;
  level2Ring: Phaser.GameObjects.Arc | null = null;
  level3Star: Phaser.GameObjects.Text | null = null;
  blockHpBarBg: Phaser.GameObjects.Rectangle | null = null;
  blockHpBarFill: Phaser.GameObjects.Rectangle | null = null;

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
    this.blockHpMax = this.computeBlockHpMax();
    this.blockHp = this.blockHpMax;

    this.body = scene.add.container(this.pos.x, this.pos.y);
    const artKey = this.artKey();
    this.shadow = scene.add.ellipse(0, 10, 36, 12, 0x000000, 0.58);
    this.pedestalGlow = scene.add.ellipse(0, 8, 34, 16, this.def.color, 0.2)
      .setStrokeStyle(1.5, this.def.color, 0.72);
    this.base = scene.add.circle(0, 0, this.def.radius, this.def.color, 0.96)
      .setStrokeStyle(2, 0xffffff, 0.72);
    if (scene.textures.exists(artKey)) {
      this.base.setAlpha(0);
      this.artSprite = scene.add.image(0, 0, artKey)
        .setOrigin(0.5)
        .setY(-16)
        .setDisplaySize(this.artDisplayWidth(), this.artDisplayHeight())
        .setAlpha(1);
    }
    this.glyph = scene.add.text(0, 0, this.def.emoji, {
      fontSize: '18px',
      color: '#0b0a18',
    }).setOrigin(0.5, 0.5).setAlpha(this.artSprite ? 0 : 1);
    this.rangeRing = scene.add.circle(0, 0, this.range, this.def.color, 0.035)
      .setStrokeStyle(1, this.def.color, 0.16);
    this.body.add([this.rangeRing, this.shadow, this.pedestalGlow, this.base]);
    if (this.artSprite) this.body.add(this.artSprite);
    this.body.add(this.glyph);
    if (this.kind === 'boundary') {
      const barY = this.blockHpBarY();
      this.blockHpBarBg = scene.add.rectangle(0, barY, BLOCK_HP_BAR_WIDTH, BLOCK_HP_BAR_HEIGHT, 0x000000, 0.64)
        .setOrigin(0.5, 1)
        .setStrokeStyle(1, 0xd9f99d, 0.62);
      this.blockHpBarFill = scene.add.rectangle(-BLOCK_HP_BAR_WIDTH / 2, barY, BLOCK_HP_BAR_WIDTH, BLOCK_HP_BAR_HEIGHT, 0x9fe870, 1)
        .setOrigin(0, 1);
      this.body.add([this.blockHpBarBg, this.blockHpBarFill]);
    }
    this.body.setDepth(this.depthForCell());
    this.refreshArt();

    // 塔必须可交互，场景才能弹出升级/出售菜单。
    const hitR = this.artSprite ? 32 : this.def.radius + 8;
    this.body.setSize(hitR * 2, hitR * 2);
    this.body.setInteractive(new Phaser.Geom.Circle(0, 0, hitR), Phaser.Geom.Circle.Contains);
  }

  destroy(): void {
    this.body.destroy();
  }

  /** 返回下一等级升级费用；满级时返回 null。 */
  getUpgradeCost(): number | null {
    if (this.level >= MAX_LEVEL) return null;
    const mul = LEVEL_UPGRADE_COST_MUL[this.level - 1];
    return Math.round(this.def.cost * mul);
  }

  /** 出售返还总投入的 70%。 */
  getSellValue(): number {
    return Math.floor(this.totalInvested * 0.7);
  }

  /** 执行升级：只提升数值和刷新表现，扣费由调用方负责。 */
  upgrade(): boolean {
    if (this.level >= MAX_LEVEL) return false;
    const cost = this.getUpgradeCost() ?? 0;
    this.totalInvested += cost;
    this.level++;
    // 始终从基础值乘等级倍率重算，避免多次升级产生累积误差。
    const idx = this.level - 1;
    this.range = this.def.range * LEVEL_RANGE_MUL[idx];
    this.fireRate = this.def.fireRate * LEVEL_FIRERATE_MUL[idx];
    this.damage = this.def.damage * LEVEL_DAMAGE_MUL[idx];
    const oldMax = this.blockHpMax;
    this.blockHpMax = this.computeBlockHpMax();
    if (this.kind === 'boundary') {
      const addedHp = Math.max(0, this.blockHpMax - oldMax);
      this.blockHp = Math.min(this.blockHpMax, this.blockHp + addedHp);
    } else {
      this.blockHp = this.blockHpMax;
    }
    this.refreshBlockHpBar();
    // 刷新射程圈，让升级后的有效范围立即可见。
    this.rangeRing.setRadius(this.range);
    // 无美术素材时用简单几何元素表达等级提升。
    if (!this.artSprite && this.level === 2 && !this.level2Ring) {
      this.level2Ring = this.scene.add.circle(0, 0, this.def.radius + 4, this.def.color, 0)
        .setStrokeStyle(1.5, this.def.color, 0.95);
      this.body.add(this.level2Ring);
      if (this.artSprite) this.body.bringToTop(this.artSprite);
      this.body.bringToTop(this.glyph);
    }
    if (this.level === 3) {
      if (!this.artSprite) {
        this.base.setFillStyle(this.def.color, 1);
        this.base.setStrokeStyle(2.5, 0xfde68a, 0.95);
      }
      if (!this.artSprite && !this.level3Star) {
        this.level3Star = this.scene.add.text(0, -this.def.radius - 8, '★', {
          fontSize: '14px', color: '#fde68a',
        }).setOrigin(0.5);
        this.body.add(this.level3Star);
      }
    }
    this.refreshArt();
    // 升级脉冲反馈。
    this.scene.tweens.add({
      targets: this.body,
      scale: this.level === 3 ? 1.02 : 1.015,
      duration: 90,
      yoyo: true,
      ease: 'Cubic.easeOut',
    });
    return true;
  }

  setHallucination(active: boolean, durationMs: number, gameTimeNow: number): void {
    if (active && !this.hallucinated) {
      this.hallucinated = true;
      this.hallucinationEndAt = gameTimeNow + durationMs;
      if (!this.artSprite) this.base.setFillStyle(0xf87171, 0.95);
      this.artSprite?.setTint(0xf87171);
      this.glyph.setText('!?');
      this.glyph.setAlpha(1);
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
      this.body.setScale(1);
      if (!this.artSprite) this.base.setFillStyle(this.def.color, 0.96);
      this.artSprite?.clearTint();
      this.glyph.setText(this.def.emoji);
      this.glyph.setAlpha(this.artSprite ? 0 : 1);
    }
  }

  private artKey(): string {
    return `tower-${this.kind}-lv${this.level}`;
  }

  private refreshArt(): void {
    if (!this.artSprite) return;
    const key = this.artKey();
    if (this.scene.textures.exists(key)) this.artSprite.setTexture(key);
    this.body.setScale(1);
    this.artSprite.setDisplaySize(this.artDisplayWidth(), this.artDisplayHeight());
    this.artSprite.setY(this.level === 1 ? -10 : this.level === 2 ? -11 : -12);
    this.base.setAlpha(0);
    this.pedestalGlow.setSize(this.level === 1 ? 34 : this.level === 2 ? 38 : 42, this.level === 1 ? 16 : this.level === 2 ? 18 : 20);
    this.pedestalGlow.setFillStyle(this.def.color, this.level === 1 ? 0.2 : this.level === 2 ? 0.23 : 0.26);
    this.pedestalGlow.setStrokeStyle(this.level === 1 ? 1.5 : 2, this.def.color, this.level === 1 ? 0.72 : 0.84);
    this.shadow.setSize(this.level === 1 ? 36 : this.level === 2 ? 40 : 44, this.level === 1 ? 12 : 14);
    this.body.setDepth(this.depthForCell());
    this.body.bringToTop(this.artSprite);
    this.body.bringToTop(this.glyph);
    this.positionBlockHpBar();
    this.bringBlockHpBarToTop();
  }

  private depthForCell(): number {
    return 24 + this.cell.row * 0.25 + this.cell.col * 0.001;
  }

  private artDisplayWidth(): number {
    return TOWER_ART_DISPLAY_WIDTH[this.level - 1];
  }

  private artDisplayHeight(): number {
    return TOWER_ART_DISPLAY_HEIGHT[this.level - 1];
  }

  private blockHpBarY(): number {
    if (this.artSprite) return this.artSprite.y - this.artDisplayHeight() / 2 - 6;
    return -this.def.radius - 10;
  }

  private positionBlockHpBar(): void {
    if (!this.blockHpBarBg || !this.blockHpBarFill) return;
    const barY = this.blockHpBarY();
    this.blockHpBarBg.setPosition(0, barY);
    this.blockHpBarFill.setPosition(-BLOCK_HP_BAR_WIDTH / 2, barY);
  }

  private bringBlockHpBarToTop(): void {
    if (this.blockHpBarBg) this.body.bringToTop(this.blockHpBarBg);
    if (this.blockHpBarFill) this.body.bringToTop(this.blockHpBarFill);
  }

  /** 每帧逻辑由 gameTime 驱动，因此会跟随游戏倍速。 */
  update(
    gameTime: number,
    enemies: Enemy[],
    mindCaches: MindCache[],
    mapElements: MapElementActor[],
    depressionDebuffFn: (t: Tower) => number,
  ): void {
    if (this.hallucinated && gameTime > this.hallucinationEndAt) {
      this.setHallucination(false, 0, gameTime);
    }
    if (this.kind === 'acceptance' || this.kind === 'boundary') return;

    if (gameTime < this.cooldownEndAt) return;

    const debuff = depressionDebuffFn(this);
    const effectiveFireRate = this.fireRate * (1 - debuff);
    const cdMs = effectiveFireRate <= 0.001 ? 99999 : 1000 / effectiveFireRate;

    const primaryTarget = this.pickTarget(enemies, mapElements);
    const cacheTarget = primaryTarget ? null : this.pickMindCacheTarget(mindCaches);
    if (!primaryTarget && !cacheTarget) return;

    this.cooldownEndAt = gameTime + cdMs;
    if (primaryTarget) this.fire(primaryTarget, enemies, mindCaches, mapElements);
    else if (cacheTarget) this.fire(cacheTarget, enemies, mindCaches, mapElements);
  }

  private pickTarget(enemies: Enemy[], mapElements: MapElementActor[]): Enemy | MapElementActor | null {
    // 嘲讽目标优先；隐身目标只有共鸣塔能稳定发现。
    const candidates: Array<Enemy | MapElementActor> = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      if (e.cloaked && !e.revealed && this.kind !== 'resonance') continue;
      const dx = e.body.x - this.pos.x;
      const dy = e.body.y - this.pos.y;
      if (dx * dx + dy * dy > this.range * this.range) continue;
      candidates.push(e);
    }
    for (const element of mapElements) {
      if (!element.isAttackable()) continue;
      const dx = element.body.x - this.pos.x;
      const dy = element.body.y - this.pos.y;
      if (dx * dx + dy * dy > this.range * this.range) continue;
      candidates.push(element);
    }
    if (this.hallucinated && candidates.length) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    if (!candidates.length) return null;

    const taunting = candidates.filter((target) => (
      (target instanceof Enemy && (target.spec.skills.includes('taunt') || target.mapElementTaunt)) ||
      (target instanceof MapElementActor && target.kind === 'trial_obelisk')
    ));
    const pool = taunting.length ? taunting : candidates;
    return pool.reduce((best, target) => (
      this.targetScore(target) > this.targetScore(best) ? target : best
    ));
  }

  private targetScore(target: Enemy | MapElementActor): number {
    if (target instanceof MapElementActor) return this.mapElementTargetScore(target);

    const enemy = target;
    // 目标评分偏向“威胁更高且更接近核心”的敌人，同时略微降低残血补刀权重。
    const skillThreat =
      ((enemy.spec.skills.includes('taunt') || enemy.mapElementTaunt) ? 10000 : 0) +
      (enemy.spec.skills.includes('shield') ? 260 : 0) +
      (enemy.isBoss ? 240 : 0);
    const kindThreat = ({
      depression: 180,
      anxiety: 120,
      obsession: 80,
      guilt: 35,
      ptsd: 20,
    } as Record<typeof enemy.def.kind, number>)[enemy.def.kind];
    const hpBulk = Math.min(120, enemy.hpMax * 0.18);
    const progressPressure = enemy.pathProgress * 100;
    const woundedPenalty = (1 - enemy.hp / Math.max(1, enemy.hpMax)) * 35;

    return skillThreat + kindThreat + hpBulk + progressPressure - woundedPenalty;
  }

  private mapElementTargetScore(element: MapElementActor): number {
    const base = ({
      trial_obelisk: 10850,
      fracture_node: 1180,
      mirror_gate: 1080,
      dry_well: 460,
      breath_vent: 0,
    } as Record<MapElementActor['kind'], number>)[element.kind];
    const wounded = (1 - element.hp / Math.max(1, element.hpMax)) * 90;
    const dx = element.body.x - this.pos.x;
    const dy = element.body.y - this.pos.y;
    const distancePressure = Math.max(0, 120 - Math.hypot(dx, dy));
    return base + wounded + distancePressure + element.reward * 0.8;
  }

  private pickMindCacheTarget(caches: MindCache[]): MindCache | null {
    // 没有敌人时才打念力残堆，避免资源目标抢走防守火力。
    if (this.range <= 0) return null;
    const candidates: MindCache[] = [];
    for (const cache of caches) {
      if (!cache.alive) continue;
      const dx = cache.body.x - this.pos.x;
      const dy = cache.body.y - this.pos.y;
      if (dx * dx + dy * dy > this.range * this.range) continue;
      candidates.push(cache);
    }
    if (!candidates.length) return null;
    return candidates.reduce((best, cache) => (
      this.cacheTargetScore(cache) > this.cacheTargetScore(best) ? cache : best
    ));
  }

  private cacheTargetScore(cache: MindCache): number {
    const dx = cache.body.x - this.pos.x;
    const dy = cache.body.y - this.pos.y;
    const distancePressure = Math.max(0, 120 - Math.hypot(dx, dy));
    const wounded = (1 - cache.hp / Math.max(1, cache.hpMax)) * 70;
    return cache.reward * 2 + wounded + distancePressure;
  }

  private fire(target: TowerTarget, allEnemies: Enemy[], allCaches: MindCache[], allMapElements: MapElementActor[]): void {
    // 每种塔只在这里分发一次攻击形态，便于保持 update 的流程清晰。
    if (this.kind === 'memory')        this.fireAOE(target, allEnemies, allCaches, allMapElements);
    else if (this.kind === 'belief')   this.fireSingle(target);
    else if (this.kind === 'resonance')this.fireResonance(target, allEnemies);
    else if (this.kind === 'insight')  this.fireInsight(target);
  }

  getDamageLabel(): string {
    if (this.kind === 'insight') return `${Math.round(this.percentDamageRate() * 100)}% 当前`;
    if (this.kind === 'boundary') return `0 / 耐久 ${Math.ceil(this.blockHp)}`;
    return this.damage.toFixed(1);
  }

  getRangeLabel(): string {
    if (this.kind === 'boundary') return '路线格';
    if (this.range <= 0) return '无';
    return `${Math.round(this.range)}`;
  }

  getFireRateLabel(): string {
    if (this.kind === 'boundary') return '持续阻挡';
    if (this.fireRate <= 0) return '无';
    return `${this.fireRate.toFixed(2)}/s`;
  }

  setRangeHighlighted(active: boolean): void {
    if (this.kind === 'boundary') return;
    this.rangeRing.setFillStyle(this.def.color, active ? 0.11 : 0.035);
    this.rangeRing.setStrokeStyle(active ? 2 : 1, this.def.color, active ? 0.72 : 0.16);
    this.rangeRing.setAlpha(active ? 1 : 1);
  }

  private fireAOE(target: TowerTarget, all: Enemy[], caches: MindCache[], mapElements: MapElementActor[]): void {
    const tx = target.body.x;
    const ty = target.body.y;
    if (this.scene.textures.exists('fx-memory')) {
      const burst = this.scene.add.image(tx, ty, 'fx-memory')
        .setDisplaySize(this.splashRadius * 2.25, this.splashRadius * 1.05)
        .setAngle(Math.random() * 360)
        .setAlpha(0.92)
        .setDepth(25);
      this.scene.tweens.add({
        targets: burst,
        scale: { from: 0.35, to: 1.15 },
        alpha: 0,
        duration: 420,
        ease: 'Cubic.easeOut',
        onComplete: () => burst.destroy(),
      });
    } else {
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
    }
    for (const e of all) {
      if (!e.alive) continue;
      const dx = e.body.x - tx;
      const dy = e.body.y - ty;
      if (dx * dx + dy * dy <= this.splashRadius * this.splashRadius) {
        e.takeDamage(this.damage, 'memory');
      }
    }
    for (const cache of caches) {
      if (!cache.alive) continue;
      const dx = cache.body.x - tx;
      const dy = cache.body.y - ty;
      if (dx * dx + dy * dy <= this.splashRadius * this.splashRadius) {
        cache.takeDamage(this.damage, 'memory');
      }
    }
    for (const element of mapElements) {
      if (!element.isAttackable()) continue;
      const dx = element.body.x - tx;
      const dy = element.body.y - ty;
      if (dx * dx + dy * dy <= this.splashRadius * this.splashRadius) {
        element.takeDamage(this.damage, 'memory');
      }
    }
  }

  private fireSingle(target: TowerTarget): void {
    const tx = target.body.x;
    const ty = target.body.y;
    if (this.scene.textures.exists('fx-belief')) {
      const projectile = this.scene.add.image(this.pos.x, this.pos.y, 'fx-belief')
        .setDisplaySize(42, 20)
        .setAngle(Phaser.Math.RadToDeg(Math.atan2(ty - this.pos.y, tx - this.pos.x)))
        .setDepth(25);
      this.scene.tweens.add({
        targets: projectile,
        x: tx,
        y: ty,
        scale: { from: 0.55, to: 0.85 },
        duration: 180,
        ease: 'Sine.easeOut',
        onComplete: () => {
          projectile.destroy();
          if (target.alive) target.takeDamage(this.damage, 'belief');
        },
      });
      return;
    }
    const projectile = this.scene.add.circle(this.pos.x, this.pos.y, 3, this.def.color, 1).setDepth(25);
    this.scene.tweens.add({
      targets: projectile,
      x: tx,
      y: ty,
      duration: 180,
      onComplete: () => {
        projectile.destroy();
        if (target.alive) target.takeDamage(this.damage, 'belief');
      },
    });
  }

  private fireInsight(target: TowerTarget): void {
    const tx = target.body.x;
    const ty = target.body.y;
    const damage = Math.ceil(target.hp * this.percentDamageRate());
    if (damage <= 0) return;
    const ring = this.scene.add.circle(tx, ty, 18, this.def.color, 0)
      .setStrokeStyle(2, this.def.color, 0.82)
      .setDepth(28);
    const ray = this.scene.add.line(0, 0, this.pos.x, this.pos.y, tx, ty, this.def.color, 0.56)
      .setOrigin(0, 0)
      .setLineWidth(2)
      .setDepth(27);
    this.scene.tweens.add({
      targets: ring,
      radius: 34,
      alpha: 0,
      duration: 260,
      ease: 'Sine.easeOut',
      onComplete: () => ring.destroy(),
    });
    this.scene.tweens.add({
      targets: ray,
      alpha: 0,
      duration: 220,
      onComplete: () => ray.destroy(),
    });
    target.takeDamage(damage, 'insight');
  }

  private fireResonance(target: TowerTarget, all: Enemy[]): void {
    if (this.scene.textures.exists('fx-resonance')) {
      const tx = target.body.x;
      const ty = target.body.y;
      const dx = tx - this.pos.x;
      const dy = ty - this.pos.y;
      const dist = Math.max(48, Math.hypot(dx, dy));
      const beam = this.scene.add.image(this.pos.x + dx / 2, this.pos.y + dy / 2, 'fx-resonance')
        .setDisplaySize(dist, 34)
        .setAngle(Phaser.Math.RadToDeg(Math.atan2(dy, dx)))
        .setAlpha(0.82)
        .setDepth(24);
      this.scene.tweens.add({
        targets: beam,
        alpha: 0,
        scaleY: 1.65,
        duration: 240,
        ease: 'Sine.easeOut',
        onComplete: () => beam.destroy(),
      });
    } else {
      const line = this.scene.add.line(0, 0, this.pos.x, this.pos.y, target.body.x, target.body.y, this.def.color, 0.7)
        .setOrigin(0, 0).setLineWidth(1.5).setDepth(24);
      this.scene.tweens.add({
        targets: line, alpha: 0, duration: 200, onComplete: () => line.destroy(),
      });
    }
    if (!(target instanceof Enemy)) {
      target.takeDamage(this.damage, 'resonance');
      return;
    }

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

  blockEnemy(enemy: Enemy, gameTime: number, damage: number): boolean {
    // 边界桩是路线格上的临时阻挡物，持续扣自身耐久并短暂禁锢敌人。
    if (this.kind !== 'boundary') return false;
    if (this.hallucinated) return false;
    if (this.blockHp <= 0) return false;
    if (!enemy.alive || enemy.attackingCore) return false;

    const dx = enemy.body.x - this.pos.x;
    const dy = enemy.body.y - this.pos.y;
    if (dx * dx + dy * dy > 28 * 28) return false;

    enemy.applyRoot(140, gameTime);
    enemy.suppressFlicker(320, gameTime);
    this.takeBlockDamage(damage, gameTime);
    return this.blockHp <= 0;
  }

  private percentDamageRate(): number {
    return (this.def.percentCurrentHp ?? 0) * LEVEL_PERCENT_MUL[this.level - 1];
  }

  private computeBlockHpMax(): number {
    return Math.round((this.def.blockHp ?? 0) * LEVEL_BLOCK_HP_MUL[this.level - 1]);
  }

  private takeBlockDamage(amount: number, gameTime: number): void {
    if (amount <= 0) return;
    this.blockHp = Math.max(0, this.blockHp - amount);
    this.refreshBlockHpBar();
    if (gameTime >= this.blockHitFxAt) {
      this.blockHitFxAt = gameTime + 220;
      this.playBlockFx();
    }
  }

  private refreshBlockHpBar(): void {
    if (!this.blockHpBarFill) return;
    const ratio = this.blockHpMax > 0 ? Math.max(0, this.blockHp / this.blockHpMax) : 0;
    this.positionBlockHpBar();
    this.blockHpBarFill.width = BLOCK_HP_BAR_WIDTH * ratio;
    this.bringBlockHpBarToTop();
    if (ratio > 0.5) this.blockHpBarFill.fillColor = 0x9fe870;
    else if (ratio > 0.25) this.blockHpBarFill.fillColor = 0xfde68a;
    else this.blockHpBarFill.fillColor = 0xfb7185;
  }

  private playBlockFx(): void {
    const brace = this.scene.add.circle(this.pos.x, this.pos.y, this.def.radius + 6, this.def.color, 0.18)
      .setStrokeStyle(3, this.def.color, 0.9)
      .setDepth(31);
    this.scene.tweens.add({
      targets: brace,
      scale: { from: 0.85, to: 1.25 },
      alpha: 0,
      duration: 260,
      ease: 'Cubic.easeOut',
      onComplete: () => brace.destroy(),
    });
    this.scene.tweens.add({
      targets: this.body,
      scaleX: { from: 1.16, to: 1 },
      scaleY: { from: 0.88, to: 1 },
      duration: 180,
      ease: 'Back.easeOut',
    });
  }
}
