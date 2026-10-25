/* WebKit (Safari engine, like the school iPads) smoke + perf test: starts a route at medium quality, measures draw calls / triangles at the standard viewpoints
 * (crossing cab, Munsbach cab, Munsbach aerial, forest-leg cab), prints errors and saves screenshots.
 *   node scripts/zuch/webkit_smoke.mjs <outDir> [--route east] [--quality medium] [--root <repo>] [--tag name]
 * The viewpoints are found from the route (first crossing, the station called Munsbach, the middle of the longest forest run), so route changes do not matter. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer } from '../flows/lib.mjs';

const { webkit } = await import(pathToFileURL('/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright/index.mjs').href);
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const routeId = flag('route', 'east');
const quality = flag('quality', 'medium');
const root = flag('root', undefined);
const tag = flag('tag', 'run');
const outDir = args[0] || '.';
fs.mkdirSync(outDir, { recursive: true });
const { server, origin } = await startServer(root);
const browser = await webkit.launch();
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await ctx.addInitScript((q) => { try { localStorage.setItem('ts_quality', q); localStorage.setItem('ts_weather', 'clear'); localStorage.setItem('ts_tod', 'noon'); } catch (_) { /* none */ } }, quality);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /Lokf/.test(m.text()))) errors.push(m.type() + ' ' + m.text().slice(0, 200)); });
  await page.goto(origin + '/pb/train-sim.html?test=1&quality=' + quality);
  await page.waitForFunction(() => window.__tsTest && window.__tsTest.state().phase === 'menu', null, { timeout: 90000 });
  await page.evaluate(() => { __tsTest.setSeed(1); __tsTest.setCalm(true); });
  await page.evaluate((r) => __tsTest.startService(r, 'emu', 'career'), routeId);
  await page.waitForFunction(() => __tsTest.state().phase === 'running', null, { timeout: 180000 });
  const info = await page.evaluate(() => {
    const track = __tsTest.trackInfo();
    const i = track.stations.findIndex((s) => s.name === 'Munsbach');
    const st = track.stations[i];
    const forest = [];
    for (let s = 200; s < track.length - 200; s += 100) { const b = track.biomeAt(s); if (b === 'forest' || b === 'ardennes') forest.push(s); }
    return { ps: st.platformStart, mid: (st.platformStart + st.platformEnd) / 2, side: st.side === 'right' ? 1 : -1, crossings: (track.crossings || []).map((c) => c.s), forest };
  });
  let best = [], cur = [];
  info.forest.forEach((s, k) => { if (k && s - info.forest[k - 1] > 150) { if (cur.length > best.length) best = cur; cur = []; } cur.push(s); });
  if (cur.length > best.length) best = cur;
  const points = [];
  if (info.crossings.length) points.push(['crossing', info.crossings[0] - 90]);
  points.push(['munsbach', info.ps - 60]);
  if (best.length) points.push(['forest', best[Math.floor(best.length / 2)]]);
  const result = {};
  for (const [label, s] of points) {
    await page.evaluate((ts) => { __tsTest.setFreeCam(null); __tsTest.placeAt(ts, 0); const w = __tsTest.internals().world; w.landscape.warm(ts); }, s);
    await page.waitForTimeout(2500);
    result[label] = await page.evaluate(() => { const x = __tsTest.state(); return { draws: x.draws, triangles: x.triangles, errors: x.errors }; });
    await page.screenshot({ path: path.join(outDir, `webkit-${tag}-${label}.png`) });
  }
  // aerial over the station
  await page.evaluate(({ mid, side }) => {
    const { THREE } = __tsTest.internals(); const track = __tsTest.trackInfo();
    __tsTest.placeAt(mid - 160, 0);
    const f = track.frameAt(mid - 70), g = track.frameAt(mid);
    const pos = new THREE.Vector3().copy(f.pos).addScaledVector(f.right, -side * 70); pos.y += 60;
    const look = new THREE.Vector3().copy(g.pos).addScaledVector(g.right, side * 10);
    __tsTest.setFreeCam({ pos: [pos.x, pos.y, pos.z], look: [look.x, look.y, look.z], fov: 58 });
    __tsTest.internals().world.landscape.warm(mid);
  }, info);
  await page.waitForTimeout(2500);
  result.munsbachAir = await page.evaluate(() => { const x = __tsTest.state(); return { draws: x.draws, triangles: x.triangles, errors: x.errors }; });
  await page.screenshot({ path: path.join(outDir, `webkit-${tag}-munsbach-air.png`) });
  console.log(JSON.stringify({ route: routeId, quality, engine: 'webkit', result }));
  console.log('errors', JSON.stringify(errors.filter((e) => !/404/.test(e)).slice(0, 6)));
} finally { await browser.close(); server.close(); }
