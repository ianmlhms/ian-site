/* Lettering for the signs of the campus ("ATHÉNÉE DE LUXEMBOURG", "Lycée Aline Mayrisch", "ecg", "FORUM"): a stroke font drawn as quads.
 *
 * Why strokes and not a texture atlas: the landmark meshes are plain vertex-colour soups (one draw call per zone, no UVs, no second material),
 * and a stroke letter stays crisp at every distance where a mip-mapped glyph turns to grey mush at 40 m.  A letter costs 2 triangles per stroke
 * segment (a sign of twenty letters is a few hundred triangles).  Pure (no THREE): the Node harness builds the very same signs.
 *
 * A glyph is a list of polylines in a box of cap height CAP (7 units); lowercase letters stand on the same baseline with an x-height of
 * X_HEIGHT.  Accents are marks above the base letter.  The text is laid out on a vertical plane: an origin (x, z), the direction along the text
 * (dx, dz) and the outward normal (nx, nz) of the wall it sits on. */

const CAP = 7;
const X_HEIGHT = 4.8;
const GAP = 1.5;                       // units between two letters
const SPACE = 3.2;                     // units of a blank
const WEIGHT = 0.15;                   // stroke width as a share of the cap height

/** A polyline along an ellipse arc: centre (cx, cy), radii, from a0 to a1 degrees (0 = right, 90 = up), n segments. */
function arc(cx, cy, rx, ry, a0, a1, n = 8) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return out;
}

const scaleY = (strokes, k) => strokes.map((s) => s.map((v, i) => (i % 2 ? v * k : v)));

const S_SHAPE = [4.4, 5.8, 3.6, 6.8, 2.3, 7, 1, 6.6, 0.4, 5.6, 0.8, 4.4, 2.4, 3.6, 4, 2.9, 4.5, 1.8, 4.1, 0.6, 2.8, 0, 1.4, 0.1, 0.3, 1];
const C_SHAPE = arc(2.5, 3.5, 2.5, 3.5, 40, 320, 10);

