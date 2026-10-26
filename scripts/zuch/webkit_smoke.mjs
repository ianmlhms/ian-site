/* WebKit (Safari engine, like the school iPads) smoke + perf test: starts a route at medium quality, measures draw calls / triangles at the standard viewpoints
 * (crossing cab, Munsbach cab, Munsbach aerial, forest-leg cab), prints errors and saves screenshots.
 *   node scripts/zuch/webkit_smoke.mjs <outDir> [--route east] [--quality medium] [--root <repo>] [--tag name]
 * The viewpoints are found from the route (first crossing, the station called Munsbach, the middle of the longest forest run), so route changes do not matter. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer } from '../flows/lib.mjs';

// Playwright is looked up in $PLAYWRIGHT_DIR, then as a normal "playwright" import, then in the macOS global playwright-cli install (matches scripts/flows/lib.mjs).
const GLOBAL_PLAYWRIGHT = '/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright';
async function importPlaywright() {
  try { return await import('playwright'); } catch { /* fall through to the folders */ }
  for (const dir of [process.env.PLAYWRIGHT_DIR, GLOBAL_PLAYWRIGHT].filter(Boolean)) {
    for (const entry of ['index.mjs', 'index.js']) {
      const file = path.join(dir, entry);
      if (fs.existsSync(file)) return import(pathToFileURL(file).href);
    }
  }
  throw new Error('Playwright not found — set PLAYWRIGHT_DIR to a playwright package folder.');
}
const { webkit } = await importPlaywright();
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const routeId = flag('route', 'east');
const quality = flag('quality', 'medium');
const root = flag('root', undefined);
const tag = flag('tag', 'run');
const stationName = flag('station', 'Munsbach');      // the station of the standard station views (W2c: e.g. Esch-Uelzecht on south)
const outDir = args[0] || '.';
/* mean / worst frame interval (ms) over 90 animation frames (headless WebKit with software GL: only comparable between routes, not an iPad number) */
const frameTime = (page) => page.evaluate(() => new Promise((res) => { const t = []; let last = performance.now(); const step = () => { const n = performance.now(); t.push(n - last); last = n; if (t.length < 90) requestAnimationFrame(step); else { t.shift(); res({ mean: +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(1), p95: +t.slice().sort((a, b) => a - b)[Math.floor(t.length * 0.95)].toFixed(1) }); } }; requestAnimationFrame(step); }));
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
  // the scenery halves of the station patches normally stream in ahead of the train; a jump along the route would outrun them, so load them all for the measurement
  await page.evaluate(async () => { const t = __tsTest.trackInfo(); const b = t.base || t; await Promise.all((b.surroundPatches || []).map((p) => window.TS.stationSurround.loadHeavy(p.name))); });
  const info = await page.evaluate((name) => {
    const track = __tsTest.trackInfo();
    const i = track.stations.findIndex((s) => s.name === name);
    const st = track.stations[i];
    const forest = [];
    for (let s = 200; s < track.length - 200; s += 100) { const b = track.biomeAt(s); if (b === 'forest' || b === 'ardennes') forest.push(s); }
    return { ps: st.platformStart, mid: (st.platformStart + st.platformEnd) / 2, side: st.side === 'right' ? 1 : -1, crossings: (track.crossings || []).map((c) => c.s), forest };
  }, stationName);
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
    result[label].frameMs = await frameTime(page);
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
  result.munsbachAir.frameMs = await frameTime(page);
  await page.screenshot({ path: path.join(outDir, `webkit-${tag}-munsbach-air.png`) });
  console.log(JSON.stringify({ route: routeId, station: stationName, quality, engine: 'webkit', result }));
  console.log('errors', JSON.stringify(errors.filter((e) => !/404/.test(e)).slice(0, 6)));
} finally { await browser.close(); server.close(); }
