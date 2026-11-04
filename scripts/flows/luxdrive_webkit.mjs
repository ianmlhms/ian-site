/* Flow: Lux Drive in WebKit (the engine of the school iPads), 1180x820 with touch.
 *
 *   FLOW_BROWSER=webkit python3 ~/Library/Caches/browser-slot.py node scripts/flows/luxdrive_webkit.mjs
 *
 * The other luxdrive flows drive Chromium (some of them through CDP, which WebKit does not have).  This one is the small WebKit gate: the game boots
 * without a console error, draws the city (not a blank or single-colour canvas), the touch controls are on the screen and answer to touch (a real
 * tap on the start button, then pointer events on the pad and the pedals, two and three fingers at once), the page cannot scroll or zoom, and the car moves.
 * Frame rate is only printed: a Mac mini in a headless WebKit says nothing about an iPad.
 *
 * Without FLOW_BROWSER=webkit it runs in Chromium (so the flow itself can be checked there). */
import { runIfMain } from "./lib.mjs";

const SIZE = { width: 1180, height: 820 };
const MIN_DISTINCT_COLOURS = 40;            // a drawn city has many; a blank, cleared or one-colour canvas has a handful
const SAMPLE_GRID = 48;                     // the canvas is sampled on a grid of SAMPLE_GRID x SAMPLE_GRID pixels

