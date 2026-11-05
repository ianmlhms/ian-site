/* Lux Drive: every tunable number in one place (named constants, no magic numbers elsewhere).
 * Frame: x = east, y = up, z = south, metres, origin = the NORTH-WEST corner of the world box
 * (scripts/luxdrive/common.py maps the OSM admin boundaries of Luxembourg and Niederanven onto that box). */

export const WORLD = Object.freeze({
  width: 16896,            // m (x): the two communes plus a 300 m buffer
  depth: 14848,            // m (z)
  block: 512,
  featherDist: 192,         // m: the 4 m LiDAR grid fades into the 32 m distant-hills grid over this distance from its edge
  farMargin: 8192,          // m: the distant-hills grid reaches this far beyond the box
  nearStep: 4,              // m between nodes of terrain.bin
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
  rootSize: 65536,
  rootX: -16384,           // multiple of rootSize / 8; the box (0..16896, 0..14848) and its 8 km margin lie inside
  rootZ: -16384,
  splitFactor: 1.0,         // a 64 m node splits when the rider is within 64 m: LOD 0 tiles (32 m, 1 m spacing) cover every tile within 64 m
  splitHysteresis: 0.08,
  protectedSize: 128,       // nodes up to this size always use the full split factor; a quality setting only coarsens the bigger, farther nodes
  skirtDepth: 2.5,          // m the skirt hangs below its edge (belt and braces behind the exact stitching)
  skirtPerStep: 0.6,        // + this many m per m of node spacing
  kerbFullStep: 1,          // the kerb is exact up to this node spacing ...
  kerbFadeStep: 4,          // ... and gone at this one (a kerb cannot be sampled by a 4 m lattice)
  maxBuiltPerFrame: 3,      // tile meshes (re)built per frame at most (iPad)
  keepSeconds: 4,           // cached tile data lives this long after its last use
});

/* The roads: the OSM network is carved INTO the terrain - there is no ribbon floating over the ground.
 * A road sample carries the height of its bed, the half width of the carriageway, the width of the kerb and of the pavement,
 * and the offset of the right-hand lane (Luxembourg drives on the right). */
export const ROAD = Object.freeze({
  sampleSpacing: 4,        // m between the samples of a centre line
  lineSmoothing: 3.0,      // m, sigma of the Gaussian that rounds the corners of the OSM polyline
  bedStiffness: 200,       // the penalty on the second difference of the road profile (road-bed.js): a 4 m sample spacing and 200 pass
                            // wavelengths above about 90 m and take out everything wavier (the first version, a 6 m Gaussian, left waves
                            // of 10 .. 30 m: the road that "lies on a blanket")
  // The vertical curves of a street: a crest or a sag is never tighter than R = v2 / bedLift, so the car is lifted by at most bedLift (m/s2) at the design speed of
  // the class.  The profile is cut through a crest and filled in a sag (bedMaxCut / bedMaxFill) rather than followed over it: the land of a hill town has crests
  // of 20 .. 60 m that no street follows.
  bedLift: 1.0,            // m/s2: the harness gate allows 1.5; the surface the car drives (a cubic through the bed, then the 1 m lattice) adds 0.2 .. 0.4 to the design value
  bedSpeed: Object.freeze({    // km/h, the design speed of a class (every other way: bedSpeedDefault)
    motorway: 100, trunk: 90, primary: 80, secondary: 70, tertiary: 60,
  }),
  bedSpeedDefault: 50,
  bedMaxCut: 2.5,          // m: the bed may lie this far BELOW the land (a cutting; the face of it follows the hillside, see road-network.js)
  bedMaxFill: 2.0,         // m: ... and this far ABOVE it (an embankment in a sag)
  bedHardCut: 5.0,         // m: the curvature limit may carry the bed this far BELOW the land where the two demands cannot both be met (a rock wall beside the road; a deeper trench would eat the houses beside it)
  bedHardFill: 9.0,        // m: ... and this far ABOVE it (a street on a bank above a valley: the fill is held by a retaining wall, retaining-walls.js)
  bedRounds: 8,            // rounds of "limit the curvature, then keep the cut and the fill within their limits"
  kerbHeight: 0.13,        // m, the kerb at the edge of the carriageway
  kerbWidth: 0.35,         // m, the width of the kerb face
  falloff: 2.2,            // m, how far the road PAINTS past its pavement before the ground is untouched again
  embankment: 18.0,        // m, how far the BATTER reaches past the pavement before the real terrain takes over.
                            // The face of the batter is a straight ramp from the level of the road back to the
                            // terrain, so the longer it is the flatter the ground beside the road is
  fillSlope: 0.25,        // m per m: a fill on a steep hillside or a cliff sinks back into the land at this rate (the ground is then steeper than the land by this much at most)
  maxBatterSlope: 0.6,    // m up per m out (31 degrees, 1:1.67: flatter than the reviewer's 1:1.5 embankment, so a house beside an embankment keeps its eaves above the ground): the ground the carve
                            // makes beside a road must never be steeper than this.  Where the land itself is
                            // steeper, the land is used as it is (a cliff beside a road stays a cliff)
  paintFullStep: 4,        // the road paint is exact up to this node spacing ...
  paintFadeStep: 16,       // ... and gone at this one (a 16 m lattice cannot resolve a 6 m street)
  markFullStep: 1,         // the kerb and the lane markings are exact on the 1 m lattice ...
  markFadeStep: 4,         // ... and gone at this one (a 4 m lattice cannot resolve a 15 cm line)
  maxRadius: 22,           // m: no kernel reaches farther than this (the spatial hash looks one cell around)
  cell: 22,                // m, the spatial hash cell; the biggest kernel radius fits inside it
  junctionClear: 2.0,      // m: a sample this close to another road's centre line gets no kerb (junctions are flat)
});

