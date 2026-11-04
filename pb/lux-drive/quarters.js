/* The quarters of Luxembourg and the villages of the commune of Niederanven: what a house looks like where it stands.
 *
 * The bake gives every building a style from its OSM tags and its height (house, apartment, office, ...).  That is right for the
 * kind of use but blind to the place: a six-floor block in the Gare quarter is a 19th-century stone building with a mansard roof
 * and shops below, and a 12 m block in Ernster is a village house, not a glass office.  This module reads the place of the
 * building from the named quarters of places.json and returns the style and the palette the façade should have there.
 *
 * Pure (no THREE): the browser, the harness and the bake checks all see the same decision.  Nothing is mutated:
 * `restyleBuildings` returns new building objects. */
import { STYLE, STYLE_SHOP, PALETTE } from './building-style.js';

/** The character of a place. */
export const CHARACTER = Object.freeze({
  sandstone: 'sandstone',       // Grund, Clausen, Pfaffenthal: ochre-cream sandstone and render, dark slate roofs
  city: 'city',                 // the 19th / early 20th-century town: stone façades, 4-6 floors, slate mansards, shops below
  village: 'village',           // 1-3 floor houses in render, tile roofs, shutters
  modern: 'modern',             // Kirchberg and the business parks: the bake's own style (glass, flat roofs)
});

/**
 * The places that decide the look: the name in places.json (landmarks), the character and the reach in metres.
 * A building belongs to the place whose middle it is closest to, in units of that place's reach, and only within the reach.
 * The reach is what a person calls "the quarter", not an administrative border: the old town sits on its rock about 700 m across.
 */
const PLACES = [
  // the valley quarters under the old town: sandstone, tight
  { name: 'Grund', character: CHARACTER.sandstone, reach: 420 },
  { name: 'Clausen', character: CHARACTER.sandstone, reach: 430 },
  { name: 'Pfaffenthal', character: CHARACTER.sandstone, reach: 430 },
  // the stone city of the 19th and early 20th century
  { name: 'Ville Haute', character: CHARACTER.city, reach: 650 },
  { name: 'Gare', character: CHARACTER.city, reach: 850 },
  { name: 'Limpertsberg', character: CHARACTER.city, reach: 950 },
  { name: 'Belair', character: CHARACTER.city, reach: 950 },
  { name: 'Bonnevoie', character: CHARACTER.city, reach: 800 },
  { name: 'Hollerich', character: CHARACTER.city, reach: 700 },
  { name: 'Rollingergrund', character: CHARACTER.city, reach: 500 },
  { name: 'Merl', character: CHARACTER.city, reach: 550 },
  { name: 'Rham', character: CHARACTER.sandstone, reach: 300 },
  { name: 'Bock', character: CHARACTER.city, reach: 300 },
  { name: 'Plateau Bourbon', character: CHARACTER.modern, reach: 450 },
  { name: 'Kirchberg', character: CHARACTER.modern, reach: 1400 },
  { name: 'Quartier Européen Nord', character: CHARACTER.modern, reach: 600 },
  { name: 'Quartier Européen Sud', character: CHARACTER.modern, reach: 600 },
  { name: 'Cloche d\'Or', character: CHARACTER.modern, reach: 900 },
  { name: 'Ban de Gasperich', character: CHARACTER.modern, reach: 700 },
  // the villages and the small quarters that are villages in everything but the name
  { name: 'Ernster', character: CHARACTER.village, reach: 650 },
  { name: 'Oberanven', character: CHARACTER.village, reach: 700 },
  { name: 'Niederanven', character: CHARACTER.village, reach: 800 },
  { name: 'Senningen', character: CHARACTER.village, reach: 650 },
  { name: 'Hostert', character: CHARACTER.village, reach: 600 },
  { name: 'Rameldange', character: CHARACTER.village, reach: 600 },
  { name: 'Senningerberg', character: CHARACTER.village, reach: 750 },
  { name: 'Cents', character: CHARACTER.village, reach: 500 },
  { name: 'Hamm', character: CHARACTER.village, reach: 500 },
  { name: 'Sandweiler', character: CHARACTER.village, reach: 700 },
  { name: 'Neuhaeusgen', character: CHARACTER.village, reach: 600 },
  { name: 'Munsbach', character: CHARACTER.village, reach: 600 },
  { name: 'Schrassig', character: CHARACTER.village, reach: 500 },
  { name: 'Dommeldange', character: CHARACTER.village, reach: 500 },
  { name: 'Walferdange', character: CHARACTER.village, reach: 600 },
  { name: 'Steinsel', character: CHARACTER.village, reach: 600 },
  { name: 'Heisdorf', character: CHARACTER.village, reach: 450 },
  { name: 'Weimerskirch', character: CHARACTER.village, reach: 450 },
];

