/* Gate M of the harness: the lane markings (markings.js) and the edges of the paint (tile-mesh.js carriagewayChannels).
 *   M1  the lines run on across the hand-over of two ways of one carriageway: no lateral jump, no gap longer than one dash cycle
 *   M2  the lanes of a one-way carriageway are divided by DASHED lines (solid only for the edge lines); a single lane has no centre line
 *   M3  no stray fragments (a solid piece shorter than 3 m) and, around the biggest junctions, no painted line inside another carriageway at its own level
 *   M4  the ribbons the GPU draws lie where the plan puts them, and a painted line does not wobble (lateral deviation from its own 7 m mean, cm) on the ten roads of the QA markings study
 *   M5  the edge of the tarmac along a median is straight: the zero of the painted distance (as the shader interpolates it per triangle) along the dual carriageways of the study
 * Pure (Node): `runMarkingChecks({ ... })` records its checks with `check` and its numbers in `stats.markings`. */
import { buildMarkingPlan, trackPoint, chainPoint, pieceSpans, MARK } from './markings.js';
import { computeTileNodes, buildTileMesh, CHANNEL_STRIDE } from './tile-mesh.js';
import { diagonalIsMain } from './surface.js';
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
const JOINT_CLEAR = 12;          // m: the median edge is not measured this close to a hand-over (the width of the carriageway may change there)
const MEDIAN_MAX_CM = 6;          // the edge of the tarmac along a median may deviate this much from its 10 m running mean (v45: a sawtooth of 30 - 50 cm)

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

/** A value of a per-vertex attribute of a built tile mesh at a world point, interpolated over the triangle exactly as the GPU does (the diagonal rule of the lattice). */
export function meshAttrAt(mesh, arr, stride, c, x, z) {
  const cells = QUADTREE.cells, side = cells + 1;
  const lx = (x - mesh.x0) / mesh.step, lz = (z - mesh.z0) / mesh.step;
  const i = Math.min(cells - 1, Math.max(0, Math.floor(lx))), j = Math.min(cells - 1, Math.max(0, Math.floor(lz)));
  const fx = lx - i, fz = lz - j;
  const a = j * side + i, b = a + 1, cc = a + side, d = cc + 1;
  const va = arr[a * stride + c], vb = arr[b * stride + c], vc = arr[cc * stride + c], vd = arr[d * stride + c];
  const gi = Math.round(mesh.x0 / mesh.step) + i, gj = Math.round(mesh.z0 / mesh.step) + j;
  if (diagonalIsMain(gi, gj)) return fx >= fz ? va + (vb - va) * fx + (vd - vb) * fz : va + (vd - vc) * fx + (vc - va) * fz;
  return fx + fz <= 1 ? va + (vb - va) * fx + (vc - va) * fz : vd + (vc - vd) * (1 - fx) + (vb - vd) * (1 - fz);
}

/** The signed distance to the carriageways as the shader paints it (ground-shader.js: the two channels where they hold, else the blurred union); `channels` false: v45 (the union only). */
export function paintedSd(mesh, x, z, channels = true) {
  const union = meshAttrAt(mesh, mesh.road3, 4, 0, x, z);
  if (!channels) return union;
  const w = Math.min(1, Math.max(0, meshAttrAt(mesh, mesh.road4, 4, 3, x, z)));
  return union * (1 - w) + Math.min(meshAttrAt(mesh, mesh.road4, 4, 0, x, z), meshAttrAt(mesh, mesh.road4, 4, 1, x, z), meshAttrAt(mesh, mesh.road4, 4, 2, x, z)) * w;
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
  for (const r of STUDY_ROADS.slice(0, quick ? 3 : STUDY_ROADS.length)) {
    const meshes = new Map();
    const meshAt = (x, z) => {
      const x0 = Math.floor(x / QUADTREE.minSize) * QUADTREE.minSize, z0 = Math.floor(z / QUADTREE.minSize) * QUADTREE.minSize;
      const k = `${x0}:${z0}`;
      let m = meshes.get(k);
      if (!m) {
        const sel = selectTiles(x0 + QUADTREE.minSize / 2, z0 + QUADTREE.minSize / 2, {});
        const leaf = leafAt(sel.split, x0 + QUADTREE.minSize / 2, z0 + QUADTREE.minSize / 2);
        m = buildTileMesh(leaf, computeTileNodes(leaf, surface, field), sel.split, field, plan);
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
              const sd = paintedSd(meshAt(x, z), x, z, chOn);
              if (prev !== null && zero === null && prev < 0 && sd >= 0) zero = u - MEDIAN_SCAN * sd / Math.max(1e-6, sd - prev);
              if (zero !== null && sd < 0) { again = true; break; }
              prev = sd;
            }
            found[kk] = zero !== null && again ? zero : null;
          }
          edge.push(found[0]); edgeOld.push(found[1]);
        }
        const dev = (arr) => {
          let worst = 0, n = 0, at = -1;
          const W = Math.round(10 / MEDIAN_SAMPLE / 2);
          for (let k = W; k < arr.length - W; k++) {
            const win = arr.slice(k - W, k + W + 1);
            if (win.some((v) => v === null)) continue;
            n++;
            const d = Math.abs(arr[k] - win.reduce((a, v) => a + v, 0) / win.length) * 100;
            if (d > worst) { worst = d; at = k; }
          }
          return { worst, n, at };
        };
        const a = dev(edge), b = dev(edgeOld);
        medianN += a.n;
        if (a.worst > worstMedian) { worstMedian = a.worst; chainPoint(ch, a.at * MEDIAN_SAMPLE, p); medianAt = `${r.name} ${p.x.toFixed(0)},${p.z.toFixed(0)} (chain ${cid} s ${(a.at * MEDIAN_SAMPLE).toFixed(1)} side ${side})`; }
        worstMedianOld = Math.max(worstMedianOld, b.worst);
      }
    }
  }
  wobbles.sort((a, b) => a - b);
  out.ribbons = { quads: ribbons, worstPlaceCm: +Math.max(0, worstPlace).toFixed(2) };
  out.wobble = { samples: wobbleN, p99Cm: wobbleN ? +wobbles[Math.floor(wobbleN * 0.99)].toFixed(2) : 0, worstCm: +worstWobble.toFixed(2), at: worstWobbleAt };
  out.median = { samples: medianN, worstCm: +worstMedian.toFixed(1), worstCmUnionOnly: +worstMedianOld.toFixed(1), at: medianAt };
  stats.markings = out;
  check('markings: the GPU ribbons lie on the planned lines (study roads)', ribbons > 0 && worstPlace <= PLACE_MAX_CM, `${ribbons} quads, worst ${Math.max(0, worstPlace).toFixed(2)} cm`);
  check(`markings: the painted lines of the ten study roads do not wobble (deviation from their own ${WOBBLE_WINDOW} m mean <= ${WOBBLE_MAX_CM} cm, tapers aside)`, wobbleN > 100 && worstWobble <= WOBBLE_MAX_CM, `${wobbleN} samples, p99 ${out.wobble.p99Cm} cm, worst ${worstWobble.toFixed(2)} cm at ${worstWobbleAt}`);
  check(`markings: the edge of the tarmac along a median is straight (deviation from its 10 m mean <= ${MEDIAN_MAX_CM} cm)`, medianN > 50 && worstMedian <= MEDIAN_MAX_CM, `${medianN} samples, worst ${worstMedian.toFixed(1)} cm at ${medianAt} (the union field alone, v45: ${worstMedianOld.toFixed(1)} cm)`);
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
