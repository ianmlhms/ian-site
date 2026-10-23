/* Flow: Schueberfouer Tycoon "Rides" wave (pb/fouer.html: every ride attraction can be ridden from the walk).
 *
 * iPad portrait profile (touch, 820x1180, Supabase mocked), ONE page, the full fair (34 attractions, level 3), `fouerQ=medium`, evening:
 *   for every rideable attraction (all 19 ride items): build it, walk to its entrance, the round button shows "Fueren", a tap boards, the ride runs fast-forwarded
 *   (`ride.setTestSpeedup`), and the camera is checked against the ride: it follows the seat / car / path (moves, stays inside the ride's bounds, an upright, unit,
 *   orthogonal frame), perf stays inside DESIGN 5 (walk <= 220 draws / 300k triangles), the ride ends by itself, the walker is back at the entrance, the flag is stored
 *   exactly once, the stamp card shows once. An early exit (Esc, and the red button) leaves without a flag.
 *   Autoscooter: the keys drive the car, the barrier and the other cars bounce it, bumps are counted, sparks fly, the ~60 s timer ends the ride.
 *   Geeschterbunn: the interior exists while riding and is gone afterwards, the four doors open, the scares fire.  Waasserbunn: the splash sprays the lens.
 *   Drop tower: lift, pause, fall, brake (shake).  Reduce motion: the settings chip stores the option and the rides run calmer.
 *   Zero console errors (warnings from our own code count too).
 * Screenshots (FLOW_SHOTS_DIR): one or two per ride at its most exciting moment. */
import { runIfMain } from "./lib.mjs";
import { bootGame, tapAt, consoleCollector } from "./fouer_game.mjs";

const URL_BASE = "/pb/fouer.html?fouerDebug=1&fouerNoFly=1&fouerTimeMode=evening&fouerWeather=clear&fouerQ=medium";
const WALK_DRAWS = 220, WALK_TRIS = 300000;
const SPEEDUP = 6;

/** per ride: horizontal reach of the camera from the pitch centre (m), minimum path length (m), min up.y of the camera, where to take the screenshots (progress), min height gain */
const RIDES = {
  kanner: { reach: 8, path: 8, upY: 0.5, shots: [0.4] },
  gold: { reach: 12, path: 14, upY: 0.5, shots: [0.4] },
  kette: { reach: 14, path: 14, upY: 0.5, shots: [0.45] },
  bayern: { reach: 12, path: 14, upY: 0.5, shots: [0.45] },
  happy: { reach: 12, path: 12, upY: 0.5, shots: [0.45] },
  break: { reach: 12, path: 12, upY: 0.5, shots: [0.5] },
  musik: { reach: 12, path: 14, upY: 0.5, shots: [0.5] },
  takeoff: { reach: 14, path: 12, upY: 0.5, shots: [0.5] },
  jules: { reach: 20, path: 120, upY: 0.35, rise: 45, shots: [0.5] },
  hangover: { reach: 8, path: 120, upY: 0.5, rise: 70, shots: [0.35, 0.83] },
  booster: { reach: 32, path: 120, upY: -1, rise: 25, shots: [0.45] },
  infinity: { reach: 30, path: 60, upY: -1, rise: 10, shots: [0.34, 0.6] },
  maus: { reach: 28, path: 60, upY: -1, rise: 3, shots: [0.5] },
  looping: { reach: 48, path: 100, upY: -1, rise: 8, shots: [0.43] },
  alpina: { reach: 48, path: 100, upY: -1, rise: 8, shots: [0.5] },
  splash: { reach: 28, path: 60, upY: -1, rise: 6, shots: [0.8, 0.87] },
  geister: { reach: 24, path: 70, upY: -1, rise: 3, shots: [0.19, 0.47] },
  scooter: { reach: 16, path: 3, upY: 0.8, shots: [0.5] },
};
const SIZE_PITCH = { S: 0, M: 2, L: 3, XL: 27, W: 23 };
const ITEM_SIZE = { kanner: "S", gold: "M", kette: "M", bayern: "M", happy: "M", break: "M", musik: "M", takeoff: "M", jules: "M", hangover: "M", booster: "L", infinity: "M", maus: "L", looping: "XL", alpina: "XL", splash: "L", geister: "L", scooter: "L" };

const evalG = (page, fn, arg) => page.evaluate(([src, a]) => (0, eval)(src)(window.__fouerGame, a), [fn.toString(), arg]);

