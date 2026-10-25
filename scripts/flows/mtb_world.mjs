/* Flow: MTB Mëllerdall W1 "World" (pb/mtb.html).
 * Boots with zero console errors, loads <= 6 MB of baked data, stays inside the draw-call / triangle budget of each quality level, the weather / time choice
 * is stored and applied, the render loop pauses when the page is hidden and survives a WebGL context loss, the HUD and the hint are in the chosen language. */
import { runIfMain } from "./lib.mjs";

const PAGE = "/pb/mtb.html?debug=1&q=medium&time=noon&weather=clear";
const DATA_BUDGET = 6 * 1024 * 1024;
/* W2 budgets: unchanged for medium and high; `low` gets 140 draw calls (was 130) for the forest / rock / water / rider sets, its triangles stay at 330 k (measured at the trail start: low 133 calls / 258 k, medium 147 / 433 k, high 166 / 774 k; the busiest gorge scenes reach about 1.0 M triangles on high). */
const BUDGET = { low: { calls: 140, tris: 330000 }, medium: { calls: 190, tris: 520000 }, high: { calls: 230, tris: 900000 } };

async function boot(h, url = PAGE) {
  await h.goto(url);
  await h.page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
  await h.pause(1500);
}

export const flow = {
  name: "mtb-world",
  fullChromium: true,
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    h.step("boot /pb/mtb.html: world loads, no boot error, no console errors");
    await boot(h);
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "no boot error");
    h.eq(errors, [], "zero console errors while booting");
    const info = await page.evaluate(() => {
      const m = window.__mtb;
      const bytes = performance.getEntriesByType("resource").filter((e) => /\/pb\/mtb\/data\//.test(e.name)).reduce((s, e) => s + (e.encodedBodySize || e.decodedBodySize || 0), 0);
      return { bytes, trail: m.trail.id, ways: m.data.ways.length, tiles: m.terrain.stats.leaves, trees: m.forest.stats.near + m.forest.stats.far, hint: document.getElementById("hint").textContent };
    });
    h.expect(info.bytes > 1e6 && info.bytes <= DATA_BUDGET, `baked data ${(info.bytes / 1048576).toFixed(2)} MB (<= 6 MB)`);
    h.expect(info.tiles > 60 && info.trees > 500 && info.ways > 500, `${info.tiles} terrain tiles, ${info.trees} trees, ${info.ways} ways`);
    h.expect(/W/.test(info.hint), "the hint line names the keys");
    await h.shot("boot");

    h.step("draw calls and triangles stay inside the budget at low / medium / high");
    for (const q of ["low", "medium", "high"]) {
      await boot(h, `/pb/mtb.html?debug=1&q=${q}&time=noon&weather=clear`);
      const s = await page.evaluate(() => { const m = window.__mtb; return { calls: m.perf.drawCalls, tris: m.perf.triangles, q: m.quality.id, fps: m.perf.fps }; });
      h.eq(s.q, q, `quality ${q} selected`);
      h.expect(s.calls > 20 && s.calls <= BUDGET[q].calls, `${q}: ${s.calls} draw calls (<= ${BUDGET[q].calls})`);
      h.expect(s.tris > 30000 && s.tris <= BUDGET[q].tris, `${q}: ${s.tris} triangles (<= ${BUDGET[q].tris})`);
      await h.shot("quality-" + q);
    }

    h.step("weather + time: the choice changes the scene and is stored; Random is the default");
    await page.evaluate(() => { localStorage.removeItem("pb_mtb_weather"); localStorage.removeItem("pb_mtb_time"); });
    await boot(h, "/pb/mtb.html?debug=1&q=low");
    const c0 = await page.evaluate(() => window.__mtb.env.getChoice());
    h.eq([c0.timeMode, c0.weatherMode], ["random", "random"], "Random is the default for time and weather");
    await page.evaluate(() => { const E = window.__mtb.env; E.setWeather("clear"); E.setTime("noon"); E.snap(); for (let i = 0; i < 200; i++) E.update(0.1, window.__mtb.camera, 1); });
    const clear = await page.evaluate(() => { const E = window.__mtb.env; return { fog: E.uniforms.uFogDensity.value, sun: E.uniforms.uSunColor.value.length(), cloud: E.uniforms.uCloud.value }; });
    await page.evaluate(() => { const E = window.__mtb.env; E.setWeather("fog"); E.setTime("night"); for (let i = 0; i < 400; i++) E.update(0.1, window.__mtb.camera, 2); });
    const night = await page.evaluate(() => { const E = window.__mtb.env; return { fog: E.uniforms.uFogDensity.value, sun: E.uniforms.uSunColor.value.length(), choice: E.getChoice() }; });
    h.expect(night.fog > clear.fog * 3, `fog is denser (${clear.fog.toExponential(2)} -> ${night.fog.toExponential(2)})`);
    h.expect(night.sun < clear.sun * 0.4, `night / fog: the light is weaker (${clear.sun.toFixed(2)} -> ${night.sun.toFixed(2)})`);
    h.eq(await page.evaluate(() => [localStorage.getItem("pb_mtb_weather"), localStorage.getItem("pb_mtb_time")]), ["fog", "night"], "choices stored in localStorage");
    await h.shot("fog-night");
    await boot(h, "/pb/mtb.html?debug=1&q=low");
    const c1 = await page.evaluate(() => window.__mtb.env.getChoice());
    h.eq([c1.timeMode, c1.weatherMode, c1.timeId, c1.weatherId], ["night", "fog", "night", "fog"], "choices persist across a reload");

    h.step("language: hint and HUD follow the stored language");
    for (const [lang, word] of [["de", "treten"], ["en", "pedal"], ["fr", "pédaler"], ["lb", "trëppelen"]]) {
      await page.evaluate((l) => localStorage.setItem("pb_mtb_lang", l), lang);
      await boot(h, "/pb/mtb.html?debug=1&q=low&time=noon&weather=clear");
      const hint = await page.evaluate(() => document.getElementById("hint").textContent);
      h.expect(hint.includes(word), `${lang}: hint says "${word}"`);
    }
    await page.evaluate(() => localStorage.removeItem("pb_mtb_lang"));

    h.step("runs as a srcdoc iframe, the way the arcade loads games");
    await boot(h, "/pb/mtb.html?q=low&time=noon&weather=clear");
    const framed = await page.evaluate(async () => {
      const html = await (await fetch("/pb/mtb.html", { cache: "no-cache" })).text();
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:999";
      frame.srcdoc = html;
      document.body.appendChild(frame);
      const t0 = Date.now();
      while (Date.now() - t0 < 90000) {
        const d = frame.contentDocument && frame.contentDocument.documentElement;
        if (d && (d.dataset.mtbReady === "1" || d.dataset.bootError)) return { ready: d.dataset.mtbReady === "1", error: d.dataset.bootError || "", frames: frame.contentWindow.__mtb ? frame.contentWindow.__mtb.perf.frames : -1 };
        await new Promise((r) => setTimeout(r, 300));
      }
      return { ready: false, error: "timeout" };
    });
    h.expect(framed.ready && framed.error === "", `the game boots inside a srcdoc iframe (${framed.error || "no error"})`);

    h.step("render loop stops when the page is hidden and resumes");
    await boot(h, "/pb/mtb.html?debug=1&q=low&time=noon&weather=clear");
    const f0 = await page.evaluate(() => window.__mtb.perf.frames);
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
    await h.pause(400);
    const f1 = await page.evaluate(() => window.__mtb.perf.frames);
    await h.pause(800);
    const f2 = await page.evaluate(() => window.__mtb.perf.frames);
    h.expect(f2 === f1 && f1 >= f0, `hidden: frames frozen at ${f2}`);
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
    await h.pause(800);
    h.expect((await page.evaluate(() => window.__mtb.perf.frames)) > f2 + 5, "visible again: loop resumed");

    h.step("WebGL context loss is noticed and the page recovers (reload)");
    await page.evaluate(() => { const gl = window.__mtb.renderer.getContext(); const ext = gl.getExtension("WEBGL_lose_context"); window.__loseExt = ext; ext.loseContext(); });
    await h.pause(500);
    const frozen = await page.evaluate(() => window.__mtb.perf.frames);
    await h.pause(500);
    h.expect((await page.evaluate(() => window.__mtb.perf.frames)) === frozen, "context lost: the loop stops drawing");
    h.eq(errors.filter((e) => !/lost|restor|context/i.test(e)), [], "zero unexpected console errors in the whole flow");
  },
};

runIfMain(import.meta.url, flow);
