import { RULES, TILE, PHASE, NEEDS, STAFF, RIDES, UNLOCKS, MILESTONES } from "./data.js";
import { GRID, GATE, KINDS, neighbors, refreshNetwork, readObjects, packObject,
  readGuests, packGuests, refuse } from "./build.js";

const DAY_SECONDS = RULES.secondsPerHour * RULES.hoursPerDay;
const PRNG_RANGE = 4294967296;
const PRNG_MULTIPLIER = 1664525;
const PRNG_INCREMENT = 1013904223;
const MONEY_PRECISION = 100;
const clamp = (value, max = RULES.maxNeed) => Math.max(0, Math.min(max, value));
const roundMoney = value => Math.round(value * MONEY_PRECISION) / MONEY_PRECISION;
const freshStats = () => ({ arrivals: 0, queueEntries: 0, rides: 0, rideIncome: 0, stallIncome: 0,
  angry: 0, happy: 0, visitsByObject: Array(RULES.maxObjects).fill(0), incomeByObject: Array(RULES.maxObjects).fill(0) });

/* Keys in `saved` are single letters because the whole object has to serialise
 * into the 8 KB game_saves column: g grid, o objects, v guests, l owned land,
 * c cash, p ticket price, rp ride prices, s staff, m maintenance, r rng seed,
 * t clock, q queue stat, f footfall, a arrivals, h happiness, j litter,
 * u unlock mask, z milestone mask, d income per hour.
 * Everything derived (rating, park value, path distances) is recomputed into
 * `derived` and never written. */
export function createState(seed = 1) {
  const g = Array(GRID.width * GRID.height).fill(TILE.EMPTY);
  g[GATE] = TILE.PATH;
  const saved = { version: RULES.version, g, o: [], v: "", l: RULES.initialLand,
    c: RULES.initialCash, p: RULES.initialTicket, rp: RIDES.map(ride => ride.price),
    s: [0, 0, 0], m: true, r: Number.isFinite(seed) ? seed >>> 0 : 1,
    t: 0, q: 0, f: 0, a: 0, h: RULES.emptyHappiness, j: 0, u: 1, z: 0,
    d: Array(RULES.hoursPerDay).fill(0) };
  return tick({ saved, derived: { dirty: true } }, 0);
}

function nextRandom(seed) {
  return (Math.imul(seed, PRNG_MULTIPLIER) + PRNG_INCREMENT) >>> 0;
}

function transact(input, amount) {
  const work = { ...input, saved: { ...input.saved, d: [...input.saved.d] } };
  work.saved.c = roundMoney(Math.min(RULES.cashLimit, work.saved.c + amount));
  const hour = Math.floor(work.saved.t / RULES.secondsPerHour) % RULES.hoursPerDay;
  work.saved.d[hour] = roundMoney(work.saved.d[hour] + amount);
  return work;
}

function command(state, updates) {
  return tick({ saved: { ...state.saved, ...updates }, derived: { ...state.derived } }, 0);
}

export function setTicketPrice(state, price) {
  if (!Number.isInteger(price) || price < 0 || price > RULES.maxPrice) return refuse("invalid-price");
  return command(state, { p: price });
}

export function setRidePrice(state, kindId, price) {
  const index = RIDES.findIndex(kind => kind.id === kindId);
  if (index < 0) return refuse("unknown-kind");
  if (!Number.isInteger(price) || price < 0 || price > RULES.maxPrice) return refuse("invalid-price");
  const rp = [...state.saved.rp];
  rp[index] = price;
  return command(state, { rp });
}

export function setStaff(state, role, count) {
  if (!Object.hasOwn(STAFF, role)) return refuse("unknown-role");
  if (!Number.isInteger(count) || count < 0 || count > RULES.maxStaff) return refuse("invalid-count");
  if (state.saved.c < 0 && count > state.saved.s[STAFF[role].index]) return refuse("bankrupt");
  const s = [...state.saved.s];
  s[STAFF[role].index] = count;
  return command(state, { s });
}

export function setMaintenance(state, enabled) {
  if (typeof enabled !== "boolean") return refuse("invalid-maintenance");
  return command(state, { m: enabled });
}

