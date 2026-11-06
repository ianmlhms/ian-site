/* The buildings of Lux Drive as a mesh: the LOD2 footprints of the bake become walls and a roof.
 *
 * A building is not a box: the walls follow the footprint of the house and the roof follows the direction of the
 * ridge that the bake measured.  The bottom of the walls stands on the land under every corner of the footprint, so a
 * building never floats on a slope and never hangs over one; the top of the walls is flat, so the roof is a roof and
 * not a warped blanket.
 *
 * The painted surface info travels with every vertex, exactly like the MTB town: aInfo = (u metres along the surface,
 * v metres up it, kind, seed), aGeo = (the length of the wall, the height of the eave).  The material draws the
 * windows and the roof tiles from those numbers, so no picture files are needed and the windows follow a slope.
 *
 * Pure (no THREE), so the browser and the Node harness build exactly the same shapes. */

import {
  STYLE, STYLE_SHOP, PALETTE, WALLS, BLOCKS, CITY_WALLS, SANDSTONE_WALLS, VILLAGE_WALLS, SLATE, DARK_SLATE, TILE, DARK_TILE,
  OFFICE, MODERN, INDUSTRIAL, LIMESTONE, TAR,
} from './building-style.js';

/** The kinds of surface, the same numbers as the MTB town material. */
export const KIND = Object.freeze({ wall: 0, roof: 1, stone: 2, flat: 3 });


export { STYLE, STYLE_SHOP };

export const CELL = 256;            // m, the cell of the building mesh (one draw call per cell)

/** The bottom of a wall follows the ground along the whole edge of the footprint: a wall that only touches
 *  the ground at its two corners hangs over a slope in the middle and is eaten by the hill on the other side.
 *  The points are taken every EDGE_STEP metres and only kept where the ground leaves the line between the
 *  corners by more than EDGE_TOL, so a house on flat ground keeps its four corners and a house on a slope
 *  gets the points it needs and no more. */
const EDGE_STEP = 1.0;      // m, the spacing of the points along one edge of the footprint
const EDGE_TOL = 0.15;      // m, how far the ground may leave the line between two corners before a point is kept
const MIN_WALL = 0.3;       // m, the shortest wall a house may keep where the ground climbs over its eaves
const LEVEL_OVER_LOW = 1.4; // m: the storeys of a house on a slope start at most this far above the lowest point of its foot (look11, the level façade bands)

/** A stable number out of the id of a building: the same building always looks the same. */
function hash01(n) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The wall colours of a building: the palette of its place for the town and house façades, the fixed colour of the others. */
function wallBase(style, seed, palette) {
  if (style === STYLE.office) return OFFICE;
  if (style === STYLE.modern) return MODERN;
  if (style === STYLE.industrial) return INDUSTRIAL;
  if (style === STYLE.stone) return LIMESTONE;
  let list;
  if (palette === PALETTE.sandstone) list = SANDSTONE_WALLS;
  else if (palette === PALETTE.city) list = CITY_WALLS;
  else if (palette === PALETTE.village) list = VILLAGE_WALLS;
  else list = style === STYLE.apartment ? BLOCKS : WALLS;
  return list[Math.floor(seed * list.length) % list.length];
}

/** The colour of the walls of a building: the palette of its style and place, varied a little so that a street is not one colour. */
function wallColour(style, seed, palette) {
  const base = wallBase(style, seed, palette);
  const k = 0.92 + 0.16 * hash01(Math.floor(seed * 1000) + 7);
  return [base[0] * k, base[1] * k, base[2] * k];
}

/** The colour of the roof of a building: slate, tile or tar.  The stone city has dark slate (mansards), a village mostly tile. */
function roofColour(style, roof, seed, palette) {
  if (roof !== 1) return TAR;
  if (style === STYLE.industrial) return [0.42, 0.43, 0.44];
  if (palette === PALETTE.sandstone || (palette === PALETTE.city && style === STYLE.town)) return DARK_SLATE;
  if (palette === PALETTE.city) return seed > 0.8 ? TILE : SLATE;
  if (palette === PALETTE.village) return seed > 0.62 ? DARK_TILE : (seed > 0.3 ? TILE : SLATE);
  return seed > 0.62 ? TILE : SLATE;
}

