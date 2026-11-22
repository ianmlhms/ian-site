#!/usr/bin/env node
/* R8f: memory check over the resorts (run through browser-slot.py: ONE browser, its tree must stay < 2.5 GB).
 *   node scripts/ski/memory-check.mjs [--engine chromium|webkit] [--resorts killy,3vallees,...] [--q low] [--tour 18] [--switches 10]
 *        [--size 1180x820] [--dpr 2] [--json out.json] [--no-check]
 * Per resort (a fresh page): the memory after the free ride is up at the first lift ("load") and after putting the skier down at up
 * to --tour village centres ("tour"). Then ONE page switches resorts --switches times the way the game does (location.replace, a page
 * life per resort) and must not grow: the same resort's footprint at the last visit is within +-50 MB of its first visit.
 * Readouts: the page's JS heap (Chromium performance.memory), three's geometries / textures, the scene's vertex bytes (JS side), and the
 * REAL footprint (top's MEM, compressed memory included) of the browser's process tree, split into renderer / GPU / the rest.
 * Targets (renderer process = the page): <= 450 MB after load, <= 700 MB after the tour, switch growth <= 50 MB. Exit 1 when one fails. */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { startServer, launchBrowser, REPO } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const ENGINE = opt("engine", "chromium");
const RESORTS = opt("resorts", "killy,3vallees,zermatt,arlberg,kronplatz").split(",").filter(Boolean);
const Q = opt("q", "low");
const TOUR = Number(opt("tour", "18"));
const SWITCHES = Number(opt("switches", "10"));
const [W, H] = opt("size", "1180x820").split("x").map(Number);
const DPR = Number(opt("dpr", "2"));
const JSON_OUT = opt("json", "");
const CHECK = !args.includes("--no-check");
const LIMIT = { load: 450, tour: 700, growth: 50 };
process.env.FLOW_BROWSER = ENGINE;

const helpers = fs.readFileSync(`${REPO}/scripts/ski/r8c-helpers.js`, "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mbOf = (v) => {
  const m = /^([\d.]+)([BKMG]?)/.exec(v.replace(/[+-]$/, ""));
  if (!m) return 0;
  return Number(m[1]) * ({ B: 1 / 1048576, K: 1 / 1024, M: 1, G: 1024, "": 1 / 1048576 })[m[2]];
};

/** The real footprint (MB) of the process tree under `root`, by role (top's MEM; renderer / gpu by the command line). */
function treeFootprint(root) {
  const top = execFileSync("top", ["-l", "1", "-stats", "pid,ppid,mem"], { encoding: "utf8", timeout: 30000 });
  const kids = new Map(), mem = new Map();
  let on = false;
  for (const line of top.split("\n")) {
    const p = line.trim().split(/\s+/);
    if (p[0] === "PID") { on = true; continue; }
    if (!on || p.length !== 3) continue;
    const pid = Number(p[0]), ppid = Number(p[1]);
    if (!Number.isFinite(pid)) continue;
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
    mem.set(pid, mbOf(p[2]));
  }
  const pids = [], todo = [root];
  while (todo.length) { const p = todo.pop(); pids.push(p); todo.push(...(kids.get(p) || [])); }
  const cmd = new Map();
  try {
    for (const line of execFileSync("ps", ["-o", "pid=,command=", "-p", pids.join(",")], { encoding: "utf8" }).split("\n")) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (m) cmd.set(Number(m[1]), m[2]);
    }
  } catch { /* a process ended meanwhile */ }
  const out = { total: 0, renderer: 0, gpu: 0, other: 0, renderers: 0 };
  for (const pid of pids) {
    const m = mem.get(pid) || 0, c = cmd.get(pid) || "";
    out.total += m;
    if (/--type=renderer|WebContent/.test(c)) { out.renderer = Math.max(out.renderer, m); out.renderers++; }
    else if (/--type=gpu-process|GPU/.test(c)) out.gpu += m;
    else out.other += m;
  }
  for (const k of ["total", "renderer", "gpu", "other"]) out[k] = Math.round(out[k]);
  return out;
}

