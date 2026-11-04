/* The bridges of Luxembourg as hand-made low-poly models: the Pont Adolphe (the stone double arch over the Pétrusse and the
 * cycle footbridge hung beside it) and the Pont Grande-Duchesse Charlotte ("Pont Rouge", the red steel bridge to Kirchberg).
 *
 * A bridge is built AROUND the deck of the bake: the drivable surface (decks.bin, read by the physics) is the road surface
 * of the model, so the car and the mesh can never disagree; the arch / the steel structure carries it, and the valley stays
 * open under it.  Every model returns { soup, walls, hideDecks }: the faces, the collision walls (the car must not drive
 * off the deck: the baked deck is narrower than the real one) and the ids of the baked decks the model replaces. */
import { Soup, axisFrame, paint } from './landmark-soup.js';
import { PALETTE as C } from './landmark-palette.js';
import { profileOf, pickDeck, decksAlong, wallFace, deckStrip } from './landmark-util.js';

/* ------------------------------------------------------------------------------------------------ Pont Adolphe */
const ADOLPHE = Object.freeze({
  at: [4829, 9101],               // m, a point of the road deck (decks.bin: the 8.4 m wide deck of 155 m)
  half: 8.5,                      // m, half the width of the bridge (17 m between the balustrades)
  roadHalf: 4.4,                  // m, half the carriageway
  kerb: 0.14,                     // m, the pavement stands this far above the road
  fascia: 1.3,                    // m, the depth of the slab edge (the stone band under the pavement)
  span: 84.65,                    // m, the span of the great arch (the real one)
  crownRing: 3.0,                 // m, the thickness of the arch ring at the crown ...
  springRing: 4.6,                // m, ... and at the springing
  clearCrown: 4.0,                // m of solid between the extrados and the slab at the crown
  openingHalf: 1.6,               // m, half the width of an opening of the spandrel arcade (3.2 m: the photographs)
  openingPitch: 5.6,              // m between the middles of two openings
  openingCount: 14,               // openings are tried this far either side of the crown; only the tall ones over the springing and the abutments are kept
  openingMinHeight: 5.0,          // m of wall the opening needs between the arch (or the ground) and its springing line
  wallThickness: 1.4,             // m, the thickness of the spandrel wall (the jambs of the openings)
  balustrade: 1.1,                // m, the height of the stone balustrade
  pillarEvery: 7.5,               // m, a taller pillar in the balustrade
  lampEvery: 22,                  // m, a lamp post
  guardOffset: 5.4,               // m, the collision walls of the deck (the car stays on the 8.4 m wide deck)
  guardRadius: 0.4,
  footbridgeHalf: 1.6,            // m, half the width of the cycle footbridge
  bracketEvery: 14,               // m between the brackets that carry the footbridge
});

/** The point of the axis where the valley is lowest: the middle of the great arch stands over it. */
function valleyMiddle(frame, ground, from, to) {
  let best = from, low = Infinity;
  for (let s = from; s <= to; s += 1) {
    const [x, z] = frame.xz(s, 0);
    const g = ground(x, z);
    if (g < low) { low = g; best = s; }
  }
  return best;
}

/** A polyline of 3D points moved sideways by u (the left of its direction) and up by dy. */
function offsetPath(path, u, dy = 0) {
  return path.map((p, i) => {
    const q = path[Math.min(path.length - 1, i + 1)], o = path[Math.max(0, i - 1)];
    let dx = q[0] - o[0], dz = q[2] - o[2];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    return [p[0] - dz * u, p[1] + dy, p[2] + dx * u];
  });
}

