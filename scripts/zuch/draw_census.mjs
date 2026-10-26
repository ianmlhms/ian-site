/* Where do the draw calls of a view come from?  WebKit, cab at the station (platformStart - 60 m), counts the visible, frustum-passing meshes of the scene by their top-level
 * group (or the name of the owning group) and by mesh kind; the shadow pass is not included (it draws the casting subset again).
 *   node scripts/zuch/draw_census.mjs [--route east] [--station Lëtzebuerg] [--quality medium] [--root <repo>] */
import { pathToFileURL } from 'node:url';
import { startServer } from '../flows/lib.mjs';

const { webkit } = await import(pathToFileURL('/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright/index.mjs').href);
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const routeId = flag('route', 'east'); const quality = flag('quality', 'medium'); const root = flag('root', undefined); const stationName = flag('station', 'Lëtzebuerg');
const { server, origin } = await startServer(root);
const browser = await webkit.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await ctx.addInitScript((q) => { try { localStorage.setItem('ts_quality', q); localStorage.setItem('ts_weather', 'clear'); localStorage.setItem('ts_tod', 'noon'); } catch (_) { /* none */ } }, quality);
  const page = await ctx.newPage();
  await page.goto(origin + '/pb/train-sim.html?test=1&quality=' + quality);
  await page.waitForFunction(() => window.__tsTest && window.__tsTest.state().phase === 'menu', null, { timeout: 90000 });
  await page.evaluate(() => { __tsTest.setSeed(1); __tsTest.setCalm(true); });
  await page.evaluate((r) => __tsTest.startService(r, 'emu', 'career'), routeId);
  await page.waitForFunction(() => __tsTest.state().phase === 'running', null, { timeout: 180000 });
  await page.evaluate(async () => { const t = __tsTest.trackInfo(); const b = t.base || t; await Promise.all((b.surroundPatches || []).map((p) => window.TS.stationSurround.loadHeavy(p.name))); });
  const ps = await page.evaluate((name) => { const t = __tsTest.trackInfo(); return t.stations.find((s) => s.name === name).platformStart; }, stationName);
  await page.evaluate((ts) => { __tsTest.setFreeCam(null); __tsTest.placeAt(ts, 0); __tsTest.internals().world.landscape.warm(ts); }, ps - 60);
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const { scene, camera, THREE } = __tsTest.internals();
    camera.updateMatrixWorld(); const fr = new THREE.Frustum(); fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const by = {}; let total = 0;
    const owner = (o) => { const chain = []; for (let p = o; p; p = p.parent) if (p.name) chain.push(p.name); return chain.length ? chain[chain.length - 1] + (chain.length > 1 ? '/' + chain[0] : '') : '(unnamed ' + (o.parent && o.parent.type) + ')'; };
    scene.traverse((o) => {
      if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite)) return;
      for (let p = o; p; p = p.parent) if (!p.visible) return;
      if (o.geometry && o.frustumCulled !== false) { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); if (o.geometry.boundingSphere) { const s = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld); if (!fr.intersectsSphere(s)) return; } }
      const mats = Array.isArray(o.material) ? o.material.length : 1;
      const k = owner(o).replace(/[0-9a-f-]{8,}/g, '#'); by[k] = (by[k] || 0) + mats; total += mats;
    });
    const kids = []; scene.traverse((o) => { if (o.name && o.name.startsWith('station-surround-')) o.traverse((m) => { if (m.isMesh || m.isLine) kids.push([m.type, m.geometry.index ? m.geometry.index.count / 3 : (m.geometry.attributes.position.count / 3) | 0, (m.material.map ? 'map ' : '') + (m.material.vertexColors ? 'vc ' : '') + (m.castShadow ? 'cast' : '')].join(' ')); }); });
    const st = __tsTest.state();
    return { surroundMeshes: kids, renderedDraws: st.draws, sceneVisible: total, by: Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 25) };
  });
  console.log(JSON.stringify(out, null, 1));
} finally { await browser.close(); server.close(); }
