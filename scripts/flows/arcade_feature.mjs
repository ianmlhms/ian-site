/* Flow — the dated Arcade feature (arcade-feature.js: Ski Alpen from Mon 23 Nov 2026 06:00 to Mon 7 Dec 2026 06:00,
 * Luxembourg). The clock is faked (Playwright clock.setFixedTime) before, inside and after the window:
 *   homepage   outside: today's arcade block (game of the week big, Schueberfouer · MTB · Kart · Tram small), no banner
 *              inside:  "Nei" banner, Ski Alpen big, the game of the week first of the 4 small tiles, Tram dropped
 *   hub        the "Nei: Ski Alpen" banner (keyboard: Enter opens the game) and a "Nei" tag on the Ski card
 * plus the ?featured=ski / ?featured=off preview, a page left open across 06:00, no horizontal scroll at iPad
 * landscape / portrait / phone, and no console errors.
 *
 * FEATURE_SHOTS_DIR=/some/dir also saves screenshots (outside + inside the window, light + dark) of the homepage top,
 * its arcade block and the hub top at 1180×820, 820×1180 and 390×844. */
import fs from "node:fs";
import path from "node:path";
import { runIfMain } from "./lib.mjs";

const LUX_06_00 = "2026-11-23T05:00:00Z";            // Mon 23 Nov 2026, 06:00 in Luxembourg (CET, UTC+1)
const BEFORE = "2026-11-23T04:59:00Z";               // 05:59
const INSIDE = "2026-11-30T12:00:00Z";
const LAST_SECOND = "2026-12-07T04:59:59Z";          // Mon 7 Dec, 05:59:59
const AFTER = "2026-12-07T05:00:00Z";                // Mon 7 Dec, 06:00
const ENDS_AT = "2026-11-30T00:00:00+01:00";
const NORMAL_TILES = ["park", "mtb", "kart-letzebuerg", "tram-sim"];
const FEATURED_TILES = ["tetris", "park", "mtb", "kart-letzebuerg"];
const SIZES = [
  { name: "ipad-landscape", width: 1180, height: 820 },
  { name: "ipad-portrait", width: 820, height: 1180 },
  { name: "phone", width: 390, height: 844 },
];

const visible = (page, selector) => page.$eval(selector, (el) => !!el.offsetParent || getComputedStyle(el).position === "fixed").catch(() => false);
const tileGames = (page) => page.$$eval(".gt-tiles a", (links) => links.filter((a) => a.offsetParent)
  .map((a) => new URL(a.href).searchParams.get("g")));

async function at(h, iso, url) {
  await h.page.clock.setFixedTime(new Date(iso));
  await h.goto(url);
  await h.page.waitForLoadState("load");
  if (url.startsWith("/index.html")) {
    await h.page.waitForFunction(() => !document.getElementById("gtWeek").classList.contains("loading"), null, { timeout: 15000 });
  }
  await h.pause(400);
}

async function expectHome(h, featured, label) {
  const { page } = h;
  h.eq(await page.evaluate(() => document.documentElement.getAttribute("data-arcade-feature")), featured ? "ski" : null, `${label}: <html data-arcade-feature>`);
  h.eq(await visible(page, "#gtNew"), featured, `${label}: "Nei" banner ${featured ? "shown" : "hidden"}`);
  h.eq(await visible(page, "#gtFeat"), featured, `${label}: Ski Alpen big tile ${featured ? "shown" : "hidden"}`);
  h.eq(await visible(page, "#gtWeek"), !featured, `${label}: game of the week big tile ${featured ? "hidden" : "shown"}`);
  h.eq(await tileGames(page), featured ? FEATURED_TILES : NORMAL_TILES, `${label}: the four small tiles`);
}

async function noOverflow(h, label) {
  for (const size of SIZES) {
    await h.page.setViewportSize({ width: size.width, height: size.height });
    await h.pause(150);
    const overflow = await h.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    h.expect(!overflow, `${label} @ ${size.name}: no horizontal scroll`);
  }
  await h.page.setViewportSize({ width: 820, height: 1180 });
}

async function shots(h, label, url, iso) {
  const dir = process.env.FEATURE_SHOTS_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  for (const scheme of ["light", "dark"]) {
    await h.page.emulateMedia({ colorScheme: scheme });
    for (const size of SIZES) {
      await h.page.setViewportSize({ width: size.width, height: size.height });
      await at(h, iso, url);
      await h.page.evaluate(() => Promise.all([...document.images].filter((img) => img.offsetParent).map((img) => {
        img.loading = "eager";
        return img.complete ? null : new Promise((done) => { img.onload = img.onerror = done; });
      })));
      const name = `${label}-${scheme}-${size.name}`;
      await h.page.screenshot({ path: path.join(dir, `${name}-top.png`) });
      if (url.startsWith("/index.html")) {
        await h.page.evaluate(() => document.querySelector(".gt-lbl a[href='pixelbreak.html']").scrollIntoView({ block: "start" }));
        await h.pause(300);
        await h.page.screenshot({ path: path.join(dir, `${name}-arcade.png`) });
      }
    }
  }
  await h.page.emulateMedia({ colorScheme: null });
  await h.page.setViewportSize({ width: 820, height: 1180 });
}

