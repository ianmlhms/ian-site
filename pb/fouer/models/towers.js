/* Schueberfouer Tycoon, W4a: the four tall rides.  DESIGN 3.3.
 *   jules     Tuerm-Schaukel / tower swing   ~80 m lattice mast, rotating crown that rises, 24 swing seats on wires flying out   (pitch M, 16 x 16)
 *   hangover  Fallturm / drop tower          ~85 m slender mast with three yellow blocks, a saucer seat ring that rises and drops   (pitch M)
 *   booster   Booster                        ~55 m magenta tower, long cream arm with oval windows and a yellow rider pod   (pitch L, 30 x 18)
 *   infinity  Pendelarm / giant pendulum     two magenta A-towers (~26 m), a 21 m arm swinging +-100 deg with a spinning seat ring   (pitch M)
 *
 * No real ride, brand or showman names anywhere (DESIGN 11.2): signs are plain lit panels, bulb frames and wings.
 * Every model: MODELS[id].build({ look, level, quality, seed }) -> THREE.Group, origin on the pitch centre, +z = front, ground footprint inside the pitch
 * (the arms / seats / crown swing out over the neighbours, only high above the ground).  userData: animate(t, dt, nightK), setNight, setLOD(0|1),
 * setAnimated(bool), footprint, height, cycle (period in s), phaseAt(t) for tests.  Cycles are pure functions of t (boarding -> action -> unload),
 * so every model returns to its rest pose at t = k * period. */
import { makeKit, finishModel, rng, clamp, lerp, smooth, bulb, flag, sheep, glassWin, latticeMast } from './big-kit.js';

const GOLD = 0xf0c24a;
const STEEL = 0xb9bec2;
const DARK = 0x3a3f44;
const WOOD = 0xb89463;
const PAD = 0x9b958a;
const TAU = Math.PI * 2;
const hz = (f, tt, p) => ((tt % p) + p) % p;

/* ------------------------------------------------------------------------------------------------ palettes (3 looks per ride) */
const PAL = {
  jules: [
    { chord: 0x2d7a49, chordTop: 0x3f8a55, brace: 0xdcb34a, top: 0xdfe5db, drum: 0x244f34, trim: 0xe0b040, arm: 0x2d7a49, armB: 0xe9e4d0, wire: 0xe4e8ea, seat: 0x2b2e33, seatLed: [1, 0.9, 0.6], parch: 0xdcbf80, parchEdge: 0xb08d4a, screen: [0.3, 0.55, 0.7], booth: 0xf0e6cc, brick: 0x9a4a35, roof: 0xe9e1c8, deck: 0xb89463, bulb: [1, 0.85, 0.5], led: [[1, 0.72, 0.15], [0.25, 1, 0.65]], sign: [1, 0.78, 0.3], flag: 0xf2f2ea },
    { chord: 0x3a2a8c, brace: 0x35e6ff, top: 0xe6e0ff, drum: 0x1f1560, trim: 0x35e6ff, arm: 0x3a2a8c, armB: 0xe6e0ff, wire: 0xd8d0ff, seat: 0x241a52, seatLed: [0.2, 0.95, 1], parch: 0x4a3a9a, parchEdge: 0x2a1a66, screen: [0.1, 0.9, 1], booth: 0x2a1a66, brick: 0xc7168e, roof: 0x35207a, deck: 0x5a4b9a, bulb: [0.4, 0.9, 1], led: [[0.1, 0.9, 1], [1, 0.1, 0.8]], sign: [0.15, 0.9, 1], flag: 0xd8d0ff },
    { chord: 0x2f64b8, brace: 0xf4f4f0, top: 0xf4f4f0, drum: 0x244b88, trim: 0xcfe0f6, arm: 0x2f64b8, armB: 0xf4f4f0, wire: 0xe8edf2, seat: 0x2b3a58, seatLed: [1, 0.85, 0.5], parch: 0xeae6d8, parchEdge: 0x2f64b8, screen: [1, 0.84, 0.5], booth: 0xf2f0e6, brick: 0x2f64b8, roof: 0x2f64b8, deck: 0xc9b893, bulb: [1, 0.85, 0.5], led: [[1, 0.82, 0.5], [0.75, 0.88, 1]], sign: [1, 0.84, 0.5], flag: 0x2f64b8 },
  ],
  hangover: [
    { chord: 0xf2f2ee, brace: 0xf2f2ee, yellow: 0xf2c80c, ring: 0x7a1a2a, ringB: 0xe0b040, saucer: 0xe9a02a, gate: 0x7a2fb0, wall: 0x6a2a8a, booth: 0xf0e6cc, roof: 0x7a2fb0, deck: 0x8a8f92, bulb: [1, 0.8, 0.45], led: [[1.5, 0.15, 0.7], [0.3, 1.5, 0.6], [1.5, 1.3, 0.3], [0.5, 0.9, 1.5]], sign: [1, 0.45, 0.8], skyline: [0xe8479a, 0x4ad0e8, 0xf2c80c, 0x2a1a50] },
    { chord: 0x2a2150, brace: 0x3d2f80, yellow: 0xc7168e, ring: 0x3a2a8c, ringB: 0x35e6ff, saucer: 0x35e6ff, gate: 0xc7168e, wall: 0x1f1560, booth: 0x2a1a66, roof: 0xc7168e, deck: 0x5a4b9a, bulb: [0.4, 0.9, 1], led: [[0.15, 1.3, 1.5], [1.5, 0.15, 1.2], [0.9, 0.5, 1.5], [1.4, 1.4, 1.4]], sign: [0.15, 0.9, 1], skyline: [0x35e6ff, 0xc7168e, 0x6a3ad0, 0x1a1040] },
    { chord: 0xf4f4f0, brace: 0xf4f4f0, yellow: 0x2f64b8, ring: 0x2f64b8, ringB: 0xcfe0f6, saucer: 0xf4f4f0, gate: 0x2f64b8, wall: 0x2f64b8, booth: 0xf2f0e6, roof: 0x2f64b8, deck: 0xc9b893, bulb: [1, 0.85, 0.5], led: [[1, 0.85, 0.5], [0.75, 0.88, 1], [1, 1, 0.9], [0.5, 0.7, 1]], sign: [1, 0.84, 0.5], skyline: [0xf4f4f0, 0xcfe0f6, 0x7aa6e0, 0x1f3f78] },
  ],
  booster: [
    { tower: 0xc8147e, towerMid: 0xe8408f, towerTop: 0xf2c80c, arm: 0xf3ead2, armEdge: 0xe8d9b0, oval: 0x2b3350, pod: 0xf2c80c, podB: 0x1f2226, hazard: [0xf2c80c, 0x1f2226], led: [[1, 0.8, 0.2], [1, 0.25, 0.7]], wall: [0xe8479a, 0x4ad0e8, 0xf2c80c, 0x7a2fb0], deck: 0x77797c, booth: 0x2fa863, roof: 0xf2c80c, bulb: [1, 0.85, 0.5], sign: [1, 0.35, 0.75], flag: 0xf2c80c },
    { tower: 0x3a2a8c, towerMid: 0x6a3ad0, towerTop: 0x35e6ff, arm: 0xe6e0ff, armEdge: 0xc2b6f0, oval: 0x1f1560, pod: 0x35e6ff, podB: 0x1f1560, hazard: [0x35e6ff, 0x1f1560], led: [[0.1, 0.9, 1], [1, 0.1, 0.8]], wall: [0x35e6ff, 0xc7168e, 0x6a3ad0, 0x1a1040], deck: 0x4c4a66, booth: 0xc7168e, roof: 0x35e6ff, bulb: [0.4, 0.9, 1], sign: [0.15, 0.9, 1], flag: 0x35e6ff },
    { tower: 0x2f64b8, towerMid: 0x6a9ae0, towerTop: 0xf4f4f0, arm: 0xf4f4f0, armEdge: 0xcfe0f6, oval: 0x1f3f78, pod: 0x2f64b8, podB: 0xf4f4f0, hazard: [0x2f64b8, 0xf4f4f0], led: [[1, 0.85, 0.5], [0.75, 0.88, 1]], wall: [0xf4f4f0, 0xcfe0f6, 0x7aa6e0, 0x1f3f78], deck: 0x8d9296, booth: 0xf2f0e6, roof: 0x2f64b8, bulb: [1, 0.85, 0.5], sign: [1, 0.84, 0.5], flag: 0x2f64b8 },
  ],
  infinity: [
    { leg: 0xc8147e, brace: 0x9a1060, led: [1, 0.85, 0.1], arm: 0xdce8f2, armB: 0x7ec8f0, armLed: [0.3, 0.7, 1], ring: 0xf2c80c, ringB: 0xc8147e, seat: 0x2b2e33, seatB: 0xf2f2ea, wing: 0xe6d28a, sign: [1, 0.8, 0.3], pylon: 0x8fd0f0, booth: 0xf0e6cc, roof: 0xc8147e, deck: 0x8a8f92, bulb: [1, 0.85, 0.5], flag: 0xf2c80c },
    { leg: 0x3a2a8c, brace: 0x26186a, led: [0.1, 0.95, 1], arm: 0xe6e0ff, armB: 0x6a3ad0, armLed: [1, 0.1, 0.8], ring: 0x35e6ff, ringB: 0x6a3ad0, seat: 0x1f1560, seatB: 0xe6e0ff, wing: 0x35e6ff, sign: [0.15, 0.9, 1], pylon: 0x6a3ad0, booth: 0x2a1a66, roof: 0xc7168e, deck: 0x5a4b9a, bulb: [0.4, 0.9, 1], flag: 0x35e6ff },
    { leg: 0x2f64b8, brace: 0x244b88, led: [1, 0.85, 0.5], arm: 0xf4f4f0, armB: 0x2f64b8, armLed: [1, 0.85, 0.5], ring: 0xf4f4f0, ringB: 0x2f64b8, seat: 0x2b3a58, seatB: 0xf4f4f0, wing: 0xcfe0f6, sign: [1, 0.84, 0.5], pylon: 0xcfe0f6, booth: 0xf2f0e6, roof: 0x2f64b8, deck: 0xc9b893, bulb: [1, 0.85, 0.5], flag: 0x2f64b8 },
  ],
};

