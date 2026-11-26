/* Burger-Restaurant view. The DOM is built once; update() only changes what differs from the last frame (classes, text,
 * transforms), so a finger on a button keeps the same button until it lifts (the old view rebuilt everything every 100 ms and
 * swallowed taps). Elements carry data-act / data-index for main.js, which listens once on the whole document. */
import {DRINKS, GAME_LIMITS, ITEMS, RECIPES, TOPPINGS, UNLOCKS} from "/pb/burger/data.js?v=2";
import {dayDurationMs, isUnlocked, isWanted, levelFor, patienceRatio, recipeOnBoard, stationCapacity, upgradeLevel} from "/pb/burger/sim.js?v=3";
import {MESSAGES} from "/pb/burger/text.js?v=1";

const LEAVE_MS = 480;
const HOT_RATIO = 0.3;           // a ready patty shows red and pulses in its last 30 % before burning
const IMPATIENT_RATIO = 0.25;
const TOAST_MS = 1_800;
const DECO_IDS = Object.freeze(["plants", "chairs", "tv", "neon", "music"]);
const SCENE_ART = new Set(["deco-plants", "deco-chairs", "deco-tv", "deco-neon", "deco-music", "deco-floor", "room-back"]);
const artUrl = (name) => `url("/pb/burger/art/${name}.webp?v=${SCENE_ART.has(name) ? 3 : 1}")`;

const byId = (id) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Burger: #${id} is missing`);
  return node;
};
const el = (tag, className, attrs = {}) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  });
  return node;
};
const setArt = (node, name) => {
  if (node.dataset.art === name) return;
  node.dataset.art = name;
  node.style.backgroundImage = artUrl(name);
};
const art = (name, className = "art") => {
  const node = el("i", className);
  setArt(node, name);
  return node;
};
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const setClass = (node, name, on) => { if (node.classList.contains(name) !== on) node.classList.toggle(name, on); };
const setDisabled = (node, disabled) => { if (node.disabled !== disabled) node.disabled = disabled; };
const setScale = (node, ratio) => {
  const value = `scaleX(${Math.max(0, Math.min(1, ratio)).toFixed(3)})`;
  if (node.style.transform !== value) node.style.transform = value;
};
const replay = (node, name) => { node.classList.remove(name); void node.offsetWidth; node.classList.add(name); };

/* A burger as stacked layers: bun, patties, toppings, bun. */
const BURGER_LAYERS = (patties, toppings) => [
  "bun-bottom",
  ...Array.from({length:patties}, () => "patty-cooked"),
  ...["cheese", "lettuce", "tomato"].filter((topping) => toppings.includes(topping)),
  "bun-top",
];
function burgerStack(patties, toppings) {
  const stack = el("span", "burger-stack");
  const layers = BURGER_LAYERS(patties, toppings);
  layers.forEach((name, index) => {
    const layer = art(name, "");
    layer.style.transform = `translateY(${((layers.length - 1) / 2 - index) * 9}%) scale(.86)`;
    stack.append(layer);
  });
  return stack;
}
function itemArt(itemId) {
  const recipe = RECIPES.find((entry) => entry.id === itemId);
  if (recipe) return burgerStack(recipe.patties, recipe.toppings);
  return art(itemId === "fries" ? "fries-cooked" : itemId);
}

