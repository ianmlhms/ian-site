/* Ski Alpen sound bank (28 Nov 2026): the short buffers behind audio.js, all computed at run time from our own formulas (no samples, nothing is
 * downloaded). Pure JS on Float32Arrays, so the same code runs in the browser and in node (scripts/ski/sound-render.mjs writes them to WAV).
 * Everything is seeded: the same buffers every time, so a render can be compared before / after.
 *   loops    carve (groomed snow), powder, scrape (ice chatter), glide, wind, air, hum (lift line), machine (bull wheel), crowd, rumble
 *   shots    land (light / heavy), clack (chair grip over the sheaves, 3 variants), door (gondola), birds (6 phrases + a chough call)
 * Physical-model-ish shaping: snow = a hiss plus sparse crystal crackle through a resonator, a scrape = a train of grains through a resonator
 * under an irregular chatter envelope, wind = pink noise whose spectrum gusts plus two whistles, the crowd = glottal pulses through vowel
 * formants in short syllables (no words), the clack = a noise burst ringing modal filters. Loops are made seamless by crossfading the
 * tail into the head, and are long enough (3 - 9 s) that audio.js can play two copies at different speeds without a repeat being heard.
 * Levels: every loop is scaled to the RMS of the buffer it replaces (white * 0.5 = 0.289), so the gains in audio.js stay as they were. */

export const RATE = { hi: 32000, mid: 22050, lo: 16000 };
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function rngOf(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ---------------- small DSP helpers ---------------- */
export function noise(n, r) { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = r() * 2 - 1; return x; }

/** RBJ biquad over a whole array ('lowpass' | 'highpass' | 'bandpass'); returns a new array. */
export function biquad(x, type, f, q, sr) {
  const w = TAU * clamp(f, 10, sr * 0.45) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'lowpass') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; } else if (type === 'highpass') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; } else { b0 = al; b1 = 0; b2 = -al; }
  const a0 = 1 + al, a1 = -2 * c / a0, a2 = (1 - al) / a0;
  b0 /= a0; b1 /= a0; b2 /= a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i], yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi;
  }
  return y;
}

/** Paul Kellet's pink filter over an array (the filter the old buffers used). */
export function pinkOf(w) {
  const d = new Float32Array(w.length);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < w.length; i++) { const v = w[i]; b0 = 0.99765 * b0 + v * 0.099046; b1 = 0.963 * b1 + v * 0.2965164; b2 = 0.57 * b2 + v * 1.0526913; d[i] = (b0 + b1 + b2 + v * 0.1848) * 0.2; }
  return d;
}

/** Slowly wandering random curve in -1..1 (linear between random knots `hz` apart), circular: its end meets its start. */
export function smoothNoise(n, sr, hz, r) {
  const step = Math.max(2, Math.round(sr / hz)), k = Math.max(2, Math.round(n / step));
  const knots = new Float32Array(k);
  for (let i = 0; i < k; i++) knots[i] = r() * 2 - 1;
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = (i / n) * k, a = Math.floor(p), t = p - a, s = t * t * (3 - 2 * t); y[i] = knots[a % k] * (1 - s) + knots[(a + 1) % k] * s; }
  return y;
}

export function rms(x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / x.length); }
export function peak(x) { let p = 0; for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i])); return p; }
function scaleRms(x, target) { const k = target / (rms(x) || 1); for (let i = 0; i < x.length; i++) x[i] *= k; return x; }

/** m = n + fade samples in, n samples out, seamless: the head is crossfaded with the surplus tail (equal power). */
function loopify(x, n, fade) {
  const y = x.slice(0, n);
  for (let i = 0; i < fade; i++) { const t = i / fade, a = Math.sin(t * Math.PI / 2), b = Math.cos(t * Math.PI / 2); y[i] = x[i] * a + x[n + i] * b; }
  return y;
}
const sinceSec = (sr, s) => Math.floor(sr * s);
function addAt(dst, src, at, gain = 1) { for (let i = 0; i < src.length; i++) { const j = at + i; if (j >= 0 && j < dst.length) dst[j] += src[i] * gain; } }
function addWrapped(dst, src, at, gain = 1) { const n = dst.length; for (let i = 0; i < src.length; i++) dst[(((at + i) % n) + n) % n] += src[i] * gain; }

