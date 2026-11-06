/* Flow — the homepage (Gitter look, Nov 2026) as a visitor, a signed-in member
 * outside 4C6, and Ian: which index entries each one sees, the "Kont" tags, the
 * greeting, the game of the week, the "All N games" count (must equal GAMES in
 * pixelbreak.html), the ⌘K search button, Luxembourgish only, no horizontal
 * scroll from phone to desktop, and no console errors.
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

function arcadeGameCount() {
  const html = fs.readFileSync(path.join(REPO, "pixelbreak.html"), "utf8");
  const start = html.indexOf("const GAMES=[");
  const end = html.indexOf("\n];", start);
  return html.slice(start, end).split("\n").filter((line) => line.startsWith("{id:")).length;
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
      { col: "travel", items: ["bus.html"] },
    ], "visitor: public entries only, empty 'Mäin' column dropped");
    h.eq(await page.$$eval("#gtIndex .kont", (els) => els.filter((e) => e.offsetParent).length), 3, "visitor: three 'Kont' tags");
    h.expect(await page.isVisible("#gtFree"), "visitor: 'gratis Kont' link shown");
    h.expect(!(await page.isVisible(".gt-admin")), "visitor: no admin row");
    h.expect(await page.isVisible(".gt-about"), "visitor: compact about row shown");
    h.eq(await page.textContent("#gtAcct"), "Umellen", "visitor: nav says Umellen");
    h.eq(await page.textContent("#gtWeekName"), "Tetris", "game of the week from weekly_game");
    h.eq(await page.textContent("#gtWeekKick"), "Spill vun der Woch", "kicker says game of the week");
    h.eq(await page.getAttribute("#gtWeekPlay", "href"), "pixelbreak.html?g=tetris", "Spillen opens the weekly game");
    const count = arcadeGameCount();
    h.eq(await page.getAttribute("#gtAll", "data-count"), String(count), `All-games count matches GAMES in pixelbreak.html (${count})`);
    h.eq(await page.textContent("#gtAllText"), `All ${count} Spiller`, "All-games cell text");
    const cols = await page.$$eval("#gtIndex [data-col]:not([hidden])", (els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    h.expect(new Set(cols).size === 1 && cols[0] > 200, `visible columns share the width evenly (${cols})`);
    await shots(h, "visitor");

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
    h.eq(await page.textContent("#gtAllText"), `All ${count} Spiller`, "stored 'de' ignored: still Luxembourgish");
    h.eq(await page.evaluate(() => localStorage.getItem("site_lang")), "lb", "the stored preference is reset to lb");

    h.step("signed-in member outside 4C6");
    await become(h, PERSONAS.member);
    h.eq(await visibleIndex(page), [
      { col: "school", items: ["grades.html"] },
      { col: "friends", items: ["messenger.html", "friends.html"] },
      { col: "travel", items: ["bus.html"] },
    ], "member: no Tester, no studios, no Ian-only entries");
    h.eq(await page.$$eval("#gtIndex .kont", (els) => els.filter((e) => e.offsetParent).length), 0, "member: no 'Kont' tags");
    h.eq(await page.textContent("#gtAcct"), "Gilles", "member: nav shows the name");
    h.expect(/, Gilles$/.test(await page.textContent("#gtHello")), "member: greeting carries the name");
    h.expect(await page.isVisible('.gt-time a[href="profile.html"]'), "member: 'Mäi Profil' link");
    h.expect(!(await page.isVisible(".gt-about")), "member: no about row");
    await shots(h, "member");

    h.step("Ian");
    await become(h, PERSONAS.ian);
    h.eq(await visibleIndex(page), [
      { col: "school", items: ["grades.html", "exams.html", "ppt.html", "doc.html"] },
      { col: "friends", items: ["messenger.html", "friends.html"] },
      { col: "travel", items: ["bus.html"] },
      { col: "mine", items: ["karts.html", "hotel.html", "me.html"] },
    ], "Ian: Tester, studios and the 'Mäin' column");
    h.expect(await page.isVisible(".gt-admin"), "Ian: admin row shown");
    h.eq(await page.$$eval(".gt-admin a", (els) => els.map((e) => e.getAttribute("href"))), ["factory.html", "admin.html"], "admin row links");
    await shots(h, "ian");

    h.step("Ian again: cached gates show his entries on the first frame");
    await h.goto("/index.html");
    h.expect(await page.evaluate(() => !document.querySelector('[data-col="mine"]').hidden), "Mäin column visible before is_admin answers");

    h.eq(errors, [], "no console errors");
  },
};

runIfMain(import.meta.url, flow);
