import Phaser from 'phaser';
import { GridPos, MapElementKind, MapElementSpec, PixelPos, TowerKind } from '../../types';
import { Grid } from '../systems/Grid';

const ART_KEY: Record<MapElementKind, string> = {
  breath_vent: 'map-breath-vent',
  mirror_gate: 'map-mirror-gate',
  dry_well: 'map-dry-well',
  fracture_node: 'map-fracture-rift',
  trial_obelisk: 'map-trial-obelisk',
};

const FALLBACK_COLOR: Record<MapElementKind, number> = {
  breath_vent: 0x67e8f9,
  mirror_gate: 0xa78bfa,
  dry_well: 0xfde68a,
  fracture_node: 0xfb7185,
  trial_obelisk: 0xfbbf24,
};

const FALLBACK_GLYPH: Record<MapElementKind, string> = {
  breath_vent: '~',
  mirror_gate: 'M',
  dry_well: 'W',
  fracture_node: 'X',
  trial_obelisk: '!',
};

export class MapElementActor {
  scene: Phaser.Scene;
  spec: MapElementSpec;
  cell: GridPos;
  pos: PixelPos;
  hp: number;
  hpMax: number;
  reward: number;
  alive = true;
  rewarded = false;
  disabledAt = 0;

  body: Phaser.GameObjects.Container;
  artSprite: Phaser.GameObjects.Image | null = null;
  core: Phaser.GameObjects.Arc | null = null;
  hpBarBg: Phaser.GameObjects.Rectangle | null = null;
  hpBarFill: Phaser.GameObjects.Rectangle | null = null;
  aura: Phaser.GameObjects.Arc | null = null;

  constructor(scene: Phaser.Scene, opts: { spec: MapElementSpec; grid: Grid }) {
    this.scene = scene;
    this.spec = { ...opts.spec, cell: { ...opts.spec.cell } };
    this.cell = { ...opts.spec.cell };
    this.pos = opts.grid.cellCenter(this.cell.col, this.cell.row);
    this.hpMax = Math.max(0, opts.spec.hp);
    this.hp = this.hpMax;
    this.reward = Math.max(0, opts.spec.reward);

    const color = FALLBACK_COLOR[this.spec.kind];
    const radiusPx = Math.max(12, this.spec.radiusCells * opts.grid.cfg.tileSize);
    this.body = scene.add.container(this.pos.x, this.pos.y).setDepth(6 + this.cell.row * 0.03);

    if (this.spec.radiusCells > 0) {
      this.aura = scene.add.circle(0, 0, radiusPx, color, 0.045)
        .setStrokeStyle(1.5, color, 0.28);
      this.body.add(this.aura);
      scene.tweens.add({
        targets: this.aura,
        alpha: { from: 0.22, to: 0.42 },
        scale: { from: 0.96, to: 1.04 },
        duration: 1300 + Math.random() * 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    const shadow = scene.add.ellipse(0, 13, 44, 14, 0x000000, 0.42);
    this.body.add(shadow);

    const artKey = ART_KEY[this.spec.kind];
    if (scene.textures.exists(artKey)) {
      this.artSprite = scene.add.image(0, -2, artKey)
        .setOrigin(0.5)
        .setDisplaySize(this.displaySize(), this.displaySize())
        .setAlpha(this.spec.kind === 'breath_vent' ? 0.86 : 1);
      this.body.add(this.artSprite);
    } else {
      const glow = scene.add.circle(0, 0, 19, color, 0.13).setStrokeStyle(1.5, color, 0.58);
      this.core = scene.add.circle(0, 0, 14, color, 0.78).setStrokeStyle(2, 0xffffff, 0.48);
      const glyph = scene.add.text(0, -1, FALLBACK_GLYPH[this.spec.kind], {
        fontSize: '15px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      this.body.add([glow, this.core, glyph]);
    }

    if (this.isAttackable()) {
      this.hpBarBg = scene.add.rectangle(0, -26, 34, 4, 0x000000, 0.55).setOrigin(0.5, 1);
      this.hpBarFill = scene.add.rectangle(-17, -26, 34, 4, color, 1).setOrigin(0, 1);
      this.body.add([this.hpBarBg, this.hpBarFill]);
    }
  }

  get kind(): MapElementKind {
    return this.spec.kind;
  }

  isAttackable(): boolean {
    return this.kind !== 'breath_vent' && this.hpMax > 0 && this.alive;
  }

  radiusPx(tileSize: number): number {
    return Math.max(0, this.spec.radiusCells * tileSize);
  }

  takeDamage(amount: number, _source: TowerKind): boolean {
    if (!this.isAttackable()) return false;
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
    this.disabledAt = (this.scene as Phaser.Scene & { gameTime?: number }).gameTime ?? 0;
    this.scene.tweens.add({
      targets: this.body,
      alpha: 0,
      scale: 1.35,
      duration: 320,
      ease: 'Cubic.easeOut',
      onComplete: () => this.body.destroy(),
    });
    const color = FALLBACK_COLOR[this.kind];
    for (let i = 0; i < 8; i++) {
      const p = this.scene.add.circle(this.body.x, this.body.y, 2 + Math.random() * 2, color, 1).setDepth(26);
      const ang = Math.random() * Math.PI * 2;
      const dist = 22 + Math.random() * 34;
      this.scene.tweens.add({
        targets: p,
        x: this.body.x + Math.cos(ang) * dist,
        y: this.body.y + Math.sin(ang) * dist,
        alpha: 0,
        duration: 460,
        onComplete: () => p.destroy(),
      });
    }
  }

  private updateHpBar(): void {
    if (!this.hpBarFill) return;
    const ratio = Math.max(0, this.hp / Math.max(1, this.hpMax));
    this.hpBarFill.width = 34 * ratio;
  }

  private flashHurt(): void {
    this.artSprite?.setTint(0xffffff);
    this.core?.setFillStyle(0xffffff, 0.95);
    this.scene.time.delayedCall(75, () => {
      this.artSprite?.clearTint();
      if (this.core?.scene) this.core.setFillStyle(FALLBACK_COLOR[this.kind], 0.78);
    });
  }

  private displaySize(): number {
    switch (this.kind) {
      case 'trial_obelisk':
        return 58;
      case 'mirror_gate':
      case 'fracture_node':
        return 54;
      case 'dry_well':
        return 50;
      case 'breath_vent':
      default:
        return 48;
    }
  }
}
