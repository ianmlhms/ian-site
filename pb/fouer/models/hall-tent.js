/* Schueberfouer Tycoon, W4b: the beer tent and restaurant (item `tent`, pitch L 30 x 18, DESIGN 3.4).
 * A 30 x 16 m white hall tent: a tall gabled nave with two lower aisles (sloping shed roofs), a lettered front gable, open sides so the striped fabric ceiling,
 * the ring chandeliers (they turn slowly), the stage and the long tables show from outside, and a small timber terrace with barrels and tubs at the front.
 * Generic name on the gable (BIERZELT), no brand.  Dynamic parts (chandeliers, steam at L3) are CPU-skinned in one mesh. */
import { makeKit, rng, clamp, lerp, bulb, festoon, railing, padSlab, pennant, sheep, pixelText, pixelTextWidth } from './big-kit.js';
import { buildTrackRide } from './coaster-kit.js';
import { litSign, nameOf, GOLD, DARK } from './coaster-props.js';

const PAL = [
  { roof: 0xf4f3ee, roofB: 0xe4e6e8, wall: 0xf1f0ea, stripeA: 0xf6efd8, stripeB: 0xf0c030, valA: 0xc8222c, valB: 0xf6f2e6, letters: 0x8a1c2a, board: 0x3a1a1e, trim: 0xe7b53b, post: 0xe9e6dc, wood: 0xb89463, woodB: 0x8a6a42, cloth: [0xf4f0e4, 0xc8222c], bulb: [1, 0.85, 0.5], sign: [1, 0.72, 0.25], led: [[1, 0.5, 0.15], [1, 0.9, 0.5]], glow: [1, 0.8, 0.45], flags: [0xc8222c, 0xf6f2e6, 0x62c1e6], deck: 0x8a6a46, door: 0x6a1a22 },
  { roof: 0xf0eefa, roofB: 0xdcdcf0, wall: 0xeceaf8, stripeA: 0x6a3ad0, stripeB: 0x35e6ff, valA: 0xc7168e, valB: 0x35e6ff, letters: 0x6a3ad0, board: 0x120a30, trim: 0x40e8ff, post: 0xe6e0ff, wood: 0x8a7ab8, woodB: 0x5a4b9a, cloth: [0x35e6ff, 0xc7168e], bulb: [0.4, 0.9, 1], sign: [0.2, 0.95, 1], led: [[0.1, 0.9, 1], [1, 0.1, 0.8]], glow: [0.6, 0.7, 1], flags: [0xc7168e, 0x35e6ff, 0xc7ff3a], deck: 0x4c4a66, door: 0x2a1a66 },
  { roof: 0xf6f8fb, roofB: 0xe2e8f0, wall: 0xf4f6fa, stripeA: 0xf4f6fa, stripeB: 0x2f64b8, valA: 0x2f64b8, valB: 0xf4f6fa, letters: 0x2f64b8, board: 0x1d3a70, trim: 0xcfe0f6, post: 0xf0f2f6, wood: 0xc9b893, woodB: 0x9a8a68, cloth: [0xf4f6fa, 0x2f64b8], bulb: [1, 0.85, 0.5], sign: [1, 0.84, 0.5], led: [[1, 0.85, 0.5], [0.75, 0.88, 1]], glow: [1, 0.9, 0.6], flags: [0x2f64b8, 0xf4f6fa, 0x7aa6e0], deck: 0x8d9296, door: 0x244b88 },
];

const X_AISLE = 15; const X_NAVE = 7; const Z0 = -9; const Z1 = 7.2;
const Y_EAVE_N = 5.0; const Y_RIDGE = 9.2; const Y_EAVE_A = 3.4;
const PERIOD = 60;
const CHAND_Z = [-4.6, 0.2, 5.0];

