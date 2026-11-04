/* The facade styles of the campus: what one bay of one storey (cell) and one storey of a run (row) looks like.
 *
 * Every style is { cell(cell, p, part), row?(row, p, part) }; p = part.fp, the parameters from the bake spec (campus_spec.py).  Depth is
 * real geometry that reads from the road: floor-slab edges and sills project from the wall, sun blinds are boxes, pilasters stand out,
 * and a darker strip under every overhang and beside every reveal is the painted shadow.  Pure (no THREE). */
import { paint } from './landmark-soup.js';
import { quad, ledge, pier, shelf, shade, hashUnit, gradientQuad, disc, OUT_1 } from './campus-kit.js';

const GAP = 0.12;                                       // m: the mullion between two panes
const OUT_1_PANEL = 0.05;                               // m: the spandrel band of the École de Commerce, behind its windows
const OUT_BAND = 0.06;                                  // m: a band of another colour in front of the wall
const TINTS = [[1, 1, 1], [0.93, 0.97, 1.04], [1.07, 1.03, 0.97]];   // the panes of a curtain wall reflect different bits of sky
const PORCH_MARGIN = 0.5;                               // m: window groups keep this far from the porch of an entrance
const SHADOW_TOP = 0.62;                                // the glass under a head is this much darker at the top edge

/** The colour between a and b (t = 0 is a). */
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The glass of a window with its painted shadow: one gradient quad, dark under the head, clear at the sill (the recessed look for 2 triangles). */
function recessedGlass(cell, s0, s1, y0, y1, glass, out = cell.out1) {
  const base = paint(glass, cell.seed, 0.12);
  gradientQuad(cell, s0, s1, y0, y1, out, shade(base, SHADOW_TOP), base);
}

/** How far a sun blind is drawn in a bay (m), irregular like the real ones: groups of bays share a level. */
function blindDrop(cell, p) {
  const group = hashUnit(Math.floor(cell.col / 2) * 31 + cell.row * 7 + (cell.seed >> 12));
  if (group > (p.blindShare ?? 0.7)) return 0;
  return p.blindDrops[Math.floor(hashUnit(cell.seed + 3) * p.blindDrops.length) % p.blindDrops.length];
}

