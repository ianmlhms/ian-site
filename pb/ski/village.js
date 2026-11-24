/* The villages (Val d'Isère, La Daille, Le Fornet, Tignes le Lac, Val Claret, Tignes 1800, Les Brévières ...) built from the OSM footprints
 * and tags of buildings.json, in Alpine architecture of our own drawing:
 *   chalet  stone ground floor, larch-wood upper floors with shuttered windows, wooden balconies on the gable ends, a low-pitched roof with a
 *           wide overhang under a thick cap of snow, a stone chimney
 *   block   the big apartment blocks of Tignes / Val Claret / La Daille from their real footprint: Savoy stone-and-wood, cream plaster or
 *           1970s concrete with balcony bands; tall ones step back in terraces up the slope (the stepped Val Claret / La Daille profile),
 *           flat snowed-in roofs with a parapet, or a gable when OSM says so
 *   chapel  white walls, a steep roof and a small bell tower;   hut  dark wood, small
 *   modern  today's mountain architecture (summit stations, the Kronplatz restaurants): stone plinth, vertical larch slats, glass
 *           ribbons, flat roofs with a dark fascia (row kind 4, villages flagged "modern" in common.py)
 *   tower   a slender transmitter shaft with red-white bands and an antenna (row kind 5: OSM man_made=tower)
 * Variety from a per-building seed (wood and stone tones, shutter colour, roof pitch, balcony sides). Painted in one shader (wall
 * patterns, windows, snow); merged per 1280 m cell, two detail levels per cell (balconies, chimneys and terraces only near).
 * Rows: [cx, cz, L, W, angle, eave, ridge, ground, kind, footprint?, roof?, levels?] (scripts/ski/bake.py; old 9-field rows: the box).
 * R8c (QA: Zürs / Kronplatz = grey 5-storey flat-roof blocks; 494-645k triangles in the villages):
 *   alpine  in the Austrian / Swiss / South Tyrol resorts (ALPINE_RESORTS) every house is Alpine: the big ones are hotels (white plaster
 *           below, larch wood above, a wooden balcony along both long sides on every upper floor, a 26-31 deg gable roof with a wide
 *           overhang), at most 4 storeys under the eaves (3 for small houses; OSM levels capped), never a flat roof (only the "modern"
 *           summit buildings keep theirs)
 *   LOD     every house = a BASE (walls, roof, snow edges, plinth: the silhouette) merged per 1280 m cell, and a DETAIL layer (balconies,
 *           chimneys, terrace rails, roof housings) merged per DCELL m cell and drawn only within DETAIL_RADIUS m of the camera (not on
 *           Niddreg beyond a short radius). A street of chalets is ~40 triangles per house from afar instead of ~200. */
import { SHADOW_GLSL } from './shadows.js';
import { FOG_GLSL } from './snow-shader.js';
import { gpuOnly } from './gpu-mem.js';

const THREE = window.THREE;
const CELL = 1280;
const FLOOR = 2.9;
const SINK = 1.6;                    // walls go this far below the lowest ground point (the uphill side is buried in the slope anyway)
/* parts (aInfo.w) */
const WALL = 0, SNOW = 1, WOOD = 2, RAIL = 3, STONE = 4, TERRACE = 5;
/* styles (aInfo.x) */
const CHALET = 0, PLASTER = 1, SAVOY = 2, CONCRETE = 3, CHAPEL = 4, HUT = 5, MODERN = 6, TOWER = 7, HOTEL = 8;
/** R8c: the detail layer's radius (m from the camera to the detail cell) per quality level */
export const DETAIL_RADIUS = Object.freeze({ low: 150, medium: 380, high: 800 });
const DCELL = 320;                   // m: the detail layer's merge cell
/** R8c: resorts whose villages are Alpine (no 1960s-70s purpose-built blocks like Tignes / Val Claret / Les Menuires / Val Thorens) */
export const ALPINE_RESORTS = Object.freeze(new Set(['zermatt', 'arlberg', 'kronplatz', 'vialattea', 'obertauern', 'livigno', 'davos', 'laax']));
/** R8c: storeys under the eaves at most: Alpine houses (small / big), anywhere else (the tallest real Tignes blocks have ~10) */
export const MAX_FLOORS = Object.freeze({ alpineSmall: 3, alpine: 4, other: 10 });
const SMALL_AREA = 150;              // m2: a small house (3 storeys at most in the Alpine villages)

const h1 = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/* ---------------- geometry writer ---------------- */
// R8f (memory): the vertices go straight into growing Float32Arrays (the plain JS number arrays of before took 8 bytes a number plus
// their growth slack: ~400 MB at the peak of Kronplatz's build); finish() hands out exact-length views for the mesh
const QUAD_ORDER = [0, 1, 2, 0, 2, 3], TRI_ORDER = [0, 1, 2];
function writer() {
  let cap = 0, n = 0;
  let pos = null, nrm = null, uv = null, info = null;
  let style = 0, eave = 0, seed = 0;
  const grow = (need) => {
    let c = Math.max(1024, cap * 2);
    while (c < need) c *= 2;
    const more = (old, k) => { const a = new Float32Array(c * k); if (old) a.set(old.subarray(0, n * k)); return a; };
    pos = more(pos, 3); nrm = more(nrm, 3); uv = more(uv, 2); info = more(info, 4);
    cap = c;
  };
  const put = (p, nv, t, part) => {
    if (n >= cap) grow(n + 1);
    pos[n * 3] = p[0]; pos[n * 3 + 1] = p[1]; pos[n * 3 + 2] = p[2];
    nrm[n * 3] = nv[0]; nrm[n * 3 + 1] = nv[1]; nrm[n * 3 + 2] = nv[2];
    uv[n * 2] = t[0]; uv[n * 2 + 1] = t[1];
    info[n * 4] = style; info[n * 4 + 1] = eave; info[n * 4 + 2] = seed; info[n * 4 + 3] = part;
    n++;
  };
  return {
    get count() { return n; },
    /** { pos, nrm, uv, info }: exact-length Float32Array views of everything written (the writer can be dropped afterwards) */
    // cleanup round (memory): views, not copies: the meshes are gpuOnly (their arrays go right after the upload), so a copy was only
    // garbage of the same size again (~40 MB over a 3 Vallees load)
    finish() { return { pos: pos.subarray(0, n * 3), nrm: nrm.subarray(0, n * 3), uv: uv.subarray(0, n * 2), info: info.subarray(0, n * 4) }; },
    set(st, ev, sd) { style = st; eave = ev; seed = sd; },
    /** quad a b c d (counter-clockwise from the front), normal n, uvs [[u, v] x 4], part */
    quad(a, b, c, d, nv, uvs, part) {
      const q = [a, b, c, d];
      for (const k of QUAD_ORDER) put(q[k], nv, uvs[k], part);
    },
    tri(a, b, c, nv, uvs, part) {
      const q = [a, b, c];
      for (const k of TRI_ORDER) put(q[k], nv, uvs[k], part);
    },
  };
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const faceN = (a, b, c) => norm(cross(sub(b, a), sub(c, a)));

/** A vertical wall from (x0, z0) to (x1, z1), y0..y1; u runs along the wall from u0 (m), v = height above `base`. */
function wall(w, x0, z0, x1, z1, y0, y1, base, part, u0 = 0) {
  const L = Math.hypot(x1 - x0, z1 - z0);
  const n = norm([z1 - z0, 0, -(x1 - x0)]);
  w.quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], n, [[u0, y0 - base], [u0 + L, y0 - base], [u0 + L, y1 - base], [u0, y1 - base]], part);
}
/** Round 7 (A): a railing panel with a real thickness (RAIL_T): two faces back to back in ONE plane flickered (z-fighting, the
 *  material is double sided); now the two faces stand RAIL_T apart, each facing out. */
