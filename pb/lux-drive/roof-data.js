/* The real roofs of the old town core (houses17): the data side.
 *
 * scripts/luxdrive/bake_facades.py lays the official ACT oblique-photo textures (Bâtiments 3D 2023, CC0) of every roof, seen
 * from straight above, over the footprint box of the game's own building and packs the roofs of every 256 m cell of the
 * building view into one WebP atlas.  The index (data/roofs/index.json) says where each roof sits in which atlas, plus the
 * colour measured from the photo for every roof of the area (the painted roof under the photo, and the roof of a cell whose
 * pack is not loaded: the same colour, so the photos pop in without a colour jump).
 *
 * Ian shipped the roofs only: the walls stay the painted walls (the façade photos were blurry at car height).
 *
 * The photo is a picture laid on the game's own roof faces (building-mesh.js roofFaces), a few centimetres over them.
 * Pure (no THREE), so the harness checks the very same quads as the game. */
import { facadeFrame, roofFaces } from './building-mesh.js';

const ROOF_FIELDS = 9;                 // [building id, page, x, y, w, h, x0, z0, ppm] per roof photo (seen from above; pixel (0, 0) = world x0, z0)
export const ROOF_LIFT = 0.05;         // m over the painted roof (with the polygon offset of the material)

/** Checks the shape of the index (it comes over the network): throws with the reason when something is off. */
export function parseRoofIndex(json) {
  if (!json || json.version !== 2) throw new Error(`roofs: unknown index version ${json && json.version}`);
  if (!Array.isArray(json.packs)) throw new Error('roofs: index without packs');
  const packs = json.packs.map((p) => {
    if (typeof p.key !== 'string' || !Array.isArray(p.centre) || !Array.isArray(p.pages) || !Array.isArray(p.roofs)) {
      throw new Error(`roofs: malformed pack ${p && p.key}`);
    }
    for (const r of p.roofs) if (!Array.isArray(r) || r.length !== ROOF_FIELDS) throw new Error(`roofs: malformed roof in pack ${p.key}`);
    for (const pg of p.pages) if (!(pg.w > 0 && pg.h > 0) || typeof pg.file !== 'string') throw new Error(`roofs: malformed page in pack ${p.key}`);
    return { key: p.key, centre: [p.centre[0], p.centre[1]], pages: p.pages.map((pg) => ({ ...pg })), roofs: p.roofs };
  });
  const paint = new Map();
  for (const [id, c] of Object.entries(json.paint || {})) {
    if (!Array.isArray(c) || c.length !== 3) throw new Error(`roofs: malformed paint of ${id}`);
    paint.set(Number(id), { wall: null, roof: c.slice() });
  }
  return { box: json.box, packs, paint };
}

/** The measured colours of a building of the area for building-mesh.js ({ wall: null, roof } or null): the roof only, the wall stays the palette's. */
export function roofPaintOf(index) {
  return (id) => (index && index.paint.get(id)) || null;
}

/**
 * The quads of one pack: per atlas page { pos, nor, uv, idx } (plain arrays) and the count of roofs drawn / skipped.
 * buildings: the decoded LOD2 buildings; heightAt / landAt: the ground and the land (building-mesh.js addBuilding);
 * hidden: ids a landmark replaces (no roof floats where the landmark stands).
 */
export function buildRoofPack(pack, buildings, heightAt, landAt, hidden = null) {
  const pages = pack.pages.map(() => ({ pos: [], nor: [], uv: [], idx: [] }));
  const frames = new Map();
  let drawn = 0, skipped = 0;
  for (const [id, page, x, y, w, h, x0, z0, ppm] of pack.roofs) {
    const b = buildings[id];
    if (!b || (hidden && hidden.has(id)) || !pages[page]) { skipped += 1; continue; }
    if (!frames.has(id)) frames.set(id, facadeFrame(b, heightAt, landAt));
    const frame = frames.get(id);
    if (!frame) { skipped += 1; continue; }
    const pg = pack.pages[page], out = pages[page];
    const uvOf = (px, pz) => [(x + Math.min(w, Math.max(0, (px - x0) * ppm))) / pg.w, 1 - (y + Math.min(h, Math.max(0, (pz - z0) * ppm))) / pg.h];
    for (const f of roofFaces(b, frame)) {
      const [a, b2, c] = f.points;
      let nx = (b2[1] - a[1]) * (c[2] - a[2]) - (b2[2] - a[2]) * (c[1] - a[1]);
      let ny = (b2[2] - a[2]) * (c[0] - a[0]) - (b2[0] - a[0]) * (c[2] - a[2]);
      let nz = (b2[0] - a[0]) * (c[1] - a[1]) - (b2[1] - a[1]) * (c[0] - a[0]);
      const l = Math.hypot(nx, ny, nz) || 1;
      const up = ny >= 0 ? 1 : -1;                       // the face looks up (faceUp of building-mesh.js)
      nx *= up / l; ny *= up / l; nz *= up / l;
      const base = out.pos.length / 3;
      for (const p of f.points) {
        out.pos.push(p[0] + nx * ROOF_LIFT, p[1] + ny * ROOF_LIFT, p[2] + nz * ROOF_LIFT);
        out.nor.push(nx, ny, nz);
        out.uv.push(...uvOf(p[0], p[2]));
      }
      const tri = up > 0 ? [0, 1, 2] : [0, 2, 1];
      out.idx.push(base + tri[0], base + tri[1], base + tri[2]);
      if (f.points.length === 4) out.idx.push(...(up > 0 ? [base, base + 2, base + 3] : [base, base + 3, base + 2]));
    }
    drawn += 1;
  }
  return { pages, drawn, skipped };
}
