/* Flow: Ski Alpen first-person camera + snow spray (round 7-C). C / the 👁 HUD button switch to the skier's own eyes: the body is gone,
 * only the ski tips and the poles are drawn, the eyes are ~1.6 m over the snow, the view leans into a carve, the FOV opens up at speed and
 * a light motion streak shows on Mëttel; the choice is saved. On a lift the first person is the window view. The spray: a carve throws an
 * arc of grains, off the piste a powder cloud and ski tracks. Run on every resort's typical terrain (a piste carve + an off-piste run).
 * FLOW_BROWSER=webkit for Safari's engine. */
import { runIfMain } from "./lib.mjs";

const RESORTS = (process.env.SKI_RESORTS || "killy,3vallees,zermatt,arlberg,kronplatz,vialattea,obertauern,livigno,davos,laax,soelden").split(",");

export const flow = {
  name: "ski-firstperson",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      try { if (!sessionStorage.getItem("r7c-keep")) { localStorage.removeItem("pb_ski_save"); localStorage.removeItem("pb_ski_cam"); sessionStorage.setItem("r7c-keep", "1"); } localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "morning"); } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => { if (!/due to access control checks/.test(e.message)) errors.push(e.message); });      // WebKit: tile fetches cut off by the next page load
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const running = () => page.waitForFunction(() => window.__ski && window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running" && document.documentElement.dataset.skiScreen === "ski", null, { timeout: 120000 });

    for (const [i, rid] of RESORTS.entries()) {
      h.step(`${rid}: first person (C), the eyes, the skis and poles, the body hidden`);
      await h.goto(`/pb/ski.html?resort=${rid}&go=1&debug=1&q=medium&res=fixed&timescale=2`);
      await running();
      if (i === 0) {
        h.eq(await page.evaluate(() => window.__ski.camMode), "chase", "the chase camera by default");
        await page.keyboard.press("c");
      }
      await page.waitForFunction(() => window.__ski.camMode === "fp", null, { timeout: 4000 });
      // a red / black piste in the resort, the middle: carve down it
      // R8e (Kronplatz: the middle piste's 40 % point was a flat, 7 km/h, no carve to judge): the first point of those pistes whose next
      // 120 m fall >= 12° on average (a real carving slope), so the spray / lean are judged at carving speed
      const spot = await page.evaluate(() => {
        const k = window.__ski, L = k.pistes.list.filter((p) => (p.diff === "red" || p.diff === "blue") && p.length > 900);
        const order = [...L.keys()].sort((a, b) => Math.abs(a - L.length / 2) - Math.abs(b - L.length / 2));
        let pick = null;
        for (const i of order) {
          const p = L[i];
          for (const f of [0.4, 0.3, 0.5, 0.2, 0.6]) {
            const a = p.at(p.length * f, {}), b = p.at(Math.min(p.length, p.length * f + 120), {});
            const drop = k.surface.height(a.x, a.z) - k.surface.height(b.x, b.z);
            if (Math.atan2(drop, 120) * 180 / Math.PI >= 12) { pick = { p, a }; break; }
          }
          if (pick) break;
        }
        if (!pick) { const p = L[Math.floor(L.length / 2)]; pick = { p, a: p.at(p.length * 0.4, {}) }; }
        const { p, a } = pick;
        k.place(a.x, a.z, Math.atan2(a.dz, a.dx));
        return { id: p.id, x: a.x, z: a.z };
      });
      await page.evaluate(({ x, z }) => window.__ski.streamer.ready(x, z, 400), spot);
      await page.evaluate(() => window.__ski.setInput({ steer: 0, tuck: 1, brake: 0, push: 1, jump: false }));
      await h.pause(2500);
      await page.waitForFunction(() => window.__ski.state.speed * 3.6 > 30, null, { timeout: 8000 }).catch(() => {});      // R8e: up to carving speed
      // the eye height is the median of 10 samples over ~1 s: one sample can land in a dip / compression of the piste (28 Nov 2026:
      // Via Lattea's picked piste changed with the official-map cleanup and a single read gave 0.87 m)
      const eyes = [];
      for (let i = 0; i < 10; i++) { eyes.push(await page.evaluate(() => { const k = window.__ski, c = k.camera; return c.position.y - k.surface.height(c.position.x, c.position.z); })); await h.pause(100); }
      eyes.sort((a, b) => a - b);
      const eyeMedian = (eyes[4] + eyes[5]) / 2;
      const fp = await page.evaluate((eyeMedian) => {
        const k = window.__ski, s = k.state, c = k.camera;
        return { eye: eyeMedian, skis: k.fp.meshes.skis().visible, poles: k.fp.meshes.poles.visible, body: k.scene.children.some((o) => o.visible && /skier/i.test(o.name || "")) , fov: c.fov, speed: s.speed * 3.6, streak: Number(getComputedStyle(document.getElementById("fpStreak")).opacity), mode: document.documentElement.dataset.skiCam };
      }, eyeMedian);
      h.expect(fp.skis && fp.poles && fp.mode === "fp", `${rid}: ski tips + poles drawn (camera mode ${fp.mode})`);
      h.expect(fp.eye > 0.9 && fp.eye < 2.0, `${rid}: the eyes ${fp.eye.toFixed(2)} m over the snow (tucked lower)`);
      h.expect(fp.speed < 40 ? fp.fov >= 74 : fp.fov > 74 + 2, `${rid}: the FOV opens at ${fp.speed.toFixed(0)} km/h (${fp.fov.toFixed(1)}°)`);
      if (fp.speed > 55) h.expect(fp.streak > 0.02, `${rid}: the motion streak on Mëttel (${fp.streak.toFixed(2)})`);
      await h.shot(`fp-${rid}-speed`);

      h.step(`${rid}: carve -> a spray arc and a lean; off the piste -> powder cloud and tracks`);
      await page.evaluate(() => window.__ski.setInput({ steer: 1, tuck: 0, brake: 0, push: 0, jump: false }));
      await h.pause(700);
      const carve = await page.evaluate(() => { const k = window.__ski; const e = new window.THREE.Euler().setFromQuaternion(k.camera.quaternion, "YXZ"); return { roll: e.z, spray: k.spray.live(), edge: k.state.edge, speed: k.state.speed * 3.6 }; });
      h.expect(carve.spray.grains > 15, `${rid}: ${carve.spray.grains} grains in the air while carving at ${carve.speed.toFixed(0)} km/h (edge ${carve.edge.toFixed(2)})`);
      h.expect(Math.abs(carve.roll) > 0.03, `${rid}: the view leans into the turn (${(carve.roll * 180 / Math.PI).toFixed(1)}°)`);
      await h.shot(`fp-${rid}-carve`);
      const off = await page.evaluate(() => {
        const k = window.__ski, L = k.pistes;
        for (let i = 0; i < 3000; i++) {
          const p = L.list[i % L.list.length], a = p.at((i * 37) % p.length, {});
          for (const side of [-1, 1]) {
            const x = a.x - a.dz * side * 90, z = a.z + a.dx * side * 90;
            if (L.nearest(x, z, 70)) continue;
            const at = k.field.attrs(x, z, {});
            const g = (k.surface.height(x - 8, z) - k.surface.height(x + 8, z)) / 16, gz = (k.surface.height(x, z - 8) - k.surface.height(x, z + 8)) / 16;
            const sl = Math.atan(Math.hypot(g, gz)) * 180 / Math.PI;
            if (at.forest < 0.1 && at.rock < 0.2 && at.built === 0 && sl > 20 && sl < 32) { k.place(x, z, Math.atan2(gz, g)); return { x, z, sl }; }
          }
        }
        return null;
      });
      h.expect(!!off, `${rid}: an open off-piste slope ${off ? off.sl.toFixed(0) : "?"}°`);
      if (off) {
        await page.evaluate(({ x, z }) => window.__ski.streamer.ready(x, z, 300), off);
        await page.evaluate(() => window.__ski.setInput({ steer: 0.35, tuck: 0, brake: 0, push: 1, jump: false }));
        await h.pause(2600);
        const pw = await page.evaluate(() => ({ ...window.__ski.spray.live(), snow: window.__ski.state.snow, speed: window.__ski.state.speed * 3.6 }));
        h.expect(pw.powder > 4 && pw.tracks > 6, `${rid}: off piste a powder cloud (${pw.powder} puffs) and ${pw.tracks} track pieces at ${pw.speed.toFixed(0)} km/h`);
        await page.evaluate(() => window.__ski.setCamMode("chase"));
        await page.evaluate(() => window.__ski.setInput({ steer: -0.6, tuck: 0, brake: 0, push: 0, jump: false }));
        await h.pause(900);
        await h.shot(`spray-${rid}-powder`);
        await page.evaluate(() => window.__ski.setCamMode("fp"));
      }
      await page.evaluate(() => window.__ski.setInput(null));
    }

    h.step("the choice is saved; the HUD button switches back; on a lift the first person is the window view");
    await page.reload();
    await running();
    h.eq(await page.evaluate(() => window.__ski.camMode), "fp", "after a reload: still first person");
    await page.click("#hCam");
    h.eq(await page.evaluate(() => window.__ski.camMode), "chase", "the 👁 button: back to the chase camera");
    await page.click("#hCam");
    await page.waitForFunction(() => !document.getElementById("liftBtn").hidden, null, { timeout: 10000 });
    await page.click("#liftBtn");
    await page.waitForFunction(() => window.__ski.game.phase === "lift", null, { timeout: 8000 });
    await h.pause(1500);
    h.eq(await page.evaluate(() => window.__ski.rideView), "window", "riding in first person = the window view");
    await h.shot("fp-lift-window");
    h.eq(errors, [], "no page errors");
  },
};

runIfMain(import.meta.url, flow);
