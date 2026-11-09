/* The bridge ends that stand on the road below them (city20).
 *
 * OSM ends a bridge way where the mapper drew it, often a few metres short of the real abutment.  The game holds the approach
 * carriageway at its level ABUT_HOLD (2 m) under the deck and lets the earth under the deck fall to the land past that, at most
 * ABUT_STEEPEST (2.2 m per m, road-network.js abutmentFade).  Where a road UNDER the bridge passes closer to the end than the hold and
 * that fall, the earth of the abutment (or the approach carriageway itself) lies on its lanes: the Val du Scheid under the A1
 * (deck 42: the street climbed 5 m onto the earth under the motorway and fell 6 m off it, full-city sweep v73), the Autoroute d'Esch
 * under the A6 (decks 114 / 137: roll 0.72, bank hits), the slip road 2405 under the Rue de Cessange bridge, Breedewee under deck 80.
 *
 * Such a bridge is moved back along its approach until the abutment clears the lanes below: the last metres of the approach way become
 * bridge (the bridge way takes them over, the deck runs on over them at the level of its end), so the hold and the fall start where they
 * leave the road below free.  Measured: a carved car way (not the approach, not a way that meets the bridge at its end) whose carriageway
 * comes within ABUT_HOLD + the steepest fall of the end (along the bridge, across its width + EDGE) and whose land lies at least
 * BRIDGE_END.under under the end.  The move is at most BRIDGE_END.maxMove and leaves at least BRIDGE_END.minLeft of the approach.
 *
 * Pure (no THREE): loadWorldData applies it, so the browser, the harness and the bakers read the same roads and decks.  The ids of the
 * roads do not change (only the points of the approach and of the bridge way); a moved deck gets new points and its `spans` flag again
 * from the land (the bake's rule, harness "every deck knows whether it spans the land"). */

export const BRIDGE_END = Object.freeze({
  hold: 2.0,          // m: road-network.js ABUT_HOLD (the approach carriageway is held at its level this far under the deck)
  steepest: 2.2,      // m per m: road-network.js ABUT_STEEPEST (the steepest fall of the earth under the deck)
  fadeMax: 6.0,       // m: road-network.js ABUT_FADE_MAX
  under: 3.0,         // m: road-network.js ABUT_UNDER (a road this far under the end of the bridge passes under it)
  margin: 0.5,        // m of free ground between the foot of the fall and the carriageway below
  edge: 1.0,          // m: the earth reaches this far past the edge of the deck (its batter)
  join: 3.0,          // m: road-network.js APPROACH_JOIN (a carved way whose end lies this close to a deck end runs onto it)
  align: 0.7,         // the cosine between the approach's direction through its end and the direction into the deck
  meet: 6.0,          // m: a way with a node this close to the deck end meets the bridge there (a junction at the abutment), it does not pass under it
  maxMove: 12.0,      // m: the farthest a bridge end is moved back
  minLeft: 8.0,       // m of the approach way that is left
  resample: 4.0,      // m: the points of the deck over the moved stretch (the bake samples every 4 m)
  spanDip: 3.0,       // m: decks.js DECK.spanDip (the deck spans the land when it dips this far under its ends)
  trustWidth: 5.0,    // m: decks.js DECK.trustWidth (the DSM of a narrower deck is not its level)
  endGrade: 0.12,     // m/m: road-network.js DECK_END_GRADE
  liftMax: 7.0,       // m: road-network.js APPROACH_LIFT_MAX
  belowBank: 1.0,     // m: road-network.js DECK_BELOW_BANK
  step: 0.5,          // m: the sampling step along the roads below
  crossCos: 0.9,      // a road below passes under the end when it crosses the bridge's axis at more than ~26 degrees
});

const CAR_KINDS = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
  'unclassified', 'residential', 'living_street', 'service', 'road']);
const isCarved = (r) => CAR_KINDS.has(r.kind) && !r.bridge && !r.tunnel && !r.over && (r.layer || 0) === 0 && r.info && r.info.drivable && r.pts.length >= 2;
const isBridgeWay = (r) => (r.bridge || r.over) && !r.tunnel && r.pts.length >= 2;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function arcsOf(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i], pts[i - 1]));
  return cum;
}

function pointAt(pts, cum, s) {
  let i = 1;
  while (i < pts.length - 1 && cum[i] < s) i++;
  const l = cum[i] - cum[i - 1], f = l > 1e-9 ? Math.min(1, Math.max(0, (s - cum[i - 1]) / l)) : 0;
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
}

/** The level of a deck at end k from its first two inner points (road-network.js deckEndLevels), or null for a narrow deck. */
function innerLevel(d, k) {
  const n = d.pts.length;
  if (n < 3 || d.width < BRIDGE_END.trustWidth) return null;
  const [j, j2] = k === 0 ? [1, 2] : [n - 2, n - 3];
  const l1 = dist(d.pts[j], d.pts[k]), l2 = dist(d.pts[j2], d.pts[j]) || 1;
  const grade = Math.max(-BRIDGE_END.endGrade, Math.min(BRIDGE_END.endGrade, (d.tops[j] - d.tops[j2]) / l2));
  return d.tops[j] + grade * l1;
}