/* The ground itself: the 1 m lattice the physics and the LOD 0 tiles share. */
export const GROUND = Object.freeze({
  lattice: 1,               // m between the nodes
  microAmplitude: 0.035,    // m of small undulation on top of the LiDAR (the road bed is carved over it)
});

/* The ground materials the physics knows (dry values): rolling resistance, tyre grip and roughness.
 * Rain (the weather choice) multiplies the grip by (1 - wet * wetLoss). */
export const SURFACES = Object.freeze({
  asphalt: { crr: 0.013, grip: 1.0, rough: 0.0, wetLoss: 0.3 },
  cobble: { crr: 0.02, grip: 0.92, rough: 0.12, wetLoss: 0.32 },
  concrete: { crr: 0.015, grip: 0.96, rough: 0.03, wetLoss: 0.28 },
  stone: { crr: 0.014, grip: 0.97, rough: 0.02, wetLoss: 0.29 },
  gravel: { crr: 0.022, grip: 0.82, rough: 0.14, wetLoss: 0.2 },
  grass: { crr: 0.055, grip: 0.68, rough: 0.16, wetLoss: 0.24 },
  dirt: { crr: 0.045, grip: 0.72, rough: 0.14, wetLoss: 0.18 },
  forest: { crr: 0.05, grip: 0.66, rough: 0.2, wetLoss: 0.22 },
  sand: { crr: 0.07, grip: 0.6, rough: 0.1, wetLoss: 0.1 },
  water: { crr: 0.09, grip: 0.5, rough: 0.1, wetLoss: 0 },
});

/* lodScale / protectedSize (quadtree.js): a node up to protectedSize splits at its full distance, so the 1 m lattice reaches 59 m and the 2 m lattice 118 m
 * around the car at EVERY quality: a street in front of the car is never a faceted ribbon (the first low quality, 0.2 / 64, gave a 4 m lattice from 26 m
 * on).  The quality only coarsens the bigger, farther nodes. */
export const QUALITY = Object.freeze({
  low: { pixelRatio: 1, lodScale: 0.4, protectedSize: 128, railRadius: 300, far: 4200, buildingRadius: 300, buildingFarRadius: 760, treeRadius: 90, treeDensity: 0.4, cheapGround: true, shadows: false },
  medium: { pixelRatio: 1.25, lodScale: 0.7, protectedSize: 128, railRadius: 500, far: 6000, buildingRadius: 420, buildingFarRadius: 1300, treeRadius: 150, treeDensity: 0.7, cheapGround: false, shadows: false },
  high: { pixelRatio: 2, lodScale: 1, protectedSize: 128, railRadius: 700, far: 8000, buildingRadius: 700, buildingFarRadius: 2100, treeRadius: 240, treeDensity: 1, cheapGround: false, shadows: true },
});

