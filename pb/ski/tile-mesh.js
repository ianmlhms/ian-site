/* Builds the vertex data of one terrain tile (adapted from pb/mtb/tile-mesh.js). Pure (typed arrays only; the THREE layer wraps them).
 *
 * Tile = (cells x cells) quads, node spacing step = size / cells, positions are tile-local (x - x0, y, z - z0) so float32 stays precise.
 * Heights: LOD 0 tiles (2.5 m) read the physics surface blocks (same numbers), coarser tiles sample field.heightForStep().
 * Stitching: a boundary vertex that touches a COARSER tile takes the value of that tile's edge polyline (exactly what the coarser tile
 * renders there), corners included. A skirt hangs under every boundary vertex.
 * Per vertex: aInfo = (piste 0..1, forest 0..1, rock 0..1, water - built). */
import { QUADTREE, LATTICE } from './config.js';
import { diagonalIsMain, ATTR } from './surface.js';
import { tilesTouching, leafAt } from './quadtree.js';

const EDGE_EPS = 1e-6;
const EPS_PROBE = 1e-3;                 // same offset as quadtree.js tilesTouching
const CELLS = QUADTREE.cells;
const SIDE = CELLS + 1;
const APRON_SIDE = CELLS + 3;

/** Node data of a tile (cached by the caller): apron heights (for the normals) and the attributes. */
export function computeTileNodes(leaf, surface, field) {
  const { x0, z0, step } = leaf;
  if (Math.abs(step - LATTICE) < 1e-9) {
    const b = surface.block(Math.round(x0 / QUADTREE.minSize), Math.round(z0 / QUADTREE.minSize));       // same lattice as the physics
    return { h: b.h, info: b.info, shared: true };
  }
  const h = new Float32Array(APRON_SIDE * APRON_SIDE);
  const info = new Float32Array(APRON_SIDE * APRON_SIDE * ATTR);
  const a = { piste: 0, forest: 0, rock: 0, built: 0, diff: 0, water: 0 };
  for (let j = 0; j < APRON_SIDE; j++) {
    for (let i = 0; i < APRON_SIDE; i++) {
      const n = j * APRON_SIDE + i, x = x0 + (i - 1) * step, z = z0 + (j - 1) * step;
      field.attrs(x, z, a, step);
      h[n] = field.heightForStep(x, z, step, a);
      info[n * ATTR] = a.piste; info[n * ATTR + 1] = a.forest; info[n * ATTR + 2] = a.rock; info[n * ATTR + 3] = a.water - a.built;
    }
  }
  return { h, info, shared: false };
}

/** Value of the coarser tile T's edge polyline at the boundary point (x, z) (T's spacing grid is aligned to multiples of its step). */
function polylineValue(T, x, z, field) {
  const ns = T.step;
  const onX = Math.abs(x - T.x0) < EDGE_EPS || Math.abs(x - (T.x0 + T.size)) < EDGE_EPS;
  const onZ = Math.abs(z - T.z0) < EDGE_EPS || Math.abs(z - (T.z0 + T.size)) < EDGE_EPS;
  if (onX && onZ) return field.heightForStep(x, z, ns);
  if (onX) {
    const za = Math.floor(z / ns + EDGE_EPS) * ns;
    const t = (z - za) / ns;
    if (t < EDGE_EPS) return field.heightForStep(x, za, ns);
    return field.heightForStep(x, za, ns) * (1 - t) + field.heightForStep(x, za + ns, ns) * t;
  }
  if (onZ) {
    const xa = Math.floor(x / ns + EDGE_EPS) * ns;
    const t = (x - xa) / ns;
    if (t < EDGE_EPS) return field.heightForStep(xa, z, ns);
    return field.heightForStep(xa, z, ns) * (1 - t) + field.heightForStep(xa + ns, z, ns) * t;
  }
  return field.heightForStep(x, z, ns);          // cannot happen for a partition; harmless fallback
}

/** The boundary vertices of a leaf that touch a coarser tile: [{ v, x, z, tile }] (v = vertex index in the grid).
 *  An edge vertex that is not a corner touches only the leaf itself and the one tile across that edge (a coarser neighbour spans the whole edge), so the
 *  four edges are probed once each and only the four corners need the full 4-way lookup (this scan runs for every leaf next to a changed node). */
export function stitchesOf(leaf, split) {
  const { x0, z0, step, size } = leaf;
  const out = [];
  const coarser = (T) => (T && T.step > step ? T : null);
  const half = size / 2;
  const west = coarser(leafAt(split, x0 - EPS_PROBE, z0 + half)), east = coarser(leafAt(split, x0 + size + EPS_PROBE, z0 + half));
  const north = coarser(leafAt(split, x0 + half, z0 - EPS_PROBE)), south = coarser(leafAt(split, x0 + half, z0 + size + EPS_PROBE));
  for (let j = 0; j <= CELLS; j++) {
    for (let i = 0; i <= CELLS; i++) {
      if (!(i === 0 || j === 0 || i === CELLS || j === CELLS)) { i = CELLS - 1; continue; }
      const wx = x0 + i * step, wz = z0 + j * step;
      let coarse = null;
      const cornerI = i === 0 || i === CELLS, cornerJ = j === 0 || j === CELLS;
      if (cornerI && cornerJ) {
        for (const T of tilesTouching(split, wx, wz)) if (T.step > step && (!coarse || T.step > coarse.step)) coarse = T;
      } else coarse = j === 0 ? north : j === CELLS ? south : i === 0 ? west : east;
      if (coarse) out.push({ v: j * SIDE + i, x: wx, z: wz, tile: coarse });
    }
  }
  return out;
}