export const flow = {
  name: "arcade-feature",
  viewport: { width: 820, height: 1180 },
  backend: {
    rpc: {
      weekly_game: () => "tetris",
      weekly_board: () => [{ week: "2026-11-23", game_id: "tetris", ends_at: ENDS_AT, rank: null, user_id: null, username: null, score: null }],
    },
  },
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
    await h.goto("/privacy.html");
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem("site_lang", "lb"); });

    h.step("homepage at 05:59 on Mon 23 Nov: exactly today's layout");
    await at(h, BEFORE, "/index.html");
    await expectHome(h, false, "05:59");
    h.eq(await page.textContent("#gtWeekName"), "Tetris", "05:59: game of the week is the big tile");
    await noOverflow(h, "home 05:59");

    h.step("homepage at 06:00: Ski Alpen featured");
    await at(h, LUX_06_00, "/index.html");
    await expectHome(h, true, "06:00");
    h.eq((await page.textContent("#gtNew .arc-new-text")).trim(), "Ski Alpen10 echt Skigebidder an 3D · Free Ride · Challenges · Online", "banner text");
    h.eq(await page.textContent("#gtNew .arc-new-tag"), "Nei", "banner tag says Nei");
    h.eq(await page.getAttribute("#gtNew", "href"), "pixelbreak.html?g=ski", "banner opens Ski Alpen");
    h.eq(await page.textContent("#gtFeat h3"), "Ski Alpen", "big tile is Ski Alpen");
    h.eq(await page.getAttribute("#gtFeatPlay", "href"), "pixelbreak.html?g=ski", "big tile's Spillen opens Ski Alpen");
    h.expect(/zermatt-(640|1200)\.webp$/.test(await page.$eval("#gtFeat img", (img) => img.currentSrc || img.src)), "big tile shows the Zermatt picture");
    h.eq(await page.textContent("#gtWeekTileKick"), "🏆 Spill vun der Woch", "first small tile keeps the game-of-the-week label");
    h.eq(await page.textContent("#gtWeekTileName"), "Tetris", "first small tile is the game of the week");
    h.eq(await page.getAttribute("#gtWeekTile", "href"), "pixelbreak.html?g=tetris", "first small tile opens the game of the week");
    await noOverflow(h, "home 06:00");

    h.step("keyboard: the banner and the big tile's Spillen are reachable with Tab");
    await page.focus("#gtSearch");
    const reached = new Set();
    for (let i = 0; i < 60 && reached.size < 2; i += 1) {
      await page.keyboard.press("Tab");
      const id = await page.evaluate(() => document.activeElement?.id || "");
      if (id === "gtNew" || id === "gtFeatPlay") reached.add(id);
    }
    h.eq([...reached].sort(), ["gtFeatPlay", "gtNew"], "Tab reaches the banner and Spillen");

    h.step("homepage inside the window, its last second, and after it");
    await at(h, INSIDE, "/index.html");
    await expectHome(h, true, "30 Nov");
    await at(h, LAST_SECOND, "/index.html");
    await expectHome(h, true, "7 Dec 05:59:59");
    await at(h, AFTER, "/index.html");
    await expectHome(h, false, "7 Dec 06:00");

    h.step("a homepage left open across 06:00 switches by itself");
    await at(h, BEFORE, "/index.html");
    await expectHome(h, false, "open at 05:59");
    await page.clock.setFixedTime(new Date(LUX_06_00));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await h.pause(200);
    await expectHome(h, true, "same page at 06:00");

    h.step("preview: ?featured=ski before the window, ?featured=off inside it");
    await at(h, BEFORE, "/index.html?featured=ski");
    await expectHome(h, true, "?featured=ski at 05:59");
    await at(h, INSIDE, "/index.html?featured=off");
    await expectHome(h, false, "?featured=off inside the window");
    await at(h, BEFORE, "/index.html");
    await expectHome(h, false, "05:59 without the flag (the preview is not stored)");

    h.step("Arcade hub outside the window: no banner, no Nei tag");
    await at(h, BEFORE, "/pixelbreak.html");
    h.eq(await visible(page, "#arcNew"), false, "hub 05:59: no banner");
    h.eq(await page.$$eval(".tag.new-badge", (els) => els.length), 0, "hub 05:59: no Nei tag");

    h.step("Arcade hub inside the window: banner + Nei tag on the Ski card, Enter on the banner opens Ski Alpen");
    await at(h, LUX_06_00, "/pixelbreak.html");
    h.eq(await visible(page, "#arcNew"), true, "hub 06:00: banner shown");
    h.eq(await page.$$eval(".tag.new-badge", (els) => els.map((el) => el.closest(".game-card").querySelector(".game-name").textContent)), ["Ski Alpen"], "hub 06:00: Nei tag on the Ski card only");
    await page.evaluate(() => { window.__opened = null; window.openGame = (index) => { window.__opened = index; }; });
    await page.focus("#arcNew");
    await page.keyboard.press("Enter");
    await h.pause(200);
    h.eq(await page.evaluate(() => window.__opened === window.arcadeGameIndex("ski")), true, "Enter on the banner opens Ski Alpen in the hub");
    h.eq(new URL(page.url()).pathname, "/pixelbreak.html", "no page reload for the banner");
    await noOverflow(h, "hub 06:00");

    h.step("screenshots (FEATURE_SHOTS_DIR)");
    await shots(h, "home-before", "/index.html", BEFORE);
    await shots(h, "home-featured", "/index.html", LUX_06_00);
    await shots(h, "hub-before", "/pixelbreak.html", BEFORE);
    await shots(h, "hub-featured", "/pixelbreak.html", LUX_06_00);

    h.eq(errors, [], "no console errors");
  },
};

runIfMain(import.meta.url, flow);