const RAIL_T = 0.05;
function rail(w, x0, z0, x1, z1, y0, y1, base) {
  const L = Math.hypot(x1 - x0, z1 - z0) || 1, nx = (z1 - z0) / L * RAIL_T / 2, nz = -(x1 - x0) / L * RAIL_T / 2;
  wall(w, x0 + nx, z0 + nz, x1 + nx, z1 + nz, y0, y1, base, RAIL);
  wall(w, x1 - nx, z1 - nz, x0 - nx, z0 - nz, y0, y1, base, RAIL);
}
/** An axis box in a local frame (u along, v across, y up) mapped by P(u, v, y). */
function box(w, P, u0, u1, v0, v1, y0, y1, part, base) {
  const c = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  for (let i = 0; i < 4; i++) {
    const [ua, va] = c[i], [ub, vb] = c[(i + 1) % 4];
    const a = P(ua, va, y0), b = P(ub, vb, y0);
    const n = norm([b[2] - a[2], 0, -(b[0] - a[0])]);
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    w.quad(a, b, P(ub, vb, y1), P(ua, va, y1), n, [[0, y0 - base], [L, y0 - base], [L, y1 - base], [0, y1 - base]], part);
  }
  w.quad(P(u0, v0, y1), P(u0, v1, y1), P(u1, v1, y1), P(u1, v0, y1), [0, 1, 0], [[0, 0], [0, 1], [1, 1], [1, 0]], part === STONE ? SNOW : part);
}

/* ---------------- one building ---------------- */
function frameOf(row) {
  const [cx, cz, , , ang] = row;
  const c = Math.cos(ang), s = Math.sin(ang);
  return (u, v, y) => [cx + u * c - v * s, y, cz + u * s + v * c];
}

/** Gable roof over the box (ridge along u), with overhangs, a snow cap (top + thick edge) and a wooden soffit. Returns the ridge height. */
function gableRoof(w, P, hl, hw, e, pitch, over, gableOver, ground) {
  const rise = hw * pitch;
  const r = e + rise;
  const ol = hl + gableOver, ow = hw + over;
  const eo = e - over * pitch;                 // eave line, lower by the overhang
  const snowT = 0.38;
  for (const side of [1, -1]) {
    const a = P(-ol, side * ow, eo), b = P(ol, side * ow, eo), c = P(ol, 0, r), d = P(-ol, 0, r);
    const up = (q) => [q[0], q[1] + snowT, q[2]];
    const n = side > 0 ? faceN(up(a), up(b), up(c)) : faceN(up(b), up(a), up(d));
    const nn = n[1] < 0 ? [-n[0], -n[1], -n[2]] : n;
    const slope = Math.hypot(ow, r - eo);
    w.quad(up(a), up(b), up(c), up(d), nn, [[0, 0], [2 * ol, 0], [2 * ol, slope], [0, slope]], SNOW);
    w.quad(a, b, c, d, [-nn[0], -nn[1], -nn[2]], [[0, 0], [2 * ol, 0], [2 * ol, slope], [0, slope]], WOOD);     // soffit
    // the thick snow edge along the eave
    const ne = norm(sub(P(0, side, 0), P(0, 0, 0)));
    w.quad(a, b, up(b), up(a), ne, [[0, 0], [2 * ol, 0], [2 * ol, snowT], [0, snowT]], SNOW);
    // the snow edge along the verge (gable ends)
    for (const end of [-1, 1]) {
      const p0 = P(end * ol, side * ow, eo), p1 = P(end * ol, 0, r);
      const nv = norm(sub(P(end, 0, 0), P(0, 0, 0)));
      w.quad(p0, p1, up(p1), up(p0), nv, [[0, 0], [ow, 0], [ow, snowT], [0, snowT]], SNOW);
    }
  }
  // gable triangles (wall)
  for (const end of [-1, 1]) {
    const n = norm(sub(P(end, 0, 0), P(0, 0, 0)));
    w.tri(P(end * hl, -end * hw, e), P(end * hl, end * hw, e), P(end * hl, 0, r), n, [[0, e - ground], [2 * hw, e - ground], [hw, r - ground]], WALL);
  }
  return r;
}

