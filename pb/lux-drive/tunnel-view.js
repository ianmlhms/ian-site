/* The drivable tunnels of Lux Drive drawn (tunnels16): the tube (floor with its lane lines, walls, ceiling, the light bands) and the portal set into the cut (the
 * headwalls round the open mouth, the shell of the tube where the land over it lies lower than its roof).
 *
 * Two meshes per tube: the INSIDE (its own material: the tunnel lights it, not the sun - a sunlit tunnel wall read as a trench) is drawn when the camera is near; the
 * OUTSIDE (the headwalls and the shell, the shared solid material) as far as the portals of the closed tunnels.  Every height is the tube's own floor
 * (tunnel-tubes.js floorOf), so what the car drives on is what is drawn. */
import { FlatBuilder } from './flat-builder.js';
import { PAINT_LIGHT_GLSL } from './light-glsl.js';
import { TUBE, floorOf, wallTopAt, troughFloor } from './tunnel-tubes.js';
import { laneLines, LINE_WIDTH as PAINT_WIDTH, DASH_PERIOD, DASH_LENGTH, PAINT_LIFT } from './deck-shape.js';
// (a tube's two sides may differ: one it shares with a parallel tube is narrower - tunnel-tubes.js pairTubes)

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
const FACE_SKIRT = 1.0;                          // m: the floor's edge at a face hangs this far down
// the earth stops of a mouth without a trough (tunnels19): where the land right outside the face stands in the opening (a slip road over the edge of the mouth: the
// A4 west mouth under the Merl slip road 12833, 6.8 m over the floor 1 m inside the opening), the terrain is seen from inside the tube from below - nothing (the holes
// flow: 77 px).  A block of the headwall's concrete fills the opening there, from under the floor up to the land at the face
const EARTH_STEP = 0.5;                          // m: the width of one block across the opening
const EARTH_RISE = 0.4;                          // m: a block where the land at the face (the middle of the strip) lies this far over the floor on a drawn carriageway (the road
                                                 // meets the floor within cm: no block in a lane) ...
const EARTH_RISE_OFF = 0.12;                     // ... and this far beside it (a 0.3 m lip of the slope beside the A4 west lanes showed its underside from inside)
const EARTH_DEPTH = 0.3;                         // m: how far a block reaches into the tube
const EARTH_READ = [0.1, 0.6];                   // m out of the face at which the land is read
const SILL_READ = [0, 0.12, 0.25];               // m out of a face at which the drawn ground in front of it is read for the sill ...
const SILL_LIFT = 0.03;                          // ... which rises this much over it (the coarse tiles of the low level lie a hair off the surface)
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
// the troughs of the approaches (tunnel-tubes.js TROUGH): sunlit, so drawn with the solid material, in the tones of the decks (the road runs on without a change of tone)
const TROUGH_STEP = 1;                           // m between the cross sections of a trough (its wall tops follow the land)
const KERB_WIDTH = 0.35, KERB_HEIGHT = 0.12;     // m: the kerb along the foot of each trough wall
const WALL_FOOT = 1.5;                           // m: the back of a trough wall reaches this far under the land it holds
const FLASH_WIDTH = 0.6, FLASH_SINK = 0.03;      // m: the flashing behind a wall lower than the land it holds reaches this far back, this far under the land
const APRON = 0.6, APRON_SINK = 0.03;            // m: the floor reaches this far on past the outer end of a trough, this far under the terrain
const FLOOR_SKIRT = 1.0;                         // m: the floor's outer edge hangs this far down (the terrain is cut there by the mask)
const C_TAR = [0.245, 0.249, 0.261];             // (deck-view.js COLOUR_ASPHALT: the far tar of the ground shader)
const C_PAINT = [0.84, 0.83, 0.76];
const C_TROUGH_WALL = [0.66, 0.65, 0.61];
const C_TROUGH_KERB = [0.58, 0.58, 0.56];

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

/** m: an edge line keeps this far off the walkway. */
const EDGE_ROOM = 0.15;

