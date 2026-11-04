/* The façade styles and the colour palettes of the buildings, shared by the place rules (quarters.js), the mesh
 * (building-mesh.js) and the shader (building-material.js, which reads the numbers of STYLE).  Pure (no THREE). */

/**
 * The style of a building: what its façade is made of.  The bake reads it from the OSM (the function of the building) and from
 * its height; quarters.js then adjusts it to the place (a block in the old town is a stone façade, not a glass band).
 * `town` is the 19th / early 20th-century stone façade: tall windows with stone frames, a cornice, shops below.
 */
export const STYLE = Object.freeze({ house: 0, apartment: 1, office: 2, industrial: 3, modern: 4, stone: 5, town: 6 });
export const STYLE_SHOP = 8;              // a bit of the style byte: the ground floor is a shop

/** The palette keys: which family of wall and roof colours a building takes. */
export const PALETTE = Object.freeze({ plain: 'plain', city: 'city', sandstone: 'sandstone', village: 'village' });

/** The walls of the houses of the bake's own style: cream, ochre, white, pink, pale green, blue grey, beige. */
export const WALLS = [
  [0.93, 0.90, 0.80], [0.88, 0.80, 0.62], [0.95, 0.95, 0.92], [0.86, 0.74, 0.64],
  [0.82, 0.86, 0.80], [0.80, 0.82, 0.84], [0.90, 0.84, 0.70],
];
/** The walls of the blocks of flats: the same render, but plainer and greyer than the houses. */
export const BLOCKS = [
  [0.86, 0.85, 0.80], [0.84, 0.79, 0.70], [0.88, 0.87, 0.84], [0.78, 0.78, 0.76],
  [0.83, 0.80, 0.73], [0.80, 0.82, 0.81],
];
/** The stone city: cream, ochre, light grey, pale yellow, warm grey (the Gare, the Ville Haute, Limpertsberg, Belair). */
export const CITY_WALLS = [
  [0.93, 0.89, 0.77], [0.88, 0.78, 0.58], [0.82, 0.81, 0.78], [0.92, 0.86, 0.66], [0.86, 0.82, 0.74], [0.90, 0.84, 0.70],
];
/** The sandstone of the valley quarters (Grund, Clausen, Pfaffenthal): ochre-cream, a darker honey, the odd pink render. */
export const SANDSTONE_WALLS = [
  [0.88, 0.74, 0.52], [0.92, 0.80, 0.60], [0.84, 0.68, 0.48], [0.94, 0.86, 0.70], [0.88, 0.76, 0.62], [0.80, 0.70, 0.56],
];
/** The village render: cream, ochre, pale grey, white, the odd pastel. */
export const VILLAGE_WALLS = [
  [0.94, 0.90, 0.78], [0.90, 0.80, 0.60], [0.93, 0.89, 0.80], [0.96, 0.96, 0.93], [0.92, 0.84, 0.70], [0.88, 0.80, 0.74], [0.84, 0.88, 0.82],
];

export const SLATE = [0.24, 0.27, 0.33];         // the roof of a house: slate
export const DARK_SLATE = [0.19, 0.21, 0.26];    // the mansards of the stone city
export const TILE = [0.58, 0.28, 0.20];          // the red tile
export const DARK_TILE = [0.34, 0.2, 0.18];      // the brown-red tile of the older villages
export const OFFICE = [0.72, 0.76, 0.80];        // the glass towers of Kirchberg
export const MODERN = [0.80, 0.82, 0.84];        // the pale stone of a modern façade
export const INDUSTRIAL = [0.70, 0.70, 0.68];    // the sheds of the industrial belt
export const LIMESTONE = [0.84, 0.79, 0.68];     // the dressed stone of the churches
export const TAR = [0.22, 0.22, 0.24];           // the flat roof
