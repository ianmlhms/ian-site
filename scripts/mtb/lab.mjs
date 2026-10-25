#!/usr/bin/env node
/* Developer tool: the "model lab". Hides the forest, puts a row of rock models (slabs, overhang, boulders) on flat ground in front of the camera and takes a picture.
 *   node scripts/mtb/lab.mjs OUT.png [--at x,z] [--time noon] [--size 1280x720] */
import { launchBrowser, startServer } from "../flows/lib.mjs";
const args = process.argv.slice(2);
const out = args[0];
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const [ax, az] = opt("--at", "1000,2600").split(",").map(Number);
const [w, h] = opt("--size", "1280x720").split("x").map(Number);
const which = opt("--models", "0,2,3").split(",").map(Number);
const tilt = Number(opt("--tilt", "0"));
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
  await page.goto(origin + `/pb/mtb.html?debug=1&q=high&time=${opt("--time", "noon")}&weather=clear`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
  await page.evaluate(([ax, az, which, tilt]) => {
    const m = window.__mtb;
    m.teleport(ax, az);
    m.forest.group.visible = false; m.rider.setVisible(false);
    const names = ["slabA", "slabB", "overhang", "boulderA", "boulderB", "stone"];
    const gy = m.surface.height(ax, az);
    // freeze the rock refill: write our own instances
    m.rockView.update = () => {};
    for (const s of Object.values(m.rockView.sets)) s.g.instanceCount = 0;
    which.forEach((k, idx) => {
      const s = m.rockView.sets[names[k] + ":near"];
      const x = ax + (idx - (which.length - 1) / 2) * 7.5, z = az + 8;
      s.pos.array.set([x, m.surface.height(x, z) + (k < 3 ? 0 : 0.3), z], 0);
      s.rot.array.set([Math.PI, k < 3 ? tilt : 0, 1.5, 0.3], 0);          // yaw pi: the face looks at the camera
      s.scl.array.set(k < 3 ? [5.5, 3.6, 1.8] : [2.6, 2.6, 2.6], 0);
      s.g.instanceCount = 1; s.pos.needsUpdate = s.rot.needsUpdate = s.scl.needsUpdate = true;
    });
    m.setCamera({ x: ax, y: gy + 2.0, z: az - 1.5, tx: ax, ty: gy + 1.6, tz: az + 8, fov: 56 });
  }, [ax, az, which, tilt]);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out });
} finally { await browser.close(); server.close(); }
