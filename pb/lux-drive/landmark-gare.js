/* The Gare Centrale of Luxembourg (city12, QA3 section 3 item 5): the bake has no block for the station building (OSM draws it, the LOD2 bake
 * missed it: only the indoor footways were there), so from the Avenue de la Liberté the long glass platform roof behind it read as the station.
 *
 * Built from the photographs (Commons, 2016 - 2019) and the OSM outlines (ODbL, (c) OpenStreetMap contributors: way 209293282 the station,
 * 209293283 the pavilion with the pyramid roof, 198144651 the glass hall of 2012), in the frame of the building: s runs along the front from
 * its north-east corner towards the south-west, u is the distance in front of the long front (Place de la Gare, positive).
 *   - the Baroque-revival building of 1907 - 1913 (Rüdell): pale sandstone, two storeys under steep slate hip roofs with dormers;
 *   - the clock tower left of the main hall: a square stone shaft with a clock on every face, a cornice and balustrade, a copper bell roof,
 *     an open octagonal belfry, a small dome, a lantern and a needle (~40 m);
 *   - the main hall: a projecting gable with the great round-arched window between paired columns, the glass marquise over the doors;
 *   - in front of the south-west wing the glass hall of 2012 (steel mullions, flat roof).
 * Same contract as the other landmark builders: { soup, walls, hideBuildings, hideDecks, info }; it stands on the ground at every corner. */
import { Soup, axisFrame, paint } from './landmark-soup.js';
import { PALETTE as C } from './landmark-palette.js';
import { edgeWalls, groundRange, blocksNear } from './landmark-util.js';
import { edgeFrame, windowGrid, slab, panel, roundArch } from './landmark-facade.js';

const SINK = 1.0;                       // m, the walls go this far under the ground (the ground is a carved lattice: no cracks)
const TAU = Math.PI * 2;

// the frame: the north-east corner of the long front, and the direction of the front (fitted to the back wall of way 209293282, within 0.2 m over 100 m)
const ORIGIN = [5344.0, 9996.0];
const ALONG = [-0.3410, 0.9401];

/* The outlines in the world frame (x east, z south, m). */
const STATION = [[5373.0, 10014.0], [5370.6, 10020.8], [5365.6, 10034.5], [5360.4, 10048.8], [5356.3, 10060.4], [5351.4, 10073.8], [5348.9, 10080.9], [5343.5, 10095.8],
  [5333.0, 10092.1], [5331.9, 10095.3], [5327.5, 10093.6], [5328.6, 10090.5], [5327.9, 10090.2], [5329.5, 10085.4], [5330.0, 10084.0], [5329.0, 10082.4], [5331.1, 10080.8],
  [5331.5, 10079.5], [5333.0, 10075.5], [5335.8, 10076.4], [5338.3, 10069.3], [5339.5, 10065.7], [5337.8, 10065.2], [5337.1, 10063.6], [5342.9, 10047.2], [5337.5, 10045.3],
  [5333.5, 10043.8], [5331.3, 10049.6], [5330.1, 10050.5], [5325.8, 10049.0], [5325.3, 10047.5], [5328.9, 10037.6], [5326.3, 10036.7], [5326.1, 10035.4], [5324.4, 10035.9],
  [5324.0, 10033.8], [5324.0, 10031.2], [5324.7, 10028.3], [5326.5, 10025.3], [5328.3, 10023.3], [5329.8, 10022.1], [5330.7, 10023.2], [5331.6, 10022.6], [5333.7, 10023.3],
  [5335.0, 10019.7], [5336.0, 10019.2], [5338.1, 10019.8], [5340.8, 10011.8], [5343.7, 10003.5], [5342.4, 10000.2], [5344.0, 9996.0], [5348.1, 9994.9], [5350.9, 9996.0],
  [5357.2, 9998.2], [5358.1, 9995.8], [5359.7, 9995.5], [5361.2, 9996.2], [5361.7, 9996.9], [5360.9, 9999.4], [5365.4, 10001.0], [5362.1, 10010.2]];
