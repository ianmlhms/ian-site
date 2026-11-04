/* Lux Drive: a screenshot daemon for cloud / Linux sessions (software GL boots in ~90 s, so the page stays open).
 *   node scripts/luxdrive/shotd.mjs [port=8791] &
 *   curl -s localhost:8791/reload?q=medium\&time=noon\&weather=clear     reload the game (after a code change)
 *   curl -s -d '{"name":"x","x":5906,"z":8100,"h":120,"yaw":-90,"pitch":-30}' localhost:8791/shot?out=/tmp/o   one pose -> out/x.png
 *   curl -s -d 'return window.__lux.stats()' localhost:8791/eval                                     JS in the page, JSON back
 * A pose: { name, x, z, h|y, yaw (deg, 0 = +x = east, 90 = +z = south), pitch (deg), at:[x,z,dy], fov, car:[x,z,yaw], mode:"chase" }. */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const { chromium } = createRequire("/opt/node-tools/")("playwright");
const MIME = { html: "text/html", js: "text/javascript", json: "application/json", css: "text/css", webp: "image/webp", png: "image/png" };
const port = Number(process.argv[2] || 8791);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--mute-audio"] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1180), height: Number(process.env.H || 820) } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

async function load(query) {
  errors.length = 0;
  await page.goto(`http://127.0.0.1:${port}/pb/lux-drive.html?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.luxReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 280000 });
  const be = await page.evaluate(() => document.documentElement.dataset.bootError);
  if (be) throw new Error("boot error: " + be + "\n" + errors.join("\n"));
  await page.click('[data-act="drive"]');
}
async function settle(useCar) {
  // two frames first: the camera (and the car) take their new pose in the frame, the build below reads them
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // build the world around the camera NOW (a software-GL frame takes a second, the game builds 3 tiles per frame): the terrain tiles, the
  // city cells and the trees are built in plain loops, then a few frames are drawn so the numbers are the steady state
  await page.evaluate((useCar) => {
    const m = window.__lux, p = m.camera.position, s = m.state();
    // the game follows the car (chase camera) or the held camera: build the tiles round the same point
    const fx = useCar ? s.x : p.x, fz = useCar ? s.z : p.z;
    m.terrain.buildAll(fx, fz);
    m.city.buildAll(s.x, s.z);
    m.trees.update(p.x, p.z, 0, true);
  }, useCar);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => window.__lux.stats());
    if (i > 2 && st.pending === 0 && st.cityPending === 0) break;
  }
  await page.waitForTimeout(500);
}
async function shot(pose, out) {
  await page.evaluate((p) => {
    const m = window.__lux;
    if (p.car) m.car.reset(p.car[0], p.car[1], p.car[2] || 0);
    if (p.carRoad) {                        // the nearest drivable road to a point: the car stands on it, facing along it, in its right-hand half
      const [qx, qz] = p.carRoad, want = p.kind || null, nameHas = (p.road || '').toLowerCase();
      let found = null;
      for (let r = 0; r <= 90 && !found; r += 3) {
        for (let a = 0; a < (r ? 16 : 1) && !found; a++) {
          const x = qx + Math.cos(a * Math.PI / 8) * r, z = qz + Math.sin(a * Math.PI / 8) * r;
          const info = m.roadAt(x, z);
          if (info && info.dir && !['footway', 'path', 'steps', 'cycleway', 'pedestrian'].includes(info.kind) && (!want || info.kind === want) && (!nameHas || (info.name || '').toLowerCase().includes(nameHas)) && Math.abs(info.lat) < info.width * 0.4) found = { x, z, info };
        }
      }
      if (found) { const d = found.info.dir; m.car.reset(found.x, found.z, Math.atan2(d.z, d.x)); }
      else console.error('no road near', qx, qz);
    }
    if (p.mode === "chase") { m.setCamera(null); return; }
    const x = p.x, z = p.z;
    const y = p.y !== undefined ? p.y : m.ground.height(x, z) + (p.h || 40);
    let tx, ty, tz;
    if (p.at) { tx = p.at[0]; tz = p.at[1]; ty = m.ground.height(tx, tz) + (p.at[2] || 0); }
    else {
      const yaw = (p.yaw || 0) * Math.PI / 180, pitch = (p.pitch === undefined ? -20 : p.pitch) * Math.PI / 180;
      tx = x + Math.cos(yaw) * Math.cos(pitch) * 100; tz = z + Math.sin(yaw) * Math.cos(pitch) * 100; ty = y + Math.sin(pitch) * 100;
    }
    m.setCamera({ x, y, z, tx, ty, tz, fov: p.fov || 62 });
  }, pose);
  await settle(pose.mode === 'chase');
  if (pose.wait) await page.waitForTimeout(pose.wait);          // e.g. the trees grow in over 0.45 s of game time: a software-GL frame is 0.1 s of it
  const stats = await page.evaluate(() => window.__lux.stats());
  fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, `${pose.name}.png`), timeout: 180000 });
  return stats;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const body = await new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c).toString())); });
  const send = (code, obj) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
  try {
    if (url.pathname === "/reload") { await load(url.search.slice(1) || "q=medium&time=noon&weather=clear"); return send(200, { ok: true, errors }); }
    if (url.pathname === "/shot") {
      const out = url.searchParams.get("out") || "/tmp/shots";
      const poses = JSON.parse(body); const list = Array.isArray(poses) ? poses : [poses];
      const result = [];
      for (const p of list) result.push({ name: p.name, stats: await shot(p, out) });
      return send(200, { result, errors: errors.slice(-8) });
    }
    if (url.pathname === "/eval") {
      const v = await page.evaluate(`(async()=>{${body}})()`);
      return send(200, { value: v, errors: errors.slice(-8) });
    }
    if (url.pathname === "/quit") { send(200, { ok: true }); await browser.close(); process.exit(0); }
    // static files of the repo
    const file = path.normalize(path.join(REPO, decodeURIComponent(url.pathname)));
    if (!file.startsWith(REPO + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("Content-Type", MIME[path.extname(file).slice(1)] || "application/octet-stream");
    res.end(fs.readFileSync(file));
  } catch (e) { send(500, { error: String(e.stack || e), errors: errors.slice(-8) }); }
});
server.listen(port, "127.0.0.1", () => console.log("shotd listening on", port));
