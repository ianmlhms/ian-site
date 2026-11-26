/* Burger-Restaurant: every number and every text of the game. The simulation (sim.js) and the view (view.js) read only this. */
export const VERSION = 1;   // save format version: unchanged since the game shipped (see save.js)

export const GAME_LIMITS = Object.freeze({
  maxDay: 20,
  maxCombo: 4,
  comboWindowMs: 3_000,
});

export const TIMING = Object.freeze({
  stepMs: 1000 / 60,          // one fixed simulation step
  maxFrameMs: 250,            // a longer frame (tab switch, slow device) is cut, the clock never jumps
  grillCookMs: 7_000,
  grillSpeedStepMs: 650,
  grillMinimumMs: 3_100,
  grillReadyMs: 10_000,       // time a cooked patty can wait before it burns
  grillGuardStepMs: 3_000,
  fryerCookMs: 8_000,
  fryerSpeedStepMs: 750,
  fryerMinimumMs: 3_500,
  fryerReadyMs: 12_000,
  drinkFillMs: 4_500,
  helperIntervalMs: 4_500,
  helperStepMs: 900,
  helperMinimumMs: 1_800,
  boostDurationMs: 6_000,
  boostLevelStepMs: 2_000,
  boostCooldownMs: 30_000,
  extraDayMs: 10_000,
  firstCustomerMs: 1_200,     // the first guest of a day is at the counter almost at once
  emptyCounterMs: 1_500,      // an empty counter never waits longer than this for the next guest
  freedSlotMs: 900,           // a guest who left is replaced after at least this
  discardWindowMs: 2_200,     // second tap on an unwanted tray item within this throws it away
});

/* label = the short word under the picture on an order card */
export const ITEMS = Object.freeze({
  burger:{id:"burger", name:"Burger", label:"Burger", value:18, kind:"burger"},
  cheeseburger:{id:"cheeseburger", name:"Cheeseburger", label:"Kéis", value:24, kind:"burger"},
  greenBurger:{id:"greenBurger", name:"Zalot-Burger", label:"Zalot", value:25, kind:"burger"},
  tomatoBurger:{id:"tomatoBurger", name:"Tomate-Burger", label:"Tomat", value:25, kind:"burger"},
  deluxeBurger:{id:"deluxeBurger", name:"Burger mat allem", label:"Alles", value:34, kind:"burger"},
  doubleBurger:{id:"doubleBurger", name:"Duebel-Burger", label:"Duebel", value:38, kind:"burger"},
  fries:{id:"fries", name:"Fritten", label:"Fritten", value:14, kind:"side"},
  cola:{id:"cola", name:"Cola", label:"Cola", value:10, kind:"drink"},
  lemonade:{id:"lemonade", name:"Limonad", label:"Limonad", value:13, kind:"drink"},
  shake:{id:"shake", name:"Milkshake", label:"Shake", value:19, kind:"drink"},
});

export const RECIPES = Object.freeze([
  {id:"burger", day:1, patties:1, toppings:[]},
  {id:"cheeseburger", day:8, patties:1, toppings:["cheese"]},
  {id:"greenBurger", day:10, patties:1, toppings:["lettuce"]},
  {id:"tomatoBurger", day:12, patties:1, toppings:["tomato"]},
  {id:"deluxeBurger", day:14, patties:1, toppings:["cheese", "lettuce", "tomato"]},
  {id:"doubleBurger", day:16, patties:2, toppings:["cheese"]},
]);

export const TOPPINGS = Object.freeze([
  {id:"cheese", name:"Kéis", key:"k"},
  {id:"lettuce", name:"Zalot", key:"z"},
  {id:"tomato", name:"Tomat", key:"t"},
]);
export const DRINKS = Object.freeze(["cola", "lemonade", "shake"]);

export const UNLOCKS = Object.freeze({
  fries:3,
  cola:6,
  cheese:8,
  lettuce:10,
  tomato:12,
  lemonade:13,
  doubleBurger:16,
  shake:18,
});

/* One row per day: length, coin goal, mean gap between guests, patience, longest order.
 * Tuned (Nov 2026) with a simulated player that needs 0.6 / 0.9 / 1.2 s per tap and buys upgrades as it goes: guests come
 * often enough that the player's speed, not the door, limits the coins, and a goal is about 3/4 of what the 0.9 s player
 * earns that day (the old goals from day 6 on asked for more than a perfect player could earn). */