const PAVILION = [[5382.1, 9988.9], [5373.0, 10014.0], [5362.1, 10010.2], [5365.4, 10001.0], [5367.4, 9995.2], [5371.0, 9985.0]];
const HALL = [[5337.1, 10063.6], [5342.9, 10047.2], [5337.5, 10045.3], [5333.5, 10043.8], [5331.3, 10049.6], [5330.6, 10052.0], [5329.4, 10051.6], [5328.0, 10055.9],
  [5321.0, 10054.8], [5318.8, 10061.1], [5314.7, 10072.7], [5311.0, 10083.3], [5304.9, 10100.6], [5304.2, 10102.5], [5311.4, 10105.1], [5323.6, 10109.4], [5328.9, 10094.1],
  [5327.5, 10093.6], [5328.6, 10090.5], [5327.9, 10090.2], [5329.5, 10085.4], [5330.0, 10084.0], [5329.0, 10082.4], [5331.1, 10080.8], [5331.5, 10079.5], [5333.0, 10075.5],
  [5335.8, 10076.4], [5339.5, 10065.7], [5337.8, 10065.2]];

/** The front of the main hall is the straight line u = HALL_FRONT between s 29.2 and 44.3: the outline's round bump in front of it (to u = 7) is the marquise. */
const HALL_FRONT = 3.2;
function straightenHallFront(poly) {
  const local = (p) => [(p[0] - ORIGIN[0]) * ALONG[0] + (p[1] - ORIGIN[1]) * ALONG[1], (p[0] - ORIGIN[0]) * -ALONG[1] + (p[1] - ORIGIN[1]) * ALONG[0]];
  const world = (s, u) => [ORIGIN[0] + ALONG[0] * s - ALONG[1] * u, ORIGIN[1] + ALONG[1] * s + ALONG[0] * u];
  const bump = poly.map((p) => { const [s, u] = local(p); return s > 28.9 && s < 44.6 && u > 0.45; });
  const first = bump.indexOf(true), last = bump.lastIndexOf(true);
  if (first < 0 || bump.slice(first, last + 1).includes(false)) throw new Error('Gare: the porch of the outline is not one run of points');
  const [s0] = local(poly[first]);
  const ends = s0 > 36 ? [world(44.3, HALL_FRONT), world(29.2, HALL_FRONT)] : [world(29.2, HALL_FRONT), world(44.3, HALL_FRONT)];
  return [...poly.slice(0, first), ...ends, ...poly.slice(last + 1)];
}

const STATION_FRONT = straightenHallFront(STATION);

const STONE = [0.84, 0.79, 0.65];       // the pale yellow sandstone of the photographs
const STONE_DARK = [0.70, 0.65, 0.52];  // the plinth and the courses
const COPPER = [0.50, 0.62, 0.56];      // the weathered copper of the tower roofs (light green-grey)
const CLOCK = [0.94, 0.94, 0.90];
const SLATE = [0.27, 0.29, 0.33];       // the slate of the roofs: darker and greyer than the cathedral's blue-grey in the photographs

const GARE = Object.freeze({
  base: 10.5,                 // m: the stone mass of the whole outline (two storeys), the roofs and the taller parts stand on it
  floor: 4.6,
  tower: { s0: 23.0, s1: 29.2, u0: -5.6, u1: 0.6, shaft: 25.5, clock: 21.5, clockR: 1.6 },
  hall: { s0: 29.2, s1: 44.3, u0: -30, u1: 3.2, eave: 14.5, rise: 8, arch: { w: 7.0, y0: 7.2, h: 5.6 }, marquise: { y: 5.0, out: 3.8 } },
  // the wings (s0, s1, u0, u1, eave, rise of the hip roof, dormers on the front)
  wings: [
    { s0: -2.4, s1: 23.0, u0: -18.0, u1: -2.4, eave: 11.5, rise: 6.5, dormers: 6 },     // (the back half under it is the flat roof of the stone mass)
    { s0: 44.3, s1: 56.0, u0: -6.4, u1: 0.0, eave: 11.0, rise: 4.5, dormers: 2 },
    { s0: 44.3, s1: 94.0, u0: -33.6, u1: -16.5, eave: 10.8, rise: 5.5, dormers: 0 },
  ],
  pavilion: { eave: 9.0, rise: 9.5 },
  glassHall: 9.8,             // m: the height of the glass hall (under the cornice of the old building)
  mullionPitch: 2.8,
  clearing: 60,               // m: no baked block may stand inside the model (an error, the model would be inside a house)
});

