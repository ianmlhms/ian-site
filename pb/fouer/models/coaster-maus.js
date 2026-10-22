/* Schueberfouer Tycoon, W4b: the Wild Mouse (item `maus`, pitch L 30 x 18, DESIGN 3.3).
 * A lime tubular tower frame with five track levels, a purple single-rail ladder track that switches back and forth through flat hairpins, small white cars
 * with a striped nose, a giant corn-cob mascot (L3), lit lettered sign (L2), LED chase on the track and the frame (L3), gold trim (L4). */
import { makeKit, rng, clamp, lerp, bulb, festoon, railing, padSlab, pennant, latticeMast } from './big-kit.js';
import { makeSpline, makeRun, arcPoints, girder, rails, sleepers, ledRuns, buildTrackRide, supportPoints } from './coaster-kit.js';
import { litSign, ticketBooth, queueRails, nameOf, GOLD, DARK, STEEL, collar } from './coaster-props.js';

const PAL = [
  { frame: 0xc2e62c, track: 0x7b34ba, trackTop: 0x9d5cd8, sleeper: 0x6a2aa2, car: 0xf4f2ea, nose: [0xd8262b, 0xf4f2ea], seat: 0x2b2e33, deck: 0x8b9094, booth: 0xefe3c2, boothRoof: 0xa2272b, trim: 0xe7b53b, board: 0x2a1646,
    sign: [1, 0.62, 0.12], bulb: [1, 0.85, 0.5], led: [[1, 0.55, 0.1], [0.75, 0.3, 1]], cob: 0xf4c830, cobB: 0xe2a416, leaf: 0x58a838, flag: 0xd8262b, canopy: 0xefe3c2 },
  { frame: 0x20e2c8, track: 0xd81d96, trackTop: 0xff5ac0, sleeper: 0xb0157a, car: 0x2a1f60, nose: [0x35e6ff, 0x2a1f60], seat: 0x0f0a30, deck: 0x4c4a66, booth: 0x2a1a66, boothRoof: 0xc7168e, trim: 0x40e8ff, board: 0x120a30,
    sign: [0.2, 0.95, 1], bulb: [0.4, 0.9, 1], led: [[0.1, 0.9, 1], [1, 0.1, 0.8]], cob: 0xff7ad0, cobB: 0xc83ca0, leaf: 0x2fd0a0, flag: 0x35e6ff, canopy: 0x2a1a66 },
  { frame: 0xf4f4f0, track: 0x2f64b8, trackTop: 0x5c8fe0, sleeper: 0x244b88, car: 0xf4f4f0, nose: [0x2f64b8, 0xf4f4f0], seat: 0x2b3a58, deck: 0x8d9296, booth: 0xf2f0e6, boothRoof: 0x2f64b8, trim: 0xcfe0f6, board: 0x1d3a70,
    sign: [1, 0.84, 0.5], bulb: [1, 0.85, 0.5], led: [[1, 0.82, 0.5], [0.75, 0.88, 1]], cob: 0xf4f2ea, cobB: 0xc9d8ee, leaf: 0x4a86d0, flag: 0x2f64b8, canopy: 0xf2f0e6 },
];

const ZS = 6.4; const Z1 = -4.0; const Z2 = 2.4; const R2 = (Z2 - Z1) / 2; const R1 = (ZS - Z1) / 2; const XE2 = 9.2; const XE1 = 8.6;
const TIER_Y = [4.6, 8.4, 12.2, 15.9, 19.4];
const PI = Math.PI;

