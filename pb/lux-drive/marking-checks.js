/* Gate M of the harness: the lane markings (markings.js) and the edges of the paint (tile-mesh.js carriagewayChannels).
 *   M1  the lines run on across the hand-over of two ways of one carriageway: no lateral jump, no gap longer than one dash cycle
 *   M2  the lanes of a one-way carriageway are divided by DASHED lines (solid only for the edge lines); a single lane has no centre line
 *   M3  no stray fragments (a solid piece shorter than 3 m) and, around the biggest junctions, no painted line inside another carriageway at its own level
 *   M4  the ribbons the GPU draws lie where the plan puts them, and a painted line does not wobble (lateral deviation from its own 7 m mean, cm) on the ten roads of the QA markings study
 *   M5  the edge of the tarmac along a median is straight: the zero of the painted distance (as the shader interpolates it per triangle) along the dual carriageways of the study
 * Pure (Node): `runMarkingChecks({ ... })` records its checks with `check` and its numbers in `stats.markings`. */
import { buildMarkingPlan, trackPoint, chainPoint, pieceSpans, MARK } from './markings.js';
import { computeTileNodes, buildTileMesh } from './tile-mesh.js';
import { meshAttrAt, paintedSd, paintAt } from './paint-model.js';
import { QUADTREE } from './config.js';
import { junctionClusters } from './junction-probe.js';
import { leafAt, selectTiles } from './quadtree.js';

const STRAY_PIECE = 3.0;          // m: a solid piece of line shorter than this is a stray fragment
const WOBBLE_WINDOW = 7;          // samples of 1 m: the running mean a line's offset is compared with
const TAPER_CLEAR = 2;            // m: the wobble is not measured this close to a knot of the track's offset (a taper starts or ends there: a kink by design)
const WOBBLE_MAX_CM = 1.0;        // the painted lines of the study roads may deviate this much from their own running mean
const PLACE_MAX_CM = 1.0;         // the GPU ribbons may lie this far from the planned line
const MEDIAN_SAMPLE = 0.5;        // m along the dual carriageway between the samples of the median edge
const MEDIAN_SCAN = 0.02;         // m across
const FALSE_KERB_UNION = 0.6;    // m: a point counts as tarmac when the union paints it this far inside an edge; the channels must paint it as tarmac too
const JOINT_CLEAR = 12;          // m: the median edge is not measured this close to a hand-over (the width of the carriageway may change there)
const MEDIAN_P95_CM = 8;          // the edge of the tarmac along a median may deviate this much from its 10 m running mean (95 % of the samples; v45: a sawtooth of 30 - 50 cm) ...
const MEDIAN_MAX_CM = 20;         // ... and at worst this much (where four carriageways meet the paint falls back to the blurred union over a few metres)

/** The ten roads of the QA markings study (qa1/marks_roads.json): a point on the road and its direction (deg, 0 = +x). */
export const STUDY_ROADS = Object.freeze([
  { name: 'A1 (Autoroute de Trèves)', x: 13247, z: 5936, yaw: -179.3 },
  { name: 'Av. J.F. Kennedy', x: 6696, z: 7607, yaw: -28.8 },
  { name: 'Rocade de Bonnevoie', x: 5283, z: 10512, yaw: 92.7 },
  { name: "Route d'Arlon", x: 2982, z: 8253, yaw: 12.7 },
  { name: "Route d'Esch", x: 4065, z: 11551, yaw: 130.6 },
  { name: 'Bd Royal', x: 4791, z: 8540, yaw: 162.5 },
  { name: 'Route de Trèves', x: 12604, z: 5032, yaw: 90.6 },
  { name: 'N1 Rue de Trèves', x: 10192, z: 7018, yaw: -37.8 },
  { name: "Côte d'Eich", x: 5080, z: 7588, yaw: 91.1 },
  { name: 'Rue de Neudorf', x: 7363, z: 7672, yaw: -20.6 },
]);
const STUDY_RADIUS = 40;          // m round each study point

// (the GPU interpolation and the shader's paint rules live in paint-model.js since paint15; re-exported for the callers of this module)
export { meshAttrAt, paintedSd };