/* the RMS of the buffers the old audio.js used (white * 0.5, Kellet pink * 0.2), measured once from this very recipe */
const RMS_WHITE = 0.2887, RMS_PINK = 0.3448;

/* ---------------- loops ---------------- */
/** Groomed snow under a carving edge: a broad hiss that breathes with the edge chatter, plus sparse bright crystal crackle. */
export function carveLoop(sr = RATE.hi, seconds = 3.7, seed = 11) {
  const r = rngOf(seed), n = sinceSec(sr, seconds), F = sinceSec(sr, 0.12), m = n + F;
  const x = noise(m, r), chatter = smoothNoise(m, sr, 7, r), swell = smoothNoise(m, sr, 1.3, r);
  for (let i = 0; i < m; i++) x[i] *= 1 + 0.26 * chatter[i] + 0.14 * swell[i];
  const grains = new Float32Array(m);
  for (let i = 0; i < m; i++) if (r() < 110 / sr) grains[i] = (r() < 0.5 ? -1 : 1) * (0.4 + 2.4 * Math.pow(r(), 3));
  const crackle = biquad(grains, 'bandpass', 5200, 3, sr);
  for (let i = 0; i < m; i++) x[i] += crackle[i] * 1.6;
  return scaleRms(loopify(x, n, F), RMS_WHITE);
}

/** Deep snow: a soft pink "fff" with slow swells and low puffs where the snow gives way. */
export function powderLoop(sr = RATE.lo, seconds = 4.3, seed = 12) {
  const r = rngOf(seed), n = sinceSec(sr, seconds), F = sinceSec(sr, 0.12), m = n + F;
  const base = biquad(pinkOf(noise(m, r)), 'lowpass', 1500, 0.6, sr), swell = smoothNoise(m, sr, 2.2, r);
  for (let i = 0; i < m; i++) base[i] *= 0.8 + 0.38 * swell[i];
  const puffLen = sinceSec(sr, 0.14);
  for (let t = r() * sr * 0.2; t < m; t += sr * (0.12 + 0.3 * r())) {
    const puff = new Float32Array(puffLen), src = noise(puffLen, r), a = 0.35 + 0.65 * r();
    for (let i = 0; i < puffLen; i++) puff[i] = src[i] * Math.pow(Math.sin(Math.PI * i / puffLen), 1.5) * a;
    addAt(base, biquad(puff, 'lowpass', 520, 0.7, sr), Math.floor(t), 1.1);
  }
  return scaleRms(loopify(base, n, F), RMS_PINK);
}

/** Skis skidding on hard snow / ice: a train of grains rattling a resonance under an irregular stick-slip chatter. */
export function scrapeLoop(sr = RATE.hi, seconds = 3.1, seed = 13) {
  const r = rngOf(seed), n = sinceSec(sr, seconds), F = sinceSec(sr, 0.12), m = n + F;
  const grains = new Float32Array(m);
  for (let i = 0; i < m; i++) if (r() < 820 / sr) grains[i] = (r() < 0.5 ? -1 : 1) * (0.2 + Math.pow(r(), 2) * 1.8);
  const res = biquad(grains, 'bandpass', 1350, 1.8, sr), hiss = biquad(noise(m, r), 'bandpass', 2300, 0.7, sr);
  const chatter = smoothNoise(m, sr, 23, r), slow = smoothNoise(m, sr, 3, r), x = new Float32Array(m);
  for (let i = 0; i < m; i++) { const e = clamp(0.55 + 0.45 * chatter[i] + 0.2 * slow[i], 0.08, 1.4); x[i] = (res[i] * 1.5 + hiss[i] * 0.55) * e * e; }
  return scaleRms(loopify(x, n, F), RMS_WHITE);
}

