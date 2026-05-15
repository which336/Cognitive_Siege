import Phaser from 'phaser';
import { BootScene } from './game/scenes/BootScene';
import { MenuScene } from './game/scenes/MenuScene';
import { BattleScene } from './game/scenes/BattleScene';
import { Sound } from './game/systems/Audio';
import { loadSettings } from './settings';

const GAME_WIDTH = 1280;
const GAME_HEIGHT = 760;

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#0b0a18',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    pixelArt: false,
    roundPixels: true,
  },
  scene: [BootScene, MenuScene, BattleScene],
  fps: { target: 60, forceSetTimeOut: false },
};

declare global {
  interface Window { __cognitiveSiegeGame?: Phaser.Game; }
}

window.addEventListener('load', () => {
  const settings = loadSettings();
  Sound.setMuted(settings.muted);
  const game = new Phaser.Game(config);
  window.__cognitiveSiegeGame = game;
  // 浏览器需要首次用户手势后才能解锁 Web Audio。
  const unlock = () => {
    Sound.play('tower_fire'); // 轻量触发一次音效，预热音频上下文。
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });
});
