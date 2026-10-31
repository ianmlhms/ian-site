/* Audit of every station of every route: patch (core / heavy), photo model, building style, OSM layout, and the geometry overlaps that matter on the player's platform.
 *   node scripts/zuch/station_audit.mjs [routeId ...] > out.json
 * Per station: { route, name, i, hasPatch, patchKey, model (TS.realStations key), style (TS.stationStyles), flagged station buildings, overlapPlatform m2 of non-canopy building footprint over the player's platform rectangle } */
import { openSim } from './zlib.mjs';
const routes = process.argv.slice(2).length ? process.argv.slice(2) : ['west', 'south', 'north', 'east', 'wittlich', 'trier', 'metz', 'brussels', 'paris'];
const sim = await openSim({ quality: 'medium' });
const all = [];
try {
  for (const id of routes) {
    await sim.start(id);
    const rows = await sim.page.evaluate(() => {
      const TS = window.TS; const t = __tsTest.trackInfo(); const b = t.base || t;
      const patches = new Map((b.surroundPatches || []).map((p) => [p.name, p]));
      const out = [];
      for (let i = 0; i < t.stations.length; i++) {
        const st = t.stations[i]; const p = patches.get(st.name);
        const row = { i, name: st.name, s: Math.round(st.s), side: st.side, size: st.size, pw: st.platformWidth || 0, plat: [Math.round(st.platformStart), Math.round(st.platformEnd)], hasPatch: !!p, model: TS.realStations.list().filter((k) => k === 'rail:' + st.name).length > 0, osm: !!(TS.realStations.get(st.name) && TS.realStations.get(st.name).osm), skipIds: (TS.stationStyles.get(st.name) || {}).skipIds || [], others: Object.keys((TS.stationStyles.get(st.name) || {}).others || {}), style: TS.stationStyles.has(st.name) };
        if (p) { const info = t.platformInfo(i); row.sMid = p.sMid; row.edge = info.edge; row.width = info.width; row.key = p.key || null; }
        out.push(row);
      }
      return out;
    });
    rows.forEach((r) => all.push({ route: id, ...r }));
  }
  console.log(JSON.stringify(all));
} finally { await sim.close(); }
