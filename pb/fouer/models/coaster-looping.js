/* Schueberfouer Tycoon, W4b: the five-loop coaster (item `looping`, pitch XL 56 x 30, DESIGN 3.3).
 * White lattice supports with a flag each, orange box-profile track, a 35 m lift hill, a long drop and five coloured loops in a row (neon outlines at L3),
 * a banked turnaround and the brake run back to the station.  Two trains of four cars follow the spline by arc length. */
import { makeKit, clamp, lerp, bulb, festoon, railing, padSlab, pennant, sheep, latticeMast } from './big-kit.js';
import { makeSpline, makeRun, arcPoints, loopPoints, loopAdvance, girder, rails, ledWallRuns, buildTrackRide, supportPoints, strip } from './coaster-kit.js';
import { litSign, ticketBooth, queueRails, nameOf, GOLD, DARK, collar, patch } from './coaster-props.js';

const PAL = [
  { top: 0xf06a1c, side: 0xd24e10, rail: 0xf4f2ea, mast: 0xf4f4f0, brace: 0xdfe3e6, loops: [0x2f6fe0, 0xf2c80c, 0x23262a, 0x2fa84f, 0xe3242b], car: 0xf4f2ea, stripe: 0xe3242b, seat: 0x23262a, board: 0x1c2a52, trim: 0xe7b53b,
    sign: [1, 0.55, 0.12], bulb: [1, 0.85, 0.5], led: [[1, 0.5, 0.1], [0.3, 0.6, 1], [1, 0.9, 0.2], [0.3, 1, 0.5], [1, 0.2, 0.2]], deck: 0x8b9094, booth: 0xefe3c2, boothRoof: 0xa2272b, canopy: 0xefe3c2, flags: [0xe3242b, 0xf4f2ea, 0x2f6fe0, 0xf2c80c] },
  { top: 0xd81d96, side: 0xa80f72, rail: 0xe6e0ff, mast: 0xe6e0ff, brace: 0xc9c0f0, loops: [0x35e6ff, 0xc7ff3a, 0x6a3ad0, 0xff5ac0, 0x35ff9a], car: 0x2a1f60, stripe: 0x35e6ff, seat: 0x0f0a30, board: 0x120a30, trim: 0x40e8ff,
    sign: [0.2, 0.95, 1], bulb: [0.4, 0.9, 1], led: [[0.1, 0.9, 1], [0.8, 1, 0.2], [0.55, 0.25, 1], [1, 0.3, 0.8], [0.2, 1, 0.6]], deck: 0x4c4a66, booth: 0x2a1a66, boothRoof: 0xc7168e, canopy: 0x2a1a66, flags: [0x35e6ff, 0xff5ac0, 0xc7ff3a, 0x6a3ad0] },
  { top: 0x2f64b8, side: 0x244b88, rail: 0xf4f4f0, mast: 0xf4f4f0, brace: 0xdfe6ee, loops: [0xf4f4f0, 0x7aa6e0, 0x2f64b8, 0xf4f4f0, 0xcfe0f6], car: 0xf4f4f0, stripe: 0x2f64b8, seat: 0x2b3a58, board: 0x1d3a70, trim: 0xcfe0f6,
    sign: [1, 0.84, 0.5], bulb: [1, 0.85, 0.5], led: [[1, 0.85, 0.5], [0.75, 0.88, 1], [1, 1, 0.9], [0.5, 0.7, 1], [1, 0.9, 0.7]], deck: 0x8d9296, booth: 0xf2f0e6, boothRoof: 0x2f64b8, canopy: 0xf2f0e6, flags: [0x2f64b8, 0xf4f4f0, 0x7aa6e0, 0xf4f4f0] },
];

const PI = Math.PI;
const LOOP = { r: 4.7, p: 0.66, dz: 1.1, n: 26, x0: 0.6, y0: 1.8, z0: -12, count: 5 };
const ZST = 12.6;

