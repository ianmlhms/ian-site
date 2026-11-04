/* The painted car of Lux Drive: a low-poly hatchback built from flat-shaded faces with vertex colours (the painted look of the
 * engine: no photographs, no photo textures, the light is the shared gouache shading).
 *
 * The local frame: +x is the front of the car, +y is up, +z is the right hand side. The car is turned with
 * rotation.y = -heading, because the heading runs from +x towards +z in the world frame (x east, z south).
 *
 * The parts (the draw calls): the body (one mesh: hull, greenhouse, bumpers, sills, plates, mirrors), four wheels (each a
 * pivot that steers with a tyre that spins), and three lamp meshes with their own unlit materials: the headlamps, the tail
 * lamps (brake lights) and the reversing lamps.  That is 10 meshes, 8 of them with geometry shared by the wheels. */
import { CAR_COLOURS } from './config.js';

const THREE = window.THREE;

const WHEEL_RADIUS = 0.36;         // bigger wheels than the old model (the Golf VII on 17-18 inch)
const WHEEL_HALF_WIDTH = 0.1;
const WHEEL_SEGMENTS = 14;
const WHEEL_X = 1.31;             // m: the axles sit this far in front of / behind the centre (wheelbase 2.56)
const WHEEL_Z = 0.78;             // m: the centre plane of a wheel (the tyre stands a little proud of the arch)
const BODY_CENTRE_Y = 0.6;        // m: the middle of the body seen from the side (faces point away from it)
const BODY_LIFT = 0;              // m: the model's ground level is the group origin
const LIFT_FROM_PHYSICS = 0.42;   // m: car.state.y is the ride height above the ground; the model stands on the ground itself
const ROLL_LIMIT = 0.3;           // rad

/** A mesh under construction: flat-shaded triangles with a colour each. */
class FaceBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; }
  get count() { return this.pos.length / 3; }

  /** A planar polygon (its points in order, counter-clockwise seen from the side the normal points to). */
  poly(points, color) {
    const [a, b, c] = points;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const base = this.count;
    for (const p of points) { this.pos.push(p[0], p[1], p[2]); this.nor.push(nx, ny, nz); this.col.push(color[0], color[1], color[2]); }
    for (let i = 1; i + 1 < points.length; i++) this.idx.push(base, base + i, base + i + 1);
    return this;
  }

  /**
   * A triangle whose normal points AWAY from the axis of the car at (cx, cy) (the car is convex enough that this is outward).
   * `side` (+1 / -1) overrides the test with "away along z" for the flat discs of the wheel arches.
   */
  outwardTri(points, color, cx, cy, side = 0) {
    const [a, b, c] = points;
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const mx = (a[0] + b[0] + c[0]) / 3 - cx, my = (a[1] + b[1] + c[1]) / 3 - cy, mz = (a[2] + b[2] + c[2]) / 3;
    const outward = side ? nz * side : ny * my + nz * mz;
    return this.poly(outward >= 0 ? [a, b, c] : [a, c, b], color);
  }

  /** A convex polygon (the end cap of the loft) facing away from the car along x. */
  outwardFan(points, color, x, cy) {
    for (let i = 1; i + 1 < points.length; i++) {
      const [a, b, c] = [points[0], points[i], points[i + 1]];
      const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
      this.poly(nx * Math.sign(x) >= 0 ? [a, b, c] : [a, c, b], color);
    }
  }

  /** An axis-aligned box: centre, half sizes, a colour. */
  box(cx, cy, cz, hx, hy, hz, color) {
    const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
    this.poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], color);     // +z
    this.poly([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], color);     // -z
    this.poly([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], color);     // +x
    this.poly([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], color);     // -x
    this.poly([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], color);     // top
    this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], color);     // bottom
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* The body is ONE loft: cross sections along the car (front to back), every section the same ring of points
 *   0 the middle of the floor  1 the lower corner (the sill)  2 the widest point (the shoulder bulge)  3 the belt line
 *   4 the edge of the roof / bonnet  5 the inner edge of the roof rail  6 the middle of the roof, then the same on the left.
 * so the bevelled corners of a modern hatchback (a chamfer under the shoulder, a tumblehome above it) come out of the
 * numbers.  Each station: x, bottom y, shoulder y, belt y, roof y, half widths at the sill, the shoulder, the belt, the roof.
 *   Golf-sized: 4.25 m x 1.80 m x 1.45 m; a short bonnet that rises to the cowl at x = 0.95, a raked windscreen up to the
 *   roof at x = -0.05, a roof that falls a little towards a near-vertical tail, and a belt line that RISES to the back. */
