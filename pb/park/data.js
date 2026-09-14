export const RULES = {
  version: 1, gridWidth: 40, gridHeight: 40, parcelSize: 10, gateX: 20, gateY: 0,
  initialLand: 102, initialCash: 5000, initialTicket: 18, pathCost: 5, landCost: 600,
  maxObjects: 64, maxGuests: 48, maxStaff: 20, maxPrice: 200, refundFraction: 0.4,
  stepSeconds: 1, secondsPerHour: 10, hoursPerDay: 24, maxTickSeconds: 86400,
  cashLimit: 100000000, overheadPerHour: 10, guestServicePerSecond: 0.06,
  baseArrivals: 0.65, ticketSensitivity: 24, guestValue: 15, ratingValue: 30,
  maxNeed: 100, initialHappiness: 76, emptyHappiness: 40, initialEnergy: 100,
  visitSeconds: 180, satisfiedVisitSeconds: 110, satisfiedHappiness: 85,
  departureHappiness: 10, initialWallet: 100, walletVariation: 30,
  needInterval: 3, thrillInterval: 2, distressInterval: 4, pressingNeed: 85,
  queueGrace: 10, queuePenaltyInterval: 3, maxQueue: 24, serviceSeconds: 3,
  rideHappiness: 12, serviceHappiness: 8, rideRelief: 65, serviceRelief: 80,
  wearPerCycle: 6, failureHealth: 25, failureScale: 400, repairWork: 30,
  repairCost: 20, maintenanceInterval: 10, maintenanceHealth: 3,
  litterChance: 0.015, litterPerDrop: 2, maxLitter: 1000, janitorRate: 2,
  binRadius: 4, binFactor: 0.2, sceneryRadius: 5, sceneryInterval: 10,
  entertainerInterval: 8, cleanlinessPenalty: 30, varietyBonus: 2,
  maxVarietyBonus: 20, queueRatingScale: 3, maxQueuePenalty: 20,
  departureMemory: 0.2, arrivalScale: 1000, timeScale: 1000000,
  happyDeparture: 65, facilityEnergy: 40,
  initialNeeds: { thrill: 60, hunger: 20, thirst: 30, toilet: 10 },
  excitementHappinessScale: 10, thrillPreferenceScale: 10, cleanlinessScale: 10,
  breakdownRatingPenalty: 20,
};

export const TILE = { EMPTY: 0, PATH: 1, OCCUPIED: 2 };
export const PHASE = { WALK: 0, QUEUE: 1, USE: 2, LEAVE: 3 };
export const NEEDS = ["thrill", "hunger", "thirst", "toilet", "energy"];
export const STAFF = {
  mechanics: { index: 0, wage: 8 },
  janitors: { index: 1, wage: 6 },
  entertainers: { index: 2, wage: 6 },
};

