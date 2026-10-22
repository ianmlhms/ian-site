/* Schueberfouer Tycoon, W4b: the alpine coaster (item `alpina`, pitch XL 56 x 30, DESIGN 3.3).
 * A two-storey chalet ticket hall (dark timber, deep eaves with floral bargeboards, flower boxes, a balcony with the game's own fibreglass bear in a dirndl),
 * lime-green tubular supports, a blue track with a white diamond pattern, a row of flags, a long alpine mural, trains on a lift, waves and a 540 degree helix. */
import { makeKit, clamp, lerp, bulb, festoon, railing, padSlab, pennant } from './big-kit.js';
import { makeSpline, makeRun, arcPoints, girder, rails, diamonds, diamondsTop, ledWallRuns, buildTrackRide, supportPoints } from './coaster-kit.js';
import { litSign, ticketBooth, queueRails, nameOf, GOLD, DARK, collar, patch } from './coaster-props.js';

const PAL = [
  { top: 0x3b66c8, side: 0x1c3f9a, under: 0x1a3a8a, diamond: 0xf4f6fa, rail: 0x1a3a8a, support: 0x6fd13a, supportB: 0x58b82a, wood: 0x5c4436, woodB: 0x7e5c42, roof: 0x5a4636, roofB: 0x483a2e, board: 0x2f7d4a, boardDot: 0xf4f6fa, trim: 0xe7b53b, shutter: 0x2f7d4a, cream: 0xf0e6cc,
    bear: 0x9a6a3a, bearB: 0xc89a62, dress: 0x3a5ea8, apron: 0xf4f6fa, sign: [1, 0.85, 0.4], bulb: [1, 0.85, 0.5], led: [0.5, 0.8, 1], led2: [1, 0.9, 0.5], flowers: [0xe3242b, 0xf2c80c, 0xe86aa8, 0xf4f4f0], deck: 0x8b9094, canopy: 0xb89463, car: 0xf4f2ea, carB: 0x6fd13a, seat: 0x23262a, mural: [0x9cc8ee, 0xf4f6fa, 0x7aa6c8, 0x2f6a3a, 0x4a9a4a] },
  { top: 0x3a2fb0, side: 0x241a7a, under: 0x1a1250, diamond: 0x35e6ff, rail: 0x1a1250, support: 0xff4ad0, supportB: 0xc7168e, wood: 0x3a2a60, woodB: 0x52408a, roof: 0x3a2a70, roofB: 0x2a1c50, board: 0xc7168e, boardDot: 0x35e6ff, trim: 0x40e8ff, shutter: 0xc7168e, cream: 0xd8d0ff,
    bear: 0x8a5aa8, bearB: 0xc8a0e0, dress: 0x35e6ff, apron: 0xf4f6fa, sign: [0.2, 0.95, 1], bulb: [0.4, 0.9, 1], led: [0.2, 0.9, 1], led2: [1, 0.2, 0.8], flowers: [0xff5ac0, 0x35e6ff, 0xc7ff3a, 0xf4f4f0], deck: 0x4c4a66, canopy: 0x5a4b9a, car: 0xe6e0ff, carB: 0x35e6ff, seat: 0x0f0a30, mural: [0x2a1a70, 0xc9c0f0, 0x6a3ad0, 0x35e6ff, 0xff5ac0] },
  { top: 0x5a8ae0, side: 0x2f64b8, under: 0x244b88, diamond: 0xf4f6fa, rail: 0x244b88, support: 0xf4f4f0, supportB: 0xdfe6ee, wood: 0x4a5c84, woodB: 0x6a7ca4, roof: 0x2f64b8, roofB: 0x244b88, board: 0x2f64b8, boardDot: 0xf4f6fa, trim: 0xcfe0f6, shutter: 0x2f64b8, cream: 0xf2f0e6,
    bear: 0xc8a070, bearB: 0xe8d0a0, dress: 0x2f64b8, apron: 0xf4f6fa, sign: [1, 0.84, 0.5], bulb: [1, 0.85, 0.5], led: [0.75, 0.88, 1], led2: [1, 0.85, 0.5], flowers: [0x2f64b8, 0xf4f4f0, 0xe3242b, 0xf2c80c], deck: 0x8d9296, canopy: 0xcfe0f6, car: 0xf4f4f0, carB: 0x2f64b8, seat: 0x2b3a58, mural: [0xb8d4f0, 0xf4f6fa, 0x7aa6e0, 0x2f64b8, 0x7ab0e0] },
];

