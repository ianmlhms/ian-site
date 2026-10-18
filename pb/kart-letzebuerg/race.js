/* Kart Lëtzebuerg — race simulation: grid, countdown, laps, ranking, collisions, boxes, pads, rescue. Pure logic, steps at 60 Hz. */
(function () {
  'use strict';
  const KL = window.KL, C = KL.CFG;
  const { clamp } = KL;

  KL.createRace = function createRace(o) {
    const track = o.track;
    const R = {
      track, laps: o.laps || C.LAPS, diff: KL.DIFFICULTY[o.difficulty] || KL.DIFFICULTY.normal, difficulty: o.difficulty || 'normal',
      phase: 'countdown', clock: -C.COUNTDOWN, karts: [], byId: {}, items: [], boxes: [], pads: [], events: [], order: [], finishCount: 0,
      weather: { name: o.weather || 'day', wet: (KL.WEATHER[o.weather] || KL.WEATHER.day).wet },
      rng: KL.rng((o.seed || 1) >>> 0), mode: o.mode || 'race', humans: [], finishClock: null, ghostBest: o.ghostBest || null,
    };
    R.boxes = KL.makeBoxes(track);
    R.pads = (track.def.pads || []).map(([s, d, len], i) => { const p = track.at(s, d || 0); return { x: p.x, z: p.z, y: p.y, s, d: d || 0, h: p.h, len: len || 8, w: 4.2, id: i }; });
    const defs = o.karts;
    defs.forEach((d, i) => {
      const k = KL.createKart({ ...d, slot: i });
      const g = track.startGrid(d.gridSlot != null ? d.gridSlot : i);
      KL.placeKart(k, track, g.s, 0, {});
      const gp = track.startGrid(d.gridSlot != null ? d.gridSlot : i);
      k.x = gp.x; k.z = gp.z; k.y = gp.y; k.yaw = gp.yaw; k.prog = gp.s; k.s = ((gp.s % track.length) + track.length) % track.length;
      k.hint = track.project(k.x, k.z, -1, k.y, {}).i;
      k.safeS = k.s; k.maxLap = -1; k.lapIdx = -1;
      R.karts.push(k); R.byId[k.id] = k;
      if (k.human) R.humans.push(k);
    });
    R.order = R.karts.slice();
    updateOrder(R);
    R.step = (dt) => step(R, dt);
    R.rescue = (k) => KL.rescueKart(k, track);
    R.fastForward = (maxSec) => fastForward(R, maxSec);
    return R;
  };

  function updateOrder(R) {
    const ks = R.karts;
    R.order.sort((a, b) => {
      if (a.finished || b.finished) { if (a.finished && b.finished) return a.finishOrder - b.finishOrder; return a.finished ? -1 : 1; }
      return b.prog - a.prog;
    });
    R.order.forEach((k, i) => (k.place = i + 1));
  }

  function step(R, dt) {
    const track = R.track;
    R.clock += dt;
    const racing = R.phase === 'race' || R.phase === 'finished';
    if (R.phase === 'countdown') {
      // track when the gas was first pressed (rocket start)
      for (const k of R.karts) {
        const g = k.input.gas > 0.5;
        if (g && k.gasSince === -1) k.gasSince = R.clock; else if (!g) k.gasSince = -1;
        if (k.isBot && !k.auto) KL.botThink(k, R, dt);
      }
      if (R.clock >= 0) {
        R.phase = 'race';
        R.events.push({ t: 'go' });
        for (const k of R.karts) {
          const early = k.gasSince !== -1 ? k.gasSince : null;
          let good = false, bad = false;
          if (k.isBot) { const r = R.rng(); good = r < 0.25 + 0.5 * R.diff.drift; bad = !good && r > 0.93; }
          else if (early != null) { good = early >= -0.75; bad = early < -1.6; }
          if (good) { k.boostT = 0.9; k.boostKind = 1; R.events.push({ t: 'rocketstart', id: k.id }); }
          if (bad) { k.stallT = 0.6; R.events.push({ t: 'stall', id: k.id }); }
        }
      }
    }
    // rubber banding relative to the human leader (mild)
    if (R.humans.length && racing) {
      const hp = Math.max(...R.humans.map((h) => h.prog));
      for (const k of R.karts) {
        if (!k.isBot || k.human) continue;
        const gap = hp - k.prog;            // positive: bot is behind the human
        k.rubber = 1 + clamp(gap / 300, -1, 1) * R.diff.rubber * (gap > 0 ? 1 : 1.2);
      }
    }
    for (const k of R.karts) {
      if ((k.isBot || k.auto) && R.phase !== 'countdown') KL.botThink(k, R, dt);
      KL.stepKart(k, dt, R);
      k.input.itemBack = false;
      // item usage / roulette
      if (k.roll) { k.roll.t -= dt; if (k.roll.t <= 0) { k.item = { id: k.roll.id, count: (KL.ITEMS[k.roll.id].count || 1) }; k.roll = null; R.events.push({ t: 'itemget', id: k.id, item: k.item.id }); } }
      if (k.wantItem) { k.wantItem = false; if (k.item && !k.roll) KL.useItem(R, k); }
    }
    KL.updateItems(R, dt);
    // item boxes
    for (const b of R.boxes) {
      if (!b.active) { b.respawn -= dt; if (b.respawn <= 0) b.active = true; continue; }
      for (const k of R.karts) {
        if (Math.abs(k.y + 0.5 - b.y) > 2.5) continue;
        const dx = k.x - b.x, dz = k.z - b.z;
        if (dx * dx + dz * dz < 2.7 * 2.7 && !k.item && !k.roll && !k.finished) { KL.pickupBox(R, k, b); break; }
      }
    }
    // boost pads
    for (const p of R.pads) {
      for (const k of R.karts) {
        const dx = k.x - p.x, dz = k.z - p.z;
        const fx = Math.sin(p.h), fz = Math.cos(p.h);
        const along = dx * fx + dz * fz, side = dx * -fz + dz * fx;
        if (Math.abs(along) < p.len / 2 && Math.abs(side) < p.w && k.grounded) {
          if (k.boostT < 0.35) { k.boostT = 0.9; k.boostKind = 1; R.events.push({ t: 'pad', id: k.id }); }
          else k.boostT = Math.max(k.boostT, 0.6);
        }
      }
    }
    // kart-kart collisions
    const rr = C.KART_RADIUS * 2;
    for (let i = 0; i < R.karts.length; i++) for (let j = i + 1; j < R.karts.length; j++) {
      const a = R.karts[i], b = R.karts[j];
      if (Math.abs(a.y - b.y) > 2) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, pen = rr - d;
      const ma = a.spinT > 0 ? 0.6 : 1, mb = b.spinT > 0 ? 0.6 : 1;
      a.x -= nx * pen * 0.5; a.z -= nz * pen * 0.5; b.x += nx * pen * 0.5; b.z += nz * pen * 0.5;
      const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rv < 0) {
        const j2 = -(1 + 0.5) * rv / (1 / ma + 1 / mb);
        a.vx -= nx * j2 / ma; a.vz -= nz * j2 / ma; b.vx += nx * j2 / mb; b.vz += nz * j2 / mb;
        if (-rv > 3 && a.bumpT <= 0 && b.bumpT <= 0) { a.bumpT = b.bumpT = 0.2; R.events.push({ t: 'bump', id: a.id, id2: b.id, power: -rv, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, y: a.y }); }
        // a boosting kart rams a slower one: spin it
        if (-rv > 9) { const fast = a.boostT > 0 && a.speed > b.speed + 6 ? a : b.boostT > 0 && b.speed > a.speed + 6 ? b : null; if (fast) KL.hitKart(R, fast === a ? b : a, 'bump', fast); }
      }
    }
    // laps, finish, rescue
    for (const k of R.karts) {
      const idx = Math.floor(k.prog / track.length);
      if (idx > k.maxLap) {
        const prevProg = k.prog - k.vf * dt;
        const over = k.prog - idx * track.length, back = k.prog - (k.prevProg != null ? k.prevProg : prevProg);
        const tCross = R.clock - (back > 0 ? clamp(over / back, 0, 1) : 0) * dt;
        k.maxLap = idx; k.lapIdx = idx;
        if (idx === 0) { k.lapStart = tCross; R.events.push({ t: 'start', id: k.id }); }
        else if (idx >= 1 && !k.finished) {
          const lt = tCross - k.lapStart; k.lapStart = tCross; k.lapTimes.push(lt);
          if (lt < k.bestLap) k.bestLap = lt;
          R.events.push({ t: 'lap', id: k.id, lap: idx, time: lt, best: lt <= k.bestLap });
          if (idx >= R.laps) {
            k.finished = true; k.finishTime = tCross; k.finishOrder = ++R.finishCount; k.auto = true;
            k.totalTime = tCross;
            R.events.push({ t: 'finish', id: k.id, place: k.finishOrder, time: tCross });
          }
        }
      }
      k.prevProg = k.prog;
      if (racing && !k.finished) {
        if (k.stuckT > 2.4 || (k.airT > 5) || k.y < track.minY - 40) { KL.rescueKart(k, track); R.events.push({ t: 'rescue', id: k.id }); }
      }
    }
    updateOrder(R);
    if (R.phase === 'race' && R.humans.length && R.humans.every((h) => h.finished)) { R.phase = 'finished'; R.finishClock = R.clock; }
    if (R.phase === 'race' && !R.humans.length && R.karts.every((k) => k.finished)) { R.phase = 'finished'; R.finishClock = R.clock; }
  }

  /* run the remaining race without rendering until everybody has finished (used for the final standings) */
  function fastForward(R, maxSec) {
    const n = Math.round((maxSec || 120) / C.STEP);
    const saved = R.events.length;
    for (let i = 0; i < n && !R.karts.every((k) => k.finished); i++) { step(R, C.STEP); }
    R.events.length = Math.min(R.events.length, saved);
    return R.karts.every((k) => k.finished);
  }

  KL.standings = function standings(R) {
    const rows = R.karts.map((k) => ({ id: k.id, name: k.name, driver: k.driver, human: k.human, finished: k.finished, time: k.finished ? k.finishTime : null, prog: k.prog, bestLap: isFinite(k.bestLap) ? k.bestLap : null, lapTimes: k.lapTimes.slice() }));
    rows.sort((a, b) => (a.finished && b.finished ? a.time - b.time : a.finished ? -1 : b.finished ? 1 : b.prog - a.prog));
    rows.forEach((r, i) => (r.place = i + 1));
    return rows;
  };
})();
