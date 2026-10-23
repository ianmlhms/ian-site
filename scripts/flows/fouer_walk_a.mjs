/* Feedback A checks of flow fouer-walk (Ian's playtest: sprint, pin, collision that equals the visible geometry, rides from the builder).  Imported by fouer_walk.mjs; every
 * function takes the flow harness `h` and expects a booted game (`?fouerDebug=1`) with the full fair (fillFair(3, 5)).
 *   sprintChecks      Shift / the 🏃 toggle / a full stick push sprint, blur releases Shift, the speeds are 2.6 / 6.5 m/s and ease in and out
 *   pinChecks         the 🧍 pin dragged onto the map (mouse and touch): marker, snapping, red / invalid, cancel, tap, lands where it was dropped and faces an attraction
 *   solidsChecks      collision == visible geometry: no blocked cell without a visible solid, no free-looking gap >= 1.2 m that is blocked, the Fouerfesch seating area and the
 *                     counter of a stall are reachable with the real controller, the Bierzelt is walk-in
 *   builderRideChecks "Fueren" in the manage sheet of the builder view boards the ride and gives the builder camera back exactly */
import { tapAt } from "./fouer_game.mjs";

export const evalG = (page, fn, arg) => page.evaluate(([src, a]) => (0, eval)(src)(window.__fouerGame, a), [fn.toString(), arg]);

/** page side: where a game point is on the screen */
const SCREEN_OF = `(g, p) => { const T = g.r.THREE, c = g.r.renderer.domElement.getBoundingClientRect(); const v = new T.Vector3(p.u, g.world.groundY(p.u, p.w), p.w).project(g.r.camera); return { x: c.left + (v.x + 1) / 2 * c.width, y: c.top + (1 - v.y) / 2 * c.height, ok: v.z < 1 && Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.98 }; }`;
const screenOf = (page, u, w) => evalG(page, (g, a) => (0, eval)(a.src)(g, a.p), { src: SCREEN_OF, p: { u, w } });

