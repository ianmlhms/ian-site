/* Kart Lëtzebuerg — bot drivers: pure-pursuit on a racing line, safe-speed profile, drifting and item use. */
(function () {
  'use strict';
  const KL = window.KL, C = KL.CFG;
  const { clamp, wrapAngle } = KL;
  const tgt = {};

  KL.botThink = function botThink(k, R, dt) {
    const track = R.track, inp = k.input, diff = R.diff;
    const N = track.N, step = track.step;
    const i0 = k.hint >= 0 ? k.hint : 0;
    const sp = Math.max(k.speed, 0);
    k.ai = k.ai || { t: Math.random() * 3, mistake: 0, mistakeT: 0, driftHold: 0, itemT: 1 + Math.random() * 2, laneJit: 0, laneT: 0, wobble: Math.random() * 6, driftDir: k.drift.dir < 0 ? -1 : 1 };   // a human kart handed to the AI mid-drift (away / left the room) has no drift side yet
    const ai = k.ai;
    ai.t += dt;
    // occasional lane change and small mistakes (more on easy)
    ai.laneT -= dt;
    if (ai.laneT <= 0) { ai.laneT = 2 + Math.random() * 4; ai.laneJit = (Math.random() - 0.5) * 2 * Math.max(1, track.HW[i0] - 4) * 0.6; }
    if (ai.mistakeT > 0) ai.mistakeT -= dt;
    else if (Math.random() < dt * 0.06 * diff.mistakes) { ai.mistakeT = 0.25 + Math.random() * 0.5; ai.mistake = (Math.random() - 0.5) * 0.9; }

    // look-ahead target on the racing line
    const ld = clamp(7 + sp * 0.42, 9, 24);
    const sT = k.s + ld;
    const iT = Math.floor(sT / step) % N;
    let off = track.line[iT] * 0.85 + ai.laneJit * 0.35 + k.lanePref * (track.HW[iT] - 3.4) * 0.5;
    // keep away from traps, projectiles and other karts straight ahead
    let avoid = 0;
    for (const it of R.items) {
      if (it.type !== 'oil' && !(it.type === 'orb' && it.owner !== k.id)) continue;
      const dx = it.x - k.x, dz = it.z - k.z, d = Math.hypot(dx, dz);
      if (d > 28 || d < 1) continue;
      const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
      const ahead = dx * fx + dz * fz;
      if (ahead < 0) continue;
      const lat = dx * -fz + dz * fx;           // positive = right of me
      if (Math.abs(lat) < 3.6) avoid += (lat >= 0 ? -1 : 1) * (1 - Math.abs(lat) / 3.6) * (diff.items * 0.9 + 0.1);
    }
    for (const o of R.karts) {
      if (o === k || o.finished) continue;
      const dx = o.x - k.x, dz = o.z - k.z, d = Math.hypot(dx, dz);
      if (d > 14 || d < 0.5) continue;
      const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
      const ahead = dx * fx + dz * fz;
      if (ahead < 0) continue;
      const lat = dx * -fz + dz * fx;
      if (Math.abs(lat) < 2.6) avoid += (lat >= 0 ? -1 : 1) * 0.5 * (1 - d / 14);
    }
    off += clamp(avoid, -1, 1) * 2.8;
    const hwT = track.HW[iT];
    if (R.hazards && R.hazards.length) {      // fire geysers: if one will be erupting when we get there, take the other side of the road
      for (const h of R.hazards) {
        let ahead = h.s - k.s; if (ahead < -track.length / 2) ahead += track.length; else if (ahead > track.length / 2) ahead -= track.length;
        if (ahead < 1 || ahead > 62 || Math.abs(off - h.d) > h.r + 3.2) continue;
        const eta = ahead / Math.max(sp, 9);
        if (R.hazardState(h, R.clock + eta) !== 2 && R.hazardState(h, R.clock + eta + 0.5) !== 2 && R.hazardState(h, R.clock + eta - 0.4) !== 2) continue;
        off = h.d - (h.d >= 0 ? 1 : -1) * (h.r + 2.6);
      }
    }
    if (track.patches.length) {            // steer round syrup patches
      for (const sx of [sT, k.s + ld * 0.55]) if (track.patchAt(sx, off) === 'goo') { for (const dd of [3.2, -3.2, 6.4, -6.4, 9.6, -9.6]) if (Math.abs(off + dd) < hwT - 2 && !track.patchAt(sx, off + dd)) { off += dd; break; } }
    }
    off = clamp(off, -hwT + 2.2, hwT - 2.2);
    track.at(sT, off, tgt);
    let err = wrapAngle(Math.atan2(tgt.x - k.x, tgt.z - k.z) - k.yaw) + ai.mistake * (ai.mistakeT > 0 ? 1 : 0);
    // steer right when the target is on the right (err negative)
    let steer = clamp(-err * 2.1, -1, 1);

    // speed plan
    const aheadIdx = (i0 + Math.round(clamp(sp * 0.42, 4, 30) / step)) % N;
    let vt = track.vsafe[aheadIdx] * diff.speed * k.botSkill * (R.phase === 'race' || R.phase === 'finished' ? 1 : 0);
    if (k.finished) vt = Math.min(vt, 13);
    // look further for tight corners so we lift early
    const vFar = track.vsafe[(i0 + Math.round(clamp(sp * 1.1, 12, 60) / step)) % N] * 1.12;
    vt = Math.min(vt, Math.max(vFar, 8));
    if (k.surf === 1 && k.boostT <= 0) vt = Math.min(vt, 22);
    if (k.patch === 'ice') vt *= 0.8;
    let gas = sp < vt ? 1 : 0, brake = 0;
    if (sp > vt * 1.1) brake = clamp((sp - vt * 1.1) / 7, 0, 1);
    if (R.phase === 'countdown') { gas = 0; brake = 0; }
    if (k.rubber == null) k.rubber = 1;

    // drifting through longer corners
    let wantDrift = false;
    const kk = (off2) => track.K[(i0 + Math.round(off2 / step)) % N];
    const curveNear = (kk(8) + kk(18) + kk(30)) / 3;
    if (diff.drift > 0 && sp > 15 && R.phase === 'race') {
      const ak = Math.abs(curveNear);
      if (k.drift.state === 0 && k.grounded) {
        if (ak > 0.021 && Math.abs(kk(8)) > 0.012 && Math.abs(kk(28)) > 0.015 && Math.sign(kk(8)) === Math.sign(kk(28)) && Math.random() < diff.drift) {
          wantDrift = true; ai.driftDir = Math.sign(curveNear) > 0 ? -1 : 1;      // left turn (K>0) => steer left (-1)
          ai.driftHold = 0;
        }
      } else if (k.drift.state > 0) {
        ai.driftHold += dt;
        const stillTurning = Math.abs(kk(6)) > 0.01 && Math.sign(kk(6)) === (ai.driftDir > 0 ? -1 : 1);
        const long = k.drift.level >= 2 && ak < 0.02;
        wantDrift = stillTurning && !long && ai.driftHold < 4.5;
        // inside a drift the input maps differently: steer into the drift direction, ease off with the line error
        steer = clamp(ai.driftDir * 0.6 + (-err * 1.2), -1, 1);
        if (k.drift.state === 2) steer = ai.driftDir * clamp(0.45 + Math.abs(err) * 1.5 * (Math.sign(-err) === ai.driftDir ? 1 : -0.6), 0.15, 1);
        if (k.drift.state === 1) steer = ai.driftDir * 0.8;
      }
    }
    if (!isFinite(steer)) steer = 0;     // never let a NaN reach the kart state (it would poison the position and progress)
    // starting boost for the bots
    inp.steer = steer; inp.gas = gas; inp.brake = brake; inp.drift = wantDrift; inp.item = false;

    // items
    if (k.item && k.itemCool <= 0 && R.phase === 'race') {
      ai.itemT -= dt;
      if (ai.itemT <= 0) {
        const id = k.item.id;
        let use = false;
        const behind = R.order[R.order.indexOf(k) + 1], ahead = R.order[R.order.indexOf(k) - 1];
        const gapBehind = behind ? k.prog - behind.prog : 999, gapAhead = ahead ? ahead.prog - k.prog : 999;
        const straight = Math.abs(curveNear) < 0.012;
        if (id === 'boost' || id === 'boost3') use = straight || Math.random() < 0.01;
        else if (id === 'shield') use = (gapBehind < 25 && Math.random() < 0.05) || ai.itemWait > 6;
        else if (id === 'oil') use = gapBehind < 16 && gapBehind > 2;
        else if (id === 'orb') use = (gapAhead < 34 && gapAhead > 4 && Math.abs((ahead.d - k.d)) < 5) || ai.itemWait > 9;
        else if (id === 'rocket') use = !!ahead || ai.itemWait > 4;
        else if (id === 'comet') use = true;
        ai.itemWait = (ai.itemWait || 0) + 0.25;
        ai.itemT = 0.25 + Math.random() * 0.35 / Math.max(0.2, diff.items);
        if (use && Math.random() < 0.4 + 0.6 * diff.items) { inp.item = true; ai.itemWait = 0; ai.itemT = 0.8 + Math.random() * 1.5; }
      }
    } else ai.itemWait = 0;
  };
})();
