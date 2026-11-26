#!/usr/bin/env node
/* Developer tool (lift lines round, 26 Nov 2026): the player boarding a chair, a gondola / cable car and a drag lift, in the chase camera:
 * frames from the press (walked in through the free lane) to the start of the ride, and at the top (getting off), into a contact sheet.
 *   node scripts/ski/board-shots.mjs OUT_DIR [--resort killy] [--time midday] [--kinds chair,gondola,drag] [--every 450] [--from 10]
 * --from: m from the boarding spot where he presses (along the free lane's entry side). Run it through ~/Library/Caches/browser-slot.py. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchBrowser, startServer } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const out = args[0] || path.join(process.env.HOME, "Library/Caches/ski-work/queues/board");
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const rid = opt("--resort", "killy"), time = opt("--time", "midday"), kinds = opt("--kinds", "chair,gondola,drag").split(",");
const every = Number(opt("--every", "450")), from = Number(opt("--from", "10"));
fs.mkdirSync(out, { recursive: true });
const browser = await launchBrowser({ fullChromium: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const { server, origin } = await startServer();
const notes = [];
const VENV = path.join(process.env.HOME, "Library/Caches/luxtram-work/.venv/bin/python");      // (Pillow)
try {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => notes.push("pageerror " + String(e).slice(0, 300)));
  await page.addInitScript(() => { try { localStorage.setItem("pb_ski_npcs", "1"); } catch (error) { /* ignore */ } });
  await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=medium&res=fixed&weather=sun&time=${time}&resort=${rid}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("document.documentElement.dataset.skiRunning === '1'", null, { timeout: 180000 });
  await page.evaluate(() => window.__ski.streamer.release());
  await page.waitForFunction("document.documentElement.dataset.skiTilesDone === '1'", null, { timeout: 300000, polling: 500 });
  await page.waitForTimeout(2000);
  for (const kind of kinds) {
    const id = await page.evaluate((kind) => {
      const S = window.__ski, w = S.modes.lifts.world;
      const ok = S.modes.lifts.list.filter((l) => { const s = w.sites.get(l.index); return s && (kind === "drag" ? s.key === "drag" && s.path.sub !== "rope" : kind === "gondola" ? (s.key === "gondola" || s.key === "cable") && s.queue : s.key === "chair" && s.queue && s.path.seats >= 4); });
      ok.sort((a, b) => (b.len - a.len));
      return ok.length ? ok[0].id : null;
    }, kind);
    if (!id) { notes.push(`${kind}: no lift`); continue; }
    await page.evaluate((id) => window.__ski.goFree(id), id);
    await page.waitForFunction("document.documentElement.dataset.skiRunning === '1'", null, { timeout: 30000 });
    await page.waitForTimeout(3000);
    // stand `from` m out (outside the free lane's entry, or out of the zone on its outer side), then press
    await page.evaluate(({ id, from }) => {
      const S = window.__ski, l = S.modes.lifts.byId.get(id), site = S.modes.lifts.world.sites.get(l.index), m = site.queue;
      const P = m ? m.lanes[m.free].entry : site.bottom.toWorld((site.zone.a0 + site.zone.a1) / 2, site.zone.b1 + from, {});
      const dx = P.x - site.wait.x, dz = P.z - site.wait.z, L = Math.hypot(dx, dz) || 1;
      const x = m ? P.x + dx / L * 1.5 : P.x, z = m ? P.z + dz / L * 1.5 : P.z;
      S.placeHold(x, z, Math.atan2(-dz, -dx));
    }, { id, from });
    await page.waitForTimeout(2500);
    const frames = [];
    const snap = async (tag) => { const f = path.join(out, `${rid}-${kind}-${tag}.png`); await page.screenshot({ path: f }); frames.push(f); };
    await page.evaluate(() => window.__ski.boardLift());
    for (let i = 0; i < 26; i++) {
      await snap(`up${String(i).padStart(2, "0")}`);
      const ph = await page.evaluate(() => (window.__ski.ride ? window.__ski.ride.phase : window.__ski.game.phase));
      if (ph === "ride") { const r = await page.evaluate(() => window.__ski.ride.t); if (r > 0 && i > 3) { await page.waitForTimeout(900); await snap(`up${String(i + 1).padStart(2, "0")}`); break; } }
      await page.waitForTimeout(every);
    }
    // to the top: skip, then the getting off
    await page.waitForFunction("window.__ski.ride && window.__ski.ride.canSkip", null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => window.__ski.skipRide());
    await page.waitForFunction("!window.__ski.ride || window.__ski.ride.phase === 'alight'", null, { timeout: 20000 }).catch(() => {});
    for (let i = 0; i < 8; i++) { await snap(`top${i}`); await page.waitForTimeout(every); if (!(await page.evaluate(() => !!window.__ski.ride))) break; }
    const sheet = path.join(out, `${rid}-${time}-${kind}-sheet.png`);
    try { execFileSync(fs.existsSync(VENV) ? VENV : "python3", [path.join(path.dirname(new URL(import.meta.url).pathname), "contact_sheet.py"), sheet, ...frames], { stdio: "inherit" }); } catch (error) { notes.push(`sheet ${kind}: ${error.message}`); }
    notes.push(`${kind}: ${id} ${frames.length} frames -> ${sheet}`);
  }
} finally {
  console.log(notes.join("\n"));
  await browser.close();
  server.close();
}
