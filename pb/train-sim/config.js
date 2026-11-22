/* Lokféierer: single balance source. Metres, seconds, m/s internally; euros for money.
   Frozen data only, no logic. Two separate careers share one save: Zuch (rail) and Tram (the Luxtram only).
   Every train and every route is unlocked from the start (Ian, 21 Nov 2026): the money of each career buys upgrades only. */
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
  const EXTRA_CAR_TRAINS = Object.freeze(['dosto', 'ic']);   // +1 car at max capacity only where a coach can really be added (locomotive-hauled sets); the fixed sets (Z 2, Coradia, TGV) get the +8 % seats only

  const livery = (body, accent, stripe, doors) => Object.freeze(doors ? { body, accent, stripe, doors: Object.freeze([...doors]) } : { body, accent, stripe });
  const trainDef = (t) =>
    Object.freeze({
      ...t,
      name: Object.freeze(t.name),
      liveries: Object.freeze(t.liveries.map((l) => livery(...l))),
      livery: livery(...t.liveries[0]),
    });

  /* The roster (Ian, 21 Nov 2026): every vehicle is free and unlocked from the start, in both careers; only the upgrades cost money.
     Five rail trains with one clear job each (name = what it is, `real` = the real unit, `blurb` = what it is good at) and the one Luxtram.
     upgradeRef = the reference price the upgrade prices scale off (the old purchase prices, so the upgrades cost what they cost before).
     Order: the rail trains from small and quick to big and fast, then the tram. */
  const L3 = (lb, de, en) => Object.freeze({ lb, de, en });
  const trains = Object.freeze([
    /* CFL Z 2 "série 2000" (De Dietrich / ANF / Alstom, 1990, 2 cars ABD + B, 25.1 m each, 160 km/h, 164 seats, 1 220 kW for 104 t; withdrawn on 29 Nov 2025):
       the old bordeaux + cream units with the yellow nose. The lightest train of the roster: it pulls away and stops quickest (it absorbed the old fictional Schinnebus).
       body = cream sides, accent = bordeaux, stripe = yellow (nose upper, doors). */
    trainDef({
      id: 'emu', name: L3('Lokalzuch', 'Nahverkehrszug', 'Local train'), kind: 'rail', price: 0, upgradeRef: 12000,
      real: L3('CFL Z 2 (Serie 2000)', 'CFL Z 2 (Baureihe 2000)', 'CFL Z 2 (class 2000)'),
      blurb: L3('Kleng a flénk: fiert am séiersten un a bremst am kierzsten. Ideal fir Linnen mat ville Stoppen am Land.', 'Klein und flink: fährt am schnellsten an und bremst am kürzesten. Ideal für Strecken mit vielen Halten im Land.', 'Small and nimble: the quickest to pull away and to stop. Made for stopping services inside the country.'),
      maxKmh: 160, accel: 1.15, brake: 1.3, emergency: 1.8, massT: 104, cars: 2, capacity: 164, doorsPerSide: 3, carLength: 25.9,
      cab: 'emu', model: 'emu', sound: 'electric',
      liveries: [['#e9e3d0', '#b23a52', '#e6a923'], ['#e7e8ea', '#ef3b45', '#2a2e33'], ['#dfe6ea', '#1b6e8f', '#e7b32c'], ['#262a32', '#c8312b', '#e7e8ea']],
    }),
    /* CFL 2400 (Alstom Coradia Stream HC, in service since 29 Sep 2024, 3 double-deck cars, 82 m, 160 km/h, 334 seats, step-free): white sides, big red front and red skirt.
       Stands for the whole modern CFL double-deck EMU fleet (it absorbed the 2200 Duplex and the 2300 KISS: 3 cars, 160 km/h, ~300 seats each). */
    trainDef({
      id: 'c2400', name: L3('Regionalzuch', 'Regionalzug', 'Regional train'), kind: 'rail', price: 0, upgradeRef: 85000,
      real: L3('CFL 2400 (Alstom Coradia Stream)', 'CFL 2400 (Alstom Coradia Stream)', 'CFL 2400 (Alstom Coradia Stream)'),
      blurb: L3('Den Allrounder: moderne Duebeldecker mat duebel esou vill Plaz. Fiert iwwerall, och op Tréier, Metz a Bréissel.', 'Der Allrounder: moderner Doppelstock mit doppelt so viel Platz. Fährt überall, auch nach Trier, Metz und Brüssel.', 'The all-rounder: a modern double-decker with twice the seats. Runs everywhere, Trier, Metz and Brussels included.'),
      maxKmh: 160, accel: 0.9, brake: 1.15, emergency: 1.65, massT: 220, cars: 3, capacity: 334, doorsPerSide: 2, carLength: 27.4,
      cab: 'coradia', model: 'coradia', sound: 'electric',
      liveries: [['#e7e9eb', '#ef3b45', '#2a2d34'], ['#dedfe2', '#1b4f9c', '#e7b32c'], ['#c9ced3', '#e9742c', '#2a2d34'], ['#2a2d34', '#ef3b45', '#dedfe2']],
    }),
    /* CFL 4000 (Bombardier TRAXX, 2004, 140 km/h) pushing / pulling Dosto double-deck coaches (driving trailer at the other end): the workhorse of the CFL regional lines.
       The heavy one: the most seats (and one coach more at the top capacity level), slow to start and to stop (it absorbed the long 2450 Coradia). */
    trainDef({
      id: 'dosto', name: L3('Grousse Zuch', 'Großer Zug', 'Big train'), kind: 'rail', price: 0, upgradeRef: 70000,
      real: L3('CFL 4000 + Dosto-Wagonen', 'CFL 4000 + Dosto-Wagen', 'CFL 4000 + Dosto coaches'),
      blurb: L3('Laang a schwéier: déi meeschte Plazen fir d’Spëtzestonn, mee lues beim Ufueren a laang Bremsweeër.', 'Lang und schwer: die meisten Plätze für die Stoßzeit, aber träge beim Anfahren und lange Bremswege.', 'Long and heavy: the most seats for the rush hour, but slow to pull away and long to stop.'),
      maxKmh: 140, accel: 0.7, brake: 1.05, emergency: 1.55, massT: 330, cars: 6, capacity: 550, doorsPerSide: 2, carLength: 25.2,
      cab: 'dosto', model: 'dosto', sound: 'electric',
      liveries: [['#d4d7da', '#ef3b45', '#2a2d34'], ['#dedfe2', '#ef3b45', '#7b1220'], ['#1b4f9c', '#dcdcdc', '#e7b32c'], ['#2a2d34', '#e7b32c', '#dcdcdc']],
    }),
    /* CFL 3000 (Alstom, 1997, 200 km/h, the Brussels - Luxembourg locomotive) with grey single-deck coaches and a driving trailer. */
    trainDef({
      id: 'ic', name: L3('Intercity', 'Intercity', 'Intercity'), kind: 'rail', price: 0, upgradeRef: 100000,
      real: L3('CFL 3000 + Wagonen', 'CFL 3000 + Wagen', 'CFL 3000 + coaches'),
      blurb: L3('Séier op laange Strecken: bis 200 km/h, mee e laange Bremswee. Fir Bréissel, Metz a Koblenz.', 'Schnell auf langen Strecken: bis 200 km/h, aber ein langer Bremsweg. Für Brüssel, Metz und Koblenz.', 'Fast on long lines: up to 200 km/h, but a long braking distance. For Brussels, Metz and Koblenz.'),
      maxKmh: 200, accel: 0.6, brake: 1.0, emergency: 1.5, massT: 360, cars: 7, capacity: 440, doorsPerSide: 2, carLength: 25,
      cab: 'ic', model: 'ic', sound: 'electric',
      liveries: [['#dadde0', '#ef3b45', '#ecc62c'], ['#1b4f9c', '#dcdcdc', '#e7b32c'], ['#e8e6df', '#c8312b', '#2a2a2e'], ['#2a2d34', '#e7b32c', '#dcdcdc']],
    }),
    /* SNCF TGV inOui Euroduplex (TGV 2N2, 2 power cars + 8 double-deck trailers = 200 m, 320 km/h on the LGV Est): silver-white, dark window band, red swoosh on the nose. */
    trainDef({
      id: 'hst', name: L3('TGV', 'TGV', 'TGV'), kind: 'rail', price: 0, upgradeRef: 180000,
      real: L3('SNCF TGV inOui (Duplex)', 'SNCF TGV inOui (Duplex)', 'SNCF TGV inOui (Duplex)'),
      blurb: L3('Den Héichgeschwindegkeetszuch: 320 km/h op der LGV bis op Paräis. Brauch laang fir unzefueren a fir ze bremsen.', 'Der Hochgeschwindigkeitszug: 320 km/h auf der LGV bis Paris. Braucht lange zum Anfahren und zum Bremsen.', 'The high-speed train: 320 km/h on the LGV to Paris. Takes long to speed up and to stop.'),
      maxKmh: 320, accel: 0.55, brake: 0.95, emergency: 1.35, massT: 424, cars: 10, capacity: 508, doorsPerSide: 2, carLength: 20,
      cab: 'hst', model: 'hst', sound: 'hst',
      liveries: [['#cdd0d4', '#9b1d47', '#2f343c'], ['#2a3a6b', '#d8dce2', '#c8312b'], ['#d8dce2', '#2a2d34', '#e7b32c'], ['#2a2d34', '#c8312b', '#d8dce2']],
    }),
    trainDef({
      id: 'tram', name: L3('Luxtram', 'Luxtram', 'Luxtram'), kind: 'tram', price: 0, upgradeRef: 40000,
      real: L3('CAF Urbos (Luxtram T1)', 'CAF Urbos (Luxtram T1)', 'CAF Urbos (Luxtram T1)'),
      blurb: L3('Den Tram duerch d’Stad: héchstens 70 km/h, vill Arrêten a vill Leit.', 'Die Tram durch die Stadt: höchstens 70 km/h, viele Halte und viele Fahrgäste.', 'The tram through the city: 70 km/h at most, many stops and many passengers.'),
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
  ]);

  /* Trains that left the roster on 21 Nov 2026 -> the kept train they became. career.js normalize moves every save over: ownership, the selected train,
     the upgrades (the higher level stays; the money paid for levels that can't be carried over goes back to the wallet) and resume snapshots (resume.js).
     upgradeRef = their old purchase price, which priced their upgrades (needed for the refund). Their 3D models stay in trains.js (the station yards use them). */
  const retiredTrains = Object.freeze({
    railcar: Object.freeze({ to: 'emu', upgradeRef: 9000, name: L3('Schinnebus', 'Schienenbus', 'Railbus') }),
    z2200: Object.freeze({ to: 'c2400', upgradeRef: 28000, name: L3('CFL 2200 (Duebeldecker)', 'CFL 2200 (Doppelstock)', 'CFL 2200 (Duplex)') }),
    kiss: Object.freeze({ to: 'c2400', upgradeRef: 55000, name: L3('CFL 2300 (KISS)', 'CFL 2300 (KISS)', 'CFL 2300 (KISS)') }),
    c2450: Object.freeze({ to: 'dosto', upgradeRef: 140000, name: L3('CFL 2450 (laang Coradia)', 'CFL 2450 (langer Coradia)', 'CFL 2450 (long Coradia)') }),
  });

  /* Upgrade price table per train: { motor:[p1..p4], brakes:[...], ... } (price of going from level i to i+1). */
  const roundTo = (n, step) => Math.round(n / step) * step;
  const upgradeTable = (ref) => Object.freeze(
    Object.fromEntries(UPGRADE_KINDS.map((k) => [k, Object.freeze(UPGRADE_FACTORS[k].map((f) => Math.max(100, roundTo(ref * f, ref >= 50000 ? 500 : 100))))]))
  );
  const upgrades = Object.freeze(Object.fromEntries(trains.map((t) => [t.id, upgradeTable(t.upgradeRef)])));
  const retiredUpgrades = Object.freeze(Object.fromEntries(Object.entries(retiredTrains).map(([id, r]) => [id, upgradeTable(r.upgradeRef)])));   // for the refunds
  const upgradeMaxLevels = Object.freeze(Object.fromEntries(UPGRADE_KINDS.map((k) => [k, UPGRADE_FACTORS[k].length])));

  /* needs: tokens matched against the train's id OR kind ('rail' | 'tram'). Every route is unlocked from the start (no prices since 21 Nov 2026);
   * needs only says which trains may run it: the long lines abroad want a big train (not the small Lokalzuch), Paris the TGV.
   * fareScale: multiplies the whole fare of a service (career.js reward). W5 timing cut the scheduled minutes of every route by 10 - 26 % (no more dead waiting at the stops);
   * the scale = new / old scheduled minutes keeps the money per minute of play where it was (scripts/zuch/career_probe.mjs). */
  const LONG_LINE = Object.freeze(['c2400', 'dosto', 'ic', 'hst']);
  const routeRules = Object.freeze({
    west: Object.freeze({ price: 0, needs: Object.freeze(['rail']), fareBase: 20, fareScale: 0.88 }),
    south: Object.freeze({ price: 0, needs: Object.freeze(['rail']), fareBase: 26, fareScale: 0.91 }),
    east: Object.freeze({ price: 0, needs: Object.freeze(['rail']), fareBase: 24, fareScale: 0.87 }),
    wittlich: Object.freeze({ price: 0, needs: Object.freeze(['rail']), fareBase: 34, fareScale: 0.88 }),
    north: Object.freeze({ price: 0, needs: Object.freeze(['rail']), fareBase: 32, fareScale: 0.89 }),
    trier: Object.freeze({ price: 0, needs: LONG_LINE, fareBase: 55, fareScale: 0.78 }),
    metz: Object.freeze({ price: 0, needs: LONG_LINE, fareBase: 50, fareScale: 0.74 }),
    brussels: Object.freeze({ price: 0, needs: LONG_LINE, fareBase: 65, fareScale: 0.74 }),
    paris: Object.freeze({ price: 0, needs: Object.freeze(['hst']), fareBase: 120, fareScale: 0.8 }),
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
    rail: Object.freeze({ id: 'rail', icon: '🚆', startTrain: 'emu', startRoute: 'west', ranks: Object.freeze([0, 15000, 80000, 250000, 600000]), rankIds: Object.freeze(['praktikant', 'lokfeierer', 'senior', 'chef', 'legend']) }),
    tram: Object.freeze({ id: 'tram', icon: '🚋', startTrain: 'tram', startRoute: 'luxtram-stad', ranks: Object.freeze([0, 10000, 50000, 150000, 400000]), rankIds: Object.freeze(['tram_praktikant', 'wattman', 'tram_senior', 'tram_chef', 'tram_legend']) }),
  });
  const ranks = careers.rail.ranks;
  const rankIds = careers.rail.rankIds;

  TS.config = Object.freeze({
    trains, retiredTrains, upgrades, retiredUpgrades, upgradeMaxLevels, upgradeKinds: UPGRADE_KINDS, upgradeEffects: UPGRADE_EFFECTS, speedCaps: SPEED_CAPS, extraCarTrains: EXTRA_CAR_TRAINS,
    routeRules, routeOrder, economy, ranks, rankIds, careers, saveVersion: 2, coachServices: 3,
  });
})();