export function maintainRide(state, id) {
  const objects = readObjects(state.saved);
  const object = objects[id];
  if (!Number.isInteger(id) || !object || KINDS[object.k].type !== "ride") return refuse("unknown-ride");
  if (state.saved.c < RULES.repairCost) return refuse("unaffordable");
  const o = [...state.saved.o];
  o[id] = packObject({ ...object, h: KINDS[object.k].reliability, b: 0 });
  const work = { saved: { ...state.saved, o, d: [...state.saved.d] } };
  return command(state, transact(work, -RULES.repairCost).saved);
}

function priceFor(work, object) {
  const kind = KINDS[object.k];
  return kind.type === "ride" ? work.saved.rp[object.k] : kind.salePrice ?? 0;
}

function distance(a, b) {
  return Math.abs(a % GRID.width - b % GRID.width)
    + Math.abs(Math.floor(a / GRID.width) - Math.floor(b / GRID.width));
}

function metrics(work) {
  const rides = work.objects.filter(object => object && KINDS[object.k].type === "ride");
  const variety = new Set(rides.filter(object => work.network.entrances[object.id]?.reachable && !object.b)
    .map(object => object.k)).size;
  const happiness = work.guests.length ? work.guests.reduce((sum, guest) => sum + guest.happy, 0)
    / work.guests.length : work.saved.h;
  const queues = work.guests.filter(guest => guest.phase === PHASE.QUEUE);
  const queueTime = queues.length ? queues.reduce((sum, guest) => sum + guest.wait, 0) / queues.length : 0;
  const brokenPenalty = rides.length ? RULES.breakdownRatingPenalty * rides.filter(object => object.b).length / rides.length : 0;
  const rating = Math.round(clamp(happiness + Math.min(RULES.maxVarietyBonus, variety * RULES.varietyBonus)
    - work.saved.j / RULES.cleanlinessPenalty - Math.min(RULES.maxQueuePenalty, queueTime / RULES.queueRatingScale)
    - brokenPenalty));
  const objectValue = work.objects.reduce((sum, object) => sum + (object ? KINDS[object.k].cost : 0), 0);
  return { rating, happiness, queueTime, cleanliness: clamp(RULES.maxNeed - work.saved.j / RULES.cleanlinessScale),
    parkValue: Math.round(objectValue + work.saved.c + rating * RULES.ratingValue + work.guests.length * RULES.guestValue),
    day: work.saved.t / DAY_SECONDS, profitPerDay: roundMoney(work.saved.d.reduce((sum, value) => sum + value, 0)),
    arrivalRate: RULES.baseArrivals * (rating / RULES.maxNeed) * Math.exp(-work.saved.p / RULES.ticketSensitivity),
    guestCount: work.guests.length, bankrupt: work.saved.c < 0 };
}

function spawn(input) {
  const work = { ...input, saved: { ...input.saved }, guests: [...input.guests], stats: { ...input.stats } };
  if (work.saved.c < 0) return work;
  work.saved.f += Math.round(metrics(work).arrivalRate * RULES.arrivalScale);
  if (work.saved.f < RULES.arrivalScale) return work;
  work.saved.f -= RULES.arrivalScale;
  if (work.guests.length >= RULES.maxGuests) return work;
  work.saved.r = nextRandom(work.saved.r);
  const wallet = RULES.initialWallet + Math.floor(work.saved.r / PRNG_RANGE * RULES.walletVariation);
  if (wallet < work.saved.p) return work;
  work.saved.r = nextRandom(work.saved.r);
  work.guests.push({ p: GATE, target: 0, phase: PHASE.WALK, wait: 0, age: 0,
    wallet: wallet - work.saved.p, happy: RULES.initialHappiness, ...RULES.initialNeeds,
    energy: RULES.initialEnergy, taste: Math.floor(work.saved.r / PRNG_RANGE * RULES.maxNeed) });
  work.saved.a++;
  work.stats.arrivals++;
  return transact(work, work.saved.p);
}