/* ------------------------------------------------------------------------------------------------ shared station pieces */
const ang = (i, n) => (i / n) * TAU;

function setup(opts, id) {
  const T = window.THREE; const K = makeKit(T);
  const look = clamp(opts.look | 0, 0, 2); const level = clamp(opts.level | 0 || 1, 1, 4); const quality = opts.quality || 'medium';
  return { T, K, look, level, quality, pal: PAL[id][look], gold: level >= 4, high: quality === 'high', wantNear: quality !== 'low', R: rng((opts.seed || 1) * 7 + id.length) };
}

function railing(b, pts, y, color, o = {}) {
  const P = b.P; const h = o.h || 1.05; const step = o.step || 1.8; const close = o.close;
  const n = pts.length; const last = close ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p = pts[i]; const q = pts[(i + 1) % n];
    P.tube([p[0], y + h, p[1]], [q[0], y + h, q[1]], 0.04, color, { sides: 4, flat: true });
    if (o.mid !== false) P.tube([p[0], y + h * 0.5, p[1]], [q[0], y + h * 0.5, q[1]], 0.03, color, { sides: 3, flat: true });
    const m = Math.max(1, Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) / step));
    for (let k = 0; k < m + (i === last - 1 && !close ? 1 : 0); k++) { const f = k / m; const x = lerp(p[0], q[0], f); const z = lerp(p[1], q[1], f); P.tube([x, y, z], [x, y + h, z], 0.03, color, { sides: 3, flat: true }); }
  }
}

/** small ticket booth, window toward +z of its own frame */
function booth(b, x, z, ry, pal, level, near, big) {
  const P = b.P; const L = b.L; const gold = level >= 4;
  b.place([x, 0.3, z], ry);
  P.box(0, 1.25, 0, 2.5, 2.5, 2.2, pal.booth, 32 | 16); P.box(0, 2.6, 0, 3.0, 0.2, 2.7, pal.roof, 32);
  P.box(0, 2.95, 0, 2.0, 0.5, 1.7, pal.roof, 32);
  glassWin(b, [-0.8, 1.2, 1.11], [0.8, 1.2, 1.11], 0.8);
  P.box(0, 0.86, 1.3, 1.9, 0.1, 0.4, gold ? GOLD : pal.trim || GOLD, 0);
  if (near) for (let q = 0; q < 8; q++) bulb(b, [-1.2 + q * 0.34, 2.45, 1.4], 0.18, pal.bulb);
  if (big) { P.box(0, 3.55, 0.6, 2.4, 0.8, 0.12, gold ? GOLD : 0xcfa24a, 0); L.quad([-1.0, 3.25, 0.67], [1.0, 3.25, 0.67], [1.0, 3.85, 0.67], [-1.0, 3.85, 0.67], pal.sign); }
  b.pop();
}
function pad(b, w, d, cz = 0) {
  b.P.box(0, -0.25, cz, w, 1.1, d, PAD, 32);
  const g = b.G([0.5, 0.4, 0.24]); const y = 0.292; const x = (w - 1.0) / 2; const z0 = cz - (d - 1.0) / 2; const z1 = cz + (d - 1.0) / 2;
  g.quad([-x, y, z0], [x, y, z0], [x, y, z1], [-x, y, z1], 0xaaa496);          // paving that the fair's bulbs light at night
}
function festoon(b, p, q, n, drop, col) { for (let i = 1; i < n; i++) { const f = i / n; bulb(b, [lerp(p[0], q[0], f), lerp(p[1], q[1], f) - Math.sin(f * Math.PI) * drop, lerp(p[2], q[2], f)], 0.17, col); } }
function queue(b, x0, x1, zs, pal) {
  const P = b.P;
  zs.forEach((z, r) => {
    const a = r % 2 === 0 ? x0 : x0 + 2.0; const c = r % 2 === 0 ? x1 - 2.0 : x1;
    for (const y of [0.55, 1.0]) P.tube([a, y + 0.3, z], [c, y + 0.3, z], 0.035, pal.trim || GOLD, { sides: 4, flat: true });
    for (let x = a; x <= c + 0.01; x += 1.6) P.tube([x, 0.3, z], [x, 1.38, z], 0.04, DARK, { sides: 4, flat: true });
  });
}
/** a lit gateway: two posts, a lit panel (plain, no lettering), bulb rows; L1 only a plain lintel */
function gateway(b, x, z, w, y, pal, level, near, color) {
  const P = b.P; const L = b.L; const gold = level >= 4; const c = color || pal.chord || pal.gate || 0x888888;
  for (const sx of [-1, 1]) { P.box(x + sx * w / 2, y / 2 + 0.3, z, 0.3, y, 0.3, c, 0); P.sphere([x + sx * w / 2, y + 0.55, z], 0.26, gold ? GOLD : 0xe9d34a, 8, 5); }
  P.box(x, y + 0.2, z, w, 0.2, 0.26, gold ? GOLD : 0xe9d34a, 0);
  if (level >= 2) {
    P.box(x, y + 0.95, z, w - 0.6, 1.1, 0.16, gold ? GOLD : c, 0);
    L.quad([x - w / 2 + 0.5, y + 0.5, z + 0.1], [x + w / 2 - 0.5, y + 0.5, z + 0.1], [x + w / 2 - 0.5, y + 1.4, z + 0.1], [x - w / 2 + 0.5, y + 1.4, z + 0.1], pal.sign);
    P.tri([x - 0.35, y + 0.6, z + 0.12], [x + 0.35, y + 0.6, z + 0.12], [x, y + 1.3, z + 0.12], 0xfff1c8);
    if (near) for (let q = 0; q < Math.floor(w / 0.4); q++) { bulb(b, [x - w / 2 + 0.3 + q * 0.4, y + 1.55, z + 0.1], 0.18, pal.bulb); }
  }
}

/* ------------------------------------------------------------------------------------------------ cycles (pure functions of t) */
export const CYCLES = Object.freeze({ jules: 60, hangover: 38, booster: 56, infinity: 52 });
function julesPhase(t) {
  const tt = hz(0, t, CYCLES.jules); const lo = 7.4; const hi = 62.5;
  let y = lo; let w = 0;
  if (tt >= 10 && tt < 22) y = lerp(lo, hi, smooth((tt - 10) / 12)); else if (tt >= 22 && tt < 42) y = hi; else if (tt >= 42 && tt < 54) y = lerp(hi, lo, smooth((tt - 42) / 12));
  if (tt >= 8 && tt < 18) w = smooth((tt - 8) / 10); else if (tt >= 18 && tt < 40) w = 1; else if (tt >= 40 && tt < 54) w = 1 - smooth((tt - 40) / 14);
  return { y, w, tt };
}
function hangoverPhase(t) {
  const tt = hz(0, t, CYCLES.hangover); const yb = 3.6; const yt = 80; const y1 = 27; const g = 25;
  let y = yb; let mode = 'board'; let v = 0;
  if (tt < 6) { y = yb; } else if (tt < 17) { mode = 'rise'; y = lerp(yb, yt, smooth((tt - 6) / 11)); v = 1; } else if (tt < 19.5) { mode = 'hold'; y = yt; } else {
    const tf = Math.sqrt(2 * (yt - y1) / g); const u = tt - 19.5; mode = 'drop';
    if (u < tf) { y = yt - 0.5 * g * u * u; v = -g * u / 40; } else {
      const vb = g * tf; const tb = 2 * (y1 - yb) / vb; const w = u - tf;
      if (w < tb) { y = y1 - vb * w + 0.5 * (vb / tb) * w * w; v = -(vb - (vb / tb) * w) / 40; } else { const q = w - tb; mode = 'settle'; y = yb + 2.6 * Math.exp(-q * 1.7) * Math.abs(Math.sin(q * 3.6)); v = 0; }
    }
  }
  return { y, mode, v, tt };
}
function boosterPhase(t) {
  const tt = hz(0, t, CYCLES.booster); const turns = 7; let a = 0;
  if (tt >= 8 && tt < 46) a = TAU * turns * smooth((tt - 8) / 38);
  return { a: a % TAU, raw: a, tt };
}
function infinityPhase(t) {
  const tt = hz(0, t, CYCLES.infinity); let amp = 0; let phase = 0;
  if (tt >= 7 && tt < 46) { const u = (tt - 7) / 39; amp = 1.75 * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7; phase = tt - 7; }
  const a = amp * Math.sin(phase * 0.78);
  return { a, amp, tt, spin: (tt >= 7 ? (tt - 7) : 0) * (amp > 0.05 ? 0.9 : 0) };
}

/* ================================================================================================ JULES (tower swing) */
const JU = { mastZ: 0, mastTop: 80, lo: 7.4, hi: 62.5, arms: 12, armR: 6.8, armY: 3.3, wire: 9.2 };

function mastSections(b, pal, near, y0, mastTop) {
  const panel = near ? 2.5 : 4.2;
  const T2 = b.G([0.5, 0.52, 0.5]);
  latticeMast(b, { y0, y1: 26, w0: 4.2, w1: 3.3, panel, chord: 0.4, brace: 0.24, chordCol: pal.chord, braceCol: pal.brace, ties: near, braceBucket: T2 });
  latticeMast(b, { y0: 26, y1: 52, w0: 3.3, w1: 2.8, panel, chord: 0.34, brace: 0.2, chordCol: pal.chord, braceCol: pal.brace, ties: near, braceBucket: T2 });
  latticeMast(b, { y0: 52, y1: mastTop, w0: 2.8, w1: 1.8, panel, chord: 0.3, brace: 0.17, chordCol: pal.chordTop || pal.chord, braceCol: pal.brace, ties: near, braceBucket: T2 });
}