const formatTime = (ms) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function createView() {
  const nodes = {
    scene:byId("scene"), deco:byId("deco"), customers:byId("customers"), tray:byId("tray"), hint:byId("hint"), pops:byId("pops"),
    grill:byId("grill"), fryer:byId("fryer"), drinks:byId("drinks"), drinkButtons:byId("drinkButtons"), toppings:byId("toppings"),
    board:byId("board"), plateButton:byId("plateButton"), plateLabel:byId("plateLabel"), trashButton:byId("trashButton"),
    fryerLock:byId("fryerLock"), drinkLock:byId("drinkLock"),
    hudDay:byId("hudDay"), goalFill:byId("goalFill"), goalText:byId("goalText"), hudTime:byId("hudTime"),
    hudCombo:byId("hudCombo"), comboCell:byId("comboCell"), hudCoins:byId("hudCoins"),
    boostButton:byId("boostButton"), boostLabel:byId("boostLabel"), pauseButton:byId("pauseButton"),
    overlay:byId("overlay"), panelTitle:byId("panelTitle"), panelStars:byId("panelStars"), panelMessage:byId("panelMessage"),
    panelDetail:byId("panelDetail"), howto:byId("howto"), shopButton:byId("shopButton"), startButton:byId("startButton"),
    toast:byId("toast"),
  };
  document.querySelectorAll(".station-title .sprite").forEach((node) => { node.style.backgroundImage = artUrl(node.dataset.art); });

  /* the scene size drives the CSS (customer, order and tray sizes); also after a rotation */
  let capacity = 3;
  const resize = () => {
    const box = nodes.scene.getBoundingClientRect();
    nodes.scene.style.setProperty("--scene-h", `${Math.round(box.height)}px`);
    nodes.scene.style.setProperty("--scene-w", `${Math.round(box.width)}px`);
    const itemSize = Math.round(Math.max(24, Math.min(44, box.width / capacity / 3.4, box.height * 0.11)));
    nodes.customers.style.setProperty("--slots", capacity);
    nodes.customers.style.setProperty("--item", `${itemSize}px`);
  };
  if (window.ResizeObserver) new ResizeObserver(resize).observe(nodes.scene);
  window.addEventListener("resize", resize);
  resize();

  /* fixed controls, built once */
  const drinkButtons = DRINKS.map((id) => {
    const button = el("button", "drink-button", {type:"button", "data-act":"pour", "data-item":id});
    const label = el("span");
    button.append(art(id), label);
    nodes.drinkButtons.append(button);
    return {id, button, label};
  });
  const toppingButtons = TOPPINGS.map((topping) => {
    const button = el("button", "topping", {type:"button", "data-act":"topping", "data-item":topping.id});
    const label = el("span");
    button.append(art(topping.id), label, el("kbd", "", {text:topping.key.toUpperCase()}));
    nodes.toppings.append(button);
    return {...topping, button, label};
  });

  /* station slots: rebuilt only when the number of slots changes (a new day after an upgrade) */
  const stationSlots = {grill:[], fryer:[], drinks:[]};
  const ensureSlots = (station, count) => {
    const list = stationSlots[station];
    if (list.length === count) return list;
    const container = nodes[station];
    container.replaceChildren();
    container.style.setProperty("--n", count);
    stationSlots[station] = Array.from({length:count}, (_, index) => {
      const button = el("button", "slot empty", {type:"button", "data-act":station, "data-index":index});
      const picture = el("i", "art");
      const label = el("span", "label");
      const bar = el("span", "bar");
      const fill = el("i");
      bar.append(fill);
      button.append(picture, label, bar);
      container.append(button);
      return {button, picture, label, bar, fill, key:""};
    });
    return stationSlots[station];
  };

  const traySlots = [];
  const ensureTray = (count) => {
    while (traySlots.length < count) {
      const index = traySlots.length;
      const button = el("button", "tray-slot", {type:"button", "data-act":"tray", "data-index":index, "aria-label":MESSAGES.trayEmpty});
      nodes.tray.append(button);
      traySlots.push({button, key:null});
    }
    traySlots.forEach((slot, index) => { slot.button.hidden = index >= count; });
  };

  /* guests: one element per guest, placed in its counter column; a leaving guest stays until its animation ends */
  const guests = new Map();   // id -> {root, items, fill, bar, slot, leaveAt}
  const createGuest = (customer) => {
    const root = el("button", "guest", {type:"button", "data-act":"guest", "data-index":customer.slot});
    root.style.gridColumn = String(customer.slot + 1);
    root.style.gridRow = "1";
    const order = el("span", "order");
    const items = customer.order.map((itemId) => {
      const item = el("span", "order-item");
      item.append(itemArt(itemId), el("span", "", {text:ITEMS[itemId].label}));
      order.append(item);
      return item;
    });
    const bar = el("span", "patience");
    const fill = el("i");
    bar.append(fill);
    order.append(bar);
    const picture = el("span", "guest-art");
    setArt(picture, `customer-${customer.art}`);
    root.append(order, picture);
    root.setAttribute("aria-label", MESSAGES.guestWants(customer.order.map((id) => ITEMS[id].name)));
    nodes.customers.append(root);
    return {root, items, bar, fill, slot:customer.slot, leaveAt:0, left:null};
  };
  const updateGuest = (guest, customer, t) => {
    if (guest.left !== customer.left) {
      guest.left = customer.left;
      const counts = customer.left.reduce((acc, id) => ({...acc, [id]:(acc[id] || 0) + 1}), {});
      customer.order.forEach((itemId, index) => {
        const isOpen = counts[itemId] > 0;
        if (isOpen) counts[itemId] -= 1;
        setClass(guest.items[index], "done", !isOpen);
      });
    }
    const ratio = patienceRatio(customer, t);
    setScale(guest.fill, ratio);
    setClass(guest.bar, "mid", ratio < 0.5 && ratio >= IMPATIENT_RATIO);
    setClass(guest.bar, "low", ratio < IMPATIENT_RATIO);
    setClass(guest.root, "impatient", ratio < IMPATIENT_RATIO);
  };
  const leaveGuest = (id, kind, now) => {
    const guest = guests.get(id);
    if (!guest || guest.leaveAt) return;
    guest.leaveAt = now + LEAVE_MS;
    guest.root.classList.add(kind === "served" ? "served" : "angry", "leaving");
    guest.root.removeAttribute("data-act");
  };

  let boardKey = "";
  let decoKey = "";
  let toastUntil = 0;

  function updateCustomers(session, now) {
    if (session.capacity !== capacity) {
      capacity = session.capacity;
      resize();
    }
    const present = new Set();
    session.customers.forEach((customer) => {
      present.add(customer.id);
      const guest = guests.get(customer.id) || guests.set(customer.id, createGuest(customer)).get(customer.id);
      updateGuest(guest, customer, session.t);
    });
    guests.forEach((guest, id) => {
      if (!present.has(id) && !guest.leaveAt) leaveGuest(id, "served", now);
      if (guest.leaveAt && now >= guest.leaveAt) { guest.root.remove(); guests.delete(id); }
    });
  }
  const clearGuests = () => { guests.forEach((guest) => guest.root.remove()); guests.clear(); };

  let trayKeys = new Set();     // items already shown: one moving up a place after a sale does not "pop" again
  function updateTray(session, isPlaying) {
    ensureTray(session.trayCapacity);
    const shown = trayKeys;
    trayKeys = new Set(session.tray.map((item) => item.key));
    traySlots.forEach((slot, index) => {
      if (index >= session.trayCapacity) return;
      const item = session.tray[index];
      const key = item ? item.key : null;
      if (slot.key !== key) {
        slot.key = key;
        slot.button.replaceChildren();
        slot.button.classList.remove("unwanted");
        if (item) {
          slot.button.append(itemArt(item.id), el("span", "tag", {text:ITEMS[item.id].label}));
          slot.button.setAttribute("aria-label", MESSAGES.serve(ITEMS[item.id].name));
          if (shown.has(key)) slot.button.classList.add("filled"); else replay(slot.button, "filled");
        } else {
          slot.button.classList.remove("filled");
          slot.button.setAttribute("aria-label", MESSAGES.trayEmpty);
        }
      }
      setDisabled(slot.button, !item || !isPlaying);
    });
  }

  function updateHeat(station, session, isPlaying) {
    const isLocked = station === "fryer" && !isUnlocked(session.day, "fries");
    const slots = ensureSlots(station, session[station].length);
    const raw = station === "grill" ? "patty-raw" : "fries-raw";
    const done = station === "grill" ? "patty-cooked" : "fries-cooked";
    const burnt = station === "grill" ? "patty-burnt" : "fries-burnt";
    session[station].forEach((slot, index) => {
      const view = slots[index];
      const t = session.t;
      let picture = raw, label = MESSAGES.tapToCook, ratio = 0, hot = false;
      if (slot.state === "cooking") {
        ratio = (t - slot.startAt) / Math.max(1, slot.readyAt - slot.startAt);
        picture = ratio > 0.5 ? done : raw;
        label = MESSAGES.cooking;
      } else if (slot.state === "ready") {
        ratio = (slot.burnAt - t) / Math.max(1, slot.burnAt - slot.readyAt);
        picture = done;
        label = station === "grill" ? MESSAGES.readyPatty : MESSAGES.readyFries;
        hot = ratio < HOT_RATIO && t >= slot.readyAt && slot.burnAt > t && !(t < session.boostUntil);
      } else if (slot.state === "burnt") {
        picture = burnt;
        label = MESSAGES.burnt;
      }
      const key = `${slot.state}`;
      if (view.key !== key) {
        view.key = key;
        view.button.className = `slot ${slot.state}`;
        view.button.setAttribute("aria-label", `${station === "grill" ? "Grill" : "Friteuse"} ${index + 1}: ${label}`);
      }
      setClass(view.button, "hot", hot);
      setArt(view.picture, picture);
      setText(view.label, isLocked ? "" : label);
      view.bar.hidden = !(slot.state === "cooking" || slot.state === "ready");
      setScale(view.fill, ratio);
      setDisabled(view.button, !isPlaying || isLocked);
    });
    if (station === "fryer") {
      nodes.fryerLock.hidden = !isLocked;
      setText(nodes.fryerLock, MESSAGES.fromDay(UNLOCKS.fries));
    }
  }

  function updateDrinks(session, isPlaying) {
    const isLocked = !isUnlocked(session.day, "cola");
    nodes.drinkLock.hidden = !isLocked;
    setText(nodes.drinkLock, MESSAGES.fromDay(UNLOCKS.cola));
    drinkButtons.forEach(({id, button, label}) => {
      const open = isUnlocked(session.day, id);
      setText(label, open ? ITEMS[id].label : MESSAGES.dayShort(UNLOCKS[id]));
      setDisabled(button, !open || !isPlaying);
    });
    const slots = ensureSlots("drinks", session.drinks.length);
    session.drinks.forEach((slot, index) => {
      const view = slots[index];
      const key = `${slot.state}:${slot.item || ""}`;
      if (view.key !== key) {
        view.key = key;
        view.button.className = `slot ${slot.state === "filling" ? "cooking" : slot.state}`;
        setArt(view.picture, slot.item || "cola");
        setText(view.label, slot.state === "ready" ? MESSAGES.readyDrink : slot.state === "filling" ? MESSAGES.filling : MESSAGES.pickDrink);
        view.button.setAttribute("aria-label", `${MESSAGES.tap} ${index + 1}: ${view.label.textContent}`);
      }
      view.bar.hidden = slot.state !== "filling";
      if (slot.state === "filling") setScale(view.fill, (session.t - slot.startAt) / Math.max(1, slot.readyAt - slot.startAt));
      setDisabled(view.button, !isPlaying || slot.state === "empty" || isLocked);
    });
  }

  function updateBoard(session, isPlaying) {
    const {board} = session;
    const key = `${board.patties}:${[...board.toppings].sort().join(",")}`;
    if (key !== boardKey) {
      boardKey = key;
      nodes.board.replaceChildren(board.patties || board.toppings.length ? burgerStack(board.patties, board.toppings) : art("plate"));
      setClass(nodes.board, "filled", board.patties > 0);
      if (board.patties || board.toppings.length) replay(nodes.board, "bump");
    }
    toppingButtons.forEach(({id, name, button, label}) => {
      const open = isUnlocked(session.day, id);
      setText(label, open ? name : MESSAGES.dayShort(UNLOCKS[id]));
      setClass(button, "on", board.toppings.includes(id));
      button.setAttribute("aria-pressed", String(board.toppings.includes(id)));
      setDisabled(button, !open || !isPlaying);
    });
    const recipe = recipeOnBoard(session);
    const label = !recipe ? (board.patties ? MESSAGES.noRecipe : MESSAGES.plate)
      : isWanted(session, recipe.id) ? MESSAGES.serveRecipe(ITEMS[recipe.id].name) : MESSAGES.plateRecipe(ITEMS[recipe.id].name);
    setText(nodes.plateLabel, label);
    setDisabled(nodes.plateButton, !isPlaying || !board.patties);
    setDisabled(nodes.trashButton, !isPlaying || (!board.patties && !board.toppings.length));
  }

  function updateHud(state) {
    const {progress, session} = state;
    const level = levelFor(progress.day);
    const day = session ? session.day : level.day;
    const goal = session ? session.goal : level.goal;
    const earned = session ? session.earned : 0;
    setText(nodes.hudDay, String(day));
    setScale(nodes.goalFill, earned / goal);
    setClass(nodes.goalFill.parentElement, "done", earned >= goal);
    setText(nodes.goalText, `${earned} / ${goal}`);
    const remaining = state.screen === "summary" ? 0 : session ? session.durationMs - session.t : dayDurationMs(progress);
    setText(nodes.hudTime, formatTime(remaining));
    const comboActive = !!session && session.t - session.lastCompleteAt <= GAME_LIMITS.comboWindowMs && session.combo > 1;
    setText(nodes.hudCombo, `×${comboActive ? session.combo : 1}`);
    setClass(nodes.comboCell, "hot", comboActive);
    setText(nodes.hudCoins, String(progress.coins));
    const boostLevel = upgradeLevel(progress, "prem", "instant");
    nodes.boostButton.hidden = !boostLevel;
    if (boostLevel) {
      const isPlaying = state.screen === "playing";
      const wait = session ? Math.max(0, session.boostReadyAt - session.t) : 0;
      const active = !!session && session.t < session.boostUntil;
      setText(nodes.boostLabel, active ? MESSAGES.boostOn : wait > 0 ? `${MESSAGES.boost} ${Math.ceil(wait / 1000)} s` : MESSAGES.boost);
      setDisabled(nodes.boostButton, !isPlaying || wait > 0);
    }
    setDisabled(nodes.pauseButton, !(state.screen === "playing" || state.screen === "paused"));
  }

  function updateDeco(progress) {
    const key = [...DECO_IDS, "floor"].map((id) => upgradeLevel(progress, "int", id)).join("");
    if (key === decoKey) return;
    decoKey = key;
    const layers = [...DECO_IDS, "floor"].filter((id) => upgradeLevel(progress, "int", id) > 0).map((id) => {
      const image = el("img", `deco-${id}`, {alt:"", decoding:"async", src:`/pb/burger/art/deco-${id}.webp?v=3`});
      image.style.opacity = String(0.7 + 0.1 * upgradeLevel(progress, "int", id));
      return image;
    });
    nodes.deco.replaceChildren(...layers);
  }

  function updateHint(state) {
    const text = state.screen === "playing" ? MESSAGES.hintFor(state) : "";
    nodes.hint.hidden = !text;
    setText(nodes.hint, text);
  }

  function updatePanel(state) {
    const visible = state.screen !== "playing";
    setClass(nodes.overlay, "show", visible);
    if (!visible) return;
    const content = MESSAGES.panel(state);
    setText(nodes.panelTitle, content.title);
    setText(nodes.panelMessage, content.message);
    setText(nodes.panelDetail, content.detail);
    nodes.panelDetail.hidden = !content.detail;
    nodes.howto.hidden = !content.howto;
    setText(nodes.startButton, content.start);
    nodes.shopButton.hidden = state.screen === "paused";
    const stars = content.stars;
    const starKey = stars === null ? "" : String(stars);
    if (nodes.panelStars.dataset.key !== starKey) {
      nodes.panelStars.dataset.key = starKey;
      nodes.panelStars.replaceChildren(...(stars === null ? [] : [0, 1, 2].map((i) => el("i", `star${i < stars ? "" : " off"}`))));
    }
  }

  /* an idle kitchen for the screens between days */
  const idleSession = (progress) => ({
    day:progress.day, goal:levelFor(progress.day).goal, t:0, durationMs:dayDurationMs(progress), earned:0,
    capacity:stationCapacity(progress, "counterPositions"), trayCapacity:stationCapacity(progress, "traySlots"),
    customers:[], tray:[], board:{patties:0, toppings:[]}, combo:1, lastCompleteAt:-Infinity, boostUntil:-1, boostReadyAt:0,
    grill:Array.from({length:stationCapacity(progress, "grillSlots")}, () => ({state:"empty"})),
    fryer:Array.from({length:stationCapacity(progress, "fryerBaskets")}, () => ({state:"empty"})),
    drinks:Array.from({length:stationCapacity(progress, "drinkTaps")}, () => ({state:"empty"})),
  });

  function update(state, now = performance.now()) {
    const isPlaying = state.screen === "playing";
    const session = state.session && state.screen !== "summary" && state.screen !== "intro" ? state.session : idleSession(state.progress);
    if (session.customers.length === 0 && !state.session) clearGuests();
    updateCustomers(session, now);
    updateTray(session, isPlaying);
    updateHeat("grill", session, isPlaying);
    updateHeat("fryer", session, isPlaying);
    updateDrinks(session, isPlaying);
    updateBoard(session, isPlaying);
    updateHud(state);
    updateDeco(state.progress);
    updateHint(state);
    updatePanel(state);
    if (toastUntil && now > toastUntil) { toastUntil = 0; nodes.toast.hidden = true; }
  }

  function toast(message, now = performance.now()) {
    if (!message) return;
    nodes.toast.textContent = message;
    nodes.toast.hidden = false;
    toastUntil = now + TOAST_MS;
  }

  /* a "+23" just above the guest's order card */
  function pop(event, capacity, text, kind = "", lift = 0) {
    const node = el("span", `pop ${kind}`, {text});
    const card = guests.get(event.id)?.root.querySelector(".order");
    const sceneBox = nodes.scene.getBoundingClientRect();
    const box = card?.getBoundingClientRect();
    const left = box ? box.left + box.width / 2 - sceneBox.left : ((event.slot + 0.5) / capacity) * sceneBox.width;
    const top = box ? Math.max(4, box.top - sceneBox.top - 30) : sceneBox.height * 0.2;
    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(top - lift)}px`;
    node.addEventListener("animationend", () => node.remove(), {once:true});
    nodes.pops.append(node);
    if (nodes.pops.childElementCount > 8) nodes.pops.firstElementChild.remove();
  }

  /* sounds are main.js's; here the visual answers to what just happened */
  function feedback(events, state, now = performance.now()) {
    const capacity = state.session?.capacity || 3;
    events.forEach((event) => {
      if (event.type === "served") {
        pop(event, capacity, `+${event.amount}`, event.isComplete && event.combo > 1 ? "combo" : "");
        if (event.isComplete && event.combo > 1) pop(event, capacity, `Combo ×${event.combo}`, "combo", 30);
        if (event.isComplete) leaveGuest(event.id, "served", now);
      } else if (event.type === "walkout") {
        pop(event, capacity, MESSAGES.walkedOut, "bad");
        leaveGuest(event.id, "angry", now);
      } else if (event.type === "refused") {
        toast(MESSAGES.refused[event.reason], now);
        if (event.reason === "unwanted" && state.session?.discard) {
          const index = state.session.tray.findIndex((item) => item.key === state.session.discard.key);
          if (traySlots[index]) replay(traySlots[index].button, "unwanted");
        }
      } else if (event.type === "dayEnd") {
        clearGuests();
      }
    });
  }

  const isAnimating = () => toastUntil > 0 || guests.size > 0 && [...guests.values()].some((guest) => guest.leaveAt);

  return {update, toast, feedback, isAnimating};
}

