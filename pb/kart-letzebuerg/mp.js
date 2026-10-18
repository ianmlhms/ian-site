/* Kart Lëtzebuerg — online race netcode (star topology, host-authoritative, WebRTC data channels).
 *
 *  - Every player simulates (and predicts) HIS OWN kart with the normal physics and sends its state at SEND_HZ (unreliable channel).
 *  - The host runs the shared world: bots, item boxes, items/hits, laps and finish order. It relays everybody's state to everybody
 *    in one snapshot per client (unreliable) and sends the discrete events (box, hit, lap, finish, ...) on the reliable channel.
 *  - Remote karts are shown INTERP_DELAY ms in the past, interpolated between snapshots (k.view); the sim collides against that view.
 *  - Host migration: every client mirrors the whole world (karts, items, boxes). The deputy (first client) has direct links to all
 *    other clients (made during the lobby hand-shake), so if the host disappears it simply promotes itself: the bots, items and
 *    remote records it already holds become the new simulation, the other clients switch their uplink to it.
 *  - A player that goes away (tab hidden / silent) is driven by a bot until he is back; a player that leaves becomes a bot.
 * No Supabase traffic happens in here. */
(function () {
  'use strict';
  const KL = window.KL, N = KL.NET, C = KL.CFG;
  const { clamp } = KL;
  const FWD = new Set(['rocketstart', 'stall', 'box', 'shoot', 'drop', 'boost', 'shield', 'shieldpop', 'hit', 'boom', 'splat', 'bounce', 'comet', 'lap', 'start', 'finish', 'rescue', 'pad']);
  const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
  const num = (v, d, lim) => { v = +v; if (!isFinite(v)) return d; return lim ? clamp(v, -lim, lim) : v; };
  const log = (...a) => { if (KL.NET_DEBUG) console.info('[kart-mp]', ...a); };

  const M = (KL.MP = {
    active: false, role: null, R: null, L: null, self: null, myId: '', hostId: '', deputy: null, epoch: 0,
    stats: { snapOut: 0, snapIn: 0, stateOut: 0, stateIn: 0, evOut: 0, evIn: 0, promoted: 0, away: 0 },
    probe: null,
  });

  /* ---------- state packing ---------- */
  function packKart(i, k) {
    const d = k.drift;
    const flags = (k.grounded ? 1 : 0) | (d.state << 1) | (d.level << 3) | (d.dir < 0 ? 32 : 0) | ((k.boostKind & 3) << 6) | (k.spinDir < 0 ? 256 : 0) | (k.finished ? 512 : 0) | (k.surf ? 1024 : 0);
    return [i, r2(k.x), r2(k.y), r2(k.z), r3(k.yaw), r2(k.vx), r2(k.vz), r2(k.vy), r2(k.steer), flags, r2(k.boostT), r2(k.spinT), r2(k.shieldT), r2(k.invuln), r2(k.frozenT), r2(k.hopY), r1(k.prog), r2(k.d), k.tpc | 0];
  }
  function applyState(k, a) {
    k.x = num(a[1], k.x, 5000); k.y = num(a[2], k.y, 2000); k.z = num(a[3], k.z, 5000); k.yaw = num(a[4], k.yaw);
    k.vx = num(a[5], 0, 120); k.vz = num(a[6], 0, 120); k.vy = num(a[7], 0, 120); k.steer = num(a[8], 0, 1);
    const f = a[9] | 0;
    k.grounded = !!(f & 1); k.drift.state = (f >> 1) & 3; k.drift.level = (f >> 3) & 3; k.drift.dir = f & 32 ? -1 : 1;
    k.boostKind = (f >> 6) & 3; k.spinDir = f & 256 ? -1 : 1; k.surf = f & 1024 ? 1 : 0;
    k.boostT = num(a[10], 0, 30); k.spinT = num(a[11], 0, 30); k.shieldT = num(a[12], 0, 30); k.invuln = num(a[13], 0, 30); k.frozenT = num(a[14], 0, 30); k.hopY = num(a[15], 0, 2);
    k.prog = num(a[16], k.prog, 1e6); k.d = num(a[17], 0, 200); k.tpc = a[18] | 0;
    k.speed = Math.hypot(k.vx, k.vz); k.vf = k.vx * Math.sin(k.yaw) + k.vz * Math.cos(k.yaw);
    const L = M.R.track.length; k.s = ((k.prog % L) + L) % L;
    if (k.spinT > 0 && !k.spinTot) k.spinTot = Math.max(k.spinT, 0.5); else if (k.spinT <= 0) k.spinTot = 0;
  }
  function packItem(it) {
    return { n: it.nid, t: it.type, x: r2(it.x || 0), y: r2(it.y || 0), z: r2(it.z || 0), vx: r2(it.vx || 0), vz: r2(it.vz || 0), yaw: r3(it.yaw || 0), s: r1(it.s || 0), ty: r2(it.ty || 0), o: it.owner, g: it.target == null ? null : it.target, a: r2(it.age), l: it.life, sp: r2(it.speed || 0), r: it.r || 1, b: it.bounces | 0 };
  }

  /* ---------- session ---------- */
  M.attach = function (R, start, L) {
    Object.assign(M, { active: true, R, L, role: L.role, myId: L.myId, hostId: start.hostId, deputy: start.deputy || null, epoch: start.epoch || 0, lateralOk: new Set(start.ok || []), resultsDone: false, goAt: 0, lastSend: 0, evIdx: 0, out: [], itemMap: new Map(), base: new Map(), lastRecv: new Map(), lastHostMsg: 0, firstFinish: null, hostAway: false, ended: false, seq: 0, migratedFrom: null });
    M.self = R.byId[L.myId];
    R.nid = 0;
    R.net = { role: M.role, onUse: (k) => M.onUse(k), onRescue: (k) => { k.tpc = (k.tpc | 0) + 1; } };
    R.hold = true;
    for (const k of R.karts) { k.buf = []; k.tpc = 0; k.wasHuman = k.human; }
    document.addEventListener('visibilitychange', M._vis || (M._vis = () => (document.hidden ? M.away() : M.back())));
  };
  M.stop = function () {
    if (!M.active) return;
    M.active = false; M.ended = true;
    if (M.R) { M.R.net = null; M.R.hold = false; }
    document.removeEventListener('visibilitychange', M._vis);
    M.probe = null;
    if (KL.G.mpClosed) KL.G.mpClosed();
  };
  M.go = function (rtt) {
    const R = M.R; R.hold = false;
    R.clock = -C.COUNTDOWN + (M.role === 'client' ? (rtt || 0) / 2000 : 0);
    M.goAt = performance.now(); M.lastHostMsg = M.goAt;
    for (const k of R.karts) M.lastRecv.set(k.id, M.goAt);
    M.evIdx = R.events.length;
    KL.G.mpReveal();
  };
  M.dropBeforeStart = function (id) { const k = M.R && M.R.byId[id]; if (k) convertToBot(k); };

  /* ---------- links ---------- */
  const linkOf = (id) => M.L.links.get(id);
  function sendTo(id, msg, reliable) { const l = linkOf(id); return !!l && l.open && l.send(msg, reliable); }
  function sendAllClients(msg, reliable, except) {
    for (const [id, l] of M.L.links) { if (id === except || !l.open) continue; if (M.role === 'host' && !M.R.byId[id]) continue; l.send(msg, reliable); }
  }
  M.onLinkOpen = function () {};
  M.onRtt = function (from, rtt) { M.rtt = rtt; };

  /* ---------- per-frame ---------- */
  M.tick = function (now) {
    if (!M.active || M.ended) return;
    const R = M.R;
    updateViews(now);
    if (R.hold) return;
    if (now - M.lastSend >= 1000 / N.SEND_HZ) {
      M.lastSend = now;
      if (M.role === 'host') sendSnapshots(now); else sendSelf(now);
    }
    // ---- watchdogs ----
    if (M.role === 'host') {
      for (const k of R.karts) {
        if (!k.remote || !k.human) continue;
        const last = M.lastRecv.get(k.id) || M.goAt;
        if (now - last > N.AWAY_SILENCE && !k.away) setAway(k, true);
      }
      if (M.resumeCheck && now > M.resumeCheck) {
        M.resumeCheck = 0;
        const alive = [...M.L.links.values()].some((l) => l.open && now - l.lastRecv < 2000);
        if (M.hostAway && !alive) M.endRace('rAway');
      }
      checkResults(now);
    } else {
      const silent = now - M.lastHostMsg;
      if (silent > N.HOST_SILENCE) {
        if (M.deputy === M.myId && !M.promoting) M.promote('silence');
        else if (!M.silentSince) M.silentSince = now;
        else if (now - M.silentSince > N.LEAVE_GRACE && !M.resultsDone) M.endRace('rEnded');
      } else M.silentSince = 0;
    }
  };
  M.afterStep = function (R) {
    if (!M.active || M.role !== 'host') return;
    for (let i = M.evIdx; i < R.events.length; i++) {
      const e = R.events[i];
      if (FWD.has(e.t)) M.out.push(e);
    }
    M.evIdx = R.events.length;
    for (const it of R.items) if (!it.nid) it.nid = ++R.nid;
  };
  M.flush = function () {
    if (!M.active) return;
    if (M.out.length && M.role === 'host') {
      sendAllClients({ k: 'e', e: M.out.map(compactEvent) }, true);
      M.stats.evOut += M.out.length;
    }
    M.out = []; M.evIdx = 0;
  };
  function compactEvent(e) {
    const o = {}; for (const key in e) { const v = e[key]; o[key] = typeof v === 'number' ? r2(v) : v; } return o;
  }

  /* ---------- sending ---------- */
  function sendSelf(now) {
    const l = linkOf(M.hostId); if (!l || !l.open || !M.self) return;
    if (l.send({ k: 's', ts: now, a: packKart(M.self.slot, M.self) }, false)) M.stats.stateOut++;
  }
  function sendSnapshots(now) {
    const R = M.R;
    const entries = R.karts.map((k, i) => packKart(i, k));
    const items = R.items.map(packItem);
    let bx = ''; for (const b of R.boxes) bx += b.active ? '1' : '0';
    for (const [id, l] of M.L.links) {
      if (!l.open) continue;
      const rec = R.byId[id]; if (!rec || !rec.human) continue;
      const msg = { k: 'w', q: ++M.seq, ts: now, c: r3(R.clock), ks: entries.filter((e) => e[0] !== rec.slot), it: items, bx, ph: R.phase };
      if (l.send(msg, false)) M.stats.snapOut++;
    }
  }

  /* ---------- receiving ---------- */
  M.onMsg = function (from, m, reliable, link) {
    if (!M.active) return;
    const now = performance.now();
    switch (m.k) {
      case 's': if (M.role === 'host') onState(from, m, now); return;
      case 'w': if (M.role === 'client' && from === M.hostId) onSnapshot(m, now); return;
      case 'e': if (M.role === 'client' && from === M.hostId && Array.isArray(m.e)) { M.lastHostMsg = now; for (const e of m.e.slice(0, 64)) applyEvent(e); M.stats.evIn += m.e.length; } return;
      case 'use': if (M.role === 'host') onUseMsg(from, m); return;
      case 'away': if (M.role === 'host') { const k = M.R.byId[from]; if (k) setAway(k, true); } return;
      case 'back': if (M.role === 'host') { const k = M.R.byId[from]; if (k && k.away) { M.lastRecv.set(from, now); setAway(k, false); } } return;
      case 'resume': if (M.role === 'client' && from === M.hostId) onResume(m); return;
      case 'results': if (from === M.hostId || from === M.migratedFrom) onResults(m); return;
      case 'left': if (M.role === 'client' && (from === M.hostId) && typeof m.id === 'string') onLeft(m.id); return;
      case 'hostchange': onHostChange(from, m); return;
      case 'hostleave': if (from === M.hostId) { if (M.deputy === M.myId) M.promote('left'); else M.silentSince = M.silentSince || now; } return;
      case 'hostaway': if (from === M.hostId) { if (M.deputy === M.myId) M.promote('away'); } return;
      default: return;
    }
  };

  function updateBase(key, arrival, ts) {
    let b = M.base.get(key); const d = arrival - ts;
    if (b == null || d < b) b = d; else b += 0.2;
    M.base.set(key, b); return b;
  }
  function ingest(k, a, te, now) {
    const tp = k.tpc; applyState(k, a);
    if (k.tpc !== tp) k.buf.length = 0;
    const buf = k.buf;
    if (buf.length && te <= buf[buf.length - 1].t) return;           // out of order: the newer sample is already in
    buf.push({ t: te, x: k.x, y: k.y, z: k.z, yaw: k.yaw, vx: k.vx, vz: k.vz });
    if (buf.length > 14) buf.shift();
    k.netAt = now;
  }
  function onState(from, m, now) {
    const R = M.R, a = m.a;
    if (!Array.isArray(a) || a.length < 19) return;
    const k = R.karts[a[0] | 0];
    if (!k || k.id !== from || !k.human) return;                      // a peer may only speak for its own kart
    M.lastRecv.set(from, now);
    if (k.away) { if (now - (k.awayAt || 0) > 300) setAway(k, false); return; }   // bot-driven until it is back (a state packet counts as "back")
    if ((k.resumeUntil || 0) > now) return;                          // its state is being reset by our 'resume'
    const base = updateBase(from, now, num(m.ts, now));
    ingest(k, a, num(m.ts, now) + base, now);
    M.stats.stateIn++;
  }
  function onSnapshot(m, now) {
    const R = M.R;
    M.lastHostMsg = now; M.stats.snapIn++;
    const ts = num(m.ts, now), base = updateBase('host', now, ts), te = ts + base;
    for (const a of m.ks || []) {
      if (!Array.isArray(a)) continue;
      const k = R.karts[a[0] | 0];
      if (!k || k === M.self || !k.remote) continue;
      ingest(k, a, te, now);
    }
    syncItems(m.it || [], now);
    if (typeof m.bx === 'string') for (let i = 0; i < R.boxes.length; i++) {
      const b = R.boxes[i], on = m.bx[i] === '1';
      if (on && !b.active && (b.holdOff || 0) < now) { b.active = true; b.respawn = 0; }
      else if (!on && b.active) { b.active = false; b.respawn = C.ITEM_BOX_RESPAWN; }
    }
    // keep the clock close to the host's (lap/HUD times); slewed, jump only when far off
    const l = linkOf(M.hostId), half = ((l && l.rtt) || 0) / 2000;
    const err = num(m.c, R.clock) + half - R.clock;
    if (Math.abs(err) > 0.4) R.clock += err; else R.clock += err * 0.08;
  }
  function syncItems(list, now) {
    const R = M.R, seen = new Set();
    for (const a of list.slice(0, 64)) {
      if (!a || typeof a.n !== 'number') continue;
      seen.add(a.n);
      let it = M.itemMap.get(a.n);
      if (!it) { it = { nid: a.n, type: a.t }; M.itemMap.set(a.n, it); R.items.push(it); }
      it.type = a.t; it.y = num(a.y, 0); it.z = num(a.z, 0); it.vx = num(a.vx, 0); it.vz = num(a.vz, 0); it.yaw = num(a.yaw, 0); it.s = num(a.s, 0); it.ty = num(a.ty, 0);
      it.owner = a.o; it.target = a.g; it.age = num(a.a, 0); it.life = num(a.l, 10); it.speed = num(a.sp, 0); it.r = num(a.r, 1); it.bounces = a.b | 0;
      it.bx = num(a.x, 0); it.bz = num(a.z, 0); it.x = it.bx; it.at = now;
    }
    for (const [nid, it] of M.itemMap) if (!seen.has(nid)) { const i = R.items.indexOf(it); if (i >= 0) R.items.splice(i, 1); M.itemMap.delete(nid); }
  }

  /* ---------- remote karts: interpolated view ---------- */
  function updateViews(now) {
    const R = M.R, rt = now - N.INTERP_DELAY, dtF = M.lastView ? Math.min(0.1, (now - M.lastView) / 1000) : 0.016;
    M.lastView = now;
    for (const k of R.karts) {
      if (!k.remote) continue;
      const buf = k.buf; if (!buf || !buf.length) continue;
      const v = k.view || (k.view = { x: k.x, y: k.y, z: k.z, yaw: k.yaw });
      const first = buf[0], last = buf[buf.length - 1];
      if (rt >= last.t) {
        const dt = Math.min(rt - last.t, N.EXTRAP_MAX) / 1000;
        v.x = last.x + last.vx * dt; v.z = last.z + last.vz * dt; v.y = last.y; v.yaw = last.yaw;
      } else if (rt <= first.t) { v.x = first.x; v.y = first.y; v.z = first.z; v.yaw = first.yaw; }
      else {
        let i = buf.length - 1; while (i > 0 && buf[i - 1].t > rt) i--;
        const a = buf[i - 1], b = buf[i], u = (rt - a.t) / Math.max(1, b.t - a.t);
        v.x = a.x + (b.x - a.x) * u; v.y = a.y + (b.y - a.y) * u; v.z = a.z + (b.z - a.z) * u;
        let dy = b.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); v.yaw = a.yaw + dy * u;
      }
      k.wheelSpin += k.vf * dtF;
    }
    // items fly on between snapshots
    for (const it of M.itemMap.values()) {
      const dt = Math.min(0.12, (now - it.at) / 1000);
      if (it.type === 'orb') { it.x = it.bx + it.vx * dt; it.z = it.bz + it.vz * dt; }
      else if (it.type === 'rocket') { it.x = it.bx + Math.sin(it.yaw) * it.speed * dt; it.z = it.bz + Math.cos(it.yaw) * it.speed * dt; }
    }
    if (M.probe) M.probe(now);
  }

  /* ---------- events ---------- */
  function applyEvent(e) {
    if (!e || typeof e.t !== 'string') return;
    const R = M.R, me = M.self, k = e.id != null ? R.byId[e.id] : null;
    switch (e.t) {
      case 'box': {
        const b = R.boxes[e.boxId | 0];
        if (b) { b.active = false; b.respawn = C.ITEM_BOX_RESPAWN; b.holdOff = performance.now() + 350; }
        if (k === me && !me.item && !me.roll && KL.ITEMS[e.item]) { me.roll = { t: C.ROULETTE, id: e.item }; me.boxes++; R.events.push({ t: 'box', id: me.id, boxId: e.boxId }); }
        else if (k && k !== me) R.events.push({ t: 'box', id: k.id, boxId: e.boxId });
        return;
      }
      case 'hit':
        if (k === me) { me.invuln = 0; me.frozenT = 0; me.shieldT = 0; me.hitGuard = 0; KL.hitKart(R, me, String(e.kind), e.by ? R.byId[e.by] : null); }
        else R.events.push(e);
        return;
      case 'shieldpop': if (k === me) { me.shieldT = 0; me.invuln = Math.max(me.invuln, 0.5); } R.events.push(e); return;
      case 'boost': case 'shield': if (k !== me) R.events.push(e); return;
      case 'rescue': if (k !== me) R.events.push(e); return;
      case 'lap': if (k) { k.lapIdx = e.lap | 0; k.maxLap = k.lapIdx; k.lapTimes.push(num(e.time, 0)); if (e.time < k.bestLap) k.bestLap = e.time; } R.events.push(e); return;
      case 'start': if (k) { k.lapIdx = 0; k.maxLap = 0; } return;
      case 'finish':
        if (k) { k.finished = true; k.finishTime = num(e.time, 0); k.totalTime = k.finishTime; k.finishOrder = e.place | 0; k.auto = k === me ? true : k.auto; R.finishCount = Math.max(R.finishCount, k.finishOrder); }
        R.events.push(e); return;
      default: if (FWD.has(e.t)) R.events.push(e);
    }
  }

  /* ---------- items used by a client (the host spawns the real projectile) ---------- */
  M.onUse = function (k) {
    const R = M.R, id = k.item.id, back = k.input.brake > 0.4 || k.input.itemBack;
    const l = linkOf(M.hostId); if (l) l.send({ k: 'use', back: !!back, item: id }, true);
    if (id === 'boost' || id === 'boost3' || id === 'shield') KL.useItem(R, k);      // self effects are applied at once, the host only books them
    else k.item = null;
  };
  function onUseMsg(from, m) {
    const k = M.R.byId[from]; if (!k || !k.human || !k.remote) return;
    k.input.brake = m.back ? 1 : 0; k.input.itemBack = false; k.wantItem = true;
  }

  /* ---------- away / leave / conversion ---------- */
  function convertToBot(k) {
    k.remote = false; k.isBot = true; k.human = false; k.auto = false; k.away = false; k.view = null; k.hint = -1; k.ai = null; k.botSkill = k.botSkill || 1; k.rubber = 1;
    const R = M.R; const i = R.humans.indexOf(k); if (i >= 0) R.humans.splice(i, 1);
    k.input.gas = 0; k.input.steer = 0; k.input.drift = false; k.input.brake = 0;
  }
  function setAway(k, on) {
    const R = M.R;
    if (on === !!k.away) return;
    k.away = on; k.awayAt = performance.now(); k.resumeUntil = on ? 0 : performance.now() + 500;
    if (on) {
      M.stats.away++;
      k.remote = false; k.isBot = true; k.hint = -1; k.ai = null; k.botSkill = 1; k.rubber = 1; k.view = null; k.buf.length = 0;
      log('away', k.id);
    } else {
      k.remote = true; k.isBot = false; k.input.gas = 0; k.input.steer = 0; k.input.drift = false; k.input.brake = 0;
      sendTo(k.id, { k: 'resume', st: packKart(k.slot, k), lap: k.lapIdx, lt: k.lapTimes, bl: isFinite(k.bestLap) ? k.bestLap : null, fin: k.finished, ft: k.finishTime, fo: k.finishOrder, item: k.item ? k.item.id : null, cnt: k.item ? k.item.count : 0, c: r3(R.clock) }, true);
      log('back', k.id);
    }
  }
  function onResume(m) {
    const k = M.self, R = M.R; if (!k || !Array.isArray(m.st)) return;
    applyState(k, m.st); k.px = k.x; k.py = k.y; k.pz = k.z; k.pyaw = k.yaw; k.teleported = true; k.tpc = (k.tpc | 0) + 1; k.hint = -1; k.safeS = k.s; k.stuckT = 0; k.wrongT = 0;
    k.lapIdx = m.lap | 0; k.maxLap = k.lapIdx; k.lapTimes = Array.isArray(m.lt) ? m.lt.map((x) => num(x, 0)) : k.lapTimes; if (m.bl != null) k.bestLap = num(m.bl, Infinity);
    k.finished = !!m.fin; k.finishTime = num(m.ft, 0); k.finishOrder = m.fo | 0; if (k.finished) k.auto = true;
    k.item = m.item && KL.ITEMS[m.item] ? { id: m.item, count: Math.max(1, m.cnt | 0) } : null; k.roll = null;
    R.clock = num(m.c, R.clock) + (((linkOf(M.hostId) || {}).rtt || 0) / 2000);
    KL.G.renderer && KL.G.renderer.snapKarts();
    KL.G.toast && KL.G.toast(KL.t('rAway'), 2500);
  }
  M.away = function () {
    if (!M.active || M.ended || M.R.hold) return;
    M.hostAway = M.role === 'host'; M.awayAt = performance.now();
    if (M.role === 'host') { for (const l of M.L.links.values()) if (l.open) l.send({ k: 'hostaway' }, true); }
    else sendTo(M.hostId, { k: 'away' }, true);
  };
  M.back = function () {
    if (!M.active || M.ended || M.R.hold) return;
    if (M.role === 'host') { if (M.hostAway) M.resumeCheck = performance.now() + 1800; }
    else { sendTo(M.hostId, { k: 'back' }, true); M.lastHostMsg = performance.now(); }
  };
  M.onPeerGone = function (id, why) {
    if (!M.active || M.role !== 'host') return;
    const k = M.R.byId[id]; if (!k || !k.human) return;
    convertToBot(k);
    k.name = k.name;
    sendAllClients({ k: 'left', id }, true, id);
    KL.G.toast && KL.G.toast(KL.t('rLeft', { n: k.name }), 2400);
    log('peer gone', id, why);
  };
  function onLeft(id) {
    const k = M.R.byId[id]; if (!k || k === M.self) return;
    convertToBot(k); k.remote = true;                    // still driven by the host; locally just a remote bot
    KL.G.toast && KL.G.toast(KL.t('rLeft', { n: k.name }), 2400);
  }
  M.onLateralClosed = function () {};
  M.onHostLinkClosed = function (reason) {
    if (!M.active || M.ended) return;
    log('host link closed', reason);
    if (M.deputy === M.myId) M.promote('closed');
    else M.silentSince = M.silentSince || performance.now() - N.HOST_SILENCE;
  };
  M.leave = function () {
    if (!M.active) return;
    if (M.role === 'host') for (const l of M.L.links.values()) { if (l.open) l.send({ k: 'hostleave' }, true); }
    else sendTo(M.hostId, { k: 'leave' }, true);
  };

  /* ---------- host migration ---------- */
  M.promote = function (why) {
    if (M.promoting || M.ended || M.role === 'host') return;
    const R = M.R, L = M.L;
    M.promoting = true; M.stats.promoted++;
    const oldHost = R.byId[M.hostId];
    M.migratedFrom = M.hostId; M.epoch++; M.role = 'host'; L.role = 'host'; L.hostId = M.myId; M.hostId = M.myId; R.net.role = 'host';
    L.links.delete(M.migratedFrom);
    // the old host's kart is a bot now; every bot (until now a mirror) is simulated here
    if (oldHost) { convertToBot(oldHost); oldHost.name = oldHost.name; }
    for (const k of R.karts) if (k.isBot) { k.remote = false; k.hint = -1; k.ai = null; k.rubber = 1; }
    let maxNid = 0; for (const it of R.items) { it.hint = null; maxNid = Math.max(maxNid, it.nid || 0); } R.nid = maxNid;
    M.itemMap.clear();
    R.rng = KL.rng(((Date.now() ^ 0x9e3779b9) >>> 0));
    const now = performance.now();
    for (const k of R.karts) M.lastRecv.set(k.id, now);
    for (const id of [...L.links.keys()]) if (!R.byId[id] || !R.byId[id].human) L.links.delete(id);
    for (const k of R.karts) if (k.human && k !== M.self && !L.links.has(k.id)) { /* no link to this player: it cannot follow, its kart turns into a bot */ convertToBot(k); }
    sendAllClients({ k: 'hostchange', epoch: M.epoch, host: M.myId, from: M.migratedFrom, gone: oldHost ? oldHost.id : null }, true);
    KL.G.toast && KL.G.toast(KL.t('rYouNewHost'), 3200);
    M.out = []; M.evIdx = R.events.length;
    M.promoting = false; M.lastSend = 0;
    console.info('[kart-mp] promoted to host (' + why + '), epoch ' + M.epoch);
  };
  function onHostChange(from, m) {
    if (M.role !== 'client' || from !== M.deputy || !M.active) return;
    if ((m.epoch | 0) <= M.epoch) return;
    const old = M.hostId, oldL = linkOf(old);
    M.epoch = m.epoch | 0; M.hostId = from; M.L.hostId = from; M.deputy = null; M.silentSince = 0; M.lastHostMsg = performance.now(); M.migratedFrom = old;
    if (oldL) { oldL.onclose = null; oldL.close('migrated'); M.L.links.delete(old); }
    const oldK = M.R.byId[old]; if (oldK) { const i = M.R.humans.indexOf(oldK); if (i >= 0) M.R.humans.splice(i, 1); oldK.human = false; oldK.isBot = true; }
    const nk = M.R.byId[from];
    KL.G.toast && KL.G.toast(KL.t('rHostLeft', { n: nk ? nk.name : '?' }), 3200);
    for (const k of M.R.karts) { if (k.buf) k.buf.length = 0; }
  }

  /* ---------- results ---------- */
  function checkResults(now) {
    const R = M.R;
    if (M.resultsDone) return;
    const hum = R.karts.filter((k) => k.human);
    if (M.firstFinish == null && hum.some((k) => k.finished)) M.firstFinish = R.clock;
    const deadline = M.firstFinish != null && R.clock - M.firstFinish > N.FINISH_GRACE;
    if (R.phase === 'finished' || (deadline && R.phase === 'race')) M.sendResults();
  }
  M.sendResults = function () {
    if (M.resultsDone) return; M.resultsDone = true;
    const R = M.R;
    for (const k of R.karts) if (k.human && !k.finished && !k.remote) k.auto = true;
    R.fastForward(150);
    const rows = KL.standings(R).map((r) => ({ id: r.id, name: r.name, drv: r.driver.id, human: r.human || (R.byId[r.id] && R.byId[r.id].wasHuman) || false, finished: r.finished, time: r.time, best: r.bestLap, place: r.place }));
    const msg = { k: 'results', rows };
    sendAllClients(msg, true);
    KL.G.mpShowResults(rows);
  };
  function onResults(m) {
    if (M.resultsDone || !Array.isArray(m.rows)) return;
    M.resultsDone = true;
    const rows = m.rows.slice(0, 8).map((r) => ({ id: String(r.id), name: String(r.name || '').slice(0, 14), drv: r.drv, human: !!r.human, finished: !!r.finished, time: r.finished ? num(r.time, 0) : null, best: r.best == null ? null : num(r.best, 0), place: r.place | 0 }));
    KL.G.mpShowResults(rows);
  }
  M.endRace = function (key, vars) {
    if (M.ended) return;
    M.ended = true;
    KL.G.mpEnded(key, vars);
  };
})();
