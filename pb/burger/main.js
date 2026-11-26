/* Burger-Restaurant: wiring. One state object (sim.js), one fixed-step clock (this file), one view (view.js).
 * Input: in-game controls act on pointerdown (instant, several fingers at once on an iPad), the panels and the shop on click
 * (a finger that scrolls the shop must not buy anything), the keyboard through shortcuts and Enter/Space on focused buttons. */
import {ITEMS, TIMING} from "/pb/burger/data.js?v=2";
import * as sim from "/pb/burger/sim.js?v=3";
import {bootProgress, createPersistence} from "/pb/burger/save.js?v=5";
import {createView} from "/pb/burger/view.js?v=1";
import {createShop} from "/pb/burger/shop.js?v=2";
import {createAudio} from "/pb/burger/audio.js?v=1";

const MAX_STEPS_PER_FRAME = 240;
const DEBUG_MAX_SPEED = 8;

/* Arcade test mode (owner): every day and recipe open, plenty of coins and stars. Saves go to the arcade's test store. */
const IS_TEST_MODE = window.__pbTestMode === true;
const TEST_DAY = 20;
const TEST_FUNDS = 1_000_000;
const withTestFunds = (progress) => (IS_TEST_MODE ? {
  ...progress,
  day:Math.max(progress.day, TEST_DAY),
  coins:progress.coins < TEST_FUNDS / 2 ? TEST_FUNDS : progress.coins,
  stars:progress.stars < TEST_FUNDS / 2 ? TEST_FUNDS : progress.stars,
} : progress);

const IS_DEBUG = (() => {
  try { return new URL(document.baseURI).searchParams.get("burgerTest") === "1"; }
  catch (error) { console.warn("[Burger] could not read the page address", error); return false; }
})();

const view = createView();
const audio = createAudio();
const shopLayer = document.getElementById("shopLayer");
const shop = createShop(document.getElementById("shop"));

let state = sim.createState(withTestFunds(bootProgress()));
let lastScore = -1;
let speed = 1;
let lastFrameAt = 0;
let accumulator = 0;
let frameRequested = false;

function reportScore() {
  const score = state.progress.lifetimeCoins;
  if (score === lastScore) return;
  lastScore = score;
  window.score = score;
  window.Arcade?.score(score);
}

const persistence = createPersistence({
  getProgress:() => state.progress,
  onBetter:(progress) => {
    state = sim.adoptProgress(state, withTestFunds(progress));
    reportScore();
    requestFrame();
  },
});

function setState(next) {
  if (next === state) return;
  const progressChanged = next.progress !== state.progress;
  state = next;
  if (progressChanged) {
    reportScore();
    persistence.changed();
  }
}

/* ---------- events: sounds, pop-ups, saving at the moments that matter ---------- */
const SOUND_OF = Object.freeze({
  start:"start", ready:"ready", board:"board", tray:"tray", top:"topping", untop:"topping", toss:"toss", burnt:"burnt",
  walkout:"walkout", boost:"boost", dayEnd:"dayEnd", bought:"tray",
});
function drainEvents(now) {
  const [events, next] = sim.takeEvents(state);
  if (!events.length) return;
  state = next;
  events.forEach((event) => {
    if (event.type === "refused") { if (event.reason !== "cooking") audio.play("refused"); }
    else audio.play(SOUND_OF[event.type]);
  });
  view.feedback(events, state, now);
  if (events.some((event) => event.type === "dayEnd" || event.type === "bought")) persistence.flush();
}

/* ---------- the clock: fixed steps, only while a day is running ---------- */
function frame(now) {
  frameRequested = false;
  if (state.screen === "playing") {
    accumulator += Math.min(TIMING.maxFrameMs, Math.max(0, now - lastFrameAt)) * speed;
    let next = state;
    for (let steps = 0; accumulator >= TIMING.stepMs && steps < MAX_STEPS_PER_FRAME; steps += 1) {
      next = sim.step(next, TIMING.stepMs);
      accumulator -= TIMING.stepMs;
    }
    setState(next);
  } else {
    accumulator = 0;
  }
  lastFrameAt = now;
  drainEvents(now);
  view.update(state, now);
  if (!shopLayer.hidden) shop.refresh(state.progress);
  if (state.screen === "playing" || view.isAnimating()) requestFrame();
}
function requestFrame() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame((now) => {
    if (state.screen === "playing" && lastFrameAt === 0) lastFrameAt = now;
    frame(now);
  });
}

/* ---------- actions ---------- */
const openShop = () => { shopLayer.hidden = false; shop.refresh(state.progress); shop.focusClose(); };
const closeShop = () => {
  if (shopLayer.hidden) return;
  shopLayer.hidden = true;
  document.getElementById("shopButton")?.focus({preventScroll:true});
};

const ACTIONS = Object.freeze({
  grill:(index) => sim.tapGrill(state, index),
  fryer:(index) => sim.tapFryer(state, index),
  drinks:(index) => sim.tapDrink(state, index),
  pour:(_, item) => sim.pourDrink(state, item),
  topping:(_, item) => sim.toggleTopping(state, item),
  plate:() => sim.plateBurger(state),
  trash:() => sim.trashBoard(state),
  tray:(index) => sim.tapTray(state, index),
  guest:(index) => sim.tapCustomer(state, index),
  boost:() => sim.activateBoost(state),
  pause:() => (state.screen === "paused" ? sim.resumeDay(state) : sim.pauseDay(state)),
  start:() => {
    if (state.screen === "paused") return sim.resumeDay(state);
    closeShop();
    return sim.startDay(state);
  },
  shop:() => { openShop(); return state; },
  "shop-close":() => { closeShop(); return state; },
  "shop-tab":(_, item) => { shop.showTab(item); return state; },
  buy:(_, item) => {
    const [category, id] = String(item).split(":");
    return sim.buyUpgrade(state, category, id);
  },
});

