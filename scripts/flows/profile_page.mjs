/* Flow — Profil (Gitter look, Nov 2026): visitor gate, signed-in render in Luxembourgish, emoji avatar pick
 * (set_avatar RPC), class save validation, stats row, public view of another player, no horizontal scroll at
 * 375 px and iPad, no console errors. PROFILE_SHOTS_DIR=/dir also saves screenshots. */
import fs from "node:fs";
import path from "node:path";
import { runIfMain, ME, ME_NAME } from "./lib.mjs";

const ENGLISH = /Upload a photo|Or pick an emoji|Username|Profile picture|Your stats|Achievements|Loading…|Sign in to see/;

async function shot(h, name) {
  const dir = process.env.PROFILE_SHOTS_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await h.page.screenshot({ path: path.join(dir, `profile-${name}.png`), fullPage: true });
}

async function noOverflow(h, label) {
  for (const [w, hgt] of [[375, 812], [820, 1180], [1280, 900]]) {
    await h.page.setViewportSize({ width: w, height: hgt });
    await h.pause(250);
    const over = await h.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    h.expect(!over, `${label} @ ${w}px: no horizontal scroll`);
  }
  await h.page.setViewportSize({ width: 820, height: 1180 });
}

export const flow = {
  name: "profile-page",
  backend: {
    rpc: {
      admin_user_ids: () => [],
      set_avatar: () => null,
      set_class: () => null,
      game_leaderboard: () => [{ username: ME_NAME, wins: 12, losses: 3, total: 15, winpct: 80 }],
    },
    tables: { profiles: () => [{ id: ME, avatar: null, class: "4C6", username: ME_NAME, class_confirmed: "2026-09", account_checked_at: "2026-10-01T00:00:00Z" }] },
  },
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

    h.step("visitor → sign-in gate in Luxembourgish");
    await h.goto("/profile.html");
    await page.waitForSelector("#signin", { timeout: 15000 });
    h.eq(await page.evaluate(() => document.documentElement.lang), "lb", "html lang is lb");
    h.expect(/Mell dech un/.test(await page.textContent("#wrap")), "gate says «Mell dech un …»");
    h.eq((await page.textContent(".gt-back")).trim(), "‹ Heem", "back link says Heem");
    h.eq((await page.textContent(".gt-page-title")).trim(), "Profil", "title says Profil");
    h.eq(await page.evaluate(() => getComputedStyle(document.body).borderRadius), "0px", "sharp corners");
    h.expect(!ENGLISH.test(await page.evaluate(() => document.body.innerText)), "no English UI text (visitor)");
    h.eq(await page.$$eval("#themeFab", (e) => e.filter((x) => x.offsetParent).length), 0, "no theme picker");
    await noOverflow(h, "visitor");
    await shot(h, "visitor");

    h.step("signed in → profile in Luxembourgish");
    await h.signIn();
    await h.goto("/profile.html");
    await page.waitForSelector("#avGrid .avb", { timeout: 15000 });
    await page.waitForSelector("#stats .c b", { timeout: 15000 });
    const text = await page.evaluate(() => document.body.innerText);
    for (const word of ["Benotzernumm", "Klass", "Profilbild", "Foto eroplueden", "Oder wiel en Emoji", "Deng Statistiken", "Späicheren"]) {
      h.expect(text.includes(word), `shows «${word}»`);
    }
    h.expect(!ENGLISH.test(text), "no English UI text (signed in)");
    h.eq(await page.$$eval("#avGrid .avb", (e) => e.length), 24, "24 emoji avatars");
    h.eq(await page.$$eval("#stats > .c", (e) => e.length), 5, "five stat cells");
    h.eq(await page.textContent("#acctHost, #gtAcct"), ME_NAME, "header button shows the username");
    await noOverflow(h, "signed in");
    await shot(h, "member");

    h.step("pick an emoji → set_avatar RPC");
    await page.click("#avGrid .avb:nth-child(3)");
    await page.waitForFunction(() => /Gespäichert/.test(document.getElementById("avMsg").textContent));
    h.eq(h.backend.callsTo("set_avatar").length, 1, "set_avatar called once");
    h.eq(await page.getAttribute("#avGrid .avb:nth-child(3)", "aria-pressed"), "true", "the picked emoji is pressed");

    h.step("class validation message is Luxembourgish");
    await page.fill("#classInp", "5");
    await page.click("#classSave");
    h.expect(/Eng genau Klass/.test(await page.textContent("#classMsg")), "year-only class is refused in lb");
    await page.fill("#classInp", "5c6");
    await page.click("#classSave");
    await page.waitForFunction(() => /Gespäichert/.test(document.getElementById("classMsg").textContent));
    h.eq(h.backend.callsTo("set_class").length, 1, "set_class called once");

    h.step("public view of another player");
    await h.goto("/profile.html?u=someone");
    await page.waitForSelector(".gt-gate, .gt-me", { timeout: 15000 });
    h.expect(!ENGLISH.test(await page.evaluate(() => document.body.innerText)), "no English UI text (public view)");
    await noOverflow(h, "public view");

    h.eq(errors, [], "no console errors");
  },
};
runIfMain(import.meta.url, flow);