/** A hipped roof over the rectangle s0..s1 x u0..u1 from yEave, the ridge along the longer side. */
function hipRoof(soup, F, s0, s1, u0, u1, yEave, rise, color) {
  const ls = s1 - s0, lu = u1 - u0;
  const inset = Math.min(ls, lu) / 2;
  const P = (s, u, y) => F.at(s, y, u);
  const A = P(s0, u0, yEave), B = P(s1, u0, yEave), Cc = P(s1, u1, yEave), D = P(s0, u1, yEave);
  if (ls >= lu) {
    const r0 = P(s0 + inset, (u0 + u1) / 2, yEave + rise), r1 = P(s1 - inset, (u0 + u1) / 2, yEave + rise);
    soup.quad(A, B, r1, r0, paint(color, 1, 0.03)); soup.quad(Cc, D, r0, r1, paint(color, 2, 0.03));
    soup.tri(D, A, r0, paint(color, 3, 0.03)); soup.tri(B, Cc, r1, paint(color, 4, 0.03));
  } else {
    const r0 = P((s0 + s1) / 2, u0 + inset, yEave + rise), r1 = P((s0 + s1) / 2, u1 - inset, yEave + rise);
    soup.quad(B, Cc, r1, r0, paint(color, 1, 0.03)); soup.quad(D, A, r0, r1, paint(color, 2, 0.03));
    soup.tri(A, B, r0, paint(color, 3, 0.03)); soup.tri(Cc, D, r1, paint(color, 4, 0.03));
  }
}

/** A box in the frame: s0..s1 x u0..u1, from y0 up by h. */
function frameBox(soup, F, s0, s1, u0, u1, y0, h, color, opts = {}) {
  const [cx, , cz] = F.at((s0 + s1) / 2, 0, (u0 + u1) / 2);
  soup.box(cx, y0, cz, s1 - s0, h, u1 - u0, Math.atan2(-F.dz, F.dx), color, opts);
}

/** The walls of the rectangle s0..s1 x u0..u1 from y0 to y1 (no top: a roof goes there). */
function frameWalls(soup, F, s0, s1, u0, u1, y0, y1, color) {
  const pts = [[s0, u0], [s1, u0], [s1, u1], [s0, u1]].map(([s, u]) => F.xz(s, u));
  soup.prism(pts, y0, y1, color, { top: false });
}

