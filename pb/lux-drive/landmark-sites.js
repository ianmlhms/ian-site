/* The famous SITES of Luxembourg that are not a single block of the bake: the cliffs of the Bock with the walls of the fortress, the stone
 * viaduct (the Passerelle) over the Pétrusse, the Coque of Kirchberg, Fort Thüngen with its three towers, the Mudam and the clock tower of
 * the BCEE at the Place de Metz.  Same contract as landmark-buildings.js / landmark-bridges.js: each builder returns
 * { soup, walls, hideBuildings, hideDecks, info } and stands on the ground at every corner (nothing floats). */
import { Soup, axisFrame, paint, linspace } from './landmark-soup.js';
import { PALETTE as C } from './landmark-palette.js';
import { requireBlocks, edgeWalls, scalePoly, groundRange, decksAlong, pickDeck, wallFace, deckStrip, stationsOf } from './landmark-util.js';
import { edgeFrame, windowGrid, course, slab, turret, panel } from './landmark-facade.js';
import { SITE_FOOTPRINTS as FOOT } from './landmark-site-data.js';

const TAU = Math.PI * 2;
const SINK = 1.0;
const bottomsOf = (ground, pts) => pts.map((p) => ground(p[0], p[1]) - SINK);
const centroid = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];

/* ------------------------------------------------------------------------------------------------ Bock: cliffs and fortress walls */
const BOCK = Object.freeze({
  centre: [5540, 8738],          // m, on the plateau of the rock
  rays: 48, reach: 70, edgeDrop: 4,   // the edge of the cliff: the first point 4 m under the plateau
  maxSkin: 75, skinStep: 3.5, lift: 0.8, flatSlope: 0.3,   // the stone skin runs down until the slope is gentler than this (rise / run)
  bastionEvery: 6, parapet: 1.7, parapetThick: 1.3, casemates: 9,
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

export function buildBock({ ground }) {
  const K = BOCK;
  const soup = new Soup();
  const walls = [];
  const edge = cliffEdge(ground, K);
  const arcs = edge.map((e, i) => [e, edge[(i + 1) % edge.length]]).filter(([a, b]) => a && b);
  if (arcs.length < 8) throw new Error(`Bock: only ${arcs.length} cliff segments found around (${K.centre}): the plateau is not where it was measured`);
  // the skin of each ray: the points from the edge down the slope, lifted so the stone lies on the rock and never inside it
  const skinOf = (e) => {
    const pts = [];
    let prev = ground(e.x, e.z);
    for (let t = 0; t <= K.maxSkin; t += K.skinStep) {
      const x = e.x + e.dx * t, z = e.z + e.dz * t, y = ground(x, z);
      pts.push([x, y + K.lift, z]);
      if (t > 8 && (prev - y) / K.skinStep < K.flatSlope) break;
      prev = y;
    }
    return pts;
  };
  const skins = new Map(edge.map((e, i) => [i, e ? skinOf(e) : null]));
  let placed = 0;
  edge.forEach((e, i) => {
    const j = (i + 1) % edge.length;
    const sa = skins.get(i), sb = skins.get(j);
    if (!e || !edge[j]) return;
    const n = Math.min(sa.length, sb.length);
    for (let k = 0; k + 1 < n; k++) {
      const depth = k / Math.max(1, n - 2);
      // stone near the top, the grey rock of the Bock below: the courses vary per cell, so the wall reads as masonry
      const col = (key) => {
        const base = [C.sandstoneDark[0] * (1 - depth * 0.25), C.sandstoneDark[1] * (1 - depth * 0.22), C.sandstoneDark[2] * (1 - depth * 0.2)];
        return paint(base, i * 131 + k * 17 + key, 0.11);
      };
      soup.quad(sa[k], sb[k], sb[k + 1], sa[k + 1], col(0));
    }
    placed += 1;
  });
  // the parapet along the edge, and the round bastions
  const edgeIdx = edge.map((e, i) => (e ? i : -1)).filter((i) => i >= 0);
  edgeIdx.forEach((i, n) => {
    const e = edge[i], f = edge[(i + 1) % edge.length];
    if (f) {
      const y = Math.min(ground(e.x, e.z), ground(f.x, f.z));
      const len = Math.hypot(f.x - e.x, f.z - e.z), yaw = Math.atan2(-(f.z - e.z), f.x - e.x);
      soup.box((e.x + f.x) / 2 + e.dx * 0.5, y - 0.4, (e.z + f.z) / 2 + e.dz * 0.5, len, K.parapet + 0.4, K.parapetThick, yaw, paint(C.sandstone, i, 0.06), { topColor: C.sandstoneLight });
      walls.push({ ax: e.x, az: e.z, bx: f.x, bz: f.z, r: 0.9, id: 'bock-parapet' });
    }
    if (n % K.bastionEvery === 0) {
      const bx = e.x + e.dx * 4.5, bz = e.z + e.dz * 4.5;
      const yb = ground(bx + e.dx * 4, bz + e.dz * 4) - SINK, yt = ground(e.x, e.z) + 3.0;
      soup.frustum(bx, bz, 5.2, 4.4, yb, yt, 12, paint(C.sandstone, i + 3, 0.05), { capColor: C.sandstoneLight });
      soup.frustum(bx, bz, 4.7, 4.7, yt, yt + 1.3, 12, C.sandstoneLight, { cap: false });
    }
  });
  // the casemate openings: dark arched mouths in the skin, a few metres under the edge
  let door = 0;
  for (const i of edgeIdx) {
    if (door >= K.casemates || i % 5 !== 2) continue;
    const e = edge[i], s = skins.get(i), p = s[Math.min(s.length - 1, 3)];
    const px = -e.dz, pz = e.dx;
    const q = (u, y) => [p[0] + px * u + e.dx * 0.12, p[1] + y, p[2] + pz * u + e.dz * 0.12];
    soup.quad(q(-1.3, 0), q(1.3, 0), q(1.3, 2.6), q(-1.3, 2.6), C.blackGlass);
    soup.tri(q(-1.3, 2.6), q(1.3, 2.6), q(0, 3.9), C.blackGlass);
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
  const along = decksAlong(F, decks, 12, 25).filter((d) => Math.max(...d.tops) > road.tops[0] - 4 && Math.min(...d.tops) > road.tops[0] - 4);
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
  for (const d of along) for (const p of d.pts) { const [, u] = F.local(p[0], p[1]); half = Math.max(half, Math.min(Math.abs(u) + d.width / 2 + 0.3, K.maxHalf)); }
  const g = (s, u) => ground(...F.xz(s, u));
  const lowestGround = (s) => Math.min(g(s, -half), g(s, 0), g(s, half)) - SINK;
  const soup = new Soup();
  const walls = [];

  // the roadway, the pavements, the balustrades
  deckStrip(soup, F, -K.roadHalf, K.roadHalf, 0, L, top, C.asphalt, Math.ceil(L / 4), 1, 0.01);
  for (const sign of [1, -1]) {
    deckStrip(soup, F, sign * K.roadHalf, sign * half, 0, L, top, C.paving, Math.ceil(L / 4), 2, K.kerb);
    wallFace(soup, F, sign * half, 0, L, (s) => top(s) - 0.3, (s) => top(s) + K.balustrade, C.sandstoneLight, Math.ceil(L / 3), 3 + (sign > 0 ? 0 : 1));
    wallFace(soup, F, sign * (half - 0.5), 0, L, (s) => top(s) + K.kerb, (s) => top(s) + K.balustrade, C.sandstone, Math.ceil(L / 3), 6);
    deckStrip(soup, F, sign * (half - 0.5), sign * half, 0, L, (s) => top(s) + K.balustrade, C.sandstoneLight, Math.ceil(L / 3), 7);
    walls.push({ ax: F.xz(0, sign * (half - 0.4))[0], az: F.xz(0, sign * (half - 0.4))[1], bx: F.xz(L, sign * (half - 0.4))[0], bz: F.xz(L, sign * (half - 0.4))[1], r: 0.4, id: 'passerelle-rail' });
  }
  for (let s = 1; s < L; s += K.pitch) for (const sign of [1, -1]) {
    const [x, z] = F.xz(s, sign * (half - 0.25));
    soup.box(x, top(s), z, 0.8, K.balustrade + 0.5, 0.8, Math.atan2(-F.dz, F.dx), paint(C.sandstoneLight, Math.round(s) + 9), { topColor: C.sandstoneLight });
  }
  // the slab: fascia, cornice, underside
  deckStrip(soup, F, -half, half, 0, L, under, C.sandstoneDark, Math.ceil(L / 4), 20);
  for (const sign of [1, -1]) {
    wallFace(soup, F, sign * half, 0, L, under, (s) => top(s) - 0.3, C.sandstoneLight, Math.ceil(L / 3), 21);
    wallFace(soup, F, sign * (half + 0.3), 0, L, (s) => top(s) - 0.7, (s) => top(s) - 0.3, C.sandstone, Math.ceil(L / 3), 22);
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
        wallFace(soup, F, u, s0, sc - ho, (s) => g(s, u) - SINK, belt, C.sandstone, 2, b * 7 + 1);
        wallFace(soup, F, u, sc + ho, s1, (s) => g(s, u) - SINK, belt, C.sandstone, 2, b * 7 + 2);
        wallFace(soup, F, u, sc - ho, sc + ho, arch, belt, C.sandstoneDark, 6, b * 7 + 3);
        // the passage: the two sides of the pier and the vault, across the whole width
        for (const sv of [sc - ho, sc + ho]) soup.quad(F.at(sv, yb, -half), F.at(sv, yb, half), F.at(sv, spring, half), F.at(sv, spring, -half), paint(C.sandstoneDark, b + 91));
        const ss2 = linspace(sc - ho, sc + ho, 8);
        const vault = (uu) => ss2.map((s) => F.at(s, arch(s), uu));
        soup.strip(vault(-half), vault(half), paint(C.sandstoneDark, b + 5, 0.05));
        open += 1;
      } else {
        wallFace(soup, F, u, s0, s1, (s) => g(s, u) - SINK, belt, C.sandstone, 2, b * 7 + 4);
      }
      // upper tier: the wall over the arch and the pier faces; the opening floor is the belt slab
      const sillUp = belt(sc) + 1.0;
      const springUp = under(sc) - K.upperRadius - 1.4;
      const archUp = (s) => springUp + Math.sqrt(Math.max(0, K.upperRadius ** 2 - ((s - sc) / ho * K.upperRadius) ** 2));
      wallFace(soup, F, u, s0, sc - ho, belt, under, C.sandstoneLight, 2, b * 7 + 5);
      wallFace(soup, F, u, sc + ho, s1, belt, under, C.sandstoneLight, 2, b * 7 + 6);
      wallFace(soup, F, u, sc - ho, sc + ho, archUp, under, C.sandstoneLight, 6, b * 7 + 7);
      wallFace(soup, F, u, sc - ho, sc + ho, belt, (s) => sillUp, C.sandstone, 1, b * 7 + 8);
      for (const sv of [sc - ho, sc + ho]) soup.quad(F.at(sv, sillUp, -half), F.at(sv, sillUp, half), F.at(sv, springUp, half), F.at(sv, springUp, -half), paint(C.sandstone, b + 191));
      const ss3 = linspace(sc - ho, sc + ho, 8);
      const vaultUp = (uu) => ss3.map((s) => F.at(s, archUp(s), uu));
      soup.strip(vaultUp(-half), vaultUp(half), paint(C.sandstone, b + 55, 0.05));
      void sillUp;
    }
    // the belt course: a projecting stone band between the tiers
    wallFace(soup, F, u + sign * 0.25, 0, L, (s) => belt(s) - 0.35, (s) => belt(s) + 0.35, C.sandstoneLight, Math.ceil(L / 3), 40);
  }
  for (let b = 0; b < bays; b++) {         // the belt slab: the floor of the upper passages and the ceiling of the lower ones
    deckStrip(soup, F, -half, half, b * P, (b + 1) * P, belt, C.sandstoneDark, 2, 50 + b);
  }
  // the ends: closed so that nothing hollow shows
  for (const s of [0, L]) soup.quad(F.at(s, lowestGround(s), -half), F.at(s, lowestGround(s), half), F.at(s, under(s), half), F.at(s, under(s), -half), paint(C.sandstoneDark, 99));
  return { soup, walls, hideBuildings: [], hideDecks: along.map((d) => d.id), info: { bays, open, half: +half.toFixed(1), length: +L.toFixed(0) } };
}

/* ------------------------------------------------------------------------------------------------ Coque (Kirchberg) */
const COQUE = Object.freeze({ at: [6633, 7440], hideRadius: 90, hideMinArea: 300, wallHeight: 7.5, rise: 11, rings: 7, glassBottom: 1.4, glassTop: 5.6 });

export function buildCoque({ buildings, ground }) {
  const K = COQUE;
  const hidden = requireBlocks(buildings, 'Coque', K.at[0], K.at[1], K.hideRadius, K.hideMinArea);
  const poly = FOOT.coque;
  const soup = new Soup();
  const { high } = groundRange(ground, poly);
  const yRim = high + K.wallHeight;
  // the drum: a pale wall with a band of dark glass under the eaves, standing on the ground all round
  soup.prism(poly, bottomsOf(ground, poly), yRim, paint(C.concrete, 3, 0.02), { top: false });
  for (let e = 0; e < poly.length; e++) {
    const f = edgeFrame(poly, e);
    if (f.len < 3) continue;
    panel(soup, f, 0.4, f.len - 0.4, high + K.glassBottom, high + K.glassTop, 0.06, paint(C.glassDark, e, 0.05));
    course(soup, f, yRim - 0.5, yRim, 0.5, C.white, e);
  }
  // the low wide shell: concentric rings of the outline, drawn smaller and higher on a shallow curve
  const [cx, cz] = centroid(poly);
  const rings = Array.from({ length: K.rings + 1 }, (_, k) => {
    const s = 1 - k / K.rings;
    return { pts: scalePoly(poly, Math.max(s, 0.02)), y: yRim + 0.6 + K.rise * (1 - s * s) };
  });
  for (let k = 0; k < K.rings; k++) {
    const a = rings[k], b = rings[k + 1];
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      soup.quad([a.pts[i][0], a.y, a.pts[i][1]], [a.pts[j][0], a.y, a.pts[j][1]], [b.pts[j][0], b.y, b.pts[j][1]], [b.pts[i][0], b.y, b.pts[i][1]], paint(C.paleGlass, k * 3 + i % 3, 0.05));
    }
  }
  soup.prism(poly, yRim, yRim + 0.6, C.white, { top: false });
  void cx; void cz;
  return { soup, walls: edgeWalls(poly, 0.4, 'coque'), hideBuildings: hidden.map((b) => b.id), hideDecks: [], info: { blocks: hidden.length, rise: K.rise } };
}

