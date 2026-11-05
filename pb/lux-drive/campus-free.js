/* The things that stand free on the campus, not on a wall: the bridge to the main entrance of the Lycée Aline Mayrisch, the steel pergola of the
 * Conservatoire, signs on their own boards, benches, picnic tables, bins, bollards, the coloured seats in front of the Forum, a playground.
 * Each is a few boxes drawn into the props soup; items come from the bake (campus-data.js: `free` and `furniture`).  Pure (no THREE). */
import { paint } from './landmark-soup.js';
import { drawSign, freeFrame } from './campus-wallfx.js';
import { gradientTri } from './campus-kit.js';

const STEEL = [0.30, 0.32, 0.34];
const WOOD = [0.52, 0.38, 0.24];
const SINK = 0.3;

/** A box along the direction `theta` (radians, atan2(dz, dx)): `along` long, `across` wide, `h` high, its base middle at (x, y0, z). */
const bx = (soup, x, y0, z, along, h, across, theta, color, topColor = null) => soup.box(x, y0, z, along, h, across, -theta, color, { topColor: topColor || color });

const HEATHER = [[0.62, 0.30, 0.46], [0.52, 0.24, 0.42], [0.70, 0.40, 0.54]];     // the heather in the troughs (photo Aline_Mayrisch_101: pink and purple)
const PLANTER_STEP = 1.7;                                                              // m: one heather trough every this far along a bridge wall
const PLANTER_LEN = 0.7;

/** The walkway to the porch of the Lycée Aline Mayrisch: a deck at the level of the schoolyard between two concrete planter walls over the sunken court, each wall
 * with a row of heather troughs on top and a slim steel rail beside them (photo Aline_Mayrisch_101). */
function bridge(soup, ground, b) {
  const deck = ground(b.x, b.z0 - 1.0);
  const zm = (b.z0 + b.z1) / 2, len = Math.abs(b.z1 - b.z0);
  const foot = Math.min(ground(b.x - b.w / 2, zm), ground(b.x + b.w / 2, zm)) - 0.5;
  const top = deck + 1.1;
  for (const side of [-1, 1]) {
    const x = b.x + side * (b.w / 2 - 0.22);
    bx(soup, x, foot, zm, len, top - foot, 0.45, Math.PI / 2, paint(b.wall, side + 3, 0.04), [0.82, 0.82, 0.80]);
    const n = Math.max(1, Math.floor(len / PLANTER_STEP));
    for (let k = 0; k < n; k++) {                                                            // the heather troughs on the wall
      const z = Math.min(b.z0, b.z1) + ((k + 0.5) * len) / n;
      bx(soup, x, top, z, PLANTER_LEN, 0.2, 0.3, Math.PI / 2, [0.30, 0.31, 0.32], HEATHER[(k + (side > 0 ? 1 : 0)) % HEATHER.length]);
    }
    bx(soup, x + side * 0.28, top, zm, len, 0.05, 0.05, Math.PI / 2, STEEL);                // the rail on the outer side
    for (const z of [Math.min(b.z0, b.z1) + 0.3, zm, Math.max(b.z0, b.z1) - 0.3]) bx(soup, x + side * 0.28, top, z, 0.05, 0.9, 0.05, 0, STEEL);
  }
  soup.box(b.x, deck - 0.45, zm, b.w - 0.9, 0.45, len, 0, [0.50, 0.50, 0.50], { topColor: [0.62, 0.60, 0.56] });   // the deck: brick pavers
}

/** The glazed lobby of the Lycée Aline Mayrisch (orthophoto: a block 16 m wide that fills the sunken court from the building to the edge of the yard; photo
 * LAML_04): a one-storey glass pavilion with white mullions whose flat roof is level with the yard, a dark skylight strip at the yard edge and two roof lights. */
