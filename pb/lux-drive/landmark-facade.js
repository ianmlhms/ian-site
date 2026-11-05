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

/**
 * The frame of a straight line from a to b whose front faces AWAY from `inside` (a point of the building): like edgeFrame, for a front that is not one edge of the footprint.
 * `shift` moves the plane `shift` m out of the line (the facade of the Palais stands in front of the three runs of its outline).
 */
export function lineFrame(a, b, inside, shift = 0) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) throw new Error('lineFrame: the line has no length');
  const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
  let nx = -dz, nz = dx;
  if ((inside[0] - a[0]) * nx + (inside[1] - a[1]) * nz > 0) { nx = -nx; nz = -nz; }
  return { a, b, len, dx, dz, nx, nz, yaw: Math.atan2(-dz, dx), at: (s, y, out = 0) => [a[0] + dx * s + nx * (out + shift), y, a[1] + dz * s + nz * (out + shift)] };
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

/**
 * Slates on a roof face: courses of rectangular slates (rowH x colW, every second course shifted by half a slate, each slate its own shade, a dark gap between them) lying
 * `lift` m above the plane bl-br-tl-tr (bl, br at the eave, tl, tr at the ridge; tl = tr for a triangle).  The face under them stays the dark slate colour of the roof,
 * so the gaps read as the joints.  Real geometry (two triangles a slate), so use it on the big roofs only.
 */
export function slateFace(soup, bl, br, tl, tr, { rowH = 0.8, colW = 1.3, color, key = 0, gap = 0.07, lift = 0.03 } = {}) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const u = sub(br, bl), v = sub(tl, bl);
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const nl = Math.hypot(...n);
  if (nl < 1e-9) return;
  n = n.map((c) => c / nl);
  const up = n[1] < 0 ? -1 : 1;                                       // the side of the face that looks up
  n = n.map((c) => c * up * lift);
  const slope = Math.hypot(...v);
  const rows = Math.max(1, Math.round(slope / rowH));
  const lift3 = (p) => [p[0] + n[0], p[1] + n[1], p[2] + n[2]];
  for (let j = 0; j < rows; j++) {
    const t0 = j / rows, t1 = (j + 1) / rows, tg = Math.min(0.45 / rows, gap / slope);
    const L0 = lerp(bl, tl, t0 + tg), R0 = lerp(br, tr, t0 + tg), L1 = lerp(bl, tl, t1 - tg), R1 = lerp(br, tr, t1 - tg);
    const width = Math.hypot(...sub(lerp(br, tr, (t0 + t1) / 2), lerp(bl, tl, (t0 + t1) / 2)));
    const cols = Math.max(1, Math.round(width / colW)), stag = (j % 2) * 0.5;
    for (let k = -1; k < cols; k++) {
      const a = Math.max(0, (k + stag) / cols), b = Math.min(1, (k + 1 + stag) / cols);
      const ug = Math.min(0.45 / cols, gap / Math.max(width, 1e-6));
      if (b - a <= 2 * ug + 1e-6) continue;
      const p00 = lerp(L0, R0, a + ug), p10 = lerp(L0, R0, b - ug), p11 = lerp(L1, R1, b - ug), p01 = lerp(L1, R1, a + ug);
      const q = up > 0 ? [p00, p10, p11, p01] : [p00, p01, p11, p10];
      soup.quad(lift3(q[0]), lift3(q[1]), lift3(q[2]), lift3(q[3]), paint(color, key + j * 131 + k * 17, 0.07));
    }
  }
}