function chalet(w, row, seed, wd, style) {
  const [, , L, W, , eave, , ground] = row;
  const P = frameOf(row);
  const hl = L / 2, hw = W / 2;
  const g0 = ground - SINK, e = ground + eave;
  // round 7 (A): seated on the slope: where the ground under a corner lies lower than the walls reach, a stone plinth carries the house
  // down to it (Ian: "they stand awkwardly on uneven ground")
  if (HEIGHT) {
    let low = Infinity;
    for (const [u, v] of [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw], [0, -hw], [0, hw], [-hl, 0], [hl, 0]]) { const q = P(u, v, 0); low = Math.min(low, HEIGHT(q[0], q[2])); }
    if (low < g0 + 0.2) box(w, P, -hl - 0.12, hl + 0.12, -hw - 0.12, hw + 0.12, low - 0.6, ground + 0.35 + h1(seed * 17.3) * 0.04, STONE, ground);   // R8d: no shared plane with a neighbour
  }
  // walls
  const corners = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]];
  let u = 0;
  for (let i = 0; i < 4; i++) {
    const a = P(corners[i][0], corners[i][1], 0), b = P(corners[(i + 1) % 4][0], corners[(i + 1) % 4][1], 0);
    wall(w, a[0], a[2], b[0], b[2], g0, e, ground, WALL, u);
    u += Math.hypot(b[0] - a[0], b[2] - a[2]);
  }
  // Savoy chalets: low, wide roofs; R8c Alpine hotels: 26-31 deg with a deep overhang
  const pitch = style === CHAPEL ? 0.95 : style === HUT ? 0.5 : style === HOTEL ? 0.49 + 0.11 * h1(seed * 3.1) : 0.36 + 0.14 * h1(seed * 3.1);
  const over = style === CHAPEL ? 0.5 : style === HOTEL ? 1.35 + 0.35 * h1(seed * 5.3) : 1.1 + 0.5 * h1(seed * 5.3);
  const r = gableRoof(w, P, hl, hw, e, pitch, over, style === CHAPEL ? 0.4 : over * 0.9, ground);
  if (style === CHAPEL) chapelTower(w, P, hl, hw, r, ground);           // the bell tower is part of the silhouette: base layer
  if (!wd) return;
  w = wd;                                                                // R8c: from here on the detail layer
  if (style === HOTEL) { hotelBalconies(w, P, hl, hw, eave, ground, seed); }
  else if ((style === CHALET || style === SAVOY) && eave > 4) {
    // balconies on the gable ends (and on one long side for the bigger ones), one per upper floor: slab, rail, two posts
    const floors = Math.max(1, Math.floor((eave - 0.5) / FLOOR));
    const longSide = L > 11 && h1(seed * 7.7) < 0.6;
    for (let f = 1; f < floors + 1; f++) {
      const y = ground + f * FLOOR - 0.2 + h1(seed * 31.7) * 0.04;      // round 7 (A): neighbours' balconies never share a plane (z-fighting)
      if (y > e - 1.6) break;
      const depth = 1.3;
      for (const end of [-1, 1]) {
        const Pe = (a, b, yy) => P(end * (hl + a), b, yy);
        // slab: a = 0..depth outwards, b = -hw+0.3 .. hw-0.3
        box(w, (a, b, yy) => Pe(a, b, yy), 0.03, depth, -hw + 0.3, hw - 0.3, y - 0.18, y, WOOD, ground);
        // rail at the outer edge and the two sides
        const r0 = Pe(depth, -hw + 0.3, y), r1 = Pe(depth, hw - 0.3, y);
        rail(w, r0[0], r0[2], r1[0], r1[2], y, y + 1.0, y);
        for (const b of [-hw + 0.3, hw - 0.3]) {
          const s0 = Pe(0, b, y), s1 = Pe(depth, b, y);
          rail(w, s0[0], s0[2], s1[0], s1[2], y, y + 1.0, y);
        }
      }
      if (longSide) {
        const side = h1(seed * 9.1) < 0.5 ? 1 : -1;
        const Ps = (a, b, yy) => P(a, side * (hw + b), yy);
        box(w, Ps, -hl + 0.4, hl - 0.4, 0.03, 1.2, y - 0.18, y, WOOD, ground);
        const q0 = Ps(-hl + 0.4, 1.2, y), q1 = Ps(hl - 0.4, 1.2, y);
        rail(w, q0[0], q0[2], q1[0], q1[2], y, y + 1.0, y);
      }
    }
  }
  if (style !== HUT && style !== CHAPEL) {
    // a stone chimney through the roof, snow on its cap
    const cu = (h1(seed * 4.4) - 0.5) * L * 0.5, cv = hw * 0.35 * (h1(seed * 6.6) < 0.5 ? 1 : -1);
    const yr = e + (hw - Math.abs(cv)) * pitch;
    box(w, P, cu - 0.4, cu + 0.4, cv - 0.4, cv + 0.4, yr - 0.5, Math.max(r, yr + 1.4) + 0.3, STONE, ground);
  }
}

/** bell tower at one gable end: a square shaft above the ridge with a steep pyramid cap of snow */
function chapelTower(w, P, hl, hw, r, ground) {
  const tu = hl - 1.4, s = Math.min(1.3, hw * 0.45);
  const top = r + 3.2;
  box(w, P, tu - s, tu + s, -s, s, r - 1.5, top, WALL, ground);
  const apex = P(tu, 0, top + 3.4);
  const c4 = [P(tu - s - 0.2, -s - 0.2, top), P(tu + s + 0.2, -s - 0.2, top), P(tu + s + 0.2, s + 0.2, top), P(tu - s - 0.2, s + 0.2, top)];
  for (let i = 0; i < 4; i++) { const a = c4[i], b = c4[(i + 1) % 4]; let n = faceN(a, b, apex); if (n[1] < 0) n = n.map((v) => -v); w.tri(a, b, apex, n, [[0, 0], [1, 0], [0.5, 1]], SNOW); }
}

/** R8c: an Alpine hotel's balconies: one along each long side on every upper floor (slab, a board rail, a post at each end); the big
 *  ones get one on the gable ends too. */
function hotelBalconies(w, P, hl, hw, eave, ground, seed) {
  const floors = Math.max(1, Math.floor((eave - 0.5) / FLOOR));
  const depth = 1.35, inset = Math.min(1.2, hl * 0.15);
  const jitter = h1(seed * 31.7) * 0.04;                                 // neighbours' balconies never share a plane (z-fighting)
  for (let f = 1; f < floors; f++) {
    const y = ground + f * FLOOR - 0.2 + jitter;
    if (y > ground + eave - 1.6) break;
    for (const side of [-1, 1]) {
      const Ps = (a, b, yy) => P(a, side * (hw + b), yy);
      box(w, Ps, -hl + inset, hl - inset, 0.03, depth, y - 0.2, y, WOOD, ground);
      const q0 = Ps(-hl + inset, depth, y), q1 = Ps(hl - inset, depth, y);
      if (side > 0) rail(w, q0[0], q0[2], q1[0], q1[2], y, y + 1.05, y); else rail(w, q1[0], q1[2], q0[0], q0[2], y, y + 1.05, y);
      for (const a of [-hl + inset, hl - inset]) {
        const s0 = Ps(a, 0, y), s1 = Ps(a, depth, y);
        rail(w, s0[0], s0[2], s1[0], s1[2], y, y + 1.05, y);
      }
    }
  }
}

/** Polygon helpers (x, z lists). */
function signedArea(poly) { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }

