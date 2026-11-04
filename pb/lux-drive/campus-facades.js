/* The facades of the campus buildings.  A wall run (campus-walls.js) is drawn as a wall with GAPS (a recessed storey on pilotis, an entrance
 * porch) plus a grid of CELLS (one bay wide, one storey high, counted from the roof down so a building on a slope loses its lowest rows into
 * the hill, like the real ones); each style (campus-styles.js) paints one cell and, once per storey, the floor-slab edges.  Depth comes from
 * real geometry (recessed floors, projecting slab edges and sills, sun-blind boxes, pilasters) and from painted shadow strips under them.
 * Pure (no THREE). */
import { paint } from './landmark-soup.js';
import { STYLES } from './campus-styles.js';
import { SINK, MIN_VISIBLE, OUT_1, OUT_2, quad, ledge, pier, shade, inGap, wallBase, recessBox, matchOnRun } from './campus-kit.js';
import { drawWallFeatures } from './campus-wallfx.js';

const WALL_STEP = 6;               // m: the wall base follows the ground at least this often
const COPING = 0.3;                // m: the roof edge stands this far out of the wall
const RAIL_POST = 2.4;             // m: the posts of a railing
const END_PIER = 1.2;              // m: the recessed floor stops this far from the end of a wall (a corner pier)

/** The wall of a run over the interval [sa, sb] from y(sa) to y(sb) at the bottom to `top`, in steps that follow the ground. */
function wallStrip(soup, run, sa, sb, bottomAt, top, color, key) {
  const f = run.frame;
  const steps = Math.max(1, Math.ceil((sb - sa) / WALL_STEP));
  for (let k = 0; k < steps; k++) {
    const a = sa + ((sb - sa) * k) / steps, b = sa + ((sb - sa) * (k + 1)) / steps;
    const [xa, , za] = f.at(a, 0), [xb, , zb] = f.at(b, 0);
    const ya = bottomAt(a, xa, za), yb = bottomAt(b, xb, zb);
    if (ya >= top && yb >= top) continue;
    soup.quad([xa, ya, za], [xb, yb, zb], [xb, top, zb], [xa, top, za], paint(color, key * 31 + k + Math.round(sa), 0.025));
  }
}

/** The plain wall of a run, from the ground (or the lower neighbour's roof) to `top`; a gap leaves its opening out. */
export function drawWall(soup, run, ground, top, color, key) {
  const gaps = run.gaps || [];
  const cuts = new Set([run.s0, run.s1]);
  for (const g of gaps) { if (g.s0 > run.s0) cuts.add(g.s0); if (g.s1 < run.s1) cuts.add(g.s1); }
  const marks = [...cuts].filter((s) => s >= run.s0 && s <= run.s1).sort((a, b) => a - b);
  const onGround = (s, x, z) => run.lowerY ?? ground(x, z) - SINK;
  for (let i = 0; i + 1 < marks.length; i++) {
    const sa = marks[i], sb = marks[i + 1];
    if (sb - sa < 0.01) continue;
    const mid = (sa + sb) / 2;
    const open = gaps.filter((g) => mid > g.s0 && mid < g.s1);
    if (!open.length) { wallStrip(soup, run, sa, sb, onGround, top, color, key); continue; }
    const low = Math.min(...open.map((g) => g.yb)), high = Math.max(...open.map((g) => g.yt));
    if (open.some((g) => g.yb - g.base > 0.5)) wallStrip(soup, run, sa, sb, onGround, low, color, key);   // the storey under a lifted opening
    wallStrip(soup, run, sa, sb, () => high, top, color, key + 1);                                       // the wall above it
  }
}

/** The roof edge: a thin projecting course (concrete coping or a fascia) over the top of the wall. */
export function drawCoping(soup, run, top, color) {
  const ctx = { soup, f: run.frame };
  ledge(ctx, run.s0 - 0.1, run.s1 + 0.1, top - 0.45, top + 0.05, COPING, color, shade(color, 1.08));
}

