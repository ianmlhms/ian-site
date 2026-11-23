/* Flows mtb-modules and fouer-modules: the modules of MTB Mëllerdall and Schueberfouer Tycoon are cache-safe (the import map of pb/mtb.html / pb/fouer.html, scripts/game_importmap.py).
 * The same three parts as ski-modules (scripts/flows/ski_modules.mjs):
 *   A. standalone and B. in the arcade's srcdoc frame: every module request carries ?v=<hash of the file>, each module is loaded once, the game runs.
 *   C. A deploy that changes one module, in the same browser profile, with a server that lets the browser keep every file for an hour:
 *      without a regenerated map the OLD module is used (the trap) and `game_importmap.py --check` says so; after the generator ran, the page asks the server for exactly
 *      the changed files under their new hashes and runs the new code at the first open.
 * MTB: the world-map worker (import maps do not reach workers) is started through import.meta.resolve, its own imports carry the hash: the changed module is one of the
 * worker graph (config.js), so the deploy has to change the worker, world-map.js and base-field.js too.
 * Own browser contexts without Playwright routes (a route switches the HTTP cache off); Supabase is unreachable there (chromiumArgs). */
import fs from "node:fs";
import path from "node:path";
import { REPO, runIfMain, startServer } from "./lib.mjs";
import { copySite, sha } from "./modules_lib.mjs";

const BOOT_TIMEOUT = 120000;
const SW_PAGE = "/__sw.html";
const SW_PAGE_HTML = "<!doctype html><title>sw</title><script>window.swReady=navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(()=>true)</script>";
const SUPABASE_OFF = "--host-resolver-rules=MAP *.supabase.co ~NOTFOUND";

const wrongVersions = (urls, root) => [...new Set(urls
  .filter((url) => url.searchParams.get("v") !== sha(fs.readFileSync(path.join(root, url.pathname.slice(1)))))
  .map((url) => url.pathname + url.search))];

