/* Flow: train-sim-ipad-start. Zuchsimulator on a school iPad: cold cache, throttled network (20 Mbit/s down, 5 up, 40 ms) and CPU (4x),
 * iPad Safari identity (Macintosh + touch), 1080x810 @2x. Measures how long it takes from opening the game (pixelbreak.html?g=train-sim)
 * to a running service the player can steer, and how many bytes (as they travel: gzip, like the live site) were loaded until then.
 * Asserts the owner's budget: playable within 10 s. Also checks the iPad gets the "low" graphics level.
 * The flow serves the repo from its own gzip static server (the live host compresses; the shared flow server does not). Supabase is mocked. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { REPO, runIfMain } from './lib.mjs';

export const BUDGET_S = 10;
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const NET = { offline: false, latency: 40, downloadThroughput: (20 * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 };
const CPU_SLOWDOWN = 4;
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav' };
const COMPRESSIBLE = new Set(['html', 'js', 'css', 'json', 'svg']);

/* A tiny static server with gzip, so the byte counts and the timing look like the live site. */
function startGzipServer() {
  const cache = new Map();
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.normalize(path.join(REPO, rel.endsWith('/') ? rel + 'index.html' : rel));
    if (!file.startsWith(REPO + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('not found'); return; }
    const ext = path.extname(file).slice(1);
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    let body = fs.readFileSync(file);
    if (COMPRESSIBLE.has(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) {
      if (!cache.has(file)) cache.set(file, zlib.gzipSync(body, { level: 6 }));
      body = cache.get(file);
      res.setHeader('Content-Encoding', 'gzip');
    }
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

const flow = {
  name: 'train-sim-ipad-start', fullChromium: true, touch: true, viewport: { width: 1080, height: 810 },
  backend: { rpc: { my_profile_private: () => [{ account_checked_at: '2026-10-01T00:00:00Z' }] }, tables: { scores: () => [], game_saves: () => [] } },
  async run(h) {
    await h.signIn();
    const { server, origin } = await startGzipServer();
    try {
      const page = h.page;
      const cdp = await h.context.newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 810, deviceScaleFactor: 2, mobile: true });
      await cdp.send('Emulation.setUserAgentOverride', { userAgent: IPAD_UA, platform: 'MacIntel' });
      await cdp.send('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: 6 });   // an iPad 9 reports 6 cores; the Mac running this flow has more
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.clearBrowserCache');
      let bytes = 0;
      const perUrl = new Map();
      const urlOf = new Map();
      cdp.on('Network.requestWillBeSent', (e) => urlOf.set(e.requestId, e.request.url));
      cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; const u = (urlOf.get(e.requestId) || '?').replace(origin, ''); perUrl.set(u, (perUrl.get(u) || 0) + e.encodedDataLength); });
      await cdp.send('Network.emulateNetworkConditions', NET);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });

      h.step('iPad cold start: open the game, press Start as soon as it can be pressed, steer as soon as the service runs');
      const t0 = Date.now();
      await page.goto(origin + '/pixelbreak.html?g=train-sim', { waitUntil: 'commit' });
      await page.waitForFunction(() => document.getElementById('gf')?.contentWindow, null, { timeout: 120000, polling: 100 });
      const frame = page.frames().find((f) => f.parentFrame());
      const startSel = '[data-test="mode-career"]:not([disabled])';
      await frame.waitForSelector(startSel, { state: 'visible', timeout: 120000 });
      const menuS = (Date.now() - t0) / 1000, menuMb = bytes / 1048576;
      if (process.env.TS_TRACE) { const tr = setInterval(async () => { try { console.log('    trace', ((Date.now() - t0) / 1000).toFixed(1), JSON.stringify(await frame.evaluate(() => ({ boot: document.getElementById('bootStatus').textContent, load: document.getElementById('loading').hidden ? '-' : document.getElementById('loadFill').style.width, hud: !document.getElementById('hud').hidden })))); } catch (_) { /* navigating */ } }, 700); setTimeout(() => clearInterval(tr), 30000); }
      if (process.env.TS_PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
      await frame.locator(startSel).click();
      await frame.waitForFunction(() => !document.getElementById('hud').hidden && document.getElementById('loading').hidden && document.getElementById('menu').hidden, null, { timeout: 60000, polling: 100 })
        .catch(async (e) => { console.log('    state', JSON.stringify(await frame.evaluate(() => ({ hudHidden: document.getElementById('hud').hidden, loadingHidden: document.getElementById('loading').hidden })))); throw e; });
      if (process.env.TS_PROFILE) {
        const { profile } = await cdp.send('Profiler.stop');
        const self = new Map(); const dts = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
        profile.samples.forEach((id, i) => { const n = byId.get(id); const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.replace(/^.*\/pb\//, '')}:${n.callFrame.lineNumber}`; self.set(key, (self.get(key) || 0) + (dts[i] || 0)); });
        const parent = new Map(); profile.nodes.forEach((n) => (n.children || []).forEach((c) => parent.set(c, n.id)));
        const incl = new Map();
        profile.samples.forEach((id, i) => { const seen = new Set(); for (let cur = id; cur; cur = parent.get(cur)) { const n = byId.get(cur); const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.replace(/^.*\/pb\//, '')}:${n.callFrame.lineNumber}`; if (!seen.has(key)) { seen.add(key); incl.set(key, (incl.get(key) || 0) + (dts[i] || 0)); } } });
        console.log('    profile (inclusive ms):', JSON.stringify([...incl.entries()].filter(([k]) => /train-sim|about:srcdoc/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 45).map(([k, v]) => `${Math.round(v / 1000)} ${k}`), null, 1));
        console.log('    profile (self ms):', JSON.stringify([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${Math.round(v / 1000)} ${k}`), null, 1));
      }
      const playS = (Date.now() - t0) / 1000, playMb = bytes / 1048576;
      const level = await frame.evaluate(() => (window.ArcadeGfx ? window.ArcadeGfx.level() : 'none'));
      const top = Object.fromEntries([...perUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, +(v / 1048576).toFixed(2)]));
      console.log(`    menu ready ${menuS.toFixed(1)} s / ${menuMb.toFixed(2)} MB; playable ${playS.toFixed(1)} s / ${playMb.toFixed(2)} MB; gfx level ${level}`);
      console.log('    biggest transfers until playable (MB):', JSON.stringify(top));
      h.expect(playS <= BUDGET_S, `playable within ${BUDGET_S} s on the iPad profile (was ${playS.toFixed(1)} s, ${playMb.toFixed(1)} MB)`);
      h.eq(level, 'low', 'an iPad starts on the low graphics level');
      h.expect(await frame.evaluate(() => !!document.getElementById('hud') && !document.getElementById('hud').hidden), 'the HUD is up');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await h.shot('ipad-start');

      h.step('Grafik: the pause screen cycles Automatesch -> Niddreg -> Mëttel -> Héich -> Automatesch, the menu has the same control');
      const label = () => frame.evaluate(() => document.getElementById('pauseQuality').textContent);
      await frame.locator('#btnPause').click();
      await frame.waitForSelector('#pauseScreen:not([hidden])', { timeout: 15000 });
      h.eq(await label(), 'Grafik: Automatesch (Niddreg)', 'pause screen: auto on an iPad = low');
      for (const [want, level] of [['Niddreg', 'low'], ['Mëttel', 'medium'], ['Héich', 'high'], ['Automatesch (Niddreg)', 'low']]) {
        await frame.locator('#pauseQuality').click();
        await frame.waitForFunction((w) => document.getElementById('pauseQuality').textContent === 'Grafik: ' + w, want, { timeout: 15000 });
        h.eq(await frame.evaluate(() => window.ArcadeGfx.level()), level, `Grafik ${want} -> level ${level}`);
        await frame.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 90000 });
      }
      await frame.locator('#quit').click();
      await frame.waitForSelector('[data-test="gfx-auto"]', { state: 'visible', timeout: 30000 });
      h.eq(await frame.locator('[data-test="gfx-auto"]').getAttribute('aria-checked'), 'true', 'menu: Automatesch is selected');
      await frame.locator('[data-test="gfx-high"]').click();
      await frame.waitForFunction(() => window.ArcadeGfx.level() === 'high' && document.querySelector('[data-test="gfx-high"]').getAttribute('aria-checked') === 'true', null, { timeout: 15000 });
      h.eq(await frame.evaluate(() => getComputedStyle(document.getElementById('world')).visibility), 'visible', 'high: the 3D menu backdrop is on');
      await frame.locator('[data-test="gfx-low"]').click();
      await frame.waitForFunction(() => window.ArcadeGfx.level() === 'low', null, { timeout: 15000 });
      h.eq(await frame.evaluate(() => getComputedStyle(document.getElementById('world')).visibility), 'hidden', 'low: no 3D menu backdrop');
      await frame.locator('[data-test="gfx-auto"]').click();
    } finally { server.close(); }
  },
};
export { flow };
runIfMain(import.meta.url, flow);
