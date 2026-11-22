/* R8d: driver body (r8d-drv.py run): window.__spot = { x, z, h, cam: [camX, camZ, above, tx, tz, above2, fov] } -> places the skier there
 * (r8c-helpers.js spot), fixes the camera, returns the stats. A null cam = the chase camera behind the skier. */
const p = window.__spot;
const st = await window.__r8.spot(p.x, p.z, p.h || 0, p.cam || null);
return st;
