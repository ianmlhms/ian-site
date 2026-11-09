import { runIfMain } from "./lib.mjs";
export const flow = { name: "tmp-play", async run(h) {
  const { page } = h;
  await page.context().addInitScript(() => localStorage.setItem("pb_save_mordsfall", JSON.stringify({ v: 2, seen: true })));
  await h.goto("/mordsfall.html"); await page.waitForSelector(".mf-file");
  await page.evaluate(() => window.__mordsfall.openCase("ve1")); await h.pause(500);
  for (const w of [1280, 375]) { await page.setViewportSize({ width: w, height: w===375?812:900 }); await h.pause(300);
    await page.screenshot({ path: `/Users/Ian/Library/Caches/luxdrive-work/gitter-shots/rest/after-mordsfall-play-${w}.png`, fullPage: true }); }
}};
runIfMain(import.meta.url, flow);