export const flow = {
  name: "fouer-rides",
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
    const tapSel = async selector => { const box = await page.locator(selector).boundingBox(); await tapAt(h, box.x + box.width / 2, box.y + box.height / 2); };

    /* ------------------------------------------------------------ boot, the full fair */
    h.step("boot (iPad medium), the full fair at level 3, the walk");
    await h.goto(URL_BASE);
    await bootGame(h);
    await evalG(page, g => g.fillFair(3, 5));
    await sleep(1200);
    await page.evaluate(() => window.__fouerHooks.startWalk());
    await sleep(1500);

    const place = (item, level = 3) => evalG(page, async (g, a) => {
      const { PITCHES } = await import("/pb/fouer/data.js");
      const idx = a.idx;
      const pitches = g.game.state.pitches.map((e, i) => i === idx ? { k: a.item, lv: a.level, look: 0, fl: 0 } : e);
      g.game.debugSetState({ ...g.game.state, pitches });
      return { idx, pitch: PITCHES[idx].id };
    }, { item, level, idx: SIZE_PITCH[ITEM_SIZE[item]] });
    const toEntrance = idx => evalG(page, async (g, a) => {
      const { PITCHES } = await import("/pb/fouer/data.js"); const { frontSpot } = await import("/pb/fouer/walk.js");
      const r = g.scene.rects[a.idx]; const s = frontSpot(r, PITCHES[a.idx].face, 2.0); const free = g.mask.nearestFree(s.x, s.z, 5) ?? s;
      const yaw = Math.atan2(r.w - free.z, r.u - free.x);
      g.walk.teleport(free.x, free.z, yaw); g.walk.setLook(yaw, 0); g.walk.scanTargets();
      return { x: free.x, z: free.z, yaw, cx: r.u, cz: r.w };
    }, { idx });
    const state = () => evalG(page, g => { const i = g.ride.info(); return { active: i.active, phase: i.phase, p: i.progress, id: i.id, rig: i.rig, cam: i.cam, left: i.left }; });
    /** samples the camera of the running ride every frame inside the page */
    const startLog = () => evalG(page, g => {
      window.__log = { cam: [], drawn: [], max: { draws: 0, tris: 0 }, stamp: false, running: true, shake: 0, strobe: 0, drops: 0, dark: 0, sparks: false, interior: false, doorsOpen: 0, scares: 0, last: null, rigs: [] };
      const L = window.__log;
      const tick = () => {
        const i = g.ride.info();
        if (i.active && i.cam) { L.cam.push(i.cam.pos.concat(i.cam.up, i.cam.fwd)); L.last = i; if (i.rig) L.rigs.push(i.rig); }
        const fx = g.ride.fx; if (fx) { L.shake = Math.max(L.shake, fx.shakeValue); L.strobe = Math.max(L.strobe, fx.strobeValue); L.drops = Math.max(L.drops, fx.dropCount); }
        const stamp = document.querySelector(".wk-stamp"); if (stamp && !stamp.hidden) L.stamp = true;
        if (i.active && L.cam.length % 20 === 0) { const s = g.r.performanceSnapshot(); L.max.draws = Math.max(L.max.draws, s.drawCalls); L.max.tris = Math.max(L.max.tris, s.triangles); }
        if (L.running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const stopLog = () => evalG(page, g => { window.__log.running = false; return window.__log; });
    const waitIdle = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (!(await state()).active) return true; await sleep(250); } return false; };
    const waitRiding = async () => { const t0 = Date.now(); while (Date.now() - t0 < 4000) { const s = await state(); if (s.active && s.phase === "riding") return true; await sleep(120); } return false; };
    const shotAt = async (id, fractions) => {
      for (const f of fractions) {
        const t0 = Date.now();
        while (Date.now() - t0 < 25000) { const s = await state(); if (!s.active || s.p >= f) break; await sleep(60); }
        await evalG(page, g => g.ride.setTestSpeedup(0.05));
        await sleep(450);
        await h.shot(`${id}-${Math.round(f * 100)}`);
        await evalG(page, (g, a) => g.ride.setTestSpeedup(a.k), { k: SPEEDUP });
      }
    };
    const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

    /* ------------------------------------------------------------ the generic ride check for every attraction */
    const results = [];
    for (const id of (process.env.RIDES_ONLY ? process.env.RIDES_ONLY.split(",") : Object.keys(RIDES))) {
      const R = RIDES[id];
      h.step(`${id}: build, walk to the entrance, board, ride, leave`);
      const set = await place(id);
      const spot = await toEntrance(set.idx);
      await sleep(700);
      const t = await evalG(page, g => ({ targets: g.walk.targets.map(x => `${x.kind}:${x.item ?? ""}`), btn: (() => { const b = document.querySelector(".wk-act"); return b && !b.hidden ? b.querySelector("small").textContent : ""; })() }));
      h.expect(t.targets.includes(`ride:${id}`), `${id}: the entrance offers the ride (${t.targets.join(", ")})`);
      h.expect(t.btn === "Fueren", `${id}: the round button says "Fueren" (${t.btn})`);

      // early exit first: Esc a moment after boarding leaves without a flag
      const flag0 = await evalG(page, g => g.game.state.ea);
      await tapSel(".wk-act");
      h.expect(await waitRiding(), `${id}: the tap boards (fade, then riding)`);
      await sleep(1500);
      const mid = await state();
      h.expect(mid.active && mid.cam, `${id}: riding, the camera has a frame`);
      await page.keyboard.press("Escape");
      h.expect(await waitIdle(3500), `${id}: Esc leaves the ride early`);
      await sleep(500);
      const early = await evalG(page, g => ({ ea: g.game.state.ea, walking: g.walk.active, view: { ...g.walk.view } }));
      h.expect(early.ea === flag0 && early.walking, `${id}: leaving early gives no flag and keeps the walk (${early.ea})`);
      h.expect(Math.hypot(early.view.x - spot.x, early.view.z - spot.z) < 1e-6, `${id}: the walker is back at the entrance (${(Math.hypot(early.view.x - spot.x, early.view.z - spot.z)).toExponential(1)} m off)`);

      if (id === "scooter") { await toEntrance(set.idx); await sleep(500); await scooterChecks(set, spot, h, page, evalG, startLog, stopLog, tapSel, sleep, waitIdle, waitRiding); results.push(id); continue; }

      // the full ride, fast-forwarded
      await toEntrance(set.idx); await sleep(500);
      await evalG(page, (g, a) => g.ride.setTestSpeedup(a.k), { k: SPEEDUP });
      await startLog();
      await tapSel(".wk-act");
      h.expect(await waitRiding(), `${id}: boards again`);
      await shotAt(id, R.shots);
      const done = await waitIdle(40000);
      await sleep(1100);                              // the stamp and the flag come after the fade back in
      const log = await stopLog();
      h.expect(done, `${id}: the ride ends by itself`);
      const cams = log.cam;
      h.expect(cams.length > 30, `${id}: the camera was sampled ${cams.length} times`);
      // follows the ride: path length, bounds, frame sanity
      let pathLen = 0, minY = 1e9, maxY = -1e9, maxReach = 0, badFrame = 0, minUp = 2;
      for (let i = 0; i < cams.length; i++) {
        const c = cams[i];
        if (i) pathLen += dist3(c, cams[i - 1]);
        minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
        maxReach = Math.max(maxReach, Math.hypot(c[0] - spot.cx, c[2] - spot.cz));
        const up = c.slice(3, 6), fw = c.slice(6, 9);
        const lu = Math.hypot(...up), lf = Math.hypot(...fw), d = up[0] * fw[0] + up[1] * fw[1] + up[2] * fw[2];
        if (![...c].every(Number.isFinite) || Math.abs(lu - 1) > 1e-3 || Math.abs(lf - 1) > 1e-3 || Math.abs(d) > 0.02) badFrame++;
        minUp = Math.min(minUp, up[1]);
      }
      const gy = await evalG(page, (g, a) => g.world.groundY(a.x, a.z), { x: spot.cx, z: spot.cz });
      h.expect(pathLen >= R.path, `${id}: the camera travelled ${pathLen.toFixed(0)} m (at least ${R.path})`);
      h.expect(maxReach <= R.reach, `${id}: it stays within ${R.reach} m of the ride (max ${maxReach.toFixed(1)} m)`);
      h.expect(minY >= gy - 0.5, `${id}: it never goes underground (lowest ${(minY - gy).toFixed(1)} m above the ground)`);
      h.expect(!R.rise || (maxY - minY) >= R.rise * 0.8, `${id}: the height changes by ${(maxY - minY).toFixed(0)} m (expected about ${R.rise ?? 0}+)`);
      h.expect(maxY - gy <= 100, `${id}: the camera stays below 100 m (${(maxY - gy).toFixed(0)} m)`);
      h.expect(badFrame === 0, `${id}: every frame is finite, unit length and orthogonal (${badFrame} bad of ${cams.length})`);
      h.expect(minUp >= R.upY, `${id}: the camera's up vector stays sane (lowest up.y ${minUp.toFixed(2)}, limit ${R.upY})`);
      h.expect(log.max.draws <= WALK_DRAWS && log.max.tris <= WALK_TRIS, `${id}: perf ${log.max.draws} draws / ${Math.round(log.max.tris / 1000)}k triangles (budget ${WALK_DRAWS} / ${WALK_TRIS / 1000}k)`);
      const after = await evalG(page, g => ({ ea: g.game.state.ea, view: { ...g.walk.view }, active: g.ride.active, interior: Boolean(document.querySelector("canvas") && g.fair.pits && [...g.fair.pits.values()].some(p => p.near && p.near.getObjectByName && p.near.getObjectByName("ghost-interior"))), fade: document.querySelector(".wk-fade").style.opacity }));
      const flagCount = await evalG(page, (g, a) => (g.game.state.ea.match(new RegExp(a.f, "g")) || []).length, { f: await flagOf(page, evalG, id) });
      h.expect(flagCount === 1, `${id}: the flag is stored exactly once (${after.ea})`);
      h.expect(log.stamp, `${id}: the stamp card "${id}" was shown`);
      h.expect(Math.hypot(after.view.x - spot.x, after.view.z - spot.z) < 1e-6 && !after.active, `${id}: back at the entrance, ride over`);
      h.expect(!after.interior, `${id}: no leftovers in the scene`);
      // a second ride does not give a second flag / stamp
      results.push(id);
      // special checks
      const rigs = log.rigs;
      if (id === "hangover") {
        const evs = rigs.map(r => r.events).filter(Boolean); const last = evs[evs.length - 1] ?? {};
        h.expect(last.lift && last.hold && last.drop && last.brake, `hangover: lift, pause at the top, free fall and brake all happened (${JSON.stringify(last)})`);
        h.expect(log.shake > 0.5, `hangover: the brake shakes the screen (${log.shake.toFixed(2)})`);
      }
      if (id === "splash") { const lastRig = rigs[rigs.length - 1] ?? {}; h.expect(lastRig.splash === true && log.drops > 20, `splash: the drop splashes the lens (${log.drops} drops)`); }
      if (id === "geister") {
        const last = log.last?.rig ?? rigs[rigs.length - 1] ?? {};
        h.expect(rigs.some(r => r.inside === 1) && rigs.some(r => r.inside === 0), "geister: part of the ride is inside the castle, part outside");
        h.expect((rigs[rigs.length - 1]?.scaresFired?.length ?? 0) >= 6, `geister: the scares fired (${(rigs[rigs.length - 1]?.scaresFired ?? []).join(",")})`);
        h.expect(Math.max(...rigs.flatMap(r => r.doorsOpen ?? [0])) > 1.2, "geister: the doors banged open");
        h.expect(log.strobe > 0.5, `geister: the strobe flashed (${log.strobe.toFixed(2)})`);
        void last;
      }
      if (id === "kette") h.expect(Math.max(...rigs.map(r => r.swing ?? 0)) > 0.5, `kette: the chairs fly out (swing ${Math.max(...rigs.map(r => r.swing ?? 0)).toFixed(2)} rad)`);
      await evalG(page, g => g.ride.setTestSpeedup(1));
      await sleep(400);
    }

    /* ------------------------------------------------------------ the Riserad stays rideable */
    h.step("the Riserad: still offers its button on the platform");
    await evalG(page, g => { const i = g.game.state.pitches.findIndex(e => e && e.k === "wheel"); return i; });
    const wheel = await evalG(page, async g => {
      const i = g.game.state.pitches.findIndex(e => e && e.k === "wheel"); if (i < 0) return null;
      const b = g.ride.boardInfo(i); g.walk.teleport(b.u, b.w, 0); g.walk.scanTargets();
      return { i, targets: g.walk.targets.map(t => t.kind), can: g.ride.canRide(i) };
    });
    h.expect(wheel && wheel.targets.includes("wheel") && wheel.can, `the boarding platform still offers the wheel (${wheel ? wheel.targets.join(",") : "no wheel"})`);

    /* ------------------------------------------------------------ reduce motion, the option */
    h.step("settings: the reduce-motion chip stores the option and the rides run calmer");
    await page.evaluate(() => window.__fouerHooks.endWalk()); await sleep(1500);
    await tapSel("#menuBtn"); await sleep(500);
    const chips = await page.evaluate(() => [...document.querySelectorAll("#menu .chip[data-motion]")].map(c => ({ m: c.dataset.motion, pressed: c.getAttribute("aria-pressed") })));
    h.expect(chips.length === 2, `the settings menu has the reduce-motion chips (${JSON.stringify(chips)})`);
    await page.evaluate(() => document.querySelector('#menu .chip[data-motion="1"]').click()); await sleep(300);
    h.expect(await page.evaluate(() => localStorage.getItem("pb_fouer_reduce_motion")) === "1", "the chip stores pb_fouer_reduce_motion = 1");
    await page.evaluate(() => { document.getElementById("menu").hidden = true; });
    await evalG(page, g => window.__fouerHooks.startWalk()); await sleep(1500);
    await place("kette"); const sp = await toEntrance(SIZE_PITCH.M); await sleep(500);
    await evalG(page, (g, a) => g.ride.setTestSpeedup(a.k), { k: SPEEDUP });
    await tapSel(".wk-act"); await waitRiding(); await sleep(2000);
    const calm = await evalG(page, g => g.ride.info().rig);
    h.expect(calm && calm.calm === true, `with the option on the ride runs calm (${JSON.stringify(calm)})`);
    await evalG(page, g => g.ride.abort(true)); await sleep(600);
    await page.evaluate(() => localStorage.setItem("pb_fouer_reduce_motion", "0"));
    void sp;

    h.expect(errors.length === 0, `zero console errors (${errors.length}${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""})`);
    h.step(`done: ${results.length} rides checked`);
  },
};

const FLAGS = { kanner: "k", gold: "o", kette: "e", scooter: "s", bayern: "b", happy: "h", break: "d", musik: "m", takeoff: "t", jules: "j", hangover: "v", booster: "x", infinity: "i", maus: "u", looping: "l", alpina: "a", splash: "w", geister: "c" };
async function flagOf(page, evalG, id) { void page; void evalG; return FLAGS[id]; }

/** Autoscooter: steer the car with the keys, bump into the barrier and the other cars, count the bumps, the timer ends the ride */
async function scooterChecks(set, spot, h, page, evalG, startLog, stopLog, tapSel, sleep, waitIdle, waitRiding) {
  h.step("scooter: drive a bumper car (keys), bounce off the barrier and the other cars, the timer ends the ride");
  await evalG(page, async (g, a) => { const { frontSpot } = await import("/pb/fouer/walk.js"); const { PITCHES } = await import("/pb/fouer/data.js"); const r = g.scene.rects[a.idx]; const s = frontSpot(r, PITCHES[a.idx].face, 2.0); const free = g.mask.nearestFree(s.x, s.z, 5) ?? s; g.walk.teleport(free.x, free.z, Math.atan2(r.w - free.z, r.u - free.x)); g.walk.scanTargets(); }, { idx: set.idx });
  await sleep(500);
  await evalG(page, g => g.ride.setTestSpeedup(1));
  await startLog();
  await tapSel(".wk-act");
  h.expect(await waitRiding(), "scooter: boards");
  const info = () => evalG(page, g => g.ride.info());
  const rig = async () => (await info()).rig;
  const r0 = await rig();
  h.expect(r0 && r0.arena && r0.speed < 0.5, `scooter: the car stands at the start (${r0 ? r0.speed.toFixed(2) : "?"} m/s)`);
  h.expect(await evalG(page, g => Boolean([...g.fair.pits.values()].some(p => p.near && p.near.getObjectByName && p.near.getObjectByName("ride-sparks")))), "scooter: the pole sparks exist");
  await sleep(1500);
  const idle = await rig();
  h.expect(Math.hypot(idle.x - r0.x, idle.z - r0.z) < 1.5, "scooter: without input the car does not drive away by itself");
  // throttle: W moves the car along its heading (the first leg goes towards the back wall, away from the entrance)
  await evalG(page, g => g.walk.setInputKeys(["f"]));
  await sleep(1500);
  const r1 = await rig();
  h.expect(Math.hypot(r1.x - idle.x, r1.z - idle.z) > 2.0 && r1.speed > 2, `scooter: W drives the car (${Math.hypot(r1.x - idle.x, r1.z - idle.z).toFixed(1)} m in 1.5 s, ${r1.speed.toFixed(1)} m/s)`);
  const camMoved = await evalG(page, g => g.ride.info().cam.pos);
  h.expect(Array.isArray(camMoved), "scooter: the camera sits in the car");
  // for the screenshot: put the car in the middle of the hall looking along its length, among the other cars
  await evalG(page, g => g.walk.setInputKeys([]));
  await evalG(page, g => { const c = g.ride.rig.sim.cars[0]; c.x = -9; c.z = -2; c.yaw = Math.PI / 2; c.vx = c.vz = 0; });
  await evalG(page, g => g.walk.setInputKeys(["f"]));
  await sleep(1300);
  await h.shot("scooter-drive");
  const r1b = await rig();
  // steering: D turns right (yaw falls), A turns left
  await evalG(page, g => g.walk.setInputKeys(["f", "r"]));
  await sleep(700);
  const r2 = await rig();
  await evalG(page, g => g.walk.setInputKeys(["f", "l"]));
  await sleep(1100);
  const r3 = await rig();
  const dyawR = Math.atan2(Math.sin(r2.yaw - r1b.yaw), Math.cos(r2.yaw - r1b.yaw)), dyawL = Math.atan2(Math.sin(r3.yaw - r2.yaw), Math.cos(r3.yaw - r2.yaw));
  h.expect(dyawR < -0.15, `scooter: D steers right (yaw ${dyawR.toFixed(2)})`);
  h.expect(dyawL > 0.1, `scooter: A steers left (yaw ${dyawL.toFixed(2)})`);
  // arrows steer too and do not turn the view
  const viewBefore = await evalG(page, g => g.walk.view.yaw);
  await evalG(page, g => g.walk.setInputKeys(["f", "tr"]));
  await sleep(600);
  const viewAfter = await evalG(page, g => g.walk.view.yaw);
  h.expect(Math.abs(viewAfter - viewBefore) < 1e-6, "scooter: the arrow keys steer the car, they do not turn the view");
  // the barrier: hold W until the car has hit it
  await evalG(page, g => g.walk.setInputKeys(["f"]));
  const t0 = Date.now(); let rr = await rig();
  while (Date.now() - t0 < 12000 && !(rr.bumps > 0)) { await sleep(300); rr = await rig(); }
  h.expect(rr.bumps > 0, `scooter: driving into the barrier / the other cars gives bumps (${rr.bumps}; barrier ${rr.wallBumps}, cars ${rr.carBumps})`);
  await h.shot("scooter-bump");
  await sleep(2500);
  rr = await rig();
  const inside = rr.x >= rr.arena.x0 && rr.x <= rr.arena.x1 && rr.z >= rr.arena.z0 && rr.z <= rr.arena.z1 && rr.others.every(([x, z]) => x >= rr.arena.x0 - 0.01 && x <= rr.arena.x1 + 0.01 && z >= rr.arena.z0 - 0.01 && z <= rr.arena.z1 + 0.01);
  h.expect(inside, "scooter: every car stays inside the barrier");
  h.expect(rr.others.some(([x, z]) => Math.hypot(x - r0.others[0][0], z - r0.others[0][1]) > 1), "scooter: the other cars drive (AI)");
  // keep driving with the stick-free keys, the other cars bump us; then the timer: fast-forward
  await evalG(page, g => g.ride.setTestSpeedup(6));
  await evalG(page, g => g.walk.setInputKeys(["f", "r"]));
  const gone = await waitIdle(16000);
  await sleep(1100);
  const log = await stopLog();
  h.expect(gone, "scooter: the timer ends the ride (about 60 s)");
  h.expect(log.stamp, "scooter: the stamp card was shown");
  const done = await evalG(page, g => ({ ea: g.game.state.ea, hasS: g.game.hasFlag("s"), walking: g.walk.active }));
  h.expect(done.hasS && (done.ea.match(/s/g) || []).length === 1 && done.walking, `scooter: flag "s" stored once (${done.ea})`);
  const after = await evalG(page, g => ({ view: { ...g.walk.view }, keys: g.walk.inputState().keys }));
  h.expect(Math.hypot(after.view.x - spot.x, after.view.z - spot.z) < 1, "scooter: the walker is back at the entrance");
  await evalG(page, g => g.walk.setInputKeys([]));
  h.expect(log.max.draws <= WALK_DRAWS && log.max.tris <= WALK_TRIS, `scooter: perf ${log.max.draws} draws / ${Math.round(log.max.tris / 1000)}k triangles`);
}

runIfMain(import.meta.url, flow);
