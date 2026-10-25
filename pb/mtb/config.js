/* MTB Mëllerdall: every tunable number in one place (named constants, no magic numbers elsewhere).
 * Frame: x = east, y = up, z = south, metres, origin = the NORTH-WEST corner of the world box (scripts/mtb/common.py maps it onto LUREF). */

export const WORLD = Object.freeze({
  width: 5632,              // m (x), 11 blocks of 512
  depth: 6144,              // m (z), 12 blocks of 512 (W2 added a row in the south: the Schiessentümpel lies at z 5785)
  block: 512,
  playInset: 192,           // the playable box is the world minus this border; beyond it an invisible wall turns the rider back
  featherDist: 128,         // the 2 m LiDAR grid fades into the 32 m distant-hills grid over this distance from its edge
  farMargin: 8192,          // the distant-hills grid reaches this far beyond the box
  nearStep: 2,              // m between nodes of terrain.bin
  farStep: 32,              // m between nodes of far.bin
});

/* Terrain tiles: ONE quadtree (CDLOD style) over a square root that covers the box and the distant hills. Every tile is a
 * (cells x cells) grid, so a tile of size s has node spacing s / cells: 32 m tiles are the 1 m physics lattice (LOD 0), 64 m tiles 2 m,
 * ... 8192 m tiles 256 m. A node is split while the rider is closer than size * splitFactor (distance to its bounds), so the tiles around
 * the rider are always the finest ones and neighbours differ by about one level. Tile corners and spacings are powers of two, which makes
 * edge stitching exact: a fine tile's edge vertices are moved onto the polyline of the coarser neighbour's lattice nodes (T-junction free),
 * and a skirt hangs under every edge as a second line of defence. */
export const QUADTREE = Object.freeze({
  cells: 32,
  minSize: 32,
  maxSize: 8192,
  rootSize: 32768,
  rootX: -12288,            // multiple of rootSize / 8; the box (0..6144, 0..4608) and its 8 km margin lie inside
  rootZ: -12288,
  splitFactor: 1.0,         // a 64 m node splits when the rider is within 64 m: LOD 0 tiles (32 m, 1 m spacing) cover every tile within 64 m, so the rider's 3 x 3 tiles (>= 32 m margin) are always LOD 0
  splitHysteresis: 0.08,
  protectedSize: 128,       // nodes up to this size always use the full split factor (the 3 x 3 LOD 0 rule); a quality setting only coarsens the bigger, farther nodes
  skirtDepth: 2.5,          // m the skirt hangs below its edge (belt and braces behind the exact stitching)
  skirtPerStep: 0.6,        // + this many m per m of node spacing
  carveFullStep: 1,         // way carving is applied in full up to this node spacing ...
  carveFadeStep: 2,         // ... fades out until here and is off beyond (a 1 m wide path cannot be sampled by a 4 m lattice)
  maxBuiltPerFrame: 3,      // tile meshes (re)built per frame at most (iPad)
  keepSeconds: 4,           // cached tile data lives this long after its last use
});

/* Trail carving: one profile per kind of way. halfWidth = flat bed, width = where the ground is untouched again (m). */
export const WAY_KINDS = Object.freeze({
  trail: { halfWidth: 0.45, width: 2.0, berm: true, spacing: 1 },       // the ridden MTB trails (berms, banking)
  path: { halfWidth: 0.4, width: 1.7, berm: false, spacing: 1.5 },
  track: { halfWidth: 1.5, width: 3.8, berm: false, spacing: 2 },
  road: { halfWidth: 2.8, width: 5.6, berm: false, spacing: 2 },
  /* W2 water: the way is a channel carved into the ground (bed = smoothed ground - depth, never rising along the flow); `waterDepth` is how
   * deep the water stands in it. Streams do not berm and follow the cross slope only a little (a water surface is level). */
  stream: { halfWidth: 0.55, width: 2.6, berm: false, spacing: 1.5, depth: 0.5, waterDepth: 0.22, tiltScale: 0.3, flow: true },
  river: { halfWidth: 1.7, width: 5.4, berm: false, spacing: 2, depth: 0.7, waterDepth: 0.34, tiltScale: 0.25, flow: true },
  ditch: { halfWidth: 0.3, width: 1.5, berm: false, spacing: 1.5, depth: 0.22, waterDepth: 0.08, tiltScale: 0.3, flow: true },
});

