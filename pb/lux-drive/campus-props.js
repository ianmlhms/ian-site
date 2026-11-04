/* The small things of the campus: the bus shelters and stop poles of the boulevard, bike racks, the stone wall and hedge in front of the Athénée,
 * the birches and the orange-leaved trees (campus-trees.js leaves the ornamental species to this module), and the free items of campus-free.js
 * (benches, picnic tables, seats, the pergola ...).  One mesh.  Pure (no THREE). */
import { Soup, paint } from './landmark-soup.js';
import { edgeWalls } from './landmark-util.js';
import { drawFree, FREE_KINDS } from './campus-free.js';
import { campusSpeciesTrees } from './campus-trees.js';

const FRAME = [0.20, 0.22, 0.24];          // the dark anthracite aluminium of the Luxembourg bus shelters
const GLASS = [0.60, 0.74, 0.80];
const PANEL = [0.92, 0.95, 0.97];          // the lit timetable panel
const STEEL = [0.34, 0.36, 0.38];
const SILVER = [0.74, 0.76, 0.78];
const BLUE_SIGN = [0.08, 0.20, 0.62];     // the blue square bus sign of the Luxembourg stops
const WHITE_FIELD = [0.93, 0.93, 0.91];
const STRIPES = [[0.90, 0.55, 0.12], [0.78, 0.18, 0.30], [0.16, 0.50, 0.40], [0.20, 0.36, 0.70]];
const BENCH = [0.46, 0.34, 0.22];
const SINK = 0.4;

/**
 * A bus shelter of the Luxembourg type (RGTR / AVL): a thin flat roof on a dark frame, three glass panels at the back, glass ends, a slat bench,
 * a lit panel at one end.  It faces `yaw` (the direction of the road).
 */
function shelter(soup, ground, s) {
  const y = ground(s.x, s.z) - SINK;
  const c = Math.cos(s.yaw), n = Math.sin(s.yaw);
  const at = (u, v) => [s.x + u * c - v * n, s.z + u * n + v * c];             // u along the facing direction, v across it
  const place = (u, v, w, d, h, y0, color, topColor) => { const [px, pz] = at(u, v); soup.box(px, y0, pz, w, h, d, -s.yaw, color, { topColor: topColor || color }); };
  place(0, 0, 2.0, 4.0, 0.14, y + 2.5, FRAME, [0.30, 0.32, 0.34]);                                  // the roof, a hand thick, overhanging the frame
  for (const v of [-1.8, 1.8]) for (const u of [-0.8, 0.8]) place(u, v, 0.09, 0.09, 2.5, y, FRAME);   // four posts
  for (const v of [-1.2, 0, 1.2]) place(-0.8, v, 0.04, 1.1, 2.1, y + 0.3, paint(GLASS, Math.round(v * 3), 0.04));   // the glass back: three panels
  for (const v of [-0.6, 0.6]) place(-0.8, v, 0.07, 0.07, 2.2, y + 0.3, FRAME);                      // their mullions
  for (const v of [-1.8, 1.8]) place(0, v, 1.6, 0.04, 2.1, y + 0.3, paint(GLASS, 7, 0.04));          // the glass ends
  place(-0.35, 0, 0.45, 2.8, 0.07, y + 0.5, BENCH);                                                    // the bench
  place(-0.35, 0, 0.08, 2.6, 0.5, y, FRAME);
  place(0.1, 1.5, 0.05, 0.9, 1.3, y + 0.7, PANEL);                                                      // the timetable panel at the front
  stopSign(soup, ...at(0.9, -2.4), y, s.yaw);                                                            // the stop sign beside it
}

/** A stop sign on a pole (photo Luxembourg_arrêt_de_bus_Jean_Piret): a silver pole, the blue square bus sign with its white field and bus, the round quay disc on top, the stop-name plate with its coloured stripes. */
function stopSign(soup, x, z, y0, yaw) {
  const th = -yaw + Math.PI / 2;                       // the plates face along the road's normal
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const at = (u, v) => [x + u * cs - v * sn, z + u * sn + v * cs];
  const plate = (u, y, w, h, color, depth = 0.04) => { const [px, pz] = at(u, 0); soup.box(px, y, pz, w, h, depth, th, color, { topColor: color }); };
  soup.frustum(x, z, 0.05, 0.05, y0, y0 + 3.3, 6, SILVER, { cap: true });
  soup.frustum(x, z, 0.19, 0.19, y0 + 3.05, y0 + 3.1, 8, [0.84, 0.85, 0.86], { cap: true });                     // the round quay disc
  plate(0.0, y0 + 2.15, 0.62, 0.8, BLUE_SIGN);                                                                 // the blue bus sign
  plate(0.0, y0 + 2.34, 0.4, 0.42, WHITE_FIELD, 0.05);
  plate(0.0, y0 + 2.45, 0.28, 0.12, [0.10, 0.10, 0.12], 0.06);                                                  // the bus
  plate(0.0, y0 + 1.82, 0.74, 0.28, [0.93, 0.93, 0.92]);                                                       // the stop-name plate
  plate(0.0, y0 + 2.0, 0.7, 0.07, STRIPES[Math.round(x + z) % STRIPES.length], 0.05);                          // its coloured stripe
}