/** a straight lane with a dive in the middle (the hairpins stay flat) */
function lane(xa, xb, z, ya, yb) {
  const out = []; const sm = (t) => { const q = clamp(t, 0, 1); return q * q * (3 - 2 * q); };
  for (const f of [0.14, 0.32, 0.5, 0.68, 0.86]) out.push([lerp(xa, xb, f), lerp(ya, yb, sm((f - 0.2) / 0.6)), z]);
  return out;
}
/** Five stacked levels of wide hairpins (each level a long lane, a half circle, the next lane under it), a diagonal lift and a big hairpin down to the station */
export function mausControls() {
  const c = [];
  c.push([-7.6, 1.4, ZS], [-6.0, 1.4, ZS], [-4.6, 1.55, ZS], [-1.6, 5.4, ZS], [1.8, 9.9, ZS], [5.2, 14.0, ZS]);
  c.push(...arcPoints(XE1, (ZS + Z1) / 2, R1, PI / 2, -PI / 2, 18.2, 18.2));
  c.push(...lane(XE1, -XE2, Z1, 18.2, 14.6));
  c.push(...arcPoints(-XE2, (Z1 + Z2) / 2, R2, -PI / 2, -PI * 1.5, 14.6, 14.6));
  c.push(...lane(-XE2, XE2, Z2, 14.6, 11.0));
  c.push(...arcPoints(XE2, (Z1 + Z2) / 2, R2, PI / 2, -PI / 2, 11.0, 11.0));
  c.push(...lane(XE2, -XE2, Z1, 11.0, 7.4));
  c.push(...arcPoints(-XE2, (Z1 + Z2) / 2, R2, -PI / 2, -PI * 1.5, 7.4, 7.4));
  c.push(...lane(-XE2, XE2, Z2, 7.4, 4.6));
  c.push(...arcPoints(XE2, (Z1 + Z2) / 2, R2, PI / 2, -PI / 2, 4.6, 4.6));
  c.push(...lane(XE2, -XE1, Z1, 4.6, 2.5));
  c.push(...arcPoints(-XE1, (ZS + Z1) / 2, R1, -PI / 2, -PI * 1.5, 2.5, 1.4));
  const out = [];
  for (const p of c) { const q = out[out.length - 1]; if (q && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 0.25) continue; out.push(p); }
  return out;
}

/* ------------------------------------------------------------------------------------------------------------------ cars */
function buildCar(b, near, pal) {
  const P = b.P; const L = b.L;
  if (!near) {
    P.box(0, 0.55, -0.1, 1.3, 0.6, 3.0, pal.car, 32); P.box(0, 0.9, 0.9, 1.2, 0.3, 1.0, pal.nose[0], 32);
    P.box(0, 1.0, -0.6, 1.05, 0.55, 0.3, pal.seat, 0);
    return;
  }
  P.box(0, 0.42, 0, 1.34, 0.22, 3.2, 0x44494d, 32);                         // chassis
  P.box(-0.62, 0.86, -0.15, 0.1, 0.64, 2.75, pal.car, 0); P.box(0.62, 0.86, -0.15, 0.1, 0.64, 2.75, pal.car, 0);   // side shells
  P.box(0, 0.62, -1.4, 1.34, 0.9, 0.12, pal.car, 0);                         // tail
  // nose: sloped, four stripes
  for (let q = 0; q < 4; q++) { const x0 = -0.66 + q * 0.33; const col = pal.nose[q % 2]; P.quad([x0, 0.5, 1.6], [x0 + 0.33, 0.5, 1.6], [x0 + 0.33, 1.05, 1.1], [x0, 1.05, 1.1], col); }
  P.quad([-0.66, 1.05, 1.1], [0.66, 1.05, 1.1], [0.62, 1.0, 0.8], [-0.62, 1.0, 0.8], pal.car);
  P.tri([-0.66, 0.5, 1.6], [-0.66, 1.05, 1.1], [-0.66, 0.5, 1.1], pal.car); P.tri([0.66, 0.5, 1.6], [0.66, 1.05, 1.1], [0.66, 0.5, 1.1], pal.car);
  // two benches with backs, lap bars
  for (const z of [0.25, -0.8]) { P.box(0, 0.78, z, 1.05, 0.14, 0.62, pal.seat, 0); P.box(0, 1.14, z - 0.3, 1.05, 0.6, 0.1, pal.seat, 0); P.tube([-0.5, 1.0, z + 0.4], [0.5, 1.0, z + 0.4], 0.04, 0xcfd3d6, { sides: 4, flat: true }); }
  L.quad([-0.3, 0.75, 1.52], [-0.14, 0.75, 1.52], [-0.14, 0.82, 1.5], [-0.3, 0.82, 1.5], [1, 0.9, 0.6]); L.quad([0.14, 0.75, 1.52], [0.3, 0.75, 1.52], [0.3, 0.82, 1.5], [0.14, 0.82, 1.5], [1, 0.9, 0.6]);
}

