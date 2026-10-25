/* MTB Mëllerdall: every tunable number in one place (named constants, no magic numbers elsewhere).
 * Frame: x = east, y = up, z = south, metres, origin = the NORTH-WEST corner of the world box (scripts/mtb/common.py maps it onto LUREF). */

export const WORLD = Object.freeze({
  width: 6144,              // m (x), 12 blocks of 512
  depth: 4608,              // m (z), 9 blocks of 512
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
  splitFactor: 1.25,        // LOD 0 tiles (32 m, 1 m spacing) are used within 1.25 * 64 = 80 m of the rider (physics == render there)
  splitHysteresis: 0.08,
  skirtDepth: 2.5,          // m the skirt hangs below its edge (belt and braces behind the exact stitching)
  skirtPerStep: 0.6,        // + this many m per m of node spacing
  carveFullStep: 1,         // way carving is applied in full up to this node spacing ...
  carveFadeStep: 2,         // ... fades out until here and is off beyond (a 1 m wide path cannot be sampled by a 4 m lattice)
  maxBuiltPerFrame: 3,      // tile meshes (re)built per frame at most (iPad)
  keepSeconds: 4,           // cached tile data lives this long after its last use
});

/* Trail carving: one profile per kind of way. halfWidth = flat bed, width = where the ground is untouched again (m). */
export const WAY_KINDS = Object.freeze({
  trail: { halfWidth: 0.55, width: 2.6, berm: true, spacing: 1 },       // the ridden MTB trails (berms, banking)
  path: { halfWidth: 0.4, width: 1.7, berm: false, spacing: 1.5 },
  track: { halfWidth: 1.5, width: 3.8, berm: false, spacing: 2 },
  road: { halfWidth: 2.8, width: 5.6, berm: false, spacing: 2 },
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
  low: { pixelRatio: 1, lodScale: 0.6, treeRadius: 90, treeDensity: 0.45, shadows: false, far: 5200 },
  medium: { pixelRatio: 1.25, lodScale: 0.8, treeRadius: 150, treeDensity: 0.7, shadows: false, far: 7000 },
  high: { pixelRatio: 2, lodScale: 1, treeRadius: 220, treeDensity: 1, shadows: true, far: 9000 },
});

export const CAMERA = Object.freeze({
  fov: 62,
  near: 0.1,
  followDistance: 3.6,
  followHeight: 1.65,
  lookAhead: 1.2,
  minClearance: 0.55,       // the camera never gets closer than this to the ground (m)
  clearanceProbe: 6,        // ground probes along the camera boom
});

/* Bike physics (SI units). One rider + bike point mass on the physics surface; see DESIGN.md section 6. */
export const BIKE = Object.freeze({
  mass: 86,                 // rider + bike (kg)
  gravity: 9.81,
  wheelbase: 1.12,
  power: 210,               // W of a fit rider at full throttle
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
  maxSpeed: 26,             // m/s hard cap (93 km/h): a descent never runs away
});

/* Ground materials the physics knows: rolling resistance, grip (friction coefficient), extra drag. Weather multiplies the grip later (never the rewards). */
export const GROUND = Object.freeze({
  trail: { crr: 0.013, grip: 1.0 },
  track: { crr: 0.016, grip: 0.95 },
  forest: { crr: 0.05, grip: 0.7 },
  rock: { crr: 0.011, grip: 1.1 },
});