const gdir = { x: 1, z: 0 };
const AO_RINGS = Object.freeze([[10, 0.5, 6], [34, 0.32, 4], [95, 0.18, 4]]);    // [radius m, weight, directions]     // [radius m, weight]: gullies, hollows, valleys
/** -1 (sharp ridge) .. 1 (deep hollow): how far the ground around rises above this point on average, by ring (the curvature: a plane
 *  gives 0 whatever its slope). A cheap ambient occlusion of the terrain in the vertex data; rings finer than the tile spacing are
 *  skipped, so far tiles only darken the big hollows. */
function occlusion(field, x, z, y, step) {
  let ao = 0;
  for (let r = 0; r < AO_RINGS.length; r++) {
    const [rad, w, dirs] = AO_RINGS[r];
    if (rad < step * 0.9) continue;
    let rise = 0;
    const turn = r * 0.7;
    for (let d = 0; d < dirs; d++) {
      const a = turn + d / dirs * Math.PI * 2;
      const hx = field.baseHeight(x + Math.cos(a) * rad, z + Math.sin(a) * rad) - y;
      rise += hx / rad;                            // tangent of the rise (signed: the downhill side cancels the uphill one)
    }
    ao += w * Math.max(-1, Math.min(1, (rise / dirs) * 4));
  }
  return ao;
}

/** A string that changes exactly when the stitched geometry of the leaf would change. */
export function stitchSignature(leaf, split) {
  return stitchesOf(leaf, split).map((s) => `${s.v}@${s.tile.key}`).join('|');
}

/**
 * Returns { positions, normals, info, indices, vertexCount, signature, ... } (tile-local positions).
 */