export function buildPontAdolphe({ decks, ground }) {
  const K = ADOLPHE;
  const road = pickDeck(decks, K.at[0], K.at[1], { width: 8.4, minLength: 100 });
  const p0 = road.pts[0], p1 = road.pts[road.pts.length - 1];
  const F = axisFrame(p0[0], p0[1], p1[0], p1[1]);
  const L = F.length;
  const top = profileOf(F, road);                                   // the surface the car drives on
  const under = (s) => top(s) - K.fascia;                          // the underside of the slab
  const g = (s, u) => ground(...F.xz(s, u));
  const soup = new Soup();

  // ---- the great arch: the span of the real bridge, centred over the lowest point of the valley, springing from the slopes
  const sc = valleyMiddle(F, ground, L * 0.25, L * 0.75);
  const hs = K.span / 2;
  const sa = sc - hs, sb = sc + hs;
  const springY = Math.min(g(sa, 0), g(sb, 0));
  const crownRise = under(sc) - K.clearCrown - K.crownRing - springY;
  if (crownRise < 8) throw new Error(`Pont Adolphe: the arch has no room (rise ${crownRise.toFixed(1)} m)`);
  const intrados = (s) => {
    const t = (s - sc) / hs;
    return springY + crownRise * Math.sqrt(Math.max(0, 1 - t * t));
  };
  const ring = (s) => K.crownRing + (K.springRing - K.crownRing) * Math.min(1, ((s - sc) / hs) ** 2);
  const extrados = (s) => intrados(s) + ring(s);

  const SIGNS = [1, -1];
  const STEP = 40;

  // ---- the roadway
  const asphalt = (s0, s1, u0, u1) => deckStrip(soup, F, u0, u1, s0, s1, top, C.asphalt, Math.ceil((s1 - s0) / 3), 1, 0.01);
  asphalt(0, L, -K.roadHalf, K.roadHalf);
  for (const sign of [1, -1]) {
    // the pavement, a little higher than the road, with the kerb face between them
    deckStrip(soup, F, sign * K.roadHalf, sign * (K.half - 0.5), 0, L, top, C.paving, Math.ceil(L / 3), 2 + (sign > 0 ? 0 : 1), K.kerb);
    wallFace(soup, F, sign * K.roadHalf, 0, L, (s) => top(s), (s) => top(s) + K.kerb, C.bridgeStoneDark, Math.ceil(L / 4), 5);
  }
  for (let s = 3; s + 3 < L; s += 9) {                                // the dashed centre line
    deckStrip(soup, F, -0.09, 0.09, s, s + 3, top, C.line, 1, 7, 0.02);
  }

  // ---- the balustrades, their pillars and the lamps
  for (const sign of SIGNS) {
    const inner = sign * (K.half - 0.5), outer = sign * K.half;
    const base = (s) => top(s) + K.kerb;
    wallFace(soup, F, outer, 0, L, base, (s) => base(s) + K.balustrade, C.bridgeStoneLight, Math.ceil(L / 4), 11);
    wallFace(soup, F, inner, 0, L, base, (s) => base(s) + K.balustrade, C.bridgeStone, Math.ceil(L / 4), 12);
    deckStrip(soup, F, inner, outer, 0, L, (s) => base(s) + K.balustrade, C.bridgeStoneLight, Math.ceil(L / 4), 13);
    for (let s = 2; s < L - 1; s += K.pillarEvery) {
      const [x, z] = F.xz(s, (inner + outer) / 2);
      soup.box(x, base(s), z, 0.9, K.balustrade + 0.55, 1.0, Math.atan2(-F.dz, F.dx), paint(C.bridgeStoneLight, Math.round(s) + 40), { topColor: C.bridgeStoneLight });
    }
    for (let s = 10; s < L - 8; s += K.lampEvery) {
      const [x, z] = F.xz(s, sign * (K.half - 0.45));
      const y = base(s);
      soup.box(x, y, z, 0.2, 4.3, 0.2, 0, C.lampGreen);
      soup.box(x, y + 4.3, z, 0.55, 0.55, 0.55, 0, C.lampLight, { topColor: C.lampGreen });
    }
  }

  // ---- the slab: the fascia on both sides, the cornice that overhangs it, and the underside
  const SLAB_STEP = Math.ceil(L / 3);
  deckStrip(soup, F, -K.half, K.half, 0, L, under, C.bridgeStoneDark, SLAB_STEP, 20);
  for (const sign of SIGNS) {
    wallFace(soup, F, sign * K.half, 0, L, under, (s) => top(s) - 0.45, C.bridgeStoneLight, SLAB_STEP, 21);
    // the cornice: a ledge over the fascia
    const out = sign * (K.half + 0.3);
    wallFace(soup, F, out, 0, L, (s) => top(s) - 0.45, top, C.bridgeStone, SLAB_STEP, 22);
    deckStrip(soup, F, sign * K.half, out, 0, L, (s) => top(s) - 0.45, C.bridgeStoneDark, SLAB_STEP, 23);
    deckStrip(soup, F, sign * (K.half - 0.5), out, 0, L, top, C.bridgeStoneLight, SLAB_STEP, 24, K.kerb * 0);
  }

  // ---- the approach abutments: their side walls are the same spandrel wall as the arcade (drawn below, with its openings), closed at the ends so nothing hollow shows
  for (const [s, dir] of [[sa, 1], [sb, -1]]) {
    // the end wall of the abutment, facing the arch, down to the lowest ground across its width
    const low = Math.min(...[-K.half, -K.half / 2, 0, K.half / 2, K.half].map((u) => g(s, u))) - 1.2;
    soup.quad(F.at(s, low, -K.half), F.at(s, low, K.half), F.at(s, springY, K.half), F.at(s, springY, -K.half), paint(C.bridgeStoneDark, 77));
    void dir;
  }

  // ---- the arch ring (voussoirs), the soffit, the spandrel wall with its arcade
  const archSteps = 64;
  for (const sign of SIGNS) {
    wallFace(soup, F, sign * K.half, sa, sb, intrados, extrados, C.bridgeStoneLight, archSteps, 40);
  }
  for (let i = 0; i < archSteps; i++) {                             // the soffit: the underside of the arch
    const s0 = sa + (K.span * i) / archSteps, s1 = sa + (K.span * (i + 1)) / archSteps;
    soup.quad(F.at(s0, intrados(s0), -K.half), F.at(s1, intrados(s1), -K.half), F.at(s1, intrados(s1), K.half), F.at(s0, intrados(s0), K.half), paint(C.bridgeStoneDark, 50 + i, 0.05));
  }
  // the openings of the arcade (centres relative to the crown): tall arches over the springing of the great arch AND over the abutments, none where the
  // arch comes close to the slab (the crown is solid: the photographs show four openings on each side and a plain wall between the two groups)
  const floorAt = (s) => (s >= sa && s <= sb ? extrados(s) : Math.max(g(s, -K.half), g(s, 0), g(s, K.half)) + 0.4);
  const openings = [];
  for (let k = -K.openingCount; k <= K.openingCount; k++) {
    const sk = sc + k * K.openingPitch;
    const left = sk - K.openingHalf, right = sk + K.openingHalf;
    if (left < 2 || right > L - 2) continue;
    if ((left < sa && right > sa) || (left < sb && right > sb)) continue;       // an opening never straddles the springing line
    const springLine = under(sk) - 0.8 - K.openingHalf;
    const floor = Math.max(floorAt(left), floorAt(right), floorAt(sk));
    if (springLine - floor < K.openingMinHeight) continue;
    openings.push({ sk, springLine, floor });
  }
  const head = (o, s) => o.springLine + Math.sqrt(Math.max(0, K.openingHalf ** 2 - (s - o.sk) ** 2));
  for (const sign of SIGNS) {
    let cursor = 0;
    const bottomOf = (s) => (s >= sa && s <= sb ? extrados(s) : g(s, sign * K.half) - 1.2);   // the wall stands on the arch, or on the ground beside it
    const wall = (s0, s1, lower, steps) => wallFace(soup, F, sign * K.half, s0, s1, lower, under, C.bridgeStone, steps, 60);
    for (const o of openings) {
      const left = o.sk - K.openingHalf, right = o.sk + K.openingHalf;
      wall(cursor, left, bottomOf, Math.max(1, Math.ceil((left - cursor) / 2)));
      wall(left, right, (s) => Math.max(floorAt(s), head(o, s)), 10);
      // the jambs and the soffit of the opening, so the wall has the thickness it really has
      const inner = sign * (K.half - K.wallThickness);
      for (const s of [left, right]) {
        soup.quad(F.at(s, o.floor, sign * K.half), F.at(s, o.floor, inner), F.at(s, o.springLine, inner), F.at(s, o.springLine, sign * K.half), paint(C.bridgeStoneDark, 90));
      }
      for (let i = 0; i < 10; i++) {
        const s0 = left + ((right - left) * i) / 10, s1 = left + ((right - left) * (i + 1)) / 10;
        soup.quad(F.at(s0, head(o, s0), sign * K.half), F.at(s1, head(o, s1), sign * K.half), F.at(s1, head(o, s1), inner), F.at(s0, head(o, s0), inner), paint(C.bridgeStoneDark, 91 + i));
      }
      cursor = right;
    }
    wall(cursor, L, bottomOf, Math.max(1, Math.ceil((sb - cursor) / 2)));
  }

  // ---- the cycle footbridge hung beside the bridge, with the brackets that carry it
  const hideDecks = new Set(decksAlong(F, decks, 14).map((d) => d.id));
  const foot = decks.find((d) => hideDecks.has(d.id) && d.width < 3.5 && Math.abs(F.local(...d.pts[d.pts.length >> 1])[1]) > 9);
  if (foot) {
    const path = foot.pts.map((p, i) => [p[0], foot.tops[i], p[1]]);
    soup.beam(path, K.footbridgeHalf * 2, 0.5, paint(C.steelGrey, 3));
    for (const u of [K.footbridgeHalf - 0.06, -K.footbridgeHalf + 0.06]) {
      const rail = offsetPath(path, u, 1.1);
      soup.beam(rail, 0.07, 0.07, C.steelDark);
      for (let i = 0; i < path.length; i += 2) {
        const [x, y, z] = offsetPath(path, u)[i];
        soup.box(x, y, z, 0.06, 1.1, 0.06, 0, C.steelDark);
      }
    }
    const yaw = Math.atan2(-F.sz, F.sx);                              // the local x of a box along the lateral axis
    for (let s = K.bracketEvery / 2; s < L - 4; s += K.bracketEvery) {
      const i = foot.pts.findIndex((p) => F.local(p[0], p[1])[0] >= s);
      if (i < 0) continue;
      const [fs, fu] = F.local(foot.pts[i][0], foot.pts[i][1]);
      const y = foot.tops[i] - 0.5;
      const u0 = K.half - 0.2, u1 = fu - K.footbridgeHalf;
      const [cx, cz] = F.xz(fs, (u0 + u1) / 2);
      soup.box(cx, y - 0.2, cz, u1 - u0, 0.8, 0.5, yaw, C.steelGrey);
    }
  }

  // ---- the collision walls: the car stays on the baked deck (the model is wider than the deck it stands on)
  const walls = SIGNS.map((sign) => {
    const [ax, az] = F.xz(0, sign * K.guardOffset);
    const [bx, bz] = F.xz(L, sign * K.guardOffset);
    return { ax, az, bx, bz, r: K.guardRadius, id: 'pont-adolphe' };
  });
  return { soup, walls, hideDecks, frame: F, info: { sc, sa, sb, springY, crownRise, openings: openings.length } };
}


