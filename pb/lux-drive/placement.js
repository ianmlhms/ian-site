/* Where the car stands after a teleport (a tap on the Kaart) or after "I am stuck": ON the carriageway, in the right-hand
 * lane, facing along the road.
 *
 * The facing is the one of the two directions of the way that is closest to where the car looked before (so the car does
 * not turn round for no reason); on a one-way street it is always the direction of the traffic.
 *
 * `hint` is what `ground.hint()` must be told before the car is put down: a road that rides over the others (a bridge) is
 * set down ON its deck, any other road is set down on the ground, even where a bridge crosses above it. */

const NO_HINT_LIMIT = 1e9;          // m: "the car is far above": every deck counts
const GROUND_HINT_LIFT = 0.5;       // m above the ground: a deck higher than this is over the car, not under it

/**
 * @param {{road, x, z, dx, dz}} hit a result of roadIndex.nearest()
 * @param {number} heading the heading the car had (rad); null/undefined = along the way
 * @param {(x:number, z:number)=>number} groundHeight the height of the bare terrain
 */
export function placeOnRoad(hit, heading, groundHeight) {
  if (!hit || !hit.road) throw new Error('placeOnRoad: no road to put the car on');
  const along = Math.atan2(hit.dz, hit.dx);
  let yaw = along;
  if (!hit.road.oneway && heading !== null && heading !== undefined) {
    const same = Math.cos(heading) * hit.dx + Math.sin(heading) * hit.dz >= 0;
    if (!same) yaw = along + Math.PI;
  }
  // the right-hand lane: the right of the heading is (-sin h, cos h)
  const lane = hit.road.offset || 0;
  const x = hit.x - Math.sin(yaw) * lane;
  const z = hit.z + Math.cos(yaw) * lane;
  const hint = hit.road.over || hit.road.bridge ? NO_HINT_LIMIT : groundHeight(x, z) + GROUND_HINT_LIFT;
  return { x, z, yaw, hint, road: hit.road };
}
