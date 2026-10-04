#!/usr/bin/env node
/* Automatic whole-site test for ian.lu — the standard pre-deploy check.
 *
 * Loads every page (root *.html + pb/*.html) in headless Chrome at iPad
 * portrait (820x1180), in light and dark, signed out, and fails on anything NEW:
 *
 *   errors     uncaught JS exceptions / unhandled rejections / console.error
 *              (network failures are ignored: signed out, every off-site call
 *              is refused on purpose — see audit/net.mjs)
 *   layout     the probes from check_overlap.mjs: overflow (page scrolls
 *              sideways), offscreen, collision, clipped, contrast, hit-target
 *
 * "New" means worse than scripts/audit/site_test_baseline.json: an error
 * message that is not in the baseline, or a layout count above the baseline's.
 *
 *   node scripts/site_test.mjs                          # all pages, compare to baseline
 *   node scripts/site_test.mjs --pages index.html,pb/snake.html
 *   node scripts/site_test.mjs --shots /tmp/shots       # also save <page>.<theme>.png
 *   node scripts/site_test.mjs --write-baseline         # accept the current state
 *   node scripts/site_test.mjs --details                # print every finding, not just new ones
 *
 * No npm: Node built-ins + Chrome over CDP, reusing scripts/audit/{cdp,probe,net}.mjs.
 * A page that fails to load/measure is BROKEN and fails the run; it is never
 * folded in as "0 findings", and a baseline is never written from a broken run.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePage, evaluate, freePort, launchChrome, sleep } from "./audit/cdp.mjs";
import { auditPage } from "./audit/probe.mjs";
import { loadFixtures, routeRequest } from "./audit/net.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASELINE = path.join(ROOT, "scripts", "audit", "site_test_baseline.json");
const FIXTURES = path.join(ROOT, "scripts", "audit", "fixtures");
const DEBUG_PORT = 9433;
const VIEWPORT = { width: 820, height: 1180 };     // iPad portrait
const THEMES = ["light", "dark"];
const CONCURRENCY = 4;
const SETTLE_MS = 400;                  // after the network goes quiet, not instead of it
const IDLE_TIMEOUT_MS = 6000;           // pollers never go idle; this bounds them
const LOAD_TIMEOUT_MS = 20000;
const ATTEMPTS = 2;                     // one retry: a timeout must not read as "clean"
const MAX_ERRORS_PER_PAGE = 20;
const LAYOUT_KINDS = ["overflow", "offscreen", "collision", "clipped", "contrast", "hit-target"];
const GEOLOCATION = { latitude: 49.6537, longitude: 6.2597, accuracy: 20 };
// Same skip list as check_overlap.mjs: a Search Console token and a <meta refresh> redirect.
const SKIP = new Set(["googled2bde022f66de7b9.html", "games.html"]);

/* Signed out, every off-site request is refused by audit/net.mjs, so pages log
 * their own "could not reach the server" errors. Those are expected. */
const NETWORK_NOISE = [
  /failed to (fetch|load resource)/i, /networkerror/i, /load failed/i, /fetch failed/i,
  /net::ERR_/i, /ERR_(CONNECTION|FAILED|BLOCKED|NAME)/i, /\bAuthRetryableFetchError\b/,
  /\bAuthSessionMissingError\b/, /supabase\.co/i, /status of (4|5)\d\d/i,
  /WebGL context could not be created/i, /Error creating WebGL context/i,   // headless Chrome has no GPU
  /the network connection was lost/i, /request (failed|timed out)/i, /\bNetwork ?Error\b/i,
];

const FREEZE_CSS = `*, *::before, *::after {
  animation-duration: 0s !important; animation-delay: 0s !important;
  animation-iteration-count: 1 !important; animation-fill-mode: both !important;
  transition: none !important; caret-color: transparent !important;
}
details:not([open])::details-content { content-visibility: hidden !important; }`;

function parseArgs(argv) {
  const flags = { pages: null, shots: null, write: false, details: false };
  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].split("=");
    const value = inline ?? argv[i + 1];
    if (key === "--write-baseline") { flags.write = true; continue; }
    if (key === "--details") { flags.details = true; continue; }
    if (key === "--pages") flags.pages = value.split(",").map((p) => p.trim()).filter(Boolean);
    else if (key === "--shots") flags.shots = path.resolve(value);
    else { console.error(`unknown flag ${argv[i]}`); process.exit(2); }
    if (inline === undefined) i += 1;
  }
  return flags;
}

function sitePages(filter) {
  if (filter) return filter.map((p) => p.replace(/^\.?\//, ""));
  const list = (dir, prefix) => fs.readdirSync(path.join(ROOT, dir))
    .filter((name) => name.endsWith(".html") && !SKIP.has(name))
    .map((name) => `${prefix}${name}`);
  return [...list(".", ""), ...list("pb", "pb/")].sort();
}

function freeTcpPort(start) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => (start > 8900 ? reject(new Error("no free port")) : resolve(freeTcpPort(start + 1))));
    probe.listen(start, "127.0.0.1", () => probe.close(() => resolve(start)));
  });
}

