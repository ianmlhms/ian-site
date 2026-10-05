/* Flow 5 — Arcade: Solitaire has no D-pad; Snake shows the D-pad on a touch iPad and hides it once a keyboard is used. */
import { runIfMain } from "./lib.mjs";

const padDisplay = (page) => page.$eval("#tc", (el) => getComputedStyle(el).display);
const gameTitle = (page) => page.$eval("#gf", (f) => f.contentDocument?.title || "");

async function openGame(h, id) {
  await h.goto(`/pixelbreak.html?g=${id}`);
  await h.page.waitForFunction(() => {
    const doc = document.getElementById("gf")?.contentDocument;
    return !!doc && doc.readyState === "complete" && doc.body && doc.body.children.length > 0;
  });
  await h.pause(1500);
}

export const flow = {
  name: "arcade-pad",
  touch: true,
  async run(h) {
    const { page } = h;
    await h.signIn();

    h.step("open Solitaire on a touch iPad → no D-pad (it is played by tapping cards)");
    await openGame(h, "solitaire");
    h.expect(/solitaire/i.test(await gameTitle(page)), `Solitaire is loaded in the game frame («${await gameTitle(page)}»)`);
    h.eq(await padDisplay(page), "none", "no D-pad on Solitaire");
    h.expect(await page.evaluate(() => document.body.classList.contains("game-no-pad")), "page marks the game as pad-less");
    await h.shot("solitaire");
    await h.pause();

    h.step("open Snake on the same touch iPad → D-pad is shown");
    await openGame(h, "snake");
    h.expect(/snake/i.test(await gameTitle(page)), `Snake is loaded in the game frame («${await gameTitle(page)}»)`);
    h.eq(await padDisplay(page), "flex", "D-pad visible on Snake (touch)");
    const buttons = await page.$$eval("#tc .dpad .tb", (els) => els.length);
    h.eq(buttons, 4, "D-pad has four direction buttons");
    await h.shot("snake-touch");
    await h.pause();

    h.step("press a key on the keyboard → the D-pad hides");
    await page.keyboard.press("ArrowLeft");
    await h.pause(500);
    h.eq(await padDisplay(page), "none", "D-pad hidden after keyboard use");
    h.eq(await page.evaluate(() => localStorage.getItem("pb_input_mode")), "keyboard", "keyboard mode is remembered");
    await h.shot("snake-keyboard");
    await h.pause();

    h.step("reload Snake → D-pad stays hidden (remembered per device)");
    await page.evaluate(() => sessionStorage.clear());
    await openGame(h, "snake");
    h.eq(await padDisplay(page), "none", "D-pad still hidden after a reload");

    h.step("Solitaire with the keyboard → still no D-pad");
    await openGame(h, "solitaire");
    h.eq(await padDisplay(page), "none", "no D-pad on Solitaire with a keyboard either");
  },
};

runIfMain(import.meta.url, flow);
