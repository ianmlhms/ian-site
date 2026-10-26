/* Hole detector for the Luxtram world (the rail one, hole_lib.mjs, only knows the procedural strip of the rail routes).
 *   node scripts/zuch/tram_hole_scan.mjs [routeId=luxtram] [--step 150] [--from 40] [--to N] [--out dir] [--root repo]
 *  1. RENDER: from poses along the line (cab, both sides looking down, high, back) the scene is rendered into a small target with a magenta clear colour,
 *     the sky / hills / safety plane / old far strip hidden (landscape.setHoleMode).  A magenta pixel more than 1.8 degrees below the horizon whose
 *     ray meets the tram world's ground (groundAt) within NEAR_M metres is a HOLE: the tram tiles streamed around the train (ahead 650 - 900, behind 200 - 260 m) cover that.
 *  2. RAYS: vertical rays on a grid across the tiles must hit a tile mesh (or the tunnel cover / bridge deck there) and stay within RAY_TOL_M of the DEM-blended ground.
 * Findings print as `s`, pose and the first world position; flagged poses are saved as screenshots with --out. */
import fs from 'node:fs';
import path from 'node:path';
import { openSim } from './zlib.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf('--' + name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const STEP = Number(flag('step', '150'));
const FROM = Number(flag('from', '40'));
const TO = Number(flag('to', 'Infinity'));
const OUT = flag('out', '');
const ROOT = flag('root', undefined);
const RAY_STEP = Number(flag('raystep', '40'));
const routeId = args[0] || 'luxtram';

const HOLE_BELOW_HORIZON_DEG = 1.8;
const NEAR_M = 150;   // the detailed tiles are a band around the line: beyond ~150 m sideways the coarse far tiles (hidden in this check) are the ground
const RAY_TOL_M = 1.5;   // mesh triangulation vs the bilinear DEM on steep LiDAR edges (building sites, walls) differs by up to a metre; not a hole
const MIN_HOLE_SAMPLES = 2;
const RT_W = 256; const RT_H = 144;
const POSES = [
  { name: 'cab', lat: 0, up: 3.1, yaw: 0, pitch: -0.06, fov: 75 },
  { name: 'left-down', lat: -6, up: 3.5, yaw: 0.75, pitch: -0.3, fov: 80 },
  { name: 'right-down', lat: 6, up: 3.5, yaw: -0.75, pitch: -0.3, fov: 80 },
  { name: 'high', lat: 0, up: 30, yaw: 0, pitch: -0.55, fov: 80 },
  { name: 'back', lat: 0, up: 3.2, yaw: Math.PI, pitch: -0.1, fov: 75 },
];

