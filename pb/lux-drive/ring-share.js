/* A service ring that runs along a street for a segment or two is opened there (city22).  OSM closes the loop of a car park or a yard over the nodes of the street it
 * leaves: ring 10335 (a 6.4 m service, its own bed 1.5 m over the street's) lies ON the carriageway of the secondary 4504 between two of its nodes (9632,9376 - 9641,9364).
 * The carve took the two for two carriageways at two levels overlapping in plan and handed the point over to the service: a 0.9 m hump in 4504's lane - the sweep's fall of
 * 3.1 m at 57 m/s, air 1.17 s, the city's worst main-road place.  The street drawn twice is the street: the ring loses its run of segments that lie on two consecutive points
 * of another drivable car way, and becomes an open way whose two ends are junctions with that way.  Applied in loadWorldData, so the game, the harness and the bakers
 * read the same ways.  Pure: new road objects for the changed ways, the others as they are. */

export const RING_SHARE = Object.freeze({
  node: 0.25,          // m: two points this close are one node
});

const key = (p) => `${Math.round(p[0] / RING_SHARE.node)},${Math.round(p[1] / RING_SHARE.node)}`;
const isRing = (r) => r.pts.length >= 4 && key(r.pts[0]) === key(r.pts[r.pts.length - 1]);

/** roads: the decoded roads (road.id = the index).  Returns { roads, opened: [{ id, along, segments }] }. */
export function openSharedRings(roads) {
  const usable = roads.filter((r) => r && r.pts && r.pts.length >= 2 && r.info && r.info.drivable && !r.tunnel);
  const owners = new Map();                     // segment (its two nodes, unordered) -> the ways that have it
  for (const r of usable) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = key(r.pts[i]), b = key(r.pts[i + 1]), k = a < b ? `${a}|${b}` : `${b}|${a}`;
      const l = owners.get(k);
      if (!l) owners.set(k, [r]); else if (!l.includes(r)) l.push(r);
    }
  }
  const opened = [];
  const changed = new Map();
  for (const r of usable) {
    if (r.kind !== 'service' || !isRing(r)) continue;
    const m = r.pts.length - 1;                  // the ring's distinct points (pts[m] closes it on pts[0])
    const shared = new Uint8Array(m);
    let along = -1;
    for (let i = 0; i < m; i++) {
      const a = key(r.pts[i]), b = key(r.pts[i + 1]), k = a < b ? `${a}|${b}` : `${b}|${a}`;
      const other = (owners.get(k) || []).find((q) => q !== r);
      if (other) { shared[i] = 1; along = other.id; }
    }
    // the longest run of shared segments (cyclic); a ring that is shared all round stays as it is
    let bestStart = -1, bestLen = 0;
    for (let s = 0; s < m; s++) {
      if (!shared[s] || shared[(s + m - 1) % m]) continue;     // (a run starts after a segment of its own)
      let len = 0;
      while (len < m && shared[(s + len) % m]) len++;
      if (len > bestLen && len < m) { bestLen = len; bestStart = s; }
    }
    if (bestStart < 0 || m - bestLen < 2) continue;
    // the open way: from the node after the run, round the ring, to the node where the run starts
    const pts = [];
    for (let j = 0; j <= m - bestLen; j++) pts.push(r.pts[(bestStart + bestLen + j) % m]);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    changed.set(r.id, { ...r, pts, length });
    opened.push({ id: r.id, along, segments: bestLen });
  }
  return { roads: changed.size ? roads.map((r) => (r && changed.has(r.id) ? changed.get(r.id) : r)) : roads, opened };
}
