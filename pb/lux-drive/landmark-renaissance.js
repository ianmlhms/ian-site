/* The Flemish-Renaissance front of the Palais grand-ducal, built on the frame of one wall edge (landmark-facade.js: s along, y up, out in front of the wall).
 *
 * From the photographs: a rusticated ground floor with barred windows and arched doors, a string course, two tall storeys of mullioned windows under little
 * pediments, between the storeys panels of carved stone (painted here as relief: a darker recessed panel with a lighter diamond), two-storey oriels (bay windows)
 * on stone corbels with their own slate roofs, a long iron balcony in the middle, and, in front of the wall, the two sentry boxes and the row of stone bollards.
 * Everything is painted relief and a few small boxes: no depth that a driver could see is faked with textures.  Pure (no THREE); nothing here mutates its inputs. */
import { paint } from './landmark-soup.js';
import { PALETTE as C } from './landmark-palette.js';
import { panel, slab, joints, roundArch } from './landmark-facade.js';

const END_MARGIN = 2.2;            // m of plain wall at both ends of a front
const WINDOW_PITCH = 4.2;          // m between the middles of two windows
const ORIEL = Object.freeze({ width: 3.6, depth: 1.5, yFrom: 3.9 });
const SENTRY_BLUE = [0.13, 0.22, 0.46];
const BARS_COLOUR = [0.14, 0.14, 0.15];

/** The columns of a front: [{ sc, kind }] with kind 'window' or 'oriel' (two oriels, at 30 % and 70 % of the front, when it is long enough). */
export function frontColumns(len) {
  const usable = len - 2 * END_MARGIN;
  const n = Math.floor(usable / WINDOW_PITCH);
  if (n < 2) return [];
  const step = usable / n;
  const oriels = n >= 5 ? new Set([Math.round(n * 0.3 - 0.5), Math.round(n * 0.7 - 0.5)]) : new Set();
  return Array.from({ length: n }, (_, i) => ({ sc: END_MARGIN + (i + 0.5) * step, kind: oriels.has(i) ? 'oriel' : 'window', index: i, count: n }));
}

/** A rectangular window with a stone surround, mullion and transom (a cross), dark panes. */
function mullionWindow(soup, f, sc, y0, w, h, key) {
  panel(soup, f, sc - w / 2 - 0.3, sc + w / 2 + 0.3, y0 - 0.25, y0 + h + 0.3, 0.04, paint(C.sandstoneLight, key, 0.03));
  panel(soup, f, sc - w / 2, sc + w / 2, y0, y0 + h, 0.08, paint(C.glassDark, key + 1, 0.06));
  panel(soup, f, sc - 0.05, sc + 0.05, y0, y0 + h, 0.1, C.sandstoneLight);                         // the mullion
  panel(soup, f, sc - w / 2, sc + w / 2, y0 + h * 0.62, y0 + h * 0.62 + 0.1, 0.1, C.sandstoneLight);   // the transom
}

/** A window with the little triangular pediment of the first storey. */
function pedimentWindow(soup, f, sc, y0, w, h, key) {
  mullionWindow(soup, f, sc, y0, w, h, key);
  soup.tri(f.at(sc - w / 2 - 0.45, y0 + h + 0.3, 0.07), f.at(sc + w / 2 + 0.45, y0 + h + 0.3, 0.07), f.at(sc, y0 + h + 1.1, 0.07), paint(C.sandstoneLight, key + 2, 0.03));
}

/** A window of the ground floor: a stone surround and dark iron bars over the panes. */
function barredWindow(soup, f, sc, y0, w, h, key) {
  panel(soup, f, sc - w / 2 - 0.25, sc + w / 2 + 0.25, y0 - 0.2, y0 + h + 0.25, 0.04, paint(C.sandstoneLight, key, 0.03));
  panel(soup, f, sc - w / 2, sc + w / 2, y0, y0 + h, 0.08, C.blackGlass);
  for (let k = 1; k <= 4; k++) { const s = sc - w / 2 + (w * k) / 5; panel(soup, f, s - 0.04, s + 0.04, y0, y0 + h, 0.1, BARS_COLOUR); }
  panel(soup, f, sc - w / 2, sc + w / 2, y0 + h * 0.5, y0 + h * 0.5 + 0.07, 0.1, BARS_COLOUR);
}

