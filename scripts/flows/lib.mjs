/* Shared harness for the flow tests (scripts/flows/*.mjs).
 *
 * Every flow runs in headless Chromium at iPad portrait (820x1180) against a
 * local static server, with ALL Supabase traffic mocked — REST (/rest/v1),
 * auth (/auth/v1), edge functions (/functions/v1) and the Realtime WebSocket.
 * FLOW_OFFLINE_SUPABASE=/path/to/pinned-umd.js also blocks all off-site assets
 * and serves local pages by interception when loopback sockets are unavailable.
 * Nothing ever reaches a real account or the live site. Flows run in power mode
 * by default (no video, half pixels + 30 fps for 3D, see "power mode" below;
 * FLOW_POWER=0 turns it off); a failed flow is re-run at full quality and
 * records a video to <video dir>/<flow>.webm.
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
import { createRequire } from "node:module";

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
  // a global install found through NODE_PATH (the cloud container): ESM imports ignore NODE_PATH, require does not
  try { const mod = await import(pathToFileURL(createRequire(import.meta.url).resolve("playwright")).href); return mod.chromium ? mod : mod.default; } catch { /* fall through to the folders */ }
  for (const dir of dirs) {
    for (const entry of ["index.mjs", "index.js"]) {
      const file = path.join(dir, entry);
      if (fs.existsSync(file)) return import(pathToFileURL(file).href);
    }
  }
  throw new Error("Playwright not found — set PLAYWRIGHT_DIR to a playwright package folder.");
}

