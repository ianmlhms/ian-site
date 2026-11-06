/* The land cover of Lux Drive: the class raster (8 m) and the canopy (16 m) as the rasters the ground shader and the
 * trees read.
 *
 *   cover  R the open land (grass, parks, scrub)  G the forest  B the built-up city  A the water
 *   (the GPU copy `coverGpu`: R the paved squares of paved-squares.js instead of the open land, which no shader reads; B weighted by the houses)
 *   canopy R the canopy cover 0..1  G the canopy height / 45 m  B the parks and the heath  A the farmland
 *
 * The weights are stored as weights (not as a class id) because the GPU filters them bilinearly: the border between a
 * wood and a meadow is then a soft line, not a staircase.  Pure data code (no THREE): the browser uploads both as
 * textures, the tree placement samples them on the CPU. */
import { WORLD } from './config.js';
import { sampleBilinear } from './base-field.js';
import { PAVED_SQUARES } from './paved-squares.js';

export const CLASS_CELL = 8;
export const CLASS = Object.freeze({ grass: 0, forest: 1, water: 2, park: 3, urban: 4, farmland: 5, sand: 6, scrub: 7 });
const CANOPY_MAX = 45;
const byte = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);

/**
 * classes: { nx, nz, data } of the class raster, classInfo: its metadata, canopy: { height, cover } of the two
 * canopy grids (16 m nodes, the same origin as the terrain).
 */
/** How built-up the neighbourhood of every class cell is: the footprint area of the buildings in a (2 R + 1)^2 window, as a share of the window.
 *  The class `urban` of the bake also covers the plots of a village that nobody has built on and the parcels of a planned
 *  neighbourhood: from above they read as grey washes in the middle of the fields.  Hard ground belongs where the houses are. */
const DENSITY_RADIUS = 4;             // cells (8 m): the window is 72 m wide
export function builtDensity(buildings, nx, nz, radius = DENSITY_RADIUS) {
  const area = new Float32Array(nx * nz);
  for (const b of buildings) {
    const pts = b.pts;
    let a = 0, cx = 0, cz = 0;
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      a += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
      cx += pts[i * 2]; cz += pts[i * 2 + 1];
    }
    const ci = Math.min(nx - 1, Math.max(0, Math.floor(cx / n / CLASS_CELL))), cj = Math.min(nz - 1, Math.max(0, Math.floor(cz / n / CLASS_CELL)));
    area[cj * nx + ci] += Math.abs(a) / 2;
  }
  return boxBlur(area, nx, nz, radius);
}

/** Is (x, z) inside the polygon (even-odd rule)? */
function insidePolygon(pts, x, z) {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], zi = pts[i * 2 + 1], xj = pts[j * 2], zj = pts[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** The built share of the close neighbourhood of every cell.  Unlike builtDensity the area is put where the building IS (every cell
 *  whose middle is inside the footprint counts in full), because a window of 3 cells would otherwise see a 100 m long block only in
 *  the one cell of its centre and call the ground along its wall empty. */
export function builtCover(buildings, nx, nz, radius = NEAR_RADIUS) {
  const cover = new Float32Array(nx * nz);
  const cellArea = CLASS_CELL * CLASS_CELL;
  for (const b of buildings) {
    const pts = b.pts;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < x0) x0 = pts[i]; if (pts[i] > x1) x1 = pts[i];
      if (pts[i + 1] < z0) z0 = pts[i + 1]; if (pts[i + 1] > z1) z1 = pts[i + 1];
    }
    const i0 = Math.max(0, Math.floor(x0 / CLASS_CELL)), i1 = Math.min(nx - 1, Math.floor(x1 / CLASS_CELL));
    const j0 = Math.max(0, Math.floor(z0 / CLASS_CELL)), j1 = Math.min(nz - 1, Math.floor(z1 / CLASS_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (insidePolygon(pts, (i + 0.5) * CLASS_CELL, (j + 0.5) * CLASS_CELL)) cover[j * nx + i] = cellArea;
      }
    }
  }
  return boxBlur(cover, nx, nz, radius);
}

/** A separable box blur through running sums; the result is the sum in the (2 R + 1)^2 window divided by its area (m2). */
function boxBlur(area, nx, nz, R) {
  const tmp = new Float32Array(nx * nz), out = new Float32Array(nx * nz);
  const win = (2 * R + 1) * CLASS_CELL;
  for (let j = 0; j < nz; j++) {
    let sum = 0;
    for (let i = 0; i < R; i++) sum += area[j * nx + i];
    for (let i = 0; i < nx; i++) {
      if (i + R < nx) sum += area[j * nx + i + R];
      if (i - R - 1 >= 0) sum -= area[j * nx + i - R - 1];
      tmp[j * nx + i] = sum;
    }
  }
  for (let i = 0; i < nx; i++) {
    let sum = 0;
    for (let j = 0; j < R; j++) sum += tmp[j * nx + i];
    for (let j = 0; j < nz; j++) {
      if (j + R < nz) sum += tmp[(j + R) * nx + i];
      if (j - R - 1 >= 0) sum -= tmp[(j - R - 1) * nx + i];
      out[j * nx + i] = sum / (win * win);
    }
  }
  return out;
}
const smooth01 = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const URBAN_FROM = 0.03, URBAN_FULL = 0.10;      // the built share of the 72 m window under which `urban` is open ground, and over which it is the city
/** The close neighbourhood (a 24 m window): hard ground belongs next to the walls.  The verges and the lawns between the big blocks of
 *  Kirchberg (class `urban` in the bake, because the landuse is commercial) are grass: where almost nothing is built within 12 m, the
 *  ground is the meadow, whatever the class says.  The pavement of the road is painted separately (the road network), so the street
 *  keeps its kerbs and slabs. */
