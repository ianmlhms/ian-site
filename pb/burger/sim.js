/* Burger-Restaurant simulation: pure functions over ONE state object, no DOM, no timers, no clock of its own.
 * main.js advances it with step(state, TIMING.stepMs) from a fixed-step loop, so the game plays the same at 30, 60 or 120 Hz
 * and stops dead while paused or hidden (no step is taken). Every function returns a new state and never changes its input.
 *
 * state = {
 *   progress: {day, coins, lifetimeCoins, stars, kit, int, prem}   the saved part (save.js)
 *   screen:   "intro" | "playing" | "paused" | "summary"
 *   session:  null | the running day (time `t` in ms since the day started)
 *   events:   things that just happened, for sounds / pop-ups; main.js takes them out after each frame
 * } */
import {
  DAYS, GAME_LIMITS, INTERIOR_UPGRADES, ITEMS, RECIPES, TIMING, UNLOCKS, UPGRADE_TABLES,
} from "/pb/burger/data.js?v=2";

const CUSTOMER_ART_COUNT = 6;
const BASE_TIP_RATE = 0.05;
const PATIENCE_TIP_RATE = 0.25;
const TWO_STAR_FACTOR = 1.25;
const THREE_STAR_FACTOR = 1.5;
const ARRIVAL_JITTER_BASE = 0.82;
const ARRIVAL_JITTER_RANGE = 0.36;
const NO_ARRIVAL_BEFORE_END_MS = 4_000;
const NEW_ITEM_CHANCE = 0.3;
const INITIAL_SEED = 0x45d9f3b;
const DAY_SEED_MULTIPLIER = 2_654_435_761;

/* ---------- progress ---------- */
const clampInt = (value, min, max) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
};

const findUpgrade = (category, id) => UPGRADE_TABLES[category]?.find((entry) => entry.id === id) || null;

export const upgradeLevel = (progress, category, id) => {
  const upgrade = findUpgrade(category, id);
  return upgrade ? clampInt(progress[category]?.[id], 0, upgrade.max) : 0;
};

const kitchenValue = (progress, id) => (findUpgrade("kit", id)?.base || 0) + upgradeLevel(progress, "kit", id);
export const stationCapacity = kitchenValue;

const interiorBonus = (progress, field) => INTERIOR_UPGRADES.reduce(
  (total, upgrade) => total + upgradeLevel(progress, "int", upgrade.id) * upgrade[field], 0);

export const levelFor = (day) => DAYS[clampInt(day, 1, DAYS.length) - 1];
export const dayDurationMs = (progress, day = progress.day) => (
  levelFor(day).durationSeconds * 1000 + upgradeLevel(progress, "prem", "extraTime") * TIMING.extraDayMs
);

export const isUnlocked = (day, id) => {
  const recipe = RECIPES.find((entry) => entry.id === id);
  if (recipe) return day >= recipe.day;
  return day >= (UNLOCKS[id] ?? Infinity);
};

/* The coins and stars spent on upgrades: a purchase leaves lifetimeCoins alone, so save.js uses this to rank two saves
 * with the same lifetime (the one with more bought upgrades has more progress). */
export const spentOn = (progress, currency) => Object.entries(UPGRADE_TABLES).reduce((total, [category, upgrades]) => {
  if ((category === "prem") !== (currency === "stars")) return total;
  return total + upgrades.reduce((sum, upgrade) => {
    const level = upgradeLevel(progress, category, upgrade.id);
    return sum + upgrade.costs.slice(0, level).reduce((a, b) => a + b, 0);
  }, 0);
}, 0);

/* ---------- state ---------- */
export const createState = (progress) => ({progress, screen:"intro", session:null, events:[]});

const withEvent = (state, event) => ({...state, events:[...state.events, event]});
const refuse = (state, reason) => withEvent(state, {type:"refused", reason});
export const takeEvents = (state) => [state.events, state.events.length ? {...state, events:[]} : state];

/* A better save arrived (cloud copy, another device): take its progress, keep a running day running. */
export const adoptProgress = (state, progress) => ({...state, progress});

const nextRandom = (seed) => {
  const next = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
  return {value:next / 4_294_967_296, seed:next};
};

