/* The land cover of Lux Drive: the class raster (8 m) and the canopy (16 m) as the rasters the ground shader and the
 * trees read.
 *
 *   cover  R the open land (grass, parks, scrub)  G the forest  B the built-up city  A the water
 *   canopy R the canopy cover 0..1  G the canopy height / 45 m  B the parks and the heath  A the farmland
 *
 * The weights are stored as weights (not as a class id) because the GPU filters them bilinearly: the border between a
 * wood and a meadow is then a soft line, not a staircase.  Pure data code (no THREE): the browser uploads both as
 * textures, the tree placement samples them on the CPU. */
import { WORLD } from './config.js';
import { sampleBilinear } from './base-field.js';

export const CLASS_CELL = 8;
export const CLASS = Object.freeze({ grass: 0, forest: 1, water: 2, park: 3, urban: 4, farmland: 5, sand: 6, scrub: 7 });
const CANOPY_MAX = 45;
const byte = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);

/**
 * classes: { nx, nz, data } of the class raster, classInfo: its metadata, canopy: { height, cover } of the two
 * canopy grids (16 m nodes, the same origin as the terrain).
 */
export function buildWorldMap({ classes, classInfo, canopy }) {
  const nx = classInfo.nx, nz = classInfo.nz;
  const wantX = Math.round(WORLD.width / CLASS_CELL) + 1, wantZ = Math.round(WORLD.depth / CLASS_CELL) + 1;
  if (nx !== wantX || nz !== wantZ) {
    throw new Error(`class raster is ${nx}x${nz}, expected ${wantX}x${wantZ}`);
  }
  const cover = new Uint8Array(nx * nz * 4);
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
  return { nx, nz, cover, canopy: can, canopyNx: cx, canopyNz: cz, classData: classes.data };
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
