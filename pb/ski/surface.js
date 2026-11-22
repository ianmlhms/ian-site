/* The physics surface (pattern of pb/mtb/surface.js): the 2.5 m lattice of field.height(x, z), triangulated with a fixed rule, read by the skier,
 * the camera, the trees and the markers. The LOD 0 render tiles are built from the very same lattice blocks (80 m blocks, apron of one
 * node), so around the skier "what you see" and "what you ski on" are the same numbers. Blocks are cached (LRU) and dropped when a height
 * tile streams in under them (invalidate). Pure: no THREE, no DOM. */
import { QUADTREE, LATTICE } from './config.js';

export const BLOCK = QUADTREE.minSize;                 // 80 m: one LOD 0 tile
const CELLS = QUADTREE.cells;                          // 32 cells of 2.5 m
const APRON = 1;
const SIDE = CELLS + 1 + 2 * APRON;
const MAX_BLOCKS = 420;                 // R8f (memory): 24.5 KB a block; ~30-120 are in use around the skier (was 900)
export const ATTR = 4;                                 // per node: piste, forest, rock, built (see field.attrs)

/** The quad (i, j) of the GLOBAL lattice is split along 00-11 when (i + j) is even, along 10-01 when odd (same rule in the index buffer). */
export const diagonalIsMain = (gi, gj) => (((gi + gj) % 2) + 2) % 2 === 0;

export function createSurface(field) {
  const blocks = new Map();
  const key = (bx, bz) => bx * 100003 + bz;
  const attr = { piste: 0, forest: 0, rock: 0, built: 0, diff: 0, water: 0 };

  function block(bx, bz) {
    const k = key(bx, bz);
    let b = blocks.get(k);
    if (b) { blocks.delete(k); blocks.set(k, b); return b; }
    const h = new Float32Array(SIDE * SIDE);
    const info = new Float32Array(SIDE * SIDE * ATTR);
    const x0 = bx * BLOCK, z0 = bz * BLOCK;
    for (let j = 0; j < SIDE; j++) {
      for (let i = 0; i < SIDE; i++) {
        const x = x0 + (i - APRON) * LATTICE, z = z0 + (j - APRON) * LATTICE;
        const n = j * SIDE + i;
        field.attrs(x, z, attr);
        h[n] = field.heightWith(x, z, attr);
        info[n * ATTR] = attr.piste; info[n * ATTR + 1] = attr.forest; info[n * ATTR + 2] = attr.rock; info[n * ATTR + 3] = attr.water - attr.built;          // water and built-up land hardly overlap: one signed channel interpolates cleanly
      }
    }
    b = { bx, bz, x0, z0, h, info, side: SIDE, apron: APRON };
    blocks.set(k, b);
    if (blocks.size > MAX_BLOCKS) blocks.delete(blocks.keys().next().value);
    return b;
  }

  function cell(x, z) {
    const gx = Math.floor(x / LATTICE), gz = Math.floor(z / LATTICE);
    const fx = x / LATTICE - gx, fz = z / LATTICE - gz;
    const bx = Math.floor(gx / CELLS), bz = Math.floor(gz / CELLS);
    const b = block(bx, bz);
    const i = gx - bx * CELLS + APRON, j = gz - bz * CELLS + APRON;
    const h = b.h, o = j * SIDE + i;
    return { gx, gz, fx, fz, h00: h[o], h10: h[o + 1], h01: h[o + SIDE], h11: h[o + SIDE + 1], b, o };
  }

  /** Height of the triangulated lattice at (x, z); R7-D: on a snow park mesh (kicker, ramp, halfpipe) the park's analytic shape, which
   *  is exactly what that mesh draws (modes/park.js solidAt). */
  const park = field.park && field.park.solidAt ? field.park : null;
  function height(x, z) {
    if (park) { const h = park.solidAt(x, z); if (h === h) return h; }
    const { gx, gz, fx, fz, h00, h10, h01, h11 } = cell(x, z);
    if (diagonalIsMain(gx, gz)) return fx >= fz ? h00 + (h10 - h00) * fx + (h11 - h10) * fz : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
    return fx + fz <= 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /** Smoothed unit normal (central differences over `span` m): the skier reads this so the 2.5 m facets do not kick at every edge. */
  function normal(x, z, out, span = 1.6) {
    const dx = (height(x + span, z) - height(x - span, z)) / (2 * span);
    const dz = (height(x, z + span) - height(x, z - span)) / (2 * span);
    const len = Math.hypot(dx, 1, dz);
    out.x = -dx / len; out.y = 1 / len; out.z = -dz / len;
    return out;
  }

  /** Bilinear read of a node attribute (0 piste, 1 forest, 2 rock, 3 built/water). */
  function info(x, z, channel) {
    const { fx, fz, b, o } = cell(x, z);
    const v = b.info;
    const a = v[o * ATTR + channel], c = v[(o + 1) * ATTR + channel], d = v[(o + SIDE) * ATTR + channel], e = v[(o + SIDE + 1) * ATTR + channel];
    return (a * (1 - fx) + c * fx) * (1 - fz) + (d * (1 - fx) + e * fx) * fz;
  }

  /** Drops every cached block that overlaps the world rectangle (a height tile arrived there). */
  function invalidate(x0, z0, x1, z1) {
    for (const [k, b] of blocks) if (b.x0 <= x1 && b.x0 + BLOCK >= x0 && b.z0 <= z1 && b.z0 + BLOCK >= z0) blocks.delete(k);
  }

  return { height, normal, info, block, invalidate, field, blockCount: () => blocks.size };
}