export const STYLES = {
  /** Nothing but the wall (a hall, a plinth). */
  blank: {},

  /** Window ribbons (Athénée, halls): glass with painted reveals, a projecting slab edge over each storey, a sill shelf, and sun blinds as boxes. */
  ribbon: {
    row(row, p) {
      const { y1, s0, s1, run } = row;
      const frame = p.frame || [0.8, 0.8, 0.78];
      const wy0 = row.y0 + p.sill;
      const wy1 = Math.min(y1 - 0.5, wy0 + p.h);
      if (wy1 - wy0 < 0.5) return;
      ledge(row, run.s0, run.s1, y1 - 0.55, y1 - 0.02, 0.3, frame, shade(frame, 1.05));        // the slab edge over the windows
      quad(row, s0, s1, y1 - 0.55 - 0.34, y1 - 0.55, 0.03, shade(row.run.wallColor || frame, 0.78));   // its shadow on the wall
      shelf(row, s0, s1, wy0, 0.16, 0.14, frame);
    },
    cell(cell, p) {
      const { s0, s1, y0, y1 } = cell;
      const wy0 = y0 + p.sill, wy1 = Math.min(y1 - 0.55, y0 + p.sill + p.h);
      if (wy1 - wy0 < 0.5) return;
      recessedGlass(cell, s0 + GAP, s1 - GAP, wy0, wy1, p.glass);
      if (p.blind) {
        const drop = p.blindDrops ? blindDrop(cell, p) : ((cell.col + cell.row) % (p.blindEvery || 2) === 0 ? 0.8 : 0);
        if (drop > 0.1) ledge(cell, s0 + GAP, s1 - GAP, wy1 - drop, wy1 + 0.05, 0.3, paint(p.blind, cell.seed, 0.06), shade(p.blind, 1.12), 0.03);
      }
    },
  },

  /** Punched windows between pilasters with a coloured frame and a blind (Lycée Michel Rodange, Conservatoire). */
  punched: {
    row(row, p) {
      const concrete = p.slab || row.run.wallColor;
      if (!concrete) return;
      ledge(row, row.run.s0, row.run.s1, row.y1 - 0.4, row.y1, 0.22, concrete, shade(concrete, 1.06));
    },
    cell(cell, p) {
      const { s0, s1, y0 } = cell;
      const sm = (s0 + s1) / 2, hw = p.w / 2;
      const wy0 = y0 + p.sill, wy1 = Math.min(cell.y1 - 0.45, wy0 + p.h);
      if (wy1 - wy0 < 0.6) return;
      if (p.pilaster) pier(cell, s0 - p.pilaster / 2, s0 + p.pilaster / 2, y0, cell.y1, 0.3, p.pilasterColor || cell.run.wallColor);
      const blind = hashUnit(cell.seed) < (p.blindShare ?? 0.3);
      const pane = blind ? p.blind : mix(p.pane, p.frame, 0.22);
      const paneColor = paint(pane, cell.seed + 1, 0.06);
      gradientQuad(cell, sm - hw, sm + hw, wy0, wy1, cell.out1, blind && p.blindEdge ? p.blindEdge : shade(paneColor, SHADOW_TOP), paneColor);
      quad(cell, sm - hw - 0.1, sm + hw + 0.1, wy0 - 0.14, wy0, cell.out2 + 0.03, p.sillColor || cell.run.wallColor);      // the sill: a lit band under the window
    },
  },

  /** Coloured cladding panels (Blumm, Gaston Thorn, ENAD): a panel per bay column in the palette, windows set into them. */
  panels: {
    row(row, p) {
      ledge(row, row.run.s0, row.run.s1, row.y1 - 0.2, row.y1 + 0.1, 0.12, p.slab || [0.5, 0.5, 0.5]);
    },
    cell(cell, p) {
      const { s0, s1, y0, y1 } = cell;
      const pick = p.columns ? hashUnit(cell.col * 17 + (cell.seed >> 14) + (p.colorSeed || 0)) : hashUnit(cell.seed);
      const color = p.palette[Math.floor(pick * p.palette.length) % p.palette.length];
      quad(cell, s0 + 0.03, s1 - 0.03, y0 + 0.03, y1 - 0.03, cell.out1, paint(color, cell.seed, 0.06));
      quad(cell, s0 + 0.03, s0 + 0.09, y0 + 0.03, y1 - 0.03, cell.out2, shade(color, 0.75));      // the panel joint
      if ((cell.col + cell.row * 2) % (p.windowEvery || 2) === 0) {
        const sm = (s0 + s1) / 2, hw = Math.min(p.w / 2, (s1 - s0) / 2 - 0.15);
        const wy0 = y0 + p.sill, wy1 = Math.min(y1 - 0.5, wy0 + p.h);
        recessedGlass(cell, sm - hw, sm + hw, wy0, wy1, p.glass, cell.out2 + 0.02);
      }
    },
  },

  /** Horizontal bands (International School): dark grey cladding with a light strip across every storey and small punched windows. */
  bands: {
    row(row, p) {
      const { y0 } = row;
      const dark = row.run.wallColor;
      quad(row, row.run.s0, row.run.s1, y0 + p.bandAt, y0 + p.bandAt + p.bandH, OUT_BAND, p.band);
      quad(row, row.run.s0, row.run.s1, y0 + p.bandAt - 0.03, y0 + p.bandAt, OUT_BAND + 0.01, shade(dark, 0.7));
    },
    cell(cell, p) {
      const { s0, s1, y0 } = cell;
      const sm = (s0 + s1) / 2, hw = p.w / 2;
      if (cell.col % (p.windowEvery || 2) !== 0 && hashUnit(cell.seed) < 0.5) return;
      const wy0 = y0 + p.sill, wy1 = Math.min(cell.y1 - 0.45, wy0 + p.h);
      if (wy1 - wy0 < 0.5) return;
      recessedGlass(cell, sm - hw, sm + hw, wy0, wy1, p.glass, cell.out2);
      shelf(cell, sm - hw - 0.08, sm + hw + 0.08, wy0, 0.15, 0.1, p.band);
    },
  },

  /** Pilasters between spandrels with red-framed windows (École de Commerce): yellow panels, grey pebbled pilasters standing out of the wall. */
  ecg: {
    row(row, p) {
      const { y0, y1 } = row;
      quad(row, row.run.s0, row.run.s1, y0 + 0.05, y1 - 0.05, OUT_1_PANEL, paint(p.panel, row.cells[0].seed, 0.04));    // the yellow spandrel band of the storey
      ledge(row, row.run.s0, row.run.s1, y1 - 0.12, y1 + 0.02, 0.15, p.pilaster);
    },
    cell(cell, p) {
      const { s0, s1, y0, y1 } = cell;
      const pil = 0.5;
      pier(cell, s0, s0 + pil, y0 - 0.02, y1 + 0.02, 0.38, p.pilaster);
      const wy0 = y0 + p.sill, wy1 = Math.min(y1 - 0.5, wy0 + p.h);
      if (wy1 - wy0 < 0.6) return;
      const a = s0 + pil + 0.5, b = s1 - 0.5;
      quad(cell, a, b, wy0, wy1, cell.out2, p.frame);
      const blind = hashUnit(cell.seed) < 0.35;
      const inner = blind ? [0.50, 0.52, 0.54] : paint(p.glass, cell.seed, 0.1);
      gradientQuad(cell, a + 0.22, b - 0.22, wy0 + 0.22, wy1 - 0.22, cell.out2 + 0.04, shade(inner, SHADOW_TOP), inner);
    },
  },

  /** A glass curtain wall: dark glass in light mullions (entrance halls, the Forum's neighbours). */
  glass: {
    cell(cell, p) {
      const { s0, s1, y0, y1 } = cell;
      quad(cell, s0 + 0.08, s1 - 0.08, y0 + 0.1, y1 - 0.1, cell.out1, paint(p.glass, cell.seed, 0.14));
      quad(cell, s0 - 0.04, s0 + 0.06, y0, y1, cell.out2, p.mullion || [0.84, 0.85, 0.84]);
    },
    row(row, p) {
      quad(row, row.run.s0, row.run.s1, row.y1 - 0.08, row.y1 + 0.05, 0.16, p.mullion || [0.84, 0.85, 0.84]);
    },
  },

  /** The big glazed block of the Athénée (photos Luxembourg_Athénée_101, Athénée_de_Luxembourg_01): two storeys of pale reflective panes in thick white
   * frames and transoms under a deep cream fascia, a dark blue strip behind the bottom of the lower storey, a few slim opening lights, the cream slab edge over the recessed ground floor. */
  curtain: {
    row(row, p) {
      const { y0, y1 } = row;
      ledge(row, row.run.s0, row.run.s1, y1 - 0.16, y1 + 0.04, 0.22, p.frameColor, shade(p.frameColor, 1.04));           // a transom: the white band between the storeys
      if (p.gfTop !== undefined && y0 <= p.gfTop + 0.3) ledge(row, row.run.s0, row.run.s1, y0 - 0.55, y0 + 0.02, 0.45, p.slab || p.frameColor, shade(p.slab || p.frameColor, 1.06));   // the edge of the cantilevered slab
    },
    cell(cell, p) {
      const { s0, s1, y0, y1 } = cell;
      const k = cell.row / Math.max(1, cell.rows - 1);
      const lowest = p.gfTop === undefined || y0 <= p.gfTop + 0.3;                                  // (a curtain wall without `gfTop` has the dark strip at every storey)
      const tint = TINTS[Math.floor(hashUnit(cell.col * 13 + 5) * TINTS.length)];
      const glass = [Math.min(1, p.glass[0] * tint[0]), Math.min(1, p.glass[1] * tint[1]), Math.min(1, p.glass[2] * tint[2])];
      let g0 = y0 + 0.12;
      if (lowest) {                                                                                  // the dark blue strip at the foot of the glass
        quad(cell, s0 + 0.06, s1 - 0.06, y0 + 0.02, y0 + p.spandrel, cell.out1, paint(p.dark, cell.seed, 0.05));
        g0 = y0 + p.spandrel;
      }
      gradientQuad(cell, s0 + 0.06, s1 - 0.06, g0, y1 - 0.2, cell.out1, shade(glass, 1.3), shade(glass, 0.78));       // reflected sky: lighter at the top
      pier(cell, s0 - 0.12, s0 + 0.12, y0, y1, 0.18, p.frameColor);                                  // the mullion
      if (hashUnit(cell.col * 5 + 3) < 0.28 && k >= 0) {                                              // a slim opening light with its own frame
        const sm = (s0 + s1) / 2;
        quad(cell, sm - 0.46, sm + 0.46, g0, y1 - 0.2, cell.out2 + 0.06, p.frameColor);
        quad(cell, sm - 0.34, sm + 0.34, g0 + 0.12, y1 - 0.32, cell.out2 + 0.07, shade(glass, 1.2));
      }
    },
  },

  /** Apartment blocks (the neighbours of the campus): render, a window per bay, a balcony slab with a glass rail on every third bay. */
  balcony: {
    row(row, p) {
      ledge(row, row.run.s0, row.run.s1, row.y1 - 0.25, row.y1 - 0.02, 0.1, shade(row.run.wallColor, 0.9), shade(row.run.wallColor, 1.08));
    },
    cell(cell, p) {
      const { s0, s1, y0, y1 } = cell;
      const sm = (s0 + s1) / 2, hw = Math.min(p.w / 2, (s1 - s0) / 2 - 0.2);
      const wy0 = y0 + p.sill, wy1 = Math.min(y1 - 0.45, wy0 + p.h);
      if (wy1 - wy0 < 0.6) return;
      recessedGlass(cell, sm - hw, sm + hw, wy0, wy1, p.glass, cell.out1);
      if (cell.row > 0 && (cell.col + cell.row) % 3 === 0) {
        ledge(cell, s0 + 0.2, s1 - 0.2, y0 - 0.02, y0 + 0.2, 1.3, p.slab || [0.8, 0.8, 0.78]);
        gradientQuad(cell, s0 + 0.2, s1 - 0.2, y0 + 0.2, y0 + 1.05, 1.3, p.rail, shade(p.rail, 0.8));
      }
    },
  },

  /** The round windows of a concrete stair tower (International School): one porthole per bay and storey, some with a white blind, a slab edge between storeys. */
  portholes: {
    row(row, p) {
      ledge(row, row.run.s0, row.run.s1, row.y1 - 0.3, row.y1, 0.28, shade(row.run.wallColor, 0.92), shade(row.run.wallColor, 1.1));
    },
    cell(cell, p) {
      const sm = (cell.s0 + cell.s1) / 2, yc = (cell.y0 + cell.y1) / 2 + 0.2;
      const big = hashUnit(cell.col * 7 + cell.row) < 0.5;
      const white = hashUnit(cell.seed) < 0.3;
      disc(cell, sm, yc, big ? p.r * 1.15 : p.r * 0.85, cell.out2, white ? p.white : p.hole, 8);
    },
  },

  /** The Lycée Aline Mayrisch (photo LAML_04, Aline_Mayrisch_101): pale greige render panels, continuous window groups in light frames with a
   * transom and slim mullions over a grey spandrel band, narrow pilasters between the groups, a blank end wall over the pilotis at the east end. */
  laml: {
    row(row, p) {
      const { run, y0, y1 } = row;
      const wy0 = y0 + p.sill, wy1 = Math.min(y1 - 0.4, wy0 + p.h);
      if (wy1 - wy0 < 0.8) return;
      if (p.gf && p.gf.abs && y1 <= p.gf.abs[0] + 0.2) return;                                              // the sunken storey under the yard deck is hidden behind its edge
      const top = row.row === 0;
      const sizes = top ? p.groupsTop : p.groups;
      const gapMin = top ? p.gapTop : p.gapMin, gapMax = top ? p.gapTop : p.gapMax;
      quad(row, run.s0 + (p.endWall ?? 0), run.s1 - 0.8, y0, wy0 - 0.02, OUT_1, p.spandrel);                  // the grey sill panels, one band along the storey
      ledge(row, run.s0, run.s1, y1 - 0.34, y1 - 0.02, 0.16, p.band, shade(p.band, 1.08));                 // the slab-edge band
      // the porches (gaps of the wall that reach into this storey) stay free: the groups stop beside them
      const blocked = (run.gaps || []).filter((g) => g.kind === 'recess' && g.yt > y0 + 0.1 && g.yb < y1 - 0.1).map((g) => [g.s0 - PORCH_MARGIN, g.s1 + PORCH_MARGIN]).sort((a, b) => a[0] - b[0]);
      let s = run.s0 + (p.endWall ?? 0) + p.pier;
      let n = 0;
      while (s < run.s1 - p.pier - 3) {
        const seed = row.cells[0].seed + n * 977;
        const hit = blocked.find((b) => s < b[1] && s + 1 > b[0]);
        if (hit) { s = hit[1]; continue; }
        const next = blocked.find((b) => b[0] > s);
        const room = Math.min(run.s1 - p.pier, next ? next[0] : Infinity) - s;
        if (room < 3) { s = next ? next[1] : run.s1; continue; }
        const len = Math.min(room, sizes[Math.floor(hashUnit(seed) * sizes.length) % sizes.length]);
        const gs1 = s + len;
        groupWindow(row, s, gs1, wy0, wy1, y0, y1, p, seed);
        s = gs1 + gapMin + hashUnit(seed + 1) * (gapMax - gapMin);
        n += 1;
      }
    },
    cell() {},
  },
};


