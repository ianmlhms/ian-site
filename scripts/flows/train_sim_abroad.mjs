/* Zuchsimulator W3: the abroad routes metz (TER C40+ Luxembourg - Nancy), brussels (IC 16) and paris (TGV 803B): the real stop pattern (OSM route relations, REAL-LINES.md
 * "W3: abroad routes"), real OSM geometry and scenery (two-stage corridor fetch, build_real_route.py), the return direction, a download size comparable to the Luxembourg routes
 * and the hole detector.  Standalone game page; a few minutes.
 *   - stop lists in order, game length inside the pacing window, scenery data attached (roads, rivers, relief, land classes with the railway class)
 *   - tunnels / bridges / level crossings where the real line has them
 *   - the return direction (~r) starts at the other end with the same number of stations
 *   - data of the start of a service (data/real/<id>-*.json + the Luxembourg patch cores of the route) <= budget
 *   - hole scan: no hole, no pit, no missing terrain, no seam crack */
import { runIfMain } from './lib.mjs';
import { simOnPage } from '../zuch/zlib.mjs';
import { scanRoute } from '../zuch/hole_lib.mjs';

const LINES = {
  metz: {
    stations: ['Lëtzebuerg', 'Houwald', 'Bettembuerg', 'Hettange-Grande', 'Thionville', 'Uckange', 'Hagondange', 'Walygator Parc', 'Metz-Ville', 'Pagny-sur-Moselle', 'Pont-à-Mousson', 'Nancy-Ville'],
    lengthKm: [12, 22], minBridges: 4, minCrossings: 3, budgetMb: 1.75,
  },
  brussels: {
    stations: ['Lëtzebuerg', 'Arlon', 'Marbehan', 'Libramont', 'Jemelle', 'Marloie', 'Ciney', 'Namur', 'Gembloux', 'Ottignies', 'Bruxelles-Luxembourg', 'Bruxelles-Midi'],
    lengthKm: [14, 23], minBridges: 3, minTunnels: 8, minCrossings: 3, budgetMb: 1.8,      // the Brussels north-south tunnel + the Meuse valley tunnels
  },
  paris: {
    stations: ['Lëtzebuerg', 'Thionville', 'Metz-Ville', 'Champagne-Ardenne TGV', 'Paris-Est'],
    lengthKm: [16, 26], minBridges: 10, minTunnels: 2, minCrossings: 0, budgetMb: 1.9, hst: true,   // LGV Est: viaducts over the Meuse / Marne valleys
  },
};
const MIN_SCENERY_ROADS = 200;

export const flow = {
  name: 'train-sim-abroad', fullChromium: true,
  async run(h) {
    const sim = await simOnPage(await h.context.newPage(), h.origin, { quality: 'high' });
    for (const [id, spec] of Object.entries(LINES)) {
      h.step(`${id}: the real stop pattern, geometry and scenery`);
      await sim.start(id);
      const rep = await sim.evalGame(({ track }) => ({
        st: track.stations.map((s) => s.name), len: track.length, tunnels: track.tunnels.length, bridges: track.bridges.length, crossings: track.crossings.length,
        hst: track.def.kind === 'hst', cruise: track.def.cruise, scenery: track.sceneryId, real: !!track.real, roads: track.real ? track.real.roads.length : 0, rivers: track.real ? track.real.water.length : 0,
        railLand: track.real ? [0, 1, 2, 3].some((k) => { for (let s = 100; s < track.length; s += 97) if (track.real.landAt(s, (k - 1.5) * 12) === track.real.CLASS.rail) return true; return false; }) : false,
      }));
      h.eq(rep.st, spec.stations, `${id}: the real stop list (${spec.stations.length} stops)`);
      h.expect(rep.len / 1000 >= spec.lengthKm[0] && rep.len / 1000 <= spec.lengthKm[1], `${id}: game length ${(rep.len / 1000).toFixed(1)} km (${spec.lengthKm.join(' - ')})`);
      h.expect(rep.real && rep.scenery === id && rep.roads >= MIN_SCENERY_ROADS && rep.rivers >= 1, `${id}: real scenery data attached (${rep.roads} roads, ${rep.rivers} water windows)`);
      h.expect(rep.bridges >= (spec.minBridges || 0) && rep.crossings >= (spec.minCrossings || 0) && rep.tunnels >= (spec.minTunnels || 0), `${id}: ${rep.tunnels} tunnels, ${rep.bridges} bridges, ${rep.crossings} level crossings from OSM`);
      if (spec.hst) h.expect(rep.hst, `${id}: a high-speed route (hst, cruise ${rep.cruise} km/h)`);
      h.expect(rep.railLand, `${id}: railway land is drawn as ballast ground (class rail), not as fields`);
      const back = await (async () => { await sim.start(id + '~r'); return sim.evalGame(({ track }) => ({ n: track.stations.length, first: track.stations[0].name, last: track.stations[track.stations.length - 1].name })); })();
      h.eq([back.n, back.first, back.last], [spec.stations.length, spec.stations[spec.stations.length - 1], 'Lëtzebuerg'], `${id}~r: starts at ${back.first}, ${back.n} stations`);
    }

    h.step('download size at the start of a service (clean cache)');
    for (const [id, spec] of Object.entries(LINES)) {
      const ctx = await h.context.browser().newContext({ viewport: { width: 1024, height: 768 } });
      await ctx.addInitScript(() => performance.setResourceTimingBufferSize(3000));
      const lazy = await simOnPage(await ctx.newPage(), h.origin, { quality: 'medium' });
      await lazy.start(id, 'emu', { lazy: true });
      await lazy.frames(30);
      const r0 = await lazy.page.evaluate(() => performance.getEntriesByType('resource').map((e) => ({ name: e.name, decoded: e.decodedBodySize || e.encodedBodySize || 0 })));
      const bytes = r0.filter((e) => new RegExp('/data/real/' + id + '-|/data/stations/[^/]+\\.c\\.json').test(e.name)).reduce((t, e) => t + e.decoded, 0);
      console.log(`    ${id}: start data ${(bytes / 1048576).toFixed(2)} MB`);
      h.expect(bytes <= spec.budgetMb * 1048576, `${id}: start data ${(bytes / 1048576).toFixed(2)} MB <= ${spec.budgetMb} MB`);
      await ctx.close();
    }

    h.step('hole detector: no hole, no pit, no missing terrain on the abroad routes');
    for (const id of Object.keys(LINES)) {
      const rep = await scanRoute(sim, id, { step: 300, rayStep: 60 });
      h.eq([rep.flaggedPoses.slice(0, 2), rep.rayFailures.filter((f) => f.kind !== 'step').slice(0, 2)], [[], []], `${id}: ${rep.poses} render poses and ${rep.rays} rays, no holes`);
      h.eq(rep.rayFailures.filter((f) => f.kind === 'step' && Math.abs(f.dy) > 1.0).slice(0, 2), [], `${id}: no terrain-function / mesh step above 1.0 m`);
    }
    h.eq(sim.errors.filter((e) => !/404/.test(e)).slice(0, 5), [], 'no console errors or warnings from the game');
  },
};
runIfMain(import.meta.url, flow);