export function loopingControls() {
  const c = [];
  c.push([-12, 1.5, ZST], [-17.5, 1.5, ZST]);
  c.push(...arcPoints(-17.5, ZST - 3.5, 3.5, PI / 2, PI, 1.5, 3.2));
  const lx = () => -21;
  for (const q of [0.12, 0.3, 0.5, 0.7, 0.88]) c.push([lx(q), lerp(3.2, 35, q), lerp(ZST - 3.5, -11.5, q)]);
  c.push(...arcPoints(-18.5, -11.5, 2.5, PI, PI * 1.5, 35, 35).slice(0, 4));
  c.push([-15, 34.2, -14.0], [-12, 30.5, -13.8], [-9, 23.0, -13.3], [-6, 13.5, -12.6], [-3.4, 5.4, -12.2]);
  for (let k = 0; k < LOOP.count; k++) {
    const pts = loopPoints(LOOP.x0 + k * loopAdvance(LOOP.p), LOOP.y0, LOOP.z0 + k * LOOP.dz, LOOP.r, LOOP.p, LOOP.dz, LOOP.n);
    c.push(...(k === 0 ? pts : pts.slice(1)));
  }
  const xe = LOOP.x0 + LOOP.count * loopAdvance(LOOP.p); const ze = LOOP.z0 + LOOP.count * LOOP.dz;
  c.push(...arcPoints(xe, ze + 3.2, 3.2, -PI / 2, PI / 2, 1.8, 6.4).slice(1));
  const zr = ze + 6.4;
  c.push([18.6, 6.4, zr], [15.6, 4.8, zr], [12.8, 2.8, zr], [9.6, 2.2, zr], [6.6, 4.4, zr], [3.8, 5.4, zr], [1.4, 3.6, zr], [-1.0, 2.4, zr - 0.2]);
  c.push([-3.6, 2.0, 2.6], [-5.4, 1.7, 5.4], [-7.2, 1.55, 8.8], [-9, 1.5, 11.6]);
  // drop near-duplicates (arc ends)
  const out = [];
  for (const p of c) { const q = out[out.length - 1]; if (q && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 0.3) continue; out.push(p); }
  return out;
}

/* ------------------------------------------------------------------------------------------------------------------ cars */
function buildCar(b, near, ti, j, pal) {
  const P = b.P; const L = b.L; const first = j === 0;
  if (!near) {
    P.box(0, 0.62, 0, 1.5, 0.7, 2.7, pal.car, 32); P.box(0, 0.98, -0.3, 1.2, 0.34, 1.7, pal.seat, 0);
    if (first) P.box(0, 0.5, 1.45, 1.3, 0.45, 0.7, pal.stripe, 32);
    return;
  }
  P.box(0, 0.42, 0, 1.34, 0.22, 2.8, 0x44494d, 32);
  for (const sx of [-1, 1]) P.box(sx * 0.7, 0.8, 0, 0.1, 0.7, 2.7, pal.car, 0);
  P.box(0, 0.62, -1.38, 1.5, 0.8, 0.1, pal.car, 0);
  if (first) { P.quad([-0.75, 0.5, 1.9], [0.75, 0.5, 1.9], [0.7, 1.0, 1.35], [-0.7, 1.0, 1.35], pal.stripe); P.tri([-0.75, 0.5, 1.9], [-0.7, 1.0, 1.35], [-0.75, 0.5, 1.35], pal.car); P.tri([0.75, 0.5, 1.9], [0.7, 1.0, 1.35], [0.75, 0.5, 1.35], pal.car); P.box(0, 1.0, 1.1, 1.4, 0.1, 0.5, pal.car, 0); }
  else P.box(0, 0.62, 1.38, 1.5, 0.8, 0.1, pal.car, 0);
  P.box(0, 0.74, 0.55, 1.3, 0.1, 0.9, pal.stripe, 0);
  for (const z of [0.55, -0.55]) {
    for (const sx of [-0.34, 0.34]) { P.box(sx, 0.86, z - 0.15, 0.52, 0.12, 0.62, pal.seat, 0); P.box(sx, 1.28, z - 0.46, 0.52, 0.72, 0.12, pal.seat, 0); }
    P.tube([-0.5, 1.0, z + 0.1], [-0.35, 1.78, z - 0.3], 0.05, 0xcfd3d6, { sides: 3, flat: true }); P.tube([0.5, 1.0, z + 0.1], [0.35, 1.78, z - 0.3], 0.05, 0xcfd3d6, { sides: 3, flat: true });
    P.tube([-0.35, 1.78, z - 0.3], [0.35, 1.78, z - 0.3], 0.05, 0xcfd3d6, { sides: 3, flat: true });
  }
  if (first) { L.quad([-0.4, 0.75, 1.9], [-0.2, 0.75, 1.9], [-0.2, 0.83, 1.86], [-0.4, 0.83, 1.86], [1, 0.9, 0.6]); L.quad([0.2, 0.75, 1.9], [0.4, 0.75, 1.9], [0.4, 0.83, 1.86], [0.2, 0.83, 1.86], [1, 0.9, 0.6]); }
}

