/* Zuchsimulator rolling stock (zstock): the real CFL fleet and the TGV.
 *   - config: every rail train is a real unit (name, cars, top speed, price order), the new ids are buyable and compatible with the right lines, old saves keep their trains
 *   - models: every train builds (3D + cab) at medium quality inside the draw / triangle budgets, with the car count and length of the real set
 *   - cabs: every desk keeps its 9 controls reachable (lever gate, doors, horn, lights, EB, parking brake, announcement, wipers)
 *   - service: a service starts and runs a few seconds with each new train
 * Standalone game page, about two minutes. */
import { runIfMain } from './lib.mjs';
import { simOnPage } from '../zuch/zlib.mjs';

/* id -> what the real unit is (cars, length m, top speed in the game, route compatibility) */
const FLEET = {
  emu: { cars: 2, lengthM: [48, 56], kmh: 160 },
  z2200: { cars: 3, lengthM: [78, 86], kmh: 160 },
  kiss: { cars: 3, lengthM: [76, 86], kmh: 160 },
  dosto: { cars: 6, lengthM: [145, 165], kmh: 140 },
  c2400: { cars: 3, lengthM: [78, 88], kmh: 160 },
  ic: { cars: 7, lengthM: [170, 190], kmh: 200 },
  c2450: { cars: 6, lengthM: [155, 172], kmh: 160 },
  hst: { cars: 10, lengthM: [190, 205], kmh: 320 },
};
const MAX_MESHES_PER_CAR = 75;      // draw calls of one car at medium (the old KISS car: 66)
const MAX_TRIS_PER_CAR = 42000;     // the old KISS car: 36 k
const MAX_MESHES_TRAIN = 560;
const CAB_CONTROLS = ['lever', 'doorLeft', 'doorRight', 'horn', 'lights', 'eb', 'parking', 'wipers', 'announce'];

