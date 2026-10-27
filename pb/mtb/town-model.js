/* The houses and the church as meshes: each rectangle of the baked OSM footprints (town-data.js) becomes walls, a gabled / hip / flat roof, sometimes a dormer and a chimney, all merged per
 * 192 m cell (one draw call per visible cell). Walls reach below the lowest ground under the footprint, so nothing floats on a slope. Luxembourgish look: rendered walls in cream, ochre,
 * white or pink, slate roofs (some red tile), small dormers, a slate spire on the church tower. */
import { MeshBuilder, KIND } from './mesh-builder.js';
import { FLAT, HIP, DORMER, OUTBUILDING, CHURCH, RENAISSANCE, RUIN, roofRise } from './town-data.js';

export const CELL = 256;
const hash = (a, b = 0, c = 0) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return x - Math.floor(x); };
const WALLS = [[0.93, 0.9, 0.8], [0.88, 0.8, 0.62], [0.95, 0.95, 0.92], [0.86, 0.74, 0.64], [0.82, 0.86, 0.8], [0.8, 0.82, 0.84], [0.9, 0.84, 0.7]];
const ROOFS = [[0.24, 0.27, 0.33], [0.24, 0.27, 0.33], [0.24, 0.27, 0.33], [0.22, 0.25, 0.3], [0.58, 0.28, 0.2], [0.38, 0.28, 0.24]];
const TRIM = [0.93, 0.92, 0.88], CHIMNEY = [0.5, 0.42, 0.38], TAR = [0.28, 0.28, 0.3], STONE = [0.72, 0.62, 0.45];
const OVERHANG = 0.4;
const SANDSTONE = [0.86, 0.73, 0.52], RUIN_STONE = [0.78, 0.68, 0.5], MOSS_TOP = [0.3, 0.36, 0.2], SLIT = [0.05, 0.05, 0.06];
const pick = (list, seed, salt) => list[Math.floor(((seed * 7.31 + salt * 1.7) % 1) * list.length) % list.length];
const smoothSeed = (seed, salt) => (seed * 9301 + salt * 49297) % 1;

