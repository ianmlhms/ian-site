/* The bridge decks of Lux Drive: a bridge is NOT carved into the terrain (the LiDAR DTM under a bridge is the
 * ground below it), so every OSM way tagged bridge=yes becomes a solid deck - a polyline with the real deck
 * height at every point (the LiDAR DSM), pinned to the ground at its two ends.
 *
 * Pure functions, shared by the physics, the renderer and the Node harness. */
import { ROAD } from './config.js';

export const DECK = Object.freeze({
  margin: 0.8,             // m beside the deck that still counts as deck (the parapet keeps the car on it)
  thickness: 1.0,          // m of solid under the deck surface (a deck is not a floating ribbon)
  stickBelow: 0.6,         // the car counts as "on" the deck when it is at most this far below the surface
  spanDip: 3.0,            // m: the land dips this far under the way, so the deck spans it (the bake writes the same number)
  cell: 32,                // m, the spatial hash cell
  hintLift: 0.42,          // m: the car's body lies this far over its wheels (CAR.rideHeight): the hint is the body, the deck is under the wheels
  landmarkSites: [[4829, 9101], [5179, 8061]],   // m: the Pont Adolphe and the Pont Rouge (landmark-bridges.js ADOLPHE.at / ROUGE.at): their models shape their decks and meet their roads themselves ...
  landmarkRadius: 30,      // m: ... whose middle lies within this of the site (the ends of those decks keep their plain pin to the ground; road-network.js does not lift their approaches)
  landmarkPinOut: 2.5,     // m: ... or, where the ground at an end is a pit (landmarkPit under both the deck and the road), the deck runs on this far over its approach
  landmarkPit: 0.3,
  joinTolerance: 1.5,      // m: the ends of two decks this close are one bridge in two pieces (a joint): they meet at the level of the bridge, not at the valley floor under the joint
  approachJoin: 3.0,       // m: a carved way whose end lies this close to the end of a deck runs onto it there ...
  approachAlign: 0.7,      // ... when it leaves through that end toward the deck (the cosine of the two directions at least this)
  endStub: 0.5,            // m: an inner point of a deck (a car's, at least stubWidth wide) this close to one of its ends takes the level of that end (see endStubs)
  stubWidth: 4.0,
  overRoadClear: 2.5,      // m: a deck this far over a carriageway under it is a bridge over that road (its free ends keep their plain pin)
  apronWidth: 5.0,         // m: a deck at least this wide (a carriageway) gets an approach slab where its approach does not reach the corners of its end (withAprons) ...
  apronInset: 1.2,         // ... probed this far inside its edges ...
  apronDrop: 0.25,         // ... where the ground lies this far under the approach on the axis (or the deck end) ...
  apronCut: 1.0,           // ... somewhere at least this deep (the cut of the road below) ...
  apronMax: 6.0,           // ... up to this far back; the slab ends this far under the road on the axis
  apronTuck: 0.02,
  trustWidth: 5.0,         // m: the DSM of a narrower deck is smoothed (smoothTops; road-network.js DECK_TRUST_WIDTH is the same number) ...
  smoothSigma: 4.0,        // ... over this (m)
  endHold: 3.0,            // m: from an end that a way runs onto the deck does not fall below the level of that end for this long (road-network.js holds the approach's carriageway at the
                           // level of its end ABUT_HOLD = 2 m under the deck: a deck that fell away from its end at once lay 5 - 15 cm under that held road - a step onto the road and off it)
  endGrade: 0.12,          // m/m: the steepest a deck climbs or falls away from the level of its end (the DSM next to an abutment is the bank, a parapet or the canopy of a wood: used as it is, the
                           // deck began with a vertical face at the end of its approach road)
  bankSlope: 0.8,          // m/m: the bank under a deck end steeper than this is a wall for a car under the deck (bankCollide) ...
  bankRise: 0.3,           // ... where it rises this far over the car's wheels ...
  bankPush: 0.15,          // ... pushed back at most this far per step; and where the underside of the deck is less than roofClear over the car (on ground steeper than lowSlope)
  roofClear: 1.5,
  lowSlope: 0.15,
  treeAbove: 1.5,          // m: a tree whose foot is less than this above a deck surface stands on it (the ground under it is a metre or two off the LiDAR deck)
  treeBelow: 0.3,          // m: a crown that comes within this of the underside of a deck touches it
});

const DECIMETRE = 0.1;
/** The classes of the ways a car drives on (a deck of one of them runs off a free end at DECK.endGrade even where it stands over a street: the ramp of a car park). */
export const CAR_DECK_KINDS = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
  'unclassified', 'residential', 'living_street', 'service', 'track', 'road']);
const segDistance = (p, a, b) => {
  const ex = b[0] - a[0], ez = b[1] - a[1], ll = ex * ex + ez * ez || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / ll));
  return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ez * t);
};

function readVarint(bytes, state) {
  let result = 0, shift = 0;
  for (;;) {
    const b = bytes[state.pos++];
    result += (b & 0x7f) * 2 ** shift;
    if (b < 0x80) return result;
    shift += 7;
    if (shift > 49) throw new Error('decks: varint too long');
  }
}
const unzigzag = (n) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