/** A carved panel as painted relief: a recessed darker rectangle with a lighter diamond and a dark centre. */
function carvedPanel(soup, f, sc, y0, w, h, key) {
  panel(soup, f, sc - w / 2, sc + w / 2, y0, y0 + h, 0.05, paint(C.stoneBand, key, 0.05));
  const cy = y0 + h / 2, dw = w * 0.36, dh = h * 0.42;
  soup.quad(f.at(sc - dw, cy, 0.08), f.at(sc, cy - dh, 0.08), f.at(sc + dw, cy, 0.08), f.at(sc, cy + dh, 0.08), paint(C.sandstoneLight, key + 3, 0.04));
  soup.quad(f.at(sc - dw * 0.4, cy, 0.1), f.at(sc, cy - dh * 0.4, 0.1), f.at(sc + dw * 0.4, cy, 0.1), f.at(sc, cy + dh * 0.4, 0.1), paint(C.stoneBand, key + 4, 0.05));
}

/** An oriel: a two-storey bay on stepped corbels, windows on the front and the two cheeks, a slate hip roof on top. */
function oriel(soup, f, sc, high, yEave, key) {
  const { width: w, depth: d, yFrom } = ORIEL;
  const yTop = yEave - 0.6;
  slab(soup, f, sc - w / 2 + 0.3, sc + w / 2 - 0.3, high + yFrom - 0.7, high + yFrom, d - 0.4, paint(C.sandstoneDark, key, 0.04), { out0: 0.1 });       // the corbels, stepped
  slab(soup, f, sc - w / 2 + 0.1, sc + w / 2 - 0.1, high + yFrom - 0.2, high + yFrom + 0.2, d - 0.1, paint(C.sandstoneDark, key + 1, 0.04), { out0: 0.05 });
  slab(soup, f, sc - w / 2, sc + w / 2, high + yFrom + 0.2, yTop, d, paint(C.palaisStone, key + 2, 0.03), { topColor: C.sandstoneLight });
  const front = { ...f, at: (s, y, out = 0) => f.at(s, y, out + d) };          // the front plane of the bay: the windows stand on it
  for (const [ya, h] of [[high + 5.5, 2.6], [high + 9.8, 2.3]]) {
    for (const dx of [-0.85, 0.85]) mullionWindow(soup, front, sc + dx, ya, 1.1, h, key + Math.round(ya));
  }
  // the cheeks: one tall dark window each, drawn on the side faces (the plane across the wall, at s = sc +- w / 2)
  for (const sign of [-1, 1]) {
    const se = sc + sign * (w / 2 + 0.03);
    for (const [ya, h] of [[high + 5.6, 2.4], [high + 9.9, 2.1]]) soup.quad(f.at(se, ya, 0.45), f.at(se, ya, d - 0.45), f.at(se, ya + h, d - 0.45), f.at(se, ya + h, 0.45), C.glassDark);
  }
  slab(soup, f, sc - w / 2 - 0.15, sc + w / 2 + 0.15, high + 8.9, high + 9.35, d + 0.15, paint(C.sandstoneLight, key + 3, 0.03));              // the string course round the bay
  const roofBase = yTop, apex = f.at(sc, roofBase + 4.2, d / 2);
  const xz = (s, o) => { const q = f.at(s, 0, o); return [q[0], q[2]]; };
  soup.pyramid([xz(sc - w / 2 - 0.2, -0.1), xz(sc + w / 2 + 0.2, -0.1), xz(sc + w / 2 + 0.2, d + 0.2), xz(sc - w / 2 - 0.2, d + 0.2)], roofBase, apex, paint(C.slateBlack, key + 4, 0.05));
}

/** The iron balcony: a slab and a railing (posts and a rail) in front of the windows of the first storey, from s0 to s1. */
function balcony(soup, f, s0, s1, y) {
  slab(soup, f, s0, s1, y - 0.3, y, 0.7, paint(C.sandstoneLight, 21, 0.03), { out0: 0.05 });
  panel(soup, f, s0, s1, y + 0.9, y + 1.0, 0.72, BARS_COLOUR);
  panel(soup, f, s0, s1, y + 0.05, y + 0.12, 0.72, BARS_COLOUR);
  for (let s = s0; s <= s1 + 0.01; s += 0.45) panel(soup, f, s - 0.025, s + 0.025, y + 0.05, y + 1.0, 0.72, BARS_COLOUR);
}