/** The lane lines of a tube: [lat, dashed] (lat to the right of s). */
function linesOf(tube) {
  // (the edge lines keep off the walkways: beside a parallel tube the carriageway loses its hard shoulder - the A4 / N56 boxes under the Rond-Point Merl, tunnels19)
  const w = tube.width, n = Math.max(1, tube.lanes);
  const out = [[Math.max(-w / 2 + 0.3, -(tube.innerL - WALKWAY - EDGE_ROOM)), false], [Math.min(w / 2 - 0.3, tube.innerR - WALKWAY - EDGE_ROOM), false]];
  if (!tube.oneway && n >= 2) out.push([0, false]);                                   // (two ways: a solid centre line)
  if (tube.oneway) for (let k = 1; k < n; k++) out.push([-w / 2 + (k * w) / n, true]);
  return out;
}

/** The inside of one tube into builder b.  heightAt: the drawn ground (the sills at the faces). */
export function buildInside(tube, b, heightAt) {
  const st = stationsOf(tube);
  const iL = tube.innerL, iR = tube.innerR, clr = tube.clearance;
  const P = (fr, lat, y) => [fr.x + fr.rx * lat, y, fr.z + fr.rz * lat];
  const floorY = (fr, lat) => floorOf(tube, fr.i, fr.f, lat);
  for (let k = 0; k + 1 < st.length; k++) {
    const a = frameAt(tube, st[k]), c = frameAt(tube, st[k + 1]);
    // the floor: asphalt between the walkways, the walkways pale (the floor faces up: the winding a, c, c', a' seen from above)
    for (let j = 0; j < FLOOR_STRIPS; j++) {
      const l0 = -iL + ((iL + iR) * j) / FLOOR_STRIPS, l1 = -iL + ((iL + iR) * (j + 1)) / FLOOR_STRIPS;
      b.quad(P(a, l1, floorY(a, l1)), P(c, l1, floorY(c, l1)), P(c, l0, floorY(c, l0)), P(a, l0, floorY(a, l0)), C_ASPHALT);
    }
    for (const side of [-1, 1]) {
      const ih = side > 0 ? iR : iL, lw = side * ih, lk = side * (ih - WALKWAY);
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
    b.quad(P(a, -(iL - CHAMFER), ta), P(c, -(iL - CHAMFER), tc), P(c, iR - CHAMFER, tc), P(a, iR - CHAMFER, ta), C_CEILING);
  }
  // the skirts of the floor at the faces (facing out of the tube): in front of a face the terrain is cut by the mask, and where the floor's edge lies over the
  // approach's ground a sliver under it stood open (the holes flow saw it under the mouths of the Schuman underpass)
  for (const [sFace, out] of [[tube.sA, -1], [tube.sB, 1]]) {
    const e = frameAt(tube, sFace);
    for (let j = 0; j < FLOOR_STRIPS; j++) {
      const l0 = -iL + ((iL + iR) * j) / FLOOR_STRIPS, l1 = -iL + ((iL + iR) * (j + 1)) / FLOOR_STRIPS;
      const y0 = floorY(e, l0), y1 = floorY(e, l1);       // (on the floor's own vertices: watertight)
      if (out < 0) b.quad(P(e, l0, y0 - FACE_SKIRT), P(e, l1, y1 - FACE_SKIRT), P(e, l1, y1), P(e, l0, y0), C_ASPHALT);
      else b.quad(P(e, l0, y0), P(e, l1, y1), P(e, l1, y1 - FACE_SKIRT), P(e, l0, y0 - FACE_SKIRT), C_ASPHALT);
    }
  }
  // the sills at the faces without a trough (fix19): where the land in front of a face rises over the floor's edge (the foot of the embankment over the Rue de
  // Munsbach underpass: 0.03 - 0.15 m across the lanes), a ray from inside the tube passed over the edge and under the terrain beyond (seen from below: not drawn)
  // - a hairline of nothing across the mouth.  The sill is the step of that land, standing on the face from the floor's edge up to the ground in front of it.
  for (const [sFace, out, trough] of [[tube.sA, -1, tube.troughA], [tube.sB, 1, tube.troughB]]) {
    if (trough) continue;                                     // (a trough's floor runs on from the face at the floor's own level: no step)
    const e = frameAt(tube, sFace);
    const ex = e.rz * out, ez = -e.rx * out;                  // (out of the tube: the tangent of s is (rz, -rx))
    const landAt = (lat) => Math.max(...SILL_READ.map((d) => heightAt(e.x + e.rx * lat + ex * d, e.z + e.rz * lat + ez * d))) + SILL_LIFT;
    for (let j = 0; j < FLOOR_STRIPS; j++) {
      const l0 = -iL + ((iL + iR) * j) / FLOOR_STRIPS, l1 = -iL + ((iL + iR) * (j + 1)) / FLOOR_STRIPS;
      const y0 = floorY(e, l0), y1 = floorY(e, l1), t0 = landAt(l0), t1 = landAt(l1);
      if (t0 <= y0 && t1 <= y1) continue;
      const u0 = Math.max(y0, t0), u1 = Math.max(y1, t1);
      if (out < 0) b.quad(P(e, l0, y0), P(e, l1, y1), P(e, l1, u1), P(e, l0, u0), C_ASPHALT);
      else b.quad(P(e, l0, u0), P(e, l1, u1), P(e, l1, y1), P(e, l0, y0), C_ASPHALT);
    }
  }
  // the light band: lamps along the ceiling, over the edge lines (a little under the ceiling, facing down)
  for (let s = tube.sA + LAMP_EVERY / 2; s + LAMP_LENGTH < tube.sB; s += LAMP_EVERY) {
    const a = frameAt(tube, s), c = frameAt(tube, s + LAMP_LENGTH);
    const ya = tube.floor[a.i] + (tube.floor[a.i + 1] - tube.floor[a.i]) * a.f + clr - 0.04, yc = tube.floor[c.i] + (tube.floor[c.i + 1] - tube.floor[c.i]) * c.f + clr - 0.04;
    for (const lat of [-(iL - CHAMFER - 0.3), iR - CHAMFER - 0.3]) {
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

/** The (x, z) of a point [x, y, z]. */
const xzOf = (p) => [p[0], p[2]];

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
const roofAt = (tube, fr) => tube.floor[fr.i] + (tube.floor[fr.i + 1] - tube.floor[fr.i]) * fr.f + Math.abs(tube.cross[fr.i]) * tube.outerHalf + tube.roofDepth;   // (as tunnel-tubes.js)

/**
 * The outside of one tube into builder b: the shell (outer walls and roof top) and the headwalls of its two portals.  heightAt: the drawn ground; onRoad(x, z): is the
 * point on a drawn carriageway (optional: without it every earth stop needs EARTH_RISE).
 */
export function buildOutside(tube, b, heightAt, onRoad = null) {
  const st = stationsOf(tube), oL = tube.outerL, oR = tube.outerR;
  const P = (fr, lat, y) => [fr.x + fr.rx * lat, y, fr.z + fr.rz * lat];
  for (let k = 0; k + 1 < st.length; k++) {
    const a = frameAt(tube, st[k]), c = frameAt(tube, st[k + 1]);
    const ra = roofAt(tube, a) + TUBE.maskLift, rc = roofAt(tube, c) + TUBE.maskLift;
    const fa = Math.min(floorOf(tube, a.i, a.f, -oL), floorOf(tube, a.i, a.f, oR)) - 1, fc = Math.min(floorOf(tube, c.i, c.f, -oL), floorOf(tube, c.i, c.f, oR)) - 1;
    b.quad(P(a, oR, ra), P(c, oR, rc), P(c, -oL, rc), P(a, -oL, ra), C_SHELL);                               // the roof top (facing up)
    b.quad(P(a, oR, fa), P(c, oR, fc), P(c, oR, rc), P(a, oR, ra), C_SHELL);                                 // the right outer wall (facing out)
    b.quad(P(c, -oL, fc), P(a, -oL, fa), P(a, -oL, ra), P(c, -oL, rc), C_SHELL);                             // the left one
  }
  // the headwalls: a frame of concrete round the open mouth, set into the cut, at each face (v into the tube)
  for (const [sFace, into] of [[tube.sA, 1], [tube.sB, -1]]) {
    const fr = frameAt(tube, sFace);
    // u to the right looking INTO the tube, e into it (the tangent of s is (rz, -rx))
    const ux = fr.rx * into, uz = fr.rz * into, ex = fr.rz * into, ez = -fr.rx * into;
    const PP = (u, v, y) => [fr.x + ux * u + ex * v, y, fr.z + uz * u + ez * v];
    const floor0 = floorOf(tube, fr.i, fr.f, 0), top = floor0 + tube.clearance;
    const roof = roofAt(tube, fr);
    // (u > 0 is the side lat = into: the pillar there ends at that side's head)
    const headP = into > 0 ? tube.headR : tube.headL, headN = into > 0 ? tube.headL : tube.headR, inP = into > 0 ? tube.innerR : tube.innerL, inN = into > 0 ? tube.innerL : tube.innerR;
    let base = Infinity, behind = -Infinity;
    for (let u = -headN; u <= headP + 1e-6; u += (headN + headP) / 8) {
      base = Math.min(base, heightAt(fr.x + ux * u - ex * 0.5, fr.z + uz * u - ez * 0.5), heightAt(fr.x + ux * u + ex * (TUBE.headDepth + 0.5), fr.z + uz * u + ez * (TUBE.headDepth + 0.5)));
      behind = Math.max(behind, heightAt(fr.x + ux * u + ex * (TUBE.headDepth + 1.5), fr.z + uz * u + ez * (TUBE.headDepth + 1.5)));
    }
    base = Math.min(base, floor0) - 1.2;
    const wallTop = Math.max(roof + TUBE.parapet, Math.min(behind + 0.2, roof + TUBE.headMax));
    box(b, PP, -headN, -inN, 0, TUBE.headDepth, base, wallTop, C_HEAD);             // the pillars beside the mouth
    box(b, PP, inP, headP, 0, TUBE.headDepth, base, wallTop, C_HEAD);
    box(b, PP, -inN, inP, 0, TUBE.headDepth, top, wallTop, C_HEAD);                 // the lintel over it
    box(b, PP, -headN - (headN > tube.outerHalf ? 0.2 : 0), headP + (headP > tube.outerHalf ? 0.2 : 0), -0.15, TUBE.headDepth, wallTop, wallTop + 0.25, C_COPING);
    // the earth stops in the opening (a mouth with a trough has its own floor and walls in front of it)
    if (!(into > 0 ? tube.troughA : tube.troughB)) {
      // the apron: the floor reaches APRON m on out of the face, APRON_SINK under itself (under the terrain of a flush approach).  The mask of the shell ends square at the
      // face on the chord of its segment, the floor on the tangent: from inside, a ray over the end of the floor met the masked land past it from below (the A4 west mouth)
      const o = frameAt(tube, sFace - into * APRON), e = frameAt(tube, sFace);
      for (let j = 0; j < FLOOR_STRIPS; j++) {
        const l0 = -tube.innerL + ((tube.innerL + tube.innerR) * j) / FLOOR_STRIPS, l1 = -tube.innerL + ((tube.innerL + tube.innerR) * (j + 1)) / FLOOR_STRIPS;
        const Q = (fq, lat, y) => [fq.x + fq.rx * lat, y, fq.z + fq.rz * lat];
        const y0 = floorOf(tube, e.i, e.f, l0) - APRON_SINK, y1 = floorOf(tube, e.i, e.f, l1) - APRON_SINK;
        // (its outer edge rises to just under higher land: a lip of the land at the face - 0.3 m beside the A4 west lanes - is met from inside by the apron, not seen from below)
        const out0 = Math.max(y0, heightAt(...xzOf(Q(o, l0, 0))) - APRON_SINK), out1 = Math.max(y1, heightAt(...xzOf(Q(o, l1, 0))) - APRON_SINK);
        if (into > 0) b.quad(Q(e, l1, y1), Q(e, l0, y0), Q(o, l0, out0), Q(o, l1, out1), C_TAR);           // (facing up: face A's apron lies at smaller s)
        else b.quad(Q(o, l1, out1), Q(o, l0, out0), Q(e, l0, y0), Q(e, l1, y1), C_TAR);
      }
      for (let u = -inN; u < inP - 1e-6; u += EARTH_STEP) {
        const u1 = Math.min(inP, u + EARTH_STEP);
        const landAt = (q) => Math.max(...EARTH_READ.map((d) => heightAt(fr.x + ux * q - ex * d, fr.z + uz * q - ez * d)));
        const floorLo = Math.min(floorOf(tube, fr.i, fr.f, u * into), floorOf(tube, fr.i, fr.f, u1 * into));
        // (judged in the middle of the strip: a strip that only touches the slope beside a lane stays open; the block reaches the highest land of the strip)
        const um = (u + u1) / 2, onLane = !!onRoad && onRoad(fr.x + ux * um - ex * EARTH_READ[0], fr.z + uz * um - ez * EARTH_READ[0]);
        if (landAt(um) < floorLo + (onLane || !onRoad ? EARTH_RISE : EARTH_RISE_OFF)) continue;
        const land = Math.max(landAt(u), landAt((u + u1) / 2), landAt(u1));
        box(b, PP, u, u1, 0, EARTH_DEPTH, floorLo - FACE_SKIRT, Math.min(land, top), C_HEAD);
      }
    }
  }
}

/** The stations of the trough of one end (end -1: face A, +1: face B), from the face outward, every TROUGH_STEP m; [] without one. */
function troughStations(tube, end) {
  const len = end < 0 ? tube.troughA : tube.troughB;
  if (!len) return [];
  const sFace = end < 0 ? tube.sA : tube.sB, out = [];
  for (let d = 0; d < len - 1e-6; d += TROUGH_STEP) out.push(sFace + end * d);
  out.push(sFace + end * len);
  return out;
}

/**
 * The troughs of a tube into builder b (tunnel-tubes.js TROUGH): the floor between the walls (troughFloor: the car's ground), its lane lines (the approach's, as the decks paint them), a kerb at the foot of each wall, the walls (face, coping, back) and their ends.
 * heightAt: the drawn ground.
 */
export function buildTroughs(tube, b, heightAt) {
  const P = (fr, lat, y) => [fr.x + fr.rx * lat, y, fr.z + fr.rz * lat];
  const floorY = (fr, s, lat) => troughFloor(tube, fr.i, fr.f, lat, s);
  const iL = tube.innerL, iR = tube.innerR;
  for (const end of [-1, 1]) {
    const st = troughStations(tube, end);
    if (!st.length) continue;
    const road = end < 0 ? tube.roadA : tube.roadB;
    // (built from the outer end toward the face: a then c run along +s on both ends)
    const ordered = end < 0 ? [...st].reverse() : st;
    for (let k = 0; k + 1 < ordered.length; k++) {
      const sa = ordered[k], sc = ordered[k + 1];
      const a = frameAt(tube, sa), c = frameAt(tube, sc);
      for (let j = 0; j < FLOOR_STRIPS; j++) {
        const l0 = -iL + ((iL + iR) * j) / FLOOR_STRIPS, l1 = -iL + ((iL + iR) * (j + 1)) / FLOOR_STRIPS;
        b.quad(P(a, l1, floorY(a, sa, l1)), P(c, l1, floorY(c, sc, l1)), P(c, l0, floorY(c, sc, l0)), P(a, l0, floorY(a, sa, l0)), C_TAR);
      }
      for (const side of [-1, 1]) {
        const ih = side > 0 ? iR : iL, oh = side > 0 ? tube.outerR : tube.outerL;
        const lw = side * ih, lk = side * (ih - KERB_WIDTH), lo = side * oh;
        const ya = floorY(a, sa, lw), yc = floorY(c, sc, lw);
        const ka = floorY(a, sa, lk) + KERB_HEIGHT, kc = floorY(c, sc, lk) + KERB_HEIGHT;
        const ta = wallTopAt(tube, a.i, a.f, lw), tc = wallTopAt(tube, c.i, c.f, lw);
        if (!Number.isFinite(ta) || !Number.isFinite(tc)) continue;
        // a quad between two lats (l0 < l1) facing up, and a wall at lat facing toward the middle (in) or away from it
        const up = (l0, l1, y0a, y0c, y1a, y1c, col) => b.quad(P(a, l1, y1a), P(c, l1, y1c), P(c, l0, y0c), P(a, l0, y0a), col);
        const wall = (lat, y0a, y0c, y1a, y1c, inward, col) => ((side > 0) === inward
          ? b.quad(P(a, lat, y0a), P(a, lat, y1a), P(c, lat, y1c), P(c, lat, y0c), col)
          : b.quad(P(c, lat, y0c), P(c, lat, y1c), P(a, lat, y1a), P(a, lat, y0a), col));
        // the kerb (its top and its face)
        if (side > 0) up(lk, lw, ka, kc, ka, kc, C_TROUGH_KERB); else up(lw, lk, ka, kc, ka, kc, C_TROUGH_KERB);
        wall(lk, floorY(a, sa, lk) - 0.02, floorY(c, sc, lk) - 0.02, ka, kc, true, C_TROUGH_KERB);
        // the wall: its face from under the kerb to the top, the coping, the back down into the land it holds
        wall(lw, ya - 0.3, yc - 0.3, ta, tc, true, C_TROUGH_WALL);
        if (side > 0) up(lw, lo, ta, tc, ta, tc, C_COPING); else up(lo, lw, ta, tc, ta, tc, C_COPING);
        const [xa, , za] = P(a, side * (oh + 0.3), 0), [xc, , zc] = P(c, side * (oh + 0.3), 0);
        wall(lo, Math.min(heightAt(xa, za), ya) - WALL_FOOT, Math.min(heightAt(xc, zc), yc) - WALL_FOOT, ta, tc, false, C_TROUGH_WALL);
        // the flashing: where the land behind the wall lies over its top (a road the wall holds: its top stays under the road's edge), a strip rises from the coping's
        // back edge to just under that land - a ray over the coping met the land from below (the René Konen south trough beside Bd Roosevelt, the camera sweep, tunnels19)
        const lf = side * (oh + FLASH_WIDTH), [fxa, , fza] = P(a, lf, 0), [fxc, , fzc] = P(c, lf, 0);
        const fa = heightAt(fxa, fza) - FLASH_SINK, fc = heightAt(fxc, fzc) - FLASH_SINK;
        if (fa > ta || fc > tc) {
          if (side > 0) up(lo, lf, ta, tc, Math.max(ta, fa), Math.max(tc, fc), C_COPING); else up(lf, lo, Math.max(ta, fa), Math.max(tc, fc), ta, tc, C_COPING);
        }
      }
    }
    // the outer end: the end faces of the walls and the skirt of the floor (facing out of the trough)
    const sEnd = st[st.length - 1], e = frameAt(tube, sEnd);
    const face = (l0, l1, y0, y1, col) => (end < 0
      ? b.quad(P(e, l0, y0), P(e, l1, y0), P(e, l1, y1), P(e, l0, y1), col)
      : b.quad(P(e, l0, y1), P(e, l1, y1), P(e, l1, y0), P(e, l0, y0), col));
    for (const side of [-1, 1]) {
      const ih = side > 0 ? iR : iL, oh = side > 0 ? tube.outerR : tube.outerL, top = wallTopAt(tube, e.i, e.f, side * ih);
      if (!Number.isFinite(top)) continue;
      const foot = Math.min(floorY(e, sEnd, side * ih), floorY(e, sEnd, side * oh)) - WALL_FOOT;
      if (side > 0) face(ih, oh, foot, top, C_TROUGH_WALL); else face(-oh, -ih, foot, top, C_TROUGH_WALL);
    }
    // the apron: the floor reaches APRON m on under the terrain past the outer end (APRON_SINK under it) and hangs a skirt there, its top following the floor's
    // edge.  The mask's square end is square to the chord of its segment, the floor's to the tangent: on a bend the two differ by centimetres at the walls, and
    // the holes flow saw that sliver
    const o = frameAt(tube, sEnd + end * APRON);
    for (let j = 0; j < FLOOR_STRIPS; j++) {
      const l0 = -iL + ((iL + iR) * j) / FLOOR_STRIPS, l1 = -iL + ((iL + iR) * (j + 1)) / FLOOR_STRIPS;
      const y0 = floorY(e, sEnd, l0) - APRON_SINK, y1 = floorY(e, sEnd, l1) - APRON_SINK;
      const t0 = y0 + APRON_SINK, t1 = y1 + APRON_SINK;        // (and the skirt at the end itself, from the floor's edge down: on its very vertices - a gap of 5 mm let rays under the floor)
      if (end < 0) b.quad(P(e, l0, t0 - FLOOR_SKIRT), P(e, l1, t1 - FLOOR_SKIRT), P(e, l1, t1), P(e, l0, t0), C_TAR);
      else b.quad(P(e, l0, t0), P(e, l1, t1), P(e, l1, t1 - FLOOR_SKIRT), P(e, l0, t0 - FLOOR_SKIRT), C_TAR);
      if (end < 0) {
        b.quad(P(e, l1, y1), P(e, l0, y0), P(o, l0, y0), P(o, l1, y1), C_TAR);
        b.quad(P(o, l0, y0 - FLOOR_SKIRT), P(o, l1, y1 - FLOOR_SKIRT), P(o, l1, y1), P(o, l0, y0), C_TAR);
      } else {
        b.quad(P(o, l1, y1), P(o, l0, y0), P(e, l0, y0), P(e, l1, y1), C_TAR);
        b.quad(P(o, l0, y0), P(o, l1, y1), P(o, l1, y1 - FLOOR_SKIRT), P(o, l0, y0 - FLOOR_SKIRT), C_TAR);
      }
    }
    // the lane lines of the approach (solid edges, dashed lanes), from the face out to the end of the trough
    const len = end < 0 ? tube.troughA : tube.troughB, sFace = end < 0 ? tube.sA : tube.sB;
    for (const line of laneLines(road)) {
      const lat = line.offset * -end;          // (laneLines is to the right of the road's way; the trough's lat is to the right of s, outward is -s on end A)
      for (let d = 0; d < len - 0.05; d += line.dashed ? DASH_PERIOD : TROUGH_STEP) {
        const d1 = Math.min(len, d + (line.dashed ? DASH_LENGTH : TROUGH_STEP));
        const s0 = sFace + end * d, s1 = sFace + end * d1;
        const [sa, sc] = s0 < s1 ? [s0, s1] : [s1, s0];
        const a = frameAt(tube, sa), c = frameAt(tube, sc);
        const l0 = lat - PAINT_WIDTH / 2, l1 = lat + PAINT_WIDTH / 2;
        b.quad(P(a, l1, floorY(a, sa, l1) + PAINT_LIFT), P(c, l1, floorY(c, sc, l1) + PAINT_LIFT), P(c, l0, floorY(c, sc, l0) + PAINT_LIFT), P(a, l0, floorY(a, sa, l0) + PAINT_LIFT), C_PAINT);
      }
    }
  }
}

/**
 * tubes: tunnel-tubes.js tubes; heightAt: the drawn ground (surface.height); onRoad(x, z): on a drawn carriageway?  inside / outside: the two materials.
 * Returns { update(x, z, radius), meshes, count }.
 */
export function createTunnelView({ scene, tubes, heightAt, onRoad = null, insideMaterial, outsideMaterial }) {
  const parts = [];
  for (const tube of tubes) {
    const bi = new FlatBuilder(), bo = new FlatBuilder();
    buildInside(tube, bi, heightAt);
    buildOutside(tube, bo, heightAt, onRoad);
    buildTroughs(tube, bo, heightAt);
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
