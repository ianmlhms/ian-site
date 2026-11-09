/* The underpasses that the DTM fills (fix19): a street under a motorway bridge whose LiDAR terrain kept the embankment over it.
 *
 * The DTM removes most bridges (the land dips under the deck, decks.js `spans`), but a short bridge in a long embankment can survive
 * the filter: under the four A1 bridges at Senningerberg (ways 2844 / 2845 / 2847 / 2849, 18 m each) the land of Rue de Munsbach
 * (ways 9232 / 9086) rises 4.5 m onto the motorway and falls 5 m back on the other side.  The street was carved over that crest: a
 * wall of 2.6 m in 4.5 m that threw the car 5 m into the air (sweep 1, the worst place of the network: jolt 175 m/s2, fall 5.4 m).
 *
 * Such a street is a tunnel in all but its tag: it dives under land that the game keeps (the motorway stays on its embankment).  The
 * stretch under the embankment is split off the way and tagged as a tunnel, so tunnel-tubes.js gives it a tube: the floor runs from
 * the street on one side to the street on the other, the motorway over it keeps its ground.
 *
 * The rule is measured: a carved car way (TUBE.kinds, not a bridge or a tunnel) that crosses drivable bridge ways (layer >= 1), where
 * the land at a crossing stands at least UNDERPASS.embankment over the straight line between the land UNDERPASS.reach m before the
 * first and after the last crossing.  The tunnel runs from the foot of the embankment on one side (where the land comes down to
 * UNDERPASS.foot over that line) to the foot on the other, at most UNDERPASS.footMax beyond the outer crossings.
 *
 * Pure (no THREE): loadWorldData applies it, so the browser, the harness and the bakers read the same roads.  The ids of the roads are
 * their indices: the way keeps its id for the stretch before the underpass, the tunnel and the stretch after it are appended. */
import { TUBE } from './tunnel-tubes.js';

export const UNDERPASS = Object.freeze({
  embankment: 3.0,   // m: the land at the crossings at least this far over the line between the two sides (the DTM kept the embankment)
  reach: 22,         // m before the first and after the last crossing: the land of the street on each side
  foot: 0.8,         // m: the tunnel's mouth stands where the land comes down to this much over that line ...
  footMax: 16,       // ... at most this far beyond the outer crossings
  group: 40,         // m: crossings of one way within this distance of each other are one underpass
  minEnd: 12,        // m: a split leaves at least this much of the way on each side (the road a car arrives on)
  step: 0.5,         // m: the sampling step along the way
});

/** The crossing of segments ab and cd: the parameter along ab, or -1. */
function crossAt(a, b, c, d) {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const qx = c[0] - a[0], qz = c[1] - a[1];
  const t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

/** The arc stations of a polyline: [0, l1, l1 + l2, ...]. */
function arcsOf(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

/** The point at arc s of a polyline (cum: its arcs). */
function pointAt(pts, cum, s) {
  let i = 1;
  while (i < pts.length - 1 && cum[i] < s) i++;
  const l = cum[i] - cum[i - 1], f = l > 1e-9 ? Math.min(1, Math.max(0, (s - cum[i - 1]) / l)) : 0;
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
}

/** The part of a polyline between arcs s0 and s1 (its own points in between, the cut points at the ends). */
function slice(pts, cum, s0, s1) {
  const out = [pointAt(pts, cum, s0)];
  for (let i = 0; i < pts.length; i++) if (cum[i] > s0 + 1e-6 && cum[i] < s1 - 1e-6) out.push([pts[i][0], pts[i][1]]);
  out.push(pointAt(pts, cum, s1));
  return out;
}

/** The arc stations where the bridge ways cross a polyline, sorted. */
function crossingsOf(pts, cum, bridges) {
  const hits = [];
  for (const b of bridges) {
    for (let i = 0; i + 1 < pts.length; i++) {
      for (let j = 0; j + 1 < b.pts.length; j++) {
        const t = crossAt(pts[i], pts[i + 1], b.pts[j], b.pts[j + 1]);
        if (t >= 0) hits.push(cum[i] + t * (cum[i + 1] - cum[i]));
      }
    }
  }
  return hits.sort((p, q) => p - q);
}

/** The underpass of one group of crossings [c0, c1] on a way, or null: { s0, s1, height }. */
function underpassOf(pts, cum, c0, c1, groundAt) {
  const length = cum[cum.length - 1];
  const sA = c0 - UNDERPASS.reach, sB = c1 + UNDERPASS.reach;
  if (sA < 0 || sB > length) return null;
  const land = (s) => groundAt(...pointAt(pts, cum, s));
  const hA = land(sA), hB = land(sB);
  const over = (s) => land(s) - (hA + (hB - hA) * (s - sA) / (sB - sA));
  let height = -Infinity;     // (the highest: the slip roads cross on the slopes of the embankment, the motorway on its crest)
  for (let s = c0; s <= c1 + 1e-6; s += UNDERPASS.step) height = Math.max(height, over(s));
  if (height < UNDERPASS.embankment) return null;
  let s0 = c0, s1 = c1;
  while (s0 > c0 - UNDERPASS.footMax && over(s0) > UNDERPASS.foot) s0 -= UNDERPASS.step;
  while (s1 < c1 + UNDERPASS.footMax && over(s1) > UNDERPASS.foot) s1 += UNDERPASS.step;
  if (s0 < UNDERPASS.minEnd || s1 > length - UNDERPASS.minEnd) return null;
  return { s0, s1, height };
}

/**
 * Splits the streets under the embankments the DTM kept.
 * roads: the decoded ways (ids = indices); groundAt(x, z): the DTM without any road (base-field.js baseHeight).
 * Returns { roads, split }: a NEW array (the input is not changed) where every split way keeps its id for the stretch before its
 * underpass and the tunnel and the rest are appended (copies, tunnel = true on the tunnel), and split [{ id, ids, name, height, length }].
 */
export function splitEmbankmentUnderpasses(roads, groundAt) {
  const bridges = roads.filter((r) => r.bridge && (r.layer || 0) >= 1 && !r.tunnel && r.info && r.info.drivable && r.pts.length >= 2);
  const out = roads.slice();
  const split = [];
  for (const road of roads) {
    if (road.bridge || road.tunnel || road.over || (road.layer || 0) !== 0 || !road.info || !road.info.drivable || !TUBE.kinds.has(road.kind) || road.pts.length < 2) continue;
    const cum = arcsOf(road.pts);
    const hits = crossingsOf(road.pts, cum, bridges);
    if (!hits.length || hits[hits.length - 1] - hits[0] > UNDERPASS.group) continue;    // (one underpass per way: the network has no street under two embankments)
    const u = underpassOf(road.pts, cum, hits[0], hits[hits.length - 1], groundAt);
    if (!u) continue;
    const length = cum[cum.length - 1];
    const piece = (id, s0, s1, extra) => {
      const pts = slice(road.pts, cum, s0, s1);
      return { ...road, ...extra, id, pts, length: s1 - s0 };
    };
    const tunnelId = out.length, restId = out.length + 1;
    out[road.id] = piece(road.id, 0, u.s0, {});
    out.push(piece(tunnelId, u.s0, u.s1, { tunnel: true, underpassOf: road.id }));
    out.push(piece(restId, u.s1, length, { underpassOf: road.id }));
    split.push({ id: road.id, ids: [road.id, tunnelId, restId], name: road.name || road.kind, height: u.height, length: u.s1 - u.s0 });
  }
  return { roads: out, split };
}
