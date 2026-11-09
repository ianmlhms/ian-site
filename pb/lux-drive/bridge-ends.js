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
  // the free ends (trimFreeEnds): a deck end that no carved way runs onto but that lies on the carriageway of a street at its own level
  trimClear: 2.5,     // m: the deck stands less than this over the land there (more: a bridge over the street, with room under it)
  trimEdge: 0.3,      // m: the deck's end keeps this off the street's carriageway
  trimStep: 0.25,     // m
  trimMax: 12.0,      // m: the most a deck end is trimmed ...
  trimKeep: 4.0,      // ... and the least of the deck that is left
  joint: 1.5,         // m: decks.js DECK.joinTolerance (the ends of two decks this close are one bridge: no free end)
  besideCar: 6.0,     // m past the edge of a car's deck: a footway deck that ends this close to one is its pavement, not trimmed
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

/** The distance from p to a polyline. */
function polyDist(p, pts) {
  let m = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], ex = b[0] - a[0], ez = b[1] - a[1], ll = ex * ex + ez * ez;
    const t = ll > 1e-12 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / ll)) : 0;
    m = Math.min(m, Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ez * t));
  }
  return m;
}

/**
 * The free ends of the decks that lie on a street (city20): a deck end that no carved way runs onto (no approach: a footbridge or a track that leaves a street, a bridge
 * that branches off a junction) but whose end lies on the carriageway of a street at about its own level.  The DSM put the end over the street: the railing of the
 * footbridge at the end of Kéibierg stood in its lane (deck 185), the track bridge at Rue Roudebësch began 0.9 m over the street (deck 155: the car rode onto it and
 * fell 6 m), the end of the Hondhausbréck lay over the junction of Rue Vauban and Allée Pierre de Mansfeld (deck 169).  The deck now begins at the edge of the street's
 * carriageway (+ BRIDGE_END.trimEdge, its corners included).  A deck that stands BRIDGE_END.trimClear over the land there is a bridge over the street and keeps its end.
 * Pure: returns { decks (a new array, trimmed decks are copies), trimmed [{ deck, by, x, z }] }.
 */
