import {
  DAYS,
  GAME_LIMITS,
  INTERIOR_UPGRADES,
  ITEMS,
  KITCHEN_UPGRADES,
  PREMIUM_UPGRADES,
  RECIPES,
  TIMING,
  UNLOCKS,
  VERSION,
} from "/pb/burger/data.js?v=1";

const EMPTY_ASSEMBLY = Object.freeze({patties:0, toppings:[]});
const INITIAL_SEED = 0x45d9f3b;
const FIRST_CUSTOMER_DELAY_FACTOR = 0.45;
const BASE_TIP_RATE = 0.05;
const PATIENCE_TIP_RATE = 0.25;
const TWO_STAR_FACTOR = 1.3;
const THREE_STAR_FACTOR = 1.7;
const MILLISECONDS_PER_SECOND = 1_000;
const MAX_SANITIZED_LEVEL = 99;
const RANDOM_MULTIPLIER = 1_664_525;
const RANDOM_INCREMENT = 1_013_904_223;
const RANDOM_DIVISOR = 4_294_967_296;
const DAY_SEED_MULTIPLIER = 2_654_435_761;
const CUSTOMER_ART_COUNT = 6;
const ARRIVAL_JITTER_BASE = 0.82;
const ARRIVAL_JITTER_RANGE = 0.36;
const MINIMUM_HELPER_INTERVAL_MS = 1_800;
const BOOST_LEVEL_STEP_MS = 2_000;
const MAX_ASSEMBLY_PATTIES = 2;

const clampInteger = (value, minimum, maximum) => {
  const number = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : minimum;
  return Math.max(minimum, Math.min(maximum, number));
};

const cleanLevels = (levels) => levels && typeof levels === "object" ? {...levels} : {};

export function createGameState(progress = {}) {
  return {
    v:VERSION,
    day:clampInteger(progress.day, 1, GAME_LIMITS.maxDay),
    coins:clampInteger(progress.coins, 0, Number.MAX_SAFE_INTEGER),
    lifetimeCoins:clampInteger(progress.lifetimeCoins, 0, Number.MAX_SAFE_INTEGER),
    stars:clampInteger(progress.stars, 0, Number.MAX_SAFE_INTEGER),
    kit:cleanLevels(progress.kit),
    int:cleanLevels(progress.int),
    prem:cleanLevels(progress.prem),
    screen:"between",
    session:null,
  };
}

export const getLevel = (state) => DAYS[state.day - 1] || DAYS[DAYS.length - 1];

const upgradeLevel = (state, category, id) => clampInteger(state[category]?.[id], 0, MAX_SANITIZED_LEVEL);
const kitchenValue = (state, id) => {
  const upgrade = KITCHEN_UPGRADES.find((entry) => entry.id === id);
  return (upgrade?.base || 0) + upgradeLevel(state, "kit", id);
};

const interiorBonus = (state, field) => INTERIOR_UPGRADES.reduce((total, upgrade) => (
  total + upgradeLevel(state, "int", upgrade.id) * upgrade[field]
), 0);

const durationFor = (state, level) => (
  level.durationSeconds * MILLISECONDS_PER_SECOND + upgradeLevel(state, "prem", "extraTime") * TIMING.extraDayMs
);

const emptySlot = (id) => ({id, state:"empty"});
const makeSlots = (count, prefix) => Array.from({length:count}, (_, index) => emptySlot(`${prefix}-${index}`));

export function startDay(state, nowMs = performance.now()) {
  const level = getLevel(state);
  const helperLevel = upgradeLevel(state, "prem", "helper");
  const durationMs = durationFor(state, level);
  const session = {
    status:"playing",
    startedAt:nowMs,
    endsAt:nowMs + durationMs,
    remainingMs:durationMs,
    earnedCoins:0,
    walkouts:0,
    combo:1,
    lastCompletedAt:null,
    customers:[],
    nextCustomerId:1,
    nextArrivalAt:nowMs + level.arrivalMs * FIRST_CUSTOMER_DELAY_FACTOR,
    seed:(INITIAL_SEED ^ (state.day * DAY_SEED_MULTIPLIER) ^ state.lifetimeCoins) >>> 0,
    grill:makeSlots(kitchenValue(state, "grillSlots"), "grill"),
    fryer:makeSlots(kitchenValue(state, "fryerBaskets"), "fryer"),
    drinks:makeSlots(kitchenValue(state, "drinkTaps"), "drink"),
    assembly:{...EMPTY_ASSEMBLY},
    tray:[],
    boostUntil:0,
    boostReadyAt:nowMs,
    nextHelperAt:helperLevel ? nowMs + TIMING.helperIntervalMs : null,
    result:null,
  };
  return {...state, screen:"playing", session};
}

