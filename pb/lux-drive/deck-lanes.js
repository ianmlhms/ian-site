/* The lanes of a bridge deck as a car drives them (decks10 / drive12 harness Q1 / T3, collide14 deck-barriers.js): the way the deck carries, the lane offsets along
 * the deck's axis, and the ways that lead onto its two ends (the lane keeps its lateral position onto them).  Pure (no THREE). */
export const DECK_LANE = Object.freeze({
  run: 30,                 // m of the way that leads onto each end (Q_RUN)
  freeRun: 12,             // m driven straight on past an end that no way continues (Q_FREE_RUN)
  laneMargin: 0.9,         // m: a lane must lie this far inside the carriageway of the way it continues on (else that lane does not exist there and is not driven)
});
const Q_RUN = DECK_LANE.run, Q_FREE_RUN = DECK_LANE.freeRun, Q_LANE_MARGIN = DECK_LANE.laneMargin;

const segDist = (p, a, b) => {
  const ex = b[0] - a[0], ez = b[1] - a[1], ll = ex * ex + ez * ez || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / ll));
  return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ez * t);
};
export const polyDist = (P, p) => { let m = Infinity; for (let i = 0; i + 1 < P.length; i++) m = Math.min(m, segDist(p, P[i], P[i + 1])); return m; };
const normalAt = (P, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]; };

/** The way a deck carries: the road whose line covers most of its points (within 1.5 m), or null. */
export function wayOf(d, roads) {
  const m = d.pts[d.pts.length >> 1];
  let best = null, most = 0;
  for (const r of roads) {
    if (!r.pts.some((q) => Math.abs(q[0] - m[0]) < 400 && Math.abs(q[1] - m[1]) < 400)) continue;
    let c = 0;
    for (const p of d.pts) if (polyDist(r.pts, p) <= 1.5) c++;
    if (c > most) { most = c; best = r; }
  }
  return best && most >= d.pts.length * 0.6 ? best : null;
}

/** The ends of the drivable ways: [x, z, ux, uz (leaving through the end), road, index of the end]. */
export function wayEnds(roads) {
  const out = [];
  for (const r of roads) {
    if (!r.info.drivable || r.tunnel || r.pts.length < 2) continue;
    const m = r.pts.length;
    for (const [a, b] of [[0, 1], [m - 1, m - 2]]) {
      const ux = r.pts[a][0] - r.pts[b][0], uz = r.pts[a][1] - r.pts[b][1], l = Math.hypot(ux, uz) || 1;
      out.push([r.pts[a][0], r.pts[a][1], ux / l, uz / l, r, a]);
    }
  }
  return out;
}

/** The way that leads into the deck end p (into: the direction into the deck), Q_RUN m of it ordered toward the end; null when none.  (An approach slab moves the deck end up to
 *  7.5 m back over its approach: the way's end then lies on the deck axis inside it.) */
function approachOf(ends, p, into, self) {
  let best = null, bd = 7.5;
  for (const q of ends) {
    if (q[4] === self) continue;
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]), along = (q[0] - p[0]) * into[0] + (q[1] - p[1]) * into[1];
    const onAxis = d <= 3 || (along > 0 && Math.sqrt(Math.max(0, d * d - along * along)) <= 3);
    if (d <= bd && onAxis && q[2] * into[0] + q[3] * into[1] >= 0.7) { bd = d; best = q; }
  }
  if (!best) return null;
  const r = best[4], P = best[5] === 0 ? r.pts : r.pts.slice().reverse(), out = [];
  let s = 0;
  for (let k = 0; k < P.length && s <= Q_RUN; k++) { if (k) s += Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]); out.push(P[k]); }
  return { pts: out.reverse(), hw: Math.max(0.8, r.width / 2) };
}

/** The route over a deck in the lane `off` (to the left of its axis), with the ways at its ends; { none } when a way at an end has no lane there. */
export function laneRoute(d, off, self, ends) {
  const n = d.pts.length, P = d.pts;
  const dir = (a, b) => { const dx = P[b][0] - P[a][0], dz = P[b][1] - P[a][1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  const lane = P.map((q, i) => { const nn = normalAt(P, i); return [q[0] + nn[0] * off, q[1] + nn[1] * off]; });
  const parts = [];
  for (const [e, into] of [[0, dir(0, 1)], [n - 1, dir(n - 1, n - 2)]]) {
    const ap = approachOf(ends, P[e], into, self);
    if (!ap) { parts.push([[lane[e][0] - into[0] * Q_FREE_RUN, lane[e][1] - into[1] * Q_FREE_RUN]]); continue; }
    const A = ap.pts, m = A.length, nA = normalAt(A, m - 1);
    const offA = (lane[e][0] - A[m - 1][0]) * nA[0] + (lane[e][1] - A[m - 1][1]) * nA[1];      // the lane keeps its lateral position onto the way
    if (Math.abs(offA) > ap.hw - Q_LANE_MARGIN) return { none: true };
    const before = (q) => (q[0] - P[e][0]) * into[0] + (q[1] - P[e][1]) * into[1] < -0.5;    // (a way may run on under the deck)
    parts.push(A.map((q, i) => { const nn = normalAt(A, i); return [q[0] + nn[0] * offA, q[1] + nn[1] * offA]; }).filter(before));
  }
  return { pts: [...parts[0], ...lane, ...parts[1].slice().reverse()] };
}

