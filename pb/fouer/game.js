// Schueberfouer Tycoon W5: the game controller. DOM-free apart from the window/storage objects it is handed, so
// scripts and Node tests can drive it. It owns the one mutable `state` (always replaced, never mutated), the wall-clock
// tick, events, offline credit, the onboarding steps, persistence and the arcade hand-off. The UI and the scene only
// read from it and call its commands.
import { RULES, ITEMS, ITEM_BY_ID, PITCHES, PITCH_COUNT, STAR_POINTS, sizeFits } from "./data.js";
import * as sim from "./sim.js";
import { eventsAt, economyContext, bannersAt } from "./calendar.js";
import { resolveStartup, migrate, backupV1 } from "./legacy.js";
import { createPersistence, browserEnv, classifyRaw, decodeSave, isNewer, serializeSave, BACKUP_KEY } from "./save.js";

export const SAVE_KEY = "pb_save_park";
export const AWAY_GAP_SECONDS = 45;             // a longer gap between two updates is time away, not play
export const OFFLINE_CARD_MIN_SECONDS = 60;
export const AUTOSAVE_MS = 5000;
const TICK_INTERVAL = 0.25;
const TEST_CASH = 5e7;
const TEST_RATING = 1000;
const ALL_PITCHES_MASK = 2 ** PITCH_COUNT - 1;
const FIRST_COIN_SECONDS = 3.2;                  // the "guests pay" bubble stays this long, then step 4 starts

/** "Foodie" (W6, DESIGN 5): eating at a food stall in the walk gives x1.05 income for 3 minutes, once per distinct food per session, at most 3 stacked.
 * It rides on the economy's own `bonus` multiplier (sim.economy already multiplies income by ctx.bonus), so sim.js is untouched. */
export const FOODIE = Object.freeze({ perFood: 1.05, seconds: 180, maxStacks: 3 });
export const foodieMultiplier = stacks => FOODIE.perFood ** Math.max(0, Math.min(FOODIE.maxStacks, Math.floor(stacks)));
const withBonus = (base, mult) => mult === 1 ? base : { ...base, bonus: base.bonus * mult };
/** "Spaass" (Rides wave): a ride in the walk gives a tiny x1.03 income for 2 minutes (one buff at a time, riding again only refreshes it). Same `bonus` mechanism as Foodie. */
export const FUN = Object.freeze({ perRide: 1.03, seconds: 120 });
/** the save flags in `ea`: single [a-z0-9] letters, one per achievement / trial (g starter gift, r Riserad, p Probefahrt, one per ride since the Rides wave) */
export const FLAGS_MAX = 32;

export const TUTORIAL = Object.freeze({
  firstBuild: 1,        // steps 1 + 2 of DESIGN 1: tap the glowing pitch, tap "Build"
  coin: 3,              // step 3: first coin
  secondBuild: 4,       // step 4
  upgrade: 5,           // step 5
  goal: 6,              // step 6
  walk: 7,              // step 7
  done: RULES.tutorialDone,
});
// The two pitches the guided build uses (both are S pitches open at star 1, side by side on the main alley).
export const TUTORIAL_PITCHES = Object.freeze(["P01", "P02"]);
export const TUTORIAL_ITEMS = Object.freeze({ first: "kachel", second: "kanner" });

export const pitchIndex = id => PITCHES.findIndex(pitch => pitch.id === id);
const SIZE_RANK = { S: 0, M: 1, L: 2, XL: 3, W: 4 };
const hasBit = (mask, index) => Math.floor(mask / 2 ** index) % 2 === 1;

/** Test mode: every star, every pitch and every special unlocked, lots of cash. Returns a new state. */
export function unlockEverything(state, year = new Date().getFullYear()) {
  const fullStamps = { ...state.st, [year]: Math.max(state.st[year] ?? 0, 2 ** 20 - 1) };
  return { ...state, c: Math.max(state.c, TEST_CASH), rb: Math.max(state.rb, TEST_RATING), pu: ALL_PITCHES_MASK, pi: 1,
    tu: RULES.tutorialDone, st: fullStamps };
}

