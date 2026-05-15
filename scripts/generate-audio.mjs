import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'public/assets/audio');
const sampleRate = 44100;
const tau = Math.PI * 2;

let seed = 20260426;
function rand() {
  // 固定种子的线性同余随机数，保证每次生成的音频完全一致。
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
}

function wave(type, phase) {
  if (type === 'triangle') return 2 * Math.abs(2 * ((phase / tau) % 1) - 1) - 1;
  if (type === 'saw') return 2 * ((phase / tau) % 1) - 1;
  if (type === 'square') return Math.sin(phase) >= 0 ? 1 : -1;
  return Math.sin(phase);
}

function env(t, dur, attack = 0.006, release = 0.18) {
  // 短起音 + 缓释音量包络，让提示音更像梦境风格的钟声而不是裸振荡器。
  if (t < 0 || t > dur) return 0;
  const a = Math.max(0.001, Math.min(attack, dur * 0.45));
  const r = Math.max(0.006, Math.min(release, dur * 0.75));
  if (t < a) return t / a;
  if (t > dur - r) return Math.max(0, (dur - t) / r);
  const body = (t - a) / Math.max(0.001, dur - a - r);
  return 1 - 0.28 * body;
}

function ensure(buf, seconds) {
  const n = Math.ceil(seconds * sampleRate);
  if (buf[0].length >= n) return;
  const old = buf[0].length;
  buf[0].length = n;
  buf[1].length = n;
  for (let i = old; i < n; i++) {
    buf[0][i] = 0;
    buf[1][i] = 0;
  }
}

function addNote(buf, n) {
  ensure(buf, n.start + n.dur + (n.release ?? 0.18) + 0.08);
  const start = Math.floor(n.start * sampleRate);
  const count = Math.floor(n.dur * sampleRate);
  const left = Math.cos(((n.pan ?? 0) + 1) * Math.PI / 4);
  const right = Math.sin(((n.pan ?? 0) + 1) * Math.PI / 4);
  let phase = 0;
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    const f = n.pitchTo ? n.freq * ((n.pitchTo / n.freq) ** (t / Math.max(0.001, n.dur))) : n.freq;
    phase += tau * f / sampleRate;
    const v = wave(n.wave ?? 'sine', phase) * env(t, n.dur, n.attack ?? 0.006, n.release ?? 0.18) * n.gain;
    const idx = start + i;
    buf[0][idx] += v * left;
    buf[1][idx] += v * right;
  }
}

function addNoise(buf, startSec, dur, gain, pan = 0, lowpass = 0.18) {
  ensure(buf, startSec + dur + 0.06);
  const start = Math.floor(startSec * sampleRate);
  const count = Math.floor(dur * sampleRate);
  const left = Math.cos((pan + 1) * Math.PI / 4);
  const right = Math.sin((pan + 1) * Math.PI / 4);
  let last = 0;
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    last = last * (1 - lowpass) + (rand() * 2 - 1) * lowpass;
    const v = last * env(t, dur, 0.002, dur * 0.7) * gain;
    const idx = start + i;
    buf[0][idx] += v * left;
    buf[1][idx] += v * right;
  }
}

function addDelay(buf, delay = 0.085, feedback = 0.24) {
  // 给所有音效加一个很短的双声道回声，统一声音空间感。
  const d = Math.floor(delay * sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const len = buf[ch].length;
    buf[ch].length = len + d * 3;
    for (let i = len; i < buf[ch].length; i++) buf[ch][i] = 0;
    for (let i = 0; i < len; i++) {
      const v = buf[ch][i];
      if (Math.abs(v) < 0.00001) continue;
      buf[ch][i + d] += v * feedback;
      buf[ch][i + d * 2] += v * feedback * 0.45;
    }
  }
}

function finish(buf) {
  // 裁掉尾部静音并做轻柔限幅，防止生成的 wav 爆音。
  let end = Math.max(1, buf[0].length - 1);
  for (let i = buf[0].length - 1; i > Math.floor(sampleRate * 0.1); i--) {
    if (Math.abs(buf[0][i]) > 0.0009 || Math.abs(buf[1][i]) > 0.0009) {
      end = Math.min(buf[0].length, i + Math.floor(sampleRate * 0.04));
      break;
    }
  }
  buf[0] = buf[0].slice(0, end);
  buf[1] = buf[1].slice(0, end);
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) for (const v of buf[ch]) peak = Math.max(peak, Math.abs(v));
  const drive = 0.95 / Math.max(peak, 0.001);
  for (let ch = 0; ch < 2; ch++) {
    for (let i = 0; i < buf[ch].length; i++) buf[ch][i] = Math.tanh(buf[ch][i] * drive * 1.45) * 0.86;
  }
}

function writeWav(name, buf) {
  finish(buf);
  mkdirSync(outDir, { recursive: true });
  const dataSize = buf[0].length * 4;
  const file = Buffer.alloc(44 + dataSize);
  file.write('RIFF', 0);
  file.writeUInt32LE(36 + dataSize, 4);
  file.write('WAVE', 8);
  file.write('fmt ', 12);
  file.writeUInt32LE(16, 16);
  file.writeUInt16LE(1, 20);
  file.writeUInt16LE(2, 22);
  file.writeUInt32LE(sampleRate, 24);
  file.writeUInt32LE(sampleRate * 4, 28);
  file.writeUInt16LE(4, 32);
  file.writeUInt16LE(16, 34);
  file.write('data', 36);
  file.writeUInt32LE(dataSize, 40);
  let o = 44;
  for (let i = 0; i < buf[0].length; i++) {
    file.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(buf[0][i] * 32767))), o);
    file.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(buf[1][i] * 32767))), o + 2);
    o += 4;
  }
  const path = resolve(outDir, `${name}.wav`);
  writeFileSync(path, file);
  console.log(`OK ${name.padEnd(12)} ${(buf[0].length / sampleRate).toFixed(2)}s ${Math.round(statSync(path).size / 1024)}KB`);
}

