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

const WHEEL_RADIUS = 0.31;
const WHEEL_HALF_WIDTH = 0.105;
const WHEEL_SEGMENTS = 12;
const WHEEL_X = 1.28;             // m: the axles sit this far in front of / behind the centre (wheelbase 2.56)
const WHEEL_Z = 0.80;             // m: the centre plane of a wheel (the tyre stands a little proud of the arch)
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

/* The hull: cross sections along the car, front to back. Each: x, bottom y, top y, half width at the bottom, half width at the top.
 * The nose and the tail are rounded by sections that pull in, so the silhouette from above is a rounded rectangle, not a brick. */
const HULL = Object.freeze([
  [2.05, 0.42, 0.70, 0.66, 0.62],
  [1.96, 0.34, 0.80, 0.80, 0.76],
  [1.30, 0.34, 0.92, 0.87, 0.82],
  [0.75, 0.34, 0.95, 0.87, 0.82],
  [-1.30, 0.34, 0.95, 0.87, 0.82],
  [-1.94, 0.34, 1.00, 0.84, 0.78],
  [-2.05, 0.44, 0.92, 0.72, 0.68],
]);

/* The greenhouse: sections of the cabin above the belt line (y 0.95). x, top y, half width at the belt, half width at the roof. */
const BELT_Y = 0.95;
const CABIN = Object.freeze([
  [0.85, 0.97, 0.80, 0.78],      // the foot of the windscreen
  [0.10, 1.46, 0.80, 0.62],      // the top of the windscreen
  [-1.30, 1.46, 0.80, 0.62],     // the back of the roof
  [-1.92, 1.02, 0.80, 0.70],     // the foot of the tailgate window
]);
const B_PILLAR = Object.freeze([-0.62, -0.42]);       // x range of the B pillar
const C_PILLAR_X = -1.52;                              // the C pillar runs from here to the tail

/** The hull as faces: the sides, the top and the bottom between the sections, the end caps. */
function addHull(b, body, dark) {
  for (let i = 0; i + 1 < HULL.length; i++) {
    const [xa, ya0, ya1, wa0, wa1] = HULL[i], [xb, yb0, yb1, wb0, wb1] = HULL[i + 1];
    // right side (+z), left side (-z), top, bottom
    b.poly([[xa, ya0, wa0], [xb, yb0, wb0], [xb, yb1, wb1], [xa, ya1, wa1]], body);
    b.poly([[xb, yb0, -wb0], [xa, ya0, -wa0], [xa, ya1, -wa1], [xb, yb1, -wb1]], body);
    b.poly([[xa, ya1, wa1], [xb, yb1, wb1], [xb, yb1, -wb1], [xa, ya1, -wa1]], body);
    b.poly([[xa, ya0, -wa0], [xb, yb0, -wb0], [xb, yb0, wb0], [xa, ya0, wa0]], dark);
  }
  const front = HULL[0], back = HULL[HULL.length - 1];
  b.poly([[front[0], front[2], front[4]], [front[0], front[1], front[3]], [front[0], front[1], -front[3]], [front[0], front[2], -front[4]]], body);
  b.poly([[back[0], back[1], -back[3]], [back[0], back[1], back[3]], [back[0], back[2], back[4]], [back[0], back[2], -back[4]]], body);
}

/** The value of a cabin quantity at x (the cabin is linear between its sections). */
function cabinAt(x) {
  for (let i = 0; i + 1 < CABIN.length; i++) {
    const a = CABIN[i], b = CABIN[i + 1];
    if (x <= a[0] && x >= b[0]) {
      const t = (a[0] - x) / (a[0] - b[0]);
      return { top: a[1] + (b[1] - a[1]) * t, hwB: a[2] + (b[2] - a[2]) * t, hwT: a[3] + (b[3] - a[3]) * t };
    }
  }
  throw new Error(`car-model: x=${x} is outside the cabin`);
}