const FLAG_PARAPET = 1, FLAG_SPANS = 2, FLAG_REMOVED = 4;   // bit 2: the deck is not a bridge (it lies on a carriageway at road level): scripts/luxdrive/bake_deck_fixes.mjs

/** decks.bin -> [{ id, parapet, spans, width, pts: [[x, z]], tops: [y] }].  `id` is the index in the file; a removed deck keeps its index but is not returned. */
export function decodeDecks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  const state = { pos: 4 };
  const decks = [];
  for (let d = 0; d < count; d++) {
    const flags = view.getUint16(state.pos, true);
    const width = view.getUint16(state.pos + 2, true) * DECIMETRE;
    const n = view.getUint16(state.pos + 4, true);
    let x = view.getInt32(state.pos + 6, true);
    let z = view.getInt32(state.pos + 10, true);
    state.pos += 14;
    const pts = [[x * DECIMETRE, z * DECIMETRE]];
    for (let i = 1; i < n; i++) {
      x += unzigzag(readVarint(bytes, state));
      z += unzigzag(readVarint(bytes, state));
      pts.push([x * DECIMETRE, z * DECIMETRE]);
    }
    const tops = new Float32Array(n);
    for (let i = 0; i < n; i++) { tops[i] = view.getFloat32(state.pos, true); state.pos += 4; }
    if ((flags & FLAG_REMOVED) !== 0) continue;
    decks.push({ id: d, parapet: (flags & FLAG_PARAPET) !== 0, spans: (flags & FLAG_SPANS) !== 0, width, pts, tops });
  }
  return decks;
}

const zigzag = (n) => (n < 0 ? -2 * n - 1 : 2 * n);

/**
 * [{ id?, parapet, spans, width, pts, tops, removed? }] -> decks.bin bytes (the exact inverse of decodeDecks: positions in decimetres).  The file order is the id: a deck that is
 * dropped keeps its slot with the removed flag, so every id that a landmark refers to stays valid.
 */
export function encodeDecks(decks) {
  const bytes = [];
  const push32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); bytes.push(...b); };
  const push16 = (v) => { bytes.push(v & 255, (v >> 8) & 255); };
  const pushVar = (v) => { let r = v; while (r >= 0x80) { bytes.push((r % 0x80) | 0x80); r = Math.floor(r / 0x80); } bytes.push(r); };
  push32(decks.length);
  for (const d of decks) {
    const n = d.pts.length;
    push16((d.parapet ? FLAG_PARAPET : 0) | (d.spans ? FLAG_SPANS : 0) | (d.removed ? FLAG_REMOVED : 0));
    push16(Math.round(d.width / DECIMETRE));
    push16(n);
    let x = Math.round(d.pts[0][0] / DECIMETRE), z = Math.round(d.pts[0][1] / DECIMETRE);
    push32(x); push32(z);
    for (let i = 1; i < n; i++) {
      const nx = Math.round(d.pts[i][0] / DECIMETRE), nz = Math.round(d.pts[i][1] / DECIMETRE);
      pushVar(zigzag(nx - x)); pushVar(zigzag(nz - z));
      x = nx; z = nz;
    }
    for (let i = 0; i < n; i++) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, d.tops[i], true); bytes.push(...b); }
  }
  return Uint8Array.from(bytes);
}

/**
 * collide14 (harness V3): a deck is at least as wide as the car road it carries.  The bake gave deck 142 (Rue de la Cimenterie, 5.9 m over the ground) 5.1 m for a 7.2 m
 * secondary road: the outer wheels of both lanes ran off the deck and a parapet there would stand in the lanes.  The deck takes its way's width (centred on its axis:
 * the way runs along it).  decks: the decoded decks, roads: the decoded ways.  Returns new decks (the others unchanged).
 */
export function widenToWays(decks, roads) {
  const segDist = (p, a, b) => { const ex = b[0] - a[0], ez = b[1] - a[1], ll = ex * ex + ez * ez || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / ll)); return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ez * t); };
  const G = 64, grid = new Map(), key = (x, z) => Math.floor(x / G) * 65536 + Math.floor(z / G);
  for (const r of roads) {
    if (!CAR_DECK_KINDS.has(r.kind) || !(r.bridge || r.over)) continue;
    for (const q of r.pts) { const k = key(q[0], q[1]), l = grid.get(k); if (!l) grid.set(k, [r]); else if (!l.includes(r)) l.push(r); }
  }
  return decks.map((d) => {
    const cand = new Set();
    for (const p of d.pts) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const r of grid.get(key(p[0] + a * G, p[1] + b * G)) || []) cand.add(r);
    let way = null, most = 0;
    for (const r of cand) {
      let c = 0;
      for (const p of d.pts) for (let i = 0; i + 1 < r.pts.length; i++) if (segDist(p, r.pts[i], r.pts[i + 1]) <= 1.5) { c++; break; }
      if (c > most) { most = c; way = r; }
    }
    return way && most >= d.pts.length * 0.6 && way.width > d.width ? { ...d, width: way.width } : d;
  });
}

/** A deck that a landmark model shapes (DECK.landmarkSites). */
export const isLandmarkDeck = (d) => {
  const m = d.pts[d.pts.length >> 1];
  return DECK.landmarkSites.some(([x, z]) => Math.hypot(m[0] - x, m[1] - z) <= DECK.landmarkRadius);
};

