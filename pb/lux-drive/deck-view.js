/* The bridge decks of Lux Drive: the decks of the bake (Pont Adolphe, Pont Rouge, the A1 bridges, the viaducts and footbridges) as one mesh per chunk.
 *
 * A bridge looks like a bridge: an asphalt road surface with its lane markings (a footbridge: pale concrete), a girder along both edges, parapets, and PIERS
 * where the deck stands high over the ground.  It is never a grey plateau.  Only where the deck is within a couple of metres of the ground (the approach ramps,
 * the abutments) is the side filled down to the ground, and the fill thins into the girder as the clearance grows - a deck 8 m over flat land is a thin slab on
 * columns, not a wall of roadbed 8 m high (the grey slabs the reviewer saw across Escher Strooss, the A1 and Rue de Neudorf).
 * The car drives on the top of it (the physics reads the same heights from decks.js). */
import { DECK } from './decks.js';
import { createChunkedFlat } from './chunked-flat.js';
import { ROAD_MIN_WIDTH, LINE_WIDTH, DASH_PERIOD, DASH_LENGTH, PAINT_LIFT, PIER_SIZE, FILL_NONE, ABUT, sideDepth, laneLines, piersOf, abutmentsOf } from './deck-shape.js';

const PARAPET_HEIGHT = 0.95;        // m, the height of the parapet of a road bridge
const PARAPET_WIDTH = 0.30;         // m, its thickness
const RAILING_HEIGHT = 1.05;        // m, the railing of a footbridge
const RAILING_WIDTH = 0.10;
const COLOUR_ASPHALT = [0.245, 0.249, 0.261];  // (the far tar of the ground shader: the road runs onto the deck without a change of tone)
const COLOUR_PATH = [0.60, 0.59, 0.56];
const COLOUR_PAINT = [0.84, 0.83, 0.76];
const COLOUR_SIDE = [0.56, 0.55, 0.52];
const COLOUR_UNDER = [0.40, 0.39, 0.37];
const COLOUR_PARAPET = [0.68, 0.67, 0.64];
const COLOUR_RAILING = [0.36, 0.38, 0.41];
const COLOUR_PIER = [0.58, 0.57, 0.54];
const COLOUR_MEDIAN = [0.50, 0.49, 0.47];
const MEDIAN_GAP_MAX = 1.6;         // m: two road decks side by side (the two carriageways of a motorway on two bridges) this close are joined by a concrete median over the gap: the ground
                                    // 15 m below showed through the gap as a green line down the middle of the bridge (Rue de Neudorf)
const MEDIAN_PROBE = 0.1;           // m, the step of the search for the neighbour deck
const CAP_FLUSH = 0.1;
const PARAPET_TAPER = 6;            // m: at an end of a deck that lies on the road the parapet rises from PARAPET_FOOT of its height to the full height over this length
const PARAPET_FOOT = 0.15;
const BEAM_WIDTH = 0.7;             // m: a girder under the soffit of a road deck
const BEAM_DEPTH = 0.9;             // m below the soffit
const MITRE_MAX = 2.0;              // the longest a mitre may grow (a sharp bend): longer, it would reach far past the outside of the bend
const COLOUR_BEAM = [0.52, 0.51, 0.48];
const COLOUR_BEAM_UNDER = [0.44, 0.43, 0.41];

