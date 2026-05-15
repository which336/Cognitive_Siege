import Phaser from 'phaser';
import { loadExternalConfig } from '../data/configLoader';
import { Sound } from '../systems/Audio';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    this.preloadArt();
    Sound.preload(this);
  }

  private preloadArt(): void {
    const towerKinds = ['memory', 'belief', 'resonance', 'acceptance', 'insight', 'boundary'];
    for (const kind of towerKinds) {
      for (const lv of [1, 2, 3]) {
        this.load.image(`tower-${kind}-lv${lv}`, `assets/art/tower-${kind}-lv${lv}.png`);
      }
    }

    for (const kind of ['anxiety', 'depression', 'obsession', 'guilt', 'ptsd']) {
      this.load.image(`enemy-${kind}`, `assets/art/enemy-${kind}.png`);
    }

    this.load.image('art-entry-portal', 'assets/art/entry-portal.png');
    this.load.image('art-self-core', 'assets/art/self-core.png');
    this.load.image('art-menu-bg', 'assets/art/menu-bg.jpg');
    this.load.image('art-mind-cache', 'assets/art/mind-cache.png');

    this.load.image('tile-build', 'assets/art/tile-build.png');
    this.load.image('tile-block', 'assets/art/tile-block.png');
    this.load.image('tile-path', 'assets/art/tile-path.png');
    this.load.image('tile-path-active', 'assets/art/tile-path-active.png');

    this.load.image('map-breath-vent', 'assets/art/map-breath-vent.png');
    this.load.image('map-mirror-gate', 'assets/art/map-mirror-gate.png');
    this.load.image('map-dry-well', 'assets/art/map-dry-well.png');
    this.load.image('map-fracture-rift', 'assets/art/map-fracture-rift.png');
    this.load.image('map-trial-obelisk', 'assets/art/map-trial-obelisk.png');

    this.load.image('fx-memory', 'assets/art/fx-memory.png');
    this.load.image('fx-belief', 'assets/art/fx-belief.png');
    this.load.image('fx-resonance', 'assets/art/fx-resonance.png');
    this.load.image('fx-hit', 'assets/art/fx-hit.png');
  }

  create(): void {
    void this.finishBoot();
  }

  private async finishBoot(): Promise<void> {
    await loadExternalConfig();

    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.classList.add('hidden');
      setTimeout(() => loadingScreen.remove(), 700);
    }
    this.scene.start('MenuScene');
  }
}
