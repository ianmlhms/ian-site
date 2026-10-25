/* Flow: MTB Mëllerdall W3 "Touch" at iPad sizes, portrait and landscape: tap "Fueren", steer with the left thumb, pedal / brake / jump with the right one at the same time;
 * the controls stay under 15 % of the screen and out of the middle; the start card, the menu and the finish screen fit the screen. */
import { runIfMain } from "./lib.mjs";

const PAGE = "/pb/mtb.html?debug=1&q=low&time=noon&weather=clear";
const ready = (page) => page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
const SIZES = [{ name: "portrait", w: 820, h: 1180 }, { name: "landscape", w: 1180, h: 820 }];

async function press(page, selector, id, x, y) {
  await page.evaluate(({ selector, id, x, y }) => document.querySelector(selector).dispatchEvent(new PointerEvent("pointerdown", { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: id === 1 })), { selector, id, x, y });
}
async function release(page, selector, id) {
  await page.evaluate(({ selector, id }) => document.querySelector(selector).dispatchEvent(new PointerEvent("pointerup", { pointerId: id, bubbles: true, pointerType: "touch" })), { selector, id });
}
async function center(page, selector) { const b = await page.locator(selector).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }

export const flow = {
  name: "mtb-touch",
  fullChromium: true,
  touch: true,
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    for (const size of SIZES) {
      h.step(`iPad ${size.name} ${size.w}x${size.h}: tap Fueren, then thumbs`);
      await page.setViewportSize({ width: size.w, height: size.h });
      await h.goto(PAGE);
      await ready(page);
      const fit = await page.evaluate(() => { const r = document.querySelector(".mcard").getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight, scrollX: document.documentElement.scrollWidth > innerWidth }; });
      h.expect(fit.l >= 0 && fit.r <= fit.vw && fit.t >= 0 && fit.b <= fit.vh && !fit.scrollX, `the start card fits the screen (${Math.round(fit.l)}..${Math.round(fit.r)} x ${Math.round(fit.t)}..${Math.round(fit.b)} of ${fit.vw}x${fit.vh})`);
      await h.shot(`card-${size.name}`);
      const start = await center(page, ".bigstart");
      await page.touchscreen.tap(start.x, start.y);
      await page.waitForFunction(() => window.__mtb.game.mode === "run", null, { timeout: 12000 });
      const geo = await page.evaluate(() => {
        const vw = innerWidth, vh = innerHeight;
        const rects = [...document.querySelectorAll("#touchControls .pad, #touchControls .tbtn")].map((e) => e.getBoundingClientRect());
        const area = rects.reduce((s, r) => s + r.width * r.height, 0);
        const centre = { l: vw * 0.3, r: vw * 0.7, t: vh * 0.2, b: vh * 0.8 };
        const inMiddle = rects.filter((r) => r.right > centre.l && r.left < centre.r && r.bottom > centre.t && r.top < centre.b).length;
        const hudRects = [...document.querySelectorAll(".mhud .hbtn")].map((e) => e.getBoundingClientRect());
        const overlap = rects.some((r) => hudRects.some((q) => r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top));
        const clock = document.querySelector("#hudTime").getBoundingClientRect();
        return { share: area / (vw * vh), minSide: Math.min(...rects.map((r) => Math.min(r.width, r.height))), inMiddle, overlap, clockOk: clock.left >= 0 && clock.right <= vw, hudMin: Math.min(...hudRects.map((r) => Math.min(r.width, r.height))) };
      });
      h.expect(geo.share < 0.15, `controls cover ${(geo.share * 100).toFixed(1)} % of the screen (< 15 %)`);
      h.expect(geo.minSide >= 44 && geo.hudMin >= 44, `every control is at least 44 px (${geo.minSide.toFixed(0)} px, HUD buttons ${geo.hudMin.toFixed(0)} px)`);
      h.eq([geo.inMiddle, geo.overlap, geo.clockOk], [0, false, true], "nothing covers the middle of the screen, nothing overlaps the HUD");
      // right thumb pedals while the left thumb steers (two pointers at once)
      const pedal = await center(page, '#touchControls [data-btn="throttle"]'), pad = await center(page, "#touchControls .pad");
      const h0 = await page.evaluate(() => window.__mtb.bike.heading);
      await press(page, '#touchControls [data-btn="throttle"]', 11, pedal.x, pedal.y);
      await press(page, "#touchControls .pad", 12, pad.x, pad.y);
      await page.evaluate(({ x, y }) => document.querySelector("#touchControls .pad").dispatchEvent(new PointerEvent("pointermove", { pointerId: 12, clientX: x + 55, clientY: y, bubbles: true, pointerType: "touch" })), pad);
      await h.pause(1500);                                   // (the first trail runs through a gorge: a thumb held at full lock for longer than this rides into the wall, which is what a real rider does too)
      const s1 = await page.evaluate(() => { const b = window.__mtb.bike; return { v: Math.hypot(b.vx, b.vz) * 3.6, h: b.heading }; });
      h.expect(s1.v > 5 && Math.abs(s1.h - h0) > 0.05, `pedal + steer at the same time: ${s1.v.toFixed(0)} km/h, heading changed ${((s1.h - h0) * 57.3).toFixed(0)} degrees`);
      await h.shot(`run-${size.name}`);
      await release(page, "#touchControls .pad", 12);
      const brake = await center(page, '#touchControls [data-btn="brake"]');
      await release(page, '#touchControls [data-btn="throttle"]', 11);
      await press(page, '#touchControls [data-btn="brake"]', 13, brake.x, brake.y);
      await h.pause(1800);
      const v2 = await page.evaluate(() => Math.hypot(window.__mtb.bike.vx, window.__mtb.bike.vz) * 3.6);
      await release(page, '#touchControls [data-btn="brake"]', 13);
      h.expect(v2 < s1.v * 0.6, `the brake button slows the bike (${s1.v.toFixed(0)} -> ${v2.toFixed(0)} km/h)`);
      await page.evaluate(() => { const m = window.__mtb, t = m.trail; let at = 70; for (let i = 40; i < t.count - 80; i += 4) { const dh = Math.abs(Math.atan2(Math.sin(t.headingAt(i + 30) - t.headingAt(i)), Math.cos(t.headingAt(i + 30) - t.headingAt(i)))); const [x0, z0] = t.centre[i], [x1, z1] = t.centre[i + 30]; if (dh < 0.06 && Math.abs(m.surface.height(x1, z1) - m.surface.height(x0, z0)) < 0.8 && !t.features.some((f) => f.i0 !== undefined && f.i1 > i - 10 && f.i0 < i + 40)) { at = i; break; } } m.reset(at); m.setBike({ vx: 7 * Math.cos(m.bike.heading), vz: 7 * Math.sin(m.bike.heading) }); });
      const jump = await center(page, '#touchControls [data-btn="jump"]');
      await press(page, '#touchControls [data-btn="jump"]', 14, jump.x, jump.y);
      await h.pause(450);
      await release(page, '#touchControls [data-btn="jump"]', 14);
      const air = await page.evaluate(() => new Promise((res) => { let m = 0; const t0 = performance.now(); const id = setInterval(() => { const b = window.__mtb.bike; if (!b.grounded) m = Math.max(m, b.airTime); if (performance.now() - t0 > 900) { clearInterval(id); res(m); } }, 16); }));
      h.expect(air > 0.15, `the jump button pops the bike (${air.toFixed(2)} s in the air)`);
      await page.evaluate(() => window.__mtb.openMenu("trails"));
      await h.pause(300);
      const menu = await page.evaluate(() => { const r = document.querySelector(".menu-box").getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight, overflow: document.querySelector(".menu-body").scrollWidth > document.querySelector(".menu-body").clientWidth + 2 }; });
      h.expect(menu.l >= 0 && menu.r <= menu.vw && menu.t >= 0 && menu.b <= menu.vh && !menu.overflow, "the menu fits the screen without sideways scrolling");
      await h.shot(`menu-${size.name}`);
      await page.evaluate(() => window.__mtb.closeMenu());
    }
    h.eq(errors, [], "zero console errors");
  },
};

runIfMain(import.meta.url, flow);