const STATIONS = Object.freeze([
  //  x      yb    ym    ys    yr    wb    ww    ws    wr
  [2.15, 0.38, 0.50, 0.62, 0.65, 0.60, 0.72, 0.70, 0.56],     // the nose (the front face)
  [2.04, 0.27, 0.52, 0.76, 0.80, 0.73, 0.86, 0.84, 0.70],     // the bumper corner and the lip of the bonnet
  [1.55, 0.27, 0.55, 0.87, 0.91, 0.79, 0.90, 0.88, 0.76],     // the bonnet
  [0.95, 0.27, 0.58, 0.95, 0.99, 0.80, 0.90, 0.88, 0.78],     // the cowl: the foot of the windscreen
  [-0.05, 0.27, 0.58, 0.97, 1.45, 0.80, 0.90, 0.88, 0.63],    // the front of the roof
  [-1.20, 0.27, 0.60, 1.00, 1.44, 0.80, 0.90, 0.87, 0.63],    // the middle of the roof
  [-1.76, 0.27, 0.62, 1.06, 1.40, 0.80, 0.90, 0.86, 0.64],    // the back of the roof (the spoiler lip)
  [-2.00, 0.27, 0.66, 1.07, 1.13, 0.77, 0.88, 0.82, 0.72],    // the foot of the tailgate window
  [-2.10, 0.30, 0.64, 1.02, 1.07, 0.72, 0.84, 0.76, 0.66],    // the tail
  [-2.13, 0.40, 0.58, 0.92, 0.95, 0.62, 0.74, 0.66, 0.54],    // the rear face
]);
const RAIL = 0.07;                         // m: the roof rail between the side glass and the roof, and the A pillar beside the windscreen
const FRONT_X = STATIONS[0][0], BACK_X = STATIONS[STATIONS.length - 1][0];
const COWL_X = STATIONS[3][0], ROOF_FRONT_X = STATIONS[4][0], ROOF_BACK_X = STATIONS[6][0], TAIL_WINDOW_X = STATIONS[7][0];
/* The side glass: the front door window, the B pillar between, the rear window; and the x range of the rest (pillars, body). */
const SIDE_GLASS = Object.freeze([[0.78, -0.40], [-0.70, -1.56]]);
const DOOR_LINES = Object.freeze([0.80, -0.43, -0.68, -1.58]);           // the shut lines of the doors (x)
const BUMPER_X = 1.9;                       // beyond this x (front) and -BUMPER_X (back) the lower body is dark plastic
const WINDOW_SILL = 0.045;                  // m: the glass sits this far above the belt line

const lerp = (a, b, t) => a + (b - a) * t;
const inRange = (x, [hi, lo]) => x <= hi && x >= lo;

/** The ring of points {y, z} of the body at x (linear between the stations). */
function ringAt(x) {
  let i = 0;
  while (i + 2 < STATIONS.length && x < STATIONS[i + 1][0]) i++;
  const a = STATIONS[i], b = STATIONS[i + 1];
  const t = (a[0] - x) / (a[0] - b[0]);
  const [yb, ym, ys, yr, wb, ww, ws, wr] = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => lerp(a[k], b[k], t));
  const half = [[yb, 0], [yb, wb], [ym, ww], [ys, ws], [yr, wr], [yr, Math.max(0, wr - RAIL)], [yr, 0]];
  const left = [[yr, -Math.max(0, wr - RAIL)], [yr, -wr], [ys, -ws], [ym, -ww], [yb, -wb]];
  return half.concat(left);
}
/** The z of the side of the body at (x, y): where a wheel arch or a door line has to sit. */
function sideZ(x, y) {
  const r = ringAt(x);
  for (let k = 1; k <= 3; k++) {
    const [y0, z0] = r[k], [y1, z1] = r[k + 1];
    if (y >= y0 && y <= y1) return lerp(z0, z1, (y - y0) / Math.max(1e-6, y1 - y0));
  }
  return y < r[1][0] ? r[1][1] : r[4][1];
}

