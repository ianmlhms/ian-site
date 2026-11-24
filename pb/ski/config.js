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
  // res (round 5, post.js): the INTERNAL pixel ratio against CSS pixels: where it starts, the floor and ceiling of the dynamic resolution,
  // MSAA samples, how much the final pass sharpens; supersample = the ceiling on a 1x screen. The canvas is always the screen's own resolution.
  low: { res: { start: 1.25, min: 0.9, max: 1.5, samples: 2, sharpen: 0.55 }, lodScale: 0.55, protect: 160, far: 17000, treeRadius: 240, treeDensity: 0.55, treeNear: 70, rockRadius: 160, markerRadius: 260, liftRadius: 1800, buildingRadius: 2600, snowflakes: 500, spray: 40, cheapSnow: true },
  medium: { res: { start: 1.5, min: 1.1, max: 2, samples: 4, sharpen: 0.45, supersample: 1.25 }, lodScale: 0.66, far: 23000, treeRadius: 380, treeDensity: 0.8, treeNear: 95, rockRadius: 240, markerRadius: 380, liftRadius: 2600, buildingRadius: 4000, snowflakes: 1100, spray: 70, cheapSnow: false },
  high: { res: { start: 2, min: 1.5, max: 2, samples: 4, sharpen: 0.3, supersample: 1.5 }, lodScale: 1, far: 30000, treeRadius: 560, treeDensity: 1, treeNear: 130, rockRadius: 320, markerRadius: 520, liftRadius: 3600, buildingRadius: 6000, snowflakes: 2000, spray: 110, cheapSnow: false },
});
// R8c (QA: 590-910k triangles in the villages): Mëttel lodScale 0.75 -> 0.66 (the far terrain a step coarser; the far normal map
// carries its shape), with village.js / roads.js / forest-far.js / markers.js budgets.
export const FRAME_BUDGET_MS = Object.freeze({ low: 40, medium: 30, high: 24 });   // the watchdog steps the level down after 3 s above this

/* The other skiers (npc.js, npc-view.js; Ian: "you're not alone in the whole ski area"). Per Grafik level: how many are drawn at most
 * (skiers on the pistes, standing at the lifts, walking in the villages, riding the carriers), within which radius, how many of the
 * nearest get the finer figure (and a shadow on Mëttel / Héich). The rest of the numbers shape them (m, s, m/s). */