function buildJulesStatic(b, cfg, near) {
  const { pal, level, gold } = cfg; const P = b.P; const L = b.L;
  pad(b, 16, 16);
  // round station deck with a low railing, stairs at the front
  P.cylY(0, 0.28, 0, 7.1, 7.1, 0.3, pal.deck, near ? 24 : 14); P.cylY(0, 0.55, 0, 7.15, 7.15, 0.06, gold ? GOLD : pal.trim, near ? 24 : 14);
  P.cylY(0, 0.3, 0, 1.4, 1.4, 0.7, DARK, 12);
  mastSections(b, pal, near, 0.6, JU.mastTop);
  // painted back wall (steampunk airships in a teal sky), two low wings left and right
  P.box(0, 2.6, -7.7, 14.2, 4.6, 0.25, 0x6fa3a6, 0); P.box(0, 0.7, -7.55, 14.2, 0.9, 0.3, 0x8a5a3a, 0);
  for (const [x, y, sc] of [[-4.2, 3.2, 1.0], [0.8, 4.0, 0.8], [4.6, 2.9, 1.2]]) { P.fan([x, y, -7.55], [1.7 * sc, 0, 0], [0, 0.55 * sc, 0], 0xf0e6c8, 12); P.box(x, y - 0.75 * sc, -7.55, 0.8 * sc, 0.25 * sc, 0.05, 0xb08d4a, 0); if (near) L.fan([x, y, -7.52], [1.0 * sc, 0, 0], [0, 0.28 * sc, 0], pal.bulb, 8); }
  if (near) for (let q = 0; q < 24; q++) bulb(b, [-6.9 + q * 0.6, 4.95, -7.55], 0.2, pal.bulb);
  // top finial + red beacon
  P.tube([0, JU.mastTop, 0], [0, JU.mastTop + 5, 0], 0.45, pal.top, { sides: 6, r1: 0.05 });
  L.sphere([0, JU.mastTop + 5.2, 0], 0.35, [1, 0.1, 0.05], 6, 4);
  // parchment-scroll plaque wrapped round the mast, front side (plain lit screen, no lettering)
  const py = 19.2;
  P.box(0, py, 1.95, 5.4, 8.4, 0.5, pal.parch, 0); P.box(0, py, -1.95, 5.4, 8.4, 0.5, pal.parch, 0);
  for (const sx of [-1, 1]) { P.tube([sx * 2.9, py - 4.2, 1.95], [sx * 2.9, py + 4.2, 1.95], 0.55, pal.parchEdge, { sides: 8 }); P.tube([sx * 2.9, py - 4.2, -1.95], [sx * 2.9, py + 4.2, -1.95], 0.55, pal.parchEdge, { sides: 8 }); }
  P.box(0, py + 4.6, 1.95, 5.8, 0.5, 0.7, gold ? GOLD : pal.trim, 0);
  for (const sz of [-1, 1]) {
    L.quad([-2.0, py - 3.0, sz * 2.22], [2.0, py - 3.0, sz * 2.22], [2.0, py + 3.2, sz * 2.22], [-2.0, py + 3.2, sz * 2.22], pal.screen);
    if (near) for (let q = 0; q < 6; q++) { P.box(0, py - 2.4 + q * 0.95, sz * 2.24, 3.4, 0.3, 0.02, 0x1d2b33, 0); }
    if (near) for (let q = 0; q < 12; q++) bulb(b, [-2.5 + q * 0.45, py + 4.9, sz * 2.2], 0.2, pal.bulb);
  }
  P.fan([-1.7, py - 3.6, 2.3], [0.8, 0, 0], [0, 0.8, 0], gold ? GOLD : 0xc89a3a, 14); L.fan([-1.7, py - 3.6, 2.32], [0.55, 0, 0], [0, 0.55, 0], [1, 0.9, 0.6], 12);
  // booths (steampunk-ish: brick pilasters, hip roof, brass dome, clock) at the front corners
  const steam = (x, z, ry, big) => {
    // a little steampunk ticket house: brick plinth, cream upper floor with a brass porthole, pitched roof with gilt bargeboards, brass dome
    b.place([x, 0.3, z], ry);
    P.box(0, 0.7, 0, 2.9, 1.4, 2.5, pal.brick, 32 | 16); P.box(0, 2.1, 0, 2.8, 1.4, 2.4, pal.booth, 32 | 16);
    glassWin(b, [-0.8, 0.85, 1.26], [0.8, 0.85, 1.26], 0.8); P.box(0, 0.4, 1.4, 2.0, 0.1, 0.4, gold ? GOLD : pal.trim, 0);
    for (const sx of [-1.4, 1.4]) for (const sz of [-1.2, 1.2]) P.box(sx, 1.4, sz, 0.24, 2.8, 0.24, pal.brick, 0);
    P.fan([0, 2.15, 1.22], [0.55, 0, 0], [0, 0.55, 0], gold ? GOLD : 0xc89a3a, 8); P.fan([0, 2.15, 1.24], [0.4, 0, 0], [0, 0.4, 0], 0x2b3c44, 8); L.fan([0, 2.15, 1.26], [0.3, 0, 0], [0, 0.3, 0], pal.bulb, 8);
    const roofL = [[-1.75, 2.78, 1.45], [1.75, 2.78, 1.45], [1.75, 2.78, -1.45], [-1.75, 2.78, -1.45]];
    P.quad(roofL[0], roofL[1], [1.75, 3.7, 0], [-1.75, 3.7, 0], pal.roof); P.quad(roofL[3], roofL[2], [1.75, 3.7, 0], [-1.75, 3.7, 0], pal.roof);
    P.tri([-1.75, 2.78, 1.45], [1.75, 2.78, 1.45], [0, 3.7, 1.0], pal.booth); P.tri([-1.75, 2.78, -1.45], [1.75, 2.78, -1.45], [0, 3.7, -1.0], pal.booth);
    P.tube([-1.8, 2.75, 1.5], [1.8, 2.75, 1.5], 0.07, gold ? GOLD : pal.trim, { sides: 4, flat: true });
    P.sphere([0, 3.95, 0], 0.32, gold ? GOLD : 0xc89a3a, 8, 5);
    if (near) for (let q = 0; q < 8; q++) bulb(b, [-1.2 + q * 0.34, 2.55, 1.55], 0.17, pal.bulb);
    if (big) { P.box(0, 4.55, 0, 2.2, 0.8, 0.12, gold ? GOLD : 0xcfa24a, 0); L.quad([-0.95, 4.28, 0.07], [0.95, 4.28, 0.07], [0.95, 4.82, 0.07], [-0.95, 4.82, 0.07], pal.sign); }
    b.pop();
  };
  steam(6.3, 6.4, 0, false);
  if (level >= 2) steam(-6.3, 6.4, 0, true);
  if (near) {
    // deck railing (a polygon) and stairs
    const pts = []; for (let i = 0; i < 24; i++) { const a = ang(i, 24); if (Math.abs(a - Math.PI / 2) < 0.2 || Math.abs(a - Math.PI / 2 - TAU) < 0.2) continue; pts.push([Math.cos(a) * 7.0, Math.sin(a) * 7.0]); }
    railing(b, pts.slice(0, 12), 0.6, 0xe9d34a, { h: 1.0, step: 1.7 }); railing(b, pts.slice(12), 0.6, 0xe9d34a, { h: 1.0, step: 1.7 });
    P.box(0, 0.4, 7.35, 2.6, 0.2, 0.5, WOOD, 0);
    queue(b, -3.6, 3.6, [7.65], pal);
  }
  gateway(b, 0, 7.8, 5.0, 3.6, pal, level, near, pal.chord);
  if (level >= 2 && near) {
    festoon(b, [6.5, 3.2, 6.6], [2.5, 3.6, 7.8], 5, 0.4, pal.bulb); festoon(b, [-6.5, 3.2, 6.6], [-2.5, 3.6, 7.8], 5, 0.4, pal.bulb);
    for (const [x, z] of [[-7.1, 7.2], [7.1, 7.2], [-7.1, -7.2], [7.1, -7.2]]) flag(b, x, z, pal);
    for (let i = 0; i < 24; i += 1) { const a = ang(i, 24); if (Math.abs(a - Math.PI / 2) < 0.3) continue; bulb(b, [Math.cos(a) * 7.0, 1.65, Math.sin(a) * 7.0], 0.16, pal.bulb); }
  }
  const handles = {};
  if (level >= 3) {
    handles.led = [];
    const NJ = near ? 36 : 12;
    for (let k = 0; k < 4; k++) {
      const sx = k === 0 || k === 3 ? -1 : 1; const sz = k < 2 ? -1 : 1;
      for (let j = 0; j < NJ; j++) {
        const t0 = j / NJ; const t1 = (j + 0.7) / NJ; const y0 = lerp(1.0, 62, t0); const y1 = lerp(1.0, 62, t1); const w0 = lerp(3.6, 2.4, y0 / 62) / 2 + 0.17; const w1 = lerp(3.6, 2.4, y1 / 62) / 2 + 0.17;
        const n0 = b.count; L.ribbon([sx * w0, y0, sz * w0], [sx * w1, y1, sz * w1], 0.34, [sx, 0, sz], pal.led[0]); handles.led.push({ s: n0, n: b.count - n0, j, NJ });
      }
    }
    if (near) sheep(b, 4.4, 7.3, 0.4, gold);
  }
  return handles;
}

