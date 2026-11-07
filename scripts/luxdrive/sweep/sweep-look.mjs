/* Lux Drive sweep 2: the GPU camera sweep.  A camera point every ~30 m along every car road, four views each (chase forward, chase backward, side at 1.5 m, top-down 40 m),
 * automatic detectors per frame (holes, z-fighting flicker, grass on the carriageway, objects in a lane, missing lane lines; see look-page.js).  Resumable.
 *   node scripts/luxdrive/sweep/sweep-look.mjs [--out DIR] [--limit N] [--area x0,z0,x1,z1] [--shard i/n] [--resume] [--points points.json] [--finalize-only]
 * Env: PW_HOME = the folder that has node_modules/playwright (Windows: C:\luxdrive\node-tools), SWEEP_GL = swiftshader to force software GL.
 * Output (DIR): points.json, progress-look.json, shots/*.jpg (flagged frames, labelled), sweep-look.json (all flags, sorted), top/NNN.jpg + sheets/sheet-NN.png (top 200). */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const MIME = { html: 'text/html', js: 'text/javascript', json: 'application/json', css: 'text/css', webp: 'image/webp', png: 'image/png', bin: 'application/octet-stream', wasm: 'application/wasm' };
const PAGE = '/pb/lux-drive.html?holes=1&q=medium&time=noon&weather=clear';
const TOP = 200, SHEET_COLS = 4, SHEET_ROWS = 3, MAX_IMAGES = 5000, SAVE_EVERY = 25, RETRIES = 3;

const arg = (n, d) => { const i = process.argv.indexOf(n); return i < 0 ? d : (process.argv[i + 1] ?? true); };
const outDir = path.resolve(arg('--out', path.join(REPO, '..', 'luxdrive-sweep-out', 'look')));
const resume = process.argv.includes('--resume');
fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });

function findPlaywright() {
  const cands = [process.env.PW_HOME, 'C:\\luxdrive\\node-tools', '/opt/node-tools', '/opt/homebrew/lib/node_modules/@playwright/cli'].filter(Boolean);
  for (const c of cands) {
    for (const rel of ['node_modules/playwright', 'node_modules/playwright-core']) if (fs.existsSync(path.join(c, rel))) return createRequire(path.join(c, 'x.js'))(rel.split('/')[1]);
  }
  throw new Error('Playwright not found: set PW_HOME to the folder that has node_modules/playwright');
}

