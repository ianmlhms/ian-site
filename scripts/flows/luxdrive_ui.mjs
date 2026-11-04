/* Flow: Lux Drive "the interface" (pb/lux-drive.html), Milestone 5.
 * The start menu and the pause menu (Luxembourgish first, de / en / fr), the weather and time chooser (random is the default,
 * in the menu AND in the game), the touch controls on an iPad in landscape (1180x820 and 1024x768: multi-touch, no scroll,
 * no zoom, big targets), the Kaart (the full-screen map: names, the car, tap = teleport onto the carriageway), the quality
 * auto-step, the car (the wheels turn and steer, the lights) and the handling (no spinning, no flipping, the brake reverses).
 *
 * Every loop is counted in GAME seconds (`window.__lux.clock()`), never in frames or wall time, so the flow gives the same
 * answer on a Mac with a GPU and in a cloud container that draws three frames a second. */
import { runIfMain } from "./lib.mjs";

const PAGE = "/pb/lux-drive.html?q=low&time=noon&weather=clear";
const MIN_TOUCH_PX = 44;                // Apple's minimum for a tap target
const BIG_PEDAL_PX = 96;                // the gas pedal is the biggest control
const SIZES = [{ width: 1180, height: 820 }, { width: 1024, height: 768 }];

const SIM_HELPERS = `window.simSeconds = async (m, secs, each) => {
  const t0 = m.clock();
  for (let g = 0; m.clock() - t0 < secs && g < 4000; g++) { await new Promise((r) => requestAnimationFrame(r)); if (each) each(); }
};`;

async function boot(h, url = PAGE) {
  await h.goto(url);
  await h.page.waitForFunction(() => document.documentElement.dataset.luxReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 240000 });
  await h.page.waitForSelector("#start [data-act=\"drive\"]", { state: "visible", timeout: 60000 });
}

