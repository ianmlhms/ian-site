/* The painted colours of the landmarks (flat colours, no photo textures: the look of the whole game).
 * One place, so the Pont Adolphe and the Palais are the same sandstone. */
export const PALETTE = Object.freeze({
  sandstone: [0.80, 0.73, 0.58],        // the yellow-grey sandstone of the old town (Pont Adolphe, Palais, the Bock)
  sandstoneLight: [0.86, 0.80, 0.67],
  sandstoneDark: [0.66, 0.59, 0.46],
  limestone: [0.85, 0.83, 0.78],        // pale stone (Cathedral walls)
  concrete: [0.66, 0.66, 0.64],
  concreteDark: [0.50, 0.50, 0.50],
  asphalt: [0.31, 0.32, 0.35],
  paving: [0.72, 0.69, 0.62],
  line: [0.92, 0.92, 0.88],
  steelRed: [0.74, 0.13, 0.10],         // the Pont Rouge
  steelRedDark: [0.55, 0.09, 0.08],
  steelGrey: [0.52, 0.56, 0.60],
  steelDark: [0.24, 0.26, 0.29],
  white: [0.93, 0.93, 0.91],
  glassBlue: [0.40, 0.55, 0.64],
  glassDark: [0.22, 0.30, 0.36],
  bronze: [0.62, 0.45, 0.22],           // the gold-bronze of the Cour de justice
  bronzeDark: [0.45, 0.32, 0.15],
  gold: [0.92, 0.74, 0.25],             // the Gëlle Fra
  slate: [0.28, 0.30, 0.34],            // pitched roofs
  copperGreen: [0.45, 0.62, 0.55],      // the roofs of the Palais and the cathedral spires' crowns
  lampGreen: [0.17, 0.25, 0.20],
  lampLight: [0.98, 0.93, 0.72],
});
