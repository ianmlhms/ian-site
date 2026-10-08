/* Shared harness for the flow tests (scripts/flows/*.mjs).
 *
 * Every flow runs in headless Chromium at iPad portrait (820x1180) against a
 * local static server, with ALL Supabase traffic mocked — REST (/rest/v1),
 * auth (/auth/v1), edge functions (/functions/v1) and the Realtime WebSocket.
 * Nothing ever reaches a real account or the live site. Each run records a
 * video to <video dir>/<flow>.webm.
 *
 * Playwright is not a repo dependency: it is looked up in $PLAYWRIGHT_DIR, then
 * as a normal "playwright" import, then in the global playwright-cli install.
 * Video dir: $FLOW_VIDEO_DIR, else the overnight videos folder (when it exists),
 * else a temp folder. */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const VIEWPORT = { width: 820, height: 1180 };
export const ME = "11111111-1111-4111-8111-111111111111";
export const ME_NAME = "tester";

const OVERNIGHT_VIDEOS = "/Users/ian/Library/CloudStorage/OneDrive-Mulheims/website-overnight/videos";
const GLOBAL_PLAYWRIGHT = "/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright";
const SESSION_KEY = "sb-lvksqmgfwkfbblfsozfk-auth-token";
const MIME = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json", svg: "image/svg+xml", png: "image/png",
  webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", ico: "image/x-icon",
  webmanifest: "application/manifest+json", woff2: "font/woff2", txt: "text/plain", xml: "application/xml",
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function videoDir() {
  if (process.env.FLOW_VIDEO_DIR) return process.env.FLOW_VIDEO_DIR;
  if (fs.existsSync(path.dirname(OVERNIGHT_VIDEOS))) return OVERNIGHT_VIDEOS;
  return path.join(os.tmpdir(), "ian-flow-videos");
}

async function importPlaywright() {
  const dirs = [process.env.PLAYWRIGHT_DIR, GLOBAL_PLAYWRIGHT].filter(Boolean);
  try { return await import("playwright"); } catch { /* fall through to the folders */ }
  for (const dir of dirs) {
    for (const entry of ["index.mjs", "index.js"]) {
      const file = path.join(dir, entry);
      if (fs.existsSync(file)) return import(pathToFileURL(file).href);
    }
  }
  throw new Error("Playwright not found — set PLAYWRIGHT_DIR to a playwright package folder.");
}

function cachedChromiumPaths() {
  const base = path.join(os.homedir(), "Library/Caches/ms-playwright");
  if (!fs.existsSync(base)) return [];
  const found = [];
  for (const dir of fs.readdirSync(base).sort().reverse()) {
    if (dir.startsWith("chromium_headless_shell-")) {
      found.push(path.join(base, dir, "chrome-headless-shell-mac-arm64/chrome-headless-shell"));
    }
  }
  return found.filter((file) => fs.existsSync(file));
}

export async function launchBrowser() {
  const { chromium } = await importPlaywright();
  const errors = [];
  const attempts = [{}, ...cachedChromiumPaths().map((executablePath) => ({ executablePath })), { channel: "chrome" }];
  for (const opts of attempts) {
    try { return await chromium.launch(opts); } catch (error) { errors.push(String(error.message).split("\n")[0]); }
  }
  throw new Error("Could not launch Chromium:\n" + errors.join("\n"));
}

export function startServer(root = REPO) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || "/").split("?")[0]);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404; res.end("not found"); return;
    }
    res.setHeader("Content-Type", MIME[path.extname(file).slice(1)] || "application/octet-stream");
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