async function startServer() {
  const port = await freeTcpPort(8741);
  const child = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: ROOT, stdio: "ignore" });
  child.unref();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/index.html`)).ok) return { child, port }; }
    catch { /* still starting */ }
    await sleep(150);
  }
  child.kill();
  throw new Error("static server did not start");
}

/** Stable text for an error: digits, hashes and ports vary run to run. */
function signature(text) {
  return String(text).split("\n")[0]
    .replace(/127\.0\.0\.1:\d+/g, "HOST")
    .replace(/\?v=\d+/g, "")
    .replace(/\b[0-9a-f]{8,}\b/gi, "H")
    .replace(/\d+/g, "N")
    .trim().slice(0, 200);
}

function isNetworkNoise(text) {
  return NETWORK_NOISE.some((rx) => rx.test(text));
}

function remoteToText(arg) {
  if (!arg) return "";
  if (arg.value !== undefined) return String(arg.value);
  return arg.description || arg.unserializableValue || "";
}

function collectErrors(client, sessionId) {
  const errors = [];
  const push = (kind, text) => {
    if (!text || isNetworkNoise(text)) return;
    errors.push({ kind, sig: signature(text), text: String(text).split("\n")[0].slice(0, 300) });
  };
  client.on("Runtime.exceptionThrown", sessionId, (p) => {
    const d = p.exceptionDetails || {};
    push("exception", d.exception?.description || d.text);
  });
  client.on("Runtime.consoleAPICalled", sessionId, (p) => {
    if (p.type === "error") push("console.error", p.args.map(remoteToText).join(" "));
  });
  client.on("Log.entryAdded", sessionId, (p) => {
    const e = p.entry || {};
    if (e.level !== "error" || e.source === "network") return;
    push(`log:${e.source}`, e.text);
  });
  return errors;
}

async function handlePaused(client, sessionId, params, fixtures) {
  try {
    const command = routeRequest(params, fixtures);
    await client.send(command.method, command.params, sessionId);
  } catch { /* the tab closed mid-flight */ }
}

async function waitForIdle(client, sessionId) {
  let off = () => {};
  const idle = new Promise((resolve) => {
    off = client.on("Page.lifecycleEvent", sessionId, (p) => { if (p.name === "networkIdle") resolve(); });
  });
  await Promise.race([idle, sleep(IDLE_TIMEOUT_MS)]);
  off();
}

async function attempt(client, page, theme, fixtures, shotsDir, port) {
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  try {
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
    const errors = collectErrors(client, sessionId);
    await client.send("Page.enable", {}, sessionId);
    /* An alert()/prompt() (color.html asks for a name) freezes the page's main
     * thread, so every later CDP call hangs until it is answered. Cancel it. */
    client.on("Page.javascriptDialogOpening", sessionId, () => {
      void client.send("Page.handleJavaScriptDialog", { accept: false }, sessionId).catch(() => {});
    });
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Log.enable", {}, sessionId);
    await client.send("Emulation.setDeviceMetricsOverride",
      { ...VIEWPORT, deviceScaleFactor: 1, mobile: false }, sessionId);
    await client.send("Emulation.setGeolocationOverride", GEOLOCATION, sessionId);
    await client.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }, sessionId);
    client.on("Fetch.requestPaused", sessionId, (p) => { void handlePaused(client, sessionId, p, fixtures); });
    await client.send("Page.setLifecycleEventsEnabled", { enabled: true }, sessionId);
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { localStorage.setItem("site_theme", ${JSON.stringify(JSON.stringify({ mode: theme }))}); } catch (e) {}`,
    }, sessionId);
    const loaded = client.once("Page.loadEventFired", sessionId);
    await client.send("Page.navigate", { url: `http://127.0.0.1:${port}/${page}` }, sessionId);
    await Promise.race([loaded, sleep(LOAD_TIMEOUT_MS)]);
    await waitForIdle(client, sessionId);
    await evaluate(client, sessionId, (css) => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
    }, FREEZE_CSS);
    await sleep(SETTLE_MS);
    const probe = await evaluate(client, sessionId, auditPage, { theme });
    if (!probe || !probe.totals) throw new Error("probe returned nothing");
    if (shotsDir) {
      const shot = await client.send("Page.captureScreenshot", { format: "png" }, sessionId);
      fs.writeFileSync(path.join(shotsDir, `${page.replace(/\//g, "_")}.${theme}.png`),
        Buffer.from(shot.data, "base64"));
    }
    return { page, theme, totals: probe.totals, findings: probe.findings, errors };
  } finally {
    await closePage(client, targetId);
  }
}

async function measure(client, job, fixtures, shotsDir, port) {
  let lastError;
  for (let n = 1; n <= ATTEMPTS; n += 1) {
    try { return await attempt(client, job.page, job.theme, fixtures, shotsDir, port); }
    catch (error) { lastError = error; }
  }
  throw lastError;
}

async function runPool(jobs, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      try { results.push(await worker(job)); }
      catch (error) { results.push({ ...job, failed: String(error.message || error) }); }
    }
  });
  await Promise.all(runners);
  return results;
}

