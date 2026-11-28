#!/usr/bin/env node
/* Shots of the pistes added by scripts/ski/add_pistes.py (28 Nov 2026, missing-pistes round): per added piste (scripts/ski/official/<rid>.add.json)
 * the printed map zoomed on it with the piste selected (is it on the right line, is it connected?) and the skier standing at its start in 3D.
 *   node scripts/ski/missing-piste-shots.mjs [--resorts arlberg,davos] [--out DIR] [--only id,id] [--noshots3d]
 * PNGs <resort>-<piste>-map.png / -3d.png. Run through browser-slot.py (one browser). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const here = path.dirname(fileURLToPath(import.meta.url));
const out = opt("--out", path.join(process.env.HOME, "Library/Caches/ski-work/missing-pistes"));
const only = opt("--only", "").split(",").filter(Boolean);
const rids = opt("--resorts", fs.readdirSync(path.join(here, "official")).filter((f) => f.endsWith(".add.json")).map((f) => f.split(".")[0]).join(",")).split(",");
fs.mkdirSync(out, { recursive: true });
const browser = await launchBrowser({ fullChromium: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const { server, origin } = await startServer();
const report = [];
try {
  for (const rid of rids) {
    const spec = JSON.parse(fs.readFileSync(path.join(here, "official", `${rid}.add.json`), "utf8"));
    const ids = [...spec.pistes.map((p) => p.id), ...(spec.edits || []).map((e) => e.id)].filter((id) => !only.length || only.includes(id));
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
    await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=low&res=fixed&weather=sun&time=midday&resort=${rid}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__ski && window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running", null, { timeout: 240000 });
    await page.waitForTimeout(4000);
    for (const id of ids) {
      const info = await page.evaluate(async (pid) => {
        const S = window.__ski;
        const p = S.pistes.list.find((q) => q.id === pid);
        if (!p) return null;
        const a = p.at(8, {}), b = p.at(28, {});
        let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
        for (let s = 0; s <= p.length; s += 20) { const q = p.at(s, {}); x0 = Math.min(x0, q.x); z0 = Math.min(z0, q.z); x1 = Math.max(x1, q.x); z1 = Math.max(z1, q.z); }
        return { name: p.name, length: p.length, box: [x0, z0, x1, z1], start: { x: a.x, z: a.z, heading: Math.atan2(b.z - a.z, b.x - a.x) } };
      }, id);
      if (!info) { report.push(`${rid}/${id}: NOT IN THE GAME`); continue; }
      if (!args.includes("--noshots3d")) {
        await page.evaluate(async (i) => { await window.__ski.teleportTo({ x: i.start.x, z: i.start.z, heading: i.start.heading, kind: "piste", piste: i.id }); }, { ...info, id });
        await page.waitForFunction(() => window.__ski.game.phase === "running" && document.documentElement.dataset.skiScreen === "ski", null, { timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(4500);
        await page.screenshot({ path: path.join(out, `${rid}-${id}-3d.png`) });
      }
      await page.keyboard.press("m");
      await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.evaluate((i) => {
        const S = window.__ski, m = S.pisteMap, p = S.pistes.list.find((q) => q.id === i.id);
        m.focusBox(i.box[0], i.box[1], i.box[2], i.box[3], Math.max(500, (i.box[2] - i.box[0] + i.box[3] - i.box[1]) * 0.6));
        m.select(p, false);
      }, { ...info, id });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(out, `${rid}-${id}-map.png`) });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
      report.push(`${rid}/${id}: ${info.name}, ${Math.round(info.length)} m`);
      console.log(report[report.length - 1]);
    }
    report.push(`${rid}: ${errors.length} page errors${errors.length ? ": " + errors[0] : ""}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(report.join("\n"));