export const RIDES = [
  { id: "carousel", name: "Carousel", footprint: [2, 2], cost: 300, upkeep: 2,
    duration: 6, capacity: 6, excitement: 30, thrill: 15, reliability: 96, unlock: 0, price: 5 },
  { id: "teacups", name: "Teacups", footprint: [2, 2], cost: 380, upkeep: 2,
    duration: 7, capacity: 6, excitement: 36, thrill: 25, reliability: 95, unlock: 0, price: 5 },
  { id: "mini-train", name: "Miniature Train", footprint: [3, 2], cost: 450, upkeep: 3,
    duration: 9, capacity: 10, excitement: 38, thrill: 10, reliability: 97, unlock: 0, price: 6 },
  { id: "slide", name: "Helter Skelter", footprint: [2, 2], cost: 350, upkeep: 2,
    duration: 5, capacity: 4, excitement: 34, thrill: 30, reliability: 98, unlock: 0, price: 4 },
  { id: "wheel", name: "Ferris Wheel", footprint: [3, 2], cost: 750, upkeep: 4,
    duration: 10, capacity: 12, excitement: 48, thrill: 20, reliability: 96, unlock: 1, price: 7 },
  { id: "dodgems", name: "Dodgems", footprint: [3, 3], cost: 850, upkeep: 4,
    duration: 8, capacity: 8, excitement: 54, thrill: 38, reliability: 94, unlock: 1, price: 7 },
  { id: "swing", name: "Swing Chairs", footprint: [3, 3], cost: 900, upkeep: 5,
    duration: 8, capacity: 8, excitement: 56, thrill: 42, reliability: 93, unlock: 1, price: 8 },
  { id: "ghost-train", name: "Ghost Train", footprint: [4, 3], cost: 1100, upkeep: 5,
    duration: 10, capacity: 10, excitement: 60, thrill: 48, reliability: 93, unlock: 1, price: 8 },
  { id: "log-flume", name: "Log Flume", footprint: [4, 4], cost: 1700, upkeep: 7,
    duration: 10, capacity: 12, excitement: 68, thrill: 55, reliability: 92, unlock: 2, price: 9 },
  { id: "pirate-ship", name: "Pirate Ship", footprint: [4, 2], cost: 1500, upkeep: 6,
    duration: 8, capacity: 12, excitement: 66, thrill: 62, reliability: 94, unlock: 2, price: 9 },
  { id: "wild-mouse", name: "Wild Mouse", footprint: [4, 4], cost: 2100, upkeep: 8,
    duration: 9, capacity: 8, excitement: 75, thrill: 70, reliability: 91, unlock: 2, price: 10 },
  { id: "drop-tower", name: "Drop Tower", footprint: [2, 3], cost: 1900, upkeep: 7,
    duration: 7, capacity: 10, excitement: 73, thrill: 85, reliability: 92, unlock: 2, price: 10 },
  { id: "wooden-coaster", name: "Wooden Coaster", footprint: [5, 4], cost: 3000, upkeep: 10,
    duration: 11, capacity: 16, excitement: 84, thrill: 78, reliability: 90, unlock: 3, price: 12 },
  { id: "rapids", name: "River Rapids", footprint: [5, 4], cost: 3200, upkeep: 10,
    duration: 12, capacity: 16, excitement: 82, thrill: 65, reliability: 92, unlock: 3, price: 12 },
  { id: "inverted-coaster", name: "Inverted Coaster", footprint: [5, 5], cost: 4200, upkeep: 12,
    duration: 10, capacity: 16, excitement: 94, thrill: 92, reliability: 90, unlock: 3, price: 14 },
  { id: "launch-coaster", name: "Launch Coaster", footprint: [6, 4], cost: 5000, upkeep: 14,
    duration: 9, capacity: 18, excitement: 100, thrill: 98, reliability: 89, unlock: 3, price: 15 },
];

export const STALLS = [
  { id: "popcorn", name: "Popcorn Cart", footprint: [1, 1], cost: 180, upkeep: 1,
    need: "hunger", stockCost: 1, salePrice: 4, unlock: 0 },
  { id: "lemonade", name: "Lemonade Stand", footprint: [1, 1], cost: 180, upkeep: 1,
    need: "thirst", stockCost: 1, salePrice: 4, unlock: 0 },
  { id: "balloons", name: "Balloon Cart", footprint: [1, 1], cost: 200, upkeep: 1,
    need: "souvenir", stockCost: 2, salePrice: 6, unlock: 0 },
  { id: "burgers", name: "Burger Kitchen", footprint: [2, 1], cost: 400, upkeep: 2,
    need: "hunger", stockCost: 2, salePrice: 7, unlock: 1 },
  { id: "juice", name: "Juice Bar", footprint: [2, 1], cost: 350, upkeep: 2,
    need: "thirst", stockCost: 2, salePrice: 6, unlock: 1 },
  { id: "gifts", name: "Gift Shop", footprint: [2, 2], cost: 450, upkeep: 2,
    need: "souvenir", stockCost: 3, salePrice: 9, unlock: 1 },
  { id: "pizza", name: "Pizza Pavilion", footprint: [2, 2], cost: 650, upkeep: 3,
    need: "hunger", stockCost: 3, salePrice: 9, unlock: 2 },
  { id: "smoothies", name: "Smoothie Garden", footprint: [2, 2], cost: 600, upkeep: 3,
    need: "thirst", stockCost: 2, salePrice: 8, unlock: 2 },
  { id: "emporium", name: "Park Emporium", footprint: [3, 2], cost: 1000, upkeep: 4,
    need: "souvenir", stockCost: 4, salePrice: 12, unlock: 3 },
];