/** Extruded footprint from y0 to y1 with walls only. */
function prism(w, poly, y0, y1, base, part) {
  let u = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    wall(w, a[0], a[1], b[0], b[1], y0, y1, base, part, u);
    u += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
}
/** Flat cap of the polygon at height y (snow on top). */
function cap(w, poly, y, part) {
  const contour = poly.map((p) => new THREE.Vector2(p[0], p[1]));
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (error) { return; }
  for (const [a, b, c] of tris) {
    const A = [poly[a][0], y, poly[a][1]], B = [poly[b][0], y, poly[b][1]], C = [poly[c][0], y, poly[c][1]];
    w.tri(A, B, C, [0, 1, 0], [[A[0], A[2]], [B[0], B[2]], [C[0], C[2]]], part);
  }
}

/** The big blocks: footprint walls, terraces stepping back up the slope, a flat snowed-in roof with a parapet (or a gable). */
function block(w, row, seed, wd, style, slopeDir) {
  const downhill = slopeDir || [1, 0];
  const [cx, cz, L, W, , eave, , ground, , foot, roof, levelsRow] = row;
  let poly = [];
  if (Array.isArray(foot) && foot.length >= 6) for (let i = 0; i + 1 < foot.length; i += 2) poly.push([cx + foot[i] / 10, cz + foot[i + 1] / 10]);
  if (poly.length < 3) { const P = frameOf(row); poly = [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]].map(([u, v]) => { const p = P(u, v, 0); return [p[0], p[2]]; }); }
  if (signedArea(poly) < 0) poly.reverse();          // counter-clockwise in (x, z): walls face out
  const levels = levelsRow || Math.max(2, Math.round((eave - 0.6) / FLOOR));
  // Alpine default: a gable roof. Flat roofs (and the terraces) only where OSM says so, or for the very big purpose-built blocks of the
  // 1960s-70s resorts (Tignes, Val Claret, La Daille), recognised by their size
  const big = L * W > 1300 && W >= 16;
  const gable = style !== MODERN && (roof === 0 || roof === 2 || roof === 3 || (roof === -1 && !big));
  if (gable) { chalet(w, row, seed, wd, style === CONCRETE ? SAVOY : style); return; }
  const g0 = ground - SINK;
  // R8d: a block seated higher on its slope (seatRows) stands on a stone plinth down to the ground on its low side, like chalet()
  if (HEIGHT) {
    let low = Infinity;
    for (const p of poly) low = Math.min(low, HEIGHT(p[0], p[1]));
    // grown 0.12 m out from the middle (like chalet()'s plinth box): never in the plane of the walls (z-fighting)
    const grown = poly.map(([x, z]) => { const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz) || 1; return [x + dx / d * 0.12, z + dz / d * 0.12]; });
    if (low < g0 + 0.2) prism(w, grown, low - 0.6, ground + 0.35, ground, STONE);
  }
  // terraces: a tall block on a slope steps back towards the uphill side, every 2-3 floors (the stepped profile of Val Claret)
  const stepped = row[12] !== 1 && levels >= 5 && W >= 13 && !!slopeDir && h1(seed * 8.8) < 0.75;
  const tiers = stepped ? Math.min(4, Math.max(2, Math.floor(levels / 2.5))) : 1;
  let dmin = Infinity, dmax = -Infinity;
  for (const p of poly) { const d = p[0] * downhill[0] + p[1] * downhill[1]; dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
  const depth = dmax - dmin;
  let y = g0, base = ground;
  const top = ground + eave;
  for (let k = 0; k < tiers; k++) {
    const keep = 1 - k * Math.min(0.24, 9 / Math.max(depth, 1));       // each tier is a few metres shallower, anchored uphill
    const tp = k === 0 ? poly : poly.map((p) => { const d = p[0] * downhill[0] + p[1] * downhill[1] - dmin; const m = d * (keep - 1); return [p[0] + downhill[0] * m, p[1] + downhill[1] * m]; });
    const y1 = k === tiers - 1 ? top : ground + Math.round((eave / tiers) * (k + 1) / FLOOR) * FLOOR;
    prism(w, tp, y, y1, base, WALL);
    if (k < tiers - 1) {
      cap(w, tp, y1 + 0.02, TERRACE);
      if (wd) prismRail(wd, tp, y1);
    }
    y = y1;
  }
  // flat roof: snow cap and a parapet (lift-motor housings on the big ones)
  const last = tiers === 1 ? poly : null;
  const roofPoly = last || poly.map((p) => { const d = p[0] * downhill[0] + p[1] * downhill[1] - dmin; const m = d * (1 - (tiers - 1) * Math.min(0.24, 9 / Math.max(depth, 1)) - 1); return [p[0] + downhill[0] * m, p[1] + downhill[1] * m]; });
  prism(w, roofPoly, top, top + 0.7 + h1(seed * 13.7) * 0.04, ground, STONE);        // R8d: neighbours' parapet caps never share a plane
  cap(w, roofPoly, top + 0.55, SNOW);
  if (wd && L * W > 500) {
    const P = frameOf(row);
    box(wd, P, -1.6, 1.6, -1.6, 1.6, top + 0.5, top + 2.6, STONE, ground);
  }
}
function prismRail(w, poly, y) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    wall(w, a[0], a[1], b[0], b[1], y, y + 1.0, y, RAIL);
  }
}

/** A transmitter tower: an eight-sided concrete shaft tapering up, a platform ring, the antenna on top. */
function tower(w, row) {
  const [cx, cz, L, W, , eave, , ground] = row;
  const r0 = Math.min(2.2, Math.max(1.4, Math.min(L, W) / 3)), r1 = r0 * 0.55, top = ground + eave, N = 8;
  const ring = (r, y) => Array.from({ length: N }, (_, i) => [cx + Math.cos(i / N * Math.PI * 2) * r, y, cz + Math.sin(i / N * Math.PI * 2) * r]);
  const a = ring(r0, ground - SINK), b = ring(r1, top);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const mid = (i + 0.5) / N * Math.PI * 2, n = [Math.cos(mid), 0, Math.sin(mid)];
    const u0 = i * 2, u1 = u0 + 2;
    w.quad(a[j], a[i], b[i], b[j], n, [[u1, a[j][1] - ground], [u0, a[i][1] - ground], [u0, b[i][1] - ground], [u1, b[j][1] - ground]], WALL);
  }
  const P = (u, v, y) => [cx + u, y, cz + v];
  box(w, P, -r1 - 1.2, r1 + 1.2, -r1 - 1.2, r1 + 1.2, top - 6, top - 4.8, STONE, ground);
  box(w, P, -0.35, 0.35, -0.35, 0.35, top, top + eave * 0.25, WALL, ground);
}