/** The colour of segment k of the ring at x. */
function segmentColour(k, x, palette) {
  const { body, glass, plastic, sill } = palette;
  const mirrored = k >= 7 ? 12 - k : k;                       // 0..5 right half; the left half mirrors it (12 segments, 0..11)
  const bumper = Math.abs(x) > BUMPER_X;
  switch (mirrored) {
    case 0: return plastic;                                      // the floor
    case 1: return bumper ? plastic : sill;                      // the chamfer under the shoulder
    case 2: return bumper && x > 0 ? body : body;                // the flank
    case 3: return SIDE_GLASS.some((r) => inRange(x, r)) ? glass : body;      // the belt: side glass or pillar
    case 4: return body;                                         // the rail
    default: return (x < COWL_X && x > ROOF_FRONT_X) || (x < ROOF_BACK_X && x > TAIL_WINDOW_X) ? glass : body;   // the roof: windscreen, roof, tailgate
  }
}

/** The body: the loft, the end caps, then the small parts (doors, handles, mirrors, lamps' housings, plates, spoiler). */
function buildBody(paint) {
  const body = rgb(paint);
  const palette = { body, glass: [0.16, 0.22, 0.29], plastic: [0.12, 0.12, 0.14], sill: shade(body, 0.8) };
  const b = new FaceBuilder();
  // the breakpoints: the stations and the edges of the glass, so that every piece has one colour
  const xs = new Set(STATIONS.map((s) => s[0]));
  for (const r of SIDE_GLASS) { xs.add(r[0]); xs.add(r[1]); }
  xs.add(BUMPER_X); xs.add(-BUMPER_X);
  const cuts = [...xs].sort((p, q) => q - p);
  const rings = cuts.map((x) => ringAt(x).map(([y, z]) => [x, y, z]));
  const cy = () => BODY_CENTRE_Y;
  for (let i = 0; i + 1 < rings.length; i++) {
    const A = rings[i], B = rings[i + 1];
    const xm = (cuts[i] + cuts[i + 1]) / 2;
    const ringN = A.length;
    for (let k = 0; k < ringN; k++) {
      const k1 = (k + 1) % ringN;
      const colour = segmentColour(k, xm, palette);
      b.outwardTri([A[k], A[k1], B[k1]], colour, xm, cy(xm));
      b.outwardTri([A[k], B[k1], B[k]], colour, xm, cy(xm));
    }
  }
  // the end caps: the front face and the rear face (the lower half dark plastic = the bumper)
  for (const [x, ring] of [[FRONT_X, rings[0]], [BACK_X, rings[rings.length - 1]]]) {
    const upper = ring.slice(2, 11), lower = [ring[0], ring[1], ring[2], ring[10], ring[11]];
    b.outwardFan(upper, body, x, cy(x)); b.outwardFan(lower, palette.plastic, x, cy(x));
  }
  const dark = shade(body, 0.55);
  const trim = [0.1, 0.1, 0.12];
  // the shut lines of the doors: thin dark strips that follow the side of the body
  for (const side of [1, -1]) {
    for (const x of DOOR_LINES) {
      const y0 = 0.46, y1 = Math.max(ringAt(x)[3][0], 0.95);
      b.poly([[x, y0, side * (sideZ(x, y0) + 0.004)], [x - 0.012, y0, side * (sideZ(x, y0) + 0.004)], [x - 0.012, y1, side * (sideZ(x, y1) + 0.004)], [x, y1, side * (sideZ(x, y1) + 0.004)]], dark);
    }
    // the door handles
    b.box(0.0, 0.88, side * (sideZ(0.0, 0.88) + 0.012), 0.11, 0.015, 0.012, dark);
    b.box(-1.0, 0.9, side * (sideZ(-1.0, 0.9) + 0.012), 0.11, 0.015, 0.012, dark);
    // the mirror: a short stalk and a housing at the foot of the A pillar
    b.box(0.74, 1.02, side * 0.93, 0.05, 0.03, 0.05, dark);
    b.box(0.72, 1.07, side * 1.02, 0.07, 0.055, 0.045, body);
    // the sill trim
    b.box(0.0, 0.31, side * (sideZ(0.0, 0.34) + 0.01), 1.05, 0.03, 0.012, trim);
  }
  // the grille and the air intake under the bumper
  b.box(2.158, 0.58, 0, 0.012, 0.05, 0.34, trim);
  b.box(2.155, 0.4, 0, 0.012, 0.045, 0.3, trim);
  // the number plates (white; the blue strip of the EU on the left)
  b.box(2.17, 0.47, 0, 0.012, 0.06, 0.2, [0.93, 0.93, 0.9]);
  b.box(2.176, 0.47, -0.16, 0.006, 0.06, 0.025, [0.2, 0.3, 0.7]);
  b.box(-2.15, 0.72, 0, 0.012, 0.07, 0.2, [0.93, 0.93, 0.9]);
  b.box(-2.156, 0.72, -0.16, 0.006, 0.07, 0.025, [0.2, 0.3, 0.7]);
  // the roof spoiler: a lip over the tailgate window
  b.box(-1.8, 1.405, 0, 0.055, 0.016, 0.5, body);
  // the exhaust
  b.box(-2.15, 0.36, 0.45, 0.04, 0.03, 0.035, [0.78, 0.79, 0.82]);
  // the wheel arches: the dark upper half circle on the side of the body round each wheel, following the body side
  for (const x of [WHEEL_X, -WHEEL_X]) {
    for (const side of [1, -1]) {
      const ring = [];
      for (let k = 0; k <= WHEEL_SEGMENTS; k++) {
        const a = Math.PI * k / WHEEL_SEGMENTS;
        const px = x + Math.cos(a) * (WHEEL_RADIUS + 0.05), py = WHEEL_RADIUS + Math.sin(a) * (WHEEL_RADIUS + 0.05);
        ring.push([px, py, side * (sideZ(px, py) + 0.006)]);
      }
      for (let k = 1; k + 1 < ring.length; k++) b.outwardTri([ring[0], ring[k], ring[k + 1]], shade(body, 0.22), x, WHEEL_RADIUS, side);
    }
  }
  return b.build();
}