/** Skis running straight: a soft low hiss, slow wobble, the odd tiny tick of the base over the groomer's corduroy. */
export function glideLoop(sr = RATE.hi, seconds = 3.4, seed = 14) {
  const r = rngOf(seed), n = sinceSec(sr, seconds), F = sinceSec(sr, 0.12), m = n + F;
  const x = biquad(noise(m, r), 'lowpass', 4800, 0.6, sr), wob = smoothNoise(m, sr, 0.9, r);
  for (let i = 0; i < m; i++) x[i] *= 1 + 0.2 * wob[i];
  const tick = new Float32Array(m);
  for (let i = 0; i < m; i++) if (r() < 14 / sr) tick[i] = (r() < 0.5 ? -1 : 1) * (0.5 + r());
  const ticks = biquad(tick, 'bandpass', 3400, 2, sr);
  for (let i = 0; i < m; i++) x[i] += ticks[i] * 0.7;
  return scaleRms(loopify(x, n, F), RMS_WHITE);
}

/** Rushing wind: pink noise with a gusting spectrum (low rumble <-> mid roar) and two thin whistles that come and go. */
export function windLoop(sr = RATE.lo, seconds = 6.5, seed = 15) {
  const r = rngOf(seed), n = sinceSec(sr, seconds), F = sinceSec(sr, 0.2), m = n + F;
  const pink = pinkOf(noise(m, r)), low = biquad(pink, 'lowpass', 320, 0.7, sr), mid = biquad(pink, 'bandpass', 950, 0.9, sr);
  const g = smoothNoise(m, sr, 0.45, r), g2 = smoothNoise(m, sr, 1.7, r);
  const w1 = biquad(noise(m, r), 'bandpass', 1110, 14, sr), w2 = biquad(noise(m, r), 'bandpass', 1730, 16, sr);
  const e1 = smoothNoise(m, sr, 0.7, r), e2 = smoothNoise(m, sr, 0.55, r), x = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const t = 0.5 + 0.5 * g[i];
    const a = Math.max(0, e1[i]), b = Math.max(0, e2[i]);
    x[i] = (low[i] * (1.2 - 0.7 * t) + mid[i] * (0.35 + 0.9 * t)) * (0.85 + 0.15 * g2[i]) + (w1[i] * a * a + w2[i] * b * b) * 1.4;
  }
  return scaleRms(loopify(x, n, F), RMS_PINK);
}

/** The mountain's own air: very slow low swells with a faint flutter, always a little there. */
export function airLoop(sr = RATE.lo, seconds = 7.7, seed = 16) {
  const r = rngOf(seed), n = sinceSec(sr, seconds), F = sinceSec(sr, 0.25), m = n + F;
  const x = biquad(pinkOf(noise(m, r)), 'lowpass', 600, 0.6, sr), swell = smoothNoise(m, sr, 0.22, r), flutter = smoothNoise(m, sr, 5, r);
  for (let i = 0; i < m; i++) x[i] *= 0.75 + 0.3 * swell[i] + 0.05 * flutter[i];
  return scaleRms(loopify(x, n, F), RMS_PINK);
}

