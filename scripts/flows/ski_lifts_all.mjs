/* Flow: Ski Alpen round 7-B, every lift of every resort in the real page (Chromium; FLOW_BROWSER=webkit for Safari's engine).
 * Per resort (all five), once every height tile is in:
 *   every lift      both stations built (lift-site.js parts, drawn in one mesh), the waiting spot inside its own boarding zone
 *                   (the only place the "Astegen" button shows), the exit at the top outside every station / building / low lane,
 *                   on snow, facing downhill, 15 m clear (with the page's own buildings and trees)
 *   every lift      standing still at the exit: 0 km/h for 3 s of game time with no input, not a centimetre of drift (hold)
 *   one per kind    a real ride with the keys: L 10 m outside the zone does nothing; in the zone L boards ONCE (a second L at once
 *                   neither skips nor boards again), the carrier comes to the station, the rider is on it, Iwwersprangen -> off at
 *                   the top station, out to the exit spot, then 0 km/h for 3 s; drag lifts: skis on the snow beside the pylons
 * Zero page errors.  FLOW_SKI_RESORTS=killy,zermatt limits the resorts. */
import { runIfMain } from "./lib.mjs";

const RESORTS = (process.env.FLOW_SKI_RESORTS || "killy,3vallees,zermatt,arlberg,kronplatz").split(",");
const TIMESCALE = 8;

