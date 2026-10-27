/* node scripts/zuch/tram_pose_shot.mjs <routeId> <outDir> "name:s:lat:up:yawDeg:pitchDeg[:fov]" ...   screenshots of the Luxtram world from track-relative poses (tiles awaited) */
import path from 'node:path';
import { openSim } from './zlib.mjs';
const argv = process.argv.slice(2);
const magenta = argv.includes('--magenta') ? argv.splice(argv.indexOf('--magenta'), 1).length > 0 : false;   // hole mode: magenta where nothing is drawn, sky / hills / far ground hidden
const [routeId, outDir, ...specs] = argv;
const sim = await openSim({ quality: 'high' });
try {
  await sim.start(routeId, 'tram');
  for (const spec of specs) {
    const [name, s, lat, up, yaw, pitch, fov] = spec.split(':');
    const S = Number(s);
    await sim.page.evaluate(async (ts) => {
      __tsTest.placeAt(ts, 0);
      const w = __tsTest.internals().world; const lw = w.landscape.luxtramWorld; const frame = () => new Promise((r) => requestAnimationFrame(r));
      const t0 = performance.now();
      for (let i = 0; i < 600; i++) { w.landscape.warm(ts); await frame(); let p = 0; for (const t of lw.tiles.values()) { if (Math.abs(t.info.s - ts) < 640 && (t.state === 'loading' || !t.built)) p++; } for (const f of lw.far.values()) { if (f.state === 'loading') p++; } if (i > 3 && !p) break; if (performance.now() - t0 > 30000) break; }
    }, S);
    await sim.view({ s: S, lat: Number(lat), up: Number(up), yaw: Number(yaw) * Math.PI / 180, pitch: Number(pitch) * Math.PI / 180, fov: Number(fov || 70), settle: 8 });
    if (magenta) await sim.page.evaluate(() => { const { scene, renderer, world, THREE } = __tsTest.internals(); window.__hm = { bg: scene.background, far: [] }; world.landscape.setHoleMode(true); world.landscape.luxtramWorld.far.forEach((fr) => { if (fr.group && fr.group.visible) { fr.group.visible = false; window.__hm.far.push(fr.group); } }); scene.background = new THREE.Color(0xff00ff); renderer.setClearColor(0xff00ff, 1); });
    if (magenta) await sim.frames(3);
    const st = await sim.stats();
    const f = path.join(outDir, `${name}.png`);
    await sim.shot(f);
    console.log(f, JSON.stringify(st));
    if (magenta) await sim.page.evaluate(() => { const { scene, world } = __tsTest.internals(); world.landscape.setHoleMode(false); window.__hm.far.forEach((g) => { g.visible = true; }); scene.background = window.__hm.bg; });
  }
} finally { await sim.close(); }
