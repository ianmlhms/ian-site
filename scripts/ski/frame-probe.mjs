#!/usr/bin/env node
/* R8: where a long frame goes (the `ski` flow's Niddreg gate, p95 <= 25 ms, failed in headless WebKit). Opens the ski flow's scene
 * (Killy, piste "diebold", level low, tuck, no bot), wraps the per-frame upkeep calls with timers and prints, over N seconds: the frame
 * interval p50 / p95 / max and, for the frames over 22 ms, the mean ms of each wrapped call (and for all frames, to compare).
 *   node scripts/ski/frame-probe.mjs [--engine webkit|chromium] [--secs 8] [--dpr 2] [--size 1280x720]
 * R8b: --travel N: instead, fast-travel (goFree) to N lifts spread over the resort ([--resort killy]) and record the frames of the 4 s
 * after each fade lifts, with every method of the upkeep objects wrapped (terrain, scatterView, lifts, signs, markers, avalanches, spray,
 * explore, streamer, env, post, modes): per lift the worst frames and what they were spent on.
 * Run it through ~/Library/Caches/browser-slot.py. */
import { startServer, launchBrowser } from "../flows/lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const engine = opt("--engine", "webkit");
const secs = Number(opt("--secs", "8"));
const dpr = Number(opt("--dpr", "2"));
const [w, h] = opt("--size", "1280x720").split("x").map(Number);
const travel = Number(opt("--travel", "0"));
const resortId = opt("--resort", "killy");
process.env.FLOW_BROWSER = engine;
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  if (travel > 0) {
    await page.goto(`${origin}/pb/ski.html?go=1&debug=1&q=low&weather=sun&time=midday&resort=${resortId}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction("(document.documentElement.dataset.skiScreen === 'ski' && window.__ski && window.__ski.game.phase === 'running') || !!document.documentElement.dataset.bootError", null, { timeout: 240000 });
    await page.waitForTimeout(3000);
    const out = await page.evaluate(async (n) => {
      const S = window.__ski;
      S.explore.discoverAll();
      const acc = new Map();
      const wrapAll = (name, obj) => {
        if (!obj) return;
        for (const key of Object.keys(obj)) {
          const d = Object.getOwnPropertyDescriptor(obj, key);
          if (!d || typeof d.value !== 'function' || !d.writable) continue;
          const f = d.value.bind(obj);
          obj[key] = (...a) => { const t0 = performance.now(); try { return f(...a); } finally { const k = `${name}.${key}`; acc.set(k, (acc.get(k) || 0) + performance.now() - t0); } };
        }
      };
      const wrapped = new Set();
      const wrapNow = () => {
        for (const [name, obj] of [['terrain', S.terrain], ['scatterView', S.scatterView], ['lifts', S.lifts], ['signs', S.signs], ['markers', S.markers], ['avalanches', S.avalanches], ['spray', S.spray], ['explore', S.explore], ['streamer', S.streamer], ['env', S.env], ['post', S.post], ['modes', S.modes], ['surface', S.surface], ['look', S.look], ['skier', S.skier]]) {
          if (obj && !wrapped.has(obj)) { wrapped.add(obj); wrapAll(name, obj); }
        }
      };
      wrapNow();
      const list = S.modes.lifts.list.filter((l) => !l.tunnel);
      const picks = [];
      for (let i = 0; i < n; i++) picks.push(list[Math.floor((i + 0.5) * list.length / n)]);
      const rows = [];
      for (const l of picks) {
        // frames from the call on; the fade's end is noted: the frames from 100 ms before it are what the player sees
        const frames = [];
        let last = performance.now(), fadeOff = null, stop = false;
        acc.clear();
        const t0 = performance.now();
        const tick = (now) => {
          frames.push({ t: now, dt: now - last, parts: Object.fromEntries(acc) }); acc.clear(); last = now;
          const fade = document.getElementById('skiFade');
          if (fadeOff === null && now - t0 > 300 && (!fade || !fade.classList.contains('on'))) fadeOff = now;
          if (fadeOff !== null && now - fadeOff > 4000) stop = true;
          if (now - t0 > 20000) stop = true;
          if (!stop) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        S.goFree(l.id);
        while (!stop) await new Promise((r) => setTimeout(r, 100));
        wrapNow();
        const seen = frames.filter((f) => fadeOff !== null && f.t >= fadeOff - 100);
        const dts = seen.map((f) => f.dt).sort((a, b) => a - b);
        const top = [...seen].sort((a, b) => b.dt - a.dt).slice(0, 3).map((f) => ({ at: Math.round(f.t - fadeOff), dt: +f.dt.toFixed(0), parts: Object.fromEntries(Object.entries(f.parts).filter(([, v]) => v > 3).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [k, +v.toFixed(1)])) }));
        rows.push({ lift: l.name, fadeMs: Math.round((fadeOff || performance.now()) - t0), n: seen.length, p50: +(dts[Math.floor(dts.length / 2)] || 0).toFixed(1), p95: +(dts[Math.floor(dts.length * 0.95)] || 0).toFixed(1), max: +(dts[dts.length - 1] || 0).toFixed(0), over50: dts.filter((d) => d > 50).length, top });
      }
      return rows;
    }, travel);
    for (const r of out) console.log(JSON.stringify(r));
  } else {
  await page.goto(`${origin}/pb/ski.html?auto=1&debug=1&q=low&weather=sun&time=midday&resort=killy&piste=diebold`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 240000 });
  await page.waitForFunction(() => window.__ski.game.phase === "running", null, { timeout: 60000 });
  const r = await page.evaluate(async (secs) => {
    const S = window.__ski;
    S.game.bot = null; S.setInput({ steer: 0, tuck: 1, brake: 0, push: 0, jump: false });
    const acc = new Map();
    const wrap = (name, obj, key) => {
      if (!obj || typeof obj[key] !== 'function') return;
      const f = obj[key].bind(obj);
      obj[key] = (...a) => { const t0 = performance.now(); try { return f(...a); } finally { acc.set(name, (acc.get(name) || 0) + performance.now() - t0); } };
    };
    wrap('terrain', S.terrain, 'update'); wrap('scatter', S.scatterView, 'update'); wrap('render', S.post, 'render');
    wrap('lifts', S.lifts, 'update'); wrap('env', S.env, 'update'); wrap('streamer.focus', S.streamer, 'focus');
    if (S.modes) wrap('modes', S.modes, 'update');
    const frames = [];
    let last = performance.now();
    await new Promise((res) => {
      const t0 = performance.now();
      const tick = (now) => {
        frames.push({ dt: now - last, parts: Object.fromEntries(acc) });
        acc.clear(); last = now;
        if (now - t0 < secs * 1000) requestAnimationFrame(tick); else res();
      };
      requestAnimationFrame(tick);
    });
    const dts = frames.map((f) => f.dt).sort((a, b) => a - b);
    const mean = (list) => { const m = {}; for (const f of list) for (const [k, v] of Object.entries(f.parts)) m[k] = (m[k] || 0) + v / list.length; return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +v.toFixed(2)])); };
    const slow = frames.filter((f) => f.dt > 22);
    return { n: frames.length, p50: dts[Math.floor(dts.length * 0.5)], p95: dts[Math.floor(dts.length * 0.95)], max: dts[dts.length - 1], slow: slow.length, slowMean: mean(slow), allMean: mean(frames), info: S.info(), res: S.resolution ? S.resolution() : null, top: frames.sort((a, b) => b.dt - a.dt).slice(0, 6).map((f) => ({ dt: +f.dt.toFixed(1), ...Object.fromEntries(Object.entries(f.parts).map(([k, v]) => [k, +v.toFixed(1)])) })) };
  }, secs);
  console.log(JSON.stringify(r, null, 1));
  }
} finally {
  await browser.close();
  server.close();
}
