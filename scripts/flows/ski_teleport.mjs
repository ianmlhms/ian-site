/* Flow: Ski Alpen map teleport (round 7-C). The free ride starts next to the resort's first lift (Killy: the Olympique gondola): on the
 * ground, facing it, nothing in the way. The map over the free ride shows the fog of the undiscovered cells; a tap there is refused
 * ("Nach net entdeckt"). Skiing somewhere discovers it; back at the first lift ("Bei den éischte Lift"), a tap (a real touch tap, the iPad
 * way) on that place asks "Hei hin teleportéieren?" with a pin exactly where the finger went down, "Jo" puts the skier on the nearest
 * safe spot there (on a piste / at a station, on the loaded ground). Discovery is saved locally (pb_ski_save disc) and goes into the
 * cloud record (`d`). Launch: every lift is open for teleport (a tap on an undiscovered lift, the lift list's "Bei de Lift"), a tap on
 * the minimap opens the map (a real touch tap); a touch tap on Sprong jumps (off the snow <= 0.5 s, > 0.3 m). Zero page errors.  FLOW_BROWSER=webkit for Safari's engine. */
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
    async function tapWorld(x, z, zoom = 4) {
      const [px, py] = await page.evaluate(([x, z, q]) => { const m = window.__ski.pisteMap; m.center(x, z, q); return m.screenXY(x, z); }, [x, z, zoom]);
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
    await page.addScriptTag({ content: "window.__liftDist = (x, z) => { let d = Infinity; for (const l of window.__ski.modes.lifts.list) { const ax = l.bottom.x, az = l.bottom.z, dx = l.top.x - ax, dz = l.top.z - az, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); d = Math.min(d, Math.hypot(ax + dx * t - x, az + dz * t - z)); } return d; };" });
    const far = await page.evaluate(() => { const k = window.__ski, e = k.explore, s = k.state; for (const p of k.pistes.list) { const a = p.at(p.length / 2, {}); if (Math.hypot(a.x - s.x, a.z - s.z) > 3000 && window.__liftDist(a.x, a.z) > 150 && !e.disc.has(a.x, a.z) && !e.disc.has(a.x + 300, a.z) && !e.disc.has(a.x - 300, a.z)) return { x: a.x, z: a.z, id: p.id }; } return null; });
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

    h.step("launch: every lift can be teleported to, discovered or not: the free ride tab, a tap on an undiscovered lift's bottom dot picks it, 'Bei de Lift' -> its boarding zone");
    const undiscovered = (skip = [], offPiste = false) => page.evaluate(([sk, off]) => { const k = window.__ski, e = k.explore, s = k.state; const L = k.modes.lifts.list.filter((l) => !sk.includes(l.id) && !e.disc.has(l.bottom.x, l.bottom.z) && !e.disc.has(l.top.x, l.top.z) && Math.hypot(l.bottom.x - s.x, l.bottom.z - s.z) > 2500 && (!off || !k.pistes.nearest((l.bottom.x + l.top.x) / 2, (l.bottom.z + l.top.z) / 2, 120))); L.sort((a, b) => b.len - a.len); return L[0] ? { id: L[0].id, name: L[0].name, x: L[0].bottom.x, z: L[0].bottom.z, mx: (L[0].bottom.x + L[0].top.x) / 2, mz: (L[0].bottom.z + L[0].top.z) / 2 } : null; }, [skip, offPiste]);
    const lift1 = await undiscovered();
    h.expect(!!lift1, `an undiscovered lift far away (${lift1 && lift1.name})`);
    await tapWorld(lift1.x, lift1.z);
    await page.waitForFunction((id) => window.__ski.game.freeLift && window.__ski.game.freeLift.id === id, lift1.id, { timeout: 4000 }).catch(() => {});
    h.eq(await page.evaluate(() => (window.__ski.game.freeLift || {}).id || null), lift1.id, `the tap picked ${lift1.name}`);
    await page.waitForFunction(() => { const b = document.getElementById("freeStart"); return b && !b.disabled; }, null, { timeout: 60000 }).catch(() => {});
    h.expect(await page.evaluate(() => !document.getElementById("freeStart").disabled && !/entdeckt/.test(document.getElementById("freeStatus").textContent)), "'Bei de Lift' is enabled (no 'Nach net entdeckt')");
    await h.shot("map-undiscovered-lift-picked");
    await page.click("#freeStart");
    await running();
    await page.waitForFunction((id) => window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id, lift1.id, { timeout: 15000 }).catch(() => {});
    h.eq(await page.evaluate(() => (window.__ski.modes.liftAt || {}).id || null), lift1.id, `in ${lift1.name}'s boarding zone`);
    await page.waitForFunction(() => !document.getElementById("liftBtn").hidden, null, { timeout: 8000 }).catch(() => {});
    h.expect(/Astegen/.test(await page.textContent("#liftBtn")), "the Astegen button is there");
    await h.shot("undiscovered-lift-zone");

    h.step("launch: a tap on the minimap opens the map");
    const mm = page.locator(".hud .minimap");
    h.eq(await mm.getAttribute("aria-label"), "Kaart opmaachen", "the minimap is a button 'Kaart opmaachen'");
    const mbox = await mm.boundingBox();
    h.expect(mbox && mbox.width >= 90, `the minimap is a big tap target (${mbox && mbox.width.toFixed(0)} px)`);
    await page.touchscreen.tap(mbox.x + mbox.width / 2, mbox.y + mbox.height / 2);
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 8000 }).catch(() => {});
    h.eq(await page.evaluate(() => document.documentElement.dataset.skiScreen), "map", "tap on the minimap: the map is open");

    h.step("launch: the piste tab, a tap on an undiscovered lift's line -> 'Hei hin teleportéieren? Beim Lift ...', Jo -> its boarding zone");
    await page.evaluate(() => window.__ski.setMapMode("piste"));
    await page.waitForFunction(() => document.documentElement.dataset.skiMapMode === "piste", null, { timeout: 5000 });
    const lift2 = await undiscovered([lift1.id], true);       // (a tap on a piste in this tab picks the piste)
    h.expect(!!lift2, `another undiscovered lift (${lift2 && lift2.name})`);
    await page.evaluate(() => { document.documentElement.dataset.skiTeleport = ""; });
    // the middle of the line as it is drawn (a rope runs straight on the panorama)
    const mid = await page.evaluate((id) => { const k = window.__ski, m = k.pisteMap, l = k.modes.lifts.byId.get(id); m.center((l.bottom.x + l.top.x) / 2, (l.bottom.z + l.top.z) / 2, 4); const a = m.screenXY(l.bottom.x, l.bottom.z), b = m.screenXY(l.top.x, l.top.z); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }, lift2.id);
    const mbx = await page.locator("#mapCanvas").boundingBox();
    await page.touchscreen.tap(mbx.x + mid[0], mbx.y + mid[1]);
    await h.pause(250);
    await page.waitForFunction(() => document.documentElement.dataset.skiTeleport === "confirm", null, { timeout: 4000 }).catch(() => {});
    h.eq(await page.evaluate(() => document.documentElement.dataset.skiTeleport), "confirm", "the tap on the undiscovered lift asks to teleport");
    h.expect((await page.textContent("#tpWhere")).includes("Beim Lift"), `'${(await page.textContent("#tpWhere")).trim()}'`);
    await h.shot("map-undiscovered-lift-confirm");
    const lift2Id = await page.evaluate(() => { const t = document.getElementById("tpWhere").textContent.replace(/^Beim Lift /, ""); const l = window.__ski.modes.lifts.list.find((q) => q.name === t); return l ? l.id : null; });
    await page.click("#tpYes");
    await running();
    await page.waitForFunction((id) => window.__ski.modes.liftAt && window.__ski.modes.liftAt.id === id, lift2Id, { timeout: 15000 }).catch(() => {});
    h.eq(await page.evaluate(() => (window.__ski.modes.liftAt || {}).id || null), lift2Id, "in that lift's boarding zone");
    await page.keyboard.press("m");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 10000 });
    await page.evaluate(() => window.__ski.setMapMode("freeride"));

    h.step("the printed piste map: the panorama, its picture in, the 2D plan and back (touch taps), the legend");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 8000 });
    h.eq(await page.evaluate(() => window.__ski.pisteMap.view), "relief", "the map is the panorama");
    const trip = () => page.evaluate(() => { const m = window.__ski.pisteMap, l = window.__ski.spawn; m.center(l.bottom.x, l.bottom.z, 4); const [px, py] = m.screenXY(l.bottom.x, l.bottom.z), w = m.worldXY(px, py); return Math.hypot(w[0] - l.bottom.x, w[1] - l.bottom.z); });
    h.expect((await trip()) < 20, "a station's spot on the panorama and back");
    const tapEl = async (sel) => { const b = await page.locator(sel).boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await h.pause(300); };
    await h.shot("map-printed");
    await tapEl("#mapView");
    h.eq(await page.evaluate(() => window.__ski.pisteMap.view), "flat", "2D: the plan from above");
    h.expect((await trip()) < 1, "a station's spot on the plan and back");
    await tapEl("#mapView");
    h.eq(await page.evaluate(() => window.__ski.pisteMap.view), "relief", "3D: the panorama again");
    await tapEl("#mapLegend summary");
    h.expect(await page.evaluate(() => document.getElementById("mapLegend").open), "a tap opens the legend");
    await h.shot("map-legend");
    await tapEl("#mapLegend summary");

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
    const offPx = await page.evaluate(([a, b]) => { const m = window.__ski.pisteMap, [ax, ay] = m.screenXY(a[0], a[1]), [bx, by] = m.screenXY(b[0], b[1]); return Math.hypot(ax - bx, ay - by); }, [pinAt, [target.x, target.z]]);
    h.expect(offPx < 2 && Math.hypot(pinAt[0] - target.x, pinAt[1] - target.z) < 20, `the tap landed ${(Math.hypot(pinAt[0] - target.x, pinAt[1] - target.z)).toFixed(1)} m (${offPx.toFixed(1)} px) from the aimed spot`);
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

    h.step("launch fix (Ian, iPad: 'the jump is like a crouch'): a real touch tap on Sprong: a short crouch, then he is off the snow");
    const jb = page.locator('#touchControls [data-k="jump"]');
    h.expect(await jb.isVisible(), "the Sprong button is on screen (touch)");
    const jbox = await jb.boundingBox();
    await page.evaluate(() => { window.__jumpProbe = { air: false, top: 0, t0: performance.now(), tAir: null }; const tick = () => { const k = window.__ski, s = k.state, p = window.__jumpProbe, up = s.y - k.surface.height(s.x, s.z); if (!s.grounded && !p.air) { p.air = true; p.tAir = performance.now() - p.t0; } p.top = Math.max(p.top, s.grounded ? 0 : up); if (performance.now() - p.t0 < 2500) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    await page.touchscreen.tap(jbox.x + jbox.width / 2, jbox.y + jbox.height / 2);
    await h.pause(1500);
    const jp = await page.evaluate(() => window.__jumpProbe);
    h.expect(jp.air && jp.tAir !== null && jp.tAir <= 500, `airborne ${jp.tAir === null ? 'never' : Math.round(jp.tAir) + ' ms'} after the tap (<= 500)`);
    h.expect(jp.top > 0.3, `${jp.top.toFixed(2)} m over the snow (> 0.3)`);

    h.step("R8e: the piste tab too: a tap on the empty (discovered) map asks to teleport, on the fog 'Nach net entdeckt'");
    await page.keyboard.press("m");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 10000 });
    await page.evaluate(() => window.__ski.setMapMode("piste"));
    await page.waitForFunction(() => document.documentElement.dataset.skiMapMode === "piste", null, { timeout: 5000 });
    const empty = await page.evaluate(() => {
      const k = window.__ski, s = k.state, e = k.explore;
      for (let d = 60; d <= 400; d += 20) for (let a = 0; a < 12; a++) {
        const x = s.x + Math.cos(a / 12 * Math.PI * 2) * d, z = s.z + Math.sin(a / 12 * Math.PI * 2) * d;
        const n = k.pistes.nearest(x, z, 90);
        if (!n && e.disc.has(x, z)) return { x, z };
      }
      return null;
    });
    h.expect(!!empty, "a discovered spot off every piste");
    if (empty) {
      await page.evaluate(() => { const el = document.getElementById("tpToast"); if (el) el.hidden = true; document.documentElement.dataset.skiTeleport = ""; });
      await tapWorld(empty.x, empty.z, 9);
      await page.waitForFunction(() => document.documentElement.dataset.skiTeleport === "confirm", null, { timeout: 4000 }).catch(() => {});
      h.eq(await page.evaluate(() => document.documentElement.dataset.skiTeleport), "confirm", "piste tab, empty discovered map: 'Hei hin teleportéieren?'");
      await h.shot("map-piste-tab-empty-tap");
      await page.click("#tpNo");
    }
    const fog = await page.evaluate(() => { const k = window.__ski, e = k.explore; for (let i = 0; i < 4000; i++) { const x = 200 + (i * 7919) % 20000, z = 200 + (i * 104729) % 20000; if (x < k.field.width - 200 && z < k.field.depth - 200 && !e.disc.has(x, z) && !k.pistes.nearest(x, z, 150) && window.__liftDist(x, z) > 150) { k.pisteMap.center(x, z, 9); const [px, py] = k.pisteMap.screenXY(x, z), w = k.pisteMap.worldXY(px, py); if (w && Math.hypot(w[0] - x, w[1] - z) < 20) return { x, z }; } } return null; });      // (in sight on the panorama)
    h.expect(!!fog, 'an undiscovered spot in sight');
    if (fog) {
      await page.evaluate(() => { document.documentElement.dataset.skiTeleport = ""; });
      await tapWorld(fog.x, fog.z, 9);
      await page.waitForFunction(() => document.documentElement.dataset.skiTeleport === "refused", null, { timeout: 3000 }).catch(() => {});
      h.eq(await page.evaluate(() => document.documentElement.dataset.skiTeleport), "refused", "piste tab, the fog: 'Nach net entdeckt'");
    }
    await page.evaluate(() => window.__ski.setMapMode("freeride"));
    await page.click("#mapResume").catch(() => {});

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