/* ------------------------------------------------------------------------------------------------------------------ static structure */
function buildStatic(b, cfg, near, sp, name, loopRanges) {
  const { pal, level, gold } = cfg; const P = b.P; const L = b.L; const handles = { lamps: [], led: pal.led, marks: [] }; const mk = (n) => handles.marks.push([n, Math.round(b.count / 3)]);
  padSlab(b, 55.2, 29.2, 0, 0);
  const list = near ? sp.resample({ maxStep: 1.8, maxAngle: 0.15, minStep: 0.3 }) : sp.resample({ maxStep: 3.6, maxAngle: 0.3, minStep: 0.5 });
  const fr = sp.frames(list);
  const loopOf = (s) => { for (let k = 0; k < loopRanges.length; k++) if (s >= loopRanges[k][0] - 0.05 && s <= loopRanges[k][1] + 0.05) return k; return -1; };
  const topCol = (i) => { const k = loopOf((list[i] + list[i + 1]) / 2); return k < 0 ? pal.top : pal.loops[k]; };
  const sideCol = (i) => { const k = loopOf((list[i] + list[i + 1]) / 2); return k < 0 ? pal.side : pal.loops[k]; };
  if (near) {
    girder(P, fr, { w: 1.35, h: 0.75, y: 0, top: topCol, side: sideCol });
    rails(P, fr, { gauge: 1.0, w: 0.14, h: 0.06, y: 0, col: pal.rail, walls: false });
  } else {
    girder(P, fr, { w: 1.4, h: 0.7, y: 0, top: topCol, side: sideCol });
  }
  mk('track');
  // supports: white lattice masts (near) / single tubes (far), a flag on each
  const pts = supportPoints(sp, near ? 6.6 : 9, 2.6, (f) => f.p[2] > 6.5 && f.p[1] < 6);
  pts.forEach(({ f }, i) => {
    const h = f.p[1] - 0.8; if (h < 1.5) return;
    if (near) {
      latticeMast(b, { cx: f.p[0], cz: f.p[2], y0: 0.3, y1: h, w0: Math.min(clamp(1.1 + h * 0.075, 1.2, 3.0), 2 * (14.8 - Math.abs(f.p[2])), 2 * (27.6 - Math.abs(f.p[0]))), w1: 0.8, panel: 4.2, chord: 0.24, brace: 0.1, chordCol: pal.mast, braceCol: pal.brace, ties: false });
      if (gold && h > 6) collar(b, f.p[0], h, f.p[2], 0.15);
    } else {
      P.tube([f.p[0], 0.3, f.p[2]], [f.p[0], h, f.p[2]], 0.28, pal.mast, { sides: 4, flat: true, r1: 0.16 });
    }
    P.box(f.p[0], f.p[1] - 0.95, f.p[2], 1.7, 0.18, 0.5, pal.mast, 0);
    if (level >= 2 || near) pennant(b, f.p[0] + 0.5, f.p[1] + 0.3, f.p[2] + 0.4, near ? 2.3 : 2.0, pal.flags[i % pal.flags.length], i % 2 ? 1 : -1, near ? 1.4 : 1.2);
  });
  mk('supports');
  // L3: neon outlines on the five loops (side walls) + the lift hill edges, chasing
  if (level >= 3) {
    loopRanges.forEach((rg, k) => {
      const sub = []; for (let i = 0; i < list.length; i++) if (list[i] >= rg[0] - 0.01 && list[i] <= rg[1] + 0.01) sub.push(fr[i]);
      if (sub.length < 2) return;
      for (const lat of [-0.72, 0.72]) handles.lamps.push(...ledWallRuns(L, sub, lat, -0.55, -0.15, near ? 2 : 2, pal.led[k % pal.led.length]).map((r) => ({ ...r, kind: 'loop', loop: k, side: lat > 0 ? 1 : 0, n: r.n })));
    });
  }
  mk('led');
  // station platform + canopy + sign gantry
  P.box(-14, 0.5, 14.0, 11, 0.4, 1.8, pal.deck, 32); P.box(-14, 0.72, 14.0, 10.8, 0.05, 1.6, 0xc3b79d, 0);
  for (const x of [-19, -9]) for (const z of [10.6, 14.6]) P.tube([x, 0.7, z], [x, 4.0, z], 0.11, pal.mast, { sides: 4, flat: true });
  P.box(-14, 4.15, 12.6, 11.4, 0.24, 4.8, pal.canopy, 32); P.box(-14, 4.35, 12.6, 11.6, 0.12, 5.0, pal.boothRoof, 32);
  if (near) { railing(b, [[-19, 11.4], [-9, 11.4]], 0.7, 0xe9d34a, { h: 1.0, step: 1.7 }); for (let q = 0; q < 18; q++) bulb(b, [-19.2 + q * 0.62, 4.06, 14.7], 0.18, pal.bulb); }
  if (level >= 2) {
    for (const x of [-19.2, -8.8]) latticeMast(b, { cx: x, cz: 14.3, y0: 0.3, y1: 8.4, w0: 0.9, w1: 0.7, panel: 2.1, chord: 0.12, brace: 0.06, chordCol: pal.mast, braceCol: pal.brace, ties: false });
    litSign(b, -14, 7.0, 14.4, 9.2, 2.1, name, pal, { near, gold });
    if (near) { festoon(b, [-19.2, 8.4, 14.3], [-24, 5.5, 8], 8, 0.5, pal.bulb); festoon(b, [-8.8, 8.4, 14.3], [-3, 4.0, 11.8], 8, 0.5, pal.bulb); }
  }
  mk('station+sign');
  ticketBooth(b, 9.5, 13.0, 0, pal, level, near, level >= 2);
  if (level >= 2) ticketBooth(b, 4.6, 13.0, 0, pal, level, near, false);
  if (near) queueRails(b, 1.8, 9.0, [9.6, 10.8], pal.trim);
  if (level >= 3) {
    sheep(b, 14.2, 11.6, -0.4, gold);
    if (near) { railing(b, [[-4, 14.6], [3, 14.6]], 0.3, pal.trim, { h: 1.0, step: 1.7 }); railing(b, [[11.5, 14.6], [20, 14.6]], 0.3, pal.trim, { h: 1.0, step: 1.7 }); }
  }
  patch(b, 12.2, 6.6, 27.2, 14.7, 0x6fa84a); patch(b, -4.0, 6.4, 10.5, 8.0, 0xc9b890);
  mk('booths+queue+sheep');
  // painted hoarding behind the loops, planters and lamp posts on the forecourt
  hoarding(b, pal, -26.5, 26.5, -14.7, 3.0, near);
  for (const x of near ? [-4, 2, 8, 14, 20, 25] : [0, 12, 24]) { P.box(x, 0.65, 14.3, 2.6, 0.7, 0.8, 0x7a5a3a, 0); for (let f = 0; f < (near ? 3 : 1); f++) P.sphere([x - 0.8 + f * 0.8, 1.25, 14.3], 0.42, 0x3f8a3a, 5, 3); }
  for (const x of [-4.5, 8, 22]) { P.tube([x, 0.3, 11.5], [x, 4.6, 11.5], 0.07, 0x3a3f44, { sides: 4, flat: true }); P.tube([x, 4.6, 11.5], [x + 0.6, 4.9, 11.5], 0.06, 0x3a3f44, { sides: 4, flat: true }); L.sphere([x + 0.7, 4.8, 11.5], 0.28, [1, 0.9, 0.65], 6, 4); }
  mk('hoarding+props');
  return handles;
}
function hoarding(b, pal, x0, x1, z, h, near) {
  const P = b.P; const w = x1 - x0; const n = Math.round(w / 4.4);
  P.box((x0 + x1) / 2, h / 2 + 0.3, z - 0.12, w, h, 0.24, 0x2a3a5a, 0);
  for (let i = 0; i < n; i++) {
    const xa = x0 + (i * w) / n + 0.1; const xb = x0 + ((i + 1) * w) / n - 0.1; const c = pal.loops[i % 5]; const cx = (xa + xb) / 2;
    P.quad([xa, 0.5, z + 0.02], [xb, 0.5, z + 0.02], [xb, h + 0.2, z + 0.02], [xa, h + 0.2, z + 0.02], 0x1a2640, 0x1a2640, c, c);
    P.fan([cx, h * 0.55 + 0.3, z + 0.04], [1.3, 0, 0], [0, 1.3, 0], c, 10); P.fan([cx, h * 0.55 + 0.3, z + 0.05], [0.85, 0, 0], [0, 0.85, 0], 0x1a2640, 10);
  }
  P.box((x0 + x1) / 2, h + 0.4, z - 0.05, w + 0.3, 0.22, 0.4, 0x3a3f44, 0);
}

