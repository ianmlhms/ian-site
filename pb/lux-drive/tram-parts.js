/* The parts of the Luxtram, drawn in the painted low-poly look (CAF Urbos style): the sections of the vehicle, a catenary pole,
 * a stop shelter.  A section is modelled in its own frame: +x forward, +y up (y = 0 is the head of the rail), +z to the right.
 * Pure geometry on a PartBuilder: the view wraps it, the Node probes can count its faces. */
import { TRAM } from './config.js';

/* The livery of the Luxtram (CAF Urbos 100), after the photographs: a silver-grey body, a long band of dark glass (the windows and the
 * doors together), a dark mask round the windscreen, and the Luxtram turquoise on the chin of the nose and as a thin stripe low on the side. */
const WHITE = [0.79, 0.82, 0.83], GREY_LOW = [0.63, 0.66, 0.68], GLASS = [0.10, 0.16, 0.22], ROOF = [0.72, 0.76, 0.78], DOOR_GLASS = [0.07, 0.12, 0.18];
const ROOF_BOX = [0.50, 0.54, 0.57], DARK = [0.16, 0.17, 0.19], TURQUOISE = [0.04, 0.60, 0.68], TURQ_DARK = [0.03, 0.46, 0.54];
const LAMP = [1.0, 0.95, 0.75], PAN = [0.2, 0.21, 0.23];
const FLOOR = 0.40;                          // m: the underside of the body above the rail (the vehicle is low-floor)

/** The cross section of the body at the full width: [z, y] pairs, going round (the lower edge, the right side up, the roof, the left side down). */
function hullSection(w, h, scale = 1) {
  const hw = (w / 2) * scale;
  return [[-hw, FLOOR], [hw, FLOOR], [hw, h - 0.55], [hw * 0.74, h], [-hw * 0.74, h], [-hw, h - 0.55]];
}

/** The side walls of a stretch of the hull between x0 and x1: the lower body, the window band with its pillars, the upper band. */
function sideWalls(b, x0, x1, w, h, doors) {
  const hw = w / 2;
  const inside = [(x0 + x1) / 2, 1.8, 0];
  for (const side of [-1, 1]) {
    const z = side * hw;
    // lower body, window band, upper band: three quads each
    b.quad([x0, FLOOR, z], [x1, FLOOR, z], [x1, 1.05, z], [x0, 1.05, z], GREY_LOW, 0, inside);
    b.quad([x0, 1.05, z], [x1, 1.05, z], [x1, 2.55, z], [x0, 2.55, z], GLASS, 1, inside);
    b.quad([x0, 2.55, z], [x1, 2.55, z], [x1, h - 0.55, z], [x0, h - 0.55, z], WHITE, 0, inside);
    // the pillars between the windows
    const n = Math.max(1, Math.round((x1 - x0) / 1.45));
    for (let i = 0; i <= n; i++) {
      const px = x0 + ((x1 - x0) * i) / n;
      b.box(px - 0.06, px + 0.06, 1.05, 2.55, z - 0.015 * side - 0.0, z + 0.03 * side, WHITE);
    }
    // the doors: two wide leaves of dark glass in a silver frame (the real doors are glazed: from outside they are windows that open)
    for (const dx of doors) {
      b.box(dx - 0.64, dx + 0.64, 0.48, 2.52, side > 0 ? z : z - 0.05, side > 0 ? z + 0.05 : z, WHITE);
      b.box(dx - 0.56, dx + 0.56, 0.62, 2.45, side > 0 ? z + 0.04 : z - 0.06, side > 0 ? z + 0.06 : z - 0.04, DOOR_GLASS, 1);
      b.box(dx - 0.015, dx + 0.015, 0.62, 2.45, side > 0 ? z + 0.05 : z - 0.07, side > 0 ? z + 0.07 : z - 0.05, WHITE);
    }
    // the turquoise stripe along the foot of the side
    b.quad([x0, 0.80, z + side * 0.004], [x1, 0.80, z + side * 0.004], [x1, 0.97, z + side * 0.004], [x0, 0.97, z + side * 0.004], TURQUOISE, 0, inside);
  }
}

