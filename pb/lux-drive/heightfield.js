/* THE height function of Lux Drive: height(x, z) = the LiDAR terrain with the road network carved in.
 * It is the single source of truth: the render tiles sample it at their lattice nodes, the physics surface reads the
 * same lattice, the harness evaluates it directly. Defined for every (x, z) of the plane, finite everywhere, continuous.
 *
 * A road is not a ribbon: the ground under the carriageway is mixed towards the road bed (the smoothed terrain along
 * the centre line), so the road follows the land; the kerb is a small ridge at the edge of the carriageway.
 *
 * Two fades matter: a coarse lattice cannot sample a 0.35 m kerb, so the KERB fades out between 1 m and 4 m of node
 * spacing; the PAINT (the colour of the road) fades out later, between 4 m and 16 m, so a distant road is still a road,
 * only a little blurred.  The BATTER (the ground beside the road) is never faded: it is a smooth shape, and the tiles
 * around a road must agree on the height of the ground or the ground tears open where they meet. */
import { QUADTREE, ROAD, GROUND } from './config.js';
import { createBaseField } from './base-field.js';
import { createRoadNetwork } from './road-network.js';
import { fbm } from './noise.js';

const MICRO_SCALE = 3.1;
const MICRO_OCTAVES = 2;

/** The fade of a feature that is exact up to `full` and gone at `fade` (1 .. 0 in between). */
export const fadeOf = (step, full, fade) => (step <= full ? 1 : step >= fade ? 0 : 1 - (step - full) / (fade - full));

export function createHeightField({ near, far, roads, decks = [] }) {
  const base = createBaseField(near, far);
  const network = createRoadNetwork(roads, base.baseHeight, decks);   // (the decks: the level of the bridge a way runs onto)
  const scratch = network.scratch;

  /** The terrain without any road. */
  function groundHeight(x, z) {
    return base.baseHeight(x, z) + GROUND.microAmplitude * fbm(x, z, MICRO_SCALE, MICRO_OCTAVES, 7);
  }

  /** Full height and, through `info`, the road at this point (coverage 0..1, the signed offset from the centre
   *  line, the half width of the carriageway, the outer edge of the pavement, the class and the material of the road). */
  function height(x, z, info) {
    const g = groundHeight(x, z);
    network.carve(x, z, scratch, g);
    const c = scratch.coverage;
    if (info) {
      info.coverage = c; info.lat = scratch.lat; info.hw = scratch.hw; info.a0 = scratch.a0;
      info.kind = scratch.kind; info.road = scratch.road; info.lines = scratch.lines;
      info.lanes = scratch.lanes; info.s = scratch.s; info.surface = scratch.surface;
      info.sdCar = scratch.sdCar; info.sdPave = scratch.sdPave; info.sdMajor = scratch.sdMajor; info.junction = scratch.junction;
    }
    // The ground beside the road is the BATTER (the ramp from the level of the road to the land, never steeper than
    // the slope limit), not a fade of the bed: the ground beside a road may never be a wall, and the real terrain
    // takes over beyond it.  The batter reaches much further than the paint, so it is applied even where nothing is
    // painted: the batter IS the ground wherever no road is near.  Stopping it at the edge of the paint would leave
    // the batter cut off in mid air - the wall the reviewer saw.
    return scratch.band + scratch.kerb;
  }

  /** The height a lattice of spacing `step` should show.  The BATTER (the ground beside the road) is a smooth shape and
   *  it is the same on every lattice: if a coarse lattice dropped it, the tiles around a road would not agree on the
   *  height of the ground, and the ground would tear open where they meet (the slit the reviewer saw).  Only the KERB
   *  (a 0.35 m ridge) is too small for a coarse lattice, so it fades out with the spacing.
   *  `info` (optional) receives the road at this point: the coverage is already scaled by the PAINT fade (the shader
   *  paints with it), the geometry is not (the tile mesh scales it by the mark fade). */
  function heightForStep(x, z, step, info) {
    const kerbK = fadeOf(step, QUADTREE.kerbFullStep, QUADTREE.kerbFadeStep);
    const paintK = fadeOf(step, ROAD.paintFullStep, ROAD.paintFadeStep);
    const g = groundHeight(x, z);
    network.carve(x, z, scratch, g);
    const c = scratch.coverage;
    if (info) {
      info.coverage = c * paintK;
      info.lat = scratch.lat; info.hw = scratch.hw; info.a0 = scratch.a0;
      info.kind = scratch.kind; info.road = scratch.road; info.lines = scratch.lines;
      info.lanes = scratch.lanes; info.s = scratch.s; info.surface = scratch.surface;
      info.sdCar = scratch.sdCar; info.sdPave = scratch.sdPave; info.sdMajor = scratch.sdMajor; info.junction = scratch.junction;
    }
    return scratch.band + scratch.kerb * kerbK;
  }

  return { height, heightForStep, groundHeight, baseHeight: base.baseHeight, network };
}