function swingPair(b, pal, near, gold) {
  // origin at the arm tip, riders face +x (outward), pair side by side along z, hangs down -y
  const P = b.P; const L = b.L; const L_ = JU.wire;
  if (!near) { P.box(0, -L_, 0, 0.9, 0.7, 1.9, pal.seat, 0); P.ribbon([0, 0, -0.3], [0.2, -L_ + 0.3, -0.7], 0.06, [0, 0, 1], pal.wire); P.ribbon([0, 0, 0.3], [0.2, -L_ + 0.3, 0.7], 0.06, [0, 0, 1], pal.wire); return; }
  for (const sz of [-1, 1]) {
    const z = sz * 0.52; const x = 0.2;
    P.box(x, -L_, z, 0.62, 0.12, 0.58, pal.seat, 32);                       // seat pan
    P.box(x - 0.34, -L_ + 0.42, z, 0.1, 0.8, 0.58, pal.seat, 32);              // back rest
    P.box(x + 0.34, -L_ + 0.3, z, 0.05, 0.3, 0.5, STEEL, 32);                  // safety bar
    P.tube([x - 0.3, -L_ + 0.8, z + sz * 0.26], [0, 0, sz * 0.12], 0.018, pal.wire, { sides: 3, flat: true });
    P.tube([x - 0.3, -L_ + 0.8, z - sz * 0.26], [0, 0, 0], 0.018, pal.wire, { sides: 3, flat: true });
    L.quad([x - 0.4, -L_ + 0.65, z - 0.2], [x - 0.4, -L_ + 0.65, z + 0.2], [x - 0.4, -L_ + 0.75, z + 0.2], [x - 0.4, -L_ + 0.75, z - 0.2], pal.seatLed);
  }
  if (gold) P.box(0.2, -L_ - 0.1, 0, 0.7, 0.05, 1.6, GOLD, 32);
}

function buildJulesCrown(b, cfg, near, seatsBaked) {
  const { pal, level, gold } = cfg; const P = b.P; const L = b.L; const N = JU.arms;
  P.cylY(0, 0, 0, 2.9, 2.9, 3.6, pal.drum, near ? 18 : 10); P.cylY(0, 3.6, 0, 2.9, 1.5, 1.2, pal.drum, near ? 18 : 10);
  P.cylY(0, -0.05, 0, 3.05, 3.05, 0.4, gold ? GOLD : pal.trim, near ? 18 : 10); P.cylY(0, 3.1, 0, 3.05, 3.05, 0.25, gold ? GOLD : pal.trim, near ? 18 : 10);
  for (let k = 0; k < (near ? 18 : 8); k++) { const a = ang(k, near ? 18 : 8); bulb(b, [Math.cos(a) * 2.95, 1.6, Math.sin(a) * 2.95], 0.3, pal.bulb); }
  const stays = [];
  for (let k = 0; k < N; k++) {
    b.place([0, 0, 0], ang(k, N));
    P.beam([2.7, JU.armY - 1.2, 0], [JU.armR, JU.armY, 0], 0.26, pal.arm);
    if (near) { P.beam([2.7, JU.armY - 0.95, 0], [JU.armR, JU.armY + 0.04, 0], 0.09, pal.armB); L.ribbon([2.7, JU.armY - 1.08, 0.01], [JU.armR, JU.armY - 0.1, 0.01], 0.07, [0, 0, 1], pal.bulb); }
    P.beam([2.0, 5.0, 0], [JU.armR - 1.2, 6.6, 0], 0.18, pal.arm); P.beam([JU.armR - 1.2, 6.6, 0], [JU.armR, JU.armY, 0], 0.07, pal.armB);
    if (near) { P.tube([JU.armR, JU.armY, 0], [JU.armR + 0.25, JU.armY + 0.4, 0], 0.07, STEEL, { sides: 4, flat: true }); }
    if (near && level >= 2) { P.tube([JU.armR, JU.armY + 0.3, 0], [JU.armR, JU.armY + 1.6, 0], 0.025, STEEL, { sides: 3, flat: true }); P.quad([JU.armR, JU.armY + 1.6, 0], [JU.armR + 0.7, JU.armY + 1.45, 0.1], [JU.armR + 0.7, JU.armY + 1.0, 0.1], [JU.armR, JU.armY + 1.05, 0], pal.flag); }
    L.sphere([JU.armR + 0.05, JU.armY - 0.1, 0], 0.14, [1, 0.95, 0.8], 5, 3);
    if (near) { stays.push([[1.0, 5.2, 0], [JU.armR, JU.armY + 0.1, 0], k]); }
    b.pop();
  }
  for (const [a, c, k] of stays) { b.place([0, 0, 0], ang(k, N)); b.line(a, c, pal.wire); b.pop(); }
  return { stays };
}

function assembleJules(cfg, near, root) {
  const { T, K } = cfg; const out = {};
  { const b = K.builder(); out.led = buildJulesStatic(b, cfg, near); const m = b.mesh('jules-static-' + (near ? 'near' : 'far')); root.add(m); out.static = m; if (out.led.led) out.ledFx = K.lampDynamic(m.geometry); }
  { const b = K.builder(); buildJulesCrown(b, cfg, near, false); const crown = new T.Group(); crown.position.y = JU.lo; const m = b.mesh('jules-crown-' + (near ? 'near' : 'far')); crown.add(m);
    if (b.hasLines) crown.add(b.lines('jules-stays')); root.add(crown); out.crown = crown; }
  {
    const b = K.builder(); const ranges = [];
    for (let k = 0; k < JU.arms; k++) { const v0 = b.count; swingPair(b, cfg.pal, near, cfg.gold); ranges.push([v0, b.count - v0]); }
    const m = b.mesh('jules-seats-' + (near ? 'near' : 'far')); root.add(m); out.seats = m; out.seatDyn = K.dynamic(m.geometry, ranges, 40, [0, 36, 0]);
  }
  return out;
}

function buildJules(opts = {}) {
  const cfg = setup(opts, 'jules'); const { T, K } = cfg;
  const nearGroup = cfg.wantNear ? new T.Group() : null; const farGroup = new T.Group();
  const parts = {}; if (cfg.wantNear) parts.near = assembleJules(cfg, true, nearGroup); parts.far = assembleJules(cfg, false, farGroup);
  const st = { theta: 0, y: JU.lo, w: 0, last: -1 };
  const ledUpdate = (p, t) => { if (!p.led.led || !p.ledFx) return; for (const e of p.led.led) { const q = ((t * 0.8 - e.j / e.NJ * 2) % 1 + 1) % 1; const c = e.j % 2 ? cfg.pal.led[0] : cfg.pal.led[1]; const f = 0.25 + 0.75 * Math.pow(1 - q, 2.5); K.setLamp(p.static.geometry, e.s, e.n, [c[0] * f, c[1] * f, c[2] * f]); } p.ledFx.commit(); };
  const advance = (t, dt) => {
    if (t === st.last) return; st.last = t; const ph = julesPhase(t); st.y = ph.y; st.w = ph.w; st.theta = (st.theta + dt * 1.15 * ph.w) % TAU;
  };
  const m4 = new T.Matrix4(); const q = new T.Quaternion(); const qa = new T.Quaternion(); const qb = new T.Quaternion(); const pv = new T.Vector3(); const one = new T.Vector3(1, 1, 1);
  const seatPose = (p, t) => {
    p.crown.position.y = st.y; p.crown.rotation.y = st.theta;
    for (let k = 0; k < JU.arms; k++) {
      const th = st.theta + ang(k, JU.arms); const beta = st.w * st.w * 0.78 + st.w * 0.05 * Math.sin(t * 1.3 + k * 1.7);
      qa.setFromAxisAngle(new T.Vector3(0, 1, 0), th); qb.setFromAxisAngle(new T.Vector3(0, 0, 1), beta); q.copy(qa).multiply(qb);
      pv.set(Math.cos(th) * JU.armR, st.y + JU.armY, -Math.sin(th) * JU.armR);
      m4.compose(pv, q, one); p.seatDyn.set(k, m4);
    }
    p.seatDyn.commit();
    if (!p.ledT || t - p.ledT > 0.06) { p.ledT = t; ledUpdate(p, t); }
  };
  const animNear = (t, dt) => { advance(t, dt); seatPose(parts.near, t); };
  const animFar = (t, dt) => { advance(t, dt); seatPose(parts.far, t); };
  const group = finishModel(T, K, { id: 'jules', near: nearGroup, far: farGroup, footprint: { x: 8, zMin: -8, zMax: 8 }, height: 85, lodDistance: 90, animateNear: animNear, animateFar: animFar });
  group.userData.cycle = CYCLES.jules; group.userData.phaseAt = julesPhase; group.userData.rig = st; group.userData.parts = parts; group.userData.tier = { look: cfg.look, level: cfg.level, quality: cfg.quality };
  return group;
}

/* ================================================================================================ HANGOVER (drop tower) */
const HA = { top: 85, ringR: 3.1 };

