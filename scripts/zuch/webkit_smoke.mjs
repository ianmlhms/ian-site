/* WebKit (Safari engine, like the school iPads) smoke test: starts a route at medium quality, jumps to a crossing and to Munsbach, prints errors, draw calls and triangles, saves 2 screenshots.
 *   node scripts/zuch/webkit_smoke.mjs <outDir> */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer } from '../flows/lib.mjs';

const { webkit } = await import(pathToFileURL('/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright/index.mjs').href);
const outDir = process.argv[2] || '.';
fs.mkdirSync(outDir, { recursive: true });
const { server, origin } = await startServer();
const browser = await webkit.launch();
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('ts_quality', 'medium'); localStorage.setItem('ts_weather', 'clear'); localStorage.setItem('ts_tod', 'noon'); } catch (_) { /* none */ } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /Lokf/.test(m.text()))) errors.push(m.type() + ' ' + m.text().slice(0, 200)); });
  await page.goto(origin + '/pb/train-sim.html?test=1&quality=medium');
  await page.waitForFunction(() => window.__tsTest && window.__tsTest.state().phase === 'menu', null, { timeout: 90000 });
  await page.evaluate(() => { __tsTest.setSeed(1); __tsTest.setCalm(true); });
  await page.evaluate(() => __tsTest.startService('east', 'emu', 'career'));
  await page.waitForFunction(() => __tsTest.state().phase === 'running', null, { timeout: 180000 });
  for (const [label, s] of [['crossing', 2610 - 90], ['munsbach', 4380 - 60]]) {
    await page.evaluate((ts) => { __tsTest.placeAt(ts, 0); const w = __tsTest.internals().world; w.landscape.warm(ts); }, s);
    await page.waitForTimeout(2500);
    const st = await page.evaluate(() => { const x = __tsTest.state(); return { draws: x.draws, triangles: x.triangles, errors: x.errors }; });
    console.log(label, JSON.stringify(st));
    await page.screenshot({ path: path.join(outDir, `webkit-${label}.png`) });
  }
  console.log('errors', JSON.stringify(errors.filter((e) => !/404/.test(e)).slice(0, 6)));
} finally { await browser.close(); server.close(); }
