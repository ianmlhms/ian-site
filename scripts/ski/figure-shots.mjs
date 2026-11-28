#!/usr/bin/env node
/* Developer tool (28 Nov 2026, skier look round): close-up contact sheets of the skier figure (scripts/ski/figure-view.html) in its
 * poses, every detail level, ski and snowboard. One PNG per sheet: OUT_PREFIX-<sheet>.png.
 *   node scripts/ski/figure-shots.mjs OUT_PREFIX [--sheets poses,rides,detail,face,board,boardrides] [--outfit rout]
 * Run it through ~/Library/Caches/browser-slot.py. */
import { launchBrowser, startServer } from '../flows/lib.mjs';

const args = process.argv.slice(2);
const out = args[0];
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const outfit = opt('--outfit', 'rout');
const sheets = opt('--sheets', 'poses,rides,detail,face').split(',');
const SHEETS = {
  poses: { cols: 5, tiles: [
    { pose: 'ski' }, { pose: 'carveR', yaw: 200 }, { pose: 'carveL', yaw: -20 }, { pose: 'tuck', yaw: 60 }, { pose: 'plough', yaw: 10 },
    { pose: 'jump', ty: 1.4, h: 1.6 }, { pose: 'crash', yaw: 80, ty: 0.6 }, { pose: 'stand', yaw: 150 }, { pose: 'ski', yaw: 90, dist: 3.2 }, { pose: 'ski', yaw: 180, dist: 3.2 },
  ] },
  rides: { cols: 4, tiles: [{ pose: 'sit', ty: 0.6, yaw: 30 }, { pose: 'cabin', yaw: 40 }, { pose: 'carry', yaw: 60, ty: 1.0 }, { pose: 'drag', yaw: 120 }] },
  detail: { cols: 3, tiles: [{ pose: 'carveR', detail: 'full', yaw: 20 }, { pose: 'carveR', detail: 'mid', yaw: 20 }, { pose: 'carveR', detail: 'low', yaw: 20 }, { pose: 'sit', detail: 'full', ty: 0.6 }, { pose: 'sit', detail: 'mid', ty: 0.6 }, { pose: 'sit', detail: 'low', ty: 0.6 }] },
  face: { cols: 3, tiles: [
    { pose: 'ski', yaw: 10, dist: 1.1, ty: 1.45, h: 1.25, camY: 0.25 }, { pose: 'ski', yaw: 70, dist: 1.2, ty: 1.4, h: 1.3, camY: 0.2 }, { pose: 'ski', yaw: 120, dist: 1.6, ty: 1.2, h: 1.3, camY: 0.2 },
    { pose: 'ski', yaw: 20, dist: 1.4, ty: 0.2, h: 0.5, camY: 0.1 }, { pose: 'ski', yaw: 100, dist: 1.8, ty: 0.3, h: 0.6, camY: 0.2 }, { pose: 'carveR', yaw: 30, dist: 1.5, ty: 0.7, h: 0.9, camY: 0.1 },
  ] },
  outfits: { cols: 5, tiles: ['rout', 'blo', 'giel', 'greng', 'rosa', 'schwaarz', 'neon', 'retro', 'gold', 'weltcup'].map((o) => ({ pose: 'ski', outfit: o, yaw: 25 })) },
  board: { cols: 5, tiles: [
    { pose: 'ski', board: true }, { pose: 'carveR', board: true, yaw: 200 }, { pose: 'carveL', board: true, yaw: -20 }, { pose: 'tuck', board: true, yaw: 60 }, { pose: 'plough', board: true, yaw: 10 },
    { pose: 'jump', board: true, ty: 1.4, h: 1.6 }, { pose: 'crash', board: true, yaw: 80, ty: 0.6 }, { pose: 'stand', board: true, yaw: 150 }, { pose: 'push', board: true, yaw: 90 }, { pose: 'ski', board: true, yaw: 270 },
  ] },
  boardrides: { cols: 4, tiles: [{ pose: 'sit', board: true, ty: 0.4, yaw: 30, dist: 4.6 }, { pose: 'cabin', board: true, yaw: 40 }, { pose: 'carry', board: true, yaw: 60, ty: 1.0 }, { pose: 'drag', board: true, yaw: 120 }] },
  boarddetail: { cols: 3, tiles: [{ pose: 'carveR', board: true, detail: 'full' }, { pose: 'carveR', board: true, detail: 'mid' }, { pose: 'carveR', board: true, detail: 'low' }] },
};
const browser = await launchBrowser({ fullChromium: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const { server, origin } = await startServer();
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });
  await page.goto(`${origin}/scripts/ski/figure-view.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.figureReady === true', null, { timeout: 60000 });
  for (const name of sheets) {
    const s = SHEETS[name];
    if (!s) { console.log('no sheet', name); continue; }
    await page.evaluate((spec) => window.renderSheet(spec), { ...s, outfit });
    await page.screenshot({ path: `${out}-${name}.png` });
    console.log('wrote', `${out}-${name}.png`);
  }
} finally {
  await browser.close();
  server.close();
}
