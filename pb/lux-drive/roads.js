/* The road network of Lux Drive: the decoder of pb/lux-drive/data/roads.bin and the description of the road classes.
 * Pure (no THREE), so the browser and the Node harness read exactly the same network. */
import { ROAD } from './config.js';

export const ROAD_KINDS = Object.freeze([
  'bridleway', 'busway', 'cycleway', 'footway', 'living_street', 'motorway',
  'motorway_link', 'path', 'pedestrian', 'primary', 'primary_link', 'residential',
  'road', 'secondary', 'secondary_link', 'service', 'steps', 'tertiary',
  'tertiary_link', 'track', 'trunk', 'trunk_link', 'unclassified',
]);

export const FLAG_BRIDGE = 1;
export const FLAG_TUNNEL = 2;
export const FLAG_ONEWAY = 4;
export const FLAG_ROUNDABOUT = 8;
export const FLAG_SURFACE_SHIFT = 4;       // bits 4-7 hold the material of the way (0 = the default of the class)
export const FLAG_OVER = 256;              // bit 8: the way rides over the ground (a bridge, or a layer above it)
const NO_NAME = 0xffff;
const DECIMETRE = 0.1;

/* What every class is: may a car drive on it, what is it made of, how is it painted.
 *   surface   the material the physics reads under the tyres
 *   lines     the lane markings: 0 none, 1 a dashed centre line, 2 a solid centre line, 3 a footpath, 4 stairs
 *   speed     the share of the top speed the class allows (a car may go faster on a motorway than in a living street) */
const INFO = {
  motorway: { drivable: true, surface: 'asphalt', lines: 2, speed: 1.0 },
  motorway_link: { drivable: true, surface: 'asphalt', lines: 1, speed: 0.8 },
  trunk: { drivable: true, surface: 'asphalt', lines: 2, speed: 0.95 },
  trunk_link: { drivable: true, surface: 'asphalt', lines: 1, speed: 0.75 },
  primary: { drivable: true, surface: 'asphalt', lines: 1, speed: 0.85 },
  primary_link: { drivable: true, surface: 'asphalt', lines: 0, speed: 0.65 },
  secondary: { drivable: true, surface: 'asphalt', lines: 1, speed: 0.8 },
  secondary_link: { drivable: true, surface: 'asphalt', lines: 0, speed: 0.6 },
  tertiary: { drivable: true, surface: 'asphalt', lines: 0, speed: 0.72 },
  tertiary_link: { drivable: true, surface: 'asphalt', lines: 0, speed: 0.55 },
  unclassified: { drivable: true, surface: 'asphalt', lines: 0, speed: 0.6 },
  residential: { drivable: true, surface: 'asphalt', lines: 0, speed: 0.55 },
  living_street: { drivable: true, surface: 'cobble', lines: 0, speed: 0.28 },
  pedestrian: { drivable: true, surface: 'stone', lines: 3, speed: 0.25 },
  service: { drivable: true, surface: 'asphalt', lines: 0, speed: 0.4 },
  busway: { drivable: true, surface: 'asphalt', lines: 0, speed: 0.45 },
  road: { drivable: true, surface: 'asphalt', lines: 0, speed: 0.5 },
  track: { drivable: true, surface: 'gravel', lines: 0, speed: 0.3 },
  cycleway: { drivable: false, surface: 'concrete', lines: 3, speed: 0 },
  path: { drivable: false, surface: 'gravel', lines: 3, speed: 0 },
  footway: { drivable: false, surface: 'concrete', lines: 3, speed: 0 },
  bridleway: { drivable: false, surface: 'dirt', lines: 3, speed: 0 },
  steps: { drivable: false, surface: 'concrete', lines: 4, speed: 0 },
};

export const kindInfo = (kind) => INFO[kind] || { drivable: false, surface: 'dirt', lines: 3, speed: 0 };

/* The material of a road, as the number the ground shader switches on.  The OSM surface tag of the way
 * overrides the default of its class: a street with surface=sett is cobbled, a pedestrian area with
 * surface=paving_stones is paved. */
export const SURFACE_CODES = Object.freeze({ asphalt: 0, cobble: 1, concrete: 2, gravel: 3, dirt: 4, stone: 5 });
/* The same materials, the other way round. */
export const SURFACE_NAMES = Object.freeze(Object.keys(SURFACE_CODES));
/* The material of every class, indexed by the class code the road network carries. */
export const KIND_SURFACE = Object.freeze(ROAD_KINDS.map((k) => SURFACE_CODES[kindInfo(k).surface] ?? 0));

