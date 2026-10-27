#!/usr/bin/env node
/* Runs a few flows in headless WebKit (Safari engine) instead of Chromium:
 *
 *   node scripts/flows/run_webkit.mjs                 # the idle-game flows
 *   node scripts/flows/run_webkit.mjs idle-more-content
 *
 * Same harness, same mocked Supabase; only the browser differs. Exit 0 = all passed. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runFlow, startServer } from "./lib.mjs";
import { flow as idleRebirthHalloween } from "./idle_rebirth_halloween.mjs";
import { flow as idleMoreContent } from "./idle_more_content.mjs";
import { flow as idleSoftcap } from "./idle_softcap.mjs";
import { flow as idleResetSafety } from "./idle_reset_safety.mjs";
import { flow as leaderboardBigScores } from "./leaderboard_big_scores.mjs";
import { flow as driveMadLevels } from "./drive_mad_levels.mjs";
import { flow as ccSigninHint } from "./cc_signin_hint.mjs";
import { flow as invitesLight } from "./invite_pop_light.mjs";
import { flow as adminKartSaves } from "./admin_kart_saves.mjs";
import { flow as mediaCache } from "./messenger_media_cache.mjs";
import { flow as mtbWorld } from "./mtb_world.mjs";
import { flow as mtbHoles } from "./mtb_holes.mjs";
import { flow as mtbRide } from "./mtb_ride.mjs";
import { flow as mtbTrails } from "./mtb_trails.mjs";
import { flow as mtbMenu } from "./mtb_menu.mjs";
import { flow as mtbTouch } from "./mtb_touch.mjs";
import { flow as mtbSmooth } from "./mtb_smooth.mjs";

const GLOBAL_PLAYWRIGHT = "/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright";
async function importPlaywright() {
  try { return await import("playwright"); } catch { /* fall through to the folders */ }
  for (const dir of [process.env.PLAYWRIGHT_DIR, GLOBAL_PLAYWRIGHT].filter(Boolean)) {
    for (const entry of ["index.mjs", "index.js"]) {
      const file = path.join(dir, entry);
      if (fs.existsSync(file)) return import(pathToFileURL(file).href);
    }
  }
  throw new Error("Playwright not found: set PLAYWRIGHT_DIR to a playwright package folder.");
}

const ALL = [mtbWorld, mtbHoles, mtbRide, mtbTrails, mtbMenu, mtbTouch, mtbSmooth, mediaCache, adminKartSaves, invitesLight, ccSigninHint, idleRebirthHalloween, idleMoreContent, idleSoftcap, idleResetSafety, leaderboardBigScores, driveMadLevels];
const words = process.argv.slice(2);
const flows = words.length ? ALL.filter((f) => words.some((w) => f.name.includes(w))) : ALL;
const { webkit } = await importPlaywright();
const [browser, { server, origin }] = await Promise.all([webkit.launch(), startServer()]);
const results = [];
try {
  for (const flow of flows) results.push(await runFlow(flow, { browser, origin }));
} finally {
  await browser.close();
  server.close();
}
console.log("\n──────── webkit flows ────────");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : "\n        " + r.failures.join("\n        ")}`);
process.exit(results.some((r) => !r.ok) ? 1 : 0);
