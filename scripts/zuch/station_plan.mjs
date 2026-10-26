/* Plan view (top-down, travel direction to the RIGHT of the image, left of travel at the top) of a station with the outlines of the real LOD2 station buildings of its patch
 * (red = flagged station building, yellow = other buildings called "other" within the view) drawn above the photo model, to compare the side and position of the model hall.
 *   node scripts/zuch/station_plan.mjs <outPng> <routeId> <stationName> [--span 200] [--shift 0] [--lod2 1] [--quality medium] */
import { openSim } from './zlib.mjs';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const span = Number(flag('span', '200')); const shift = Number(flag('shift', '0')); const lod2 = flag('lod2', '0') === '1'; const quality = flag('quality', 'medium');
const [out, routeId, name] = args;
const sim = await openSim({ quality });
try {
  if (lod2) await sim.page.evaluate(() => { window.TS.debugStationLod2 = true; });
  await sim.start(routeId);
  const info = await sim.evalGame(({ track }, n) => { const i = track.stations.findIndex((x) => x.name === n); const s = track.stations[i]; return { i, mid: (s.platformStart + s.platformEnd) / 2, side: s.side === 'right' ? 1 : -1 }; }, name);
  const mid = info.mid + shift;
  await sim.view({ s: mid, lat: 0, up: 100, target: { s: mid - 10, lat: 0, up: 0 }, trainS: mid - 400, settle: 30 });
  const res = await sim.page.evaluate(async ({ name, mid, span, i }) => {
    const { THREE, scene, camera } = __tsTest.internals(); const t = __tsTest.trackInfo(); const b = t.base || t;
    const patch = (b.surroundPatches || []).find((p) => p.name === name);
    const key = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
    const h = await (await fetch('/pb/train-sim/data/stations/' + key + '.h.json')).json();
    const sMid = patch ? patch.sMid : mid;
    const grp = new THREE.Group(); const out = [];
    const mk = (ring, color, y) => {
      const pts = ring.concat([ring[0]]).map((p) => { const f = t.frameAt(sMid - p[1]); return new THREE.Vector3(f.pos.x + f.right.x * p[0], f.pos.y + y, f.pos.z + f.right.z * p[0]); });
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false })); l.renderOrder = 999; grp.add(l);
    };
    (h.buildings || []).forEach((bd) => {
      const zs = bd.ground.map((p) => p[1]); const xs = bd.ground.map((p) => p[0]);
      if (Math.min(...zs) > span || Math.max(...zs) < -span || Math.min(...xs) > 70 || Math.max(...xs) < -70) return;
      if (bd.station) { mk(bd.ground, 0xff2020, 4); out.push({ x: [Math.min(...xs), Math.max(...xs)].map((v) => +v.toFixed(1)), z: [Math.min(...zs), Math.max(...zs)].map((v) => +v.toFixed(1)) }); }
      else if (bd.kind === 'other' || bd.kind === 'industrial' || bd.kind === 'station') mk(bd.ground, 0xffd000, 4);
    });
    // scale marks every 20 m along z (white; blue = z 0 = patch middle, z < 0 = ahead = image right) and lat +-20 m (green)
    for (let z = -100; z <= 100; z += 20) mk([[-34, z], [34, z]], z === 0 ? 0x30a0ff : 0xffffff, 4);
    [-20, 20].forEach((x) => mk([[x, -100], [x, 100]], 0x20e020, 4));
    scene.add(grp);
    const f = t.frameAt(mid); const tn = f.tangent.clone(); tn.y = 0; tn.normalize();
    camera.up.set(tn.z, 0, -tn.x);
    const H = span * 0.9;
    __tsTest.setFreeCam({ pos: [f.pos.x, f.pos.y + H, f.pos.z], look: [f.pos.x, f.pos.y, f.pos.z], fov: 50 });
    return { sMid, out };
  }, { name, mid: mid, span, i: info.i });
  await sim.frames(20);
  await sim.shot(out);
  console.log(JSON.stringify(info), JSON.stringify(res));
} finally { await sim.close(); }