/** The DSM level of a deck continued from its first two inner points to its end k (j, j2: the next two points inward), at no steeper grade than DECK.endGrade. */
function innerLevel(d, k, j, j2) {
  const l1 = Math.hypot(d.pts[j][0] - d.pts[k][0], d.pts[j][1] - d.pts[k][1]);
  const l2 = Math.hypot(d.pts[j2][0] - d.pts[j][0], d.pts[j2][1] - d.pts[j][1]) || 1;
  const grade = Math.max(-DECK.endGrade, Math.min(DECK.endGrade, (d.tops[j] - d.tops[j2]) / l2));
  return d.tops[j] + grade * l1;
}

/**
 * The level of the two ends of every deck: [startTop, endTop, envelopeAtStart, envelopeAtEnd] per deck.
 *   - an end where a carved way runs onto the deck (an abutment): the surface there, i.e. the road (road-network.js lifts the road onto the level of a carriageway deck and holds its
 *     carriageway under the first metres of the deck), and the deck runs off it at no more than DECK.endGrade (envelope);
 *   - a JOINT (the ends of two or more decks meet: one bridge in pieces): the mean of the DSM levels of the pieces there (the bake writes the valley floor under the joint), envelope;
 *   - any other end (a footbridge on its bank): the surface, as before, no envelope.
 */
