import Phaser from 'phaser';
import { Sound } from '../systems/Audio';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // 注册所有音效文件（存放在 public/assets/audio/）
    // 文件不存在时 AudioManager 会自动回退到合成音效，无需额外处理
    Sound.preload(this);
  }

  create(): void {
    this.load.start(); // 确保 Phaser 开始处理注册好的加载项

    // 隐藏 DOM loading screen
    const ls = document.getElementById('loading-screen');
    if (ls) {
      ls.classList.add('hidden');
      setTimeout(() => ls.remove(), 700);
    }
    this.scene.start('MenuScene');
  }
}
