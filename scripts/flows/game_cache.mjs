/* Flow: game_cache. The worlds of the big games stay on the device (sw.js "Game data", pb/game-data.js, pb/<game>/data-hashes.json).
 *   A. MTB: the first open downloads the world (> 4 MB); the second open in the same browser profile fetches NO data bytes from the network, still revalidates its code
 *      (main.js reaches the server: the freeze problem must not come back), calls navigator.storage.persist() once, and says "vum Apparat gelueden".
 *   B. A "deploy" that changes one data file (new content + new hash in the manifest, served from an override, the repo is not touched): the next open downloads exactly that
 *      one file, the game boots with the new content, and the cache holds ONE version of that path (the old copy is gone).
 *   C. Schueberfouer: second open fetches 0 bytes of glacis-world.bin.   D. Zuchsimulator: the data of a started service is on the device at the second open.
 *   E. The data cache holds exactly one entry per path, every entry carries the hash of the manifest, and a file that is not in the manifest is never stored.
 * The network log is the flow server's own (every response it sends, with its body size), so it counts what the service worker fetched too.
 * Needs a real loopback socket (the worker cannot run on the interception-only offline mode of FLOW_OFFLINE_SUPABASE). */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REPO, runIfMain, startServer } from "./lib.mjs";

const HASH_LEN = 10;
const GAMEDATA_CACHE = "ianlu-gamedata-v1";
const LARGE_BYTES = 4 * 1024 * 1024;           // MTB's baked world is about 5.5 MB
const BOOT_TIMEOUT = 120000;
const TAIL_MS = 1500;                          // late requests (textures, streamed patches) must be in the log before it is read
const NOTE_TEXT = "vum Apparat gelueden";
const CHANGED_FILE = "falls.json";             // JSON: a trailing newline changes the bytes and nothing else
const SW_PAGE = "/__sw.html";
const SW_PAGE_HTML = "<!doctype html><title>sw</title><script>window.swReady=navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(()=>true)</script>";

const MTB_URL = "/pb/mtb.html?debug=1&q=low&time=noon&weather=clear";
const FOUER_URL = "/pb/fouer.html?fouerDebug=1&fouerNoFly=1&fouerQ=medium&fouerTimeMode=noon";
const TRAIN_URL = "/pb/train-sim.html?test=1&quality=low";

const sha = (body) => crypto.createHash("sha256").update(body).digest("hex").slice(0, HASH_LEN);
const isManifest = (entry) => entry.path.endsWith("/data-hashes.json");
const dataEntries = (entries, game) => entries.filter((e) => e.path.startsWith(`/pb/${game}/data/`) && e.status === 200);
const sumBytes = (entries) => entries.reduce((sum, e) => sum + e.bytes, 0);
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

