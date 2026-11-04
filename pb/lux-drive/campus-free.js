/* The things that stand free on the campus, not on a wall: the bridge to the main entrance of the Lycée Aline Mayrisch, the steel pergola of the
 * Conservatoire, signs on their own boards, benches, picnic tables, bins, bollards, the coloured seats in front of the Forum, a playground.
 * Each is a few boxes drawn into the props soup; items come from the bake (campus-data.js: `free` and `furniture`).  Pure (no THREE). */
import { paint } from './landmark-soup.js';
import { drawSign, freeFrame } from './campus-wallfx.js';

const STEEL = [0.30, 0.32, 0.34];
const WOOD = [0.52, 0.38, 0.24];
const SINK = 0.3;

/** A box along the direction `theta` (radians, atan2(dz, dx)): `along` long, `across` wide, `h` high, its base middle at (x, y0, z). */
const bx = (soup, x, y0, z, along, h, across, theta, color, topColor = null) => soup.box(x, y0, z, along, h, across, -theta, color, { topColor: topColor || color });

/** The walkway to the porch of the Lycée Aline Mayrisch: a deck at the level of the schoolyard on two concrete cheek walls over the sunken court. */
function bridge(soup, ground, b) {
  const deck = ground(b.x, b.z0 - 1.0);
  const zm = (b.z0 + b.z1) / 2, len = Math.abs(b.z1 - b.z0);
  const foot = Math.min(ground(b.x - b.w / 2, zm), ground(b.x + b.w / 2, zm)) - 0.5;
  for (const side of [-1, 1]) bx(soup, b.x + side * (b.w / 2 - 0.22), foot, zm, len, deck + 1.1 - foot, 0.45, Math.PI / 2, paint(b.wall, side + 3, 0.04), [0.82, 0.82, 0.80]);
  soup.box(b.x, deck - 0.45, zm, b.w - 0.9, 0.45, len, 0, [0.50, 0.50, 0.50], { topColor: [0.62, 0.60, 0.56] });   // the deck: brick pavers
}

/** The long steel pergola: posts on both sides, cross beams, a pale glazed roof. */
function pergola(soup, ground, p) {
  const theta = Math.atan2(p.z1 - p.z0, p.x1 - p.x0), len = Math.hypot(p.x1 - p.x0, p.z1 - p.z0);
  const dx = Math.cos(theta), dz = Math.sin(theta), nx = -dz, nz = dx;
  const n = Math.max(1, Math.round(len / 4));
  const at = (u, v) => [p.x0 + dx * u + nx * v, p.z0 + dz * u + nz * v];
  for (let i = 0; i <= n; i++) {
    const u = (len * i) / n;
    for (const v of [-p.w / 2, p.w / 2]) {
      const [x, z] = at(u, v);
      soup.box(x, ground(x, z) - SINK, z, 0.2, p.h + SINK, 0.2, 0, p.color);
    }
    const [x, z] = at(u, 0);
    bx(soup, x, ground(x, z) + p.h, z, 0.18, 0.2, p.w + 0.4, theta + Math.PI / 2, p.color);
  }
  for (const v of [-p.w / 2, p.w / 2]) { const [x, z] = at(len / 2, v); bx(soup, x, ground(x, z) + p.h + 0.2, z, len + 0.3, 0.16, 0.2, theta, p.color); }
  const c = at(len / 2, 0), y = ground(c[0], c[1]) + p.h + 0.32;
  const corners = [at(0, -p.w / 2), at(len, -p.w / 2), at(len, p.w / 2), at(0, p.w / 2)].map(([x, z]) => [x, y, z]);
  soup.quad(corners[0], corners[1], corners[2], corners[3], [0.58, 0.64, 0.68]);
}

/** A sign on its own plane (the fascia of the Blumm hall): the same board and lettering as the signs on walls. */
function freeSign(soup, ground, s) {
  const f = freeFrame(s.x, s.z, s.nx, s.nz);
  drawSign({ soup, f }, { ...s, out: 0.02 }, 0, ground(s.x, s.z) + s.y);
}

