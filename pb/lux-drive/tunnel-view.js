/* The drivable tunnels of Lux Drive drawn (tunnels16): the tube (floor with its lane lines, walls, ceiling, the light bands) and the portal set into the cut (the
 * headwalls round the open mouth, the shell of the tube where the land over it lies lower than its roof).
 *
 * Two meshes per tube: the INSIDE (its own material: the tunnel lights it, not the sun - a sunlit tunnel wall read as a trench) is drawn when the camera is near; the
 * OUTSIDE (the headwalls and the shell, the shared solid material) as far as the portals of the closed tunnels.  Every height is the tube's own floor
 * (tunnel-tubes.js floorOf), so what the car drives on is what is drawn. */
import { FlatBuilder } from './flat-builder.js';
import { PAINT_LIGHT_GLSL } from './light-glsl.js';
import { TUBE, floorOf } from './tunnel-tubes.js';

const THREE = window.THREE;
const STEP = 2;                                  // m between the cross sections of a tube
const FLOOR_STRIPS = 8;                          // strips across the floor (it follows the cross-section of the approaches near the faces)
const CHAMFER = 0.7;                             // m: the corners between the walls and the ceiling
const LAMP_EVERY = 6;                            // m between the lamps of the light band
const LAMP_LENGTH = 1.4;                         // m: one lamp
const LAMP_WIDTH = 0.28;
const LINE_WIDTH = 0.15;                         // m: the lane lines
const DASH = 3, GAP = 9;                         // m: the dashes between two lanes of one direction
const LINE_LIFT = 0.015;                         // m over the floor
const WALKWAY = 0.45;                            // m: the pale strip along the foot of each wall
const DADO = 1.3;                                // m: the tiled lower part of the walls
const INSIDE_RADIUS = 320;                       // m: the inside of a tube is drawn this close to the camera

const C_ASPHALT = [0.16, 0.16, 0.17];
const C_KERB = [0.42, 0.42, 0.41];
const C_TILE = [0.66, 0.67, 0.65];
const C_WALL = [0.30, 0.30, 0.31];
const C_CEILING = [0.20, 0.20, 0.21];
const C_LAMP = [1.25, 1.12, 0.86];               // (> 1: the lamps glow through the fog)
const C_LINE = [0.85, 0.85, 0.82];
const C_HEAD = [0.68, 0.66, 0.61];               // the concrete of the headwalls
const C_COPING = [0.78, 0.76, 0.71];
const C_SHELL = [0.60, 0.59, 0.56];

const INSIDE_VERTEX = `
  attribute vec3 color; varying vec3 vC; varying vec3 vWorld; varying float vDist;
  void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vC = color; vWorld = wp.xyz; vec4 mv = viewMatrix * wp; vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }
`;
const INSIDE_FRAGMENT = `
  precision highp float; varying vec3 vC; varying vec3 vWorld; varying float vDist;
  ${PAINT_LIGHT_GLSL}
  void main(){ gl_FragColor = vec4(applyFogW(vC, vDist, vWorld.y), 1.0); }
`;

/** The material of the inside of a tube: its vertex colours lit by the tunnel lights (the same at noon and at night), in the fog of the world. */
export function createTubeInsideMaterial(env) {
  return new THREE.ShaderMaterial({ uniforms: { ...env.uniforms }, vertexShader: INSIDE_VERTEX, fragmentShader: INSIDE_FRAGMENT, side: THREE.DoubleSide });
}

/** The frame of a tube at arc length s: { x, z, rx, rz, i, f } (rx, rz: the unit vector to the right of s). */
function frameAt(tube, s) {
  const n = tube.s.length;
  let i = Math.max(0, Math.min(n - 2, Math.floor(s)));
  while (i > 0 && tube.s[i] > s) i--;
  while (i < n - 2 && tube.s[i + 1] < s) i++;
  const f = Math.max(0, Math.min(1, (s - tube.s[i]) / Math.max(1e-6, tube.s[i + 1] - tube.s[i])));
  const tx = tube.tx[i] + (tube.tx[i + 1] - tube.tx[i]) * f, tz = tube.tz[i] + (tube.tz[i + 1] - tube.tz[i]) * f, l = Math.hypot(tx, tz) || 1;
  return { x: tube.x[i] + (tube.x[i + 1] - tube.x[i]) * f, z: tube.z[i] + (tube.z[i + 1] - tube.z[i]) * f, rx: -tz / l, rz: tx / l, i, f };
}