/** Via Lattea: Piedmont towns (Sestriere, Sauze d'Oulx, Cesana) are plaster and stone with some wood, not the Austrian larch hotels:
 *  the Alpine shapes (gable roofs, at most 4 storeys), their own mix of facades. */
export const PIEDMONT_RESORTS = Object.freeze(new Set(['vialattea']));
function styleOf(row, seed, alpine, piedmont = false) {
  const kind = row[8];
  if (kind === 4) return MODERN;
  if (kind === 5) return TOWER;
  if (kind === 2) return CHAPEL;
  if (kind === 3) return HUT;
  if (row[12] === 1) return PLASTER;                                 // the Sestriere towers: white plaster, no Alpine hotel dress
  // R8c: an Alpine village: the big houses are hotels, the rest chalets (wood above a stone or plaster base)
  if (alpine && piedmont) {
    const r = h1(seed * 21.3);
    if (row[2] > 60) return r < 0.6 ? PLASTER : SAVOY;             // the long apartment blocks: plaster, not 100 m of larch
    return row[2] * row[3] > 260 ? (r < 0.3 ? HOTEL : r < 0.65 ? SAVOY : PLASTER) : (r < 0.35 ? CHALET : r < 0.75 ? SAVOY : PLASTER);
  }
  if (alpine) return row[2] * row[3] > 260 ? (kind === 0 && h1(seed * 21.3) < 0.4 ? SAVOY : HOTEL) : h1(seed * 21.3) < 0.75 ? CHALET : SAVOY;
  // round 7 (A): a big house flagged chalet (Méribel, Courchevel, Zermatt) was a giant wooden block: half of them get the Savoy mix
  // (stone and plaster below, wood above)
  if (kind === 0) return row[2] * row[3] > 260 && h1(seed * 21.3) < 0.5 ? SAVOY : CHALET;
  const r = h1(seed * 13.7);
  const big = row[2] * row[3] > 1300 && row[3] >= 16;
  if (big) return r < 0.55 ? CONCRETE : r < 0.8 ? SAVOY : PLASTER;
  return r < 0.6 ? SAVOY : PLASTER;
}

const SHED = Object.freeze({ area: 30, eave: 2.6, ridge: 3.8 });      // m2 / m: huts this small are sheds, one low storey
/** R8c: a row as the village draws it: in an Alpine resort every block is a gabled house (kind 0) and no house is taller than
 *  MAX_FLOORS storeys under the eaves (the OSM levels capped); the "modern" summit buildings, chapels, huts and towers stay as they are.
 *  Returns a new row (the input is never changed). */
export function tameRow(row, alpine) {
  const kind = row[8];
  if (kind === 3 && row[2] * row[3] < SHED.area && row[5] > SHED.eave) {      // a 3.9 x 3.6 m shed with 6.4 m walls read as a tower
    const out = row.slice();
    out[5] = SHED.eave; out[6] = SHED.ridge;
    return out;
  }
  if (kind !== 0 && kind !== 1) return row;
  if (row[12] === 1) return row;                                     // a real tall building the bake keeps (the Sestriere towers)
  const floors = alpine ? (row[2] * row[3] < SMALL_AREA ? MAX_FLOORS.alpineSmall : MAX_FLOORS.alpine) : MAX_FLOORS.other;
  const eaveMax = floors * FLOOR + 0.6;
  if (!alpine && row[5] <= eaveMax) return row;
  const out = row.slice();
  if (alpine) { out[8] = 0; out[10] = 0; }                           // gabled
  if (out[5] > eaveMax) {
    const drop = out[5] - eaveMax;
    out[5] = eaveMax; out[6] = Math.max(eaveMax + 1, out[6] - drop);
    if (out.length > 11 && out[11]) out[11] = Math.min(out[11], floors);
  }
  return out;
}
/** R8c: what one row is drawn as: { style, alpine row } (for the checks) */
export function houseOf(row, i, alpine) {
  const r = tameRow(row, alpine), seed = (i * 0.618034) % 1;
  return { row: r, style: styleOf(r, seed, alpine), floors: Math.round((r[5] - 0.6) / FLOOR), flat: (r[8] === 1 || r[8] === 4) && r[10] === 1 };
}

