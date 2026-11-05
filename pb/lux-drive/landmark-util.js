/* Helpers shared by the landmark models: profiles along a deck, the deck of a bridge by position, a wall face between
 * two curves, the lowest ground under a footprint.  Pure (no THREE). */
import { paint } from './landmark-soup.js';

/** The arclength of every point of a deck along the axis of `frame`. */
export function stationsOf(frame, pts) {
  return pts.map((p) => (p[0] - frame.ax) * frame.dx + (p[1] - frame.az) * frame.dz);
}

/** A function s -> y that follows the tops of a deck (linear between its points, held beyond the ends). */
export function profileOf(frame, deck) {
  let ss = stationsOf(frame, deck.pts);
  let tops = Array.from(deck.tops);
  if (ss[0] > ss[ss.length - 1]) { ss = ss.reverse(); tops = tops.reverse(); }     // a deck that runs against the axis
  return (s) => {
    if (s <= ss[0]) return tops[0];
    const last = ss.length - 1;
    if (s >= ss[last]) return tops[last];
    let lo = 0, hi = last;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ss[mid] <= s) lo = mid; else hi = mid; }
    const t = (s - ss[lo]) / (ss[hi] - ss[lo] || 1);
    return tops[lo] + (tops[hi] - tops[lo]) * t;
  };
}

/** The deck whose middle is nearest to (x, z) among the decks that are about `width` wide and at least `minLength` long. */
export function pickDeck(decks, x, z, { width, tolerance = 0.45, minLength = 0 }) {
  let best = null, bestD = Infinity;
  for (const d of decks) {
    if (Math.abs(d.width - width) > tolerance) continue;
    const a = d.pts[0], b = d.pts[d.pts.length - 1];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minLength) continue;
    const m = d.pts[d.pts.length >> 1];
    const dist = Math.hypot(m[0] - x, m[1] - z);
    if (dist < bestD) { bestD = dist; best = d; }
  }
  if (!best || bestD > 60) throw new Error(`landmarks: no deck of width ${width} near (${x}, ${z}) (nearest ${bestD.toFixed(0)} m)`);
  return best;
}

/** The decks that lie inside the corridor of a bridge: every point within |u| <= uMax and s in [-pad, length + pad]. */
export function decksAlong(frame, decks, uMax, pad = 6) {
  return decks.filter((d) => d.pts.every((p) => {
    const [s, u] = frame.local(p[0], p[1]);
    return Math.abs(u) <= uMax && s >= -pad && s <= frame.length + pad;
  }));
}

/** The lowest ground under a list of points [[x, z]]. */
export function lowestGround(ground, pts) {
  let low = Infinity;
  for (const [x, z] of pts) low = Math.min(low, ground(x, z));
  return low;
}

/**
 * A vertical wall face along the axis at the lateral offset u, between the curves lower(s) and upper(s), from s0 to s1:
 * `steps` quads, each with its own little variation of the colour.  Where upper <= lower nothing is drawn.
 */
export function wallFace(soup, frame, u, s0, s1, lower, upper, color, steps, key = 0) {
  for (let i = 0; i < steps; i++) {
    const sa = s0 + ((s1 - s0) * i) / steps, sb = s0 + ((s1 - s0) * (i + 1)) / steps;
    const la = lower(sa), lb = lower(sb), ua = upper(sa), ub = upper(sb);
    if (ua <= la + 1e-4 && ub <= lb + 1e-4) continue;
    soup.quad(frame.at(sa, la, u), frame.at(sb, lb, u), frame.at(sb, Math.max(ub, lb), u), frame.at(sa, Math.max(ua, la), u), paint(color, key * 977 + i));
  }
}

/** A horizontal strip at height y(s) between the offsets u0 and u1 along the axis from s0 to s1. */
export function deckStrip(soup, frame, u0, u1, s0, s1, y, color, steps, key = 0, lift = 0) {
  for (let i = 0; i < steps; i++) {
    const sa = s0 + ((s1 - s0) * i) / steps, sb = s0 + ((s1 - s0) * (i + 1)) / steps;
    soup.quad(frame.at(sa, y(sa) + lift, u0), frame.at(sb, y(sb) + lift, u0), frame.at(sb, y(sb) + lift, u1), frame.at(sa, y(sa) + lift, u1), paint(color, key * 613 + i, 0.02));
  }
}

/** The area of a polygon [[x, z]] (absolute). */
export function areaOf(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; }
  return Math.abs(a / 2);
}

/** The footprint of a decoded LOD2 building as [[x, z], ...]. */
export function footprintOf(building) {
  const out = [];
  for (let i = 0; i < building.pts.length; i += 2) out.push([building.pts[i], building.pts[i + 1]]);
  return out;
}

/** The blocks of the bake whose middle lies within r of (x, z) and whose footprint is at least minArea: [{ id, pts, area }]. */
export function blocksNear(buildings, x, z, r, minArea = 0) {
  const found = [];
  for (const b of buildings) {
    const pts = footprintOf(b);
    let cx = 0, cz = 0;
    for (const p of pts) { cx += p[0]; cz += p[1]; }
    cx /= pts.length; cz /= pts.length;
    if (Math.hypot(cx - x, cz - z) > r) continue;
    const area = areaOf(pts);
    if (area >= minArea) found.push({ id: b.id, pts, area });
  }
  return found;
}

/** The blocks to replace: an error when none is there (a landmark that finds nothing is placed on a wrong spot). */
export function requireBlocks(buildings, name, x, z, r, minArea, atLeast = 1) {
  const found = blocksNear(buildings, x, z, r, minArea);
  if (found.length < atLeast) throw new Error(`${name}: expected ${atLeast} block(s) within ${r} m of (${x}, ${z}), found ${found.length}`);
  return found;
}

/** The collision walls along the edges of a polygon. */
export function edgeWalls(pts, r, id) {
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return { ax: p[0], az: p[1], bx: q[0], bz: q[1], r, id };
  });
}

/** A polygon scaled about its vertex mean (the roof of a mansard is the eave outline drawn smaller). */
export function scalePoly(pts, k) {
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cz += p[1]; }
  cx /= pts.length; cz /= pts.length;
  return pts.map((p) => [cx + (p[0] - cx) * k, cz + (p[1] - cz) * k]);
}

/** Is (x, z) inside the polygon? */
export function insidePoly(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** The ground under a footprint: { low, high } over its corners, its edges and a few inside points. */
export function groundRange(ground, pts) {
  let low = Infinity, high = -Infinity;
  const note = (x, z) => { const y = ground(x, z); if (y < low) low = y; if (y > high) high = y; };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    for (let t = 0; t < 1; t += 0.25) note(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t);
  }
  return { low, high };
}


/**
 * The footprint of a bridge as a deck for the trees (decks.js `createDeckNetwork`): the whole width of the model, the surface `top(s)`, every `step` m.
 * The baked decks are narrower than the real bridge (the Pont Rouge model is 26 m wide, its baked decks are four strips); no tree may grow in the rest either.
 */
export function deckFootprint(frame, top, u0, u1, step = 8) {
  const n = Math.max(2, Math.ceil(frame.length / step));
  const pts = [], tops = [];
  for (let i = 0; i <= n; i++) {
    const s = (frame.length * i) / n;
    pts.push(frame.xz(s, (u0 + u1) / 2));
    tops.push(top(s));
  }
  return { id: -1, parapet: false, spans: true, width: u1 - u0, pts, tops: Float32Array.from(tops) };
}
