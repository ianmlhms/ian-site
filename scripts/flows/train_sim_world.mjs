/* Zuchsimulator "real world" checks: level-crossing roads, the shared Mosel line (east / wittlich / trier), the real station patch (Munsbach) and the hole detector.
 *   - every level crossing of every rail route has a real road on both sides: long enough, smooth, on the terrain (terrain function = design height, the strip mesh
 *     carries it), no NaN, with the barriers' traffic (vehicles queue in front of the stop line while the barriers are closed and drive on afterwards)
 *   - east / wittlich / trier share one line: same stations and crossings at the same positions; trier passes the stations it does not serve (RE), the others stop
 *     everywhere; stop counts; the new route is registered with a price and an order position
 *   - Munsbach: the real LiDAR relief, buildings and trees are built around the station, no console errors
 *   - hole detector (scripts/zuch/hole_lib.mjs): no hole / pit in the ground on west and east, no missing terrain under any ray
 * Standalone game page (no arcade, no Supabase).  Runs in about three minutes. */
import { runIfMain } from './lib.mjs';
import { simOnPage } from '../zuch/zlib.mjs';
import { scanRoute } from '../zuch/hole_lib.mjs';

const RAIL_ROUTES = ['west', 'south', 'east', 'wittlich', 'north', 'trier', 'metz', 'brussels', 'paris'];
const MIN_ROAD_REACH_M = 120;       // the road continues at least this far (along the road) beyond the crossing on both sides
const MAX_ROAD_GRADE = 0.07;
const SURFACE_TOL_M = 0.06;         // terrain function vs design height along the road
const MESH_TOL_UP_M = 0.1;          // the strip mesh may not stand above the road surface by more than this
const MESH_TOL_DOWN_M = 0.35;       // ... nor sink below it by more than this

