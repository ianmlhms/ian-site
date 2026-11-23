#!/usr/bin/env node
/* Round 8e (3V QA: the spawn platform's roof filled the top quarter of the screen): the first view of every resort, at the spawn in the
 * first lift's boarding zone (and after a fast travel to 6 more lifts): the top fifth of the frame is mostly sky / terrain, not a station
 * roof or a house (window.__ski.roofShare(): rays through the top fifth, <= 40 % may hit a station part / house within 40 m).
 *   node scripts/ski/spawn-view-check.mjs [--resorts ...] [--engine webkit|chromium] [--out DIR] [--lifts 6]   (exit 1 on a failure) */
import fs from "node:fs";
import path from "node:path";
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const resorts = opt("--resorts", "killy,3vallees,zermatt,arlberg,kronplatz,vialattea,obertauern").split(",");
const engine = opt("--engine", "chromium");
const nLifts = Number(opt("--lifts", "6"));
const out = opt("--out", path.join(process.env.HOME, "Library/Caches/ski-work/round8e/spawn"));
fs.mkdirSync(out, { recursive: true });
process.env.FLOW_BROWSER = engine;
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
let fails = 0;
const check = (ok, text) => { if (!ok) fails++; console.log(`${ok ? "  ok  " : "  FAIL"} ${text}`); };
try {
  for (const rid of resorts) {
    const ctx = await browser.newContext({ viewport: { width: 1080, height: 810 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { fails++; console.log(`  FAIL [${rid}] pageerror ${String(e).slice(0, 200)}`); });
    await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=medium&weather=sun&time=midday&resort=${rid}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 240000 });
    await page.waitForFunction(() => !!window.__ski.lifts && !!window.__ski.boxIndex, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const spots = await page.evaluate((n) => {
      const L = window.__ski.modes.lifts.list.filter((l) => !l.tunnel && l.kind !== "carpet");
      const pick = [];
      for (let i = 0; i < n && L.length; i++) pick.push(L[Math.floor((i + 0.5) * L.length / n)].id);
      return pick;
    }, nLifts);
    const judge = async (label) => {
      const r = await page.evaluate(() => ({ share: window.__ski.roofShare(), frame: document.documentElement.dataset.skiStationFrame || "", inStation: !!window.__ski.modes.lifts.world.inStation(window.__ski.state.x, window.__ski.state.z, 0.5), lift: window.__ski.modes.liftAt ? window.__ski.modes.liftAt.name : "" }));
      check(r.share <= 0.4, `${rid} ${label} (${r.lift}${r.inStation ? ", in the station" : ""}): ${(r.share * 100).toFixed(0)} % of the top fifth is roof / house`);
      return r;
    };
    await judge("spawn");
    await page.screenshot({ path: path.join(out, `${engine}-${rid}-spawn.png`) });
    for (const id of spots) {
      await page.evaluate((id) => window.__ski.goFree(id), id);
      await page.waitForFunction((id) => window.__ski.game.phase === "running" && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id, id, { timeout: 40000 }).catch(() => {});
      await page.waitForTimeout(1800);
      await judge(`fast travel ${id}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(fails ? `${fails} FAILED` : "all spawn views clear");
process.exit(fails ? 1 : 0);