export const flow = {
  name: "game-cache",
  fullChromium: true,
  serviceWorkers: "allow",
  async run(h) {
    if (process.env.FLOW_OFFLINE_SUPABASE) { h.expect(true, "skipped: the offline mode has no loopback socket for a service worker"); return; }
    const log = [];
    const overrides = new Map([[SW_PAGE, SW_PAGE_HTML]]);
    const { server, origin } = await startServer(REPO, { log, overrides });
    const errors = [];
    try {
      await h.context.addInitScript(() => {          // count the persistence requests of every page
        window.__persistCalls = 0;
        try {
          const original = navigator.storage.persist.bind(navigator.storage);
          navigator.storage.persist = () => { window.__persistCalls += 1; return original(); };
        } catch (_) { /* no storage manager */ }
      });
      const worker = await h.context.newPage();
      await worker.goto(origin + SW_PAGE);
      h.eq(await worker.evaluate(() => window.swReady), true, "the service worker is installed and active");
      await worker.close();

      /* one open of a game in a fresh page of the same browser context = the same profile, caches and worker. `ready` decides when the world is up. */
      const open = async (url, ready, afterReady = async () => {}) => {
        const mark = log.length;
        const page = await h.context.newPage();
        page.on("pageerror", (e) => errors.push(`${url}: ${e.message}`));
        await page.goto(origin + url, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(ready, null, { timeout: BOOT_TIMEOUT });
        await afterReady(page);
        await page.waitForTimeout(TAIL_MS);
        return { page, entries: log.slice(mark) };
      };
      const mtbReady = () => document.documentElement.dataset.mtbReady === "1" || !!document.documentElement.dataset.bootError;
      const bootError = (page) => page.evaluate(() => document.documentElement.dataset.bootError || "");
      const noteShown = (page) => page.evaluate((text) => document.body.textContent.includes(text), NOTE_TEXT);
      const waitNote = (page) => page.waitForFunction((text) => document.body.textContent.includes(text), NOTE_TEXT, { timeout: 8000, polling: 100 }).then(() => true, () => false);

      h.step("A. MTB: first open downloads the world, the second open fetches no data from the network");
      const mtbCold = await open(MTB_URL, mtbReady);
      const coldBytes = sumBytes(dataEntries(mtbCold.entries, "mtb"));
      h.eq(await bootError(mtbCold.page), "", "first open: no boot error");
      h.expect(coldBytes > LARGE_BYTES, `first open downloaded ${kb(coldBytes)} of MTB data (> 4 MB)`);
      h.expect(!(await noteShown(mtbCold.page)), "first open: no \"from this device\" note (the data came from the network)");
      h.eq(await mtbCold.page.evaluate(() => window.__persistCalls), 1, "storage.persist() is requested once per open");
      await mtbCold.page.close();

      const mtbWarm = await open(MTB_URL, mtbReady, async (page) => { h.expect(await waitNote(page), "second open: the page says it was loaded from this device (vum Apparat gelueden)"); });
      const warmData = dataEntries(mtbWarm.entries, "mtb").filter((e) => !isManifest(e));
      h.eq(await bootError(mtbWarm.page), "", "second open: no boot error");
      h.eq(warmData.map((e) => e.path), [], `second open: 0 data bytes from the network (${warmData.length} data requests)`);
      h.expect(mtbWarm.entries.some((e) => e.path === "/pb/mtb/main.js"), "second open: the game code is still fetched from the network (network-first, never frozen)");
      h.expect(mtbWarm.entries.some((e) => e.path === "/pb/mtb.html"), "second open: the game page is still fetched from the network");
      h.eq(await mtbWarm.page.evaluate(() => window.__persistCalls), 1, "storage.persist() once on the second open too");
      await mtbWarm.page.close();

      h.step("B. a deploy changes one data file and its hash: exactly that file is downloaded once, the old copy is deleted");
      const manifestPath = path.join(REPO, "pb/mtb/data-hashes.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const original = fs.readFileSync(path.join(REPO, "pb/mtb/data", CHANGED_FILE));
      const changed = Buffer.concat([original, Buffer.from("\n")]);
      const oldHash = manifest.files[CHANGED_FILE];
      const newHash = sha(changed);
      h.expect(oldHash && oldHash !== newHash, `the file's hash changes (${oldHash} -> ${newHash})`);
      overrides.set(`/pb/mtb/data/${CHANGED_FILE}`, changed);
      overrides.set("/pb/mtb/data-hashes.json", JSON.stringify({ ...manifest, files: { ...manifest.files, [CHANGED_FILE]: newHash } }));

      const mtbNew = await open(MTB_URL, mtbReady);
      const newData = dataEntries(mtbNew.entries, "mtb").filter((e) => !isManifest(e));
      h.eq(await bootError(mtbNew.page), "", "after the deploy: no boot error");
      h.eq(newData.map((e) => e.path), [`/pb/mtb/data/${CHANGED_FILE}`], "after the deploy: only the changed file is downloaded");
      h.eq(sumBytes(newData), changed.length, "after the deploy: its new size crossed the network once");
      const served = await mtbNew.page.evaluate((file) => fetch(`/pb/mtb/data/${file}`).then((r) => r.text()), CHANGED_FILE);
      h.eq(served, changed.toString("utf8"), "the page receives the NEW content, not the old copy");
      const versions = await mtbNew.page.evaluate(async ({ cacheName, file }) => {
        const keys = await (await caches.open(cacheName)).keys();
        return keys.map((k) => new URL(k.url)).filter((u) => u.pathname.endsWith(`/data/${file}`)).map((u) => u.search);
      }, { cacheName: GAMEDATA_CACHE, file: CHANGED_FILE });
      h.eq(versions, [`?v=${newHash}`], "the cache holds one version of the changed file, the new one");
      await mtbNew.page.close();

      const mtbAgain = await open(MTB_URL, mtbReady);
      h.eq(dataEntries(mtbAgain.entries, "mtb").filter((e) => !isManifest(e)).length, 0, "next open: the new file comes from the device, nothing is downloaded");
      await mtbAgain.page.close();

      h.step("C. Schueberfouer: the Glacis world bundle stays on the device");
      const fouerReady = () => document.documentElement.dataset.fouerReady === "1" || !!document.documentElement.dataset.bootError;
      const fouerCold = await open(FOUER_URL, fouerReady);
      const bundle = dataEntries(fouerCold.entries, "fouer").filter((e) => e.path.includes("glacis-world.bin"));
      h.eq(await bootError(fouerCold.page), "", "Schueberfouer first open: no boot error");
      h.expect(bundle.length === 1 && bundle[0].bytes > 500 * 1024, `first open downloaded the bundle (${kb(sumBytes(bundle))})`);
      await fouerCold.page.close();
      const fouerWarm = await open(FOUER_URL, fouerReady, async (page) => { h.expect(await waitNote(page), "Schueberfouer second open: \"vum Apparat gelueden\""); });
      h.eq(await bootError(fouerWarm.page), "", "Schueberfouer second open: no boot error");
      h.eq(dataEntries(fouerWarm.entries, "fouer").filter((e) => !isManifest(e)).length, 0, "Schueberfouer second open: 0 data bytes from the network");
      h.expect(fouerWarm.entries.some((e) => e.path === "/pb/fouer/main.js"), "Schueberfouer second open: the game code is still fetched from the network");
      await fouerWarm.page.close();

      h.step("D. Zuchsimulator: the data of a started service stays on the device");
      const trainMenu = () => window.__tsTest && window.__tsTest.state().phase === "menu" && !document.getElementById("bootStatus")?.textContent;
      const startService = async (page) => {
        await page.evaluate(() => window.__tsTest.startService("west", "railcar", "career"));
        await page.waitForFunction(() => window.__tsTest.state().phase === "running", null, { timeout: BOOT_TIMEOUT });
      };
      const trainCold = await open(TRAIN_URL, trainMenu, startService);
      const trainColdData = dataEntries(trainCold.entries, "train-sim").filter((e) => !isManifest(e));
      h.expect(trainColdData.length > 3, `first service start fetched ${trainColdData.length} data files (${kb(sumBytes(trainColdData))})`);
      await trainCold.page.close();
      const trainWarm = await open(TRAIN_URL, trainMenu, startService);
      const trainWarmData = dataEntries(trainWarm.entries, "train-sim").filter((e) => !isManifest(e));
      h.eq(trainWarmData.map((e) => e.path), [], `Zuchsimulator second start: 0 data bytes from the network (${trainWarmData.length} requests)`);
      await trainWarm.page.close();

      h.step("E. the data cache: one entry per path, every entry at the hash of its manifest, unlisted files are not stored");
      const check = await h.context.newPage();
      await check.goto(origin + SW_PAGE);
      const stored = await check.evaluate(async (cacheName) => {
        const cache = await caches.open(cacheName);
        const keys = (await cache.keys()).map((k) => new URL(k.url));
        const names = await caches.keys();
        return { names, entries: keys.map((u) => ({ path: u.pathname, v: u.searchParams.get("v") })) };
      }, GAMEDATA_CACHE);
      const dataKeys = stored.entries.filter((e) => e.path.includes("/data/"));
      const perPath = new Map();
      dataKeys.forEach((e) => perPath.set(e.path, (perPath.get(e.path) || 0) + 1));
      h.eq([...perPath.values()].filter((n) => n !== 1).length, 0, `one cached version per path (${perPath.size} paths)`);
      const hashes = {
        mtb: { ...JSON.parse(fs.readFileSync(manifestPath, "utf8")).files, [CHANGED_FILE]: newHash },
        fouer: JSON.parse(fs.readFileSync(path.join(REPO, "pb/fouer/data-hashes.json"), "utf8")).files,
        "train-sim": JSON.parse(fs.readFileSync(path.join(REPO, "pb/train-sim/data-hashes.json"), "utf8")).files,
      };
      const wrong = dataKeys.filter((e) => { const [, game, rest] = /^\/pb\/([^/]+)\/data\/(.+)$/.exec(e.path); return !hashes[game] || hashes[game][decodeURIComponent(rest)] !== e.v; });
      h.eq(wrong.map((e) => e.path), [], "every cached file carries the hash of its manifest");
      h.expect(stored.names.includes(GAMEDATA_CACHE), "the data cache exists next to the site cache");
      h.expect(!stored.entries.some((e) => /\.(?:js|html|css)$/.test(e.path)), "no code (js / html / css) is stored in the data cache");

      /* a file the manifest does not list: served, never stored */
      overrides.set("/pb/mtb/data/unlisted.bin", Buffer.from("not in the manifest"));
      const unlisted = await check.evaluate(async () => { const r = await fetch("/pb/mtb/data/unlisted.bin"); return { ok: r.ok, text: await r.text() }; });
      const afterKeys = await check.evaluate(async (cacheName) => (await (await caches.open(cacheName)).keys()).map((k) => k.url), GAMEDATA_CACHE);
      h.eq([unlisted.ok, unlisted.text], [true, "not in the manifest"], "an unlisted data file is still served");
      h.eq(afterKeys.filter((u) => u.includes("unlisted.bin")).length, 0, "an unlisted data file is not stored");
      await check.close();

      h.eq(errors, [], "no uncaught page errors in any open");
    } finally {
      server.close();
    }
  },
};

runIfMain(import.meta.url, flow);