function readStorage(storage, key) {
  if (!storage) return null;
  try { return storage.getItem(key); } catch (error) { console.warn(`[fouer] could not read ${key}`, error.message); return null; }
}

/** Of several raw v2 saves keep the one with the highest lifetime value; non-v2 entries are skipped. */
function bestV2Raw(raws) {
  let best = null, bestState = null;
  for (const raw of raws) {
    const decoded = decodeSave(raw);
    if (decoded && (!bestState || isNewer(decoded, bestState))) { best = raw; bestState = decoded; }
  }
  return best;
}

export function createGame({ win = globalThis, storage = null, now = () => Date.now(), testMode = false, name = "", persist = true } = {}) {
  const listeners = new Map();
  const on = (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type).delete(fn); };
  const emit = (type, payload) => (listeners.get(type) ?? []).forEach(fn => {
    try { fn(payload); } catch (error) { console.error(`[fouer] ${type} listener failed`, error); }
  });

  let state = sim.createState({ name, now: now() });
  let events = eventsAt(now());
  let baseCtx = economyContext(events);
  let ctx = baseCtx;
  let foodieEntries = [];         // [{ item, until }] (wall clock ms): the active Foodie stacks
  let funUntil = 0;               // wall clock ms: the Spaass buff of the last ride
  const bonusMult = (at = now()) => foodieMultiplier(foodieEntries.length) * (funUntil > at ? FUN.perRide : 1);
  const eatenThisSession = new Set();
  let persistence = null;
  let ready = false;
  let wall = now();
  let acc = 0;
  let lastInput = now();
  let infoCache = null;
  let pendingOffline = null;      // { seconds, credited, capHours, rate, before, after } until the player closes the card
  let pendingLetter = null;       // { report, lg } until the player closes the letter
  let lastStars = 1;
  let coinTimer = null;           // seconds left of the "guests pay" bubble once the first coin arrived
  let saveClock = 0;
  let eventClock = 0;
  let mirrorTimer = null;
  const flags = { startedAt: now(), startup: null };

  const unlockedState = s => testMode ? unlockEverything(s, events.year) : s;

  // ---- derived data ----
  function info() {
    const key = state.pitches;
    if (!infoCache || infoCache.pitches !== key || infoCache.rb !== state.rb || infoCache.ctx !== ctx) {
      infoCache = { pitches: key, rb: state.rb, ctx, value: sim.economy(state, ctx) };
    }
    return infoCache.value;
  }
  const stars = () => info().stars;
  const entries = () => state.pitches.map((entry, index) => entry && { ...entry, index }).filter(Boolean);
  const builtCount = () => state.pitches.reduce((n, e) => n + (e ? 1 : 0), 0);

  function changed(kind, extra = {}) {
    infoCache = null;
    const nowStars = stars();
    const starUp = nowStars > lastStars;
    lastStars = nowStars;
    advanceTutorial();
    if (persist) { persistence?.scheduleSave(); scheduleMirror(); }
    emit("change", { kind, ...extra });
    if (starUp) emit("star", { stars: nowStars });
  }

  function setState(next, kind, extra) {
    state = next;
    changed(kind, extra);
  }

  // ---- pitch / card queries ----
  function pitchStatus(index) {
    const entry = state.pitches[index];
    if (entry) return "built";
    return sim.pitchOpen(state, index, stars()) ? "open" : "locked";
  }

  /** Vouchers can use any empty pitch of a fitting size, locked or not. */
  function voucherFits(index) {
    return !state.pitches[index] && state.vo.some(id => sizeFits(ITEM_BY_ID[id].size, PITCHES[index].size) && sim.copiesOf(state, id) < ITEM_BY_ID[id].max);
  }

  /** Can the player do something on this empty pitch? */
  function pitchUsable(index) {
    const status = pitchStatus(index);
    if (status === "built") return false;
    return status === "open" || voucherFits(index);
  }

  const baseIncome = () => info().incomePerMin;
  function gainOf(itemId, index, flag, onState = state) {
    const item = ITEM_BY_ID[itemId];
    const next = { ...onState, pitches: onState.pitches.map((entry, i) => i === index ? sim.makeEntry(itemId, 0, 0, flag) : entry) };
    const after = sim.economy(next, ctx);
    const before = onState === state ? info() : sim.economy(onState, ctx);
    return { dIncome: after.incomePerMin - before.incomePerMin, dPoints: after.points - before.points, appeal: item.appeal };
  }

  /** The cards of the build sheet for an empty pitch: what fits, is unlocked and copy-limited; vouchers first. */
  function buildOptions(index, base = state, cashOverride = null) {
    const cash = cashOverride ?? base.c;
    const starCount = sim.stars(base);
    const size = PITCHES[index].size;
    const out = [];
    for (const item of ITEMS) {
      if (!sizeFits(item.size, size) || sim.copiesOf(base, item.id) >= item.max) continue;
      const voucher = base.vo.includes(item.id);
      const unlocked = sim.itemUnlocked(base, item, starCount);
      if (!voucher && !unlocked) continue;
      if (!voucher && !sim.pitchOpen(base, index, starCount)) continue;
      const quote = sim.buildQuote(base, item.id);
      let cost = quote.cost, flag = quote.fl, mode = "build";
      if (voucher) {
        mode = "voucher";
        const free = item.cost <= RULES.voucherFreeMaxCost;
        cost = free ? 0 : Math.round(item.cost * RULES.voucherDiscount);
        flag = free ? 1 : 2;
      }
      const gain = gainOf(item.id, index, flag, base);
      out.push({ item, mode, cost, gift: quote.gift && mode === "build", affordable: cash >= cost, missing: Math.max(0, cost - cash),
        dIncome: gain.dIncome, dPoints: gain.dPoints, appeal: item.appeal });
    }
    out.sort((a, b) => (a.mode === "voucher" ? 0 : 1) - (b.mode === "voucher" ? 0 : 1) || a.cost - b.cost || a.item.idx - b.item.idx);
    const tip = sim.tipFor(base, ctx);
    if (tip && tip.type === "build" && tip.pitch === index) {
      const card = out.find(c => c.item.id === tip.item);
      if (card) card.tip = true;
    } else {
      const best = out.filter(c => c.affordable && c.dIncome > 0).sort((a, b) => b.dIncome / (b.cost + 1) - a.dIncome / (a.cost + 1))[0];
      if (best && out.length > 2) best.tip = true;
    }
    return out;
  }

  /** The upgrade / replace data of a built pitch. */
  function manageInfo(index) {
    const entry = state.pitches[index];
    if (!entry) return null;
    const item = ITEM_BY_ID[entry.k];
    const row = info().perPitch.find(r => r.pitch === index) ?? null;
    const cost = sim.upgradeCost(state, index);
    let upgradeGain = 0;
    if (cost !== null) {
      const next = { ...state, pitches: state.pitches.map((e, i) => i === index ? { ...e, lv: e.lv + 1 } : e) };
      upgradeGain = sim.economy(next, ctx).incomePerMin - info().incomePerMin;
    }
    const refund = sim.refundFor(entry);
    const cleared = { ...state, c: state.c + refund, pitches: state.pitches.map((e, i) => i === index ? null : e) };
    const replaceCards = buildOptions(index, cleared, cleared.c).filter(c => c.item.id !== entry.k && !c.item.special)
      .map(c => ({ ...c, net: c.cost - refund }));
    return { index, entry, item, row, income: row?.income ?? 0, cost, upgradeGain, refund, canAfford: cost !== null && state.c >= cost,
      missing: cost === null ? 0 : Math.max(0, cost - state.c), problem: Boolean(row?.problem), queueFigures: row?.queueFigures ?? 0,
      maxed: cost === null, replaceCards, level: entry.lv, look: entry.look, pitch: PITCHES[index] };
  }

  /** The pitches that should glow right now (empty, open, plus locked ones a voucher can still use). */
  function glowPitches() {
    const out = [];
    const tut = tutorialInfo();
    if (tut.active) return tut.stage === "pitch" && tut.pitchTarget >= 0 ? [tut.pitchTarget] : [];
    for (let i = 0; i < PITCH_COUNT; i++) if (pitchStatus(i) === "open") out.push(i);
    for (const id of state.vo) {
      if (out.some(i => sizeFits(ITEM_BY_ID[id].size, PITCHES[i].size))) continue;
      const free = PITCHES.map((p, i) => i).filter(i => !state.pitches[i] && sizeFits(ITEM_BY_ID[id].size, PITCHES[i].size) && !out.includes(i))
        .sort((a, b) => SIZE_RANK[PITCHES[a].size] - SIZE_RANK[PITCHES[b].size] || PITCHES[a].star - PITCHES[b].star)[0];
      if (free !== undefined) out.push(free);
    }
    return out;
  }

  // ---- onboarding (DESIGN section 1; pioneers get three steps) ----
  /** The voucher the pioneer tutorial places: the first one that is affordable (most are free), else the free gold carousel. */
  function tutorialVoucher() {
    const cost = id => ITEM_BY_ID[id].cost <= RULES.voucherFreeMaxCost ? 0 : Math.round(ITEM_BY_ID[id].cost * RULES.voucherDiscount);
    const usable = state.vo.find(id => cost(id) <= state.c);
    if (usable) return usable;
    return state.pitches.some(e => e && e.k === "gold") ? (state.vo[0] ?? "gold") : "gold";
  }

  function chooseVoucherPitch(itemId) {
    const item = ITEM_BY_ID[itemId];
    let best = -1;
    PITCHES.forEach((pitch, index) => {
      if (state.pitches[index] || !sizeFits(item.size, pitch.size)) return;
      const rank = (pitch.size === item.size ? 0 : 10) + (sim.pitchOpen(state, index) ? 0 : 20) + index / 100;
      if (best < 0 || rank < best.rank) best = { index, rank };
    });
    return best === -1 ? -1 : best.index;
  }

  function cheapestUpgrade() {
    let best = -1, bestCost = Infinity;
    state.pitches.forEach((entry, index) => {
      const cost = entry ? sim.upgradeCost(state, index) : null;
      if (cost !== null && cost < bestCost) { best = index; bestCost = cost; }
    });
    return { index: best, cost: best < 0 ? null : bestCost };
  }

  function tutorialInfo() {
    const done = state.tu >= TUTORIAL.done;
    const base = { active: !done, mode: state.pi === 1 ? "pioneer" : "fresh", step: state.tu, pitchTarget: -1, item: null, stage: "none", wait: 0 };
    if (done) return base;
    if (base.mode === "pioneer") {
      const itemId = tutorialVoucher();
      if (state.tu <= 1) return { ...base, step: 1, stage: "pitch", item: itemId, pitchTarget: chooseVoucherPitch(itemId) };
      if (state.tu === 2) return { ...base, step: 2, stage: "crowd" };
      const target = cheapestUpgrade();
      return { ...base, step: 3, stage: "upgrade", pitchTarget: target.index, wait: target.cost === null ? 0 : Math.max(0, target.cost - state.c) };
    }
    switch (state.tu) {
      case TUTORIAL.coin: return { ...base, stage: "coin" };
      case TUTORIAL.secondBuild: return { ...base, stage: "pitch", pitchTarget: pitchIndex(TUTORIAL_PITCHES[1]), item: TUTORIAL_ITEMS.second };
      case TUTORIAL.upgrade: {
        const first = state.pitches.findIndex(e => e && e.k === TUTORIAL_ITEMS.first);
        const target = first >= 0 && sim.upgradeCost(state, first) !== null ? { index: first, cost: sim.upgradeCost(state, first) } : cheapestUpgrade();
        return { ...base, stage: "upgrade", pitchTarget: target.index, wait: target.cost === null ? 0 : Math.max(0, target.cost - state.c) };
      }
      case TUTORIAL.goal: return { ...base, stage: "goal" };
      case TUTORIAL.walk: return { ...base, stage: "walk" };
      default: return { ...base, step: TUTORIAL.firstBuild, stage: "pitch", pitchTarget: pitchIndex(TUTORIAL_PITCHES[0]), item: TUTORIAL_ITEMS.first };
    }
  }

  function setTutorial(step) {
    if (state.tu === step) return;
    state = { ...state, tu: step };
    emit("tutorial", tutorialInfo());
    if (persist) persistence?.scheduleSave();
  }

  /** Moves the stored step forward when the world already satisfies it (also repairs old or odd saves). */
  function advanceTutorial() {
    if (state.tu >= TUTORIAL.done) return;
    if (state.pi === 1) {
      if (state.tu <= 1 && builtCount() > 0) setTutorial(2);
      if (state.tu === 3 && state.pitches.some(e => e && e.lv >= 1)) setTutorial(TUTORIAL.done);
      return;
    }
    if (state.tu === 0) { setTutorial(builtCount() > 0 ? TUTORIAL.done : TUTORIAL.firstBuild); return; }
    if (state.tu === TUTORIAL.firstBuild && builtCount() > 0) { setTutorial(TUTORIAL.coin); coinTimer = null; }
    if (state.tu === TUTORIAL.secondBuild && builtCount() >= 2) setTutorial(TUTORIAL.upgrade);
    if (state.tu === TUTORIAL.upgrade && state.pitches.some(e => e && e.lv >= 1)) setTutorial(TUTORIAL.goal);
  }

  /** Pioneer step 2 (crowd bubble) and fresh step 6 (goal card) are acknowledged with a tap. */
  function acknowledgeTutorial() {
    if (state.tu >= TUTORIAL.done) return;
    if (state.pi === 1) { if (state.tu === 2) setTutorial(3); return; }
    if (state.tu === TUTORIAL.coin) { coinTimer = null; setTutorial(TUTORIAL.secondBuild); }
    else if (state.tu === TUTORIAL.goal) setTutorial(TUTORIAL.walk);
    else if (state.tu === TUTORIAL.walk) setTutorial(TUTORIAL.done);
  }

  function skipTutorial() { coinTimer = null; setTutorial(TUTORIAL.done); changed("tutorial"); }

  // ---- commands (each returns { ok, ... } and replaces `state`) ----
  const refuse = reason => ({ ok: false, reason });

  function build(index, itemId, { look = 0, voucher = false } = {}) {
    const before = state;
    const result = voucher ? sim.useVoucher(state, itemId, index, look) : sim.build(state, index, itemId, look);
    if (!result.ok) return result;
    setState(result.state, "build", { index, item: itemId, cost: result.cost, voucher });
    emit("built", { index, item: itemId, level: 0, look, before, voucher });
    return result;
  }

  function upgrade(index) {
    const before = state;
    const result = sim.upgrade(state, index);
    if (!result.ok) return result;
    setState(result.state, "upgrade", { index, cost: result.cost });
    emit("upgraded", { index, item: before.pitches[index].k, level: result.state.pitches[index].lv, before });
    return result;
  }

  function setLook(index, look) {
    const result = sim.setLook(state, index, look);
    if (!result.ok) return result;
    setState(result.state, "look", { index, look });
    emit("looked", { index, look });
    return result;
  }

  function replace(index, itemId, look = 0) {
    const before = state;
    const result = sim.replace(state, index, itemId, look);
    if (!result.ok) return result;
    setState(result.state, "replace", { index, item: itemId, refund: result.refund });
    emit("built", { index, item: itemId, level: 0, look, before, replaced: true });
    return result;
  }

  function claimFireworks() {
    const result = sim.claimFireworks(state, events);
    if (!result.ok) return result;
    setState(result.state, "fireworks", { amount: result.amount });
    return result;
  }

  /** Hämmi's daily present (tap the sheep): once per Luxembourg day, cash only. Refreshes the events first so the day is the current one. */
  function claimHaemmi() {
    refreshEvents();
    const result = sim.claimHaemmiGift(state, events);
    if (!result.ok) return result;
    setState(result.state, "haemmi", { amount: result.amount });
    return result;
  }

  /** The arcade delivers an admin gift; `ids` already has the new id last. Idempotent. */
  function applyGift(amount, ids) {
    const id = ids[ids.length - 1];
    const result = sim.applyGift(state, id, amount);
    if (result.applied) setState(result.state, "gift", { amount, id });
    return result.applied;
  }

  // ---- Foodie (eating in the walk) and small flags ----
  function applyFoodie() {
    ctx = withBonus(baseCtx, bonusMult());
    infoCache = null;
    emit("foodie", foodie());
  }
  function foodie(at = now()) {
    const live = foodieEntries.filter(entry => entry.until > at);
    const left = live.length ? Math.max(0, Math.min(...live.map(entry => entry.until)) - at) / 1000 : 0;
    return { stacks: live.length, mult: foodieMultiplier(live.length), left, items: live.map(entry => entry.item), fun: funUntil > at, funLeft: funUntil > at ? (funUntil - at) / 1000 : 0 };
  }
  /** The player finished a ride (walk). A small income buff for 2 minutes; a repeat while it runs only refreshes it. */
  function fun(rideId) {
    const at = now();
    const was = funUntil > at;
    funUntil = at + FUN.seconds * 1000;
    if (!was) applyFoodie();
    return { ok: true, ride: rideId, granted: !was, percent: Math.round((FUN.perRide - 1) * 100) };
  }
  function expireFoodie(at) {
    if (!foodieEntries.length) return;
    const live = foodieEntries.filter(entry => entry.until > at);
    if (live.length !== foodieEntries.length) { foodieEntries = live; applyFoodie(); }
  }
  /** The player ate `itemId` at a food stall. Cosmetic apart from the Foodie bonus: no cash changes hands. */
  function eat(itemId) {
    const at = now();
    expireFoodie(at);
    const known = eatenThisSession.has(itemId);
    const base = { ok: true, item: itemId, granted: false, known, full: false };
    if (known) return { ...base, ...foodie(at) };
    if (foodieEntries.length >= FOODIE.maxStacks) return { ...base, full: true, ...foodie(at) };
    eatenThisSession.add(itemId);
    foodieEntries = [...foodieEntries, { item: itemId, until: at + FOODIE.seconds * 1000 }];
    applyFoodie();
    return { ...base, granted: true, ...foodie(at) };
  }
  const hasFlag = flag => state.ea.includes(flag);
  /** one-letter achievement / trial flags in the save (`ea`: "g" starter gift, "r" Op der Spëtzt, "p" Probefahrt used, one letter per ride: rides/catalog.js RIDE_FLAGS) */
  function setFlag(flag) {
    if (!/^[a-z0-9]$/.test(flag) || hasFlag(flag) || state.ea.length >= FLAGS_MAX) return false;
    setState({ ...state, ea: state.ea + flag }, "flag", { flag });
    return true;
  }

  // ---- time ----
  function markActive() { lastInput = now(); }

  function refreshEvents(at = now()) {
    const next = eventsAt(at);
    const dayChanged = next.today !== events.today;
    events = next;
    const nextCtx = economyContext(next);
    if (JSON.stringify(nextCtx) !== JSON.stringify(baseCtx)) { baseCtx = nextCtx; ctx = withBonus(baseCtx, bonusMult(at)); infoCache = null; }
    const stamped = sim.stampToday(state, next);
    if (stamped !== state) {
      state = stamped;
      emit("stamp", { count: sim.stampCount(state, next.fair.year), day: next.stamp.today, year: next.fair.year });
      if (persist) persistence?.scheduleSave();
    }
    if (dayChanged) emit("events", { events, banners: bannersAt(events) });
    return events;
  }

  function offlineNow(at, { silent = false } = {}) {
    const before = state.c;
    const result = sim.offline(state, at, { period: events.fair.active });
    state = result.state;
    infoCache = null;
    const report = { seconds: result.seconds, credited: result.credited, capHours: result.capHours, rate: result.rate,
      incomePerMin: result.incomePerMin, before, after: state.c, capped: result.seconds >= result.capHours * 3600 - 1 };
    if (!silent && result.seconds >= OFFLINE_CARD_MIN_SECONDS && result.credited >= 1) {
      pendingOffline = report;
      emit("offline", report);
    }
    changed("offline");
    return report;
  }

  /** Called every frame (or by tests). Earns income by the wall clock; a long gap becomes an offline credit. */
  function update() {
    const at = now();
    const elapsed = (at - wall) / 1000;
    wall = at;
    if (!ready) return;
    if (foodieEntries.length) expireFoodie(at);
    if (funUntil && funUntil <= at) { funUntil = 0; applyFoodie(); }
    if (elapsed < 0) { state = sim.touch(state, at); return; }       // the clock went backwards: just resync
    if (elapsed > AWAY_GAP_SECONDS) {
      refreshEvents(at);
      offlineNow(at);
      return;
    }
    acc += elapsed;
    saveClock += elapsed;
    if (coinTimer !== null) {
      coinTimer -= elapsed;
      if (coinTimer <= 0) { coinTimer = null; acknowledgeTutorial(); }
    }
    if (acc < TICK_INTERVAL) return;
    const idleMs = at - lastInput;
    const rate = sim.activityRate(stars(), idleMs, events.fair.active);
    const before = state;
    state = sim.touch(sim.tick(state, acc * rate, ctx), at);
    const earned = state.c - before.c;
    acc = 0;
    eventClock += TICK_INTERVAL;
    if (eventClock >= 1) { eventClock = 0; refreshEvents(at); }
    if (earned > 0) {
      if (state.tu === TUTORIAL.coin && coinTimer === null) { coinTimer = FIRST_COIN_SECONDS; emit("tutorial", tutorialInfo()); }
      emit("earn", { amount: earned, rate });
    }
    if (persist && saveClock >= AUTOSAVE_MS / 1000) { saveClock = 0; persistence?.pushSave(); mirrorStandalone(); }
  }

  /** Debug / test: earn `seconds` of game time at full rate right now. */
  function advance(seconds, { events: withEvents = true } = {}) {
    if (withEvents) refreshEvents();
    const before = state;
    state = sim.tick(state, seconds, ctx);
    if (state.c > before.c && state.tu === TUTORIAL.coin && coinTimer === null) coinTimer = FIRST_COIN_SECONDS;
    changed("advance");
    emit("earn", { amount: state.c - before.c, rate: 1, debug: true });
  }

  // ---- standalone play (no arcade parent) keeps its own copy under the arcade's key ----
  function mirrorStandalone() {
    if (!persist || testMode || !storage || win.parent !== win) return;
    try { storage.setItem(SAVE_KEY, serializeSave(sim.touch(state, now()))); }
    catch (error) { console.warn("[fouer] could not keep the standalone save", error.message); }
  }
  function scheduleMirror() {
    if (mirrorTimer !== null || win.parent !== win || !win.setTimeout) return;
    mirrorTimer = win.setTimeout(() => { mirrorTimer = null; mirrorStandalone(); }, 1500);
  }

  // ---- startup / persistence ----
  function localSources() {
    const stored = testMode ? null : readStorage(storage, SAVE_KEY);
    return { local: win.__pbSave, stored };
  }

  async function start() {
    const at = now();
    refreshEvents(at);
    const { local, stored } = localSources();
    const backupText = testMode ? null : readStorage(storage, BACKUP_KEY);
    const startup = await resolveStartup({
      local, cloud: stored === null || stored === undefined ? undefined : stored,
      backup: backupText ?? undefined, now: at, name });
    flags.startup = startup;
    state = startup.state ?? sim.createState({ name, now: at });
    const kind = startup.report.kind;
    if (!testMode && startup.v1Source !== null && startup.v1Source !== undefined) backupV1(storage, startup.v1Source);
    if (testMode) state = unlockedState(state);
    wall = at;
    const migrated = ["fresh", "stub", "corrupt", "late", "topup"].includes(kind);
    if (migrated) pendingLetter = { report: startup.report, lg: state.lg, source: kind };
    if (migrated && startup.state) state = sim.touch(state, at);
    // a restored (non-migrated) save has been away since its last save
    if (!migrated && startup.state && state.t > 0 && !testMode) offlineNow(at);
    else if (!migrated && startup.state && testMode) state = sim.touch(state, at);
    state = sim.stampToday(state, events);
    state = sim.touch(state, at);
    infoCache = null;
    lastStars = stars();
    // the player is brand new, or has an old save without any onboarding state
    if (state.tu === 0) state = { ...state, tu: builtCount() > 0 && state.pi !== 1 ? TUTORIAL.done : TUTORIAL.firstBuild };
    if (testMode) state = { ...state, tu: TUTORIAL.done };
    if (persist) {
      persistence = createPersistence({
        getState: () => (state = sim.touch(state, now())),
        onState: incoming => adopt(incoming),
        onError: message => emit("error", { message }),
        env: browserEnv(win),
      });
      if (migrated) persistence.pushSave();
    }
    win.addEventListener?.("message", receiveLate);
    win.addEventListener?.("pagehide", mirrorStandalone);
    win.addEventListener?.("pointerdown", markActive, { capture: true, passive: true });
    win.addEventListener?.("keydown", markActive, { capture: true, passive: true });
    ready = true;
    advanceTutorial();
    emit("ready", { report: startup.report, migrated });
    emit("change", { kind: "start" });
    return startup;
  }

  /** A newer save arrived from the cloud: take it, credit the time since it was saved, redraw everything. */
  function adopt(incoming) {
    const at = now();
    state = unlockedState({ ...incoming, hd: Math.max(incoming.hd, state.hd) });   // a cloud save never gives Hämmi's present of today back
    const report = offlineNow(at, { silent: false });
    lastStars = stars();
    emit("adopted", { report });
    changed("adopt");
  }

  /** Cloud rows that are not v2 (a pioneer stub, a v1 blob) migrate here, after the page has started. */
  async function receiveLate(event) {
    if (event.source !== win.parent || !event.data || event.data.__pbLoadSave !== 1 || testMode) return;
    const kind = classifyRaw(event.data.data);
    if (kind !== "stub" && kind !== "v1") return;
    try {
      const result = await migrate(event.data.data, state, { now: now(), name });
      if (result.report.kind === "none" || result.report.kind === "ignored") return;
      if (kind === "v1") backupV1(storage, event.data.data);
      state = sim.touch(result.state, now());
      infoCache = null;
      pendingLetter = { report: result.report, lg: state.lg, source: kind };
      lastStars = stars();
      emit("letter", pendingLetter);
      changed("migrate");
      persistence?.pushSave();
    } catch (error) { console.error("[fouer] late migration failed", error); }
  }

  function flushSave() { if (persist && persistence) { state = sim.touch(state, now()); persistence.pushSave(); mirrorStandalone(); } }

  return {
    on, start, update, advance, markActive, flushSave,
    get state() { return state; }, get events() { return events; }, get ctx() { return ctx; }, get ready() { return ready; },
    get testMode() { return testMode; }, get persistence() { return persistence; }, get startup() { return flags.startup; },
    get pendingOffline() { return pendingOffline; }, get pendingLetter() { return pendingLetter; },
    info, stars, banners: () => bannersAt(events), refreshEvents, entries, builtCount,
    eat, foodie, fun, hasFlag, setFlag,
    pitchStatus, pitchUsable, voucherFits, buildOptions, manageInfo, glowPitches, goal: () => sim.nextGoal(state, ctx),
    tutorial: tutorialInfo, acknowledgeTutorial, skipTutorial,
    build, upgrade, setLook, replace, claimFireworks, claimHaemmi, applyGift,
    haemmiReady: () => sim.haemmiGiftReady(state, events),
    /** the (test-overridable) wall clock in ms */
    clock: () => now(),
    dismissOffline() { const card = pendingOffline; pendingOffline = null; return card; },
    dismissLetter() { const letter = pendingLetter; pendingLetter = null; return letter; },
    setTutorialStep: setTutorial,
    /** debug / tests only: replace the whole state (main.js exposes it with ?fouerDebug=1) */
    debugSetState(next) { state = next; changed("debug"); },
    fireworksClaimable: () => events.fireworks.claimable && state.fw !== events.fair.year,
    nextFouerDays: () => events.next.days,
    pitchId: index => PITCHES[index].id, pitchIndex,
    starPoints: STAR_POINTS,
  };
}
