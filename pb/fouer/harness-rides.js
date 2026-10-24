// Rides-wave checks (pure ride logic: catalog, programs, bumper cars, ghost path, flags, Spaass buff, comfort helper), called from harness.js with its helpers.
//   node pb/fouer/harness.js            (all)        node pb/fouer/harness-rides.js   (only these)
import { ITEMS } from "./data.js";
import { RIDE_DEFS, RIDE_FLAGS, RIDEABLE, speedAt, createProgram, rideTimeAtClock, swingAngle, rotorTilt, piecewise } from "./rides/catalog.js";
import { createBumper, driveCar, arenaOf, BUMPER, makeRandom } from "./rides/bumper.js";
import { ghostControls, ghostPath, GHOST_DOORS, GHOST_SCARES, levelFrame } from "./rides/ghost.js";
import { levelAssist } from "./rides/rigs.js";
import { HALL } from "./rides/scooter-hall.js";
import { RIDE_CARS } from "./rides/drive.js";
import { FUN, FLAGS_MAX, createGame } from "./game.js";
import * as save from "./save.js";
import * as sim from "./sim.js";
import * as i18n from "./i18n.js";

/** a tiny Vector3 stand-in for the comfort helper (the real one is THREE's) */
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  lengthSq() { return this.dot(this); }
  normalize() { const l = Math.sqrt(this.lengthSq()) || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
  addScaledVector(v, k) { this.x += v.x * k; this.y += v.y * k; this.z += v.z * k; return this; }
}

