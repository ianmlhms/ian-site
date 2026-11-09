/* car20: the three cars of Lux Drive (Ian picks one; the others stay selectable with ?car=<id>).
 *
 * Pure data, no THREE: car-model.js builds every design with the same code (one loft for the body, real wheel arches cut into
 * it, glass with a sky gradient, lamps that lie on the body, four wheels with spokes, a soft contact shadow) and the same
 * draw calls (body, 4 wheels, 3 lamp meshes, the shadow).
 *
 * The local frame of a design: +x is the front, +y is up, +z is the right hand side, the ground is y = 0.
 * A station is one cross section of the loft:
 *   x, yb (the floor), ym (the shoulder, the widest point), ys (the belt line), yr (the edge of the roof / bonnet),
 *   wb, ww, ws, wr (the half widths at the sill, the shoulder, the belt and the roof edge), crown (how far the middle of the
 *   roof / bonnet bulges over its edge).
 * Lamps and decals are polygons of [y, z] points on the right hand half (mirrored to the left unless mirror: false), laid on
 * the front ('front') or the rear ('back') of the body: car-model.js finds the body surface behind each point. */

/** The colours of the trim (display space, 0..1). `body` is the paint the player chose. */
export const TRIM = Object.freeze({
  black: [0.07, 0.07, 0.08], plastic: [0.13, 0.13, 0.14], liner: [0.05, 0.05, 0.055], chrome: [0.74, 0.76, 0.8], silver: [0.62, 0.64, 0.68],
  plate: [0.96, 0.8, 0.12],            // Luxembourg number plates are yellow
  eu: [0.12, 0.22, 0.62], pipe: [0.34, 0.35, 0.38], red: [0.84, 0.13, 0.15], skyblue: [0.36, 0.67, 0.88], white: [0.95, 0.95, 0.93],
  bezel: [0.09, 0.1, 0.12], glassLow: [0.09, 0.12, 0.16], glassHigh: [0.38, 0.46, 0.55], signText: [0.08, 0.08, 0.1],
});

const plate = (end, y, hw, hh) => [
  { end, colour: 'plate', pts: [[y - hh, -hw], [y - hh, hw], [y + hh, hw], [y + hh, -hw]], mirror: false, lift: 0.012 },
  { end, colour: 'eu', pts: [[y - hh, -hw], [y - hh, -hw + 0.055], [y + hh, -hw + 0.055], [y + hh, -hw]], mirror: false, lift: 0.016 },
];

/* 1. The hatchback: a modern compact (Golf / Mégane size), 4.30 x 1.80 x 1.45 m, black pillars (a floating roof), black
 *    cladding over the sills, slim lamps with an LED strip, silver five-spoke wheels. */