/* ------------------------------------------------------------------------------------------------------------------ dynamic parts */
function chandelier(b, near, pal) {
  const P = b.P; const L = b.L;
  const N = near ? 14 : 8; const R = 1.5;
  for (let i = 0; i < N; i++) { const a0 = (i / N) * Math.PI * 2; const a1 = ((i + 1) / N) * Math.PI * 2; P.tube([Math.cos(a0) * R, 0, Math.sin(a0) * R], [Math.cos(a1) * R, 0, Math.sin(a1) * R], 0.1, i % 2 ? 0x1f3a2a : 0x23262a, { sides: 4, flat: true }); }
  for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; if (near) bulb(b, [Math.cos(a) * R, 0.12, Math.sin(a) * R], 0.2, pal.bulb); else L.quad([Math.cos(a) * R - 0.1, 0.12, Math.sin(a) * R], [Math.cos(a) * R + 0.1, 0.12, Math.sin(a) * R], [Math.cos(a) * R + 0.1, 0.32, Math.sin(a) * R], [Math.cos(a) * R - 0.1, 0.32, Math.sin(a) * R], pal.bulb); }
  for (const k of [0, 1, 2, 3]) { const a = (k / 4) * Math.PI * 2; P.tube([Math.cos(a) * R, 0, Math.sin(a) * R], [0, 2.6, 0], 0.025, 0x23262a, { sides: 3, flat: true }); }
  P.sphere([0, -0.5, 0], 0.45, 0xf8f6ee, near ? 8 : 6, near ? 6 : 4); L.sphere([0, -0.5, 0], 0.38, [1, 0.9, 0.6], 6, 4);
  if (near) for (const k of [0, 1, 2]) { const a = (k / 3) * Math.PI * 2 + 0.5; P.tube([Math.cos(a) * R * 0.9, 0, Math.sin(a) * R * 0.9], [Math.cos(a) * R * 0.9, -0.8, Math.sin(a) * R * 0.9], 0.02, 0x23262a, { sides: 3, flat: true }); P.sphere([Math.cos(a) * R * 0.9, -0.95, Math.sin(a) * R * 0.9], 0.22, 0xf8f6ee, 6, 4); }
}
function puff(b) { b.P.sphere([0, 0, 0], 0.5, 0xeceae4, 6, 4); }

