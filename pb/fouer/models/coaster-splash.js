/* Schueberfouer Tycoon, W4b: the log flume (item `splash`, pitch L 30 x 18, DESIGN 3.3).
 * A closed water channel with three barge-shaped boats: station, conveyor lift up a yellow timber A-frame trestle, a turn at the top, the chute, a splash pool
 * with spray (CPU-skinned droplets and a ripple ring), a painted Polynesian backdrop, thatched station, tiki totems and palms.  Boats follow the spline by arc length. */
import { makeKit, rng, clamp, lerp, bulb, festoon, railing, padSlab, pennant, sheep, pixelText } from './big-kit.js';
import { makeSpline, makeRun, arcPoints, girder, strip, wall, ledWallRuns, buildTrackRide, supportPoints, v3norm } from './coaster-kit.js';
import { litSign, ticketBooth, nameOf, GOLD, DARK, collar } from './coaster-props.js';

const PAL = [
  { water: 0x3f98d8, waterB: 0x5fb4ec, foam: 0xeaf6fc, trough: 0x7a5636, conv: 0x6c7480, rib: 0xe0b33a, timber: 0xd9a93a, timberB: 0xb88a28, hull: 0x5a3a28, hullBand: 0xd8a24a, panel: [0x2cb8b0, 0xe8742a, 0xf4f0e0], seat: 0xb89463,
    thatch: 0xa07a3a, thatchB: 0x82602a, deck: 0x8b6a46, post: 0x6a4a2e, board: 0x1a3a50, trim: 0xe7b53b, sign: [1, 0.8, 0.3], bulb: [1, 0.85, 0.5], led: [0.3, 0.8, 1], led2: [1, 0.7, 0.2], booth: 0xefe3c2, boothRoof: 0xa2272b,
    mural: [0x6ac6ee, 0x2a8ed0, 0xf4f6fa, 0xf2c24a, 0x3aa04a, 0xe8742a, 0xa83a2a], palm: 0x2f9a48, rock: 0x8a8478, flag: 0xe8742a },
  { water: 0x2a6ae0, waterB: 0x4ae6ff, foam: 0xe6e0ff, trough: 0x3a2a8c, conv: 0x3a3a5a, rib: 0x35e6ff, timber: 0xc7168e, timberB: 0x8a1060, hull: 0x2a1f60, hullBand: 0x35e6ff, panel: [0x35e6ff, 0xff5ac0, 0xe6e0ff], seat: 0x6a5ab0,
    thatch: 0x6a3ad0, thatchB: 0x4a22a0, deck: 0x5a4b9a, post: 0x3a2a8c, board: 0x120a30, trim: 0x40e8ff, sign: [0.2, 0.95, 1], bulb: [0.4, 0.9, 1], led: [0.1, 0.9, 1], led2: [1, 0.1, 0.8], booth: 0x2a1a66, boothRoof: 0xc7168e,
    mural: [0x2a1a70, 0x4a2fd0, 0x35e6ff, 0xff5ac0, 0x35ff9a, 0xc7ff3a, 0x6a3ad0], palm: 0x35ff9a, rock: 0x5a4b9a, flag: 0x35e6ff },
  { water: 0x4a88d0, waterB: 0x7ab0e8, foam: 0xf4f8fc, trough: 0x2f64b8, conv: 0x6a7480, rib: 0xf4f4f0, timber: 0xf4f4f0, timberB: 0xcfdcec, hull: 0x2f64b8, hullBand: 0xf4f4f0, panel: [0xf4f4f0, 0x7aa6e0, 0xf2c24a], seat: 0xcfdcec,
    thatch: 0xcfdcec, thatchB: 0x7aa6e0, deck: 0x8d9296, post: 0x244b88, board: 0x1d3a70, trim: 0xcfe0f6, sign: [1, 0.84, 0.5], bulb: [1, 0.85, 0.5], led: [0.75, 0.88, 1], led2: [1, 0.85, 0.5], booth: 0xf2f0e6, boothRoof: 0x2f64b8,
    mural: [0xb8d4f0, 0x7aa6e0, 0xf4f6fa, 0xf2c24a, 0x2f64b8, 0xf4f4f0, 0x244b88], palm: 0x4a86d0, rock: 0x9aa4b0, flag: 0x2f64b8 },
];