const emptySlot = () => ({state:"empty"});
const makeSlots = (count) => Array.from({length:count}, emptySlot);

export function startDay(state) {
  if (state.screen === "playing" || state.screen === "paused") return state;
  const {progress} = state;
  const level = levelFor(progress.day);
  const helperLevel = upgradeLevel(progress, "prem", "helper");
  const session = {
    day:level.day,
    goal:level.goal,
    durationMs:dayDurationMs(progress, level.day),
    t:0,
    earned:0,
    served:0,
    walkouts:0,
    combo:1,
    lastCompleteAt:-Infinity,
    capacity:kitchenValue(progress, "counterPositions"),
    trayCapacity:kitchenValue(progress, "traySlots"),
    customers:[],
    nextCustomerId:1,
    nextArrivalAt:TIMING.firstCustomerMs,
    seed:(INITIAL_SEED ^ Math.imul(level.day, DAY_SEED_MULTIPLIER) ^ progress.lifetimeCoins) >>> 0,
    grill:makeSlots(kitchenValue(progress, "grillSlots")),
    fryer:makeSlots(kitchenValue(progress, "fryerBaskets")),
    drinks:makeSlots(kitchenValue(progress, "drinkTaps")),
    board:{patties:0, toppings:[]},
    tray:[],
    nextKey:1,
    discard:null,
    boostUntil:-1,
    boostReadyAt:0,
    nextHelperAt:helperLevel ? TIMING.helperIntervalMs : null,
    result:null,
  };
  return {...state, screen:"playing", session, events:[]};
}

export const pauseDay = (state) => state.screen === "playing" ? {...state, screen:"paused"} : state;
export const resumeDay = (state) => state.screen === "paused" ? {...state, screen:"playing"} : state;
/* The arcade's restart button: drop the running day (its coins are already in progress) and show the day's start again. */
export const abandonDay = (state) => (state.screen === "playing" || state.screen === "paused")
  ? {...state, screen:"intro", session:null, events:[]}
  : {...state, screen:"intro", session:null};

/* ---------- orders and guests ---------- */
const orderChoices = (day) => [
  ...RECIPES.filter((recipe) => recipe.day <= day).map((recipe) => recipe.id),
  ...["fries", "cola", "lemonade", "shake"].filter((id) => isUnlocked(day, id)),
];
const newestItems = (day) => orderChoices(day).filter((id) => (RECIPES.find((r) => r.id === id)?.day ?? UNLOCKS[id]) === day && day > 1);

function createOrder(day, maxOrder, seed) {
  const choices = orderChoices(day);
  const fresh = newestItems(day);
  const lengthRoll = nextRandom(seed);
  const length = 1 + Math.floor(lengthRoll.value * maxOrder);
  const freshRoll = nextRandom(lengthRoll.seed);
  let rolling = freshRoll.seed;
  const order = Array.from({length}, (_, index) => {
    if (index === 0 && fresh.length && freshRoll.value < NEW_ITEM_CHANCE) return fresh[0];
    const roll = nextRandom(rolling);
    rolling = roll.seed;
    return choices[Math.floor(roll.value * choices.length)] || "burger";
  });
  return {order, seed:rolling};
}

const freeSlots = (session) => Array.from({length:session.capacity}, (_, slot) => slot)
  .filter((slot) => !session.customers.some((customer) => customer.slot === slot));

function arrive(state) {
  const {session, progress} = state;
  const remaining = session.durationMs - session.t;
  const free = freeSlots(session);
  if (session.t < session.nextArrivalAt || !free.length || remaining < NO_ARRIVAL_BEFORE_END_MS) return state;
  const level = levelFor(session.day);
  const {order, seed} = createOrder(session.day, level.maxOrder, session.seed);
  const slotRoll = nextRandom(seed);
  const gapRoll = nextRandom(slotRoll.seed);
  const customer = {
    id:session.nextCustomerId,
    art:((session.nextCustomerId - 1) % CUSTOMER_ART_COUNT) + 1,
    slot:free[Math.floor(slotRoll.value * free.length)],
    order,
    left:order,
    arrivedAt:session.t,
    patienceMs:Math.round(level.patienceMs * (1 + interiorBonus(progress, "patience"))),
  };
  const gap = level.arrivalMs * (ARRIVAL_JITTER_BASE + gapRoll.value * ARRIVAL_JITTER_RANGE);
  return {
    ...state,
    session:{
      ...session,
      customers:[...session.customers, customer],
      nextCustomerId:session.nextCustomerId + 1,
      nextArrivalAt:session.t + gap,
      seed:gapRoll.seed,
    },
  };
}

