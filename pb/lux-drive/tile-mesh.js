/* Builds the vertex data of one terrain tile. Pure (typed arrays only; the THREE layer wraps them), so the harness checks the very arrays
 * that are uploaded to the GPU.
 *
 * Tile = (cells x cells) quads, node spacing step = size / cells, positions are tile-local (x - x0, y, z - z0) so float32 stays precise.
 * Heights come from the lattice: LOD 0 tiles read the physics surface blocks (same numbers), coarser tiles sample heightForStep().
 * Stitching: a boundary vertex that touches a COARSER tile takes the value of that tile's edge polyline (exactly what the coarser tile
 * renders there), corners included. A skirt hangs under every boundary vertex.
 *
 * Every node also carries the road it lies on, so the shader can paint the tarmac, the kerb, the pavement and the lane markings:
 *   aRoad  (lat, hw, a0, s)   the offset from the centre line, the half width of the carriageway, the outer edge of the
 *                             pavement, the distance along the centre line (the dashes of the lane markings)
 *   aRoad3 (sdCar, sdPave, paint, sdMajor)  the signed distance to the UNION of the carriageways and of the pavements (negative =
 *                             inside) and the fade of the paint: the edges of the paint are the zero of these
 *   aRoad2 (coverage, lines, surface, mark)  how much road there is, the style of the markings, the material, and how
 *                             exactly the fine markings are drawn (a 4 m lattice cannot resolve a 15 cm line) */
import { QUADTREE, ROAD } from './config.js';
import { diagonalIsMain } from './surface.js';
import { tilesTouching, leafAt } from './quadtree.js';
import { fadeOf } from './heightfield.js';
import { MARK, trackPoint, pieceSpans } from './markings.js';
import { CHANNELS } from './road-network.js';

const EDGE_EPS = 1e-6;
const EPS_PROBE = 1e-3;                 // same offset as quadtree.js tilesTouching
const CELLS = QUADTREE.cells;
const SIDE = CELLS + 1;
const APRON_SIDE = CELLS + 3;

/**
 * The signed distances of the paint (sdCar, sdPave) are the minimum over many ways: the minimum of two cones or planes has a crease, and the zero contour of a piecewise-linear field on a
 * 1 m lattice turns a crease into a sawtooth of 1 m triangles (the ragged pavement where a slip road meets the avenue).  A [1 2 1] x [1 2 1] / 16 blur of the node values rounds the creases
 * (a straight edge is a linear field and does not move).  The apron of one node around the tile is what the blur reads: the nodes of the apron itself keep their value.
 */
export function blurField(src) {
  const out = Float32Array.from(src);
  const W = [1, 2, 1];
  for (let j = 1; j < APRON_SIDE - 1; j++) {
    for (let i = 1; i < APRON_SIDE - 1; i++) {
      let sum = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) sum += W[dj + 1] * W[di + 1] * src[(j + dj) * APRON_SIDE + (i + di)];
      out[j * APRON_SIDE + i] = sum / 16;
    }
  }
  return out;
}

const MARK_ON_ROAD = 0.3;               // m: a node counts as being on a carriageway (for the markings) when its signed distance to the union of the carriageways is below this
const MARK_NEAR_ROAD = 1.0;             // m: ... and a node this close to one takes its markings from the road beside it, so it is switched off with its neighbours
const MARK_SPLIT_ALONG = 3;             // the distance along the centre line may change at most this many nodes' spacing between two neighbouring nodes of one road: more = another arm of it

/**
 * The lane markings are drawn per pixel from the offset (lat) and the distance along (s) of the ONE nearest road, interpolated over the lattice.  Where the nearest road changes
 * between two neighbouring nodes (a slip road that merges with the main road, a junction of several ways, the two arms of a hairpin) the interpolation draws garbage: stray dashes and short
 * diagonal bits across the junction.  So a node that has a neighbour on a DIFFERENT road (or on the other arm of the same road) draws no markings: every cell that holds such a border has
 * all four of its nodes switched off, and every cell that is still painted interpolates the values of one road only.  The edge lines are the contour of the union of the carriageways
 * (aRoad3) and are not affected.  Pure: returns a new array of the same layout as `road2` (the markings factor is the 4th value of a node).
 */
