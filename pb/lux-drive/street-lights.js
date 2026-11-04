/* The street lights of Lux Drive: where they stand.  Pure (no THREE), deterministic: the bake does not know about lamps, the
 * game places them along the urban streets from the road network.
 *
 * A lamp stands on the pavement beside a street that has built-up surroundings, every `spacing` metres, on alternating
 * sides (the way the municipal lighting of Luxembourg does it on the through streets).  It never stands in a carriageway,
 * on a bridge or in a house; outside the built-up area (a field road, a forest track, the motorway outside the city)
 * there are no lamps. */
import { sampleDensity } from './world-map.js';
import { ROAD } from './config.js';

export const LIGHT = Object.freeze({
  spacing: { primary: 26, secondary: 26, trunk: 30, tertiary: 28, unclassified: 32, residential: 30, living_street: 26, service: 0, pedestrian: 0 },
  minDensity: 0.045,            // the built share of the neighbourhood from which the street is lit
  clearAhead: 0.45,             // m between the foot of the lamp and the kerb
  keepOffBuildings: 0.5,        // m: a lamp never stands closer than this to a house
});

/**
 * roads: decoded roads, network: field.network (carve), buildings: the building index, map: buildWorldMap result.
 * Returns { count, x, z, yaw, size }: typed arrays; yaw is the direction the arm reaches (towards the street), size 0 = a small lamp, 1 = a tall one.
 */
export function placeStreetLights({ roads, network, buildings, map }) {
  const xs = [], zs = [], yaws = [], sizes = [];
  const info = { coverage: 0, sdCar: 9, sdPave: 9, band: 0 };
  for (const road of roads) {
    const spacing = LIGHT.spacing[road.kind];
    if (!spacing || road.tunnel || road.bridge || road.over || road.layer !== 0) continue;
    const half = Math.max(0.8, road.width / 2);
    const lat = half + ROAD.kerbWidth + LIGHT.clearAhead + (road.sidewalk >= 1.2 ? 0.1 : 0.7);     // on the pavement, or on the verge where the street has none
    let carry = spacing * 0.5, side = road.id % 2 ? 1 : -1;
    for (let i = 1; i < road.pts.length; i++) {
      const [ax, az] = road.pts[i - 1], [bx, bz] = road.pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      let d = carry;
      while (d <= len) {
        const cx = ax + dx * d, cz = az + dz * d;
        d += spacing;
        side = -side;
        if (sampleDensity(map, cx, cz) < LIGHT.minDensity) continue;
        // right of the way = (-dz, dx) in this frame (x east, z south); the lamp stands on `side` of it
        const px = cx - dz * lat * side, pz = cz + dx * lat * side;
        network.carve(px, pz, info);
        if (info.sdCar < 0.1) continue;                            // a carriageway (this street's own side, or another street's)
        if (buildings.collide(px, pz, LIGHT.keepOffBuildings)) continue;
        xs.push(px); zs.push(pz);
        yaws.push(Math.atan2(dz * side, -dx * side));              // the arm reaches towards the street: the opposite of the side the lamp stands on
        sizes.push(road.kind === 'primary' || road.kind === 'secondary' || road.kind === 'trunk' ? 1 : 0);
      }
      carry = d - len;
    }
  }
  return { count: xs.length, x: Float32Array.from(xs), z: Float32Array.from(zs), yaw: Float32Array.from(yaws), size: Uint8Array.from(sizes) };
}
