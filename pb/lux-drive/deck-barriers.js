/* The parapets of the bridge decks are solid for the car (collide14, QA4 N4-B01).  The view draws a parapet (a road bridge) or a railing (a footbridge) along both
 * edges of every deck (deck-view.js), but nothing held the car on a deck: the physics carries a car DECK.margin past the edge and then lets it fall - the south side of
 * the Pont Rouge (5 of 5 stations) and the edge of every generic deck dropped a car steered at it into the valley.
 *
 * A barrier stands at the inner face of the drawn parapet wherever the deck edge falls away: where the ground or another deck beside the edge lies more than
 * BARRIER.drop under the deck (BARRIER.farDrop a little farther out).  Where something at the deck's own level lies beside the edge (a deck beside it at its level - the carriageways of a skewed
 * interchange, two links that merge, a ramp that meets the side of a deck -, the bank at an abutment) there is nothing to fall from and the car may drive across.
 * The barrier answers for the car's level: it stands from the soffit of the deck (DECK.thickness under its surface) to BARRIER.height over it, so a car under the
 * bridge or beside a low deck end is not stopped by the deck over it, a car on the ground beside a deck that stands higher than BARRIER.drop meets its side.
 * The decks a landmark model draws (landmarks.hiddenDecks: the Pont Adolphe, the Pont Rouge, the Passerelle) carry their own walls at the edges of their models.
 * Pure (no THREE). */
import { DECK } from './decks.js';
import { ROAD_MIN_WIDTH, PARAPET_WIDTH, RAILING_WIDTH, mitres } from './deck-shape.js';
import { spansLevel } from './level-span.js';

export const BARRIER = Object.freeze({
  drop: 0.5,               // m: the edge falls away where the landing beside it lies this far under the deck (a kerb-high step is no fall)
  probeOut: 1.0,           // m past the edge of the deck: where the landing is measured (beyond the wheels of a car pressed against the parapet) ...
  probeFar: 3.0,           // ... and here, where it may lie up to farDrop under the deck: a ledge of bank at deck level beside an abutment, then the cut of the road below
  farDrop: 1.0,            // (decks 142, 146, 215: the car rolled over the ledge and fell 2 - 3 m)
  step: 2.0,               // m between the samples along an edge (one barrier piece per sample interval)
  radius: 0.05,            // m: the half thickness of a barrier line (its face is at the inner face of the parapet)
  height: 1.0,             // m over the deck surface: the top of the parapet (deck-view.js PARAPET_HEIGHT 0.95, RAILING_HEIGHT 1.05)
  cell: 16,                // m: the spatial hash cell
});

/**
 * deckNetwork: decks.js createDeckNetwork (its decks with their final tops, deckAt), surface: the terrain ({ height }), skip: ids of the decks a landmark draws.
 * Returns { collide(x, z, radius, y), count (pieces), length (m), pieces: [{ deck, ax, az, ay, bx, bz, by, nx, nz }] }.
 */
export function createDeckBarriers(deckNetwork, surface, { skip = null } = {}) {
  const pieces = [];
  const scratch = { top: 0, slope: 0, ux: 1, uz: 0, along: 0 };
  /** The highest thing a car would land on at (x, z) when it left a deck whose surface is at `top` there: the terrain or another deck at about that level. */
  const landingAt = (x, z, top) => {
    const g = surface.height(x, z);
    const hit = deckNetwork.deckAt(x, z, top + DECK.hintLift, scratch);
    return hit ? Math.max(g, hit.top) : g;
  };
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
          const near = half + BARRIER.probeOut, far = half + BARRIER.probeFar;
          const falls = top - landingAt(cx + nx * sd * near, cz + nz * sd * near, top) > BARRIER.drop || top - landingAt(cx + nx * sd * far, cz + nz * sd * far, top) > BARRIER.farDrop;
          samples.push({ x: cx + sx * sd * line, z: cz + sz * sd * line, y: top, falls, nx: -nx * sd, nz: -nz * sd });
        }
      }
      for (let k = 0; k + 1 < samples.length; k++) {
        const a = samples[k], b = samples[k + 1];
        if (!a.falls && !b.falls) continue;
        pieces.push({ deck: d.id, ax: a.x, az: a.z, ay: a.y, bx: b.x, bz: b.z, by: b.y, nx: a.nx, nz: a.nz });
      }
    }
  }
  const CELL = BARRIER.cell;
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
          if (!spansLevel(y, top - DECK.thickness, top + BARRIER.height)) continue;        // under the bridge, or on a road beside a low deck end
          const nx = dd > 1e-4 ? (x - qx) / dd : p.nx, nz = dd > 1e-4 ? (z - qz) / dd : p.nz;
          best = { nx, nz, pen, id: p.deck };
        }
      }
    }
    return best;
  }

  return { collide, count: pieces.length, length, pieces };
}
