/* Lokféierer: passengers (C). Instanced low-poly people with per-limb meshes.
 * TS.passengers.create(scene, { quality }) -> { spawnPlatform, startExchange, stopExchange, update, stats, clear, dispose, setRain }
 * All motion happens in platform coordinates (s along the track, o = lateral distance from the track centre). */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});

  const CAP = { high: 150, medium: 80, low: 40 };
  const CABIN_CAP = { high: 60, medium: 48, low: 30 };   // people shown inside the tram (saloon camera), whatever the real passenger count
  const CROWD_SHARE = 0.65;
  const TAB_STEP = 2;
  const DEFAULT_EDGE = 1.75, DEFAULT_WIDTH = 4.5, DEFAULT_PLAT_H = 0.9;
  const SINK_DEPTH = 1.7;
  /* Luxtram stops: the platform is a 0.3 m kerb with a short ramp at each end and level ground beyond (stations-luxtram / infra.js buildStation).
   * In tram mode nobody uses the rail-style 'sink' exits: everybody leaves and arrives over the end ramps and their height follows walkY(). */
  const TRAM_RAMP = 3.5, TRAM_WALK_OUT = 11, TRAM_LATERAL_MARGIN = 0.3, TRAM_FLOOR_H = 0.52, LANE_O = 0.76, TRAM_HALF_W = 1.5;   // floor height of the CAF Urbos above the rail (trains.js: floor 0.4 + slab), body half width
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
    const isCabin = !!(opts && opts.cabin);
    const cap = opts && opts.cap ? opts.cap : isCabin ? (CABIN_CAP[quality] || CABIN_CAP.medium) : (CAP[quality] || CAP.medium);
    const crowdCap = Math.floor(cap * CROWD_SHARE);
    const castShadow = quality !== 'low';
    const geos = buildGeometries(THREE);
    const matLit = new THREE.MeshLambertMaterial({ vertexColors: true });
    const matUmb = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const group = new THREE.Group();
    group.name = (opts && opts.name) || 'ts-passengers';
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
    let hooks = {};   // { onBoard(door), onAlight(door) }: the saloon (cabin) follows the people who really get on / off
    const fire = (name, door) => { try { if (hooks[name]) hooks[name](door); } catch (e) { console.warn('[Lokféierer] passengers hook ' + name, e); } };
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
      const tram = !!o.tram, ramp = tram ? (o.rampLen || TRAM_RAMP) : 0, margin = tram ? ramp + TRAM_WALK_OUT + 4 : 12;
      const s0 = ps - margin, s1 = pe + margin, n = Math.min(600, Math.ceil((s1 - s0) / TAB_STEP) + 1);
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
      const h = o.platformHeight == null ? DEFAULT_PLAT_H : o.platformHeight;
      // Luxtram: the platform top is built from 3 m quads whose corners sit on the track profile (infra.js buildStation); the ramps are flat boxes centred on the profile
      let segY = null, rampY = null;
      if (tram) {
        const nSeg = Math.max(1, Math.ceil((pe - ps) / 3));
        segY = { n: nSeg, y: Array.from({ length: nSeg + 1 }, (_, k) => track.frameAt(ps + (k * (pe - ps)) / nSeg).pos.y), mid: Array.from({ length: nSeg }, (_, k) => track.frameAt(ps + ((k + 0.5) * (pe - ps)) / nSeg).pos.y) };   // quad corners; centres of the flat concrete boxes under them
        // ramp top plane (infra.js): from 2 cm under the platform top at the platform end to the track's height at the far end
        rampY = [{ a: track.frameAt(ps).pos.y + h - 0.02, b: track.frameAt(ps - ramp).pos.y }, { a: track.frameAt(pe).pos.y + h - 0.02, b: track.frameAt(pe + ramp).pos.y }];
      }
      const exits = tram
        // Luxtram: people only come and go over the end ramps (bottom of the ramp = inn - ramp .. out), then walk on level ground
        ? [{ kind: 'end', dir: -1, out: ps - ramp - TRAM_WALK_OUT, inn: ps + 1.5, ramp: ps - ramp }, { kind: 'end', dir: 1, out: pe + ramp + TRAM_WALK_OUT, inn: pe - 1.5, ramp: pe + ramp }]
        : [
          { kind: 'end', dir: -1, out: ps - 5, inn: ps + 1.5 },
          { kind: 'end', dir: 1, out: pe + 5, inn: pe - 1.5 },
          { kind: 'mid', dir: 0, s: clamp(station.s - 14, ps + 6, pe - 6) || mid },
          { kind: 'mid', dir: 0, s: clamp(station.s - 52, ps + 6, pe - 6) || mid },
        ];
      return {
        station, side, sign, s0, s1, n, t, ps, pe, edge, width, back: edge + width, h, tram, ramp, segY, rampY, obst: Array.isArray(o.obstacles) ? o.obstacles : [], floorH: o.floorHeight == null ? TRAM_FLOOR_H : o.floorHeight,
        trainLength: o.trainLength || Math.min(pe - ps - 8, 110),
        exits,
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
    /* Ground beyond the ramps (Luxtram): probed with rays at spawn time, so people only walk where there really is ground and follow its height
     * (some stops end in a cutting, a wall or a bridge: those ends are not used). Rays hit the world's ground / pavement meshes only. */
    const rayProbe = new THREE.Raycaster();
    function groundMeshes(cx, cz, radius) {
      const out = [], box = new THREE.Box3();
      scene.updateMatrixWorld();
      scene.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || !o.visible || !o.geometry || o.material && o.material.transparent) return;
        for (let a = o.parent; a; a = a.parent) if (a === group || (a.name && a.name.indexOf('train:') === 0)) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        if (box.max.x < cx - radius || box.min.x > cx + radius || box.max.z < cz - radius || box.min.z > cz + radius) return;
        out.push(o);
      });
      return out;
    }
    function probeExits() {
      const mid = sample(plat.station.s), cx = mid.x, cz = mid.z, radius = (plat.pe - plat.ps) / 2 + plat.ramp + TRAM_WALK_OUT + 25;
      const meshes = groundMeshes(cx, cz, radius), STEP = 0.75, oLane = plat.edge + LANE_O;
      plat.exits.forEach((e) => {
        const gs = [], gy = [], n = Math.ceil(TRAM_WALK_OUT / STEP);
        let prev = 0, goodTo = 0;
        for (let k = 0; k <= n; k++) {
          const sS = e.dir < 0 ? e.ramp - k * STEP : e.ramp + k * STEP;
          sample(sS);
          let lo = 1e9, hi = -1e9, sum = 0, missing = false;
          for (let li = 0; li < 3 && !missing; li++) {
            const oo = oLane + (li - 1) * 0.3;
            rayProbe.set(new THREE.Vector3(smp.x + smp.rx * oo, smp.y + 0.9, smp.z + smp.rz * oo), new THREE.Vector3(0, -1, 0)); rayProbe.far = 2.6;
            const hit = rayProbe.intersectObjects(meshes, false).find((q) => !q.face || q.face.normal.y > 0.6);
            if (!hit) { missing = true; break; }
            const yy = hit.point.y - smp.y; lo = Math.min(lo, yy); hi = Math.max(hi, yy); if (li === 1) sum = yy;
          }
          if (missing || hi - lo > 0.06) break;   // uneven ground across the lane: nobody walks there
          const y = sum;
          if (Math.abs(y) > 0.45 || Math.abs(y - prev) > 0.07) break;
          gs.push(sS); gy.push(y); prev = y; goodTo = k * STEP;
        }
        e.ground = { s: gs, y: gy };
        e.reach = goodTo;                        // metres of usable ground beyond the ramp
        e.usable = goodTo >= 3;
        if (gs.length) e.out = gs[gs.length - 1];
        else e.out = e.ramp;
      });
    }
    function groundOff(s) {
      const e = s < plat.station.s ? plat.exits[0] : plat.exits[1], g = e.ground;
      if (!g || !g.s.length) return 0;
      const a = g.s;
      if (e.dir < 0) { if (s >= a[0]) return g.y[0]; if (s <= a[a.length - 1]) return g.y[a.length - 1]; for (let i = 0; i < a.length - 1; i++) if (s <= a[i] && s >= a[i + 1]) return g.y[i] + (g.y[i + 1] - g.y[i]) * (a[i] - s) / (a[i] - a[i + 1]); }
      else { if (s <= a[0]) return g.y[0]; if (s >= a[a.length - 1]) return g.y[a.length - 1]; for (let i = 0; i < a.length - 1; i++) if (s >= a[i] && s <= a[i + 1]) return g.y[i] + (g.y[i + 1] - g.y[i]) * (s - a[i]) / (a[i + 1] - a[i]); }
      return 0;
    }
    /* Height of the walkable surface above the track at platform coordinates (s, o):
     * platform top (+ the tram floor beside it) over the platform, a linear ramp over the ramp length at each end, level ground beyond. */
    function platformTop(s, ty) {
      const L = plat.pe - plat.ps, n = plat.segY.n, segL = L / n, f = clamp((s - plat.ps) / L, 0, 1) * n, i = Math.min(n - 1, f | 0);
      // the paving quad follows the profile; under each 3 m segment sits a FLAT concrete box (0.1 m longer than the segment), which on a steep stretch stands up to ~0.1 m proud of the quad
      const segTop = (k) => Math.max(plat.segY.y[k] + (plat.segY.y[k + 1] - plat.segY.y[k]) * clamp((s - plat.ps) / segL - k, 0, 1) + plat.h, plat.segY.mid[k] + plat.h - 0.01);
      let top = segTop(i);
      // within a few cm of a joint the neighbour's box shows through on a curve (its end is not square to the track): take the middle of the two
      const frac = f - i;
      if (frac < 0.04 && i > 0) top = (top + segTop(i - 1)) / 2;
      else if (frac > 0.96 && i < n - 1) top = (top + segTop(i + 1)) / 2;
      return top - ty + 0.02;   // (+2 cm: the soles)
    }
    function walkY(s, o) {
      if (!plat.tram) return plat.h;
      const ty = sample(s).y;
      if (s >= plat.ps - 0.05 && s <= plat.pe + 0.05) {
        const top = platformTop(s, ty);
        // between the tram body and the platform edge: the step from the tram floor to the platform top
        if (o >= plat.edge || plat.edge <= TRAM_HALF_W + 0.05) return top;
        const k = clamp((o - TRAM_HALF_W) / (plat.edge - TRAM_HALF_W), 0, 1);
        return plat.floorH + (top - plat.floorH) * k;
      }
      const d = s < plat.ps ? plat.ps - s : s - plat.pe;
      if (d >= plat.ramp) return groundOff(s);
      const rr = plat.rampY[s < plat.ps ? 0 : 1], ramp = rr.a + (rr.b - rr.a) * (d / plat.ramp) - ty;
      // on a curve the ramp box and the last platform box do not meet exactly: the first 0.7 m follow the platform end
      if (d < 0.7) return Math.max(ramp, platformTop(s < plat.ps ? plat.ps : plat.pe, ty) - 0.08 - 0.12 * (d / 0.7));
      return ramp;
    }
    /* keeps walkers off the track side of the platform edge (and off its back edge) while they are on / beside the platform or its ramps */
    function blocked(s, o, pad) {
      const ob = plat.obst;
      for (let i = 0; i < ob.length; i++) { const b = ob[i]; if (Math.abs(s - b.s) < b.hs + pad && Math.abs(o - b.o) < b.ho + pad) return true; }
      return false;
    }
    /* walking people slide around the furniture instead of through it: push out of any footprint along the axis of least penetration */
    function avoidObstacles(p) {
      const ob = plat.obst;
      if (!ob.length) return;
      const oLo = plat.edge + TRAM_LATERAL_MARGIN, oHi = plat.back - TRAM_LATERAL_MARGIN;
      const inside = (b, s, o, k) => Math.abs(s - b.s) < b.hs + 0.22 - k && Math.abs(o - b.o) < b.ho + 0.22 - k;
      // (a few passes: where a wall meets another wall or an end panel, leaving one footprint must not land him in the next one)
      for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (let i = 0; i < ob.length; i++) {
          const b = ob[i], hs = b.hs + 0.22, ho = b.ho + 0.22, dS = p.s - b.s, dO = p.o - b.o;
          if (Math.abs(dS) >= hs || Math.abs(dO) >= ho) continue;
          // a walker slides round the side that is across his heading (never head-on: he would stick); a standing person leaves along the shorter way.
          // Candidates in that order; the first one that is on the walkway and clear of every other footprint wins
          const alongO = p.mode === 'move' ? Math.abs(p.fs) >= Math.abs(p.fo) : hs - Math.abs(dS) >= ho - Math.abs(dO);
          const oPair = dO >= 0 ? [[p.s, b.o + ho], [p.s, b.o - ho]] : [[p.s, b.o - ho], [p.s, b.o + ho]];
          const sPair = dS >= 0 ? [[b.s + hs, p.o], [b.s - hs, p.o]] : [[b.s - hs, p.o], [b.s + hs, p.o]];
          const cands = (alongO ? oPair.concat(sPair) : sPair.concat(oPair)).filter((c) => c[1] >= oLo && c[1] <= oHi);
          const c = cands.find((q) => !ob.some((r) => r !== b && inside(r, q[0], q[1], 0.01))) || cands[0] || sPair[0];
          p.s = c[0]; p.o = c[1]; moved = true;
        }
        if (!moved) break;
      }
    }
    function keepOnWalkway(p) {
      if (!plat.tram || p.doorway) return;
      avoidObstacles(p);
      if (p.s < plat.ps - plat.ramp - TRAM_WALK_OUT - 1 || p.s > plat.pe + plat.ramp + TRAM_WALK_OUT + 1) return;
      p.o = clamp(p.o, plat.edge + TRAM_LATERAL_MARGIN, plat.back - TRAM_LATERAL_MARGIN);
      avoidObstacles(p);   // (again: the clamp can push him back into a wall that stands on the walkway's back limit)
      if (p.o < plat.edge + TRAM_LATERAL_MARGIN) p.o = plat.edge + TRAM_LATERAL_MARGIN;
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
            ok = placed.every((q) => Math.hypot(q.s - s, q.o - off) > 0.62) && !blocked(clamp(s, lo, hi), off, 0.3);
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
        return { car: d.car, zLocal: d.zLocal, side: d.side, s: w.s, o: w.o, ds, dO, queue: [], alightLeft: 0, virtualBoard: 0, tA: rnd(0, 0.6), tB: 0, intA: ALIGHT_GAP, intB: BOARD_GAP, pending: 0 };
      }).sort((a, b) => a.s - b.s);
    }
    function doorPoint(d, dist, lateral) { return { s: d.s + d.ds * dist - d.dO * lateral, o: d.o + d.dO * dist + d.ds * lateral }; }
    function queueSpot(d, k) {
      const row = Math.floor(k / QUEUE_LATERAL.length), lat = QUEUE_LATERAL[k % QUEUE_LATERAL.length] + rnd(-0.12, 0.12);
      const pt = doorPoint(d, 0.95 + row * 0.55 + rnd(0, 0.15), lat);
      const oLo = plat.tram ? plat.edge + TRAM_LATERAL_MARGIN + 0.1 : -1e9, oHi = plat.back - 0.4, oo = clamp(pt.o, oLo, oHi);
      if (!plat.tram || !blocked(pt.s, oo, 0.3)) return { s: pt.s, o: oo };
      // the door's own spot is inside a shelter wall, bench or sign: the nearest free spot (lateral steps first, then along the platform), never one inside a footprint
      for (const dS of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 3, -3]) {
        for (let k = 0; k <= 30; k++) {
          for (const sg of k ? [-1, 1] : [1]) {
            const o2 = oo + sg * k * 0.15;
            if (o2 < oLo || o2 > oHi || blocked(pt.s + dS, o2, 0.3)) continue;
            return { s: pt.s + dS, o: o2 };
          }
        }
      }
      return { s: pt.s, o: oo };
    }
    // the walking lane along a Luxtram platform: just behind the tactile strip, in front of the shelters' glass ends and furniture
    function laneLat() { return clamp(plat.edge + LANE_O + rnd(-0.12, 0.12), plat.edge + 0.5, plat.back - 0.6); }
    function nearestExitPath(p, fromS, fromO) {
      if (plat.tram) {
        // Luxtram: along the platform lane to the nearer end, down the ramp, then a few metres on the level ground before they vanish
        const laneO = laneLat();
        let toLo = Math.abs(fromS - plat.ps) < Math.abs(fromS - plat.pe) ? chance(0.85) : chance(0.15);
        if (plat.exits[toLo ? 0 : 1].usable === false && plat.exits[toLo ? 1 : 0].usable) toLo = !toLo;
        const e = plat.exits[toLo ? 0 : 1];
        return [{ s: e.inn, o: laneO }, { s: e.ramp, o: laneO }, { s: e.out, o: laneO }];
      }
      const r = Math.random(), laneO = clamp(plat.edge + 1.8 + rnd(-0.1, 1.0), plat.edge + 1.7, plat.back - 0.8);
      const toLo = Math.abs(fromS - plat.ps) < Math.abs(fromS - plat.pe);
      const mids = plat.exits.slice(2).sort((a, b) => Math.abs(a.s - fromS) - Math.abs(b.s - fromS));
      const ex2 = r < 0.58 ? mids[0] : r < 0.9 ? plat.exits[toLo ? 0 : 1] : plat.exits[toLo ? 1 : 0];
      const dirS = ex2.kind === 'mid' ? Math.sign(ex2.s - fromS) || 1 : ex2.dir;
      const pts = [{ s: fromS + dirS * 1.5, o: laneO }];
      if (ex2.kind === 'mid') { pts.push({ s: ex2.s, o: laneO }); pts.push({ s: ex2.s, o: plat.back + 2.6, sink: 1 }); } else { pts.push({ s: ex2.inn, o: laneO }); pts.push({ s: ex2.out, o: laneO, sink: 1 }); }
      return pts;
    }
    // Luxtram: boarders come in over a random end ramp that has usable ground beyond it (both ends if both do)
    function tramEntryExit() {
      const ok = plat.exits.filter((e) => e.usable);
      const list = ok.length ? ok : plat.exits;
      return list[(Math.random() * list.length) | 0];
    }
    function exitEntry(ex2) {
      if (plat.tram) { const laneO = laneLat(); return [{ s: ex2.out, o: laneO }, { s: ex2.ramp, o: laneO }, { s: ex2.inn, o: laneO }]; }
      return ex2.kind === 'mid' ? [{ s: ex2.s, o: plat.back + 2.6 }, { s: ex2.s, o: plat.back - 0.8, sink: -1 }] : [{ s: ex2.out, o: plat.edge + 2.2 }, { s: ex2.inn, o: plat.edge + 2.2, sink: -1 }]; }

    function emitAlighter(d) {
      const inside = doorPoint(d, -1.0, rnd(-0.3, 0.3));
      const p = makePerson('alight', inside.s, inside.o);
      counters.alighted++;
      fire('onAlight', d);
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
      if (plat.tram) probeExits();   // now: the world's ground tiles around the stop are in their final detail
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
      const e = plat.tram ? tramEntryExit() : plat.exits[Math.random() < 0.8 ? 2 + ((Math.random() * 2) | 0) : Math.random() < 0.5 ? 0 : 1];
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
      const dist = (e2) => { const en = exitEntry(e2)[plat.tram ? 2 : 1]; return Math.min(...ex.doors.map((d) => Math.abs(d.s - en.s))); };
      const usable = plat.tram ? plat.exits.filter((q) => q.usable) : [], e = (usable.length ? usable : plat.exits).slice().sort((a, b) => dist(a) - dist(b))[0];
      const entry = exitEntry(e);
      const p = makePerson('runner', entry[0].s, entry[0].o);
      const di = nearestDoorIdx(entry[plat.tram ? 2 : 1].s, entry[plat.tram ? 2 : 1].o, 0.2);
      const d = ex.doors[di];
      if (!p) { counters.boarded++; return; }
      p.hasCase = false; p.hasUmb = p.hasUmb && chance(0.5); p.idleKind = 0; p.run = 1; p.speed = RUN_SPEED; p.door = d; p.entDoor = d;
      const front = doorPoint(d, 0.7, rnd(-0.3, 0.3)), thr = doorPoint(d, 0.25, 0), inside = doorPoint(d, -0.9, 0);
      setPath(p, entry.slice(1).concat([front, thr, inside]), 'enter', RUN_SPEED);
    }
    function releaseFromQueue(d) {
      const p = d.queue[0];
      if (p && p.mode === 'queue') {
        d.queue.shift();
        const thr = doorPoint(d, 0.25, 0), inside = doorPoint(d, -0.9, 0);
        p.speed = p.base; p.door = null; p.entDoor = d;
        setPath(p, [doorPoint(d, 0.9, 0), thr, inside], 'enter');
        d.queue.forEach((q, i) => { if (q.mode === 'queue' || q.mode === 'move') { q.spot = queueSpot(d, i); setPath(q, [q.spot], 'queue'); } });
        return true;
      }
      if (!p && d.virtualBoard > 0) { d.virtualBoard--; counters.boarded++; fire('onBoard', d); return true; }
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
      if (p.then === 'enter') { counters.boarded++; fire('onBoard', p.entDoor || p.door); freePerson(p); return; }
      if (p.then === 'queue') {
        p.mode = 'queue';
        if (p.door) { const dd = p.door; faceAtDoor(p, dd); }
        return;
      }
      p.mode = 'idle'; p.run = 0;
    }
    function faceAtDoor(p, d) { p.fs = -d.ds; p.fo = -d.dO; }

    function advance(p, dt) {
      if (p.mode !== 'move') { p.moveT = 0; p.doorway = false; return; }
      p.moveT = (p.moveT || 0) + dt;
      if (p.moveT > 35 && p.path.length) { const lw = p.path[p.path.length - 1]; p.s = lw.s; p.o = lw.o; p.pi = p.path.length; p.moveT = 0; arrive(p); return; }
      const w = p.path[p.pi];
      const dS = w.s - p.s, dO = w.o - p.o, d = Math.hypot(dS, dO), step = p.speed * dt;
      if (d > 0.001) { p.fs += (dS / d - p.fs) * Math.min(1, 12 * dt); p.fo += (dO / d - p.fo) * Math.min(1, 12 * dt); }
      p.doorway = (p.then === 'enter') || (p.kind === 'alight' && p.pi <= 1);
      if (w.sink && !plat.tram) p.yOff = w.sink > 0 ? -SINK_DEPTH * (1 - d / p.segLen) : -SINK_DEPTH * (d / p.segLen);
      if (d <= step) {
        p.s = w.s; p.o = w.o; p.pi++;
        if (p.pi >= p.path.length) { arrive(p); return; }
        beginSeg(p);
      } else { p.s += (dS / d) * step; p.o += (dO / d) * step; }
      keepOnWalkway(p);
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
      keepOnWalkway(p);
    }

    function writePerson(p, t) {
      let wx, wy, wz, target;
      if (p.cab) { wx = p.cab.wx; wy = p.cab.wy; wz = p.cab.wz; target = p.cab.yaw; }   // inside the tram: the pose comes from the saloon (world position + heading of the car)
      else {
        sample(p.s);
        wx = smp.x + smp.rx * p.o; wz = smp.z + smp.rz * p.o; wy = smp.y + (plat.tram ? walkY(p.s, p.o) : plat.h) + p.yOff;
        // facing
        const fx = smp.tx * p.fs + smp.rx * p.fo, fz = smp.tz * p.fs + smp.rz * p.fo;
        target = Math.atan2(fx, fz);
      }
      p.wx = wx; p.wy = wy; p.wz = wz;
      p.yaw += angleDiff(p.yaw, target) * Math.min(1, 0.22 + (p.mode === 'move' ? 0.15 : 0));
      const moving = p.mode === 'move';
      p.mv += ((moving ? 1 : 0) - p.mv) * 0.18;
      const mv = p.mv, idle = 1 - mv, ph = p.ph, run = p.run;
      const sw = Math.sin(p.phase), cw = Math.cos(p.phase);
      const legA = (0.46 + 0.5 * run) * mv, armA = (0.42 + 0.55 * run) * mv, kneeK = (0.85 + 0.65 * run) * mv;
      const sitK = p.cab ? p.sit : 0, holdK = p.cab ? p.hold || 0 : 0;
      const bob = (0.028 * Math.abs(sw) * mv * (1 + run) + 0.004 * Math.sin(t * 1.7 + ph) * idle) * (1 - sitK);
      const lean = (0.04 + 0.2 * run) * mv + 0.012 * Math.sin(t * 0.9 + ph) * idle + (p.cab ? p.cab.lean : 0);
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
      if (sitK > 0.001) {   // seated: hands on the lap
        armL = armL * (1 - sitK) + sitK * -0.8; rzL = rzL * (1 - sitK) + sitK * -0.1;
        armR = phoneUse ? armR * (1 - sitK) + sitK * -1.15 : armR * (1 - sitK) + sitK * -0.8; rzR = rzR * (1 - sitK) + sitK * (phoneUse ? -0.25 : 0.1);
      }
      if (holdK > 0.001) { armR = armR * (1 - holdK) + holdK * -2.55; rzR = rzR * (1 - holdK) + holdK * -0.1; }   // standing: one hand up on the pole
      if (umbOn) { armR = -0.7; rzR = 0.04; }
      else if (p.hasCase) { armR = armR * 0.15 - 0.3; }
      if (umbOn && p.hasCase) armL = armL * 0.15 - 0.3;
      // base matrix
      eU.set(lean, p.yaw, 0, 'YXZ');
      qQ.setFromEuler(eU);
      vP.set(wx, wy + bob - sitK * (HIP_Y - 0.5) * p.sc, wz); vS.set(p.sc, p.sc, p.sc);
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
        mT.makeRotationX((s2 === 0 ? -legA * sw + legSway : legA * sw - legSway) - sitK * 1.52).setPosition(side * 0.095, HIP_Y, 0);
        mA.multiplyMatrices(mL, mT);
        const k = i * 2 + s2;
        put(M.thigh, k, mA);
        const kn = kneeK * Math.max(0, s2 === 0 ? cw : -cw) + sitK * 1.52;
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

    /* test hook: where every visible person's feet are (world space) and what they are doing */
    function feet() {
      const out = [];
      for (let i = 0; i <= highSlot; i++) {
        const p = people[i];
        if (!p.active || p.wx === undefined) continue;
        out.push({ slot: i, kind: p.kind, mode: p.mode, then: p.then, doorway: !!p.doorway, x: p.wx, y: p.wy, z: p.wz, s: p.s, o: p.o, pi: p.pi, w: p.path && p.path[p.pi] ? { s: p.path[p.pi].s, o: p.path[p.pi].o } : null, fs: p.fs, fo: p.fo, rx: smpRX(p.s), rz: smpRZ(p.s) });
      }
      return out;
    }
    function smpRX(s) { return sample(s).rx; }
    function smpRZ(s) { return sample(s).rz; }
    function platformInfo() { return plat ? { ps: plat.ps, pe: plat.pe, edge: plat.edge, back: plat.back, h: plat.h, tram: plat.tram, ramp: plat.ramp, side: plat.side, obstacles: plat.obst, exits: plat.exits.map((e) => ({ dir: e.dir, ramp: e.ramp, out: e.out, reach: e.reach, usable: e.usable, ground: e.ground })) } : null; }

    function kinds() { const k = { crowd: 0, alight: 0, board: 0, runner: 0 }; for (let i = 0; i <= highSlot; i++) { const p = people[i]; if (p.active) k[p.kind]++; } return k; }


    /* ------------------------------------------------------------ the people INSIDE the tram (saloon camera)
     * A second, small instance of this module (opts.cabin) with its own instanced meshes. Positions live in the local frame of each car (x right, z toward the rear, y up from the rail),
     * seats / poles / doors come from model.cars[i].interior (trains.js). Everything is logic only until the saloon camera is active: while it is not, the people are just records
     * (nothing is drawn or animated); setActive(true) shows the group and update() animates the boarding, sitting, standing and leaving. */
    function buildCabinApi() {
      const cab = { model: null, cars: [], active: false, accelS: 0, clock: 0 };
      const FLOOR_EXTRA = 0.035, WALK = 0.9;
      const mWorld = new THREE.Matrix4();
      group.visible = false;
      function releaseSpots(p) {
        const c = p.cab;
        if (c.seatRef) c.seatRef.taken = false;
        if (c.holdRef) c.holdRef.taken = false;
        c.seatRef = c.holdRef = null;
      }
      function removePerson(p) { releaseSpots(p); freePerson(p); }
      function clearAll() { for (let i = 0; i <= highSlot; i++) if (people[i].active) removePerson(people[i]); highSlot = -1; refreshCounts(); }
      function setModel(model) {
        clearAll();
        cab.model = model || null; cab.cars = [];
        ((model && model.cars) || []).forEach((car, i) => {
          const inf = car.interior;
          if (!inf) return;
          cab.cars.push({ i, car, inf, seats: inf.seats.map((q) => ({ x: q.x, z: q.z, yaw: q.yaw, taken: false })), holds: inf.holds.map((h) => ({ x: h[0], z: h[1], px: h[2], pz: h[3], taken: false })) });
        });
      }
      const count = () => activeCount((p) => p.cab);
      /* the three viewpoints of the saloon camera: front end looking back down the whole tram, a middle car looking forward (a metre behind its door, so people boarding walk in
         ahead of you) and the rear end looking forward, all at a standing passenger's eye height.
         Clearance: nothing (seat or standing spot) within VP_NEAR metres of a viewpoint or within VP_CONE metres in front of it (across the aisle and the seats beside it); a
         STANDING spot also not within VP_CLEAR metres ahead (a standing body's head and shoulders would fill the lens). Seats in the zone stay empty. */
      const VP_EYE = 1.7, VP_NEAR = 1.2, VP_CONE = 1.5, VP_CONE_HALF = 1.15, VP_CLEAR = 2.2;
      function viewpoint(pos) {
        const n = cab.cars.length;
        if (!n) return null;
        const k = [0, Math.floor(n / 2), n - 1][pos], c = cab.cars[k], inf = c.inf;
        const z = pos === 2 ? inf.zB - 0.5 : pos === 1 ? (inf.doors.length ? inf.doors[0] : (inf.zA + inf.zB) / 2) + 1.0 : inf.zA + 0.4;
        return { k, car: c.i, x: 0.1, y: inf.floorY + VP_EYE, z, look: pos === 0 ? { car: cab.cars[n - 1].i, z: cab.cars[n - 1].inf.zB } : { car: cab.cars[0].i, z: -cab.cars[0].car.length / 2 + 1 } };
      }
      /* is the spot (x, z) of car k inside a viewpoint's clearance zone? `reach` = how far ahead of the camera the zone counts (VP_CLEAR for a standing spot, VP_CONE for a seat) */
      const vpBlocked = (k, x, z, reach = VP_CLEAR) => [0, 1, 2].some((i) => {
        const v = viewpoint(i); if (!v || v.k !== k) return false;
        const ahead = (z - v.z) * (i === 0 ? 1 : -1);
        return Math.hypot(x - v.x, z - v.z) < VP_NEAR || (ahead > 0 && ahead < reach && Math.abs(x - v.x) < VP_CONE_HALF);
      });
      const seatBlocked = (k, q) => vpBlocked(k, q.x, q.z, VP_CONE);
      const carEntry = (carIdx) => cab.cars.find((c) => c.i === carIdx) || cab.cars[0];
      function doorSide(door) { return door && door.side === 'left' ? -1 : 1; }
      function pickDestination(order) {
        const wantSit = chance(0.66);
        const seatsOf = (k) => cab.cars[k].seats.filter((q) => !q.taken && !seatBlocked(k, q)), holdsOf = (k) => cab.cars[k].holds.filter((q) => !q.taken && !vpBlocked(k, q.x, q.z));
        if (wantSit) for (const k of order) { const free = seatsOf(k); if (free.length) return { k, seat: pick(free) }; }
        for (const k of order) { const free = holdsOf(k); if (free.length) return { k, hold: pick(free) }; }
        for (const k of order) { const free = seatsOf(k); if (free.length) return { k, seat: pick(free) }; }
        const k = order[0], inf = cab.cars[k].inf;
        for (let tries = 0; tries < 12; tries++) { const z = rnd(inf.zA + 0.3, inf.zB - 0.3); { const x = rnd(-0.16, 0.16); if (!vpBlocked(k, x, z)) return { k, aisle: { x, z } }; } }
        return { k, aisle: { x: 0.12, z: (inf.zA + inf.zB) / 2 } };
      }
      /* a new passenger: from `door` (walks in) or, without one, already at his place */
      function spawn(door, nearCar) {
        if (!cab.cars.length) return null;
        const startK = Math.max(0, cab.cars.findIndex((c) => c.i === (door ? door.car : nearCar)));
        const order = cab.cars.map((_, k) => k).sort((a, b) => Math.abs(a - startK) - Math.abs(b - startK) + (Math.random() - 0.5) * (door ? 0 : 6));
        const dest = pickDestination(order), car = cab.cars[dest.k], inf = car.inf;
        const p = makePerson('cabin', 0, 0);
        if (!p) return null;
        const place = dest.seat ? { x: dest.seat.x, z: dest.seat.z } : dest.hold ? { x: dest.hold.x, z: dest.hold.z } : dest.aisle;
        let yaw = 0;
        if (dest.seat) { yaw = dest.seat.yaw + Math.PI; dest.seat.taken = true; p.hasCase = false; p.hasPack = chance(0.2); }
        else if (dest.hold) { yaw = Math.atan2(dest.hold.px - dest.hold.x, dest.hold.pz - dest.hold.z); dest.hold.taken = true; }
        else yaw = chance(0.5) ? 0 : Math.PI;
        p.hasUmb = false; p.sit = 0; p.hold = 0;
        p.cab = { k: dest.k, lx: place.x, lz: place.z, hd: yaw, yaw: 0, fresh: true, wx: 0, wy: 0, wz: 0, lean: 0, state: 'stand', path: [], pi: 0, seatRef: dest.seat || null, holdRef: dest.hold || null, dest: place, destYaw: yaw, doorZ: 0, doorX: 0 };
        const c = p.cab;
        if (door && dest.k === startK) {
          const sd = doorSide(door), x0 = sd * (inf.hw + 0.2);
          c.lx = x0; c.lz = door.zLocal; c.state = 'walk'; p.mode = 'move'; p.speed = p.base * WALK;
          c.path = [{ x: sd * (inf.hw - 0.4), z: door.zLocal }, { x: 0, z: door.zLocal }];
          if (Math.abs(place.z - door.zLocal) > 0.05) c.path.push({ x: 0, z: place.z });
          c.path.push({ x: place.x, z: place.z });
          c.hd = Math.atan2(-sd, 0);
        } else if (dest.seat) { c.state = 'sit'; p.sit = 1; }
        else if (dest.hold) { c.state = 'stand'; p.hold = 1; }
        return p;
      }
      function startLeaving(p, door) {
        const c = p.cab, car = cab.cars[c.k], inf = car.inf;
        releaseSpots(p);
        // the nearest door of his own car, on the side that is open
        const sd = door ? doorSide(door) : (chance(0.5) ? 1 : -1);
        let dz = inf.doors.length ? inf.doors[0] : 0;
        inf.doors.forEach((z) => { if (Math.abs(z - c.lz) < Math.abs(dz - c.lz)) dz = z; });
        c.path = [{ x: 0, z: c.lz }, { x: 0, z: dz }, { x: sd * (inf.hw - 0.4), z: dz }, { x: sd * (inf.hw + 0.25), z: dz }];
        c.pi = 0; c.state = p.sit > 0.2 ? 'rise' : 'leave'; p.hold = 0; p.mode = c.state === 'leave' ? 'move' : 'idle'; p.speed = p.base * WALK * 1.1;
      }
      function nearestPerson(door, filter) {
        let best = null, bd = 1e9;
        for (let i = 0; i <= highSlot; i++) {
          const p = people[i];
          if (!p.active || !p.cab || p.cab.state === 'leave' || p.cab.state === 'rise' || (filter && !filter(p))) continue;
          const sameCar = door && cab.cars[p.cab.k].i === door.car;
          const d = (sameCar ? 0 : 50) + (door ? Math.abs(p.cab.lz - door.zLocal) : Math.random() * 5);
          if (d < bd) { bd = d; best = p; }
        }
        return best;
      }
      function leaving() { return activeCount((p) => p.cab && (p.cab.state === 'leave' || p.cab.state === 'rise')); }
      const target = (total) => clamp(Math.round(total), 0, cap);
      function onBoard(door, total) {
        if (!cab.cars.length || count() >= target(total)) return;
        if (cab.active) spawn(door); else spawn(null, door ? door.car : 0);
      }
      function onAlight(door, total) {
        if (count() - leaving() <= target(total)) return;
        const p = nearestPerson(door);
        if (!p) return;
        if (cab.active) startLeaving(p, door); else removePerson(p);
      }
      /* bring the visible people to the real count (instant: nobody walks in or out) */
      function reconcile(total, instant) {
        if (!cab.cars.length) return;
        const want = target(total);
        let guard = 0;
        while (count() - leaving() < want && guard++ < cap) { if (!spawn(null, Math.floor(Math.random() * 5))) break; }
        while (count() - leaving() > want && guard++ < cap * 2) {
          const p = nearestPerson(null);
          if (!p) break;
          if (instant || !cab.active) removePerson(p); else startLeaving(p, null);
        }
      }
      function setActive(on, model) {
        if (model && model !== cab.model) setModel(model);
        cab.active = !!on; group.visible = !!on;
      }
      function advance(p, dt) {
        const c = p.cab;
        if (c.state === 'walk' || c.state === 'leave') {
          const w = c.path[c.pi];
          if (!w) { c.state = 'stand'; p.mode = 'idle'; return; }
          const dx = w.x - c.lx, dz = w.z - c.lz, d = Math.hypot(dx, dz), step = p.speed * dt;
          if (d > 0.001) c.hd += angleDiff(c.hd, Math.atan2(dx, dz)) * Math.min(1, 10 * dt);
          if (d <= step) {
            c.lx = w.x; c.lz = w.z; c.pi++;
            if (c.pi >= c.path.length) {
              if (c.state === 'leave') { removePerson(p); return; }
              p.mode = 'idle';
              if (c.seatRef) { c.state = 'sit'; } else { c.state = 'stand'; if (c.holdRef) p.hold = 0.01; }
              c.hd = c.destYaw;
            }
          } else { c.lx += (dx / d) * step; c.lz += (dz / d) * step; }
          p.phase += step * 4.2 / p.sc;
        } else if (c.state === 'rise') {
          p.sit = Math.max(0, p.sit - dt * 2.6);
          if (p.sit <= 0) { c.state = 'leave'; p.mode = 'move'; }
        } else if (c.state === 'sit') p.sit = Math.min(1, p.sit + dt * 2.6);
        else if (c.state === 'stand') { if (c.holdRef) p.hold = Math.min(1, p.hold + dt * 3); }
      }
      function update(dt, camera, info) {
        void camera;
        if (!cab.active || !cab.model) return;
        dt = Math.min(dt || 0, 0.1);
        cab.clock += dt;
        const a = info && Number.isFinite(info.accel) ? info.accel : 0;
        cab.accelS += (a - cab.accelS) * Math.min(1, dt * 2.5);
        cab.cars.forEach((c) => c.car.group.updateMatrixWorld(true));
        for (let i = 0; i <= highSlot; i++) {
          const p = people[i];
          if (!p.active || !p.cab) continue;
          advance(p, dt);
          if (!p.active) continue;
          const c = p.cab, car = cab.cars[c.k];
          mWorld.copy(car.car.group.matrixWorld);
          const m = mWorld.elements, ly = car.inf.floorY + FLOOR_EXTRA, lx = c.lx, lz = c.lz;
          c.wx = m[0] * lx + m[4] * ly + m[8] * lz + m[12]; c.wy = m[1] * lx + m[5] * ly + m[9] * lz + m[13]; c.wz = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
          const carYaw = Math.atan2(m[8], m[10]);
          if (c.state === 'sit' || c.state === 'rise') c.hd = c.destYaw;
          c.yaw = carYaw + c.hd;
          if (c.fresh) { p.yaw = c.yaw; c.fresh = false; }
          c.lean = clamp(cab.accelS * 0.06 * Math.cos(c.hd), -0.14, 0.14) * (1 - 0.6 * p.sit);   // a braking tram throws standing people forward, an accelerating one backward
          writePerson(p, cab.clock);
        }
        if (colorsDirty) { MESHES.forEach((mm) => { if (mm.instanceColor) mm.instanceColor.needsUpdate = true; }); colorsDirty = false; }
        refreshCounts();
        MESHES.forEach((mm) => { mm.instanceMatrix.needsUpdate = true; });
      }
      function cabStats() {
        let sitting = 0, standing = 0, walking = 0;
        for (let i = 0; i <= highSlot; i++) { const p = people[i]; if (!p.active || !p.cab) continue; if (p.cab.state === 'sit') sitting++; else if (p.cab.state === 'stand') standing++; else walking++; }
        return { total: sitting + standing + walking, sitting, standing, walking, active: cab.active, cap, cars: cab.cars.length, seats: cab.cars.reduce((n, c) => n + c.seats.length, 0) };
      }
      function cabFeet() {
        const out = [];
        for (let i = 0; i <= highSlot; i++) { const p = people[i]; if (p.active && p.cab) out.push({ slot: i, k: p.cab.k, state: p.cab.state, lx: p.cab.lx, lz: p.cab.lz, sit: p.sit, x: p.cab.wx, y: p.cab.wy, z: p.cab.wz }); }
        return out;
      }
      function dispose2() {
        clearAll();
        scene.remove(group);
        MESHES.forEach((mm) => { mm.geometry.dispose(); mm.dispose(); });
        matLit.dispose(); matUmb.dispose();
      }
      return { setActive, setModel, viewpoint, reconcile, onBoard, onAlight, update, stats: cabStats, feet: cabFeet, count, dispose: dispose2, get active() { return cab.active; }, get capacity() { return cap; } };
    }
    if (isCabin) return buildCabinApi();

    return { spawnPlatform, startExchange, stopExchange, update, stats, clear, dispose, setRain, kinds, feet, platformInfo, setCabinHooks: (h) => { hooks = h || {}; }, get visible() { return activeCount(); }, get capacity() { return cap; } };
  }

  TS.passengers = { create };

  /* ------------------------------------------------------------------ oncoming trams at their stops
   * The AI trams on the other track (luxtram-traffic.js) call TS.tramDwell.arrive(info) when they stand at a stop and depart({ id }) when they leave. While the player is within
   * NEAR_M of that stop, a small extra instance of this module plays the exchange on the OPPOSITE platform (the one of the opposite track; at an island stop the other side of the
   * island): 4..15 people get off and walk away over the end ramps (same surface rules as the player's platform: no sinking, nobody on the track side), the people waiting there walk
   * to the doors and board. Nothing here runs unless arrive() is called, so without the hook nothing changes.
   *   arrive(info = { id, stopName, platformSide, doors: [{ x, y, z }], dwellMs, getDoors }) -> milliseconds this exchange needs when that is more than dwellMs, else undefined
   *   depart({ id }) -> whoever is still on the way to the doors stays on the platform */
  const NEAR_M = 250, MAX_SESSIONS = 2, DWELL_CAP_MS = 45000, TAIL_S = 25;
  const dwell = { ctx: null, sessions: new Map(), free: [], made: 0 };
  function dwellCap(q) { return q === 'low' ? 24 : q === 'medium' ? 32 : 40; }
  function dwellInstance() {
    if (dwell.free.length) return dwell.free.pop();
    if (dwell.made >= MAX_SESSIONS || !dwell.ctx) return null;
    dwell.made++;
    return create(dwell.ctx.scene, { quality: dwell.ctx.quality, cap: dwellCap(dwell.ctx.quality), name: 'ts-passengers-oncoming' });
  }
  function dwellRelease(sess) {
    try { sess.inst.clear(); } catch (e) { /* nothing */ }
    dwell.free.push(sess.inst);
  }
  TS.tramDwell = {
    /* ctx = { scene, track, quality, playerS(): number, platformHeight(i), obstaclesOf(station, platformInfo) } */
    attach(ctx) { this.detach(); dwell.ctx = ctx; },
    detach() {
      dwell.sessions.forEach((x) => { try { x.inst.dispose(); } catch (e) { /* nothing */ } });
      dwell.free.forEach((i) => { try { i.dispose(); } catch (e) { /* nothing */ } });
      dwell.sessions.clear(); dwell.free.length = 0; dwell.made = 0; dwell.ctx = null;
    },
    arrive(info) {
      const c = dwell.ctx;
      if (!c || !info || dwell.sessions.has(info.id)) return undefined;
      try {
        const track = c.track, opp = track.opposite, stations = track.stations || [];
        const idx = stations.findIndex((st) => st.name === info.stopName);
        if (!opp || idx < 0 || !Array.isArray(info.doors) || !info.doors.length) return undefined;
        const st = stations[idx];
        if (Math.abs(st.s - c.playerS()) > NEAR_M) return undefined;   // only where the player can see it
        const pinfo = track.platformInfo(idx), island = pinfo.kind === 'island';
        // the real distance between the two track centres here (platformInfo.oppLat is what the platform was built for, and is not always what the opposite track does)
        const f0 = track.frameAt(st.s), g0 = opp.frameAt(st.s), D = Math.abs((g0.pos.x - f0.pos.x) * f0.right.x + (g0.pos.z - f0.pos.z) * f0.right.z);
        if (island && D - pinfo.edge - pinfo.width < 0.9) return undefined;   // no island between the tracks to walk on: leave this one standing as it is
        const inst = dwellInstance();
        if (!inst) return undefined;
        const side = island ? 'right' : 'left';                      // seen from the opposite track: its platform is on the far left, the island on its right
        const sign = side === 'left' ? -1 : 1;
        const alighting = 4 + Math.floor(Math.random() * 12), boarding = 3 + Math.floor(Math.random() * 8);
        const pseudo = { frameAt: opp.frameAt, kind: 'tram' };
        const W = pinfo.width;
        const edge = island ? D - pinfo.edge - W : pinfo.edge;   // island: the far edge of the island is the near edge seen from the other track
        let obstacles = [];
        try { obstacles = c.obstaclesOf ? c.obstaclesOf(st, pinfo) : []; } catch (e) { obstacles = []; }
        if (island) { obstacles = obstacles.map((b) => ({ s: b.s, o: D - b.o, hs: b.hs, ho: b.ho })); }
        inst.spawnPlatform(st, pseudo, { count: boarding, side, platformHeight: c.platformHeight(idx), edgeOffset: edge, width: W, trainLength: 45, tram: true, obstacles });
        const doorsWorld = info.doors.map((d) => {
          let best = 0, bd = 1e9;   // nearest sample of the opposite track: its right vector gives the way to the platform
          for (let k = 0; k < 6; k++) { const sS = st.s + (k - 3) * 8, f = opp.frameAt(sS), dd = Math.hypot(f.pos.x - d.x, f.pos.z - d.z); if (dd < bd) { bd = dd; best = sS; } }
          const f = opp.frameAt(best);
          return { pos: { x: d.x, y: d.y, z: d.z }, dir: { x: f.right.x * sign, z: f.right.z * sign }, side };
        });
        inst.startExchange({ doorsWorld, alighting, boarding });
        const needMs = Math.min(DWELL_CAP_MS, 9000 + alighting * 800 + boarding * 1100);
        dwell.sessions.set(info.id, { id: info.id, inst, station: idx, departed: false, tail: 0, alighting, boarding, start: performance.now() });
        return needMs > (info.dwellMs || 0) ? needMs : undefined;
      } catch (e) { console.warn('[Lokféierer] tramDwell.arrive', e); return undefined; }
    },
    depart(info) {
      const sess = info && dwell.sessions.get(info.id);
      if (!sess || sess.departed) return;
      sess.departed = true; sess.tail = TAIL_S;
      try { sess.inst.stopExchange(); } catch (e) { /* nothing */ }
    },
    update(dt, camera) {
      if (!dwell.sessions.size) return;
      dwell.sessions.forEach((sess, id) => {
        try { sess.inst.update(dt, camera); } catch (e) { console.warn('[Lokféierer] tramDwell.update', e); }
        if (sess.departed) { sess.tail -= dt; if (sess.tail <= 0) { dwell.sessions.delete(id); dwellRelease(sess); } }
        else if (dwell.ctx && Math.abs(dwell.ctx.track.stations[sess.station].s - dwell.ctx.playerS()) > NEAR_M * 1.6) { dwell.sessions.delete(id); dwellRelease(sess); }   // the player drove away
      });
    },
    sessions() { return [...dwell.sessions.values()]; },   // test hook
  };
})();
