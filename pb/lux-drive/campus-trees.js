/* The trees of Campus Geesseknäppchen, added to the baked trees of the game (world-data.js): the game's own woods come from the canopy of forest
 * areas and its baked trees are the street trees, so the campus park had none.  Data: campus-trees-data.js (scripts/luxdrive/campus_trees.py).
 * Kinds 0 and 1 (beech, oak) are the game's own tree models; the ornamental species (4 birch, 5 orange-leaved) are modelled by the campus
 * itself (campus-props.js), the game's tree view does not know them. */
import { CAMPUS_TREES } from './campus-trees-data.js';

const FIRST_CAMPUS_SPECIES = 4;

/** The baked trees of the game plus those of the campus (new objects, the input is not touched). */
export function withCampusTrees(trees) {
  return trees.concat(CAMPUS_TREES.filter((t) => t[3] < FIRST_CAMPUS_SPECIES).map(([x, z, height, kind, girth]) => ({ x, z, height, kind, girth: girth / 100, inStreet: false })));
}

/** The ornamental trees the campus draws itself: [{ x, z, height, kind }]. */
export const campusSpeciesTrees = () => CAMPUS_TREES.filter((t) => t[3] >= FIRST_CAMPUS_SPECIES).map(([x, z, height, kind]) => ({ x, z, height, kind }));