/* ---------------- material ---------------- */
function material(env, cheap) {
  return new THREE.ShaderMaterial({
    uniforms: env.u,
    side: THREE.DoubleSide,
    extensions: { derivatives: true },
    defines: cheap ? { CHEAP: 1 } : {},
    vertexShader: `
      attribute vec2 aUv; attribute vec4 aInfo;
      varying vec2 vUv; varying vec4 vInfo; varying vec3 vN; varying float vDist; varying vec3 vW;
      void main(){ vUv = aUv; vInfo = aInfo; vN = normal; vW = position; vec4 mv = viewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      #include <packing>
      ${cheap ? '' : SHADOW_GLSL}
      ${FOG_GLSL}
      uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround, uFogColor; uniform float uFogDensity, uGlow, uOvercast, uShadowOn; uniform sampler2D uShadow; uniform vec4 uShadowRect;
      varying vec2 vUv; varying vec4 vInfo; varying vec3 vN; varying float vDist; varying vec3 vW;
      float h1(float n){ return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
      void main(){
        vec3 N = normalize(vN);
        float style = vInfo.x, eaveH = vInfo.y, seed = vInfo.z, part = vInfo.w;
        vec3 wood = mix(vec3(0.5, 0.33, 0.2), vec3(0.66, 0.45, 0.27), h1(seed * 91.0));
        vec3 stone = mix(vec3(0.53, 0.51, 0.48), vec3(0.66, 0.62, 0.56), h1(seed * 17.0));
        vec3 plaster = mix(vec3(0.8, 0.74, 0.64), vec3(0.9, 0.85, 0.76), h1(seed * 53.0));
        vec3 concrete = mix(vec3(0.56, 0.55, 0.52), vec3(0.68, 0.65, 0.6), h1(seed * 29.0));
        vec3 shutter = h1(seed * 71.0) < 0.6 ? wood * 0.75 : (h1(seed * 73.0) < 0.5 ? vec3(0.32, 0.42, 0.33) : vec3(0.55, 0.22, 0.17));
        float fadeFar = 1.0 - smoothstep(160.0, 420.0, vDist);         // detail patterns would shimmer far away: their average tone instead
        vec3 col; float glow = 0.0; float snowy = 0.0;
        if (part > 0.5 && part < 1.5 || part > 4.5) {                                 // snow on roofs and terraces
          col = vec3(0.95, 0.965, 0.99); snowy = 1.0;
        } else if (part > 1.5 && part < 2.5) {                                          // soffit, balcony slab: wood
          col = wood * 0.85;
        } else if (part > 2.5 && part < 3.5) {                                          // balcony rail: vertical boards, dark gaps
          // R8c (QA: railing moire at 30-50 m): the boards anti-aliased by their own pixel footprint, their average once sub-pixel
          float bx = vUv.x / 0.16, bw = fwidth(bx);
          float board = mix(smoothstep(0.35 - bw, 0.35 + bw, fract(bx)), 0.65, smoothstep(0.3, 0.6, bw));
          col = mix(wood * 0.45, wood * 1.05, mix(0.8, board, fadeFar));
          col = mix(col, vec3(0.93, 0.95, 1.0), step(0.86, vUv.y) * 0.85);              // snow on the handrail
        } else if (part > 3.5 && part < 4.5) {                                          // chimney, parapet: stone / concrete
          col = style > 2.5 && style < 3.5 ? concrete : style > 5.5 && style < 6.5 ? vec3(0.2, 0.21, 0.23) : stone;
          float cy = vUv.y / 0.45, cw = fwidth(cy);                                     // anti-aliased (a tall wall moired)
          float course = mix(smoothstep(0.88 - cw, 0.88 + cw, fract(cy)), 0.12, smoothstep(0.3, 0.6, cw)) * fadeFar;
          col *= 1.0 - 0.12 * course;
        } else {
          // walls by style
          float y = vUv.y;
          float plank = fadeFar * smoothstep(0.78, 0.9, fract(y / 0.26)) * (1.0 - smoothstep(0.9, 1.0, fract(y / 0.26)));   // horizontal larch boards
          float courses = fadeFar * (step(0.9, fract(y / 0.42)) + step(0.92, fract((vUv.x + floor(y / 0.42) * 0.37) / 0.9)) * 0.6);
          vec3 woodWall = wood * (1.0 - 0.3 * plank) * (0.9 + 0.16 * h1(floor(y / 0.26) + seed) * fadeFar);
          vec3 stoneWall = stone * (1.0 - 0.16 * min(courses, 1.0));
          if (style < 0.5) col = y < 2.8 ? stoneWall : woodWall;                                      // chalet
          else if (style < 1.5) col = plaster;                                                          // plaster block
          else if (style < 2.5) col = y < 3.0 ? stoneWall : (y < 6.0 && h1(seed * 3.3) < 0.5 ? plaster : woodWall);   // Savoy: stone base, wood above
          else if (style < 3.5) col = concrete * (1.0 - 0.06 * fadeFar * step(0.95, fract(vUv.x / 3.2)));  // 1970s concrete, panel joints
          else if (style < 4.5) col = vec3(0.94, 0.93, 0.89);                                           // chapel
          else if (style < 5.5) col = woodWall * 0.78;                                                   // hut
          else if (style > 7.5) {                                                                        // R8c Alpine hotel: plaster below, larch above
            float plasterUp = step(0.55, h1(seed * 3.3)) * 2.9;                                          // some keep the plaster one floor higher
            col = y < 0.7 ? stoneWall : y < 3.3 + plasterUp ? plaster * 1.04 : woodWall * 0.92;
            col = mix(col, wood * 0.55, step(3.3 + plasterUp, y) * step(y, 3.48 + plasterUp));         // the dark beam where the wood starts
          }
          else if (style < 6.5) {                                                                        // modern: stone plinth, vertical larch slats
            float slat = fadeFar * step(0.72, fract(vUv.x / 0.32));
            col = y < 3.2 ? stoneWall * 0.92 : mix(vec3(0.58, 0.42, 0.28), vec3(0.66, 0.5, 0.33), h1(seed * 91.0)) * (1.0 - 0.28 * slat);
          } else {                                                                                       // tower: concrete, red-white bands up top
            float band = step(eaveH * 0.55, y) * step(0.5, fract(y / 6.0));
            col = mix(vec3(0.74, 0.73, 0.7), vec3(0.78, 0.2, 0.17), band);
          }
          // balcony bands of the blocks: a wooden slab every floor
          if (style > 0.5 && style < 3.5 && y > 3.0) {
            float b = fract((y - 0.25) / 2.9);
            col = mix(col, (style > 2.5 ? concrete * 0.82 : wood * 0.9), step(b, 0.13));
            col = mix(col, wood * 0.5, step(0.13, b) * step(b, 0.2) * 0.6);              // the shadow under the slab
          }
          // windows (with shutters on the chalets), lit in the evening
          float wu = style < 0.5 ? 2.5 : 2.7;
          float fu = fract(vUv.x / wu), fv = fract((y - 0.6) / 2.9);
          float floorIx = floor((y - 0.6) / 2.9);
          float isHotel = step(7.5, style);
          float inRange = step(0.9, y) * step(y, eaveH - 0.6) * max(step(style, 4.5), isHotel);
          // round 7 (A): windows ~1.1 x 1.35 m on a 2.9 m storey, shutters ~0.5 m beside them
          float win = fadeFar * step(0.27, fu) * step(fu, 0.73) * step(0.32, fv) * step(fv, 0.79) * inRange;
          float frame = fadeFar * step(0.25, fu) * step(fu, 0.75) * step(0.29, fv) * step(fv, 0.82) * inRange - win;
          float shut = style < 0.5 || style > 4.5 ? fadeFar * (step(0.05, fu) * step(fu, 0.24) + step(0.76, fu) * step(fu, 0.95)) * step(0.32, fv) * step(fv, 0.79) * inRange : 0.0;
          col = mix(col, col * 0.8, (1.0 - fadeFar) * step(0.9, y) * max(step(style, 4.5), isHotel) * 0.55);
          col = mix(col, shutter, shut);
          col = mix(col, vec3(0.93, 0.92, 0.88) * 0.8, frame * step(0.5, style) * step(style, 3.5));
          col = mix(col, wood * 0.5, frame * (1.0 - step(0.5, style) * step(style, 3.5)));
          float on = step(0.5, h1(floor(vUv.x / wu) * 7.3 + floorIx * 3.1 + seed * 13.0));
          col = mix(col, vec3(0.17, 0.21, 0.27) + vec3(0.05, 0.07, 0.1) * step(0.5, fract(fv * 2.0 + fu)), win);
          glow = win * on * uGlow;
          // modern: wide glass ribbons on every floor above the plinth, thin dark mullions; the sky in the glass
          if (style > 5.5 && style < 6.5) {
            float gu = fract(vUv.x / 3.6), gv = fract((y - 3.2) / 3.1);
            float ribbon = step(3.2, y) * step(y, eaveH - 0.4) * step(0.12, gv) * step(gv, 0.86) * step(0.04, gu) * step(gu, 0.96);
            vec3 glassC = mix(vec3(0.16, 0.2, 0.26), vec3(0.42, 0.52, 0.64), clamp(gv * 0.8 + 0.1, 0.0, 1.0));
            col = mix(col, glassC, mix(ribbon * 0.9, step(3.2, y) * 0.45, 1.0 - fadeFar));
            glow = max(glow, ribbon * uGlow * 0.6);
          }
          // snow pushed against the wall at the foot, a dark damp line above it
          col = mix(col, vec3(0.92, 0.94, 0.98), (1.0 - smoothstep(0.0, 0.45, y + 0.2)) * 0.9);
        }
        float vis = mix(1.0, texture2D(uShadow, (vW.xz - uShadowRect.xy) / uShadowRect.zw).r, uShadowOn);
        #ifndef CHEAP
        vis = min(vis, sunMapShadow(vW, N));
        #endif
        float lit = smoothstep(-0.1, 0.6, dot(N, uSunDir)) * vis;
        lit = mix(lit, floor(lit * 3.0 + 0.5) / 3.0, 0.3);
        vec3 amb = mix(uAmbGround, uAmbSky, 0.5 + 0.5 * N.y) * (snowy > 0.5 ? 1.08 : 1.0);
        // R8c: snow on a roof in the shade is the same soft light blue-grey as the snow on the ground (R8 snow-shader shadeL2), not the
        //      saturated sky blue (the shaded roof sides read as blue tin roofs from above)
        amb = mix(amb, vec3(dot(amb, vec3(0.3, 0.59, 0.11))) * vec3(0.93, 0.98, 1.08) * 1.06, snowy * 0.62);
        // R8f: under the low evening sun a snowy roof in the shade is the light soft blue-grey of the ground's shade (snow-shader evK)
        float evK = smoothstep(0.72, 0.5, uSunColor.b / max(uSunColor.r, 1e-3)) * (1.0 - uOvercast);
        amb = mix(amb, dot(amb, vec3(0.3, 0.59, 0.11)) * vec3(0.93, 0.985, 1.06) * 1.32, evK * snowy);
        vec3 c = col * (amb * mix(0.62, 0.9, evK * snowy) + uSunColor * lit * 0.82) + glow * vec3(1.0, 0.72, 0.36) * 0.9;
        gl_FragColor = vec4(applyFog(c, vDist, uFogColor, uFogDensity), 1.0);
      }`,
  });
}