/** The mesh of the buildings: the arrays the view turns into a buffer geometry. */
export function createBuildingMesh() {
  return { pos: [], nor: [], col: [], info: [], geo: [], sty: [], idx: [] };
}

/**
 * One face: the points, the normal from the winding, the colour and the painted surface info.
 * The uv of every point is [u along the surface, v up it].
 */
function face(m, points, colour, kind, seed, uvs, wallLen, eave, sty) {
  const [a, b, c] = points;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  const base = m.pos.length / 3;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    m.pos.push(p[0], p[1], p[2]);
    m.nor.push(nx, ny, nz);
    m.col.push(colour[0], colour[1], colour[2]);
    m.info.push(uvs[i][0], uvs[i][1], kind, seed);
    m.geo.push(wallLen, eave);
    m.sty.push(sty[0], sty[1]);
  }
  m.idx.push(base, base + 1, base + 2);
  if (points.length === 4) m.idx.push(base, base + 2, base + 3);
}

/** A face whose normal must point up: the winding is flipped when it points down. */
function faceUp(m, points, colour, kind, seed, uvs, wallLen, eave, sty) {
  const [a, b, c] = points;
  const ux = b[0] - a[0], uz = b[2] - a[2];
  const vx = c[0] - a[0], vz = c[2] - a[2];
  const ny = uz * vx - ux * vz;
  if (ny >= 0) face(m, points, colour, kind, seed, uvs, wallLen, eave, sty);
  else {
    const rev = [points[0], points[2], points[1]];
    const uvsRev = [uvs[0], uvs[2], uvs[1]];
    if (points.length === 4) { rev.push(points[3]); uvsRev.push(uvs[3]); }
    face(m, rev, colour, kind, seed, uvsRev, wallLen, eave, sty);
  }
}

/**
 * The bottom of one wall: the points where the ground leaves the line between the two corners of the edge.
 * The height of every point is the ground as the game draws it, but never above the eaves: a wall that the
 * hill climbs over would be drawn upside down.
 */
function wallBottom(ax, az, bx, bz, ay, by, eaveY, heightAt) {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.round(len / EDGE_STEP));
  const keep = [[ax, ay, az]];
  if (steps > 1) {
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const h = heightAt(x, z);
      const line = ay + (by - ay) * t;
      if (Math.abs(h - line) > EDGE_TOL) keep.push([x, h, z]);
    }
  }
  keep.push([bx, by, bz]);
  const limit = eaveY - MIN_WALL;
  for (const p of keep) if (p[1] > limit) p[1] = limit;
  return keep;
}

/**
 * Adds one building to the mesh.
 * b: the decoded LOD2 building { id, roof, style, levels, eave, ridge, ridgeDir, pts }.
 * heightAt(x, z): the height of the ground as the game draws it (the land with the roads carved into it).
 * landAt(x, z): the height of the land itself (the DTM): the top of the walls is the height of the eaves above it.
 * drop: how far the walls go down below the ground (m).  The cells far from the car stand on COARSE terrain tiles (up to 16 m
 *   spacing) that differ from the exact ground by a metre or two on a slope: a wall that ends at the exact ground would show a gap
 *   under it or a ledge.  The part below the ground is never seen; the window rows keep their origin at the lowest point of the foot (v < 0 below it).
 */
