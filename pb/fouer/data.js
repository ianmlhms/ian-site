// Schueberfouer Tycoon: frozen rules and catalogue (DOM-free). Section numbers refer to DESIGN.md.
// Item `idx` values are stored in saves as one base-36 character: never renumber, only append.

export const SAVE_VERSION = 2;
export const CASH_CAP = 1e12;
export const PITCH_COUNT = 34;

export const RULES = Object.freeze({
  startCash: 350,
  maxCopies: 3,
  thirdCopyCostMultiplier: 2,        // 11.7: the 3rd copy of a type costs 2 x base
  refundFraction: 0.5,               // replacing an attraction refunds half of what was paid for it
  upgradeFractions: [0.6, 0.8, 2.5], // L1->L2, L2->L3, L3->Gold, as multiples of the base cost
  maxLevel: 3,                       // 0..3 = L1, L2, L3, Gold
  lookCount: 3,
  voucherSlots: 5,
  voucherFreeMaxCost: 6000,          // 7.3: free up to this base cost, otherwise half price
  voucherDiscount: 0.5,
  tutorialDone: 8,
  nameLength: 24,
  giftIdsKept: 50,
});

// Economy model (2.3, retuned in W1 with the greedy bot of harness.js).
export const ECONOMY = Object.freeze({
  guestsBase: 4, guestsPerPoint: 0.35, guestsExponent: 0.9, guestsPerStar: 2,
  usesPerGuest: 3,
  share: Object.freeze({ ride: 0.42, food: 0.40, game: 0.18 }),
});

// Fair rating points needed for stars 1..5.
export const STAR_POINTS = Object.freeze([0, 18, 70, 200, 500]);

// Per upgrade level (L1, L2, L3, Gold): capacity, price and rating multipliers.
export const LEVELS = Object.freeze([
  Object.freeze({ cap: 1, price: 1, appeal: 1 }),
  Object.freeze({ cap: 1.5, price: 1.15, appeal: 1.35 }),
  Object.freeze({ cap: 2, price: 1.3, appeal: 1.7 }),
  Object.freeze({ cap: 2.5, price: 1.45, appeal: 2.1 }),
]);

export const LOOKS = Object.freeze(["traditioun", "neon", "retro"]);

// Pitch footprints in metres and the "own size or one larger" rule. The wheel pitch only takes the wheel.
export const SIZES = Object.freeze({
  S: Object.freeze({ u: 8, w: 8 }), M: Object.freeze({ u: 16, w: 16 }), L: Object.freeze({ u: 30, w: 18 }),
  XL: Object.freeze({ u: 56, w: 30 }), W: Object.freeze({ u: 40, w: 24 }),
});
const SIZE_ORDER = ["S", "M", "L", "XL"];
export function sizeFits(itemSize, pitchSize) {
  if (itemSize === "W" || pitchSize === "W") return itemSize === pitchSize;
  const own = SIZE_ORDER.indexOf(itemSize);
  const diff = SIZE_ORDER.indexOf(pitchSize) - own;
  return own >= 0 && diff >= 0 && diff <= 1;
}

const item = (idx, id, cat, size, cost, cap, price, appeal, star, extra = {}) => Object.freeze({
  idx, id, cat, size, cost, cap, price, appeal, star, max: RULES.maxCopies, nameKey: `item.${id}`, special: null,
  upgradeBase: cost, ...extra,
});

