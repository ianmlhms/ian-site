/* Flow: Schueberfouer Tycoon W3 "Small stuff": the model preview page (pb/fouer.html?models=1).
 * - the turntable grid boots with zero console errors and shows every model;
 * - every W3 model builds at every look x level (x quality, x far LOD) and its footprint fits the pitch size of data.js, including all animation poses;
 * - the night toggle drives the shared lamp / lit-sign materials;
 * - the full fair (all 34 pitches at max level + NPC background fair + props on the real Glacis) stays inside the W3 budget (<= 35 draw calls, <= 90k triangles
 *   at the "frame the field" preset), the live-ride LOD works, and a pitch can be swapped between NPC stall / empty / player model at runtime. */
import { runIfMain } from "./lib.mjs";

const MAX_DRAWS = 35;
const MAX_TRIS = 110000;              // polish wave (glow + density): 60k -> 90k for the W3 share (clutter, 24 NPC skins, murals); polish 2: 90k -> 110k (packed NPC fair, locked-pitch clusters, free plots, slot floors); the whole scene stays <= 140 draws / 300k below
const MAX_MODEL_TRIS = 6500;            // one S / M model at level 4 near LOD
const MAX_FAR_TRIS = 3200;              // far LOD
const NO_404 = (text) => /wheel\.js|towers\.js|Failed to load resource.*404/i.test(text);

