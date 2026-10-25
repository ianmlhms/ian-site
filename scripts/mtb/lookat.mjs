#!/usr/bin/env node
/* Developer tool: screenshot of something in the world from a camera put next to it.
 *   node scripts/mtb/lookat.mjs OUT.png --what slab|boulder|stone|tree|fall --near x,z [--dist 9] [--up 2] [--q high] [--time noon] [--weather clear]
 * Finds the nearest object of that kind around (x, z), puts the camera `dist` metres away (on the open side for slabs) and looks at it. */
import { launchBrowser, startServer } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const out = args[0];
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const what = opt("--what", "slab");
const [nx, nz] = opt("--near", "1900,1520").split(",").map(Number);
const dist = Number(opt("--dist", "9")), up = Number(opt("--up", "2"));
const url = `/pb/mtb.html?debug=1&q=${opt("--q", "high")}&time=${opt("--time", "noon")}&weather=${opt("--weather", "clear")}&season=${opt("--season", "summer")}`;
const [w, h] = opt("--size", "1280x720").split("x").map(Number);
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
  page.on("console", (m) => { if (m.type() === "error") console.log("[page error]", m.text().slice(0, 300)); });
  await page.goto(origin + url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
  const info = await page.evaluate(([what, nx, nz, dist, up]) => {
    const m = window.__mtb;
    m.teleport(nx, nz);
    const found = [];
    const R = 70;
    if (what === "fall") { /* a waterfall position given directly */ found.push({ x: nx, z: nz, y: m.surface.height(nx, nz), yaw: 0 }); }
    else if (what === "tree") {
      for (let bz = Math.floor((nz - R) / 32); bz <= Math.floor((nz + R) / 32); bz++) for (let bx = Math.floor((nx - R) / 32); bx <= Math.floor((nx + R) / 32); bx++) {
        const t = m.trees.block(bx, bz);
        for (let i = 0; i < t.length; i += 6) if (t[i + 4] === 0 && t[i + 3] > 22) found.push({ x: t[i], z: t[i + 2], y: t[i + 1], d: Math.hypot(t[i] - nx, t[i + 2] - nz), yaw: 0 });
      }
    } else {
      const kinds = what === "slab" ? [0, 1, 2] : what === "boulder" ? [3, 4] : [5];
      for (let bz = Math.floor((nz - R) / 32); bz <= Math.floor((nz + R) / 32); bz++) for (let bx = Math.floor((nx - R) / 32); bx <= Math.floor((nx + R) / 32); bx++) {
        const t = m.rocks.block(bx, bz);
        for (let i = 0; i < t.length; i += 12) if (kinds.includes(t[i + 9])) found.push({ x: t[i], z: t[i + 2], y: t[i + 1], d: Math.hypot(t[i] - nx, t[i + 2] - nz), yaw: t[i + 3], sy: t[i + 6] });
      }
    }
    found.sort((a, b) => (a.d || 0) - (b.d || 0));
    const f = found[0];
    if (!f) return { error: "none found", count: found.length };
    const dx = Math.sin(f.yaw), dz = Math.cos(f.yaw);           // the open side of a slab (its face normal, horizontal)
    const cx = f.x + dx * dist, cz = f.z + dz * dist;
    const cy = Math.max(m.surface.height(cx, cz), f.y) + up;
    const tx = f.x, tz = f.z, ty = f.y + (f.sy || 1) * 0.4;
    m.teleport(cx, cz);
    m.setCamera({ x: cx, y: cy, z: cz, tx, ty, tz, fov: 62 });
    return { found: found.length, f };
  }, [what, nx, nz, dist, up]);
  console.log(JSON.stringify(info));
  await page.waitForTimeout(Number(opt("--wait", "2500")));
  await page.screenshot({ path: out });
} finally { await browser.close(); server.close(); }