/* ------------------------------------------------------------------------------------------------ Fort Thüngen (Dräi Eechelen) */
const THUENGEN = Object.freeze({ at: [5733, 8205], hideRadius: 70, hideMinArea: 300, wall: 8.5, towerR: 3.6, towerHeight: 15 });

/** Three points of a polygon as far from each other as they can be (farthest-point sampling): the places of the three towers. */
function farthestThree(poly) {
  const first = poly.reduce((m, p) => (p[1] < m[1] ? p : m), poly[0]);
  const far = (from) => poly.reduce((m, p) => (from.reduce((d, q) => Math.min(d, Math.hypot(p[0] - q[0], p[1] - q[1])), Infinity) > m.d ? { p, d: from.reduce((d, q) => Math.min(d, Math.hypot(p[0] - q[0], p[1] - q[1])), Infinity) } : m), { p: poly[0], d: -1 }).p;
  const second = far([first]);
  return [first, second, far([first, second])];
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
    course(soup, f, high - 0.3, high + 1.2, 0.4, C.sandstoneDark, e + 5);     // the plinth
  }
  // the three round towers (the three acorns of the name): a stone shaft, a ring of openings, a domed cap in dark metal
  for (const [i, p] of farthestThree(poly).entries()) {
    const yb = ground(p[0], p[1]) - SINK, yt = high + K.towerHeight;
    soup.frustum(p[0], p[1], K.towerR, K.towerR * 0.92, yb, yt, 14, paint(C.sandstone, i + 40, 0.04), { cap: false });
    soup.frustum(p[0], p[1], K.towerR + 0.4, K.towerR + 0.4, yt - 0.9, yt, 14, C.sandstoneLight, { cap: false });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + 0.4;
      soup.box(p[0] + Math.cos(a) * (K.towerR - 0.1), yt - 5.2, p[1] + Math.sin(a) * (K.towerR - 0.1), 0.9, 2.6, 0.5, -a + Math.PI / 2, C.glassDark);
    }
    const rings = [[K.towerR + 0.3, 0], [K.towerR * 0.95, 1.5], [K.towerR * 0.72, 2.7], [K.towerR * 0.4, 3.6], [0, 4.1]];
    for (let r = 0; r + 1 < rings.length; r++) soup.frustum(p[0], p[1], rings[r][0], rings[r + 1][0], yt + rings[r][1], yt + rings[r + 1][1], 14, C.slateGrey, { cap: false });
  }
  return { soup, walls: edgeWalls(poly, 0.4, 'thuengen'), hideBuildings: hidden.map((b) => b.id), hideDecks: [], info: { blocks: hidden.length } };
}

