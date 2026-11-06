/* The parapets of the bridge decks are solid for the car (collide14, QA4 N4-B01).  The view draws a parapet (a road bridge) or a railing (a footbridge) along both
 * edges of every deck (deck-view.js), but nothing held the car on a deck: the physics carries a car DECK.margin past the edge and then lets it fall - the south side of
 * the Pont Rouge (5 of 5 stations) and the edge of every generic deck dropped a car steered at it into the valley.
 *
 * A barrier stands at the inner face of the drawn parapet wherever the deck edge falls away: where the ground or another deck beside the edge lies more than
 * BARRIER.drop under the deck (BARRIER.farDrop a little farther out).  Where something at the deck's own level lies beside the edge (a deck beside it at its level - the carriageways of a skewed
 * interchange, two links that merge, a ramp that meets the side of a deck -, the bank at an abutment) there is nothing to fall from and the car may drive across.
 * The barrier answers for the car's level: it holds a car whose wheels are at the deck's level (no more than BARRIER.drop under its surface: the car that could fall
 * off), up to BARRIER.height over it.  A car under the bridge, or on a road or a lower deck beside it (the lanes of Rue de la Cimenterie along deck 142, the ramps of
 * the Buchler car park, deck 27 beside deck 26), is not stopped by it.
 * The decks a landmark model draws (landmarks.hiddenDecks: the Pont Adolphe, the Pont Rouge, the Passerelle) carry their own walls at the edges of their models.
 * Pure (no THREE). */
import { DECK, CAR_DECK_KINDS } from './decks.js';
import { ROAD_MIN_WIDTH, PARAPET_WIDTH, RAILING_WIDTH, mitres } from './deck-shape.js';
import { spansLevel } from './level-span.js';
import { CAR } from './config.js';
import { createLaneSegments, segmentGap, laneOffsets } from './lane-clearance.js';
import { wayOf, wayEnds, laneRoute } from './deck-lanes.js';

export const BARRIER = Object.freeze({
  drop: 0.5,               // m: the edge falls away where the landing beside it lies this far under the deck (a kerb-high step is no fall)
  probeOut: 1.0,           // m past the edge of the deck: where the landing is measured (beyond the wheels of a car pressed against the parapet) ...
  probeFar: 3.0,           // ... and here, where it may lie up to farDrop under the deck: a ledge of bank at deck level beside an abutment, then the cut of the road below
  farDrop: 1.0,            // (decks 142, 146, 215: the car rolled over the ledge and fell 2 - 3 m)
  step: 2.0,               // m between the samples along an edge (one barrier piece per sample interval)
  radius: 0.05,            // m: the half thickness of a barrier line (its face is at the inner face of the parapet)
  height: 1.0,             // m over the deck surface: the top of the parapet (deck-view.js PARAPET_HEIGHT 0.95, RAILING_HEIGHT 1.05)
  laneClear: CAR.bodyRadius + 0.05 + 0.1,   // m: a piece keeps this from the centre line of every lane at its level (the body circle, the barrier's half thickness, 0.1 for the bends)
  cover: 1.0,              // m: an edge that lies on another deck within this of its level is no edge (two decks side by side, overlapping)
  cell: 16,                // m: the spatial hash cell
});

/**
 * The candidates that the car's body touches on the lanes of a deck as a car drives them (deck-lanes.js: the lanes of the way the deck carries along the deck's axis,
 * on into the ways at its ends - harness Q1 / T3): at a hairpin of a track bridge or where a deck meets another at an angle (service decks 197 / 103 at the Gare) the
 * way's own lane line (lane-clearance.js) and the deck's lanes part.  The body: its nose and tail circles along the heading of the lane, at the level of the deck it
 * rides on.  Returns the set of candidate indices.
 */