function buildHangoverStatic(b, cfg, near) {
  const { pal, level, gold } = cfg; const P = b.P; const L = b.L;
  pad(b, 16, 16);
  const panel = near ? 2.5 : 4.2; const T2 = b.G([0.55, 0.55, 0.52]);
  const sections = [[0.6, 4, 'w'], [4, 20, 'y'], [20, 38, 'w'], [38, 50, 'y'], [50, 62, 'w'], [62, 74, 'y'], [74, HA.top, 'w']];
  for (const [y0, y1, c] of sections) {
    const col = c === 'y' ? pal.yellow : pal.chord; const w0 = lerp(3.8, 2.4, y0 / HA.top); const w1 = lerp(3.8, 2.4, y1 / HA.top);
    latticeMast(b, { y0, y1, w0, w1, panel, chord: c === 'y' ? 0.56 : 0.5, brace: c === 'y' ? 0.36 : 0.3, chordCol: col, braceCol: col, ties: near, braceBucket: c === 'y' ? b.P : T2 });
  }
  P.box(0, HA.top + 0.3, 0, 3.0, 0.6, 3.0, pal.chord, 0); P.tube([0, HA.top + 0.6, 0], [0, HA.top + 4.5, 0], 0.4, pal.chord, { sides: 6, r1: 0.05 }); L.sphere([0, HA.top + 4.7, 0], 0.3, [1, 0.1, 0.05], 6, 4);
  // station: octagon deck with fence, kiosk, painted skyline wall at the back
  P.cylY(0, 0.28, 0, 5.4, 5.4, 0.28, pal.deck, near ? 16 : 10); P.cylY(0, 0.5, 0, 5.45, 5.45, 0.06, gold ? GOLD : 0xe9d34a, near ? 16 : 10);
  P.cylY(0, 0.3, 0, 1.8, 1.8, 1.0, DARK, 10);
  // painted wall: purple base + skyline blocks, lit windows
  const wy = 0.3; P.box(0, wy + 2.4, -7.6, 15.0, 4.8, 0.3, pal.wall, 0);
  const sky = pal.skyline; const rr = cfg.R;
  for (let i = 0; i < (near ? 14 : 6); i++) { const x = -7 + i * (14 / (near ? 13 : 5)); const h = 1.4 + rr() * 2.6; const c = sky[i % sky.length]; P.box(x, wy + 0.5 + h / 2, -7.4, 0.95, h, 0.1, c, 0); if (near && level >= 2) L.quad([x - 0.25, wy + 0.8 + h * 0.4, -7.14], [x + 0.25, wy + 0.8 + h * 0.4, -7.14], [x + 0.25, wy + 1.1 + h * 0.4, -7.14], [x - 0.25, wy + 1.1 + h * 0.4, -7.14], pal.bulb); }
  if (near) for (let q = 0; q < 24; q++) bulb(b, [-6.9 + q * 0.6, wy + 4.95, -7.35], 0.2, pal.bulb);
  booth(b, -5.8, 6.2, 0, pal, level, near, level >= 2);
  if (level >= 2) booth(b, 5.8, 6.2, 0, pal, level, near, false);
  if (near) { const pts = []; for (let i = 0; i < 16; i++) { const a = ang(i, 16); if (Math.abs(a - Math.PI / 2) < 0.3) continue; pts.push([Math.cos(a) * 5.3, Math.sin(a) * 5.3]); } railing(b, pts.slice(0, 7), 0.5, 0xe9d34a, { h: 1.0, step: 1.7 }); railing(b, pts.slice(7), 0.5, 0xe9d34a, { h: 1.0, step: 1.7 }); P.box(0, 0.4, 5.9, 2.4, 0.2, 1.2, WOOD, 0); queue(b, -3.6, 3.6, [6.9], pal); }
  // purple tubular gate with a bulb panel (no lettering)
  const gz = 7.6; const gc = pal.gate;
  for (const sx of [-1, 1]) { P.tube([sx * 3.6, 0.3, gz], [sx * 3.6, 5.0, gz], 0.17, gc, { sides: 6 }); P.tube([sx * 3.6, 5.0, gz], [sx * 2.2, 6.0, gz], 0.17, gc, { sides: 6 }); }
  P.tube([-2.2, 6.0, gz], [2.2, 6.0, gz], 0.17, gc, { sides: 6 });
  if (level >= 2) { P.box(0, 5.2, gz, 4.0, 1.0, 0.14, gold ? GOLD : gc, 0); L.quad([-1.8, 4.8, gz + 0.09], [1.8, 4.8, gz + 0.09], [1.8, 5.6, gz + 0.09], [-1.8, 5.6, gz + 0.09], pal.sign); P.tri([-0.3, 4.9, gz + 0.1], [0.3, 4.9, gz + 0.1], [0, 5.5, gz + 0.1], 0xfff1c8); }
  if (level >= 2) {   // a big lit diamond on the gate with a bulb ring (plain, no lettering)
    const dy = 7.9; const r = 1.6;
    P.quad([0, dy - r, gz], [r, dy, gz], [0, dy + r, gz], [-r, dy, gz], gold ? GOLD : gc);
    L.quad([0, dy - r * 0.78, gz + 0.06], [r * 0.78, dy, gz + 0.06], [0, dy + r * 0.78, gz + 0.06], [-r * 0.78, dy, gz + 0.06], pal.sign);
    P.tri([-0.45, dy - 0.45, gz + 0.08], [0.45, dy - 0.45, gz + 0.08], [0, dy + 0.55, gz + 0.08], 0xfff1c8);
    if (near) for (let q = 0; q < 16; q++) { const a = ang(q, 16); bulb(b, [Math.cos(a) * r * 0.95, dy + Math.sin(a) * r * 0.95 - 0.1, gz + 0.1], 0.18, pal.bulb); }
    P.tube([0, 6.0, gz], [0, dy - r, gz], 0.15, gc, { sides: 5 });
  }
  if (level >= 2 && near) { for (let q = 0; q < 11; q++) bulb(b, [-2.2 + q * 0.44, 6.15, gz + 0.1], 0.2, pal.bulb); for (const [x, z] of [[-7.1, 7.2], [7.1, 7.2], [-7.1, -6.5], [7.1, -6.5]]) flag(b, x, z, { flag: pal.gate }); }
  if (level >= 3 && near) sheep(b, 3.6, 5.2, 0.5, gold);
  // vertical colour-LED strips on the four mast corners (colour-LED columns), chase animated; L1 has a plain white-bulb line on two corners
  const handles = { led: [], NJ: 0 };
  const NJ = near ? 56 : 18; handles.NJ = NJ;
  const strips = level >= 2 ? [0, 1, 2, 3] : [1, 2];
  for (const k of strips) {
    const sx = k === 0 || k === 3 ? -1 : 1; const sz = k < 2 ? -1 : 1;
    for (let j = 0; j < NJ; j++) {
      const t0 = j / NJ; const t1 = (j + 0.92) / NJ; const y0 = lerp(2.5, HA.top - 1, t0); const y1 = lerp(2.5, HA.top - 1, t1); const w0 = lerp(3.8, 2.4, y0 / HA.top) / 2 + 0.2; const w1 = lerp(3.8, 2.4, y1 / HA.top) / 2 + 0.2;
      const n0 = b.count; L.ribbon([sx * w0, y0, sz * w0], [sx * w1, y1, sz * w1], 0.6, [sx, 0, sz], pal.led[(j + k) % pal.led.length]); handles.led.push({ s: n0, n: b.count - n0, j, k });
    }
  }
  return handles;
}

function buildHangoverRing(b, cfg, near) {
  const { pal, gold } = cfg; const P = b.P; const L = b.L; const N = near ? 12 : 8;
  P.cylY(0, 0, 0, 2.2, 2.2, 1.1, pal.ring, near ? 14 : 10); P.ring([0, 0.15, 0], [0, 1, 0], 2.2, 4.1, pal.ring, near ? 20 : 12); P.ring([0, 0.1, 0], [0, -1, 0], 2.2, 4.1, pal.ring, near ? 20 : 12);
  P.ring([0, 0.16, 0], [0, 1, 0], 4.0, 4.2, gold ? GOLD : pal.ringB, near ? 20 : 12);
  for (let k = 0; k < N; k++) {
    b.place([0, 0, 0], ang(k, N));
    P.box(3.15, 0.55, 0, 0.8, 0.45, 0.95, pal.ringB, 32);                      // seat pan (the rider faces outward, +x)
    P.box(2.78, 1.1, 0, 0.14, 1.15, 0.95, pal.ring, 32);                        // back
    if (near) { P.tube([3.5, 0.9, -0.34], [3.5, 1.9, -0.34], 0.06, STEEL, { sides: 4, flat: true }); P.tube([3.5, 0.9, 0.34], [3.5, 1.9, 0.34], 0.06, STEEL, { sides: 4, flat: true }); P.tube([3.5, 1.9, -0.34], [3.5, 1.9, 0.34], 0.07, STEEL, { sides: 4, flat: true }); }
    if (near) L.quad([2.74, 1.5, -0.3], [2.74, 1.5, 0.3], [2.74, 1.7, 0.3], [2.74, 1.7, -0.3], pal.bulb);
    b.pop();
  }
  // saucer roof
  P.tube([0, 2.4, 0], [0, 3.2, 0], 4.9, pal.saucer, { sides: near ? 20 : 12, r1: 2.0, caps: 0 }); P.ring([0, 2.4, 0], [0, -1, 0], 2.0, 4.9, pal.ring, near ? 20 : 12);
  P.cylY(0, 3.1, 0, 2.0, 1.4, 0.6, pal.ring, 10);
  for (let k = 0; k < (near ? 28 : 12); k++) { const a = ang(k, near ? 28 : 12); bulb(b, [Math.cos(a) * 4.9, 2.4, Math.sin(a) * 4.9], 0.3, pal.bulb); }
  if (gold) P.ring([0, 2.42, 0], [0, 1, 0], 4.6, 4.95, GOLD, near ? 20 : 12);
}

