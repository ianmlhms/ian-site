/* Ski Alpen: every tunable number in one place (pure module, no DOM, no THREE).
 * World frame of a resort: metres, x = east, z = south, y = up (metres above sea level); origin = the north-west corner of the resort box
 * (see scripts/ski/common.py). Physics in SI units. */

export const GAME_ID = 'ski';
export const SAVE_KEY = 'pb_ski_save';

/* Height data, the same numbers as scripts/ski/common.py */
export const DATA = Object.freeze({
  nearStep: 5,              // m between the nodes of a height tile
  tileCells: 256,           // cells per height tile (files hold 257 x 257 nodes)
  tileSize: 1280,
  farStep: 40,
  farMargin: 14000,
  classStep: 10,
  feather: 160,             // m over which a height tile blends into the far grid where its neighbour is missing (or still loading)
  startRadius: 1500,        // m around the start gate whose tiles must be there before the start button goes live
  fetchConcurrency: 4,
});

/* The terrain quadtree (same scheme as MTB: CDLOD, exact stitching to coarser neighbours, skirts as a second line of defence). */
export const QUADTREE = Object.freeze({
  cells: 32,
  minSize: 80,              // LOD 0 tile: 80 m, 2.5 m node spacing = the physics lattice
  rootSize: 81920,
  splitFactor: 1.0,
  splitHysteresis: 0.08,
  protectedSize: 320,       // nodes up to this size always split with the full factor (the skier's 3 x 3 LOD 0 tiles); quality only coarsens farther nodes
  skirtDepth: 4,
  skirtPerStep: 0.5,
  reselectDistance: 12,     // m the skier moves before the tile set is re-evaluated
});
export const LATTICE = QUADTREE.minSize / QUADTREE.cells;      // 2.5 m

/* Relief added on top of the DEM (part of THE height function, so render and physics agree): wind drifts off the piste, soft rollers on it. */
export const RELIEF = Object.freeze({
  driftAmp: 0.42, driftScale: 17,     // off-piste: wind-blown snow, about 0.4 m high, 17 m apart
  pisteAmp: 0.22, pisteScale: 26,     // groomed: soft rollers (small airs at speed)
});

export const QUALITY = Object.freeze({
  low: { pixelRatio: 1, lodScale: 0.55, far: 17000, treeRadius: 240, treeDensity: 0.55, treeNear: 70, rockRadius: 160, markerRadius: 260, liftRadius: 1800, buildingRadius: 2600, snowflakes: 500, spray: 40, cheapSnow: true },
  medium: { pixelRatio: 1.25, lodScale: 0.75, far: 23000, treeRadius: 380, treeDensity: 0.8, treeNear: 95, rockRadius: 240, markerRadius: 380, liftRadius: 2600, buildingRadius: 4000, snowflakes: 1100, spray: 70, cheapSnow: false },
  high: { pixelRatio: 2, lodScale: 1, far: 30000, treeRadius: 560, treeDensity: 1, treeNear: 130, rockRadius: 320, markerRadius: 520, liftRadius: 3600, buildingRadius: 6000, snowflakes: 2000, spray: 110, cheapSnow: false },
});
export const FRAME_BUDGET_MS = Object.freeze({ low: 40, medium: 30, high: 24 });   // the watchdog steps the level down after 3 s above this

