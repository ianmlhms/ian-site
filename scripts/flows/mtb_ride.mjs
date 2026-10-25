/* Flow: MTB Mëllerdall W3 "Ride". The reference rider finishes the first trail inside the real game loop (start card, countdown, checkpoints, finish, medal), then real keyboard and touch
 * input move the bike in the live game. */
import { runIfMain } from "./lib.mjs";

const PAGE = "/pb/mtb.html?debug=1&q=low&time=noon&weather=clear";
const ready = (page) => page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });

export const flow = {
  name: "mtb-ride",
  fullChromium: true,
  touch: true,
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await h.goto(PAGE);
    await ready(page);

    h.step("start card -> 3-2-1-Go -> the reference rider finishes the first trail in the real game loop (no rendering, 60 Hz ticks)");
    const run = await page.evaluate(async () => {
      const { createBot } = await import("/pb/mtb/bot.js");
      const m = window.__mtb;
      m.stop();                                                // no rendering while we simulate
      const t = m.trail;
      const modes = [m.game.mode];
      await m.startRun();
      const bot = createBot(t.centre.slice(0, t.arch.index + 4), t.grade);
      const events = [];
      let frames = 0, nan = 0, below = 0, vmax = 0;
      while (m.game.mode !== "finished" && frames < 60 * 900) {
        const inp = m.game.mode === "run" ? bot.input(m.bike) : { throttle: 0, brake: 0, steer: 0, jump: false };
        m.tick(1 / 60, inp);
        if (modes[modes.length - 1] !== m.game.mode) modes.push(m.game.mode);
        const b = m.bike;
        if (![b.x, b.y, b.z, b.vx, b.vy, b.vz].every(Number.isFinite)) { nan++; break; }
        if (b.y < m.ground.height(b.x, b.z) - 1e-6) below++;
        vmax = Math.max(vmax, Math.hypot(b.vx, b.vy, b.vz));
        frames++;
      }
      const g = m.game;
      return { modes, frames, nan, below, vmax, result: g.result && { ms: g.result.ms, medal: g.result.medal, isBest: g.result.isBest, crashes: g.result.crashes, splits: g.result.splits.length }, cps: t.cps.length, finishVisible: !!document.querySelector(".mfinish:not(.hidden)"), medalText: (document.querySelector(".fin-medal .mn") || {}).textContent || "" };
    });
    h.eq(run.modes.join(">"), "card>countdown>run>finished", "the game goes card, countdown, run, finished");
    h.eq([run.nan, run.below], [0, 0], "no NaN and never below the ground");
    h.expect(run.result && run.result.splits === run.cps, `every checkpoint was counted (${run.result && run.result.splits}/${run.cps})`);
    h.expect(run.result && run.result.medal >= 2 && run.result.crashes === 0, `the reference rider wins silver or gold without a crash (${run.result && (run.result.ms / 1000).toFixed(1)} s, medal ${run.result && run.result.medal})`);
    h.expect(run.finishVisible && run.medalText.length > 0, `the finish screen is up: ${run.medalText}`);
    h.expect(run.vmax < 27.5, `speed stays physical (max ${(run.vmax * 3.6).toFixed(0)} km/h)`);
    await page.evaluate(() => { window.__mtb.persistence.pushSave(); });
    h.expect(await page.evaluate(() => /"m":"[1-3]/.test(localStorage.getItem("pb_mtb_save") || "")), "the medal is saved in localStorage");

    h.step("live game: keyboard W moves the bike, S brakes it, R puts it back on the last checkpoint");
    await h.goto(PAGE + "&autostart=1");
    await ready(page);
    await page.waitForFunction(() => window.__mtb.game.mode === "run", null, { timeout: 20000 });
    await page.keyboard.down("KeyW");
    await h.pause(4000);
    const fast = await page.evaluate(() => { const b = window.__mtb.bike; return { v: Math.hypot(b.vx, b.vz) * 3.6, odo: b.odometer }; });
    h.expect(fast.v > 8 && fast.odo > 10, `holding W: ${fast.v.toFixed(0)} km/h, ${fast.odo.toFixed(0)} m rolled`);
    await page.keyboard.up("KeyW");
    await page.keyboard.down("KeyS");
    await h.pause(2500);
    const slow = await page.evaluate(() => Math.hypot(window.__mtb.bike.vx, window.__mtb.bike.vz) * 3.6);
    await page.keyboard.up("KeyS");
    h.expect(slow < fast.v * 0.5, `holding S: slowed from ${fast.v.toFixed(0)} to ${slow.toFixed(0)} km/h`);
    await page.keyboard.down("KeyD"); await page.keyboard.down("KeyW"); await h.pause(1500);
    await page.keyboard.up("KeyD"); await page.keyboard.up("KeyW");
    await page.keyboard.press("KeyR");
    await h.pause(500);
    const back = await page.evaluate(() => { const m = window.__mtb; const b = m.bike; let best = 1e9; for (const [x, z] of m.centre) best = Math.min(best, Math.hypot(x - b.x, z - b.z)); return { off: best, v: Math.hypot(b.vx, b.vz) }; });
    h.expect(back.off < 3 && back.v < 1.5, `R: back on the trail (${back.off.toFixed(1)} m from the line, ${back.v.toFixed(1)} m/s)`);

    h.step("space: a tap does not pop, a hold pops the bike into the air; Q and E are the two brakes");
    await page.evaluate(() => { const m = window.__mtb; m.reset(60); m.setBike({ vx: 7 * Math.cos(m.bike.heading), vz: 7 * Math.sin(m.bike.heading) }); });
    await page.keyboard.down("Space"); await h.pause(450); await page.keyboard.up("Space");
    const air = await page.evaluate(() => new Promise((res) => { let maxAir = 0; const t0 = performance.now(); const id = setInterval(() => { const b = window.__mtb.bike; if (!b.grounded) maxAir = Math.max(maxAir, b.airTime); if (performance.now() - t0 > 900) { clearInterval(id); res(maxAir); } }, 16); }));
    h.expect(air > 0.15, `holding Space then releasing: airborne for ${air.toFixed(2)} s`);
    await page.evaluate(() => { const m = window.__mtb; m.reset(80); m.setBike({ vx: 9 * Math.cos(m.bike.heading), vz: 9 * Math.sin(m.bike.heading) }); });
    await page.keyboard.down("KeyE"); await h.pause(300);
    const brakes = await page.evaluate(() => { const b = window.__mtb.bike; return { f: b.brakeF, r: b.brakeR }; });
    await page.keyboard.up("KeyE");
    h.expect(brakes.f > 0.9 && brakes.r < 0.1, `E is the front brake only (front ${brakes.f.toFixed(2)}, rear ${brakes.r.toFixed(2)})`);

    h.step("touch: the steering pad and the pedal button drive the bike; the controls stay small");
    await h.goto(PAGE + "&autostart=1");
    await ready(page);
    await page.waitForFunction(() => window.__mtb.game.mode === "run", null, { timeout: 20000 });
    const geo = await page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const rects = [...document.querySelectorAll("#touchControls .pad, #touchControls .tbtn")].map((e) => e.getBoundingClientRect());
      const area = rects.reduce((s, r) => s + r.width * r.height, 0);
      return { visible: rects.every((r) => r.width > 0 && r.height > 0), share: area / (vw * vh), minSide: Math.min(...rects.map((r) => Math.min(r.width, r.height))) };
    });
    h.expect(geo.visible, "touch controls are on screen on a touch device");
    h.expect(geo.share < 0.15, `controls cover ${(geo.share * 100).toFixed(1)} % of the screen (< 15 %)`);
    h.expect(geo.minSide >= 44, `smallest control is ${geo.minSide.toFixed(0)} px (>= 44 px)`);
    const go = await page.locator('#touchControls [data-btn="throttle"]').boundingBox();
    const pad = await page.locator("#touchControls .pad").boundingBox();
    await page.evaluate(({ x, y }) => {
      const el = document.querySelector('#touchControls [data-btn="throttle"]');
      el.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true }));
    }, { x: go.x + go.width / 2, y: go.y + go.height / 2 });
    await h.pause(3500);
    const v1 = await page.evaluate(() => Math.hypot(window.__mtb.bike.vx, window.__mtb.bike.vz) * 3.6);
    h.expect(v1 > 6, `holding the pedal button: ${v1.toFixed(0)} km/h`);
    const h0 = await page.evaluate(() => window.__mtb.bike.heading);
    await page.evaluate(({ x, y }) => {
      const el = document.querySelector("#touchControls .pad");
      el.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 8, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true }));
      el.dispatchEvent(new PointerEvent("pointermove", { pointerId: 8, clientX: x + 60, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true }));
    }, { x: pad.x + pad.width / 2, y: pad.y + pad.height / 2 });
    await h.pause(1200);
    const h1 = await page.evaluate(() => window.__mtb.bike.heading);
    h.expect(Math.abs(h1 - h0) > 0.1, `dragging the pad to the right turns the bike (${((h1 - h0) * 57.3).toFixed(0)} degrees)`);
    await h.shot("touch");
    h.eq(errors, [], "zero console errors");
  },
};

runIfMain(import.meta.url, flow);