const PI = Math.PI;
const ZF = 5.0; const ZB = -5.8; const XL = -13.5; const RC = 2.0; const WATER_Y = 1.1; const TOP_Y = 12.6;
export const SPLASH_IMPACT = [5.5, 1.1, 2.4];

export function splashControls() {
  const c = [];
  c.push([-3, WATER_Y, ZF], [-7, WATER_Y, ZF], [-10, WATER_Y, ZF]);
  c.push(...arcPoints(-11.5, ZF - RC, RC, PI / 2, PI, WATER_Y, WATER_Y));
  c.push([XL, WATER_Y, 1.0], [XL, WATER_Y, -1.6]);
  c.push(...arcPoints(-11.5, ZB + RC, RC, PI, PI * 1.5, WATER_Y, WATER_Y));
  c.push([-11.0, WATER_Y, ZB], [-8.2, 2.8, ZB], [-5.0, 5.6, ZB], [-1.8, 8.6, ZB], [1.4, 11.6, ZB]);
  c.push(...arcPoints(3.0, ZB + 1.8, 1.8, -PI / 2, 0, TOP_Y, TOP_Y).slice(0, 4));
  c.push([5.5, 11.6, -2.4], [5.5, 9.0, -0.8], [5.5, 5.0, 0.8], [5.5, 2.0, 2.0]);
  c.push(...arcPoints(3.5, 3.0, 2.0, 0, PI / 2, WATER_Y, WATER_Y).slice(0, 3));
  c.push([1.5, WATER_Y, ZF]);
  const out = [];
  for (const p of c) { const q = out[out.length - 1]; if (q && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 0.35) continue; out.push(p); }
  return out;
}

/* ------------------------------------------------------------------------------------------------------------------ boats and spray */
function buildBoat(b, near, pal) {
  const P = b.P; b.place([0, 0, 0], 0, 0, 0, 1.3);
  const st = [[-1.85, 0.78, 0.3, 0.95], [-0.9, 0.9, 0.12, 0.95], [0.5, 0.9, 0.12, 0.95], [1.5, 0.66, 0.2, 1.25], [2.05, 0.18, 0.5, 1.6]];     // z, half width, bottom y, rim y
  for (let i = 0; i + 1 < st.length; i++) {
    const a = st[i]; const c = st[i + 1];
    for (const sg of [-1, 1]) {
      P.quad([sg * a[1], a[2], a[0]], [sg * a[1], a[3], a[0]], [sg * c[1], c[3], c[0]], [sg * c[1], c[2], c[0]], pal.hull);
      P.quad([sg * a[1], a[3] - 0.18, a[0]], [sg * a[1], a[3], a[0]], [sg * c[1], c[3], c[0]], [sg * c[1], c[3] - 0.18, c[0]], pal.hullBand);
      P.quad([sg * (a[1] - 0.1), a[2] + 0.1, a[0]], [sg * (a[1] - 0.1), a[3] - 0.04, a[0]], [sg * (c[1] - 0.1), c[3] - 0.04, c[0]], [sg * (c[1] - 0.1), c[2] + 0.1, c[0]], 0x3a2418);
    }
    P.quad([-a[1] * 0.8, a[2], a[0]], [a[1] * 0.8, a[2], a[0]], [c[1] * 0.8, c[2], c[0]], [-c[1] * 0.8, c[2], c[0]], 0x2a1c12);
  }
  P.quad([-0.78, 0.3, -1.85], [0.78, 0.3, -1.85], [0.78, 0.95, -1.85], [-0.78, 0.95, -1.85], pal.hull);
  // painted Polynesian panels on the sides (diamonds)
  for (const sg of [-1, 1]) for (let q = 0; q < 3; q++) { const z = -0.6 + q * 0.75; const col = pal.panel[q % 3]; P.quad([sg * 0.925, 0.52, z - 0.28], [sg * 0.925, 0.52 + 0.0, z + 0.28], [sg * 0.925, 0.85, z + 0.28], [sg * 0.925, 0.85, z - 0.28], col); }
  for (const z of [-0.55, 0.45]) { P.box(0, 0.48, z, 1.35, 0.1, 0.5, pal.seat, 0); P.box(0, 0.7, z - 0.28, 1.35, 0.34, 0.08, pal.seat, 0); }
  if (near) { P.box(0, 0.62, 1.15, 1.2, 0.06, 0.4, pal.hullBand, 0); for (const sg of [-1, 1]) P.tube([sg * 0.55, 0.9, 0.7], [sg * 0.55, 1.05, 0.2], 0.03, 0xcfd3d6, { sides: 3, flat: true }); }
  b.pop();
}
const DROPS = 16;
function buildDrop(b, kind, pal) {
  const P = b.P;
  if (kind === 'ring') { P.ring([0, 0, 0], [0, 1, 0], 0.7, 1.0, pal.foam, 18); return; }
  const s = 0.17; P.quad([-s, 0, 0], [s, 0, 0], [s, 2 * s, 0], [-s, 2 * s, 0], pal.foam); P.quad([0, 0, -s], [0, 0, s], [0, 2 * s, s], [0, 2 * s, -s], pal.foam);
}

