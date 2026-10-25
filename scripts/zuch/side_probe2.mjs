import { openSim } from './zlib.mjs';
const sim = await openSim({ quality: 'low' });
try {
  const r = await sim.page.evaluate(([id, name]) => {
    const r = TS.track.build(TS.routes.get(id)); const sc = new THREE.Scene();
    const inf = TS.infra.create(sc, r, { quality: 'low' }); const rep = inf.stationReport(); inf.dispose();
    const i = r.stations.findIndex((s) => s.name === name); const st = r.stations[i];
    return { st: { side: st.side, s: st.s, ps: st.platformStart, pe: st.platformEnd }, rep: rep[i], pinfo: r.platformInfo(i) };
  }, [process.argv[2], process.argv[3]]);
  console.log(JSON.stringify(r));
} finally { await sim.close(); }
