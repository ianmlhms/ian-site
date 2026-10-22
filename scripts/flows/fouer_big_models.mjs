/* Flow — Schueberfouer Tycoon W4a "Big wheel and towers": pb/fouer/preview-big.html (the W2 Glacis world with the Riserad and the four tall rides on their pitches).
 * Boots with zero console errors; every model builds at all looks x levels x qualities with a finite, in-pitch ground footprint; the wheel rotates and its gondolas stay
 * upright (gondolaAnchor + the CPU-moved cabin vertices); the drop tower, tower swing, booster arm and pendulum arm run their cycles and come back to rest; LOD + the
 * nearest-N animation rule; the draw-call / triangle budget at the frame-the-field preset; night follows 0.45 + 0.55 k; no real brand or showman names in the sources. */
import fs from "node:fs";
import path from "node:path";
import { REPO, runIfMain } from "./lib.mjs";

const URL = "/pb/fouer/preview-big.html?fouerNoFly=1&fouerQ=medium&hud=0&time=evening&level=4&lod=auto";
const IDS = ["wheel", "jules", "hangover", "booster", "infinity"];
const BUDGET = { allDraws: 20, allTris: 35000, wheelDraws: 8, wheelTris: 15000 };
const FILES = ["pb/fouer/models/wheel.js", "pb/fouer/models/towers.js", "pb/fouer/models/big-kit.js", "pb/fouer/preview-big.html"];
const FORBIDDEN = /bellevue|jules verne|booster ?maxx|power ?tower|schneider|infinity ?tower|hangover ?the|alpina|olympia|l[aä]mmy/i;

