/* Flow: Ski Alpen "iPad start". A school iPad opens the game cold and has to be skiing within 10 seconds.
 * Profile (as mtb_ipad_start / kart_ipad_start): 1080x810 landscape, deviceScaleFactor 2, touch, iPad Safari user agent (iPadOS says
 * "Macintosh" + touch), CDP network throttling 20 Mbit/s down / 5 Mbit/s up / 40 ms latency, CDP CPU throttling 4x, brand-new browser
 * context (cold cache), text files served gzip-compressed like the live site (own tiny server). The page is opened the way players open
 * it (no debug flag, no quality override: the auto level of an iPad = low). Three.js comes from the real CDN, throttled like the rest.
 * Steps, each tapped at once: resort picker up ("ready") -> tap Val d'Isère · Tignes -> piste map, Start live ("start") -> tap Start ->
 * 3-2-1 -> "Lass!" ("skiing"). Gate: the Start button is live within 10 s of opening the page; skiing = that + the 3 s countdown + 1 s.
 * Then the remaining height tiles stream in while skiing; the total is reported. Env SKI_START_REPORT=1 prints the per-file list;
 * SKI_RESORT=<id> opens /pb/ski.html?resort=<id> and taps that resort (a returning player of it, or a shared link). */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { runIfMain, createBackend, mockSupabase, REPO } from "./lib.mjs";

const RESORT = /^[a-z0-9]+$/.test(process.env.SKI_RESORT || "") ? process.env.SKI_RESORT : "";   // SKI_RESORT=zermatt: a returning player of that resort (?resort=)
const PAGE = RESORT ? `/pb/ski.html?resort=${RESORT}` : "/pb/ski.html";
const IPAD_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAX_SECONDS = 10;
const COUNTDOWN_SECONDS = 3;
const NET = { offline: false, latency: 40, downloadThroughput: (20 * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 };
const CPU_RATE = 4;
const MB = 1e6;
const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", json: "application/json", webp: "image/webp", png: "image/png", svg: "image/svg+xml", woff2: "font/woff2", bin: "application/octet-stream" };
const COMPRESSIBLE = new Set(["html", "js", "css", "json", "svg"]);

function startGzipServer() {
  const cache = new Map();
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || "/").split("?")[0]);
    const file = path.normalize(path.join(REPO, rel));
    if (!file.startsWith(REPO + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end("not found"); return; }
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
  name: "ski-ipad-start",
  fullChromium: true,
  async run(h) {
    const { server, origin } = await startGzipServer();
    const browser = h.page.context().browser();
    const context = await browser.newContext({ viewport: { width: 1080, height: 810 }, screen: { width: 1080, height: 810 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false, userAgent: IPAD_UA, serviceWorkers: "block" });
    try {
      await context.addInitScript(() => { Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 6 }); });   // iPad (A13): 6 cores
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
      const tap = async (selector) => { const box = await page.locator(selector).first().boundingBox(); await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); };

      h.step("iPad profile, cold cache: open the game, wait for the resort picker");
      const t0 = Date.now();
      await page.goto(origin + PAGE, { waitUntil: "commit" });
      await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "picker" || document.documentElement.dataset.bootError, null, { timeout: 120000, polling: 50 });
      const tReady = Date.now();
      const boot = await page.evaluate(() => ({ error: document.documentElement.dataset.bootError || "", level: window.ArcadeGfx ? window.ArcadeGfx.level() : "?" }));
      h.eq(boot.error, "", "the game boots");
      console.log(`    resort picker after ${((tReady - t0) / 1000).toFixed(1)} s, ${(bytesUntil(tReady) / MB).toFixed(2)} MB (graphics level ${boot.level})`);
      await h.shot("ipad-picker");

      h.step("tap Val d'Isère · Tignes: the piste map; wait until Start is live");
      await tap(RESORT ? `.resort.ready[data-id="${RESORT}"]` : ".resort.ready");
      await page.waitForFunction(() => document.documentElement.dataset.skiStartReady === "1", null, { timeout: 120000, polling: 50 });
      const tStart = Date.now();
      const secStart = (tStart - t0) / 1000;
      console.log(`    Start live after ${secStart.toFixed(1)} s, ${(bytesUntil(tStart) / MB).toFixed(2)} MB`);
      h.expect(secStart <= MAX_SECONDS, `Start live within ${MAX_SECONDS} s (${secStart.toFixed(1)} s)`);
      await h.shot("ipad-map");

      h.step("tap Start: 3-2-1, then skiing");
      await tap("#startBtn");
      await page.waitForFunction(() => document.documentElement.dataset.skiRunning === "1", null, { timeout: 60000, polling: 50 });
      const tGo = Date.now();
      const secGo = (tGo - t0) / 1000;
      console.log(`    skiing after ${secGo.toFixed(1)} s (incl. the ${COUNTDOWN_SECONDS} s countdown), ${(bytesUntil(tGo) / MB).toFixed(2)} MB`);
      h.expect(secGo <= MAX_SECONDS + COUNTDOWN_SECONDS + 1, `skiing within ${MAX_SECONDS} s + the countdown (${secGo.toFixed(1)} s)`);
      const touch = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const pad = r("#touchControls .pad"); const btns = [...document.querySelectorAll("#touchControls .tbtn")].map((b) => b.getBoundingClientRect()); const area = pad.width * pad.height + btns.reduce((s, b) => s + b.width * b.height, 0); return { visible: !document.getElementById("touchControls").hidden, share: area / (innerWidth * innerHeight), minSide: Math.min(pad.height, ...btns.map((b) => Math.min(b.width, b.height))) }; });
      h.expect(touch.visible && touch.share < 0.15 && touch.minSide >= 44, `touch controls shown, ${(touch.share * 100).toFixed(1)} % of the screen, smallest target ${Math.round(touch.minSide)} px`);
      await h.pause(2500);
      await h.shot("ipad-ski");

      h.step("the rest of the resort streams in while skiing, nothing breaks");
      await page.waitForFunction(() => document.documentElement.dataset.skiTilesDone === "1", null, { timeout: 120000, polling: 250 });
      await h.pause(1000);
      const total = done.reduce((s, d) => s + d.bytes, 0) / MB;
      console.log(`    total loaded: ${total.toFixed(2)} MB`);
      if (process.env.SKI_START_REPORT) {
        const marks = await page.evaluate(() => performance.getEntriesByType("mark").filter((m) => m.name.startsWith("ski:")).map((m) => `${(m.startTime / 1000).toFixed(2)} ${m.name.slice(4)}`));
        console.log(`      marks (page clock): ${marks.join(" | ")}`);
        for (const d of [...done].sort((a, b) => a.at - b.at)) console.log(`      ${((d.at - t0) / 1000).toFixed(1).padStart(5)} s ${(d.bytes / 1024).toFixed(0).padStart(6)} KB ${d.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 90)}`);
      }
      h.eq(errors.filter((e) => !/Failed to load resource/.test(e)), [], "zero page errors");
      console.log(`RESULT picker=${((tReady - t0) / 1000).toFixed(2)}s start=${secStart.toFixed(2)}s ski=${secGo.toFixed(2)}s startMB=${(bytesUntil(tStart) / MB).toFixed(2)} totalMB=${total.toFixed(2)}`);
    } finally {
      await context.close();
      server.close();
    }
  },
};

runIfMain(import.meta.url, flow);