export const flow = {
  name: "luxdrive-ui",
  fullChromium: true,
  touch: true,
  viewport: SIZES[0],
  async run(h) {
    const { page } = h;
    await page.addInitScript(SIM_HELPERS);
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    // a fresh browser: nothing stored, so "random" must be the default everywhere
    h.step("boot: the start menu is up, Luxembourgish first, random weather and time by default");
    await page.addInitScript(() => { try { localStorage.clear(); } catch (error) { /* blocked */ } });
    await boot(h, "/pb/lux-drive.html?q=low");
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "no boot error");
    const start = await page.evaluate(() => {
      const pressed = (g) => [...document.querySelectorAll(`#start [data-group="${g}"][aria-pressed="true"]`)].map((n) => n.dataset.value);
      const m = window.__lux;
      return {
        lang: document.documentElement.lang, drive: document.querySelector("#start [data-act=\"drive\"]").textContent,
        langs: [...document.querySelectorAll("#start [data-group=\"lang\"]")].map((n) => n.dataset.value),
        pLang: pressed("lang"), pWeather: pressed("weather"), pTime: pressed("time"),
        weatherChips: [...document.querySelectorAll("#start [data-group=\"weather\"]")].map((n) => n.dataset.value),
        timeChips: [...document.querySelectorAll("#start [data-group=\"time\"]")].map((n) => n.dataset.value),
        choice: m.env.getChoice(), blocking: m.ui.isBlocking(), started: m.isStarted(),
      };
    });
    h.eq(start.lang, "lb", "the page language is Luxembourgish");
    h.eq(start.drive, "Fueren", "the start button says Fueren");
    h.eq(start.langs, ["lb", "de", "en", "fr"], "the language chooser: lb, de, en, fr");
    h.eq(start.pLang, ["lb"], "Luxembourgish is selected");
    h.eq(start.pWeather, ["random"], "the weather chooser: Random is selected by default");
    h.eq(start.pTime, ["random"], "the time chooser: Random is selected by default");
    h.eq(start.weatherChips[0], "random", "Random is the first weather chip");
    h.eq(start.timeChips[0], "random", "Random is the first time chip");
    h.eq([start.choice.weatherMode, start.choice.timeMode], ["random", "random"], "the environment is on random");
    h.expect(start.blocking && !start.started, "the car waits behind the start menu");
    await h.shot("start-lb");

    h.step("the language chooser changes the language live (no reload)");
    await page.tap("#start [data-group=\"lang\"][data-value=\"de\"]");
    h.eq(await page.evaluate(() => [document.documentElement.lang, document.querySelector("#start [data-act=\"drive\"]").textContent]), ["de", "Fahren"], "German: Fahren");
    await h.shot("start-de");
    await page.tap("#start [data-group=\"lang\"][data-value=\"fr\"]");
    h.eq(await page.evaluate(() => document.querySelector("#start [data-act=\"drive\"]").textContent), "Rouler", "French: Rouler");
    await page.tap("#start [data-group=\"lang\"][data-value=\"en\"]");
    h.eq(await page.evaluate(() => document.querySelector("#start [data-act=\"drive\"]").textContent), "Drive", "English: Drive");
    await page.tap("#start [data-group=\"lang\"][data-value=\"lb\"]");
    h.eq(await page.evaluate(() => document.querySelector("#start [data-act=\"drive\"]").textContent), "Fueren", "and back to Luxembourgish");

    h.step("the texts: every key in all four languages, the placeholders agree, the old mistakes are gone");
    const texts = await page.evaluate(async () => {
      const i = await import("/pb/lux-drive/i18n.js");
      const base = i.keysOf("lb");
      const missing = [], placeholders = [], all = [];
      for (const lang of i.LANGS) {
        const keys = new Set(i.keysOf(lang));
        for (const k of base) {
          if (!keys.has(k)) missing.push(`${lang}:${k}`);
          else if (JSON.stringify(i.placeholders(lang, k).sort()) !== JSON.stringify(i.placeholders("lb", k).sort())) placeholders.push(`${lang}:${k}`);
        }
        if (lang === "lb") for (const k of base) all.push(i.t("lb", k));
      }
      return { missing, placeholders, lb: all.join(" | ") };
    });
    h.eq(texts.missing, [], "no key is missing in any language");
    h.eq(texts.placeholders, [], "every {placeholder} is in every language");
    for (const bad of ["Ueufank", "Beaumen", "Standgrond", "Dageszäitänneren"]) h.expect(!texts.lb.includes(bad), `the Luxembourgish texts no longer contain "${bad}"`);
    for (const good of ["Ufank", "Beem"]) h.expect(texts.lb.includes(good), `the Luxembourgish texts say "${good}"`);

    h.step("the weather and time chooser in the start menu");
    await page.tap("#start [data-group=\"weather\"][data-value=\"rain\"]");
    await page.tap("#start [data-group=\"time\"][data-value=\"night\"]");
    const chosen = await page.evaluate(() => { const c = window.__lux.env.getChoice(); return [c.weatherMode, c.weatherId, c.timeMode, c.timeId]; });
    h.eq(chosen, ["rain", "rain", "night", "night"], "rain + night are chosen");
    await page.tap("#start [data-group=\"weather\"][data-value=\"random\"]");
    await page.tap("#start [data-group=\"time\"][data-value=\"random\"]");
    const rnd = await page.evaluate(() => { const c = window.__lux.env.getChoice(); return [c.weatherMode, c.timeMode]; });
    h.eq(rnd, ["random", "random"], "random again");
    await page.tap("#start [data-group=\"weather\"][data-value=\"clear\"]");
    await page.tap("#start [data-group=\"time\"][data-value=\"noon\"]");

    h.step("start: the HUD appears, the car is free");
    await page.tap("#start [data-act=\"drive\"]");
    await page.waitForSelector("#hud", { state: "visible" });
    const hud = await page.evaluate(() => {
      const m = window.__lux;
      return { blocking: m.ui.isBlocking(), started: m.isStarted(), limit: !document.querySelector("#limitSign").hidden, limitText: document.querySelector("#limitValue").textContent };
    });
    h.expect(!hud.blocking && hud.started, "the menu is closed and the game runs");
    await page.evaluate(() => window.simSeconds(window.__lux, 0.6));
    const sign = await page.evaluate(() => ({ shown: !document.querySelector("#limitSign").hidden, v: document.querySelector("#limitValue").textContent, road: document.querySelector("#roadName").textContent }));
    h.expect(sign.shown, "the speed-limit sign is shown on the road");
    h.eq(sign.v, "50", `the limit on ${sign.road || "the start road"} is 50 (a town)`);

    h.step("the pause menu: Esc pauses the car, Weider continues");
    const before = await page.evaluate(() => { const s = window.__lux.state(); return { x: s.x, z: s.z }; });
    await page.evaluate(() => window.__lux.setInput({ throttle: 1, brake: 0, steer: 0, handbrake: false }));
    await page.keyboard.press("Escape");
    h.expect(await page.evaluate(() => window.__lux.ui.isOpen("pause")), "the pause menu is open");
    await h.shot("pause");
    const mid = await page.evaluate(async () => { const m = window.__lux; const a = { x: m.state().x, z: m.state().z }; await window.simSeconds(m, 1); const b = m.state(); return { moved: Math.hypot(b.x - a.x, b.z - a.z) }; });
    h.expect(mid.moved < 0.05, `the car stands still while the menu is open (${mid.moved.toFixed(3)} m, the throttle is down)`);
    await page.tap("#pause [data-act=\"resume\"]");
    await page.evaluate(() => window.simSeconds(window.__lux, 2));
    const after = await page.evaluate(() => { const s = window.__lux.state(); return { x: s.x, z: s.z }; });
    h.expect(Math.hypot(after.x - before.x, after.z - before.z) > 3, "the car drives on after Weider");
    await page.evaluate(() => window.__lux.setInput(null));
    await page.keyboard.press("Escape");
    await page.tap("#pause [data-act=\"settings\"]");
    h.expect(await page.evaluate(() => window.__lux.ui.isOpen("settings")), "the settings open from the pause menu");
    await h.shot("settings");
    await page.tap("#settings [data-act=\"back\"]");
    await page.tap("#pause [data-act=\"resume\"]");

    h.step("the weather and time chooser IN the game (the button at the top right)");
    await page.evaluate(() => window.__lux.ui.setChooserIdle(0));         // a slow renderer must not race the 12 s auto-close
    await page.tap("#btnChooser");
    h.expect(await page.evaluate(() => window.__lux.ui.isChooserOpen()), "the chooser opens");
    await h.shot("chooser");
    await page.tap("#chooser [data-group=\"weather\"][data-value=\"fog\"]");
    await page.tap("#chooser [data-group=\"time\"][data-value=\"dusk\"]");
    const live = await page.evaluate(() => { const c = window.__lux.env.getChoice(); return [c.weatherId, c.timeId]; });
    h.eq(live, ["fog", "dusk"], "fog + dusk are set while driving");
    await page.tap("#chooser [data-group=\"weather\"][data-value=\"random\"]");
    h.eq(await page.evaluate(() => window.__lux.env.getChoice().weatherMode), "random", "random is one tap away in the game too");
    await page.tap("#chooser [data-group=\"weather\"][data-value=\"clear\"]");
    await page.tap("#chooser [data-group=\"time\"][data-value=\"noon\"]");
    await page.tap("#btnChooser");

    h.step("rain and fog change the grip and the view");
    const wx = await page.evaluate(async () => {
      const m = window.__lux;
      const grip = {}, fog = {};
      for (const w of ["clear", "rain", "fog"]) {
        m.env.setWeather(w); m.env.snap();
        // the weather moves towards its target at 0.6 / s: let it arrive
        await window.simSeconds(m, 8);
        grip[w] = m.env.gripScale(); fog[w] = m.env.uniforms.uFogDensity.value;
      }
      m.env.setWeather("clear");
      return { grip, fog };
    });
    h.expect(wx.grip.rain < wx.grip.clear - 0.1, `rain takes grip (${wx.grip.rain.toFixed(2)} vs ${wx.grip.clear.toFixed(2)} dry)`);
    h.expect(wx.fog.fog > wx.fog.clear * 3, `fog thickens the air (${wx.fog.fog.toFixed(4)} vs ${wx.fog.clear.toFixed(4)})`);

    for (const size of SIZES) {
      h.step(`touch controls at ${size.width}x${size.height}: big targets, multi-touch, no scroll, no zoom`);
      await page.setViewportSize(size);
      await page.evaluate(() => window.__lux.env.setWeather("clear"));
      await h.pause(600);
      const rect = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom }; }, sel);
      const pad = await rect(".pad"), gas = await rect("[data-btn=\"throttle\"]"), brake = await rect("[data-btn=\"brake\"]"), hb = await rect("[data-btn=\"handbrake\"]");
      h.expect(await page.evaluate(() => !document.querySelector("#touchControls").hidden), "the touch controls are visible");
      h.expect(gas.w >= BIG_PEDAL_PX && gas.h >= BIG_PEDAL_PX, `the gas pedal is big (${gas.w.toFixed(0)} px)`);
      h.expect(brake.w >= BIG_PEDAL_PX * 0.9 && hb.w >= MIN_TOUCH_PX, `the brake (${brake.w.toFixed(0)} px) and the handbrake (${hb.w.toFixed(0)} px) are finger-sized`);
      h.expect(pad.h >= MIN_TOUCH_PX * 1.5 && pad.w >= 200, `the steering pad is ${pad.w.toFixed(0)}x${pad.h.toFixed(0)} px`);
      const inside = [pad, gas, brake, hb].every((r) => r.l >= 0 && r.r <= size.width && r.t >= 0 && r.b <= size.height);
      h.expect(inside, "every control is on the screen");
      const apart = (a, b) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
      h.expect(apart(gas, brake) && apart(brake, hb) && apart(gas, hb) && apart(pad, brake), "the controls do not overlap each other");
      const hudBoxes = await page.evaluate(() => ["#minimap", "#speedo", "#limitSign"].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { s, l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
      h.expect(hudBoxes.every((b) => b.b < pad.t && b.b < gas.t), "the HUD (map, speed, limit) never sits on a control");

      const cdp = await h.context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pad.l + pad.w * 0.85, y: pad.y, id: 1 }, { x: gas.x, y: gas.y, id: 2 }] });
      await page.evaluate(() => window.simSeconds(window.__lux, 0.8));
      const both = await page.evaluate(() => { const m = window.__lux; m.input.read(); return { ...m.input.state }; });
      h.expect(both.throttle === 1 && both.steer > 0.5, `two fingers at once: gas ${both.throttle} and steering ${both.steer.toFixed(2)} (to the right)`);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pad.l + pad.w * 0.1, y: pad.y, id: 1 }, { x: brake.x, y: brake.y, id: 2 }, { x: hb.x, y: hb.y, id: 3 }] });
      await h.pause(250);
      const three = await page.evaluate(() => { const m = window.__lux; m.input.read(); return { ...m.input.state }; });
      h.expect(three.brake === 1 && three.handbrake === true && three.steer < -0.5, `three fingers: brake, handbrake and steering ${three.steer.toFixed(2)} (to the left)`);
      await h.shot(`touch-${size.width}`);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await h.pause(250);
      const rel = await page.evaluate(() => { const m = window.__lux; m.input.read(); return { ...m.input.state }; });
      h.expect(rel.throttle === 0 && rel.brake === 0 && rel.steer === 0 && !rel.handbrake, "every finger up: every control is released");
      const page0 = await page.evaluate(() => ({ sx: window.scrollX, sy: window.scrollY, scale: window.visualViewport ? window.visualViewport.scale : 1, ta: getComputedStyle(document.body).touchAction, meta: document.querySelector("meta[name=viewport]").content, over: getComputedStyle(document.documentElement).overflow }));
      h.expect(page0.sx === 0 && page0.sy === 0 && page0.scale === 1, "the page is not scrolled and not zoomed");
      h.expect(page0.ta === "none" && /user-scalable=no/.test(page0.meta) && page0.over === "hidden", "touch-action none, user-scalable=no, overflow hidden: the page cannot scroll or zoom");
    }
    await page.setViewportSize(SIZES[0]);

    h.step("the Kaart: the minimap, the full-screen map (M), street names, the car");
    await page.evaluate(() => window.__lux.car.reset(5924.1, 7901.9, -0.236));
    await page.keyboard.press("KeyM");
    await page.waitForSelector("#mapOverlay", { state: "visible" });
    await page.evaluate(() => window.simSeconds(window.__lux, 0.5));
    h.expect(await page.evaluate(() => window.__lux.fullMap.isOpen() && window.__lux.ui.isBlocking()), "the map is open and the car waits");
    await h.pause(800);
    await h.shot("map");
    const mapInfo = await page.evaluate(() => {
      const m = window.__lux, c = document.querySelector("#mapCanvas");
      return { w: c.clientWidth, h: c.clientHeight, zoom: m.fullMap.view.zoom, segments: m.roadIndex.segments.length, named: m.roadIndex.segments.filter((s) => s.name).length };
    });
    h.expect(mapInfo.w >= 1000 && mapInfo.h >= 700, `the map fills the screen (${mapInfo.w}x${mapInfo.h})`);
    h.expect(mapInfo.named > 10000, `${mapInfo.named} street segments carry a name`);
    // the map has the street names drawn: count dark text pixels is fragile, so ask the map itself for what it labelled
    h.step("tap on the map: the car goes to the road, onto the carriageway, facing along it");
    const taps = [], moves = [];
    for (const [fx, fy] of [[0.5, 0.55], [0.3, 0.4], [0.7, 0.62]]) {
      if (!(await page.evaluate(() => window.__lux.fullMap.isOpen()))) await page.keyboard.press("KeyM");        // a teleport closes the map
      await page.waitForSelector("#mapOverlay", { state: "visible" });
      await page.evaluate(() => window.simSeconds(window.__lux, 0.3));
      const from = await page.evaluate(() => { const s = window.__lux.state(); return { x: s.x, z: s.z }; });
      await page.mouse.click(1180 * fx, 820 * fy);
      await h.pause(300);
      moves.push(from);
      taps.push(await page.evaluate(() => {
        const m = window.__lux, s = m.state();
        const r = m.roadAt(s.x, s.z);
        const dir = r && r.dir ? Math.atan2(r.dir.z, r.dir.x) : null;
        let d = dir === null ? 9 : Math.abs(((s.heading - dir + Math.PI * 3) % (2 * Math.PI)) - Math.PI);
        d = Math.min(d, Math.PI - d);
        // a closed way (a square, a ring road) is an area: its "direction" depends on which side of it the car stands
        const pts = (m.roadIndex.nearest(s.x, s.z, 8) || { road: { pts: [] } }).road.pts;
        const closed = pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 12;
        return { closed, onRoad: !!r, lat: r ? r.lat : null, width: r ? r.width : null, alignedRad: d, mapOpen: m.fullMap.isOpen(), gap: s.y - m.ground.height(s.x, s.z), grounded: s.grounded, speed: s.speed };
      }));
    }
    for (const t of taps) {
      h.expect(t.onRoad && Math.abs(t.lat) <= t.width / 2, `teleport: on the carriageway (${t.lat === null ? "no road" : t.lat.toFixed(2)} m from the centre line of ${t.width ? t.width.toFixed(1) : "?"} m)`);
      h.expect(t.closed || t.alignedRad < 0.35, `teleport: facing along the road (${(t.alignedRad * 180 / Math.PI).toFixed(0)} deg off${t.closed ? ", a closed way: not checked" : ""})`);
      h.expect(!t.mapOpen && t.gap > 0.3 && t.gap < 0.7 && t.grounded && Math.abs(t.speed) < 0.5, "teleport: the map closed, the car stands on the ground and rolls slowly");
    }
    const ends = await page.evaluate(() => { const s = window.__lux.state(); return { x: s.x, z: s.z }; });
    const jumped = [...moves.slice(1), ends].map((p, i) => Math.hypot(p.x - moves[i].x, p.z - moves[i].z));
    h.expect(jumped.every((d) => d > 30), `every tap moved the car somewhere else (${jumped.map((d) => d.toFixed(0)).join(", ")} m)`);
    await h.shot("after-teleport");

    h.step("the quality auto-step: down when slow, never above the chosen quality, never back into a level that was too slow");
    const q = await page.evaluate(async () => {
      const { createQualityStepper } = await import("/pb/lux-drive/quality-step.js");
      const run = (s, seconds, dt) => { const out = []; for (let t = 0; t < seconds; t += dt) { const r = s.frame(dt); if (r) out.push(r); } return out; };
      const slow = createQualityStepper({ initial: "high", max: "high" });
      const down = run(slow, 20, 0.05);                                  // 20 fps for 20 s
      const fastHigh = createQualityStepper({ initial: "medium", max: "medium" });
      const noUp = run(fastHigh, 120, 0.01);                             // 100 fps for two minutes: never above the choice
      const up = createQualityStepper({ initial: "low", max: "high" });
      const climbs = run(up, 120, 0.01);
      const again = createQualityStepper({ initial: "high", max: "high" });
      const seq = [...run(again, 10, 0.05), ...run(again, 200, 0.008)];  // slow at high, then fast: it must not go back to high
      const pinned = createQualityStepper({ initial: "high", max: "high", enabled: false });
      const off = run(pinned, 60, 0.1);
      const hitch = createQualityStepper({ initial: "high", max: "high" });
      const hitches = run(hitch, 60, 0.5);                                // 0.5 s frames are hitches (a background tab): no step
      return { down, noUp, climbs, seq, off, hitches, level: slow.level };
    });
    h.eq(q.down, ["medium", "low"], "20 fps: high -> medium -> low, and no lower");
    h.eq(q.noUp, [], "a fast device at medium (chosen) stays at medium");
    h.eq(q.climbs, ["medium", "high"], "a fast device that was dropped climbs back up to the chosen level, one step at a time");
    h.expect(q.seq[0] === "medium" && !q.seq.includes("high"), `it does not climb back into a level that was too slow (${q.seq.join(" -> ")})`);
    h.eq(q.off, [], "a pinned quality (?q= in the URL) is never changed");
    h.eq(q.hitches, [], "hitches (a background tab) are not a trend");

    h.step("the car: wheels that turn and steer, lights, brake lights");
    await page.evaluate(() => { const m = window.__lux; m.env.setTime("night"); m.env.setWeather("clear"); });
    await page.evaluate(() => window.simSeconds(window.__lux, 4));
    const carInfo = await page.evaluate(() => {
      const m = window.__lux, car = m.car, mdl = m.model;
      car.reset(5924.1, 7901.9, -0.236);
      m.setInput(null);
      const DT = 1 / 60;
      const read = () => ({ spin: mdl.wheels.map((w) => w.tyre.rotation.z), yaw: mdl.wheels.map((w) => w.pivot.rotation.y) });
      const meshes = []; mdl.group.traverse((o) => { if (o.isMesh) meshes.push(o.name); });
      const colour = (name) => { let c = null; mdl.group.traverse((o) => { if (o.name === name) c = o.material.color.getHex(); }); return c; };
      // roll on at 30 km/h and steer right
      car.state.vx = Math.cos(-0.236) * 8.3; car.state.vz = Math.sin(-0.236) * 8.3;
      for (let i = 0; i < 20; i++) car.update(DT, { throttle: 0.3, steer: 1, gripScale: 1, limitKmh: 50 });
      mdl.apply(car.state, DT, { head: window.__lux.env.state.lamp, night: window.__lux.env.state.night });
      const a = read();
      for (let i = 0; i < 20; i++) car.update(DT, { throttle: 0.3, steer: 1, gripScale: 1, limitKmh: 50 });
      mdl.apply(car.state, DT, { head: window.__lux.env.state.lamp, night: window.__lux.env.state.night });
      const b = read();
      const tailRolling = colour("car-taillamps");
      for (let i = 0; i < 30; i++) car.update(DT, { brake: 1, gripScale: 1, limitKmh: 50 });
      const braking = car.state.braking;
      mdl.apply(car.state, DT, { head: window.__lux.env.state.lamp, night: window.__lux.env.state.night });
      const tailBraking = colour("car-taillamps");
      return { meshes, spinMoved: b.spin.map((v, i) => Math.abs(v - a.spin[i])), yaw: b.yaw, braking, tailRolling, tailBraking, head: colour("car-headlamps"), night: m.env.state.night, lamp: m.env.state.lamp };
    });
    h.expect(carInfo.meshes.filter((n) => n === "car-wheel").length === 4, "four wheels");
    h.expect(carInfo.spinMoved.every((v) => v > 0.2), `all four wheels turn (${carInfo.spinMoved.map((v) => v.toFixed(2)).join(", ")} rad)`);
    h.expect(carInfo.yaw[0] < -0.05 && carInfo.yaw[1] < -0.05 && carInfo.yaw[2] === 0 && carInfo.yaw[3] === 0, `the front wheels steer to the right, the rear ones do not (${carInfo.yaw.map((v) => v.toFixed(2)).join(", ")})`);
    h.expect(carInfo.braking && carInfo.tailBraking !== carInfo.tailRolling, "the brake lights light up when braking");
    h.expect(carInfo.lamp > 0.5, `the headlights are on at night (${carInfo.lamp.toFixed(2)})`);
    h.expect(carInfo.meshes.length <= 12, `the car is ${carInfo.meshes.length} draw calls`);
    await page.evaluate(() => window.simSeconds(window.__lux, 0.5));
    await h.shot("car-night");
    await page.evaluate(() => window.__lux.env.setTime("noon"));

    h.step("the handling: no spinning, no flipping, the brake reverses, the limit sets the pace");
    const hand = await page.evaluate(() => {
      const m = window.__lux, car = m.car;
      const DT = 1 / 60;
      const at = (kmh) => { car.reset(5924.1, 7901.9, -0.236); car.state.vx = Math.cos(-0.236) * kmh / 3.6; car.state.vz = Math.sin(-0.236) * kmh / 3.6; car.update(DT, {}); };
      const out = { turn: {}, tilt: 0 };
      for (const v of [30, 50, 90]) {
        at(v); const h0 = car.state.heading; let maxYaw = 0, prev = h0;
        for (let i = 0; i < 120; i++) {
          car.update(DT, { throttle: 0.3, steer: 1, gripScale: 1, limitKmh: 90 });
          maxYaw = Math.max(maxYaw, Math.abs(car.state.heading - prev) / DT); prev = car.state.heading;
          out.tilt = Math.max(out.tilt, Math.abs(car.state.roll), Math.abs(car.state.pitch), Math.abs(car.state.lean), Math.abs(car.state.squat));
        }
        out.turn[v] = { deg: (car.state.heading - h0) * 180 / Math.PI, maxYaw, kmh: Math.abs(car.state.speed) * 3.6 };
      }
      at(60); const h1 = car.state.heading; let slip = 0;
      for (let i = 0; i < 90; i++) { car.update(DT, { steer: 0.8, handbrake: i > 10 && i < 60, gripScale: 1, limitKmh: 90 }); slip = Math.max(slip, car.state.slip); }
      out.drift = { deg: (car.state.heading - h1) * 180 / Math.PI, slip, kmh: Math.abs(car.state.speed) * 3.6 };
      // reverse: from a standstill the brake pedal drives the car backwards
      car.reset(5924.1, 7901.9, -0.236); const x0 = car.state.x, z0 = car.state.z;
      for (let i = 0; i < 180; i++) car.update(DT, { brake: 1, gripScale: 1, limitKmh: 50 });
      out.reverse = { m: Math.hypot(car.state.x - x0, car.state.z - z0), speed: car.state.speed };
      // the limit sets the pace: full throttle on a road of 50 km/h tops out well below the motorway speed
      car.reset(5924.1, 7901.9, -0.236); let top = 0;
      for (let i = 0; i < 60 * 14; i++) { car.update(DT, { throttle: 1, gripScale: 1, limitKmh: 50 }); top = Math.max(top, car.state.speed * 3.6); if (i > 120 && Math.abs(car.state.speed) < 0.3) break; }
      out.top50 = top;
      // braking: dry and wet
      out.brake = {};
      for (const [name, g] of [["dry", 1], ["wet", 0.72]]) { at(50); const x = car.state.x, z = car.state.z; let i = 0; for (; i < 600 && Math.abs(car.state.speed) > 0.3; i++) car.update(DT, { brake: 1, gripScale: g }); out.brake[name] = Math.hypot(car.state.x - x, car.state.z - z); }
      return out;
    });
    for (const v of [30, 50, 90]) h.expect(hand.turn[v].maxYaw < 1.6 && hand.turn[v].kmh > v * 0.7, `full lock at ${v} km/h: ${hand.turn[v].deg.toFixed(0)} deg in 2 s, yaw rate at most ${hand.turn[v].maxYaw.toFixed(2)} rad/s, ${hand.turn[v].kmh.toFixed(0)} km/h after: no spin`);
    h.expect(hand.turn[90].maxYaw < hand.turn[30].maxYaw, "the steering gets calmer with speed");
    h.expect(hand.tilt < 0.4, `the body never tilts more than ${(hand.tilt * 180 / Math.PI).toFixed(0)} degrees: no flipping`);
    h.expect(hand.drift.slip > 0.2 && hand.drift.kmh > 10, `the handbrake starts a slide (${hand.drift.slip.toFixed(2)}) and the car keeps rolling (${hand.drift.kmh.toFixed(0)} km/h)`);
    h.expect(hand.reverse.m > 3 && hand.reverse.speed < -1, `the brake reverses the car from a standstill (${hand.reverse.m.toFixed(1)} m in 3 s)`);
    h.expect(hand.top50 > 40 && hand.top50 < 100, `a street of 50 km/h tops out at ${hand.top50.toFixed(0)} km/h`);
    h.expect(hand.brake.wet > hand.brake.dry * 1.15 && hand.brake.dry < 14, `braking from 50 km/h: ${hand.brake.dry.toFixed(1)} m dry, ${hand.brake.wet.toFixed(1)} m wet`);

    h.step("stuck against a wall: the pedal is down, the car does not move -> it is put back on the road");
    const stuck = await page.evaluate(async () => {
      const m = window.__lux, car = m.car;
      // a house wall near the start with free ground in front of it
      const start = { x: 5924, z: 7901 };
      const b = m.buildings.buildings.find((q) => Math.hypot(q.pts[0] - start.x, q.pts[1] - start.z) < 300 && q.pts.length >= 8 && (() => {
        const n = q.pts.length / 2; return Array.from({ length: n }, (_, e) => e).some((e) => { const ax = q.pts[e * 2], az = q.pts[e * 2 + 1], bx = q.pts[((e + 1) % n) * 2], bz = q.pts[((e + 1) % n) * 2 + 1]; return Math.hypot(bx - ax, bz - az) > 10; });
      })());
      if (!b) return { found: false };
      const n = b.pts.length / 2;
      for (let e = 0; e < n; e++) {
        const ax = b.pts[e * 2], az = b.pts[e * 2 + 1], bx = b.pts[((e + 1) % n) * 2], bz = b.pts[((e + 1) % n) * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az); if (L < 10) continue;
        let nx = -(bz - az) / L, nz = (bx - ax) / L; const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (m.buildings.collide(mx + nx * 2, mz + nz * 2, 0.5)) { nx = -nx; nz = -nz; }
        if (m.collide(mx + nx * 3, mz + nz * 3, 1.5) || m.collide(mx + nx * 8, mz + nz * 8, 1.5) || !m.roadIndex.nearest(mx, mz, 60)) continue;
        const heading = Math.atan2(-nz, -nx);
        car.reset(mx + nx * 4, mz + nz * 4, heading);
        m.setInput({ throttle: 1, brake: 0, steer: 0, handbrake: false });
        const t0 = m.clock();
        let pushedFor = 0, moved = false, wedged = null;
        while (m.clock() - t0 < 9) {
          await new Promise((r) => requestAnimationFrame(r));
          const s = m.state(), t = m.clock() - t0;
          if (!wedged && t > 2.5) wedged = { x: s.x, z: s.z };                       // by now the car has hit the wall and stands there
          if (wedged && Math.hypot(s.x - wedged.x, s.z - wedged.z) > 2.5) { moved = true; pushedFor = t; break; }
        }
        m.setInput(null);
        const s = m.state(), road = m.roadAt(s.x, s.z);
        return { found: true, moved, seconds: pushedFor, onRoad: !!road && Math.abs(road.lat) <= road.width / 2, wallDist: (s.x - mx) * nx + (s.z - mz) * nz };
      }
      return { found: false };
    });
    h.expect(stuck.found, "a house wall with free ground in front of it was found");
    if (stuck.found) {
      h.expect(stuck.moved && stuck.seconds > 3, `the wedged car was moved after ${stuck.seconds.toFixed(1)} s of pushing`);
      h.expect(stuck.onRoad, "and it stands on a carriageway again");
    }

    h.eq(errors, [], "zero console errors in the whole flow");
  },
};

runIfMain(import.meta.url, flow);
