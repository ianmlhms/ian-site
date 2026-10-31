/* The scripted driver of scripts/zuch/drive_bot.mjs as a library, so the timing flow (scripts/flows/train_sim_timing.mjs) drives with exactly the same bot.
 *   const res = await driveService(page, { share: 0.9, leave: 'free', seed: 7 });     // page: a game page with a service running (zlib.mjs start())
 *   summarize(res) -> { stops, medWait, p90Wait, maxWait, worstLate, endLate, ... }
 * See drive_bot.mjs for what the bot does and how the exchange duration is modelled. */

/* runs in the page: drives the whole running service and returns the per-stop rows */
const botInPage = ({ share, leave, seed }) => {
  const { world } = __tsTest.internals(); const sm = world.sim; const tt = sm.timetable; const st = sm.stations; const cfg = world.cfg;
  const brakeMax = cfg.brake || 0.9; const b = 0.45 * brakeMax; const DT = 0.1; const REACT_S = 1.0; const CAP = cfg.capacity || 90; const lastIdx = st.length - 1;
  let a0 = seed >>> 0; const rnd = () => { a0 |= 0; a0 = a0 + 0x6D2B79F5 | 0; let t = Math.imul(a0 ^ a0 >>> 15, 1 | a0); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  /* ---- the passenger side: counts as train-sim.js draws them, duration = fit of passengers.js ---- */
  const BOARD_BASE = { 1: 9, 2: 20, 3: 36 }; const scale = Math.min(2.4, Math.max(1, Math.sqrt(CAP / 90)));
  const doors = cfg.doorsPerSide * Math.max(1, (cfg.cars || 1) - (cfg.model === 'ic' ? 1 : cfg.model === 'hst' ? 2 : 0)); const lengthM = (cfg.cars || 1) * (cfg.carLength || 20);
  const EXCHANGE_FIT = { base: 2.5, perMetre: 0.02, perPax: 0.05 };
  const truth = (a, bd) => {
    const aD = Math.max(a ? 1 : 0, (1.15 * a) / doors); const tA = a ? Math.max(0.25 * aD, Math.min(16, 0.8 * aD)) : 0;
    const pD = Math.max(1, bd / doors); const tB = pD * Math.min(1.2, Math.max(0.2, 22 / pD)) * 1.05;
    return (EXCHANGE_FIT.base + (a ? tA + 1.6 : 0.6) + tB + EXCHANGE_FIT.perMetre * lengthM + EXCHANGE_FIT.perPax * (a + bd)) * (0.85 + rnd() * 0.3);
  };
  let onboard = 0; const rows = []; const served = new Set(); let guard = 0; let pending = null; let s = sm.step(0, { lever: 0, passengers: 0 });
  let tPress = -1; let closeAt = -1; let stopT = -1; let prevMoveT = 0; let prevIdx = 0; let readyT = -1; let moveT = -1; let phaseSeen = 'closed'; let pendingRow = null;
  const wantFree = () => {
    if (leave === 'exact') return s.departureWaitSec <= 0;
    if (leave.startsWith('early:')) return s.departureWaitSec <= Number(leave.slice(6));
    return Number.isFinite(s.departFreeSec) ? s.departFreeSec <= 0 : s.departureWaitSec <= 0;
  };
  while (!s.finished && s.t < 3 * 3600 && guard++ < 400000) {
    let lever = -3; let doorPress = false;
    const atPlat = s.v < 0.1 && s.platformIndex >= 0;
    if (s.doorPhase === 'closed') {
      if (atPlat && !served.has(s.platformIndex) && s.platformIndex === s.nextStationIndex) {
        if (tPress < 0) { tPress = s.t + REACT_S; stopT = s.t; }
        if (s.t >= tPress) {
          doorPress = true; const i = s.platformIndex;
          pending = { i, name: st[i].name, legBot: Math.round(stopT - prevMoveT), legModel: tt.stops[i].arr - tt.stops[prevIdx].dep, late: Math.round(s.t - tt.stops[i].arr), err: +(s.s - st[i].s).toFixed(1), dwellSched: tt.stops[i].dep - tt.stops[i].arr, pressT: s.t };
        }
      } else if (s.readyToDepart && atPlat && !wantFree()) lever = -3;
      else if (s.readyToDepart || !atPlat) {
        if (s.readyToDepart && moveT < 0 && pendingRow) { moveT = s.t; prevMoveT = s.t; prevIdx = pendingRow.i; pendingRow.wait = +(moveT - pendingRow.readyT).toFixed(1); pendingRow = null; }
        const limit = (s.limitKmh / 3.6) * share; let vt = limit;
        if (s.nextLimit && (s.nextLimit.kmh / 3.6) * share < limit) { const vn = (s.nextLimit.kmh / 3.6) * share; vt = Math.min(vt, Math.sqrt(vn * vn + 2 * b * Math.max(0, s.nextLimit.distance - 5))); }
        const hs = s.headingStation; let aReq = 0;
        if (hs && !(sm.isPass && sm.isPass(s.headingIndex))) {
          const dm = hs.s - s.s - 0.5; const dEff = Math.max(0.2, dm - 0.5 * s.v);   // the brake builds up over ~0.5 s: start that much earlier
          aReq = (s.v * s.v) / (2 * dEff);
          vt = Math.min(vt, Math.sqrt(2 * 0.4 * brakeMax * dEff));
          if (dm > 3) vt = Math.max(vt, Math.min(limit, 1.2)); else if (dm < 0.3) vt = 0;   // creep the last metres, never stop far short of the marker
        }
        const e = vt - s.v;
        lever = e > 0.4 ? 5 : e > -0.3 ? 0 : Math.max(-7, Math.round(-1 + e * 1.3));
        if (vt === 0 && s.v < 1.5) lever = Math.min(lever, -5);                      // hold firmly: a tram on a downhill slides on a light brake
        if (aReq > 0.42 * brakeMax) lever = Math.min(lever, -Math.min(7, Math.ceil((7 * aReq) / brakeMax)));
      }
    } else if (s.doorPhase === 'open') {
      if (closeAt >= 0 && s.t >= closeAt && s.platformIndex < lastIdx) { doorPress = true; closeAt = -1; }
    }
    const phaseBefore = s.doorPhase;
    s = sm.step(DT, { lever, passengers: onboard, doorPress });
    if (pending && doorPress && s.events.some((e) => e.type === 'doorsOpening')) {
      const i = pending.i; served.add(i); const size = BOARD_BASE[st[i].size] ? st[i].size : 2;
      const alight = i === 0 ? 0 : i === lastIdx ? onboard : Math.min(onboard, Math.round(onboard * (0.22 + 0.33 * rnd()) * (size === 3 ? 1.2 : size === 1 ? 0.8 : 1)));
      const room = Math.max(0, CAP - (onboard - alight));
      const board = i === lastIdx ? 0 : Math.min(room, Math.max(2, Math.round(BOARD_BASE[size] * scale * (0.7 + rnd() * 0.7))));
      const exch = truth(alight, board); closeAt = s.t + exch + REACT_S; onboard = onboard - alight + board;
      pending = { ...pending, alight, board, exch: +exch.toFixed(1) }; rows.push(pending); pendingRow = pending; tPress = -1; moveT = -1; pending = null;
    } else if (doorPress) pending = null;
    if (phaseBefore !== 'closed' && s.doorPhase === 'closed' && pendingRow) { pendingRow.readyT = s.t; pendingRow.depDelayPlanned = Math.round(s.t - tt.stops[pendingRow.i].dep); }
    phaseSeen = s.doorPhase;
  }
  const early = s.totals.early;
  return { rows, finished: s.finished, t: s.t, total: tt.total, spads: s.totals.spads, overspeed: Math.round(s.totals.overspeedSec), early, guard, dbg: { phase: s.doorPhase, ready: s.readyToDepart, wait: s.departureWaitSec, v: s.v, ni: s.nextStationIndex, plat: s.platformIndex, s: s.s }, doors, lengthM, summary: sm.summary().stops.map((x) => x.depDelaySec) };
};

export function driveService(page, { share = 0.9, leave = 'free', seed = 7 } = {}) {
  return page.evaluate(botInPage, { share, leave, seed });
}

/* waits of the stops that have a departure (the terminus has none), medians and the lateness figures of one drive */
export function summarize(res) {
  const last = res.rows.length ? res.rows[res.rows.length - 1].i : -1;
  const waits = res.rows.filter((r) => r.wait !== undefined && r.i < last).map((r) => r.wait).sort((x, y) => x - y);
  const late = res.rows.map((r) => r.late);
  const pick = (q) => (waits.length ? waits[Math.min(waits.length - 1, Math.floor(waits.length * q))] : 0);
  return {
    stops: res.rows.length, finished: res.finished, minutes: +(res.t / 60).toFixed(1), scheduledMin: +(res.total / 60).toFixed(1),
    medWait: pick(0.5), p90Wait: pick(0.9), maxWait: waits.length ? waits[waits.length - 1] : 0, meanWait: +(waits.reduce((x, y) => x + y, 0) / Math.max(1, waits.length)).toFixed(1),
    worstLate: Math.max(0, ...late), endLate: late[late.length - 1], earliest: Math.min(0, ...late), lateOver30: late.filter((x) => x > 30).length, early: res.early, overspeedSec: res.overspeed, spads: res.spads,
  };
}
