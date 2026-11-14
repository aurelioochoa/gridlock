// Every sound, synthesized (design §9: zero asset files). The context starts on the first
// user gesture — browsers refuse audio before one — and mute is a gain of zero, persisted.
//
// The roll, the *bop*, meeps pitched by size, the van's two-note bell, an original six-note
// jingle, a scoop *plop*, star chimes, a hint sparkle, a surf hush. No music loop.

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let surf: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let muted = false;

export function setMuted(on: boolean): void {
  muted = on;
  if (master && ctx) master.gain.setTargetAtTime(on ? 0 : 0.9, ctx.currentTime, 0.02);
}

export function isMuted(): boolean {
  return muted;
}

/** Call from a user gesture. Safe to call repeatedly. */
export function unlock(): void {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < d.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        d[i] = (seed / 0x7fffffff) * 2 - 1;
      }
      startSurf();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** Pause audio while the tab is hidden; resume on return. */
export function setHidden(hidden: boolean): void {
  if (!ctx) return;
  try {
    if (hidden) void ctx.suspend();
    else void ctx.resume();
  } catch {
    // ignore
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(master);
  o.start(start);
  o.stop(start + dur + 0.02);
}

function hiss(start: number, dur: number, filterFreq: number, vol: number, q = 0.7): void {
  if (!ctx || !master || !noise) return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = filterFreq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f).connect(g).connect(master);
  src.start(start, Math.random() * 0.5);
  src.stop(start + dur + 0.05);
}

const now = () => (ctx ? ctx.currentTime : 0);

/** Rubber wheels on tarmac, longer for a longer slide. */
export function roll(bays: number): void {
  if (!ctx) return;
  hiss(now(), 0.08 + Math.min(bays, 4) * 0.05, 380, 0.22, 2);
}

export function bop(): void {
  if (!ctx) return;
  tone(520, now(), 0.09, 'sine', 0.28, 360);
}

/** A soft meep: hatchback high, camper low. */
export function meep(len: number): void {
  if (!ctx) return;
  const f = len >= 3 ? 330 : 620;
  const t = now();
  tone(f, t, 0.07, 'triangle', 0.16);
  tone(f * 1.06, t + 0.08, 0.09, 'triangle', 0.14);
}

/** The van's bell: its path is clear. */
export function bell(): void {
  if (!ctx) return;
  const t = now();
  tone(1318.5, t, 0.5, 'triangle', 0.17);
  tone(1046.5, t + 0.16, 0.7, 'triangle', 0.17);
}

/** An original six-note jingle (not any ice-cream-van tune that exists). */
export function jingle(): void {
  if (!ctx) return;
  const notes = [784, 988, 1175, 1047, 1319, 1568];
  const t = now();
  notes.forEach((f, i) => {
    tone(f, t + i * 0.14, 0.32, 'triangle', 0.15);
    tone(f * 2, t + i * 0.14, 0.12, 'sine', 0.04);
  });
}

export function plop(): void {
  if (!ctx) return;
  const t = now();
  tone(700, t, 0.16, 'sine', 0.3, 180);
  hiss(t, 0.06, 1200, 0.06);
}

export function chime(k: number): void {
  if (!ctx) return;
  tone([1047, 1319, 1568][k] ?? 1568, now(), 0.45, 'sine', 0.18);
}

export function sparkle(): void {
  if (!ctx) return;
  const t = now();
  [2093, 2637, 3136, 2637].forEach((f, i) => tone(f, t + i * 0.06, 0.18, 'sine', 0.06));
}

/** A tiny tick for menus and taps that do nothing else. */
export function tick(): void {
  if (!ctx) return;
  tone(880, now(), 0.04, 'sine', 0.08);
}

/** The surf: a slow, very quiet hush under everything. Not music. */
function startSurf(): void {
  if (!ctx || !master || !noise || surf) return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 700;
  f.Q.value = 0.4;
  const gain = ctx.createGain();
  gain.gain.value = 0.012;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.09;
  const depth = ctx.createGain();
  depth.gain.value = 0.01;
  lfo.connect(depth).connect(gain.gain);
  src.connect(f).connect(gain).connect(master);
  src.start();
  lfo.start();
  surf = { src, gain };
}