/** The stations of a tube from face to face (every STEP m, both faces exact). */
function stationsOf(tube) {
  const out = [];
  for (let s = tube.sA; s < tube.sB; s += STEP) out.push(s);
  out.push(tube.sB);
  return out;
}

/** The lane lines of a tube: [lat, dashed] (lat to the right of s). */
function linesOf(tube) {
  const w = tube.width, n = Math.max(1, tube.lanes), out = [[-w / 2 + 0.3, false], [w / 2 - 0.3, false]];
  if (!tube.oneway && n >= 2) out.push([0, false]);                                   // (two ways: a solid centre line)
  if (tube.oneway) for (let k = 1; k < n; k++) out.push([-w / 2 + (k * w) / n, true]);
  return out;
}

/** The inside of one tube into builder b. */
export function buildInside(tube, b) {
  const st = stationsOf(tube);
  const ih = tube.innerHalf, clr = tube.clearance;
  const P = (fr, lat, y) => [fr.x + fr.rx * lat, y, fr.z + fr.rz * lat];
  const floorY = (fr, lat) => floorOf(tube, fr.i, fr.f, lat);
  for (let k = 0; k + 1 < st.length; k++) {
    const a = frameAt(tube, st[k]), c = frameAt(tube, st[k + 1]);
    // the floor: asphalt between the walkways, the walkways pale (the floor faces up: the winding a, c, c', a' seen from above)
    for (let j = 0; j < FLOOR_STRIPS; j++) {
      const l0 = -ih + (2 * ih * j) / FLOOR_STRIPS, l1 = -ih + (2 * ih * (j + 1)) / FLOOR_STRIPS;
      b.quad(P(a, l1, floorY(a, l1)), P(c, l1, floorY(c, l1)), P(c, l0, floorY(c, l0)), P(a, l0, floorY(a, l0)), C_ASPHALT);
    }
    for (const side of [-1, 1]) {
      const lw = side * ih, lk = side * (ih - WALKWAY);
      const q = (l0, l1, lift, col) => (side > 0
        ? b.quad(P(a, l1, floorY(a, l1) + lift), P(c, l1, floorY(c, l1) + lift), P(c, l0, floorY(c, l0) + lift), P(a, l0, floorY(a, l0) + lift), col)
        : b.quad(P(a, l0, floorY(a, l0) + lift), P(c, l0, floorY(c, l0) + lift), P(c, l1, floorY(c, l1) + lift), P(a, l1, floorY(a, l1) + lift), col));
      q(Math.min(lk, lw), Math.max(lk, lw), LINE_LIFT, C_KERB);
      // the wall: the tiled dado, the wall above it, the chamfer to the ceiling (facing into the tube)
      const ya = floorY(a, lw), yc = floorY(c, lw);
      const wall = (y0a, y0c, y1a, y1c, col) => (side > 0
        ? b.quad(P(a, lw, y0a), P(a, lw, y1a), P(c, lw, y1c), P(c, lw, y0c), col)
        : b.quad(P(c, lw, y0c), P(c, lw, y1c), P(a, lw, y1a), P(a, lw, y0a), col));
      wall(ya, yc, ya + DADO, yc + DADO, C_TILE);
      wall(ya + DADO, yc + DADO, ya + clr - CHAMFER, yc + clr - CHAMFER, C_WALL);
      const ci = side * (ih - CHAMFER);
      const ta = tube.floor[a.i] + (tube.floor[a.i + 1] - tube.floor[a.i]) * a.f + clr, tc = tube.floor[c.i] + (tube.floor[c.i + 1] - tube.floor[c.i]) * c.f + clr;
      if (side > 0) b.quad(P(a, lw, ya + clr - CHAMFER), P(a, ci, ta), P(c, ci, tc), P(c, lw, yc + clr - CHAMFER), C_CEILING);
      else b.quad(P(c, lw, yc + clr - CHAMFER), P(c, ci, tc), P(a, ci, ta), P(a, lw, ya + clr - CHAMFER), C_CEILING);
    }
    // the ceiling (facing down)
    const ta = tube.floor[a.i] + (tube.floor[a.i + 1] - tube.floor[a.i]) * a.f + clr, tc = tube.floor[c.i] + (tube.floor[c.i + 1] - tube.floor[c.i]) * c.f + clr;
    const ci = ih - CHAMFER;
    b.quad(P(a, -ci, ta), P(c, -ci, tc), P(c, ci, tc), P(a, ci, ta), C_CEILING);
  }
  // the light band: lamps along the ceiling, over the edge lines (a little under the ceiling, facing down)
  for (let s = tube.sA + LAMP_EVERY / 2; s + LAMP_LENGTH < tube.sB; s += LAMP_EVERY) {
    const a = frameAt(tube, s), c = frameAt(tube, s + LAMP_LENGTH);
    const ya = tube.floor[a.i] + (tube.floor[a.i + 1] - tube.floor[a.i]) * a.f + clr - 0.04, yc = tube.floor[c.i] + (tube.floor[c.i + 1] - tube.floor[c.i]) * c.f + clr - 0.04;
    for (const lat of [-(ih - CHAMFER - 0.3), ih - CHAMFER - 0.3]) {
      b.quad(P(a, lat - LAMP_WIDTH, ya), P(c, lat - LAMP_WIDTH, yc), P(c, lat + LAMP_WIDTH, yc), P(a, lat + LAMP_WIDTH, ya), C_LAMP);
    }
  }
  // the lane lines (facing up)
  for (const [lat, dashed] of linesOf(tube)) {
    for (let s = tube.sA; s < tube.sB; s += dashed ? DASH + GAP : STEP) {
      const s1 = Math.min(tube.sB, s + (dashed ? DASH : STEP));
      const a = frameAt(tube, s), c = frameAt(tube, s1);
      const l0 = lat - LINE_WIDTH / 2, l1 = lat + LINE_WIDTH / 2;
      b.quad(P(a, l1, floorY(a, l1) + LINE_LIFT), P(c, l1, floorY(c, l1) + LINE_LIFT), P(c, l0, floorY(c, l0) + LINE_LIFT), P(a, l0, floorY(a, l0) + LINE_LIFT), C_LINE);
    }
  }
}