// 3.1 numbers: generic names only (no showman or brand names anywhere).
export const ITEMS = Object.freeze([
  item(1, "kachel", "food", "S", 150, 10, 3, 3, 1),
  item(2, "fritten", "food", "S", 220, 12, 3.5, 3, 1),
  item(3, "lous", "game", "S", 250, 9, 3, 3, 1),
  item(4, "kanner", "ride", "S", 300, 12, 2.5, 4, 1),
  item(5, "wurscht", "food", "S", 480, 14, 4, 4, 2),
  item(6, "zocker", "food", "S", 560, 12, 3.5, 3, 2),
  item(7, "lukas", "game", "S", 580, 10, 3.5, 4, 2),
  item(8, "mandel", "food", "S", 690, 12, 4, 4, 2),
  item(9, "waffel", "food", "S", 750, 14, 4.5, 5, 2),
  item(10, "fesch", "food", "M", 800, 14, 6, 6, 2),
  item(11, "kette", "ride", "M", 1040, 20, 4, 8, 2),
  item(12, "scooter", "ride", "L", 2070, 30, 4.5, 12, 2),
  item(13, "crepes", "food", "S", 1100, 12, 4.5, 4, 3),
  item(14, "schiess", "game", "S", 2040, 12, 4, 6, 3),
  item(15, "bayern", "ride", "M", 4080, 26, 5, 12, 3),
  item(16, "happy", "ride", "M", 3600, 24, 5, 11, 3),
  item(17, "break", "ride", "M", 5440, 28, 5.5, 14, 3),
  item(18, "musik", "ride", "M", 4400, 26, 5, 12, 3),
  item(19, "takeoff", "ride", "M", 5000, 28, 5.5, 13, 3),
  item(20, "tent", "food", "L", 6120, 40, 9, 14, 3),
  item(21, "wheel", "ride", "W", 45000, 70, 7, 50, 3),
  item(22, "maus", "ride", "L", 11050, 34, 6.5, 20, 3),
  item(23, "geister", "ride", "L", 18400, 36, 6.5, 22, 4),
  item(24, "jules", "ride", "M", 21850, 30, 7, 22, 4),
  item(25, "hangover", "ride", "M", 24500, 30, 7, 23, 4),
  item(26, "splash", "ride", "L", 27600, 40, 7.5, 26, 4),
  item(27, "booster", "ride", "L", 32200, 34, 8, 28, 4),
  item(28, "alpina", "ride", "XL", 55200, 56, 8, 40, 4),
  item(29, "looping", "ride", "XL", 100800, 60, 9, 52, 5),
  item(30, "infinity", "ride", "M", 38000, 30, 8, 30, 5),
  // Specials: the pioneer gold carousel and the old-park kiosk are free for pioneers, the Hämmi statue is a stamp reward.
  item(31, "gold", "ride", "M", 0, 24, 5, 6, 0, { special: "pioneer", max: 1, upgradeBase: 1000 }),
  item(32, "museum", "deco", "S", 0, 0, 0, 0, 0, { special: "pioneer", max: 1, upgradeBase: 0 }),
  item(33, "lammy", "deco", "S", 0, 0, 0, 2, 0, { special: "stamps", max: 1, upgradeBase: 0 }),
]);

export const ITEM_BY_ID = Object.freeze(Object.fromEntries(ITEMS.map(entry => [entry.id, entry])));
export const ITEM_BY_INDEX = Object.freeze(Object.fromEntries(ITEMS.map(entry => [entry.idx, entry])));
export const STAMPS_FOR_STATUE = 10;
export const VOUCHERABLE = Object.freeze(ITEMS.filter(entry => entry.special === null).map(entry => entry.id));

// 7.4: what each v1 ride or stall becomes. Anything else (toilets, bins, first aid, scenery) turns into cash.
export const VOUCHER_MAP = Object.freeze({
  carousel: "kanner", "mini-train": "kanner", slide: "kanner",
  teacups: "kette", swing: "kette",
  wheel: "wheel", dodgems: "scooter", "ghost-train": "geister",
  "log-flume": "splash", rapids: "splash", "pirate-ship": "happy",
  "wild-mouse": "maus", "drop-tower": "jules", "wooden-coaster": "alpina",
  "inverted-coaster": "looping", "launch-coaster": "booster",
  popcorn: "mandel", lemonade: "zocker", balloons: "lous", burgers: "wurscht", juice: "crepes",
  gifts: "schiess", pizza: "fesch", smoothies: "waffel", emporium: "tent",
});

