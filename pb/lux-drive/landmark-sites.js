/* The famous SITES of Luxembourg that are not a single block of the bake: the cliffs of the Bock with the walls of the fortress, the stone
 * viaduct (the Passerelle) over the Pétrusse, the Coque of Kirchberg, Fort Thüngen with its three towers, the Mudam and the clock tower of
 * the BCEE at the Place de Metz.  Same contract as landmark-buildings.js / landmark-bridges.js: each builder returns
 * { soup, walls, hideBuildings, hideDecks, info } and stands on the ground at every corner (nothing floats). */
import { Soup, axisFrame, paint, linspace } from './landmark-soup.js';
import { PALETTE as C } from './landmark-palette.js';
import { requireBlocks, edgeWalls, scalePoly, groundRange, decksAlong, pickDeck, wallFace, deckStrip, stationsOf, deckFootprint, deckLevels } from './landmark-util.js';
import { edgeFrame, windowGrid, course, slab, turret, panel, joints, roundArch } from './landmark-facade.js';
import { SITE_FOOTPRINTS as FOOT, FORT_TOWERS } from './landmark-site-data.js';
import { isCarRoad } from './road-index.js';
import { segmentGap } from './lane-clearance.js';

const BOCK_GATE_REACH = 200;     // m: the car roads with a point this close to the middle of the Bock may cross its rim (BOCK.reach 70 m + the length of a way)
const BOCK_GATE_CLEAR = 1.4;     // m: a stretch of the fortress wall keeps this past the edge of a carriageway it would cross (CAR.bodyRadius + the wall's 0.9 m - its own half thickness)

const TAU = Math.PI * 2;
const SINK = 1.0;
const FACADE_TREE_FREE = 9;      // m: no tree OSM maps stands this near the walls of the Coque or the Mudam (the photographs show their façades and the sky behind the roof line, not a trunk)
const bottomsOf = (ground, pts) => pts.map((p) => ground(p[0], p[1]) - SINK);
const centroid = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];

