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
 * Rows: [cx, cz, L, W, angle, eave, ridge, ground, kind, footprint?, roof?, levels?] (scripts/ski/bake.py; old 9-field rows: the box). */
import { SHADOW_GLSL } from './shadows.js';
import { FOG_GLSL } from './snow-shader.js';

const THREE = window.THREE;
const CELL = 1280;
const FLOOR = 2.9;
const SINK = 1.6;                    // walls go this far below the lowest ground point (the uphill side is buried in the slope anyway)
/* parts (aInfo.w) */
const WALL = 0, SNOW = 1, WOOD = 2, RAIL = 3, STONE = 4, TERRACE = 5;
/* styles (aInfo.x) */
const CHALET = 0, PLASTER = 1, SAVOY = 2, CONCRETE = 3, CHAPEL = 4, HUT = 5, MODERN = 6, TOWER = 7;
export const DETAIL_RADIUS = Object.freeze({ low: 700, medium: 1300, high: 2200 });

const h1 = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/* ---------------- geometry writer ---------------- */
function writer() {
  const pos = [], nrm = [], uv = [], info = [];
  let style = 0, eave = 0, seed = 0;
  return {
    pos, nrm, uv, info,
    set(st, ev, sd) { style = st; eave = ev; seed = sd; },
    /** quad a b c d (counter-clockwise from the front), normal n, uvs [[u, v] x 4], part */
    quad(a, b, c, d, n, uvs, part) {
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const p = [a, b, c, d][k];
        pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]); uv.push(uvs[k][0], uvs[k][1]); info.push(style, eave, seed, part);
      }
    },
    tri(a, b, c, n, uvs, part) {
      for (const k of [0, 1, 2]) {
        const p = [a, b, c][k];
        pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]); uv.push(uvs[k][0], uvs[k][1]); info.push(style, eave, seed, part);
      }
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