const PI = Math.PI;
const Z_ST = 1.0; const Y_ST = 1.8;
const HX = 17; const BACK = Z_ST - 14.0;

export function alpinaControls() {
  const c = [];
  c.push([-4, Y_ST, Z_ST], [1, Y_ST, Z_ST], [6, Y_ST, Z_ST]);
  // right turnaround (left turn, rising): centre (HX, Z_ST - 7), r = 7 ... the lane ends on z = BACK
  const cz = Z_ST - 7.0; const rr = 7.0;
  const arc1 = arcPoints(HX, cz, rr, PI / 2, -PI / 2, Y_ST, 9.0);
  c.push(...arc1.slice(0, -1));
  // the long lift along the back lane (z = BACK), then two waves
  c.push([HX, 9.0, cz - rr]);
  c.push([7, 12.6, BACK], [2, 17.0, BACK], [-3, 21.2, BACK], [-5.2, 22.4, BACK], [-8, 17.4, BACK], [-11, 16.0, BACK], [-14, 19.0, BACK], [-16.5, 19.0, BACK]);
  // 540 degree banked helix to the left, descending: centre (-18.5, BACK + r), r = 6.75
  const r2 = 7.0; const cx2 = -18.5; const cz2 = BACK + r2;
  const h = arcPoints(cx2, cz2, r2, -PI / 2, -PI / 2 - 3 * PI, 17.0, 3.4, 18);
  c.push(...h.slice(1));
  // bunny hill and the run back into the station
  c.push([-12.2, 4.6, Z_ST], [-9.6, 6.2, Z_ST], [-7.2, 4.0, Z_ST], [-6, 2.6, Z_ST]);
  const out = [];
  for (const p of c) { const q = out[out.length - 1]; if (q && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 0.35) continue; out.push(p); }
  return out;
}

/* ------------------------------------------------------------------------------------------------------------------ cars */
function buildCar(b, near, ti, j, pal) {
  const P = b.P; const first = j === 0;
  if (!near) {
    P.box(0, 0.62, 0, 1.5, 0.7, 2.5, pal.car, 32); P.box(0, 0.98, -0.2, 1.2, 0.3, 1.5, pal.seat, 0);
    if (first) P.box(0, 0.5, 1.35, 1.3, 0.4, 0.6, pal.carB, 32);
    return;
  }
  P.box(0, 0.4, 0, 1.3, 0.2, 2.6, 0x2a2d33, 32);
  for (const sx of [-1, 1]) { P.box(sx * 0.68, 0.78, 0, 0.1, 0.62, 2.5, pal.car, 0); P.box(sx * 0.7, 0.78, 0, 0.06, 0.2, 2.5, pal.carB, 0); }
  P.box(0, 0.6, -1.28, 1.4, 0.7, 0.1, pal.car, 0);
  if (first) { P.quad([-0.7, 0.5, 1.7], [0.7, 0.5, 1.7], [0.66, 0.95, 1.25], [-0.66, 0.95, 1.25], pal.carB); P.tri([-0.7, 0.5, 1.7], [-0.66, 0.95, 1.25], [-0.7, 0.5, 1.25], pal.car); P.tri([0.7, 0.5, 1.7], [0.66, 0.95, 1.25], [0.7, 0.5, 1.25], pal.car); }
  else P.box(0, 0.6, 1.28, 1.4, 0.7, 0.1, pal.car, 0);
  for (const z of [0.5, -0.5]) { P.box(0, 0.82, z, 1.15, 0.12, 0.7, pal.seat, 0); P.box(0, 1.24, z - 0.34, 1.15, 0.7, 0.1, pal.seat, 0); P.tube([-0.5, 0.95, z + 0.25], [0.5, 0.95, z + 0.25], 0.045, 0xe3242b, { sides: 4, flat: true }); }
}

