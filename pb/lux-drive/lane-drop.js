/* A merge lane ends before a tunnel (tunnels19).  OSM maps the stretch where an on-ramp's lane runs beside the motorway as a way with one lane more, up to the next
 * change - at Cents north the mouth of the 2-lane tunnel: way 2929, 3 lanes (13.45 m) from the joint of the on-ramp 125 to the mouth of tube 158 (2 lanes, 9.8 m).  Drawn so,
 * its outer lane ran into the wall of the tube's trough and the face (the sweep: a hit in that lane at every speed); in Luxembourg the merge lane ends well before the mouth.
 * So a one-way approach into a tunnel way with fewer lanes, that starts where an on-ramp (a *_link) joins the carriageway it continues, is drawn with that carriageway's
 * width and lanes: the ramp merges at the joint.  Applied in loadWorldData (after the lane flicker), so the game, the harness and the bakers read the same widths.
 * Pure: new road objects for the changed ways, the others as they are. */

export const LANE_DROP = Object.freeze({
  joinGap: 1.0,        // m: two way ends this close are one node
  minExtra: 1.0,       // m: the approach is at least this much wider than the tunnel way
  maxLength: 150,      // m: ... and at most this long (a merge stretch, not a widened motorway)
  sameWidth: 0.5,      // m: the carriageway it continues has the tunnel's width within this
});

const first = (r) => r.pts[0];
const last = (r) => r.pts[r.pts.length - 1];
const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= LANE_DROP.joinGap;
const isLink = (r) => /_link$/.test(r.kind || '');

/** roads: the decoded roads (road.id = the index).  Returns { roads, dropped: [{ id, tunnel, from: { width, lanes }, to: { width, lanes }, via }] }. */
export function dropMergeLanes(roads) {
  const usable = roads.filter((r) => r && r.pts && r.pts.length >= 2 && r.info && r.info.drivable);
  // (the ways that start / end within a cell of 8 m: the joins are read only among them)
  const CELL = 8, starts = new Map(), ends = new Map();
  const put = (map, p, r) => { const k = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`; const l = map.get(k); if (l) l.push(r); else map.set(k, [r]); };
  const around = (map, p) => {
    const out = [], cx = Math.floor(p[0] / CELL), cz = Math.floor(p[1] / CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) out.push(...(map.get(`${cx + a},${cz + b}`) || []));
    return out;
  };
  for (const r of usable) { put(starts, first(r), r); put(ends, last(r), r); }
  const dropped = [];
  for (const r of usable) {
    if (!r.oneway || r.tunnel || r.bridge || !(r.length <= LANE_DROP.maxLength)) continue;
    const tube = around(starts, last(r)).find((t) => t !== r && t.tunnel && t.oneway && near(first(t), last(r)));
    if (!tube || !((r.lanes || 1) > (tube.lanes || 1)) || r.width < tube.width + LANE_DROP.minExtra) continue;
    const into = around(ends, first(r)).filter((q) => q !== r && near(last(q), first(r)));
    const main = into.find((q) => !isLink(q) && q.oneway && (q.lanes || 1) === (tube.lanes || 1) && Math.abs(q.width - tube.width) <= LANE_DROP.sameWidth);
    const ramp = into.find((q) => isLink(q));
    if (!main || !ramp) continue;
    dropped.push({ id: r.id, tunnel: tube.id, from: { width: r.width, lanes: r.lanes }, to: { width: main.width, lanes: main.lanes }, via: ramp.id });
  }
  if (!dropped.length) return { roads, dropped };
  const to = new Map(dropped.map((d) => [d.id, d.to]));
  return { roads: roads.map((r) => (r && to.has(r.id) ? { ...r, width: to.get(r.id).width, lanes: to.get(r.id).lanes, laneDrop: true } : r)), dropped };
}
