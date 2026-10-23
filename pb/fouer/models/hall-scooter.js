/* Schueberfouer Tycoon, W4b: the bumper-car hall (item `scooter`, pitch L 30 x 18, DESIGN 3.3).
 * A boxy hall with a bright bulb front, a roofed porch with the cash booths, an open steel floor behind a padded barrier, a see-through ceiling grid with UV light
 * bars (they glow at night), an airbrush mural on the back wall and up to twelve metallic cars with poles and flags that drift around and bump each other.
 * Car motion is a pure function of t (Lissajous paths + a soft push-apart), period 48 s. */
import { makeKit, rng, clamp, lerp, bulb, festoon, railing, padSlab, pennant, sheep } from './big-kit.js';
import { buildTrackRide } from './coaster-kit.js';
import { litSign, ticketBooth, nameOf, GOLD, DARK, collar } from './coaster-props.js';

const PAL = [
  { fascia: 0x8a1c2a, fasciaB: 0xefe3c2, trim: 0xe7b53b, barrier: [0xb8212e, 0xefe3c2], rail: 0xe7b53b, floor: 0x2e3542, floorGlow: [[0.5, 0.2, 1], [0.1, 0.55, 1]], uv: [0.55, 0.25, 1], bulbs: [[1, 0.85, 0.5], [1, 0.45, 0.2]], sign: [1, 0.6, 0.15], board: 0x2a1220, wall: [0x5a2a8a, 0x2aa0d0, 0xe83a8a],
    booth: 0xefe3c2, boothRoof: 0xa2272b, beam: 0x6c747c, carCols: [0x9fb4c8, 0x9fcdb0, 0xd9a0a0, 0xb6a0d8, 0xe8c060], carAcc: [0xf08a22, 0xe3242b, 0x2f6fe0, 0xf2c80c], pole: [0xb8212e, 0xefe3c2], flag: 0x2d4fa0, led: [[1, 0.5, 0.15], [1, 0.9, 0.5]] },
  { fascia: 0x2a1a66, fasciaB: 0x120a30, trim: 0x40e8ff, barrier: [0x35e6ff, 0xc7168e], rail: 0x40e8ff, floor: 0x1c2038, floorGlow: [[0.1, 0.9, 1], [1, 0.1, 0.8]], uv: [0.6, 0.2, 1], bulbs: [[0.2, 0.9, 1], [1, 0.2, 0.85]], sign: [0.2, 0.95, 1], board: 0x0c0820, wall: [0x2a1a90, 0x35e6ff, 0xff5ac0],
    booth: 0x2a1a66, boothRoof: 0xc7168e, beam: 0x4c4a66, carCols: [0x7fb8e0, 0xe08ad8, 0x8ae0c8, 0xb0a0ff, 0xf0e07a], carAcc: [0x35e6ff, 0xff5ac0, 0xc7ff3a, 0x6a3ad0], pole: [0x35e6ff, 0x2a1a66], flag: 0x35e6ff, led: [[0.1, 0.9, 1], [1, 0.1, 0.8]] },
  { fascia: 0x2f64b8, fasciaB: 0xf4f4f0, trim: 0xcfe0f6, barrier: [0x2f64b8, 0xf4f4f0], rail: 0xcfe0f6, floor: 0x343c4c, floorGlow: [[1, 0.85, 0.5], [0.6, 0.8, 1]], uv: [0.5, 0.35, 1], bulbs: [[1, 0.85, 0.5], [0.75, 0.88, 1]], sign: [1, 0.84, 0.5], board: 0x1d3a70, wall: [0x244b88, 0x7aa6e0, 0xf4f4f0],
    booth: 0xf2f0e6, boothRoof: 0x2f64b8, beam: 0x8d9296, carCols: [0xb8c8d8, 0xc8d8b8, 0xd8b8b8, 0xc0b8d8, 0xd8d0a0], carAcc: [0x2f64b8, 0xe3242b, 0xf2c80c, 0x2fa84f], pole: [0x2f64b8, 0xf4f4f0], flag: 0x2f64b8, led: [[1, 0.85, 0.5], [0.75, 0.88, 1]] },
];