/* ------------------------------------------------------------------------------------------------ Pont Rouge */
const ROUGE = Object.freeze({
  at: [5179, 8061],               // m, the middle of the four baked decks of the bridge (357 m long)
  minLength: 300,                 // m, the decks of the bridge are this long (the bridges around are shorter)
  extendStep: 4,                  // m, the baked ends are pinned to the cliff under the bridge: they are carried on to the approach road in steps of this
  extendMax: 80,                  // m, ... at most this far
  extendClear: 1.5,               // m, the approach road is found where the ground comes within this of the deck level
  slab: 0.9,                      // m, the deck slab
  girderTopHalf: 4.5,             // m, half the width of the steel box girder under the slab ...
  girderBottomHalf: 3.0,          // m, ... and at its bottom
  girderDepth: 3.4,               // m, the depth of the girder in the span
  girderDepthPylon: 6.6,          // m, ... and over a pylon
  haunch: 45,                     // m, the girder is deep this far either side of a pylon
  finEvery: 6,                    // m, the struts under the cantilevers
  pylonAt: [0.24, 0.78],          // the pylons stand at these shares of the length of the bridge
  legAlong: 3.4,                  // m, the legs of a pylon are this long along the bridge ...
  legAcross: 2.2,                 // m, ... and this wide at the top
  legBaseScale: 0.62,             // the legs taper to this share of their size at the foot
  legFootHalf: 1.8,               // m, the foot of a leg stands this far either side of the axis of the girder
  legTopHalf: 7.2,                // m, ... and the head of the leg this far (the legs spread: a V)
  abutmentEast: 24,               // m of abutment along the bridge from the baked start ...
  abutmentWest: 24,               // ... and from the baked end
  railing: 1.25,                  // m, the height of the steel railing
  mastEvery: 36,                  // m between the masts of the tram
  mastHeight: 7.0,
  guardNorth: 5.4, guardSouth: -15.4, guardFar: 12.4, guardRadius: 0.4,   // the collision walls (u from the road deck)
  roadNorth: 4.2, roadSouth: -12.3, bedNorth: 8.4,                        // the layout of the surface (u from the road deck)
});