/* An empty counter never waits long, and a freed place is filled again after a short beat (no dead time). */
function keepGuestsComing(session) {
  const soonest = session.customers.length ? session.nextArrivalAt : Math.min(session.nextArrivalAt, session.t + TIMING.emptyCounterMs);
  return soonest === session.nextArrivalAt ? session : {...session, nextArrivalAt:soonest};
}

const patienceLeft = (customer, t) => Math.max(0, customer.arrivedAt + customer.patienceMs - t) / customer.patienceMs;
export const patienceRatio = patienceLeft;

function walkOut(state) {
  const {session} = state;
  const leaving = session.customers.filter((customer) => patienceLeft(customer, session.t) <= 0);
  if (!leaving.length) return state;
  const customers = session.customers.filter((customer) => !leaving.includes(customer));
  const next = {
    ...state,
    session:{...session, customers, walkouts:session.walkouts + leaving.length,
      nextArrivalAt:Math.max(session.nextArrivalAt, session.t + TIMING.freedSlotMs)},
  };
  return leaving.reduce((acc, customer) => withEvent(acc, {type:"walkout", slot:customer.slot, id:customer.id}), next);
}

/* ---------- stations ---------- */
const burnWindow = (progress, station) => station === "grill"
  ? TIMING.grillReadyMs + upgradeLevel(progress, "kit", "burnGuard") * TIMING.grillGuardStepMs
  : TIMING.fryerReadyMs;

function advanceHeat(state, station) {
  const {session, progress} = state;
  const boosted = session.t < session.boostUntil;
  const window = burnWindow(progress, station);
  let events = [];
  const slots = session[station].map((slot, index) => {
    if (slot.state === "cooking" && (boosted || session.t >= slot.readyAt)) {
      const readyAt = Math.min(session.t, slot.readyAt);
      events = [...events, {type:"ready", station, index}];
      return {state:"ready", item:slot.item, readyAt, burnAt:Math.max(readyAt, boosted ? session.boostUntil : readyAt) + window};
    }
    if (slot.state === "ready" && !boosted && session.t >= slot.burnAt) {
      events = [...events, {type:"burnt", station, index}];
      return {state:"burnt", item:slot.item};
    }
    return slot;
  });
  if (!events.length) return state;
  return {...state, session:{...session, [station]:slots}, events:[...state.events, ...events]};
}

function advanceDrinks(state) {
  const {session} = state;
  const boosted = session.t < session.boostUntil;
  if (!session.drinks.some((slot) => slot.state === "filling" && (boosted || session.t >= slot.readyAt))) return state;
  const drinks = session.drinks.map((slot) => slot.state === "filling" && (boosted || session.t >= slot.readyAt)
    ? {state:"ready", item:slot.item} : slot);
  return withEvent({...state, session:{...session, drinks}}, {type:"ready", station:"drinks"});
}

const cookTime = (base, step, minimum, level) => Math.max(minimum, base - level * step);
const grillCookMs = (progress) => cookTime(TIMING.grillCookMs, TIMING.grillSpeedStepMs, TIMING.grillMinimumMs, upgradeLevel(progress, "kit", "grillSpeed"));
const fryerCookMs = (progress) => cookTime(TIMING.fryerCookMs, TIMING.fryerSpeedStepMs, TIMING.fryerMinimumMs, upgradeLevel(progress, "kit", "fryerSpeed"));

const isPlaying = (state) => state.screen === "playing" && !!state.session;
const setSlot = (slots, index, slot) => slots.map((entry, i) => (i === index ? slot : entry));
const maxPatties = (day) => Math.max(...RECIPES.filter((recipe) => recipe.day <= day).map((recipe) => recipe.patties));