export async function sprintChecks(h) {
  const { page } = h, sleep = ms => h.pause(ms);
  h.step("sprint: 2.6 m/s walking, Shift / the 🏃 toggle / a full stick push sprint at 6.5 m/s, eased, Shift released when the window loses focus");
  await evalG(page, g => { if (!g.walk.active) window.__fouerHooks.startWalk(); });
  await sleep(900);
  const place = (x, z, yaw) => evalG(page, (g, a) => { g.walk.teleport(a.x, a.z, a.yaw); g.walk.setLook(a.yaw, 0); }, { x, z, yaw });
  const speed = () => evalG(page, g => g.walk.speed);
  const where = () => evalG(page, g => ({ x: g.walk.view.x, z: g.walk.view.z }));
  // the main alley (w 50 .. 62) runs along u: 40 m of free asphalt from u 46
  await place(46, 56, 0); await sleep(500);
  await page.keyboard.down("KeyW"); await sleep(1500);
  const walking = await speed();
  await page.keyboard.up("KeyW"); await sleep(600);
  h.expect(walking > 2.3 && walking < 2.9, `walking pace is about 2.6 m/s (${walking.toFixed(2)} m/s after 1.5 s)`);

  await place(46, 56, 0); await sleep(300);
  await page.keyboard.down("KeyW"); await page.keyboard.down("Shift");
  const ramp = []; for (let i = 0; i < 4; i++) { await sleep(120); ramp.push(await speed()); }
  await sleep(900);
  const sprint = await speed();
  const p0 = await where(); await sleep(500); const p1 = await where();
  await page.keyboard.up("Shift"); await sleep(1300); const afterShift = await speed();
  await page.keyboard.up("KeyW"); await sleep(700); const stopped = await speed();
  h.expect(sprint > 5.8 && sprint < 7.2, `Shift sprints at about 6.5 m/s (${sprint.toFixed(2)} m/s; ${(Math.hypot(p1.x - p0.x, p1.z - p0.z) / 0.5).toFixed(1)} m/s measured over 0.5 s)`);
  h.expect(ramp[0] < sprint * 0.8 && ramp.every((v, i) => i === 0 || v >= ramp[i - 1] - 0.05), `the speed eases in (${ramp.map(v => v.toFixed(1)).join(" -> ")} m/s over 0.5 s), no jump`);
  h.expect(afterShift > 2.3 && afterShift < 3.0, `letting go of Shift is back to walking pace (${afterShift.toFixed(2)} m/s)`);
  h.expect(stopped < 0.15, `and releasing W stops (${stopped.toFixed(2)} m/s)`);

  // Safari reports Shift through `key` / `shiftKey` only (no `code`): a synthetic event like that must sprint too, and a window blur must release it
  await place(46, 56, 0); await sleep(300);
  await page.keyboard.down("KeyW");
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true, bubbles: true })));
  await sleep(1300);
  const safari = await speed();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await sleep(500);
  const stoppedByBlur = await speed();
  await page.keyboard.up("KeyW"); await page.keyboard.down("KeyW"); await sleep(1300);           // W again: if Shift were still "down" this would sprint
  const blurred = await speed();
  await page.keyboard.up("KeyW"); await sleep(500);
  h.expect(safari > 5.8, `Shift as {key: "Shift", shiftKey: true} (no code) sprints (${safari.toFixed(2)} m/s)`);
  h.expect(stoppedByBlur < 0.5 && blurred < 3.0 && blurred > 2.2, `losing the window focus releases the keys (${stoppedByBlur.toFixed(2)} m/s) and Shift: W again walks at ${blurred.toFixed(2)} m/s instead of sprinting for ever`);
  // a keyup that never arrives: the next key event carries shiftKey = false
  await place(46, 56, 0); await sleep(300);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true, bubbles: true })));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", key: "w", shiftKey: false, bubbles: true })));
  await sleep(1300);
  const missed = await speed();
  await page.keyboard.down("KeyW"); await page.keyboard.up("KeyW"); await sleep(500);
  h.expect(missed < 3.0, `a lost Shift keyup does not stick (${missed.toFixed(2)} m/s)`);

  // the 🏃 toggle (touch)
  const sprintBtn = await page.locator(".wk-sprint").boundingBox();
  h.expect(!!sprintBtn && sprintBtn.width >= 44, "the 🏃 sprint button is on screen and big enough to hit");
  await place(46, 56, 0); await sleep(300);
  await tapAt(h, sprintBtn.x + sprintBtn.width / 2, sprintBtn.y + sprintBtn.height / 2);
  const pressed = await page.locator(".wk-sprint").getAttribute("aria-pressed");
  await evalG(page, g => g.walk.setInputKeys(["f"]));
  await sleep(1700);
  const toggled = await speed();
  await tapAt(h, sprintBtn.x + sprintBtn.width / 2, sprintBtn.y + sprintBtn.height / 2);
  await sleep(1400);
  const toggledOff = await speed();
  await evalG(page, g => g.walk.setInputKeys([])); await sleep(500);
  h.expect(pressed === "true" && toggled > 5.8, `the 🏃 toggle sprints (${toggled.toFixed(2)} m/s, aria-pressed ${pressed})`);
  h.expect(toggledOff > 2.2 && toggledOff < 3.0, `tapping it again walks (${toggledOff.toFixed(2)} m/s)`);

  // the joystick: a light push walks slowly, a full push sprints
  await place(46, 56, 0); await sleep(300);
  await evalG(page, g => g.walk.setStick(0, -0.45)); await sleep(1500); const light = await speed();
  await evalG(page, g => g.walk.setStick(0, -1)); await sleep(1500); const full = await speed();
  await evalG(page, g => g.walk.setStick(0, 0)); await sleep(500);
  h.expect(light > 0.9 && light < 2.3, `a light stick push walks slowly (${light.toFixed(2)} m/s)`);
  h.expect(full > 5.8, `a full stick push sprints (${full.toFixed(2)} m/s)`);
  const fov = await evalG(page, g => g.r.camera.fov);
  h.expect(fov >= 70 && fov <= 76, `the view widens a little while sprinting and returns (fov ${fov.toFixed(1)})`);
}

