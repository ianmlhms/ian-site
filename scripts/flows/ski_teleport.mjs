/* Flow: Ski Alpen map teleport (round 7-C). The free ride starts next to the resort's first lift (Killy: the Olympique gondola): on the
 * ground, facing it, nothing in the way. The map over the free ride shows the fog of the undiscovered cells; a tap there is refused
 * ("Nach net entdeckt"). Skiing somewhere discovers it; back at the first lift ("Bei den éischte Lift"), a tap (a real touch tap, the iPad
 * way) on that place asks "Hei hin teleportéieren?" with a pin exactly where the finger went down, "Jo" puts the skier on the nearest
 * safe spot there (on a piste / at a station, on the loaded ground). Discovery is saved locally (pb_ski_save disc) and goes into the
 * cloud record (`d`). Zero page errors.  FLOW_BROWSER=webkit for Safari's engine. */
import { runIfMain } from "./lib.mjs";

export const flow = {
  name: "ski-teleport",
  fullChromium: true,
  touch: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => {
      try { if (!sessionStorage.getItem("r7c-keep")) { localStorage.removeItem("pb_ski_save"); localStorage.removeItem("pb_ski_cam"); sessionStorage.setItem("r7c-keep", "1"); } localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } catch (error) { /* ignore */ }
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const where = () => page.evaluate(() => { const s = window.__ski.state; return { x: s.x, z: s.z, y: s.y, ground: window.__ski.surface.height(s.x, s.z), heading: s.heading, phase: window.__ski.game.phase, mode: window.__ski.game.mode }; });
    const running = () => page.waitForFunction(() => window.__ski && window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running" && document.documentElement.dataset.skiScreen === "ski", null, { timeout: 90000 });
    /** A real touch tap on the map at world (x, z). Returns the pin's world point (what the map understood). */
    async function tapWorld(x, z) {
      const [px, py] = await page.evaluate(([x, z]) => { const m = window.__ski.pisteMap; m.center(x, z, 4); return m.screenXY(x, z); }, [x, z]);
      const box = await page.locator("#mapCanvas").boundingBox();
      await page.touchscreen.tap(box.x + px, box.y + py);
      await h.pause(250);
      return page.evaluate(([px, py]) => window.__ski.pisteMap.worldXY(px, py), [px, py]);
    }

    h.step("the free ride starts next to the first lift: on the ground, facing it, open view");
    await h.goto("/pb/ski.html?resort=killy&go=1&debug=1&q=low&res=fixed");
    await running();
    await page.waitForFunction(() => document.documentElement.dataset.skiSpawnOk !== undefined, null, { timeout: 20000 });
    const spawn = await page.evaluate(() => {
      const k = window.__ski, s = k.state, l = k.spawn, e = k.explore;
      const wall = e.obs.wallAhead(s.x, s.z, s.heading, (x, z) => k.surface.height(x, z), 25);
      const toLift = Math.atan2(l.bottom.z - s.z, l.bottom.x - s.x), up = Math.atan2(l.top.z - l.bottom.z, l.top.x - l.bottom.x);
      const ang = (a, b) => { let d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
      return { name: l.name, d: Math.hypot(s.x - l.bottom.x, s.z - l.bottom.z), above: s.y - k.surface.height(s.x, s.z), wall: wall ? `${wall.what} ${wall.d.toFixed(0)} m` : "", face: Math.min(ang(s.heading, toLift), ang(s.heading, up)) * 180 / Math.PI, ok: document.documentElement.dataset.skiSpawnOk, lift: document.getElementById("liftBtn") && !document.getElementById("liftBtn").hidden };
    });
    h.eq(spawn.name, "Olympique", "Killy's first lift is the Olympique gondola (Val d'Isère centre)");
    h.expect(spawn.d <= 38 && Math.abs(spawn.above) <= 0.3, `${spawn.d.toFixed(1)} m from its bottom station, ${spawn.above.toFixed(2)} m above the ground`);
    h.expect(!spawn.wall && spawn.ok === "1", `nothing within 25 m ahead${spawn.wall ? ` (${spawn.wall})` : ""}`);
    h.expect(spawn.face < 80, `facing the lift / up its line (${spawn.face.toFixed(0)}° off)`);
    await page.waitForFunction(() => !document.getElementById("liftBtn").hidden, null, { timeout: 8000 });
    h.expect(/Astegen/.test(await page.textContent("#liftBtn")), "the Astegen button is there: right in the boarding zone");
    await h.pause(1200);
    await h.shot("spawn-first-lift");

    h.step("the map: fog over the undiscovered cells; a tap there is refused");
    const far = await page.evaluate(() => { const k = window.__ski, e = k.explore, s = k.state; for (const p of k.pistes.list) { const a = p.at(p.length / 2, {}); if (Math.hypot(a.x - s.x, a.z - s.z) > 3000 && !e.disc.has(a.x, a.z) && !e.disc.has(a.x + 300, a.z) && !e.disc.has(a.x - 300, a.z)) return { x: a.x, z: a.z, id: p.id }; } return null; });
    h.expect(!!far, `an undiscovered piste far away (${far && far.id})`);
    await page.keyboard.press("m");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map" && document.documentElement.dataset.skiMapMode === "freeride", null, { timeout: 10000 });
    h.expect(await page.isVisible("#tpFirst"), "the 'Bei den éischte Lift' button is on the map");
    const share = await page.evaluate(() => window.__ski.explore.disc.share());
    h.expect(share > 0 && share < 0.05, `only a little is discovered so far (${(share * 100).toFixed(2)} %)`);
    await tapWorld(far.x, far.z);
    await page.waitForFunction(() => document.documentElement.dataset.skiTeleport === "refused", null, { timeout: 3000 });
    h.eq((await page.textContent("#tpToast")).trim(), "Nach net entdeckt", "the tap on the fog: 'Nach net entdeckt'");
    h.expect(await page.isHidden("#tpConfirm"), "no teleport question for an undiscovered place");
    await h.shot("map-fog-refused");

    h.step("ski there (discover it), then back with 'Bei den éischte Lift'");
    await page.click("#mapResume");
    await running();
    await page.evaluate((f) => { window.__ski.place(f.x, f.z, 0); window.__ski.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); }, far);
    await page.waitForFunction((f) => window.__ski.explore.disc.has(f.x, f.z), far, { timeout: 8000 });
    h.expect(true, "skiing there discovered it");
    await page.evaluate(() => window.__ski.setInput(null));
    await page.keyboard.press("m");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 10000 });
    await page.click("#tpFirst");
    await running();
    const back = await where();
    const sp = await page.evaluate(() => window.__ski.spawn.bottom);
    h.expect(Math.hypot(back.x - sp.x, back.z - sp.z) <= 38 && Math.abs(back.y - back.ground) <= 0.3, `back at the first lift (${Math.hypot(back.x - sp.x, back.z - sp.z).toFixed(1)} m from its station)`);

    h.step("a touch tap on the discovered place: the pin is exactly there, 'Hei hin teleportéieren?', Jo -> the safe spot on the ground");
    await page.keyboard.press("m");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map" && document.documentElement.dataset.skiMapMode === "freeride", null, { timeout: 10000 });
    const target = { x: far.x + 25, z: far.z - 15 };
    const pinAt = await tapWorld(target.x, target.z);
    const zoomPx = await page.evaluate(() => { const m = window.__ski.pisteMap; const [a] = m.screenXY(0, 0), [b] = m.screenXY(100, 0); return (b - a) / 100; });
    h.expect(Math.hypot(pinAt[0] - target.x, pinAt[1] - target.z) * zoomPx < 2, `the tap landed ${(Math.hypot(pinAt[0] - target.x, pinAt[1] - target.z)).toFixed(1)} m (${(Math.hypot(pinAt[0] - target.x, pinAt[1] - target.z) * zoomPx).toFixed(1)} px) from the aimed spot`);
    await page.waitForFunction(() => document.documentElement.dataset.skiTeleport === "confirm", null, { timeout: 4000 });
    h.eq((await page.textContent("#tpConfirm b")).trim(), "Hei hin teleportéieren?", "the question");
    await h.shot("map-teleport-confirm");
    await page.click("#tpNo");
    h.expect(await page.isHidden("#tpConfirm"), "Nee: nothing happens");
    await tapWorld(target.x, target.z);
    await page.waitForFunction(() => document.documentElement.dataset.skiTeleport === "confirm", null, { timeout: 4000 });
    await page.click("#tpYes");
    await running();
    await h.pause(800);
    const tp = await page.evaluate(() => { const k = window.__ski, s = k.state, e = k.explore; return { x: s.x, z: s.z, above: s.y - k.surface.height(s.x, s.z), why: e.obs.blocked(s.x, s.z, 1, { built: false }), slope: e.obs.slopeAt(s.x, s.z, (x, z) => k.surface.height(x, z)), piste: (k.pistes.nearest(s.x, s.z, 60) || {}).piste ? k.pistes.nearest(s.x, s.z, 60).piste.id : null, tiles: k.field.hasTile(Math.floor(s.x / 1280), Math.floor(s.z / 1280)) }; });
    h.expect(Math.hypot(tp.x - target.x, tp.z - target.z) < 120, `teleported ${Math.hypot(tp.x - target.x, tp.z - target.z).toFixed(0)} m from the tap, on the piste ${tp.piste}`);
    h.expect(!tp.why && tp.slope < 32 && Math.abs(tp.above) <= 0.3 && tp.tiles, `a safe spot: ${tp.why || "open snow"}, ${tp.slope.toFixed(0)}°, ${tp.above.toFixed(2)} m above the loaded 5 m ground`);
    await h.shot("teleported");

    h.step("discovery is saved (locally and in the cloud record) and survives a reload");
    await page.evaluate(() => window.__ski.explore.save(true));
    const saved = await page.evaluate(async () => { const p = JSON.parse(localStorage.getItem("pb_ski_save")); const { encodeCloud } = await import("/pb/ski/modes/cloud.js"); const rec = encodeCloud(window.__ski.progress()); return { local: (p.disc || {}).killy || "", cloud: (rec.d || {}).killy || "", size: JSON.stringify(rec).length }; });
    h.expect(saved.local.length > 3 && saved.cloud === saved.local && saved.size < 7000, `pb_ski_save disc.killy ${saved.local.length} chars, cloud record d.killy the same (${saved.size} bytes)`);
    await page.reload();
    await running();
    h.expect(await page.evaluate((f) => window.__ski.explore.disc.has(f.x, f.z), far), "after a reload the place is still discovered");
    h.eq(errors, [], "no page errors");
  },
};

runIfMain(import.meta.url, flow);