/** The greenhouse: glass all round, a body-coloured roof, the pillars in the colour of the body. */
function addCabin(b, body, glass) {
  // the windscreen, the roof, the tailgate window
  const [a, bb, c, d] = CABIN;
  b.poly([[a[0], a[1], a[3]], [bb[0], bb[1], bb[3]], [bb[0], bb[1], -bb[3]], [a[0], a[1], -a[3]]], glass);
  b.poly([[bb[0], bb[1], bb[3]], [c[0], c[1], c[3]], [c[0], c[1], -c[3]], [bb[0], bb[1], -bb[3]]], body);
  b.poly([[c[0], c[1], c[3]], [d[0], d[1], d[3]], [d[0], d[1], -d[3]], [c[0], c[1], -c[3]]], glass);
  // the sides in strips: glass, the B pillar, glass, the C pillar (body colour)
  const strips = [[CABIN[0][0], B_PILLAR[1], glass], [B_PILLAR[1], B_PILLAR[0], body], [B_PILLAR[0], C_PILLAR_X, glass], [C_PILLAR_X, CABIN[3][0], body]];
  for (const [xa, xb, colour] of strips) {
    // split the strip at the sections so that every piece is planar
    const cuts = [xa, ...CABIN.map((s) => s[0]).filter((x) => x < xa && x > xb), xb];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const p = cabinAt(cuts[i] - 1e-6), q = cabinAt(cuts[i + 1] + 1e-6);
      const x0 = cuts[i], x1 = cuts[i + 1];
      b.poly([[x0, BELT_Y, p.hwB], [x1, BELT_Y, q.hwB], [x1, q.top, q.hwT], [x0, p.top, p.hwT]], colour);
      b.poly([[x1, BELT_Y, -q.hwB], [x0, BELT_Y, -p.hwB], [x0, p.top, -p.hwT], [x1, q.top, -q.hwT]], colour);
    }
  }
  // the front and the back of the cabin are closed by the hull and the tailgate; the underside is hidden by the hull top
}

/** The body mesh: hull, greenhouse and the small parts in the colour of the paint. */
function buildBody(paint) {
  const body = rgb(paint);
  const dark = shade(body, 0.5);
  const glass = [0.2, 0.27, 0.34];
  const plastic = [0.13, 0.13, 0.15];
  const chrome = [0.78, 0.79, 0.82];
  const plate = [0.93, 0.93, 0.9];
  const b = new FaceBuilder();
  addHull(b, body, dark);
  addCabin(b, body, glass);
  // the bumpers (a dark valance under each end), the sills along the sides, the grille
  b.box(1.99, 0.43, 0, 0.07, 0.1, 0.74, plastic);
  b.box(-2.0, 0.46, 0, 0.06, 0.1, 0.7, plastic);
  b.box(0, 0.38, 0.86, 1.2, 0.05, 0.02, plastic);
  b.box(0, 0.38, -0.86, 1.2, 0.05, 0.02, plastic);
  b.box(2.065, 0.62, 0, 0.012, 0.045, 0.3, plastic);               // the grille
  // the number plates (white; the blue strip of the EU on the left)
  b.box(2.07, 0.47, 0, 0.012, 0.065, 0.2, plate);
  b.box(-2.09, 0.62, 0, 0.012, 0.075, 0.2, plate);
  b.box(2.075, 0.47, -0.16, 0.006, 0.065, 0.025, [0.2, 0.3, 0.7]);
  b.box(-2.095, 0.62, -0.16, 0.006, 0.075, 0.025, [0.2, 0.3, 0.7]);
  // the mirrors: a stalk and a housing
  for (const side of [1, -1]) {
    b.box(0.72, 1.0, side * 0.9, 0.05, 0.035, 0.05, dark);
    b.box(0.7, 1.05, side * 0.98, 0.07, 0.06, 0.04, body);
  }
  // the exhaust
  b.box(-2.08, 0.4, 0.5, 0.05, 0.035, 0.035, chrome);
  // the wheel arches: a dark disc on the side of the body behind each wheel, so the tyre sits in an arch and not in a wall
  for (const x of [WHEEL_X, -WHEEL_X]) {
    for (const side of [1, -1]) {
      const z = side * 0.866;
      const ring = [];
      for (let k = 0; k <= WHEEL_SEGMENTS; k++) {
        const a = Math.PI * k / WHEEL_SEGMENTS;                 // the upper half circle
        ring.push([x + Math.cos(a) * (WHEEL_RADIUS + 0.07), WHEEL_RADIUS + Math.sin(a) * (WHEEL_RADIUS + 0.07), z]);
      }
      b.poly(side > 0 ? ring : ring.slice().reverse(), shade(body, 0.28));
    }
  }
  return b.build();
}

/** A wheel: the tyre, the sidewall and the rim, with the axle along z. Both faces are built (the wheel is shared by both sides of the car). */
function buildWheel() {
  const tyre = [0.09, 0.09, 0.1], wall = [0.14, 0.14, 0.15], rim = [0.72, 0.73, 0.76], hub = [0.3, 0.3, 0.33];
  const b = new FaceBuilder();
  const R = WHEEL_RADIUS, W = WHEEL_HALF_WIDTH, Rr = R * 0.62, Rh = R * 0.2;
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

const LAMP_HEAD = [[2.045, 0.76, 0.6, 0.03, 0.055, 0.17], [2.045, 0.76, -0.6, 0.03, 0.055, 0.17]];
const LAMP_TAIL = [[-2.045, 0.84, 0.64, 0.03, 0.06, 0.15], [-2.045, 0.84, -0.64, 0.03, 0.06, 0.15]];
const LAMP_REVERSE = [[-2.07, 0.72, 0.5, 0.02, 0.03, 0.07], [-2.07, 0.72, -0.5, 0.02, 0.03, 0.07]];
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
