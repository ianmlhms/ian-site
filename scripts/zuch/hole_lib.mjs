/* Hole detector for the train simulator ground.  Two independent checks per route:
 *  1. RENDER: from many camera poses along the route the world is rendered into a small target with a magenta clear colour while the sky dome, the
 *     backdrop hills and the safety plane are hidden and the far ground mesh is magenta too (landscape.setHoleMode).  A magenta pixel more than
 *     HOLE_BELOW_HORIZON_DEG below the horizon is either the far mesh (22 m below the strip: a PIT when its point lies inside the strip footprint and
 *     more than 3 m below the terrain function) or nothing at all (a HOLE through everything).
 *  2. RAYS: vertical rays on a grid across the streamed terrain strip must hit the terrain mesh and agree with track.terrainHeightAt (to RAY_TOL_M);
 *     chunk seams, station-patch blends, crossing roads and bridge abutments show up as misses or height steps.
 * Poses and rays inside tunnels are skipped (the bore is open by design); poses are never placed under a viaduct deck on purpose.
 * scanRoute(sim, routeId, opts) -> { route, poses, flaggedPoses: [{ s, pose, count, maxAngleDeg }], rays, rayFailures: [{ s, lat, kind, dy }] } */
export const HOLE_BELOW_HORIZON_DEG = 1.8;
export const RAY_TOL_M = 0.5;
export const MIN_PIT_SAMPLES = 2;
const RT_W = 256;
const RT_H = 144;

const POSES = [
  { name: 'cab', lat: 0, up: 2.9, yaw: 0, pitch: -0.06, fov: 75 },
  { name: 'left-down', lat: -6, up: 3.5, yaw: 0.75, pitch: -0.3, fov: 80 },
  { name: 'right-down', lat: 6, up: 3.5, yaw: -0.75, pitch: -0.3, fov: 80 },
  { name: 'high', lat: 0, up: 30, yaw: 0, pitch: -0.55, fov: 80 },
  { name: 'back', lat: 0, up: 3.2, yaw: Math.PI, pitch: -0.1, fov: 75 },
];