/** The clock tower: the shaft, the clocks, cornice and balustrade, the copper bell roof, the open belfry, a small dome, the lantern, the needle. */
function buildTower(soup, F, ground, yBase, K) {
  const T = K.tower;
  const sc = (T.s0 + T.s1) / 2, uc = (T.u0 + T.u1) / 2, half = (T.s1 - T.s0) / 2;
  const [cx, cz] = F.xz(sc, uc);
  const yaw = Math.atan2(-F.dz, F.dx);
  const corners = [[T.s0, T.u0], [T.s1, T.u0], [T.s1, T.u1], [T.s0, T.u1]].map(([s, u]) => F.xz(s, u));
  const yTop = yBase + T.shaft;
  soup.prism(corners, corners.map(([x, z]) => ground(x, z) - SINK), yTop, paint(STONE, 41, 0.02), { top: false });
  frameBox(soup, F, T.s0 - 0.25, T.s1 + 0.25, T.u0 - 0.25, T.u1 + 0.25, yBase - 0.5, 2.2, STONE_DARK);                // the plinth
  for (const y of [yBase + 10.5, yBase + 17.0]) frameBox(soup, F, T.s0 - 0.15, T.s1 + 0.15, T.u0 - 0.15, T.u1 + 0.15, y, 0.45, STONE_DARK);   // string courses
  // corner pilasters (the shaft reads as a framed tower, not a box)
  for (const [s, u] of [[T.s0, T.u0], [T.s1, T.u0], [T.s1, T.u1], [T.s0, T.u1]]) {
    const ds = s === T.s0 ? 0.35 : -0.35, du = u === T.u0 ? 0.35 : -0.35;
    frameBox(soup, F, Math.min(s, s + ds) - 0.12, Math.max(s, s + ds) + 0.12, Math.min(u, u + du) - 0.12, Math.max(u, u + du) + 0.12, yBase + 2, T.shaft - 2.5, STONE_DARK, { topColor: STONE_DARK });
  }
  // tall slit windows on the front and on the side towards the square, and the clocks on all four faces
  const faces = [
    { f: (s, y, o) => F.at(s, y, T.u1 + o), c: sc },               // the front (to the square)
    { f: (s, y, o) => F.at(s, y, T.u0 - o), c: sc },               // the back (to the tracks)
    { f: (u, y, o) => F.at(T.s0 - o, y, u), c: uc },               // the north-east side
    { f: (u, y, o) => F.at(T.s1 + o, y, u), c: uc },               // the south-west side
  ];
  faces.forEach((face, i) => {
    const at = face.f, c = face.c;
    soup.quad(at(c - 0.55, yBase + 12, 0.05), at(c + 0.55, yBase + 12, 0.05), at(c + 0.55, yBase + 16, 0.05), at(c - 0.55, yBase + 16, 0.05), C.glassDark);
    const yc = yBase + T.clock;
    const ring = (r, o) => Array.from({ length: 12 }, (_, k) => at(c + Math.cos((k / 12) * TAU) * r, yc + Math.sin((k / 12) * TAU) * r, o));
    const rim = ring(T.clockR + 0.3, 0.06), face_ = ring(T.clockR, 0.1);
    for (let k = 0; k < 12; k++) {
      soup.tri(at(c, yc, 0.06), rim[k], rim[(k + 1) % 12], paint(C.gold, 60 + i, 0.02));
      soup.tri(at(c, yc, 0.1), face_[k], face_[(k + 1) % 12], CLOCK);
    }
    soup.quad(at(c - 0.06, yc, 0.13), at(c + 0.06, yc, 0.13), at(c + 0.06, yc + 1.15, 0.13), at(c - 0.06, yc + 1.15, 0.13), C.steelDark);       // the hands at ten to two
    soup.quad(at(c, yc - 0.06, 0.13), at(c + 0.85, yc - 0.06, 0.13), at(c + 0.85, yc + 0.06, 0.13), at(c, yc + 0.06, 0.13), C.steelDark);
  });
  // the cornice, the balustrade, the copper bell roof (square to round), the open belfry, the dome, the lantern, the needle
  frameBox(soup, F, T.s0 - 0.5, T.s1 + 0.5, T.u0 - 0.5, T.u1 + 0.5, yTop - 0.2, 0.7, STONE_DARK, { topColor: STONE });
  frameBox(soup, F, T.s0 - 0.35, T.s1 + 0.35, T.u0 - 0.35, T.u1 + 0.35, yTop + 0.5, 1.0, paint(STONE, 43, 0.03), { topColor: STONE_DARK });
  const y0 = yTop + 0.5;
  soup.frustum(cx, cz, half * 1.12, half * 1.06, y0, y0 + 1.6, 8, COPPER, { yaw: yaw + Math.PI / 8, cap: false });
  soup.frustum(cx, cz, half * 1.06, half * 0.55, y0 + 1.6, y0 + 4.2, 8, paint(COPPER, 2, 0.04), { yaw: yaw + Math.PI / 8, cap: false });
  const yb = y0 + 4.2, rb = half * 0.55;
  soup.frustum(cx, cz, rb, rb, yb, yb + 3.4, 8, paint(COPPER, 3, 0.03), { yaw: yaw + Math.PI / 8, cap: false });
  for (let k = 0; k < 8; k++) {                                                          // the arched openings of the belfry
    const a = yaw + Math.PI / 8 + ((k + 0.5) / 8) * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const px = cx + ca * rb * 0.93, pz = cz + sa * rb * 0.93, tx = -sa * 0.42, tz = ca * 0.42;
    soup.quad([px - tx, yb + 0.5, pz - tz], [px + tx, yb + 0.5, pz + tz], [px + tx, yb + 2.7, pz + tz], [px - tx, yb + 2.7, pz - tz], C.steelDark);
  }
  soup.frustum(cx, cz, rb * 1.18, rb * 1.18, yb + 3.4, yb + 3.8, 8, STONE, { yaw: yaw + Math.PI / 8, cap: false });
  soup.frustum(cx, cz, rb * 1.12, rb * 0.35, yb + 3.8, yb + 5.6, 8, paint(COPPER, 4, 0.04), { yaw: yaw + Math.PI / 8, cap: false });
  soup.frustum(cx, cz, rb * 0.35, rb * 0.35, yb + 5.6, yb + 6.8, 6, paint(COPPER, 5, 0.04), { cap: false });
  soup.frustum(cx, cz, rb * 0.42, 0, yb + 6.8, yb + 9.6, 6, paint(COPPER, 6, 0.04), { cap: false });
  return yb + 9.6 - yBase;
}

