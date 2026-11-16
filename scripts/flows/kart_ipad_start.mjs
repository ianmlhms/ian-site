/* Flow: Kart Lëtzebuerg "iPad start". A school iPad opens the game cold and has to be racing within 10 seconds.
 * Profile: 1080x810 landscape, deviceScaleFactor 2, touch, iPad Safari user agent (iPadOS says "Macintosh" + touch), CDP network throttling 20 Mbit/s down / 5 Mbit/s up / 40 ms latency,
 * CDP CPU throttling 4x, brand-new browser context (cold cache), files served gzip-compressed like the live site (own tiny server: the shared one sends plain bytes).
 * The page is opened the way players open it (no debug flag, no quality override: the auto level of an iPad = low). Three.js comes from the real CDN, throttled like everything else.
 * Measured: seconds until the menu is up and tappable ("ready"), seconds until the first race frame is on screen after an immediate tap on "Lass!" ("scene": the 3-2-1 runs),
 * seconds until "LASS!" ("racing"), and the bytes that crossed the network until then. Then the background loading may finish and the total is reported.
 * Gate: ready, and the scene (countdown running, the player is in the race), within 10 s of opening the page; racing = scene + the countdown.
 * Env KART_START_REPORT=1 prints the per-file list. KART_START_QUERY="?x" adds a query string. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { runIfMain, createBackend, mockSupabase, REPO } from "./lib.mjs";

const OVERLAY = process.env.KART_START_ROOT ? path.resolve(process.env.KART_START_ROOT) : null;   // KART_START_ROOT=<dir>: files found there win over the repo (the BEFORE numbers come from a clean origin/main export of the game)
const PAGE = "/pb/kart-letzebuerg.html";
const IPAD_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAX_SECONDS = 10;
const COUNTDOWN_SECONDS = 4;
const NET = { offline: false, latency: 40, downloadThroughput: (20 * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 };
const CPU_RATE = 4;
const MB = 1e6;
const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", json: "application/json", webp: "image/webp", png: "image/png", svg: "image/svg+xml", mp3: "audio/mpeg" };
const COMPRESSIBLE = new Set(["html", "js", "css", "json", "svg"]);

/* a static server that gzips text files like the live site does */
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

export const flow = {
  name: "kart-ipad-start",
  fullChromium: true,
  async run(h) {
    const { server, origin } = await startGzipServer();
    const browser = h.page.context().browser();
    const context = await browser.newContext({ viewport: { width: 1080, height: 810 }, screen: { width: 1080, height: 810 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false, userAgent: IPAD_UA, serviceWorkers: "block" });
    try {
      await context.addInitScript(() => { Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 6 }); });   // iPad (A13): 6 cores, Safari does not report deviceMemory
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

      h.step("iPad profile, cold cache: open the game, wait for the menu");
      const t0 = Date.now();
      await page.goto(origin + PAGE + (process.env.KART_START_QUERY || ""), { waitUntil: "commit" });
      await page.waitForFunction(() => { const m = document.getElementById("menu"); const f = document.getElementById("fatal"); return (m && !m.hidden) || (f && !f.hidden); }, null, { timeout: 120000, polling: 50 });
      const tReady = Date.now();
      const boot = await page.evaluate(() => ({ fatal: !document.getElementById("fatal").hidden, level: window.ArcadeGfx ? window.ArcadeGfx.level() : "?", btn: !!document.getElementById("btnStart") }));
      const secReady = (tReady - t0) / 1000, mbReady = bytesUntil(tReady) / MB;
      h.eq([boot.fatal, boot.btn], [false, true], "the game boots and the menu shows");
      console.log(`    menu ready after ${secReady.toFixed(1)} s, ${mbReady.toFixed(2)} MB loaded (graphics level ${boot.level})`);

      h.step("tap Lass! at once: the scene shows, 3-2-1, LASS!");
      const box = await page.locator("#btnStart").boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(() => { const hud = document.getElementById("hud"); return hud && !hud.hidden; }, null, { timeout: 60000, polling: 50 });
      const tScene = Date.now();
      const secScene = (tScene - t0) / 1000, mbScene = bytesUntil(tScene) / MB;
      console.log(`    scene up after ${secScene.toFixed(1)} s (countdown running), ${mbScene.toFixed(2)} MB loaded`);
      h.expect(secScene <= MAX_SECONDS, `scene up (player in the race) within ${MAX_SECONDS} s (${secScene.toFixed(1)} s)`);
      await h.shot("ipad-scene");
      await page.waitForFunction(() => { const c = document.getElementById("countdown"); return c && /^LASS/i.test((c.textContent || "").trim()); }, null, { timeout: 30000, polling: 50 });
      const tGo = Date.now();
      const secGo = (tGo - t0) / 1000, mbGo = bytesUntil(tGo) / MB;
      console.log(`    racing (LASS!) after ${secGo.toFixed(1)} s, ${mbGo.toFixed(2)} MB loaded`);
      h.expect(secGo <= MAX_SECONDS + COUNTDOWN_SECONDS, `racing within ${MAX_SECONDS} s + the ${COUNTDOWN_SECONDS} s countdown (${secGo.toFixed(1)} s)`);
      await h.pause(2500);
      await h.shot("ipad-race");

      h.step("background loading finishes, nothing breaks");
      await page.waitForFunction(() => !window.__klBg || window.__klBg.done, null, { timeout: 120000, polling: 200 });
      await h.pause(1500);
      const total = done.reduce((s, d) => s + d.bytes, 0) / MB;
      console.log(`    total loaded after the background work: ${total.toFixed(2)} MB`);
      if (process.env.KART_START_REPORT) {
        const marks = await page.evaluate(() => performance.getEntriesByType("mark").filter((m) => m.name.startsWith("kl:")).map((m) => `${(m.startTime / 1000).toFixed(2)} ${m.name.slice(3)}`));
        console.log(`      marks (page clock): ${marks.join(" | ")}`);
      }
      if (process.env.KART_START_REPORT) for (const d of [...done].sort((a, b) => a.at - b.at)) console.log(`      ${((d.at - t0) / 1000).toFixed(1).padStart(5)} s ${(d.bytes / 1024).toFixed(0).padStart(6)} KB ${d.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 90)}`);
      h.eq(errors.filter((e) => !/Failed to load resource/.test(e)), [], "zero page errors");
      console.log(`RESULT ready=${secReady.toFixed(2)}s readyMB=${mbReady.toFixed(2)} scene=${secScene.toFixed(2)}s sceneMB=${mbScene.toFixed(2)} go=${secGo.toFixed(2)}s goMB=${mbGo.toFixed(2)} totalMB=${total.toFixed(2)}`);
    } finally {
      await context.close();
      server.close();
    }
  },
};

runIfMain(import.meta.url, flow);