const BAR_WIDTH = 0.16, BAR_PROUD = 0.12;     // m: the glazing bars of the Mudam read from the road (0.09 / 0.07 vanished at 40 m)
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** One glazing bar from p to q on a glass face with unit normal n: a thin quad standing BAR_PROUD out of the glass. */
function glazeBar(soup, p, q, n, color) {
  const d = vsub(q, p), side = vcross(d, n), sl = Math.hypot(...side) || 1;
  const o = n.map((v) => v * BAR_PROUD), k = BAR_WIDTH / 2 / sl, sd = side.map((v) => v * k);
  const add = (a, b, c) => [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
  const neg = sd.map((v) => -v);
  soup.quad(add(p, sd, o), add(q, sd, o), add(q, neg, o), add(p, neg, o), color);
}

/** Glazing bars on a triangular glass face A-B-P (P the apex): `ribs` bars from the apex to the base and `rings` bars parallel to the base. */
function glazeTriangle(soup, A, B, P, ribs, rings, color) {
  let n = vcross(vsub(B, A), vsub(P, A));
  const nl = Math.hypot(...n) || 1; n = n.map((v) => v / nl);
  for (let i = 1; i < ribs; i++) glazeBar(soup, vlerp(A, B, i / ribs), P, n, color);
  for (let j = 1; j <= rings; j++) { const t = j / (rings + 1); glazeBar(soup, vlerp(A, P, t), vlerp(B, P, t), n, color); }
}

/** Glazing bars on a four-cornered glass face A-B-C-D: `across` bars from the edge A-D to B-C ... and `along` bars from A-B to D-C. */
function glazeQuad(soup, A, B, C_, D, across, along, color) {
  let n = vcross(vsub(B, A), vsub(D, A));
  const nl = Math.hypot(...n) || 1; n = n.map((v) => v / nl);
  for (let i = 1; i < across; i++) glazeBar(soup, vlerp(A, B, i / across), vlerp(D, C_, i / across), n, color);
  for (let j = 1; j < along; j++) glazeBar(soup, vlerp(A, D, j / along), vlerp(B, C_, j / along), n, color);
}

/* ------------------------------------------------------------------------------------------------ Bock: cliffs and fortress walls */
// The Bock is a natural cliff of ochre and grey sandstone in rough bands, with a dark blue-grey fortress wall along its top edge (stepped, with a coping),
// a ruined square tower and a few dark casemate windows (the photographs).  The skin lies on the terrain: small facets, the colour in horizontal bands
// of the absolute height (strata), every vertex pushed out by a little noise so the rock is rough and never flat slabs.
const BOCK = Object.freeze({
  centre: [5540, 8738],          // m, on the plateau of the rock
  rays: 72, reach: 70, edgeDrop: 4,   // the edge of the cliff: the first point 4 m under the plateau
  maxSkin: 75, skinStep: 2.4, lift: 0.8, liftNoise: 0.9, flatSlope: 0.3,   // the stone skin runs down until the slope is gentler than this (rise / run)
  stratum: 5.0,                  // m: the height of one band of the rock (the vertices of the skin are ~2.4 m apart: a thinner band would alias into random patches)
  wallHeight: 4.2, wallThick: 1.6, merlonEvery: 3.2, merlon: 1.1,
  bastionEvery: 12, casemates: 9,
  tower: { half: 2.6, aspect: 1.25, height: 22 },
  // The cliff: the DTM of the rock is a 2:1 slope (25 m down in 12 m), the real Bock is a sheer wall.  Where the slope drops `drop` m within `reach` m of the rim, the rim is moved out to where
  // the ground has fallen by `drop`: a vertical face stands THERE (on top of the DTM, down to the ground at its foot) and a cap of rock at the height of the plateau joins it to the old rim.
  curtain: { drop: 16, reach: 18, steps: 7, rough: 0.35, capColour: [0.50, 0.47, 0.38] },
  casemate: { rows: [5.5, 11.5], width: 2.2, height: 2.4, every: 3, max: 16 },   // the arched mouths in the face: two storeys, every `every` rays
});

/** The edge of the rock as [{ x, z, dx, dz }] per ray (null where the plateau runs on without a cliff). */
function cliffEdge(ground, K) {
  const [cx, cz] = K.centre, top = ground(cx, cz);
  return Array.from({ length: K.rays }, (_, i) => {
    const a = (i / K.rays) * TAU, dx = Math.cos(a), dz = Math.sin(a);
    for (let r = 6; r <= K.reach; r += 2) {
      if (ground(cx + dx * r, cz + dz * r) < top - K.edgeDrop) return r > 10 ? { x: cx + dx * (r - 2), z: cz + dz * (r - 2), dx, dz } : null;
    }
    return null;
  });
}

/** A stable pseudo-random number in [0, 1) from two integers. */
function hash01(a, b) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** The colour of the rock at height y: a band of ochre or grey per stratum (the bands blend into each other over a third of their height, so the strata
 *  are soft gradients and not hard stripes), a little darker the lower it lies (shade of the overhangs), a mottling that is different at every vertex. */
function rockColour(y, key, depth, ray = 0) {
  const f = y / BOCK.stratum, band = Math.floor(f), frac = f - band;
  const blend = Math.min(1, Math.max(0, (frac - 0.66) / 0.34));
  const t0 = hash01(band, 7), t1 = hash01(band + 1, 7);
  const t = (t0 + (t1 - t0) * blend * blend * (3 - 2 * blend));
  const base = [0, 1, 2].map((k) => C.rockGrey[k] + (C.rockOchre[k] - C.rockGrey[k]) * t);
  // vertical streaks (the cracks and weathering lines of the cliff): a darker or lighter column per pair of rays, blended between neighbours
  const streak = 0.9 + 0.2 * (hash01(Math.floor(ray / 2), 3) * (1 - (ray % 2) * 0.5) + hash01(Math.floor(ray / 2) + 1, 3) * (ray % 2) * 0.5);
  const shade = (1 - depth * 0.28) * streak;
  return paint([base[0] * shade, base[1] * shade, base[2] * shade], key, 0.06);
}

/** A ruined tower: four walls of different heights (the top is broken away in steps), mortar courses, slits, an arched window, a fallen corner, moss on the stumps. */
function buildRuinTower(soup, ground, towerEdge, T) {
  const tx = towerEdge.x - towerEdge.dx * (T.half + 1), tz = towerEdge.z - towerEdge.dz * (T.half + 1);
  const yaw = Math.atan2(towerEdge.dz, towerEdge.dx);
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const hx = T.half * T.aspect, hz = T.half;                       // the tower is longer than it is wide
  const corner = (u, v) => [tx + u * c - v * sn, tz + u * sn + v * c];
  const poly = [corner(-hx, -hz), corner(hx, -hz), corner(hx, hz), corner(-hx, hz)];
  const base = towerEdge.y, top = base + T.height;               // it stands on the plateau (or the cap of the rock), not on the ground a cliff-height below
  const stone = [0.47, 0.43, 0.36], stoneDark = [0.34, 0.31, 0.26], moss = [0.34, 0.42, 0.22];
  // each wall rises to its own height; the corners between are stepped (a prism per wall, thick 1.1 m)
  const wallTops = [top, top - 5.5, top - 2.2, top - 8.0];
  for (let e = 0; e < 4; e++) {
    const f = edgeFrame(poly, e);
    const yBottom = base - 1.0;
    const yTop = wallTops[e];
    const thick = 1.1;
    const cx = (f.a[0] + f.b[0]) / 2 - f.nx * thick / 2, cz = (f.a[1] + f.b[1]) / 2 - f.nz * thick / 2;
    // the broken top: three stepped boxes of different heights along the wall
    const parts = 3;
    for (let k = 0; k < parts; k++) {
      const s0 = (f.len * k) / parts, s1 = (f.len * (k + 1)) / parts;
      const drop = [0, 1.9, 0.7][(k + e) % 3] + hash01(e, k) * 1.2;
      const [px, , pz] = f.at((s0 + s1) / 2, 0, -thick / 2);
      soup.box(px, yBottom, pz, s1 - s0 + (k + 1 < parts ? 0.05 : 0), yTop - drop - yBottom, thick, f.yaw, paint(stone, e * 7 + k, 0.08), { topColor: paint(moss, e + k, 0.1) });
    }
    void cx; void cz;
    // mortar courses: thin darker bands every 1.3 m up the outer face
    for (let y = yBottom + 2.0; y < yTop - 2.4; y += 1.3) panel(soup, f, 0, f.len, y, y + 0.14, 0.04, paint(stoneDark, Math.round(y * 5) + e, 0.05));
    // slits and the arched window
    const sc = f.len * (e % 2 ? 0.35 : 0.62);
    panel(soup, f, sc - 0.14, sc + 0.14, yTop - 9.5, yTop - 7.0, 0.06, C.blackGlass);
    if (e === 0) {
      panel(soup, f, f.len / 2 - 0.5, f.len / 2 + 0.5, yTop - 8.0, yTop - 5.6, 0.07, C.blackGlass);
      soup.tri(f.at(f.len / 2 - 0.5, yTop - 5.6, 0.07), f.at(f.len / 2 + 0.5, yTop - 5.6, 0.07), f.at(f.len / 2, yTop - 4.7, 0.07), C.blackGlass);
    }
  }
  // the inside of the ruin: a floor-high dark core so the open top shows no sky through the stumps
  soup.prism(scalePoly(poly, 0.7), base - SINK, top - 7.0, paint(stoneDark, 5, 0.04), { topColor: stoneDark });
}

/** The face of the cliff for a rim point `e`: { x, z, dx, dz, y, rim, curtain } with (x, z) where the ground has fallen by K.curtain.drop m (a sheer face stands there), or the rim itself. */
function faceOf(ground, e, K) {
  const y = ground(e.x, e.z), C = K.curtain;
  for (let t = 2; t <= C.reach; t += 1) {
    if (ground(e.x + e.dx * t, e.z + e.dz * t) <= y - C.drop) return { x: e.x + e.dx * t, z: e.z + e.dz * t, dx: e.dx, dz: e.dz, y, rim: e, curtain: true };
  }
  return { ...e, y, rim: e, curtain: false };
}

export function buildBock({ ground, roads = [] }) {
  const K = BOCK;
  const soup = new Soup();
  const walls = [];
  const rimEdge = cliffEdge(ground, K);
  const arcsOfRim = rimEdge.map((e, i) => [e, rimEdge[(i + 1) % rimEdge.length]]).filter(([a, b]) => a && b);
  if (arcsOfRim.length < 12) throw new Error(`Bock: only ${arcsOfRim.length} cliff segments found around (${K.centre}): the plateau is not where it was measured`);
  const edge = rimEdge.map((e) => (e ? faceOf(ground, e, K) : null));
  const arcs = edge.map((e, i) => [e, edge[(i + 1) % edge.length]]).filter(([a, b]) => a && b);
  // the skin of each ray: for a sheer face the points of the face from its top down to the foot, then the points from the edge down the slope, lifted so the stone lies on the rock and never inside it
  const skinOf = (e, ray) => {
    const pts = [];
    const foot = ground(e.x, e.z) + K.lift;
    if (e.curtain) {
      for (let k = 0; k < K.curtain.steps; k++) {
        const t = k / K.curtain.steps, bulge = K.curtain.rough * hash01(ray * 7 + k, 11) * Math.sin(Math.PI * t);
        pts.push([e.x + e.dx * (0.1 + bulge), e.y - 0.3 - (e.y - 0.3 - foot) * t, e.z + e.dz * (0.1 + bulge)]);
      }
    }
    let prev = ground(e.x, e.z);
    for (let t = 0; t <= K.maxSkin; t += K.skinStep) {
      const x = e.x + e.dx * t, z = e.z + e.dz * t, y = ground(x, z);
      const lift = K.lift + K.liftNoise * hash01(ray, Math.round(t / K.skinStep));
      pts.push([x + e.dx * lift * 0.4, y + lift, z + e.dz * lift * 0.4]);
      if (t > 8 && (prev - y) / K.skinStep < K.flatSlope) break;
      prev = y;
    }
    return pts;
  };
  const skins = new Map(edge.map((e, i) => [i, e ? skinOf(e, i) : null]));
  // ONE smooth skin: the normal of every vertex is the mean of its faces, the colour is per vertex (strata + mottling): no flat facets
  const rows = edge.map((e, i) => (e ? skins.get(i) : null));
  const colours = rows.map((row, i) => (row ? row.map((p, k) => rockColour(p[1], i * 131 + k * 17, k / Math.max(1, row.length - 1), i)) : null));
  soup.grid(rows, colours, { loop: true, flip: 'auto' });
  // the cap: rock at the height of the plateau between the old rim and the top of the face (nothing of the slope behind the face shows through)
  const capRows = edge.map((e, i) => (e && e.curtain ? [[e.rim.x, e.y - 0.3, e.rim.z], [e.x + e.dx * 0.1, e.y - 0.3, e.z + e.dz * 0.1]] : null));
  const capColours = capRows.map((r, i) => (r ? r.map((_, k) => paint(K.curtain.capColour, i * 3 + k, 0.06)) : null));
  soup.grid(capRows, capColours, { loop: true, flip: 'auto' });
  const placed = arcs.length;
  // the fortress wall along the edge: blue-grey masonry with a coping and merlons, standing on the rim of the rock
  const edgeIdx = edge.map((e, i) => (e ? i : -1)).filter((i) => i >= 0);
  // drive12 (harness T2): where a car road crosses the rim (the Schlassbréck, the Clausener Bierg onto the Bock) the fortress wall has a gate - it stood across both lanes
  // of those bridges, an invisible-looking stop 1.9 m into the lane
  const carWays = roads.filter((r) => isCarRoad(r) && r.pts.some((q) => Math.hypot(q[0] - K.centre[0], q[1] - K.centre[1]) < BOCK_GATE_REACH));
  const crossesRoad = (e, f) => carWays.some((r) => r.pts.some((q, k) => k + 1 < r.pts.length && segmentGap(e.rim.x, e.rim.z, f.rim.x, f.rim.z, q[0], q[1], r.pts[k + 1][0], r.pts[k + 1][1]).d < r.width / 2 + BOCK_GATE_CLEAR));
  edgeIdx.forEach((i, n) => {
    const e = edge[i], f = edge[(i + 1) % edge.length];
    if (!f) return;
    if (crossesRoad(e, f)) return;
    const y = Math.min(e.y, f.y);
    const len = Math.hypot(f.x - e.x, f.z - e.z), yaw = Math.atan2(-(f.z - e.z), f.x - e.x);
    const mx = (e.x + f.x) / 2 + e.dx * 0.6, mz = (e.z + f.z) / 2 + e.dz * 0.6;
    soup.box(mx, y - 0.6, mz, len, K.wallHeight + 0.6, K.wallThick, yaw, paint(C.fortWall, i, 0.07), { topColor: paint(C.fortWall, i + 3, 0.05) });
    soup.box(mx, y + K.wallHeight, mz, len, 0.35, K.wallThick + 0.4, yaw, paint(C.sandstoneDark, i + 9, 0.05), { topColor: C.sandstoneDark });     // the coping
    for (let m = K.merlonEvery / 2; m < len; m += K.merlonEvery) {                                                                                 // the merlons
      const px = e.x + ((f.x - e.x) * m) / len + e.dx * 0.6, pz = e.z + ((f.z - e.z) * m) / len + e.dz * 0.6;
      soup.box(px, y + K.wallHeight + 0.35, pz, K.merlon, 0.9, K.wallThick, yaw, paint(C.fortWall, i * 5 + Math.round(m), 0.06), { topColor: C.fortWall });
    }
    walls.push({ ax: e.rim.x, az: e.rim.z, bx: f.rim.x, bz: f.rim.z, r: 0.9, id: 'bock-parapet' });
    if (n % K.bastionEvery === 0) {
      const bx = e.x - e.dx * 3.0, bz = e.z - e.dz * 3.0;               // a stubby round bastion on the rim of the plateau (it hung over the cliff as a pillar)
      const yb = e.y - 4.0, yt = e.y + 3.0;                              // it stands on the cap of the rock (the ground under it may be a cliff below)
      soup.frustum(bx, bz, 5.0, 4.4, yb, yt, 12, paint(C.fortWall, i + 3, 0.05), { capColor: C.sandstoneDark });
    }
  });
  // the ruined tower on the rim of the rock (photographs: a tall narrow keep of grey-brown stone, slits, an arched window, the top broken away in steps)
  const towerEdge = edge[edgeIdx[Math.floor(edgeIdx.length / 3)]];
  if (towerEdge) buildRuinTower(soup, ground, towerEdge, K.tower);
  // the casemate openings: arched mouths in the sheer face (a pale stone arch round a dark mouth), two storeys, every few rays
  let door = 0;
  const CS = K.casemate;
  for (const i of edgeIdx) {
    const e = edge[i];
    if (!e.curtain || i % CS.every !== 0 || door >= CS.max) continue;
    const px = -e.dz, pz = e.dx, row = CS.rows[(door >> 0) % CS.rows.length];
    const yb = e.y - row, o = 0.55;                                                // 0.55 m out of the face (its roughness bulges up to 0.35 m)
    const q = (u, y, out = o) => [e.x + px * u + e.dx * out, yb + y, e.z + pz * u + e.dz * out];
    const arch = (hw, h, out, color, key) => {
      soup.quad(q(-hw, 0, out), q(hw, 0, out), q(hw, h, out), q(-hw, h, out), color);
      for (let a = 0; a < 8; a++) { const t0 = Math.PI * (a / 8), t1 = Math.PI * ((a + 1) / 8); soup.tri(q(0, h, out), q(Math.cos(t0) * hw, h + Math.sin(t0) * hw, out), q(Math.cos(t1) * hw, h + Math.sin(t1) * hw, out), color); }
      void key;
    };
    arch(CS.width / 2 + 0.45, CS.height, o - 0.05, paint(C.sandstoneLight, i, 0.04), i);          // the stone surround
    arch(CS.width / 2, CS.height, o + 0.07, C.blackGlass, i + 1);                                    // the dark mouth
    door += 1;
  }
  return { soup, walls, hideBuildings: [], hideDecks: [], info: { segments: placed, rays: arcs.length, openings: door } };
}

/* ------------------------------------------------------------------------------------------------ Passerelle (the stone viaduct) */
const PASSERELLE = Object.freeze({
  at: [5312, 9390],
  pitch: 9.3, pier: 2.3,            // m between the axes of the piers, the thickness of a pier at the springing line
  columnWidth: 3.6, batter: 0.022,  // m: a column of a pier is this wide across the bridge, and widens by this much per metre of height toward the foot
  archRise: 1.0,                    // the arches are round: the rise over the half span
  balustrade: 1.1, fascia: 1.3, kerb: 0.14,
  roadHalf: 5.9, maxHalf: 10.5,
});

export function buildPasserelle({ decks, ground }) {
  const K = PASSERELLE;
  const road = pickDeck(decks, K.at[0], K.at[1], { width: 11.8, tolerance: 0.6, minLength: 120 });
  const p0 = road.pts[0], p1 = road.pts[road.pts.length - 1];
  const F0 = axisFrame(p0[0], p0[1], p1[0], p1[1]);
  // the decks of the bridge itself (the road and its footway); the lower footways of the bake that run along the slope stay as they are
  // (the footway decks beside the road ride on the bridge, but their pinned ends dip to the ground 10 m below: the MEDIAN of the tops tells a bridge deck from a path
  // down the slope.  They used to be left to the generic deck view and hung as grey slabs inside the arcade, seen through the openings.)
  const median = (a) => { const v = Array.from(a).sort((p, q) => p - q); return v[v.length >> 1]; };
  const inCorridor = (d) => d.pts.filter((p) => { const [s, u] = F0.local(p[0], p[1]); return Math.abs(u) <= 12 && s >= -25 && s <= F0.length + 25; }).length >= d.pts.length * 0.85;
  const along = decks.filter((d) => inCorridor(d) && median(d.tops) > road.tops[0] - 4);
  // The footways of the bridge run on past the end of the road deck (the north end: 17 m of footway at deck level over the slope).  The model covers them too, or the car
  // would walk over a bridge nobody draws (the decks the model replaces are not drawn by the generic view).  The pinned, dipping ends of a footway are not the bridge.
  let sLo = 0, sHi = F0.length;
  for (const d of along) d.pts.forEach((p, i) => { if (d.tops[i] < road.tops[0] - 3) return; const [s] = F0.local(p[0], p[1]); sLo = Math.min(sLo, s); sHi = Math.max(sHi, s); });
  const F = axisFrame(...F0.xz(sLo, 0), ...F0.xz(sHi, 0));
  const L = F.length;
  // the profile of the road deck by station
  const ss = stationsOf(F, road.pts);
  const flip = ss[0] > ss[ss.length - 1];
  const sArr = flip ? [...ss].reverse() : ss, tArr = flip ? Array.from(road.tops).reverse() : Array.from(road.tops);
  const top = (s) => {
    if (s <= sArr[0]) return tArr[0];
    if (s >= sArr[sArr.length - 1]) return tArr[tArr.length - 1];
    let lo = 0, hi = sArr.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (sArr[m] <= s) lo = m; else hi = m; }
    return tArr[lo] + ((tArr[hi] - tArr[lo]) * (s - sArr[lo])) / (sArr[hi] - sArr[lo] || 1);
  };
  const under = (s) => top(s) - K.fascia;
    // the full width: the roadway and the footways of the baked decks beside it
  let half = K.roadHalf + 2.9;
  for (const d of along) d.pts.forEach((p, i) => { if (d.tops[i] < road.tops[0] - 3) return; const [, u] = F.local(p[0], p[1]); half = Math.max(half, Math.min(Math.abs(u) + d.width / 2 + 0.3, K.maxHalf)); });   // the pinned, dipping ends of a footway do not widen the bridge
  const g = (s, u) => ground(...F.xz(s, u));
  const lowestGround = (s) => Math.min(g(s, -half), g(s, 0), g(s, half)) - SINK;
  const soup = new Soup();
  const walls = [];

  // the roadway, the pavements, the balustrades
  deckStrip(soup, F, -K.roadHalf, K.roadHalf, 0, L, top, C.asphalt, Math.ceil(L / 4), 1, 0.01);
  for (const sign of [1, -1]) {
    deckStrip(soup, F, sign * K.roadHalf, sign * half, 0, L, top, C.paving, Math.ceil(L / 4), 2, K.kerb);
    wallFace(soup, F, sign * half, 0, L, (s) => top(s) - 0.3, (s) => top(s) + K.balustrade, C.bridgeStoneLight, Math.ceil(L / 3), 3 + (sign > 0 ? 0 : 1));
    wallFace(soup, F, sign * (half - 0.5), 0, L, (s) => top(s) + K.kerb, (s) => top(s) + K.balustrade, C.bridgeStone, Math.ceil(L / 3), 6);
    deckStrip(soup, F, sign * (half - 0.5), sign * half, 0, L, (s) => top(s) + K.balustrade, C.bridgeStoneLight, Math.ceil(L / 3), 7);
    walls.push({ ax: F.xz(0, sign * (half - 0.4))[0], az: F.xz(0, sign * (half - 0.4))[1], bx: F.xz(L, sign * (half - 0.4))[0], bz: F.xz(L, sign * (half - 0.4))[1], r: 0.4, id: 'passerelle-rail', levels: deckLevels(top, L) });
  }
  for (let s = 1; s < L; s += K.pitch) for (const sign of [1, -1]) {
    const [x, z] = F.xz(s, sign * (half - 0.25));
    soup.box(x, top(s), z, 0.8, K.balustrade + 0.5, 0.8, Math.atan2(-F.dz, F.dx), paint(C.bridgeStoneLight, Math.round(s) + 9), { topColor: C.bridgeStoneLight });
  }
  // the slab: fascia, cornice, underside
  deckStrip(soup, F, -half, half, 0, L, under, C.bridgeStoneDark, Math.ceil(L / 4), 20);
  for (const sign of [1, -1]) {
    wallFace(soup, F, sign * half, 0, L, under, (s) => top(s) - 0.3, C.bridgeStoneLight, Math.ceil(L / 3), 21);
    wallFace(soup, F, sign * (half + 0.3), 0, L, (s) => top(s) - 0.7, (s) => top(s) - 0.3, C.bridgeStone, Math.ceil(L / 3), 22);
  }
  // The arcade (the photographs): ONE tier of tall round arches carried by slim battered piers.  The piers are not slabs across the whole width: at each side
  // of the bridge stands a column (pier x column), and between the two columns the arches' vault spans across, open to the valley underneath.
  const bays = Math.max(4, Math.round(L / K.pitch));
  const P = L / bays;
  const ho = (P - K.pier) / 2;                                   // half the span of an arch
  const springAt = (s) => under(s) - ho * K.archRise - 1.0;      // the line where the arch leaves the pier
  let open = 0;
  const archY = (s, sc, spring) => spring + K.archRise * Math.sqrt(Math.max(0, ho * ho - (s - sc) ** 2));
  for (const sign of [1, -1]) {
    const u = sign * half;
    const uIn = sign * (half - K.columnWidth);
    // the piers: columns at s = b * P (the two ends are the abutments, solid)
    for (let b = 0; b <= bays; b++) {
      const sp = b * P, spring = springAt(sp);
      const sa = Math.max(0, sp - K.pier / 2), sb = Math.min(L, sp + K.pier / 2);
      const ground0 = Math.min(g(sp, u), g(sp, uIn)) - SINK;
      if (ground0 < spring - 1.0) {
        const batter = K.batter * Math.max(0, spring - ground0);        // wider at the foot: a tapered shaft
        const topQuad = (uu) => [F.at(sa, spring, uu), F.at(sb, spring, uu)];
        const foot = (uu, db) => [F.at(sa - db, ground0, uu), F.at(sb + db, ground0, uu)];
        const [ta0, ta1] = topQuad(u), [tb0, tb1] = topQuad(uIn);
        const [fa0, fa1] = foot(u + sign * batter, batter), [fb0, fb1] = foot(uIn - sign * batter, batter);
        const stone = paint(C.bridgeStone, b * 11 + (sign > 0 ? 1 : 2));
        soup.quad(fa0, fa1, ta1, ta0, stone);                               // the outer face
        soup.quad(fb1, fb0, tb0, tb1, paint(C.bridgeStoneDark, b + 301));   // the inner face
        soup.quad(fa0, ta0, tb0, fb0, paint(C.bridgeStoneDark, b + 302));  // the two flanks
        soup.quad(fa1, fb1, tb1, ta1, paint(C.bridgeStoneDark, b + 303));
        open += 1;
      }
      // the wall of the pier above the springing line, up to the slab
      wallFace(soup, F, u, sa, sb, () => spring, under, C.bridgeStoneLight, 1, b * 7 + 1);
    }
    // the arches between the piers: the spandrel wall over each one, or the plain wall where the slope rises above the springing line
    for (let b = 0; b < bays; b++) {
      const sc = (b + 0.5) * P, spring = springAt(sc);
      const l = b * P + K.pier / 2, r = (b + 1) * P - K.pier / 2;
      const lowest = Math.min(g(sc, u), g(sc, uIn));
      if (lowest < spring - 1.0) {
        wallFace(soup, F, u, l, r, (s) => archY(s, sc, spring), under, C.bridgeStoneLight, 8, b * 7 + 3);
        // the head of the arch: a ring of dressed stone
        wallFace(soup, F, u + sign * 0.12, l, r, (s) => archY(s, sc, spring), (s) => archY(s, sc, spring) + 0.45, C.bridgeStoneDark, 8, b * 7 + 4);
      } else {
        wallFace(soup, F, u, l, r, (s) => g(s, u) - SINK, under, C.bridgeStone, 2, b * 7 + 5);
      }
    }
    // the belt: a stone band along the springing line, over the piers and the arches alike
    wallFace(soup, F, u + sign * 0.2, 0, L, (s) => springAt(s) - 0.25, (s) => springAt(s) + 0.25, C.bridgeStoneLight, Math.ceil(L / 3), 40);
  }
  for (let b = 0; b < bays; b++) {         // the vaults between the two sides: the soffit of every arch, across the whole width
    const sc = (b + 0.5) * P, spring = springAt(sc);
    const l = b * P + K.pier / 2, r = (b + 1) * P - K.pier / 2;
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const s0 = l + ((r - l) * i) / steps, s1 = l + ((r - l) * (i + 1)) / steps;
      soup.quad(F.at(s0, archY(s0, sc, spring), -half), F.at(s1, archY(s1, sc, spring), -half), F.at(s1, archY(s1, sc, spring), half), F.at(s0, archY(s0, sc, spring), half), paint(C.bridgeStoneDark, 600 + b * 9 + i, 0.05));
    }
  }
  // the ends: closed so that nothing hollow shows
  for (const s of [0, L]) soup.quad(F.at(s, lowestGround(s), -half), F.at(s, lowestGround(s), half), F.at(s, under(s), half), F.at(s, under(s), -half), paint(C.bridgeStoneDark, 99));
  return { soup, walls, hideBuildings: [], hideDecks: along.map((d) => d.id), footprints: [deckFootprint(F, top, -half, half)], info: { bays, open, half: +half.toFixed(1), length: +L.toFixed(0) } };
}

