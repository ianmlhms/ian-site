/* The suspension of the DRAWN wheels (look11, QA2 N-C03): the body rests on the mean of the ground under its four wheels and lies on the slope under its middle (car.js),
 * so beside a kerb or on a crest one wheel stood up to 24 cm in the drawn ground and another hung in the air.  Each drawn wheel now moves on its own spring to the
 * ground under it (within the travel of a real suspension); the physics is not touched.  Pure (no THREE): the view and the harness use the same numbers. */

export const WHEEL_TRAVEL = Object.freeze({ bump: 0.14, droop: 0.16, rate: 18 });   // m up into the arch, m down out of it, 1/s the spring follows at

/**
 * The world position of the contact point of a wheel at (lx, 0, lz) in the car's frame: the car stands at (x, y0, z) and is turned as car-model.js turns it
 * (rotation order YZX: yaw = -heading, then pitch about z, then roll about x).
 */
export function wheelContact(x, y0, z, heading, pitch, roll, lx, lz) {
  // Rx(roll)
  const cr = Math.cos(roll), sr = Math.sin(roll);
  let vx = lx, vy = -sr * lz, vz = cr * lz;
  // Rz(pitch)
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const ax = cp * vx - sp * vy, ay = sp * vx + cp * vy;
  vx = ax; vy = ay;
  // Ry(-heading)
  const yaw = -heading, cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const bx = cyw * vx + syw * vz, bz = -syw * vx + cyw * vz;
  return [x + bx, y0 + vy, z + bz];
}

/**
 * The offsets of the four drawn wheels (m along the car's up axis): where the ground under a wheel lies above its contact point the wheel rises into the arch, where it
 * lies below the wheel drops, within WHEEL_TRAVEL.  wheels: [[lx, lz] x 4]; groundAt(x, z).  Returns a new array of four offsets.
 */
export function wheelOffsets(x, y0, z, heading, pitch, roll, wheels, groundAt) {
  return wheels.map(([lx, lz]) => {
    const [wx, wy, wz] = wheelContact(x, y0, z, heading, pitch, roll, lx, lz);
    const d = groundAt(wx, wz) - wy;
    return Math.max(-WHEEL_TRAVEL.droop, Math.min(WHEEL_TRAVEL.bump, d));
  });
}
