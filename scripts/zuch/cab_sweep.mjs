/* Cab view at every stop of a route (both directions): node scripts/zuch/cab_sweep.mjs <outDir> <route> [route ...]   (route ids; the return direction is <id>~r)
 * Writes <outDir>/<route>/<NN>-<station>.png (the cab 70 m before the platform) and a contact sheet <outDir>/<route>-sheet.png (needs the luxtram venv python). */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openSim } from './zlib.mjs';

const [outDir, ...routes] = process.argv.slice(2);
const PY = '/Users/Ian/Library/Caches/luxtram-work/.venv/bin/python';
const sim = await openSim({ quality: 'high' });
try {
  for (const route of routes) {
    const dir = path.join(outDir, route.replace('~', '_'));
    fs.mkdirSync(dir, { recursive: true });
    await sim.start(route);
    const stations = await sim.evalGame(({ track }) => track.stations.map((s) => ({ name: s.name, ps: s.platformStart, pe: s.platformEnd })));
    const pairs = [];
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      await sim.viewCab({ s: Math.max(5, st.ps - 70), settle: 40 });
      const file = path.join(dir, `${String(i).padStart(2, '0')}-${st.name.replace(/[^A-Za-z0-9]+/g, '_')}.png`);
      await sim.shot(file);
      pairs.push(`${i} ${st.name}=${file}`);
    }
    execFileSync(PY, [path.join(path.dirname(new URL(import.meta.url).pathname), 'montage.py'), path.join(outDir, route.replace('~', '_') + '-sheet.png'), '--cols', '4', '--w', '480', ...pairs]);
    console.log(route, stations.length, 'stops;', 'errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 3));
  }
} finally { await sim.close(); }