/* ------------------------------------------------------------------------------------------------------------------ static tent */
/** HDR canvas white (albedo > 1): by day the brightest thing on the field; the roof also glows warm from inside at night (G bucket) */
const hdr = (hex, k) => { const c = new globalThis.THREE.Color(hex); return [c.r * k, c.g * k, c.b * k]; };
function buildStatic(b, cfg, near, name) {
  const { pal, level, gold } = cfg; const P = b.P; const L = b.L; const handles = { lamps: [], led: pal.led };
  const G = b.G(pal.glow); const trim = gold ? GOLD : pal.trim;
  padSlab(b, 30.0, 18.0, 0, 0);
  const zc = (Z0 + Z1) / 2; const zl = Z1 - Z0;
  // floor, stage, bar
  b.G([0.45, 0.32, 0.16]).quad([-14.8, 0.505, Z0], [14.8, 0.505, Z0], [14.8, 0.505, Z1], [-14.8, 0.505, Z1], pal.wood);
  P.box(0, 0.4, zc, 29.6, 0.2, zl, pal.wood, 32);
  P.box(0, 0.78, -7.7, 12.6, 0.9, 2.6, pal.woodB, 32); P.box(0, 0.92, -7.7, 12.4, 0.12, 2.5, pal.wood, 0);
  P.box(0, 3.0, -8.85, 12.4, 3.6, 0.2, pal.door, 0); P.fan([0, 4.6, -8.72], [5.2, 0, 0], [0, 1.2, 0], pal.door, 14);
  P.box(0, 3.0, -8.7, 10.4, 3.2, 0.06, pal.stripeA, 0); for (let q = 0; q < 8; q++) P.box(-4.5 + q * 1.3, 3.0, -8.66, 0.5, 3.2, 0.04, pal.stripeB, 0);
  if (near) { P.box(-2.2, 1.55, -7.9, 0.9, 0.7, 0.9, 0xb8212e, 0); P.box(2.0, 1.3, -7.8, 0.5, 0.5, 0.5, 0x23262a, 0); P.fan([-2.2, 1.95, -7.4], [0.45, 0, 0], [0, 0.0, 0.45], 0xe8e4d0, 8); }
  P.box(-11, 1.0, -7.8, 7.5, 1.2, 1.3, pal.woodB, 32); P.box(-11, 1.68, -7.8, 7.7, 0.16, 1.5, 0x4a3a2a, 0);
  if (near) for (let q = 0; q < 6; q++) { P.tube([-14 + q * 1.2, 1.7, -8.3], [-14 + q * 1.2, 2.2, -8.3], 0.07, 0xd8d0b8, { sides: 4, flat: true }); P.box(-14 + q * 1.2, 2.45, -8.3, 0.14, 0.4, 0.14, 0xf2c24a, 0); }
  // tables and benches
  const rows = near ? [-12.7, -9.5, -4.8, -1.6, 1.6, 4.8, 9.5, 12.7] : [-9.5, -3.2, 3.2, 9.5];
  for (const x of rows) for (const zz of near ? [-2.6, 3.2] : [0.3]) {
    const len = near ? 5.0 : 11.0;
    P.box(x, 0.98, zz, 0.9, 0.08, len, pal.wood, 0); P.box(x, 1.02, zz, 0.7, 0.01, len - 0.1, pal.cloth[Math.abs(Math.round(x)) % 2], 0);
    if (near) { P.box(x - 0.75, 0.68, zz, 0.3, 0.07, len, pal.woodB, 0); P.box(x + 0.75, 0.68, zz, 0.3, 0.07, len, pal.woodB, 0); for (const zq of [-len / 2 + 0.3, len / 2 - 0.3]) { P.box(x, 0.65, zq, 0.7, 0.6, 0.08, pal.woodB, 0); P.box(x - 0.75, 0.55, zq, 0.08, 0.4, 0.08, pal.woodB, 0); P.box(x + 0.75, 0.55, zq, 0.08, 0.4, 0.08, pal.woodB, 0); } for (let q = 0; q < 6; q++) P.box(x - 0.2 + (q % 2) * 0.4, 1.12, zz - len / 2 + 0.6 + q * 0.8, 0.12, 0.18, 0.12, 0xf2c24a, 0); }
    else { P.box(x - 0.75, 0.68, zz, 0.3, 0.07, len, pal.woodB, 0); P.box(x + 0.75, 0.68, zz, 0.3, 0.07, len, pal.woodB, 0); }
  }
  // posts, tie beams and the roof structure
  const zs = []; const nb = 5; for (let q = 0; q <= nb; q++) zs.push(lerp(Z0 + 0.15, Z1 - 0.15, q / nb));
  for (const x of [-X_AISLE + 0.15, -X_NAVE, X_NAVE, X_AISLE - 0.15]) for (const z of zs) {
    const top = Math.abs(x) > 10 ? lerp(Y_EAVE_A, Y_EAVE_N, (X_AISLE - Math.abs(x)) / (X_AISLE - X_NAVE)) : Y_EAVE_N;
    P.tube([x, 0.4, z], [x, top, z], near ? 0.11 : 0.15, pal.post, { sides: near ? 6 : 4, flat: true });
  }
  for (const sg of [-1, 1]) for (const z of zs) {
    P.tube([sg * X_NAVE, Y_EAVE_N - 0.1, z], [0, Y_RIDGE - 0.2, z], near ? 0.06 : 0.1, pal.post, { sides: 3, flat: true });
    P.tube([sg * X_AISLE, Y_EAVE_A - 0.05, z], [sg * X_NAVE, Y_EAVE_N - 0.1, z], near ? 0.05 : 0.09, pal.post, { sides: 3, flat: true });
    if (near) P.tube([-X_NAVE, Y_EAVE_N - 0.1, z], [X_NAVE, Y_EAVE_N - 0.1, z], 0.05, pal.post, { sides: 3, flat: true });
  }
  P.tube([0, Y_RIDGE - 0.15, Z0], [0, Y_RIDGE - 0.15, Z1], 0.1, pal.post, { sides: 4, flat: true });
  // the striped ceiling (inside the roof) and the white roof skin
  const stripes = near ? 18 : 8;
  const CG = b.G([0.5, 0.4, 0.22]);
  const slope = (x0, y0, x1, y1, col) => { for (let i = 0; i < stripes; i++) { const za = lerp(Z0, Z1, i / stripes); const zb = lerp(Z0, Z1, (i + 1) / stripes); CG.quad([x0, y0, za], [x1, y1, za], [x1, y1, zb], [x0, y0, zb], i % 2 ? pal.stripeA : pal.stripeB); } };
  const dy = 0.14;
  slope(-X_NAVE, Y_EAVE_N - dy, 0, Y_RIDGE - dy); slope(X_NAVE, Y_EAVE_N - dy, 0, Y_RIDGE - dy); slope(-X_AISLE, Y_EAVE_A - dy, -X_NAVE, Y_EAVE_N - dy); slope(X_AISLE, Y_EAVE_A - dy, X_NAVE, Y_EAVE_N - dy);
  if (near) for (const sg of [-1, 1]) for (let q = 1; q < 6; q++) { const z = lerp(Z0, Z1, q / 6); P.tube([sg * X_NAVE, Y_EAVE_N + 0.03, z], [0, Y_RIDGE + 0.03, z], 0.04, 0xc8ccd0, { sides: 3, flat: true }); P.tube([sg * X_AISLE, Y_EAVE_A + 0.03, z], [sg * X_NAVE, Y_EAVE_N + 0.03, z], 0.04, 0xc8ccd0, { sides: 3, flat: true }); }
  const RG = b.G([0.7, 0.4, 0.16]); const ROOF = hdr(pal.roof, 1.75); const ROOFB = hdr(pal.roofB, 1.5);
  for (const sg of [-1, 1]) {
    // looks wave: PVC panels sewn along the frames, sagging a little between them (4 triangles round a lowered centre), a ridge cap, gutters, the seams over the frames
    const sagPanel = (x0, y0, x1, y1, za, zb, c) => {
      const E0 = [x0, y0, za], E1 = [x0, y0, zb], R0 = [x1, y1, za], R1 = [x1, y1, zb]; const M = [(x0 + x1) / 2, (y0 + y1) / 2 - 0.14, (za + zb) / 2];
      for (const [a, bb, cc] of [[E0, E1, M], [E1, R1, M], [R1, R0, M], [R0, E0, M]]) {
        const u = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]], v = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        if (n[1] >= 0) RG.tri(a, bb, cc, c); else RG.tri(a, cc, bb, c);          // the roof faces up
      }
    };
    for (let i = 0; i < nb; i++) {
      const za = lerp(Z0, Z1, i / nb), zb = lerp(Z0, Z1, (i + 1) / nb); const cN = (i & 1) ? ROOFB : (sg < 0 ? ROOF : ROOFB); const cA = (i & 1) ? ROOFB : ROOF;
      sagPanel(sg * X_NAVE, Y_EAVE_N, 0, Y_RIDGE, za, zb, cN); sagPanel(sg * X_AISLE, Y_EAVE_A, sg * X_NAVE, Y_EAVE_N, za, zb, cA);
    }
    for (let i = 0; i <= nb; i++) { const z = lerp(Z0, Z1, i / nb); const zz = Math.max(Z0 + 0.1, Math.min(Z1 - 0.1, z));
      P.quad(...(sg > 0 ? [[X_NAVE, Y_EAVE_N + 0.05, zz + 0.09], [X_NAVE, Y_EAVE_N + 0.05, zz - 0.09], [0, Y_RIDGE + 0.05, zz - 0.09], [0, Y_RIDGE + 0.05, zz + 0.09]] : [[-X_NAVE, Y_EAVE_N + 0.05, zz - 0.09], [-X_NAVE, Y_EAVE_N + 0.05, zz + 0.09], [0, Y_RIDGE + 0.05, zz + 0.09], [0, Y_RIDGE + 0.05, zz - 0.09]]), 0xdfe3e6);
      P.quad(...(sg > 0 ? [[X_AISLE, Y_EAVE_A + 0.05, zz + 0.09], [X_AISLE, Y_EAVE_A + 0.05, zz - 0.09], [X_NAVE, Y_EAVE_N + 0.05, zz - 0.09], [X_NAVE, Y_EAVE_N + 0.05, zz + 0.09]] : [[-X_AISLE, Y_EAVE_A + 0.05, zz - 0.09], [-X_AISLE, Y_EAVE_A + 0.05, zz + 0.09], [-X_NAVE, Y_EAVE_N + 0.05, zz + 0.09], [-X_NAVE, Y_EAVE_N + 0.05, zz - 0.09]]), 0xdfe3e6);
    }
    P.box(sg * X_AISLE, Y_EAVE_A - 0.12, (Z0 + Z1) / 2, 0.16, 0.14, Z1 - Z0 + 0.2, pal.post, 32); P.box(sg * X_NAVE, Y_EAVE_N - 0.12, (Z0 + Z1) / 2, 0.16, 0.14, Z1 - Z0 + 0.2, pal.post, 32);
    // scalloped valance along the outer eave, coloured fabric flaps
    const nv = near ? 18 : 8; for (let i = 0; i < nv; i++) { const za = lerp(Z0, Z1, i / nv); const zb = lerp(Z0, Z1, (i + 1) / nv); const zm = (za + zb) / 2; const c = i % 2 ? pal.valA : pal.valB; P.tri([sg * X_AISLE, Y_EAVE_A, za], [sg * X_AISLE, Y_EAVE_A, zb], [sg * X_AISLE, Y_EAVE_A - 0.7, zm], c); }
    const nv2 = near ? 18 : 8; for (let i = 0; i < nv2; i++) { const za = lerp(Z0, Z1, i / nv2); const zb = lerp(Z0, Z1, (i + 1) / nv2); const zm = (za + zb) / 2; const c = i % 2 ? pal.valB : pal.valA; P.tri([sg * X_NAVE, Y_EAVE_N, za], [sg * X_NAVE, Y_EAVE_N, zb], [sg * X_NAVE, Y_EAVE_N - 0.55, zm], c); }
  }
  P.box(0, Y_RIDGE - 0.08, (Z0 + Z1) / 2, 0.36, 0.17, Z1 - Z0 + 0.3, pal.post, 32);
  // front and back walls: nave gable + aisle ends, in white; door, lettering
  const WALL = hdr(pal.wall, 1.4);
  const wall = (z, front) => {
    if (front) {      // looks wave: the upper gable shows the striped fabric ceiling (as in the photos) instead of a flat white panel, behind the aluminium truss
      const ns = 10; const gy = (x) => Y_EAVE_N + (1 - Math.abs(x) / X_NAVE) * (Y_RIDGE - Y_EAVE_N);
      for (let i = 0; i < ns; i++) { const x0 = -X_NAVE + 2 * X_NAVE * i / ns; const x1 = -X_NAVE + 2 * X_NAVE * (i + 1) / ns; const c = i & 1 ? pal.stripeA : pal.stripeB; P.quad([x0, Y_EAVE_N, z], [x1, Y_EAVE_N, z], [x1, gy(x1), z], [x0, gy(x0), z], c); }
    } else P.tri([-X_NAVE, Y_EAVE_N, z], [X_NAVE, Y_EAVE_N, z], [0, Y_RIDGE, z], WALL);
    P.quad([-X_NAVE, 0.3, z], [X_NAVE, 0.3, z], [X_NAVE, Y_EAVE_N, z], [-X_NAVE, Y_EAVE_N, z], WALL);
    for (const sg of [-1, 1]) P.quad([sg * X_NAVE, 0.3, z], [sg * X_AISLE, 0.3, z], [sg * X_AISLE, Y_EAVE_A, z], [sg * X_NAVE, Y_EAVE_N, z], WALL);
  };
  wall(Z1, true);
  // back wall: kept simple, behind the stage
  P.quad([-X_NAVE, 0.3, Z0 + 0.02], [X_NAVE, 0.3, Z0 + 0.02], [X_NAVE, Y_EAVE_N, Z0 + 0.02], [-X_NAVE, Y_EAVE_N, Z0 + 0.02], WALL); P.tri([-X_NAVE, Y_EAVE_N, Z0 + 0.02], [X_NAVE, Y_EAVE_N, Z0 + 0.02], [0, Y_RIDGE, Z0 + 0.02], WALL);
  for (const sg of [-1, 1]) P.quad([sg * X_NAVE, 0.3, Z0 + 0.02], [sg * X_AISLE, 0.3, Z0 + 0.02], [sg * X_AISLE, Y_EAVE_A, Z0 + 0.02], [sg * X_NAVE, Y_EAVE_N, Z0 + 0.02], WALL);
  // entrance: arched door with a curtain, frame, steps
  const zf = Z1 + 0.04;
  P.quad([-2.7, 0.3, zf], [2.7, 0.3, zf], [2.7, 3.4, zf], [-2.7, 3.4, zf], pal.door); P.fan([0, 3.4, zf], [2.7, 0, 0], [0, 0.9, 0], pal.door, 14);
  for (let q = 0; q < 5; q++) P.quad([-2.5 + q, 0.3, zf + 0.02], [-1.7 + q, 0.3, zf + 0.02], [-1.7 + q, 3.3, zf + 0.02], [-2.5 + q, 3.3, zf + 0.02], q % 2 ? pal.door : shadeCol(pal.door, 1.25));
  P.box(-2.95, 1.95, zf + 0.08, 0.3, 3.4, 0.2, trim, 0); P.box(2.95, 1.95, zf + 0.08, 0.3, 3.4, 0.2, trim, 0); P.box(0, 4.35, zf + 0.08, 6.4, 0.2, 0.2, trim, 0);
  for (const sg of [-1, 1]) { P.quad([sg * 10.8 - 1.0, 0.3, zf], [sg * 10.8 + 1.0, 0.3, zf], [sg * 10.8 + 1.0, 2.6, zf], [sg * 10.8 - 1.0, 2.6, zf], pal.door); G.quad([sg * 10.8 - 1.0, 0.5, zf + 0.03], [sg * 10.8 + 1.0, 0.5, zf + 0.03], [sg * 10.8 + 1.0, 2.5, zf + 0.03], [sg * 10.8 - 1.0, 2.5, zf + 0.03], 0x3a3a30); }
  // the lettering on the gable
  const dot = 0.17; const txt = name;
  const tw = pixelTextWidth(txt, dot);
  if (level >= 2) { P.box(0, 5.05, zf + 0.04, tw + 0.8, 1.6, 0.1, pal.board, 0); P.box(0, 5.88, zf + 0.06, tw + 1.0, 0.1, 0.12, trim, 0); P.box(0, 4.22, zf + 0.06, tw + 1.0, 0.1, 0.12, trim, 0); pixelText(b, L, txt, 0, 4.4, zf + 0.12, dot, pal.sign, { merge: !near }); }
  else pixelText(b, P, txt, 0, 4.4, zf + 0.02, dot, pal.letters, { merge: true, fill: 0.95 });
  if (cfg.look === 2) for (let q = 0; q < 7; q++) { const x = -3.0 + q * 1.0; P.quad([x, 6.85, zf + 0.02], [x + 0.5, 7.35, zf + 0.02], [x + 1.0, 6.85, zf + 0.02], [x + 0.5, 6.35, zf + 0.02], pal.stripeB); }
  // gable trim along the nave front
  for (const sg of [-1, 1]) P.tube([sg * X_NAVE, Y_EAVE_N, zf + 0.05], [0, Y_RIDGE, zf + 0.05], 0.09, trim, { sides: 4, flat: true });
  pennant(b, 0, Y_RIDGE, zf + 0.05, 2.4, pal.flags[0], 1, 1.6);
  // looks wave: the aluminium truss of the gable end (tie beam, king post, struts) and battens over the white panels
  P.tube([-X_NAVE, Y_EAVE_N, zf + 0.07], [X_NAVE, Y_EAVE_N, zf + 0.07], 0.16, 0xaab1b8, { sides: 4, flat: true }); P.tube([0, Y_EAVE_N, zf + 0.07], [0, Y_RIDGE, zf + 0.07], 0.14, 0xaab1b8, { sides: 4, flat: true });
  for (const sg of [-1, 1]) P.tube([sg * X_NAVE * 0.5, Y_EAVE_N, zf + 0.05], [0, Y_RIDGE * 0.78 + Y_EAVE_N * 0.22, zf + 0.05], 0.12, 0xaab1b8, { sides: 4, flat: true });
  for (let k = -5; k <= 5; k++) { const x = k * 1.3; if (Math.abs(x) < 3.2 || Math.abs(x) > X_NAVE - 0.3) continue; P.box(x, 0.35, zf + 0.012, 0.1, Y_EAVE_N - 0.4, 0.02, 0xdfe3e6, 32); }
  // terrace in front: deck, steps, rail, barrels, tubs
  P.box(0, 0.55, 8.1, 19.0, 0.32, 1.7, pal.deck, 32); P.box(0, 0.74, 8.1, 18.8, 0.06, 1.6, pal.wood, 0);
  P.box(0, 0.42, 8.95, 5.6, 0.2, 0.3, pal.woodB, 0);
  if (near) { railing(b, [[-9.3, 8.9], [-3.4, 8.9]], 0.75, pal.woodB, { h: 0.95, step: 1.6, mid: false }); railing(b, [[3.4, 8.9], [9.3, 8.9]], 0.75, pal.woodB, { h: 0.95, step: 1.6, mid: false }); }
  for (const [x, z] of [[-8.2, 8.0], [-7.2, 8.5], [7.8, 8.2], [8.8, 7.7]]) { P.cylY(x, 0.8, z, 0.42, 0.42, 0.8, 0x8a5a32, near ? 10 : 6); if (near) { P.cylY(x, 0.9, z, 0.45, 0.45, 0.06, 0x23262a, 10); P.cylY(x, 1.45, z, 0.45, 0.45, 0.06, 0x23262a, 10); } }
  for (const x of [-5.4, 5.4]) { P.cylY(x, 0.8, 8.4, 0.45, 0.38, 0.55, 0x8a4a32, near ? 8 : 5); for (let f = 0; f < (near ? 6 : 3); f++) P.sphere([x - 0.3 + (f % 3) * 0.3, 1.5, 8.4 + (f > 2 ? 0.2 : -0.1)], 0.2, [0xe3242b, 0xf2c80c, 0xe86aa8][f % 3], 5, 4); }
  for (const x of [-9.4, 9.4]) { P.tube([x, 0.7, 8.7], [x, 7.6, 8.7], 0.05, 0xcfd3d6, { sides: 3, flat: true }); P.tri([x, 7.6, 8.7], [x + (x > 0 ? -1.5 : 1.5), 7.4, 8.8], [x, 6.9, 8.7], pal.flags[x > 0 ? 2 : 0]); }
  // L2: festoons along the gable edges and eaves, bunting; L3: LED outlines, Hämmi; L4: gold bits
  if (level >= 2) {
    if (near) {
      for (const sg of [-1, 1]) festoon(b, [sg * X_NAVE, Y_EAVE_N - 0.05, zf + 0.1], [0, Y_RIDGE - 0.05, zf + 0.1], 12, 0.0, pal.bulb, 0.17);
      festoon(b, [-X_NAVE, Y_EAVE_N, zf + 0.15], [X_NAVE, Y_EAVE_N, zf + 0.15], 14, 0.5, pal.bulb, 0.17);
      for (const sg of [-1, 1]) { const x0 = sg * X_AISLE; festoon(b, [x0 - sg * 0.1, Y_EAVE_A - 0.2, Z1], [x0 - sg * 0.1, Y_EAVE_A - 0.2, Z0], 20, 0.4, pal.bulb); }
    }
    const nf = near ? 13 : 5;
    for (let i = 0; i < nf; i++) { const f = (i + 0.5) / nf; const u = f < 0.5 ? f * 2 : (1 - f) * 2; const x = (f < 0.5 ? -1 : 1) * X_NAVE * (1 - u); const y = lerp(Y_EAVE_N, Y_RIDGE, u) - 0.75; if (Math.abs(x) < 5.4 && y < 6.5) continue; P.tri([x - 0.28, y, zf + 0.14], [x + 0.28, y, zf + 0.14], [x, y - 0.55, zf + 0.14], pal.flags[i % 3]); }
  }
  if (level >= 3) {
    const lw = (a, c, k) => { const n0 = b.count; L.ribbon(a, c, 0.16, [0, 0, 1], pal.led[k % 2]); handles.lamps.push({ s: n0, n: b.count - n0, k, kind: 'edge' }); };
    const seg = near ? 8 : 4;
    for (const sg of [-1, 1]) for (let q = 0; q < seg; q++) { const f0 = q / seg; const f1 = (q + 0.9) / seg; lw([sg * lerp(X_NAVE, 0, f0), lerp(Y_EAVE_N, Y_RIDGE, f0) + 0.18, zf + 0.12], [sg * lerp(X_NAVE, 0, f1), lerp(Y_EAVE_N, Y_RIDGE, f1) + 0.18, zf + 0.12], q + (sg > 0 ? 3 : 0)); }
    sheep(b, 11.6, 8.2, -0.4, gold);
    if (near) for (const sg of [-1, 1]) for (let q = 0; q < 4; q++) { const f0 = q / 4; const f1 = (q + 0.9) / 4; lw([sg * lerp(X_AISLE, X_NAVE, f0), lerp(Y_EAVE_A, Y_EAVE_N, f0) + 0.15, zf + 0.1], [sg * lerp(X_AISLE, X_NAVE, f1), lerp(Y_EAVE_A, Y_EAVE_N, f1) + 0.15, zf + 0.1], q + 1); }
  }
  if (gold) { P.box(0, 0.76, 8.95, 5.8, 0.08, 0.34, GOLD, 0); for (const x of [-9.4, 9.4]) P.sphere([x, 7.8, 8.7], 0.22, GOLD, 6, 4); }
  return handles;
}
function shadeCol(c, f) { const r = clamp(((c >> 16) & 255) * f, 0, 255); const g = clamp(((c >> 8) & 255) * f, 0, 255); const bl = clamp((c & 255) * f, 0, 255); return (r << 16) | (g << 8) | bl; }
function chase(K, geo, handles, t, k) {
  for (const h of handles.lamps) { const w = (((t * 1.3 - h.k / 8) % 1) + 1) % 1; const f = 0.3 + 0.7 * Math.pow(1 - w, 2); const c = handles.led[h.k % 2]; K.setLamp(geo, h.s, h.n, [c[0] * f, c[1] * f, c[2] * f]); }
}

