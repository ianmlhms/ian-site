/* Flow: Schueberfouer Tycoon "Access" wave (pb/fouer.html: walkways and access, pb/fouer/layout.js).
 *
 * iPad portrait profile (touch, 820x1180, Supabase mocked), ONE page, the full fair (34 attractions: all 19 rides, the stalls, the wheel), `fouerQ=medium`:
 *   - the layout validator (layout.js) on the REAL built fair: widths, faces, forecourts, nothing of the NPC fair / props / clutter on an alley, a forecourt or an entrance lane,
 *     the swept-ground raster and the crowd graph follow the same data, the Glacis outline of layout.js is the baked one;
 *   - the walk mask: breadth-first search from every open entrance reaches every pitch front (fresh fair, star 3, full fair);
 *   - the walker, driven through the real controller with simulated keys (forward + run, steering by yaw, `walk.update`), goes from the NE portal (E7) and from the SW entrance (E1)
 *     to the front of every pitch; every ride offers "Fueren" there (the wheel: its boarding platform) and boards; every stall offers its action;
 *   - queue rows and crowd destinations (frontSpot / queueSlot) stand on free ground in the forecourt, never inside a stall;
 *   - the Autoscooter pitch (P13) has nothing in front of it any more (the bug report); performance stays inside DESIGN 5; zero console errors.
 * Screenshots (set FLOW_SHOTS_DIR): the plan with the network overlay, the Autoscooter front, other fronts, the wheel view. */
import { runIfMain } from "./lib.mjs";
import { bootGame, consoleCollector } from "./fouer_game.mjs";

const URL_BASE = "/pb/fouer.html?fouerDebug=1&fouerNoFly=1&fouerTimeMode=noon&fouerWeather=clear&fouerQ=";
const WALK_DRAWS = 220, WALK_TRIS = 300000, BUILDER_DRAWS = 140, BUILDER_TRIS = 300000;

/** the whole fair: one of every ride (19), the food and game stalls on the rest; item per pitch id */
const FAIR = {
  P01: "kanner", P02: "kachel", P03: "kette", P04: "maus", P05: "fritten", P06: "lous", P07: "bayern", P08: "happy", P09: "tent", P10: "wurscht", P11: "geister", P12: "zocker",
  P13: "scooter", P14: "lukas", P15: "mandel", P16: "break", P17: "waffel", P18: "crepes", P19: "schiess", P20: "kachel", P21: "splash", P22: "booster", P23: "musik", P24: "wheel",
  P25: "takeoff", P26: "jules", P27: "hangover", P28: "alpina", P29: "infinity", P30: "gold", P31: "fritten", P32: "lous", P33: "looping", P34: "fesch",
};
const RIDES = ["kanner", "gold", "kette", "bayern", "happy", "break", "musik", "takeoff", "jules", "hangover", "booster", "infinity", "maus", "looping", "alpina", "splash", "geister", "scooter", "wheel"];
const EAT = ["kachel", "fritten", "wurscht", "zocker", "mandel", "waffel", "fesch", "crepes", "tent"], PLAY = ["lous", "lukas", "schiess"];

const evalG = (page, fn, arg) => page.evaluate(([src, a]) => (0, eval)(src)(window.__fouerGame, a), [fn.toString(), arg]);

