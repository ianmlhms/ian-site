/* The hand-modelled buildings of the campus that are not plain extruded parts.
 *
 * The Forum (Campus Geesseknäppchen, Boulevard Pierre Dupong): a round hall of about 36 m radius, glass all round (a glazed ground floor, an
 * overhanging band, glass and white blinds above), under a ring of dark blue solar "petals" that reach out over the facade; inside, a
 * stepped roof (an outer ring, an inner ring, a drum with an oculus).  Every function: (soup, ground, building) -> nothing; it adds its faces. */
import { paint } from './landmark-soup.js';

const TAU = Math.PI * 2;
const SINK = 1.0;
const SIDES = 36;                      // the facets of the cylinder (and the petals of the canopy)

const GLASS_LOWER = [0.27, 0.36, 0.45];
const GLASS_UPPER = [0.44, 0.58, 0.72];
const BLIND = [0.82, 0.82, 0.80];
const BAND = [0.74, 0.74, 0.72];
const PETAL = [0.12, 0.20, 0.50];
const PETAL_LIGHT = [0.24, 0.36, 0.66];
const PETAL_RIB = [0.86, 0.88, 0.90];
const ROOF = [0.62, 0.64, 0.67];
const DRUM = [0.58, 0.60, 0.64];
const OCULUS = [0.15, 0.22, 0.34];

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

/** A cylinder wall from ground-following bottoms to y1: each facet a quad (colour(i) per facet). */
function wallRing(soup, ground, cx, cz, r, y1, colorOf) {
  const bottoms = Array.from({ length: SIDES }, (_, i) => {
    const a = (i / SIDES) * TAU;
    return ground(cx + Math.cos(a) * r, cz + Math.sin(a) * r) - SINK;
  });
  const top = ring(cx, cz, r, y1);
  for (let i = 0; i < SIDES; i++) {
    const j = (i + 1) % SIDES;
    const lo = ring(cx, cz, r, 0);
    soup.quad([lo[i][0], bottoms[i], lo[i][2]], [lo[j][0], bottoms[j], lo[j][2]], top[j], top[i], colorOf(i));
  }
}

/** A band of facets between two heights (flat y0..y1) on a circle of radius r. */
function bandRing(soup, cx, cz, r, y0, y1, colorOf, outset = 0) {
  const lo = ring(cx, cz, r + outset, y0), hi = ring(cx, cz, r + outset, y1);
  for (let i = 0; i < SIDES; i++) {
    const j = (i + 1) % SIDES;
    soup.quad(lo[i], lo[j], hi[j], hi[i], colorOf(i));
  }
}

function discTop(soup, cx, cz, r, y, color, n = SIDES) {
  const p = ring(cx, cz, r, y, n);
  for (let i = 0; i < n; i++) soup.tri([cx, y, cz], p[(i + 1) % n], p[i], color);
}

function forum(soup, ground, b) {
  const part = b.parts[0];
  const { cx, cz, r } = circleOf(part.pts);
  const low = ground(cx - r, cz) < ground(cx + r, cz) ? ground(cx - r, cz) : ground(cx + r, cz);
  const eave = part.top;                                   // the roof of the outer ring (LiDAR)
  const gf = low + 4.6;                                    // the glazed ground floor and the band above it
  // the facade: glass ground floor, a pale band, then glass with white blinds on every third facet
  wallRing(soup, ground, cx, cz, r - 0.6, gf, (i) => paint(GLASS_LOWER, i, 0.1));
  bandRing(soup, cx, cz, r - 0.6, gf, gf + 0.9, () => BAND, 0.7);
  const mezz = gf + 4.4;                                   // the first gallery: a slim ring in the glass
  bandRing(soup, cx, cz, r - 0.6, gf + 0.9, mezz, (i) => paint(GLASS_UPPER, i + 40, 0.1), 0.05);
  bandRing(soup, cx, cz, r - 0.6, mezz, mezz + 0.35, () => BAND, 0.35);
  bandRing(soup, cx, cz, r - 0.6, mezz + 0.35, eave - 1.2, (i) => (i % 4 < 2 ? paint(BLIND, i, 0.03) : paint(GLASS_UPPER, i, 0.1)), 0.05);
  // white mullions every facet: thin pale strips over the glass of the lower storeys
  for (let i = 0; i < SIDES; i++) {
    const a = (i / SIDES) * TAU, x = cx + Math.cos(a) * (r - 0.5), z = cz + Math.sin(a) * (r - 0.5);
    const y0 = ground(x, z);
    soup.box(x, y0 - 0.5, z, 0.22, mezz - y0 + 0.5, 0.22, -a, BAND);
  }
  bandRing(soup, cx, cz, r - 0.6, eave - 1.2, eave + 0.2, () => BAND, 0.4);
  // the canopy of solar petals: slanting facets that reach out over the facade, with a pale rib between two petals
  const wallTop = ring(cx, cz, r - 0.2, eave - 0.6), outer = ring(cx, cz, r + 3.4, eave + 0.9);
  for (let i = 0; i < SIDES; i++) {
    const j = (i + 1) % SIDES;
    soup.quad(wallTop[i], wallTop[j], outer[j], outer[i], paint(i % 2 ? PETAL : PETAL_LIGHT, i, 0.06));
    soup.quad(outer[i], outer[j], [outer[j][0], outer[j][1] - 0.6, outer[j][2]], [outer[i][0], outer[i][1] - 0.6, outer[i][2]], PETAL_RIB);
  }
  // the roofs: a flat outer ring (inside the petals), the inner ring, the drum with the oculus
  const outerRing = r - 5;
  discTop(soup, cx, cz, outerRing, eave, paint(ROOF, 1, 0.02));
  const mid = eave + 2.2, drumTop = eave + 6.5;
  wallRing(soup, ground, cx, cz, outerRing, mid, () => DRUM);
  discTop(soup, cx, cz, outerRing, mid, paint(ROOF, 3, 0.02));
  wallRing(soup, ground, cx, cz, r * 0.36, drumTop, () => DRUM);
  discTop(soup, cx, cz, r * 0.36, drumTop, paint(ROOF, 5, 0.02));
  discTop(soup, cx, cz, 3.4, drumTop + 0.06, OCULUS, 12);
  // four skylights on the inner roof (the real hall has glazed wedges)
  for (let k = 0; k < 4; k++) {
    const a = ((k + 0.5) / 4) * TAU, rr = r * 0.62;
    soup.box(cx + Math.cos(a) * rr, mid, cz + Math.sin(a) * rr, 7, 0.5, 4, -a, paint(OCULUS, k, 0.05));
  }
}

export const CUSTOM = { forum };