/** The roof of a stretch of the hull: the two slopes and the flat top. */
function roof(b, x0, x1, w, h) {
  const hw = w / 2, inside = [(x0 + x1) / 2, h - 0.3, 0];
  for (const side of [-1, 1]) {
    b.quad([x0, h - 0.55, side * hw], [x1, h - 0.55, side * hw], [x1, h, side * hw * 0.74], [x0, h, side * hw * 0.74], ROOF, 0, inside);
  }
  b.quad([x0, h, -hw * 0.74], [x1, h, -hw * 0.74], [x1, h, hw * 0.74], [x0, h, hw * 0.74], ROOF, 0, inside);
  // the underside (nobody sees it, but a hole under the vehicle would show the sky through it)
  b.quad([x0, FLOOR, -hw], [x1, FLOOR, -hw], [x1, FLOOR, hw], [x0, FLOOR, hw], DARK, 0, inside);
}

/** The plain end of a section (where the next section's bellows joins): a dark cap, and the bellows reaching into the gap. */
function joint(b, x, dir, w, h) {
  const hw = w / 2;
  const inside = [x - dir * 0.2, 1.8, 0];
  const ring = hullSection(w, h);
  b.quad([x, ring[0][1], ring[0][0]], [x, ring[1][1], ring[1][0]], [x, ring[2][1], ring[2][0]], [x, ring[3][1], ring[3][0]], DARK, 0, inside);
  b.quad([x, ring[0][1], ring[0][0]], [x, ring[3][1], ring[3][0]], [x, ring[4][1], ring[4][0]], [x, ring[5][1], ring[5][0]], DARK, 0, inside);
  // the bellows: a dark box narrower than the body, reaching 0.3 m into the gap
  b.box(Math.min(x, x + dir * 0.3), Math.max(x, x + dir * 0.3), FLOOR + 0.12, h - 0.7, -hw + 0.18, hw - 0.18, DARK);
}

/** A middle section; `pantograph` puts the pantograph (and its box) on the roof. */
export function buildMiddleSection(b, { pantograph = false } = {}) {
  const L = TRAM.sectionLength, w = TRAM.width, h = TRAM.height;
  const x0 = -L / 2, x1 = L / 2;
  sideWalls(b, x0, x1, w, h, [-2.3, 2.3]);
  roof(b, x0, x1, w, h);
  joint(b, x0, -1, w, h); joint(b, x1, 1, w, h);
  // the air conditioning on the roof
  b.box(-2.6, -0.4, h, h + 0.28, -0.75, 0.75, ROOF_BOX);
  if (pantograph) {
    b.box(0.6, 2.1, h, h + 0.22, -0.7, 0.7, ROOF_BOX);
    // the pantograph: a low frame and the collector strip under the wire
    b.box(1.0, 1.2, h + 0.22, h + 1.7, -0.5, -0.42, PAN); b.box(1.0, 1.2, h + 0.22, h + 1.7, 0.42, 0.5, PAN);
    b.box(0.85, 1.35, h + 1.7, h + 1.82, -0.9, 0.9, PAN);
  }
}

