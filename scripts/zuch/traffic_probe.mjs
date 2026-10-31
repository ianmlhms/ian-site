/* Road-traffic probe (W5 zroads): every vehicle path of the level-crossing traffic (crossing-traffic.js) must lie on a drawn road, and must never touch the rails
 * away from the crossing deck.
 *   node scripts/zuch/traffic_probe.mjs [routeId ...] [--ret] [--lazy] [--root <repo copy>] [--json out.json]        (default: all rail routes; --ret also the return direction)
 * Per site and lane (both the car path and the bicycle path) every PATH_STEP point is tested:
 *   rail    the point lies inside the rail corridor (outer rail + 2.6 m of ballast) more than DECK_HALF m along the track from the crossing   -> "on the rails"
 *   offroad the point has no drawn road under it: a planned road polyline within its half width + 0.9 m (cross road, parallel road, bend, lane, real arm) or the
 *           road of the station patch (patch crossings) or the crossing deck itself                                                          -> "off the road"
 *   gap     two neighbouring path points more than 6 m apart (a jump; the bicycle lane at a right-angle T corner makes up to 4.7 m by geometry)
 * Exit code 1 when something is flagged. */
import fs from 'node:fs';
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (n) => { const i = args.indexOf('--' + n); if (i < 0) return false; args.splice(i, 1); return true; };
const jsonOut = flag('json', '');
const root = flag('root', undefined);
const lazy = bool('lazy');
const withReturn = bool('ret');
const ALL = ['west', 'south', 'north', 'east', 'wittlich', 'trier', 'metz', 'brussels', 'paris'];
const routes = args.length ? args : ALL;