/** Lift line: a 49 Hz motor drone with harmonics, a faint gearbox whine and the soft roller thumps of the sheave trains (2 per second). */
export function humLoop(sr = RATE.lo, seconds = 4, seed = 17) {
  const r = rngOf(seed), n = sinceSec(sr, seconds), x = new Float32Array(n);
  const trem = smoothNoise(n, sr, 0.5, r);
  for (let i = 0; i < n; i++) {
    const t = i / sr, lfo = 1 + 0.18 * trem[i] + 0.06 * Math.sin(TAU * 0.25 * t);
    let s = 0;
    for (let k = 1; k <= 8; k++) s += Math.sin(TAU * 49 * k * t + k * 0.7) * (k === 1 ? 0.55 : 0.9 / (k * 1.15)) * lfo;
    s += Math.sin(TAU * 312 * t) * 0.07 * (1 + 0.5 * Math.sin(TAU * 0.5 * t)) + Math.sin(TAU * 263 * t) * 0.04 + Math.sin(TAU * 361 * t) * 0.04;
    x[i] = s;
  }
  const thumpLen = sinceSec(sr, 0.1);
  for (let k = 0; k < seconds * 2; k++) {
    const th = new Float32Array(thumpLen), src = noise(thumpLen, r);
    for (let i = 0; i < thumpLen; i++) th[i] = src[i] * Math.exp(-i / (sr * 0.018));
    addWrapped(x, biquad(th, 'lowpass', 190, 1.1, sr), Math.floor(k * sr * 0.5 + (r() - 0.5) * sr * 0.02), 3.2);
  }
  const rumble = biquad(noise(n, r), 'lowpass', 70, 0.7, sr);
  for (let i = 0; i < n; i++) x[i] += rumble[i] * 3;
  return scaleRms(x, 0.3);
}

/** Station machinery: the bull wheel's low rumble, an inverter whine, gear chatter and two pneumatic hisses of the brake in the loop. */
export function machineLoop(sr = RATE.lo, seconds = 6, seed = 18) {
  const r = rngOf(seed), n = sinceSec(sr, seconds), F = sinceSec(sr, 0.3), m = n + F, x = new Float32Array(m);
  const rum = biquad(noise(m, r), 'lowpass', 85, 0.8, sr), grind = biquad(noise(m, r), 'bandpass', 640, 3, sr), g = smoothNoise(m, sr, 1.1, r);
  for (let i = 0; i < m; i++) {
    const t = i / sr;
    x[i] = rum[i] * 4 + grind[i] * (0.4 + 0.35 * g[i]) + Math.sin(TAU * 520 * t + 2 * Math.sin(TAU * 0.5 * t)) * 0.05 + Math.sin(TAU * 1040 * t) * 0.02;
  }
  for (const at of [0.9, 3.9]) {
    const len = sinceSec(sr, 0.8), h = noise(len, r);
    for (let i = 0; i < len; i++) { const u = i / len; h[i] *= Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.4)), 2) * Math.exp(-u * 3.2); }
    addAt(x, biquad(h, 'bandpass', 3000, 0.8, sr), Math.floor(at * sr), 0.9);
  }
  return scaleRms(loopify(x, n, F), 0.3);
}

/** A crowd of voices without words: glottal pulses through vowel formants in short syllables with pauses; 7 talkers over 8 s. */
export function crowdLoop(sr = RATE.lo, seconds = 8, seed = 19) {
  const r = rngOf(seed), n = sinceSec(sr, seconds), x = new Float32Array(n);
  const VOWELS = [[700, 1220, 2600], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240], [640, 1190, 2390]];
  for (let v = 0; v < 7; v++) {
    const base = 95 + r() * 140, level = 0.55 + 0.45 * r();
    let t = r() * sr * 0.6;
    while (t < n) {
      const len = sinceSec(sr, 0.1 + 0.2 * r());
      const f0a = base * (0.9 + 0.2 * r()), f0b = f0a * (0.88 + 0.24 * r());
      const src = new Float32Array(len);
      let ph = 0;
      for (let i = 0; i < len; i++) { ph += (f0a + (f0b - f0a) * i / len) / sr; ph -= Math.floor(ph); src[i] = (ph < 0.5 ? ph : 1 - ph) * 4 - 1; }      // a triangle pulse: gentle harmonics
      const fm = VOWELS[Math.floor(r() * VOWELS.length)], syl = new Float32Array(len);
      for (let k = 0; k < 3; k++) { const band = biquad(src, 'bandpass', fm[k] * (0.94 + 0.12 * r()), 6, sr); const amp = [1, 0.5, 0.2][k]; for (let i = 0; i < len; i++) syl[i] += band[i] * amp; }
      for (let i = 0; i < len; i++) syl[i] *= Math.pow(Math.sin(Math.PI * i / len), 1.3) * level;
      addWrapped(x, syl, Math.floor(t), 1);
      t += len + sr * (r() < 0.22 ? 0.35 + 0.8 * r() : 0.01 + 0.07 * r());
    }
  }
  return scaleRms(x, 0.2);
}

