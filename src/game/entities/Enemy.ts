import Phaser from 'phaser';
import { EnemySpawnSpec, GridPos, PixelPos, RouteVariant } from '../../types';
import { ENEMY_DEFS, EnemyDef } from '../data/enemies';
import { Grid } from '../systems/Grid';
import { DemonPersona, pickPersona } from '../data/personas';

export interface EnemyOpts {
  spec: EnemySpawnSpec;
  path: GridPos[];
  routeVariant?: RouteVariant;
  grid: Grid;
  isBoss?: boolean;
  bossDamageMul?: number;
  bossSpeedMul?: number;
  bossHpMul?: number;
  // 每波全局成长倍率，叠加在敌人基础数值和 Boss 谈判结果之上。
  // 由 BattleScene 根据 currentWaveIdx 传入，保证后续波次真实变强。
  waveHpMul?: number;
  waveSpeedMul?: number;
  waveDamageMul?: number;
  waveBountyMul?: number;
}

export type DeathCause = 'memory' | 'belief' | 'resonance' | 'acceptance' | 'insight' | 'boundary' | 'reached_core' | 'unknown';

const SCALE_BOSS = 2.6;

/**
 * 敌人移动模型：
 * 每个敌人持有一条预计算好的像素折线，以及一个 progressDist 标量。
 * 每帧只沿累计距离表插值位置，所以倒退、减速、PTSD 前跳都能用同一个变量表达，
 * 同时避免拐角处“切角”穿格。
 */
export class Enemy {
  scene: Phaser.Scene;
  def: EnemyDef;
  spec: EnemySpawnSpec;
  persona: DemonPersona;
  isBoss: boolean;
  routeVariant: RouteVariant;
  pathCells: GridPos[];

  // 像素空间折线与每个折点的累计距离。
  pathPx: PixelPos[];
  cumDist: number[];
  pathLen: number;

  progressDist = 0;
  segIdx = 0; // 缓存当前路径段，减少每帧查找成本。

  hp: number;
  hpMax: number;
  speed: number;       // 每 gameTime 秒移动的像素数。
  damage: number;
  bounty: number;
  pathProgress = 0;
  bossAuraSpeedMul = 1;
  bossAuraDamageMul = 1;
  bossAuraDamageTakenMul = 1;
  bossHpShieldApplied = false;
  mapElementTaunt = false;
  private mapHpShieldIds = new Set<string>();

  // 行为状态：隐身、减速、禁锢和强迫回退都挂在这里。
  cloaked = false;
  revealed = false;
  slowFactor = 1;
  slowEndAt = 0;       // gameTime 毫秒。

  // 强迫回退会向周围心魔辐射移速加成；最终速度会同时乘 slowFactor 和 tempSpeedMul。
  tempSpeedMul = 1;
  tempSpeedEndAt = 0;  // gameTime 毫秒。
  private speedHintNextAt = 0;
  rootedUntil = 0;      // gameTime 毫秒。
  rootHintNextAt = 0;   // gameTime 毫秒。
  private currentGameTime = 0;
  private flickerSuppressedUntil = 0;

  // 强迫反刍：到点后短距离后退，再继续前进。
  loopNextAt = 2500;   // 首次尝试在出生 2.5 秒后。
  loopBackUntilDist = -1;

  alive = true;
  reachedCore = false;
  attackingCore = false;
  deathCause: DeathCause = 'unknown';
  diedAtX = 0;
  diedAtY = 0;

  // 视觉对象。Enemy 自己管理生死动画和血条，Scene 只负责数组生命周期。
  body: Phaser.GameObjects.Container;
  disc: Phaser.GameObjects.Arc;
  glyph: Phaser.GameObjects.Text;
  artSprite: Phaser.GameObjects.Image | null = null;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpBarFill: Phaser.GameObjects.Rectangle;
  nameLabel: Phaser.GameObjects.Text | null = null;
  tauntBadge: Phaser.GameObjects.Container | null = null;
  cloakAlphaTween: Phaser.Tweens.Tween | null = null;

