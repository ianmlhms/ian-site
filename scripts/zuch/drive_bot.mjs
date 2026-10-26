/* A scripted driver on the game's own simulation (no rendering, no shell): can a careful driver keep the timetable of a route?
 *   node scripts/zuch/drive_bot.mjs [--root <repo>] [--train railcar] [--share 0.97] [route ...]
 * Per route: the lateness at every stop (s) from a run that accelerates at full power, keeps `share` x the line limit, brakes along a 0.6 x service-brake curve to every
 * stop and to every lower limit, opens / closes the doors, waits for the exchange (4 s + 0.6 s per alighting + 0.7 s per boarding passenger of the average plan) and for the
 * scheduled departure.  Prints { stops, minutes, worstLate, endLate, minSlack } and the per-stop table with --table. */
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const root = flag('root', undefined); const trainId = flag('train', 'railcar'); const share = Number(flag('share', '0.97'));
const table = args.includes('--table'); if (table) args.splice(args.indexOf('--table'), 1);
const routes = args.length ? args : ['west', 'south', 'north', 'east', 'wittlich'];
const sim = await openSim({ quality: 'low', root });
try {
  for (const id of routes) {
    await sim.start(id, trainId, { lazy: true });
    const res = await sim.page.evaluate(({ share }) => {
      const { world } = __tsTest.internals(); const sm = world.sim; const tt = sm.timetable; const st = sm.stations;
      const brakeMax = world.cfg.brake || 0.9; const b = 0.45 * brakeMax; const DT = 0.1;
      const pax = Math.round((world.cfg.capacity || 90) * 0.4);
      let s = sm.step(0, { lever: 0, passengers: pax });
      const rows = []; const served = new Set(); let openedAt = -1; let wasOpen = false; let guard = 0; let pending = null; const lastIdx = st.length - 1;
      while (!s.finished && s.t < 3 * 3600 && guard++ < 200000) {
        let lever = -3; let doorPress = false;
        const atPlat = s.v < 0.1 && s.platformIndex >= 0;
        if (s.doorPhase === 'closed') {
          if (atPlat && !served.has(s.platformIndex) && s.platformIndex === s.nextStationIndex) {
            doorPress = true; pending = { i: s.platformIndex, name: st[s.platformIndex].name, late: Math.round(s.t - tt.stops[s.platformIndex].arr), err: +(s.s - st[s.platformIndex].s).toFixed(1) };
          } else if (s.readyToDepart && s.departureWaitSec > 0) lever = -3;
          else if (s.readyToDepart || !atPlat) {
            const limit = (s.limitKmh / 3.6) * share; let vt = limit;
            if (s.nextLimit && (s.nextLimit.kmh / 3.6) * share < limit) { const vn = (s.nextLimit.kmh / 3.6) * share; vt = Math.min(vt, Math.sqrt(vn * vn + 2 * b * Math.max(0, s.nextLimit.distance - 5))); }
            const hs = s.headingStation;
            if (hs && !(sm.isPass && sm.isPass(s.headingIndex))) { const d = Math.max(0, hs.s - s.s - 11); vt = Math.min(vt, Math.sqrt(2 * b * d)); if (d < 2.5) vt = Math.min(vt, 1.0); }
            const e = vt - s.v;
            lever = e > 0.4 ? 5 : e > -0.3 ? 0 : Math.max(-7, Math.round(-1 + e * 1.3));
          }
        } else if (s.doorPhase === 'open') {
          if (openedAt < 0) openedAt = s.t;
          if (s.t - openedAt > 4 + 0.6 * pax * 0.385 + 0.7 * 12 && s.platformIndex < lastIdx) doorPress = true;
        }
        s = sm.step(DT, { lever, passengers: pax, doorPress });
        if (doorPress && pending && s.events.some((e) => e.type === 'doorsOpening')) { served.add(pending.i); openedAt = -1; rows.push(pending); }
        pending = null;
      }
      return { dbg: { phase: s.doorPhase, ready: s.readyToDepart, wait: s.departureWaitSec, v: s.v, ni: s.nextStationIndex, hi: s.headingIndex, dh: s.distanceToHeading, plat: s.platformIndex, lim: s.limitKmh, park: s.parkingBrake, s: s.s }, rows, finished: s.finished, t: s.t, total: tt.total, spads: s.totals.spads, overspeed: Math.round(s.totals.overspeedSec), guard };
    }, { share });
    if (!res.finished) console.log(JSON.stringify(res.dbg));
    const late = res.rows.map((r) => r.late);
    console.log(JSON.stringify({ route: id, train: trainId, stops: res.rows.length + 1, finished: res.finished, minutes: +(res.t / 60).toFixed(1), scheduledMin: +(res.total / 60).toFixed(1), worstLate: Math.max(0, ...late), endLate: late[late.length - 1], earliest: Math.min(0, ...late), overspeedSec: res.overspeed, spads: res.spads }));
    if (table) console.log(res.rows.map((r) => `${r.i} ${r.name} late ${r.late}s err ${r.err}`).join('\n'));
  }
} finally { await sim.close(); }