export function maskMarkBorders(road2, road, along, sdCar, step) {
  const out = Float32Array.from(road2);
  for (let j = 0; j < APRON_SIDE; j++) {
    for (let i = 0; i < APRON_SIDE; i++) {
      const o = j * APRON_SIDE + i;
      if (road2[o * 4 + 3] === 0 || sdCar[o] > MARK_NEAR_ROAD) continue;
      for (let dj = -1; dj <= 1 && out[o * 4 + 3] !== 0; dj++) {
        for (let di = -1; di <= 1; di++) {
          const jj = j + dj, ii = i + di;
          if ((di === 0 && dj === 0) || jj < 0 || jj >= APRON_SIDE || ii < 0 || ii >= APRON_SIDE) continue;
          const n = jj * APRON_SIDE + ii;
          if (sdCar[n] > MARK_ON_ROAD) continue;
          if (road[n] !== road[o] || Math.abs(along[n] - along[o]) > MARK_SPLIT_ALONG * step) { out[o * 4 + 3] = 0; break; }
        }
      }
    }
  }
  return out;
}

/**
 * The edge of the tarmac as exact CHANNELS.  The union of the carriageways is the minimum of the distances to each of them; interpolated over the 1 m lattice, the minimum of two
 * roads has a crease, and a gap narrower than the lattice (the median of a dual carriageway: 0.5 .. 2 m) falls between the nodes: the median was a sawtooth of 1 m teeth (QA T01, T07,
 * M01).  Each node carries the distances to its CHANNELS nearest carriageways (carriageways.js groups: two ways of one carriageway are one), ordered by the group, so that the four
 * nodes of a cell interpolate the distances to the SAME carriageways: each is a plane, and the shader takes their minimum per pixel - the median is two straight kerbs.  Where the
 * set changes from node to node (more carriageways meet: a big junction) the node's weight is 0 and the shader keeps the blurred union (aRoad3.x).
 * The pavements of the carriageways come along the same way, and which of them is a street (the pale tar of a service way is outside every STREET carriageway, per pixel as well).
 * Where the set holds over the 3 x 3 nodes the channels get the [1 2 1]^2 blur of blurField: a plane does not move, but a carriageway that lies off its level is pushed out of the
 * paint by an amount that follows the ground (road-network.js PAINT_LEVEL_PUSH), and that field, not a plane, came out of the interpolation as a sawtooth.
 * Returns a Float32Array (APRON_SIDE^2 x CHANNEL_STRIDE): carriageways 0 .. 2, the weight, pavements 0 .. 2, the street bits (bit c: channel c is a street).
 */