function selectTarget(work, guest) {
  const needs = [...NEEDS].sort((a, b) => needLevel(guest, b) - needLevel(guest, a));
  for (const need of needs) {
    const options = work.objects.filter(object => {
      if (!object || object.b || !work.network.fields[object.id] || work.network.fields[object.id][guest.p] < 0) return false;
      const kind = KINDS[object.k];
      return (kind.need === need || (need === "thrill" && kind.need === "souvenir"))
        && guest.wallet >= priceFor(work, object)
        && work.guests.filter(other => other.target === object.id + 1).length < RULES.maxQueue;
    });
    options.sort((a, b) => targetScore(work, guest, a) - targetScore(work, guest, b) || a.id - b.id);
    if (options.length) return options[0].id + 1;
  }
  return 0;
}

function needLevel(guest, need) {
  return need === "energy" ? RULES.maxNeed - guest.energy : guest[need];
}

function targetScore(work, guest, object) {
  const kind = KINDS[object.k];
  const queue = work.guests.filter(other => other.target === object.id + 1).length;
  return work.network.fields[object.id][guest.p] + queue * RULES.serviceSeconds
    + (kind.type === "ride" ? Math.abs(kind.thrill - guest.taste) / RULES.thrillPreferenceScale : 0);
}

function move(guest, field) {
  const next = neighbors(guest.p).find(p => field[p] >= 0 && field[p] < field[guest.p]);
  return { ...guest, p: next ?? guest.p };
}

function affectGuest(input, index) {
  const guest = { ...input.guests[index] };
  const work = { ...input, saved: { ...input.saved }, guests: [...input.guests], stats: { ...input.stats } };
  work.guests[index] = guest;
  guest.age++;
  if (work.saved.t % RULES.needInterval === 0) {
    for (const need of ["hunger", "thirst", "toilet"]) guest[need] = clamp(guest[need] + 1);
    guest.energy = clamp(guest.energy - 1);
  }
  if (work.saved.t % RULES.thrillInterval === 0) guest.thrill = clamp(guest.thrill + 1);
  if (work.saved.t % RULES.distressInterval === 0) {
    const unmet = NEEDS.filter(need => needLevel(guest, need) > RULES.pressingNeed).length;
    guest.happy -= unmet + Math.floor(work.saved.j / RULES.cleanlinessPenalty);
  }
  if (work.saved.t % RULES.entertainerInterval === 0) guest.happy += work.saved.s[2];
  if (work.saved.t % RULES.sceneryInterval === 0) {
    const appeal = work.objects.reduce((sum, object) => sum + (object && distance(guest.p, object.p)
      <= RULES.sceneryRadius ? KINDS[object.k].appeal ?? 0 : 0), 0);
    guest.happy += Math.min(RULES.serviceHappiness, appeal);
  }
  const bin = work.objects.some(object => object && KINDS[object.k].id === "bin"
    && distance(guest.p, object.p) <= RULES.binRadius);
  work.saved.r = nextRandom(work.saved.r);
  if (work.saved.r / PRNG_RANGE < RULES.litterChance * (bin ? RULES.binFactor : 1)) work.saved.j += RULES.litterPerDrop;
  guest.happy = clamp(guest.happy);
  return work;
}

function updateGuest(input, index) {
  const work = affectGuest(input, index);
  const guest = work.guests[index];
  const priorPhase = guest.phase;
  const object = work.objects[guest.target - 1];
  const entrance = object && work.network.entrances[object.id];
  if (guest.happy <= RULES.departureHappiness || guest.age >= RULES.visitSeconds || guest.energy === 0
    || (guest.age >= RULES.satisfiedVisitSeconds && guest.happy >= RULES.satisfiedHappiness)) guest.phase = PHASE.LEAVE;
  if (priorPhase === PHASE.USE && entrance?.reachable && (guest.phase !== PHASE.USE || object.b)) {
    guest.p = entrance.access[0];
  }
  const atEntrance = guest.phase === PHASE.USE && entrance?.reachable && !object.b;
  if (work.network.gate[guest.p] < 0 && !atEntrance) {
    // Demolition evacuates stranded guests to the only exit, without traversing unowned land.
    guest.p = GATE;
    guest.happy = RULES.departureHappiness;
    guest.phase = PHASE.LEAVE;
  }
  if (guest.phase === PHASE.LEAVE) { work.guests[index] = move(guest, work.network.gate); return work; }
  if (guest.target && (!object || object.b || !work.network.fields[object.id])) {
    guest.target = 0; guest.phase = PHASE.WALK; guest.wait = 0;
    guest.happy = clamp(guest.happy - RULES.serviceHappiness);
  }
  if (!guest.target) guest.target = selectTarget(work, guest);
  if (!guest.target) {
    if (work.saved.t % RULES.distressInterval === 0) guest.happy = clamp(guest.happy - 1);
    return work;
  }
  if (guest.phase === PHASE.USE) return work;
  const field = work.network.fields[guest.target - 1];
  if (guest.phase === PHASE.WALK) {
    guest.p = move(guest, field).p;
    if (field[guest.p] === 0) { guest.phase = PHASE.QUEUE; guest.wait = 0; work.stats.queueEntries++; }
    return work;
  }
  guest.wait++;
  if (guest.wait > RULES.queueGrace && work.saved.t % RULES.queuePenaltyInterval === 0) guest.happy = clamp(guest.happy - 1);
  return work;
}

