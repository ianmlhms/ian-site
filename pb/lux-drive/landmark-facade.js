/* Facade helpers for the landmark buildings: a wall edge of a footprint becomes a frame (along, up, out), and windows, bands,
 * fins, turrets and pinnacles are placed in that frame.  Pure (no THREE); nothing here mutates its inputs.
 *
 * The frame of an edge: s runs along the edge from its first to its second point, y is the height, `out` is the distance in front
 * of the wall (the outward side is found by testing which side lies outside the footprint, so the winding never matters). */
import { paint } from './landmark-soup.js';
import { insidePoly } from './landmark-util.js';

const EPS_OUT = 0.04;                      // m, a panel stands this far in front of the wall so it never z-fights with it

/** The frame of edge i of a footprint polygon [[x, z], ...]. */
export function edgeFrame(poly, i) {
  const a = poly[i], b = poly[(i + 1) % poly.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) throw new Error(`edgeFrame: edge ${i} has no length`);
  const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
  let nx = -dz, nz = dx;
  if (insidePoly(poly, (a[0] + b[0]) / 2 + nx * 0.5, (a[1] + b[1]) / 2 + nz * 0.5)) { nx = -nx; nz = -nz; }
  return { a, b, len, dx, dz, nx, nz, yaw: Math.atan2(-dz, dx), at: (s, y, out = 0) => [a[0] + dx * s + nx * out, y, a[1] + dz * s + nz * out] };
}

/** A flat panel on the wall plane (s0..s1 along, y0..y1 up) at `out` m in front of it. */
export function panel(soup, f, s0, s1, y0, y1, out, color) {
  soup.quad(f.at(s0, y0, out), f.at(s1, y0, out), f.at(s1, y1, out), f.at(s0, y1, out), color);
}

/** A box that stands on the wall: s0..s1 along, y0..y1 up, `depth` m in front of the wall (out0 = where it starts). */
export function slab(soup, f, s0, s1, y0, y1, depth, color, { out0 = 0, topColor = null } = {}) {
  const [cx, , cz] = f.at((s0 + s1) / 2, y0, out0 + depth / 2);
  soup.box(cx, y0, cz, s1 - s0, y1 - y0, depth, f.yaw, color, { topColor });
}

/**
 * A grid of rectangular windows: `rows` rows of floorH, windows w x h every `pitch` m between s0 and s1, the first row's sill at y0.
 * Each window is a pale stone surround and a dark pane in front of it; `skip(row, column)` leaves a window out (a door, a turret).
 */
export function windowGrid(soup, f, { s0, s1, y0, rows, floorH, w, h, pitch, frame, glass, skip = null, key = 0 }) {
  const n = Math.max(0, Math.floor((s1 - s0) / pitch));
  const margin = (s1 - s0 - n * pitch) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < n; c++) {
      if (skip && skip(r, c)) continue;
      const sc = s0 + margin + (c + 0.5) * pitch, ya = y0 + r * floorH;
      panel(soup, f, sc - w / 2 - 0.25, sc + w / 2 + 0.25, ya - 0.2, ya + h + 0.25, EPS_OUT, paint(frame, key + r * 31 + c, 0.03));
      panel(soup, f, sc - w / 2, sc + w / 2, ya, ya + h, EPS_OUT * 2, paint(glass, key + r * 17 + c, 0.06));
    }
  }
}

/** A pointed (lancet) window: a rectangle of width w and height h with a gable of two straight slopes on top. */
export function lancet(soup, f, sc, y0, w, h, frame, glass) {
  const rise = w * 0.95, hw = w / 2;
  const ring = (inset, out, color, key) => {
    const a = hw + inset, h0 = y0 - inset, h1 = y0 + h, top = y0 + h + rise + inset * 1.2;
    soup.quad(f.at(sc - a, h0, out), f.at(sc + a, h0, out), f.at(sc + a, h1, out), f.at(sc - a, h1, out), paint(color, key, 0.03));
    soup.tri(f.at(sc - a, h1, out), f.at(sc + a, h1, out), f.at(sc, top, out), paint(color, key + 1, 0.03));
  };
  ring(0.35, EPS_OUT, frame, 3);
  ring(0, EPS_OUT * 2, glass, 5);
}