/* ------------------------------------------------------------------------------------------------ Coque (Kirchberg) */
// The Coque (the shell) of Kirchberg: an elliptical hall under a thick dark roof that curves up like an upturned hull and overhangs a band of teal glass.
// The old model had a flat rim and a pale low shell: nobody could tell it from a warehouse.
const COQUE = Object.freeze({ at: [6633, 7440], hideRadius: 90, hideMinArea: 300, wallHeight: 7.5, rise: 13, rings: 9, glassBottom: 1.8, glassTop: 6.0, overhang: 1.035 });

export function buildCoque({ buildings, ground }) {
  const K = COQUE;
  const hidden = requireBlocks(buildings, 'Coque', K.at[0], K.at[1], K.hideRadius, K.hideMinArea);
  const poly = FOOT.coque;
  const soup = new Soup();
  const { high } = groundRange(ground, poly);
  const yRim = high + K.wallHeight;
  // the drum: a light plinth, then a band of teal glass under the eaves, standing on the ground all round
  soup.prism(poly, bottomsOf(ground, poly), yRim, paint(C.concrete, 3, 0.02), { top: false });
  for (let e = 0; e < poly.length; e++) {
    const f = edgeFrame(poly, e);
    if (f.len < 3) continue;
    panel(soup, f, 0.4, f.len - 0.4, high + K.glassBottom, high + K.glassTop, 0.06, paint(C.glassTeal, e, 0.06));
    for (let m = 2; m < f.len - 1; m += 2.0) slab(soup, f, m - 0.11, m + 0.11, high + K.glassBottom, high + K.glassTop, 0.26, C.steelDark);   // the mullions: real posts, a pane every 2 m
    for (const yT of [high + 3.1, high + 4.5]) slab(soup, f, 0.4, f.len - 0.4, yT, yT + 0.2, 0.22, C.steelDark);                              // the transoms: with the mullions a grid of panes
    // the dressed stone of the plinth under the glass: proud courses 0.55 m high with a hand-wide joint between them, and a coping
    for (let y = high - 0.4; y + 0.55 <= high + K.glassBottom; y += 0.65) slab(soup, f, 0.4, f.len - 0.4, y, y + 0.55, 0.12, paint(C.limestone, Math.round(y * 9) + e, 0.05), { topColor: C.limestone });
    joints(soup, f, { y0: high - 0.4, y1: high + K.glassBottom, rowH: 0.65, colW: 1.6, color: C.concreteDark, key: e * 31, width: 0.1, vertical: true });
    slab(soup, f, 0.2, f.len - 0.2, high + K.glassBottom - 0.15, high + K.glassBottom + 0.1, 0.3, paint(C.limestone, e, 0.03), { topColor: C.limestone });
  }
  // the overhanging rim of the roof: a thick dark band all round
  const rim = scalePoly(poly, K.overhang);
  soup.prism(rim, yRim - 0.2, yRim + 1.6, C.roofDark, { topColor: C.roofDark });
  // the shell: concentric rings of the outline, drawn smaller and higher on a steep curve (an upturned hull), as ONE smooth skin (no facets)
  const levels = Array.from({ length: K.rings + 1 }, (_, k) => {
    const sc = 1 - k / K.rings;
    return { pts: scalePoly(rim, Math.max(sc, 0.03)), y: yRim + 1.6 + K.rise * (1 - Math.pow(sc, 2.2)) };
  });
  const rows = rim.map((_, i) => levels.map((lv) => [lv.pts[i][0], lv.y, lv.pts[i][1]]));
  const cols = rim.map((_, i) => levels.map((_lv, k) => paint(C.roofDark, i * 7 + k, 0.05)));
  soup.grid(rows, cols, { loop: true, flip: 'auto' });
  return { soup, walls: edgeWalls(poly, 0.4, 'coque'), hideBuildings: hidden.map((b) => b.id), hideDecks: [], treeFree: [{ poly, margin: FACADE_TREE_FREE }], info: { blocks: hidden.length, rise: K.rise } };
}

