/* Lokféierer: single balance source. Metres, seconds, m/s internally; euros for money.
   Frozen data only, no logic. Two separate careers share one save: Zuch (rail) and Tram (the Luxtram only).
   Rail prices: the first purchase (emu) comes after ~3 west services. Tram prices: the first Luxtram section after ~2
   Luxtram services (one stad service pays roughly 5 000 EUR with the 420-seat tram). */
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
    motor: { accelPerLevel: 0.07, speedPerLevel: 0.025 }, // +7 % accel, +2.5 % top speed per level (rail only: the Luxtram is capped, see SPEED_CAPS)
    brakes: { brakePerLevel: 0.08, emergencyPerLevel: 0.05 },
    comfort: { fareMultPerLevel: 0.05, complaintsPerLevel: 0.2 }, // +5 % fares; -20 % harsh-event penalty per level (min 0)
    capacity: { capacityPerLevel: 0.08, extraCarAtMax: true }, // +8 % seats; +1 coach at max level for the locomotive-hauled sets (dosto, ic)
    paint: { liveryPerLevel: 1 },
  });
  /* The real Luxtram never exceeds 70 km/h, whatever the upgrades: its motor upgrade improves acceleration only.
     In the owner's arcade test mode (window.__pbTestMode) the tram may go faster to scout the scenery, without overspeed fines. */
  const SPEED_CAPS = Object.freeze({ tramKmh: 70, tramScoutKmh: 110 });
  const EXTRA_CAR_TRAINS = Object.freeze(['dosto', 'ic']);   // +1 car at max capacity only where a coach can really be added (locomotive-hauled sets); the fixed sets (KISS, Coradia, TGV) get the +8 % seats only
  const REFERENCE_PRICE = Object.freeze({ railcar: 9000, tram: 40000 }); // free trains: upgrade prices scale off this

  const livery = (body, accent, stripe, doors) => Object.freeze(doors ? { body, accent, stripe, doors: Object.freeze([...doors]) } : { body, accent, stripe });
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
    /* CFL Z 2 "série 2000" (De Dietrich / ANF / Alstom, 1990, 2 cars ABD + B, 25.1 m each, 160 km/h; the last ones were withdrawn on 29 Nov 2025): the old bordeaux + cream units with the yellow nose.
       The real 160 km/h and 164 seats (24 first + 60 + 80), 1 220 kW. body = cream sides, accent = bordeaux, stripe = yellow (nose upper, doors). */
    trainDef({
      id: 'emu', name: { lb: 'CFL Z 2 (Serie 2000)', de: 'CFL Z 2 (Baureihe 2000)', en: 'CFL Z 2 (class 2000)' }, kind: 'rail', price: 12000,
      maxKmh: 160, accel: 0.75, brake: 1.0, emergency: 1.5, massT: 104, cars: 2, capacity: 164, doorsPerSide: 3, carLength: 25.9,
      cab: 'emu', model: 'emu', sound: 'electric',
      liveries: [['#e9e3d0', '#b23a52', '#e6a923'], ['#e7e8ea', '#ef3b45', '#2a2e33'], ['#dfe6ea', '#1b6e8f', '#e7b32c'], ['#262a32', '#c8312b', '#e7e8ea']],
    }),
    trainDef({
      id: 'tram', name: { lb: 'Luxtram', de: 'Luxtram', en: 'Luxtram' }, kind: 'tram', price: 0,
      maxKmh: 70, accel: 1.2, brake: 1.3, emergency: 2.4, massT: 55, cars: 5, capacity: 420, doorsPerSide: 1, carLength: 9,
      cab: 'tram', model: 'tram', sound: 'tram',
      /* Luxtram (CAF Urbos): body = light metallic silver (cab shell + roof fairings), accent = seat / cab colour, stripe = silver sill line,
      doors = the glazed door leaves, one colour per car (cycled). The real trams are black-glazed along the sides with silver ends. */
      liveries: [
        ['#d0d4d8', '#19a9c4', '#9aa0a6', ['#19a9c4', '#7cc242', '#d6338a', '#f28c1e']],
        ['#e8eaec', '#d6338a', '#aab0b5', ['#d6338a', '#f28c1e', '#d6338a', '#f28c1e']],
        ['#4a5159', '#f2b632', '#9aa0a6', ['#f2b632', '#f1f1ee', '#f2b632', '#f1f1ee']],
        ['#d0d4d8', '#2b64b0', '#9aa0a6', ['#2b64b0', '#2b64b0', '#2b64b0', '#2b64b0']],
      ],
    }),
    /* CFL 2200 (Alstom Coradia Duplex = SNCF Z 24500 family, 2004 - 2010, 22 sets, 3 double-deck cars, 81.1 m, 160 km/h, 339 seats): stainless grey sides, red nose and red lower band. */
    trainDef({
      id: 'z2200', name: { lb: 'CFL 2200 (Duebeldecker)', de: 'CFL 2200 (Doppelstock)', en: 'CFL 2200 (Duplex)' }, kind: 'rail', price: 28000,
      maxKmh: 160, accel: 0.8, brake: 1.15, emergency: 1.65, massT: 190, cars: 3, capacity: 339, doorsPerSide: 2, carLength: 27,
      cab: 'z2200', model: 'z2200', sound: 'electric',
      liveries: [['#cfd2d5', '#ef3b45', '#7b1220'], ['#e6e8ea', '#ef3b45', '#2a2d34'], ['#dedfe2', '#1b4f9c', '#e7b32c'], ['#2a2d34', '#ef3b45', '#dedfe2']],
    }),
    /* CFL 2300 (Stadler KISS, 2014, 8 sets, 3 double-deck cars, 79.84 m, 160 km/h, 284 seats): silver-white sides with the big red front and red lower band. */
    trainDef({
      id: 'kiss', name: { lb: 'CFL 2300 (KISS)', de: 'CFL 2300 (KISS)', en: 'CFL 2300 (KISS)' }, kind: 'rail', price: 55000,
      maxKmh: 160, accel: 0.95, brake: 1.15, emergency: 1.65, massT: 205, cars: 3, capacity: 284, doorsPerSide: 2, carLength: 26.6,
      cab: 'kiss', model: 'kiss', sound: 'electric',
      liveries: [['#e6e8ea', '#ef3b45', '#2a2d34'], ['#dedfe2', '#1b4f9c', '#e7b32c'], ['#c9ced3', '#e9742c', '#2a2d34'], ['#2a2d34', '#ef3b45', '#dedfe2']],
    }),
    /* CFL 4000 (Bombardier TRAXX, 2004, 140 km/h) pushing / pulling Dosto double-deck coaches (driving trailer at the other end): the workhorse of the CFL regional lines. */
    trainDef({
      id: 'dosto', name: { lb: 'CFL 4000 + Dosto', de: 'CFL 4000 + Dosto', en: 'CFL 4000 + Dosto' }, kind: 'rail', price: 70000,
      maxKmh: 140, accel: 0.7, brake: 1.05, emergency: 1.55, massT: 330, cars: 6, capacity: 550, doorsPerSide: 2, carLength: 25.2,
      cab: 'dosto', model: 'dosto', sound: 'electric',
      liveries: [['#d4d7da', '#ef3b45', '#2a2d34'], ['#dedfe2', '#ef3b45', '#7b1220'], ['#1b4f9c', '#dcdcdc', '#e7b32c'], ['#2a2d34', '#e7b32c', '#dcdcdc']],
    }),
    /* CFL 2400 (Alstom Coradia Stream HC, in service since 29 Sep 2024, 3 double-deck cars, 82 m, 160 km/h, 334 seats, step-free): white sides, big red front and red skirt. */
    trainDef({
      id: 'c2400', name: { lb: 'CFL 2400 (Coradia)', de: 'CFL 2400 (Coradia)', en: 'CFL 2400 (Coradia)' }, kind: 'rail', price: 85000,
      maxKmh: 160, accel: 1.0, brake: 1.2, emergency: 1.7, massT: 220, cars: 3, capacity: 334, doorsPerSide: 2, carLength: 27.4,
      cab: 'coradia', model: 'coradia', sound: 'electric',
      liveries: [['#e7e9eb', '#ef3b45', '#2a2d34'], ['#dedfe2', '#1b4f9c', '#e7b32c'], ['#c9ced3', '#e9742c', '#2a2d34'], ['#2a2d34', '#ef3b45', '#dedfe2']],
    }),
    /* CFL 3000 (Alstom, 1997, 200 km/h, the Brussels - Luxembourg locomotive) with grey single-deck coaches and a driving trailer. */
    trainDef({
      id: 'ic', name: { lb: 'CFL 3000 Intercity', de: 'CFL 3000 Intercity', en: 'CFL 3000 Intercity' }, kind: 'rail', price: 100000,
      maxKmh: 200, accel: 0.6, brake: 1.0, emergency: 1.5, massT: 360, cars: 7, capacity: 440, doorsPerSide: 2, carLength: 25,
      cab: 'ic', model: 'ic', sound: 'electric',
      liveries: [['#dadde0', '#ef3b45', '#ecc62c'], ['#1b4f9c', '#dcdcdc', '#e7b32c'], ['#e8e6df', '#c8312b', '#2a2a2e'], ['#2a2d34', '#e7b32c', '#dcdcdc']],
    }),
    /* The long Coradia: 2 x 2400 coupled = the 2450 (6 cars, 160.6 m, 692 seats). */
    trainDef({
      id: 'c2450', name: { lb: 'CFL 2450 (laang Coradia)', de: 'CFL 2450 (langer Coradia)', en: 'CFL 2450 (long Coradia)' }, kind: 'rail', price: 140000,
      maxKmh: 160, accel: 0.95, brake: 1.15, emergency: 1.65, massT: 440, cars: 6, capacity: 692, doorsPerSide: 2, carLength: 27.4,
      cab: 'coradia', model: 'coradia', silhouette: 'coradia6', sound: 'electric',
      liveries: [['#e7e9eb', '#ef3b45', '#2a2d34'], ['#dedfe2', '#1b4f9c', '#e7b32c'], ['#c9ced3', '#e9742c', '#2a2d34'], ['#2a2d34', '#ef3b45', '#dedfe2']],
    }),
    /* SNCF TGV inOui Euroduplex (TGV 2N2, 2 power cars + 8 double-deck trailers = 200 m, 320 km/h on the LGV Est): silver-white, dark window band, red swoosh on the nose. */
    trainDef({
      id: 'hst', name: { lb: 'TGV inOui (Duplex)', de: 'TGV inOui (Duplex)', en: 'TGV inOui (Duplex)' }, kind: 'rail', price: 180000,
      maxKmh: 320, accel: 0.55, brake: 0.95, emergency: 1.35, massT: 424, cars: 10, capacity: 508, doorsPerSide: 2, carLength: 20,
      cab: 'hst', model: 'hst', sound: 'hst',
      liveries: [['#cdd0d4', '#9b1d47', '#2f343c'], ['#2a3a6b', '#d8dce2', '#c8312b'], ['#d8dce2', '#2a2d34', '#e7b32c'], ['#2a2d34', '#c8312b', '#d8dce2']],
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

  /* needs: tokens matched against the train's id OR kind ('rail' | 'tram').
   * fareScale: multiplies the whole fare of a service (career.js reward). W5 timing cut the scheduled minutes of every route by 10 - 26 % (no more dead waiting at the stops);
   * the scale = new / old scheduled minutes keeps the money per minute of play where it was (scripts/zuch/career_probe.mjs), prices unchanged. */
  const routeRules = Object.freeze({
    west: Object.freeze({ price: 0, needs: Object.freeze(['rail']), fareBase: 20, fareScale: 0.88 }),
    south: Object.freeze({ price: 1800, needs: Object.freeze(['rail']), fareBase: 26, fareScale: 0.91 }),
    east: Object.freeze({ price: 9000, needs: Object.freeze(['rail']), fareBase: 24, fareScale: 0.87 }),
    wittlich: Object.freeze({ price: 12000, needs: Object.freeze(['rail']), fareBase: 34, fareScale: 0.88 }),
    // W2c: south / north run all the real stops now (17 / 18 instead of 9): a service pays 8.5 k / 9.7 k (was 5.9 k / 6.3 k) in 33 / 39 min (scripts/zuch/career_probe.mjs, drive_bot.mjs), north's price follows (16 k -> 24 k = the same 2.5 services as before)
    north: Object.freeze({ price: 24000, needs: Object.freeze(['rail']), fareBase: 32, fareScale: 0.89 }),
    /* zstock: the real seat numbers (KISS 284 instead of 600, Z 2 164 instead of 220) lower the fare per service; the long-line prices were re-tuned with the real seats and fareScale (career_probe.mjs: trier 38 000 -> 32 000, metz 72 000 -> 44 000, brussels 108 000 -> 60 000, paris 160 000 -> 125 000 keep the pre-change 1.0 / 2.6 / 2.9 / 3.8 services to buy) */
    trier: Object.freeze({ price: 32000, needs: Object.freeze(['kiss', 'dosto', 'c2400', 'ic', 'c2450', 'hst']), fareBase: 55, fareScale: 0.78 }),
    metz: Object.freeze({ price: 44000, needs: Object.freeze(['z2200', 'kiss', 'dosto', 'c2400', 'ic', 'c2450', 'hst']), fareBase: 50, fareScale: 0.74 }),
    brussels: Object.freeze({ price: 60000, needs: Object.freeze(['kiss', 'dosto', 'c2400', 'ic', 'c2450', 'hst']), fareBase: 65, fareScale: 0.74 }),
    paris: Object.freeze({ price: 125000, needs: Object.freeze(['hst']), fareBase: 120, fareScale: 0.8 }),
  });
  /* Fallback order if TS.routes isn't loaded. The Luxtram routes are appended by luxtram.js (tram career). */
  const routeOrder = Object.freeze(['west', 'south', 'east', 'wittlich', 'north', 'trier', 'metz', 'brussels', 'paris']);

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

  /* Lifetime-euro thresholds for ranks 0..4, per career (copy keys rank_<id>).
     Rail: Praktikant, Lokféierer, Senior, Chef-Lokféierer, Legend. Tram: Tram-Praktikant, Wattman, Senior-Wattman, Chef-Wattman, Tram-Legend. */
  const careers = Object.freeze({
    order: Object.freeze(['rail', 'tram']),
    rail: Object.freeze({ id: 'rail', icon: '🚆', ranks: Object.freeze([0, 15000, 80000, 250000, 600000]), rankIds: Object.freeze(['praktikant', 'lokfeierer', 'senior', 'chef', 'legend']) }),
    tram: Object.freeze({ id: 'tram', icon: '🚋', ranks: Object.freeze([0, 10000, 50000, 150000, 400000]), rankIds: Object.freeze(['tram_praktikant', 'wattman', 'tram_senior', 'tram_chef', 'tram_legend']) }),
  });
  const ranks = careers.rail.ranks;
  const rankIds = careers.rail.rankIds;

  TS.config = Object.freeze({
    trains, upgrades, upgradeKinds: UPGRADE_KINDS, upgradeEffects: UPGRADE_EFFECTS, speedCaps: SPEED_CAPS, extraCarTrains: EXTRA_CAR_TRAINS,
    routeRules, routeOrder, economy, ranks, rankIds, careers, saveVersion: 2, coachServices: 3,
  });
})();