const nextRandom = (seed) => {
  const nextSeed = (Math.imul(seed, RANDOM_MULTIPLIER) + RANDOM_INCREMENT) >>> 0;
  return {value:nextSeed / RANDOM_DIVISOR, seed:nextSeed};
};

const availableOrderIds = (day) => [
  ...RECIPES.filter((recipe) => recipe.day <= day).map((recipe) => recipe.id),
  ...(day >= UNLOCKS.fries ? ["fries"] : []),
  ...(day >= UNLOCKS.cola ? ["cola"] : []),
  ...(day >= UNLOCKS.lemonade ? ["lemonade"] : []),
  ...(day >= UNLOCKS.shake ? ["shake"] : []),
];

const createOrder = (day, maximumLength, seed) => {
  const choices = availableOrderIds(day);
  const lengthRoll = nextRandom(seed);
  const orderLength = 1 + Math.floor(lengthRoll.value * maximumLength);
  return Array.from({length:orderLength}).reduce((result) => {
    const roll = nextRandom(result.seed);
    const itemId = choices[Math.floor(roll.value * choices.length)] || "burger";
    return {order:[...result.order, itemId], seed:roll.seed};
  }, {order:[], seed:lengthRoll.seed});
};

const addCustomer = (state, session, nowMs) => {
  const capacity = kitchenValue(state, "counterPositions");
  if (session.customers.length >= capacity || nowMs < session.nextArrivalAt) return session;
  const level = getLevel(state);
  const orderResult = createOrder(state.day, level.maxOrder, session.seed);
  const patienceMs = Math.round(level.patienceMs * (1 + interiorBonus(state, "patience")));
  const customer = {
    id:session.nextCustomerId,
    artId:`customer-${((session.nextCustomerId - 1) % CUSTOMER_ART_COUNT) + 1}`,
    order:orderResult.order,
    remaining:orderResult.order,
    arrivedAt:nowMs,
    patienceMs,
    expiresAt:nowMs + patienceMs,
  };
  const arrivalRoll = nextRandom(orderResult.seed);
  const jitter = ARRIVAL_JITTER_BASE + arrivalRoll.value * ARRIVAL_JITTER_RANGE;
  return {
    ...session,
    customers:[...session.customers, customer],
    nextCustomerId:session.nextCustomerId + 1,
    nextArrivalAt:nowMs + level.arrivalMs * jitter,
    seed:arrivalRoll.seed,
  };
};

const advanceHeatSlot = (slot, nowMs, readyWindowMs, isBoostActive) => {
  if (slot.state === "empty" || slot.state === "burnt") return slot;
  if (slot.state === "raw" && nowMs < slot.cookingAt) return slot;
  const burnAt = slot.burnAt || slot.readyAt + readyWindowMs;
  if (!isBoostActive && nowMs >= burnAt) return {...slot, state:"burnt", burnAt};
  if (slot.state === "raw" && !isBoostActive && nowMs < slot.readyAt) return {...slot, state:"cooking", burnAt};
  if (slot.state === "raw") {
    const readyAt = isBoostActive ? nowMs : slot.readyAt;
    return {...slot, state:"ready", readyAt, burnAt:isBoostActive ? readyAt + readyWindowMs : burnAt};
  }
  if (slot.state === "cooking" && !isBoostActive && nowMs < slot.readyAt) return slot;
  if (slot.state === "cooking") {
    const readyAt = isBoostActive ? nowMs : slot.readyAt;
    return {...slot, state:"ready", readyAt, burnAt:isBoostActive ? readyAt + readyWindowMs : burnAt};
  }
  if (slot.state === "ready" && nowMs >= slot.burnAt) return {...slot, state:"burnt"};
  return slot;
};

