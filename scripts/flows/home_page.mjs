/* Flow — the homepage (Gitter look, Nov 2026) as a visitor, a signed-in member
 * outside 4C6, and Ian: which index entries each one sees, the "Kont" tags, the
 * greeting, the game of the week, the wall with EVERY game of arcade-catalogue.js (each exactly once, right links,
 * small pictures loaded lazily, 44 px targets, chips + search, "Weider spillen", keyboard, the list without JavaScript),
 * the ⌘K search button, Luxembourgish only, no horizontal scroll from phone to desktop, and no console errors.
 *
 * HOME_SHOTS_DIR=/some/dir also saves screenshots per persona at 1180×760,
 * 820×1100, 1440×900 (+ a full-page one at 1180) and 390×844. */
import fs from "node:fs";
import path from "node:path";
import { runIfMain, fakeJwt, REPO } from "./lib.mjs";

const SESSION_KEY = "sb-lvksqmgfwkfbblfsozfk-auth-token";
const SIZES = [
  { name: "ipad-landscape", width: 1180, height: 760 },
  { name: "ipad-portrait", width: 820, height: 1100 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];
const PERSONAS = {
  visitor: null,
  member: { id: "22222222-2222-4222-8222-222222222222", email: "gilles@example.test", name: "Gilles", cls: "4C2", admin: false },
  ian: { id: "33333333-3333-4333-8333-333333333333", email: "konto@ian.lu", name: "Ian", cls: "4C6", admin: true },
};
const ENDS_AT = new Date(Date.now() + 53 * 3_600_000).toISOString();
let who = null;

function sessionFor(person) {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  return {
    access_token: fakeJwt(), refresh_token: "refresh-mock", token_type: "bearer", expires_in: 86400, expires_at: exp,
    user: { id: person.id, aud: "authenticated", role: "authenticated", email: person.email,
      user_metadata: { username: person.name }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
  };
}

/** the games as the page gets them: id, group, link */
function catalogueGames() {
  const source = fs.readFileSync(path.join(REPO, "arcade-catalogue.js"), "utf8");
  const part = source.slice(source.indexOf("var GAMES=["), source.indexOf("var DESC_I18N="));
  return part.split("\n").filter((line) => line.startsWith("{id:")).map((line) => {
    const field = (name) => new RegExp(`[,{]${name}:"([^"]+)"`).exec(line)?.[1] || null;
    return { id: field("id"), group: field("group"), href: field("go") || field("href") || `pixelbreak.html?g=${field("id")}` };
  });
}

const wallTiles = (page) => page.$$eval("#gtWall .gw-t", (links) => links.map((a) => ({ id: a.dataset.game, group: a.closest("li").dataset.group, href: a.getAttribute("href"), app: a.dataset.app })));
const shownTiles = (page) => page.$$eval("#gtWall .gw-t", (links) => links.filter((a) => a.offsetParent).map((a) => a.dataset.game));
const sorted = (list) => [...list].sort();

async function checkWall(h, label) {
  const { page } = h;
  const games = catalogueGames();
  const tiles = await wallTiles(page);
  h.eq(sorted(tiles.map((t) => t.id)), sorted(games.map((g) => g.id)), `${label}: every game of the catalogue stands in the wall exactly once (${games.length})`);
  h.eq(tiles.filter((t) => { const g = games.find((x) => x.id === t.id); return g.href !== t.href || g.group !== t.group || !t.app; }), [], `${label}: links, groups and data-app of all tiles`);
  for (const gone of ["o-tictactoe", "o-reversi", "o-maumau"]) h.expect(!tiles.some((t) => t.id === gone), `${label}: ${gone} is gone`);
  h.eq(await page.textContent("#gtCount"), `${games.length} Spiller`, `${label}: the count next to "Arcade"`);
}

async function visibleIndex(page) {
  return page.$$eval("#gtIndex [data-col]", (cols) => cols.filter((col) => !col.hidden).map((col) => ({
    col: col.dataset.col,
    items: [...col.querySelectorAll("a")].filter((a) => !a.hidden).map((a) => a.getAttribute("href")),
  })));
}

async function shots(h, label) {
  const dir = process.env.HOME_SHOTS_DIR;
  for (const size of SIZES) {
    await h.page.setViewportSize({ width: size.width, height: size.height });
    await h.pause(250);
    const overflow = await h.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    h.expect(!overflow, `${label} @ ${size.name}: no horizontal scroll`);
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      await h.page.screenshot({ path: path.join(dir, `home-${label}-${size.name}.png`) });
      if (size.name === "ipad-landscape") await h.page.screenshot({ path: path.join(dir, `home-${label}-${size.name}-full.png`), fullPage: true });
    }
  }
  await h.page.setViewportSize({ width: 820, height: 1180 });
}

async function become(h, person) {
  who = person;
  await h.goto("/privacy.html");
  await h.page.evaluate(([key, session]) => {
    localStorage.clear();
    localStorage.setItem("site_lang", "lb");
    if (session) localStorage.setItem(key, JSON.stringify(session));
  }, [SESSION_KEY, person ? sessionFor(person) : null]);
  await h.goto("/index.html");
  await h.page.waitForFunction(() => !document.getElementById("gtWeek").classList.contains("loading"), null, { timeout: 15000 });
  await h.pause(700);
}

export const flow = {
  name: "home-page",
  viewport: { width: 820, height: 1180 },
  backend: {
    rpc: {
      is_admin: () => who?.admin === true,
      weekly_game: () => "tetris",
      weekly_board: () => [{ week: "2026-11-02", game_id: "tetris", ends_at: ENDS_AT, rank: null, user_id: null, username: null, score: null }],
    },
    tables: {
      profiles: () => (who ? [{ class: who.cls, class_confirmed: "2026-09", username: who.name, account_checked_at: "2026-10-01T00:00:00Z" }] : []),
    },
  },
  async run(h) {
    const { page, context } = h;
    const errors = [];
    page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
    // The shared mock answers /auth/v1/user with its own test user; answer as the current persona.
    await context.route(/\.supabase\.co\/auth\/v1\/user/, (route) => route.fulfill({
      status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
      body: JSON.stringify(who ? sessionFor(who).user : {}),
    }));

    h.step("visitor");
    await become(h, PERSONAS.visitor);
    h.eq(await visibleIndex(page), [
      { col: "school", items: ["grades.html"] },
      { col: "friends", items: ["messenger.html", "friends.html"] },
      { col: "travel", items: ["bus.html", "trails/", "mtb/"] },
    ], "visitor: public entries only, empty 'Mäin' column dropped");
    h.eq(await page.$$eval("#gtIndex .kont", (els) => els.filter((e) => e.offsetParent).length), 3, "visitor: three 'Kont' tags");
    h.expect(await page.isVisible("#gtFree"), "visitor: 'gratis Kont' link shown");
    h.expect(!(await page.isVisible(".gt-admin")), "visitor: no admin row");
    h.expect(await page.isVisible(".gt-about"), "visitor: compact about row shown");
    h.eq(await page.textContent("#gtAcct"), "Umellen", "visitor: nav says Umellen");
    h.eq(await page.textContent("#gtWeekName"), "Tetris", "game of the week from weekly_game");
    h.eq(await page.textContent("#gtWeekKick"), "Spill vun der Woch", "kicker says game of the week");
    h.eq(await page.getAttribute("#gtWeekPlay", "href"), "pixelbreak.html?g=tetris", "Spillen opens the weekly game");
    await checkWall(h, "visitor");
    h.eq(await page.textContent("#gtAllText"), "An d'Arcade", "the ink cell leads to the arcade");
    h.eq(await page.$$eval('#gtWall [data-sec="recent"]', (els) => els.length), 0, "visitor: no 'Weider spillen'");
    h.eq(await page.$$eval("#gtWall .gw-h", (els) => els.map((e) => e.querySelector("span").textContent)), ["Meescht gespillt", "Fueren", "Bauen & Sammelen", "Action", "Rätsel", "Zu zweet", "Online"], "the groups, in order");
    const cols = await page.$$eval("#gtIndex [data-col]:not([hidden])", (els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    h.expect(new Set(cols).size === 1 && cols[0] > 200, `visible columns share the width evenly (${cols})`);
    await shots(h, "visitor");

    h.step("the wall: pictures wait until their tile is near, 44 px targets, 6+ tiles per row on an iPad, a sideways row on a phone");
    await page.evaluate(() => window.scrollTo(0, 0));
    await h.goto("/index.html");
    await h.pause(900);
    const pictures = await page.$$eval("#gtWall img", (imgs) => ({ all: imgs.length, loaded: imgs.filter((i) => i.getAttribute("src")).length }));
    h.expect(pictures.loaded < pictures.all / 2, `before scrolling only the near pictures are loaded (${pictures.loaded} of ${pictures.all})`);
    await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((done) => setTimeout(done, 80)); } });
    await page.waitForFunction(() => [...document.querySelectorAll("#gtWall img")].every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 10000 });
    h.expect((await page.$$eval("#gtWall img", (imgs) => imgs.map((i) => i.getAttribute("src")))).every((src) => src.startsWith("pb/thumbs/s/")), "after scrolling every tile shows its small picture");
    for (const [width, height, min] of [[1080, 810, 6], [810, 1080, 6], [1400, 900, 8]]) {
      await page.setViewportSize({ width, height });
      const row = await page.evaluate(() => { const items = [...document.querySelectorAll("#gwWall .gw-h, #gwWall li")]; const top = items[0].getBoundingClientRect().top; return items.filter((i) => Math.abs(i.getBoundingClientRect().top - top) < 2).length; });
      h.expect(row >= min, `${width}x${height}: ${row} cells per row (at least ${min})`);
      const small = await page.$$eval("#gtWall .gw-t, #gtWall button, #gwFind", (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).map((e) => e.textContent || e.id));
      h.eq(small, [], `${width}x${height}: every target of the wall is at least 44 px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const phone = await page.$$eval("#gwWall .gw-row", (rows) => rows.map((r) => ({ scrolls: r.scrollWidth > r.clientWidth + 1, height: Math.round(r.getBoundingClientRect().height) })));
    h.expect(phone.every((r) => r.height < 160) && phone.filter((r) => r.scrolls).length >= 5, `phone: one sideways row per group (${JSON.stringify(phone)})`);
    h.expect(await page.evaluate(() => document.querySelector("#gwWall").getBoundingClientRect().height < 1300), "phone: the whole wall is under two screens high");
    await page.setViewportSize({ width: 820, height: 1180 });

    h.step("chips and search");
    const games = catalogueGames();
    await page.click('[data-chip="drive"]');
    h.eq(sorted(await shownTiles(page)), sorted(games.filter((g) => g.group === "drive").map((g) => g.id)), "chip Fueren: all driving games, the most played ones too");
    h.eq(await page.getAttribute('[data-chip="drive"]', "aria-pressed"), "true", "the chip says it is on");
    await page.click('[data-chip="webcam"]');
    h.eq(await shownTiles(page), ["webcam"], "chip Mat Kamera: the Kamera-Arcade");
    await page.click('[data-chip="all"]');
    await page.fill("#gwFind", "véier");
    h.expect((await shownTiles(page)).includes("o-connect4"), "search: véier finds Véier gewënnt");
    await page.fill("#gwFind", "VEIER GEW");
    h.eq(await shownTiles(page), ["o-connect4"], "search: without accents, two words");
    await page.fill("#gwFind", "xyzxyz");
    h.eq([await shownTiles(page), await page.isVisible("#gwNone")], [[], true], "search without a match says so");
    await page.focus("#gwFind");
    await page.keyboard.press("Escape");
    h.eq((await shownTiles(page)).length, games.length, "Escape clears the search");

    h.step("keyboard: the skip link jumps over the games, Enter on a tile opens the hub with that game");
    await page.focus(".gw-chips button:last-child");
    await page.keyboard.press(process.env.FLOW_BROWSER === "webkit" ? "Alt+Tab" : "Tab");
    h.eq(await page.evaluate(() => document.activeElement.className), "gw-skip", "the skip link comes right before the tiles");
    await page.focus('.gw-t[data-game="tetris"]');
    await page.keyboard.press("Enter");
    await page.waitForURL(/pixelbreak\.html\?g=tetris/, { timeout: 10000 });
    h.expect(await page.evaluate(() => JSON.parse(localStorage.getItem("appUsage"))["pixelbreak.html"].score > 0 && !!JSON.parse(localStorage.getItem("appUsage"))["pixelbreak.html?g=tetris"]), "appUsage: the Arcade and the game");
    await h.goto("/index.html");
    await page.waitForFunction(() => !document.getElementById("gtWeek").classList.contains("loading"), null, { timeout: 15000 });

    h.step("search button opens quick-open");
    await page.click("#gtSearch");
    await page.waitForSelector(".qo-panel", { timeout: 5000 });
    h.expect(await page.evaluate(() => document.activeElement?.classList.contains("qo-input")), "quick-open input is focused");
    await page.keyboard.press("Escape");

    h.step("Luxembourgish only: no language switch, a stored de/en choice is ignored");
    h.eq(await page.$$eval(".langsw button, [data-langsw], #langSw", (els) => els.length), 0, "no language switcher on the homepage");
    await page.evaluate(() => localStorage.setItem("site_lang", "de"));
    await h.goto("/index.html");
    await page.waitForFunction(() => !document.getElementById("gtWeek").classList.contains("loading"), null, { timeout: 15000 });
    h.eq(await page.evaluate(() => document.documentElement.lang), "lb", "html lang is lb");
    h.eq(await page.textContent("#gtAllText"), "An d'Arcade", "stored 'de' ignored: still Luxembourgish");
    h.eq(await page.evaluate(() => localStorage.getItem("site_lang")), "lb", "the stored preference is reset to lb");

    h.step("signed-in member outside 4C6");
    await become(h, PERSONAS.member);
    h.eq(await visibleIndex(page), [
      { col: "school", items: ["grades.html"] },
      { col: "friends", items: ["messenger.html", "friends.html"] },
      { col: "travel", items: ["bus.html", "trails/", "mtb/"] },
    ], "member: no Tester, no studios, no Ian-only entries");
    h.eq(await page.$$eval("#gtIndex .kont", (els) => els.filter((e) => e.offsetParent).length), 0, "member: no 'Kont' tags");
    h.eq(await page.textContent("#gtAcct"), "Gilles", "member: nav shows the name");
    h.expect(/, Gilles$/.test(await page.textContent("#gtHello")), "member: greeting carries the name");
    h.expect(await page.isVisible('.gt-time a[href="profile.html"]'), "member: 'Mäi Profil' link");
    h.expect(!(await page.isVisible(".gt-about")), "member: no about row");
    h.eq(await page.$$eval('#gtWall [data-sec="recent"]', (els) => els.length), 0, "member who never played here: no 'Weider spillen'");
    await page.evaluate(() => {
      localStorage.setItem("pb_save_cookie-clicker", "{}");
      localStorage.setItem("pb_best_kart-letzebuerg-kirchberg", "12");
      const now = Date.now();
      localStorage.setItem("appUsage", JSON.stringify({ "pixelbreak.html": { score: 9, ts: now }, "pixelbreak.html?g=snake": { score: 5, ts: now - 5000 }, "pixelbreak.html?g=o-connect4": { score: 1, ts: now - 1000 }, "wordle.html": { score: 1, ts: now - 3000 }, "pixelbreak.html?g=gone-game": { score: 1, ts: now } }));
    });
    await h.goto("/index.html");
    await h.pause(500);
    h.eq(await page.$$eval('#gtWall [data-sec="recent"] .gw-t', (links) => links.map((a) => a.dataset.game)), ["o-connect4", "o-wordle", "snake", "cookie-clicker", "kart-letzebuerg"], "'Weider spillen': last opened first, then games with a save or a best score");
    await checkWall(h, "member with games");
    await page.evaluate(() => { localStorage.removeItem("appUsage"); localStorage.removeItem("pb_save_cookie-clicker"); localStorage.removeItem("pb_best_kart-letzebuerg-kirchberg"); });
    await shots(h, "member");

    h.step("Ian");
    await become(h, PERSONAS.ian);
    h.eq(await visibleIndex(page), [
      { col: "school", items: ["grades.html", "exams.html", "ppt.html", "doc.html"] },
      { col: "friends", items: ["messenger.html", "friends.html"] },
      { col: "travel", items: ["bus.html", "trails/", "mtb/"] },
      { col: "mine", items: ["karts.html", "hotel.html", "me.html"] },
    ], "Ian: Tester, studios and the 'Mäin' column");
    h.expect(await page.isVisible(".gt-admin"), "Ian: admin row shown");
    h.eq(await page.$$eval(".gt-admin a", (els) => els.map((e) => e.getAttribute("href"))), ["factory.html", "admin.html", "traffic.html"], "admin row links");
    await shots(h, "ian");

    h.step("Ian again: cached gates show his entries on the first frame");
    await h.goto("/index.html");
    h.expect(await page.evaluate(() => !document.querySelector('[data-col="mine"]').hidden), "Mäin column visible before is_admin answers");

    h.step("without JavaScript: the ink cell still leads to the arcade");
    const plain = await context.browser().newContext({ javaScriptEnabled: false });
    const noJs = await plain.newPage();
    await noJs.goto(new URL("/index.html", page.url()).href);
    h.eq([await noJs.isVisible("#gtAll"), await noJs.getAttribute("#gtAll", "href"), await noJs.isVisible("#gtWall")], [true, "pixelbreak.html", false], "no JS: link to the arcade, no empty wall");
    await plain.close();

    h.eq(errors, [], "no console errors");
  },
};

runIfMain(import.meta.url, flow);