/* ------------------------------------------------------------------------------------------------ Mudam */
const MUDAM = Object.freeze({ wall: 11.5, hallHalf: 8.5, hallLength: 44, hallRise: 12 });

export function buildMudam({ ground }) {
  const K = MUDAM;
  const poly = FOOT.mudam;
  const soup = new Soup();
  const { high } = groundRange(ground, poly);
  const yTop = high + K.wall;
  // I. M. Pei's museum: pale limestone volumes, and the glass prism of the Grand Hall over the middle
  soup.prism(poly, bottomsOf(ground, poly), yTop, paint(C.limestone, 7, 0.02), { topColor: C.concrete });
  for (let e = 0; e < poly.length; e++) {
    const f = edgeFrame(poly, e);
    if (f.len < 5) continue;
    windowGrid(soup, f, { s0: 1.5, s1: f.len - 1.5, y0: high + 2.4, rows: 2, floorH: 4.6, w: 2.0, h: 3.0, pitch: 5.4, frame: C.limestone, glass: C.paleGlass, key: e * 9 });
    course(soup, f, yTop - 0.5, yTop + 0.4, 0.5, C.white, e);
  }
  const [cx, cz] = centroid(poly);
  let longest = 0, yaw = 0;
  for (let e = 0; e < poly.length; e++) { const f = edgeFrame(poly, e); if (f.len > longest) { longest = f.len; yaw = f.yaw; } }
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx, y, lz) => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
  const L = K.hallLength / 2, W = K.hallHalf;
  const ridge = yTop + K.hallRise;
  // the hall: two sloping glass roofs meeting in a ridge, stone gables
  soup.quad(P(-L, yTop, -W), P(L, yTop, -W), P(L, ridge, 0), P(-L, ridge, 0), paint(C.paleGlass, 1, 0.03));
  soup.quad(P(L, yTop, W), P(-L, yTop, W), P(-L, ridge, 0), P(L, ridge, 0), paint(C.paleGlass, 2, 0.03));
  soup.tri(P(-L, yTop, -W), P(-L, ridge, 0), P(-L, yTop, W), C.limestone);
  soup.tri(P(L, yTop, -W), P(L, yTop, W), P(L, ridge, 0), C.limestone);
  return { soup, walls: edgeWalls(poly, 0.4, 'mudam'), hideBuildings: [], hideDecks: [], info: { height: K.wall + K.hallRise } };
}

