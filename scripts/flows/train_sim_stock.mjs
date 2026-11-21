/* Zuchsimulator rolling stock: the five-train roster (21 Nov 2026) and how old saves move onto it.
 *   - config: five rail trains, each a real unit with a clear Luxembourgish name, a one-line description and clearly different stats; everything free;
 *     compatible with the right lines (the long lines abroad: not the Lokalzuch; Paris: the TGV)
 *   - migration: an old save with removed trains (Schinnebus, 2200, KISS, 2450) moves ownership, the selected train and the upgrades over
 *     (higher level kept, the rest refunded at the price paid), tb never changes, a second normalize changes nothing, an old cloud copy can't bring them back
 *   - upgrades can still be bought (wallet of the train's career), maxed capacity adds a coach to the locomotive-hauled sets only
 *   - snapshots: a saved service of any old train id resumes as its successor; an unknown id is rejected cleanly
 *   - models: every train builds (3D + cab) at medium quality inside the draw / triangle budgets, with the car count and length of the real set
 *   - cabs: every desk keeps its 9 controls reachable (lever gate, doors, horn, lights, EB, parking brake, announcement, wipers)
 *   - service: a service starts and runs a few seconds with each train
 * Standalone game page, about two minutes. */
import { runIfMain } from './lib.mjs';
import { simOnPage } from '../zuch/zlib.mjs';

/* id -> what the real unit is (cars, length m, top speed in the game) */
const FLEET = {
  emu: { cars: 2, lengthM: [48, 56], kmh: 160 },
  c2400: { cars: 3, lengthM: [78, 88], kmh: 160 },
  dosto: { cars: 6, lengthM: [145, 165], kmh: 140 },
  ic: { cars: 7, lengthM: [170, 190], kmh: 200 },
  hst: { cars: 10, lengthM: [190, 205], kmh: 320 },
};
const ROSTER = Object.keys(FLEET);
const RETIRED = { railcar: 'emu', z2200: 'c2400', kiss: 'c2400', c2450: 'dosto' };
const MAX_MESHES_PER_CAR = 75;      // draw calls of one car at medium (the old KISS car: 66)
const MAX_TRIS_PER_CAR = 42000;     // the old KISS car: 36 k
const MAX_MESHES_TRAIN = 560;
const CAB_CONTROLS = ['lever', 'doorLeft', 'doorRight', 'horn', 'lights', 'eb', 'parking', 'wipers', 'announce'];

