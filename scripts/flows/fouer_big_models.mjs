/* Flow — Schueberfouer Tycoon W4a "Big wheel and towers" + W4b "Coasters and halls": pb/fouer/preview-big.html (the W2 Glacis world with the Riserad, the four tall rides,
 * the four coaster / water rides and the three halls on their pitches).  The W4b steps (further down) build the seven W4b models at every look x level x quality, check
 * that everything stays inside the pitch, that the trains / boats / carts complete a circuit and stay on their track, the bumper cars and the spray, the far / near budget
 * and the CPU cost of the animation.  W4a part:
 * Boots with zero console errors; every model builds at all looks x levels x qualities with a finite, in-pitch ground footprint; the wheel rotates and its gondolas stay
 * upright (gondolaAnchor + the CPU-moved cabin vertices); the drop tower, tower swing, booster arm and pendulum arm run their cycles and come back to rest; LOD + the
 * nearest-N animation rule; the draw-call / triangle budget at the frame-the-field preset; night follows 0.45 + 0.55 k; no real brand or showman names in the sources. */
import fs from "node:fs";
import path from "node:path";
import { REPO, runIfMain } from "./lib.mjs";

const URL = "/pb/fouer/preview-big.html?fouerNoFly=1&fouerQ=medium&hud=0&time=evening&level=4&lod=auto";
const IDS = ["wheel", "jules", "hangover", "booster", "infinity"];
const IDS_B = ["maus", "looping", "alpina", "splash", "geister", "scooter", "tent"];
const ALL_IDS = [...IDS, ...IDS_B];
const PITCH_B = { maus: { x: 15, zMin: -9, zMax: 9 }, geister: { x: 15, zMin: -9, zMax: 9 }, splash: { x: 15, zMin: -9, zMax: 9 }, scooter: { x: 15, zMin: -9, zMax: 9 }, tent: { x: 15, zMin: -9, zMax: 9 }, alpina: { x: 28, zMin: -15, zMax: 15 }, looping: { x: 28, zMin: -15, zMax: 15 } };
const BUDGET_B = { allDraws: 20, allTris: 35000, nearDraws: 6, nearTris: 12000, animateMs: 1.5 };
const FILES_B = ["pb/fouer/models/coasters.js", "pb/fouer/models/coaster-kit.js", "pb/fouer/models/coaster-props.js", "pb/fouer/models/coaster-maus.js", "pb/fouer/models/coaster-looping.js", "pb/fouer/models/coaster-alpina.js", "pb/fouer/models/coaster-splash.js",
  "pb/fouer/models/halls.js", "pb/fouer/models/hall-scooter.js", "pb/fouer/models/hall-geister.js", "pb/fouer/models/hall-tent.js"];
