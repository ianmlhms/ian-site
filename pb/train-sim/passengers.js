/* Lokféierer: passengers (C). Instanced low-poly people with per-limb meshes.
 * TS.passengers.create(scene, { quality }) -> { spawnPlatform, startExchange, stopExchange, update, stats, clear, dispose, setRain }
 * All motion happens in platform coordinates (s along the track, o = lateral distance from the track centre). */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});

  const CAP = { high: 150, medium: 80, low: 40 };
  const CROWD_SHARE = 0.65;
  const TAB_STEP = 2;
  const DEFAULT_EDGE = 1.75, DEFAULT_WIDTH = 4.5, DEFAULT_PLAT_H = 0.9;
  const SINK_DEPTH = 1.7;
  const HIP_Y = 0.88, KNEE_DROP = 0.44, SHOULDER_Y = 1.36, SHOULDER_X = 0.255, NECK_Y = 1.4;
  const WALK_SPEED = [1.15, 1.55], RUN_SPEED = 4.6, RUNNER_CHANCE = 0.2;
  const ALIGHT_GAP = 0.8, BOARD_GAP = 1.2;
  const ALIGHT_MAX_S = 16, BOARD_MAX_S = 22;
  const QUEUE_LATERAL = [-0.85, 0.85, -1.5, 1.5, -2.15, 2.15];
  const SEPARATION = 0.44;
  const DEFAULT_COUNT = { 1: 8, 2: 20, 3: 40 };

  const SKIN = [0xf3d2b3, 0xe6b48f, 0xc98e63, 0x9a6540, 0x6b4328, 0x4a2f1e];
  const HAIR = [0x16110d, 0x2b1c12, 0x4a3020, 0x7a5232, 0xc9a35b, 0xa8501f, 0x9a9a9a, 0xe4d7a8];
  const SHIRT = [0x2f5d9e, 0xb23a3a, 0x3d7a4d, 0xe0b73a, 0x6a4c93, 0xe8e6df, 0x2b2b30, 0x37a3a3, 0xd9762b, 0x8c8c94, 0x4c6a8c, 0xd96a8c, 0x5e7a3a, 0x1d3557];
  const TROUSER = [0x1f3552, 0x2b2b30, 0x3d4b63, 0x6b5a45, 0x8c8c8c, 0x1a1a1f, 0x4a5a78, 0x5a4636, 0x3a4a3a];
  const BAG = [0x2b2b30, 0x1f3552, 0xb23a3a, 0x3d7a4d, 0x8a5a2b, 0x6a4c93, 0xd9762b];
  const BRIGHT = [0xd93b3b, 0x2f6fb5, 0xe3b21f, 0x2f9a6a, 0x8a4fb5, 0x2b2b30];

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const chance = (p) => Math.random() < p;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angleDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

  // ---------------------------------------------------------------- geometry
  function xf(THREE, x, y, z, rx, ry, rz, sx, sy, sz) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, 'XYZ'));
    return new THREE.Matrix4().compose(new THREE.Vector3(x || 0, y || 0, z || 0), q, new THREE.Vector3(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));
  }
  function merge(THREE, parts) {
    const pos = [], nor = [], col = [];
    parts.forEach((pt) => {
      const g = pt.geo.index ? pt.geo.toNonIndexed() : pt.geo.clone();
      if (pt.m) g.applyMatrix4(pt.m);
      g.computeVertexNormals();
      const p = g.attributes.position.array, n = g.attributes.normal.array;
      const c = new THREE.Color(pt.col == null ? 0xffffff : pt.col);
      for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
      for (let v = 0; v < p.length / 3; v++) col.push(c.r, c.g, c.b);
      g.dispose();
      pt.geo.dispose();
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return out;
  }

  function buildGeometries(THREE) {
    const P = (geo, col, m) => ({ geo, col, m });
    const g = {};
    const dark = 0x1c1c20;
    g.torso = merge(THREE, [
      P(new THREE.CylinderGeometry(0.205, 0.17, 0.58, 8, 1), 0xffffff, xf(THREE, 0, 1.13, 0, 0, 0, 0, 1, 1, 0.64)),
      P(new THREE.SphereGeometry(0.075, 6, 4), 0xffffff, xf(THREE, SHOULDER_X - 0.02, 1.37, 0)),
      P(new THREE.SphereGeometry(0.075, 6, 4), 0xffffff, xf(THREE, -(SHOULDER_X - 0.02), 1.37, 0)),
      P(new THREE.CylinderGeometry(0.172, 0.172, 0.05, 8, 1), 0x2a1f18, xf(THREE, 0, 0.86, 0, 0, 0, 0, 1, 1, 0.64)),
      P(new THREE.BoxGeometry(0.34, 0.14, 0.2), 0x55555a, xf(THREE, 0, 0.84, 0)),
    ]);
    g.head = merge(THREE, [
      P(new THREE.CylinderGeometry(0.046, 0.05, 0.12, 6, 1), 0xffffff, xf(THREE, 0, 0.05, 0)),
      P(new THREE.SphereGeometry(0.105, 9, 7), 0xffffff, xf(THREE, 0, 0.27, 0, 0, 0, 0, 1, 1.18, 1.06)),
      P(new THREE.BoxGeometry(0.03, 0.04, 0.045), 0xf2f2f2, xf(THREE, 0, 0.25, 0.12)),
      P(new THREE.BoxGeometry(0.024, 0.028, 0.02), 0x14100e, xf(THREE, 0.042, 0.292, 0.108)),
      P(new THREE.BoxGeometry(0.024, 0.028, 0.02), 0x14100e, xf(THREE, -0.042, 0.292, 0.108)),
      P(new THREE.BoxGeometry(0.03, 0.05, 0.03), 0xeeeeee, xf(THREE, 0.108, 0.27, -0.005)),
      P(new THREE.BoxGeometry(0.03, 0.05, 0.03), 0xeeeeee, xf(THREE, -0.108, 0.27, -0.005)),
    ]);
    g.hairShort = merge(THREE, [
      P(new THREE.SphereGeometry(0.116, 9, 6, 0, Math.PI * 2, 0, 1.9), 0xffffff, xf(THREE, 0, 0.285, -0.014, -0.42, 0, 0, 1, 1.18, 1.06)),
    ]);
    g.hairLong = merge(THREE, [
      P(new THREE.BoxGeometry(0.21, 0.3, 0.085), 0xffffff, xf(THREE, 0, 0.18, -0.09)),
      P(new THREE.BoxGeometry(0.05, 0.2, 0.09), 0xffffff, xf(THREE, 0.095, 0.2, -0.04)),
      P(new THREE.BoxGeometry(0.05, 0.2, 0.09), 0xffffff, xf(THREE, -0.095, 0.2, -0.04)),
    ]);
    g.hat = merge(THREE, [
      P(new THREE.SphereGeometry(0.128, 9, 6, 0, Math.PI * 2, 0, 1.2), 0xffffff, xf(THREE, 0, 0.29, -0.012, -0.12, 0, 0, 1, 1.1, 1.08)),
      P(new THREE.CylinderGeometry(0.1235, 0.1235, 0.032, 9, 1), 0xd8d8d8, xf(THREE, 0, 0.318, -0.012, -0.12, 0, 0, 1, 1, 1.08)),
    ]);
    g.thigh = merge(THREE, [P(new THREE.CylinderGeometry(0.088, 0.07, KNEE_DROP, 6, 1), 0xffffff, xf(THREE, 0, -KNEE_DROP / 2, 0))]);
    g.shin = merge(THREE, [
      P(new THREE.CylinderGeometry(0.066, 0.052, 0.36, 6, 1), 0xffffff, xf(THREE, 0, -0.18, 0)),
      P(new THREE.BoxGeometry(0.1, 0.08, 0.25), 0x34302c, xf(THREE, 0, -0.4, 0.055)),
      P(new THREE.BoxGeometry(0.102, 0.022, 0.255), 0xe8e8e8, xf(THREE, 0, -0.436, 0.055)),
    ]);
    g.arm = merge(THREE, [P(new THREE.CylinderGeometry(0.055, 0.045, 0.5, 6, 1), 0xffffff, xf(THREE, 0, -0.25, 0))]);
    g.hand = merge(THREE, [P(new THREE.IcosahedronGeometry(0.05, 0), 0xffffff, xf(THREE, 0, -0.56, 0))]);
    g.pack = merge(THREE, [
      P(new THREE.BoxGeometry(0.31, 0.42, 0.15), 0xffffff, xf(THREE, 0, 1.16, -0.185)),
      P(new THREE.BoxGeometry(0.22, 0.2, 0.05), 0xb8b8b8, xf(THREE, 0, 1.06, -0.285)),
      P(new THREE.BoxGeometry(0.035, 0.04, 0.28), dark, xf(THREE, 0.12, 1.4, -0.06)),
      P(new THREE.BoxGeometry(0.035, 0.04, 0.28), dark, xf(THREE, -0.12, 1.4, -0.06)),
    ]);
    g.case = merge(THREE, [
      P(new THREE.BoxGeometry(0.38, 0.56, 0.22), 0xffffff, xf(THREE, 0, 0.35, 0)),
      P(new THREE.BoxGeometry(0.39, 0.04, 0.23), 0x404048, xf(THREE, 0, 0.35, 0)),
      P(new THREE.BoxGeometry(0.03, 0.34, 0.03), 0x303036, xf(THREE, 0, 0.78, -0.04)),
      P(new THREE.BoxGeometry(0.2, 0.03, 0.04), dark, xf(THREE, 0, 0.95, -0.04)),
      P(new THREE.BoxGeometry(0.05, 0.05, 0.05), dark, xf(THREE, 0.15, 0.03, 0.07)),
      P(new THREE.BoxGeometry(0.05, 0.05, 0.05), dark, xf(THREE, -0.15, 0.03, 0.07)),
    ]);
    g.umbrella = merge(THREE, [
      P(new THREE.CylinderGeometry(0.012, 0.012, 0.98, 4, 1), dark, xf(THREE, 0, 0.49, 0)),
      P(new THREE.ConeGeometry(0.58, 0.22, 10, 1, true), 0xffffff, xf(THREE, 0, 0.93, 0)),
    ]);
    g.phone = merge(THREE, [
      P(new THREE.BoxGeometry(0.07, 0.135, 0.012), 0x101014, xf(THREE, 0, 0, 0)),
      P(new THREE.BoxGeometry(0.06, 0.115, 0.004), 0x9ec8ff, xf(THREE, 0, 0, 0.008)),
    ]);
    return g;
  }

  // ---------------------------------------------------------------- factory
  function create(scene, opts) {
    const THREE = window.THREE;
    const quality = (opts && opts.quality) || 'medium';
    const cap = CAP[quality] || CAP.medium;
    const crowdCap = Math.floor(cap * CROWD_SHARE);
    const castShadow = quality !== 'low';
    const geos = buildGeometries(THREE);
    const matLit = new THREE.MeshLambertMaterial({ vertexColors: true });
    const matUmb = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const group = new THREE.Group();
    group.name = 'ts-passengers';
    scene.add(group);

    const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
    const white = new THREE.Color(0xffffff);
    const cTmp = new THREE.Color();
    const mB = new THREE.Matrix4(), mU = new THREE.Matrix4(), mL = new THREE.Matrix4(), mT = new THREE.Matrix4(), mA = new THREE.Matrix4(), mO = new THREE.Matrix4(), mR = new THREE.Matrix4();
    const vP = new THREE.Vector3(), vS = new THREE.Vector3(), qQ = new THREE.Quaternion(), eU = new THREE.Euler(0, 0, 0, 'YXZ'), eH = new THREE.Euler(0, 0, 0, 'XYZ');

    function mesh(geo, perPerson, mat, shadow) {
      const m = new THREE.InstancedMesh(geo, mat || matLit, cap * perPerson);
      m.frustumCulled = false;
      m.castShadow = !!shadow && castShadow;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < cap * perPerson; i++) { m.setMatrixAt(i, ZERO); m.setColorAt(i, white); }
      m.count = 0;
      group.add(m);
      return m;
    }
    const M = {
      torso: mesh(geos.torso, 1, null, true), head: mesh(geos.head, 1, null, true), hairShort: mesh(geos.hairShort, 1), hairLong: mesh(geos.hairLong, 1), hat: mesh(geos.hat, 1),
      thigh: mesh(geos.thigh, 2, null, true), shin: mesh(geos.shin, 2, null, true), arm: mesh(geos.arm, 2, null, true), hand: mesh(geos.hand, 2),
      pack: mesh(geos.pack, 1, null, true), case: mesh(geos.case, 1, null, true), umbrella: mesh(geos.umbrella, 1, matUmb, false), phone: mesh(geos.phone, 1),
    };
    const MESHES = Object.keys(M).map((k) => M[k]);
    const PAIR = { thigh: 1, shin: 1, arm: 1, hand: 1 };

    // ------------------------------------------------------------ state
    const people = [];
    for (let i = 0; i < cap; i++) people.push({ slot: i, active: false });
    let highSlot = -1, colorsDirty = false, rainOn = false, clock = 0;
    let plat = null, ex = null;
    const counters = { alighted: 0, boarded: 0, alightingTotal: 0, boardingTotal: 0 };

    function put(mesh2, idx, m) { m.toArray(mesh2.instanceMatrix.array, idx * 16); }
    function setCol(mesh2, idx, hex) { cTmp.setHex(hex); mesh2.setColorAt(idx, cTmp); }
    function refreshCounts() {
      const n = highSlot + 1;
      MESHES.forEach((m) => { const k = m.count; m.count = n * (m === M.thigh || m === M.shin || m === M.arm || m === M.hand ? 2 : 1); if (k !== m.count) m.instanceMatrix.needsUpdate = true; });
    }
    function activeCount(fn) { let n = 0; for (let i = 0; i <= highSlot; i++) { const p = people[i]; if (p.active && (!fn || fn(p))) n++; } return n; }
    function freeSlots() { return cap - activeCount(); }

    // ------------------------------------------------------------ platform table
    function buildPlatform(station, track, o) {
      const ps = Math.min(station.platformStart, station.platformEnd), pe = Math.max(station.platformStart, station.platformEnd);
      const s0 = ps - 12, s1 = pe + 12, n = Math.min(600, Math.ceil((s1 - s0) / TAB_STEP) + 1);
      const side = o.side || station.side || 'right', sign = side === 'left' ? -1 : 1;
      const t = { px: new Float32Array(n), py: new Float32Array(n), pz: new Float32Array(n), tx: new Float32Array(n), tz: new Float32Array(n), rx: new Float32Array(n), rz: new Float32Array(n) };
      for (let i = 0; i < n; i++) {
        const f = track.frameAt(s0 + i * TAB_STEP);
        t.px[i] = f.pos.x; t.py[i] = f.pos.y; t.pz[i] = f.pos.z;
        const tl = Math.hypot(f.tangent.x, f.tangent.z) || 1;
        t.tx[i] = f.tangent.x / tl; t.tz[i] = f.tangent.z / tl;
        const rl = Math.hypot(f.right.x, f.right.z) || 1;
        t.rx[i] = (f.right.x / rl) * sign; t.rz[i] = (f.right.z / rl) * sign;
      }
      const edge = o.edgeOffset == null ? DEFAULT_EDGE : o.edgeOffset, width = o.width == null ? DEFAULT_WIDTH : o.width;
      const mid = (ps + pe) / 2;
      return {
        station, side, sign, s0, s1, n, t, ps, pe, edge, width, back: edge + width, h: o.platformHeight == null ? DEFAULT_PLAT_H : o.platformHeight,
        trainLength: o.trainLength || Math.min(pe - ps - 8, 110),
        exits: [
          { kind: 'end', dir: -1, out: ps - 5, inn: ps + 1.5 },
          { kind: 'end', dir: 1, out: pe + 5, inn: pe - 1.5 },
          { kind: 'mid', dir: 0, s: clamp(station.s - 14, ps + 6, pe - 6) || mid },
          { kind: 'mid', dir: 0, s: clamp(station.s - 52, ps + 6, pe - 6) || mid },
        ],
      };
    }
    const smp = { x: 0, y: 0, z: 0, tx: 1, tz: 0, rx: 0, rz: 1 };
    function sample(s) {
      const t = plat.t, f = clamp((s - plat.s0) / TAB_STEP, 0, plat.n - 1.0001), i = f | 0, k = f - i, j = Math.min(plat.n - 1, i + 1);
      smp.x = t.px[i] + (t.px[j] - t.px[i]) * k; smp.y = t.py[i] + (t.py[j] - t.py[i]) * k; smp.z = t.pz[i] + (t.pz[j] - t.pz[i]) * k;
      smp.tx = t.tx[i] + (t.tx[j] - t.tx[i]) * k; smp.tz = t.tz[i] + (t.tz[j] - t.tz[i]) * k;
      smp.rx = t.rx[i] + (t.rx[j] - t.rx[i]) * k; smp.rz = t.rz[i] + (t.rz[j] - t.rz[i]) * k;
      return smp;
    }
    function projectWorld(x, z) {
      let s = plat.station.s;
      for (let it = 0; it < 4; it++) { sample(s); s += (x - smp.x) * smp.tx + (z - smp.z) * smp.tz; }
      sample(s);
      return { s, o: (x - smp.x) * smp.rx + (z - smp.z) * smp.rz };
    }
    function worldDir(s, a, b) { sample(s); return { x: smp.tx * a + smp.rx * b, z: smp.tz * a + smp.rz * b }; }

    // ------------------------------------------------------------ people
    function allocSlot() { for (let i = 0; i < cap; i++) if (!people[i].active) return i; return -1; }

    function makePerson(kind, s, o, o2) {
      const idx = allocSlot();
      if (idx < 0) return null;
      const kid = !(o2 && o2.adult) && chance(o2 && o2.kid ? 1 : 0.07);
      const long = !kid && chance(0.4), hasHat = chance(0.14);
      const hasCase = !kid && chance(0.17), hasPack = !hasCase && chance(kid ? 0.5 : 0.3);
      const p = {
        slot: idx, active: true, kind, s, o, yOff: 0, segLen: 1, yaw: 0, fs: 0, fo: -1, mode: 'idle', then: 'idle', path: [], pi: 0, door: null,
        sc: kid ? rnd(0.62, 0.76) : rnd(0.93, 1.06), kid, speed: 0, base: rnd(WALK_SPEED[0], WALK_SPEED[1]) * (kid ? 0.85 : 1), run: 0, phase: rnd(0, 6.28), mv: 0, ph: rnd(0, 100),
        idleKind: chance(0.3) ? 1 : chance(0.4) ? 2 : 0, hasCase, hasPack, hasUmb: chance(0.55), hasHat, long, shorts: !kid && chance(0.12), lean: 0,
        skin: pick(SKIN), hair: pick(HAIR), shirt: pick(SHIRT), trouser: pick(TROUSER), bag: pick(BAG), umbCol: pick(BRIGHT), hatCol: pick(SHIRT),
      };
      p.speed = p.base;
      if (hasCase) p.base *= 0.92;
      people[idx] = p;
      highSlot = Math.max(highSlot, idx);
      setCol(M.torso, idx, p.shirt); setCol(M.head, idx, p.skin); setCol(M.hairShort, idx, p.hair); setCol(M.hairLong, idx, p.hair); setCol(M.hat, idx, p.hatCol);
      for (let k = 0; k < 2; k++) {
        setCol(M.thigh, idx * 2 + k, p.trouser); setCol(M.shin, idx * 2 + k, p.shorts ? p.skin : p.trouser); setCol(M.arm, idx * 2 + k, p.shirt); setCol(M.hand, idx * 2 + k, p.skin);
      }
      setCol(M.pack, idx, p.bag); setCol(M.case, idx, p.bag); setCol(M.umbrella, idx, p.umbCol); setCol(M.phone, idx, 0xffffff);
      colorsDirty = true;
      return p;
    }
    function freePerson(p) {
      p.active = false;
      MESHES.forEach((m) => { if (PAIR[Object.keys(M).find((k) => M[k] === m)]) { put(m, p.slot * 2, ZERO); put(m, p.slot * 2 + 1, ZERO); } else put(m, p.slot, ZERO); });
      while (highSlot >= 0 && !people[highSlot].active) highSlot--;
      refreshCounts();
    }
    function faceAngle(p, ang) { p.fs = Math.sin(ang); p.fo = -Math.cos(ang); }
    function setPath(p, pts, then, speed) { p.path = pts; p.pi = 0; p.then = then; p.mode = 'move'; if (speed) p.speed = speed; beginSeg(p); }
    function beginSeg(p) { const w = p.path[p.pi]; p.segLen = Math.max(0.01, Math.hypot(w.s - p.s, w.o - p.o)); }

    function clear() {
      for (let i = 0; i < cap; i++) if (people[i].active) freePerson(people[i]);
      highSlot = -1; refreshCounts();
      ex = null;
      counters.alighted = counters.boarded = counters.alightingTotal = counters.boardingTotal = 0;
    }

    // ------------------------------------------------------------ platform crowd
    function spawnPlatform(station, track, o) {
      o = o || {};
      clear();
      try { plat = buildPlatform(station, track, o); } catch (e) { console.warn('[Lokféierer] passengers: platform frames failed', e); plat = null; return; }
      const want = o.count != null ? o.count : DEFAULT_COUNT[station.size] || 12;
      const count = clamp(Math.round(want), 0, crowdCap);
      const sB = Math.min(plat.pe - 4, station.s - 3), sA = Math.max(plat.ps + 4, station.s - plat.trainLength);
      const lo = sA < sB - 5 ? sA : plat.ps + 4, hi = sA < sB - 5 ? sB : plat.pe - 4;
      const placed = [];
      let made = 0, guard = 0;
      while (made < count && guard++ < count * 12) {
        const cs = rnd(lo, hi), co = rnd(plat.edge + 1.0, plat.back - 0.9), size = 2 + ((Math.random() * 4) | 0);
        const talk = chance(0.4), cluster = [];
        for (let k = 0; k < size && made < count; k++) {
          let ok = false, s = 0, off = 0;
          for (let tr = 0; tr < 14 && !ok; tr++) {
            s = cs + rnd(-1.5, 1.5); off = clamp(co + rnd(-1.2, 1.2), plat.edge + 0.9, plat.back - 0.7);
            ok = placed.every((q) => Math.hypot(q.s - s, q.o - off) > 0.62);
          }
          if (!ok) continue;
          const p = makePerson('crowd', clamp(s, lo, hi), off, k === 1 && chance(0.35) ? { kid: true } : null);
          if (!p) break;
          placed.push(p); cluster.push(p); made++;
          faceAngle(p, rnd(-0.6, 0.6));
          if (p.kid) { p.idleKind = 0; p.hasCase = false; }
        }
        if (talk && cluster.length > 1) {
          const mx = cluster.reduce((a, q) => a + q.s, 0) / cluster.length, mo = cluster.reduce((a, q) => a + q.o, 0) / cluster.length;
          cluster.forEach((q) => { const dS = mx - q.s, dO = mo - q.o, l = Math.hypot(dS, dO); if (l > 0.2) { q.fs = dS / l; q.fo = dO / l; q.idleKind = 3; } });
        }
      }
      refreshCounts();
    }

    // ------------------------------------------------------------ exchange
    function buildDoors(list) {
      const sideOk = list.filter((d) => !d.side || d.side === plat.side);
      const use = sideOk.length ? sideOk : list;
      return use.map((d) => {
        const w = projectWorld(d.pos.x, d.pos.z);
        const n = Math.hypot(d.dir.x, d.dir.z) || 1;
        sample(w.s);
        let ds = (d.dir.x / n) * smp.tx + (d.dir.z / n) * smp.tz, dO = (d.dir.x / n) * smp.rx + (d.dir.z / n) * smp.rz;
        const l = Math.hypot(ds, dO) || 1; ds /= l; dO /= l;
        if (dO < 0.3) { ds = 0; dO = 1; }
        return { s: w.s, o: w.o, ds, dO, queue: [], alightLeft: 0, virtualBoard: 0, tA: rnd(0, 0.6), tB: 0, intA: ALIGHT_GAP, intB: BOARD_GAP, pending: 0 };
      }).sort((a, b) => a.s - b.s);
    }
    function doorPoint(d, dist, lateral) { return { s: d.s + d.ds * dist - d.dO * lateral, o: d.o + d.dO * dist + d.ds * lateral }; }
    function queueSpot(d, k) {
      const row = Math.floor(k / QUEUE_LATERAL.length), lat = QUEUE_LATERAL[k % QUEUE_LATERAL.length] + rnd(-0.12, 0.12);
      const pt = doorPoint(d, 0.95 + row * 0.55 + rnd(0, 0.15), lat);
      return { s: pt.s, o: Math.min(pt.o, plat.back - 0.4) };
    }
    function nearestExitPath(p, fromS, fromO) {
      const r = Math.random(), laneO = clamp(plat.edge + 1.8 + rnd(-0.1, 1.0), plat.edge + 1.7, plat.back - 0.8);
      const toLo = Math.abs(fromS - plat.ps) < Math.abs(fromS - plat.pe);
      const mids = plat.exits.slice(2).sort((a, b) => Math.abs(a.s - fromS) - Math.abs(b.s - fromS));
      const ex2 = r < 0.58 ? mids[0] : r < 0.9 ? plat.exits[toLo ? 0 : 1] : plat.exits[toLo ? 1 : 0];
      const dirS = ex2.kind === 'mid' ? Math.sign(ex2.s - fromS) || 1 : ex2.dir;
      const pts = [{ s: fromS + dirS * 1.5, o: laneO }];
      if (ex2.kind === 'mid') { pts.push({ s: ex2.s, o: laneO }); pts.push({ s: ex2.s, o: plat.back + 2.6, sink: 1 }); } else { pts.push({ s: ex2.inn, o: laneO }); pts.push({ s: ex2.out, o: laneO, sink: 1 }); }
      return pts;
    }
    function exitEntry(ex2) { return ex2.kind === 'mid' ? [{ s: ex2.s, o: plat.back + 2.6 }, { s: ex2.s, o: plat.back - 0.8, sink: -1 }] : [{ s: ex2.out, o: plat.edge + 2.2 }, { s: ex2.inn, o: plat.edge + 2.2, sink: -1 }]; }

    function emitAlighter(d) {
      const inside = doorPoint(d, -1.0, rnd(-0.3, 0.3));
      const p = makePerson('alight', inside.s, inside.o);
      counters.alighted++;
      if (!p) return;
      p.hasCase = p.hasCase && chance(0.8);
      const thr = doorPoint(d, 0.4, 0), out = doorPoint(d, 1.5, rnd(-0.4, 0.4));
      const pts = [thr, out].concat(nearestExitPath(p, out.s, out.o));
      p.speed = p.base * 1.15;
      faceAngle(p, 0);
      setPath(p, pts, 'despawn');
    }

    function startExchange(spec) {
      if (!plat) { console.warn('[Lokféierer] passengers: startExchange before spawnPlatform'); return; }
      const doors = buildDoors((spec && spec.doorsWorld) || []);
      if (!doors.length) { console.warn('[Lokféierer] passengers: no doors given'); return; }
      const alighting = Math.max(0, Math.round(spec.alighting || 0)), boarding = Math.max(0, Math.round(spec.boarding || 0));
      counters.alighted = 0; counters.boarded = 0; counters.alightingTotal = alighting; counters.boardingTotal = boarding;
      // a late runner is a rare treat, not a fixture of every stop (Ian: 'always one passenger ~25 s after the others')
      const runners = boarding >= 8 && chance(RUNNER_CHANCE) ? 1 : 0;
      ex = {
        active: true, stopped: false, doors, t: 0, alightLeft: alighting, runnersLeft: runners, toBoard: boarding - runners, go: false, releaseAt: -1, inflowLeft: 0, inflowT: 0, completed: false,
      };
      // spread alighting people over the doors
      let weights = doors.map(() => rnd(0.7, 1.3)), sum = weights.reduce((a, b) => a + b, 0), given = 0;
      doors.forEach((d, i) => { d.alightLeft = i === doors.length - 1 ? alighting - given : Math.min(alighting - given, Math.round((alighting * weights[i]) / sum)); given += d.alightLeft; });
      doors.forEach((d) => { d.intA = clamp(ALIGHT_MAX_S / Math.max(1, d.alightLeft), 0.25, ALIGHT_GAP); });
      if (!alighting) { ex.go = true; goBoarding(); ex.releaseAt = 0.6; }
    }

    function nearestDoorIdx(s, o, penalty) {
      let best = 0, bd = 1e9;
      ex.doors.forEach((d, i) => { const dist = Math.hypot(d.s - s, d.o - o) + penalty * (d.queue.length + d.pending); if (dist < bd) { bd = dist; best = i; } });
      return best;
    }
    function assignToDoor(p, di, speedMul) {
      const d = ex.doors[di];
      p.door = d; p.speed = p.base * (speedMul || 1);
      const spot = queueSpot(d, d.queue.length);
      d.queue.push(p);
      p.spot = spot;
      setPath(p, [spot], 'queue');
    }
    function goBoarding() {
      // pick the nearest waiting crowd members to the doors, the rest keep standing
      const crowd = [];
      for (let i = 0; i <= highSlot; i++) { const p = people[i]; if (p.active && p.kind === 'crowd' && p.mode === 'idle') crowd.push(p); }
      crowd.forEach((p) => { p.sortKey = Math.min.apply(null, ex.doors.map((d) => Math.hypot(d.s - p.s, d.o - p.o))) + rnd(0, 6); });
      crowd.sort((a, b) => a.sortKey - b.sortKey);
      const visible = Math.min(ex.toBoard, crowd.length);
      for (let i = 0; i < visible; i++) { const p = crowd[i]; p.kind = 'board'; p.idleKind = 0; assignToDoor(p, nearestDoorIdx(p.s, p.o, 1.4), 1); }
      ex.inflowLeft = ex.toBoard - visible; ex.inflowT = 0.2;
      if (ex.releaseAt < 0) ex.releaseAt = ex.t + 1.4;
      const perDoor = Math.max(1, (ex.toBoard + ex.runnersLeft) / ex.doors.length);
      ex.doors.forEach((d) => { d.intB = clamp(BOARD_MAX_S / perDoor, 0.2, BOARD_GAP); d.tB = rnd(0, 0.5); });
      ex.inflowGap = clamp((BOARD_MAX_S * 0.7) / Math.max(1, ex.inflowLeft), 0.04, 0.45);
    }
    function spawnInflow() {
      const e = plat.exits[Math.random() < 0.8 ? 2 + ((Math.random() * 2) | 0) : Math.random() < 0.5 ? 0 : 1];
      const di = nearestDoorIdx(e.kind === 'mid' ? e.s : e.dir < 0 ? plat.ps : plat.pe, plat.edge + 2, 1.4);
      const entry = exitEntry(e);
      const p = makePerson('board', entry[0].s, entry[0].o);
      if (!p) { ex.doors[di].virtualBoard++; return; }
      p.idleKind = 0;
      const d = ex.doors[di];
      p.door = d; p.speed = p.base * 1.3;
      const spot = queueSpot(d, d.queue.length);
      d.queue.push(p); p.spot = spot;
      setPath(p, entry.slice(1).concat([spot]), 'queue');
    }
    function spawnRunner() {
      // from the platform access closest to a door, so the sprint takes seconds, not half a minute
      const dist = (e2) => { const en = exitEntry(e2)[1]; return Math.min(...ex.doors.map((d) => Math.abs(d.s - en.s))); };
      const e = plat.exits.slice().sort((a, b) => dist(a) - dist(b))[0];
      const entry = exitEntry(e);
      const p = makePerson('runner', entry[0].s, entry[0].o);
      const di = nearestDoorIdx(entry[1].s, entry[1].o, 0.2);
      const d = ex.doors[di];
      if (!p) { counters.boarded++; return; }
      p.hasCase = false; p.hasUmb = p.hasUmb && chance(0.5); p.idleKind = 0; p.run = 1; p.speed = RUN_SPEED; p.door = d;
      const front = doorPoint(d, 0.7, rnd(-0.3, 0.3)), thr = doorPoint(d, 0.25, 0), inside = doorPoint(d, -0.9, 0);
      setPath(p, entry.slice(1).concat([front, thr, inside]), 'enter', RUN_SPEED);
    }
    function releaseFromQueue(d) {
      const p = d.queue[0];
      if (p && p.mode === 'queue') {
        d.queue.shift();
        const thr = doorPoint(d, 0.25, 0), inside = doorPoint(d, -0.9, 0);
        p.speed = p.base; p.door = null;
        setPath(p, [doorPoint(d, 0.9, 0), thr, inside], 'enter');
        d.queue.forEach((q, i) => { if (q.mode === 'queue' || q.mode === 'move') { q.spot = queueSpot(d, i); setPath(q, [q.spot], 'queue'); } });
        return true;
      }
      if (!p && d.virtualBoard > 0) { d.virtualBoard--; counters.boarded++; return true; }
      return false;
    }

    function stopExchange() {
      if (!ex) return;
      ex.active = false; ex.stopped = true;
      for (let i = 0; i <= highSlot; i++) {
        const p = people[i];
        if (!p.active) continue;
        if (p.kind === 'board' || p.kind === 'runner') {
          if (p.then === 'enter' && p.mode === 'move' && p.pi >= 1) continue; // already stepping inside
          p.mode = 'idle'; p.kind = 'crowd'; p.run = 0; p.door = null; p.path = [];
          faceAngle(p, rnd(-0.5, 0.5)); p.idleKind = 2;
        }
      }
      ex.doors.forEach((d) => { d.queue = []; d.virtualBoard = 0; });
      ex.inflowLeft = 0;
    }

    function forceComplete() {
      for (let i = 0; i <= highSlot; i++) { const p = people[i]; if (p.active && (p.kind === 'board' || p.kind === 'runner')) freePerson(p); }
      ex.doors.forEach((d) => { d.queue = []; d.virtualBoard = 0; });
      ex.inflowLeft = 0; ex.runnersLeft = 0; ex.alightLeft = 0;
      counters.boarded = counters.boardingTotal; counters.alighted = counters.alightingTotal;
      ex.completed = true; ex.active = false;
    }
    function exchangeStep(dt) {
      if (!ex || !ex.active) return;
      ex.t += dt;
      const doors = ex.doors;
      let leftA = 0;
      doors.forEach((d) => {
        if (d.alightLeft > 0) {
          d.tA -= dt;
          if (d.tA <= 0) { d.alightLeft--; emitAlighter(d); d.tA = d.intA * rnd(0.75, 1.3); }
        }
        leftA += d.alightLeft;
      });
      ex.alightLeft = leftA;
      const emitted = counters.alightingTotal - leftA;
      if (!ex.go && (counters.alightingTotal === 0 || emitted >= counters.alightingTotal * 0.5)) { ex.go = true; goBoarding(); }
      if (ex.go && ex.inflowLeft > 0) { ex.inflowT -= dt; if (ex.inflowT <= 0) { ex.inflowLeft--; spawnInflow(); ex.inflowT = ex.inflowGap * rnd(0.6, 1.4); } }
      if (ex.go && leftA === 0 && ex.releaseAt < 0) ex.releaseAt = ex.t + 1.6;
      const open = ex.go && leftA === 0 && ex.releaseAt >= 0 && ex.t >= ex.releaseAt;
      if (open) {
        if (ex.runnersLeft > 0 && counters.boarded >= counters.boardingTotal * 0.3 - 1) { ex.runnersLeft--; spawnRunner(); }
        doors.forEach((d) => {
          d.tB -= dt;
          if (d.tB <= 0 && releaseFromQueue(d)) d.tB = d.intB * rnd(0.8, 1.3);
        });
      }
      if (ex.t > 150 && !ex.completed) forceComplete();
      const alightersOut = activeCount((p) => p.kind === 'alight');
      const boardersLeft = activeCount((p) => p.kind === 'board' || p.kind === 'runner');
      const virt = doors.reduce((a, d) => a + d.virtualBoard, 0);
      if (open && ex.inflowLeft === 0 && ex.runnersLeft === 0 && boardersLeft === 0 && virt === 0 && counters.boarded >= counters.boardingTotal && alightersOut >= 0) { ex.completed = true; ex.active = false; }
    }

    // ------------------------------------------------------------ simulation + animation
    function arrive(p) {
      if (p.then === 'despawn') { freePerson(p); return; }
      if (p.then === 'enter') { counters.boarded++; freePerson(p); return; }
      if (p.then === 'queue') {
        p.mode = 'queue';
        if (p.door) { const dd = p.door; faceAtDoor(p, dd); }
        return;
      }
      p.mode = 'idle'; p.run = 0;
    }
    function faceAtDoor(p, d) { p.fs = -d.ds; p.fo = -d.dO; }

    function advance(p, dt) {
      if (p.mode !== 'move') { p.moveT = 0; return; }
      p.moveT = (p.moveT || 0) + dt;
      if (p.moveT > 35 && p.path.length) { const lw = p.path[p.path.length - 1]; p.s = lw.s; p.o = lw.o; p.pi = p.path.length; p.moveT = 0; arrive(p); return; }
      const w = p.path[p.pi];
      const dS = w.s - p.s, dO = w.o - p.o, d = Math.hypot(dS, dO), step = p.speed * dt;
      if (d > 0.001) { p.fs += (dS / d - p.fs) * Math.min(1, 12 * dt); p.fo += (dO / d - p.fo) * Math.min(1, 12 * dt); }
      if (w.sink) p.yOff = w.sink > 0 ? -SINK_DEPTH * (1 - d / p.segLen) : -SINK_DEPTH * (d / p.segLen);
      if (d <= step) {
        p.s = w.s; p.o = w.o; p.pi++;
        if (p.pi >= p.path.length) { arrive(p); return; }
        beginSeg(p);
      } else { p.s += (dS / d) * step; p.o += (dO / d) * step; }
      p.phase += step * (p.run ? 2.2 : 4.2) / p.sc;
    }
    function separate(p, dt) {
      if (p.mode !== 'move' || p.then === 'enter') return;
      const last = p.path[p.path.length - 1];
      if (last && Math.hypot(last.s - p.s, last.o - p.o) < 1.2) return;
      const k = Math.min(1, 7 * dt);
      for (let i = 0; i <= highSlot; i++) {
        const q = people[i];
        if (q === p || !q.active || q.then === 'enter' && q.mode === 'move') continue;
        const dS = p.s - q.s, dO = p.o - q.o;
        if (Math.abs(dS) > SEPARATION || Math.abs(dO) > SEPARATION) continue;
        const d = Math.hypot(dS, dO) || 0.001;
        if (d >= SEPARATION) continue;
        const push = (SEPARATION - d) * k * (q.mode === 'move' ? 0.25 : 0.4);
        p.s += (dS / d) * push; p.o += (dO / d) * push;
      }
    }

    function writePerson(p, t) {
      sample(p.s);
      const wx = smp.x + smp.rx * p.o, wz = smp.z + smp.rz * p.o, wy = smp.y + plat.h + p.yOff;
      // facing
      const fx = smp.tx * p.fs + smp.rx * p.fo, fz = smp.tz * p.fs + smp.rz * p.fo;
      const target = Math.atan2(fx, fz);
      p.yaw += angleDiff(p.yaw, target) * Math.min(1, 0.22 + (p.mode === 'move' ? 0.15 : 0));
      const moving = p.mode === 'move';
      p.mv += ((moving ? 1 : 0) - p.mv) * 0.18;
      const mv = p.mv, idle = 1 - mv, ph = p.ph, run = p.run;
      const sw = Math.sin(p.phase), cw = Math.cos(p.phase);
      const legA = (0.46 + 0.5 * run) * mv, armA = (0.42 + 0.55 * run) * mv, kneeK = (0.85 + 0.65 * run) * mv;
      const bob = 0.028 * Math.abs(sw) * mv * (1 + run) + 0.004 * Math.sin(t * 1.7 + ph) * idle;
      const lean = (0.04 + 0.2 * run) * mv + 0.012 * Math.sin(t * 0.9 + ph) * idle;
      const twist = 0.1 * sw * mv + 0.05 * Math.sin(t * 0.7 + ph) * idle;
      // idle behaviour
      const phoneUse = p.idleKind === 1 && !p.hasCase;
      const umbOn = rainOn && p.hasUmb;
      const talk = p.idleKind === 3;
      let headYaw = idle * (p.idleKind === 2 ? 0.7 * Math.sin(t * 0.5 + ph) : 0.12 * Math.sin(t * 0.4 + ph)) + mv * 0.12 * sw * 0.3;
      let headPitch = idle * (phoneUse ? 0.5 : 0.03 * Math.sin(t * 0.6 + ph)) + mv * 0.03;
      let armL = armA * sw, armR = -armA * sw, rzL = -0.07, rzR = 0.07;
      const legSway = 0.035 * Math.sin(t * 0.35 + ph) * idle;
      if (idle > 0.01) {
        armL += idle * (0.03 * Math.sin(t * 0.9 + ph));
        armR += idle * (0.03 * Math.sin(t * 0.8 + ph));
        if (talk) armL = armL * mv + idle * (-0.7 + 0.35 * Math.sin(t * 2.6 + ph * 3) * Math.max(0, Math.sin(t * 0.3 + ph)));
        if (phoneUse) { armR = armR * mv + idle * -1.05; rzR = 0.07 * mv + idle * -0.33; }
      }
      if (umbOn) { armR = -0.7; rzR = 0.04; }
      else if (p.hasCase) { armR = armR * 0.15 - 0.3; }
      if (umbOn && p.hasCase) armL = armL * 0.15 - 0.3;
      // base matrix
      eU.set(lean, p.yaw, 0, 'YXZ');
      qQ.setFromEuler(eU);
      vP.set(wx, wy + bob, wz); vS.set(p.sc, p.sc, p.sc);
      mB.compose(vP, qQ, vS);
      mU.copy(mB);
      if (Math.abs(twist) > 1e-4) { mT.makeRotationY(twist); mU.multiply(mT); }
      const i = p.slot;
      put(M.torso, i, mU);
      // head, hair, hat
      eH.set(headPitch, headYaw, 0, 'XYZ');
      mT.makeRotationFromEuler(eH);
      if (p.kid) mT.scale(vS.set(1.2, 1.2, 1.2));
      mT.setPosition(0, NECK_Y, 0);
      mO.multiplyMatrices(mU, mT);
      put(M.head, i, mO); put(M.hairShort, i, mO);
      put(M.hairLong, i, p.long ? mO : ZERO); put(M.hat, i, p.hasHat ? mO : ZERO);
      // arms + hands (+ phone)
      [-1, 1].forEach((side) => {
        const a = side < 0 ? armL : armR, rz = side < 0 ? rzL : rzR;
        mT.makeRotationX(a); mR.makeRotationZ(rz); mT.multiply(mR); mT.setPosition(side * SHOULDER_X, SHOULDER_Y, 0);
        mA.multiplyMatrices(mU, mT);
        const k = i * 2 + (side < 0 ? 0 : 1);
        put(M.arm, k, mA); put(M.hand, k, mA);
        if (side > 0) {
          if (phoneUse && idle > 0.5) {
            mT.makeRotationX(-0.25).setPosition(0, -0.58, 0.05); mO.multiplyMatrices(mA, mT); put(M.phone, i, mO);
          } else put(M.phone, i, ZERO);
        }
      });
      // legs
      mL.copy(mB);
      for (let s2 = 0; s2 < 2; s2++) {
        const side = s2 === 0 ? -1 : 1;
        mT.makeRotationX(s2 === 0 ? -legA * sw + legSway : legA * sw - legSway).setPosition(side * 0.095, HIP_Y, 0);
        mA.multiplyMatrices(mL, mT);
        const k = i * 2 + s2;
        put(M.thigh, k, mA);
        const kn = kneeK * Math.max(0, s2 === 0 ? cw : -cw);
        mT.makeRotationX(kn).setPosition(0, -KNEE_DROP, 0);
        mO.multiplyMatrices(mA, mT);
        put(M.shin, k, mO);
      }
      // props
      put(M.pack, i, p.hasPack ? mU : ZERO);
      if (p.hasCase) {
        const cs = umbOn ? -1 : 1;
        mT.makeRotationX(0.04 + 0.24 * mv).setPosition(0.32 * cs, 0, -0.12 + 0.06 * idle);
        mO.multiplyMatrices(mL, mT); put(M.case, i, mO);
      } else put(M.case, i, ZERO);
      if (umbOn) { mT.makeTranslation(SHOULDER_X, 0.9, 0.387); mO.multiplyMatrices(mB, mT); put(M.umbrella, i, mO); } else put(M.umbrella, i, ZERO);
    }

    function update(dt, camera) {
      void camera;
      dt = Math.min(dt || 0, 0.1);
      clock += dt;
      if (!plat) return;
      exchangeStep(dt);
      for (let i = 0; i <= highSlot; i++) { const p = people[i]; if (p.active) { separate(p, dt); advance(p, dt); } }
      for (let i = 0; i <= highSlot; i++) { const p = people[i]; if (p.active) writePerson(p, clock); }
      if (colorsDirty) { MESHES.forEach((m) => { if (m.instanceColor) m.instanceColor.needsUpdate = true; }); colorsDirty = false; }
      refreshCounts();
      MESHES.forEach((m) => { m.instanceMatrix.needsUpdate = true; });
    }

    function stats() {
      let waiting = 0;
      for (let i = 0; i <= highSlot; i++) { const p = people[i]; if (p.active && p.kind !== 'alight' && !(p.then === 'enter' && p.mode === 'move')) waiting++; }
      const virt = ex ? ex.doors.reduce((a, d) => a + d.virtualBoard, 0) + ex.inflowLeft : 0;
      const done = !!(ex && ex.completed);
      return { waiting: waiting + virt, boarded: counters.boarded, alighted: counters.alighted, boardingTotal: counters.boardingTotal, alightingTotal: counters.alightingTotal, done };
    }
    function setRain(on) { rainOn = !!on; }
    function dispose() {
      clear();
      scene.remove(group);
      MESHES.forEach((m) => { m.geometry.dispose(); m.dispose(); });
      matLit.dispose(); matUmb.dispose();
    }

    function kinds() { const k = { crowd: 0, alight: 0, board: 0, runner: 0 }; for (let i = 0; i <= highSlot; i++) { const p = people[i]; if (p.active) k[p.kind]++; } return k; }

    return { spawnPlatform, startExchange, stopExchange, update, stats, clear, dispose, setRain, kinds, get visible() { return activeCount(); }, get capacity() { return cap; } };
  }

  TS.passengers = { create };
})();
