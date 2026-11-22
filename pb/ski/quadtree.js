/* The terrain quadtree (copied from pb/mtb/quadtree.js, the root is now set per resort): which tiles exist around the skier, and which tile lies where.
 * Pure (no THREE). The leaf set is a partition of the plane (inside the view distance): leaves never overlap and never leave a gap. */
import { QUADTREE } from './config.js';

/* Root origin of the tree: set once per resort (setRoot) so the root square is centred on the resort box. Multiples of 80 m keep every
 * level aligned to the 2.5 m lattice. */
const ROOT = { x: -QUADTREE.rootSize / 2, z: -QUADTREE.rootSize / 2 };
export function setRoot(width, depth) {
  ROOT.x = Math.round((width / 2 - QUADTREE.rootSize / 2) / QUADTREE.minSize) * QUADTREE.minSize;
  ROOT.z = Math.round((depth / 2 - QUADTREE.rootSize / 2) / QUADTREE.minSize) * QUADTREE.minSize;
}

const EPS = 1e-3;
export const tileKey = (size, x0, z0) => `${size}:${x0}:${z0}`;

function distToBox(px, pz, x0, z0, size) {
  const dx = Math.max(x0 - px, 0, px - (x0 + size));
  const dz = Math.max(z0 - pz, 0, pz - (z0 + size));
  return Math.hypot(dx, dz);
}

/**
 * select(px, pz, { previous, maxDistance, scale }) -> { leaves: [{ key, x0, z0, size, step }], split: Set<key> }
 *  scale < 1 makes the tiles beyond `protect` (QUADTREE.protectedSize; R8d: quality.protect, Niddreg 160) coarser (quality low), > 1 finer; the skier's 80 m tiles are never coarsened.   previous = the split set of the last call (hysteresis).
 */
export function selectTiles(px, pz, { previous = null, maxDistance = 11000, scale = 1, protect = QUADTREE.protectedSize } = {}) {
  const leaves = [];
  const split = new Set();
  function visit(x0, z0, size) {
    const dist = distToBox(px, pz, x0, z0, size);
    if (dist > maxDistance) return;                                   // beyond the fog: no tile (never visible)
    const key = tileKey(size, x0, z0);
    let wantSplit = size > QUADTREE.minSize && (dist < size * QUADTREE.splitFactor * (size > protect ? scale : 1) * (previous && previous.has(key) ? 1 + QUADTREE.splitHysteresis : 1 - QUADTREE.splitHysteresis));
    if (size <= QUADTREE.minSize) wantSplit = false;
    if (wantSplit) {
      split.add(key);
      const h = size / 2;
      visit(x0, z0, h); visit(x0 + h, z0, h); visit(x0, z0 + h, h); visit(x0 + h, z0 + h, h);
    } else {
      leaves.push({ key, x0, z0, size, step: size / QUADTREE.cells });
    }
  }
  visit(ROOT.x, ROOT.z, QUADTREE.rootSize);
  return { leaves, split };
}

/** The leaf containing (x, z) (boundary points belong to the leaf on their +x / +z side), or null outside the selected area. */
export function leafAt(split, x, z) {
  let size = QUADTREE.rootSize, x0 = ROOT.x, z0 = ROOT.z;
  if (x < x0 || z < z0 || x >= x0 + size || z >= z0 + size) return null;
  for (;;) {
    const key = tileKey(size, x0, z0);
    if (!split.has(key)) return { key, x0, z0, size, step: size / QUADTREE.cells };
    const h = size / 2;
    if (x >= x0 + h) x0 += h;
    if (z >= z0 + h) z0 += h;
    size = h;
  }
}

/** Tiles that touch the point p (up to four), without duplicates. Skips tiles that are not part of the selection (null). */
export function tilesTouching(split, x, z) {
  const found = [];
  for (const [dx, dz] of [[-EPS, -EPS], [EPS, -EPS], [-EPS, EPS], [EPS, EPS]]) {
    const leaf = leafAt(split, x + dx, z + dz);
    if (leaf && !found.some((f) => f.key === leaf.key)) found.push(leaf);
  }
  return found;
}
