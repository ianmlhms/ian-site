/* THE height function of the world: height(x, z) = terrain (LiDAR) + micro relief, with the way network carved in.
 * It is the single source of truth: render chunks sample it at their lattice nodes, the physics surface reads the same lattice,
 * the harness evaluates it directly. Defined for every (x, z) of the plane, finite everywhere, continuous. */
import { QUADTREE, SURFACE } from './config.js';
import { createBaseField } from './base-field.js';
import { createTrailNetwork, createCarveScratch } from './trails.js';
import { fbm } from './noise.js';

const MICRO_SCALE = 3.1;
const MICRO_OCTAVES = 2;

export function createHeightField({ near, far, ways }) {
  const base = createBaseField(near, far);
  const network = createTrailNetwork(ways, base.baseHeight);
  const scratch = createCarveScratch();

  function groundHeight(x, z) {
    return base.baseHeight(x, z) + SURFACE.microAmplitude * fbm(x, z, MICRO_SCALE, MICRO_OCTAVES, 7);
  }
  /** Full height and, through `info`, how much the way network shapes this point (coverage 0..1, nearest way index). */
  function height(x, z, info) {
    const g = groundHeight(x, z);
    network.carve(x, z, scratch);
    const c = scratch.coverage;
    if (info) { info.coverage = c; info.way = scratch.way; }
    return c <= 0 ? g : g * (1 - c) + scratch.bed * c;
  }
  /** The height a lattice of spacing `step` should show: coarse lattices cannot sample a 1 m wide path, so the carve fades out with the spacing.
   *  `info` (optional) receives the way coverage at this point (0..1, unscaled). */
  function heightForStep(x, z, step, info) {
    if (step <= QUADTREE.carveFullStep) return height(x, z, info);
    const g = groundHeight(x, z);
    if (step >= QUADTREE.carveFadeStep) {
      if (info) { network.carve(x, z, scratch); info.coverage = scratch.coverage; info.way = scratch.way; }
      return g;
    }
    const k = 1 - (step - QUADTREE.carveFullStep) / (QUADTREE.carveFadeStep - QUADTREE.carveFullStep);
    network.carve(x, z, scratch);
    if (info) { info.coverage = scratch.coverage; info.way = scratch.way; }
    const c = scratch.coverage * k;
    return c <= 0 ? g : g * (1 - c) + scratch.bed * c;
  }
  return { height, heightForStep, groundHeight, baseHeight: base.baseHeight, network };
}
