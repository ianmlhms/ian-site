/* Trackside sweep (W5 zroads): for every route two shots per position along the line, in ONE browser session:
 *   aerial   140 m up, looking 120 m ahead (roads, fields, tongues, bends, fences from above)
 *   cab      the cab camera height (3 m), looking along the track and then 50 deg to the right / left alternately (what Ian sees beside the rails)
 *   node scripts/zuch/trackside_sweep.mjs <outDir> [--step 1500] [--quality medium] [--root <repo>] [--sheets] <route ...>     (route ids; <id>~r = return)
 * Writes <outDir>/<route>/{aerial,cab}-<s>.png and (--sheets) 3 x 3 contact sheets <outDir>/<route>-{aerial,cab}-N.png (needs the luxtram venv python). */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (n) => { const i = args.indexOf('--' + n); if (i < 0) return false; args.splice(i, 1); return true; };
const step = Number(flag('step', '1500')); const quality = flag('quality', 'medium'); const root = flag('root', undefined);
const sheets = bool('sheets'); const from = Number(flag('from', '400'));
const [outDir, ...routes] = args;
const PY = '/Users/Ian/Library/Caches/luxtram-work/.venv/bin/python';
const MONTAGE = path.join(path.dirname(new URL(import.meta.url).pathname), 'montage.py');
const UP_AERIAL = 140; const CAB_UP = 3; const SIDE_YAW = 0.9;

const sim = await openSim({ quality, root });
try {
  for (const route of routes) {
    const dir = path.join(outDir, route.replace('~', '_'));
    fs.mkdirSync(dir, { recursive: true });
    await sim.start(route);
    const length = await sim.evalGame(({ track }) => track.length);
    const kinds = { aerial: [], cab: [] };
    let k = 0;
    for (let s = from; s < length - 300; s += step, k++) {
      const tag = String(Math.round(s)).padStart(6, '0');
      await sim.view({ trainS: s, s: s - 60, lat: 0, up: UP_AERIAL, target: { s: s + 120, lat: 0, up: 0 }, fov: 75, settle: 40 });
      const fa = path.join(dir, `aerial-${tag}.png`); await sim.shot(fa); kinds.aerial.push(`${tag}=${fa}`);
      const yaw = k % 3 === 0 ? 0 : (k % 3 === 1 ? -SIDE_YAW : SIDE_YAW);
      await sim.view({ trainS: s - 60, s, lat: 0, up: CAB_UP, yaw, pitch: -0.04, fov: 70, settle: 40 });
      const fc = path.join(dir, `cab-${tag}.png`); await sim.shot(fc); kinds.cab.push(`${tag}${yaw ? (yaw > 0 ? 'L' : 'R') : ''}=${fc}`);
    }
    if (sheets) for (const kind of ['aerial', 'cab']) {
      const list = kinds[kind];
      for (let i = 0, n = 1; i < list.length; i += 9, n++) execFileSync(PY, [MONTAGE, path.join(outDir, `${route.replace('~', '_')}-${kind}-${n}.png`), '--cols', '3', '--w', '640', ...list.slice(i, i + 9)]);
    }
    console.log(route, 'length', Math.round(length), 'positions', k, 'errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 3));
  }
} finally { await sim.close(); }