const NEAR_RADIUS = 1;
const NEAR_FROM = 0.05, NEAR_FULL = 0.17;      // the built share of the 24 m window under which `urban` is open ground, and over which it is the city
// (city12, QA3 section 3 item 7: the near rule also took the strip between the pavement and the shop fronts of a wide street in the dense centre for a
// verge - Bd Royal was a lawn corridor.  Where the 72 m window is densely built (the old town and the boulevards 0.33 - 0.73; the lawns of Kirchberg
// and the JFK verges are 0.0 - 0.21) the urban class is the city whatever the 24 m window says.)
// Only in the centre (the Ville-Haute, the boulevards, the Gare quarter): the perimeter blocks there have paved fronts and courtyards; a terraced street of the
// suburbs is as dense in the 72 m window and has lawns behind its houses (Weimershof, Neudorf, Dommeldange kept their gardens: harness U4).
const DENSE_FROM = 0.26, DENSE_FULL = 0.34;
export const DENSE_CENTRE = Object.freeze([4300, 8000, 5800, 10400]);     // x0, z0, x1, z1
/** The urban weight of look2 (the 72 m density x the 24 m near cover), before the dense rule: harness U4 measures what the dense rule changed. */
export const urbanLook2 = (density, near) => Math.round(255 * Math.min(smooth01(URBAN_FROM, URBAN_FULL, density), smooth01(NEAR_FROM, NEAR_FULL, near)));

/** The cells (8 m) whose middle lies in a paved square, as a 0 / 1 mask. */
function pavedSquareMask(nx, nz) {
  const mask = new Uint8Array(nx * nz);
  for (const sq of PAVED_SQUARES) {
    const flat = sq.pts.flat();
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of sq.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let j = Math.max(0, Math.floor(z0 / CLASS_CELL)); j <= Math.min(nz - 1, Math.ceil(z1 / CLASS_CELL)); j++) {
      for (let i = Math.max(0, Math.floor(x0 / CLASS_CELL)); i <= Math.min(nx - 1, Math.ceil(x1 / CLASS_CELL)); i++) {
        if (insidePolygon(flat, i * CLASS_CELL, j * CLASS_CELL)) mask[j * nx + i] = 1;
      }
    }
  }
  return mask;
}