const sim = await openSim({ quality: 'high', root: ROOT });
const report = { route: routeId, poses: 0, flagged: [], rays: 0, rayFailures: [] };
try {
  await sim.start(routeId, 'tram');
  const length = await sim.evalGame(({ track }) => track.length);
  console.log(`${routeId}: length ${Math.round(length)} m`);
  /* places the train at s and waits until every tile of the stream window (detailed + far) has arrived and is built, like a player standing there for a while */
  const warmTo = (s) => sim.page.evaluate(async (ts) => {
    __tsTest.placeAt(ts, 0);
    const w = __tsTest.internals().world; const lw = w.landscape.luxtramWorld;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) {
      w.landscape.warm(ts);
      await frame();
      let pending = 0;
      for (const t of lw.tiles.values()) { if (Math.abs(t.info.s - ts) < 640 && (t.state === 'loading' || !t.built)) pending += 1; }
      for (const f of lw.far.values()) { if (f.state === 'loading') pending += 1; }
      if (i > 3 && !pending) break;
      if (performance.now() - t0 > 30000) break;
    }
    await frame(); await frame();
  }, s);
  const renderCheck = (s) => sim.page.evaluate(({ s, poses, W, H, deg, minHoles, nearM }) => {
      const { scene, camera, renderer, world, THREE } = __tsTest.internals();
      const track = __tsTest.trackInfo();
      const ls = world.landscape; const lw = ls.luxtramWorld;
      ls.setHoleMode(true);
      const hiddenFar = []; lw.far.forEach((fr) => { if (fr.group && fr.group.visible) { fr.group.visible = false; hiddenFar.push(fr.group); } });   // the coarse far ground under the detailed tiles must not hide a gap in them
      const rt = new THREE.WebGLRenderTarget(W, H);
      const buf = new Uint8Array(W * H * 4);
      const oldClear = renderer.getClearColor(new THREE.Color()).getHex(); const oldAlpha = renderer.getClearAlpha(); const oldBg = scene.background;
      scene.background = null; renderer.setClearColor(0xff00ff, 1);
      const out = [];
      const cam = camera.clone();
      const sinLimit = -Math.sin(deg * Math.PI / 180);
      const f = track.frameAt(s);
      const v = new THREE.Vector3();
      const covered = lw.underpasses.some((u) => u.kind === 'cover' && s > u.s0 - 3 && s < u.s1 + 3);   // a camera beside the line inside a tunnel box stands in the wall: only the cab poses make sense there
      for (const p of poses) {
        if (covered && Math.abs(p.lat) > 0.5) continue;
        const pos = new THREE.Vector3().copy(f.pos).addScaledVector(f.right, p.lat); pos.y += p.up;
        { const g = lw.groundAt(pos.x, pos.z); if (g === g && pos.y < g + 0.3 && Math.abs(p.lat) > 0.5) continue; }   // a camera beside the line that stands inside a bank / cutting wall sees the back of the ground
        const t = f.tangent.clone(); t.y = 0; t.normalize();
        const dir = t.applyAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw); dir.y = Math.tan(p.pitch);
        cam.position.copy(pos); cam.fov = p.fov; cam.aspect = W / H; cam.near = camera.near; cam.far = camera.far; cam.updateProjectionMatrix();
        cam.lookAt(pos.clone().add(dir)); cam.updateMatrixWorld(true);
        renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
        const inv = cam.projectionMatrixInverse; const mw = cam.matrixWorld;
        let count = 0; let sampled = 0; let holes = 0; let first = null; let maxD = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (!(buf[i] > 235 && buf[i + 1] < 40 && buf[i + 2] > 235)) continue;
          v.set((x + 0.5) / W * 2 - 1, (y + 0.5) / H * 2 - 1, 0.5).applyMatrix4(inv).applyMatrix4(mw).sub(cam.position).normalize();
          if (!(v.y < sinLimit)) continue;
          count += 1;
          if ((x * 7 + y * 13) % 5 !== 0 || sampled >= 120) continue;
          sampled += 1;
          // march the ray to the tram world's ground
          let hitD = -1;
          for (let d = 1; d < 400; d += d < 60 ? 1.5 : 4) {
            const px = pos.x + v.x * d; const pz = pos.z + v.z * d; const py = pos.y + v.y * d;
            const g = lw.groundAt(px, pz);
            if (g === g && py < g) { hitD = d; if (!first) first = { x: Math.round(px), z: Math.round(pz), y: Math.round(g), d: Math.round(d), px: [x, y] }; break; }
          }
          if (hitD > 0 && hitD < nearM) { holes += 1; maxD = Math.max(maxD, hitD); }
        }
        if (holes >= minHoles) out.push({ pose: p.name, count, holes, first, maxD: Math.round(maxD) });
      }
      renderer.setRenderTarget(null); renderer.setClearColor(oldClear, oldAlpha); scene.background = oldBg; rt.dispose();
      ls.setHoleMode(false); hiddenFar.forEach((g) => { g.visible = true; });
      return out;
    }, { s, poses: POSES, W: RT_W, H: RT_H, deg: HOLE_BELOW_HORIZON_DEG, minHoles: MIN_HOLE_SAMPLES, nearM: NEAR_M });
  if (args.includes('--selftest')) {
    await warmTo(1000);
    await sim.page.evaluate(() => { const { world } = __tsTest.internals(); const lw = world.landscape.luxtramWorld; const f = __tsTest.trackInfo().frameAt(1060); const t = lw.tileOf(f.pos.x + f.right.x * 20, f.pos.z + f.right.z * 20); t.mesh.visible = false; });
    const r = await renderCheck(1000);
    console.log('selftest (one terrain tile hidden): ' + (r.length ? 'detected ' + JSON.stringify(r.map((x) => [x.pose, x.holes])) : 'NOT DETECTED'));
    process.exit(r.length ? 0 : 1);
  }
  for (let s = FROM; s < Math.min(TO, length - 30); s += STEP) {
    await warmTo(s);
    await sim.frames(2);
    const res = await renderCheck(s);
    report.poses += POSES.length;
    res.forEach((r) => { report.flagged.push({ s, ...r }); console.log(`  hole pose s=${s} ${r.pose}: ${r.holes} px (${r.count} magenta), first ${JSON.stringify(r.first)}`); });
  }
  for (let s = 20; s < length - 20; s += RAY_STEP) {
    await warmTo(s);
    const res = await sim.page.evaluate(({ s, tol }) => {
      const { world, THREE } = __tsTest.internals();
      const track = __tsTest.trackInfo();
      const lw = world.landscape.luxtramWorld;
      const rc = new THREE.Raycaster(); const down = new THREE.Vector3(0, -1, 0);
      const f = track.frameAt(s + 0.37);
      const lats = []; for (let m = 8; m <= 120; m += 16) { lats.push(m, -m); }
      const near = (b) => (b || []).some((x) => s > x.s0 - 60 && s < x.s1 + 60);
      const skip = near(track.bridges) || near(lw.underpasses);
      const fails = []; let n = 0;
      for (const lat of lats) {
        if (skip && Math.abs(lat) < 50) continue;
        const x = f.pos.x + f.right.x * lat; const z = f.pos.z + f.right.z * lat;
        const t = lw.tileOf(x, z);
        if (!t || !t.built || !t.mesh) continue;
        const y = lw.groundAt(x, z);
        if (!(y === y)) { fails.push({ s, lat, kind: 'nan-ground' }); continue; }
        rc.set(new THREE.Vector3(x, y + 80, z), down);
        t.mesh.updateMatrixWorld(true);
        const hit = rc.intersectObject(t.mesh, false)[0];
        n += 1;
        if (!hit) fails.push({ s, lat, kind: 'miss', x: Math.round(x), z: Math.round(z) });
        else if (Math.abs(hit.point.y - y) > tol) fails.push({ s, lat, kind: 'step', dy: Math.round((hit.point.y - y) * 100) / 100, x: Math.round(x), z: Math.round(z) });
      }
      return { n, fails };
    }, { s, tol: RAY_TOL_M });
    report.rays += res.n;
    res.fails.forEach((r) => report.rayFailures.push(r));
  }
} finally { await sim.close(); }
console.log(`${routeId}: ${report.poses} poses, ${report.flagged.length} flagged; ${report.rays} rays, ${report.rayFailures.length} failures`);
report.rayFailures.slice(0, 30).forEach((f) => console.log('   ray', JSON.stringify(f)));
if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, `${routeId}-holes.json`), JSON.stringify(report, null, 1)); }
const bad = report.flagged.length + report.rayFailures.length;
console.log(bad ? `PROBLEMS: ${bad}` : 'no holes found');
process.exit(bad ? 1 : 0);