/* ------------------------------------------------------------------------------------------------------------------ the bear (the game's own fibreglass mascot) */
function bear(b, x, y, z, ry, pal, s = 1) {
  const P = b.P;
  b.place([x, y, z], ry, 0, 0, s);
  const fur = pal.bear; const furB = pal.bearB;
  P.tube([-0.28, 0.0, 0], [-0.26, 0.55, 0], 0.17, 0x2a2420, { sides: 6 }); P.tube([0.28, 0.0, 0], [0.26, 0.55, 0], 0.17, 0x2a2420, { sides: 6 });
  P.tube([0, 0.5, 0], [0, 1.35, 0], 0.62, pal.dress, { sides: 10, r1: 0.4 });          // dirndl skirt flaring to the hips
  P.sphere([0, 1.35, 0], 0.42, pal.dress, 10, 6);                                            // bodice
  P.quad([-0.3, 0.55, 0.52], [0.3, 0.55, 0.52], [0.22, 1.3, 0.38], [-0.22, 1.3, 0.38], pal.apron);
  P.sphere([0, 1.62, 0.04], 0.34, fur, 10, 6);                                               // neck / chest
  P.sphere([0, 1.98, 0.08], 0.42, fur, 12, 8);                                               // head
  P.sphere([0, 1.9, 0.44], 0.2, furB, 8, 6); P.sphere([0, 1.95, 0.62], 0.07, 0x1a1a1e, 6, 4);   // snout + nose
  for (const sx of [-1, 1]) { P.sphere([sx * 0.33, 2.32, 0], 0.15, fur, 6, 4); P.sphere([sx * 0.15, 2.07, 0.4], 0.055, 0x1a1a1e, 6, 4); }
  P.tube([-0.38, 1.55, 0], [-0.75, 1.1, 0.35], 0.12, fur, { sides: 6 });                    // left arm down
  P.tube([0.38, 1.55, 0], [0.78, 2.1, 0.2], 0.12, fur, { sides: 6 }); P.sphere([0.8, 2.18, 0.2], 0.14, furB, 6, 4);   // right arm waving
  P.tube([-0.4, 2.3, 0.1], [0.4, 2.3, 0.1], 0.03, 0xe3242b, { sides: 4, flat: true });      // a little red ribbon
  b.pop();
}

