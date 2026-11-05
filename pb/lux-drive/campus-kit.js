/* The small drawing tools the campus facades share: flat panels in front of a wall, projecting ledges and shelves, shadow strips.
 *
 * A "ctx" is anything with { soup, f }: f is the edge frame of landmark-facade.js (s along the wall, y up, `out` in front of it).
 * The layers in front of a wall are OUT_1 (the first) and OUT_2 (the second); they are further apart than the landmarks' 4 cm because the
 * campus is seen from 200 m away, where a 4 cm gap z-fights.  Pure (no THREE). */
import { panel } from './landmark-facade.js';

export const SINK = 1.0;                    // m: walls go this far under the ground (the ground is a carved lattice: no cracks)
export const OUT_1 = 0.07;
export const OUT_2 = 0.14;
export const MIN_VISIBLE = 1.3;             // m: a row with less wall above the ground than this is not drawn

/** A coloured quad flush in front of the wall (s0..s1 along, y0..y1 up) at `out`. */
export const quad = (ctx, s0, s1, y0, y1, out, color) => panel(ctx.soup, ctx.f, s0, s1, y0, y1, out, color);

/** A projecting ledge on the wall (s0..s1, y0..y1) `depth` deep: its front and its top face only (4 triangles): the underside and the ends are
 * seen so rarely, and so thinly, that the triangles are better spent on more windows.  `topColor` lights the upper face. */
export function ledge(ctx, s0, s1, y0, y1, depth, color, topColor = null, out0 = 0) {
  const { soup, f } = ctx;
  const o = out0 + depth;
  soup.quad(f.at(s0, y0, o), f.at(s1, y0, o), f.at(s1, y1, o), f.at(s0, y1, o), color);
  soup.quad(f.at(s0, y1, out0), f.at(s1, y1, out0), f.at(s1, y1, o), f.at(s0, y1, o), topColor || color);
}

/** A pier or pilaster standing out of the wall: its front and both sides (6 triangles; the top is a hand wide and never seen from the road). */
export function pier(ctx, s0, s1, y0, y1, depth, color, out0 = 0) {
  const { soup, f } = ctx;
  const o = out0 + depth;
  soup.quad(f.at(s0, y0, o), f.at(s1, y0, o), f.at(s1, y1, o), f.at(s0, y1, o), color);
  const side = shade(color, 0.86);
  soup.quad(f.at(s0, y0, out0), f.at(s0, y0, o), f.at(s0, y1, o), f.at(s0, y1, out0), side);
  soup.quad(f.at(s1, y0, out0), f.at(s1, y0, o), f.at(s1, y1, o), f.at(s1, y1, out0), side);
}

/** A shelf (a sill): its top and its front face only (4 triangles), the underside and the ends are never seen. */
export function shelf(ctx, s0, s1, y, depth, thick, color, topColor = null, out0 = 0) {
  const { soup, f } = ctx;
  soup.quad(f.at(s0, y, out0), f.at(s1, y, out0), f.at(s1, y, out0 + depth), f.at(s0, y, out0 + depth), topColor || color);
  soup.quad(f.at(s0, y - thick, out0 + depth), f.at(s1, y - thick, out0 + depth), f.at(s1, y, out0 + depth), f.at(s0, y, out0 + depth), color);
}

/** A frame bar standing out of the wall (s0..s1, y0..y1) from `out0` to `out0 + depth`: the front and the two sides that face the opening
 * (`sides`: 'both' | 'lo' | 'hi' | 'none' = which side faces, along s, are drawn).  Aluminium window frames are real bars with depth (6 triangles). */
export function bar(ctx, s0, s1, y0, y1, depth, color, { out0 = 0, sides = 'both' } = {}) {
  const { soup, f } = ctx;
  const o = out0 + depth;
  soup.quad(f.at(s0, y0, o), f.at(s1, y0, o), f.at(s1, y1, o), f.at(s0, y1, o), color);
  const side = shade(color, 0.8);
  if (sides === 'both' || sides === 'lo') soup.quad(f.at(s0, y0, out0), f.at(s0, y0, o), f.at(s0, y1, o), f.at(s0, y1, out0), side);
  if (sides === 'both' || sides === 'hi') soup.quad(f.at(s1, y0, out0), f.at(s1, y0, o), f.at(s1, y1, o), f.at(s1, y1, out0), side);
}

/** A horizontal frame bar (a transom, a sill): front, underside and top (6 triangles). */
export function transom(ctx, s0, s1, y0, y1, depth, color, out0 = 0) {
  const { soup, f } = ctx;
  const o = out0 + depth;
  soup.quad(f.at(s0, y0, o), f.at(s1, y0, o), f.at(s1, y1, o), f.at(s0, y1, o), color);
  soup.quad(f.at(s0, y1, out0), f.at(s1, y1, out0), f.at(s1, y1, o), f.at(s0, y1, o), shade(color, 1.08));
  soup.quad(f.at(s0, y0, out0), f.at(s0, y0, o), f.at(s1, y0, o), f.at(s1, y0, out0), shade(color, 0.7));
}