function addToTray(state, itemId) {
  const {session} = state;
  if (session.tray.length >= session.trayCapacity) return null;
  return {...session, tray:[...session.tray, {id:itemId, key:session.nextKey}], nextKey:session.nextKey + 1};
}

export function tapGrill(state, index) {
  if (!isPlaying(state)) return state;
  const {session} = state;
  const slot = session.grill[index];
  if (!slot) return state;
  if (slot.state === "empty") {
    const cooking = {state:"cooking", item:"patty", startAt:session.t, readyAt:session.t + grillCookMs(state.progress)};
    return withEvent({...state, session:{...session, grill:setSlot(session.grill, index, cooking)}}, {type:"start", station:"grill", index});
  }
  if (slot.state === "burnt") {
    return withEvent({...state, session:{...session, grill:setSlot(session.grill, index, emptySlot())}}, {type:"toss", station:"grill", index});
  }
  if (slot.state === "ready") {
    if (session.board.patties >= maxPatties(session.day)) return refuse(state, "board-full");
    const board = {...session.board, patties:session.board.patties + 1};
    return withEvent({...state, session:{...session, board, grill:setSlot(session.grill, index, emptySlot())}}, {type:"board", station:"grill", index});
  }
  return refuse(state, "cooking");
}

export function tapFryer(state, index) {
  if (!isPlaying(state)) return state;
  const {session} = state;
  const slot = session.fryer[index];
  if (!slot) return state;
  if (!isUnlocked(session.day, "fries")) return refuse(state, "locked");
  if (slot.state === "empty") {
    const cooking = {state:"cooking", item:"fries", startAt:session.t, readyAt:session.t + fryerCookMs(state.progress)};
    return withEvent({...state, session:{...session, fryer:setSlot(session.fryer, index, cooking)}}, {type:"start", station:"fryer", index});
  }
  if (slot.state === "burnt") {
    return withEvent({...state, session:{...session, fryer:setSlot(session.fryer, index, emptySlot())}}, {type:"toss", station:"fryer", index});
  }
  if (slot.state === "ready") return handOver(state, "fries", (current) => ({...current, fryer:setSlot(current.fryer, index, emptySlot())}));
  return refuse(state, "cooking");
}

/* A drink button pours that drink into the first free tap. */
export function pourDrink(state, itemId) {
  if (!isPlaying(state)) return state;
  const {session} = state;
  if (!ITEMS[itemId] || ITEMS[itemId].kind !== "drink" || !isUnlocked(session.day, itemId)) return refuse(state, "locked");
  const index = session.drinks.findIndex((slot) => slot.state === "empty");
  if (index < 0) return refuse(state, "taps-busy");
  const filling = {state:"filling", item:itemId, startAt:session.t, readyAt:session.t + TIMING.drinkFillMs};
  return withEvent({...state, session:{...session, drinks:setSlot(session.drinks, index, filling)}}, {type:"start", station:"drinks", index});
}

export function tapDrink(state, index) {
  if (!isPlaying(state)) return state;
  const {session} = state;
  const slot = session.drinks[index];
  if (!slot || slot.state !== "ready") return slot?.state === "filling" ? refuse(state, "cooking") : state;
  return handOver(state, slot.item, (current) => ({...current, drinks:setSlot(current.drinks, index, emptySlot())}));
}

export function toggleTopping(state, topping) {
  if (!isPlaying(state)) return state;
  const {session} = state;
  if (!isUnlocked(session.day, topping)) return refuse(state, "locked");
  const has = session.board.toppings.includes(topping);
  const toppings = has ? session.board.toppings.filter((entry) => entry !== topping) : [...session.board.toppings, topping];
  return withEvent({...state, session:{...session, board:{...session.board, toppings}}}, {type:has ? "untop" : "top", topping});
}

const sameSet = (left, right) => left.length === right.length && left.every((entry) => right.includes(entry));
export const recipeOnBoard = (session) => (session.board.patties
  ? RECIPES.find((recipe) => recipe.day <= session.day && recipe.patties === session.board.patties && sameSet(recipe.toppings, session.board.toppings)) || null
  : null);

