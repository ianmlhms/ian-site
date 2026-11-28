/* Flow: Ski Alpen, beginners on the magic carpets (28 Nov 2026; pb/ski/npc.js carpetFolk / carpetAt, drawn by npc-view.js like every other
 * other skier: no extra draw calls). Espace Killy has carpets, Arlberg (after the official-map alignment) none. At a carpet: a few beginners
 * wait at its foot beside the belt, step on, stand on the belt up to the top (belt height, along the line, belt speed), step off and plough
 * down a lane beside the belt, back to the foot (a whole cycle sampled over 3 min of game time by calling the crowd directly); the player
 * on the same belt is never inside one; the draw calls with them on stay as without (instanced), the near ones are really drawn with the
 * standing pose on the belt (screenshots at the foot, on the belt, on the lane). A resort without carpets lists nobody there.
 * Chromium + WebKit (FLOW_BROWSER=webkit). Zero page errors. */
import { runIfMain } from "./lib.mjs";

export const flow = {
  name: "ski-npc-carpet",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => { try { if (!sessionStorage.getItem("skiNpcCarpetInit")) { sessionStorage.setItem("skiNpcCarpetInit", "1"); localStorage.removeItem("pb_ski_save"); localStorage.removeItem("pb_ski_npcs"); localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } } catch (error) { /* ignore */ } });
    const errors = [];
    page.on("pageerror", (e) => { if (!/due to access control checks/.test(e.message)) errors.push(e.message); });
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
    const running = () => page.waitForFunction(() => document.documentElement.dataset.skiRunning === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });

    h.step("Espace Killy: the longest carpets have beginners");
    await h.goto("/pb/ski.html?resort=killy&go=1&debug=1&q=low");
    await running();
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "boots without an error");
    await page.waitForFunction(() => !!window.__ski.lifts && !!window.__ski.npcs.view && window.__ski.npcs.live, null, { timeout: 120000 });
    const carpet = await page.evaluate(() => {
      const S = window.__ski, L = S.modes.lifts.list.filter((l) => l.kind === "carpet").sort((a, b) => b.len - a.len);
      const l = L[0], site = S.modes.lifts.world.sites.get(l.index), q = {};
      site.path.at(2, q);
      const m = L.filter((c) => c.len >= 80 && c.len <= 130)[0] || L[0], ms = S.modes.lifts.world.sites.get(m.index), mq = {};
      ms.path.at(2, mq);
      const pack = (c, qq) => ({ index: c.index, name: c.name, len: Math.round(c.len), bx: c.bottom.x, bz: c.bottom.z, tx: c.top.x, tz: c.top.z, heading: Math.atan2(qq.dz, qq.dx) });
      return { ...pack(l, q), n: L.length, mid: pack(m, mq) };
    });
    h.expect(carpet.n >= 6 && carpet.len > 100, `${carpet.n} carpets, the longest «${carpet.name}» ${carpet.len} m`);
    // stand beside the foot of the belt, the camera at the start looks up the belt
    await page.evaluate(({ x, z, heading }) => { const S = window.__ski; S.place(x - Math.cos(heading) * 14 + Math.sin(heading) * 10, z - Math.sin(heading) * 14 - Math.cos(heading) * 10, heading); }, { x: carpet.bx, z: carpet.bz, heading: carpet.heading });
    await page.evaluate(({ x, z }) => window.__ski.streamer.ready(x, z, 400), { x: carpet.bx, z: carpet.bz });
    await frames(30);

    h.step("a whole cycle (3 min of game time, the crowd asked directly): foot -> belt -> top -> lane -> foot");
    const cyc = await page.evaluate(({ index, bx, bz, tx, tz }) => {
      const S = window.__ski, crowd = S.npcs.crowd, site = S.modes.lifts.world.sites.get(index), P = site.path;
      const view = { x: bx, z: bz, fx: 0, fz: 1, player: { x: bx + 300, z: bz, vx: 0, vz: 0 }, level: "high", share: 1, hidden: null };
      const seen = new Map(), out = { phases: {}, ids: 0, maxJump: 0, offBelt: 0, beltBad: 0, lateral: 0, topSeen: 0 };
      const q = {};
      for (let k = 0; k < 720; k++) {
        const t = 500 + k * 0.25;
        const list = crowd.update(t, 0.25, view).filter((o) => o.kind === "carpet" && Math.floor((o.id - 4e6) / 16) === index);
        for (const o of list) {
          const prev = seen.get(o.id);
          if (prev) out.maxJump = Math.max(out.maxJump, Math.hypot(o.x - prev.x, o.z - prev.z));
          seen.set(o.id, { x: o.x, z: o.z });
          const ph = o.belt === 1 ? "belt" : o.poseA === 4 || o.poseA === 15 ? "lane" : "foot";
          out.phases[ph] = (out.phases[ph] || 0) + 1;
          if (o.belt === 1) {
            // on the belt: on its line, at belt height, standing
            let best = 1e9, bs = 0;
            for (let s = 0; s <= P.len; s += 0.2) { P.at(s, q); const d = Math.hypot(o.x - q.x, o.z - q.z); if (d < best) { best = d; bs = s; } }
            out.lateral = Math.max(out.lateral, best);
            out.topSeen = Math.max(out.topSeen, bs);
            if (Math.abs(o.y - (S.surface.height(o.x, o.z) + 0.18)) > 0.03) out.beltBad++;
            if (o.poseA !== 5 && o.poseA !== 16) out.offBelt++;
          }
        }
      }
      out.ids = seen.size;
      out.len = P.len;
      return out;
    }, carpet);
    h.expect(cyc.ids >= 3, `${cyc.ids} beginners on «${carpet.name}»`);
    h.expect(cyc.phases.foot > 20 && cyc.phases.belt > 100 && cyc.phases.lane > 100, `every phase seen: foot ${cyc.phases.foot}, belt ${cyc.phases.belt}, lane ${cyc.phases.lane} frames`);
    h.expect(cyc.lateral < 0.4 && cyc.beltBad === 0 && cyc.offBelt === 0, `on the belt: ${cyc.lateral.toFixed(2)} m from its line at most, belt height every frame, always the standing pose`);
    h.expect(cyc.topSeen > cyc.len - 6, `they ride it up to the top (${cyc.topSeen.toFixed(0)} of ${cyc.len.toFixed(0)} m)`);
    h.expect(cyc.maxJump < 1.6, `no teleport (the largest step ${cyc.maxJump.toFixed(2)} m in 0.25 s of game time)`);

    h.step("drawn: the beginners are on screen, standing on the belt; draw calls as without them");
    const drawn = await page.evaluate(async ({ index, bx, bz, tx, tz }) => {
      const t0 = performance.now();
      const S = window.__ski, frames = async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); };
      // wait (real time) until somebody stands on the belt near the camera
      const dx = tx - bx, dz = tz - bz, L = Math.hypot(dx, dz);
      S.place(bx - dx / L * 9 + dz / L * 7, bz - dz / L * 9 - dx / L * 7, Math.atan2(dz, dx));
      await S.streamer.ready(bx, bz, 300);
      let found = null;
      while (!found && performance.now() - t0 < 90000) {
        await frames(3);
        const list = S.npcs.crowd.list.filter((o) => o.kind === "carpet" && Math.floor((o.id - 4e6) / 16) === index);
        found = list.find((o) => o.belt === 1 && Math.hypot(o.x - bx, o.z - bz) < 70) || null;
      }
      const list = S.npcs.crowd.list.filter((o) => o.kind === "carpet");
      const inst = S.npcs.view.instances();
      const info = S.info();
      S.npcs.set(false); await frames(10); const off = S.info(); S.npcs.set(true); await frames(40);
      return { listed: list.length, onBelt: list.filter((o) => o.belt === 1).length, drawn: inst.length, calls: info.calls, callsOff: off.calls, meshes: S.npcs.view.group.children.length, found: found && { x: found.x, z: found.z, id: found.id } };
    }, carpet.mid);
    h.expect(drawn.listed >= 2, `${drawn.listed} carpet beginners listed near the camera (${drawn.onBelt} on a belt)`);
    h.expect(drawn.meshes === 2 && drawn.calls - drawn.callsOff <= 3, `still two instanced meshes; draw calls ${drawn.callsOff} -> ${drawn.calls} with the others on`);
    await h.pause(500);
    await h.shot("carpet-foot");
    if (drawn.found) {
      await page.evaluate(({ x, z }) => { const S = window.__ski; S.orbit(110, 7, 1.6); }, drawn.found);
      await frames(30);
      await h.shot("carpet-belt");
      await page.evaluate(() => window.__ski.orbit(null));
    }

    h.step("the lane: somebody ploughs down beside the belt");
    const lane = await page.evaluate(async ({ index, bx, bz, tx, tz }) => {
      const t0 = performance.now();
      const S = window.__ski, frames = async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); };
      let found = null;
      while (!found && performance.now() - t0 < 90000) {
        await frames(3);
        found = S.npcs.crowd.list.find((o) => o.kind === "carpet" && Math.floor((o.id - 4e6) / 16) === index && !o.belt && (o.poseA === 4 || o.poseA === 15) && Math.hypot(o.x - bx, o.z - bz) < 70) || null;
      }
      if (!found) return null;
      const mx = (found.x + bx) / 2, mz = (found.z + bz) / 2;
      S.place(found.x - Math.cos(found.heading) * -12 + Math.sin(found.heading) * 8, found.z - Math.sin(found.heading) * -12 - Math.cos(found.heading) * 8, found.heading + Math.PI);
      await frames(20);
      return { x: found.x, z: found.z, speed: found.speed };
    }, carpet.mid);
    h.expect(!!lane, `a beginner on the lane beside the belt${lane ? ` (${lane.speed.toFixed(1)} m/s)` : ""}`);
    await h.pause(400);
    await h.shot("carpet-lane");

    h.step("Arlberg has no carpets: nobody rides one there");
    await h.goto("/pb/ski.html?resort=arlberg&go=1&debug=1&q=low");
    await running();
    await page.waitForFunction(() => !!window.__ski.lifts && !!window.__ski.npcs.view && window.__ski.npcs.live, null, { timeout: 120000 });
    await frames(60);
    const arl = await page.evaluate(() => ({ carpets: window.__ski.modes.lifts.list.filter((l) => l.kind === "carpet").length, listed: window.__ski.npcs.crowd.list.filter((o) => o.kind === "carpet").length }));
    h.eq(arl, { carpets: 0, listed: 0 }, "no carpets, no carpet riders");
    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
