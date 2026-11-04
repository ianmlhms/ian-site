/* The Forum Geesseknäppchen (photo Luxembourg_Forum_Geesseknäppchen_101): a round hall of about 36 m radius, glass all round.
 *
 * From the ground: a tall glazed ground floor with white mullions, the entrance doors and the name FORUM in stacked letters; a first rim, a
 * slab ring that stands out of the glass; a glazed second storey; a slim second rim; a third storey with large white roller blinds on the
 * sunny side and glass on the other; the top rim; and over it all the canopy: a ring of faceted PETALS of dark blue solar glass with white
 * ribs, reaching out over the facade.  Inside the canopy the roof steps up in two rings to a drum with an oculus.
 * Pure (no THREE): the Node harness builds the very same soup. */
import { paint } from './landmark-soup.js';
import { drawText } from './campus-text.js';
import { gradientTri } from './campus-kit.js';

const TAU = Math.PI * 2;
const SINK = 1.0;
const SIDES = 36;                       // the facets of the cylinder
const PETALS = 24;                      // the petals of the canopy

const GLASS_LOWER = [0.33, 0.47, 0.58];
const GLASS_UPPER = [0.46, 0.66, 0.84];
const BLIND = [0.82, 0.82, 0.79];
const RIM = [0.72, 0.73, 0.74];
const RIM_TOP = [0.84, 0.85, 0.86];
const MULLION = [0.88, 0.89, 0.90];
const PETAL_DARK = [0.10, 0.24, 0.62];
const PETAL_LIGHT = [0.26, 0.44, 0.84];
const PETAL_RIB = [0.90, 0.92, 0.94];
const ROOF = [0.62, 0.64, 0.67];
const DRUM = [0.58, 0.60, 0.64];
const OCULUS = [0.15, 0.22, 0.34];
const LETTER = [0.94, 0.95, 0.96];

const GF_HEIGHT = 5.0;                  // m: the ground floor
const STOREY = 4.3;                     // m: the second storey
const RIM_1 = 0.9, RIM_2 = 0.4;         // m: thickness of the first and second rim
const RIM_OUT = 0.75;                   // m: how far a rim stands out of the glass

/** The middle and the mean radius of a polygon [[x, z], ...]. */
function circleOf(pts) {
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length; cz /= pts.length;
  const r = pts.reduce((s, [x, z]) => s + Math.hypot(x - cx, z - cz), 0) / pts.length;
  return { cx, cz, r };
}

const ring = (cx, cz, r, y, n = SIDES, a0 = 0) => Array.from({ length: n }, (_, i) => {
  const a = a0 + (i / n) * TAU;
  return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
});

/** A band of facets on a circle between two heights: colour(i) per facet. */
function bandRing(soup, cx, cz, r, y0, y1, colorOf) {
  const lo = ring(cx, cz, r, y0), hi = ring(cx, cz, r, y1);
  for (let i = 0; i < SIDES; i++) {
    const j = (i + 1) % SIDES;
    soup.quad(lo[i], lo[j], hi[j], hi[i], colorOf(i));
  }
}

/** A slab ring standing out of the glass: front, top and underside (the underside is seen from the plaza under the rim). */
function slabRing(soup, cx, cz, rIn, rOut, y0, y1, color, topColor) {
  const fLo = ring(cx, cz, rOut, y0), fHi = ring(cx, cz, rOut, y1), tIn = ring(cx, cz, rIn, y1), bIn = ring(cx, cz, rIn, y0);
  for (let i = 0; i < SIDES; i++) {
    const j = (i + 1) % SIDES;
    soup.quad(fLo[i], fLo[j], fHi[j], fHi[i], color);
    soup.quad(fHi[i], fHi[j], tIn[j], tIn[i], topColor);
    soup.quad(bIn[i], bIn[j], fLo[j], fLo[i], [color[0] * 0.78, color[1] * 0.78, color[2] * 0.78]);
  }
}

