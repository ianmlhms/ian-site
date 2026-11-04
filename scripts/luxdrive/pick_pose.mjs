/* Picks montage camera poses that are never inside a tree or a building.
 *   node scripts/luxdrive/pick_pose.mjs <name> <tx> <tz> <ty> <dist> [bearingDeg] [height] [fov] [clearance]
 *
 * A pose is a point ON A ROAD (the car could stand there) at about `dist` m from the target (tx, tz), with nothing of the world
 * (house footprint, baked tree, wood tree, landmark footprint) within `clearance` m (default 8) of it and a clear line of sight to the
 * target: no house whose eaves rise above the sight line stands in between.  `bearingDeg` (compass of the camera as seen from the
 * target, 0 = +x, 90 = +z) prefers a side; without it the best view wins.  Prints one JSON pose for scripts/luxdrive/shoot.mjs;
 * several calls can be joined with `--all name:tx,tz,ty,dist[,bearing] ...`. */
import { loadWorld } from './world_node.mjs';
import { createLandmarks } from '../../pb/lux-drive/landmarks.js';
import { createBuildingIndex } from '../../pb/lux-drive/buildings.js';
import { createRoadIndex } from '../../pb/lux-drive/road-index.js';
import { createTreeIndex } from '../../pb/lux-drive/trees.js';
import { buildWorldMap } from '../../pb/lux-drive/world-map.js';
import { insidePoly } from '../../pb/lux-drive/landmark-util.js';

const EYE = 3.2;                  // m above the road: a chase camera over a car
const SIGHT_STEP = 3;             // m along the sight line

export async function createPicker() {
  const w = await loadWorld();
  const lm = createLandmarks({ buildings: w.data.buildings, decks: w.deckNetwork.decks, ground: (x, z) => w.surface.height(x, z) });
  const index = createBuildingIndex(w.data.buildings, { hidden: lm.hiddenBuildings });
  const roads = createRoadIndex(w.data.roads);
  const maps = buildWorldMap({ classes: w.data.classes, classInfo: w.data.classInfo, canopy: w.data.canopy, buildings: w.data.buildings });
  const forest = createTreeIndex({ map: maps, field: w.field, network: w.field.network, buildings: index, trees: w.data.trees });
  const byId = new Map(w.data.buildings.map((b) => [b.id, b]));
  const ground = (x, z) => w.surface.height(x, z);

  /** The nearest thing of the world within `r` of (x, z) (a house, a baked tree, a wood tree, a landmark wall), or null. */
  function obstacle(x, z, r) {
    if (index.collide(x, z, r)) return 'building';
    if (lm.collide(x, z, r)) return 'landmark';
    if (forest.collide(x, z, r)) return 'tree';
    for (const i of forest.near(x, z, r + 4)) { const t = w.data.trees[i]; if (t && Math.hypot(t.x - x, t.z - z) < r) return 'osm-tree'; }
    return null;
  }

  /** Is the sight line from (x, z, y) to (tx, tz, ty) free of houses? (landmark blocks are the target itself: not tested) */
  function sightClear(x, z, y, tx, tz, ty, stopShort) {
    const len = Math.hypot(tx - x, tz - z);
    for (let s = SIGHT_STEP; s < len - stopShort; s += SIGHT_STEP) {
      const px = x + ((tx - x) * s) / len, pz = z + ((tz - z) * s) / len, py = y + ((ty - y) * s) / len;
      for (const id of index.near(px, pz, 2)) {
        const b = byId.get(id);
        const pts = []; for (let i = 0; i < b.pts.length; i += 2) pts.push([b.pts[i], b.pts[i + 1]]);
        if (insidePoly(pts, px, pz) && ground(px, pz) + b.eave > py) return false;
      }
    }
    return true;
  }

  /** The best road point for a target. Returns the pose object or throws (a landmark nobody can see is an error). */
  function pick({ name, tx, tz, ty = 12, dist = 60, bearing = null, height = EYE, fov = 60, clearance = 8, sightStop = 12 }) {
    let best = null;
    for (let r = dist * 0.55; r <= dist * 1.6; r += 6) {
      for (let a = 0; a < 360; a += 6) {
        const x = tx + Math.cos((a * Math.PI) / 180) * r, z = tz + Math.sin((a * Math.PI) / 180) * r;
        const hit = roads.nearest(x, z, 8);
        if (!hit || hit.road.bridge || hit.road.tunnel) continue;
        const px = hit.x, pz = hit.z;
        if (obstacle(px, pz, clearance)) continue;
        const y = ground(px, pz) + height;
        if (!sightClear(px, pz, y, tx, tz, ground(tx, tz) + ty, sightStop)) continue;
        const d = Math.hypot(px - tx, pz - tz);
        let score = Math.abs(d - dist);
        if (bearing != null) { const b = (Math.atan2(pz - tz, px - tx) * 180) / Math.PI; score += Math.abs(((b - bearing + 540) % 360) - 180) * 0.6; }
        if (!best || score < best.score) best = { score, x: px, z: pz };
      }
    }
    if (!best) throw new Error(`pick_pose ${name}: no clear road point within ${dist * 1.6} m of (${tx}, ${tz})`);
    return { name, x: +best.x.toFixed(1), z: +best.z.toFixed(1), h: height, tx, tz, ty, fov };
  }
  return { pick, obstacle, sightClear, ground, roads, index };
}

if (process.argv[1].endsWith('pick_pose.mjs')) {
  const picker = await createPicker();
  const args = process.argv.slice(2);
  if (args[0] === '--all') {
    const out = args.slice(1).map((spec) => {
      const [name, rest] = spec.split(':');
      const [tx, tz, ty, dist, bearing] = rest.split(',').map(Number);
      return picker.pick({ name, tx, tz, ty, dist, bearing: Number.isFinite(bearing) ? bearing : null });
    });
    console.log(JSON.stringify(out, null, 1));
  } else {
    const [name, tx, tz, ty, dist, bearing, height, fov, clearance] = args;
    console.log(JSON.stringify(picker.pick({ name, tx: +tx, tz: +tz, ty: +ty, dist: +dist, bearing: bearing != null && bearing !== '-' ? +bearing : null, height: height ? +height : undefined, fov: fov ? +fov : undefined, clearance: clearance ? +clearance : undefined })));
  }
}
