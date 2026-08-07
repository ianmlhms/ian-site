#!/usr/bin/env node
/* Layout & legibility audit for ian.lu — the whole-site version of the check
 * that caught the studio problems.
 *
 * Loads every page in headless Chrome at several widths, in both themes, and
 * reports the things you only see by actually laying the page out:
 *
 *   overflow    the page scrolls sideways
 *   offscreen   a text box runs past the edge of the viewport
 *   collision   two normal-flow text boxes sit on top of each other
 *   clipped     text is cut off by its own container
 *   contrast    text does not reach WCAG AA on its real background
 *   hit-target  an interactive control is smaller than 44x44px
 *
 * Drives Chrome over the DevTools Protocol with Node's built-in WebSocket, so
 * it adds no dependency to a repo that deliberately has none.
 *
 *   node scripts/check_overlap.mjs                      # audit, compare to baseline
 *   node scripts/check_overlap.mjs --pages index.html   # one page
 *   node scripts/check_overlap.mjs --write-baseline     # accept current counts
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePage, evaluate, launchChrome, openPage, sleep } from "./audit/cdp.mjs";
import { auditPage } from "./audit/probe.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASELINE = path.join(ROOT, "scripts", "audit", "baseline.json");
const SERVER_PORT = 8731;
const DEBUG_PORT = 9333;
const CONCURRENCY = 4;
const SETTLE_MS = 900;            // let deferred scripts paint before measuring
const VIEWPORT_HEIGHT = 900;
const KINDS = ["overflow", "offscreen", "collision", "clipped", "contrast", "hit-target"];
// googled…html is a bare Search Console token; games.html is a <meta refresh>
// redirect that never loads theme.js, so it measures an unstyled flash.
const SKIP = new Set(["googled2bde022f66de7b9.html", "games.html"]);

function parseArgs(argv) {
  const flags = { widths: [390, 1280], themes: ["dark", "light"], pages: null, write: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].split("=");
    const value = inline ?? argv[i + 1];
    if (key === "--write-baseline") { flags.write = true; continue; }
    if (key === "--quiet") { flags.quiet = true; continue; }
    if (key === "--widths") flags.widths = value.split(",").map(Number);
    else if (key === "--themes") flags.themes = value.split(",");
    else if (key === "--pages") flags.pages = value.split(",");
    else continue;
    if (inline === undefined) i += 1;
  }
  return flags;
}

function sitePages(filter) {
  if (filter) return filter;
  return fs.readdirSync(ROOT)
    .filter((name) => name.endsWith(".html") && !SKIP.has(name))
    .sort();
}

function startServer() {
  const child = spawn("python3", ["-m", "http.server", String(SERVER_PORT), "--bind", "127.0.0.1"],
    { cwd: ROOT, stdio: "ignore" });
  child.unref();
  return child;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/index.html`);
      if (response.ok) return;
    } catch { /* still starting */ }
    await sleep(150);
  }
  throw new Error("static server did not start");
}

async function auditOne(client, page, width, theme) {
  const url = `http://127.0.0.1:${SERVER_PORT}/${page}`;
  const { targetId, sessionId } = await openPage(client, url, width, VIEWPORT_HEIGHT);
  try {
    // Seed the theme before the page's own scripts run, so theme.js picks it up
    // on first paint rather than us measuring a half-applied palette.
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { localStorage.setItem("site_theme", ${JSON.stringify(JSON.stringify({ mode: theme }))}); } catch (e) {}`,
    }, sessionId);
    await client.send("Page.reload", { ignoreCache: false }, sessionId);
    await Promise.race([client.once("Page.loadEventFired", sessionId), sleep(20000)]);
    await sleep(SETTLE_MS);
    const result = await evaluate(client, sessionId, auditPage, { theme });
    return { page, width, theme, ...result };
  } finally {
    await closePage(client, targetId);
  }
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

function summarise(results) {
  const perPage = new Map();
  for (const result of results) {
    const entry = perPage.get(result.page) || { totals: {}, samples: [], failures: [] };
    if (result.failed) entry.failures.push(`${result.width}px/${result.theme}: ${result.failed}`);
    for (const kind of KINDS) {
      const count = result.totals?.[kind] || 0;
      entry.totals[kind] = Math.max(entry.totals[kind] || 0, count);
    }
    for (const kind of KINDS) {
      for (const finding of result.findings?.[kind] || []) {
        entry.samples.push({ kind, width: result.width, theme: result.theme, ...finding });
      }
    }
    perPage.set(result.page, entry);
  }
  return perPage;
}

function report(perPage, baseline, quiet) {
  let regressions = 0;
  let total = 0;
  const rows = [...perPage.entries()].sort();
  for (const [page, entry] of rows) {
    const sum = KINDS.reduce((acc, kind) => acc + entry.totals[kind], 0);
    total += sum;
    const previous = baseline[page] || {};
    const worse = KINDS.filter((kind) => entry.totals[kind] > (previous[kind] ?? 0));
    if (worse.length) regressions += worse.length;
    if (quiet && !sum && !worse.length && !entry.failures.length) continue;
    const badge = worse.length ? "REGRESSED" : sum ? "  " : "ok";
    const detail = KINDS.filter((kind) => entry.totals[kind])
      .map((kind) => `${kind}=${entry.totals[kind]}`).join(" ");
    console.log(`${badge.padEnd(10)} ${page.padEnd(24)} ${detail}`);
    for (const failure of entry.failures) console.log(`           ! ${failure}`);
    for (const worseKind of worse) {
      console.log(`           ↑ ${worseKind}: ${previous[worseKind] ?? 0} → ${entry.totals[worseKind]}`);
      for (const sample of entry.samples.filter((s) => s.kind === worseKind).slice(0, 4)) {
        console.log(`             ${sample.width}px/${sample.theme} ${sample.where} — ${sample.detail}`);
      }
    }
  }
  return { regressions, total };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const pages = sitePages(flags.pages);
  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : {};
  const jobs = pages.flatMap((page) => flags.widths.flatMap((width) =>
    flags.themes.map((theme) => ({ page, width, theme }))));

  const server = startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ianlu-audit-"));
  let client;
  try {
    await waitForServer();
    client = await launchChrome(DEBUG_PORT, profile);
    console.log(`Auditing ${pages.length} pages × ${flags.widths.join("/")}px × ${flags.themes.join("/")} …`);
    const results = await runPool(jobs, (job) => auditOne(client, job.page, job.width, job.theme));
    const perPage = summarise(results);

    if (flags.write) {
      const next = Object.fromEntries([...perPage.entries()].map(([page, entry]) => [page, entry.totals]));
      fs.writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
      console.log(`\nBaseline written: ${path.relative(ROOT, BASELINE)}`);
      return;
    }
    const { regressions, total } = report(perPage, baseline, flags.quiet);
    console.log(`\n${total} findings across ${pages.length} pages; ${regressions} category regressions vs baseline.`);
    if (regressions) process.exitCode = 1;
  } finally {
    if (client) { client.close(); client.kill?.(); }
    server.kill();
    // Chrome unlinks its profile lazily after SIGTERM; a failed cleanup of a
    // temp dir must never mask the audit's own exit code.
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still exiting */ }
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