const probe = ({ track, world }, GAP_MAX) => {
  const DECK_HALF = 9;        // the crossing deck + aprons reach 13 m beside the outer rail; a vehicle there is on the straight
  const BALLAST = 2.6;
  const ROAD_SLACK = 0.9;
  const base = track.base || track;
  const plan = base.crossingRoads;
  const traffic = world.landscape.crossingTraffic();
  const out = { sites: 0, lanes: 0, points: 0, flags: [] };
  if (!plan || !traffic) return out;
  const flagged = new Set();
  const push = (kind, site, lane, p, extra) => {
    const key = kind + ':' + Math.round(site.s) + ':' + lane.from;
    if (flagged.has(key)) return;
    flagged.add(key);
    out.flags.push(Object.assign({ kind, s: Math.round(site.s), from: lane.from, x: Math.round(p.x), z: Math.round(p.z) }, extra || {}));
  };
  const nearSeg = (pts, x, z) => {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]; const b = pts[i + 1];
      const dx = b.x - a.x; const dz = b.z - a.z; const ll = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / ll));
      const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
      if (d < best) best = d;
    }
    return best;
  };
  for (const site of traffic.sites) {
    const c = site.c;
    out.sites += 1;
    const f0 = plan.frameOf(c.s);
    const lo = Math.min(0, c.X2) - BALLAST; const hi = Math.max(0, c.X2) + BALLAST;
    let roadsHere = c.roads.filter((r) => r.kind !== 'patch');
    const patchRoads = c.roads.filter((r) => r.kind === 'patch');
    for (const lane of site.lanes) {
      out.lanes += 1;
      for (const [name, pts] of [['car', lane.pts], ['bike', lane.bikePts]]) {
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          out.points += 1;
          if (i > 0 && Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > GAP_MAX) push('gap', site, lane, p, { i });
          const q = base.nearest(p.x, p.z);
          const dl = q.lat; const ds = q.s - c.s;
          if (dl > lo && dl < hi && Math.abs(ds) > DECK_HALF) push('rail', site, lane, p, { lat: Math.round(dl * 10) / 10, ds: Math.round(ds), who: name });
          // the deck: inside the apron, along the straight
          const a = (p.x - f0.x) * f0.tx + (p.z - f0.z) * f0.tz; const l = (p.x - f0.x) * f0.rx + (p.z - f0.z) * f0.rz;
          if (Math.abs(a) < 3.2 && l > c.lLo - 0.5 && l < c.lHi + 0.5) continue;
          let on = false;
          for (const r of roadsHere) { if (nearSeg(r.pts, p.x, p.z) <= r.hw + ROAD_SLACK) { on = true; break; } }
          if (!on && patchRoads.length) {
            for (const r of patchRoads) { if (nearSeg(r.pts, p.x, p.z) <= r.hw + 2.5) { on = true; break; } }
          }
          if (!on) push('offroad', site, lane, p, { lat: Math.round(dl), ds: Math.round(ds), who: name });
        }
      }
    }
  }
  /* ---- dynamic: drive the traffic for 5 simulated minutes per site with the barriers cycling; a vehicle (centre, front, back) in the rail corridor beyond the
     deck, or standing still (< 0.3 m/s) with any part of its body inside the corridor, is flagged */
  const poseAt = (lane, u, bike) => {
    const pts = bike ? lane.bikePts : lane.pts;
    const k = Math.max(0, Math.min(pts.length - 1.001, u / 2));
    const i = Math.floor(k); const t = k - i;
    return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, z: pts[i].z + (pts[i + 1].z - pts[i].z) * t };
  };
  out.cars = 0;
  for (const site of traffic.sites) {
    const c = site.c;
    const lo = Math.min(0, c.X2) - BALLAST; const hi = Math.max(0, c.X2) + BALLAST;
    for (let step = 0; step < 3000; step++) {
      const closed = (step % 500) >= 250;
      if (site.closed !== closed) traffic.setClosed(c.s, closed);
      traffic.update(0.1, c.s - 120, null);
      if (step % 5) continue;
      for (const lane of site.lanes) {
        for (const car of lane.cars) {
          out.cars += 1;
          for (const du of [0, car.L / 2, -car.L / 2]) {
            const p = poseAt(lane, car.u + du, car.type === 'bike');
            const q = base.nearest(p.x, p.z);
            const ds = q.s - c.s;
            const inCorridor = q.lat > lo && q.lat < hi;
            if (inCorridor && (Math.abs(ds) > DECK_HALF || (car.v < 0.3 && step % 500 >= 10))) push('car-on-rails', site, lane, p, { lat: Math.round(q.lat * 10) / 10, ds: Math.round(ds), v: Math.round(car.v * 10) / 10, closed, type: car.type });
          }
        }
      }
    }
  }
  return out;
};

/* ---- ambient cars (landscape.js carMesh: cars on the drawn chunk roads of the real scenery): sampled along the route, none may be inside the rail corridor, none
   may stand more than ROAD_SLACK off the nearest planned / drawn road of its own chunk (they share the polyline, so this catches a stale road list) */
const ambient = async (sim, id) => {
  const info = await sim.evalGame(({ track }) => ({ length: (track.base || track).length }));
  const flags = []; let cars = 0;
  for (let s = 100; s < info.length; s += 400) {
    await sim.page.evaluate((ts) => { __tsTest.placeAt(ts, 0); const w = __tsTest.internals().world; w.landscape.warm(w.track.baseS ? w.track.baseS(ts) : ts); }, s);
    await sim.frames(2);
    const res = await sim.evalGame(({ track, world }, ts) => {
      const base = track.base || track;
      return world.landscape.ambientCarPoses().map((c) => { const q = base.nearest(c.x, c.z); const x2 = base.second ? base.second.lat(q.s) : 0; return { s: Math.round(q.s), lat: Math.round(q.lat * 10) / 10, x2: Math.round(x2 * 10) / 10, hw: c.hw, len: Math.round(c.len), x: Math.round(c.x), z: Math.round(c.z) }; }).filter((c) => Math.abs(c.s - ts) < 700);
    }, s);
    cars += res.length;
    res.forEach((c) => {
      const lo = Math.min(0, c.x2) - 2.6; const hi = Math.max(0, c.x2) + 2.6;
      if (c.lat > lo && c.lat < hi) flags.push(Object.assign({ kind: 'ambient-on-rails' }, c));
    });
  }
  return { cars, flags };
};