/** A box in a frame (u to the side, v along +s, y up) into builder b; all six faces outward. */
function box(b, P, u0, u1, v0, v1, ya, yc, col) {
  b.quad(P(u0, v0, ya), P(u1, v0, ya), P(u1, v0, yc), P(u0, v0, yc), col);
  b.quad(P(u1, v1, ya), P(u0, v1, ya), P(u0, v1, yc), P(u1, v1, yc), col);
  b.quad(P(u0, v1, ya), P(u0, v0, ya), P(u0, v0, yc), P(u0, v1, yc), col);
  b.quad(P(u1, v0, ya), P(u1, v1, ya), P(u1, v1, yc), P(u1, v0, yc), col);
  b.quad(P(u0, v0, yc), P(u1, v0, yc), P(u1, v1, yc), P(u0, v1, yc), col);
  b.quad(P(u0, v1, ya), P(u1, v1, ya), P(u1, v0, ya), P(u0, v0, ya), col);
}

/** The roof top of a tube at a frame (flat across, over the highest corner of its floor). */
const roofAt = (tube, fr) => tube.floor[fr.i] + (tube.floor[fr.i + 1] - tube.floor[fr.i]) * fr.f + Math.abs(tube.cross[fr.i]) * tube.outerHalf + tube.roofDepth;

