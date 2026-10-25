// Ghost of the best run, stored as a compact string (pure module, no DOM, no THREE).
//
// The game records samples { t (ms since the start gate), s (m along the trail centre line), o (lateral offset m,
// + = right of travel) } at its own pace. This module resamples them to a fixed interval and packs them into
//   'g1.<dtMs/100 base36>.<duration ms base36>.<body>'
// where every sample is 3 base-36 characters: 2 for the s-delta to the previous sample in units of 0.25 m
// (0..1295) and 1 for the lateral offset in units of 0.5 m + 14 (0..28, so the full +-7 m fits). A 400 s run is
// about 1.5 kB, a 35 minute marathon about 1.7 kB (the interval grows, the sample count stays near 560).

export const GHOST_PREFIX = 'g1';
export const DEFAULT_MAX_SAMPLES = 560;
export const MIN_INTERVAL_MS = 500;
export const MAX_INTERVAL_MS = 6000;
export const MIN_DURATION_MS = 5000;
export const MAX_DURATION_MS = 4 * 60 * 60 * 1000;
export const S_UNIT = 0.25;               // metres per s-delta unit
export const S_DELTA_MAX = 36 * 36 - 1;   // 1295 units = 323.75 m per sample
export const O_UNIT = 0.5;                // metres per lateral unit
export const O_LIMIT = 7;                 // lateral clamp, metres
export const O_BIAS = 14;                 // O_LIMIT / O_UNIT, stored value = round(o / O_UNIT) + O_BIAS
export const O_MAX_CODE = 2 * O_BIAS;     // 28
const INTERVAL_STEP_MS = 100;
const CHARS_PER_SAMPLE = 3;
const BASE36_BODY = /^[0-9a-z]+$/;
const BASE36_NUMBER = /^[0-9a-z]{1,8}$/;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** Interval between stored samples: about maxSamples samples in total, in steps of 100 ms, 0.5 s .. 6 s. */
export function ghostInterval(durationMs, maxSamples = DEFAULT_MAX_SAMPLES) {
  const samples = Math.max(1, Math.floor(maxSamples));
  return clamp(Math.ceil(durationMs / samples / INTERVAL_STEP_MS) * INTERVAL_STEP_MS, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
}

/** Number of stored samples for a duration and interval: 0, dt, 2 dt ... and exactly the finish. */
const sampleCount = (durationMs, dtMs) => Math.ceil(durationMs / dtMs) + 1;
const sampleTime = (index, durationMs, dtMs) => Math.min(index * dtMs, durationMs);

/** Clean copy of recorded samples: finite numbers only, sorted by time, s made monotone, o clamped. */
function cleanSamples(samples) {
  if (!Array.isArray(samples)) return [];
  const rows = [];
  for (const sample of samples) {
    if (!sample || !isFiniteNumber(sample.t) || !isFiniteNumber(sample.s) || !isFiniteNumber(sample.o)) continue;
    rows.push({ t: sample.t, s: Math.max(0, sample.s), o: clamp(sample.o, -O_LIMIT, O_LIMIT) });
  }
  rows.sort((a, b) => a.t - b.t);
  let runningS = 0;
  return rows.map((row) => {
    runningS = Math.max(runningS, row.s);
    return { t: row.t, s: runningS, o: row.o };
  });
}

/** Linear resampling of the cleaned rows (relative to the first row's time) at the given times. */
function resample(rows, count, durationMs, dtMs) {
  const start = rows[0].t;
  const s = new Array(count), o = new Array(count);
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const t = start + sampleTime(i, durationMs, dtMs);
    while (cursor < rows.length - 2 && rows[cursor + 1].t < t) cursor++;
    const a = rows[cursor], b = rows[cursor + 1];
    const span = b.t - a.t;
    const k = span > 0 ? clamp((t - a.t) / span, 0, 1) : 1;
    s[i] = a.s + (b.s - a.s) * k;
    o[i] = a.o + (b.o - a.o) * k;
  }
  return { s, o };
}

/**
 * Pack recorded samples into the ghost string, or null when they cannot form a ghost (fewer than 2 usable samples,
 * a duration outside 5 s .. 4 h). The s quantisation uses error feedback, so the decoded s never drifts more than
 * half a unit (0.125 m) from the input.
 */
export function encodeGhost(samples, { maxSamples = DEFAULT_MAX_SAMPLES } = {}) {
  const rows = cleanSamples(samples);
  if (rows.length < 2) { console.warn('[mtb] ghost needs at least 2 samples'); return null; }
  const durationMs = Math.round(rows[rows.length - 1].t - rows[0].t);
  if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    console.warn('[mtb] ghost duration out of range', durationMs);
    return null;
  }
  const dtMs = ghostInterval(durationMs, maxSamples);
  const count = sampleCount(durationMs, dtMs);
  const { s, o } = resample(rows, count, durationMs, dtMs);
  let body = '', decodedS = 0;
  for (let i = 0; i < count; i++) {
    const delta = clamp(Math.round((s[i] - decodedS) / S_UNIT), 0, S_DELTA_MAX);
    decodedS += delta * S_UNIT;
    const lateral = clamp(Math.round(o[i] / O_UNIT) + O_BIAS, 0, O_MAX_CODE);
    body += delta.toString(36).padStart(2, '0') + lateral.toString(36);
  }
  return [GHOST_PREFIX, (dtMs / INTERVAL_STEP_MS).toString(36), durationMs.toString(36), body].join('.');
}

