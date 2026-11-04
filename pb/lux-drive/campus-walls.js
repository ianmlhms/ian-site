/* The visible walls of the parts of a campus building.  Parts of one building touch (a tall wing next to a low one): the wall of a part
 * is not drawn where another part of at least the same height stands against it, and above the roof of a lower neighbour it starts
 * at that roof, not at the ground.  An edge is cut into short pieces, each piece tested just outside the wall, and equal neighbours
 * are joined again into runs: the facade styles (campus-facades.js) then work on long straight runs.  Pure (no THREE). */
import { edgeFrame } from './landmark-facade.js';
import { insidePoly } from './landmark-util.js';

const PIECE = 1.5;            // m: the length of the test pieces of an edge
const PROBE = 0.3;            // m: how far outside the wall the neighbour is looked for
const LOWER_EPS = 0.05;       // m: roofs this much apart count as one level

/** The bounding box [minX, minZ, maxX, maxZ] of a polygon [[x, z], ...]. */
export function boundsOfPoly(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, z] of pts) { if (x < a) a = x; if (x > c) c = x; if (z < b) b = z; if (z > d) d = z; }
  return [a, b, c, d];
}

/**
 * The runs of the visible wall of `part` (a part of `parts`): [{ i, frame, s0, s1, lowerY }].
 * `frame` is the edgeFrame of edge i (s along it from its first point, out = in front of the wall); lowerY is the roof elevation
 * of the lower neighbour the wall stands on (or null: it stands on the ground).
 */
export function wallRuns(part, parts) {
  const poly = part.pts;
  const mine = part.bounds;
  const near = parts.filter((q) => q !== part && q.bounds[0] <= mine[2] + 1 && q.bounds[2] >= mine[0] - 1 && q.bounds[1] <= mine[3] + 1 && q.bounds[3] >= mine[1] - 1);
  const runs = [];
  for (let i = 0; i < poly.length; i++) {
    const f = edgeFrame(poly, i);
    const n = Math.max(1, Math.ceil(f.len / PIECE));
    let cur = null;
    for (let k = 0; k < n; k++) {
      const s0 = (f.len * k) / n, s1 = (f.len * (k + 1)) / n;
      const [px, , pz] = f.at((s0 + s1) / 2, 0, PROBE);
      let hidden = false, lowerY = null;
      for (const q of near) {
        if (!insidePoly(q.pts, px, pz)) continue;
        if (q.top >= part.top - LOWER_EPS) { hidden = true; break; }
        if (lowerY === null || q.top > lowerY) lowerY = q.top;
      }
      if (hidden) { cur = null; continue; }
      if (cur && Math.abs((cur.lowerY ?? -1e9) - (lowerY ?? -1e9)) < LOWER_EPS) { cur.s1 = s1; continue; }
      cur = { i, frame: f, s0, s1, lowerY };
      runs.push(cur);
    }
  }
  return runs;
}