/** The main hall: walls up to its eave, the front gable with the great window between paired columns, the transverse roof, the marquise. */
function buildHall(soup, F, yBase, K) {
  const H = K.hall;
  const yEave = yBase + H.eave, yApex = yEave + H.rise;
  frameWalls(soup, F, H.s0, H.s1, H.u0, H.u1, yBase + K.base, yEave, paint(STONE, 51, 0.02));
  // the transverse gable roof (ridge along u) and the stone gable on the front
  const sm = (H.s0 + H.s1) / 2;
  const P = (s, u, y) => F.at(s, y, u);
  soup.quad(P(H.s0, H.u0, yEave), P(H.s0, H.u1, yEave), P(sm, H.u1, yApex), P(sm, H.u0, yApex), paint(SLATE, 53, 0.03));
  soup.quad(P(H.s1, H.u1, yEave), P(H.s1, H.u0, yEave), P(sm, H.u0, yApex), P(sm, H.u1, yApex), paint(SLATE, 54, 0.03));
  soup.tri(P(H.s0 - 0.3, H.u1 + 0.3, yEave - 0.4), P(H.s1 + 0.3, H.u1 + 0.3, yEave - 0.4), P(sm, H.u1 + 0.3, yApex + 0.6), paint(STONE, 55, 0.02));
  soup.tri(P(H.s0, H.u0, yEave), P(sm, H.u0, yApex), P(H.s1, H.u0, yEave), paint(STONE, 56, 0.02));
  // the front plane (a frame: s along the front, out = towards the square)
  const f = { yaw: Math.atan2(-F.dz, F.dx), at: (s, y, out = 0) => F.at(s, y, H.u1 + out), len: H.s1 - H.s0 };
  const A = H.arch;
  roundArch(soup, f, sm, yBase + A.y0, A.w, A.h, STONE_DARK, C.glassDark, 10);
  for (const ds of [-A.w / 4, 0, A.w / 4]) panel(soup, f, sm + ds - 0.09, sm + ds + 0.09, yBase + A.y0, yBase + A.y0 + A.h + (ds === 0 ? A.w / 2 : A.w * 0.43), 0.13, STONE_DARK);   // the mullions
  panel(soup, f, sm - A.w / 2, sm + A.w / 2, yBase + A.y0 + A.h * 0.55 - 0.09, yBase + A.y0 + A.h * 0.55 + 0.09, 0.13, STONE_DARK);
  // paired columns on pedestals either side of the window, an entablature over them; a cartouche at the top of the gable
  for (const sc of [H.s0 + 1.3, H.s0 + 2.5, H.s1 - 2.5, H.s1 - 1.3]) {
    slab(soup, f, sc - 0.36, sc + 0.36, yBase + 5.6, yBase + 7.0, 0.85, STONE_DARK);
    slab(soup, f, sc - 0.3, sc + 0.3, yBase + 7.0, yEave - 0.9, 0.7, paint(STONE, Math.round(sc * 7), 0.03));
  }
  slab(soup, f, H.s0 + 0.6, H.s1 - 0.6, yEave - 0.9, yEave - 0.3, 0.95, STONE_DARK, { topColor: STONE });
  slab(soup, f, sm - 1.4, sm + 1.4, yEave + 2.0, yEave + 4.6, 0.4, STONE_DARK);
  // the doors under the marquise, the marquise itself (dark steel and glass hanging from the front)
  for (const ds of [-4.5, 0, 4.5]) roundArch(soup, f, sm + ds, yBase + 0.05, 2.6, 2.8, STONE_DARK, C.glassDark, 6);
  const M = H.marquise;
  const [mx, mz] = F.xz(sm, H.u1 + M.out / 2);
  soup.box(mx, yBase + M.y, mz, H.s1 - H.s0 - 0.6, 0.45, M.out, f.yaw, C.steelDark, { bottom: true, topColor: C.glassBlue });
}

