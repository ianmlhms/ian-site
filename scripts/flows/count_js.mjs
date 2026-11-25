/* Flow — ian.lu's own counter (count.js): index.html and the arcade still work with it, the first view is sent once with a sid that
 * lives in sessionStorage, opening a game from the arcade hub is a second view with the game's path, a game inside the frame sends
 * nothing itself, and without the test switch (a webdriver browser on localhost) nothing is sent at all. The endpoint is stubbed. */
import { runIfMain } from "./lib.mjs";

const ENDPOINT = "http://127.0.0.1:9/__count";   // never answers for real: the route below fulfils it

async function withCounter(h, enabled) {
  const sent = [];
  await h.context.route("**/__count", async (route) => {
    const request = route.request();
    try { sent.push(JSON.parse(request.postData() || "{}")); } catch { sent.push({ unreadable: true }); }
    await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
  });
  if (enabled) await h.context.addInitScript((endpoint) => { window.__IAN_COUNT_TEST__ = { endpoint, sidPrefix: "test-" }; }, ENDPOINT);
  return sent;
}

export const flow = {
  name: "count-js",
  async run(h) {
    const { page } = h;
    await h.signIn();
    const sent = await withCounter(h, true);

    h.step("home page loads with count.js: one view, first-visit flag, a test- sid, no query or address");
    await h.goto("/index.html");
    await page.waitForFunction(() => !!window.ianCount);
    await h.pause(800);
    h.eq(sent.length, 1, "exactly one hit after loading index.html");
    h.eq(sent[0]?.kind, "view", "it is a view");
    h.eq(sent[0]?.path, "/index.html", "with the page path");
    h.eq(sent[0]?.f, 1, "flagged as the first hit of the tab session");
    h.expect(/^test-[0-9a-f]{24}$/.test(sent[0]?.sid ?? ""), "random sid with the test prefix");
    h.expect(await page.evaluate((sid) => sessionStorage.getItem("ic_sid") === sid && !localStorage.getItem("ic_sid") && !document.cookie, sent[0]?.sid), "sid only in sessionStorage, no cookie");
    h.expect(await page.evaluate(() => document.querySelectorAll("#gtIndex a").length > 5), "home page still renders its index");
    const sid = sent[0]?.sid;

    h.step("arcade hub: loading it is a view, opening a game is another with ?g=<id>, the game frame sends nothing");
    sent.length = 0;
    await h.goto("/pixelbreak.html");
    await page.waitForFunction(() => !!window.ianCount && typeof openGame === "function");
    await h.pause(500);
    h.eq(sent.map((s) => [s.kind, s.path, s.f]), [["view", "/pixelbreak.html", 0]], "arcade page view (not a first hit any more)");
    h.eq(sent[0]?.sid, sid, "same sid in the same tab session");
    await page.evaluate(() => openGame(GAMES.findIndex((g) => g.id === "snake")));
    await page.waitForFunction(() => document.getElementById("gf")?.contentDocument?.readyState === "complete");
    await h.pause(1500);
    h.eq(sent.map((s) => [s.kind, s.path]), [["view", "/pixelbreak.html"], ["view", "/pixelbreak.html?g=snake"]], "game open = view with the game's path, nothing from the frame");
    h.expect(await page.evaluate(() => document.getElementById("overlay").classList.contains("open")), "the game opened");

    h.step("a deep link counts once (the hub does not add a second view)");
    sent.length = 0;
    await h.goto("/pixelbreak.html?g=snake");
    await page.waitForFunction(() => document.getElementById("gf")?.contentDocument?.readyState === "complete");
    await h.pause(1200);
    h.eq(sent.map((s) => s.path), ["/pixelbreak.html?g=snake"], "one view for the deep link");

    h.step("without the test switch (webdriver, not ian.lu) a page sends nothing and still has window.ianCount undefined");
    const other = await h.context.browser().newContext();
    const stray = [];
    await other.route("**/*", (route) => {
      const url = route.request().url();
      if (/__count|ian-count/.test(url)) stray.push(url);
      return url.startsWith(h.origin) ? route.continue() : route.abort();
    });
    const plain = await other.newPage();
    await plain.goto(`${h.origin}/index.html`, { waitUntil: "domcontentloaded" });
    await plain.waitForTimeout(1500);
    h.eq(stray.length, 0, "no counter request from a plain (webdriver) browser");
    h.expect(await plain.evaluate(() => !window.ianCount), "count.js stayed inactive");
    await other.close();
  },
};

runIfMain(import.meta.url, flow);