export function plateBurger(state) {
  if (!isPlaying(state)) return state;
  const {session} = state;
  if (!session.board.patties) return refuse(state, "no-patty");
  const recipe = recipeOnBoard(session);
  if (!recipe) return refuse(state, "no-recipe");
  return handOver(state, recipe.id, (current) => ({...current, board:{patties:0, toppings:[]}}));
}

export function trashBoard(state) {
  if (!isPlaying(state)) return state;
  const {session} = state;
  if (!session.board.patties && !session.board.toppings.length) return state;
  return withEvent({...state, session:{...session, board:{patties:0, toppings:[]}}}, {type:"toss", station:"board"});
}

/* ---------- serving ---------- */
/* The guest who wants this and is closest to walking out gets it. */
const mostUrgentFor = (session, itemId) => session.customers
  .filter((customer) => customer.left.includes(itemId))
  .sort((a, b) => patienceLeft(a, session.t) - patienceLeft(b, session.t))[0] || null;
export const isWanted = (session, itemId) => !!mostUrgentFor(session, itemId);

function payFor(state, itemId, customerId) {
  const {session, progress} = state;
  const customer = session.customers.find((entry) => entry.id === customerId);
  const wantedAt = customer ? customer.left.indexOf(itemId) : -1;
  if (wantedAt < 0) return state;
  const left = customer.left.filter((_, index) => index !== wantedAt);
  const isComplete = left.length === 0;
  const inWindow = session.t - session.lastCompleteAt <= GAME_LIMITS.comboWindowMs;
  const combo = isComplete ? (inWindow ? Math.min(GAME_LIMITS.maxCombo, session.combo + 1) : 1) : 1;
  const tipRate = BASE_TIP_RATE + patienceLeft(customer, session.t) * PATIENCE_TIP_RATE + interiorBonus(progress, "tip");
  const amount = Math.round(ITEMS[itemId].value * (1 + tipRate) * combo);
  const customers = isComplete
    ? session.customers.filter((entry) => entry.id !== customerId)
    : session.customers.map((entry) => (entry.id === customerId ? {...entry, left} : entry));
  const nextSession = {
    ...session,
    customers,
    combo:isComplete ? combo : session.combo,
    lastCompleteAt:isComplete ? session.t : session.lastCompleteAt,
    earned:session.earned + amount,
    served:session.served + (isComplete ? 1 : 0),
    nextArrivalAt:isComplete ? Math.max(session.nextArrivalAt, session.t + TIMING.freedSlotMs) : session.nextArrivalAt,
  };
  return withEvent({
    ...state,
    progress:{...progress, coins:progress.coins + amount, lifetimeCoins:progress.lifetimeCoins + amount},
    session:nextSession,
  }, {type:"served", slot:customer.slot, id:customer.id, item:itemId, amount, combo, isComplete});
}

const serveFromTray = (state, trayIndex, customerId) => {
  const {session} = state;
  const item = session.tray[trayIndex];
  const without = {...state, session:{...session, tray:session.tray.filter((_, index) => index !== trayIndex), discard:null}};
  return payFor(without, item.id, customerId);
};

/* Something is finished (a plated burger, fries, a drink): a guest who waits for it gets it at once, otherwise it waits
 * on the tray. clearSource empties the place it came from. */
function handOver(state, itemId, clearSource) {
  const base = {...state, session:clearSource(state.session)};
  const customer = mostUrgentFor(base.session, itemId);
  if (customer) return payFor(base, itemId, customer.id);
  const session = addToTray(base, itemId);
  if (!session) return refuse(state, "tray-full");
  return withEvent({...base, session}, {type:"tray", item:itemId});
}

export function tapTray(state, index) {
  if (!isPlaying(state)) return state;
  const {session} = state;
  const item = session.tray[index];
  if (!item) return state;
  const customer = mostUrgentFor(session, item.id);
  if (customer) return serveFromTray(state, index, customer.id);
  if (session.discard && session.discard.key === item.key && session.t <= session.discard.until) {
    const tray = session.tray.filter((_, i) => i !== index);
    return withEvent({...state, session:{...session, tray, discard:null}}, {type:"toss", station:"tray"});
  }
  return refuse({...state, session:{...session, discard:{key:item.key, until:session.t + TIMING.discardWindowMs}}}, "unwanted");
}