/** The ends of a baked deck are pinned to the ground under them, and under the Pont Rouge that is the cliff 12 m below the
 *  deck: the deck would start with a ramp of 27 degrees.  The ends are carried on to where the approach road is. */
function extendEnd(deck, atStart, surfaceHeight) {
  const K = ROUGE;
  const n = deck.pts.length;
  const e = atStart ? 0 : n - 1, inner = atStart ? 3 : n - 4;
  const [ex, ez] = deck.pts[e], [ix, iz] = deck.pts[inner];
  const l = Math.hypot(ex - ix, ez - iz) || 1;
  const vx = (ex - ix) / l, vz = (ez - iz) / l;
  const ref = deck.tops[inner];
  for (let t = K.extendStep; t <= K.extendMax; t += K.extendStep) {
    const qx = ex + vx * t, qz = ez + vz * t;
    const g = surfaceHeight(qx, qz);
    if (g < ref - K.extendClear) continue;
    const added = [], addedTops = [];
    for (let u = t; u > 0; u -= K.extendStep) {
      added.push([ex + vx * u, ez + vz * u]);
      addedTops.push(ref + (g - ref) * (u / t));
    }
    const pts = deck.pts.map((p) => [p[0], p[1]]), tops = Array.from(deck.tops);
    tops[e] = ref;                                                // the old end is a point of the deck now, at the deck level
    if (atStart) { pts.unshift(...added.reverse()); tops.unshift(...addedTops.reverse()); } else { pts.push(...added); tops.push(...addedTops); }
    return { ...deck, pts, tops: Float32Array.from(tops) };
  }
  return deck;
}