/** The gaps of a run: recessed floors on pilotis and entrance porches (the features of kind 'recess', drawn by campus-wallfx.js). */
export function planRun(run, part, ground) {
  const p = part.fp || {};
  const gaps = [];
  const plinthHere = p.plinth && (p.plinth.facing !== 'south' || run.frame.nz > 0.5);
  const gfFacing = !p.gf || p.gf.facing !== 'north' || run.frame.nz < -0.5;
  const gf = p.gf && gfFacing && !plinthHere && run.lowerY === null && run.s1 - run.s0 > END_PIER * 2 + 3 ? p.gf : null;
  const recesses = (part.ft || []).filter((ft) => ft.k === 'recess').map((ft) => ({ ft, m: matchOnRun(run, ft) })).filter((r) => r.m);
  if (gf) {
    // the recessed floor stops at the porches: an entrance has its own, deeper recess
    let spans = [[run.s0 + END_PIER, run.s1 - END_PIER]];
    for (const { ft, m } of recesses) {
      const a = m.s - ft.w / 2, b = m.s + ft.w / 2;
      spans = spans.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [[x, Math.min(y, a)], [Math.max(x, b), y]])).filter(([x, y]) => y - x > 1.0);
    }
    const lift = gf.lift ?? 0;
    for (const [s0, s1] of spans) {
      const base = wallBase(run, ground, (s0 + s1) / 2);
      const [yb, yt] = gf.abs || [base + lift, base + lift + gf.h];          // `abs`: absolute levels (a flat deck whose floors line up with the rows of the grid)
      gaps.push({ kind: 'gf', s0, s1, yb, yt, depth: gf.depth ?? 0, base, cells: yb - base > 0.5 });
    }
  }
  for (const { ft, m } of recesses) {
    const base = wallBase(run, ground, m.s);
    gaps.push({ kind: 'recess', ft, s0: m.s - ft.w / 2, s1: m.s + ft.w / 2, yb: base + (ft.lift ?? 0), yt: base + (ft.lift ?? 0) + ft.h, depth: ft.depth, base, cells: true });
  }
  return { ...run, gaps, plinthHere, wallColor: part.wall };
}

/** The recessed floor of a gap of kind 'gf': back glass, mullions, pilotis piers, cheeks and soffit. */
function drawRecessedFloor(ctx, run, g, ground, gf) {
  const { soup, f } = ctx;
  const depth = g.depth || 0;
  const pitch = gf.pitch || 3.6;
  const n = Math.max(1, Math.round((g.s1 - g.s0) / pitch));
  const bay = (g.s1 - g.s0) / n;
  const lowest = Math.min(...Array.from({ length: n + 1 }, (_, k) => wallBase(run, ground, g.s0 + k * bay)));
  const lifted = g.yb - g.base > 0.5;
  const yFloor = lifted ? g.yb - 0.05 : Math.min(g.yb, lowest) - 0.3;
  if (depth > 0.3) recessBox(ctx, g, { depth, back: paint(gf.glass, run.i, 0.08), cheek: gf.pier, soffit: shade(gf.pier, 0.8), yFloor });
  for (let k = 0; k < n; k++) {
    const sa = g.s0 + k * bay, sb = sa + bay;
    const base = lifted ? g.yb : wallBase(run, ground, (sa + sb) / 2);
    if (depth > 0.3) {
      quad(ctx, sa + 0.12, sb - 0.12, base - 0.2, g.yt - 0.45, -depth + 0.05, paint(gf.glass, k + run.i * 3, 0.1));
      quad(ctx, sa - 0.04, sa + 0.04, base - 0.2, g.yt - 0.45, -depth + 0.1, gf.mullion || gf.pier);
      if (gf.rail && gf.railOut === undefined) { quad(ctx, sa + 0.3, sb - 0.3, base, base + 1.0, -0.25, gf.rail); quad(ctx, sa + 0.3, sb - 0.3, base + 1.0, base + 1.08, -0.24, shade(gf.rail, 1.25)); }
    } else {
      quad(ctx, sa + 0.3, sb - 0.3, base - 0.3, g.yt - 0.5, OUT_1, paint(gf.glass, k + run.i * 3, 0.1));
    }
    if (k % (gf.every || 2) === 0) pier(ctx, sa - (gf.pierW ?? 0.6) / 2, sa + (gf.pierW ?? 0.6) / 2, base - 0.3, g.yt, depth > 0.3 ? Math.min(depth, 1.0) : 0.3, gf.pier, null, depth > 0.3 ? -Math.min(depth, 1.0) + 0.05 : OUT_1);
  }
  pier(ctx, g.s1 - (gf.pierW ?? 0.6) / 2, g.s1 + (gf.pierW ?? 0.6) / 2, lowest - 0.3, g.yt, depth > 0.3 ? Math.min(depth, 1.0) : 0.3, gf.pier, null, depth > 0.3 ? -Math.min(depth, 1.0) + 0.05 : OUT_1);
  if (gf.rail && gf.railOut !== undefined && lifted) drawRailing(ctx, g, gf);
  // the fascia of the floor above: a pale band on the edge of the slab
  ledge(ctx, g.s0, g.s1, g.yt - 0.5, g.yt, 0.25, gf.pier, shade(gf.pier, 1.06));
}

