/* What a route downloads at the start of a service (clean browser cache): node scripts/zuch/download_probe.mjs <routeId> [more ids] [--quality medium]
 * Prints raw (decoded) and gzip bytes of data/real + data/stations, split into the cores of the station patches, the first two scenery halves (waited for before the start) and the
 * halves that stream in afterwards.  gzip = what a compressing server sends (computed from the files). */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const qi = args.indexOf('--quality'); const quality = qi >= 0 ? args.splice(qi, 2)[1] : 'medium';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const gz = (url) => { try { return zlib.gzipSync(fs.readFileSync(path.join(REPO, new URL(url).pathname)), { level: 6 }).length; } catch { return 0; } };
for (const id of args) {
  const sim = await openSim({ quality });
  try {
    await sim.page.evaluate(() => performance.clearResourceTimings());
    await sim.start(id, 'emu', { lazy: true });
    await sim.frames(30);
    const res = await sim.page.evaluate(() => performance.getEntriesByType('resource').map((e) => ({ name: e.name, decoded: e.decodedBodySize || e.encodedBodySize || 0, t: e.startTime })));
    const pick = (re) => res.filter((e) => re.test(e.name)).sort((a, b) => a.t - b.t).map((e) => ({ raw: e.decoded, gz: gz(e.name) }));
    const sum = (l, k) => l.reduce((t, e) => t + e[k], 0);
    const cores = pick(/\/stations\/.*\.c\.json/); const heavy = pick(/\/stations\/.*\.h\.json/); const real = pick(/\/data\/real\//); const idx = pick(/\/stations\/index/);
    const first2 = heavy.slice(0, 1); const later = heavy.slice(2);
    const blockRaw = sum(cores, 'raw') + sum(real, 'raw') + sum(idx, 'raw') + sum(first2, 'raw'); const blockGz = sum(cores, 'gz') + sum(real, 'gz') + sum(idx, 'gz') + sum(first2, 'gz');
    console.log(JSON.stringify({ route: id, blockingRawMB: +(blockRaw / 1048576).toFixed(2), blockingGzMB: +(blockGz / 1048576).toFixed(2),
      cores: { n: cores.length, rawkB: Math.round(sum(cores, 'raw') / 1024), gzkB: Math.round(sum(cores, 'gz') / 1024) }, realData: { rawkB: Math.round(sum(real, 'raw') / 1024), gzkB: Math.round(sum(real, 'gz') / 1024) },
      firstHalf: { rawkB: Math.round(sum(first2, 'raw') / 1024), gzkB: Math.round(sum(first2, 'gz') / 1024) }, streamedNext: { n: later.length, rawkB: Math.round(sum(later, 'raw') / 1024), gzkB: Math.round(sum(later, 'gz') / 1024) } }));
  } finally { await sim.close(); }
}