/** page side: breadth-first search over the live walk mask (1 m cells), a path follower that drives the real controller with keys, and the checks */
const PAGE_TOOLS = `(() => {
  const CELL = 1, U0 = -5, W0 = -20, NU = 310, NW = 175, R = 0.5;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const tools = {
    freeCache: null,
    reset(g) { tools.freeCache = new Int8Array(NU * NW).fill(-1); },
    free(g, i, j) { const k = j * NU + i; let v = tools.freeCache[k]; if (v < 0) { v = g.mask.allowed(U0 + (i + 0.5) * CELL, W0 + (j + 0.5) * CELL, R) ? 1 : 0; tools.freeCache[k] = v; } return v === 1; },
    cellOf(x, z) { return [Math.floor((x - U0) / CELL), Math.floor((z - W0) / CELL)]; },
    nearestCell(g, x, z) { const [ci, cj] = tools.cellOf(x, z); let best = null, bd = 1e9; for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= NU || j >= NW) continue; const d = Math.hypot(di, dj); if (d < bd && tools.free(g, i, j)) { bd = d; best = [i, j]; } } return best; },
    /** single-source BFS (8 neighbours, corner cutting refused) from a start: parent array */
    tree(g, start) {
      const s = tools.nearestCell(g, start.x, start.z); const par = new Int32Array(NU * NW).fill(-2); const q = [s]; par[s[1] * NU + s[0]] = -1;
      for (let h = 0; h < q.length; h++) {
        const [i, j] = q[h];
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue; const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= NU || b >= NW || par[b * NU + a] !== -2) continue;
          if (!tools.free(g, a, b)) continue; if (di && dj && (!tools.free(g, i + di, j) || !tools.free(g, i, j + dj))) continue;
          par[b * NU + a] = j * NU + i; q.push([a, b]);
        }
      }
      return { par, start: s };
    },
    pathTo(g, tree, target) {
      const c = tools.nearestCell(g, target.x, target.z); if (!c || tree.par[c[1] * NU + c[0]] === -2) return null;
      const out = []; let k = c[1] * NU + c[0];
      while (k >= 0) { const i = k % NU, j = Math.floor(k / NU); out.push({ x: U0 + (i + 0.5) * CELL, z: W0 + (j + 0.5) * CELL }); k = tree.par[k]; }
      out.reverse(); out.push({ x: target.x, z: target.z });
      return out;
    },
    /** string pulling: skip waypoints while the straight line to a later one is free (0.5 m steps) */
    smooth(g, path) {
      const ok = (a, b) => { const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5); for (let k = 1; k <= n; k++) { const t = k / n; if (!g.mask.allowed(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, R * 0.9)) return false; } return true; };
      const out = [path[0]]; let i = 0;
      while (i < path.length - 1) { let j = path.length - 1; while (j > i + 1 && !ok(path[i], path[j])) j--; out.push(path[j]); i = j; }
      return out;
    },
    /** drive the real controller: keys forward + run, steer by yaw, walk.update at 30 Hz */
    drive(g, path, goal, maxSteps = 4000) {
      const w = g.walk; const dt = 1 / 30; let wp = 1, steps = 0, metres = 0, lastX = w.view.x, lastZ = w.view.z, stuck = 0, probe = [w.view.x, w.view.z];
      w.setInputKeys(['f', 'run']);
      while (steps++ < maxSteps) {
        const v = w.view; const tgt = path[Math.min(wp, path.length - 1)];
        if (Math.hypot(tgt.x - v.x, tgt.z - v.z) < 1.0 && wp < path.length - 1) { wp++; continue; }
        const last = path[path.length - 1];
        if (Math.hypot(last.x - v.x, last.z - v.z) < (goal ?? 0.8)) break;
        w.setLook(Math.atan2(tgt.z - v.z, tgt.x - v.x), 0);
        w.update(dt);
        metres += Math.hypot(v.x - lastX, v.z - lastZ); lastX = v.x; lastZ = v.z;
        if (steps % 90 === 0) { if (Math.hypot(v.x - probe[0], v.z - probe[1]) < 0.6) { if (++stuck > 2) break; } else stuck = 0; probe = [v.x, v.z]; }
      }
      w.setInputKeys([]);
      for (let k = 0; k < 8; k++) w.update(dt);
      const last = path[path.length - 1];
      return { steps, metres, left: Math.hypot(last.x - w.view.x, last.z - w.view.z) };
    },
  };
  return tools;
})()`;

