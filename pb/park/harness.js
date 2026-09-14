import assert from "node:assert/strict";
import { RULES, TILE, PHASE, RIDES, STALLS, FACILITIES, SCENERY, MILESTONES,
  OBJECT_FIELDS, OBJECT_WIDTHS, GUEST_FIELDS, GUEST_WIDTHS } from "./data.js";
import { GRID, GATE, KINDS, canPlace, place, remove, placePath, removePath, buyLand,
  refreshNetwork, footprint, neighbors, pack, unpack, readObjects, readGuests } from "./build.js";
import { createState, tick, setTicketPrice, setRidePrice, setStaff, setMaintenance, maintainRide } from "./sim.js";

const DAY = RULES.secondsPerHour * RULES.hoursPerDay;
const ALL_MILESTONES = (1 << MILESTONES.length) - 1;
const MAX_PROGRESSION_DAYS = 40;
const LONG_RUN_DAYS = 80;
const SAVE_LIMIT = 7000;
let checks = 0;

function check(condition, message) {
  assert.ok(condition, message);
  checks++;
}

function accept(result) {
  assert.notEqual(result.ok, false, JSON.stringify(result));
  return result;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function finite(value, path = "state") {
  if (typeof value === "number") assert.ok(Number.isFinite(value), `${path} is not finite`);
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) finite(child, `${path}.${key}`);
  }
}

function road(state, x, startY, endY) {
  let next = state;
  for (let y = startY; y <= endY; y++) next = accept(placePath(next, x, y));
  return next;
}

function starter(seed = 7, staffed = true) {
  let state = road(createState(seed), RULES.gateX, 1, 18);
  for (const [kind, x, y, rotation] of [
    ["carousel", 18, 2, 2], ["teacups", 21, 2, 0], ["popcorn", 19, 5, 0],
    ["lemonade", 21, 5, 0], ["toilet", 19, 6, 0], ["flowers", 21, 6, 0],
    ["tree", 21, 7, 0], ["bin", 19, 7, 0],
  ]) state = accept(place(state, kind, x, y, rotation));
  if (staffed) {
    for (const role of ["mechanics", "janitors", "entertainers"]) state = accept(setStaff(state, role, 1));
  }
  return accept(tick(state, 0));
}

function verifyGuestJourney() {
  let state = starter();
  let sawGate = false;
  let sawQueue = false;
  let sawUse = false;
  let sawWalk = false;
  for (let second = 0; second < DAY * 2; second++) {
    state = accept(tick(state, 1));
    sawGate ||= state.derived.guests.some(guest => guest.age === 1 && neighbors(GATE).includes(guest.p));
    sawWalk ||= state.derived.guests.some(guest => guest.phase === PHASE.WALK && guest.p !== GATE);
    sawQueue ||= state.derived.guests.some(guest => guest.phase === PHASE.QUEUE);
    sawUse ||= state.derived.guests.some(guest => guest.phase === PHASE.USE);
    for (const guest of state.derived.guests) {
      if (guest.phase === PHASE.USE) assert.equal(guest.p, state.derived.network.entrances[guest.target - 1].tile);
      else assert.equal(state.saved.g[guest.p], TILE.PATH);
    }
    for (const object of state.derived.objects.filter(Boolean)) {
      const users = state.derived.guests.filter(guest => guest.target === object.id + 1 && guest.phase === PHASE.USE);
      assert.ok(users.length <= (KINDS[object.k].capacity ?? 1));
    }
  }
  check(sawGate && sawWalk && sawQueue && sawUse, "guest traverses gate, paths, queue, and use phases");
  check(state.derived.stats.rides > 0 && state.derived.stats.rideIncome > 0, "connected rides have paying guests");
  check(state.derived.stats.incomeByObject[0] > 0 && state.derived.stats.incomeByObject[1] > 0,
    "both rotated and unrotated entrances work");
  check(state.derived.stats.happy > 0, "satisfied guests eventually leave happy");
  return state;
}