export const flow = {
  name: 'train-sim-stock', fullChromium: true,
  async run(h) {
    const sim = await simOnPage(await h.context.newPage(), h.origin, { quality: 'medium' });
    const P = sim.page;

    h.step('config: the real fleet');
    const cfg = await P.evaluate(() => TS.config.trains.filter((t) => t.kind === 'rail').map((t) => ({ id: t.id, price: t.price, cars: t.cars, kmh: t.maxKmh, model: t.model, cab: t.cab, name: t.name.en, carLength: t.carLength, liv: t.liveries.length })));
    h.eq(cfg.map((t) => t.id), ['railcar', 'emu', 'z2200', 'kiss', 'dosto', 'c2400', 'ic', 'c2450', 'hst'], 'rail trains in price order (the old ids railcar / emu / kiss / ic / hst are still there)');
    h.expect(cfg.every((t, i) => i === 0 || t.price >= cfg[i - 1].price), 'prices never fall along the list: ' + cfg.map((t) => t.price).join(' < '));
    for (const [id, f] of Object.entries(FLEET)) {
      const t = cfg.find((x) => x.id === id);
      h.expect(!!t && t.cars === f.cars && t.kmh === f.kmh, `${id}: ${f.cars} cars, ${f.kmh} km/h (${t && t.cars} / ${t && t.kmh})`);
      h.expect(!!t && t.liv === 4 && /CFL|TGV/.test(t.name), `${id}: four liveries, the real name (${t && t.name})`);
    }
    const compat = await P.evaluate(() => {
      const K = TS.career; const ids = TS.config.trains.filter((t) => t.kind === 'rail').map((t) => t.id);
      const out = {}; for (const r of ['west', 'trier', 'metz', 'brussels', 'paris']) out[r] = ids.filter((id) => K.trainCompatible(id, r));
      return out;
    });
    h.eq(compat.west.length, 9, 'every rail train runs the west line');
    h.expect(compat.trier.includes('dosto') && compat.trier.includes('c2400') && compat.trier.includes('kiss') && !compat.trier.includes('z2200') && !compat.trier.includes('emu'), 'Trier: KISS, Dosto, Coradia, IC, TGV; not the Z 2 / 2200: ' + compat.trier.join(','));
    h.expect(compat.metz.includes('z2200') && !compat.metz.includes('emu') && !compat.metz.includes('railcar'), 'Metz: the 2200 and up: ' + compat.metz.join(','));
    h.eq(compat.paris, ['hst'], 'Paris: only the TGV');
    const save = await P.evaluate(() => {
      const K = TS.career;
      const old = { v: 2, tb: 90000, career: 'rail', rail: { lifetime: 90000, wallet: 4000, owned: ['railcar', 'emu', 'kiss', 'ic', 'hst'], routes: ['west', 'metz', 'paris'], train: 'hst', route: 'paris', upgrades: { hst: { motor: 2, capacity: 3 }, kiss: { capacity: 3 } } }, tram: {} };
      const n = K.normalize(old);
      const bought = K.buyTrain({ ...n, rail: { ...n.rail, wallet: 90000 } }, 'z2200');
      const tooPoor = K.buyTrain(K.defaults(), 'c2400');
      return { owned: n.rail.owned, train: n.rail.train, hstCars: K.applyUpgrades(TS.config.trains.find((t) => t.id === 'hst'), n).cars, kissCars: K.applyUpgrades(TS.config.trains.find((t) => t.id === 'kiss'), n).cars, dostoCars: K.applyUpgrades(TS.config.trains.find((t) => t.id === 'dosto'), { ...n, rail: { ...n.rail, upgrades: { ...n.rail.upgrades, dosto: { capacity: 3 } } } }).cars, icCars: K.applyUpgrades(TS.config.trains.find((t) => t.id === 'ic'), { ...n, rail: { ...n.rail, upgrades: { ...n.rail.upgrades, ic: { capacity: 3 } } } }).cars, newOwned: n.rail.owned.includes('z2200') || n.rail.owned.includes('c2400'), bought: bought && bought.rail.owned, wallet: bought && bought.rail.wallet, tooPoor, upg: Object.keys(n.rail.upgrades).length };
    });
    h.eq([save.owned, save.train], [['railcar', 'emu', 'kiss', 'ic', 'hst'], 'hst'], 'an old save keeps its five trains and the TGV as the selected one');
    h.eq([save.newOwned, save.tooPoor], [false, null], 'the new trains are not given away, and cannot be bought without the money');
    h.eq([save.hstCars, save.kissCars, save.dostoCars, save.icCars], [10, 3, 7, 8], 'the maxed capacity upgrade adds a coach only to the locomotive-hauled sets (Dosto 6 -> 7, 3000 IC 7 -> 8); the TGV stays 10 cars, the KISS 3');
    h.expect(save.bought.includes('z2200') && save.wallet === 90000 - 28000, 'buying the 2200 costs 28 000 EUR');

        h.step('old saves and snapshots: every old train id is still a real train');
    const snap = await P.evaluate(() => {
      const K = TS.career; const out = {};
      const save = K.normalize({ v: 2, career: 'rail', rail: { lifetime: 500000, wallet: 0, owned: ['railcar', 'emu', 'kiss', 'ic', 'hst'], routes: ['west', 'south', 'metz', 'brussels', 'paris'], train: 'kiss', route: 'metz' } });
      for (const id of ['railcar', 'emu', 'kiss', 'ic', 'hst']) {
        const order = K.endlessOrder(id);
        const raw = JSON.stringify({ v: TS.resume.VERSION, at: Date.now(), mode: 'endless', fresh: 1, route: order[0], train: id, svc: 0, life: 0, en: { order, i: 0, loops: 0, cash: 0, pts: 0 } });
        const r = TS.resume.check(raw, { save, now: Date.now() });
        out[id] = !!(r && r.snap) ? 'resumes' : 'rejected: ' + (r && r.reason);
      }
      const gone = TS.resume.check(JSON.stringify({ v: TS.resume.VERSION, at: Date.now(), mode: 'endless', fresh: 1, route: 'west', train: 'no-such-train', svc: 0, life: 0, en: { order: ['west'], i: 0, loops: 0, cash: 0, pts: 0 } }), { save, now: Date.now() });
      out.unknown = gone && gone.snap ? 'resumes' : 'rejected cleanly';
      out.routes = save.rail.routes; out.train = save.rail.train;
      return out;
    });
    h.eq([snap.railcar, snap.emu, snap.kiss, snap.ic, snap.hst], ['resumes', 'resumes', 'resumes', 'resumes', 'resumes'], 'a snapshot of any of the five old train ids resumes');
    h.eq(snap.unknown, 'rejected cleanly', 'a snapshot with a train that does not exist is rejected cleanly');
    h.eq([snap.routes, snap.train], [['west', 'south', 'metz', 'brussels', 'paris'], 'kiss'], 'owned routes and the selected train survive the normalisation');

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
    }, { ids: Object.keys(FLEET), controls: CAB_CONTROLS });
    for (const r of rep) {
      const f = FLEET[r.id];
      h.expect(r.cars === f.cars && r.lenM >= f.lengthM[0] && r.lenM <= f.lengthM[1], `${r.id}: ${r.cars} cars, ${r.lenM} m (real ${f.lengthM.join(' - ')})`);
      h.expect(r.perCarMeshes <= MAX_MESHES_PER_CAR && r.meshes <= MAX_MESHES_TRAIN && r.perCarTris <= MAX_TRIS_PER_CAR, `${r.id}: ${r.meshes} draw calls (${r.perCarMeshes} / car), ${(r.tris / 1000).toFixed(0)} k triangles (${(r.perCarTris / 1000).toFixed(1)} k / car)`);
      h.expect(r.ctrls === 9 && r.pts && r.eyeOk, `${r.id}: cab "${r.frame}" keeps its 9 controls, the eye is in the cab`);
    }

    h.step('service: each new train starts a service and runs');
    for (const id of ['z2200', 'dosto', 'c2400', 'c2450', 'hst']) {
      await sim.start(id === 'hst' ? 'paris' : 'west', id, { lazy: true });
      const s = await P.evaluate(() => { const st = __tsTest.state(); return { phase: st.phase, train: st.trainId, errors: st.errors }; });
      await sim.frames(30);
      const s2 = await sim.stats();
      h.expect(s.phase === 'running' && s.train === id && (s2.errors || 0) === 0, `${id}: service running (${s2.draws} draws, ${(s2.triangles / 1000).toFixed(0)} k triangles in the cab view at the first stop)`);
    }
    h.step('key 5: the saloon camera works in the trains too (front end / middle / rear end of the passenger cars)');
    for (const id of ['kiss', 'ic', 'hst']) {
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
