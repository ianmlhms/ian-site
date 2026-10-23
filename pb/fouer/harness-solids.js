// Feedback A, Node side (called from harness.js): collision that equals the visible geometry (solids.js), the walk pace, the pin (pegman) landing and the loading bar of
// pb/fouer.html.  Everything here uses plain objects (no THREE, no DOM); the real meshes are checked by flow fouer-walk.
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import * as S from "./solids.js";
import { WALK, createMask, pitchSolids, makeBoxIndex, stickPace, paceFor, easeSpeed, pinLanding, circleVsBox } from "./walk.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** an axis aligned box as a mesh of 12 triangles (local coordinates) */
function boxMesh(x0, x1, y0, y1, z0, z1, extra = {}) {
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const quads = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
  const pos = [];
  for (const [a, b, d, e] of quads) for (const k of [a, b, d, a, d, e]) pos.push(...c[k]);
  return { isMesh: true, visible: true, userData: {}, material: { transparent: false, opacity: 1 }, matrix: { elements: IDENT }, children: [],
    geometry: { attributes: { position: { array: new Float32Array(pos), itemSize: 3, count: pos.length / 3 } }, index: null }, ...extra };
}
const group = (...children) => ({ matrix: { elements: IDENT }, children, isGroup: true });

/** walkable-area reachability on the mask (0.25 m grid, 4-neighbourhood) */
function reach(mask, from, to, box) {
  const step = 0.25, key = (i, j) => i * 10007 + j;
  const i0 = Math.round(from.x / step), j0 = Math.round(from.z / step);
  const seen = new Set([key(i0, j0)]), queue = [[i0, j0]];
  while (queue.length) {
    const [i, j] = queue.pop();
    if (Math.abs(i * step - to.x) < 0.3 && Math.abs(j * step - to.z) < 0.3) return true;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj, x = ni * step, z = nj * step;
      if (x < box.u0 || x > box.u1 || z < box.w0 || z > box.w1 || seen.has(key(ni, nj)) || !mask.allowed(x, z)) continue;
      seen.add(key(ni, nj)); queue.push([ni, nj]);
    }
  }
  return false;
}

