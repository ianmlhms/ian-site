#!/usr/bin/env node
/* Developer tool (28 Nov 2026, skier look + snowboard round): the player's figure in the real game, on the GPU: a close orbit while
 * carving, the chase camera, seated on a chair lift (orbit + chase), the others on a busy piste and at a lift's queue, first person.
 * Draw calls / triangles of every shot (window.__ski.info) and the figure's own numbers go to OUT_DIR/numbers.json.
 *   node scripts/ski/skier-shots.mjs OUT_DIR [--resort killy] [--board] [--q medium] [--before SHA (serve pb/ as it was at that commit)]
 *        [--only carve,chase,chair,crowd,station,fp]
 * Run it through ~/Library/Caches/browser-slot.py (BROWSER_POOL=ski). */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchBrowser, startServer } from '../flows/lib.mjs';

const args = process.argv.slice(2);
const out = args[0];
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const rid = opt('--resort', 'killy');
const q = opt('--q', 'medium');
const board = args.includes('--board');
const before = opt('--before', null);
const only = opt('--only', 'carve,chase,chair,crowd,station,fp').split(',');
fs.mkdirSync(out, { recursive: true });
const browser = await launchBrowser({ fullChromium: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
// --before: every file under pb/ that changed since that commit is served as it was then (read only)
let overrides = null;
if (before) {
  overrides = new Map();
  const changed = execFileSync('git', ['diff', '--name-only', before, '--', 'pb/'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const f of changed) { try { overrides.set('/' + f, execFileSync('git', ['show', `${before}:${f}`])); } catch (error) { console.warn('new since', before, f); } }
  console.log('before', before, ':', changed.length, 'files served old');
}
const { server, origin } = await startServer(undefined, { overrides });
const numbers = { rid, board, q, shots: {} };
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  await page.addInitScript(() => { try { localStorage.setItem('pb_ski_npcs', '1'); localStorage.removeItem('pb_ski_cam'); } catch (error) { /* ignore */ } });
  await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=${q}&res=fixed&weather=sun&time=midday&resort=${rid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 180000 });
  await page.evaluate(() => window.__ski.streamer.release());
  await page.waitForFunction("document.documentElement.dataset.skiTilesDone === '1'", null, { timeout: 300000, polling: 500 });
  await page.waitForTimeout(2000);
  if (board) {
    const ok = await page.evaluate(() => window.__ski.setSki('snowboard', false));
    if (!ok) throw new Error('no snowboard in this tree');
  }
  const hideUi = (v) => page.evaluate((v) => { const e = document.getElementById('ui'); if (e) e.style.visibility = v ? 'hidden' : ''; }, v);
  const shot = async (name) => {
    const info = await page.evaluate(() => window.__ski.info());
    numbers.shots[name] = { calls: info.calls, triangles: info.triangles };
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    console.log(name, JSON.stringify(numbers.shots[name]));
  };
  // a blue / red piste with a real slope
  const spot = await page.evaluate(() => {
    const S = window.__ski, cr = S.npcs.crowd;
    let best = null;
    for (const p of S.pistes.list) {
      if ((p.diff !== 'blue' && p.diff !== 'red') || p.length < 900) continue;
      const a = p.at(p.length * 0.45, {}), b = p.at(p.length * 0.45 + 100, {});
      const slope = (S.surface.height(a.x, a.z) - S.surface.height(b.x, b.z)) / 100;
      const n = cr.popOf(p).skiers.length / p.length;
      if (slope < 0.18) continue;
      if (!best || n > best.n) best = { p, n };
    }
    const p = best ? best.p : S.pistes.list[0], a = p.at(p.length * 0.45, {});
    return { id: p.id, x: a.x, z: a.z, h: Math.atan2(a.dz, a.dx) };
  });
  if (only.includes('carve') || only.includes('chase') || only.includes('fp')) {
    await page.evaluate((sp) => { const S = window.__ski; S.place(sp.x, sp.z, sp.h); S.setInput({ steer: 0, tuck: 1, brake: 0, push: 1, jump: false }); }, spot);
    await page.waitForTimeout(2500);
    await hideUi(true);
    if (only.includes('carve')) {
      for (const [name, steer, angle] of [['carve-close', 0.8, 35], ['carve-close-b', -0.8, 150]]) {
        await page.evaluate(([steer, angle]) => { const S = window.__ski; S.setInput({ steer, tuck: 0, brake: 0, push: 0, jump: false }); S.orbit(angle, 3.6, 1.1, 38); }, [steer, angle]);
        await page.waitForTimeout(700);
        await shot(name);
      }
      await page.evaluate(() => window.__ski.orbit(null));
    }
    if (only.includes('chase')) {
      await page.evaluate(() => window.__ski.setInput({ steer: 0.5, tuck: 0, brake: 0, push: 0, jump: false }));
      await page.waitForTimeout(900);
      await shot('chase');
    }
    if (only.includes('fp')) {
      await page.evaluate(() => { const S = window.__ski; S.setCamMode('fp'); S.setInput({ steer: -0.4, tuck: 0, brake: 0, push: 0, jump: false }); });
      await page.waitForTimeout(1200);
      await shot('fp');
      await page.evaluate(() => window.__ski.setCamMode('chase'));
    }
    await hideUi(false);
  }
  if (only.includes('crowd')) {
    await page.evaluate((sp) => { const S = window.__ski; S.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); S.placeHold(sp.x, sp.z, sp.h); }, spot);
    await page.waitForTimeout(3500);
    await hideUi(true);
    await page.evaluate((sp) => { const S = window.__ski; S.setCamera(sp.x - Math.cos(sp.h) * 22, sp.z - Math.sin(sp.h) * 22, 7, sp.x + Math.cos(sp.h) * 50, sp.z + Math.sin(sp.h) * 50, 0, 55); }, spot);
    await page.waitForTimeout(1800);
    await shot('crowd');
    numbers.npcs = await page.evaluate(() => { const v = window.__ski.npcs.view; return { stats: { ...v.stats }, figs: { near: v.figs.near.triangles, crowd: v.figs.crowd.triangles }, boards: v.instances().filter((o) => o.pose >= 11).length, drawn: v.instances().length }; });
    await page.evaluate(() => window.__ski.setCamera(null));
    await hideUi(false);
  }
  let chairId = null;
  if (only.includes('station') || only.includes('chair')) {
    chairId = await page.evaluate(() => {
      const S = window.__ski, L = S.modes.lifts.list.filter((l) => l.kind === 'chair' && (l.seats || 4) >= 4 && l.len > 600);
      const l = L.sort((a, b) => b.len - a.len)[Math.min(2, L.length - 1)] || S.modes.lifts.list[0];
      return l.id;
    });
    await page.evaluate((id) => { const S = window.__ski; S.setInput(null); S.goFree(id); }, chairId);
    await page.waitForFunction(() => window.__ski.game.phase === 'running', null, { timeout: 30000 });
    await page.waitForTimeout(4500);
  }
  if (only.includes('station')) {
    await hideUi(true);
    await page.evaluate((id) => {
      const S = window.__ski, l = S.modes.lifts.byId.get(id), site = S.modes.lifts.world.sites.get(l.index), f = site.bottom;
      const w = site.wait, cam = f.toWorld(site.zone.a1 + 9, site.zone.b1 + 6, {});
      S.setCamera(cam.x, cam.z, 3.2, w.x, w.z, 0.8, 50);
    }, chairId);
    await page.waitForTimeout(1800);
    await shot('station');
    await page.evaluate(() => window.__ski.setCamera(null));
    await hideUi(false);
  }
  if (only.includes('chair')) {
    await page.evaluate(() => window.__ski.boardLift());
    await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.where && window.__ski.ride.where().onCarrier, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(8000);
    await hideUi(true);
    await shot('chair');
    await page.evaluate(() => window.__ski.orbit(150, 3.2, 0.2, 45));
    await page.waitForTimeout(700);
    await shot('chair-close');
    await page.evaluate(() => window.__ski.orbit(60, 3.4, -0.6, 45));
    await page.waitForTimeout(700);
    await shot('chair-close-b');
    await page.evaluate(() => window.__ski.orbit(null));
    await hideUi(false);
  }
  numbers.errors = errors.slice(0, 8);
  fs.writeFileSync(path.join(out, 'numbers.json'), JSON.stringify(numbers, null, 1));
  console.log('errors', errors.length, errors.slice(0, 3));
} finally {
  await browser.close();
  server.close();
}