function deckEndTops(decks, surface) {
  const net = surface.field && surface.field.network;
  const approach = [];
  if (net) {
    for (const c of net.chains) {
      if (net.overRoads.has(c.road) || c.x.length < 2) continue;
      const m = c.x.length;
      for (const [a, b] of [[0, 1], [m - 1, m - 2]]) {                 // the end of the way and the direction it leaves through it
        const ux = c.x[a] - c.x[b], uz = c.z[a] - c.z[b], ul = Math.hypot(ux, uz) || 1;
        approach.push([c.x[a], c.z[a], ux / ul, uz / ul]);
      }
    }
  }
  const ends = [];
  decks.forEach((d, k) => {
    const n = d.pts.length;
    if (n < 2 || isLandmarkDeck(d)) return;                           // (a landmark deck keeps its plain pin and is nobody's joint)
    const into = (a, b) => { const dx = d.pts[b][0] - d.pts[a][0], dz = d.pts[b][1] - d.pts[a][1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
    ends.push({ k, side: 0, p: d.pts[0], into: into(0, 1), inner: n >= 3 ? innerLevel(d, 0, 1, 2) : d.tops[0] });
    ends.push({ k, side: 1, p: d.pts[n - 1], into: into(n - 1, n - 2), inner: n >= 3 ? innerLevel(d, n - 1, n - 2, n - 3) : d.tops[n - 1] });
  });
  // (a deck that stands over a carriageway - a footbridge over a street, pinned to the ground at its free ends - keeps its DSM: an envelope from its ends laid it onto the street, 152)
  const o = { sdCar: 9 };
  const overCarriageway = (d) => !!surface.roadInfoAt && d.pts.some((p, i) => i > 0 && i < d.pts.length - 1 && (surface.roadInfoAt(p[0], p[1], o), o.sdCar < 0) && d.tops[i] - surface.height(p[0], p[1]) > DECK.overRoadClear);
  // (a deck that carries cars: the way under its middle point is a road for cars, not a footway / cycleway / pedestrian street)
  const carriesCars = (d) => {
    if (!net) return false;
    const m = d.pts[d.pts.length >> 1];
    return net.roads.some((r) => CAR_DECK_KINDS.has(r.kind) && r.pts.some((q, i) => i > 0 && segDistance(m, r.pts[i - 1], q) <= 1.5));
  };
  const out = decks.map(() => [0, 0, false, false, false, false]);   // [startTop, endTop, envelope at start, at end, an approach way at start, at end]
  for (const e of ends) {
    const [x, z] = e.p;
    // a way runs onto the deck here: its end is near and it leaves through it toward the deck (a way that only ends beside the deck, at an angle, does not)
    const isApproach = approach.some((q) => Math.abs(q[0] - x) <= DECK.approachJoin && Math.abs(q[1] - z) <= DECK.approachJoin && Math.hypot(q[0] - x, q[1] - z) <= DECK.approachJoin &&
      q[2] * e.into[0] + q[3] * e.into[1] >= DECK.approachAlign);
    // (a RING closes on itself, its two ends at one point: the ring over the Kirchberg interchange, deck 33.  Its closing point is a joint with itself: pinned to the
    // ground under it, the ring had a 13 m cliff 4 m from its "end")
    const joint = isApproach ? [] : ends.filter((o) => (o.k !== e.k || o.side !== e.side) && Math.hypot(o.p[0] - x, o.p[1] - z) <= DECK.joinTolerance);
    let level, envelope;
    if (joint.length) { level = (e.inner + joint.reduce((sum, o) => sum + o.inner, 0)) / (joint.length + 1); envelope = true; }
    else {
      level = isApproach || !surface.field ? surface.height(x, z) : Math.max(surface.height(x, z), surface.field.height(x, z));
      // a free end of a car's deck (no way is carved onto it: the next way is a bridge the bake has no deck for, or a ramp of a car park) runs off its end at no more than
      // DECK.endGrade too: pinned to the ground under a DSM 3 - 5 m higher, it began with a ramp of 80 % (decks 160, 169)
      envelope = isApproach || (decks[e.k].width >= DECK.stubWidth && (carriesCars(decks[e.k]) || !overCarriageway(decks[e.k])));
    }   // (a bank: on the 1 m lattice and on the ground itself, whichever is higher - an end on the edge of a drop dived into the continuous ground)
    out[e.k][e.side] = level; out[e.k][2 + e.side] = envelope; out[e.k][4 + e.side] = isApproach;
  }
  return out;
}

/**
 * The tops of a deck with its ends at `lo` / `hi`.  Where an end has an envelope the deck climbs or falls away from that end at no more than DECK.endGrade (the DSM inside the envelope is kept).
 * The deck never runs under the ground (it then lies on it).  Pure: returns a new array.
 */
function endEnvelope(pts, tops, lo, hi, envLo, envHi, surface, holdLo = false, holdHi = false) {
  const n = pts.length;
  const out = Float32Array.from(tops);
  out[0] = lo; out[n - 1] = hi;
  // a deck never runs under the ground it stands on (the fill of a road lifted onto the bridge beside a pavement deck, a bank): it lies on it there
  if (!envLo && !envHi) { for (let i = 1; i < n - 1; i++) out[i] = Math.max(out[i], surface.height(pts[i][0], pts[i][1])); return out; }
  const arc = new Float64Array(n);
  for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const total = arc[n - 1];
  for (let i = 1; i < n - 1; i++) {
    let below = -Infinity, above = Infinity;               // the envelope of the two ends here
    if (envLo) { below = Math.max(below, lo - DECK.endGrade * Math.max(0, arc[i] - (holdLo ? DECK.endHold : 0))); above = Math.min(above, lo + DECK.endGrade * arc[i]); }
    if (envHi) { below = Math.max(below, hi - DECK.endGrade * Math.max(0, total - arc[i] - (holdHi ? DECK.endHold : 0))); above = Math.min(above, hi + DECK.endGrade * (total - arc[i])); }
    // two ends too far apart in level for the grade between them (a short deck between a low and a high bank): the straight line from one to the other
    const top = below <= above ? Math.min(above, Math.max(below, tops[i])) : lo + (hi - lo) * (arc[i] / (total || 1));
    out[i] = Math.max(top, surface.height(pts[i][0], pts[i][1]));
  }
  return out;
}

/**
 * The DSM of a narrow deck (a track, a lane, a footbridge: under DECK.trustWidth) is often the canopy over it or a parapet: smoothed along the deck (a Gaussian of DECK.smoothSigma
 * in arc length) - the track over the gully on deck 28 had kinks of 50 % between two points 4 m apart.  Pure: a new array (the ends are set by the caller).
 */
function smoothTops(d) {
  const n = d.pts.length;
  const arc = new Float64Array(n);
  for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + Math.hypot(d.pts[i][0] - d.pts[i - 1][0], d.pts[i][1] - d.pts[i - 1][1]);
  const out = Float32Array.from(d.tops);
  const sg = DECK.smoothSigma;
  for (let i = 1; i < n - 1; i++) {
    let sum = 0, wsum = 0;
    for (let j = 1; j < n - 1; j++) {
      const u = (arc[j] - arc[i]) / sg;
      if (u * u > 9) continue;
      const w = Math.exp(-0.5 * u * u);
      sum += w * d.tops[j]; wsum += w;
    }
    out[i] = wsum > 0 ? sum / wsum : d.tops[i];
  }
  return out;
}

/**
 * The ends of a deck carry their stub points: an inner point that lies within DECK.endStub of an end takes the level the end gets (the bake resamples every 4 m and adds the
 * last point: a last segment of a few centimetres whose inner point kept the DSM while the end was pinned to the ground - a vertical step of 0.3 - 0.4 m at the end of the
 * deck, decks 255 / 160).  Returns, per deck, [index of the stub at the start or -1, at the end or -1].
 */
function endStubs(d) {
  const n = d.pts.length;
  if (n < 3 || d.width < DECK.stubWidth) return [-1, -1];             // (a footbridge's last span can be that short and carry it clear of the ground)
  const near = (i, e) => Math.hypot(d.pts[i][0] - d.pts[e][0], d.pts[i][1] - d.pts[e][1]) < DECK.endStub;
  return [near(1, 0) ? 1 : -1, n > 3 && near(n - 2, n - 1) ? n - 2 : n === 3 && near(1, 2) && !near(1, 0) ? 1 : -1];
}

/**
 * Approach slabs where the approach does not reach the corners of the deck end.  A road bridge over a road at a skew: the OSM bridge ends square to its own axis, but the gap
 * under it runs along the road below, so at the acute corner the cut of the road below reaches past the deck end and the approach carriageway there falls away 1 - 5 m (the
 * Autoroute d'Arlon over the Autoroute d'Esch, decks 104 / 114 / 119 / 137: a car in the outer lane fell off the corner before the deck).  There the deck is continued back
 * over its approach (an approach slab) far enough to cover the corner, its far end just under the road on the axis.  Pure: a new deck, or the same one.
 */
function withAprons(d, holdA, holdB, surface) {
  if (d.width < DECK.apronWidth || d.pts.length < 2 || (!holdA && !holdB)) return d;
  let pts = d.pts, tops = Array.from(d.tops), apronA = 0, apronB = 0;
  for (const atStart of [true, false]) {
    if (!(atStart ? holdA : holdB)) continue;
    const n = pts.length, e = atStart ? 0 : n - 1, f = atStart ? 1 : n - 2;
    const l = Math.hypot(pts[f][0] - pts[e][0], pts[f][1] - pts[e][1]) || 1;
    const ux = (pts[e][0] - pts[f][0]) / l, uz = (pts[e][1] - pts[f][1]) / l;          // out of the deck, along the approach
    const top = tops[e], side = d.width / 2 - DECK.apronInset;
    let eaten = 0, deepest = 0;
    for (let s = 0.5; s <= DECK.apronMax + 1e-6; s += 0.5) {
      const axis = Math.min(top, surface.height(pts[e][0] + ux * s, pts[e][1] + uz * s));   // (the approach climbing or falling to the deck is not a corner that falls away)
      for (const k of [-1, 1]) {
        const x = pts[e][0] + ux * s - uz * side * k, z = pts[e][1] + uz * s + ux * side * k;
        const drop = axis - surface.height(x, z);
        if (drop > DECK.apronDrop) eaten = s;
        deepest = Math.max(deepest, drop);
      }
    }
    if (eaten === 0 || deepest < DECK.apronCut) continue;            // (a verge that falls away gently is the bank of an approach on a curve, not the cut of a road below)
    const len = Math.min(DECK.apronMax, eaten + 1.5);
    const fx = pts[e][0] + ux * len, fz = pts[e][1] + uz * len;
    const farTop = Math.min(top, surface.height(fx, fz)) - DECK.apronTuck;
    if (atStart) { pts = [[fx, fz], ...pts]; tops = [farTop, ...tops]; apronA = len; } else { pts = [...pts, [fx, fz]]; tops = [...tops, farTop]; apronB = len; }
  }
  return pts === d.pts ? d : { ...d, pts, tops: Float32Array.from(tops), apronA, apronB };   // (apronA / apronB: the metres of approach slab at each end - the bridge ends there)
}

/**
 * The deck network: the segments of every deck in a spatial hash, so the ground function can ask
 * "is there a deck over this point, and how high is it?".
 *
 * surface: the ground the game draws (the land with the roads carved into it).  The two ends of a deck stand
 * on it: the approach road is cut into the land, so the end of the deck has to be at the level of that road
 * and not at the level of the land above it, or the bridge hangs in the air over its own approach.
 */
export function createDeckNetwork(decks, surface = null) {
  // the decks of the ways the road network carves instead (a narrow deck that spans nothing: road-network.js groundedDeckOf) are not decks
  const grounded = surface && surface.field && surface.field.network ? surface.field.network.groundedDecks : null;
  const kept = grounded && grounded.size ? decks.filter((d) => !grounded.has(d.id)) : decks;
  const levels = surface ? deckEndTops(kept, surface) : null;
  const list = kept.map((d, k) => {
    if (!surface || d.pts.length < 2) return d;
    if (isLandmarkDeck(d)) {                                    // (the landmark models: the plain pin of the two ends, see DECK.landmarkSites)
      // drive12 (QA3 N3-B05): where the ground AT an end is a pit - lower than both the deck's next point and the road DECK.landmarkPinOut beyond the end by DECK.landmarkPit
      // (the Pont Adolphe's east end: the carve of its approach stops short of the deck and the bank under it shows, 0.96 m under the road a metre out) - the plain pin
      // dropped the deck 0.9 m into its last 3 m and the lanes met a 0.5 - 0.7 m step, the car rolled 36 - 40 deg.  There the deck runs on over the pit to that point
      // of the road, at the road's level.  The other ends met their roads and keep the plain pin.
      const tops = Array.from(d.tops), pts = d.pts.slice();
      const endOf = (e, i) => {
        const [x, z] = d.pts[e], [ix, iz] = d.pts[i], l = Math.hypot(x - ix, z - iz) || 1;
        const ox = x + ((x - ix) / l) * DECK.landmarkPinOut, oz = z + ((z - iz) / l) * DECK.landmarkPinOut;
        const plain = surface.height(x, z), out = surface.height(ox, oz);
        return Math.min(out, d.tops[i]) - plain > DECK.landmarkPit ? { level: out, extra: [ox, oz] } : { level: plain, extra: null };
      };
      const head = endOf(0, 1), tail = endOf(d.pts.length - 1, d.pts.length - 2);
      tops[0] = head.level;
      tops[tops.length - 1] = tail.level;
      if (head.extra) { pts.unshift(head.extra); tops.unshift(head.level); }
      if (tail.extra) { pts.push(tail.extra); tops.push(tail.level); }
      return { ...d, pts, tops: Float32Array.from(tops) };
    }
    const [lo, hi, envLo, envHi, holdLo, holdHi] = levels[k];
    const tops = endEnvelope(d.pts, d.width < DECK.trustWidth ? smoothTops(d) : d.tops, lo, hi, envLo, envHi, surface, holdLo, holdHi);
    const [stubA, stubB] = endStubs(d);
    if (stubA >= 0) tops[stubA] = lo;
    if (stubB >= 0) tops[stubB] = hi;
    return withAprons({ ...d, tops }, holdLo, holdHi, surface);
  });
  const ax = [], az = [], bx = [], bz = [], t0 = [], t1 = [], half = [], deckOf = [], ends = [];
  list.forEach((d, k) => {
    const last = d.pts.length - 2;
    for (let i = 0; i + 1 < d.pts.length; i++) {
      ax.push(d.pts[i][0]); az.push(d.pts[i][1]);
      bx.push(d.pts[i + 1][0]); bz.push(d.pts[i + 1][1]);
      t0.push(d.tops[i]); t1.push(d.tops[i + 1]);
      half.push(d.width / 2);
      deckOf.push(k);
      ends.push((i === 0 ? 1 : 0) | (i === last ? 2 : 0));       // bit 0: the first segment of its deck, bit 1: the last
    }
  });
  const count = ax.length;
  const AX = Float32Array.from(ax), AZ = Float32Array.from(az);
  const BX = Float32Array.from(bx), BZ = Float32Array.from(bz);
  const T0 = Float32Array.from(t0), T1 = Float32Array.from(t1);
  const HALF = Float32Array.from(half);
  const DECK_OF = Int32Array.from(deckOf), ENDS = Uint8Array.from(ends), ENDS_RAW = Uint8Array.from(ends);
  // An end of a deck where another deck goes on (a joint of one bridge in pieces, a ramp that meets the side of another deck) keeps its round cap: a square end
  // there opened a wedge between two pieces that meet at an angle, 16 m deep (decks 22 / 37 at Neudorf).  Only a free end (an abutment) is square.
  for (let i = 0; i < count; i++) {
    for (const [bit, x, z] of [[1, AX[i], AZ[i]], [2, BX[i], BZ[i]]]) {
      if ((ENDS[i] & bit) === 0) continue;
      let joined = false;
      for (let j = 0; j < count && !joined; j++) {
        if (DECK_OF[j] === DECK_OF[i]) continue;
        const ex = BX[j] - AX[j], ez = BZ[j] - AZ[j], ll = ex * ex + ez * ez;
        const t = ll > 1e-9 ? Math.max(0, Math.min(1, ((x - AX[j]) * ex + (z - AZ[j]) * ez) / ll)) : 0;
        const endOfJ = ((ENDS_RAW[j] & 1) && Math.hypot(x - AX[j], z - AZ[j]) <= DECK.joinTolerance) || ((ENDS_RAW[j] & 2) && Math.hypot(x - BX[j], z - BZ[j]) <= DECK.joinTolerance);
        if (endOfJ || Math.hypot(x - AX[j] - ex * t, z - AZ[j] - ez * t) <= HALF[j]) joined = true;     // end to end, or this end lies on the other deck
      }
      if (joined) ENDS[i] &= ~bit;
    }
  }
  const CELL = DECK.cell;
  const cellKey = (cx, cz) => (cx + 8192) * 32768 + (cz + 8192);
  const buckets = new Map();
  for (let i = 0; i < count; i++) {
    const minX = Math.min(AX[i], BX[i]), maxX = Math.max(AX[i], BX[i]);
    const minZ = Math.min(AZ[i], BZ[i]), maxZ = Math.max(AZ[i], BZ[i]);
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const key = cellKey(cx, cz);
        const list = buckets.get(key);
        if (list) list.push(i); else buckets.set(key, [i]);
      }
    }
  }
  const cells = new Map();
  for (const [key, list] of buckets) cells.set(key, Int32Array.from(list));
  const EMPTY = new Int32Array(0);

  // Per query: the nearest segment of every deck within reach of (x, z).  One deck answers with ONE segment, the one the point lies on: with "the highest
  // segment within reach" a climbing deck answered with the start of the span ahead (its round end cap reaches 5 m forward: a step of the grade x 5 m at
  // every point of the deck, QA B01 / B04), and with the distance to the infinite LINE of a segment a straight viaduct answered with whichever span 60 m
  // ahead was highest (B04: a step at every 32 m hash cell; T05 / T06: a deck lifted the road beyond its end by up to 1 m).  The two ends of a deck are
  // square (no cap over the approach road): a point whose nearest segment of a deck is an end segment and that lies past that end is off the deck; between
  // two segments the clamp covers the outside of the bend.
  const MAX_CAND = 32;
  const candDeck = new Int32Array(MAX_CAND), candSeg = new Int32Array(MAX_CAND), candT = new Float64Array(MAX_CAND), candSide = new Float64Array(MAX_CAND);
  const candOut = new Uint8Array(MAX_CAND);       // the nearest segment of that deck is its end segment and the point lies past the end: 2 a free end, no deck here (a short
                                                  // end segment let the round start of the next one reach 5 m back past the abutment); 1 a joint, see gather
  let candCount = 0;
  function gather(x, z) {
    candCount = 0;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = cells.get(cellKey(cx + dx, cz + dz)) || EMPTY;
        for (let q = 0; q < list.length; q++) {
          const i = list[q];
          const ax0 = AX[i], az0 = AZ[i];
          const ex = BX[i] - ax0, ez = BZ[i] - az0;
          const ll = ex * ex + ez * ez;
          if (ll < 1e-9) continue;
          let t = ((x - ax0) * ex + (z - az0) * ez) / ll;
          // past an end of the deck: 2 a free end (square: no deck there), 1 a joint (the round cap bridges to the next piece, but only where no deck lies under the point
          // itself: the cap of one piece reached 6 m over the next and held the car at its own level, a 30 cm step on the A1 deck 18)
          const pastEnd = (t < 0 && (ENDS_RAW[i] & 1) !== 0) || (t > 1 && (ENDS_RAW[i] & 2) !== 0);
          const beyond = !pastEnd ? 0 : (t < 0 && (ENDS[i] & 1) !== 0) || (t > 1 && (ENDS[i] & 2) !== 0) ? 2 : 1;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const side = Math.hypot(x - (ax0 + ex * t), z - (az0 + ez * t));
          if (side > HALF[i] + DECK.margin) continue;
          const dk = DECK_OF[i];
          let c = 0;
          while (c < candCount && candDeck[c] !== dk) c++;
          if (c < candCount) { if (side < candSide[c]) { candSeg[c] = i; candT[c] = t; candSide[c] = side; candOut[c] = beyond; } continue; }
          if (candCount === MAX_CAND) continue;
          candDeck[c] = dk; candSeg[c] = i; candT[c] = t; candSide[c] = side; candOut[c] = beyond; candCount++;
        }
      }
    }
  }

  /** The deck over (x, z) whose surface the car can stand on (or null). out = { top, slope, ux, uz, along }. */
  function deckAt(x, z, y, out) {
    if (count === 0) return null;
    gather(x, z);
    let best = null;
    // pass 0: a deck whose own width covers the point; 1: one whose margin (DECK.margin past its edge) reaches it; 2: the round cap of a joint.  Two decks side by side at two
    // levels (the carriageways of a skewed interchange, 0.5 m apart) overlap by their margins: "the highest" put the outer wheels of a car near the edge of the lower deck on the
    // margin of the higher one, a 0.4 - 0.6 m step in the lane (decks 84 / 74, 157 / 154, 105 / 99)
    for (let pass = 0; pass < 3 && !best; pass++) for (let c = 0; c < candCount; c++) {
      if (candOut[c] === 2) continue;
      if ((candOut[c] === 1 ? 2 : candSide[c] <= HALF[candSeg[c]] ? 0 : 1) !== pass) continue;
      const i = candSeg[c], t = candT[c];
      const top = T0[i] + (T1[i] - T0[i]) * t;
      if (y < top - DECK.stickBelow) continue;              // the car is under the deck: the ground stays the ground
      // of two decks that overlap the one at the car's own level carries it (y is the car's body, DECK.hintLift over its wheels): two links that merge side by side at
      // 0.5 m apart (decks 157 / 154) put a car near the edge of the lower one onto the higher one with "the highest wins".  (A hint of 1e9 still asks for the highest.)
      if (!best || Math.abs(top - (y - DECK.hintLift)) < Math.abs(best.top - (y - DECK.hintLift))) {
        const ax0 = AX[i], az0 = AZ[i], ex = BX[i] - ax0, ez = BZ[i] - az0, len = Math.hypot(ex, ez);
        out.top = top;
        out.slope = (T1[i] - T0[i]) / len;
        out.ux = ex / len; out.uz = ez / len;
        out.along = (x - ax0) * out.ux + (z - az0) * out.uz;
        best = out;
      }
    }
    return best;
  }

  /**
   * The underside of the lowest deck that lies ABOVE height `y` over (x, z) (or Infinity): the camera keeps below it when the
   * car drives under a bridge, so the lens never ends up inside or on top of a deck it is not on.
   */
  function overheadAt(x, z, y) {
    if (count === 0) return Infinity;
    gather(x, z);
    let lowest = Infinity;
    for (let pass = 0; pass < 2 && lowest === Infinity; pass++) for (let c = 0; c < candCount; c++) {
      if (candOut[c] !== pass) continue;
      const i = candSeg[c];
      const bottom = T0[i] + (T1[i] - T0[i]) * candT[c] - DECK.thickness;
      if (bottom > y && bottom < lowest) lowest = bottom;
    }
    return lowest;
  }

  /**
   * Does a tree (or anything that stands on the ground at (x, z), `radius` wide, from y0 to y1) touch a deck?  A tree on the deck, a crown that
   * hangs over it or a trunk that grows through its slab: yes.  A tree in the valley UNDER a bridge, or on the land over a tunnel: no.
   */
  function touchesVolume(x, z, y0, y1, radius) {
    if (count === 0) return false;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const reach = Math.ceil(radius / CELL);
    for (let dz = -1 - reach; dz <= 1 + reach; dz++) {
      for (let dx = -1 - reach; dx <= 1 + reach; dx++) {
        const bucket = cells.get(cellKey(cx + dx, cz + dz)) || EMPTY;
        for (let q = 0; q < bucket.length; q++) {
          const i = bucket[q];
          const ax0 = AX[i], az0 = AZ[i];
          const ex = BX[i] - ax0, ez = BZ[i] - az0;
          const ll = ex * ex + ez * ez;
          if (ll < 1e-9) continue;
          let t = ((x - ax0) * ex + (z - az0) * ez) / ll;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const side = Math.hypot(x - (ax0 + ex * t), z - (az0 + ez * t));
          if (side > HALF[i] + radius) continue;
          const top = T0[i] + (T1[i] - T0[i]) * t;
          if (y0 < top + DECK.treeAbove && y1 > top - DECK.thickness - DECK.treeBelow) return true;
        }
      }
    }
    return false;
  }

  /**
   * The bank under the end of a bridge is a wall for a car UNDER the deck.  The ground under a deck end rises from the valley to the deck (the abutment: 1.5 x drop / RAMP_SLOPE
   * in road-network.js, 100 - 200 %); a car that drove along the valley under the A1 viaduct climbed it and was popped onto the deck with a 0.9 m step (QA B02 deck 23, N-B01
   * deck 87, deck 10).  (x, z): a body circle, y: the level of its wheels.  Returns { nx, nz, pen } (downhill) or null.  Only under a deck, only on a bank steeper than
   * DECK.bankSlope that rises DECK.bankRise over the wheels: a road under a bridge is never that steep.
   */
  const bankScratch = { top: 0, slope: 0, ux: 1, uz: 0, along: 0 };
  function bankCollide(x, z, radius, y) {
    if (count === 0 || !surface) return null;
    const h = surface.height(x, z);
    const bottom = overheadAt(x, z, y);
    if (bottom === Infinity) return null;                                    // no deck over the car
    const low = bottom - Math.max(h, y) < DECK.roofClear;                   // the underside of the deck comes down onto the roof (a natural bank under a low deck end: deck 87)
    if (h < y + DECK.bankRise && !low) return null;
    if (deckAt(x, z, y, bankScratch)) return null;                          // the car is on a deck here (or is lifted onto one): no bank
    const e = 0.5;
    const gx = (surface.height(x + e, z) - surface.height(x - e, z)) / (2 * e), gz = (surface.height(x, z + e) - surface.height(x, z - e)) / (2 * e);
    const g = Math.hypot(gx, gz);
    if (g < (low ? DECK.lowSlope : DECK.bankSlope)) return null;
    return { nx: -gx / g, nz: -gz / g, pen: Math.min(DECK.bankPush, Math.max(0, h - y - DECK.bankRise) / g + 0.05) };
  }

  return { deckAt, overheadAt, touchesVolume, bankCollide, count, decks: list };
}