/* Tapping a guest hands over everything on the tray that this guest ordered. */
export function tapCustomer(state, slot) {
  if (!isPlaying(state)) return state;
  const customer = state.session.customers.find((entry) => entry.slot === slot);
  if (!customer) return state;
  let next = state;
  for (;;) {
    const current = next.session.customers.find((entry) => entry.id === customer.id);
    const trayIndex = current ? next.session.tray.findIndex((item) => current.left.includes(item.id)) : -1;
    if (trayIndex < 0) break;
    next = serveFromTray(next, trayIndex, customer.id);
  }
  return next === state ? refuse(state, "nothing-ready") : next;
}

function runHelper(state) {
  const {session, progress} = state;
  if (session.nextHelperAt === null || session.t < session.nextHelperAt) return state;
  const level = upgradeLevel(progress, "prem", "helper");
  const interval = Math.max(TIMING.helperMinimumMs, TIMING.helperIntervalMs - (level - 1) * TIMING.helperStepMs);
  const scheduled = {...state, session:{...session, nextHelperAt:session.t + interval}};
  const trayIndex = session.tray.findIndex((item) => mostUrgentFor(session, item.id));
  if (trayIndex < 0) return scheduled;
  return serveFromTray(scheduled, trayIndex, mostUrgentFor(session, session.tray[trayIndex].id).id);
}

export function activateBoost(state) {
  if (!isPlaying(state)) return state;
  const {session, progress} = state;
  const level = upgradeLevel(progress, "prem", "instant");
  if (!level) return state;
  if (session.t < session.boostReadyAt) return refuse(state, "boost-cooldown");
  const boostUntil = session.t + TIMING.boostDurationMs + (level - 1) * TIMING.boostLevelStepMs;
  return withEvent({...state, session:{...session, boostUntil, boostReadyAt:session.t + TIMING.boostCooldownMs}}, {type:"boost"});
}

/* ---------- the clock ---------- */
const starRating = (earned, goal, walkouts) => {
  if (earned < goal) return 0;
  if (earned >= goal * THREE_STAR_FACTOR && walkouts === 0) return 3;
  if (earned >= goal * TWO_STAR_FACTOR) return 2;
  return 1;
};

function finishDay(state) {
  const {session, progress} = state;
  const rating = starRating(session.earned, session.goal, session.walkouts);
  const hasPassed = rating > 0;
  const day = hasPassed ? Math.max(progress.day, Math.min(GAME_LIMITS.maxDay, session.day + 1)) : progress.day;
  const result = {rating, hasPassed, goal:session.goal, earned:session.earned, served:session.served, walkouts:session.walkouts, day:session.day};
  return withEvent({
    ...state,
    progress:{...progress, day, stars:progress.stars + (rating === 3 ? 1 : 0)},
    screen:"summary",
    session:{...session, t:session.durationMs, customers:[], result},
  }, {type:"dayEnd", result});
}

export function step(state, dtMs) {
  if (!isPlaying(state)) return state;
  let next = {...state, session:keepGuestsComing({...state.session, t:state.session.t + dtMs})};
  next = advanceHeat(next, "grill");
  next = advanceHeat(next, "fryer");
  next = advanceDrinks(next);
  next = walkOut(next);
  next = arrive(next);
  next = runHelper(next);
  if (next.session.discard && next.session.t > next.session.discard.until) next = {...next, session:{...next.session, discard:null}};
  return next.session.t >= next.session.durationMs ? finishDay(next) : next;
}

/* ---------- shop ---------- */
export function buyUpgrade(state, category, id) {
  if (state.screen === "playing" || state.screen === "paused") return refuse(state, "busy");
  const upgrade = findUpgrade(category, id);
  if (!upgrade) return state;
  const level = upgradeLevel(state.progress, category, id);
  if (level >= upgrade.max) return refuse(state, "max");
  const cost = upgrade.costs[level];
  const currency = category === "prem" ? "stars" : "coins";
  if (state.progress[currency] < cost) return refuse(state, currency === "stars" ? "no-stars" : "no-coins");
  const progress = {...state.progress, [currency]:state.progress[currency] - cost, [category]:{...state.progress[category], [id]:level + 1}};
  return withEvent({...state, progress}, {type:"bought", category, id});
}

