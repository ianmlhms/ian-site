/* Zuchsimulator W2c: the real single-line routes north (CFL line 10), south (line 60) and west (line 50) - verified stop lists, real OSM geometry and scenery, the
 * real station surroundings and platform layouts, and the hole detector.  Standalone game page; about four minutes.
 *   - stop lists = the real RB service of the line (OSM route relations, REAL-LINES.md "W2c"), in order, with the right length
 *   - the real scenery data is attached (rivers, relief, land classes, roads) and the route has the tunnels / viaducts the real line has
 *   - every Luxembourg station except the Gare Centrale has its real surroundings patch; stations without a photo model get their platform layout from OSM
 *   - the return direction (~r) starts at the other end with the same number of stations
 *   - hole scan on all three routes: no hole, no pit, no missing terrain, no seam crack */
import fs from 'node:fs';
import { runIfMain } from './lib.mjs';
import { simOnPage } from '../zuch/zlib.mjs';
import { scanRoute } from '../zuch/hole_lib.mjs';

const LINES = {
  west: {
    stations: ['Lëtzebuerg', 'Bertrange-Strassen', 'Mamer-Lycée', 'Mamer', 'Capellen', 'Kleinbettingen'],
    minTunnels: 1, minCrossings: 1, lengthKm: [5.5, 8],
  },
  south: {
    stations: ['Lëtzebuerg', 'Houwald', 'Berchem', 'Bettembuerg', 'Noertzange', 'Schëffleng', 'Esch-Uelzecht', 'Belval-Université', 'Belval-Lycée', 'Belval-Rédange', 'Belvaux-Soleuvre', 'Uewerkuer', 'Déifferdang', 'Nidderkuer', 'Péiteng', 'Lamadelaine', 'Rodange'],
    minTunnels: 1, minCrossings: 1, lengthKm: [13, 19], minBridges: 2,
  },
  north: {
    stations: ['Lëtzebuerg', 'Pafendall-Kierchbierg', 'Dummeldeng', 'Walfer', 'Heisdref', 'Lorentzweiler', 'Lëntgen', 'Miersch', 'Kruchten', 'Colmer-Bierg', 'Schieren', 'Ettelbréck', 'Michelau', 'Giewelmillen', 'Kautebaach', 'Wëlwerwolz', 'Drauffelt', 'Clierf'],
    minTunnels: 10, minCrossings: 3, lengthKm: [17, 24], minBridges: 8, viaduct: true,
  },
};
const MIN_SCENERY_ROADS = 20;       // real road polylines resolved for a route
const MIN_PATCH_BYTES = 20000;
const INDEX = JSON.parse(fs.readFileSync(new URL('../../pb/train-sim/data/stations/index-routes.json', import.meta.url), 'utf8')).stations;
const INITIAL_BUDGET_MB = { west: 1.2, south: 1.8, north: 2.2 };   // decoded bytes of data/stations + data/real at the start of a service (the old Mosel line: 1.4 MB)