/* ------------------------------------------------------------------------------------------------ Fort Thüngen (Dräi Eechelen) */
// The fort: a long curtain wall of pale sandstone, two big round towers with a dark weathered battered foot and a pale upper drum with a frieze of
// blind arches, and a small third tower behind the wall between them (the three acorns of the name, each with a golden acorn on top).  The towers
// stand on the two circles of the OSM outline and on the wall between them (the old model put three towers on the farthest corners of the outline).
const THUENGEN = Object.freeze({ at: [5733, 8205], hideRadius: 70, hideMinArea: 300, wall: 8.5, bigHeight: 17, smallHeight: 14, batter: 1.1, foot: 8.5 });

/** A round fort tower: the battered dark foot, a corbel course, the pale upper drum with its arched frieze and slits, the lid and the golden acorn. */
function fortTower(soup, ground, at, r, height, key) {
  const K = THUENGEN, [x, z] = at;
  const high = Math.max(...Array.from({ length: 8 }, (_, i) => ground(x + Math.cos((i / 8) * TAU) * r, z + Math.sin((i / 8) * TAU) * r)));
  const yFoot = high + K.foot * (height / K.bigHeight), yTop = high + height;
  const yb = Math.min(ground(x, z), high) - SINK;
  soup.frustum(x, z, r + K.batter, r + 0.1, yb, yFoot, 16, paint(C.fortFoot, key, 0.06), { cap: false });             // the dark battered foot
  soup.frustum(x, z, r + 0.7, r + 0.7, yFoot - 0.2, yFoot + 0.7, 16, C.sandstoneLight, { cap: false });               // the corbel course
  soup.frustum(x, z, r, r, yFoot + 0.7, yTop, 16, paint(C.sandstone, key + 1, 0.04), { cap: false });                 // the pale drum
  for (let k = 0; k < 16; k++) {                                                                                      // the frieze of blind arches
    const a = (k / 16) * TAU + 0.2;
    soup.box(x + Math.cos(a) * (r + 0.04), yTop - 3.0, z + Math.sin(a) * (r + 0.04), 1.3, 2.4, 0.25, -a + Math.PI / 2, paint(C.sandstoneDark, key + k, 0.05));
  }
  for (let k = 0; k < 6; k++) {                                                                                       // the slits
    const a = (k / 6) * TAU + 0.5;
    soup.box(x + Math.cos(a) * (r + 0.05), yFoot - 3.0, z + Math.sin(a) * (r + 0.05), 0.5, 1.1, 0.3, -a + Math.PI / 2, C.blackGlass);
  }
  for (let y = yFoot + 1.6; y < yTop - 3.6; y += 1.1) soup.frustum(x, z, r + 0.03, r + 0.03, y, y + 0.1, 16, paint(C.sandstoneDark, Math.round(y * 9) + key, 0.04), { cap: false });   // the courses of the drum
  for (let y = yb + 1.3; y < yFoot - 0.5; y += 1.3) {                                                                  // the courses of the battered foot (rough, darker)
    const rr = r + 0.1 + (K.batter - 0.1) * (1 - (y - yb) / (yFoot - yb));
    soup.frustum(x, z, rr + 0.03, rr + 0.03, y, y + 0.12, 16, paint([0.30, 0.27, 0.22], Math.round(y * 7) + key, 0.05), { cap: false });
  }
  soup.frustum(x, z, r + 0.6, r + 0.6, yTop - 0.5, yTop + 0.3, 16, C.sandstoneLight, { cap: false });                  // the cornice
  soup.frustum(x, z, r + 0.5, r * 0.55, yTop + 0.3, yTop + 1.6, 16, C.slateGrey, { cap: true });                      // the low lid
  soup.frustum(x, z, 0.5, 0.3, yTop + 1.6, yTop + 2.7, 8, C.gold, { cap: true });                                     // the golden acorn
}