function toMesh(w, mat) {
  const { pos, nrm, uv, info } = w.finish();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  g.computeBoundingSphere();
  gpuOnly(g);                                                            // R8f: drawn only, the JS copy goes after the upload
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** rows = buildings.json; height(x, z) = the ground (for the downhill side of the terraced blocks); quality = QUALITY[level];
 *  resort = the resort id (R8c: Alpine villages, ALPINE_RESORTS). */
let HEIGHT = null;                    // round 7 (A): the ground for the plinths (set by createVillage)
/** R8d (QA: big blocks half buried at Courchevel (14149, 4851): a 60 x 54 m residence with its baked ground at the lowest corner had
 *  16.6 of its 20.9 m walls in the hill on the uphill side): a big house (footprint > SEAT.area m2) is raised until at most SEAT.share
 *  of its walls stand in the ground at the highest corner; the stone plinth of chalet() / block() carries it down on the low side.
 *  rows = buildings.json rows, height(x, z) = the drawn ground. Returns new rows (the input is not changed). */
const SEAT = Object.freeze({ area: 400, share: 0.4 });
/** Obertauern: a house on a steep bank (a 60 x 26 m hotel on 30 m of slope) stood on a blank plinth up to 21 m high. Past DEEP.from m of
 *  ground falling away below its ground floor it goes down by whole storeys instead (the same roof line; the lower floors get the
 *  house's own windows and balconies), so at most one storey of plinth is left. Pure: returns a new row or the same one. */
const DEEP = Object.freeze({ from: 6 });
export function deepRow(row, height) {
  if (!height || (row[8] !== 0 && row[8] !== 1) || !(row[5] > 0)) return row;
  const c = Math.cos(row[4]), s = Math.sin(row[4]);
  let low = Infinity;
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
    low = Math.min(low, height(row[0] + c * u * row[2] / 2 - s * v * row[3] / 2, row[1] + s * u * row[2] / 2 + c * v * row[3] / 2));
  }
  if (!(row[7] - low > DEEP.from)) return row;
  const down = Math.floor((row[7] - low) / FLOOR) * FLOOR;
  const out = row.slice();
  out[5] += down; out[6] += down; out[7] -= down;
  return out;
}

export function seatRows(rows, height) {
  return rows.map((b) => {
    if (b[2] * b[3] <= SEAT.area || !(b[5] > 0)) return b;
    const c = Math.cos(b[4]), s = Math.sin(b[4]);
    let hi = -Infinity;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      hi = Math.max(hi, height(b[0] + c * u * b[2] / 2 - s * v * b[3] / 2, b[1] + s * u * b[2] / 2 + c * v * b[3] / 2));
    }
    const ground = hi - SEAT.share * b[5];
    if (!(ground > b[7])) return b;
    const out = b.slice();
    out[7] = ground;
    return out;
  });
}

/** R8f (memory): the village is built per CELL (1280 m) cell when the camera comes within the building radius + LAZY.ahead m (the
 *  nearest first, time-sliced: LAZY.budget ms a frame, LAZY.nearBudget when the camera is close to it) and dropped again beyond the
 *  radius + LAZY.keep m. Built cells go to the GPU at once (upload(object): gpu-mem.js uploadNow; their JS copies go). Before, the whole
 *  resort's houses stayed built: Kronplatz ~105 MB of vertices on the GPU and (until R8f) again in JS. */
export const LAZY = Object.freeze({ ahead: 500, keep: 1500, budget: 3, nearBudget: 40 });