export const DAYS = Object.freeze([
  {day:1, durationSeconds:60, goal:70, arrivalMs:7000, patienceMs:32000, maxOrder:1},
  {day:2, durationSeconds:65, goal:105, arrivalMs:6850, patienceMs:31500, maxOrder:1},
  {day:3, durationSeconds:65, goal:145, arrivalMs:6650, patienceMs:31000, maxOrder:2},
  {day:4, durationSeconds:70, goal:190, arrivalMs:6500, patienceMs:30500, maxOrder:2},
  {day:5, durationSeconds:70, goal:235, arrivalMs:6350, patienceMs:30500, maxOrder:2},
  {day:6, durationSeconds:75, goal:270, arrivalMs:6150, patienceMs:30000, maxOrder:2},
  {day:7, durationSeconds:75, goal:295, arrivalMs:6000, patienceMs:29500, maxOrder:2},
  {day:8, durationSeconds:80, goal:330, arrivalMs:5800, patienceMs:29000, maxOrder:2},
  {day:9, durationSeconds:80, goal:355, arrivalMs:5650, patienceMs:28500, maxOrder:2},
  {day:10, durationSeconds:85, goal:400, arrivalMs:5500, patienceMs:28000, maxOrder:3},
  {day:11, durationSeconds:85, goal:440, arrivalMs:5300, patienceMs:28000, maxOrder:3},
  {day:12, durationSeconds:90, goal:475, arrivalMs:5150, patienceMs:27500, maxOrder:3},
  {day:13, durationSeconds:90, goal:500, arrivalMs:5000, patienceMs:27000, maxOrder:3},
  {day:14, durationSeconds:95, goal:530, arrivalMs:4800, patienceMs:26500, maxOrder:3},
  {day:15, durationSeconds:95, goal:560, arrivalMs:4650, patienceMs:26000, maxOrder:3},
  {day:16, durationSeconds:100, goal:585, arrivalMs:4450, patienceMs:25500, maxOrder:3},
  {day:17, durationSeconds:105, goal:610, arrivalMs:4300, patienceMs:25500, maxOrder:3},
  {day:18, durationSeconds:110, goal:650, arrivalMs:4150, patienceMs:25000, maxOrder:4},
  {day:19, durationSeconds:115, goal:675, arrivalMs:3950, patienceMs:24500, maxOrder:4},
  {day:20, durationSeconds:120, goal:700, arrivalMs:3800, patienceMs:24000, maxOrder:4},
]);

/* Upgrade ids and level counts are part of the save format (kit / int / prem): never rename or shorten them. */
export const KITCHEN_UPGRADES = Object.freeze([
  {id:"grillSlots", name:"Méi Plaz um Grill", description:"Méi Fleesch gläichzäiteg broden.", base:1, max:3, costs:[120, 380, 850]},
  {id:"grillSpeed", name:"Méi séier grillen", description:"D'Fleesch gëtt méi séier fäerdeg.", base:0, max:4, costs:[90, 240, 520, 980]},
  {id:"burnGuard", name:"Schutz géint Verbrennen", description:"Fäerdegt Fleesch brauch méi laang, bis et verbrennt.", base:0, max:3, costs:[100, 300, 700]},
  {id:"fryerBaskets", name:"Méi Kierf fir d'Fritten", description:"Méi Fritte gläichzäiteg frittéieren.", base:1, max:2, costs:[220, 620]},
  {id:"fryerSpeed", name:"Méi séier frittéieren", description:"D'Fritte gi méi séier fäerdeg.", base:0, max:4, costs:[130, 320, 650, 1_100]},
  {id:"drinkTaps", name:"Méi Krunnen", description:"Méi Gedrénks gläichzäiteg zappen.", base:1, max:2, costs:[300, 780]},
  {id:"traySlots", name:"Méi Plaz um Plateau", description:"Méi fäerdeg Saache waarde loossen.", base:2, max:4, costs:[100, 260, 560, 1_000]},
  {id:"counterPositions", name:"Méi Plaz um Comptoir", description:"Méi Cliente gläichzäiteg bedéngen.", base:3, max:2, costs:[420, 1_050]},
]);

export const INTERIOR_UPGRADES = Object.freeze([
  {id:"plants", name:"Planzen", description:"D'Cliente waarde méi roueg.", max:3, patience:0.025, tip:0.01, costs:[110, 310, 690]},
  {id:"chairs", name:"Still", description:"D'Waarden ass manner laang.", max:3, patience:0.035, tip:0.005, costs:[160, 400, 820]},
  {id:"tv", name:"Fernseh", description:"D'Clienten hunn eppes ze kucken.", max:3, patience:0.04, tip:0.01, costs:[250, 590, 1_100]},
  {id:"neon", name:"Liichtreklamm", description:"Däi Restaurant fält op.", max:3, patience:0.015, tip:0.025, costs:[190, 470, 950]},
  {id:"floor", name:"Neie Buedem", description:"E schéinen éischten Androck.", max:3, patience:0.02, tip:0.02, costs:[230, 550, 1_050]},
  {id:"music", name:"Musek", description:"Besser Laun, méi Drénkgeld.", max:3, patience:0.03, tip:0.02, costs:[280, 660, 1_250]},
]);

export const PREMIUM_UPGRADES = Object.freeze([
  {id:"helper", name:"Hëllef beim Zerwéieren", description:"Zerwéiert eleng eppes vum Plateau, wat e Client wëll.", max:3, costs:[1, 2, 3]},
  {id:"instant", name:"Turbo", description:"Grill, Friteuse a Gedrénks sinn op ee Coup fäerdeg.", max:2, costs:[1, 3]},
  {id:"extraTime", name:"Méi Zäit", description:"All Dag dauert 10 Sekonne méi laang.", max:3, costs:[1, 2, 3]},
]);

export const UPGRADE_TABLES = Object.freeze({kit:KITCHEN_UPGRADES, int:INTERIOR_UPGRADES, prem:PREMIUM_UPGRADES});
