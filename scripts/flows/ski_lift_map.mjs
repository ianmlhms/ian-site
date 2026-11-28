/* Flow: Ski Alpen, the piste map WHILE riding a lift (28 Nov 2026; Ian: "like in reality you look at the map on the lift to plan where
 * to go at the top"). Free ride, every kind of lift:
 *   button   the ride panel has a big "Kaart" button (touch), M / Esc work too; ☰ is the pause menu as before
 *   overlay  the map opens over the ride: the lift does NOT stop (game.screen stays 'ski', the ride keeps its time), the marker moves along
 *            the lift, the lift is highlighted, the top station is "Hei kënns du un", the pistes that start there stand out
 *   no jump  closing it gives the same camera as if it had never been open (no cut); the HUD is there again
 *   teleport a tap on the ground says "Teleportéieren geet net, wärend s de um Lift bass" and nothing moves
 *   arrival  the ride ends while the map is open: the map closes, he stands at the top as always
 *   kinds    gondola (also during the boarding walk), chair, drag lift, ride down (Killy); cable car, train (Zermatt)
 * Shots (SKI_LIFT_MAP_SHOTS=dir, default ~/Library/Caches/ski-work/lift-map-mid/): LOOK at them. Zero page errors. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runIfMain } from "./lib.mjs";

export const flow = {
  name: "ski-lift-map",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      try { localStorage.removeItem("pb_ski_save"); localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const outDir = process.env.SKI_LIFT_MAP_SHOTS || path.join(os.homedir(), "Library/Caches/ski-work/lift-map-mid");
    const engine = process.env.FLOW_BROWSER || "chromium";
    const shot = async (label) => {
      await h.shot(label);
      fs.mkdirSync(outDir, { recursive: true });
      await page.screenshot({ path: path.join(outDir, `map-${engine}-${label}.png`) });
    };
    const boot = async (resort) => {
      await h.goto(`/pb/ski.html?resort=${resort}&go=1&debug=1&timescale=3&q=low`);
      await page.waitForFunction(() => (document.documentElement.dataset.skiScreen === "ski" && window.__ski.game.phase === "running") || document.documentElement.dataset.bootError, null, { timeout: 120000 });
      h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", `${resort} boots into the free ride`);
    };
    const mapState = () => page.evaluate(() => {
      const r = window.__ski.ride, rm = window.__ski.rideMap, s = window.__ski.state, root = document.documentElement.dataset;
      const you = rm ? rm.map.you : null, rs = rm ? rm.map.rideState : null;
      return {
        open: root.skiRideMap === "1", screen: root.skiScreen, phase: window.__ski.game.phase, ride: r ? { s: r.s, phase: r.phase, down: !!r.down, kind: r.kind, lift: r.lift.index, name: r.lift.name, top: r.lift.top, bottom: r.lift.bottom } : null,
        you, rs, st: { x: s.x, z: s.z }, title: (document.getElementById("rcTitle") || {}).textContent || "", text: (document.getElementById("rcText") || {}).textContent || "",
        cls: !!document.querySelector("#mapScreen.ridemap"),
      };
    });
    const cam = () => page.evaluate(() => { const c = window.__ski.camera.position, s = window.__ski.state; return { dx: c.x - s.x, dy: c.y - s.y, dz: c.z - s.z }; });
    const rideStarted = async () => {
      await page.waitForFunction(() => window.__ski.game.phase === "lift" && window.__ski.ride, null, { timeout: 10000 });
    };
    const inRide = () => page.waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === "ride", null, { timeout: 30000 });
    const board = async (id, down = false) => {
      await page.evaluate(([i, d]) => (d ? window.__ski.goDown(i) : window.__ski.goFree(i)), [id, down]);
      await page.waitForFunction(([i, d]) => window.__ski.game.phase === "running" && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === i && !!window.__ski.modes.liftDown === d, [id, down], { timeout: 45000 });
      await page.click("#liftBtn");
      await rideStarted();
    };
    const finish = async () => {
      await page.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 120000 });
    };

    // ------------------------------------------------------------------ Killy: gondola
    h.step("Killy: the village gondola, the ride panel has a big map button");
    await boot("killy");
    await page.waitForFunction(() => !document.getElementById("liftBtn").hidden, null, { timeout: 10000 });
    await page.keyboard.press("l");
    await rideStarted();
    // (while still boarding: the walk to the door) the map is available at once
    const bBtn = await page.evaluate(() => { const b = document.getElementById("rMap"); if (!b) return null; const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, x1: r.right, y1: r.bottom, vw: innerWidth, vh: innerHeight, vis: !b.closest("[hidden]") }; });
    h.expect(!!bBtn && bBtn.h >= 44 && bBtn.w >= 44 && bBtn.x1 <= bBtn.vw && bBtn.y1 <= bBtn.vh && bBtn.vis, `the ride panel has the map button, ${bBtn ? `${Math.round(bBtn.w)} x ${Math.round(bBtn.h)} px` : "none"}, inside the screen`);
    await page.click("#rMap");
    let m = await mapState();
    h.expect(m.open && m.cls && m.screen === "ski" && m.phase === "lift" && !!m.ride, `the map opened over the BOARDING walk (screen ${m.screen}, phase ${m.phase}, ride ${m.ride && m.ride.phase})`);
    await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === "ride", null, { timeout: 30000 });
    m = await mapState();
    h.expect(m.open && m.ride.phase === "ride", "he got in and rides on under the open map");
    h.expect(!!m.rs && m.rs.lift === m.ride.lift && m.rs.label === "Hei kënns du un", `map: lift ${m.ride.name} highlighted, top marked "${m.rs && m.rs.label}" (${m.rs && m.rs.sub}), ${m.rs ? m.rs.starts.length : "?"} pistes start there`);
    h.expect(/^Am Lift: /.test(m.title) && /uewen op \d+ m/i.test(m.text), `the card says "${m.title}" / "${m.text}"`);
    const s0 = m.ride.s, y0 = m.you;
    await h.pause(2200);
    m = await mapState();
    h.expect(m.ride && m.ride.s > s0 + 15 && m.open, `the lift did not stop: ${Math.round(s0)} -> ${Math.round(m.ride.s)} m with the map open`);
    h.expect(!!m.you && Math.hypot(m.you.x - m.st.x, m.you.z - m.st.z) < 15 && Math.hypot(m.you.x - y0.x, m.you.z - y0.z) > 15, `the marker moves with the cabin (${Math.hypot(m.you.x - y0.x, m.you.z - y0.z).toFixed(0)} m on, ${Math.hypot(m.you.x - m.st.x, m.you.z - m.st.z).toFixed(1)} m from him)`);
    await shot("1-gondola-map");
    // a tap on the ground: no teleport, a hint
    const box = await page.evaluate(() => { const r = document.getElementById("mapCanvas").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const before = (await mapState()).st;
    await page.mouse.click(box.x + box.w * 0.06, box.y + box.h * 0.9);
    await h.pause(300);
    m = await mapState();
    h.expect(m.open && !!m.ride && Math.hypot(m.st.x - before.x, m.st.z - before.z) < 160 && m.phase === "lift", `a tap on the ground teleports nothing (card: "${m.title}")`);
    h.expect(/Net um Lift|^[^:]+$/.test(m.title), "the card answers the tap");
    // close with M: no camera jump
    const c1 = await cam();
    await page.keyboard.press("m");
    await h.pause(60);
    const c2 = await cam();
    m = await mapState();
    h.expect(!m.open && m.screen === "ski" && m.phase === "lift" && !!m.ride, "M closes the map, the ride goes on");
    h.expect(Math.hypot(c2.dx - c1.dx, c2.dy - c1.dy, c2.dz - c1.dz) < 1.2, `no camera jump on closing (${Math.hypot(c2.dx - c1.dx, c2.dy - c1.dy, c2.dz - c1.dz).toFixed(2)} m)`);
    await shot("2-gondola-after-close");
    // M again, Esc closes
    await page.keyboard.press("m");
    h.expect((await mapState()).open, "M opens it again");
    await page.keyboard.press("Escape");
    h.expect(!(await mapState()).open, "Esc closes it");
    // the ride ends while the map is open: the map goes, he stands at the top
    await page.keyboard.press("m");
    await h.pause(300);
    const topG = m.ride.top;
    await page.evaluate(() => window.__ski.skipRide());
    await finish();
    m = await mapState();
    h.expect(!m.open && m.screen === "ski" && m.phase === "running" && Math.hypot(m.st.x - topG.x, m.st.z - topG.z) < 140, `arriving with the map open closes it; he stands ${Math.round(Math.hypot(m.st.x - topG.x, m.st.z - topG.z))} m from the station`);
    await h.pause(400);
    await shot("3-gondola-arrived");

    // ------------------------------------------------------------------ chair, drag lift
    for (const [kind, label] of [["chair", "chair"], ["drag", "drag lift"]]) {
      h.step(`Killy: a ${label}: the map on the lift`);
      const id = await page.evaluate((k) => { const L = window.__ski.modes.lifts.list.filter((l) => l.kind === k && l.len > 450 && l.len < 1700); return (L.find((l) => /Aiguille Percée|Lavachet/.test(l.name)) || L[0]).id; }, kind);
      await board(id);
      await inRide();
      await h.pause(1800);
      await page.keyboard.press("m");
      m = await mapState();
      h.expect(m.open && m.rs && m.rs.lift === m.ride.lift && m.ride.kind === kind, `${kind}: map open on ${m.ride && m.ride.name}, "${m.rs && m.rs.label}"`);
      const ss = m.ride.s;
      await h.pause(1500);
      m = await mapState();
      h.expect(m.ride.s > ss + 5, `${kind}: the lift goes on (${Math.round(ss)} -> ${Math.round(m.ride.s)} m)`);
      await shot(`4-${kind}-map`);
      await page.keyboard.press("m");
      if (kind === "chair") {
        // open / close x8: nothing piles up (DOM nodes, map canvases)
        const n0 = await page.evaluate(() => document.querySelectorAll("*").length);
        for (let i = 0; i < 8; i += 1) { await page.keyboard.press("m"); await h.pause(150); await page.keyboard.press("m"); await h.pause(100); }
        const n1 = await page.evaluate(() => ({ nodes: document.querySelectorAll("*").length, canvases: document.querySelectorAll("#mapCanvas").length, ride: !!window.__ski.ride, heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0 }));
        h.expect(n1.nodes <= n0 + 3 && n1.canvases === 0 && n1.ride, `open / close x8: ${n0} -> ${n1.nodes} DOM nodes, no map canvas left, the ride still goes (heap ${n1.heap.toFixed(0)} MB)`);
      }
      await page.evaluate(() => window.__ski.skipRide());
      await finish();
    }

    // ------------------------------------------------------------------ ride down
    h.step("Killy: a gondola DOWN: the bottom is the arrival");
    const dn = await page.evaluate(() => { const l = window.__ski.modes.lifts.list.find((x) => x.down && x.kind === "gondola"); return l && l.id; });
    if (dn) {
      await board(dn, true);
      await inRide();
      await page.click("#rMap");
      m = await mapState();
      h.expect(m.open && m.ride.down && m.rs && m.rs.label === "Hei kënns du un" && /Ënnen op/.test(m.text), `down: "${m.text}"`);
      await shot("5-down-map");
      await page.click("#mapResume");
      h.expect(!(await mapState()).open, "the resume button closes it");
      await page.evaluate(() => window.__ski.skipRide());
      await finish();
    }

    // ------------------------------------------------------------------ Zermatt: cable car, train
    h.step("Zermatt: a cable car and the Gornergrat train");
    await boot("zermatt");
    const ids = await page.evaluate(() => {
      const L = window.__ski.modes.lifts.list;
      const cable = L.filter((l) => l.kind === "cable" && l.len > 700)[0], train = L.find((l) => l.kind === "train");
      return { cable: cable && cable.id, train: train && train.id };
    });
    for (const [kind, id] of [["cable", ids.cable], ["train", ids.train]]) {
      if (!id) { h.expect(false, `Zermatt has a ${kind}`); continue; }
      await board(id);
      await inRide();
      await h.pause(1500);
      await page.click("#rMap");
      m = await mapState();
      h.expect(m.open && m.ride.kind === kind && m.rs && m.rs.lift === m.ride.lift, `${kind}: map open on ${m.ride && m.ride.name}`);
      const sk = m.ride.s;
      await h.pause(1500);
      m = await mapState();
      h.expect(m.ride.s > sk + 3, `${kind}: goes on (${Math.round(sk)} -> ${Math.round(m.ride.s)} m)`);
      await shot(`6-${kind}-map`);
      await page.keyboard.press("m");
      await page.evaluate(() => window.__ski.skipRide());
      await finish();
    }
    h.eq(errors.length, 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  },
};
runIfMain(import.meta.url, flow);
