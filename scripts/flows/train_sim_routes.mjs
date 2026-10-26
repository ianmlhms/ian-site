/* Zuchsimulator W2c: the real single-line routes north (CFL line 10), south (line 60) and west (line 50) - verified stop lists, real OSM geometry and scenery, the
 * real station surroundings and platform layouts, and the hole detector.  Standalone game page; about four minutes.
 *   - stop lists = the real RB service of the line (OSM route relations, REAL-LINES.md "W2c"), in order, with the right length
 *   - the real scenery data is attached (rivers, relief, land classes, roads) and the route has the tunnels / viaducts the real line has
 *   - every Luxembourg station except the Gare Centrale has its real surroundings patch; stations without a photo model get their platform layout from OSM
 *   - the return direction (~r) starts at the other end with the same number of stations
 *   - hole scan on all three routes: no hole, no pit, no missing terrain, no seam crack */
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
