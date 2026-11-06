/* The LOD2 survey of a landmark (landmark-lod2-data.js, copied from the train simulator) as flat-shaded faces of a Soup (city13).
 *
 * The survey is the real shape of a building: every roof face and every wall face as a planar polygon.  Lux Drive's landmarks are
 * vertex-coloured (no texture atlas like the train simulator's), so a face gets a colour from the caller (by its slope and height) and
 * the windows, cornices and clocks are added by the landmark itself.  The polygons stand on the land: a vertex at the foot of the
 * survey (y under FOOT) goes down to the drawn ground there minus SINK, so a wall never floats over the carved lattice.
 * Pure geometry, no THREE (the harness builds the same faces).  Nothing here mutates its inputs. */
import { triangulate, paint } from './landmark-soup.js';
import { LOD2 } from './landmark-lod2-data.js';

const DM = 0.1;               // the data is in decimetres
const FOOT = 0.35;            // m: (base) a vertex this close to the survey's lowest ground is a foot of the building
const FOOT_TOL = 0.8;         // m: a vertex at most this far over the drawn ground under it is a foot (the survey follows the slope)
export const LOD2_SINK = 1.0; // m: the feet go this far under the drawn ground
const ROOF_PROBE = [0.6, 1.5, 3.0]; // m: how far in front of / behind a wall the roofs are looked for
const RUN_ANGLE = 6;          // deg: faces of one straight facade
const RUN_DEV = 0.6;          // m: the most a face of a straight facade may stand off its line (a pier)
const EPS_OUT = 0.04;         // m: a window stands this far in front of its face (no z-fighting)
const RUN_GAP = 1.6;          // m: the longest jog between two faces of one facade

/** The buildings of a landmark key ('gare', 'etoile', 'hamilius'), optionally only some roles: [{ role, osm, roofs, walls }] with
 *  polygons as [[x, z, y], ...] in the world frame (y over the survey's ground of that building). */
export function lod2Buildings(key, roles = null) {
  const entry = LOD2[key];
  if (!entry) throw new Error(`LOD2: no survey for the landmark "${key}"`);
  const [ox, oz] = entry.origin;
  const ring = (flat) => {
    const pts = [];
    for (let i = 0; i < flat.length; i += 3) pts.push([ox + flat[i] * DM, oz + flat[i + 1] * DM, flat[i + 2] * DM]);
    const a = pts[0], b = pts[pts.length - 1];
    return pts.length > 3 && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] ? pts.slice(0, -1) : pts;   // the survey closes a few rings
  };
  const list = entry.b.filter((b) => !roles || roles.includes(b.role))
    .map((b) => ({ role: b.role, osm: b.osm, roofs: b.roofs.map(ring), walls: b.walls.map(ring) }));
  if (roles && list.length !== roles.length) throw new Error(`LOD2 ${key}: roles ${roles.join(',')} wanted, ${list.map((b) => b.role).join(',')} found`);
  return list;
}

/** The unnormalised normal of a ring of [x, z, y] (Newell), as [nx, ny, nz] in the world axes; its length is twice the area. */
export function ringNormal(ring) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    nx += (p[2] - q[2]) * (p[1] + q[1]);
    ny += (p[1] - q[1]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[2] + q[2]);
  }
  return [nx, ny, nz];
}

/** Area (m^2), slope (deg from horizontal; 90 = a wall) and top (m over the survey's ground) of a ring. */
export function ringInfo(ring) {
  const n = ringNormal(ring);
  const len = Math.hypot(n[0], n[1], n[2]);
  const slope = len > 1e-9 ? (Math.acos(Math.min(1, Math.abs(n[1]) / len)) * 180) / Math.PI : 90;
  let top = -Infinity, bottom = Infinity, cx = 0, cz = 0;
  for (const p of ring) { top = Math.max(top, p[2]); bottom = Math.min(bottom, p[2]); cx += p[0] / ring.length; cz += p[1] / ring.length; }
  return { area: len / 2, slope, top, bottom, cx, cz, normal: len > 1e-9 ? [n[0] / len, n[1] / len, n[2] / len] : [0, 1, 0] };
}