const FL = { x0: -13.0, x1: 13.0, z0: -7.6, z1: 3.9 };          // the floor
const HALL = { x: 14.2, zBack: -8.3, zFront: 8.3 };
const CEIL = 3.9; const FLOOR_Y = 0.45;
const PERIOD = 48;

/* ------------------------------------------------------------------------------------------------------------------ the cars */
function carBody(b, near, col, acc, pal, withPole = true) {
  const P = b.P; const L = b.L;
  b.place([0, 0, 0], 0, 0, 0, 1.28);
  // bumper ring (a flattened rubber tyre): a rounded rectangle of short tubes
  const N = near ? 16 : 8; const pts = [];
  for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; const c = Math.cos(a); const s = Math.sin(a); pts.push([0.62 * Math.sign(c) * Math.pow(Math.abs(c), 0.7), 0.17, 1.0 * Math.sign(s) * Math.pow(Math.abs(s), 0.7)]); }
  for (let i = 0; i < N; i++) { const p = pts[i]; const q = pts[(i + 1) % N]; P.tube(p, q, 0.15, 0x1d1f22, { sides: near ? 5 : 4, flat: true }); }
  if (!near) { P.box(0, 0.5, 0, 1.0, 0.45, 1.5, col, 32); P.box(0, 0.86, -0.4, 0.7, 0.4, 0.3, 0x23262a, 0); b.pop(); if (withPole) P.tube([0, 0.9, -0.8], [0, CEIL - FLOOR_Y - 0.1, -0.8], 0.06, pal.pole[0], { sides: 3, flat: true }); return; }
  P.box(0, 0.42, 0, 1.0, 0.3, 1.5, col, 32);
  P.quad([-0.5, 0.57, 0.35], [0.5, 0.57, 0.35], [0.42, 0.4, 0.92], [-0.42, 0.4, 0.92], col);                     // sloping bonnet
  P.quad([-0.5, 0.57, -0.4], [0.5, 0.57, -0.4], [0.48, 0.74, -0.72], [-0.48, 0.74, -0.72], col);                // tail deck
  P.box(0, 0.58, -0.15, 0.7, 0.04, 0.2, 0x23262a, 0);
  for (const sx of [-1, 1]) { P.quad([sx * 0.51, 0.34, 0.85], [sx * 0.51, 0.34, -0.7], [sx * 0.51, 0.52, -0.7], [sx * 0.51, 0.52, 0.85], acc); P.box(sx * 0.46, 0.56, -0.05, 0.08, 0.22, 1.1, col, 0); }
  P.box(0, 0.62, -0.28, 0.66, 0.2, 0.46, 0x23262a, 0); P.box(0, 0.9, -0.52, 0.66, 0.5, 0.1, 0x23262a, 0);
  P.tube([0, 0.62, 0.32], [0, 0.82, 0.12], 0.025, 0x23262a, { sides: 3 }); P.disc([0, 0.84, 0.1], [0, 0.5, -0.86], 0.2, 0x23262a, 8);
  b.pop();
  if (withPole) {
    P.tube([0, 0.9, -0.8], [0, CEIL - FLOOR_Y - 0.1, -0.8], 0.055, pal.pole[0], { sides: 4, flat: true });
    for (let k = 0; k < 6; k++) { const y0 = 1.1 + k * 0.5; P.tube([0, y0, -0.8], [0, y0 + 0.25, -0.8], 0.062, pal.pole[1], { sides: 4, flat: true }); }
    const fy = 2.3; P.quad([0, fy, -0.8], [0.8, fy - 0.04, -0.8], [0.8, fy - 0.54, -0.8], [0, fy - 0.5, -0.8], pal.flag); P.fan([0.4, fy - 0.27, -0.805], [0.09, 0, 0], [0, 0.09, 0], 0xf2c80c, 6);
  }
  b.place([0, 0, 0], 0, 0, 0, 1.28);
  L.quad([-0.45, 0.46, -0.78], [-0.2, 0.46, -0.78], [-0.2, 0.55, -0.78], [-0.45, 0.55, -0.78], [1, 0.1, 0.05]); L.quad([0.2, 0.46, -0.78], [0.45, 0.46, -0.78], [0.45, 0.55, -0.78], [0.2, 0.55, -0.78], [1, 0.1, 0.05]);
  L.quad([-0.4, 0.46, 0.93], [-0.2, 0.46, 0.91], [-0.2, 0.52, 0.91], [-0.4, 0.52, 0.93], [1, 0.95, 0.8]); L.quad([0.2, 0.46, 0.91], [0.4, 0.46, 0.93], [0.4, 0.52, 0.93], [0.2, 0.52, 0.91], [1, 0.95, 0.8]);
  b.pop();
}