export async function pinChecks(h) {
  const { page } = h, sleep = ms => h.pause(ms);
  h.step("pin: drag the 🧍 onto the map: marker follows (snapped, red where nothing can be walked), drop starts the walk there facing an attraction; a tap only explains");
  await evalG(page, g => { if (g.walk.active) g.walk.end(); g.r.setPose(g.r.framePose(), true); g.ui.closeSheet(); });
  await sleep(1200);
  const pin = await page.locator("#pinBtn").boundingBox();
  h.expect(!!pin && pin.width >= 44, "the 🧍 pin button is on screen next to 👣");
  const bx = pin.x + pin.width / 2, by = pin.y + pin.height / 2;
  const state = () => evalG(page, g => ({ walking: g.walk.active, view: { ...g.walk.view }, pin: g.scene.pinState, shown: g.scene.pinShown, ghost: Boolean(document.querySelector(".pin-ghost")), toast: [...document.querySelectorAll(".toast")].map(t => t.textContent).join("|") }));
  const expected = (u, w) => evalG(page, (g, a) => { const f = g.mask.allowed(a.u, a.w) ? { x: a.u, z: a.w } : g.mask.nearestFree(a.u, a.w, 10, 0.5); return f; }, { u, w });

  // --- a tap does not start anything
  await page.mouse.move(bx, by); await page.mouse.down(); await page.mouse.up(); await sleep(400);
  let st = await state();
  h.expect(!st.walking && /./.test(st.toast), `a plain tap on 🧍 only explains it (toast "${st.toast.split("|")[0]}"), no walk`);

  // --- free ground in the main alley
  let target = null, s1 = null;
  for (const c of [{ u: 150, w: 56 }, { u: 190, w: 56 }, { u: 120, w: 56 }, { u: 230, w: 56 }]) { const s = await screenOf(page, c.u, c.w); if (s.ok) { target = c; s1 = s; break; } }
  if (!h.expect(target !== null, `a spot in the main alley is on screen in the overview (${target ? target.u + ", " + target.w + " at " + s1.x.toFixed(0) + ", " + s1.y.toFixed(0) : "none"})`)) return;
  await page.mouse.move(bx, by); await page.mouse.down(); await page.mouse.move((bx + s1.x) / 2, (by + s1.y) / 2, { steps: 4 }); await page.mouse.move(s1.x, s1.y, { steps: 4 }); await sleep(250);
  st = await state();
  h.expect(st.ghost && st.shown && st.pin && st.pin.valid, `while dragging: the ghost follows, the ground marker shows a valid spot (${st.pin ? st.pin.x.toFixed(1) + ", " + st.pin.z.toFixed(1) : "none"})`);
  h.expect(!st.walking, "nothing starts before the drop");
  await h.shot("pin-drag-valid");
  await page.mouse.up(); await sleep(1500);
  st = await state();
  h.expect(st.walking && !st.shown && !st.ghost, "dropping starts the walk, the marker and the ghost are gone");
  h.expect(Math.hypot(st.view.x - target.u, st.view.z - target.w) < 1.6, `the walker lands where the pin was dropped (${st.view.x.toFixed(1)}, ${st.view.z.toFixed(1)} for the target ${target.u}, ${target.w}; the click point is only as exact as the pixel)`);
  const faced = await evalG(page, (g, a) => {
    let best = null, bd = 60; g.game.state.pitches.forEach((e, i) => { if (!e) return; const r = g.scene.rects[i]; const d = Math.hypot(r.u - g.walk.view.x, r.w - g.walk.view.z); if (d < bd) { bd = d; best = i; } });
    if (best === null) return null; const r = g.scene.rects[best]; const want = Math.atan2(r.w - g.walk.view.z, r.u - g.walk.view.x); let d = (g.walk.view.yaw - want) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d);
  });
  h.expect(faced !== null && faced < 0.15, `the walk starts facing the nearest attraction (${faced === null ? "-" : faced.toFixed(2)} rad off)`);
  await h.shot("pin-landed");
  await evalG(page, g => g.walk.end()); await sleep(1400);

  // --- dropped on a stall: snapped to the nearest walkable point (within 1 m of it)
  const stallPitch = await evalG(page, g => ({ u: g.scene.rects[0].u, w: g.scene.rects[0].w }));
  const s2 = await screenOf(page, stallPitch.u, stallPitch.w);
  await page.mouse.move(bx, by); await page.mouse.down(); await page.mouse.move(s2.x, s2.y - 0, { steps: 8 }); await sleep(250);
  st = await state();
  const raw2 = await evalG(page, (g, a) => g.r.screenToGround(a.x, a.y), { x: s2.x, y: s2.y });
  const want2 = await expected(raw2.u, raw2.w);
  h.expect(st.pin && st.pin.valid && st.pin.snapped, `a drop on a stall is snapped (marker at ${st.pin ? st.pin.x.toFixed(1) + ", " + st.pin.z.toFixed(1) : "?"}, raw point ${raw2.u.toFixed(1)}, ${raw2.w.toFixed(1)})`);
  await page.mouse.up(); await sleep(1500);
  st = await state();
  const free2 = await evalG(page, g => ({ ok: g.mask.allowed(g.walk.view.x, g.walk.view.z), open: g.mask.openArea(g.walk.view.x, g.walk.view.z, 3000) >= 3000 }));
  h.expect(st.walking && free2.ok && free2.open && Math.hypot(st.view.x - raw2.u, st.view.z - raw2.w) < 10, `...and the walk starts on walkable open ground near the drop (${st.view.x.toFixed(1)}, ${st.view.z.toFixed(1)}, ${Math.hypot(st.view.x - raw2.u, st.view.z - raw2.w).toFixed(1)} m from the raw point; the hollow inside the closed hut is refused: its nearest free cell was ${want2 ? want2.x.toFixed(1) + ", " + want2.z.toFixed(1) : "-"})`);
  await evalG(page, g => g.walk.end()); await sleep(1400);

  // --- invalid: far outside the Glacis
  let outside = null;
  for (const c of [[150, -70], [150, 175], [-70, 60], [350, 60], [-40, -40], [330, 170]]) { const s = await screenOf(page, c[0], c[1]); if (s.ok) { outside = { c, s }; break; } }
  if (h.expect(outside !== null, "a spot outside the fair is on screen in the overview")) {
    await page.mouse.move(bx, by); await page.mouse.down(); await page.mouse.move(outside.s.x, outside.s.y, { steps: 8 }); await sleep(250);
    st = await state();
    h.expect(st.shown && st.pin && !st.pin.valid, `over the street / grass the marker is red (invalid) at ${outside.c.join(", ")}`);
    await page.mouse.up(); await sleep(900);
    st = await state();
    h.expect(!st.walking && !st.shown && /./.test(st.toast), `dropping there does not start a walk (toast "${st.toast.split("|").pop()}")`);
    await h.shot("pin-drag-invalid");
  }

  // --- cancel: back onto the button
  await page.mouse.move(bx, by); await page.mouse.down(); await page.mouse.move(s1.x, s1.y, { steps: 5 }); await page.mouse.move(bx, by, { steps: 5 }); await sleep(200);
  await page.mouse.up(); await sleep(700);
  st = await state();
  h.expect(!st.walking && !st.shown, "letting go on the button again cancels");

  // --- touch: the pin hangs 58 px above the finger, so the tip (the drop point) is where the finger is not hiding it
  const s3 = await screenOf(page, target.u - 10, target.w);
  const ptr = (type, x, y) => page.evaluate(([ty, px, py]) => { const el = document.getElementById("pinBtn"); el.dispatchEvent(new PointerEvent(ty, { bubbles: true, cancelable: true, pointerId: 77, pointerType: "touch", isPrimary: true, clientX: px, clientY: py, button: 0, buttons: ty === "pointerup" ? 0 : 1 })); }, [type, x, y]);
  await ptr("pointerdown", bx, by); await ptr("pointermove", (bx + s3.x) / 2, (by + s3.y + 58) / 2); await ptr("pointermove", s3.x, s3.y + 58); await sleep(250);
  st = await state();
  h.expect(st.pin && st.pin.valid && Math.hypot(st.pin.x - (target.u - 10), st.pin.z - target.w) < 2, `touch: the drop point is the tip of the pin, 58 px above the finger (marker ${st.pin ? st.pin.x.toFixed(1) + ", " + st.pin.z.toFixed(1) : "none"} for ${target.u - 10}, ${target.w})`);
  await ptr("pointerup", s3.x, s3.y + 58); await sleep(1500);
  st = await state();
  h.expect(st.walking && Math.hypot(st.view.x - (target.u - 10), st.view.z - target.w) < 2, `touch: the walk starts at the dropped spot (${st.view.x.toFixed(1)}, ${st.view.z.toFixed(1)})`);
  await evalG(page, g => g.walk.end()); await sleep(1400);
}