export const CHANNEL_STRIDE = 8;
const CHANNEL_FAR = 30;                 // m: "no such carriageway" (a distance that never wins the minimum)
const CHANNEL_NEAR = 3.0;               // m (see carriagewayChannels): more than two diagonals of a 1 m cell
export function carriagewayChannels(chGroup, chCar, chPave, chMajor) {
  const n = APRON_SIDE * APRON_SIDE;
  const out = new Float32Array(n * CHANNEL_STRIDE);
  const slotGroups = new Int32Array(n * CHANNELS).fill(-1), nearMask = new Uint8Array(n);      // the group in each slot, and which slots hold a NEAR carriageway
  const order = [0, 1, 2];
  for (let o = 0; o < n; o++) {
    // The slots: the NEAR carriageways (within CHANNEL_NEAR of the node) by their group, then the others by their distance.  The weight holds where every carriageway that is near
    // at a node or at one of its 8 neighbours sits in the same slot at both: an edge in a cell lies within the cell's diagonal of its four nodes, so its carriageway is near there,
    // and a road passing a few metres away (not near) does not break the agreement.
    const g = (c) => chGroup[o * CHANNELS + c], d = (c) => chCar[o * CHANNELS + c];
    const isNear = (c) => g(c) >= 0 && d(c) <= CHANNEL_NEAR;
    order.sort((a, b) => (isNear(b) - isNear(a)) || (isNear(a) ? g(a) - g(b) : (g(a) < 0) - (g(b) < 0) || d(a) - d(b)));
    let maj = 0;
    order.forEach((c, k) => {
      const none = g(c) < 0;
      out[o * CHANNEL_STRIDE + k] = none ? CHANNEL_FAR : Math.min(CHANNEL_FAR, d(c));
      out[o * CHANNEL_STRIDE + 4 + k] = none ? CHANNEL_FAR : Math.min(CHANNEL_FAR, chPave[o * CHANNELS + c]);
      if (!none && chMajor[o * CHANNELS + c]) maj |= 1 << k;
    });
    out[o * CHANNEL_STRIDE + 7] = maj;
    order.forEach((c, k) => { slotGroups[o * CHANNELS + k] = g(c); if (isNear(c)) nearMask[o] |= 1 << k; });
  }
  /** Do the nodes o and q hold every carriageway that is near at either of them in the same slot? */
  const agree = (o, q) => {
    for (let k = 0; k < CHANNELS; k++) {
      if ((nearMask[o] >> k) & 1 && slotGroups[q * CHANNELS + k] !== slotGroups[o * CHANNELS + k]) return false;
      if ((nearMask[q] >> k) & 1 && slotGroups[o * CHANNELS + k] !== slotGroups[q * CHANNELS + k]) return false;
    }
    return true;
  };
  for (let j = 0; j < APRON_SIDE; j++) {
    for (let i = 0; i < APRON_SIDE; i++) {
      const o = j * APRON_SIDE + i;
      let same = 1;
      for (let dj = -1; dj <= 1 && same; dj++) {
        for (let di = -1; di <= 1; di++) {
          const jj = j + dj, ii = i + di;
          if (jj < 0 || jj >= APRON_SIDE || ii < 0 || ii >= APRON_SIDE) continue;
          if (!agree(o, jj * APRON_SIDE + ii)) { same = 0; break; }
        }
      }
      out[o * CHANNEL_STRIDE + 3] = same;
    }
  }
  const raw = Float32Array.from(out);
  const W = [1, 2, 1];
  for (let j = 1; j < APRON_SIDE - 1; j++) {
    for (let i = 1; i < APRON_SIDE - 1; i++) {
      const o = j * APRON_SIDE + i;
      if (!raw[o * CHANNEL_STRIDE + 3]) continue;
      for (const c of [0, 1, 2, 4, 5, 6]) {
        let sum = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) sum += W[dj + 1] * W[di + 1] * raw[((j + dj) * APRON_SIDE + i + di) * CHANNEL_STRIDE + c];
        out[o * CHANNEL_STRIDE + c] = sum / 16;
      }
    }
  }
  return out;
}

