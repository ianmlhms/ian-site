/* The CARRIAGEWAYS of the road network: consecutive ways of one road joined into chains.  OSM cuts a road into many ways (at every bridge, every change of the lane count,
 * every bus lane): for the paint they are one carriageway.  The road network (road-network.js) uses the chains to tell the median between two carriageways from the hand-over
 * between two ways of one carriageway; the lane markings (markings.js) run along them.
 * Pure (no THREE, no imports of the network: the caller hands in the centre line of a way, so road-network.js can call it while it is being built). */

export const JOIN = Object.freeze({
  dist: 1.0,                                 // m: two way ends this close are one node
  cos: Math.cos(35 * Math.PI / 180),         // two ways continue each other when they meet at a node at less than this angle
});

/** A way with lane markings (the classes with lines: kindInfo .lines 1 or 2) that a car drives on. */
export const isMarkedWay = (road) => !!(road && road.info && road.info.drivable && !road.tunnel && road.pts && road.pts.length >= 2 && (road.info.lines === 1 || road.info.lines === 2));

/** The ends of every drivable way at the nodes of the network: node key -> [{ road, atStart, dx, dz }] (d: the direction OUT of the way at that end). */
function wayEnds(roads, lineOf) {
  const nodes = [];
  const grid = new Map();
  const cellOf = (x, z) => `${Math.floor(x / 2)}:${Math.floor(z / 2)}`;
  const nodeAt = (x, z) => {
    const cx = Math.floor(x / 2), cz = Math.floor(z / 2);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      for (const nd of grid.get(`${cx + dx}:${cz + dz}`) || []) if (Math.hypot(nd.x - x, nd.z - z) <= JOIN.dist) return nd;
    }
    const nd = { x, z, ends: [] };
    nodes.push(nd);
    const k = cellOf(x, z);
    const l = grid.get(k);
    if (l) l.push(nd); else grid.set(k, [nd]);
    return nd;
  };
  for (const road of roads) {
    if (!road.info || !road.info.drivable || road.tunnel || !road.pts || road.pts.length < 2) continue;
    const line = lineOf(road);
    if (!line || line.x.length < 2) continue;
    const n = line.x.length;
    for (const atStart of [true, false]) {
      const i = atStart ? 0 : n - 1, j = atStart ? 1 : n - 2;
      let dx = line.x[i] - line.x[j], dz = line.z[i] - line.z[j];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      nodeAt(line.x[i], line.z[i]).ends.push({ road: road.id, atStart, dx, dz });
    }
  }
  return nodes;
}


/**
 * roads: the decoded roads (road.id = the index); lineOf(road): its centre line { x, z } as the network draws it (null: the way is not a carriageway).
 * Only MARKED ways (the classes with lane markings) are chained (the others are a chain of their own).
 * Returns { chainWays: [[{ road, rev }]] (the marked chains, `rev`: walked from its end to its start), groupOf: Int32Array (road -> its chain; an unchained road: roads.length + its id),
 *           plainNeighbours: Map(road -> Set of roads it meets end to end at a node of two ends only), forkEnds: Set of `${road}:${atStart ? 1 : 0}` (a merge / split end) }.
 */