/** A wheel: the tyre, the sidewall and the rim, with the axle along z. Both faces are built (the wheel is shared by both sides of the car). */
function buildWheel() {
  const tyre = [0.09, 0.09, 0.1], wall = [0.14, 0.14, 0.15], rim = [0.26, 0.27, 0.3], hub = [0.62, 0.63, 0.66];   // dark alloys, a light hub cap
  const b = new FaceBuilder();
  const R = WHEEL_RADIUS, W = WHEEL_HALF_WIDTH, Rr = R * 0.74, Rh = R * 0.22;
  const at = (k, r, z) => [Math.cos(2 * Math.PI * k / WHEEL_SEGMENTS) * r, Math.sin(2 * Math.PI * k / WHEEL_SEGMENTS) * r, z];
  for (let k = 0; k < WHEEL_SEGMENTS; k++) {
    const k1 = k + 1;
    b.poly([at(k, R, -W), at(k1, R, -W), at(k1, R, W), at(k, R, W)], tyre);                    // the tread
    for (const [z, up] of [[W, 1], [-W, -1]]) {
      const ring = (r) => [at(k, r, z), at(k1, r, z)];
      const [o0, o1] = ring(R), [r0, r1] = ring(Rr), [h0, h1] = ring(Rh);
      const order = (pts) => (up > 0 ? pts : pts.slice().reverse());
      b.poly(order([o0, o1, r1, r0]), wall);                                                    // the sidewall
      b.poly(order([r0, r1, h1, h0]), rim);                                                     // the rim
      b.poly(order([h0, h1, [0, 0, z]]), hub);                                                  // the hub cap
    }
  }
  return b.build();
}

/** The lamps: boxes of one colour in one mesh with an unlit material. */
function buildLamps(boxes) {
  const b = new FaceBuilder();
  for (const [cx, cy, cz, hx, hy, hz] of boxes) b.box(cx, cy, cz, hx, hy, hz, [1, 1, 1]);
  return b.build();
}

const LAMP_HEAD = [[2.095, 0.715, 0.56, 0.045, 0.05, 0.19], [2.095, 0.715, -0.56, 0.045, 0.05, 0.19]];
const LAMP_TAIL = [[-2.115, 0.93, 0.6, 0.03, 0.065, 0.13], [-2.115, 0.93, -0.6, 0.03, 0.065, 0.13]];
const LAMP_REVERSE = [[-2.14, 0.6, 0.5, 0.02, 0.03, 0.07], [-2.14, 0.6, -0.5, 0.02, 0.03, 0.07]];
const HEAD_OFF = [0.76, 0.76, 0.7], HEAD_ON = [1, 0.97, 0.78];
const TAIL_OFF = [0.42, 0.07, 0.06], TAIL_NIGHT = [0.78, 0.09, 0.07], TAIL_BRAKE = [1, 0.16, 0.12];
const REVERSE_OFF = [0.62, 0.62, 0.6], REVERSE_ON = [1, 1, 0.92];

const lampMaterial = () => new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false });
const setColor = (material, c) => material.color.setRGB(c[0], c[1], c[2]);

