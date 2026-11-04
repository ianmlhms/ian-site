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

/** The kinds of surface, the same numbers as the MTB town material. */
export const KIND = Object.freeze({ wall: 0, roof: 1, stone: 2, flat: 3 });

/**
 * The style of a building: what its façade is made of.  The bake reads it from the OSM (the function of the
 * building) and from its height: a house has shutters and small windows, an office has glass bands and no
 * shutters, a shed has nothing but a metal wall.
 */
export const STYLE = Object.freeze({ house: 0, apartment: 1, office: 2, industrial: 3, modern: 4, stone: 5 });
export const STYLE_SHOP = 8;              // a bit of the style byte: the ground floor is a shop

export const CELL = 256;            // m, the cell of the building mesh (one draw call per cell)

/** The walls of the houses: cream, ochre, white, pink, pale green, blue grey, beige. */
const WALLS = [
  [0.93, 0.90, 0.80], [0.88, 0.80, 0.62], [0.95, 0.95, 0.92], [0.86, 0.74, 0.64],
  [0.82, 0.86, 0.80], [0.80, 0.82, 0.84], [0.90, 0.84, 0.70],
];
/** The walls of the blocks of flats: the same render, but plainer and greyer than the houses. */
const BLOCKS = [
  [0.86, 0.85, 0.80], [0.84, 0.79, 0.70], [0.88, 0.87, 0.84], [0.78, 0.78, 0.76],
  [0.83, 0.80, 0.73], [0.80, 0.82, 0.81],
];
const SLATE = [0.24, 0.27, 0.33];         // the roof of a house
const TILE = [0.58, 0.28, 0.20];          // the roof of a house, the red one
const OFFICE = [0.72, 0.76, 0.80];        // the glass towers of Kirchberg
const MODERN = [0.80, 0.82, 0.84];        // the pale stone of a modern façade
const INDUSTRIAL = [0.70, 0.70, 0.68];    // the sheds of the industrial belt
const LIMESTONE = [0.84, 0.79, 0.68];     // the dressed stone of the churches
const TAR = [0.22, 0.22, 0.24];           // the flat roof

/** A stable number out of the id of a building: the same building always looks the same. */
function hash01(n) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The colour of the walls of a building: the palette of its style, varied a little so that a street is not one colour. */
function wallColour(style, seed) {
  let base;
  if (style === STYLE.office) base = OFFICE;
  else if (style === STYLE.modern) base = MODERN;
  else if (style === STYLE.industrial) base = INDUSTRIAL;
  else if (style === STYLE.stone) base = LIMESTONE;
  else if (style === STYLE.apartment) base = BLOCKS[Math.floor(seed * BLOCKS.length) % BLOCKS.length];
  else base = WALLS[Math.floor(seed * WALLS.length) % WALLS.length];
  const k = 0.92 + 0.16 * hash01(Math.floor(seed * 1000) + 7);
  return [base[0] * k, base[1] * k, base[2] * k];
}

/** The colour of the roof of a building: slate, tile or tar. */
function roofColour(style, roof, seed) {
  if (roof !== 1) return TAR;
  if (style === STYLE.industrial) return [0.42, 0.43, 0.44];
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
 * Adds one building to the mesh.
 * b: the decoded LOD2 building { id, roof, style, levels, eave, ridge, ridgeDir, pts }.
 * heightAt(x, z): the height of the ground as the game draws it (the land with the roads carved into it).
 * landAt(x, z): the height of the land itself (the DTM): the top of the walls is the height of the eaves above it.
 */
export function addBuilding(m, b, heightAt, landAt) {
  const pts = b.pts;
  const n = pts.length / 2;
  if (n < 3) return;
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += pts[i * 2]; cz += pts[i * 2 + 1]; }
  cx /= n; cz /= n;
  const eaveY = landAt(cx, cz) + b.eave;
  const ridgeY = landAt(cx, cz) + b.ridge;
  const seed = hash01(b.id);
  // the style byte carries the kind of façade and the bit "there is a shop on the ground floor"
  const style = (b.style | 0) & 7;
  const sty = [b.style | 0, Math.max(1, b.levels | 0)];
  const wall = wallColour(style, seed);
  const roof = roofColour(style, b.roof, seed);

  // the walls: every edge of the footprint, from the land under its corners up to the flat eave
  let along = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.25) continue;
    const ay = heightAt(ax, az), by = heightAt(bx, bz);
    // the wall is seen from outside: the normal of the edge (ex, ez) is (-ez, ex) when the edge turns to the left
    const ex = (bx - ax) / len, ez = (bz - az) / len;
    const mx = (ax + bx) / 2 - cx, mz = (az + bz) / 2 - cz;
    const outward = (ex * mz - ez * mx) > 0;
    const wallH = eaveY - (ay + by) / 2;
    const a = [ax, ay, az], b2 = [bx, by, bz], c = [bx, eaveY, bz], d = [ax, eaveY, az];
    const uvs = outward
      ? [[along, 0], [along + len, 0], [along + len, eaveY - by], [along, eaveY - ay]]
      : [[along + len, 0], [along, 0], [along, eaveY - ay], [along + len, eaveY - by]];
    const pts4 = outward ? [a, b2, c, d] : [d, c, b2, a];
    face(m, pts4, wall, KIND.wall, seed, uvs, len, wallH, sty);
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
export function buildCellMesh(ids, buildings, heightAt, landAt) {
  const m = createBuildingMesh();
  for (const id of ids) {
    const b = buildings[id];
    if (b) addBuilding(m, b, heightAt, landAt);
  }
  return { pos: m.pos, nor: m.nor, col: m.col, info: m.info, geo: m.geo, sty: m.sty, idx: m.idx };
}
