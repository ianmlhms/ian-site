/* The lane markings of Lux Drive, planned per CARRIAGEWAY, not per lattice node.
 *
 * Before: the shader drew the centre line from the offset / distance along of the ONE nearest way, interpolated over the 1 m lattice, and the edge line as a contour of the union of the
 * carriageways.  Where the nearest way changed inside a lattice cell (a hand-over from one way to the next, a slip road, a junction, a narrow median) the interpolation drew scribbles,
 * the edge line followed every tooth of a ragged median, the centre of a one-way motorway was a solid line, and the lines of a bridge deck (laid out from the deck width) did not meet
 * the lines of the road.
 *
 * Now: consecutive ways of one carriageway are joined into a CHAIN (one polyline).  Every way has a lane layout (edge lines, the centre line or the lane dividers, from its class, its
 * lanes, its width and whether it is one way); the lines run along the chain as TRACKS with one continuous offset (a change of the lane count is a taper, never a jump) and one continuous
 * distance along (the dashes keep their rhythm across a hand-over).  A line is CUT where it lies inside another carriageway at its own level (the mouth of a side street, the box of a
 * junction, the nose of a slip road), so no line is ever painted across another road.  The render (tile-mesh.js) drapes the visible pieces as thin ribbons over the very triangles of the
 * terrain tile (and the deck view lays the pieces on a bridge onto the deck), so the edges of a line are straight geometry, never a contour of a lattice.
 *
 * Pure (no THREE): the browser and the harness build the same plan. */
import { ROAD } from './config.js';
import { kindInfo } from './roads.js';
import { resample, gaussianSmooth } from './road-network.js';
import { isMarkedWay, JOIN } from './carriageways.js';

export { isMarkedWay };

export const MARK = Object.freeze({
  lineHalf: 0.075,          // m: half the width of a line (15 cm of paint)
  edgeInset: 0.5,           // m: an edge line lies this far inside the edge of the carriageway (a street without a hard shoulder) ...
  edgeInsetMin: 0.35,       // ... and never closer to it than this
  edgeMinHw: 3.5,           // m: a street narrower than this (half width) has no edge lines (a motorway, a trunk road and their slip roads always have them)
  shoulderLeft: 0.15,       // the share of the shoulder of a motorway / trunk carriageway on its LEFT (the median side): the rest is the hard shoulder on the right
  shoulderLeftMin: 0.25,    // m
  shoulderLeftMax: 0.6,     // m
  dashPeriod: 9,            // m: a dashed line is DASH_LENGTH of paint every DASH_PERIOD
  dashLength: 3,
  taperRatio: 12,           // m of length per m of lateral shift: a line that moves (a lane is added / dropped) moves at 1 : 12 ...
  taperMin: 8,             // ... over at least this length
  cutStep: 0.5,             // m: the resolution of the cut along a line
  cutInside: 0.05,          // m: a line point this deep inside ANOTHER carriageway is cut
  levelApart: 1.2,          // m: two carriageways whose beds differ by more than this are at two levels (a bridge over the road): no cut
  minPiece: 1.5,            // m: a piece of a solid line shorter than this after the cuts is a fragment: not painted
  minDash: 0.6,             // m: nor a dash cut shorter than this (tile-mesh.js)
  onRoad: 0.15,             // m: a line is painted only where the terrain's carriageway paint lies at least this far around it (tile-mesh.js): never up a wall or a ramp
  cell: 32,                 // m: the grid of the pieces (one LOD 0 tile)
  deckLevel: 1.0,           // m: a line of a carved way lies ON a deck where the deck top is within this of the way's bed (else the deck is a bridge over it)
  deckLift: 0.035,          // m: the paint on a deck lies this far over its asphalt (deck-shape.js PAINT_LIFT)
});

/* The lanes of a class: the lane width (bake_roads.py ROAD_KINDS) and whether its carriageway has a hard shoulder on the right (asymmetric layout). */
const LANE_WIDTH = { motorway: 3.65, trunk: 3.5, primary: 3.4, secondary: 3.3, tertiary: 3.2 };
const SHOULDER_CLASSES = new Set(['motorway', 'trunk', 'motorway_link', 'trunk_link']);
const parentClass = (kind) => kind.replace(/_link$/, '');


