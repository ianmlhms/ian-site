import {ITEMS, RECIPES, UNLOCKS} from "/pb/burger/data.js?v=1";
import {
  activateBoost,
  buyUpgrade,
  createGameState,
  getLevel,
  isItemUnlocked,
  plateBurger,
  serveTray,
  startDay,
  stationCapacity,
  tapDrink,
  tapFryer,
  tapGrill,
  tick,
  toggleTopping,
} from "/pb/burger/sim.js?v=1";
import {createPersistence, snapshot} from "/pb/burger/save.js?v=1";
import {createShop} from "/pb/burger/shop.js?v=1";

const UI_REFRESH_MS = 100;
const TOAST_MS = 1_350;
const TEST_DELAY_MS = 180;
const MILLISECONDS_PER_SECOND = 1_000;
const BURGER_LAYER_OFFSET_PX = 2.2;
const TEST_PROGRESS_GAIN = 321;

/* Sprites are generated once by scripts/gen_burger_art.py and committed.
 * Absolute paths are required: inside the arcade this game runs in a srcdoc
 * iframe whose base URL is the parent page at the site root. */
const ART_NAMES = Object.freeze([
  "bun-top", "bun-bottom", "patty-raw", "patty-cooked",
  "patty-burnt", "cheese", "lettuce", "tomato",
  "fries-raw", "fries-cooked", "fries-burnt", "cola",
  "lemonade", "shake", "plate", "grill",
  "fryer", "drink-machine", "counter", "floor",
  "coin", "star", "customer-1", "customer-2",
  "customer-3", "customer-4", "customer-5", "customer-6",
]);

const ART_URLS = Object.freeze(Object.fromEntries(
  ART_NAMES.map((name) => [name, `url("/pb/burger/art/${name}.webp?v=1")`]),
));

const byId = (id) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Burger Rush is missing #${id}.`);
  return node;
};

const nodes = Object.freeze({
  coinBalance:byId("coinBalance"), starBalance:byId("starBalance"), customers:byId("customers"),
  queueStatus:byId("queueStatus"), tray:byId("tray"), trayStatus:byId("trayStatus"), grill:byId("grill"),
  fryer:byId("fryer"), drinks:byId("drinks"), drinkOptions:byId("drinkOptions"), toppings:byId("toppings"),
  assembly:byId("assembly"), plateButton:byId("plateButton"), hudDay:byId("hudDay"), hudGoal:byId("hudGoal"),
  hudTime:byId("hudTime"), hudCombo:byId("hudCombo"), hudCoins:byId("hudCoins"), boostButton:byId("boostButton"),
  modalLayer:byId("modalLayer"), modalTitle:byId("modalTitle"), modalStars:byId("modalStars"),
  modalMessage:byId("modalMessage"), modalDetail:byId("modalDetail"), shopButton:byId("shopButton"),
  startButton:byId("startButton"), shopLayer:byId("shopLayer"), shop:byId("shop"), toast:byId("toast"),
});

const createSprite = (artId, className = "sprite") => {
  const sprite = document.createElement("span");
  sprite.className = className;
  sprite.style.backgroundImage = ART_URLS[artId] || ART_URLS.plate;
  sprite.dataset.art = artId;
  return sprite;
};

const burgerLayers = (patties, toppings) => [
  "bun-bottom",
  ...Array.from({length:patties}, () => "patty-cooked"),
  ...["cheese", "lettuce", "tomato"].filter((topping) => toppings.includes(topping)),
  "bun-top",
];

const createBurger = (patties, toppings) => {
  const stack = document.createElement("span");
  stack.className = "burger-stack";
  burgerLayers(patties, toppings).forEach((artId, index, layers) => {
    const layer = createSprite(artId, "burger-layer");
    const offset = (index - (layers.length - 1) / 2) * BURGER_LAYER_OFFSET_PX;
    layer.style.transform = `translateY(${offset}px)`;
    stack.append(layer);
  });
  return stack;
};