/** The side vector (left of the direction of travel) at every point of a polyline, mitred: [sx, sz] with |s| = 1 / cos(half the bend) (at most MITRE_MAX). */
function mitres(pts) {
  const n = pts.length, out = [];
  const normal = (i) => { const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
  for (let i = 0; i < n; i++) {
    if (i === 0) { out.push(normal(0)); continue; }
    if (i === n - 1) { out.push(normal(n - 2)); continue; }
    const p = normal(i - 1), q = normal(i);
    let mx = p[0] + q[0], mz = p[1] + q[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { out.push(q); continue; }              // (a fold back: the plain normal)
    mx /= ml; mz /= ml;
    const k = Math.min(MITRE_MAX, 1 / Math.max(1e-3, mx * q[0] + mz * q[1]));
    out.push([mx * k, mz * k]);
  }
  return out;
}

const COLOUR_ABUT = [0.62, 0.61, 0.58];   // the concrete of an abutment
const ABUT_WING = 0.05;                    // m: the front wall reaches this far past the side of the deck (it closes onto the wing walls)
const xz = (p) => [p[0], p[2]];

/**
 * The deck as the view draws it, with its abutments (deck-shape.js abutmentsOf): a point is inserted at the front wall of each abutment, `abut[i]` marks the points
 * from the end to the front wall (their side faces go down to the ground), `fronts` lists the points where a front wall stands.  The surface is unchanged (the inserted
 * points lie on it).  Pure: returns a new deck.
 */
function withAbutments(deck, ground, sdCarAt) {
  const list = abutmentsOf(deck, ground, sdCarAt);
  const n = deck.pts.length;
  if (!list.length) return { ...deck, abut: new Uint8Array(n), fronts: [] };
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(deck.pts[i][0] - deck.pts[i - 1][0], deck.pts[i][1] - deck.pts[i - 1][1]));
  const pts = [], tops = [], station = [];
  const cuts = list.map((a) => a.s).sort((p, q) => p - q);
  for (let i = 0; i < n; i++) {
    if (i > 0) for (const s of cuts) {
      if (s > cum[i - 1] + 0.05 && s < cum[i] - 0.05) {
        const f = (s - cum[i - 1]) / (cum[i] - cum[i - 1]);
        pts.push([deck.pts[i - 1][0] + (deck.pts[i][0] - deck.pts[i - 1][0]) * f, deck.pts[i - 1][1] + (deck.pts[i][1] - deck.pts[i - 1][1]) * f]);
        tops.push(deck.tops[i - 1] + (deck.tops[i] - deck.tops[i - 1]) * f);
        station.push(s);
      }
    }
    pts.push(deck.pts[i]); tops.push(deck.tops[i]); station.push(cum[i]);
  }
  const abut = new Uint8Array(pts.length), fronts = [];
  for (const a of list) {
    let front = 0, best = Infinity;
    station.forEach((s, k) => { if (Math.abs(s - a.s) < best) { best = Math.abs(s - a.s); front = k; } });
    fronts.push(front);
    for (let k = 0; k < pts.length; k++) if (a.end === 0 ? k <= front : k >= front) abut[k] = 1;
  }
  return { ...deck, pts, tops: Float32Array.from(tops), abut, fronts };
}

/** The offsets of the girders under a road deck of width w (m from the axis). */
function beamOffsets(width) {
  const count = width >= 9 ? 3 : 2;
  const span = width - 2.4;
  return Array.from({ length: count }, (_, k) => -span / 2 + (span * k) / (count - 1));
}              // m: an end of a deck that lies on the road (the abutment, the road runs flush onto it) has an end face of tarmac, not of the girder's grey

/**
 * decks: the decoded decks [{ id, parapet, width, pts: [[x, z]], tops: [y] }]
 * ground: the surface under the decks ({ height(x, z), roadInfoAt(x, z, out) }): the abutments reach down to it, the piers stand on it and keep out of its carriageways.
 * Returns { meshes, count, piers, update(x, z, radius) }: one mesh per chunk (chunked-flat.js), culled by the frustum and by distance.
 */
export function createDeckView({ scene, decks, material, ground }) {
  const chunks = createChunkedFlat({ scene, material, name: 'luxdrive-decks' });
  const info = { sdCar: 9 };
  const sdCarAt = (x, z) => (ground && ground.roadInfoAt ? ground.roadInfoAt(x, z, info).sdCar : 9);
  let count = 0, pierCount = 0;
  // the road decks, for the median between two of them: their segments in a coarse grid
  const MEDIAN_CELL = 32;
  const medianGrid = new Map();
  for (const deck of decks) {
    if (deck.width < ROAD_MIN_WIDTH) continue;
    for (let i = 0; i + 1 < deck.pts.length; i++) {
      const [ax, az] = deck.pts[i], [bx, bz] = deck.pts[i + 1];
      const r = deck.width / 2 + MEDIAN_GAP_MAX;
      for (let cx = Math.floor((Math.min(ax, bx) - r) / MEDIAN_CELL); cx <= Math.floor((Math.max(ax, bx) + r) / MEDIAN_CELL); cx++) {
        for (let cz = Math.floor((Math.min(az, bz) - r) / MEDIAN_CELL); cz <= Math.floor((Math.max(az, bz) + r) / MEDIAN_CELL); cz++) {
          const k = cx * 65536 + cz;
          const l = medianGrid.get(k);
          const seg = { deck, ax, az, bx, bz };
          if (l) l.push(seg); else medianGrid.set(k, [seg]);
        }
      }
    }
  }
  /** True when (x, z) lies on another road deck than `self`. */
  const onOtherDeck = (x, z, self) => {
    for (const g of medianGrid.get(Math.floor(x / MEDIAN_CELL) * 65536 + Math.floor(z / MEDIAN_CELL)) || []) {
      if (g.deck === self) continue;
      const ex = g.bx - g.ax, ez = g.bz - g.az, ll = ex * ex + ez * ez;
      const t = ll > 1e-9 ? Math.min(1, Math.max(0, ((x - g.ax) * ex + (z - g.az) * ez) / ll)) : 0;
      if (Math.hypot(x - g.ax - ex * t, z - g.az - ez * t) <= g.deck.width / 2) return true;
    }
    return false;
  };
  /** The gap from the edge of `deck` at (x, z) (side direction sx, sz) to a neighbour road deck, or -1 when there is none within MEDIAN_GAP_MAX. */
  const gapBeside = (deck, x, z, sx, sz) => {
    for (let g = MEDIAN_PROBE; g <= MEDIAN_GAP_MAX + 1e-6; g += MEDIAN_PROBE) {
      if (onOtherDeck(x + sx * (deck.width / 2 + g), z + sz * (deck.width / 2 + g), deck)) return g;
    }
    return -1;
  };
  for (const source of decks) {
    if (source.pts.length < 2) continue;
    const deck = withAbutments(source, ground, sdCarAt);
    const n = deck.pts.length;
    const b = chunks.builderAt(deck.pts[n >> 1][0], deck.pts[n >> 1][1]);          // the whole deck goes to the chunk of its middle
    const half = deck.width / 2;
    const isRoad = deck.width >= ROAD_MIN_WIDTH;
    count += 1;
    // the bottom of the side of the deck: the ground where the deck is low (abutment, ramp), the girder where it is high (see sideDepth)
    const bottomAt = (x, z, y, i) => {
      if (!ground) return y - DECK.thickness;
      if (deck.abut[i]) return Math.min(y - DECK.thickness, ground.height(x, z) - ABUT.skirt);       // the wing wall of an abutment
      return y - sideDepth(y - ground.height(x, z));
    };
    const lines = isRoad ? laneLines(deck.width) : [];
    // The side vector at every point: the mitre of the two segments that meet there (scaled by 1 / cos of half the bend), so the quads of two segments share
    // their corners.  With the plain normal of each segment the outside of every bend was an open wedge: a hairline crack across the deck and its parapets at
    // every point where the deck turns (QA B07).
    const side = mitres(deck.pts);
    const at = (i, o, y) => [deck.pts[i][0] + side[i][0] * o, y, deck.pts[i][1] + side[i][1] * o];
    // the parapets rise out of the road over PARAPET_TAPER m at an end of the deck that lies on the road (a full wall that began in the lane was a grey block across
    // the road at the start of every motorway bridge: QA B06)
    const endFlush = [0, n - 1].map((e) => ground && Math.abs(deck.tops[e] - ground.height(deck.pts[e][0], deck.pts[e][1])) <= CAP_FLUSH);
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(deck.pts[i][0] - deck.pts[i - 1][0], deck.pts[i][1] - deck.pts[i - 1][1]));
    const total = cum[n - 1];
    const parapetAt = (i, full) => {
      let k = 1;
      if (endFlush[0]) k = Math.min(k, cum[i] / PARAPET_TAPER);
      if (endFlush[1]) k = Math.min(k, (total - cum[i]) / PARAPET_TAPER);
      return full * (PARAPET_FOOT + (1 - PARAPET_FOOT) * Math.max(0, Math.min(1, k)));
    };
    // the clearance at every point: where the deck stands high the soffit carries girders (QA B08: the underside was one flat dark slab)
    const clear = deck.pts.map(([x, z], i) => (ground ? deck.tops[i] - ground.height(x, z) : 0));
    const beams = isRoad ? beamOffsets(deck.width) : [];
    let s0 = 0;                                       // the arc length at the start of the segment (the dashes of the lane lines are laid on it)
    let beamOn = false;
    for (let i = 0; i + 1 < n; i++) {
      const [ax, az] = deck.pts[i];
      const [bx, bz] = deck.pts[i + 1];
      const ay = deck.tops[i], by = deck.tops[i + 1];
      let dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const sx = -dz, sz = dx;                      // the side of the segment (left): the dashes inside it
      // the road surface
      b.quad(at(i, half, ay), at(i + 1, half, by), at(i + 1, -half, by), at(i, -half, ay), isRoad ? COLOUR_ASPHALT : COLOUR_PATH);
      // the lane lines: strips of paint laid on the asphalt (a solid line is mitred like the deck, a dash lies inside its segment)
      for (const line of lines) {
        const o = line.offset, hwl = LINE_WIDTH / 2;
        if (!line.dashed) {
          b.quad(at(i, o + hwl, ay + PAINT_LIFT), at(i + 1, o + hwl, by + PAINT_LIFT), at(i + 1, o - hwl, by + PAINT_LIFT), at(i, o - hwl, ay + PAINT_LIFT), COLOUR_PAINT);
          continue;
        }
        const strip = (t0, t1) => {
          const y0 = ay + (by - ay) * (t0 / len) + PAINT_LIFT, y1 = ay + (by - ay) * (t1 / len) + PAINT_LIFT;
          const p0x = ax + dx * t0, p0z = az + dz * t0, p1x = ax + dx * t1, p1z = az + dz * t1;
          b.quad([p0x + sx * (o + hwl), y0, p0z + sz * (o + hwl)], [p1x + sx * (o + hwl), y1, p1z + sz * (o + hwl)],
            [p1x + sx * (o - hwl), y1, p1z + sz * (o - hwl)], [p0x + sx * (o - hwl), y0, p0z + sz * (o - hwl)], COLOUR_PAINT);
        };
        // the dashes that fall inside this segment: [k * period, k * period + dash] in arc length
        for (let k = Math.floor(s0 / DASH_PERIOD); k * DASH_PERIOD < s0 + len; k++) {
          const t0 = Math.max(0, k * DASH_PERIOD - s0), t1 = Math.min(len, k * DASH_PERIOD + DASH_LENGTH - s0);
          if (t1 - t0 > 0.05) strip(t0, t1);
        }
      }
      s0 += len;
      // the underside (the girder's soffit)
      b.quad(at(i, -half, ay - DECK.thickness), at(i + 1, -half, by - DECK.thickness), at(i + 1, half, by - DECK.thickness), at(i, half, ay - DECK.thickness), COLOUR_UNDER);
      // the girders under the soffit where the deck stands high (both ends of the segment clear of the ground by the beam and the fill zone): two or three beams, closed at
      // the ends of a run
      const beamHere = beams.length > 0 && Math.min(clear[i], clear[i + 1]) >= FILL_NONE + BEAM_DEPTH;
      if (beamHere) {
        const ya = ay - DECK.thickness, yb = by - DECK.thickness;
        for (const o of beams) {
          const l = o + BEAM_WIDTH / 2, r = o - BEAM_WIDTH / 2;
          b.quad(at(i, l, ya), at(i + 1, l, yb), at(i + 1, l, yb - BEAM_DEPTH), at(i, l, ya - BEAM_DEPTH), COLOUR_BEAM);                    // the left face
          b.quad(at(i + 1, r, yb), at(i, r, ya), at(i, r, ya - BEAM_DEPTH), at(i + 1, r, yb - BEAM_DEPTH), COLOUR_BEAM);                    // the right face
          b.quad(at(i, r, ya - BEAM_DEPTH), at(i, l, ya - BEAM_DEPTH), at(i + 1, l, yb - BEAM_DEPTH), at(i + 1, r, yb - BEAM_DEPTH), COLOUR_BEAM_UNDER);   // the bottom
          if (!beamOn) b.quad(at(i, r, ya), at(i, l, ya), at(i, l, ya - BEAM_DEPTH), at(i, r, ya - BEAM_DEPTH), COLOUR_BEAM);          // the start of a run
        }
      }
      if (beamOn && !beamHere) for (const o of beams) {
        const l = o + BEAM_WIDTH / 2, r = o - BEAM_WIDTH / 2, ya = ay - DECK.thickness;
        b.quad(at(i, l, ya), at(i, r, ya), at(i, r, ya - BEAM_DEPTH), at(i, l, ya - BEAM_DEPTH), COLOUR_BEAM);                               // the end of a run
      }
      beamOn = beamHere;
      if (beamOn && i + 2 === n) for (const o of beams) {
        const l = o + BEAM_WIDTH / 2, r = o - BEAM_WIDTH / 2, yb = by - DECK.thickness;
        b.quad(at(n - 1, l, yb), at(n - 1, r, yb), at(n - 1, r, yb - BEAM_DEPTH), at(n - 1, l, yb - BEAM_DEPTH), COLOUR_BEAM);
      }
      // the median over the gap to a road deck beside this one: this deck covers its half of the gap (the neighbour the other half), at its own level
      const medianSide = { 1: false, '-1': false };
      if (isRoad) {
        for (const sd of [1, -1]) {
          const ga = gapBeside(deck, ax, az, sx * sd, sz * sd), gb = gapBeside(deck, bx, bz, sx * sd, sz * sd);
          if (ga < 0 || gb < 0) continue;
          medianSide[sd] = true;
          const oa = sd * (half + ga / 2 + 0.03), ob = sd * (half + gb / 2 + 0.03), o0 = sd * half;
          const quad = [at(i, o0, ay), at(i + 1, o0, by), at(i + 1, ob, by), at(i, oa, ay)];
          b.quad(...(sd < 0 ? quad : [quad[3], quad[2], quad[1], quad[0]]), COLOUR_MEDIAN);   // (wound like the road surface: from + to - offset)
        }
      }
      // the sides of the deck: the girder, and the abutment where the deck is low (not under a median: there the two decks are one structure, and the side faces reaching down to the
      // ground between them were a row of teeth in front of the deck start)
      const L0 = at(i, half, ay), L1 = at(i + 1, half, by), R0 = at(i, -half, ay), R1 = at(i + 1, -half, by);
      const al = bottomAt(L0[0], L0[2], ay, i), bl = bottomAt(L1[0], L1[2], by, i + 1);
      const ar = bottomAt(R0[0], R0[2], ay, i), br = bottomAt(R1[0], R1[2], by, i + 1);
      const wing = deck.abut[i] && deck.abut[i + 1] ? COLOUR_ABUT : COLOUR_SIDE;
      if (!medianSide[1]) b.quad(L0, L1, [L1[0], bl, L1[2]], [L0[0], al, L0[2]], wing);
      if (!medianSide[-1]) b.quad(R1, R0, [R0[0], ar, R0[2]], [R1[0], br, R1[2]], wing);
      // the parapets (a road bridge) / the railings (a footbridge): on both sides of EVERY deck
      const ph = isRoad ? PARAPET_HEIGHT : RAILING_HEIGHT, pw = isRoad ? PARAPET_WIDTH : RAILING_WIDTH;
      const pc = isRoad ? COLOUR_PARAPET : COLOUR_RAILING;
      const pha = parapetAt(i, ph), phb = parapetAt(i + 1, ph);
      for (const sd of [1, -1]) {
        // the parapet is a wall of thickness pw along the edge: its outer face, its inner face and the strip of its top (the top must NOT span the deck: that was a lid over the whole bridge)
        const o0 = sd * half, o1 = sd * (half - pw);
        const face = (a0, b0, a1, b1) => (sd > 0 ? b.quad(a0, b0, b1, a1, pc) : b.quad(b0, a0, a1, b1, pc));
        face(at(i, o0, ay + pha), at(i + 1, o0, by + phb), at(i, o0, ay), at(i + 1, o0, by));          // the outer face
        face(at(i + 1, o1, by + phb), at(i, o1, ay + pha), at(i + 1, o1, by), at(i, o1, ay));          // the inner face
        face(at(i, o1, ay + pha), at(i + 1, o1, by + phb), at(i, o0, ay + pha), at(i + 1, o0, by + phb));   // the top of the wall
      }
      // the two ends of the parapets
      for (const e of [i === 0 ? 0 : -1, i + 2 === n ? n - 1 : -1].filter((k) => k >= 0)) {
        const y = deck.tops[e], h = parapetAt(e, ph);
        for (const sd of [1, -1]) {
          const o0 = sd * half, o1 = sd * (half - pw);
          b.quad(at(e, o0, y), at(e, o1, y), at(e, o1, y + h), at(e, o0, y + h), pc);
          b.quad(at(e, o1, y), at(e, o0, y), at(e, o0, y + h), at(e, o1, y + h), pc);
        }
      }
    }
    // the caps at the two ends
    for (const end of [0, n - 1]) {
      const y = deck.tops[end];
      const a = at(end, half, y), c = at(end, -half, y);
      const al = bottomAt(a[0], a[2], y, end), cl = bottomAt(c[0], c[2], y, end);
      // (flush on the road: the face is a sliver of a few centimetres at most, and in the grey of the girder it was a seam across the road: there it is tarmac, see CAP_FLUSH)
      const flush = ground && [a, c, at(end, 0, y)].every((q) => Math.abs(y - ground.height(q[0], q[2])) <= CAP_FLUSH);
      const capColour = flush ? COLOUR_ASPHALT : COLOUR_SIDE;
      if (end === 0) b.quad(a, [a[0], al, a[2]], [c[0], cl, c[2]], c, capColour);
      else b.quad(c, [c[0], cl, c[2]], [a[0], al, a[2]], a, capColour);
    }
    // the front walls of the abutments: across the deck at the foot of the bank, from under the ground to the soffit
    for (const f of deck.fronts) {
      const y = deck.tops[f] - DECK.thickness, o = half + ABUT_WING;
      const lo = Math.min(ground.height(...xz(at(f, o, 0))), ground.height(...xz(at(f, -o, 0))), ground.height(deck.pts[f][0], deck.pts[f][1])) - ABUT.skirt;
      b.quad(at(f, o, y), at(f, -o, y), at(f, -o, lo), at(f, o, lo), COLOUR_ABUT);
      b.quad(at(f, -o, y), at(f, o, y), at(f, o, lo), at(f, -o, lo), COLOUR_ABUT);
    }
    // the piers
    if (ground) {
      for (const p of piersOf(deck, ground, sdCarAt)) {
        const h = PIER_SIZE / 2, ux = p.dx * h, uz = p.dz * h, vx = -p.dz * h, vz = p.dx * h;
        const c = [[p.x - ux - vx, p.z - uz - vz], [p.x + ux - vx, p.z + uz - vz], [p.x + ux + vx, p.z + uz + vz], [p.x - ux + vx, p.z - uz + vz]];
        for (let k = 0; k < 4; k++) {
          const q = c[k], r = c[(k + 1) % 4];
          b.quad([q[0], p.top, q[1]], [r[0], p.top, r[1]], [r[0], p.bottom, r[1]], [q[0], p.bottom, q[1]], COLOUR_PIER);
        }
        pierCount += 1;
      }
    }
  }
  chunks.finish();
  return { meshes: chunks.meshes, count, piers: pierCount, update: chunks.update };
}