export function buildWorldMap({ classes, classInfo, canopy, buildings = null }) {
  const nx = classInfo.nx, nz = classInfo.nz;
  const wantX = Math.round(WORLD.width / CLASS_CELL) + 1, wantZ = Math.round(WORLD.depth / CLASS_CELL) + 1;
  if (nx !== wantX || nz !== wantZ) {
    throw new Error(`class raster is ${nx}x${nz}, expected ${wantX}x${wantZ}`);
  }
  const cover = new Uint8Array(nx * nz * 4);
  const coverGpu = new Uint8Array(nx * nz * 4);          // the same, with the urban weight scaled by how built-up the place is (the ground shader reads this)
  const density = buildings ? builtDensity(buildings, nx, nz) : null;
  const near = buildings ? builtCover(buildings, nx, nz, NEAR_RADIUS) : null;
  const squares = pavedSquareMask(nx, nz);
  // the dense rule, grown by one cell: a wide street through the dense centre has a lower density on its own cells (the window is centred on the
  // carriageway), and the GPU's bilinear filter would carry that dip as a lawn up to the kerb.  The road is painted over the cells anyway.
  const dense = new Float32Array(nx * nz);
  if (density) {
    const [cx0, cz0, cx1, cz1] = DENSE_CENTRE.map((v) => Math.round(v / CLASS_CELL));
    for (let j = Math.max(0, cz0); j <= Math.min(nz - 1, cz1); j++) {
      for (let i = Math.max(0, cx0); i <= Math.min(nx - 1, cx1); i++) if (classes.data[j * nx + i] === CLASS.urban) dense[j * nx + i] = smooth01(DENSE_FROM, DENSE_FULL, density[j * nx + i]);
    }
  }
  const denseNear = (i, j) => {
    let m = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < nx && jj < nz && dense[jj * nx + ii] > m) m = dense[jj * nx + ii];
    }
    return m;
  };
  const cx = canopy.cover.nx, cz = canopy.cover.nz;
  const can = new Uint8Array(cx * cz * 4);
  const ch = canopy.height, cc = canopy.cover;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const o = (j * nx + i) * 4;
      const cls = classes.data[j * nx + i];
      const open = cls === CLASS.grass || cls === CLASS.park || cls === CLASS.scrub || cls === CLASS.sand;
      cover[o] = open ? 255 : 0;
      cover[o + 1] = cls === CLASS.forest ? 255 : 0;
      cover[o + 2] = cls === CLASS.urban ? 255 : 0;
      cover[o + 3] = cls === CLASS.water ? 255 : 0;
      const square = squares[j * nx + i] === 1;
      coverGpu[o] = square ? 255 : 0; coverGpu[o + 1] = cover[o + 1]; coverGpu[o + 3] = cover[o + 3];
      const d = density ? density[j * nx + i] : 0;
      coverGpu[o + 2] = square ? 255 : density && cls === CLASS.urban
        ? Math.max(urbanLook2(d, near[j * nx + i]), Math.round(255 * denseNear(i, j)))
        : cover[o + 2];
    }
  }
  for (let j = 0; j < cz; j++) {
    for (let i = 0; i < cx; i++) {
      const o = (j * cx + i) * 4;
      const cxi = (i * CLASS_CELL) / 16, czi = (j * CLASS_CELL) / 16;      // the canopy lattice is 16 m, the class one 8 m
      let canopyCover = sampleBilinear(cc, cxi, czi);
      const canopyHeight = sampleBilinear(ch, cxi, czi);
      const cls = classes.data[Math.min(nz - 1, Math.floor((j * 16) / CLASS_CELL)) * nx + Math.min(nx - 1, Math.floor((i * 16) / CLASS_CELL))];
      // The LiDAR sees the buildings as canopy: a roof is 15 m above the ground.  The class map knows what is built,
      // so the roofs and the fields are not trees.
      if (cls === CLASS.urban || cls === CLASS.water || cls === CLASS.farmland) canopyCover = 0;
      else if (cls === CLASS.grass) canopyCover *= 0.3;          // the scattered trees of a meadow
      can[o] = byte(canopyCover);
      can[o + 1] = byte(canopyHeight / CANOPY_MAX);
      can[o + 2] = cls === CLASS.park ? 255 : cls === CLASS.scrub ? 128 : 0;
      can[o + 3] = cls === CLASS.farmland ? 255 : 0;
    }
  }
  return { nx, nz, cover, coverGpu, density, canopy: can, canopyNx: cx, canopyNz: cz, classData: classes.data };
}

/** CPU sample of the maps (bilinear on the cell grid): { open, forest, urban, water, cover, height, park, farm }. */
export function sampleWorldMap(map, x, z, out) {
  const fx = Math.min(map.nx - 1.001, Math.max(0, x / CLASS_CELL - 0.5)), fz = Math.min(map.nz - 1.001, Math.max(0, z / CLASS_CELL - 0.5));
  const i = Math.floor(fx), j = Math.floor(fz);
  const o = (j * map.nx + i) * 4;
  const tx = fx - i, tz = fz - j;
  const lerp = (arr, c) => (arr[o + c] * (1 - tx) + arr[o + 4 + c] * tx) * (1 - tz) + (arr[o + map.nx * 4 + c] * (1 - tx) + arr[o + map.nx * 4 + 4 + c] * tx) * tz;
  out.open = lerp(map.cover, 0) / 255; out.forest = lerp(map.cover, 1) / 255;
  out.urban = lerp(map.cover, 2) / 255; out.water = lerp(map.cover, 3) / 255;
  const gx = Math.min(map.canopyNx - 1.001, Math.max(0, x / 16 - 0.5)), gz = Math.min(map.canopyNz - 1.001, Math.max(0, z / 16 - 0.5));
  const gi = Math.floor(gx), gj = Math.floor(gz);
  const go = (gj * map.canopyNx + gi) * 4;
  const gtx = gx - gi, gtz = gz - gj;
  const glerp = (c) => (map.canopy[go + c] * (1 - gtx) + map.canopy[go + 4 + c] * gtx) * (1 - gtz) + (map.canopy[go + map.canopyNx * 4 + c] * (1 - gtx) + map.canopy[go + map.canopyNx * 4 + 4 + c] * gtx) * gtz;
  out.cover = glerp(0) / 255; out.height = glerp(1) / 255 * CANOPY_MAX;
  out.park = glerp(2) / 255; out.farm = glerp(3) / 255;
  return out;
}

/** The class of the 8 m cell under (x, z) (nearest cell, no blending). */
export function sampleClass(map, x, z) {
  const i = Math.min(map.nx - 1, Math.max(0, Math.floor(x / CLASS_CELL)));
  const j = Math.min(map.nz - 1, Math.max(0, Math.floor(z / CLASS_CELL)));
  return map.classData[j * map.nx + i];
}

/** How built-up the place is (0 .. about 0.4, the share of the 72 m neighbourhood that the buildings cover); 0 when the map has no buildings. */
export function sampleDensity(map, x, z) {
  if (!map.density) return 0;
  const i = Math.min(map.nx - 1, Math.max(0, Math.floor(x / CLASS_CELL)));
  const j = Math.min(map.nz - 1, Math.max(0, Math.floor(z / CLASS_CELL)));
  return map.density[j * map.nx + i];
}