export const CARVE = Object.freeze({
  lineSmoothing: 2.2,       // m, sigma of the Gaussian that rounds the corners of the OSM polylines
  bedSmoothing: 2.6,        // m, sigma of the Gaussian that turns the terrain along the line into the bed height
  tiltMax: 0.34,            // max cross tilt of the bed (rise per m)
  bermHeight: 0.62,         // m, tallest berm
  bermOffset: 1.5,          // m from the centre line
  bermSigma: 0.75,          // m
  bermCurvature: 0.09,      // 1/m: curvature that gives the full berm
  coverLow: 0.1,            // coverage smoothstep edges on the normalised kernel sum
  coverHigh: 0.8,
  kernelRadiusFactor: 1.11, // kernel radius = width * this
});

export const SURFACE = Object.freeze({
  lattice: 1,               // m between physics/render nodes (== LOD 0)
  microAmplitude: 0.045,    // m of 1-4 m ground undulation on top of the LiDAR (kept off the trail bed by the carve blend)
  cacheChunks: 64,
});

export const QUALITY = Object.freeze({
  low: { pixelRatio: 1, lodScale: 0.38, treeRadius: 80, treeDensity: 0.45, nearTree: 32, midTree: 54, groundCover: 36, fernRadius: 30, shrubRadius: 40, rockRadius: 90, rockNear: 40, tuftRadius: 0, lifeDetail: 0.4, shadows: false, far: 5200, cheapGround: true },
  medium: { pixelRatio: 1.25, lodScale: 0.7, treeRadius: 135, treeDensity: 0.7, nearTree: 44, midTree: 84, groundCover: 56, fernRadius: 48, shrubRadius: 62, rockRadius: 140, rockNear: 55, tuftRadius: 16, lifeDetail: 0.7, shadows: false, far: 7000, cheapGround: false },
  high: { pixelRatio: 2, lodScale: 1, treeRadius: 220, treeDensity: 1, nearTree: 54, midTree: 112, groundCover: 90, fernRadius: 70, shrubRadius: 90, rockRadius: 190, rockNear: 70, tuftRadius: 24, lifeDetail: 1, shadows: true, far: 9000, cheapGround: false },
});

export const CAMERA = Object.freeze({
  fov: 62,
  near: 0.1,
  followDistance: 4.1,
  followHeight: 2.15,       // higher than W1: the trail ahead stays in view over the rider
  sideOffset: 0.55,         // m to the rider's right: the rider is not exactly in the middle of the picture
  lookAhead: 5.5,           // the camera looks this far ahead along the heading
  lookHeight: 1.0,          // ... at this height above the rider's ground
  minClearance: 0.55,       // the camera never gets closer than this to the ground (m)
  farDistance: 7.2,         // the far chase camera
  farHeight: 3.4,
  helmetForward: 0.32, helmetHeight: 1.72, helmetFov: 78,
  shake: 0.055,             // m of camera shake at full speed on rough ground
  clearanceProbe: 6,        // ground probes along the camera boom
  bodyRadius: 0.55,         // the camera is a ball of this radius: it never sits inside a trunk, a crown or a rock
});