/** Node data of a tile (cached by the caller): the heights, the road coverage and the road geometry. */
export function computeTileNodes(leaf, surface, field) {
  const { x0, z0, step } = leaf;
  if (step === 1) {
    const b = surface.block(x0 / QUADTREE.minSize, z0 / QUADTREE.minSize);       // same lattice as the physics
    // the block carries an apron of one node around the tile: the arrays must be read with the same index the mesh uses
    // (buildTileMesh reads every node with the apron index), otherwise the last rows read past the end and come back as NaN
    const road2 = new Float32Array(APRON_SIDE * APRON_SIDE * 4);
    for (let o = 0; o < APRON_SIDE * APRON_SIDE; o++) {
      road2[o * 4] = b.cover[o];
      road2[o * 4 + 1] = b.lines[o];
      road2[o * 4 + 2] = b.surface[o];                         // the material of the road the node is on
      road2[o * 4 + 3] = b.junction[o] ? 0 : 1;                // the 1 m lattice draws the markings exactly (not at a junction)
    }
    return { h: b.h, lat: b.lat, hw: b.hw, a0: b.a0, kind: b.kind, surface: b.surface, along: b.along, sdCar: blurField(b.sdCar), sdPave: blurField(b.sdPave), sdMajor: blurField(b.sdMajor), road2: maskMarkBorders(road2, b.road, b.along, b.sdCar, step), channels: carriagewayChannels(b.chGroup, b.chCar, b.chPave, b.chMajor), shared: true };
  }
  const h = new Float32Array(APRON_SIDE * APRON_SIDE);
  const lat = new Float32Array(APRON_SIDE * APRON_SIDE);
  const hw = new Float32Array(APRON_SIDE * APRON_SIDE);
  const a0 = new Float32Array(APRON_SIDE * APRON_SIDE);
  const kind = new Uint8Array(APRON_SIDE * APRON_SIDE);
  const surf = new Uint8Array(APRON_SIDE * APRON_SIDE);      // the material of the road the node is on
  const along = new Float32Array(APRON_SIDE * APRON_SIDE);
  const sdCar = new Float32Array(APRON_SIDE * APRON_SIDE), sdPave = new Float32Array(APRON_SIDE * APRON_SIDE), sdMajor = new Float32Array(APRON_SIDE * APRON_SIDE);
  const road2 = new Float32Array(APRON_SIDE * APRON_SIDE * 4);
  const roadId = new Int32Array(APRON_SIDE * APRON_SIDE);
  const N = APRON_SIDE * APRON_SIDE;
  const chGroup = new Int32Array(N * CHANNELS), chCar = new Float32Array(N * CHANNELS), chPave = new Float32Array(N * CHANNELS), chMajor = new Uint8Array(N * CHANNELS);
  const info = { coverage: 0, lat: 0, hw: 0, a0: 0, kind: 0, road: -1, lines: 0, lanes: 0, s: 0, surface: 0, chGroup: new Int32Array(CHANNELS), chCar: new Float32Array(CHANNELS), chPave: new Float32Array(CHANNELS), chMajor: new Uint8Array(CHANNELS) };
  const mark = fadeOf(step, ROAD.markFullStep, ROAD.markFadeStep);
  for (let j = 0; j < APRON_SIDE; j++) {
    for (let i = 0; i < APRON_SIDE; i++) {
      const o = j * APRON_SIDE + i;
      h[o] = field.heightForStep(x0 + (i - 1) * step, z0 + (j - 1) * step, step, info);
      lat[o] = info.lat; hw[o] = info.hw; a0[o] = info.a0; kind[o] = info.kind; along[o] = info.s;
      surf[o] = info.surface; sdCar[o] = info.sdCar; sdPave[o] = info.sdPave; sdMajor[o] = info.sdMajor; roadId[o] = info.road;
      road2[o * 4] = info.coverage; road2[o * 4 + 1] = info.lines; road2[o * 4 + 3] = info.junction ? 0 : mark;
      chGroup.set(info.chGroup, o * CHANNELS); chCar.set(info.chCar, o * CHANNELS); chPave.set(info.chPave, o * CHANNELS); chMajor.set(info.chMajor, o * CHANNELS);
    }
  }
  return { h, lat, hw, a0, kind, surface: surf, along, sdCar: blurField(sdCar), sdPave: blurField(sdPave), sdMajor: blurField(sdMajor), road2: maskMarkBorders(road2, roadId, along, sdCar, step), channels: carriagewayChannels(chGroup, chCar, chPave, chMajor), shared: false };
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

/** A string that changes exactly when the stitched geometry of the leaf would change. */
export function stitchSignature(leaf, split) {
  return stitchesOf(leaf, split).map((s) => `${s.v}@${s.tile.key}`).join('|');
}

/**
 * Returns { positions, normals, road, road2, road3, mark, indices, vertexCount, signature, ... } (tile-local positions).
 * `marks` (optional): the marking plan (markings.js); its pieces are draped over this tile as ribbons (appended after the grid and the skirts, see appendMarkings).
 */
export function buildTileMesh(leaf, nodes, split, field, marks = null) {
  const { x0, z0, step, size } = leaf;
  const h = nodes.h, lat = nodes.lat, hw = nodes.hw, a0 = nodes.a0, surface = nodes.surface, along = nodes.along;
  const vertexCount = SIDE * SIDE;
  const skirtVerts = 4 * SIDE;
  const positions = new Float32Array((vertexCount + skirtVerts) * 3);
  const normals = new Float32Array((vertexCount + skirtVerts) * 3);
  const road = new Float32Array((vertexCount + skirtVerts) * 4);
  const road2 = new Float32Array((vertexCount + skirtVerts) * 4);
  const road3 = new Float32Array((vertexCount + skirtVerts) * 4);      // aRoad3: the signed distances of the paint (see the vertex shader)
  const road4 = new Float32Array((vertexCount + skirtVerts) * 4);      // aRoad4: the carriageway channels of the paint and their weight (carriagewayChannels)
  const road5 = new Float32Array((vertexCount + skirtVerts) * 4);      // aRoad5: the pavements of the channels and the street bits
  const paintK = fadeOf(step, ROAD.paintFullStep, ROAD.paintFadeStep);
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
      road[v * 4] = lat[a]; road[v * 4 + 1] = hw[a]; road[v * 4 + 2] = a0[a]; road[v * 4 + 3] = along[a];
      road2[v * 4] = nodes.road2[a * 4]; road2[v * 4 + 1] = nodes.road2[a * 4 + 1];
      road2[v * 4 + 2] = surface[a];                        // the material of the road the node is on
      road2[v * 4 + 3] = nodes.road2[a * 4 + 3];
      road3[v * 4] = nodes.sdCar[a]; road3[v * 4 + 1] = nodes.sdPave[a]; road3[v * 4 + 2] = paintK; road3[v * 4 + 3] = nodes.sdMajor[a];
      for (let c = 0; c < 4; c++) { road4[v * 4 + c] = nodes.channels[a * CHANNEL_STRIDE + c]; road5[v * 4 + c] = nodes.channels[a * CHANNEL_STRIDE + 4 + c]; }
    }
  }
  // skirts: duplicate every boundary vertex lower down (order: north row, south row, west column, east column)
  let sv = vertexCount;
  const skirtOf = new Int32Array(vertexCount).fill(-1);
  const addSkirt = (v) => {
    positions[sv * 3] = positions[v * 3]; positions[sv * 3 + 1] = positions[v * 3 + 1] - skirtDepth; positions[sv * 3 + 2] = positions[v * 3 + 2];
    normals[sv * 3] = normals[v * 3]; normals[sv * 3 + 1] = normals[v * 3 + 1]; normals[sv * 3 + 2] = normals[v * 3 + 2];
    for (let c = 0; c < 4; c++) { road[sv * 4 + c] = road[v * 4 + c]; road2[sv * 4 + c] = road2[v * 4 + c]; road3[sv * 4 + c] = road3[v * 4 + c]; road4[sv * 4 + c] = road4[v * 4 + c]; road5[sv * 4 + c] = road5[v * 4 + c]; }
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
  const base = { positions, normals, road, road2, road3, road4, road5, mark: new Float32Array((vertexCount + skirtVerts) * 4), indices: indices.subarray(0, n), vertexCount: vertexCount + skirtVerts, gridVertexCount: vertexCount, signature: [...stitchAt.values()].map((st) => `${st.v}@${st.tile.key}`).join('|'), size, x0, z0, step };
  return marks ? appendMarkings(base, nodes, marks) : base;
}

