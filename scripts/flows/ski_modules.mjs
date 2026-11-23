/* Flow: Ski Alpen's modules are cache-safe (the import map of pb/ski.html, scripts/game_importmap.py).
 *   A. Standalone and B. in the arcade's srcdoc frame: every module request carries ?v=<hash of the file>, each module is loaded once, the game runs.
 *   C. A deploy that changes one module, in the same browser profile, with a server that lets the browser keep every file for an hour:
 *      without a regenerated map the OLD config.js is used (the trap) and `game_importmap.py --check` says so; after the generator ran, the page
 *      asks the server for exactly the new config.js and gets the new content. The service worker must not be answered by the old page in the HTTP cache.
 * Own browser contexts without Playwright routes for A and C (a route switches the HTTP cache off); Supabase is unreachable there (chromiumArgs). */
import fs from "node:fs";
import path from "node:path";
import { REPO, runIfMain, startServer } from "./lib.mjs";
import { copySite as sharedCopySite, sha } from "./modules_lib.mjs";

const BOOT_TIMEOUT = 120000;
const MIN_MODULES = 50;
const CHANGED = "pb/ski/config.js";
const MARK = "\nglobalThis.__skiModuleMark = 'new';\n";
const URL_STANDALONE = "/pb/ski.html?debug=1&q=low";
const SW_PAGE = "/__sw.html";
const SW_PAGE_HTML = "<!doctype html><title>sw</title><script>window.swReady=navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(()=>true)</script>";
const SUPABASE_OFF = "--host-resolver-rules=MAP *.supabase.co ~NOTFOUND";

const isModule = (pathname) => /^\/pb\/ski\/.+\.m?js$/.test(pathname);

const copySite = () => sharedCopySite("ski-modules");

/** The module URLs a page asks for, as the browser sees them (also those its HTTP cache answers). */
function watchModules(page) {
  const urls = [];
  page.on("request", (request) => { const url = new URL(request.url()); if (isModule(url.pathname)) urls.push(url); });
  return urls;
}

const wrongVersions = (urls) => [...new Set(urls
  .filter((url) => url.searchParams.get("v") !== sha(fs.readFileSync(path.join(REPO, url.pathname.slice(1)))))
  .map((url) => url.pathname + url.search))];

const pickerUp = () => document.documentElement.dataset.skiScreen === "picker" || document.documentElement.dataset.bootError;
const skiing = () => document.documentElement.dataset.skiScreen === "ski";
const bootError = () => document.documentElement.dataset.bootError || "";

