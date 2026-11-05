/* The lane markings on the bridge decks: the pieces of the marking plan (markings.js) that lie on a deck, laid as strips of paint on the deck's asphalt.  They are the SAME tracks as
 * the lines of the road before and after the bridge (one offset, one dash rhythm along the carriageway), so the lines of the road run on onto the deck without a jog (QA M02).
 * The deck view (deck-view.js) draws no lane lines of its own any more.  One mesh per chunk (chunked-flat.js), built once. */
import { createChunkedFlat } from './chunked-flat.js';
import { MARK, deckMarkingQuads } from './markings.js';

const COLOUR_PAINT = [0.84, 0.83, 0.76];       // (the paint of the ground shader and of the decks)

/** Returns { meshes, count, update(x, z, radius) }. */
export function createDeckMarkingView({ scene, plan, material }) {
  const chunks = createChunkedFlat({ scene, material, name: 'luxdrive-deck-marks' });
  const q = deckMarkingQuads(plan);
  const h = MARK.lineHalf;
  for (let k = 0; k < q.length; k += 8) {
    const ax = q[k], ay = q[k + 1], az = q[k + 2], bx = q[k + 3], by = q[k + 4], bz = q[k + 5];
    const l = Math.hypot(q[k + 6], q[k + 7]) || 1;
    const nx = (q[k + 6] / l) * h, nz = (q[k + 7] / l) * h;
    // (wound like the deck's own strips: from the + side to the - side of the normal)
    chunks.builderAt((ax + bx) / 2, (az + bz) / 2).quad([ax + nx, ay, az + nz], [bx + nx, by, bz + nz], [bx - nx, by, bz - nz], [ax - nx, ay, az - nz], COLOUR_PAINT);
  }
  chunks.finish();
  return { meshes: chunks.meshes, count: q.length / 8, update: chunks.update };
}
