/* Lux Drive harness, section W (paint15): the edges of the ground paint.
 *   W1  every edge of the paint is straight - no staircase of the 1 m lattice: the tarmac, the kerb, the pavement, and the boundaries between two materials or two tones of
 *       tarmac, traced from the very arrays the GPU interpolates with the shader's own rules (paint-model.js, paint-edges.js), over Ian's Avenue Victor Hugo, the QA4 N4-T03
 *       poses, the fourteen junctions of the QA top views, the first 150 m of JFK, the Rond-Point Schuman and random places along the roads
 *   W2  no blobs in the junction boxes: the tone of the tarmac (the dark street, the pale tar of a minor way) changes only on the edge of a street (the carve's own, exact at
 *       the point) and crisply (no soft band of half tones)
 *   W3  Avenue Victor Hugo (Ian, 6 Nov): the paved stone of Place Auguste Laurent meets the avenue on the avenue's edge, a straight line, with a kerb between them
 *   W4  the painted edge of the tarmac lies on the carve's edge (the exact signed distance at the points of the painted edge)
 * Called by harness.js; everything it needs is passed in.  Pure Node. */
import { computeTileNodes, buildTileMesh } from './tile-mesh.js';
import { leafAt, selectTiles } from './quadtree.js';
import { varyingsAt, paintOf } from './paint-model.js';
import { traceEdges, edgeStats, EDGE } from './paint-edges.js';
import { CHANNELS, PAINT_CODE } from './road-network.js';
import { createRng } from './noise.js';
import { QUADTREE } from './config.js';

/** The places of W1 / W2: [name, x, z, half size (m)]. */
const NAMED = [
  ['Av. Victor Hugo (Ian)', 4505, 7785, 20],
  // QA4 N4-T03: the wide pale aprons (sweep poses)
  ['s001 Niederanven', 13977, 3981, 20], ['s004 Niederanven', 14307, 4025, 20], ['s007 Niederanven', 14517, 4254, 20], ['s015 Senningen', 13105, 4882, 20],
  ['s022 Hostert', 12580, 3362, 20], ['s026 Rameldange', 12342, 2812, 20], ['s043 Ernster', 13712, 1172, 20], ['s060 Pulvermuhle', 6341, 9023, 20],
  ['s068 Pfaffenthal', 5747, 8519, 20], ['s075 Bonnevoie', 6129, 10481, 20], ['s076 Bonnevoie', 5865, 10569, 20], ['s078 Bonnevoie', 6076, 10225, 20],
  ['s116 Dommeldange', 5255, 5988, 20], ['s133 Grunewald', 8295, 6607, 20], ['s135 Neudorf', 6762, 7860, 20], ['s147 Limpertsberg', 4447, 7708, 20], ['s148 Limpertsberg', 4389, 7877, 20],
  ['JFK first 150 m', 6040, 7875, 40], ['Rond-Point Schuman', 4915, 8117, 40],
];
/** The junctions of the QA top views (qa4/jobs/top.json q01 - q14). */
const JUNCTIONS = [
  ['q01 Rummplateau', 5682, 9033], ['q02 Nei Escher Strooss', 4200, 10050], ['q03 Circuit de la Foire', 8010, 5868], ['q04 Bd de Kockelscheuer', 3576, 12651],
  ['q05 Route de Bettembourg', 3465, 14256], ['q06 Bd de Kockelscheuer', 4536, 11907], ['q07 Siwemuergen', 4125, 6345], ['q08 Rue Leandre Lacroix', 3843, 7650],
  ['q09 Bd Konrad Adenauer', 5664, 7944], ['q10 Rue Arthur Herchen', 3753, 9030], ['q11 Avenue Guillaume', 3966, 9225], ['q12 Bd Pierre Dupong', 3555, 9234],
  ['q13 Rue des Aubepines', 2733, 9438], ['q14 Rue Irmine', 5778, 10200],
];
const JUNCTION_HALF = 20;                 // m
const RANDOM_PLACES = 40;                 // W1: places on random carved ways (seeded) ...
const RANDOM_HALF = 12;                   // m: ... each a box of this half size
const RANDOM_SEED = 15;
const JAGGED_MAX = 0.02;                  // W1: at most this share of the length of the edges may wobble more than EDGE.jagged (v60: 0.17)
const WOBBLE_P99_MAX = 0.03;              // W1: m, the 99th percentile of the wobble (v60: 0.06 - 0.30 per place)
const IAN_JAGGED_MAX = 0.0;               // W1: Ian's place: nothing
const TONE_ON_EDGE = 0.10;                // W2: m, a change of tone lies this close to the edge of a street ...
const TONE_ON_EDGE_SHARE = 0.98;          // ... at this share of its points
const TONE_SOFT_MAX = 0.01;               // W2: share of the tarmac in a half tone (0.2 .. 0.8): only the pixel of the edge (the soft 0.8 m band of v60 and its blobs: more)
const VH = { ways: [16734, 1747], minStone: 120 };   // W3: Avenue Victor Hugo (the ways along Place Auguste Laurent; the stone on their south-west), stations with the square beside
const VH_WOBBLE_MAX = 0.02;               // W3: m, the edge's deviation from its 10 m running mean
const VH_EDGE_TOL = 0.05;                 // W3: m, |the carve's distance to the avenue's carriageway| at the painted edge
const FIDELITY_P95_MAX = 0.05;            // W4: m, |the carve's signed distance| at the points of the painted edge of the tarmac (95 %)