const HATCH = {
  id: 'hatch', name: 'Hatchback', defaultColour: 'blue',
  stations: [
    //  x      yb    ym    ys    yr    wb    ww    ws    wr   crown
    [2.17, 0.34, 0.50, 0.66, 0.69, 0.56, 0.68, 0.64, 0.48, 0.02],    // the nose
    [2.10, 0.23, 0.50, 0.74, 0.79, 0.74, 0.86, 0.82, 0.64, 0.03],    // the bumper corner, the lip of the bonnet
    [1.72, 0.22, 0.54, 0.84, 0.89, 0.80, 0.90, 0.88, 0.73, 0.05],    // the bonnet
    [0.98, 0.22, 0.58, 0.93, 0.97, 0.81, 0.90, 0.88, 0.76, 0.06],    // the cowl: the foot of the windscreen
    [-0.10, 0.22, 0.58, 0.97, 1.44, 0.81, 0.90, 0.85, 0.63, 0.035],  // the front of the roof
    [-1.10, 0.22, 0.60, 1.00, 1.45, 0.81, 0.91, 0.85, 0.62, 0.035],  // the middle of the roof
    [-1.74, 0.22, 0.62, 1.04, 1.41, 0.81, 0.91, 0.84, 0.61, 0.03],   // the back of the roof (the spoiler)
    [-1.98, 0.22, 0.66, 1.06, 1.12, 0.78, 0.89, 0.80, 0.69, 0.02],   // the foot of the tailgate window
    [-2.09, 0.26, 0.64, 1.00, 1.05, 0.73, 0.85, 0.75, 0.64, 0.02],   // the tail
    [-2.13, 0.36, 0.58, 0.90, 0.94, 0.62, 0.76, 0.66, 0.54, 0.01],   // the rear face
  ],
  windscreen: [0.98, -0.10], rearWindow: [-1.74, -1.98],
  sideGlass: [[0.80, -0.40], [-0.58, -1.60]],
  pillars: 'black', roof: 'body', sill: 'black',
  doorLines: [0.82, -0.47, -0.52, -1.52], handles: [-0.05, -1.05],
  wheel: { r: 0.355, halfWidth: 0.105, x: [1.30, -1.32], z: 0.775, spokes: 5, rim: 'silver', archGap: 0.055 },
  mirror: { x: 0.74, y: 1.02 },
  lamps: {
    head: [{ end: 'front', pts: [[0.62, 0.40], [0.64, 0.70], [0.70, 0.80], [0.75, 0.74], [0.72, 0.42]] }],
    drl: [{ end: 'front', pts: [[0.61, 0.38], [0.61, 0.66], [0.625, 0.66], [0.625, 0.38]] }],
    tail: [{ end: 'back', pts: [[0.86, 0.46], [0.84, 0.74], [0.96, 0.80], [0.97, 0.52]] }],
    reverse: [{ end: 'back', pts: [[0.78, 0.50], [0.78, 0.64], [0.82, 0.64], [0.82, 0.50]] }],
  },
  decals: [
    { end: 'front', colour: 'black', pts: [[0.56, 0], [0.56, 0.34], [0.62, 0.38], [0.66, 0.36], [0.66, 0]] },              // the upper grille
    { end: 'front', colour: 'black', pts: [[0.28, 0], [0.28, 0.44], [0.44, 0.48], [0.47, 0.30], [0.43, 0]] },              // the intake
    { end: 'front', colour: 'black', pts: [[0.30, 0.52], [0.30, 0.64], [0.40, 0.62], [0.40, 0.54]] },                       // the fog lamp pocket
    ...plate('front', 0.39, 0.25, 0.055),
    { end: 'back', colour: 'black', pts: [[0.30, 0], [0.30, 0.62], [0.42, 0.62], [0.42, 0]] },                           // the diffuser
    ...plate('back', 0.66, 0.25, 0.06),
  ],
  boxes: [
    { c: [-1.80, 1.425, 0], h: [0.07, 0.018, 0.52], colour: 'body' },                                                    // the roof spoiler
    { c: [-2.12, 0.33, 0.42], h: [0.04, 0.03, 0.05], colour: 'chrome', mirror: true },                                    // the tail pipes
  ],
  stripes: [],
  roofRails: false, sign: null,
};

/* 2. The coupé: a low sports car, 4.42 x 1.92 x 1.28 m, long bonnet, fastback glass, wide hips over the rear wheels, a front
 *    splitter, side skirts, a light bar across the tail, dark spoked wheels. */
