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
 *   node scripts/check_overlap.mjs --record-fixtures    # refresh the canned API replies
 *
 * The run is deterministic by construction: every off-site request is answered
 * from scripts/audit/fixtures (see audit/net.mjs), animations are forced to
 * their last frame, and measurement waits for the network to go quiet rather
 * than for a fixed timer. A page that fails to measure is reported as BROKEN
 * and fails the run — it is never folded in as a page with zero findings.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePage, evaluate, freePort, launchChrome, openPage, sleep } from "./audit/cdp.mjs";
import { auditPage } from "./audit/probe.mjs";
import { loadFixtures, routeRequest, saveFixture, wantsFixture } from "./audit/net.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASELINE = path.join(ROOT, "scripts", "audit", "baseline.json");
const FIXTURES = path.join(ROOT, "scripts", "audit", "fixtures");
const SERVER_PORT = 8731;
const DEBUG_PORT = 9333;
/* Not higher: at 8 the heavy pages (skylens draws a Leaflet map plus 200
 * aircraft) lose the render race against their own settle window and report
 * fewer findings than they do alone, which is under-measurement dressed up as
 * a speed-up. The real win came from loading each page once instead of twice. */
const CONCURRENCY = 4;
const SETTLE_MS = 400;            // after the network goes quiet, not instead of it
/* Pages that poll (skylens's aircraft, moien's clock) never fire networkIdle and
 * always pay this in full, so it is tempting to shorten. Do not: at 4s the
 * heavier pages sometimes finished rendering and sometimes did not, and two
 * consecutive full runs disagreed by 17 findings. Determinism is the whole
 * point of this gate — the speed came from loading each page once instead of
 * twice, which costs nothing. */
const IDLE_TIMEOUT_MS = 8000;
const VIEWPORT_HEIGHT = 900;
const ATTEMPTS = 2;               // one retry: a timed-out probe must not read as "clean"
const GEOLOCATION = { latitude: 49.6537, longitude: 6.2597, accuracy: 20 };  // Niederanven

/* Animations are forced to their last frame rather than paused, so a transform
 * that is mid-flight when we measure cannot invent an offscreen finding. */
const FREEZE_CSS = `*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  animation-fill-mode: both !important;
  transition: none !important;
  caret-color: transparent !important;
}
/* Chrome hides a closed <details> through an animation on ::details-content, so
 * the blanket animation-fill-mode above un-hides it and every collapsed block
 * lays out as if open. Re-assert the hiding rather than dropping the fill-mode,
 * which is what forces the rest of the page to its settled frame. */
details:not([open])::details-content { content-visibility: hidden !important; }`;
const KINDS = ["overflow", "offscreen", "collision", "clipped", "contrast", "hit-target"];
// googled…html is a bare Search Console token; games.html is a <meta refresh>
// redirect that never loads theme.js, so it measures an unstyled flash.
const SKIP = new Set(["googled2bde022f66de7b9.html", "games.html"]);