export const flow = {
  name: "ski-modules",
  fullChromium: true,
  chromiumArgs: [SUPABASE_OFF],
  viewport: { width: 1180, height: 820 },
  async run(h) {
    if (process.env.FLOW_OFFLINE_SUPABASE) { h.expect(true, "skipped: the offline mode has no loopback socket (no HTTP cache, no service worker)"); return; }
    const log = [];
    const overrides = new Map([[SW_PAGE, SW_PAGE_HTML]]);
    const keepAnHour = () => ({ "Cache-Control": "max-age=3600" });      // worse than the live host (no header at all): the browser may keep everything
    const { server, origin } = await startServer(REPO, { log, overrides, headers: keepAnHour });
    const context = await h.page.context().browser().newContext({ viewport: { width: 1180, height: 820 }, serviceWorkers: "allow" });
    const site = copySite();
    const errors = [];
    const modulesServed = (entries) => entries.filter((e) => isModule(e.path) && e.status === 200).map((e) => e.url);
    const open = async () => {
      const mark = log.length;
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      const urls = watchModules(page);
      await page.goto(origin + URL_STANDALONE, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(pickerUp, null, { timeout: BOOT_TIMEOUT });
      return { page, urls, served: modulesServed(log.slice(mark)), error: await page.evaluate(bootError), mark: await page.evaluate(() => globalThis.__skiModuleMark || "old") };
    };
    try {
      h.step("A. standalone: every module is requested with the hash of its content, once, and the game runs");
      const first = await open();
      h.eq(first.error, "", "the game boots");
      h.expect(first.urls.length >= MIN_MODULES, `${first.urls.length} module requests`);
      h.eq(wrongVersions(first.urls), [], "every module request carries ?v=<hash of the file>");
      h.eq(first.served.length, new Set(first.served.map((url) => url.split("?")[0])).size, "the server sent every module once (no second copy under another URL)");
      await first.page.click(".resort.ready");
      await first.page.waitForFunction(skiing, null, { timeout: BOOT_TIMEOUT });
      h.expect(true, "skiing in the free ride");
      await first.page.close();

      h.step("B. the arcade's srcdoc frame: the same import map applies");
      await h.signIn();
      const urls = watchModules(h.page);
      await h.goto("/pixelbreak.html?g=ski");
      await h.page.waitForFunction(() => { const d = document.getElementById("gf")?.contentDocument?.documentElement; return !!d && (d.dataset.skiScreen === "picker" || !!d.dataset.bootError); }, null, { timeout: BOOT_TIMEOUT });
      const frame = await (await h.page.$("#gf")).contentFrame();
      h.eq([frame.url(), await frame.evaluate(bootError)], ["about:srcdoc", ""], "the game boots in the srcdoc frame");
      h.expect(urls.length >= MIN_MODULES, `${urls.length} module requests from the frame`);
      h.eq(wrongVersions(urls), [], "every module request of the frame carries ?v=<hash of the file>");
      await frame.click(".resort.ready");
      await frame.waitForFunction(skiing, null, { timeout: BOOT_TIMEOUT });
      h.expect(true, "skiing in the arcade frame");
      await h.shot("arcade");

      h.step("C. a deploy changes config.js; the browser holds every file of the old version (max-age 1 h), the service worker is active");
      const worker = await context.newPage();
      await worker.goto(origin + SW_PAGE);
      h.eq(await worker.evaluate(() => window.swReady), true, "the service worker is installed and active");
      await worker.close();
      const warm = await open();
      h.eq(warm.served, [], "reopened: no module comes from the server, all of them from the browser's cache");
      await warm.page.close();
      const oldHash = sha(site.read(CHANGED));
      site.write(CHANGED, Buffer.concat([site.read(CHANGED), Buffer.from(MARK)]));
      const newHash = sha(site.read(CHANGED));
      overrides.set(`/${CHANGED}`, site.read(CHANGED));
      const forgotten = await open();
      h.eq(forgotten.mark, "old", "map not regenerated: the browser still runs the OLD config.js (this is what the check is for)");
      await forgotten.page.close();
      const check = site.generate("--check");
      h.expect(check.status === 1 && check.out.includes(CHANGED), `game_importmap.py --check fails and names ${CHANGED}`);
      h.eq(site.generate().status, 0, "the generator rewrites the map");
      h.eq(site.generate("--check").status, 0, "… and the check passes");
      overrides.set("/pb/ski.html", site.read("pb/ski.html"));
      const deployed = await open();
      h.eq(deployed.error, "", "after the deploy: the game boots");
      h.eq(deployed.served, [`/${CHANGED}?v=${newHash}`], `only config.js comes from the server, under its new hash (${oldHash} -> ${newHash})`);
      h.eq(deployed.mark, "new", "the page runs the NEW config.js at the first open, without a reload");
      h.eq(deployed.urls.filter((url) => url.search === `?v=${oldHash}`).length, 0, "the old config.js is not asked for any more");
      await deployed.page.close();

      h.step("a merge conflict inside the block: the generator replaces it");
      const html = site.read("pb/ski.html").toString("utf8");
      const line = html.split("\n").find((text) => text.startsWith(`"/${CHANGED}"`));
      site.write("pb/ski.html", html.replace(line, `<<<<<<< HEAD\n${line}\n=======\n${line.replace(newHash, oldHash)}\n>>>>>>> branch`));
      h.eq(site.generate("--check").status, 1, "conflict markers fail the check");
      h.eq([site.generate().status, site.read("pb/ski.html").toString("utf8") === html], [0, true], "one run of the generator restores the block");

      h.eq(errors, [], "no uncaught page errors");
    } finally {
      await context.close();
      server.close();
      fs.rmSync(site.root, { recursive: true, force: true });
    }
  },
};

runIfMain(import.meta.url, flow);
