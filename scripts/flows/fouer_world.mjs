/* Flow — Schueberfouer Tycoon W2 "Ground": the empty Glacis (pb/fouer.html, ?fouerDebug=1).
 * Boots with zero console errors, loads the baked bundle (<= 700 KB), stays inside the iPad-medium budget at three camera presets,
 * the weather / time menu AND the in-game button change the scene and persist, the passing tram appears and dwells at Theater at <= 20 km/h,
 * the render loop pauses when the page is hidden and survives a WebGL context loss. */
import { runIfMain } from "./lib.mjs";

const URL = "/pb/fouer.html?stage=1&fouerDebug=1&fouerNoFly=1&fouerQ=medium&fouerTimeMode=noon";   // stage=1: W2's empty Glacis (the default page is the game since W5)
const MAX_DRAWS = 60;
const MAX_TRIS = 165000;
const BUNDLE_MAX = 700 * 1024;

async function boot(h, url = URL) {
  await h.goto(url);
  await h.page.waitForFunction(() => document.documentElement.dataset.fouerReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 90000 });
  await h.pause(1200);
}

export const flow = {
  name: "fouer-world",
  fullChromium: true,
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    h.step("boot /pb/fouer.html: world loads, no console errors, no boot error");
    await boot(h);
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "no boot error");
    h.eq(errors, [], "zero console errors while booting");
    const info = await page.evaluate(() => { const w = window.__fouer.world; return { bytes: w.bundle.bytes, tiles: Object.keys(w.header.tiles).length, far: Object.keys(w.header.far).length, landmarks: w.header.landmarks.map((l) => l.key), pitches: window.__fouer.pitches.count, stops: w.parts.tram.stops.map((s) => s.name) }; });
    h.expect(info.bytes > 100000 && info.bytes <= BUNDLE_MAX, `bundle loaded, ${(info.bytes / 1024).toFixed(0)} KB (<= 700 KB)`);
    h.expect(info.tiles >= 20 && info.far >= 30, `${info.tiles} detailed tiles + ${info.far} far tiles`);
    h.eq(info.landmarks.sort(), ["institut", "rouge", "theatre"], "landmarks Grand Theatre, Institut, Red Bridge baked in");
    h.eq(info.pitches, 34, "34 pitch outlines");
    h.eq(info.stops.sort(), ["Faïencerie", "Theater"], "both tram stops built");
    await h.shot("boot");

    h.step("draw calls and triangles at 3 camera presets (iPad medium budget)");
    for (const name of ["frame", "close", "top"]) {
      await page.evaluate((n) => { const F = window.__fouer; F.r.setPose(n === "frame" ? F.r.framePose() : F.r.poses[n], true); }, name);
      await h.pause(700);
      const s = await page.evaluate(() => window.__fouer.performanceSnapshot());
      h.expect(s.drawCalls > 10 && s.drawCalls <= MAX_DRAWS, `${name}: ${s.drawCalls} draw calls (<= ${MAX_DRAWS})`);
      h.expect(s.triangles > 20000 && s.triangles <= MAX_TRIS, `${name}: ${s.triangles} triangles (<= ${MAX_TRIS})`);
      await h.shot("preset-" + name);
    }

    h.step("weather + time: the in-game button popover changes the scene and persists");
    await page.evaluate(() => { localStorage.removeItem("pb_fouer_weather"); localStorage.removeItem("pb_fouer_time"); });
    await boot(h, "/pb/fouer.html?stage=1&fouerDebug=1&fouerNoFly=1&fouerQ=medium");
    const st0 = await page.evaluate(() => window.__fouer.env.getState());
    h.eq([st0.weatherMode, st0.timeMode], ["random", "random"], "Random is the default for weather and time");
    await page.click("#envBtn");
    h.expect(await page.isVisible("#envPop"), "the sun button opens the popover");
    // the random start weather may already be rain / fog: measure the "before" from a clear sky (polish 2: this check was flaky when the random start was rain)
    await page.click('#envPop [data-group="weather"][data-value="clear"]');
    await page.evaluate(() => { for (let i = 0; i < 200; i++) window.__fouer.env.update(0.1, window.__fouer.r.camera); });
    const before = await page.evaluate(() => { const E = window.__fouer.env; return { fog: E.fog.density, sun: E.sunLight.intensity, rain: E.getState().rain }; });
    await page.click('#envPop [data-group="weather"][data-value="rain"]');
    await page.click('#envPop [data-group="time"][data-value="night"]');
    await page.evaluate(() => { for (let i = 0; i < 200; i++) window.__fouer.env.update(0.1, window.__fouer.r.camera); });
    const after = await page.evaluate(() => { const E = window.__fouer.env; const s = E.getState(); return { fog: E.fog.density, sun: E.sunLight.intensity, s, nightK: window.__fouer.world.nightK, rainVisible: window.__fouer.r.scene.getObjectByName("fouer-rain").visible }; });
    h.eq([after.s.weatherMode, after.s.weather, after.s.timeMode], ["rain", "rain", "night"], "popover chips set rain + night");
    h.expect(after.s.hour > 22 && after.s.hour < 23 && after.nightK > 0.9, `night: hour ${after.s.hour.toFixed(1)}, night factor ${after.nightK.toFixed(2)} (lit windows)`);
    h.expect(after.fog > before.fog && after.rainVisible && after.s.rain > 0.9, "rain: denser fog + rain overlay on");
    h.eq(await page.evaluate(() => [localStorage.getItem("pb_fouer_weather"), localStorage.getItem("pb_fouer_time")]), ["rain", "night"], "choices stored in localStorage");
    await h.shot("rain-night");
    await boot(h, "/pb/fouer.html?stage=1&fouerDebug=1&fouerNoFly=1&fouerQ=medium");
    const st1 = await page.evaluate(() => window.__fouer.env.getState());
    h.eq([st1.weatherMode, st1.timeMode, st1.weather], ["rain", "night", "rain"], "choices persist across a reload");
    h.expect(st1.night > 0.9, "reloaded scene is at night");

    h.step("the menu panel has the same controls");
    await page.click("#menuBtn");
    h.expect(await page.isVisible("#menu"), "the menu opens");
    await page.click('#menu [data-group="weatherM"][data-value="clear"]');
    await page.click('#menu [data-group="timeM"][data-value="evening"]');
    const st2 = await page.evaluate(() => window.__fouer.env.getState());
    h.eq([st2.weatherMode, st2.timeMode], ["clear", "evening"], "menu chips set clear + evening");
    h.expect(st2.night < 0.6 && st2.hour === 19.5, "evening is golden hour, lights half on");
    await page.click('#menu [data-group="weatherM"][data-value="random"]');
    await page.click('#menu [data-group="timeM"][data-value="random"]');
    h.eq(await page.evaluate(() => [localStorage.getItem("pb_fouer_weather"), localStorage.getItem("pb_fouer_time")]), ["random", "random"], "back to Random, stored");

    h.step("passing tram: appears, dwells 20 s at Theater with doors open, never above 20 km/h");
    const tram = await page.evaluate(() => {
      const t = window.__fouer.tram.debug; const d0 = t.state(); let vmax = 0;
      t.callTram(1);
      let st = t.state(); let n = 0;
      while (!(st.mode === "dwell" && st.stop === "Theater") && n++ < 6000) { t.fastForward(0.5, 0.1); st = t.state(); vmax = Math.max(vmax, st.speedKmh); }
      const arrived = st; t.fastForward(6, 0.1); const open = t.state();
      t.fastForward(12, 0.1); const late = t.state();
      t.fastForward(40, 0.1); const gone = t.state();
      return { d0, vmax, arrived, open, late, gone };
    });
    h.expect(tram.vmax > 15 && tram.vmax <= 20, `cruise speed ${tram.vmax.toFixed(1)} km/h (<= 20)`);
    h.eq([tram.arrived.mode, tram.arrived.stop, Math.round(tram.arrived.dwell)], ["dwell", "Theater", 20], "stops at Theater, 20 s dwell");
    h.expect(tram.open.doors[0] > 0.9 || tram.open.doors[1] > 0.9, "doors open during the dwell");
    h.expect(tram.late.mode === "dwell" || tram.late.mode === "run", "tram carries on after the dwell");
    h.expect(tram.arrived.visible, "tram visible at the stop");
    await page.evaluate(() => { const F = window.__fouer; F.tram.debug.callTram(-1); });

    h.step("render loop stops when the page is hidden and resumes");
    const f0 = await page.evaluate(() => window.__fouer.performanceSnapshot().frames);
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
    await h.pause(300);
    const h1 = await page.evaluate(() => window.__fouer.performanceSnapshot());
    await h.pause(700);
    const h2 = await page.evaluate(() => window.__fouer.performanceSnapshot());
    h.expect(!h1.running && h2.frames === h1.frames, `hidden: loop stopped, frames frozen at ${h2.frames}`);
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
    await h.pause(700);
    const h3 = await page.evaluate(() => window.__fouer.performanceSnapshot());
    h.expect(h3.running && h3.frames > h2.frames + 5 && h2.frames >= f0, "visible again: loop resumed");

    h.step("WebGL context loss: loop stops, then recovers");
    await page.evaluate(() => { const gl = window.__fouer.renderer.getContext(); const ext = gl.getExtension("WEBGL_lose_context"); window.__loseExt = ext; ext.loseContext(); });
    await h.pause(500);
    h.expect(await page.evaluate(() => window.__fouer.performanceSnapshot().contextLost), "context loss noticed");
    await page.evaluate(() => window.__loseExt.restoreContext());
    await h.pause(1500);
    const rec = await page.evaluate(() => window.__fouer.performanceSnapshot());
    const rec2 = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 600)); return window.__fouer.performanceSnapshot(); });
    h.expect(!rec.contextLost && rec2.frames > rec.frames, "context restored, frames advancing again");

    h.step("input: drag pans, wheel zooms, F frames the field");
    const c0 = await page.evaluate(() => window.__fouer.performanceSnapshot().camera);
    const box = await page.locator("#fouerCanvas").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 140, box.y + box.height / 2 + 60, { steps: 8 }); await page.mouse.up();
    await page.mouse.wheel(0, -400);
    await h.pause(900);
    const c1 = await page.evaluate(() => window.__fouer.performanceSnapshot().camera);
    h.expect(Math.abs(c1.tu - c0.tu) + Math.abs(c1.tw - c0.tw) > 5, "dragging moved the camera target");
    h.expect(c1.dist < c0.dist, "wheel zoomed in");
    await page.keyboard.press("f"); await h.pause(1800);
    const c2 = await page.evaluate(() => window.__fouer.performanceSnapshot().camera);
    h.expect(c2.dist > c1.dist, "F framed the whole field again");
    h.eq(errors.filter((e) => !/lost|restor/i.test(e)), [], "still zero console errors at the end");
  },
};

runIfMain(import.meta.url, flow);
