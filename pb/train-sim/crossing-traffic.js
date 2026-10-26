/* Lokféierer: road traffic at level crossings (TS.crossingTraffic).
 * Cars, vans, a lorry now and then, a tractor and a cyclist drive along the roads planned by crossing-roads.js: from one end of the road, through the
 * junction, over the crossing, to the other end.  While the barriers are closed they queue in front of the stop line (right-hand traffic, one lane
 * each way) and drive on when the barriers open.  A vehicle that is already past the stop line when the lights start keeps going and clears the
 * crossing; nothing ever stands on the rails.  The vehicle bodies are the ones of the Luxtram traffic (TS.luxTraffic.buildVehicleGeometry), the tractor
 * and the bicycle are made here.  Vehicles are only simulated near the player's train; each type is one InstancedMesh (a draw call per type on screen).
 *   const traffic = TS.crossingTraffic.create({ root, plan, quality, getNight });
 *   traffic.setClosed(crossingS, closed);  traffic.update(dt, trainS, camera);  traffic.dispose();  traffic.state() (test hook) */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const T = THREE;
  const TAG = '[Lokféierer] crossing traffic: ';

  const LANE_OFFSET = 1.45;            // lane centre from the road centre line
  const BIKE_OFFSET = 2.15;
  const NARROW_OFFSET = 0.75;           // lane centre on a 3 m wide gravel lane
  const STOP_LINE_FROM_RAIL = 8.2;     // metres beyond the outer rail where the stop line lies
  const ZONE_END_FROM_RAIL = 8.2;      // the crossing zone ends this far beyond the other outer rail
  const PATH_STEP = 2.0;
  const MAX_ACCEL = 2.2;
  const COMFORT_DECEL = 3.2;
  const MIN_GAP = 2.2;                 // m between a stopped vehicle and the next
  const ACTIVE_RANGE = 760;            // crossings this close to the train (along the track) are alive
  const SPAWN_MIN_S = 5;
  const SPAWN_VAR_S = 11;
  const START_CARS_MAX = 3;
  const CAP_PER_TYPE = { high: 16, medium: 12, low: 6 };
  const WEIGHTS = [['hatch', 20], ['sedan', 13], ['estate', 14], ['suv', 14], ['van', 11], ['truck', 3], ['tractor', 5], ['bike', 6]];
  const SPEED = { hatch: [9, 13.5], sedan: [9, 13.5], estate: [9, 13.5], suv: [9, 13.5], van: [8, 12], truck: [7, 10], tractor: [5, 7.5], bike: [3.8, 5.2] };
  const BODY_COLOURS = [[0.9, 0.9, 0.9], [0.06, 0.06, 0.07], [0.62, 0.64, 0.66], [0.33, 0.35, 0.38], [0.12, 0.22, 0.46], [0.55, 0.08, 0.08], [0.42, 0.36, 0.28], [0.1, 0.3, 0.18]];
  const TRACTOR_COLOURS = [[0.12, 0.45, 0.16], [0.7, 0.1, 0.08], [0.1, 0.25, 0.6], [0.9, 0.55, 0.05]];
  const JACKET_COLOURS = [[0.85, 0.2, 0.1], [0.1, 0.35, 0.7], [0.95, 0.8, 0.1], [0.2, 0.6, 0.3]];
  const DIM = { tractor: { L: 4.6, W: 2.3 }, bike: { L: 1.8, W: 0.6 } };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------------------------------------------------------- the two vehicles that the Luxtram traffic does not have */
  function partBuilder() {
    const p = []; const n = []; const c = []; const m = []; const idx = [];
    const api = {
      p, n, c, m, idx,
      add(geo, matrix, col, paint) {
        const g = geo.index ? geo.toNonIndexed() : geo;
        g.applyMatrix4(matrix);
        g.computeVertexNormals();
        const pos = g.attributes.position; const nor = g.attributes.normal;
        const base = p.length / 3;
        for (let i = 0; i < pos.count; i++) {
          p.push(pos.getX(i), pos.getY(i), pos.getZ(i)); n.push(nor.getX(i), nor.getY(i), nor.getZ(i));
          c.push(col[0], col[1], col[2]); m.push(paint ? 1 : 0, 0);
          idx.push(base + i);
        }
        g.dispose();
      },
      box(cx, cy, cz, sx, sy, sz, col, paint) { this.add(new T.BoxGeometry(sx, sy, sz), new T.Matrix4().makeTranslation(cx, cy, cz), col, paint); },
      wheel(cx, cy, cz, r, w, col) { const mx = new T.Matrix4().makeRotationZ(Math.PI / 2).setPosition(cx, cy, cz); this.add(new T.CylinderGeometry(r, r, w, 14), mx, col, false); },
      tube(a, b, thick, col, paint) {
        const dir = new T.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const len = dir.length();
        const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
        const mx = new T.Matrix4().compose(new T.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new T.Vector3(1, 1, 1));
        this.add(new T.BoxGeometry(thick, len, thick), mx, col, paint);
      },
      sphere(cx, cy, cz, r, col, paint) { this.add(new T.IcosahedronGeometry(r, 1), new T.Matrix4().makeTranslation(cx, cy, cz), col, paint); },
      geometry() {
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(n, 3));
        g.setAttribute('color', new T.Float32BufferAttribute(c, 3)); g.setAttribute('aMark', new T.Float32BufferAttribute(m, 2));
        g.setIndex(idx.length > 65535 ? new T.Uint32BufferAttribute(idx, 1) : new T.Uint16BufferAttribute(idx, 1));
        g.computeBoundingSphere();
        return g;
      },
    };
    return api;
  }
  /* local frame as in luxtram-traffic.js: forward = -Z, right = +X, y = 0 on the road */
  function tractorGeometry() {
    const b = partBuilder();
    const dark = [0.06, 0.06, 0.07]; const glass = [0.16, 0.21, 0.26]; const grey = [0.3, 0.3, 0.32];
    b.wheel(-1.05, 0.88, 0.95, 0.88, 0.5, dark); b.wheel(1.05, 0.88, 0.95, 0.88, 0.5, dark);       // big rear wheels
    b.wheel(-0.85, 0.5, -1.45, 0.5, 0.3, dark); b.wheel(0.85, 0.5, -1.45, 0.5, 0.3, dark);          // small front wheels
    b.box(0, 0.95, -0.6, 0.85, 0.35, 3.0, grey, false);                                              // chassis
    b.box(0, 1.35, -1.15, 1.0, 0.85, 1.9, [1, 1, 1], true);                                          // bonnet
    b.box(0, 1.05, -2.1, 1.05, 0.5, 0.15, grey, false);                                              // grille
    b.box(0, 2.05, 0.65, 1.5, 1.7, 1.45, glass, false);                                              // cab glass
    b.box(0, 2.95, 0.65, 1.65, 0.12, 1.6, [1, 1, 1], true);                                          // cab roof
    [[-0.72, -0.72], [0.72, -0.72], [-0.72, 1.97], [0.72, 1.97]].forEach(([x, z]) => b.box(x, 2.05, z, 0.08, 1.7, 0.08, [1, 1, 1], true));
    b.box(0.5, 2.15, -1.75, 0.09, 1.0, 0.09, grey, false);                                           // exhaust
    b.box(-1.1, 1.62, 0.95, 0.55, 0.14, 1.3, [1, 1, 1], true); b.box(1.1, 1.62, 0.95, 0.55, 0.14, 1.3, [1, 1, 1], true);   // mudguards
    return b.geometry();
  }
  function bikeGeometry() {
    const b = partBuilder();
    const dark = [0.08, 0.08, 0.09]; const frame = [0.55, 0.57, 0.6]; const skin = [0.82, 0.62, 0.5]; const trousers = [0.12, 0.14, 0.2];
    b.wheel(0, 0.34, -0.55, 0.34, 0.04, dark); b.wheel(0, 0.34, 0.55, 0.34, 0.04, dark);
    b.tube([0, 0.34, 0.55], [0, 0.62, 0.1], 0.035, frame, false); b.tube([0, 0.62, 0.1], [0, 0.58, -0.4], 0.035, frame, false);
    b.tube([0, 0.34, -0.55], [0, 0.58, -0.4], 0.035, frame, false); b.tube([0, 0.58, -0.4], [0, 0.95, -0.38], 0.03, frame, false);
    b.box(0, 0.98, -0.4, 0.5, 0.03, 0.03, dark, false);                                              // handlebar
    b.box(0, 0.72, 0.1, 0.1, 0.05, 0.22, dark, false);                                               // saddle
    b.box(0, 1.2, 0.0, 0.3, 0.52, 0.2, [1, 1, 1], true);                                             // torso (jacket)
    b.box(0, 1.1, -0.18, 0.36, 0.16, 0.1, [1, 1, 1], true);                                          // shoulders / arms towards the bars
    b.tube([-0.12, 0.7, 0.1], [-0.12, 0.5, -0.2], 0.1, trousers, false); b.tube([0.12, 0.7, 0.1], [0.12, 0.38, 0.05], 0.1, trousers, false);   // legs
    b.sphere(0, 1.62, -0.06, 0.12, skin, false);
    b.box(0, 1.72, -0.06, 0.26, 0.08, 0.26, [0.15, 0.15, 0.17], false);                              // helmet
    return b.geometry();
  }

  /* ---------------------------------------------------------------- driving paths */
  /* smooth a polyline with two Chaikin passes, then resample every PATH_STEP metres */
  function chaikin(pts) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]; const b = pts[i + 1];
      out.push({ x: lerp(a.x, b.x, 0.25), z: lerp(a.z, b.z, 0.25), y: lerp(a.y, b.y, 0.25) }, { x: lerp(a.x, b.x, 0.75), z: lerp(a.z, b.z, 0.75), y: lerp(a.y, b.y, 0.75) });
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function resample(pts, step) {
    const out = [{ x: pts[0].x, y: pts[0].y, z: pts[0].z }];
    let carry = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]; const b = pts[i + 1]; const len = Math.hypot(b.x - a.x, b.z - a.z);
      let d = step - carry;
      while (d <= len) { const t = d / len; out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) }); d += step; }
      carry = len - (d - step);
    }
    const last = pts[pts.length - 1];
    const e = out[out.length - 1];
    if (Math.hypot(last.x - e.x, last.z - e.z) > 0.3) out.push({ x: last.x, y: last.y, z: last.z });
    return out;
  }
  /* shift a centre line to the right-hand lane (offset metres to the right of the direction of travel) and attach heading + arc length */
  function laneOf(centre, offset) {
    const smoothC = resample(chaikin(chaikin(centre)), PATH_STEP);
    const out = smoothC.map((p, i) => {
      const a = smoothC[Math.max(0, i - 1)]; const b = smoothC[Math.min(smoothC.length - 1, i + 1)];
      let hx = b.x - a.x; let hz = b.z - a.z; const l = Math.hypot(hx, hz) || 1; hx /= l; hz /= l;
      return { x: p.x - hz * offset, y: p.y, z: p.z + hx * offset, hx, hz, u: 0 };
    });
    for (let i = 1; i < out.length; i++) out[i].u = out[i - 1].u + Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z);
    return out;
  }

  /* ---------------------------------------------------------------- the module */
  function create(opts) {
    const luxTraffic = TS.luxTraffic;
    if (!luxTraffic || !luxTraffic.buildVehicleGeometry || !opts || !opts.plan || !opts.root) return null;
    const plan = opts.plan;
    const root = opts.root;
    const cap = CAP_PER_TYPE[opts.quality] || CAP_PER_TYPE.medium;
    const getNight = opts.getNight || (() => 0);
    const rng = mulberry(20261025);
    const nightU = { value: 0 };
    const material = luxTraffic.makeMaterial(nightU);
    const types = {};
    const typeNames = ['hatch', 'sedan', 'estate', 'suv', 'van', 'truck', 'tractor', 'bike'];
    const group = new T.Group();
    group.name = 'crossing-traffic';
    root.add(group);
    typeNames.forEach((name) => {
      const geo = name === 'tractor' ? tractorGeometry() : name === 'bike' ? bikeGeometry() : luxTraffic.buildVehicleGeometry(name);
      const body = new T.InstancedBufferAttribute(new Float32Array(cap * 3), 3); body.setUsage(T.DynamicDrawUsage); geo.setAttribute('iBody', body);
      const sus = new T.InstancedBufferAttribute(new Float32Array(cap * 4), 4); geo.setAttribute('iSus', sus);
      const dim = new T.InstancedBufferAttribute(new Float32Array(cap * 2).fill(1), 2); geo.setAttribute('iDim', dim);
      const mesh = new T.InstancedMesh(geo, material, cap);
      mesh.frustumCulled = false; mesh.count = 0; mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = false;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.name = 'crossing-traffic-' + name;
      group.add(mesh);
      const spec = luxTraffic.SPEC && luxTraffic.SPEC[name];
      types[name] = { name, geo, body, mesh, n: 0, L: spec ? spec.L : DIM[name].L, W: spec ? spec.W : DIM[name].W };
    });

    /* ---- paths of one crossing: [{ pts, stopU, zoneEnd, cars: [], timer }] */
    const sites = plan.crossings.map((c) => buildSite(c));
    function buildSite(c) {
      const lanes = [];
      const sideArms = [];     // per side: list of centre lines from a far end towards the crossing, as { pts: [{x,y,z}], offset }
      c.info.sides.forEach((sideInfo) => {
        const sd = sideInfo.sd;
        const suffix = sd > 0 ? 'r' : 'l';
        const arms = [];
        const centre = (road, reverse) => (reverse ? road.pts.slice().reverse() : road.pts).map((p) => ({ x: p.x, y: p.yT + plan.ROAD_LIFT, z: p.z }));
        if (sideInfo.type === 'patch') {
          const arm = c.arms && c.arms[sd];
          if (arm && arm.length > 2) arms.push(arm.map((p) => ({ x: p.x, y: p.y, z: p.z })));
        } else if (sideInfo.type === 'T') {
          const cross = c.roads.find((r) => r.id === 'x' + c.index + suffix);
          const par = c.roads.find((r) => r.id === 'p' + c.index + suffix);
          const mouth = par ? par.pts.find((p) => Math.abs(p.a) < 1.6) || par.pts[0] : null;
          if (cross && par && mouth) {
            const crossRev = centre(cross, true);               // junction edge → crossing
            const jct = { x: mouth.x, y: mouth.yT + plan.ROAD_LIFT, z: mouth.z };
            const fromMinus = par.pts.filter((p) => p.a <= -1.6);              // ascending a: far end → junction
            const fromPlus = par.pts.filter((p) => p.a >= 1.6).reverse();      // descending a: far end → junction
            [fromMinus, fromPlus].forEach((seg) => {
              if (seg.length < 3) return;
              const pts = seg.map((p) => ({ x: p.x, y: p.yT + plan.ROAD_LIFT, z: p.z }));
              const arm = pts.concat([jct], crossRev);
              arm.narrow = !!sideInfo.lane;      // a gravel lane is 3 m wide: vehicles keep nearer its middle
              arms.push(arm);
            });
          }
        } else if (sideInfo.type === 'real') {
          const road = c.roads.find((r) => r.id === 'x' + c.index + suffix);
          const tail = c.roads.find((r) => r.id === 'x' + c.index + suffix + 'g');
          if (road) {
            const arm = (tail ? centre(tail, true) : []).concat(centre(road, true));
            arm.narrow = road.kind === 'gravel';
            arms.push(arm);
          }
        } else if (sideInfo.type === 'bend') {
          const road = c.roads.find((r) => r.id === 'b' + c.index);
          const tail = c.roads.find((r) => r.id === 'b' + c.index + 'g');
          if (road) arms.push((tail ? centre(tail, true) : []).concat(centre(road, true)));
        } else {
          const road = c.roads.find((r) => r.id === 'f' + c.index);
          const tail = c.roads.find((r) => r.id === 'f' + c.index + 'g');
          if (road) arms.push((tail ? centre(tail, true) : []).concat(centre(road, true)));
        }
        sideArms.push(arms);
      });
      /* the straight over the crossing, in the base track frame: lat from lHi to lLo for traffic from the + side, the other way for the - side */
      const f0 = plan.frameOf(c.s);
      const profY = (l) => {
        const F = -0.55 + 0.05; const lo = c.lLo; const hi = c.lHi;
        const xs = [lo, lo + 1, c.X2 !== undefined ? Math.min(0, c.X2) - 4.6 : -4.6, Math.max(0, c.X2) + 4.6, hi - 1, hi];
        const ys = [F, F, -0.05, -0.05, F, F];
        const lc = clamp(l, lo, hi);
        for (let i = 0; i < xs.length - 1; i++) if (lc >= xs[i] && lc <= xs[i + 1]) return lerp(ys[i], ys[i + 1], (lc - xs[i]) / ((xs[i + 1] - xs[i]) || 1));
        return F;
      };
      const crossLine = (fromSide) => {
        const out = [];
        const l0 = fromSide > 0 ? c.lHi : c.lLo; const l1 = fromSide > 0 ? c.lLo : c.lHi;
        const n = Math.max(2, Math.ceil(Math.abs(l1 - l0) / 1.5));
        for (let i = 0; i <= n; i++) {
          const l = lerp(l0, l1, i / n);
          out.push({ x: f0.x + f0.rx * l, y: f0.y + profY(l) + 0.0, z: f0.z + f0.rz * l });
        }
        return out;
      };
      const stopMag = (side) => (side > 0 ? Math.max(0, c.X2) + STOP_LINE_FROM_RAIL : Math.abs(Math.min(0, c.X2)) + STOP_LINE_FROM_RAIL);
      const zoneMag = (side) => (side > 0 ? Math.abs(Math.min(0, c.X2)) + ZONE_END_FROM_RAIL : Math.max(0, c.X2) + ZONE_END_FROM_RAIL);
      /* for traffic from side `from` (+1 = the + side): arms of `from` towards the crossing, the straight, arms of the other side away from it */
      [1, -1].forEach((from) => {
        const iFrom = c.info.sides.findIndex((s) => s.sd === from);
        const iTo = c.info.sides.findIndex((s) => s.sd === -from);
        if (iFrom < 0 || iTo < 0) return;
        sideArms[iFrom].forEach((armIn) => {
          sideArms[iTo].forEach((armOut) => {
            const straight = crossLine(from);
            const outPts = armOut.slice().reverse();                 // crossing → far end
            const centreLine = armIn.concat(straight.slice(1), outPts.slice(1));
            const narrow = armIn.narrow || armOut.narrow;
            const lane = laneOf(centreLine, narrow ? NARROW_OFFSET : LANE_OFFSET);
            const bikeLane = laneOf(centreLine, BIKE_OFFSET);
            /* the stop line and the end of the crossing zone, as arc lengths: the nearest path points to the lat positions on the straight */
            const atLat = (lat, startIdx) => {
              let best = Infinity; let bu = 0;
              for (let i = startIdx; i < lane.length; i++) {
                const p = lane[i];
                const l = (p.x - f0.x) * f0.rx + (p.z - f0.z) * f0.rz;
                const a = (p.x - f0.x) * f0.tx + (p.z - f0.z) * f0.tz;
                const d = Math.abs(l - lat) + Math.abs(a) * 3;
                if (d < best) { best = d; bu = p.u; }
              }
              return bu;
            };
            const stopU = atLat(from * stopMag(from), 0);
            const zoneEnd = atLat(-from * zoneMag(from), 0);
            lanes.push({ pts: lane, bikePts: bikeLane, stopU, zoneEnd, len: lane[lane.length - 1].u, cars: [], timer: 2 + rng() * 6, from });
          });
        });
      });
      return { c, s: c.s, lanes, closed: false, active: false };
    }

    const scratchM = new T.Matrix4(); const scratchQ = new T.Quaternion(); const scratchE = new T.Euler(0, 0, 0, 'YXZ');
    const scratchP = new T.Vector3(); const scratchS = new T.Vector3(1, 1, 1);
    let simTime = 0;

    function pickType() {
      let tot = 0; WEIGHTS.forEach((w) => { tot += w[1]; });
      let r = rng() * tot;
      for (const w of WEIGHTS) { r -= w[1]; if (r <= 0) return w[0]; }
      return 'hatch';
    }
    function makeCar(lane, u) {
      const type = pickType();
      const range = SPEED[type];
      const body = type === 'tractor' ? TRACTOR_COLOURS[Math.floor(rng() * TRACTOR_COLOURS.length)] : type === 'bike' ? JACKET_COLOURS[Math.floor(rng() * JACKET_COLOURS.length)]
        : type === 'van' || type === 'truck' ? [0.92, 0.92, 0.92] : BODY_COLOURS[Math.floor(rng() * BODY_COLOURS.length)];
      return { type, u, v: 0, vMax: lerp(range[0], range[1], rng()), L: types[type].L, body, lane, y: 0 };
    }
    function carFits(lane, u, L) {
      return lane.cars.every((o) => Math.abs(o.u - u) > (o.L + L) / 2 + 4);
    }
    function activate(site) {
      site.active = true;
      site.lanes.forEach((lane) => {
        lane.cars.length = 0;
        const n = Math.floor(rng() * (START_CARS_MAX + 1));
        for (let k = 0; k < n; k++) {
          const car = makeCar(lane, 20 + rng() * Math.max(10, lane.len * 0.7));
          car.v = car.vMax * 0.8;
          if (carFits(lane, car.u, car.L) && !(car.u + car.L / 2 > lane.stopU - 1 && car.u - car.L / 2 < lane.zoneEnd + 1)) lane.cars.push(car);
        }
        lane.cars.sort((a, b) => b.u - a.u);
      });
    }
    function deactivate(site) { site.active = false; site.lanes.forEach((lane) => { lane.cars.length = 0; }); }

    function stepLane(site, lane, dt) {
      const cars = lane.cars;
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        const half = car.L / 2;
        let target = car.vMax;
        /* curves: slow down where the path turns */
        const ahead = lane.pts[Math.min(lane.pts.length - 1, Math.floor((car.u + 14) / PATH_STEP))];
        const here = lane.pts[Math.min(lane.pts.length - 1, Math.floor(car.u / PATH_STEP))];
        if (here && ahead) { const dot = here.hx * ahead.hx + here.hz * ahead.hz; target = Math.min(target, lerp(3.2, car.vMax, clamp((dot - 0.5) / 0.5, 0, 1))); }
        /* the stop line while the barriers are closed (a vehicle that cannot stop any more drives on and clears the crossing) */
        const front = car.u + half;
        if (site.closed && front < lane.stopU - 0.3) {
          const d = lane.stopU - 0.6 - front;
          const brake = (car.v * car.v) / (2 * COMFORT_DECEL * 1.6);
          if (d > brake - 1.5 || d > 12) target = Math.min(target, Math.sqrt(Math.max(0, 2 * COMFORT_DECEL * (d - 0.2))));
        }
        /* the vehicle in front */
        const lead = i > 0 ? cars[i - 1] : null;
        if (lead) {
          const gap = lead.u - lead.L / 2 - front - MIN_GAP;
          target = Math.min(target, Math.sqrt(Math.max(0, 2 * COMFORT_DECEL * Math.max(0, gap))) + lead.v * 0.15, gap < 0.2 ? 0 : 99);
        }
        const dv = target - car.v;
        car.v = clamp(car.v + clamp(dv, -COMFORT_DECEL * 2.2 * dt, MAX_ACCEL * dt), 0, 40);
        if (car.v < 0.02 && target < 0.05) car.v = 0;
        car.u += car.v * dt;
      }
      /* despawn at the end */
      for (let i = cars.length - 1; i >= 0; i--) if (cars[i].u - cars[i].L / 2 > lane.len - 4) cars.splice(i, 1);
    }

    function pose(lane, car, out) {
      const pts = car.type === 'bike' ? lane.bikePts : lane.pts;
      const k = clamp(car.u / PATH_STEP, 0, pts.length - 1.001);
      const i = Math.floor(k); const t = k - i;
      const a = pts[i]; const b = pts[i + 1];
      out.x = lerp(a.x, b.x, t); out.y = lerp(a.y, b.y, t); out.z = lerp(a.z, b.z, t);
      let hx = lerp(a.hx, b.hx, t); let hz = lerp(a.hz, b.hz, t); const l = Math.hypot(hx, hz) || 1; hx /= l; hz /= l;
      out.hx = hx; out.hz = hz;
      const j = Math.min(pts.length - 1, i + 2);
      out.pitch = Math.atan2(pts[j].y - pts[i].y, Math.max(0.5, (j - i) * PATH_STEP));
    }

    const pz = { x: 0, y: 0, z: 0, hx: 0, hz: 1, pitch: 0 };
    function render(camera) {
      typeNames.forEach((n) => { types[n].n = 0; });
      for (const site of sites) {
        if (!site.active) continue;
        for (const lane of site.lanes) {
          for (const car of lane.cars) {
            const tp = types[car.type];
            if (tp.n >= cap) continue;
            pose(lane, car, pz);
            if (camera && Math.hypot(pz.x - camera.position.x, pz.z - camera.position.z) > 900) continue;
            scratchE.set(pz.pitch, Math.atan2(-pz.hx, -pz.hz), 0, 'YXZ');
            scratchQ.setFromEuler(scratchE);
            scratchP.set(pz.x, pz.y, pz.z);
            scratchM.compose(scratchP, scratchQ, scratchS);
            tp.mesh.setMatrixAt(tp.n, scratchM);
            tp.body.setXYZ(tp.n, car.body[0], car.body[1], car.body[2]);
            tp.n += 1;
          }
        }
      }
      typeNames.forEach((n) => {
        const tp = types[n];
        tp.mesh.count = tp.n; tp.mesh.visible = tp.n > 0;
        if (tp.n) { tp.mesh.instanceMatrix.needsUpdate = true; tp.body.needsUpdate = true; }
      });
    }

    function update(dt, trainS, camera) {
      const step = clamp(dt, 0, 0.1);
      simTime += step;
      nightU.value = getNight();
      for (const site of sites) {
        const near = Math.abs(site.s - trainS) < ACTIVE_RANGE;
        if (near && !site.active) activate(site);
        else if (!near && site.active && Math.abs(site.s - trainS) > ACTIVE_RANGE + 200) deactivate(site);
        if (!site.active) continue;
        for (const lane of site.lanes) {
          lane.timer -= step;
          if (lane.timer <= 0) {
            lane.timer = SPAWN_MIN_S + rng() * SPAWN_VAR_S;
            const last = lane.cars[lane.cars.length - 1];
            if (!last || last.u - last.L / 2 > 12) {
              const car = makeCar(lane, 0);
              car.v = Math.min(car.vMax, 8);
              if (carFits(lane, car.u, car.L)) lane.cars.push(car);
            }
          }
          stepLane(site, lane, step);
        }
      }
      render(camera);
    }
    function setClosed(crossingS, closed) {
      const site = sites.reduce((best, s) => (!best || Math.abs(s.s - crossingS) < Math.abs(best.s - crossingS) ? s : best), null);
      if (site && Math.abs(site.s - crossingS) < 5) site.closed = !!closed;
    }
    function dispose() {
      root.remove(group);
      typeNames.forEach((n) => { types[n].geo.dispose(); types[n].mesh.dispose(); });
      material.dispose();
    }
    function state() {
      return sites.map((s) => ({ s: Math.round(s.s), active: s.active, closed: s.closed, lanes: s.lanes.map((l) => ({ len: Math.round(l.len), stopU: Math.round(l.stopU), zoneEnd: Math.round(l.zoneEnd), cars: l.cars.map((c) => ({ type: c.type, u: Math.round(c.u * 10) / 10, v: Math.round(c.v * 10) / 10 })) })) }));
    }
    return { update, setClosed, dispose, state, sites };
  }

  TS.crossingTraffic = Object.freeze({ create, TAG });
})();