/** The railing along the edge of a yard deck in front of a recessed floor (photo LAML_04): a low concrete kerb, mesh panels between slim posts, a light top rail. */
function drawRailing(ctx, g, gf) {
  const out = gf.railOut, y0 = g.yb;
  const mesh = gf.rail, kerb = shade(gf.pier, 0.9);
  const a = g.s0 + 0.5, b = g.s1 - 0.5;
  quad(ctx, a, b, y0 - 0.25, y0 + 0.4, out, kerb);                                         // the concrete foot
  quad(ctx, a, b, y0 + 0.4, y0 + 1.2, out + 0.02, mesh);                                  // the mesh
  quad(ctx, a, b, y0 + 1.16, y0 + 1.26, out + 0.04, shade(mesh, 1.3));                    // the top rail
  const n = Math.max(1, Math.round((b - a) / RAIL_POST));
  for (let k = 0; k <= n; k++) { const s = a + ((b - a) * k) / n; quad(ctx, s - 0.04, s + 0.04, y0 + 0.4, y0 + 1.26, out + 0.06, shade(mesh, 0.72)); }
}

/** A plinth: a band of another material (concrete) along the foot of the wall, `h` high, with a capping course on top. */
function drawPlinth(ctx, run, ground, { h, color, holes = 0 }) {
  const steps = Math.max(1, Math.ceil((run.s1 - run.s0) / WALL_STEP));
  for (let k = 0; k < steps; k++) {
    const sa = run.s0 + ((run.s1 - run.s0) * k) / steps, sb = run.s0 + ((run.s1 - run.s0) * (k + 1)) / steps;
    const ya = wallBase(run, ground, sa), yb = wallBase(run, ground, sb);
    const [a, b] = [ctx.f.at(sa, ya - SINK, OUT_1 * 0.5), ctx.f.at(sb, yb - SINK, OUT_1 * 0.5)];
    const [c, d] = [ctx.f.at(sb, yb + h, OUT_1 * 0.5), ctx.f.at(sa, ya + h, OUT_1 * 0.5)];
    ctx.soup.quad(a, b, c, d, paint(color, k + run.i * 7, 0.03));
  }
  // the round holes of the concrete wall of the Lycée Aline Mayrisch (photo Aline_Mayrisch_103): dark discs along it
  if (holes) for (let s = run.s0 + holes / 2; s < run.s1 - 1; s += holes) {
    const y = wallBase(run, ground, s) + 2.4;
    const ring = Array.from({ length: 8 }, (_, i) => ctx.f.at(s + Math.cos((i / 8) * Math.PI * 2) * 0.4, y + Math.sin((i / 8) * Math.PI * 2) * 0.4, OUT_1 * 0.5 + 0.03));
    for (let i = 0; i < 8; i++) ctx.soup.tri(ctx.f.at(s, y, OUT_1 * 0.5 + 0.03), ring[i], ring[(i + 1) % 8], [0.14, 0.14, 0.16]);
  }
}

