/* The famous SITES of Luxembourg that are not a single block of the bake: the cliffs of the Bock with the walls of the fortress, the stone
 * viaduct (the Passerelle) over the Pétrusse, the Coque of Kirchberg, Fort Thüngen with its three towers, the Mudam and the clock tower of
 * the BCEE at the Place de Metz.  Same contract as landmark-buildings.js / landmark-bridges.js: each builder returns
 * { soup, walls, hideBuildings, hideDecks, info } and stands on the ground at every corner (nothing floats). */
import { Soup, axisFrame, paint, linspace } from './landmark-soup.js';
import { PALETTE as C } from './landmark-palette.js';
import { requireBlocks, edgeWalls, scalePoly, groundRange, decksAlong, pickDeck, wallFace, deckStrip, stationsOf } from './landmark-util.js';
import { edgeFrame, windowGrid, course, slab, turret, panel } from './landmark-facade.js';
import { SITE_FOOTPRINTS as FOOT, FORT_TOWERS } from './landmark-site-data.js';

const TAU = Math.PI * 2;
const SINK = 1.0;
const bottomsOf = (ground, pts) => pts.map((p) => ground(p[0], p[1]) - SINK);
const centroid = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];

/* ------------------------------------------------------------------------------------------------ Bock: cliffs and fortress walls */
// The Bock is a natural cliff of ochre and grey sandstone in rough bands, with a dark blue-grey fortress wall along its top edge (stepped, with a coping),
// a ruined square tower and a few dark casemate windows (the photographs).  The skin lies on the terrain: small facets, the colour in horizontal bands
// of the absolute height (strata), every vertex pushed out by a little noise so the rock is rough and never flat slabs.
const BOCK = Object.freeze({
  centre: [5540, 8738],          // m, on the plateau of the rock
  rays: 72, reach: 70, edgeDrop: 4,   // the edge of the cliff: the first point 4 m under the plateau
  maxSkin: 75, skinStep: 2.4, lift: 0.8, liftNoise: 0.9, flatSlope: 0.3,   // the stone skin runs down until the slope is gentler than this (rise / run)
  stratum: 1.7,                  // m: the height of one band of the rock
  wallHeight: 4.2, wallThick: 1.6, merlonEvery: 3.2, merlon: 1.1,
  bastionEvery: 12, casemates: 9,
  tower: { half: 3.4, height: 15 },
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

/** The colour of the rock at height y: a band of ochre or grey per stratum, a little darker the lower it lies (shade of the overhangs). */
function rockColour(y, key, depth) {
  const band = Math.floor(y / BOCK.stratum);
  const t = hash01(band, 7);                                  // one value per band: the strata run round the whole rock
  const base = [0, 1, 2].map((k) => C.rockGrey[k] + (C.rockOchre[k] - C.rockGrey[k]) * t);
  const shade = 1 - depth * 0.28;
  return paint([base[0] * shade, base[1] * shade, base[2] * shade], key, 0.09);
}

export function buildBock({ ground }) {
  const K = BOCK;
  const soup = new Soup();
  const walls = [];
  const edge = cliffEdge(ground, K);
  const arcs = edge.map((e, i) => [e, edge[(i + 1) % edge.length]]).filter(([a, b]) => a && b);
  if (arcs.length < 12) throw new Error(`Bock: only ${arcs.length} cliff segments found around (${K.centre}): the plateau is not where it was measured`);
  // the skin of each ray: the points from the edge down the slope, lifted so the stone lies on the rock and never inside it (the lift varies: rough rock)
  const skinOf = (e, ray) => {
    const pts = [];
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
  let placed = 0;
  edge.forEach((e, i) => {
    const j = (i + 1) % edge.length;
    const sa = skins.get(i), sb = skins.get(j);
    if (!e || !edge[j]) return;
    const n = Math.min(sa.length, sb.length);
    for (let k = 0; k + 1 < n; k++) {
      const depth = k / Math.max(1, n - 2);
      const ym = (sa[k][1] + sb[k + 1][1]) / 2;
      soup.quad(sa[k], sb[k], sb[k + 1], sa[k + 1], rockColour(ym, i * 131 + k * 17, depth));
    }
    placed += 1;
  });
  // the fortress wall along the edge: blue-grey masonry with a coping and merlons, standing on the rim of the rock
  const edgeIdx = edge.map((e, i) => (e ? i : -1)).filter((i) => i >= 0);
  edgeIdx.forEach((i, n) => {
    const e = edge[i], f = edge[(i + 1) % edge.length];
    if (!f) return;
    const y = Math.min(ground(e.x, e.z), ground(f.x, f.z));
    const len = Math.hypot(f.x - e.x, f.z - e.z), yaw = Math.atan2(-(f.z - e.z), f.x - e.x);
    const mx = (e.x + f.x) / 2 + e.dx * 0.6, mz = (e.z + f.z) / 2 + e.dz * 0.6;
    soup.box(mx, y - 0.6, mz, len, K.wallHeight + 0.6, K.wallThick, yaw, paint(C.fortWall, i, 0.07), { topColor: paint(C.fortWall, i + 3, 0.05) });
    soup.box(mx, y + K.wallHeight, mz, len, 0.35, K.wallThick + 0.4, yaw, paint(C.sandstoneDark, i + 9, 0.05), { topColor: C.sandstoneDark });     // the coping
    for (let m = K.merlonEvery / 2; m < len; m += K.merlonEvery) {                                                                                 // the merlons
      const px = e.x + ((f.x - e.x) * m) / len + e.dx * 0.6, pz = e.z + ((f.z - e.z) * m) / len + e.dz * 0.6;
      soup.box(px, y + K.wallHeight + 0.35, pz, K.merlon, 0.9, K.wallThick, yaw, paint(C.fortWall, i * 5 + Math.round(m), 0.06), { topColor: C.fortWall });
    }
    walls.push({ ax: e.x, az: e.z, bx: f.x, bz: f.z, r: 0.9, id: 'bock-parapet' });
    if (n % K.bastionEvery === 0) {
      const bx = e.x + e.dx * 4.0, bz = e.z + e.dz * 4.0;
      const yb = ground(bx + e.dx * 4, bz + e.dz * 4) - SINK, yt = ground(e.x, e.z) + 3.0;
      soup.frustum(bx, bz, 5.0, 4.4, yb, yt, 12, paint(C.fortWall, i + 3, 0.05), { capColor: C.sandstoneDark });
    }
  });
  // the ruined square tower on the rim of the rock (the medieval tower of the castle): grey-brown stone, two slits, a broken crenellated top
  const towerEdge = edge[edgeIdx[Math.floor(edgeIdx.length / 3)]];
  if (towerEdge) {
    const T = K.tower, tx = towerEdge.x - towerEdge.dx * (T.half + 1), tz = towerEdge.z - towerEdge.dz * (T.half + 1);
    const poly = [[-T.half, -T.half], [T.half, -T.half], [T.half, T.half], [-T.half, T.half]].map(([a, b]) => [tx + a, tz + b]);
    const base = ground(tx, tz), top = base + T.height;
    soup.prism(poly, bottomsOf(ground, poly), top, paint([0.50, 0.46, 0.38], 41, 0.05), { topColor: C.sandstoneDark });
    for (let e = 0; e < 4; e++) {
      const f = edgeFrame(poly, e);
      panel(soup, f, f.len / 2 - 0.3, f.len / 2 + 0.3, top - 8, top - 5.6, 0.05, C.blackGlass);
      for (let m = 0.8; m < f.len - 0.5; m += 2.0) if (hash01(e, Math.round(m)) > 0.3) slab(soup, f, m, m + 1.0, top, top + 1.1, 0.9, paint([0.50, 0.46, 0.38], e * 9 + Math.round(m), 0.06));
    }
  }
  // the casemate openings: dark arched mouths in the rock, a few metres under the edge
  let door = 0;
  for (const i of edgeIdx) {
    if (door >= K.casemates || i % 8 !== 3) continue;
    const e = edge[i], s = skins.get(i), p = s[Math.min(s.length - 1, 4)];
    const px = -e.dz, pz = e.dx;
    const q = (u, y) => [p[0] + px * u + e.dx * 0.12, p[1] + y, p[2] + pz * u + e.dz * 0.12];
    soup.quad(q(-1.0, 0), q(1.0, 0), q(1.0, 2.0), q(-1.0, 2.0), C.blackGlass);
    soup.tri(q(-1.0, 2.0), q(1.0, 2.0), q(0, 3.0), C.blackGlass);
    door += 1;
  }
  return { soup, walls, hideBuildings: [], hideDecks: [], info: { segments: placed, rays: arcs.length, openings: door } };
}

/* ------------------------------------------------------------------------------------------------ Passerelle (the stone viaduct) */
const PASSERELLE = Object.freeze({
  at: [5312, 9390],
  pitch: 9.3, pier: 3.0,            // m between the axes of the piers, the thickness of a pier
  beltDepth: 13.0,                  // m under the deck: the horizontal belt between the two tiers of arches
  upperRadius: 2.7, lowerRadius: 3.0,
  balustrade: 1.1, fascia: 1.3, kerb: 0.14,
  roadHalf: 5.9, maxHalf: 10.5,
});

export function buildPasserelle({ decks, ground }) {
  const K = PASSERELLE;
  const road = pickDeck(decks, K.at[0], K.at[1], { width: 11.8, tolerance: 0.6, minLength: 120 });
  const p0 = road.pts[0], p1 = road.pts[road.pts.length - 1];
  const F = axisFrame(p0[0], p0[1], p1[0], p1[1]);
  const L = F.length;
  // the decks of the bridge itself (the road and its footway); the lower footways of the bake that run along the slope stay as they are
  // (the footway decks beside the road ride on the bridge, but their pinned ends dip to the ground 10 m below: the MEDIAN of the tops tells a bridge deck from a path
  // down the slope.  They used to be left to the generic deck view and hung as grey slabs inside the arcade, seen through the openings.)
  const median = (a) => { const v = Array.from(a).sort((p, q) => p - q); return v[v.length >> 1]; };
  const inCorridor = (d) => d.pts.filter((p) => { const [s, u] = F.local(p[0], p[1]); return Math.abs(u) <= 12 && s >= -25 && s <= F.length + 25; }).length >= d.pts.length * 0.85;
  const along = decks.filter((d) => inCorridor(d) && median(d.tops) > road.tops[0] - 4);
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
  const belt = (s) => top(s) - K.beltDepth;
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
    walls.push({ ax: F.xz(0, sign * (half - 0.4))[0], az: F.xz(0, sign * (half - 0.4))[1], bx: F.xz(L, sign * (half - 0.4))[0], bz: F.xz(L, sign * (half - 0.4))[1], r: 0.4, id: 'passerelle-rail' });
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
  // the two-storey arcade: the bays, between the ends where the ground rises into the slope
  const bays = Math.max(4, Math.round(L / K.pitch));
  const P = L / bays;
  let open = 0;
  for (const sign of [1, -1]) {
    const u = sign * half;
    // the belt course and the solid walls above and below the openings, bay by bay
    for (let b = 0; b < bays; b++) {
      const sc = (b + 0.5) * P, ho = (P - K.pier) / 2;
      const s0 = b * P, s1 = (b + 1) * P;
      const lowOpen = lowestGround(sc) < belt(sc) - K.lowerRadius * 1.5;
      // lower tier: pier faces + the wall over the arch (or the whole wall when the ground is too high for an opening)
      if (lowOpen) {
        const yb = lowestGround(sc);
        const spring = belt(sc) - K.lowerRadius - 0.6;
        const arch = (s) => spring + Math.sqrt(Math.max(0, K.lowerRadius ** 2 - ((s - sc) / ho * K.lowerRadius) ** 2));
        wallFace(soup, F, u, s0, sc - ho, (s) => g(s, u) - SINK, belt, C.bridgeStone, 2, b * 7 + 1);
        wallFace(soup, F, u, sc + ho, s1, (s) => g(s, u) - SINK, belt, C.bridgeStone, 2, b * 7 + 2);
        wallFace(soup, F, u, sc - ho, sc + ho, arch, belt, C.bridgeStoneDark, 6, b * 7 + 3);
        // the passage: the two sides of the pier and the vault, across the whole width
        for (const sv of [sc - ho, sc + ho]) soup.quad(F.at(sv, yb, -half), F.at(sv, yb, half), F.at(sv, spring, half), F.at(sv, spring, -half), paint(C.bridgeStoneDark, b + 91));
        const ss2 = linspace(sc - ho, sc + ho, 8);
        const vault = (uu) => ss2.map((s) => F.at(s, arch(s), uu));
        soup.strip(vault(-half), vault(half), paint(C.bridgeStoneDark, b + 5, 0.05));
        open += 1;
      } else {
        wallFace(soup, F, u, s0, s1, (s) => g(s, u) - SINK, belt, C.bridgeStone, 2, b * 7 + 4);
      }
      // upper tier: the wall over the arch and the pier faces; the opening floor is the belt slab
      const sillUp = belt(sc) + 1.0;
      const springUp = under(sc) - K.upperRadius - 1.4;
      const archUp = (s) => springUp + Math.sqrt(Math.max(0, K.upperRadius ** 2 - ((s - sc) / ho * K.upperRadius) ** 2));
      wallFace(soup, F, u, s0, sc - ho, belt, under, C.bridgeStoneLight, 2, b * 7 + 5);
      wallFace(soup, F, u, sc + ho, s1, belt, under, C.bridgeStoneLight, 2, b * 7 + 6);
      wallFace(soup, F, u, sc - ho, sc + ho, archUp, under, C.bridgeStoneLight, 6, b * 7 + 7);
      wallFace(soup, F, u, sc - ho, sc + ho, belt, (s) => sillUp, C.bridgeStone, 1, b * 7 + 8);
      for (const sv of [sc - ho, sc + ho]) soup.quad(F.at(sv, sillUp, -half), F.at(sv, sillUp, half), F.at(sv, springUp, half), F.at(sv, springUp, -half), paint(C.bridgeStone, b + 191));
      const ss3 = linspace(sc - ho, sc + ho, 8);
      const vaultUp = (uu) => ss3.map((s) => F.at(s, archUp(s), uu));
      soup.strip(vaultUp(-half), vaultUp(half), paint(C.bridgeStone, b + 55, 0.05));
      void sillUp;
    }
    // the belt course: a projecting stone band between the tiers
    wallFace(soup, F, u + sign * 0.25, 0, L, (s) => belt(s) - 0.35, (s) => belt(s) + 0.35, C.bridgeStoneLight, Math.ceil(L / 3), 40);
  }
  for (let b = 0; b < bays; b++) {         // the belt slab: the floor of the upper passages and the ceiling of the lower ones
    deckStrip(soup, F, -half, half, b * P, (b + 1) * P, belt, C.bridgeStoneDark, 2, 50 + b);
  }
  // the ends: closed so that nothing hollow shows
  for (const s of [0, L]) soup.quad(F.at(s, lowestGround(s), -half), F.at(s, lowestGround(s), half), F.at(s, under(s), half), F.at(s, under(s), -half), paint(C.bridgeStoneDark, 99));
  return { soup, walls, hideBuildings: [], hideDecks: along.map((d) => d.id), info: { bays, open, half: +half.toFixed(1), length: +L.toFixed(0) } };
}

/* ------------------------------------------------------------------------------------------------ Coque (Kirchberg) */
// The Coque (the shell) of Kirchberg: an elliptical hall under a thick dark roof that curves up like an upturned hull and overhangs a band of teal glass.
// The old model had a flat rim and a pale low shell: nobody could tell it from a warehouse.
const COQUE = Object.freeze({ at: [6633, 7440], hideRadius: 90, hideMinArea: 300, wallHeight: 7.5, rise: 13, rings: 9, glassBottom: 1.2, glassTop: 6.0, overhang: 1.035 });

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
    for (let m = 3; m < f.len - 1; m += 3.2) panel(soup, f, m - 0.07, m + 0.07, high + K.glassBottom, high + K.glassTop, 0.09, C.steelDark);   // the mullions
  }
  // the overhanging rim of the roof: a thick dark band all round
  const rim = scalePoly(poly, K.overhang);
  soup.prism(rim, yRim - 0.2, yRim + 1.6, C.roofDark, { topColor: C.roofDark });
  // the shell: concentric rings of the outline, drawn smaller and higher on a steep curve (an upturned hull)
  const rings = Array.from({ length: K.rings + 1 }, (_, k) => {
    const s = 1 - k / K.rings;
    return { pts: scalePoly(rim, Math.max(s, 0.03)), y: yRim + 1.6 + K.rise * (1 - Math.pow(s, 2.2)) };
  });
  for (let k = 0; k < K.rings; k++) {
    const a = rings[k], b = rings[k + 1];
    for (let i = 0; i < rim.length; i++) {
      const j = (i + 1) % rim.length;
      soup.quad([a.pts[i][0], a.y, a.pts[i][1]], [a.pts[j][0], a.y, a.pts[j][1]], [b.pts[j][0], b.y, b.pts[j][1]], [b.pts[i][0], b.y, b.pts[i][1]], paint(C.roofDark, k * 3 + i % 3, 0.07));
    }
  }
  return { soup, walls: edgeWalls(poly, 0.4, 'coque'), hideBuildings: hidden.map((b) => b.id), hideDecks: [], info: { blocks: hidden.length, rise: K.rise } };
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
  }
  FORT_TOWERS.big.forEach((t, i) => fortTower(soup, ground, t.at, t.r, K.bigHeight, 40 + i * 5));
  fortTower(soup, ground, FORT_TOWERS.small.at, FORT_TOWERS.small.r, K.smallHeight, 60);
  return { soup, walls: edgeWalls(poly, 0.4, 'thuengen'), hideBuildings: hidden.map((b) => b.id), hideDecks: [], info: { blocks: hidden.length } };
}