function lobby(soup, ground, l) {
  const deck = ground(l.x, l.z0 - 1.0);
  const zm = (l.z0 + l.z1) / 2, len = Math.abs(l.z1 - l.z0);
  const foot = Math.min(ground(l.x - l.w / 2, zm), ground(l.x + l.w / 2, zm)) - 0.4;
  const roof = deck - 0.05, glassTop = roof - 0.55;
  const zFront = Math.min(l.z0, l.z1) + 0.2;
  const GLASS_SKY = [0.46, 0.62, 0.80], GLASS_ROOM = [0.14, 0.18, 0.22];
  const gy = (x0, z0, x1, z1) => {                                       // one pane run: sky above, dark room below (a gradient quad)
    const A = [x0, foot, z0], B = [x1, foot, z1], C = [x1, glassTop, z1], D = [x0, glassTop, z0];
    gradientTri(soup, A, B, C, GLASS_ROOM, GLASS_ROOM, GLASS_SKY);
    gradientTri(soup, A, C, D, GLASS_ROOM, GLASS_SKY, GLASS_SKY);
  };
  const x0 = l.x - l.w / 2, x1 = l.x + l.w / 2, zBack = Math.max(l.z0, l.z1) - 0.2;
  gy(x0, zFront, x1, zFront);                                           // the front, towards the yard
  gy(x0, zFront, x0, zBack);                                            // both sides
  gy(x1, zFront, x1, zBack);
  const MULL = 1.9;
  const nx = Math.max(1, Math.round(l.w / MULL)), nz = Math.max(1, Math.round(len / MULL));
  for (let k = 0; k <= nx; k++) bx(soup, x0 + (l.w * k) / nx, foot, zFront - 0.03, 0.12, glassTop - foot, 0.14, 0, l.frame);
  for (const x of [x0, x1]) for (let k = 1; k <= nz; k++) bx(soup, x - 0.03 * Math.sign(x - l.x), foot, zFront + ((zBack - zFront) * k) / nz - 0.12, 0.14, glassTop - foot, 0.12, 0, l.frame);
  bx(soup, l.x, glassTop - 0.1, zFront - 0.03, l.w + 0.3, 0.14, 0.14, 0, l.frame);                    // the transom under the fascia
  soup.box(l.x, glassTop, zm, l.w + 0.5, roof - glassTop, len + 0.2, 0, l.fascia, { topColor: [0.62, 0.60, 0.56] });   // the roof slab, level with the yard
  soup.box(l.x, roof, zFront + 1.1, l.w - 1.0, 0.06, 1.8, 0, [0.12, 0.16, 0.22], { topColor: [0.34, 0.46, 0.62] });   // the dark skylight strip at the yard edge
  for (const dx of [-3.2, 3.2]) soup.box(l.x + dx, roof, zm + 1.5, 2.2, 0.22, 1.4, 0, [0.70, 0.72, 0.74], { topColor: [0.46, 0.60, 0.78] });   // two roof lights
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
const STEP_SEGMENT = 8;                // m: the flight is cut into pieces this long, each follows the ground on its own (longer pieces leave tall risers where the ground bends)
const STEP_LIFT = 0.04;                // m: a tread lies this far over the highest ground under it
const STEP_MIN = 0.07;                 // m: no riser is lower than this
const STEP_RISER = [0.62, 0.61, 0.58];

/** A tall yard lamp: a slim grey pole with a bent arm and a lamp head (4 sides, 14 triangles). */
function lamp(soup, ground, l) {
  const y = ground(l.x, l.z) - 0.2;
  soup.frustum(l.x, l.z, 0.11, 0.07, y, y + l.h, 4, [0.50, 0.52, 0.54], { cap: false });
  bx(soup, l.x, y + l.h - 0.1, l.z - 0.55, 0.12, 0.12, 1.3, 0, STEEL);
  bx(soup, l.x, y + l.h - 0.2, l.z - 1.1, 0.28, 0.18, 0.5, 0, [0.74, 0.74, 0.72]);
}

const RED = [0.80, 0.14, 0.12], POLE_WHITE = [0.92, 0.92, 0.90], BLACK = [0.08, 0.08, 0.09];

/** A traffic light of the city of Luxembourg (photo Athénée Dez_07): a red-and-white striped pole, two black signal heads with hoods facing the road, one lit green. */
function tlight(soup, ground, l) {
  const y = ground(l.x, l.z) - 0.1, H = 3.1, SEG = 4;
  for (let i = 0; i < SEG; i++) soup.frustum(l.x, l.z, 0.07, 0.07, y + (H * i) / SEG, y + (H * (i + 1)) / SEG, 4, i % 2 ? POLE_WHITE : RED, { cap: i === SEG - 1 });
  const nx = Math.cos(l.yaw), nz = Math.sin(l.yaw);                                            // the way the heads face
  const th = -l.yaw + Math.PI / 2;
  for (const [dy, g] of [[0, [0.2, 0.85, 0.35]], [-0.62, [0.3, 0.05, 0.05]]]) {
    const cy = y + H - 0.2 + dy;
    soup.box(l.x + nx * 0.2, cy - 0.3, l.z + nz * 0.2, 0.3, 0.6, 0.26, th, BLACK, { topColor: BLACK });
    const lx = l.x + nx * 0.34, lz = l.z + nz * 0.34, sx = Math.cos(th) * 0.1, sz = -Math.sin(th) * 0.1;
    soup.quad([lx - sx, cy - 0.06, lz - sz], [lx + sx, cy - 0.06, lz + sz], [lx + sx, cy + 0.14, lz + sz], [lx - sx, cy + 0.14, lz - sz], g);          // the lamp
  }
}

/** Two grey electrical cabinets side by side on the pavement (photo Athénée Dez_07). */
function cabinet(soup, ground, c) {
  const y = ground(c.x, c.z) - 0.1, nx = Math.cos(c.yaw + Math.PI / 2), nz = Math.sin(c.yaw + Math.PI / 2);
  for (const k of [-0.5, 0.5]) bx(soup, c.x + nx * k * 0.85, y, c.z + nz * k * 0.85, 0.8, 1.35, 0.4, c.yaw + Math.PI / 2, [0.78, 0.79, 0.78], [0.86, 0.87, 0.86]);
}

const DRAW = { tlight, cabinet, steps, lamp, bridge, lobby, pergola, sign: freeSign, bench, table, bin, bollard, seat, playground };

/** Draws one free item (a record of the bake: `k` = what it is); unknown kinds are an error (the bake and the game must agree). */
export function drawFree(soup, ground, item) {
  const draw = DRAW[item.k];
  if (!draw) throw new Error(`campus: unknown free item '${item.k}'`);
  draw(soup, ground, item);
}

export const FREE_KINDS = Object.keys(DRAW);
