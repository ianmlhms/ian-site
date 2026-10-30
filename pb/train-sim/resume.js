/* Lokféierer: resume support (pure). A running service is written to localStorage as a small JSON snapshot, so a killed or reloaded page can
   offer "Weiderfueren". This module only validates and normalizes a stored snapshot (nothing is trusted: a broken or tampered one is
   rejected) and says how long ago it was. Reading/writing the storage and rebuilding the world stay in the shell (train-sim.js).
   TS.resume.check(rawText, { now, save, testMode, lock }) -> { snap } | { reject: 'reason', keep: boolean }
     lock = the career the page is locked to (TS.careerLock) or null: a service of the other career is rejected with keep = true.
     keep = true: it may become valid once the (cloud) save has arrived, so the stored copy is left alone; otherwise the shell deletes it.
   Cloud resume: inside the arcade the shell mirrors the stored snapshot to the account (game_resume, via pixelbreak-records.js) and receives the
   snapshots of other devices; a cloud snapshot is written to the same key and goes through check() like any other, so this module stays the only
   judge (a keep = true reject waits for the career save, anything else is deleted locally and in the cloud). Notes: scripts/train-resume-v1.sql. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const VERSION = 1;
  const KEY = 'pb_resume_train-sim';
  const OTHER_CAREER = 'other career';   // reject reason of a service that belongs to the career the page is not locked to
  /* one slot per arcade tile (career lock), so a Zuch service and a Tram service wait side by side; without a lock the original key */
  const keyFor = (lock) => (lock === 'rail' || lock === 'tram' ? KEY + '_' + lock : KEY);
  const MAX_AGE_MS = 24 * 3600 * 1000, FUTURE_SKEW_MS = 5 * 60 * 1000, MAX_BYTES = 20000;
  const CAMERAS = ['cab', 'chase', 'platform', 'orbit'];
  const WEATHER = ['clear', 'rain', 'fog', 'snow'];
  const PATTERNS = ['RB', 'RE'];
  const INCIDENTS = ['doorsHeld', 'crowd', 'connection'];
  const MAX_STATIONS = 80, MAX_LOOPS = 1000, MAX_ROUTE_CASH = 100000, MAX_COUNT = 100000;

  const fin = (x) => typeof x === 'number' && Number.isFinite(x);
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const int = (x, lo, hi, d = lo) => (fin(x) ? Math.round(clamp(x, lo, hi)) : d);
  const text = (x, max) => (typeof x === 'string' ? x.slice(0, max) : '');
  const reject = (reason, keep = false) => ({ reject: reason, keep });

  function normalizePlan(p) {
    if (!isObj(p) || !PATTERNS.includes(p.p)) return null;
    const pass = Array.isArray(p.pass) ? p.pass.filter((i) => Number.isInteger(i) && i > 0 && i < MAX_STATIONS).slice(0, MAX_STATIONS) : [];
    const tsr = (Array.isArray(p.tsr) ? p.tsr : []).slice(0, 8).filter((r) => isObj(r) && fin(r.s0) && fin(r.s1) && fin(r.kmh) && r.s1 > r.s0 && r.kmh >= 5 && r.kmh <= 200)
      .map((r) => ({ s0: r.s0, s1: r.s1, kmh: r.kmh }));
    const incidents = (Array.isArray(p.inc) ? p.inc : []).slice(0, 8).filter((x) => isObj(x) && INCIDENTS.includes(x.kind)).map((x) => {
      const out = { kind: x.kind };
      if (fin(x.station)) out.station = int(x.station, 0, MAX_STATIONS);
      if (x.kind === 'crowd') { out.reason = int(x.reason, 0, 9); out.factor = clamp(fin(x.factor) ? x.factor : 1.8, 1, 4); }
      return out;
    });
    return { pattern: p.p, pass, tsr, incidents };
  }

  /* what the shell needs about the passengers, with the shapes and ranges made safe (the totals are clamped again once the vehicle is known) */
  function normalizeWorld(w, stationCount) {
    if (!isObj(w)) return null;
    const okIndex = (i) => Number.isInteger(i) && i >= 0 && i < stationCount;
    const stops = {};
    if (isObj(w.stops)) for (const [k, r] of Object.entries(w.stops)) {
      const i = Number(k);
      if (okIndex(i) && Array.isArray(r) && r.length >= 4) stops[i] = { alighted: int(r[0], 0, MAX_COUNT), boarded: int(r[1], 0, MAX_COUNT), alightingTotal: int(r[2], 0, MAX_COUNT), boardingTotal: int(r[3], 0, MAX_COUNT) };
    }
    const plans = {};
    if (isObj(w.plans)) for (const [k, n] of Object.entries(w.plans)) if (okIndex(Number(k)) && fin(n)) plans[Number(k)] = { boarding: int(n, 0, MAX_COUNT) };
    const log = (Array.isArray(w.log) ? w.log : []).slice(0, stationCount).filter((r) => Array.isArray(r) && okIndex(r[0])).map((r) => ({ index: r[0], boarded: int(r[1], 0, MAX_COUNT), alighted: int(r[2], 0, MAX_COUNT) }));
    const riders = (Array.isArray(w.riders) ? w.riders : []).slice(0, 200).filter((r) => Array.isArray(r) && fin(r[0]) && fin(r[1]) && r[0] > 0).map((r) => ({ n: int(r[0], 1, MAX_COUNT), s: clamp(r[1], -1e6, 1e7) }));
    return { onboard: int(w.onboard, 0, MAX_COUNT), delivered: int(w.delivered, 0, MAX_COUNT * 10), boardedTotal: int(w.boarded, 0, MAX_COUNT * 10), passengerKm: fin(w.pkm) ? clamp(w.pkm, 0, 1e9) : 0, stops, plans, stopLog: log, riders };
  }

  /* Final range check once the vehicle and the track are known: nobody carries more than the vehicle holds, nobody travels further than the line. */
  function clampWorld(w, capacity, stationCount, trackLengthM) {
    const cap = Math.max(1, capacity | 0), perStop = cap * Math.max(1, stationCount);
    const boardedTotal = Math.min(w.boardedTotal, perStop), delivered = Math.min(w.delivered, perStop);
    const onboard = Math.min(w.onboard, cap);
    let room = onboard;
    const riders = w.riders.map((r) => ({ ...r, s: clamp(r.s, 0, trackLengthM) })).map((r) => { const n = Math.min(r.n, room); room -= n; return { ...r, n }; }).filter((r) => r.n > 0);
    const stops = Object.fromEntries(Object.entries(w.stops).map(([i, r]) => [i, { alighted: Math.min(r.alighted, cap), boarded: Math.min(r.boarded, cap), alightingTotal: Math.min(r.alightingTotal, cap), boardingTotal: Math.min(r.boardingTotal, cap) }]));
    const stopLog = w.stopLog.map((r) => ({ ...r, boarded: Math.min(r.boarded, cap), alighted: Math.min(r.alighted, cap) }));
    const plans = Object.fromEntries(Object.entries(w.plans).map(([i, p]) => [i, { boarding: Math.min(p.boarding, cap * 3) }]));
    return { ...w, onboard, delivered, boardedTotal, passengerKm: Math.min(w.passengerKm, perStop * (trackLengthM / 1000)), riders, stops, stopLog, plans };
  }

  function check(rawText, ctx = {}) {
    if (typeof rawText !== 'string' || !rawText) return reject('empty');
    if (rawText.length > MAX_BYTES) return reject('too big');
    let raw;
    try { raw = JSON.parse(rawText); } catch (error) { return reject('not json'); }
    if (!isObj(raw)) return reject('not an object');
    if (raw.v !== VERSION) return reject('version');
    const now = fin(ctx.now) ? ctx.now : Date.now();
    if (!fin(raw.at)) return reject('no time');
    const age = now - raw.at;
    if (age > MAX_AGE_MS) return reject('expired');
    if (age < -FUTURE_SKEW_MS) return reject('from the future');

    const mode = raw.mode === 'endless' ? 'endless' : raw.mode === 'career' ? 'career' : '';
    if (!mode) return reject('mode');
    const route = text(raw.route, 60), train = text(raw.train, 40);
    const routeDef = route && TS.routes && TS.routes.get ? TS.routes.get(route) : null;
    if (!routeDef) return reject('unknown route');
    if (!TS.config || !TS.config.trains.some((x) => x.id === train)) return reject('unknown train');
    const K = TS.career;
    const career = K.careerOfTrain(train);
    if (!career || K.careerOfRoute(route) !== career) return reject('route and train are from different careers');
    if (ctx.lock && career !== ctx.lock) return reject(OTHER_CAREER, true);   // the other arcade tile owns this service: leave it stored for that tile
    const save = K.normalize(ctx.save);
    const cs = save[career];
    if (!cs.owned.includes(train)) return reject('train not owned', true);
    if (mode === 'career') {
      if (!K.trainCompatible(train, route)) return reject('train does not fit the route');
      if (!K.routeAvailable(save, route, train).ok) return reject('route not owned', true);
    }
    const svc = int(raw.svc, 0, 1e7), life = int(raw.life, 0, Number.MAX_SAFE_INTEGER);
    if (!ctx.testMode) {   // a service that was finished (and paid) after this snapshot must never come back: no double credit
      if (cs.services > svc) return reject('a later service was already paid');
      if (cs.services < svc || cs.lifetime < life) return reject('save is older than the snapshot', true);
    }

    let en = null;
    if (mode === 'endless') {
      const e = raw.en;
      if (!isObj(e) || !Array.isArray(e.order) || e.order.length < 1 || e.order.length > 60) return reject('endless context');
      const order = K.endlessOrder(train);
      if (e.order.length !== order.length || e.order.some((id, i) => id !== order[i])) return reject('endless order changed');
      const i = int(e.i, 0, order.length - 1, -1);
      if (i < 0 || order[i] !== route) return reject('endless index');
      const loops = int(e.loops, 0, MAX_LOOPS), played = loops * order.length + i;
      en = { order: order.slice(), index: i, loops, total: { cash: int(e.cash, 0, played * MAX_ROUTE_CASH), points: int(e.pts, 0, played * MAX_ROUTE_CASH) } };
    }

    const out = {
      v: VERSION, at: raw.at, mode, route, train, career, svc, life, en, fresh: raw.fresh ? 1 : 0,
      cam: CAMERAS.includes(raw.cam) ? raw.cam : 'cab', nextName: text(raw.nn, 80), next: int(raw.ni, 0, MAX_STATIONS), live: int(raw.live, 0, MAX_COUNT * 100),
      wxp: text(raw.wxp, 12), todp: text(raw.todp, 12),
    };
    if (out.fresh) {
      if (mode !== 'endless') return reject('fresh career');
      return { snap: out };
    }
    const env = raw.env;
    if (!isObj(env) || !WEATHER.includes(env.weather) || !fin(env.hour)) return reject('environment');
    out.env = { weather: env.weather, hour: ((env.hour % 24) + 24) % 24 };
    out.shift = fin(raw.shift) ? clamp(raw.shift, -86400, 86400) : 0;
    out.clock0 = fin(raw.clock0) ? clamp(raw.clock0, 0, 172800) : null;
    if (out.clock0 === null) return reject('clock');
    out.plan = normalizePlan(raw.plan);
    if (!out.plan) return reject('plan');
    if (!Array.isArray(raw.tt) || raw.tt.length < 2 || raw.tt.length > MAX_STATIONS || !raw.tt.every((r) => Array.isArray(r) && fin(r[0]) && fin(r[1]) && r[0] >= 0 && r[1] >= 0 && r[0] < 172800 && r[1] < 172800)) return reject('timetable');
    out.tt = raw.tt.map((r) => [r[0], r[1]]);
    out.ttTotal = fin(raw.ttt) ? clamp(raw.ttt, 0, 172800) : 0;
    out.sim = isObj(raw.sim) ? raw.sim : null;
    if (!out.sim) return reject('sim');
    out.world = normalizeWorld(raw.w, out.tt.length);
    if (!out.world) return reject('world');
    return { snap: out };
  }

  /* how long ago: { key, n } for TS.t ('resumeAgoNow' | 'resumeAgoMin1' | 'resumeAgoMinN' | 'resumeAgoHour1' | 'resumeAgoHourN') */
  function ago(ms) {
    const min = Math.max(0, Math.floor(ms / 60000));
    if (min < 1) return { key: 'resumeAgoNow', n: 0 };
    if (min < 60) return min === 1 ? { key: 'resumeAgoMin1', n: 1 } : { key: 'resumeAgoMinN', n: min };
    const h = Math.floor(min / 60);
    return h === 1 ? { key: 'resumeAgoHour1', n: 1 } : { key: 'resumeAgoHourN', n: h };
  }

  TS.resume = Object.freeze({ VERSION, KEY, OTHER_CAREER, keyFor, MAX_AGE_MS, MAX_BYTES, check, clampWorld, ago });
})();