/** Adds one house to the builder. h = describeHouses entry. */
export function addHouse(m, h) {
  if (h.flags & RUIN) { addRuin(m, h); return; }
  const castle = h.flags & RENAISSANCE;
  const wall = castle ? SANDSTONE : h.flags & OUTBUILDING ? [0.84, 0.8, 0.72] : pick(WALLS, h.seed, 1), roof = castle ? [0.2, 0.23, 0.28] : h.flags & OUTBUILDING ? [0.3, 0.3, 0.32] : pick(ROOFS, h.seed, 2);
  const P = (u, y, v) => [h.cx + h.ax * u + h.bx * v, y, h.cz + h.az * u + h.bz * v];
  const { hx, hz, base, eaveY } = h;
  const flat = h.flags & FLAT;
  const topY = flat ? h.gMean + Math.max(h.eave, h.ridge) : eaveY;
  const wallH = topY - h.gMean;
  const sides = [                                                   // [p0 (left), p1 (right)] seen from outside, walking counter-clockwise
    [P(-hx, 0, hz), P(hx, 0, hz), 2 * hx], [P(hx, 0, hz), P(hx, 0, -hz), 2 * hz], [P(hx, 0, -hz), P(-hx, 0, -hz), 2 * hx], [P(-hx, 0, -hz), P(-hx, 0, hz), 2 * hz],
  ];
  const vOf = (y) => y - h.gMean;
  for (const [a, b, len] of sides) {
    m.face([[a[0], base, a[2]], [b[0], base, b[2]], [b[0], topY, b[2]], [a[0], topY, a[2]]], wall, h.flags & CHURCH ? KIND.church : KIND.wall, h.seed, [[0, vOf(base)], [len, vOf(base)], [len, vOf(topY)], [0, vOf(topY)]], len, wallH);
  }
  if (flat) {
    m.face([P(-hx, topY + 0.05, hz), P(hx, topY + 0.05, hz), P(hx, topY + 0.05, -hz), P(-hx, topY + 0.05, -hz)], TAR, KIND.flat, h.seed, [[0, 0], [2 * hx, 0], [2 * hx, 2 * hz], [0, 2 * hz]]);
    return;
  }
  const rise = roofRise(h), ridgeY = eaveY + rise, ov = OVERHANG;
  const slope = Math.hypot(hz + ov, rise);
  if (h.flags & HIP) {
    const rl = Math.max(0, hx - hz * 1.0);                         // half length of the ridge
    const R = (u) => P(u, ridgeY, 0);
    const corner = (u, v) => P(u * (hx + ov), eaveY - 0.05, v * (hz + ov));
    const k = hx + ov - rl, W = 2 * (hx + ov);
    m.face([corner(-1, 1), corner(1, 1), R(rl), R(-rl)], roof, KIND.roof, h.seed, [[0, 0], [W, 0], [W - k, slope], [k, slope]]);
    m.face([corner(1, -1), corner(-1, -1), R(-rl), R(rl)], roof, KIND.roof, h.seed, [[0, 0], [W, 0], [W - k, slope], [k, slope]]);
    m.face([corner(1, 1), corner(1, -1), R(rl)], roof, KIND.roof, h.seed, [[0, 0], [2 * (hz + ov), 0], [hz + ov, slope]]);
    m.face([corner(-1, -1), corner(-1, 1), R(-rl)], roof, KIND.roof, h.seed, [[0, 0], [2 * (hz + ov), 0], [hz + ov, slope]]);
  } else {
    const e0 = -hx - ov, e1 = hx + ov;
    m.face([P(e0, eaveY - 0.05, hz + ov), P(e1, eaveY - 0.05, hz + ov), P(e1, ridgeY, 0), P(e0, ridgeY, 0)], roof, KIND.roof, h.seed, [[0, 0], [e1 - e0, 0], [e1 - e0, slope], [0, slope]]);
    m.face([P(e1, eaveY - 0.05, -hz - ov), P(e0, eaveY - 0.05, -hz - ov), P(e0, ridgeY, 0), P(e1, ridgeY, 0)], roof, KIND.roof, h.seed, [[0, 0], [e1 - e0, 0], [e1 - e0, slope], [0, slope]]);
    // the gables: the wall continues in a triangle up to the ridge
    for (const sgn of [1, -1]) {
      const a = P(sgn * hx, eaveY, hz), b = P(sgn * hx, eaveY, -hz), c = P(sgn * hx, ridgeY, 0);
      const wl = 2 * hz;
      if (sgn > 0) m.face([[a[0], eaveY, a[2]], [b[0], eaveY, b[2]], [c[0], ridgeY, c[2]]], wall, KIND.wall, h.seed, [[0, vOf(eaveY)], [wl, vOf(eaveY)], [hz, vOf(ridgeY)]], wl, wallH);
      else m.face([[b[0], eaveY, b[2]], [a[0], eaveY, a[2]], [c[0], ridgeY, c[2]]], wall, KIND.wall, h.seed, [[0, vOf(eaveY)], [wl, vOf(eaveY)], [hz, vOf(ridgeY)]], wl, wallH);
    }
    // a white barge line at the ridge
    m.box(h.cx, ridgeY - 0.02, h.cz, hx + ov, 0.07, 0.09, h.yaw, [0.16, 0.18, 0.22], KIND.trim, h.seed);
    if (h.flags & DORMER && !(h.flags & (CHURCH | RENAISSANCE))) addDormer(m, h, roof, P, ridgeY, rise, slope);
    if (h.seed > 0.35 && !(h.flags & OUTBUILDING)) m.box(P(hx * (0.4 + 0.3 * smoothSeed(h.seed, 3)), 0, 0)[0], ridgeY - 0.1, P(hx * (0.4 + 0.3 * smoothSeed(h.seed, 3)), 0, 0)[2], 0.32, 0.65 + 0.2 * h.seed, 0.32, h.yaw, CHIMNEY, KIND.stone, h.seed);
  }
}