export const FACILITIES = [
  { id: "toilet", name: "Toilets", footprint: [1, 1], cost: 140, upkeep: 1,
    need: "toilet", stockCost: 0, salePrice: 0, unlock: 0 },
  { id: "bin", name: "Litter Bin", footprint: [1, 1], cost: 30, upkeep: 0,
    need: null, radius: 4, unlock: 0 },
  { id: "first-aid", name: "First Aid", footprint: [2, 1], cost: 250, upkeep: 2,
    need: "energy", stockCost: 0, salePrice: 0, unlock: 1 },
];

export const SCENERY = [
  { id: "flowers", name: "Flower Bed", footprint: [1, 1], cost: 50, upkeep: 0, appeal: 2, unlock: 0 },
  { id: "tree", name: "Shade Tree", footprint: [1, 1], cost: 80, upkeep: 0, appeal: 3, unlock: 0 },
  { id: "fountain", name: "Fountain", footprint: [2, 2], cost: 300, upkeep: 1, appeal: 6, unlock: 1 },
  { id: "topiary", name: "Topiary Garden", footprint: [2, 2], cost: 500, upkeep: 1, appeal: 8, unlock: 2 },
  { id: "castle", name: "Fairytale Castle", footprint: [3, 3], cost: 1200, upkeep: 2, appeal: 12, unlock: 3 },
];

export const UNLOCKS = [
  { id: 0, name: "Small Beginnings", guests: 0, value: 0, rating: 0 },
  { id: 1, name: "Local Favorite", guests: 30, value: 6000, rating: 45 },
  { id: 2, name: "Regional Attraction", guests: 100, value: 10000, rating: 55 },
  { id: 3, name: "Destination Park", guests: 220, value: 17000, rating: 65 },
];

export const MILESTONES = [
  { id: "welcome", name: "A Warm Welcome", guests: 20, value: 0, rating: 0, cash: 600 },
  { id: "smiles", name: "Happy Families", guests: 0, value: 0, rating: 55, cash: 800 },
  { id: "investment", name: "Growing Ambitions", guests: 0, value: 9000, rating: 0, cash: 1500 },
  { id: "crowds", name: "Word Gets Around", guests: 160, value: 0, rating: 0, cash: 2200 },
  { id: "destination", name: "A Day to Remember", guests: 220, value: 17000, rating: 65, cash: 1000, unlock: 3 },
  { id: "tycoon", name: "Theme Park Tycoon", guests: 300, value: 24000, rating: 65, cash: 3000 },
];

// Fixed-width base-36 records bound save size even at maximum occupancy.
export const OBJECT_FIELDS = ["k", "p", "r", "h", "b", "t"];
export const OBJECT_WIDTHS = [1, 3, 1, 2, 2, 2];
export const GUEST_FIELDS = ["p", "target", "phase", "wait", "age", "wallet", "happy",
  "thrill", "hunger", "thirst", "toilet", "energy", "taste"];
export const GUEST_WIDTHS = [3, 2, 1, 2, 3, 3, 2, 2, 2, 2, 2, 2, 2];

export const SAVED_FIELDS = {
  version: "schemaVersion",
  g: "flatTileGrid",
  o: "objectRecordsBySlot",
  v: "concatenatedGuestRecords",
  l: "ownedParcelBitmask",
  c: "cash",
  p: "ticketPrice",
  rp: "ridePricesInCatalogOrder",
  s: "staffCountsInRoleIndexOrder",
  m: "preventiveMaintenanceEnabled",
  r: "randomSeed",
  t: "elapsedFixedSteps",
  q: "remainingMicroseconds",
  f: "arrivalCreditThousandths",
  a: "totalAdmittedGuests",
  h: "departedGuestHappinessMemory",
  j: "litter",
  u: "unlockBitmask",
  z: "awardedMilestoneBitmask",
  d: "hourlyOperatingProfitRing",
};
