/* Lane-count flicker: OSM cuts a road into a new way at every change of its lane count, and on the big boulevards the count flickers (Av. J.F. Kennedy: 2 / 3 / 4 lanes every
 * 50 - 100 m; Boulevard Konrad Adenauer: 10.2 m, 6.9 m for 10 m, 13.5 m).  A run of ways of one carriageway shorter than FLICKER.maxRun that is NARROWER than the carriageway on both
 * sides of it is a flicker of the data (a lane that is mapped for a few metres less), not a pinch of the road: it takes the narrower of its two neighbours' width and lanes, so the
 * tarmac (road-network.js) and the lane markings (markings.js) keep the wider road through it.  A short WIDER run (a turning lane before a junction) is real and is kept: the network
 * tapers the tarmac into it (road-network.js taperWidths) as the markings taper their lines.
 * Applied in loadWorldData, so the game, the harness and the bakers read the same widths.  Pure: returns new road objects for the changed ways, the others as they are. */
import { chainCarriageways } from './carriageways.js';

export const FLICKER = Object.freeze({
  maxRun: 60,          // m: a narrower run of ways shorter than this between two wider stretches is flicker
  minDiff: 0.05,       // m: widths that differ by less than this are the same
  treeClear: 0.5,      // m: a tree of OSM this close to the wider carriageway's edge (or inside it) says the narrow way is real (Route de Trèves 11233,5990; Boulevard Royal 5057,8423)
});

/** The distance from (x, z) to the polyline pts. */
function polylineDist(pts, x, z) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], az = pts[i - 1][1], ex = pts[i][0] - ax, ez = pts[i][1] - az, ll = ex * ex + ez * ez;
    const t = ll > 1e-9 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / ll)) : 0;
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return best;
}

/** roads: the decoded roads (road.id = the index); trees: the OSM trees [{ x, z }] (a tree inside the wider road is evidence that the road IS narrower there: not filled).
 *  Returns { roads, filled: [{ id, from, to, run }] }. */
export function fillLaneFlicker(roads, trees = []) {
  const TC = 32, treeGrid = new Map();
  for (const t of trees) { const k = Math.floor(t.x / TC) * 65536 + Math.floor(t.z / TC); const l = treeGrid.get(k); if (l) l.push(t); else treeGrid.set(k, [t]); }
  /** A tree stands within the half width `hw` of the way (and so inside the wider carriageway). */
  const treeInside = (road, hw) => road.pts.some((p, i) => i % 2 === 0 && [-1, 0, 1].some((a) => [-1, 0, 1].some((b) =>
    (treeGrid.get((Math.floor(p[0] / TC) + a) * 65536 + Math.floor(p[1] / TC) + b) || []).some((t) => polylineDist(road.pts, t.x, t.z) < hw + FLICKER.treeClear))));
  const lineOf = (r) => (r.pts && r.pts.length >= 2 ? { x: r.pts.map((p) => p[0]), z: r.pts.map((p) => p[1]) } : null);
  const { chainWays } = chainCarriageways(roads, lineOf);
  const width = roads.map((r) => r.width), lanes = roads.map((r) => r.lanes);
  const filled = [];
  for (const ws of chainWays) {
    // runs of equal width; repeat until no run is a flicker (filling one can make its neighbours' run a flicker of the next level)
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      let i = 0;
      while (i < ws.length) {
        let j = i, run = 0;
        while (j < ws.length && Math.abs(width[ws[j].road] - width[ws[i].road]) < FLICKER.minDiff) { run += roads[ws[j].road].length || 0; j++; }
        if (i > 0 && j < ws.length && run < FLICKER.maxRun) {
          const left = ws[i - 1].road, right = ws[j].road, w = width[ws[i].road];
          const src = width[left] <= width[right] ? left : right;
          let real = false;
          for (let k = i; k < j && !real; k++) real = treeInside(roads[ws[k].road], width[src] / 2);
          if (!real && width[left] > w + FLICKER.minDiff && width[right] > w + FLICKER.minDiff) {
            for (let k = i; k < j; k++) {
              filled.push({ id: ws[k].road, from: width[ws[k].road], to: width[src], run });
              width[ws[k].road] = width[src]; lanes[ws[k].road] = lanes[src];
            }
            changed = true;
          }
        }
        i = j;
      }
      if (!changed) break;
    }
  }
  if (!filled.length) return { roads, filled };
  const ids = new Set(filled.map((f) => f.id));
  return { roads: roads.map((r) => (ids.has(r.id) ? { ...r, width: width[r.id], lanes: lanes[r.id], flicker: true } : r)), filled };
}
