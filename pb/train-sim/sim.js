/* Lokféierer: pure physics + rules (no DOM, no THREE). Units: m, s, m/s, euros. */
(function () {
  'use strict';
  window.TS = window.TS || {};

  const G = 9.81, KMH = 3.6;
  const LEVER_MIN = -8, LEVER_MAX = 5, LEVER_EB = -8, BRAKE_NOTCHES = 7, POWER_NOTCHES = 5;
  const DOOR_MOVE_S = 2.0, DOOR_WARN_S = 2.2, DOOR_MAX_SPEED = 0.5 / KMH;
  const STANDSTILL = 0.12, HOLD_V = 0.05, PARK_MAX_V = 0.5;
  const OVERSPEED_TOL_KMH = 3, OVERSPEED_FINE_BASE = 0.8, OVERSPEED_FINE_PER_KMH = 0.35;
  const TRACTION_UP = 0.9, TRACTION_DOWN = 1.6;              // force fraction per second
  const BRAKE_UP = 2.5, BRAKE_DOWN = 2.4, EB_UP = 5;         // decel (m/s^2) per second
  const ROLL_A = 0.0021, ROLL_B = 0.00005, AIR_RHO = 1.2;
  const PAX_KG = 72, HARSH_FRACTION = 0.8, HARSH_MIN_V = 5, HARSH_COOLDOWN = 6;
  const PERFECT_M = 2, OK_M = 8, OVERRUN_M = 15, STOP_ZONE_BEHIND = 90, STOP_ZONE_AHEAD = 40, MISSED_AFTER_M = 160;
  const SIGNAL_REVEAL_M = 450, HOLD_CHANCE = 0.3, HOLD_MIN_S = 8, HOLD_MAX_S = 34, SIGNAL_NEAR_STATION_M = 420;
  const SPAD_FINE = 250, OVERRUN_FINE = 40, SHORT_FINE = 10, HARSH_FINE = 6, EARLY_FINE = 12, EB_FINE = 0, BUFFER_FINE = 80;
  const PERFECT_BONUS = 50, OK_BONUS = 25, FAIR_BONUS = 10, ON_TIME_S = 30, ON_TIME_BONUS = 20, LATE_FINE_PER_MIN = 10;
  const FIRST_DEPARTURE_S = 75, DWELL_MIN = 30, DWELL_MAX = 45, TIMETABLE_SPEED_SHARE = 0.8;
  const SPAD_RESET_S = 4, POWER_MARGIN = 2.4;
  /* braking guide: distance needed at notch B4 (of 7), plus a short reaction lag */
  const GUIDE_NOTCH = 4, GUIDE_LAG_S = 0.6, GUIDE_MIN_V = 4, GUIDE_SIGNAL_M = 1200, GUIDE_SIGNAL_MARGIN_M = 10;
  /* variation: service patterns, temporary speed restrictions (TSR), random events */
  const RE_CHANCE = 0.4, RE_MIN_INTERMEDIATE = 3, TSR_MIN_KMH = 40, TSR_MAX_KMH = 60, TSR_MIN_LEN = 200, TSR_MAX_LEN = 500;
  const TSR_AFTER_STATION_M = 800, TSR_BEFORE_STATION_M = 900, TSR_GAP_M = 300, TSR_MARGIN_KMH = 20, TSR_WARN_M = 900;
  const HELD_DOORS_S = 10, HELD_DOORS_CHANCE = 0.35, CROWD_CHANCE = 0.3, CONNECTION_CHANCE = 0.3, CROWD_FACTOR = 1.8, CROWD_REASONS = 3;
  const CONNECTION_MIN_S = 18, CONNECTION_MAX_S = 30, CROWD_WARN_M = 1200, PARK_HINT_COOLDOWN_S = 3;

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const approach = (cur, target, up, down, dt) => target > cur ? Math.min(target, cur + up * dt) : Math.max(target, cur - down * dt);
  function rngFrom(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  function trainLength(train) { return Math.max(8, (train.cars || 1) * (train.carLength || 20)); }

  function sortedLimits(track) {
    const list = (track.limits || []).filter(l => Number.isFinite(l.s) && Number.isFinite(l.kmh)).map(l => ({ s: l.s, kmh: l.kmh }));
    return list.sort((a, b) => a.s - b.s);
  }
  function limitAt(limits, x, fallback) {
    let kmh = limits.length ? limits[0].kmh : fallback;
    for (const l of limits) { if (l.s <= x) kmh = l.kmh; else break; }
    return kmh;
  }
  function effectiveLimit(limits, rear, front, fallback) {
    let kmh = limitAt(limits, front, fallback);
    kmh = Math.min(kmh, limitAt(limits, rear, fallback));
    for (const l of limits) { if (l.s > rear && l.s <= front) kmh = Math.min(kmh, l.kmh); }
    return kmh;
  }
  function nextLimitAhead(limits, front, currentKmh) {
    for (const l of limits) { if (l.s > front && l.kmh !== currentKmh) return { s: l.s, kmh: l.kmh, tsr: !!l.tsr }; }
    return null;
  }

  /* Limits with temporary restrictions merged in: one sorted list, each entry holds from s until the next one. */
  function mergeRestrictions(base, restrictions, fallbackKmh) {
    if (!restrictions || !restrictions.length) return base;
    const points = new Set([0, ...base.map(l => l.s)]);
    restrictions.forEach(r => { points.add(r.s0); points.add(r.s1); });
    const out = [];
    [...points].sort((a, b) => a - b).forEach(s => {
      const baseKmh = limitAt(base, s, fallbackKmh);
      let kmh = baseKmh, tsr = false;
      restrictions.forEach(r => { if (s >= r.s0 && s < r.s1 && r.kmh < kmh) { kmh = r.kmh; tsr = true; } });
      const prev = out[out.length - 1];
      if (!prev || prev.kmh !== kmh || prev.tsr !== tsr) out.push({ s, kmh, tsr });
    });
    return out;
  }

  /* Timetable: seconds from service start. Travel at ~80 % of the line speed incl. accel/brake losses.
     options.pass = indices of stations the train runs through (express): no dwell, no braking loss. */
  function buildTimetable(track, train, options = {}) {
    const rng = options.rng || Math.random, limits = options.limits || sortedLimits(track), stations = track.stations || [];
    const passSet = new Set(options.pass || []);
    const vmax = (train.maxKmh || 100) / KMH, accel = Math.max(0.25, (train.accel || 0.7) * 0.5), brake = Math.max(0.3, (train.brake || 0.9) * 0.6);
    const stops = stations.map((st, i) => ({ name: st.name, s: st.s, arr: 0, dep: 0, pass: false }));
    let clock = options.firstDeparture ?? FIRST_DEPARTURE_S, last = 0;
    if (stops[0]) stops[0].dep = clock;
    const lastIdx = stations.length - 1;
    for (let i = 1; i < stations.length; i++) {
      if (passSet.has(i) && i < lastIdx) continue;
      const prev = stations[last], st = stations[i], dist = Math.max(50, st.s - prev.s);
      let lineKmh = 0; const samples = 6;
      for (let k = 0; k < samples; k++) lineKmh += limitAt(limits, prev.s + dist * (k + 0.5) / samples, train.maxKmh || 100);
      lineKmh /= samples;
      const v = Math.max(5, Math.min(vmax, lineKmh / KMH) * TIMETABLE_SPEED_SHARE);
      const dAB = v * v / (2 * accel) + v * v / (2 * brake);
      const travel = dist > dAB ? (dist - dAB) / v + v / accel + v / brake : 2 * Math.sqrt(dist / (1 / accel + 1 / brake));
      const arr = clock + travel, isLast = i === lastIdx;
      const dwell = isLast ? 0 : Math.round(DWELL_MIN + rng() * (DWELL_MAX - DWELL_MIN));
      stops[i].arr = Math.round(arr); stops[i].dep = Math.round(arr + dwell);
      for (let j = last + 1; j < i; j++) {                      // passed stations: interpolate by distance
        const f = (stations[j].s - prev.s) / Math.max(1, st.s - prev.s);
        const at = Math.round(stops[last].dep + (arr - stops[last].dep) * f);
        stops[j].arr = at; stops[j].dep = at; stops[j].pass = true;
      }
      clock = arr + dwell; last = i;
    }
    return Object.freeze({ clockStart: options.clockStart ?? 8 * 3600, stops: Object.freeze(stops.map(x => Object.freeze(x))), total: clock });
  }

  /* Per-service variation. Pure given rng; the first service of a save stays plain (RB, no restrictions, no events). */
  const EMPTY_PLAN = Object.freeze({ pattern: 'RB', pass: Object.freeze([]), tsr: Object.freeze([]), incidents: Object.freeze([]) });
  function planService(track, train, opts = {}) {
    const rng = opts.rng || Math.random, stations = track.stations || [], n = stations.length, base = sortedLimits(track);
    if (opts.varied === false || (opts.services || 0) < 1 || n < 2) return EMPTY_PLAN;
    const intermediate = [];
    for (let i = 1; i < n - 1; i++) intermediate.push(i);
    const isTram = (train && train.kind === 'tram') || track.kind === 'tram';
    let pass = [];
    if (!isTram && intermediate.length >= RE_MIN_INTERMEDIATE && rng() < (opts.reChance ?? RE_CHANCE)) {
      const count = intermediate.length >= 5 && rng() < 0.5 ? 2 : 1, pool = intermediate.slice();
      while (pass.length < count && pool.length) pass.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      pass.sort((a, b) => a - b);
    }
    const tsr = [];
    const wanted = rng() < 0.25 ? 0 : rng() < 0.7 ? 1 : 2;
    for (let attempt = 0; attempt < 14 && tsr.length < wanted; attempt++) {
      const leg = Math.floor(rng() * (n - 1)), a = stations[leg], b = stations[leg + 1];
      const len = Math.round((TSR_MIN_LEN + rng() * (TSR_MAX_LEN - TSR_MIN_LEN)) / 10) * 10;
      const lo = a.s + TSR_AFTER_STATION_M, hi = b.s - TSR_BEFORE_STATION_M - len;
      if (hi <= lo) continue;
      const s0 = Math.round(lo + rng() * (hi - lo)), s1 = s0 + len, kmh = 5 * Math.round((TSR_MIN_KMH + rng() * (TSR_MAX_KMH - TSR_MIN_KMH)) / 5);
      let minBase = Infinity;
      for (let k = 0; k <= 6; k++) minBase = Math.min(minBase, limitAt(base, s0 + (len * k) / 6, train.maxKmh || 100));
      if (minBase < kmh + TSR_MARGIN_KMH) continue;
      if (tsr.some(r => s0 < r.s1 + TSR_GAP_M && s1 > r.s0 - TSR_GAP_M)) continue;
      if (typeof track.inTunnel === 'function' && (track.inTunnel(s0) || track.inTunnel(s1) || track.inTunnel(s0 + len / 2))) continue;
      tsr.push({ s0, s1, kmh });
    }
    tsr.sort((x, y) => x.s0 - y.s0);
    const stopping = intermediate.filter(i => !pass.includes(i));
    const incidents = [];
    const takeStop = () => stopping.length ? stopping[Math.floor(rng() * stopping.length)] : -1;
    if (rng() < HELD_DOORS_CHANCE) { const i = takeStop(); if (i > 0) incidents.push({ kind: 'doorsHeld', station: i }); }
    if (rng() < CROWD_CHANCE) { const i = takeStop(); if (i > 0 && !incidents.some(x => x.station === i)) incidents.push({ kind: 'crowd', station: i, reason: Math.floor(rng() * CROWD_REASONS), factor: CROWD_FACTOR }); }
    if (rng() < CONNECTION_CHANCE) incidents.push({ kind: 'connection' });
    return Object.freeze({ pattern: pass.length ? 'RE' : 'RB', pass: Object.freeze(pass), tsr: Object.freeze(tsr), incidents: Object.freeze(incidents) });
  }

  function create(config) {
    const { train, track } = config;
    const options = config.options || {};
    const rng = options.rng || rngFrom(options.seed || Date.now());
    const stations = track.stations || [];
    const plan = options.plan || EMPTY_PLAN;
    const passSet = new Set((plan.pass || []).filter(i => i > 0 && i < stations.length - 1));
    const isPass = (i) => passSet.has(i);
    const baseLimits = sortedLimits(track);
    const limits = mergeRestrictions(baseLimits, plan.tsr, train.maxKmh || 100);
    const len = trainLength(train);
    const baseMass = (train.massT || 80) * 1000;
    const maxMs = (train.maxKmh || 100) / KMH;
    const fMax = (train.accel || 0.8) * baseMass;
    const kneeV = Math.max(10, maxMs * 0.42);
    const cdA = train.model === 'hst' ? 5.5 : train.kind === 'tram' ? 6 : 7 + (train.cars || 1) * 0.6;
    const resistAt = (speed) => baseMass * G * (ROLL_A + ROLL_B * speed) + 0.5 * AIR_RHO * cdA * speed * speed;
    const power = Math.max(fMax * kneeV, POWER_MARGIN * resistAt(maxMs) * maxMs);   // enough power to actually reach the top speed in a compressed route
    const brakeMax = train.brake || 0.9, ebMax = train.emergency || Math.max(1.2, brakeMax * 1.4);
    const timetable = config.timetable || buildTimetable(track, train, { rng, clockStart: options.clockStart, limits, pass: [...passSet] });
    const lastIndex = stations.length - 1;

    const signals = (track.signals || []).map((sg, i) => ({ srcIndex: i, s: sg.s, kind: sg.kind || 'main', hold: false, revealedAt: -1, clearAfter: 0, cleared: false, passed: false }))
      .filter(sg => Number.isFinite(sg.s)).sort((a, b) => a.s - b.s).map((sg, i) => ({ ...sg, index: i }));
    signals.forEach(sg => {
      const nearStation = stations.some(st => st.s - sg.s > 20 && st.s - sg.s < SIGNAL_NEAR_STATION_M);
      sg.hold = nearStation && sg.s > 700 && rng() < (options.holdChance ?? HOLD_CHANCE);
      sg.clearAfter = HOLD_MIN_S + rng() * (HOLD_MAX_S - HOLD_MIN_S);
    });
    if ((plan.incidents || []).some(x => x.kind === 'connection')) {   // late connection: one more signal before a stop holds the train
      const spots = signals.filter(sg => !sg.hold && sg.s > 700 && stations.some((st, i) => !isPass(i) && i > 0 && st.s - sg.s > 20 && st.s - sg.s < SIGNAL_NEAR_STATION_M));
      const pickSg = spots.length ? spots[Math.floor(rng() * spots.length)] : null;
      if (pickSg) { pickSg.hold = true; pickSg.reason = 'connection'; pickSg.clearAfter = CONNECTION_MIN_S + rng() * (CONNECTION_MAX_S - CONNECTION_MIN_S); }
    }
    const heldAt = (plan.incidents || []).filter(x => x.kind === 'doorsHeld').map(x => x.station);
    const crowdAt = (plan.incidents || []).filter(x => x.kind === 'crowd');
    const tsrWarned = new Set(), crowdWarned = new Set(), heldFired = new Set();

    const visits = stations.map(() => ({ arrived: false, departed: false, skipped: false, opened: false, arriveT: 0, errorM: 0, rating: '', arrDelay: 0, depDelay: 0, boarded: 0, alighted: 0 }));
    const totals = { overspeedSec: 0, overspeedFine: 0, spads: 0, harsh: 0, ebs: 0, early: 0, overruns: 0, shorts: 0, perfect: 0, ok: 0, fair: 0, missed: 0, bufferHits: 0 };

    let s = stations.length ? stations[0].s : 0, v = 0, a = 0, t = 0, distance = 0;
    let lever = 0, tractionFrac = 0, brakeDecel = 0, passengers = 0;
    let doorPhase = 'closed', doorTimer = 0, doorsOpen01 = 0, doorsReleased = false, doorSide = null, doorStation = -1;
    let parking = false, parkingAuto = false, heldUntil = -1, parkHintAt = -99, gradeOverride = null;
    let spadActive = false, spadStill = 0, harshCooldown = 0, overspeedWasOn = false, ebWas = false;
    let cash = 0, lastDelay = 0, finished = false;

    const frameGrade = (x) => { if (gradeOverride !== null) return gradeOverride; try { const f = track.frameAt(clamp(x, 0, track.length)); return Number.isFinite(f.grade) ? f.grade : 0; } catch (e) { return 0; } };

    function stationOverlap() {
      const rear = s - len;
      for (let i = 0; i < stations.length; i++) {
        const st = stations[i], ps = st.platformStart ?? st.s - 60, pe = st.platformEnd ?? st.s + 20;
        if (s >= ps + 4 && rear <= pe - 4) return i;
      }
      return -1;
    }
    function nextStationIndex() {
      for (let i = 0; i < stations.length; i++) if (!visits[i].departed && !visits[i].skipped && !isPass(i)) return i;
      return lastIndex;
    }
    function nextStopAfter(i) {
      for (let j = i + 1; j < stations.length; j++) if (!isPass(j)) return j;
      return lastIndex;
    }
    function aspectOf(sg, front) {
      if (sg.passed && front > sg.s) return 'green';
      if (spadActive && sg.index === spadSignal) return 'red';
      if (isRed(sg)) return 'red';
      const nxt = signals[sg.index + 1];
      if (nxt && nxt.s - sg.s < 2600 && isRed(nxt)) return 'yellow';
      return 'green';
    }
    function isRed(sg) { return sg.hold && !sg.cleared; }
    let spadSignal = -1;

    function expectedDelay(front, ni) {
      const stops = timetable.stops;
      if (!stops.length) return 0;
      const vis = visits[ni];
      if (ni >= 0 && vis && vis.arrived && !vis.departed) return Math.max(vis.arrDelay, t - stops[ni].dep);
      if (ni <= 0) return Math.max(0, t - stops[0].dep);
      const p = stops[ni - 1], n = stops[ni], f = clamp((front - p.s) / Math.max(1, n.s - p.s), 0, 1);
      return t - (p.dep + f * (n.arr - p.dep));
    }

    function step(dt, input = {}) {
      const events = [];
      dt = clamp(dt, 0, 0.1);
      if (finished) dt = Math.min(dt, 0.05);
      t += dt;
      passengers = input.passengers ?? passengers;
      const mass = baseMass + passengers * PAX_KG;
      const wantLever = clamp(Math.round(input.lever ?? lever), LEVER_MIN, LEVER_MAX);
      lever = spadActive ? LEVER_EB : wantLever;

      /* --- doors --- */
      const platformIdx = stationOverlap();
      if (input.parkingToggle) {
        if (parking) { parking = false; parkingAuto = false; events.push({ type: 'parkingReleased', auto: false }); }
        else if (v > PARK_MAX_V) events.push({ type: 'parkingRefused' });
        else { parking = true; parkingAuto = false; events.push({ type: 'parkingApplied', auto: false }); }
      }
      if (input.doorPress) {
        if (heldUntil > t) events.push({ type: 'doorsRefused', reason: 'held' });
        else if (doorPhase === 'closed') {
          if (v > DOOR_MAX_SPEED) events.push({ type: 'doorsRefused', reason: 'moving' });
          else if (platformIdx < 0) events.push({ type: 'doorsRefused', reason: 'noPlatform' });
          else if (isPass(platformIdx)) events.push({ type: 'doorsRefused', reason: 'expressPass' });
          else {
            doorPhase = 'opening'; doorsReleased = true; doorStation = platformIdx; doorSide = stations[platformIdx].side || 'right';
            const vis = visits[platformIdx];
            if (!vis.opened) {
              vis.opened = true; vis.errorM = s - stations[platformIdx].s;
              vis.rating = classify(vis.errorM);
              vis.arrDelay = platformIdx === 0 ? 0 : Math.round(t - timetable.stops[platformIdx].arr);
              applyStopResult(platformIdx, vis, events);
            }
            events.push({ type: 'doorsOpening', stationIndex: platformIdx, side: doorSide });
          }
        } else if (doorPhase === 'open') { doorPhase = 'warning'; doorTimer = 0; events.push({ type: 'doorWarning' }); }
        else if (doorPhase === 'warning') { doorPhase = 'open'; events.push({ type: 'doorsReopened' }); }
      }
      if (doorPhase === 'opening') {
        doorsOpen01 = Math.min(1, doorsOpen01 + dt / DOOR_MOVE_S);
        if (doorsOpen01 >= 1) { doorPhase = 'open'; events.push({ type: 'doorsOpened', stationIndex: doorStation, side: doorSide, terminus: doorStation === lastIndex }); }
      } else if (doorPhase === 'warning') {
        doorTimer += dt;
        if (doorTimer >= DOOR_WARN_S) {
          if (heldAt.includes(doorStation) && !heldFired.has(doorStation)) {   // a passenger holds the doors: +10 s
            heldFired.add(doorStation); doorPhase = 'open'; doorTimer = 0; heldUntil = t + HELD_DOORS_S;
            events.push({ type: 'doorsHeld', stationIndex: doorStation, seconds: HELD_DOORS_S });
          } else { doorPhase = 'closing'; events.push({ type: 'doorsClosing', stationIndex: doorStation }); }
        }
      } else if (doorPhase === 'closing') {
        doorsOpen01 = Math.max(0, doorsOpen01 - dt / DOOR_MOVE_S);
        if (doorsOpen01 <= 0) { doorPhase = 'closed'; doorsReleased = false; events.push({ type: 'doorsClosed', stationIndex: doorStation }); }
      }
      const doorsLocked = doorsReleased || doorsOpen01 > 0;
      if (!parking && v < HOLD_V && doorsLocked) { parking = true; parkingAuto = true; events.push({ type: 'parkingApplied', auto: true }); }
      if (parking && parkingAuto && !doorsLocked && lever > 0) { parking = false; parkingAuto = false; events.push({ type: 'parkingReleased', auto: true }); }
      if (parking && !parkingAuto && !doorsLocked && lever > 0 && t - parkHintAt > PARK_HINT_COOLDOWN_S) { parkHintAt = t; events.push({ type: 'parkingBlocked' }); }

      /* --- forces --- */
      const ebNow = lever <= LEVER_EB;
      const power01 = lever > 0 && !doorsLocked && !parking ? lever / POWER_NOTCHES : 0;
      tractionFrac = approach(tractionFrac, power01, TRACTION_UP, TRACTION_DOWN, dt);
      let brakeTarget = 0;
      if (ebNow) brakeTarget = ebMax; else if (lever < 0) brakeTarget = (-lever / BRAKE_NOTCHES) * brakeMax;
      if (doorsLocked && v < 0.5) brakeTarget = Math.max(brakeTarget, 0.5);
      if (parking) brakeTarget = Math.max(brakeTarget, brakeMax);
      brakeDecel = approach(brakeDecel, brakeTarget, ebNow ? EB_UP : BRAKE_UP, BRAKE_DOWN, dt);

      const speedFade = clamp((maxMs - v) / (maxMs * 0.06), 0, 1);
      const tractionN = tractionFrac * Math.min(fMax, power / Math.max(v, 1)) * speedFade;
      const resist = mass * G * (ROLL_A + ROLL_B * v) + 0.5 * AIR_RHO * cdA * v * v;
      const grade = frameGrade(s - len / 2);
      const gradeN = mass * G * grade;
      let acc = (tractionN - resist - gradeN) / mass;
      if (v > 0) acc -= brakeDecel;
      /* standstill: the train holds exactly unless traction is really applied (brake, doors, parking brake: no creep on any grade) */
      const wantsMove = lever > 0 && !parking && !doorsLocked;
      if (v < HOLD_V && !wantsMove) { v = 0; a = 0; acc = 0; }
      else if (v === 0 && acc <= brakeDecel) acc = 0;
      else if (v <= STANDSTILL && acc <= 0) { acc = 0; v = 0; }
      const vNew = Math.max(0, v + acc * dt);
      if (vNew <= 0 && v <= STANDSTILL) { v = 0; a = 0; } else { a = (vNew - v) / Math.max(dt, 1e-6); v = vNew; }
      const ds = v * dt; s += ds; distance += ds;
      if (v < 0.02 && tractionN === 0) v = 0;

      /* --- buffer stop at the end of the line --- */
      const endS = Math.min(track.length - 3, (stations[lastIndex] ? stations[lastIndex].s + 70 : track.length));
      if (s > endS) {
        if (v > 3) { totals.bufferHits++; cash -= BUFFER_FINE; events.push({ type: 'buffer', fine: BUFFER_FINE }); }
        s = endS; v = 0; a = 0;
      }

      /* --- limits and overspeed --- */
      const limitKmh = Math.min(effectiveLimit(limits, s - len, s, train.maxKmh || 100), train.maxKmh || 999);
      const nextLimit = nextLimitAhead(limits, s, limitAt(limits, s, train.maxKmh || 100));
      const vKmh = v * KMH, over = vKmh - (limitKmh + OVERSPEED_TOL_KMH);
      if (over > 0 && !spadActive) {
        const fine = (OVERSPEED_FINE_BASE + OVERSPEED_FINE_PER_KMH * over) * dt;
        totals.overspeedSec += dt; totals.overspeedFine += fine; cash -= fine;
        if (!overspeedWasOn) events.push({ type: 'overspeed', limitKmh, kmh: vKmh });
        overspeedWasOn = true;
      } else if (over <= -2) overspeedWasOn = false;

      /* --- signals --- */
      let nextSignal = null;
      for (const sg of signals) {
        const dist = sg.s - s;
        if (sg.hold && !sg.cleared && dist < SIGNAL_REVEAL_M && dist > -5 && sg.revealedAt < 0) { sg.revealedAt = t; events.push({ type: 'signalHeld', reason: sg.reason || 'traffic', signalIndex: sg.index }); }
        if (sg.hold && !sg.cleared && sg.revealedAt >= 0 && t - sg.revealedAt >= sg.clearAfter) sg.cleared = true;
        if (!sg.passed && s > sg.s) {
          sg.passed = true;
          if (isRed(sg) && !spadActive) {
            spadActive = true; spadStill = 0; spadSignal = sg.index; totals.spads++; cash -= SPAD_FINE;
            events.push({ type: 'spad', signalIndex: sg.index, fine: SPAD_FINE });
          }
        }
        if (!nextSignal && sg.s > s - 1 && !sg.passed) nextSignal = sg;
      }
      if (spadActive) {
        if (v < HOLD_V) { spadStill += dt; if (spadStill >= SPAD_RESET_S) { spadActive = false; const sg = signals[spadSignal]; if (sg) sg.cleared = true; spadSignal = -1; events.push({ type: 'spadCleared' }); } }
        else spadStill = 0;
      }
      const signalAspect = nextSignal ? aspectOf(nextSignal, s) : 'green';
      const nextSignalDistance = nextSignal ? nextSignal.s - s : Infinity;

      /* --- comfort --- */
      harshCooldown = Math.max(0, harshCooldown - dt);
      if (!ebNow && !spadActive && brakeDecel > brakeMax * HARSH_FRACTION && v > HARSH_MIN_V && harshCooldown === 0) {
        harshCooldown = HARSH_COOLDOWN; totals.harsh++; cash -= HARSH_FINE; events.push({ type: 'harsh', fine: HARSH_FINE });
      }
      if (ebNow && !ebWas && !spadActive && v > 1) { totals.ebs++; cash -= EB_FINE; events.push({ type: 'emergency' }); }
      ebWas = ebNow;

      /* --- station logic --- */
      const ni = nextStationIndex();
      const stNext = stations[ni];
      for (let i = 0; i < stations.length; i++) {
        const vis = visits[i], st = stations[i];
        if (isPass(i)) continue;
        if (!vis.arrived && !vis.skipped && v < 0.3 && s >= st.s - STOP_ZONE_BEHIND && s <= st.s + STOP_ZONE_AHEAD + (st.platformEnd ? Math.max(0, st.platformEnd - st.s) : 0)) {
          vis.arrived = true; vis.arriveT = t; events.push({ type: 'arrived', stationIndex: i, errorM: s - st.s });
        }
        if (!vis.departed && !vis.skipped && vis.opened && doorPhase === 'closed' && s - st.s > 3 && v > 0.5 && i < lastIndex) {
          vis.departed = true; vis.depDelay = Math.round(t - timetable.stops[i].dep);
          if (t < timetable.stops[i].dep - 8) { totals.early++; cash -= EARLY_FINE; events.push({ type: 'earlyDeparture', stationIndex: i, fine: EARLY_FINE }); }
          const delay = vis.depDelay;
          if (delay <= ON_TIME_S) cash += ON_TIME_BONUS; else cash -= Math.min(60, ((delay - ON_TIME_S) / 60) * LATE_FINE_PER_MIN);
          events.push({ type: 'departed', stationIndex: i, delaySec: delay });
        }
        if (!vis.opened && !vis.skipped && s > st.s + MISSED_AFTER_M && i < lastIndex) {
          vis.skipped = true; totals.missed++; cash -= OVERRUN_FINE * 2;
          events.push({ type: 'missedStop', stationIndex: i, fine: OVERRUN_FINE * 2 });
        }
      }
      if (!finished && lastIndex >= 0 && visits[lastIndex].arrived && v === 0 && doorPhase === 'open') {
        finished = true; events.push({ type: 'terminus', stationIndex: lastIndex });
      }

      const delaySec = Math.round(expectedDelay(s, ni));
      lastDelay = delaySec;
      const vi = visits[ni];
      const ready = !!(vi && vi.opened && doorPhase === 'closed' && !vi.departed && ni < lastIndex);
      const hi = ready ? nextStopAfter(ni) : ni;
      /* --- heads-up events: restriction ahead, crowded platform ahead --- */
      (plan.tsr || []).forEach((r, k) => {
        if (!tsrWarned.has(k) && s < r.s0 && r.s0 - s < TSR_WARN_M) { tsrWarned.add(k); events.push({ type: 'tsrAhead', kmh: r.kmh, distance: r.s0 - s }); }
      });
      crowdAt.forEach((c) => {
        if (!crowdWarned.has(c.station) && ni === c.station && !visits[ni].opened && stNext && stNext.s - s < CROWD_WARN_M) { crowdWarned.add(c.station); events.push({ type: 'crowdAhead', stationIndex: c.station, reason: c.reason }); }
      });
      const guide = brakingGuide(ni, nextSignal);
      const platformStopped = v < 0.3 ? platformIdx : -1;
      const stoppedAtMarkerError = platformStopped >= 0 || (stNext && Math.abs(s - stNext.s) < 120) ? (stNext ? s - stNext.s : 0) : 0;
      return {
        s, v, a, t, distance, lever, tractionFrac, brakeDecel, brakePct: clamp(brakeDecel / ebMax, 0, 1),
        powerKw: Math.round(tractionN * v / 1000), grade, mass, doorPhase, doorsOpen01, doorSide, doorsReleased, doorsLocked,
        atStationIndex: platformStopped, platformIndex: platformIdx, stoppedAtMarkerError,
        nextStationIndex: ni, distanceToStop: stNext ? stNext.s - s : 0, nextStation: stNext || null,
        readyToDepart: ready, headingIndex: hi, headingStation: stations[hi] || null, distanceToHeading: stations[hi] ? stations[hi].s - s : 0,
        signalAspect, nextSignalDistance, nextSignalIndex: nextSignal ? nextSignal.index : -1, limitKmh,
        nextLimit: nextLimit ? { ...nextLimit, distance: nextLimit.s - s } : null,
        delaySec, clockSec: timetable.clockStart + t, events, score: Math.round(cash), cash, spadActive, finished,
        scheduledDep: stNext ? timetable.stops[ni].dep : 0, departureWaitSec: stNext ? Math.max(0, timetable.stops[ni].dep - t) : 0,
        overspeed: over > 0, totals: { ...totals },
        parkingBrake: parking, parkingAuto, spadHoldSec: spadActive ? Math.max(0, SPAD_RESET_S - spadStill) : 0, heldDoorsSec: Math.max(0, heldUntil - t),
        guide, pattern: plan.pattern || 'RB', passIndices: [...passSet],
      };
    }

    /* Braking guide: what B4 needs from here vs. the distance left to the strictest target (stop marker, lower limit, red signal). */
    function brakingGuide(ni, nextSignal) {
      const none = { state: 'none', kind: '', distance: 0, needed: 0, targetKmh: 0 };
      if (v < GUIDE_MIN_V || finished) return none;
      const dB4 = brakeMax * GUIDE_NOTCH / BRAKE_NOTCHES;
      const targets = [];
      const stSt = stations[ni];
      if (stSt && !visits[ni].opened && stSt.s - s > -5) targets.push({ kind: 'stop', d: stSt.s - s, vt: 0 });
      const lower = limits.find((l) => l.s > s && l.kmh / KMH < v - 0.4);
      if (lower) targets.push({ kind: 'limit', d: lower.s - s, vt: lower.kmh / KMH });
      if (nextSignal && isRed(nextSignal) && nextSignal.s - s < GUIDE_SIGNAL_M) targets.push({ kind: 'signal', d: nextSignal.s - s - GUIDE_SIGNAL_MARGIN_M, vt: 0 });
      let best = none, bestRank = -1;
      targets.forEach((tg) => {
        const vv = v * v - tg.vt * tg.vt;
        if (vv <= 0) return;
        const needed = vv / (2 * dB4) + v * GUIDE_LAG_S;
        if (tg.d > needed * 1.15 + 8 + v) return;
        const req = vv / (2 * Math.max(1, tg.d - v * GUIDE_LAG_S));
        const state = brakeDecel >= req * 0.97 ? 'ok' : req > dB4 * 1.12 ? 'late' : 'brake';
        const rank = (state === 'late' ? 3 : state === 'brake' ? 2 : 1) * 1e5 - tg.d;
        if (rank > bestRank) { bestRank = rank; best = { state, kind: tg.kind, distance: tg.d, needed, targetKmh: Math.round(tg.vt * KMH) }; }
      });
      return best;
    }

    function classify(err) {
      const e = Math.abs(err);
      if (err > OVERRUN_M) return 'overrun';
      if (e <= PERFECT_M) return 'perfect';
      if (e <= OK_M) return 'ok';
      if (e <= OVERRUN_M) return 'fair';
      return 'short';
    }
    function applyStopResult(i, vis, events) {
      const r = vis.rating;
      if (r === 'perfect') { totals.perfect++; cash += PERFECT_BONUS; }
      else if (r === 'ok') { totals.ok++; cash += OK_BONUS; }
      else if (r === 'fair') { totals.fair++; cash += FAIR_BONUS; }
      else if (r === 'overrun') { totals.overruns++; cash -= OVERRUN_FINE; }
      else if (r === 'short') { totals.shorts++; cash -= SHORT_FINE; }
      events.push({ type: 'stopRated', stationIndex: i, errorM: vis.errorM, rating: r });
    }

    function recordExchange(index, boarded, alighted) {
      if (visits[index]) { visits[index].boarded = boarded; visits[index].alighted = alighted; }
    }

    function summary() {
      const stops = stations.map((st, i) => ({ index: i, name: st.name, errorM: visits[i].errorM, rating: visits[i].rating || (visits[i].skipped ? 'missed' : isPass(i) ? 'pass' : ''), arrDelaySec: visits[i].arrDelay, depDelaySec: visits[i].depDelay, boarded: visits[i].boarded, alighted: visits[i].alighted, visited: visits[i].opened }));
      const visited = stops.filter(x => x.visited);
      const lateStops = visited.filter(x => x.arrDelaySec > ON_TIME_S).length;
      return {
        durationSec: t, distanceM: distance, distanceKm: distance / 1000, stops, stopCount: stations.length, visitedCount: visited.length,
        perfectStops: totals.perfect, okStops: totals.ok, fairStops: totals.fair, overruns: totals.overruns, shortStops: totals.shorts, missedStops: totals.missed,
        finalDelaySec: lastDelay, arrivalDelaySec: visits[lastIndex] ? visits[lastIndex].arrDelay : 0,
        punctualStops: visited.length - lateStops, lateStops, overspeedSec: totals.overspeedSec, overspeedFine: totals.overspeedFine,
        spads: totals.spads, harshEvents: totals.harsh, emergencyBrakes: totals.ebs, earlyDepartures: totals.early, bufferHits: totals.bufferHits,
        pattern: plan.pattern || 'RB', passCount: passSet.size, simCash: cash, completed: finished,
      };
    }

    function placeBeforeStation(index, metresBefore = 60, speedMs = 3) {
      const st = stations[index]; if (!st) return;
      s = Math.max(0, st.s - metresBefore); v = speedMs; a = 0; tractionFrac = 0; brakeDecel = 0; lever = 0;
      doorPhase = 'closed'; doorsOpen01 = 0; doorsReleased = false;
      for (let i = 0; i < index; i++) { visits[i].arrived = visits[i].opened = visits[i].departed = true; }
      for (const sg of signals) { if (sg.s < s) sg.passed = true; }
      t = Math.max(t, index > 0 ? timetable.stops[index].arr - 10 : 0);
    }
    function setSpeed(ms) { v = Math.max(0, ms); }
    function setGradeOverride(g) { gradeOverride = Number.isFinite(g) ? g : null; }
    /* Test helper: makes the next signal ahead red for good and puts the train in front of it. */
    function forceRedAhead(metresBefore = 200, speedMs = 15) {
      const sg = signals.find((x) => x.s > s + 50);
      if (!sg) return false;
      sg.hold = true; sg.cleared = false; sg.clearAfter = 1e9; sg.revealedAt = -1;
      s = Math.max(0, sg.s - metresBefore); v = speedMs;
      for (const o of signals) if (o.s < s) o.passed = true;
      return true;
    }
    function place(newS, newV = 0) {
      s = clamp(newS, 0, track.length); v = Math.max(0, newV); a = 0; tractionFrac = 0; brakeDecel = 0;
      for (const sg of signals) if (sg.s < s - 5) sg.passed = true;
    }

    return Object.freeze({
      step, summary, recordExchange, placeBeforeStation, setSpeed, setGradeOverride, place, forceRedAhead, timetable, stations, length: len, plan, isPass,
      signalAspects: () => signals.map(sg => ({ index: sg.srcIndex, s: sg.s, aspect: aspectOf(sg, s), hold: sg.hold })),
      get signals() { return signals.map(sg => ({ index: sg.index, s: sg.s, hold: sg.hold, cleared: sg.cleared, passed: sg.passed })); },
      get now() { return { s, v, t }; },
    });
  }

  TS.sim = Object.freeze({
    create, buildTimetable, planService, LEVER_MIN, LEVER_MAX, LEVER_EB,
    leverLabel(n) { return n === 0 ? '0' : n > 0 ? 'P' + n : n <= LEVER_EB ? 'EB' : 'B' + (-n); },
    constants: Object.freeze({ PERFECT_M, OK_M, OVERRUN_M, ON_TIME_S, OVERSPEED_TOL_KMH, DOOR_MAX_SPEED, SPAD_FINE }),
  });
})();