/* Bike physics (SI units). One rider + bike point mass on the physics surface; see DESIGN.md section 6. */
export const BIKE = Object.freeze({
  mass: 86,                 // rider + bike (kg)
  gravity: 9.81,
  wheelbase: 1.12,
  power: 270,               // W of a fit rider at full throttle (short climbs: a rider gives more than the sustained 200 W for a few seconds)
  pedalForceMax: 330,       // N at the rear wheel (tractive limit before grip)
  cdA: 0.52,                // m2, upright rider
  airDensity: 1.2,
  brakeDecel: 7.4,          // m/s2 at full braking on good grip (front+rear blended)
  steerMax: 0.52,           // rad of bar angle at standstill
  steerSpeedRef: 5.5,       // m/s: the bar angle halves at this speed (the rider leans instead of turning the bars)
  steerRate: 9,             // 1/s: how fast the bar follows the input
  leanMax: 0.62,            // rad (35 degrees)
  leanRate: 7,
  stickDistance: 0.07,      // m: the wheels follow the ground over small drops (suspension travel)
  jumpImpulse: 3.6,         // m/s of take-off speed at full pre-load
  jumpPreload: 0.32,        // s to full pre-load
  landingHard: 7.5,         // m/s normal speed at touch-down that costs speed (not a crash yet)
  fixedStep: 1 / 120,
  bodyRadius: 0.32,         // m: the bike's radius against tree trunks
  treeBump: 0.55,           // speed kept when the bike slides along a trunk (the part into the trunk is lost)
  maxSpeed: 26,             // m/s hard cap (93 km/h): a descent never runs away
});

/* Ground materials the physics knows (dry values): rolling resistance coefficient, tyre grip (friction coefficient), roughness (extra rolling drag, scaled by how the bike
 * soaks it up). Rain (the weather choice) multiplies the grip by (1 - wet * WET_LOSS[kind]); it never touches medals or scores. */
export const SURFACES = Object.freeze({
  dirt: { crr: 0.013, grip: 1.0, rough: 0.08, wetLoss: 0.2 },
  track: { crr: 0.016, grip: 0.95, rough: 0.05, wetLoss: 0.14 },       // gravel / forest track
  road: { crr: 0.009, grip: 1.05, rough: 0.0, wetLoss: 0.3 },
  rock: { crr: 0.011, grip: 1.1, rough: 0.25, wetLoss: 0.42 },
  roots: { crr: 0.028, grip: 0.78, rough: 0.55, wetLoss: 0.4 },
  mud: { crr: 0.075, grip: 0.56, rough: 0.1, wetLoss: 0.08 },
  leaves: { crr: 0.032, grip: 0.8, rough: 0.12, wetLoss: 0.28 },
  wood: { crr: 0.01, grip: 0.95, rough: 0.12, wetLoss: 0.45 },
  grass: { crr: 0.055, grip: 0.74, rough: 0.1, wetLoss: 0.22 },
  water: { crr: 0.09, grip: 0.62, rough: 0.1, wetLoss: 0 },
  forest: { crr: 0.05, grip: 0.7, rough: 0.2, wetLoss: 0.22 },         // off the path: litter, moss, undergrowth
});
export const SURFACE_OF_CODE = Object.freeze(['dirt', 'rock', 'roots', 'mud', 'leaves', 'wood']);     // trail-features.js SURF codes
export const WAY_SURFACE = Object.freeze({ trail: 'dirt', path: 'dirt', track: 'track', road: 'road', stream: 'water', river: 'water', ditch: 'water' });

/* Pedalling, braking, pumping, jumping and crashing (see DESIGN-PLAY.md for the reasoning). */
export const PLAY = Object.freeze({
  brakeBlend: { front: 0.55, rear: 0.85 },   // a single brake input (touch, S key) is split like this between the two brakes
  weightTransfer: 0.49,                      // h / L: how much of the weight moves to the front wheel per g of braking
  flipDecel: 9.4,                            // m/s2 (braking + downhill pull) at which a front-brake-only stop goes over the bars
  rearLockLateral: 0.7,                      // lateral grip kept when the rear wheel skids
  frontWash: 0.5,                            // lateral grip lost at full front brake and full steering
  pumpHeight: 0.3,                           // m the rider's centre moves between crouch and extension
  pumpGainMax: 1.6,                          // m/s per pump at most
  popMin: 0.12,                              // pre-load below this never pops (a tap is a pump)
  popMinSpeed: 0.6,                          // m/s of take-off speed below which the bike stays on the ground
  popValleyG: 1.5,                           // no pop in a valley that presses the bike down harder than this many g
  perfectImpact: 2.5,                        // m/s normal speed at touch-down for a "perfect" landing
  goodImpact: 5.5,
  slideCrash: 8.5,                           // m/s of sideways slide on the ground that tips the bike over (low side)
  hitCrash: 5.4,                             // m/s into a trunk or a rock that is a crash
  sideLandCrash: 6.5,                        // m/s sideways at touch-down
  tumbleDecay: 2.6,                          // 1/s: speed decay while tumbling
  respawnTime: 1.4,                          // s from the crash to the rider standing at the checkpoint (< 1.5 s, never frustrating)
  pushAssist: 1.7,                           // m/s2: below walking pace the rider pushes the bike up a bank instead of stalling
  pushFade: [0.9, 2.4],                      // m/s: full assist below the first speed, none above the second
  respawnShield: 1.5,                        // s of invulnerability after a respawn
});