function discTop(soup, cx, cz, r, y, color, n = SIDES) {
  const p = ring(cx, cz, r, y, n);
  for (let i = 0; i < n; i++) soup.tri([cx, y, cz], p[(i + 1) % n], p[i], color);
}

/** The glass of a storey: one quad per facet, dark at the top (the shadow of the rim above), lighter at the bottom. */
function glassStorey(soup, cx, cz, r, y0, y1, colorOf, outset = 0.05) {
  const lo = ring(cx, cz, r + outset, y0), hi = ring(cx, cz, r + outset, y1);
  for (let i = 0; i < SIDES; i++) {
    const j = (i + 1) % SIDES;
    const base = colorOf(i);
    const dark = [base[0] * 0.66, base[1] * 0.66, base[2] * 0.66];
    gradientTri(soup, lo[i], lo[j], hi[j], base, base, dark);
    gradientTri(soup, lo[i], hi[j], hi[i], base, dark, dark);
  }
}

/** White mullions: two per facet, a thin quad from y0 to y1 standing a little out of the glass. */
function mullions(soup, cx, cz, r, y0, y1, perFacet = 2) {
  const n = SIDES * perFacet;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, da = 0.012;
    const p = (rr, aa, y) => [cx + Math.cos(aa) * rr, y, cz + Math.sin(aa) * rr];
    soup.quad(p(r + 0.12, a - da, y0), p(r + 0.12, a + da, y0), p(r + 0.12, a + da, y1), p(r + 0.12, a - da, y1), MULLION);
  }
}

/** A word in stacked letters on the glass at angle `a` (the vertical FORUM of the photo): one letter above the other, facing out. */
function stackedWord(soup, cx, cz, r, a, y0, word, cap) {
  const nx = Math.cos(a), nz = Math.sin(a);
  const x = cx + nx * (r + 0.16), z = cz + nz * (r + 0.16);
  [...word].forEach((ch, k) => drawText(soup, ch, { x, z, dir: [nz, -nx], normal: [nx, nz], y: y0 - k * cap * 1.5, cap, out: 0, color: LETTER, align: 'center', weight: 0.2 }));
}

/** The canopy: a ring of faceted petals that rise to a tip, white ribs along the valleys.  Petal i is centred on the angle a_i. */
function petals(soup, cx, cz, rWall, yEdge) {
  const reach = 4.8, valley = 2.6, rise = 1.6;
  const at = (rr, a, y) => [cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr];
  const half = Math.PI / PETALS;
  for (let i = 0; i < PETALS; i++) {
    const a = (i / PETALS) * TAU;
    const innerL = at(rWall, a - half, yEdge), innerR = at(rWall, a + half, yEdge);
    const valL = at(rWall + valley, a - half, yEdge + rise * 0.4), valR = at(rWall + valley, a + half, yEdge + rise * 0.4);
    const tip = at(rWall + reach, a, yEdge + rise);
    const mid = at(rWall + valley * 0.6, a, yEdge + rise * 0.45);
    const dark = i % 2 ? PETAL_DARK : PETAL_LIGHT, light = i % 2 ? PETAL_LIGHT : PETAL_DARK;
    soup.tri(innerL, valL, mid, paint(dark, i, 0.05));
    soup.tri(innerL, mid, innerR, paint(light, i + 9, 0.05));
    soup.tri(innerR, mid, valR, paint(dark, i + 3, 0.05));
    soup.tri(valL, tip, mid, paint(light, i + 5, 0.05));
    soup.tri(valR, mid, tip, paint(dark, i + 7, 0.05));
    // the white rib along the valley to the next petal
    const next = at(rWall + valley, a + half, yEdge + rise * 0.4);
    soup.quad(at(rWall, a + half, yEdge + 0.05), at(rWall, a + half, yEdge - 0.25), at(rWall + valley, a + half, yEdge + rise * 0.4 - 0.25), next, PETAL_RIB);
    // the white edge under the tip
    soup.tri(valR, tip, [tip[0], tip[1] - 0.5, tip[2]], PETAL_RIB);
    soup.tri(valL, [tip[0], tip[1] - 0.5, tip[2]], tip, PETAL_RIB);
  }
}

