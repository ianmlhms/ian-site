/* drive12 (QA3 N3-B01): the height rule of every collider of the car.  A thing stops the car only where the car's body overlaps it in height: the houses of
 * Pfaffenthal 60 m under the Pont Rouge stopped the car on the deck, because a footprint was a wall from the centre of the earth to the sky.
 * Pure (no THREE). */

export const LEVEL = Object.freeze({
  bodyHeight: 1.6,         // m: the car's body from the level of its wheels to its roof (CAR.rideHeight 0.42 + a 1.2 m body)
});

/**
 * True when a car whose wheels are at level y overlaps a thing that stands from `bottom` to `top` (m).  y NaN (a caller without a level: the placement of lamps,
 * trees and benches, a probe): every height counts, as before drive12.
 */
export function spansLevel(y, bottom, top) {
  if (!Number.isFinite(y)) return true;
  return y < top && y + LEVEL.bodyHeight > bottom;
}