/** What the shader paints at a point, as a label (the kerb is laid over the carriageway: a car road's kerb along a square lies inside the union). */
export const paintLabel = (p) => (p.roadW < 0.5 ? 'g' : p.onKerb >= 0.5 ? 'k' : p.onCarriage >= 0.5 ? `c${Math.round(p.mat)}${p.minorW >= 0.5 ? 'm' : ''}` : p.onPave >= 0.5 ? 'p' : 'g');
const label = paintLabel;

export function runPaint15Checks({ check, section, stats, data, surface, field }) {
  section('W paint15: the edges of the ground paint (straight, no blobs, Avenue Victor Hugo)');
  const t0 = Date.now();
  const meshes = new Map();
  const meshAt = (x, z) => {
    const x0 = Math.floor(x / QUADTREE.minSize) * QUADTREE.minSize, z0 = Math.floor(z / QUADTREE.minSize) * QUADTREE.minSize;
    const k = `${x0}:${z0}`;
    let m = meshes.get(k);
    if (!m) {
      const sel = selectTiles(x0 + QUADTREE.minSize / 2, z0 + QUADTREE.minSize / 2, {});
      const leaf = leafAt(sel.split, x0 + QUADTREE.minSize / 2, z0 + QUADTREE.minSize / 2);
      m = buildTileMesh(leaf, computeTileNodes(leaf, surface, field), sel.split, field);
      meshes.set(k, m);
      if (meshes.size > 96) meshes.delete(meshes.keys().next().value);
    }
    return m;
  };
  const paintAtPoint = (x, z) => { const m = meshAt(x, z), v = varyingsAt(m, x, z); return { v, p: paintOf(v) }; };
  const sampler = (x, z) => {
    const { v, p } = paintAtPoint(x, z);
    let chC = Infinity;
    for (const d of v.road4) chC = Math.min(chC, d);
    return { label: label(p), fields: { sdC: p.sdC, kerb: p.sdC - p.kerbW, sdP: p.sdP, chS: p.chS, chR: p.chR, rest: p.restC - chC, restStreet: v.road3[3] } };
  };
  const info = { chGroup: new Int32Array(CHANNELS), chCar: new Float32Array(CHANNELS), chPave: new Float32Array(CHANNELS), chMajor: new Uint8Array(CHANNELS), chCode: new Uint8Array(CHANNELS) };
  const STREET = PAINT_CODE.car | PAINT_CODE.street;
  /** The carve's own distances at a point: to the union of the carriageways and to the nearest street. */
  const exactAt = (x, z) => {
    field.height(x, z, info);
    let street = Infinity;
    for (let c = 0; c < CHANNELS; c++) if (info.chGroup[c] >= 0 && (info.chCode[c] & STREET) === STREET) street = Math.min(street, info.chCar[c]);
    return { sdCar: info.sdCar, street };
  };

  // ---- the places: named, the junctions, random places along the carved ways
  const places = NAMED.map(([name, x, z, half]) => ({ name, x, z, half, junction: false }));
  for (const [name, x, z] of JUNCTIONS) places.push({ name, x, z, half: JUNCTION_HALF, junction: true });
  const rng = createRng(RANDOM_SEED);
  const ways = data.roads.filter((r) => r.info && r.info.drivable && !r.tunnel && !r.bridge && r.pts && r.pts.length >= 2 && r.length > 30);
  const total = ways.reduce((a, r) => a + r.length, 0);
  for (let k = 0; k < RANDOM_PLACES; k++) {
    let pick = rng() * total, r = ways[0];
    for (const w of ways) { pick -= w.length; if (pick <= 0) { r = w; break; } }
    const i = Math.min(r.pts.length - 2, Math.floor(rng() * (r.pts.length - 1))), t = rng();
    const x = r.pts[i][0] + (r.pts[i + 1][0] - r.pts[i][0]) * t, z = r.pts[i][1] + (r.pts[i + 1][1] - r.pts[i][1]) * t;
    places.push({ name: `random ${k} (${r.name || r.kind})`, x: Math.round(x), z: Math.round(z), half: RANDOM_HALF, junction: false });
  }

  // ---- W1 / W2 / W4
  let length = 0, jagged = 0, worst = 0, worstAt = '', ianJagged = 0, ianLen = 0;
  const p99s = [];
  let toneN = 0, toneOn = 0, toneWorst = 0, toneWorstAt = '', tarN = 0, tarSoft = 0;
  const fidelity = [];
  const perPlace = [];
  for (const pl of places) {
    const box = { x0: pl.x - pl.half, z0: pl.z - pl.half, x1: pl.x + pl.half, z1: pl.z + pl.half };
    const lines = traceEdges(sampler, box);
    const st = edgeStats(lines);
    length += st.length; jagged += st.jaggedLen; p99s.push(st.p99);
    if (st.worst > worst) { worst = st.worst; worstAt = `${pl.name} ${st.worstAt.x.toFixed(1)},${st.worstAt.z.toFixed(1)} (${st.worstAt.field})`; }
    if (pl.name.startsWith('Av. Victor Hugo')) { ianJagged += st.jaggedLen; ianLen += st.length; }
    perPlace.push({ name: pl.name, length: +st.length.toFixed(0), jagged: +st.jaggedLen.toFixed(1), p99Cm: +(st.p99 * 100).toFixed(1), worstCm: +(st.worst * 100).toFixed(1) });
    // W4: the edge of the tarmac against the carve (every 4th point of the traced edges, away from the box's border)
    for (const ln of lines) {
      if (ln.field !== 'sdC') continue;
      for (let k = 0; k < ln.pts.length; k += 4) {
        const [x, z] = ln.pts[k];
        if (x - box.x0 < 1 || box.x1 - x < 1 || z - box.z0 < 1 || box.z1 - z < 1) continue;
        fidelity.push(Math.abs(exactAt(x, z).sdCar));
      }
    }
    if (!pl.junction) continue;
    // W2: the tone boundaries (a change between the dark and the pale tar) on the edge of a street, and no half tones
    for (const ln of lines) {
      if (ln.field !== 'chS' && ln.field !== 'restStreet') continue;
      for (let k = 0; k + 1 < ln.pts.length; k += 2) {
        const [ax, az] = ln.pts[k], [bx, bz] = ln.pts[k + 1];
        const mx = (ax + bx) / 2, mz = (az + bz) / 2, l = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / l * EDGE.probe, nz = (bx - ax) / l * EDGE.probe;
        const la = sampler(mx + nx, mz + nz).label, lb = sampler(mx - nx, mz - nz).label;
        if (!(la[0] === 'c' && lb[0] === 'c' && la.endsWith('m') !== lb.endsWith('m'))) continue;      // (a change of tone on the tarmac only)
        toneN++;
        const d = Math.abs(exactAt(mx, mz).street);
        if (d <= TONE_ON_EDGE) toneOn++;
        if (d > toneWorst) { toneWorst = d; toneWorstAt = `${pl.name} ${mx.toFixed(1)},${mz.toFixed(1)}`; }
      }
    }
    for (let x = box.x0 + 0.25; x < box.x1; x += 0.5) {
      for (let z = box.z0 + 0.25; z < box.z1; z += 0.5) {
        const { p } = paintAtPoint(x, z);
        if (p.roadW < 0.5 || p.onCarriage < 0.5 || p.mat > 0.5) continue;
        tarN++;
        if (p.minorW > 0.2 && p.minorW < 0.8) tarSoft++;
      }
    }
  }
  p99s.sort((a, b) => a - b);
  fidelity.sort((a, b) => a - b);
  const share = length > 0 ? jagged / length : 1;
  const fid95 = fidelity.length ? fidelity[Math.floor(fidelity.length * 0.95)] : 1;
  const p99 = p99s.length ? p99s[Math.floor(p99s.length * 0.99)] : 1;
  stats.paint15 = { places: places.length, edgeM: +length.toFixed(0), jaggedM: +jagged.toFixed(1), jaggedShare: +share.toFixed(4), worstCm: +(worst * 100).toFixed(1), worstAt,
    placeP99Cm: +(p99 * 100).toFixed(1), tone: { points: toneN, onEdge: toneOn, worstCm: +(toneWorst * 100).toFixed(1), at: toneWorstAt, tarSamples: tarN, soft: tarSoft },
    fidelityP95Cm: +(fid95 * 100).toFixed(1), fidelityN: fidelity.length, perPlace };
  check(`paint W1: the edges of the paint are straight (wobble > ${EDGE.jagged * 100} cm on <= ${JAGGED_MAX * 100} % of their length, the places' 99th percentile <= ${WOBBLE_P99_MAX * 100} cm)`,
    length > 5000 && share <= JAGGED_MAX && p99 <= WOBBLE_P99_MAX,
    `${places.length} places, ${length.toFixed(0)} m of edges, ${jagged.toFixed(1)} m wobble (${(share * 100).toFixed(2)} %), places' p99 ${(p99 * 100).toFixed(1)} cm, worst ${(worst * 100).toFixed(1)} cm at ${worstAt}`);
  check('paint W1: Avenue Victor Hugo (Ian, 6 Nov) has no staircase', ianLen > 200 && ianJagged <= IAN_JAGGED_MAX, `${ianLen.toFixed(0)} m of edges, ${ianJagged.toFixed(1)} m wobble`);
  check(`paint W2: in the junction boxes the tone of the tarmac changes on the edge of a street (within ${TONE_ON_EDGE * 100} cm at ${TONE_ON_EDGE_SHARE * 100} % of the points) and crisply (half tones <= ${TONE_SOFT_MAX * 100} %)`,
    toneN > 50 && toneOn >= TONE_ON_EDGE_SHARE * toneN && tarN > 1000 && tarSoft <= TONE_SOFT_MAX * tarN,
    `${toneOn} of ${toneN} points on the edge (worst ${(toneWorst * 100).toFixed(1)} cm at ${toneWorstAt}), half tones ${tarSoft} of ${tarN} tarmac samples`);
  check(`paint W4: the painted edge of the tarmac lies on the carve's edge (p95 <= ${FIDELITY_P95_MAX * 100} cm)`, fidelity.length > 1000 && fid95 <= FIDELITY_P95_MAX,
    `${fidelity.length} points, p95 ${(fid95 * 100).toFixed(1)} cm, worst ${(fidelity[fidelity.length - 1] * 100).toFixed(1)} cm`);

  // ---- W3: Avenue Victor Hugo beside Place Auguste Laurent: along the drawn centre lines of its ways (road-network.js chains), the first change of the paint toward the square
  const offs = [];
  let withKerb = 0, withStone = 0, edgeOff = 0;
  const net = field.network;
  for (const id of VH.ways) {
    const ch = net.chains.find((c) => c.road === id);
    if (!ch) continue;
    const dir = data.roads[id].pts;                                       // (which side is the square: the south-west of the avenue's NW-going direction)
    const sgn = -Math.sign((dir[dir.length - 1][0] - dir[0][0]) + (dir[dir.length - 1][1] - dir[0][1])) || 1;
    for (let i = 1; i < ch.x.length; i++) {
      const ex = ch.x[i] - ch.x[i - 1], ez = ch.z[i] - ch.z[i - 1], l = Math.hypot(ex, ez);
      if (l < 1e-6) continue;
      const nx = (ez / l) * sgn, nz = (-ex / l) * sgn;
      for (let t = 0; t < l; t += 0.5) {
        const cx = ch.x[i - 1] + ex * t / l, cz = ch.z[i - 1] + ez * t / l;
        let edge = null, seenKerb = false, seenStone = false;
        for (let u = 0; u <= 9; u += 0.01) {
          const lb = label(paintAtPoint(cx + nx * u, cz + nz * u).p);
          if (edge === null && lb !== 'c0' && lb !== 'c0m') edge = u;
          if (edge !== null && lb === 'k') seenKerb = true;
          if (edge !== null && lb === 'c5') { seenStone = true; break; }
          if (edge !== null && (lb === 'p' || lb === 'g')) break;
        }
        if (!seenStone) { offs.push(null); continue; }
        withStone++;
        if (seenKerb) withKerb++;
        offs.push(edge);
        // the edge on the avenue's own edge: the carve's distance to the carriageway of its way there
        field.height(cx + nx * edge, cz + nz * edge, info);
        for (let c = 0; c < CHANNELS; c++) if (info.chGroup[c] >= 0 && Math.abs(info.chCar[c]) < 1.5 && (info.chCode[c] & PAINT_CODE.car)) edgeOff = Math.max(edgeOff, Math.abs(info.chCar[c]));
      }
    }
    offs.push(null);
  }
  let vhWobble = 0, nOk = 0;
  for (let k = 10; k < offs.length - 10; k++) {
    const win = offs.slice(k - 10, k + 11);
    if (win.some((v) => v === null)) continue;
    const mean = win.reduce((a, v) => a + v, 0) / win.length;
    vhWobble = Math.max(vhWobble, Math.abs(offs[k] - mean));
    nOk++;
  }
  stats.paint15.victorHugo = { stations: offs.length, withStone, measured: nOk, wobbleCm: +(vhWobble * 100).toFixed(1), edgeOffCm: +(edgeOff * 100).toFixed(1), withKerb };
  check(`paint W3: Avenue Victor Hugo meets the stone of Place Auguste Laurent on its own edge (straight: <= ${VH_WOBBLE_MAX * 100} cm; on the carve's edge +- ${VH_EDGE_TOL * 100} cm), with a kerb`,
    withStone >= VH.minStone && nOk > VH.minStone / 2 && vhWobble <= VH_WOBBLE_MAX && edgeOff <= VH_EDGE_TOL && withKerb >= 0.95 * withStone,
    `${withStone} stations beside the square, ${nOk} measured: wobble ${(vhWobble * 100).toFixed(1)} cm, ${(edgeOff * 100).toFixed(1)} cm off the carve's edge, kerb at ${withKerb}`);
  stats.paint15.ms = Date.now() - t0;
  console.log(`  (W: ${places.length} places, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
