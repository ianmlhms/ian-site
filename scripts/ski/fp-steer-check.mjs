#!/usr/bin/env node
/* Ian (23 Nov 2026): "in first person, pressing D, the skis point to the LEFT but you go to the RIGHT". The real game, the real keys (D / A
 * held), both cameras, sampled every frame:
 *   tips   the ski tips against the camera's forward direction, in the world (azimuth, + = right) and IN THE PICTURE (the line boot -> tip
 *          on screen, + = tips to the right)
 *   edge   the skis' roll onto their edges relative to the slope (+ = the right edge down), third person = the reference
 *   snow   how far the first-person skis sit under / over the snow
 * D must give tips to the right and the right edge down, A the mirror, at 30-50 km/h on a blue and pivoting at walking pace.
 *   [SKI_RESORT=davos SKI_PISTE=jakobshorn-standard] BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/ski/fp-steer-check.mjs OUT_DIR [--tag after] [--old DIR]
 * --old DIR: DIR/firstperson.js and DIR/config.js instead of this checkout's (the "before" column). */
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, startServer } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const outDir = args[0];
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const tag = opt("--tag", "after"), oldDir = opt("--old", "");
fs.mkdirSync(outDir, { recursive: true });
const overrides = new Map();
if (oldDir) for (const f of ["firstperson.js", "config.js"]) overrides.set(`/pb/ski/${f}`, fs.readFileSync(path.join(oldDir, f)));

const MIN_YAW = 1, MIN_LEAN = 2, MIN_ROLL = 3;                    // degrees: what a player sees as "pointing that way"
const MAX_SNOW = 0.12;                                           // m: a ski's base line off the snow (a roller under the tail)
const SCENES = [
  { name: "carve", v: 11, hold: 1500, from: 250 },               // 40 km/h on the blue
  { name: "fast", v: 14, hold: 1200, from: 250 },                // 50 km/h
  { name: "skid", v: 5, hold: 1300, from: 250 },                 // 18 km/h: the skis come round faster than he does
  { name: "pivot", v: 0.8, hold: 900, from: 150 },               // from walking pace (the slope and the assist take him to ~15 km/h)
  { name: "walk", v: 0.8, hold: 900, from: 150, cap: 1.2 },      // held at walking pace (4 km/h): he pivots on the spot
  { name: "reverse", v: 11, hold: 1200, from: 400, other: 800 }, // the other key for 0.8 s first: no wrong-way tips after the change (from 0.4 s)
  { name: "stop", v: 11, hold: 800, from: 250, brake: true },    // the hockey stop (S + the key): both skis swing across
];