/* The four bikes (a generic hardtail, trail bike, enduro bike and downhill bike, no brands). Everything the physics, the rider model and the HUD need.
 *   mass kg incl. rider; powerK drive multiplier on flat (weight and gearing); travel m of suspension (fork / shock): drawn, and it eats landings and roughness;
 *   grip multiplies tyre grip; crrK multiplies rolling resistance; cdaK drag; brakeF / brakeR m/s2 at full lever; steerK / steerRef steering quickness; stab straight-line stability at speed
 *   (less lean wobble); pump / pop efficiency of pumping and jumping; crashImpact m/s normal speed at touch-down that is a crash; hardImpact: landings above this cost speed;
 *   rough: how much of the ground roughness reaches the bike (hardtail 1 .. downhill 0.35). */
export const BIKES = Object.freeze({
  hardtail: { id: 'hardtail', mass: 84.5, powerK: 1.06, travel: 0.1, grip: 0.95, crrK: 0.94, cdaK: 1.0, brakeF: 7.0, brakeR: 4.4, steerK: 1.12, steerRef: 6.2, stab: 0.85, pump: 1.2, pop: 1.1, crashImpact: 9.6, hardImpact: 5.8, rough: 1.0, stick: 0.045, color: '#2f9e6b' },
  trail: { id: 'trail', mass: 86, powerK: 1.0, travel: 0.13, grip: 1.0, crrK: 1.0, cdaK: 1.0, brakeF: 7.4, brakeR: 4.8, steerK: 1.0, steerRef: 5.5, stab: 1.0, pump: 1.0, pop: 1.0, crashImpact: 11.5, hardImpact: 7.5, rough: 0.7, stick: 0.058, color: '#d8452e' },
  enduro: { id: 'enduro', mass: 88.5, powerK: 0.94, travel: 0.17, grip: 1.06, crrK: 1.06, cdaK: 1.04, brakeF: 7.9, brakeR: 5.1, steerK: 0.94, steerRef: 5.0, stab: 1.15, pump: 0.88, pop: 0.95, crashImpact: 13.2, hardImpact: 9.0, rough: 0.5, stick: 0.07, color: '#e69a1f' },
  downhill: { id: 'downhill', mass: 92, powerK: 0.84, travel: 0.2, grip: 1.12, crrK: 1.16, cdaK: 1.1, brakeF: 8.5, brakeR: 5.5, steerK: 0.88, steerRef: 4.6, stab: 1.35, pump: 0.78, pop: 0.9, crashImpact: 15.2, hardImpact: 11.0, rough: 0.35, stick: 0.082, color: '#7b49c8' },
});
export const BIKE_IDS = Object.freeze(['hardtail', 'trail', 'enduro', 'downhill']);
export const CLEAN_GROUND = Object.freeze({ kind: 'dirt', ...SURFACES.dirt });

/* The legacy W1 table, kept for tools that read it. */
export const GROUND = Object.freeze({
  trail: { crr: 0.013, grip: 1.0 },
  track: { crr: 0.016, grip: 0.95 },
  forest: { crr: 0.05, grip: 0.7 },
  rock: { crr: 0.011, grip: 1.1 },
});
