/* Flow: Lux Drive round 2 - the Kaart taps onto car roads only, the sound, the help text, the chase camera, the auto-step in the
 * real loop and the cost of the three quality levels.
 *
 * Like the other lux-drive flows every loop is counted in GAME seconds (window.__lux.clock()), so a cloud container that draws three
 * frames a second gives the same answer as a Mac.  The auto-step test replaces requestAnimationFrame's timestamps with a fake
 * slow clock (35 / 60 ms per frame): software GL cannot be slow in a controlled way, a fake clock can. */
import fs from "node:fs";
import path from "node:path";
import { runIfMain, REPO } from "./lib.mjs";

const PAGE = "/pb/lux-drive.html?q=low&time=noon&weather=clear";
const CAR_KINDS = ["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service", "road"];
const NOT_CAR = ["footway", "pedestrian", "steps", "path", "cycleway", "track", "bridleway", "busway"];
const BUDGET = { low: { calls: 80, tris: 200000 }, medium: { calls: 140, tris: 380000 }, high: { calls: 200, tris: 600000 } };
const SIM_HELPERS = `window.simSeconds = async (m, secs, each) => {
  const t0 = m.clock();
  for (let g = 0; m.clock() - t0 < secs && g < 6000; g++) { await new Promise((r) => requestAnimationFrame(r)); if (each) each(); }
};`;

async function boot(h, url = PAGE) {
  await h.goto(url);
  await h.page.waitForFunction(() => document.documentElement.dataset.luxReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 240000 });
  await h.page.waitForSelector("#start [data-act=\"drive\"]", { state: "visible", timeout: 60000 });
}