const MARK_ROUND = 1e-4;

/**
 * The lane markings of the tile as RIBBONS draped over its own triangles: every visible piece of the marking plan (markings.js) that crosses the tile is cut to the tile's box and laid
 * along the track in steps of the lattice spacing; the height of every ribbon vertex is the height of this very mesh at its point (exact, at every LOD), its normal and its paint
 * attributes are the tile's own there, so the shader paints the ground under the line exactly as beside it.  The ribbon is a line of zero width on the CPU: the vertex shader widens
 * it along aMark.xy to the half width aMark.z (at least about a pixel at a distance) and pulls it a little toward the camera (ground-shader.js).
 * aMark = (the unit normal of the line x, z, its half width, the side (-1 / +1) times the strength of the paint).  0 on the ground.
 * A piece of line is laid only where the terrain's carriageway lies around it (MARK.onRoad) and the ground is level enough for a road: never up a wall, a ramp or a kerb.
 * Pure: returns a new mesh object (the arrays of `mesh` are copied, not changed).
 */
export function appendMarkings(mesh, nodes, plan) {
  const { x0, z0, step, size } = mesh;
  const strength = fadeOf(step, ROAD.markFullStep, ROAD.markFadeStep);
  if (strength <= 0) return mesh;
  const x1 = x0 + size, z1 = z0 + size;
  const quads = [];                    // [ax, az, bx, bz, anx, anz, bnx, bnz]
  const p = { x: 0, z: 0, nx: 0, nz: 0, bed: 0, way: 0, o: 0 }, q = { x: 0, z: 0, nx: 0, nz: 0, bed: 0, way: 0, o: 0 };
  const along = Math.max(1, step);
  const sdAt = (x, z) => {             // (the edge of the carriageway as the shader paints it: the channels where they hold, else the blurred union)
    const ch = (c) => nodeLerpK(nodes.channels, CHANNEL_STRIDE, c, x0, z0, step, x, z);
    const w = Math.min(1, Math.max(0, ch(3)));
    return nodeLerp(nodes.sdCar, x0, z0, step, x, z) * (1 - w) + Math.min(ch(0), ch(1), ch(2)) * w;
  };
  const levelAt = (x, z) => nodeLerp3(mesh.normals, x0, z0, step, x, z, 1);
  // (the carriageway test needs the 1 m lattice: on a 2 m lattice the distance of a narrow median or a kerb is blurred over 4 m, so a coarse tile only asks for level ground near a road)
  const sdLimit = step <= 1 ? -MARK.onRoad : COARSE_ON_ROAD;
  const okAt = (x, z) => sdAt(x, z) < sdLimit && levelAt(x, z) >= LEVEL_NORMAL_Y;
  for (const idx of plan.piecesIn(x0, z0, x1, z1)) {
    const pc = plan.pieces[idx];
    if (pc.deck) continue;
    const tr = plan.tracks[pc.track], ch = plan.chains[tr.chain];
    for (const [a, b] of pieceSpans(pc)) {
      const nSub = Math.max(1, Math.ceil((b - a) / along - 1e-6));
      trackPoint(ch, tr, a, p);
      for (let k = 1; k <= nSub; k++) {
        trackPoint(ch, tr, a + (b - a) * (k / nSub), q);
        const c = clipToBox(p.x, p.z, q.x, q.z, x0, z0, x1, z1);
        if (c) {
          const ax = p.x + (q.x - p.x) * c[0], az = p.z + (q.z - p.z) * c[0];
          const bx = p.x + (q.x - p.x) * c[1], bz = p.z + (q.z - p.z) * c[1];
          if (Math.hypot(bx - ax, bz - az) > MARK_ROUND && okAt(ax, az) && okAt(bx, bz) && okAt((ax + bx) / 2, (az + bz) / 2)) {
            const anx = p.nx + (q.nx - p.nx) * c[0], anz = p.nz + (q.nz - p.nz) * c[0];
            const bnx = p.nx + (q.nx - p.nx) * c[1], bnz = p.nz + (q.nz - p.nz) * c[1];
            quads.push(ax, az, bx, bz, anx, anz, bnx, bnz);
          }
        }
        p.x = q.x; p.z = q.z; p.nx = q.nx; p.nz = q.nz;
      }
    }
  }
  if (!quads.length) return mesh;
  const nq = quads.length / 8;
  const v0 = mesh.vertexCount, vc = v0 + nq * 4;
  const grow = (src, k) => { const out = new Float32Array(vc * k); out.set(src.subarray(0, v0 * k)); return out; };
  const positions = grow(mesh.positions, 3), normals = grow(mesh.normals, 3);
  const road = grow(mesh.road, 4), road2 = grow(mesh.road2, 4), road3 = grow(mesh.road3, 4), road4 = grow(mesh.road4, 4), road5 = grow(mesh.road5, 4), mark = grow(mesh.mark, 4);
  const indices = new Uint16Array(mesh.indices.length + nq * 6);
  indices.set(mesh.indices);
  let ni = mesh.indices.length;
  const paintK = mesh.road3[2];
  const put = (v, x, z, nx, nz, side) => {
    positions[v * 3] = x - x0; positions[v * 3 + 1] = meshHeightAt(mesh, x, z); positions[v * 3 + 2] = z - z0;
    normals[v * 3] = nodeLerp3(mesh.normals, x0, z0, step, x, z, 0); normals[v * 3 + 1] = nodeLerp3(mesh.normals, x0, z0, step, x, z, 1); normals[v * 3 + 2] = nodeLerp3(mesh.normals, x0, z0, step, x, z, 2);
    const o = nearestNode(x0, z0, step, x, z);
    road[v * 4] = nodeLerp(nodes.lat, x0, z0, step, x, z); road[v * 4 + 1] = nodes.hw[o]; road[v * 4 + 2] = nodes.a0[o]; road[v * 4 + 3] = nodes.along[o];
    road2[v * 4] = nodeLerp4(nodes.road2, x0, z0, step, x, z, 0); road2[v * 4 + 1] = nodes.road2[o * 4 + 1]; road2[v * 4 + 2] = nodes.surface[o]; road2[v * 4 + 3] = nodes.road2[o * 4 + 3];
    road3[v * 4] = nodeLerp(nodes.sdCar, x0, z0, step, x, z); road3[v * 4 + 1] = nodeLerp(nodes.sdPave, x0, z0, step, x, z); road3[v * 4 + 2] = paintK; road3[v * 4 + 3] = nodeLerp(nodes.sdMajor, x0, z0, step, x, z);
    for (let c = 0; c < 4; c++) road4[v * 4 + c] = nodeLerpK(nodes.channels, CHANNEL_STRIDE, c, x0, z0, step, x, z);
    for (let c = 0; c < 3; c++) road5[v * 4 + c] = nodeLerpK(nodes.channels, CHANNEL_STRIDE, 4 + c, x0, z0, step, x, z);
    road5[v * 4 + 3] = nodes.channels[o * CHANNEL_STRIDE + 7];
    const l = Math.hypot(nx, nz) || 1;
    mark[v * 4] = nx / l; mark[v * 4 + 1] = nz / l; mark[v * 4 + 2] = MARK.lineHalf; mark[v * 4 + 3] = side * strength;
  };
  for (let k = 0; k < nq; k++) {
    const [ax, az, bx, bz, anx, anz, bnx, bnz] = quads.slice(k * 8, k * 8 + 8);
    const v = v0 + k * 4;
    put(v, ax, az, anx, anz, -1); put(v + 1, ax, az, anx, anz, 1); put(v + 2, bx, bz, bnx, bnz, 1); put(v + 3, bx, bz, bnx, bnz, -1);
    // wound like the ground (counter-clockwise seen from above): the side of the normal decides which way round
    const dx = bx - ax, dz = bz - az;
    const ccw = (dz * anx - dx * anz) > 0;           // (the corner -n at A, then B: is the turn to +n counter-clockwise in x / z?)
    if (ccw) { indices[ni++] = v; indices[ni++] = v + 3; indices[ni++] = v + 2; indices[ni++] = v; indices[ni++] = v + 2; indices[ni++] = v + 1; }
    else { indices[ni++] = v; indices[ni++] = v + 2; indices[ni++] = v + 3; indices[ni++] = v; indices[ni++] = v + 1; indices[ni++] = v + 2; }
  }
  return { ...mesh, positions, normals, road, road2, road3, road4, road5, mark, indices, vertexCount: vc, markQuads: nq };
}

