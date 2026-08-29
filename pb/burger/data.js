export const VERSION = 1;

export const GAME_LIMITS = Object.freeze({
  maxDay: 20,
  maxCombo: 4,
  comboWindowMs: 3_000,
  minimumTapSizePx: 44,
});

export const TIMING = Object.freeze({
  rawStageMs: 400,
  grillCookMs: 7_000,
  grillSpeedStepMs: 650,
  grillMinimumMs: 3_100,
  grillReadyMs: 10_000,
  grillGuardStepMs: 3_000,
  fryerCookMs: 8_000,
  fryerSpeedStepMs: 750,
  fryerMinimumMs: 3_500,
  fryerReadyMs: 12_000,
  drinkFillMs: 5_000,
  drinkSpeedStepMs: 350,
  drinkMinimumMs: 3_250,
  helperIntervalMs: 4_500,
  helperStepMs: 900,
  boostDurationMs: 6_000,
  boostCooldownMs: 30_000,
  extraDayMs: 10_000,
});

export const ITEMS = Object.freeze({
  burger: {id:"burger", name:"Classic Burger", value:18, kind:"burger"},
  cheeseburger: {id:"cheeseburger", name:"Cheeseburger", value:24, kind:"burger"},
  greenBurger: {id:"greenBurger", name:"Green Burger", value:25, kind:"burger"},
  tomatoBurger: {id:"tomatoBurger", name:"Tomato Burger", value:25, kind:"burger"},
  deluxeBurger: {id:"deluxeBurger", name:"Deluxe Burger", value:34, kind:"burger"},
  doubleBurger: {id:"doubleBurger", name:"Double Burger", value:38, kind:"burger"},
  fries: {id:"fries", name:"Fries", value:14, kind:"side"},
  cola: {id:"cola", name:"Cola", value:10, kind:"drink"},
  lemonade: {id:"lemonade", name:"Lemonade", value:13, kind:"drink"},
  shake: {id:"shake", name:"Milkshake", value:19, kind:"drink"},
});

export const RECIPES = Object.freeze([
  {id:"burger", day:1, patties:1, toppings:[]},
  {id:"cheeseburger", day:8, patties:1, toppings:["cheese"]},
  {id:"greenBurger", day:10, patties:1, toppings:["lettuce"]},
  {id:"tomatoBurger", day:12, patties:1, toppings:["tomato"]},
  {id:"deluxeBurger", day:14, patties:1, toppings:["cheese", "lettuce", "tomato"]},
  {id:"doubleBurger", day:16, patties:2, toppings:["cheese"]},
]);

export const UNLOCKS = Object.freeze({
  fries: 3,
  cola: 6,
  cheese: 8,
  lettuce: 10,
  tomato: 12,
  lemonade: 13,
  doubleBurger: 16,
  shake: 18,
});

