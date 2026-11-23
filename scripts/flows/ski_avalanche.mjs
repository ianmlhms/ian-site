/* Flow: Ski Alpen avalanches (round 7-C), on every resort's Lawin faces. A scripted trigger (avalanches.triggerAvalanche(id, seed, t),
 * the same call the online free ride uses) releases a slab above a skier who stands still in its path: it flows down the terrain, he is
 * caught (crash, white-out, "Vun der Lawin erwëscht!") and comes back on the nearest piste. The same trigger with the skier far to the
 * side: the slab stops in the runout, "Entkomm!". A natural release: crossing the steep face with a session seed whose roll says yes.
 * Determinism: the same (id, seed) twice gives the same block positions. The "Lawin" challenge prompt at a face's top -> Start -> the slab
 * releases behind the skier. The HUD warning on the steep off-piste. FLOW_BROWSER=webkit for Safari's engine. */
import { runIfMain } from "./lib.mjs";

const RESORTS = (process.env.SKI_RESORTS || "killy,3vallees,zermatt,arlberg,kronplatz,vialattea,obertauern").split(",");

export const flow = {
  name: "ski-avalanche",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      try { localStorage.removeItem("pb_ski_save"); localStorage.setItem("pb_ski_cam", "chase"); localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const running = () => page.waitForFunction(() => window.__ski && window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running" && document.documentElement.dataset.skiScreen === "ski", null, { timeout: 120000 });

    for (const [ri, rid] of RESORTS.entries()) {
      h.step(`${rid}: the Lawin faces, the warning flags`);
      await h.goto(`/pb/ski.html?resort=${rid}&go=1&debug=1&q=low&res=fixed`);
      await running();
      const info = await page.evaluate(() => { const a = window.__ski.avalanches; return { faces: a.faces.map((f) => ({ id: f.id, x: f.top.x, z: f.top.z, path: f.path, slope: f.slope, len: f.len })), flags: a.flags.length }; });
      h.expect(info.faces.length === 3 && info.flags >= 3, `${rid}: ${info.faces.length} Lawin faces (${info.faces.map((f) => `${Math.round(f.slope)}°`).join(", ")}), ${info.flags} warning flags`);
      const f = info.faces[0];
      // 4x faster clock for the test (set before the trigger: the flow itself stays the same steps)
      await page.evaluate(() => { const a = window.__ski.avalanches; const t0 = performance.now(); a.setClock(() => (t0 + (performance.now() - t0) * 4) / 1000); });

      h.step(`${rid}: scripted trigger with the skier standing in the path: caught, then back on a piste`);
      // a spot on the path steep enough for the warning (the path's 12th point is not in every resort: Obertauern's face flattens there)
      let mid = { x: f.path[Math.min(f.path.length - 2, 12)], z: f.path[Math.min(f.path.length - 1, 13)] }, warn = false;
      for (const k of [12, 8, 4, 16, 20]) {
        const i = Math.min(f.path.length - 2, k);
        mid = { x: f.path[i], z: f.path[i + 1] };
        await page.evaluate(({ x, z }) => window.__ski.streamer.ready(x, z, 500), mid);
        await page.evaluate(({ x, z }) => { window.__ski.place(x, z, 0); window.__ski.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); }, mid);
        await h.pause(600);
        warn = await page.evaluate(() => document.documentElement.dataset.skiAvWarn === "1" && !document.getElementById("avWarn").hidden);
        if (warn) break;
      }
      const id = await page.evaluate(async (f) => { const m = await import("/pb/ski/avalanche.js"); window.__skiAv = m; const a = window.__ski.avalanches; const id = m.cellId(f.x, f.z); a.triggerAvalanche(id, 4242, a.clock()); return id; }, f);
      await page.waitForFunction(() => document.documentElement.dataset.skiAvalanche === "caught", null, { timeout: 60000 });
      const c = await page.evaluate(() => ({ crash: window.__ski.state.crash, kind: window.__ski.state.crashKind, flash: document.getElementById("avFlash").classList.contains("on"), toast: document.getElementById("hToast").textContent }));
      h.expect(c.kind === "avalanche" && c.crash > 0, `${rid}: caught by the avalanche (${c.kind}, toast "${c.toast}")`);
      if (ri === 0) h.expect(warn, `${rid}: on the steep off-piste face the HUD warns "⚠ Lawinegefor"`);
      await page.evaluate(() => window.__ski.setCamera(null));
      await h.shot(`avalanche-${rid}-caught`);
      await page.evaluate(() => window.__ski.setInput(null));
      await page.waitForFunction(() => window.__ski.state.crash === 0, null, { timeout: 8000 });
      await h.pause(400);
      const after = await page.evaluate(() => { const s = window.__ski.state, n = window.__ski.pistes.nearest(s.x, s.z, 80); return { piste: n ? n.piste.id : null, above: s.y - window.__ski.surface.height(s.x, s.z) }; });
      h.expect(!!after.piste && Math.abs(after.above) < 0.4, `${rid}: back on the piste ${after.piste}`);

      h.step(`${rid}: deterministic; the skier far to the side escapes; the flow stops`);
      const same = await page.evaluate(({ id }) => {
        const m = window.__skiAv, far = (x, z) => window.__ski.field.farHeight(x, z);
        const run = () => { const s = m.createSlab(id, 99, far); for (let k = 0; k < 600; k++) m.stepSlab(s, k / 30, far); return s.blocks.map((b) => [b.x, b.z]); };
        const a = run(), b = run();
        return a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
      }, { id });
      h.expect(same, `${rid}: the same id + seed gives the same flow`);
      await page.evaluate(() => window.__ski.avalanches.clear());
      const side = await page.evaluate((f) => { const dx = f.path[2] - f.path[0], dz = f.path[3] - f.path[1], L = Math.hypot(dx, dz); return { x: f.x - dz / L * 260, z: f.z + dx / L * 260 }; }, f);
      await page.evaluate(({ x, z }) => { window.__ski.place(x, z, 0); window.__ski.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); }, side);
      await page.evaluate(({ id }) => { const a = window.__ski.avalanches; a.triggerAvalanche(id, 4242, a.clock()); }, { id });
      // R7-C2: the avalanche camera (avalanche.js faceView): clear of the snow and of the mountain; the rumble layer is driven
      const view = await page.evaluate(() => { const v = window.__ski.avalancheView(0); return v ? { clear: v.clear, above: v.above } : null; });
      await h.pause(2500);
      const cam = await page.evaluate(() => { const k = window.__ski, c = k.camera.position; return { above: c.y - k.surface.height(c.x, c.z), rumble: k.avalanches.loudness(c.x, c.z) }; });
      h.expect(view && view.clear && cam.above >= 0.6 && cam.rumble > 0.05, `${rid}: avalanche camera ${cam.above.toFixed(1)} m above the snow, a clear line to the flow, rumble ${cam.rumble.toFixed(2)}`);
      await h.shot(`avalanche-${rid}-flow`);
      await page.waitForFunction(() => document.documentElement.dataset.skiAvalanche === "stopped" || document.documentElement.dataset.skiAvalanche === "caught", null, { timeout: 40000 });
      const end = await page.evaluate(() => ({ state: document.documentElement.dataset.skiAvalanche, stats: window.__ski.avalanches.stats, moving: window.__ski.avalanches.blocks().filter((b) => b.moving).length }));
      h.expect(end.state === "stopped" && end.moving === 0 && end.stats.escaped >= 1, `${rid}: the slab stopped in the runout, the skier beside it: escaped (${JSON.stringify(end.stats)})`);
      await page.evaluate(() => { window.__ski.setCamera(null); window.__ski.avalanches.clear(); window.__ski.setInput(null); });
    }

    h.step("a natural release crossing the steep face (a session seed whose roll says yes), then the Lawin challenge");
    const nat = await page.evaluate(async () => {
      const m = window.__skiAv, a = window.__ski.avalanches, k = window.__ski;
      const f = a.faces[0], p = f.path, hh = (x, z) => k.surface.height(x, z);
      let x = p[2], z = p[3];
      for (let i = 2; i + 1 < p.length; i += 2) { if (m.releasable(k.field, p[i], p[i + 1], hh)) { x = p[i]; z = p[i + 1]; break; } }
      const id = m.cellId(x, z);
      let seed = 1;
      while (m.rng((seed ^ m.hashStr(id)) >>> 0)() >= 0.06) seed++;
      a.setSessionSeed(seed);
      return { x, z, id, ok: m.releasable(k.field, x, z, (x, z) => k.surface.height(x, z)) };
    });
    await page.evaluate(({ x, z }) => window.__ski.streamer.ready(x, z, 400), nat);
    await page.evaluate(({ x, z }) => { const k = window.__ski; k.place(x, z, 0); k.setInput({ steer: 0, tuck: 1, brake: 0, push: 1, jump: false }); }, nat);
    await page.waitForFunction(() => document.documentElement.dataset.skiAvalanche === "flowing" || document.documentElement.dataset.skiAvalanche === "caught", null, { timeout: 15000 }).catch(() => {});
    const natState = await page.evaluate(() => ({ state: document.documentElement.dataset.skiAvalanche, triggered: window.__ski.avalanches.stats.triggered }));
    h.expect(natState.triggered > 0, `skiing across ${nat.id} (releasable ${nat.ok}) released a slab (${natState.state})`);
    await page.evaluate(() => { window.__ski.avalanches.clear(); window.__ski.setInput(null); });
    await page.waitForFunction(() => window.__ski.state.crash === 0, null, { timeout: 8000 });
    const face = await page.evaluate(() => { const f = window.__ski.avalanches.faces[0]; window.__ski.place(f.top.x, f.top.z, 0); window.__ski.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); return f.id; });
    await page.waitForFunction(() => document.documentElement.dataset.skiLawinPrompt, null, { timeout: 6000 });
    h.expect(await page.isVisible(".avprompt"), `at the top of ${face}: the Lawin challenge asks`);
    await h.shot("lawin-prompt");
    await page.evaluate(() => window.__ski.setInput({ steer: 0, tuck: 1, brake: 0, push: 1, jump: false }));
    await page.click('.avprompt [data-a="go"]');
    await page.waitForFunction(() => document.documentElement.dataset.skiAvalanche === "flowing" || document.documentElement.dataset.skiAvalanche === "caught", null, { timeout: 8000 });
    h.expect(true, "Start: the slab released behind the skier");
    await h.pause(1500);
    await h.shot("lawin-run");
    await page.evaluate(() => window.__ski.setInput(null));
    h.eq(errors, [], "no page errors");
  },
};

runIfMain(import.meta.url, flow);
