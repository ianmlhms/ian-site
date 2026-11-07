/* Lux Drive sweep 2, step 1: the camera points.  One point every ~30 m along every car road (first and last 8 m left to the junctions), points closer than 15 m on the
 * same level dropped, ordered by 384 m cells (a snake) so the browser walks the map and the tiles stay cached.  Each point carries the slice of its road (+-52 m, every 2 m)
 * for the lane-colour / marking probes, and the lane offsets for the "object in a lane" probe.  Needs the world in Node (~0.6 GB): run once, then the browser phase starts.
 *   node look-points.mjs <out.json> [--area x0,z0,x1,z1] [--limit N] */
import fs from 'node:fs';
import { loadWorld } from './world.mjs';
import { isMarkedWay } from '../../../pb/lux-drive/carriageways.js';

const SPACING = 30, DEDUPE = 15, EDGE = 8, SLICE = 52, SLICE_STEP = 2, CELL = 384;
const CAR = { rideHeight: 0.42 };

/** The polyline of a road resampled every `step` m: [[x, z, arc]]. */
function resample(pts, step) {
  const out = [[pts[0][0], pts[0][1], 0]];
  let arc = 0, next = step;
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (l < 1e-6) continue;
    while (next <= arc + l) { const f = (next - arc) / l; out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f, next]); next += step; }
    arc += l;
  }
  return out;
}

export async function buildPoints({ area = null, limit = 0 } = {}) {
  const world = await loadWorld();
  const { roads, ground, surface, tubes } = world;
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / DEDUPE)},${Math.floor(z / DEDUPE)}`;
  const near = (x, z, lvl) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const p of grid.get(`${Math.floor(x / DEDUPE) + a},${Math.floor(z / DEDUPE) + b}`) || []) if (p.lvl === lvl && Math.hypot(p.x - x, p.z - z) < DEDUPE) return true;
    return false;
  };
  const points = [];
  const sorted = roads.slice().sort((a, b) => (a.kind === b.kind ? a.id - b.id : (a.kind < b.kind ? -1 : 1)));
  for (const r of sorted) {
    if (area && !r.pts.some((p) => p[0] >= area[0] && p[1] >= area[1] && p[0] <= area[2] && p[1] <= area[3])) continue;
    const line = resample(r.pts, 1);                           // every metre: the slices and the points are cut from it
    if (line.length < 2 * EDGE + 2) continue;
    const marked = isMarkedWay(r);
    const lvl = r.tunnel ? 'tunnel' : (r.bridge || r.over) ? 'bridge' : 'ground';
    const total = line.length - 1;
    for (let s = Math.min(EDGE + 4, total / 2); s <= total - EDGE; s += SPACING) {
      const i = Math.round(s), p = line[i];
      if (!playInside(world, p[0], p[1]) || near(p[0], p[1], lvl)) continue;
      const a = line[Math.max(0, i - 2)], b = line[Math.min(total, i + 2)];
      const yaw = Math.atan2(b[1] - a[1], b[0] - a[0]);
      let hint;
      if (r.tunnel) {
        hint = null;
        for (const t of tubes.tubes) { if (!t.ids.includes(r.id)) continue; let bi = 0, bd = 1e9; for (let k = 0; k < t.x.length; k++) { const d = Math.hypot(t.x[k] - p[0], t.z[k] - p[1]); if (d < bd) { bd = d; bi = k; } } hint = t.floor[bi] + CAR.rideHeight + 0.3; break; }
        if (hint === null) continue;
      } else if (lvl === 'bridge') hint = 1e9;
      else hint = ground.levelAt(p[0], p[1], surface.height(p[0], p[1]) + 0.5) + CAR.rideHeight;
      const slice = [];
      for (let k = -SLICE; k <= SLICE; k += SLICE_STEP) { const q = line[Math.max(0, Math.min(total, i + k))]; slice.push([+q[0].toFixed(1), +q[1].toFixed(1)]); }
      const pt = { id: points.length, x: +p[0].toFixed(2), z: +p[1].toFixed(2), yaw: +yaw.toFixed(4), road: r.id, name: r.name || '', kind: r.kind, width: r.width, lanes: world.laneOffsets(r), oneway: !!r.oneway, level: lvl, hint: hint > 1e8 ? 1e9 : +hint.toFixed(2), marked, slice };
      points.push(pt);
      const k = key(p[0], p[1]); (grid.get(k) || grid.set(k, []).get(k)).push({ x: p[0], z: p[1], lvl });
    }
  }
  // a snake over 384 m cells, rows alternate direction
  const cellOf = (p) => [Math.floor(p.z / CELL), Math.floor(p.x / CELL)];
  points.sort((a, b) => { const [ra, ca] = cellOf(a), [rb, cb] = cellOf(b); return ra - rb || (ra % 2 ? cb - ca : ca - cb) || a.road - b.road || a.id - b.id; });
  const out = (limit ? points.filter((_, i) => i % Math.max(1, Math.floor(points.length / limit)) === 0).slice(0, limit) : points).map((p, i) => ({ ...p, id: i }));
  const km = roads.reduce((s, r) => s + (r.length || 0), 0) / 1000;
  return { points: out, roads: roads.length, km };
}

const playInside = (world, x, z) => world.playArea.inside(x, z);

if (process.argv[1] && process.argv[1].endsWith('look-points.mjs')) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i < 0 ? d : process.argv[i + 1]; };
  const area = arg('--area', '') ? arg('--area', '').split(',').map(Number) : null;
  const res = await buildPoints({ area, limit: Number(arg('--limit', 0)) });
  fs.writeFileSync(process.argv[2], JSON.stringify(res));
  console.log(`[look-points] ${res.points.length} points over ${res.roads} roads (${res.km.toFixed(0)} km) -> ${process.argv[2]}`);
}
