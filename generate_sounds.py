"""
Generate polished WAV sound effects for Cognitive Siege.

The game can use downloaded CC0 audio packs, but this script keeps the repo
self-contained: it renders a cohesive "dream tower defense" sound palette with
soft chimes, airy noise, short delays and gentle limiting using Python stdlib.
Run:

    python generate_sounds.py

Output:
    public/assets/audio/*.wav
"""

from __future__ import annotations

import math
import os
import random
import struct
import wave
from dataclasses import dataclass


ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(ROOT, "public", "assets", "audio")
SAMPLE_RATE = 44_100
TAU = math.pi * 2
random.seed(20260426)


@dataclass(frozen=True)
class Note:
    freq: float
    start: float
    dur: float
    gain: float
    wave: str = "sine"
    pan: float = 0.0
    pitch_to: float | None = None
    attack: float = 0.006
    release: float = 0.18


def ensure_len(buf: list[list[float]], seconds: float) -> None:
    target = int(seconds * SAMPLE_RATE)
    while len(buf[0]) < target:
        buf[0].append(0.0)
        buf[1].append(0.0)


def osc(wave_type: str, phase: float) -> float:
    if wave_type == "triangle":
        return 2.0 * abs(2.0 * ((phase / TAU) % 1.0) - 1.0) - 1.0
    if wave_type == "saw":
        return 2.0 * ((phase / TAU) % 1.0) - 1.0
    if wave_type == "square":
        return 1.0 if math.sin(phase) >= 0 else -1.0
    return math.sin(phase)


def envelope(t: float, dur: float, attack: float, release: float) -> float:
    if t < 0 or t > dur:
        return 0.0
    a = max(0.001, min(attack, dur * 0.45))
    r = max(0.006, min(release, dur * 0.75))
    if t < a:
        return t / a
    if t > dur - r:
        return max(0.0, (dur - t) / r)
    # A slow decay keeps chimes musical without feeling like a raw oscillator.
    body = (t - a) / max(0.001, dur - a - r)
    return 1.0 - 0.28 * body


def add_note(buf: list[list[float]], note: Note) -> None:
    ensure_len(buf, note.start + note.dur + note.release + 0.05)
    start = int(note.start * SAMPLE_RATE)
    count = int(note.dur * SAMPLE_RATE)
    phase = 0.0
    left = math.cos((note.pan + 1) * math.pi / 4)
    right = math.sin((note.pan + 1) * math.pi / 4)
    for i in range(count):
        t = i / SAMPLE_RATE
        frac = t / max(0.001, note.dur)
        freq = note.freq
        if note.pitch_to is not None:
            freq = note.freq * ((note.pitch_to / note.freq) ** frac)
        phase += TAU * freq / SAMPLE_RATE
        value = osc(note.wave, phase) * envelope(t, note.dur, note.attack, note.release) * note.gain
        idx = start + i
        buf[0][idx] += value * left
        buf[1][idx] += value * right


def add_noise(
    buf: list[list[float]],
    start_sec: float,
    dur: float,
    gain: float,
    pan: float = 0.0,
    lowpass: float = 0.18,
) -> None:
    ensure_len(buf, start_sec + dur + 0.05)
    start = int(start_sec * SAMPLE_RATE)
    count = int(dur * SAMPLE_RATE)
    left = math.cos((pan + 1) * math.pi / 4)
    right = math.sin((pan + 1) * math.pi / 4)
    last = 0.0
    for i in range(count):
        t = i / SAMPLE_RATE
        raw = random.uniform(-1, 1)
        last = last * (1 - lowpass) + raw * lowpass
        env = envelope(t, dur, 0.002, dur * 0.7)
        idx = start + i
        v = last * env * gain
        buf[0][idx] += v * left
        buf[1][idx] += v * right


def add_delay(buf: list[list[float]], delay: float = 0.085, feedback: float = 0.24) -> None:
    samples = int(delay * SAMPLE_RATE)
    for ch in range(2):
        original_len = len(buf[ch])
        buf[ch].extend([0.0] * (samples * 3))
        for i in range(original_len):
            v = buf[ch][i]
            if abs(v) < 0.00001:
                continue
            buf[ch][i + samples] += v * feedback
            buf[ch][i + samples * 2] += v * feedback * 0.45


def soft_limit(buf: list[list[float]], gain: float = 0.95) -> None:
    peak = max(max(abs(v) for v in ch) for ch in buf) or 1.0
    drive = gain / peak
    for ch in range(2):
        for i, v in enumerate(buf[ch]):
            buf[ch][i] = math.tanh(v * drive * 1.45) * 0.86


def trim_tail(buf: list[list[float]], min_seconds: float = 0.12) -> None:
    floor = int(min_seconds * SAMPLE_RATE)
    end = max(len(buf[0]) - 1, floor)
    threshold = 0.0009
    for i in range(len(buf[0]) - 1, floor, -1):
        if abs(buf[0][i]) > threshold or abs(buf[1][i]) > threshold:
            end = min(len(buf[0]) - 1, i + int(0.04 * SAMPLE_RATE))
            break
    del buf[0][end:]
    del buf[1][end:]