export function deckLaneTouches(candidates, decks, roads, levelAt) {
  const CELL = BARRIER.cell, cells = new Map(), key = (x, z) => Math.floor(x / CELL) * 65536 + Math.floor(z / CELL);
  candidates.forEach((c, i) => { for (const k of new Set([key(c.ax, c.az), key(c.bx, c.bz)])) { const l = cells.get(k); if (l) l.push(i); else cells.set(k, [i]); } });
  const out = new Set();
  const reach = CAR.bodyRadius + BARRIER.radius + LANE_SLACK;
  /** The candidates within the body circle at (x, z): [[index, top there]]. */
  const touching = (x, z) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let hits = null;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const i of cells.get((cx + a) * 65536 + cz + b) || []) {
      const c = candidates[i], ex = c.bx - c.ax, ez = c.bz - c.az, ll = ex * ex + ez * ez || 1, t = Math.max(0, Math.min(1, ((x - c.ax) * ex + (z - c.az) * ez) / ll));
      if (Math.hypot(x - c.ax - ex * t, z - c.az - ez * t) >= reach) continue;
      (hits || (hits = [])).push([i, c.ay + (c.by - c.ay) * t]);
    }
    return hits;
  };
  const ends = wayEnds(roads);
  const boxes = new Map();
  const boxOf = (r) => {
    let b = boxes.get(r);
    if (!b) { b = [Infinity, Infinity, -Infinity, -Infinity]; for (const [x, z] of r.pts) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], z); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], z); } boxes.set(r, b); }
    return b;
  };
  for (const d of decks) {
    if (d.pts.length < 2 || !candidates.length) continue;
    // (the ways whose box meets the deck's box)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of d.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const g = 2;                                                                       // (the way of a deck passes within 1.5 m of most of its points)
    const near = roads.filter((r) => { const b = boxOf(r); return b[0] <= x1 + g && b[2] >= x0 - g && b[1] <= z1 + g && b[3] >= z0 - g; });
    const way = wayOf(d, near);
    if (!way || !CAR_DECK_KINDS.has(way.kind)) continue;
    for (const off of new Set([0, ...laneOffsets({ ...way, width: Math.min(way.width, d.width) })])) {
      const route = laneRoute(d, off, way, ends);
      if (route.none) continue;
      for (const pts of [route.pts, route.pts.slice().reverse()]) {
        let y = levelAt(pts[0][0], pts[0][1], 1e4);                                       // (the car starts ON a deck where there is one, then keeps to its level)
        for (let i = 0; i + 1 < pts.length; i++) {
          const [ax, az] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az);
          if (l < 1e-3) continue;
          const ux = (bx - ax) / l, uz = (bz - az) / l;
          for (let s = 0; s <= l; s += LANE_STEP) {
            const x = ax + ux * s, z = az + uz * s;
            const hits = CAR.bodyCircles.flatMap((o) => touching(x + ux * o, z + uz * o) || []);
            if (!hits.length) continue;                                                   // (the level is asked only where a candidate is touched: the hint carries on)
            y = levelAt(x, z, y + DECK.hintLift);
            for (const [i, top] of hits) if (y >= top - BARRIER.drop && y < top + BARRIER.height) out.add(i);
          }
        }
      }
    }
  }
  return out;
}
const LANE_STEP = 0.5;           // m along a deck lane
const LANE_SLACK = 0.03;         // m

/**
 * deckNetwork: decks.js createDeckNetwork (its decks with their final tops, deckAt), surface: the terrain ({ height }), skip: ids of the decks a landmark draws,
 * roads: the decoded ways - a piece that would reach a lane of a car road at its level is left out (lane-clearance.js: the lanes are where the car may drive; as the
 * retaining walls keep out of them, drive12).  Where a lane comes that close to a parapet, the deck and its way disagree (a footway deck that overlaps the carriageway
 * beside it, a way wider than its deck): the lane wins.
 * Returns { collide(x, z, radius, y), count (pieces), length (m), pieces: [{ deck, ax, az, ay, bx, bz, by, nx, nz }] }.
 */
