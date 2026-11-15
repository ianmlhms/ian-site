#!/usr/bin/env node
/* Load-time numbers for the everyday pages, as a school iPad would see them:
 * iPad portrait 820×1180, CPU slowed 4×, every Supabase answer delayed (a round-trip on school Wi-Fi),
 * signed in, backend mocked (scripts/flows/lib.mjs) — never a real account.
 *
 *   python3 ~/Library/Caches/browser-slot.py node scripts/perf_pages.mjs            # this checkout
 *   node scripts/perf_pages.mjs --root /tmp/old-checkout                            # another checkout, to compare
 *   node scripts/perf_pages.mjs --runs 5 --delay 200 --json out.json
 *
 * Per page (median of the runs): first paint (FCP), "ready" = the moment the page's own content is on
 * screen (the selector below), layout shift (CLS), long main-thread tasks, requests and bytes.
 * The numbers are for comparing two versions on the same machine, not absolute iPad timings. */
import fs from "node:fs";
import path from "node:path";
import { REPO, VIEWPORT, ME, ME_NAME, createBackend, fakeJwt, launchBrowser, mockRealtime, mockSupabase, profilesTable, startServer } from "./flows/lib.mjs";

const SESSION_KEY = "sb-lvksqmgfwkfbblfsozfk-auth-token";
const CPU_SLOWDOWN = 4;
const READY_TIMEOUT_MS = 30000;
const SETTLE_MS = 1500;
const HISTORY_SIZE = 300;

const args = process.argv.slice(2);
const option = (name, fallback) => { const at = args.indexOf(`--${name}`); return at >= 0 && args[at + 1] ? args[at + 1] : fallback; };
const root = path.resolve(option("root", REPO));
const runs = Math.max(1, Number(option("runs", 3)));
const backendDelayMs = Math.max(0, Number(option("delay", 150)));
const jsonOut = option("json", null);