function buildHangover(opts = {}) {
  const cfg = setup(opts, 'hangover'); const { T, K } = cfg;
  const nearGroup = cfg.wantNear ? new T.Group() : null; const farGroup = new T.Group();
  const parts = {};
  for (const [near, root] of [[true, nearGroup], [false, farGroup]]) {
    if (near && !nearGroup) continue;
    const o = {}; const b = K.builder(); o.led = buildHangoverStatic(b, cfg, near); o.static = b.mesh('hangover-static-' + (near ? 'near' : 'far')); root.add(o.static); o.ledFx = K.lampDynamic(o.static.geometry);
    const rb = K.builder(); buildHangoverRing(rb, cfg, near); o.ring = new T.Group(); o.ring.position.y = HA.ring0 || 3.6; o.ring.add(rb.mesh('hangover-ring-' + (near ? 'near' : 'far'))); root.add(o.ring);
    parts[near ? 'near' : 'far'] = o;
  }
  const st = { y: 3.6, mode: 'board', v: 0, last: -1 };
  const chase = (p, t) => {
    for (const e of p.led.led) {
      const c = cfg.pal.led[(e.j + e.k) % cfg.pal.led.length]; const y = lerp(2.5, HA.top - 1, e.j / p.led.NJ);
      let f; if (cfg.level >= 3) { const d = Math.abs(y - st.y); const trail = st.v >= 0 ? (y < st.y ? Math.max(0, 1 - d / 22) : 0) : (y > st.y ? Math.max(0, 1 - d / 22) : 0); f = 0.22 + 0.5 * (0.5 + 0.5 * Math.sin(e.j * 0.7 + t * 5 * (st.v >= 0 ? -1 : 1))) + 0.5 * trail; }
      else f = 0.55 + 0.45 * Math.sin(t * 2 + e.k + e.j * 0.3 * 0);
      K.setLamp(p.static.geometry, e.s, e.n, [Math.min(1, c[0] * f), Math.min(1, c[1] * f), Math.min(1, c[2] * f)]);
    }
    p.ledFx.commit();
  };
  const adv = (t) => { if (t === st.last) return; st.last = t; const ph = hangoverPhase(t); st.y = ph.y; st.mode = ph.mode; st.v = ph.v; };
  const anim = (which) => (t) => { adv(t); const p = parts[which]; p.ring.position.y = st.y + (st.mode === 'hold' ? 0.04 * Math.sin(t * 40) : 0); if (!p.ledT || t - p.ledT > 0.06) { p.ledT = t; chase(p, t); } };
  const group = finishModel(T, K, { id: 'hangover', near: nearGroup, far: farGroup, footprint: { x: 8, zMin: -7.6, zMax: 8 }, height: 90, lodDistance: 90, animateNear: anim('near'), animateFar: anim('far') });
  group.userData.cycle = CYCLES.hangover; group.userData.phaseAt = hangoverPhase; group.userData.rig = st; group.userData.parts = parts; group.userData.tier = { look: cfg.look, level: cfg.level, quality: cfg.quality };
  return group;
}

/* ================================================================================================ BOOSTER */
const BO = { axleY: 33, axleZ: 3.1, towerZ: -4.4, armLong: 25, armShort: 7.5, towerTop: 55 };

/** a rectangular prism between y0 and y1 (centred on the y axis), widths along x and z at each end, one colour per end (gradient) */
function prismY(b, bucket, y0, y1, w0, d0, w1, d1, c0, c1, cx = 0, cz = 0, capTop = true) {
  const corner = (sx, sz, y, w, d) => [cx + sx * w / 2, y, cz + sz * d / 2];
  const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let f = 0; f < 4; f++) {
    const [ax, az] = cs[f]; const [bx, bz] = cs[(f + 1) % 4];
    bucket.quad(corner(ax, az, y0, w0, d0), corner(bx, bz, y0, w0, d0), corner(bx, bz, y1, w1, d1), corner(ax, az, y1, w1, d1), c0, c0, c1, c1);
  }
  if (capTop) bucket.quad(corner(-1, -1, y1, w1, d1), corner(1, -1, y1, w1, d1), corner(1, 1, y1, w1, d1), corner(-1, 1, y1, w1, d1), c1);
}

function buildBoosterStatic(b, cfg, near) {
  const { pal, level, gold } = cfg; const P = b.P; const L = b.L; const tz = BO.towerZ;
  pad(b, 30, 18);
  // stage deck with hazard-stripe edge, railings
  P.box(0, 0.5, 0, 22, 0.4, 12.5, pal.deck, 32); P.box(0, 0.72, 0, 21.6, 0.06, 12.1, 0x8a8d90, 32);
  const hz2 = pal.hazard; for (let i = 0; i < (near ? 22 : 8); i++) P.box(-10.5 + i * (21 / (near ? 21 : 7)), 0.74, 6.1, near ? 0.95 : 2.6, 0.08, 0.35, hz2[i % 2], 32);
  // tower: gradient magenta -> pink -> yellow with a back stay
  prismY(b, P, 0.6, 20, 2.9, 2.9, 2.5, 2.5, pal.tower, pal.tower, 0, tz, false);
  prismY(b, P, 20, 42, 2.5, 2.5, 2.0, 2.0, pal.tower, pal.towerMid, 0, tz, false);
  prismY(b, P, 42, BO.towerTop, 2.0, 2.0, 1.5, 1.5, pal.towerMid, pal.towerTop, 0, tz, true);
  for (const k of [-1, 1]) { P.tube([k * 1.5, 0.6, tz + 1.5], [k * 0.9, BO.towerTop, tz + 0.85], 0.06, STEEL, { sides: 3, flat: true }); }
  P.tube([0, 31, tz - 1.0], [0, 0.6, -8.0], 0.28, pal.tower, { sides: 6 }); P.box(0, 0.9, -8.0, 2.2, 0.8, 1.6, DARK, 0);
  // zig-zag LED along the front edges of the tower
  const handles = { led: [] };
  const NJ = near ? 30 : 10;
  for (let j = 0; j < NJ; j++) {
    const t0 = j / NJ; const t1 = (j + 0.7) / NJ; const y0 = lerp(1.5, 52, t0); const y1 = lerp(1.5, 52, t1); const w0 = lerp(2.9, 1.6, y0 / 55) / 2 + 0.05; const w1 = lerp(2.9, 1.6, y1 / 55) / 2 + 0.05;
    for (const sx of [-1, 1]) { const n0 = b.count; L.ribbon([sx * w0, y0, tz + w0 + 0.02], [sx * w1, y1, tz + w1 + 0.02], 0.34, [0, 0, 1], pal.led[(j + (sx > 0 ? 1 : 0)) % 2]); handles.led.push({ s: n0, n: b.count - n0, j, NJ }); }
  }
  // white lightning zig-zags painted on the front and sides (comic style)
  for (const f of near ? [0, 1, 2, 3] : [2]) {
    const nrm = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]][f]; const tx = [[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]][f];
    let prev = null;
    for (let j = 0; j <= 9; j++) { const y = 6 + j * 3.4; const w = lerp(2.9, 1.8, y / 55) / 2; const lat = (j % 2 ? 0.32 : -0.32) * w; const off = w + 0.02;
      const pt = [tz * 0 + (nrm[0] * off + tx[0] * lat), y, tz + (nrm[2] * off + tx[2] * lat)];
      if (prev) P.ribbon(prev, pt, 0.2, nrm, 0xf8f4ff); prev = pt; }
  }
  // sign board with bulbs across the tower (plain lit panels, no lettering)
  const sy = 39.5; P.box(0, sy, tz + 1.55, 11, 1.6, 0.3, gold ? GOLD : 0xf2f2ea, 0);
  L.quad([-5.2, sy - 0.6, tz + 1.72], [0, sy - 0.6, tz + 1.72], [0, sy + 0.6, tz + 1.72], [-5.2, sy + 0.6, tz + 1.72], pal.sign); L.quad([0, sy - 0.6, tz + 1.72], [5.2, sy - 0.6, tz + 1.72], [5.2, sy + 0.6, tz + 1.72], [0, sy + 0.6, tz + 1.72], pal.led[0]);
  if (near) for (let q = 0; q < 26; q++) bulb(b, [-5.2 + q * 0.416, sy + 0.9, tz + 1.74], 0.2, pal.bulb);
  // arm bearing housing and axle
  P.tube([0, BO.axleY, tz + 0.7], [0, BO.axleY, BO.axleZ + 0.3], 1.1, 0x4d5459, { sides: 12, caps: 2 });
  P.box(0, BO.axleY, tz + 0.5, 2.8, 3.0, 1.4, pal.tower, 0);
  // silver canopy arc over the stage and a red skirt round the deck
  { const N = near ? 14 : 6; let prev = null; for (let q = 0; q <= N; q++) { const x = lerp(-10.5, 10.5, q / N); const y = 7.6 - 0.032 * x * x; const pt = [x, y, -1.2]; if (prev) P.tube(prev, pt, 0.2, 0xc9ced2, { sides: 6 }); prev = pt; } }
  P.box(0, 0.9, 6.35, 22, 0.9, 0.12, 0xc8202a, 0); for (const sx of [-1, 1]) P.box(sx * 11, 0.9, 0.2, 0.12, 0.9, 12.3, 0xc8202a, 0);
  // comic backdrop wings (painted panels in four colours) behind and left / right
  const wc = pal.wall; const rr = cfg.R;
  for (let s = -1; s <= 1; s += 2) for (let i = 0; i < (near ? 5 : 3); i++) { const x = s * (4 + i * 2.1); const h = 3.4 + rr() * 2.6; P.box(x, 0.7 + h / 2, -8.6 + rr() * 0.2, 2.0, h, 0.2, wc[(i + (s > 0 ? 1 : 0)) % 4], 0); if (near && level >= 2) L.quad([x - 0.7, 0.7 + h - 0.5, -8.4], [x + 0.7, 0.7 + h - 0.5, -8.4], [x + 0.7, 0.7 + h - 0.1, -8.4], [x - 0.7, 0.7 + h - 0.1, -8.4], pal.bulb); }
  booth(b, -11.5, 6.4, 0, { booth: 0xf0e6cc, roof: pal.roof, trim: pal.roof, bulb: pal.bulb, sign: pal.sign }, level, near, level >= 2);
  if (level >= 2) booth(b, 11.5, 6.4, 0, { booth: 0xf0e6cc, roof: pal.roof, trim: pal.roof, bulb: pal.bulb, sign: pal.sign }, level, near, false);
  if (near) { railing(b, [[-10.6, 6.0], [10.6, 6.0]], 0.7, 0xe9d34a, { h: 1.0, step: 1.8 }); queue(b, -5, 5, [7.4, 8.4], { trim: pal.roof }); }
  gateway(b, 0, 8.2, 7.0, 3.8, { sign: pal.sign, bulb: pal.bulb, gate: pal.tower, chord: pal.tower }, level, near, pal.tower);
  if (level >= 2 && near) { for (const [x, z] of [[-14.1, 7.8], [14.1, 7.8], [-14.1, -7], [14.1, -7]]) flag(b, x, z, { flag: pal.flag }); festoon(b, [-3.5, 4.0, 8.2], [-11.5, 3.6, 6.4], 7, 0.5, pal.bulb); festoon(b, [3.5, 4.0, 8.2], [11.5, 3.6, 6.4], 7, 0.5, pal.bulb); }
  if (level >= 3 && near) sheep(b, 7.0, 7.6, 0.4, gold);
  return handles;
}