function verifyDisconnected() {
  let state = accept(place(createState(11), "carousel", 25, 10));
  state = accept(tick(state, DAY * 20));
  assert.equal(state.derived.stats.incomeByObject[0], 0);
  assert.equal(state.derived.stats.visitsByObject[0], 0);
  assert.equal(state.derived.stats.queueEntries, 0);
  check(!state.derived.network.entrances[0].reachable, "isolated ride is unreachable and earns exactly zero");
  let stall = accept(place(createState(11), "popcorn", 25, 10));
  stall = tick(stall, DAY * 20);
  check(stall.derived.stats.incomeByObject[0] === 0 && stall.derived.stats.visitsByObject[0] === 0,
    "an unreachable stall also earns exactly zero and is never visited");
  let island = road(createState(12), 25, 8, 12);
  island = accept(place(island, "carousel", 26, 9));
  island = tick(island, DAY * 5);
  check(!island.derived.network.entrances[0].reachable && island.derived.stats.rides === 0,
    "a disconnected path island does not grant reachability");
  let connected = starter();
  connected = tick(connected, DAY);
  const revenue = connected.derived.stats.rideIncome;
  const visits = connected.derived.stats.rides;
  const revision = connected.derived.networkRevision;
  connected = accept(removePath(connected, RULES.gateX, 1));
  connected = tick(connected, DAY * 3);
  assert.equal(connected.derived.stats.rideIncome, revenue);
  assert.equal(connected.derived.stats.rides, visits);
  check(connected.derived.networkRevision === revision + 1, "cutting a bridge rebuilds connectivity exactly once");
  check(connected.derived.stats.angry > 0, "stranded guests evacuate and leave angry");
  connected = accept(placePath(connected, RULES.gateX, 1));
  connected = tick(connected, DAY);
  check(connected.derived.stats.rideIncome > revenue, "reconnecting a bridge restores income");
}

function verifyDegradation() {
  let neglected = accept(setMaintenance(starter(29, false), false));
  neglected = tick(neglected, 60);
  const earlyRating = neglected.derived.rating;
  neglected = tick(neglected, DAY * 8);
  check(neglected.derived.objects.some(object => object?.b > 0), "unmaintained rides break down");
  check(neglected.derived.rating < earlyRating - 20, "neglect lowers rating substantially");
  check(neglected.saved.j > 0, "guests create litter without janitors");
  let repaired = accept(setStaff(neglected, "mechanics", 2));
  repaired = accept(setStaff(repaired, "janitors", 2));
  repaired = tick(repaired, RULES.repairWork);
  check(repaired.derived.objects.filter(object => object && KINDS[object.k].type === "ride")
    .some(object => !object.b), "mechanics repair rides");
  check(repaired.saved.j < neglected.saved.j, "janitors remove litter");
  let idle = createState(41);
  idle = accept(setStaff(idle, "mechanics", 3));
  idle = accept(setStaff(idle, "janitors", 3));
  idle = accept(setStaff(idle, "entertainers", 3));
  idle = tick(idle, DAY * 20);
  check(idle.derived.bankrupt && idle.saved.c < 0 && idle.derived.profitPerDay < 0,
    "an idle park still owes wages and goes bankrupt");
}

function verifyPricing() {
  const initial = starter(19);
  const reasonable = tick(initial, DAY * 3);
  const expensive = tick(accept(setTicketPrice(initial, RULES.maxPrice)), DAY * 3);
  const free = tick(accept(setTicketPrice(initial, 0)), DAY * 3);
  check(expensive.saved.a < reasonable.saved.a / 10, "extreme ticket prices collapse arrivals");
  check(free.saved.a > reasonable.saved.a && free.derived.guestCount >= RULES.maxGuests * 0.85,
    "free admission fills the park");
  check(free.derived.profitPerDay < 0 && reasonable.derived.profitPerDay > 0,
    "free admission loses operating money while sensible pricing profits");
}

