import Phaser from 'phaser';
import { loadSettings, saveSettings } from '../../settings';
import { showSettings } from '../../ui/SettingsPanel';
import { showHelp } from '../../ui/HelpPanel';
import { showConfigStatus } from '../../ui/ConfigStatusPanel';
import { getConfigLoadReport } from '../data/configLoader';

export class MenuScene extends Phaser.Scene {
  private bgGroup!: Phaser.GameObjects.Container;
  private floaters: Phaser.GameObjects.Arc[] = [];

  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    if (this.textures.exists('art-menu-bg')) {
      const bg = this.add.image(width / 2, height / 2, 'art-menu-bg');
      bg.setDisplaySize(width, height).setAlpha(0.62);
      this.add.rectangle(width / 2, height / 2, width, height, 0x090816, 0.38);
    }

    // Background gradient via two large circles
    const bgFar = this.add.circle(width * 0.3, height * 0.7, height * 1.1, 0x231b40, 0.26);
    const bgNear = this.add.circle(width * 0.75, height * 0.25, height * 0.7, 0x382b5e, 0.28);
    this.tweens.add({ targets: bgFar, x: bgFar.x + 60, duration: 9000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: bgNear, y: bgNear.y + 40, duration: 11000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // Floating dust particles
    this.bgGroup = this.add.container(0, 0);
    for (let i = 0; i < 50; i++) {
      const c = this.add.circle(
        Math.random() * width,
        Math.random() * height,
        0.6 + Math.random() * 1.6,
        0xa78bfa,
        0.3 + Math.random() * 0.5,
      );
      this.bgGroup.add(c);
      this.tweens.add({
        targets: c,
        y: c.y - 60 - Math.random() * 80,
        alpha: 0,
        duration: 7000 + Math.random() * 5000,
        repeat: -1,
        delay: Math.random() * 5000,
      });
      this.floaters.push(c);
    }

    // Title
    const titleCN = this.add.text(width / 2, height * 0.28, '认 知 围 城', {
      fontFamily: 'serif',
      fontSize: '72px',
      color: '#a78bfa',
    }).setOrigin(0.5).setShadow(0, 0, '#a78bfa', 24, true, true);

    const titleEN = this.add.text(width / 2, height * 0.36, 'COGNITIVE  SIEGE', {
      fontFamily: 'serif',
      fontSize: '20px',
      color: '#a39bc7',
      fontStyle: 'italic',
    }).setOrigin(0.5);
    titleEN.setLetterSpacing(8);

    this.tweens.add({
      targets: titleCN,
      alpha: { from: 0.85, to: 1 },
      duration: 2400,
      yoyo: true,
      repeat: -1,
    });

    // Subtitle / pitch
    this.add.text(width / 2, height * 0.46,
      '大模型驱动的自适应塔防——心魔会复盘、会谈判、会进化。',
      { fontFamily: 'serif', fontSize: '15px', color: '#f5f3ff' },
    ).setOrigin(0.5).setAlpha(0.85);

    // Buttons
    const settings = loadSettings();
    const startBtn = this.makeButton(width / 2, height * 0.58, '开 始 治 疗', () => {
      this.scene.start('BattleScene');
    });
    startBtn.setScale(1.1);

    this.makeButton(width / 2, height * 0.66, '核心机制档案', () => {
      showHelp(() => {});
    });

    this.makeButton(width / 2, height * 0.74, settings.demoMode ? '设置 · 当前: 演示模式' : '设置 · 当前: 大模型在线',
      () => {
        showSettings(() => {
          this.scene.restart();
        });
      });

    const configReport = getConfigLoadReport();
    this.makeButton(
      width / 2,
      height * 0.82,
      configReport.status === 'ok' ? '配置校验 · 已通过' : '配置校验 · 使用默认值',
      () => showConfigStatus(getConfigLoadReport(), () => {}),
    );
    if (new URLSearchParams(window.location.search).has('config')) {
      this.time.delayedCall(250, () => showConfigStatus(getConfigLoadReport(), () => {}));
    }

    // Disclaimer
    this.add.text(width / 2, height - 40,
      '本作为虚构作品，并不替代真实心理治疗。所有"心魔"为人格化的叙事象征。',
      { fontSize: '12px', color: '#a39bc7' },
    ).setOrigin(0.5).setAlpha(0.7);
  }

  private makeButton(x: number, y: number, label: string, onClick: () => void): Phaser.GameObjects.Container {
    const w = 280, h = 46;
    const container = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, h, 0xa78bfa, 0.06)
      .setStrokeStyle(1, 0xa78bfa, 0.4);
    const txt = this.add.text(0, 0, label, {
      fontSize: '17px',
      color: '#f5f3ff',
    }).setOrigin(0.5);
    txt.setLetterSpacing(6);
    const hit = this.add.zone(0, 0, w + 18, h + 18).setOrigin(0.5);
    container.add([bg, txt, hit]);
    container.setSize(w, h);
    hit.setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => {
      bg.setFillStyle(0xa78bfa, 0.18);
      bg.setStrokeStyle(1, 0xa78bfa, 0.9);
      this.tweens.add({ targets: container, scale: 1.05, duration: 140 });
      this.input.manager.canvas.style.cursor = 'pointer';
    });
    hit.on('pointerout', () => {
      bg.setFillStyle(0xa78bfa, 0.06);
      bg.setStrokeStyle(1, 0xa78bfa, 0.4);
      this.tweens.add({ targets: container, scale: 1, duration: 140 });
      this.input.manager.canvas.style.cursor = 'default';
    });
    hit.on('pointerdown', () => onClick());
    return container;
  }
}
