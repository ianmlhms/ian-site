/* Flow: Ski Alpen reports which resort is played to ian.lu's own counter (count.js, the Worker in cloudflare/ian-count).
 * Starting the free ride in a resort sends exactly ONE extra view '/pb/ski.html?r=<resort>' (the picker itself is '/pb/ski.html');
 * the same inside the arcade frame (it reaches the hub's counter); the bot (?bot=1) reports nothing; and a browser marked as the
 * owner's (localStorage ic_skip) sends nothing at all. The endpoint is stubbed, nothing reaches the real Worker. */
import { runIfMain } from "./lib.mjs";

const ENDPOINT = "http://127.0.0.1:9/__count";
const RESORT_VIEW = /^\/pb\/ski\.html\?r=/;

export const flow = {
  name: "ski-count",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    const sent = [];
    await h.context.route("**/__count", async (route) => {
      try { sent.push(JSON.parse(route.request().postData() || "{}")); } catch { sent.push({ unreadable: true }); }
      await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    });
    await h.context.addInitScript((endpoint) => { window.__IAN_COUNT_TEST__ = { endpoint, sidPrefix: "test-" }; }, ENDPOINT);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const inFreeRide = () => page.waitForFunction(() => document.documentElement.dataset.skiScreen === "ski" || document.documentElement.dataset.bootError, null, { timeout: 90000 });
    const resortViews = () => sent.filter((s) => s.kind === "view" && RESORT_VIEW.test(s.path));

    h.step("standalone: picking a resort starts the free ride and sends exactly one ?r= view");
    await h.goto("/pb/ski.html?resort=zermatt&go=1&q=low");
    await inFreeRide();
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "boots without an error");
    await h.pause(1200);
    h.eq(sent.filter((s) => s.kind === "view").map((s) => s.path), ["/pb/ski.html", "/pb/ski.html?r=zermatt"], "page view, then the resort view (nothing else)");
    h.eq(resortViews()[0]?.title, "Matterhorn · Ski Alpen", "with the resort's name as the title");
    h.eq(new Set(sent.map((s) => s.sid)).size, 1, "all from one session id");

    h.step("a second start in the same page life (another run) sends no second view");
    sent.length = 0;
    await page.evaluate(() => window.__ski && window.__ski.start && window.__ski.start(window.__ski.game.piste.id));
    await h.pause(800);
    h.eq(resortViews().length, 0, "still only the one resort view per page life");

    h.step("arcade frame: the hub's counter gets the resort view (the frame itself sends nothing)");
    sent.length = 0;
    await page.evaluate(() => { try { sessionStorage.setItem("pb_ski_open_map", "free"); } catch (e) { /* ignore */ } });
    await h.goto("/pixelbreak.html?g=ski");
    await page.waitForFunction(() => { const f = document.getElementById("gf"); const d = f && f.contentDocument; return d && (d.documentElement.dataset.skiScreen === "ski" || d.documentElement.dataset.bootError); }, null, { timeout: 90000 });
    await h.pause(1200);
    const paths = sent.filter((s) => s.kind === "view").map((s) => s.path);
    h.eq(paths.filter((p) => RESORT_VIEW.test(p)).length, 1, `one resort view in the arcade (${paths.join(", ")})`);

    h.step("the scripted skier (?bot=1) reports nothing");
    sent.length = 0;
    await h.goto("/pb/ski.html?resort=killy&go=1&bot=1&q=low");
    await inFreeRide();
    await h.pause(1200);
    h.eq(resortViews().length, 0, "no resort view for the bot");

    h.step("the owner's browser (ic_skip) is not counted at all");
    await page.evaluate(() => localStorage.setItem("ic_skip", "1"));
    sent.length = 0;
    await h.goto("/pb/ski.html?resort=killy&go=1&q=low");
    await inFreeRide();
    await h.pause(1500);
    h.eq(sent.length, 0, "no request while ic_skip is set");
    h.eq(errors.length, 0, `no page errors ${errors.join(" | ")}`);
  },
};

runIfMain(import.meta.url, flow);
