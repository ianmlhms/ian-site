/* Ski Alpen menu music (28 Nov 2026): an original calm loop for the resort picker and the menus, composed here as code and rendered at run
 * time (nothing is downloaded, no samples). G major, 56 bpm, 8 bars = 34.3 s: a slow pad of detuned sines on maj7 / 9 chords, a soft harp-like
 * arpeggio, a music-box melody on the G pentatonic, a low bass note per bar and a faint mountain-wind bed, all through a stereo reverb.
 * Seamless loop: notes and the reverb wrap round the end (the dry signal is run through the reverb twice, the second pass is kept), so the
 * last tail rings into the first bar exactly as in a long take.
 * `renderMusicSteps(rate)` is a generator (it yields between pieces of work so the page stays responsive on a school iPad) that returns
 * { left, right, length, seconds }; `renderMusic(rate)` runs it to the end (node, tests). 22.05 kHz stereo = 5.6 MB as floats, it is only
 * rendered after the first touch and only when a menu is up. */
import { rngOf, noise, pinkOf, biquad, rms, peak } from './sound-bank.js';

export const MUSIC_RATE = 22050;
export const BPM = 56;
export const BARS = 8;
const TAU = Math.PI * 2;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const CHORDS = [        // [bass, pad voices (MIDI)]
  [31, [55, 59, 62, 66]],      // Gmaj7
  [28, [55, 59, 62, 66, 71]],  // Em9
  [24, [52, 55, 59, 66]],      // Cmaj7(#11)
  [26, [50, 54, 57, 59, 64]],  // D6/9
  [31, [55, 59, 62, 66, 69]],  // Gmaj9
  [23, [50, 54, 57, 62]],      // Bm7
  [24, [52, 55, 59, 62]],      // Cmaj9
  [26, [55, 57, 62, 66]],      // Dsus4 -> D, turns back to the start
];
const MELODY = [        // [beat in the bar, MIDI] per bar (G pentatonic + the chord's own colour)
  [[0, 74], [2, 71], [3, 69]],
  [[0, 71], [1.5, 76], [3, 74]],
  [[0, 79], [2, 76], [3, 74]],
  [[0, 74], [1, 69], [2.5, 71]],
  [[0, 79], [1, 74], [2, 76], [3.5, 74]],
  [[0, 78], [2, 74], [3, 71]],
  [[0, 76], [1.5, 74], [2, 71], [3, 67]],
  [[0, 69], [2, 74], [3.5, 78]],
];
const ARP = [0, 2, 1, 3, 2, 1, 3, 2];       // pad-voice index of each eighth note of the arpeggio

/** Adds a sum of partials [ratio, amp, decay (1/s), detune] with an attack and a release; wraps round the loop end.
 *  Each partial is a rotating phasor (4 multiplies a sample) under an exponential decay (one multiply), no sin / exp in the loop. */
function voice(L, R, N, rate, startSec, f, partials, { attack = 0.01, hold = 0, rel = 0.5, dur = 3, amp = 1, pan = 0, detune = 0 }) {
  const gl = Math.cos((pan + 1) * Math.PI / 4) * amp, gr = Math.sin((pan + 1) * Math.PI / 4) * amp;
  const total = Math.floor((dur + rel) * rate), s0 = Math.floor(startSec * rate);
  const att = Math.max(1, Math.floor(attack * rate)), holdN = Math.floor(hold * rate), durN = Math.floor(dur * rate), relN = Math.max(1, Math.floor(rel * rate));
  for (const [ratio, a, decay, det = 0] of partials) {
    const w = TAU * f * ratio * (1 + det + detune) / rate, cw = Math.cos(w), sw = Math.sin(w);
    const len = Math.min(total, Math.floor((6.2 / Math.max(decay, 0.05)) * rate)), dm = Math.exp(-decay / rate);
    const ph0 = ((startSec * 13.7 + ratio) % 1) * TAU;
    let x = Math.cos(ph0), y = Math.sin(ph0), env = 1;
    for (let i = 0; i < len; i++) {
      const nx = x * cw - y * sw; y = x * sw + y * cw; x = nx;
      if (i > holdN) env *= dm;
      let e = env;
      if (i < att) e *= i / att;
      if (i > durN) e *= Math.max(0, 1 - (i - durN) / relN);
      let j = s0 + i; if (j >= N) j -= N;
      const v = y * a * e;
      L[j] += v * gl; R[j] += v * gr;
    }
  }
}

