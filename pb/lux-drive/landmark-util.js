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