export const flow = {
  name: 'train-sim-routes', fullChromium: true,
  async run(h) {
    const sim = await simOnPage(await h.context.newPage(), h.origin, { quality: 'high' });

    for (const [id, spec] of Object.entries(LINES)) {
      h.step(`${id}: the real line (stop list, geometry, scenery, station surroundings)`);
      await sim.start(id);
      const rep = await sim.evalGame(({ track }) => ({
        st: track.stations.map((s) => s.name), len: track.length, tunnels: track.tunnels.length, bridges: track.bridges.length, crossings: track.crossings.length,
        viaduct: track.bridges.some((b) => b.kind === 'viaduct' && b.h >= 20 && b.water), scenery: track.sceneryId, real: !!track.real,
        roads: track.real ? track.real.roads.length : 0, rivers: track.real ? track.real.water.length : 0, relief: track.real ? Math.round(Math.abs(track.real.reliefAt(track.length / 2).l) + Math.abs(track.real.reliefAt(track.length / 2).r)) : -1,
        patches: (track.surroundPatches || []).map((p) => p.name), sides: track.stations.map((s) => s.side),
      }));
      h.eq(rep.st, spec.stations, `${id}: the real stop list (${spec.stations.length} stops)`);
      h.expect(rep.len / 1000 >= spec.lengthKm[0] && rep.len / 1000 <= spec.lengthKm[1], `${id}: game length ${(rep.len / 1000).toFixed(1)} km (${spec.lengthKm.join(' - ')})`);
      h.expect(rep.real && rep.scenery === id && rep.roads >= MIN_SCENERY_ROADS && rep.rivers >= 1, `${id}: real scenery data attached (${rep.roads} roads, ${rep.rivers} water windows)`);
      h.expect(rep.tunnels >= spec.minTunnels && rep.crossings >= spec.minCrossings && rep.bridges >= (spec.minBridges || 0), `${id}: ${rep.tunnels} tunnels, ${rep.bridges} bridges, ${rep.crossings} level crossings from the real line`);
      if (spec.viaduct) h.expect(rep.viaduct, `${id}: the Pfaffenthal / Pulvermuehle viaduct over the Alzette is in (a high viaduct over water)`);
      const expectPatch = spec.stations.filter((n) => n !== 'Lëtzebuerg');
      const missing = expectPatch.filter((n) => !rep.patches.includes(n));
      h.eq(missing, [], `${id}: every Luxembourg station has its real surroundings patch`);
      const back = await (async () => { await sim.start(id + '~r'); return sim.evalGame(({ track }) => ({ n: track.stations.length, first: track.stations[0].name, last: track.stations[track.stations.length - 1].name })); })();
      h.eq([back.n, back.first, back.last], [spec.stations.length, spec.stations[spec.stations.length - 1], 'Lëtzebuerg'], `${id}~r: starts at ${back.first}, ${back.n} stations`);
    }

    h.step('stations without a photo model: platform layout from OSM (Mamer-Lycée: two side platforms)');
    await sim.start('west');
    const lay = await sim.evalGame(({ track }) => {
      const i = track.stations.findIndex((s) => s.name === 'Mamer-Lycée');
      const st = TS.osmStations ? TS.osmStations.layoutOf('Mamer-Lycée') : null;
      return { i, osm: !!st, plats: st ? st.plat.length : 0, model: !!(TS.realStations.get('Mamer-Lycée') && TS.realStations.get('Mamer-Lycée').osm) };
    });
    h.expect(lay.i === 2 && lay.osm && lay.plats === 2 && lay.model, `Mamer-Lycée uses the OSM layout (${lay.plats} platforms)`);

    h.step('download size: the cores of the route stations up front, the scenery halves of the patches streamed ahead of the train');
    const bytesOf = (rep, re) => rep.filter((e) => re.test(e.name)).reduce((t, e) => t + e.decoded, 0);
    for (const [id, spec] of Object.entries(LINES)) {
      const ctx = await h.context.browser().newContext({ viewport: { width: 1024, height: 768 } });      // clean cache: every byte of the start is measured
      await ctx.addInitScript(() => performance.setResourceTimingBufferSize(3000));
      const lazy = await simOnPage(await ctx.newPage(), h.origin, { quality: 'medium' });
      await lazy.start(id, 'emu', { lazy: true });
      await lazy.frames(30);
      const r0 = await lazy.page.evaluate(() => performance.getEntriesByType('resource').map((e) => ({ name: e.name, decoded: e.decodedBodySize || e.encodedBodySize || 0, t: e.startTime })));
      const keys = new Set(spec.stations.map((n) => INDEX[n]).filter(Boolean));     // only this route's patches (the menu backdrop loaded the first route's before)
      const keyOfUrl = (u) => (/\/stations\/([^/]+)\.[ch]\.json/.exec(u) || [])[1];
      const cores = r0.filter((e) => /\.c\.json/.test(e.name) && keys.has(keyOfUrl(e.name)));
      const heavies = r0.filter((e) => /\.h\.json/.test(e.name) && keys.has(keyOfUrl(e.name))).sort((a, b) => a.t - b.t);
      const real = r0.filter((e) => new RegExp('/data/real/' + id + '-').test(e.name));
      const sum = (l) => l.reduce((t, e) => t + e.decoded, 0);
      const blocking = sum(cores) + sum(real) + sum(heavies.slice(0, 1));
      console.log(`    ${id}: blocking start data ${(blocking / 1048576).toFixed(2)} MB = ${cores.length} cores ${(sum(cores) / 1024).toFixed(0)} kB + real data ${(sum(real) / 1024).toFixed(0)} kB + first scenery half ${(sum(heavies.slice(0, 1)) / 1024).toFixed(0)} kB; ${heavies.length} halves streamed in the first seconds (${(sum(heavies) / 1048576).toFixed(2)} MB)`);
      h.expect(cores.length === spec.stations.length - 1 && heavies.length >= 1 && heavies.length < (spec.stations.length - 1) / 2 + 1, `${id}: ${cores.length} cores up front, only ${heavies.length} of ${spec.stations.length - 1} scenery halves at the start`);
      h.expect(blocking <= INITIAL_BUDGET_MB[id] * 1048576, `${id}: blocking start data ${(blocking / 1048576).toFixed(2)} MB <= ${INITIAL_BUDGET_MB[id]} MB`);
      // the train drives on: the halves ahead stream in (2 at a time), the near ones are ready before the train arrives
      const mid = Math.round(await lazy.page.evaluate(() => __tsTest.trackInfo().length) * 0.45);
      await lazy.page.evaluate((s) => { __tsTest.placeAt(s, 0); }, mid);
      await lazy.frames(20);
      let ready = false;
      for (let k = 0; k < 40 && !ready; k++) {
        ready = await lazy.page.evaluate(() => { const t = __tsTest.trackInfo(); const b = t.base || t; const s = __tsTest.state().s; const near = (b.surroundPatches || []).filter((p) => Math.abs(p.sMid - s) < 1100); return near.length > 0 && near.every((p) => p.state === 'ready'); });
        if (!ready) { await lazy.frames(15); await lazy.page.waitForTimeout(150); }
      }
      h.expect(ready, `${id}: the patches within 1100 m of the train (s ${mid}) have their scenery after the jump`);
      await ctx.close();
    }

    h.step('a scenery half that cannot be fetched: driving goes on with the generic scenery (no hole, crossings kept)');
    {
      await h.context.route('**/data/stations/*.h.json*', (route) => route.abort());
      const bad = await simOnPage(await h.context.newPage(), h.origin, { quality: 'medium' });
      await bad.start('south', 'emu', { lazy: true });
      await bad.frames(20);
      await bad.page.evaluate(() => { const t = __tsTest.trackInfo(); __tsTest.placeAt(t.stations[7].platformStart - 200, 0); });
      await bad.frames(60);
      const st = await bad.page.evaluate(() => { const t = __tsTest.trackInfo(); const b = t.base || t; return { states: (b.surroundPatches || []).map((p) => p.state), phase: __tsTest.state().phase, inSurround: !!(b.inSurround && b.inSurround(0, 0)) }; });
      h.expect(st.phase === 'running', 'south: the game runs with failed scenery halves');
      h.expect(st.states.some((x) => x === 'failed') && !st.states.includes('ready'), `south: patches fall back (${st.states.filter((x) => x === 'failed').length} failed)`);
      const rep = await scanRoute(bad, 'south', { step: 600, rayStep: 120 });
      h.eq([rep.flaggedPoses.slice(0, 2), rep.rayFailures.filter((f) => f.kind !== 'step').slice(0, 2)], [[], []], 'south without any scenery half: no holes');
      h.expect(!bad.errors.some((e) => /pageerror/.test(e)), 'no page errors with failed scenery halves');
      await h.context.unroute('**/data/stations/*.h.json*');
      await bad.page.close();
    }

    h.step('hole detector: no hole, no pit, no missing terrain on north, south and west');
    for (const id of Object.keys(LINES)) {
      const rep = await scanRoute(sim, id, { step: 300, rayStep: 60 });
      h.eq([rep.flaggedPoses.slice(0, 2), rep.rayFailures.filter((f) => f.kind !== 'step').slice(0, 2)], [[], []], `${id}: ${rep.poses} render poses and ${rep.rays} rays, no holes`);
      const steps = rep.rayFailures.filter((f) => f.kind === 'step' && Math.abs(f.dy) > 1.5);
      h.eq(steps.slice(0, 2), [], `${id}: no terrain-function / mesh step above 1.5 m`);
    }
    const errs = sim.errors.filter((e) => !/404/.test(e));
    h.eq(errs.slice(0, 5), [], 'no console errors or warnings from the game');
    void MIN_PATCH_BYTES;
  },
};
runIfMain(import.meta.url, flow);
