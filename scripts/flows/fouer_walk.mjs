/* Flow: Schueberfouer Tycoon W6 "Walk" (pb/fouer.html: the first-person walk, the crowd, the soundscape, eating, the Riserad ride).
 *
 * iPad portrait profile (touch, 820x1180, Supabase mocked), ONE page at a time (8 GB machine):
 *   - the 👣 button enters the walk (eye 1.65 m, FOV 70), the exit restores the builder camera exactly (also with Esc); the walk starts at the most
 *     recently upgraded attraction and looks at it;
 *   - the keys and the joystick move the right way (A = left! measured as the real movement projected on the camera's right vector), Shift runs,
 *     arrows turn, dragging looks (touch and mouse);
 *   - collision: a built stall, an NPC stall and the closed gates block, the open NE portal lets the walker out to the Allée Scheffer, the tram pushes;
 *   - eating at the Gromperekichelcher stall: round button only near something useful, 2 s animation, thought bubble, Foodie x1.05 (+5 % income),
 *     stacking to three, a fourth is refused, the same food again is "known";
 *   - the Riserad: board, the camera goes up past 40 m and stays upright, two revolutions, back on the platform, the stamp "Op der Spëtzt" (flag r);
 *     a coaster point of view (Wëll Maus) moves along the track and aborts cleanly; the pioneers' Probefahrt uses a temporary wheel and restores the pitch;
 *   - the crowd: real queue rows at overloaded attractions, the red clocks only in the builder view, counts follow the quality (low 70 / medium 150 / high 320)
 *     and the builder view shows a thinner crowd; Hämmi bleats when tapped (builder and walk);
 *   - audio: the graph builds after a tap without errors (ambient layers, at most 6 attraction voices), the arcade mute silences it;
 *   - the photo button saves a PNG; performance on the iPad-medium profile stays inside DESIGN 5 (walk <= 220 draws / 300k triangles) at six positions;
 *   - zero console errors.
 * Screenshots (set FLOW_SHOTS_DIR): the walk at the start, in the alley, eating, in a queue, the ride, the Allée Scheffer. */
import { runIfMain } from "./lib.mjs";
import { bootGame, tapAt, consoleCollector } from "./fouer_game.mjs";

const URL_BASE = "/pb/fouer.html?fouerDebug=1&fouerNoFly=1&fouerTimeMode=evening&fouerWeather=clear&fouerQ=";
const WALK_DRAWS = 220, WALK_TRIS = 300000, BUILDER_DRAWS = 140, BUILDER_TRIS = 300000;

const evalG = (page, fn, arg) => page.evaluate(([src, a]) => (0, eval)(src)(window.__fouerGame, a), [fn.toString(), arg]);