/** The avalanche roar: brown noise with slow swells and rolling boulders (low thumps), ~9 s so the loop does not show. */
export function rumbleLoop(sr = RATE.lo, seconds = 9, seed = 20) {
  const r = rngOf(seed), n = sinceSec(sr, seconds), F = sinceSec(sr, 0.3), m = n + F;
  const w = noise(m, r), x = new Float32Array(m);
  let b = 0;
  for (let i = 0; i < m; i++) { b = 0.985 * b + w[i] * 0.17; x[i] = b; }
  const sw = smoothNoise(m, sr, 0.35, r);
  for (let i = 0; i < m; i++) x[i] *= 0.75 + 0.35 * sw[i];
  const len = sinceSec(sr, 0.4);
  for (let t = 0; t < m; t += sr * (0.18 + 0.4 * r())) {
    const th = noise(len, r), a = Math.pow(r(), 2) * 1.4 + 0.15;
    for (let i = 0; i < len; i++) th[i] *= Math.exp(-i / (sr * 0.09));
    addAt(x, biquad(th, 'lowpass', 70 + 90 * r(), 1.3, sr), Math.floor(t), a * 9);
  }
  return scaleRms(loopify(biquad(x, 'lowpass', 420, 0.5, sr), n, F), 0.2);
}

/* ---------------- one-shots ---------------- */
/** Landing: a snow thump (a sine dropping 130 -> 40 Hz), the body of snow whumping, a bit of crunching grains. heavy = a hard landing. */
export function landShot(heavy, sr = RATE.hi, seed = 31) {
  const r = rngOf(seed + (heavy ? 5 : 0)), dur = heavy ? 0.8 : 0.5, n = sinceSec(sr, dur), x = new Float32Array(n);
  const body = biquad(noise(n, r), 'lowpass', heavy ? 520 : 700, 0.8, sr), crunch = biquad(noise(n, r), 'highpass', 1800, 0.7, sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, f = 40 + (heavy ? 95 : 80) * Math.exp(-t * 14);
    ph += f / sr;
    const grain = r() < 0.12 ? 1 : 0.25;
    x[i] = Math.sin(TAU * ph) * Math.exp(-t * (heavy ? 6.5 : 11)) * 0.7 + body[i] * Math.exp(-t * (heavy ? 7 : 12)) * 0.9
      + crunch[i] * grain * Math.exp(-t * 10) * (heavy ? 0.5 : 0.28) * (1 - Math.exp(-t * 90));
  }
  return x;
}

/** One chair grip rolling over the sheave train: a clatter of 4 - 6 impacts, each a burst ringing metal modes (780 / 1630 / 2790 Hz). */
export function clackShot(variant = 0, sr = RATE.hi) {
  const r = rngOf(40 + variant * 7), n = sinceSec(sr, 0.7), x = new Float32Array(n);
  const hits = 4 + variant, modes = [[780, 1], [1630, 0.6], [2790, 0.35]];
  let at = 0.01;
  for (let k = 0; k < hits; k++) {
    const len = sinceSec(sr, 0.12), a = (0.55 + 0.45 * r()) * (k === hits - 1 ? 0.8 : 1);
    const burst = noise(len, r);
    for (let i = 0; i < len; i++) burst[i] *= Math.exp(-i / (sr * 0.0015));
    for (const [f, g] of modes) {
      const ring = biquad(burst, 'bandpass', f * (0.96 + 0.08 * r()), 22, sr);
      const dec = 0.045 / (1 + f / 2500);
      for (let i = 0; i < len; i++) ring[i] *= Math.exp(-i / (sr * dec));
      addAt(x, ring, Math.floor(at * sr), g * a * 5);
    }
    const th = new Float32Array(sinceSec(sr, 0.05));
    for (let i = 0; i < th.length; i++) th[i] = Math.sin(TAU * 150 * i / sr) * Math.exp(-i / (sr * 0.012));
    addAt(x, th, Math.floor(at * sr), a * 0.35);
    at += 0.07 + 0.05 * r() - k * 0.004;
  }
  return x;
}