/** A bench: seat, backrest, two legs; `color` the slats (green metal or brown wood in OSM). */
function bench(soup, ground, b) {
  const y = ground(b.x, b.z);
  const th = b.yaw;
  const along = (u, v) => [b.x + Math.cos(th) * u - Math.sin(th) * v, b.z + Math.sin(th) * u + Math.cos(th) * v];
  bx(soup, b.x, y + 0.42, b.z, 1.7, 0.07, 0.46, th, b.color, shadeTop(b.color));
  const [bxp, bzp] = along(0, -0.24);
  bx(soup, bxp, y + 0.72, bzp, 1.7, 0.4, 0.05, th, b.color);
  for (const u of [-0.7, 0.7]) { const [x, z] = along(u, 0); bx(soup, x, y, z, 0.06, 0.42, 0.42, th, STEEL); }
}

const shadeTop = (c) => [Math.min(1, c[0] * 1.15), Math.min(1, c[1] * 1.15), Math.min(1, c[2] * 1.15)];

/** A picnic table: top, two benches, trestle legs. */
function table(soup, ground, t) {
  const y = ground(t.x, t.z), th = t.yaw;
  bx(soup, t.x, y + 0.74, t.z, 2.0, 0.06, 0.75, th, WOOD, shadeTop(WOOD));
  for (const v of [-0.65, 0.65]) {
    const x = t.x - Math.sin(th) * v, z = t.z + Math.cos(th) * v;
    bx(soup, x, y + 0.42, z, 2.0, 0.06, 0.28, th, WOOD, shadeTop(WOOD));
  }
  for (const u of [-0.75, 0.75]) { const x = t.x + Math.cos(th) * u, z = t.z + Math.sin(th) * u; bx(soup, x, y, z, 0.07, 0.74, 1.5, th, WOOD); }
}

/** A bin: a short green drum. */
function bin(soup, ground, b) {
  const y = ground(b.x, b.z);
  soup.frustum(b.x, b.z, 0.26, 0.26, y, y + 0.9, 6, [0.16, 0.38, 0.26], { cap: true });
}

/** A concrete bollard cube (the row along the plaza of the Forum). */
function bollard(soup, ground, b) {
  bx(soup, b.x, ground(b.x, b.z) - 0.1, b.z, 0.42, 0.75, 0.42, 0, [0.66, 0.65, 0.62], [0.74, 0.73, 0.70]);
}

/** One coloured zig-zag seat of the Forum square: three slabs bent at an angle (the photo: green, red, blue, yellow). */
function seat(soup, ground, s) {
  const y = ground(s.x, s.z);
  const turn = [0.0, 0.9, -0.9];
  const pos = [[0, 0], [1.9, 0.3], [3.6, -0.5]];
  for (let i = 0; i < 3; i++) {
    const th = s.yaw + turn[i] * 0.55;
    const x = s.x + Math.cos(s.yaw) * pos[i][0] - Math.sin(s.yaw) * pos[i][1], z = s.z + Math.sin(s.yaw) * pos[i][0] + Math.cos(s.yaw) * pos[i][1];
    bx(soup, x, y - 0.1, z, 2.1, 0.55, 0.9, th, paint(s.color, i, 0.03), shadeTop(s.color));
    bx(soup, x, y + 0.45, z - Math.cos(th) * 0.0, 2.1, 0.5, 0.25, th + 0.0, shade(s.color, 0.9));
  }
}

const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** A playground: a slide tower with a slanted slide, a swing frame, a sandpit, in the corner of the area's bounds [x0, z0, x1, z1]. */
function playground(soup, ground, p) {
  const [x0, z0, x1, z1] = p.bounds;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const y = ground(cx, cz);
  const BLUE = [0.16, 0.36, 0.70], RED = [0.78, 0.18, 0.14], YELLOW = [0.94, 0.78, 0.18];
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) soup.box(cx - 6 + dx * 1.1, y - 0.2, cz + dz * 1.1, 0.2, 3.0, 0.2, 0, BLUE);     // the tower
  soup.box(cx - 6, y + 2.0, cz, 2.6, 0.2, 2.6, 0, YELLOW, { topColor: YELLOW });
  soup.quad([cx - 4.6, y + 2.0, cz - 0.6], [cx - 4.6, y + 2.0, cz + 0.6], [cx - 1.8, y + 0.15, cz + 0.6], [cx - 1.8, y + 0.15, cz - 0.6], RED);              // the slide
  for (const dz of [-1.6, 1.6]) { soup.box(cx + 2, y - 0.2, cz + dz, 0.16, 2.6, 0.16, 0, STEEL); }
  soup.box(cx + 2, y + 2.35, cz, 0.18, 0.18, 3.5, 0, STEEL);                                                                                                // the swing frame
  for (const dz of [-0.6, 0.6]) soup.box(cx + 2, y + 0.55, cz + dz, 0.4, 0.06, 0.35, 0, BLUE);
  soup.box(cx + 6, y, cz, 4.0, 0.25, 3.2, 0, [0.80, 0.72, 0.52], { topColor: [0.85, 0.77, 0.56] });                                                           // the sandpit
}