/* ------------------------------------------------------------------------------------------------------------------ the chalet */
function chalet(b, cfg, near, name) {
  const { pal, level, gold } = cfg; const P = b.P; const L = b.L;
  const G = b.G([1, 0.78, 0.42]);
  const cx = -6; const WX0 = -15; const WX1 = 3; const WZ0 = 7.3; const WZ1 = 13.6;
  // ground wing: dark timber, green pilasters, lit ticket windows with flower boxes
  P.box(cx, 1.9, (WZ0 + WZ1) / 2, WX1 - WX0, 3.6, WZ1 - WZ0, pal.wood, 32 | 16);
  if (near) for (let q = 0; q < 9; q++) P.box(WX0 + 1 + q * 2.0, 1.9, WZ1 + 0.02, 0.1, 3.5, 0.06, pal.woodB, 0);
  for (let q = 0; q <= 6; q++) { const x = WX0 + 0.4 + q * ((WX1 - WX0 - 0.8) / 6); P.box(x, 1.9, WZ1 + 0.14, 0.34, 3.6, 0.3, pal.shutter, 0); }
  for (let q = 0; q < 6; q++) {
    const x = WX0 + 0.4 + (q + 0.5) * ((WX1 - WX0 - 0.8) / 6); const w = 1.9;
    P.box(x, 2.2, WZ1 + 0.03, w + 0.16, 1.4, 0.06, pal.cream, 0); G.quad([x - w / 2, 1.6, WZ1 + 0.08], [x + w / 2, 1.6, WZ1 + 0.08], [x + w / 2, 2.7, WZ1 + 0.08], [x - w / 2, 2.7, WZ1 + 0.08], 0x2b4048);
    if (near) { P.box(x, 1.35, WZ1 + 0.3, w, 0.22, 0.34, pal.woodB, 0); for (let f = 0; f < 6; f++) flower(b, x - 0.8 + f * 0.32, 1.52, WZ1 + 0.34, pal.flowers[(f + q) % 4]); }
    else P.box(x, 1.35, WZ1 + 0.3, w, 0.3, 0.3, pal.flowers[q % 4], 0);
  }
  // lean-to roof over the wing (shingles), deep eave at the front
  const roofY0 = 4.1; const roofY1 = 5.6;
  P.quad([WX0 - 0.4, roofY0, WZ1 + 1.3], [WX1 + 0.4, roofY0, WZ1 + 1.3], [WX1 + 0.4, roofY1, WZ0 + 0.5], [WX0 - 0.4, roofY1, WZ0 + 0.5], pal.roof);
  if (near) for (let q = 0; q < 6; q++) { const f = (q + 0.5) / 6; const z = lerp(WZ1 + 1.3, WZ0 + 0.5, f); const y = lerp(roofY0, roofY1, f); P.quad([WX0 - 0.4, y + 0.03, z], [WX1 + 0.4, y + 0.03, z], [WX1 + 0.4, y + 0.03, z - 0.18], [WX0 - 0.4, y + 0.03, z - 0.18], pal.roofB); }
  P.box(cx, roofY0 - 0.08, WZ1 + 1.3, WX1 - WX0 + 0.8, 0.16, 0.14, gold ? GOLD : pal.board, 0);
  for (const x of [WX0 + 0.4, WX1 - 0.4]) P.box(x, 2.0, WZ1 + 1.2, 0.22, 4.0, 0.22, pal.shutter, 0);
  // upper block with a deep gable
  const UX0 = -12; const UX1 = 0; const UZ0 = 7.6; const UZ1 = 12.6; const ucx = (UX0 + UX1) / 2;
  P.box(ucx, 7.0, (UZ0 + UZ1) / 2, UX1 - UX0, 3.4, UZ1 - UZ0, pal.wood, 32 | 16);
  const eaveY = 8.7; const ridgeY = 12.0; const ov = 1.7; const rz0 = UZ0 - 0.2; const rz1 = UZ1 + 2.0;
  P.quad([UX0 - ov, eaveY, rz0], [UX0 - ov, eaveY, rz1], [ucx, ridgeY, rz1], [ucx, ridgeY, rz0], pal.roof);
  P.quad([UX1 + ov, eaveY, rz0], [UX1 + ov, eaveY, rz1], [ucx, ridgeY, rz1], [ucx, ridgeY, rz0], pal.roofB);
  P.tri([UX0, 8.7, UZ1 + 0.01], [UX1, 8.7, UZ1 + 0.01], [ucx, 11.3, UZ1 + 0.01], pal.wood);                       // gable face
  P.tri([UX0 + 1.2, 8.8, UZ1 + 0.03], [UX1 - 1.2, 8.8, UZ1 + 0.03], [ucx, 11.0, UZ1 + 0.03], pal.woodB);
  // floral bargeboards along both gable edges (deep eave), white flower dots
  for (const sx of [-1, 1]) {
    const x0 = ucx + sx * (UX1 - ucx + ov); const a = [x0, eaveY, rz1]; const bb = [ucx, ridgeY, rz1];
    P.quad([a[0], a[1] - 0.55, a[2]], [a[0], a[1] + 0.05, a[2]], [bb[0], bb[1] + 0.05, bb[2]], [bb[0], bb[1] - 0.55, bb[2]], gold ? GOLD : pal.board);
    const n = near ? 9 : 4;
    for (let q = 0; q < n; q++) { const f = (q + 0.5) / n; const px = lerp(a[0], bb[0], f); const py = lerp(a[1], bb[1], f) - 0.25; P.box(px, py, rz1 + 0.04, 0.26, 0.26, 0.04, pal.boardDot, 0); if (near && q % 2 === 0) P.box(px, py - 0.5, rz1 + 0.04, 0.12, 0.4, 0.04, pal.board, 0); }
  }
  P.tube([ucx, ridgeY, rz1], [ucx, ridgeY + 0.9, rz1 + 0.1], 0.07, gold ? GOLD : pal.board, { sides: 4, flat: true });
  // upper windows with shutters, balcony with balustrade and the bear
  for (const x of [-9.4, -2.6]) {
    P.box(x, 7.3, UZ1 + 0.03, 1.5, 1.7, 0.06, pal.cream, 0); G.quad([x - 0.65, 6.55, UZ1 + 0.08], [x + 0.65, 6.55, UZ1 + 0.08], [x + 0.65, 8.1, UZ1 + 0.08], [x - 0.65, 8.1, UZ1 + 0.08], 0x2b4048);
    for (const sx of [-1, 1]) P.box(x + sx * 1.0, 7.3, UZ1 + 0.1, 0.5, 1.7, 0.08, pal.shutter, 0);
    if (near) { P.box(x, 6.25, UZ1 + 0.3, 1.5, 0.2, 0.32, pal.woodB, 0); for (let f = 0; f < 5; f++) flower(b, x - 0.6 + f * 0.3, 6.42, UZ1 + 0.34, pal.flowers[(f + 1) % 4]); }
  }
  const BY = 5.75; const bz = 13.9;
  P.box(ucx, BY - 0.08, (UZ1 + bz) / 2 + 0.3, 9.0, 0.16, bz - UZ1 + 0.9, pal.woodB, 0);
  if (near) { railing(b, [[ucx - 4.4, bz + 0.5], [ucx + 4.4, bz + 0.5], [ucx + 4.4, UZ1 + 0.3]], BY, pal.shutter, { h: 0.95, step: 0.5, mid: false }); railing(b, [[ucx - 4.4, UZ1 + 0.3], [ucx - 4.4, bz + 0.5]], BY, pal.shutter, { h: 0.95, step: 0.5, mid: false }); }
  else P.box(ucx, BY + 0.5, bz + 0.5, 9.0, 0.9, 0.08, pal.shutter, 0);
  bear(b, ucx, BY, UZ1 + 0.9, 0, pal, 1.15);
  // sign board over the ticket windows
  litSign(b, cx, 4.62, WZ1 + 1.42, 8.4, 1.2, name, { board: pal.board, trim: pal.trim, sign: pal.sign, bulb: pal.bulb }, { near, gold, bulbs: level >= 2 });
  return { cx, WX0, WX1 };
}