/**
 * The lines of ONE way, in the frame of the way (offset positive = to the right of the way's direction): [{ role: 'edge' | 'centre' | 'divider', o, dashed }].
 *  - a one-way carriageway: the edge lines and DASHED dividers between its lanes (a single lane has no centre line); a motorway / trunk carriageway has its lanes on the left and the
 *    hard shoulder on the right;
 *  - a two-way road: the centre line (dashed on a primary / secondary of up to three lanes, solid on a trunk road or a road of four lanes and more), dashed dividers between the lanes of
 *    one direction, the edge lines on a wide street.
 */
export function laneLayout(road) {
  const hw = Math.max(0.8, road.width / 2);
  const cls = parentClass(road.kind);
  const laneW = LANE_WIDTH[cls] || 3.2;
  const lanes = Math.max(1, road.lanes || (road.oneway ? 1 : 2));
  const shoulder = SHOULDER_CLASSES.has(road.kind);
  const lines = [];
  if (road.oneway) {
    const usable = 2 * hw - 2 * MARK.edgeInsetMin;
    const w = Math.min(laneW, usable / lanes);
    let left;
    if (shoulder) {
      const margin = 2 * hw - lanes * w;
      left = -hw + Math.min(MARK.shoulderLeftMax, Math.max(MARK.shoulderLeftMin, margin * MARK.shoulderLeft));
    } else left = -(lanes * w) / 2;
    const right = left + lanes * w;
    if (shoulder || hw >= MARK.edgeMinHw) {
      lines.push({ role: 'edge', o: shoulder ? left : Math.max(left, -hw + MARK.edgeInset), dashed: false, side: -1 });
      lines.push({ role: 'edge', o: shoulder ? right : Math.min(right, hw - MARK.edgeInset), dashed: false, side: 1 });
    }
    for (let k = 1; k < lanes; k++) lines.push({ role: 'divider', o: left + k * w, dashed: true, side: 0 });
    return lines;
  }
  // two-way: lanes split evenly between the two directions (an odd lane count: equal lanes, all dividers dashed)
  if (lanes % 2 === 1 && lanes >= 3) {
    const w = Math.min(laneW, (2 * hw - 2 * MARK.edgeInsetMin) / lanes);
    const left = -(lanes * w) / 2;
    if (shoulder || hw >= MARK.edgeMinHw) {
      lines.push({ role: 'edge', o: Math.max(left, -hw + MARK.edgeInset), dashed: false, side: -1 });
      lines.push({ role: 'edge', o: Math.min(-left, hw - MARK.edgeInset), dashed: false, side: 1 });
    }
    for (let k = 1; k < lanes; k++) lines.push({ role: k * 2 === lanes ? 'centre' : 'divider', o: left + k * w, dashed: true, side: 0 });
    return lines;
  }
  const perSide = Math.max(1, Math.floor(lanes / 2));
  const w = Math.min(laneW, (hw - MARK.edgeInsetMin) / perSide);
  if (shoulder || hw >= MARK.edgeMinHw) {
    const e = shoulder ? perSide * w : Math.min(perSide * w, hw - MARK.edgeInset);
    lines.push({ role: 'edge', o: -e, dashed: false, side: -1 });
    lines.push({ role: 'edge', o: e, dashed: false, side: 1 });
  }
  const solidCentre = road.info.lines === 2 || perSide >= 2;
  lines.push({ role: 'centre', o: 0, dashed: !solidCentre, side: 0 });
  for (let k = 1; k < perSide; k++) {
    lines.push({ role: 'divider', o: -k * w, dashed: true, side: 0 });
    lines.push({ role: 'divider', o: k * w, dashed: true, side: 0 });
  }
  return lines;
}

/** The centre line of a way as the road network draws it (resampled every ROAD.sampleSpacing and its corners rounded: road-network.js), { x, z }. */
function wayLine(road, carved) {
  const ch = carved.get(road.id);
  if (ch) return { x: Array.from(ch.x), z: Array.from(ch.z), bed: ch.bed };
  const rs = resample(road.pts, ROAD.sampleSpacing);
  const n = rs.x.length;
  if (n > 4) {
    const sx = gaussianSmooth(rs.x, ROAD.lineSmoothing / ROAD.sampleSpacing);
    const sz = gaussianSmooth(rs.z, ROAD.lineSmoothing / ROAD.sampleSpacing);
    for (let i = 1; i < n - 1; i++) { rs.x[i] = sx[i]; rs.z[i] = sz[i]; }
  }
  return { x: rs.x, z: rs.z, bed: null };
}