/** Taller than this (m of eave) a building in a village is a tower or an industrial block: it keeps the bake's style. */
const TOWER_EAVE = 25;
/** The tallest eave of a village house: above this a block of flats keeps its apartment look (but in the village palette). */
const VILLAGE_HOUSE_EAVE = 10.5;
/** The tallest eave that a 19th-century stone façade has (up to about 8 storeys with a mansard, as on the Boulevard Royal); a taller one is a real tower. */
const CITY_STONE_EAVE = 38;
/** Where the bake says "shop" in a city quarter the shop stays; elsewhere in the old town this share of the stone buildings gets one. */
const CITY_SHOP_SHARE = 0.34;

/** A stable number out of the id of a building: the same building always gets the same decision. */
export function hash01(n) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * The places of the game, looked up by name in the landmarks of places.json.  A name that is not there is an error: the data and
 * this table must agree, a silent miss would turn a whole quarter into the default style.
 */
export function resolvePlaces(places) {
  const byName = new Map();
  for (const l of places.landmarks) if (!byName.has(l.name)) byName.set(l.name, l);
  return PLACES.map((p) => {
    const l = byName.get(p.name);
    if (!l) throw new Error(`quarters: "${p.name}" is not a landmark of places.json`);
    return { ...p, x: l.x, z: l.z };
  });
}

/** The place of a point: the character and the palette key, or null for the open default (the bake's own style). */
export function placeAt(resolved, x, z) {
  let best = null, bestD = 1;
  for (const p of resolved) {
    const d = Math.hypot(x - p.x, z - p.z) / p.reach;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/** The middle of a footprint. */
function middleOf(pts) {
  let cx = 0, cz = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) { cx += pts[i * 2]; cz += pts[i * 2 + 1]; }
  return [cx / n, cz / n];
}

/**
 * The style of one building in its place.
 * b: the decoded building; character: the character of the place (or null).
 * Returns { style (the byte with the shop bit), palette }.
 */
export function styleFor(b, character) {
  const base = b.style & 7;
  const shop = (b.style & STYLE_SHOP) !== 0;
  const seed = hash01(b.id * 31 + 5);
  const keep = { style: b.style, palette: PALETTE.plain };
  // the churches, the sheds and the real towers are what they are, everywhere
  if (base === STYLE.stone || base === STYLE.industrial) return { style: b.style, palette: character === CHARACTER.sandstone ? PALETTE.sandstone : PALETTE.plain };
  if (character === CHARACTER.modern || character === null) return keep;

  if (character === CHARACTER.village) {
    if (b.eave > TOWER_EAVE) return keep;
    // a village house: render, shutters, a tile roof.  A block of flats stays one, but in the render of the village.  A house that is
    // tall (a farm, a big old house) stays a house: the walls of a village are never glass bands or balcony rows.
    if (base === STYLE.house || b.eave <= VILLAGE_HOUSE_EAVE) return { style: STYLE.house | (shop ? STYLE_SHOP : 0), palette: PALETTE.village };
    return { style: STYLE.apartment | (shop ? STYLE_SHOP : 0), palette: PALETTE.village };
  }

  // the old town: low buildings are houses with shutters, the rest is the stone façade with tall windows
  const sand = character === CHARACTER.sandstone;
  const palette = sand ? PALETTE.sandstone : PALETTE.city;
  if (b.eave < 6.5) return { style: STYLE.house | (shop ? STYLE_SHOP : 0), palette };
  if (b.eave > CITY_STONE_EAVE) return { style: b.style, palette };
  const withShop = shop || (!sand && seed < CITY_SHOP_SHARE);
  return { style: STYLE.town | (withShop ? STYLE_SHOP : 0), palette };
}

/** The buildings of the world with the style of their place: new objects, the decoded ones are left alone. */
export function restyleBuildings(buildings, places) {
  const resolved = resolvePlaces(places);
  return buildings.map((b) => {
    const [cx, cz] = middleOf(b.pts);
    const place = placeAt(resolved, cx, cz);
    const { style, palette } = styleFor(b, place ? place.character : null);
    return { ...b, style, palette, place: place ? place.name : null };
  });
}