function chase(K, geo, handles, t, k) {
  for (const h of handles.lamps) {
    const w = (((t * 1.5 - h.k / 6 + h.loop * 0.3) % 1) + 1) % 1; const f = 0.28 + 0.72 * Math.pow(1 - w, 2); const c = handles.led[h.loop % handles.led.length];
    K.setLamp(geo, h.s, h.n, [c[0] * f, c[1] * f, c[2] * f]);
  }
}

function build(opts = {}) {
  const T = window.THREE; const K = makeKit(T);
  const look = clamp(opts.look | 0, 0, 2); const level = clamp(opts.level | 0 || 1, 1, 4); const quality = opts.quality || 'medium';
  const pal = PAL[look]; const cfg = { pal, level, gold: level >= 4, look, quality };
  const sp = makeSpline(loopingControls(), { step: 0.14, bank: { gain: 3.0, max: 0.9, window: 3.5 } });
  const sL0 = sp.nearestS([-21, 3.2, ZST - 3.5], 0, 80); const sL1 = sp.nearestS([-20.2, 35, -11.5], sL0, sL0 + 60);
  // loop ranges (arc length of each trochoid loop)
  const loopRanges = [];
  for (let k = 0; k < LOOP.count; k++) {
    const a = loopPoints(LOOP.x0 + k * loopAdvance(LOOP.p), LOOP.y0, LOOP.z0 + k * LOOP.dz, LOOP.r, LOOP.p, LOOP.dz, 4);
    const s0 = sp.nearestS(a[0], sL1, sp.length); const s1 = sp.nearestS(a[4], sL1, sp.length); loopRanges.push([s0 + 0.2, s1 - 0.2]);
  }
  const run = makeRun(sp, { lifts: [[sL0, sL1, 3.2]], vStation: 1.8, aAccel: 1.4, aBrake: 3.2, eta: 0.5, aLat: 90, vMax: 12.5, vMin: 3.2, dwell: 8 });
  const name = nameOf('looping', opts.lang);
  const g = buildTrackRide({
    id: 'looping', T, K, sp, run, quality, look, level, footprint: { x: 27.6, zMin: -14.6, zMax: 14.8 }, height: 37, carRadius: 60, eyeOffset: [0, 1.3, 0.2],
    trains: [0, 1].map((i) => ({ cars: 4, spacing: 3.0, shift: (i * run.period) / 2, lift: 0.15 })),
    buildStatic: (b, near) => buildStatic(b, cfg, near, sp, name, loopRanges),
    buildCar: (b, near, ti, j) => buildCar(b, near, ti, j, pal),
    chase,
    extra: { loops: loopRanges.length },
  });
  return g;
}

export const MODELS = { looping: { build } };
export default MODELS;
