/* The painted colours of the landmarks (flat colours, no photo textures: the look of the whole game).
 * One place, so the Pont Adolphe and the Palais are the same sandstone. */
export const PALETTE = Object.freeze({
  sandstone: [0.80, 0.73, 0.58],        // the yellow-grey sandstone of the old town (Pont Adolphe, Palais, the Bock)
  sandstoneLight: [0.86, 0.80, 0.67],
  sandstoneDark: [0.66, 0.59, 0.46],
  bridgeStone: [0.64, 0.58, 0.47],      // the grey-tan sandstone of the Pont Adolphe (the photographs: greyer and darker than the town sandstone)
  bridgeStoneLight: [0.73, 0.68, 0.57],
  bridgeStoneDark: [0.50, 0.45, 0.36],
  granite: [0.56, 0.40, 0.36],          // the pink-brown granite of the Gëlle Fra
  graniteLight: [0.62, 0.46, 0.41],
  patina: [0.30, 0.50, 0.42],           // green bronze (the figures at the foot of the Gëlle Fra)
  rockOchre: [0.72, 0.58, 0.36],        // the sandstone of the Bock: ochre ...
  rockGrey: [0.55, 0.52, 0.46],         // ... and grey, in bands
  fortWall: [0.40, 0.42, 0.45],         // the blue-grey masonry of the fortress walls
  ivory: [0.88, 0.86, 0.79],            // the limestone of the Mudam
  glassTeal: [0.30, 0.50, 0.52],        // teal-green glass (Mudam, Coque)
  roofDark: [0.17, 0.18, 0.20],         // the dark zinc roof of the Coque
  fortFoot: [0.50, 0.46, 0.40],         // the dark weathered foot of the fort towers
  towerStone: [0.62, 0.57, 0.47],       // the grey-tan stone of the BCEE tower
  clockFace: [0.86, 0.72, 0.32],        // gilded clock faces
  limestone: [0.85, 0.83, 0.78],        // pale stone (Cathedral walls)
  concrete: [0.66, 0.66, 0.64],
  concreteDark: [0.50, 0.50, 0.50],
  asphalt: [0.31, 0.32, 0.35],
  paving: [0.72, 0.69, 0.62],
  line: [0.92, 0.92, 0.88],
  steelRed: [0.66, 0.17, 0.15],         // the Pont Rouge (the photographs: a dull wine red, not a signal red)
  steelRedDark: [0.46, 0.11, 0.11],
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
  stoneWarm: [0.82, 0.78, 0.62],        // the pale yellow-grey sandstone of the cathedral and the palace
  stoneBand: [0.58, 0.54, 0.44],        // the darker courses of the palace
  palaisStone: [0.80, 0.70, 0.50],      // the ochre ashlar of the Palais grand-ducal
  cathedralStone: [0.72, 0.66, 0.52],  // the tan sandstone of the cathedral (the photographs: darker and greyer than the palace)
  slateRoof: [0.34, 0.37, 0.44],        // the blue-grey slate of the steep roofs
  slateBlack: [0.15, 0.16, 0.19],       // the cathedral's spires: dark slate, almost black
  slateGrey: [0.30, 0.32, 0.36],
  drumGrey: [0.34, 0.37, 0.39],         // the building behind the colonnade of the Philharmonie
  anodised: [0.50, 0.36, 0.17],         // the bronze fins of the Cour de justice towers
  anodisedDark: [0.30, 0.21, 0.10],
  blackGlass: [0.09, 0.08, 0.08],       // the podium of the Cour de justice
  paleGlass: [0.62, 0.66, 0.67],        // the barely visible drum of the Philharmonie
  lampGreen: [0.17, 0.25, 0.20],
  lampLight: [0.98, 0.93, 0.72],
});