async function ready(h, url) {
  await h.goto(url);
  await h.page.waitForFunction(() => document.documentElement.dataset.fouerReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
  await h.pause(900);
}

export const flow = {
  name: "fouer-models",
  fullChromium: true,
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" && !NO_404(m.text())) errors.push(m.text()); });

    h.step("?models=1 grid boots without errors and lists every model");
    await ready(h, "/pb/fouer.html?models=1&fouerQ=medium&spin=0&level=3");
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "no boot error");
    const info = await page.evaluate(() => { const F = window.__fouerModels; return { n: F.models.length, ids: F.models.map((m) => m.id), reg: F.modelIds(), view: F.view }; });
    h.eq(info.view, "grid", "default view is the turntable grid");
    const MINE = ["kachel", "fritten", "lous", "kanner", "wurscht", "zocker", "lukas", "mandel", "waffel", "fesch", "kette", "crepes", "schiess", "bayern", "happy", "break", "musik", "takeoff", "infinity", "museum", "lammy", "gold"];
    h.eq(MINE.filter((id) => !info.reg.includes(id)), [], "all 22 W3 items are registered");
    h.expect(info.n >= 22, `${info.n} models on the grid`);
    await h.shot("grid");

    h.step("every model x look x level builds, footprints fit their pitch size (all animation poses)");
    const res = await page.evaluate(async () => { const m = await import("/pb/fouer/models/selftest.js"); const r = m.runModelChecks({ T: window.THREE }); return { count: r.count, errors: r.errors, bad: r.bad.slice(0, 8), summary: r.summary, atlas: window.__fouerModels.atlas() }; });
    h.expect(res.count >= 22 * 12, `${res.count} builds checked`);
    h.eq(res.errors, [], "no build errors");
    h.eq(res.bad.map((r) => `${r.id} L${r.level} look${r.look} ${r.quality}${r.far ? " far" : ""} +${r.over}`), [], "every footprint fits (S 8 x 8, M 16 x 16)");
    for (const s of res.summary) {
      h.expect(s.trisL4 > 150 && s.trisL4 <= MAX_MODEL_TRIS, `${s.id}: ${s.trisL4} tris at L4 (${s.bulbsL4} bulbs), far ${s.trisL4far}, worst footprint over +${s.maxOver.toFixed(2)} m`);
      h.expect(s.trisL4far <= MAX_FAR_TRIS, `${s.id}: far LOD ${s.trisL4far} tris <= ${MAX_FAR_TRIS}`);
    }
    h.expect(res.atlas.overflow === 0, `sign atlas not overflowing (${res.atlas.slots} slots, ${(res.atlas.fill * 100).toFixed(0)} % full)`);

    h.step("day / night toggle drives the shared lamp, lit-sign and bulb materials");
    const night = await page.evaluate(async () => {
      const F = window.__fouerModels; F.setTime("night");
      for (let i = 0; i < 30; i++) F.env.update(0.1, F.r.camera);
      const n = { k: F.state.nightK, lamp: F.M.lamp.color.r, lit: F.M.signLit.emissiveIntensity, uNight: F.M.U.uNight.value };
      F.setTime("day"); for (let i = 0; i < 30; i++) F.env.update(0.1, F.r.camera);
      const d = { k: F.state.nightK, lamp: F.M.lamp.color.r, lit: F.M.signLit.emissiveIntensity, uNight: F.M.U.uNight.value };
      return { n, d };
    });
    h.expect(night.n.k > 0.95 && Math.abs(night.n.lamp - 1) < 0.03 && night.n.lit > 1 && night.n.uNight > 0.95, `night: k ${night.n.k.toFixed(2)}, lamp scalar ${night.n.lamp.toFixed(2)}, lit signs ${night.n.lit.toFixed(2)}`);
    h.expect(night.d.k < 0.05 && Math.abs(night.d.lamp - 0.45) < 0.03 && night.d.uNight < 0.05, `day: k ${night.d.k.toFixed(2)}, lamp scalar ${night.d.lamp.toFixed(2)} (0.45 + 0.55 k)`);
    await page.evaluate(() => window.__fouerModels.setTime("night")); await h.pause(500); await h.shot("grid-night");
    h.eq(errors, [], "zero console errors on the grid page");

    h.step("full fair: 34 pitches at L4 + NPC fair + props on the real Glacis, medium quality, frame-the-field preset");
    await ready(h, "/pb/fouer.html?models=1&view=fair&fouerQ=medium&fouerNoFly=1&level=4&time=day&fouerDebug=1");
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "fair boots");
    await page.evaluate(() => { const F = window.__fouerModels; F.r.setPose(F.r.framePose(), true); });
    await h.pause(1200);
    const day = await page.evaluate(() => { const F = window.__fouerModels; return { st: F.fair.stats(), snap: F.performanceSnapshot(), npc: { count: F.fair.baseInfo.npc.count, camelots: F.fair.baseInfo.npc.camelots }, props: F.fair.baseInfo.props.count }; });
    h.expect(day.st.totalDraws <= MAX_DRAWS, `W3 share (NPC fair + props + 34 pitches): ${day.st.totalDraws} draw calls (<= ${MAX_DRAWS})`);
    h.expect(day.st.totalTris <= MAX_TRIS, `W3 share: ${Math.round(day.st.totalTris)} triangles (<= ${MAX_TRIS})`);
    h.expect(day.npc.count >= 150, `${day.npc.count} NPC stalls (${day.npc.camelots} camelots along the tram lane)`);
    h.expect(day.snap.drawCalls > 40 && day.snap.drawCalls <= 140, `whole scene: ${day.snap.drawCalls} draw calls, ${day.snap.triangles} triangles (iPad-medium builder budget 140 / 300k)`);
    await h.shot("fair-day");

    h.step("night: same budget, lamps on");
    await page.evaluate(() => { const F = window.__fouerModels; F.setTime("night"); for (let i = 0; i < 40; i++) F.env.update(0.1, F.r.camera); });
    await h.pause(900);
    const nt = await page.evaluate(() => { const F = window.__fouerModels; return { st: F.fair.stats(), snap: F.performanceSnapshot(), lamp: F.M.lamp.color.r }; });
    h.expect(nt.lamp > 0.97 && nt.st.totalDraws <= MAX_DRAWS && nt.st.totalTris <= MAX_TRIS, `night: lamp scalar ${nt.lamp.toFixed(2)}, ${nt.st.totalDraws} draws, ${Math.round(nt.st.totalTris)} tris, scene ${nt.snap.drawCalls} draws`);
    await h.shot("fair-night");

    h.step("LOD: near the rides the nearest <= 10 go live (animated parts), far away none; models switch to the far LOD");
    const lod = await page.evaluate(async () => {
      const F = window.__fouerModels; const out = {};
      F.r.setPose({ tu: 120, tw: 55, yaw: -1.2, dist: 60, tilt: 0 }, true); await new Promise((r) => setTimeout(r, 900));
      out.close = F.fair.stats(); out.closeSnap = F.performanceSnapshot();
      const rot = []; F.fair.pits.forEach((p) => { if (p.live && p.cur) { const a = p.cur.userData.parts; const key = a && Object.keys(a)[0]; if (key) rot.push(a[key].rotation.y + a[key].rotation.x + a[key].position.y); } });
      out.moving = rot.length;
      F.r.setPose(F.r.framePose(), true); await new Promise((r) => setTimeout(r, 900));
      out.far = F.fair.stats(); out.farCount = [...F.fair.pits.values()].filter((p) => p.far).length;
      return out;
    });
    h.expect(lod.close.live.rides > 0 && lod.close.live.rides <= 10, `close view: ${lod.close.live.rides} live rides (<= 10), ${lod.close.live.draws} extra draws; scene ${lod.closeSnap.drawCalls} draws, ${lod.closeSnap.triangles} tris`);
    h.expect(lod.far.live.rides === 0 && lod.farCount >= 20, `frame view: no live rides, ${lod.farCount} pitches on the far LOD`);

    h.step("NPC <-> player swap API: locked pitch (NPC stall + padlock) -> built -> open -> locked");
    const swap = await page.evaluate(async () => {
      const F = window.__fouerModels; const L = F.fair; const out = {};
      L.setPitch("P01", { state: "locked" }); L.flush(); out.locked = { tris: L.stats().pitches.tris, spec: L.getPitch("P01"), skin: L.pits.get("P01").near.userData.skin, lock: L.pits.get("P01").near.userData.locked };
      L.setPitch("P01", { state: "built", item: "kachel", look: 1, level: 2 }); L.flush(); out.built = { tris: L.stats().pitches.tris, spec: L.getPitch("P01"), name: L.pits.get("P01").near.name };
      L.setPitch("P01", { state: "open" }); L.flush(); out.open = { tris: L.stats().pitches.tris, spec: L.getPitch("P01"), plot: !!(L.pits.get("P01").near && L.pits.get("P01").near.userData.plot), name: L.pits.get("P01").near && L.pits.get("P01").near.name };
      L.toNpc("P01"); L.flush(); out.back = { spec: L.getPitch("P01") };
      return out;
    });
    h.expect(swap.locked.lock === true && swap.locked.spec.state === "locked", `locked pitch shows an NPC stall (${swap.locked.skin}) with a padlock plate`);
    h.eq([swap.built.spec.item, swap.built.name], ["kachel", "kachel"], "built: the player model replaces the NPC stall");
    h.expect(swap.open.plot === true && swap.open.tris < swap.built.tris, `open pitch is a free plot (gravel, barrier, \"FRÄI PLAZ\" sign, parked trailer: ${swap.open.name}; fewer triangles than a built stall; W2's marker still glows on it)`);
    h.eq(swap.back.spec.state, "locked", "toNpc() swaps back to the NPC stall");

    /* ------------------------------------------------------------ feedback B: nothing floats in the air, the NPC stall fronts open onto walkways (real THREE, real geometry) */
    h.step("nothing floats: every Builder-kit model (all looks x levels), the NPC fair, props and clutter; every NPC stall front opens onto a walkway");
    const air = await page.evaluate(async (ids) => {
      const M = await import("/pb/fouer/models/index.js"); const A = await import("/pb/fouer/float-audit.js"); const L = await import("/pb/fouer/layout.js"); const D = await import("/pb/fouer/data.js");
      const T = window.THREE; const out = { models: {}, fairs: {}, fronts: {}, n: 0 };
      for (const id of ids) for (const level of [1, 2, 3, 4]) for (const look of [0, 1, 2]) {
        const g = M.buildModel(id, { look, level, quality: "medium", seed: 7, far: false }); g.updateMatrixWorld(true); out.n++;
        const r = A.auditFloating([A.sourcesFromGroup(g, id)], { groundY: () => 0 });
        for (const f of [...r.floating.map(x => x.why), ...r.bulbs.slice(0, 2).map(x => x.why)]) (out.models[id] = out.models[id] || []).push(`L${level} look ${look}: ${f}`);
        g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      }
      const pitches = D.PITCHES.map(p => ({ id: p.id, u: p.u, w: p.w, size: p.size, face: p.face, star: p.star }));
      const npc = await import("/pb/fouer/models/npc.js"), props = await import("/pb/fouer/models/props.js"), clutter = await import("/pb/fouer/models/clutter.js");
      for (const seed of [1, 4]) {
        const common = { T, fieldPoly: [...L.FIELD_POLY], groundY: () => 0, seed, quality: "medium" };
        const fair = npc.buildNpcFair({ ...common, pitches, lane: [] }); const pr = props.buildProps({ ...common, pitches }); const cl = clutter.buildClutter({ ...common, grid: fair.grid, gridDims: fair.gridDims, pitches, stalls: fair.stalls });
        const srcs = [fair.group, pr.group, cl.group].map((g, i) => { g.updateMatrixWorld(true); return A.sourcesFromGroup(g, ["npc", "props", "clutter"][i]); });
        const r = A.auditFloating(srcs, { groundY: () => 0 });
        out.fairs[`seed ${seed}`] = [...r.floating.map(x => `${x.id}: ${x.why}`), ...r.bulbs.slice(0, 3).map(x => x.why)];
        out.fronts[`seed ${seed}`] = L.validateStallFronts({ pitches: D.PITCHES.map(p => ({ ...p })), stalls: fair.stalls }).slice(0, 5);
        out.fronts[`seed ${seed} lots`] = [fair.stalls.filter(x => x.k === "lot").length, fair.stalls.filter(x => x.k !== "lot").length];
      }
      return out;
    }, MINE);
    for (const [id, list] of Object.entries(air.models)) h.eq(list.slice(0, 3), [], `${id}: nothing floats (${list.length} offenders)`);
    h.eq(Object.keys(air.models).length, 0, `all ${air.n} model builds (${MINE.length} items x 4 levels x 3 looks) are free of floating pieces`);
    for (const [k, list] of Object.entries(air.fairs)) h.eq(list.slice(0, 3), [], `NPC fair + props + clutter (${k}): nothing floats (${list.length} offenders)`);
    for (const k of ["seed 1", "seed 4"]) h.eq(air.fronts[k], [], `NPC fair (${k}): every stall front opens onto a walkway, none looks at the back of another stall or a plot, no identical skins side by side`);
    h.expect(air.fronts["seed 1 lots"][1] >= 60, `the fair is still dense: ${air.fronts["seed 1 lots"][1]} shop fronts and ${air.fronts["seed 1 lots"][0]} back-of-house lots / tents`);

    h.eq(errors, [], "zero console errors in the full fair");
  },
};

runIfMain(import.meta.url, flow);
