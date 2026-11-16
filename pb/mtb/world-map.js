/* The 4 m world maps the ground shader and the forest read. Two RGBA8 rasters over the whole box (bilinear filtering blends the borders,
 * which is why the land cover is stored as weights and not as a class id):
 *   cover  R grass (meadow 1, farmland .75)  G built-up  B water  A bare rock
 *   canopy R canopy cover 0..1  G canopy height / 45 m  B wetness (hollows, stream beds: moss)  A farmland flag
 * Pure data code (no THREE): the browser uploads both as textures, the forest placement samples them on the CPU. */
import { WORLD } from './config.js';
import { sampleBilinear } from './base-field.js';

export const MAP_CELL = 4;
export const CLASS = Object.freeze({ unknown: 0, forest: 1, meadow: 2, farmland: 3, built: 4, water: 5, rock: 6, scrub: 7 });
const CANOPY_MAX = 45;
const byte = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);

const HEDGE_SHARE_BETWEEN = 0.62;     // share of the borders between two fields that carry a hedge
const HEDGE_SHARE_EDGE = 0.3;         // share of a field's border towards "no field" (forest, road, village) that carries one
const pairHash = (a, b) => { let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) >>> 0; h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };

const RING = Object.freeze([3, 0, -3, 0, 0, 3, 0, -3, 2, 2, -2, 2, 2, -2, -2, -2]);      // (dx, dz) pairs, hoisted: this loop runs for 2 million cells
const RING_COL = Object.freeze(RING.filter((_, k) => k % 2 === 0).map((dx) => dx + 3)), RING_ROW = Object.freeze(RING.filter((_, k) => k % 2 === 1).map((dz) => dz + 3));    // index into RING_OFFSETS
const RING_OFFSETS = Object.freeze([-3, -2, -1, 0, 1, 2, 3]);
const NEIGHBOURS = Object.freeze([1, 0, -1, 0, 0, 1, 0, -1]);

export function buildWorldMap({ classes, canopy, near, leaf, fields, cliffs = [] }) {
  const nx = classes.nx, nz = classes.nz;
  if (nx !== WORLD.width / MAP_CELL || nz !== WORLD.depth / MAP_CELL) throw new Error(`class raster is ${nx}x${nz}, expected ${WORLD.width / MAP_CELL}x${WORLD.depth / MAP_CELL}`);
  const cover = new Uint8Array(nx * nz * 4), can = new Uint8Array(nx * nz * 4), field = new Uint8Array(nx * nz * 4);
  const ch = canopy.height, cc = canopy.cover;
  const nearW = near.nx, nearH = near.nz, nd = near.data;
  // Per column / per row lookups, computed once (the loop below runs for 2 million cells): the canopy lattice cell and weight (the same clamp and floor as sampleBilinear), and the clamped
  // near-grid indices of every offset the wetness ring reads. The arithmetic per cell is unchanged, so the rasters come out bit for bit as before.
  const lattice = (count, size) => { const idx = new Int32Array(count), w = new Float64Array(count); for (let k = 0; k < count; k++) { const g = Math.min(size - 1.0000001, Math.max(0, (k * MAP_CELL) / canopy.step)); idx[k] = Math.floor(g); w[k] = g - idx[k]; } return { idx, w }; };
  const latX = lattice(nx, cc.nx), latZ = lattice(nz, cc.nz);
  const latHX = lattice(nx, ch.nx), latHZ = lattice(nz, ch.nz);
  const colAt = (dx) => { const a = new Int32Array(nx); for (let i = 0; i < nx; i++) a[i] = Math.min(nearW - 1, Math.max(0, (i + dx) * 2)); return a; };
  const rowAt = (dz) => { const a = new Int32Array(nz); for (let j = 0; j < nz; j++) a[j] = Math.min(nearH - 1, Math.max(0, (j + dz) * 2)) * nearW; return a; };
  const cols = RING_OFFSETS.map(colAt), rows = RING_OFFSETS.map(rowAt), col0 = colAt(0), row0 = rowAt(0);
  const ccd = cc.data, chd = ch.data, ccw = cc.nx, chw = ch.nx;
  for (let j = 0; j < nz; j++) {
    const czi = latZ.idx[j], czw = latZ.w[j], chzi = latHZ.idx[j], chzw = latHZ.w[j];
    for (let i = 0; i < nx; i++) {
      const o = (j * nx + i) * 4;
      const cls = classes.data[j * nx + i];
      const oc = czi * ccw + latX.idx[i], tx = latX.w[i];
      let canopyCover = (ccd[oc] * (1 - tx) + ccd[oc + 1] * tx) * (1 - czw) + (ccd[oc + ccw] * (1 - tx) + ccd[oc + ccw + 1] * tx) * czw;
      const oh = chzi * chw + latHX.idx[i], hx = latHX.w[i];
      const canopyHeight = (chd[oh] * (1 - hx) + chd[oh + 1] * hx) * (1 - chzw) + (chd[oh + chw] * (1 - hx) + chd[oh + chw + 1] * hx) * chzw;
      if (cls === CLASS.built || cls === CLASS.water || cls === CLASS.farmland) canopyCover = 0;            // roofs and fields are not forest
      else if (cls === CLASS.meadow) canopyCover *= 0.3;
      const h = nd[row0[j] + col0[i]];
      let ring = 0;
      for (let k = 0; k < RING.length; k += 2) ring += nd[rows[RING_ROW[k / 2]][j] + cols[RING_COL[k / 2]][i]];
      const wet = Math.min(1, Math.max(0, 0.25 + (ring / 8 - h) * 0.28));        // positive concavity: a hollow
      cover[o] = cls === CLASS.meadow ? 255 : cls === CLASS.farmland ? 190 : 0;
      cover[o + 1] = cls === CLASS.built ? 255 : 0;
      cover[o + 2] = cls === CLASS.water ? 255 : 0;
      cover[o + 3] = cls === CLASS.rock ? 255 : 0;
      const fid = fields ? fields.data[j * nx + i] : 0;
      let hedge = 0;
      if (fid > 0 && cls !== CLASS.built && cls !== CLASS.forest) {
        for (let k = 0; k < NEIGHBOURS.length; k += 2) {
          const dx = NEIGHBOURS[k], dz = NEIGHBOURS[k + 1];
          const ni = i + dx, nj = j + dz;
          const nid = ni < 0 || nj < 0 || ni >= nx || nj >= nz ? 0 : fields.data[nj * nx + ni];
          if (nid === fid) continue;
          const share = nid > 0 ? HEDGE_SHARE_BETWEEN : HEDGE_SHARE_EDGE;
          if (pairHash(Math.min(fid, nid), Math.max(fid, nid)) < share) hedge = dx !== 0 ? 1 : 2;       // 1: the hedge runs along z, 2: along x
        }
      }
      field[o] = fid; field[o + 1] = leaf ? leaf.data[j * nx + i] * 85 : 0; field[o + 2] = hedge * 120; field[o + 3] = 0;
      can[o] = byte(canopyCover); can[o + 1] = byte(canopyHeight / CANOPY_MAX); can[o + 2] = byte(wet); can[o + 3] = cls === CLASS.farmland ? 255 : 0;
    }
  }
  // OSM cliff lines: a 3-cell-wide hint in the alpha channel of `field` (the rock placement and the ground paint read it)
  for (const way of cliffs) {
    for (let k = 0; k + 1 < way.pts.length; k++) {
      const [ax, az] = way.pts[k], [bx, bz] = way.pts[k + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (MAP_CELL * 0.5)));
      for (let q = 0; q <= steps; q++) {
        const ci = Math.floor((ax + (bx - ax) * q / steps) / MAP_CELL), cj = Math.floor((az + (bz - az) * q / steps) / MAP_CELL);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = ci + di, jj = cj + dj;
          if (ii >= 0 && jj >= 0 && ii < nx && jj < nz) field[(jj * nx + ii) * 4 + 3] = di === 0 && dj === 0 ? 255 : Math.max(field[(jj * nx + ii) * 4 + 3], 120);
        }
      }
    }
  }
  return { nx, nz, cover, canopy: can, field };
}

