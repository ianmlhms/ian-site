/* Flow 5 — Arcade: Solitaire has no D-pad; Snake shows the D-pad on a touch iPad and hides it once a keyboard is used;
 * Stunt Driver brings its own pedals + tilt buttons, so the arcade D-pad band stays away and the game uses the full height. */
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

    h.step("Stunt Driver on a touch iPad → no arcade D-pad band, its own pedals + tilt buttons, full height");
    await page.evaluate(() => { sessionStorage.clear(); localStorage.removeItem("pb_input_mode"); });
    for (const [label, size] of [["portrait", { width: 820, height: 1180 }], ["landscape", { width: 1180, height: 820 }]]) {
      await page.setViewportSize(size);
      await openGame(h, "drive-mad");
      h.eq(await padDisplay(page), "none", `${label}: no arcade D-pad band under Stunt Driver`);
      const frameBottom = await page.$eval("#gf", (f) => Math.round(f.getBoundingClientRect().bottom) - innerHeight);
      h.eq(frameBottom, 0, `${label}: the game frame reaches the bottom of the screen`);
      const frame = page.frames().find((f) => f.parentFrame());
      await frame.locator("#play").click();
      await frame.waitForSelector("#touch:not(.hidden)", { timeout: 15000 });
      const ctl = await frame.evaluate(() => Object.fromEntries(["brake", "gas", "tiltL", "tiltR"].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [id, { w: Math.round(r.width), h: Math.round(r.height), inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }]; })));
      h.expect(Object.values(ctl).every((c) => c.inside && c.w >= 54 && c.h >= 54), `${label}: brake, gas and both tilt buttons are on screen and thumb-sized ${JSON.stringify(ctl)}`);
      if (label === "landscape") {
        const cdp = await h.context.newCDPSession(page);
        const box = await frame.locator("#tiltL").boundingBox();
        const pt = [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 0 }];
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt });
        h.eq(await frame.evaluate(() => ["tiltL", "tiltR", "gas", "brake"].map((id) => document.getElementById(id).classList.contains("on"))), [true, false, false, false], "holding the left tilt button presses only that button (tilt without driving)");
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        h.eq(await frame.evaluate(() => document.getElementById("tiltL").classList.contains("on")), false, "and lifting the finger lets go");
        await h.shot("stunt-driver-landscape");
      } else await h.shot("stunt-driver-portrait");
    }
  },
};

runIfMain(import.meta.url, flow);