class Reverb {
  constructor(rate) {
    const k = rate / 44100, d = (a, off) => Math.max(8, Math.round(a * k) + off);
    this.combs = [[1557, 0], [1617, 0], [1491, 0], [1422, 0]].map(([a]) => [0, 1].map((side) => ({ buf: new Float32Array(d(a, side * 23)), i: 0, lp: 0 })));
    this.aps = [225, 556].map((a) => [0, 1].map((side) => ({ buf: new Float32Array(d(a, side * 7)), i: 0 })));
    this.fb = 0.88; this.damp = 0.3;
  }
  /** Processes src[from, to) of mono input `x` into out[from, to) (side 0 / 1). */
  run(x, out, from, to, side) {
    const { fb, damp } = this;
    for (let n = from; n < to; n++) {
      const v = x[n] * 0.25;
      let s = 0;
      for (const pair of this.combs) {
        const c = pair[side], y = c.buf[c.i];
        c.lp = y * (1 - damp) + c.lp * damp;
        c.buf[c.i] = v + c.lp * fb;
        if (++c.i >= c.buf.length) c.i = 0;
        s += y;
      }
      for (const pair of this.aps) {
        const a = pair[side], b = a.buf[a.i], y = -s + b;
        a.buf[a.i] = s + b * 0.5;
        if (++a.i >= a.buf.length) a.i = 0;
        s = y;
      }
      out[n] = s;
    }
  }
}