export const flow = {
  name: "fouer-big-models",
  fullChromium: true,
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    h.step("boot preview-big.html: world + 5 models, no console errors, no boot error");
    await h.goto(URL);
    await page.waitForFunction(() => document.documentElement.dataset.fouerReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 90000 });
    await h.pause(1000);
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "no boot error");
    h.eq(errors, [], "zero console errors while booting");
    h.eq(await page.evaluate(() => Object.keys(window.__big.groups).sort()), [...IDS].sort(), "the five big rides stand on their pitches");
    await h.shot("boot");

    h.step("every model builds at all looks x levels x qualities; footprint finite and inside its pitch");
    const builds = await page.evaluate((ids) => {
      const B = window.__big; const T = B.THREE; const out = []; const bad = [];
      const PITCH = { wheel: { x: 12, zMin: -20, zMax: 20 }, jules: { x: 8, zMin: -8, zMax: 8 }, hangover: { x: 8, zMin: -8, zMax: 8 }, infinity: { x: 8, zMin: -8, zMax: 8 }, booster: { x: 15, zMin: -9, zMax: 9 } };
      const v = new T.Vector3();
      const footOf = (root) => {
        root.updateMatrixWorld(true); const f = { minx: 1e9, maxx: -1e9, minz: 1e9, maxz: -1e9, finite: true, maxy: -1e9 };
        root.traverse((o) => {
          if (!(o.isMesh || o.isLineSegments)) return;
          const pos = o.geometry.attributes.position; const arr = pos.array;
          for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) f.finite = false;
          if (!o.isMesh) return;
          const lim = o.name.includes("static") ? 6 : 3;     // ground structures count up to 6 m, swinging parts only near the ground (they fly out high above it)
          for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); f.maxy = Math.max(f.maxy, v.y); if (v.y > lim || v.y < -1) continue; f.minx = Math.min(f.minx, v.x); f.maxx = Math.max(f.maxx, v.x); f.minz = Math.min(f.minz, v.z); f.maxz = Math.max(f.maxz, v.z); }
        });
        return f;
      };
      for (const id of ids) for (const look of [0, 1, 2]) for (const level of [1, 2, 3, 4]) for (const quality of ["low", "medium", "high"]) {
        const g = B.MODELS[id].build({ look, level, quality, seed: 3 });
        const ud = g.userData; const tag = `${id} L${level} look${look} ${quality}`;
        const api = ["animate", "setNight", "setLOD", "setAnimated"].every((k) => typeof ud[k] === "function");
        const nearG = g.getObjectByName("near"); const farG = g.getObjectByName("far");
        const feet = [];
        for (const sub of [nearG, farG]) if (sub) feet.push(footOf(sub));
        const P = PITCH[id]; const tol = 0.35;
        for (const f of feet) {
          if (!f.finite) bad.push(`${tag}: non-finite vertex`);
          if (f.minx < -P.x - tol || f.maxx > P.x + tol || f.minz < P.zMin - tol || f.maxz > P.zMax + tol) bad.push(`${tag}: footprint x ${f.minx.toFixed(1)}..${f.maxx.toFixed(1)} z ${f.minz.toFixed(1)}..${f.maxz.toFixed(1)} outside the pitch`);
        }
        ud.setLOD(1); const sNear = ud.stats(); ud.setLOD(0); const sFar = ud.stats();
        out.push({ tag, id, level, quality, api, name: g.name, hasNear: !!nearG, tn: sNear.tris, dn: sNear.draws, tf: sFar.tris, df: sFar.draws });
        if (g.name !== id) bad.push(`${tag}: group name ${g.name}`); if (!api) bad.push(`${tag}: missing API`);
        if (quality === "low" && nearG) bad.push(`${tag}: low quality should build the far model only`);
        ud.dispose();
      }
      return { n: out.length, bad, out };
    }, IDS);
    h.expect(builds.n === 180, `${builds.n} builds (5 models x 3 looks x 4 levels x 3 qualities)`);
    const badShort = [...new Set(builds.bad.map((m) => m.replace(/ (look\d|L\d|low|medium|high)/g, "").replace(/^(\w+).*?: /, "$1: ")))].slice(0, 12);
    h.eq(badShort, [], "all builds finite, API complete, footprints inside the pitch");
    const pick = (id, level, q) => builds.out.find((o) => o.id === id && o.level === level && o.quality === q);
    for (const id of IDS) { const a = pick(id, 1, "medium"); const b = pick(id, 4, "medium"); h.expect(b.tn > a.tn, `${id}: level 4 has more geometry than level 1 (${a.tn} -> ${b.tn} triangles)`); }
    const wn = pick("wheel", 4, "medium"); const wf = pick("wheel", 4, "low");
    h.expect(wn.dn <= BUDGET.wheelDraws && wn.tn <= BUDGET.wheelTris, `wheel near L4 medium: ${wn.dn} draws, ${wn.tn} triangles (<= ${BUDGET.wheelDraws} / ${BUDGET.wheelTris})`);
    h.expect(wf.dn <= BUDGET.wheelDraws && wf.tn <= BUDGET.wheelTris, `wheel far L4: ${wf.dn} draws, ${wf.tn} triangles`);
    const farAll = IDS.map((id) => pick(id, 4, "medium")); const farDraws = farAll.reduce((a, o) => a + o.df, 0); const farTris = farAll.reduce((a, o) => a + o.tf, 0);
    h.expect(farDraws <= BUDGET.allDraws && farTris <= BUDGET.allTris, `all five far at L4: ${farDraws} draws, ${farTris} triangles (<= ${BUDGET.allDraws} / ${BUDGET.allTris})`);

    h.step("the Riserad rotates, gondolas stay upright (anchors + the cabin vertices), ride API for the first-person camera");
    const wheel = await page.evaluate(() => {
      const B = window.__big; const T = B.THREE; const g = B.MODELS.wheel.build({ look: 0, level: 4, quality: "medium", seed: 1 }); const ud = g.userData; ud.setLOD(1);
      const rotor = ud.parts.near.rotor; const r0 = rotor.rotation.z; const sizes = []; const pos = ud.parts.near.gondolaMesh.geometry.attributes.position; const dyn = ud.parts.near.gDyn;
      const box = (i) => { const [s, n] = dyn.ranges[i]; const b = new T.Box3(); const v = new T.Vector3(); for (let k = s; k < s + n; k++) b.expandByPoint(v.fromBufferAttribute(pos, k)); return b; };
      const b0 = box(5); const size0 = b0.getSize(new T.Vector3());
      let maxDev = 0; let minUp = 1; let radiusErr = 0; let zErr = 0; let sizeErr = 0; const angles = []; let tt = 0;
      for (let step = 0; step < 12; step++) {
        for (let k = 0; k < 10; k++) { tt += 1.3; ud.animate(tt, 1.3, 0); }
        angles.push(ud.ride.angle());
        const hub = ud.hubWorld();
        for (let i = 0; i < ud.ride.count; i += 3) {
          const a = ud.gondolaAnchor(i); minUp = Math.min(minUp, a.up.y);
          radiusErr = Math.max(radiusErr, Math.abs(Math.hypot(a.pivot.x - hub.x, a.pivot.y - hub.y) - 23.4)); zErr = Math.max(zErr, Math.abs(a.pivot.z - hub.z));
          const b = box(i); const sz = b.getSize(new T.Vector3()); sizeErr = Math.max(sizeErr, Math.abs(sz.x - size0.x), Math.abs(sz.y - size0.y), Math.abs(sz.z - size0.z));
          const c = b.getCenter(new T.Vector3()); maxDev = Math.max(maxDev, Math.abs(c.x - a.pivot.x));
        }
      }
      const r1 = rotor.rotation.z; const a = ud.gondolaAnchor(0);
      const bi = ud.ride.boardingIndex(); const board = ud.ride.board();
      const res = { rotated: Math.abs(r1 - r0) > 0.05, angles: angles.length, distinct: new Set(angles.map((x) => x.toFixed(2))).size, minUp, radiusErr, zErr, sizeErr, maxDev, count: ud.ride.count, period: ud.ride.period, anchorKeys: Object.keys(a).sort(), qOK: Math.abs(a.quaternion.length() - 1) < 1e-6, bi, boardOK: typeof board.radius === "number" && board.position.isVector3 };
      ud.dispose(); return res;
    });
    h.expect(wheel.rotated && wheel.distinct >= 8, `rotor turns (${wheel.distinct} distinct angles over the run)`);
    h.expect(wheel.minUp > 0.99999, `every gondolaAnchor is upright (min up.y ${wheel.minUp.toFixed(6)})`);
    h.expect(wheel.radiusErr < 0.01 && wheel.zErr < 0.01, `anchors stay on the 23.4 m rim circle in the wheel plane (err ${wheel.radiusErr.toExponential(1)})`);
    h.expect(wheel.sizeErr < 1e-4, `cabin geometry is only translated, never rotated (size drift ${wheel.sizeErr.toExponential(1)})`);
    h.expect(wheel.maxDev < 0.02, `cabin vertices follow the anchors (x offset ${wheel.maxDev.toExponential(1)})`);
    h.expect(wheel.count >= 40 && wheel.count <= 48 && wheel.period > 20, `ride API: ${wheel.count} gondolas, period ${wheel.period} s, anchor keys ${wheel.anchorKeys.join(",")}`);
    h.expect(wheel.qOK && wheel.boardOK, "anchor quaternion is a unit quaternion, ride.board() gives a platform point");

    h.step("tower cycles: drop tower rises and drops, swing crown rises and spins, booster arm turns 7 times, pendulum swings +-100 deg; all return to rest");
    const cyc = await page.evaluate(() => {
      const B = window.__big; const out = {};
      const run = (id, sample) => {
        const g = B.MODELS[id].build({ look: 0, level: 3, quality: "medium", seed: 2 }); g.userData.setLOD(1); const P = g.userData.cycle; const ud = g.userData; const rows = [];
        for (let t = 0; t <= P + 0.001; t += 0.1) { ud.animate(t, 0.1, 0); rows.push(sample(ud, t)); }
        const res = { P, rows }; ud.dispose(); return res;
      };
      const h1 = run("hangover", (ud) => ud.parts.near.ring.position.y); const ys = h1.rows;
      let vmin = 0; for (let i = 1; i < ys.length; i++) vmin = Math.min(vmin, (ys[i] - ys[i - 1]) / 0.1);
      out.drop = { P: h1.P, ymin: Math.min(...ys), ymax: Math.max(...ys), y0: ys[0], yEnd: ys[ys.length - 1], vmin, matchesPhase: Math.abs(ys[100] - B.MODELS.hangover.build({ quality: "medium" }).userData.phaseAt(10).y) < 1e-6 };
      const j1 = run("jules", (ud) => [ud.parts.near.crown.position.y, ud.rig.theta, ud.rig.w]); const jy = j1.rows.map((r) => r[0]);
      out.swing = { P: j1.P, ymin: Math.min(...jy), ymax: Math.max(...jy), yEnd: jy[jy.length - 1], wmax: Math.max(...j1.rows.map((r) => r[2])), wEnd: j1.rows[j1.rows.length - 1][2] };
      const b1 = run("booster", (ud) => [ud.parts.near.arm.rotation.z, ud.rig.raw]); out.booster = { P: b1.P, turns: Math.max(...b1.rows.map((r) => r[1])) / (2 * Math.PI), aEnd: b1.rows[b1.rows.length - 1][0], a0: b1.rows[0][0] };
      const i1 = run("infinity", (ud) => ud.parts.near.arm.rotation.x); out.pend = { P: i1.P, max: Math.max(...i1.rows), min: Math.min(...i1.rows), end: i1.rows[i1.rows.length - 1] };
      return out;
    });
    h.expect(cyc.drop.ymin < 3.7 && cyc.drop.ymax > 79 && Math.abs(cyc.drop.yEnd - cyc.drop.y0) < 0.05, `drop tower ring ${cyc.drop.ymin.toFixed(1)}..${cyc.drop.ymax.toFixed(1)} m, back at ${cyc.drop.yEnd.toFixed(2)} m after ${cyc.drop.P} s`);
    h.expect(cyc.drop.vmin < -30, `drop tower falls fast (${cyc.drop.vmin.toFixed(1)} m/s peak) after a slow rise`);
    h.expect(cyc.swing.ymin < 7.5 && cyc.swing.ymax > 62 && Math.abs(cyc.swing.yEnd - cyc.swing.ymin) < 0.05 && cyc.swing.wmax === 1 && cyc.swing.wEnd === 0, `swing crown ${cyc.swing.ymin.toFixed(1)}..${cyc.swing.ymax.toFixed(1)} m, full spin, stopped at the end`);
    h.expect(cyc.booster.turns > 6.9 && (cyc.booster.aEnd < 0.05 || cyc.booster.aEnd > 2 * Math.PI - 0.05), `booster arm: ${cyc.booster.turns.toFixed(2)} turns, home at the end`);
    h.expect(cyc.pend.max > 1.5 && cyc.pend.min < -1.5 && Math.abs(cyc.pend.end) < 0.02, `pendulum swings ${cyc.pend.min.toFixed(2)}..${cyc.pend.max.toFixed(2)} rad, rests at ${cyc.pend.end.toFixed(3)}`);

    h.step("night: lamp scalar follows 0.45 + 0.55 k, window glow and self-lit paint ramp with k");
    const night = await page.evaluate(() => {
      const g = window.__big.MODELS.jules.build({ look: 0, level: 2, quality: "medium" }); const u = g.userData.uniforms; const o = {};
      for (const k of [0, 0.5, 1]) { g.userData.setNight(k); o[k] = { lamp: u.uLamp.value, night: u.uNight.value, glow: u.uGlow.value, line: g.userData.lineMaterial.color.r }; }
      g.userData.dispose(); return o;
    });
    h.expect(Math.abs(night[0].lamp - 0.45) < 1e-9 && Math.abs(night[0.5].lamp - 0.725) < 1e-9 && Math.abs(night[1].lamp - 1) < 1e-9, "lamp scalar 0.45 / 0.725 / 1.0 at k = 0 / 0.5 / 1");
    h.expect(night[0].night === 0 && night[1].night === 1 && night[1].glow > night[0].glow, "night-only glow and self-lit paint ramp");

    h.step("LOD + nearest-N rule: only the nearest rides get the full model and animate");
    const lod = await page.evaluate(() => {
      const B = window.__big; const r = B.r; B.state.lodMode = "auto"; B.state.nearN = 2;
      const g = B.groups; const jr = g.jules.userData.rect;
      r.setFreeCamera({ eye: [jr.u + 30, g.jules.position.y + 6, jr.w - 40], look: [jr.u, g.jules.position.y + 25, jr.w], fov: 40 }); B.applyLod();
      const near = Object.fromEntries(Object.entries(g).map(([id, m]) => [id, [m.userData.lod, m.userData.animated]]));
      const w0 = g.wheel.userData.parts.far.rotor.rotation.z; const j0 = g.jules.userData.parts.near.crown.position.y;
      B.state.animate = true; B.advance(0.5, 40);
      const w1 = g.wheel.userData.parts.far.rotor.rotation.z; const j1 = g.jules.userData.parts.near.crown.position.y;
      r.setPose(r.framePose(), true); B.applyLod();
      const farAll = Object.fromEntries(Object.entries(g).map(([id, m]) => [id, m.userData.lod]));
      return { near, frozenWheel: w0 === w1, juleMoved: j0 !== j1, farAll };
    });
    h.eq(lod.near.jules, [1, true], "the nearest ride (within 80 m) is the full model and animates");
    h.eq(lod.near.wheel, [0, false], "a far ride is the lean model and frozen (nearest-N = 2)");
    h.expect(lod.frozenWheel && lod.juleMoved, "frozen ride keeps its pose while the near one keeps moving");
    h.eq(Object.values(lod.farAll), [0, 0, 0, 0, 0], "at the frame-the-field preset every ride is the far model");

    h.step("budget at the frame-the-field preset (renderer.info delta with and without the rides)");
    const rinfo = await page.evaluate(() => {
      const B = window.__big; const r = B.r; r.setPose(r.framePose(), true); B.state.lodMode = "auto"; B.applyLod(); B.pause();
      B.render(); const withRides = B.snapshot();
      for (const g of Object.values(B.groups)) g.visible = false; B.render(); const without = B.snapshot();
      for (const g of Object.values(B.groups)) g.visible = true;
      const own = {}; let ownDraws = 0; let ownTris = 0; for (const [id, g] of Object.entries(B.groups)) { const s = g.userData.stats(); own[id] = s; ownDraws += s.draws; ownTris += s.tris; }
      B.resume();
      return { dDraws: withRides.drawCalls - without.drawCalls, dTris: withRides.triangles - without.triangles, ownDraws, ownTris, own, total: withRides.drawCalls, totalTris: withRides.triangles };
    });
    h.expect(rinfo.dDraws <= BUDGET.allDraws && rinfo.dTris <= BUDGET.allTris, `renderer.info delta: ${rinfo.dDraws} draw calls, ${rinfo.dTris} triangles (<= ${BUDGET.allDraws} / ${BUDGET.allTris}); per model ${IDS.map((id) => `${id} ${rinfo.own[id].draws}/${rinfo.own[id].tris}`).join(", ")}`);
    h.expect(rinfo.own.wheel.draws <= BUDGET.wheelDraws && rinfo.own.wheel.tris <= BUDGET.wheelTris, `wheel alone: ${rinfo.own.wheel.draws} draws, ${rinfo.own.wheel.tris} triangles`);

    h.step("no real brand or showman names in the shipped sources");
    const hits = [];
    for (const f of FILES) { const text = fs.readFileSync(path.join(REPO, f), "utf8"); text.split("\n").forEach((line, i) => { if (FORBIDDEN.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`); }); }
    h.eq(hits, [], "no Bellevue / Jules Verne / Booster Maxxx / Power Tower / showman names");

    h.step("a few frames of the animated scene stay error free");
    await page.evaluate(() => { const B = window.__big; B.setTime("night"); B.state.lodMode = "near"; B.applyLod(); B.resume(); });
    await h.pause(1500);
    await page.evaluate(() => { const B = window.__big; B.setTime("noon"); B.state.lodMode = "far"; B.applyLod(); });
    await h.pause(800);
    await h.shot("far");
    h.eq(errors, [], "still zero console errors at the end");
  },
};

runIfMain(import.meta.url, flow);
