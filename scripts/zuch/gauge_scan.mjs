/* Loading-gauge scan (W5 trackside sweep): everything inside the clearance of the train must be empty.
 *   node scripts/zuch/gauge_scan.mjs <routeId ...> [--step 12] [--window 400] [--out dir] [--root repo] [--quality medium]
 * Along the track (every --step metres, in windows of --window metres around the player so that the streamed chunks exist) rays run along the track over one step at
 * lateral offsets +-1.5 m (outer rail line of a double track: second track at +-4.5 m is scanned too) and heights 0.7 / 2.2 / 3.9 m above the rail head.  A mesh hit that is
 * not part of the allowed furniture (rails, sleepers, ballast, platforms, signals, masts, wires, tunnel / bridge structure, the crossing deck) is an obstruction:
 * trees, buildings, walls, fences, road signs, lamp posts, terrain humps in the way of the train.  Output: per route a list of { s, lat, up, what, dist } clusters. */
import fs from 'node:fs';
import path from 'node:path';
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const step = Number(flag('step', '12')); const win = Number(flag('window', '400')); const outDir = flag('out', ''); const root = flag('root', undefined); const quality = flag('quality', 'medium');
const routes = args.length ? args : ['west', 'south', 'north', 'east', 'wittlich', 'trier', 'metz', 'brussels', 'paris'];

const scan = ({ track, world, scene, THREE, camera }, { s0, s1, step }) => {
  const base = track.base || track;
  const rc = new THREE.Raycaster(); rc.camera = camera;
  const out = [];
  const X2 = (s) => (base.second ? base.second.lat(s) : 0);
  const names = (o) => { const a = []; for (let n = o; n && a.length < 4; n = n.parent) a.push(n.name || n.type); return a.join('<'); };
  for (let s = s0; s < s1; s += step) {
    const fa = base.frameAt(s); const fb = base.frameAt(s + step);
    if (base.inTunnel(s) || base.inTunnel(s + step)) continue;
    const lats = [-1.5, 1.5]; const x2 = X2(s); if (Math.abs(x2) > 2) { lats.push(x2 - 1.5, x2 + 1.5); }
    for (const lat of lats) for (const up of [0.7, 2.2, 3.9]) {
      const a = new THREE.Vector3().copy(fa.pos).addScaledVector(fa.right, lat); a.y += up;
      const b = new THREE.Vector3().copy(fb.pos).addScaledVector(fb.right, lat + (x2 && lat > 2 ? (X2(s + step) - x2) : 0)); b.y += up + (fb.pos.y - fa.pos.y) * 0;
      const dir = b.clone().sub(a); const len = dir.length(); dir.normalize();
      rc.set(a, dir); rc.far = len;
      const hits = rc.intersectObjects(scene.children, true).filter((h) => h.object.isMesh && h.object.visible && !(h.object.material && h.object.material.transparent) && h.distance <= len);
      // allowed furniture: the player's own train, the infra group (rails, ballast, sleepers, masts, wires, signals, crossing decks, tunnel / bridge structure), station groups
      // (platforms are the stations agent's area), the safety plane, vehicles on a crossing deck
      const bad = hits.filter((h) => { const c = names(h.object); return !/train:|train-sim-infra|^Mesh<landscape$|station|crossing-traffic|luxtram/.test(c) && !(h.object.parent && h.object.parent.name === 'landscape'); });
      if (bad.length) {
        const h = bad[0]; const chain = names(h.object);
        out.push({ s: Math.round(s + (h.distance / len) * step), lat, up, what: chain, inst: !!h.object.isInstancedMesh, y: Math.round(h.point.y * 10) / 10 });
      }
    }
  }
  return out;
};

const sim = await openSim({ quality, root });
let total = 0;
try {
  for (const route of routes) {
    await sim.start(route);
    const length = await sim.evalGame(({ track }) => (track.base || track).length);
    const all = [];
    for (let w0 = 0; w0 < length; w0 += win) {
      const mid = Math.min(length - 5, w0 + win / 2);
      await sim.page.evaluate((ts) => { __tsTest.placeAt(ts, 0); const w = __tsTest.internals().world; w.landscape.warm(ts); }, mid);
      await sim.frames(3);
      const res = await sim.evalGame(scan, { s0: w0, s1: Math.min(length, w0 + win), step });
      all.push(...res);
    }
    // cluster by (what, 40 m)
    const groups = new Map();
    all.forEach((h) => { const key = h.what + '@' + Math.round(h.s / 40); if (!groups.has(key)) groups.set(key, Object.assign({ n: 0 }, h)); groups.get(key).n += 1; });
    const list = Array.from(groups.values()).sort((a, b) => a.s - b.s);
    const kinds = {}; list.forEach((h) => { const k = h.what.split('<')[0] + '<' + (h.what.split('<')[1] || ''); kinds[k] = (kinds[k] || 0) + 1; });
    console.log(route.padEnd(10), 'hits', all.length, 'clusters', list.length, JSON.stringify(kinds));
    total += list.length;
    if (outDir) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, `gauge-${route}.json`), JSON.stringify(list, null, 1)); }
  }
  console.log('errors', sim.errors.filter((e) => !/404/.test(e)).slice(0, 5));
} finally { await sim.close(); }