const COUPE = {
  id: 'coupe', name: 'Coupé', defaultColour: 'red',
  stations: [
    //  x      yb    ym    ys    yr    wb    ww    ws    wr   crown
    [2.22, 0.27, 0.38, 0.50, 0.53, 0.50, 0.62, 0.58, 0.42, 0.03],    // the nose (low)
    [2.15, 0.17, 0.40, 0.58, 0.62, 0.74, 0.86, 0.82, 0.62, 0.04],    // the bumper corner
    [1.86, 0.15, 0.45, 0.68, 0.72, 0.83, 0.94, 0.89, 0.68, 0.02],    // the front wing
    [1.42, 0.15, 0.50, 0.75, 0.78, 0.84, 0.95, 0.89, 0.66, -0.01],   // the top of the front wing (the bonnet lies lower between the wings)
    [0.72, 0.15, 0.52, 0.80, 0.83, 0.83, 0.92, 0.86, 0.68, 0.02],    // the cowl
    [-0.30, 0.15, 0.53, 0.86, 1.22, 0.83, 0.92, 0.82, 0.56, 0.04],   // the front of the roof
    [-0.70, 0.15, 0.54, 0.88, 1.23, 0.85, 0.94, 0.83, 0.55, 0.04],   // the middle of the roof
    [-1.20, 0.15, 0.56, 0.90, 1.11, 0.88, 0.97, 0.89, 0.58, 0.04],   // the hips over the rear wheel (the fastback glass falls)
    [-1.82, 0.17, 0.60, 0.90, 0.95, 0.85, 0.95, 0.87, 0.66, 0.03],   // the deck lid
    [-2.08, 0.23, 0.60, 0.89, 0.93, 0.78, 0.89, 0.81, 0.62, 0.02],   // the ducktail
    [-2.17, 0.32, 0.56, 0.83, 0.87, 0.64, 0.76, 0.68, 0.52, 0.01],   // the rear face
  ],
  windscreen: [0.72, -0.30], rearWindow: [-0.70, -1.82],
  sideGlass: [[0.58, -1.06]],
  pillars: 'body', roof: 'black', sill: 'body',
  doorLines: [0.62, -0.78], handles: [-0.55],
  wheel: { r: 0.355, halfWidth: 0.12, x: [1.42, -1.20], z: 0.81, spokes: 10, rim: 'dark', archGap: 0.045 },
  mirror: { x: 0.52, y: 0.9 },
  lamps: {
    head: [{ end: 'front', pts: [[0.50, 0.40], [0.54, 0.74], [0.62, 0.86], [0.66, 0.80], [0.60, 0.44]] }],
    drl: [{ end: 'front', pts: [[0.475, 0.38], [0.51, 0.76], [0.525, 0.76], [0.49, 0.38]] }],
    tail: [{ end: 'back', pts: [[0.755, -0.72], [0.755, 0.72], [0.79, 0.72], [0.79, -0.72]], mirror: false },            // the light bar across the tail
      { end: 'back', pts: [[0.69, 0.44], [0.69, 0.72], [0.74, 0.79], [0.83, 0.79], [0.83, 0.44]] }],                       // the lamp clusters at the corners
    reverse: [{ end: 'back', pts: [[0.635, 0.50], [0.635, 0.64], [0.665, 0.64], [0.665, 0.50]] }],
  },
  decals: [
    { end: 'front', colour: 'black', pts: [[0.24, 0], [0.24, 0.50], [0.40, 0.54], [0.44, 0.30], [0.42, 0]] },              // the big intake
    { end: 'front', colour: 'black', pts: [[0.26, 0.56], [0.24, 0.70], [0.38, 0.68], [0.40, 0.58]] },                      // the brake duct
    ...plate('front', 0.36, 0.24, 0.05),
    { end: 'back', colour: 'black', pts: [[0.30, 0], [0.30, 0.66], [0.46, 0.62], [0.46, 0]] },                           // the diffuser
    ...plate('back', 0.62, 0.24, 0.055),
  ],
  boxes: [
    { c: [2.10, 0.15, 0], h: [0.12, 0.012, 0.74], colour: 'black' },                                                      // the splitter
    { c: [0.12, 0.17, 0.89], h: [0.98, 0.03, 0.03], colour: 'black', mirror: true },                                      // the side skirts
    { c: [-2.02, 0.955, 0], h: [0.12, 0.014, 0.62], colour: 'black' },                                                    // the ducktail lip
    { c: [-2.15, 0.30, 0.30], h: [0.03, 0.03, 0.04], colour: 'pipe', mirror: true },                                      // the tail pipes
    { c: [-2.15, 0.30, 0.41], h: [0.03, 0.03, 0.04], colour: 'pipe', mirror: true },
  ],
  stripes: [],
  roofRails: false, sign: null,
};

/* 3. The Lëtzebuerger taxi: a long estate in white with the colours of the flag along its flanks (red, white, sky blue),
 *    yellow plates, roof rails and the lit TAXI sign on the roof, silver ten-spoke wheels. */