/* ------------------------------------------------------------------------------------------------ BCEE (Place de Metz) */
const BCEE = Object.freeze({ at: [4955, 9237], hideRadius: 40, hideMinArea: 800, eave: 21, floor: 4.6, towerHeight: 44, towerCap: 8 });

export function buildBcee({ buildings, ground }) {
  const K = BCEE;
  const hidden = requireBlocks(buildings, 'BCEE', K.at[0], K.at[1], K.hideRadius, K.hideMinArea);
  const soup = new Soup();
  for (const b of hidden) {
    const { high } = groundRange(ground, b.pts);
    const yEave = high + K.eave;
    soup.prism(b.pts, bottomsOf(ground, b.pts), yEave, paint(C.sandstone, b.id, 0.03), { top: false });
    const upper = scalePoly(b.pts, 0.72);
    for (let i = 0; i < b.pts.length; i++) {
      const j = (i + 1) % b.pts.length;
      soup.quad([b.pts[i][0], yEave, b.pts[i][1]], [b.pts[j][0], yEave, b.pts[j][1]], [upper[j][0], yEave + 5, upper[j][1]], [upper[i][0], yEave + 5, upper[i][1]], paint(C.slateGrey, i, 0.06));
    }
    soup.prism(upper, yEave + 5, yEave + 5.1, C.slateGrey);
    for (let e = 0; e < b.pts.length; e++) {
      const f = edgeFrame(b.pts, e);
      if (f.len < 5) continue;
      course(soup, f, yEave - 0.6, yEave, 0.5, C.sandstoneLight, e);
      windowGrid(soup, f, { s0: 1.5, s1: f.len - 1.5, y0: high + 1.2, rows: 4, floorH: K.floor, w: 1.5, h: 2.6, pitch: 3.6, frame: C.sandstoneLight, glass: C.glassDark, key: e * 7 });
    }
  }
  // the clock tower: a square stone shaft with a clock on every face, a belfry, a steep slate cap
  const t = FOOT.bceeTower, [tx, tz] = centroid(t);
  const half = Math.max(...t.map((p) => Math.hypot(p[0] - tx, p[1] - tz))) / Math.SQRT2 * 0.96;
  const sq = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([a, c]) => [tx + a, tz + c]);
  const { high } = groundRange(ground, sq);
  const yTop = high + K.towerHeight;
  soup.prism(sq, bottomsOf(ground, sq), yTop, paint(C.sandstone, 11, 0.03), { topColor: C.sandstoneLight });
  for (let e = 0; e < 4; e++) {
    const f = edgeFrame(sq, e);
    course(soup, f, high + 1, high + 2.4, 0.25, C.sandstoneDark, e);
    windowGrid(soup, f, { s0: 1, s1: f.len - 1, y0: high + 8, rows: 4, floorH: 6.4, w: 1.1, h: 2.6, pitch: 3.4, frame: C.sandstoneLight, glass: C.glassDark, key: e });
    slab(soup, f, f.len / 2 - 1.7, f.len / 2 + 1.7, yTop - 8, yTop - 4.6, 0.3, C.white, { topColor: C.white });     // the clock face
    panel(soup, f, f.len / 2 - 0.2, f.len / 2 + 0.2, yTop - 7.6, yTop - 5.0, 0.34, C.slateBlack);                   // its hands
    course(soup, f, yTop - 1.0, yTop, 0.5, C.sandstoneLight, e + 3);
  }
  soup.pyramid(scalePoly(sq, 1.12), yTop, [tx, yTop + K.towerCap, tz], C.slateBlack);
  return { soup, walls: [...edgeWalls(sq, 0.3, 'bcee-tower'), ...hidden.flatMap((b) => edgeWalls(b.pts, 0.3, 'bcee'))], hideBuildings: hidden.map((b) => b.id), hideDecks: [], info: { blocks: hidden.length, tower: K.towerHeight + K.towerCap } };
}
