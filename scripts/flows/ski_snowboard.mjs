/* Flow: Ski Alpen snowboard (28 Nov 2026). A new player picks «Snowboard» in the Skier tab (open from the start, a board drawing):
 * the figure rides a board (skis and poles gone), the free ride takes the board's handling (world.ski: no skating, a slow shuffle), a
 * carve keeps the board on the snow (its edge, never under it), first person shows the board and gloves without poles, a timed run
 * rides the reference set (one fair list, the board look stays), on a chair lift the board lies on the footrest strapped to the front
 * foot, some of the others ride boards (listed + drawn with the board poses), a friend's state with the board flag shows him on a board
 * (net/wire.js flag 8, remotes.js), the choice is saved (local + cloud field) and survives a reload, the All-Mountain brings the skis
 * back. Zero page errors. FLOW_BROWSER=webkit for Safari's engine. */
import { runIfMain } from "./lib.mjs";

export const flow = {
  name: "ski-snowboard",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem("skiBoardInit")) {
          sessionStorage.setItem("skiBoardInit", "1");
          localStorage.removeItem("pb_ski_save"); localStorage.removeItem("pb_ski_cam"); localStorage.removeItem("pb_ski_npcs");
          localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday");
        }
      } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => { if (!/due to access control checks/.test(e.message)) errors.push(e.message); });
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const frames = (n) => page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
    const running = () => page.waitForFunction(() => window.__ski && window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running" && document.documentElement.dataset.skiScreen === "ski", null, { timeout: 120000 });

    h.step("the Skier tab: the snowboard is there and open from the start");
    await h.goto("/pb/ski.html?resort=killy&go=1&debug=1&q=low&timescale=2");
    await running();
    await page.keyboard.press("m");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 30000 });
    await page.click('.modetabs [data-mode="skis"]');
    await page.waitForSelector('.skicard[data-ski="snowboard"]');
    const card = await page.$eval('.skicard[data-ski="snowboard"]', (c) => ({ locked: c.classList.contains("locked"), board: !!c.querySelector(".skidraw.board"), name: c.querySelector(".sk b").textContent, pick: !!c.querySelector('[data-pick="snowboard"]') }));
    h.expect(!card.locked && card.pick && card.board && card.name === "Snowboard", `«Snowboard» open, with its board drawing (${JSON.stringify(card)})`);
    h.expect(/Snowboard fuere gläich/.test(await page.textContent(".fairnote")), "the fairness note names the snowboard");
    await page.click('.skicard [data-pick="snowboard"]');
    await page.waitForFunction(() => document.documentElement.dataset.skiType === "snowboard", null, { timeout: 5000 });
    await h.shot("snowboard-card");
    const picked = await page.evaluate(() => { const S = window.__ski; return { board: S.skier.board, save: S.progress().ski, ghost: true }; });
    h.expect(picked.board && picked.save === "snowboard", `picked: the figure rides a board, saved (${JSON.stringify(picked)})`);
    await page.click("#mapResume").catch(() => page.keyboard.press("Escape"));
    await running();

    h.step("free ride: the board's handling, a carve on its edge, never under the snow");
    const phys = await page.evaluate(async () => {
      const S = window.__ski, k = S.world.ski;
      return { physics: document.documentElement.dataset.skiPhysics, push: k.pushMaxSpeed, pushAccel: k.pushAccel, want: k.assistWant };
    });
    h.expect(phys.physics === "snowboard" && phys.push < 3 && phys.want < 0.5, `free ride on the board's numbers (${JSON.stringify(phys)})`);
    const spot = await page.evaluate(() => {
      const S = window.__ski;
      const L = S.pistes.list.filter((p) => (p.diff === "blue" || p.diff === "red") && p.length > 900);
      for (const p of L) for (const f of [0.3, 0.45, 0.6]) {
        const a = p.at(p.length * f, {}), b = p.at(Math.min(p.length, p.length * f + 100), {});
        if ((S.surface.height(a.x, a.z) - S.surface.height(b.x, b.z)) / 100 > 0.2) { S.place(a.x, a.z, Math.atan2(a.dz, a.dx)); return { id: p.id, x: a.x, z: a.z }; }
      }
      const p = L[0], a = p.at(p.length * 0.4, {}); S.place(a.x, a.z, Math.atan2(a.dz, a.dx)); return { id: p.id, x: a.x, z: a.z };
    });
    await page.evaluate(({ x, z }) => window.__ski.streamer.ready(x, z, 300), spot);
    await page.evaluate(() => window.__ski.setInput({ steer: 0, tuck: 1, brake: 0, push: 0, jump: false }));
    await h.pause(2200);
    const carve = await page.evaluate(async () => {
      const S = window.__ski, out = { minClear: 9, maxEdge: 0, minEdge: 0, under: 0, frames: 0, kmh: Math.round(S.state.speed * 3.6) };
      for (const steer of [0.8, -0.8]) {
        S.setInput({ steer, tuck: 0, brake: 0, push: 0, jump: false });
        for (let i = 0; i < 70; i++) {
          await new Promise((r) => requestAnimationFrame(r));
          const st = S.state;
          if (!st.grounded || st.crash > 0) continue;
          out.frames++;
          const g = S.skier.gearPoints().board;
          let m = 9;
          for (const [x, y, z] of g) m = Math.min(m, y - S.standHeight(x, z));
          out.minClear = Math.min(out.minClear, m);
          if (m < -0.03) out.under++;
          out.maxEdge = Math.max(out.maxEdge, st.edge); out.minEdge = Math.min(out.minEdge, st.edge);
        }
      }
      S.setInput({ steer: 0, tuck: 0, brake: 0, push: 0, jump: false });
      return out;
    });
    h.expect(carve.frames > 40 && carve.maxEdge > 0.2 && carve.minEdge < -0.2, `toe side and heel side carves (edge ${carve.minEdge.toFixed(2)} .. ${carve.maxEdge.toFixed(2)} at ${carve.kmh} km/h)`);
    h.expect(carve.under === 0, `the board stays on the snow: lowest edge point ${(carve.minClear * 100).toFixed(1)} cm over it, ${carve.under} of ${carve.frames} frames under`);
    await page.evaluate(() => window.__ski.orbit(30, 4, 1.2));
    await h.pause(400);
    await h.shot("snowboard-carve");
    await page.evaluate(() => window.__ski.orbit(null));

    h.step("first person: the board and the gloves, no poles");
    await page.evaluate(() => window.__ski.setCamMode("fp"));
    await frames(20);
    const fp = await page.evaluate(() => { const S = window.__ski, f = S.fp; return { board: f.board, skis: f.meshes.skis().visible, gloves: f.meshes.poles.visible, verts: f.meshes.poles.geometry.attributes.position.count }; });
    h.expect(fp.board && fp.skis && fp.gloves, `first person shows the board + gloves (${JSON.stringify(fp)})`);
    await h.shot("snowboard-fp");
    await page.evaluate(() => window.__ski.setCamMode("chase"));

    h.step("a timed run rides the reference set (one fair list); the board look stays");
    const fair = await page.evaluate(async (id) => {
      const S = window.__ski;
      S.start(id);
      for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
      return { physics: document.documentElement.dataset.skiPhysics, board: S.skier.board, mode: S.game.mode };
    }, spot.id);
    h.expect(fair.physics === "fair" && fair.board, `timed run: physics ${fair.physics}, still on the board`);

    h.step("chair lift: the board on the footrest, strapped to the front foot");
    const chair = await page.evaluate(() => {
      const S = window.__ski, L = S.modes.lifts.list.filter((l) => l.kind === "chair" && l.len > 500);
      return (L[1] || L[0]).id;
    });
    await page.evaluate((id) => window.__ski.goFree(id), chair);
    await running();
    await h.pause(1500);
    await page.evaluate(() => window.__ski.boardLift());
    await page.waitForFunction(() => window.__ski.ride && window.__ski.ride.where && window.__ski.ride.where().onCarrier && window.__ski.state.ride === "sit", null, { timeout: 40000 });
    await h.pause(3000);
    const seat = await page.evaluate(() => {
      const S = window.__ski, st = S.state, g = S.skier.gearPoints(), ys = g.board.map((p) => p[1]);
      const ground = S.surface.height(st.x, st.z);
      return { ride: st.ride, board: S.skier.board, n: g.board.length, top: Math.max(...ys) - st.y, low: Math.min(...ys) - st.y, flat: Math.max(...ys) - Math.min(...ys), overSnow: Math.min(...ys) - ground };
    });
    h.expect(seat.ride === "sit" && seat.board && seat.n === 10, `seated with the board (${seat.ride})`);
    h.expect(seat.low > -0.95 && seat.top < -0.2 && seat.flat < 0.25 && seat.overSnow > 1, `the board lies under the seat, level (${seat.low.toFixed(2)} .. ${seat.top.toFixed(2)} m, ${seat.overSnow.toFixed(1)} m over the snow)`);
    await page.evaluate(() => window.__ski.orbit(150, 3.2, 0.2, 45));
    await h.pause(500);
    await h.shot("snowboard-chair");
    await page.evaluate(() => window.__ski.orbit(null));

    h.step("the others: some ride snowboards");
    const others = await page.evaluate(async () => {
      const S = window.__ski;
      for (let i = 0; i < 60; i++) await new Promise((r) => requestAnimationFrame(r));
      const list = S.npcs.crowd.list, inst = S.npcs.view ? S.npcs.view.instances() : [];
      return { listed: list.length, boards: list.filter((o) => o.board).length, boardPoses: list.filter((o) => o.board).every((o) => o.poseA >= 11 && o.poseB >= 11), drawn: inst.length, drawnBoards: inst.filter((o) => o.pose >= 11).length };
    });
    h.expect(others.boards > 0 && others.boards < others.listed * 0.45 && others.boardPoses, `${others.boards} of ${others.listed} listed others on boards, all in the board poses`);
    h.expect(others.drawnBoards > 0, `${others.drawnBoards} of ${others.drawn} drawn on boards (riders included)`);

    h.step("a friend on a snowboard (wire flag 8 -> remotes.js)");
    const friend = await page.evaluate(async () => {
      const S = window.__ski, { createRemotes } = await import("/pb/ski/net/remotes.js"), { packState } = await import("/pb/ski/net/wire.js");
      const overlay = document.createElement("div"); document.body.appendChild(overlay);
      const R = createRemotes({ scene: S.scene, camera: S.camera, surface: S.surface, overlay });
      const st = { ...S.state, ride: "", x: S.state.x + 3, z: S.state.z + 3, y: S.surface.height(S.state.x + 3, S.state.z + 3), grounded: true, crash: 0 };
      R.add("a", "Board", "blo"); R.add("b", "Ski", "giel");
      const t0 = performance.now();
      R.push("a", 1, t0 - 400, packState(st, 0, false, true)); R.push("a", 1, t0 - 300, packState(st, 0, false, true));
      R.push("b", 1, t0 - 400, packState(st, 0, false)); R.push("b", 1, t0 - 300, packState(st, 0, false));
      R.update(t0, 1, 800, 600);
      const res = { a: R.get("a").model.board, b: R.get("b").model.board, skinned: R.get("a").mesh.isSkinnedMesh };
      R.remove("a"); R.remove("b"); overlay.remove();
      return res;
    });
    h.expect(friend.a === true && friend.b === false && friend.skinned, `the board flag shows him on a board, a skier stays on skis (${JSON.stringify(friend)})`);

    h.step("the choice survives a reload; the All-Mountain brings the skis back");
    await page.evaluate(() => window.__ski.skipRide && window.__ski.skipRide());
    await h.goto("/pb/ski.html?resort=killy&go=1&debug=1&q=low&timescale=2");
    await running();
    const again = await page.evaluate(() => ({ type: window.__ski.skiType, board: window.__ski.skier.board, cloudKey: window.__ski.progress().ski }));
    h.expect(again.type === "snowboard" && again.board && again.cloudKey === "snowboard", `after a reload: ${JSON.stringify(again)}`);
    const back = await page.evaluate(() => { const S = window.__ski; S.setSki("allmountain"); return { type: S.skiType, board: S.skier.board, fp: S.fp.board }; });
    h.expect(back.type === "allmountain" && !back.board && !back.fp, `back on skis: ${JSON.stringify(back)}`);
    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