export const flow = {
  name: "luxdrive-webkit",
  fullChromium: true,
  touch: true,
  viewport: SIZE,
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await page.addInitScript(() => { try { localStorage.clear(); } catch (error) { /* blocked */ } });

    for (const q of ["low", "medium"]) {
      h.step(`boot at ${q} quality: no error, the city is drawn`);
      await h.goto(`/pb/lux-drive.html?q=${q}&time=noon&weather=clear`);
      await page.waitForFunction(() => document.documentElement.dataset.luxReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 300000 });
      h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", `${q}: no boot error`);
      const engine = await page.evaluate(() => navigator.userAgent);
      h.expect(true, `${q}: the engine is ${engine.replace(/^Mozilla\/5.0 /, "").slice(0, 90)}`);
      await page.waitForSelector("#start [data-act=\"drive\"]", { state: "visible", timeout: 60000 });
      // a REAL tap (touchscreen) on the start button
      const box = await page.locator("#start [data-act=\"drive\"]").boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(() => window.__lux.isStarted(), null, { timeout: 30000 });
      h.expect(true, `${q}: a tap on the start button started the game`);
      // the world around the car is built, then the picture is read back from the canvas
      await page.evaluate(async () => { for (let i = 0; i < 300; i++) { const s = window.__lux.stats(); if (s.pending === 0 && s.cityPending === 0 && i > 10) break; await new Promise((r) => setTimeout(r, 100)); } });
      const pic = await page.evaluate((grid) => {
        const m = window.__lux, gl = m.renderer.getContext();
        m.renderer.render(m.scene, m.camera);
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(4);
        const colours = new Set();
        for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) {
          gl.readPixels(Math.floor(((gx + 0.5) * W) / grid), Math.floor(((gy + 0.5) * H) / grid), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          colours.add(`${px[0] >> 3},${px[1] >> 3},${px[2] >> 3}`);          // 5 bits per channel: noise does not count as variety
        }
        return { colours: colours.size, calls: m.stats().calls, triangles: m.stats().triangles, glError: gl.getError(), buffer: `${W}x${H}` };
      }, SAMPLE_GRID);
      h.expect(pic.colours >= MIN_DISTINCT_COLOURS, `${q}: the canvas shows ${pic.colours} distinct colours (>= ${MIN_DISTINCT_COLOURS}), buffer ${pic.buffer}`);
      h.expect(pic.calls > 20 && pic.triangles > 20000, `${q}: ${pic.calls} draw calls, ${pic.triangles} triangles`);
      h.eq(pic.glError, 0, `${q}: no WebGL error`);
      await h.shot(`webkit-${q}`);

      // frame time, for the record only
      const frames = await page.evaluate(async () => {
        const t0 = performance.now(); let n = 0;
        while (performance.now() - t0 < 3000) { await new Promise((r) => requestAnimationFrame(r)); n++; }
        return { fps: (n * 1000) / (performance.now() - t0) };
      });
      console.log(`  (info) ${q}: ${frames.fps.toFixed(1)} frames/s in this headless WebKit: not a measure of an iPad`);
    }

    h.step("touch controls at 1180x820: visible, finger-sized, answer to pointers, several fingers at once");
    const rect = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    const PAD = ".pad", GAS = "[data-btn=\"throttle\"]", BRAKE = "[data-btn=\"brake\"]";
    const pad = await rect(PAD), gas = await rect(GAS), brake = await rect(BRAKE);
    h.expect(await page.evaluate(() => !document.querySelector("#touchControls").hidden), "the touch controls are visible");
    h.expect(gas.w >= 96 && brake.w >= 86 && pad.w >= 200, `controls are big enough: pad ${pad.w.toFixed(0)}, gas ${gas.w.toFixed(0)}, brake ${brake.w.toFixed(0)} px`);
    h.expect([pad, gas, brake].every((r) => r.l >= 0 && r.r <= SIZE.width && r.t >= 0 && r.b <= SIZE.height), "every control is on the screen");
    const fire = (sel, type, id, x, y) => page.evaluate(([s, t, i, px, py]) => {
      document.querySelector(s).dispatchEvent(new PointerEvent(t, { pointerId: i, pointerType: "touch", isPrimary: i === 1, clientX: px, clientY: py, bubbles: true, cancelable: true }));
    }, [sel, type, id, x, y]);
    await fire(PAD, "pointerdown", 1, pad.l + pad.w * 0.85, pad.y);
    await fire(GAS, "pointerdown", 2, gas.x, gas.y);
    await page.waitForTimeout(400);
    const both = await page.evaluate(() => { const m = window.__lux; m.input.read(); return { ...m.input.state }; });
    h.expect(both.throttle === 1 && both.steer > 0.5, `two fingers at once: gas ${both.throttle}, steering ${both.steer.toFixed(2)} (to the right)`);
    await fire(PAD, "pointerup", 1, pad.l + pad.w * 0.85, pad.y);
    await fire(GAS, "pointerup", 2, gas.x, gas.y);
    await fire(PAD, "pointerdown", 1, pad.l + pad.w * 0.1, pad.y);
    await fire(BRAKE, "pointerdown", 3, brake.x, brake.y);
    await page.waitForTimeout(300);
    const two = await page.evaluate(() => { const m = window.__lux; m.input.read(); return { ...m.input.state }; });
    h.expect(two.brake === 1 && two.steer < -0.5, `brake and steering at once: brake ${two.brake}, steering ${two.steer.toFixed(2)} (to the left)`);
    await fire(PAD, "pointerup", 1, pad.l + pad.w * 0.1, pad.y);
    await fire(BRAKE, "pointerup", 3, brake.x, brake.y);
    await page.waitForTimeout(300);
    const rel = await page.evaluate(() => { const m = window.__lux; m.input.read(); return { ...m.input.state }; });
    h.expect(rel.throttle === 0 && rel.brake === 0 && rel.steer === 0, "every finger up: every control is released");

    h.step("the page cannot scroll or zoom");
    const page0 = await page.evaluate(() => ({ sx: window.scrollX, sy: window.scrollY, scale: window.visualViewport ? window.visualViewport.scale : 1, ta: getComputedStyle(document.body).touchAction, over: getComputedStyle(document.documentElement).overflow }));
    h.expect(page0.sx === 0 && page0.sy === 0 && page0.scale === 1, "the page is not scrolled and not zoomed");
    h.expect(page0.ta === "none" && page0.over === "hidden", `touch-action ${page0.ta}, overflow ${page0.over}`);

    h.step("the car drives under the gas pedal");
    const before = await page.evaluate(() => { const s = window.__lux.state(); return { x: s.x, z: s.z }; });
    await fire(GAS, "pointerdown", 2, gas.x, gas.y);
    await page.waitForTimeout(3500);
    const after = await page.evaluate(() => { const s = window.__lux.state(); return { x: s.x, z: s.z, speed: s.speed }; });
    await fire(GAS, "pointerup", 2, gas.x, gas.y);
    h.expect(Math.hypot(after.x - before.x, after.z - before.z) > 3, `the car moved ${Math.hypot(after.x - before.x, after.z - before.z).toFixed(1)} m with a touch on the gas pedal`);

    h.eq(errors, [], "no console error in the whole flow");
  },
};

runIfMain(import.meta.url, flow);