function cachedChromiumPaths(fullChromium = false) {
  // Linux cloud sessions (Claude Code on the web): the preinstalled Chromium of the image, found next to the node tools
  if (process.platform === "linux") {
    const linux = ["/opt/pw-browsers/chromium/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"].filter((file) => fs.existsSync(file));
    if (linux.length) return linux;
  }
  const base = path.join(os.homedir(), "Library/Caches/ms-playwright");
  if (!fs.existsSync(base)) return [];
  const found = [];
  for (const dir of fs.readdirSync(base).sort().reverse()) {
    if (fullChromium && dir.startsWith("chromium-")) {
      found.push(path.join(base, dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"));
    } else if (!fullChromium && dir.startsWith("chromium_headless_shell-")) {
      found.push(path.join(base, dir, "chrome-headless-shell-mac-arm64/chrome-headless-shell"));
    }
  }
  return found.filter((file) => fs.existsSync(file));
}

/* Software WebGL for a machine without a GPU (Linux cloud sessions): the WebGL games render in SwiftShader. */
function linuxGlArgs() {
  return process.platform === "linux" ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : [];
}

/* ---------- power mode (scripts/power/REPORT.md, 22 Nov 2026): ON by default for every flow run ----------
 * A flow run (runFlow, runIfMain, run_all) has no video, runs in chrome-headless-shell on Metal, and its 3D flows
 * (fullChromium) render at deviceScaleFactor 0.5 with requestAnimationFrame capped at 30 fps. Each flow keeps its own Grafik
 * level. Measured: -55 % CPU seconds, -22 % peak memory, every flow green. When a flow fails in power mode, run_all (and a
 * standalone `node scripts/flows/<flow>.mjs`) runs it once more at full quality with video and reports both results.
 *   FLOW_POWER=0         off: the setup from before (video, Chrome for Testing for 3D flows, real pixels and frame rate)
 *   FLOW_FULL=1          the same, for look / screenshot / contact-sheet runs (full pixels)
 *   FLOW_SHOTS_DIR=dir   step screenshots: the flows run at real pixels and frame rate (no video, the shell on Metal)
 *   flow.measuresFrames  a flow that measures frame times (p95 / p99 budgets) always runs at real pixels and frame rate
 *   flow.fullQuality     the same for a flow that is a screenshot tool (gitter-shots)
 * The parts, each on or off on its own (FLOW_POWER=1 FLOW_NO_VIDEO=0 = power mode with video):
 *   FLOW_NO_VIDEO=1|0    video recording (it otherwise encodes a webm per flow and saves it into OneDrive)
 *   FLOW_ECONOMY=1|0     3D flows at deviceScaleFactor 0.5 (same CSS layout, 1/4 of the pixels) + requestAnimationFrame at FLOW_FPS
 *   FLOW_ECONOMY_GFX=low also force the Grafik level (localStorage arcade_gfx) where the flow set none. Not by default: a forced
 *                        "low" changes what a game offers (train-sim builds no saloon on low: no "inside" camera)
 *   FLOW_ECONOMY_DSF=x   another scale factor for FLOW_ECONOMY (1 = full pixels)
 *   FLOW_FPS=n           cap requestAnimationFrame at n frames per second (any flow; 0 = no cap; default 30 with FLOW_ECONOMY)
 *   FLOW_CHROME=shell    every flow in chrome-headless-shell. On macOS it gets --use-angle=metal --enable-gpu --ignore-gpu-blocklist
 *                        (without them the shell falls back to SwiftShader: the 3D flows then fail and burn 5-12x the CPU);
 *                        FLOW_SHELL_ARGS replaces those flags
 *   FLOW_CHROME=full     every flow in Google Chrome for Testing (new headless)
 *   FLOW_CDP=ws://...    connect to an already running CDP browser (Lightpanda) instead of launching one
 * Scripts that call launchBrowser() themselves (screenshot, sheet, bake and perf tools) are not flow runs: they keep the
 * browser from before unless they pass { power: true } or FLOW_POWER=1 is set; the screenshot / sheet tools also set FLOW_FULL=1. */
const SHELL_GPU_ARGS = process.platform === "darwin" ? "--use-angle=metal --enable-gpu --ignore-gpu-blocklist" : "";
const ECONOMY_FPS = 30;
const ECONOMY_DSF = 0.5;
const GFX_LEVELS = ["low", "medium", "high"];

/** Power mode for a flow run, read when the run starts (a script may set process.env.FLOW_FULL first). */
export function powerDefault() {
  return process.env.FLOW_POWER !== "0" && process.env.FLOW_FULL !== "1";
}

/* strict: ignore the part switches in the environment (the re-run after a failure is always full quality with video) */
function powerSettings(power, { strict = false } = {}) {
  const env = (name) => (strict ? undefined : process.env[name]);
  const on = (name) => env(name) === "1" || (power && env(name) !== "0");
  const economy = on("FLOW_ECONOMY");
  const fps = env("FLOW_FPS");
  return {
    economy,
    noVideo: on("FLOW_NO_VIDEO"),
    chrome: env("FLOW_CHROME") || (power ? "shell" : ""),
    fpsCap: fps !== undefined ? Number(fps) : (economy ? ECONOMY_FPS : 0),
    dsf: Number(env("FLOW_ECONOMY_DSF")) || ECONOMY_DSF,
    gfx: GFX_LEVELS.includes(env("FLOW_ECONOMY_GFX")) ? env("FLOW_ECONOMY_GFX") : "",
  };
}

/* Init script: requestAnimationFrame callbacks run at most `fps` times a second. Between two frames the page sleeps on a
 * setTimeout (no vsync wake-ups), so the GPU process renders 30 instead of 60 frames. Games clamp their frame dt
 * (ski: 50 ms), so game time stays right down to 20 fps. */
function rafCapScript(fps) {
  const interval = 1000 / fps;
  const nativeRaf = window.requestAnimationFrame.bind(window);
  let queue = [], timer = null, next = 0, seq = 0;
  const cancelled = new Set();
  const pump = (t) => {
    next = Math.max(next + interval, t - interval / 2);
    const run = queue; queue = []; timer = null;
    for (const [id, cb] of run) { if (cancelled.delete(id)) continue; try { cb(t); } catch (error) { setTimeout(() => { throw error; }); } }
  };
  window.requestAnimationFrame = (cb) => {
    const id = ++seq;
    queue.push([id, cb]);
    // wake half a vsync early, so the native frame that follows is the one due (not the one after it)
    if (timer === null) timer = setTimeout(() => nativeRaf(pump), Math.max(0, next - performance.now() - 8));
    return id;
  };
  window.cancelAnimationFrame = (id) => { cancelled.add(id); };
}

/* FLOW_BROWSER=webkit runs the flow in Playwright WebKit (the engine of the school iPads) instead of Chromium (the default).
 * WebKit has no --mute-audio: the games of this repo only make sound after a tap, which a headless flow never makes unless it says so. */
export async function launchBrowser({ fullChromium: wantsFull = false, args = [], power = process.env.FLOW_POWER === "1" && process.env.FLOW_FULL !== "1", strict = false } = {}) {
  const playwright = await importPlaywright();
  const { chrome } = powerSettings(power, { strict });
  const fullChromium = wantsFull || chrome === "full";   // FLOW_CHROME=full: every flow in Chrome for Testing
  if (process.env.FLOW_CDP) return playwright.chromium.connectOverCDP(process.env.FLOW_CDP);
  // every flow, not only the 3D ones: arcade-pad opens canvas / WebGL games and costs 9x the CPU in the shell on SwiftShader
  if (chrome === "shell" && process.env.FLOW_BROWSER !== "webkit") {
    const shell = cachedChromiumPaths(false)[0];
    if (shell) {
      const gpu = (process.env.FLOW_SHELL_ARGS ?? SHELL_GPU_ARGS).split(" ").filter(Boolean);
      return playwright.chromium.launch({ executablePath: shell, args: [...linuxGlArgs(), ...gpu, "--mute-audio", ...args] });
    }
    console.log("  (power mode: no chromium_headless_shell in ~/Library/Caches/ms-playwright, `npx playwright install --only-shell chromium`; using the browser from before)");
  }
  if (process.env.FLOW_BROWSER === "webkit") {
    if (!playwright.webkit) throw new Error("FLOW_BROWSER=webkit: this Playwright has no webkit");
    try { return await playwright.webkit.launch(); } catch (error) { throw new Error(`FLOW_BROWSER=webkit: WebKit did not start (npx playwright install webkit?): ${String(error.message).split("\n")[0]}`, { cause: error }); }
  }
  if (process.env.FLOW_BROWSER && process.env.FLOW_BROWSER !== "chromium") throw new Error(`FLOW_BROWSER must be chromium or webkit, got ${process.env.FLOW_BROWSER}`);
  const { chromium } = playwright;
  const errors = [];
  // WebGL flows need Chromium's full headless compositor. Headless Shell forces
  // SwiftShader on macOS and can stall rendering/input for tens of seconds
  // (unless it gets the Metal flags: FLOW_CHROME=shell above, measured in scripts/power/REPORT.md).
  const attempts = fullChromium
    ? [...cachedChromiumPaths(true).map(executablePath => ({ executablePath, args: linuxGlArgs() })), { channel: "chromium" }, { channel: "chrome" }, { args: linuxGlArgs() }]
    : [{}, ...cachedChromiumPaths().map(executablePath => ({ executablePath })), { channel: "chrome" }];
  for (const opts of attempts) {
    // --mute-audio: the games' sound must never play on the machine running the tests
    // R8f: no omnibox popup WebUI (full Chromium built 2-3 chrome:// renderers of ~80 MB per browser context for an address bar
    // nobody sees: ~250 MB of a three-player flow; unknown feature names are ignored by older builds)
    try { return await chromium.launch({ ...opts, args: [...(opts.args || []), "--mute-audio", "--disable-features=WebUIOmniboxPopup,WebUIOmniboxFullPopup,WebUIOmniboxAimPopup", ...args] }); } catch (error) { errors.push(String(error.message).split("\n")[0]); }
  }
  throw new Error("Could not launch Chromium:\n" + errors.join("\n"));
}

/* options.log       an array: every response is appended as { path, status, bytes } (bytes = body bytes sent), so a flow can assert what really crossed the network
 * options.overrides a Map of "/path" -> Buffer | string, served instead of the file on disk (a flow can "deploy" a changed file without touching the repo)
 * Both are read live, a flow may change them between page loads. */
export function startServer(root = REPO, { log = null, overrides = null, headers = null } = {}) {
  // Restricted sandboxes may refuse even loopback sockets. Offline flows serve
  // these URLs through Playwright interception instead of opening a socket.
  if (process.env.FLOW_OFFLINE_SUPABASE) return Promise.resolve({ server: { close() {} }, origin: "http://127.0.0.1:8765" });
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || "/").split("?")[0]);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.normalize(path.join(root, rel));
    const override = overrides ? overrides.get(rel) : undefined;
    if (override === undefined && (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory())) {
      res.statusCode = 404; res.end("not found"); if (log) log.push({ path: rel, status: 404, bytes: 0 }); return;
    }
    res.setHeader("Content-Type", MIME[path.extname(file).slice(1)] || "application/octet-stream");
    const body = override !== undefined ? Buffer.from(override) : fs.readFileSync(file);
    for (const [name, value] of Object.entries(headers ? headers(rel) : {})) res.setHeader(name, value);   // e.g. a Cache-Control the browser's HTTP cache obeys
    if (log) log.push({ path: rel, url: req.url, status: 200, bytes: body.length });
    res.end(body);
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
/** A table mock's rows the way PostgREST would send them: honours `order=<column>.asc|desc` and `limit`
 *  of the request (the messenger asks for the newest messages first). Never changes `rows`. */
export function orderedRows(url, rows) {
  const [column, direction] = (url.searchParams.get("order") || "").split(".");
  const sorted = column
    ? [...rows].sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (direction === "desc" ? -1 : 1))
    : [...rows];
  const limit = Number(url.searchParams.get("limit"));
  return Number.isFinite(limit) && limit > 0 ? sorted.slice(0, limit) : sorted;
}

