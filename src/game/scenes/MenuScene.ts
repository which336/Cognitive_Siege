import Phaser from 'phaser';
import { loadSettings, saveSettings } from '../../settings';
import { showSettings } from '../../ui/SettingsPanel';
import { showHelp } from '../../ui/HelpPanel';
import { showConfigStatus } from '../../ui/ConfigStatusPanel';
import { getConfigLoadReport } from '../data/configLoader';
import { getLevelSpecs } from '../data/waves';

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

    // 用两个大圆做低成本背景渐变。
    const bgFar = this.add.circle(width * 0.3, height * 0.7, height * 1.1, 0x231b40, 0.26);
    const bgNear = this.add.circle(width * 0.75, height * 0.25, height * 0.7, 0x382b5e, 0.28);
    this.tweens.add({ targets: bgFar, x: bgFar.x + 60, duration: 9000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: bgNear, y: bgNear.y + 40, duration: 11000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // 漂浮尘埃粒子，增强梦境感。
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

    // 标题。
    const titleCN = this.add.text(width / 2, height * 0.18, '认 知 围 城', {
      fontFamily: 'serif',
      fontSize: '72px',
      color: '#a78bfa',
    }).setOrigin(0.5).setShadow(0, 0, '#a78bfa', 24, true, true);

    const titleEN = this.add.text(width / 2, height * 0.27, 'COGNITIVE  SIEGE', {
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

    // 副标题。
    this.add.text(width / 2, height * 0.34,
      '大模型驱动的自适应塔防——心魔会复盘、会谈判、会进化。',
      { fontFamily: 'serif', fontSize: '15px', color: '#f5f3ff' },
    ).setOrigin(0.5).setAlpha(0.85);

    // 章节选择。
    const settings = loadSettings();
    const levels = getLevelSpecs();
    this.add.text(width / 2, height * 0.405, '选择梦境章节', {
      fontSize: '13px',
      color: '#c7bdf0',
    }).setOrigin(0.5).setAlpha(0.88);

    levels.forEach((level, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = width / 2 + (col === 0 ? -158 : 158);
      const y = height * 0.465 + row * 52;
      const label = `${i + 1}. ${level.name}`;
      const btn = this.makeButton(x, y, label, () => {
        this.scene.start('BattleScene', { levelId: level.id });
      }, { w: 292, h: 42, fontSize: '14px', letterSpacing: 1 });
      if (i === 0) btn.setScale(1.03);
    });

    this.makeButton(width / 2 - 300, height * 0.84, '核心机制档案', () => {
      showHelp(() => {});
    }, { w: 250, h: 42, fontSize: '14px', letterSpacing: 2 });

    this.makeButton(width / 2, height * 0.84, settings.demoMode ? '设置 · 演示模式' : '设置 · 大模型在线',
      () => {
        showSettings(() => {
          this.scene.restart();
        });
      }, { w: 250, h: 42, fontSize: '14px', letterSpacing: 2 });

    const configReport = getConfigLoadReport();
    this.makeButton(
      width / 2 + 300,
      height * 0.84,
      configReport.status === 'ok' ? '配置校验 · 已通过' : '配置校验 · 默认值',
      () => showConfigStatus(getConfigLoadReport(), () => {}),
      { w: 250, h: 42, fontSize: '14px', letterSpacing: 2 },
    );
    if (new URLSearchParams(window.location.search).has('config')) {
      this.time.delayedCall(250, () => showConfigStatus(getConfigLoadReport(), () => {}));
    }

    // 免责声明。
    this.add.text(width / 2, height - 40,
      '本作为虚构作品，并不替代真实心理治疗。所有"心魔"为人格化的叙事象征。',
      { fontSize: '12px', color: '#a39bc7' },
    ).setOrigin(0.5).setAlpha(0.7);
  }

  private makeButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    opts: { w?: number; h?: number; fontSize?: string; letterSpacing?: number } = {},
  ): Phaser.GameObjects.Container {
    const w = opts.w ?? 280, h = opts.h ?? 46;
    const container = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, h, 0xa78bfa, 0.06)
      .setStrokeStyle(1, 0xa78bfa, 0.4);
    const txt = this.add.text(0, 0, label, {
      fontSize: opts.fontSize ?? '17px',
      color: '#f5f3ff',
    }).setOrigin(0.5);
    txt.setLetterSpacing(opts.letterSpacing ?? 6);
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
