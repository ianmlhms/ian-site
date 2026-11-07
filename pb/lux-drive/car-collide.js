/* Everything that stops the car, in one place (drive12): main.js, the harness and the drive tools build the car's collider from this, so the game and the gates test
 * the very same things.  Every part answers for the car's own level (y: the level of its wheels, the car's state.y - CAR.rideHeight): a house, a tree, a lamp, a
 * wall, a tram or a guard rail stops a car only where the car's body overlaps it in height (level-span.js).  Before drive12 the houses, the trees and the lamps
 * were solid from the ground to the sky and only "is the car on a deck" (the global height hint) switched the trees and lamps off: four Pfaffenthal houses 60 m
 * under the Pont Rouge stopped the car on the deck (QA3 N3-B01), a 23-storey tower and five more blocks under other decks likewise.
 * Pure (no THREE). */
import { TRAM } from './config.js';
import { spansLevel } from './level-span.js';
import { createRailGround } from './rail-ground.js';

export const LAMP_POST_RADIUS = 0.22;     // m: a street lamp (the car stops at it like at a tree)
export const LAMP_POST_HEIGHT = 8;        // m: its pole
export const BENCH_RADIUS = 0.8;          // m: a park bench
export const BENCH_HEIGHT = 0.9;          // m
export const POLE_HEIGHT = TRAM.catenary.height + 1;   // m: a catenary pole of the tram (it stands on the level of the rails)

/**
 * The parts (each a collider of its own, [name, (x, z, radius, y) => hit | null]) and the car's collider: the first part that is hit answers.
 *   buildings: buildings.js index (with groundAt: the houses know their height), landmarks: landmarks.js, walls: wall-collider.js, portals: portals.js,
 *   ground: decks.js createGround (the bank under a deck end), forest: trees.js, props: props.js (lamps, benches, poles with their level), trams: tram-sim.js,
 *   playArea: play-area.js, surface + deckNetwork: the level of the tram's rails, tubes (optional): the drivable tunnels (tunnel-tubes.js createTubeNetwork).
 * Returns { collide(x, z, radius, y), parts }.
 */
export function createCarCollider({ buildings, landmarks, walls, portals, ground, forest, props, trams, playArea, surface = null, deckNetwork = null, tubes = null }) {
  const railGround = surface ? createRailGround(surface, deckNetwork) : null;
  /** A tram: at the level of its rails, as high as the vehicle. */
  const tramHit = (x, z, radius, y) => {
    const hit = trams.collide(x, z, radius);
    if (!hit || !railGround || !Number.isFinite(y)) return hit;
    const rail = railGround(hit.qx, hit.qz, hit.tx, hit.tz);
    return spansLevel(y, rail, rail + TRAM.floor + TRAM.height) ? hit : null;
  };
  const parts = [
    ['building', (x, z, r, y) => buildings.collide(x, z, r, y)],
    ['landmark', (x, z, r, y) => landmarks.collide(x, z, r, y)],
    ['wall', (x, z, r, y) => walls.collide(x, z, r, y)],
    ['portal', (x, z, r, y) => portals.collide(x, z, r, y)],
    ['bank', (x, z, r, y) => ground.bankCollide(x, z, r, y)],          // the bank under a deck end, for a car under the deck (decks.js)
    ['tree', (x, z, r, y) => forest.collide(x, z, r, y)],
    ['prop', (x, z, r, y) => props.collide(x, z, r, y)],
    ['tram', tramHit],
    ['area', (x, z, r) => playArea.collide(x, z, r)],
  ].filter(([name]) => name !== 'tram' || trams);
  // tunnels16: a car (or a lens) inside a tube meets only the tube (its walls, the faces of its portals) and the edge of the world: the houses, the streets, the walls and
  // the trees over it are not at its level.  Outside, the tube's shell and headwalls are one more solid (tunnel-tubes.js collide).
  const tubeParts = tubes ? [['tube', (x, z, r, y) => tubes.collide(x, z, r, y)], parts[parts.length - 1]] : null;
  if (tubes) parts.unshift(['tube', (x, z, r, y) => tubes.collide(x, z, r, y)]);
  function collide(x, z, radius, y = NaN) {
    const list = tubeParts && Number.isFinite(y) && tubes.inside(x, z, y) ? tubeParts : parts;
    for (let i = 0; i < list.length; i++) {
      const hit = list[i][1](x, z, radius, y);
      if (hit) return hit;
    }
    return null;
  }
  return { collide, parts };
}