/** The page's own readout (JS heap, three's counts, the scene's vertex bytes). */
const pageMem = () => {
  const S = window.__ski;
  if (window.gc) window.gc();
  let attr = 0;
  const by = {};
  S.scene.traverse((o) => {
    const g = o.geometry;
    if (!g || !g.attributes) return;
    let b = 0;
    for (const a of Object.values(g.attributes)) b += a.array ? a.array.byteLength : 0;
    if (g.index && g.index.array) b += g.index.array.byteLength;
    attr += b;
    const k = (o.name || (o.parent && o.parent.name) || o.type).replace(/[-_ :]?[\d.,:-]+$/, '').replace(/^tile.*/, 'tile');
    by[k] = (by[k] || 0) + b;
  });
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${Math.round(v / 1048576)}`).join(', ');
  const m = S.renderer.info.memory;
  return {
    heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    geo: m.geometries, tex: m.textures, attr: Math.round(attr / 1048576), top,
  };
};

const { server, origin } = await startServer();
const browser = await launchBrowser({ fullChromium: true, args: ENGINE === "webkit" ? [] : ["--js-flags=--expose-gc", "--enable-precise-memory-info"] });
const proc = browser.process && browser.process();
const ROOT = proc ? proc.pid : process.pid;
const results = { engine: ENGINE, q: Q, size: `${W}x${H}@${DPR}`, resorts: {}, switches: [], fails: [] };
const fail = (msg) => { results.fails.push(msg); console.log(`  FAIL ${msg}`); };
const urlOf = (rid) => `${origin}/pb/ski.html?resort=${rid}&go=1&q=${Q}&debug=1`;

/** Wait until the free ride runs and the tiles around the skier are in. */
async function whenUp(page) {
  await page.waitForFunction(() => (window.__ski && window.__ski.game && window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running") || !!document.documentElement.dataset.bootError, null, { timeout: 180000 });
  const err = await page.evaluate(() => document.documentElement.dataset.bootError || "");
  if (err) throw new Error(`boot error: ${err}`);
  await page.waitForFunction(() => window.__ski.terrain.stats.pending === 0, null, { timeout: 60000 }).catch(() => {});
  // "load" = the whole resort in: every height tile, the village and the streets (built once the tiles are in)
  await page.waitForFunction(() => window.__ski.streamer.done() && !!window.__ski.scene.getObjectByName("ski-village") && !!window.__ski.scene.getObjectByName("ski-roads"), null, { timeout: 120000 }).catch(() => console.log("  (village / streets not in after 120 s)"));
  await sleep(4000);
}

async function measure(page, label) {
  const p = await page.evaluate(pageMem);
  await sleep(500);
  const f = treeFootprint(ROOT);
  const row = { label, ...p, rendererMB: f.renderer, gpuMB: f.gpu, otherMB: f.other, treeMB: f.total };
  console.log(`  ${label.padEnd(26)} heap ${String(p.heap).padStart(5)} MB  geo ${String(p.geo).padStart(4)}  tex ${String(p.tex).padStart(3)}  attr ${String(p.attr).padStart(4)} MB | renderer ${String(f.renderer).padStart(5)}  gpu ${String(f.gpu).padStart(5)}  other ${String(f.other).padStart(4)}  tree ${String(f.total).padStart(5)} MB${process.env.MEM_TOP ? `  [${p.top}]` : ""}`);
  return row;
}

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  pageerror: ${String(e).slice(0, 300)}`));
  return { ctx, page };
}

try {
  console.log(`memory-check ${ENGINE} q=${Q} ${W}x${H}@${DPR} (browser pid ${ROOT})`);
  console.log(`  ${"empty browser".padEnd(26)} tree ${treeFootprint(ROOT).total} MB`);
  // 1. per resort: load + village tour, a fresh context each
  for (const rid of RESORTS) {
    console.log(`\n${rid}`);
    const { ctx, page } = await newPage();
    await page.goto(urlOf(rid), { waitUntil: "domcontentloaded" });
    await whenUp(page);
    const load = await measure(page, "load");
    await page.evaluate(`(async () => { ${helpers} })()`);
    const spots = await page.evaluate(async ([rid2, n]) => {
      const r = await (await fetch(`/pb/ski/data/${rid2}/resort.json`)).json();
      const S = window.__ski;
      const all = (r.places || []).filter((p) => /village|town|hamlet/.test(p.kind) && p.x > 0 && p.z > 0 && p.x < S.field.width && p.z < S.field.depth);
      const step = Math.max(1, all.length / n);
      const out = [];
      for (let i = 0; i < all.length && out.length < n; i += step) out.push(all[Math.floor(i)]);
      return out.map((p) => ({ x: p.x, z: p.z, name: p.name }));
    }, [rid, TOUR]);
    let peak = load, tour = load;
    for (let i = 0; i < spots.length; i++) {
      await page.evaluate(([x, z]) => window.__r8.spot(x, z, 0), [spots[i].x, spots[i].z]);
      if (i % 6 === 5 || i === spots.length - 1) {
        tour = await measure(page, `tour ${i + 1}/${spots.length} ${spots[i].name.slice(0, 12)}`);
        if (tour.rendererMB > peak.rendererMB) peak = tour;
      }
    }
    results.resorts[rid] = { load, tour, peak, spots: spots.length };
    if (load.rendererMB > LIMIT.load) fail(`${rid}: renderer ${load.rendererMB} MB after load > ${LIMIT.load}`);
    if (peak.rendererMB > LIMIT.tour) fail(`${rid}: renderer ${peak.rendererMB} MB on the tour > ${LIMIT.tour}`);
    await ctx.close();
    await sleep(1500);
  }
  // 2. one page, resort after resort (the game's switch: location.replace)
  if (SWITCHES > 0) {
    console.log(`\nswitches (one page, location.replace)`);
    const { ctx, page } = await newPage();
    const order = [];
    for (let i = 0; i < SWITCHES; i++) order.push(RESORTS[i % RESORTS.length]);
    const firstOf = {};
    for (let i = 0; i < order.length; i++) {
      const rid = order[i];
      if (i === 0) await page.goto(urlOf(rid), { waitUntil: "domcontentloaded" });
      else await Promise.all([page.waitForURL(new RegExp(`resort=${rid}&`), { timeout: 60000 }), page.evaluate((u) => location.replace(u), urlOf(rid))]);
      await whenUp(page);
      const row = await measure(page, `#${i + 1} ${rid}`);
      results.switches.push(row);
      if (!firstOf[rid]) firstOf[rid] = row;
      else if (row.treeMB - firstOf[rid].treeMB > LIMIT.growth) fail(`switch #${i + 1} ${rid}: tree ${row.treeMB} MB, ${row.treeMB - firstOf[rid].treeMB} MB more than its first visit (${firstOf[rid].treeMB})`);
    }
    await ctx.close();
  }
} catch (error) {
  fail(`aborted: ${String(error.message || error).split("\n")[0]}`);
} finally {
  await browser.close().catch(() => {});
  server.close();
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 1));
console.log(results.fails.length ? `\n${results.fails.length} FAIL` : "\nall memory checks green");
process.exit(CHECK && results.fails.length ? 1 : 0);
