/* The landmarks of Lux Drive: the famous places, hand-made, placed on the real data.
 *
 * Each landmark REPLACES something the bake made generically: the LOD2 blocks of its footprint (hidden by id, and taken out
 * of the collision of the buildings) or the baked bridge decks it covers (their surface stays the physics, the model draws it).
 * This module is pure (no THREE): it builds the models (landmark-bridges.js, landmark-buildings.js), collects what they hide
 * and the collision shapes of the car, so the Node harness checks the very same landmarks the browser draws.
 *
 * ctx: { buildings: the decoded LOD2 footprints, decks: the decks the physics reads, ground: (x, z) -> y of the land }. */
import { spansLevel } from './level-span.js';
import { buildPontAdolphe, buildPontRouge, fixLandmarkDecks } from './landmark-bridges.js';

import { buildPhilharmonie, buildEcj, buildCathedral, buildPalais, buildGelleFra, buildOberanven } from './landmark-buildings.js';

import { buildBock, buildPasserelle, buildCoque, buildThuengen, buildMudam, buildBcee } from './landmark-sites.js';

import { buildGare } from './landmark-gare.js';

import { CAMPUS_BUILDERS } from './campus.js';   // CAMPUS: Campus Geesseknäppchen (campus.js)

export { fixLandmarkDecks };

/** The builders in the order of the brief (the bridges first). A landmark that cannot be built is an error, never a silent gap. */
const TREE_CLEARING = 40;          // m: the generated woods keep this far from the walls of the buildings people come to see (`clearTrees`)
const BUILDERS = [
  { id: 'pont-adolphe', build: buildPontAdolphe },
  { id: 'pont-rouge', build: buildPontRouge },
  { id: 'philharmonie', build: buildPhilharmonie, clearTrees: true },
  { id: 'cour-de-justice', build: buildEcj, clearTrees: true },
  { id: 'cathedrale', build: buildCathedral, clearTrees: true },
  { id: 'palais-grand-ducal', build: buildPalais, clearTrees: true },
  { id: 'gelle-fra', build: buildGelleFra },
  { id: 'oberanven-kierch', build: buildOberanven },
  { id: 'bock', build: buildBock },
  { id: 'passerelle', build: buildPasserelle },
  { id: 'coque', build: buildCoque, clearTrees: true },
  { id: 'fort-thuengen', build: buildThuengen, clearTrees: true },
  { id: 'mudam', build: buildMudam, clearTrees: true },
  { id: 'bcee', build: buildBcee, clearTrees: true },
  { id: 'gare-centrale', build: buildGare, clearTrees: true },     // city12: the station building, missing from the bake
  ...CAMPUS_BUILDERS,                                  // CAMPUS: the schools of Geesseknäppchen (one model per zone)
];

/** The closest point of a segment to (x, z). */
function closestOnSegment(w, x, z, out) {
  const ex = w.bx - w.ax, ez = w.bz - w.az;
  const ll = ex * ex + ez * ez;
  let t = ll > 1e-9 ? ((x - w.ax) * ex + (z - w.az) * ez) / ll : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.qx = w.ax + ex * t; out.qz = w.az + ez * t; out.t = t;
  return Math.hypot(x - out.qx, z - out.qz);
}

/** Do two bounding boxes [minX, minZ, maxX, maxZ] overlap? */
const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

const GUARD_LEVEL_REACH = 2.5;     // m: a car counts as on a landmark deck (at its guard rails) when its wheels are within this of the deck's level there

export function createLandmarks({ buildings, decks, ground, roads = [], only = null }) {
  /** A wall with its height (a NEW object): a guard rail of a bridge carries its deck's level along it (`levels`, set by the builder: landmark-util.js deckLevels); any
   *  other wall stands from the ground under its ends to the top of its landmark. */
  const levelled = (w, top) => (Array.isArray(w.levels) && w.levels.length ? { ...w, level: 'deck' }
    : { ...w, level: 'ground', y0: Math.min(ground(w.ax, w.az), ground(w.bx, w.bz)), y1: top });
  const ctx = { buildings, decks, ground, roads };
  const list = [];
  const hiddenBuildings = new Set();
  const hiddenDecks = new Set();
  const walls = [];
  const treeFree = [];            // [{ poly, margin }]: the trees OSM maps one by one keep this far from the walls of these footprints (the façades the photographs show without a tree in front)
  const footprints = [];         // the bridges as decks for the trees: no tree grows on or through them
  const clearings = [];
  for (const spec of BUILDERS) {
    if (only && !only.includes(spec.id)) continue;
    let model;
    try { model = spec.build(ctx); } catch (error) { throw new Error(`landmark ${spec.id}: ${error.message}`, { cause: error }); }
    const b = model.soup.bounds();
    if (spec.clearTrees) clearings.push([b[0] - TREE_CLEARING, b[2] - TREE_CLEARING, b[3] + TREE_CLEARING, b[5] + TREE_CLEARING]);
    list.push({ id: spec.id, soup: model.soup, info: model.info || {}, bounds: [b[0], b[2], b[3], b[5]], top: b[4], bottom: b[1] });
    for (const id of model.hideBuildings || []) hiddenBuildings.add(id);
    for (const id of model.hideDecks || []) hiddenDecks.add(id);
    for (const w of model.walls || []) walls.push(levelled(w, model.soup.bounds()[4]));
    for (const f of model.footprints || []) footprints.push(f);
    for (const t of model.treeFree || []) treeFree.push(t);
  }
  const scratch = { qx: 0, qz: 0, t: 0 };

  /** True when the car (wheels at y; NaN = every height) is at the level of wall w at the point t (0..1) along it (drive12, QA3 N3-B01: the guard rails of the
   *  Pont Rouge stopped nothing under it only because no road was driven there; a house wall of a landmark is as high as the landmark). */
  const atLevel = (w, y, t) => {
    if (!Number.isFinite(y) || !w.level) return true;
    if (w.level === 'deck') {
      const f = t * (w.levels.length - 1), i = Math.min(w.levels.length - 2, Math.floor(f));
      const at = w.levels.length === 1 ? w.levels[0] : w.levels[i] + (w.levels[i + 1] - w.levels[i]) * (f - i);
      return Math.abs(y - at) <= GUARD_LEVEL_REACH;
    }
    return spansLevel(y, w.y0, w.y1);
  };

  /** The push out of a landmark wall: { nx, nz, pen, id } when the circle touches one at the car's height (y: the level of its wheels), otherwise null. */
  function collide(x, z, radius, y = NaN) {
    let best = null;
    for (const w of walls) {
      const d = closestOnSegment(w, x, z, scratch);
      const reach = radius + w.r;
      if (d >= reach) continue;
      const pen = reach - d;
      if (best && pen <= best.pen) continue;
      if (!atLevel(w, y, scratch.t)) continue;
      let nx, nz;
      if (d > 1e-4) { nx = (x - scratch.qx) / d; nz = (z - scratch.qz) / d; } else { nx = -(w.bz - w.az); nz = w.bx - w.ax; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; }
      best = { nx, nz, pen, id: w.id };
    }
    return best;
  }

  return { list, hiddenBuildings, hiddenDecks, walls, collide, overlaps, clearings, footprints, treeFree };
}