export function verifySolids({ check, equal, near }) {
  const rect = { u: 50, w: 50, du: 16, dw: 16 };
  const field = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const FIELD = { u0: 0, u1: 100, w0: 0, w1: 100 };

  // ---- the body slab: what is hit and what is stepped over / walked under
  const solidAt = (mesh, face = "+w") => S.derivePitchBoxes(group(mesh), rect, face);
  const covers = (boxes, x, z) => boxes.some(b => x >= b.u0 && x <= b.u1 && z >= b.w0 && z <= b.w1);
  check(covers(solidAt(boxMesh(-3, 3, 0, 2.4, -3, -1)), 50, 49), "the front wall of a stall (0 .. 2.4 m) is solid (a closed hut is hollow: only its walls are, see the pocket test below)");
  check(solidAt(boxMesh(-8, -4, 0, 0.5, -6, -2)).length === 0, "a platform 0.5 m high is stepped on (no solid)");
  check(solidAt(boxMesh(-3, 3, 2.3, 2.4, -3, 2)).length === 0, "an awning above 1.75 m is walked under (no solid)");
  check(solidAt(boxMesh(-6.5, 6.5, 0.9, 1.0, 7, 7.05)).length > 0, "a rail at 0.9 .. 1.0 m is solid");
  check(solidAt(boxMesh(-2, -0.2, 0.8, 0.88, 2, 2.8)).length > 0 && solidAt(boxMesh(-2, -0.2, 0.4, 0.45, 2, 2.8)).length === 0, "a table top (0.88 m) is solid, a bench (0.45 m) is not");
  check(solidAt(boxMesh(-1, 1, 0.3, 2.5, 0, 1)).length > 0, "a box that only starts at 0.3 m but reaches 2.5 m is solid where it crosses the body zone");
  check(solidAt(boxMesh(-1, 1, 0, 2.4, 0, 1, { material: { transparent: true, opacity: 0.4 } })).length === 0, "glass (transparent) is not solid");
  check(solidAt(boxMesh(-1, 1, 0, 2.4, 0, 1, { material: { blending: 2 } })).length === 0, "additive halos are not solid");
  check(solidAt(boxMesh(-1, 1, 0, 2.4, 0, 1, { visible: false })).length > 0, "a hidden mesh still collides (the fair layer hides the static parts of a live ride, they are drawn by the batch)");
  check(solidAt(boxMesh(-1, 1, 0, 2.4, 0, 1, { userData: { noCollide: true } })).length === 0, "userData.noCollide opts a mesh out");
  check(solidAt({ matrix: { elements: IDENT }, name: "part:cars", children: [boxMesh(-1, 1, 0, 2.4, 0, 1)] }).length === 0, "the moving parts of a ride (part:*) are not solid");
  for (const name of ["scooter-cars-near", "wheel-gondolas-near", "jules-seats-near", "booster-arm-near", "wheel-rotor-near", "far"]) check(solidAt({ matrix: { elements: IDENT }, name, children: [boxMesh(-1, 1, 0, 2.4, 0, 1)] }).length === 0, `a mesh called ${name} is a moving part / LOD copy`);
  check(solidAt({ matrix: { elements: IDENT }, name: "scooter-static-near", children: [boxMesh(-1, 1, 0, 2.4, 0, 1)] }).length > 0 && solidAt({ matrix: { elements: IDENT }, name: "solid", children: [boxMesh(-1, 1, 0, 2.4, 0, 1)] }).length > 0, "static meshes (…-static-near, solid) are solid");
  check(solidAt({ ...boxMesh(-1, 1, 0, 2.4, 0, 1), isMesh: false }).length === 0, "points / lines / sprites are not meshes");
  // a roof that slopes through the zone only counts where it is inside 0.8 .. 1.75 m
  const slope = { ...boxMesh(0, 0, 0, 0, 0, 0), geometry: { attributes: { position: { array: new Float32Array([-4, 3, -4, 4, 3, -4, 4, 0.2, -4, -4, 3, -4, 4, 0.2, -4, -4, 0.2, -4]), itemSize: 3, count: 6 } }, index: null } };
  const sl = S.derivePitchBoxes(group(slope), rect, "+w");
  check(sl.length > 0 && sl.every(b => b.w0 > 50 - 4.3 && b.w1 < 50 - 3.7), "a vertical wall projects to a line");

  // ---- the frame: local (x lateral, z front) -> game coordinates for every face
  for (const face of ["+w", "-w", "+u", "-u"]) {
    const boxes = S.derivePitchBoxes(group(boxMesh(3, 5, 0, 2, 2, 3)), rect, face);
    const p = S.placePoint(rect, face, 3, 2.5), q = S.placePoint(rect, face, 4, 3);       // a point of its left wall, a point of its back wall
    check(boxes.length > 0 && covers(boxes, p.u, p.w) && covers(boxes, q.u, q.w), `face ${face}: a box at local (3 .. 5, 2 .. 3) lands at game (${p.u.toFixed(1)}, ${p.w.toFixed(1)})`);
    const front = S.placePoint(rect, face, 0, 8);
    const f = { "+w": [0, 1], "-w": [0, -1], "+u": [1, 0], "-u": [-1, 0] }[face];
    near(front.u - rect.u, 8 * f[0], 1e-9, `face ${face}: local +z points to the front (u)`); near(front.w - rect.w, 8 * f[1], 1e-9, `face ${face}: local +z points to the front (w)`);
  }
  const boxRound = S.derivePitchBoxes(group(boxMesh(-3, 3, 0, 2.4, -3, -1)), rect, "+w")[0];
  check(boxRound.u0 <= 47.001 && boxRound.u0 > 46.8 && boxRound.u1 >= 52.99 && boxRound.u1 < 53.21 && boxRound.w0 <= 47.001 && boxRound.w1 >= 47.1, `boxes are at most 0.2 m larger than the geometry (${boxRound.u0.toFixed(2)} .. ${boxRound.u1.toFixed(2)})`);

  // ---- a Fouerfesch-like stall: counter, seating terrace between a rail and the stall, tables, an awning, a raised platform, a gap in the side fence
  const stall = group(
    boxMesh(-4, 4, 0, 2.8, -5.5, -3),                       // the hut
    boxMesh(-4.4, 4.4, 2.5, 2.6, -5.5, 0),                  // awning (over the first rows)
    boxMesh(-8, -5, 0, 0.4, -7, -1),                        // a raised deck (walkable)
    boxMesh(-6.5, -6.4, 0.9, 1.0, -1, 7), boxMesh(-6.5, 6.5, 0.9, 1.0, 7, 7.05), boxMesh(6.4, 6.5, 0.9, 1.0, 1.9, 7),    // rails: left, front, right (the right one has an opening from z -1 .. 1.9)
    boxMesh(-4, -2.2, 0.8, 0.88, 2, 2.8), boxMesh(2.2, 4, 0.8, 0.88, 2, 2.8), boxMesh(-1, 1, 0.8, 0.88, 4.6, 5.4),         // tables
    boxMesh(-4, -2.2, 0.4, 0.45, 2.9, 3.2), boxMesh(-4, -2.2, 0.4, 0.45, 1.6, 1.9));                                       // benches (not solid)
  const boxes = S.derivePitchBoxes(stall, rect, "+w");
  const mask = createMask({ fieldPoly: field, rects: [rect], faces: ["+w"], entrances: [] });
  mask.setPitches(pitchSolids([rect], () => true, {}, { derived: () => boxes }));
  const local = (x, z) => S.placePoint(rect, "+w", x, z);
  const at = (x, z) => { const p = local(x, z); return { x: p.u, z: p.w }; };
  check(!mask.allowed(...Object.values(at(-4, -4))) && !mask.allowed(...Object.values(at(0, -5.5))), "the walls of the hut block");
  check(mask.openArea(...Object.values(at(0, -4)), 3000) < 3000, "the hollow inside the closed hut is a sealed pocket (nobody can walk out of it)");
  check(mask.allowed(...Object.values(at(0, 1.0))), "under the awning (2.5 m) in front of the hut is walkable");
  check(mask.allowed(...Object.values(at(-6, -4))), "the raised deck (0.4 m) is walkable");
  check(mask.allowed(...Object.values(at(0, -2.3))), "right at the counter of the hut (0.7 m in front of the wall) is walkable");
  check(!mask.allowed(...Object.values(at(0, -3.1))), "...but not inside it");
  check(mask.allowed(...Object.values(at(-3, 3.5))) && mask.allowed(...Object.values(at(-3, 1.2))), "the aisle beside the tables is walkable");
  check(!mask.allowed(...Object.values(at(-3, 2.4))), "a table top blocks");
  check(!mask.allowed(...Object.values(at(0, 7.0))), "the front rail blocks");
  check(reach(mask, at(12, 0), at(-3, 3.5), FIELD), "the seating area is reachable through the opening in the side rail");
  check(reach(mask, at(0, 12), at(0, -2.3), FIELD), "the counter of the hut is reachable from the open ground behind the terrace (side opening)");
  // the pitch rectangle itself (16 x 16) is NOT a wall any more: between the rail and the pitch edge, and beside the hut, a walker passes
  check(mask.allowed(...Object.values(at(7.6, 4))), "beside the right rail, inside the old pitch rectangle, is walkable (no invisible wall)");
  check(mask.allowed(...Object.values(at(0, 7.9))), "in front of the front rail, inside the old pitch rectangle, is walkable");

  // ---- collision == visible geometry (both directions)
  const vis = S.createRaster({ u0: 36, u1: 64, w0: 36, w1: 64 }, 0.1);
  S.rasterObject(vis, stall, S.pitchMatrix(rect, "+w"));
  const probe = m => S.maskVsVisible({ visible: vis, isBlocked: (x, z) => m.solidAt(x, z), region: null, step: 0.25 });
  const good = probe(mask);
  check(good.invisible.length === 0 && good.through.length === 0 && good.blockedCells > 200, `the derived mask equals the visible solids (blocked ${good.blockedCells} cells, invisible ${good.invisible.length}, walk-through ${good.through.length})`);
  const phantom = createMask({ fieldPoly: field, rects: [rect], faces: ["+w"], entrances: [] });
  phantom.setPitches(pitchSolids([rect], () => true, {}, { derived: () => [...boxes, { u0: 56, u1: 60, w0: 56, w1: 60 }] }));
  const bad = probe(phantom);
  check(bad.invisible.length > 100, `an invisible wall is found (${bad.invisible.length} blocked cells with nothing visible within 0.3 m)`);
  const clusters = S.clusterPoints(bad.invisible);
  check(clusters.length === 1 && clusters[0].u0 > 55.5 && clusters[0].u1 < 60.5, "...and reported as one cluster at its place");
  const hole = createMask({ fieldPoly: field, rects: [rect], faces: ["+w"], entrances: [] });
  hole.setPitches(pitchSolids([rect], () => true, {}, { derived: () => boxes.slice(1) }));
  check(probe(hole).through.length > 0, "a visible solid the mask lets through is found too");
  const wholeRect = createMask({ fieldPoly: field, rects: [rect], faces: ["+w"], entrances: [] });
  wholeRect.setPitches(pitchSolids([rect], () => true));
  check(probe(wholeRect).invisible.length > 1000, `the old whole-pitch rectangle would have ${probe(wholeRect).invisible.length} invisible-wall cells`);

  // ---- gaps: >= 1.2 m between two visible solids is passable, a 0.5 m slit is not
  const walls = (gap) => {
    const ms = group(boxMesh(-13, -gap / 2, 0, 2.5, 0, 1), boxMesh(gap / 2, 13, 0, 2.5, 0, 1));
    const m = createMask({ fieldPoly: field, rects: [rect], faces: ["+w"], entrances: [] });
    m.setPitches(pitchSolids([rect], () => true, {}, { derived: () => S.derivePitchBoxes(ms, rect, "+w") }));
    return m;
  };
  const STRIP = { u0: 38, u1: 62, w0: 30, w1: 70 };          // the walls run across the whole strip, a walker cannot go round
  for (const gap of [1.2, 1.5, 2.5]) check(reach(walls(gap), at(0, -4), at(0, 5), STRIP), `a ${gap} m gap between two walls is walkable`);
  check(!reach(walls(0.5), at(0, -4), at(0, 5), STRIP), "a 0.5 m slit is not");

  // ---- the box index agrees with a linear scan
  const many = Array.from({ length: 400 }, (_, i) => ({ u0: (i * 7.3) % 90, u1: (i * 7.3) % 90 + 1 + (i % 5), w0: (i * 3.1) % 90, w1: (i * 3.1) % 90 + 0.5 + (i % 3) }));
  const index = makeBoxIndex(many);
  let agree = true;
  for (let k = 0; k < 300 && agree; k++) {
    const x = (k * 13.7) % 95, z = (k * 5.3) % 95, r = 0.3, found = new Set();
    index.each(x - r, x + r, z - r, z + r, b => found.add(b));
    const linear = many.filter(b => circleVsBox(x, z, r, b)), viaIndex = [...found].filter(b => circleVsBox(x, z, r, b));
    agree = linear.length === viaIndex.length;
  }
  check(agree, "the box index finds exactly the boxes a linear scan finds");

  // ---- the pace: 2.6 m/s walking, 6.5 m/s sprinting, eased
  check(WALK.speed >= 2.4 && WALK.speed <= 2.8 && WALK.run >= 6 && WALK.run <= 7, `walk ${WALK.speed} m/s, sprint ${WALK.run} m/s (feedback: "really slow")`);
  near(paceFor(0), WALK.speed, 1e-9, "no sprint: walking pace"); near(paceFor(1), WALK.run, 1e-9, "full sprint: running pace");
  check(stickPace(0.05).m === 0 && stickPace(0.3).m < 1 && stickPace(0.3).run === 0, "a light stick push walks slowly, no sprint");
  check(stickPace(1).run === 1 && stickPace(1).m === 1, "a full stick push sprints");
  check(stickPace(0.7).run === 0 && stickPace(0.9).run > 0 && stickPace(0.9).run < 1, "the sprint blends in over the last 18 % of the stick (no jump)");
  let prev = 0;
  for (let l = 0; l <= 1.0001; l += 0.01) { const p = stickPace(l); check(p.m >= prev - 1e-9, "stick magnitude is monotonic"); prev = p.m; }
  let v = 0, vmax = 0, t = 0, step = 0;
  for (; t < 1; t += 1 / 60) { const n = easeSpeed(v, WALK.run, 1 / 60); step = Math.max(step, Math.abs(n - v)); v = n; if (t < 0.36) vmax = v; }
  check(vmax > WALK.run * 0.9 && v <= WALK.run + 1e-9, `speeding up to the sprint takes about a third of a second (${vmax.toFixed(2)} m/s after 0.36 s)`);
  check(step < 1.2, `no jerk: at most ${step.toFixed(2)} m/s change per frame`);
  let w = WALK.run; for (let k = 0; k < 18; k++) w = easeSpeed(w, 0, 1 / 60);
  check(w < 0.6 && w >= 0, `stopping from a sprint takes about 0.3 s (${w.toFixed(2)} m/s left after 0.3 s)`);

  // ---- the pin (pegman)
  const pinMask = createMask({ fieldPoly: field, rects: [rect], faces: ["+w"], entrances: [] });
  pinMask.setPitches(pitchSolids([rect], () => true, {}, { derived: () => boxes }));
  const facing = (x, z) => Math.atan2(50 - z, 50 - x);
  const free = pinLanding(pinMask, 20, 20, facing);
  check(free.valid && !free.snapped && free.x === 20 && free.z === 20, "a drop on free ground lands exactly there");
  near(free.yaw, Math.atan2(30, 30), 1e-9, "...facing the nearest attraction");
  const inHut = pinLanding(pinMask, 50, 45.5, facing);
  check(inHut.valid && inHut.snapped && pinMask.allowed(inHut.x, inHut.z) && pinMask.openArea(inHut.x, inHut.z, 3000) >= 3000 && Math.hypot(inHut.x - 50, inHut.z - 45.5) < 5, `a drop inside a closed stall snaps out to the nearest walkable open point (${Math.hypot(inHut.x - 50, inHut.z - 45.5).toFixed(1)} m)`);
  check(inHut.rawOk === false && inHut.raw.x === 50 && inHut.raw.z === 45.5, "...and remembers the raw drop point (the marker shows both)");
  const onCounter = pinLanding(pinMask, 50, 46.8, facing);
  check(onCounter.valid && onCounter.snapped && pinMask.allowed(onCounter.x, onCounter.z), "a drop in the wall itself snaps to walkable ground");
  const outside = pinLanding(pinMask, 150, 50, facing);
  check(!outside.valid, "a drop far outside the field is invalid (red marker, no walk)");
  const edge = pinLanding(pinMask, 104, 50, facing);
  check(!edge.valid || pinMask.allowed(edge.x, edge.z), "a drop just outside the border snaps inside or is invalid, never outside");

  // ---- the loading bar (the inline script of pb/fouer.html, run against stubs)
  const html = fs.readFileSync(`${here}../fouer.html`, "utf8");
  const code = html.slice(html.indexOf("/* The loading screen"), html.indexOf("</script>", html.indexOf("/* The loading screen")));
  const el = () => ({ style: {}, hidden: true, textContent: "", listeners: {}, addEventListener(k, fn) { this.listeners[k] = fn; } });
  const bar = el(), els = { loadMsg: el(), loadSlow: el(), loadSlowText: el(), loadRetry: el() };
  let shownScale = 0; const anims = []; let timerFn = null; let clock = 1000000; let reloads = 0;
  bar.animate = (frames, opts) => { anims.push({ frames, opts }); shownScale = parseFloat(frames[1].transform.slice(7)); return { cancel() {} }; };
  const sandbox = {
    document: { querySelector: () => bar, getElementById: id => els[id] }, localStorage: { getItem: () => null },
    getComputedStyle: () => ({ transform: `matrix(${shownScale}, 0, 0, 1, 0, 0)` }), PerformanceObserver: class { constructor(fn) { sandbox.__po = fn; } observe() {} },
    setInterval: fn => { timerFn = fn; return 1; }, clearInterval() {}, Date: { now: () => clock }, location: { reload: () => { reloads++; } }, window: {}, Math, parseFloat,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox);
  const L = sandbox.__fouerLoad;
  check(L && typeof L.set === "function" && els.loadMsg.textContent.length > 0, "the loader starts with a label (and works before main.js)");
  L.set(0.2, "a", 0.4, 3000);
  L.set(0.05, "b", 0.3, 3000);          // lower: must not go back
  L.set(0.5, "c", 0.45, 3000);          // ceiling below the value: lifted
  L.set(0.6, "", 0.7, 0);
  const tos = anims.map(a => parseFloat(a.frames[1].transform.slice(7))), froms = anims.map(a => parseFloat(a.frames[0].transform.slice(7))), ceils = anims.map(a => parseFloat(a.frames[2].transform.slice(7)));
  check(tos.every((x, i) => i === 0 || x >= tos[i - 1] - 1e-12) && froms.every((x, i) => i === 0 || x >= froms[i - 1] - 1e-12), "the bar value never goes backwards");
  check(ceils.every((c, i) => c >= tos[i] + 0.0099 && c <= 0.995), "the creep ceiling is above the value and below 100 %");
  check(anims.every(a => a.opts.duration >= 14000), "every creep outlasts the stall timer (the bar never sits still before the hint)");
  check(els.loadMsg.textContent === "c", "a call without a label keeps the last label");
  check(els.loadSlow.hidden === true, "no hint while things move");
  clock += 12500; timerFn();
  check(els.loadSlow.hidden === false && els.loadSlowText.textContent.length > 5 && els.loadRetry.textContent.length > 3, "after 12 s without real progress the calm hint and the retry button appear");
  L.set(0.7, "d", 0.8, 0);
  check(els.loadSlow.hidden === true, "real progress hides the hint again");
  els.loadRetry.listeners.click(); check(reloads === 1, "the retry button reloads");
  L.done(); check(L.value() === 1, "done() fills the bar");
}