/**
 * The marking plan of the network.
 *   roads    the decoded roads (roads.js; road.id = the index)
 *   network  the road network (road-network.js): its carriageway chains, the carved centre lines and beds, and the segments of the carriageways (the cut)
 *   decks    the bridge decks that are drawn (decks.js, without the landmark models): a piece on a deck is laid on the deck (deckMarkingQuads), not on the terrain
 * Returns { chains, tracks, pieces, grid, stats } (see the module comment); `piecesIn(x0, z0, x1, z1)` lists the pieces that may touch a box.
 */
export function buildMarkingPlan(roads, network, decks = []) {
  const lines = new Map();
  const carved = new Map(network.chains.map((c) => [c.road, c]));
  const lineOf = (road) => {
    let l = lines.get(road.id);
    if (l === undefined) { l = wayLine(road, carved); lines.set(road.id, l); }
    return l;
  };
  const marked = roads.filter(isMarkedWay);
  const isMarked = new Uint8Array(roads.length);
  for (const r of marked) isMarked[r.id] = 1;
  const cw = network.carriageways;
  const chainWays = cw.chainWays.filter((ws) => isMarked[ws[0].road]);
  const plainNeighbours = cw.plainNeighbours;

  // ---- the chain polylines and the line tracks
  const chains = [], tracks = [];
  for (const ways of chainWays) {
    const X = [], Z = [], ARC = [], BED = [], WAY = [];     // WAY[k]: the index into `ways` of the segment k .. k + 1
    const joints = [];                                     // the arc length where each way after the first starts
    for (let w = 0; w < ways.length; w++) {
      const l = lineOf(roads[ways[w].road]);
      const n = l.x.length;
      const order = ways[w].rev ? Array.from({ length: n }, (_, i) => n - 1 - i) : Array.from({ length: n }, (_, i) => i);
      for (let q = 0; q < n; q++) {
        const i = order[q];
        if (q === 0 && X.length) {
          const gap = Math.hypot(l.x[i] - X[X.length - 1], l.z[i] - Z[Z.length - 1]);
          joints.push(ARC[ARC.length - 1] + (gap <= JOIN.dist ? 0 : gap));
          if (gap <= JOIN.dist) { WAY[WAY.length - 1] = w; continue; }        // the shared node: kept once (it starts the first segment of the new way)
        }
        const a = X.length ? ARC[ARC.length - 1] + Math.hypot(l.x[i] - X[X.length - 1], l.z[i] - Z[Z.length - 1]) : 0;
        X.push(l.x[i]); Z.push(l.z[i]); ARC.push(a); BED.push(l.bed ? l.bed[i] : NaN); WAY.push(w);
      }
    }
    const n = X.length;
    if (n < 2) continue;
    // the normals at the vertices (the mean of the two segments): the offset lines are smooth round a bend
    const NX = new Float32Array(n), NZ = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
      let dx = X[b] - X[a], dz = Z[b] - Z[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      NX[k] = -dz; NZ[k] = dx;
    }
    const chain = { id: chains.length, ways, roadIds: ways.map((w) => w.road), X: Float64Array.from(X), Z: Float64Array.from(Z), ARC: Float64Array.from(ARC), BED: Float32Array.from(BED), WAY: Int32Array.from(WAY), NX, NZ, joints, length: ARC[n - 1] };
    chains.push(chain);
    buildTracks(chain, roads, tracks);
  }

  // ---- the cut: a line inside another carriageway at its own level is not painted
  const seg = network.segments;
  const SC = 24;
  const segGrid = new Map();
  for (let i = 0; i < network.count; i++) {
    const r = seg.HW[i] + 1;
    for (let cx = Math.floor((Math.min(seg.X0[i], seg.X1[i]) - r) / SC); cx <= Math.floor((Math.max(seg.X0[i], seg.X1[i]) + r) / SC); cx++) {
      for (let cz = Math.floor((Math.min(seg.Z0[i], seg.Z1[i]) - r) / SC); cz <= Math.floor((Math.max(seg.Z0[i], seg.Z1[i]) + r) / SC); cz++) {
        const k = cx * 65536 + cz;
        const l = segGrid.get(k);
        if (l) l.push(i); else segGrid.set(k, [i]);
      }
    }
  }
  /** Is (x, z) inside the carriageway of a way that is not `own` (a Set of road ids) at the level `bed`? */
  const insideOther = (x, z, bed, own) => {
    for (const i of segGrid.get(Math.floor(x / SC) * 65536 + Math.floor(z / SC)) || []) {
      if (own.has(seg.ROADOF[i])) continue;
      const ax = seg.X0[i], az = seg.Z0[i], ex = seg.X1[i] - ax, ez = seg.Z1[i] - az;
      const ll = ex * ex + ez * ez;
      const t = ll > 1e-9 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / ll)) : 0;
      const d = Math.hypot(x - ax - ex * t, z - az - ez * t);
      if (d - seg.HW[i] > -MARK.cutInside) continue;
      if (Number.isFinite(bed) && Math.abs(seg.BED0[i] + (seg.BED1[i] - seg.BED0[i]) * t - bed) > MARK.levelApart) continue;
      return true;
    }
    return false;
  };

  const findDeck = createDeckFinder(decks);
  const pieces = [];
  let cutLength = 0, fragments = 0;
  for (const tr of tracks) {
    const ch = chains[tr.chain];
    const own = new Set(ch.roadIds);
    const ownOf = new Map();          // the way of the chain -> the roads that are its own carriageway (the chain, and the ways it meets end to end at a plain node)
    const steps = Math.max(1, Math.ceil((tr.s1 - tr.s0) / MARK.cutStep));
    const vis = new Uint8Array(steps + 1), deck = new Uint8Array(steps + 1), dashed = new Uint8Array(steps + 1);
    const p = { x: 0, z: 0, nx: 0, nz: 0, bed: 0, way: 0 };
    for (let q = 0; q <= steps; q++) {
      const s = tr.s0 + (tr.s1 - tr.s0) * (q / steps);
      trackPoint(ch, tr, s, p);
      const road = roads[ch.roadIds[p.way]];
      const over = !network.info[road.id];
      dashed[q] = dashedAt(tr, s) ? 1 : 0;
      // on a bridge the line lies on the deck (and the deck carries no other carriageway); a way that rides over the ground without a deck that is drawn (a landmark model) has none
      const onDeck = findDeck(p.x, p.z, p.nz, -p.nx, over ? NaN : p.bed);
      deck[q] = onDeck ? 1 : 0;
      if (onDeck || over) { vis[q] = onDeck ? 1 : 0; continue; }
      let ownSet = ownOf.get(p.way);
      if (!ownSet) { ownSet = new Set(own); for (const r of plainNeighbours.get(road.id) || []) ownSet.add(r); ownOf.set(p.way, ownSet); }
      vis[q] = insideOther(p.x, p.z, p.bed, ownSet) ? 0 : 1;
      if (!vis[q]) cutLength += (tr.s1 - tr.s0) / steps;
    }
    // runs of equal (visible, deck, dashed) -> pieces; a solid piece shorter than minPiece is a fragment
    let q0 = 0;
    for (let q = 1; q <= steps + 1; q++) {
      if (q <= steps && vis[q] === vis[q0] && deck[q] === deck[q0] && dashed[q] === dashed[q0]) continue;
      if (vis[q0]) {
        const ds = (tr.s1 - tr.s0) / steps;
        // the boundary between two visible runs of another kind (deck / dash style) is shared: each piece ends half way between the two samples
        const s0 = tr.s0 + q0 * ds - (q0 > 0 && vis[q0 - 1] ? ds / 2 : 0);
        const s1 = tr.s0 + (q - 1) * ds + (q <= steps && vis[q] ? ds / 2 : 0);
        if (!dashed[q0] && s1 - s0 < MARK.minPiece) fragments++;
        else if (s1 > s0) pieces.push({ track: tr.id, s0, s1, dashed: !!dashed[q0], deck: !!deck[q0] });
      }
      q0 = q;
    }
  }

  // ---- the grid of the pieces (the cells a piece passes through)
  const grid = new Map();
  const p = { x: 0, z: 0, nx: 0, nz: 0, bed: 0, way: 0 };
  pieces.forEach((pc, idx) => {
    const tr = tracks[pc.track], ch = chains[tr.chain];
    const seen = new Set();
    for (let s = pc.s0; ; s = Math.min(pc.s1, s + 4)) {
      trackPoint(ch, tr, s, p);
      const k = Math.floor(p.x / MARK.cell) * 65536 + Math.floor(p.z / MARK.cell);
      if (!seen.has(k)) { seen.add(k); const l = grid.get(k); if (l) l.push(idx); else grid.set(k, [idx]); }
      if (s >= pc.s1) break;
    }
  });
  const piecesIn = (x0, z0, x1, z1) => {
    const out = new Set();
    for (let cx = Math.floor(x0 / MARK.cell) - 1; cx <= Math.floor(x1 / MARK.cell); cx++) {
      for (let cz = Math.floor(z0 / MARK.cell) - 1; cz <= Math.floor(z1 / MARK.cell); cz++) {
        for (const i of grid.get(cx * 65536 + cz) || []) out.add(i);
      }
    }
    return [...out];
  };
  const markedLength = marked.reduce((a, r) => a + r.length, 0);
  return { chains, tracks, pieces, grid, piecesIn, plainNeighbours, findDeck, stats: { ways: marked.length, chains: chains.length, tracks: tracks.length, pieces: pieces.length, cutLength, fragments, markedLength } };
}

