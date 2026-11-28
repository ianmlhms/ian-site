/* Flow: Ski Alpen MID STATIONS (28 Nov 2026; Ian: on a multi-section lift "get out here" / "keep going", like in reality). Free ride:
 *   chain     Killy: a chair whose top is the next section's bottom (Bollin -> Fresse): before the shared station the choice
 *             «Hei erausgoen» / «Weiderfueren» shows (big buttons + X / K); nobody answers = he sits on through a short fade into the next
 *             section's carrier (no boarding, never off in between); K = the same; X = off at the first section's top as before
 *   train     Zermatt: the Gornergrat train stops at its mid stations (the ones with a piste near): the choice before it, the train
 *             stands (default: on after the dwell), X = he gets out onto the platform and the snow beside it (a valid exit), standing
 *             still; boarding at a stop from its yellow mat (button «Astegen: Gornergrat Bahn · <stop>») rides on to the top
 *   gondola   Zermatt: Matterhorn Express 1 -> 2 (cabins) through the shared station
 * Shots (SKI_MID_SHOTS=dir, default ~/Library/Caches/ski-work/lift-map-mid/): LOOK at them. Zero page errors. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runIfMain } from "./lib.mjs";

export const flow = {
  name: "ski-midstation",
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
    const outDir = process.env.SKI_MID_SHOTS || path.join(os.homedir(), "Library/Caches/ski-work/lift-map-mid");
    const engine = process.env.FLOW_BROWSER || "chromium";
    const shot = async (label) => {
      await h.shot(label);
      fs.mkdirSync(outDir, { recursive: true });
      await page.screenshot({ path: path.join(outDir, `mid-${engine}-${label}.png`) });
    };
    const boot = async (resort) => {
      await h.goto(`/pb/ski.html?resort=${resort}&go=1&debug=1&timescale=6&q=low`);
      await page.waitForFunction(() => (document.documentElement.dataset.skiScreen === "ski" && window.__ski.game.phase === "running") || document.documentElement.dataset.bootError, null, { timeout: 120000 });
      h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", `${resort} boots into the free ride`);
    };
    const board = async (id) => {
      await page.evaluate((i) => window.__ski.goFree(i), id);
      await page.waitForFunction((i) => window.__ski.game.phase === "running" && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === i, id, { timeout: 45000 });
      await page.click("#liftBtn");
      await page.waitForFunction(() => window.__ski.game.phase === "lift" && window.__ski.ride && window.__ski.ride.phase === "ride", null, { timeout: 45000 });
    };
    const mid = () => page.evaluate(() => {
      const r = window.__ski.ride, b = document.getElementById("midChoice");
      const m = r ? r.mid : null;
      const rect = (id) => { const e = document.getElementById(id); if (!e) return null; const q = e.getBoundingClientRect(); return { w: q.width, h: q.height, x1: q.right, y1: q.bottom, x0: q.left, y0: q.top }; };
      return { shown: !!b && !b.hidden, title: (document.getElementById("mdTitle") || {}).textContent || "", left: (document.getElementById("mdLeft") || {}).textContent || "", m: m && { kind: m.kind, name: m.name, at: m.at, left: m.left, choice: m.choice }, out: rect("midOut"), stay: rect("midStay"), vw: innerWidth, vh: innerHeight, ride: r && { s: r.s, lift: r.lift.index, name: r.lift.name, phase: r.phase, dwelling: r.dwelling, kind: r.kind } };
    });
    const waitMid = (kind, at = null, timeout = 600000) => page.waitForFunction(([k, a]) => { const r = window.__ski.ride; const m = r && r.mid; return !!m && m.kind === k && (a === null || m.at === a) && !document.getElementById("midChoice").hidden; }, [kind, at], { timeout });
    const here = () => page.evaluate(() => { const s = window.__ski.state; return { x: s.x, z: s.z, speed: s.speed, ride: s.ride || "", hold: !!window.__ski.game.hold }; });

    // ------------------------------------------------------------------ Killy: a chair, two sections
    h.step("Killy: Bollin -> Fresse, a chair in two sections: the choice before the shared station");
    await boot("killy");
    const kc = await page.evaluate(() => {
      const L = window.__ski.modes.lifts, a = L.list.find((l) => L.sectionAfter(l) && l.kind === "chair"), b = a && L.sectionAfter(a);
      return a && { a: a.id, an: a.name, b: b.id, bn: b.name, aTop: a.top, bTop: b.top };
    });
    h.expect(!!kc, `a two-section chair exists (${kc && kc.an} -> ${kc && kc.bn})`);
    await board(kc.a);
    await waitMid("chain");
    let m = await mid();
    h.expect(m.shown && m.m.choice === null && /Tëschestatioun/.test(m.title) && m.title.includes(kc.bn), `the choice shows before the station: "${m.title}" ${m.left}`);
    h.expect(m.out && m.stay && m.out.h >= 54 && m.stay.h >= 54 && m.out.w >= 120 && m.out.x1 <= m.vw && m.stay.x1 <= m.vw && m.out.y1 <= m.vh, `big buttons: ${Math.round(m.out.w)} x ${Math.round(m.out.h)} and ${Math.round(m.stay.w)} x ${Math.round(m.stay.h)} px, inside the screen`);
    await shot("1-chain-choice");
    // nobody answers: he sits on through the station
    const t0 = await page.evaluate(() => Number(document.documentElement.dataset.skiRideThrough || 0));
    let wasOff = false;
    await page.waitForFunction((n) => Number(document.documentElement.dataset.skiRideThrough || 0) > n, t0, { timeout: 300000, polling: 40 });
    await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === "ride", null, { timeout: 20000 });
    m = await mid();
    h.expect(m.ride.name === kc.bn && m.ride.phase === "ride", `no answer = he stays in: now riding ${m.ride.name} (${Math.round(m.ride.s)} m)`);
    h.expect(await page.evaluate(() => window.__ski.game.phase === "lift" && window.__ski.state.ride === "sit" && document.documentElement.dataset.skiRidePhase === "ride"), "never got off in between: seated on the next chair");
    h.expect(await page.evaluate(() => !document.getElementById("liftBtn") || document.getElementById("liftBtn").hidden), "no boarding button in between");
    await shot("2-chain-through");
    h.expect((await page.evaluate(() => window.__ski.lifts.heldOf(window.__ski.ride.lift.index))) !== null, "the next section's carrier is held for him");
    // X at the next shared station (if the second section has none: he gets off at its top); skip to the end instead
    await page.evaluate(() => window.__ski.skipRide());
    await page.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 240000 });
    let e = await here();
    h.expect(Math.hypot(e.x - kc.bTop.x, e.z - kc.bTop.z) < 150 && !e.ride, `off at ${kc.bn}'s top (${Math.round(Math.hypot(e.x - kc.bTop.x, e.z - kc.bTop.z))} m from the station)`);

    h.step("K = keep riding; X = out at the first section's top");
    await board(kc.a);
    await waitMid("chain");
    await page.keyboard.press("k");
    m = await mid();
    h.expect(m.m.choice === "stay", "K chose «Weiderfueren» (the button is marked)");
    await page.waitForFunction((n) => Number(document.documentElement.dataset.skiRideThrough || 0) > n, t0 + 1, { timeout: 300000, polling: 40 });
    await page.evaluate(() => window.__ski.skipRide());
    await page.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 240000 });
    await board(kc.a);
    await waitMid("chain");
    await page.keyboard.press("x");
    m = await mid();
    h.expect(m.m.choice === "out", "X chose «Hei erausgoen»");
    await shot("3-chain-out-chosen");
    await page.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 240000 });
    e = await here();
    h.expect(Math.hypot(e.x - kc.aTop.x, e.z - kc.aTop.z) < 120 && !e.ride && (await page.evaluate(() => !!window.__ski.game.hold)), `X: off at ${kc.an}'s top (${Math.round(Math.hypot(e.x - kc.aTop.x, e.z - kc.aTop.z))} m), standing still`);
    await shot("4-chain-out-top");
    // the next section can be boarded from the shared station (a mid station boarding)
    await page.evaluate((id) => window.__ski.goFree(id), kc.b);
    await page.waitForFunction((id) => window.__ski.game.phase === "running" && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id, kc.b, { timeout: 45000 });
    const bb = await page.evaluate(() => { const b = document.getElementById("liftBtn"); return { hidden: b.hidden, text: b.textContent.trim() }; });
    h.expect(!bb.hidden && bb.text.includes(kc.bn), `boarding ${kc.bn} up from the mid station: the button says "${bb.text}"`);
    // the ride down from the shared station (where the first section rides down)
    const dn = await page.evaluate((id) => { const l = window.__ski.modes.lifts.byId.get(id); return l.down; }, kc.a);
    if (dn) {
      await page.evaluate((id) => window.__ski.goDown(id), kc.a);
      await page.waitForFunction((id) => window.__ski.game.phase === "running" && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id && window.__ski.modes.liftDown, kc.a, { timeout: 45000 });
      const db = await page.evaluate(() => document.getElementById("liftBtn").textContent.trim());
      h.expect(/Erof/.test(db), `at the shared station ${kc.an} can be ridden DOWN too: "${db}"`);
    } else h.expect(true, `${kc.an} has no ride down`);

    // ------------------------------------------------------------------ Zermatt: the train with stops, a gondola in two sections
    h.step("Zermatt: the Gornergrat train stops at its mid stations");
    await boot("zermatt");
    const zt = await page.evaluate(() => {
      const L = window.__ski.modes.lifts, t = L.list.find((l) => l.kind === "train" && L.stopsOf(l).length), stops = t ? L.stopsOf(t) : [];
      const all = t ? L.stopsOf(t, true) : [];
      const g = L.list.find((l) => L.sectionAfter(l) && l.kind === "gondola" && l.len < 3000), gb = g && L.sectionAfter(g);
      return { train: t && t.id, name: t && t.name, stops: stops.map((q) => ({ s: q.s, name: q.name, x: q.off.x, z: q.off.z, wx: q.wait.x, wz: q.wait.z, wh: q.wait.heading })), all: all.length, g: g && g.id, gn: g && g.name, gbn: gb && gb.name };
    });
    h.expect(!!zt.train && zt.stops.length >= 2, `${zt.name}: ${zt.stops.length} of ${zt.all} stops are served (${zt.stops.map((q) => q.name).join(", ")})`);
    await board(zt.train);
    await waitMid("stop", false);
    m = await mid();
    h.expect(m.shown && /Statioun/.test(m.title) && m.title.includes(m.m.name), `the choice shows before the stop: "${m.title}" ${m.left}`);
    await shot("5-train-choice");
    await waitMid("stop", true);
    m = await mid();
    h.expect(m.ride.dwelling && m.m.at, `the train stands at "${m.m.name}" (${m.left})`);
    const sStop = m.ride.s;
    await shot("6-train-at-stop");
    await h.pause(1500);
    m = await mid();
    h.expect(!m.ride || Math.abs(m.ride.s - sStop) < 0.5 || !m.ride.dwelling, "it stands still while he decides");
    // default: nobody answers, the train goes on after the dwell
    await page.waitForFunction((s) => window.__ski.ride && window.__ski.ride.s > s + 20, sStop, { timeout: 240000 });
    h.expect(true, "no answer = the train goes on after the wait (he stays in)");
    // the next stop: X
    await waitMid("stop", true);
    m = await mid();
    const stopName = m.m.name, stopRec = zt.stops.find((q) => q.name === stopName);
    await page.keyboard.press("x");
    await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === "alight", null, { timeout: 20000 });
    await h.pause(1000);
    await shot("7-train-getting-out");
    await page.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 240000 });
    e = await here();
    const dist = stopRec ? Math.hypot(e.x - stopRec.x, e.z - stopRec.z) : 999;
    const ex = await page.evaluate(() => { const s = window.__ski.state; const p = window.__ski.pistes.nearest(s.x, s.z, 200); return { piste: p ? p.piste.name : null, hold: !!window.__ski.game.hold }; });
    h.expect(dist < 60 && !e.ride && ex.hold, `X at "${stopName}": out on the snow ${Math.round(dist)} m from its platform, standing still`);
    h.expect(!!ex.piste, `a piste is near the exit (${ex.piste}, within 200 m)`);
    await shot("8-train-exit");
    // boarding at the stop from its mat
    await page.evaluate((q) => window.__ski.teleportTo({ x: q.wx, z: q.wz, heading: q.wh }), stopRec);
    await page.waitForFunction(() => window.__ski.game.phase === "running" && window.__ski.modes.liftStop, null, { timeout: 120000 });
    const btn = await page.evaluate(() => { const b = document.getElementById("liftBtn"); return { hidden: b.hidden, text: b.textContent }; });
    h.expect(!btn.hidden && /Astegen: .*·/.test(btn.text), `on the stop's mat the button says "${btn.text.trim()}"`);
    await shot("9-train-stop-mat");
    await page.click("#liftBtn");
    await page.waitForFunction(() => window.__ski.game.phase === "lift" && window.__ski.ride, null, { timeout: 10000 });
    await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === "ride", null, { timeout: 30000 });
    m = await mid();
    h.expect(Math.abs(m.ride.s - stopRec.s) < 40 && m.ride.kind === "train", `boarded the train AT the stop (${Math.round(m.ride.s)} m, the stop is at ${Math.round(stopRec.s)} m)`);
    await shot("10-train-boarded-at-stop");
    await page.evaluate(() => window.__ski.skipRide());
    await page.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 240000 });
    h.expect(true, "rides on to the top");

    h.step("Zermatt: Matterhorn Express in two sections (cabins)");
    if (zt.g) {
      await board(zt.g);
      await waitMid("chain");
      m = await mid();
      h.expect(m.shown && m.title.includes(zt.gbn), `the choice before the shared station: "${m.title}"`);
      await shot("11-gondola-choice");
      const tg = await page.evaluate(() => Number(document.documentElement.dataset.skiRideThrough || 0));
      await page.waitForFunction((n) => Number(document.documentElement.dataset.skiRideThrough || 0) > n, tg, { timeout: 300000, polling: 40 });
      await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === "ride", null, { timeout: 20000 });
      m = await mid();
      h.expect(m.ride.name === zt.gbn && (await page.evaluate(() => window.__ski.state.ride === "carry")), `stayed in the cabin: now on ${m.ride.name}, standing`);
      await shot("12-gondola-through");
    }
    h.eq(errors.length, 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  },
};
runIfMain(import.meta.url, flow);
