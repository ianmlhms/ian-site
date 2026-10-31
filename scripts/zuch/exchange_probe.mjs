/* How long does the REAL passenger module (passengers.js) need for one door cycle?  Stands the train at a few stops of a route, runs startExchange with a synthetic clock
 * (__tsTest.exchangeSeconds) for a grid of counts and prints the seconds, so the timetable's dwell model can be fitted to it.
 *   node scripts/zuch/exchange_probe.mjs [--root <repo>] [--train railcar] [--stops 3] route
 * Output: one line per (alighting, boarding) with mean / min / max seconds of `reps` runs, from the first door-open to the last person aboard. */
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const root = flag('root', undefined); const trainId = flag('train', 'railcar'); const stopsWanted = Number(flag('stops', '2'));
const reps = Number(flag('reps', '5'));
const GRID = [[0, 6], [6, 6], [10, 12], [15, 25], [25, 25], [40, 40], [60, 50], [100, 60], [150, 80]];
const quality = flag('quality', 'low');
const sim = await openSim({ quality, root });
try {
  for (const id of args.length ? args : ['west']) {
    await sim.start(id, trainId, { lazy: true });
    const n = await sim.page.evaluate(() => __tsTest.trackInfo().stations.length);
    const picks = [...new Set(Array.from({ length: stopsWanted }, (_, k) => 1 + Math.floor((k * (n - 2)) / Math.max(1, stopsWanted))))].filter((i) => i > 0 && i < n - 1);
    for (const idx of picks) {
      await sim.page.evaluate((i) => { __tsTest.teleport(i); __tsTest.stopAtMarker(-0.8); }, idx);
      await sim.frames(8);
      for (const [a, b] of GRID) {
        const secs = []; let doors = 0;
        for (let k = 0; k < reps; k++) { const r = await sim.page.evaluate(([a, b]) => __tsTest.exchangeSeconds(a, b), [a, b]); secs.push(r.sec); doors = r.doors; }
        const mean = secs.reduce((x, y) => x + y, 0) / secs.length;
        console.log(JSON.stringify({ route: id, train: trainId, stop: idx, alighting: a, boarding: b, doors, mean: +mean.toFixed(1), min: Math.min(...secs), max: Math.max(...secs) }));
      }
    }
  }
} finally { await sim.close(); }