/**
 * Add the faces of LOD2 buildings to a soup.
 *   base: y of the survey's ground (y = 0 of the data) in the world
 *   ground: (x, z) -> the drawn ground; the feet go to ground - LOD2_SINK
 *   colorOf(ring, info, kind): a colour [r, g, b] for the face, or null to leave the face out (kind 'roof' | 'wall')
 *   minArea: m^2, smaller faces are left out (chimneys, the slivers of the survey) unless keepSmall(info, kind) says otherwise
 * Returns { faces, dropped, triangles }.
 */
export function addLod2(soup, buildings, { base, ground, colorOf, minArea = 0, keepSmall = null }) {
  let faces = 0, dropped = 0;
  const t0 = soup.triangleCount;
  // a foot: on the survey's lowest ground, or on the drawn ground under it (a building on a slope)
  const world = ([x, z, y]) => { const g = ground(x, z); return [x, y < FOOT || base + y < g + FOOT_TOL ? Math.min(base + y, g) - LOD2_SINK : base + y, z]; };
  for (const b of buildings) {
    for (const [kind, rings] of [['roof', b.roofs], ['wall', b.walls]]) {
      for (const ring of rings) {
        if (ring.length < 3) continue;
        const info = ringInfo(ring);
        if (info.area < minArea && !(keepSmall && keepSmall(info, kind))) { dropped++; continue; }
        const color = colorOf(ring, info, kind);
        if (!color) { dropped++; continue; }
        const pts = ring.map(world);
        faces++;
        if (pts.length === 3) { soup.tri(pts[0], pts[1], pts[2], color); continue; }
        // project on the dominant plane of the face and clip ears there (the survey's faces are planar)
        const [nx, ny, nz] = info.normal.map(Math.abs);
        const flat = ny >= nx && ny >= nz ? ring.map((p) => [p[0], p[1]]) : nx >= nz ? ring.map((p) => [p[1], p[2]]) : ring.map((p) => [p[0], p[2]]);
        for (const [i, j, k] of triangulate(flat)) soup.tri(pts[i], pts[j], pts[k], color);
      }
    }
  }
  return { faces, dropped, triangles: soup.triangleCount - t0 };
}

/** y of the survey's ground in the world: the median of (drawn ground - survey y) over the feet of the walls (the survey and the
 *  LiDAR ground of the game agree within a metre; the median ignores the few feet in a light well or on a ramp). */
export function lod2Base(buildings, ground) {
  const d = [];
  for (const b of buildings) for (const r of b.walls) for (const p of r) if (p[2] < FOOT) d.push(ground(p[0], p[1]) - p[2]);
  if (!d.length) throw new Error('LOD2: the survey has no wall feet');
  d.sort((a, c) => a - c);
  return d[d.length >> 1];
}

/** Is (x, z) under one of the roofs of the buildings (seen from above)? */
function underRoof(buildings, x, z) {
  for (const b of buildings) {
    for (const r of b.roofs) {
      let inside = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, zi] = r[i], [xj, zj] = r[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) return true;
    }
  }
  return false;
}

/** The foot edge of a vertical wall face that stands on the ground: { a, c, top } (top = its lowest head), or null. */
function footEdge(ring, isFoot) {
  const feet = ring.filter(isFoot), heads = ring.filter((p) => !isFoot(p));
  if (feet.length < 2 || !heads.length) return null;
  let best = -1, a = null, c = null;
  for (let i = 0; i < feet.length; i++) for (let j = i + 1; j < feet.length; j++) {
    const d = Math.hypot(feet[j][0] - feet[i][0], feet[j][1] - feet[i][1]);
    if (d > best) { best = d; a = feet[i]; c = feet[j]; }
  }
  if (best < 0.2) return null;
  return { a: [a[0], a[1]], c: [c[0], c[1]], top: Math.min(...heads.map((p) => p[2])) };
}

