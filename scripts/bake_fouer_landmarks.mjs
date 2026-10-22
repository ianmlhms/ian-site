#!/usr/bin/env node
/* Schueberfouer Tycoon W2: bakes the hand-modelled Luxtram landmarks around the Glacis into plain geometry.
 *
 *   node scripts/bake_fouer_landmarks.mjs OUT.json [key:lod ...]       e.g. theatre:hi institut:hi rouge:lo
 *
 * Runs pb/train-sim/luxtram-landmarks.js (the real builder, 322 KB + 1.8 MB LOD2 detail) in headless Chromium against
 * the LiDAR height tiles, collects the built meshes and packs them: int16 cm positions, int8 normals, uint8 colours,
 * uint16 uv into a COMPACT atlas that holds only the cells those landmarks use (day 192 px / lit 96 px per cell, PNG data URLs).
 * The python bake (scripts/bake_fouer_world.py) stores the result in pb/fouer/data/glacis-world.bin, so the game never loads
 * the 2 MB builder.  Needs network for three.js r160 (jsdelivr) once.  Uses the flow harness' browser launcher. */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./flows/lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2];
const wanted = process.argv.slice(3).map((a) => { const [k, l] = a.split(":"); return { key: k, hi: l !== "lo" }; });
if (!out || !wanted.length) { console.error("usage: bake_fouer_landmarks.mjs OUT.json key:hi|lo ..."); process.exit(2); }