const createItemArt = (itemId) => {
  const recipe = RECIPES.find((entry) => entry.id === itemId);
  if (recipe) return createBurger(recipe.patties, recipe.toppings);
  if (itemId === "fries") return createSprite("fries-cooked");
  return createSprite(itemId);
};

const addStationTitle = (elementId, artId, text) => {
  const title = byId(elementId);
  title.append(createSprite(artId), document.createTextNode(text));
};

addStationTitle("grillTitle", "grill", "Grill");
addStationTitle("fryerTitle", "fryer", "Fryer");
addStationTitle("drinksTitle", "drink-machine", "Drinks");
addStationTitle("toppingsTitle", "counter", "Assembly");

let state = createGameState();
let selectedDrink = "cola";
let lastRenderAt = 0;
let toastTimer = 0;
let persistence;

const showToast = (message) => {
  window.clearTimeout(toastTimer);
  nodes.toast.textContent = message;
  nodes.toast.classList.add("show");
  toastTimer = window.setTimeout(() => nodes.toast.classList.remove("show"), TOAST_MS);
};

const setState = (nextState, shouldRender = true) => {
  state = nextState;
  window.score = state.lifetimeCoins;
  if (shouldRender) render();
};

const makeButton = (className, label, onClick) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
};

const patienceRatio = (customer, nowMs) => Math.max(0, Math.min(1, (customer.expiresAt - nowMs) / customer.patienceMs));

const renderCustomers = (nowMs) => {
  const capacity = stationCapacity(state, "counterPositions");
  nodes.customers.style.setProperty("--counter-slots", capacity);
  const cards = Array.from({length:capacity}, (_, index) => {
    const customer = state.session?.customers[index];
    const card = document.createElement("article");
    card.className = customer ? "customer" : "customer empty";
    if (!customer) {
      card.setAttribute("aria-label", "Empty counter position");
      return card;
    }
    const patience = document.createElement("div");
    patience.className = "patience";
    const fill = document.createElement("div");
    fill.className = "patience-fill";
    fill.style.transform = `scaleX(${patienceRatio(customer, nowMs)})`;
    patience.append(fill);
    const art = createSprite(customer.artId, "sprite customer-art");
    const order = document.createElement("div");
    order.className = "order-bubble";
    customer.remaining.forEach((itemId) => {
      const item = document.createElement("span");
      item.className = "order-item";
      item.title = ITEMS[itemId]?.name || itemId;
      item.append(createItemArt(itemId));
      order.append(item);
    });
    card.append(patience, art, order);
    card.setAttribute("aria-label", `Customer wants ${customer.remaining.map((id) => ITEMS[id]?.name || id).join(", ")}`);
    return card;
  });
  nodes.customers.replaceChildren(...cards);
  nodes.queueStatus.textContent = state.session ? `${state.session.customers.length} waiting · ${state.session.walkouts} walked out` : "Get ready!";
};

const shakeTrayItem = (button) => {
  button.classList.remove("shake");
  requestAnimationFrame(() => button.classList.add("shake"));
};

const renderTray = () => {
  const capacity = stationCapacity(state, "traySlots");
  nodes.tray.style.setProperty("--tray-slots", capacity);
  const slots = Array.from({length:capacity}, (_, index) => {
    const item = state.session?.tray[index];
    const button = makeButton(`tray-slot${item ? " filled" : ""}`, item ? `Serve ${ITEMS[item.id]?.name || item.id}` : "Empty tray slot", () => {
      if (!item) return;
      const next = serveTray(state, index);
      if (next === state) {
        shakeTrayItem(button);
        showToast("Nobody wants that yet.");
        return;
      }
      setState(next);
    });
    button.disabled = !item || state.screen !== "playing";
    if (item) button.append(createItemArt(item.id));
    return button;
  });
  nodes.tray.replaceChildren(...slots);
  nodes.trayStatus.textContent = `${state.session?.tray.length || 0} / ${capacity}`;
};