/**
 * Calls `cellFn(cell)` for every bay x storey of the run, `rowFn(row)` once per storey: cell = { soup, f, run, s0, s1, y0, y1, row, rows, col,
 * cols, seed, out1, out2, base }; row = { soup, f, run, s0, s1, y0, y1, row, rows, cells }.  `margin` is the plain pier at both ends.
 */
export function bayGrid(soup, run, part, ground, { floorH, pitch, margin = 0.8, inset = 0.5, plinth = 0 }, cellFn, rowFn) {
  const f = run.frame;
  const room = run.s1 - run.s0 - 2 * margin;
  if (room < pitch * 0.6) return;
  const cols = Math.max(1, Math.round(room / pitch));
  const bay = room / cols;
  const rows = Math.ceil((part.top - inset - (part.low ?? part.top - 40)) / floorH);
  for (let r = 0; r < rows; r++) {
    const y1 = part.top - inset - r * floorH;
    const cells = [];
    for (let c = 0; c < cols; c++) {
      const s0 = run.s0 + margin + c * bay, s1 = s0 + bay, sm = (s0 + s1) / 2;
      const base = wallBase(run, ground, sm) + plinth;
      let y0 = y1 - floorH;
      if (y1 - base < MIN_VISIBLE) continue;
      if (y0 < base + 0.3) y0 = base;
      if (y1 - y0 < floorH * 0.55) continue;
      if (inGap(run, s0, s1, y0, y1)) continue;
      cells.push({ soup, f, run, s0, s1, y0, y1, row: r, rows, col: c, cols, seed: (part.seed * 7919 + c * 131 + r * 17 + run.i * 977) | 0, out1: OUT_1, out2: OUT_2, base });
    }
    if (!cells.length) continue;
    if (rowFn) rowFn({ soup, f, run, s0: run.s0 + margin, s1: run.s1 - margin, y0: Math.min(...cells.map((c) => c.y0)), y1, row: r, rows, cells });
    for (const cell of cells) cellFn(cell);
  }
}

/**
 * Draws the facade of a run: the cells of the part's style plus the recessed floors, the plinth and the features on the wall.  The plain wall
 * is drawn by the caller (drawWall) from the same run.  part.fx = the style (campus-styles.js), part.fp = its parameters (the bake spec).
 */
export function drawFacade(soup, run, part, ground) {
  const style = STYLES[part.fx];
  if (!style) throw new Error(`campus: unknown facade style '${part.fx}' of part ${part.key}`);
  const ctx = { soup, f: run.frame };
  const p = part.fp;
  const gf = (run.gaps || []).find((g) => g.kind === 'gf');
  const plinth = run.plinthHere ? p.plinth.h : gf && !(gf.yb - gf.base > 0.5) ? p.gf.h : 0;
  if (part.fx !== 'blank') {
    const pitch = p.pitch || p.mull || 2.8;
    bayGrid(soup, run, part, ground, { floorH: p.floorH || 3.4, pitch, margin: p.pier ?? 0.8, inset: p.inset ?? 0.5, plinth }, (cell) => style.cell && style.cell(cell, p, part), style.row && ((row) => style.row(row, p, part)));
  }
  if (run.plinthHere) drawPlinth(ctx, run, ground, p.plinth);
  for (const g of (run.gaps || [])) if (g.kind === 'gf') drawRecessedFloor(ctx, run, g, ground, p.gf);       // every span of the recessed floor, not only the first
  drawWallFeatures(ctx, run, part, ground);
}