/** The painted spans [s0, s1] of a piece: the whole piece, or its dashes (DASH_LENGTH every DASH_PERIOD of the chain's distance along, so the rhythm runs on across a hand-over). */
export function pieceSpans(pc) {
  if (!pc.dashed) return [[pc.s0, pc.s1]];
  const spans = [];
  for (let k = Math.floor(pc.s0 / MARK.dashPeriod); k * MARK.dashPeriod < pc.s1; k++) {
    const a = Math.max(pc.s0, k * MARK.dashPeriod), b = Math.min(pc.s1, k * MARK.dashPeriod + MARK.dashLength);
    if (b - a >= MARK.minDash) spans.push([a, b]);
  }
  return spans;
}

/**
 * The deck under a line point: (x, z) with the direction of the line (dx, dz) and, for a carved way, its bed (NaN for a way over the ground).  The deck segment that holds the point
 * (inside its half width) and runs most nearly along the line wins (a bridge that crosses over the line runs across it); for a carved way the deck must lie at the way's level.
 * Returns { top } or null.
 */
function createDeckFinder(decks) {
  const CELLD = 32;
  const segs = [];
  const grid = new Map();
  for (const d of decks) {
    if (!d.pts || d.pts.length < 2) continue;
    for (let i = 0; i + 1 < d.pts.length; i++) {
      const sg = { ax: d.pts[i][0], az: d.pts[i][1], bx: d.pts[i + 1][0], bz: d.pts[i + 1][1], t0: d.tops[i], t1: d.tops[i + 1], half: d.width / 2 };
      segs.push(sg);
      const r = sg.half;
      for (let cx = Math.floor((Math.min(sg.ax, sg.bx) - r) / CELLD); cx <= Math.floor((Math.max(sg.ax, sg.bx) + r) / CELLD); cx++) {
        for (let cz = Math.floor((Math.min(sg.az, sg.bz) - r) / CELLD); cz <= Math.floor((Math.max(sg.az, sg.bz) + r) / CELLD); cz++) {
          const k = cx * 65536 + cz;
          const l = grid.get(k);
          if (l) l.push(sg); else grid.set(k, [sg]);
        }
      }
    }
  }
  const hit = { top: 0 };
  return (x, z, dx, dz, bed) => {
    let best = null, bestScore = Infinity;
    for (const sg of grid.get(Math.floor(x / CELLD) * 65536 + Math.floor(z / CELLD)) || []) {
      const ex = sg.bx - sg.ax, ez = sg.bz - sg.az, ll = ex * ex + ez * ez;
      if (ll < 1e-9) continue;
      const t = ((x - sg.ax) * ex + (z - sg.az) * ez) / ll;
      if (t < 0 || t > 1) continue;
      const side = Math.abs((x - sg.ax) * ez - (z - sg.az) * ex) / Math.sqrt(ll);
      if (side > sg.half - 0.05) continue;
      const top = sg.t0 + (sg.t1 - sg.t0) * t;
      if (Number.isFinite(bed) && Math.abs(top - bed) > MARK.deckLevel) continue;
      const cos = Math.abs(dx * ex + dz * ez) / Math.sqrt(ll);
      const score = side + 4 * (1 - cos);
      if (score < bestScore) { bestScore = score; best = top; }
    }
    if (best === null) return null;
    hit.top = best;
    return hit;
  };
}

