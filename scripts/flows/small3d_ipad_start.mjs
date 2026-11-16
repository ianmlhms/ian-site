/* Flow: the four smaller 3D Arcade games on a school iPad: Chill Drive, Stunt-Foerer (Drive Mad), Tower Defense, Paket Express.
 * Profile as kart_ipad_start / mtb_ipad_start: 1080x810 DPR 2, touch, iPad UA, CDP 20 Mbit/s down / 5 Mbit/s up / 40 ms, CPU 4x, brand-new context (cold cache), gzip served by an own tiny server.
 * Per game: seconds until the menu is up and tappable ("ready"), seconds until the player is in the game after an immediate tap ("play") and the bytes loaded until then.
 * Gate: play <= 10 s for every game; the auto graphics level of an iPad is "low"; a chosen "high" still runs without page errors.
 * Env SMALL3D_ROOT=<dir>: files found there win over the repo (the BEFORE numbers come from a clean export of origin/main; the "low" assertion is skipped then).
 * SMALL3D_ONLY=chill,drive,tower,paket limits the games. SMALL3D_REPORT=1 prints the per-file list. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { runIfMain, createBackend, mockSupabase, REPO } from "./lib.mjs";

const OVERLAY = process.env.SMALL3D_ROOT ? path.resolve(process.env.SMALL3D_ROOT) : null;
const IPAD_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAX_SECONDS = 10;
const NET = { offline: false, latency: 40, downloadThroughput: (20 * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 };
const CPU_RATE = 4;
const MB = 1e6;
const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", json: "application/json", webp: "image/webp", png: "image/png", svg: "image/svg+xml", mp3: "audio/mpeg", woff2: "font/woff2" };
const COMPRESSIBLE = new Set(["html", "js", "css", "json", "svg"]);

/* Each game: its page, when its menu is tappable, what to tap, and when the player is in the game. */
const GAMES = [
  { key: "chill", name: "Chill Drive", page: "/pb/chill-drive.html",
    ready: () => typeof state !== "undefined" && state === "menu" && !!document.getElementById("e0"),
    tap: "#e0", playing: () => state === "play" },
  { key: "drive", name: "Stunt-Foerer", page: "/pb/drive-mad.html",
    ready: () => document.documentElement.dataset.threeReady === "1" && document.querySelectorAll("#levels button").length > 0,
    tap: "#play", playing: () => document.getElementById("overlay").classList.contains("hidden") },
  { key: "tower", name: "Tower Defense", page: "/pb/towerdefense.html",
    ready: () => document.querySelectorAll("#levelGrid .levelButton:not([disabled])").length > 0,
    tap: "#levelGrid .levelButton:not([disabled])", playing: () => document.getElementById("overlay").classList.contains("hidden") },
  { key: "paket", name: "Paket Express", page: "/pb/paket-express.html",
    ready: () => { const b = document.getElementById("startShift"); return !!b && !b.disabled; },
    tap: "#startShift", playing: () => document.getElementById("menu").hidden && !document.getElementById("hud").hidden },
];

function startGzipServer() {
  const cache = new Map();
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || "/").split("?")[0]);
    let file = path.normalize(path.join(REPO, rel));
    const over = OVERLAY && path.normalize(path.join(OVERLAY, rel));
    if (over && over.startsWith(OVERLAY + path.sep) && fs.existsSync(over) && fs.statSync(over).isFile()) file = over;
    if (!file.startsWith(REPO + path.sep) && file !== over || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end("not found"); return; }
    const ext = path.extname(file).slice(1);
    res.setHeader("Content-Type", TYPES[ext] || "application/octet-stream");
    let body = fs.readFileSync(file);
    if (COMPRESSIBLE.has(ext) && /gzip/.test(req.headers["accept-encoding"] || "")) {
      if (!cache.has(file)) cache.set(file, zlib.gzipSync(body, { level: 6 }));
      body = cache.get(file); res.setHeader("Content-Encoding", "gzip");
    }
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