/** The gondola door: a pneumatic slide (a sweeping hiss), then the latch: a low clunk and a metal click. 1.2 s. */
export function doorShot(sr = RATE.hi, seed = 50) {
  const r = rngOf(seed), n = sinceSec(sr, 1.2), x = new Float32Array(n);
  const slide = sinceSec(sr, 0.55);
  const hi = biquad(noise(slide, r), 'bandpass', 950, 1.1, sr), lo = biquad(noise(slide, r), 'bandpass', 340, 1.1, sr), air = biquad(noise(slide, r), 'bandpass', 2400, 0.9, sr);
  for (let i = 0; i < slide; i++) {
    const u = i / slide, env = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 1.4);
    x[i] = (hi[i] * (1 - u) + lo[i] * u) * 3.4 * env + air[i] * 0.35 * Math.pow(Math.sin(Math.PI * u), 2);        // the door glides: bright -> dull
  }
  const at = sinceSec(sr, 0.6), len = n - at;
  const click = biquad(noise(len, r), 'bandpass', 1900, 14, sr);
  for (let i = 0; i < len; i++) { const t = i / sr; x[at + i] += Math.sin(TAU * 105 * t) * Math.exp(-t * 22) * 0.9 + click[i] * Math.exp(-t * 60) * 5; }
  return x;
}

/* ---------------- birds ---------------- */
function chirp(sr, f0, f1, dur, { vib = 0, vibHz = 30, harm = 0.18, amp = 1 } = {}) {
  const n = sinceSec(sr, dur), y = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n, f = f0 * Math.pow(f1 / f0, u) * (1 + vib * Math.sin(TAU * vibHz * i / sr));
    ph += f / sr;
    const e = Math.pow(Math.sin(Math.PI * u), 0.8);
    y[i] = (Math.sin(TAU * ph) + harm * Math.sin(TAU * 2 * ph)) * e * amp;
  }
  return y;
}