const FORBIDDEN_B = /olympia|big ?splash|thriller|bellevue|booster ?maxx|jules verne|oscar ?bruch|schneider|alpina[ -]?bahn|burg des grauens|l[aä]mmy|bayern ?kurve/i;
const BUDGET = { allDraws: 20, allTris: 35000, wheelDraws: 8, wheelTris: 15000 };
const FILES = ["pb/fouer/models/wheel.js", "pb/fouer/models/towers.js", "pb/fouer/models/big-kit.js", "pb/fouer/preview-big.html"];
const FORBIDDEN = /bellevue|jules verne|booster ?maxx|power ?tower|schneider|infinity ?tower|hangover ?the|alpina[ -]?bahn|olympia|l[aä]mmy/i;

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
    h.eq(await page.evaluate(() => Object.keys(window.__big.groups).sort()), [...ALL_IDS].sort(), "the twelve big rides, coasters and halls stand on their pitches");
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
    const lod = await page.evaluate((idsA) => {
      const B = window.__big; const r = B.r; B.state.lodMode = "auto"; B.state.nearN = 2;
      for (const [id, m] of Object.entries(B.groups)) m.visible = idsA.includes(id);
      const g = Object.fromEntries(Object.entries(B.groups).filter(([id]) => idsA.includes(id))); const jr = g.jules.userData.rect;
      r.setFreeCamera({ eye: [jr.u + 30, g.jules.position.y + 6, jr.w - 40], look: [jr.u, g.jules.position.y + 25, jr.w], fov: 40 }); B.applyLod();
      const near = Object.fromEntries(Object.entries(g).map(([id, m]) => [id, [m.userData.lod, m.userData.animated]]));
      const w0 = g.wheel.userData.parts.far.rotor.rotation.z; const j0 = g.jules.userData.parts.near.crown.position.y;
      B.state.animate = true; B.advance(0.5, 40);
      const w1 = g.wheel.userData.parts.far.rotor.rotation.z; const j1 = g.jules.userData.parts.near.crown.position.y;
      r.setPose(r.framePose(), true); B.applyLod();
      const farAll = Object.fromEntries(Object.entries(g).map(([id, m]) => [id, m.userData.lod]));
      for (const m of Object.values(B.groups)) m.visible = true;
      return { near, frozenWheel: w0 === w1, juleMoved: j0 !== j1, farAll };
    }, IDS);
    h.eq(lod.near.jules, [1, true], "the nearest ride (within 80 m) is the full model and animates");
    h.eq(lod.near.wheel, [0, false], "a far ride is the lean model and frozen (nearest-N = 2)");
    h.expect(lod.frozenWheel && lod.juleMoved, "frozen ride keeps its pose while the near one keeps moving");
    h.eq(Object.values(lod.farAll), [0, 0, 0, 0, 0], "at the frame-the-field preset every ride is the far model");

    h.step("budget at the frame-the-field preset (renderer.info delta with and without the rides)");
    const rinfo = await page.evaluate((idsA) => {
      const B = window.__big; const r = B.r; r.setPose(r.framePose(), true); B.state.lodMode = "auto";
      const mine = Object.entries(B.groups).filter(([id]) => idsA.includes(id)).map(([, g]) => g); const others = Object.entries(B.groups).filter(([id]) => !idsA.includes(id)).map(([, g]) => g);
      for (const g of others) g.visible = false; B.applyLod(); B.pause();
      B.render(); const withRides = B.snapshot();
      for (const g of mine) g.visible = false; B.render(); const without = B.snapshot();
      for (const g of Object.values(B.groups)) g.visible = true;
      const own = {}; let ownDraws = 0; let ownTris = 0; for (const [id, g] of Object.entries(B.groups)) { if (!idsA.includes(id)) continue; const s = g.userData.stats(); own[id] = s; ownDraws += s.draws; ownTris += s.tris; }
      B.applyLod(); B.resume();
      return { dDraws: withRides.drawCalls - without.drawCalls, dTris: withRides.triangles - without.triangles, ownDraws, ownTris, own, total: withRides.drawCalls, totalTris: withRides.triangles };
    }, IDS);
    h.expect(rinfo.dDraws <= BUDGET.allDraws && rinfo.dTris <= BUDGET.allTris, `renderer.info delta: ${rinfo.dDraws} draw calls, ${rinfo.dTris} triangles (<= ${BUDGET.allDraws} / ${BUDGET.allTris}); per model ${IDS.map((id) => `${id} ${rinfo.own[id].draws}/${rinfo.own[id].tris}`).join(", ")}`);
    h.expect(rinfo.own.wheel.draws <= BUDGET.wheelDraws && rinfo.own.wheel.tris <= BUDGET.wheelTris, `wheel alone: ${rinfo.own.wheel.draws} draws, ${rinfo.own.wheel.tris} triangles`);

    /* ================================================================================================ W4b */
    h.step("W4b: the seven coaster / hall models build at every look x level x quality; finite; API complete; everything inside the pitch");
    const bb = await page.evaluate(({ ids, pitches }) => {
      const B = window.__big; const T = B.THREE; const out = []; const bad = []; const v = new T.Vector3();
      const inside = (root, P, tag) => {
        root.updateMatrixWorld(true); let fin = true; let n = 0;
        root.traverse((o) => {
          if (!(o.isMesh || o.isLineSegments)) return;
          const pos = o.geometry.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
            if (!Number.isFinite(v.x + v.y + v.z)) { fin = false; continue; }
            if (v.y < -1.2) continue;
            const tol = 0.35;
            if (v.x < -P.x - tol || v.x > P.x + tol || v.z < P.zMin - tol || v.z > P.zMax + tol) { if (n++ < 1) bad.push(`${tag}: vertex ${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)} outside the pitch (x +-${P.x}, z ${P.zMin}..${P.zMax})`); }
          }
        });
        if (!fin) bad.push(`${tag}: non-finite vertex`);
      };
      for (const id of ids) for (const look of [0, 1, 2]) for (const level of [1, 2, 3, 4]) for (const quality of ["low", "medium", "high"]) {
        const g = B.MODELS[id].build({ look, level, quality, seed: 3 }); const ud = g.userData; const tag = `${id} L${level} look${look} ${quality}`;
        const api = ["animate", "setNight", "setLOD", "setAnimated", "stats", "dispose"].every((k) => typeof ud[k] === "function") && Number.isFinite(ud.cycle) && Number.isFinite(ud.height) && ud.footprint && typeof ud.footprint.x === "number";
        const nearG = g.getObjectByName("near"); const farG = g.getObjectByName("far");
        for (const sub of [nearG, farG]) if (sub) inside(sub, pitches[id], tag);
        ud.setLOD(1); const sNear = ud.stats(); ud.setLOD(0); const sFar = ud.stats();
        if (!api) bad.push(`${tag}: API incomplete`); if (g.name !== id) bad.push(`${tag}: group name ${g.name}`); if (quality === "low" && nearG) bad.push(`${tag}: low quality has a near model`); if (quality !== "low" && !nearG) bad.push(`${tag}: no near model`);
        out.push({ id, level, look, quality, tn: sNear.tris, dn: sNear.draws, tf: sFar.tris, df: sFar.draws });
        ud.dispose();
      }
      return { n: out.length, bad, out };
    }, { ids: IDS_B, pitches: PITCH_B });
    h.expect(bb.n === IDS_B.length * 36, `${bb.n} builds (7 models x 3 looks x 4 levels x 3 qualities)`);
    h.eq([...new Set(bb.bad.map((m) => m.replace(/ (look\d|L\d|low|medium|high)/g, "").replace(/\d+\.\d/g, "#")))].slice(0, 12), [], "finite, API complete, near / far present, every vertex of every model inside its pitch");
    const pickB = (id, level, q, look = 0) => bb.out.find((o) => o.id === id && o.level === level && o.quality === q && o.look === look);
    for (const id of IDS_B) { const a = pickB(id, 1, "medium"); const b4 = pickB(id, 4, "medium"); h.expect(b4.tn > a.tn, `${id}: level 4 has more geometry than level 1 (${a.tn} -> ${b4.tn} triangles near)`); }
    const worst = IDS_B.map((id) => { let n = { d: 0, t: 0 }; for (const look of [0, 1, 2]) for (const level of [1, 2, 3, 4]) { const o = pickB(id, level, "medium", look); n = { d: Math.max(n.d, o.dn), t: Math.max(n.t, o.tn) }; } return [id, n]; });
    h.expect(worst.every(([, n]) => n.d <= BUDGET_B.nearDraws && n.t <= BUDGET_B.nearTris), `near budget (<= ${BUDGET_B.nearDraws} draws / ${BUDGET_B.nearTris} triangles) over all looks and levels: ${worst.map(([id, n]) => `${id} ${n.d}/${n.t}`).join(", ")}`);
    const farWorst = [0, 1, 2].map((look) => IDS_B.reduce((a, id) => { const o = pickB(id, 4, "medium", look); return { d: a.d + o.df, t: a.t + o.tf }; }, { d: 0, t: 0 }));
    h.expect(farWorst.every((f) => f.d <= BUDGET_B.allDraws && f.t <= BUDGET_B.allTris), `all seven far at L4 (per look): ${farWorst.map((f) => `${f.d} draws / ${f.t} triangles`).join(" | ")} (<= ${BUDGET_B.allDraws} / ${BUDGET_B.allTris})`);

    h.step("W4b: trains, boats and carts complete a circuit and stay on their track (and inside the pitch)");
    const trk = await page.evaluate(({ ids, pitches }) => {
      const B = window.__big; const T = B.THREE; const res = {};
      for (const id of ids) {
        const g = B.MODELS[id].build({ look: 0, level: 4, quality: "medium", seed: 2 }); const ud = g.userData; ud.setLOD(1); const P = ud.cycle; const L = ud.track.length; const near = ud.parts.near;
        // 1. the lead car's arc length runs 0 -> L once per cycle, never backwards
        let prev = ud.phaseAt(0).s; let back = 0; const N = 800; for (let i = 1; i <= N; i++) { const s = ud.phaseAt((P * i) / (N + 1)).s; if (s < prev - 1e-6) back = Math.max(back, prev - s); prev = s; }
        const sStart = ud.phaseAt(0).s; const sEnd = ud.phaseAt(P - 0.02).s; const sWrap = ud.phaseAt(P + 1e-6).s;
        // 2. cars follow the track: centroid of each visible car against the spline frame, extents inside the pitch
        const pos = near.cars.geometry.attributes.position; const ranges = near.dyn.ranges; const idx = near.carIdx; let maxOff = 0; let minLift = 9; let maxLift = -9; let samples = 0; let hiddenSeen = 0; let visibleSeen = 0; let outside = 0;
        const Pt = pitches[id]; const v = new T.Vector3();
        for (let k = 0; k < 60; k++) {
          const t = 0.31 + (k * P) / 60; ud.animate(t, 0.05, 0); const frames = ud.carFrames(t);
          for (let q = 0; q < ranges.length; q++) {
            const [ti, j] = idx[q]; if (!frames[ti]) continue; const [s0, n] = ranges[q]; let cx = 0; let cy = 0; let cz = 0; let mnx = 1e9; let mxx = -1e9;
            for (let i = s0; i < s0 + n; i++) { cx += pos.getX(i); cy += pos.getY(i); cz += pos.getZ(i); mnx = Math.min(mnx, pos.getX(i)); mxx = Math.max(mxx, pos.getX(i)); }
            cx /= n; cy /= n; cz /= n; if (mxx - mnx < 1e-6) { hiddenSeen++; continue; }
            visibleSeen++; const f = frames[ti][j].f; const dx = cx - f.p[0]; const dy = cy - f.p[1]; const dz = cz - f.p[2]; const off = Math.hypot(dx, dy, dz); const lift = dx * f.u[0] + dy * f.u[1] + dz * f.u[2];
            maxOff = Math.max(maxOff, off); minLift = Math.min(minLift, lift); maxLift = Math.max(maxLift, lift); samples++;
            for (let i = s0; i < s0 + n; i++) { v.fromBufferAttribute(pos, i); if (v.x < -Pt.x - 0.35 || v.x > Pt.x + 0.35 || v.z < Pt.zMin - 0.35 || v.z > Pt.zMax + 0.35) outside++; }
          }
        }
        res[id] = { P, L, back, sStart, sEnd, sWrap, maxOff, minLift, maxLift, samples, hiddenSeen, visibleSeen, outside, ridePath: typeof ud.ridePath === "function" ? (() => { const r = ud.ridePath(3); return { ok: r.position.isVector3 && r.forward.isVector3 && Number.isFinite(r.position.x) && Math.abs(r.forward.length() - 1) < 1e-6, speed: r.speed }; })() : null };
        ud.dispose();
      }
      return res;
    }, { ids: ["maus", "looping", "alpina", "splash", "geister"], pitches: PITCH_B });
    for (const [id, r] of Object.entries(trk)) {
      h.expect(r.back < 1e-3 && r.sStart === 0 && r.sEnd > r.L * 0.97 && r.sWrap < 1, `${id}: one lap per cycle (${r.P.toFixed(1)} s, ${r.L.toFixed(0)} m, arc length 0 -> ${r.sEnd.toFixed(0)} and wraps, never backwards)`);
      h.expect(r.samples > 20 && r.maxOff < 2.6 && r.minLift > -0.2 && r.maxLift < 2.2, `${id}: ${r.samples} car samples stay on the track (max offset ${r.maxOff.toFixed(2)} m, height above the rail ${r.minLift.toFixed(2)}..${r.maxLift.toFixed(2)} m)`);
      h.expect(r.outside === 0, `${id}: every car stays inside the pitch (${r.outside} vertices outside)`);
      h.expect(r.ridePath && r.ridePath.ok, `${id}: ridePath(t) gives a world eye / forward / up (speed ${r.ridePath ? r.ridePath.speed.toFixed(1) : "?"} m/s)`);
    }
    h.expect(trk.geister.hiddenSeen > 10 && trk.geister.visibleSeen > 10, `geister: carts vanish into the building (${trk.geister.hiddenSeen} hidden vs ${trk.geister.visibleSeen} visible car samples)`);

    h.step("W4b: boats cycle with spray; bumper cars stay on the floor, move and loop; chandeliers turn");
    const misc = await page.evaluate(() => {
      const B = window.__big; const T = B.THREE; const out = {};
      { // splash: boats + droplets
        const g = B.MODELS.splash.build({ look: 0, level: 4, quality: "medium", seed: 4 }); const ud = g.userData; ud.setLOD(1); const near = ud.parts.near; const pos = near.cars.geometry.attributes.position; const ranges = near.dyn.ranges; const idx = near.carIdx;
        const live = (t) => { ud.animate(t, 0.05, 0); let drops = 0; let rings = 0; let boats = 0; for (let q = 0; q < ranges.length; q++) { const [s0, n] = ranges[q]; let mn = 1e9; let mx = -1e9; for (let i = s0; i < s0 + n; i++) { mn = Math.min(mn, pos.getX(i)); mx = Math.max(mx, pos.getX(i)); } if (mx - mn < 1e-6) continue; const ti = idx[q][0]; if (ti < 3) boats++; else if (ti === 3) drops++; else rings++; } return { drops, rings, boats }; };
        const hit = live(ud.tImpact + 0.4); const later = live(ud.tImpact + 1.7); const far = live(ud.tImpact + ud.cycle / 6 + 0.2);
        // y of boat 0 over a lap: climbs the lift (> 9 m) and comes back to the water
        let ymax = 0; let ymin = 99; for (let i = 0; i < 400; i++) { const y = ud.phaseAt((ud.cycle * i) / 400).y; ymax = Math.max(ymax, y); ymin = Math.min(ymin, y); }
        out.splash = { hit, later, far, ymax, ymin, impact: ud.impact }; ud.dispose();
      }
      { // scooter
        const g = B.MODELS.scooter.build({ look: 0, level: 4, quality: "medium", seed: 5 }); const ud = g.userData; const F = ud.floor; const P = ud.cycle; let bad = 0; let close = 0; let total = 0; let moved = 0; let maxD = 0;
        for (let k = 0; k < 120; k++) { const t = k * 0.7; const cars = ud.phaseAt(t).cars; for (const c of cars) if (c.x < F.x0 || c.x > F.x1 || c.z < F.z0 || c.z > F.z1) bad++; for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) { total++; if (Math.hypot(cars[i].x - cars[j].x, cars[i].z - cars[j].z) < 0.9) close++; } }
        const a = ud.phaseAt(1).cars; const b2 = ud.phaseAt(6).cars; a.forEach((c, i) => { moved += Math.hypot(c.x - b2[i].x, c.z - b2[i].z); }); moved /= a.length;
        const c0 = ud.phaseAt(3.3).cars; const c1 = ud.phaseAt(3.3 + P).cars; c0.forEach((c, i) => { maxD = Math.max(maxD, Math.hypot(c.x - c1[i].x, c.z - c1[i].z)); });
        out.scooter = { n: ud.phaseAt(0).cars.length, bad, closeFrac: close / total, moved, loopErr: maxD, P }; ud.dispose();
      }
      { // tent: the chandeliers turn
        const g = B.MODELS.tent.build({ look: 0, level: 3, quality: "medium", seed: 1 }); const ud = g.userData; ud.setLOD(1); const near = ud.parts.near; const pos = near.cars.geometry.attributes.position; const [s0] = near.dyn.ranges[0];
        ud.animate(0, 0, 0); const x0 = pos.getX(s0 + 3); const z0 = pos.getZ(s0 + 3); ud.animate(4, 0.05, 0); const x1 = pos.getX(s0 + 3); const z1 = pos.getZ(s0 + 3);
        out.tent = { moved: Math.hypot(x1 - x0, z1 - z0), chandeliers: near.carIdx.filter((c) => c[0] === 0).length }; ud.dispose();
      }
      return out;
    });
    h.expect(misc.splash.hit.boats === 3 && misc.splash.hit.drops >= 10 && misc.splash.hit.rings >= 1, `splash: three boats, ${misc.splash.hit.drops} droplets and ${misc.splash.hit.rings} ripple ring(s) right after a boat hits the pool`);
    h.expect(misc.splash.later.drops === 0 || misc.splash.later.drops < misc.splash.hit.drops, `splash: the spray dies down (${misc.splash.hit.drops} -> ${misc.splash.later.drops} droplets 1.3 s later)`);
    h.expect(misc.splash.ymax > 11 && misc.splash.ymin < 1.4, `splash: boats climb to ${misc.splash.ymax.toFixed(1)} m on the lift and come back to the water (${misc.splash.ymin.toFixed(2)} m)`);
    h.expect(misc.scooter.bad === 0 && misc.scooter.n >= 10 && misc.scooter.closeFrac < 0.02 && misc.scooter.moved > 2 && misc.scooter.loopErr < 1e-6, `scooter: ${misc.scooter.n} cars stay on the floor (${misc.scooter.bad} outside), bump apart (${(misc.scooter.closeFrac * 100).toFixed(2)} % of pairs under 0.9 m), drift ${misc.scooter.moved.toFixed(1)} m in 5 s and loop exactly after ${misc.scooter.P} s`);
    h.expect(misc.tent.chandeliers === 3 && misc.tent.moved > 0.3, `tent: ${misc.tent.chandeliers} ring chandeliers turn (a lamp moved ${misc.tent.moved.toFixed(2)} m in 4 s)`);

    h.step("W4b: LOD + nearest-N rule with the coasters and halls; quality low builds only the far model");
    const lodB = await page.evaluate((idsB) => {
      const B = window.__big; const r = B.r; B.state.lodMode = "auto"; B.state.nearN = 2;
      for (const [id, m] of Object.entries(B.groups)) m.visible = idsB.includes(id);
      const g = B.groups; const mr = g.maus.userData.rect;
      r.setFreeCamera({ eye: [mr.u + 10, g.maus.position.y + 8, mr.w - 35], look: [mr.u, g.maus.position.y + 9, mr.w], fov: 40 }); B.applyLod();
      const near = Object.fromEntries(Object.entries(g).filter(([id]) => idsB.includes(id)).map(([id, m]) => [id, [m.userData.lod, m.userData.animated]]));
      const carsPos = (m, part) => m.userData.parts[part].cars.geometry.attributes.position.array.slice(0, 60).join(",");
      const m0 = carsPos(g.maus, "near"); const l0 = carsPos(g.looping, "far");
      B.state.animate = true; B.advance(0.5, 30);
      const m1 = carsPos(g.maus, "near"); const l1 = carsPos(g.looping, "far");
      r.setPose(r.framePose(), true); B.applyLod();
      const farAll = Object.fromEntries(Object.entries(g).filter(([id]) => idsB.includes(id)).map(([id, m]) => [id, m.userData.lod]));
      for (const m of Object.values(B.groups)) m.visible = true;
      return { near, mausMoved: m0 !== m1, loopingFrozen: l0 === l1, farAll };
    }, IDS_B);
    h.eq(lodB.near.maus, [1, true], "the nearest coaster (within 80 m) is the full model and animates");
    h.eq(lodB.near.looping, [0, false], "a far coaster is the lean model and frozen");
    h.expect(lodB.mausMoved && lodB.loopingFrozen, "the near cars keep moving while the frozen ride keeps its pose");
    h.eq(Object.values(lodB.farAll), IDS_B.map(() => 0), "at the frame-the-field preset every W4b model is the far model");

    h.step("W4b: budget at the frame-the-field preset (renderer.info delta) and the CPU cost of animating the near models");
    const rinfoB = await page.evaluate(({ idsB, idsA }) => {
      const B = window.__big; const r = B.r; r.setPose(r.framePose(), true); B.state.lodMode = "auto";
      const mine = Object.entries(B.groups).filter(([id]) => idsB.includes(id)).map(([, g]) => g); const others = Object.entries(B.groups).filter(([id]) => !idsB.includes(id)).map(([, g]) => g);
      for (const g of others) g.visible = false; B.applyLod(); B.pause();
      B.render(); const withRides = B.snapshot();
      for (const g of mine) g.visible = false; B.render(); const without = B.snapshot();
      for (const g of Object.values(B.groups)) g.visible = true;
      const own = {}; let ownDraws = 0; let ownTris = 0; for (const [id, g] of Object.entries(B.groups)) { if (!idsB.includes(id)) continue; const s = g.userData.stats(); own[id] = s; ownDraws += s.draws; ownTris += s.tris; }
      // everything at once (the 12 big models) for the record
      B.applyLod(); B.render(); const all = B.snapshot();
      // animate cost, near LOD, level 4 (CPU skinning + lamp chase)
      const cost = {}; for (const id of idsB) { const m = B.MODELS[id].build({ look: 0, level: 4, quality: "medium", seed: 1 }); m.userData.setLOD(1); const t0 = performance.now(); for (let i = 0; i < 240; i++) m.userData.animate(i * 0.06, 0.06, 0.8); cost[id] = (performance.now() - t0) / 240; m.userData.dispose(); }
      B.resume();
      return { dDraws: withRides.drawCalls - without.drawCalls, dTris: withRides.triangles - without.triangles, ownDraws, ownTris, own, allDraws: all.drawCalls, allTris: all.triangles, cost };
    }, { idsB: IDS_B, idsA: IDS });
    h.expect(rinfoB.dDraws <= BUDGET_B.allDraws && rinfoB.dTris <= BUDGET_B.allTris, `renderer.info delta for the seven: ${rinfoB.dDraws} draw calls, ${rinfoB.dTris} triangles (<= ${BUDGET_B.allDraws} / ${BUDGET_B.allTris}); per model ${IDS_B.map((id) => `${id} ${rinfoB.own[id].draws}/${rinfoB.own[id].tris}`).join(", ")}`);
    h.expect(Object.values(rinfoB.cost).every((c) => c < BUDGET_B.animateMs), `animate() cost per frame, near L4 (ms): ${IDS_B.map((id) => `${id} ${rinfoB.cost[id].toFixed(2)}`).join(", ")} (< ${BUDGET_B.animateMs})`);
    h.log && h.log(`all twelve big models together: ${rinfoB.allDraws} draw calls, ${rinfoB.allTris} triangles in the whole frame`);

    h.step("W4b: night lamp convention (0.45 + 0.55 k) on a coaster and a hall");
    const nightB = await page.evaluate(() => { const o = {}; for (const id of ["looping", "tent"]) { const g = window.__big.MODELS[id].build({ look: 1, level: 3, quality: "medium" }); const u = g.userData.uniforms; for (const k of [0, 0.5, 1]) { g.userData.setNight(k); o[id + k] = u.uLamp.value; } g.userData.dispose(); } return o; });
    h.expect(["looping", "tent"].every((id) => Math.abs(nightB[id + 0] - 0.45) < 1e-9 && Math.abs(nightB[id + 0.5] - 0.725) < 1e-9 && Math.abs(nightB[id + 1] - 1) < 1e-9), "lamp scalar 0.45 / 0.725 / 1.0 at k = 0 / 0.5 / 1 for the coaster and the hall");

    h.step("no real brand or showman names in the W4b sources (generic ride names only)");
    const hitsB = [];
    for (const f of FILES_B) { const text = fs.readFileSync(path.join(REPO, f), "utf8"); text.split("\n").forEach((line, i) => { if (FORBIDDEN_B.test(line)) hitsB.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`); }); }
    h.eq(hitsB, [], "no Olympia / Big Splash / Thriller / Alpina Bahn / Oscar Bruch / Lämmy ... anywhere in the W4b sources");

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