export const flow = {
  name: 'train-sim-world', fullChromium: true,
  async run(h) {
    const sim = await simOnPage(await h.context.newPage(), h.origin, { quality: 'high' });
    const page = sim.page;

    h.step('level crossings: every crossing has a real road on both sides, on the terrain');
    const crossingsSeen = [];
    for (const route of RAIL_ROUTES) {
      await sim.start(route);
      const rep = await sim.evalGame(({ track, THREE, world }, args) => {
        const plan = track.crossingRoads;
        const out = { n: track.crossings.length, planned: plan ? plan.crossings.length : 0, bad: [], reach: [], maxGrade: 0, nanCount: 0, meshProblems: [], surfaceProblems: [] };
        if (!plan) return out;
        const ls = world.landscape;
        plan.crossings.forEach((c) => {
          world.landscape.warm(c.s);
          const meshes = ls.terrainMeshes();
          const rc = new THREE.Raycaster(); const down = new THREE.Vector3(0, -1, 0);
          let reachP = 0; let reachM = 0;
          c.roads.forEach((r) => {
            r.pts.forEach((p, i) => {
              if (![p.x, p.z, p.yT].every(Number.isFinite)) out.nanCount += 1;
              if (i > 0) { const q = r.pts[i - 1]; const g = Math.abs(p.yT - q.yT) / Math.max(0.5, Math.hypot(p.x - q.x, p.z - q.z)); out.maxGrade = Math.max(out.maxGrade, g); }
              const y = track.terrainHeightAt(p.x, p.z);
              if (Math.abs(y - p.yT) > args.surfaceTol) out.surfaceProblems.push({ s: Math.round(c.s), road: r.id, u: Math.round(p.u), dy: Math.round((y - p.yT) * 100) / 100 });
              if (i % 4 === 0 && r.kind === 'asphalt') {
                rc.set(new THREE.Vector3(p.x, p.yT + 40, p.z), down);
                const hit = rc.intersectObjects(meshes, false)[0];
                const road = p.yT + plan.ROAD_LIFT;
                if (!hit) out.meshProblems.push({ s: Math.round(c.s), road: r.id, u: Math.round(p.u), kind: 'miss' });
                else if (hit.point.y > road + args.up || hit.point.y < road - args.down) out.meshProblems.push({ s: Math.round(c.s), road: r.id, u: Math.round(p.u), kind: 'mesh', dy: Math.round((hit.point.y - road) * 100) / 100 });
              }
            });
          });
          // reach of the road on each side of the track (along the road from the crossing)
          [1, -1].forEach((sd) => {
            let best = 0;
            c.roads.forEach((r) => r.pts.forEach((p) => { if (Math.sign(p.l) === sd || (p.l === 0 && sd > 0)) best = Math.max(best, Math.hypot(p.a, Math.abs(p.l))); }));
            out.reach.push(Math.round(best));
          });
        });
        return out;
      }, { surfaceTol: SURFACE_TOL_M, up: MESH_TOL_UP_M, down: MESH_TOL_DOWN_M });
      crossingsSeen.push({ route, n: rep.n });
      h.eq([rep.n, rep.nanCount], [rep.planned, 0], `${route}: ${rep.n} crossings, every one has a planned road, no NaN`);
      h.expect(rep.reach.every((r) => r >= MIN_ROAD_REACH_M), `${route}: the road reaches >= ${MIN_ROAD_REACH_M} m on both sides of every crossing (${rep.reach.join(', ')})`);
      h.expect(rep.maxGrade <= MAX_ROAD_GRADE, `${route}: road grade <= ${MAX_ROAD_GRADE * 100} % (max ${(rep.maxGrade * 100).toFixed(1)} %)`);
      h.eq(rep.surfaceProblems.slice(0, 3), [], `${route}: the terrain follows the designed road height (<= ${SURFACE_TOL_M} m)`);
      h.eq(rep.meshProblems.slice(0, 3), [], `${route}: the strip mesh carries the road (no floating road, no sunken road)`);
    }
    h.expect(crossingsSeen.reduce((s, c) => s + c.n, 0) >= 20, `crossings over all rail routes: ${crossingsSeen.map((c) => c.route + ':' + c.n).join(' ')}`);

    h.step('crossing traffic: vehicles queue at the stop line while the barriers are closed and drive on afterwards');
    await sim.start('west');
    const q = await sim.evalGame(({ world, track }) => {
      const ls = world.landscape; const ct = ls.crossingTraffic();
      const c = track.crossings[0];
      const stepAll = (secs, trainS) => { const cam = __tsTest.internals().camera; for (let i = 0; i < secs * 10; i++) ct.update(0.1, trainS, cam); };
      stepAll(1, c.s - 300);                      // wakes the crossing up
      stepAll(40, c.s - 300);                     // cars arrive and drive
      const before = ct.state().find((s) => Math.abs(s.s - c.s) < 3);
      ct.setClosed(c.s, true);
      stepAll(60, c.s - 300);
      const closed = ct.state().find((s) => Math.abs(s.s - c.s) < 3);
      const site = ct.sites.find((s) => Math.abs(s.s - c.s) < 3);
      const offenders = [];
      site.lanes.forEach((lane, li) => lane.cars.forEach((car) => { if (car.u + car.L / 2 > lane.stopU + 0.5 && car.u - car.L / 2 < lane.zoneEnd + 2 && car.v < 0.2) offenders.push({ lane: li, u: car.u, stopU: lane.stopU }); }));
      const stopped = site.lanes.reduce((n, lane) => n + lane.cars.filter((car) => car.v < 0.1 && car.u + car.L / 2 <= lane.stopU + 0.2).length, 0);
      const moving = site.lanes.reduce((n, lane) => n + lane.cars.filter((car) => car.v > 1).length, 0);
      ct.setClosed(c.s, false);
      stepAll(30, c.s - 300);
      const open = ct.state().find((s) => Math.abs(s.s - c.s) < 3);
      const movingAfter = site.lanes.reduce((n, lane) => n + lane.cars.filter((car) => car.v > 1).length, 0);
      return { active: before && before.active, carsBefore: before ? before.lanes.reduce((n, l) => n + l.cars.length, 0) : 0, carsClosed: closed ? closed.lanes.reduce((n, l) => n + l.cars.length, 0) : 0, offenders, stopped, moving, movingAfter, openCars: open ? open.lanes.reduce((n, l) => n + l.cars.length, 0) : 0 };
    });
    h.expect(q.active && q.carsBefore + q.carsClosed > 0, `vehicles drive on the crossing road (${q.carsBefore} / ${q.carsClosed} on the lanes)`);
    h.eq(q.offenders, [], 'no vehicle stands on the crossing while the barriers are closed');
    h.expect(q.stopped >= 1, `at least one vehicle waits in front of the stop line (${q.stopped} stopped)`);
    h.expect(q.movingAfter >= 1 || q.openCars === 0, `traffic flows again after the barriers open (${q.movingAfter} moving)`);

    h.step('the Mosel line: east / wittlich / trier share one track and one set of stations');
    const lines = {};
    for (const id of ['east', 'wittlich', 'trier']) {
      await sim.start(id);
      lines[id] = await sim.evalGame(({ track }) => ({ st: track.stations.map((s) => [s.name, Math.round(s.platformStart)]), cross: track.crossings.map((c) => Math.round(c.s)), len: Math.round(track.length), pass: track.passFixed, scenery: track.sceneryId, plan: __tsTest.state().pattern, passIdx: __tsTest.state().passIndices, stops: track.stations.length - track.passFixed.length }));
    }
    const prefixSame = (a, b, n) => a.st.slice(0, n).every((s, i) => s[0] === b.st[i][0] && Math.abs(s[1] - b.st[i][1]) <= 6);
    h.expect(prefixSame(lines.east, lines.wittlich, lines.east.st.length - 1) && prefixSame(lines.wittlich, lines.trier, lines.wittlich.st.length - 1), 'the three services have the same stations at the same positions (up to the last station of the shorter one)');
    h.expect(lines.east.cross.every((c, i) => Math.abs(c - lines.wittlich.cross[i]) <= 2) && lines.east.cross.length <= lines.wittlich.cross.length, 'the crossings of east are the first crossings of wittlich');
    h.eq([lines.east.scenery, lines.wittlich.scenery, lines.trier.scenery], ['mosel', 'mosel', 'mosel'], 'one scenery id');
    h.eq([lines.east.st.length, lines.wittlich.st.length, lines.trier.st.length], [10, 21, 23], 'east: 10 stations, wittlich: 21, trier: 23 on the line');
    h.eq([lines.east.pass.length, lines.wittlich.pass.length, lines.trier.pass.length, lines.trier.stops], [0, 0, 11, 12], 'east and wittlich stop everywhere, trier runs through 11 of 23 and stops 12 times');
    h.eq(lines.trier.passIdx, lines.trier.pass, 'the express plan passes exactly the fixed stations');
    h.eq(lines.wittlich.st.map((s) => s[0]).slice(0, 10), ['Lëtzebuerg', 'Sandweiler-Contern', 'Oetrange', 'Munsbach', 'Roodt-Syr', 'Betzder', 'Wecker', 'Manternach', 'Mertert', 'Wasserbëlleg'], 'east stop list: Munsbach, Roodt and Wecker are on the line');
    const cfg = await page.evaluate(() => ({ price: TS.config.routeRules.wittlich && TS.config.routeRules.wittlich.price, order: TS.config.routeOrder.slice(), route: !!TS.routes.get('wittlich') && !!TS.routes.get('wittlich~r') }));
    h.expect(cfg.price > 0 && cfg.order.includes('wittlich') && cfg.route, `wittlich is registered (price ${cfg.price}, order ${cfg.order.join(',')}) with a return direction`);
    for (const id of ['wittlich~r', 'trier~r']) {
      await sim.start(id);
      const back = await sim.evalGame(({ track }) => ({ n: track.stations.length, first: track.stations[0].name, pass: track.passFixed.length }));
      h.expect(back.first === (id === 'wittlich~r' ? 'Wittlich' : 'Koblenz Hbf') && back.n === (id === 'wittlich~r' ? 21 : 23), `${id}: starts at ${back.first} with ${back.n} stations, ${back.pass} passed`);
    }

    h.step('Munsbach: the real relief, buildings and trees around the station');
    await sim.start('east');
    const mun = await sim.evalGame(({ track, world }) => {
      const p = track.surroundPatches && track.surroundPatches.find((x) => x.name === 'Munsbach');
      if (!p) return { patch: false };
      const st = track.stations.find((s) => s.name === 'Munsbach');
      __tsTest.placeAt(p.sMid - 150, 0);
      world.landscape.warm(p.sMid - 150);
      return { patch: true, side: st.side, dem0: p.demAt(p.sMid, 0), demFar: p.demAt(p.sMid + 100, 120), built: 0 };
    });
    await sim.frames(30);
    const built = await sim.evalGame(({ world, scene }) => {
      let groups = 0; let tris = 0;
      scene.traverse((o) => { if (o.name && o.name.startsWith('station-surround-')) { groups += 1; o.traverse((m) => { if (m.isMesh && m.geometry.index) tris += m.geometry.index.count / 3; }); } });
      return { groups, tris };
    });
    if (mun.patch) {
      h.expect(Math.abs(mun.dem0) < 0.5, `the real relief is flat in the track corridor (${mun.dem0.toFixed(2)} m)`);
      h.expect(built.groups === 1 && built.tris > 2000, `the Munsbach surroundings are built: ${built.groups} group, ${Math.round(built.tris)} triangles`);
    } else h.expect(false, 'Munsbach: no station patch loaded (pb/train-sim/data/stations/munsbach.json)');

    h.step('hole detector: no hole, no pit, no missing terrain on west and east');
    for (const id of ['west', 'east']) {
      const rep = await scanRoute(sim, id, { step: 500, rayStep: 90 });
      h.eq([rep.flaggedPoses.slice(0, 2), rep.rayFailures.slice(0, 2)], [[], []], `${id}: ${rep.poses} render poses and ${rep.rays} rays, no holes`);
    }
    const errs = sim.errors.filter((e) => !/404/.test(e));
    h.eq(errs.slice(0, 5), [], 'no console errors or warnings from the game');
  },
};
runIfMain(import.meta.url, flow);