export async function verifyRides({ check, equal, near }) {
  /* ------------------------------------------------ catalog: every ride attraction has a ride */
  const rideItems = ITEMS.filter(e => e.cat === "ride").map(e => e.id);
  check(rideItems.every(id => RIDE_DEFS[id]), `every ride attraction is rideable (${rideItems.length}): ${rideItems.filter(id => !RIDE_DEFS[id]).join(",") || "none missing"}`);
  check(RIDEABLE.every(id => rideItems.includes(id)), "the catalog only lists real ride attractions");
  const flags = Object.values(RIDE_FLAGS);
  check(new Set(flags).size === flags.length && flags.every(f => /^[a-z0-9]$/.test(f)), "ride flags are unique single [a-z0-9] letters");
  check(!["g", "p"].some(f => flags.includes(f)) && RIDE_FLAGS.wheel === "r", "the ride flags keep g (starter gift), p (Probefahrt) free and the Riserad is r");
  check(RIDEABLE.every(id => RIDE_FLAGS[id]), "every rideable has a flag");
  const kinds = new Set(Object.values(RIDE_DEFS).map(d => d.kind));
  check(["wheel", "seat", "track", "flume", "ghost", "drive"].every(k => kinds.has(k)), "all six ride kinds exist");
  check(RIDEABLE.every(id => i18n.t("lb", `item.${id}`) !== `item.${id}`), "every rideable has a name for the stamp card");
  for (const lang of i18n.LANGS) for (const key of ["ride.stampRide", "ride.stampRideBody", "ride.hint", "ride.holdHint", "drive.hint", "drive.score", "fun.gain", "fun.title", "set.motion", "act.leave"]) check(i18n.t(lang, key, { name: "X", n: 1 }) !== key, `${lang}: ${key} exists`);

  /* ------------------------------------------------ speed profile and programs */
  const seatDefs = Object.entries(RIDE_DEFS).filter(([, d]) => d.clock === "speed");
  for (const [id, d] of seatDefs) {
    check(Math.abs(speedAt(d, 0) - d.lo) < 1e-9 && Math.abs(speedAt(d, 1) - d.lo) < 1e-9, `${id}: spins up from rest and spins down to rest`);
    check(Math.abs(speedAt(d, (d.up + d.down) / 2) - d.hi) < 1e-9, `${id}: cruises at ${d.hi}x`);
    let mono = true, prev = -1; for (let p = 0; p <= d.up; p += 0.01) { const s = speedAt(d, p); if (s < prev - 1e-9) mono = false; prev = s; }
    check(mono, `${id}: the spin-up never slows down`);
    check(speedAt(d, 0.5, true) < speedAt(d, 0.5, false) && speedAt(d, 0.5, true) > 1, `${id}: reduce motion spins slower but not slower than the real ride`);
    check(d.dur >= 40 && d.dur <= 60, `${id}: the ride takes ${d.dur} s (40-60 s)`);
    const prog = createProgram(d); let steps = 0, lastCt = prog.ct, monotone = true;
    while (!prog.done && steps < 20000) { prog.step(1 / 60); if (prog.ct < lastCt) monotone = false; lastCt = prog.ct; steps++; }
    check(prog.done && Math.abs(steps / 60 - d.dur) < 0.05 && monotone, `${id}: the program ends at ${d.dur} s with a clock that only runs forward`);
    check(prog.ct > d.dur * d.lo && prog.ct < d.dur * d.hi, `${id}: the model clock advanced ${prog.ct.toFixed(1)} s in ${d.dur} s`);
  }
  for (const [id, d] of Object.entries(RIDE_DEFS).filter(([, e]) => e.clock === "map")) {
    const prog = createProgram(d); let lastCt = prog.ct, steps = 0, mono = true, jump = 0;
    while (!prog.done && steps < 20000) { prog.step(1 / 60); if (prog.ct < lastCt - 1e-9) mono = false; jump = Math.max(jump, prog.ct - lastCt); lastCt = prog.ct; steps++; }
    check(mono && jump < 0.3 && prog.ct < d.cycle - 1, `${id}: the ride maps onto the model's cycle (${d.cycle} s) monotonically, ends at model time ${prog.ct.toFixed(1)} s`);
    check(d.dur >= 25 && d.dur <= 60, `${id}: ${d.dur} s`);
    const back = rideTimeAtClock(d, d.map(d.dur / 2)); near(back, d.dur / 2, 1e-4, `${id}: rideTimeAtClock inverts the map`);
  }
  for (const id of ["jules", "hangover", "booster", "infinity"]) {
    const d = RIDE_DEFS[id]; const calm = createProgram(d, { reduce: true }); let steps = 0; while (!calm.done && steps < 30000) { calm.step(1 / 60); steps++; }
    near(steps / 60, d.dur / 0.8, 0.05, `${id}: reduce motion runs the cycle at 80 % (the ride lasts ${(steps / 60).toFixed(0)} s)`);
    near(calm.mt, d.dur, 0.05, `${id}: ... and still ends at the end of the model's ride`);
  }
  // the drop tower: slow lift (more than 11 s for the 11 s lift), a pause at the top, the free fall at the model's own speed
  const H = RIDE_DEFS.hangover;
  check(rideTimeAtClock(H, 17) - rideTimeAtClock(H, 6) > 13, "drop tower: the lift is slower than the model's own cycle");
  check(rideTimeAtClock(H, 19.5) - rideTimeAtClock(H, 17) > 3.5, "drop tower: a pause of about 4 s at the top before the free fall");
  near((rideTimeAtClock(H, 22.5) - rideTimeAtClock(H, 19.5)), 3, 0.15, "drop tower: the free fall and the brake run at the model's own speed");
  equal(piecewise([[0, 0], [1, 10]], 0.5), 5, "piecewise interpolates");
  check(swingAngle(0) === 0 && swingAngle(1.55) > swingAngle(1) && swingAngle(1) > swingAngle(0.5) && swingAngle(9) <= 0.8 + 1e-12, "chair swing angle grows with the speed and is capped (45 degrees)");
  check(rotorTilt(0.1) === 0 && rotorTilt(2) > 0.08 && rotorTilt(2) < 0.13, "the canopy tilts a little at speed");

  /* ------------------------------------------------ comfort helper */
  const fr = { forward: new V3(0.6, 0.6, 0.4).normalize(), up: new V3(0.3, 0.7, 0.2).normalize() };
  const pitchBefore = fr.forward.y; levelAssist(fr, 0.6, 0.5);
  check(Math.abs(fr.forward.lengthSq() - 1) < 1e-9 && Math.abs(fr.up.lengthSq() - 1) < 1e-9 && Math.abs(fr.forward.dot(fr.up)) < 1e-9, "levelAssist keeps the frame orthonormal");
  check(fr.forward.y < pitchBefore && fr.up.y > 0.7, "levelAssist flattens the pitch and the roll");

  /* ------------------------------------------------ bumper cars */
  const floor = { x0: -13, x1: 13, z0: -7.6, z1: 3.9 };
  const arena = arenaOf(floor);
  const car = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, speed: 0, slip: 0 };
  for (let i = 0; i < 60; i++) driveCar(car, 1, 0, 1 / 60);
  check(car.vz > 3 && Math.abs(car.vx) < 1e-9 && car.speed <= BUMPER.vMax + 1e-9, `throttle drives along the heading (yaw 0 = +z): ${car.vz.toFixed(2)} m/s`);
  const turner = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, speed: 0, slip: 0 };
  for (let i = 0; i < 30; i++) driveCar(turner, 1, 1, 1 / 60);
  check(turner.yaw < -0.2, "a right turn lowers the yaw (the camera's right is -x at yaw 0)");
  const still = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, speed: 0, slip: 0 }; for (let i = 0; i < 30; i++) driveCar(still, 0, 1, 1 / 60);
  check(still.yaw === 0, "a standing car does not turn");
  for (let i = 0; i < 90; i++) driveCar(car, 0, 0, 1 / 60);
  check(car.speed < 3.0, "the car rolls out when you let go");
  const slider = { x: 0, z: 0, yaw: 0, vx: 4, vz: 0, speed: 4, slip: 0 }; for (let i = 0; i < 30; i++) driveCar(slider, 0, 0, 1 / 60);
  check(slider.vx < 1.2, "sideways speed is gripped away by the tyres");

  let b = createBumper({ floor, count: 8, seed: 3 });
  equal([b.cars.length, b.cars[0].ai], [8, null], "8 cars, car 0 is the player's");
  check(b.cars.slice(1).every(c => c.ai), "the others are driven by the AI");
  for (let i = 0; i < b.cars.length; i++) for (let j = i + 1; j < b.cars.length; j++) check(Math.hypot(b.cars[i].x - b.cars[j].x, b.cars[i].z - b.cars[j].z) > 1.4, `start: cars ${i} and ${j} do not overlap`);
  const p0 = { x: b.cars[0].x, z: b.cars[0].z };
  for (let i = 0; i < 120; i++) b.step(1 / 60, { throttle: 1, steer: 0 });
  check(Math.hypot(b.cars[0].x - p0.x, b.cars[0].z - p0.z) > 1.5, "the player's car moves with the throttle");
  const moved = b.cars.slice(1).filter(c => c.speed > 0.5).length;
  check(moved >= 5, `the AI cars drive (${moved} of 7 rolling after 2 s)`);
  // 70 s of random driving: nothing leaves the arena, nothing overlaps for long, bumps are counted, everything stays finite
  const rnd = makeRandom(9); b = createBumper({ floor, count: 12, seed: 5 }); let inside = true, finite = true, maxOverlap = 0, reported = 0;
  for (let i = 0; i < 70 * 60; i++) {
    const ev = b.step(1 / 60, { throttle: rnd() < 0.8 ? 1 : -1, steer: Math.sin(i / 50) });
    reported += ev.length;
    for (const c of b.cars) { if (c.x < arena.x0 || c.x > arena.x1 || c.z < arena.z0 || c.z > arena.z1) inside = false; if (!Number.isFinite(c.x + c.z + c.vx + c.vz + c.yaw)) finite = false; }
    for (let k = 1; k < b.cars.length; k++) maxOverlap = Math.max(maxOverlap, 2 * BUMPER.radius - Math.hypot(b.cars[0].x - b.cars[k].x, b.cars[0].z - b.cars[k].z));
  }
  check(inside && finite, "70 s of driving: every car stays inside the barrier and the numbers stay finite");
  check(maxOverlap < 0.5, `cars are pushed apart (deepest overlap ${maxOverlap.toFixed(2)} m)`);
  check(b.stats.carBumps > 10 && b.stats.wallBumps > 3 && reported === b.stats.bumps, `bumps are reported (${b.stats.carBumps} car, ${b.stats.wallBumps} barrier)`);
  check(b.stats.playerBumps > 0 && b.stats.playerBumps <= b.stats.bumps, "bumps involving the player are counted separately");
  // a head-on hit: two cars drive at each other and bounce
  b = createBumper({ floor, count: 2, seed: 1 });
  Object.assign(b.cars[0], { x: -2, z: -2, yaw: Math.PI / 2, vx: 4, vz: 0 }); Object.assign(b.cars[1], { x: 2, z: -2, yaw: -Math.PI / 2, vx: -4, vz: 0 }); b.cars[1].ai = { until: 1e9, steer: 0, target: 0, bias: 0, hunt: false };
  let hit = null; for (let i = 0; i < 120 && !hit; i++) { const ev = b.step(1 / 60, { throttle: 0, steer: 0 }); hit = ev.find(e => e.type === "car") ?? null; }
  check(hit && hit.impulse > 3, `a head-on hit is reported with its strength (${hit ? hit.impulse.toFixed(1) : "none"})`);
  const rel = b.cars[0].vx - b.cars[1].vx; check(rel < 0, "the cars bounce apart after the hit");
  // the barrier
  b = createBumper({ floor, count: 1, seed: 1 });
  Object.assign(b.cars[0], { x: 0, z: -2, yaw: Math.PI, vx: 0, vz: -5 });
  let wall = null; for (let i = 0; i < 240 && !wall; i++) { const ev = b.step(1 / 60, { throttle: 1, steer: 0 }); wall = ev.find(e => e.type === "wall") ?? null; }
  check(wall && wall.impulse > 3 && b.cars[0].vz > 0, `the barrier bounces the car back (impact ${wall ? wall.impulse.toFixed(1) : "none"} m/s)`);
  // the timer lives in the rig (def.dur); a reported bump cools down so pressing into the barrier does not count every frame
  b = createBumper({ floor, count: 1, seed: 1 }); Object.assign(b.cars[0], { x: 0, z: arena.z0 + 1.2, yaw: Math.PI });
  for (let i = 0; i < 120; i++) b.step(1 / 60, { throttle: 1, steer: 0 });
  check(b.stats.wallBumps <= 6, `pressing into the barrier for 2 s counts ${b.stats.wallBumps} bumps, not one per frame`);
  check(RIDE_DEFS.scooter.dur >= 55 && RIDE_DEFS.scooter.dur <= 65, "the bumper-car ride lasts about a minute");
  // determinism
  const a1 = createBumper({ floor, count: 8, seed: 4 }), a2 = createBumper({ floor, count: 8, seed: 4 });
  for (let i = 0; i < 600; i++) { a1.step(1 / 60, { throttle: 1, steer: 0.3 }); a2.step(1 / 60, { throttle: 1, steer: 0.3 }); }
  equal(a1.cars.map(c => [c.x, c.z]), a2.cars.map(c => [c.x, c.z]), "same seed and input: the same ride");
  // bigger inside: the ride has its own 40 x 22 m hall with 8 cars; they start spread out, roam the whole floor, hunt the player in pairs at most and do not get stuck
  const HF = HALL.floor, harena = arenaOf(HF);
  check(HF.x1 - HF.x0 >= 38 && HF.z1 - HF.z0 >= 20 && RIDE_CARS >= 7 && RIDE_CARS <= 9, `the interior floor is ${HF.x1 - HF.x0} x ${HF.z1 - HF.z0} m with ${RIDE_CARS} cars`);
  check(HALL.bars.every(z => z > HF.z0 && z < HF.z1) && HALL.wallX > HF.x1 && HALL.wallZ0 < HF.z0, "the five light bars hang over the floor, the walls stand outside it");
  for (const seed of [11, 14, 20]) {
    const big = createBumper({ floor: HF, count: RIDE_CARS, seed });
    let gap = 1e9; for (let i = 0; i < big.cars.length; i++) for (let j = i + 1; j < big.cars.length; j++) gap = Math.min(gap, Math.hypot(big.cars[i].x - big.cars[j].x, big.cars[i].z - big.cars[j].z));
    check(gap >= 3.5, `seed ${seed}: the cars start at least 3.5 m apart (${gap.toFixed(1)} m)`);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, maxHunters = 0, stuck = 0, outside = 0;
    for (let i = 0; i < 60 * 60; i++) {
      big.step(1 / 60, { throttle: 0.6, steer: Math.sin(i / 120) });
      let hunters = 0;
      for (let j = 1; j < big.cars.length; j++) { const c = big.cars[j]; minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z); if (c.ai.hunting && c.ai.prey === 0) hunters++; if (c.x < harena.x0 || c.x > harena.x1 || c.z < harena.z0 || c.z > harena.z1) outside++; }
      maxHunters = Math.max(maxHunters, hunters);
    }
    for (let j = 1; j < big.cars.length; j++) if (big.cars[j].speed < 0.3) stuck++;
    check(maxX - minX > 28 && maxZ - minZ > 14, `seed ${seed}: the AI cars roam the whole floor (${(maxX - minX).toFixed(0)} x ${(maxZ - minZ).toFixed(0)} m)`);
    check(maxHunters <= 2, `seed ${seed}: at most two cars chase the player at once (${maxHunters})`);
    check(outside === 0 && stuck <= 1, `seed ${seed}: nobody leaves the barrier (${outside}) and ${stuck} cars stand still after a minute`);
  }

  /* ------------------------------------------------ ghost train path */
  const ctrl = ghostControls(); const gp = ghostPath(ctrl);
  equal(gp.crossings.map(c => c.dir), ["in", "out", "in", "out"], "the track crosses the facade four times: arch in, upper door out, upper door in, gate out");
  check(GHOST_DOORS.length === gp.crossings.length && GHOST_DOORS.every((d, i) => Math.abs(d.x - gp.crossings[i].x) < 0.8), "the four doors sit where the track crosses the facade");
  check(gp.length > 80 && gp.length < 130, `the dark ride is ${gp.length.toFixed(0)} m long`);
  check(gp.insideLength / gp.length > 0.55, `most of it is inside the castle (${Math.round(gp.insideLength / gp.length * 100)} %)`);
  const order = gp.scares.map(s => s.s); check(order.every((s, i) => i === 0 || s > order[i - 1]) && gp.scares.length === GHOST_SCARES.length, "the scares come one after the other along the track");
  check(gp.scares.length >= 7 && ["skeleton", "bat", "face", "strobe"].every(id => gp.scares.some(s => s.id === id)), "pop-up skeleton, bat, lit face and strobe are all there");
  const I = { x0: -13.3, x1: 13.3, z0: -7.6, z1: 2.2 };
  let ok = true; for (let s = gp.sStart; s < gp.sEnd; s += 0.5) { const f = gp.sp.at(s); if (f.p[2] < 2.0 && (f.p[0] < I.x0 + 0.5 || f.p[0] > I.x1 - 0.5 || f.p[2] < I.z0 + 0.5)) ok = false; }
  check(ok, "the inside part of the track stays inside the room");
  let level = true; for (let s = gp.sStart; s < gp.sEnd; s += 0.5) { const f = levelFrame(gp.sp.at(s)); if (Math.abs(f.r[1]) > 1e-6 || f.u[1] < 0.5 || Math.abs(f.u[0] * f.t[0] + f.u[1] * f.t[1] + f.u[2] * f.t[2]) > 1e-6) level = false; }
  check(level, "the cart frames are level (no roll) and upright");

  /* ------------------------------------------------ flags in the save and the Spaass buff */
  let st = { ...sim.createState({ now: 1.8e12 }), ea: "grp" + flags.filter(f => !"grp".includes(f)).join("") };
  check(st.ea.length <= FLAGS_MAX && FLAGS_MAX >= 24, `all ${flags.length} ride flags + g + p fit in the save (${st.ea.length} of ${FLAGS_MAX} characters)`);
  const rec = JSON.parse(JSON.stringify(save.encodeSave(st)));
  const back = save.decodeSave(rec);
  check(back && back.ea === st.ea, "the flags survive the save codec (encode, JSON, decode)");
  check(save.decodeSave({ ...rec, ea: "<<<" }).ea === "" && save.decodeSave({ ...rec, ea: "a".repeat(33) }).ea === "", "an invalid or too long flag string is dropped");
  let clock = 1_800_000_000_000;
  const fakeWin = { parent: null, addEventListener() {}, setTimeout: () => 0 }; fakeWin.parent = fakeWin;
  const game = createGame({ win: fakeWin, storage: null, now: () => clock, persist: false });
  await game.start();
  game.debugSetState({ ...game.state, c: 1e6, tu: 8, pitches: game.state.pitches.map((e, i) => i === 0 ? sim.makeEntry("kachel", 1, 0, 0) : i === 1 ? sim.makeEntry("kanner", 1, 0, 0) : e) });
  const income0 = game.info().incomePerMin;
  const f1 = game.fun("kanner");
  check(f1.ok && f1.granted && f1.percent === 3, "a finished ride gives the Spaass buff (+3 %)");
  near(game.info().incomePerMin / income0, FUN.perRide, 1e-9, "income is 3 % higher right away");
  check(!game.fun("kette").granted, "riding again while it runs only refreshes the buff: no stacking");
  near(game.info().incomePerMin / income0, FUN.perRide, 1e-9, "still 3 %");
  const ate = game.eat("kachel"); check(ate.granted, "the Foodie buff works next to it");
  near(game.info().incomePerMin / income0, FUN.perRide * 1.05, 1e-9, "Foodie and Spaass multiply");
  clock += 121_000; game.update();
  near(game.info().incomePerMin / income0, 1.05, 1e-9, "after 2 minutes the Spaass buff is gone, Foodie stays");
  check(game.foodie().fun === false, "foodie() reports the buff state");
  const all = flags; let stored = 0; for (const f of all) if (game.setFlag(f)) stored++;
  check(stored === all.length && all.every(f => game.hasFlag(f)), `all ${all.length} ride flags can be stored in one save (the old limit was 8)`);
  check(!game.setFlag("g") || game.hasFlag("g"), "g still works");
  let extra = 0; for (const f of "0123456789yzfnq") if (game.setFlag(f)) extra++;
  check(game.state.ea.length <= FLAGS_MAX, `the flag string never exceeds ${FLAGS_MAX} characters (${game.state.ea.length})`);
  void extra;
}

// standalone: node pb/fouer/harness-rides.js
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  let checks = 0;
  const assert = (await import("node:assert/strict")).default;
  const check = (c, m) => { assert.ok(c, m); checks++; };
  const equal = (a, e, m) => { assert.deepStrictEqual(a, e, m); checks++; };
  const near = (a, e, t, m) => { assert.ok(Math.abs(a - e) <= t, `${m}: ${a} vs ${e} (+-${t})`); checks++; };
  try { await verifyRides({ check, equal, near }); console.log(`PASS: ${checks} ride checks`); } catch (error) { console.error(`FAIL: ${error.stack ?? error}`); process.exitCode = 1; }
}
