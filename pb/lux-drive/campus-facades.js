/* The facades of the campus buildings.  A wall run (campus-walls.js) is drawn as a plain wall plus a grid of CELLS (one bay wide, one
 * storey high, counted from the roof down so a building on a slope loses its lowest rows into the hill, like the real ones); each style
 * is a function that paints one cell.  Windows are single flat quads in front of the wall (the gap between two bays is the wall
 * colour showing: the mullion), so a long wing costs two triangles per window, not twelve.  Pure (no THREE). */
import { paint } from './landmark-soup.js';
import { panel } from './landmark-facade.js';

const SINK = 1.0;                  // m: walls go this far under the ground (the ground is a carved lattice: no cracks)
const WALL_STEP = 6;               // m: the wall base follows the ground at least this often
const OUT_1 = 0.07, OUT_2 = 0.14;  // m: the first and second layer in front of the wall (further than the landmarks' 4 cm: far z-fighting)
const MIN_VISIBLE = 1.3;           // m: a row with less wall above the ground than this is not drawn

/** The plain wall of a run, from the ground (or the lower neighbour's roof) to `top`. */
export function drawWall(soup, run, ground, top, color, key) {
  const f = run.frame;
  const steps = Math.max(1, Math.ceil((run.s1 - run.s0) / WALL_STEP));
  for (let k = 0; k < steps; k++) {
    const sa = run.s0 + ((run.s1 - run.s0) * k) / steps, sb = run.s0 + ((run.s1 - run.s0) * (k + 1)) / steps;
    const [xa, , za] = f.at(sa, 0), [xb, , zb] = f.at(sb, 0);
    const ya = run.lowerY ?? ground(xa, za) - SINK, yb = run.lowerY ?? ground(xb, zb) - SINK;
    soup.quad([xa, ya, za], [xb, yb, zb], [xb, top, zb], [xa, top, za], paint(color, key * 31 + k, 0.025));
  }
}

/** A plinth: a band of another material (concrete) along the foot of the wall, `h` high. */
function drawPlinth(soup, run, ground, { h, color }) {
  const steps = Math.max(1, Math.ceil((run.s1 - run.s0) / WALL_STEP));
  const f = run.frame;
  for (let k = 0; k < steps; k++) {
    const sa = run.s0 + ((run.s1 - run.s0) * k) / steps, sb = run.s0 + ((run.s1 - run.s0) * (k + 1)) / steps;
    const ya = wallBase(run, ground, sa), yb = wallBase(run, ground, sb);
    soup.quad(f.at(sa, ya - SINK, OUT_1 * 0.5), f.at(sb, yb - SINK, OUT_1 * 0.5), f.at(sb, yb + h, OUT_1 * 0.5), f.at(sa, ya + h, OUT_1 * 0.5), paint(color, k + run.i * 7, 0.03));
  }
}

/** The ground (or neighbour roof) under the wall at s. */
export const wallBase = (run, ground, s) => {
  const [x, , z] = run.frame.at(s, 0);
  return run.lowerY ?? ground(x, z);
};

/**
 * Calls `cellFn(cell)` for every bay x storey of the run: cell = { f, run, s0, s1, y0, y1, row, col, rows, cols, seed, out1, out2 }.
 * The rows are counted down from the roof; a row that straddles the ground is shortened; `margin` is the plain pier at both ends.
 */
export function bayGrid(soup, run, part, ground, { floorH, pitch, margin = 0.8, inset = 0.5, plinth = 0 }, cellFn) {
  const f = run.frame;
  const room = run.s1 - run.s0 - 2 * margin;
  if (room < pitch * 0.6) return;
  const cols = Math.max(1, Math.round(room / pitch));
  const bay = room / cols;
  const rows = Math.ceil((part.top - inset - (part.low ?? part.top - 40)) / floorH);
  for (let c = 0; c < cols; c++) {
    const s0 = run.s0 + margin + c * bay, s1 = s0 + bay, sm = (s0 + s1) / 2;
    const base = wallBase(run, ground, sm) + plinth;
    for (let r = 0; r < rows; r++) {
      const y1 = part.top - inset - r * floorH;
      let y0 = y1 - floorH;
      if (y1 - base < MIN_VISIBLE) break;
      if (y0 < base + 0.3) y0 = base;
      if (y1 - y0 < floorH * 0.55) break;
      cellFn({ soup, f, run, s0, s1, y0, y1, row: r, col: c, rows, cols, seed: (part.seed * 7919 + c * 131 + r * 17 + run.i * 977) | 0, out1: OUT_1, out2: OUT_2, base });
    }
  }
}

/** A coloured quad flush in front of the wall. */
export const quad = (cell, a0, a1, b0, b1, out, color) => panel(cell.soup, cell.f, a0, a1, b0, b1, out, color);

const hashUnit = (seed) => {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ 0x85ebca6b;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h >>> 8) & 0xffff) / 0xffff;
};
export { hashUnit };

