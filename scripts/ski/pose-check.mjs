#!/usr/bin/env node
/* Round 7 (A): the skier's braking / carving poses, checked by geometry and shown from behind, the side and above.
 *   node scripts/ski/pose-check.mjs [--resorts killy,...] [--engine webkit|chromium] [--out DIR] [--shots]
 * The game is paused (physics frozen) and the skier's state is set by hand on a real piste, so the pose itself is judged:
 *   plough   a V: tips close (< 0.45 m), tails apart (> tips + 0.35 m), both skis pointing forward (< 35 deg off the heading), on the snow
 *   hockey   both skis parallel (< 12 deg apart), across the travel direction (60-120 deg), close together (< 0.6 m), on the snow,
 *            edged into the slope (the uphill edge up)
 *   carve    both skis on the snow (lowest point >= -2 cm), parallel (< 10 deg)
 *   R8e      the plough at 0 (held on the brake), 1, 4, 7, 8 and 10 km/h: a clear V (15-70 deg), tips not crossed; a REAL hockey stop from
 *            40 km/h and its held end pose at 0 km/h (right at the stop and 2 s later): parallel, side by side, across the fall line, edged
 * Exit 1 on a failure; PNGs <engine>-<resort>-<pose>-<view>.png with --shots. */
import fs from "node:fs";
import path from "node:path";
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const resorts = opt("--resorts", "killy,3vallees,zermatt,arlberg,kronplatz,vialattea").split(",");
const engine = opt("--engine", "webkit");
const out = opt("--out", path.join(process.env.HOME, "Library/Caches/ski-work/round7/poses"));
const shots = args.includes("--shots");
fs.mkdirSync(out, { recursive: true });
process.env.FLOW_BROWSER = engine;
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
let fails = 0;
// R8e (3V QA: plough at 0-7 km/h parallel / crossed, Mauduit): the V at every low speed 0-10 km/h, standing on the brake (held) too
const POSES = {
  'plough-held': { brake: 1, stop: 0, edge: 0, speed: 0, hold: 1, tuck: 0 },
  'plough-1kmh': { brake: 1, stop: 0, edge: 0, speed: 0.3, tuck: 0 },
  'plough-4kmh': { brake: 1, stop: 0, edge: 0, speed: 1.1, tuck: 0 },
  'plough-7kmh': { brake: 1, stop: 0, edge: 0, speed: 1.95, tuck: 0 },
  plough: { brake: 1, stop: 0, edge: 0, speed: 2.2, tuck: 0 },
  'plough-10kmh': { brake: 1, stop: 0, edge: 0, speed: 2.8, tuck: 0 },
  hockey: { brake: 1, stop: 1, stopSide: 1, edge: 1, speed: 7, tuck: 0, motion: -Math.PI / 2 * 0.9 },
  carve: { brake: 0, stop: 0, edge: 0.9, speed: 15, tuck: 0.2 },
};
try {
  for (const rid of resorts) {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`[${rid}] pageerror`, String(e).slice(0, 300)));
    await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=medium&weather=sun&time=midday&resort=${rid}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 240000 });
    const spot = await page.evaluate(async () => {
      const S = window.__ski;
      const p = S.pistes.list.filter((q) => q.diff === 'blue' && q.length > 700).sort((a, b) => b.length - a.length)[0] || S.pistes.list[0];
      const a = p.at(p.length / 2, {});
      S.place(a.x, a.z, Math.atan2(a.dz, a.dx));
      await S.streamer.ready(a.x, a.z, 300);
      return { x: a.x, z: a.z, h: Math.atan2(a.dz, a.dx), name: p.name };
    });
    await page.waitForTimeout(1500);
    for (const [name, P] of Object.entries(POSES)) {
      const r = await page.evaluate(async ({ P, spot }) => {
        const S = window.__ski;
        S.game.paused = true;
        const y = S.surface.height(spot.x, spot.z);
        const motion = spot.h + (P.motion || 0);              // the hockey stop: the skis across the travel direction
        const st = { ...S.state, x: spot.x, z: spot.z, y, heading: spot.h, grounded: true, air: 0, crash: 0, ride: '', landed: 0, slip: P.stop ? 0.9 : 0,
          brake: P.brake, stop: P.stop, stopSide: P.stopSide || 1, edge: P.edge, tuck: P.tuck, speed: P.speed, vx: Math.cos(motion) * P.speed, vz: Math.sin(motion) * P.speed, vy: 0, hold: P.hold || 0 };
        S.game.state = st;
        // the figure's smoothed drivers settle: 900 ms AND 60 drawn frames (R8b: under machine load 900 ms were ~20 frames, half a plough)
        await new Promise((res) => { const t0 = performance.now(); let n = 0; const f = () => { n++; if (n >= 60 && performance.now() - t0 >= 900) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
        const ends = S.skier.skiEnds();
        const dir = (e) => Math.atan2(e.tip.z - e.tail.z, e.tip.x - e.tail.x);
        const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
        const tipGap = Math.hypot(ends[0].tip.x - ends[1].tip.x, ends[0].tip.z - ends[1].tip.z);
        // R8e: crossed tips: the two tips swap sides (left ski's tip right of the right ski's tip, across the heading)
        const lat = (p) => -(p.x - spot.x) * Math.sin(spot.h) + (p.z - spot.z) * Math.cos(spot.h);
        const crossed = Math.sign(lat(ends[0].tip) - lat(ends[1].tip)) !== Math.sign(lat(ends[0].tail) - lat(ends[1].tail));
        const tailGap = Math.hypot(ends[0].tail.x - ends[1].tail.x, ends[0].tail.z - ends[1].tail.z);
        const mid = (e) => ({ x: (e.tip.x + e.tail.x) / 2, z: (e.tip.z + e.tail.z) / 2 });
        const m0 = mid(ends[0]), m1 = mid(ends[1]);
        return {
          tipGap, tailGap, apart: Math.abs(wrap(dir(ends[0]) - dir(ends[1]))) * 180 / Math.PI,
          offHeading: Math.max(...ends.map((e) => Math.abs(wrap(dir(e) - st.heading)))) * 180 / Math.PI,
          toMotion: ends.map((e) => Math.abs(wrap(dir(e) - motion)) * 180 / Math.PI),
          midGap: Math.hypot(m0.x - m1.x, m0.z - m1.z), clear: S.skierClear, crossed, boot: S.skier.bootGap(),
        };
      }, { P, spot });
      const across = r.toMotion.map((a) => Math.min(a, 180 - a));
      const checks = name.startsWith('plough')
        ? [[r.tipGap < 0.45 && r.tipGap > 0.04 && !r.crossed, `tips close, not crossed (${r.tipGap.toFixed(2)} m${r.crossed ? ', CROSSED' : ''})`], [r.tailGap > r.tipGap + 0.35, `tails apart (${r.tailGap.toFixed(2)} m)`], [r.apart > 15 && r.apart < 70, `a clear V (${r.apart.toFixed(0)} deg between the skis)`], [r.offHeading < 35, `both point forward (max ${r.offHeading.toFixed(0)} deg off)`]]
        : name === 'hockey'
          ? [[r.apart < 12, `skis parallel (${r.apart.toFixed(0)} deg apart)`], [across.every((a) => a > 60), `across the travel (${across.map((a) => a.toFixed(0)).join(' / ')} deg)`], [r.midGap < 0.6, `close together (${r.midGap.toFixed(2)} m)`]]
          : [[r.apart < 10, `skis parallel (${r.apart.toFixed(0)} deg apart)`]];
      checks.push([r.clear >= -0.02, `on the snow (lowest ski point ${(r.clear * 100).toFixed(1)} cm)`]);
      checks.push([r.boot < 0.05, `boots on the bindings (${(r.boot * 100).toFixed(1)} cm off)`]);      // R8e
      for (const [ok, text] of checks) { if (!ok) fails++; console.log(`${ok ? '  ok  ' : '  FAIL'} ${engine} ${rid} ${name}: ${text}`); }
      if (shots) {
        for (const [view, a, d, hh] of [["behind", 180, 3.4, 1.2], ["side", 95, 3.2, 1.0], ["above", 180, 0.6, 4.2]]) {
          await page.evaluate(({ a, d, hh }) => window.__ski.orbit(a, d, hh, 42), { a, d, hh });
          await page.waitForTimeout(250);
          await page.screenshot({ path: path.join(out, `${engine}-${rid}-${name}-${view}.png`) });
        }
        await page.evaluate(() => window.__ski.orbit(null));
      }
    }
    // R8e (R8b sheets: at 0 km/h after a hockey stop one ski lay across beside him): a REAL hockey stop (the physics running, a player's
    // hard brake at 40 km/h), then the held end pose at 0 km/h for 2 s: both skis parallel, side by side, across the fall line, on
    // their uphill edges, on the snow; checked right at the stop and again after the hold
    const end = await page.evaluate(async (spot) => {
      const S = window.__ski;
      S.game.paused = false;
      const y = S.surface.height(spot.x, spot.z), v = 11;
      const n0 = S.surface.normal(spot.x, spot.z, {}), h0 = Math.hypot(n0.x, n0.z) > 0.03 ? Math.atan2(n0.z, n0.x) : spot.h;      // straight down the fall line
      S.place(spot.x, spot.z, h0);
      S.game.state = { ...S.state, x: spot.x, z: spot.z, y, heading: h0, grounded: true, air: 0, crash: 0, ride: '', hold: 0, stop: 0, brake: 0, edge: 0, speed: v, vx: Math.cos(h0) * v, vz: Math.sin(h0) * v, vy: 0 };
      S.game.hold = false;
      S.setInput({ steer: 0.2, tuck: 0, brake: 1, push: 0, jump: false, hard: true });
      const wait = (ms) => new Promise((res) => { const t0 = performance.now(); let n = 0; const f = () => { n++; if (n >= Math.ceil(ms / 16) && performance.now() - t0 >= ms) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
      const t0 = performance.now();
      while (S.state.speed > 0.05 && performance.now() - t0 < 8000) await wait(50);
      const stopMs = performance.now() - t0;
      const fall = S.surface.normal(S.state.x, S.state.z, {});
      const fallDir = Math.atan2(fall.z, fall.x);                 // downhill in the plan
      const measure = () => {
        const ends = S.skier.skiEnds(), st = S.state;
        const dir = (e) => Math.atan2(e.tip.z - e.tail.z, e.tip.x - e.tail.x);
        const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
        const mid = (e) => ({ x: (e.tip.x + e.tail.x) / 2, y: (e.tip.y + e.tail.y) / 2, z: (e.tip.z + e.tail.z) / 2 });
        const m0 = mid(ends[0]), m1 = mid(ends[1]);
        const toFall = ends.map((e) => { const a = Math.abs(wrap(dir(e) - fallDir)) * 180 / Math.PI; return Math.min(a, 180 - a); });
        // side by side: the line between the ski middles runs across the skis (along the fall line), not along them (one behind the other)
        const between = Math.atan2(m1.z - m0.z, m1.x - m0.x), alongSki = Math.abs(wrap(between - dir(ends[0]))) * 180 / Math.PI;
        return { speed: st.speed * 3.6, hold: st.hold, stop: st.stop, apart: Math.abs(wrap(dir(ends[0]) - dir(ends[1]))) * 180 / Math.PI, toFall, midGap: Math.hypot(m0.x - m1.x, m0.z - m1.z),
          sideBySide: Math.min(alongSki, 180 - alongSki), clear: S.skierClear, edge: st.edge, boot: S.skier.bootGap(), rot: S.skier.debugSkis ? S.skier.debugSkis() : null };
      };
      const atStop = measure();
      await wait(2000);
      const held = measure();
      S.setInput(null);
      return { stopMs, atStop, held };
    }, spot);
    for (const [when, r] of [["at the stop", end.atStop], ["held 2 s", end.held]]) {
      const checks = [[r.speed < 0.5, `0 km/h (${r.speed.toFixed(1)} km/h, stopped after ${(end.stopMs / 1000).toFixed(1)} s)`], [r.apart < 12, `skis parallel (${r.apart.toFixed(0)} deg apart)`],
        [r.toFall.every((a) => a > 60), `across the fall line (${r.toFall.map((a) => a.toFixed(0)).join(' / ')} deg)`], [r.midGap < 0.6 && r.sideBySide > 45, `side by side (${r.midGap.toFixed(2)} m apart, ${r.sideBySide.toFixed(0)} deg off the ski line)`],
        [Math.abs(r.edge) > 0.3, `on the edges (edge ${r.edge.toFixed(2)})`], [r.clear >= -0.02, `on the snow (lowest ski point ${(r.clear * 100).toFixed(1)} cm)`], [r.boot < 0.05, `boots on the bindings (${(r.boot * 100).toFixed(1)} cm off)`]];
      for (const [ok, text] of checks) { if (!ok) fails++; console.log(`${ok ? '  ok  ' : '  FAIL'} ${engine} ${rid} hockey-end ${when}: ${text}`); }
      if (process.env.POSE_DEBUG) console.log(JSON.stringify(r));
    }
    if (shots) {
      for (const [view, a, d, hh] of [["behind", 180, 3.4, 1.2], ["side", 95, 3.2, 1.0], ["above", 180, 0.6, 4.2]]) {
        await page.evaluate(({ a, d, hh }) => window.__ski.orbit(a, d, hh, 42), { a, d, hh });
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(out, `${engine}-${rid}-hockey-end-${view}.png`) });
      }
      await page.evaluate(() => window.__ski.orbit(null));
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(fails ? `${fails} FAILED` : "all poses green");
process.exit(fails ? 1 : 0);