const heatArtId = (station, slot) => {
  if (station === "grill") {
    if (slot.state === "burnt") return "patty-burnt";
    return slot.state === "ready" ? "patty-cooked" : "patty-raw";
  }
  if (slot.state === "burnt") return "fries-burnt";
  return slot.state === "ready" ? "fries-cooked" : "fries-raw";
};

const renderHeatStation = (element, station) => {
  const slots = state.session?.[station] || Array.from({length:stationCapacity(state, station === "grill" ? "grillSlots" : "fryerBaskets")}, (_, id) => ({id, state:"empty"}));
  const isLocked = station === "fryer" && state.day < UNLOCKS.fries;
  const buttons = slots.map((slot, index) => {
    const action = station === "grill" ? () => tapGrill(state, index) : () => tapFryer(state, index);
    const button = makeButton(`station-slot ${slot.state}${isLocked ? " locked" : ""}`, `${station} slot ${index + 1}: ${slot.state}`, () => setState(action()));
    button.disabled = state.screen !== "playing" || isLocked || (slot.state !== "empty" && slot.state !== "ready" && slot.state !== "burnt");
    if (slot.state !== "empty") button.append(createSprite(heatArtId(station, slot)));
    const label = document.createElement("span");
    label.className = "state-label";
    label.textContent = isLocked ? `Day ${UNLOCKS.fries}` : slot.state === "empty" ? "+" : slot.state;
    button.append(label);
    return button;
  });
  element.replaceChildren(...buttons);
};

const DRINK_IDS = Object.freeze(["cola", "lemonade", "shake"]);
const TOPPING_IDS = Object.freeze(["cheese", "lettuce", "tomato"]);

const renderDrinks = () => {
  const optionButtons = DRINK_IDS.map((itemId) => {
    const isUnlocked = isItemUnlocked(state.day, itemId);
    const button = makeButton(`drink-choice${selectedDrink === itemId ? " active" : ""}`, `Select ${ITEMS[itemId].name}`, () => {
      selectedDrink = itemId;
      render();
    });
    button.textContent = isUnlocked ? ITEMS[itemId].name : `Day ${UNLOCKS[itemId]}`;
    button.disabled = !isUnlocked || state.screen !== "playing";
    return button;
  });
  nodes.drinkOptions.replaceChildren(...optionButtons);
  const slots = state.session?.drinks || Array.from({length:stationCapacity(state, "drinkTaps")}, (_, id) => ({id, state:"empty"}));
  const buttons = slots.map((slot, index) => {
    const button = makeButton(`station-slot ${slot.state}`, `Drink tap ${index + 1}: ${slot.state}`, () => setState(tapDrink(state, index, selectedDrink)));
    button.disabled = state.screen !== "playing" || (slot.state !== "empty" && slot.state !== "ready");
    if (slot.itemId) button.append(createSprite(slot.itemId));
    const label = document.createElement("span");
    label.className = "state-label";
    label.textContent = slot.state === "empty" ? "+" : slot.state;
    button.append(label);
    return button;
  });
  nodes.drinks.replaceChildren(...buttons);
};

const renderAssembly = () => {
  const assembly = state.session?.assembly || {patties:0, toppings:[]};
  const buttons = TOPPING_IDS.map((topping) => {
    const isUnlocked = state.day >= UNLOCKS[topping];
    const isActive = assembly.toppings.includes(topping);
    const button = makeButton(`topping${isActive ? " active" : ""}`, `${isActive ? "Remove" : "Add"} ${topping}`, () => setState(toggleTopping(state, topping)));
    button.textContent = isUnlocked ? topping : `Day ${UNLOCKS[topping]}`;
    button.disabled = !isUnlocked || state.screen !== "playing";
    return button;
  });
  nodes.toppings.replaceChildren(...buttons);
  nodes.assembly.replaceChildren(assembly.patties ? createBurger(assembly.patties, assembly.toppings) : createSprite("plate"));
  nodes.plateButton.disabled = state.screen !== "playing" || assembly.patties === 0;
};

