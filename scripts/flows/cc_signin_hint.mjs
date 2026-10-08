/* Flow 8 — Cookie Clicker signed out: once the game saves progress, a hint asks
 * the player to sign in (so a new device showing 0 cookies isn't mistaken for
 * lost progress). The button opens sign-in; × hides it. */
import { runIfMain } from "./lib.mjs";

export const flow = {
  name: "cc-signin-hint",
  async run(h) {
    const { page } = h;
    h.step("open Cookie Clicker signed out");
    await h.goto("/pixelbreak.html?g=cookie-clicker");
    await page.waitForSelector("#pbSaveHint", { timeout: 15000 });
    const text = await page.textContent("#pbSaveHint");
    h.expect(/Mell dech un/.test(text || ""), `hint shown (${(text || "").trim().slice(0, 60)})`);
    await h.shot("hint");
    await page.click(".pb-save-hint__go");
    await h.pause(800);
    h.expect(await page.isVisible(".pb-modal.open"), "Umellen opens the sign-in dialog");
    await page.evaluate(() => document.querySelector(".pb-modal.open")?.classList.remove("open"));
    await page.click(".pb-save-hint__x");
    h.expect(!(await page.$("#pbSaveHint")), "× hides the hint");
  },
};

runIfMain(import.meta.url, flow);