/** The Forum: `b` is the baked building (its first part is the footprint ring and the LiDAR roof height). */
export function forum(soup, ground, b) {
  const part = b.parts[0];
  const { cx, cz, r } = circleOf(part.pts);
  // the plaza on the north-west side stands about 4 m higher than the street on the south-east: the floors count from the plaza (the entrance level),
  // the glass reaches down to the lowest ground on the other side
  const around = Array.from({ length: 24 }, (_, i) => ground(cx + Math.cos((i / 24) * TAU) * r, cz + Math.sin((i / 24) * TAU) * r)).sort((a, b) => a - b);
  const lowest = around[0], low = around[Math.floor(around.length * 0.8)];
  const eave = part.top;                                   // the roof of the outer ring (LiDAR)
  const rg = r - 0.6;                                      // the glass
  const y1 = low + GF_HEIGHT, y2 = y1 + RIM_1 + STOREY, y3 = y2 + RIM_2;
  // the ground floor: glass under the first rim, white mullions, entrance doors and the stacked name
  glassStorey(soup, cx, cz, rg, lowest - SINK, y1, (i) => paint(GLASS_LOWER, i, 0.1));
  mullions(soup, cx, cz, rg, lowest - 0.3, y1, 2);
  slabRing(soup, cx, cz, rg, rg + RIM_OUT, y1, y1 + RIM_1, RIM, RIM_TOP);
  for (const deg of [195, 225, 255, 285]) stackedWord(soup, cx, cz, rg, (deg * Math.PI) / 180, low + 4.5, 'FORUM', 0.5);
  // the second storey, glazed, between the rims
  glassStorey(soup, cx, cz, rg, y1 + RIM_1, y2, (i) => paint(GLASS_UPPER, i + 40, 0.1));
  mullions(soup, cx, cz, rg, y1 + RIM_1, y2, 2);
  slabRing(soup, cx, cz, rg, rg + RIM_OUT * 0.5, y2, y3, RIM, RIM_TOP);
  // the top storeys: white roller blinds on the sunny (southern) side, glass elsewhere
  const topY = eave - 1.0;
  glassStorey(soup, cx, cz, rg, y3, topY, (i) => (i >= 20 && i < 34 ? paint(BLIND, i, 0.03) : paint(GLASS_UPPER, i + 80, 0.1)));
  mullions(soup, cx, cz, rg, y3, topY, 1);
  slabRing(soup, cx, cz, rg, rg + RIM_OUT * 0.6, topY, eave + 0.3, RIM, RIM_TOP);
  petals(soup, cx, cz, rg + RIM_OUT * 0.6, eave + 0.3);
  // the roofs: a flat outer ring (inside the petals), the inner ring, the drum with the oculus
  const outerRing = r - 5;
  discTop(soup, cx, cz, outerRing, eave, paint(ROOF, 1, 0.02));
  const mid = eave + 2.2, drumTop = eave + 6.5;
  bandRing(soup, cx, cz, outerRing, eave, mid, () => DRUM);
  discTop(soup, cx, cz, outerRing, mid, paint(ROOF, 3, 0.02));
  bandRing(soup, cx, cz, r * 0.36, mid, drumTop, () => DRUM);
  discTop(soup, cx, cz, r * 0.36, drumTop, paint(ROOF, 5, 0.02));
  discTop(soup, cx, cz, 3.4, drumTop + 0.06, OCULUS, 12);
  for (let k = 0; k < 4; k++) {                              // the glazed wedges of the inner roof
    const a = ((k + 0.5) / 4) * TAU, rr = r * 0.62;
    soup.box(cx + Math.cos(a) * rr, mid, cz + Math.sin(a) * rr, 7, 0.5, 4, -a, paint(OCULUS, k, 0.05));
  }
}