/** a tiny blossom: two crossed quads */
function flower(b, x, y, z, col) { const r = 0.13; b.P.quad([x - r, y, z], [x + r, y, z], [x + r, y + 2 * r, z], [x - r, y + 2 * r, z], col); b.P.quad([x, y, z - r], [x, y, z + r], [x, y + 2 * r, z + r], [x, y + 2 * r, z - r], col); }
function fir(b, x, z, h, pal, near) {
  const P = b.P; P.tube([x, 0.3, z], [x, 1.2, z], 0.2, 0x5a4030, { sides: 4, flat: true });
  const n = near ? 3 : 2; for (let i = 0; i < n; i++) { const y0 = 0.9 + (i * (h - 1.2)) / n; const r = (1.9 * (1 - i / (n + 0.8))) * (h / 7); P.tube([x, y0, z], [x, y0 + (h - 1.0) / n + 0.9, z], r, i % 2 ? 0x2a7a3a : 0x2f6a38, { sides: near ? 6 : 4, r1: 0.05 }); }
}
/* ------------------------------------------------------------------------------------------------------------------ the mural wall and the flag row */
function muralWall(b, pal, x0, x1, z, h, near) {
  const P = b.P; const m = pal.mural; const w = x1 - x0;
  P.box((x0 + x1) / 2, h / 2 + 0.2, z - 0.1, w, h, 0.2, 0x4b3a2e, 0);
  P.quad([x0, 0.5, z + 0.02], [x1, 0.5, z + 0.02], [x1, h + 0.2, z + 0.02], [x0, h + 0.2, z + 0.02], m[0]);
  const peaks = Math.max(4, Math.round(w / 5.0));
  for (let i = 0; i < peaks; i++) {
    const cx = x0 + ((i + 0.5) * w) / peaks; const ph = h * (0.6 + 0.35 * ((i * 37) % 7) / 7); const hw = (w / peaks) * 0.85;
    P.tri([cx - hw, 0.9, z + 0.03], [cx + hw, 0.9, z + 0.03], [cx, 0.2 + ph, z + 0.03], m[2]);
    P.tri([cx - hw * 0.34, 0.2 + ph * 0.66, z + 0.04], [cx + hw * 0.34, 0.2 + ph * 0.66, z + 0.04], [cx, 0.2 + ph, z + 0.04], m[1]);
  }
  P.quad([x0, 0.5, z + 0.05], [x1, 0.5, z + 0.05], [x1, 1.4, z + 0.05], [x0, 1.4, z + 0.05], m[3]);
  const firs = Math.round(w / (near ? 1.0 : 1.9));
  for (let i = 0; i < firs; i++) { const x = x0 + ((i + 0.5) * w) / firs; const fh = 1.1 + 0.7 * (((i * 53) % 5) / 5); P.tri([x - 0.5, 0.5, z + 0.06], [x + 0.5, 0.5, z + 0.06], [x, 0.5 + fh, z + 0.06], m[3]); }
  P.quad([x0, 0.3, z + 0.07], [x1, 0.3, z + 0.07], [x1, 0.75, z + 0.07], [x0, 0.75, z + 0.07], m[4]);
  P.box((x0 + x1) / 2, h + 0.3, z - 0.04, w + 0.3, 0.2, 0.34, 0x4b3a2e, 0);
}
const NATIONS = [[0xe3242b, 0xffffff, 0x62c1e6], [0x1d1d22, 0xe3242b, 0xf2c80c], [0xe3242b, 0xffffff, 0xe3242b], [0x2d4fa0, 0x2d4fa0, 0xf2c80c], [0xf2c80c, 0x1d1d22, 0xe3242b]];
function flagRow(b, x0, x1, z, y, n) {
  const P = b.P;
  for (let i = 0; i < n; i++) {
    const x = lerp(x0, x1, n === 1 ? 0.5 : i / (n - 1)); const f = NATIONS[i % NATIONS.length];
    P.tube([x, y, z], [x, y + 5.2, z], 0.06, 0xcfd3d6, { sides: 3, flat: true });
    for (let k = 0; k < 3; k++) { const y0 = y + 4.9 - k * 0.34; P.quad([x, y0, z], [x + 1.5, y0 - 0.05, z + 0.12], [x + 1.5, y0 - 0.39, z + 0.12], [x, y0 - 0.34, z], f[k]); }
  }
}