export const flow = {
  name: "fouer-walk",
  fullChromium: true,
  touch: true,
  backend: { tables: { game_saves: () => [] }, rpc: { ack_game_gift: () => true, claim_game_gifts: () => [] } },
  async run(h) {
    const { page } = h;
    const errors = consoleCollector(page);
    page.on("dialog", dialog => dialog.dismiss().catch(() => {}));
    await h.signIn();
    const sleep = ms => h.pause(ms);
    const walkState = () => evalG(page, g => ({ active: g.walk.active, view: { ...g.walk.view }, targets: g.walk.targets.map(t => t.kind) }));
    /** distance along the camera's forward / right (flattened on the ground) of a movement */
    const project = (before, after, cam) => {
      const dx = after.x - before.x, dz = after.z - before.z;
      return { fwd: dx * cam.fx + dz * cam.fz, right: dx * cam.rx + dz * cam.rz };
    };
    const camBasis = () => evalG(page, g => { const T = g.r.THREE; const d = g.r.camera.getWorldDirection(new T.Vector3()); const l = Math.hypot(d.x, d.z) || 1; return { fx: d.x / l, fz: d.z / l, rx: -d.z / l, rz: d.x / l }; });
    const keyMove = async (code, ms = 700) => {
      const before = (await walkState()).view, cam = await camBasis();
      await page.keyboard.down(code); await sleep(ms); await page.keyboard.up(code); await sleep(350);
      return project(before, (await walkState()).view, cam);
    };
    const ptr = (selector, type, x, y, id = 21, kind = "touch") => page.evaluate(([sel, ty, px, py, pid, pk]) => {
      const el = document.querySelector(sel);
      el.dispatchEvent(new PointerEvent(ty, { bubbles: true, cancelable: true, pointerId: pid, pointerType: pk, isPrimary: true, clientX: px, clientY: py, button: 0, buttons: ty === "pointerup" ? 0 : 1 }));
    }, [selector, type, x, y, id, kind]);
    const stickMove = async (dx, dy, ms = 700) => {
      const box = await page.locator(".wk-stick").boundingBox();
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      const before = (await walkState()).view, cam = await camBasis();
      await ptr(".wk-stick", "pointerdown", cx, cy);
      await ptr(".wk-stick", "pointermove", cx + dx, cy + dy);
      await sleep(ms);
      await ptr(".wk-stick", "pointerup", cx + dx, cy + dy);
      await sleep(350);
      return project(before, (await walkState()).view, cam);
    };
    const place = (x, z, yaw) => evalG(page, (g, a) => { g.walk.teleport(a.x, a.z, a.yaw); g.walk.setLook(a.yaw, 0); }, { x, z, yaw });
    /** where to stand in front of pitch i (out metres from its front edge) and the yaw that looks at it */
    const frontOf = (i, out = 2.2) => evalG(page, async (g, a) => {
      const { PITCHES } = await import("/pb/fouer/data.js"); const { frontSpot } = await import("/pb/fouer/walk.js");
      const r = g.scene.rects[a.i]; const s = frontSpot(r, PITCHES[a.i].face, a.out); const free = g.mask.nearestFree(s.x, s.z, 5) ?? s;
      return { x: free.x, z: free.z, yaw: Math.atan2(r.w - free.z, r.u - free.x) };
    }, { i, out });
    const tapSel = async selector => { const box = await page.locator(selector).boundingBox(); await tapAt(h, box.x + box.width / 2, box.y + box.height / 2); };
    const perf = async () => { await sleep(1300); return evalG(page, async g => { const out = []; for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 160)); const s = g.r.performanceSnapshot(); out.push([s.drawCalls, s.triangles, s.fps]); } return { draws: Math.max(...out.map(o => o[0])), tris: Math.max(...out.map(o => o[1])), fps: Math.round(out.reduce((a, o) => a + o[2], 0) / out.length) }; }); };

    /* ------------------------------------------------------------ 1. boot, a small fair, the walk starts at the last upgrade */
    h.step("boot (iPad medium), two stalls, the second one upgraded last");
    await h.goto(URL_BASE + "medium");
    await bootGame(h);
    await evalG(page, g => {
      const s = g.game.state;
      g.game.debugSetState({ ...s, c: 1e6, tu: 8, rb: 1000, pitches: s.pitches.map((e, i) => i === 0 ? { k: "kachel", lv: 0, look: 0, fl: 0 } : i === 1 ? { k: "kanner", lv: 0, look: 0, fl: 0 } : e) });
      g.game.upgrade(1);
    });
    await sleep(1600);
    const builderCam = await evalG(page, g => { const c = g.r.camera; return { pos: c.position.toArray(), quat: c.quaternion.toArray(), fov: c.fov, near: c.near, rig: { ...g.r.rig } }; });
    await h.shot("00-builder");

    h.step("tap the 👣 button: the walk starts in front of the most recent attraction, eye 1.65 m, FOV 70");
    await tapSel("#walkBtn");
    await sleep(1800);
    const w0 = await evalG(page, g => { const c = g.r.camera; const v = g.walk.view; const gy = g.world.groundY(v.x, v.z); const r = g.scene.rects[1]; return { active: g.walk.active, fov: c.fov, near: c.near, eye: c.position.y - gy, vx: v.x, vz: v.z, yaw: v.yaw, free: Boolean(g.r.state.free), body: document.body.classList.contains("walking"), hud: !document.querySelector(".wk").hidden, builderHud: getComputedStyle(document.querySelector(".hud")).display, dist: Math.hypot(v.x - r.u, v.z - r.w), face: Math.cos(v.yaw) * (r.u - v.x) + Math.sin(v.yaw) * (r.w - v.z), rect: r }; });
    h.expect(w0.active && w0.free && w0.body && w0.hud, "walking: the controller is active, the builder camera is switched off, the walk HUD is shown");
    h.expect(Math.abs(w0.fov - 70) < 1e-6 && Math.abs(w0.eye - 1.65) < 0.08, `FOV 70 and eye height 1.65 m (fov ${w0.fov}, eye ${w0.eye.toFixed(2)})`);
    h.expect(w0.builderHud === "none", "the builder HUD (cash card, stars) is hidden in the walk");
    h.expect(w0.dist < 16 && w0.face > w0.dist * 0.85, `the walk starts in front of the last upgraded attraction and looks at it (${w0.dist.toFixed(1)} m away)`);
    await h.shot("01-walk-start");

    h.step("exit with the Zeréck button: the builder camera is restored exactly");
    await tapSel(".wk-exit");
    await sleep(2200);
    const back = await evalG(page, g => { const c = g.r.camera; return { pos: c.position.toArray(), quat: c.quaternion.toArray(), fov: c.fov, near: c.near, free: g.r.state.free, active: g.walk.active, body: document.body.classList.contains("walking") }; });
    const dp = Math.hypot(...back.pos.map((v, i) => v - builderCam.pos[i])), dq = Math.hypot(...back.quat.map((v, i) => v - builderCam.quat[i]));
    h.expect(!back.active && back.free === null && !back.body, "not walking any more, the free camera flag is cleared");
    h.expect(dp < 1e-3 && dq < 1e-4, `the builder camera is exactly where it was (position ${dp.toExponential(1)} m, orientation ${dq.toExponential(1)})`);
    h.expect(Math.abs(back.fov - builderCam.fov) < 1e-9 && Math.abs(back.near - builderCam.near) < 1e-9, "builder FOV and near plane are back");
    await evalG(page, g => { window.__fouerHooks.startWalk(); });
    await sleep(900);
    await page.keyboard.press("Escape");
    await sleep(2000);
    const back2 = await evalG(page, g => { const c = g.r.camera; return { pos: c.position.toArray(), active: g.walk.active }; });
    h.expect(!back2.active && Math.hypot(...back2.pos.map((v, i) => v - builderCam.pos[i])) < 1e-3, "Esc leaves the walk too, camera exact again");

    /* ------------------------------------------------------------ 2. the full fair, controls */
    h.step("fill the fair (34 attractions, gold level 3), walk into the alley");
    await evalG(page, g => g.fillFair(3, 5));
    await sleep(1500);
    await evalG(page, g => { window.__fouerHooks.startWalk(); });
    await sleep(1200);
    await place(92, 55.5, 0.4);
    await sleep(600);

    h.step("keys: W / S forward and back, A is LEFT, D is RIGHT (real movement projected on the camera's right vector)");
    const mW = await keyMove("KeyW"), mS = await keyMove("KeyS"), mA = await keyMove("KeyA"), mD = await keyMove("KeyD");
    h.expect(mW.fwd > 0.9 && Math.abs(mW.right) < 0.35, `W moves forward (${mW.fwd.toFixed(2)} m forward, ${mW.right.toFixed(2)} sideways)`);
    h.expect(mS.fwd < -0.9 && Math.abs(mS.right) < 0.35, `S moves back (${mS.fwd.toFixed(2)} m)`);
    h.expect(mA.right < -0.9 && Math.abs(mA.fwd) < 0.35, `A moves LEFT (${mA.right.toFixed(2)} m to the right = negative)`);
    h.expect(mD.right > 0.9 && Math.abs(mD.fwd) < 0.35, `D moves RIGHT (${mD.right.toFixed(2)} m)`);
    const mUp = await keyMove("ArrowUp"), mDown = await keyMove("ArrowDown");
    h.expect(mUp.fwd > 0.9 && mDown.fwd < -0.9, "arrow up / down walk forward / back");
    const yaw0 = (await walkState()).view.yaw;
    await page.keyboard.down("ArrowRight"); await sleep(500); await page.keyboard.up("ArrowRight");
    const yaw1 = (await walkState()).view.yaw;
    await page.keyboard.down("ArrowLeft"); await sleep(500); await page.keyboard.up("ArrowLeft");
    const yaw2 = (await walkState()).view.yaw;
    h.expect(yaw1 > yaw0 + 0.5 && yaw2 < yaw1 - 0.5, "arrow right turns right (yaw up), arrow left turns left");
    const walk1 = await keyMove("KeyW", 1000);
    await page.keyboard.down("Shift"); const run1 = await keyMove("KeyW", 1000); await page.keyboard.up("Shift");
    h.expect(run1.fwd > walk1.fwd * 1.5, `Shift runs (${run1.fwd.toFixed(2)} m against ${walk1.fwd.toFixed(2)} m in 1 s)`);

    h.step("joystick (left thumb): up / down / right / left");
    await place(92, 55.5, 0.4);
    await sleep(500);
    const sUp = await stickMove(0, -50), sDown = await stickMove(0, 50), sRight = await stickMove(50, 0), sLeft = await stickMove(-50, 0);
    h.expect(sUp.fwd > 0.8 && Math.abs(sUp.right) < 0.35, `stick up = forward (${sUp.fwd.toFixed(2)} m)`);
    h.expect(sDown.fwd < -0.8, `stick down = back (${sDown.fwd.toFixed(2)} m)`);
    h.expect(sRight.right > 0.8 && Math.abs(sRight.fwd) < 0.35, `stick RIGHT moves right (${sRight.right.toFixed(2)} m)`);
    h.expect(sLeft.right < -0.8 && Math.abs(sLeft.fwd) < 0.35, `stick LEFT moves left (${sLeft.right.toFixed(2)} m)`);
    const half = await stickMove(0, -22, 900), full = await stickMove(0, -56, 900);
    h.expect(full.fwd > half.fwd * 1.3, `the stick scales the speed (half push ${half.fwd.toFixed(2)} m, full ${full.fwd.toFixed(2)} m)`);

    h.step("look: dragging on the canvas turns the view (touch and mouse), the pitch is limited");
    await place(92, 55.5, 0);
    const look0 = (await walkState()).view;
    await ptr("#fouerCanvas", "pointerdown", 500, 600, 31); await ptr("#fouerCanvas", "pointermove", 620, 560, 31); await ptr("#fouerCanvas", "pointerup", 620, 560, 31);
    const look1 = (await walkState()).view;
    h.expect(look1.yaw > look0.yaw + 0.3 && look1.pitch > look0.pitch + 0.1, `a swipe right / up looks right / up (yaw ${look0.yaw.toFixed(2)} -> ${look1.yaw.toFixed(2)}, pitch ${look1.pitch.toFixed(2)})`);
    await ptr("#fouerCanvas", "pointerdown", 400, 900, 32, "mouse"); await ptr("#fouerCanvas", "pointermove", 400, 100, 32, "mouse"); await ptr("#fouerCanvas", "pointerup", 400, 100, 32, "mouse");
    h.expect((await walkState()).view.pitch <= 75 * Math.PI / 180 + 1e-6, "the pitch stops at 75 degrees");
    await place(92, 55.5, 0);

    /* ------------------------------------------------------------ 3. collision */
    h.step("collision: walking at a built stall, at an NPC stall, through the open NE portal");
    const rect0 = await evalG(page, g => g.scene.rects[0]);       // P01, face +w: front edge at w 45
    await place(62, 53, -Math.PI / 2);
    await page.keyboard.down("KeyW"); await sleep(5200); await page.keyboard.up("KeyW");
    const stall = (await walkState()).view;
    h.expect(stall.z > rect0.w + rect0.dw / 2 + 0.2 && stall.z < 50, `a built stall blocks the walker (stopped at w ${stall.z.toFixed(2)}, front edge ${rect0.w + rect0.dw / 2})`);
    const npcBox = await evalG(page, g => { const b = g.mask.npc.filter(q => q.w1 > 46 && q.w1 <= 50.01 && q.u1 - q.u0 >= 6 && q.u0 > 120 && q.u1 < 240).sort((a, c) => a.u0 - c.u0)[0] ?? null; return b ? { ...b } : null; });
    if (h.expect(npcBox !== null, "an NPC stall on the north side of the main alley exists in the mask")) {
      await place((npcBox.u0 + npcBox.u1) / 2, 53, -Math.PI / 2);
      await page.keyboard.down("KeyW"); await sleep(4200); await page.keyboard.up("KeyW");
      const npc = (await walkState()).view;
      h.expect(npc.z > npcBox.w1 + 0.2, `an NPC stall blocks the walker (w ${npc.z.toFixed(2)} stays above its front ${npcBox.w1.toFixed(2)})`);
    }
    await place(274, 56.3, 0);
    await page.keyboard.down("KeyW"); await sleep(10500); await page.keyboard.up("KeyW");
    const portal = (await walkState()).view;
    h.expect(portal.x > 291, `the NE portal is passable (u ${portal.x.toFixed(1)}, the field ends at about 285-290)`);
    await evalG(page, g => g.mask.setGates(1));
    await place(274, 56.3, 0);
    await page.keyboard.down("KeyW"); await sleep(10500); await page.keyboard.up("KeyW");
    const closed = (await walkState()).view;
    h.expect(closed.x < portal.x - 3, `with the entrance still closed (not enough stars) the walker stops inside (u ${closed.x.toFixed(1)})`);
    await evalG(page, g => g.mask.setGates(5));

    /* ------------------------------------------------------------ 4. eating */
    h.step("eating at the Gromperekichelcher stall: the round button, 2 s animation, thought bubble, Foodie");
    await place(62, 70, 0); await sleep(500);
    h.expect((await page.locator(".wk-act").isHidden()), "the interact button is hidden when nothing useful is near");
    { const at = await frontOf(0, 2.2); await place(at.x, at.z, at.yaw); } await sleep(900);
    const act = await evalG(page, g => ({ targets: g.walk.targets.map(t => t.kind), kind: document.querySelector(".wk-act").dataset.kind, shown: !document.querySelector(".wk-act").hidden }));
    h.expect(act.shown && act.kind === "eat" && act.targets[0] === "eat", "near the stall the round button appears (eat)");
    const income0 = await evalG(page, g => g.game.info().incomePerMin);
    await tapSel(".wk-act");
    await sleep(900);
    const eat1 = await evalG(page, g => ({ eatShown: !document.querySelector(".wk-eat").hidden, think: document.querySelector(".wk-think").textContent, thinkShown: !document.querySelector(".wk-think").hidden, foodie: g.game.foodie(), chip: document.querySelector(".wk-foodie").textContent, lang: g.ui.lang, income: g.game.info().incomePerMin }));
    h.expect(eat1.eatShown && eat1.thinkShown, "the eating animation and the thought bubble show");
    h.expect(/Gromperekichelcher/.test(eat1.think) && /lecker/.test(eat1.think), `the thought bubble is in the chosen language (${eat1.lang}): ${eat1.think}`);
    h.expect(eat1.foodie.stacks === 1 && Math.abs(eat1.foodie.mult - 1.05) < 1e-9, "Foodie x1.05 is active");
    h.expect(Math.abs(eat1.income / income0 - 1.05) < 1e-6, `the income per minute is 5 % higher (${income0.toFixed(0)} -> ${eat1.income.toFixed(0)})`);
    h.expect(/1\.05/.test(eat1.chip) && /2:5\d|3:00/.test(eat1.chip), `the Foodie chip shows the multiplier and the timer (${eat1.chip.replace(/\s+/g, " ")})`);
    await h.shot("02-eating");
    await sleep(1600);
    h.expect(await page.locator(".wk-eat").isHidden(), "the animation ends after about 2 s");
    // other foods stack, the same food is known, the fourth is refused
    const foods = await evalG(page, g => ["fritten", "wurscht", "zocker"].map(item => ({ item, i: g.game.state.pitches.findIndex(e => e && e.k === item) })));
    for (const f of foods) {
      const at = await frontOf(f.i, 2.2);
      await place(at.x, at.z, at.yaw); await sleep(700);
      const near = await evalG(page, g => g.walk.targets.map(t => t.kind + ":" + t.item));
      if (!near.some(t => t.startsWith("eat"))) { h.expect(false, `${f.item}: no eat target near its stall (${near.join()})`); continue; }
      await evalG(page, g => g.walk.interact());
      await sleep(2300);
    }
    const stacked = await evalG(page, g => ({ f: g.game.foodie(), income: g.game.info().incomePerMin }));
    h.expect(stacked.f.stacks === 3 && Math.abs(stacked.f.mult - 1.05 ** 3) < 1e-9, `three different foods stack to x${stacked.f.mult.toFixed(4)} (max 3)`);
    h.expect(Math.abs(stacked.income / income0 - 1.05 ** 3) < 1e-6, "the income follows the stacked multiplier");
    const again = await evalG(page, g => { const a = g.game.eat("kachel"); const b = g.game.eat("mandel"); return { a: a.known, b: b.full, stacks: g.game.foodie().stacks }; });
    h.expect(again.a && again.b && again.stacks === 3, "the same food again is known, a fourth food is refused while three are active");

    /* ------------------------------------------------------------ 5. queues and badges */
    h.step("queues: real rows of guests at overloaded attractions in the walk, the red clocks only in the builder view");
    const queues = await evalG(page, g => { const q = g.crowd.queueCounts(); return { q, ids: Object.keys(q).map(Number) }; });
    const queued = queues.ids.filter(i => queues.q[i].want > 0);
    h.expect(queued.length >= 1, `overloaded attractions have queue rows (${queued.length})`);
    if (queued.length) {
      await sleep(5000);
      const geo = await evalG(page, (g, ids) => ids.map(i => { const r = g.scene.rects[i]; const guests = g.crowd.agents.filter(a => a.active && a.state === "queue" && a.queuePitch === i); return { i, want: g.crowd.queueCounts()[i].want, n: guests.length, near: guests.every(a => Math.hypot(a.x - r.u, a.z - r.w) < Math.max(r.du, r.dw) / 2 + 12) }; }), queued);
      h.expect(geo.some(q => q.n >= 3 && q.near), `queue rows have guests standing in front of the attraction (${geo.map(q => `${q.n}/${q.want}`).join(" ")})`);
      const spot = await evalG(page, (g, i) => { const r = g.scene.rects[i]; const a = g.crowd.agents.find(x => x.active && x.state === "queue" && x.queuePitch === i); return a ? { x: a.x, z: a.z, rx: r.u, rz: r.w } : null; }, queued[0]);
      if (spot) {
        const yaw = Math.atan2(spot.rz - spot.z, spot.rx - spot.x);
        await place(spot.x - Math.cos(yaw) * 5.5 + Math.sin(yaw) * 0, spot.z - Math.sin(yaw) * 5.5, yaw);
        await sleep(1500);
        await h.shot("03-queue");
      }
    }
    const badgesWalk = await page.evaluate(() => [...document.querySelectorAll(".qbadge")].filter(b => b.style.display !== "none" && b.getBoundingClientRect().width > 0).length);
    h.expect(badgesWalk === 0, "no red queue clocks in the walk");

    /* ------------------------------------------------------------ 6. the Riserad */
    h.step("Riserad: board, up past 40 m, upright, two revolutions, back on the platform, the stamp");
    const wheel = await evalG(page, g => ({ i: g.ride.wheelPitch, board: g.ride.boardInfo(g.ride.wheelPitch) }));
    await place(wheel.board.u + 4, wheel.board.w, Math.PI);
    await sleep(900);
    const wAct = await evalG(page, g => ({ kinds: g.walk.targets.map(t => t.kind), shown: !document.querySelector(".wk-act").hidden, kind: document.querySelector(".wk-act").dataset.kind }));
    h.expect(wAct.shown && wAct.kind === "wheel", `the ride button shows on the boarding platform (${wAct.kinds.join()})`);
    const speed0 = await evalG(page, g => g.world && g.fair.pits.get("P24").near.userData.ride.speed);
    const platform = (await walkState()).view;
    await evalG(page, g => g.ride.setTestSpeedup(1));
    await tapSel(".wk-act");
    let maxY = 0, minUp = 1, samples = 0, maxRoll = 0, started = false, peakPhase = 0;
    for (let k = 0; k < 40; k++) {
      await sleep(2500);
      const s = await evalG(page, g => { const c = g.r.camera; const T = g.r.THREE; const right = new T.Vector3(1, 0, 0).applyQuaternion(c.quaternion); const up = new T.Vector3(0, 1, 0).applyQuaternion(c.quaternion); return { ride: g.ride.info(), y: c.position.y, roll: Math.abs(right.y), up: up.y, fade: getComputedStyle(document.querySelector(".wk-fade")).opacity }; });
      if (s.ride.active && s.ride.phase === "riding") { started = true; samples++; maxY = Math.max(maxY, s.y); minUp = Math.min(minUp, s.up); maxRoll = Math.max(maxRoll, s.roll); if (samples === 4) { await h.shot("04-wheel-top"); } }
      if (started && !s.ride.active) break;
    }
    peakPhase = maxY;
    h.expect(started && samples > 8, `the ride runs (${samples} samples while riding)`);
    h.expect(peakPhase > 40, `the camera climbs to the top of the wheel (${peakPhase.toFixed(1)} m)`);
    h.expect(minUp > 0.97 && maxRoll < 0.03, `the view stays upright (min up ${minUp.toFixed(3)}, max roll ${maxRoll.toFixed(3)})`);
    await sleep(1400);
    const after = await evalG(page, g => ({ ride: g.ride.info(), view: { ...g.walk.view }, ea: g.game.state.ea, speed: g.fair.pits.get("P24").near.userData.ride.speed, stamp: !document.querySelector(".wk-stamp").hidden, fade: getComputedStyle(document.querySelector(".wk-fade")).opacity }));
    h.expect(!after.ride.active && after.ride.progress > 0.95, "the ride ends by itself after two revolutions");
    h.expect(Math.hypot(after.view.x - platform.x, after.view.z - platform.z) < 0.05, "back on the platform where the ride began");
    h.expect(after.ea.includes("r") && after.stamp, "the stamp Op der Spëtzt is stored (flag r in the save) and shown");
    h.expect(Math.abs(after.speed - speed0) < 1e-6, `the wheel runs at its normal speed again (${after.speed})`);

    h.step("coaster point of view (Wëll Maus): the camera follows the track, Esc aborts");
    const maus = await evalG(page, g => ({ i: g.game.state.pitches.findIndex(e => e && e.k === "maus") }));
    if (h.expect(maus.i >= 0, "a Wëll Maus is on the fair")) {
      const spot = await frontOf(maus.i, 2.4);
      await place(spot.x, spot.z, spot.yaw); await sleep(1200);
      const cAct = await evalG(page, g => g.walk.targets.map(t => t.kind));
      if (h.expect(cAct.includes("coaster"), `the coaster ride button shows at the front (${cAct.join()})`)) {
        await evalG(page, g => g.walk.interact());
        await sleep(9000);                       // the train may still stand in the station for a few seconds
        const p1 = await evalG(page, g => { const c = g.r.camera.position; return { x: c.x, y: c.y, z: c.z, info: g.ride.info() }; });
        await sleep(5000);
        const p2 = await evalG(page, g => { const c = g.r.camera.position; return { x: c.x, y: c.y, z: c.z, info: g.ride.info() }; });
        h.expect(p1.info.kind === "coaster" && p1.info.active, "the coaster ride is running");
        h.expect(Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z) > 8, `the camera moves along the track (${Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z).toFixed(1)} m in 5 s)`);
        await h.shot("05-coaster");
        await page.keyboard.press("Escape");
        await sleep(1800);
        const done = await evalG(page, g => ({ active: g.ride.active, walking: g.walk.active, view: { ...g.walk.view } }));
        h.expect(!done.active && done.walking && Math.hypot(done.view.x - spot.x, done.view.z - spot.z) < 0.1, "Esc ends the ride, the walker is still where they boarded (not out of the walk)");
      }
    }

    h.step("the pioneers' free Probefahrt: a temporary wheel on the locked pitch, restored afterwards");
    await evalG(page, g => {
      const s = g.game.state; const wi = g.ride.wheelPitch;
      g.game.debugSetState({ ...s, pi: 1, ea: "", pitches: s.pitches.map((e, i) => i === wi ? null : e) });
      g.fair.setPitch("P24", { state: "locked" });
    });
    await sleep(900);
    const probe = await evalG(page, g => ({ spot: g.ride.probeSpot(), prev: g.fair.getPitch("P24") }));
    if (h.expect(probe.spot !== null, "a pioneer without a wheel is offered the Probefahrt")) {
      await place(probe.spot.x, probe.spot.z, Math.PI); await sleep(900);
      const pAct = await evalG(page, g => ({ kinds: g.walk.targets.map(t => t.kind), kind: document.querySelector(".wk-act").dataset.kind }));
      h.expect(pAct.kinds.includes("probe"), `the Probefahrt button shows (${pAct.kinds.join()})`);
      await evalG(page, g => g.ride.setTestSpeedup(4));
      await evalG(page, g => g.walk.interact());
      await sleep(3000);
      const during = await evalG(page, g => ({ ride: g.ride.info(), pitch: g.fair.getPitch("P24") }));
      h.expect(during.ride.active && during.pitch.state === "built" && during.pitch.item === "wheel", "the temporary wheel stands on the pitch while riding");
      for (let k = 0; k < 40; k++) { await sleep(1500); if (!(await evalG(page, g => g.ride.active))) break; }
      await sleep(1500);
      const post = await evalG(page, g => ({ pitch: g.fair.getPitch("P24"), ea: g.game.state.ea, active: g.ride.active }));
      h.expect(!post.active && post.pitch.state === "locked", "afterwards the pitch is as before (locked)");
      h.expect(post.ea.includes("p"), `the Probefahrt is marked as used (ea "${post.ea}") and cannot be taken twice`);
      h.expect((await evalG(page, g => g.ride.probeSpot())) === null, "no second Probefahrt");
    }
    await evalG(page, g => g.ride.setTestSpeedup(1));

    /* ------------------------------------------------------------ 7. tram, sheep, audio, photo */
    h.step("the tram is a moving obstacle on the Allée Scheffer");
    const tramFlow = await evalG(page, async g => {
      const tr = g.world.parts.tram;
      // a visible tram inside the street ribbon (s 8405..8910): the schedule may have moved it, so run it until it is
      tr.debug.skipTo("theater");
      for (let n = 0; n < 8000; n++) {
        const q = tr.debug.state();
        if (q.visible && q.pos > 8425 && q.pos < 8890) break;
        if (q.mode === "idle") tr.debug.callTram(1);
        tr.debug.fastForward(0.5);
      }
      const st = tr.debug.state(); const c = tr.track.at(st.pos); const gm = g.world.toGame(c.x, c.z);
      g.walk.teleport(gm[0], gm[1], 0); g.walk.setLook(0, 0);
      await new Promise(r => setTimeout(r, 900));
      const a2 = g.world.toGame(c.x + c.tx, c.z + c.tz); const ax = a2[0] - gm[0], az = a2[1] - gm[1]; const l = Math.hypot(ax, az);
      const v = g.walk.view; const lateral = Math.abs((v.x - gm[0]) * (-az / l) + (v.z - gm[1]) * (ax / l));
      return { mode: st.mode, visible: st.visible, pos: Math.round(st.pos), lateral, region: g.mask.inRegion(gm[0], gm[1]), walking: g.walk.active };
    });
    console.log("    tram:", JSON.stringify(tramFlow));
    h.expect(tramFlow.lateral > 1.3, `the walker is pushed out of the standing tram (${tramFlow.lateral.toFixed(2)} m from its axis)`);
    await h.shot("06-theater-stop");

    h.step("Hämmi the sheep: tap = bleat (walk and builder), the pet button");
    const sheepInfo = await evalG(page, g => g.crowd.sheepPosition());
    h.expect(sheepInfo !== null, "Hämmi wanders the main alley");
    await place(sheepInfo.x - 2.0, sheepInfo.z, 0);
    await sleep(700);
    const petKinds = await evalG(page, g => g.walk.targets.map(t => t.kind));
    h.expect(petKinds.includes("pet"), `the pet button is offered near Hämmi (${petKinds.join()})`);
    const before = await evalG(page, g => g.audio.stats().oneShots);
    const scr = await evalG(page, g => { const T = g.r.THREE; const s = g.crowd.sheep; const v = new T.Vector3(s.position.x, s.position.y + 0.7, s.position.z).project(g.r.camera); const b = g.r.renderer.domElement.getBoundingClientRect(); return { x: b.left + (v.x + 1) / 2 * b.width, y: b.top + (1 - v.y) / 2 * b.height }; });
    await place(sheepInfo.x - 2.0, sheepInfo.z, 0);
    const scr2 = await evalG(page, g => { const T = g.r.THREE; g.walk.update(0); const s = g.crowd.sheep; const v = new T.Vector3(s.position.x, s.position.y + 0.7, s.position.z).project(g.r.camera); const b = g.r.renderer.domElement.getBoundingClientRect(); return { x: b.left + (v.x + 1) / 2 * b.width, y: b.top + (1 - v.y) / 2 * b.height }; });
    void scr;
    await tapAt(h, scr2.x, scr2.y);
    await sleep(500);
    const afterTap = await evalG(page, g => ({ shots: g.audio.stats().oneShots, toast: [...document.querySelectorAll(".toast")].map(t => t.textContent).join("|"), think: document.querySelector(".wk-think").textContent }));
    h.expect(afterTap.shots > before, "tapping Hämmi in the walk bleats");

    h.step("audio: the graph builds after a tap, ambient layers + at most 6 attraction voices, no errors; the arcade mute silences it");
    await place(110, 44.5, -Math.PI / 2);
    await tapAt(h, 410, 500);
    await sleep(3200);
    const au = await evalG(page, g => g.audio.stats());
    h.expect(au.state === "running", `the audio context runs after the first tap (state ${au.state})`);
    h.expect(["murmur", "hum", "rain", "tram"].every(k => au.ambient.includes(k)), `the ambient layers exist (${au.ambient.join()})`);
    h.expect(au.voices.length >= 1 && au.voices.length <= 6 && au.mode === "walk", `${au.voices.length} attraction voices (max 6): ${au.voices.map(v => v.kind).join()}`);
    h.expect(au.errors === 0, "the sound engine reported no errors");
    await page.evaluate(() => { localStorage.setItem("pb_muted", "1"); window.dispatchEvent(new CustomEvent("arcade:mute", { detail: { muted: true } })); });
    await sleep(600);
    h.expect((await evalG(page, g => g.audio.stats().muted)), "the arcade's mute silences the soundscape");
    await page.evaluate(() => { localStorage.setItem("pb_muted", "0"); window.dispatchEvent(new CustomEvent("arcade:mute", { detail: { muted: false } })); });
    await sleep(500);
    h.expect(!(await evalG(page, g => g.audio.stats().muted)), "and un-muting brings it back");

    h.step("photo button: a PNG is saved");
    await place(110, 55.5, 0.1);
    await sleep(500);
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }).catch(() => null), tapSel(".wk-photo")]);
    await sleep(900);
    const photo = await evalG(page, g => g.walk.lastPhoto);
    h.expect(photo !== null && photo.bytes > 20000, `a photo was made (${photo ? photo.bytes : 0} bytes)`);
    h.expect(download !== null && /^schueberfouer-.*\.png$/.test(download.suggestedFilename()), `the download is a local PNG (${download ? download.suggestedFilename() : "none"})`);

    /* ------------------------------------------------------------ 8. performance (iPad medium) */
    h.step("performance on the iPad-medium profile: six walk positions + the builder view");
    const spots = [["start of the alley", 40, 56, 0], ["mid alley", 150, 56, 0.05], ["Fressgaass", 150, 28, 0.1], ["the Riserad", 64, 86, Math.PI], ["Allée Scheffer", 150, -11.5, 0], ["NE portal", 270, 56, 0]];
    const results = {};
    for (const [name, x, z, yaw] of spots) {
      await place(x, z, yaw);
      const p = await perf();
      results[name] = p;
      h.expect(p.draws <= WALK_DRAWS && p.tris <= WALK_TRIS, `walk @ ${name}: ${p.draws} draw calls, ${(p.tris / 1000).toFixed(0)}k triangles, ${p.fps} fps (limit ${WALK_DRAWS} / ${WALK_TRIS / 1000}k)`);
    }
    await tapSel(".wk-exit");
    await sleep(2200);
    await evalG(page, g => { g.r.flyTo(g.r.poses.overview, 0); });
    const bOverview = await perf();
    await evalG(page, g => { g.r.flyTo(g.r.poses.close, 0); });
    const bClose = await perf();
    h.expect(bOverview.draws <= BUILDER_DRAWS && bOverview.tris <= BUILDER_TRIS, `builder overview with the crowd: ${bOverview.draws} draws, ${(bOverview.tris / 1000).toFixed(0)}k triangles`);
    h.expect(bClose.draws <= BUILDER_DRAWS && bClose.tris <= BUILDER_TRIS, `builder close with the crowd: ${bClose.draws} draws, ${(bClose.tris / 1000).toFixed(0)}k triangles`);
    const badgesBuilder = await page.evaluate(() => [...document.querySelectorAll(".qbadge")].filter(b => b.style.display !== "none" && b.getBoundingClientRect().width > 0).length);
    const builderCrowd = await evalG(page, g => ({ target: g.crowd.target(), active: g.crowd.stats.active, cap: g.crowd.cap() }));
    h.expect(badgesBuilder >= 1, `the red queue clocks are back in the builder view (${badgesBuilder})`);
    h.expect(builderCrowd.active > 10, `the builder view shows a thinner crowd (${builderCrowd.active} guests, target ${builderCrowd.target})`);
    console.log("    perf:", JSON.stringify({ walk: results, builder: { overview: bOverview, close: bClose } }));

    /* ------------------------------------------------------------ 9. quality: the crowd count follows it */
    const counts = {};
    for (const q of ["low", "high"]) {
      h.step(`quality ${q}: reload, enter the walk, count the crowd`);
      await h.goto(URL_BASE + q);
      await bootGame(h);
      await evalG(page, g => g.fillFair(3, 5));
      await sleep(1200);
      await evalG(page, g => { window.__fouerHooks.startWalk(); });
      await sleep(7000);
      const c = await evalG(page, g => ({ cap: g.crowd.cap(), target: g.crowd.target(), active: g.crowd.stats.active, near: g.crowd.stats.near, far: g.crowd.stats.far, quality: g.r.state.quality }));
      counts[q] = c;
      const p = await perf();
      results[q] = p;
      console.log(`    ${q}:`, JSON.stringify({ ...c, perf: p }));
      h.expect(c.quality === q && c.cap === ({ low: 70, medium: 150, high: 320 })[q], `${q}: the cap is ${c.cap}`);
      h.expect(c.active <= c.cap && c.active >= c.target * 0.85, `${q}: ${c.active} guests for a target of ${c.target} (cap ${c.cap})`);
      await evalG(page, g => g.walk.end());
    }
    h.expect(counts.low.active < 80 && counts.high.active > 200 && counts.low.active < counts.high.active, `the crowd follows the quality (low ${counts.low.active}, high ${counts.high.active})`);
    h.expect(results.low.draws <= 150, `low quality walk: ${results.low.draws} draw calls (DESIGN 5 low walk limit 150), ${(results.low.tris / 1000).toFixed(0)}k triangles (limit 150k, informative)`);

    h.step("no console errors");
    h.expect(errors.length === 0, `no console errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
  },
};

runIfMain(import.meta.url, flow);