/**
 * The street walls of the survey.  The survey cuts a facade into many narrow faces (a bay, a pier that stands out 0.3 m, a step of
 * the eave): the foot edges of the vertical faces that stand on the ground are grouped into straight facades - faces in the same
 * direction (within RUN_ANGLE), on the same line (within RUN_DEV) and no more than RUN_GAP apart along it (a pier's jog) - and a
 * facade at least minLen long and minHeight high (its lowest head) is a street wall, with its frame (s along the foot, y up, `out`
 * towards the street: the side that is not under a roof; the plane is the outermost of its faces).  A facade with a roof on both sides
 * (a party wall between two parts) is left out.  base / ground as for addLod2 (a foot is a vertex on the drawn ground).
 * Returns [{ f, faces: [{ s0, s1, off, top }], top, info: { cx, cz } }]: f like edgeFrame's on the line of the longest face, each face's
 * span along it and offset out of it, tops in survey metres (over the survey's ground).
 */
export function lod2StreetWalls(buildings, { base, ground, minLen = 4, minHeight = 5, stats = null }) {
  const note = (k) => { if (stats) stats[k] = (stats[k] || 0) + 1; };
  const isFoot = (p) => p[2] < FOOT || base + p[2] < ground(p[0], p[1]) + FOOT_TOL;
  const edges = [];
  for (const b of buildings) for (const ring of b.walls) {
    if (ring.length < 3 || ringInfo(ring).slope < 85) continue;
    const e = footEdge(ring, isFoot);
    if (!e) continue;
    const len = Math.hypot(e.c[0] - e.a[0], e.c[1] - e.a[1]);
    let dx = (e.c[0] - e.a[0]) / len, dz = (e.c[1] - e.a[1]) / len;
    if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && dz < 0)) { dx = -dx; dz = -dz; }       // one direction per line, whatever the winding
    edges.push({ ...e, len, dx, dz });
  }
  // union-find over the faces of one facade
  const parent = edges.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const cosMax = Math.cos((RUN_ANGLE * Math.PI) / 180);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const along = (p) => (p[0] - e.a[0]) * e.dx + (p[1] - e.a[1]) * e.dz, off = (p) => (p[0] - e.a[0]) * -e.dz + (p[1] - e.a[1]) * e.dx;
    const [s0, s1] = [along(e.a), along(e.c)].sort((x, y) => x - y);
    for (let j = i + 1; j < edges.length; j++) {
      const o = edges[j];
      if (e.dx * o.dx + e.dz * o.dz < cosMax) continue;
      if (Math.abs(off(o.a)) > RUN_DEV || Math.abs(off(o.c)) > RUN_DEV) continue;
      const [t0, t1] = [along(o.a), along(o.c)].sort((x, y) => x - y);
      if (t0 > s1 + RUN_GAP || s0 > t1 + RUN_GAP) continue;
      parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  edges.forEach((e, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(e); });
  const out = [];
  for (const group of groups.values()) {
    const ref = group.reduce((m, e) => (e.len > m.len ? e : m));                // the longest face sets the direction
    const { dx, dz } = ref, o = ref.a;
    const along = (p) => (p[0] - o[0]) * dx + (p[1] - o[1]) * dz;
    let s0 = Infinity, s1 = -Infinity, top = -Infinity;
    for (const e of group) { for (const p of [e.a, e.c]) { s0 = Math.min(s0, along(p)); s1 = Math.max(s1, along(p)); } top = Math.max(top, e.top); }
    const len = s1 - s0;
    if (len < minLen || top < minHeight) { note(len < minLen ? 'short' : 'low'); continue; }
    let nx = -dz, nz = dx;
    const mx = o[0] + dx * (s0 + s1) / 2, mz = o[1] + dz * (s0 + s1) / 2;
    // the street side is the one not under a roof; the eaves overhang the walls, so look further out until the two sides differ
    let side = 0;
    for (const d of ROOF_PROBE) {
      const front = underRoof(buildings, mx + nx * d, mz + nz * d), back = underRoof(buildings, mx - nx * d, mz - nz * d);
      if (front !== back) { side = front ? -1 : 1; break; }
    }
    if (!side) { note('party'); continue; }                  // a party wall (roofs on both sides) or a sliver the roofs do not tell
    if (side < 0) { nx = -nx; nz = -nz; }
    note('street');
    const p0 = [o[0] + dx * s0, o[1] + dz * s0];
    // each face of the facade in the frame: its span along it, how far it stands out of the line, its lowest head
    const faces = group.map((e) => {
      const [a, c] = [along(e.a) - s0, along(e.c) - s0].sort((x, y) => x - y);
      const off = (((e.a[0] + e.c[0]) / 2 - p0[0]) * nx + ((e.a[1] + e.c[1]) / 2 - p0[1]) * nz);
      return { s0: a, s1: c, off, top: e.top };
    }).sort((x, y) => x.s0 - y.s0);
    out.push({ top, faces, info: { cx: mx, cz: mz }, f: { a: p0, b: [p0[0] + dx * len, p0[1] + dz * len], len, dx, dz, nx, nz, yaw: Math.atan2(-dz, dx), at: (s, y, w = 0) => [p0[0] + dx * s + nx * w, y, p0[1] + dz * s + nz * w] } });
  }
  return out;
}