/** Every glyph: { w: width in units, p: polylines [x0, y0, x1, y1, ...] }. */
const GLYPHS = {
  A: { w: 5, p: [[0, 0, 2.5, 7, 5, 0], [1, 2.5, 4, 2.5]] },
  B: { w: 4.8, p: [[0, 0, 0, 7], [0, 7, 3.2, 7, 4.4, 6.3, 4.4, 4.9, 3.2, 3.9, 0, 3.9], [3.2, 3.9, 4.8, 3.2, 4.8, 1, 3.4, 0, 0, 0]] },
  C: { w: 5, p: [C_SHAPE] },
  D: { w: 4.8, p: [[0, 0, 0, 7, 2.4, 7, 4, 6.2, 4.8, 4.5, 4.8, 2.5, 4, 0.8, 2.4, 0, 0, 0]] },
  E: { w: 4.4, p: [[4.4, 7, 0, 7, 0, 0, 4.4, 0], [0, 3.5, 3.6, 3.5]] },
  F: { w: 4.4, p: [[4.4, 7, 0, 7, 0, 0], [0, 3.5, 3.6, 3.5]] },
  G: { w: 5, p: [[...arc(2.5, 3.5, 2.5, 3.5, 40, 320, 10), 4.9, 1, 4.9, 3.2, 2.9, 3.2]] },
  H: { w: 4.6, p: [[0, 0, 0, 7], [4.6, 0, 4.6, 7], [0, 3.5, 4.6, 3.5]] },
  I: { w: 0, p: [[0, 0, 0, 7]] },
  J: { w: 3.6, p: [[3.6, 7, 3.6, 1.5, 3, 0.3, 1.8, 0, 0.8, 0.4, 0.3, 1.5]] },
  K: { w: 4.8, p: [[0, 0, 0, 7], [4.6, 7, 0, 2.6], [1.4, 3.8, 4.8, 0]] },
  L: { w: 4.2, p: [[0, 7, 0, 0, 4.2, 0]] },
  M: { w: 6, p: [[0, 0, 0, 7, 3, 2.4, 6, 7, 6, 0]] },
  N: { w: 4.8, p: [[0, 0, 0, 7, 4.8, 0, 4.8, 7]] },
  O: { w: 5, p: [arc(2.5, 3.5, 2.5, 3.5, 90, 450, 12)] },
  P: { w: 4.6, p: [[0, 0, 0, 7, 3, 7, 4.4, 6.3, 4.6, 5, 4.4, 3.8, 3, 3.1, 0, 3.1]] },
  Q: { w: 5, p: [arc(2.5, 3.5, 2.5, 3.5, 90, 450, 12), [3, 2, 4.9, -0.4]] },
  R: { w: 4.8, p: [[0, 0, 0, 7, 3, 7, 4.4, 6.3, 4.6, 5, 4.4, 3.8, 3, 3.1, 0, 3.1], [2.6, 3.1, 4.8, 0]] },
  S: { w: 4.6, p: [S_SHAPE] },
  T: { w: 5, p: [[0, 7, 5, 7], [2.5, 7, 2.5, 0]] },
  U: { w: 4.8, p: [[0, 7, 0, 2, 0.4, 0.8, 1.3, 0.1, 2.4, 0, 3.5, 0.1, 4.4, 0.8, 4.8, 2, 4.8, 7]] },
  V: { w: 4.8, p: [[0, 7, 2.4, 0, 4.8, 7]] },
  W: { w: 6, p: [[0, 7, 1.5, 0, 3, 5, 4.5, 0, 6, 7]] },
  X: { w: 4.8, p: [[0, 0, 4.8, 7], [0, 7, 4.8, 0]] },
  Y: { w: 4.8, p: [[0, 7, 2.4, 3.4, 4.8, 7], [2.4, 3.4, 2.4, 0]] },
  Z: { w: 4.4, p: [[0, 7, 4.4, 7, 0, 0, 4.4, 0]] },
  '-': { w: 3, p: [[0, 3.5, 3, 3.5]] },
  '.': { w: 0, p: [[0, 0, 0, 0.6]] },
  "'": { w: 0, p: [[0, 7, 0, 5.6]] },
  // lowercase (the signs "Lycée Aline Mayrisch" and the "ecg" logo)
  a: { w: 4.2, p: [arc(2.1, 2.4, 2.1, 2.4, 0, 360, 10), [4.2, 4.8, 4.2, 0]] },
  c: { w: 4.2, p: [arc(2.3, 2.4, 2.2, 2.4, 40, 320, 9)] },
  e: { w: 4.4, p: [[0.1, 2.4, 4.4, 2.4], arc(2.2, 2.4, 2.2, 2.4, 0, 325, 10)] },
  g: { w: 4.2, p: [arc(2.1, 2.4, 2.1, 2.4, 0, 360, 10), [4.2, 4.8, 4.2, -0.8, 3.6, -1.8, 2.2, -2.2, 0.8, -1.8]] },
  h: { w: 3.8, p: [[0, 0, 0, 7], [0, 3.4, 0.8, 4.4, 2, 4.8, 3.2, 4.4, 3.8, 3.4, 3.8, 0]] },
  i: { w: 0, p: [[0, 0, 0, 4.8], [0, 6.3, 0, 6.8]] },
  l: { w: 0, p: [[0, 0, 0, 7]] },
  m: { w: 6.4, p: [[0, 0, 0, 4.8], [0, 3.6, 0.8, 4.6, 1.8, 4.8, 2.8, 4.4, 3.2, 3.4, 3.2, 0], [3.2, 3.4, 4, 4.5, 5, 4.8, 6, 4.3, 6.4, 3.4, 6.4, 0]] },
  n: { w: 3.8, p: [[0, 0, 0, 4.8], [0, 3.4, 0.8, 4.4, 2, 4.8, 3.2, 4.4, 3.8, 3.4, 3.8, 0]] },
  r: { w: 3, p: [[0, 0, 0, 4.8], [0, 3, 0.8, 4.2, 2.2, 4.8, 3, 4.7]] },
  s: { w: 3.2, p: scaleY([S_SHAPE.map((v, i) => (i % 2 ? v : v * 0.72))], X_HEIGHT / CAP) },
  b: { w: 4.5, p: [[0, 0, 0, 7], arc(2.3, 2.4, 2.2, 2.4, 0, 360, 10)] },
  o: { w: 4.4, p: [arc(2.2, 2.4, 2.2, 2.4, 0, 360, 10)] },
  u: { w: 3.6, p: [[0, 4.8, 0, 1.6, 0.5, 0.4, 1.7, 0, 2.9, 0.4, 3.6, 1.6], [3.6, 4.8, 3.6, 0]] },
  x: { w: 3.8, p: [[0, 4.8, 3.8, 0], [0, 0, 3.8, 4.8]] },
  y: { w: 4.2, p: [[0, 4.8, 2.1, 0.2], [4.2, 4.8, 1.4, -2.2, 0.6, -2.2]] },
};
GLYPHS[' '] = { w: SPACE - GAP, p: [] };