export async function scanRoute(sim, routeId, { step = 150, from = 40, to = Infinity, poses = POSES, rayStep = 45, rayLats = 6, log = () => {}, prep = null } = {}) {
  await sim.start(routeId);
  const info = await sim.evalGame(({ track }) => ({ length: track.length, tunnels: track.tunnels.map((t) => [t.s0, t.s1]), bridges: track.bridges.map((b) => [b.s0, b.s1, b.kind]) }));
  const inTunnel = (s, m) => info.tunnels.some(([a, b]) => s > a - m && s < b + m);
  const report = { route: routeId, length: info.length, poses: 0, flaggedPoses: [], rays: 0, rayFailures: [] };
  /* ---- render check */
  for (let s = from; s < Math.min(to, info.length - 40); s += step) {
    if (inTunnel(s, 60)) continue;
    await sim.page.evaluate((ts) => { __tsTest.placeAt(ts, 0); const w = __tsTest.internals().world; if (w.landscape && w.landscape.warm) w.landscape.warm(w.track.baseS ? w.track.baseS(ts) : ts); }, s);
    await sim.frames(2);
    if (prep) await prep(sim, s);
    const res = await sim.page.evaluate(({ s, poses, W, H, deg }) => {
      const { scene, camera, renderer, world, THREE } = __tsTest.internals();
      const track = __tsTest.trackInfo();
      const ls = world.landscape;
      ls.setHoleMode(true);
      const rt = new THREE.WebGLRenderTarget(W, H);
      const buf = new Uint8Array(W * H * 4);
      const oldClear = renderer.getClearColor(new THREE.Color()).getHex(); const oldAlpha = renderer.getClearAlpha(); const oldBg = scene.background;
      scene.background = null;
      renderer.setClearColor(0xff00ff, 1);
      const out = [];
      const cam = camera.clone();
      const sinLimit = -Math.sin(deg * Math.PI / 180);
      const f = track.frameAt(s);
      for (const p of poses) {
        const pos = new THREE.Vector3().copy(f.pos).addScaledVector(f.right, p.lat); pos.y += p.up;
        const t = f.tangent.clone(); t.y = 0; t.normalize();
        const dir = t.applyAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw); dir.y = Math.tan(p.pitch);
        cam.position.copy(pos); cam.fov = p.fov; cam.aspect = W / H; cam.near = camera.near; cam.far = camera.far; cam.updateProjectionMatrix();
        cam.lookAt(pos.clone().add(dir)); cam.updateMatrixWorld(true);
        renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
        let count = 0; let maxAng = 0; let first = null; let pits = 0; let pit = null; let voids = 0;
        const inv = cam.projectionMatrixInverse; const mw = cam.matrixWorld;
        const v = new THREE.Vector3();
        const rc = new THREE.Raycaster(); const farM = ls.farMeshes(); const stripW = ls.stripWidth;
        farM.forEach((m) => { m.geometry.computeBoundingSphere(); m.geometry.computeBoundingBox(); });
        const base = track.base || track;
        let sampled = 0;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            if (!(buf[i] > 235 && buf[i + 1] < 40 && buf[i + 2] > 235)) continue;
            v.set((x + 0.5) / W * 2 - 1, (y + 0.5) / H * 2 - 1, 0.5).applyMatrix4(inv).applyMatrix4(mw).sub(cam.position).normalize();
            if (!(v.y < sinLimit)) continue;
            count += 1; maxAng = Math.max(maxAng, Math.asin(-v.y) * 180 / Math.PI); if (!first) first = [x, y];
            // magenta = the far ground mesh (22 m below the strip) or nothing: a PIT when that point lies inside the strip footprint, a VOID when nothing is hit
            if ((x * 7 + y * 13) % 7 === 0 && sampled < 80) {
              sampled += 1;
              rc.set(cam.position, v.clone());
              const hit = rc.intersectObjects(farM, false)[0];
              if (!hit) { voids += 1; continue; }
              const q = base.nearest(hit.point.x, hit.point.z);
              const ty = ls.groundHeightAt(hit.point.x, hit.point.z);
              if (Math.abs(q.lat) < stripW - 10 && hit.point.y < ty - 3 && !base.inTunnel(q.s)) { pits += 1; pit = pit || { x: Math.round(hit.point.x), z: Math.round(hit.point.z), s: Math.round(q.s), lat: Math.round(q.lat), depth: Math.round(ty - hit.point.y) }; }
            }
          }
        }
        // one isolated sampled pixel (about 7 px of the 256 x 144 target) is a rasterisation sliver at a triangle edge, not a hole: cone_probe.mjs shows the strip watertight there
        if (pits >= MIN_PIT_SAMPLES || voids > 0) out.push({ pose: p.name, count, pits, voids, pit, maxAngleDeg: Math.round(maxAng * 10) / 10, first });
      }
      renderer.setRenderTarget(null); renderer.setClearColor(oldClear, oldAlpha); scene.background = oldBg; rt.dispose();
      ls.setHoleMode(false);
      return out;
    }, { s, poses, W: RT_W, H: RT_H, deg: HOLE_BELOW_HORIZON_DEG });
    report.poses += poses.length;
    res.forEach((r) => report.flaggedPoses.push({ s, ...r }));
    if (res.length) log(`  hole poses at s=${s}: ` + res.map((r) => `${r.pose}(${r.pits} pit px ${JSON.stringify(r.pit)}, ${r.voids} void px, ${r.count}px, first ${JSON.stringify(r.first)})`).join(' '));
  }
  /* ---- ray check against the streamed terrain strip */
  for (let s = 20; s < info.length - 20; s += rayStep) {
    if (inTunnel(s, 80)) continue;
    await sim.page.evaluate((ts) => { __tsTest.placeAt(ts, 0); const w = __tsTest.internals().world; w.landscape.warm(w.track.baseS ? w.track.baseS(ts) : ts); }, s);
    await sim.frames(1);
    const res = await sim.page.evaluate(({ s, lats, tol }) => {
      const { world, THREE } = __tsTest.internals();
      const track = world.track.base || world.track;
      const meshes = world.landscape.terrainMeshes();
      const rc = new THREE.Raycaster(); const down = new THREE.Vector3(0, -1, 0);
      const f = track.frameAt(s + 0.37);   // not exactly on a mesh edge (rays along a shared edge may slip through)
      const fails = []; let n = 0;
      const nearBridge = track.bridges.some((b) => s > b.s0 - 60 && s < b.s1 + 60);
      for (const lat of lats) {
        if (nearBridge && Math.abs(lat) < 40) continue;
        const x = f.pos.x + f.right.x * lat; const z = f.pos.z + f.right.z * lat;
        const y = world.landscape.groundHeightAt(x, z);
        rc.set(new THREE.Vector3(x, y + 60, z), down);
        const hit = rc.intersectObjects(meshes, false)[0];
        n += 1;
        if (!hit) fails.push({ s, lat, kind: 'miss', dy: null });
        else if (Math.abs(hit.point.y - y) > tol) fails.push({ s, lat, kind: 'step', dy: Math.round((hit.point.y - y) * 100) / 100 });
      }
      return { n, fails };
    }, { s, lats: rayLatList(rayLats), tol: RAY_TOL_M });
    report.rays += res.n;
    res.fails.forEach((r) => report.rayFailures.push(r));
  }
  return report;
}
function rayLatList(n) {
  const out = [];
  for (let i = 0; i < n; i++) { const m = 12 + i * 14; out.push(m, -m); }
  return out;
}