/* ---------- mocked Supabase: REST + auth + functions ---------- */
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
export function fakeJwt() {
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: ME, role: "authenticated", aud: "authenticated", exp })}.sig`;
}
function fakeUser() {
  return { id: ME, aud: "authenticated", role: "authenticated", email: "tester@example.test",
    user_metadata: { username: ME_NAME }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
}
function fakeSession() {
  return { access_token: fakeJwt(), refresh_token: "refresh-mock", token_type: "bearer", expires_in: 86400,
    expires_at: Math.floor(Date.now() / 1000) + 86400, user: fakeUser() };
}

const CORS = {
  "access-control-allow-origin": "*", "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS", "access-control-expose-headers": "*",
};

/* Turns a PostgREST ilike filter ("ilike.emm%") into a RegExp. */
export function ilikeRegExp(filter) {
  const pattern = String(filter).replace(/^ilike\./, "");
  const source = pattern.split("%").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${source}$`, "i");
}

/* backend = {
 *   rpc:    { name: (args) => data | { error: {message} } },
 *   tables: { name: ({ url, method, body }) => rows | { error } },
 *   functions: { name: (body) => data },
 *   calls: [] // filled in: { kind: "rpc"|"table"|"function", name, method, body }
 * } */
export function createBackend({ rpc = {}, tables = {}, functions = {} } = {}) {
  return { rpc, tables, functions, calls: [], callsTo(name) { return this.calls.filter((c) => c.name === name); } };
}

export async function mockSupabase(context, backend) {
  await context.route(/\.supabase\.co\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(data) });
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const raw = request.postData() || "";
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    const p = url.pathname;

    if (p.startsWith("/auth/v1/user")) return json(fakeUser());
    if (p.startsWith("/auth/v1/token")) return json(fakeSession());
    if (p.startsWith("/auth/v1/verify")) return json(fakeSession());   // verifyOtp (PIN login)
    if (p.startsWith("/auth/v1/logout")) return route.fulfill({ status: 204, headers: CORS });
    if (p.startsWith("/auth/v1/")) return json({});

    if (p.startsWith("/functions/v1/")) {
      const name = p.replace("/functions/v1/", "");
      backend.calls.push({ kind: "function", name, method: request.method(), body });
      const handler = backend.functions[name];
      return json(handler ? await handler(body) : {});
    }

    if (p.startsWith("/rest/v1/rpc/")) {
      const name = p.replace("/rest/v1/rpc/", "");
      backend.calls.push({ kind: "rpc", name, method: request.method(), body });
      const handler = backend.rpc[name];
      const out = handler ? await handler(body || {}) : null;
      if (out && out.error) return json(out.error, 400);
      return json(out === undefined ? null : out);
    }

    if (p.startsWith("/rest/v1/")) {
      const name = p.replace("/rest/v1/", "");
      const method = request.method();
      backend.calls.push({ kind: "table", name, method, body, query: url.search });
      const handler = backend.tables[name];
      const out = handler ? await handler({ url, method, body }) : [];
      if (out && out.error) return json(out.error, 400);
      const wantsObject = (request.headers()["accept"] || "").includes("vnd.pgrst.object");
      if (wantsObject) return Array.isArray(out) && out.length ? json(out[0]) : json({ code: "PGRST116", message: "no rows" }, 406);
      return json(method === "GET" || out ? out : []);
    }

    if (p.startsWith("/storage/v1/")) return json({});
    return json({});
  });
}

/* realtime-js (vsn 2.0.0) sends JSON broadcasts as a binary "user broadcast push":
 * [kind=3, joinRefLen, refLen, topicLen, eventLen, metaLen, encoding] + strings + payload. */
function decodeBinaryPush(buffer) {
  const bytes = Buffer.from(buffer);
  if (bytes[0] !== 3) return null;
  const [joinRefLen, refLen, topicLen, eventLen, metaLen] = [bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]];
  let at = 7;
  const take = (len) => { const text = bytes.subarray(at, at + len).toString("utf8"); at += len; return text; };
  const joinRef = take(joinRefLen) || null;
  const ref = take(refLen) || null;
  const topic = take(topicLen);
  const event = take(eventLen);
  take(metaLen);
  const payload = bytes[6] === 1 ? JSON.parse(bytes.subarray(at).toString("utf8")) : null;
  return [joinRef, ref, topic, "broadcast", { type: "broadcast", event, payload }];
}

