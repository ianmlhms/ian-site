/* Draw calls / triangles of the cab view at given positions (W5 roads2: what do the road overbridges cost?)
 *   node scripts/zuch/draws_at.mjs <route> <s,s,...> [--quality medium] [--root <repo>]    prints draws / triangles per position (train standing at s, cab camera)
 * Compare with another checkout through --root. */
import { openSim } from './zlib.mjs';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const quality = flag('quality', 'medium'); const root = flag('root', undefined);
const [route, list] = args;
const sim = await openSim({ quality, root });
try {
  await sim.start(route);
  for (const s of list.split(',').map(Number)) {
    await sim.viewCab({ s, settle: 40 });
    await sim.frames(10);
    const st = await sim.stats();
    console.log(route, s, 'draws', st.draws, 'triangles', st.triangles);
  }
} finally { await sim.close(); }