const ACCENT_MARKS = {
  acute: (cx, top) => [[cx - 0.6, top + 0.5, cx + 0.9, top + 1.8]],
  diaeresis: (cx, top) => [[cx - 1.0, top + 1.2, cx - 1.0, top + 1.5], [cx + 1.0, top + 1.2, cx + 1.0, top + 1.5]],
};
const ACCENTED = { 'É': ['E', 'acute'], 'é': ['e', 'acute'], 'Ä': ['A', 'diaeresis'], 'ä': ['a', 'diaeresis'] };

/** The strokes of one character: [{ strokes, width }]; accents are extra strokes. */
function glyphOf(ch) {
  const accented = ACCENTED[ch];
  const base = GLYPHS[accented ? accented[0] : ch];
  if (!base) throw new Error(`campus-text: no glyph for '${ch}'`);
  if (!accented) return base;
  const top = accented[0] === accented[0].toLowerCase() ? X_HEIGHT : CAP;
  return { w: base.w, p: [...base.p, ...ACCENT_MARKS[accented[1]](base.w / 2, top)] };
}

/** The width of a text in units of a cap height of 1 (so the width in metres is textWidth(...) * capHeight). */
export function textWidth(text) {
  let w = 0;
  for (const ch of text) w += glyphOf(ch).w + GAP;
  return (w - GAP) / CAP;
}

/**
 * Draws `text` on a vertical plane.  o: { x, z } the start of the baseline; dir: [dx, dz] the unit direction along the text; normal: [nx, nz]
 * pointing out of the wall; y: the baseline; cap: the cap height in metres; out: the distance in front of the wall plane.
 * `align` 'start' | 'center' | 'end' decides what (x, z) is.  Returns the width in metres.
 */
export function drawText(soup, text, { x, z, dir, normal, y, cap, out = 0.05, color, align = 'start', weight = WEIGHT }) {
  const k = cap / CAP;
  const width = textWidth(text) * cap;
  const shift = align === 'center' ? -width / 2 : align === 'end' ? -width : 0;
  const hw = (weight * CAP * k) / 2;
  const at = (u, v) => [x + dir[0] * (u + shift) + normal[0] * out, y + v * k, z + dir[1] * (u + shift) + normal[1] * out];
  let cursor = 0;
  for (const ch of text) {
    const g = glyphOf(ch);
    for (const poly of g.p) {
      for (let i = 0; i + 3 < poly.length; i += 2) segment(soup, at, cursor + poly[i] * k, poly[i + 1], cursor + poly[i + 2] * k, poly[i + 3], hw, k, color);
    }
    cursor += (g.w + GAP) * k;
  }
  return width;
}

/** One stroke: a quad of width 2*hw around the segment (u0, v0)-(u1, v1) (u in metres along the text, v in glyph units), ends extended by hw. */
function segment(soup, at, u0, v0, u1, v1, hw, k, color) {
  const ax = u0, ay = v0 * k, bx = u1, by = v1 * k;
  let dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1e-6;
  dx /= len; dy /= len;
  const px = -dy * hw, py = dx * hw, ex = dx * hw, ey = dy * hw;
  const P = (u, v) => at(u, v / k);
  soup.quad(P(ax - ex + px, ay - ey + py), P(ax - ex - px, ay - ey - py), P(bx + ex - px, by + ey - py), P(bx + ex + px, by + ey + py), color);
}