/* ------------------------------------------------------------------------------------------------------------------ the giant corn-cob mascot */
function cob(b, x, z, ry, pal, gold, near) {
  const P = b.P; const sd = near ? 12 : 8;
  b.place([x, 0.3, z], ry, 0, 0, 1.15);
  P.cylY(0, 0, 0, 1.25, 1.25, 0.4, gold ? GOLD : 0x8a4a3a, 10);
  P.stripedTube([0, 0.4, 0], [0, 1.9, 0], 1.0, pal.cob, pal.cobB, { sides: sd, rowLen: 0.4, spiral: 1, r1: 1.28 });
  P.stripedTube([0, 1.9, 0], [0, 4.1, 0], 1.28, pal.cob, pal.cobB, { sides: sd, rowLen: 0.4, spiral: 1, r1: 0.7 });
  P.tube([0, 4.1, 0], [0, 4.75, 0], 0.7, pal.cob, { sides: sd, r1: 0.12 });
  for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; const c = Math.cos(a); const s2 = Math.sin(a); P.tri([c * 0.5, 0.6, s2 * 0.5], [c * 2.2, 2.9, s2 * 2.2], [-s2 * 0.7 + c * 0.5, 0.6, c * 0.7 + s2 * 0.5], pal.leaf); P.tri([c * 0.5, 0.6, s2 * 0.5], [c * 2.2, 2.9, s2 * 2.2], [s2 * 0.7 + c * 0.5, 0.6, -c * 0.7 + s2 * 0.5], pal.leaf); }
  for (const sx of [-1, 1]) { P.sphere([sx * 0.46, 3.0, 1.0], 0.46, 0xffffff, 8, 6); P.sphere([sx * 0.46 + sx * 0.02, 2.98, 1.38], 0.2, 0x1d1d22, 6, 4); P.tube([sx * 0.0 + sx * 0.1, 3.55, 1.0], [sx * 0.9, 3.9, 1.0], 0.05, 0x7a2a22, { sides: 4, flat: true }); }
  for (let q = 0; q < 7; q++) { const a = -0.9 + q * 0.3; P.box(Math.sin(a) * 0.7, 2.15 - Math.cos(a) * 0.25 + 0.2, 1.12, 0.22, 0.12, 0.14, 0x7a2a22, 0); }
  for (const sx of [-1, 1]) { P.tri([sx * 0.1, 4.7, 0], [sx * 1.1, 6.0, 0.2], [sx * 0.35, 4.5, 0.3], pal.leaf); }
  P.tri([-0.1, 4.7, 0], [0.1, 6.5, 0.1], [0.0, 4.5, 0.3], pal.leaf);
  b.pop();
}
/** a slim lattice pylon with orange bulb lines up its four chords (the tower next to the ride in the photo) */
function pylon(b, x, z, h, pal, near) {
  latticeMast(b, { cx: x, cz: z, y0: 0.3, y1: h, w0: 1.7, w1: 0.8, panel: near ? 2.4 : 5, chord: 0.16, brace: 0.07, chordCol: 0xdcdfe2, braceCol: 0xc4c8cc, ties: false });
  const SX = [-1, 1, 1, -1]; const SZ = [-1, -1, 1, 1];
  for (let k = 0; k < 4; k++) {
    if (near) { for (let q = 0; q < Math.round(h / 0.9); q++) { const y = 0.6 + q * 0.9; const w = lerp(1.7, 0.8, y / h) / 2; bulb(b, [x + SX[k] * (w + 0.06), y, z + SZ[k] * (w + 0.06)], 0.16, pal.bulb); } }
    else { const w0 = 0.85; b.L.quad([x + SX[k] * w0 - 0.05, 0.4, z + SZ[k] * w0], [x + SX[k] * 0.4 + 0.05, h, z + SZ[k] * 0.4], [x + SX[k] * 0.4 - 0.05, h, z + SZ[k] * 0.4], [x + SX[k] * w0 + 0.05, 0.4, z + SZ[k] * w0], pal.bulb); }
  }
  b.L.sphere([x, h + 0.35, z], 0.3, [1, 0.5, 0.1], 6, 4);
}