/* ---------- mocked Supabase Realtime (Phoenix protocol v2) ----------
 * options.presence(topic, state) → { key: meta } of OTHER people present on that channel
 * options.onBroadcast({ topic, event, payload, state, send }) → react to a client broadcast;
 *   send(event, payload) delivers a broadcast back to the page. */
export async function mockRealtime(context, options = {}) {
  const log = [];
  await context.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    const channels = new Map();   // topic → { joinRef, key, meta }
    const emit = (joinRef, ref, topic, event, payload) => ws.send(JSON.stringify([joinRef, ref, topic, event, payload]));
    const sendPresence = (topic, state) => {
      const others = options.presence ? options.presence(topic, state) : {};
      const all = {};
      Object.entries(others).forEach(([key, meta]) => { all[key] = { metas: [{ phx_ref: `peer-${key}`, ...meta }] }; });
      if (state.key && state.meta) all[state.key] = { metas: [{ phx_ref: "me", ...state.meta }] };
      emit(state.joinRef, null, topic, "presence_state", all);
    };
    ws.onMessage((message) => {
      let frame;
      try { frame = typeof message === "string" ? JSON.parse(message) : decodeBinaryPush(message); } catch { return; }
      if (!Array.isArray(frame)) return;
      const [joinRef, ref, topic, event, payload] = frame;
      const reply = (response = {}) => ref && emit(joinRef, ref, topic, "phx_reply", { status: "ok", response });
      if (event === "phx_join") {
        const config = payload?.config || {};
        const state = { joinRef, key: config.presence?.key || "", meta: null };
        channels.set(topic, state);
        reply({ postgres_changes: (config.postgres_changes || []).map((c, i) => ({ ...c, id: i + 1 })) });
        if (config.presence?.enabled || state.key) sendPresence(topic, state);
      } else if (event === "presence") {
        const state = channels.get(topic);
        if (state && payload?.event === "track") { state.meta = payload.payload || {}; sendPresence(topic, state); }
        reply();
      } else if (event === "broadcast") {
        const state = channels.get(topic);
        log.push({ topic, event: payload?.event, payload: payload?.payload });
        if (state && options.onBroadcast) {
          options.onBroadcast({ topic, event: payload?.event, payload: payload?.payload, state,
            send: (name, data) => emit(null, null, topic, "broadcast", { type: "broadcast", event: name, payload: data }) });
        }
        reply();
      } else {
        reply();
      }
    });
  });
  return log;
}

/* ---------- flow runner ---------- */
const failuresOf = (h) => h.failures;

/* flow = { name, touch?: boolean, run: async (h) => void }
 * h = { page, context, origin, backend, expect, eq, step, pause, shot, signIn, goto } */