  constructor(scene: Phaser.Scene, opts: EnemyOpts) {
    this.scene = scene;
    this.def = ENEMY_DEFS[opts.spec.kind];
    this.spec = opts.spec;
    this.isBoss = !!opts.isBoss;
    this.routeVariant = opts.routeVariant ?? 'short';
    this.persona = pickPersona(opts.spec.kind, opts.spec.personaIdx);
    this.pathCells = opts.path.map(cell => ({ col: cell.col, row: cell.row }));

    // 把格子路线转换为像素折线，并生成累计距离表，后续移动只改 progressDist。
    this.pathPx = opts.path.map(g => opts.grid.cellCenter(g.col, g.row));
    this.cumDist = new Array(this.pathPx.length).fill(0);
    let total = 0;
    for (let i = 1; i < this.pathPx.length; i++) {
      const a = this.pathPx[i - 1];
      const b = this.pathPx[i];
      total += Math.hypot(b.x - a.x, b.y - a.y);
      this.cumDist[i] = total;
    }
    this.pathLen = total;

    // 基础数值 = 敌人定义 × 刷怪倍率 × Boss/波次倍率。
    const bossHpMul  = opts.bossHpMul  ?? 1;
    const bossSpdMul = opts.bossSpeedMul ?? 1;
    const bossDmgMul = opts.bossDamageMul ?? 1;
    const waveHp  = opts.waveHpMul     ?? 1;
    const waveSpd = opts.waveSpeedMul  ?? 1;
    const waveDmg = opts.waveDamageMul ?? 1;
    const waveBnt = opts.waveBountyMul ?? 1;

    this.hpMax = Math.round(
      this.def.hp * opts.spec.hpMul * (this.isBoss ? bossHpMul : 1) * waveHp
    );
    this.hp = this.hpMax;
    this.speed = this.def.speed * opts.spec.speedMul
      * (this.isBoss ? bossSpdMul : 1)
      * waveSpd;
    this.damage = Math.max(
      1,
      Math.round(this.def.damage * (this.isBoss ? bossDmgMul : 1) * waveDmg),
    );
    this.bounty = Math.round(
      (this.def.bounty + (this.isBoss ? 60 : 0)) * waveBnt
    );

    if (this.spec.skills.includes('rush')) this.speed *= 1.18;
    if (this.spec.skills.includes('shield')) {
      this.hpMax = Math.round(this.hpMax * 1.25);
      this.hp = this.hpMax;
    }
    if (this.spec.skills.includes('stealth')) this.cloaked = true;

    // 初始位置放在路径起点；若素材缺失则回退到圆形+字符。
    const start = this.pathPx[0];
    this.body = scene.add.container(start.x, start.y);
    const r = this.def.radius * (this.isBoss ? SCALE_BOSS : 1);
    this.disc = scene.add.circle(0, 0, r, this.def.color, 0.96);
    this.disc.setStrokeStyle(2, 0xffffff, 0.55);
    const artKey = `enemy-${this.def.kind}`;
    if (scene.textures.exists(artKey)) {
      this.disc.setAlpha(0);
      this.artSprite = scene.add.image(0, 0, artKey)
        .setOrigin(0.5)
        .setDisplaySize(this.isBoss ? 92 : 40, this.isBoss ? 92 : 40)
        .setAlpha(1);
    }
    this.glyph = scene.add.text(0, 0, this.def.emoji, {
      fontSize: this.isBoss ? '32px' : '16px',
      color: '#fff',
    }).setOrigin(0.5, 0.55).setAlpha(this.artSprite ? 0 : 1);

    const hpW = this.isBoss ? 56 : 26;
    this.hpBarBg = scene.add.rectangle(0, -r - 6, hpW, 4, 0x000000, 0.6).setOrigin(0.5, 1);
    this.hpBarFill = scene.add.rectangle(-hpW / 2, -r - 6, hpW, 4, 0x67e8f9, 1).setOrigin(0, 1);

    this.body.add([this.disc]);
    if (this.artSprite) this.body.add(this.artSprite);
    this.body.add([this.glyph, this.hpBarBg, this.hpBarFill]);
    if (this.spec.skills.includes('taunt')) this.addTauntBadge(r);

    if (this.isBoss) {
      this.nameLabel = scene.add.text(0, r + 6, this.persona.name, {
        fontSize: '13px', color: '#fde68a', fontStyle: 'bold',
      }).setOrigin(0.5, 0).setShadow(0, 0, '#000', 6);
      this.body.add(this.nameLabel);
    }

    if (this.cloaked) this.applyCloakVisual();
    this.body.setDepth(20);
    this.emitChatter('spawn');
  }