/* ------------------------------------------------------------------------------------------------------------------ painted backdrop, palms, tikis */
function backdrop(b, pal, x0, x1, z, h, name, near) {
  const P = b.P; const m = pal.mural; const w = x1 - x0;
  P.box((x0 + x1) / 2, h / 2 + 0.2, z - 0.1, w, h, 0.2, pal.trough, 0);
  const gl = P;
  gl.quad([x0, 0.4, z + 0.02], [x1, 0.4, z + 0.02], [x1, h + 0.2, z + 0.02], [x0, h + 0.2, z + 0.02], m[0]);
  gl.quad([x0, 0.4, z + 0.03], [x1, 0.4, z + 0.03], [x1, h * 0.55, z + 0.03], [x0, h * 0.55, z + 0.03], m[1]);
  const waves = Math.round(w / 2.6);
  for (let i = 0; i < waves; i++) { const cx = x0 + ((i + 0.5) * w) / waves; const wh = h * (0.28 + 0.12 * ((i * 31) % 5) / 5); P.tri([cx - 1.4, h * 0.45, z + 0.04], [cx + 1.1, h * 0.45, z + 0.04], [cx + 0.3, h * 0.45 + wh, z + 0.04], m[2]); P.tri([cx - 0.5, h * 0.45 + wh * 0.5, z + 0.05], [cx + 0.7, h * 0.45 + wh * 0.45, z + 0.05], [cx + 0.3, h * 0.45 + wh, z + 0.05], m[0]); }
  P.fan([x0 + w * 0.8, h * 0.78, z + 0.045], [h * 0.14, 0, 0], [0, h * 0.14, 0], m[3], 12);
  for (const fx of [0.12, 0.3, 0.88]) { const px = x0 + w * fx; P.tube([px, 0.4, z + 0.06], [px + 0.2, h * 0.7, z + 0.06], 0.1, 0x6a4a2e, { sides: 4, flat: true }); for (let k = 0; k < 5; k++) { const a = -0.9 + k * 0.45; P.tri([px + 0.2, h * 0.7, z + 0.07], [px + 0.2 + Math.cos(a) * 1.4, h * 0.7 + Math.sin(a) * 0.9 + 0.2, z + 0.07], [px + 0.2 + Math.cos(a) * 1.0, h * 0.7 + Math.sin(a) * 0.5 - 0.2, z + 0.07], m[4]); } }
  P.quad([x0, 0.4, z + 0.08], [x1, 0.4, z + 0.08], [x1, 1.1, z + 0.08], [x0, 1.1, z + 0.08], m[5]);
  // a big painted lettering panel (generic ride name) between the waves
  P.box(x0 + w * 0.62, h * 0.4, z + 0.04, w * 0.34, h * 0.3, 0.06, 0xe8742a, 0);
  pixelText(b, P, name, x0 + w * 0.62, h * 0.4 - 0.5, z + 0.1, (w * 0.3) / (name.length * 6), 0x1a5aa8, { merge: true });
  P.box((x0 + x1) / 2, h + 0.32, z - 0.04, w + 0.3, 0.2, 0.34, pal.trough, 0);
}
function palm(b, x, z, h, pal, near, lean = 0.3) {
  const P = b.P; const top = [x + lean * h * 0.4, h, z];
  P.tube([x, 0.3, z], top, 0.22, 0x8a6a42, { sides: near ? 6 : 4, r1: 0.13 });
  for (let k = 0; k < (near ? 7 : 5); k++) { const a = (k / (near ? 7 : 5)) * PI * 2; const dx = Math.cos(a); const dz = Math.sin(a); P.tri([top[0], top[1], top[2]], [top[0] + dx * 2.6, top[1] - 0.9, top[2] + dz * 2.6 + 0.3], [top[0] + dx * 1.3 - dz * 0.5, top[1] + 0.25, top[2] + dz * 1.3 + dx * 0.5], pal.palm); P.tri([top[0], top[1], top[2]], [top[0] + dx * 2.6, top[1] - 0.9, top[2] + dz * 2.6 + 0.3], [top[0] + dx * 1.3 + dz * 0.5, top[1] + 0.25, top[2] + dz * 1.3 - dx * 0.5], pal.palm); }
}
function tiki(b, x, z, ry, pal, gold) {
  const P = b.P; b.place([x, 0.3, z], ry);
  P.box(0, 1.4, 0, 0.9, 2.8, 0.9, 0x7a4a2a, 0);
  P.box(0, 2.0, 0.46, 0.9, 0.7, 0.08, pal.mural[5], 0); P.box(0, 1.0, 0.46, 0.9, 0.7, 0.08, gold ? GOLD : pal.mural[3], 0);
  for (const sx of [-1, 1]) P.sphere([sx * 0.2, 2.05, 0.52], 0.12, 0xffffff, 6, 4);
  P.box(0, 1.7, 0.5, 0.4, 0.14, 0.1, 0x2a1a12, 0); P.box(0, 2.9, 0.1, 1.1, 0.2, 1.1, pal.mural[6], 0);
  b.pop();
}