export const CAMERA = Object.freeze({
  fov: 62,
  near: 0.1,
  followDistance: 7.2,       // m behind the car
  followHeight: 3.1,
  sideOffset: 0,             // the car sits in the middle of the picture
  lookAhead: 8.0,            // m the camera looks this far ahead along the heading
  lookHeight: 1.2,           // ... at this height above the car's ground
  minClearance: 0.6,         // m: the camera never gets closer than this to the ground
  farDistance: 11.5,         // the far chase camera
  farHeight: 4.6,
  bonnetForward: 1.35, bonnetHeight: 1.15, bonnetFov: 74,
  shake: 0.05,               // m of camera shake at full speed
  shakeFrom: 12,             // m/s: the shake starts here (95 km/h)
  shakeSpan: 22,
  fovGain: 16,               // degrees the field of view widens at speed ...
  fovFrom: 8,                // ... starting at 8 m/s and full at fovTo (30 m/s = 108 km/h)
  fovTo: 30,
  clearanceProbe: 6,         // ground probes along the camera boom
  occlusionProbe: 12,        // probes along the boom for houses, trees, tunnel portals and bridge decks
  minBoom: 3.2,              // m: the camera never comes closer to the car than this (then it is pushed out of the obstacle instead)
  boomRelax: 2.2,            // 1/s: how quickly the boom grows back after an obstacle has pulled it in (it shortens at once)
  deckClearance: 0.35,       // m: the lens stays this far under the deck of a bridge the car drives under
  bodyRadius: 0.6,           // the camera is a ball of this radius: it never sits inside a building
  turnLag: 3.2,              // 1/s: how quickly the camera swings round after a turn
  heightLag: 5,              // 1/s: how quickly the camera follows the height of the car
});

/* Car physics (SI units). One car body on the physics surface; arcade, but it never drives through a building
 * and never leaves the play area. */
export const CAR = Object.freeze({
  mass: 1350,                // kg
  wheelbase: 2.62,
  trackWidth: 1.72,
  power: 140000,             // W at the wheels at full throttle (about 190 hp): quick enough to reach the top speed on a straight
  reversePower: 42000,       // W in reverse
  maxSpeed: 69,              // m/s (250 km/h) - the top speed on every road (no speed limits in the game)
  offRoadShare: 0.5,         // off the roads (grass, fields) the car tops out at this share of the top speed (125 km/h)
  maxReverse: 12,            // m/s
  brakeDecel: 10.5,          // m/s2 at full braking on asphalt
  engineBrake: 1.6,          // m/s2 when the throttle is closed
  steerMax: 0.56,            // rad of the road wheel angle at standstill
  steerSpeedRef: 13,         // m/s: the steering authority falls off with the speed
  slideScrub: 0.7,           // 1/s: how fast a sliding car loses speed (at full slip)
  launchCap: 6.5,            // m/s2: the most the drive pushes at low speed (no rocket launch)
  steerRate: 7,              // 1/s: how fast the wheel follows the input
  steerGripShare: 0.95,      // the share of the tyre grip that full lock may ask for in a corner (the rest is the margin before a slide)
  steerMin: 0.035,           // rad: the wheel always keeps this much authority, even at 200 km/h
  squatGain: 0.006,          // rad of body pitch per m/s2 of acceleration (negative acceleration = the nose dives)
  squatMax: 0.05,            // rad
  leanMax: 0.12,             // rad: the most the body leans in a corner
  leanGain: 0.02,            // rad of body roll per (rad of steer x m/s)
  handbrakeYaw: 1.5,         // the yaw gain with the handbrake pulled: the tail steps out
  grip: 1.45,                // the friction coefficient of the tyres (mu)
  cdA: 0.68,                 // m2, the drag that ends the speed
  airDensity: 1.2,
  crr: 0.014,                // the rolling resistance of the tyres
  bodyRadius: 1.0,           // m: the radius of the two collision circles of the car (the half width is 0.9 m)
  bodyCircles: [1.25, -1.25], // m: the circles sit this far in front of / behind the centre (4.4 m long body: nose and tail)
  fixedStep: 1 / 120,        // s: the physics step
  slopeAssist: 1.0,          // the gravity along the slope is applied in full
  handbrakeGrip: 0.42,       // the grip left on the rear axle with the handbrake pulled
  handbrakeDrag: 5.5,        // m/s2 of extra braking with the handbrake
  bumpiness: 0.55,           // how much of the ground roughness reaches the car
  rideHeight: 0.42,          // m: the bottom of the body above the ground
  track: 1.55,               // m between the left and the right wheels (the body rests on the mean of the four contact points: car.js)
  crestSink: 0.05,           // m: the body rests at most this far below the ground under its middle (a crest between the wheels)
  wheelReach: 0.3,           // m: a wheel reads the ground at most this far above or below the ground under the centre (a wheel over the edge of a deck or a wall does not drop the body)
  restitution: 0.12,         // the vertical bounce of the suspension
  respawnTime: 1.2,          // s from a crash to the car standing again
  pushAssist: 2.2,           // m/s2: below walking pace the car creeps forward instead of stalling
  hitSpeedLoss: 0.45,        // the share of the speed kept after a glancing hit on a building
  crashSpeed: 9.0,           // m/s into a building that is a crash
});