function makeFlow(game) {
  const isModule = (pathname) => /^\/pb\/(?:mtb|fouer|park)\/.+\.m?js$/.test(pathname);
  const watchModules = (page) => {
    const urls = [];
    page.on("request", (request) => { const url = new URL(request.url()); if (isModule(url.pathname)) urls.push(url); });
    return urls;
  };
  const markOf = (name) => globalThis[name] || "old";
  return {
    name: game.name,
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
      const site = copySite(game.name);
      const errors = [];
      const modulesServed = (entries) => entries.filter((e) => isModule(e.path) && e.status === 200).map((e) => e.url);
      const open = async (url = game.url) => {
        const mark = log.length;
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        const urls = watchModules(page);
        await page.goto(origin + url, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(game.ready, null, { timeout: BOOT_TIMEOUT });
        return { page, urls, served: modulesServed(log.slice(mark)), error: await page.evaluate(() => document.documentElement.dataset.bootError || ""), mark: await page.evaluate(markOf, game.markName) };
      };
      try {
        h.step("A. standalone: every module is requested with the hash of its content, once, and the game runs");
        const first = await open();
        h.eq(first.error, "", "the game boots");
        h.expect(first.urls.length >= game.minModules, `${first.urls.length} module requests`);
        h.eq(wrongVersions(first.urls, REPO), [], "every module request carries ?v=<hash of the file>");
        h.eq(first.served.length, new Set(first.served.map((url) => url.split("?")[0])).size, "the server sent every module once (no second copy under another URL)");
        for (const needle of game.mustLoad) h.expect(first.served.some((url) => url.startsWith(needle)), `${needle} was loaded (under its hash)`);
        for (const specifier of game.extraImports) {
          const before = first.urls.length;
          await first.page.evaluate((target) => import(target), specifier);
          const added = first.urls.slice(before);
          h.expect(added.length > 0 && wrongVersions(added, REPO).length === 0, `import("${specifier}") asks for the hashed URL (${added.map((url) => url.pathname + url.search).join(", ")})`);
        }
        await first.page.close();
        for (const extra of game.extraPages) {
          const other = await context.newPage();
          other.on("pageerror", (e) => errors.push(e.message));
          const urls = watchModules(other);
          await other.goto(origin + extra, { waitUntil: "domcontentloaded" });
          await other.waitForTimeout(5000);
          h.expect(urls.length > 0 && wrongVersions(urls, REPO).length === 0, `${extra}: ${urls.length} module requests, all with the right hash`);
          h.eq(await other.evaluate(() => document.documentElement.dataset.bootError || ""), "", `${extra} boots`);
          await other.close();
        }

        h.step("B. the arcade's srcdoc frame: the same import map applies");
        await h.signIn();
        const urls = watchModules(h.page);
        await h.goto(game.arcade);
        await h.page.waitForFunction((src) => { const d = document.getElementById("gf")?.contentDocument?.documentElement; return !!d && (d.dataset[src] === "1" || !!d.dataset.bootError); }, game.readyKey, { timeout: BOOT_TIMEOUT });
        const frame = await (await h.page.$("#gf")).contentFrame();
        h.eq([frame.url(), await frame.evaluate(() => document.documentElement.dataset.bootError || "")], ["about:srcdoc", ""], "the game boots in the srcdoc frame");
        h.expect(urls.length >= game.minModules, `${urls.length} module requests from the frame`);
        h.eq(wrongVersions(urls, REPO), [], "every module request of the frame carries ?v=<hash of the file>");
        await h.shot("arcade");

        h.step(`C. a deploy changes ${game.changed}; the browser holds every file of the old version (max-age 1 h), the service worker is active`);
        const worker = await context.newPage();
        await worker.goto(origin + SW_PAGE);
        h.eq(await worker.evaluate(() => window.swReady), true, "the service worker is installed and active");
        await worker.close();
        const warm = await open();
        h.eq(warm.served, [], "reopened: no module comes from the server, all of them from the browser's cache");
        await warm.page.close();
        const oldHash = sha(site.read(game.changed));
        site.write(game.changed, Buffer.concat([site.read(game.changed), Buffer.from(`\nglobalThis.${game.markName} = 'new';\n`)]));
        overrides.set(`/${game.changed}`, site.read(game.changed));
        const forgotten = await open();
        h.eq(forgotten.mark, "old", `map not regenerated: the browser still runs the OLD ${game.changed} (this is what the check is for)`);
        await forgotten.page.close();
        const check = site.generate("--check");
        h.expect(check.status === 1 && check.out.includes(game.changed), `game_importmap.py --check fails and names ${game.changed}`);
        h.eq(site.generate().status, 0, "the generator rewrites the map");
        h.eq(site.generate("--check").status, 0, "… and the check passes");
        const changed = site.changedFiles();
        h.expect(changed.includes(game.page) && changed.includes(game.changed), `the deploy consists of ${changed.length} files: ${changed.join(", ")}`);
        for (const rel of changed) overrides.set(`/${rel}`, site.read(rel));
        const wanted = changed.filter((rel) => /\.m?js$/.test(rel)).map((rel) => `/${rel}?v=${sha(site.read(rel))}`).sort();
        const deployed = await open();
        h.eq(deployed.error, "", "after the deploy: the game boots");
        h.eq([...deployed.served].sort(), wanted, "only the changed modules come from the server, each under its new hash");
        h.eq(deployed.mark, "new", "the page runs the NEW code at the first open, without a reload");
        h.eq(deployed.urls.filter((url) => url.search === `?v=${oldHash}` && url.pathname === `/${game.changed}`).length, 0, `the old ${game.changed} is not asked for any more`);
        h.eq(wrongVersions(deployed.urls, site.root), [], "every module request after the deploy carries the hash of the deployed file");
        await deployed.page.close();

        h.eq(errors, [], "no uncaught page errors");
      } finally {
        await context.close();
        server.close();
        fs.rmSync(site.root, { recursive: true, force: true });
      }
    },
  };
}

export const flowMtb = makeFlow({
  name: "mtb-modules",
  url: "/pb/mtb.html?debug=1&q=low&time=noon&weather=clear",
  arcade: "/pixelbreak.html?g=mtb",
  page: "pb/mtb.html",
  changed: "pb/mtb/config.js",                       // also imported by the world-map worker: the worker graph is part of the deploy
  markName: "__mtbModuleMark",
  readyKey: "mtbReady",
  ready: () => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError,
  minModules: 40,
  mustLoad: ["/pb/mtb/world-map-worker.js?v=", "/pb/mtb/world-map.js?v="],   // the worker and what it imports
  extraImports: [],
  extraPages: [],
});

export const flowFouer = makeFlow({
  name: "fouer-modules",
  url: "/pb/fouer.html?fouerDebug=1&fouerNoFly=1&fouerQ=low&fouerTimeMode=evening&fouerWeather=clear",
  arcade: "/pixelbreak.html?g=park",
  page: "pb/fouer.html",
  changed: "pb/fouer/sim.js",
  markName: "__fouerModuleMark",
  readyKey: "fouerReady",
  ready: () => document.documentElement.dataset.fouerReady === "1" || document.documentElement.dataset.bootError,
  minModules: 40,
  mustLoad: [],
  extraImports: ["/pb/park/sim.js"],                // the frozen v1 kernel of pb/park, which legacy.js imports computed
  extraPages: ["/pb/park.html"],                    // the old Theme Park Tycoon page shares those modules (own import map)
});

runIfMain(import.meta.url, flowMtb);