export const flow = {
  name: "fouer-access",
  fullChromium: true,
  touch: true,
  backend: { tables: { game_saves: () => [] }, rpc: { ack_game_gift: () => true, claim_game_gifts: () => [] } },
  async run(h) {
    const { page } = h;
    const errors = consoleCollector(page);
    page.on("console", m => { if (m.type() === "warning" && /\[fouer\]/.test(m.text())) errors.push(m.text()); });
    page.on("dialog", dialog => dialog.dismiss().catch(() => {}));
    await h.signIn();
    const sleep = ms => h.pause(ms);

    /* ------------------------------------------------------------ boot, the full fair with one of every ride */
    h.step("boot (iPad medium), the full fair: all 19 rides + the stalls");
    await h.goto(URL_BASE + "medium");
    await bootGame(h);
    await evalG(page, async (g, fair) => {
      const { PITCHES } = await import("/pb/fouer/data.js");
      const pitches = PITCHES.map(p => ({ k: fair[p.id], lv: 2, look: 0, fl: 0 }));
      g.game.debugSetState({ ...g.game.state, pitches, pu: 2 ** 34 - 1, c: 1e9, tu: 8, rb: 1000 });
    }, FAIR);
    await sleep(2500);
    const set = await evalG(page, g => ({ built: g.game.state.pitches.filter(Boolean).length, stars: g.game.stars() }));
    h.eq(set.built, 34, "all 34 pitches are built");
    h.expect(set.stars >= 5, `the fair has ${set.stars} stars: every entrance is open`);

    /* ------------------------------------------------------------ the layout data against the real world */
    h.step("layout.js agrees with the baked world; the validator passes on the real built fair");
    const lay = await evalG(page, async g => {
      const L = await import("/pb/fouer/layout.js"), W = await import("/pb/fouer/walk.js"), D = await import("/pb/fouer/data.js"), P = await import("/pb/fouer/models/props.js"), N = await import("/pb/fouer/models/npc.js");
      const pitches = D.PITCHES.map(p => ({ ...p })); const poly = g.world.fieldPoly;
      const polyDiff = L.FIELD_POLY.length === poly.length ? Math.max(...poly.map((p, i) => Math.hypot(p[0] - L.FIELD_POLY[i][0], p[1] - L.FIELD_POLY[i][1]))) : 99;
      const t0 = performance.now();
      const res = L.validateLayout({ pitches, stalls: g.fair.baseInfo.npc.stalls, solids: g.fair.baseInfo.solids, boxes: g.fair.baseInfo.boxes, createMask: W.createMask, pitchSolids: W.pitchSolids, stars: [1, 3, 5] });
      const gridEdges = g.crowd.graph ? g.crowd.graph.edges.length : -1;
      return { polyDiff, errors: res.errors.slice(0, 30), nErr: res.errors.length, stats: res.stats, ms: Math.round(performance.now() - t0), entrancesSame: JSON.stringify(P.ENTRANCES) === JSON.stringify(L.ENTRANCES), corridors: N.CORRIDORS.length, gridEdges, stalls: g.fair.baseInfo.npc.stalls.length, solids: g.fair.baseInfo.solids.length };
    });
    // feedback B: every NPC stall front opens onto a walkway (no stall looks at the back of another stall, a plot or the field edge), no identical skins side by side
    const fronts = await evalG(page, async g => { const L = await import("/pb/fouer/layout.js"), D = await import("/pb/fouer/data.js"); const stalls = g.fair.baseInfo.npc.stalls;
      return { errors: L.validateStallFronts({ pitches: D.PITCHES.map(p => ({ ...p })), stalls }).slice(0, 10), shops: stalls.filter(s => s.k !== "lot").length, lots: stalls.filter(s => s.k === "lot").length, funhouses: stalls.filter(s => s.k === "funhouse").length }; });
    h.eq(fronts.errors, [], `every NPC stall front opens onto a walkway on the real fair (${fronts.shops} shop fronts, ${fronts.lots} back-of-house lots / tents, ${fronts.funhouses} Spukhaeuser)`);
    h.expect(lay.polyDiff < 0.01, `the Glacis outline of layout.js is the baked one (max difference ${lay.polyDiff} m)`);
    h.expect(lay.entrancesSame, "props.js re-exports the entrances of layout.js");
    h.eq(lay.errors, [], `validateLayout on the real fair: 0 problems (${lay.stalls} stalls, ${lay.solids} solids, ${lay.ms} ms; ${lay.nErr} offenders)`);
    h.eq(Object.values(lay.stats.reach).map(r => r.unreachable), [0, 0, 0], "stars 1 / 3 / 5: every pitch front reachable from every open entrance (BFS over the walk mask)");
    h.expect(lay.corridors >= 15 && lay.gridEdges > 40, `the crowd graph follows the network (${lay.corridors} corridors, ${lay.gridEdges} edges)`);

    /* ------------------------------------------------------------ the crowd graph is one connected network */
    const graph = await evalG(page, g => {
      const gr = g.crowd.graph; const seen = new Set([0]); const q = [0]; const adj = gr.nodes.map(n => n.edges.map(e => (gr.edges[e].a === gr.nodes.indexOf(n) ? gr.edges[e].b : gr.edges[e].a)));
      for (let k = 0; k < q.length; k++) for (const m of adj[q[k]]) if (!seen.has(m)) { seen.add(m); q.push(m); }
      const names = [...new Set(gr.edges.map(e => e.name))].sort();
      return { nodes: gr.nodes.length, reached: seen.size, names, total: Math.round(gr.totalLength) };
    });
    h.eq(graph.reached, graph.nodes, `the crowd lanes form one connected network (${graph.nodes} nodes, ${graph.total} m of lane)`);
    for (const name of ["haaptallee", "fressgaass", "sud-west", "sud-ost", "cross-wheel", "cross-seam", "cross-a", "lane-e2", "lane-e3", "lane-e6", "service"]) h.expect(graph.names.includes(name), `crowd lane on ${name}`);

    /* ------------------------------------------------------------ queue rows and crowd destinations in the forecourts */
    h.step("queue rows and destinations: free ground in front of every pitch, in the forecourt");
    const queues = await evalG(page, async g => {
      const L = await import("/pb/fouer/layout.js"), C = await import("/pb/fouer/crowd.js"), D = await import("/pb/fouer/data.js"), W = await import("/pb/fouer/walk.js");
      const bad = [];
      D.PITCHES.forEach((p, i) => {
        const rect = g.scene.rects[i]; const f = L.forecourtOf(p);
        const dest = W.frontSpot(rect, p.face, 2.6, 0);
        if (!g.mask.allowed(dest.x, dest.z, 0.35)) bad.push(`${p.id}: destination (${dest.x.toFixed(1)}, ${dest.z.toFixed(1)}) is not free`);
        const best = {};
        for (const side of [1, -1]) {
          let free = 0, inCourt = 0;
          for (let k = 0; k < 15; k++) { const s = C.queueSlot(rect, p.face, k, side); if (g.mask.allowed(s.x, s.z, 0.3)) free++; if (s.x >= f.u0 - 0.01 && s.x <= f.u1 + 0.01 && s.z >= f.w0 - 0.01 && s.z <= f.w1 + 0.01) inCourt++; }
          best[side] = { free, inCourt };
        }
        const b = [best[1], best[-1]].sort((x, y) => y.free - x.free)[0];          // the crowd flips to the other side when a slot is blocked
        if (b.free < L.QUEUE_RESERVED) bad.push(`${p.id}: only ${b.free} of 15 queue slots are free on the better side (layout.js reserves ${L.QUEUE_RESERVED})`);
        if (p.size !== "S" && b.inCourt < 4) bad.push(`${p.id}: only ${b.inCourt} queue slots lie in its forecourt`);
      });
      return bad;
    });
    h.eq(queues, [], "every pitch has a free destination spot and room for a queue row in front of it");

    /* ------------------------------------------------------------ the Autoscooter: nothing in front of it */
    h.step("the Autoscooter (P13): the forecourt and the way to it are clear");
    const scooter = await evalG(page, async g => {
      const L = await import("/pb/fouer/layout.js"), D = await import("/pb/fouer/data.js");
      const p = D.PITCHES.find(q => q.id === "P13"); const f = L.forecourtOf(p);
      const hit = g.fair.baseInfo.npc.stalls.filter(s => s.u1 > f.u0 && s.u0 < f.u1 && s.w1 > f.w0 && s.w0 < f.w1);
      const solids = g.fair.baseInfo.solids.filter(s => s.u > f.u0 - s.r && s.u < f.u1 + s.r && s.w > f.w0 - s.r && s.w < f.w1 + s.r && !L.createReservations(D.PITCHES.map(x => ({ ...x }))).isKerb(s.u, s.w, s.r));
      let freeCells = 0, cells = 0; for (let u = f.u0 + 0.5; u < f.u1; u += 1) for (let w = f.w0 + 0.5; w < f.w1; w += 1) { cells++; if (g.mask.allowed(u, w, 0.34)) freeCells++; }
      return { f, stalls: hit.length, solids: solids.length, freeCells, cells };
    });
    h.eq([scooter.stalls, scooter.solids], [0, 0], `no stall and no solid in the ${scooter.f.depth} m forecourt of P13`);
    h.expect(scooter.freeCells >= scooter.cells * 0.95, `the forecourt of P13 is walkable but for the kerb lamp posts (${scooter.freeCells} / ${scooter.cells} cells)`);

    /* ------------------------------------------------------------ the debug overlay + the shots */
    h.step("the debug overlay paints the network; plan view");
    await page.setViewportSize({ width: 1600, height: 900 });
    await sleep(700);
    await evalG(page, async g => { await g.accessOverlay(true); for (const id of ["ui", "fabs", "title"]) { const el = document.getElementById(id); if (el) el.style.display = "none"; } g.r.setFreeCamera({ eye: [150, 250, 70], look: [150, 0, 62], fov: 62 }); });
    await sleep(1200);
    await h.shot("plan-network");
    await evalG(page, async g => { await g.accessOverlay(false); });
    await evalG(page, g => { g.r.setFreeCamera({ eye: [150, 250, 70], look: [150, 0, 62], fov: 62 }); }); await sleep(900); await h.shot("plan");
    const front = (i, out, side = 0) => evalG(page, async (g, a) => {
      const D = await import("/pb/fouer/data.js"); const r = g.scene.rects[a.i], f = D.PITCHES[a.i].face; const fu = f === "+u" ? 1 : 0, fw = f === "+w" ? 1 : f === "-w" ? -1 : 0; const hd = (fu ? r.du : r.dw) / 2;
      g.r.setFreeCamera({ eye: [r.u + fu * (hd + a.out) + a.side * (fu ? 0 : 1), 1.7, r.w + fw * (hd + a.out) + a.side * (fu ? 1 : 0)], look: [r.u, 3.5, r.w], fov: 62 });
    }, { i, out, side });
    for (const [name, i, out, side] of [["autoscooter-P13", 12, 14, 0], ["autoscooter-P13-close", 12, 8, 6], ["front-tent-P09", 8, 12, 0], ["front-alpina-P28", 27, 16, -10], ["front-musik-P23", 22, 12, 0], ["front-kanner-P01", 0, 9, 0], ["front-wheel-P24", 23, 20, 0], ["front-bayern-P07", 6, 12, 0]]) { await front(i, out, side); await sleep(800); await h.shot(name); }
    await evalG(page, g => { g.r.setFreeCamera({ eye: [22, 60, 86], look: [160, 0, 62], fov: 58 }); }); await sleep(900); await h.shot("from-wheel");
    await evalG(page, g => { g.r.setPose({ tu: 150, tw: 62, yaw: 0, dist: 330, tilt: 0 }, true); for (const id of ["ui", "fabs", "title"]) { const el = document.getElementById(id); if (el) el.style.display = ""; } });
    await page.setViewportSize({ width: 820, height: 1180 });
    await sleep(700);

    /* ------------------------------------------------------------ simulated walking from the NE portal and the SW entrance to every pitch */
    h.step("walk (simulated keys through the real controller) from E7 (NE portal) and E1 (SW) to every pitch front");
    await page.evaluate(() => window.__fouerHooks.startWalk());
    await sleep(1500);
    await evalG(page, (g, src) => { window.__acc = (0, eval)(src); }, PAGE_TOOLS);
    const walkStats = { ok: 0, fail: [], metres: 0 };
    const rideLog = [], stallLog = [];
    for (const entrance of ["E7", "E1"]) {
      await evalG(page, g => { g.r.pause(); window.__acc.reset(g); });
      const plan = await evalG(page, async (g, id) => {
        const L = await import("/pb/fouer/layout.js"); const e = L.ENTRANCES.find(x => x.id === id); const [fu, fw] = L.FACE_VEC[e.face];
        const start = { x: e.u - fu * 4, z: e.w - fw * 4 };
        window.__acc.start = start; window.__acc.bfs = window.__acc.tree(g, start);
        const s = window.__acc.nearestCell(g, start.x, start.z); return { start, cell: s };
      }, entrance);
      h.expect(plan.cell !== null, `${entrance}: the door has free ground behind it`);
      const order = await evalG(page, async g => { const D = await import("/pb/fouer/data.js"); return D.PITCHES.map((p, i) => ({ i, id: p.id, item: g.game.state.pitches[i].k })); });
      for (const { i, id, item } of order) {
        const res = await evalG(page, async (g, a) => {
          const D = await import("/pb/fouer/data.js"); const W = await import("/pb/fouer/walk.js"); const tools = window.__acc;
          const r = g.scene.rects[a.i]; let spot;
          if (a.item === "wheel") { const b = g.ride.boardInfo(a.i); spot = { x: b.u, z: b.w }; } else { const s = W.frontSpot(r, D.PITCHES[a.i].face, 2.0); spot = g.mask.nearestFree(s.x, s.z, 5) ?? s; }
          const path = tools.pathTo(g, tools.bfs, spot); if (!path) return { ok: false, why: "no path" };
          const smooth = tools.smooth(g, path);
          g.walk.teleport(tools.start.x, tools.start.z, 0);
          const d = tools.drive(g, smooth, a.item === "wheel" ? 1.5 : 0.8);
          g.walk.scanTargets();
          return { ok: d.left < (a.item === "wheel" ? 1.6 : 0.9), left: d.left, metres: d.metres, steps: d.steps, targets: g.walk.targets.map(t => t.kind + ":" + (t.item ?? "") + ":" + t.i), pathLen: smooth.length };
        }, { i, item });
        if (!res.ok) { walkStats.fail.push(`${entrance} -> ${id} ${item}: ${res.why ?? "stopped " + res.left?.toFixed(1) + " m short"}`); continue; }
        walkStats.ok++; walkStats.metres += res.metres;
        // the action of the pitch is offered right here
        const want = RIDES.includes(item) ? (item === "wheel" ? `wheel::${i}` : `ride:${item}:${i}`) : EAT.includes(item) ? `eat:${item}:${i}` : PLAY.includes(item) ? `play:${item}:${i}` : null;
        if (want && !res.targets.includes(want)) walkStats.fail.push(`${entrance} -> ${id} ${item}: arrived but "${want}" is not offered (${res.targets.join(", ")})`);
        else if (RIDES.includes(item)) rideLog.push({ entrance, id, item, i });
        else stallLog.push({ entrance, id, item });
      }
      await evalG(page, g => g.r.resume());
      h.eq(walkStats.fail, [], `${entrance}: every pitch front reached on foot, every action offered (${walkStats.ok} walks so far, ${Math.round(walkStats.metres)} m walked)`);
      // "Fueren": board every ride from this entrance (walk there again with the keys, then the real interact + an early exit)
      for (const ride of rideLog.filter(r => r.entrance === entrance)) {
        const out = await evalG(page, async (g, a) => {
          const D = await import("/pb/fouer/data.js"); const W = await import("/pb/fouer/walk.js"); const tools = window.__acc; g.r.pause();
          const r = g.scene.rects[a.i]; let spot;
          if (a.item === "wheel") { const b = g.ride.boardInfo(a.i); spot = { x: b.u, z: b.w }; } else { const s = W.frontSpot(r, D.PITCHES[a.i].face, 2.0); spot = g.mask.nearestFree(s.x, s.z, 5) ?? s; }
          const path = tools.smooth(g, tools.pathTo(g, tools.bfs, spot)); g.walk.teleport(tools.start.x, tools.start.z, 0); tools.drive(g, path, a.item === "wheel" ? 1.5 : 0.8);
          g.walk.setLook(Math.atan2(r.w - g.walk.view.z, r.u - g.walk.view.x), 0); g.walk.scanTargets(); g.r.resume();
          const b = document.querySelector(".wk-act"); return { btn: b && !b.hidden ? b.querySelector("small").textContent : "", can: g.ride.canRide(a.i) };
        }, ride);
        await sleep(450);
        const label = await evalG(page, g => { const b = document.querySelector(".wk-act"); return b && !b.hidden ? b.querySelector("small").textContent : ""; });
        if (label !== "Fueren") walkStats.fail.push(`${entrance} -> ${ride.id} ${ride.item}: the button says "${label}" (${out.btn})`);
        await evalG(page, g => g.walk.interact());
        let riding = false; for (let k = 0; k < 40 && !riding; k++) { await sleep(150); riding = await evalG(page, g => g.ride.active && g.ride.info().phase === "riding"); }
        if (!riding) walkStats.fail.push(`${entrance} -> ${ride.id} ${ride.item}: "Fueren" did not start the ride`);
        await sleep(350);
        await evalG(page, g => g.ride.abort(true));
        let idle = false; for (let k = 0; k < 30 && !idle; k++) { await sleep(150); idle = await evalG(page, g => !g.ride.active); }
        if (!idle) walkStats.fail.push(`${entrance} -> ${ride.id} ${ride.item}: the ride did not end`);
      }
      h.eq(walkStats.fail, [], `${entrance}: "Fueren" boards every one of the ${rideLog.filter(r => r.entrance === entrance).length} rides`);
    }
    h.eq([rideLog.filter(r => r.entrance === "E7").length, rideLog.filter(r => r.entrance === "E1").length], [19, 19], "19 rides reached and boarded from the NE portal and from the SW entrance");
    h.expect(stallLog.length >= 28, `all stalls reached from both entrances (${stallLog.length} walks)`);

    /* ------------------------------------------------------------ performance + console */
    h.step("performance on the iPad-medium profile (walk and builder), full fair");
    await evalG(page, g => { g.walk.teleport(92, 56, 0.2); g.walk.setLook(0.2, 0); }); await sleep(1500);
    const walkPerf = await evalG(page, async g => { const out = []; for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 160)); const s = g.r.performanceSnapshot(); out.push([s.drawCalls, s.triangles]); } return out.reduce((a, b) => (b[1] > a[1] ? b : a)); });
    h.expect(walkPerf[0] <= WALK_DRAWS && walkPerf[1] <= WALK_TRIS, `walk: ${walkPerf[0]} draws / ${walkPerf[1]} triangles (limit ${WALK_DRAWS} / ${WALK_TRIS})`);
    await h.shot("walk-haaptallee");
    await page.keyboard.press("Escape"); await sleep(2000);
    const builderPerf = await evalG(page, async g => { g.r.setPose(g.r.framePose(), true); await new Promise(r => setTimeout(r, 900)); const s = g.r.performanceSnapshot(); return [s.drawCalls, s.triangles]; });
    h.expect(builderPerf[0] <= BUILDER_DRAWS && builderPerf[1] <= BUILDER_TRIS, `builder: ${builderPerf[0]} draws / ${builderPerf[1]} triangles (limit ${BUILDER_DRAWS} / ${BUILDER_TRIS})`);
    h.eq(errors, [], "zero console errors");
  },
};
runIfMain(import.meta.url, flow);