/** the real controller walks a path (BFS over the live mask, string pulling): { ok, left, metres } */
const WALKER = `(g, a) => {
  const R = 0.45, CELL = 0.5, u0 = a.box.u0, w0 = a.box.w0, nu = Math.ceil((a.box.u1 - u0) / CELL), nw = Math.ceil((a.box.w1 - w0) / CELL);
  const free = (i, j) => i >= 0 && j >= 0 && i < nu && j < nw && g.mask.allowed(u0 + (i + 0.5) * CELL, w0 + (j + 0.5) * CELL, R);
  const cell = p => [Math.floor((p.x - u0) / CELL), Math.floor((p.z - w0) / CELL)];
  const par = new Int32Array(nu * nw).fill(-2); const s = cell(a.from); if (!free(s[0], s[1])) return { ok: false, why: 'start blocked', left: 99 };
  const q = [s]; par[s[1] * nu + s[0]] = -1;
  for (let h = 0; h < q.length; h++) { const [i, j] = q[h]; for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { if (!di && !dj) continue; const x = i + di, y = j + dj; if (x < 0 || y < 0 || x >= nu || y >= nw || par[y * nu + x] !== -2 || !free(x, y)) continue; if (di && dj && (!free(i + di, j) || !free(i, j + dj))) continue; par[y * nu + x] = j * nu + i; q.push([x, y]); } }
  const t = cell(a.to); if (par[t[1] * nu + t[0]] === -2) return { ok: false, why: 'unreachable', left: 99 };
  const path = []; for (let k = t[1] * nu + t[0]; k >= 0; k = par[k]) path.push({ x: u0 + ((k % nu) + 0.5) * CELL, z: w0 + (Math.floor(k / nu) + 0.5) * CELL }); path.reverse(); path.push(a.to);
  const ok = (p, r) => { const n = Math.ceil(Math.hypot(r.x - p.x, r.z - p.z) / 0.25); for (let k = 1; k <= n; k++) { const f = k / n; if (!g.mask.allowed(p.x + (r.x - p.x) * f, p.z + (r.z - p.z) * f, R * 0.8)) return false; } return true; };
  const way = [path[0]]; let i = 0; while (i < path.length - 1) { let j = path.length - 1; while (j > i + 1 && !ok(path[i], path[j])) j--; way.push(path[j]); i = j; }
  const w = g.walk; g.walk.teleport(a.from.x, a.from.z, 0); w.setInputKeys(['f', 'run']);
  let wp = 1, steps = 0, metres = 0, lx = w.view.x, lz = w.view.z;
  while (steps++ < 6000) { const v = w.view, tg = way[Math.min(wp, way.length - 1)]; if (Math.hypot(tg.x - v.x, tg.z - v.z) < 0.9 && wp < way.length - 1) { wp++; continue; } const last = way[way.length - 1]; if (Math.hypot(last.x - v.x, last.z - v.z) < 0.5) break; w.setLook(Math.atan2(tg.z - v.z, tg.x - v.x), 0); w.update(1 / 30); metres += Math.hypot(v.x - lx, v.z - lz); lx = v.x; lz = v.z; }
  w.setInputKeys([]); for (let k = 0; k < 8; k++) w.update(1 / 30);
  return { ok: true, left: Math.hypot(a.to.x - w.view.x, a.to.z - w.view.z), metres, waypoints: way.length, way };
}`;
export const walkTo = (page, from, to, box) => evalG(page, (g, a) => (0, eval)(a.src)(g, a), { src: WALKER, from, to, box });

