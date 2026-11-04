/* The buildings of Campus Geesseknäppchen as hand-made low-poly landmarks.
 *
 * A campus building is a list of parts (campus-data.js, baked by scripts/luxdrive/campus_bake.py): a polygon on the real footprint with
 * its own roof elevation, wall colour, facade style and roof extras.  Every part is an extruded polygon whose walls reach the ground at
 * every corner (never a floating floor); the facades (campus-facades.js) are windows, panels and piers in front of the wall; the
 * footprint of the whole building is the collision of the car.  Pure (no THREE): the Node harness builds the very same soup.
 * A building with `custom` (the Forum) has its own model (campus-custom.js) instead of the plain parts. */
import { Soup, paint, triangulate } from './landmark-soup.js';
import { edgeWalls } from './landmark-util.js';
import { wallRuns, boundsOfPoly } from './campus-walls.js';
import { drawWall, drawFacade } from './campus-facades.js';
import { drawRoofExtras, hippedRoof } from './campus-roofs.js';
import { CUSTOM } from './campus-custom.js';

const PARAPET = 0.45;              // m: the wall stands this far over the roof edge
const WALL_RADIUS = 0.4;           // m: the collision wall of the car stands this far out of the outline (landmark.js adds the car's radius)

/** A part with what the builders need: its bounds, a stable seed, the lowest ground under it. */
function prepare(part, index, ground) {
  const low = part.pts.reduce((m, [x, z]) => Math.min(m, ground(x, z)), Infinity);
  return { ...part, bounds: boundsOfPoly(part.pts), seed: index + 1, low: low - 1 };
}

/** The roof of a part: the polygon at its roof elevation (ear clipping, concave outlines are fine). */
function drawRoof(soup, part) {
  const color = part.roof || [0.45, 0.45, 0.45];
  for (const [a, b, c] of triangulate(part.pts)) {
    const A = part.pts[a], B = part.pts[b], C = part.pts[c];
    soup.tri([A[0], part.top, A[1]], [B[0], part.top, B[1]], [C[0], part.top, C[1]], paint(color, a * 13 + b, 0.02));
  }
}

/** One plain part: walls with facade, roof, roof extras. */
function buildPart(soup, ground, part, all) {
  for (const run of wallRuns(part, all)) {
    drawWall(soup, run, ground, part.top + PARAPET, part.wall, part.seed * 53 + run.i);
    drawFacade(soup, run, part, ground);
  }
  if (part.rf && part.rf.hip) {
    const { ridge, y } = hippedRoof(soup, part, part.rf.hip);
    drawRoof(soup, { ...part, pts: ridge, top: y });          // the flat top of the hip
  } else {
    drawRoof(soup, part);
  }
  drawRoofExtras(soup, part);
}

/**
 * Builds the buildings of one zone of the campus: { soup, walls, hideBuildings, info }.
 * `campus`: the baked data (CAMPUS), `zone`: which buildings, `ground`: (x, z) -> y.
 */
export function buildZone(campus, zone, ground) {
  const soup = new Soup();
  const walls = [];
  const mine = campus.buildings.filter((b) => b.zone === zone);
  const info = { buildings: mine.map((b) => b.key) };
  for (const b of mine) {
    if (b.custom) {
      const build = CUSTOM[b.custom];
      if (!build) throw new Error(`campus: building ${b.key} wants the custom model '${b.custom}', which does not exist`);
      build(soup, ground, b);
    } else {
      const parts = b.parts.map((p, i) => prepare(p, i, ground));
      for (const p of parts) buildPart(soup, ground, p, parts);
    }
    for (const ring of b.outline) walls.push(...edgeWalls(ring, WALL_RADIUS, `campus-${b.key}`));
  }
  return { soup, walls, hideBuildings: mine.flatMap((b) => b.hide), info };
}
