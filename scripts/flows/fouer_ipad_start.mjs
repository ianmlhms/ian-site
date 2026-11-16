/* Flow: Schueberfouer Tycoon "iPad start". A school iPad opens the game cold and has to be playing within 10 seconds.
 * Profile (same as mtb_ipad_start): 1080x810 landscape, deviceScaleFactor 2, touch, iPad Safari user agent (iPadOS says "Macintosh" + touch), CDP network 20 Mbit/s down / 5 Mbit/s up / 40 ms,
 * CDP CPU throttling 4x, brand-new browser context (cold cache). Files are served gzipped like the live site (own small server: the shared one sends raw bytes).
 * Measured: seconds until the loading screen is gone and the fair answers touch ("ready" = data-fouer-ready), the bytes that crossed the network until then,
 * then the background loading is allowed to finish (window.__fouerBg.done) and the total is reported. Gate: ready within 10 s; the menu answers a tap; no page errors.
 * Env FOUER_START_REPORT=1 prints the per-file list and the marks; FOUER_START_QUERY="?x=1" appends to the page URL. */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { runIfMain, createBackend, mockSupabase } from "./lib.mjs";
import { tapAt, tapFinger } from "./fouer_game.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PAGE = "/pb/fouer.html";
const IPAD_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAX_SECONDS = 10;
const NET = { offline: false, latency: 40, downloadThroughput: (20 * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 };
const CPU_RATE = 4;
const MB = 1e6;
const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", bin: "application/octet-stream", glb: "model/gltf-binary", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav" };
const COMPRESSIBLE = new Set(["html", "js", "mjs", "css", "json", "svg", "bin", "glb", "wav"]);

function startGzipServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || "/").split("?")[0]);
    const file = path.normalize(path.join(REPO, rel));
    if (!file.startsWith(REPO + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end("not found"); return; }
    const ext = path.extname(file).slice(1);
    res.setHeader("Content-Type", TYPES[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    let body = fs.readFileSync(file);
    if (COMPRESSIBLE.has(ext) && /gzip/.test(req.headers["accept-encoding"] || "")) { body = zlib.gzipSync(body, { level: 6 }); res.setHeader("Content-Encoding", "gzip"); }
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

export const flow = {
  name: "fouer-ipad-start",
  fullChromium: true,
  async run(h) {
    const browser = h.page.context().browser();
    const { server, origin } = await startGzipServer();
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

      h.step("iPad profile, cold cache: open the game, wait until it is playable");
      if (process.env.FOUER_START_PROFILE) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
      const t0 = Date.now();
      await page.goto(origin + PAGE + (process.env.FOUER_START_QUERY || ""), { waitUntil: "commit" });
      await page.waitForFunction(() => document.documentElement.dataset.fouerReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 180000, polling: 50 });
      const tReady = Date.now();
      if (process.env.FOUER_START_PROFILE) { const { profile } = await cdp.send("Profiler.stop"); fs.writeFileSync(process.env.FOUER_START_PROFILE, JSON.stringify(profile)); }
      const boot = await page.evaluate(() => ({ error: document.documentElement.dataset.bootError || "", level: window.ArcadeGfx ? window.ArcadeGfx.level() : "?", canvas: !!document.getElementById("fouerCanvas"), loadingGone: document.getElementById("loading").classList.contains("done") }));
      const secReady = (tReady - t0) / 1000, mbReady = bytesUntil(tReady) / MB;
      h.eq([boot.error, boot.canvas, boot.loadingGone], ["", true, true], "the game boots and the loading screen is gone");
      console.log(`    playable after ${secReady.toFixed(1)} s, ${mbReady.toFixed(2)} MB loaded (graphics level ${boot.level})`);
      h.expect(secReady <= MAX_SECONDS, `playable within ${MAX_SECONDS} s (${secReady.toFixed(1)} s)`);
      await h.shot("ipad-ready");

      h.step("the fair answers: the welcome UI is up and a touch on the fair does not break anything");
      await page.waitForTimeout(1500);
      const ui = await page.evaluate(() => ({ nodes: document.getElementById("ui").querySelectorAll("*").length, fabs: !!document.querySelector("#fabs button") }));
      h.expect(ui.nodes > 3 && ui.fabs, `the UI is built (${ui.nodes} nodes)`);
      await page.touchscreen.tap(540, 400);
      await h.pause(600);
      await h.shot("ipad-tap");

      h.step("background loading finishes, nothing breaks");
      await page.waitForFunction(() => !window.__fouerBg || window.__fouerBg.done, null, { timeout: 180000, polling: 200 });
      await h.pause(1500);
      const total = done.reduce((s, d) => s + d.bytes, 0) / MB;
      console.log(`    total loaded after the background work: ${total.toFixed(2)} MB`);
      if (process.env.FOUER_START_REPORT) {
        const marks = await page.evaluate(() => performance.getEntriesByType("mark").filter((m) => m.name.startsWith("fouer:") && !m.name.startsWith("fouer:load:")).map((m) => `${(m.startTime / 1000).toFixed(1)} s ${m.name}`));
        console.log(`      marks (page clock): ${marks.join(" | ")}`);
        for (const d of [...done].sort((a, b) => a.at - b.at)) console.log(`      ${((d.at - t0) / 1000).toFixed(1).padStart(5)} s ${(d.bytes / 1024).toFixed(0).padStart(6)} KB ${d.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 90)}`);
      }
      h.eq(errors.filter((e) => !/Failed to load resource/.test(e)), [], "zero page errors");
      console.log(`RESULT ready=${secReady.toFixed(2)}s readyMB=${mbReady.toFixed(2)} totalMB=${total.toFixed(2)} level=${boot.level}`);

      /* ---- after the background build (the async boot with the debug hooks: ?fouerAsync=1 keeps the progressive boot): walk, leave the walk, then build a first attraction */
      h.step("async boot + debug hooks: wait for the background build, walk forward, leave the walk");
      const fn = await context.newPage();           // a plain page (no throttling): this part checks that things WORK after the background build
      const errs2 = [];
      fn.on("pageerror", (e) => errs2.push(e.message));
      fn.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs2.push(m.text()); });
      await fn.goto(origin + PAGE + "?fouerDebug=1&fouerAsync=1&fouerNoFly=1&fouerTimeMode=noon&fouerWeather=clear", { waitUntil: "commit" });
      await fn.waitForFunction(() => document.documentElement.dataset.fouerReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000, polling: 50 });
      const early = await fn.evaluate(() => ({ deferred: window.__fouerBg && window.__fouerBg.deferred, full: document.documentElement.dataset.fouerFull || "" }));
      h.expect(early.deferred === true, "the progressive boot is on (?fouerAsync=1)");
      await fn.waitForFunction(() => window.__fouerBg && window.__fouerBg.done && window.__fouerGame, null, { timeout: 120000, polling: 100 });
      h.eq(await fn.evaluate(() => [window.__fouerBg.error, document.documentElement.dataset.fouerFull]), ["", "1"], "the background build finished without an error");
      const g = (fnSrc, arg) => fn.evaluate(([src, a]) => (0, eval)(src)(window.__fouerGame, a), [fnSrc.toString(), arg]);
      h.expect(await g((x) => Boolean(x.walk && x.crowd && x.ride && x.mask)), "the walk, the guests, the rides and the mask exist");
      await g((x) => { window.__fouerHooks.startWalk(); });
      await fn.waitForFunction(() => window.__fouerGame.walk.active, null, { timeout: 8000 });
      await g((x) => { x.walk.teleport(46, 56, 0); x.walk.setLook(0, 0); });
      await fn.waitForTimeout(400);
      const p0 = await g((x) => ({ x: x.walk.view.x, z: x.walk.view.z }));
      await fn.keyboard.down("KeyW");
      const ramp = [];
      for (let i = 0; i < 4; i++) { await fn.waitForTimeout(120); ramp.push(await g((x) => x.walk.speed)); }
      await fn.waitForTimeout(1500);
      const pace = await g((x) => x.walk.speed);
      const p1 = await g((x) => ({ x: x.walk.view.x, z: x.walk.view.z }));
      await fn.keyboard.up("KeyW");
      const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      h.expect(moved > 3, `holding forward for 2 s moves the walker (${moved.toFixed(1)} m)`);
      h.expect(ramp[0] < pace * 0.9 && ramp.every((v, i) => i === 0 || v >= ramp[i - 1] - 0.05), `the speed eases in (${ramp.map((v) => v.toFixed(1)).join(" -> ")} -> ${pace.toFixed(1)} m/s)`);
      await g((x) => { window.__fouerHooks.endWalk(); });
      await fn.waitForFunction(() => !window.__fouerGame.walk.active, null, { timeout: 8000 });
      h.expect(true, "the walk ends");

      h.step("after the background build: tap the glowing pitch, build the starter stall");
      await tapFinger({ page: fn, pause: (ms) => fn.waitForTimeout(ms) }, fn);
      await fn.locator(".sheet.build").waitFor({ timeout: 8000 });
      const card = fn.locator('.sheet .card [data-tut="build"]');
      await card.waitFor({ state: "visible", timeout: 8000 });
      await fn.waitForTimeout(500);
      const box = await card.boundingBox();
      await tapAt({ page: fn, pause: (ms) => fn.waitForTimeout(ms) }, box.x + box.width / 2, box.y + box.height / 2);
      await fn.waitForFunction(() => window.__fouerGame.game.builtCount() === 1, null, { timeout: 10000 });
      h.expect(true, "one attraction is built by taps (the build UI works after the background build)");
      await fn.waitForTimeout(1500);
      h.eq(errs2, [], "zero page errors after the background build, the walk and the build");
      await fn.close();
    } finally {
      await context.close();
      server.close();
    }
  },
};

runIfMain(import.meta.url, flow);
