/* node scripts/zuch/hole_pose_shot.mjs <route> <s> <lat> <up> <yaw> <pitch> <fov> <out.png>: the hole-detector view (magenta = no ground) of one pose */
import { openSim } from './zlib.mjs';
const [route, s, lat, up, yaw, pitch, fov, out] = process.argv.slice(2);
const sim = await openSim({ quality: 'high', width: Number(process.env.W || 1280), height: Number(process.env.H || 720) });
try {
  await sim.start(route);
  await sim.page.evaluate((ts) => { __tsTest.placeAt(ts, 0); const w = __tsTest.internals().world; w.landscape.warm(ts); }, Number(s));
  await sim.view({ s: Number(s), lat: Number(lat), up: Number(up), yaw: Number(yaw), pitch: Number(pitch), fov: Number(fov) });
  await sim.page.evaluate(() => { const { scene, renderer } = __tsTest.internals(); __tsTest.internals().world.landscape.setHoleMode(true); scene.background = null; renderer.setClearColor(0xff00ff, 1); });
  await sim.frames(3);
  await sim.shot(out);
} finally { await sim.close(); }
