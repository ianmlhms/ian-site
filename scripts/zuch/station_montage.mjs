/* One command per station: same-viewpoint "photo | sim" montage.
 *   node scripts/zuch/station_montage.mjs <views.json> <outDir> [--tag v1] [--quality high]
 * views.json: { "route": "wittlich", "station": "Roodt-Syr", "refs": "Roodt", "views": [ { "photo": "file.jpg", "pos": [x, z, up], "look": [x, z, up], "fov": 60, "note": "..." } ] }
 *   pos / look are in the station patch frame: x = metres to the right of the main track (+ right of travel), z = metres along the platform (ahead = negative, 0 = the
 *   middle of the platform), up = metres above the rail head.  The sim camera is placed there with the train parked 160 m before the station.
 * Writes <outDir>/<key>-<tag>-<n>.png (sim screenshots) and <outDir>/<key>-<tag>-montage.png (photo | sim rows). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf('--' + name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const tag = flag('tag', 'v1');
const quality = flag('quality', 'high');
const [viewsFile, outDir] = args;
const spec = JSON.parse(fs.readFileSync(viewsFile, 'utf8'));
const key = spec.station.replace(/[^A-Za-z0-9]+/g, '_');
fs.mkdirSync(outDir, { recursive: true });
const sim = await openSim({ quality });
try {
  await sim.start(spec.route);
  const st = await sim.evalGame(({ track }, name) => {
    const i = track.stations.findIndex((s) => s.name === name);
    const s = track.stations[i];
    return { i, mid: (s.platformStart + s.platformEnd) / 2 };
  }, spec.station);
  if (st.i < 0) throw new Error('station not found: ' + spec.station);
  const pairs = [];
  for (let n = 0; n < spec.views.length; n++) {
    const v = spec.views[n];
    const shot = path.join(outDir, `${key}-${tag}-${n}.png`);
    const [px, pz, pu] = v.pos; const [lx, lz, lu] = v.look;
    await sim.view({ s: st.mid - pz, lat: px, up: pu, target: { s: st.mid - lz, lat: lx, up: lu }, fov: v.fov || 60, trainS: st.mid - 170, settle: 30 });
    await sim.shot(shot);
    const photo = path.join(os.homedir(), 'Library/Caches/zuch-refs', spec.refs, v.photo);
    pairs.push(`photo ${n}=${photo}`, `sim ${n}${v.note ? ' ' + v.note : ''}=${shot}`);
  }
  const py = process.env.ZUCH_PY || (fs.existsSync('/Users/Ian/Library/Caches/luxtram-work/.venv/bin/python') ? '/Users/Ian/Library/Caches/luxtram-work/.venv/bin/python' : 'python3');
  const out = path.join(outDir, `${key}-${tag}-montage.png`);
  execFileSync(py, [path.join(path.dirname(new URL(import.meta.url).pathname), 'montage.py'), out, '--cols', '2', '--w', '800', ...pairs]);
  console.log('montage', out, 'errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 4));
} finally { await sim.close(); }