function addDormer(m, h, roof, P, ridgeY, rise, slope) {
  const u = (smoothSeed(h.seed, 5) - 0.5) * 0.9 * h.hx * 0.8, side = h.seed > 0.5 ? 1 : -1;
  const t = 0.42;                                                  // how far up the slope (0 eave .. 1 ridge)
  const vv = side * (h.hz + OVERHANG) * (1 - t), yy = h.eaveY + rise * t;
  const w = 0.72, hh = 0.62, depth = 0.95;
  const front = P(u, 0, vv + side * depth * 0.4);
  const yawBase = [P(u - w, 0, 0)[0] - h.cx, 0];
  void yawBase;
  const fy0 = yy - 0.1, fy1 = yy + hh * 1.7;
  const a = P(u - w, fy0, vv + side * depth), b = P(u + w, fy0, vv + side * depth), c = P(u + w, fy1, vv + side * depth), d = P(u - w, fy1, vv + side * depth);
  const face = side > 0 ? [a, b, c, d] : [b, a, d, c];
  m.face(face.map((p) => [p[0], p[1], p[2]]), TRIM, KIND.dormer, h.seed, [[0, 0], [2 * w, 0], [2 * w, fy1 - fy0], [0, fy1 - fy0]], 2 * w, fy1 - fy0);
  const roofTop = P(u, fy1 + 0.55, vv + side * depth * 0.1);
  const rb = P(u, fy1 + 0.0, vv + side * depth);
  for (const sgn of [-1, 1]) {
    const e0 = P(u + sgn * (w + 0.15), fy1, vv + side * (depth + 0.15)), e1 = P(u + sgn * (w + 0.15), fy1 + 0.05, vv - side * 0.0);
    m.face(sgn > 0 ? [e0, [rb[0], fy1 + 0.55, rb[2]], roofTop, e1] : [e1, roofTop, [rb[0], fy1 + 0.55, rb[2]], e0], roof, KIND.roof, h.seed, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  void front;
}

/** The church: the nave is a normal long house (flag 16); a square tower with a slate spire stands at its west end (the smaller wing if there is one). */
export function addChurchTower(m, houses) {
  const wall = [0.9, 0.84, 0.7];
  const nave = houses.reduce((best, h) => (h.hx * h.hz > best.hx * best.hz ? h : best), houses[0]);
  const small = houses.find((h) => h !== nave);
  const half = small ? Math.min(2.7, Math.max(1.9, Math.min(small.hx, small.hz))) : 2.4;
  const at = small ? [small.cx, small.cz] : [nave.cx + nave.ax * (nave.hx + half - 0.4), nave.cz + nave.az * (nave.hx + half - 0.4)];
  const baseY = Math.min(nave.base, small ? small.base : 1e9, nave.gMean - 1.2), bodyTop = nave.gMean + nave.ridge + 4.5;
  addSquareTower(m, at[0], at[1], nave.yaw, half, baseY, nave.gMean, bodyTop, bodyTop + half * 5.2, wall, [0.22, 0.25, 0.3]);
}

/** The medieval ruin: a rectangle of dressed sandstone with a ragged top (every 1.6 m of wall has its own height, the missing roof leaves a mossy cap), arrow slits and windows. */
function addRuin(m, h) {
  const { hx, hz } = h, y0 = h.base, g = h.gMean, H = h.eave;
  const P = (u, y, v) => [h.cx + h.ax * u + h.bx * v, y, h.cz + h.az * u + h.bz * v];
  const capY = g + H * 0.66;
  const sides = [[[-hx, hz], [hx, hz], 2 * hx, [h.bx, h.bz]], [[hx, hz], [hx, -hz], 2 * hz, [h.ax, h.az]], [[hx, -hz], [-hx, -hz], 2 * hx, [-h.bx, -h.bz]], [[-hx, -hz], [-hx, hz], 2 * hz, [-h.ax, -h.az]]];
  sides.forEach(([a, b, len, nrm], si) => {
    const n = Math.max(1, Math.ceil(len / 1.6));
    const top = (i) => g + H * (0.66 + 0.34 * Math.min(1, Math.max(0, hash(h.seed * 100, si, i) * 0.7 + 0.5 * hash(h.seed * 100, si, Math.floor(i / 3) + 50) - 0.1)));
    let prevTop = null;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, ty = top(i);
      const p0 = P(a[0] + (b[0] - a[0]) * t0, y0, a[1] + (b[1] - a[1]) * t0), p1 = P(a[0] + (b[0] - a[0]) * t1, y0, a[1] + (b[1] - a[1]) * t1);
      m.face([p0, p1, [p1[0], ty, p1[2]], [p0[0], ty, p0[2]]], RUIN_STONE, KIND.ashlar, h.seed, [[len * t0, y0 - g], [len * t1, y0 - g], [len * t1, ty - g], [len * t0, ty - g]], len, H);
      if (prevTop !== null && Math.abs(prevTop - ty) > 0.05) {                       // the step between two segments of different height
        const lo = Math.min(prevTop, ty), hi = Math.max(prevTop, ty);
        m.face([[p0[0], lo, p0[2]], [p0[0] - nrm[0] * 0.9, lo, p0[2] - nrm[1] * 0.9], [p0[0] - nrm[0] * 0.9, hi, p0[2] - nrm[1] * 0.9], [p0[0], hi, p0[2]]], RUIN_STONE, KIND.ashlar, h.seed, [[0, lo - g], [0.9, lo - g], [0.9, hi - g], [0, hi - g]], 0.9, H);
      }
      if (ty > g + H * 0.84) {                                                       // crenellations: only the tallest, best-preserved stretches still carry their battlements
        const segLen = len / n, segTx = (p1[0] - p0[0]) / segLen, segTz = (p1[2] - p0[2]) / segLen, yawSeg = Math.atan2(segTz, segTx);
        const MERLON_W = 0.5, step = MERLON_W + 0.42, count = Math.max(1, Math.floor(segLen / step));
        for (let k = 0; k < count; k++) {
          if (hash(h.seed * 77, si * 13 + i, k) > 0.7) continue;                     // a merlon or two has crumbled away, like the rest of the ruin
          const uc = (k + 0.5) / count, mx = p0[0] + (p1[0] - p0[0]) * uc, mz = p0[2] + (p1[2] - p0[2]) * uc;
          const mh = 0.45 + 0.3 * hash(h.seed * 31, si, i * 7 + k);
          m.box(mx, ty, mz, MERLON_W / 2, mh / 2, 0.42, yawSeg, RUIN_STONE, KIND.ashlar, h.seed);
        }
      }
      prevTop = ty;
    }
    const nw = Math.floor(len / 4.2);
    for (let i = 0; i < nw; i++) {
      const u = (i + 0.5) / nw, wx = a[0] + (b[0] - a[0]) * u, wz = a[1] + (b[1] - a[1]) * u;
      const dirU = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      for (const [yy, w, hgt] of [[2.4, 0.22, 1.0], [6.0, 0.5, 1.8], [9.2, 0.5, 1.8]]) {
        if (yy + hgt > H * 0.9 || hash(h.seed * 50, si * 7 + i, yy) > 0.78) continue;
        const o = 0.05;
        const q = (du, y) => P(wx + dirU[0] * du + nrm[0] * o, g + y, wz + dirU[1] * du + nrm[1] * o);
        m.face([q(-w, yy), q(w, yy), q(w, yy + hgt), q(-w, yy + hgt)], SLIT, KIND.glass, h.seed, [[0, 0], [1, 0], [1, 1], [0, 1]]);
        if (w > 0.3) m.face([q(-w - 0.12, yy + hgt), q(w + 0.12, yy + hgt), q(w + 0.12, yy + hgt + 0.16), q(-w - 0.12, yy + hgt + 0.16)], [0.92, 0.78, 0.5], KIND.trim, h.seed, [[0, 0], [1, 0], [1, 1], [0, 1]]);     // the lintel
      }
    }
  });
  m.face([P(-hx, capY, hz), P(hx, capY, hz), P(hx, capY, -hz), P(-hx, capY, -hz)], MOSS_TOP, KIND.flat, h.seed, [[0, 0], [2 * hx, 0], [2 * hx, 2 * hz], [0, 2 * hz]]);
}

/** Round towers of the ruin on the outer corners of its wings (not inside another wing), spaced apart. */
function addRuinTowers(m, wings) {
  const corners = [];
  for (const h of wings) {
    for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = h.cx + h.ax * su * h.hx + h.bx * sv * h.hz, z = h.cz + h.az * su * h.hx + h.bz * sv * h.hz;
      const covered = wings.some((o) => o !== h && Math.abs((x - o.cx) * o.ax + (z - o.cz) * o.az) < o.hx + 0.5 && Math.abs((x - o.cx) * o.bx + (z - o.cz) * o.bz) < o.hz + 0.5);
      if (!covered) corners.push({ x, z, h, inx: -su * h.ax - sv * h.bx, inz: -su * h.az - sv * h.bz });
    }
  }
  const chosen = [];
  for (const c of corners.sort((a, b) => hash(a.x, a.z) - hash(b.x, b.z))) if (chosen.length < 4 && chosen.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > 13)) chosen.push(c);
  chosen.forEach((c, ti) => {
    const R = ti % 2 === 0 ? 4.6 : 3.7, H = c.h.eave * (1.22 + 0.12 * hash(ti, 3)), g = c.h.gMean, y0 = c.h.base;
    const l = Math.hypot(c.inx, c.inz) || 1, cx = c.x + (c.inx / l) * R * 0.45, cz = c.z + (c.inz / l) * R * 0.45;
    const N = 16, tops = Array.from({ length: N }, (_, i) => g + H * (0.78 + 0.22 * hash(ti, i, 9)));
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * 2 * Math.PI, a1 = ((i + 1) / N) * 2 * Math.PI;
      const p0 = [cx + Math.cos(a0) * R, 0, cz + Math.sin(a0) * R], p1 = [cx + Math.cos(a1) * R, 0, cz + Math.sin(a1) * R], ty = tops[i], arc = (2 * Math.PI * R) / N;
      m.face([[p0[0], y0, p0[2]], [p1[0], y0, p1[2]], [p1[0], ty, p1[2]], [p0[0], ty, p0[2]]], RUIN_STONE, KIND.ashlar, c.h.seed, [[arc * i, y0 - g], [arc * (i + 1), y0 - g], [arc * (i + 1), ty - g], [arc * i, ty - g]], arc * N, H);
      if (i % 4 === 1) {                                                         // an arrow slit
        const am = (a0 + a1) / 2, o = R + 0.05, q = (da, y) => [cx + Math.cos(am + da) * o, g + y, cz + Math.sin(am + da) * o];
        m.face([q(-0.05, 3.0), q(0.05, 3.0), q(0.05, 4.3), q(-0.05, 4.3)], SLIT, KIND.glass, 0, [[0, 0], [1, 0], [1, 1], [0, 1]]);
        if (H > 11) m.face([q(-0.09, 7.2), q(0.09, 7.2), q(0.09, 9.0), q(-0.09, 9.0)], SLIT, KIND.glass, 0, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
    }
    const capY = g + H * 0.76;
    for (let i = 0; i < N; i++) m.face([[cx, capY, cz], [cx + Math.cos((i / N) * 2 * Math.PI) * R, capY, cz + Math.sin((i / N) * 2 * Math.PI) * R], [cx + Math.cos(((i + 1) / N) * 2 * Math.PI) * R, capY, cz + Math.sin(((i + 1) / N) * 2 * Math.PI) * R]], MOSS_TOP, KIND.flat, 0, [[0, 0], [1, 0], [0, 1]]);
  });
}