export function createDeckBarriers(deckNetwork, surface, { skip = null, roads = null } = {}) {
  const CELL = BARRIER.cell;
  const cellOf = (x, z) => Math.floor(x / CELL) * 65536 + Math.floor(z / CELL);
  const scratch = { top: 0, slope: 0, ux: 1, uz: 0, along: 0 };
  // the ground as the wheels read it: the continuous carve (decks.js createGround contact; the 1 m lattice of surface.height costs ~1000 x as much and is what the
  // renderer draws, within centimetres of it on the carriageways)
  const groundAt = surface.field ? (x, z) => surface.field.height(x, z) : (x, z) => surface.height(x, z);
  /** The highest thing a car would land on at (x, z) when it left a deck whose surface is at `top` there: the terrain or another deck at about that level. */
  const landingAt = (x, z, top) => {
    const g = groundAt(x, z);
    const hit = deckNetwork.deckAt(x, z, top + DECK.hintLift, scratch);
    return hit ? Math.max(g, hit.top) : g;
  };
  // the deck segments in a hash: is a point on ANOTHER deck at about this level (the inner edge of a footway deck that overlaps the carriageway deck beside it: that
  // edge is a kerb of LiDAR noise, 0.5 m, not a drop - deck 26 over the lanes of deck 27, Pont Joseph Bech)
  const segCells = new Map();
  deckNetwork.decks.forEach((d) => {
    for (let i = 0; i + 1 < d.pts.length; i++) {
      const [ax, az] = d.pts[i], [bx, bz] = d.pts[i + 1], h = d.width / 2;
      for (let cx = Math.floor((Math.min(ax, bx) - h) / CELL); cx <= Math.floor((Math.max(ax, bx) + h) / CELL); cx++) {
        for (let cz = Math.floor((Math.min(az, bz) - h) / CELL); cz <= Math.floor((Math.max(az, bz) + h) / CELL); cz++) {
          const k = cx * 65536 + cz, list = segCells.get(k);
          if (list) list.push([d, i]); else segCells.set(k, [[d, i]]);
        }
      }
    }
  });
  const onOtherDeck = (x, z, top, self) => {
    for (const [d, i] of segCells.get(cellOf(x, z)) || []) {
      if (d === self) continue;
      const [ax, az] = d.pts[i], [bx, bz] = d.pts[i + 1], ex = bx - ax, ez = bz - az, ll = ex * ex + ez * ez;
      const t = ll > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / ll)) : 0;
      if (Math.hypot(x - ax - ex * t, z - az - ez * t) > d.width / 2) continue;
      if (Math.abs(d.tops[i] + (d.tops[i + 1] - d.tops[i]) * t - top) <= BARRIER.cover) return true;
    }
    return false;
  };

  // ---- the candidate pieces: where an edge falls away
  let candidates = [];
  for (const d of deckNetwork.decks) {
    if (d.pts.length < 2 || (skip && skip.has(d.id))) continue;
    const half = d.width / 2;
    const face = half - (d.width >= ROAD_MIN_WIDTH ? PARAPET_WIDTH : RAILING_WIDTH);       // the inner face of the drawn parapet / railing
    const line = Math.max(0.5, face + BARRIER.radius);
    const side = mitres(d.pts);
    for (const sd of [1, -1]) {
      // the samples of this edge: along every segment of the axis, the offset point on the mitred line, the deck level, and whether the edge falls away there
      const samples = [];
      for (let i = 0; i + 1 < d.pts.length; i++) {
        const [ax, az] = d.pts[i], [bx, bz] = d.pts[i + 1], l = Math.hypot(bx - ax, bz - az);
        if (l < 1e-3) continue;
        const nx = -(bz - az) / l, nz = (bx - ax) / l;
        const steps = Math.max(1, Math.ceil(l / BARRIER.step));
        for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
          const t = k / steps;
          const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t, top = d.tops[i] + (d.tops[i + 1] - d.tops[i]) * t;
          const sx = side[i][0] + (side[i + 1][0] - side[i][0]) * t, sz = side[i][1] + (side[i + 1][1] - side[i][1]) * t;
          const x = cx + sx * sd * line, z = cz + sz * sd * line;
          const near = half + BARRIER.probeOut, far = half + BARRIER.probeFar;
          const falls = !onOtherDeck(x, z, top, d) && (top - landingAt(cx + nx * sd * near, cz + nz * sd * near, top) > BARRIER.drop
            || top - landingAt(cx + nx * sd * far, cz + nz * sd * far, top) > BARRIER.farDrop);
          samples.push({ x, z, y: top, falls, nx: -nx * sd, nz: -nz * sd });
        }
      }
      for (let k = 0; k + 1 < samples.length; k++) {
        const a = samples[k], b = samples[k + 1];
        if (a.falls || b.falls) candidates.push({ deck: d.id, ax: a.x, az: a.z, ay: a.y, bx: b.x, bz: b.z, by: b.y, nx: a.nx, nz: a.nz });
      }
    }
  }

  // ---- the lanes win: a candidate within BARRIER.laneClear of a lane at its level is left out
  let yielded = 0;
  if (roads) {
    const near = new Set();
    const reach = BARRIER.laneClear + CAR.bodyCircles[0] + 1;
    for (const p of candidates) for (const [x, z] of [[p.ax, p.az], [p.bx, p.bz]]) for (const ox of [-reach, 0, reach]) for (const oz of [-reach, 0, reach]) near.add(cellOf(x + ox, z + oz));
    const nearPiece = (x, z) => near.has(cellOf(x, z));
    const net = surface.field && surface.field.network;
    const isOpen = (r) => !!(net && net.roads[r.id] && net.roads[r.id].openCut);
    const levelScratch = { top: 0, slope: 0, ux: 1, uz: 0, along: 0 };
    const wheelGround = { levelAt: (x, z, y) => { const g = groundAt(x, z), hit = deckNetwork.deckAt(x, z, y, levelScratch); return hit && hit.top > g ? hit.top : g; } };
    // (only the ways that pass a cell near a candidate - sampled every half cell along their segments: the others cannot reach one)
    const passes = (r) => r.pts.some((p, i) => {
      if (nearPiece(p[0], p[1])) return true;
      if (i === 0) return false;
      const q = r.pts[i - 1], n = Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / (CELL / 2));
      for (let k = 1; k < n; k++) if (nearPiece(q[0] + ((p[0] - q[0]) * k) / n, q[1] + ((p[1] - q[1]) * k) / n)) return true;
      return false;
    });
    // (the level along the lanes: the deck where one is clearly over the land - judged against the DTM, 8 x cheaper than the carve - else the wheel ground)
    const base = surface.field && surface.field.baseHeight ? (x, z) => surface.field.baseHeight(x, z) : groundAt;
    const laneLevel = (x, z, y) => { const hit = deckNetwork.deckAt(x, z, y, levelScratch); return hit && hit.top > base(x, z) + 1 ? hit.top : wheelGround.levelAt(x, z, y); };
    const lanes = createLaneSegments({ roads: roads.filter(passes), ground: { levelAt: laneLevel }, surface: { height: base }, isOpen, within: nearPiece });
    const inLane = (c) => lanes.near(c.ax, c.az, c.bx, c.bz, BARRIER.laneClear).some((p) => {
      const g = segmentGap(p.ax, p.az, p.bx, p.bz, c.ax, c.az, c.bx, c.bz);
      if (g.d >= BARRIER.laneClear) return false;
      const top = c.ay + (c.by - c.ay) * g.t;
      return Math.max(p.ay, p.by) >= top - BARRIER.drop && Math.min(p.ay, p.by) < top + BARRIER.height;
    });
    const onDeckLane = deckLaneTouches(candidates, deckNetwork.decks, roads.filter(passes), laneLevel);
    const kept = candidates.filter((c, i) => !onDeckLane.has(i) && !inLane(c));
    yielded = candidates.length - kept.length;
    candidates = kept;
  }
  const pieces = candidates;

  const key = (cx, cz) => (cx + 8192) * 32768 + (cz + 8192);
  const cells = new Map();
  let length = 0;
  pieces.forEach((p, i) => {
    length += Math.hypot(p.bx - p.ax, p.bz - p.az);
    for (let cx = Math.floor(Math.min(p.ax, p.bx) / CELL); cx <= Math.floor(Math.max(p.ax, p.bx) / CELL); cx++) {
      for (let cz = Math.floor(Math.min(p.az, p.bz) / CELL); cz <= Math.floor(Math.max(p.az, p.bz) / CELL); cz++) {
        const k = key(cx, cz), list = cells.get(k);
        if (list) list.push(i); else cells.set(k, [i]);
      }
    }
  });

  /** The push out of a parapet: { nx, nz, pen, id } when the circle touches one at the car's height (y: the level of its wheels; NaN = every height), otherwise null. */
  function collide(x, z, radius, y = NaN) {
    if (pieces.length === 0) return null;
    const reach = radius + BARRIER.radius;
    const c = Math.ceil(reach / CELL);
    const cx0 = Math.floor(x / CELL), cz0 = Math.floor(z / CELL);
    let best = null;
    for (let dx = -c; dx <= c; dx++) {
      for (let dz = -c; dz <= c; dz++) {
        const list = cells.get(key(cx0 + dx, cz0 + dz));
        if (!list) continue;
        for (const i of list) {                    // (a piece in two cells is measured twice: the same answer)
          const p = pieces[i];
          const ex = p.bx - p.ax, ez = p.bz - p.az, ll = ex * ex + ez * ez;
          let t = ll > 1e-9 ? ((x - p.ax) * ex + (z - p.az) * ez) / ll : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = p.ax + ex * t, qz = p.az + ez * t, dd = Math.hypot(x - qx, z - qz);
          if (dd >= reach) continue;
          const pen = reach - dd;
          if (best && pen <= best.pen) continue;
          const top = p.ay + (p.by - p.ay) * t;
          if (Number.isFinite(y) && (y < top - BARRIER.drop || !spansLevel(y, top, top + BARRIER.height))) continue;      // a car not at the deck's level: under it, beside it below
          const nx = dd > 1e-4 ? (x - qx) / dd : p.nx, nz = dd > 1e-4 ? (z - qz) / dd : p.nz;
          best = { nx, nz, pen, id: p.deck };
        }
      }
    }
    return best;
  }

  return { collide, count: pieces.length, length, pieces, yielded };
}
