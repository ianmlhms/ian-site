#!/usr/bin/env node
/* The chase camera in the real game (GPU Chromium, iPad 9 landscape 1180 x 820 + portrait, touch): the same scripted moments shot with
 * the camera of this checkout, or with another camera.js / config.js (--old DIR holding those two files: the "before" column of a sheet).
 *   node scripts/ski/camera-shots.mjs OUT_DIR [--old DIR] [--tag after] [--resort killy] [--only blue,black,...]
 * Scenes: blue (a carve on the long blue at ~55 km/h), black (the Face de Bellevarde tucked at ~100 km/h), slow (walking pace on the
 * blue), village (skating down a village street), spawn (standing at the first lift), kicker (the snow park's biggest kicker: the run-in
 * and the air), trees (a forest piste edge at speed), forest-run (9 s through the forest, no steering), + blue / black in portrait. Each scene also measures the camera (pitch, height,
 * distance, clearance over the snow, camBlocked at the camera = inside a tree / house / pylon) over its whole ride: OUT_DIR/<tag>.json.
 * Run through ~/Library/Caches/browser-slot.py (BROWSER_POOL=ski). */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, startServer } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const outDir = args[0];
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const tag = opt("--tag", "after");
const rid = opt("--resort", "killy");
const only = opt("--only", "").split(",").filter(Boolean);
const oldDir = opt("--old", "");
fs.mkdirSync(outDir, { recursive: true });
const overrides = new Map();
if (oldDir) for (const f of ["camera.js", "config.js"]) overrides.set(`/pb/ski/${f}`, fs.readFileSync(path.join(oldDir, f)));