/** The lines on the bridge decks: Float32Array of quads [ax, ay, az, bx, by, bz, nx, nz] (the centre of the line from a to b, its unit normal), laid MARK.deckLift over the deck. */
export function deckMarkingQuads(plan) {
  const out = [];
  const p = { x: 0, z: 0, nx: 0, nz: 0, bed: 0, way: 0, o: 0 }, q = { ...p };
  for (const pc of plan.pieces) {
    if (!pc.deck) continue;
    const tr = plan.tracks[pc.track], ch = plan.chains[tr.chain];
    for (const [a, b] of pieceSpans(pc)) {
      const n = Math.max(1, Math.ceil(b - a));
      trackPoint(ch, tr, a, p);
      let pa = plan.findDeck(p.x, p.z, p.nz, -p.nx, Number.isFinite(p.bed) ? p.bed : NaN);
      let ya = pa ? pa.top : NaN;
      for (let k = 1; k <= n; k++) {
        trackPoint(ch, tr, a + (b - a) * (k / n), q);
        const pb = plan.findDeck(q.x, q.z, q.nz, -q.nx, Number.isFinite(q.bed) ? q.bed : NaN);
        const yb = pb ? pb.top : NaN;
        if (Number.isFinite(ya) && Number.isFinite(yb)) out.push(p.x, ya + MARK.deckLift, p.z, q.x, yb + MARK.deckLift, q.z, (p.nx + q.nx) / 2, (p.nz + q.nz) / 2);
        p.x = q.x; p.z = q.z; p.nx = q.nx; p.nz = q.nz; ya = yb;
      }
    }
  }
  return Float32Array.from(out);
}

