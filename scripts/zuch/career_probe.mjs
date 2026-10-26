/* Career economy of the routes (no driving): expected fare per service from the game's own passenger model (train-sim.js planFor / exchange: boarding by station size, alighting 22 - 55 %,
 * capacity of the train, passenger km along the game track) with career.js' fare formula, per route and train, next to the timetable length and the route price.
 *   node scripts/zuch/career_probe.mjs [--root <repo>] [--train railcar] [route ...]
 * Output: one line per route { stops, km, minutes, passengers, fare (mean base fare of a service), perfect (+25 % punctuality +15 % accuracy), eurPerMin, price, runsToBuy } */
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const root = flag('root', undefined); const trainFlag = flag('train', '');
const TRAIN_FOR = { trier: 'kiss', metz: 'kiss', brussels: 'kiss', paris: 'hst' };   // the cheapest train the route accepts (config.js routeRules.needs); the others take the free railcar
const BOARD_BASE = { 1: 9, 2: 20, 3: 36 }; const ALIGHT = [0.22, 0.55];
const sim = await openSim({ quality: 'low', root });
const routes = args.length ? args : ['west', 'south', 'east', 'wittlich', 'north', 'trier', 'metz', 'brussels', 'paris'];
const rows = [];
try {
  for (const id of routes) {
    const trainId = trainFlag || TRAIN_FOR[id] || 'railcar';
    await sim.start(id, trainId, { lazy: true });
    const d = await sim.page.evaluate(() => {
      const w = __tsTest.internals().world; const t = w.track;
      const rule = (window.TS.config.routeRules || {})[w.routeId] || {};
      return { stops: t.stations.map((s) => ({ s: s.s, size: s.size })), len: t.length, cap: w.cfg.capacity || 90, minutes: w.sim.timetable.total / 60, fareBase: rule.fareBase, price: rule.price, needs: rule.needs };
    });
    // Monte Carlo of the passenger model
    let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const scale = Math.min(2.4, Math.max(1, Math.sqrt(d.cap / 90)));
    const N = 600; let fareSum = 0; let paxSum = 0;
    for (let run = 0; run < N; run++) {
      let onboard = 0; let riders = []; let delivered = 0; let pkm = 0;
      d.stops.forEach((st, i) => {
        const last = i === d.stops.length - 1; const size = BOARD_BASE[st.size] ? st.size : 2;
        let alight = i === 0 ? 0 : last ? onboard : Math.round(onboard * (ALIGHT[0] + (ALIGHT[1] - ALIGHT[0]) * rnd()) * (size === 3 ? 1.2 : size === 1 ? 0.8 : 1));
        alight = Math.min(alight, onboard);
        const room = Math.max(0, d.cap - (onboard - alight));
        const boarding = last ? 0 : Math.min(room, Math.max(2, Math.round(BOARD_BASE[size] * scale * (0.7 + rnd() * 0.7))));
        let rem = alight; riders.forEach((r) => { const take = Math.min(r.n, rem); pkm += (take * Math.max(0, st.s - r.s)) / 1000; r.n -= take; rem -= take; }); riders = riders.filter((r) => r.n > 0);
        if (boarding > 0) riders.push({ n: boarding, s: st.s });
        onboard = onboard - alight + boarding; delivered += alight;
      });
      fareSum += delivered * d.fareBase + pkm * 3; paxSum += delivered;
    }
    const fare = fareSum / N; const perfect = fare * 1.4;
    rows.push({ id, train: trainId, stops: d.stops.length, km: +(d.len / 1000).toFixed(1), minutes: +d.minutes.toFixed(1), passengers: +(paxSum / N).toFixed(0), fareBase: d.fareBase, fare: Math.round(fare), perfect: Math.round(perfect), eurPerMin: +(fare / d.minutes).toFixed(1), price: d.price, runsToBuy: d.price ? +(d.price / fare).toFixed(1) : 0, needs: (d.needs || []).join('/') });
  }
} finally { await sim.close(); }
console.table(rows);
