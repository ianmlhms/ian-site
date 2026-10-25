/* node scripts/zuch/side_probe.mjs <routeId~r?>: station side vs built platform world side */
import { openSim } from './zlib.mjs';
const sim = await openSim({ quality: 'low' });
try {
  const r = await sim.page.evaluate((id) => {
    const r = TS.track.build(TS.routes.get(id)); const sc = new THREE.Scene();
    const inf = TS.infra.create(sc, r, { quality: 'low' }); const rep = inf.stationReport(); inf.dispose();
    return rep.map((b, i) => ({ name: r.stations[i].name, side: r.stations[i].side, lat: b.playerWorldLat === null ? null : Math.round(b.playerWorldLat * 10) / 10, bad: b.playerWorldLat === null || Math.sign(b.playerWorldLat) !== (r.stations[i].side === 'right' ? 1 : -1) }));
  }, process.argv[2] || 'east~r');
  console.log(JSON.stringify(r.filter((x) => x.bad)), r.length);
} finally { await sim.close(); }