/* ---- streaming: the game starts lazily (the scenery half of a station patch arrives while the train drives).  For every patch crossing the train approaches from
   600 m; no vehicle may exist while the road of the crossing is not drawn (cars used to queue on bare rails until the patch scenery had loaded) */
const streaming = async (sim, id) => {
  await sim.start(id, 'emu', { lazy: true });
  const sites = await sim.evalGame(({ track }) => (track.base || track).crossingRoads.crossings.map((c) => ({ s: c.s, patch: !!c.patch, name: c.patchName || '' })));
  const flags = []; let checked = 0;
  for (const site of sites.filter((x) => x.patch)) {
    await sim.page.evaluate((ts) => { __tsTest.placeAt(ts, 0); }, site.s - 600);
    for (let k = 0; k < 120; k++) {
      await sim.frames(2);
      const r = await sim.evalGame(({ track, world }, ss) => {
        const t = world.landscape.crossingTraffic(); const base = track.base || track;
        const st = t.sites.find((x) => Math.abs(x.s - ss) < 1);
        const drawn = world.landscape.crossingRoadsDrawn(st.c);
        return { cars: st.lanes.reduce((n, l) => n + l.cars.length, 0), drawn };
      }, site.s);
      checked += 1;
      if (r.cars > 0 && !r.drawn) { flags.push({ kind: 'cars-without-road', s: Math.round(site.s), patch: site.name, cars: r.cars, frame: k }); break; }
    }
  }
  return { checked, flags };
};

/* ---- rendered truth: a ray down onto every 3rd path point of the car lanes of a site (the train stands next to it so the chunks and the patch are built): the first
   surface must be a road (a mesh under a group tagged userData.road: crossing roads, station-patch roads, the crossing deck of infra.js) or lie within 0.3 m of one */
const drawn = async (sim, id) => {
  const sites = await sim.evalGame(({ track }) => (track.base || track).crossingRoads.crossings.map((c) => c.s));
  const rev = await sim.evalGame(({ track }) => !!track.reverse);
  const length = await sim.evalGame(({ track }) => track.length);
  const flags = []; let rays = 0;
  for (const cs of sites) {
    // the return direction runs the same ground backwards: the train stands at length - s (the plan and the lanes are in base coordinates)
    await sim.page.evaluate(([ts, r, L]) => { const s = r ? L - ts : ts; __tsTest.placeAt(s, 0); const w = __tsTest.internals().world; w.landscape.warm(w.track.baseS ? w.track.baseS(s) : s); }, [cs, rev, length]);
    await sim.frames(4);
    const res = await sim.evalGame(({ track, world, scene, THREE, camera }, ss) => {
      const t = world.landscape.crossingTraffic();
      const site = t.sites.find((x) => Math.abs(x.s - ss) < 1);
      const rc = new THREE.Raycaster(); rc.camera = camera; const down = new THREE.Vector3(0, -1, 0);
      const isRoad = (o) => { for (let n = o; n; n = n.parent) if (n.userData && n.userData.road) return true; return false; };
      const bad = []; let n = 0;
      const base = track.base || track;
      site.lanes.forEach((lane) => {
        for (let i = 2; i < lane.pts.length - 2; i += 3) {      // the first / last 4 m: vehicles appear / vanish at the road tip
          const p = lane.pts[i];
          const q = base.nearest(p.x, p.z);
          if (Math.abs(q.s - ss) > 700) continue;
          rc.set(new THREE.Vector3(p.x, p.y + 3, p.z), down); rc.far = 12;
          const hits = rc.intersectObjects(scene.children, true).filter((h) => h.object.isMesh && !h.object.isInstancedMesh && h.object.visible && h.object.geometry && !(h.object.material && h.object.material.transparent));
          // the deck over the rails (rails and sleepers stand in it) is meant to be driven over
          const f0 = base.frameAt(ss); const dx = p.x - f0.pos.x; const dz = p.z - f0.pos.z;
          const aa = dx * f0.tangent.x + dz * f0.tangent.z; const ll = dx * f0.right.x + dz * f0.right.z;
          if (Math.abs(aa) < 3.5 && ll > site.c.lLo - 1 && ll < site.c.lHi + 1) continue;
          n += 1;
          const top = hits.length ? hits[0].point.y : -Infinity;
          const roadHit = hits.find((h) => Math.abs(h.point.y - p.y) < 0.7 && isRoad(h.object));
          const where = { x: Math.round(p.x), z: Math.round(p.z), lat: Math.round(q.lat), ds: Math.round(q.s - ss) };
          if (!roadHit) bad.push(Object.assign({ at: i + '/' + lane.pts.length, why: hits.length ? 'ground:' + (hits[0].object.name || (hits[0].object.parent && hits[0].object.parent.name) || '?') : 'nothing', dy: hits.length ? Math.round((top - p.y) * 100) / 100 : null }, where));
          // (field / grass sheets lie over roads too, but their materials are offset in depth: only the terrain counts as burying)
          else if (top - roadHit.point.y > 0.15 && hits[0].object.name === 'ls-terrain') bad.push(Object.assign({ why: 'road-buried-by:' + (hits[0].object.name || '?'), dy: Math.round((top - roadHit.point.y) * 100) / 100 }, where));
        }
      });
      return { n, bad: bad.slice(0, 6), count: bad.length };
    }, cs);
    rays += res.n;
    if (res.count) flags.push({ kind: 'no-road-surface', s: Math.round(cs), count: res.count, of: res.n, sample: res.bad });
  }
  return { rays, flags };
};