/* ------------------------------------------------------------------------------------------------------------------ model */
function build(opts = {}) {
  const T = window.THREE; const K = makeKit(T);
  const look = clamp(opts.look | 0, 0, 2); const level = clamp(opts.level | 0 || 1, 1, 4); const quality = opts.quality || 'medium';
  const pal = PAL[look]; const cfg = { pal, level, gold: level >= 4, look, quality };
  const name = nameOf('tent', opts.lang);
  const SMOKE = level >= 3 ? 5 : 0;
  const chand = { cars: 3, spacing: 0, shift: 0, custom: (j, t, m) => { m.makeRotationY(t * 0.35 + j * 1.3); m.setPosition(0, 6.4 + 0.12 * Math.sin(t * 0.7 + j), CHAND_Z[j]); return true; } };
  const smoke = { cars: SMOKE, spacing: 0, shift: 0, custom: (j, t, m) => { const age = (((t / 6 + j / SMOKE) % 1) + 1) % 1; const sc = 0.4 + age * 1.6; m.makeScale(sc, sc * 0.8, sc); m.setPosition(-12.8 + Math.sin(age * 5 + j) * 0.6, 7.6 + age * 4.5, -6.0); return age < 0.97; } };
  const g = buildTrackRide({
    id: 'tent', T, K, quality, look, level, cycle: PERIOD, footprint: { x: 14.95, zMin: -9, zMax: 8.95 }, height: 11, carRadius: 24, lodDistance: 80,
    trains: [chand, ...(SMOKE ? [smoke] : [])],
    buildStatic: (b, near) => buildStatic(b, cfg, near, name),
    buildCar: (b, near, ti) => { if (ti === 0) chandelier(b, near, pal); else puff(b); },
    chase,
  });
  g.userData.phaseAt = (t) => ({ t: ((t % PERIOD) + PERIOD) % PERIOD, chandelierAngle: (t * 0.35) % (Math.PI * 2) });
  return g;
}

export const MODELS = { tent: { build } };
export default MODELS;