export const flow = {
  name: 'train-sim-stock', fullChromium: true,
  async run(h) {
    const sim = await simOnPage(await h.context.newPage(), h.origin, { quality: 'medium' });
    const P = sim.page;

    h.step('config: five rail trains, one clear job each, all free');
    const cfg = await P.evaluate(() => TS.config.trains.map((t) => ({ id: t.id, kind: t.kind, price: t.price, cars: t.cars, kmh: t.maxKmh, accel: t.accel, brake: t.brake, seats: t.capacity, name: t.name.lb, real: t.real && t.real.en, blurb: t.blurb && t.blurb.lb, liv: t.liveries.length })));
    const rail = cfg.filter((t) => t.kind === 'rail');
    h.eq(rail.map((t) => t.id), ROSTER, 'rail roster: Lokalzuch, Regionalzuch, Grousse Zuch, Intercity, TGV');
    h.eq(cfg.filter((t) => t.kind === 'tram').map((t) => t.id), ['tram'], 'tram roster: the one Luxtram');
    h.expect(cfg.every((t) => t.price === 0), 'every vehicle is free');
    h.eq(rail.map((t) => t.name), ['Lokalzuch', 'Regionalzuch', 'Grousse Zuch', 'Intercity', 'TGV'], 'clear Luxembourgish names');
    for (const [id, f] of Object.entries(FLEET)) {
      const t = cfg.find((x) => x.id === id);
      h.expect(!!t && t.cars === f.cars && t.kmh === f.kmh, `${id}: ${f.cars} cars, ${f.kmh} km/h (${t && t.cars} / ${t && t.kmh})`);
      h.expect(!!t && t.liv === 4 && /CFL|TGV/.test(t.real) && t.blurb && t.blurb.length > 30, `${id}: four liveries, the real unit (${t && t.real}), a description`);
    }
    h.expect(new Set(rail.map((t) => t.name)).size === rail.length && new Set(rail.map((t) => `${t.kmh}/${t.accel}/${t.seats}`)).size === rail.length, 'no two trains share a name or the same stats');
    h.expect(rail.every((t, i) => i === 0 || t.accel < rail[i - 1].accel), 'acceleration falls along the list (small and quick -> big and fast): ' + rail.map((t) => t.accel).join(' > '));
    const best = (key) => rail.reduce((a, t) => (t[key] > a[key] ? t : a)).id;
    h.eq([best('accel'), best('brake'), best('seats'), best('kmh')], ['emu', 'emu', 'dosto', 'hst'], 'Lokalzuch: quickest to start and stop; Grousse Zuch: most seats; TGV: fastest');
    h.expect(rail.find((t) => t.id === 'ic').kmh > rail.find((t) => t.id === 'c2400').kmh && rail.find((t) => t.id === 'c2400').seats > 2 * rail.find((t) => t.id === 'emu').seats - 1, 'Intercity faster than the Regionalzuch; the Regionalzuch has about twice the Lokalzuch seats');
    const compat = await P.evaluate(() => {
      const K = TS.career; const ids = TS.config.trains.filter((t) => t.kind === 'rail').map((t) => t.id);
      const out = {}; for (const r of ['west', 'north', 'trier', 'metz', 'brussels', 'paris']) out[r] = ids.filter((id) => K.trainCompatible(id, r));
      return out;
    });
    h.eq([compat.west, compat.north], [ROSTER, ROSTER], 'every train runs the lines inside the country');
    h.eq([compat.trier, compat.metz, compat.brussels], [['c2400', 'dosto', 'ic', 'hst'], ['c2400', 'dosto', 'ic', 'hst'], ['c2400', 'dosto', 'ic', 'hst']], 'Trier / Metz / Brussels: every train but the small Lokalzuch');
    h.eq(compat.paris, ['hst'], 'Paris: only the TGV');

    h.step('migration: an old save with removed trains keeps its progress and money');
    const mig = await P.evaluate(() => {
      const K = TS.career, U = TS.config.upgrades, R = TS.config.retiredUpgrades;
      const paid = (table, lv) => table.slice(0, lv).reduce((a, p) => a + p, 0);
      const old = { v: 2, tb: 250000, savedAt: 1000, career: 'rail', hints: true, hintsSet: true,
        rail: { lifetime: 240000, wallet: 4000, owned: ['railcar', 'emu', 'kiss', 'z2200', 'c2400', 'c2450', 'dosto', 'ic', 'hst'], routes: ['west', 'south', 'metz'], train: 'kiss', route: 'metz', services: 31, best: { west: 300, metz: 900 }, endlessBest: 77,
          upgrades: { railcar: { motor: 3, paint: 2 }, emu: { motor: 1 }, kiss: { capacity: 3, brakes: 1 }, z2200: { motor: 2 }, c2400: { capacity: 1, motor: 1, brakes: 2 }, c2450: { comfort: 4 }, dosto: { comfort: 1 }, hst: { motor: 2, capacity: 3 } } },
        tram: { lifetime: 10000, wallet: 2500, upgrades: { tram: { motor: 2 } } } };
      const before = JSON.stringify(old);
      const n = K.normalize(old);
      const refund = paid(U.emu.motor, 1)                  // Schinnebus motor 3 beats the Lokalzuch's 1
        + paid(U.c2400.capacity, 1)                        // KISS capacity 3 beats the Coradia's 1
        + paid(U.c2400.motor, 1)                           // 2200 motor 2 beats the Coradia's 1
        + paid(R.kiss.brakes, 1)                           // the Coradia's own brakes 2 beat the KISS's 1
        + paid(U.dosto.comfort, 1);                        // 2450 comfort 4 beats the Dosto's 1
      const cloudOld = K.merge(n, old);                    // the old copy arriving from the cloud (same tb, older savedAt)
      const cloudNewer = K.merge(n, { ...old, savedAt: 9e12 });   // even a newer-dated old copy normalizes to the same migrated state
      const up = K.buyUpgrade(n, 'dosto', 'paint');
      return {
        unchanged: JSON.stringify(old) === before, tb: [old.tb, n.tb, n.rail.lifetime, n.tram.lifetime], wallet: n.rail.wallet, expected: 4000 + refund, refund, tramWallet: n.tram.wallet,
        owned: n.rail.owned, routes: n.rail.routes.length, train: n.rail.train, route: n.rail.route, services: n.rail.services, best: n.rail.best, endlessBest: n.rail.endlessBest,
        up: n.rail.upgrades, ids: Object.keys(n.rail.upgrades), again: JSON.stringify(K.normalize(n)) === JSON.stringify(n),
        cloudOld: JSON.stringify(cloudOld.rail) === JSON.stringify(n.rail), cloudNewer: JSON.stringify(cloudNewer.rail) === JSON.stringify(n.rail),
        buy: up && { level: up.rail.upgrades.dosto.paint, spent: n.rail.wallet - up.rail.wallet, price: U.dosto.paint[0], tb: up.tb },
        cars: { dosto: K.applyUpgrades(TS.config.trains.find((t) => t.id === 'dosto'), { ...n, rail: { ...n.rail, upgrades: { ...n.rail.upgrades, dosto: { capacity: 3 } } } }).cars,
          ic: K.applyUpgrades(TS.config.trains.find((t) => t.id === 'ic'), { ...n, rail: { ...n.rail, upgrades: { ...n.rail.upgrades, ic: { capacity: 3 } } } }).cars,
          hst: K.applyUpgrades(TS.config.trains.find((t) => t.id === 'hst'), n).cars, c2400: K.applyUpgrades(TS.config.trains.find((t) => t.id === 'c2400'), n).cars },
        noMoney: K.buyUpgrade(K.defaults(), 'hst', 'motor'), trainBuy: K.buyTrain(n, 'c2400'), routeBuy: K.buyRoute(n, 'paris'),
      };
    });
    h.expect(mig.unchanged, 'the input save object is not mutated');
    h.eq(mig.tb, [250000, 250000, 240000, 10000], 'tb (and both lifetimes) unchanged by the migration');
    h.eq([mig.wallet, mig.tramWallet], [mig.expected, 2500], `rail wallet = old wallet + ${mig.refund} € refund for the levels that could not be carried over; tram wallet untouched`);
    h.eq([mig.owned, mig.routes, mig.train, mig.route], [ROSTER, 9, 'c2400', 'metz'], 'owns the whole roster and every line; the selected KISS became the Regionalzuch');
    h.eq([mig.services, mig.best, mig.endlessBest], [31, { west: 300, metz: 900 }, 77], 'services and records kept');
    h.eq(mig.ids, ROSTER, 'upgrades are kept for the roster only');
    h.eq([mig.up.emu.motor, mig.up.emu.paint, mig.up.c2400.capacity, mig.up.c2400.motor, mig.up.c2400.brakes, mig.up.dosto.comfort, mig.up.hst.motor, mig.up.hst.capacity],
      [3, 2, 3, 2, 2, 4, 2, 3], 'the higher level of each kind moves onto the kept train');
    h.expect(mig.again, 'normalizing again changes nothing (no second refund)');
    h.expect(mig.cloudOld && mig.cloudNewer, 'an old cloud copy can neither bring back removed trains nor pay the refund twice');
    h.eq(mig.buy, { level: 1, spent: mig.buy && mig.buy.price, price: mig.buy && mig.buy.price, tb: 250000 }, 'an upgrade can still be bought with the wallet; tb untouched');
    h.eq([mig.noMoney, mig.trainBuy, mig.routeBuy], [null, null, null], 'no upgrade without the money; buying a train or a line is not a thing any more');
    h.eq(mig.cars, { dosto: 7, ic: 8, hst: 10, c2400: 3 }, 'maxed capacity adds a coach only to the locomotive-hauled sets (Dosto 6 -> 7, 3000 IC 7 -> 8)');

    h.step('snapshots: a saved service of every old train id resumes as its successor');
    const snap = await P.evaluate((retired) => {
      const K = TS.career; const out = {};
      const save = K.normalize({ v: 2, career: 'rail', rail: { lifetime: 500000, wallet: 0, train: 'kiss', route: 'metz' } });
      for (const id of [...Object.keys(retired), 'emu', 'c2400', 'dosto', 'ic', 'hst']) {
        const order = K.endlessOrder(K.resolveTrainId(id));
        const raw = JSON.stringify({ v: TS.resume.VERSION, at: Date.now(), mode: 'endless', fresh: 1, route: order[0], train: id, svc: 0, life: 0, en: { order, i: 0, loops: 0, cash: 0, pts: 0 } });
        const r = TS.resume.check(raw, { save, now: Date.now() });
        out[id] = r && r.snap ? r.snap.train + (r.snap.from ? ' (from ' + r.snap.from + ')' : '') : 'rejected: ' + (r && r.reject);
      }
      const gone = TS.resume.check(JSON.stringify({ v: TS.resume.VERSION, at: Date.now(), mode: 'endless', fresh: 1, route: 'west', train: 'no-such-train', svc: 0, life: 0, en: { order: ['west'], i: 0, loops: 0, cash: 0, pts: 0 } }), { save, now: Date.now() });
      out.unknown = gone && gone.snap ? 'resumes' : 'rejected cleanly';
      return out;
    }, RETIRED);
    h.eq(snap, { railcar: 'emu (from railcar)', z2200: 'c2400 (from z2200)', kiss: 'c2400 (from kiss)', c2450: 'dosto (from c2450)', emu: 'emu', c2400: 'c2400', dosto: 'dosto', ic: 'ic', hst: 'hst', unknown: 'rejected cleanly' },
      'old ids resume as Lokalzuch / Regionalzuch / Grousse Zuch, kept ids as themselves, an unknown id is rejected');

    h.step('models + cabs: every rail train builds inside the budgets');
    const rep = await P.evaluate(({ ids, controls }) => {
      const T = THREE; const out = [];
      for (const id of ids) {
        const def = TS.config.trains.find((t) => t.id === id);
        const model = TS.trains.create(def, { quality: 'medium', livery: def.livery, upgrades: {}, headlight: false });
        let meshes = 0; let tris = 0;
        model.group.traverse((o) => { if (!(o.isMesh || o.isSprite)) return; for (let p = o; p; p = p.parent) if (!p.visible) return; meshes += Array.isArray(o.material) ? o.material.length : 1; const g = o.geometry; if (g) tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); });
        const cab = TS.cab.create(def, { quality: 'medium' });
        model.cars[0].group.add(cab.group); model.cars[0].group.updateMatrixWorld(true);
        cab.update({ lever: 3, speedKmh: 90, limitKmh: 120, targetKmh: 80, clock: '14:32', delaySec: 12, nextStationName: 'Wasserbillig', distanceToStopM: 1500, signalAspect: 'green', brakePct: 0, powerKw: 900 });
        const pts = controls.map((c) => { const v = cab.getControlWorldPoint(c, c === 'lever' ? 2 : undefined); return v && [v.x, v.y, v.z].every(Number.isFinite); });
        const eye = cab.group.userData.eye;
        const lenM = model.totalLength;
        const info = { id, cars: model.cars.length, lenM: Math.round(lenM * 10) / 10, meshes, tris: Math.round(tris), ctrls: cab.controlIds.length, pts: pts.every(Boolean), eyeOk: !!eye && Number.isFinite(eye.y) && eye.y > 1.5 && eye.y < 3.2, frame: cab.group.userData.frame.type, perCarMeshes: Math.round(meshes / model.cars.length), perCarTris: Math.round(tris / model.cars.length) };
        cab.dispose(); model.dispose();
        out.push(info);
      }
      return out;
    }, { ids: ROSTER, controls: CAB_CONTROLS });
    for (const r of rep) {
      const f = FLEET[r.id];
      h.expect(r.cars === f.cars && r.lenM >= f.lengthM[0] && r.lenM <= f.lengthM[1], `${r.id}: ${r.cars} cars, ${r.lenM} m (real ${f.lengthM.join(' - ')})`);
      h.expect(r.perCarMeshes <= MAX_MESHES_PER_CAR && r.meshes <= MAX_MESHES_TRAIN && r.perCarTris <= MAX_TRIS_PER_CAR, `${r.id}: ${r.meshes} draw calls (${r.perCarMeshes} / car), ${(r.tris / 1000).toFixed(0)} k triangles (${(r.perCarTris / 1000).toFixed(1)} k / car)`);
      h.expect(r.ctrls === 9 && r.pts && r.eyeOk, `${r.id}: cab "${r.frame}" keeps its 9 controls, the eye is in the cab`);
    }

    h.step('service: each train starts a service and runs');
    for (const id of ROSTER) {
      await sim.start(id === 'hst' ? 'paris' : 'west', id, { lazy: true });
      const s = await P.evaluate(() => { const st = __tsTest.state(); return { phase: st.phase, train: st.trainId, errors: st.errors }; });
      await sim.frames(30);
      const s2 = await sim.stats();
      h.expect(s.phase === 'running' && s.train === id && (s2.errors || 0) === 0, `${id}: service running (${s2.draws} draws, ${(s2.triangles / 1000).toFixed(0)} k triangles in the cab view at the first stop)`);
    }
    h.step('key 5: the saloon camera works in the trains too (front end / middle / rear end of the passenger cars)');
    for (const id of ['c2400', 'ic', 'hst']) {
      await sim.start(id === 'hst' ? 'paris' : 'west', id, { lazy: true });
      await P.evaluate(() => window.focus());
      const seen = [];
      for (let k = 0; k < 4; k++) {
        await P.keyboard.press('5');
        await sim.frames(8);
        seen.push(await P.evaluate(() => { const s = __tsTest.state(); const cam = __tsTest.internals().camera; const w = __tsTest.internals().world; const eyeOk = [cam.position.x, cam.position.y, cam.position.z].every(Number.isFinite); const car0 = w.model.cars[0].group; const d = cam.position.distanceTo(car0.getWorldPosition(new THREE.Vector3())); return { cam: s.camMode, eyeOk, d: Math.round(d) }; }));
      }
      h.expect(seen.every((r) => r.cam === 'inside' && r.eyeOk), `${id}: key 5 goes inside and cycles the three viewpoints ` + JSON.stringify(seen.map((r) => r.d)) + ' m from the front car');
      await P.keyboard.press('1');
      await sim.frames(4);
      h.eq((await P.evaluate(() => __tsTest.state().camMode)), 'cab', `${id}: key 1 is back in the cab`);
    }
    const bad = sim.errors.filter((e) => !/404|favicon/.test(e));
    h.eq(bad, [], 'no console errors in the whole flow');
  },
};

runIfMain(import.meta.url, flow);
