/* The shape rules of a bridge deck that the view (deck-view.js) and the harness share: how deep the side reaches, where the lane lines run, where the piers stand.
 * Pure functions (no THREE). */
import { DECK } from './decks.js';

export const ROAD_MIN_WIDTH = 6.5;         // m: a deck at least this wide is a road bridge (asphalt, markings), a narrower one a footbridge / track
export const LANE_WIDTH = 3.5;             // m
export const EDGE_INSET = 0.55;            // m: the edge line lies this far inside the parapet
export const LINE_WIDTH = 0.16;            // m
export const DASH_PERIOD = 9, DASH_LENGTH = 3;   // m: a dashed lane line
export const PAINT_LIFT = 0.035;           // m: the paint lies this far over the asphalt (no z-fight at 100 m)
export const FILL_FULL = 2.0;              // m: a deck within this of the ground is solid down to it (abutment, ramp) ...
export const FILL_NONE = 3.0;              // ... and beyond this clearance only the girder shows (in between the fill thins out: no step)
export const PIER_SPACING = 26;            // m between the piers of a high deck
export const PIER_MIN_CLEAR = 2.6;         // m: a pier stands where the deck is at least this high
export const PIER_END_MARGIN = 7;          // m: no pier this close to an end of the deck (the abutment is there)
export const PIER_SIZE = 1.5;              // m: a column is square
export const PIER_ROAD_CLEAR = 1.2;        // m: a pier stands this far from any carriageway of the ground under the bridge
export const PIER_SHIFT_STEP = 2.5;        // m: a pier that would stand in a road is moved along the deck in steps of this ...
export const PIER_SHIFT_MAX = 12;          // ... up to this far
export const PIER_FOOT = 0.5;              // m: the column reaches this far below the ground

/** The clearance -> how deep the side of the deck reaches below the surface (a function of the clearance that is continuous: no step where the fill ends). */
export function sideDepth(clearance) {
  const girder = DECK.thickness;
  if (clearance <= FILL_FULL) return Math.max(clearance, 0);
  if (clearance >= FILL_NONE) return girder;
  const k = (clearance - FILL_FULL) / (FILL_NONE - FILL_FULL);
  return Math.max(girder, clearance + (girder - clearance) * k);
}

/** The lane lines of a road deck of width w: [{ offset (m from the axis), dashed }]. */
export function laneLines(width) {
  const lines = [];
  const lanes = Math.max(1, Math.round((width - 2 * EDGE_INSET) / LANE_WIDTH));
  const usable = width - 2 * EDGE_INSET;
  for (const side of [-1, 1]) lines.push({ offset: side * (width / 2 - EDGE_INSET), dashed: false });
  for (let i = 1; i < lanes; i++) lines.push({ offset: -usable / 2 + (usable * i) / lanes, dashed: true });
  return lines;
}

/** The piers of a deck: [{ x, z, top, bottom, dx, dz }] (the position and the direction of the deck, the top under the girder, the bottom under the ground).  Pure: used by the view and the harness. */
export function piersOf(deck, ground, sdCarAt) {
  const piers = [];
  const n = deck.pts.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(deck.pts[i][0] - deck.pts[i - 1][0], deck.pts[i][1] - deck.pts[i - 1][1]));
  const length = cum[n - 1];
  const at = (s) => {
    let i = 1;
    while (i < n - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-6);
    const dx = deck.pts[i][0] - deck.pts[i - 1][0], dz = deck.pts[i][1] - deck.pts[i - 1][1], l = Math.hypot(dx, dz) || 1;
    return { x: deck.pts[i - 1][0] + dx * f, z: deck.pts[i - 1][1] + dz * f, top: deck.tops[i - 1] + (deck.tops[i] - deck.tops[i - 1]) * f, dx: dx / l, dz: dz / l };
  };
  const offsets = deck.width >= 9 ? [-deck.width * 0.25, deck.width * 0.25] : [0];
  for (let s = PIER_SPACING / 2; s < length - PIER_END_MARGIN; s += PIER_SPACING) {
    for (let shift = 0; shift <= PIER_SHIFT_MAX; shift += PIER_SHIFT_STEP) {
      let placed = false;
      for (const sign of shift === 0 ? [1] : [1, -1]) {
        const ss = s + sign * shift;
        if (ss < PIER_END_MARGIN || ss > length - PIER_END_MARGIN) continue;
        const p = at(ss);
        const cols = offsets.map((o) => ({ x: p.x - p.dz * o, z: p.z + p.dx * o }));
        const g = Math.min(...cols.map((c) => ground.height(c.x, c.z)));
        if (p.top - g < PIER_MIN_CLEAR) continue;
        if (cols.some((c) => sdCarAt(c.x, c.z) < PIER_ROAD_CLEAR)) continue;
        for (const c of cols) {
          // the foot goes under the lowest corner of the column (a pier on a slope must not hover on its downhill side)
          const h = PIER_SIZE / 2;
          let low = Infinity;
          for (const [ox, oz] of [[-h, -h], [h, -h], [h, h], [-h, h]]) low = Math.min(low, ground.height(c.x + ox, c.z + oz));
          piers.push({ x: c.x, z: c.z, top: p.top - DECK.thickness, bottom: low - PIER_FOOT, dx: p.dx, dz: p.dz });
        }
        placed = true;
        break;
      }
      if (placed) break;
    }
  }
  return piers;
}


