/* Luxtram traffic probe (W5 zroads): no road vehicle ever drives on or stops in the tram's rails away from a level crossing / shared street section.
 *   node scripts/zuch/tram_traffic_probe.mjs [routeId=luxtram-stad] [--spots 12] [--secs 8] [--root <repo copy>]
 * static   every drawn ground road (TS.luxTraffic.last.roadLines) is sampled every 1.5 m; a point inside the rail corridor (|lat| < RAIL_HALF of the player's or the
 *          opposite track, at about the rail's height) that lies outside the road's `cross` (level crossing) and `along` (road beside / on the rails) ranges
 *          is a road drawn over the rails without a crossing -> "road-over-rails"
 * dynamic  the player is put at SPOTS places along the line; the traffic runs for SECS seconds; every 250 ms each shown vehicle's centre and four corners
 *          (cars() + wheelPoints()) are tested against the same corridor; a vehicle with a corner in it beyond the crossing margin -> "car-on-rails"
 * Exit 1 when something is flagged. */
import fs from 'node:fs';
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const spots = Number(flag('spots', '12'));
const secs = Number(flag('secs', '8'));
const root = flag('root', undefined);
const jsonOut = flag('json', '');
const routeId = args[0] || 'luxtram-stad';

const RAIL_HALF = 1.4;      // the tram's swept half width (luxtram-traffic.js ENV_HALF)
const XING_MARGIN = 3;      // a level crossing / shared stretch: the same margin the traffic guards leave free
const HEIGHT = 3;           // a road under / over a tram viaduct is no conflict

const staticScan = ({ world }, [half, margin, height]) => {
  const tr = world.track; const lt = TS.luxTraffic.last;
  if (!lt) return { error: 'no luxTraffic.last' };
  const hasOpp = !!(tr.opposite && tr.opposite.has);
  const lines = lt.roadLines(1.5);
  const flags = []; let points = 0;
  for (const r of lines) {
    if (r.bridge) continue;
    const step = r.len / Math.max(1, r.pts.length - 1);
    let hit = null;
    r.pts.forEach((p, k) => {
      points += 1;
      const t = k * step;
      if (r.cross.some((q) => t > q[0] - margin && t < q[1] + margin) || r.along.some((q) => t > q[0] - 2 && t < q[1] + 2)) return;
      const q = tr.nearest(p[0], p[1]);
      if (!q || q.d > 16 || q.d > Math.abs(q.lat) + 0.6) return;
      if (tr.bridgeAt && tr.bridgeAt(q.s)) return;
      const own = Math.abs(q.lat) < half;
      const opp = hasOpp && tr.opposite.has(q.s) && Math.abs(q.lat - tr.opposite.latAt(q.s)) < half;
      if ((own || opp) && !hit) hit = { road: r.i, cls: r.cls, s: Math.round(q.s), lat: Math.round(q.lat * 10) / 10, x: Math.round(p[0]), z: Math.round(p[1]), t: Math.round(t), len: Math.round(r.len) };
    });
    if (hit) flags.push(Object.assign({ kind: 'road-over-rails' }, hit));
  }
  return { roads: lines.length, points, flags };
};

const sampleCars = ({ world }, [half, margin]) => {
  const tr = world.track; const lt = TS.luxTraffic.last;
  const hasOpp = !!(tr.opposite && tr.opposite.has);
  const cs = lt.cars(); const wps = lt.wheelPoints(); const flags = [];
  cs.forEach((c, i) => {
    if (c.onCross) return;
    const pts = [[c.x, c.z]].concat(wps[i] ? wps[i].pts.map((q) => [q[0], q[2]]) : []);
    for (const [x, z] of pts) {
      const q = tr.nearest(x, z);
      if (!q || q.d > 16 || q.d > Math.abs(q.lat) + 0.6) continue;
      if (Math.abs(c.y - q.y) > 3) continue;
      const own = Math.abs(q.lat) < half; const opp = hasOpp && tr.opposite.has(q.s) && Math.abs(q.lat - tr.opposite.latAt(q.s)) < half;
      if (own || opp) { flags.push({ kind: 'car-on-rails', type: c.type, s: Math.round(q.s), lat: Math.round(q.lat * 10) / 10, v: Math.round(c.v * 10) / 10, road: c.rd, x: Math.round(x), z: Math.round(z) }); break; }
    }
  });
  return { n: cs.length, flags };
};

const sim = await openSim({ quality: 'medium', root });
const report = { route: routeId, static: null, dynamic: [] };
let bad = 0;
try {
  await sim.start(routeId, 'tram');
  const length = await sim.evalGame(({ track }) => track.length);
  const staticFlags = []; const staticSeen = new Set(); let roadsSeen = 0; let pointsSeen = 0;
  const scanStatic = async (where) => {
    const st = await sim.evalGame(staticScan, [RAIL_HALF, XING_MARGIN, HEIGHT]);
    if (st.error) throw new Error(st.error);
    roadsSeen += st.roads; pointsSeen += st.points;
    st.flags.forEach((f) => { const key = Math.round(f.x / 8) + ':' + Math.round(f.z / 8); if (staticSeen.has(key)) return; staticSeen.add(key); staticFlags.push(f); console.log('   road-over-rails', where, JSON.stringify(f)); });
  };
  await scanStatic('start');
  const seen = new Set(); let carsSeen = 0;
  for (let k = 0; k < spots; k++) {
    const s = Math.round(60 + (length - 120) * (k + 0.5) / spots);
    await sim.page.evaluate((s0) => { __tsTest.placeAt(s0, 0); }, s);
    await sim.page.waitForFunction(() => { const l = __tsTest.internals().world.landscape; return !l.pendingAhead || l.pendingAhead() === 0; }, null, { timeout: 90000 }).catch(() => {});
    await scanStatic('s ' + s);
    const t0 = Date.now(); const here = [];
    while (Date.now() - t0 < secs * 1000) {
      await sim.page.waitForTimeout(250);
      const r = await sim.evalGame(sampleCars, [RAIL_HALF, XING_MARGIN]);
      carsSeen += r.n;
      r.flags.forEach((f) => { const key = f.road + ':' + Math.round(f.s / 10); if (!seen.has(key)) { seen.add(key); here.push(f); } });
    }
    report.dynamic.push({ s, flags: here });
    bad += here.length;
    console.log('spot', s, 'flags', here.length);
    here.slice(0, 5).forEach((f) => console.log('   ', JSON.stringify(f)));
  }
  report.static = { roads: roadsSeen, points: pointsSeen, flags: staticFlags }; bad += staticFlags.length;
  console.log('static: roads scanned (all spots)', roadsSeen, 'points', pointsSeen, 'flags', staticFlags.length);
  console.log('vehicle samples', carsSeen);
  console.log('errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 5));
} finally { await sim.close(); }
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1));
console.log(bad ? 'FAIL: ' + bad + ' roads over the rails / vehicles on the rails' : 'PASS: no road over the rails without a crossing, no vehicle on the rails');
process.exit(bad ? 1 : 0);
