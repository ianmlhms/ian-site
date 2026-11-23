#!/usr/bin/env node
/* Power test (22 Nov 2026): does one long-lived browser grow when Ski Alpen switches resort again and again?
 *   node scripts/power/resort-switch.mjs [--root <checkout with pb/ski>] [--mode long|context|browser] [--cycle killy,3vallees,...] [--gc]
 *     long     one browser, one page: each switch is a location.replace (what the game's switchResort does)
 *     context  one browser, a new context + page per resort (what runFlow does per flow in run_all)
 *     browser  a new browser per resort (one browser per flow)
 * After each resort is running + SETTLE_MS: the real memory of this process tree (top MEM, incl. compressed; ps rss under-counts
 * Chrome ~3x), three.js renderer.info.memory (geometries / textures) + programs, the page's JS heap. One JSON line per load,
 * a summary line at the end (growth from the first to the last visit of the same resort). Run it through browser-slot.py. */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const ROOT = path.resolve(opt("--root", process.cwd()));
const MODE = opt("--mode", "long");
const CYCLE = opt("--cycle", "killy,3vallees,zermatt,arlberg,kronplatz,killy,3vallees,zermatt,arlberg,kronplatz,vialattea").split(",");
const SETTLE_MS = Number(opt("--settle", "8000"));
const GC = args.includes("--gc");
const { launchBrowser, startServer } = await import(pathToFileURL(path.join(ROOT, "scripts/flows/lib.mjs")).href);

const UNITS = { K: 1 / 1024, M: 1, G: 1024, B: 1 / 1048576 };
const mb = (v) => { v = v.replace(/[+-]$/, ""); const u = v.slice(-1); return UNITS[u] ? Number(v.slice(0, -1)) * UNITS[u] : Number(v) / 1048576; };
/** this process tree's real memory, per process kind */
function treeMemory() {
  const out = execFileSync("top", ["-l", "1", "-stats", "pid,ppid,mem,command"], { encoding: "utf8", maxBuffer: 1 << 24 });
  const rows = new Map(), kids = new Map();
  let started = false;
  for (const line of out.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "PID") { started = true; continue; }
    if (!started || parts.length < 4) continue;
    const pid = Number(parts[0]), ppid = Number(parts[1]);
    if (!Number.isFinite(pid)) continue;
    rows.set(pid, { mem: mb(parts[2]), cmd: parts.slice(3).join(" ") });
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  const todo = [process.pid], seen = [];
  while (todo.length) { const p = todo.pop(); seen.push(p); todo.push(...(kids.get(p) || [])); }
  let total = 0, biggest = 0;
  for (const p of seen) { const r = rows.get(p); if (!r) continue; total += r.mem; biggest = Math.max(biggest, r.mem); }
  return { treeMb: Math.round(total), biggestMb: Math.round(biggest), procs: seen.length };
}

const { server, origin } = await startServer(ROOT);
const url = (rid) => `${origin}/pb/ski.html?go=1&debug=1&q=low&weather=sun&time=midday&resort=${rid}`;
let browser = MODE === "browser" ? null : await launchBrowser({ fullChromium: true });
let context = null, page = null;
const rows = [];
try {
  for (const [i, rid] of CYCLE.entries()) {
    const t0 = Date.now();
    if (MODE === "browser") { if (browser) await browser.close(); browser = await launchBrowser({ fullChromium: true }); context = null; }
    if (MODE !== "long" || !page) {
      if (context) await context.close();
      context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
      page = await context.newPage();
      page.on("pageerror", (e) => console.log(`[${rid}] pageerror ${String(e).slice(0, 200)}`));
      await page.goto(url(rid), { waitUntil: "domcontentloaded" });
    } else {
      await page.evaluate((u) => location.replace(u), url(rid));      // the game's own switchResort
      await page.waitForURL(new RegExp(`resort=${rid}`), { timeout: 30000 });
    }
    await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 240000 });
    const bootMs = Date.now() - t0;
    await page.waitForTimeout(SETTLE_MS);
    if (GC) {                       // --gc: a full garbage collection first, so the numbers are what is still referenced (a leak), not garbage
      const cdp = await context.newCDPSession(page);
      await cdp.send("HeapProfiler.collectGarbage");
      await cdp.detach();
      await page.waitForTimeout(1500);
    }
    const info = await page.evaluate(() => {
      const r = window.__ski && window.__ski.renderer, m = r ? r.info.memory : {};
      return { geometries: m.geometries, textures: m.textures, programs: r && r.info.programs ? r.info.programs.length : null,
        jsHeapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        tilesDone: document.documentElement.dataset.skiTilesDone === "1", bootError: document.documentElement.dataset.bootError || "" };
    });
    const row = { i, rid, mode: MODE, bootMs, ...info, ...treeMemory() };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
} finally {
  if (browser) await browser.close();
  server.close();
}
// growth: each resort's last visit vs its first
const growth = {};
for (const r of rows) { const g = (growth[r.rid] ||= { first: r.treeMb, last: r.treeMb, jsFirst: r.jsHeapMb, jsLast: r.jsHeapMb, geoFirst: r.geometries, geoLast: r.geometries }); g.last = r.treeMb; g.jsLast = r.jsHeapMb; g.geoLast = r.geometries; }
const peak = Math.max(...rows.map((r) => r.treeMb));
console.log(JSON.stringify({ summary: true, mode: MODE, loads: rows.length, peakTreeMb: peak, firstTreeMb: rows[0]?.treeMb, lastTreeMb: rows.at(-1)?.treeMb, growth }));
const errors = rows.filter((r) => r.bootError).length;
process.exit(errors ? 1 : 0);