export const flow = {
  name: "luxdrive-round2",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(SIM_HELPERS);
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.addInitScript(() => { try { if (!sessionStorage.getItem("keepStorage")) localStorage.clear(); sessionStorage.setItem("keepStorage", "1"); } catch (error) { /* blocked */ } });

    // ---------------------------------------------------------------- 1. the Kaart: car roads only
    h.step("boot: no sound before the first tap or key (iOS), then the first tap starts it");
    await boot(h);
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "no boot error");
    const before = await page.evaluate(() => window.__lux.sound.debug());
    h.eq(before.state, "none", "no AudioContext before the first gesture");
    await page.click("#start [data-act=\"drive\"]");
    await page.evaluate(() => window.simSeconds(window.__lux, 0.5));
    const after = await page.evaluate(() => window.__lux.sound.debug());
    h.expect(after.state === "running", `the first tap started the audio (${after.state})`);

    h.step("the start and the reset stand on a CAR road (Avenue John F. Kennedy), not on the plaza beside it");
    const roadNow = () => page.evaluate((cars) => {
      const m = window.__lux, s = m.state(), r = m.roadAt(s.x, s.z);
      return { name: r ? r.name : null, kind: r ? r.kind : null, car: !!r && cars.includes(r.kind), x: s.x, z: s.z };
    }, CAR_KINDS);
    const first = await roadNow();
    h.expect(first.car, `the start is on a car road (${first.kind}: ${first.name})`);
    h.eq(first.name, "Avenue John F. Kennedy", "the start is on Avenue John F. Kennedy");
    await page.evaluate(() => window.__lux.teleportNear(5038, 8784, 400));          // somewhere else in the city
    await page.keyboard.press("KeyR");
    await page.evaluate(() => window.simSeconds(window.__lux, 0.3));
    const reset = await roadNow();
    h.expect(reset.car && reset.name === "Avenue John F. Kennedy", `R puts the car back on Avenue John F. Kennedy (${reset.kind}: ${reset.name})`);
    h.expect(Math.hypot(reset.x - first.x, reset.z - first.z) < 40, `... close to the start (${Math.hypot(reset.x - first.x, reset.z - first.z).toFixed(0)} m)`);

    h.step("a tap on Place de l'Europe lands on Avenue John F. Kennedy; a tap on a footway, steps, path, cycleway, track, pedestrian way lands on a car road");
    // the square beside the start: taps on the paving round the start place (Place de l'Europe) must find the avenue, not a path
    const around = await page.evaluate(() => {
      const m = window.__lux, s0 = m.roadIndex.nearest(5924, 7901, 60), out = [];
      for (const [dx, dz] of [[0, 0], [12, -8], [-14, 6], [6, 14], [-8, -12]]) {
        const hit = m.roadIndex.nearest(5924 + dx, 7901 + dz, 60);
        out.push(hit ? `${hit.road.name}/${hit.road.kind}` : "none");
      }
      return { first: s0 && s0.road.name, out };
    });
    h.expect(around.out.every((n) => !/footway|pedestrian|steps|path|cycleway|track|bridleway|none/.test(n.split("/")[1] || "none")), `5 taps round Place de l'Europe: ${around.out.join(" | ")}`);
    h.eq(around.out[0].split("/")[0], "Avenue John F. Kennedy", "a tap on Place de l'Europe lands on Avenue John F. Kennedy");
    await page.evaluate(() => window.__lux.teleportNear(5924, 7901, 60));
    await page.evaluate(() => window.simSeconds(window.__lux, 0.3));
    const landed = await roadNow();
    h.expect(landed.car && landed.name === "Avenue John F. Kennedy", `the car stands on ${landed.name} (${landed.kind})`);
    const probes = await page.evaluate((notCar) => {
      const m = window.__lux, out = [];
      for (const kind of notCar) {
        const list = m.roadIndex.segments.filter((s) => s.road.kind === kind && s.road.info.drivable !== undefined);
        // spread the samples over the city: every Nth segment, the first three that have a car road within 80 m
        const step = Math.max(1, Math.floor(list.length / 60));
        let found = 0;
        for (let i = 0; i < list.length && found < 2; i += step) {
          const s = list[i], x = (s.ax + s.bx) / 2, z = (s.az + s.bz) / 2;
          if (x < 2500 || x > 11000 || z < 4500 || z > 11000) continue;           // the city and the communes round it
          const hit = m.roadIndex.nearest(x, z, 80);
          if (!hit) continue;
          out.push({ kind, x, z, name: s.name });
          found += 1;
        }
      }
      return out;
    }, NOT_CAR);
    h.expect(probes.length >= 6, `${probes.length} taps on non-car roads (${[...new Set(probes.map((p) => p.kind))].join(", ")})`);
    const bad = [];
    for (const p of probes) {
      await page.evaluate(([x, z]) => window.__lux.teleportNear(x, z, 80), [p.x, p.z]);
      await page.evaluate(() => window.simSeconds(window.__lux, 0.15));
      const r = await roadNow();
      if (!r.car) bad.push(`${p.kind} ${p.name || ""} -> ${r.kind}`);
    }
    h.eq(bad, [], "every tap on a footway / pedestrian / steps / path / cycleway / track / bridleway ended on a car road");
    const unstuck = await page.evaluate((cars) => {
      const m = window.__lux; let wrong = 0, n = 0;
      for (let i = 0; i < 300; i++) {
        const x = 3500 + ((i * 7919) % 5500), z = 6000 + ((i * 104729) % 4000);
        const hit = m.roadIndex.nearest(x, z, 150);
        if (!hit) continue;
        n += 1; if (!cars.includes(hit.road.kind)) wrong += 1;
      }
      return { wrong, n };
    }, CAR_KINDS);
    h.expect(unstuck.n > 100 && unstuck.wrong === 0, `300 random taps: ${unstuck.n} found a road, ${unstuck.wrong} of them not a car road`);

    // ---------------------------------------------------------------- 2. the sound
    h.step("sound: the engine follows the speed (rpm and gear), the squeal follows the slip, a collision thuds, the rain is heard");
    await page.keyboard.press("KeyR");
    await page.evaluate(() => window.simSeconds(window.__lux, 0.5));
    const idle = await page.evaluate(() => window.__lux.sound.debug());
    h.expect(idle.rpm < 1200 && idle.gear === 1, `idle: ${idle.rpm.toFixed(0)} rpm in gear ${idle.gear}`);
    const drive = await page.evaluate(async () => {
      const m = window.__lux; const samples = [];
      m.setInput({ throttle: 1, brake: 0, steer: 0 });
      await window.simSeconds(m, 9, () => { const d = m.sound.debug(), s = m.state(); samples.push({ rpm: d.rpm, gear: d.gear, speed: s.speed, load: d.load, level: d.level, state: d.state }); });
      m.setInput(null);
      return samples;
    });
    const gears = [...new Set(drive.map((s) => s.gear))];
    const maxRpm = Math.max(...drive.map((s) => s.rpm));
    const peak = Math.max(...drive.map((s) => s.level));
    h.expect(maxRpm > 3000 && maxRpm < 6300, `full throttle: the revs climb to ${maxRpm.toFixed(0)} rpm`);
    h.expect(gears.length >= 2, `the gearbox changes up (gears ${gears.join(", ")})`);
    h.expect(drive.some((s, i) => i > 0 && s.gear > drive[i - 1].gear && s.rpm < drive[i - 1].rpm - 200), "a gear change drops the revs");
    h.expect(peak > 0.01, `the output is not silent (peak ${peak.toFixed(3)})`);
    const squeal = await page.evaluate(async () => {
      const m = window.__lux; let top = 0, topSlip = 0;
      m.setInput({ throttle: 1, brake: 0, steer: 0 });
      await window.simSeconds(m, 5);
      m.setInput({ throttle: 0.6, brake: 0, steer: 1, handbrake: true });
      await window.simSeconds(m, 2.5, () => { const d = m.sound.debug(); top = Math.max(top, d.squeal); topSlip = Math.max(topSlip, m.state().slip); });
      m.setInput(null);
      return { top, topSlip };
    });
    h.expect(squeal.top > 0.2, `the squeal rises with the slip (slip ${squeal.topSlip.toFixed(2)} -> squeal ${squeal.top.toFixed(2)})`);
    const thud = await page.evaluate(async () => {
      const m = window.__lux;
      const s = m.state();
      // aim the car at the nearest house: 16 m out along the line to its footprint, speed 12 m/s towards it
      let target = null, best = 1e9;
      for (const b of m.buildings.buildings) { const p = [b.pts[0], b.pts[1]]; const d = Math.hypot(p[0] - s.x, p[1] - s.z); if (d > 25 && d < best && d < 160) { best = d; target = p; } }
      if (!target) return { skipped: true };
      const dx = target[0] - s.x, dz = target[1] - s.z, len = Math.hypot(dx, dz);
      const heading = Math.atan2(dz, dx);
      m.car.reset(target[0] - (dx / len) * 12, target[1] - (dz / len) * 12, heading);
      const st = m.state();
      st.vx = Math.cos(heading) * 13; st.vz = Math.sin(heading) * 13; st.speed = 13;
      const hits0 = st.hits, thuds0 = m.sound.debug().thuds;
      for (let i = 0; i < 90; i++) m.step(1 / 60, { throttle: 0, brake: 0, steer: 0 });
      await window.simSeconds(m, 0.4);
      return { hits: st.hits - hits0, thuds: m.sound.debug().thuds - thuds0, speed: st.lastHitSpeed };
    });
    if (thud.skipped) h.expect(false, "a house was found to crash into");
    else {
      h.expect(thud.hits >= 1, `the car counted ${thud.hits} hit(s) (${thud.speed.toFixed(1)} m/s into the wall)`);
      h.expect(thud.thuds >= 1, `the hit made ${thud.thuds} thud(s)`);
    }
    await page.keyboard.press("KeyR");
    await page.evaluate(() => window.__lux.env.setWeather("rain"));
    const rain = await page.evaluate(async () => {
      const m = window.__lux; await window.simSeconds(m, 3);
      return { rain: m.sound.debug().rain, level: m.sound.debug().level };
    });
    h.expect(rain.rain > 0.5, `rain: the ambience level follows the weather (${rain.rain.toFixed(2)})`);
    await page.evaluate(() => window.__lux.env.setWeather("clear"));

    h.step("sound: mute in the settings, remembered after a reload");
    await page.keyboard.press("Escape");
    await page.click("#pause [data-act=\"settings\"]");
    h.expect(await page.evaluate(() => !!document.querySelector("#settings [data-group=\"sound\"]")), "the settings have a sound switch");
    await page.click("#settings [data-group=\"sound\"][data-value=\"off\"]");
    await page.evaluate(() => window.simSeconds(window.__lux, 0.1));
    const muted = await page.evaluate(async () => {
      const m = window.__lux; await new Promise((r) => setTimeout(r, 400));
      let lvl = 0; for (let i = 0; i < 6; i++) { lvl = Math.max(lvl, m.sound.debug().level); await new Promise((r) => setTimeout(r, 60)); }
      return { muted: m.sound.muted, level: lvl, stored: localStorage.getItem("pb_luxdrive_sound") };
    });
    h.expect(muted.muted && muted.stored === "off" && muted.level < 0.005, `muted: stored "${muted.stored}", output level ${muted.level.toFixed(4)}`);
    await boot(h);
    const reloaded = await page.evaluate(() => ({ muted: window.__lux.sound.muted, pressed: document.querySelector("#settings [data-group=\"sound\"][aria-pressed=\"true\"]").dataset.value }));
    h.expect(reloaded.muted && reloaded.pressed === "off", "after a reload the sound is still off and the chip says so");
    await page.evaluate(() => { localStorage.setItem("pb_luxdrive_sound", "on"); });

    h.step("the help text names every real key binding (M is the Kaart)");
    const input = fs.readFileSync(path.join(REPO, "pb/lux-drive/input.js"), "utf8");
    const actionKeys = [...input.matchAll(/Key([A-Z]): '(\w+)'/g)].map((m) => ({ key: m[1], action: m[2] }));
    const helpTexts = await page.evaluate(async () => {
      const { t, LANGS } = await import("/pb/lux-drive/i18n.js");
      return LANGS.map((l) => ({ l, other: t(l, "help.other"), drive: t(l, "help.drive"), map: t(l, "map.title") }));
    });
    h.expect(actionKeys.length >= 6, `${actionKeys.length} letter bindings read from input.js (${actionKeys.map((k) => k.key + "=" + k.action).join(" ")})`);
    const missing = [];
    for (const { l, other, drive: d } of helpTexts) {
      for (const { key } of actionKeys) if (key !== "P" && !new RegExp(`(^|[ ·])${key} `).test(other)) missing.push(`${l}: ${key}`);
      if (!/Esc|Échap/.test(other)) missing.push(`${l}: Esc`);
      for (const k of ["W", "S", "A D"]) if (!d.includes(k)) missing.push(`${l}: ${k}`);
      if (!/M \S*/.test(other)) missing.push(`${l}: M`);
    }
    h.eq(missing, [], "every key of input.js is in the help text in all four languages");
    h.expect(helpTexts.every(({ other, map }) => other.includes(`M ${map.toLowerCase()}`) || other.includes(`M ${map}`) || /M (Kaart|Karte|map|carte)/.test(other)), "M is described as the map / Kaart");

    // ---------------------------------------------------------------- 3. the chase camera
    h.step("chase camera: never inside a house or a tree in narrow streets");
    await page.evaluate(() => { const m = window.__lux; if (m.ui.isBlocking()) { m.ui.closeOverlays(); } m.startDriving(); });
    const narrow = await page.evaluate(() => {
      const m = window.__lux, out = [];
      // a narrow street: a car road with a house on both sides within 5 m of the centre line
      const cars = ["residential", "living_street", "tertiary", "unclassified", "service"];
      const segs = m.roadIndex.segments.filter((s) => cars.includes(s.road.kind) && Math.hypot(s.bx - s.ax, s.bz - s.az) > 12);
      const area = (x, z) => x > 3500 && x < 7500 && z > 7000 && z < 10200;
      for (let i = 0; i < segs.length && out.length < 6; i += 3) {
        const s = segs[i], len = Math.hypot(s.bx - s.ax, s.bz - s.az), ux = (s.bx - s.ax) / len, uz = (s.bz - s.az) / len;
        const x = (s.ax + s.bx) / 2, z = (s.az + s.bz) / 2;
        if (!area(x, z)) continue;
        const left = m.buildings.collide(x + uz * 5.5, z - ux * 5.5, 1.5), right = m.buildings.collide(x - uz * 5.5, z + ux * 5.5, 1.5);
        if (left && right) out.push({ x, z, name: s.name, heading: Math.atan2(uz, ux) });
      }
      return out;
    });
    h.expect(narrow.length >= 3, `${narrow.length} narrow streets found (${narrow.map((n) => n.name || "?").join(", ")})`);
    let minBoom = 99, insideHouse = 0, insideTree = 0, frames = 0;
    for (const n of narrow.slice(0, 4)) {
      await page.evaluate(([x, z]) => window.__lux.teleportNear(x, z, 30), [n.x, n.z]);
      const r = await page.evaluate(async () => {
        const m = window.__lux, THREE = window.THREE;
        let minB = 99, house = 0, tree = 0, n = 0;
        m.setInput({ throttle: 0.55, brake: 0, steer: 0 });
        await window.simSeconds(m, 7, () => {
          const c = m.camera.position, s = m.state();
          n += 1;
          minB = Math.min(minB, Math.hypot(c.x - s.x, c.z - s.z));
          if (m.buildings.collide(c.x, c.z, 0.3)) house += 1;
          if (m.forest.collide(c.x, c.z, 0.3)) tree += 1;
        });
        m.setInput(null);
        return { minB, house, tree, n };
      });
      minBoom = Math.min(minBoom, r.minB); insideHouse += r.house; insideTree += r.tree; frames += r.n;
      await h.shot(`narrow-${narrow.indexOf(n)}`);
    }
    // the hard case: the car stands across the street, so the boom points straight into the houses behind it
    let crossInside = 0, crossShort = 0;
    for (const n of narrow.slice(0, 4)) {
      await page.evaluate(([x, z]) => window.__lux.teleportNear(x, z, 30), [n.x, n.z]);
      const r = await page.evaluate(async (heading) => {
        const m = window.__lux, s = m.state();
        m.car.reset(s.x, s.z, heading + Math.PI / 2);
        m.setCamera(null);
        let house = 0, tree = 0, minB = 99;
        await window.simSeconds(m, 2.5, () => { const c = m.camera.position, st = m.state(); if (m.buildings.collide(c.x, c.z, 0.3)) house += 1; if (m.forest.collide(c.x, c.z, 0.3)) tree += 1; minB = Math.min(minB, Math.hypot(c.x - st.x, c.z - st.z)); });
        return { house: house + tree, minB };
      }, n.heading);
      crossInside += r.house; if (r.minB < 6.5) crossShort += 1;
    }
    h.eq(crossInside, 0, "car across a narrow street (boom into the houses): the camera was never inside a house or tree");
    h.expect(crossShort >= 1, `... because the boom was pulled in (${crossShort} of 4 streets shorter than 6.5 m)`);
    h.eq(insideHouse, 0, `${frames} frames in narrow streets: the camera was never inside a house`);
    h.eq(insideTree, 0, "... and never inside a tree");
    h.expect(minBoom >= 2.0, `... and never closer than ${minBoom.toFixed(1)} m to the car (the car does not fill the lens)`);

    h.step("chase camera: a street with trees close to the kerb");
    const treeRoad = await page.evaluate(() => {
      const m = window.__lux, out = [];
      const segs = m.roadIndex.segments.filter((s) => ["residential", "tertiary", "secondary", "primary", "unclassified"].includes(s.road.kind) && Math.hypot(s.bx - s.ax, s.bz - s.az) > 20);
      for (let i = 0; i < segs.length && out.length < 3; i += 2) {
        const s = segs[i], x = (s.ax + s.bx) / 2, z = (s.az + s.bz) / 2;
        const len = Math.hypot(s.bx - s.ax, s.bz - s.az), ux = (s.bx - s.ax) / len, uz = (s.bz - s.az) / len;
        let n = 0;
        for (let t = -10; t <= 10; t += 2) if (m.forest.collide(x + ux * t, z + uz * t, 4.5)) n += 1;
        if (n >= 4) out.push({ x, z, heading: Math.atan2(uz, ux), n });
      }
      return out;
    });
    h.expect(treeRoad.length >= 1, `${treeRoad.length} tree-lined road stretches found`);
    let treeHits = 0, treeFrames = 0;
    for (const n of treeRoad) {
      await page.evaluate(([x, z]) => window.__lux.teleportNear(x, z, 30), [n.x, n.z]);
      const r = await page.evaluate(async () => {
        const m = window.__lux; let tree = 0, house = 0, f = 0;
        m.setInput({ throttle: 0.5, brake: 0, steer: 0 });
        await window.simSeconds(m, 6, () => { const c = m.camera.position; f += 1; if (m.forest.collide(c.x, c.z, 0.3)) tree += 1; if (m.buildings.collide(c.x, c.z, 0.3)) house += 1; });
        m.setInput(null);
        return { tree: tree + house, f };
      });
      treeHits += r.tree; treeFrames += r.f;
    }
    h.eq(treeHits, 0, `${treeFrames} frames on tree-lined roads: the camera never sat inside a trunk`);

    h.step("chase camera: never under (or on top of) the deck of a bridge the car drives under");
    const under = await page.evaluate(() => {
      const m = window.__lux, out = [];
      for (const d of m.ground.decks) {
        if (d.pts.length < 2 || d.width < 5) continue;
        for (let i = 0; i + 1 < d.pts.length && out.length < 5; i++) {
          const x = (d.pts[i][0] + d.pts[i + 1][0]) / 2, z = (d.pts[i][1] + d.pts[i + 1][1]) / 2;
          const g = m.surface.height(x, z), top = (d.tops[i] + d.tops[i + 1]) / 2;
          if (top - g < 4.5) continue;
          m.surface.roadInfoAt(x, z, m.__info || (m.__info = { coverage: 0, lat: 0, hw: 0, a0: 0, kind: 0, surface: 0, road: -1, lines: 0, lanes: 0, s: 0 }));
          if (m.__info.coverage > 0.6 && m.__info.road >= 0 && m.roadIndex.nearest(x, z, 4)) out.push({ x, z, top, g });
        }
        if (out.length >= 5) break;
      }
      return out;
    });
    h.expect(under.length >= 1, `${under.length} roads under a bridge found`);
    let deckBad = 0, deckFrames = 0, deckSeen = 0;
    for (const u of under.slice(0, 3)) {
      const placed = await page.evaluate(([x, z]) => window.__lux.teleportNear(x, z, 6), [u.x, u.z]);
      if (!placed) continue;
      const r = await page.evaluate(async () => {
        const m = window.__lux; let bad = 0, f = 0, seen = 0;
        m.setInput({ throttle: 0.5, brake: 0, steer: 0 });
        await window.simSeconds(m, 8, () => {
          const c = m.camera.position, s = m.state();
          f += 1;
          const ceiling = m.ground.overheadAt(c.x, c.z, s.y + 0.4);
          if (Number.isFinite(ceiling)) { seen += 1; if (c.y > ceiling - 0.05) bad += 1; }
        });
        m.setInput(null);
        return { bad, f, seen };
      });
      deckBad += r.bad; deckFrames += r.f; deckSeen += r.seen;
    }
    h.eq(deckBad, 0, `${deckFrames} frames near bridges (${deckSeen} with a deck over the camera): the lens was never above the underside of a deck`);

    // ---------------------------------------------------------------- 4. the auto-step in the real loop
    h.step("auto-step: slow frames drop the game to low within a few seconds (fake slow clock in the real loop)");
    for (const frameMs of [35, 60]) {
      await page.addInitScript(() => { try { localStorage.setItem("pb_luxdrive_quality", "high"); } catch (error) { /* blocked */ } });
      await boot(h, "/pb/lux-drive.html?time=noon&weather=clear");                // no q=: the stepper is on
      await page.click("#start [data-act=\"drive\"]");
      await page.evaluate(() => window.simSeconds(window.__lux, 1));
      const r = await page.evaluate(async (ms) => {
        const m = window.__lux; const steps = [];
        const orig = window.requestAnimationFrame.bind(window);
        let fake = performance.now();
        window.requestAnimationFrame = (cb) => orig(() => { fake += ms; cb(fake); });
        const t0 = m.clock();
        let level = m.quality().id;
        const start = level;
        await window.simSeconds(m, 20, () => { const q = m.quality().id; if (q !== level) { level = q; steps.push({ q, t: m.clock() - t0 }); } });
        return { start, steps, final: m.quality().id };
      }, frameMs);
      h.eq(r.start, "high", `${frameMs} ms frames: the game starts at high`);
      h.eq(r.final, "low", `${frameMs} ms frames: it ends at low (${r.steps.map((s) => `${s.q} after ${s.t.toFixed(1)} s`).join(", ")})`);
      const lowAt = (r.steps.find((s) => s.q === "low") || { t: 99 }).t;
      h.expect(lowAt <= (frameMs >= 50 ? 7 : 10), `${frameMs} ms frames: low after ${lowAt.toFixed(1)} game seconds (<= ${frameMs >= 50 ? 7 : 10})`);
    }
    await page.addInitScript(() => { try { localStorage.removeItem("pb_luxdrive_quality"); } catch (error) { /* blocked */ } });

    // ---------------------------------------------------------------- 5. the cost of the three levels at Kirchberg
    h.step("draw calls and triangles at low / medium / high at Kirchberg (the start place)");
    for (const q of ["low", "medium", "high"]) {
      await boot(h, `/pb/lux-drive.html?q=${q}&time=noon&weather=clear`);
      await page.click("#start [data-act=\"drive\"]");
      const s = await page.evaluate(async () => {
        const m = window.__lux;
        for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 400)); const st = m.stats(); if (i > 4 && st.pending === 0 && st.cityPending === 0) break; }
        await window.simSeconds(m, 1.5);
        return { calls: m.stats().calls, tris: m.stats().triangles, tiles: m.stats().tiles };
      });
      console.log(`    ${q}: ${s.calls} draw calls, ${s.tris} triangles, ${s.tiles} terrain tiles`);
      h.expect(s.calls <= BUDGET[q].calls, `${q}: ${s.calls} draw calls (<= ${BUDGET[q].calls})`);
      h.expect(s.tris <= BUDGET[q].tris, `${q}: ${s.tris} triangles (<= ${BUDGET[q].tris})`);
    }
    h.eq(errors.filter((e) => !/favicon|404/.test(e)), [], "zero console errors in the whole flow");
  },
};

runIfMain(import.meta.url, flow);