export function buildThuengen({ buildings, ground }) {
  const K = THUENGEN;
  const hidden = requireBlocks(buildings, 'Fort Thüngen', K.at[0], K.at[1], K.hideRadius, K.hideMinArea);
  const poly = FOOT.thuengen;
  const soup = new Soup();
  const { high } = groundRange(ground, poly);
  const yTop = high + K.wall;
  soup.prism(poly, bottomsOf(ground, poly), yTop, paint(C.sandstone, 5, 0.04), { topColor: C.paving });
  for (let e = 0; e < poly.length; e++) {
    const f = edgeFrame(poly, e);
    if (f.len < 3) continue;
    course(soup, f, yTop - 0.4, yTop + 1.1, 0.6, C.sandstoneLight, e);       // the parapet
    course(soup, f, high - 0.3, high + 2.2, 0.4, C.fortFoot, e + 5);          // the dark foot of the walls
    joints(soup, f, { y0: high + 2.2, y1: yTop - 0.4, rowH: 1.1, colW: 2.3, color: C.sandstoneDark, key: e * 101 });   // the ashlar of the curtain wall
    if (f.len > 9) for (let sc = 4.5; sc < f.len - 3; sc += 9) roundArch(soup, f, sc, high + 1.0, 1.9, 2.6, C.sandstoneLight, C.glassDark);   // the arched doors and windows of the museum
  }
  FORT_TOWERS.big.forEach((t, i) => fortTower(soup, ground, t.at, t.r, K.bigHeight, 40 + i * 5));
  fortTower(soup, ground, FORT_TOWERS.small.at, FORT_TOWERS.small.r, K.smallHeight, 60);
  return { soup, walls: edgeWalls(poly, 0.4, 'thuengen'), hideBuildings: hidden.map((b) => b.id), hideDecks: [], info: { blocks: hidden.length } };
}