export const NPC = Object.freeze({
  levels: Object.freeze({
    low: { skiers: 18, queue: 6, walkers: 3, riders: 22, near: 3, radius: 380, queueRadius: 240, walkRadius: 220, riderRadius: 300 },
    medium: { skiers: 32, queue: 10, walkers: 5, riders: 48, near: 6, radius: 560, queueRadius: 340, walkRadius: 300, riderRadius: 480 },
    high: { skiers: 48, queue: 14, walkers: 8, riders: 84, near: 10, radius: 760, queueRadius: 460, walkRadius: 380, riderRadius: 680 },
  }),
  nearRadius: 70,             // m: the finer figure only this close
  perMetre: Object.freeze({ green: 1 / 28, blue: 1 / 34, red: 1 / 50, black: 1 / 85 }),      // skiers per m of piste (busy day)
  maxPerPiste: 90,
  stopShare: 0.35,            // share of the skiers that stop once on their way down (at the side of the piste)
  stopSeconds: [5, 16], restSeconds: [15, 70],
  edgeMargin: 1.2,            // m inside the piste edge
  bodyR: 0.45, playerR: 0.45, // m: their size and the player's for the bump
  personal: 1.6,              // m: closer than 2 x this, the one behind moves aside
  clearPlayer: 3.2,           // m: a skier passes the player at least this far (if the band lets him)
  avoidRate: 2.4, avoidMax: 6, yieldSlow: 0.6, stepAside: 1.8,
  queue: Object.freeze({ chair: 7, gondola: 6, cable: 8, drag: 3, rope: 2, train: 6 }),
  occupancy: Object.freeze({ chair: 0.55, gondola: 0.55, cable: 0.95, drag: 0.5, train: 0.85 }),
  walkNear: 320, walkPerRoad: 2,
  selectEvery: 0.3, bandBudget: 64,
  corridorMargin: 12,         // m beyond a running challenge's piste edge where nobody is drawn
  fadeNear: 110,              // m: closer than this a skier who appears / goes grows / shrinks (no pop)
});

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
  carveGain: 1.0,           // heading rate at speed = carveGain * grip * g / v (1.1 until the physics review: full steer always out-turned the grip)
  carveFree: 0.03,          // slip (sine, ~1.7 degrees) that a clean carve carries for free; only what is beyond it scrubs speed
  tuckSteer: 0.55,          // steering authority while tucked
  edgeLock: 9,              // 1/s: how fast the velocity follows the skis while the edges hold
  skidLoss: 0.9,            // share of the lateral speed that is scrubbed (not turned) when the skis skid
  brakeDecel: 4.2,          // m/s2 of snowplough braking at full input (fades below 2 m/s)
  hockeyFrom: 7,            // round 7: above this (25 km/h), or braking with a hard steer above 4 m/s, the brake is a parallel hockey stop
  hockeyTurn: 7.5,          // rad/s the skis swing across the motion
  hockeyDecel: 4,         // m/s2 on top of the edge scrub: edges dig in
  brakeSteer: 0.7,
  pushAccel: 1.8,           // skating on flats (W / up), only below pushMaxSpeed
  pushMaxSpeed: 6,
  // launch follow-up (22 Nov 2026, Ian: "at low speed ... accelerate faster to at least ~45 km/h"): an arcade push on the snow below
  // ~45 km/h (skier.js groundStep): full below assistFull, faded out smoothly by assistTo; downhill on its own, on flats and gentle rises
  // (up to ~3 degrees) while push or tuck is held; never braking, in a stop, in the air, on a lift or above the climb limits
  assistAccel: 2.6,         // m/s2
  assistFlat: 0.9,          // m/s2 more where gravity does not help (flat or a rise; nothing extra from 6 degrees downhill)
  assistFull: 10.5,         // m/s (38 km/h)
  assistTo: 13.9,           // m/s (50 km/h): no assist from here on
  climbSpeed: 2.2,          // below this the push walks uphill (herringbone): no flat, rise or hollow leaves a player stuck
  climbMax: 4.6,            // m/s2: the steepest it climbs is about 20 degrees (40 %) on the piste
  leaveGround: 0.95,        // the ground falls away faster than this many g: the skier takes off
  stickGap: 0.06,           // m: closer than this to the ground counts as touching
  crestLeave: 0.3,          // m/s away from the slope right after a take-off: faster than this he stays in the air (a real crest)
  airSteer: 0.6,            // rad/s the steering bends the flight line in a plain air (no trick)
  airMagnet: 0.5,           // rad/s the flight line bends back towards the groomed snow when it would end beside the piste
  hardLanding: 10.5,        // m/s into the ground at landing: a crash
  softLanding: 16.5,        // ... after a normal air (at most softAir s in the air): crests throw him into run-outs, the legs take more
  softAir: 2.6,             // s
  hitCrash: 5,              // m/s into a trunk or rock: a crash (slower: a bump that stops you)
  bodyRadius: 0.35,
  jumpPop: 4.2,             // m/s upward pop of the jump key (launch fix: 3.2 read as a crouch; 4.2 = ~0.9 m up, ~0.85 s in the air on the flat)
  jumpWind: 0.12,           // s of crouch before the pop (the model dips, then he takes off)
  jumpCooldown: 0.6,
  crashSeconds: 1.6,        // tumble before the respawn
  landingCrashSeconds: 1.1, // cleanup round (cliff routes): a landing crash (not a park trick) tumbles shorter, the respawn is where he landed
  respawnRoll: 6,           // m/s down the line after that respawn (he gets up and skis on: back to speed in ~1 s, never on top of the drop)
  offPisteLimit: 420,       // m from the nearest piste: beyond that the skier is sent back
  // tricks (round 4A: snow park and free ride, world.tricks)
  spinRate: 9,              // rad/s spin at full steer in the air (a 1080 takes about 2.1 s)
  flipRate: 6.6,            // rad/s flip at full up / down (one flip about 0.95 s: only the big kickers give that air)
  spinClean: 0.3, spinCrash: 0.85,   // rad off a whole half turn at touch-down: clean below, a fall above
  flipClean: 0.5, flipCrash: 1.0,    // rad off a whole flip
  spinSettle: 2.4, flipSettle: 2.2,  // rad/s the rotation settles onto a whole half turn / flip without input
  parkHardLanding: 12.5,    // m/s into the ground: a fall (park landings are built steep, a little more forgiving)
});