function finishUse(input, index, object) {
  const guest = { ...input.guests[index] };
  let work = { ...input, guests: [...input.guests], stats: { ...input.stats,
    visitsByObject: [...input.stats.visitsByObject], incomeByObject: [...input.stats.incomeByObject] } };
  work.guests[index] = guest;
  const kind = KINDS[object.k];
  const price = priceFor(work, object);
  if (guest.wallet >= price) {
    guest.wallet -= price;
    work = transact(work, price - (kind.stockCost ?? 0));
    work.stats.visitsByObject[object.id]++;
    work.stats.incomeByObject[object.id] += price;
    if (kind.type === "ride") { work.stats.rides++; work.stats.rideIncome += price; }
    if (kind.type === "stall") work.stats.stallIncome += price;
    const need = kind.need === "souvenir" ? "thrill" : kind.need;
    guest[need] = need === "energy" ? clamp(guest.energy + RULES.facilityEnergy)
      : clamp(guest[need] - (kind.type === "ride" ? RULES.rideRelief : RULES.serviceRelief));
    guest.happy = clamp(guest.happy + (kind.type === "ride"
      ? RULES.rideHappiness + Math.floor(kind.excitement / RULES.excitementHappinessScale) : RULES.serviceHappiness));
  }
  guest.p = work.network.entrances[object.id].access[0];
  guest.target = 0; guest.phase = PHASE.WALK; guest.wait = 0;
  return work;
}

function runAttractions(input) {
  let work = { ...input, saved: { ...input.saved }, objects: input.objects.map(object => object && { ...object }),
    guests: input.guests.map(guest => ({ ...guest })) };
  for (const object of work.objects) {
    if (!object) continue;
    const kind = KINDS[object.k];
    if (object.b || !work.network.fields[object.id]) { object.t = 0; continue; }
    const users = work.guests.filter(guest => guest.target === object.id + 1 && guest.phase === PHASE.USE);
    if (object.t > 0) {
      object.t--;
      if (object.t > 0) continue;
      for (const guest of users) work = finishUse(work, work.guests.indexOf(guest), object);
      if (kind.type === "ride" && users.length) {
        object.h = clamp(object.h - RULES.wearPerCycle);
        work.saved.r = nextRandom(work.saved.r);
        if (object.h <= RULES.failureHealth || work.saved.r / PRNG_RANGE < (RULES.maxNeed - object.h) / RULES.failureScale) {
          object.b = RULES.repairWork;
          continue;
        }
      }
    }
    const queue = work.guests.filter(guest => guest.target === object.id + 1 && guest.phase === PHASE.QUEUE)
      .sort((a, b) => b.wait - a.wait).filter(guest => guest.wallet >= priceFor(work, object));
    if (!queue.length) continue;
    object.t = kind.duration ?? RULES.serviceSeconds;
    for (const guest of queue.slice(0, kind.capacity ?? 1)) {
      guest.phase = PHASE.USE;
      guest.p = work.network.entrances[object.id].tile;
    }
  }
  return work;
}