export async function runFlow(flow, { browser, origin, shotsDir = process.env.FLOW_SHOTS_DIR } = {}) {
  const ownBrowser = !browser;
  const own = ownBrowser ? await Promise.all([launchBrowser(), startServer()]) : null;
  const theBrowser = browser || own[0];
  const theOrigin = origin || own[1].origin;
  const tmpVideos = fs.mkdtempSync(path.join(os.tmpdir(), "flow-video-"));
  const context = await theBrowser.newContext({
    viewport: VIEWPORT, screenSize: VIEWPORT, deviceScaleFactor: 1, serviceWorkers: "block",
    hasTouch: !!flow.touch, isMobile: !!flow.touch,
    recordVideo: { dir: tmpVideos, size: VIEWPORT },
  });
  const base = flow.backend || {};
  const backend = createBackend({
    rpc: { has_pin: () => true, is_view_restricted: () => false, ...base.rpc },
    tables: { profiles: profilesTable, ...base.tables },
    functions: { "auth-pin": () => ({ hasPin: true, isLegacy: false }), ...base.functions },
  });
  await mockSupabase(context, backend);
  await mockRealtime(context, flow.realtime || {});
  const page = await context.newPage();
  const h = { page, context, origin: theOrigin, backend, failures: [], steps: [] };
  page.on("pageerror", (error) => h.failures.push(`uncaught page error: ${error.message}`));

  h.step = (label) => { h.steps.push(label); console.log(`  · ${label}`); };
  h.pause = (ms = 600) => page.waitForTimeout(ms);
  h.expect = (condition, message) => { if (!condition) h.failures.push(message); console.log(`    ${condition ? "ok  " : "FAIL"} ${message}`); return !!condition; };
  h.eq = (actual, expected, message) => {
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    if (!same) h.failures.push(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(`    ${same ? "ok  " : "FAIL"} ${message}${same ? "" : ` (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
    return same;
  };
  h.shot = async (label) => {
    if (!shotsDir) return;
    fs.mkdirSync(shotsDir, { recursive: true });
    await page.screenshot({ path: path.join(shotsDir, `${flow.name}.${label}.png`) });
  };
  h.signIn = async () => {
    await context.addInitScript(([key, session, name]) => {
      localStorage.setItem(key, JSON.stringify(session));
      localStorage.setItem("playerName", name);
    }, [SESSION_KEY, fakeSession(), ME_NAME]);
  };
  h.goto = async (rel) => { await page.goto(theOrigin + rel, { waitUntil: "domcontentloaded" }); };

  console.log(`\n▶ ${flow.name}`);
  try {
    await flow.run(h);
  } catch (error) {
    h.failures.push(`flow aborted: ${error.message.split("\n")[0]}`);
    console.log(`    FAIL flow aborted: ${error.message}`);
    try { await h.shot("aborted"); } catch { /* page may be gone */ }
  }
  await h.pause(800);
  const video = page.video();
  await context.close();
  let videoPath = null;
  try {
    const target = path.join(videoDir(), `${flow.name}.webm`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await video.saveAs(target);
    videoPath = target;
  } catch (error) { console.log(`    (video not saved: ${error.message})`); }
  fs.rmSync(tmpVideos, { recursive: true, force: true });
  if (ownBrowser) { await theBrowser.close(); own[1].server.close(); }
  const ok = failuresOf(h).length === 0;
  console.log(`${ok ? "✔ PASS" : "✘ FAIL"} ${flow.name}${videoPath ? `  → ${videoPath}` : ""}`);
  return { name: flow.name, ok, failures: h.failures, video: videoPath };
}

/* Lets each flow file run standalone: `node scripts/flows/<file>.mjs`. */
export function runIfMain(importMetaUrl, flow) {
  if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === importMetaUrl) {
    runFlow(flow).then((r) => process.exit(r.ok ? 0 : 1), (e) => { console.error(e); process.exit(2); });
  }
}

/* The people the mocked directory knows about. */
export const PEOPLE = [
  { id: "a1", username: "Emma", avatar: "🙂" },
  { id: "a2", username: "Emmi", avatar: "🦊" },
  { id: "a3", username: "Lemmy", avatar: "🎸" },
  { id: "a4", username: "Max", avatar: "🚲" },
  { id: "a5", username: "Lena", avatar: "📚" },
];

/* profiles table handler shared by flows: name search, class gate, everything else empty. */
export function profilesTable({ url }) {
  const username = url.searchParams.get("username");
  if (username && username.startsWith("ilike.")) {
    const re = ilikeRegExp(username);
    return PEOPLE.filter((p) => re.test(p.username)).sort((a, b) => a.username.localeCompare(b.username));
  }
  // account_checked_at is set so the one-time account-check card (account-check.js) stays out of other flows.
  if ((url.searchParams.get("select") || "").includes("class")) return [{ class: "4C6", class_confirmed: "2026-09", username: ME_NAME, account_checked_at: "2026-10-01T00:00:00Z" }];
  return [];
}