/** `paint` of landmark-soup without the clamp to 1: a lifted wall colour (see `lit`) keeps its excess. */
export const paintLit = (base, key, amount = 0.035) => {
  const k = 1 + (hashUnit(key) * 2 - 1) * amount;
  return [base[0] * k, base[1] * k, base[2] * k];
};

/** A colour scaled by k and NOT clamped to 1: a wall in the shade of a north face reads as lit as in the photo (the shader tone-maps the excess). */
export const lit = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** A colour scaled by k (k < 1 darkens): the painted shadow under an overhang and beside a reveal. */
export const shade = (c, k) => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

/** A deterministic 0..1 value of a seed. */
export const hashUnit = (seed) => {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ 0x85ebca6b;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h >>> 8) & 0xffff) / 0xffff;
};

/** The ground (or neighbour roof) under the wall at s. */
export const wallBase = (run, ground, s) => {
  const [x, , z] = run.frame.at(s, 0);
  return run.lowerY ?? ground(x, z);
};

/** Is the cell (s0..s1, y0..y1) in front of an opening of the wall (a recessed storey, an entrance)? */
export const inGap = (run, s0, s1, y0, y1) =>
  (run.gaps || []).some((g) => g.cells !== false && s1 > g.s0 + 0.05 && s0 < g.s1 - 0.05 && y1 > g.yb + 0.1 && y0 < g.yt - 0.1);

/** A recessed bay: the closed box a gap of the wall is cut into: the back plane (glass or wall), both cheeks and the soffit. */
export function recessBox(ctx, g, { depth, back, cheek, soffit, yFloor }) {
  const { soup, f } = ctx;
  soup.quad(f.at(g.s0, yFloor, -depth), f.at(g.s1, yFloor, -depth), f.at(g.s1, g.yt, -depth), f.at(g.s0, g.yt, -depth), back);
  soup.quad(f.at(g.s0, yFloor, 0), f.at(g.s0, yFloor, -depth), f.at(g.s0, g.yt, -depth), f.at(g.s0, g.yt, 0), cheek);
  soup.quad(f.at(g.s1, yFloor, 0), f.at(g.s1, yFloor, -depth), f.at(g.s1, g.yt, -depth), f.at(g.s1, g.yt, 0), cheek);
  soup.quad(f.at(g.s0, g.yt, 0), f.at(g.s1, g.yt, 0), f.at(g.s1, g.yt, -depth), f.at(g.s0, g.yt, -depth), soffit);
}

/** Where a point feature {x, z} stands on a run: { s } along it when it is within `tol` m in front of / behind the wall, else null. */
export function matchOnRun(run, ft, tol = 2.5) {
  const f = run.frame;
  const dx = ft.x - f.a[0], dz = ft.z - f.a[1];
  const s = dx * f.dx + dz * f.dz, out = dx * f.nx + dz * f.nz;
  return s > run.s0 && s < run.s1 && Math.abs(out) <= tol ? { s, out } : null;
}

/** A triangle with a colour per vertex (the soup's own `tri` has one colour per face): a painted gradient, e.g. the shadow a head throws on glass. */
export function gradientTri(soup, a, b, c, ca, cb, cc) {
  const before = soup.vertexCount;
  soup.tri(a, b, c, ca);
  if (soup.vertexCount === before) return;
  const i = before * 3;
  [ca, cb, cc].forEach((col, n) => { soup.col[i + n * 3] = col[0]; soup.col[i + n * 3 + 1] = col[1]; soup.col[i + n * 3 + 2] = col[2]; });
}

/** A quad flush in front of the wall that fades from `top` colour at y1 to `bottom` colour at y0 (2 triangles). */
export function gradientQuad(ctx, s0, s1, y0, y1, out, top, bottom) {
  const { soup, f } = ctx;
  const A = f.at(s0, y0, out), B = f.at(s1, y0, out), C = f.at(s1, y1, out), D = f.at(s0, y1, out);
  gradientTri(soup, A, B, C, bottom, bottom, top);
  gradientTri(soup, A, C, D, bottom, top, top);
}

/** A flat disc on the wall (an n-gon fan, n triangles): a round window, a hole in a concrete wall. */
export function disc(ctx, s, y, r, out, color, n = 8) {
  const { soup, f } = ctx;
  const c = f.at(s, y, out);
  const ring = Array.from({ length: n }, (_, i) => f.at(s + Math.cos((i / n) * Math.PI * 2) * r, y + Math.sin((i / n) * Math.PI * 2) * r, out));
  for (let i = 0; i < n; i++) soup.tri(c, ring[i], ring[(i + 1) % n], color);
}