function scriptedRun(seed) {
  let state = starter(seed);
  let expanded = false;
  let upgraded = false;
  for (let quarter = 0; quarter < MAX_PROGRESSION_DAYS * 4; quarter++) {
    state = tick(state, DAY / 4);
    if (!expanded && (state.saved.u & 2) && state.saved.c > 6000) {
      state = accept(buyLand(state, 3, 0));
      state = accept(place(state, "wheel", 21, 10));
      state = accept(setStaff(state, "mechanics", 2));
      expanded = true;
    }
    if (!upgraded && (state.saved.u & 8) && state.saved.c > 10000) {
      state = accept(place(state, "castle", 22, 6));
      upgraded = true;
    }
    check(!state.derived.bankrupt, "scripted park remains solvent");
    finite(state);
    if (state.saved.z === ALL_MILESTONES) return state;
  }
  assert.fail(`milestones ${state.saved.z}/${ALL_MILESTONES}; value ${state.derived.parkValue}; cash ${state.saved.c}`);
}

function verifyImmutability() {
  const state = freeze(starter());
  const before = JSON.stringify(state);
  const commands = [
    () => tick(state, 15), () => tick(state, 0), () => tick(state, Number.NaN),
    () => canPlace(state, "slide", 21, 12), () => place(state, "slide", 21, 12),
    () => place(state, "carousel", 20, 0), () => remove(state, 0),
    () => remove(state, -1), () => placePath(state, 19, 18), () => removePath(state, 20, 1),
    () => buyLand(state, 3, 0), () => setTicketPrice(state, 22), () => setRidePrice(state, "carousel", 7),
    () => setStaff(state, "mechanics", 2), () => setMaintenance(state, false), () => maintainRide(state, 0),
  ];
  for (const run of commands) {
    const result = run();
    assert.notEqual(result, state);
    assert.equal(JSON.stringify(state), before);
  }
  check(true, "all command functions preserve deeply frozen input");
  const occupied = freeze(tick(starter(), 30));
  const removed = accept(remove(occupied, 0));
  check(!readGuests(removed.saved).some(guest => guest.target === 1), "demolishing objects clears stale targets");
  const replacement = tick(accept(place(removed, "slide", 18, 2, 2)), 0);
  check(replacement.derived.objects[0].k === KINDS.findIndex(kind => kind.id === "slide"), "vacant object slots can be reused safely");
}

function verifyRulesAndCaching() {
  const state = createState();
  assert.equal(canPlace(state, "carousel", 0, 0).reason, "unowned");
  assert.equal(canPlace(state, "carousel", -1, 0).reason, "out-of-bounds");
  assert.equal(canPlace(state, "carousel", 15, 0, 4).reason, "invalid-rotation");
  assert.equal(canPlace(state, "launch-coaster", 15, 0).reason, "locked");
  assert.equal(canPlace(state, "unknown", 15, 0).reason, "unknown-kind");
  assert.equal(removePath(state, 20, 0).reason, "gate");
  assert.equal(buyLand(state, 0, 3).reason, "isolated");
  assert.equal(setStaff(state, "mechanics", -1).reason, "invalid-count");
  assert.equal(setTicketPrice(state, Infinity).reason, "invalid-price");
  assert.equal(place({ ...state, saved: { ...state.saved, c: 0 } }, "carousel", 15, 0).reason, "unaffordable");
  const active = starter();
  const later = tick(active, DAY);
  assert.equal(later.derived.network, active.derived.network);
  assert.equal(later.derived.networkRevision, active.derived.networkRevision);
  const restored = tick({ saved: JSON.parse(JSON.stringify(later.saved)), derived: { dirty: true } }, DAY);
  assert.equal(JSON.stringify(restored.saved), JSON.stringify(tick(later, DAY).saved));
  check(true, "typed refusals, cached BFS, and save/resume work");
  for (const [fields, widths, records] of [
    [OBJECT_FIELDS, OBJECT_WIDTHS, later.derived.objects.filter(Boolean)],
    [GUEST_FIELDS, GUEST_WIDTHS, later.derived.guests],
  ]) for (const record of records) {
    const encoded = pack(record, fields, widths);
    assert.equal(encoded.length, widths.reduce((sum, width) => sum + width, 0));
    assert.deepEqual(unpack(encoded, fields, widths), Object.fromEntries(fields.map(field => [field, record[field]])));
  }
}

