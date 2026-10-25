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

export function buildWorldMap({ classes, canopy, near }) {
  const nx = classes.nx, nz = classes.nz;
  if (nx !== WORLD.width / MAP_CELL || nz !== WORLD.depth / MAP_CELL) throw new Error(`class raster is ${nx}x${nz}, expected ${WORLD.width / MAP_CELL}x${WORLD.depth / MAP_CELL}`);
  const cover = new Uint8Array(nx * nz * 4), can = new Uint8Array(nx * nz * 4);
  const ch = canopy.height, cc = canopy.cover;
  const hAt = (i, j) => near.data[Math.min(near.nz - 1, Math.max(0, j * 2)) * near.nx + Math.min(near.nx - 1, Math.max(0, i * 2))];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const o = (j * nx + i) * 4;
      const cls = classes.data[j * nx + i];
      const cx = (i * MAP_CELL) / canopy.step, cz = (j * MAP_CELL) / canopy.step;     // the canopy lattice is 8 m, nodes at multiples of 8 m
      let canopyCover = sampleBilinear(cc, cx, cz);
      const canopyHeight = sampleBilinear(ch, cx, cz);
      if (cls === CLASS.built || cls === CLASS.water || cls === CLASS.farmland) canopyCover = 0;            // roofs and fields are not forest
      else if (cls === CLASS.meadow) canopyCover *= 0.3;
      const h = hAt(i, j);
      let ring = 0;
      for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, 2], [2, -2], [-2, -2]]) ring += hAt(i + dx, j + dz);
      const wet = Math.min(1, Math.max(0, 0.25 + (ring / 8 - h) * 0.28));        // positive concavity: a hollow
      cover[o] = cls === CLASS.meadow ? 255 : cls === CLASS.farmland ? 190 : 0;
      cover[o + 1] = cls === CLASS.built ? 255 : 0;
      cover[o + 2] = cls === CLASS.water ? 255 : 0;
      cover[o + 3] = cls === CLASS.rock ? 255 : 0;
      can[o] = byte(canopyCover); can[o + 1] = byte(canopyHeight / CANOPY_MAX); can[o + 2] = byte(wet); can[o + 3] = cls === CLASS.farmland ? 255 : 0;
    }
  }
  return { nx, nz, cover, canopy: can };
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
