/* Bridge decks: closed wooden solids over the creeks where a trail crosses them (the trail does not carve under a deck, the creek stays a creek).
 * Pure functions, shared by the bike physics, the harness and props.js (which draws the planks, rails and abutments).
 *   deck = { x0, z0, x1, z1 (centre line ends), ux, uz (unit axis), w (width), yaw, len, topA, topB (absolute heights of the deck surface at the ends),
 *            knots ([[along, top], ...] the surface profile along the axis, piecewise linear), kind ('plank' = drawn by props.js, 'stone' = the Schiessentuempel arch drawn by bridge-model.js) }
 * ONE deck system for every bridge: a plank deck is a ramp between its two ends (topA / topB sit 0.1 m above the ground at the banks, never below the ground in between);
 * the stone footbridge is the same structure with four knots (ramp, flat top over the arch, ramp). */
export const DECK = Object.freeze({
  thickness: 0.16,          // m of planks + beams under the walking surface
  lift: 0.1,                // m above the bank at the ends
  sink: 0.7,                // m the abutment blocks reach below the bank (they are buried: no gap, nothing floats)
  overhang: 0.35,           // m the deck extends beyond its end samples, onto the banks
  stickBelow: 0.45,         // the bike counts as "on" the deck when it is at most this far below the surface
  maxGrade: 0.3,            // rise / run of a deck
  margin: 0.1,              // m beside the deck that still count as deck for the bike (rails keep it on)
});

/** Builds the deck list from the resolved bridge features of the trail network. surface = createSurface(...). */
export function buildDecks(features, surface) {
  const decks = [];
  for (const f of features) {
    if (f.k !== 'bridge') continue;
    const dx = f.x1 - f.x0, dz = f.z1 - f.z0;
    const len = Math.hypot(dx, dz);
    if (len < 2) continue;
    const ux = dx / len, uz = dz / len;
    const a = { x: f.x0 - ux * DECK.overhang, z: f.z0 - uz * DECK.overhang }, b = { x: f.x1 + ux * DECK.overhang, z: f.z1 + uz * DECK.overhang };
    const total = len + 2 * DECK.overhang;
    let topA = surface.height(a.x, a.z) + DECK.lift, topB = surface.height(b.x, b.z) + DECK.lift;
    // the deck never dips below the ground along its line (a bump in the middle lifts both ends' ramp)
    for (let k = 1; k < 8; k++) {
      const t = k / 8, g = surface.height(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) + 0.06;
      const line = topA + (topB - topA) * t;
      if (g > line) { const raise = g - line; topA += raise; topB += raise; }
    }
    if (Math.abs(topB - topA) / total > DECK.maxGrade) continue;            // (the baker already refuses these; a deck is never a wall)
    decks.push(Object.freeze({ id: decks.length, kind: 'plank', x0: a.x, z0: a.z, x1: b.x, z1: b.z, ux, uz, len: total, w: f.w || 1.9, yaw: Math.atan2(dz, dx), topA, topB, knots: Object.freeze([[0, topA], [total, topB]]), way: f.way }));
  }
  return decks;
}

/** The Schiessentuempel stone footbridge (landmarks.js placeBridge result `bridge`) as a deck: ramp up from the left bank, flat over the arch, ramp down to the right bank.
 *  The axis runs across the river, so the same ground/bike code that rides plank decks rides the arch. Returns a frozen deck with the given id. */
export function landmarkDeck(bridge, id) {
  const half = bridge.span / 2 + bridge.abutment, flat = bridge.span / 2 + 0.9;
  const ux = bridge.across[0], uz = bridge.across[1];
  const x0 = bridge.x - ux * half, z0 = bridge.z - uz * half;
  const len = 2 * half;
  const knots = Object.freeze([[0, bridge.endL], [half - flat, bridge.deck], [half + flat, bridge.deck], [len, bridge.endR]]);
  return Object.freeze({ id, kind: 'stone', x0, z0, x1: x0 + ux * len, z1: z0 + uz * len, ux, uz, len, w: bridge.width, yaw: Math.atan2(uz, ux), topA: bridge.endL, topB: bridge.endR, knots, way: 'landmark-footbridge' });
}

/** Surface height and slope (rise per metre along the axis) of a deck at `along` metres from its first end. */
export function deckProfile(d, along, out) {
  const k = d.knots;
  let i = 1;
  while (i < k.length - 1 && along > k[i][0]) i++;
  const [u0, h0] = k[i - 1], [u1, h1] = k[i];
  const slope = (h1 - h0) / Math.max(1e-6, u1 - u0);
  const t = Math.max(0, Math.min(1, (along - u0) / Math.max(1e-6, u1 - u0)));
  out.top = h0 + (h1 - h0) * t; out.slope = slope;
  return out;
}

/** The deck under (x, z) that the bike can stand on (its y within stickBelow of the surface) or null. out = { deck, along, top } */
const prof = { top: 0, slope: 0 };
export function deckAt(decks, x, z, y, out) {
  for (const d of decks) {
    const rx = x - d.x0, rz = z - d.z0;
    const along = rx * d.ux + rz * d.uz;
    if (along < 0 || along > d.len) continue;
    const side = Math.abs(rx * -d.uz + rz * d.ux);
    if (side > d.w / 2 + DECK.margin) continue;
    deckProfile(d, along, prof);
    const top = prof.top;
    if (y < top - DECK.stickBelow) continue;
    out.deck = d; out.along = along; out.top = top; out.slope = prof.slope;
    return out;
  }
  return null;
}

/** The ground the bike, camera and props see: the terrain surface, with the decks on top. `hint(y)` tells it how high the bike is (a rider UNDER a bridge stays under it). */
export function createGround(surface, decks) {
  let hintY = 1e9;
  const scratch = { deck: null, along: 0, top: 0, slope: 0 };
  const out = {
    height(x, z) {
      const g = surface.height(x, z);
      if (decks.length === 0) return g;
      const hit = deckAt(decks, x, z, hintY, scratch);
      return hit && hit.top > g ? hit.top : g;
    },
    normal(x, z, o) {
      if (decks.length > 0) {
        const g = surface.height(x, z);
        const hit = deckAt(decks, x, z, hintY, scratch);
        if (hit && hit.top > g) {                          // the deck is a plane along its axis
          const slope = hit.slope;
          const l = Math.hypot(slope, 1);
          o.x = -slope * hit.deck.ux / l; o.y = 1 / l; o.z = -slope * hit.deck.uz / l;
          return o;
        }
      }
      return surface.normal(x, z, o);
    },
    hint(y) { hintY = y; },
    onDeck(x, z) { return decks.length > 0 && deckAt(decks, x, z, hintY, scratch) !== null; },
    surface, decks,
  };
  return out;
}