  private addTauntBadge(radius: number): void {
    const y = -radius - 15;
    const badge = this.scene.add.container(0, y);
    const bg = this.scene.add.circle(0, 0, this.isBoss ? 8 : 6, 0xfde68a, 0.96)
      .setStrokeStyle(1.5, 0x7c2d12, 0.95);
    const mark = this.scene.add.text(0, -1, '!', {
      fontSize: this.isBoss ? '13px' : '10px',
      color: '#7c2d12',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    badge.add([bg, mark]);
    this.body.add(badge);
    this.tauntBadge = badge;
    this.scene.tweens.add({
      targets: badge,
      y: y - 3,
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  applySlow(factor: number, durationMs: number, gameTimeNow: number): void {
    if (factor < this.slowFactor) {
      this.slowFactor = factor;
      this.slowEndAt = gameTimeNow + durationMs;
    } else {
      this.slowEndAt = Math.max(this.slowEndAt, gameTimeNow + durationMs);
    }
  }

  /**
   * 乘法移速增益，例如强迫“反刍”辐射。
   * 更强增益覆盖弱增益；相同/更弱增益只刷新持续时间，避免叠到不可控。
   */
  applySpeedBuff(mul: number, durationMs: number, gameTimeNow: number): void {
    if (mul > this.tempSpeedMul) {
      this.tempSpeedMul = mul;
      this.tempSpeedEndAt = gameTimeNow + durationMs;
    } else {
      this.tempSpeedEndAt = Math.max(this.tempSpeedEndAt, gameTimeNow + durationMs);
    }
    if (gameTimeNow >= this.speedHintNextAt) {
      this.speedHintNextAt = gameTimeNow + 700;
      this.flashSpeedBuffHint();
    }
  }

  applyRoot(durationMs: number, gameTimeNow: number): void {
    const scaled = this.isBoss ? Math.round(durationMs * 0.45) : durationMs;
    this.rootedUntil = Math.max(this.rootedUntil, gameTimeNow + scaled);
    if (gameTimeNow >= this.rootHintNextAt) {
      this.rootHintNextAt = gameTimeNow + 900;
      this.flashRootHint();
    }
  }

  suppressFlicker(durationMs: number, gameTimeNow: number): void {
    if (this.def.behavior !== 'flicker') return;
    this.flickerSuppressedUntil = Math.max(this.flickerSuppressedUntil, gameTimeNow + durationMs);
  }

  private flashSpeedBuffHint(): void {
    const g = this.scene.add.graphics().setDepth(40).setAlpha(0);
    g.lineStyle(2, 0x67e8f9, 0.78);
    g.lineBetween(this.body.x - 13, this.body.y + 7, this.body.x - 3, this.body.y + 1);
    g.lineBetween(this.body.x - 7, this.body.y + 12, this.body.x + 5, this.body.y + 5);
    g.lineStyle(1, 0xfde68a, 0.5);
    g.lineBetween(this.body.x - 15, this.body.y + 11, this.body.x - 7, this.body.y + 7);
    this.scene.tweens.add({
      targets: g,
      alpha: 0.82,
      y: -4,
      duration: 130,
      ease: 'Sine.easeOut',
    });
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      y: -13,
      delay: 220,
      duration: 260,
      onComplete: () => g.destroy(),
    });
  }

  reveal(): void {
    if (this.cloaked && !this.revealed) {
      this.revealed = true;
      this.cloakAlphaTween?.stop();
      this.disc.setAlpha(this.artSprite ? 0 : 0.96);
      this.artSprite?.setAlpha(1);
      this.glyph.setAlpha(this.artSprite ? 0 : 1);
    }
  }

  applyBossHpShield(ratio: number): void {
    if (this.bossHpShieldApplied || ratio <= 0) return;
    this.bossHpShieldApplied = true;
    const added = Math.max(1, Math.round(this.hpMax * ratio));
    this.hpMax += added;
    this.hp += added;
    this.updateHpBar();
  }

  applyMapHpShield(sourceId: string, ratio: number): void {
    if (!sourceId || this.mapHpShieldIds.has(sourceId) || ratio <= 0) return;
    this.mapHpShieldIds.add(sourceId);
    const added = Math.max(1, Math.round(this.hpMax * ratio));
    this.hpMax += added;
    this.hp += added;
    this.updateHpBar();
  }

  effectiveDamage(): number {
    return Math.max(1, Math.round(this.damage * this.bossAuraDamageMul));
  }

  takeDamage(amount: number, source: DeathCause): boolean {
    if (!this.alive) return false;
    if (this.cloaked && !this.revealed && source !== 'resonance') return false;

    this.hp -= amount * this.bossAuraDamageTakenMul;
    this.flashHurt();
    this.updateHpBar();

    // PTSD 闪回：受击后向前闪烁一小段，制造难以稳定集火的压力。
    if (this.def.behavior === 'flicker' && this.alive && this.currentGameTime >= this.flickerSuppressedUntil) {
      this.progressDist = Math.min(this.pathLen, this.progressDist + 36);
    }

    if (this.hp <= 0) {
      this.deathCause = source;
      this.die();
      return true;
    }
    return false;
  }

  private die(): void {
    if (!this.alive) return;
    this.alive = false;
    this.diedAtX = this.body.x;
    this.diedAtY = this.body.y;
    this.emitChatter('death');
    this.scene.tweens.add({
      targets: this.body,
      alpha: 0,
      scale: this.isBoss ? 1.6 : 1.4,
      duration: 280,
      ease: 'Cubic.easeOut',
      onComplete: () => this.body.destroy(),
    });
    const pos = { x: this.body.x, y: this.body.y };
    if (this.scene.textures.exists('fx-hit')) {
      const fx = this.scene.add.image(pos.x, pos.y, 'fx-hit')
        .setDisplaySize(this.isBoss ? 120 : 58, this.isBoss ? 60 : 30)
        .setAngle(Math.random() * 360)
        .setAlpha(0.9)
        .setDepth(22);
      this.scene.tweens.add({
        targets: fx,
        scale: { from: 0.45, to: 1.45 },
        alpha: 0,
        duration: 520,
        ease: 'Cubic.easeOut',
        onComplete: () => fx.destroy(),
      });
    }
    for (let i = 0; i < (this.isBoss ? 14 : 6); i++) {
      const p = this.scene.add.circle(pos.x, pos.y, 2 + Math.random() * 2, this.def.color, 1).setDepth(21);
      const ang = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * 50;
      this.scene.tweens.add({
        targets: p,
        x: pos.x + Math.cos(ang) * dist,
        y: pos.y + Math.sin(ang) * dist,
        alpha: 0,
        scale: 0.5,
        duration: 500,
        onComplete: () => p.destroy(),
      });
    }
  }

  arriveAtCore(): void {
    if (!this.alive) return;
    if (this.isBoss) {
      this.attackingCore = true;
      this.progressDist = this.pathLen;
      this.pathProgress = 1;
      this.loopBackUntilDist = -1;
      this.diedAtX = this.body.x;
      this.diedAtY = this.body.y;
      this.flashCoreAttackHint();
      return;
    }
    this.alive = false;
    this.reachedCore = true;
    this.deathCause = 'reached_core';
    this.diedAtX = this.body.x;
    this.diedAtY = this.body.y;
    this.scene.tweens.add({
      targets: this.body,
      alpha: 0,
      duration: 200,
      onComplete: () => this.body.destroy(),
    });
  }

  private flashCoreAttackHint(): void {
    const t = this.scene.add.text(this.body.x, this.body.y - 52, '核心受压', {
      fontSize: '13px',
      color: '#fb7185',
      fontFamily: 'inherit',
    }).setOrigin(0.5, 1).setDepth(50).setAlpha(0);
    this.scene.tweens.add({
      targets: t,
      alpha: 1,
      y: t.y - 8,
      duration: 220,
      ease: 'Sine.easeOut',
    });
    this.scene.tweens.add({
      targets: t,
      alpha: 0,
      y: t.y - 18,
      delay: 900,
      duration: 420,
      onComplete: () => t.destroy(),
    });
  }

  getProgress(): number {
    return this.pathLen > 0 ? Math.min(1, this.progressDist / this.pathLen) : 0;
  }

  getGridPos(grid: Grid): GridPos {
    return grid.pixelToCell(this.body.x, this.body.y);
  }

  /**
   * 按 gameTime 驱动敌人移动。调用方给所有实体传同一组 gameTime/gameDelta，
   * 这样倍速切换会统一影响出怪、冷却、减速和动画判定。
   */
  update(gameTime: number, gameDelta: number): void {
    this.currentGameTime = gameTime;
    if (!this.alive) return;
    if (this.attackingCore) return;
    if (this.pathPx.length < 2) { this.arriveAtCore(); return; }

    if (this.slowFactor < 1 && gameTime > this.slowEndAt) this.slowFactor = 1;
    if (this.tempSpeedMul !== 1 && gameTime > this.tempSpeedEndAt) this.tempSpeedMul = 1;
    if (gameTime < this.rootedUntil) {
      this.pathProgress = this.getProgress();
      return;
    }

    // 强迫心魔每 3.2 秒会后退约一格；Boss 不参与回退，保证首领持续压向核心。
    if (this.def.behavior === 'loop'
        && !this.isBoss
        && this.loopBackUntilDist < 0
        && gameTime >= this.loopNextAt
        && this.progressDist > 80) {
      this.loopBackUntilDist = Math.max(0, this.progressDist - 56);
      this.loopNextAt = gameTime + 3200;
      this.flashLoopHint();
      // 通知场景给附近友军辐射 +20% 移速；通过 Phaser 事件总线解耦。
      this.scene.events.emit('obsession_loop', this);
    }

    const speed = this.speed * this.slowFactor * this.tempSpeedMul * this.bossAuraSpeedMul;
    const dist = (speed * gameDelta) / 1000;

    if (this.loopBackUntilDist >= 0) {
      this.progressDist -= dist;
      if (this.progressDist <= this.loopBackUntilDist) {
        this.progressDist = this.loopBackUntilDist;
        this.loopBackUntilDist = -1;
      }
    } else {
      this.progressDist += dist;
      if (this.progressDist >= this.pathLen) {
        this.progressDist = this.pathLen;
        this.applyPosition();
        this.arriveAtCore();
        return;
      }
    }

    this.applyPosition();
    this.pathProgress = this.getProgress();
  }

  /** 根据 progressDist 在累计距离表中查找当前像素位置。 */
  private applyPosition(): void {
    const d = this.progressDist;
    // segIdx 是缓存段索引，敌人前进/后退时只做局部移动，避免每帧从头扫描。
    while (this.segIdx < this.cumDist.length - 1 && this.cumDist[this.segIdx + 1] < d) {
      this.segIdx++;
    }
    while (this.segIdx > 0 && this.cumDist[this.segIdx] > d) {
      this.segIdx--;
    }
    const i = Math.min(this.segIdx, this.cumDist.length - 2);
    const segLen = this.cumDist[i + 1] - this.cumDist[i];
    const a = this.pathPx[i];
    const b = this.pathPx[i + 1];
    if (segLen <= 0.0001) {
      this.body.setPosition(a.x, a.y);
      return;
    }
    const t = Math.max(0, Math.min(1, (d - this.cumDist[i]) / segLen));
    this.body.setPosition(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }

  private updateHpBar(): void {
    const ratio = Math.max(0, this.hp / this.hpMax);
    const fullW = this.isBoss ? 56 : 26;
    this.hpBarFill.width = fullW * ratio;
    if (ratio > 0.5) this.hpBarFill.fillColor = 0x67e8f9;
    else if (ratio > 0.25) this.hpBarFill.fillColor = 0xfde68a;
    else this.hpBarFill.fillColor = 0xf87171;
  }

  private flashHurt(): void {
    this.disc.setStrokeStyle(2, 0xffffff, 0.95);
    this.artSprite?.setTint(0xffffff);
    if (this.scene.textures.exists('fx-hit')) {
      const fx = this.scene.add.image(this.body.x, this.body.y, 'fx-hit')
        .setDisplaySize(this.isBoss ? 78 : 42, this.isBoss ? 39 : 21)
        .setAngle(Math.random() * 360)
        .setAlpha(0.82)
        .setDepth(28);
      this.scene.tweens.add({
        targets: fx,
        scale: { from: 0.35, to: 1.05 },
        alpha: 0,
        duration: 220,
        ease: 'Cubic.easeOut',
        onComplete: () => fx.destroy(),
      });
    }
    this.scene.time.delayedCall(80, () => {
      if (this.disc.scene) this.disc.setStrokeStyle(2, 0xffffff, 0.55);
      this.artSprite?.clearTint();
    });
  }

  private applyCloakVisual(): void {
    this.disc.setAlpha(this.artSprite ? 0 : 0.52);
    this.artSprite?.setAlpha(0.52);
    this.glyph.setAlpha(this.artSprite ? 0 : 0.52);
    const targets = this.artSprite ? [this.artSprite] : [this.disc, this.glyph];
    this.cloakAlphaTween = this.scene.tweens.add({
      targets,
      alpha: { from: 0.46, to: 0.62 },
      duration: 1300,
      yoyo: true,
      repeat: -1,
    });
  }

  /**
   * 普通强迫心魔回退时的视觉提示：回绕字符 + 短促弹动。
   * 目的是让玩家明确这是机制，不是寻路错误。
   */
  private flashLoopHint(): void {
    const t = this.scene.add.text(this.body.x, this.body.y - 26, '↺ 反刍', {
      fontSize: '11px',
      color: '#fbbf24',
      fontFamily: 'inherit',
    }).setOrigin(0.5, 1).setDepth(40).setAlpha(0);
    this.scene.tweens.add({
      targets: t, alpha: 0.95, y: t.y - 6, duration: 200, ease: 'Sine.easeOut',
    });
    this.scene.tweens.add({
      targets: t, alpha: 0, y: t.y - 18, delay: 700, duration: 480,
      onComplete: () => t.destroy(),
    });
    this.scene.tweens.add({
      targets: this.disc,
      angle: { from: -10, to: 10 },
      duration: 110, yoyo: true, repeat: 2, ease: 'Sine.easeInOut',
      onComplete: () => this.disc.setAngle(0),
    });
  }

  private flashRootHint(): void {
    const t = this.scene.add.text(this.body.x, this.body.y - 30, '阻挡', {
      fontSize: '11px',
      color: '#d9f99d',
      fontFamily: 'inherit',
    }).setOrigin(0.5, 1).setDepth(42).setAlpha(0);
    this.scene.tweens.add({
      targets: t, alpha: 0.95, y: t.y - 5, duration: 150, ease: 'Sine.easeOut',
    });
    this.scene.tweens.add({
      targets: t, alpha: 0, y: t.y - 15, delay: 420, duration: 360,
      onComplete: () => t.destroy(),
    });
  }

  private emitChatter(kind: 'spawn' | 'death'): void {
    const lines = kind === 'spawn' ? this.persona.spawnLines : this.persona.deathLines;
    if (!lines.length) return;
    const text = lines[Math.floor(Math.random() * lines.length)];
    const t = this.scene.add.text(this.body.x, this.body.y - 28, text, {
      fontSize: '11px',
      color: kind === 'spawn' ? '#a39bc7' : '#fde68a',
      align: 'center',
      wordWrap: { width: 180 },
      fontFamily: 'inherit',
    }).setOrigin(0.5, 1).setDepth(40).setAlpha(0);

    this.scene.tweens.add({
      targets: t, alpha: 1, y: t.y - 8, duration: 220, ease: 'Sine.easeOut',
    });
    this.scene.tweens.add({
      targets: t, alpha: 0, y: t.y - 26, delay: 1300, duration: 600,
      onComplete: () => t.destroy(),
    });
  }
}