export function trimFreeEnds(roads, decks, groundAt) {
  const B = BRIDGE_END;
  const carved = roads.filter(isCarved);
  const allBridges = roads.filter(isBridgeWay);
  const bridgeWays = allBridges.filter((r) => CAR_KINDS.has(r.kind) && (!r.info || r.info.drivable));
  const out = decks.slice(), trimmed = [];
  // the way a deck carries: the bridge way most of its points lie on (decks.js widenToWays' match); a deck of a car's way or of none is a car's
  const carDeck = decks.map((d) => {
    let best = null, most = 0;
    for (const r of allBridges) {
      const c = d.pts.filter((p) => polyDist(p, r.pts) <= Math.max(1.5, d.width / 2)).length;
      if (c > most) { most = c; best = r; }
    }
    return !best || most < d.pts.length * 0.6 || CAR_KINDS.has(best.kind);
  });
  decks.forEach((d0, di) => {
    for (const side of [0, 1]) {
      const d = out[di], n = d.pts.length;
      if (n < 2) return;
      const pts = side ? d.pts.slice().reverse() : d.pts, tops = side ? Array.from(d.tops).reverse() : Array.from(d.tops);
      const E = pts[0], ul = dist(pts[1], E) || 1, u = [(pts[1][0] - E[0]) / ul, (pts[1][1] - E[1]) / ul];
      if (wayEndingAt(carved, E, u, B.join, B.align)) continue;                   // (an approach runs onto it: road-network.js shapes that end)
      if (wayEndingAt(bridgeWays, E, u, B.join, B.align)) continue;               // (the bridge goes on: a deckless piece or the next deck of a viaduct)
      // (a joint: another deck ends here too - one bridge in pieces, or footbridges that branch in the air over the Autoroute de Dudelange (decks 113 / 141 / 165: trimmed, the
      // new end was pinned to the motorway under it and ramped up in its lanes) - unless it is a footway's or a track's joint that crosses a street AT ITS LEVEL: the two
      // track decks of Rue de Leudelange meet on Rue Roudebësch, decks 155 / 304)
      const atGrade = tops.length > 1 && tops[1] - groundAt(E[0], E[1]) < B.trimClear;
      const crossesStreet = atGrade && !wayEndingAt(bridgeWays, E, [-u[0], -u[1]], B.join, B.align) && wayEndingAt(allBridges, E, [-u[0], -u[1]], B.join, B.align) &&
        carved.some((r) => polyDist(E, r.pts) < r.width / 2);
      const endsHere = (o) => dist(o.pts[0], E) <= B.joint || dist(o.pts[o.pts.length - 1], E) <= B.joint;
      if (!crossesStreet && out.some((o, oi) => oi !== di && o.pts.length > 1 && endsHere(o))) continue;
      // a car's deck only where a street junction lies at its end (two or more carved ways end there: the Hondhausbréck at Rue Vauban / Allée Pierre de Mansfeld); the decks of
      // an interchange that meet slip roads beside their ends keep them (Autoroute de Dudelange 6593, Clausener Bréck 473 measured worse when trimmed)
      const ownCar = carDeck[di];
      // (the pavement deck beside a road bridge: the road's outer lane may lie on it where the road's deck is narrower than its way - Autoroute de Dudelange 6593 beside
      // footway deck 118 lost its outer lane's ground and flew 0.35 s when it was trimmed)
      if (!ownCar && decks.some((o, oi) => carDeck[oi] && oi !== di && o.pts.length > 1 && polyDist(E, o.pts) <= o.width / 2 + B.besideCar)) continue;
      if (ownCar && carved.filter((r) => dist(r.pts[0], E) <= B.join || dist(r.pts[r.pts.length - 1], E) <= B.join).length < 2) continue;
      const cum = arcsOf(pts), len = cum[cum.length - 1];
      const near = carved.filter((r) => polyDist(E, r.pts) < r.width / 2 + d.width / 2 + B.trimEdge + B.trimMax);
      if (!near.length) continue;
      const hw = d.width / 2;
      let s = 0, over = false;
      for (; s <= Math.min(B.trimMax, len - B.trimKeep); s += B.trimStep) {
        const P = pointAt(pts, cum, s), k = Math.min(pts.length - 1, Math.max(1, cum.findIndex((c) => c >= s)));
        const top = tops[k - 1] + (tops[k] - tops[k - 1]) * Math.min(1, Math.max(0, (s - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1)));
        // (a bridge over the street from here on; the level of the deck no steeper than DECK_END_GRADE off its land at the end: the DSM of the Hondhausbréck stood 4 m over the junction)
        // (a footbridge's own DSM is its level; a car's deck is enveloped by decks.js from its end)
        const level = ownCar ? Math.min(top, groundAt(E[0], E[1]) + B.endGrade * s) : top;
        if (level - groundAt(P[0], P[1]) >= B.trimClear) { over = true; break; }
        const c = [P, [P[0] - u[1] * hw, P[1] + u[0] * hw], [P[0] + u[1] * hw, P[1] - u[0] * hw]];
        if (!near.some((r) => c.some((q) => polyDist(q, r.pts) < r.width / 2 + B.trimEdge))) break;
      }
      // (nothing to trim; the deck would be all street; or it rises over the street before it leaves the carriageway - a footbridge over it: its end would be pinned
      // to the street under it, a ramp in the lanes)
      if (over || s <= B.trimStep || s > Math.min(B.trimMax, len - B.trimKeep)) continue;
      const keep = slice(pts, cum, s, len), k0 = cum.findIndex((c) => c > s);
      const t0 = tops[k0 - 1] + (tops[k0] - tops[k0 - 1]) * ((s - cum[k0 - 1]) / ((cum[k0] - cum[k0 - 1]) || 1));
      const keepTops = [t0, ...tops.slice(k0, k0 + keep.length - 1)];
      const newPts = side ? keep.slice().reverse() : keep, newTops = side ? keepTops.slice().reverse() : keepTops;
      out[di] = { ...d, pts: newPts, tops: Float32Array.from(newTops), spans: spansOf(newPts, groundAt) };
      trimmed.push({ deck: d.id, by: +s.toFixed(2), x: +E[0].toFixed(1), z: +E[1].toFixed(1) });
    }
  });
  return { decks: out, trimmed };
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
  const touched = new Set();                                           // (an end of an approach way gives up one stretch: "id:end")
  decks.forEach((d0, di) => {
    for (const side of [0, 1]) {
      const d = outDecks[di], n = d.pts.length;
      if (n < 2) return;
      const e = side ? n - 1 : 0, f = side ? n - 2 : 1, E = d.pts[e];
      const ul = dist(d.pts[f], E) || 1, u = [(d.pts[f][0] - E[0]) / ul, (d.pts[f][1] - E[1]) / ul];     // into the deck
      const approach = wayEndingAt(carved, E, u, B.join, B.align);
      const bridge = wayEndingAt(bridgeIds.map((id) => outRoads[id]), E, [-u[0], -u[1]], B.join, B.align);   // (the bridge way leaves through E away from the deck's inside)
      if (!approach || !bridge) continue;
      const endKey = `${approach.way.id}:${approach.atEnd ? 1 : 0}`;
      if (touched.has(endKey)) continue;
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
      // a slip road that merges with the approach AT the abutment runs onto the bridge with it (the A1 link 7463 at deck 42 over the Val du Scheid): it gives up the same stretch,
      // its new end lies beside the approach's (road-network.js pins the ends there to the deck); any other way that meets the approach on the moved stretch or at the end
      // (a side street at the abutment) would end on the deck: no move
      const merging = wayEndingAt(carved.filter((r) => r.id !== a.id), E, u, B.join, B.align);
      const mergeOk = merging && !touched.has(`${merging.way.id}:${merging.atEnd ? 1 : 0}`) && arcsOf(outRoads[merging.way.id].pts).at(-1) - by >= B.minLeft;
      const others = carved.filter((r) => r.id !== a.id && !(mergeOk && r.id === merging.way.id));
      if (merging && !mergeOk) continue;
      if (others.some((r) => [r.pts[0], r.pts[r.pts.length - 1]].some((p) => piece.some((q, k) => k > 0 && dist(p, q) <= B.join) || dist(p, E) <= B.join))) continue;
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
      if (mergeOk) {
        const m = outRoads[merging.way.id], mc = arcsOf(m.pts), ml = mc[mc.length - 1];
        const mrest = merging.atEnd ? slice(m.pts, mc, 0, ml - by) : slice(m.pts, mc, by, ml);
        outRoads[m.id] = { ...m, pts: mrest, length: ml - by };
        touched.add(`${m.id}:${merging.atEnd ? 1 : 0}`);
      }
      outRoads[bw.id] = { ...bw, pts: bpts, length: arcsOf(bpts).at(-1) };
      touched.add(endKey);
      moved.push({ deck: d.id, way: bw.id, approach: a.id, merging: mergeOk ? merging.way.id : null, under, by: +by.toFixed(2), x: +E[0].toFixed(1), z: +E[1].toFixed(1) });
    }
  });
  return { roads: outRoads, decks: outDecks, moved };
}