/** A sentry box: a dark-blue wooden hut with a little pitched roof and a gold stripe (the photographs), standing in front of the wall at `out`. */
export function sentryBox(soup, f, sc, y, out) {
  const [x, , z] = f.at(sc, y, out);
  soup.box(x, y, z, 1.2, 2.5, 1.2, f.yaw, paint(SENTRY_BLUE, Math.round(sc * 7), 0.03), { topColor: SENTRY_BLUE });
  soup.box(x, y + 1.9, z, 1.26, 0.12, 1.26, f.yaw, C.gold);
  const q = (u, v) => { const p = f.at(sc + u, y + 2.5, out + v); return [p[0], p[2]]; };
  soup.pyramid([q(-0.75, -0.75), q(0.75, -0.75), q(0.75, 0.75), q(-0.75, 0.75)], y + 2.5, f.at(sc, y + 3.4, out), C.slateBlack);
  soup.box(x - f.nx * 0.61, y + 0.2, z - f.nz * 0.61, 0.0 + 0.5, 1.6, 0.08, f.yaw, C.blackGlass);       // the opening, on the side toward the wall
}

/** A stone bollard (the low posts in front of the palace) standing at s, `out` m in front of the wall, on the ground at y. */
export function bollard(soup, f, s, y, out, key) {
  const [x, , z] = f.at(s, y, out);
  soup.box(x, y, z, 0.38, 0.95, 0.38, f.yaw, paint(C.sandstoneLight, key, 0.04), { topColor: C.sandstoneLight });
}

/**
 * The whole front on edge frame f.  K: { floor (m per storey), eave (m, height of the cornice over `high`) }.  `ground(s)` is the height of the land at s along the wall:
 * the bollards and the sentry boxes stand on it.  Returns { columns } so the caller can place the dormers and turrets above the same rhythm.
 */
export function renaissanceFront(soup, f, { high, yEave, floor, ground, key = 0, sentries = false }) {
  const cols = frontColumns(f.len);
  // ground floor: rusticated ashlar, barred windows, an arched door in the middle column
  joints(soup, f, { y0: high, y1: high + floor, rowH: 0.85, colW: 1.7, color: C.stoneBand, key: key + 1, width: 0.07 });
  const doorAt = cols.length ? cols[Math.floor(cols.length / 2)].index : -1;
  for (const c of cols) {
    if (c.index === doorAt) roundArch(soup, f, c.sc, high, 2.2, 2.2, C.sandstoneLight, C.glassDark);
    else barredWindow(soup, f, c.sc, high + 1.0, 1.3, 1.9, key + c.index * 7);
  }
  // the string courses between the storeys and under the eaves
  for (let r = 1; r <= 2; r++) panel(soup, f, 0, f.len, high + r * floor - 0.18, high + r * floor + 0.18, 0.12, paint(C.sandstoneLight, key + r, 0.03));
  // the two upper storeys
  for (const c of cols) {
    if (c.kind === 'oriel') { oriel(soup, f, c.sc, high, yEave, key + c.index * 13); continue; }
    pedimentWindow(soup, f, c.sc, high + floor + 0.9, 1.5, 2.7, key + c.index * 11);
    carvedPanel(soup, f, c.sc, high + floor + 4.35, 2.4, 1.2, key + c.index * 17);
    mullionWindow(soup, f, c.sc, high + 2 * floor + 0.9, 1.4, 2.3, key + c.index * 19);
  }
  // ashlar of the upper storeys: faint courses, no vertical joints (the facade is smooth, dressed stone)
  joints(soup, f, { y0: high + floor, y1: yEave - 0.8, rowH: 1.15, colW: 3.0, color: C.stoneBand, key: key + 2, width: 0.05, vertical: false });
  if (cols.length >= 5) {                                                                           // the long balcony in front of the middle windows of the first storey
    const mid = cols.slice(Math.floor(cols.length / 2) - 1, Math.floor(cols.length / 2) + 2).filter((c) => c.kind === 'window');
    if (mid.length) balcony(soup, f, mid[0].sc - 1.5, mid[mid.length - 1].sc + 1.5, high + floor + 0.75);
  }
  if (sentries) {
    sentryBox(soup, f, 2.0, ground(2.0), 1.1);
    sentryBox(soup, f, f.len - 2.0, ground(f.len - 2.0), 1.1);
    for (let s = 4.5; s < f.len - 4; s += 3.2) bollard(soup, f, s, ground(s), 2.2, key + Math.round(s * 5));
  }
  return { columns: cols };
}