const TAXI = {
  id: 'taxi', name: 'Taxi', defaultColour: 'white',
  stations: [
    //  x      yb    ym    ys    yr    wb    ww    ws    wr   crown
    [2.28, 0.33, 0.50, 0.66, 0.70, 0.57, 0.69, 0.65, 0.49, 0.02],    // the nose
    [2.20, 0.22, 0.50, 0.74, 0.79, 0.74, 0.86, 0.82, 0.64, 0.03],    // the bumper corner
    [1.80, 0.21, 0.54, 0.84, 0.89, 0.80, 0.90, 0.88, 0.73, 0.05],    // the bonnet
    [1.06, 0.21, 0.58, 0.93, 0.97, 0.81, 0.91, 0.88, 0.76, 0.06],    // the cowl
    [0.04, 0.21, 0.58, 0.97, 1.46, 0.81, 0.91, 0.86, 0.66, 0.03],    // the front of the roof
    [-1.40, 0.21, 0.60, 1.00, 1.47, 0.81, 0.91, 0.86, 0.66, 0.03],   // the long roof
    [-2.14, 0.21, 0.62, 1.02, 1.44, 0.81, 0.91, 0.85, 0.64, 0.03],   // the back of the roof
    [-2.28, 0.21, 0.64, 1.02, 1.17, 0.78, 0.89, 0.82, 0.68, 0.02],   // the foot of the tailgate window (an upright estate tail)
    [-2.34, 0.26, 0.62, 0.98, 1.05, 0.73, 0.85, 0.76, 0.62, 0.02],   // the tail
    [-2.37, 0.36, 0.58, 0.90, 0.94, 0.62, 0.76, 0.66, 0.54, 0.01],   // the rear face
  ],
  windscreen: [1.06, 0.04], rearWindow: [-2.14, -2.28],
  sideGlass: [[0.86, -0.34], [-0.50, -1.50], [-1.62, -2.10]],
  pillars: 'black', roof: 'body', sill: 'black',
  doorLines: [0.88, -0.40, -0.44, -1.52], handles: [0.02, -1.0],
  wheel: { r: 0.345, halfWidth: 0.105, x: [1.40, -1.22], z: 0.775, spokes: 10, rim: 'silver', archGap: 0.06 },
  mirror: { x: 0.82, y: 1.02 },
  lamps: {
    head: [{ end: 'front', pts: [[0.62, 0.42], [0.62, 0.72], [0.70, 0.80], [0.76, 0.72], [0.74, 0.42]] }],
    drl: [{ end: 'front', pts: [[0.765, 0.44], [0.765, 0.70], [0.78, 0.70], [0.78, 0.44]] }],
    tail: [{ end: 'back', pts: [[0.80, 0.56], [0.80, 0.76], [1.00, 0.78], [1.00, 0.58]] }],
    reverse: [{ end: 'back', pts: [[0.74, 0.58], [0.74, 0.70], [0.785, 0.70], [0.785, 0.58]] }],
  },
  decals: [
    { end: 'front', colour: 'chrome', pts: [[0.55, 0], [0.55, 0.34], [0.66, 0.38], [0.68, 0]] },                         // the grille (chrome frame)
    { end: 'front', colour: 'black', pts: [[0.57, 0], [0.57, 0.31], [0.65, 0.34], [0.66, 0]], lift: 0.014 },
    { end: 'front', colour: 'black', pts: [[0.28, 0], [0.28, 0.40], [0.42, 0.44], [0.44, 0]] },                           // the intake
    ...plate('front', 0.37, 0.25, 0.055),
    { end: 'back', colour: 'black', pts: [[0.32, 0], [0.32, 0.64], [0.44, 0.64], [0.44, 0]] },
    ...plate('back', 0.66, 0.25, 0.06),
  ],
  boxes: [
    { c: [-2.36, 0.33, 0.42], h: [0.03, 0.03, 0.045], colour: 'chrome', mirror: true },
  ],
  // the flag along the flanks: red over the white paint over sky blue (y0, y1, from x0 to x1)
  stripes: [
    { y0: 0.80, y1: 0.85, x0: 1.78, x1: -2.22, colour: 'red' },
    { y0: 0.70, y1: 0.75, x0: 1.80, x1: -2.22, colour: 'skyblue' },
  ],
  roofRails: true,
  sign: { x: 0.10, w: 0.56, d: 0.16, h: 0.15, text: 'TAXI' },
};

export const CAR_DESIGNS = Object.freeze({ hatch: HATCH, coupe: COUPE, taxi: TAXI });
export const CAR_DESIGN_IDS = Object.freeze(Object.keys(CAR_DESIGNS));
/** The car of the game: Ian picked the coupé (9 Nov 2026); the others stay selectable with ?car=<id>. */
export const DEFAULT_CAR_DESIGN = 'coupe';