/** The glass hall of 2012: glass walls with steel mullions on the edges that are not shared with the stone building, a flat roof. */
function buildGlassHall(soup, ground, yBase, K) {
  const shared = (p) => STATION.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05);
  const yTop = yBase + K.glassHall;
  for (let i = 0; i < HALL.length; i++) {
    const a = HALL[i], b = HALL[(i + 1) % HALL.length];
    if (shared(a) && shared(b)) continue;                       // a wall of the old building (drawn by it)
    soup.quad([a[0], ground(a[0], a[1]) - SINK, a[1]], [b[0], ground(b[0], b[1]) - SINK, b[1]], [b[0], yTop, b[1]], [a[0], yTop, a[1]], paint(C.glassDark, i, 0.05));
    const f = edgeFrame(HALL, i);
    if (f.len < 2) continue;
    const n = Math.max(1, Math.round(f.len / K.mullionPitch));
    for (let k = 0; k <= n; k++) {
      const s = Math.min(f.len - 0.08, Math.max(0.08, (f.len * k) / n));
      slab(soup, f, s - 0.08, s + 0.08, yBase - 0.3, yTop, 0.2, C.steelGrey);
    }
    slab(soup, f, 0, f.len, yBase + 4.2, yBase + 4.45, 0.18, C.steelGrey);             // the transom at the gallery level
  }
  soup.prism(HALL, yTop, yTop + 0.6, C.white, { topColor: paint(C.glassBlue, 3, 0.02) });   // the roof: a white steel edge, glass on top
}

