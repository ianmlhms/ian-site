/* Kart Lëtzebuerg — items: item boxes, rolling, using, projectiles and traps. Part of the simulation (no rendering). */
(function () {
  'use strict';
  const KL = window.KL, C = KL.CFG;
  const { clamp, wrapAngle } = KL;
  const tmp = {};

  KL.makeBoxes = function makeBoxes(track) {
    const def = track.def, boxes = [];
    const rows = def.boxes || (() => { const out = []; const n = Math.max(3, Math.round(track.length / 210)); for (let i = 0; i < n; i++) out.push([track.length * (i + 0.45) / n, 4]); return out; })();
    for (const [s, count] of rows) {
      const hw = track.at(s, 0).hw;
      const span = Math.min(hw * 1.5, (count - 1) * 3.2);
      for (let k = 0; k < count; k++) {
        const d = count === 1 ? 0 : -span / 2 + (span * k) / (count - 1);
        const p = track.at(s, d);
        boxes.push({ x: p.x, y: p.y + 1.1, z: p.z, s, d, active: true, respawn: 0, id: boxes.length });
      }
    }
    for (const [s, d] of def.extraBoxes || []) { const p = track.at(s, d); boxes.push({ x: p.x, y: p.y + 1.1, z: p.z, s, d, active: true, respawn: 0, id: boxes.length }); }   // item boxes off the racing line (shortcuts)
    for (const b of track.branches || []) for (const [qs, count] of b.def.boxes || []) {      // item boxes on a shortcut (qs: metres along the cut)
      const span = Math.min(b.T.HW[0] * 1.5, (count - 1) * 3.2);
      for (let k = 0; k < count; k++) { const d = count === 1 ? 0 : -span / 2 + (span * k) / (count - 1), p = b.T.at(qs, d); boxes.push({ x: p.x, y: p.y + 1.1, z: p.z, s: b.map(qs), d, active: true, respawn: 0, id: boxes.length }); }
    }
    return boxes;
  };

  /* roll an item for a kart in the given place (1-based) */
  KL.rollItem = function rollItem(R, k) {
    const n = R.karts.length;
    // fewer karts: compress the place into the 8-row table
    const idx = n >= 8 ? k.place - 1 : Math.round(((k.place - 1) / Math.max(1, n - 1)) * 7);
    const odds = KL.ITEM_ODDS[clamp(idx, 0, 7)];
    let total = 0; odds.forEach((w) => (total += w));
    let r = R.rng() * total, pick = 0;
    for (let i = 0; i < odds.length; i++) { r -= odds[i]; if (r <= 0) { pick = i; break; } }
    const id = KL.ITEM_ORDER[pick];
    // the comet hits first place: pointless when no one is ahead
    return id;
  };

  KL.pickupBox = function pickupBox(R, k, box) {
    if (k.item || k.roll) return false;
    box.active = false; box.respawn = C.ITEM_BOX_RESPAWN;
    const id = KL.rollItem(R, k);
    k.roll = { t: C.ROULETTE, id };
    k.boxes++;
    R.events.push({ t: 'box', id: k.id, boxId: box.id, item: id });
    return true;
  };

  function aheadOf(R, k, n) {   // nth kart ahead (by place), or null
    const order = R.order;
    const i = order.indexOf(k);
    return i - n >= 0 ? order[i - n] : null;
  }

  KL.useItem = function useItem(R, k) {
    const it = k.item; if (!it || k.itemCool > 0) return false;
    const track = R.track;
    const back = k.input.brake > 0.4 || k.input.itemBack;
    const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
    let consumed = true;
    switch (it.id) {
      case 'oil': {
        R.items.push({ type: 'oil', x: k.x - fx * 3.4, z: k.z - fz * 3.4, y: k.y, owner: k.id, age: 0, life: 40, r: 2.4 });
        R.events.push({ t: 'drop', id: k.id });
        break;
      }
      case 'orb': {
        const dir = back ? -1 : 1, sp = 56;
        R.items.push({ type: 'orb', x: k.x + fx * 2.4 * dir, z: k.z + fz * 2.4 * dir, y: k.y + 0.7, vx: fx * sp * dir + k.vx * 0.2, vz: fz * sp * dir + k.vz * 0.2, owner: k.id, age: 0, life: 7, bounces: 0, r: 1.3 });
        R.events.push({ t: 'shoot', id: k.id });
        break;
      }
      case 'rocket': {
        const target = aheadOf(R, k, 1);
        R.items.push({ type: 'rocket', x: k.x + fx * 2.5, z: k.z + fz * 2.5, y: k.y + 0.9, yaw: k.yaw, owner: k.id, target: target ? target.id : null, age: 0, life: 11, speed: Math.max(k.speed + 8, 36), r: 1.7 });
        R.events.push({ t: 'shoot', id: k.id, kind: 'rocket' });
        break;
      }
      case 'shield':
        k.shieldT = 10; R.events.push({ t: 'shield', id: k.id });
        break;
      case 'boost':
        k.boostT = Math.max(k.boostT, 1.35); k.boostKind = 1; k.vx += fx * 4; k.vz += fz * 4; R.events.push({ t: 'boost', id: k.id });
        break;
      case 'boost3':
        k.boostT = Math.max(k.boostT, 1.1); k.boostKind = 1; k.vx += fx * 3.5; k.vz += fz * 3.5; R.events.push({ t: 'boost', id: k.id });
        it.count = (it.count || 3) - 1; consumed = it.count <= 0; k.itemCool = 0.45;
        break;
      case 'comet': {
        const lead = R.order.find((o) => o !== k && !o.finished);
        R.items.push({ type: 'comet', s: k.prog, y: 32, owner: k.id, target: lead ? lead.id : null, age: 0, life: 14, speed: 80 });
        R.events.push({ t: 'comet', id: k.id, target: lead ? lead.id : null });
        break;
      }
    }
    if (consumed) k.item = null;
    return true;
  };

  function explode(R, x, z, radius, kind, owner, y) {
    R.events.push({ t: 'boom', x, z, y: y || 0, kind });
    for (const o of R.karts) {
      if (o.id === owner && kind !== 'comet') { /* owner of a comet is never hit; a rocket may hit its owner only through direct impact */ }
      if (o.id === owner) continue;
      const d = Math.hypot(o.x - x, o.z - z);
      if (d < radius) KL.hitKart(R, o, kind, R.byId[owner]);
    }
  }

  KL.updateItems = function updateItems(R, dt) {
    const track = R.track, items = R.items;
    for (let n = items.length - 1; n >= 0; n--) {
      const it = items[n];
      it.age += dt;
      let dead = it.age > it.life;
      if (it.type === 'oil') {
        if (it.age > 0.35) for (const k of R.karts) {
          if (k.y - it.y > 2) continue;
          const d = Math.hypot(k.x - it.x, k.z - it.z);
          if (d < it.r + 0.6) { if (KL.hitKart(R, k, 'oil', R.byId[it.owner])) { dead = true; R.events.push({ t: 'splat', x: it.x, z: it.z }); break; } else if (k.shieldT <= 0 && k.invuln > 0) continue; else { dead = true; break; } }
        }
      } else if (it.type === 'orb') {
        it.x += it.vx * dt; it.z += it.vz * dt;
        const p = track.loc(it, it.x, it.z, it.y - 0.7, tmp);
        it.hint = p.i;
        const lim = p.hw + (p.d >= 0 ? p.wr : p.wl) - 0.8;
        if (Math.abs(p.d) > lim) {
          const side = p.d >= 0 ? 1 : -1, nx = -p.tz * side, nz = p.tx * side;   // outward normal
          const vn = it.vx * nx + it.vz * nz;
          if (vn > 0) { it.vx -= 2 * vn * nx; it.vz -= 2 * vn * nz; it.bounces++; it.x -= nx * (Math.abs(p.d) - lim + 0.1); it.z -= nz * (Math.abs(p.d) - lim + 0.1); R.events.push({ t: 'bounce', x: it.x, z: it.z }); }
          if (it.bounces > 3) dead = true;
        }
        it.y = p.y + 0.8;
        for (const k of R.karts) {
          if (it.age < 0.25 && k.id === it.owner) continue;
          if (Math.hypot(k.x - it.x, k.z - it.z) < it.r + 0.9 && Math.abs(k.y - it.y) < 2.5) { KL.hitKart(R, k, 'orb', R.byId[it.owner]); R.events.push({ t: 'boom', x: it.x, z: it.z, y: it.y, kind: 'orb' }); dead = true; break; }
        }
      } else if (it.type === 'rocket') {
        const tgt = it.target != null ? R.byId[it.target] : null;
        let tx, tz;
        const p = track.loc(it, it.x, it.z, it.y - 0.9, tmp);
        it.hint = p.i;
        if (tgt && !tgt.finished) {
          const dist = Math.hypot(tgt.x - it.x, tgt.z - it.z);
          if (dist < 40) { tx = tgt.x; tz = tgt.z; }
          else { const q = p.T.at(p.ss + 16, clamp(tgt.d, -p.hw * 0.7, p.hw * 0.7)); tx = q.x; tz = q.z; }
        } else { const q = p.T.at(p.ss + 16, clamp(p.d, -p.hw * 0.6, p.hw * 0.6)); tx = q.x; tz = q.z; }
        const want = Math.atan2(tx - it.x, tz - it.z), err = wrapAngle(want - it.yaw);
        it.yaw += clamp(err, -4.2 * dt, 4.2 * dt);
        it.x += Math.sin(it.yaw) * it.speed * dt; it.z += Math.cos(it.yaw) * it.speed * dt;
        it.y = p.y + 0.9 + Math.sin(it.age * 18) * 0.06;
        const lim = p.hw + (p.d >= 0 ? p.wr : p.wl) - 0.5;
        if (Math.abs(p.d) > lim) { const side = p.d >= 0 ? 1 : -1; it.x -= -p.tz * side * (Math.abs(p.d) - lim); it.z -= p.tx * side * (Math.abs(p.d) - lim); }
        for (const k of R.karts) {
          if (k.id === it.owner && it.age < 1.2) continue;
          if (Math.hypot(k.x - it.x, k.z - it.z) < it.r + 0.8 && Math.abs(k.y - it.y) < 2.5) { explode(R, it.x, it.z, 4.5, 'rocket', it.owner, it.y); dead = true; break; }
        }
      } else if (it.type === 'comet') {
        let tgt = R.order.find((o) => o.id !== it.owner && !o.finished) || null;
        if (it.target != null && R.byId[it.target] && !R.byId[it.target].finished && R.order.indexOf(R.byId[it.target]) <= 1) tgt = R.byId[it.target];
        it.target = tgt ? tgt.id : null;
        it.s += it.speed * dt;
        if (tgt) {
          // closing in on the target along the track, then dive
          const gap = (tgt.prog + 0) - it.s;
          if (gap < 50) it.y = Math.max(0, it.y - dt * 38);
          if (gap < 3 || it.y <= 1 || it.age > 9) { explode(R, tgt.x, tgt.z, 8, 'comet', it.owner, tgt.y); dead = true; }
          else if (gap > 0) { /* still on the way */ }
          else it.s = tgt.prog;
        } else dead = true;
        const q = track.at(it.s, tgt ? tgt.d : 0); it.x = q.x; it.z = q.z; it.ty = q.y;
      }
      if (dead) items.splice(n, 1);
    }
  };
})();