function chalet(w, row, seed, detail, style) {
  const [, , L, W, , eave, , ground] = row;
  const P = frameOf(row);
  const hl = L / 2, hw = W / 2;
  const g0 = ground - SINK, e = ground + eave;
  // walls
  const corners = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]];
  let u = 0;
  for (let i = 0; i < 4; i++) {
    const a = P(corners[i][0], corners[i][1], 0), b = P(corners[(i + 1) % 4][0], corners[(i + 1) % 4][1], 0);
    wall(w, a[0], a[2], b[0], b[2], g0, e, ground, WALL, u);
    u += Math.hypot(b[0] - a[0], b[2] - a[2]);
  }
  const pitch = style === CHAPEL ? 0.95 : style === HUT ? 0.5 : 0.36 + 0.14 * h1(seed * 3.1);     // Savoy chalets: low, wide roofs
  const over = style === CHAPEL ? 0.5 : 1.1 + 0.5 * h1(seed * 5.3);
  const r = gableRoof(w, P, hl, hw, e, pitch, over, style === CHAPEL ? 0.4 : over * 0.9, ground);
  if (!detail) return;
  if ((style === CHALET || style === SAVOY) && eave > 4) {
    // balconies on the gable ends (and on one long side for the bigger ones), one per upper floor: slab, rail, two posts
    const floors = Math.max(1, Math.floor((eave - 0.5) / FLOOR));
    const longSide = L > 11 && h1(seed * 7.7) < 0.6;
    for (let f = 1; f < floors + 1; f++) {
      const y = ground + f * FLOOR - 0.2;
      if (y > e - 1.6) break;
      const depth = 1.3;
      for (const end of [-1, 1]) {
        const Pe = (a, b, yy) => P(end * (hl + a), b, yy);
        // slab: a = 0..depth outwards, b = -hw+0.3 .. hw-0.3
        box(w, (a, b, yy) => Pe(a, b, yy), 0, depth, -hw + 0.3, hw - 0.3, y - 0.18, y, WOOD, ground);
        // rail at the outer edge and the two sides
        const r0 = Pe(depth, -hw + 0.3, y), r1 = Pe(depth, hw - 0.3, y);
        wall(w, r0[0], r0[2], r1[0], r1[2], y, y + 1.0, y, RAIL);
        wall(w, r1[0], r1[2], r0[0], r0[2], y, y + 1.0, y, RAIL);
        for (const b of [-hw + 0.3, hw - 0.3]) {
          const s0 = Pe(0, b, y), s1 = Pe(depth, b, y);
          wall(w, s0[0], s0[2], s1[0], s1[2], y, y + 1.0, y, RAIL);
          wall(w, s1[0], s1[2], s0[0], s0[2], y, y + 1.0, y, RAIL);
        }
      }
      if (longSide) {
        const side = h1(seed * 9.1) < 0.5 ? 1 : -1;
        const Ps = (a, b, yy) => P(a, side * (hw + b), yy);
        box(w, Ps, -hl + 0.4, hl - 0.4, 0, 1.2, y - 0.18, y, WOOD, ground);
        const q0 = Ps(-hl + 0.4, 1.2, y), q1 = Ps(hl - 0.4, 1.2, y);
        wall(w, q0[0], q0[2], q1[0], q1[2], y, y + 1.0, y, RAIL);
        wall(w, q1[0], q1[2], q0[0], q0[2], y, y + 1.0, y, RAIL);
      }
    }
  }
  if (style !== HUT && style !== CHAPEL) {
    // a stone chimney through the roof, snow on its cap
    const cu = (h1(seed * 4.4) - 0.5) * L * 0.5, cv = hw * 0.35 * (h1(seed * 6.6) < 0.5 ? 1 : -1);
    const yr = e + (hw - Math.abs(cv)) * pitch;
    box(w, P, cu - 0.4, cu + 0.4, cv - 0.4, cv + 0.4, yr - 0.5, Math.max(r, yr + 1.4) + 0.3, STONE, ground);
  }
  if (style === CHAPEL) {
    // bell tower at one gable end: a square shaft above the ridge with a steep pyramid cap of snow
    const tu = hl - 1.4, s = Math.min(1.3, hw * 0.45);
    const top = r + 3.2;
    box(w, P, tu - s, tu + s, -s, s, r - 1.5, top, WALL, ground);
    const apex = P(tu, 0, top + 3.4);
    const c4 = [P(tu - s - 0.2, -s - 0.2, top), P(tu + s + 0.2, -s - 0.2, top), P(tu + s + 0.2, s + 0.2, top), P(tu - s - 0.2, s + 0.2, top)];
    for (let i = 0; i < 4; i++) { const a = c4[i], b = c4[(i + 1) % 4]; let n = faceN(a, b, apex); if (n[1] < 0) n = n.map((v) => -v); w.tri(a, b, apex, n, [[0, 0], [1, 0], [0.5, 1]], SNOW); }
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
function block(w, row, seed, detail, style, slopeDir) {
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
  if (gable) { chalet(w, row, seed, detail, style === CONCRETE ? SAVOY : style); return; }
  const g0 = ground - SINK;
  // terraces: a tall block on a slope steps back towards the uphill side, every 2-3 floors (the stepped profile of Val Claret)
  const stepped = levels >= 5 && W >= 13 && !!slopeDir && h1(seed * 8.8) < 0.75;
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
      if (detail) prismRail(w, tp, y1);
    }
    y = y1;
  }
  // flat roof: snow cap and a parapet (lift-motor housings on the big ones)
  const last = tiers === 1 ? poly : null;
  const roofPoly = last || poly.map((p) => { const d = p[0] * downhill[0] + p[1] * downhill[1] - dmin; const m = d * (1 - (tiers - 1) * Math.min(0.24, 9 / Math.max(depth, 1)) - 1); return [p[0] + downhill[0] * m, p[1] + downhill[1] * m]; });
  prism(w, roofPoly, top, top + 0.7, ground, STONE);
  cap(w, roofPoly, top + 0.55, SNOW);
  if (detail && L * W > 500) {
    const P = frameOf(row);
    box(w, P, -1.6, 1.6, -1.6, 1.6, top + 0.5, top + 2.6, STONE, ground);
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
  const r0 = Math.min(3.2, Math.max(1.6, Math.min(L, W) / 2)), r1 = r0 * 0.6, top = ground + eave, N = 8;
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

function styleOf(row, seed) {
  const kind = row[8];
  if (kind === 4) return MODERN;
  if (kind === 5) return TOWER;
  if (kind === 2) return CHAPEL;
  if (kind === 3) return HUT;
  if (kind === 0) return CHALET;
  const r = h1(seed * 13.7);
  const big = row[2] * row[3] > 1300 && row[3] >= 16;
  if (big) return r < 0.55 ? CONCRETE : r < 0.8 ? SAVOY : PLASTER;
  return r < 0.6 ? SAVOY : PLASTER;
}

/* ---------------- material ---------------- */
function material(env, cheap) {
  return new THREE.ShaderMaterial({
    uniforms: env.u,
    side: THREE.DoubleSide,
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
          float board = step(0.35, fract(vUv.x / 0.16));
          col = mix(wood * 0.45, wood * 1.05, mix(0.8, board, fadeFar));
          col = mix(col, vec3(0.93, 0.95, 1.0), step(0.86, vUv.y) * 0.85);              // snow on the handrail
        } else if (part > 3.5 && part < 4.5) {                                          // chimney, parapet: stone / concrete
          col = style > 2.5 && style < 3.5 ? concrete : style > 5.5 && style < 6.5 ? vec3(0.2, 0.21, 0.23) : stone;
          float course = step(0.88, fract(vUv.y / 0.45)) * fadeFar;
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
          float wu = style < 0.5 ? 2.3 : 2.6;
          float fu = fract(vUv.x / wu), fv = fract((y - 0.6) / 2.9);
          float floorIx = floor((y - 0.6) / 2.9);
          float inRange = step(0.9, y) * step(y, eaveH - 0.6) * step(style, 4.5);
          float win = fadeFar * step(0.36, fu) * step(fu, 0.64) * step(0.3, fv) * step(fv, 0.78) * inRange;
          float frame = fadeFar * step(0.33, fu) * step(fu, 0.67) * step(0.26, fv) * step(fv, 0.82) * inRange - win;
          float shut = style < 0.5 || style > 4.5 ? fadeFar * (step(0.2, fu) * step(fu, 0.33) + step(0.67, fu) * step(fu, 0.8)) * step(0.3, fv) * step(fv, 0.78) * inRange : 0.0;
          col = mix(col, col * 0.8, (1.0 - fadeFar) * step(0.9, y) * step(style, 4.5) * 0.55);
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
        vec3 c = col * (amb * 0.62 + uSunColor * lit * 0.82) + glow * vec3(1.0, 0.72, 0.36) * 0.9;
        gl_FragColor = vec4(applyFog(c, vDist, uFogColor, uFogDensity), 1.0);
      }`,
  });
}

function toMesh(cell, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(cell.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(cell.nrm, 3));
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(cell.uv, 2));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(cell.info, 4));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** rows = buildings.json; height(x, z) = the ground (for the downhill side of the terraced blocks); quality = QUALITY[level]. */
export function createVillage({ scene, rows, env, height, level = 'medium' }) {
  const cells = new Map();
  rows.forEach((row, i) => {
    const k = Math.floor(row[0] / CELL) + ',' + Math.floor(row[1] / CELL);
    let cell = cells.get(k);
    if (!cell) cells.set(k, (cell = { near: writer(), far: writer(), cx: (Math.floor(row[0] / CELL) + 0.5) * CELL, cz: (Math.floor(row[1] / CELL) + 0.5) * CELL, tris: 0 }));
    const seed = (i * 0.618034) % 1;
    const style = styleOf(row, seed);
    let downhill = null;
    if (height && (row[8] === 1 || row[8] === 4)) {
      const d = 25, gx = height(row[0] + d, row[1]) - height(row[0] - d, row[1]), gz = height(row[0], row[1] + d) - height(row[0], row[1] - d);
      const l = Math.hypot(gx, gz);
      if (l > 2) downhill = [-gx / l, -gz / l];       // only on a real slope
    }
    for (const [w, detail] of [[cell.near, true], [cell.far, false]]) {
      w.set(style, row[5], seed);
      if (row[8] === 5) tower(w, row);
      else if (row[8] === 1 || row[8] === 4) block(w, row, seed, detail, style, downhill);
      else chalet(w, row, seed, detail, style);
    }
  });
  let mat = material(env, level === 'low');
  const group = new THREE.Group();
  group.name = 'ski-village';
  const list = [];
  for (const cell of cells.values()) {
    const near = toMesh(cell.near, mat), far = toMesh(cell.far, mat);
    group.add(near, far);
    list.push({ near, far, cx: cell.cx, cz: cell.cz });
  }
  scene.add(group);
  let detailR = DETAIL_RADIUS[level] || DETAIL_RADIUS.medium;
  const stats = { cells: list.length, triangles: 0 };
  return {
    group, count: rows.length, stats,
    update(px, pz, radius) {
      let tris = 0;
      for (const c of list) {
        const d = Math.hypot(c.cx - px, c.cz - pz) - CELL * 0.71;
        const show = d < radius;
        c.near.visible = show && d < detailR;
        c.far.visible = show && !c.near.visible;
        if (c.near.visible) tris += c.near.geometry.attributes.position.count / 3;
        else if (c.far.visible) tris += c.far.geometry.attributes.position.count / 3;
      }
      stats.triangles = tris;
    },
    setLevel(next) {
      detailR = DETAIL_RADIUS[next] || DETAIL_RADIUS.medium;
      const m = material(env, next === 'low');
      for (const c of list) { c.near.material = m; c.far.material = m; }
      mat.dispose(); mat = m;
    },
  };
}
