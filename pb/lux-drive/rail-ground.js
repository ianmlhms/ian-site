/* The level of the Luxtram's rails (moved out of tram-view.js in drive12 so that pure code - the car's collision with a tram - reads the same level as the view).
 * Pure (no THREE). */
import { DECK } from './decks.js';

/** The ground the tram runs on: the terrain, or the deck of a bridge that CARRIES the track.  A deck carries the track when it runs
 *  along it (the Pont Rouge, the viaducts); a deck that crosses over the track at an angle is a bridge the tram runs UNDER, and the
 *  ground stays the ground there.  (Telling them apart by the direction needs no memory of the height before: a chunk of track
 *  can be built on its own.)  (tx, tz) is the direction of the track at the point. */
const ALIGNED = 0.42;                   // sine of the largest angle (25 degrees) between a deck and the track it carries
export function createRailGround(surface, deckNetwork) {
  const scratch = { top: 0, slope: 0, ux: 1, uz: 0, along: 0 };
  return (x, z, tx, tz) => {
    const g = surface.height(x, z);
    if (!deckNetwork || deckNetwork.count === 0) return g;
    let y = 1e9;
    for (let k = 0; k < 3; k++) {                  // the highest deck first, then the ones below it
      const hit = deckNetwork.deckAt(x, z, y, scratch);
      if (!hit) break;
      if (Math.abs(hit.ux * tz - hit.uz * tx) < ALIGNED) return hit.top > g ? hit.top : g;
      y = hit.top - DECK.stickBelow - 0.01;
    }
    return g;
  };
}

