/* The painted car of Lux Drive: a low-poly hatchback built from flat-shaded boxes with vertex colours (the painted look of
 * the engine: no photographs, no photo textures, the light is the shared gouache shading).
 *
 * The local frame: +x is the front of the car, +y is up, +z is the right hand side. The car is turned with
 * rotation.y = -heading, because the heading runs from +x towards +z in the world frame (x east, z south). */
import { CAR_COLOURS } from './config.js';

const THREE = window.THREE;

/** Collects flat-shaded boxes with a colour each. */
class BoxBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; }
  get count() { return this.pos.length / 3; }

  /** An axis-aligned box: centre (cx, cy, cz), half sizes (hx, hy, hz), a colour, an optional yaw around y. */
  box(cx, cy, cz, hx, hy, hz, color, yaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (u, v, w) => [cx + u * c - w * s, cy + v, cz + u * s + w * c];
    // the six faces of the box, each with its own normal
    const quads = [
      [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz]],   // -z (the left side)
      [[hx, -hy, hz], [-hx, -hy, hz], [-hx, hy, hz], [hx, hy, hz]],       // +z (the right side)
      [[hx, -hy, -hz], [hx, -hy, hz], [hx, hy, hz], [hx, hy, -hz]],       // +x (the front)
      [[-hx, -hy, hz], [-hx, -hy, -hz], [-hx, hy, -hz], [-hx, hy, hz]],   // -x (the back)
      [[-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz]],       // the roof
      [[-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz], [-hx, -hy, -hz]],   // the floor
    ];
    for (const quad of quads) {
      const [a, b, c] = quad;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const base = this.count;
      for (const p of quad) {
        const w = P(p[0], p[1], p[2]);
        this.pos.push(w[0], w[1], w[2]); this.nor.push(nx, ny, nz);
        this.col.push(color[0], color[1], color[2]);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
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

/**
 * The car model. `colourId` is a key of CAR_COLOURS.
 * Returns { group, body, wheels, wheelRadius, headlightPos, headlightDir }.
 */
export function createCarModel({ colourId = 'red', material }) {
  const base = rgb(CAR_COLOURS[colourId] || CAR_COLOURS.red);
  const dark = shade(base, 0.55);
  const glass = [0.16, 0.20, 0.26];
  const tyre = [0.09, 0.09, 0.10];
  const rim = [0.62, 0.63, 0.66];
  const chrome = [0.78, 0.79, 0.82];
  const lampFront = [0.95, 0.92, 0.76];
  const lampBack = [0.62, 0.12, 0.10];

  const b = new BoxBuilder();
  // the lower body: a long box, the front a little lower than the rear
  b.box(0, 0.72, 0, 2.10, 0.30, 0.88, base);
  b.box(-1.95, 0.62, 0, 0.22, 0.20, 0.84, dark);        // the front bumper
  b.box(2.00, 0.66, 0, 0.18, 0.22, 0.84, dark);         // the rear bumper
  // the cabin: the roof is shorter than the body, the glass band goes all round
  b.box(-0.15, 1.22, 0, 1.05, 0.24, 0.78, glass);
  b.box(-0.15, 1.50, 0, 0.85, 0.08, 0.70, base);        // the roof
  // the hood and the boot, a little lower than the cabin
  b.box(1.35, 1.06, 0, 0.62, 0.06, 0.84, base);
  b.box(-1.55, 1.04, 0, 0.42, 0.06, 0.84, base);
  // the lights
  b.box(2.06, 0.80, 0.52, 0.06, 0.09, 0.16, lampFront);
  b.box(2.06, 0.80, -0.52, 0.06, 0.09, 0.16, lampFront);
  b.box(-2.10, 0.86, 0.56, 0.05, 0.10, 0.14, lampBack);
  b.box(-2.10, 0.86, -0.56, 0.05, 0.10, 0.14, lampBack);
  // the mirrors and the exhaust
  b.box(0.55, 1.18, 0.94, 0.10, 0.05, 0.09, dark);
  b.box(0.55, 1.18, -0.94, 0.10, 0.05, 0.09, dark);
  b.box(-2.12, 0.50, 0.30, 0.05, 0.05, 0.05, chrome);

  const body = new THREE.Mesh(b.build(), material);
  body.name = 'car-body';

  // the wheels: a tyre and a rim, they spin and the front ones steer
  const wheelBuilder = new BoxBuilder();
  wheelBuilder.box(0, 0, 0, 0.32, 0.32, 0.11, tyre);
  wheelBuilder.box(0, 0, 0.12, 0.17, 0.17, 0.02, rim);
  wheelBuilder.box(0, 0, -0.12, 0.17, 0.17, 0.02, rim);
  const wheelGeometry = wheelBuilder.build();
  const wheels = [];
  const wheelPositions = [[1.32, 0.32, 0.78], [1.32, 0.32, -0.78], [-1.36, 0.32, 0.78], [-1.36, 0.32, -0.78]];
  for (const [x, y, z] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeometry, material);
    wheel.position.set(x, y, z);
    wheel.name = 'car-wheel';
    wheels.push(wheel);
  }

  const group = new THREE.Group();
  group.name = 'car';
  group.add(body);
  for (const w of wheels) group.add(w);
  group.scale.setScalar(1);
  return {
    group, body, wheels,
    /** The car model is 4.4 m long: the wheels sit at the corners of a 2.62 m wheelbase. */
    wheelbase: 2.68,
    /** Puts the car on the ground: the wheels turn, the front ones steer, the body rolls and pitches. */
    apply(state, dt) {
      group.position.set(state.x, state.y - 0.42, state.z);
      group.rotation.set(0, -state.heading, 0);
      const pitch = state.pitch;
      const roll = state.roll;
      body.rotation.set(pitch, 0, roll);
      const spin = state.speed * dt / 0.32;
      for (let i = 0; i < wheels.length; i++) {
        const wheel = wheels[i];
        wheel.rotation.set(0, i < 2 ? state.steer : 0, 0);
        wheel.rotateX(spin);
      }
    },
    /** The headlight: the world position and the direction of the beam (for the lamp of the light shader). */
    headlight(state, outPos, outDir) {
      const cy = Math.cos(state.heading), sy = Math.sin(state.heading);
      outPos.set(state.x + cy * 2.0, state.y + 0.35, state.z + sy * 2.0);
      outDir.set(cy, -0.12, sy);
    },
  };
}