/* The tunnel portals: a tunnel cannot be a trench in a single valued height field, so the tunnels are kept out of the carve
 * and out of the drivable network, and each of them gets a portal: a concrete headwall across the road with the dark
 * mouth of the tunnel in it. The car stops at the wall. */
export const PORTAL = Object.freeze({
  joinTolerance: 4.0,       // m: two tunnel ways whose ends are this close belong to the same tunnel
  mouthGap: 2.0,            // m: the end of the drawn road that leads to a mouth is this close to it (else the wall would stand in the open, QA B09)
  approachAlign: 0.7,       // cos: that road leaves the mouth along the axis of the tunnel (within 45 deg), not beside it
  cell: 32,                 // m, the spatial hash cell of the walls
  shoulder: 1.3,            // m, the wall reaches this far past the carriageway on each side
  boreInset: 0.25,          // m, the mouth of the tunnel is this much narrower than the carriageway
  boreMin: 2.1,             // m, a mouth narrower than this is a garage, not a tunnel
  recess: 0.85,             // m, how deep the dark mouth of the tunnel goes into the wall
  lintel: 1.0,              // m, the concrete above the mouth
  cornice: 0.22,            // m, the slab on top of the wall
  base: 2.0,                // m, the wall goes this far under the ground (it never floats)
});

/* The shallow tunnels (tunnel-cover.js): an OSM tunnel with hardly any land over it is drawn and driven as an open road in a
 * cut, without portals (the A1 under the Senningerberg interchange: 2-4 m of DTM over 88 m, QA B10).  The cover is the DTM
 * over the line between the ground at the mouths. */
export const TUNNEL_OPEN = Object.freeze({
  cover: 4.0,               // m: a run with less land than this over most of it is opened (a bore needs ~5 m of clearance alone)
  coverShare: 0.8,          // the share of the run that has to be that shallow
  cutMax: 6.0,              // m: never opened where the land over it reaches this (no canyon is dug)
  sample: 2.0,              // m: the step of the measure along the ways
  lanesNear: 30.0,          // m: a car park lane with another tunnel this close is part of an underground network and stays a tunnel
  gradeMax: 0.10,           // the floor of the cut (mouth to mouth) is not steeper than this: a car park ramp stays a tunnel
  deckEndNear: 8.0,         // m: an end of a run this close to the end of a deck: the deck lands there (road-network BRIDGE_JOIN)
  stackedShare: 0.5,        // a run that much under a deck that lands at its mouth is stacked under it and stays a tunnel
});

/* The Luxtram (CAF Urbos 100, 45 m, 2.65 m wide): the rails are the OSM tram ways of the bake (lines.bin, kind 2), the vehicles
 * run on them in a simulation of their own (tram-sim.js).  Rails and vehicles are drawn by tram-view.js. */
export const TRAM = Object.freeze({
  gauge: 1.435,             // m between the inner faces of the rails
  railWidth: 0.07, railHeight: 0.11, lift: 0.045,     // m: the head of the rail, and how far the track stands over the ground it is laid in
  bedWidth: 2.9,            // m: the slab / grass bed the two rails lie in
  chunk: 600,               // m of track per mesh (the frustum culls the rest)
  sampleSpacing: 2.0,       // m between the cross sections of the track mesh
  maxSpeed: 17.0,           // m/s (61 km/h): the line speed in the city
  accel: 1.1, decel: 1.0,   // m/s2
  dwell: 11,                // s at a stop
  turnback: 16,             // s the tram is out of sight at a terminus (it changes tracks there)
  stopSnap: 2.0,            // m: a tram stop is a node ON the rails of its track (the other track's stop node is 3-4 m away)
  stopMerge: 45,            // m: two platform nodes of one stop closer than this along the track are one stop
  sections: 5, sectionLength: 8.6, gap: 0.5,          // the 45 m vehicle: five articulated sections
  width: 2.65, height: 3.55, floor: 0.45,
  vehicles: 3,
  bodyHalfWidth: 1.35,      // m: the collision capsule of a section
  poleRadius: 0.22,         // m: the collision circle of a catenary pole
  catenary: { spacing: 38, height: 5.6, arm: 1.9 },   // m between the poles, the height of the contact wire, the reach of the arm
  platform: { length: 46, width: 3.0, height: 0.28, setback: 0.35 },
});

export const CAR_COLOURS = Object.freeze({
  red: '#c0392b', blue: '#2d6ca2', white: '#e8e8e4', black: '#2b2b2e', green: '#3d7a4a', yellow: '#d9a327', grey: '#7d8288', orange: '#d4691f',
});
export const CAR_COLOUR_IDS = Object.freeze(Object.keys(CAR_COLOURS));