/** CPU sample of the maps (bilinear on the cell grid), for the forest placement: { grass, built, water, rock, cover, height, wet }. */
export function sampleWorldMap(map, x, z, out) {
  const fx = Math.min(map.nx - 1.001, Math.max(0, x / MAP_CELL - 0.5)), fz = Math.min(map.nz - 1.001, Math.max(0, z / MAP_CELL - 0.5));
  const i = Math.floor(fx), j = Math.floor(fz);
  const o = (j * map.nx + i) * 4;
  const tx = fx - i, tz = fz - j;
  const lerp = (arr, c) => (arr[o + c] * (1 - tx) + arr[o + 4 + c] * tx) * (1 - tz) + (arr[o + map.nx * 4 + c] * (1 - tx) + arr[o + map.nx * 4 + 4 + c] * tx) * tz;
  out.grass = lerp(map.cover, 0) / 255; out.built = lerp(map.cover, 1) / 255; out.water = lerp(map.cover, 2) / 255; out.rock = lerp(map.cover, 3) / 255;
  out.cover = lerp(map.canopy, 0) / 255; out.height = lerp(map.canopy, 1) / 255 * CANOPY_MAX; out.wet = lerp(map.canopy, 2) / 255;
  return out;
}

/** Field id (0 = none), leaf type (0 unknown, 1 broadleaved, 2 needleleaved, 3 mixed) and hedge flag (0 none, 1 along z, 2 along x) of the 4 m cell under (x, z). Nearest cell, no blending. */
export function sampleFieldCell(map, x, z, out) {
  const i = Math.min(map.nx - 1, Math.max(0, Math.floor(x / MAP_CELL))), j = Math.min(map.nz - 1, Math.max(0, Math.floor(z / MAP_CELL)));
  const o = (j * map.nx + i) * 4;
  out.field = map.field[o]; out.leaf = Math.round(map.field[o + 1] / 85); out.hedge = Math.round(map.field[o + 2] / 120); out.cliff = map.field[o + 3] / 255;
  return out;
}