export const flow = {
  name: "ski-lifts-all",
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
    const summary = [];
    for (const rid of RESORTS) {
      h.step(`${rid}: boot into the free ride, wait for every tile`);
      await h.goto(`/pb/ski.html?resort=${rid}&go=1&debug=1&timescale=${TIMESCALE}&q=low`);
      await page.waitForFunction(() => (document.documentElement.dataset.skiScreen === "ski" && window.__ski && window.__ski.game.phase === "running") || document.documentElement.dataset.bootError, null, { timeout: 180000 });
      h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", `${rid}: boots`);
      await page.waitForFunction(() => document.documentElement.dataset.skiTilesDone === "1" && window.__ski.lifts && !!window.__ski.scene.getObjectByName("ski-lift-stations"), null, { timeout: 400000 });
      // let the buildings arrive (the exits keep clear of them)
      await page.waitForFunction(() => window.__ski.modes.lifts.world && !!window.__ski.scene.getObjectByName("ski-village"), null, { timeout: 60000 }).catch(() => {});

      h.step(`${rid}: every lift: stations, the boarding zone, the exit`);
      const all = await page.evaluate(() => {
        const S = window.__ski, net = S.modes.lifts, world = net.world, H = (x, z) => S.surface.height(x, z);
        const tree = (x, z) => !!S.scatter.hit(x, z, 0.4, -1e9, S.quality.treeDensity);
        const starts = S.pistes.list;
        const out = { drawn: 0, stations: 0, rides: 0, zones: 0, exits: 0, kinds: {}, bad: [] };
        const resort = S.modes.lifts.paths;
        for (const [index] of resort) {
          const site = S.lifts.siteOf(index);
          if (!site) continue;
          out.drawn++;
          const k = site.key + (site.path.tunnel ? ":tunnel" : "");
          const K = (out.kinds[k] = out.kinds[k] || { lifts: 0, stations: 0, rides: 0, zones: 0, exits: 0 });
          K.lifts++;
          if (site.ends.length === 2 && site.ends.every((e) => e.parts.some((p) => !p.cut))) { out.stations += 2; K.stations += 2; } else out.bad.push(`#${index} ${site.key}: stations`);
          const lift = net.byIndex.get(index);
          if (!lift) continue;
          out.rides++; K.rides++;
          const ws = world.sites.get(index);
          const inZone = ws.inZone(ws.wait.x, ws.wait.z) && net.boardingAt(ws.wait.x, ws.wait.z) === lift;
          const clear = !world.hit(ws.wait.x, ws.wait.z, 0.35, H(ws.wait.x, ws.wait.z), H) && !world.inBuilding(ws.wait.x, ws.wait.z, 0.3) && !tree(ws.wait.x, ws.wait.z);
          if (inZone && clear) { out.zones++; K.zones++; } else out.bad.push(`#${index} ${lift.name} (${site.key}): waiting spot ${inZone ? "" : "not in its zone "}${clear ? "" : "not clear"}`);
          const ex = world.exitOf(index, H, tree, starts);
          const ahead = H(ex.x + Math.cos(ex.heading) * 15, ex.z + Math.sin(ex.heading) * 15), back = H(ex.x - Math.cos(ex.heading) * 15, ex.z - Math.sin(ex.heading) * 15);
          let ok = !ex.fallback && !world.inStation(ex.x, ex.z, 1.5) && !world.inBuilding(ex.x, ex.z, 1.5) && !world.inLowLane(ex.x, ex.z, H, 3) && ahead < back + 0.5;
          for (let m = 0; m <= 15 && ok; m++) { const x = ex.x + Math.cos(ex.heading) * m, z = ex.z + Math.sin(ex.heading) * m; if (world.inStation(x, z, 0.5) || world.inBuilding(x, z, 0.5) || world.hit(x, z, 0.35, H(x, z), H) || tree(x, z)) ok = false; }
          if (ok) { out.exits++; K.exits++; } else out.bad.push(`#${index} ${lift.name} (${site.key}): exit ${ex.fallback ? "fallback" : ahead >= back + 0.5 ? "uphill" : "blocked"}`);
        }
        return out;
      });
      h.expect(all.stations === all.drawn * 2, `${rid}: ${all.drawn} lifts drawn, ${all.stations} stations`);
      h.expect(all.zones === all.rides, `${rid}: ${all.zones} / ${all.rides} waiting spots in their own boarding zone, clear`);
      h.expect(all.exits === all.rides, `${rid}: ${all.exits} / ${all.rides} exits outside stations / buildings, downhill, 15 m clear`);
      if (all.bad.length) console.log(`      ${all.bad.slice(0, 12).join("\n      ")}`);

      h.step(`${rid}: every lift: standing still at the exit (3 s of game time, no input)`);
      const holds = await page.evaluate(async (ts) => {
        const S = window.__ski, net = S.modes.lifts, H = (x, z) => S.surface.height(x, z);
        const tree = (x, z) => !!S.scatter.hit(x, z, 0.4, -1e9, S.quality.treeDensity);
        let still = 0, total = 0, worst = 0, worstSpeed = 0;
        const bad = [];
        for (const lift of net.list) {
          const ex = net.world.exitOf(lift.index, H, tree, S.pistes.list);
          S.placeHold(ex.x, ex.z, ex.heading);
          const x0 = S.state.x, z0 = S.state.z;
          let maxSpeed = 0;
          const t0 = performance.now();
          while (performance.now() - t0 < 3000 / ts + 60) { await new Promise((r) => requestAnimationFrame(r)); maxSpeed = Math.max(maxSpeed, S.state.speed); }
          const moved = Math.hypot(S.state.x - x0, S.state.z - z0);
          total++;
          worst = Math.max(worst, moved); worstSpeed = Math.max(worstSpeed, maxSpeed);
          if (moved < 0.01 && maxSpeed === 0 && S.hold) still++; else bad.push(`${lift.name}: ${moved.toFixed(3)} m, ${maxSpeed.toFixed(2)} m/s`);
        }
        return { still, total, worst, worstSpeed, bad: bad.slice(0, 8) };
      }, TIMESCALE);
      h.expect(holds.still === holds.total, `${rid}: ${holds.still} / ${holds.total} lifts: 0 km/h for 3 s after the exit, ${holds.worst.toFixed(3)} m drift at most${holds.bad.length ? " (" + holds.bad.join("; ") + ")" : ""}`);

      h.step(`${rid}: a real ride per lift kind (keys)`);
      const kinds = await page.evaluate(() => {
        const L = window.__ski.modes.lifts.list, by = {};
        for (const l of L) {
          const site = window.__ski.lifts.siteOf(l.index);
          const k = site.key + (site.path.tunnel ? ":tunnel" : "");
          if (!by[k] || Math.abs(l.len - 500) < Math.abs(by[k].len - 500)) by[k] = { id: l.id, len: l.len, name: l.name };
        }
        return by;
      });
      for (const [k, l] of Object.entries(kinds)) {
        await page.evaluate((id) => window.__ski.goFree(id), l.id);
        await page.waitForFunction((id) => window.__ski.game.phase === "running" && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id, l.id, { timeout: 30000 });
        const zone = await page.evaluate(() => !document.getElementById("liftBtn").hidden);
        // 10 m out of the zone: no button, L does nothing
        await page.evaluate(() => { const S = window.__ski, s = S.state; S.placeHold(s.x - Math.sin(s.heading) * 10 - Math.cos(s.heading) * 10, s.z + Math.cos(s.heading) * 10 - Math.sin(s.heading) * 10, s.heading); });
        await h.pause(350);
        const outBtn = await page.evaluate(() => !document.getElementById("liftBtn").hidden);
        await page.keyboard.press("l");
        await h.pause(250);
        const outRide = await page.evaluate(() => !!window.__ski.ride);
        await page.evaluate((id) => window.__ski.goFree(id), l.id);
        await page.waitForFunction((id) => window.__ski.game.phase === "running" && window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id, l.id, { timeout: 30000 });
        await page.keyboard.press("l");
        await page.waitForFunction(() => window.__ski.game.phase === "lift", null, { timeout: 5000 });
        await page.keyboard.press("l");                                         // the double press of Ian's test
        const twice = await page.evaluate(() => ({ phase: window.__ski.ride && window.__ski.ride.phase, s: window.__ski.ride && window.__ski.ride.s, carrier: !!window.__ski.scene.getObjectByName(`ski-ride-${window.__ski.ride.kind}`) }));
        await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.phase === "ride", null, { timeout: 30000 });
        await h.pause(300);
        const on = await page.evaluate(() => {
          const S = window.__ski, r = S.ride, w = r.where(), st = S.state;
          return { kind: r.kind, onCarrier: w.onCarrier, pose: st.ride, ground: st.y - S.surface.height(st.x, st.z), held: S.lifts.heldOf(r.lift.index) !== null, sub: r.path.sub };
        });
        if (on.kind === "gondola" || on.kind === "cable" || on.kind === "train") await h.shot(`${rid}-${k}-ride`);
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => window.__ski.game.phase === "running" && !window.__ski.ride, null, { timeout: 120000 });
        const at = await page.evaluate(() => ({ x: window.__ski.state.x, z: window.__ski.state.z }));
        await h.pause(3000 / TIMESCALE + 150);
        const after = await page.evaluate((a) => ({ moved: Math.hypot(window.__ski.state.x - a.x, window.__ski.state.z - a.z), speed: window.__ski.state.speed, hold: window.__ski.hold }), at);
        const okRide = zone && !outBtn && !outRide && (twice.phase === "board" || twice.phase === "ride") && twice.carrier && on.onCarrier && on.held &&
          (on.kind !== "drag" || Math.abs(on.ground) < 0.03) && after.moved < 0.01 && after.speed === 0;
        h.expect(okRide, `${rid} ${k} (${l.name}): button only in the zone (${zone}/${outBtn}), L outside: ${outRide ? "RODE" : "nothing"}, L twice: one boarding (${twice.phase}), on the carrier (${on.pose}${on.kind === "drag" ? `, skis ${(on.ground * 100).toFixed(1)} cm` : ""}), off at the top: ${after.moved.toFixed(3)} m / ${after.speed} m/s in 3 s`);
        summary.push({ rid, k, ok: okRide });
      }
      summary.push({ rid, all, holds });
    }
    h.eq(errors, [], "zero page errors");
    console.log(JSON.stringify(summary.filter((s) => s.all).map((s) => ({ rid: s.rid, kinds: s.all.kinds, still: `${s.holds.still}/${s.holds.total}` }))));
  },
};

runIfMain(import.meta.url, flow);