/** Does road-network.js pin the approaches to this deck's own level?  Both ends must agree: no end more than APPROACH_LIFT_MAX over its land or DECK_BELOW_BANK under it
 *  (reconcileJunctions; the land stands in for the bed the approach has on its own). */
function deckUsable(d, groundAt) {
  const n = d.pts.length;
  return [0, n - 1].every((k) => {
    const inner = innerLevel(d, k), land = groundAt(d.pts[k][0], d.pts[k][1]);
    return inner !== null && inner - land <= BRIDGE_END.liftMax && inner >= land - BRIDGE_END.belowBank;
  });
}

/** The way among `ways` with an end within `join` of p whose direction through that end (out of the way) is aligned with u: { way, atEnd } or null. */
function wayEndingAt(ways, p, u, join, align) {
  for (const way of ways) {
    const m = way.pts.length;
    for (const [e, f, atEnd] of [[0, 1, false], [m - 1, m - 2, true]]) {
      if (dist(way.pts[e], p) > join) continue;
      const vx = way.pts[e][0] - way.pts[f][0], vz = way.pts[e][1] - way.pts[f][1], vl = Math.hypot(vx, vz) || 1;
      if ((vx * u[0] + vz * u[1]) / vl >= align) return { way, atEnd };
    }
  }
  return null;
}

/** How far the end E of a deck (into the deck: u, half width hw, level h0) must move back so that its abutment clears the carriageways below: { need (m, 0 when it does), by (the id of the way below) }. */
function moveNeeded(E, u, hw, h0, lower, groundAt) {
  const B = BRIDGE_END;
  let need = 0, by = null;
  const across = hw + B.edge;
  for (const L of lower) {
    if (L.pts.some((p) => dist(p, E) < B.meet)) continue;            // (it meets the bridge at its end: a junction at the abutment)
    const keep = L.width / 2;
    const reachMax = B.hold + B.fadeMax + B.margin + keep;
    for (let i = 0; i + 1 < L.pts.length; i++) {
      const a = L.pts[i], b = L.pts[i + 1], l = dist(a, b);
      if (l < 1e-6) continue;
      // (a way that runs ALONG the bridge - the other carriageway beside it, lower on the slope - does not pass under its end)
      if (Math.abs(((b[0] - a[0]) * u[0] + (b[1] - a[1]) * u[1]) / l) > B.crossCos) continue;
      // (the segment can reach the end's window only when it passes within its length + the window of the end)
      if (Math.min(dist(a, E), dist(b, E)) > l + B.maxMove + reachMax + across) continue;
      for (let t = 0; t <= l + 1e-9; t += B.step) {
        const x = a[0] + (b[0] - a[0]) * t / l, z = a[1] + (b[1] - a[1]) * t / l;
        const s = (x - E[0]) * u[0] + (z - E[1]) * u[1], c = Math.abs((z - E[1]) * u[0] - (x - E[0]) * u[1]);
        if (c > across + keep || s < -B.maxMove - keep || s > reachMax) continue;
        const drop = h0 - groundAt(x, z);
        if (drop < B.under) continue;
        const clear = B.hold + Math.min(B.fadeMax, (1.5 * drop) / B.steepest) + B.margin;   // (the steepest mean-based fall: road-network.js abutmentFade)
        // the nearest point of this carriageway to the end, along the bridge: its edge (inside the deck's width) or the edge of its circle (beside it)
        const reach = c <= across ? s - keep : s - Math.sqrt(Math.max(0, keep * keep - (c - across) ** 2));
        if (clear - reach > need) { need = clear - reach; by = L.id; }
      }
    }
  }
  return { need, by };
}

/** The points of a polyline from arc s0 to s1 (cut points at the ends). */
function slice(pts, cum, s0, s1) {
  const out = [pointAt(pts, cum, s0)];
  for (let i = 0; i < pts.length; i++) if (cum[i] > s0 + 1e-6 && cum[i] < s1 - 1e-6) out.push([pts[i][0], pts[i][1]]);
  out.push(pointAt(pts, cum, s1));
  return out;
}

/** Points every <= step m along a polyline (its own points kept). */
function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i], pts[i - 1]), k = Math.max(1, Math.ceil(l / step));
    for (let j = 1; j <= k; j++) out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * j / k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * j / k]);
  }
  return out;
}

/** The `spans` flag of a deck from the land under it (the bake's rule; harness "every deck knows whether it spans the land"). */
function spansOf(pts, groundAt) {
  const n = pts.length;
  if (n <= 2) return false;
  let lowest = Infinity;
  for (let i = 1; i < n - 1; i++) lowest = Math.min(lowest, groundAt(pts[i][0], pts[i][1]));
  return Math.max(groundAt(pts[0][0], pts[0][1]), groundAt(pts[n - 1][0], pts[n - 1][1])) - lowest >= BRIDGE_END.spanDip;
}

