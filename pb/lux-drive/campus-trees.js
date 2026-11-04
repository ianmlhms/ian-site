/* The trees of Campus Geesseknäppchen, added to the baked trees of the game (world-data.js): the game's own woods come from the canopy of forest
 * areas and its baked trees are the street trees, so the campus park had none.  Data: campus-trees-data.js (scripts/luxdrive/campus_trees.py). */
import { CAMPUS_TREES } from './campus-trees-data.js';

/** The baked trees of the game plus those of the campus (new objects, the input is not touched). */
export function withCampusTrees(trees) {
  return trees.concat(CAMPUS_TREES.map(([x, z, height, kind, girth]) => ({ x, z, height, kind, girth: girth / 100, inStreet: false })));
}
