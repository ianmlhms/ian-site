/* Zuchsimulator QA harness: opens pb/train-sim.html?test=1 in local headless Chrome (one browser at a time), starts a route, and places the camera anywhere
 * in track coordinates (s along the track, lat to the right, up) for screenshots and the hole detector.  Reuses the flow harness (scripts/flows/lib.mjs).
 *
 *   import { openSim } from './zlib.mjs';
 *   const sim = await openSim({ quality: 'high' });
 *   await sim.start('west');               // route id (add '~r' for the return direction)
 *   await sim.view({ s: 1200, lat: 12, up: 3, yaw: 0, pitch: -0.05 });   // camera pose relative to the track frame; yaw 0 = along the track, + = left
 *   await sim.shot('/path/out.png');
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, startServer } from '../flows/lib.mjs';

export async function openSim({ quality = 'high', width = 1280, height = 720, train = 'emu', root = undefined, weather = 'clear', tod = 'noon' } = {}) {
  const [browser, { server, origin }] = await Promise.all([launchBrowser({ fullChromium: true }), startServer(root)]);
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await context.addInitScript(([q, w, t]) => { try { localStorage.setItem('ts_quality', q); localStorage.setItem('ts_weather', w); localStorage.setItem('ts_tod', t); } catch (_) { /* no storage */ } }, [quality, weather, tod]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || /warn/i.test(m.type()) && /Lokf/.test(m.text())) errors.push(m.type() + ': ' + m.text()); });
  await page.goto(origin + '/pb/train-sim.html?test=1&quality=' + quality, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__tsTest && window.__tsTest.state().phase === 'menu', null, { timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('bootStatus')?.textContent, null, { timeout: 60000 }).catch(() => {});
  await page.evaluate(() => { __tsTest.setSeed(20261025); __tsTest.setCalm(true); });

  const api = {
    page, errors, origin,
    async close() { await browser.close(); server.close(); },
    async start(routeId, trainId = train) {
      await page.evaluate(([r, t]) => __tsTest.startService(r, t, 'career'), [routeId, trainId]);
      await page.waitForFunction(() => { const s = __tsTest.state(); return s.phase === 'running' && !document.getElementById('loading')?.hidden === false; }, null, { timeout: 120000 }).catch(() => {});
      await page.waitForFunction(() => __tsTest.state().phase === 'running', null, { timeout: 120000 });
      await page.evaluate(() => { window.focus(); });
      await api.frames(10);
    },
    /* one-off evaluation against the game: fn gets ({ track, world, scene, camera, THREE }) */
    evalGame(fn, arg) { return page.evaluate(`(${fn.toString()})(Object.assign(__tsTest.internals(), { track: __tsTest.trackInfo() }), ${JSON.stringify(arg === undefined ? null : arg)})`); },
    async frames(n = 3) { await page.evaluate((k) => new Promise((res) => { let i = 0; const step = () => (++i >= k ? res() : requestAnimationFrame(step)); requestAnimationFrame(step); }), n); },
    async stats() { return page.evaluate(() => { const s = __tsTest.state(); return { draws: s.draws, triangles: s.triangles, errors: s.errors }; }); },
    /* place the train at s (km/h 0) and the camera at (s, lat, up) looking along yaw/pitch relative to the track direction at s2 (default s) */
    async view({ s, lat = 0, up = 3, yaw = 0, pitch = 0, fov = 60, trainS = s, ahead = 80, target = null, settle = 6 }) {
      await page.evaluate(([ts]) => __tsTest.placeAt(ts, 0), [trainS]);
      await page.evaluate(({ s, lat, up, yaw, pitch, fov, ahead, target }) => {
        const { track, THREE } = Object.assign(__tsTest.internals(), { track: __tsTest.trackInfo() });
        const f = track.frameAt(s);
        const pos = new THREE.Vector3().copy(f.pos).addScaledVector(f.right, lat); pos.y += up;
        const t = f.tangent.clone(); t.y = 0; t.normalize();
        const dir = t.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        let look = pos.clone().addScaledVector(dir, ahead); look.y += Math.tan(pitch) * ahead;
        if (target) { const g = track.frameAt(target.s); look = new THREE.Vector3().copy(g.pos).addScaledVector(g.right, target.lat || 0); look.y += target.up || 0; }
        __tsTest.setFreeCam({ pos: [pos.x, pos.y, pos.z], look: [look.x, look.y, look.z], fov });
      }, { s, lat, up, yaw, pitch, fov, ahead, target });
      await api.frames(settle);
    },
    /* hides every page element except the 3D canvas (HUD, title card, toasts) so screenshots show only the world */
    async hideUi() {
      await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        for (let node = canvas; node && node !== document.body; node = node.parentElement) {
          Array.from(node.parentElement.children).forEach((sib) => { if (sib !== node) sib.style.setProperty('visibility', 'hidden', 'important'); });
        }
      });
    },
    async shot(file, opts = {}) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await api.hideUi();
      await api.frames(2);
      const box = await page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height }; });
      await page.screenshot({ path: file, clip: box, ...opts });
      return file;
    },
  };
  return api;
}