async function measure(h, browser, origin, game, { seedHigh = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1080, height: 810 }, screen: { width: 1080, height: 810 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false, userAgent: IPAD_UA, serviceWorkers: "block" });
  try {
    await context.addInitScript((high) => {
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 6 });   // iPad (A13): 6 cores, no deviceMemory
      if (high) { try { localStorage.setItem("arcade_gfx", "high"); } catch { /* none */ } }
    }, seedHigh);
    await mockSupabase(context, createBackend());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", NET);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });
    const urls = new Map(), done = [];
    cdp.on("Network.requestWillBeSent", (e) => urls.set(e.requestId, e.request.url));
    cdp.on("Network.loadingFinished", (e) => done.push({ url: urls.get(e.requestId) || "?", bytes: e.encodedDataLength, at: Date.now() }));
    const bytesUntil = (t) => done.filter((d) => d.at <= t).reduce((s, d) => s + d.bytes, 0);

    const t0 = Date.now();
    await page.goto(origin + game.page, { waitUntil: "commit" });
    await page.waitForFunction(game.ready, null, { timeout: 120000, polling: 50 });
    const tReady = Date.now();
    const level = await page.evaluate(() => (window.ArcadeGfx ? window.ArcadeGfx.level() : "none"));
    const box = await page.locator(game.tap).first().boundingBox();
    if (process.env.SMALL3D_PROFILE) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(game.playing, null, { timeout: 60000, polling: 50 });
    const tState = Date.now();
    if (process.env.SMALL3D_PROFILE) {
      const { profile } = await cdp.send("Profiler.stop");
      const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
      profile.samples.forEach((id, i) => { const n = byId.get(id), key = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`; self.set(key, (self.get(key) || 0) + (profile.timeDeltas[i] || 0)); });
      console.log("      profile of the tap (self ms):", [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${(v / 1000).toFixed(0)} ${k}`).join(" | "));
    }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const tPlay = Date.now();
    const out = { level, ready: (tReady - t0) / 1000, readyMB: bytesUntil(tReady) / MB, play: (tPlay - t0) / 1000, state: (tState - t0) / 1000, playMB: bytesUntil(tPlay) / MB };
    await h.pause(3000);   // a few seconds of real play: must not throw
    out.totalMB = done.reduce((s, d) => s + d.bytes, 0) / MB;
    if (process.env.SMALL3D_REPORT) for (const d of [...done].sort((a, b) => a.at - b.at)) console.log(`      ${((d.at - t0) / 1000).toFixed(1).padStart(5)} s ${(d.bytes / 1024).toFixed(0).padStart(6)} KB ${d.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 90)}`);
    out.errors = errors.filter((e) => !/Failed to load resource/.test(e));
    return out;
  } finally {
    await context.close();
  }
}

export const flow = {
  name: "small3d-ipad-start",
  fullChromium: true,
  async run(h) {
    const { server, origin } = await startGzipServer();
    const browser = h.page.context().browser();
    const only = (process.env.SMALL3D_ONLY || "").split(",").filter(Boolean);
    try {
      for (const game of GAMES.filter((g) => !only.length || only.includes(g.key))) {
        h.step(`${game.name}: iPad profile, cold cache, tap straight in`);
        const r = await measure(h, browser, origin, game);
        console.log(`    ${game.name}: ready ${r.ready.toFixed(1)} s / ${r.readyMB.toFixed(2)} MB, playing ${r.play.toFixed(1)} s (state switched at ${r.state.toFixed(1)} s) / ${r.playMB.toFixed(2)} MB, total ${r.totalMB.toFixed(2)} MB (graphics ${r.level})`);
        console.log(`RESULT ${game.key} ready=${r.ready.toFixed(2)}s play=${r.play.toFixed(2)}s playMB=${r.playMB.toFixed(2)} totalMB=${r.totalMB.toFixed(2)} level=${r.level}`);
        h.expect(r.play <= MAX_SECONDS, `${game.name}: playing within ${MAX_SECONDS} s (${r.play.toFixed(1)} s)`);
        h.eq(r.errors, [], `${game.name}: zero page errors`);
        if (OVERLAY === null) {
          h.eq(r.level, "low", `${game.name}: an iPad starts on the low graphics level`);
          const high = await measure(h, browser, origin, game, { seedHigh: true });
          h.eq(high.errors, [], `${game.name}: zero page errors on "Héich"`);
        }
      }
    } finally {
      server.close();
    }
  },
};

runIfMain(import.meta.url, flow);