const COARSE_ON_ROAD = 0.5;           // m (see appendMarkings)
const LEVEL_NORMAL_Y = 0.94;          // a line is laid only where the ground is level enough for a carriageway (about 20 degrees): never up the face of a wall or a ramp

/** The part [t0, t1] of the segment a -> b inside the box (Liang-Barsky), or null. */
function clipToBox(ax, az, bx, bz, x0, z0, x1, z1) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [pp, qq] of [[-dx, ax - x0], [dx, x1 - ax], [-dz, az - z0], [dz, z1 - az]]) {
    if (Math.abs(pp) < 1e-12) { if (qq < 0) return null; continue; }
    const r = qq / pp;
    if (pp < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return t1 - t0 > 1e-9 ? [t0, t1] : null;
}

/** Bilinear value of a node array of the tile (the apron layout of computeTileNodes) at a world point inside the tile. */
function nodeLerp(arr, x0, z0, step, x, z) { return nodeLerpK(arr, 1, 0, x0, z0, step, x, z); }
function nodeLerp4(arr, x0, z0, step, x, z, c) { return nodeLerpK(arr, 4, c, x0, z0, step, x, z); }
function nodeLerpK(arr, k, c, x0, z0, step, x, z) {
  const fx = Math.min(CELLS, Math.max(0, (x - x0) / step)), fz = Math.min(CELLS, Math.max(0, (z - z0) / step));
  const i = Math.min(CELLS - 1, Math.floor(fx)), j = Math.min(CELLS - 1, Math.floor(fz));
  const tx = fx - i, tz = fz - j;
  const a = (j + 1) * APRON_SIDE + i + 1;
  const v00 = arr[a * k + c], v10 = arr[(a + 1) * k + c], v01 = arr[(a + APRON_SIDE) * k + c], v11 = arr[(a + APRON_SIDE + 1) * k + c];
  return (v00 * (1 - tx) + v10 * tx) * (1 - tz) + (v01 * (1 - tx) + v11 * tx) * tz;
}
/** Bilinear value of a per-vertex array of the grid (3 values per vertex: normals) at a world point inside the tile. */
function nodeLerp3(arr, x0, z0, step, x, z, c) {
  const fx = Math.min(CELLS, Math.max(0, (x - x0) / step)), fz = Math.min(CELLS, Math.max(0, (z - z0) / step));
  const i = Math.min(CELLS - 1, Math.floor(fx)), j = Math.min(CELLS - 1, Math.floor(fz));
  const tx = fx - i, tz = fz - j;
  const a = j * SIDE + i;
  const v00 = arr[a * 3 + c], v10 = arr[(a + 1) * 3 + c], v01 = arr[(a + SIDE) * 3 + c], v11 = arr[(a + SIDE + 1) * 3 + c];
  return (v00 * (1 - tx) + v10 * tx) * (1 - tz) + (v01 * (1 - tx) + v11 * tx) * tz;
}
/** The apron index of the node nearest to a world point inside the tile. */
function nearestNode(x0, z0, step, x, z) {
  const i = Math.min(CELLS, Math.max(0, Math.round((x - x0) / step))), j = Math.min(CELLS, Math.max(0, Math.round((z - z0) / step)));
  return (j + 1) * APRON_SIDE + i + 1;
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
