/* node scripts/zuch/pose_shot.mjs <route> <s> <lat> <up> <yaw> <pitch> <fov> <out.png> [--quality high]: the normal view of one pose (compare with hole_pose_shot.mjs) */
import { openSim } from './zlib.mjs';
const [route, s, lat, up, yaw, pitch, fov, out] = process.argv.slice(2);
const sim = await openSim({ quality: process.env.Q || 'high', width: Number(process.env.W || 1280), height: Number(process.env.H || 720) });
try {
  await sim.start(route);
  await sim.page.evaluate((ts) => { __tsTest.placeAt(ts, 0); const w = __tsTest.internals().world; w.landscape.warm(ts); }, Number(s));
  await sim.view({ s: Number(s), lat: Number(lat), up: Number(up), yaw: Number(yaw), pitch: Number(pitch), fov: Number(fov) });
  await sim.frames(3);
  await sim.shot(out);
} finally { await sim.close(); }