const MIME = { html: "text/html", js: "text/javascript", mjs: "text/javascript", json: "application/json", bin: "application/octet-stream" };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || "/").split("?")[0]);
  const file = path.normalize(path.join(REPO, rel));
  if (rel === "/bake.html") { res.setHeader("Content-Type", "text/html"); res.end(PAGE); return; }
  if (!file.startsWith(REPO + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end("nf"); return; }
  res.setHeader("Content-Type", MIME[path.extname(file).slice(1)] || "application/octet-stream");
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const PAGE = `<!doctype html><meta charset=utf-8><body>
<script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script>
<script src="/pb/train-sim/luxtram-landmarks.js"></script>
<script type="module">
import { decodeHeights, createDem } from '/pb/fouer/world/dem.js';
window.bake = async (wanted) => {
  const T = THREE; const TS = window.TS;
  // LiDAR ground for the landmark bases (Luxtram local metres, y absolute)
  const idx = await (await fetch('/pb/train-sim/data/luxtram/index.json')).json();
  const tiles = new Map();
  await Promise.all(Object.keys(idx.tiles).filter((k) => { const [i, j] = k.split('_').map(Number); return i >= -28 && i <= -17 && j >= -14 && j <= -7; }).map(async (k) => {
    const r = await fetch('/pb/train-sim/data/luxtram/h/' + k + '.bin'); if (!r.ok) return;
    const d = decodeHeights(await r.arrayBuffer()); tiles.set(k, d);
  }));
  const dem = createDem(tiles);
  const scene = new T.Scene();
  const lm = TS.luxLandmarks.build(scene, { quality: 'high', groundAt: (x, z) => { const h = dem.sample(x, z); return Number.isFinite(h) ? h : 0; }, railY: (x, z) => { const h = dem.sample(x, z); return Number.isFinite(h) ? h : 0; } });
  await new Promise((res) => lm.whenReady(res));
  const result = { landmarks: {}, cells: [] };
  const used = new Map();   // cell index -> compact index
  const cellOf = (u, v) => { const col = Math.max(0, Math.min(7, Math.floor(u * 8))); const row = Math.max(0, Math.min(11, Math.floor((1 - v) * 12))); return row * 8 + col; };
  const items = [];
  for (const w of wanted) {
    const name = w.key + ':' + (w.hi ? 'hi' : 'lo'); w.name = name;
    const s = lm.state.find((q) => q.d.key === w.key); if (!s) { result.landmarks[name] = null; continue; }
    lm.state.forEach((q) => { q.group.visible = false; });
    // build only this one
    lm.warmAll(w.hi, w.key);
    const grp = s.group; const mesh = w.hi ? s.hi : s.lo;
    if (!mesh) { result.landmarks[name] = null; continue; }
    const meshes = [mesh]; mesh.children.forEach((c) => { if (c.isMesh) meshes.push(c); });
    const parts = meshes.map((m) => ({ g: m.geometry, spin: m.userData.spin || null, pos: m.position.toArray() }));
    items.push({ key: name, hi: w.hi, x: s.x, z: s.z, y: s.y, parts, base: s.d.base });
    parts.forEach((pt) => { const uv = pt.g.attributes.uv; for (let i = 0; i < uv.count; i++) { const c = cellOf(uv.getX(i), uv.getY(i)); if (!used.has(c)) used.set(c, used.size); } });
  }
  const keys = new Set(wanted.map((w) => w.key));
  result.footprints = TS.luxLandmarks.footprints.filter((f) => keys.has(f.key)).map((f) => ({ key: f.key, role: f.role, ring: f.ring }));
  const order = [...used.keys()];
  const NC = 4; const NR = Math.ceil(order.length / NC);
  const b64 = (arr) => { const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
  items.forEach((it) => {
    result.landmarks[it.key] = { hi: it.hi, x: it.x, z: it.z, y: it.y, base: it.base, parts: it.parts.map((pt) => {
      const g = pt.g; g.computeBoundingBox(); const bb = g.boundingBox; const P = g.attributes.position; const N = g.attributes.normal; const UV = g.attributes.uv; const Cc = g.attributes.color; const n = P.count;
      const pos = new Int16Array(n * 3); const nor = new Int8Array(n * 3); const uv = new Uint16Array(n * 2); const col = new Uint8Array(n * 3);
      const ctr = [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2];
      const half = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) / 2 + 1e-3;
      const sc = 32767 / half;                // int16 steps over the part's own bounding cube (about 1-2 cm)
      let clipped = 0;
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) { pos[i * 3 + k] = Math.round((P.array[i * 3 + k] - ctr[k]) * sc); nor[i * 3 + k] = Math.round(N.array[i * 3 + k] * 127); col[i * 3 + k] = Math.max(0, Math.min(255, Math.round(Cc.array[i * 3 + k] * 255))); }
        const c = cellOf(UV.getX(i), UV.getY(i)); const ci = used.get(c); const col0 = c % 8; const row0 = Math.floor(c / 8);
        const fu = Math.max(0, Math.min(1, UV.getX(i) * 8 - col0)); const fv = Math.max(0, Math.min(1, (1 - UV.getY(i)) * 12 - row0));
        const ncol = ci % NC; const nrow = Math.floor(ci / NC);
        uv[i * 2] = Math.round(((ncol + fu) / NC) * 65535); uv[i * 2 + 1] = Math.round((1 - (nrow + fv) / NR) * 65535);
      }
      const idx = g.index.array; const idxU = n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
      return { n, ctr, half, bbox: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].map((v) => Math.round(v * 10) / 10), tris: idx.length / 3, clipped, spin: pt.spin, pos: pt.pos, P: b64(pos), N: b64(nor), UV: b64(uv), C: b64(col), I: b64(idxU), i32: n > 65535 };
    }) };
  });
  // compact atlas
  const full = TS.luxLandmarks.active.material;
  const dayC = full.map.image; const litC = full.emissiveMap.image;
  const cellPx = 128; const litPx = 64;
  const mk = (src, px) => { const c = document.createElement('canvas'); c.width = NC * px; c.height = NR * px; const g = c.getContext('2d'); g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, c.width, c.height); order.forEach((cell, k) => { g.drawImage(src, (cell % 8) * px, Math.floor(cell / 8) * px, px, px, (k % NC) * px, Math.floor(k / NC) * px, px, px); }); return c; };
  result.atlas = { cols: NC, rows: NR, cellPx, litPx, cells: order, day: mk(dayC, cellPx).toDataURL('image/png'), lit: mk(litC, litPx).toDataURL('image/png') };
  return result;
};
window.ready = true;
</script>`;

const browser = await launchBrowser({ fullChromium: true });
try {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.goto(origin + "/bake.html");
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  const data = await page.evaluate((w) => window.bake(w), wanted);
  if (errs.length) console.warn("page errors:", errs.slice(0, 5));
  fs.writeFileSync(out, JSON.stringify(data));
  for (const [k, v] of Object.entries(data.landmarks)) {
    console.log(k, v ? v.parts.map((p) => `${p.n} verts ${p.tris} tris bbox ${p.bbox}${p.clipped ? " CLIPPED " + p.clipped : ""}`).join(" | ") + ` at (${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})` : "MISSING");
  }
  console.log("atlas", data.atlas.cols + "x" + data.atlas.rows, "cells", data.atlas.cells.length, "day png", Math.round(data.atlas.day.length * 0.75 / 1024) + " KB", "lit png", Math.round(data.atlas.lit.length * 0.75 / 1024) + " KB");
} finally {
  await browser.close();
  server.close();
}
