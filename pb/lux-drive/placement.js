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
export function placeOnRoad(hit, heading, groundHeight, laneShare = 1) {
  if (!hit || !hit.road) throw new Error('placeOnRoad: no road to put the car on');
  const along = Math.atan2(hit.dz, hit.dx);
  let yaw = along;
  if (!hit.road.oneway && heading !== null && heading !== undefined) {
    const same = Math.cos(heading) * hit.dx + Math.sin(heading) * hit.dz >= 0;
    if (!same) yaw = along + Math.PI;
  }
  // the right-hand lane: the right of the heading is (-sin h, cos h)
  const lane = (hit.road.offset || 0) * laneShare;
  const x = hit.x - Math.sin(yaw) * lane;
  const z = hit.z + Math.cos(yaw) * lane;
  const hint = hit.road.over || hit.road.bridge ? NO_HINT_LIMIT : groundHeight(x, z) + GROUND_HINT_LIFT;
  return { x, z, yaw, hint, road: hit.road };
}

const CLEAR_STEP_M = 3;             // m between the candidates along the road
const CLEAR_REACH_M = 60;           // m: how far along the road the search goes
const SNAP_M = 6;                   // m: a candidate is snapped back to the nearest road within this distance

/**
 * placeOnRoad, but never inside something: a road that ends in a tunnel portal, runs through a gap between houses or has a
 * tree at the kerb would put the car into the obstacle (and the collision would push it off the carriageway, off a bridge
 * deck, down a slope).  The candidates go outwards along the road: the tapped point, then 3 m ahead, 3 m back, 6 m ahead ...
 * and the first one where the whole body is clear wins.  When nothing is clear within 60 m the tapped point is used.
 *
 * @param {object} index the road index (nearest)
 * @param {(x:number, z:number, yaw:number, hint:number) => boolean} blocked true when the car at that pose (put down with that height hint) would touch something
 */
export function placeClear(index, hit, heading, groundHeight, blocked) {
  const first = placeOnRoad(hit, heading, groundHeight);
  const poses = (h) => [placeOnRoad(h, heading, groundHeight), placeOnRoad(h, heading, groundHeight, 0)];   // the lane, then the centre line
  for (const p of poses(hit)) if (!blocked(p.x, p.z, p.yaw, p.hint)) return p;
  for (let s = CLEAR_STEP_M; s <= CLEAR_REACH_M; s += CLEAR_STEP_M) {
    for (const sign of [1, -1]) {
      const near = index.nearest(hit.x + hit.dx * s * sign, hit.z + hit.dz * s * sign, SNAP_M);
      if (!near) continue;
      for (const p of poses(near)) if (!blocked(p.x, p.z, p.yaw, p.hint)) return p;
    }
  }
  return first;
}