/** GPU launch args per platform: Windows = the RTX 4070 through D3D11, macOS = Metal, else software GL. */
function glArgs() {
  if (process.env.SWEEP_GL === 'swiftshader' || (process.platform !== 'win32' && process.platform !== 'darwin')) return ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  if (process.platform === 'win32') return ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu'];
  return ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
}

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.normalize(path.join(REPO, rel));
    if (!file.startsWith(REPO + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('nf'); return; }
    res.setHeader('Content-Type', MIME[path.extname(file).slice(1)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

async function openGame(chromium, origin) {
  const browser = await chromium.launch({ args: [...glArgs(), '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${PAGE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.luxReady === '1' || document.documentElement.dataset.bootError, null, { timeout: 300000 });
  const bad = await page.evaluate(() => document.documentElement.dataset.bootError || '');
  if (bad) throw new Error(`boot error: ${bad}`);
  await page.click('[data-act="drive"]');
  await page.addStyleTag({ content: 'body > *:not(#shell), #shell > *:not(#luxCanvas) { display: none !important; }' });
  await page.evaluate(fs.readFileSync(path.join(HERE, 'look-page.js'), 'utf8'));
  const size = await page.evaluate(() => window.__sweep.init());
  console.log(`[sweep-look] game ready, canvas ${size.w}x${size.h}, GL ${await page.evaluate(() => { const g = window.__lux.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })}`);
  return { browser, page };
}

async function main() {
  let pts;
  const ptsFile = arg('--points', path.join(outDir, 'points.json'));
  if (!fs.existsSync(ptsFile)) {
    const { buildPoints } = await import('./look-points.mjs');
    const area = arg('--area', '') ? arg('--area', '').split(',').map(Number) : null;
    const res = await buildPoints({ area, limit: Number(arg('--limit', 0)) });
    fs.writeFileSync(ptsFile, JSON.stringify(res));
    console.log(`[sweep-look] ${res.points.length} camera points over ${res.roads} roads (${res.km.toFixed(0)} km)`);
    pts = res;
  } else pts = JSON.parse(fs.readFileSync(ptsFile, 'utf8'));
  let points = pts.points;
  const shard = (arg('--shard', '') || '').toString().split('/').map(Number);
  if (shard.length === 2) { const n = Math.ceil(points.length / shard[1]); points = points.slice(shard[0] * n, (shard[0] + 1) * n); }
  const progressFile = path.join(outDir, 'progress-look.json');
  let state = { next: 0, flags: [], frames: 0, images: 0, errors: [], ms: 0 };
  if (resume && fs.existsSync(progressFile)) { state = JSON.parse(fs.readFileSync(progressFile, 'utf8')); console.log(`[sweep-look] resumed at point ${state.next} of ${points.length}`); }
  const save = () => fs.writeFileSync(progressFile, JSON.stringify(state));

  if (!process.argv.includes('--finalize-only')) {
    const { chromium } = findPlaywright();
    const server = await serve();
    const origin = `http://127.0.0.1:${server.address().port}`;
    let game = await openGame(chromium, origin);
    const self = await game.page.evaluate((pt) => window.__sweep.selfTest(pt), points.find((q) => q.level === 'ground') || points[0]);
    console.log(`[sweep-look] self-test (a hidden terrain tile must be seen as a hole): ${self.ok ? 'OK' : 'FAILED'} ${JSON.stringify(self)}`);
    if (!self.ok && !process.argv.includes('--no-selftest')) throw new Error('the hole detector self-test failed');
    const t0 = Date.now(), n0 = state.next;
    try {
      for (; state.next < points.length; state.next++) {
        const p = points[state.next];
        let res = null;
        for (let attempt = 0; attempt < RETRIES && !res; attempt++) {
          try { res = await game.page.evaluate(([pt, imgs]) => window.__sweep.probe(pt, imgs), [p, state.images < MAX_IMAGES]); }
          catch (err) {
            state.errors.push({ point: p.id, message: String(err.message || err).slice(0, 200) });
            console.error(`[sweep-look] point ${p.id} failed (${attempt + 1}/${RETRIES}): ${String(err.message || err).slice(0, 120)}`);
            try { await game.browser.close(); } catch { /* already gone */ }
            game = await openGame(chromium, origin);
          }
        }
        if (!res) continue;
        state.frames += res.frames;
        for (const f of res.flags) {
          const rec = { point: p.id, x: p.x, z: p.z, road: p.road, name: p.name || p.kind, kind: p.kind, level: p.level, type: f.type, view: f.view, score: f.score, detail: f.detail };
          if (f.image) {
            const file = `${String(p.id).padStart(6, '0')}-${f.type}-${f.view}.jpg`;
            fs.writeFileSync(path.join(outDir, 'shots', file), Buffer.from(f.image.split(',')[1], 'base64'));
            rec.image = file; state.images++;
          }
          state.flags.push(rec);
        }
        if ((state.next + 1) % SAVE_EVERY === 0) {
          state.ms += Date.now() - t0 - state.ms;       // total wall time of this run, kept in the progress file
          save();
          const done = state.next + 1 - n0, rate = done / ((Date.now() - t0) / 60000);
          if ((state.next + 1) % (SAVE_EVERY * 4) === 0) console.log(`[sweep-look] ${state.next + 1}/${points.length} points, ${state.frames} frames, ${state.flags.length} flags, ${rate.toFixed(1)} points/min, ETA ${((points.length - state.next - 1) / rate / 60).toFixed(1)} h`);
        }
      }
    } finally {
      save();
      try { await game.browser.close(); } catch { /* already gone */ }
      server.close();
    }
    console.log(`[sweep-look] driven through ${state.next} points in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  }
  await finalize(points, state);
}

/** sweep-look.json (all flags, worst first) and the top shots on contact sheets. */
async function finalize(points, state) {
  const flags = state.flags.slice().sort((a, b) => b.score - a.score);
  const counts = {};
  for (const f of flags) counts[f.type] = (counts[f.type] || 0) + 1;
  const withImage = flags.filter((f) => f.image).slice(0, TOP);
  fs.writeFileSync(path.join(outDir, 'sweep-look.json'), JSON.stringify({ generated: new Date().toISOString(), points: points.length, done: state.next, frames: state.frames, counts, errors: state.errors.slice(0, 50), flags }));
  fs.mkdirSync(path.join(outDir, 'top'), { recursive: true });
  withImage.forEach((f, i) => fs.copyFileSync(path.join(outDir, 'shots', f.image), path.join(outDir, 'top', `${String(i + 1).padStart(3, '0')}-${f.type}-${f.image}`)));
  const md = [`# Lux Drive sweep 2: look worst-list`, '', `${state.next}/${points.length} points, ${state.frames} frames, flags: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`, '', '| # | score | type | view | street | x, z | detail | shot |', '|---|---|---|---|---|---|---|---|',
    ...flags.slice(0, 100).map((f, i) => `| ${i + 1} | ${f.score} | ${f.type} | ${f.view} | ${f.name} | ${Math.round(f.x)}, ${Math.round(f.z)} | ${f.detail} | ${f.image || ''} |`), ''].join('\n');
  fs.writeFileSync(path.join(outDir, 'sweep-look.md'), md);
  if (!withImage.length) { console.log('[sweep-look] no flagged frames with a picture'); return; }
  // contact sheets: composed in a plain page (no game), 12 shots a sheet
  const { chromium } = findPlaywright();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: SHEET_COLS * 480, height: SHEET_ROWS * 270 } });
    fs.mkdirSync(path.join(outDir, 'sheets'), { recursive: true });
    const per = SHEET_COLS * SHEET_ROWS;
    for (let s = 0; s * per < withImage.length; s++) {
      const batch = withImage.slice(s * per, (s + 1) * per).map((f) => fs.readFileSync(path.join(outDir, 'shots', f.image)).toString('base64'));
      await page.setContent('<body style="margin:0;background:#111"><canvas id="c" width="1920" height="810"></canvas></body>');
      await page.evaluate(async ({ batch, cols }) => {
        const ctx = document.getElementById('c').getContext('2d');
        await Promise.all(batch.map((b64, i) => new Promise((res) => { const im = new Image(); im.onload = () => { ctx.drawImage(im, (i % cols) * 480, Math.floor(i / cols) * 270, 480, 270); res(); }; im.onerror = res; im.src = 'data:image/jpeg;base64,' + b64; })));
      }, { batch, cols: SHEET_COLS });
      await page.locator('#c').screenshot({ path: path.join(outDir, 'sheets', `sheet-${String(s + 1).padStart(2, '0')}.png`) });
    }
  } finally { await browser.close(); }
  console.log(`[sweep-look] ${withImage.length} top shots, sheets in ${path.join(outDir, 'sheets')}`);
}

await main();
