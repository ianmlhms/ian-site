/* Flow: Ski Alpen replay (28 Nov 2026). The free ride records the last ~90 s of the skier in a fixed ring (no growth); the HUD button
 * "Lescht 30 s nach eemol kucken" plays the last 30 s back with five cameras (Hannendrun, TV, Niddreg, Vun uewen, Helm), play / pause,
 * scrub, 0.25x / 0.5x / 1x; the world is paused for the player while it plays (game.state does not move); Esc / Zou goes back to the run.
 * After a timed run the finish card has a "Replay" button (the whole recorded run) and is back when the replay closes.
 * Shots: FLOW_SHOTS_DIR (~/Library/Caches/ski-work/replay/). FLOW_BROWSER=webkit for Safari's engine. */
import { runIfMain } from "./lib.mjs";

export const flow = {
  name: "ski-replay",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      window.__skiAllowBotScore = true;
      try { if (!sessionStorage.getItem("rp-keep")) { localStorage.removeItem("pb_ski_save"); sessionStorage.setItem("rp-keep", "1"); } localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => { if (!/due to access control checks/.test(e.message)) errors.push(e.message); });
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const running = () => page.waitForFunction(() => window.__ski && window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running" && document.documentElement.dataset.skiScreen === "ski", null, { timeout: 120000 });

    h.step("free ride: ski a red piste for a while, the recorder fills (fixed memory)");
    await h.goto("/pb/ski.html?resort=killy&go=1&debug=1&q=medium&res=fixed&timescale=2");
    await running();
    const spot = await page.evaluate(() => {
      const k = window.__ski, L = k.pistes.list.filter((p) => (p.diff === "red" || p.diff === "blue") && p.length > 1200);
      for (const p of L) for (const f of [0.3, 0.2, 0.4]) {
        const a = p.at(p.length * f, {}), b = p.at(p.length * f + 150, {});
        if (Math.atan2(k.surface.height(a.x, a.z) - k.surface.height(b.x, b.z), 150) * 180 / Math.PI >= 11) { k.place(a.x, a.z, Math.atan2(a.dz, a.dx)); return { x: a.x, z: a.z }; }
      }
      const p = L[0], a = p.at(p.length * 0.3, {}); k.place(a.x, a.z, Math.atan2(a.dz, a.dx)); return { x: a.x, z: a.z };
    });
    await page.evaluate(({ x, z }) => window.__ski.streamer.ready(x, z, 400), spot);
    await page.evaluate(() => window.__ski.setInput({ steer: 0, tuck: 1, brake: 0, push: 1, jump: false }));
    await h.pause(2500);
    await page.evaluate(() => window.__ski.setInput({ steer: 0.7, tuck: 0, brake: 0, push: 0, jump: false }));
    await h.pause(2500);
    await page.evaluate(() => window.__ski.setInput({ steer: -0.7, tuck: 0, brake: 0, push: 0, jump: false }));
    await h.pause(3000);
    const rec1 = await page.evaluate(() => ({ n: window.__ski.recorder.count, s: window.__ski.recorder.seconds, bytes: window.__ski.recorder.bytes }));
    h.expect(rec1.n > 60 && rec1.s > 5, `the recorder holds ${rec1.n} frames (${rec1.s.toFixed(1)} s)`);
    h.expect(rec1.bytes > 0 && rec1.bytes < 400000, `fixed memory: ${(rec1.bytes / 1024).toFixed(0)} KB`);
    await page.evaluate(() => window.__ski.setInput({ steer: 0.3, tuck: 0, brake: 0, push: 1, jump: false }));
    await h.pause(1500);
    await h.shot("live");

    h.step("HUD button: the replay opens, the world is paused for the player");
    await page.click("#hReplay");
    await page.waitForFunction(() => document.documentElement.dataset.skiReplay === "1", null, { timeout: 5000 });
    const before = await page.evaluate(() => { const k = window.__ski, s = k.state; return { x: s.x, z: s.z, paused: k.game.paused, hud: getComputedStyle(document.getElementById("hud")).display, dur: k.replay.duration }; });
    h.expect(before.paused, "the game is paused during the replay");
    h.eq(before.hud, "none", "the HUD is hidden, only the replay bar shows");
    h.expect(before.dur > 4 && before.dur <= 31, `the clip is the last 30 s at most (${before.dur.toFixed(1)} s)`);
    await h.pause(1500);
    const mid = await page.evaluate(() => { const k = window.__ski, s = k.state; return { x: s.x, z: s.z, t: k.replay.time, rx: k.replay.state.x, rz: k.replay.state.z, playing: k.replay.playing }; });
    h.expect(Math.hypot(mid.x - before.x, mid.z - before.z) < 0.01, "the player's own skier did not move while the replay played");
    h.expect(mid.t > 0.5 && mid.playing, `the clip plays (t = ${mid.t.toFixed(2)} s)`);
    await h.shot("follow");

    h.step("every camera: frames, never under the snow, the skier in front of it");
    for (const id of ["tv", "low", "top", "fp", "follow"]) {
      await page.click(`.rpcams [data-v="${id}"]`);
      await h.pause(900);
      const c = await page.evaluate(() => {
        const k = window.__ski, c = k.camera, r = k.replay.state;
        const d = new window.THREE.Vector3(); c.getWorldDirection(d);
        const to = { x: r.x - c.position.x, y: r.y + 1 - c.position.y, z: r.z - c.position.z };
        const len = Math.hypot(to.x, to.y, to.z) || 1;
        return { cam: k.replay.cam, above: c.position.y - k.surface.height(c.position.x, c.position.z), facing: (d.x * to.x + d.y * to.y + d.z * to.z) / len, dist: len, finite: [c.position.x, c.position.y, c.position.z, c.fov].every(Number.isFinite), fpSkis: k.fp.meshes.skis().visible, bar: !!document.querySelector(".rpbar") };
      });
      h.expect(c.cam === id && c.finite && c.bar, `${id}: selected, finite camera`);
      h.expect(c.above > 0.2, `${id}: ${c.above.toFixed(1)} m over the snow`);
      if (id !== "fp") h.expect(c.facing > 0.9, `${id}: the skier is in the middle of the view (cos ${c.facing.toFixed(2)}, ${c.dist.toFixed(0)} m away)`);
      else h.expect(c.fpSkis, "fp: the ski tips are drawn (helmet view)");
      await h.shot(id);
    }

    h.step("pause, scrub, slow motion");
    await page.click(".rpplay");
    const p0 = await page.evaluate(() => window.__ski.replay.time);
    await h.pause(600);
    h.expect(Math.abs((await page.evaluate(() => window.__ski.replay.time)) - p0) < 0.01, "pause holds the clip");
    await page.evaluate(() => { const r = document.querySelector(".rpscrub"); r.value = "250"; r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); });
    await h.pause(300);
    const sc = await page.evaluate(() => ({ t: window.__ski.replay.time, d: window.__ski.replay.duration }));
    h.expect(Math.abs(sc.t / sc.d - 0.25) < 0.03, `scrub to a quarter (${(sc.t / sc.d).toFixed(2)})`);
    await page.click('.rpspeeds [data-v="0.25"]');
    const t0 = await page.evaluate(() => window.__ski.replay.time);
    await page.click(".rpplay");
    await h.pause(2000);
    const t1 = await page.evaluate(() => window.__ski.replay.time);
    h.expect(t1 - t0 > 0.15 && t1 - t0 < 1.0, `0.25x: ${(t1 - t0).toFixed(2)} s of clip in ~2 s`);
    await page.click('.rpspeeds [data-v="1"]');
    await page.keyboard.press("Space");
    h.expect(!(await page.evaluate(() => window.__ski.replay.playing)), "Space pauses");
    await page.keyboard.press("ArrowRight");
    await h.shot("scrubbed");

    h.step("close: back in the run, input works again");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.documentElement.dataset.skiReplay, null, { timeout: 3000 });
    const back = await page.evaluate(() => ({ paused: window.__ski.game.paused, x: window.__ski.state.x, z: window.__ski.state.z, rec: window.__ski.recorder.bytes }));
    h.expect(!back.paused, "the game runs again");
    await h.pause(1200);
    const moved = await page.evaluate(() => ({ x: window.__ski.state.x, z: window.__ski.state.z, bytes: window.__ski.recorder.bytes, n: window.__ski.recorder.count }));
    h.expect(Math.hypot(moved.x - back.x, moved.z - back.z) > 1, "the skier moves on");
    h.eq(moved.bytes, rec1.bytes, "the recorder memory did not grow");

    h.step("pause menu button + fresh clip includes the newest seconds");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#menuCard");
    h.expect(await page.evaluate(() => /Lescht 30 s nach eemol kucken/.test(document.getElementById("menuCard").textContent)), "the pause menu offers 'Lescht 30 s nach eemol kucken'");
    await page.click('#menuCard [data-a="replay"]');
    await page.waitForFunction(() => document.documentElement.dataset.skiReplay === "1", null, { timeout: 5000 });
    await page.click(".rpclose");
    h.expect(!(await page.evaluate(() => window.__ski.game.paused)), "Zou resumes");

    h.step("timed run: the finish card has a Replay button, the card returns");
    await h.goto("/pb/ski.html?resort=killy&go=1&debug=1&bot=1&timescale=4&q=low&res=fixed");
    await running();
    await page.evaluate(() => window.__ski.start("face"));
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "finish", null, { timeout: 240000 });
    await h.shot("finish-card");
    await page.click("#finishReplay");
    await page.waitForFunction(() => document.documentElement.dataset.skiReplay === "1", null, { timeout: 5000 });
    const run = await page.evaluate(() => ({ dur: window.__ski.replay.duration, cardHidden: getComputedStyle(document.getElementById("finishCard")).display === "none" }));
    h.expect(run.dur > 20, `the run's clip is ${run.dur.toFixed(0)} s long`);
    h.expect(run.cardHidden, "the finish card waits hidden during the replay");
    await page.click('.rpcams [data-v="tv"]');
    await h.pause(1200);
    await h.shot("run-tv");
    await page.click(".rpclose");
    h.expect(await page.evaluate(() => getComputedStyle(document.getElementById("finishCard")).display !== "none"), "the finish card is back after the replay");

    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