export const DAYS = Object.freeze([
  {day:1, durationSeconds:60, goal:70, arrivalMs:10_500, patienceMs:34_000, maxOrder:1},
  {day:2, durationSeconds:65, goal:105, arrivalMs:9_800, patienceMs:33_000, maxOrder:1},
  {day:3, durationSeconds:65, goal:145, arrivalMs:9_300, patienceMs:33_000, maxOrder:2},
  {day:4, durationSeconds:70, goal:190, arrivalMs:8_900, patienceMs:32_000, maxOrder:2},
  {day:5, durationSeconds:70, goal:235, arrivalMs:8_500, patienceMs:32_000, maxOrder:2},
  {day:6, durationSeconds:75, goal:290, arrivalMs:8_100, patienceMs:31_000, maxOrder:2},
  {day:7, durationSeconds:75, goal:350, arrivalMs:7_800, patienceMs:31_000, maxOrder:2},
  {day:8, durationSeconds:80, goal:420, arrivalMs:7_500, patienceMs:30_000, maxOrder:2},
  {day:9, durationSeconds:80, goal:490, arrivalMs:7_200, patienceMs:30_000, maxOrder:2},
  {day:10, durationSeconds:85, goal:570, arrivalMs:7_000, patienceMs:29_500, maxOrder:3},
  {day:11, durationSeconds:85, goal:650, arrivalMs:6_800, patienceMs:29_000, maxOrder:3},
  {day:12, durationSeconds:90, goal:745, arrivalMs:6_600, patienceMs:28_500, maxOrder:3},
  {day:13, durationSeconds:90, goal:840, arrivalMs:6_400, patienceMs:28_000, maxOrder:3},
  {day:14, durationSeconds:95, goal:950, arrivalMs:6_200, patienceMs:27_500, maxOrder:3},
  {day:15, durationSeconds:95, goal:1_060, arrivalMs:6_000, patienceMs:27_000, maxOrder:3},
  {day:16, durationSeconds:100, goal:1_185, arrivalMs:5_800, patienceMs:26_500, maxOrder:3},
  {day:17, durationSeconds:105, goal:1_315, arrivalMs:5_650, patienceMs:26_000, maxOrder:3},
  {day:18, durationSeconds:110, goal:1_460, arrivalMs:5_500, patienceMs:25_500, maxOrder:4},
  {day:19, durationSeconds:115, goal:1_620, arrivalMs:5_350, patienceMs:25_000, maxOrder:4},
  {day:20, durationSeconds:120, goal:1_800, arrivalMs:5_200, patienceMs:24_500, maxOrder:4},
]);

export const KITCHEN_UPGRADES = Object.freeze([
  {id:"grillSlots", name:"Grill slots", description:"Cook more patties together.", base:1, max:3, costs:[120, 380, 850]},
  {id:"grillSpeed", name:"Grill speed", description:"Patties cook faster.", base:0, max:4, costs:[90, 240, 520, 980]},
  {id:"burnGuard", name:"Burn guard", description:"Extends the ready window.", base:0, max:3, costs:[100, 300, 700]},
  {id:"fryerBaskets", name:"Fryer baskets", description:"Fry more portions together.", base:1, max:2, costs:[220, 620]},
  {id:"fryerSpeed", name:"Fryer speed", description:"Fries cook faster.", base:0, max:4, costs:[130, 320, 650, 1_100]},
  {id:"drinkTaps", name:"Drink taps", description:"Fill more drinks together.", base:1, max:2, costs:[300, 780]},
  {id:"traySlots", name:"Tray slots", description:"Hold more finished items.", base:2, max:4, costs:[100, 260, 560, 1_000]},
  {id:"counterPositions", name:"Counter positions", description:"Serve more customers at once.", base:3, max:2, costs:[420, 1_050]},
]);

export const INTERIOR_UPGRADES = Object.freeze([
  {id:"plants", name:"Plants", description:"A calmer queue.", max:3, patience:0.025, tip:0.01, costs:[110, 310, 690]},
  {id:"chairs", name:"Chairs", description:"Waiting feels shorter.", max:3, patience:0.035, tip:0.005, costs:[160, 400, 820]},
  {id:"tv", name:"TV", description:"Keeps guests entertained.", max:3, patience:0.04, tip:0.01, costs:[250, 590, 1_100]},
  {id:"neon", name:"Neon sign", description:"Makes the restaurant memorable.", max:3, patience:0.015, tip:0.025, costs:[190, 470, 950]},
  {id:"floor", name:"New floor", description:"A polished first impression.", max:3, patience:0.02, tip:0.02, costs:[230, 550, 1_050]},
  {id:"music", name:"Music", description:"Better mood, better tips.", max:3, patience:0.03, tip:0.02, costs:[280, 660, 1_250]},
]);

export const PREMIUM_UPGRADES = Object.freeze([
  {id:"helper", name:"Serving helper", description:"Automatically serves a matching tray item.", max:3, costs:[1, 2, 3]},
  {id:"instant", name:"Instant-cook boost", description:"Adds a short instant-cook boost on cooldown.", max:2, costs:[1, 3]},
  {id:"extraTime", name:"Extra day time", description:"Adds 10 seconds to every day.", max:3, costs:[1, 2, 3]},
]);