/** One window group: a light surround standing out of the wall, the glass set back inside it with a transom, slim light mullions, a pilaster at each end. */
function groupWindow(row, s0, s1, y0, y1, yMin, yMax, p, seed) {
  const sur = p.surround;
  ledge(row, s0 - sur, s1 + sur, y1, y1 + sur, 0.22, p.frame, shade(p.frame, 1.06));              // the head
  shelf(row, s0 - sur, s1 + sur, y0, 0.24, sur, p.frame, shade(p.frame, 1.08));                    // the sill
  quad(row, s0 - sur, s0, y0 - 0.02, y1 + 0.02, 0.22, p.frame);                                   // the jambs
  quad(row, s1, s1 + sur, y0 - 0.02, y1 + 0.02, 0.22, p.frame);
  const glass = paint(p.glass, seed, 0.08);
  gradientQuad(row, s0, s1, y0, y1, 0.08, shade(glass, 1.25), shade(glass, 0.5));                 // the reflected sky above the dark room
  const tr = y0 + (y1 - y0) * 0.68;
  quad(row, s0, s1, tr - 0.04, tr + 0.04, 0.14, p.frame);                                          // the transom
  const n = Math.max(1, Math.round((s1 - s0) / p.mull));
  for (let k = 1; k < n; k++) quad(row, s0 + ((s1 - s0) * k) / n - 0.04, s0 + ((s1 - s0) * k) / n + 0.04, y0, y1, 0.14, p.mullion);
  quad(row, s0 - sur - 0.7, s0 - sur, yMin + 0.1, yMax - 0.4, 0.1, p.pilaster);                   // the narrow pilasters of the grey panels
}