const advanceStations = (state, session, nowMs) => {
  const guardMs = TIMING.grillReadyMs + upgradeLevel(state, "kit", "burnGuard") * TIMING.grillGuardStepMs;
  const isBoostActive = nowMs < session.boostUntil;
  const grill = session.grill.map((slot) => advanceHeatSlot(slot, nowMs, guardMs, isBoostActive));
  const fryer = session.fryer.map((slot) => advanceHeatSlot(slot, nowMs, TIMING.fryerReadyMs, isBoostActive));
  const drinks = session.drinks.map((slot) => {
    if (slot.state !== "filling" || (!isBoostActive && nowMs < slot.readyAt)) return slot;
    return {...slot, state:"ready"};
  });
  return {...session, grill, fryer, drinks};
};

const removeWalkouts = (session, nowMs) => {
  const customers = session.customers.filter((customer) => customer.expiresAt > nowMs);
  return {...session, customers, walkouts:session.walkouts + session.customers.length - customers.length};
};

const trayCapacity = (state) => kitchenValue(state, "traySlots");

const remainingPatience = (customer, nowMs) => (
  Math.max(0, customer.expiresAt - nowMs) / customer.patienceMs
);

const serveTrayInternal = (state, itemIndex, nowMs) => {
  const session = state.session;
  const item = session?.tray[itemIndex];
  if (!item) return state;
  const customerIndex = session.customers.findIndex((customer) => customer.remaining.includes(item.id));
  if (customerIndex < 0) return state;
  const customer = session.customers[customerIndex];
  const wantedIndex = customer.remaining.indexOf(item.id);
  const remaining = customer.remaining.filter((_, index) => index !== wantedIndex);
  const isComplete = remaining.length === 0;
  const isCombo = isComplete && session.lastCompletedAt !== null && nowMs - session.lastCompletedAt <= GAME_LIMITS.comboWindowMs;
  const combo = isComplete ? (isCombo ? Math.min(GAME_LIMITS.maxCombo, session.combo + 1) : 1) : session.combo;
  const tipRate = BASE_TIP_RATE + remainingPatience(customer, nowMs) * PATIENCE_TIP_RATE + interiorBonus(state, "tip");
  const saleValue = Math.round((ITEMS[item.id]?.value || 0) * (1 + tipRate) * combo);
  const nextCustomer = {...customer, remaining};
  const customers = isComplete
    ? session.customers.filter((_, index) => index !== customerIndex)
    : session.customers.map((entry, index) => index === customerIndex ? nextCustomer : entry);
  const tray = session.tray.filter((_, index) => index !== itemIndex);
  return {
    ...state,
    coins:state.coins + saleValue,
    lifetimeCoins:state.lifetimeCoins + saleValue,
    session:{
      ...session,
      tray,
      customers,
      combo,
      lastCompletedAt:isComplete ? nowMs : session.lastCompletedAt,
      earnedCoins:session.earnedCoins + saleValue,
    },
  };
};

const runHelper = (state, nowMs) => {
  const helperLevel = upgradeLevel(state, "prem", "helper");
  const session = state.session;
  if (!helperLevel || session.nextHelperAt === null || nowMs < session.nextHelperAt) return state;
  const matchIndex = session.tray.findIndex((item) => session.customers.some((customer) => customer.remaining.includes(item.id)));
  const interval = Math.max(MINIMUM_HELPER_INTERVAL_MS, TIMING.helperIntervalMs - (helperLevel - 1) * TIMING.helperStepMs);
  const scheduled = {...state, session:{...session, nextHelperAt:nowMs + interval}};
  return matchIndex < 0 ? scheduled : serveTrayInternal(scheduled, matchIndex, nowMs);
};

export function tick(state, nowMs = performance.now()) {
  if (state.screen !== "playing" || state.session?.status !== "playing") return state;
  const remainingMs = Math.max(0, state.session.endsAt - nowMs);
  let session = {...advanceStations(state, state.session, nowMs), remainingMs};
  session = removeWalkouts(session, nowMs);
  if (remainingMs > 0) session = addCustomer(state, session, nowMs);
  let nextState = {...state, session};
  nextState = runHelper(nextState, nowMs);
  if (remainingMs > 0) return nextState;
  return finishDay({...nextState, session:{...nextState.session, status:"ended"}});
}

