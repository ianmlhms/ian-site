/* The grounds of the campus: squares, car parks, pitches and the painted lines on them, draped on the terrain as flat coloured faces.
 *
 * Every polygon is triangulated (ear clipping) and cut into smaller triangles where the ground bends, every vertex takes the height of the
 * ground (the same function the car drives on) plus a few centimetres; the layer number lifts a face over the one below it (the track
 * over the lawn, the lines over the track).  The view draws these meshes with a polygon offset, so they never flicker against the
 * terrain tiles.  Pure (no THREE). */
import { Soup, paint } from './landmark-soup.js';

const BASE_LIFT = 0.06;               // m: a face lies this far above the envelope of the ground (see envelope())
const LAYER_LIFT = 0.025;             // m: every layer of a face is this much higher
const LINE_LIFT = 0.16;               // m: the painted lines lie over every area
const MAX_EDGE = 14;                  // m: a triangle with a longer edge is always cut
const SPLIT_EDGE = 6;                 // m: a triangle with a longer edge is cut where the ground bends
const SPLIT_BEND = 0.10;              // m: ... by more than this
const ENVELOPE = 1.3;                 // m: a vertex stands on the highest ground within this reach (the terrain mesh is a lattice: a bump of a
                                      // few centimetres between two vertices must not poke through the paint)
const MAX_DEPTH = 6;
const STRIP_STEP = 6;                 // m: a painted line follows the ground at least this often

/** The upper envelope of the ground at (x, z): the paint lies over the bumps of the terrain, not through them. */
const envelope = (ground) => (x, z) => Math.max(ground(x, z), ground(x + ENVELOPE, z), ground(x - ENVELOPE, z), ground(x, z + ENVELOPE), ground(x, z - ENVELOPE));

/** Cuts a triangle where the ground bends and emits it. */
function drapeTriangle(soup, ground, a, b, c, lift, color, depth = 0) {
  const ya = ground(a[0], a[1]), yb = ground(b[0], b[1]), yc = ground(c[0], c[1]);
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const edge = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
  let split = edge > MAX_EDGE;
  if (!split && edge > SPLIT_EDGE) {
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a), g = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
    const bend = Math.max(
      Math.abs(ground(ab[0], ab[1]) - (ya + yb) / 2), Math.abs(ground(bc[0], bc[1]) - (yb + yc) / 2),
      Math.abs(ground(ca[0], ca[1]) - (yc + ya) / 2), Math.abs(ground(g[0], g[1]) - (ya + yb + yc) / 3));
    split = bend > SPLIT_BEND;
  }
  if (split && depth < MAX_DEPTH) {
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    drapeTriangle(soup, ground, a, ab, ca, lift, color, depth + 1);
    drapeTriangle(soup, ground, ab, b, bc, lift, color, depth + 1);
    drapeTriangle(soup, ground, ca, bc, c, lift, color, depth + 1);
    drapeTriangle(soup, ground, ab, bc, ca, lift, color, depth + 1);
    return;
  }
  soup.tri([a[0], ya + lift, a[1]], [b[0], yb + lift, b[1]], [c[0], yc + lift, c[1]], color);
}

/** A flat coloured area on the ground: `area` = { pts: [[x, z], ...], tris: [[i, j, k], ...] (a mesh of the polygon, baked), c: [r, g, b], lift: layer }. */
export function drapeArea(soup, ground0, area) {
  const ground = envelope(ground0);
  const lift = BASE_LIFT + (area.lift || 0) * LAYER_LIFT;
  const pts = area.pts;
  for (const [i, j, k] of area.tris) drapeTriangle(soup, ground, pts[i], pts[j], pts[k], lift, paint(area.c, i * 7 + j, 0.02));
}

/** A painted line (a strip of width w) along a polyline, following the ground. */
export function drapeLine(soup, ground0, line) {
  const ground = envelope(ground0);
  const lift = LINE_LIFT + (line.lift || 0) * LAYER_LIFT;
  const hw = line.w / 2;
  for (let i = 0; i + 1 < line.pts.length; i++) {
    const [ax, az] = line.pts[i], [bx, bz] = line.pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len, nx = -dz * hw, nz = dx * hw;
    const n = Math.max(1, Math.ceil(len / STRIP_STEP));
    for (let k = 0; k < n; k++) {
      const x0 = ax + (bx - ax) * (k / n), z0 = az + (bz - az) * (k / n), x1 = ax + (bx - ax) * ((k + 1) / n), z1 = az + (bz - az) * ((k + 1) / n);
      const y0 = ground(x0, z0) + lift, y1 = ground(x1, z1) + lift;
      soup.quad([x0 + nx, y0, z0 + nz], [x1 + nx, y1, z1 + nz], [x1 - nx, y1, z1 - nz], [x0 - nx, y0, z0 - nz], line.c);
    }
  }
}

/** The model of the grounds: { soup, walls, hideBuildings, info } with info.decal = true (the view draws it with a polygon offset). */
export function buildGrounds(campus, ground) {
  const soup = new Soup();
  for (const area of campus.areas) drapeArea(soup, ground, area);
  for (const path of campus.paths) drapeLine(soup, ground, { ...path, lift: 0.5 });          // the footpaths: over the areas, under the painted lines
  for (const line of campus.lines) drapeLine(soup, ground, line);
  return { soup, walls: [], hideBuildings: [], info: { decal: true, areas: campus.areas.length, lines: campus.lines.length, paths: campus.paths.length } };
}