/** An end section: the same body, and the nose (turquoise, with the windscreen and the lights) at +x. */
export function buildEndSection(b) {
  const L = TRAM.sectionLength, w = TRAM.width, h = TRAM.height;
  const x0 = -L / 2, xn = L / 2 - 1.5, x1 = L / 2;
  sideWalls(b, x0, xn, w, h, [-1.5, 1.6]);
  roof(b, x0, xn, w, h);
  joint(b, x0, -1, w, h);
  // the nose: the hull tapers over 1.5 m to a narrow face
  const A = hullSection(w, h);
  const B = [[-0.93, FLOOR + 0.1], [0.93, FLOOR + 0.1], [0.98, 2.05], [0.78, 3.0], [-0.78, 3.0], [-0.98, 2.05]];
  const inside = [(xn + x1) / 2, 1.8, 0];
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    const colour = i === 3 ? ROOF : i === 0 ? TURQUOISE : WHITE;
    b.quad([xn, A[i][1], A[i][0]], [xn, A[j][1], A[j][0]], [x1, B[j][1], B[j][0]], [x1, B[i][1], B[i][0]], colour, 0, inside);
  }
  // the front face: turquoise below the belt line, the dark windscreen above, a lamp in each lower corner
  b.quad([x1, B[0][1], B[0][0]], [x1, B[1][1], B[1][0]], [x1, 1.25, 0.96], [x1, 1.25, -0.96], TURQUOISE, 0, inside);
  b.quad([x1, 1.25, -0.96], [x1, 1.25, 0.96], [x1, 3.0, 0.78], [x1, 3.0, -0.78], GLASS, 0.4, inside);
  b.box(x1 - 0.03, x1 + 0.05, 0.62, 0.8, 0.45, 0.8, LAMP, 1); b.box(x1 - 0.03, x1 + 0.05, 0.62, 0.8, -0.8, -0.45, LAMP, 1);
  // the destination board over the windscreen
  b.box(x1 - 0.1, x1 + 0.02, 3.05, 3.3, -0.6, 0.6, [0.9, 0.55, 0.12], 1);
  // the side windows of the cab (a dark panel on the tapered side)
  for (const side of [-1, 1]) b.quad([xn + 0.1, 1.2, side * (w / 2 - 0.01)], [x1 - 0.5, 1.25, side * 0.97], [x1 - 0.5, 2.55, side * 0.8], [xn + 0.1, 2.55, side * (w / 2 - 0.01) * 0.98], GLASS, 1, inside);
  // the roof of the cab, and the air conditioning behind it
  b.box(-3.0, -1.0, h, h + 0.28, -0.75, 0.75, ROOF_BOX);
}

/** A catenary pole at the origin, the arm reaching towards +z (the track is on the +z side).  Heights are above the rail head. */
export function buildPole(b, { height = TRAM.catenary.height + 0.9, arm = TRAM.catenary.arm } = {}) {
  const COL = [0.34, 0.37, 0.39], INS = [0.7, 0.72, 0.7];
  b.box(-0.09, 0.09, -0.4, height, -0.09, 0.09, COL);                 // the pole (the foot is under the ground)
  b.box(-0.2, 0.2, -0.45, 0.35, -0.2, 0.2, [0.45, 0.46, 0.45]);          // the concrete foot
  b.box(-0.04, 0.04, height - 0.5, height - 0.42, 0.0, arm, COL);       // the arm
  b.box(-0.03, 0.03, height - 0.92, height - 0.5, arm - 0.06, arm + 0.02, INS);   // the insulator and the clamp for the wire
}

/** A stop shelter: a glass-and-steel canopy over the platform, open to the track, with the stop sign. Origin = the middle of the platform edge line,
 *  +z towards the back of the platform.  Heights are above the platform. */
export function buildShelter(b) {
  const STEEL = [0.32, 0.35, 0.37], GL = [0.62, 0.78, 0.82], SIGN = [0.05, 0.38, 0.62];
  for (const x of [-3.2, 3.2]) { b.box(x - 0.05, x + 0.05, 0, 2.7, 1.1, 1.2, STEEL); b.box(x - 0.05, x + 0.05, 0, 2.7, 2.2, 2.3, STEEL); }
  b.box(-3.5, 3.5, 2.7, 2.78, 0.9, 2.5, [0.86, 0.9, 0.9]);               // the roof
  b.box(-3.2, 3.2, 0.5, 2.1, 2.3, 2.34, GL, 0.5);                       // the glass back wall
  b.box(-1.6, 1.6, 0.45, 0.52, 1.5, 2.1, [0.5, 0.36, 0.22]);            // the bench
  b.box(-0.04, 0.04, 0, 2.9, 0.4, 0.48, STEEL);                          // the post of the stop sign
  b.box(-0.45, 0.45, 2.3, 3.2, 0.34, 0.4, SIGN, 0.3);                    // the sign: Luxtram blue
}