const renderHud = (nowMs) => {
  const level = getLevel(state);
  const session = state.session;
  nodes.coinBalance.textContent = `🪙 ${state.coins}`;
  nodes.starBalance.textContent = `⭐ ${state.stars}`;
  nodes.hudDay.textContent = String(state.day);
  nodes.hudGoal.textContent = `🪙 ${level.goal}`;
  nodes.hudTime.textContent = String(Math.ceil((session?.remainingMs || level.durationSeconds * MILLISECONDS_PER_SECOND) / MILLISECONDS_PER_SECOND));
  nodes.hudCombo.textContent = `×${session?.combo || 1}`;
  nodes.hudCoins.textContent = `🪙 ${session?.earnedCoins || 0}`;
  const boostLevel = Number(state.prem.instant || 0);
  nodes.boostButton.hidden = !boostLevel;
  if (boostLevel) {
    const cooldownMs = Math.max(0, (session?.boostReadyAt || 0) - nowMs);
    nodes.boostButton.disabled = state.screen !== "playing" || cooldownMs > 0;
    nodes.boostButton.textContent = cooldownMs > 0 ? `⚡ Ready in ${Math.ceil(cooldownMs / MILLISECONDS_PER_SECOND)}s` : "⚡ Instant cook";
  }
};

const renderModal = () => {
  const isVisible = state.screen !== "playing";
  nodes.modalLayer.hidden = !isVisible;
  if (!isVisible) return;
  const result = state.session?.result;
  if (!result) {
    nodes.modalTitle.textContent = `Day ${state.day}`;
    nodes.modalStars.textContent = "🍔";
    nodes.modalMessage.textContent = "Cook fast, serve happy customers, and grow your restaurant.";
    nodes.modalDetail.textContent = `Goal: 🪙 ${getLevel(state).goal}`;
    nodes.startButton.textContent = `Start day ${state.day}`;
    return;
  }
  nodes.modalTitle.textContent = result.hasPassed ? "Day complete!" : "Goal missed";
  nodes.modalStars.textContent = result.rating ? "★".repeat(result.rating) + "☆".repeat(3 - result.rating) : "☆☆☆";
  nodes.modalMessage.textContent = result.hasPassed ? `You earned 🪙 ${result.earnedCoins}.` : `You keep 🪙 ${result.earnedCoins}. Replay the day to reach the goal.`;
  nodes.modalDetail.textContent = `${result.walkouts} walkout${result.walkouts === 1 ? "" : "s"} · Goal 🪙 ${result.goal}${result.rating === 3 ? " · +1 ⭐" : ""}`;
  nodes.startButton.textContent = result.hasPassed ? `Start day ${state.day}` : `Replay day ${state.day}`;
};

function render() {
  const nowMs = performance.now();
  renderCustomers(nowMs);
  renderTray();
  renderHeatStation(nodes.grill, "grill");
  renderHeatStation(nodes.fryer, "fryer");
  renderDrinks();
  renderAssembly();
  renderHud(nowMs);
  renderModal();
  shop.refresh();
}

const shop = createShop(nodes.shop, {
  getState:() => state,
  onPurchase:(category, id) => {
    const next = buyUpgrade(state, category, id);
    if (next === state) {
      showToast("Not enough currency, or already maxed.");
      return;
    }
    setState(next);
    persistence.pushSave();
  },
  onClose:() => { nodes.shopLayer.hidden = true; },
});

persistence = createPersistence({
  getState:() => state,
  onState:(loadedState) => setState(loadedState),
  onError:(message, error) => console.warn(message, error),
});