/** Same as encodeGhost; the name the game uses when it finishes recording. */
export const recordGhost = (samples, options) => encodeGhost(samples, options);

/** Parse a ghost string into { dt, duration, s: Float32Array, o: Float32Array }, or null. Never throws. */
export function decodeGhost(text) {
  if (typeof text !== 'string' || text.length > 40000) return null;
  const parts = text.split('.');
  if (parts.length !== 4 || parts[0] !== GHOST_PREFIX) return null;
  const [, dtText, durationText, body] = parts;
  if (!BASE36_NUMBER.test(dtText) || !BASE36_NUMBER.test(durationText)) return null;
  const dt = parseInt(dtText, 36) * INTERVAL_STEP_MS;
  const duration = parseInt(durationText, 36);
  if (!(dt >= MIN_INTERVAL_MS && dt <= MAX_INTERVAL_MS)) return null;
  if (!(duration >= MIN_DURATION_MS && duration <= MAX_DURATION_MS)) return null;
  const count = sampleCount(duration, dt);
  if (!BASE36_BODY.test(body) || body.length !== count * CHARS_PER_SAMPLE) return null;
  const s = new Float32Array(count), o = new Float32Array(count);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const at = i * CHARS_PER_SAMPLE;
    total += parseInt(body.slice(at, at + 2), 36) * S_UNIT;
    s[i] = total;
    o[i] = (parseInt(body[at + 2], 36) - O_BIAS) * O_UNIT;
  }
  return { dt, duration, s, o };
}

/**
 * Position of the ghost at time tMs: { s, o, speed }. s uses a monotone cubic Hermite spline with Catmull-Rom
 * tangents (finite differences over the neighbours, limited so each interval stays monotone: s never decreases),
 * o is linear. Before 0 the first sample is returned, after the end the last one (speed 0).
 */
export function ghostAt(ghost, tMs) {
  const { dt, duration, s, o } = ghost;
  const last = s.length - 1;
  if (!(tMs > 0)) return { s: s[0], o: o[0], speed: 0 };
  if (tMs >= duration) return { s: s[last], o: o[last], speed: 0 };
  const i = Math.min(last - 1, Math.floor(tMs / dt));
  const t0 = i * dt, t1 = sampleTime(i + 1, duration, dt);
  const h = (t1 - t0) / 1000;
  const u = (tMs - t0) / (t1 - t0);
  const slope = (a, b) => (s[b] - s[a]) / ((sampleTime(b, duration, dt) - sampleTime(a, duration, dt)) / 1000);
  const own = slope(i, i + 1);
  const tangent = (index) => {
    const before = index > 0 ? slope(index - 1, index) : own;
    const after = index < last ? slope(index, index + 1) : own;
    if (before <= 0 || after <= 0) return 0;                          // a stop: flat tangent keeps monotony
    const central = index > 0 && index < last ? slope(index - 1, index + 1) : (index === 0 ? after : before);
    return Math.min(central, 3 * before, 3 * after);
  };
  const m0 = tangent(i) * h, m1 = tangent(i + 1) * h;
  const slopeO = (a, b) => (o[b] - o[a]) / ((sampleTime(b, duration, dt) - sampleTime(a, duration, dt)) / 1000);
  const tangentO = (index) => slopeO(Math.max(0, index - 1), Math.min(last, index + 1));
  const hermiteO = (index, k, span) => {
    const k2 = k * k, k3 = k2 * k;
    return (2 * k3 - 3 * k2 + 1) * o[index] + (k3 - 2 * k2 + k) * tangentO(index) * span
      + (-2 * k3 + 3 * k2) * o[index + 1] + (k3 - k2) * tangentO(index + 1) * span;
  };
  const u2 = u * u, u3 = u2 * u;
  const value = (2 * u3 - 3 * u2 + 1) * s[i] + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * s[i + 1] + (u3 - u2) * m1;
  const derivative = ((6 * u2 - 6 * u) * s[i] + (3 * u2 - 4 * u + 1) * m0 + (-6 * u2 + 6 * u) * s[i + 1] + (3 * u2 - 2 * u) * m1) / h;
  return {
    s: clamp(value, s[i], s[i + 1]),
    o: clamp(hermiteO(i, u, h), -O_LIMIT, O_LIMIT),
    speed: Math.max(0, derivative),
  };
}
