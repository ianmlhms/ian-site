/* Flow: Ski Alpen challenge course (round 7-C, from Ian's "Bouc Blanc" run in 3 Vallées). The start gate stands on open snow (clear of
 * buildings, stations, lift lines and trees); at "0" the skier gets a push (no start from standstill); orange barriers line both piste
 * edges, arrows stand at the junctions, a red "ZIL" arch spans the finish; the HUD shows the distance to the finish and an arrow to the
 * next waypoint. Leaving the course: "Zréck op d'Pist" with an arrow, the skier is NOT moved; after a few seconds "Challenge ofgebrach"
 * with Nach eng Kéier / Weider fräi fueren. The scripted skier reaches the finish inside the barriers -> the finish card.
 * SKI_COURSES="rid:piste,..." to pick others. FLOW_BROWSER=webkit for Safari's engine. */
import { runIfMain } from "./lib.mjs";

const COURSES = (process.env.SKI_COURSES || "3vallees:bouc-blanc,killy:face,zermatt:riffelalp,arlberg:kandahar,kronplatz:sylvester").split(",").map((s) => s.split(":"));

export const flow = {
  name: "ski-course",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      try { localStorage.removeItem("pb_ski_save"); localStorage.setItem("pb_ski_cam", "chase"); localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

    for (const [ci, [rid, pid]] of COURSES.entries()) {
      h.step(`${rid} / ${pid}: the start gate on open snow, the course set up, the push at 0`);
      await h.goto(`/pb/ski.html?resort=${rid}&map=1&debug=1&q=low&res=fixed&timescale=3`);
      await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
      const has = await page.evaluate((pid) => !!window.__ski.pistes.byId.get(pid), pid);
      const id = has ? pid : await page.evaluate(() => window.__ski.pistes.list.find((p) => p.diff === "red" && p.length > 800).id);
      await page.evaluate((id) => { const p = window.__ski.pistes.byId.get(id); return window.__ski.streamer.ready(p.top.x, p.top.z, 800); }, id);
      await page.evaluate(() => window.__ski.explore.buildings());
      await page.evaluate((id) => window.__ski.start(id), id);
      await page.waitForFunction(() => window.__ski.game.phase === "countdown", null, { timeout: 15000 });
      const set = await page.evaluate(() => {
        const k = window.__ski, r = k.game.run, p = k.game.piste, a = p.at(r.startS, {}), lat = k.gateAt ? k.gateAt(p).lat || 0 : 0;     // R7-C2: the gate may stand beside the line
        const why = [0, 3.5, -3.5].map((o) => k.explore.obs.blocked(a.x - a.dz * (lat + o), a.z + a.dx * (lat + o), 4)).filter(Boolean);
        const names = k.scene.children.map((o) => o.name);
        const bar = k.scene.children.find((o) => o.name === "ski-course-barriers");
        return { s: r.startS, lat, why, barriers: bar ? bar.count : 0, arrows: (k.scene.children.find((o) => o.name === "ski-course-arrows") || {}).count || 0, arch: names.includes("ski-course-finish"), hud: !document.getElementById("courseHud").hidden, len: p.length, hw: p.halfWidth };
      });
      h.expect(set.why.length === 0, `${id}: start gate at ${set.s} m${set.lat ? ` (${set.lat.toFixed(1)} m beside the line)` : ""} on open snow${set.why.length ? ` (blocked: ${set.why.join(", ")})` : ""}`);
      h.expect(set.barriers > (set.len - set.s - 20) / 6 * 2 * 0.9 && set.arch && set.hud, `${id}: ${set.barriers} barrier panels on both edges, ${set.arrows} arrows, the ZIL arch, the HUD bar`);
      await page.waitForFunction(() => window.__ski.game.phase === "running", null, { timeout: 15000 });
      const v0 = await page.evaluate(() => window.__ski.state.speed);
      h.expect(v0 >= 3.5, `${id}: pushed off at 0 (${(v0 * 3.6).toFixed(0)} km/h)`);
      await h.pause(700);
      if (ci === 0) await h.shot(`course-${rid}-start`);
      const hudText = await page.textContent("#courseHud");
      h.expect(/bis ZIL/.test(hudText), `${id}: the HUD: "${hudText.trim()}"`);
      if (ci === 0) {
        await page.evaluate(() => { const k = window.__ski, p = k.game.piste, f = p.at(k.game.run.finishS, {}); const b = p.at(k.game.run.finishS - 60, {}); k.setCamera(b.x - b.dz * 8, b.z + b.dx * 8, 4, f.x, f.z, 4, 55); });
        await h.pause(1500);
        await h.shot(`course-${rid}-finish-arch`);
        await page.evaluate(() => window.__ski.setCamera(null));

        h.step(`${id}: leave the course -> warning, no teleport -> "Challenge ofgebrach" with a choice`);
        const off = await page.evaluate(() => { const k = window.__ski, p = k.game.piste, a = p.at(Math.min(p.length * 0.5, 200), {}); const x = a.x - a.dz * (p.halfWidth + 45), z = a.z + a.dx * (p.halfWidth + 45); k.place(x, z, Math.atan2(a.dz, a.dx)); k.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); return { x, z }; });
        await page.waitForFunction(() => !document.getElementById("courseWarn").hidden, null, { timeout: 5000 });
        h.expect(/Zréck op d'Pist/.test(await page.textContent("#courseWarn")), "the warning 'Zréck op d'Pist' with an arrow back");
        await h.shot(`course-${rid}-warning`);
        await h.pause(2000);
        const still = await page.evaluate(() => ({ x: window.__ski.state.x, z: window.__ski.state.z }));
        h.expect(Math.hypot(still.x - off.x, still.z - off.z) < 15, `not moved back (${Math.hypot(still.x - off.x, still.z - off.z).toFixed(1)} m from where he left the course)`);
        await page.waitForSelector("#courseAbort", { timeout: 20000 });
        h.expect((await page.textContent("#courseAbort")).includes("Challenge ofgebrach"), "after a while: 'Challenge ofgebrach'");
        h.expect(await page.isVisible('#courseAbort [data-a="again"]') && await page.isVisible('#courseAbort [data-a="free"]'), "a choice: Nach eng Kéier / Weider fräi fueren");
        await h.shot(`course-${rid}-aborted`);
        await page.evaluate(() => window.__ski.setInput(null));
        await page.click('#courseAbort [data-a="free"]');
        await page.waitForFunction(() => window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running", null, { timeout: 8000 });
        const fr = await page.evaluate(() => ({ x: window.__ski.state.x, z: window.__ski.state.z, course: document.documentElement.dataset.skiCourse, barriers: window.__ski.scene.children.some((o) => o.name === "ski-course-barriers") }));
        h.expect(Math.hypot(fr.x - off.x, fr.z - off.z) < 25 && !fr.barriers, "Weider fräi fueren: on from that spot, the course taken down");
        await page.evaluate((id) => window.__ski.start(id), id);
        await page.waitForFunction(() => window.__ski.game.phase === "running", null, { timeout: 15000 });
      }

      h.step(`${id}: the scripted skier reaches the ZIL inside the barriers`);
      // R7-C2: the HUD distance is sampled all along the ride: it must fall and read < 30 m at the arch (it once stuck at "4.8 km")
      await page.evaluate(async () => {
        const k = window.__ski, log = [];
        window.__skiHudLog = log;
        const tick = () => { const c = k.lastCourse; const el = document.getElementById("cLeft"); if (c) log.push([c.remaining, el ? el.textContent : ""]); if (k.game.phase === "running") setTimeout(tick, 150); };
        tick();
        const { createBot } = await import("/pb/ski/bot.js"); k.game.bot = createBot(k.game.piste);
      });
      await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "finish", null, { timeout: 240000 });
      const fin = await page.evaluate(() => ({ last: document.documentElement.dataset.skiLast, warned: document.documentElement.dataset.skiCourseWarn, hits: window.__ski.course ? window.__ski.course.hits : null }));
      h.expect(!!fin.last, `${id}: finished (${fin.last}), the finish card is up`);
      const hud = await page.evaluate(() => {
        const log = window.__skiHudLog || [];
        let rise = 0, low = Infinity;
        for (const [r] of log) { rise = Math.max(rise, r - low); low = Math.min(low, r); }
        const end = log.length ? log[log.length - 1] : [NaN, ""];
        return { n: log.length, first: log.length ? log[0][1] : "", end: end[1], endM: end[0], rise };
      });
      h.expect(hud.n > 5 && hud.endM < 30 && hud.rise < 15 && /m bis ZIL/.test(hud.end), `${id}: HUD "${hud.first}" -> "${hud.end}" at the arch (${hud.n} samples, rise ${hud.rise.toFixed(0)} m)`);
    }
    h.eq(errors, [], "no page errors");
  },
};

runIfMain(import.meta.url, flow);
