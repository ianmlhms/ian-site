/* A scripted driver on the game's own simulation (no rendering, no shell): can a normal driver keep the timetable of a route, and how long does he stand at a stop AFTER the
 * passengers are done?
 *   node scripts/zuch/drive_bot.mjs [--root <repo>] [--train railcar] [--share 0.9,0.97] [--leave exact|free|early:<s>] [--table] [--md] [--seed 7] [route ...]
 * The bot accelerates at full power, keeps `share` x the line limit, brakes along a 0.45 x service-brake curve to every stop and to every lower limit, opens the doors one second
 * after it stands, closes them one second after the exchange is finished and leaves as soon as the rules allow it:
 *   --leave exact      the scheduled departure time (what the HUD printed before the timing rework)
 *   --leave early:<s>  <s> seconds before the scheduled departure time
 *   --leave free       the sim's own departFreeSec (the rework's "clear to depart"); falls back to exact on a sim without it  (default)
 * The exchange takes as long as the REAL passenger module needs (passengers.js, measured with exchange_probe.mjs on medium quality): EXCHANGE_FIT below is that fit, with a
 * +-15 % random spread. It is deliberately a SEPARATE copy of the fit sim.js uses for the timetable, so a wrong timetable model shows up here. Counts are drawn like train-sim.js'
 * planFor / beginExchange (boarding by station size x capacity, alighting 22 - 55 %).
 * Per stop: late = door-open press minus scheduled arrival; exch = exchange seconds; wait = seconds from "doors closed" until the train starts to move (the boring part);
 * dwellSched = scheduled departure minus scheduled arrival.  Summary per route: median / max wait, worst lateness, early departures. */
import { openSim } from './zlib.mjs';
import { driveService, summarize } from './bot_lib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (n) => { const i = args.indexOf('--' + n); if (i < 0) return false; args.splice(i, 1); return true; };
const root = flag('root', undefined); const trainFlag = flag('train', ''); const shares = flag('share', '0.9').split(',').map(Number);
const dumpFile = flag('dump', ''); const leave = flag('leave', 'free'); const seedArg = Number(flag('seed', '7')); const table = bool('table'); const md = bool('md');
const ROUTES = {
  west: ['railcar', 'emu'], south: ['railcar', 'emu'], north: ['railcar', 'emu'], east: ['railcar', 'emu'], wittlich: ['railcar', 'emu'], trier: ['railcar', 'emu'],
  metz: ['kiss'], brussels: ['kiss'], paris: ['hst'],
  'luxtram-kierchbierg': ['tram'], 'luxtram-stad': ['tram'], 'luxtram-sud': ['tram'], luxtram: ['tram'],
};
const wanted = args.length ? args : Object.keys(ROUTES);
const runs = []; for (const id of wanted) for (const tr of trainFlag ? [trainFlag] : ROUTES[id] || ['railcar']) runs.push([id, tr]);

const sim = await openSim({ quality: 'low', root });
const out = []; const dump = [];
try {
  for (const [id, trainId] of runs) for (const share of shares) {
    await sim.start(id, trainId, { lazy: true });
    const res = await driveService(sim.page, { share, leave, seed: seedArg });
    if (!res.finished) console.log('NOT FINISHED ' + JSON.stringify(res.dbg));
    const row = { route: id, train: trainId, share, doors: res.doors, ...summarize(res) };
    out.push(row); dump.push({ ...row, rows: res.rows });
    console.log(JSON.stringify(row));
    if (table) console.log(res.rows.map((r) => `${String(r.i).padStart(2)} ${r.name.slice(0, 22).padEnd(22)} late ${String(r.late).padStart(4)}s  leg ${String(r.legBot).padStart(4)}/${String(r.legModel).padStart(4)}s  dwellSched ${String(r.dwellSched).padStart(3)}s  pax ${String(r.alight ?? '').padStart(3)}/${String(r.board ?? '').padStart(3)}  exch ${String(r.exch ?? '').padStart(5)}s  wait ${r.wait ?? '-'}s  err ${r.err}m`).join('\n'));
  }
} finally { await sim.close(); }
if (dumpFile) (await import('node:fs')).writeFileSync(dumpFile, JSON.stringify(dump));
if (md) {
  console.log('\n| route | train | pace | stops | sched min | driven min | median wait | p90 wait | max wait | worst late | end late | late >30 s | early dep |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of out) console.log(`| ${r.route} | ${r.train} | ${Math.round(r.share * 100)} % | ${r.stops} | ${r.scheduledMin} | ${r.minutes} | ${r.medWait} | ${r.p90Wait} | ${r.maxWait} | ${r.worstLate} | ${r.endLate} | ${r.lateOver30} | ${r.early} |`);
}
