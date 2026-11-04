/* Landmark visual QA: boots Lux Drive once in headless Chromium and takes a screenshot per camera pose.
 *   node scripts/luxdrive/shoot.mjs <poses.json> <outDir> [--q=medium] [--w=960 --h=600] [--time=noon]
 * poses.json: [{ name, x, z, h (camera height above the ground), tx, tz, ty (look-at; ty above ground), fov }]
 * (world metres). Prints draw calls / triangles per pose.  Runs Playwright directly (the browser slot script of the Mac
 * is only used when it exists). */
import fs from 'node:fs';
import path from 'node:path';
import { startServer, launchBrowser } from '../flows/lib.mjs';

const [posesFile, outDir] = process.argv.slice(2);
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=')[1];
if (!posesFile || !outDir) throw new Error('usage: shoot.mjs <poses.json> <outDir> [--q= --w= --h= --time= --weather=]');
const poses = JSON.parse(fs.readFileSync(posesFile, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const { server, origin } = await startServer();
const browser = await launchBrowser({ fullChromium: true });
try {
  const page = await browser.newPage({ viewport: { width: Number(opt('w', 960)), height: Number(opt('h', 600)) }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const url = `${origin}/pb/lux-drive.html?q=${opt('q', 'medium')}&time=${opt('time', 'noon')}&weather=${opt('weather', 'clear')}${process.argv.includes('--holes') ? '&holes=1' : ''}`;
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.luxReady === '1' || document.documentElement.dataset.bootError, null, { timeout: 300000 });
  const boot = await page.evaluate(() => document.documentElement.dataset.bootError || '');
  if (boot) throw new Error(`boot error: ${boot}`);
  await page.click('[data-act="drive"]');
  for (const p of poses) {
    await page.evaluate((q) => {
      const m = window.__lux;
      const g = (x, z) => m.ground.height(x, z);
      const y = g(q.x, q.z) + (q.h ?? 5);
      const ty = q.ty != null && q.abs ? q.ty : g(q.tx, q.tz) + (q.ty ?? 2);
      // the buildings, the trees and the landmarks are built around the car: it goes where the camera looks
      m.car.reset(q.tx, q.tz, 0);
      m.setCamera({ x: q.x, y: q.abs ? q.h : y, z: q.z, tx: q.tx, ty, tz: q.tz, fov: q.fov || 60 });
    }, p);
    // the tiles, the buildings and the landmarks around the camera: wait until the builders have nothing pending
    await page.evaluate(async () => { for (let i = 0; i < 400; i++) { const s = window.__lux.stats(); if (s.pending === 0 && s.cityPending === 0 && i > 15) break; await new Promise((r) => setTimeout(r, 100)); } });
    await page.waitForTimeout(int(opt('settle', 1200)));
    const stats = await page.evaluate(() => window.__lux.stats());
    const file = path.join(outDir, `${p.name}.png`);
    await page.screenshot({ path: file });
    console.log(p.name, JSON.stringify({ calls: stats.calls, tris: stats.triangles }), file);
  }
  if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));
} finally { await browser.close(); server.close(); }
function int(v) { return Number(v); }
