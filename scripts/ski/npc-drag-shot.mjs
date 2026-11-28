#!/usr/bin/env node
/* Developer tool (standing lifts, 28 Nov 2026): the others riding a drag lift, seen from beside the track (are their skis on the snow?).
 *   node scripts/ski/npc-drag-shot.mjs OUT_DIR [--resort killy] [--lift NAME] [--root DIR]   (through ~/Library/Caches/browser-slot.py) */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, startServer, REPO } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const out = args[0] && !args[0].startsWith("--") ? args[0] : path.join(process.env.HOME, "Library/Caches/ski-work/lift-standing/npc");
const rid = opt("--resort", "killy"), want = opt("--lift", ""), root = opt("--root", REPO);
fs.mkdirSync(out, { recursive: true });
const browser = await launchBrowser({ fullChromium: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const { server, origin } = await startServer(root);
try {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 640 } })).newPage();
  await page.addInitScript(() => { try { localStorage.setItem("pb_ski_npcs", "1"); } catch (error) { /* ignore */ } });
  await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=medium&res=fixed&weather=sun&time=midday&resort=${rid}`);
  await page.waitForFunction("document.documentElement.dataset.skiRunning === '1'", null, { timeout: 180000 });
  const info = await page.evaluate(async (want) => {
    const S = window.__ski, W = S.modes.lifts.world, grade = (l) => (l.top.y - l.bottom.y) / l.len;
    const L = S.modes.lifts.list.filter((l) => { const s = W.sites.get(l.index); return s && s.path.kind === "drag" && s.path.sub !== "rope"; }).sort((a, b) => grade(b) - grade(a));
    const l = L.find((x) => !want || x.name === want) || L[0];
    await S.goFree(l.id);
    return { id: l.id, name: l.name, index: l.index };
  }, want);
  await page.waitForTimeout(4000);
  for (const [k, f] of [[0, 0.3], [1, 0.5], [2, 0.7]]) {
    await page.evaluate(({ index, f }) => {
      const S = window.__ski, p = S.modes.lifts.world.sites.get(index).path, q = p.at(p.len * f, {});
      const rx = -q.dz * p.sign, rz = q.dx * p.sign, lat = p.side;          // the track, the camera 7 m beyond it, looking across at it
      const tx = q.x + rx * lat, tz = q.z + rz * lat;
      S.setCamera(tx + rx * 7 - q.dx * 2, tz + rz * 7 - q.dz * 2, 1.6, tx, tz, 0.8, 50);
    }, { index: info.index, f });
    await page.waitForTimeout(k ? 5000 : 9000);
    await page.screenshot({ path: path.join(out, `${rid}-npc-drag-${k}.png`) });
  }
  console.log(`${rid} ${info.name}: shots in ${out}`);
} finally {
  await browser.close();
  server.close();
}