export function buildTileMesh(leaf, nodes, split, field) {
  const { x0, z0, step, size } = leaf;
  const h = nodes.h, src = nodes.info;
  const vertexCount = SIDE * SIDE;
  const skirtVerts = 4 * SIDE;
  const positions = new Float32Array((vertexCount + skirtVerts) * 3);
  const normals = new Float32Array((vertexCount + skirtVerts) * 3);
  const info = new Float32Array((vertexCount + skirtVerts) * ATTR);
  const extra = new Float32Array((vertexCount + skirtVerts) * 4);      // (groom direction x, z, ambient occlusion, 0)
  const skirtDepth = QUADTREE.skirtDepth + QUADTREE.skirtPerStep * step;
  const stitchAt = new Map();
  for (const st of stitchesOf(leaf, split)) stitchAt.set(st.v, st);

  for (let j = 0; j <= CELLS; j++) {
    for (let i = 0; i <= CELLS; i++) {
      const v = j * SIDE + i;
      const a = (j + 1) * APRON_SIDE + (i + 1);
      let y = h[a];
      const st = stitchAt.get(v);
      if (st) y = polylineValue(st.tile, st.x, st.z, field);
      positions[v * 3] = i * step; positions[v * 3 + 1] = y; positions[v * 3 + 2] = j * step;
      const dhdx = (h[a + 1] - h[a - 1]) / (2 * step);
      const dhdz = (h[a + APRON_SIDE] - h[a - APRON_SIDE]) / (2 * step);
      const inv = 1 / Math.hypot(dhdx, 1, dhdz);
      normals[v * 3] = -dhdx * inv; normals[v * 3 + 1] = inv; normals[v * 3 + 2] = -dhdz * inv;
      for (let k = 0; k < ATTR; k++) info[v * ATTR + k] = src[a * ATTR + k];
      const wx = x0 + i * step, wz = z0 + j * step;
      if (src[a * ATTR] > 0.01 && field.groomDir) { field.groomDir(wx, wz, gdir); extra[v * 4] = gdir.x; extra[v * 4 + 1] = gdir.z; } else { extra[v * 4] = 1; extra[v * 4 + 1] = 0; }
      if (!(i & 1) && !(j & 1)) extra[v * 4 + 2] = occlusion(field, wx, wz, y, step);       // every second node; the rest is interpolated below
    }
  }
  for (let j = 0; j <= CELLS; j++) {
    for (let i = 0; i <= CELLS; i++) {
      if (!(i & 1) && !(j & 1)) continue;
      const i0 = i & ~1, j0 = j & ~1, i1 = i & 1 ? i0 + 2 : i0, j1 = j & 1 ? j0 + 2 : j0;
      extra[(j * SIDE + i) * 4 + 2] = 0.25 * (extra[(j0 * SIDE + i0) * 4 + 2] + extra[(j0 * SIDE + i1) * 4 + 2] + extra[(j1 * SIDE + i0) * 4 + 2] + extra[(j1 * SIDE + i1) * 4 + 2]);
    }
  }
  // skirts: duplicate every boundary vertex lower down (order: north row, south row, west column, east column)
  let sv = vertexCount;
  const skirtOf = new Int32Array(vertexCount).fill(-1);
  const addSkirt = (v) => {
    positions[sv * 3] = positions[v * 3]; positions[sv * 3 + 1] = positions[v * 3 + 1] - skirtDepth; positions[sv * 3 + 2] = positions[v * 3 + 2];
    normals[sv * 3] = normals[v * 3]; normals[sv * 3 + 1] = normals[v * 3 + 1]; normals[sv * 3 + 2] = normals[v * 3 + 2];
    for (let k = 0; k < ATTR; k++) info[sv * ATTR + k] = info[v * ATTR + k];
    for (let k = 0; k < 4; k++) extra[sv * 4 + k] = extra[v * 4 + k];
    skirtOf[v] = sv++;
  };
  for (let i = 0; i <= CELLS; i++) addSkirt(i);
  for (let i = 0; i <= CELLS; i++) addSkirt(CELLS * SIDE + i);
  for (let j = 1; j < CELLS; j++) addSkirt(j * SIDE);
  for (let j = 1; j < CELLS; j++) addSkirt(j * SIDE + CELLS);

  const quadCount = CELLS * CELLS;
  const edgeQuads = 4 * CELLS;
  const indices = new Uint16Array((quadCount * 2 + edgeQuads * 4) * 3);
  let n = 0;
  const gi0 = Math.round(x0 / step), gj0 = Math.round(z0 / step);
  for (let j = 0; j < CELLS; j++) {
    for (let i = 0; i < CELLS; i++) {
      const a = j * SIDE + i, b = a + 1, cc = a + SIDE, d = cc + 1;
      // counter-clockwise seen from above (+y): with x east and z south that is a -> cc -> b
      if (diagonalIsMain(gi0 + i, gj0 + j)) { indices[n++] = a; indices[n++] = cc; indices[n++] = d; indices[n++] = a; indices[n++] = d; indices[n++] = b; }
      else { indices[n++] = a; indices[n++] = cc; indices[n++] = b; indices[n++] = b; indices[n++] = cc; indices[n++] = d; }
    }
  }
  const wall = (v0, v1) => {            // skirt quad between two boundary vertices; both windings are emitted so it shows from either side
    const s0 = skirtOf[v0], s1 = skirtOf[v1];
    indices[n++] = v0; indices[n++] = s0; indices[n++] = v1; indices[n++] = v1; indices[n++] = s0; indices[n++] = s1;
    indices[n++] = v0; indices[n++] = v1; indices[n++] = s0; indices[n++] = v1; indices[n++] = s1; indices[n++] = s0;
  };
  for (let i = 0; i < CELLS; i++) wall(i, i + 1);                                           // north edge
  for (let i = 0; i < CELLS; i++) wall(CELLS * SIDE + i + 1, CELLS * SIDE + i);             // south edge
  for (let j = 0; j < CELLS; j++) wall((j + 1) * SIDE, j * SIDE);                           // west edge
  for (let j = 0; j < CELLS; j++) wall(j * SIDE + CELLS, (j + 1) * SIDE + CELLS);           // east edge
  return { positions, normals, info, extra, indices: indices.subarray(0, n), vertexCount: vertexCount + skirtVerts, gridVertexCount: vertexCount, signature: [...stitchAt.values()].map((st) => `${st.v}@${st.tile.key}`).join('|'), size, x0, z0, step };
}

/** Exact height of the built mesh (grid triangles only, no skirts) at a world point inside the tile, by vertical ray vs triangle. */
export function meshHeightAt(mesh, x, z) {
  const lx = x - mesh.x0, lz = z - mesh.z0;
  const p = mesh.positions;
  const i = Math.min(CELLS - 1, Math.max(0, Math.floor(lx / mesh.step)));
  const j = Math.min(CELLS - 1, Math.max(0, Math.floor(lz / mesh.step)));
  const a = j * SIDE + i, b = a + 1, cc = a + SIDE, d = cc + 1;
  const fx = lx / mesh.step - i, fz = lz / mesh.step - j;
  const gi = Math.round(mesh.x0 / mesh.step) + i, gj = Math.round(mesh.z0 / mesh.step) + j;
  const ya = p[a * 3 + 1], yb = p[b * 3 + 1], yc = p[cc * 3 + 1], yd = p[d * 3 + 1];
  if (diagonalIsMain(gi, gj)) return fx >= fz ? ya + (yb - ya) * fx + (yd - yb) * fz : ya + (yd - yc) * fx + (yc - ya) * fz;
  return fx + fz <= 1 ? ya + (yb - ya) * fx + (yc - ya) * fz : yd + (yc - yd) * (1 - fx) + (yb - yd) * (1 - fz);
}