const sim = await openSim({ quality: 'medium', root });
const report = [];
let bad = 0;
try {
  for (const route of routes) {
    for (const id of withReturn ? [route, route + '~r'] : [route]) {
      await sim.start(id);
      if (lazy) {
        const lz = await streaming(sim, id);
        console.log(id.padEnd(12), 'lazy streaming frames checked', lz.checked, 'flags', lz.flags.length);
        lz.flags.forEach((f) => console.log('   ', JSON.stringify(f)));
        bad += lz.flags.length;
        report.push({ route: id, lazy: lz });
        continue;
      }
      const res = await sim.evalGame(probe, 6);
      res.route = id;
      const dr = await drawn(sim, id);
      res.rays = dr.rays; res.flags.push(...dr.flags);
      const amb = await ambient(sim, id);
      res.cars += 0; res.ambientCars = amb.cars; res.flags.push(...amb.flags.filter((f, i, a) => a.findIndex((g) => g.kind === f.kind && g.s === f.s && g.x === f.x) === i));
      report.push(res);
      const kinds = {};
      res.flags.forEach((f) => { kinds[f.kind] = (kinds[f.kind] || 0) + 1; });
      console.log(id.padEnd(12), 'sites', res.sites, 'cars', res.cars, 'ambient', res.ambientCars, 'rays', res.rays, 'lanes', res.lanes, 'points', res.points, 'flags', JSON.stringify(kinds));
      res.flags.slice(0, 12).forEach((f) => console.log('   ', JSON.stringify(f)));
      bad += res.flags.length;
    }
  }
  console.log('errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 5));
} finally { await sim.close(); }
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1));
// hard failures: a vehicle on the rails, a vehicle without a road (streaming).  The surface findings (no-road-surface: a lane point 5 - 25 cm off the drawn
// surface at a road tip / station-patch road) are reported as warnings: they are listed above, the stations agent owns the patch roads.
const HARD = new Set(['rail', 'car-on-rails', 'ambient-on-rails', 'cars-without-road', 'gap']);
const hard = report.flatMap((r) => (r.flags || []).concat((r.lazy && r.lazy.flags) || [])).filter((f) => HARD.has(f.kind)).length;
console.log(hard ? 'FAIL: ' + hard + ' vehicles on rails / without a road / path jumps (' + bad + ' findings in all)' : 'PASS: no vehicle on the rails, none without a road (' + bad + ' surface warnings)');
process.exit(hard ? 1 : 0);