/* ------------------------------------------------------------------------------------------------ Mudam */
// I. M. Pei's museum: ivory limestone volumes and, over the Grand Hall, an angular glass roof: a glass pyramid with a square glass lantern tower on its apex, a
// slanted glass wing and the long curved glass shell behind (the photographs).  The old model was a grey box with a plain gable of glass.
const MUDAM = Object.freeze({ wall: 11.5, hallHalf: 8.5, pyramidRise: 11, lantern: { half: 2.0, height: 8 }, wing: { length: 30, half: 6, rise: 10 } });

export function buildMudam({ ground }) {
  const K = MUDAM;
  const poly = FOOT.mudam;
  const soup = new Soup();
  const { high } = groundRange(ground, poly);
  const yTop = high + K.wall;
  soup.prism(poly, bottomsOf(ground, poly), yTop, paint(C.ivory, 7, 0.02), { topColor: C.concrete });
  for (let e = 0; e < poly.length; e++) {
    const f = edgeFrame(poly, e);
    if (f.len < 5) continue;
    course(soup, f, yTop - 0.5, yTop + 0.4, 0.5, C.white, e);
    joints(soup, f, { y0: high, y1: yTop - 0.5, rowH: 2.3, colW: 4.6, color: [0.62, 0.60, 0.52], key: e * 77, width: 0.17 });     // the big panels of the ivory limestone (grooves a hand wide)
    if (f.len > 20) windowGrid(soup, f, { s0: 3, s1: f.len - 3, y0: high + 6.5, rows: 1, floorH: 4.6, w: 5.0, h: 1.6, pitch: 9, frame: C.ivory, glass: C.glassTeal, key: e * 9 });   // a few long slits: the walls are mostly blank
  }
  const [cx, cz] = centroid(poly);
  let longest = 0, yaw = 0;
  for (let e = 0; e < poly.length; e++) { const f = edgeFrame(poly, e); if (f.len > longest) { longest = f.len; yaw = f.yaw; } }
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx, y, lz) => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
  const H = K.hallHalf, apex = yTop + K.pyramidRise;
  // the Grand Hall: a glass pyramid (four faces) ...
  const sq = [[-H, -H], [H, -H], [H, H], [-H, H]];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = sq[i], [bx, bz] = sq[(i + 1) % 4];
    soup.tri(P(ax, yTop, az), P(bx, yTop, bz), P(0, apex, 0), paint(C.glassTeal, 11 + i, 0.07));
    glazeTriangle(soup, P(ax, yTop, az), P(bx, yTop, bz), P(0, apex, 0), 8, 6, C.steelDark);
    soup.quad(P(ax, yTop - 0.01, az), P(bx, yTop - 0.01, bz), P(bx * 0.97, yTop + 0.9, bz * 0.97), P(ax * 0.97, yTop + 0.9, az * 0.97), C.steelDark);   // the dark sill
  }
  // ... the square glass lantern tower on its apex ...
  const Lh = K.lantern.half, yL = apex + K.lantern.height;
  const lq = [[-Lh, -Lh], [Lh, -Lh], [Lh, Lh], [-Lh, Lh]];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = lq[i], [bx, bz] = lq[(i + 1) % 4];
    soup.quad(P(ax, apex - 1, az), P(bx, apex - 1, bz), P(bx, yL, bz), P(ax, yL, az), paint(C.glassTeal, 21 + i, 0.07));
    glazeTriangle(soup, P(ax, apex - 1, az), P(bx, apex - 1, bz), P(bx, yL, bz), 4, 5, C.steelDark);
  }
  soup.pyramid(lq.map(([a, b]) => { const p = P(a, 0, b); return [p[0], p[2]]; }), yL, P(0, yL + 2.6, 0), C.glassDark);
  // ... a slanted glass wing leaning on the hall, and the long curved glass shell (a low barrel) beside it
  const W = K.wing;
  { const a1 = [P(H, yTop, -W.half), P(H + W.length, yTop, -W.half), P(H + W.length, yTop + W.rise, 0), P(H, yTop + W.rise * 1.5, 0)];
    const a2 = [P(H, yTop + W.rise * 1.5, 0), P(H + W.length, yTop + W.rise, 0), P(H + W.length, yTop, W.half), P(H, yTop, W.half)];
    soup.quad(...a1, paint(C.glassTeal, 31, 0.05)); soup.quad(...a2, paint(C.glassTeal, 32, 0.05));
    glazeQuad(soup, ...a1, 10, 5, C.steelDark); glazeQuad(soup, ...a2, 10, 5, C.steelDark); }
  soup.tri(P(H, yTop, -W.half), P(H, yTop + W.rise * 1.5, 0), P(H, yTop, W.half), C.ivory);
  for (let k = 0; k < 8; k++) {
    const l0 = -H - 4 - k * 2.6, l1 = l0 - 2.6, r0 = 2.0 + Math.sin((k / 8) * Math.PI) * 4, r1 = 2.0 + Math.sin(((k + 1) / 8) * Math.PI) * 4;
    const b1 = [P(l0, yTop, -10), P(l1, yTop, -10), P(l1, yTop + r1, 0), P(l0, yTop + r0, 0)], b2 = [P(l0, yTop + r0, 0), P(l1, yTop + r1, 0), P(l1, yTop, 10), P(l0, yTop, 10)];
    soup.quad(...b1, paint(C.glassTeal, 41 + k, 0.06)); soup.quad(...b2, paint(C.glassTeal, 51 + k, 0.06));
    glazeQuad(soup, ...b1, 2, 4, C.steelDark); glazeQuad(soup, ...b2, 2, 4, C.steelDark);
  }
  return { soup, walls: edgeWalls(poly, 0.4, 'mudam'), hideBuildings: [], hideDecks: [], treeFree: [{ poly, margin: FACADE_TREE_FREE }], info: { height: K.wall + K.pyramidRise + K.lantern.height + 2.6 } };
}

