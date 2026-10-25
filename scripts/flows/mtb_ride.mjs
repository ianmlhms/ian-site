/* Flow: MTB Mëllerdall W1 "Ride". The bike rides the first trail from start to finish with scripted input (a fast, rendering-free simulation inside the page
 * using the very same physics and surface), then real keyboard and touch input move the bike in the live game. */
import { runIfMain } from "./lib.mjs";

const PAGE = "/pb/mtb.html?debug=1&q=low&time=noon&weather=clear";

export const flow = {
  name: "mtb-ride",
  fullChromium: true,
  touch: true,
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await h.goto(PAGE);
    await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });

    h.step("scripted rider finishes the whole trail (physics only, 120 Hz steps)");
    const ride = await page.evaluate(() => {
      const m = window.__mtb;
      const line = m.centre;
      m.stop();                                              // no rendering while we simulate
      m.reset(0);
      let wp = 1, t = 0, stuck = 0, nan = 0, belowGround = 0, vmax = 0, airTime = 0;
      const dt = 1 / 60;
      while (wp < line.length - 1 && t < 900) {
        const s = m.bike;
        while (wp < line.length - 1 && Math.hypot(line[wp][0] - s.x, line[wp][1] - s.z) < 7) wp++;
        let err = Math.atan2(line[wp][1] - s.z, line[wp][0] - s.x) - s.heading;
        while (err > Math.PI) err -= 2 * Math.PI;
        while (err < -Math.PI) err += 2 * Math.PI;
        const speed = Math.hypot(s.vx, s.vz);
        m.step(dt, { throttle: speed < 8.5 ? 1 : 0.3, brake: speed > 12 ? 0.5 : 0, steer: Math.max(-1, Math.min(1, err * 1.8)), jump: false });
        const b = m.bike;
        if (![b.x, b.y, b.z, b.vx, b.vy, b.vz].every(Number.isFinite)) { nan++; break; }
        if (b.y < m.surface.height(b.x, b.z) - 1e-6) belowGround++;
        vmax = Math.max(vmax, Math.hypot(b.vx, b.vy, b.vz));
        if (!b.grounded) airTime += dt;
        if (speed < 0.2 && t > 6) { if (++stuck > 120) break; } else stuck = 0;
        t += dt;
      }
      return { wp, n: line.length, t, nan, belowGround, vmax, airTime, odo: m.bike.odometer };
    });
    h.expect(ride.wp >= ride.n - 2, `reached the end of the trail (${ride.wp}/${ride.n}) in ${ride.t.toFixed(0)} s, ${ride.odo.toFixed(0)} m`);
    h.eq([ride.nan, ride.belowGround], [0, 0], "no NaN and never below the physics surface");
    h.expect(ride.vmax < 27, `speed stays physical (max ${(ride.vmax * 3.6).toFixed(0)} km/h)`);

    h.step("live game: keyboard W moves the bike, S brakes it, R puts it back on the trail");
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1", null, { timeout: 120000 });
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
    await h.pause(400);
    const back = await page.evaluate(() => { const m = window.__mtb; const b = m.bike; let best = 1e9; for (const [x, z] of m.centre) best = Math.min(best, Math.hypot(x - b.x, z - b.z)); return { off: best, v: Math.hypot(b.vx, b.vz) }; });
    h.expect(back.off < 3 && back.v < 1.5, `R: back on the trail (${back.off.toFixed(1)} m from the line, ${back.v.toFixed(1)} m/s)`);

    h.step("touch: the steering pad and the pedal button drive the bike; the controls stay small");
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1", null, { timeout: 120000 });
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
    await page.touchscreen.tap(go.x + go.width / 2, go.y + go.height / 2);       // a tap is short; hold with raw pointer events instead:
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