/** A flight of wide steps over a quadrilateral [A, B, C, D] (A-B and D-C the two long edges): treads and risers rise from the lower edge to the higher one, following the ground along it. */
function steps(soup, ground, s) {
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const [A, B, C, D] = s.quad;
  const mid = (p, q) => ground((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  const lowFirst = mid(A, B) <= mid(D, C);
  const [L0, L1, U0, U1] = lowFirst ? [A, B, D, C] : [D, C, A, B];
  const rise = mid(U0, U1) - mid(L0, L1);
  const n = Math.max(4, Math.min(24, Math.round(rise / STEP_RISE)));
  const len = Math.hypot(L1[0] - L0[0], L1[1] - L0[1]);
  const segs = Math.max(1, Math.ceil(len / STEP_SEGMENT));
  for (let j = 0; j < segs; j++) {
    const u0 = j / segs, u1 = (j + 1) / segs;
    let yPrev = null;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const pa = lerp(lerp(L0, L1, u0), lerp(U0, U1, u0), t0), pb = lerp(lerp(L0, L1, u1), lerp(U0, U1, u1), t0);
      const pc = lerp(lerp(L0, L1, u1), lerp(U0, U1, u1), t1), pd = lerp(lerp(L0, L1, u0), lerp(U0, U1, u0), t1);
      const top = Math.max(...[pa, pb, pc, pd, lerp(pa, pc, 0.5)].map((p) => ground(p[0], p[1]))) + STEP_LIFT;
      const y = yPrev === null ? top : Math.max(top, yPrev + STEP_MIN);
      const yLow = yPrev === null ? Math.min(...[pa, pb].map((p) => ground(p[0], p[1]))) - 0.3 : yPrev;
      soup.quad([pa[0], yLow, pa[1]], [pb[0], yLow, pb[1]], [pb[0], y, pb[1]], [pa[0], y, pa[1]], paint(STEP_RISER, i + j * 7, 0.03));
      soup.quad([pa[0], y, pa[1]], [pb[0], y, pb[1]], [pc[0], y, pc[1]], [pd[0], y, pd[1]], paint(s.color, i + j * 5, 0.03));
      yPrev = y;
    }
  }
}

const STEP_RISE = 0.16;                // m: a step is this high (the number of steps follows from the height of the flight)
const STEP_SEGMENT = 14;               // m: the flight is cut into pieces this long, each follows the ground on its own
const STEP_LIFT = 0.04;                // m: a tread lies this far over the highest ground under it
const STEP_MIN = 0.07;                 // m: no riser is lower than this
const STEP_RISER = [0.48, 0.47, 0.45];

/** A tall yard lamp: a slim grey pole with a bent arm and a lamp head (4 sides, 14 triangles). */
function lamp(soup, ground, l) {
  const y = ground(l.x, l.z) - 0.2;
  soup.frustum(l.x, l.z, 0.11, 0.07, y, y + l.h, 4, [0.50, 0.52, 0.54], { cap: false });
  bx(soup, l.x, y + l.h - 0.1, l.z - 0.55, 0.12, 0.12, 1.3, 0, STEEL);
  bx(soup, l.x, y + l.h - 0.2, l.z - 1.1, 0.28, 0.18, 0.5, 0, [0.74, 0.74, 0.72]);
}

const DRAW = { steps, lamp, bridge, pergola, sign: freeSign, bench, table, bin, bollard, seat, playground };

/** Draws one free item (a record of the bake: `k` = what it is); unknown kinds are an error (the bake and the game must agree). */
export function drawFree(soup, ground, item) {
  const draw = DRAW[item.k];
  if (!draw) throw new Error(`campus: unknown free item '${item.k}'`);
  draw(soup, ground, item);
}

export const FREE_KINDS = Object.keys(DRAW);