/* ------------------------------------------------------------------------------------------------------------------ static structure */
function buildStatic(b, cfg, near, sp, zones, name) {
  const { pal, level, gold } = cfg; const P = b.P; const L = b.L; const handles = { lamps: [], led: [pal.led, pal.led2] };
  padSlab(b, 29.2, 17.4, 0, 0, 0x9b958a);
  const list = near ? sp.resample({ maxStep: 1.0, maxAngle: 0.12, minStep: 0.3 }) : sp.resample({ maxStep: 2.6, maxAngle: 0.3, minStep: 0.5 });
  const fr = sp.frames(list);
  const zone = (i) => { const s = (list[i] + list[i + 1]) / 2; return s >= zones.lift[0] && s < zones.lift[1] ? 1 : s >= zones.chute[0] && s < zones.chute[1] ? 2 : 0; };
  const top = (i) => { const z = zone(i); return z === 1 ? pal.conv : z === 2 ? (i % 2 ? pal.foam : pal.waterB) : pal.water; };
  const side = (i) => { const z = zone(i); return z === 2 ? pal.foam : z === 1 ? pal.conv : pal.trough; };
  girder(P, fr, { w: 2.0, h: 0.8, y: 0, top, side, bottom: true, under: pal.trough });
  if (near) {   // conveyor ribs
    const ribs = fr.filter((_, i) => i + 1 < fr.length && zone(i) === 1);
    for (let i = 0; i + 1 < ribs.length; i += 2) { const a = ribs[i]; const d = 0.9; P.box(a.p[0], a.p[1] + 0.03, a.p[2], 1.7, 0.05, 0.14, pal.rib, 0); }
  }
  // the trestle: yellow timber A-frames under the lift and the chute
  for (const { f, s } of supportPoints(sp, near ? 3.0 : 4.5, 2.3, (ff) => ff.p[1] < 2.3)) {
    const h = f.p[1] - 0.5; const rl = Math.hypot(f.r[0], f.r[2]) || 1; const ux = f.r[0] / rl; const uz = f.r[2] / rl; const spread = 0.8 + h * 0.2;
    for (const sg of [-1, 1]) P.tube([f.p[0] + ux * sg * spread, 0.3, f.p[2] + uz * sg * spread], [f.p[0] + ux * sg * 0.8, f.p[1] - 0.5, f.p[2] + uz * sg * 0.8], near ? 0.13 : 0.17, pal.timber, { sides: 4, flat: true });
    P.box(f.p[0], f.p[1] - 0.5, f.p[2], Math.abs(uz) > 0.7 ? 0.3 : 2.1, 0.2, Math.abs(uz) > 0.7 ? 2.1 : 0.3, pal.timberB, 0);
    if (near && h > 2) { const y = 0.3 + h * 0.45; const sp2 = spread - (spread - 0.8) * 0.45; P.tube([f.p[0] - ux * sp2, y, f.p[2] - uz * sp2], [f.p[0] + ux * sp2, y, f.p[2] + uz * sp2], 0.06, pal.timberB, { sides: 3, flat: true }); P.tube([f.p[0] - ux * spread, 0.5, f.p[2] - uz * spread], [f.p[0] + ux * sp2, y, f.p[2] + uz * sp2], 0.05, pal.timberB, { sides: 3, flat: true }); }
  }
  // splash pool (a sunken blue rectangle with a timber rim)
  P.box(5.5, 0.92, 4.3, 8.4, 0.16, 6.4, pal.trough, 32);
  b.G([0.3, 0.6, 0.9]).quad([1.5, 1.045, 1.1], [9.5, 1.045, 1.1], [9.5, 1.045, 7.5], [1.5, 1.045, 7.5], pal.water);
  for (const [x, z, w, d] of [[5.5, 1.1, 8.4, 0.3], [5.5, 7.5, 8.4, 0.3], [9.7, 4.3, 0.3, 6.4]]) P.box(x, 1.25, z, w, 0.35, d, pal.trough, 0);
  P.box(1.4, 1.25, 1.3, 0.3, 0.35, 0.8, pal.trough, 0);
  strip(P, [{ p: [3.3, 1.07, 1.8], r: [1, 0, 0], u: [0, 1, 0], t: [0, 0, 1] }, { p: [3.3, 1.07, 6.9], r: [1, 0, 0], u: [0, 1, 0], t: [0, 0, 1] }], 0, 5.8, 1.1 - 1.07, pal.waterB);
  // station: platform, thatched roof, rails
  P.box(-3.4, 0.62, 7.5, 8.2, 0.64, 1.9, pal.deck, 32); P.box(-3.4, 0.96, 7.5, 8.0, 0.05, 1.7, 0xc9b18a, 0);
  for (const x of [-7.4, 0.6]) for (const z of [6.8, 8.4]) P.tube([x, 0.95, z], [x, 3.7, z], 0.1, pal.post, { sides: 4, flat: true });
  P.quad([-8.0, 3.45, 8.7], [1.2, 3.45, 8.7], [1.2, 4.6, 6.8], [-8.0, 4.6, 6.8], pal.thatch); P.quad([-8.0, 3.45, 4.9], [1.2, 3.45, 4.9], [1.2, 4.6, 6.8], [-8.0, 4.6, 6.8], pal.thatchB);
  P.tri([-8.0, 3.45, 8.7], [-8.0, 3.45, 4.9], [-8.0, 4.6, 6.8], pal.thatch); P.tri([1.2, 3.45, 8.7], [1.2, 3.45, 4.9], [1.2, 4.6, 6.8], pal.thatch);
  if (near) { railing(b, [[-7.4, 6.0], [0.6, 6.0]], 0.95, 0xe9d34a, { h: 0.95, step: 1.7 }); for (let q = 0; q < 15; q++) bulb(b, [-7.7 + q * 0.6, 3.42, 8.75], 0.17, pal.bulb); }
  ticketBooth(b, -12.0, 7.0, 0, pal, level, near, level >= 2);
  if (level >= 2) ticketBooth(b, 11.8, 7.2, 0, pal, level, near, false);
  // backdrop, palms, rocks
  backdrop(b, pal, -14.2, 14.2, -8.7, 6.4, name, near);
  palm(b, -12.3, 5.4, 5.5, pal, near); if (level >= 2) { palm(b, 12.0, 0.6, 5.0, pal, near, -0.3); palm(b, -12.2, -2.6, 6.2, pal, near, 0.2); }
  for (const [x, z, r] of [[-9.5, 1.6, 1.0], [-7.0, -0.8, 1.5], [-3.5, 1.4, 0.9], [-5, -2.8, 1.1]]) P.sphere([x, 0.2 + r * 0.45, z], r, pal.rock, 7, 5);
  // sign on top of the trestle, flags, festoons
  if (level >= 2) {
    for (const x of [-2.4, 2.8]) P.tube([x, 10.8, ZB - 1.9], [x, 15.2, ZB - 1.9], 0.14, pal.timberB, { sides: 4, flat: true });
    litSign(b, 0.2, 15.9, ZB - 1.9, 7.6, 1.5, name, pal, { near, gold });
    for (const x of near ? [-12, -8, 12] : [-12]) pennant(b, x, 0.3, 8.4, 4.5, pal.flag, 1);
    if (near) { festoon(b, [-7.4, 3.6, 8.5], [-12.0, 3.4, 7.0], 6, 0.4, pal.bulb); festoon(b, [0.6, 3.6, 8.5], [5, 4.0, 8.0], 7, 0.5, pal.bulb); }
  }
  if (level >= 3) {
    tiki(b, -9.4, 7.7, 0.2, pal, gold); tiki(b, 2.7, 7.9, -0.2, pal, gold);
    sheep(b, 13.6, 7.6, -0.5, gold);
    // LED lines down both chute walls + along the lift, chasing
    const sub = fr.filter((_, i) => i + 1 < fr.length && zone(i) !== 0);
    for (const lat of [-1.04, 1.04]) handles.lamps.push(...ledWallRuns(L, fr.filter((_, i) => i + 1 < fr.length && zone(i) === 2), lat, -0.45, -0.1, near ? 2 : 2, pal.led).map((r) => ({ ...r, kind: 'chute', loop: 0 })));
  }
  if (gold) { for (const sg of [-1, 1]) P.sphere([sg * 12.2, 3.0, 8.4], 0.3, GOLD, 8, 5); }
  return handles;
}
function chase(K, geo, handles, t, k) {
  for (const h of handles.lamps) { const w = (((t * 2.2 - h.k / 5) % 1) + 1) % 1; const f = 0.25 + 0.75 * Math.pow(1 - w, 2); const c = handles.led[0]; K.setLamp(geo, h.s, h.n, [c[0] * f, c[1] * f, c[2] * f]); }
}