export function buildGare({ buildings, ground }) {
  const K = GARE;
  const F = axisFrame(ORIGIN[0], ORIGIN[1], ORIGIN[0] + ALONG[0] * 100, ORIGIN[1] + ALONG[1] * 100);
  // the frame's u must point to the square (the front): it is the side of the tram platforms (5300, 10060)
  if (F.local(5300, 10060)[1] <= 0) throw new Error('Gare: the frame does not face the Place de la Gare');
  for (const b of blocksNear(buildings, ...ORIGIN, K.clearing, 200)) {
    if (b.pts.some((p) => F.local(p[0], p[1])[0] > -2 && F.local(p[0], p[1])[0] < 56 && F.local(p[0], p[1])[1] > -30 && F.local(p[0], p[1])[1] < 0)) {
      throw new Error(`Gare: block ${b.id} of the bake stands inside the station`);
    }
  }
  const soup = new Soup();
  const { high } = groundRange(ground, STATION_FRONT);
  const yBase = high;
  // the stone mass of the whole outline (two storeys), the plinth, the cornice; the windows of both storeys on every long edge
  soup.prism(STATION_FRONT, STATION_FRONT.map(([x, z]) => ground(x, z) - SINK), yBase + K.base, paint(STONE, 1, 0.02), { topColor: SLATE });
  soup.prism(PAVILION, PAVILION.map(([x, z]) => ground(x, z) - SINK), yBase + K.pavilion.eave, paint(STONE, 2, 0.02), { top: false });
  const apex = F.at(...[-6.3, yBase + K.pavilion.eave + K.pavilion.rise, -27.6]);
  soup.pyramid(PAVILION, yBase + K.pavilion.eave, apex, paint(SLATE, 3, 0.04));
  for (let e = 0; e < STATION_FRONT.length; e++) {
    const f = edgeFrame(STATION_FRONT, e);
    if (f.len < 4.5) continue;
    const [ms, mu] = F.local((f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2);
    if (ms > K.hall.s0 - 0.5 && ms < K.hall.s1 + 0.5 && mu > -1) continue;           // the main hall's front has its own window
    slab(soup, f, 0, f.len, yBase - 0.6, yBase + 1.1, 0.25, STONE_DARK, { topColor: STONE_DARK });
    slab(soup, f, 0, f.len, yBase + K.base - 0.6, yBase + K.base, 0.45, STONE_DARK, { topColor: STONE });
    windowGrid(soup, f, { s0: 0.8, s1: f.len - 0.8, y0: yBase + 1.6, rows: 2, floorH: K.floor, w: 1.5, h: 2.7, pitch: 3.4, frame: STONE_DARK, glass: C.glassDark, key: e * 13 });
  }
  // the wings: upper walls from the stone mass to their eaves, hip roofs, dormers on the front slope
  for (const [i, w] of K.wings.entries()) {
    const yEave = yBase + w.eave;
    if (w.eave > K.base) frameWalls(soup, F, w.s0, w.s1, w.u0, w.u1, yBase + K.base, yEave, paint(STONE, 10 + i, 0.02));
    hipRoof(soup, F, w.s0 - 0.4, w.s1 + 0.4, w.u0 - 0.4, w.u1 + 0.4, yEave, w.rise, SLATE);
    const slope = w.rise / (Math.min(w.s1 - w.s0, w.u1 - w.u0) / 2 + 0.4);                // every face of a hip roof runs in by half the shorter side
    for (let k = 0; k < w.dormers; k++) {
      const s = w.s0 + ((k + 0.5) * (w.s1 - w.s0)) / w.dormers;
      const u = w.u1 + 0.4 - 1.6, y = yEave + 1.6 * slope;                                  // the dormer's front stands 1.6 m in from the eave
      frameBox(soup, F, s - 0.8, s + 0.8, u - 1.4, u, yEave, y + 1.3 - yEave, paint(STONE, 20 + k, 0.03), { topColor: SLATE });
      const fr = { yaw: Math.atan2(-F.dz, F.dx), at: (ss, yy, out = 0) => F.at(ss, yy, u + out) };
      panel(soup, fr, s - 0.45, s + 0.45, y - 0.2, y + 1.0, 0.04, C.glassDark);
    }
  }
  buildHall(soup, F, yBase, K);
  const towerHeight = buildTower(soup, F, ground, yBase, K);
  buildGlassHall(soup, ground, yBase, K);
  const hallOnly = HALL.filter((p) => !STATION.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05));
  const walls = [...edgeWalls(STATION_FRONT, 0.3, 'gare'), ...edgeWalls(PAVILION, 0.3, 'gare'), ...edgeWalls(HALL, 0.3, 'gare-hall').filter((w) => hallOnly.some((p) => Math.hypot(p[0] - w.ax, p[1] - w.az) < 0.05 || Math.hypot(p[0] - w.bx, p[1] - w.bz) < 0.05))];
  return { soup, walls, hideBuildings: [], hideDecks: [], info: { tower: Math.round(towerHeight), base: Math.round(yBase) } };
}

export const GARE_OUTLINES = Object.freeze({ station: STATION_FRONT, pavilion: PAVILION, hall: HALL });
