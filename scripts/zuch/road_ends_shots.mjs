/* Screenshots of real roads that end next to the rails (the pipeline cuts every real road at ROAD_CLEAR m from the track: roads that really cross the line end there).
 *   node scripts/zuch/road_ends_shots.mjs <routeId> <outDir> [--n 8] [--max-lat 16] [--quality medium] [--root <repo>]
 * Prints one line per example (s, lat, class) and writes <outDir>/<route>-end-NN.png (cab-height view towards the end) and a contact sheet. */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openSim } from './zlib.mjs';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const n = Number(flag('n', '8')); const maxLat = Number(flag('max-lat', '16')); const quality = flag('quality', 'medium'); const root = flag('root', undefined);
const [routeId, outDir] = args;
const PY = '/Users/Ian/Library/Caches/luxtram-work/.venv/bin/python';
const sim = await openSim({ quality, root });
try {
  await sim.start(routeId);
  const ends = await sim.evalGame(({ track }) => {
    const out = [];
    (track.base || track).real.roads.forEach((r) => { [r.p[0], r.p[r.p.length - 1]].forEach((e) => { if (Math.abs(e[1]) < 16) out.push({ s: e[0], lat: e[1], c: r.c }); }); });
    return out;
  });
  const near = ends.filter((e) => Math.abs(e.lat) < maxLat && e.c !== 'track' && e.c !== 'service').sort((a, b) => a.s - b.s);
  const step = Math.max(1, Math.floor(near.length / n));
  const pick = near.filter((_, i) => i % step === 0).slice(0, n);
  const pairs = [];
  for (let i = 0; i < pick.length; i++) {
    const e = pick[i];
    await sim.view({ s: e.s - 45, trainS: e.s - 120, lat: 0, up: 2.9, target: { s: e.s, lat: e.lat, up: 0 }, fov: 70, settle: 30 });
    const f = path.join(outDir, `${routeId}-end-${String(i).padStart(2, '0')}.png`);
    await sim.shot(f);
    pairs.push(`s${Math.round(e.s)} lat${Math.round(e.lat)} ${e.c}=${f}`);
    console.log(routeId, i, Math.round(e.s), Math.round(e.lat), e.c);
  }
  if (pairs.length) execFileSync(PY, [path.join(path.dirname(new URL(import.meta.url).pathname), 'montage.py'), path.join(outDir, `${routeId}-ends-sheet.png`), '--cols', '4', '--w', '480', ...pairs]);
} finally { await sim.close(); }
