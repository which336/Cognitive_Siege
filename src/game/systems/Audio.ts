/**
 * Hybrid audio engine.
 * Priority: Phaser cached audio (real .wav/.mp3/.ogg files) > Web Audio API synthesis fallback.
 * Audio files live in public/assets/audio/ — see preload() for the full list.
 */

type Voice = 'tower_place' | 'tower_fire' | 'enemy_die' | 'enemy_hit' | 'sanity_hit' | 'wave_start' | 'review_open' | 'choice_pick' | 'victory' | 'gameover';

class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private muted = false;
  private volume = 0.55;

  // 音频文件基路径（相对于 public/）
  private readonly AUDIO_BASE = 'assets/audio/';

  private readonly VOICE_FILES: Record<Voice, string> = {
    tower_place:  'tower_place.wav',
    tower_fire:   'tower_fire.wav',
    enemy_die:    'enemy_die.wav',
    enemy_hit:    'enemy_hit.wav',
    sanity_hit:   'sanity_hit.wav',
    wave_start:   'wave_start.wav',
    review_open:  'review_open.wav',
    choice_pick:  'choice_pick.wav',
    victory:      'victory.wav',
    gameover:     'gameover.wav',
  };

  /** 由 BootScene 调用，将所有音频文件注册到 Phaser 加载器。 */
  preload(scene: Phaser.Scene): void {
    for (const file of Object.values(this.VOICE_FILES)) {
      const key = file.replace(/\.(mp3|ogg|wav)$/i, '');
      scene.load.audio(key, this.AUDIO_BASE + file);
    }
  }

  /** 等待音频文件加载完成（由 BootScene.create 调用）。 */
  waitForLoad(scene: Phaser.Scene): void {
    scene.load.once('complete', () => { /* ready */ });
  }

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    this.ctx = new Ctor();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.volume;
    this.masterGain.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.18;
    this.musicGain.connect(this.masterGain);
    return this.ctx;
  }

  setMuted(v: boolean): void {
    this.muted = v;
    if (this.masterGain) this.masterGain.gain.value = v ? 0 : this.volume;
  }

  play(voice: Voice): void {
    if (this.muted) return;

    // 尝试从 Phaser 缓存播放真实音频
    const game = (window as any).__cognitiveSiegeGame;
    if (game) {
      try {
        // sound.play(key) 会从 Sound Manager 缓存查找已 decode 的音频并播放
        const success: boolean = game.sound.play(voice, { volume: this.volume });
        if (success !== false) return;
      } catch { /* fall through to synthesis */ }
    }

    // 降级：Web Audio API 合成
    this._synthesize(voice);
  }

  private _synthesize(voice: Voice): void {
    try {
      const ctx = this.ensure();
      const t = ctx.currentTime;
      switch (voice) {
        case 'tower_place':  this.tone(t, [880, 1320], 0.28, 0.18, 'triangle'); break;
        case 'tower_fire':   this.tone(t, [1200], 0.05, 0.06, 'sine', 0.04); break;
        case 'enemy_hit':    this.tone(t, [400, 180], 0.07, 0.1, 'square', 0.04); break;
        case 'enemy_die':    this.tone(t, [600, 220, 120], 0.18, 0.08, 'sawtooth'); break;
        case 'sanity_hit':   this.tone(t, [180, 90], 0.4, 0.2, 'sawtooth'); break;
        case 'wave_start':   this.tone(t, [220, 330, 440, 660], 0.6, 0.2, 'triangle'); break;
        case 'review_open':  this.tone(t, [330, 440, 550], 0.6, 0.18, 'sine'); break;
        case 'choice_pick':  this.tone(t, [660, 990], 0.18, 0.12, 'sine'); break;
        case 'victory':      this.tone(t, [440, 554, 659, 880], 1.4, 0.25, 'triangle'); break;
        case 'gameover':     this.tone(t, [220, 174, 139, 110], 1.6, 0.3, 'sawtooth'); break;
      }
    } catch { /* ignore */ }
  }

  startAmbient(): void {
    if (this.muted || this.musicNodes.length) return;
    try {
      const ctx = this.ensure();
      const make = (freq: number, detune: number) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        const g = ctx.createGain();
        g.gain.value = 0.0;
        osc.connect(g);
        g.connect(this.musicGain!);
        osc.start();
        g.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 4.5);
        return { osc, gain: g };
      };
      this.musicNodes.push(make(110, 0));
      this.musicNodes.push(make(165, -8));
      this.musicNodes.push(make(220, 12));
    } catch { /* ignore */ }
  }

  stopAmbient(): void {
    if (!this.musicNodes.length || !this.ctx) return;
    const ctx = this.ctx;
    for (const m of this.musicNodes) {
      try {
        m.gain.gain.cancelScheduledValues(ctx.currentTime);
        m.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
        m.osc.stop(ctx.currentTime + 1.4);
      } catch { /* ignore */ }
    }
    this.musicNodes = [];
  }

  private tone(
    startAt: number, freqs: number[], totalDuration: number,
    peakGain: number, type: OscillatorType, sweepEachStep = 0,
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const stepDur = totalDuration / freqs.length;
    for (let i = 0; i < freqs.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freqs[i];
      const t0 = startAt + i * stepDur;
      const t1 = t0 + stepDur;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peakGain, t0 + Math.min(0.02, stepDur * 0.2));
      g.gain.exponentialRampToValueAtTime(0.0001, t1);
      if (sweepEachStep) {
        osc.frequency.setValueAtTime(freqs[i], t0);
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqs[i] * (1 - sweepEachStep)), t1);
      }
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t0);
      osc.stop(t1 + 0.05);
    }
  }
}

export const Sound = new AudioManager();