def write_wav(name: str, buf: list[list[float]]) -> None:
    trim_tail(buf)
    soft_limit(buf)
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{name}.wav")
    with wave.open(path, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        for l, r in zip(buf[0], buf[1]):
            wf.writeframes(struct.pack("<hh", int(l * 32767), int(r * 32767)))
    print(f"OK {name:12s} {len(buf[0]) / SAMPLE_RATE:5.2f}s  {os.path.getsize(path) // 1024:4d} KB")


def render(name: str, notes: list[Note], noises: list[tuple[float, float, float, float, float]] = ()) -> None:
    buf = [[], []]
    for n in notes:
        add_note(buf, n)
    for args in noises:
        add_noise(buf, *args)
    add_delay(buf)
    write_wav(name, buf)


def main() -> None:
    print(f"Generating polished audio to: {OUT_DIR}\n")
    render(
        "tower_place",
        [
            Note(523.25, 0.00, 0.24, 0.34, "triangle", -0.25),
            Note(783.99, 0.035, 0.32, 0.26, "sine", 0.20),
            Note(1046.5, 0.10, 0.36, 0.16, "sine", 0.0),
        ],
        [(0.0, 0.16, 0.06, 0.0, 0.08)],
    )
    render(
        "tower_fire",
        [
            Note(1174.66, 0.00, 0.07, 0.18, "sine", -0.18, pitch_to=880),
            Note(1760.00, 0.012, 0.055, 0.07, "sine", 0.18, pitch_to=1320),
        ],
    )
    render(
        "enemy_hit",
        [
            Note(220, 0.00, 0.09, 0.24, "triangle", 0.0, pitch_to=146.83, release=0.04),
            Note(330, 0.015, 0.07, 0.11, "sine", -0.2, pitch_to=196, release=0.05),
        ],
        [(0.0, 0.075, 0.10, 0.08, 0.28)],
    )
    render(
        "enemy_die",
        [
            Note(392, 0.00, 0.22, 0.24, "triangle", -0.25, pitch_to=196),
            Note(293.66, 0.045, 0.25, 0.18, "sine", 0.2, pitch_to=146.83),
            Note(98, 0.08, 0.36, 0.12, "sine", 0.0, pitch_to=73.42),
        ],
        [(0.03, 0.28, 0.09, 0.0, 0.12)],
    )
    render(
        "sanity_hit",
        [
            Note(110, 0.00, 0.54, 0.36, "sine", 0.0, pitch_to=73.42, release=0.24),
            Note(185, 0.015, 0.42, 0.12, "triangle", -0.2, pitch_to=123.47),
            Note(92.5, 0.11, 0.52, 0.14, "sine", 0.18, pitch_to=61.74),
        ],
        [(0.0, 0.36, 0.12, 0.0, 0.06)],
    )
    render(
        "wave_start",
        [
            Note(261.63, 0.00, 0.42, 0.22, "triangle", -0.2),
            Note(329.63, 0.09, 0.42, 0.19, "triangle", 0.1),
            Note(392.00, 0.18, 0.50, 0.17, "sine", 0.0),
            Note(523.25, 0.32, 0.54, 0.13, "sine", 0.25),
        ],
    )
    render(
        "review_open",
        [
            Note(329.63, 0.00, 0.54, 0.18, "sine", -0.3),
            Note(493.88, 0.07, 0.56, 0.15, "sine", 0.1),
            Note(659.25, 0.14, 0.60, 0.10, "sine", 0.3),
        ],
    )
    render(
        "choice_pick",
        [
            Note(659.25, 0.00, 0.10, 0.16, "sine", -0.1),
            Note(987.77, 0.045, 0.13, 0.12, "sine", 0.22),
        ],
    )
    render(
        "victory",
        [
            Note(392.00, 0.00, 0.75, 0.22, "triangle", -0.25),
            Note(493.88, 0.14, 0.78, 0.19, "triangle", 0.15),
            Note(587.33, 0.28, 0.82, 0.17, "sine", -0.05),
            Note(783.99, 0.48, 1.05, 0.14, "sine", 0.25),
        ],
        [(0.46, 0.45, 0.035, 0.0, 0.04)],
    )
    render(
        "gameover",
        [
            Note(220.00, 0.00, 0.78, 0.30, "triangle", 0.0, pitch_to=174.61, release=0.34),
            Note(164.81, 0.22, 0.86, 0.24, "sine", -0.18, pitch_to=123.47, release=0.42),
            Note(110.00, 0.50, 0.95, 0.18, "sine", 0.18, pitch_to=82.41, release=0.46),
        ],
        [(0.0, 0.55, 0.08, 0.0, 0.05)],
    )


if __name__ == "__main__":
    main()
