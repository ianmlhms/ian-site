#!/usr/bin/env node
/* Developer check: Ski Alpen inside the arcade hub (pixelbreak.html?g=ski runs the game as a srcdoc iframe): it boots to the resort
 * picker, a piste can be started, and the hub shows the piste board. Screenshot to OUT.png. One browser (browser-slot.py). */
import { launchBrowser, startServer, createBackend, mockSupabase } from "../flows/lib.mjs";

const out = process.argv[2] || "hub.png";
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, serviceWorkers: "block" });
  await mockSupabase(ctx, createBackend());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  await page.goto(origin + "/pixelbreak.html?g=ski", { waitUntil: "domcontentloaded" });
  const frameOf = async () => { for (let i = 0; i < 120; i++) { const f = page.frames().find((fr) => fr !== page.mainFrame()); if (f) return f; await page.waitForTimeout(250); } return null; };
  const frame = await frameOf();
  if (!frame) throw new Error("no game frame");
  await frame.waitForFunction(() => document.documentElement.dataset.skiScreen === "picker" || document.documentElement.dataset.bootError, null, { timeout: 90000 });
  console.log("boot error:", await frame.evaluate(() => document.documentElement.dataset.bootError || "none"));
  await frame.click(".resort.ready");
  await frame.waitForFunction(() => document.documentElement.dataset.skiStartReady === "1", null, { timeout: 60000 });
  await frame.click("#startBtn");
  await frame.waitForFunction(() => document.documentElement.dataset.skiRunning === "1", null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out });
  console.log("hub game bar:", (await page.evaluate(() => document.body.innerText.match(/Ski Alpen[^\n]*/g) || [])).slice(0, 3));
} finally {
  await browser.close();
  server.close();
}
