#!/usr/bin/env node
/* Developer tool: screenshots of the resort picker at iPad landscape / portrait / phone sizes (eleven cards, HANDOFF "Sölden").
 *   BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/picker-view.mjs OUT_PREFIX */
import { launchBrowser, startServer } from "../flows/lib.mjs";

const out = process.argv[2];
const SIZES = { ipadL: [1180, 820], ipadP: [820, 1180], phone: [390, 844] };
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  for (const [name, [w, h]] of Object.entries(SIZES)) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(`${origin}/pb/ski.html?debug=1&bot=1&q=low`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "picker" || document.documentElement.dataset.bootError, null, { timeout: 90000 });
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".resort")];
      const r = cards.map((c) => c.getBoundingClientRect());
      return { cards: cards.length, ids: cards.map((c) => c.dataset.id), overflowX: document.documentElement.scrollWidth > innerWidth, minW: Math.round(Math.min(...r.map((q) => q.width))), minH: Math.round(Math.min(...r.map((q) => q.height))), bottom: Math.round(Math.max(...r.map((q) => q.bottom))), vh: innerHeight };
    });
    console.log(name, JSON.stringify(info));
    await page.screenshot({ path: `${out}-${name}.png` });
    if (name === "phone") await page.screenshot({ path: `${out}-${name}-full.png`, fullPage: true });
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