/** A tall pointed portal: stone surround, dark leaves. */
export function portal(soup, f, sc, y0, w, h, frame, glass) {
  lancet(soup, f, sc, y0, w + 1.0, h, frame, frame);
  lancet(soup, f, sc, y0, w, h * 0.92, frame, glass);
}

/** A horizontal course (a band of darker or lighter stone) around an edge, standing `depth` out of the wall. */
export function course(soup, f, y0, y1, depth, color, key = 0, s0 = 0, s1 = f.len) {
  slab(soup, f, s0, s1, y0, y1, depth, paint(color, key, 0.02), { topColor: color });
}

/** Vertical fins along an edge: a box of w x depth every `pitch` m, from the ground-hugging bottom yBottom(s) to yTop. */
export function fins(soup, f, { s0 = 0, s1 = f.len, pitch, w, depth, yBottom, yTop, color, key = 0 }) {
  const n = Math.max(1, Math.floor((s1 - s0) / pitch));
  const step = (s1 - s0) / n;
  for (let i = 0; i <= n; i++) {
    const s = s0 + i * step;
    const [x, , z] = f.at(s, 0, depth / 2);
    const yb = yBottom(x, z);
    soup.box(x, yb, z, w, yTop - yb, depth, f.yaw, paint(color, key + i * 13, 0.07), { topColor: color });
  }
}

/** A round turret with a conical roof: shaft r from y0 to y1 (a frustum of `sides`), cone to yTip. */
export function turret(soup, x, z, r, y0, y1, yTip, wall, roof, { sides = 8, eaves = 0.35 } = {}) {
  soup.frustum(x, z, r, r, y0, y1, sides, wall, { cap: false });
  soup.frustum(x, z, r + eaves, r * 0.12, y1, yTip, sides, roof, { cap: false });
}

/**
 * The joints of dressed stone on a wall: thin darker bands, one per course (rowH apart) the whole length, and short vertical joints in every course, staggered
 * by half a block from one course to the next (colW = the length of a block).  Painted relief only (0.03 m proud of the wall): no depth, but the wall stops being one flat colour.
 */
export function joints(soup, f, { s0 = 0, s1 = f.len, y0, y1, rowH, colW, color, key = 0, width = 0.09, vertical = true }) {
  const rows = Math.max(0, Math.floor((y1 - y0) / rowH));
  for (let r = 0; r < rows; r++) {
    const ya = y0 + r * rowH, yb = ya + rowH;
    if (r > 0) panel(soup, f, s0, s1, ya - width / 2, ya + width / 2, EPS_OUT, paint(color, key + r, 0.04));
    if (!vertical) continue;
    for (let s = s0 + (r % 2 ? colW / 2 : colW); s < s1 - 0.2; s += colW) panel(soup, f, s - width / 2, s + width / 2, ya, yb, EPS_OUT, paint(color, key + r * 53 + Math.round(s * 3), 0.04));
  }
}

/** A round-headed (semicircular) window or door: stone surround, dark leaves; w wide, the rectangle h high, a half disc on top. */
export function roundArch(soup, f, sc, y0, w, h, frame, glass, steps = 8) {
  const hw = w / 2;
  const one = (inset, out, color, key) => {
    const a = hw + inset;
    soup.quad(f.at(sc - a, y0 - inset, out), f.at(sc + a, y0 - inset, out), f.at(sc + a, y0 + h, out), f.at(sc - a, y0 + h, out), paint(color, key, 0.03));
    for (let i = 0; i < steps; i++) {
      const t0 = Math.PI * (i / steps), t1 = Math.PI * ((i + 1) / steps);
      soup.tri(f.at(sc, y0 + h, out), f.at(sc + Math.cos(t0) * a, y0 + h + Math.sin(t0) * a, out), f.at(sc + Math.cos(t1) * a, y0 + h + Math.sin(t1) * a, out), paint(color, key + i, 0.03));
    }
  };
  one(0.3, EPS_OUT, frame, 11);
  one(0, EPS_OUT * 2, glass, 13);
}