export async function solidsChecks(h, { shot = null } = {}) {
  const { page } = h, sleep = ms => h.pause(ms);
  h.step("collision equals the visible geometry: invisible walls, blocked gaps, the Fouerfesch seating area, a stall counter, the Bierzelt");
  await evalG(page, g => { if (g.walk.active) g.walk.end(); });
  await sleep(600);

  // ---- 1. the whole fair: the mask against every drawn mesh
  const cmp = await evalG(page, async g => {
    const S = await import("/pb/fouer/solids.js"); const { PITCHES } = await import("/pb/fouer/data.js");
    const vis = S.createRaster({ u0: -12, u1: 322, w0: -24, w1: 164 }, 0.1);
    S.rasterObject(vis, { children: g.fair.batches.base.merged, matrix: null }, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    g.scene.rects.forEach((r, i) => { const pit = g.fair.pits.get(PITCHES[i].id); if (pit && pit.near) S.rasterObject(vis, pit.near, S.pitchMatrix(r, PITCHES[i].face)); });
    const inset = (x, z) => [[0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]].every(([a, b]) => g.mask.inRegion(x + a, z + b)) && x > 0;
    const t0 = performance.now();
    const res = S.maskVsVisible({ visible: vis, isBlocked: (x, z) => g.mask.solidAt(x, z), region: inset, step: 0.25 });
    const gaps = S.blockedOpenGaps({ visible: vis, isAllowed: (x, z) => g.mask.freeAt(x, z), region: inset, clearance: 0.6 });
    const near = c => { let best = null, bd = 1e9; g.scene.rects.forEach((r, i) => { const d = Math.hypot(r.u - (c.u0 + c.u1) / 2, r.w - (c.w0 + c.w1) / 2); if (d < bd) { bd = d; best = PITCHES[i].id + ":" + (g.game.state.pitches[i] || {}).k; } }); return best + "@" + bd.toFixed(0) + "m"; };
    const fmt = list => S.clusterPoints(list).slice(0, 8).map(c => `${c.cells} cells u ${c.u0.toFixed(1)}..${c.u1.toFixed(1)} w ${c.w0.toFixed(1)}..${c.w1.toFixed(1)} near ${near(c)}`);
    const ci = S.clusterPoints(res.invisible), cg = S.clusterPoints(gaps);
    return { ms: Math.round(performance.now() - t0), blocked: res.blockedCells, solid: res.solidCells, invisible: res.invisible.length, bigInvisible: ci.filter(c => c.cells >= 40).length, through: res.through.length, gaps: gaps.length, bigGaps: cg.filter(c => c.cells >= 40).length,
      invisibleTop: fmt(res.invisible), gapsTop: fmt(gaps), maxInvisible: ci[0] ? ci[0].cells : 0, maxGap: cg[0] ? cg[0].cells : 0, base: g.mask.npc.length, pit: g.mask.pitchBoxes.length };
  });
  console.log("    solids:", JSON.stringify({ ms: cmp.ms, blocked: cmp.blocked, solid: cmp.solid, base: cmp.base, pit: cmp.pit }));
  h.expect(cmp.blocked > 20000 && cmp.solid > 20000, `the full fair has ${cmp.blocked} blocked and ${cmp.solid} visibly solid sampling cells (0.25 m)`);
  h.expect(cmp.bigInvisible === 0 && cmp.invisible < 400, `no invisible walls: ${cmp.invisible} blocked cells have no visible solid within 0.3 m (largest cluster ${cmp.maxInvisible} cells)${cmp.invisibleTop.length ? ": " + cmp.invisibleTop.slice(0, 3).join(" ; ") : ""}`);
  h.expect(cmp.bigGaps === 0 && cmp.gaps < 400, `no blocked gap that looks open (>= 1.2 m between visible solids): ${cmp.gaps} cells (largest cluster ${cmp.maxGap})${cmp.gapsTop.length ? ": " + cmp.gapsTop.slice(0, 3).join(" ; ") : ""}`);
  h.expect(cmp.through < cmp.solid * 0.06, `the mask lets only ${cmp.through} of ${cmp.solid} visible solid cells through (thin rails, bunting poles, moving parts of rides)`);

  // ---- 2. the Fouerfesch (P03, face +w, 16 x 16 at u 86 w 41): the seating area and the counter, level 1 (no rail) and gold (rail across the front)
  const P03 = await evalG(page, g => ({ u: g.scene.rects[2].u, w: g.scene.rects[2].w, k: g.game.state.pitches[2].k }));
  h.eq(P03.k, "fesch", "pitch P03 holds the Fouerfësch");
  const local = (x, z) => ({ x: P03.u + x, z: P03.w + z });              // face +w: local x = u, local z = w
  const BOX = { u0: P03.u - 24, u1: P03.u + 24, w0: P03.w - 26, w1: P03.w + 30 };
  for (const [lv, label] of [[0, "level 1 (no rail)"], [3, "gold (rail across the front)"]]) {
    await evalG(page, (g, a) => { const s = g.game.state; g.game.debugSetState({ ...s, pitches: s.pitches.map((e, i) => (i === 2 ? { ...e, lv: a.lv } : e)) }); }, { lv });
    await sleep(2600);
    await evalG(page, g => { if (!g.walk.active) window.__fouerHooks.startWalk(); });
    await sleep(900);
    const aisle = await walkTo(page, { x: P03.u + 6, z: 56 }, local(0.1, 2.2), BOX);
    h.expect(aisle.ok && aisle.left < 0.9, `Fouerfësch ${label}: the walker reaches the seating area between the tables (${aisle.ok ? aisle.left.toFixed(2) + " m off, " + aisle.metres.toFixed(0) + " m walked" : aisle.why})`);
    if (lv === 0) { await evalG(page, g => g.walk.setLook(Math.PI, -0.12)); await sleep(700); await h.shot("walk-fesch-seating"); }
    const counter = await walkTo(page, { x: P03.u + 6, z: 56 }, local(0, -0.8), BOX);
    const act = await evalG(page, g => { g.walk.scanTargets(); return g.walk.targets.map(t => t.kind); });
    h.expect(counter.ok && counter.left < 0.9, `Fouerfësch ${label}: the walker stands right at the counter of the stall (${counter.ok ? counter.left.toFixed(2) + " m off" : counter.why}), the action offered: ${act.join(",") || "-"}`);
    if (lv === 0) h.expect(act[0] === "eat", "at the counter the round button offers Iessen");
    if (lv === 0) { await evalG(page, (g, a) => g.walk.setLook(-Math.PI / 2, -0.1), {}); await sleep(700); await h.shot("walk-fesch-counter"); }
    await evalG(page, g => g.walk.end()); await sleep(900);
  }
  await evalG(page, g => g.fillFair(3, 5)); await sleep(2500);

  // ---- 3. the Bierzelt (P09 'tent', 30 x 18 at u 140 w 41): walk-in
  const tent = await evalG(page, g => ({ u: g.scene.rects[8].u, w: g.scene.rects[8].w, k: g.game.state.pitches[8].k, boxes: g.mask.pitchBoxes.length }));
  h.eq(tent.k, "tent", "pitch P09 holds the Bierzelt");
  await evalG(page, g => { if (!g.walk.active) window.__fouerHooks.startWalk(); });
  await sleep(900);
  const inside = await walkTo(page, { x: tent.u + 3, z: tent.w + 16 }, { x: tent.u, z: tent.w }, { u0: tent.u - 30, u1: tent.u + 30, w0: tent.w - 22, w1: tent.w + 26 });
  h.expect(inside.ok && inside.left < 1.2, `the Bierzelt is walk-in: the walker reaches its middle from the alley (${inside.ok ? inside.left.toFixed(2) + " m off, " + inside.metres.toFixed(0) + " m walked" : inside.why})`);
  await evalG(page, g => g.walk.setLook(-Math.PI / 2, -0.05)); await sleep(700);
  await h.shot("walk-bierzelt-inside");
  await evalG(page, g => g.walk.end()); await sleep(900);
}

export async function builderRideChecks(h) {
  const { page } = h, sleep = ms => h.pause(ms);
  h.step("rides from the builder view: the manage sheet offers 🎢 Fueren, it boards the ride, and the builder camera is exactly where it was afterwards");
  await evalG(page, g => { if (g.walk.active) g.walk.end(); g.r.setPose({ tu: 100, tw: 56, yaw: 0, dist: 150, tilt: 0 }, true); g.ui.closeSheet(); g.ride.setTestSpeedup(14); });
  await sleep(1200);
  const cam = () => evalG(page, g => { const c = g.r.camera; return { pos: c.position.toArray(), quat: c.quaternion.toArray(), fov: c.fov, near: c.near, free: g.r.state.free, walking: g.walk.active, riding: g.ride.active, from: g.walk.fromBuilder, body: document.body.className }; });
  // not rideable: a stall has no button
  await evalG(page, g => g.ui.openPitch(0)); await sleep(1100);
  h.eq(await page.locator(".sheet.manage .ridego").count(), 0, "a stall's manage sheet has no Fueren button");
  await evalG(page, g => g.ui.closeSheet());
  const rides = await evalG(page, g => g.game.state.pitches.map((e, i) => e && ["kette", "maus", "kanner", "break", "scooter", "wheel"].includes(e.k) ? { i, k: e.k } : null).filter(Boolean));
  let n = 0;
  for (const ride of rides.filter(r => ["kette", "maus", "scooter", "wheel"].includes(r.k))) {
    n++;
    await evalG(page, (g, a) => g.ui.openPitch(a.i), ride); await sleep(1500);
    // the focus flight and the easing of the camera have to be over (frame time is clamped, so on a busy machine this takes longer than the flight's seconds)
    await page.waitForFunction(() => { const g = window.__fouerGame, rg = g.r.rig; return !rg.flight && Math.abs(rg.cu - rg.tu) < 1e-4 && Math.abs(rg.cw - rg.tw) < 1e-4 && Math.abs(rg.cdist - rg.dist) < 1e-3; }, null, { timeout: 30000 }).catch(() => {});
    await sleep(400);
    const before = await cam();
    const btn = page.locator(".sheet.manage .ridego");
    if (!h.expect(await btn.count() === 1, `${ride.k}: the manage sheet shows 🎢 Fueren`)) continue;
    await btn.scrollIntoViewIfNeeded();
    const box = await btn.boundingBox();
    await tapAt(h, box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => window.__fouerGame.ride.active && window.__fouerGame.ride.phase === "riding", null, { timeout: 15000 }).catch(() => {});
    const during = await cam();
    h.expect(during.walking && during.riding && during.from, `${ride.k}: tapping it fades into the ride (riding, started from the builder)`);
    if (n === 1) await h.shot("builder-ride-riding");
    if (ride.k === "kette") {
      await sleep(1800);
      await page.keyboard.press("Escape");                           // getting off early also returns to the builder
    }
    await page.waitForFunction(() => !window.__fouerGame.walk.active, null, { timeout: 70000 }).catch(() => {});
    await sleep(900);
    const after = await cam();
    const dp = Math.hypot(...after.pos.map((v, i) => v - before.pos[i])), dq = Math.hypot(...after.quat.map((v, i) => v - before.quat[i]));
    h.expect(!after.walking && !after.riding && after.free === null && !/walking|wk-on/.test(after.body), `${ride.k}: back in the builder view (${ride.k === "kette" ? "left with Esc" : "the ride ended"})`);
    h.expect(dp < 1e-3 && dq < 1e-4, `${ride.k}: the builder camera is exactly where it was (position ${dp.toExponential(1)} m, orientation ${dq.toExponential(1)})`);
    h.expect(Math.abs(after.fov - before.fov) < 1e-9 && Math.abs(after.near - before.near) < 1e-9, `${ride.k}: builder FOV and near plane are back`);
    await evalG(page, g => g.ui.closeSheet()); await sleep(500);
  }
  await evalG(page, g => g.ride.setTestSpeedup(1));
}
