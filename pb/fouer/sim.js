// Schueberfouer Tycoon economy and commands (DESIGN.md sections 2 and 6). DOM-free and clock-free: every function
// takes the instant it needs and returns NEW objects, never mutating its inputs.
// Commands return { ok: true, state, ... } or { ok: false, reason } (reason ids have lb/de/en texts in i18n.js).
import { RULES, ECONOMY, STAR_POINTS, LEVELS, ITEMS, ITEM_BY_ID, PITCHES, PITCH_COUNT, CASH_CAP, SAVE_VERSION,
  STAMPS_FOR_STATUE, sizeFits } from "./data.js";

export const NEUTRAL_CONTEXT = Object.freeze({ guests: 1, price: 1, uses: 1, cap: 1, bonus: 1, zones: Object.freeze({}) });

// Offline maths mirrors IdleExtras (pb/idle-extras.js); harness.js checks both against the original.
const HOUR = 3600;
const AWAY_BASE_RATE = 0.25, AWAY_STAR_RATE = 0.0375, ACTIVE_MS = 15 * 60 * 1000;
const BASE_CAP_HOURS = 8, CAP_HOURS_PER_STAR = 0.25, MAX_CAP_HOURS = 12;
const FIREWORKS_GIFT_SECONDS = 900;       // 6: one-time gift of 15 minutes of current income
/** Hämmi's daily present (W7): tap the sheep once per Luxembourg calendar day; 3 minutes of current income, never less than 25, in steps of 5. */
export const HAEMMI_GIFT = Object.freeze({ minutes: 3, min: 25, step: 5 });
const STARTER_FLAG = "g";
const FREE = 1, HALF = 2, DOUBLE = 4;     // pitch flags: how the attraction was paid
const QUEUE_FIGURES_MIN = 5, QUEUE_FIGURES_MAX = 15, QUEUE_PROBLEM_SHARE = 0.15;
const TIP_NONE = null;

const refuse = reason => ({ ok: false, reason });
const clampMoney = value => Math.max(0, Math.min(CASH_CAP, value));
const hasBit = (mask, index) => Math.floor(mask / 2 ** index) % 2 === 1;
const setBit = (mask, index) => hasBit(mask, index) ? mask : mask + 2 ** index;

