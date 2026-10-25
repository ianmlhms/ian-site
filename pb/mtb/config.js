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
  medium: { pixelRatio: 1.25, lodScale: 0.7, treeRadius: 135, treeDensity: 0.7, nearTree: 36, midTree: 72, groundCover: 56, fernRadius: 44, shrubRadius: 56, rockRadius: 140, rockNear: 42, tuftRadius: 16, lifeDetail: 0.7, shadows: false, far: 7000, cheapGround: false },
  high: { pixelRatio: 2, lodScale: 1, treeRadius: 220, treeDensity: 1, nearTree: 46, midTree: 100, groundCover: 90, fernRadius: 70, shrubRadius: 90, rockRadius: 190, rockNear: 54, tuftRadius: 24, lifeDetail: 1, shadows: true, far: 9000, cheapGround: false },
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
  clearanceProbe: 6,        // ground probes along the camera boom
  bodyRadius: 0.55,         // the camera is a ball of this radius: it never sits inside a trunk, a crown or a rock
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
  bodyRadius: 0.32,         // m: the bike's radius against tree trunks
  treeBump: 0.55,           // speed kept when the bike slides along a trunk (the part into the trunk is lost)
  maxSpeed: 26,             // m/s hard cap (93 km/h): a descent never runs away
});

/* Ground materials the physics knows: rolling resistance, grip (friction coefficient), extra drag. Weather multiplies the grip later (never the rewards). */
export const GROUND = Object.freeze({
  trail: { crr: 0.013, grip: 1.0 },
  track: { crr: 0.016, grip: 0.95 },
  forest: { crr: 0.05, grip: 0.7 },
  rock: { crr: 0.011, grip: 1.1 },
});
