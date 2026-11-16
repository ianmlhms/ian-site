/* Flow: MTB Mëllerdall "iPad start". A school iPad opens the game cold and has to be riding within 10 seconds.
 * Profile: 1080x810 landscape, deviceScaleFactor 2, touch, iPad Safari user agent (iPadOS says "Macintosh" + touch), CDP network throttling 20 Mbit/s down / 5 Mbit/s up / 40 ms latency,
 * CDP CPU throttling 4x, brand-new browser context (cold cache). The page is opened the way players open it (no debug flag, no quality override: the auto level of an iPad = low).
 * Measured: seconds until the start card is up and tappable ("ready"), seconds until the rider is really going (tap, 3-2-1, Go), and the bytes that crossed the network until then.
 * Then the background loading is allowed to finish and the total is reported. Gate: the start card (rider on the trail, Start live) within 10 s; riding after an immediate tap within 10 s + 3 s countdown + 3 s settle.
 * Env MTB_START_REPORT=1 prints the per-file list and the load marks. */
import { runIfMain, createBackend, mockSupabase } from "./lib.mjs";

const PAGE = "/pb/mtb.html";
const IPAD_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAX_SECONDS = 10;
const COUNTDOWN_SECONDS = 3;
const TAP_SETTLE_SECONDS = 3;      // a tap straight after the card shows finds the town / signs still being built behind it; "Go" waits for the town and the slowed frames stretch the 3-2-1
const NET = { offline: false, latency: 40, downloadThroughput: (20 * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 };
const CPU_RATE = 4;
const MB = 1e6;

export const flow = {
  name: "mtb-ipad-start",
  fullChromium: true,
  async run(h) {
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

      h.step("iPad profile, cold cache: open the game, wait for the start card");
      if (process.env.MTB_START_PROFILE) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
      const t0 = Date.now();
      await page.goto(h.origin + PAGE + (process.env.MTB_START_QUERY || ""), { waitUntil: "commit" });   // MTB_START_QUERY=?q=low: the same level on a build that predates the auto level
      await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000, polling: 50 });
      const tReady = Date.now();
      const boot = await page.evaluate(() => ({ error: document.documentElement.dataset.bootError || "", level: window.ArcadeGfx ? window.ArcadeGfx.level() : "?", btn: !!document.querySelector(".mcard .bigstart") }));
      if (process.env.MTB_START_PROFILE) { const { profile } = await cdp.send("Profiler.stop"); (await import("node:fs")).writeFileSync(process.env.MTB_START_PROFILE, JSON.stringify(profile)); }
      const secReady = (tReady - t0) / 1000, mbReady = bytesUntil(tReady) / MB;
      h.eq([boot.error, boot.btn], ["", true], "the game boots and the start card shows");
      console.log(`    ready after ${secReady.toFixed(1)} s, ${mbReady.toFixed(2)} MB loaded (graphics level ${boot.level})`);
      h.expect(secReady <= MAX_SECONDS, `start card up within ${MAX_SECONDS} s (${secReady.toFixed(1)} s)`);
      await h.shot("ipad-card");

      h.step("tap Fueren: 3-2-1-Go, then the rider rides");
      const box = await page.locator(".bigstart").boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForSelector(".mcount.go", { timeout: 20000, state: "attached" });
      const tRide = Date.now();
      const secRide = (tRide - t0) / 1000, mbRide = bytesUntil(tRide) / MB;
      console.log(`    riding after ${secRide.toFixed(1)} s (incl. the ${COUNTDOWN_SECONDS} s countdown), ${mbRide.toFixed(2)} MB loaded`);
      h.expect(secRide <= MAX_SECONDS + COUNTDOWN_SECONDS + TAP_SETTLE_SECONDS, `riding (tapped at once) within ${MAX_SECONDS} s + the countdown + the settle time (${secRide.toFixed(1)} s)`);
      await h.pause(2500);
      await h.shot("ipad-ride");

      h.step("background loading finishes, nothing breaks");
      await page.waitForFunction(() => !window.__mtbBg || (window.__mtbBg.done && window.__mtbBg.work), null, { timeout: 120000, polling: 200 });
      await h.pause(1500);
      const total = done.reduce((s, d) => s + d.bytes, 0) / MB;
      console.log(`    total loaded after the background work: ${total.toFixed(2)} MB`);
      if (process.env.MTB_START_REPORT) {
        const marks = await page.evaluate(() => performance.getEntriesByType("mark").filter((m) => m.name.startsWith("mtb:")).map((m) => `${(m.startTime / 1000).toFixed(1)} s ${m.name}`));
        console.log(`      marks (page clock): ${marks.join(" | ")}`);
        for (const d of [...done].sort((a, b) => a.at - b.at)) console.log(`      ${((d.at - t0) / 1000).toFixed(1).padStart(5)} s ${(d.bytes / 1024).toFixed(0).padStart(6)} KB ${d.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 90)}`);
      }
      h.eq(errors.filter((e) => !/Failed to load resource/.test(e)), [], "zero page errors");
      console.log(`RESULT ready=${secReady.toFixed(2)}s readyMB=${mbReady.toFixed(2)} ride=${secRide.toFixed(2)}s rideMB=${mbRide.toFixed(2)} totalMB=${total.toFixed(2)}`);
    } finally {
      await context.close();
    }
  },
};

runIfMain(import.meta.url, flow);
