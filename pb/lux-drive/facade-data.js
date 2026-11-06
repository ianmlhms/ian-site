/* The real façades of the old town core (houses17): the data side.
 *
 * scripts/luxdrive/bake_facades.py cuts the official ACT oblique-photo textures (Bâtiments 3D 2023, CC0) to the game's own
 * LOD2 walls, cleans them up and packs the walls of every 256 m cell of the building view into one WebP atlas.  The index
 * (data/facades/index.json) says which wall of which building sits where in which atlas, plus the colours measured for
 * every house of the area (its painted wall and roof, used by the building mesh everywhere: near, far, and before the
 * atlas is there).
 *
 * The façade is a picture laid on the painted wall, a few centimetres in front of it: from the top of the wall down to the
 * painted ground floor (the shop fronts and doors of building-material.js stay painted - the aerial photos have cars,
 * shadows and smears there).  A wall the cameras did not see well is not in the atlas: it keeps its painted windows.
 *
 * Pure (no THREE), so the harness checks the very same quads as the game. */
import { facadeFrame, STYLE } from './building-mesh.js';

export const FACADE_OFFSET = 0.06;     // m in front of the painted wall (with a polygon offset: no z-fight with it at a distance)
const SHOP_BAND = 3.4;                 // m: the painted ground floor of a house (building-material.js: the shopfront up to 3.4 m)
const OFFICE_BAND = 3.6;               // m: the stone base of an office / the glass of a tower's ground floor
const TOWN_STOREY = 3.4;               // m: the storey of a town façade (building-material.js: floors = eave / 3.4, rounded)
const MIN_FACADE = 0.5;                // m: less picture than this over the painted ground floor is not drawn
const WALL_FIELDS = 9;                 // [building id, edge, side, page, x, y, w, h, depth] per wall

/** Checks the shape of the index (it comes over the network): throws with the reason when something is off. */
export function parseFacadeIndex(json) {
  if (!json || json.version !== 1) throw new Error(`facades: unknown index version ${json && json.version}`);
  if (!(json.ppm > 0) || !(json.band > 0)) throw new Error('facades: index without ppm / band');
  if (!Array.isArray(json.packs)) throw new Error('facades: index without packs');
  const packs = json.packs.map((p) => {
    if (typeof p.key !== 'string' || !Array.isArray(p.centre) || !Array.isArray(p.pages) || !Array.isArray(p.walls)) {
      throw new Error(`facades: malformed pack ${p && p.key}`);
    }
    for (const w of p.walls) if (!Array.isArray(w) || w.length !== WALL_FIELDS) throw new Error(`facades: malformed wall in pack ${p.key}`);
    for (const pg of p.pages) if (!(pg.w > 0 && pg.h > 0) || typeof pg.file !== 'string') throw new Error(`facades: malformed page in pack ${p.key}`);
    return { key: p.key, centre: [p.centre[0], p.centre[1]], pages: p.pages.map((pg) => ({ ...pg })), walls: p.walls };
  });
  const paint = new Map();
  for (const [id, c] of Object.entries(json.paint || {})) {
    if (!Array.isArray(c) || (c.length !== 3 && c.length !== 6)) throw new Error(`facades: malformed paint of ${id}`);
    paint.set(Number(id), { wall: c.slice(0, 3), roof: c.length === 6 ? c.slice(3, 6) : null });
  }
  return { ppm: json.ppm, band: json.band, box: json.box, packs, paint };
}

/** The measured colours of a building of the area for building-mesh.js ({ wall, roof } or null). */
export function facadePaintOf(index) {
  return (id) => (index && index.paint.get(id)) || null;
}

/** How high the painted ground floor of a wall reaches over `ref` (the level its storeys count from): the façade picture starts there. */
export function paintedBand(b, facadeH) {
  const style = (b.style | 0) & 7;
  if (style === STYLE.office || style === STYLE.modern) return OFFICE_BAND;
  if (style === STYLE.town) return facadeH / Math.max(1, Math.floor(facadeH / TOWN_STOREY + 0.5));       // the ground row of the town façade
  return SHOP_BAND;
}

/**
 * The quads of one pack: per atlas page { pos, nor, uv, idx } (plain arrays) and the count of walls drawn / skipped.
 * buildings: the decoded LOD2 buildings; heightAt / landAt: the ground and the land (building-mesh.js addBuilding);
 * hidden: ids a landmark replaces (no façade floats where the landmark stands).
 */
export function buildFacadePack(pack, buildings, heightAt, landAt, hidden = null) {
  const pages = pack.pages.map(() => ({ pos: [], nor: [], uv: [], idx: [] }));
  const frames = new Map();
  let drawn = 0, skipped = 0;
  for (const [id, edge, side, page, x, y, w, h, depth] of pack.walls) {
    const b = buildings[id];
    if (!b || (hidden && hidden.has(id)) || !pages[page]) { skipped += 1; continue; }
    if (!frames.has(id)) frames.set(id, facadeFrame(b, heightAt, landAt));
    const frame = frames.get(id);
    const e = frame && frame.edges[edge];
    if (!e || e.skip) { skipped += 1; continue; }
    const top = frame.eaveY;
    const bottom = Math.max(top - depth, frame.ref + paintedBand(b, frame.facadeH));
    if (top - bottom < MIN_FACADE) { skipped += 1; continue; }
    const nx = side * -(e.bz - e.az) / e.len, nz = side * (e.bx - e.ax) / e.len;           // outward (the bake's side of the wall)
    const ox = nx * FACADE_OFFSET, oz = nz * FACADE_OFFSET;
    const pg = pack.pages[page], out = pages[page];
    const u0 = x / pg.w, u1 = (x + w) / pg.w;
    // the picture's row 0 is the top of the wall; it is `depth` metres tall in `h` pixels (the texture is flipped: v = 1 - row / height)
    const v0 = 1 - y / pg.h, v1 = 1 - (y + h * ((top - bottom) / depth)) / pg.h;
    const base = out.pos.length / 3;
    out.pos.push(e.ax + ox, bottom, e.az + oz, e.bx + ox, bottom, e.bz + oz, e.bx + ox, top, e.bz + oz, e.ax + ox, top, e.az + oz);
    for (let k = 0; k < 4; k++) out.nor.push(nx, 0, nz);
    out.uv.push(u0, v1, u1, v1, u1, v0, u0, v0);
    // the front face looks along the outward normal: (b - a) x up points along (-ez, ex), i.e. side +1 keeps a-b-c
    if (side > 0) out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else out.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    drawn += 1;
  }
  return { pages, drawn, skipped };
}