/** The outside of one tube into builder b: the shell (outer walls and roof top) and the headwalls of its two portals.  heightAt: the drawn ground. */
export function buildOutside(tube, b, heightAt) {
  const st = stationsOf(tube), oh = tube.outerHalf;
  const P = (fr, lat, y) => [fr.x + fr.rx * lat, y, fr.z + fr.rz * lat];
  for (let k = 0; k + 1 < st.length; k++) {
    const a = frameAt(tube, st[k]), c = frameAt(tube, st[k + 1]);
    const ra = roofAt(tube, a) + TUBE.maskLift, rc = roofAt(tube, c) + TUBE.maskLift;
    const fa = Math.min(floorOf(tube, a.i, a.f, -oh), floorOf(tube, a.i, a.f, oh)) - 1, fc = Math.min(floorOf(tube, c.i, c.f, -oh), floorOf(tube, c.i, c.f, oh)) - 1;
    b.quad(P(a, oh, ra), P(c, oh, rc), P(c, -oh, rc), P(a, -oh, ra), C_SHELL);                               // the roof top (facing up)
    b.quad(P(a, oh, fa), P(c, oh, fc), P(c, oh, rc), P(a, oh, ra), C_SHELL);                                 // the right outer wall (facing out)
    b.quad(P(c, -oh, fc), P(a, -oh, fa), P(a, -oh, ra), P(c, -oh, rc), C_SHELL);                             // the left one
  }
  // the headwalls: a frame of concrete round the open mouth, set into the cut, at each face (v into the tube)
  const head = oh + TUBE.wing;
  for (const [sFace, into] of [[tube.sA, 1], [tube.sB, -1]]) {
    const fr = frameAt(tube, sFace);
    // u to the right looking INTO the tube, e into it (the tangent of s is (rz, -rx))
    const ux = fr.rx * into, uz = fr.rz * into, ex = fr.rz * into, ez = -fr.rx * into;
    const PP = (u, v, y) => [fr.x + ux * u + ex * v, y, fr.z + uz * u + ez * v];
    const floor0 = floorOf(tube, fr.i, fr.f, 0), top = floor0 + tube.clearance;
    const roof = roofAt(tube, fr);
    let base = Infinity, behind = -Infinity;
    for (let u = -head; u <= head + 1e-6; u += head / 4) {
      base = Math.min(base, heightAt(fr.x + ux * u - ex * 0.5, fr.z + uz * u - ez * 0.5), heightAt(fr.x + ux * u + ex * (TUBE.headDepth + 0.5), fr.z + uz * u + ez * (TUBE.headDepth + 0.5)));
      behind = Math.max(behind, heightAt(fr.x + ux * u + ex * (TUBE.headDepth + 1.5), fr.z + uz * u + ez * (TUBE.headDepth + 1.5)));
    }
    base = Math.min(base, floor0) - 1.2;
    const wallTop = Math.max(roof + TUBE.parapet, Math.min(behind + 0.2, roof + TUBE.headMax));
    const ih = tube.innerHalf;
    box(b, PP, -head, -ih, 0, TUBE.headDepth, base, wallTop, C_HEAD);               // the pillars beside the mouth
    box(b, PP, ih, head, 0, TUBE.headDepth, base, wallTop, C_HEAD);
    box(b, PP, -ih, ih, 0, TUBE.headDepth, top, wallTop, C_HEAD);                   // the lintel over it
    box(b, PP, -head - 0.2, head + 0.2, -0.15, TUBE.headDepth, wallTop, wallTop + 0.25, C_COPING);
  }
}

/**
 * tubes: tunnel-tubes.js tubes; heightAt: the drawn ground (surface.height).  inside / outside: the two materials.
 * Returns { update(x, z, radius), meshes, count }.
 */
export function createTunnelView({ scene, tubes, heightAt, insideMaterial, outsideMaterial }) {
  const parts = [];
  for (const tube of tubes) {
    const bi = new FlatBuilder(), bo = new FlatBuilder();
    buildInside(tube, bi);
    buildOutside(tube, bo, heightAt);
    const inside = new THREE.Mesh(bi.build(), insideMaterial), outside = new THREE.Mesh(bo.build(), outsideMaterial);
    inside.name = `luxdrive-tube-inside ${tube.name}`; outside.name = `luxdrive-tube-outside ${tube.name}`;
    for (const m of [inside, outside]) { m.matrixAutoUpdate = false; scene.add(m); }
    parts.push({ tube, inside, outside });
  }
  /** Shows the insides near (x, z) and the outsides within `radius`. */
  function update(x, z, radius) {
    let shown = 0;
    for (const p of parts) {
      const si = p.inside.geometry.boundingSphere, so = p.outside.geometry.boundingSphere;
      p.inside.visible = Math.hypot(si.center.x - x, si.center.z - z) - si.radius < INSIDE_RADIUS;
      p.outside.visible = Math.hypot(so.center.x - x, so.center.z - z) - so.radius < radius;
      if (p.outside.visible) shown++;
    }
    return shown;
  }
  return { update, meshes: parts.flatMap((p) => [p.inside, p.outside]), count: parts.length, parts };
}