/** The blurred UNION fields of the lattice per grid vertex (the paint of v45: the distance to the union of the carriageways and to that of the streets), laid out like a mesh
 *  attribute of stride 2 - the reference the channels are measured against (the mesh itself carries the channels and the rest since paint15). */
function unionAttr(nodes) {
  const cells = QUADTREE.cells, side = cells + 1, apron = cells + 3;
  const out = new Float32Array(side * side * 2);
  for (let j = 0; j <= cells; j++) for (let i = 0; i <= cells; i++) { const a = (j + 1) * apron + i + 1, v = j * side + i; out[v * 2] = nodes.sdCar[a]; out[v * 2 + 1] = nodes.sdMajor[a]; }
  return out;
}

export function runMarkingChecks({ data, net, surface, field, decks, check, stats, quick = false }) {
  const t0 = Date.now();
  const plan = buildMarkingPlan(data.roads, net, decks);
  const roads = data.roads;
  const out = { ...plan.stats, buildMs: Date.now() - t0 };
  const p = { x: 0, z: 0, nx: 0, nz: 0, bed: 0, way: 0, o: 0 };
  const piecesOf = new Map();
  plan.pieces.forEach((pc) => { const l = piecesOf.get(pc.track); if (l) l.push(pc); else piecesOf.set(pc.track, [pc]); });

  // ---- M1: the hand-overs of one carriageway (a node where only the two ways meet, both on the ground)
  let joints = 0, badJump = 0, badGap = 0;
  const badList = [];
  for (const tr of plan.tracks) {
    const ch = plan.chains[tr.chain];
    ch.joints.forEach((J, w) => {
      if (J < tr.s0 + MARK.dashPeriod || J > tr.s1 - MARK.dashPeriod) return;
      const ra = ch.roadIds[w], rb = ch.roadIds[w + 1];
      if (!net.info[ra] || !net.info[rb]) return;                           // (a bridge end: the deck takes the line)
      if (!(plan.plainNeighbours.get(ra) || new Set()).has(rb)) return;     // (another way meets there: a junction may cut the line)
      joints++;
      const jump = Math.abs(trackOffsetAround(tr, J, -1e-3) - trackOffsetAround(tr, J, 1e-3));
      if (jump > 0.01) badJump++;
      // the painted cover of [J - period, J + period] (the pieces: the dashes are laid inside them)
      const lo = J - MARK.dashPeriod, hi = J + MARK.dashPeriod;
      const cover = (piecesOf.get(tr.id) || []).map((pc) => [Math.max(lo, pc.s0), Math.min(hi, pc.s1)]).filter(([a, b]) => b > a).sort((u, v) => u[0] - v[0]);
      // (a stretch cut because another carriageway lies over the line - a slip road that merges at the hand-over - is a junction, not a broken line: it counts as covered)
      for (const [a, b] of tr.cuts) if (b > lo && a < hi) cover.push([Math.max(lo, a), Math.min(hi, b)]);
      cover.sort((u, v) => u[0] - v[0]);
      let gap = 0, at = lo;
      for (const [a, b] of cover) { gap = Math.max(gap, a - at); at = Math.max(at, b); }
      gap = Math.max(gap, hi - at);
      if (gap > MARK.dashPeriod) { badGap++; if (badList.length < 5) { chainPoint(ch, J, p); badList.push(`${Math.round(p.x)},${Math.round(p.z)} ${tr.role} gap ${gap.toFixed(1)}`); } }
    });
  }
  out.handovers = { joints, badJump, badGap };
  check('markings: the lines run on across every plain hand-over of two ways of one carriageway (no lateral jump > 1 cm, no gap > one dash cycle)', badJump + badGap, `${joints} line hand-overs, ${badJump} jumps, ${badGap} gaps ${badList.join('; ')}`);

  // ---- M2: one-way carriageways
  let solidInside = 0, centreOnOneLane = 0;
  for (const pc of plan.pieces) {
    const tr = plan.tracks[pc.track], ch = plan.chains[tr.chain];
    trackPoint(ch, tr, (pc.s0 + pc.s1) / 2, p);
    const road = roads[ch.roadIds[p.way]];
    if (!road.oneway || tr.role === 'edge') continue;
    if (!pc.dashed) solidInside++;
    if ((road.lanes || 1) < 2) centreOnOneLane++;
  }
  out.oneWay = { solidInside, centreOnOneLane };
  check('markings: no solid line between the lanes of a one-way carriageway, no centre line on a single lane (solid only for the edge lines)', solidInside + centreOnOneLane, `${solidInside} solid dividers, ${centreOnOneLane} lines inside a single lane`);

  // ---- M3: strays and junctions
  let strays = 0;
  for (const pc of plan.pieces) if (!pc.dashed && pc.s1 - pc.s0 < STRAY_PIECE) strays++;
  const km = out.markedLength / 1000;
  out.straysPerKm = +(strays / km).toFixed(3);
  check(`markings: no stray fragments (solid pieces shorter than ${STRAY_PIECE} m) - at most 0.1 per km of marked road`, strays / km <= 0.1, `${strays} on ${km.toFixed(0)} km (${(strays / km).toFixed(3)} per km); dropped as fragments when planned: ${out.fragments}`);
  const seg = net.segments;
  const SG = 32, segGrid = new Map();
  for (let i = 0; i < net.count; i++) {
    const r = seg.HW[i] + 1;
    for (let cx = Math.floor((Math.min(seg.X0[i], seg.X1[i]) - r) / SG); cx <= Math.floor((Math.max(seg.X0[i], seg.X1[i]) + r) / SG); cx++) {
      for (let cz = Math.floor((Math.min(seg.Z0[i], seg.Z1[i]) - r) / SG); cz <= Math.floor((Math.max(seg.Z0[i], seg.Z1[i]) + r) / SG); cz++) {
        const k = cx * 65536 + cz; const l = segGrid.get(k); if (l) l.push(i); else segGrid.set(k, [i]);
      }
    }
  }
  const clusters = junctionClusters(net).slice(0, quick ? 8 : 20);
  let inOther = 0, probed = 0;
  const inList = [];
  for (const c of clusters) {
    for (const idx of plan.piecesIn(c.x - 40, c.z - 40, c.x + 40, c.z + 40)) {
      const pc = plan.pieces[idx];
      if (pc.deck) continue;
      const tr = plan.tracks[pc.track], ch = plan.chains[tr.chain];
      const own = new Set(ch.roadIds);
      for (const [a, b] of pieceSpans(pc)) {
        for (let s = a; s <= b; s += 0.5) {
          trackPoint(ch, tr, s, p);
          if (Math.hypot(p.x - c.x, p.z - c.z) > 40) continue;
          probed++;
          const ownHere = new Set([...own, ...(plan.plainNeighbours.get(ch.roadIds[p.way]) || [])]);
          for (const i of segGrid.get(Math.floor(p.x / SG) * 65536 + Math.floor(p.z / SG)) || []) {
            if (ownHere.has(seg.ROADOF[i])) continue;
            const ax = seg.X0[i], az = seg.Z0[i], ex = seg.X1[i] - ax, ez = seg.Z1[i] - az, ll = ex * ex + ez * ez;
            const t = ll > 1e-9 ? Math.min(1, Math.max(0, ((p.x - ax) * ex + (p.z - az) * ez) / ll)) : 0;
            if (Math.hypot(p.x - ax - ex * t, p.z - az - ez * t) - seg.HW[i] > -0.25) continue;
            if (Number.isFinite(p.bed) && Math.abs(seg.BED0[i] + (seg.BED1[i] - seg.BED0[i]) * t - p.bed) > MARK.levelApart) continue;
            inOther++;
            if (inList.length < 4) inList.push(`${p.x.toFixed(0)},${p.z.toFixed(0)}`);
            break;
          }
        }
      }
    }
  }
  out.junctions = { clusters: clusters.length, probed, inOther };
  check('markings: no painted line inside another carriageway at its own level around the biggest junctions (no scribbles across a junction box or a slip road)', inOther, `${inOther} of ${probed} painted points, e.g. ${inList.join('; ')}`);

  // ---- M4 / M5: the GPU arrays of the tiles round the study roads
  let ribbons = 0, worstPlace = 0, wobbleN = 0, worstWobble = 0, worstWobbleAt = '';
  const wobbles = [];
  let medianN = 0, worstMedian = 0, worstMedianOld = 0, medianAt = '';
  let insideN = 0, insideBad = 0, insideSkip = 0;
  const medianDevs = [], medianDevsOld = [];
  const insideList = [];
  for (const r of STUDY_ROADS.slice(0, quick ? 3 : STUDY_ROADS.length)) {
    const meshes = new Map();
    const meshAt = (x, z) => {
      const x0 = Math.floor(x / QUADTREE.minSize) * QUADTREE.minSize, z0 = Math.floor(z / QUADTREE.minSize) * QUADTREE.minSize;
      const k = `${x0}:${z0}`;
      let m = meshes.get(k);
      if (!m) {
        const sel = selectTiles(x0 + QUADTREE.minSize / 2, z0 + QUADTREE.minSize / 2, {});
        const leaf = leafAt(sel.split, x0 + QUADTREE.minSize / 2, z0 + QUADTREE.minSize / 2);
        const nodes = computeTileNodes(leaf, surface, field);
        m = { ...buildTileMesh(leaf, nodes, sel.split, field, plan), union: unionAttr(nodes) };
        meshes.set(k, m);
      }
      return m;
    };
    // M4: every ribbon quad of these tiles against the plan (its nearest track point), and each track's offset against its own running mean
    const near = new Set(plan.piecesIn(r.x - STUDY_RADIUS, r.z - STUDY_RADIUS, r.x + STUDY_RADIUS, r.z + STUDY_RADIUS).map((i) => plan.pieces[i].track));
    for (const tid of near) {
      const tr = plan.tracks[tid], ch = plan.chains[tr.chain];
      const offs = [];
      for (const pc of piecesOf.get(tid) || []) {
        if (pc.deck) continue;
        for (const [a, b] of pieceSpans(pc)) {
          for (let s = Math.ceil(a); s <= b; s += 1) {
            trackPoint(ch, tr, s, p);
            if (Math.hypot(p.x - r.x, p.z - r.z) > STUDY_RADIUS) continue;
            const knotNear = Array.from(tr.knS).some((k) => Math.abs(k - s) < TAPER_CLEAR + WOBBLE_WINDOW);
            // the offset of the line point from the chain's centre line (as drawn: the ribbon's own geometry is the track point, see below)
            const c = chainPoint(ch, s, { x: 0, z: 0, nx: 0, nz: 0 });
            offs.push({ s, o: (p.x - c.x) * c.nx + (p.z - c.z) * c.nz, skip: knotNear, x: p.x, z: p.z });
          }
        }
      }
      for (let k = 0; k < offs.length; k++) {
        const win = offs.slice(Math.max(0, k - 3), k + 4);
        if (offs[k].skip || win.length < WOBBLE_WINDOW || win[win.length - 1].s - win[0].s > WOBBLE_WINDOW) continue;
        const dev = Math.abs(offs[k].o - win.reduce((a, q) => a + q.o, 0) / win.length) * 100;
        wobbles.push(dev); wobbleN++;
        if (dev > worstWobble) { worstWobble = dev; worstWobbleAt = `${offs[k].x.toFixed(0)},${offs[k].z.toFixed(0)}`; }
      }
    }
    for (let dx = -STUDY_RADIUS; dx <= STUDY_RADIUS; dx += QUADTREE.minSize) {
      for (let dz = -STUDY_RADIUS; dz <= STUDY_RADIUS; dz += QUADTREE.minSize) {
        const m = meshAt(r.x + dx, r.z + dz);
        if (!m.markQuads) continue;
        const v0 = m.vertexCount - m.markQuads * 4;
        for (let q = 0; q < m.markQuads; q++) {
          ribbons++;
          const v = v0 + q * 4;
          const x = m.positions[v * 3] + m.x0, z = m.positions[v * 3 + 2] + m.z0;
          // the nearest planned line point (the pieces of this tile)
          let best = Infinity;
          for (const idx of plan.piecesIn(x - 2, z - 2, x + 2, z + 2)) {
            const pc = plan.pieces[idx], tr = plan.tracks[pc.track], ch = plan.chains[tr.chain];
            for (let s = pc.s0; s <= pc.s1; s += 0.25) { trackPoint(ch, tr, s, p); best = Math.min(best, Math.hypot(p.x - x, p.z - z)); }
          }
          worstPlace = Math.max(worstPlace, best === Infinity ? 99 : best * 100 - 12.5);   // (a quad corner may lie up to a quarter step from a 0.25 m sample along the line)
        }
      }
    }
    // M5: the median edge: along the chains near the study point, scan from the inner edge of the carriageway outward for the zero of the painted distance; where another carriageway
    // follows within MEDIAN_WIDTH (a median), the position of that zero along the road
    const chainsNear = new Set([...near].map((t) => plan.tracks[t].chain));
    for (const cid of chainsNear) {
      const ch = plan.chains[cid];
      for (const side of [-1, 1]) {
        const edge = [], edgeOld = [];
        for (let s = 0; s <= ch.length; s += MEDIAN_SAMPLE) {
          chainPoint(ch, s, p);
          if (Math.hypot(p.x - r.x, p.z - r.z) > STUDY_RADIUS - 4) { edge.push(null); edgeOld.push(null); continue; }
          const road = roads[ch.roadIds[p.way]];
          if (!net.info[road.id]) { edge.push(null); edgeOld.push(null); continue; }
          const hw = Math.max(0.8, road.width / 2);
          // (near a hand-over the carriageway changes its width - a step of the tarmac by design, rounded by the two caps - so the edge is measured away from the joints)
          if (ch.joints.some((J) => Math.abs(J - s) < JOINT_CLEAR)) { edge.push(null); edgeOld.push(null); continue; }
          const found = [null, null];
          for (const [kk, chOn] of [[0, true], [1, false]]) {
            let prev = null, zero = null, again = false;
            for (let u = hw - 0.6; u <= hw + 3.2; u += MEDIAN_SCAN) {
              const x = p.x + p.nx * u * side, z = p.z + p.nz * u * side;
              const mm = meshAt(x, z);
              const sd = chOn ? paintedSd(mm, x, z) : meshAttrAt(mm, mm.union, 2, 0, x, z);
              if (prev !== null && zero === null && prev < 0 && sd >= 0) zero = u - MEDIAN_SCAN * sd / Math.max(1e-6, sd - prev);
              if (zero !== null && sd < 0) { again = true; break; }
              prev = sd;
            }
            found[kk] = zero !== null && again ? zero : null;
          }
          edge.push(found[0]); edgeOld.push(found[1]);
        }
        const dev = (arr, all = null) => {
          let worst = 0, n = 0, at = -1;
          const W = Math.round(10 / MEDIAN_SAMPLE / 2);
          for (let k = W; k < arr.length - W; k++) {
            const win = arr.slice(k - W, k + W + 1);
            if (win.some((v) => v === null)) continue;
            n++;
            const d = Math.abs(arr[k] - win.reduce((a, v) => a + v, 0) / win.length) * 100;
            if (all) all.push(d);
            if (d > worst) { worst = d; at = k; }
          }
          return { worst, n, at };
        };
        // (and no false kerb INSIDE the carriageway: every point 1 m and more inside its edges is painted as tarmac)
        if (side === 1) {
          for (let s = 0; s <= ch.length; s += 1) {
            chainPoint(ch, s, p);
            if (Math.hypot(p.x - r.x, p.z - r.z) > STUDY_RADIUS - 4 || ch.joints.some((J) => Math.abs(J - s) < JOINT_CLEAR)) continue;
            const road = roads[ch.roadIds[p.way]];
            if (!net.info[road.id]) continue;
            const hw = Math.max(0.8, road.width / 2);
            for (let u = -hw + 1; u <= hw - 1; u += 0.25) {
              const x = p.x + p.nx * u, z = p.z + p.nz * u;
              insideN++;
              const m = meshAt(x, z), unionOnly = meshAttrAt(m, m.union, 2, 0, x, z);
              if (unionOnly > -FALSE_KERB_UNION) { insideSkip++; continue; }          // (the union does not call it tarmac either: the way lies off its level there, see road-network.js PAINT_LEVEL_PUSH)
              // (the pale tar of a service way must not show inside a street either: the distance to the street carriageways, as the shader takes it)
              const pa = paintAt(m, x, z);
              const sdMaj = Math.min(pa.chS, meshAttrAt(m, m.road3, 4, 3, x, z));        // (the channels' streets and the rest's)
              if (paintedSd(m, x, z) > 0 || (meshAttrAt(m, m.union, 2, 1, x, z) < -FALSE_KERB_UNION && sdMaj > 0)) { insideBad++; if (insideList.length < 4) insideList.push(`${x.toFixed(1)},${z.toFixed(1)}`); }
            }
          }
        }
        const a = dev(edge, medianDevs), b = dev(edgeOld, medianDevsOld);
        medianN += a.n;
        if (a.worst > worstMedian) { worstMedian = a.worst; chainPoint(ch, a.at * MEDIAN_SAMPLE, p); medianAt = `${r.name} ${p.x.toFixed(0)},${p.z.toFixed(0)} (chain ${cid} s ${(a.at * MEDIAN_SAMPLE).toFixed(1)} side ${side})`; }
        worstMedianOld = Math.max(worstMedianOld, b.worst);
      }
    }
  }
  wobbles.sort((a, b) => a - b);
  out.ribbons = { quads: ribbons, worstPlaceCm: +Math.max(0, worstPlace).toFixed(2) };
  out.wobble = { samples: wobbleN, p99Cm: wobbleN ? +wobbles[Math.floor(wobbleN * 0.99)].toFixed(2) : 0, worstCm: +worstWobble.toFixed(2), at: worstWobbleAt };
  out.inside = { samples: insideN, falseEdges: insideBad, offLevel: insideSkip };
  const pct = (arr, q) => { const a = arr.slice().sort((u, v) => u - v); return a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * q))].toFixed(1) : 0; };
  out.median = { samples: medianN, p95Cm: pct(medianDevs, 0.95), worstCm: +worstMedian.toFixed(1), p95CmUnionOnly: pct(medianDevsOld, 0.95), worstCmUnionOnly: +worstMedianOld.toFixed(1), at: medianAt };
  stats.markings = out;
  check('markings: the GPU ribbons lie on the planned lines (study roads)', ribbons > 0 && worstPlace <= PLACE_MAX_CM, `${ribbons} quads, worst ${Math.max(0, worstPlace).toFixed(2)} cm`);
  check(`markings: the painted lines of the ten study roads do not wobble (deviation from their own ${WOBBLE_WINDOW} m mean <= ${WOBBLE_MAX_CM} cm, tapers aside)`, wobbleN > 100 && worstWobble <= WOBBLE_MAX_CM, `${wobbleN} samples, p99 ${out.wobble.p99Cm} cm, worst ${worstWobble.toFixed(2)} cm at ${worstWobbleAt}`);
  check('paint: no false kerb inside a carriageway (every point 1 m inside its edges that the union paints as tarmac stays tarmac, study roads)', insideN > 1000 && insideBad === 0, `${insideBad} of ${insideN} points (${insideSkip} not tarmac in the union either: off its level), e.g. ${insideList.join('; ')}`);
  check(`paint: the edge of the tarmac along a median is straight (deviation from its 10 m mean: p95 <= ${MEDIAN_P95_CM} cm, worst <= ${MEDIAN_MAX_CM} cm)`, medianN > 50 && out.median.p95Cm <= MEDIAN_P95_CM && worstMedian <= MEDIAN_MAX_CM,
    `${medianN} samples, p95 ${out.median.p95Cm} cm, worst ${worstMedian.toFixed(1)} cm at ${medianAt} (the union field alone, v45: p95 ${out.median.p95CmUnionOnly} cm, worst ${worstMedianOld.toFixed(1)} cm)`);
  return out;
}

/** The offset of a track just before (dir -1) / after (dir +1) s. */
function trackOffsetAround(tr, s, eps) {
  const S = tr.knS, O = tr.knO;
  const q = s + eps;
  if (q <= S[0]) return O[0];
  for (let k = 1; k < S.length; k++) if (q <= S[k]) return O[k - 1] + (O[k] - O[k - 1]) * (q - S[k - 1]) / Math.max(1e-9, S[k] - S[k - 1]);
  return O[O.length - 1];
}
