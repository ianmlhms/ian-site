/* The Luxtram network of Lux Drive: the rails of the bake as a graph, the two tracks of the line (one per direction), and the
 * stops on them.  Pure (no THREE), so the browser and the Node probes build exactly the same network.
 *
 * lines.bin holds every OSM tram way of the main network (kind 2): both tracks, the crossovers, the branches.  The graph joins
 * ways whose ends are the same node (to the half metre).  The line of the game runs between the two terminals that the stops
 * name (Luxexpo in the north, Stadion in the south): track A is the shortest way from the north terminal to the south one, track B
 * is the shortest way back that avoids the edges of A as far as the network allows (a crossover that A uses must be used by B
 * too).  Luxembourg drives on the right, so the vehicle on A has B on its LEFT; if the bake has it the other way round the
 * two tracks swap their roles. */

const KEY_SCALE = 2;                 // two nodes are one when they round to the same half metre
const PENALTY = 1e6;                 // m: the cost of an edge that the other track already uses
const SEARCH_MAX_DIST = 400;         // m: a terminal stop and the end of the rails are this close at most

/** The graph of the tram ways: { nodes: [{ x, z, adj: [[node, length]] }], ways: [Float32Array of x,z] }. */
export function buildGraph(lines) {
  const byKey = new Map();
  const nodes = [];
  const nodeAt = (x, z) => {
    const key = Math.round(x * KEY_SCALE) + ',' + Math.round(z * KEY_SCALE);
    let n = byKey.get(key);
    if (!n) { n = { id: nodes.length, x, z, adj: [] }; byKey.set(key, n); nodes.push(n); }
    return n;
  };
  const ways = [];
  for (const line of lines) {
    const pts = line.pts;
    ways.push(pts);
    let prev = null;
    for (let i = 0; i < pts.length; i += 2) {
      const n = nodeAt(pts[i], pts[i + 1]);
      if (prev && prev !== n) {
        const len = Math.hypot(n.x - prev.x, n.z - prev.z);
        prev.adj.push([n.id, len]); n.adj.push([prev.id, len]);
      }
      prev = n;
    }
  }
  return { nodes, ways };
}

const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/** Dijkstra from `src` to `dst` (node ids); an edge in `penalised` costs PENALTY more.  Returns { length, nodes: [ids] } or null. */
export function shortestPath(graph, src, dst, penalised = null) {
  const n = graph.nodes.length;
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  dist[src] = 0;
  // a binary heap of [dist, node]
  const heap = [[0, src]];
  const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === dst) break;
    for (const [v, len] of graph.nodes[u].adj) {
      const cost = len + (penalised && penalised.has(edgeKey(u, v)) ? PENALTY : 0);
      if (d + cost < dist[v]) { dist[v] = d + cost; prev[v] = u; push([dist[v], v]); }
    }
  }
  if (!Number.isFinite(dist[dst])) return null;
  const out = [];
  for (let v = dst; v >= 0; v = prev[v]) out.push(v);
  out.reverse();
  return { length: dist[dst], nodes: out };
}

/** A polyline resampled every `spacing` metres (the corners stay corners: the OSM node spacing of a tram line is already fine). */
export function resample(pts, spacing) {
  const out = [pts[0], pts[1]];
  let carry = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2], az = pts[i - 1], bx = pts[i], bz = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    let d = spacing - carry;
    while (d <= len) { out.push(ax + (bx - ax) * (d / len), az + (bz - az) * (d / len)); d += spacing; }
    carry = len - (d - spacing);
  }
  const lx = pts[pts.length - 2], lz = pts[pts.length - 1];
  if (Math.hypot(out[out.length - 2] - lx, out[out.length - 1] - lz) > 0.05) out.push(lx, lz);
  return Float32Array.from(out);
}

/** Rounds the corners with a Gaussian along the line (the ends stay where they are): a tram does not turn on the spot. */
export function smooth(pts, sigmaSteps) {
  const n = pts.length / 2;
  const out = new Float32Array(pts.length);
  const radius = Math.ceil(sigmaSteps * 2.5);
  const weights = [];
  for (let k = -radius; k <= radius; k++) weights.push(Math.exp(-(k * k) / (2 * sigmaSteps * sigmaSteps)));
  for (let i = 0; i < n; i++) {
    let sx = 0, sz = 0, sw = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      // near an end the window is mirrored so the line does not shrink away from its terminal
      const w = weights[k + radius];
      sx += pts[j * 2] * w; sz += pts[j * 2 + 1] * w; sw += w;
    }
    out[i * 2] = sx / sw; out[i * 2 + 1] = sz / sw;
  }
  out[0] = pts[0]; out[1] = pts[1]; out[pts.length - 2] = pts[pts.length - 2]; out[pts.length - 1] = pts[pts.length - 1];
  return out;
}