/* The chase camera (camera.js): from above and behind. Heights / distances in m against the skier, speeds in m/s.
 * After launch (Ian: "more from above, less straight from behind"): followHeight 2.3 -> 3.4, the height grows with the speed from the
 * first metres (heightGain), the rise* numbers are bigger, the height follows the snow rising behind him (slope*), the view looks 8 m
 * ahead (the skier sits below the middle of the picture, the piste ahead and the horizon above him). */
export const CAMERA = Object.freeze({
  fov: 60,
  near: 0.3,
  followDistance: 5.6,
  followHeight: 3.4,
  distGain: 0.08, distGainMax: 1.6,          // m back per m/s, up to distGainMax
  heightGain: 0.1, heightGainMax: 1.4,      // m up per m/s, up to heightGainMax (reached at 50 km/h)
  slopeGain: 0.5, slopeMax: 9, slopeEase: 2.5,      // share of the snow's rise behind him that the camera climbs with; its cap (m); 1/s
  lineClearance: 0.9, liftMax: 7,            // m the line camera -> skier keeps over a crest; the most the camera climbs for it
  yawRate: 2.6,                              // 1/s the view follows the direction of travel
  lookAhead: 8,
  lookHeight: 0.5,
  skierLow: 0.7,                             // the skier never sits lower than this share of the half height below the middle
  horizonMargin: 4,                          // degrees of sky side kept above the horizontal at the top edge
  minClearance: 0.6,
  fovGain: 16,
  fovFrom: 6,
  fovTo: 26,
  shake: 0.04,
  clearanceProbe: 6,
  riseFrom: 6, riseTo: 26, riseUp: 2.4, riseBack: 2.2, riseLook: 0.7,      // round 7 (A): the chase camera climbs with the speed (m/s, m)
});

