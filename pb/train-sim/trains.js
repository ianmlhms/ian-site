/* Lokféierer: exterior train models (agent B).
 * TS.trains.create(trainConfig, { quality, livery, upgrades }) -> TrainModel (see CONTRACT.md).
 * Car frame: forward = -Z, right = +X, origin = body centre at rail-top height.
 * Extras: TS.trains.specs, TS.trains.frontCarLength(cfg), TS.trains.PANTO_WIRE_Y,
 *         model.setWheelDistance(m), model.wheelRadius, car.bogies, car.nose,
 *         model.setExhaust(level01) (diesel smoke; no-op on electric trains). */
(function () {
  'use strict';
  window.TS = window.TS || {};
  const T = THREE;
  const PANTO_WIRE_Y = 5.3; // contact wire height above rail top (A1 CONTACT_H)
  const REF_WHEEL_R = 0.45;
  const GAUGE_HALF = 0.7175;
  const warn = (m) => console.warn('[Lokféierer] trains: ' + m);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const TMP = new T.Color();
  const toRGB = (c) => { TMP.set(c); return [TMP.r, TMP.g, TMP.b]; };
  const lum = (c) => { TMP.set(c); return 0.2126 * TMP.r + 0.7152 * TMP.g + 0.0722 * TMP.b; };

  /* ------------------------------------------------------------------ specs */
  const INSIDE_EMIT = 0x45443f, INSIDE_EMIT_ON = 0x80796a, SEAT_EMIT = 0x4a4a50, SEAT_EMIT_ON = 0x62626a;
  const WIN_DARK = '#161d23';
  const SEAT_COL = { railcar: '#8c3a30', emu: '#2d6aa6', tram: '#d4582f', kiss: '#2f8466', ic: '#a02b3b', hst: '#2b4e9a' };
  const SPECS = {
    railcar: {
      W: 2.85, yb: 0.6, floor: 1.05, sill: 1.82, head: 2.95, ytop: 3.95, wheelR: 0.46, wb: 2.4, gap: 0.9,
      pillar: '#e9dcc0', bay: 1.3, doorW: 1.05, doorY0: 0.7, doorMargin: 3.4, bellows: false, buffers: true, diesel: true,
      recipe: { lower: 'body', mid: 'body', upper: 'accent', nose: 'body', doorLower: 'body', doorUpper: 'accent', stripeCol: 'accent', roof: '#bfc3c4' },
      nose: { len: 1.1, N: 5, capSx: 0.88, a: 2.4, b: 2, drop: 0.2, lift: 0, rake: 0.05, pd: 2, pl: 2, pr: 1, sideWin: [1, 3] },
      scr: { kind: 'twin', hw: 1.05, y0: 1.95, y1: 3.15 }, cabFloor: 1.05, mirror: 0.18,
      kinds: { rc: { body: 22.0, bogie: 7.2, front: true, rear: true, doors: 2 } },
    },
    emu: {
      W: 2.88, yb: 0.6, floor: 1.0, sill: 1.78, head: 3.0, ytop: 4.1, wheelR: 0.43, wb: 2.5, gap: 0.8,
      pillar: '#20262b', bay: 1.7, doorW: 1.3, doorY0: 0.62, doorMargin: 3.7, bellows: true, buffers: false,
      recipe: { lower: 'body', mid: 'accent', upper: 'body', nose: 'accent', doorLower: 'accent', doorUpper: 'body', stripeCol: 'stripe', roof: '#c9ced1' },
      nose: { len: 2.6, N: 8, capSx: 0.78, a: 1.5, b: 1.6, drop: 0.5, lift: 0.0, rake: 0.2, pd: 2, pl: 2, pr: 1, sideWin: [2, 5] },
      scr: { kind: 'single', hw: 0.95, y0: 1.85, y1: 3.15 }, cabFloor: 1.0, mirror: 0.2,
      kinds: { cabF: { body: 25.0, bogie: 8.6, front: true, doors: 3 }, mid: { body: 25.0, bogie: 8.6, doors: 3 }, cabR: { body: 25.0, bogie: 8.6, rear: true, doors: 3, panto: [5.8] } },
    },
    tram: {
      W: 2.4, yb: 0.3, floor: 0.4, sill: 0.98, head: 2.45, ytop: 3.5, wheelR: 0.3, wb: 1.8, gap: 0.55,
      pillar: '#2a3036', bay: 1.5, doorW: 1.3, doorY0: 0.42, doorMargin: 2.4, bellows: true, bellowsFull: true, buffers: false, tram: true,
      recipe: { lower: 'accent', mid: 'body', upper: 'body', nose: 'body', doorLower: 'accent', doorUpper: 'body', stripeCol: 'stripe', roof: '#d7dadc' },
      nose: { len: 1.5, N: 6, capSx: 0.86, a: 2, b: 2, drop: 0.45, lift: 0.0, rake: 0.1, pd: 2, pl: 2, pr: 1, sideWin: [1, 4] },
      scr: { kind: 'single', hw: 0.95, y0: 1.4, y1: 2.75 }, cabFloor: 0.62, mirror: 0.22,
      kinds: { cabF: { body: 8.8, bogie: 2.6, front: true, doors: 1 }, mid: { body: 7.6, bogie: 2.4, doors: 1 }, midP: { body: 7.6, bogie: 2.4, doors: 1, panto: [0.4] }, cabR: { body: 8.8, bogie: 2.6, rear: true, doors: 1 } },
    },
    kiss: {
      W: 2.8, yb: 0.6, floor: 1.0, sill: 1.15, head: 2.05, sill2: 2.95, head2: 3.85, ytop: 4.6, wheelR: 0.43, wb: 2.5, gap: 0.8,
      pillar: '#20262b', bay: 1.6, doorW: 1.3, doorY0: 0.62, doorMargin: 3.7, bellows: true, buffers: false, double: true,
      recipe: { lower: 'body', mid: 'accent', upper: 'body', nose: 'accent', doorLower: 'accent', doorUpper: 'body', stripeCol: 'stripe', roof: '#c9ced1' },
      nose: { len: 2.8, N: 8, capSx: 0.8, a: 2.2, b: 2, drop: 0.55, lift: 0, rake: 0.12, pd: 2, pl: 2, pr: 1, sideWin: [2, 5] }, cabWin: { y0: 1.85, y1: 2.95 },
      scr: { kind: 'single', hw: 0.95, y0: 1.85, y1: 3.15 }, cabFloor: 1.0, mirror: 0.2,
      kinds: { cabF: { body: 25.0, bogie: 8.6, front: true, doors: 2 }, mid: { body: 25.0, bogie: 8.6, doors: 2 }, midP: { body: 25.0, bogie: 8.6, doors: 2, panto: [6.0] }, cabR: { body: 25.0, bogie: 8.6, rear: true, doors: 2 } },
    },
    ic: {
      W: 2.82, yb: 0.62, floor: 1.12, sill: 1.85, head: 3.0, ytop: 4.2, wheelR: 0.46, wb: 2.6, gap: 1.0,
      pillar: '#20262b', bay: 1.5, doorW: 1.2, doorY0: 0.66, doorMargin: 3.3, bellows: true, buffers: true, tables: true,
      recipe: { lower: 'accent', mid: 'accent', upper: 'accent', nose: 'body', doorLower: 'accent', doorUpper: 'accent', stripeCol: 'body', roof: '#c4c8cb' },
      nose: { len: 2.4, N: 8, capSx: 0.8, a: 2.2, b: 2, drop: 0.5, lift: 0, rake: 0.1, pd: 2, pl: 2, pr: 1, sideWin: [2, 5] },
      scr: { kind: 'single', hw: 0.95, y0: 1.95, y1: 3.15 }, cabFloor: 1.12, mirror: 0.2,
      loco: {
        W: 3.0, yb: 0.75, floor: 1.35, sill: 2.0, head: 3.3, ytop: 4.25, wheelR: 0.6, wb: 2.8, cabFloor: 1.35,
        nose: { len: 0.9, N: 4, capSx: 0.95, a: 3, b: 2, drop: 0.1, lift: 0, rake: 0.07, pd: 2, pl: 2, pr: 1, sideWin: null },
        scr: { kind: 'twin', hw: 1.15, y0: 2.25, y1: 3.4, pillarCol: '#14171a' }, apron: { depth: 0.3 }, cabDoor: true,
        recipe: { lower: 'body', mid: 'body', upper: 'body', nose: 'body', doorLower: 'body', doorUpper: 'body', stripeCol: 'stripe', roof: '#b4babd' },
      },
      kinds: { loco: { body: 19.0, bogie: 5.2, front: true, loco: true, doors: 0, panto: [-3.6, 3.6] }, coach: { body: 26.4, bogie: 9.0, doors: 2 }, dt: { body: 26.4, bogie: 9.0, rear: true, doors: 2 } },
    },
    hst: {
      W: 2.9, yb: 0.62, floor: 1.1, sill: 1.85, head: 3.05, ytop: 4.1, wheelR: 0.46, wb: 3.0, gap: 0.5,
      pillar: '#20262b', bay: 1.4, doorW: 1.25, doorY0: 0.66, doorMargin: 2.6, bellows: true, buffers: false, tables: true,
      recipe: { lower: 'body', mid: 'accent', upper: 'body', nose: 'body', doorLower: 'accent', doorUpper: 'body', stripeCol: 'stripe', roof: '#c9ced1' },
      nose: { len: 9.0, N: 18, capSx: 0.22, a: 1.0, b: 1.15, drop: 1.9, lift: 0.4, rake: 0.0, pd: 1.3, pl: 1.6, pr: 1, sideWin: null, roofScr: { k0: 1, k1: 8, xlim: 0.85 } },
      scr: { kind: 'roof', hw: 0.72, y0: 2.35, y1: 3.3 }, cabFloor: 1.45, mirror: 0.2, tilt: true, cabFrame: { dz: 4.4, capSx: 0.66, rake: 0.1 },
      pc: { floor: 1.45, cabFloor: 1.45, wb: 3.0, wheelR: 0.46 },
      kinds: { pcF: { body: 22.0, bogie: 7.4, front: true, pcar: true, doors: 0, panto: [5.5] }, trailer: { body: 18.2, bogie: 9.35, doors: 2, shared: true }, pcR: { body: 22.0, bogie: 7.4, rear: true, pcar: true, doors: 0, panto: [-5.5] } },
    },
  };

  function composition(model, count) {
    const n = Math.max(1, count | 0);
    const mk = (kind, i) => ({ kind, index: i });
    if (model === 'railcar') return [mk('rc', 0)];
    if (model === 'emu') return Array.from({ length: Math.max(2, n) }, (_, i) => mk(i === 0 ? 'cabF' : i === n - 1 ? 'cabR' : 'mid', i));
    if (model === 'tram') return Array.from({ length: Math.max(2, n) }, (_, i, a) => mk(i === 0 ? 'cabF' : i === n - 1 ? 'cabR' : i === 1 ? 'midP' : 'mid', i));
    if (model === 'kiss') return Array.from({ length: Math.max(2, n) }, (_, i) => mk(i === 0 ? 'cabF' : i === n - 1 ? 'cabR' : i === 1 ? 'midP' : 'mid', i));
    if (model === 'ic') return Array.from({ length: Math.max(2, n) }, (_, i) => mk(i === 0 ? 'loco' : i === n - 1 ? 'dt' : 'coach', i));
    if (model === 'hst') return Array.from({ length: Math.max(2, n) }, (_, i) => mk(i === 0 ? 'pcF' : i === n - 1 ? 'pcR' : 'trailer', i));
    return [mk('rc', 0)];
  }

  /* ---------------------------------------------------------------- materials */
  const shared = {};
  function sharedMats() {
    if (shared.paint) return shared;
    const vc = { vertexColors: true };
    shared.paint = new T.MeshStandardMaterial({ ...vc, roughness: 0.36, metalness: 0.18 });
    shared.trim = new T.MeshStandardMaterial({ ...vc, roughness: 0.62, metalness: 0.15 });
    shared.metal = new T.MeshStandardMaterial({ ...vc, roughness: 0.42, metalness: 0.8, side: T.DoubleSide });
    shared.rubber = new T.MeshStandardMaterial({ ...vc, roughness: 0.95, metalness: 0 });
    shared.glass = new T.MeshStandardMaterial({ color: 0x4f6779, roughness: 0.05, metalness: 0.5, transparent: true, opacity: 0.34, depthWrite: false, envMapIntensity: 0.5 });
    shared.inside = new T.MeshStandardMaterial({ color: 0xbcbab2, roughness: 0.95, metalness: 0, side: T.BackSide });
    shared.floor = new T.MeshStandardMaterial({ ...vc, roughness: 0.9, metalness: 0, side: T.DoubleSide });
    shared.lit = new T.MeshBasicMaterial({ ...vc, side: T.DoubleSide });
    shared.lensOff = new T.MeshStandardMaterial({ ...vc, roughness: 0.2, metalness: 0.3 });
    shared.vest = new T.MeshBasicMaterial({ map: vestTexture() });
    shared.m = shared.metal; shared.r = shared.rubber;
    for (const k of Object.keys(shared)) if (shared[k]) shared[k].userData.shared = true;
    return shared;
  }
  let vestTex = null;
  function vestTexture() { // painted vestibule: side walls in perspective, floor, ceiling lamp, partition, grab poles
    if (vestTex) return vestTex;
    const w = 256, h = 512, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const x = cv.getContext('2d');
    x.fillStyle = '#d6d2bb'; x.fillRect(0, 0, w, h);
    const bx0 = 58, bx1 = 198, by0 = 120, by1 = 380; // back wall rectangle
    const poly = (pts, c) => { x.fillStyle = c; x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); x.fill(); };
    poly([[0, 0], [w, 0], [bx1, by0], [bx0, by0]], '#f2efe2'); // ceiling
    poly([[0, h], [w, h], [bx1, by1], [bx0, by1]], '#6f6c60'); // floor
    poly([[0, 0], [bx0, by0], [bx0, by1], [0, h]], '#b9b49c'); // left wall
    poly([[w, 0], [bx1, by0], [bx1, by1], [w, h]], '#a9a48d'); // right wall
    x.fillStyle = '#8f8c7c'; x.fillRect(bx0, by0, bx1 - bx0, by1 - by0); // back partition
    x.fillStyle = '#3d5667'; x.fillRect(bx0 + 22, by0 + 24, bx1 - bx0 - 44, 120); // glass towards the saloon
    x.fillStyle = '#c8d3d8'; x.fillRect(bx0 + 22, by0 + 24, bx1 - bx0 - 44, 14);
    x.fillStyle = '#fffbe6'; x.fillRect(70, 12, 116, 14); x.fillStyle = '#fff'; x.fillRect(96, 40, 64, 8); // lamps
    x.fillStyle = '#e3b92c'; x.fillRect(20, 40, 10, h - 90); x.fillRect(w - 30, 40, 10, h - 90); // grab poles
    x.fillStyle = 'rgba(0,0,0,0.28)'; x.fillRect(0, h - 70, w, 70); // dark step well
    x.fillStyle = '#e3d04a'; x.fillRect(0, h - 74, w, 6); // yellow step edge
    vestTex = new T.CanvasTexture(cv); vestTex.colorSpace = T.SRGBColorSpace; vestTex.anisotropy = 4;
    return vestTex;
  }
  const glowCache = new Map();
  function glowTexture(col) {
    if (glowCache.has(col)) return glowCache.get(col);
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, col); g.addColorStop(0.25, col + 'aa'); g.addColorStop(1, col + '00');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; glowCache.set(col, t); return t;
  }
  function trainMats() {
    const s = sharedMats();
    const m = Object.assign({}, s);
    m.headF = new T.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, emissive: 0xfff3d0, emissiveIntensity: 0, roughness: 0.2, metalness: 0.2 });
    m.tailR = new T.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, emissive: 0xff2a1a, emissiveIntensity: 0, roughness: 0.3, metalness: 0.1 });
    m.lamp = new T.MeshBasicMaterial({ vertexColors: true, color: 0xdad6c6 });
    m.glass = shared.glass.clone();
    m.glass.userData.shared = false;
    m.inside = shared.inside.clone(); m.inside.userData.shared = false; m.inside.emissive = new T.Color(INSIDE_EMIT);
    m.seat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, emissive: new T.Color(SEAT_EMIT) });
    m.glowHead = new T.SpriteMaterial({ map: glowTexture('#fff2cf'), blending: T.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 });
    m.glowTail = new T.SpriteMaterial({ map: glowTexture('#ff3a24'), blending: T.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 });
    m.insideFwd = m.inside.clone(); m.insideFwd.userData.shared = false;
    m.ghost = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false }); // invisible but still casts shadows
    m.own = [m.insideFwd, m.ghost, m.headF, m.tailR, m.lamp, m.glass, m.inside, m.seat, m.glowHead, m.glowTail];
    return m;
  }

  /* ---------------------------------------------------------------- geometry helpers */
  function prep(g, color) {
    const n = g.index ? g.toNonIndexed() : g.clone();
    const cnt = n.attributes.position.count;
    if (!n.attributes.normal) n.computeVertexNormals();
    if (!n.attributes.uv) n.setAttribute('uv', new T.BufferAttribute(new Float32Array(cnt * 2), 2));
    if (color !== undefined && color !== null) {
      const c = toRGB(color), arr = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) { arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2]; }
      n.setAttribute('color', new T.BufferAttribute(arr, 3));
    } else if (!n.attributes.color) {
      n.setAttribute('color', new T.BufferAttribute(new Float32Array(cnt * 3).fill(1), 3));
    }
    return n;
  }
  function mergeInto(entries) {
    let n = 0;
    for (const e of entries) n += e.g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
    const geo = new T.BufferGeometry();
    let o = 0, matIndex = 0;
    const groupsByKey = new Map();
    for (const e of entries) {
      const c = e.g.attributes.position.count;
      pos.set(e.g.attributes.position.array, o * 3); nor.set(e.g.attributes.normal.array, o * 3);
      uv.set(e.g.attributes.uv.array, o * 2); col.set(e.g.attributes.color.array, o * 3);
      o += c;
    }
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    return geo;
  }
  /* Builder: collects geometry per material key (applying the current transform) and bakes one multi-material mesh. */
  function makeBuilder() {
    const buckets = new Map();
    const raw = [];
    const b = { xf: new T.Matrix4(), raw };
    b.push = (key, g, color) => {
      const p = prep(g, color);
      p.applyMatrix4(b.xf);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(p); raw.push({ g: p });
    };
    b.box = (key, w, h, d, x, y, z, color) => { const g = new T.BoxGeometry(w, h, d); g.translate(x, y, z); b.push(key, g, color); };
    b.cyl = (key, r1, r2, h, x, y, z, color, axis, seg) => {
      const g = new T.CylinderGeometry(r1, r2, h, seg || 12);
      if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
      g.translate(x, y, z); b.push(key, g, color);
    };
    b.geo = (key, g, color) => b.push(key, g, color);
    b.bake = (mats, opts) => {
      const keys = [...buckets.keys()];
      if (!keys.length) return null;
      const entries = [], groups = [], materials = [];
      let start = 0;
      for (const k of keys) {
        let cnt = 0;
        for (const g of buckets.get(k)) { entries.push({ g }); cnt += g.attributes.position.count; }
        groups.push({ start, count: cnt, mi: materials.length }); materials.push(mats[k] || mats.paint); start += cnt;
      }
      const geo = mergeInto(entries);
      for (const g of groups) geo.addGroup(g.start, g.count, g.mi);
      const mesh = new T.Mesh(geo, materials.length === 1 ? materials[0] : materials);
      mesh.castShadow = !(opts && opts.noShadow); mesh.receiveShadow = !!(opts && opts.receive);
      return mesh;
    };
    return b;
  }
  const rboxCache = new Map();
  function rbox(w, h, d, r) {
    const key = [w, h, d, r].map((v) => v.toFixed(3)).join('|');
    if (rboxCache.has(key)) return rboxCache.get(key).clone();
    const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001);
    const s = new T.Shape();
    s.moveTo(-w / 2 + rr, -h / 2); s.lineTo(w / 2 - rr, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + rr);
    s.lineTo(w / 2, h / 2 - rr); s.quadraticCurveTo(w / 2, h / 2, w / 2 - rr, h / 2); s.lineTo(-w / 2 + rr, h / 2);
    s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - rr); s.lineTo(-w / 2, -h / 2 + rr); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + rr, -h / 2);
    const bev = Math.min(0.02, d / 4);
    const g = new T.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * bev), bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: 1, curveSegments: 3 });
    g.translate(0, 0, -(d - 2 * bev) / 2);
    g.userData.shared = true;
    rboxCache.set(key, g);
    return g.clone();
  }
  function roundedPoly(hw, y0, y1, r, topInset) {
    const pts = [], seg = 5;
    const corner = (cx, cy, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI / 2; pts.push(new T.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r)); } };
    const ti = topInset || 0;
    corner(hw - r, y0 + r, -Math.PI / 2);
    corner(hw - ti - r, y1 - r, 0);
    corner(-hw + ti + r, y1 - r, Math.PI / 2);
    corner(-hw + r, y0 + r, Math.PI);
    return pts;
  }

  /* generic loft: rings = array of arrays of {x,y,z,c:[r,g,b]} (same length M), skip(k,i) hides a quad */
  function loft(rings, skip) {
    const K = rings.length, M = rings[0].length;
    const pos = new Float32Array(K * M * 3), col = new Float32Array(K * M * 3);
    for (let k = 0; k < K; k++) for (let i = 0; i < M; i++) {
      const p = rings[k][i], o = (k * M + i) * 3;
      pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z; col[o] = p.c[0]; col[o + 1] = p.c[1]; col[o + 2] = p.c[2];
    }
    const idx = [], starts = [];
    for (let k = 0; k < K - 1; k++) for (let i = 0; i < M; i++) {
      if (i === 0) starts[k] = idx.length;
      if (skip && skip(k, i)) continue;
      const a = k * M + i, b = k * M + (i + 1) % M, c = (k + 1) * M + i, d = (k + 1) * M + (i + 1) % M;
      idx.push(a, b, c, b, d, c);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    starts[K - 1] = idx.length;
    g.setIndex(idx); g.computeVertexNormals(); g.userData.starts = starts;
    return g;
  }
  /* planar shape in the XY plane placed on a (possibly raked) front plane at z0 + rake*(y - yRef) + off, facing -Z */
  function planeShape(shape, z0, rake, yRef, off, color, flip) {
    const g = new T.ShapeGeometry(shape, 6);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, z0 + rake * (y - yRef) + off); }
    const idx = g.index.array, out = [];
    for (let i = 0; i < idx.length; i += 3) { if (flip) out.push(idx[i], idx[i + 2], idx[i + 1]); else out.push(idx[i], idx[i + 1], idx[i + 2]); }
    g.setIndex(out);
    g.computeVertexNormals();
    const n = new Float32Array(p.count * 3);
    const nz = flip ? -1 : 1, ny = flip ? rake : -rake, len = Math.hypot(nz, ny);
    for (let i = 0; i < p.count; i++) { n[i * 3 + 1] = ny / len; n[i * 3 + 2] = nz / len; }
    g.setAttribute('normal', new T.BufferAttribute(n, 3));
    return prep(g, color);
  }

  /* ---------------------------------------------------------------- cached parts */
  const cache = new Map();
  const memo = (key, fn) => { if (!cache.has(key)) { const v = fn(); if (v && v.isBufferGeometry) v.userData.shared = true; cache.set(key, v); } return cache.get(key); };

  function wheelGeo(R) {
    const pts = [[0.06, -0.07], [0.1, -0.07], [0.12, -0.035], [R - 0.1, -0.035], [R - 0.07, -0.07], [R, -0.07], [R, 0.05], [R + 0.03, 0.075], [R - 0.02, 0.095], [R - 0.1, 0.06], [0.13, 0.06], [0.06, 0.06], [0.06, -0.07]]
      .map((p) => new T.Vector2(p[0], p[1]));
    // one lathe per profile segment: hard edges between segments, smooth shading around the axle
    const parts = [];
    for (let i = 0; i < pts.length - 1; i++) parts.push({ g: prep(new T.LatheGeometry([pts[i], pts[i + 1]], 48)) });
    return mergeInto(parts);
  }
  function wheelsetGeo(R, motor) {
    return memo('ws:' + R + ':' + motor, () => {
      const b = makeBuilder();
      for (const s of [-1, 1]) {
        const w = wheelGeo(R); w.rotateZ(s > 0 ? Math.PI / 2 : -Math.PI / 2); w.translate(s * GAUGE_HALF, 0, 0);
        b.push('m', w, '#6b6e72');
        b.cyl('m', 0.1, 0.1, 0.1, s * 0.9, 0, 0, '#3a3d40', 'x', 10); // axlebox
        b.cyl('m', 0.055, 0.055, 0.04, s * 0.96, 0, 0, '#a9acb0', 'x', 8);
        for (const dx of [0.3, 0.42]) b.cyl('m', R * 0.66, R * 0.66, 0.022, s * dx, 0, 0, dx > 0.35 ? '#555a5e' : '#85898d', 'x', 24); // brake discs
      }
      b.cyl('m', 0.06, 0.06, 2.0, 0, 0, 0, '#454a4e', 'x', 8);
      b.box('m', 0.4, 0.34, 0.4, 0, 0, 0.18, '#50555a');
      if (motor) b.cyl('m', 0.2, 0.2, 0.5, 0.28, 0, -0.32, '#3e4246', 'x', 12);
      return mergeInto(b.raw);
    });
  }
  function springGeo() {
    return memo('spring', () => {
      class Helix extends T.Curve { getPoint(t, tg) { const a = t * Math.PI * 2 * 3.5; return (tg || new T.Vector3()).set(Math.cos(a) * 0.055, t * 0.3, Math.sin(a) * 0.055); } }
      return new T.TubeGeometry(new Helix(), 36, 0.011, 5, false);
    });
  }
  function bogieFrameGeo(S, R, wb, motor) {
    return memo('bf:' + [R, wb, motor, S.tram].join(':'), () => {
      const b = makeBuilder();
      const by = R + 0.46, sx = 1.02;
      for (const s of [-1, 1]) {
        b.box('m', 0.16, 0.22, wb + 0.9, s * sx, by, 0, '#34383c');
        b.box('m', 0.14, 0.12, wb + 0.4, s * sx, by + 0.14, 0, '#2a2d30');
        for (const z of [-wb / 2, wb / 2]) {
          const sp = springGeo().clone(); sp.translate(s * 0.9, R + 0.1, z); b.push('m', sp, '#9aa0a5'); // coil spring above axlebox
          b.cyl('m', 0.045, 0.045, 0.28, s * 0.98, R + 0.2, z + 0.12, '#222', null, 6); // damper
        }
        b.cyl('r', 0.17, 0.17, 0.22, s * 1.0, by + 0.24, 0, '#1c1c1d', null, 14); // air spring
        b.box('m', 0.08, 0.1, 0.5, s * 0.5, R + 0.06, wb / 2 - 0.12, '#85898e'); // brake caliper
        b.box('m', 0.08, 0.1, 0.5, s * 0.5, R + 0.06, -wb / 2 + 0.12, '#85898e');
      }
      b.box('m', 2.0, 0.24, 0.3, 0, by, 0, '#3a3e42');
      b.box('m', 1.1, 0.12, 0.16, 0, by - 0.18, wb * 0.32, '#4a4f54');
      b.cyl('m', 0.05, 0.05, 0.5, 0, by + 0.05, 0.4, '#8a8e92', 'z', 6); // traction rod
      return mergeInto(b.raw);
    });
  }
  function seatGeo() { // one seat unit (0.46 m wide), faces -Z; vertex colour = fabric shade (tinted per instance)
    return memo('seat', () => {
      const b = makeBuilder();
      b.box('t', 0.4, 0.3, 0.36, 0, 0.17, -0.02, '#34383d');          // pedestal
      b.box('t', 0.46, 0.1, 0.46, 0, 0.42, 0, '#ebebeb');             // cushion
      b.box('t', 0.46, 0.6, 0.1, 0, 0.78, 0.2, '#d6d6d6');            // backrest
      b.box('t', 0.34, 0.2, 0.08, 0, 1.2, 0.2, '#ffffff');            // headrest
      b.box('t', 0.4, 0.5, 0.03, 0, 0.78, 0.26, '#41464c');           // plastic shell
      b.box('t', 0.04, 0.2, 0.34, 0.25, 0.58, 0.03, '#3a3e44');       // armrest
      return mergeInto(b.raw);
    });
  }
  function bellowsGeo(w, h, y0, len, sx) {
    return memo('bel:' + [w, h, y0, len].map((v) => v.toFixed(2)).join(':'), () => {
      const rings = [], ridges = 6;
      const base = roundedPoly(w / 2, 0, h, Math.min(0.5, w * 0.2), 0.0).concat([]);
      const c = [0.09, 0.09, 0.1];
      for (let k = 0; k <= ridges * 2; k++) {
        const sc = k % 2 ? 0.93 : 1.0, z = (k / (ridges * 2)) * len;
        rings.push(base.map((p) => ({ x: p.x * sc, y: y0 + h / 2 + (p.y - h / 2) * sc, z, c })));
      }
      return loft(rings, null);
    });
  }

  /* ---------------------------------------------------------------- body */
  function recipeColors(S, livery) {
    const map = { body: livery.body, accent: livery.accent, stripe: livery.stripe };
    const r = S.recipe, g = (k) => map[k] || k;
    return { lower: g(r.lower), mid: g(r.mid), upper: g(r.upper), nose: g(r.nose), doorLower: g(r.doorLower), doorUpper: g(r.doorUpper), stripe: g(r.stripeCol), roof: r.roof, skirt: '#2a2e32', body: livery.body, accent: livery.accent };
  }
  function buildBands(S, C, win) {
    const bands = [];
    const y0 = S.yb + 0.12, t = S.sill - y0;
    const add = (a, b, c, w) => bands.push({ y0: a, y1: b, c: toRGB(c), win: !!w });
    add(y0, y0 + t * 0.26, C.skirt);
    add(y0 + t * 0.26, y0 + t * 0.62, C.lower);
    add(y0 + t * 0.62, y0 + t * 0.7, C.stripe);
    add(y0 + t * 0.7, S.sill, C.mid);
    if (S.double) {
      add(S.sill, S.head, win ? S.pillar : C.mid, win);
      add(S.head, S.sill2, C.upper);
      add(S.sill2, S.head2, S.pillar, win);
      add(S.head2, S.head2 + 0.24, C.mid);
    } else {
      add(S.sill, S.head, win ? S.pillar : C.mid, win);
      add(S.head, S.head + 0.26, C.upper);
    }
    return bands;
  }
  function noseShapeAt(nose, u) {
    return {
      sx: nose.capSx + (1 - nose.capSx) * Math.pow(Math.max(0, 1 - Math.pow(u, nose.a)), 1 / nose.b),
      lift: nose.lift * Math.pow(u, nose.pl), drop: nose.drop * Math.pow(u, nose.pd), rake: nose.rake * Math.pow(u, nose.pr),
    };
  }
  /* Build body ring (right half bottom->top, mirrored) for a row shape. Returns { pts, nR } */
  function ringFor(S, bands, roofC, row, noseC) {
    const hw = (S.W / 2) * row.sx, yb = S.yb + row.lift;
    const mapY = (y) => {
      if (y < S.sill) return yb + (y - S.yb) * (S.sill - yb) / (S.sill - S.yb);
      const ytop2 = S.ytop - row.drop, k = (ytop2 - S.sill) / (S.ytop - S.sill);
      return S.sill + (y - S.sill) * k;
    };
    const R = [];
    R.push({ x: 0, y: yb, c: bands[0].c });
    R.push({ x: hw * 0.84, y: yb, c: bands[0].c });
    bands.forEach((b, bi) => { const c = noseC && bi > 0 ? noseC : b.c; R.push({ x: hw, y: mapY(b.y0), c }); R.push({ x: hw, y: mapY(b.y1), c }); });
    const lastY = R[R.length - 1].y, top = S.ytop - row.drop, rx = hw * 0.62, steps = 6;
    for (let k = 1; k <= steps; k++) {
      const a = (k / steps) * Math.PI / 2;
      R.push({ x: hw - rx + rx * Math.cos(a), y: lastY + Math.max(0.05, top - lastY) * Math.sin(a), c: roofC });
    }
    R[R.length - 1].x = 0;
    return R;
  }
  function fullRing(R, z, rake, ybRef) {
    const n = R.length - 1, ring = [];
    const mk = (p, s) => ({ x: s * p.x, y: p.y, z: z + rake * (p.y - ybRef), c: p.c });
    for (let j = 0; j <= n; j++) ring.push(mk(R[j], 1));
    for (let j = n - 1; j >= 1; j--) ring.push(mk(R[j], -1));
    return ring;
  }

  function carSpec(S, kindName) {
    const k = S.kinds[kindName];
    if (S.loco && kindName === 'loco') return { ...S, ...S.loco, loco: true, kind: k };
    if (k.pcar && S.pc) return { ...S, ...S.pc, kind: k };
    return { ...S, kind: k };
  }

  /* build a car; returns { group, api, doorsAnim, wheelsets, pantos, wipers, ... } */
  function buildCar(model, S0, def, idx, total, livery, mats, quality, isFront, isRear, numberText) {
    const hi = quality === 'high', mid = quality !== 'low';
    const S = carSpec(S0, def.kind);
    const K = S.kind, L = K.body, hw = S.W / 2;
    const C = recipeColors(S, livery);
    const hasWin = !(K.loco || K.pcar);
    const bands = buildBands(S, C, hasWin);
    const roofC = toRGB(C.roof);
    const group = new T.Group();
    group.name = 'car' + idx;
    const nose = S.nose;
    const noseF = !!K.front, noseR = !!K.rear;
    const zF = -L / 2, zR = L / 2;
    const winBandIdx = bands.findIndex((b) => b.win);
    const winSegR = winBandIdx >= 0 ? 2 + 2 * winBandIdx : -1;
    const winBand2 = S.double ? bands.findIndex((b, i) => b.win && i > winBandIdx) : -1;
    const winSegR2 = winBand2 >= 0 ? 2 + 2 * winBand2 : -1;
    const nR = 2 + 2 * bands.length + 5;
    let cabBands = null;
    if (S.cabWin && winBandIdx > 0) {
      cabBands = bands.map((b) => ({ ...b })); const wi = winBandIdx, cw = S.cabWin;
      cabBands[wi - 1].y1 = cw.y0; cabBands[wi].y0 = cw.y0; cabBands[wi].y1 = cw.y1; cabBands[wi + 1].y0 = cw.y1;
    }
    // ---- row z list
    const zsSet = new Set();
    const noseZs = (sign) => { for (let i = 0; i <= nose.N; i++) zsSet.add(+(sign * (L / 2 - nose.len * (1 - i / nose.N))).toFixed(4)); };
    // sign: -1 front (z from -L/2 upward), +1 rear
    const frontZs = [], rearZs = [];
    if (noseF) for (let i = 0; i <= nose.N; i++) frontZs.push(zF + nose.len * (i / nose.N)); else frontZs.push(zF, zF + 0.6);
    if (noseR) for (let i = 0; i <= nose.N; i++) rearZs.push(zR - nose.len * (i / nose.N)); else rearZs.push(zR, zR - 0.6);
    const wzA = hasWin ? (noseF ? zF + nose.len + 0.7 : zF + 0.9) : 0;
    const wzB = hasWin ? (noseR ? zR - nose.len - 0.7 : zR - 0.9) : 0;
    const bogieCut = [-K.bogie, K.bogie].map((z) => [z - 1.75, z + 1.75]);
    const zs = new Set([...frontZs, ...rearZs, zF + (noseF ? nose.len : 0.6) + 0.0, zR - (noseR ? nose.len : 0.6)]);
    if (hasWin) { zs.add(wzA); zs.add(wzB); }
    const inNoseZone = (z) => (noseF && z < zF + nose.len + 1e-6) || (noseR && z > zR - nose.len - 1e-6);
    for (const [a, b] of bogieCut) { if (!inNoseZone(a)) zs.add(a); if (!inNoseZone(b)) zs.add(b); }
    const zList = [...zs].filter((z) => z >= zF - 1e-6 && z <= zR + 1e-6).sort((a, b) => a - b).filter((z, i, arr) => i === 0 || z - arr[i - 1] > 0.01);
    const shapeAt = (z) => {
      if (noseF && z < zF + nose.len - 1e-6) return { ...noseShapeAt(nose, 1 - (z - zF) / nose.len), nz: true };
      if (noseR && z > zR - nose.len + 1e-6) { const s = { ...noseShapeAt(nose, 1 - (zR - z) / nose.len), nz: true }; s.rake = -s.rake; return s; }
      return { sx: 1, lift: 0, drop: 0, rake: 0 };
    };
    // a nose-coloured duplicate of each junction row gives a crisp paint break between nose and body
    const JD = 0.002;
    if (noseF) { const i = zList.findIndex((z) => Math.abs(z - (zF + nose.len)) < 0.011); if (i >= 0) zList.splice(i + 1, 0, zList[i] + JD); }
    if (noseR) { const i = zList.findIndex((z) => Math.abs(z - (zR - nose.len)) < 0.011); if (i >= 0) zList.splice(i, 0, zList[i] - JD); }
    const noseCArr = toRGB(C.nose);
    const rowsR = [], rows = [];
    zList.forEach((z) => {
      const sh = shapeAt(z);
      const nc = (noseF && z <= zF + nose.len + 1e-6) || (noseR && z >= zR - nose.len - 1e-6) ? noseCArr : null;
      const Rr = ringFor(S, sh.nz && cabBands ? cabBands : bands, roofC, sh, nc);
      rowsR.push(Rr); rows.push(fullRing(Rr, z, sh.rake, S.yb));
    });
    const strips = zList.length - 1;
    const stripMid = (k) => (zList[k] + zList[k + 1]) / 2;
    const inNose = (k, front) => front ? stripMid(k) < zF + nose.len : stripMid(k) > zR - nose.len;
    const noseStripFromTip = (k, front) => Math.floor((front ? stripMid(k) - zF : zR - stripMid(k)) / (nose.len / nose.N));
    const winOpen = (k) => {
      if (!hasWin && !(nose && nose.sideWin)) return false;
      const m = stripMid(k);
      if (hasWin && m > wzA && m < wzB) return true;
      if (nose.sideWin && S.recipe) {
        if (noseF && inNose(k, true)) { const q = noseStripFromTip(k, true); if (q >= nose.sideWin[0] && q <= nose.sideWin[1]) return true; }
        if (noseR && inNose(k, false)) { const q = noseStripFromTip(k, false); if (q >= nose.sideWin[0] && q <= nose.sideWin[1]) return true; }
      }
      return false;
    };
    const cutOpen = (k) => { const m = stripMid(k); return bogieCut.some(([a, b]) => m > a && m < b); };
    // segment index mapping: ring has 2*nR points: indices 0..nR (right) then nR+1..2nR-1 (left, mirror of nR-1..1)
    const segSkip = (k, i) => {
      const j = i < nR ? i : 2 * nR - i - 1;
      if (cutOpen(k) && !(noseF && inNose(k, true)) && !(noseR && inNose(k, false)) && (j === 1 || j === 2)) return true;
      const inN = (noseF && inNose(k, true)) || (noseR && inNose(k, false));
      if (winOpen(k) && (j === winSegR || (!inN && winSegR2 >= 0 && j === winSegR2))) return true;
      const rsFront = nose.roofScr && noseF && inNose(k, true), rsRear = nose.roofScr && noseR && inNose(k, false);
      if (rsFront || rsRear) {
        const q = noseStripFromTip(k, rsFront);
        if (q >= nose.roofScr.k0 && q <= nose.roofScr.k1 && j >= 1 + 2 * bands.length && j < nR) {
          const x0 = Math.abs(rowsR[k][j].x), x1 = Math.abs(rowsR[k][Math.min(j + 1, nR)].x);
          if (Math.max(x0, x1) <= hw * rowSx(k) * nose.roofScr.xlim) return true;
        }
      }
      return false;
    };
    function rowSx(k) { return shapeAt(zList[k]).sx; }
    const bodyGeo = loft(rows, segSkip);
    const bodyMesh = new T.Mesh(bodyGeo, mats.paint);
    bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
    group.add(bodyMesh);
    const paintMeshes = [bodyMesh];
    const innerMesh = new T.Mesh(bodyGeo, mats.inside); // interior lining (back faces)
    group.add(innerMesh);
    const fwdLinings = []; // lining ahead of the cab (hst): hidden in cab view so the track stays visible
    if (noseF && (S.cabFrame && S.cabFrame.dz)) {
      const kcut = zList.findIndex((z) => z >= zF + S.cabFrame.dz - 1e-6), st = bodyGeo.userData.starts, total = bodyGeo.index.count;
      if (kcut > 0 && st) {
        bodyGeo.clearGroups(); bodyGeo.addGroup(0, st[kcut], 0); bodyGeo.addGroup(st[kcut], total - st[kcut], 1);
        innerMesh.material = [mats.insideFwd, mats.inside]; fwdLinings.push(innerMesh);
      }
    }

    // ---- detail builder (everything else merged)
    const B = makeBuilder();
    const doorsOut = [];
    const wiperPivots = [];
    const lensRoles = [];
    const surfX = (z, y) => hw; // sides vertical at hw for straight part

    // window glass + frames on hollow strips
    const glassB = makeBuilder();
    const addBandQuad = (rowA, rowB, segIdx, ta, tb, off, kB, color, bld) => {
      // quad between ring points segIdx and segIdx+1 on rows A/B, from fraction ta..tb of the segment
      const P = (row, t) => { const p0 = row[segIdx], p1 = row[(segIdx + 1) % row.length]; return new T.Vector3(lerp(p0.x, p1.x, t), lerp(p0.y, p1.y, t), lerp(p0.z, p1.z, t)); };
      const a0 = P(rowA, ta), a1 = P(rowA, tb), b0 = P(rowB, ta), b1 = P(rowB, tb);
      const side = a0.x >= 0 ? 1 : -1;
      [a0, a1, b0, b1].forEach((v) => { v.x += side * off; });
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute([a0.x, a0.y, a0.z, a1.x, a1.y, a1.z, b0.x, b0.y, b0.z, b1.x, b1.y, b1.z], 3));
      g.setIndex([0, 1, 2, 1, 3, 2]);
      g.computeVertexNormals();
      bld.push(kB, g, color);
    };
    const hollowSegs = [];
    for (let i = 0; i < 2 * nR; i++) hollowSegs.push(i);
    for (let k = 0; k < strips; k++) {
      for (const i of hollowSegs) {
        if (!segSkip(k, i)) continue;
        const j = i < nR ? i : 2 * nR - i - 1;
        if (j === 1 || j === 2) continue; // bogie cut-out: no glass
        const isRoof = j >= 1 + 2 * bands.length;
        if (isRoof) {
          addBandQuad(rows[k], rows[k + 1], i, 0, 1, 0, 'glass', null, glassB);
          continue;
        }
        addBandQuad(rows[k], rows[k + 1], i, 0, 1, -0.03, 'glass', null, glassB);
        addBandQuad(rows[k], rows[k + 1], i, 0, 0.07, 0.006, 'trim', S.pillar, B);
        addBandQuad(rows[k], rows[k + 1], i, 0.93, 1, 0.006, 'trim', S.pillar, B);
      }
    }
    // pillars, door surrounds, doors
    const carDoors = [];
    const doorN = K.doors || 0;
    if (doorN > 0) {
      const za = (noseF ? zF + Math.max(nose.len, 2.7) + S.doorMargin * 0.55 : zF + S.doorMargin) + S.doorW / 2;
      const zb = (noseR ? zR - Math.max(nose.len, 2.7) - S.doorMargin * 0.55 : zR - S.doorMargin) - S.doorW / 2;
      for (let d = 0; d < doorN; d++) carDoors.push(doorN === 1 ? (za + zb) / 2 : za + (zb - za) * d / (doorN - 1));
    }
    if (hasWin) {
      const nb = Math.max(1, Math.round((wzB - wzA) / S.bay));
      for (let p = 0; p <= nb; p++) {
        const z = wzA + (wzB - wzA) * p / nb;
        if (carDoors.some((dz) => Math.abs(z - dz) < S.doorW / 2 + 0.2)) continue;
        for (const s of [-1, 1]) {
          B.box('trim', 0.05, S.head - S.sill, 0.1, s * (hw + 0.012), (S.sill + S.head) / 2, z, S.pillar);
          if (S.double) B.box('trim', 0.05, S.head2 - S.sill2, 0.1, s * (hw + 0.012), (S.sill2 + S.head2) / 2, z, S.pillar);
        }
      }
    }
    const doorTop = (S.double ? S.head : S.head) + 0.1;
    const leafCache = [];
    const doorAnim = [];
    const cabFloorY = S.cabFloor || S.floor;
    // ----- doors
    for (const dz of carDoors) {
      for (const s of [-1, 1]) {
        const side = s > 0 ? 'right' : 'left';
        const h0 = S.doorY0, h1 = doorTop, dh = h1 - h0, dw = S.doorW;
        // surround
        B.box('trim', 0.04, dh + 0.1, 0.08, s * (hw + 0.012), (h0 + h1) / 2, dz - dw / 2 - 0.02, '#1a1d20');
        B.box('trim', 0.04, dh + 0.1, 0.08, s * (hw + 0.012), (h0 + h1) / 2, dz + dw / 2 + 0.02, '#1a1d20');
        B.box('trim', 0.04, 0.08, dw + 0.16, s * (hw + 0.012), h1 + 0.04, dz, '#1a1d20');
        B.box('trim', 0.04, 0.06, dw + 0.16, s * (hw + 0.012), h0 - 0.03, dz, '#1a1d20');
        // doorway interior (lit), with handrails + step
        { const pg = new T.PlaneGeometry(dw, dh); pg.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2); pg.translate(s * (hw + 0.009), (h0 + h1) / 2, dz); B.geo('vest', pg, null); }
        B.box('trim', 0.14, 0.05, dw * 0.9, s * (hw + 0.07), h0 + 0.02, dz, '#5a5f64'); // sill / step nosing
        B.box('trim', 0.1, 0.06, dw * 0.9, s * (hw + 0.05), h0 + 0.2, dz, '#3a3e42'); // second step
        for (const e of [-1, 1]) B.cyl('m', 0.02, 0.02, dh - 0.12, s * (hw + 0.03), (h0 + h1) / 2, dz + e * (dw / 2 - 0.12), '#e3b92c', null, 6);
        B.box('trim', 0.2, 0.05, dw * 0.96, s * (hw - 0.08), h0 + 0.01, dz, '#4b4f53'); // step
        // open button + frame
        B.cyl('trim', 0.05, 0.05, 0.03, s * (hw + 0.025), 1.35, dz + dw / 2 + 0.2, '#15181a', 'x', 14);
        B.cyl('lit', 0.034, 0.034, 0.012, s * (hw + 0.04), 1.35, dz + dw / 2 + 0.2, '#47d36b', 'x', 12);
        // leaves
        const leafW = dw / 2 - 0.012;
        const lowerCol = C.doorLower, upCol = C.doorUpper;
        for (const e of [-1, 1]) {
          const lh = dh - 0.02, ly = 0;
          const split = clamp(S.sill - h0, 0.3, lh - 0.3);
          const g0 = rbox(leafW, split, 0.07, 0.02).rotateY(Math.PI / 2); g0.translate(0, -lh / 2 + split / 2, 0);
          const g1 = rbox(leafW, lh - split, 0.07, 0.02).rotateY(Math.PI / 2); g1.translate(0, -lh / 2 + split + (lh - split) / 2, 0);
          const pb = makeBuilder();
          pb.push('paint', g0, lowerCol); pb.push('paint', g1, upCol);
          // window
          const wy0 = -lh / 2 + split + 0.1, wy1 = lh / 2 - 0.14;
          pb.box('glass', 0.012, wy1 - wy0, leafW - 0.2, 0.036, (wy0 + wy1) / 2, 0, '#10171c');
          pb.box('trim', 0.014, 0.04, leafW - 0.16, 0.035, wy0 - 0.02, 0, '#15191c');
          pb.box('trim', 0.014, 0.04, leafW - 0.16, 0.035, wy1 + 0.02, 0, '#15191c');
          for (const q of [-1, 1]) pb.box('trim', 0.014, wy1 - wy0, 0.04, 0.035, (wy0 + wy1) / 2, q * (leafW / 2 - 0.1), '#15191c');
          pb.box('rubber', 0.05, lh, 0.025, 0.02, 0, -e * (leafW / 2) + e * 0.012, '#111');
          pb.box('rubber', 0.05, lh, 0.025, 0.02, 0, e * (leafW / 2) - e * 0.012, '#111');
          pb.cyl('m', 0.014, 0.014, 0.5, 0.05, split * 0.1 + 0.0, e * (leafW / 2 - 0.1), '#d7d9db', null, 6); // handle
          pb.box('trim', 0.01, 0.06, leafW - 0.1, 0.038, -lh / 2 + split * 0.75, 0, C.stripe);
          // glass sits inside dedicated mats key
          const mesh = pb.bake(mats);
          mesh.castShadow = false;
          mesh.userData.disposeGeo = true;
          const leaf = new T.Group(); leaf.add(mesh);
          mesh.rotation.y = s > 0 ? 0 : Math.PI;
          const yC = (h0 + h1) / 2;
          leaf.position.set(s * (hw + 0.03), yC, dz + e * (leafW / 2 + 0.006));
          group.add(leaf);
          doorAnim.push({ leaf, side, s, dz, e, travel: dw / 2 - 0.03, baseX: s * (hw + 0.03), baseZ: leaf.position.z });
        }
        doorsOut.push({ side, zLocal: dz, width: dw });
      }
    }

    // ----- logo decal + car number (canvas)
    if (mid) {
      const tex = decalTexture(numberText, C, S);
      const dm = new T.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
      dm.userData.perTrain = true;
      const decalW = Math.min(5.6, L * 0.3), decalH = decalW / 5.6 * 0.9;
      const yLow = S.yb + 0.12 + (S.sill - S.yb - 0.12) * 0.5;
      for (const s of [-1, 1]) {
        const free = hasWin ? carDoors : [];
        let zc = 0;
        const clash = (z) => carDoors.some((dz) => Math.abs(z - dz) < S.doorW / 2 + decalW / 2 + 0.2);
        const cand = [0, L * 0.18, -L * 0.18, L * 0.3, -L * 0.3, L * 0.08, -L * 0.08];
        zc = cand.find((z) => !clash(z) && Math.abs(z) < L / 2 - decalW / 2 - 0.3);
        if (zc === undefined) zc = 0;
        if (S.tram && !hasWin) continue;
        const m = new T.Mesh(new T.PlaneGeometry(decalW, decalH), dm);
        m.position.set(s * (hw + 0.012), yLow, zc);
        m.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
        m.userData.disposeGeo = true;
        group.add(m);
        group.userData.decalMat = dm;
      }
    }

    // ----- cap / nose faces, windscreens, lights, wipers, mirrors
    const bogieGroups = [];
    const noseApi = [];
    const ownMats = [];
    const nz = (S.cabFrame && S.cabFrame.dz) || 0;
    const apD = S.apron ? S.apron.depth : 0;
    const buildNose = (front) => {
      const sign = front ? -1 : 1;
      const zEnd = front ? zF : zR;
      const R = rowsR[front ? 0 : zList.length - 1];
      const sh = shapeAt(zEnd);
      const outline = [];
      const nPts = R.length - 1;
      const o = [];
      for (let j = 0; j <= nPts; j++) o.push(new T.Vector2(R[j].x, R[j].y));
      for (let j = nPts - 1; j >= 1; j--) o.push(new T.Vector2(-R[j].x, R[j].y));
      const shape = new T.Shape(o);
      const hasCap = true;
      const rake = (front ? 1 : -1) * (nose && (front ? noseF : noseR) ? nose.rake : 0);
      const isNose = front ? noseF : noseR;
      const capRake = isNose ? sh.rake : 0;
      const sc = S.scr;
      const hole = isNose && sc && sc.kind !== 'roof';
      const flipRear = !front;
      const place = (sapes, off, color, flip) => planeShape(sapes, zEnd, capRake, S.yb, off, color, flip);
      let capShape = shape;
      let glassPoly = null;
      if (hole) {
        const hp = roundedPoly(sc.hw + 0.02, sc.y0 - 0.02, sc.y1 + 0.02, 0.14, 0.1);
        const hole2 = new T.Path(hp.slice().reverse());
        capShape = new T.Shape(o); capShape.holes.push(hole2);
        glassPoly = roundedPoly(sc.hw - 0.03, sc.y0 + 0.03, sc.y1 - 0.03, 0.12, 0.1);
      }
      // cap mesh (outer + inner lining)
      const cg = planeShape(capShape, zEnd, capRake, S.yb, 0, null, front);
      // colour cap by nose colour
      const nc = toRGB(isNose ? C.nose : '#2a2d31'), carr = cg.attributes.color.array;
      for (let i = 0; i < cg.attributes.position.count; i++) { carr[i * 3] = nc[0]; carr[i * 3 + 1] = nc[1]; carr[i * 3 + 2] = nc[2]; }
      const capGeo = mergeInto([{ g: cg }]);
      const capMesh = new T.Mesh(capGeo, mats.paint); capMesh.castShadow = true;
      group.add(capMesh); paintMeshes.push(capMesh);
      if (isNose) { const ci = new T.Mesh(capGeo, front && nz ? mats.insideFwd : mats.inside); group.add(ci); if (front && nz) fwdLinings.push(ci); }
      if (!isNose) { // flat gangway end: darker door-ish frame
        return;
      }
      noseApi.push({ front, hole });
      // windscreen
      const side = front ? 1 : -1;
      const frontFrame = new T.Group();
      if (hole && glassPoly) {
        const outerP = roundedPoly(sc.hw + 0.02, sc.y0 - 0.02, sc.y1 + 0.02, 0.14, 0.1);
        const frame = new T.Shape(outerP); frame.holes.push(new T.Path(glassPoly.slice().reverse()));
        B.geo('rubber', planeShape(frame, zEnd - (front ? 0.008 : -0.008), capRake, S.yb, 0, '#101214', front), null);
        const glassShape = new T.Shape(glassPoly);
        glassB.geo('glass', planeShape(glassShape, zEnd + (front ? 0.03 : -0.03), capRake, S.yb, 0, null, front), null);
        if (sc.kind === 'twin') B.box('rubber', 0.1, sc.y1 - sc.y0 + 0.04, 0.05, sc.hw * 0.52, (sc.y0 + sc.y1) / 2, zEnd + sign * 0.0 + capRake * ((sc.y0 + sc.y1) / 2 - S.yb), sc.pillarCol || '#d9ccb0');
      }
      if (sc && sc.kind === 'roof') { // sloped glass shows its own frame via glass quads already; add thin rubber frame
      }
      // lights at the cap
      const lensY = S.yb + sh.lift + (apD ? 0.62 : 0.42), lensX = Math.max(0.18, hw * sh.sx * 0.6);
      const zAt = (y) => (apD ? zEnd + sign * apD : zEnd + capRake * (y - S.yb));
      const rb = (w, h, x, y, key, col, role) => {
        const g = rbox(w, h, 0.05, 0.03);
        if (!front) g.rotateY(Math.PI);
        g.translate(x, y, zAt(y) + sign * 0.012);
        (role ? B : B).geo(key, g, col);
      };
      for (const s of [-1, 1]) {
        const headKey = front ? 'headF' : 'lensOff', tailKey = front ? 'lensOff' : 'tailR';
        rb(0.34, 0.12, s * lensX, lensY + 0.12, 'trim', '#17191b');
        rb(0.28, 0.09, s * lensX, lensY + 0.12, headKey, '#fff6dc');
        rb(0.34, 0.11, s * lensX, lensY - 0.07, 'trim', '#17191b');
        rb(0.26, 0.07, s * lensX, lensY - 0.07, tailKey, front ? '#7a1c18' : '#ff3c28');
        if (hi) rb(0.12, 0.07, s * (lensX - 0.3), lensY + 0.04, headKey, '#fff6dc');
        if (mid) {
          const sp = new T.Sprite(front ? mats.glowHead : mats.glowTail); const gy = lensY + (front ? 0.12 : -0.07);
          sp.scale.set(front ? 0.8 : 0.5, front ? 0.8 : 0.5, 1); sp.position.set(s * lensX, gy, zAt(gy) + sign * 0.15); group.add(sp);
        }
      }
      if (mid) { // made-up badge + number plate on the nose
        const bt = badgeTexture(numberText);
        const bm = new T.MeshStandardMaterial({ map: bt, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        bm.userData.perTrain = true; ownMats.push(bm);
        const by = lensY + 0.02, bw = 0.5;
        const bmesh = new T.Mesh(new T.PlaneGeometry(bw, bw * 0.5), bm);
        bmesh.position.set(0, by, zAt(by) + sign * 0.016);
        bmesh.rotation.set(Math.atan(capRake), front ? Math.PI : 0, 0);
        bmesh.userData.disposeGeo = true; group.add(bmesh);
      }
      if (S.diesel) { // diesel look: radiator grille above the lights, DIESEL plate below it, builder plates on the flanks
        const gy = 1.64, gw = Math.min(1.2, hw * sh.sx * 1.1), gh = 0.34, gz = zAt(gy) + sign * 0.02;
        B.box('trim', gw + 0.1, gh + 0.1, 0.05, 0, gy, gz, '#17191b');
        B.box('trim', gw, gh, 0.02, 0, gy, gz + sign * 0.03, '#0d0e10');
        for (let q = 0; q < 6; q++) B.box('m', gw - 0.06, 0.028, 0.03, 0, gy - gh / 2 + 0.04 + (q * (gh - 0.08)) / 5, gz + sign * 0.045, '#c3c7ca');
        B.box('m', 0.03, gh, 0.03, 0, gy, gz + sign * 0.05, '#9ea3a7');
        if (mid) {
          const pm = new T.MeshStandardMaterial({ map: dieselPlateTexture(), roughness: 0.45, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
          pm.userData.perTrain = true; ownMats.push(pm);
          const noseTag = new T.Mesh(new T.PlaneGeometry(0.46, 0.46 / PLATE_ASPECT), pm);
          noseTag.position.set(0, 1.33, zAt(1.33) + sign * 0.018);
          noseTag.rotation.set(Math.atan(capRake), sign < 0 ? Math.PI : 0, 0);
          noseTag.userData.disposeGeo = true; group.add(noseTag);
          for (const sd of [-1, 1]) {
            const side = new T.Mesh(new T.PlaneGeometry(0.5, 0.5 / PLATE_ASPECT), pm);
            side.position.set(sd * (hw + 0.016), 1.12, zEnd - sign * 1.75);
            side.rotation.y = sd > 0 ? Math.PI / 2 : -Math.PI / 2;
            side.userData.disposeGeo = true; group.add(side);
          }
        }
      }
      // buffers + screw-coupling hook (buffer-fitted units only). Units without buffers (EMU, double-decker, tram,
      // high-speed) carry no separate coupler box: a floating pilot block under the nose looked detached.
      if (S.buffers) {
        for (const s of [-1, 1]) { B.cyl('m', 0.1, 0.12, 0.42, s * 0.86, S.yb + 0.3, zEnd + sign * (0.18 + apD), '#383b3e', 'z', 10); B.cyl('m', 0.16, 0.16, 0.05, s * 0.86, S.yb + 0.3, zEnd + sign * (0.41 + apD), '#bfc3c6', 'z', 14); }
        if (!apD) { // railcar: hook bolted flush to the nose face (mount plate buried in the cap), shank + hook head
          B.box('trim', 0.24, 0.14, 0.16, 0, S.yb + 0.14, zEnd + sign * 0.02, '#2c2f31');
          B.cyl('m', 0.04, 0.04, 0.3, 0, S.yb + 0.14, zEnd + sign * 0.2, '#2c2f31', 'z', 8);
          B.box('m', 0.09, 0.09, 0.06, 0, S.yb + 0.12, zEnd + sign * 0.36, '#2c2f31');
        }
        if (apD) { // loco: apron (front break), buffer beam, coupler hook, steps + handrails
          const ag = rbox(hw * 2 * sh.sx * 0.97, 1.0, apD * 2, 0.08); if (!front) ag.rotateY(Math.PI); ag.translate(0, S.yb + 0.45, zEnd);
          B.geo('paint', ag, C.nose);
          B.box('trim', hw * 2 * sh.sx * 0.99, 0.2, 0.06, 0, S.yb - 0.02, zEnd + sign * (apD + 0.03), '#202326');
          B.cyl('m', 0.06, 0.06, 0.45, 0, S.yb - 0.02, zEnd + sign * (apD + 0.3), '#2a2d30', 'z', 8);
          B.box('m', 0.08, 0.2, 0.1, 0, S.yb - 0.08, zEnd + sign * (apD + 0.52), '#2a2d30');
          for (const s of [-1, 1]) {
            B.cyl('m', 0.018, 0.018, 1.25, s * (hw * sh.sx * 0.99 - 0.02), S.yb + 0.85, zEnd + sign * (apD + 0.02), '#e3b92c', null, 6);
            B.box('trim', 0.3, 0.04, 0.22, s * (hw * sh.sx * 0.9), S.yb + 0.3, zEnd + sign * (apD + 0.12), '#43484c');
          }
        }
      }
      if (S.tram) { // front skirt (apron)
        const g = rbox(S.W * 0.62, 0.34, 0.12, 0.06); if (!front) g.rotateY(Math.PI); g.translate(0, S.yb - 0.02, zEnd + sign * 0.05);
        B.geo('paint', g, C.nose);
        B.box('trim', S.W * 0.56, 0.05, 0.14, 0, S.yb - 0.2, zEnd + sign * 0.07, '#232629');
      }
      // mirrors
      if (mid) {
        for (const s of [-1, 1]) {
          const mdist = nz + 0.9, mx = hw * (mdist < nose.len ? noseShapeAt(nose, 1 - mdist / nose.len).sx : 1) + 0.03, my = (sc ? sc.y0 : 2) + 0.55, mz = zEnd - sign * mdist;
          B.box('trim', 0.34, 0.03, 0.03, s * (mx + 0.14), my, mz, '#1b1d20');
          B.geo('trim', (() => { const g = rbox(0.1, 0.26, 0.06, 0.02); g.translate(s * (mx + 0.31), my, mz); return g; })(), '#17191b');
          B.box('metal', 0.012, 0.22, 0.05, s * (mx + 0.31), my, mz + sign * -0.0 + 0.0, '#9fb3bf');
        }
      }
      // wipers (animated)
      if (sc && sc.kind === 'roof' && nose.roofScr) {
        const kA = front ? nose.roofScr.k0 : zList.length - 1 - nose.roofScr.k0, kB = front ? nose.roofScr.k1 + 1 : zList.length - 1 - (nose.roofScr.k1 + 1);
        const P0 = rows[kA][nR], P1 = rows[kB][nR];
        const dy = P1.y - P0.y, dzz = P1.z - P0.z, len = Math.hypot(dy, dzz);
        const wg = new T.Group();
        wg.position.set(0, P0.y + 0.03 + (dy / len) * 0.35, P0.z + (dzz / len) * 0.35);
        wg.rotation.x = Math.atan(dzz / dy);
        if (!front) wg.rotation.y = Math.PI;
        const arm = memo('wiperArm', () => { const b = makeBuilder(); b.box('m', 0.62, 0.016, 0.01, 0.31, 0, 0, '#1b1d1f'); b.box('m', 0.54, 0.022, 0.012, 0.35, 0.02, 0.004, '#0f1011'); return mergeInto(b.raw); });
        for (const sg of [-1, 1]) {
          const p = new T.Group(); p.position.set(sg * 0.3, 0, 0);
          const m = new T.Mesh(arm, mats.metal); m.castShadow = false; p.add(m); if (sg > 0) m.scale.x = -1;
          wg.add(p); wiperPivots.push({ p, s: sg });
        }
        group.add(wg);
      }
      if (sc && sc.kind !== 'roof') {
        const wg = new T.Group();
        const yw = sc.y0 + 0.02;
        wg.position.set(0, yw, zEnd + capRake * (yw - S.yb) + sign * 0.03);
        wg.rotation.x = Math.atan(capRake);
        if (!front) wg.rotation.y = Math.PI;
        const arm = memo('wiperArm', () => { const b = makeBuilder(); b.box('m', 0.62, 0.016, 0.01, 0.31, 0, 0, '#1b1d1f'); b.box('m', 0.54, 0.022, 0.012, 0.35, 0.02, 0.004, '#0f1011'); return mergeInto(b.raw); });
        const pivots = [];
        for (const s of [-1, 1]) {
          const p = new T.Group(); p.position.set(s * sc.hw * 0.52, 0, 0);
          const m = new T.Mesh(arm, mats.metal); m.castShadow = false; p.add(m);
          if (s > 0) m.scale.x = -1;
          wg.add(p); pivots.push({ p, s });
        }
        group.add(wg); wiperPivots.push(...pivots);
      }
    };
    buildNose(true); buildNose(false);

    // sliding/pillar details at the saloon: end bulkhead cab wall
    const cabWall = (front) => {
      const sign = front ? -1 : 1, zEnd = front ? zF : zR, d = 2.75;
      const dd = d + nz, sxw = dd < nose.len ? noseShapeAt(nose, 1 - dd / nose.len).sx : 1;
      const g = new T.PlaneGeometry(S.W * 0.95 * sxw, S.head - cabFloorY + 0.3); g.translate(0, (S.head + 0.3 + cabFloorY) / 2, zEnd - sign * (d + nz));
      return g;
    };
    if (noseF) B.geo('floor', cabWall(true), '#b9b6ac');
    if (noseR) B.geo('floor', cabWall(false), '#b9b6ac');

    // ----- floors (cab + saloon), seats, lamps
    const wallA = noseF ? zF + 2.75 : zF + 0.3, wallB = noseR ? zR - 2.75 : zR - 0.3;
    const fl = (y, za, zb, w, col) => B.box('floor', w, 0.06, zb - za, 0, y, (za + zb) / 2, col);
    const cabFloorW = hw * 2 * noseShapeAt(nose, Math.max(0, 1 - (1.8 + nz) / nose.len)).sx * 0.9;
    const floorStart = nose.rake * (cabFloorY - S.yb) + 0.14, capW = hw * 2 * nose.capSx * 0.9;
    if (noseF) { if (!nz) fl(cabFloorY, zF + floorStart, zF + 1.2, capW, '#3a3d40'); fl(cabFloorY, zF + (nz || 1.2), zF + nz + 2.75, cabFloorW, '#3a3d40'); }
    if (noseR) { if (!nz) fl(cabFloorY, zR - 1.2, zR - floorStart, capW, '#3a3d40'); fl(cabFloorY, zR - nz - 2.75, zR - (nz || 1.2), cabFloorW, '#3a3d40'); }
    if (hasWin) {
      const fa = noseF ? zF + 2.75 : zF + 0.05, fb = noseR ? zR - 2.75 : zR - 0.05;
      if (fb > fa) fl(S.double ? S.floor - 0.05 : S.floor, fa, fb, hw * 2 - 0.1, '#a2a7ad');
    }
    // ----- saloon interior (seats, tables, luggage racks, poles, glass screens, lit ceiling)
    let seatInst = null;
    if (hasWin && mid) {
      const places = [], tables = [];
      const zStart = wzA + 0.45, zEnd = wzB - 0.45;
      const decks = S.double ? [S.floor - 0.05, 2.45] : [S.floor];
      const nearDoor = (z, m) => carDoors.some((dz) => Math.abs(z - dz) < S.doorW / 2 + m);
      const pitch = hi ? 0.9 : 1.8;
      const bayLayout = !!(S.tables && hi);
      for (const fy of decks) {
        if (S.tram) {
          for (let z = zStart; z < zEnd; z += 0.5) {
            if (nearDoor(z, 0.45)) continue;
            for (const sd of [-1, 1]) places.push([sd * (hw - 0.34), fy + 0.03, z, sd > 0 ? Math.PI / 2 : -Math.PI / 2]);
          }
          if (hi) for (const z of [zStart + 0.2, zEnd - 0.2]) for (const sd of [-1, 1]) { if (!nearDoor(z, 0.6)) places.push([sd * 0.45, fy + 0.03, z, 0]); }
        } else if (bayLayout) {
          for (let z = zStart; z < zEnd - 1.6; z += 2.5) {
            if (nearDoor(z, 0.5) || nearDoor(z + 1.5, 0.5)) continue;
            for (const x of [-1.0, -0.52, 0.52, 1.0]) if (Math.abs(x) < hw - 0.28) { places.push([x, fy + 0.03, z, Math.PI]); places.push([x, fy + 0.03, z + 1.5, 0]); }
            for (const sd of [-1, 1]) tables.push([sd * 0.76, fy + 0.73, z + 0.75]);
          }
        } else {
          for (let z = zStart; z < zEnd; z += pitch) {
            if (nearDoor(z, 0.35)) continue;
            const dirn = z < (wzA + wzB) / 2 ? 0 : Math.PI;
            for (const x of [-1.0, -0.52, 0.52, 1.0]) if (Math.abs(x) < hw - 0.28) places.push([x, fy + 0.03, z, dirn]);
          }
        }
      }
      if (S.double) fl(2.47, wallA, wallB, hw * 2 - 0.12, '#a9aeb2');
      seatInst = new T.InstancedMesh(seatGeo(), mats.seat, Math.max(1, places.length));
      const m4 = new T.Matrix4(), q = new T.Quaternion(), sc3 = new T.Vector3(1, 1, 1), colr = new T.Color(), up = new T.Vector3(0, 1, 0);
      const baseFab = (lum(livery.accent) < 0.6 && lum(livery.accent) > 0.04) ? livery.accent : SEAT_COL[model] || '#2d6aa6';
      const fabrics = [baseFab, new T.Color(baseFab).offsetHSL(0, -0.05, 0.08).getStyle(), new T.Color(baseFab).offsetHSL(0, 0, -0.07).getStyle()];
      places.forEach((p, i) => {
        q.setFromAxisAngle(up, p[3]);
        m4.compose(new T.Vector3(p[0], p[1], p[2]), q, sc3); seatInst.setMatrixAt(i, m4);
        colr.set(fabrics[(i + idx) % 7 === 0 ? 2 : (i % 3 === 0 ? 1 : 0)]); seatInst.setColorAt(i, colr);
      });
      seatInst.count = places.length; seatInst.castShadow = false; seatInst.frustumCulled = false;
      group.add(seatInst);
      for (const t of tables) { B.box('trim', 0.8, 0.035, 0.52, t[0], t[1], t[2], '#c9bda4'); B.box('metal', 0.05, 0.7, 0.05, t[0] + (t[0] > 0 ? 0.2 : -0.2), t[1] - 0.36, t[2], '#9aa0a5'); }
      // aisle runner + lighter floor
      for (const fy of decks) B.box('floor', 0.6, 0.062, Math.max(1, wzB - wzA), 0, fy + 0.002, (wzA + wzB) / 2, '#7d8da2');
      // luggage racks (single-level cars)
      if (!S.double) {
        const ry = S.floor + (S.tram ? 1.55 : 1.62), segs = [];
        let a0 = wzA + 0.1;
        for (const dz of [...carDoors].sort((p, q2) => p - q2)) { if (dz - S.doorW / 2 - 0.3 > a0) segs.push([a0, dz - S.doorW / 2 - 0.3]); a0 = dz + S.doorW / 2 + 0.3; }
        if (wzB - 0.1 > a0) segs.push([a0, wzB - 0.1]);
        for (const [za, zb] of segs) for (const sd of [-1, 1]) {
          B.box('metal', 0.03, 0.03, zb - za, sd * (hw - 0.1), ry, (za + zb) / 2, '#c9ccd0');
          B.box('trim', 0.34, 0.02, zb - za, sd * (hw - 0.3), ry - 0.12, (za + zb) / 2, '#59606a');
          B.box('trim', 0.34, 0.015, zb - za, sd * (hw - 0.3), ry - 0.045, (za + zb) / 2, '#b9c3cc');
          for (let z = za + 0.2; z < zb; z += 1.4) B.box('metal', 0.03, 0.1, 0.03, sd * (hw - 0.15), ry - 0.07, z, '#aab0b6');
        }
      }
      // vestibule: chrome poles + glass screens at each door
      for (const dz of carDoors) for (const e of [-1, 1]) {
        const zz = dz + e * (S.doorW / 2 + 0.18);
        for (const sd of [-1, 1]) {
          B.cyl('metal', 0.022, 0.022, S.head - S.floor + 0.05, sd * 0.62, (S.floor + S.head) / 2, zz, '#dfe2e5', null, 8);
          glassB.box('glass', hw - 0.55, 1.75, 0.02, sd * ((hw - 0.05 + 0.6) / 2), S.floor + 1.0, zz + e * 0.1);
          B.box('metal', hw - 0.55, 0.03, 0.03, sd * ((hw - 0.05 + 0.6) / 2), S.floor + 1.9, zz + e * 0.1, '#c8ccd0');
        }
      }
    }
    // ceiling light strips (lit)
    if (hasWin && mid) {
      const ly = S.double ? S.head - 0.04 : S.head - 0.02, len = Math.max(1, wzB - wzA), zc = (wzA + wzB) / 2;
      for (const x of [-0.75, 0.75]) B.box('lamp', 0.2, 0.03, len, x, ly, zc, '#ffffff');
      if (S.double) for (const x of [-0.75, 0.75]) B.box('lamp', 0.2, 0.03, len, x, 3.72, zc, '#ffffff');
    }

    // ----- roof equipment
    const yt = S.ytop;
    const roofBox = (w, h, d, x, y, z, col) => { const g = rbox(w, h, d, 0.06); g.rotateX(0); g.translate(x, y, z); B.geo('trim', g, col); };
    const panto = [];
    const smokeSpots = [];
    if (K.diesel || S.diesel) {
      for (const z of [-L * 0.28, L * 0.1]) { // exhaust stacks: flange, pipe, collar, angled rain cap, soot ring
        B.cyl('trim', 0.14, 0.14, 0.1, 0.0, yt + 0.05, z, '#3a3e42', null, 14);
        B.cyl('trim', 0.095, 0.095, 0.72, 0.0, yt + 0.42, z, '#25292c', null, 14);
        B.cyl('trim', 0.12, 0.12, 0.06, 0.0, yt + 0.55, z, '#5b6064', null, 14);
        B.cyl('trim', 0.12, 0.12, 0.05, 0.0, yt + 0.8, z, '#5b6064', null, 14);
        const cap = new T.CylinderGeometry(0.17, 0.17, 0.025, 14); cap.rotateX(-0.35); cap.translate(0, yt + 0.94, z - 0.03); B.geo('trim', cap, '#2f3336');
        const ring = new T.TorusGeometry(0.1, 0.012, 5, 14); ring.rotateX(Math.PI / 2); ring.translate(0, yt + 0.79, z); B.geo('trim', ring, '#0e0f10');
        smokeSpots.push({ x: 0, y: yt + 0.85, z });
      }
      roofBox(1.5, 0.4, 2.4, 0, yt + 0.08, L * 0.3, '#8d9396'); // radiator / cooling pack
      for (const sd of [-1, 1]) for (let q = 0; q < 6; q++) B.box('trim', 0.03, 0.024, 2.1, sd * 0.76, yt + 0.0 + q * 0.055, L * 0.3, '#2d3134');
      B.cyl('trim', 0.55, 0.55, 0.05, 0, yt + 0.3, L * 0.3, '#1b1e20', null, 20);
      B.box('trim', 1.0, 0.03, 0.06, 0, yt + 0.34, L * 0.3, '#6f757a'); B.box('trim', 0.06, 0.03, 1.0, 0, yt + 0.34, L * 0.3, '#6f757a');
    } else if (!K.pcar && !K.loco) {
      const nAC = S.tram ? 2 : 2;
      for (let a = 0; a < nAC; a++) {
        const z = (a - (nAC - 1) / 2) * (L * 0.34) + (K.panto ? -1.2 : 0) + (K.front ? 1.0 : 0) - (K.rear ? 1.0 : 0);
        if (K.panto && a === 0) continue;
        roofBox(S.tram ? 1.3 : 1.7, 0.34, S.tram ? 2.2 : 2.6, 0, yt + 0.04, z, '#c3c8cb');
        B.box('trim', S.tram ? 0.9 : 1.3, 0.02, 0.5, 0, yt + 0.23, z + 0.5, '#2e3337');
        B.box('trim', S.tram ? 0.9 : 1.3, 0.02, 0.5, 0, yt + 0.23, z - 0.5, '#2e3337');
      }
    }
    if (K.loco) {
      for (const z of [-7.0, -1.6, 1.6, 7.0]) { roofBox(1.5, 0.42, 1.9, 0, yt - 0.02, z, '#aab0b4'); B.box('trim', 1.1, 0.02, 0.5, 0, yt + 0.2, z, '#2c3135'); }
      for (const z of [-5.2, 5.2]) roofBox(0.5, 0.25, 0.9, 0.0, yt + 0.0, z, '#8f959a');
    } else if (K.pcar) {
      roofBox(1.4, 0.4, 3.2, 0, yt - 0.02, -0.5, '#bfc4c7');
    }
    if (K.panto) {
      for (const pz of K.panto) {
        B.cyl('trim', 0.12, 0.12, 0.32, 0.0, yt + 0.1, pz + (K.loco ? 0 : 1.5), '#cfc7b4', null, 10);
        if (!K.loco) roofBox(0.6, 0.45, 1.1, 0, yt + 0.03, pz + 2.5 * Math.sign(pz) * (K.pcar ? 1 : 1), '#9aa0a4');
        const pg = buildPanto(S, mats, quality);
        pg.group.position.set(0, yt, pz);
        group.add(pg.group); panto.push(pg);
      }
    }
    // roof antennas & vents
    if (mid) { B.box('trim', 0.04, 0.1, 0.45, 0.5, yt + 0.02, -L * 0.12 - 0.5, '#1b1e20'); B.box('trim', 0.04, 0.1, 0.45, -0.5, yt + 0.02, L * 0.36, '#1b1e20'); }
    // cab side doors (loco / power car): outline + small window
    if ((K.loco || K.pcar) && (noseF || noseR)) {
      const zc = noseF ? zF + nz + (K.loco ? nose.len + 1.0 : 1.3) : zR - nz - (K.loco ? nose.len + 1.0 : 1.3);
      const dY0 = cabFloorY - 0.55, dY1 = cabFloorY + 1.85, dW = 0.9;
      for (const sd of [-1, 1]) {
        const x = sd * (hw + 0.012);
        B.box('trim', 0.03, dY1 - dY0, 0.04, x, (dY0 + dY1) / 2, zc - dW / 2, '#14171a'); B.box('trim', 0.03, dY1 - dY0, 0.04, x, (dY0 + dY1) / 2, zc + dW / 2, '#14171a');
        B.box('trim', 0.03, 0.04, dW, x, dY1, zc, '#14171a'); B.box('trim', 0.03, 0.04, dW, x, dY0, zc, '#14171a');
        glassB.box('glass', 0.02, 0.62, dW - 0.2, x + sd * 0.004, cabFloorY + 1.3, zc, '#0c1318');
        B.box('trim', 0.035, 0.03, 0.2, x + sd * 0.01, cabFloorY + 0.7, zc + dW * 0.3, '#c9ccd0');
      }
    }
    // loco sides: grilles + stripes
    if (K.loco || K.pcar) {
      const gx = K.loco ? 6.0 : 6.2;
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
        const z = (k - 1) * 3.4 + (K.pcar ? 0 : 0);
        B.box('trim', 0.03, 0.9, 2.2, s * (hw + 0.012), (S.sill + S.head) / 2 - 0.05, z, '#20252a');
        for (let q = 0; q < 7; q++) B.box('trim', 0.035, 0.03, 2.0, s * (hw + 0.018), S.sill + 0.12 + q * 0.12, z, '#3d444b');
      }
    }

    // ----- underframe
    const uf = (w, h, d, x, y, z, col) => { const g = rbox(w, h, d, 0.04); g.translate(x, y, z); B.geo('trim', g, col); };
    if (mid) {
      const bz = K.bogie;
      for (const [x, z, w, d, h] of [[-0.55, 0, 0.9, 3.2, 0.34], [0.6, -1.0, 0.8, 2.4, 0.3], [-0.5, 2.5, 0.6, 1.6, 0.26], [0.5, 3.0, 0.8, 1.2, 0.3]]) {
        const zz = z * (L / 25) * (Math.abs(bz) > 0 ? 1 : 1);
        if (Math.abs(zz) > bz - 1.9 && !K.loco && !K.pcar) continue;
        uf(w, h, d, x, S.yb - h / 2 + 0.03, zz, '#43484c');
      }
      if (!S.tram) B.box('trim', 0.3, 0.1, L * 0.8, 0, S.yb - 0.02, 0, '#1f2224');
    }

    // ----- gangway bellows
    const bellowsHeight = S.tram ? S.ytop - 0.55 - S.yb : S.head + 0.2 - S.floor;
    const bell = (zend, dir) => {
      const w = S.bellowsFull ? S.W * 0.9 : hw * 1.35, h = bellowsHeight, y0 = S.bellowsFull ? S.yb + 0.15 : S.floor - 0.12;
      const len = S.gap / 2 + 0.03;
      const g = bellowsGeo(w, h, y0, len).clone();
      if (dir < 0) { g.scale(1, 1, -1); const idx = g.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.computeVertexNormals(); }
      g.translate(0, 0, zend);
      B.geo('rubber', g, null);
    };
    if (S.bellows) {
      if (!noseF && (idx > 0 || true)) bell(zF - 0.01, -1);
      if (!noseR) bell(zR + 0.01, 1);
    }
    // buffers at flat ends
    if (S.buffers) {
      for (const z of [zF, zR]) {
        if ((z === zF && noseF) || (z === zR && noseR)) continue;
        const sg = z === zF ? -1 : 1;
        for (const s of [-1, 1]) { B.cyl('m', 0.1, 0.12, 0.38, s * 0.86, S.yb + 0.3, z + sg * 0.19, '#383b3e', 'z', 10); B.cyl('m', 0.16, 0.16, 0.05, s * 0.86, S.yb + 0.3, z + sg * 0.4, '#bfc3c6', 'z', 14); }
      }
    }

    // ----- bogies
    const wsList = [];
    const R = S.wheelR, wb = S.wb;
    const motor = !!(K.loco || K.pcar || def.kind.startsWith('cab') || def.kind === 'rc');
    for (const sgn of [-1, 1]) {
      const bg = new T.Group(); bg.position.set(0, 0, sgn * K.bogie); bg.name = 'bogie';
      if (K.shared && sgn > 0 && idx < total - 2) { group.add(bg); bogieGroups.push(bg); continue; } // articulated: one bogie between two trailers
      const frame = new T.Mesh(bogieFrameGeo(S, R, wb, motor), mats.metal); frame.castShadow = true; bg.add(frame);
      for (const z of [-wb / 2, wb / 2]) {
        const w = new T.Mesh(wheelsetGeo(R, motor && z < 0), mats.metal); w.position.set(0, R, z); w.castShadow = true;
        bg.add(w); wsList.push({ mesh: w, R });
      }
      group.add(bg); bogieGroups.push(bg);
    }

    const detail = B.bake(mats);
    if (detail) { detail.userData.disposeGeo = true; group.add(detail); }
    const glassMesh = glassB.bake(mats, { noShadow: true });
    if (glassMesh) { glassMesh.userData.disposeGeo = true; glassMesh.renderOrder = 2; group.add(glassMesh); }

    // ----- diesel exhaust smoke (medium/high only; hidden until setExhaust > 0)
    let exhaust = null;
    if (smokeSpots.length && mid) { exhaust = buildExhaust(smokeSpots, hi ? 14 : 8); group.add(exhaust); }

    // ----- lights
    return {
      exhaust, ownMats, paintMeshes, fwdLinings, group, length: L + S.gap, body: L, bogieOffset: K.bogie, doors: doorsOut, bogies: bogieGroups, doorAnim, wheelsets: wsList, pantos: panto, wipers: wiperPivots,
      noseFront: noseF, noseRear: noseR, S,
    };
  }

  /* ---------------------------------------------------------------- decals */
  const decalCache = new Map();
  function decalTexture(numberText, C, S) {
    const key = numberText + C.lower + C.mid;
    if (decalCache.has(key)) return decalCache.get(key);
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 164;
    const x = cv.getContext('2d');
    const bg = lum(C.lower) > 0.45 ? '#16202b' : '#f4f1ea';
    x.clearRect(0, 0, 1024, 164);
    x.fillStyle = bg; x.textBaseline = 'middle';
    x.font = 'italic 800 78px Helvetica, Arial, sans-serif'; x.fillText('LUX RAIL', 40, 62);
    x.fillRect(40, 108, 260, 6); x.fillRect(318, 108, 70, 6);
    x.font = '700 40px Helvetica, Arial, sans-serif'; x.fillText(numberText, 560, 52);
    x.font = '600 26px Helvetica, Arial, sans-serif'; x.fillText('www.luxrail.example', 560, 108);
    const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    tex.userData = { shared: true };
    decalCache.set(key, tex);
    return tex;
  }

  const badgeCache = new Map();
  function badgeTexture(num) {
    if (badgeCache.has(num)) return badgeCache.get(num);
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const x = cv.getContext('2d');
    x.fillStyle = '#f4f2ea'; x.beginPath(); x.roundRect ? x.roundRect(4, 4, 248, 120, 14) : x.rect(4, 4, 248, 120); x.fill();
    x.fillStyle = '#16202b'; x.textBaseline = 'middle'; x.textAlign = 'center';
    x.font = 'italic 800 52px Helvetica, Arial, sans-serif'; x.fillText('LUX RAIL', 128, 42);
    x.font = '700 38px Helvetica, Arial, sans-serif'; x.fillText(num.replace('No ', ''), 128, 92);
    const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; badgeCache.set(num, t); return t;
  }

  const PLATE_ASPECT = 4;
  let dieselPlateTex = null;
  function dieselPlateTexture() { // enamel "DIESEL" plate (shared canvas texture)
    if (dieselPlateTex) return dieselPlateTex;
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const x = cv.getContext('2d');
    x.fillStyle = '#16191b'; x.fillRect(0, 0, 256, 64);
    x.strokeStyle = '#d8d3c0'; x.lineWidth = 3; x.strokeRect(4, 4, 248, 56);
    x.fillStyle = '#f1ecd8'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '800 40px Helvetica, Arial, sans-serif'; x.fillText('DIESEL', 128, 34);
    dieselPlateTex = new T.CanvasTexture(cv); dieselPlateTex.colorSpace = T.SRGBColorSpace; dieselPlateTex.anisotropy = 4;
    return dieselPlateTex;
  }

  /* Exhaust smoke: one Points object per car, animated entirely in the vertex shader (no per-frame JS but a uniform). */
  function buildExhaust(stacks, perStack) {
    const n = stacks.length * perStack, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    stacks.forEach((st, k) => { for (let i = 0; i < perStack; i++) { const o = (k * perStack + i); pos.set([st.x, st.y, st.z], o * 3); seed[o] = (i + (k * 0.37)) / perStack; } });
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('aSeed', new T.BufferAttribute(seed, 1));
    const mat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uPx: { value: 360 } },
      vertexShader: 'uniform float uTime,uLevel,uPx;attribute float aSeed;varying float vA;void main(){float ph=fract(uTime*0.6+aSeed);vec3 p=position;p.y+=ph*(0.9+0.7*uLevel);p.z+=ph*ph*(0.6+2.4*uLevel);p.x+=sin(aSeed*40.0+ph*3.0)*0.1*ph;vA=(1.0-ph)*smoothstep(0.0,0.1,ph)*uLevel*0.6;vec4 mv=modelViewMatrix*vec4(p,1.0);gl_PointSize=(0.22+ph*0.95)*uPx*projectionMatrix[1][1]/max(0.1,-mv.z);gl_Position=projectionMatrix*mv;}',
      fragmentShader: 'varying float vA;void main(){float d=length(gl_PointCoord-0.5);float a=smoothstep(0.5,0.08,d)*vA;if(a<0.004)discard;gl_FragColor=vec4(vec3(0.34,0.35,0.37),a);}',
    });
    const pts = new T.Points(geo, mat);
    pts.frustumCulled = false; pts.visible = false; pts.renderOrder = 3; pts.name = 'exhaust';
    const sz = new T.Vector2();
    pts.onBeforeRender = (renderer) => { renderer.getDrawingBufferSize(sz); mat.uniforms.uTime.value = performance.now() / 1000; mat.uniforms.uPx.value = sz.y * 0.5; };
    pts.userData.disposeGeo = true;
    return pts;
  }

  /* ---------------------------------------------------------------- pantograph */
  function buildPanto(S, mats, quality) {
    const tram = !!S.tram;
    const a = tram ? 1.35 : 1.15, baseH = 0.32;
    const g = new T.Group();
    const base = memo('pantoBase' + tram, () => {
      const b = makeBuilder();
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl('m', 0.07, 0.09, 0.28, sx * 0.55, 0.14, sz * 0.8, '#cfc9b6', null, 8);
      b.box('m', 1.3, 0.06, 0.12, 0, 0.3, -0.8, '#303336'); b.box('m', 1.3, 0.06, 0.12, 0, 0.3, 0.8, '#303336');
      b.box('m', 0.12, 0.06, 1.7, -0.55, 0.3, 0, '#303336'); b.box('m', 0.12, 0.06, 1.7, 0.55, 0.3, 0, '#303336');
      b.cyl('m', 0.05, 0.05, 1.2, 0, 0.36, 0, '#202225', 'x', 8);
      return mergeInto(b.raw);
    });
    const baseMesh = new T.Mesh(base, mats.metal); baseMesh.castShadow = true; g.add(baseMesh);
    const arm = memo('pantoArm' + a, () => {
      const b = makeBuilder();
      b.box('m', 0.07, a, 0.07, 0, a / 2, 0, '#c9ccd0');
      b.box('m', 0.05, a * 0.9, 0.05, 0.12, a * 0.45, 0.02, '#8f9398');
      b.cyl('m', 0.04, 0.04, 0.3, 0, 0, 0, '#202225', 'x', 8);
      return mergeInto(b.raw);
    });
    const head = memo('pantoHead' + tram, () => {
      const b = makeBuilder();
      const hwid = tram ? 1.6 : 1.95;
      b.box('m', hwid, 0.04, 0.1, 0, 0.0, 0, '#404448');
      b.box('m', hwid - 0.1, 0.035, 0.06, 0, 0.035, 0, '#17181a');
      for (const s of [-1, 1]) { b.box('m', 0.28, 0.03, 0.08, s * (hwid / 2 + 0.1), 0.07, 0, '#9ea3a8'); }
      b.box('m', 0.04, 0.12, 0.5, 0, 0.0, -0.1, '#a6aab0');
      return mergeInto(b.raw);
    });
    const lower = new T.Group(); lower.position.set(0, baseH, 0);
    lower.add(new T.Mesh(arm, mats.metal));
    const upper = new T.Group(); upper.position.set(0, a, 0);
    upper.add(new T.Mesh(arm, mats.metal));
    const headMesh = new T.Mesh(head, mats.metal); headMesh.position.set(0, a, 0);
    upper.add(headMesh); lower.add(upper); g.add(lower);
    const hWork = PANTO_WIRE_Y - (S.ytop + baseH) - 0.055; // 0.055 = carbon strip top above the head bar
    const hFold = 0.18;
    const api = {
      group: g,
      set(up01) {
        const h = lerp(hFold, hWork, clamp(up01, 0, 1)), c = clamp(h / (2 * a), 0, 0.999), th = Math.acos(c);
        lower.rotation.x = th; upper.rotation.x = -2 * th;
        headMesh.rotation.x = th; // keep the head level (upper arm is rotated by -th relative to world)
        g.visible = true;
      },
    };
    api.set(1);
    return api;
  }

  /* ---------------------------------------------------------------- public create */
  function numberFor(model, i) {
    const base = { railcar: 2201, emu: 2310, tram: 108, kiss: 2410, ic: 5601, hst: 4701 }[model] || 1000;
    return model === 'tram' ? 'TW ' + (base + i) : 'No ' + (base + i * 3);
  }

  function create(cfg, opts) {
    opts = opts || {};
    const quality = opts.quality || 'high';
    const model = (cfg && (cfg.model || cfg.id)) || 'emu';
    const S0 = SPECS[model];
    if (!S0) { warn('unknown model ' + model); return create({ ...cfg, model: 'emu' }, opts); }
    const livery = { body: '#e7e8ea', accent: '#c8312b', stripe: '#1b3a6b', ...(cfg && cfg.livery), ...(opts.livery || {}) };
    const mats = trainMats();
    const count = (cfg && cfg.cars) || { railcar: 1, emu: 2, tram: 5, kiss: 4, ic: 7, hst: 8 }[model];
    const comp = composition(model, count);
    const group = new T.Group(); group.name = 'train:' + model;
    const cars = [], built = [];
    comp.forEach((def, i) => {
      const c = buildCar(model, S0, def, i, comp.length, livery, mats, quality, i === 0, i === comp.length - 1, numberFor(model, i));
      group.add(c.group);
      built.push(c);
      cars.push({ group: c.group, length: c.length, bogieOffset: c.bogieOffset, doors: c.doors, bogies: c.bogies, nose: { front: c.noseFront, rear: c.noseRear } });
    });
    // lights: shared per-train materials
    const state = { open: { left: 0, right: 0 } };
    const pantoAll = built.flatMap((b) => b.pantos);
    const wipers = built.flatMap((b) => b.wipers);
    const wheelsets = built.flatMap((b) => b.wheelsets);
    const totalLength = cars.reduce((a, c) => a + c.length, 0);

    const api = {
      group, cars, totalLength, wheelRadius: S0.wheelR,
      setDoors(open01, side) {
        const o = clamp(open01 || 0, 0, 1);
        const sides = side === 'left' || side === 'right' ? [side] : ['left', 'right'];
        for (const sd of sides) state.open[sd] = o;
        for (const b of built) for (const d of b.doorAnim) {
          if (!sides.includes(d.side)) continue;
          const plug = smooth(o * 4), slide = smooth((o - 0.2) / 0.8);
          d.leaf.position.x = d.baseX + d.s * 0.07 * plug;
          d.leaf.position.z = d.baseZ + d.e * d.travel * slide;
        }
      },
      setLights(l) {
        l = l || {};
        mats.headF.emissiveIntensity = l.head ? 3.2 : 0;
        mats.tailR.emissiveIntensity = l.tail ? 2.6 : 0;
        const cab = !!l.cabin;
        mats.lamp.color.setHex(cab ? 0xffffff : 0xdad6c6);
        mats.glass.opacity = cab ? 0.26 : 0.34;
        mats.inside.emissive.setHex(cab ? INSIDE_EMIT_ON : INSIDE_EMIT); mats.insideFwd.emissive.setHex(cab ? INSIDE_EMIT_ON : INSIDE_EMIT);
        mats.seat.emissive.setHex(cab ? SEAT_EMIT_ON : SEAT_EMIT);
        mats.glowHead.opacity = l.head ? 0.7 : 0; mats.glowTail.opacity = l.tail ? 0.6 : 0;
      },
      setCabView(on) { // cab camera: hide the outside skin of the front car's nose (keeps lining + shadows) so the track stays visible
        for (const m of built[0].paintMeshes) m.material = on ? mats.ghost : mats.paint;
        for (const m of built[0].fwdLinings) { if (Array.isArray(m.material)) m.material[0] = on ? mats.ghost : mats.insideFwd; else m.material = on ? mats.ghost : mats.insideFwd; }
      },
      setPantograph(up01) { for (const p of pantoAll) p.set(up01); },
      /* Diesel exhaust smoke strength 0..1 (0 = off/hidden). No-op on electric models. */
      setExhaust(level01) {
        const v = clamp(Number(level01) || 0, 0, 1);
        for (const b of built) if (b.exhaust) { b.exhaust.material.uniforms.uLevel.value = v; b.exhaust.visible = v > 0.01; }
      },
      hasExhaust: built.some((b) => !!b.exhaust),
      setWheelSpin(radians) { for (const w of wheelsets) w.mesh.rotation.x = -radians * REF_WHEEL_R / w.R; },
      setWheelDistance(m) { for (const w of wheelsets) w.mesh.rotation.x = -m / w.R; },
      setWipers(t) {
        const v = clamp(t, 0, 1), ang = smooth(v) * 1.35;
        for (const w of wipers) w.p.rotation.z = w.s > 0 ? -ang : ang;
      },
      dispose() {
        group.traverse((o) => {
          if ((o.isMesh || o.isPoints) && o.userData.disposeGeo && o.geometry) o.geometry.dispose();
          if (o.isPoints && o.material) o.material.dispose();
          if (o.isInstancedMesh) o.dispose();
        });
        for (const m of mats.own) m.dispose();
        for (const b of built) { const dm = b.group.userData.decalMat; if (dm) dm.dispose(); for (const m of b.ownMats) m.dispose(); }
        if (group.parent) group.parent.remove(group);
      },
    };
    api.setLights({ head: false, tail: false, cabin: false });
    api.setPantograph(1); api.setDoors(0); api.setWipers(0);
    return api;
  }

  function frontCarLength(cfg) {
    const model = (cfg && (cfg.model || cfg.id)) || 'emu';
    const S = SPECS[model]; if (!S) return 25;
    const kinds = S.kinds; const first = Object.values(kinds).find((k) => k.front);
    const dz = (S.cabFrame && S.cabFrame.dz) || 0;
    return (first ? first.body : 25) - 2 * dz;
  }

  window.TS.trains = { create, specs: SPECS, frontCarLength, PANTO_WIRE_Y };
})();
