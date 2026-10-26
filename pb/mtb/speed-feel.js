/* Speed feel, the pure part (speed pass, 26 Oct 2026): how strongly the screen streaks, which tier the speedometer is in and what the tyres kick up.
 * No THREE and no DOM in here: harness-play.js checks the numbers, speed-fx.js draws them. */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const SPEED_FEEL = Object.freeze({
  linesFrom: 8,                        // m/s (29 km/h): the first streaks at the screen edge
  linesFull: 16,                       // m/s (58 km/h): full strength
  tiers: Object.freeze([20, 35, 50, 62]),   // km/h: the speedometer changes colour and pulses at each
  gaugeMaxKmh: 70,                     // the bar under the number is full at this speed
  dustMinSpeed: 3,                     // m/s: slower than this the tyres kick up nothing
  dustFullSpeed: 14,                   // m/s: the emission rate reaches its "full" value
  burstImpact: 3.5,                    // m/s of landing impact from which a landing throws a puff
});

/** 0..1: how many speed lines to draw at this speed (m/s). Zero below linesFrom so a walk or a climb is calm. */
export const speedLineStrength = (speedMs) => smoothstep(SPEED_FEEL.linesFrom, SPEED_FEEL.linesFull, speedMs);

/** 0..4: the speedometer tier of a speed in km/h (0 calm, 4 top speed). */
export const speedTier = (kmh) => SPEED_FEEL.tiers.reduce((n, limit) => (kmh >= limit ? n + 1 : n), 0);

/** 0..1: the fill of the gauge under the speed number. */
export const gaugeFill = (kmh) => clamp(kmh / SPEED_FEEL.gaugeMaxKmh, 0, 1);

/* What each ground kicks up behind the rear wheel. rate = particles per second at dustFullSpeed on dry ground; colour = rgb 0..1; size = start radius (m);
 * life = seconds; lift = initial upward speed (m/s); wet = how much rain takes the dust away (1 = none left in full rain; mud and water do not care). */
export const DUST = Object.freeze({
  dirt: { rate: 26, color: [0.64, 0.53, 0.38], size: 0.43, life: 0.95, lift: 0.9, wet: 0.85 },
  track: { rate: 34, color: [0.72, 0.67, 0.58], size: 0.52, life: 1.1, lift: 1.0, wet: 0.85 },
  road: { rate: 12, color: [0.66, 0.65, 0.62], size: 0.38, life: 0.7, lift: 0.7, wet: 0.9 },
  rock: { rate: 14, color: [0.74, 0.72, 0.68], size: 0.35, life: 0.7, lift: 0.8, wet: 0.9 },
  roots: { rate: 12, color: [0.42, 0.33, 0.23], size: 0.35, life: 0.7, lift: 1.2, wet: 0.7 },
  mud: { rate: 22, color: [0.27, 0.2, 0.14], size: 0.29, life: 0.8, lift: 2.0, wet: 0 },
  leaves: { rate: 24, color: [0.8, 0.46, 0.14], size: 0.29, life: 1.3, lift: 2.2, wet: 0.4 },
  grass: { rate: 7, color: [0.46, 0.55, 0.3], size: 0.29, life: 0.7, lift: 0.9, wet: 0.3 },
  forest: { rate: 12, color: [0.4, 0.33, 0.23], size: 0.35, life: 0.8, lift: 1.0, wet: 0.6 },
  water: { rate: 40, color: [0.86, 0.93, 0.96], size: 0.38, life: 0.8, lift: 2.6, wet: 0 },
  wood: { rate: 0, color: [0.5, 0.4, 0.3], size: 0.29, life: 0.5, lift: 0.5, wet: 0 },
});

/** Particles per second for a frame: ground kind, speed (m/s), rain wetness 0..1, skid 0..1 (a sliding rear wheel digs in). Zero in the air. */
export function dustRate(kind, speedMs, wet = 0, skid = 0, grounded = true) {
  const p = DUST[kind] || DUST.dirt;
  if (!grounded || speedMs < SPEED_FEEL.dustMinSpeed) return 0;
  const speedK = smoothstep(SPEED_FEEL.dustMinSpeed, SPEED_FEEL.dustFullSpeed, speedMs) * (1 + 0.5 * smoothstep(SPEED_FEEL.dustFullSpeed, 22, speedMs));
  return p.rate * speedK * (1 - clamp(wet, 0, 1) * p.wet) * (1 + 1.5 * clamp(skid, 0, 1));
}
