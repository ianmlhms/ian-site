/* The benches of the parks of Lux Drive: where they stand.  Pure (no THREE), deterministic.
 *
 * A bench stands beside a footpath that runs through a PARK (the land class `park`: Parc de la Ville, Parc Central
 * Kirchberg, Parc Municipal ...), every ~48 m, on alternating sides, with its back turned away from the path.  It never stands
 * in a carriageway, in a house or on the path itself. */
import { sampleWorldMap } from './world-map.js';

export const BENCH = Object.freeze({
  spacing: 48,                    // m along a path
  kinds: ['footway', 'path', 'pedestrian', 'cycleway'],
  minPark: 0.6,                   // the share of park at the place from which a path counts as a park path
  setback: 0.55,                  // m between the edge of the path and the front of the bench
  keepOffBuildings: 0.8,          // m
});

/** Returns { count, x, z, yaw } (yaw: the direction the bench FACES, towards the path). */
export function placeParkBenches({ roads, network, buildings, map }) {
  const xs = [], zs = [], yaws = [];
  const land = { park: 0 };
  const info = { sdCar: 9, sdPave: 9 };
  for (const road of roads) {
    if (!BENCH.kinds.includes(road.kind) || road.tunnel || road.bridge || road.over || road.layer !== 0) continue;
    let carry = BENCH.spacing * 0.5, side = road.id % 2 ? 1 : -1;
    for (let i = 1; i < road.pts.length; i++) {
      const [ax, az] = road.pts[i - 1], [bx, bz] = road.pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      let d = carry;
      while (d <= len) {
        const cx = ax + dx * d, cz = az + dz * d;
        d += BENCH.spacing;
        side = -side;
        sampleWorldMap(map, cx, cz, land);
        if (land.park < BENCH.minPark) continue;
        const off = Math.max(0.8, road.width / 2) + BENCH.setback;
        const px = cx - dz * off * side, pz = cz + dx * off * side;
        network.carve(px, pz, info);
        if (info.sdCar < 0.15) continue;                                // on a path or a road: the bench stands beside them
        if (buildings.collide(px, pz, BENCH.keepOffBuildings)) continue;
        xs.push(px); zs.push(pz);
        yaws.push(Math.atan2(dz * side, -dx * side));                  // faces the path: the opposite of the side it stands on
      }
      carry = d - len;
    }
  }
  return { count: xs.length, x: Float32Array.from(xs), z: Float32Array.from(zs), yaw: Float32Array.from(yaws) };
}