function verifyLargeSave() {
  let state = createState(73);
  state = { ...state, saved: { ...state.saved, c: 100000, u: 15 } };
  for (const y of [0, 1, 2, 3]) for (const x of [1, 2, 0, 3]) {
    if (!(state.saved.l & (1 << (y * 4 + x)))) state = accept(buyLand(state, x, y));
  }
  for (let y = 0; y < GRID.height; y++) for (let x = 0; x < GRID.width; x++) {
    if ((y % 6 === 0 || x % 7 === 0) && state.saved.g[y * GRID.width + x] === TILE.EMPTY) {
      state = accept(placePath(state, x, y));
    }
  }
  const catalog = [...KINDS].sort((a, b) => b.footprint[0] * b.footprint[1] - a.footprint[0] * a.footprint[1]);
  for (let count = 0; count < RULES.maxObjects; count++) {
    const kind = catalog[count] ?? SCENERY[(count - catalog.length) % SCENERY.length];
    let placed = false;
    for (let y = 0; y < GRID.height && !placed; y++) for (let x = 0; x < GRID.width && !placed; x++) {
      if (!canPlace(state, kind.id, x, y).ok) continue;
      const entrance = footprint(kind, x, y, 0).entrance;
      if (!neighbors(entrance).some(p => state.saved.g[p] === TILE.PATH)) continue;
      state = accept(place(state, kind.id, x, y));
      placed = true;
    }
    check(placed, `large park has room for ${kind.id}`);
  }
  state = accept(setTicketPrice(state, 0));
  for (const [role, count] of [["mechanics", 20], ["janitors", 3], ["entertainers", 3]]) {
    state = accept(setStaff(state, role, count));
  }
  for (let second = 0; second < DAY * 5 && state.derived.guestCount < RULES.maxGuests; second++) state = tick(state, 1);
  check(state.derived.guestCount === RULES.maxGuests, "large end-game save contains maximum live guests");
  check(readObjects(state.saved).filter(Boolean).length === RULES.maxObjects, "large save contains maximum objects");
  check(KINDS.every(kind => state.derived.objects.some(object => KINDS[object.k].id === kind.id)),
    "large save includes every ride, stall, facility, and scenery kind");
  check(Object.values(state.derived.network.entrances).every(entrance => entrance.reachable), "end-game park is fully connected");
  const bytes = Buffer.byteLength(JSON.stringify(state.saved));
  check(bytes < SAVE_LIMIT, `large saved park uses ${bytes} bytes, below ${SAVE_LIMIT}`);
  finite(state);
  return bytes;
}

function run() {
  verifyGuestJourney();
  verifyDisconnected();
  verifyDegradation();
  verifyPricing();
  verifyImmutability();
  verifyRulesAndCaching();
  const winner = scriptedRun(101);
  check(winner.saved.z === ALL_MILESTONES && winner.saved.u === 15, "all milestones and unlock tiers are achievable");
  assert.equal(JSON.stringify(winner), JSON.stringify(scriptedRun(101)));
  const initial = starter(31);
  let split = initial;
  for (let i = 0; i < 100; i++) split = tick(split, 0.1);
  assert.equal(JSON.stringify(split), JSON.stringify(tick(initial, 10)));
  check(true, "identical seeds and equivalent fixed time steps replay byte-identically");
  let long = winner;
  for (let day = 0; day < LONG_RUN_DAYS; day++) { long = tick(long, DAY); finite(long); }
  check(true, "no non-finite state values over a long run");
  const bytes = verifyLargeSave();
  console.log(`PASS: ${checks} checks; all ${MILESTONES.length} milestones in ${winner.derived.day.toFixed(2)} days; end-game save ${bytes}/${SAVE_LIMIT} bytes.`);
}

try { run(); } catch (error) {
  console.error(`FAIL: ${error.stack ?? error}`);
  process.exitCode = 1;
}