/* Skier physics (arcade, not a simulator). See skier.js for how each number is used. */
export const SKI = Object.freeze({
  dt: 1 / 120,
  mass: 80,
  muGroomed: 0.035,         // ski-snow friction on the piste
  muPowder: 0.1,            // ... in deep snow
  powderDrag: 0.011,        // extra speed-squared drag in deep snow (1/m): a 30 degree powder slope tops out near 60 km/h
  cdaUpright: 0.8,          // m2 of air drag standing (with the arms out: a 10 degree blue run tops out near 60 km/h)
  cdaTuck: 0.42,            // ... tucked (about 80 km/h on the same run)
  airDensity: 1.0,          // thin mountain air (kg/m3)
  maxSpeed: 33,             // hard cap, m/s (119 km/h)
  gripGroomed: 1.25,        // max lateral acceleration while carving, in g
  gripPowder: 0.85,
  pivotRate: 2.7,           // rad/s heading change at walking speed
  carveGain: 1.1,           // heading rate at speed = carveGain * grip * g / v
  tuckSteer: 0.55,          // steering authority while tucked
  edgeLock: 9,              // 1/s: how fast the velocity follows the skis while the edges hold
  skidLoss: 0.9,            // share of the lateral speed that is scrubbed (not turned) when the skis skid
  brakeDecel: 4.2,          // m/s2 of snowplough braking at full input (fades below 2 m/s)
  brakeSteer: 0.7,
  pushAccel: 1.8,           // skating on flats (W / up), only below pushMaxSpeed
  pushMaxSpeed: 6,
  climbSpeed: 2.2,          // below this the push walks uphill (herringbone): no flat, rise or hollow leaves a player stuck
  climbMax: 4.6,            // m/s2: the steepest it climbs is about 20 degrees (40 %) on the piste
  leaveGround: 0.95,        // the ground falls away faster than this many g: the skier takes off
  stickGap: 0.06,           // m: closer than this to the ground counts as touching
  hardLanding: 10.5,        // m/s into the ground at landing: a crash
  hitCrash: 5,              // m/s into a trunk or rock: a crash (slower: a bump that stops you)
  bodyRadius: 0.35,
  jumpPop: 3.2,             // m/s upward pop of the jump key
  jumpCooldown: 0.6,
  crashSeconds: 1.6,        // tumble before the respawn
  offPisteLimit: 420,       // m from the nearest piste: beyond that the skier is sent back
  // tricks (round 4A: snow park and free ride, world.tricks)
  spinRate: 9,              // rad/s spin at full steer in the air (a 1080 takes about 2.1 s)
  flipRate: 6.6,            // rad/s flip at full up / down (one flip about 0.95 s: only the big kickers give that air)
  spinClean: 0.3, spinCrash: 0.85,   // rad off a whole half turn at touch-down: clean below, a fall above
  flipClean: 0.5, flipCrash: 1.0,    // rad off a whole flip
  spinSettle: 2.4, flipSettle: 2.2,  // rad/s the rotation settles onto a whole half turn / flip without input
  parkHardLanding: 12.5,    // m/s into the ground: a fall (park landings are built steep, a little more forgiving)
});

export const CAMERA = Object.freeze({
  fov: 60,
  near: 0.3,
  followDistance: 5.2,
  followHeight: 2.3,
  lookAhead: 7,
  lookHeight: 0.9,
  minClearance: 0.6,
  fovGain: 16,
  fovFrom: 6,
  fovTo: 26,
  shake: 0.04,
  clearanceProbe: 6,
});

export const PLAY = Object.freeze({
  countdown: 3,
  checkpointEvery: 220,     // m along the piste between the (invisible) checkpoints a run must pass
  checkpointSlack: 60,      // m beyond the piste half width a checkpoint still counts
  maxRunSpeed: 40,          // m/s along the piste line: a run faster than length / this is impossible (never saved, never posted; same floor in scripts/ski-v1.sql)
  slalomGap: 42,            // m between slalom gates
  slalomMiss: 5000,         // ms added per missed gate
  slalomHalfWidth: 3.2,     // m between the gate's inner pole and the centre line
  finishRadius: 30,
  freeRideNextRadius: 90,   // m: a piste whose top lies this close to the bottom of the last one continues the free ride
  ghostEvery: 0.25,         // s between recorded ghost samples
});

/* OSM difficulty -> colour class. France: novice = green, easy = blue, intermediate = red, advanced / expert = black. */
export const DIFF = Object.freeze({
  green: { hex: 0x3aa655, css: '#2f9a4c', name: 'Gréng', width: 34 },
  blue: { hex: 0x2f6fd8, css: '#2a66d0', name: 'Blo', width: 36 },
  red: { hex: 0xd8392f, css: '#d0352c', name: 'Rout', width: 30 },
  black: { hex: 0x1d1f24, css: '#1d1f24', name: 'Schwaarz', width: 26 },
});
export const DIFF_IDS = Object.freeze(['green', 'blue', 'red', 'black']);

/* Modes. Only 'run' and 'free' exist in phase 1; the others are the hooks for the next rounds (stars / challenges, the snowpark,
 * free ride across the whole area, live races through the lobby). game.js switches on these ids, so a new mode is one new branch. */
export const MODES = Object.freeze({ run: 'run', free: 'free', challenge: 'challenge', park: 'park', race: 'race' });