/**
 * The car model. `colourId` is a key of CAR_COLOURS.
 * Returns { group, body, wheels, setColour, apply, headlight }.
 */
export function createCarModel({ colourId = 'red', material }) {
  const group = new THREE.Group();
  group.name = 'car';
  const body = new THREE.Mesh(buildBody(CAR_COLOURS[colourId] || CAR_COLOURS.red), material);
  body.name = 'car-body';
  // the body tilts as a whole (the attitude of the physics); the wheels stay on the ground
  const tilt = new THREE.Group();
  tilt.add(body);
  group.add(tilt);

  const headMat = lampMaterial(), tailMat = lampMaterial(), reverseMat = lampMaterial();
  for (const [name, boxes, mat] of [['car-headlamps', LAMP_HEAD, headMat], ['car-taillamps', LAMP_TAIL, tailMat], ['car-reverselamps', LAMP_REVERSE, reverseMat]]) {
    const mesh = new THREE.Mesh(buildLamps(boxes), mat);
    mesh.name = name;
    tilt.add(mesh);
  }

  const wheelGeometry = buildWheel();
  const wheels = [];                                    // { pivot, tyre, front }
  for (const [x, z] of [[WHEEL_X, WHEEL_Z], [WHEEL_X, -WHEEL_Z], [-WHEEL_X, WHEEL_Z], [-WHEEL_X, -WHEEL_Z]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_RADIUS, z);
    const tyre = new THREE.Mesh(wheelGeometry, material);
    tyre.name = 'car-wheel';
    pivot.add(tyre);
    group.add(pivot);
    wheels.push({ pivot, tyre, front: x > 0 });
  }
  let spin = 0;
  let smoothHead = 0;
  setColor(headMat, HEAD_OFF); setColor(tailMat, TAIL_OFF); setColor(reverseMat, REVERSE_OFF);

  return {
    group, body, wheels,
    wheelbase: 2 * WHEEL_X,
    wheelRadius: WHEEL_RADIUS,
    /** Paints the car in another colour (the body geometry is rebuilt; the old one is released). */
    setColour(id) {
      if (!CAR_COLOURS[id]) throw new Error(`car-model: unknown colour "${id}"`);
      body.geometry.dispose();
      body.geometry = buildBody(CAR_COLOURS[id]);
    },
    /**
     * Puts the car on the ground and animates it: the wheels roll and the front ones steer, the body pitches and rolls,
     * the lamps follow the lights.  `lights` = { head: 0..1 (the headlamps), night: 0..1 } from the environment.
     */
    apply(state, dt, lights = { head: 0, night: 0 }) {
      group.position.set(state.x, state.y - LIFT_FROM_PHYSICS + BODY_LIFT, state.z);
      // the whole car lies on the slope: the yaw first, then the pitch (rotation.z lifts the nose), then the roll (rotation.x
      // leans the right side down); the body moves on top of that on its suspension
      group.rotation.order = 'YZX';
      group.rotation.set(Math.max(-ROLL_LIMIT, Math.min(ROLL_LIMIT, state.roll)), -state.heading, state.pitch);
      tilt.rotation.set(state.lean, 0, state.squat);
      // a wheel rolling forward (+x) turns by -v/R about its axle (+z)
      spin -= (state.speed * dt) / WHEEL_RADIUS;
      if (spin < -1e4 || spin > 1e4) spin %= 2 * Math.PI;
      for (const w of wheels) {
        w.pivot.rotation.set(0, w.front ? -state.steer : 0, 0);
        w.tyre.rotation.set(0, 0, spin);
      }
      // the lamps: the headlamps follow the headlights, the tail lamps glow at night and flare when braking
      smoothHead += (lights.head - smoothHead) * Math.min(1, dt * 8);
      setColor(headMat, mix3(HEAD_OFF, HEAD_ON, smoothHead));
      setColor(tailMat, state.braking ? TAIL_BRAKE : mix3(TAIL_OFF, TAIL_NIGHT, smoothHead));
      setColor(reverseMat, state.reversing ? REVERSE_ON : REVERSE_OFF);
    },
    /** The headlight: the world position and the direction of the beam (for the lamp of the light shader). */
    headlight(state, outPos, outDir) {
      const cy = Math.cos(state.heading), sy = Math.sin(state.heading);
      outPos.set(state.x + cy * 2.0, state.y + 0.35, state.z + sy * 2.0);
      outDir.set(cy, -0.12, sy);
    },
  };
}
