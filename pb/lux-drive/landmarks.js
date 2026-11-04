/* The landmarks of Lux Drive: the famous places, hand-made, placed on the real data.
 *
 * Each landmark REPLACES something the bake made generically: the LOD2 blocks of its footprint (hidden by id, and taken out
 * of the collision of the buildings) or the baked bridge decks it covers (their surface stays the physics, the model draws it).
 * This module is pure (no THREE): it builds the models (landmark-bridges.js, landmark-buildings.js), collects what they hide
 * and the collision shapes of the car, so the Node harness checks the very same landmarks the browser draws.
 *
 * ctx: { buildings: the decoded LOD2 footprints, decks: the decks the physics reads, ground: (x, z) -> y of the land }. */
import { buildPontAdolphe, buildPontRouge, fixLandmarkDecks } from './landmark-bridges.js';

import { buildPhilharmonie, buildEcj, buildCathedral, buildPalais, buildGelleFra } from './landmark-buildings.js';

export { fixLandmarkDecks };

/** The builders in the order of the brief (the bridges first). A landmark that cannot be built is an error, never a silent gap. */
const BUILDERS = [
  { id: 'pont-adolphe', build: buildPontAdolphe },
  { id: 'pont-rouge', build: buildPontRouge },
  { id: 'philharmonie', build: buildPhilharmonie },
  { id: 'cour-de-justice', build: buildEcj },
  { id: 'cathedrale', build: buildCathedral },
  { id: 'palais-grand-ducal', build: buildPalais },
  { id: 'gelle-fra', build: buildGelleFra },
];

/** The closest point of a segment to (x, z). */
function closestOnSegment(w, x, z, out) {
  const ex = w.bx - w.ax, ez = w.bz - w.az;
  const ll = ex * ex + ez * ez;
  let t = ll > 1e-9 ? ((x - w.ax) * ex + (z - w.az) * ez) / ll : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.qx = w.ax + ex * t; out.qz = w.az + ez * t;
  return Math.hypot(x - out.qx, z - out.qz);
}

/** Do two bounding boxes [minX, minZ, maxX, maxZ] overlap? */
const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

export function createLandmarks({ buildings, decks, ground, only = null }) {
  const ctx = { buildings, decks, ground };
  const list = [];
  const hiddenBuildings = new Set();
  const hiddenDecks = new Set();
  const walls = [];
  for (const spec of BUILDERS) {
    if (only && !only.includes(spec.id)) continue;
    let model;
    try { model = spec.build(ctx); } catch (error) { throw new Error(`landmark ${spec.id}: ${error.message}`, { cause: error }); }
    const b = model.soup.bounds();
    list.push({ id: spec.id, soup: model.soup, info: model.info || {}, bounds: [b[0], b[2], b[3], b[5]], top: b[4], bottom: b[1] });
    for (const id of model.hideBuildings || []) hiddenBuildings.add(id);
    for (const id of model.hideDecks || []) hiddenDecks.add(id);
    for (const w of model.walls || []) walls.push(w);
  }
  const scratch = { qx: 0, qz: 0 };

  /** The push out of a landmark wall: { nx, nz, pen, id } when the circle touches one, otherwise null. */
  function collide(x, z, radius) {
    let best = null;
    for (const w of walls) {
      const d = closestOnSegment(w, x, z, scratch);
      const reach = radius + w.r;
      if (d >= reach) continue;
      const pen = reach - d;
      if (best && pen <= best.pen) continue;
      let nx, nz;
      if (d > 1e-4) { nx = (x - scratch.qx) / d; nz = (z - scratch.qz) / d; } else { nx = -(w.bz - w.az); nz = w.bx - w.ax; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; }
      best = { nx, nz, pen, id: w.id };
    }
    return best;
  }

  return { list, hiddenBuildings, hiddenDecks, walls, collide, overlaps };
}
