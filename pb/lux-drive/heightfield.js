/* THE height function of Lux Drive: height(x, z) = the LiDAR terrain with the road network carved in.
 * It is the single source of truth: the render tiles sample it at their lattice nodes, the physics surface reads the
 * same lattice, the harness evaluates it directly. Defined for every (x, z) of the plane, finite everywhere, continuous.
 *
 * A road is not a ribbon: the ground under the carriageway is mixed towards the road bed (the smoothed terrain along
 * the centre line), so the road follows the land; the kerb is a small ridge at the edge of the carriageway.
 *
 * Two fades matter: a coarse lattice cannot sample a 0.35 m kerb, so the CARVE (the height of the road) fades out
 * between 1 m and 4 m of node spacing; the PAINT (the colour of the road) fades out later, between 4 m and 16 m, so a
 * distant road is still a road, only a little blurred. */
import { QUADTREE, ROAD, GROUND } from './config.js';
import { createBaseField } from './base-field.js';
import { createRoadNetwork } from './road-network.js';
import { fbm } from './noise.js';

const MICRO_SCALE = 3.1;
const MICRO_OCTAVES = 2;

/** The fade of a feature that is exact up to `full` and gone at `fade` (1 .. 0 in between). */
export const fadeOf = (step, full, fade) => (step <= full ? 1 : step >= fade ? 0 : 1 - (step - full) / (fade - full));

export function createHeightField({ near, far, roads }) {
  const base = createBaseField(near, far);
  const network = createRoadNetwork(roads, base.baseHeight);
  const scratch = network.scratch;

  /** The terrain without any road. */
  function groundHeight(x, z) {
    return base.baseHeight(x, z) + GROUND.microAmplitude * fbm(x, z, MICRO_SCALE, MICRO_OCTAVES, 7);
  }

  /** Full height and, through `info`, the road at this point (coverage 0..1, the signed offset from the centre
   *  line, the half width of the carriageway, the outer edge of the pavement, the class of the road). */
  function height(x, z, info) {
    const g = groundHeight(x, z);
    network.carve(x, z, scratch, g);
    const c = scratch.coverage;
    if (info) {
      info.coverage = c; info.lat = scratch.lat; info.hw = scratch.hw; info.a0 = scratch.a0;
      info.kind = scratch.kind; info.road = scratch.road; info.lines = scratch.lines;
      info.lanes = scratch.lanes; info.s = scratch.s;
    }
    if (c <= 0) return g;
    return g * (1 - c) + scratch.bed * c + scratch.kerb;
  }

  /** The height a lattice of spacing `step` should show: coarse lattices cannot sample a 0.35 m kerb, so the carve
   *  fades out with the spacing.  `info` (optional) receives the road at this point: the coverage is already scaled
   *  by the PAINT fade (the shader paints with it), the geometry is not (the tile mesh scales it by the mark fade). */
  function heightForStep(x, z, step, info) {
    const carveK = fadeOf(step, QUADTREE.carveFullStep, QUADTREE.carveFadeStep);
    const paintK = fadeOf(step, ROAD.paintFullStep, ROAD.paintFadeStep);
    const g = groundHeight(x, z);
    network.carve(x, z, scratch, g);
    const c = scratch.coverage;
    if (info) {
      info.coverage = c * paintK;
      info.lat = scratch.lat; info.hw = scratch.hw; info.a0 = scratch.a0;
      info.kind = scratch.kind; info.road = scratch.road; info.lines = scratch.lines;
      info.lanes = scratch.lanes; info.s = scratch.s;
    }
    const cc = c * carveK;
    if (cc <= 0) return g;
    return g * (1 - cc) + scratch.bed * cc + scratch.kerb * carveK;
  }

  return { height, heightForStep, groundHeight, baseHeight: base.baseHeight, network };
}