/* ------------------------------------------------------------------------------------------------------------------ static structure */
function buildStatic(b, cfg, near, sp, name) {
  const { pal, level, gold } = cfg; const P = b.P; const L = b.L; const handles = { lamps: [], led: [pal.led, pal.led2], marks: [] }; const mk = (n) => handles.marks.push([n, Math.round(b.count / 3)]);
  padSlab(b, 55.2, 29.2, 0, 0);
  const list = near ? sp.resample({ maxStep: 2.0, maxAngle: 0.1, minStep: 0.3 }) : sp.resample({ maxStep: 3.2, maxAngle: 0.26, minStep: 0.6 });
  const fr = sp.frames(list);
  if (near) {
    girder(P, fr, { w: 1.5, h: 0.7, y: 0, top: pal.top, side: pal.side });
    diamonds(P, fr, { w: 1.5, h: 0.7, y: 0, col: pal.diamond }); diamondsTop(P, fr, { w: 1.5, y: 0, col: pal.diamond });
    rails(P, fr, { gauge: 1.0, w: 0.12, h: 0.1, y: 0, col: pal.rail, side: pal.rail, inner: false });
  } else {
    girder(P, fr, { w: 1.5, h: 0.7, y: 0, top: pal.top, side: pal.side });
    diamonds(P, fr, { w: 1.5, h: 0.7, y: 0, col: pal.diamond }); diamondsTop(P, fr, { w: 1.5, y: 0, col: pal.diamond });
  }
  mk('track');
  // lime tubular supports: two splayed legs + ties
  for (const { f } of supportPoints(sp, near ? 6.2 : 8, 2.2, (f) => (f.p[2] > 4 && f.p[1] < 7))) {
    const h = f.p[1] - 0.5; const rx = f.r[0]; const rz = f.r[2]; const rl = Math.hypot(rx, rz) || 1; const ux = rx / rl; const uz = rz / rl;
    const spread = 0.75 + h * 0.035;
    for (const sg of [-1, 1]) {
      const base = [f.p[0] + ux * sg * spread, 0.3, f.p[2] + uz * sg * spread]; const top = [f.p[0] + ux * sg * 0.62, f.p[1] - 0.5, f.p[2] + uz * sg * 0.62];
      P.tube(base, top, near ? 0.2 : 0.24, pal.support, { sides: near ? 6 : 4, flat: true });
    }
    P.box(f.p[0], f.p[1] - 0.5, f.p[2], 1.55, 0.14, 0.3, pal.supportB, 0);
    if (near && h > 4.5) {
      for (const t of [0.35, 0.7]) { const y = 0.3 + h * t; const sp2 = spread - (spread - 0.62) * t; P.tube([f.p[0] - ux * sp2, y, f.p[2] - uz * sp2], [f.p[0] + ux * sp2, y, f.p[2] + uz * sp2], 0.06, pal.supportB, { sides: 3, flat: true }); }
      if (h > 9) { const y0 = 0.3 + h * 0.35; const y1 = 0.3 + h * 0.7; P.tube([f.p[0] - ux * (spread - 0.15), y0, f.p[2] - uz * (spread - 0.15)], [f.p[0] + ux * (spread - 0.4), y1, f.p[2] + uz * (spread - 0.4)], 0.05, pal.supportB, { sides: 3, flat: true }); }
      if (gold && h > 7) collar(b, f.p[0] + ux * 0.65, f.p[1] - 1.0, f.p[2] + uz * 0.65, 0.15);
    }
  }
  mk('supports');
  // L3: LED lines along the track sides, chasing
  if (level >= 3) for (const lat of [-0.77, 0.77]) handles.lamps.push(...ledWallRuns(L, fr, lat, -0.5, -0.2, near ? 4 : 3, pal.led).map((r) => ({ ...r, kind: 'track', loop: 0 })));
  // station: platform behind the chalet, canopy, rails
  const sx0 = -6.4; const sx1 = HX - 0.6; const scx = (sx0 + sx1) / 2; const sw = sx1 - sx0;
  P.box(scx, 0.55, 4.0, sw, 0.5, 3.0, pal.deck, 32); P.box(scx, 0.82, 4.0, sw - 0.2, 0.05, 2.8, 0xc3b79d, 0);
  for (const x of [sx0 + 0.6, scx, sx1 - 0.6]) for (const z of [2.6, 5.4]) P.tube([x, 0.8, z], [x, 4.4, z], 0.1, pal.support, { sides: 4, flat: true });
  P.box(scx, 4.5, 4.0, sw, 0.2, 3.6, pal.canopy, 32);
  P.quad([sx0 - 0.4, 4.6, 5.8], [sx1 + 0.4, 4.6, 5.8], [sx1 + 0.4, 5.4, 4.0], [sx0 - 0.4, 5.4, 4.0], pal.roof);
  P.quad([sx0 - 0.4, 4.6, 2.2], [sx1 + 0.4, 4.6, 2.2], [sx1 + 0.4, 5.4, 4.0], [sx0 - 0.4, 5.4, 4.0], pal.roofB);
  if (near) { railing(b, [[sx0 + 0.6, 2.45], [sx1 - 0.6, 2.45]], 0.8, 0xe9d34a, { h: 0.95, step: 1.7 }); for (let q = 0; q < 22; q++) bulb(b, [sx0 + 0.3 + q * ((sw - 0.6) / 21), 4.4, 5.82], 0.17, pal.bulb); }
  mk('station');
  chalet(b, cfg, near, name);
  mk('chalet');
  // right of the chalet: a second ticket booth and the queue
  ticketBooth(b, 8.2, 11.6, 0, { ...pal, boothRoof: pal.roof, trim: pal.trim, booth: pal.cream }, level, near, level >= 2);
  if (near) queueRails(b, 3.8, 12.5, [9.4, 10.6], pal.trim);
  mk('booth');
  // mural wall at the back + the flag row on the chalet side
  muralWall(b, pal, -26, 26, -14.6, 3.2, near);
  if (level >= 2) flagRow(b, 14, 25, 8.2, 0.3, near ? 5 : 3);
  if (level >= 2 && near) { festoon(b, [-15, 4.0, 13.9], [3, 4.0, 13.9], 14, 0.35, pal.bulb); for (const x of [-12, -6, 0]) pennant(b, x, 12.1, 9.0, 1.4, pal.board, 1); }
  mk('mural+flags');
  // lawns, a gravel path, fir trees and flower beds
  patch(b, -27.2, 3.5, -16.4, 14.7, 0x6fa84a); patch(b, 18.2, 2.5, 27.2, 14.7, 0x6fa84a); patch(b, -4.5, 14.0, 3.4, 14.7, 0xc9b890); patch(b, 3.6, 6.8, 13.6, 7.9, 0xc9b890);
  for (const [x, z, h] of [[-22.5, 11.5, 7], [-19.5, 13, 5.5], [24.5, 12, 7.5], [21, 13.5, 5.5], [25.5, 5, 6]]) fir(b, x, z, h, pal, near);
  for (const x of near ? [-14, -10.5, -7, -3.5, 0, 2.2] : [-14, -6, 2]) { P.box(x, 0.55, 14.55, 2.2, 0.5, 0.6, pal.woodB, 0); for (let f = 0; f < (near ? 5 : 2); f++) flower(b, x - 0.8 + f * 0.4, 0.95, 14.55, pal.flowers[(f + Math.abs(Math.round(x))) % 4]); }
  mk('firs');
  if (level >= 3) {
    bear(b, 10.8, 0.3, 13.2, -0.3, pal, 0.8);
    P.box(10.8, 0.15, 13.2, 1.6, 0.3, 1.6, pal.woodB, 32);
    if (near) { railing(b, [[-16, 14.6], [-8, 14.6]], 0.3, pal.trim, { h: 1.0, step: 1.7 }); railing(b, [[-2, 14.6], [4, 14.6]], 0.3, pal.trim, { h: 1.0, step: 1.7 }); }
  }
  return handles;
}

