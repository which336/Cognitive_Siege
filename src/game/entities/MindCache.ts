import Phaser from 'phaser';
import { GridPos, PixelPos, TowerKind } from '../../types';
import { Grid } from '../systems/Grid';

export interface MindCacheOpts {
  cell: GridPos;
  grid: Grid;
  hp: number;
  reward: number;
}

export class MindCache {
  scene: Phaser.Scene;
  cell: GridPos;
  pos: PixelPos;
  hp: number;
  hpMax: number;
  reward: number;
  alive = true;
  rewarded = false;

  body: Phaser.GameObjects.Container;
  artSprite: Phaser.GameObjects.Image | null = null;
  core: Phaser.GameObjects.Arc | null = null;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpBarFill: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, opts: MindCacheOpts) {
    this.scene = scene;
    this.cell = opts.cell;
    this.pos = opts.grid.cellCenter(opts.cell.col, opts.cell.row);
    this.hp = opts.hp;
    this.hpMax = opts.hp;
    this.reward = opts.reward;

    this.body = scene.add.container(this.pos.x, this.pos.y).setDepth(4 + this.cell.row * 0.02);
    const shadow = scene.add.ellipse(0, 11, 34, 12, 0x000000, 0.44);
    this.hpBarBg = scene.add.rectangle(0, -20, 28, 3, 0x000000, 0.52).setOrigin(0.5, 1);
    this.hpBarFill = scene.add.rectangle(-14, -20, 28, 3, 0xfde68a, 1).setOrigin(0, 1);

    this.body.add(shadow);
    if (scene.textures.exists('art-mind-cache')) {
      this.artSprite = scene.add.image(0, -2, 'art-mind-cache')
        .setOrigin(0.5)
        .setCrop(34, 34, 124, 124)
        .setDisplaySize(42, 42);
      this.body.add(this.artSprite);
    } else {
      const glow = scene.add.circle(0, 1, 17, 0xfde68a, 0.12).setStrokeStyle(1, 0xfde68a, 0.42);
      this.core = scene.add.circle(0, 0, 12, 0x8b6f36, 0.98).setStrokeStyle(2, 0xfde68a, 0.78);
      const shardA = scene.add.triangle(-7, -4, 0, -13, 7, -3, -1, 6, 0xfbbf24, 0.92)
        .setStrokeStyle(1, 0xfff7ad, 0.5);
      const shardB = scene.add.triangle(8, 3, 0, -8, 8, -1, 5, 9, 0xa78bfa, 0.82)
        .setStrokeStyle(1, 0xe9d5ff, 0.45);
      this.body.add([glow, this.core, shardA, shardB]);
    }
    this.body.add([this.hpBarBg, this.hpBarFill]);
  }

  takeDamage(amount: number, _source: TowerKind): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.flashHurt();
    this.updateHpBar();
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  removeSilently(): void {
    this.alive = false;
    this.rewarded = true;
    this.body.destroy();
  }

  private die(): void {
    if (!this.alive) return;
    this.alive = false;
    this.scene.tweens.add({
      targets: this.body,
      alpha: 0,
      scale: 1.45,
      duration: 280,
      ease: 'Cubic.easeOut',
      onComplete: () => this.body.destroy(),
    });
    for (let i = 0; i < 7; i++) {
      const p = this.scene.add.circle(this.body.x, this.body.y, 2 + Math.random() * 2, 0xfde68a, 1)
        .setDepth(26);
      const ang = Math.random() * Math.PI * 2;
      const dist = 18 + Math.random() * 26;
      this.scene.tweens.add({
        targets: p,
        x: this.body.x + Math.cos(ang) * dist,
        y: this.body.y + Math.sin(ang) * dist,
        alpha: 0,
        duration: 420,
        onComplete: () => p.destroy(),
      });
    }
  }

  private updateHpBar(): void {
    const ratio = Math.max(0, this.hp / this.hpMax);
    this.hpBarFill.width = 28 * ratio;
  }

  private flashHurt(): void {
    this.artSprite?.setTint(0xffffff);
    this.core?.setFillStyle(0xfde68a, 1);
    this.scene.time.delayedCall(70, () => {
      this.artSprite?.clearTint();
      if (this.core?.scene) this.core.setFillStyle(0x8b6f36, 0.98);
    });
  }
}
