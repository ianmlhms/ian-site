/* Undergrowth placement, per 32 m block like the trees (deterministic, pure): ferns, holly, brambles, hedges along the field borders, fallen logs, stumps and roots
 * that cross the trail. Every list is a Float32Array of stride 8: [x, y, z, scale, yaw, seed, stretch, pitch]; the model is scaled by `scale`, stretched along its own
 * x axis by `stretch`, turned by `yaw` about y and tilted by `pitch` about its z axis (logs lie along the slope). Nothing is ever placed on a way. */
import { QUADTREE } from './config.js';
import { createRng, fbm } from './noise.js';
import { sampleWorldMap, sampleFieldCell, MAP_CELL } from './world-map.js';
import { SPECIES, wayFree } from './forest.js';

export const BLOCK = QUADTREE.minSize;
export const U_STRIDE = 8;
const FERN_GRID = 11;                    // candidate cells per side (2.9 m)
const SHRUB_GRID = 4;
const ROOT_PROBE = [2.2, 3.2];           // m from the trunk: where we look for a way
const ROOT_MIN_COVER = 0.3;
const nrm = { x: 0, y: 1, z: 0 };
const scratch = { grass: 0, built: 0, water: 0, rock: 0, cover: 0, height: 0, wet: 0 };
const cell = { field: 0, leaf: 0, hedge: 0 };

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** { ferns, holly, brambles, hedges, logs, stumps, roots } of block (bx, bz). `trees` = the tree list of the same block (roots grow from big trunks next to a way). */
export function undergrowthOfBlock(bx, bz, { map, surface, clearance, trees }) {
  const rng = createRng((bx * 83492791) ^ (bz * 297642901) ^ 0x1b873593);
  const x0 = bx * BLOCK, z0 = bz * BLOCK;
  const lists = { ferns: [], holly: [], brambles: [], hedges: [], logs: [], stumps: [], roots: [] };

  // ---- ferns: in clumps, on moist and shaded forest ground
  const fstep = BLOCK / FERN_GRID;
  for (let j = 0; j < FERN_GRID; j++) {
    for (let i = 0; i < FERN_GRID; i++) {
      const x = x0 + (i + 0.5) * fstep + (rng() - 0.5) * fstep, z = z0 + (j + 0.5) * fstep + (rng() - 0.5) * fstep;
      const roll = rng(), seed = rng(), sizeRoll = rng();
      const m = sampleWorldMap(map, x, z, scratch);
      const forest = m.cover * (1 - m.grass) * (1 - m.built) * (1 - m.water) * (1 - m.rock);
      if (forest < 0.25) continue;
      const clump = smooth(-0.1, 0.45, fbm(x, z, 11, 2, 41)) * (0.45 + 0.9 * m.wet);
      if (roll > clump * forest) continue;
      if (!wayFree(clearance, x, z, 0.9)) continue;
      surface.normal(x, z, nrm);
      if (nrm.y < 0.66) continue;
      lists.ferns.push(x, surface.height(x, z), z, 0.45 + sizeRoll * 0.5, rng() * 6.283, seed, 1, 0);
    }
  }

  // ---- holly in the shade, brambles in the light
  const sstep = BLOCK / SHRUB_GRID;
  for (let j = 0; j < SHRUB_GRID; j++) {
    for (let i = 0; i < SHRUB_GRID; i++) {
      const x = x0 + (i + 0.5) * sstep + (rng() - 0.5) * sstep * 0.8, z = z0 + (j + 0.5) * sstep + (rng() - 0.5) * sstep * 0.8;
      const roll = rng(), seed = rng(), sizeRoll = rng();
      const m = sampleWorldMap(map, x, z, scratch);
      if (m.grass > 0.5 || m.built > 0.3 || m.water > 0.3 || m.rock > 0.5) continue;
      if (!wayFree(clearance, x, z, 2.2)) continue;
      surface.normal(x, z, nrm);
      if (nrm.y < 0.68) continue;
      const patch = smooth(0.0, 0.5, fbm(x, z, 38, 2, 77));
      if (m.cover > 0.55 && roll < 0.5 * patch + 0.1 * m.wet) lists.holly.push(x, surface.height(x, z), z, 1.0 + sizeRoll * 1.1, rng() * 6.283, seed, 1, 0);
      else if (m.cover < 0.6 && m.cover > 0.05 && roll < 0.35 * patch + 0.18) lists.brambles.push(x, surface.height(x, z), z, 1.1 + sizeRoll * 1.0, rng() * 6.283, seed, 1, 0);
    }
  }

  // ---- hedges: one segment per marked 4 m cell of a field border
  const cx0 = Math.floor(x0 / MAP_CELL), cx1 = Math.floor((x0 + BLOCK - 1e-6) / MAP_CELL), cz0 = Math.floor(z0 / MAP_CELL), cz1 = Math.floor((z0 + BLOCK - 1e-6) / MAP_CELL);
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cxx = cx0; cxx <= cx1; cxx++) {
      const x = (cxx + 0.5) * MAP_CELL, z = (cz + 0.5) * MAP_CELL;
      sampleFieldCell(map, x, z, cell);
      if (!cell.hedge) continue;
      const jitter = (rng() - 0.5) * 1.2;
      const hx = cell.hedge === 1 ? x + jitter : x, hz = cell.hedge === 1 ? z : z + jitter;
      if (clearance(hx, hz) > 0.01) continue;
      const s = 1.1 + rng() * 0.5;
      lists.hedges.push(hx, surface.height(hx, hz), hz, s, cell.hedge === 1 ? Math.PI / 2 : 0, rng(), (MAP_CELL + 0.4) / s / 1.1, 0);
    }
  }

  // ---- dead wood
  const wood = smooth(0.2, 0.7, sampleWorldMap(map, x0 + 16, z0 + 16, scratch).cover);
  const logCount = rng() < 0.55 * wood ? 1 + (rng() < 0.3 ? 1 : 0) : 0;
  for (let k = 0; k < logCount; k++) {
    const x = x0 + 3 + rng() * (BLOCK - 6), z = z0 + 3 + rng() * (BLOCK - 6), yaw = rng() * 6.283, len = 2.4 + rng() * 3.4, radius = 0.12 + rng() * 0.12;
    const ax = Math.cos(yaw) * len / 2, az = Math.sin(yaw) * len / 2;
    let blocked = false;
    for (let q = -4; q <= 4; q++) if (clearance(x + ax * q / 4, z + az * q / 4) > 0.01) blocked = true;      // the whole log is clear of every way
    if (blocked) continue;
    const hA = surface.height(x - ax, z - az), hB = surface.height(x + ax, z + az), hM = surface.height(x, z);
    const y = Math.max((hA + hB) / 2, hM) + radius * 0.25;
    const scale = radius / 0.075;
    lists.logs.push(x, y, z, scale, -yaw, rng(), len / scale, Math.atan2(hB - hA, len));
  }
  if (rng() < 0.4 * wood) {
    const x = x0 + 3 + rng() * (BLOCK - 6), z = z0 + 3 + rng() * (BLOCK - 6);
    if (clearance(x, z) <= 0.01) { const m = sampleWorldMap(map, x, z, scratch); if (m.grass < 0.4) lists.stumps.push(x, surface.height(x, z) - 0.05, z, 0.28 + rng() * 0.22, rng() * 6.283, rng(), 0.5 + rng() * 0.5, 0); }
  }

  // ---- roots: a big trunk beside a way sends a root across it
  for (let t = 0; t < trees.length; t += 6) {
    if (trees[t + 4] === SPECIES.sapling || trees[t + 4] === SPECIES.spruce || trees[t + 3] < 14) continue;
    const tx = trees[t], tz = trees[t + 2];
    let bestC = 0, bestA = 0;
    for (let a = 0; a < 8; a++) {
      const ang = a * Math.PI / 4;
      for (const r of ROOT_PROBE) { const c = clearance(tx + Math.cos(ang) * r, tz + Math.sin(ang) * r); if (c > bestC) { bestC = c; bestA = ang; } }
    }
    if (bestC < ROOT_MIN_COVER) continue;
    const rr = createRng(Math.floor(tx * 131 + tz * 17));
    if (rr() > 0.8) continue;
    const radius = 0.045 + rr() * 0.04, len = 2.6 + rr() * 1.2, scale = radius / 0.5;
    const rx = tx + Math.cos(bestA) * trees[t + 3] * 0.012, rz = tz + Math.sin(bestA) * trees[t + 3] * 0.012;
    const ex = rx + Math.cos(bestA) * len, ez = rz + Math.sin(bestA) * len, h0 = surface.height(rx, rz), h1 = surface.height(ex, ez);
    if (Math.abs(h1 - h0) / len > 0.45) continue;                                                // too steep for a root to follow
    const pitch = Math.atan2(h1 - h0, len);                      // the root follows the slope, and goes into the ground at both ends
    lists.roots.push(rx, h0 - 0.04, rz, scale, -bestA, rr(), len / scale, pitch);
  }

  const out = {};
  for (const [k, v] of Object.entries(lists)) out[k] = Float32Array.from(v);
  return out;
}

/** Cached undergrowth blocks. */
export function createUndergrowthIndex({ map, surface, clearance, trees }) {
  const blocks = new Map();
  const LIMIT = 500;
  function block(bx, bz) {
    const key = bx * 100003 + bz;
    let b = blocks.get(key);
    if (!b) {
      b = undergrowthOfBlock(bx, bz, { map, surface, clearance, trees: trees.block(bx, bz) });
      blocks.set(key, b);
      if (blocks.size > LIMIT) blocks.delete(blocks.keys().next().value);
    } else { blocks.delete(key); blocks.set(key, b); }
    return b;
  }
  return { block, blocks };
}