const CHATS = [
  { id: 1, display: "4C6", is_dm: false, invite_code: "ABC123", unread: true, last_preview: "Moien", last_sender: "Emma" },
  { id: 2, display: "Emma", is_dm: true, invite_code: null, unread: false, last_preview: "bis muer", last_sender: "Emma" },
];
const HISTORY = Array.from({ length: HISTORY_SIZE }, (_, index) => ({
  id: index + 1, group_id: 1, user_id: index % 3 ? "22222222-2222-4222-8222-222222222222" : ME,
  username: index % 3 ? "Emma" : ME_NAME, content: `Noriicht ${index + 1} — e bësse Text fir d'Zeil ze fëllen`,
  created_at: new Date(Date.UTC(2026, 10, 1, 8, 0, index)).toISOString(),
}));
const FRIENDS = Array.from({ length: 25 }, (_, index) => ({ user_id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`, username: `frend${index}` }));

/* page -> the selector that means "the content the visitor came for is there" */
const PAGES = [
  { name: "home", url: "/index.html", ready: "#gtWeek:not(.loading)" },
  { name: "messenger", url: "/messenger.html", ready: "#groupList .grp" },
  { name: "friends", url: "/friends.html", ready: "#friends .row" },
  { name: "grades", url: "/grades.html", ready: "#rows tr" },
  { name: "arcade", url: "/pixelbreak.html", ready: ".game-card" },
];

function fakeSession() {
  const now = Math.floor(Date.now() / 1000);
  return { access_token: fakeJwt(), refresh_token: "refresh-mock", token_type: "bearer", expires_in: 86400, expires_at: now + 86400,
    user: { id: ME, aud: "authenticated", role: "authenticated", email: "tester@example.test", user_metadata: { username: ME_NAME }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" } };
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
}

async function measurePage(browser, origin, serverLog, page) {
  const context = await browser.newContext({ viewport: VIEWPORT, screenSize: VIEWPORT, deviceScaleFactor: 1, serviceWorkers: "block" });
  const backend = createBackend({
    rpc: {
      has_pin: () => true, is_view_restricted: () => false, is_admin: () => false, admin_user_ids: () => [],
      weekly_game: () => "reaction", my_chats: () => CHATS, my_friends: () => FRIENDS,
      client_commands_since: () => ({ now: new Date().toISOString(), commands: [] }),
      my_profile_private: () => [{ account_checked_at: "2026-01-01T00:00:00Z" }],   // keeps the one-time account-check card away
    },
    tables: { profiles: profilesTable, messages: () => HISTORY },
    functions: { "auth-pin": () => ({ hasPin: true, isLegacy: false }) },
  });
  await mockSupabase(context, backend);
  await mockRealtime(context, {});
  // Registered last = asked first: hold every Supabase request for one "round-trip", then let the mock answer.
  await context.route(/\.supabase\.co\//, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, backendDelayMs));
    await route.fallback();
  });
  await context.addInitScript(([key, session, name]) => {
    localStorage.setItem(key, JSON.stringify(session));
    localStorage.setItem("playerName", name);
    window.__perf = { cls: 0, longTaskMs: 0 };
    try {
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__perf.cls += entry.value; }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__perf.longTaskMs += entry.duration; }).observe({ type: "longtask", buffered: true });
    } catch (error) { console.warn("perf observers unavailable", error); }
  }, [SESSION_KEY, fakeSession(), ME_NAME]);

  const tab = await context.newPage();
  const cdp = await context.newCDPSession(tab);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  const logStart = serverLog.length;
  let offsiteRequests = 0;
  tab.on("request", (request) => { if (!request.url().startsWith(origin)) offsiteRequests += 1; });

  const started = Date.now();
  await tab.goto(origin + page.url, { waitUntil: "commit" });
  let readyMs = NaN;
  try {
    await tab.waitForSelector(page.ready, { state: "visible", timeout: READY_TIMEOUT_MS });
    readyMs = Date.now() - started;
  } catch (error) { console.warn(`  ${page.name}: "${page.ready}" never appeared (${String(error.message).split("\n")[0]})`); }
  await tab.waitForTimeout(SETTLE_MS);

  const result = await tab.evaluate(() => {
    const paint = performance.getEntriesByType("paint").find((entry) => entry.name === "first-contentful-paint");
    const nav = performance.getEntriesByType("navigation")[0];
    return { fcp: paint ? paint.startTime : NaN, dcl: nav ? nav.domContentLoadedEventEnd : NaN, cls: window.__perf.cls, longTaskMs: window.__perf.longTaskMs };
  });

  let chatOpenMs = NaN;
  if (page.name === "messenger" && Number.isFinite(readyMs)) {
    const clicked = Date.now();
    await tab.click("#groupList .grp-open");
    try {
      await tab.waitForFunction((count) => document.querySelectorAll("#messages .msg").length >= count, HISTORY_SIZE, { timeout: READY_TIMEOUT_MS });
      chatOpenMs = Date.now() - clicked;
    } catch (error) { console.warn(`  messenger: history never rendered (${String(error.message).split("\n")[0]})`); }
  }

  const served = serverLog.slice(logStart);
  const supabaseCalls = backend.calls.length;
  await context.close();
  return {
    fcp: result.fcp, dcl: result.dcl, ready: readyMs, cls: result.cls, longTaskMs: result.longTaskMs, chatOpen: chatOpenMs,
    requests: served.length + offsiteRequests, kb: served.reduce((sum, entry) => sum + entry.bytes, 0) / 1024, supabaseCalls,
  };
}

const serverLog = [];
const { server, origin } = await startServer(root, { log: serverLog });
const browser = await launchBrowser();
const report = {};
console.log(`perf: ${root}\n      ${runs} run(s) per page, CPU ×${CPU_SLOWDOWN}, Supabase answers +${backendDelayMs} ms\n`);
console.log("page        FCP ms  ready ms  DCL ms   CLS    long-task ms  requests  KB (own)  Supabase calls");
try {
  for (const page of PAGES) {
    const samples = [];
    for (let run = 0; run < runs; run += 1) samples.push(await measurePage(browser, origin, serverLog, page));
    const row = Object.fromEntries(Object.keys(samples[0]).map((key) => [key, median(samples.map((sample) => sample[key]))]));
    report[page.name] = row;
    const fixed = (value, digits = 0) => (Number.isFinite(value) ? value.toFixed(digits) : "—");
    console.log(`${page.name.padEnd(11)} ${fixed(row.fcp).padStart(6)}  ${fixed(row.ready).padStart(8)}  ${fixed(row.dcl).padStart(6)}  ${fixed(row.cls, 3).padStart(6)}  ${fixed(row.longTaskMs).padStart(12)}  ${fixed(row.requests).padStart(8)}  ${fixed(row.kb).padStart(8)}  ${fixed(row.supabaseCalls).padStart(14)}`);
    if (Number.isFinite(row.chatOpen)) console.log(`            open a chat with ${HISTORY_SIZE} messages: ${fixed(row.chatOpen)} ms`);
  }
} finally {
  await browser.close();
  server.close();
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ root, runs, backendDelayMs, cpuSlowdown: CPU_SLOWDOWN, pages: report }, null, 2));