/**
 * Windows on a street wall of the survey (lod2StreetWalls): a window every `pitch` m along it, on the face it falls on (a window never
 * spans a jog of the facade: it stands on one face, EPS_OUT in front of it), as many storeys as that face is high (at most maxRows).
 * y0: the sill of the first storey (world); base: the survey's ground in the world.  Each window is a stone surround and a dark pane.
 * Returns the number of windows.
 */
export function lod2Windows(soup, wall, { base, y0, floorH, w, h, pitch, frame, glass, maxRows = 3, key = 0, skip = null }) {
  const { f, faces } = wall;
  const n = Math.floor(f.len / pitch);
  const margin = (f.len - n * pitch) / 2;
  const half = w / 2 + 0.3;
  let count = 0;
  for (let c = 0; c < n; c++) {
    const sc = margin + (c + 0.5) * pitch;
    const face = faces.find((q) => q.s0 <= sc - half && q.s1 >= sc + half);
    if (!face) continue;
    const at = (s, y, o) => f.at(s, y, face.off + o);
    for (let r = 0; r < maxRows; r++) {
      const ya = y0 + r * floorH;
      if (ya + h + 0.6 > base + face.top) break;
      if (skip && skip(f.at(sc, ya, face.off), r)) continue;
      const k = key + r * 31 + c;
      soup.quad(at(sc - w / 2 - 0.25, ya - 0.2, EPS_OUT), at(sc + w / 2 + 0.25, ya - 0.2, EPS_OUT), at(sc + w / 2 + 0.25, ya + h + 0.25, EPS_OUT), at(sc - w / 2 - 0.25, ya + h + 0.25, EPS_OUT), paint(frame, k, 0.03));
      soup.quad(at(sc - w / 2, ya, EPS_OUT * 2), at(sc + w / 2, ya, EPS_OUT * 2), at(sc + w / 2, ya + h, EPS_OUT * 2), at(sc - w / 2, ya + h, EPS_OUT * 2), paint(glass, k, 0.06));
      count++;
    }
  }
  return count;
}

/** Collision segments along the feet of the street walls (for the parts of a survey that no OSM outline of the landmark covers). */
export function lod2FootWalls(streetWalls, r, id) {
  return streetWalls.map(({ f }) => ({ ax: f.a[0], az: f.a[1], bx: f.b[0], bz: f.b[1], r, id }));
}