nodes.startButton.addEventListener("click", () => setState(startDay(state)));
nodes.shopButton.addEventListener("click", () => { nodes.shopLayer.hidden = false; shop.refresh(); });
nodes.plateButton.addEventListener("click", () => {
  const next = plateBurger(state);
  if (next === state) {
    showToast("That burger does not match an unlocked recipe, or the tray is full.");
    return;
  }
  setState(next);
});
nodes.boostButton.addEventListener("click", () => setState(activateBoost(state)));

const animationLoop = (nowMs) => {
  const wasPlaying = state.screen === "playing";
  const next = tick(state, nowMs);
  const didFinish = wasPlaying && next.screen === "summary";
  state = next;
  window.score = state.lifetimeCoins;
  if (nowMs - lastRenderAt >= UI_REFRESH_MS || didFinish) {
    lastRenderAt = nowMs;
    render();
  }
  if (didFinish) persistence.pushSave();
  requestAnimationFrame(animationLoop);
};

const testMode = (() => {
  try { return new URL(document.baseURI).searchParams.get("burgerTest") === "1"; }
  catch (error) { console.warn("[Burger Rush] Could not read test mode.", error); return false; }
})();

const publishTestResult = (result) => {
  document.title = result;
  try {
    if (parent !== window) parent.document.title = result;
  } catch (error) {
    console.warn("[Burger Rush] Could not publish framed test result.", error);
  }
};

const runSelfTest = () => {
  try {
    const startingLifetime = state.lifetimeCoins;
    setState(startDay(state, MILLISECONDS_PER_SECOND), false);
    const hasStarted = state.screen === "playing" && state.session?.status === "playing";
    setState(tick(state, state.session.endsAt + 1), false);
    const hasCompleted = state.screen === "summary" && state.session?.result !== null;
    const highSave = {...snapshot(state), coins:TEST_PROGRESS_GAIN, lifetimeCoins:startingLifetime + TEST_PROGRESS_GAIN};
    setState(createGameState(), false);
    window.dispatchEvent(new MessageEvent("message", {data:{__pbLoadSave:1, data:highSave}}));
    const didRoundTrip = state.lifetimeCoins === highSave.lifetimeCoins;
    const staleSave = {...highSave, coins:0, lifetimeCoins:highSave.lifetimeCoins - 1};
    window.dispatchEvent(new MessageEvent("message", {data:{__pbLoadSave:1, data:staleSave}}));
    const didRejectStale = state.lifetimeCoins === highSave.lifetimeCoins && state.coins === highSave.coins;
    persistence.pushSave();
    window.setTimeout(() => {
      let didReachHarness = true;
      try {
        if (parent !== window && parent.PB) {
          const stored = JSON.parse(parent.localStorage.getItem("pb_save_burger") || "null");
          didReachHarness = stored?.lifetimeCoins === highSave.lifetimeCoins;
        }
      } catch (error) {
        console.error("[Burger Rush] Harness save check failed.", error);
        didReachHarness = false;
      }
      const isPass = hasStarted && hasCompleted && didRoundTrip && didRejectStale && didReachHarness;
      publishTestResult(isPass ? "BR_TEST_PASS started completed save-roundtrip stale-guard" : "BR_TEST_FAIL assertion");
      render();
    }, TEST_DELAY_MS);
  } catch (error) {
    console.error("[Burger Rush] Self-test failed.", error);
    publishTestResult(`BR_TEST_FAIL ${error.name}`);
  }
};

/* Debug handle for the self-test only — never exposed during normal play,
 * where it would be a ready-made cheat handle for the shared leaderboard. */
if (testMode) window.__burgerTest = Object.freeze({
  getState:() => state,
  start:(nowMs = performance.now()) => setState(startDay(state, nowMs)),
  advance:(nowMs) => setState(tick(state, nowMs)),
  save:() => snapshot(state),
});

render();
requestAnimationFrame(animationLoop);
if (testMode) window.setTimeout(runSelfTest, TEST_DELAY_MS);
