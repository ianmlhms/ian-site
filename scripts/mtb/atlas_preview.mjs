#!/usr/bin/env node
/* Developer tool: paints the foliage atlas in a headless browser and saves it as a PNG (alpha over a flat grey).
 *   node scripts/mtb/atlas_preview.mjs OUT.png */
import fs from "node:fs";
import { launchBrowser, startServer } from "../flows/lib.mjs";

const out = process.argv[2] || "atlas.png";
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  await page.goto(origin + "/pb/mtb/robots.txt", { waitUntil: "domcontentloaded" }).catch(() => {});
  const url = await page.evaluate(async () => {
    const mod = await import("/pb/mtb/leaf-textures.js");
    const a = mod.paintLeafAtlas();
    const c = document.createElement("canvas"); c.width = a.width; c.height = a.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#5a6a7a"; ctx.fillRect(0, 0, a.width, a.height);
    const img = new ImageData(new Uint8ClampedArray(a.data), a.width, a.height);
    const t = document.createElement("canvas"); t.width = a.width; t.height = a.height; t.getContext("2d").putImageData(img, 0, 0);
    ctx.drawImage(t, 0, 0);
    return c.toDataURL("image/png");
  });
  fs.writeFileSync(out, Buffer.from(url.split(",")[1], "base64"));
  console.log("wrote", out);
} finally { await browser.close(); server.close(); }