/** The decks of the baked world with the Pont Rouge carried on to its approach roads (call it before createDeckNetwork). */
export function fixLandmarkDecks(decks, surfaceHeight) {
  const K = ROUGE;
  return decks.map((d) => {
    const a = d.pts[0], b = d.pts[d.pts.length - 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = d.pts[d.pts.length >> 1];
    if (len < K.minLength || Math.hypot(m[0] - K.at[0], m[1] - K.at[1]) > 60) return d;
    return extendEnd(extendEnd(d, true, surfaceHeight), false, surfaceHeight);
  });
}

/** A frustum between two rectangles (a leg of the pylon): corners at (s, u) +- half sizes, from the foot to the head. */
function loft(soup, F, foot, head, color, key) {
  const corners = (c) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => F.at(c.s + a * c.hs, c.y, c.u + b * c.hu));
  const lo = corners(foot), hi = corners(head);
  for (let i = 0; i < 4; i++) soup.quad(lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i], paint(color, key + i, 0.04));
}

export function buildPontRouge({ decks, ground }) {
  const K = ROUGE;
  const group = decks.filter((d) => {
    const a = d.pts[0], b = d.pts[d.pts.length - 1];
    const m = d.pts[d.pts.length >> 1];
    return Math.hypot(b[0] - a[0], b[1] - a[1]) >= K.minLength && Math.hypot(m[0] - K.at[0], m[1] - K.at[1]) < 60;
  });
  if (group.length < 4) throw new Error(`Pont Rouge: expected 4 decks, found ${group.length}`);
  // the road decks are the 8.4 m wide ones; the frame follows the first of them (u = 0 on it, positive to the left of the way)
  const roads = group.filter((d) => d.width > 8);
  const road0 = roads[0];
  const a = road0.pts[0], b = road0.pts[road0.pts.length - 1];
  const F0 = axisFrame(a[0], a[1], b[0], b[1]);
  // run the axis from east to west like the first deck, but make sure all decks are measured in this frame
  const road1 = roads.find((d) => d !== road0);
  const prof0 = profileOf(F0, road0), prof1 = profileOf(F0, road1);
  const F = F0, L = F.length;
  const top = (s) => (prof0(s) + prof1(s)) / 2;               // the two carriageways differ by decimetres (the LiDAR): one surface for the model
  const under = (s) => top(s) - K.slab;
  const g = (s, u) => ground(...F.xz(s, u));
  // the lateral extent of the decks (the real edges of the bridge)
  let uMin = Infinity, uMax = -Infinity;
  for (const d of group) for (const p of d.pts) { const u = F.local(p[0], p[1])[1]; uMin = Math.min(uMin, u - d.width / 2); uMax = Math.max(uMax, u + d.width / 2); }
  uMin = Math.max(uMin, -15.2); uMax = Math.min(uMax, 12.2);
  const uc = (uMin + uMax) / 2;
  const soup = new Soup();
  const steps = Math.ceil(L / 3);

  // ---- the surface: two carriageways (asphalt), the tram bed between them and the footway, paving on the outer edges
  const strip = (u0, u1, color, key, lift = 0) => deckStrip(soup, F, u0, u1, 0, L, top, color, steps, key, lift);
  strip(K.roadSouth, K.roadNorth, C.asphalt, 1, 0.01);
  strip(K.roadNorth, K.bedNorth, C.concrete, 2, 0.01);
  strip(K.bedNorth, uMax, C.paving, 3, 0.04);
  strip(uMin, K.roadSouth, C.paving, 4, 0.04);
  for (const u of [0, -8.1]) for (let s = 4; s + 3 < L - 4; s += 9) deckStrip(soup, F, u - 0.09, u + 0.09, s, s + 3, top, C.line, 1, 8, 0.02);
  for (const u of [5.2, 7.4]) strip(u - 0.07, u + 0.07, C.steelDark, 9, 0.02);       // the tram tracks
  // the slab edge and the railing
  for (const [u, sign] of [[uMax, 1], [uMin, -1]]) {
    wallFace(soup, F, u, 0, L, under, top, C.steelRed, steps, 10);
    wallFace(soup, F, u - sign * 0.05, 0, L, top, (s) => top(s) + K.railing, C.white, steps, 11);
    wallFace(soup, F, u - sign * 0.2, 0, L, top, (s) => top(s) + K.railing, C.steelGrey, steps, 12);
    deckStrip(soup, F, u - sign * 0.2, u - sign * 0.05, 0, L, (s) => top(s) + K.railing, C.steelGrey, steps, 13);
  }
  deckStrip(soup, F, uMin, uMax, 0, L, under, C.steelRedDark, steps, 14);              // the underside of the slab

  // ---- the steel box girder, deeper over the pylons
  const pylons = K.pylonAt.map((f) => L * f);
  const depth = (s) => {
    const d = Math.min(...pylons.map((p) => Math.abs(s - p)));
    const t = Math.max(0, 1 - d / K.haunch);
    return K.girderDepth + (K.girderDepthPylon - K.girderDepth) * t * t * (3 - 2 * t);
  };
  const TL = [], BL = [], BR = [], TR = [];
  const n = Math.ceil(L / 4);
  for (let i = 0; i <= n; i++) {
    const s = (L * i) / n;
    const yb = under(s) - depth(s);
    TL.push(F.at(s, under(s), uc + K.girderTopHalf)); BL.push(F.at(s, yb, uc + K.girderBottomHalf));
    BR.push(F.at(s, yb, uc - K.girderBottomHalf)); TR.push(F.at(s, under(s), uc - K.girderTopHalf));
  }
  soup.strip(TL, BL, C.steelRed, (i) => paint(C.steelRed, 100 + i, 0.03));
  soup.strip(BL, BR, C.steelRedDark, (i) => paint(C.steelRedDark, 200 + i, 0.03));
  soup.strip(BR, TR, C.steelRed, (i) => paint(C.steelRed, 300 + i, 0.03));
  // the struts that carry the cantilevers of the slab
  for (let s = K.finEvery / 2; s < L; s += K.finEvery) {
    for (const sign of [1, -1]) {
      const edge = sign > 0 ? uMax - 0.4 : uMin + 0.4;
      const side = uc + sign * K.girderTopHalf;
      const inner = uc + sign * (K.girderTopHalf - 0.2);
      soup.tri(F.at(s, under(s) - Math.min(2.4, depth(s) * 0.55), inner), F.at(s, under(s), edge), F.at(s, under(s), side), paint(C.steelRed, Math.round(s) + (sign > 0 ? 0 : 7), 0.05));
    }
  }

  // ---- the pylons: two splayed steel legs each, standing on the slopes of the valley
  for (const [pi, sp] of pylons.entries()) {
    for (const sign of [1, -1]) {
      const footU = uc + sign * K.legFootHalf, headU = uc + sign * K.legTopHalf;
      const [fx, fz] = F.xz(sp, footU);
      const gy = g(sp, footU);
      const yHead = under(sp) - 0.05;
      loft(soup, F,
        { s: sp, u: footU, y: gy - 1.5, hs: (K.legAlong * K.legBaseScale) / 2, hu: (K.legAcross * K.legBaseScale) / 2 },
        { s: sp, u: headU, y: yHead, hs: K.legAlong / 2, hu: K.legAcross / 2 }, C.steelRed, 400 + pi * 10 + (sign > 0 ? 0 : 5));
      // the concrete foot
      soup.box(fx, gy - 2.5, fz, 4.6, 3.6, 5.6, Math.atan2(-F.dz, F.dx), C.concrete);
    }
    // a cross beam between the legs, under the girder
    const yb = under(sp) - depth(sp) + 1.2;
    const [cx, cz] = F.xz(sp, uc);
    soup.box(cx, yb, cz, 3.0, 1.1, 2 * K.legTopHalf * 0.5, Math.atan2(-F.dz, F.dx), C.steelRedDark);
  }

  // ---- the abutments: concrete walls from the ground to the slab at both ends, closed towards the span
  const abutment = (s0, s1, closeAt) => {
    for (const u of [uMin, uMax]) wallFace(soup, F, u, s0, s1, (s) => g(s, u) - 1.2, under, C.concrete, Math.ceil((s1 - s0) / 2.5), 50);
    const lows = [uMin, (uMin + uMax) / 2, uMax].map((u) => g(closeAt, u));
    const low = Math.min(...lows) - 1.2;
    soup.quad(F.at(closeAt, low, uMin), F.at(closeAt, low, uMax), F.at(closeAt, under(closeAt), uMax), F.at(closeAt, under(closeAt), uMin), paint(C.concreteDark, 51));
  };
  abutment(0, K.abutmentEast, K.abutmentEast);
  abutment(L - K.abutmentWest, L, L - K.abutmentWest);

  // ---- the masts of the tram and the lamps
  for (let s = K.mastEvery / 2; s < L - 10; s += K.mastEvery) {
    for (const [u, h, c] of [[6.3, K.mastHeight, C.steelGrey], [uMax - 0.5, 5.5, C.lampGreen], [uMin + 0.5, 5.5, C.lampGreen]]) {
      const [x, z] = F.xz(s, u);
      soup.box(x, top(s), z, 0.22, h, 0.22, 0, c);
      if (h < 6) soup.box(x, top(s) + h, z, 0.5, 0.35, 0.5, 0, C.lampLight);
    }
  }

  // ---- the collision walls: the baked decks are narrower than the bridge, the car stays on them
  const walls = [K.guardNorth, K.guardSouth, K.guardFar].map((u) => {
    const [ax, az] = F.xz(0, u), [bx, bz] = F.xz(L, u);
    return { ax, az, bx, bz, r: K.guardRadius, id: 'pont-rouge' };
  });
  return { soup, walls, hideDecks: new Set(group.map((d) => d.id)), frame: F, info: { length: L, uMin, uMax, pylons: pylons.map((p) => Math.round(p)) } };
}