const browser = await launchBrowser({ fullChromium: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const { server, origin } = await startServer(undefined, { overrides });
const fails = [], results = {};
let checks = 0;
const expect = (ok, msg) => { checks++; if (!ok) { fails.push(msg); console.log("  FAIL", msg); } };
const median = (l) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
try {
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 })).newPage();
  page.on("pageerror", (e) => fails.push(`[pageerror] ${String(e).slice(0, 200)}`));
  await page.addInitScript(() => { try { localStorage.removeItem("pb_ski_cam"); } catch (error) { /* private mode */ } });
  await page.goto(`${origin}/pb/ski.html?resort=${process.env.SKI_RESORT || "killy"}&debug=1&q=medium&res=fixed&weather=sun&time=midday&piste=${process.env.SKI_PISTE || "genepy"}&auto=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.skiRunning === "1" || !!document.documentElement.dataset.bootError, null, { timeout: 150000 });
  await page.evaluate(() => {
    const S = window.__ski, T = window.THREE, DEG = 180 / Math.PI;
    S.game.bot = null;
    const wrap = (a) => { while (a > 180) a -= 360; while (a < -180) a += 360; return a; };
    /** Both skis: tip, front of the boot, tail (middle line of the base) and the unit vector left edge -> right edge (world). */
    const skis = (mode) => {
      const out = [];
      if (mode === "chase") {
        const g = S.skier.gearPoints().skis;                       // 16 points a ski: x 0.95 .. -0.78, left / right edge of each
        for (const o of [0, 16]) {
          const p = (i) => new T.Vector3(...g[o + i]);
          const mid = (i) => p(i).add(p(i + 1)).multiplyScalar(0.5);
          out.push({ tip: mid(2), boot: mid(6), tail: mid(14), cross: p(9).sub(p(8)).normalize() });
        }
        return out;
      }
      const root = S.fp.meshes.skis();
      root.updateMatrixWorld(true);
      const pair = root.isMesh;                                    // before the fix: one merged mesh of both skis
      for (const side of [-1, 1]) {
        const m = pair ? root : root.children[side < 0 ? 0 : 1], z = pair ? side * 0.12 : 0;
        const p = (x, dz = 0) => new T.Vector3(x, 0, z + dz).applyMatrix4(m.matrixWorld);
        out.push({ tip: p(0.8), boot: p(0.2), tail: p(-0.78), cross: p(0, 0.04).sub(p(0, -0.04)).normalize() });
      }
      return out;
    };
    const P = (window.__steer = { rows: null });
    const tick = () => {
      requestAnimationFrame(tick);
      if (!P.rows) return;
      const st = S.state, c = S.camera, mode = S.camMode;
      if (P.cap && st.speed > P.cap) { const k = P.cap / st.speed; S.game.state = { ...st, vx: st.vx * k, vy: st.vy * k, vz: st.vz * k, speed: P.cap }; }
      c.updateMatrixWorld(); c.updateProjectionMatrix();
      const list = skis(mode), fwd = new T.Vector3(); c.getWorldDirection(fwd);
      const n = { x: 0, y: 1, z: 0 }; S.surface.normal(st.x, st.z, n);
      let yaw = 0, roll = 0, snow = 0; const tip = new T.Vector3(), boot = new T.Vector3();
      for (const k of list) {
        yaw += wrap((Math.atan2(k.tip.z - k.tail.z, k.tip.x - k.tail.x) - Math.atan2(fwd.z, fwd.x)) * DEG) / 2;
        // the roll against the slope: the angle of the right edge below the slope plane
        roll += -Math.asin(Math.max(-1, Math.min(1, k.cross.x * n.x + k.cross.y * n.y + k.cross.z * n.z))) * DEG / 2;
        tip.add(k.tip.clone().project(c).multiplyScalar(0.5)); boot.add(k.boot.clone().project(c).multiplyScalar(0.5));
        for (const q of [k.boot, k.tail]) { const d = q.y - S.surface.height(q.x, q.z); if (Math.abs(d) > Math.abs(snow)) snow = d; }
      }
      const lean = Math.atan2((tip.x - boot.x) * c.aspect, tip.y - boot.y) * DEG;
      P.rows.push({ t: performance.now() - P.t0, yaw, roll, lean, snow: st.grounded ? snow : 0, tipX: tip.x, tipY: tip.y, kmh: st.speed * 3.6, edge: st.edge, slip: st.slip, crash: st.crash, air: st.grounded ? 0 : 1 });
    };
    requestAnimationFrame(tick);
  });
  // the steadiest blue stretch (about 10 degrees, 120 m, little cross slope) of the piste
  const s0 = await page.evaluate(() => {
    const S = window.__ski, p = S.game.piste, h = (a) => S.surface.height(a.x, a.z); let best = null;
    for (let s = 200; s < p.length - 300; s += 20) {
      let bad = 0;
      for (let d = 0; d < 120; d += 10) {
        const a = p.at(s + d, {}), b = p.at(s + d + 10, {}), sl = Math.atan2(h(a) - h(b), 10) * 180 / Math.PI;
        const cross = Math.abs(h({ x: a.x - a.dz * 6, z: a.z + a.dx * 6 }) - h({ x: a.x + a.dz * 6, z: a.z - a.dx * 6 })) / 12;
        bad += Math.abs(sl - 10) + cross * 30;
      }
      if (!best || bad < best.bad) best = { s, bad };
    }
    return best.s;
  });
  for (const mode of ["chase", "fp"]) for (const sc of SCENES) for (const [key, dir] of [["d", 1], ["a", -1], [null, 0]]) {
    if (!dir && sc.name !== "carve") continue;
    await page.evaluate(([s, v, m]) => {
      const S = window.__ski, a = S.game.piste.at(s, {});
      S.setInput(null); S.setCamMode(m);
      S.place(a.x, a.z, Math.atan2(a.dz, a.dx));
      S.game.state = { ...S.game.state, hold: 0, vx: a.dx * v, vz: a.dz * v, speed: v };
      S.look.reset(); S.camGuard.reset();
      window.__steer.rows = null;
    }, [s0, sc.v, mode]);
    await page.waitForTimeout(350);
    if (sc.other && key) { const o = key === "d" ? "a" : "d"; await page.keyboard.down(o); await page.waitForTimeout(sc.other); await page.keyboard.up(o); }
    if (sc.brake) await page.keyboard.down("s");
    if (key) await page.keyboard.down(key);
    await page.evaluate((cap) => { window.__steer.cap = cap; window.__steer.t0 = performance.now(); window.__steer.rows = []; }, sc.cap || 0);
    await page.waitForTimeout(sc.hold * 0.5);
    const label = `${mode}-${sc.name}-${key ? key.toUpperCase() : "straight"}`;
    await page.screenshot({ path: path.join(outDir, `${tag}-${label}.png`) });
    await page.waitForTimeout(sc.hold * 0.5);
    const all = await page.evaluate(() => { const r = window.__steer.rows; window.__steer.rows = null; return r; });
    if (key) await page.keyboard.up(key);
    if (sc.brake) await page.keyboard.up("s");
    const rows = all.filter((r) => r.t > sc.from && r.t < sc.hold && !r.crash && !r.air);
    const m = { n: rows.length, kmh: +median(rows.map((r) => r.kmh)).toFixed(0), edge: +median(rows.map((r) => r.edge)).toFixed(2), slip: +median(rows.map((r) => r.slip)).toFixed(2) };
    for (const k of ["yaw", "lean", "roll", "tipX", "tipY"]) m[k] = +median(rows.map((r) => r[k])).toFixed(k[0] === "t" ? 2 : 1);
    m.wrongYaw = +(100 * rows.filter((r) => r.yaw * dir < 0).length / Math.max(1, rows.length)).toFixed(0);
    m.wrongLean = +(100 * rows.filter((r) => r.lean * dir < 0).length / Math.max(1, rows.length)).toFixed(0);
    m.snowMin = +Math.min(...rows.map((r) => r.snow)).toFixed(2); m.snowMax = +Math.max(...rows.map((r) => r.snow)).toFixed(2);
    results[label] = m;
    console.log(label.padEnd(18), JSON.stringify(m));
    expect(rows.length > 10, `${label}: ${rows.length} frames`);
    if (!dir) { expect(Math.abs(m.yaw) < 3 && Math.abs(m.lean) < 4 && Math.abs(m.roll) < 4, `${label}: straight ahead the skis point straight (yaw ${m.yaw}, picture ${m.lean}, roll ${m.roll})`); continue; }
    expect(m.yaw * dir > MIN_YAW, `${label}: the tips point ${dir > 0 ? "right" : "left"} of the view (${m.yaw} deg)`);
    expect(m.lean * dir > MIN_LEAN, `${label}: in the picture the tips point ${dir > 0 ? "right" : "left"} (${m.lean} deg)`);
    expect(m.wrongYaw <= 5 && m.wrongLean <= 5, `${label}: never the wrong way (world ${m.wrongYaw} %, picture ${m.wrongLean} % of the frames)`);
    if (["carve", "fast", "reverse"].includes(sc.name)) expect(m.roll * dir > MIN_ROLL, `${label}: on the ${dir > 0 ? "right" : "left"} edges (${m.roll} deg)`);
    if (mode === "fp") {
      const ref = results[`chase-${sc.name}-${key.toUpperCase()}`];
      expect(Math.abs(ref.roll) < 2 || Math.sign(ref.roll) === Math.sign(m.roll), `${label}: the edge like the third person (${m.roll} vs ${ref.roll} deg)`);
      expect(m.snowMin > -MAX_SNOW && m.snowMax < MAX_SNOW, `${label}: on the snow (${m.snowMin} .. ${m.snowMax} m)`);
    }
  }
  fs.writeFileSync(path.join(outDir, `${tag}.json`), JSON.stringify(results, null, 1));
  console.log(fails.length ? `FAILED ${fails.length} of ${checks}` : `ok: ${checks} checks`);
  process.exitCode = fails.length ? 1 : 0;
} finally {
  await browser.close();
  server.close();
}