/* ------------------------------------------------------------------------------------------------ Mudam */
// I. M. Pei's museum: ivory limestone volumes and, over the Grand Hall, an angular glass roof: a glass pyramid with a square glass lantern tower on its apex, a
// slanted glass wing and the long curved glass shell behind (the photographs).  The old model was a grey box with a plain gable of glass.
const MUDAM = Object.freeze({ wall: 11.5, hallHalf: 8.5, pyramidRise: 11, lantern: { half: 2.0, height: 8 }, wing: { length: 30, half: 6, rise: 7 } });

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
    soup.quad(P(ax, yTop - 0.01, az), P(bx, yTop - 0.01, bz), P(bx * 0.97, yTop + 0.9, bz * 0.97), P(ax * 0.97, yTop + 0.9, az * 0.97), C.steelDark);   // the dark sill
  }
  // ... the square glass lantern tower on its apex ...
  const Lh = K.lantern.half, yL = apex + K.lantern.height;
  const lq = [[-Lh, -Lh], [Lh, -Lh], [Lh, Lh], [-Lh, Lh]];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = lq[i], [bx, bz] = lq[(i + 1) % 4];
    soup.quad(P(ax, apex - 1, az), P(bx, apex - 1, bz), P(bx, yL, bz), P(ax, yL, az), paint(C.glassTeal, 21 + i, 0.07));
  }
  soup.pyramid(lq.map(([a, b]) => { const p = P(a, 0, b); return [p[0], p[2]]; }), yL, P(0, yL + 2.6, 0), C.glassDark);
  // ... a slanted glass wing leaning on the hall, and the long curved glass shell (a low barrel) beside it
  const W = K.wing;
  soup.quad(P(H, yTop, -W.half), P(H + W.length, yTop, -W.half), P(H + W.length, yTop + W.rise, 0), P(H, yTop + W.rise * 1.5, 0), paint(C.glassTeal, 31, 0.05));
  soup.quad(P(H, yTop + W.rise * 1.5, 0), P(H + W.length, yTop + W.rise, 0), P(H + W.length, yTop, W.half), P(H, yTop, W.half), paint(C.glassTeal, 32, 0.05));
  soup.tri(P(H, yTop, -W.half), P(H, yTop + W.rise * 1.5, 0), P(H, yTop, W.half), C.ivory);
  for (let k = 0; k < 8; k++) {
    const l0 = -H - 4 - k * 2.6, l1 = l0 - 2.6, r0 = 2.0 + Math.sin((k / 8) * Math.PI) * 4, r1 = 2.0 + Math.sin(((k + 1) / 8) * Math.PI) * 4;
    soup.quad(P(l0, yTop, -10), P(l1, yTop, -10), P(l1, yTop + r1, 0), P(l0, yTop + r0, 0), paint(C.glassTeal, 41 + k, 0.06));
    soup.quad(P(l0, yTop + r0, 0), P(l1, yTop + r1, 0), P(l1, yTop, 10), P(l0, yTop, 10), paint(C.glassTeal, 51 + k, 0.06));
  }
  return { soup, walls: edgeWalls(poly, 0.4, 'mudam'), hideBuildings: [], hideDecks: [], info: { height: K.wall + K.pyramidRise + K.lantern.height + 2.6 } };
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