/* ------------------------------------------------------------------------------------------------------------------ static structure */
function buildStatic(b, cfg, near, sp, frames, name) {
  const { pal, level, gold } = cfg; const P = b.P; const L = b.L; const handles = { lamps: [] };
  padSlab(b, 29.2, 17.4, 0, 0.0);
  // tower frame: five columns x two rows, beams at the five tiers, X braces in the end bays
  const XS = [-14.2, -7.1, 0, 7.1, 14.2]; const ZSR = [-6.2, 4.4]; const topY = 19.7;
  const sides = near ? 6 : 4;
  for (const x of XS) for (const z of ZSR) {
    P.tube([x, 0.3, z], [x, topY, z], 0.27, pal.frame, { sides, flat: true });
    if (gold && near) for (const y of TIER_Y) collar(b, x, y, z, 0.27);
  }
  const tiers = near ? TIER_Y : [TIER_Y[1], TIER_Y[3]];
  for (const y of tiers) {
    for (const z of ZSR) P.tube([XS[0], y, z], [XS[4], y, z], 0.12, pal.frame, { sides: 4, flat: true });
    for (const x of near ? XS : [XS[0], XS[4]]) P.tube([x, y, ZSR[0]], [x, y, ZSR[1]], 0.1, pal.frame, { sides: 4, flat: true });
  }
  for (let i = 0; i + 1 < tiers.length; i++) {
    for (const [xa, xb] of [[XS[0], XS[1]], [XS[3], XS[4]]]) for (const z of ZSR) { P.tube([xa, tiers[i], z], [xb, tiers[i + 1], z], 0.08, pal.frame, { sides: 3, flat: true }); if (near) P.tube([xb, tiers[i], z], [xa, tiers[i + 1], z], 0.08, pal.frame, { sides: 3, flat: true }); }
  }
  P.tube([XS[0], topY, ZSR[0]], [XS[4], topY, ZSR[0]], 0.1, pal.frame, { sides: 4, flat: true }); P.tube([XS[0], topY, ZSR[1]], [XS[4], topY, ZSR[1]], 0.1, pal.frame, { sides: 4, flat: true });
  // track
  const list = near ? sp.resample({ maxStep: 0.85, maxAngle: 0.13 }) : sp.resample({ maxStep: 2.4, maxAngle: 0.34 });
  const fr = sp.frames(list);
  if (near) {
    rails(P, fr, { gauge: 1.0, w: 0.2, h: 0.24, y: -0.18, col: pal.trackTop, side: pal.track });
    sleepers(P, fr, { w: 1.3, t: 0.2, y: -0.2, col: pal.sleeper, every: 1 });
    girder(P, fr, { w: 0.46, h: 0.44, y: -0.2, top: pal.track, side: pal.track });
  } else {
    girder(P, fr, { w: 1.4, h: 0.6, y: 0, top: pal.trackTop, side: pal.track });
  }
  // posts from the track to the ground (or the tier beam below)
  for (const { f } of supportPoints(sp, near ? 6.2 : 8, 1.6)) P.tube([f.p[0], 0.3, f.p[2]], [f.p[0], f.p[1] - 0.35, f.p[2]], near ? 0.085 : 0.12, pal.frame, { sides: 3, flat: true });
  // LED outlines (L3): two ribbons along the track, chasing; four vertical columns
  if (level >= 3) {
    for (const lat of [-0.66, 0.66]) handles.lamps.push(...ledRuns(L, fr, lat, 0.06 + (near ? 0 : 0.35), 0.16, near ? 5 : 3, pal.led[0]).map((r) => ({ ...r, kind: 'track', side: lat > 0 ? 1 : 0 })));
    for (const y of [TIER_Y[1], TIER_Y[3]]) for (const z of ZSR) for (let q = 0; q < (near ? 8 : 4); q++) { const n0 = b.count; const nn = near ? 8 : 4; const x0 = XS[0] + (q * (XS[4] - XS[0])) / nn; const x1 = XS[0] + ((q + 0.92) * (XS[4] - XS[0])) / nn; L.quad([x0, y + 0.13, z - 0.06], [x1, y + 0.13, z - 0.06], [x1, y + 0.13, z + 0.06], [x0, y + 0.13, z + 0.06], pal.led[0]); handles.lamps.push({ s: n0, n: b.count - n0, k: q, kind: 'col' }); }
    for (const [x, z] of [[XS[0], ZSR[0]], [XS[0], ZSR[1]], [XS[4], ZSR[0]], [XS[4], ZSR[1]]]) {
      const N = near ? 10 : 5; for (let q = 0; q < N; q++) { const n0 = b.count; const y0 = 1 + (q * 18) / N; L.quad([x - 0.05, y0, z + 0.21], [x + 0.05, y0, z + 0.21], [x + 0.05, y0 + 1.5, z + 0.21], [x - 0.05, y0 + 1.5, z + 0.21], pal.led[1]); handles.lamps.push({ s: n0, n: b.count - n0, k: q, kind: 'col' }); }
    }
  }
  // station: platform, canopy, rails
  P.box(-6.8, 0.55, 7.95, 5.8, 0.5, 1.7, pal.deck, 32); P.box(-6.8, 0.82, 7.95, 5.6, 0.05, 1.5, 0xc3b79d, 0);
  for (const x of [-9.4, -4.2]) for (const z of [5.4, 8.7]) P.tube([x, 0.8, z], [x, 3.6, z], 0.1, pal.frame, { sides: 4, flat: true });
  P.box(-6.8, 3.75, 7.0, 6.0, 0.22, 3.8, pal.canopy, 32); P.box(-6.8, 3.95, 7.0, 6.2, 0.12, 4.0, pal.boothRoof, 32);
  if (near) { railing(b, [[-9.4, 7.0], [-4.2, 7.0]], 0.8, 0xe9d34a, { h: 1.0, step: 1.7 }); for (let q = 0; q < 10; q++) bulb(b, [-9.2 + q * 0.58, 3.66, 9.0], 0.17, pal.bulb); }
  // booth, queue rails
  ticketBooth(b, 7.4, 7.0, 0, pal, level, near, level >= 2);
  if (level >= 2) ticketBooth(b, 3.6, 7.4, 0, pal, level, near, false);
  if (near) queueRails(b, -2.4, 2.4, [7.2, 8.2], pal.trim);
  // L2: lit lettered sign above the station, pennants on the frame, festoons
  if (level >= 2) {
    litSign(b, -6.8, 5.05, 9.0, 6.2, 1.5, name, pal, { near, gold });
    for (const x of near ? XS : [XS[0], XS[4]]) for (const z of ZSR) pennant(b, x, topY, z, 2.0, pal.flag, x > 0 ? -1 : 1);
    if (near) {
      festoon(b, [-9.4, 3.7, 8.7], [-14.2, 12, 4.4], 9, 0.7, pal.bulb); festoon(b, [-4.2, 3.7, 8.7], [0, 8.4, 4.4], 9, 0.6, pal.bulb);
      for (let q = 0; q < 30; q++) bulb(b, [-13.5 + q * 0.93, topY + 0.1, 4.4], 0.2, pal.bulb);
    }
  }
  if (level >= 2) pylon(b, 11.6, -7.2, 23, pal, near);
  // L3: the mascot, a railing along the front of the pad
  if (level >= 3) {
    cob(b, 11.9, 6.1, -0.35, pal, gold, near);
    if (near) { railing(b, [[-14.2, 8.55], [-12.4, 8.55]], 0.3, pal.trim, { h: 1.0, step: 1.7 }); railing(b, [[-1.5, 8.55], [1.4, 8.55]], 0.3, pal.trim, { h: 1.0, step: 1.7 }); railing(b, [[5.8, 8.55], [9.2, 8.55]], 0.3, pal.trim, { h: 1.0, step: 1.7 }); }
  }
  if (gold) { P.sphere([XS[2], topY + 0.6, ZSR[0]], 0.45, GOLD, 8, 5); P.tube([XS[2], topY, ZSR[0]], [XS[2], topY + 0.4, ZSR[0]], 0.1, GOLD, { sides: 6 }); }
  return handles;
}

