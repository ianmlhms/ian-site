/* node scripts/zuch/hole_scan.mjs <routeIds comma> [--step 150] [--quality high] [--out <dir>] [--root <repo>]
 * Runs the hole detector (hole_lib.mjs) on the routes, prints the findings, saves a screenshot of every flagged render pose to <out>. */
import fs from 'node:fs';
import path from 'node:path';
import { openSim } from './zlib.mjs';
import { scanRoute } from './hole_lib.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf('--' + name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const step = Number(flag('step', '150'));
const quality = flag('quality', 'high');
const out = flag('out', '');
const root = flag('root', undefined);
const routes = (args[0] || 'west').split(',');
const sim = await openSim({ quality, root });
let bad = 0;
try {
  for (const r of routes) {
    const rep = await scanRoute(sim, r, { step, log: console.log });
    console.log(`${r}: ${rep.poses} poses, ${rep.flaggedPoses.length} flagged; ${rep.rays} rays, ${rep.rayFailures.length} failures`);
    rep.rayFailures.slice(0, 12).forEach((f) => console.log('   ray', JSON.stringify(f)));
    bad += rep.flaggedPoses.length + rep.rayFailures.length;
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, `${r}-holes.json`), JSON.stringify(rep, null, 1));
    }
  }
} finally { await sim.close(); }
console.log(bad ? `PROBLEMS: ${bad}` : 'no holes found');
process.exit(bad ? 1 : 0);