/* ------------------------------------------------------------------------------------------------ the cell styles */
const STYLES = {
  /** Nothing but the wall (a hall, a plinth). */
  blank() {},

  /** Window ribbons: a glass quad per bay with a gap (the mullion), a sill strip, now and then a coloured sun blind. */
  ribbon(cell, p, part) {
    const { s0, s1, y0, row } = cell;
    const gap = 0.12;
    const wy0 = y0 + p.sill, wy1 = Math.min(cell.y1 - 0.5, y0 + p.sill + p.h);
    if (wy1 - wy0 < 0.5) return;
    quad(cell, s0 + gap, s1 - gap, wy0, wy1, cell.out1, paint(p.glass, cell.seed, 0.12));
    if (p.blind && (cell.col + row) % (p.blindEvery || 2) === 0) quad(cell, s0 + gap, s1 - gap, wy1 - 0.8, wy1, cell.out2, p.blind);
    if (p.sillBand) quad(cell, s0, s1, wy0 - 0.18, wy0, cell.out1, p.frame);
  },

  /** Punched windows with a coloured frame and a blind (Lycée Michel Rodange): a frame quad and a pane in it. */
  punched(cell, p) {
    const { s0, s1, y0 } = cell;
    const sm = (s0 + s1) / 2, hw = p.w / 2;
    const wy0 = y0 + p.sill, wy1 = Math.min(cell.y1 - 0.4, wy0 + p.h);
    if (wy1 - wy0 < 0.6) return;
    quad(cell, sm - hw, sm + hw, wy0, wy1, cell.out1, paint(p.frame, cell.seed, 0.05));
    const pane = hashUnit(cell.seed) < (p.blindShare ?? 0.3) ? p.blind : p.pane;
    quad(cell, sm - hw + 0.2, sm + hw - 0.2, wy0 + 0.2, wy1 - 0.2, cell.out2, paint(pane, cell.seed + 1, 0.06));
  },

  /** Coloured cladding panels (Blumm, Gaston Thorn, ENAD): every bay is a panel of the palette, a window in some. */
  panels(cell, p) {
    const { s0, s1, y0, y1 } = cell;
    const r = hashUnit(cell.seed);
    const color = p.palette[Math.floor(r * p.palette.length) % p.palette.length];
    quad(cell, s0 + 0.03, s1 - 0.03, y0 + 0.03, y1 - 0.03, cell.out1, paint(color, cell.seed, 0.06));
    if ((cell.col + cell.row * 2) % (p.windowEvery || 2) === 0) {
      const sm = (s0 + s1) / 2, hw = Math.min(p.w / 2, (s1 - s0) / 2 - 0.15);
      quad(cell, sm - hw, sm + hw, y0 + p.sill, Math.min(y1 - 0.5, y0 + p.sill + p.h), cell.out2, paint(p.glass, cell.seed + 5, 0.1));
    }
  },

  /** Pilasters between spandrels with red-framed windows (the École de Commerce): yellow panels, grey pebbled pilasters. */
  ecg(cell, p) {
    const { s0, s1, y0, y1 } = cell;
    const pil = 0.45;
    quad(cell, s0, s0 + pil, y0, y1 + 0.3, cell.out1, p.pilaster);
    quad(cell, s0 + pil, s1, y0 + 0.05, y1 - 0.05, cell.out1, paint(p.panel, cell.seed, 0.04));
    const wy0 = y0 + p.sill, wy1 = Math.min(y1 - 0.5, wy0 + p.h);
    if (wy1 - wy0 < 0.6) return;
    quad(cell, s0 + pil + 0.5, s1 - 0.5, wy0, wy1, cell.out2, p.frame);
    quad(cell, s0 + pil + 0.75, s1 - 0.75, wy0 + 0.2, wy1 - 0.2, cell.out2 + 0.05, paint(p.glass, cell.seed, 0.1));
  },

  /** A glass curtain wall: dark glass in light mullions (entrance halls, the Forum). */
  glass(cell, p) {
    const { s0, s1, y0, y1 } = cell;
    quad(cell, s0 + 0.08, s1 - 0.08, y0 + 0.1, y1 - 0.1, cell.out1, paint(p.glass, cell.seed, 0.14));
  },
};

/**
 * Draws the facade of a run: the plain wall (done by the caller) plus the cells of the part's style.
 * part.fx = 'ribbon' | 'punched' | 'panels' | 'ecg' | 'glass' | 'blank'; part.fp = its parameters (see the bake spec).
 */
export function drawFacade(soup, run, part, ground) {
  const style = STYLES[part.fx];
  if (!style) throw new Error(`campus: unknown facade style '${part.fx}' of part ${part.key}`);
  if (part.fx === 'blank') return;
  const p = part.fp;
  const pitch = p.pitch || p.mull || 2.8;
  const plinth = p.plinth ? p.plinth.h : 0;
  bayGrid(soup, run, part, ground, { floorH: p.floorH || 3.4, pitch, margin: p.pier ?? 0.8, inset: p.inset ?? 0.5, plinth }, (cell) => style(cell, p, part));
  if (plinth) drawPlinth(soup, run, ground, p.plinth);
}