export function addBuilding(m, b, heightAt, landAt, drop = 0) {
  const pts = b.pts;
  const n = pts.length / 2;
  if (n < 3) return;
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += pts[i * 2]; cz += pts[i * 2 + 1]; }
  cx /= n; cz /= n;
  // The eaves stand on the ground the player sees, not on the bare land: a house beside a road that runs on
  // an embankment must not sink into it.  The ground is the land with the roads carved into it, so the higher
  // of the two is the ground here.
  const groundY = Math.max(landAt(cx, cz), heightAt(cx, cz));
  const eaveY = groundY + b.eave;
  const ridgeY = groundY + b.ridge;
  const seed = hash01(b.id);
  // the style byte carries the kind of façade and the bit "there is a shop on the ground floor"
  const style = (b.style | 0) & 7;
  const sty = [b.style | 0, Math.max(1, b.levels | 0)];
  const wall = wallColour(style, seed, b.palette);
  const roof = roofColour(style, b.roof, seed, b.palette);

  // the walls: every edge of the footprint, from the land under it up to the flat eave
  const edges = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.25) { edges.push({ len, skip: true }); continue; }
    edges.push({ ax, az, bx, bz, len, bottom: wallBottom(ax, az, bx, bz, heightAt(ax, az), heightAt(bx, bz), eaveY, heightAt) });
  }
  // The storeys are LEVEL: v (the height on the façade the material lays the floors, windows and the plinth on) is measured from one level for the whole
  // house, the lowest point of its foot, not from the ground under every vertex.  Measured from the ground, every band of the façade followed the slope and
  // bent at every point of the foot (and at the diagonal of every quad), and every stretch of wall had its own floor height: the bands waved (QA BL02).
  // The level is the highest point of the foot, but at most LEVEL_OVER_LOW over its lowest: on a slope the downhill wall stands on a stone base (a basement) up to
  // that much higher, and only on a steeper slope than that does the uphill wall stand in the hill below its first windows.  (From the lowest point the shop fronts
  // of a long house on a sloping street were buried at its upper end.)
  let low = Infinity, high = -Infinity;
  for (const e of edges) if (!e.skip) for (const p of e.bottom) { low = Math.min(low, p[1]); high = Math.max(high, p[1]); }
  const ref = Math.min(high, low + LEVEL_OVER_LOW);
  const facadeH = eaveY - ref;
  let along = 0;
  for (const e of edges) {
    if (e.skip) continue;
    const { ax, az, bx, bz, len, bottom } = e;
    // the wall is seen from outside: the normal of the edge (ex, ez) is (-ez, ex) when the edge turns to the left
    const ex = (bx - ax) / len, ez = (bz - az) / len;
    const mx = (ax + bx) / 2 - cx, mz = (az + bz) / 2 - cz;
    const outward = (ex * mz - ez * mx) > 0;
    let u = along;
    for (let k = 0; k + 1 < bottom.length; k++) {
      const p0 = bottom[k], p1 = bottom[k + 1];
      const segLen = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
      if (segLen < 0.05) continue;
      const a = [p0[0], p0[1] - drop, p0[2]], b2 = [p1[0], p1[1] - drop, p1[2]];
      const c = [p1[0], eaveY, p1[2]], d = [p0[0], eaveY, p0[2]];
      const uvs = outward
        ? [[u, a[1] - ref], [u + segLen, b2[1] - ref], [u + segLen, facadeH], [u, facadeH]]
        : [[u + segLen, facadeH], [u, facadeH], [u, b2[1] - ref], [u + segLen, a[1] - ref]];
      const pts4 = outward ? [a, b2, c, d] : [d, c, b2, a];
      face(m, pts4, wall, KIND.wall, seed, uvs, segLen, facadeH, sty);
      u += segLen;
    }
    along += len;
  }

  if (b.roof === 1 && ridgeY > eaveY + 0.2) {
    // A hip roof along the direction of the bake.  The ridge is a line through the middle of the footprint, as long as
    // the footprint reaches along that direction.  Every corner of the eave is joined to the point of the ridge above
    // it, so the roof is always closed and never spikes: the roof of a rectangle is a hip, the roof of an L is a tent.
    const dirX = Math.cos(b.ridgeDir), dirZ = Math.sin(b.ridgeDir);
    const perX = -dirZ, perZ = dirX;                    // the direction across the ridge
    const c0 = cx * dirX + cz * dirZ;
    const p0 = cx * perX + cz * perZ;
    let lo = Infinity, hi = -Infinity, sLo = Infinity, sHi = -Infinity;
    for (let i = 0; i < n; i++) {
      const t = pts[i * 2] * dirX + pts[i * 2 + 1] * dirZ - c0;
      const s = pts[i * 2] * perX + pts[i * 2 + 1] * perZ - p0;
      if (t < lo) lo = t; if (t > hi) hi = t;
      if (s < sLo) sLo = s; if (s > sHi) sHi = s;
    }
    // The ridge is shorter than the building by the width of the building: that is what makes the hips slope
    // instead of standing up like a wall.  A building that is as wide as it is long gets a point instead of a ridge.
    const half = Math.max(0, (hi - lo) / 2 - (sHi - sLo) / 2);
    const mid = (lo + hi) / 2;
    const rx = cx + dirX * mid, rz = cz + dirZ * mid;         // the middle of the ridge
    const rise = ridgeY - eaveY;
    // the point of the ridge above every corner of the eave
    const above = [];
    for (let i = 0; i < n; i++) {
      const px = pts[i * 2], pz = pts[i * 2 + 1];
      let t = (px - rx) * dirX + (pz - rz) * dirZ;
      t = Math.max(-half, Math.min(half, t));
      const qx = rx + dirX * t, qz = rz + dirZ * t;
      above.push({ x: qx, z: qz, up: Math.hypot(qx - px, qz - pz, rise) });
    }
    let eaveAlong = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.25) continue;
      const ta = above[i], tb = above[j];
      const a = [ax, eaveY, az], b2 = [bx, eaveY, bz];
      const ra = [ta.x, ridgeY, ta.z], rb = [tb.x, ridgeY, tb.z];
      const uvs = [[eaveAlong, 0], [eaveAlong + len, 0], [eaveAlong + len, tb.up], [eaveAlong, ta.up]];
      if (Math.hypot(rb[0] - ra[0], rb[2] - ra[2]) < 0.05) {
        faceUp(m, [a, b2, rb], roof, KIND.roof, seed, [[eaveAlong, 0], [eaveAlong + len, 0], [eaveAlong + len, tb.up]], len, tb.up, sty);
      } else {
        faceUp(m, [a, b2, rb, ra], roof, KIND.roof, seed, uvs, len, (ta.up + tb.up) / 2, sty);
      }
      eaveAlong += len;
    }
  } else {
    // a flat roof: the cap of the walls, fanned from the middle of the footprint
    let eaveAlong = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.25) continue;
      faceUp(m, [[cx, eaveY, cz], [ax, eaveY, az], [bx, eaveY, bz]], roof, KIND.flat, seed,
        [[0, 0], [eaveAlong, 0], [eaveAlong + len, 0]], len, 0, sty);
      eaveAlong += len;
    }
  }
}