/** car paths: Lissajous figures with integer ratios over PERIOD, so the animation loops exactly; soft push-apart from the neighbours */
function makePaths(n, seed) {
  const R = rng(seed * 13 + 5); const out = [];
  const NX = [1, 2, 3, 2, 4, 3, 1, 4, 2, 3, 5, 1]; const NZ = [2, 3, 1, 5, 3, 4, 3, 2, 5, 1, 2, 4];
  for (let i = 0; i < n; i++) out.push({ nx: NX[i % 12], nz: NZ[i % 12], px: R() * Math.PI * 2, pz: R() * Math.PI * 2, ax: 8.6 + R() * 2.4, az: 3.4 + R() * 0.7 });
  const base = (c, t) => { const w = (Math.PI * 2) / PERIOD; return [Math.sin(c.nx * w * t + c.px) * c.ax, Math.sin(c.nz * w * t + c.pz) * c.az]; };
  const cx = (FL.x0 + FL.x1) / 2; const cz = (FL.z0 + FL.z1) / 2 - 0.2;
  const pose = (i, t) => {
    const p = base(out[i], t); let x = p[0]; let z = p[1];
    for (let j = 0; j < n; j++) { if (j === i) continue; const q = base(out[j], t); const dx = x - q[0]; const dz = z - q[1]; const d = Math.hypot(dx, dz); if (d < 2.5 && d > 1e-3) { const push = (2.5 - d) * 0.5; x += (dx / d) * push; z += (dz / d) * push; } }
    const p2 = base(out[i], t + 0.08); const yaw = Math.atan2(p2[0] - p[0], p2[1] - p[1]) + 0.1 * Math.sin(t * 2.7 + i * 1.3);
    return { x: cx + clamp(x, -11.9, 11.9), z: cz + clamp(z, -4.6, 4.2), yaw };
  };
  return pose;
}