const browser = await launchBrowser({ fullChromium: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const { server, origin } = await startServer(undefined, { overrides });
const LAND = { width: 1180, height: 820 }, PORT = { width: 820, height: 1180 };
const results = {};
let bad = 0;
try {
  const ctx = await browser.newContext({ viewport: LAND, deviceScaleFactor: 1, hasTouch: true, isMobile: false });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { bad++; console.log("[pageerror]", String(e).slice(0, 300)); });
  const open = async (query) => {
    await page.goto(`${origin}/pb/ski.html?resort=${rid}&debug=1&q=high&res=fixed&weather=sun&time=midday&${query}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.skiRunning === "1" || !!document.documentElement.dataset.bootError, null, { timeout: 150000 });
    await page.evaluate(() => { const S = window.__ski; S.game.bot = null; S.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); });
  };
  /** Start the camera probe: every frame the camera against the skier and the world. */
  const probe = () => page.evaluate(() => {
    const S = window.__ski, P = (window.__camProbe = { on: true, rows: [] });
    const tick = () => {
      if (!P.on) return;
      const st = S.state, c = S.camera.position, d = new window.THREE.Vector3();
      S.camera.getWorldDirection(d);
      if (st && S.game.screen === "ski") P.rows.push({
        v: st.speed, pitch: -Math.asin(d.y) * 180 / Math.PI, up: c.y - st.y, dist: Math.hypot(c.x - st.x, c.z - st.z), clear: c.y - S.surface.height(c.x, c.z),
        blocked: S.camBlocked(c.x, c.y, c.z) ? 1 : 0, fov: S.camera.fov,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const endProbe = async (name) => {
    const rows = await page.evaluate(() => { const P = window.__camProbe; P.on = false; return P.rows; });
    const tail = rows.slice(Math.floor(rows.length * 0.6));
    const mean = (k) => tail.reduce((t, o) => t + o[k], 0) / Math.max(1, tail.length);
    const r = { frames: rows.length, kmh: +(mean("v") * 3.6).toFixed(0), pitch: +mean("pitch").toFixed(1), up: +mean("up").toFixed(2), dist: +mean("dist").toFixed(2), clear: +mean("clear").toFixed(2), fov: +mean("fov").toFixed(0), minClear: +Math.min(...rows.map((o) => o.clear)).toFixed(2), blocked: rows.reduce((t, o) => t + o.blocked, 0) };
    results[name] = r;
    console.log(name.padEnd(16), JSON.stringify(r));
  };
  /** Ride: from metre s of the current piste (or a point) with speed v along the line, a fixed input for ms, then the picture. */
  const rideFrom = async (name, { s = null, at = null, v, input, ms, viewport = LAND, mid = null }) => {
    if (only.length && !only.includes(name)) return;
    await page.setViewportSize(viewport);
    await page.evaluate(([s0, at0, v0, inp]) => {
      const S = window.__ski;
      let x, z, dx, dz;
      if (at0) { [x, z, dx, dz] = at0; } else { const p = S.game.piste.at(s0, {}); x = p.x; z = p.z; dx = p.dx; dz = p.dz; }
      S.place(x, z, Math.atan2(dz, dx));
      S.game.state = { ...S.game.state, hold: 0, vx: dx * v0, vz: dz * v0, speed: v0 };
      S.look.reset(); S.camGuard.reset();
      S.setInput(inp);
    }, [s, at, v, input]);
    await probe();
    if (mid) { await page.waitForTimeout(mid.ms); await page.evaluate((inp) => window.__ski.setInput(inp), mid.input); }
    await page.waitForTimeout(ms);
    await page.screenshot({ path: path.join(outDir, `${tag}-${name}.png`) });
    await endProbe(name);
    await page.evaluate(() => window.__ski.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }));
  };
  const go = (o) => ({ steer: 0, tuck: 0, brake: 0, push: 0, jump: false, ...o });

  // ---- the long blue: a carve at cruising speed, walking pace, the forest edge ----
  await open("piste=genepy&auto=1");
  await rideFrom("blue", { s: 900, v: 15, input: go({ steer: 0.35 }), mid: { ms: 1500, input: go({ steer: -0.4 }) }, ms: 1300 });
  await rideFrom("slow", { s: 900, v: 3, input: go({ push: 1 }), ms: 2500 });
  await rideFrom("blue-portrait", { s: 900, v: 15, input: go({ steer: 0.35 }), mid: { ms: 1500, input: go({ steer: -0.4 }) }, ms: 1300, viewport: PORT });
  // ---- the Face de Bellevarde: steep, tucked, fast ----
  await open("piste=face-de-bellevarde&auto=1");
  const steep = await page.evaluate(() => { const S = window.__ski, p = S.game.piste, n = {}; let best = 300, deg = 0; for (let s = 200; s < p.length - 400; s += 20) { const a = p.at(s + 60, {}); S.surface.normal(a.x, a.z, n); const d = Math.acos(n.y) * 180 / Math.PI; if (d > deg && d < 34) { deg = d; best = s; } } return { s: best, deg }; });
  console.log("black: steepest stretch from", JSON.stringify(steep));
  await rideFrom("black", { s: steep.s - 30, v: 27, input: go({ tuck: 1 }), ms: 3200 });
  await rideFrom("black-portrait", { s: steep.s - 30, v: 27, input: go({ tuck: 1 }), ms: 3200, viewport: PORT });
  await rideFrom("black-start", { s: 4, v: 2, input: go({ tuck: 1 }), ms: 2600 });
  // a forest stretch: the piste point with the most trunks within 30 m, skied along the edge
  const wood = await page.evaluate(() => {
    const S = window.__ski, p = S.game.piste; let best = null;
    for (let s = 300; s < p.length - 200; s += 25) { const a = p.at(s, {}); let n = 0; for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) if (S.scatter.hit(a.x + i * 9, a.z + j * 9, 4, undefined, 1)) n++; if (!best || n > best.n) best = { s, n }; }
    return best;
  });
  console.log("trees: densest stretch", JSON.stringify(wood));
  await rideFrom("trees", { s: wood.s - 60, v: 20, input: go({ steer: 0.12 }), mid: { ms: 1400, input: go({ steer: -0.12 }) }, ms: 1400 });
  // the same forest stretch for 9 s with no steering (the nets, a fall, the trees beside the piste: the camera guard's stress ride)
  await rideFrom("forest-run", { s: Math.max(20, wood.s - 150), v: 15, input: go({ tuck: 1 }), mid: { ms: 4500, input: go({ tuck: 1, steer: 0.5 }) }, ms: 4500 });
  // ---- the village: standing at the first lift, then down a street ----
  if (!only.length || only.includes("spawn") || only.includes("village")) {
    await page.setViewportSize(LAND);
    await page.evaluate(() => window.__ski.firstLift());
    await page.waitForFunction(() => window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running" && !!window.__ski.roadRows, null, { timeout: 90000 });
    await page.waitForTimeout(5000);
    if (!only.length || only.includes("spawn")) { await probe(); await page.waitForTimeout(1500); await page.screenshot({ path: path.join(outDir, `${tag}-spawn.png`) }); await endProbe("spawn"); }
    const street = await page.evaluate(() => {
      const S = window.__ski, st = S.state; let best = null;
      for (const r of S.roadRows) for (let i = 0; i + 4 < r.pts.length; i++) {
        const a = r.pts[i], b = r.pts[i + 4], d = Math.hypot(a[0] - st.x, a[1] - st.z), l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l < 12 || d < 40 || d > 400) continue;
        let houses = 0; for (const side of [-9, 9]) for (const k of [0.2, 0.5, 0.8]) if (S.boxIndex && S.boxIndex.hit(a[0] + (b[0] - a[0]) * k - (b[1] - a[1]) / l * side, a[1] + (b[1] - a[1]) * k + (b[0] - a[0]) / l * side, 4)) houses++;
        const down = S.surface.height(a[0], a[1]) >= S.surface.height(b[0], b[1]);
        if (!best || houses > best.houses) best = { houses, at: down ? [a[0], a[1], (b[0] - a[0]) / l, (b[1] - a[1]) / l] : [b[0], b[1], (a[0] - b[0]) / l, (a[1] - b[1]) / l] };
      }
      return best;
    });
    console.log("village street", JSON.stringify(street));
    if (street) {
      await page.evaluate(([x, z]) => { const S = window.__ski; if (S.village && S.village.buildNear) S.village.buildNear(x, z, 400); S.streamer.focus(x, z); }, street.at);
      await rideFrom("village", { at: street.at, v: 5, input: go({ push: 1 }), ms: 4500 });
    }
  }
  // ---- the snow park: the biggest kicker (run-in, then in the air) ----
  if (!only.length || only.includes("kicker") || only.includes("air")) {
    await page.setViewportSize(LAND);
    await page.evaluate(() => window.__ski.startPark());
    await page.waitForFunction(() => window.__ski.game.mode === "park" && window.__ski.game.phase === "running", null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    const lip = await page.evaluate(() => { const l = window.__ski.parkLayout; const k = l.kickers.reduce((a, b) => (b.lip > a.lip ? b : a), l.kickers[0]); return k ? k.lip : 0; });
    console.log("park: kicker lip at", lip);
    await rideFrom("kicker", { s: Math.max(2, lip - 42), v: 13, input: go({}), ms: 1500 });
    await rideFrom("air", { s: Math.max(2, lip - 42), v: 13, input: go({}), ms: 3300 });
  }
  fs.writeFileSync(path.join(outDir, `${tag}.json`), JSON.stringify(results, null, 1));
  const inside = Object.entries(results).filter(([, r]) => r.blocked > 0 || r.minClear < 0.4);
  console.log(inside.length || bad ? `FAILED: camera inside geometry / under the snow in ${inside.map(([k, r]) => `${k} (${r.blocked} frames, min ${r.minClear} m)`).join(", ")}${bad ? `, ${bad} page errors` : ""}` : `ok: the camera never inside a tree / house / pylon nor under the snow in ${Object.keys(results).length} scenes`);
  process.exitCode = inside.length || bad ? 1 : 0;
} finally {
  await browser.close();
  server.close();
}