// pitches.json is the authored file (W2 and the world baker read it). This copy exists so that sim.js stays
// synchronous and old iPad Safari needs no JSON import; harness.js asserts that both are identical and
// `node pb/fouer/harness.js --sync-pitches` rewrites this block from the JSON.
// BEGIN PITCHES
const PITCH_TABLE = [
  {id:"P01",zone:"M1",u:62,w:41,size:"S",star:1,face:"+w"},
  {id:"P02",zone:"M1",u:72,w:41,size:"S",star:1,face:"+w"},
  {id:"P03",zone:"M1",u:86,w:41,size:"M",star:1,face:"+w"},
  {id:"P04",zone:"N",u:72,w:15,size:"L",star:1,face:"+w"},
  {id:"P05",zone:"N",u:106,w:15,size:"S",star:1,face:"+w"},
  {id:"P06",zone:"N",u:116,w:15,size:"S",star:1,face:"+w"},
  {id:"P07",zone:"M2",u:75,w:71,size:"M",star:1,face:"-w"},
  {id:"P08",zone:"M1",u:112,w:41,size:"M",star:2,face:"+w"},
  {id:"P09",zone:"M1",u:140,w:41,size:"L",star:2,face:"+w"},
  {id:"P10",zone:"N",u:126,w:15,size:"S",star:2,face:"+w"},
  {id:"P11",zone:"N",u:156,w:15,size:"L",star:2,face:"+w"},
  {id:"P12",zone:"N",u:190,w:15,size:"S",star:2,face:"+w"},
  {id:"P13",zone:"M2",u:99,w:72,size:"L",star:2,face:"-w"},
  {id:"P14",zone:"S",u:80,w:103,size:"S",star:2,face:"-w"},
  {id:"P15",zone:"S",u:96,w:103,size:"S",star:2,face:"-w"},
  {id:"P16",zone:"M1",u:180,w:41,size:"M",star:3,face:"+w"},
  {id:"P17",zone:"M1",u:204,w:41,size:"S",star:3,face:"+w"},
  {id:"P18",zone:"M1",u:214,w:41,size:"S",star:3,face:"+w"},
  {id:"P19",zone:"N",u:200,w:15,size:"S",star:3,face:"+w"},
  {id:"P20",zone:"N",u:210,w:15,size:"S",star:3,face:"+w"},
  {id:"P21",zone:"N",u:240,w:15,size:"L",star:3,face:"+w"},
  {id:"P22",zone:"M2",u:193,w:72,size:"L",star:3,face:"-w"},
  {id:"P23",zone:"S",u:150,w:108,size:"M",star:3,face:"-w"},
  {id:"P24",zone:"W",u:38,w:86,size:"W",star:3,face:"+u"},
  {id:"P25",zone:"M1",u:236,w:41,size:"M",star:4,face:"+w"},
  {id:"P26",zone:"M1",u:262,w:41,size:"M",star:4,face:"+w"},
  {id:"P27",zone:"N",u:266,w:15,size:"M",star:4,face:"+w"},
  {id:"P28",zone:"M2",u:143,w:78,size:"XL",star:4,face:"-w"},
  {id:"P29",zone:"S",u:176,w:108,size:"M",star:4,face:"-w"},
  {id:"P30",zone:"S",u:205,w:108,size:"M",star:4,face:"-w"},
  {id:"P31",zone:"M1",u:277,w:41,size:"S",star:5,face:"+w"},
  {id:"P32",zone:"N",u:284,w:15,size:"S",star:5,face:"+w"},
  {id:"P33",zone:"M2",u:237,w:78,size:"XL",star:5,face:"-w"},
  {id:"P34",zone:"S",u:233,w:108,size:"M",star:5,face:"-w"}
];
// END PITCHES
export const PITCHES = Object.freeze(PITCH_TABLE.map(pitch => Object.freeze({ ...pitch })));