/* ------------------------------------------------------------------------------------------------------------------ static hall */
function buildStatic(b, cfg, near, name) {
  const { pal, level, gold } = cfg; const P = b.P; const L = b.L; const handles = { lamps: [], led: pal.led };
  padSlab(b, 29.0, 17.4, 0, 0);
  const UV = b.G([pal.uv[0] * 1.3, pal.uv[1] * 1.3, pal.uv[2] * 1.2]); const WG = [b.G(pal.wall[0]), b.G(pal.wall[1]), b.G(pal.wall[2])];
  // steel floor with night reflections of the lights
  P.box(0, 0.38, (FL.z0 + FL.z1) / 2, FL.x1 - FL.x0 + 0.6, 0.14, FL.z1 - FL.z0 + 0.6, pal.floor, 32);
  const fg = b.G(pal.floorGlow[0]); const fg2 = b.G(pal.floorGlow[1]);
  for (let q = 0; q < (near ? 14 : 8); q++) { const x = FL.x0 + 0.6 + q * ((FL.x1 - FL.x0 - 1.2) / (near ? 13 : 7)); (q % 2 ? fg : fg2).quad([x - 0.35, 0.46, FL.z0 + 0.3], [x + 0.35, 0.46, FL.z0 + 0.3], [x + 0.35, 0.46, FL.z1 - 0.3], [x - 0.35, 0.46, FL.z1 - 0.3], pal.floor); }
  // padded barrier: panels in two colours, a bright rail on top, entry gap at the front
  const seg = (x0, z0, x1, z1, k) => { const len = Math.hypot(x1 - x0, z1 - z0); const n = Math.max(1, Math.round(len / (near ? 2 : 6.5))); for (let i = 0; i < n; i++) { const a = i / n; const c = (i + 1) / n; const cxm = lerp(x0, x1, (a + c) / 2); const czm = lerp(z0, z1, (a + c) / 2); const ln = len / n; const horiz = Math.abs(x1 - x0) > Math.abs(z1 - z0); P.box(cxm, FLOOR_Y + 0.55, czm, horiz ? ln : 0.34, 1.1, horiz ? 0.34 : ln, pal.barrier[(i + k) % 2], 32 | 16); } };
  const bx0 = FL.x0 - 0.1; const bx1 = FL.x1 + 0.1; const bz0 = FL.z0 - 0.1; const bz1 = FL.z1 + 0.1;
  seg(bx0, bz0, bx1, bz0, 0); seg(bx0, bz0, bx0, bz1, 1); seg(bx1, bz0, bx1, bz1, 0); seg(bx0, bz1, -1.9, bz1, 1); seg(1.9, bz1, bx1, bz1, 1);
  const rail = (x0, z0, x1, z1) => P.tube([x0, FLOOR_Y + 1.14, z0], [x1, FLOOR_Y + 1.14, z1], 0.07, pal.rail, { sides: 4, flat: true });
  rail(bx0, bz0, bx1, bz0); rail(bx0, bz0, bx0, bz1); rail(bx1, bz0, bx1, bz1); rail(bx0, bz1, -1.9, bz1); rail(1.9, bz1, bx1, bz1);
  // ceiling grid with UV bars; columns
  const gy = CEIL;
  P.box(0, gy, bz0 - 0.2, 28.4, 0.3, 0.3, pal.beam, 0); P.box(0, gy, bz1 + 0.2, 28.4, 0.3, 0.3, pal.beam, 0);
  for (const x of [bx0 - 0.2, bx1 + 0.2]) P.box(x, gy, (bz0 + bz1) / 2, 0.3, 0.3, bz1 - bz0 + 0.4, pal.beam, 0);
  for (const x of near ? [-9.5, -4.8, 0, 4.8, 9.5] : [-6, 6]) P.box(x, gy, (bz0 + bz1) / 2, 0.14, 0.22, bz1 - bz0, pal.beam, 0);
  const nx = near ? 11 : 4; for (let q = 0; q < nx; q++) { const x = lerp(bx0 + 1.2, bx1 - 1.2, q / (nx - 1)); P.box(x, gy - 0.05, (bz0 + bz1) / 2, 0.08, 0.1, bz1 - bz0, 0x8a929a, 0); }
  for (const z of [-5.6, -2.0, 1.6]) { UV.quad([bx0 + 1, gy - 0.18, z - 0.3], [bx1 - 1, gy - 0.18, z - 0.3], [bx1 - 1, gy - 0.18, z + 0.3], [bx0 + 1, gy - 0.18, z + 0.3], 0xd8d0ff); P.box(0, gy - 0.1, z, 26, 0.12, 0.34, 0x30343a, 0); }
  for (const [x, z] of [[bx0 - 0.2, bz0 - 0.2], [bx1 + 0.2, bz0 - 0.2], [bx0 - 0.2, bz1 + 0.2], [bx1 + 0.2, bz1 + 0.2], [0, bz0 - 0.2], [-6.6, bz1 + 0.2], [6.6, bz1 + 0.2]]) P.tube([x, FLOOR_Y, z], [x, gy, z], 0.17, pal.beam, { sides: 6, flat: true });
  // back wall with the mirrored airbrush mural
  const wz = HALL.zBack; P.box(0, 2.35, wz - 0.1, 28.4, 4.2, 0.3, 0x30343a, 0);
  const mw = 28.0 / 6;
  for (let q = 0; q < 6; q++) {
    const x0 = -14 + q * mw; const x1 = x0 + mw - 0.15; const c0 = pal.wall[q % 3]; const c1 = pal.wall[(q + 1) % 3];
    P.quad([x0, 0.55, wz + 0.06], [x1, 0.55, wz + 0.06], [x1, 4.2, wz + 0.06], [x0, 4.2, wz + 0.06], c0, c0, c1, c1);
    WG[q % 3].quad([x0, 0.55, wz + 0.07], [x1, 0.55, wz + 0.07], [x1, 4.2, wz + 0.07], [x0, 4.2, wz + 0.07], c0);
    P.fan([(x0 + x1) / 2, 2.6, wz + 0.08], [mw * 0.28, 0, 0], [0, 1.0, 0], pal.wall[(q + 2) % 3], 14);
    P.tri([x0 + 0.5, 0.7, wz + 0.09], [x1 - 0.5, 0.7, wz + 0.09], [(x0 + x1) / 2, 2.2, wz + 0.09], 0xe6e6f0);
    if (near) { for (let k = 0; k < 4; k++) P.quad([x0 + 0.3, 0.9 + k * 0.85, wz + 0.1], [x1 - 0.3, 0.9 + k * 0.85, wz + 0.1], [x1 - 0.3, 0.96 + k * 0.85, wz + 0.1], [x0 + 0.3, 0.96 + k * 0.85, wz + 0.1], 0xcfe8f4); }
  }
  // roofed porch + the bright front
  const pz0 = 4.4; const pz1 = HALL.zFront;
  P.box(0, gy + 0.12, (pz0 + pz1) / 2, 28.8, 0.24, pz1 - pz0, pal.fasciaB, 0);
  for (const x of [-13.9, -6.9, 0, 6.9, 13.9]) P.tube([x, 0.3, pz1 - 0.3], [x, gy, pz1 - 0.3], 0.14, pal.beam, { sides: 4, flat: true });
  P.box(0, 6.1, pz1 - 0.1, 28.8, 2.4, 0.4, pal.fascia, 32 | 16);
  for (const [y, h, c] of [[3.95, 0.16, gold ? GOLD : pal.trim], [7.42, 0.2, gold ? GOLD : pal.trim], [4.92, 0.14, gold ? GOLD : pal.trim], [5.0, 0.1, pal.fasciaB]]) P.box(0, y, pz1 + 0.12, 29.0, h, 0.2, c, 0);
  // the open lower front: a curtain of hanging bulb strings so the floor stays visible
  for (let q = 0; q < (near ? 20 : 10); q++) { const x = -13.7 + q * (27.4 / (near ? 19 : 9)); L.quad([x - 0.05, 4.0, pz1 + 0.2], [x + 0.05, 4.0, pz1 + 0.2], [x + 0.05, 4.86, pz1 + 0.2], [x - 0.05, 4.86, pz1 + 0.2], pal.bulbs[q % 2]); if (near) bulb(b, [x, 3.92, pz1 + 0.2], 0.2, pal.bulbs[q % 2]); }
  if (cfg.look === 2) for (let q = 0; q < 28; q++) { const x = -13.5 + q * 1.0; P.quad([x, 6.1, pz1 + 0.12], [x + 0.5, 6.5, pz1 + 0.12], [x + 1.0, 6.1, pz1 + 0.12], [x + 0.5, 5.7, pz1 + 0.12], pal.fasciaB); }
  // bright bulb rows (lamps): individual bulbs near, a lit strip far
  const rows = [5.18, 5.55, 6.9, 7.2];
  rows.forEach((y, i) => {
    const col = pal.bulbs[i % 2];
    if (near) for (let q = 0; q < 62; q++) bulb(b, [-13.6 + q * 0.44, y, pz1 + 0.2], 0.17, col);
    else L.quad([-13.6, y, pz1 + 0.2], [13.6, y, pz1 + 0.2], [13.6, y + 0.17, pz1 + 0.2], [-13.6, y + 0.17, pz1 + 0.2], col);
  });
  if (level >= 2) litSign(b, 0, 6.1, pz1 + 0.25, 17.5, 1.7, name, { board: pal.board, trim: pal.trim, sign: pal.sign, bulb: pal.bulbs[0] }, { near, gold });
  else { P.box(0, 6.1, pz1 + 0.2, 8.5, 1.4, 0.15, pal.board, 0); L.quad([-3.6, 5.6, pz1 + 0.3], [3.6, 5.6, pz1 + 0.3], [3.6, 6.6, pz1 + 0.3], [-3.6, 6.6, pz1 + 0.3], pal.sign); }
  for (const sx of [-1, 1]) { P.box(sx * 11.2, 6.1, pz1 + 0.18, 4.6, 1.8, 0.14, pal.board, 0); if (level >= 2) { for (let q = 0; q < 3; q++) L.quad([sx * 11.2 - 1.95 + q * 1.35, 5.45, pz1 + 0.27], [sx * 11.2 - 0.75 + q * 1.35, 5.45, pz1 + 0.27], [sx * 11.2 - 0.75 + q * 1.35, 6.75, pz1 + 0.27], [sx * 11.2 - 1.95 + q * 1.35, 6.75, pz1 + 0.27], pal.bulbs[q % 2]); } }
  // porch: booth(s) and the entrance arch
  ticketBooth(b, -9.5, 6.2, 0, pal, level, near, level >= 2);
  if (level >= 2) ticketBooth(b, 9.5, 6.2, 0, pal, level, near, false);
  for (const x of [-2.1, 2.1]) P.box(x, 1.2, 4.3, 0.22, 1.8, 0.22, gold ? GOLD : pal.trim, 0);
  P.box(0, 2.2, 4.3, 4.4, 0.2, 0.26, gold ? GOLD : pal.trim, 0);
  if (near) { railing(b, [[-12.6, 4.4], [-2.4, 4.4]], 0.3, pal.rail, { h: 0.9, step: 1.8, mid: false }); railing(b, [[2.4, 4.4], [12.6, 4.4]], 0.3, pal.rail, { h: 0.9, step: 1.8, mid: false }); }
  // L2: pennants along the roofline; L3: LED outlines of the fascia, the barrier, Hämmi in a giant car; L4: gold caps
  if (level >= 2) { for (let q = 0; q < (near ? 10 : 5); q++) pennant(b, -13.2 + q * (26.4 / (near ? 9 : 4)), 7.4, pz1 - 0.1, 2.0, pal.flag, q % 2 ? 1 : -1); if (near) { festoon(b, [-14, 4.1, pz1 + 0.3], [-14.1, 4.0, 4.4], 6, 0.4, pal.bulbs[0]); } }
  if (level >= 3) {
    const lw = (x0, y0, x1, y1, k) => { const n0 = b.count; L.quad([x0, y0, pz1 + 0.3], [x1, y0, pz1 + 0.3], [x1, y1, pz1 + 0.3], [x0, y1, pz1 + 0.3], pal.led[k % 2]); handles.lamps.push({ s: n0, n: b.count - n0, k, kind: 'fascia' }); };
    const NS = near ? 14 : 7; for (let q = 0; q < NS; q++) { const x = -14.4 + q * (28.8 / NS); lw(x, 7.34, x + 28.8 / NS - 0.1, 7.5, q); lw(x, 4.0, x + 28.8 / NS - 0.1, 4.14, q + 1); }
    const NB = near ? 12 : 6; for (let q = 0; q < NB; q++) { const x = bx0 + 0.5 + q * ((bx1 - bx0 - 1) / NB); const n0 = b.count; L.quad([x, FLOOR_Y + 1.24, bz0 + 0.18], [x + (bx1 - bx0 - 1) / NB - 0.1, FLOOR_Y + 1.24, bz0 + 0.18], [x + (bx1 - bx0 - 1) / NB - 0.1, FLOOR_Y + 1.24, bz0 + 0.3], [x, FLOOR_Y + 1.24, bz0 + 0.3], pal.led[q % 2]); handles.lamps.push({ s: n0, n: b.count - n0, k: q, kind: 'barrier' }); }
    b.place([-11.2, 7.4, pz1 - 2.0], 0.2, 0, 0, 1.5); carBody(b, near, pal.carCols[0], pal.carAcc[0], pal, false); b.pop();
    b.place([-11.2, 7.4, pz1 - 2.0], 0.2, 0, 0, 1.0); sheep(b, 0, 0, 0, gold); b.pop();
  }
  if (gold) for (const x of [bx0, bx1]) for (const z of [bz0, bz1]) P.sphere([x, FLOOR_Y + 1.3, z], 0.18, GOLD, 6, 4);
  return handles;
}
function chase(K, geo, handles, t, k) {
  for (const h of handles.lamps) { const w = (((t * 1.4 - h.k / (h.kind === 'fascia' ? 14 : 12)) % 1) + 1) % 1; const f = 0.3 + 0.7 * Math.pow(1 - w, 2); const c = handles.led[h.k % 2]; K.setLamp(geo, h.s, h.n, [c[0] * f, c[1] * f, c[2] * f]); }
}