export function chainCarriageways(roads, lineOf) {
  const marked = roads.filter((r) => isMarkedWay(r) && lineOf(r));
  const isMarked = new Uint8Array(roads.length);
  for (const r of marked) isMarked[r.id] = 1;
  const nodes = wayEnds(roads, lineOf);

  // ---- the joins: at every node the pairs of marked ways that continue each other (one partner per end)
  const partner = new Map();             // `${road}:${atStart}` -> { road, atStart }
  const endKey = (e) => `${e.road}:${e.atStart ? 1 : 0}`;
  const forkEnds = new Set();            // `${road}:${atStart}` of the ends where two marked ways or more go on from a way (a merge / a split)
  const plainNeighbours = new Map();     // road -> Set of the roads it meets end to end at a node of two ends only (one carriageway in two ways, chained or not)
  const addPlain = (a, b) => { for (const [p, q] of [[a, b], [b, a]]) { let s = plainNeighbours.get(p); if (!s) { s = new Set(); plainNeighbours.set(p, s); } s.add(q); } };
  for (const nd of nodes) {
    if (nd.ends.length === 2 && nd.ends[0].road !== nd.ends[1].road) addPlain(nd.ends[0].road, nd.ends[1].road);
    const ms = nd.ends.filter((e) => isMarked[e.road]);
    if (ms.length < 2) continue;
    const pairs = [];
    for (let a = 0; a < ms.length; a++) {
      for (let b = a + 1; b < ms.length; b++) {
        const ea = ms[a], eb = ms[b];
        if (ea.road === eb.road) continue;
        const cos = -(ea.dx * eb.dx + ea.dz * eb.dz);           // the way out of one and the way into the other
        if (cos < JOIN.cos) continue;
        const ra = roads[ea.road], rb = roads[eb.road];
        const sameName = !!ra.name && ra.name === rb.name;
        const sameKind = ra.kind === rb.kind;
        // at a fork (three ends and more) the carriageway goes on into the way of its own name / class; at a plain node of two ends anything that goes on straight is the same carriageway
        if (nd.ends.length > 2 && !sameName && !sameKind) continue;
        // a one-way way continues a one-way way in its own direction (the end of one is the start of the other)
        if (ra.oneway && rb.oneway && ea.atStart === eb.atStart) continue;
        const score = (1 - cos) + (sameName ? 0 : 0.3) + (sameKind ? 0 : 0.2) + Math.abs(ra.width - rb.width) * 0.02;
        pairs.push({ ea, eb, score });
      }
    }
    // the ends where a way meets TWO or more marked ways that both go on from it (a merge: Kirchberg 6060 + 12330 -> 9423; a split): the way is the whole of both there, not the
    // continuation of the one partner it is chained to (road-network.js: its width does not taper to that partner's across the node - walls13)
    for (const e of ms) {
      const goOn = ms.filter((o) => o.road !== e.road && -(e.dx * o.dx + e.dz * o.dz) >= JOIN.cos && !(roads[e.road].oneway && roads[o.road].oneway && e.atStart === o.atStart));
      if (goOn.length >= 2) forkEnds.add(endKey(e));
    }
    pairs.sort((p, q) => p.score - q.score);
    for (const { ea, eb } of pairs) {
      if (partner.has(endKey(ea)) || partner.has(endKey(eb))) continue;
      partner.set(endKey(ea), eb); partner.set(endKey(eb), ea);
    }
  }

  // ---- the chains: follow the joins (orientation: `rev` = the way is walked from its end to its start)
  const visited = new Uint8Array(roads.length);
  const chainWays = [];
  const walk = (road, rev) => {
    const list = [];
    let cur = road, curRev = rev;
    while (cur >= 0 && !visited[cur]) {
      visited[cur] = 1;
      list.push({ road: cur, rev: curRev });
      const exit = { road: cur, atStart: curRev };          // walked forward, the way is left at its end
      const next = partner.get(endKey(exit));
      if (!next) break;
      cur = next.road; curRev = !next.atStart;                // entered at its start: walked forward
    }
    return list;
  };
  for (const r of marked) {
    if (visited[r.id]) continue;
    const startFree = !partner.has(`${r.id}:1`), endFree = !partner.has(`${r.id}:0`);
    if (startFree) chainWays.push(walk(r.id, false));
    else if (endFree) chainWays.push(walk(r.id, true));
  }
  for (const r of marked) if (!visited[r.id]) chainWays.push(walk(r.id, false));     // rings

  const groupOf = new Int32Array(roads.length);
  for (let r = 0; r < roads.length; r++) groupOf[r] = roads.length + r;
  chainWays.forEach((ws, c) => { for (const w of ws) groupOf[w.road] = c; });
  return { chainWays, groupOf, plainNeighbours, forkEnds };
}