/** Group per-theme results by page into the shape the baseline stores. */
function summarise(results) {
  const pages = new Map();
  for (const r of results) {
    const entry = pages.get(r.page) || { failures: [], errors: new Map(), layout: {}, samples: [] };
    pages.set(r.page, entry);
    if (r.failed) { entry.failures.push(`${r.theme}: ${r.failed}`); continue; }
    for (const e of r.errors) if (!entry.errors.has(e.sig)) entry.errors.set(e.sig, e);
    entry.layout[r.theme] = Object.fromEntries(LAYOUT_KINDS
      .filter((k) => r.totals[k]).map((k) => [k, r.totals[k]]));
    for (const k of LAYOUT_KINDS) {
      for (const f of r.findings[k] || []) entry.samples.push({ kind: k, theme: r.theme, ...f });
    }
  }
  return pages;
}

function toBaseline(pages) {
  const out = {};
  for (const [page, e] of [...pages.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const errors = [...e.errors.keys()].sort().slice(0, MAX_ERRORS_PER_PAGE);
    const entry = {};
    if (errors.length) entry.errors = errors;
    for (const theme of THEMES) if (Object.keys(e.layout[theme] || {}).length) entry[theme] = e.layout[theme];
    if (Object.keys(entry).length) out[page] = entry;
  }
  return out;
}

function report(pages, baseline, details) {
  let regressions = 0;
  let broken = 0;
  let known = 0;
  for (const [page, e] of [...pages.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (e.failures.length) {
      broken += 1;
      console.log(`BROKEN     ${page}`);
      for (const f of e.failures) console.log(`           ! ${f}`);
      continue;
    }
    const base = baseline[page] || {};
    const lines = [];
    for (const [sig, err] of e.errors) {
      if (!(base.errors || []).includes(sig)) { regressions += 1; lines.push(`NEW ERROR  [${err.kind}] ${err.text}`); }
      else { known += 1; if (details) lines.push(`known err  [${err.kind}] ${err.text}`); }
    }
    for (const theme of THEMES) {
      const now = e.layout[theme] || {};
      const was = base[theme] || {};
      for (const kind of LAYOUT_KINDS) {
        const n = now[kind] || 0;
        const b = was[kind] || 0;
        if (n > b) {
          regressions += 1;
          lines.push(`REGRESSED  ${theme} ${kind}: ${b} → ${n}`);
          e.samples.filter((s) => s.theme === theme && s.kind === kind).slice(0, 4)
            .forEach((s) => lines.push(`             ${s.where} — ${s.detail}`));
        } else if (n) {
          known += n;
          if (details) {
            lines.push(`known      ${theme} ${kind}: ${n}`);
            e.samples.filter((s) => s.theme === theme && s.kind === kind)
              .forEach((s) => lines.push(`             ${s.where} — ${s.detail}`));
          }
        }
      }
    }
    if (lines.length) { console.log(page); lines.forEach((l) => console.log(`  ${l}`)); }
  }
  return { regressions, broken, known };
}

async function main() {
  const started = Date.now();
  const flags = parseArgs(process.argv.slice(2));
  const pages = sitePages(flags.pages);
  for (const page of pages) {
    if (!fs.existsSync(path.join(ROOT, page))) { console.error(`no such page: ${page}`); process.exit(2); }
  }
  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : {};
  const jobs = pages.flatMap((page) => THEMES.map((theme) => ({ page, theme })));
  if (flags.shots) fs.mkdirSync(flags.shots, { recursive: true });

  const { child: server, port } = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ianlu-sitetest-"));
  let client;
  try {
    client = await launchChrome(await freePort(DEBUG_PORT), profile);
    await client.send("Browser.grantPermissions", { permissions: ["geolocation"] });
    const fixtures = loadFixtures(FIXTURES);
    console.log(`Site test: ${pages.length} pages × ${VIEWPORT.width}x${VIEWPORT.height} × ${THEMES.join("/")}`);
    const results = await runPool(jobs, (job) => measure(client, job, fixtures, flags.shots, port));
    const summary = summarise(results);

    if (flags.write) {
      const broken = [...summary.values()].filter((e) => e.failures.length).length;
      if (broken) {
        console.error(`\n${broken} page(s) failed to load — refusing to write a baseline from a broken run.`);
        report(summary, {}, false);
        process.exitCode = 1;
        return;
      }
      const next = flags.pages ? { ...baseline, ...toBaseline(summary) } : toBaseline(summary);
      if (flags.pages) for (const page of pages) if (!(page in toBaseline(summary))) delete next[page];
      fs.writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
      console.log(`Baseline written: ${path.relative(ROOT, BASELINE)} (${Object.keys(next).length} pages with known findings)`);
      return;
    }
    const { regressions, broken, known } = report(summary, baseline, flags.details);
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`\n${pages.length} pages in ${seconds}s: ${regressions} new problem(s), ${broken} broken, ${known} known (baseline).`);
    if (regressions || broken) process.exitCode = 1;
  } finally {
    if (client) { client.close(); client.kill?.(); }
    server.kill();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still exiting */ }
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