/** Is the track dashed at s (its dash style comes from the layout of the way it is on). */
function dashedAt(tr, s) {
  for (const r of tr.style) if (s >= r.s0 && s < r.s1) return r.dashed;
  return tr.style.length ? tr.style[tr.style.length - 1].dashed : false;
}

/** The offset of a track at s (piecewise linear between its knots). */
export function trackOffset(tr, s) {
  const S = tr.knS, O = tr.knO;
  if (s <= S[0]) return O[0];
  const n = S.length;
  if (s >= S[n - 1]) return O[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
  const t = (s - S[lo]) / Math.max(1e-9, S[hi] - S[lo]);
  return O[lo] + (O[hi] - O[lo]) * t;
}

/** The point of a chain at arc length s: position, unit normal (to the right), bed and the way (index into chain.ways), written into `out`. */
export function chainPoint(ch, s, out) {
  const A = ch.ARC, n = A.length;
  let lo = 0, hi = n - 1;
  if (s <= 0) hi = 1;
  else if (s >= A[n - 1]) lo = n - 2;
  else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (A[m] <= s) lo = m; else hi = m; }
  hi = lo + 1;
  const t = Math.min(1, Math.max(0, (s - A[lo]) / Math.max(1e-9, A[hi] - A[lo])));
  out.x = ch.X[lo] + (ch.X[hi] - ch.X[lo]) * t;
  out.z = ch.Z[lo] + (ch.Z[hi] - ch.Z[lo]) * t;
  let nx = ch.NX[lo] + (ch.NX[hi] - ch.NX[lo]) * t, nz = ch.NZ[lo] + (ch.NZ[hi] - ch.NZ[lo]) * t;
  const l = Math.hypot(nx, nz) || 1;
  out.nx = nx / l; out.nz = nz / l;
  out.bed = ch.BED[lo] + (ch.BED[hi] - ch.BED[lo]) * t;
  out.way = ch.WAY[lo];
  return out;
}

/** The point of a track at s: the chain point moved by the track's offset along the normal. */
export function trackPoint(ch, tr, s, out) {
  chainPoint(ch, s, out);
  const o = trackOffset(tr, s);
  out.x += out.nx * o; out.z += out.nz * o;
  out.o = o;
  return out;
}