const starRating = (earnedCoins, goal, walkouts) => {
  if (earnedCoins < goal) return 0;
  if (earnedCoins >= goal * THREE_STAR_FACTOR && walkouts === 0) return 3;
  if (earnedCoins >= goal * TWO_STAR_FACTOR) return 2;
  return 1;
};

export function finishDay(state) {
  if (!state.session || state.session.result) return state;
  const level = getLevel(state);
  const rating = starRating(state.session.earnedCoins, level.goal, state.session.walkouts);
  const hasPassed = rating > 0;
  const nextDay = hasPassed ? Math.min(GAME_LIMITS.maxDay, state.day + 1) : state.day;
  const result = {rating, hasPassed, goal:level.goal, earnedCoins:state.session.earnedCoins, walkouts:state.session.walkouts};
  return {
    ...state,
    day:nextDay,
    stars:state.stars + (rating === 3 ? 1 : 0),
    screen:"summary",
    session:{...state.session, status:"ended", remainingMs:0, result},
  };
}

const heatDuration = (baseMs, stepMs, minimumMs, level) => Math.max(minimumMs, baseMs - level * stepMs);
const startHeatItem = (slots, index, nowMs, cookMs, itemId) => slots.map((slot, slotIndex) => {
  if (slotIndex !== index || slot.state !== "empty") return slot;
  return {id:slot.id, itemId, state:"raw", cookingAt:nowMs + TIMING.rawStageMs, readyAt:nowMs + TIMING.rawStageMs + cookMs};
});

export function tapGrill(state, index, nowMs = performance.now()) {
  if (state.session?.status !== "playing") return state;
  const slot = state.session.grill[index];
  if (!slot) return state;
  if (slot.state === "burnt") {
    const grill = state.session.grill.map((entry, slotIndex) => slotIndex === index ? emptySlot(entry.id) : entry);
    return {...state, session:{...state.session, grill}};
  }
  if (slot.state === "ready") {
    if (state.session.assembly.patties >= MAX_ASSEMBLY_PATTIES) return state;
    const grill = state.session.grill.map((entry, slotIndex) => slotIndex === index ? emptySlot(entry.id) : entry);
    const assembly = {...state.session.assembly, patties:state.session.assembly.patties + 1};
    return {...state, session:{...state.session, grill, assembly}};
  }
  const cookMs = heatDuration(TIMING.grillCookMs, TIMING.grillSpeedStepMs, TIMING.grillMinimumMs, upgradeLevel(state, "kit", "grillSpeed"));
  const grill = startHeatItem(state.session.grill, index, nowMs, cookMs, "patty");
  return {...state, session:{...state.session, grill}};
}

export function tapFryer(state, index, nowMs = performance.now()) {
  if (state.session?.status !== "playing") return state;
  const slot = state.session.fryer[index];
  if (!slot || state.day < UNLOCKS.fries) return state;
  if (slot.state === "burnt") {
    const fryer = state.session.fryer.map((entry, slotIndex) => slotIndex === index ? emptySlot(entry.id) : entry);
    return {...state, session:{...state.session, fryer}};
  }
  if (slot.state === "ready") return collectReadyItem(state, "fryer", index, "fries");
  const cookMs = heatDuration(TIMING.fryerCookMs, TIMING.fryerSpeedStepMs, TIMING.fryerMinimumMs, upgradeLevel(state, "kit", "fryerSpeed"));
  const fryer = startHeatItem(state.session.fryer, index, nowMs, cookMs, "fries");
  return {...state, session:{...state.session, fryer}};
}

export function tapDrink(state, index, itemId, nowMs = performance.now()) {
  if (state.session?.status !== "playing" || !isItemUnlocked(state.day, itemId)) return state;
  const slot = state.session.drinks[index];
  if (!slot) return state;
  if (slot.state === "ready") return collectReadyItem(state, "drinks", index, slot.itemId);
  if (slot.state !== "empty") return state;
  const fillMs = heatDuration(TIMING.drinkFillMs, TIMING.drinkSpeedStepMs, TIMING.drinkMinimumMs, upgradeLevel(state, "kit", "drinkTaps"));
  const drinks = state.session.drinks.map((entry, slotIndex) => slotIndex === index
    ? {id:entry.id, itemId, state:"filling", readyAt:nowMs + fillMs}
    : entry);
  return {...state, session:{...state.session, drinks}};
}