/* The abutments: where a deck that starts on its road (a flush end) clears a road or a valley within a few metres, the ground under its first metres is the steep
 * bank of the carve (6-7 m in 1-2 m at the skewed interchanges: Croix de Gasperich, Cloche d'Or, Dudelange), drawn as a grass bank.  A real bridge stands on a
 * concrete abutment there: its side faces go down to the ground (wing walls) and a front wall closes the bank at its foot. */
export const ABUT = Object.freeze({
  reach: 30,               // m along the deck from the end: where the bank is looked for
  step: 0.5,               // m between the stations
  clear: 4.0,              // m: the clearance of the deck over its foot is at least this (a road or a path passes under) ...
  clearMax: 10,            // ... and at most this (higher: a viaduct over a valley, whose ends stand on the valley sides)
  footShare: 0.85,         // the foot of the bank: the first station where the clearance reaches this share of the largest clearance within `reach`
  bankMax: 0.8,            // the bank is steep: from FILL_FULL of clearance to the foot within this many metres per metre of clearance (gentler: a valley, no abutment)
  skirt: 0.5,              // m: the walls go this far under the ground
});

/**
 * The abutments of a deck: [{ end: 0 | 1, s }] (s: the arc length of the front wall, from the start of the deck).  Only an end that lies on the ground (within
 * FILL_FULL) has one.  Pure (the view draws them, the harness can count them).
 */
export function abutmentsOf(deck, ground) {
  const n = deck.pts.length;
  if (n < 2 || !ground || deck.width < ROAD_MIN_WIDTH) return [];          // (a footbridge lands on stairs and ramps)
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(deck.pts[i][0] - deck.pts[i - 1][0], deck.pts[i][1] - deck.pts[i - 1][1]));
  const total = cum[n - 1];
  const sample = (s) => {
    let i = 1;
    while (i < n - 1 && cum[i] < s) i++;
    const f = Math.min(1, Math.max(0, (s - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-6)));
    const x = deck.pts[i - 1][0] + (deck.pts[i][0] - deck.pts[i - 1][0]) * f, z = deck.pts[i - 1][1] + (deck.pts[i][1] - deck.pts[i - 1][1]) * f;
    return deck.tops[i - 1] + (deck.tops[i] - deck.tops[i - 1]) * f - ground.height(x, z);
  };
  const out = [];
  for (const end of [0, 1]) {
    const from = (d) => (end === 0 ? d : total - d);
    if (sample(from(0)) > FILL_FULL) continue;                       // not an end on the ground
    const reach = Math.min(ABUT.reach, total / 2);
    const cl = [];
    for (let d = 0; d <= reach; d += ABUT.step) cl.push(sample(from(d)));
    const cmax = Math.max(...cl);
    if (cmax < ABUT.clear || cmax > ABUT.clearMax) continue;
    const foot = cl.findIndex((c) => c >= cmax * ABUT.footShare);
    const bank = cl.findIndex((c) => c > FILL_FULL);
    if (foot < 0 || bank < 0 || (foot - bank) * ABUT.step > ABUT.bankMax * cmax) continue;    // a gentle valley side: the ground is drawn as it is
    out.push({ end, s: from(foot * ABUT.step), cmax, bank: (foot - bank) * ABUT.step });
  }
  return out;
}

/** What "a deck lies on a carriageway" means: the audit of scripts/luxdrive/bake_deck_fixes.mjs and gate D of the harness use the same numbers. */
export const DECK_ON_ROAD = Object.freeze({
  STEP: 1.5,               // m between the samples along a deck
  END_MARGIN: 8,           // m: the first and the last metres of a deck belong to its own approach road
  ON_ROAD_CLEAR: 1.5,      // m: a deck less than this over the surface of the ground lies on it
  REMOVE_CLEAR: 3.0,       // m: a deck that never rises more than this over the ground (and lies on a road) is no bridge
  MIN_PIECE: 12,           // m: a piece of a split deck shorter than this is dropped
  ROAD_SD: -0.5,           // m: the ground has a carriageway under the point (signed distance to the union of the carriageways)
});