/**
 * The tracks of one chain: the lines of its ways, one track per line, carried across the joints.  At a joint where the layout changes the lines of the new layout are matched to the
 * tracks of the old one (edge to edge on its side, the others by the nearest offset); a matched track moves to its new offset over a taper laid in the WIDER of the two ways (a lane is
 * added after the joint, dropped before it), a new line starts at the end of the taper, an old line without a match ends at its start.
 */
function buildTracks(chain, roads, tracks) {
  const ways = chain.ways;
  const wayStart = [0, ...chain.joints], wayEnd = [...chain.joints, chain.length];
  let active = [];
  for (let w = 0; w < ways.length; w++) {
    const road = roads[ways[w].road];
    const sign = ways[w].rev ? -1 : 1;
    const layout = laneLayout(road).map((l) => ({ ...l, o: l.o * sign, side: l.side * sign }));
    const hw = Math.max(0.8, road.width / 2);
    const J = wayStart[w];
    if (w === 0) {
      active = layout.map((l) => newTrack(chain, l, J, J));
      for (const t of active) t.hw = hw;
      continue;
    }
    const prevHw = active.length ? active[0].hw : hw;
    // match the new lines to the active tracks
    const used = new Set();
    const match = new Array(layout.length).fill(null);
    layout.forEach((l, i) => {
      if (l.role !== 'edge') return;
      const t = active.find((a) => a.role === 'edge' && a.side === l.side && !used.has(a));
      if (t) { match[i] = t; used.add(t); }
    });
    const inner = [];
    layout.forEach((l, i) => { if (l.role !== 'edge') active.forEach((a) => { if (a.role !== 'edge') inner.push({ i, a, d: Math.abs(a.o - l.o) }); }); });
    inner.sort((p, q) => p.d - q.d);
    for (const { i, a } of inner) if (!match[i] && !used.has(a)) { match[i] = a; used.add(a); }
    const shift = layout.reduce((m, l, i) => Math.max(m, match[i] ? Math.abs(match[i].o - l.o) : 0), 0);
    const widening = hw >= prevHw;
    const room = widening ? wayEnd[w] - J : J - wayStart[w - 1];
    const T = shift > 0.02 || layout.length !== active.length ? Math.min(Math.max(MARK.taperMin, shift * MARK.taperRatio), Math.max(1, room)) : 0;
    const t0 = widening ? J : Math.max(J - T, active.reduce((m, a) => Math.max(m, a.knS[a.knS.length - 1]), wayStart[w - 1]));
    const t1 = widening ? J + T : J;
    const next = [];
    layout.forEach((l, i) => {
      const t = match[i];
      if (t) {
        if (Math.abs(t.o - l.o) > 1e-3) { pushKnot(t, t0, t.o); pushKnot(t, t1, l.o); }
        t.o = l.o; t.hw = hw;
        if (t.dashed !== l.dashed) { t.style[t.style.length - 1].s1 = J; t.style.push({ s0: J, s1: Infinity, dashed: l.dashed }); t.dashed = l.dashed; }
        next.push(t);
      } else {
        const nt = newTrack(chain, l, t1, t1);
        nt.hw = hw;
        next.push(nt);
      }
    });
    for (const a of active) if (!used.has(a)) closeTrack(a, t0, tracks);
    active = next;
  }
  for (const a of active) closeTrack(a, chain.length, tracks);
}

function newTrack(chain, line, s0) {
  return { chain: chain.id, role: line.role, side: line.side, o: line.o, dashed: line.dashed, knS: [s0], knO: [line.o], s0, s1: s0, style: [{ s0, s1: Infinity, dashed: line.dashed }] };
}
function pushKnot(t, s, o) {
  const n = t.knS.length;
  if (s <= t.knS[n - 1] + 1e-6) { t.knO[n - 1] = o; return; }
  t.knS.push(s); t.knO.push(o);
}
function closeTrack(t, s1, tracks) {
  t.s1 = s1;
  if (t.s1 - t.s0 < 0.5) return;
  pushKnot(t, s1, t.knO[t.knO.length - 1]);
  t.knS = Float64Array.from(t.knS); t.knO = Float32Array.from(t.knO);
  t.id = tracks.length;
  tracks.push(t);
}