export function createBackend({ rpc = {}, tables = {}, functions = {}, storage = null } = {}) {
  const dailyScores = new Map();
  const luxDay = () => new Intl.DateTimeFormat('sv-SE', { timeZone:'Europe/Luxembourg', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  const dailyRpc = {
    submit_daily_score: ({ p_game, p_score }) => {
      if(p_game !== 'paket-express-daily' || !Number.isSafeInteger(p_score) || p_score < 0 || p_score > 1000000) return false;
      const key = luxDay(), previous = dailyScores.get(key);
      if(previous !== undefined && p_score <= previous) return false;
      dailyScores.set(key,p_score);return true;
    },
    daily_board: ({ p_game, p_day }) => {
      if(p_game !== 'paket-express-daily') return [];
      const day = p_day || luxDay(), score = dailyScores.get(day);
      const next = new Date(day+'T00:00:00Z'); next.setUTCDate(next.getUTCDate()+1);
      const offsetHours = Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Luxembourg',hour:'2-digit',hourCycle:'h23'}).format(next));
      const ends_at = new Date(next.getTime()-offsetHours*3600000).toISOString();
      return [{day,game_id:p_game,ends_at,rank:score === undefined ? null : 1,user_id:score === undefined ? null : ME,username:ME_NAME,score:score ?? null,is_self:score !== undefined}];
    },
  };
  return { rpc: {...dailyRpc,...rpc}, tables, functions, storage, calls: [], callsTo(name) { return this.calls.filter((c) => c.name === name); } };
}

/* Stateful command endpoint; repeat=true deliberately redelivers IDs to test
 * client deduplication. A null cursor always establishes a fresh baseline. */
let nextClientCommandId = 1;
export function createClientCommandsMock({ repeat = false } = {}) {
  const commands = [];
  let clock = Date.now();
  const now = () => new Date(++clock).toISOString();
  const add = (action, game = null, reason = null) => {
    const command = { id: nextClientCommandId++, created_at: now(), action, game_id: game, reason };
    commands.push(command);
    return { ...command };
  };
  return {
    add,
    rpc: {
      client_commands_since: ({ p_since }) => ({
        now: now(), commands: p_since === null ? [] : commands
          .filter((command) => repeat || command.created_at > p_since).map((command) => ({ ...command })),
      }),
      issue_client_command: ({ p_action, p_game, p_reason }) => add(p_action, p_game, p_reason).id,
    },
  };
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

    if (p.startsWith("/storage/v1/")) {
      // optional handler: ({ url, method, body, raw }) => data | { raw: <route.fulfill options> }
      const method = request.method();
      backend.calls.push({ kind: "storage", name: p, method, body: body && typeof body === "object" ? body : null });
      if (backend.storage) {
        const out = await backend.storage({ url, method, body, raw: request.postDataBuffer() });
        if (out && out.raw) return route.fulfill({ headers: CORS, ...out.raw });
        if (out !== undefined) return json(out);
      }
      return json({});
    }
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

/* flow = { name, touch?: boolean, serviceWorkers?: "allow" (default "block": most flows must not see the worker), run: async (h) => void }
 * h = { page, context, origin, backend, expect, eq, step, pause, shot, signIn, goto, releaseMemory }
 * power: power mode (see "power mode" above); strict: ignore the FLOW_* part switches (the full-quality re-run) */
export async function runFlow(flow, { browser, origin, shotsDir = process.env.FLOW_SHOTS_DIR, power = powerDefault(), strict = false } = {}) {
  const ownBrowser = !browser || !!flow.chromiumArgs;   // a flow that needs special browser flags (fake camera) gets its own browser
  const own = ownBrowser ? await Promise.all([launchBrowser({ fullChromium: !!flow.fullChromium, args: flow.chromiumArgs || [], power, strict }), startServer()]) : null;
  const theBrowser = own ? own[0] : browser;
  const theOrigin = own ? own[1].origin : origin;
  const tmpVideos = fs.mkdtempSync(path.join(os.tmpdir(), "flow-video-"));
  const viewport = flow.viewport || VIEWPORT;          // a flow may ask for another size (a game in landscape)
  const settings = powerSettings(power, { strict });
  // a flow that measures frame times (mtb-smooth: p99) sets `measuresFrames: true`, a screenshot tool `fullQuality: true`, and a run
  // with step screenshots (FLOW_SHOTS_DIR) is a look run: real pixels and frame rate, or they would show the economy, not the game
  const realFrames = !!flow.measuresFrames || !!flow.fullQuality || !!shotsDir;
  const economy = settings.economy && !!flow.fullChromium && !realFrames;
  const context = await theBrowser.newContext({
    viewport, screenSize: viewport, deviceScaleFactor: economy ? settings.dsf : 1, serviceWorkers: flow.serviceWorkers || "block",
    hasTouch: !!flow.touch, isMobile: !!flow.touch,
    ...(flow.permissions ? { permissions: flow.permissions } : {}),
    ...(process.env.FLOW_COLOR_SCHEME ? { colorScheme: process.env.FLOW_COLOR_SCHEME } : {}),   // FLOW_COLOR_SCHEME=dark emulates prefers-color-scheme
    ...(settings.noVideo ? {} : { recordVideo: { dir: tmpVideos, size: viewport } }),
  });
  if (economy && settings.gfx) await context.addInitScript((level) => { try { if (!localStorage.getItem("arcade_gfx")) localStorage.setItem("arcade_gfx", level); } catch { /* private mode */ } }, settings.gfx);
  if (settings.fpsCap > 0 && !realFrames) await context.addInitScript(rafCapScript, settings.fpsCap);
  const base = flow.backend || {};
  const backend = createBackend({
    rpc: {
      has_pin: () => true, is_view_restricted: () => false,
      // A signed-in mock account counts as "already checked": without this the one-time account-check card
      // (account-check.js, 3 s after load) opened in the middle of unrelated flows and took the focus.
      my_profile_private: () => [{ account_checked_at: "2026-10-01T00:00:00Z" }],
      weekly_game: () => "reaction",
      weekly_board: () => [{ week: "2026-10-05", game_id: "reaction", ends_at: "2026-10-12T00:00:00+02:00", rank: null, user_id: null, username: null, score: null }],
      submit_weekly_score: () => true,
      touch_streak: () => ({ streak: 1, best: 1, is_new_day: false }),
      event_status: () => ({ event: "halloween-2026", active: false, count: 0, goal: 50, badge: false }),
      add_event_progress: () => ({ event: "halloween-2026", active: false, count: 0, goal: 50, badge: false }),
      leaderboard_tags: () => [],
      client_commands_since: () => ({ now: new Date().toISOString(), commands: [] }),
      issue_client_command: () => 1,
      ...base.rpc,
    },
    tables: { profiles: profilesTable, ...base.tables },
    functions: { "auth-pin": () => ({ hasPin: true, isLegacy: false }), ...base.functions },
    storage: base.storage || null,
  });
  // Optional offline run: serve the pinned UMD from a local, SRI-checked cache
  // and refuse every other off-site request. Supabase routes below stay mocked.
  if (process.env.FLOW_OFFLINE_SUPABASE) {
    const supabaseUmd = fs.readFileSync(process.env.FLOW_OFFLINE_SUPABASE);
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (["127.0.0.1", "localhost"].includes(url.hostname)) {
        let rel = decodeURIComponent(url.pathname);
        if (rel.endsWith("/")) rel += "index.html";
        const file = path.normalize(path.join(REPO, rel));
        if (!file.startsWith(REPO + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          return route.fulfill({ status: 404, body: "not found" });
        }
        return route.fulfill({ contentType: MIME[path.extname(file).slice(1)] || "application/octet-stream", body: fs.readFileSync(file) });
      }
      if (url.hostname === "cdn.jsdelivr.net" && url.pathname === "/npm/@supabase/supabase-js@2.117.1/dist/umd/supabase.js") {
        return route.fulfill({ contentType: "application/javascript", body: supabaseUmd, headers: CORS });
      }
      return route.abort();
    });
  }
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
  /* Between two heavy loads in ONE page (a Ski resort after another, a train route after another): collect the last one's garbage
   * now. V8 frees it late; without this 5 Ski resorts in one page reached 2.7-3.5 GB and browser-slot.py killed the job
   * (scripts/power/REPORT.md). Default: leave the page for about:blank first (the flow loads the next resort with h.goto).
   * { page }: another page of the flow (a sim page); { blank: false }: stay on the page (a game that switches routes in place).
   * Chromium only (CDP); elsewhere it only does the blank page. */
  h.releaseMemory = async ({ page: target = page, blank = true } = {}) => {
    if (blank) await target.goto("about:blank");
    try { const cdp = await target.context().newCDPSession(target); await cdp.send("HeapProfiler.collectGarbage"); await cdp.detach(); } catch { /* WebKit, Lightpanda: no CDP heap */ }
  };

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
  if (video) try {
    const target = path.join(videoDir(), `${flow.name}.webm`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await video.saveAs(target);
    videoPath = target;
  } catch (error) { console.log(`    (video not saved: ${error.message})`); }
  fs.rmSync(tmpVideos, { recursive: true, force: true });
  if (ownBrowser) { await theBrowser.close(); own[1].server.close(); }
  const ok = failuresOf(h).length === 0;
  console.log(`${ok ? "✔ PASS" : "✘ FAIL"} ${flow.name}${videoPath ? `  → ${videoPath}` : ""}`);
  return { name: flow.name, ok, failures: h.failures, video: videoPath, power: !!power };
}

/* A flow that failed in power mode, once more at full quality with video (its own browser and server). The result is the
 * full-quality run's, with the power run's failures in `powerFailures`. A pass here means power mode broke the flow (or it is
 * flaky): the summary says so. */
export async function rerunFull(flow, powerResult) {
  console.log(`\n↻ ${flow.name} failed in power mode: once more at full quality, with video`);
  const full = await runFlow(flow, { power: false, strict: true });
  return { ...full, rerun: true, powerFailures: powerResult.failures };
}

/* The summary lines of one result (a re-run shows both results) */
export function summaryLines(r) {
  const fails = (list) => list.map((f) => "        " + f);
  if (!r.rerun) return [`${r.ok ? "PASS" : "FAIL"}  ${r.name}`, ...(r.ok ? [] : fails(r.failures))];
  return [
    `${r.ok ? "PASS" : "FAIL"}  ${r.name}  (failed in power mode, ${r.ok ? "passed" : "failed again"} at full quality${r.video ? `, video ${r.video}` : ""})`,
    "        power mode:", ...fails(r.powerFailures),
    ...(r.ok ? ["        -> only power mode breaks it (or it is flaky): mark it measuresFrames / fullQuality, or fix it"] : ["        full quality:", ...fails(r.failures)]),
  ];
}

/* Lets each flow file run standalone: `node scripts/flows/<file>.mjs` (a power-mode failure is re-run like in run_all). */
export function runIfMain(importMetaUrl, flow) {
  if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === importMetaUrl) {
    (async () => {
      const first = await runFlow(flow);
      const r = !first.ok && first.power ? await rerunFull(flow, first) : first;
      if (r.rerun) console.log("\n" + summaryLines(r).join("\n"));
      return r;
    })().then((r) => process.exit(r.ok ? 0 : 1), (e) => { console.error(e); process.exit(2); });
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
