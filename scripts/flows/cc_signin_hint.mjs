/* Flow 8 — Cookie Clicker signed out: once the game saves progress, a hint asks
 * the player to sign in (so a new device showing 0 cookies isn't mistaken for
 * lost progress). The button opens sign-in; × hides it. On an iPad (portrait and
 * landscape) the hint must not sit on the game: the game frame ends above it. */
import { runIfMain } from "./lib.mjs";

export const flow = {
  name: "cc-signin-hint",
  touch: true,
  async run(h) {
    const { page } = h;
    h.step("open Cookie Clicker signed out");
    await h.goto("/pixelbreak.html?g=cookie-clicker");
    await page.waitForSelector("#pbSaveHint", { timeout: 15000 });
    const text = await page.textContent("#pbSaveHint");
    h.expect(/Mell dech un/.test(text || ""), `hint shown (${(text || "").trim().slice(0, 60)})`);
    await h.shot("hint");
    const gap = () => page.evaluate(() => {
      const hint = document.getElementById("pbSaveHint").getBoundingClientRect(), game = document.getElementById("gf").getBoundingClientRect();
      return { hintTop: Math.round(hint.top), gameBottom: Math.round(game.bottom), vh: innerHeight };
    });
    const portrait = await gap();
    h.expect(portrait.gameBottom <= portrait.hintTop, `portrait: the game frame ends above the hint (${JSON.stringify(portrait)})`);
    await page.setViewportSize({ width: 1180, height: 820 });
    await h.pause(500);
    const landscape = await gap();
    h.expect(landscape.gameBottom <= landscape.hintTop, `landscape: the game frame ends above the hint (${JSON.stringify(landscape)})`);
    await h.shot("hint-landscape");
    await page.setViewportSize({ width: 820, height: 1180 });
    await h.pause(300);
    await page.click(".pb-save-hint__go");
    await h.pause(800);
    h.expect(await page.isVisible(".pb-modal.open"), "Umellen opens the sign-in dialog");
    await page.evaluate(() => document.querySelector(".pb-modal.open")?.classList.remove("open"));
    await page.click(".pb-save-hint__x");
    h.expect(!(await page.$("#pbSaveHint")), "× hides the hint");
    await h.pause(200);
    const freed = await page.evaluate(() => Math.round(document.getElementById("gf").getBoundingClientRect().bottom) === innerHeight);
    h.expect(freed, "and the game gets the full height back");
  },
};

runIfMain(import.meta.url, flow);