export const PLAY = Object.freeze({
  countdown: 3,
  checkpointEvery: 220,     // m along the piste between the (invisible) checkpoints a run must pass
  checkpointSlack: 60,      // m beyond the piste half width a checkpoint still counts
  maxRunSpeed: 33,          // m/s along the piste line = SKI.maxSpeed (security review M4): a run faster than length / this is impossible (never saved, never posted; same floor in scripts/ski-v1.sql)
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

/* "Zoufälleg" weather / time of day: the odds (env.js; a race draws from the same lists with a shared seed, pb/ski/net/plan.js) */
export const RANDOM_WEATHER = Object.freeze(['sun', 'sun', 'sun', 'cloudy', 'snow', 'fog']);
export const RANDOM_TIME = Object.freeze(['morning', 'midday', 'midday', 'evening']);

/* Modes. Only 'run' and 'free' exist in phase 1; the others are the hooks for the next rounds (stars / challenges, the snowpark,
 * free ride across the whole area, live races through the lobby). game.js switches on these ids, so a new mode is one new branch. */
export const MODES = Object.freeze({ run: 'run', free: 'free', challenge: 'challenge', park: 'park', race: 'race', freeride: 'freeride' });
/* Round 4A: every 'run' is also the piste's star challenge (modes/challenges.js; 'challenge' stays an alias hook), 'park' = a scored snow
 * park run (modes/park.js), 'freeride' = the whole area all day from a lift top (modes/freeride.js); 'free' = the old guided free ride. */

/* Round 7-C: the first lift of each resort (the main village lift a real visitor takes first; matched by name in resort.json, else
 * modes/freeride.js spawnLift picks one), the discovery grid behind the map teleport, the first-person camera, the avalanches, the
 * challenge course (start gate on open snow, push start, barriers, arrows, finish arch, leaving the course). */
export const FIRST_LIFT = Object.freeze({
  killy: ['Olympique', 'Solaise'],                         // Val d'Isère centre: the Olympique gondola up to Bellevarde
  '3vallees': ['Verdons', 'Jardin Alpin'],                 // Courchevel 1850: the Verdons gondola
  zermatt: ['Matterhorn Express 1', 'Zermatt - Furi'],     // Zermatt village: the Matterhorn Express from Schluhmatt
  arlberg: ['Galzigbahn', 'Nassereinbahn'],                // St. Anton: the Galzigbahn from the village centre
  kronplatz: ['Kronplatz I - Plan de Corones I', 'Ried'],  // Reischach / Riscone: Kronplatz I
  vialattea: ['Sestriere - Fraiteve 1', 'Cit Roc'],        // Sestriere village: the Fraiteve gondola
  livigno: ['Mottolino Gondola', 'Livigno-Tagliede'],      // Livigno centre: the Mottolino gondola from the village
  davos: ['Parsennbahn 1', 'Klosters - Gotschnaboden'],    // Davos Dorf: the Parsenn funicular up to Weissfluhjoch
  obertauern: ['Zehnerkarbahn I', 'Grünwaldkopfbahn'],   // the west end of the pass village: the Zehnerkar gondola
});
// R8d (Ian): separate areas of a resort's pass, reached by the ski bus (no piste / lift links them): the valley station of each listed
// lift is discovered from the start like the first lift, so the map teleport and the lift list reach it (Sonnenkopf: Klösterle, bus
// from Stuben / Langen on the Ski Arlberg pass)
export const BUS_AREAS = Object.freeze({
  arlberg: ['Sonnenkopfbahn'],
  // Davos Klosters: Jakobshorn (Davos Platz), Rinerhorn (Glaris) and Madrisa (Klosters Dorf) are reached by bus / Rhaetian Railway
  davos: ['Jakobshornbahn Sektion 1', 'Rinerhornbahn', 'Madrisabahn'],
});
export const DISCOVERY = Object.freeze({
  cell: 100,                // m: the discovery grid
  reveal: 140,              // m round the skier that count as seen
  station: 220,             // m round a reached lift station
  spawn: 320,               // m round the first lift (always discovered)
});
export const FIRST_PERSON = Object.freeze({ eye: 1.62, eyeTuck: 1.15, back: 0.42, fov: 74, fovKick: 16, kickFrom: 5, kickTo: 24, streakFrom: 12, bob: 0.022, lean: 0.13, headIn: 1.3, skiRoll: 0.4, yawRate: 8, motionLook: 0.45, motionMax: 0.2 });
export const AVALANCHE = Object.freeze({
  slope: 35,                // degrees: release only on slopes at least this steep
  pisteGap: 45,             // m off the nearest piste line (never on groomed pistes)
  chance: 0.06,             // per new steep cell crossed (seeded: the same crossing gives the same answer)
  cell: 40,                 // m: the release cells (the far grid)
  width: [50, 110],         // m: slab width
  step: 1 / 30,             // s: fixed simulation step (deterministic for the online free ride)
  caught: 7,                // m from a flowing block = caught
  maxTime: 75,              // s: an avalanche ends at the latest after this
  faces: 3,                 // "Lawin" challenge faces per resort
});
export const COURSE = Object.freeze({
  push: 4.8,                // m/s (17 km/h) start kick down the fall line at "0"
  launchTo: 12.5,           // launch follow-up (Ian: the start was too slow): from the kick the skier is launched to 45 km/h ...
  launchTime: 1.2,          // ... over this many s (an S-curve of speed, skier.js state.kick), then the normal physics take over
  launchMax: 12,            // m/s2: the most the launch adds
  gateSearch: 160,          // m along the piste the start gate may move to find open snow (at most 45 % of the piste; R7-C2: 90 -> 160)
  runIn: 60,
  bannerAlong: 10,          // R8e: m up / down the piste round a start banner where no OTHER piste's line may pass                // R8e: m below the start gate that must be clear of houses / stations (the push start runs into them)
  gateClear: 7,             // m round the gate posts that must be free of buildings, lifts and trees
  barrierEvery: 3,          // m between barrier panels (R7-C2: 6 -> 3, short panels follow the snow without gaps)
  warnAfter: 12,            // m beyond the barriers: "Zréck op d'Pist"
  abortAfter: 8,            // s off the course before "Challenge ofgebrach"
  stuckAfter: 10,           // R8g (was main.js R8b's 10 s): s standing still without progress down the course before the same choice
  finishBack: 12,           // m before the line's end: the finish line
  archHeight: 6,            // m: the top of the ZIL beam over the higher pillar's snow (R7-C2: no course object stands higher)
  barrierBody: 0.45,        // m: the skier's half width against a barrier (R7-C2: soft collision)
  barrierSlow: 0.93,        // share of the speed kept per barrier contact
  barrierBounce: 0.25,      // share of the speed into the net that comes back as a bounce
});
