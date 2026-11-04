/* The speed limit of the road under the car (the sign in the HUD).
 *
 * The baked roads do not carry the OSM `maxspeed` tag (the bake keeps the width, the lanes and the surface), so the limit is
 * the Luxembourg default of the class of the road: 50 km/h inside a town, 90 km/h outside, 130 km/h on a motorway (110 in
 * the rain, as the law says), and a few lower limits for the streets where nobody drives fast.  A road that does carry a
 * `maxspeed` (km/h, a future bake) wins over every default.  The sign is information only: the car is never slowed by it. */
import { sampleClass, CLASS } from './world-map.js';

const URBAN_KMH = 50;
const RURAL_KMH = 90;
const MOTORWAY_KMH = 130;
const MOTORWAY_WET_KMH = 110;
const MOTORWAY_URBAN_KMH = 90;       // the A1 / A6 through the city are limited
const LINK_KMH = 70;
const FIXED_KMH = Object.freeze({ living_street: 20, pedestrian: 10, service: 30, track: 30, busway: 50 });
const WET_FROM = 0.4;                // the wetness (0..1) from which the motorway limit drops
const PROBE_M = 24;                  // m: the town probe looks this far to each side
const URBAN_VOTES = 3;               // of 5 probes (the point and four around it) must be built-up
const CROWD_RADIUS_M = 150;          // m: the buildings within this reach (the index counts whole 32 m cells) ...
const CROWD_BUILDINGS = 10;          // ... this many of them make a town (a farm has three or four, Kirchberg has fourteen big blocks)

/**
 * Is (x, z) in a town?  Two witnesses: five samples of the class raster (a park or a car park inside a town must not turn the
 * sign to 90), or a crowd of buildings around (Kirchberg is built of big blocks with wide open ground between them, which the
 * class raster does not call urban).  `buildings` is the building index (optional).
 */
export function isUrban(map, x, z, buildings = null) {
  let votes = 0;
  for (const [dx, dz] of [[0, 0], [PROBE_M, 0], [-PROBE_M, 0], [0, PROBE_M], [0, -PROBE_M]]) {
    if (sampleClass(map, x + dx, z + dz) === CLASS.urban) votes += 1;
  }
  if (votes >= URBAN_VOTES) return true;
  return !!buildings && buildings.near(x, z, CROWD_RADIUS_M).length >= CROWD_BUILDINGS;
}

/** The limit in km/h for a road kind in a town (`urban`) or outside (`wet` is the wetness of the weather, 0..1). */
export function limitFor(road, urban, wet = 0) {
  // the posted limit wins, except that a wet motorway in Luxembourg is 110 whatever the sign says
  if (road.maxspeed > 0) return road.maxspeed === MOTORWAY_KMH && wet > WET_FROM ? MOTORWAY_WET_KMH : road.maxspeed;
  const kind = road.kind;
  if (kind === 'motorway') return urban ? MOTORWAY_URBAN_KMH : (wet > WET_FROM ? MOTORWAY_WET_KMH : MOTORWAY_KMH);
  if (kind === 'motorway_link' || kind === 'trunk_link') return urban ? URBAN_KMH : LINK_KMH;
  if (FIXED_KMH[kind]) return FIXED_KMH[kind];
  return urban ? URBAN_KMH : RURAL_KMH;
}

/**
 * The sign tracker: asks the map only when the road or the 32 m cell under the car changes.
 * `update(road, x, z, wet)` returns the limit (km/h) or 0 when the car is not on a road.
 */
export function createSpeedLimit(map, buildings = null) {
  let roadId = -2, cell = -1, urban = false;
  return {
    update(road, x, z, wet) {
      if (!road) return 0;
      const c = Math.floor(x / 32) * 4096 + Math.floor(z / 32);
      if (road.id !== roadId || c !== cell) { roadId = road.id; cell = c; urban = isUrban(map, x, z, buildings); }
      return limitFor(road, urban, wet);
    },
  };
}