/** A square tower with a pyramid roof (the church tower, the corner tower of the Renaissance castle). */
function addSquareTower(m, x, z, yaw, half, baseY, groundY, topY, spireTop, wall, roofColor) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const Pt = (u, y, v) => [x + u * c - v * s, y, z + u * s + v * c];
  const corners = [[-half, half], [half, half], [half, -half], [-half, -half]];
  for (let i = 0; i < 4; i++) {
    const [u0, v0] = corners[i], [u1, v1] = corners[(i + 1) % 4], len = Math.hypot(u1 - u0, v1 - v0);
    m.face([Pt(u0, baseY, v0), Pt(u1, baseY, v1), Pt(u1, topY, v1), Pt(u0, topY, v0)], wall, KIND.wall, 0.31, [[0, baseY - groundY], [len, baseY - groundY], [len, topY - groundY], [0, topY - groundY]], len, topY - groundY - 3);
    const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2, du = (u1 - u0) / len, dv = (v1 - v0) / len, yb = topY - 2.4;
    const nu = dv, nv = -du;                                                   // outward normal of a clockwise corner list
    const q = (d, y) => Pt(mu + du * d + nu * 0.04, y, mv + dv * d + nv * 0.04);
    m.face([q(-0.5, yb), q(0.5, yb), q(0.5, yb + 1.6), q(-0.5, yb + 1.6)], [0.12, 0.13, 0.16], KIND.glass, 0.3, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  const apex = Pt(0, spireTop, 0), L = Math.hypot(half, spireTop - topY);
  for (let i = 0; i < 4; i++) {
    const [u0, v0] = corners[i], [u1, v1] = corners[(i + 1) % 4];
    m.face([Pt(u0 * 1.1, topY - 0.1, v0 * 1.1), Pt(u1 * 1.1, topY - 0.1, v1 * 1.1), apex], roofColor, KIND.spire, 0.3, [[0, 0], [2 * half, 0], [half, L]]);
  }
}

/** Builds the geometry of every cell: Map cellKey -> { geometry, bx, bz } (merged houses). houses = describeHouses entries. */
export function buildTownCells(houses) {
  const cells = new Map();
  const churchParts = houses.filter((h) => h.flags & CHURCH);
  for (const h of houses) {
    const key = `${Math.floor(h.cx / CELL)},${Math.floor(h.cz / CELL)}`;
    let c = cells.get(key);
    if (!c) { c = { m: new MeshBuilder(), bx: Math.floor(h.cx / CELL), bz: Math.floor(h.cz / CELL), cx: 0, cz: 0, n: 0 }; cells.set(key, c); }
    addHouse(c.m, h); c.cx += h.cx; c.cz += h.cz; c.n++;
  }
  const ruinWings = houses.filter((h) => h.flags & RUIN), castleWings = houses.filter((h) => h.flags & RENAISSANCE);
  const cellOf = (h) => cells.get(`${Math.floor(h.cx / CELL)},${Math.floor(h.cz / CELL)}`);
  if (ruinWings.length) addRuinTowers(cellOf(ruinWings[0]).m, ruinWings);
  if (castleWings.length) {                                           // the Renaissance castle: a tall square tower with a steep pyramid roof on the corner furthest from its middle
    const wing = castleWings.reduce((a, h) => (h.hx > a.hx ? h : a), castleWings[0]);
    let best = null;                                                                  // the tower stands at the end of the longest wing that lies furthest west on its south side (as on the photo)
    for (const su of [1, -1]) for (const sv of [1, -1]) { const x = wing.cx + wing.ax * su * (wing.hx - 2.2) + wing.bx * sv * (wing.hz - 2.2), z = wing.cz + wing.az * su * (wing.hx - 2.2) + wing.bz * sv * (wing.hz - 2.2), score = -x + z * 0.5; if (!best || score > best.score) best = { x, z, score, h: wing }; }
    addSquareTower(cellOf(best.h).m, best.x, best.z, best.h.yaw, 2.6, best.h.base, best.h.gMean, best.h.gMean + 14.5, best.h.gMean + 24, SANDSTONE, [0.2, 0.23, 0.28]);
  }
  if (churchParts.length) {
    const byBuilding = new Map();
    for (const h of churchParts) { const k = `${Math.round(h.cx / 40)},${Math.round(h.cz / 40)}`; (byBuilding.get(k) || byBuilding.set(k, []).get(k)).push(h); }
    for (const group of byBuilding.values()) {
      const key = `${Math.floor(group[0].cx / CELL)},${Math.floor(group[0].cz / CELL)}`;
      addChurchTower(cells.get(key).m, group);
    }
  }
  const out = new Map();
  for (const [key, c] of cells) out.set(key, { geometry: c.m.build(), bx: c.bx, bz: c.bz, centre: [c.cx / c.n, c.cz / c.n], count: c.n });
  return out;
}