/** the arm group, drawn hanging straight down (long arm toward -y); the pod is a child group at the arm's end */
function buildBoosterArm(b, cfg, near, withPod) {
  const { pal, gold } = cfg; const P = b.P; const L = b.L; const len = BO.armLong; const z0 = 0;
  // long arm: tapered box section, cream, with hazard stripes at the end, oval windows along both sides, bulb rows
  prismY(b, P, -1.2, -len, 2.8, 2.2, 1.5, 1.3, pal.arm, pal.armEdge, 0, z0, false);
  const nH = near ? 7 : 3; for (let i = 0; i < nH; i++) { const y0 = -len + 0.4 + i * (2.2 / nH) * 1; const y1 = y0 + 1.1 / nH * 1.0; if (near) P.box(0, (y0 + y1) / 2, z0, 1.56, y1 - y0, 1.36, pal.hazard[i % 2], 0); }
  const ovals = near ? 7 : 3;
  for (let i = 0; i < ovals; i++) { const y = lerp(-3.4, -len + 3.5, i / (ovals - 1)); const wd = lerp(0.8, 0.5, i / ovals); for (const sz of [-1, 1]) { const dz = lerp(1.1, 0.65, i / ovals) + 0.015; P.fan([0, y, z0 + sz * dz], [0, 1.0, 0], [wd, 0, 0], pal.oval, 12); if (near) L.fan([0, y, z0 + sz * (dz + 0.01)], [0, 0.82, 0], [wd * 0.7, 0, 0], pal.bulb, 10); } }
  if (near) for (const sx of [-1, 1]) for (const sz of [-1, 1]) { for (let i = 0; i < 18; i++) { const y = lerp(-2.2, -len + 1, i / 17); const w = lerp(1.4, 0.75, i / 17); bulb(b, [sx * w, y, z0 + sz * lerp(1.1, 0.65, i / 17)], 0.3, pal.bulb); } }
  // short arm with the counterweight
  prismY(b, P, 1.2, BO.armShort, 1.8, 1.5, 1.4, 1.2, pal.arm, pal.armEdge, 0, z0, true);
  P.box(0, BO.armShort + 1.1, z0, 2.6, 2.2, 2.2, DARK, 0); P.box(0, BO.armShort + 1.1, z0, 2.7, 0.35, 2.3, gold ? GOLD : pal.hazard[0], 0);
  // hub drum
  P.tube([0, 0, z0 - 1.5], [0, 0, z0 + 1.5], 1.55, pal.tower, { sides: 14, caps: 2 }); P.tube([0, 0, z0 + 1.52], [0, 0, z0 + 1.6], 1.1, gold ? GOLD : pal.arm, { sides: 14, caps: 1 });
  if (withPod) { b.place([0, -len - 0.5, 0]); buildBoosterPod(b, cfg, near); b.pop(); }
}
function buildBoosterPod(b, cfg, near) {
  const { pal, gold } = cfg; const P = b.P; const L = b.L;
  P.box(0, 0, 0, 1.7, 1.5, 5.4, pal.pod, 0);
  if (near) for (let i = 0; i < 6; i++) P.box(0, 0, -2.3 + i * 0.92, 1.76, 1.52, 0.4, pal.podB, 0);
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) { P.box(sx * 1.25, 0.1, -1.7 + i * 1.15, 0.9, 0.9, 0.95, pal.podB, 0); if (near) P.box(sx * 1.75, 0.5, -1.7 + i * 1.15, 0.12, 0.4, 0.85, STEEL, 0); }
  for (const sz of [-1, 1]) { P.box(0, 0, sz * 2.85, 1.9, 1.7, 0.3, gold ? GOLD : pal.armEdge, 0); L.sphere([0, 0, sz * 3.1], 0.34, [1, 0.2, 0.1], 6, 4); }
}

function buildBooster(opts = {}) {
  const cfg = setup(opts, 'booster'); const { T, K } = cfg;
  const nearGroup = cfg.wantNear ? new T.Group() : null; const farGroup = new T.Group();
  const parts = {};
  for (const [near, root] of [[true, nearGroup], [false, farGroup]]) {
    if (near && !nearGroup) continue;
    const o = {}; const b = K.builder(); o.led = buildBoosterStatic(b, cfg, near); o.static = b.mesh('booster-static-' + (near ? 'near' : 'far')); root.add(o.static); o.ledFx = K.lampDynamic(o.static.geometry);
    o.arm = new T.Group(); o.arm.position.set(0, BO.axleY, BO.axleZ);
    const ab = K.builder(); buildBoosterArm(ab, cfg, near, !near); o.arm.add(ab.mesh('booster-arm-' + (near ? 'near' : 'far')));
    if (near) { o.pod = new T.Group(); o.pod.position.y = -BO.armLong - 0.5; const pb = K.builder(); buildBoosterPod(pb, cfg, true); o.pod.add(pb.mesh('booster-pod')); o.arm.add(o.pod); }
    root.add(o.arm); parts[near ? 'near' : 'far'] = o;
  }
  const st = { a: 0, raw: 0, last: -1, pod: 0 };
  const chase = (p, t) => { for (const e of p.led.led) { const f = 0.3 + 0.7 * Math.pow(((t * 0.9 - e.j / e.NJ * 2) % 1 + 1) % 1, 2); const c = cfg.pal.led[e.j % 2]; K.setLamp(p.static.geometry, e.s, e.n, [c[0] * f, c[1] * f, c[2] * f]); } p.ledFx.commit(); };
  const anim = (which) => (t, dt) => {
    if (t !== st.last) { st.last = t; const ph = boosterPhase(t); st.a = ph.a; st.raw = ph.raw; st.pod = ph.raw * 1.7; }
    const p = parts[which]; p.arm.rotation.z = st.a; if (p.pod) p.pod.rotation.y = st.pod;
    if (!p.ledT || t - p.ledT > 0.06) { p.ledT = t; chase(p, t); }
  };
  const group = finishModel(T, K, { id: 'booster', near: nearGroup, far: farGroup, footprint: { x: 15, zMin: -9, zMax: 9 }, height: 60, lodDistance: 90, animateNear: anim('near'), animateFar: anim('far') });
  group.userData.cycle = CYCLES.booster; group.userData.phaseAt = boosterPhase; group.userData.rig = st; group.userData.parts = parts; group.userData.tier = { look: cfg.look, level: cfg.level, quality: cfg.quality };
  return group;
}

/* ================================================================================================ INFINITY (pendulum arm) */
const IN = { pivotY: 25.5, armLen: 21, towerX: 6.4, legZ: 4.5 };