/** The ground the car, the camera and the renderer see: the terrain surface, with the bridge decks on top.
 *  `hint(y)` tells it how high the car is (a car UNDER a bridge stays under it). */
export function createGround(surface, deckNetwork) {
  let hintY = 1e9;
  const scratch = { top: 0, slope: 0, ux: 1, uz: 0, along: 0 };
  const out = {
    height(x, z) {
      const g = surface.height(x, z);
      if (!deckNetwork || deckNetwork.count === 0) return g;
      const hit = deckNetwork.deckAt(x, z, hintY, scratch);
      return hit && hit.top > g ? hit.top : g;
    },
    normal(x, z, o) {
      if (deckNetwork && deckNetwork.count > 0) {
        const g = surface.height(x, z);
        const hit = deckNetwork.deckAt(x, z, hintY, scratch);
        if (hit && hit.top > g) {                          // the deck is a plane along its axis
          const slope = hit.slope;
          const l = Math.hypot(slope, 1);
          o.x = -slope * hit.ux / l; o.y = 1 / l; o.z = -slope * hit.uz / l;
          return o;
        }
      }
      return surface.normal(x, z, o);
    },
    /** The ground under a WHEEL: the continuous height function (the carve itself, not its 1 m lattice) with the decks on top.  The lattice is what the renderer
     *  draws; a wheel on it read every facet, and beside a kerb the kerb's saw-tooth on the lattice (QA D01).  Where the carriageway is flat the two agree to the
     *  interpolation error of the lattice (gate J); at the kerb the wheel meets the real kerb, 13 cm over 0.35 m, not a 1 m ramp that zigzags into the lane. */
    contact(x, z) {
      const g = surface.field ? surface.field.height(x, z) : surface.height(x, z);
      if (!deckNetwork || deckNetwork.count === 0) return g;
      const hit = deckNetwork.deckAt(x, z, hintY, scratch);
      return hit && hit.top > g ? hit.top : g;
    },
    hint(y) { hintY = y; },
    /** The height the car stands on at (x, z) for a car at the height `y` (the hint as an argument, the global one stays as it is): the level of a pose that is not
     *  the car's own (a teleport candidate, a lane probe - drive12). */
    levelAt(x, z, y) {
      const g = surface.height(x, z);
      if (!deckNetwork || deckNetwork.count === 0) return g;
      const hit = deckNetwork.deckAt(x, z, y, scratch);
      return hit && hit.top > g ? hit.top : g;
    },
    /** The underside of the lowest deck above height y over (x, z), Infinity when the sky is free. */
    overheadAt(x, z, y) { return deckNetwork ? deckNetwork.overheadAt(x, z, y) : Infinity; },
    onDeck(x, z) { return !!deckNetwork && deckNetwork.count > 0 && deckNetwork.deckAt(x, z, hintY, scratch) !== null; },
    /** The bank under a deck end for a car under the deck (y: the level of its wheels): see bankCollide. */
    bankCollide(x, z, radius, y) { return deckNetwork && deckNetwork.bankCollide ? deckNetwork.bankCollide(x, z, radius, y) : null; },
    surface, decks: deckNetwork ? deckNetwork.decks : [],
  };
  return out;
}

export { ROAD };