/** Bird phrases: id -> Float32Array. finch trill, great-tit "tea-cher", robin warble, thrush phrase, a peep, the alpine chough. */
export function birdPhrases(sr = RATE.hi) {
  const out = {};
  let r = rngOf(60);
  { // finch: a falling trill that speeds up, ending in a flourish
    const x = new Float32Array(sinceSec(sr, 1.3));
    let t = 0.02;
    for (let k = 0; k < 11; k++) { addAt(x, chirp(sr, 5600 - k * 130, 3900 - k * 90, 0.045, { harm: 0.1 }), Math.floor(t * sr), 0.8); t += 0.115 - k * 0.006; }
    addAt(x, chirp(sr, 3000, 6200, 0.1), Math.floor(t * sr), 0.9); addAt(x, chirp(sr, 5200, 3500, 0.12), Math.floor((t + 0.11) * sr), 0.8);
    out.finch = x;
  }
  { // great tit: "tea-cher" x3
    const x = new Float32Array(sinceSec(sr, 1.2));
    for (let k = 0; k < 3; k++) { const t = 0.03 + k * 0.36; addAt(x, chirp(sr, 4300, 3500, 0.13, { harm: 0.3 }), Math.floor(t * sr), 1); addAt(x, chirp(sr, 3000, 3100, 0.1, { harm: 0.3 }), Math.floor((t + 0.15) * sr), 0.85); }
    out.tit = x;
  }
  { // robin: a random warble of liquid notes
    const x = new Float32Array(sinceSec(sr, 1.7));
    let t = 0.03;
    r = rngOf(61);
    for (let k = 0; k < 9; k++) { const d = 0.06 + 0.12 * r(), f0 = 2800 + 3200 * r(); addAt(x, chirp(sr, f0, f0 * (0.65 + 0.8 * r()), d, { vib: 0.02, vibHz: 28 + 20 * r() }), Math.floor(t * sr), 0.7 + 0.3 * r()); t += d + 0.04 + 0.1 * r(); }
    out.robin = x;
  }
  { // thrush at dusk: a slow melodious phrase, repeated once
    const x = new Float32Array(sinceSec(sr, 2.2));
    for (let rep = 0; rep < 2; rep++) {
      let t = 0.05 + rep * 1.05;
      for (const [f0, f1, d] of [[2300, 3100, 0.2], [3300, 2500, 0.16], [2700, 3600, 0.12], [3600, 3500, 0.09], [2400, 2000, 0.22]]) { addAt(x, chirp(sr, f0, f1, d, { harm: 0.25, vib: 0.01, vibHz: 18 }), Math.floor(t * sr), 0.85); t += d + 0.05; }
    }
    out.thrush = x;
  }
  { // a single high peep
    out.peep = chirp(sr, 7300, 6100, 0.09, { harm: 0.05 });
  }
  { // alpine chough: a harsh "kyaa", a sawtooth ringing through noise, falling
    const n = sinceSec(sr, 0.4), x = new Float32Array(n), nz = rngOf(62);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n, f = 1500 - 520 * u + 140 * Math.sin(TAU * 11 * u);
      ph += f / sr; ph -= Math.floor(ph);
      x[i] = ((ph * 2 - 1) * 0.6 + (nz() * 2 - 1) * 0.25) * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.3)), 1.2) * (1 - 0.5 * u);
    }
    out.chough = biquad(x, 'lowpass', 4200, 0.7, sr);
    for (let i = 0; i < n; i++) out.chough[i] *= 1.4;
  }
  return out;
}

/** Everything the loops need, by name: { sr, data }. Built lazily: bank.get('wind') makes it the first time. */
const MAKERS = {
  carve: () => ({ sr: RATE.hi, data: carveLoop() }),
  powder: () => ({ sr: RATE.lo, data: powderLoop() }),
  scrape: () => ({ sr: RATE.hi, data: scrapeLoop() }),
  glide: () => ({ sr: RATE.hi, data: glideLoop() }),
  wind: () => ({ sr: RATE.lo, data: windLoop() }),
  air: () => ({ sr: RATE.lo, data: airLoop() }),
  hum: () => ({ sr: RATE.lo, data: humLoop() }),
  machine: () => ({ sr: RATE.lo, data: machineLoop() }),
  crowd: () => ({ sr: RATE.lo, data: crowdLoop() }),
  rumble: () => ({ sr: RATE.lo, data: rumbleLoop() }),
  landLight: () => ({ sr: RATE.hi, data: landShot(false) }),
  landHeavy: () => ({ sr: RATE.hi, data: landShot(true) }),
  clack0: () => ({ sr: RATE.hi, data: clackShot(0) }),
  clack1: () => ({ sr: RATE.hi, data: clackShot(1) }),
  clack2: () => ({ sr: RATE.hi, data: clackShot(2) }),
  door: () => ({ sr: RATE.hi, data: doorShot() }),
};
export const BANK_NAMES = Object.freeze(Object.keys(MAKERS));
export const BIRD_NAMES = Object.freeze(['finch', 'tit', 'robin', 'thrush', 'peep', 'chough']);
export function createBank() {
  const cache = new Map();
  let birds = null;
  return {
    names: BANK_NAMES,
    get(name) { let b = cache.get(name); if (!b) { b = MAKERS[name](); cache.set(name, b); } return b; },
    birds() { if (!birds) birds = birdPhrases(); return birds; },
  };
}
