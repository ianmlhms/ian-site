/* Lux Drive: draw calls and triangles per quality level at a pose, with a breakdown by kind of object.
 *   node scripts/luxdrive/perf.mjs [x,z]            (default: the start place in Kirchberg)
 * Cloud / Linux friendly (software GL; only the COUNTS are meaningful, not the frame rate).  Playwright is found like in the flows:
 * $PLAYWRIGHT_DIR, else /opt/node-tools. The breakdown walks the scene: a mesh counts when it is visible and in the frustum. */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const require = createRequire(process.env.PLAYWRIGHT_DIR ? path.dirname(path.dirname(process.env.PLAYWRIGHT_DIR)) + "/" : "/opt/node-tools/");
const { chromium } = require("playwright");
const MIME = { html: "text/html", js: "text/javascript", json: "application/json", css: "text/css", webp: "image/webp", png: "image/png", bin: "application/octet-stream" };
const at = (process.argv[2] || "").split(",").map(Number);

const server = http.createServer((req, res) => {
  const file = path.join(REPO, decodeURIComponent((req.url || "/").split("?")[0]));
  if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end("nf"); return; }
  res.setHeader("Content-Type", MIME[path.extname(file).slice(1)] || "application/octet-stream");
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
// macOS renders on the Mac's own GPU (Metal: ~6x faster per shot and every tile loaded before the shot); Linux / the cloud keep software GL.
// SHOT_GL=swiftshader forces software rendering anywhere.
const USE_METAL = process.platform === "darwin" && process.env.SHOT_GL !== "swiftshader";
const GL_ARGS = USE_METAL ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ args: [...GL_ARGS, "--mute-audio"] });
const rows = [];
try {
  for (const q of ["low", "medium", "high"]) {
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/pb/lux-drive.html?q=${q}&time=noon&weather=clear`);
    await page.waitForFunction(() => document.documentElement.dataset.luxReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 240000 });
    await page.click('[data-act="drive"]');
    if (at.length === 2 && at.every(Number.isFinite)) await page.evaluate(([x, z]) => window.__lux.teleportNear(x, z, 500), at);
    for (let i = 0; i < 40; i++) { await page.waitForTimeout(500); const s = await page.evaluate(() => window.__lux.stats()); if (i > 3 && s.pending === 0 && s.cityPending === 0) break; }
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const m = window.__lux, THREE = window.THREE;
      const frustum = new THREE.Frustum(), mat = new THREE.Matrix4();
      mat.multiplyMatrices(m.camera.projectionMatrix, m.camera.matrixWorldInverse); frustum.setFromProjectionMatrix(mat);
      const groups = {};
      const visible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
      m.scene.traverse((o) => {
        if (!(o.isMesh || o.isLine || o.isPoints) || !visible(o)) return;
        if (o.frustumCulled !== false && o.geometry) { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); const s = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld); if (!frustum.intersectsSphere(s)) return; }
        const g = o.geometry, idx = g.index ? g.index.count : g.attributes.position.count;
        const count = o.isInstancedMesh ? o.count : 1;
        let named = o; while (named && !named.name) named = named.parent;
        let key = (named && named.name) || `${o.type} ${g.attributes.position.count}v`;
        key = key.replace(/[-_ ]?-?\d+(,-?\d+)*$/, "").replace(/\d+/g, "#");
        const gr = (groups[key] ||= { meshes: 0, tris: 0 });
        gr.meshes += 1; gr.tris += Math.round((idx / 3) * count);
      });
      return { calls: m.stats().calls, tris: m.stats().triangles, tiles: m.stats().tiles, groups };
    });
    rows.push({ q, ...r });
    await page.close();
  }
} finally { await browser.close(); server.close(); }
for (const r of rows) {
  console.log(`\n${r.q}: ${r.calls} draw calls, ${r.tris} triangles, ${r.tiles} terrain tiles`);
  const top = Object.entries(r.groups).sort((a, b) => b[1].tris - a[1].tris).slice(0, 14);
  for (const [k, v] of top) console.log(`   ${k.padEnd(28)} ${String(v.meshes).padStart(4)} meshes ${String(v.tris).padStart(8)} tris`);
}
