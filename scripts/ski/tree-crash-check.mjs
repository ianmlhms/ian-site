#!/usr/bin/env node
/* Round 8e (3V QA "Aua, e Bam!": after a tree crash the camera sat in the tree; Kronplatz: the camera against trunks): N real tree crashes
 * per resort (the physics running, the chase camera): a forest tree near a piste, the skier 12 m in front of it, straight at its trunk
 * at 45 km/h. Every frame from the run-up to 2 s after the respawn: the camera never inside a tree's crown (scatter.js inCrown, the
 * drawn spruce shape); after the respawn the skier is free: no trunk within reach and >= 1 m skied in 2 s with a push, no new crash.
 *   node scripts/ski/tree-crash-check.mjs [--resorts ...] [--n 10] [--engine webkit|chromium]   (exit 1 on a failure) */
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const resorts = opt("--resorts", "killy,3vallees,zermatt,arlberg,kronplatz,vialattea,obertauern,livigno").split(",");
const N = Number(opt("--n", "10"));
process.env.FLOW_BROWSER = opt("--engine", "chromium");
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
let fails = 0, total = 0, crashes = 0, inside = 0, frames = 0, notFree = 0;
try {
  for (const rid of resorts) {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 640 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { fails++; console.log(`  FAIL [${rid}] pageerror ${String(e).slice(0, 200)}`); });
    await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=medium&res=fixed&weather=sun&time=midday&resort=${rid}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 240000 });
    const trees = await page.evaluate((n) => {
      const S = window.__ski, sc = S.scatter, d = S.quality.treeDensity, out = [];
      const L = S.pistes.list;
      for (let i = 0; out.length < n && i < 4000; i++) {
        const p = L[(i * 7919) % L.length], a = p.at(((i * 104729) % 1000) / 1000 * p.length, {});
        for (const side of [-1, 1]) {
          const ex = a.x - a.dz * side * (p.halfWidth + 12), ez = a.z + a.dx * side * (p.halfWidth + 12);
          const t = sc.treeBlock(Math.floor(ex / 80), Math.floor(ez / 80));
          for (let k = 0; k < t.length; k += 6) {
            if (t[k + 5] > d || Math.hypot(t[k] - ex, t[k + 2] - ez) > 10) continue;
            out.push({ x: t[k], z: t[k + 2], sx: a.x - a.dz * side * (p.halfWidth - 2), sz: a.z + a.dx * side * (p.halfWidth - 2) });
            break;
          }
          if (out.length >= n) break;
        }
      }
      return out;
    }, N * 3);
    let rc = 0, ri = 0, rf = 0, rn = 0;
    for (const t of trees) {
      if (rc >= N) break;
      total++;
      const r = await page.evaluate(async (t) => {
        const S = window.__ski, sc = S.scatter, d = S.quality.treeDensity;
        const h = Math.atan2(t.z - t.sz, t.x - t.sx), x0 = t.x - Math.cos(h) * 9, z0 = t.z - Math.sin(h) * 9;
        await S.streamer.ready(x0, z0, 200);
        S.place(x0, z0, h);
        const v = 15;
        S.game.state = { ...S.state, hold: 0, vx: Math.cos(h) * v, vz: Math.sin(h) * v, speed: v };
        S.game.hold = false;
        S.setInput({ steer: 0, tuck: 0, brake: 0, push: 0, jump: false });
        let crashed = false, crashKind = "", inCrown = 0, n = 0, respawnAt = null, t0 = performance.now();
        while (performance.now() - t0 < 10000) {
          await new Promise((res) => requestAnimationFrame(res));
          const c = S.camera.position, st = S.state;
          n++;
          if (sc.inCrown(c.x, c.y, c.z, d, 0)) inCrown++;
          if (st.crash > 0 && !crashed) { crashed = true; crashKind = st.crashKind; }
          if (crashed && st.crash === 0 && !respawnAt) { respawnAt = { x: st.x, z: st.z, t: performance.now() }; S.setInput({ steer: 0, tuck: 0, brake: 0, push: 1, jump: false }); }
          if (respawnAt && performance.now() - respawnAt.t > 2000) break;
          if (!crashed && performance.now() - t0 > 3000) break;
        }
        const st = S.state;
        const moved = respawnAt ? Math.hypot(st.x - respawnAt.x, st.z - respawnAt.z) : 0, trunk = respawnAt ? !!sc.hit(respawnAt.x, respawnAt.z, 0.6, -1e9, d) : false;
        const free = !!respawnAt && !trunk && moved > 1 && st.crash === 0;
        S.setInput(null);
        return { crashed, crashKind, inCrown, n, free, why: free ? "" : `moved ${moved.toFixed(1)} m, trunk ${trunk}, crash ${st.crash.toFixed(1)} ${st.crashKind}, respawned ${!!respawnAt}` };
      }, t);
      if (r.crashed && r.crashKind === "tree") { crashes++; rc++; }
      frames += r.n; inside += r.inCrown; ri += r.inCrown;
      if (r.crashed && !r.free && r.why.includes("respawned true")) { notFree++; rf++; console.log(`    not free: ${r.why}`); }
      rn++;
    }
    console.log(`  ${rid}: ${rn} runs at trees, ${rc} tree crashes, camera in a crown in ${ri} frames, ${rf} not free 2 s after the respawn`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
const ok = crashes >= N * resorts.length && inside === 0 && notFree === 0;
console.log(`${ok ? "  ok  " : "  FAIL"} ${crashes}/${total} tree crashes: the camera inside a crown in ${inside} of ${frames} frames, ${notFree} skiers not free 2 s after the respawn`);
process.exit(ok && !fails ? 0 : 1);