/** A track: a resampled centre line with the distance along it.  at(s, out) = { x, z, dx, dz } (the unit direction). */
export function createTrack(pts, name) {
  const n = pts.length / 2;
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  const length = cum[n - 1];
  function segmentOf(s) {
    let lo = 0, hi = n - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function at(s, out) {
    const c = s < 0 ? 0 : s > length ? length : s;
    const i = segmentOf(c);
    const seg = cum[i + 1] - cum[i] || 1;
    const t = (c - cum[i]) / seg;
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[i * 2 + 2], bz = pts[i * 2 + 3];
    out.x = ax + (bx - ax) * t; out.z = az + (bz - az) * t;
    out.dx = (bx - ax) / seg; out.dz = (bz - az) / seg;
    return out;
  }
  /** The distance along the track of the point of the track nearest to (x, z): { s, dist, side } (side > 0: to the right of the travel direction). */
  function project(x, z, out) {
    let best = Infinity, bs = 0, side = 0;
    for (let i = 0; i < n - 1; i++) {
      const ax = pts[i * 2], az = pts[i * 2 + 1], ex = pts[i * 2 + 2] - ax, ez = pts[i * 2 + 3] - az;
      const ll = ex * ex + ez * ez;
      let t = ll > 1e-9 ? ((x - ax) * ex + (z - az) * ez) / ll : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
      if (d < best) { best = d; bs = cum[i] + Math.sqrt(ll) * t; side = ((x - ax) * -ez + (z - az) * ex) / (Math.sqrt(ll) || 1); }
    }
    out.s = bs; out.dist = best; out.side = side;
    return out;
  }
  return { name, pts, cum, length, at, project };
}

function terminalEnds(graph, stops, stopName) {
  const marks = stops.filter((s) => s.kind === 0 && s.name === stopName);
  if (!marks.length) throw new Error(`tram network: no tram stop called ${stopName}`);
  const cx = marks.reduce((a, s) => a + s.x, 0) / marks.length, cz = marks.reduce((a, s) => a + s.z, 0) / marks.length;
  const ends = graph.nodes.filter((nd) => nd.adj.length === 1)
    .map((nd) => ({ nd, d: Math.hypot(nd.x - cx, nd.z - cz) })).sort((a, b) => a.d - b.d);
  if (ends.length < 2 || ends[1].d > SEARCH_MAX_DIST) throw new Error(`tram network: the rails have no two ends near ${stopName} (${ends.length ? ends[0].d.toFixed(0) : '-'} m)`);
  return [ends[0].nd, ends[1].nd];
}

/** The stops of a track: the platform nodes within `snap` of its centre line, merged when they belong to one stop.
 *  [{ name, s, side, x, z }] sorted along the track; `side` > 0 = the platform is to the right of the travel direction. */
function stopsOfTrack(track, stops, cfg) {
  const hit = [];
  const proj = { s: 0, dist: 0, side: 0 };
  for (const stop of stops) {
    if (stop.kind !== 0) continue;                     // the tram stops (the bake flags the railway platforms as 1)
    track.project(stop.x, stop.z, proj);
    if (proj.dist <= cfg.stopSnap) hit.push({ name: stop.name, s: proj.s, side: proj.side, x: stop.x, z: stop.z, dist: proj.dist });
  }
  hit.sort((a, b) => a.s - b.s);
  const merged = [];
  for (const h of hit) {
    const last = merged[merged.length - 1];
    if (last && last.name === h.name && h.s - last.s < cfg.stopMerge) { if (h.dist < last.dist) Object.assign(last, h, { s: (last.s + h.s) / 2 }); continue; }
    merged.push({ ...h });
  }
  return merged;
}

/**
 * lines: decodeLines(), stops: decodeStops(), cfg: config.TRAM.
 * Returns { graph, ways, tracks: [A, B], stops: [[...A], [...B]], terminals }.
 *   A runs from the north terminal to the south one, B back; the vehicle on A has B on its left (it drives on the right).
 */
export function createTramNetwork(lines, stops, cfg, { north = 'Luxexpo', south = 'Stadion' } = {}) {
  const graph = buildGraph(lines.filter((l) => l.kind === 2));
  const [n0, n1] = terminalEnds(graph, stops, north);
  const [s0, s1] = terminalEnds(graph, stops, south);
  // two ends at each terminal: pair them so that the second track is the cheaper one
  let best = null;
  for (const [nA, sA, nB, sB] of [[n0, s0, n1, s1], [n0, s1, n1, s0]]) {
    const a = shortestPath(graph, nA.id, sA.id);
    if (!a) continue;
    const used = new Set();
    for (let i = 1; i < a.nodes.length; i++) used.add(edgeKey(a.nodes[i - 1], a.nodes[i]));
    const b = shortestPath(graph, sB.id, nB.id, used);
    if (!b) continue;
    if (!best || a.length + b.length < best.cost) best = { a, b, cost: a.length + b.length };
  }
  if (!best) throw new Error('tram network: no pair of tracks joins the terminals');
  const toPts = (path) => { const o = []; for (const id of path.nodes) o.push(graph.nodes[id].x, graph.nodes[id].z); return Float32Array.from(o); };
  const line = (path) => smooth(resample(toPts(path), 1.0), 4);
  let trackA = createTrack(line(best.a), 'A'), trackB = createTrack(line(best.b), 'B');
  // the vehicle drives on the right: B must lie on the LEFT of A (side < 0 at the middle of the line)
  const mid = trackA.at(trackA.length / 2, { x: 0, z: 0, dx: 0, dz: 0 });
  const probe = { s: 0, dist: 0, side: 0 };
  trackB.project(mid.x, mid.z, probe);
  const rightOfA = ((probe.s >= 0 ? 1 : 1) * ((trackB.at(probe.s, { x: 0, z: 0, dx: 0, dz: 0 }).x - mid.x) * -mid.dz + (trackB.at(probe.s, { x: 0, z: 0, dx: 0, dz: 0 }).z - mid.z) * mid.dx)) > 0;
  if (rightOfA) {
    const rev = (t, name) => { const p = new Float32Array(t.pts.length); const n = t.pts.length / 2; for (let i = 0; i < n; i++) { p[i * 2] = t.pts[(n - 1 - i) * 2]; p[i * 2 + 1] = t.pts[(n - 1 - i) * 2 + 1]; } return createTrack(p, name); };
    [trackA, trackB] = [rev(trackB, 'A'), rev(trackA, 'B')];
  }
  const tracks = [trackA, trackB];
  return { graph, ways: graph.ways, tracks, stops: tracks.map((t) => stopsOfTrack(t, stops, cfg)) };
}