function act(name, index = 0, item = "") {
  const action = ACTIONS[name];
  if (!action) return;
  const wasPlaying = state.screen === "playing";
  setState(action(index, item));
  if (!wasPlaying && state.screen === "playing") lastFrameAt = performance.now();
  drainEvents(performance.now());
  view.update(state);
  if (!shopLayer.hidden) shop.refresh(state.progress);
  requestFrame();
}

const actOn = (target) => act(target.dataset.act, Number(target.dataset.index || 0), target.dataset.item || "");
const gameRoot = document.getElementById("game");

/* in-game controls: on finger/mouse down */
document.addEventListener("pointerdown", (event) => {
  if (event.button > 0 || !event.isPrimary && event.pointerType === "mouse") return;
  const target = event.target.closest?.("[data-act]");
  if (!target || target.disabled || !gameRoot.contains(target)) return;
  event.preventDefault();        // no focus ring jump, no text selection, no double handling through the click
  actOn(target);
});
/* panels, shop, and every button activated from the keyboard (click with detail 0) */
document.addEventListener("click", (event) => {
  const target = event.target.closest?.("[data-act]");
  if (!target || target.disabled) return;
  if (gameRoot.contains(target) && event.detail !== 0) return;   // already handled on pointerdown
  actOn(target);
});

/* ---------- keyboard ---------- */
const firstIndex = (slots, wanted) => slots.findIndex((slot) => wanted.includes(slot.state));
function smartStation(station) {
  const slots = state.session?.[station] || [];
  const index = [["ready"], ["burnt"], ["empty"]].map((wanted) => firstIndex(slots, wanted)).find((i) => i >= 0);
  return index === undefined ? null : index;
}
function neededDrink() {
  const session = state.session;
  if (!session) return "cola";
  const waiting = session.customers.flatMap((customer) => customer.left).filter((id) => ITEMS[id].kind === "drink");
  const covered = [...session.tray.map((item) => item.id), ...session.drinks.filter((slot) => slot.item).map((slot) => slot.item)];
  const missing = waiting.find((id) => {
    const need = waiting.filter((entry) => entry === id).length;
    return covered.filter((entry) => entry === id).length < need;
  });
  return missing || "cola";
}
const KEYS = Object.freeze({
  g:() => { const index = smartStation("grill"); if (index !== null) act("grill", index); },
  f:() => { const index = smartStation("fryer"); if (index !== null) act("fryer", index); },
  d:() => {
    const ready = firstIndex(state.session?.drinks || [], ["ready"]);
    if (ready >= 0) act("drinks", ready); else act("pour", 0, neededDrink());
  },
  k:() => act("topping", 0, "cheese"),
  z:() => act("topping", 0, "lettuce"),
  t:() => act("topping", 0, "tomato"),
  x:() => act("trash"),
  backspace:() => act("trash"),
  enter:() => act("plate"),
  b:() => act("boost"),
  s:() => (state.session?.customers || [])
    .filter((customer) => state.session.tray.some((item) => customer.left.includes(item.id)))
    .map((customer) => customer.slot)
    .forEach((slot) => act("guest", slot)),
});
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  const key = event.key.toLowerCase();
  if (!shopLayer.hidden) {
    if (key === "escape") { event.preventDefault(); act("shop-close"); }
    return;
  }
  if (key === "p" || key === "escape") {
    if (state.screen === "playing" || state.screen === "paused") { event.preventDefault(); act("pause"); }
    return;
  }
  if (state.screen !== "playing") {
    const onButton = document.activeElement?.tagName === "BUTTON";
    if ((key === "enter" || key === " ") && !onButton) { event.preventDefault(); act("start"); }
    return;
  }
  if ((key === "enter" || key === " ") && document.activeElement?.tagName === "BUTTON") return;   // the focused button's own click
  if (/^[1-6]$/.test(key)) { event.preventDefault(); act("tray", Number(key) - 1); return; }
  const handler = KEYS[key];
  if (handler) { event.preventDefault(); handler(); }
});

/* ---------- page life ---------- */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") { lastFrameAt = performance.now(); requestFrame(); return; }
  if (state.screen === "playing") { setState(sim.pauseDay(state)); view.update(state); }
  persistence.flush();
});
window.Arcade?.onRestart?.(() => {
  closeShop();
  setState(sim.abandonDay(state));
  persistence.flush();
  view.update(state);
});

if (IS_DEBUG) {
  window.__burgerTest = Object.freeze({
    state:() => JSON.parse(JSON.stringify(state)),
    speed:(value) => { speed = Math.max(1, Math.min(DEBUG_MAX_SPEED, Number(value) || 1)); },
    flush:() => persistence.flush(),
    muted:() => audio.isMuted(),
  });
}

reportScore();
view.update(state);
window.__burgerBooted = true;