export function* renderMusicSteps(rate = MUSIC_RATE) {
  const beat = 60 / BPM, barSec = beat * 4, N = Math.round(barSec * BARS * rate);
  const dL = new Float32Array(N), dR = new Float32Array(N), r = rngOf(2026);
  // pad: each chord rings its bar and melts into the next
  for (let b = 0; b < BARS; b++) {
    const [bass, notes] = CHORDS[b];
    notes.forEach((m, k) => {
      voice(dL, dR, N, rate, b * barSec + k * 0.05, mtof(m), [[1, 0.5, 0.22, -0.0011], [1, 0.5, 0.22, 0.0011], [2, 0.14, 0.4], [3, 0.04, 0.6]],
        { attack: 1.4, dur: barSec + 0.8, rel: 2.2, amp: 0.075, pan: (k / (notes.length - 1) - 0.5) * 0.9 });
    });
    voice(dL, dR, N, rate, b * barSec, mtof(bass), [[1, 1, 0.55], [2, 0.22, 0.9]], { attack: 0.06, dur: barSec * 0.9, rel: 1.5, amp: 0.2, pan: 0 });
    if (b % 2 === 1) voice(dL, dR, N, rate, b * barSec + beat * 2.5, mtof(bass + 7), [[1, 1, 0.9], [2, 0.15, 1.4]], { attack: 0.05, dur: beat * 1.4, rel: 1, amp: 0.1, pan: 0 });
    yield;
  }
  // harp-like arpeggio, eighth notes
  for (let b = 0; b < BARS; b++) {
    const notes = CHORDS[b][1];
    for (let e = 0; e < 8; e++) {
      const m = notes[ARP[e] % notes.length] + 12, t = b * barSec + e * beat / 2 + (r() - 0.5) * 0.012;
      const vol = (e % 4 === 0 ? 1 : 0.72) * (0.85 + 0.3 * r());
      voice(dL, dR, N, rate, t, mtof(m), [[1, 1, 1.5], [2, 0.5, 2.6], [3, 0.26, 3.8], [4, 0.14, 5.2], [5.01, 0.07, 6.5]], { attack: 0.004, dur: 2.2, rel: 0.4, amp: 0.05 * vol, pan: ((ARP[e] % 4) - 1.5) * 0.28 });
    }
    yield;
  }
  // music-box melody
  for (let b = 0; b < BARS; b++) {
    MELODY[b].forEach(([pos, m], k) => {
      voice(dL, dR, N, rate, b * barSec + pos * beat, mtof(m), [[1, 1, 0.9], [2.01, 0.34, 1.7], [3.99, 0.12, 3.2], [5.4, 0.06, 5]], { attack: 0.005, dur: 3.2, rel: 0.6, amp: 0.1 * (0.9 + 0.2 * r()), pan: (k % 2 ? 0.3 : -0.3) });
    });
  }
  yield;
  // a faint bed of mountain wind, breathing over the whole loop (the tail is crossfaded into the head: seamless)
  {
    const F = Math.floor(rate * 0.4), bed = (seed) => {
      const q = rngOf(seed), x = biquad(pinkOf(noise(N + F, q)), 'bandpass', 520, 0.7, rate), y = x.slice(0, N);
      for (let i = 0; i < F; i++) { const t = i / F; y[i] = x[i] * Math.sin(t * Math.PI / 2) + x[N + i] * Math.cos(t * Math.PI / 2); }
      return y;
    };
    const w = bed(71), v = bed(72);
    for (let i = 0; i < N; i++) { const env = 0.6 + 0.4 * Math.sin(TAU * (2 * i / N) + 0.8); dL[i] += w[i] * 0.05 * env; dR[i] += v[i] * 0.05 * env; }
  }
  yield;
  // reverb: the dry mix twice in a row, the second pass is the steady state of the loop
  const monoIn = (d, from, to, tmp) => { for (let i = from; i < to; i++) tmp[i] = d[i % N]; };
  const rvL = new Reverb(rate), rvR = new Reverb(rate), wetL = new Float32Array(N), wetR = new Float32Array(N);
  const BLOCK = 1 << 15, pre = Math.floor(rate * 0.03), tmp = new Float32Array(N * 2), outL = new Float32Array(N * 2), outR = new Float32Array(N * 2), tmpR = new Float32Array(N * 2);
  monoIn(dL, 0, N * 2, tmp); monoIn(dR, 0, N * 2, tmpR);
  const mix = new Float32Array(N * 2);
  for (let i = pre; i < N * 2; i++) mix[i] = (tmp[i - pre] + tmpR[i - pre]) * 0.5;
  for (let from = 0; from < N * 2; from += BLOCK) {
    const to = Math.min(N * 2, from + BLOCK);
    rvL.run(mix, outL, from, to, 0); rvR.run(mix, outR, from, to, 1);
    yield;
  }
  for (let i = 0; i < N; i++) { wetL[i] = outL[N + i]; wetR[i] = outR[N + i]; }
  const wk = 0.55 * rms(dL) / (rms(wetL) || 1);
  const left = new Float32Array(N), right = new Float32Array(N);
  // one gentle high cut (about 7 kHz) so the bells stay soft
  let lpL = 0, lpR = 0;
  const a = 1 - Math.exp(-TAU * 7000 / rate);
  for (let i = 0; i < N; i++) { lpL += a * ((dL[i] * 0.85 + wetL[i] * wk) - lpL); lpR += a * ((dR[i] * 0.85 + wetR[i] * wk) - lpR); left[i] = lpL; right[i] = lpR; }
  // the high cut's state at the loop point: start the filter where it ended, so the seam is smooth
  { let sl = left[N - 1], sr2 = right[N - 1]; for (let i = 0; i < Math.floor(rate * 0.3); i++) { sl += a * ((dL[i] * 0.85 + wetL[i] * wk) - sl); sr2 += a * ((dR[i] * 0.85 + wetR[i] * wk) - sr2); left[i] = sl; right[i] = sr2; } }
  const k = 0.1 / (Math.sqrt((rms(left) ** 2 + rms(right) ** 2) / 2) || 1);       // the loop's RMS: 0.1 (about -20 dBFS); audio.js plays it at MUSIC_LEVEL
  for (let i = 0; i < N; i++) { left[i] *= k; right[i] *= k; }
  return { left, right, length: N, seconds: N / rate, rate, peak: Math.max(peak(left), peak(right)) };
}

export function renderMusic(rate = MUSIC_RATE) {
  const it = renderMusicSteps(rate);
  for (;;) { const s = it.next(); if (s.done) return s.value; }
}