export function createVillage({ scene, rows, env, height, level = 'medium', resort = '', upload = null }) {
  HEIGHT = height || null;
  const alpine = ALPINE_RESORTS.has(resort), piedmont = PIEDMONT_RESORTS.has(resort);
  const byCell = new Map();
  rows.forEach((row0, i) => {
    const row = alpine ? deepRow(tameRow(row0, alpine), height) : tameRow(row0, alpine);
    const k = Math.floor(row[0] / CELL) + ',' + Math.floor(row[1] / CELL);
    let l = byCell.get(k);
    if (!l) byCell.set(k, (l = []));
    l.push([row, i]);
  });
  let mat = material(env, level === 'low');
  const group = new THREE.Group();
  group.name = 'ski-village';
  scene.add(group);
  // cells: { items, cx, cz, base: Mesh | null, dets: [{ m, x0, z0 }], built, job }
  const cells = [];
  for (const [k, items] of byCell) {
    const [ci, cj] = k.split(',').map(Number);
    cells.push({ items, cx: (ci + 0.5) * CELL, cz: (cj + 0.5) * CELL, base: null, dets: [], built: false, job: null });
  }
  byCell.clear();
  let detailR = DETAIL_RADIUS[level] || DETAIL_RADIUS.medium;
  const tris = (m) => m.geometry.attributes.position.count / 3;
  const stats = { cells: cells.length, details: 0, triangles: 0, built: 0, builds: 0, drops: 0 };
  let active = null;                                                          // the cell being built (its job runs over frames)

  function buildRow(J, row, i) {
    const di = Math.floor(row[0] / DCELL), dj = Math.floor(row[1] / DCELL), dk = di + ',' + dj;
    let det = J.details.get(dk);
    if (!det) J.details.set(dk, (det = { w: writer(), x0: di * DCELL, z0: dj * DCELL }));
    const seed = (i * 0.618034) % 1;
    const style = styleOf(row, seed, alpine, piedmont);
    let downhill = null;
    if (height && (row[8] === 1 || row[8] === 4)) {
      const d = 25, gx = height(row[0] + d, row[1]) - height(row[0] - d, row[1]), gz = height(row[0], row[1] + d) - height(row[0], row[1] - d);
      const l = Math.hypot(gx, gz);
      if (l > 2) downhill = [-gx / l, -gz / l];       // only on a real slope
    }
    J.cw.set(style, row[5], seed);
    det.w.set(style, row[5], seed);
    if (row[8] === 5) tower(J.cw, row);
    else if (row[8] === 1 || row[8] === 4) block(J.cw, row, seed, det.w, style, downhill);
    else chalet(J.cw, row, seed, det.w, style);
  }
  /** Runs cell c's build until done (true) or the budget is spent (false). */
  function stepBuild(c, t0, budget) {
    if (!c.job) c.job = { n: 0, cw: writer(), details: new Map() };
    const J = c.job;
    while (J.n < c.items.length) {
      const [row, i] = c.items[J.n++];
      buildRow(J, row, i);
      if (performance.now() - t0 > budget) break;
    }
    if (J.n < c.items.length) return false;
    const fresh = new THREE.Group();
    if (J.cw.count) { c.base = toMesh(J.cw, mat); fresh.add(c.base); }
    for (const det of J.details.values()) {
      if (!det.w.count) continue;
      const m = toMesh(det.w, mat);
      m.castShadow = false;                                                // small parts: the base casts the house's shadow
      c.dets.push({ m, x0: det.x0, z0: det.z0 });
      fresh.add(m);
    }
    c.job = null;
    c.built = true;
    stats.built++; stats.builds++; stats.details += c.dets.length;
    if (upload) upload(fresh);                                             // on the GPU now: the JS copies go (gpuOnly)
    for (const o of [...fresh.children]) group.add(o);
    return true;
  }
  function drop(c) {
    if (c.base) { group.remove(c.base); c.base.geometry.dispose(); }
    for (const d of c.dets) { group.remove(d.m); d.m.geometry.dispose(); }
    stats.details -= c.dets.length;
    c.base = null; c.dets = []; c.built = false; c.job = null;
    stats.built--; stats.drops++;
  }
  const reach = (c, px, pz) => Math.hypot(c.cx - px, c.cz - pz) - CELL * 0.71;      // m from the camera to the cell's circle

  const api = {
    group, count: rows.length, stats,
    /** Builds / drops cells around (px, pz) and shows the base meshes within `radius`, the details within the detail radius. */
    update(px, pz, radius) {
      const t0 = performance.now();
      for (const c of cells) if (c.built && reach(c, px, pz) > radius + LAZY.keep) drop(c);
      if (active && reach(active, px, pz) > radius + LAZY.keep) { active.job = null; active = null; }
      // the nearest missing cell (a running job first unless a nearer one is needed now)
      let best = null, bd = Infinity;
      for (const c of cells) { if (c.built) continue; const d = reach(c, px, pz); if (d < radius + LAZY.ahead && d < bd) { bd = d; best = c; } }
      if (best && (!active || bd < reach(active, px, pz) - 200)) active = best;
      if (active) {
        const near = reach(active, px, pz) < detailR + 300;
        if (stepBuild(active, t0, near ? LAZY.nearBudget : LAZY.budget)) active = null;
      }
      let t = 0;
      for (const c of cells) {
        if (!c.built) continue;
        if (c.base) { c.base.visible = reach(c, px, pz) < radius; if (c.base.visible) t += tris(c.base); }
        for (const d of c.dets) {
          const dx = Math.max(d.x0 - px, 0, px - d.x0 - DCELL), dz = Math.max(d.z0 - pz, 0, pz - d.z0 - DCELL);   // to the cell's square
          d.m.visible = Math.hypot(dx, dz) < detailR;
          if (d.m.visible) t += tris(d.m);
        }
      }
      stats.triangles = t;
    },
    /** Builds every cell within `radius` of (px, pz) now (flows / checks that look at the houses right after a jump). */
    buildNear(px, pz, radius) {
      for (const c of cells) if (!c.built && reach(c, px, pz) < radius) { while (!stepBuild(c, performance.now(), Infinity)) { /* runs to the end */ } if (active === c) active = null; }
      api.update(px, pz, radius);
    },
    pending: (px, pz, radius) => cells.filter((c) => !c.built && reach(c, px, pz) < radius).length,
    setLevel(next) {
      detailR = DETAIL_RADIUS[next] || DETAIL_RADIUS.medium;
      const m = material(env, next === 'low');
      for (const c of cells) { if (c.base) c.base.material = m; for (const d of c.dets) d.m.material = m; }
      mat.dispose(); mat = m;
    },
  };
  return api;
}