function chase(K, geo, handles, t, k) {
  for (const h of handles.lamps) {
    const w = (((t * 1.3 - h.k / 8) % 1) + 1) % 1; const f = 0.3 + 0.7 * Math.pow(1 - w, 2); const c = handles.led[h.k % 2];
    K.setLamp(geo, h.s, h.n, [c[0] * f, c[1] * f, c[2] * f]);
  }
}

function build(opts = {}) {
  const T = window.THREE; const K = makeKit(T);
  const look = clamp(opts.look | 0, 0, 2); const level = clamp(opts.level | 0 || 1, 1, 4); const quality = opts.quality || 'medium';
  const pal = PAL[look]; const cfg = { pal, level, gold: level >= 4, look, quality };
  const sp = makeSpline(alpinaControls(), { step: 0.14, bank: { gain: 4.0, max: 0.75, window: 4 } });
  const sL0 = sp.nearestS([HX, 9.0, BACK], 0, 80); const sL1 = sp.nearestS([-5.2, 22.4, BACK], sL0, sL0 + 40);
  const run = makeRun(sp, { lifts: [[sL0 - 18, sL1, 2.8]], vStation: 1.7, aAccel: 1.2, aBrake: 2.6, eta: 0.7, aLat: 14, vMax: 14, vMin: 2.6, dwell: 8 });
  const name = nameOf('alpina', opts.lang);
  return buildTrackRide({
    id: 'alpina', T, K, sp, run, quality, look, level, footprint: { x: 27.6, zMin: -14.8, zMax: 14.8 }, height: 24, carRadius: 60, eyeOffset: [0, 1.3, 0.2],
    trains: [0, 1].map((i) => ({ cars: 5, spacing: 2.9, shift: (i * run.period) / 2, lift: 0.15 })),
    buildStatic: (b, near) => buildStatic(b, cfg, near, sp, name),
    buildCar: (b, near, ti, j) => buildCar(b, near, ti, j, pal),
    chase,
  });
}

export const MODELS = { alpina: { build } };
export default MODELS;
