/* The painted base of the Kaart: the land class raster (8 m cells) drawn once into a canvas, one pixel per cell.
 * Woods are green, fields pale yellow, the town warm grey, water blue.  The minimap and the full map draw from this one
 * canvas (scaled, so the browser filters it), so the map costs no data file and shows the real woods, fields and rivers. */
import { CLASS, CLASS_CELL } from './world-map.js';

const PALETTE = Object.freeze({
  [CLASS.grass]: [183, 201, 138],
  [CLASS.forest]: [96, 138, 84],
  [CLASS.water]: [126, 176, 208],
  [CLASS.park]: [160, 205, 132],
  [CLASS.urban]: [221, 211, 190],
  [CLASS.farmland]: [230, 222, 174],
  [CLASS.sand]: [232, 217, 168],
  [CLASS.scrub]: [143, 174, 108],
});
const FALLBACK = [200, 200, 190];

/** @returns {{ canvas: HTMLCanvasElement, cell: number }} a canvas of nx x nz pixels; one pixel covers `cell` metres */
export function createBasemap({ nx, nz, classData }) {
  if (classData.length !== nx * nz) throw new Error(`basemap: ${classData.length} cells for a ${nx}x${nz} raster`);
  const canvas = document.createElement('canvas');
  canvas.width = nx; canvas.height = nz;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(nx, nz);
  for (let i = 0; i < classData.length; i++) {
    const c = PALETTE[classData[i]] || FALLBACK;
    const o = i * 4;
    image.data[o] = c[0]; image.data[o + 1] = c[1]; image.data[o + 2] = c[2]; image.data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, cell: CLASS_CELL };
}