const collectReadyItem = (state, station, index, itemId) => {
  if (state.session.tray.length >= trayCapacity(state)) return state;
  const slots = state.session[station].map((entry, slotIndex) => slotIndex === index ? emptySlot(entry.id) : entry);
  const tray = [...state.session.tray, {id:itemId, key:`${itemId}-${state.session.startedAt}-${index}-${state.session.tray.length}`}];
  return {...state, session:{...state.session, [station]:slots, tray}};
};

export function toggleTopping(state, topping) {
  if (state.session?.status !== "playing" || state.day < (UNLOCKS[topping] || Infinity)) return state;
  const toppings = state.session.assembly.toppings.includes(topping)
    ? state.session.assembly.toppings.filter((entry) => entry !== topping)
    : [...state.session.assembly.toppings, topping];
  return {...state, session:{...state.session, assembly:{...state.session.assembly, toppings}}};
}

const sameToppings = (left, right) => (
  left.length === right.length && [...left].sort().every((entry, index) => entry === [...right].sort()[index])
);

export function plateBurger(state) {
  if (state.session?.status !== "playing" || state.session.tray.length >= trayCapacity(state)) return state;
  const assembly = state.session.assembly;
  const recipe = RECIPES.find((entry) => entry.day <= state.day && entry.patties === assembly.patties && sameToppings(entry.toppings, assembly.toppings));
  if (!recipe) return state;
  const tray = [...state.session.tray, {id:recipe.id, key:`${recipe.id}-${state.session.startedAt}-${state.session.tray.length}`}];
  return {...state, session:{...state.session, assembly:{...EMPTY_ASSEMBLY}, tray}};
}

export const serveTray = (state, itemIndex, nowMs = performance.now()) => serveTrayInternal(state, itemIndex, nowMs);

export function activateBoost(state, nowMs = performance.now()) {
  const level = upgradeLevel(state, "prem", "instant");
  if (!level || state.session?.status !== "playing" || nowMs < state.session.boostReadyAt) return state;
  const durationMs = TIMING.boostDurationMs + (level - 1) * BOOST_LEVEL_STEP_MS;
  const boostUntil = nowMs + durationMs;
  const grill = state.session.grill.map((slot) => slot.state === "raw" || slot.state === "cooking"
    ? {...slot, state:"ready", readyAt:nowMs, burnAt:nowMs + TIMING.grillReadyMs}
    : slot);
  const fryer = state.session.fryer.map((slot) => slot.state === "raw" || slot.state === "cooking"
    ? {...slot, state:"ready", readyAt:nowMs, burnAt:nowMs + TIMING.fryerReadyMs}
    : slot);
  const drinks = state.session.drinks.map((slot) => slot.state === "filling" ? {...slot, state:"ready"} : slot);
  const session = {...state.session, grill, fryer, drinks, boostUntil, boostReadyAt:nowMs + TIMING.boostCooldownMs};
  return {...state, session};
}

export const isItemUnlocked = (day, itemId) => {
  if (RECIPES.some((recipe) => recipe.id === itemId && recipe.day <= day)) return true;
  return day >= (UNLOCKS[itemId] || Infinity);
};

export function buyUpgrade(state, category, id) {
  if (state.screen === "playing") return state;
  const tables = {kit:KITCHEN_UPGRADES, int:INTERIOR_UPGRADES, prem:PREMIUM_UPGRADES};
  const upgrade = tables[category]?.find((entry) => entry.id === id);
  if (!upgrade) return state;
  const level = upgradeLevel(state, category, id);
  if (level >= upgrade.max) return state;
  const cost = upgrade.costs[level];
  const currency = category === "prem" ? "stars" : "coins";
  if (!Number.isFinite(cost) || state[currency] < cost) return state;
  return {
    ...state,
    [currency]:state[currency] - cost,
    [category]:{...state[category], [id]:level + 1},
  };
}

export const stationCapacity = (state, id) => kitchenValue(state, id);
export const getInteriorBonus = (state) => ({
  patience:interiorBonus(state, "patience"),
  tip:interiorBonus(state, "tip"),
});