/**
 * Groups the buildings of the world into the cells of the view: the key of a cell, the ids of its buildings and the
 * middle of the cell.  Cheap: no geometry yet, so the view can decide what it needs before it builds anything.
 */
export function groupByCell(buildings) {
  const cells = new Map();
  for (const b of buildings) {
    const pts = b.pts;
    const n = pts.length / 2;
    if (n < 3) continue;
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += pts[i * 2]; cz += pts[i * 2 + 1]; }
    cx /= n; cz /= n;
    const key = `${Math.floor(cx / CELL)},${Math.floor(cz / CELL)}`;
    let cell = cells.get(key);
    if (!cell) { cell = { ids: [], centre: [0, 0] }; cells.set(key, cell); }
    cell.ids.push(b.id);
    cell.centre[0] += cx; cell.centre[1] += cz;
  }
  for (const cell of cells.values()) {
    cell.centre[0] /= cell.ids.length; cell.centre[1] /= cell.ids.length;
  }
  return cells;
}

/**
 * The mesh of the buildings of one cell.
 * ids: the ids of the buildings of the cell.
 * buildings: the decoded LOD2 buildings.
 * heightAt(x, z): the height of the ground as the game draws it.
 * landAt(x, z): the height of the land itself.
 */
export function buildCellMesh(ids, buildings, heightAt, landAt, drop = 0) {
  const m = createBuildingMesh();
  for (const id of ids) {
    const b = buildings[id];
    if (b) addBuilding(m, b, heightAt, landAt, drop);
  }
  return { pos: m.pos, nor: m.nor, col: m.col, info: m.info, geo: m.geo, sty: m.sty, idx: m.idx };
}