export function cleanName(text) {
  const plain = String(text ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
  return Array.from(plain).slice(0, RULES.nameLength).join("").trim();
}

export function createState({ name = "", now = 0 } = {}) {
  return { v: SAVE_VERSION, tb: 0, c: RULES.startCash, t: Math.max(0, Math.floor(now / 1000)),
    pitches: Array(PITCH_COUNT).fill(null), pu: 0, rb: 0, pi: 0, mg: 0, vo: [], lg: "",
    st: {}, gi: [], n: cleanName(name), tu: 0, ea: "", fw: 0, hd: 0 };
}

export const makeEntry = (k, lv = 0, look = 0, fl = 0) => ({ k, lv, look, fl });
const withPitches = (state, changes) => {
  const pitches = [...state.pitches];
  for (const [index, entry] of changes) pitches[index] = entry;
  return { ...state, pitches };
};
const spend = (state, amount) => ({ ...state, c: clampMoney(state.c - amount) });

// ---- rating, stars, economy ----

export function starsFor(points) {
  return STAR_POINTS.reduce((stars, need, index) => points >= need ? index + 1 : stars, 1);
}

export function ratingPoints(state) {
  return state.pitches.reduce((sum, entry) => {
    if (!entry) return sum;
    return sum + ITEM_BY_ID[entry.k].appeal * LEVELS[entry.lv].appeal;
  }, state.rb);
}

export const stars = state => starsFor(ratingPoints(state));

/** Income model: a fluid model, guests are decoration. `ctx` carries event multipliers only (never weather or time of day). */
export function economy(state, ctx = NEUTRAL_CONTEXT) {
  const context = { ...NEUTRAL_CONTEXT, ...ctx };
  const rows = [];
  const weightByCategory = {};
  let points = state.rb;
  state.pitches.forEach((entry, pitch) => {
    if (!entry) return;
    const item = ITEM_BY_ID[entry.k], level = LEVELS[entry.lv];
    points += item.appeal * level.appeal;
    // Demand is split by base appeal only: upgrading one stall can then never pull guests away from a dearer neighbour.
    if (item.cap > 0 && item.price > 0 && item.appeal > 0) {
      rows.push({ pitch, id: item.id, item, level, weight: item.appeal });
      weightByCategory[item.cat] = (weightByCategory[item.cat] ?? 0) + item.appeal;
    }
  });
  const starCount = starsFor(points);
  const lambda = (ECONOMY.guestsBase + ECONOMY.guestsPerPoint * points ** ECONOMY.guestsExponent
    + ECONOMY.guestsPerStar * starCount) * context.guests;
  const usesPerMin = lambda * ECONOMY.usesPerGuest * context.uses;
  let incomePerMin = 0;
  const perPitch = rows.map(row => {
    const demand = usesPerMin * ECONOMY.share[row.item.cat] * row.weight / weightByCategory[row.item.cat];
    const cap = row.item.cap * row.level.cap * context.cap;
    const served = Math.min(demand, cap);
    const zoneBonus = context.zones[PITCHES[row.pitch].zone] ?? 1;
    const income = served * row.item.price * row.level.price * context.price * zoneBonus * context.bonus;
    const queue = Math.max(0, demand - cap);
    const queueShare = cap > 0 ? queue / cap : 0;
    incomePerMin += income;
    return { pitch: row.pitch, id: row.id, demand, cap, served, income, queue,
      queueFigures: queue > 0 ? Math.round(QUEUE_FIGURES_MIN + (QUEUE_FIGURES_MAX - QUEUE_FIGURES_MIN) * Math.min(1, queueShare)) : 0,
      problem: queueShare >= QUEUE_PROBLEM_SHARE };
  });
  return { points, stars: starCount, lambda, usesPerMin, perPitch, incomePerMin, incomePerSec: incomePerMin / 60,
    nextStarPoints: STAR_POINTS[starCount] ?? null };
}

// ---- pitches, availability, prices ----

export const pitchOpen = (state, index, starCount = stars(state)) =>
  Number.isInteger(index) && index >= 0 && index < PITCH_COUNT && (PITCHES[index].star <= starCount || hasBit(state.pu, index));
export const copiesOf = (state, itemId) => state.pitches.filter(entry => entry?.k === itemId).length;
export const maxStamps = state => Math.max(0, ...Object.values(state.st).map(popcount));
export const starterGiftAvailable = state => !state.ea.includes(STARTER_FLAG);

export function itemUnlocked(state, item, starCount = stars(state)) {
  if (item.special === "pioneer") return state.pi === 1;
  if (item.special === "stamps") return maxStamps(state) >= STAMPS_FOR_STATUE;
  return item.star <= starCount;
}

/** What the next copy of an item costs right now, and which pitch flag records it. */
export function buildQuote(state, itemId) {
  const item = ITEM_BY_ID[itemId];
  if (!item) return null;
  if (itemId === "kachel" && starterGiftAvailable(state)) return { cost: 0, fl: FREE, gift: true };
  const double = copiesOf(state, itemId) >= 2;
  return { cost: item.cost * (double ? RULES.thirdCopyCostMultiplier : 1), fl: double ? DOUBLE : 0, gift: false };
}

export const paidFor = entry => {
  const item = ITEM_BY_ID[entry.k];
  if (entry.fl & FREE) return 0;
  if (entry.fl & HALF) return item.cost * RULES.voucherDiscount;
  return item.cost * (entry.fl & DOUBLE ? RULES.thirdCopyCostMultiplier : 1);
};
export const refundFor = entry => Math.floor(paidFor(entry) * RULES.refundFraction);

export function upgradeCost(state, index) {
  const entry = state.pitches[index];
  if (!entry) return null;
  const item = ITEM_BY_ID[entry.k];
  if (entry.lv >= RULES.maxLevel || item.upgradeBase <= 0) return null;
  return Math.round(item.upgradeBase * RULES.upgradeFractions[entry.lv]);
}

export function freePitchFor(state, item, starCount = stars(state)) {
  let best = -1;
  PITCHES.forEach((pitch, index) => {
    if (state.pitches[index] || !pitchOpen(state, index, starCount) || !sizeFits(item.size, pitch.size)) return;
    if (best < 0 || sizeRank(pitch.size) < sizeRank(PITCHES[best].size)) best = index;
  });
  return best;
}
const sizeRank = size => ["S", "M", "L", "XL", "W"].indexOf(size);

function checkPlacement(state, index, item, look, ignoreLocks) {
  if (!Number.isInteger(index) || index < 0 || index >= PITCH_COUNT) return refuse("no-pitch");
  if (!item) return refuse("unknown-item");
  if (!Number.isInteger(look) || look < 0 || look >= RULES.lookCount) return refuse("bad-look");
  if (state.pitches[index]) return refuse("occupied");
  if (!sizeFits(item.size, PITCHES[index].size)) return refuse("wrong-size");
  if (copiesOf(state, item.id) >= item.max) return refuse("max-copies");
  if (!ignoreLocks) {
    const starCount = stars(state);
    if (!pitchOpen(state, index, starCount)) return refuse("pitch-locked");
    if (!itemUnlocked(state, item, starCount)) return refuse("item-locked");
  }
  return null;
}

// ---- commands ----

export function build(state, index, itemId, look = 0) {
  const item = ITEM_BY_ID[itemId];
  const problem = checkPlacement(state, index, item, look, false);
  if (problem) return problem;
  const quote = buildQuote(state, itemId);
  if (state.c < quote.cost) return refuse("unaffordable");
  const spent = withPitches(spend(state, quote.cost), [[index, makeEntry(itemId, 0, look, quote.fl)]]);
  return { ok: true, state: quote.gift ? { ...spent, ea: spent.ea + STARTER_FLAG } : spent, cost: quote.cost };
}

export function upgrade(state, index) {
  const entry = state.pitches[index];
  if (!entry) return refuse("empty");
  const cost = upgradeCost(state, index);
  if (cost === null) return refuse("maxed");
  if (state.c < cost) return refuse("unaffordable");
  return { ok: true, state: withPitches(spend(state, cost), [[index, { ...entry, lv: entry.lv + 1 }]]), cost };
}

export function setLook(state, index, look) {
  const entry = state.pitches[index];
  if (!entry) return refuse("empty");
  if (!Number.isInteger(look) || look < 0 || look >= RULES.lookCount) return refuse("bad-look");
  return { ok: true, state: withPitches(state, [[index, { ...entry, look }]]) };
}

/** Replace an attraction: half of what was paid comes back, upgrades are lost. The pitch must already be usable. */
export function replace(state, index, itemId, look = 0) {
  const entry = state.pitches[index];
  if (!entry) return refuse("empty");
  const refund = refundFor(entry);
  const cleared = withPitches({ ...state, c: clampMoney(state.c + refund) }, [[index, null]]);
  const result = build(cleared, index, itemId, look);
  return result.ok ? { ...result, refund } : result;
}

/** Spend a pioneer voucher: free up to the free-cost limit, otherwise half price; it may open one locked pitch. */
export function useVoucher(state, itemId, index, look = 0) {
  const slot = state.vo.indexOf(itemId);
  if (slot < 0) return refuse("no-voucher");
  const item = ITEM_BY_ID[itemId];
  const problem = checkPlacement(state, index, item, look, true);
  if (problem) return problem;
  const free = item.cost <= RULES.voucherFreeMaxCost;
  const cost = free ? 0 : Math.round(item.cost * RULES.voucherDiscount);
  if (state.c < cost) return refuse("unaffordable");
  const next = withPitches(spend(state, cost), [[index, makeEntry(itemId, 0, look, free ? FREE : HALF)]]);
  return { ok: true, cost, state: { ...next, pu: pitchOpen(state, index) ? next.pu : setBit(next.pu, index),
    vo: state.vo.filter((_, position) => position !== slot) } };
}

// ---- time ----

export function touch(state, nowMs) {
  return { ...state, t: Math.max(0, Math.floor(nowMs / 1000)) };
}

/** Earn `dtSec` of live income. Throws on a negative or non-finite step (a bug in the caller). */
export function tick(state, dtSec, ctx = NEUTRAL_CONTEXT) {
  if (!Number.isFinite(dtSec) || dtSec < 0) throw new RangeError(`tick needs a finite dt >= 0, got ${dtSec}`);
  return earn(state, economy(state, ctx).incomePerSec * dtSec);
}

export function earn(state, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return state;
  return { ...state, c: clampMoney(state.c + amount), tb: clampMoney(state.tb + amount) };
}

export const awayRate = (starCount, period = false) =>
  Math.min(1, AWAY_BASE_RATE + AWAY_STAR_RATE * starCount + (period ? 0.1 : 0));
export const capHoursFor = (starCount, period = false) =>
  Math.min(MAX_CAP_HOURS, BASE_CAP_HOURS + CAP_HOURS_PER_STAR * starCount) + (period ? 2 : 0);

/** Passive production factor of an open but untouched tab: 1 while playing, the away rate after 15 min, 0 after the cap. */
export function activityRate(starCount, idleMs, period = false) {
  if (idleMs < ACTIVE_MS) return 1;
  if (idleMs > capHoursFor(starCount, period) * HOUR * 1000) return 0;
  return awayRate(starCount, period);
}

/** Credit for the time since the last save (state.t). `ctx` is the live multiplier set; `period` the Fouer bonus (6). */
export function offline(state, nowMs, { ctx = NEUTRAL_CONTEXT, period = false } = {}) {
  const nowSec = Math.floor(nowMs / 1000);
  const info = economy(state, ctx);
  const capHours = capHoursFor(info.stars, period);
  const rate = awayRate(info.stars, period);
  const seconds = state.t > 0 ? Math.min(capHours * HOUR, Math.max(0, nowSec - state.t)) : 0;
  const credited = seconds * info.incomePerSec * rate;
  return { state: { ...earn(state, credited), t: Math.max(state.t, nowSec) }, seconds, capHours, rate, credited, incomePerMin: info.incomePerMin };
}

// ---- gifts, stamps, event rewards ----

/** Admin gift: cash only (never tb or stars), idempotent through the last 50 ids. */
export function applyGift(state, id, amount) {
  if (!Number.isSafeInteger(id) || id < 1 || typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return { applied: false, state };
  }
  if (state.gi.includes(id)) return { applied: false, state };
  return { applied: true, state: { ...state, c: clampMoney(state.c + amount), gi: [...state.gi, id].slice(-RULES.giftIdsKept) } };
}

export const popcount = mask => { let count = 0, rest = mask; while (rest > 0) { count += rest % 2; rest = Math.floor(rest / 2); } return count; };
export const stampCount = (state, year) => popcount(state.st[year] ?? 0);

/** One stamp per Luxembourg day the game is opened during the 20 fair days (events from calendar.eventsAt). */
export function stampToday(state, events) {
  if (!events.stamp.canStamp) return state;
  const year = events.fair.year, day = events.stamp.today;
  const mask = state.st[year] ?? 0;
  return hasBit(mask, day) ? state : { ...state, st: { ...state.st, [year]: setBit(mask, day) } };
}

export function stampRewards(state, year) {
  const count = stampCount(state, year);
  return { count, bulbs: count >= 5, statue: count >= STAMPS_FOR_STATUE, booth: count >= 15, crown: count >= 20 };
}

/** Closing-night gift: 15 minutes of current income, once per edition, claimable until a week after the last day. */
export function claimFireworks(state, events) {
  if (!events.fireworks.claimable) return refuse("not-claimable");
  const year = events.fair.year;
  if (state.fw === year) return refuse("already-claimed");
  const amount = Math.floor(economy(state).incomePerSec * FIREWORKS_GIFT_SECONDS);
  return { ok: true, amount, state: { ...state, c: clampMoney(state.c + amount), fw: year } };
}

/** Is Hämmi's present waiting today? `events.now.dayNumber` is the Luxembourg calendar day; `hd` the day of the last present (0 = never). */
export const haemmiGiftReady = (state, events) => state.hd < events.now.dayNumber;

/** The present's size: HAEMMI_GIFT.minutes of the current income (neutral event context, like the closing-night gift), at least HAEMMI_GIFT.min. */
export function haemmiGiftAmount(state) {
  const raw = economy(state).incomePerMin * HAEMMI_GIFT.minutes;
  return Math.max(HAEMMI_GIFT.min, Math.round(raw / HAEMMI_GIFT.step) * HAEMMI_GIFT.step);
}

/** Once per Luxembourg day: cash only (tb, stars and rating are untouched). Returns { ok, amount, state } or { ok: false, reason: "already-today" }. */
export function claimHaemmiGift(state, events) {
  if (!haemmiGiftReady(state, events)) return refuse("already-today");
  const amount = haemmiGiftAmount(state);
  return { ok: true, amount, state: { ...state, c: clampMoney(state.c + amount), hd: events.now.dayNumber } };
}

// ---- actions, tips and the goal card ----

/** Every build / upgrade / replace the player could make, with the income and rating each one buys. */
export function listActions(state, ctx = NEUTRAL_CONTEXT, { replacements = false } = {}) {
  const base = economy(state, ctx);
  const starCount = base.stars;
  const actions = [];
  const consider = (type, pitch, itemId, cost, net, next) => {
    const after = economy(next, ctx);
    actions.push({ type, pitch, item: itemId, cost, net, affordable: state.c >= net,
      dIncome: after.incomePerMin - base.incomePerMin, dPoints: after.points - base.points });
  };
  for (const item of ITEMS) {
    if (!itemUnlocked(state, item, starCount) || copiesOf(state, item.id) >= item.max) continue;
    const pitch = freePitchFor(state, item, starCount);
    if (pitch < 0) continue;
    const quote = buildQuote(state, item.id);
    consider("build", pitch, item.id, quote.cost, quote.cost, withPitches(state, [[pitch, makeEntry(item.id, 0, 0, quote.fl)]]));
  }
  state.pitches.forEach((entry, pitch) => {
    if (!entry) return;
    const cost = upgradeCost(state, pitch);
    if (cost !== null) consider("upgrade", pitch, entry.k, cost, cost, withPitches(state, [[pitch, { ...entry, lv: entry.lv + 1 }]]));
    if (!replacements) return;
    const refund = refundFor(entry);
    const cleared = withPitches(state, [[pitch, null]]);
    for (const item of ITEMS) {
      if (item.id === entry.k || item.special || !itemUnlocked(state, item, starCount) || !sizeFits(item.size, PITCHES[pitch].size)) continue;
      if (copiesOf(cleared, item.id) >= item.max) continue;
      const quote = buildQuote(cleared, item.id);
      consider("replace", pitch, item.id, quote.cost, quote.cost - refund, withPitches(cleared, [[pitch, makeEntry(item.id, 0, 0, quote.fl)]]));
    }
  });
  return actions;
}

/** The best way towards the next star: most rating per euro among what is affordable now (cheapest gain otherwise).
 * Moves that lower income are only suggested when nothing else adds rating; swaps only when no plain build or upgrade does. */
export function tipFor(state, ctx = NEUTRAL_CONTEXT) {
  let gains = listActions(state, ctx).filter(action => action.dPoints > 0);
  if (!gains.length) gains = listActions(state, ctx, { replacements: true }).filter(action => action.dPoints > 0);
  if (!gains.length) return TIP_NONE;
  const safe = gains.filter(action => action.dIncome >= 0);
  const pool = safe.length ? safe : gains;
  const affordable = pool.filter(action => action.affordable);
  if (affordable.length) return affordable.reduce((best, action) => action.dPoints / (action.net + 1) > best.dPoints / (best.net + 1) ? action : best);
  return pool.reduce((best, action) => action.net < best.net ? action : best);
}

/** The single goal shown on the goal card. Ids map to goal.* texts in i18n.js. */
export function nextGoal(state, ctx = NEUTRAL_CONTEXT) {
  const info = economy(state, ctx);
  if (!state.pitches.some(Boolean)) return { id: "firstBuild", progress: 0 };
  if (state.vo.length) return { id: "voucher", item: state.vo[0], count: state.vo.length };
  if (info.stars < STAR_POINTS.length) {
    const need = STAR_POINTS[info.stars], previous = STAR_POINTS[info.stars - 1];
    return { id: "star", stars: info.stars + 1, points: Math.max(0, Math.ceil(need - info.points)), have: info.points, need,
      progress: Math.max(0, Math.min(1, (info.points - previous) / (need - previous))), tip: tipFor(state, ctx) };
  }
  // Star 5: the best purchase that still raises income, per euro of net cost.
  const moves = listActions(state, ctx, { replacements: true }).filter(action => action.dIncome > 0);
  if (!moves.length) return { id: "maxed" };
  const best = moves.reduce((top, action) => action.dIncome / (action.net + 1) > top.dIncome / (top.net + 1) ? action : top);
  const id = best.type === "build" ? "fill" : best.type === "replace" ? "replace"
    : state.pitches[best.pitch].lv + 1 === RULES.maxLevel ? "gold" : "upgrade";
  return { id, pitch: best.pitch, item: best.item, cost: best.net };
}

/** Numbers for the gallery row: value = tb, guests = built pitches, rating = stars x 100 + points / 10 (7.6). */
export function gallerySummary(state) {
  const info = economy(state);
  return { value: Math.floor(state.tb), guests: state.pitches.filter(Boolean).length,
    rating: info.stars * 100 + Math.floor(info.points / 10) };
}