/* ------------------------------------------------------------------------------------------------------------------ model */
function build(opts = {}) {
  const T = window.THREE; const K = makeKit(T);
  const look = clamp(opts.look | 0, 0, 2); const level = clamp(opts.level | 0 || 1, 1, 4); const quality = opts.quality || 'medium';
  const pal = PAL[look]; const cfg = { pal, level, gold: level >= 4, look, quality };
  const sp = makeSpline(splashControls(), { step: 0.1 });
  const zones = { lift: [sp.nearestS([-11.0, WATER_Y, ZB], 0, 80), sp.nearestS([1.4, 11.6, ZB], 10, 90)], chute: [0, 0] };
  zones.chute = [sp.nearestS([5.5, 11.6, -2.4], zones.lift[1], 120), sp.nearestS([5.5, 2.0, 2.0], zones.lift[1], 140)];
  const run = makeRun(sp, { lifts: [[zones.lift[0], zones.lift[1], 1.7]], vStation: 1.0, aAccel: 0.9, aBrake: 1.8, eta: 0.5, aLat: 6, vMax: 9.5, vMin: 1.1, dwell: 6 });
  const sImpact = sp.nearestS(SPLASH_IMPACT, zones.chute[0], sp.length);
  // time the lead boat (shift 0) crosses the impact point: scan the run
  let tImp = 0; for (let tt = 0; tt < run.period; tt += 0.02) { if (run.sAt(tt) >= sImpact) { tImp = tt; break; } }
  const NB = 3; const shifts = [0, 1, 2].map((i) => (i * run.period) / NB);
  const R = rng((opts.seed || 1) * 31 + 7);
  const vel = Array.from({ length: DROPS }, () => { const a = R() * PI * 2; const sp2 = 1.4 + R() * 2.6; return [Math.cos(a) * sp2 * 0.8, 3.0 + R() * 4.4, Math.sin(a) * sp2 * 0.8]; });
  const nDrops = level >= 3 ? DROPS : level >= 2 ? 11 : 7;
  const SPLASH_T = 1.5;
  const impactAge = (t, i) => ((t + shifts[i] - tImp) % run.period + run.period) % run.period;   // seconds since boat i crossed the impact point (mod period)
  const dropTrain = { cars: NB * nDrops, spacing: 0, shift: 0, custom: (j, t, m) => {
    const i = Math.floor(j / nDrops); const k = j % nDrops; const age = impactAge(t, i); if (age > SPLASH_T) return false;
    const v = vel[k]; const x = SPLASH_IMPACT[0] + v[0] * age; const z = SPLASH_IMPACT[2] + 0.6 + v[2] * age; const y = SPLASH_IMPACT[1] + 0.1 + v[1] * age - 4.9 * age * age;
    if (y < 1.0) return false; const sc = 2.1 * (1 - age / SPLASH_T * 0.5); m.makeScale(sc, sc, sc); m.setPosition(x, y, z); return true;
  } };
  const ringTrain = { cars: NB, spacing: 0, shift: 0, custom: (j, t, m) => { const age = impactAge(t, j); if (age > 2.2) return false; const sc = 0.4 + age * 2.0; m.makeScale(sc, 1, sc); m.setPosition(SPLASH_IMPACT[0], 1.14, SPLASH_IMPACT[2] + 0.5); return true; } };
  const name = nameOf('splash', opts.lang);
  const g = buildTrackRide({
    id: 'splash', T, K, sp, run, quality, look, level, footprint: { x: 14.4, zMin: -8.8, zMax: 8.8 }, height: 17.2, carRadius: 30, eyeOffset: [0, 1.0, 0.2],
    trains: [...shifts.map((s) => ({ cars: 1, spacing: 0, shift: s, lift: 0.05 })), dropTrain, ringTrain],
    buildStatic: (b, near) => buildStatic(b, cfg, near, sp, zones, name),
    buildCar: (b, near, ti, j) => { if (ti < NB) buildBoat(b, near, pal); else if (ti === NB) buildDrop(b, 'drop', pal); else buildDrop(b, 'ring', pal); },
    chase,
    extra: { impact: SPLASH_IMPACT, tImpact: tImp, dropCount: nDrops },
  });
  return g;
}

export const MODELS = { splash: { build } };
export default MODELS;