/**
 * Moves the bridge ends that stand on a road below back along their approaches.
 * roads: the decoded ways (ids = indices); decks: the decoded decks; groundAt(x, z): the DTM without any road (base-field.js baseHeight).
 * Returns { roads, decks, moved }: NEW arrays (the inputs are not changed; changed ways and decks are copies) and moved [{ deck, way, approach, by, x, z }].
 */
export function moveBridgeEnds(roads, decks, groundAt) {
  const B = BRIDGE_END;
  const carved = roads.filter(isCarved);
  const bridgeIds = roads.filter(isBridgeWay).map((r) => r.id);
  const outRoads = roads.slice(), outDecks = decks.slice(), moved = [];
  const touched = new Set();                                           // (an approach way gives up one stretch: its other end keeps its place)
  decks.forEach((d0, di) => {
    for (const side of [0, 1]) {
      const d = outDecks[di], n = d.pts.length;
      if (n < 2) return;
      const e = side ? n - 1 : 0, f = side ? n - 2 : 1, E = d.pts[e];
      const ul = dist(d.pts[f], E) || 1, u = [(d.pts[f][0] - E[0]) / ul, (d.pts[f][1] - E[1]) / ul];     // into the deck
      const approach = wayEndingAt(carved, E, u, B.join, B.align);
      const bridge = wayEndingAt(bridgeIds.map((id) => outRoads[id]), E, [-u[0], -u[1]], B.join, B.align);   // (the bridge way leaves through E away from the deck's inside)
      if (!approach || !bridge || touched.has(approach.way.id)) continue;
      // the level of the end: the deck's own (its DSM continued to the end, as road-network.js deckEndLevels), unless the approach would have to climb more than
      // APPROACH_LIFT_MAX onto it - road-network.js then does not use that deck (a canopy, a structure over the way) and the end stays on the approach's land
      const land = groundAt(E[0], E[1]);
      const level = deckUsable(d, groundAt) ? innerLevel(d, e) : land;
      const { need: by, by: under } = moveNeeded(E, u, d.width / 2, level, carved.filter((r) => r !== approach.way), groundAt);
      if (by <= B.step) continue;
      const a = outRoads[approach.way.id], cum = arcsOf(a.pts), len = cum[cum.length - 1];
      if (by > B.maxMove || len - by < B.minLeft) continue;
      // the stretch of the approach that becomes bridge, from the new end to the old one
      const piece = approach.atEnd ? slice(a.pts, cum, len - by, len) : slice(a.pts, cum, 0, by).reverse();
      const rest = approach.atEnd ? slice(a.pts, cum, 0, len - by) : slice(a.pts, cum, by, len);
      const newEnd = piece[0];
      // (a third way that meets the approach on the moved stretch or at the end - a slip road merging at the abutment: the A1 link 7463 at deck 42 - would end on the deck)
      if (carved.some((r) => r.id !== a.id && [r.pts[0], r.pts[r.pts.length - 1]].some((p) => piece.some((q, k) => k > 0 && dist(p, q) <= B.join) || dist(p, E) <= B.join))) continue;
      // the bridge way: the stretch is put before its end at E (its point at E is replaced by the stretch, which ends there)
      const bw = outRoads[bridge.way.id];
      const bpts = bridge.atEnd ? [...bw.pts.slice(0, -1), ...piece.slice().reverse()] : [...piece, ...bw.pts.slice(1)];
      // the deck: points over the stretch at the level of its end (the DSM there is the approach's land, not the deck)
      const over = densify(piece, B.resample).slice(0, -1);              // (from the new end up to E, E itself is the deck's own point)
      const top = level;
      let pts, tops;
      if (side === 0) { pts = [...over, ...d.pts]; tops = [...over.map(() => top), ...Array.from(d.tops)]; }
      else { const back = over.slice().reverse(); pts = [...d.pts, ...back]; tops = [...Array.from(d.tops), ...back.map(() => top)]; }
      // (the old end point keeps its baked top, the ground: it is an inner point now and the deck's level runs over it)
      const ei = side === 0 ? over.length : n - 1;
      tops[ei] = top;
      outDecks[di] = { ...d, pts, tops: Float32Array.from(tops), spans: spansOf(pts, groundAt) };
      outRoads[a.id] = { ...a, pts: rest, length: len - by };
      outRoads[bw.id] = { ...bw, pts: bpts, length: arcsOf(bpts).at(-1) };
      touched.add(a.id);
      moved.push({ deck: d.id, way: bw.id, approach: a.id, under, by: +by.toFixed(2), x: +E[0].toFixed(1), z: +E[1].toFixed(1) });
    }
  });
  return { roads: outRoads, decks: outDecks, moved };
}
