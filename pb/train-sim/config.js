/* Lokféierer: single balance source. Metres, seconds, m/s internally; euros for money.
   Frozen data only, no logic. Prices are tuned so the first purchase (emu) comes after ~3 west services
   and the full content (6 trains, upgrades, 9 routes) takes roughly 3 weeks of regular play. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});

  const UPGRADE_KINDS = Object.freeze(['motor', 'brakes', 'comfort', 'capacity', 'paint']);
  /* Upgrade prices = reference price of the train x factor per level. */
  const UPGRADE_FACTORS = Object.freeze({
    motor: [0.06, 0.1, 0.15, 0.22],
    brakes: [0.04, 0.07, 0.11],
    comfort: [0.05, 0.09, 0.14, 0.2],
    capacity: [0.05, 0.1, 0.16],
    paint: [0.015, 0.025, 0.04],
  });
  /* Effect per level (applied by TS.career.applyUpgrades). */
  const UPGRADE_EFFECTS = Object.freeze({
    motor: { accelPerLevel: 0.07, speedPerLevel: 0.025 }, // +7 % accel, +2.5 % top speed per level
    brakes: { brakePerLevel: 0.08, emergencyPerLevel: 0.05 },
    comfort: { fareMultPerLevel: 0.05, complaintsPerLevel: 0.2 }, // +5 % fares; -20 % harsh-event penalty per level (min 0)
    capacity: { capacityPerLevel: 0.08, extraCarAtMax: true }, // +8 % seats; +1 car at max level for kiss/ic/hst
    paint: { liveryPerLevel: 1 },
  });
  const EXTRA_CAR_TRAINS = Object.freeze(['kiss', 'ic', 'hst']);
  const REFERENCE_PRICE = Object.freeze({ railcar: 9000 }); // free train: upgrade prices scale off this

  const livery = (body, accent, stripe) => Object.freeze({ body, accent, stripe });
  const trainDef = (t) =>
    Object.freeze({
      ...t,
      name: Object.freeze(t.name),
      liveries: Object.freeze(t.liveries.map((l) => livery(...l))),
      livery: livery(...t.liveries[0]),
    });

  const trains = Object.freeze([
    trainDef({
      id: 'railcar', name: { lb: 'Schinnebus', de: 'Schienenbus', en: 'Railbus' }, kind: 'rail', price: 0,
      maxKmh: 90, accel: 0.9, brake: 1.1, emergency: 1.6, massT: 45, cars: 1, capacity: 90, doorsPerSide: 2, carLength: 22,
      cab: 'railcar', model: 'railcar', sound: 'diesel',
      liveries: [['#a82a26', '#e9dcc0', '#e9dcc0'], ['#2e5d4b', '#e9dcc0', '#d8b24a'], ['#1f4f86', '#f0f0ec', '#c8312b'], ['#2a2a2e', '#d8b24a', '#d8b24a']],
    }),
    trainDef({
      id: 'emu', name: { lb: 'Regionalzuch', de: 'Regionalzug', en: 'Regional EMU' }, kind: 'rail', price: 12000,
      maxKmh: 140, accel: 1.0, brake: 1.15, emergency: 1.7, massT: 110, cars: 2, capacity: 220, doorsPerSide: 3, carLength: 26,
      cab: 'emu', model: 'emu', sound: 'electric',
      liveries: [['#e7e8ea', '#c8312b', '#1b3a6b'], ['#dfe6ea', '#1b6e8f', '#e7b32c'], ['#cfd4d8', '#2f7d4f', '#e7e8ea'], ['#262a32', '#c8312b', '#e7e8ea']],
    }),
    trainDef({
      id: 'tram', name: { lb: 'Tram', de: 'Straßenbahn', en: 'Tram' }, kind: 'tram', price: 30000,
      maxKmh: 70, accel: 1.2, brake: 1.3, emergency: 2.4, massT: 55, cars: 5, capacity: 420, doorsPerSide: 1, carLength: 8.6,
      cab: 'tram', model: 'tram', sound: 'tram',
      liveries: [['#f1f1ee', '#d6342e', '#8a8d93'], ['#f1f1ee', '#1f7a5c', '#8a8d93'], ['#2b2f38', '#e9b83a', '#f1f1ee'], ['#f1f1ee', '#2b64b0', '#e9b83a']],
    }),
    trainDef({
      id: 'kiss', name: { lb: 'Duebeldecker-Zuch', de: 'Doppelstock-Triebzug', en: 'Double-decker EMU' }, kind: 'rail', price: 55000,
      maxKmh: 160, accel: 0.95, brake: 1.15, emergency: 1.65, massT: 300, cars: 4, capacity: 600, doorsPerSide: 2, carLength: 26,
      cab: 'kiss', model: 'kiss', sound: 'electric',
      liveries: [['#dedfe2', '#c8312b', '#2a2d34'], ['#dedfe2', '#1b4f9c', '#e7b32c'], ['#c9ced3', '#e9742c', '#2a2d34'], ['#2a2d34', '#c8312b', '#dedfe2']],
    }),
    trainDef({
      id: 'ic', name: { lb: 'Intercity', de: 'Intercity', en: 'Intercity' }, kind: 'rail', price: 100000,
      maxKmh: 200, accel: 0.75, brake: 1.0, emergency: 1.5, massT: 420, cars: 7, capacity: 520, doorsPerSide: 2, carLength: 25,
      cab: 'ic', model: 'ic', sound: 'electric',
      liveries: [['#c8312b', '#dcdcdc', '#2a2a2e'], ['#1b4f9c', '#dcdcdc', '#e7b32c'], ['#e8e6df', '#c8312b', '#2a2a2e'], ['#2a2d34', '#e7b32c', '#dcdcdc']],
    }),
    trainDef({
      id: 'hst', name: { lb: 'Héichgeschwindegkeetszuch', de: 'Hochgeschwindigkeitszug', en: 'High-speed train' }, kind: 'rail', price: 180000,
      maxKmh: 320, accel: 0.65, brake: 0.95, emergency: 1.35, massT: 420, cars: 8, capacity: 750, doorsPerSide: 2, carLength: 21.5,
      cab: 'hst', model: 'hst', sound: 'hst',
      liveries: [['#e8eaee', '#1b3a6b', '#c8312b'], ['#2a3a6b', '#d8dce2', '#c8312b'], ['#d8dce2', '#2a2d34', '#e7b32c'], ['#2a2d34', '#c8312b', '#d8dce2']],
    }),
  ]);

  /* Upgrade price table per train: { motor:[p1..p4], brakes:[...], ... } (price of going from level i to i+1). */
  const roundTo = (n, step) => Math.round(n / step) * step;
  const upgrades = Object.freeze(
    Object.fromEntries(
      trains.map((t) => {
        const ref = REFERENCE_PRICE[t.id] || t.price;
        const table = Object.fromEntries(
          UPGRADE_KINDS.map((k) => [k, Object.freeze(UPGRADE_FACTORS[k].map((f) => Math.max(100, roundTo(ref * f, ref >= 50000 ? 500 : 100))))])
        );
        return [t.id, Object.freeze(table)];
      })
    )
  );

  /* needs: tokens matched against the train's id OR kind ('rail' | 'tram') */
  const routeRules = Object.freeze({
    west: Object.freeze({ price: 0, needs: Object.freeze(['rail']), fareBase: 20 }),
    south: Object.freeze({ price: 1800, needs: Object.freeze(['rail']), fareBase: 26 }),
    east: Object.freeze({ price: 9000, needs: Object.freeze(['rail']), fareBase: 24 }),
    north: Object.freeze({ price: 16000, needs: Object.freeze(['rail']), fareBase: 32 }),
    tram: Object.freeze({ price: 8000, needs: Object.freeze(['tram']), fareBase: 18 }),
    trier: Object.freeze({ price: 38000, needs: Object.freeze(['kiss', 'ic', 'hst']), fareBase: 55 }),
    metz: Object.freeze({ price: 52000, needs: Object.freeze(['kiss', 'ic', 'hst']), fareBase: 50 }),
    brussels: Object.freeze({ price: 72000, needs: Object.freeze(['kiss', 'ic', 'hst']), fareBase: 65 }),
    paris: Object.freeze({ price: 140000, needs: Object.freeze(['hst']), fareBase: 120 }),
  });
  /* Fallback order if TS.routes isn't loaded. */
  const routeOrder = Object.freeze(['west', 'south', 'east', 'north', 'tram', 'trier', 'metz', 'brussels', 'paris']);

  const economy = Object.freeze({
    farePerPassengerKm: 3, // plus routeRules[route].fareBase per delivered passenger
    punctuality: Object.freeze({ onTimeSec: 30, okSec: 120, lateMaxSec: 600, maxBonus: 0.25, maxPenalty: 0.5 }), // score 1 (<=onTime) .. 0 (okSec) .. -1 (lateMax), averaged over stations; x fraction of gross fare
    accuracy: Object.freeze({ perfectM: 2, okM: 8, overrunM: 15, perfectScore: 1, okScore: 0.4, overrunScore: -0.5, maxBonus: 0.15 }), // fractions of gross fare
    overspeed: Object.freeze({ fracPerSecond: 0.005, maxFrac: 0.3 }),
    spad: Object.freeze({ flat: 500, frac: 0.2, maxCount: 3 }),
    harsh: Object.freeze({ fracEach: 0.02, maxFrac: 0.2 }),
    endlessMultiplier: 0.6,
    pointsPerEuro: 0.1,
    comfortHarshFloor: 0.2, // comfort upgrades never remove more than 80 % of harsh fines
    startWallet: 0,
  });

  /* Lifetime-euro thresholds for ranks 0..4 (Praktikant, Lokféierer, Senior, Chef-Lokféierer, Legend). */
  const ranks = Object.freeze([0, 15000, 80000, 250000, 600000]);
  const rankIds = Object.freeze(['praktikant', 'lokfeierer', 'senior', 'chef', 'legend']);

  TS.config = Object.freeze({
    trains, upgrades, upgradeKinds: UPGRADE_KINDS, upgradeEffects: UPGRADE_EFFECTS, extraCarTrains: EXTRA_CAR_TRAINS,
    routeRules, routeOrder, economy, ranks, rankIds, saveVersion: 1, coachServices: 3,
  });
})();