function render(name, notes, noises = []) {
  const buf = [[], []];
  for (const n of notes) addNote(buf, n);
  for (const n of noises) addNoise(buf, ...n);
  addDelay(buf);
  writeWav(name, buf);
}

console.log(`Generating audio to ${outDir}\n`);

render('tower_place', [
  { freq: 523.25, start: 0.00, dur: 0.24, gain: 0.34, wave: 'triangle', pan: -0.25 },
  { freq: 783.99, start: 0.035, dur: 0.32, gain: 0.26, wave: 'sine', pan: 0.2 },
  { freq: 1046.5, start: 0.10, dur: 0.36, gain: 0.16, wave: 'sine' },
], [[0, 0.16, 0.06, 0, 0.08]]);
render('tower_fire', [
  { freq: 1174.66, start: 0, dur: 0.07, gain: 0.18, wave: 'sine', pan: -0.18, pitchTo: 880, release: 0.04 },
  { freq: 1760, start: 0.012, dur: 0.055, gain: 0.07, wave: 'sine', pan: 0.18, pitchTo: 1320, release: 0.04 },
]);
render('enemy_hit', [
  { freq: 220, start: 0, dur: 0.09, gain: 0.24, wave: 'triangle', pitchTo: 146.83, release: 0.04 },
  { freq: 330, start: 0.015, dur: 0.07, gain: 0.11, wave: 'sine', pan: -0.2, pitchTo: 196, release: 0.05 },
], [[0, 0.075, 0.10, 0.08, 0.28]]);
render('enemy_die', [
  { freq: 392, start: 0, dur: 0.22, gain: 0.24, wave: 'triangle', pan: -0.25, pitchTo: 196 },
  { freq: 293.66, start: 0.045, dur: 0.25, gain: 0.18, wave: 'sine', pan: 0.2, pitchTo: 146.83 },
  { freq: 98, start: 0.08, dur: 0.36, gain: 0.12, wave: 'sine', pitchTo: 73.42 },
], [[0.03, 0.28, 0.09, 0, 0.12]]);
render('sanity_hit', [
  { freq: 110, start: 0, dur: 0.54, gain: 0.36, wave: 'sine', pitchTo: 73.42, release: 0.24 },
  { freq: 185, start: 0.015, dur: 0.42, gain: 0.12, wave: 'triangle', pan: -0.2, pitchTo: 123.47 },
  { freq: 92.5, start: 0.11, dur: 0.52, gain: 0.14, wave: 'sine', pan: 0.18, pitchTo: 61.74 },
], [[0, 0.36, 0.12, 0, 0.06]]);
render('wave_start', [
  { freq: 261.63, start: 0, dur: 0.42, gain: 0.22, wave: 'triangle', pan: -0.2 },
  { freq: 329.63, start: 0.09, dur: 0.42, gain: 0.19, wave: 'triangle', pan: 0.1 },
  { freq: 392, start: 0.18, dur: 0.50, gain: 0.17, wave: 'sine' },
  { freq: 523.25, start: 0.32, dur: 0.54, gain: 0.13, wave: 'sine', pan: 0.25 },
]);
render('review_open', [
  { freq: 329.63, start: 0, dur: 0.54, gain: 0.18, wave: 'sine', pan: -0.3 },
  { freq: 493.88, start: 0.07, dur: 0.56, gain: 0.15, wave: 'sine', pan: 0.1 },
  { freq: 659.25, start: 0.14, dur: 0.60, gain: 0.10, wave: 'sine', pan: 0.3 },
]);
render('choice_pick', [
  { freq: 659.25, start: 0, dur: 0.10, gain: 0.16, wave: 'sine', pan: -0.1 },
  { freq: 987.77, start: 0.045, dur: 0.13, gain: 0.12, wave: 'sine', pan: 0.22 },
]);
render('victory', [
  { freq: 392, start: 0, dur: 0.75, gain: 0.22, wave: 'triangle', pan: -0.25 },
  { freq: 493.88, start: 0.14, dur: 0.78, gain: 0.19, wave: 'triangle', pan: 0.15 },
  { freq: 587.33, start: 0.28, dur: 0.82, gain: 0.17, wave: 'sine', pan: -0.05 },
  { freq: 783.99, start: 0.48, dur: 1.05, gain: 0.14, wave: 'sine', pan: 0.25 },
], [[0.46, 0.45, 0.035, 0, 0.04]]);
render('gameover', [
  { freq: 220, start: 0, dur: 0.78, gain: 0.30, wave: 'triangle', pitchTo: 174.61, release: 0.34 },
  { freq: 164.81, start: 0.22, dur: 0.86, gain: 0.24, wave: 'sine', pan: -0.18, pitchTo: 123.47, release: 0.42 },
  { freq: 110, start: 0.50, dur: 0.95, gain: 0.18, wave: 'sine', pan: 0.18, pitchTo: 82.41, release: 0.46 },
], [[0, 0.55, 0.08, 0, 0.05]]);