function parseArgs(argv) {
  const flags = { widths: [390, 1280], themes: ["dark", "light"], pages: null, write: false,
    record: false, quiet: false, settle: SETTLE_MS };
  for (let i = 0; i < argv.length; i += 1) {
    const [key, inline] = argv[i].split("=");
    const value = inline ?? argv[i + 1];
    if (key === "--write-baseline") { flags.write = true; continue; }
    if (key === "--record-fixtures") { flags.record = true; continue; }
    if (key === "--quiet") { flags.quiet = true; continue; }
    if (key === "--widths") flags.widths = value.split(",").map(Number);
    else if (key === "--themes") flags.themes = value.split(",");
    else if (key === "--pages") flags.pages = value.split(",");
    else if (key === "--settle") flags.settle = Number(value);
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

/** Resolve when the page stops making requests, or when we give up waiting. */
async function waitForIdle(client, sessionId) {
  const idle = new Promise((resolve) => {
    const off = client.on("Page.lifecycleEvent", sessionId, (params) => {
      if (params.name !== "networkIdle") return;
      off();
      resolve();
    });
  });
  await Promise.race([idle, sleep(IDLE_TIMEOUT_MS)]);
}

async function attemptAudit(client, page, width, theme, settle, net) {
  const url = `http://127.0.0.1:${SERVER_PORT}/${page}`;
  /* Yes, this loads the page twice — once here, once after the theme seed below.
   * Collapsing it to a single navigation looks like a free 2x and is not: the
   * first load warms Chrome's cache and JIT, and without it the counts stopped
   * being reproducible (two full runs disagreed by 9 findings). A gate that
   * cries wolf is worth less than a gate that takes four minutes. */
  const { targetId, sessionId } = await openPage(client, url, width, VIEWPORT_HEIGHT);
  try {
    await client.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: net.record ? "Response" : "Request" }],
    }, sessionId);
    client.on("Fetch.requestPaused", sessionId, (params) => {
      void handlePaused(client, sessionId, params, net);
    });
    await client.send("Page.setLifecycleEventsEnabled", { enabled: true }, sessionId);
    /* Headless denies geolocation, so pages built around "where am I" (skylens's
     * aircraft list) rendered their empty state and their real controls went
     * unmeasured. Pin it to Ian's village instead of asking. */
    await client.send("Emulation.setGeolocationOverride", GEOLOCATION, sessionId);
    // Seed the theme before the page's own scripts run, so theme.js picks it up
    // on first paint rather than us measuring a half-applied palette.
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { localStorage.setItem("site_theme", ${JSON.stringify(JSON.stringify({ mode: theme }))}); } catch (e) {}`,
    }, sessionId);
    await client.send("Page.reload", { ignoreCache: false }, sessionId);
    await Promise.race([client.once("Page.loadEventFired", sessionId), sleep(20000)]);
    await waitForIdle(client, sessionId);
    await evaluate(client, sessionId, (css) => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
    }, FREEZE_CSS);
    await sleep(settle);
    const result = await evaluate(client, sessionId, auditPage, { theme });
    return { page, width, theme, ...result };
  } finally {
    await closePage(client, targetId);
  }
}

async function handlePaused(client, sessionId, params, net) {
  try {
    if (net.record) {
      if (params.responseStatusCode && wantsFixture(params.request.url)) {
        const body = await client.send("Fetch.getResponseBody",
          { requestId: params.requestId }, sessionId).catch(() => null);
        if (body) {
          const header = (params.responseHeaders || [])
            .find((h) => h.name.toLowerCase() === "content-type");
          saveFixture(FIXTURES, params.request.url, {
            status: params.responseStatusCode,
            mime: (header?.value || "application/json").split(";")[0],
            body: body.base64Encoded ? body.body : Buffer.from(body.body).toString("base64"),
          });
        }
      }
      await client.send("Fetch.continueRequest", { requestId: params.requestId }, sessionId);
      return;
    }
    const command = routeRequest(params, net.fixtures);
    await client.send(command.method, command.params, sessionId);
  } catch { /* the tab closed mid-flight; nothing left to answer */ }
}

async function auditOne(client, page, width, theme, settle, net) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await attemptAudit(client, page, width, theme, settle, net);
    } catch (error) {
      lastError = error;
    }
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
  let broken = 0;
  const rows = [...perPage.entries()].sort();
  for (const [page, entry] of rows) {
    const sum = KINDS.reduce((acc, kind) => acc + entry.totals[kind], 0);
    total += sum;
    const previous = baseline[page] || {};
    /* A viewport that failed to measure contributes 0 to every count, so its
     * page looks cleaner than it is. Comparing that against the baseline is how
     * a timeout got recorded as "0 findings" and every later healthy run then
     * read as a regression. Report the breakage instead of ranking it. */
    if (entry.failures.length) {
      broken += 1;
      console.log(`BROKEN     ${page.padEnd(24)} ${entry.failures.length} viewport(s) did not measure`);
      for (const failure of entry.failures) console.log(`           ! ${failure}`);
      continue;
    }
    const worse = KINDS.filter((kind) => entry.totals[kind] > (previous[kind] ?? 0));
    if (worse.length) regressions += worse.length;
    if (quiet && !sum && !worse.length) continue;
    const badge = worse.length ? "REGRESSED" : sum ? "  " : "ok";
    const detail = KINDS.filter((kind) => entry.totals[kind])
      .map((kind) => `${kind}=${entry.totals[kind]}`).join(" ");
    console.log(`${badge.padEnd(10)} ${page.padEnd(24)} ${detail}`);
    for (const worseKind of worse) {
      console.log(`           ↑ ${worseKind}: ${previous[worseKind] ?? 0} → ${entry.totals[worseKind]}`);
      /* Workers finish in whatever order Chrome hands them back, so samples are
       * sorted before printing — otherwise two identical runs produce diffs. */
      const samples = entry.samples.filter((s) => s.kind === worseKind)
        .sort((a, b) => `${a.width}${a.theme}${a.where}${a.detail}`
          .localeCompare(`${b.width}${b.theme}${b.where}${b.detail}`));
      for (const sample of samples.slice(0, 4)) {
        console.log(`             ${sample.width}px/${sample.theme} ${sample.where} — ${sample.detail}`);
      }
    }
  }
  return { regressions, total, broken };
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
    client = await launchChrome(await freePort(DEBUG_PORT), profile);
    await client.send("Browser.grantPermissions", { permissions: ["geolocation"] });
    const net = { record: flags.record, fixtures: loadFixtures(FIXTURES) };
    console.log(`Auditing ${pages.length} pages × ${flags.widths.join("/")}px × ${flags.themes.join("/")}`
      + (flags.record ? " — RECORDING fixtures from the live internet" : ` — ${net.fixtures.size} fixtures`));
    const results = await runPool(jobs, (job) =>
      auditOne(client, job.page, job.width, job.theme, flags.settle, net));
    const perPage = summarise(results);
    const failed = [...perPage.values()].filter((entry) => entry.failures.length).length;

    if (flags.record) {
      console.log(`\nFixtures in ${path.relative(ROOT, FIXTURES)}: ${loadFixtures(FIXTURES).size}`);
      return;
    }
    if (flags.write) {
      /* Writing a baseline from a run where pages failed to measure bakes their
       * zeros in as the accepted state, and every healthy run afterwards reads
       * as a regression. That is exactly how this gate started crying wolf. */
      if (failed) {
        console.error(`\n${failed} page(s) failed to measure — refusing to write a baseline from a broken run.`);
        report(perPage, baseline, true);
        process.exitCode = 1;
        return;
      }
      const next = Object.fromEntries([...perPage.entries()].map(([page, entry]) => [page, entry.totals]));
      fs.writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
      console.log(`\nBaseline written: ${path.relative(ROOT, BASELINE)}`);
      return;
    }
    const { regressions, total, broken } = report(perPage, baseline, flags.quiet);
    console.log(`\n${total} findings across ${pages.length} pages; `
      + `${regressions} category regressions vs baseline; ${broken} page(s) failed to measure.`);
    if (regressions || broken) process.exitCode = 1;
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