function build(opts = {}) {
  const T = window.THREE; const K = makeKit(T);
  const look = clamp(opts.look | 0, 0, 2); const level = clamp(opts.level | 0 || 1, 1, 4); const quality = opts.quality || 'medium';
  const pal = PAL[look]; const cfg = { pal, level, gold: level >= 4, look, quality };
  const n = [8, 9, 10, 12][level - 1];
  const pose = makePaths(n, opts.seed || 1);
  const name = nameOf('scooter', opts.lang);
  let holder = null;                      // rides wave: while somebody drives, ud.drive(j, matrix) writes the pose of car j (rides/bumper.js), otherwise the Lissajous paths
  const g = buildTrackRide({
    id: 'scooter', T, K, quality, look, level, cycle: PERIOD, footprint: { x: 14.4, zMin: -8.4, zMax: 8.4 }, height: 9.2, carRadius: 24, lodDistance: 70,
    trains: [{ cars: n, spacing: 0, shift: 0, custom: (j, t, m) => { const d = holder && holder.userData.drive; if (d) return d(j, m); const p = pose(j, t); m.makeRotationY(p.yaw); m.setPosition(p.x, FLOOR_Y, p.z); return true; } }],
    buildStatic: (b, near) => buildStatic(b, cfg, near, name),
    buildCar: (b, near, ti, j) => carBody(b, near, pal.carCols[j % pal.carCols.length], pal.carAcc[j % pal.carAcc.length], pal),
    chase,
    extra: { carCount: n },
  });
  g.userData.phaseAt = (t) => ({ t: ((t % PERIOD) + PERIOD) % PERIOD, cars: Array.from({ length: n }, (_, i) => pose(i, t)) });
  g.userData.carColors = { body: pal.carCols[0], acc: pal.carAcc[0], pole: pal.pole, bulbs: pal.bulbs, uv: pal.uv, wall: pal.wall }; g.userData.floor = FL; g.userData.floorY = FLOOR_Y; g.userData.ceilY = CEIL; g.userData.drive = null; holder = g;
  return g;
}

export const MODELS = { scooter: { build } };
export default MODELS;
