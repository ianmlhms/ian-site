/* Schueberfouer Tycoon, W2: the two coordinate frames (DESIGN 4.1) and the conversions between them.
 *
 *   Luxtram local  (x east, z SOUTH, metres from 49.6055 N / 6.164 E)  - what the baked LiDAR / ground / facade data is in.
 *   Game frame     (u along the tram toward NE, w toward Boulevard de la Foire, SE; y up)  - what pitches.json, the camera and
 *                  every later model use.  Anchor lat 49.6167784 / lon 6.1237435 = (u 140, w 62), yaw -0.7335 rad.
 *
 * Scene layout: scene > worldRoot (local frame, rotated by -YAW and shifted, carries terrain, ground, buildings, trees, landmarks,
 * tram, stops) and scene > gameRoot (game frame, unrotated: pitch markers, attractions, crowds).  Height: y = LiDAR metres - oy in both. */
export const YAW = 0.7335;
export const COS = Math.cos(YAW);
export const SIN = Math.sin(YAW);
export const ANCHOR_U = 140;
export const ANCHOR_W = 62;

/** frame = bundle.header.frame; returns converters bound to the anchor in local metres. */
export function makeFrame(frame) {
  const [ax, az] = frame.anchorLocal;
  // game (u, w) from local (x, z):  e = x - ax, n = -(z - az);  u = U + COS*e + SIN*n;  w = W + SIN*e - COS*n
  const toGame = (x, z) => {
    const e = x - ax; const n = -(z - az);
    return [ANCHOR_U + COS * e + SIN * n, ANCHOR_W + SIN * e - COS * n];
  };
  const toLocal = (u, w) => {
    const a = u - ANCHOR_U; const b = w - ANCHOR_W;      // a = COS e + SIN n, b = SIN e - COS n
    const e = COS * a + SIN * b; const n = SIN * a - COS * b;
    return [ax + e, az - n];
  };
  // world root: three.js rotation.y = -YAW maps local (x, z) -> (COS x - SIN z, SIN x + COS z) = game offsets; position puts the anchor at (U, W)
  const rootPos = [ANCHOR_U - (COS * ax - SIN * az), ANCHOR_W - (SIN * ax + COS * az)];
  return { toGame, toLocal, rootPos, rotY: -YAW, anchorLocal: [ax, az] };
}