/** A stop pole. */
function pole(soup, ground, s) {
  stopSign(soup, s.x, s.z, ground(s.x, s.z) - SINK, s.yaw);
}

/** A row of bike loops: n hoops of 0.7 m. */
function rack(soup, ground, s) {
  const y = ground(s.x, s.z);
  for (let i = -2; i <= 2; i++) soup.box(s.x + i * 0.7, y, s.z, 0.05, 0.8, 0.05, 0, STEEL);
  soup.box(s.x, y + 0.8, s.z, 3.0, 0.04, 0.05, 0, STEEL);
}

/** A wall (stone) with a hedge on top, along a polyline: { pts, h, w, c, hedge }. */
function wallWithHedge(soup, ground, wall) {
  for (let i = 0; i + 1 < wall.pts.length; i++) {
    const [ax, az] = wall.pts[i], [bx, bz] = wall.pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = -Math.atan2(bz - az, bx - ax);
    const steps = Math.max(1, Math.ceil(len / 6));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const y0 = Math.min(ground(x - (bx - ax) / steps / 2, z - (bz - az) / steps / 2), ground(x + (bx - ax) / steps / 2, z + (bz - az) / steps / 2)) - 0.5;
      soup.box(x, y0, z, len / steps + 0.1, wall.h + 0.5, wall.w, yaw, paint(wall.c, k, 0.05), { topColor: wall.c });
      soup.box(x, y0 + wall.h + 0.5, z, len / steps + 0.1, 1.0, wall.w * 0.8, yaw, paint(wall.hedge, k, 0.08), { topColor: wall.hedge });
    }
  }
}

/* ------------------------------------------------------------------------------------------------------------ the ornamental trees */
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO = [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]];
const ICO_FACES = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
const BIRCH_BARK = [0.90, 0.88, 0.82], BIRCH_LEAF = [0.50, 0.68, 0.28], ORANGE_LEAF = [0.90, 0.46, 0.12], ORANGE_BARK = [0.38, 0.30, 0.24];

/** A lumpy leaf blob (a jittered icosahedron, 20 triangles), lighter on top. */
function blob(soup, cx, cy, cz, rx, ry, color, seed) {
  const pts = ICO.map(([x, y, z], i) => {
    const l = Math.hypot(x, y, z), k = 1 + 0.22 * (((Math.imul(seed + i * 977, 0x9e3779b1) >>> 9) & 255) / 255 - 0.5);
    return [cx + (x / l) * rx * k, cy + (y / l) * ry * k, cz + (z / l) * rx * k];
  });
  for (const [a, b, c] of ICO_FACES) {
    const ny = (pts[a][1] + pts[b][1] + pts[c][1]) / 3 - cy;
    soup.tri(pts[a], pts[b], pts[c], paint(color, seed + a * 31 + b, 0.07).map((v) => v * (0.82 + 0.3 * Math.min(1, Math.max(0, ny / ry + 0.5)))));
  }
}

/** A birch: a slim white trunk, a narrow airy crown (the young birches in front of the Athénée, photo Luxembourg_Athénée_101). */
function birch(soup, ground, t) {
  const y = ground(t.x, t.z) - 0.2, h = t.height;
  soup.frustum(t.x, t.z, 0.13, 0.06, y, y + h * 0.7, 5, BIRCH_BARK, { cap: false });
  blob(soup, t.x, y + h * 0.7, t.z, h * 0.2, h * 0.3, BIRCH_LEAF, Math.round(t.x * 7 + t.z));
}

/** A small round ornamental tree in autumn orange (the row south of the Forum, the trees of the Blumm square). */
function orangeTree(soup, ground, t) {
  const y = ground(t.x, t.z) - 0.2, h = t.height;
  soup.frustum(t.x, t.z, 0.14, 0.08, y, y + h * 0.5, 5, ORANGE_BARK, { cap: false });
  blob(soup, t.x, y + h * 0.68, t.z, h * 0.3, h * 0.28, ORANGE_LEAF, Math.round(t.x * 3 + t.z * 11));
}

const SPECIES_DRAW = { 4: birch, 5: orangeTree };

/** The props mesh of the campus: { soup, walls, hideBuildings, info }. */
export function buildProps(campus, ground) {
  const soup = new Soup();
  const walls = [];
  for (const s of campus.furniture) {
    if (s.k === 'shelter') shelter(soup, ground, s);
    else if (s.k === 'pole') pole(soup, ground, s);
    else if (s.k === 'rack') rack(soup, ground, s);
    else if (FREE_KINDS.includes(s.k)) drawFree(soup, ground, s);
    else throw new Error(`campus: unknown furniture '${s.k}'`);
  }
  for (const item of campus.free) drawFree(soup, ground, item);
  for (const w of campus.walls) {
    wallWithHedge(soup, ground, w);
    walls.push(...edgeWalls([...w.pts, ...[...w.pts].reverse().slice(1, -1)], 0.3, 'campus-wall'));
  }
  for (const t of campusSpeciesTrees()) SPECIES_DRAW[t.kind](soup, ground, t);
  return { soup, walls, hideBuildings: [], info: { furniture: campus.furniture.length, free: campus.free.length } };
}