function chase(K, geo, handles, t, k) {
  for (const h of handles.lamps) {
    if (h.kind === 'track') { const w = (((t * 1.6 - h.k / 7) % 1) + 1) % 1; const f = 0.3 + 0.7 * Math.pow(1 - w, 2); const c = handles.led[(h.k + h.side) % 2]; K.setLamp(geo, h.s, h.n, [c[0] * f, c[1] * f, c[2] * f]); }
    else { const w = (((t * 0.9 - h.k / 10) % 1) + 1) % 1; const f = 0.25 + 0.75 * Math.pow(1 - w, 2); const c = handles.led[1]; K.setLamp(geo, h.s, h.n, [c[0] * f, c[1] * f, c[2] * f]); }
  }
}

/* ------------------------------------------------------------------------------------------------------------------ model */
function build(opts = {}) {
  const T = window.THREE; const K = makeKit(T);
  const look = clamp(opts.look | 0, 0, 2); const level = clamp(opts.level | 0 || 1, 1, 4); const quality = opts.quality || 'medium';
  const pal = PAL[look]; const cfg = { pal, level, gold: level >= 4, look, quality };
  const sp = makeSpline(mausControls(), { step: 0.12 });
  const sL0 = sp.nearestS([-4.6, 1.55, ZS], 0, 60); const sL1 = sp.nearestS([XE1, 18.2, ZS], sL0, sL0 + 40);
  const run = makeRun(sp, { lifts: [[sL0, sL1, 3.4]], vStation: 1.6, aAccel: 1.2, aBrake: 3.0, eta: 0.74, aLat: 6.5, vMax: 16, vMin: 2.0, dwell: 7 });
  const name = nameOf('maus', opts.lang);
  const handlesRef = {};
  const g = buildTrackRide({
    id: 'maus', T, K, sp, run, quality, look, level, footprint: { x: 14.5, zMin: -7.0, zMax: 8.8 }, height: 21.5, carRadius: 30, eyeOffset: [0, 1.25, 0.2],
    trains: [0, 1, 2].map((i) => ({ cars: 1, spacing: 0, shift: (i * run.period) / 3, lift: 0.1 })),
    buildStatic: (b, near) => { const h = buildStatic(b, cfg, near, sp, null, name); h.led = pal.led; return h; },
    buildCar: (b, near) => buildCar(b, near, pal),
    chase,
  });
  g.userData.parts.pal = pal;
  return g;
}

export const MODELS = { maus: { build } };
export default MODELS;