function operate(input) {
  let work = { ...input, objects: input.objects.map(object => object && { ...object }) };
  const upkeep = work.objects.reduce((sum, object) => sum + (object ? KINDS[object.k].upkeep : 0), 0);
  const wages = Object.values(STAFF).reduce((sum, role) => sum + work.saved.s[role.index] * role.wage, 0);
  work = transact(work, -(RULES.overheadPerHour + upkeep + wages) / RULES.secondsPerHour
    - work.guests.length * RULES.guestServicePerSecond);
  work.saved.j = clamp(work.saved.j - work.saved.s[1] * RULES.janitorRate, RULES.maxLitter);
  let mechanics = work.saved.s[0];
  for (const object of work.objects) {
    if (!object || KINDS[object.k].type !== "ride" || mechanics <= 0) continue;
    const kind = KINDS[object.k];
    if (object.b && work.saved.c >= RULES.repairCost) {
      const effort = Math.min(mechanics, object.b);
      object.b -= effort; mechanics -= effort;
      if (!object.b) { object.h = kind.reliability; work = transact(work, -RULES.repairCost); }
    } else if (!object.b && work.saved.m && work.saved.t % RULES.maintenanceInterval === 0) {
      object.h = Math.min(kind.reliability, object.h + RULES.maintenanceHealth);
      mechanics--;
    }
  }
  return work;
}

function awardProgress(input) {
  const work = { ...input, saved: { ...input.saved } };
  const current = metrics(work);
  const meets = gate => work.saved.a >= gate.guests && current.parkValue >= gate.value && current.rating >= gate.rating;
  for (const unlock of UNLOCKS) if (meets(unlock)) work.saved.u |= 1 << unlock.id;
  for (const [index, milestone] of MILESTONES.entries()) {
    if ((work.saved.z & (1 << index)) || !meets(milestone)) continue;
    work.saved.z |= 1 << index;
    work.saved.c = Math.min(RULES.cashLimit, work.saved.c + milestone.cash);
    if (milestone.unlock !== undefined) work.saved.u |= 1 << milestone.unlock;
  }
  return work;
}

function step(input) {
  let work = { ...input, saved: { ...input.saved, d: [...input.saved.d] } };
  work.saved.t++;
  if (work.saved.t % RULES.secondsPerHour === 0) {
    work.saved.d[Math.floor(work.saved.t / RULES.secondsPerHour) % RULES.hoursPerDay] = 0;
  }
  work = spawn(work);
  for (let index = 0; index < work.guests.length; index++) work = updateGuest(work, index);
  work = runAttractions(work);
  work = { ...work, saved: { ...work.saved }, stats: { ...work.stats } };
  work.guests = work.guests.filter(guest => {
    if (guest.phase !== PHASE.LEAVE || guest.p !== GATE) return true;
    work.saved.h = Math.round(work.saved.h * (1 - RULES.departureMemory) + guest.happy * RULES.departureMemory);
    work.stats[guest.happy >= RULES.happyDeparture ? "happy" : "angry"]++;
    return false;
  });
  return awardProgress(operate(work));
}

export function tick(state, dtSeconds) {
  if (!Number.isFinite(dtSeconds) || dtSeconds < 0 || dtSeconds > RULES.maxTickSeconds) return refuse("invalid-dt");
  const ready = refreshNetwork(state);
  const priorStats = ready.derived.stats ?? freshStats();
  let work = { saved: { ...ready.saved, d: [...ready.saved.d] }, objects: readObjects(ready.saved),
    guests: readGuests(ready.saved), network: ready.derived.network,
    stats: { ...priorStats, visitsByObject: [...priorStats.visitsByObject], incomeByObject: [...priorStats.incomeByObject] } };
  const elapsed = work.saved.q + Math.round(dtSeconds * RULES.timeScale);
  const stepUnits = RULES.stepSeconds * RULES.timeScale;
  const steps = Math.floor(elapsed / stepUnits);
  work.saved.q = elapsed % stepUnits;
  for (let i = 0; i < steps; i++) work = step(work);
  work.saved.o = work.objects.map(object => object ? packObject(object) : null);
  work.saved.v = packGuests(work.guests);
  return { saved: work.saved, derived: { ...ready.derived, ...metrics(work),
    guests: work.guests, objects: work.objects, stats: work.stats } };
}
