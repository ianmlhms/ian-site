/* The extras on the flat roofs of the campus: solar panels, sawtooth skylights (the École de Commerce), plant boxes.
 * Each extra is a list of oriented rectangles [cx, cz, length, width, degrees (0 = east, 90 = south)] on the roof at `top`.  Pure (no THREE). */
import { paint } from './landmark-soup.js';
import { scalePoly } from './landmark-util.js';

const SOLAR = [0.13, 0.19, 0.33];       // the dark blue of a solar panel
const SOLAR_FRAME = [0.62, 0.64, 0.66];
const PANEL_ROW = 1.35;                 // m: one row of panels (a quad)
const PANEL_GAP = 0.45;                 // m: the gap between two rows
const PANEL_LIFT = 0.35;                // m: the panels float a hand above the membrane
const TOOTH_RISE = 1.1;                 // m: the height of a sawtooth skylight
const PLANT = [0.60, 0.61, 0.62];

/** The corners of an oriented rectangle as a function (u along, v across) -> [x, z]. */
function frameOf(cx, cz, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return (u, v) => [cx + u * c - v * s, cz + u * s + v * c];
}

/** Rows of solar panels over a rectangle: one dark quad per row, a pale frame strip on the near edge. */
export function solarField(soup, top, [cx, cz, len, wid, deg]) {
  const at = frameOf(cx, cz, deg);
  const y = top + PANEL_LIFT;
  const rows = Math.max(1, Math.floor(wid / (PANEL_ROW + PANEL_GAP)));
  const pitch = wid / rows;
  for (let r = 0; r < rows; r++) {
    const v0 = -wid / 2 + r * pitch + PANEL_GAP / 2, v1 = v0 + PANEL_ROW;
    const [a, b, c, d] = [at(-len / 2, v0), at(len / 2, v0), at(len / 2, v1), at(-len / 2, v1)];
    soup.quad([a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]], [d[0], y, d[1]], paint(SOLAR, r * 5 + 3, 0.06));
    soup.quad([a[0], y - 0.02, a[1]], [b[0], y - 0.02, b[1]], [b[0], y + 0.0, b[1]], [a[0], y + 0.0, a[1]], SOLAR_FRAME);
  }
}

/** A row of sawtooth skylights: triangular ridges along `len`, one every `pitch` across the width; the steep side is the glass. */
export function sawtooth(soup, top, [cx, cz, len, wid, deg, pitch = 3.2], color = [0.86, 0.88, 0.90], glass = [0.62, 0.72, 0.80]) {
  const at = frameOf(cx, cz, deg);
  const n = Math.max(1, Math.floor(wid / pitch));
  const w = wid / n;
  for (let i = 0; i < n; i++) {
    const v0 = -wid / 2 + i * w, v1 = v0 + w;
    const lo0 = at(-len / 2, v0), lo1 = at(len / 2, v0), hi0 = at(-len / 2, v0 + w * 0.15), hi1 = at(len / 2, v0 + w * 0.15);
    const e0 = at(-len / 2, v1), e1 = at(len / 2, v1);
    const y = top + 0.05, yr = top + TOOTH_RISE;
    soup.quad([lo0[0], y, lo0[1]], [lo1[0], y, lo1[1]], [hi1[0], yr, hi1[1]], [hi0[0], yr, hi0[1]], glass);                 // the steep glazed side
    soup.quad([hi0[0], yr, hi0[1]], [hi1[0], yr, hi1[1]], [e1[0], y, e1[1]], [e0[0], y, e0[1]], paint(color, i, 0.03));   // the long slope
    soup.tri([lo0[0], y, lo0[1]], [hi0[0], yr, hi0[1]], [e0[0], y, e0[1]], color);
    soup.tri([lo1[0], y, lo1[1]], [e1[0], y, e1[1]], [hi1[0], yr, hi1[1]], color);
  }
}

/** A plant box on the roof: [cx, cz, length, width, degrees, height, color?]. */
export function plantBox(soup, top, [cx, cz, len, wid, deg, h = 1.6, color = PLANT]) {
  soup.box(cx, top, cz, len, h, wid, -(deg * Math.PI) / 180, paint(color, Math.round(cx * 7 + cz), 0.05), { topColor: color });
}

/** A hipped roof: the outline at `top`, a smaller copy of it (the ridge) `rise` higher; the flat part on top is the part's roof colour. */
export function hippedRoof(soup, part, { rise, inset = 0.5, color }) {
  const top = part.top;
  const ridge = scalePoly(part.pts, inset);
  const n = part.pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = part.pts[i], b = part.pts[j], c = ridge[j], d = ridge[i];
    soup.quad([a[0], top, a[1]], [b[0], top, b[1]], [c[0], top + rise, c[1]], [d[0], top + rise, d[1]], paint(color, i * 5 + 1, 0.04));
  }
  return { ridge, y: top + rise };
}

/** Draws the roof extras of a part: part.rf = { solar: [rect...], sawtooth: [rect...], plant: [rect...] }. */
export function drawRoofExtras(soup, part) {
  const rf = part.rf || {};
  for (const r of rf.solar || []) solarField(soup, part.top, r);
  for (const r of rf.sawtooth || []) sawtooth(soup, part.top, r);
  for (const r of rf.plant || []) plantBox(soup, part.top, r);
}