function readVarint(bytes, state) {
  let result = 0, shift = 0;
  for (;;) {
    const b = bytes[state.pos++];
    result += (b & 0x7f) * 2 ** shift;
    if (b < 0x80) return result;
    shift += 7;
    if (shift > 49) throw new Error('roads: varint too long');
  }
}
const unzigzag = (n) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

/**
 * roads.bin + names.json -> [{ id, kind, info, bridge, tunnel, oneway, roundabout, layer, lanes, name,
 *                             width, sidewalk, offset, length, pts: [[x, z], ...], surface, surfaceCode }]
 * `offset` is the distance from the centre line to the centre of the right-hand lane (Luxembourg drives on the right);
 * a car travelling against the way drives on the other side, at -offset.
 * `surface` is the material of the way ('asphalt', 'stone', 'cobble', ...): the OSM surface tag of the way, or the
 * default of its class.
 */
export function decodeRoads(bin, names) {
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const count = view.getUint32(0, true);
  const state = { pos: 4 };
  const roads = [];
  for (let r = 0; r < count; r++) {
    const kindCode = view.getUint16(state.pos, true);
    const flags = view.getUint16(state.pos + 2, true);
    const layer = view.getInt16(state.pos + 4, true);
    const lanes = view.getUint16(state.pos + 6, true);
    const nameId = view.getUint16(state.pos + 8, true);
    const width = view.getFloat32(state.pos + 10, true);
    const sidewalk = view.getFloat32(state.pos + 14, true);
    const offset = view.getFloat32(state.pos + 18, true);
    const n = view.getUint16(state.pos + 22, true);
    let x = view.getInt32(state.pos + 24, true);
    let z = view.getInt32(state.pos + 28, true);
    state.pos += 32;
    const pts = [[x * DECIMETRE, z * DECIMETRE]];
    for (let i = 1; i < n; i++) {
      x += unzigzag(readVarint(bin, state));
      z += unzigzag(readVarint(bin, state));
      pts.push([x * DECIMETRE, z * DECIMETRE]);
    }
    const kind = ROAD_KINDS[kindCode] || 'road';
    const info = kindInfo(kind);
    // the material of the way: the OSM surface tag of the way, else the default of its class
    const surfBits = (flags >> FLAG_SURFACE_SHIFT) & 15;
    const surfaceCode = surfBits ? surfBits - 1 : (SURFACE_CODES[info.surface] ?? 0);
    const surface = SURFACE_NAMES[surfaceCode] || 'asphalt';
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    roads.push({
      id: r, kind, info, bridge: (flags & FLAG_BRIDGE) !== 0, tunnel: (flags & FLAG_TUNNEL) !== 0,
      over: (flags & FLAG_OVER) !== 0,
      oneway: (flags & FLAG_ONEWAY) !== 0, roundabout: (flags & FLAG_ROUNDABOUT) !== 0,
      layer, lanes, name: nameId === NO_NAME ? '' : (names[nameId] || ''),
      width, sidewalk, offset, length, pts, surface, surfaceCode,
    });
  }
  return roads;
}

/** The roads a car may drive on. Tunnels are not in the network: a single-valued height field cannot hold a tunnel
 *  under the city without cutting a canyon through it - the tunnels get their portals instead (see decks.js). */
export const drivableRoads = (roads) => roads.filter((r) => r.info.drivable && !r.tunnel);

/** The length of a road in metres. */
export const roadLength = (road) => road.length;

/**
 * The direction of the way at a point: the unit vector of the nearest segment of its polyline, in the order of
 * the way (the direction the traffic runs when the way is one way).  null when the way has no length.
 */
export function roadDirectionAt(road, x, z) {
  const p = road.pts;
  let best = null;
  for (let i = 0; i + 1 < p.length; i++) {
    const ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1];
    const dx = bx - ax, dz = bz - az;
    const ll = dx * dx + dz * dz;
    if (ll < 1e-9) continue;
    const len = Math.sqrt(ll);
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / ll));
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (!best || d < best.dist) best = { dist: d, x: dx / len, z: dz / len };
  }
  return best;
}

/** The half width of the carriageway of a road (m). */
export const carriageHalf = (road) => Math.max(0.8, road.width / 2);

/** The outer radius of a road's influence: the carriageway, the kerb, the pavement and the falloff (m). */
export const roadRadius = (road) => Math.min(ROAD.maxRadius, carriageHalf(road) + ROAD.kerbWidth + road.sidewalk + ROAD.falloff);