/* ------------------------------------------------------------------------------------------------ BCEE (Place de Metz) */
// The Spuerkeess: a long wing of sandstone under a steep slate roof, and the slender ROUND clock tower (stone, two clocks, a ring of small windows
// under a cornice) with a conical roof of green copper and four dormers.  The old model had a square tower with a black pyramid.
const BCEE = Object.freeze({ at: [4955, 9237], hideRadius: 40, hideMinArea: 800, eave: 21, floor: 4.6, towerHeight: 41, towerCap: 14, roofRise: 9, roofScale: 0.55 });

export function buildBcee({ buildings, ground }) {
  const K = BCEE;
  const hidden = requireBlocks(buildings, 'BCEE', K.at[0], K.at[1], K.hideRadius, K.hideMinArea);
  const soup = new Soup();
  for (const b of hidden) {
    const { high } = groundRange(ground, b.pts);
    const yEave = high + K.eave;
    soup.prism(b.pts, bottomsOf(ground, b.pts), yEave, paint(C.sandstone, b.id, 0.03), { top: false });
    const upper = scalePoly(b.pts, K.roofScale);
    for (let i = 0; i < b.pts.length; i++) {
      const j = (i + 1) % b.pts.length;
      soup.quad([b.pts[i][0], yEave, b.pts[i][1]], [b.pts[j][0], yEave, b.pts[j][1]], [upper[j][0], yEave + K.roofRise, upper[j][1]], [upper[i][0], yEave + K.roofRise, upper[i][1]], paint(C.slateRoof, i, 0.06));
    }
    soup.prism(upper, yEave + K.roofRise, yEave + K.roofRise + 0.1, C.slateRoof);
    for (let e = 0; e < b.pts.length; e++) {
      const f = edgeFrame(b.pts, e);
      if (f.len < 5) continue;
      course(soup, f, yEave - 0.6, yEave, 0.5, C.sandstoneLight, e);
      windowGrid(soup, f, { s0: 1.5, s1: f.len - 1.5, y0: high + 1.2, rows: 4, floorH: K.floor, w: 1.5, h: 2.6, pitch: 3.6, frame: C.sandstoneLight, glass: C.glassDark, key: e * 7 });
    }
  }
  // the clock tower: a round stone shaft with a clock on two faces, a ring of small windows under the cornice, the green copper cone with dormers
  const t = FOOT.bceeTower, [tx, tz] = centroid(t);
  const r = Math.max(...t.map((p) => Math.hypot(p[0] - tx, p[1] - tz))) * 0.96;
  const ring = Array.from({ length: 12 }, (_, i) => [tx + Math.cos((i / 12) * TAU) * r, tz + Math.sin((i / 12) * TAU) * r]);
  const { high } = groundRange(ground, ring);
  const yTop = high + K.towerHeight;
  soup.frustum(tx, tz, r + 0.4, r, Math.min(...ring.map(([x, z]) => ground(x, z))) - SINK, yTop - 3.5, 16, paint(C.towerStone, 11, 0.04), { cap: false });
  soup.frustum(tx, tz, r + 0.25, r + 0.25, high + 1.0, high + 2.2, 16, C.sandstoneDark, { cap: false });                       // a plinth course
  soup.frustum(tx, tz, r + 0.8, r + 0.8, yTop - 3.7, yTop - 3.0, 16, C.sandstoneLight, { cap: false });                       // the cornice under the belfry ring
  soup.frustum(tx, tz, r + 0.2, r + 0.2, yTop - 3.0, yTop - 0.6, 16, paint(C.towerStone, 12, 0.04), { cap: false });         // the ring of small windows
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    soup.box(tx + Math.cos(a) * (r + 0.22), yTop - 2.6, tz + Math.sin(a) * (r + 0.22), 0.5, 1.4, 0.2, -a + Math.PI / 2, C.glassDark);
  }
  for (const a of [0.9, 0.9 + Math.PI]) {                                                                                      // the two clock faces
    soup.box(tx + Math.cos(a) * (r + 0.12), yTop - 12, tz + Math.sin(a) * (r + 0.12), 3.2, 3.2, 0.25, -a + Math.PI / 2, C.clockFace);
  }
  soup.frustum(tx, tz, r + 1.1, r * 0.12, yTop - 0.6, yTop + K.towerCap, 16, paint(C.copperGreen, 13, 0.04), { cap: false });   // the green copper cone
  for (let k = 0; k < 4; k++) {                                                                                                // its four dormers
    const a = (k / 4) * TAU + Math.PI / 4, c = Math.cos(a), sn = Math.sin(a);
    const px = tx + c * (r + 0.1), pz = tz + sn * (r + 0.1);
    const Q = (u, y, v) => [px + c * v - sn * u, y, pz + sn * v + c * u];
    soup.tri(Q(-0.8, yTop + 0.8, 0.2), Q(0.8, yTop + 0.8, 0.2), Q(0, yTop + 3.0, 0.2), C.copperGreen);
    soup.quad(Q(-0.8, yTop + 0.8, 0.2), Q(0.8, yTop + 0.8, 0.2), Q(0.8, yTop + 0.8, 1.0), Q(-0.8, yTop + 0.8, 1.0), C.glassDark);
  }
  return { soup, walls: [...edgeWalls(ring, 0.3, 'bcee-tower'), ...hidden.flatMap((b) => edgeWalls(b.pts, 0.3, 'bcee'))], hideBuildings: hidden.map((b) => b.id), hideDecks: [], info: { blocks: hidden.length, tower: K.towerHeight + K.towerCap } };
}