function buildInfinityStatic(b, cfg, near) {
  const { pal, level, gold } = cfg; const P = b.P; const L = b.L; const handles = { led: [] };
  pad(b, 16, 16);
  // two A-towers (legs lean to the apex), cross braces, zig-zag LED on the legs
  for (const sx of [-1, 1]) {
    const x = sx * IN.towerX; const apex = [x, IN.pivotY, 0];
    P.box(x, 0.45, 0, 1.6, 0.5, 10.4, 0x80858a, 32);
    for (const sz of [-1, 1]) {
      const foot = [x, 0.6, sz * IN.legZ]; P.tube(foot, apex, 0.95, pal.leg, { sides: near ? 10 : 6, r1: 0.7 });
      P.box(x, 0.8, sz * IN.legZ, 1.5, 0.8, 1.5, 0x80858a, 32);
      const NJ = near ? 14 : 5;
      for (let j = 0; j < NJ; j++) { const t0 = lerp(0.05, 0.94, j / NJ); const t1 = lerp(0.05, 0.94, (j + 0.9) / NJ); const side = j % 2 ? 0.5 : -0.5; const side2 = j % 2 ? -0.5 : 0.5;
        const p0 = [x + sx * 0.0 + side * 0.9, lerp(0.6, IN.pivotY, t0), lerp(foot[2], 0, t0)]; const p1 = [x + side2 * 0.9, lerp(0.6, IN.pivotY, t1), lerp(foot[2], 0, t1)];
        const n0 = b.count; L.ribbon([p0[0] + sx * 0.0, p0[1], p0[2] + sz * -0.0], [p1[0], p1[1], p1[2]], 0.32, [sx, 0.0, 0], pal.led); handles.led.push({ s: n0, n: b.count - n0, j }); }
    }
    for (const t of near ? [0.25, 0.5, 0.75] : [0.4]) { const y = lerp(0.6, IN.pivotY, t); const zz = lerp(IN.legZ, 0, t); P.tube([x, y, -zz], [x, y, zz], 0.14, pal.brace, { sides: 4, flat: true }); if (near) { P.tube([x, y, -zz], [x, y + 3.0, lerp(-zz, 0, 0.5)], 0.1, pal.brace, { sides: 3, flat: true }); P.tube([x, y, zz], [x, y + 3.0, lerp(zz, 0, 0.5)], 0.1, pal.brace, { sides: 3, flat: true }); } }
    P.box(x, IN.pivotY, 0, 1.6, 1.5, 1.4, DARK, 0);
  }
  P.tube([-IN.towerX, IN.pivotY, 0], [IN.towerX, IN.pivotY, 0], 0.55, 0x4d5459, { sides: 10 });
  P.tube([-IN.towerX, IN.pivotY + 0.8, 0], [IN.towerX, IN.pivotY + 0.8, 0], 0.18, pal.brace, { sides: 4, flat: true });
  // winged lit sign above the axle (two sides, plain panels), round lit emblems on both apexes
  if (level >= 2) {
    const y = IN.pivotY + 3.6;
    for (const sz of [-1, 1]) {
      const z = sz * 0.25;
      P.box(0, y, 0, 5.4, 1.7, 0.4, gold ? GOLD : pal.wing, 0); L.quad([-2.4, y - 0.65, z * 1.8], [2.4, y - 0.65, z * 1.8], [2.4, y + 0.65, z * 1.8], [-2.4, y + 0.65, z * 1.8], pal.sign);
      for (const s2 of [-1, 1]) for (let q = 0; q < 5; q++) P.tri([s2 * 2.7, y + 0.8 - q * 0.36, z], [s2 * (4.8 - q * 0.2), y + 0.65 - q * 0.36, z], [s2 * 2.7, y + 0.45 - q * 0.36, z], q % 2 ? pal.wing : pal.ringB);
    }
    P.tube([0, IN.pivotY + 0.8, 0], [0, y - 0.8, 0], 0.25, pal.brace, { sides: 4, flat: true });
    if (near) for (let q = 0; q < 12; q++) bulb(b, [-2.5 + q * 0.45, y + 1.0, 0.3], 0.18, pal.bulb);
  }
  for (const sx of [-1, 1]) { const x = sx * IN.towerX; const y = IN.pivotY + 1.9; P.tube([x, y - 0.4, 0], [x, y + 0.2, 0], 0.7, pal.ring, { sides: 12, caps: 2 }); for (const sz of [-1, 1]) { L.ring([x, y - 0.4, sz * 0.2], [0, 0, sz], 0.2, 1.1, pal.sign, 12); L.ring([x, y - 0.4, sz * 0.22], [0, 0, sz], 0.25, 0.55, pal.armLed, 12); } }
  // station deck (octagon) + fence + kiosk + queue
  P.cylY(0, 0.28, 0, 4.9, 4.9, 0.3, pal.deck, near ? 16 : 10); P.cylY(0, 0.55, 0, 4.95, 4.95, 0.06, gold ? GOLD : 0xe9d34a, near ? 16 : 10);
  booth(b, -5.6, 6.2, 0, { booth: pal.booth, roof: pal.roof, trim: pal.wing, bulb: pal.bulb, sign: pal.sign }, level, near, level >= 2);
  if (level >= 2) booth(b, 5.6, 6.2, 0, { booth: pal.booth, roof: pal.roof, trim: pal.wing, bulb: pal.bulb, sign: pal.sign }, level, near, false);
  if (near) { railing(b, [[-4.6, 5.4], [-1.4, 5.4]], 0.5, 0xe9d34a, { h: 1.0, step: 1.6 }); railing(b, [[1.4, 5.4], [4.6, 5.4]], 0.5, 0xe9d34a, { h: 1.0, step: 1.6 }); queue(b, -3.4, 3.4, [7.0], { trim: pal.wing }); }
  gateway(b, 0, 7.6, 4.2, 3.4, { sign: pal.sign, bulb: pal.bulb, chord: pal.leg }, level, near, pal.leg);
  // backdrop: painted wall behind the station
  P.box(0, 3.2, -7.5, 13, 5.8, 0.25, pal.leg, 0); for (let i = 0; i < (near ? 8 : 4); i++) { const c = [pal.ring, pal.wing, pal.ringB, pal.pylon][i % 4]; P.box(-5.6 + i * (11.2 / (near ? 7 : 3)), 2.6 + (i % 3) * 0.7, -7.32, 1.3, 2.4 + (i % 3) * 1.2, 0.1, c, 0); }
  if (near) for (let q = 0; q < 22; q++) bulb(b, [-6.3 + q * 0.6, 6.25, -7.45], 0.2, pal.bulb);
  if (level >= 2 && near) { for (const [x, z] of [[-7.1, 7.2], [7.1, 7.2], [-7.1, -6.4], [7.1, -6.4]]) flag(b, x, z, { flag: pal.flag }); }
  if (level >= 3 && near) sheep(b, 3.5, 7.0, 0.3, gold);
  return handles;
}

/** arm hanging down from the pivot (origin), ring at its end (a child group spins about the arm axis) */
function buildInfinityArm(b, cfg, near, withRing) {
  const { pal, gold } = cfg; const P = b.P; const L = b.L; const len = IN.armLen;
  P.tube([-1.3, 0, 0], [1.3, 0, 0], 1.25, 0x4d5459, { sides: 12, caps: 2 });
  prismY(b, P, -0.8, -len, 1.5, 1.1, 1.0, 0.9, pal.arm, pal.armB, 0, 0, false);
  if (near) for (let i = 0; i < 9; i++) { const y = lerp(-2.2, -len + 2, i / 8); P.box(0, y, 0, lerp(1.46, 1.0, i / 8), 0.18, lerp(1.06, 0.9, i / 8), pal.armB, 0); }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.ribbon([sx * 0.74, -1.2, sz * 0.54], [sx * 0.5, -len + 0.8, sz * 0.46], 0.08, [sx, 0, sz], pal.armLed);
  if (withRing) { b.place([0, -len - 0.25, 0]); buildInfinityRing(b, cfg, near); b.pop(); }
}
function buildInfinityRing(b, cfg, near) {
  const { pal, gold } = cfg; const P = b.P; const L = b.L; const N = near ? 16 : 10;
  P.cylY(0, -0.6, 0, 1.0, 1.0, 1.2, 0x4d5459, 12);
  P.ring([0, 0, 0], [0, 1, 0], 1.0, 3.5, pal.ring, near ? 24 : 12); P.ring([0, -0.05, 0], [0, -1, 0], 1.0, 3.5, pal.ringB, near ? 24 : 12);
  for (let k = 0; k < (near ? 8 : 5); k++) { b.place([0, 0, 0], ang(k, near ? 8 : 5)); P.beam([1.0, 0.0, 0], [3.4, 0.0, 0], 0.14, pal.ringB); b.pop(); }
  for (let k = 0; k < N; k++) {
    b.place([0, 0, 0], ang(k, N));
    P.box(3.6, 0.4, 0, 0.7, 0.4, 0.85, k % 2 ? pal.seatB : pal.seat, 32); P.box(3.3, 0.9, 0, 0.12, 0.9, 0.85, k % 2 ? pal.seat : pal.seatB, 32);
    if (near) { P.tube([3.95, 0.55, -0.3], [3.95, 1.5, -0.3], 0.05, STEEL, { sides: 3, flat: true }); P.tube([3.95, 0.55, 0.3], [3.95, 1.5, 0.3], 0.05, STEEL, { sides: 3, flat: true }); }
    L.quad([3.55, -0.05, -0.2], [3.55, -0.05, 0.2], [3.9, -0.05, 0.2], [3.9, -0.05, -0.2], pal.bulb);
    b.pop();
  }
  if (gold) P.ring([0, 0.03, 0], [0, 1, 0], 3.3, 3.55, GOLD, near ? 24 : 12);
  for (let k = 0; k < (near ? 24 : 10); k++) { const a = ang(k, near ? 24 : 10); bulb(b, [Math.cos(a) * 3.5, 0.02, Math.sin(a) * 3.5], 0.22, pal.bulb); }
}

function buildInfinity(opts = {}) {
  const cfg = setup(opts, 'infinity'); const { T, K } = cfg;
  const nearGroup = cfg.wantNear ? new T.Group() : null; const farGroup = new T.Group();
  const parts = {};
  for (const [near, root] of [[true, nearGroup], [false, farGroup]]) {
    if (near && !nearGroup) continue;
    const o = {}; const b = K.builder(); o.led = buildInfinityStatic(b, cfg, near); o.static = b.mesh('infinity-static-' + (near ? 'near' : 'far')); root.add(o.static); o.ledFx = K.lampDynamic(o.static.geometry);
    o.arm = new T.Group(); o.arm.position.set(0, IN.pivotY, 0);
    const ab = K.builder(); buildInfinityArm(ab, cfg, near, !near); o.arm.add(ab.mesh('infinity-arm-' + (near ? 'near' : 'far')));
    if (near) { o.ring = new T.Group(); o.ring.position.y = -IN.armLen - 0.25; const rb = K.builder(); buildInfinityRing(rb, cfg, true); o.ring.add(rb.mesh('infinity-ring')); o.arm.add(o.ring); }
    root.add(o.arm); parts[near ? 'near' : 'far'] = o;
  }
  const st = { a: 0, last: -1, spin: 0, amp: 0 };
  const chase = (p, t) => { for (const e of p.led.led) { const f = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(e.j * 1.1 - t * 6)); K.setLamp(p.static.geometry, e.s, e.n, [cfg.pal.led[0] * f, cfg.pal.led[1] * f, cfg.pal.led[2] * f]); } p.ledFx.commit(); };
  const anim = (which) => (t, dt) => {
    if (t !== st.last) { st.last = t; const ph = infinityPhase(t); st.a = ph.a; st.amp = ph.amp; st.spin += dt * ph.spin; }
    const p = parts[which]; p.arm.rotation.x = st.a; if (p.ring) p.ring.rotation.y = st.spin;
    if (!p.ledT || t - p.ledT > 0.06) { p.ledT = t; chase(p, t); }
  };
  const group = finishModel(T, K, { id: 'infinity', near: nearGroup, far: farGroup, footprint: { x: 8, zMin: -7.6, zMax: 8 }, height: 30, lodDistance: 80, animateNear: anim('near'), animateFar: anim('far') });
  group.userData.cycle = CYCLES.infinity; group.userData.phaseAt = infinityPhase; group.userData.rig = st; group.userData.parts = parts; group.userData.tier = { look: cfg.look, level: cfg.level, quality: cfg.quality };
  return group;
}

export const MODELS = { jules: { build: buildJules }, hangover: { build: buildHangover }, booster: { build: buildBooster }, infinity: { build: buildInfinity } };
export default MODELS;
