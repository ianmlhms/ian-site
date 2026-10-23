/* Schueberfouer Tycoon, W3: the model kit.  A Builder collects triangles into the four shared channels (solid, lamp, sign, signLit) plus bulb and fx
 * points, then `finish()` returns a THREE.Group that follows the W3/W4 model contract (see index.js).  Coordinates: x right, y up, z = FRONT (+z faces
 * the alley), origin = pitch centre on the ground.  All primitives respect a transform stack (push / pop / translate / rotY ...).
 * Colours are hex numbers / CSS strings / [r,g,b] (sRGB, converted once). Everything is flat shaded unless `smooth` is asked for; solid vertices get
 * a baked height gradient (cheap ambient occlusion) and a tiny per-face tint jitter so painted bodies do not look dead. */
import { getMaterials } from './materials.js';
import { signPainter, muralPainter, lockPainter, stylePainter } from './atlas.js';

const T = globalThis.THREE;
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function mulberry(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ colours */
const COLCACHE = new Map();
const tmpC = new T.Color();
/** hex / css string / [r,g,b linear] -> [r,g,b] linear floats (cached) */
export function col(c) {
  if (Array.isArray(c)) return c;
  let v = COLCACHE.get(c);
  if (!v) { tmpC.set(c); v = [tmpC.r, tmpC.g, tmpC.b]; COLCACHE.set(c, v); }
  return v;
}
export const mix = (a, b, t) => { const x = col(a); const y = col(b); return [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)]; };
export const shade = (a, k) => { const x = col(a); return [x[0] * k, x[1] * k, x[2] * k]; };

/** the three Looks (DESIGN 3.2) + shared colours.  `led` = the chasing LED colours, `bulb` = the warm bare bulb */
export const GOLD = 0xe6b13a;
export const PAL = [
  { name: 'traditioun', main: 0xb3262d, second: 0xf6ead0, accent: 0x2f6a4c, trim: 0xd6a436, dark: 0x5b3a26, floor: 0x5a4a3c, led: [0xffd05a, 0xff7a3a, 0xffe9b0], bulb: 0xffd890, awn: [0xb3262d, 0xf6ead0] },
  { name: 'neon', main: 0x22103f, second: 0x41e8ff, accent: 0xff3fc8, trim: 0x8a5bff, dark: 0x120a24, floor: 0x1a1430, led: [0x41e8ff, 0xff3fc8, 0x8a5bff], bulb: 0xbfefff, awn: [0x22103f, 0x8a5bff] },
  { name: 'retro', main: 0x1f5fb8, second: 0xfdfdf6, accent: 0xe8c040, trim: 0x2d6fd0, dark: 0x1a3f78, floor: 0x3d4a5a, led: [0xffe27a, 0xffffff, 0x7fb0ee], bulb: 0xfff2c0, awn: [0x1f5fb8, 0xfdfdf6] },
];
export const C = {
  white: 0xf6f3ea, cream: 0xf1e6c8, black: 0x1d1b1a, grey: 0x8a8f94, steel: 0xb9c0c6, darkSteel: 0x535c63, wood: 0x8a5a34, darkWood: 0x4a2f1e, lightWood: 0xb98b58,
  red: 0xc8283a, orange: 0xf08a2a, yellow: 0xf4c430, green: 0x2f9a58, darkGreen: 0x1f5e46, blue: 0x2a6fc8, lightBlue: 0x7fb6ee, purple: 0x7a47c8, pink: 0xee6fa8, cyan: 0x25c6d8,
  skin: 0xf0c4a0, skin2: 0xc98e64, gold: GOLD, brass: 0xc9a13a, copper: 0xb9672f, asphalt: 0x4a4d52, plate: 0x9aa1a8, tile: 0x8a3f2f, shingle: 0x6b4a3a, hay: 0xe3c36a,
};
export const FIG_COLS = [0xd8433a, 0x2d79c8, 0x3aa05a, 0xf0b52f, 0x8a5bc8, 0xee7a9a, 0x2f2f3a, 0xf4f0e6, 0xe06a2a, 0x3ab5b0];

/* ------------------------------------------------------------------ geometry accumulators */
class Acc {
  constructor(hasPh, hasDepth) { this.p = []; this.n = []; this.c = []; this.u = []; this.ph = hasPh ? [] : null; this.d = hasDepth ? [] : null; }
  get tris() { return this.p.length / 9; }
  get empty() { return this.p.length === 0; }
}

export class Builder {
  /** opts: { seed, far, name } */
  constructor(opts = {}) {
    this.M = getMaterials();
    this.far = !!opts.far;
    this.rnd = opts.rnd || mulberry(opts.seed || 1);
    this.ch = { solid: new Acc(), ground: new Acc(), fabric: new Acc(), lamp: new Acc(true), sign: new Acc(), signLit: new Acc(), swing: new Acc(false, true) };
    this.swingTop = 0;
    this.bulbs = [];            // x,y,z, r,g,b, size, phase
    this.fxp = [];              // x,y,z, r,g,b, size, phase, kind
    this.parts = [];            // child builders (animated parts)
    this.pivot = [0, 0, 0];
    this.name = opts.name || 'root';
    this.m = new T.Matrix4();
    this.stack = [];
    this.jit = 0.05;
    this.ao = true;
    this.aoY = 0;               // ground level of the ambient-occlusion gradient (batched scenes bake in game-frame y)
  }

  /* ---- transform stack */
  push() { this.stack.push(this.m.clone()); return this; }
  pop() { this.m = this.stack.pop(); return this; }
  translate(x, y, z) { this.m.multiply(new T.Matrix4().makeTranslation(x, y, z)); return this; }
  rotY(a) { this.m.multiply(new T.Matrix4().makeRotationY(a)); return this; }
  rotX(a) { this.m.multiply(new T.Matrix4().makeRotationX(a)); return this; }
  rotZ(a) { this.m.multiply(new T.Matrix4().makeRotationZ(a)); return this; }
  scale(x, y, z) { this.m.multiply(new T.Matrix4().makeScale(x, y === undefined ? x : y, z === undefined ? x : z)); return this; }
  /** run fn with a temporary transform */
  at(x, y, z, yaw, fn) { this.push().translate(x, y, z); if (yaw) this.rotY(yaw); fn(this); this.pop(); return this; }
  P(x, y, z) { const e = this.m.elements; return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]; }
  D(x, y, z) { const e = this.m.elements; const a = e[0] * x + e[4] * y + e[8] * z; const b = e[1] * x + e[5] * y + e[9] * z; const c = e[2] * x + e[6] * y + e[10] * z; const l = Math.hypot(a, b, c) || 1; return [a / l, b / l, c / l]; }

  /* ---- raw emission (points already in model space) */
  _tri(ch, a, b, c, color, nrm, uv, ph) {
    const A = this.ch[ch];
    let n = nrm;
    if (!n) {
      const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2]; const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
      let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) return;
      nx /= l; ny /= l; nz /= l; n = [[nx, ny, nz], [nx, ny, nz], [nx, ny, nz]];
    }
    const pts = [a, b, c];
    const multi = Array.isArray(color[0]);
    const jit = ch === 'solid' || ch === 'fabric' || ch === 'ground' ? 1 + (this.rnd() - 0.5) * this.jit : 1;
    for (let i = 0; i < 3; i++) {
      const P = pts[i]; A.p.push(P[0], P[1], P[2]); A.n.push(n[i][0], n[i][1], n[i][2]);
      const k = multi ? color[i] : color;
      let r = k[0] * jit; let g = k[1] * jit; let bl = k[2] * jit;
      if (ch === 'solid' && this.ao) { const f = 0.74 + 0.26 * clamp((P[1] - this.aoY + 0.4) / 1.9, 0, 1); r *= f; g *= f; bl *= f; }
      A.c.push(r, g, bl);
      if (uv) A.u.push(uv[i][0], uv[i][1]); else A.u.push(0, 0);
      if (A.ph) A.ph.push(ph || 0);
      if (A.d) A.d.push(Math.max(0, this.swingTop - P[1]));
    }
  }
  _quad(ch, a, b, c, d, color, nrm, uv, ph, dbl) {
    this._tri(ch, a, b, c, color, nrm && [nrm[0], nrm[1], nrm[2]], uv && [uv[0], uv[1], uv[2]], ph);
    this._tri(ch, a, c, d, color, nrm && [nrm[0], nrm[2], nrm[3]], uv && [uv[0], uv[2], uv[3]], ph);
    if (dbl) { this._tri(ch, a, c, b, color, null, uv && [uv[0], uv[2], uv[1]], ph); this._tri(ch, a, d, c, color, null, uv && [uv[0], uv[3], uv[2]], ph); }
  }

  /** a triangle in local coordinates */
  tri(a, b, c, color, o = {}) { this._tri(o.ch || 'solid', this.P(...a), this.P(...b), this.P(...c), col(color), null, null, o.ph); if (o.dbl) this._tri(o.ch || 'solid', this.P(...a), this.P(...c), this.P(...b), col(color), null, null, o.ph); return this; }
  /** a quad a-b-c-d in local coordinates, counter-clockwise seen from the front; o.dbl also draws the back */
  quad(a, b, c, d, color, o = {}) { this._quad(o.ch || 'solid', this.P(...a), this.P(...b), this.P(...c), this.P(...d), col(color), null, null, o.ph, o.dbl); return this; }
  /** fan polygon (convex, counter-clockwise) at constant y or explicit 3d points */
  poly(pts, color, o = {}) {
    const q = pts.map((p) => this.P(p[0], p[1], p[2]));
    for (let i = 1; i < q.length - 1; i++) { this._tri(o.ch || 'solid', q[0], q[i], q[i + 1], col(color), null, null, o.ph); if (o.dbl) this._tri(o.ch || 'solid', q[0], q[i + 1], q[i], col(color), null, null, o.ph); }
    return this;
  }

  /* ---- primitives */
  /** box centred at x,z with its BASE at y.  o: ch, cols {top, bottom, front, back, left, right}, bottom (draw bottom), yaw */
  box(x, y, z, w, h, d, color, o = {}) {
    if (o.yaw) { this.push().translate(x, 0, z).rotY(o.yaw); const r = this.box(0, y, 0, w, h, d, color, Object.assign({}, o, { yaw: 0 })); this.pop(); return r; }
    const ch = o.ch || 'solid'; const cs = o.cols || {}; const hx = w / 2; const hz = d / 2; const y1 = y + h;
    const c = (k) => col(cs[k] !== undefined ? cs[k] : color);
    const p = (px, py, pz) => this.P(x + px, py, z + pz);
    const A = p(-hx, y, hz); const B = p(hx, y, hz); const Cc = p(hx, y1, hz); const Dd = p(-hx, y1, hz);
    const E = p(-hx, y, -hz); const F = p(hx, y, -hz); const G = p(hx, y1, -hz); const H = p(-hx, y1, -hz);
    if (!o.noFront) this._quad(ch, A, B, Cc, Dd, c('front'), null, null, o.ph);
    if (!o.noBack) this._quad(ch, F, E, H, G, c('back'), null, null, o.ph);
    this._quad(ch, B, F, G, Cc, c('right'), null, null, o.ph);
    this._quad(ch, E, A, Dd, H, c('left'), null, null, o.ph);
    if (!o.noTop) this._quad(ch, Dd, Cc, G, H, c('top'), null, null, o.ph);
    if (o.bottom) this._quad(ch, E, F, B, A, c('bottom'), null, null, o.ph);
    return this;
  }
  /** a box between two y levels, handy for plinths: boxY(x,z,w,d,y0,y1) */
  slab(x, z, w, d, y0, y1, color, o = {}) { return this.box(x, y0, z, w, y1 - y0, d, color, o); }

  /** cylinder / cone frustum, base at y.  o: seg, smooth (default true), cap (top), bottom, alt [c1,c2] alternating wedges, ch, arc [a0,a1] */
  cyl(x, y, z, r0, r1, h, seg, color, o = {}) {
    const n = this.far ? Math.max(5, Math.ceil(seg / 2)) : seg; const ch = o.ch || 'solid';
    const smooth = o.smooth !== false; const a0 = o.arc ? o.arc[0] : 0; const span = o.arc ? o.arc[1] - o.arc[0] : TAU;
    const slope = (r0 - r1) / (h || 1);
    for (let i = 0; i < n; i++) {
      const t0 = a0 + span * i / n; const t1 = a0 + span * (i + 1) / n; const tm = (t0 + t1) / 2;
      const c0 = Math.cos(t0); const s0 = Math.sin(t0); const c1 = Math.cos(t1); const s1 = Math.sin(t1);
      const p00 = this.P(x + s0 * r0, y, z + c0 * r0); const p10 = this.P(x + s1 * r0, y, z + c1 * r0);
      const p11 = this.P(x + s1 * r1, y + h, z + c1 * r1); const p01 = this.P(x + s0 * r1, y + h, z + c0 * r1);
      const cc = o.alt ? col(o.alt[i & 1]) : col(color);
      let nrm = null;
      if (smooth) { const na = this.D(s0, slope, c0); const nb = this.D(s1, slope, c1); nrm = [na, nb, nb, na]; } else { const nm = this.D(Math.sin(tm), slope, Math.cos(tm)); nrm = [nm, nm, nm, nm]; }
      if (r1 < 1e-5) this._tri(ch, p00, p10, p11, cc, [nrm[0], nrm[1], nrm[2]], null, o.ph);
      else if (r0 < 1e-5) this._tri(ch, p00, p11, p01, cc, [nrm[0], nrm[2], nrm[3]], null, o.ph);
      else this._quad(ch, p00, p10, p11, p01, cc, nrm, null, o.ph);
      if (o.cap && r1 > 1e-5) this._tri(ch, this.P(x, y + h, z), p01, p11, col(o.capColor || color), null, null, o.ph);
      if (o.bottom && r0 > 1e-5) this._tri(ch, this.P(x, y, z), p10, p00, col(o.bottomColor || color), null, null, o.ph);
      if (o.dbl) this._quad(ch, p00, p01, p11, p10, cc, null, null, o.ph);
    }
    return this;
  }
  cone(x, y, z, r, h, seg, color, o = {}) { return this.cyl(x, y, z, r, 0, h, seg, color, o); }
  /** flat annulus / disc facing up at y; rIn 0 = disc */
  disc(x, y, z, rOut, rIn, seg, color, o = {}) {
    const n = this.far ? Math.max(6, Math.ceil(seg / 2)) : seg; const ch = o.ch || 'solid'; const up = o.down ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const t0 = TAU * i / n; const t1 = TAU * (i + 1) / n;
      const a = this.P(x + Math.sin(t0) * rOut, y, z + Math.cos(t0) * rOut); const b = this.P(x + Math.sin(t1) * rOut, y, z + Math.cos(t1) * rOut);
      const cc = o.alt ? col(o.alt[i & 1]) : col(color);
      if (rIn < 1e-5) { const ce = this.P(x, y, z); if (up > 0) this._tri(ch, ce, a, b, cc, null, null, o.ph); else this._tri(ch, ce, b, a, cc, null, null, o.ph); }
      else {
        const c = this.P(x + Math.sin(t1) * rIn, y, z + Math.cos(t1) * rIn); const d = this.P(x + Math.sin(t0) * rIn, y, z + Math.cos(t0) * rIn);
        if (up > 0) this._quad(ch, a, b, c, d, cc, null, null, o.ph); else this._quad(ch, a, d, c, b, cc, null, null, o.ph);
      }
    }
    return this;
  }
  /** lathe: profile = [[r, y], ...] bottom to top, colour per segment either one colour or an array of colours (one per profile step) */
  lathe(x, y, z, prof, seg, color, o = {}) {
    const n = this.far ? Math.max(6, Math.ceil(seg / 2)) : seg; const ch = o.ch || 'solid';
    for (let k = 0; k < prof.length - 1; k++) {
      const [r0, y0] = prof[k]; const [r1, y1] = prof[k + 1]; const cc = o.cols ? col(o.cols[k % o.cols.length]) : col(color);
      const dr = r1 - r0; const dy = y1 - y0; const nl = Math.hypot(dr, dy) || 1;
      for (let i = 0; i < n; i++) {
        const t0 = TAU * i / n; const t1 = TAU * (i + 1) / n;
        const s0 = Math.sin(t0); const c0 = Math.cos(t0); const s1 = Math.sin(t1); const c1 = Math.cos(t1);
        const a = this.P(x + s0 * r0, y + y0, z + c0 * r0); const b = this.P(x + s1 * r0, y + y0, z + c1 * r0); const c = this.P(x + s1 * r1, y + y1, z + c1 * r1); const d = this.P(x + s0 * r1, y + y1, z + c0 * r1);
        const na = this.D(s0 * dy / nl, -dr / nl, c0 * dy / nl); const nb = this.D(s1 * dy / nl, -dr / nl, c1 * dy / nl);
        if (r0 < 1e-5) this._tri(ch, a, c, d, cc, [na, nb, na], null, o.ph); else if (r1 < 1e-5) this._tri(ch, a, b, c, cc, [na, nb, nb], null, o.ph);
        else this._quad(ch, a, b, c, d, cc, [na, nb, nb, na], null, o.ph);
      }
    }
    return this;
  }
  /** low-poly UV sphere (ellipsoid with o.sy) */
  sphere(x, y, z, r, color, o = {}) {
    const sg = this.far ? 5 : (o.seg || 7); const rows = Math.max(3, Math.round(sg * 0.6)); const ch = o.ch || 'solid'; const sy = o.sy || 1;
    const ring = (j) => { const t = Math.PI * j / rows; return [Math.sin(t) * r, Math.cos(t) * r * sy]; };
    for (let j = 0; j < rows; j++) {
      const [ra, ya] = ring(j); const [rb, yb] = ring(j + 1);
      for (let i = 0; i < sg; i++) {
        const t0 = TAU * i / sg; const t1 = TAU * (i + 1) / sg;
        const a = this.P(x + Math.sin(t0) * ra, y + ya, z + Math.cos(t0) * ra); const b = this.P(x + Math.sin(t1) * ra, y + ya, z + Math.cos(t1) * ra);
        const c = this.P(x + Math.sin(t1) * rb, y + yb, z + Math.cos(t1) * rb); const d = this.P(x + Math.sin(t0) * rb, y + yb, z + Math.cos(t0) * rb);
        const cc = col(o.alt ? o.alt[(i + j) & 1] : color);
        const nr = (t, rr, yy) => this.D(Math.sin(t) * rr, yy / (sy * sy), Math.cos(t) * rr);
        const n0 = nr(t0, ra, ya); const n1 = nr(t1, ra, ya); const n2 = nr(t1, rb, yb); const n3 = nr(t0, rb, yb);
        if (j === 0) this._tri(ch, a, d, c, cc, [n0, n3, n2], null, o.ph);
        else if (j === rows - 1) this._tri(ch, a, d, b, cc, [n0, n3, n1], null, o.ph);
        else this._quad(ch, a, d, c, b, cc, [n0, n3, n2, n1], null, o.ph);
      }
    }
    return this;
  }
  /** hexagonal bipyramid blob: plush animals, candy bags, fruit (12 triangles; 6 in the far LOD) */
  blob(x, y, z, rx, ry, rz, color, o = {}) {
    const n = this.far ? 4 : 6; const top = [x, y + ry, z]; const bot = [x, y - ry, z]; const cc = col(color); const ch = o.ch || 'solid';
    const ring = []; for (let i = 0; i < n; i++) { const a = TAU * i / n + 0.3; ring.push(this.P(x + Math.sin(a) * rx, y, z + Math.cos(a) * rz)); }
    const T0 = this.P(...top); const B0 = this.P(...bot);
    for (let i = 0; i < n; i++) { const a = ring[i]; const b2 = ring[(i + 1) % n]; this._tri(ch, T0, b2, a, cc, null, null, o.ph); this._tri(ch, B0, a, b2, cc, null, null, o.ph); }
    return this;
  }
  /** square beam between two points (model space coords before transform), thickness t (and optional second thickness) */
  beam(a, b, t, color, o = {}) {
    const A = new T.Vector3(...a); const B = new T.Vector3(...b); const dir = B.clone().sub(A); const len = dir.length(); if (len < 1e-6) return this;
    dir.normalize();
    let up = Math.abs(dir.y) > 0.95 ? new T.Vector3(0, 0, 1) : new T.Vector3(0, 1, 0);
    const side = new T.Vector3().crossVectors(dir, up).normalize(); up = new T.Vector3().crossVectors(side, dir).normalize();
    const t1 = t / 2; const t2 = (o.t2 || t) / 2; const ch = o.ch || 'solid'; const cc = col(color);
    const c = (sx, su) => [side.x * sx * t1 + up.x * su * t2, side.y * sx * t1 + up.y * su * t2, side.z * sx * t1 + up.z * su * t2];
    const corners = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
    const p0 = corners.map((q) => this.P(a[0] + q[0], a[1] + q[1], a[2] + q[2])); const p1 = corners.map((q) => this.P(b[0] + q[0], b[1] + q[1], b[2] + q[2]));
    for (let i = 0; i < 4; i++) { const j = (i + 1) & 3; this._quad(ch, p0[i], p0[j], p1[j], p1[i], cc, null, null, o.ph); }
    if (o.caps) { this._quad(ch, p0[3], p0[2], p0[1], p0[0], cc, null, null, o.ph); this._quad(ch, p1[0], p1[1], p1[2], p1[3], cc, null, null, o.ph); }
    return this;
  }
  /** thin flat ribbon (a wire / chain / stripe) between two points, always facing +z-ish; width w */
  wire(a, b, w, color, o = {}) {
    const A = new T.Vector3(...a); const B = new T.Vector3(...b); const dir = B.clone().sub(A).normalize();
    let side = new T.Vector3().crossVectors(dir, new T.Vector3(0, 0, 1)); if (side.lengthSq() < 1e-4) side = new T.Vector3(1, 0, 0); side.normalize().multiplyScalar(w / 2);
    const p = (v, s) => this.P(v[0] + side.x * s, v[1] + side.y * s, v[2] + side.z * s);
    this._quad(o.ch || 'solid', p(a, -1), p(a, 1), p(b, 1), p(b, -1), col(color), null, null, o.ph, true);
    return this;
  }
  /** gable roof (a prism) over a w (x) x d (z) footprint, base y, ridge along x unless o.ridge === 'z'; rise = ridge height; o.over eaves overhang, o.under underside colour, o.ends gable-end colour */
  gable(x, y, z, w, d, rise, color, o = {}) {
    if (o.ridge === 'z') { this.push().translate(x, 0, z).rotY(Math.PI / 2); this.gable(0, y, 0, d, w, rise, color, Object.assign({}, o, { ridge: 'x' })); this.pop(); return this; }
    const ov = o.over || 0; const hx = w / 2 + (o.overEnds === undefined ? ov : o.overEnds); const hz = d / 2 + ov; const ch = o.ch || 'solid';
    const p = (px, py, pz) => this.P(x + px, py, z + pz);
    const L0 = p(-hx, y, hz); const L1 = p(hx, y, hz); const R0 = p(-hx, y, -hz); const R1 = p(hx, y, -hz); const T0 = p(-hx, y + rise, 0); const T1 = p(hx, y + rise, 0);
    const cc = col(color); const c2 = col(o.back || color);
    this._quad(ch, L0, L1, T1, T0, cc, null, null, o.ph);              // front slope
    this._quad(ch, R1, R0, T0, T1, c2, null, null, o.ph);              // back slope
    const ec = col(o.ends || color);
    if (!o.open) { this._tri(ch, L1, R1, T1, ec); this._tri(ch, R0, L0, T0, ec); }
    if (o.under) { const uc = col(o.under); this._quad(ch, L1, L0, R0, R1, uc, null, null, o.ph); }
    return this;
  }
  /** hip roof / pyramid: footprint w x d at y, rise, ridge length rl along x (0 = pyramid); o.over overhang */
  hip(x, y, z, w, d, rise, color, o = {}) {
    const ov = o.over || 0; const hx = w / 2 + ov; const hz = d / 2 + ov; const rl = Math.min(o.ridge || 0, hx * 2) / 2; const ch = o.ch || 'solid';
    const p = (px, py, pz) => this.P(x + px, py, z + pz);
    const A = p(-hx, y, hz); const B = p(hx, y, hz); const Cc = p(hx, y, -hz); const Dd = p(-hx, y, -hz); const T0 = p(-rl, y + rise, 0); const T1 = p(rl, y + rise, 0);
    const cs = o.alt ? [col(o.alt[0]), col(o.alt[1])] : [col(color), col(color)];
    this._quad(ch, A, B, T1, T0, cs[0], null, null, o.ph);
    this._quad(ch, Cc, Dd, T0, T1, cs[1], null, null, o.ph);
    this._tri(ch, B, Cc, T1, cs[0]); this._tri(ch, Dd, A, T0, cs[0]);
    if (o.under) { const uc = col(o.under); this._quad(ch, B, A, Dd, Cc, uc, null, null, o.ph); }
    return this;
  }
  /** pyramid roof with N coloured gores (circus tent roof / carousel canopy), base radius r, apex at y + rise */
  tentRoof(x, y, z, r, rise, seg, colors, o = {}) { return this.cyl(x, y, z, r, o.top === undefined ? 0 : o.top, rise, seg, colors[0], Object.assign({ alt: colors, smooth: false }, o)); }

  /** scalloped fabric valance along a line a -> b (local coords, same y), hanging h, n scallops, alternating colours; faces +z of the line (double sided) */
  valance(a, b, h, n, c1, c2, o = {}) {
    const nn = this.far ? Math.max(2, Math.round(n / 2)) : n; const ch = o.ch || 'solid';
    const arcN = this.far ? 2 : 4; const dbl = o.dbl !== false;
    for (let i = 0; i < nn; i++) {
      const t0 = i / nn; const t1 = (i + 1) / nn;
      const pt = (t, dy) => [lerp(a[0], b[0], t), a[1] - dy, lerp(a[2], b[2], t)];
      const top0 = pt(t0, 0); const top1 = pt(t1, 0); const mid = pt((t0 + t1) / 2, 0);
      const cc = col((i & 1) ? c2 : c1);
      const arc = [];
      for (let k = 0; k <= arcN; k++) { const u = k / arcN; arc.push(pt(lerp(t0, t1, u), h * Math.pow(Math.sin(Math.PI * u), 0.65))); }
      // fan from the top midpoint over the (left -> right) bottom arc, plus the top corners
      const P0 = this.P(...top0); const P1 = this.P(...top1); const PM = this.P(...mid);
      const A = arc.map((q) => this.P(...q));
      for (let k = 0; k < arcN; k++) { this._tri(ch, PM, A[k + 1], A[k], cc, null, null, o.ph); if (dbl) this._tri(ch, PM, A[k], A[k + 1], cc, null, null, o.ph); }
      this._tri(ch, P0, PM, A[0], cc, null, null, o.ph); this._tri(ch, P1, A[arcN], PM, cc, null, null, o.ph);
      if (dbl) { this._tri(ch, P0, A[0], PM, cc, null, null, o.ph); this._tri(ch, P1, PM, A[arcN], cc, null, null, o.ph); }
    }
    return this;
  }
  /** a pennant string: n small triangles hung along a -> b (a slight sag), colours cycled */
  pennants(a, b, n, colors, size = 0.35, o = {}) {
    const nn = this.far ? Math.max(3, Math.round(n / 2)) : n; const sag = o.sag === undefined ? 0.25 : o.sag;
    let prev = null;
    for (let i = 0; i < nn; i++) {
      const t = (i + 0.5) / nn; const x = lerp(a[0], b[0], t); const z = lerp(a[2], b[2], t); const y = lerp(a[1], b[1], t) - Math.sin(Math.PI * t) * sag;
      const dx = (b[0] - a[0]) / nn * 0.46; const dz = (b[2] - a[2]) / nn * 0.46;
      this.tri([x - dx, y, z - dz], [x + dx, y, z + dz], [x, y - size, z], colors[i % colors.length], { dbl: true });
      if (prev === null) prev = [x, y, z];
    }
    if (!o.noWire) this.wire(a, b, 0.025, 0x222222, { ch: 'solid' });
    return this;
  }

  /** call fn(i, angle) n times around the y axis; inside, +z points radially outward */
  radial(n, fn, a0 = 0) { const nn = this.far && n > 8 ? Math.round(n / 2) : n; for (let i = 0; i < nn; i++) { const a = a0 + TAU * i / nn; this.push().rotY(a); fn(i, a, nn); this.pop(); } return this; }
  /** a ring of scallops hanging from a circle of radius r at height y (carousel / canopy valance) */
  scallopRing(cx, y, cz, r, h, n, c1, c2, o = {}) {
    const nn = this.far ? Math.max(6, Math.round(n / 2)) : n; const ch = o.ch || 'solid';
    for (let i = 0; i < nn; i++) {
      const t0 = TAU * i / nn; const t1 = TAU * (i + 1) / nn; const tm = (t0 + t1) / 2; const cc = col(i & 1 ? c2 : c1);
      const pt = (t, dy, rr = r) => this.P(cx + Math.sin(t) * rr, y - dy, cz + Math.cos(t) * rr);
      const top0 = pt(t0, 0); const top1 = pt(t1, 0); const topm = pt(tm, 0);
      const arc = []; for (let k = 0; k <= 3; k++) { const u = k / 3; arc.push(pt(lerp(t0, t1, u), h * Math.pow(Math.sin(Math.PI * u), 0.65), r + (o.flare || 0) * Math.sin(Math.PI * u))); }
      for (let k = 0; k < 3; k++) { this._tri(ch, topm, arc[k + 1], arc[k], cc, null, null, 0); this._tri(ch, topm, arc[k], arc[k + 1], cc, null, null, 0); }
      this._tri(ch, top0, topm, arc[0], cc); this._tri(ch, top1, arc[3], topm, cc); this._tri(ch, top0, arc[0], topm, cc); this._tri(ch, top1, topm, arc[3], cc);
    }
    return this;
  }
  /** a band (short cylinder wall) of radius r from y to y + h, no caps */
  band(cx, y, cz, r, h, seg, color, o = {}) { return this.cyl(cx, y, cz, r, r, h, seg, color, Object.assign({ smooth: o.smooth === undefined ? false : o.smooth }, o)); }

  /* ---- lights */
  /** a bare bulb (Points).  size in metres; chase phase 0 = steady, > 0 = chasing / twinkling */
  bulb(x, y, z, color = 0xffd890, size = 0.16, ph = 0) {
    const p = this.P(x, y, z); const c = col(color); this.bulbs.push(p[0], p[1], p[2], c[0], c[1], c[2], size, ph); return this;
  }
  /** bulbs along a line a -> b every `step` metres (x2 in far LOD) */
  bulbRow(a, b, step, color, size = 0.16, o = {}) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const st = this.far ? step * 2 : step; const n = Math.max(1, Math.round(L / st));
    for (let i = 0; i <= n; i++) { const t = i / n; this.bulb(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), Array.isArray(color) && typeof color[0] !== 'number' ? color[i % color.length] : color, size, o.chase ? ((i % 6) + 1) / 7 : 0); }
    return this;
  }
  /** bulbs on a circle (plane xz at height y, or `vertical` = in the xy plane facing +z) */
  bulbRing(cx, cy, cz, r, n, color, size = 0.16, o = {}) {
    const nn = this.far ? Math.max(6, Math.round(n / 2)) : n; const a0 = o.a0 || 0; const span = o.span || TAU;
    for (let i = 0; i < nn; i++) { const a = a0 + span * i / (o.span ? Math.max(1, nn - 1) : nn); const c = Array.isArray(color) && typeof color[0] !== 'number' ? color[i % color.length] : color; const ph = o.chase ? ((i % 8) + 1) / 9 : 0; if (o.vertical) this.bulb(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz, c, size, ph); else this.bulb(cx + Math.sin(a) * r, cy, cz + Math.cos(a) * r, c, size, ph); }
    return this;
  }
  /** an LED strip (lamp channel) between two points; chase > 0 makes it pulse in travelling phase */
  led(a, b, t, color, o = {}) { return this.beam(a, b, t, color, Object.assign({}, o, { ch: 'lamp', ph: o.chase || 0 })); }
  /** LED outline of a rectangle in the xy plane at depth z (front facing), segmented so the pulse chases around it */
  ledRect(x0, y0, x1, y1, z, t, colors, o = {}) {
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; let k = 0;
    for (let i = 0; i < 4; i++) {
      const a = pts[i]; const bb = pts[(i + 1) % 4]; const len = Math.hypot(bb[0] - a[0], bb[1] - a[1]); const segs = Math.max(2, Math.round(len / (o.seg || 1.4)));
      for (let s = 0; s < segs; s++) { const t0 = s / segs; const t1 = (s + 1) / segs - 0.02; this.led([lerp(a[0], bb[0], t0), lerp(a[1], bb[1], t0), z], [lerp(a[0], bb[0], t1), lerp(a[1], bb[1], t1), z], t, colors[k % colors.length], { chase: ((k % 10) + 1) / 11 }); k++; }
    }
    return this;
  }
  /** steam / fog / sparks: n points rising from (x,y,z); kind 0 steam, 1 sparks */
  fx(x, y, z, n = 3, kind = 0, o = {}) {
    const cnt = this.far ? Math.max(1, Math.round(n / 2)) : n; const c = col(o.color || (kind ? 0xffc060 : 0xf2f2f2));
    for (let i = 0; i < cnt; i++) { const p = this.P(x + (this.rnd() - 0.5) * (o.spread || 0.3), y, z + (this.rnd() - 0.5) * (o.spread || 0.3)); this.fxp.push(p[0], p[1], p[2], c[0], c[1], c[2], (o.size || (kind ? 0.12 : 0.24)) * (0.8 + this.rnd() * 0.4), this.rnd(), kind); }
    return this;
  }

  /* ---- signs */
  /** a painted panel centred at (x,y,z), w x h, facing +z (rotate with the transform stack).  text; o.look, o.kind 'main'|'banner'|'plate', o.lit (signLit), o.frame colour, o.key extra cache key, o.painter custom */
  sign(text, x, y, z, w, h, o = {}) {
    const look = o.look || 0; const kind = o.kind || 'main'; const lit = !!o.lit;
    const small = kind !== 'main'; const px = Math.round(clamp(w / h, 1, 8) * (small ? 28 : 40)); const wpx = clamp(px, 72, small ? 144 : 208); const hpx = Math.max(20, Math.round(wpx * h / w));
    const key = o.key || `${look}|${kind}|${text}|${wpx}x${hpx}|${o.style ? JSON.stringify(o.style) : ''}`;
    const bgc = o.bgCss || (look === 1 ? '#140a2e' : look === 2 ? '#ffffff' : '#f6ead0');
    const r = this.M.atlas.slot(key, wpx, hpx, o.style ? (o.style.bg || bgc) : bgc, o.painter || (o.style ? stylePainter(text, o.style) : signPainter(look, text, kind, o)));
    return this.panel(r, x, y, z, w, h, o);
  }
  /** a mural panel: kind 0 alpine, 1 space, 2 circus, 3 sea, 4 comic, 5 jungle, 6 print, 7 rosette (airbrush painters in atlas.js; seed picks one of 4 variants) */
  mural(kind, seed, x, y, z, w, h, o = {}) {
    const wpx = clamp(Math.round(w * 30 / 64) * 64, 128, 256); const hpx = Math.max(32, Math.round(wpx * h / w / 16) * 16);          // quantised: few atlas slots for many panels
    const r = this.M.atlas.slot(`mural|${kind}|${seed % 2}|${o.look || 0}|${wpx}x${hpx}`, wpx, hpx, '#888', muralPainter(kind, seed % 2, o.look || 0));
    return this.panel(r, x, y, z, w, h, o);
  }
  /** the padlock plate of a locked pitch ("ab * N") */
  lockSign(starNo, x, y, z, w, h, o = {}) {
    const r = this.M.atlas.slot(`lock|${starNo}`, 192, 64, '#2b2118', lockPainter(starNo));
    return this.panel(r, x, y, z, w, h, o);
  }
  /** textured quad from an atlas rect, centred; thin frame behind for thickness */
  panel(r, x, y, z, w, h, o = {}) {
    const ch = o.lit ? 'signLit' : 'sign'; const hx = w / 2; const hy = h / 2; const white = [1, 1, 1];
    const a = this.P(x - hx, y - hy, z); const b = this.P(x + hx, y - hy, z); const c = this.P(x + hx, y + hy, z); const d = this.P(x - hx, y + hy, z);
    const nz = this.D(0, 0, 1);
    this._quad(ch, a, b, c, d, white, [nz, nz, nz, nz], [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]], 0, false);
    if (o.back !== false) this._quad('solid', b, a, d, c, col(o.backColor || 0x3a2a20), null, null, 0, false);
    if (o.frame !== false) {
      const f = o.frameW || 0.08; const fc = o.frame === undefined ? C.darkWood : o.frame; const dz = o.frameZ === undefined ? -0.06 : o.frameZ;
      this.box(x, y - hy - f, z + dz, w + f * 2, h + f * 2, 0.09, fc, { noFront: true });
    }
    return this;
  }

  /* ---- figures and small props */
  /** a stylised person: legs, torso, head, optional hat/vest colours.  yaw about y.  skipped in the far LOD */
  figure(x, z, yaw, o = {}) {
    if (this.far && !o.keep) return this;
    const y0 = o.y || 0; const s = o.scale || 1; const body = o.body !== undefined ? o.body : FIG_COLS[Math.floor(this.rnd() * FIG_COLS.length)];
    const legs = o.legs !== undefined ? o.legs : (this.rnd() < 0.5 ? 0x2a3350 : 0x3a3a3a); const skin = o.skin !== undefined ? o.skin : (this.rnd() < 0.8 ? C.skin : C.skin2);
    this.push().translate(x, y0, z).rotY(yaw || 0).scale(s);
    this.box(0, 0, 0, 0.34, 0.5, 0.2, legs, { noBack: false });
    this.box(0, 0.5, 0, 0.42, 0.55, 0.25, body);
    this.box(-0.27, 0.55, 0, 0.1, 0.45, 0.12, body); this.box(0.27, 0.55, 0, 0.1, 0.45, 0.12, body);
    this.sphere(0, 1.2, 0, 0.13, skin, { seg: 5 });
    if (o.hat !== undefined) this.cyl(0, 1.28, 0, 0.16, 0.14, 0.1, 6, o.hat, { cap: true });
    this.pop();
    return this;
  }
  /** a round table with a cloth, optionally a parasol */
  table(x, z, r, cloth, o = {}) {
    this.cyl(x, 0, z, 0.06, 0.06, 0.95, 5, C.darkSteel); this.cyl(x, 0.95, z, r, r, 0.05, 9, cloth, { cap: true });
    if (o.parasol) { this.cyl(x, 0, z, 0.03, 0.03, 2.3, 4, C.darkSteel); this.cone(x, 2.0, z, r * 2.2, 0.55, 8, o.parasol, { alt: o.parasolAlt || [o.parasol, 0xffffff], smooth: false }); }
    return this;
  }
  /** a railing run (queue barrier): posts + two rails, from a to b at ground y 0 */
  railing(a, b, h = 1.0, color = 0xb9c0c6, o = {}) {
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]); const n = Math.max(1, Math.round(L / (this.far ? 4 : 2)));
    for (let i = 0; i <= n; i++) { const t = i / n; this.cyl(lerp(a[0], b[0], t), 0, lerp(a[2], b[2], t), 0.035, 0.035, h, 4, color); }
    this.beam([a[0], h, a[2]], [b[0], h, b[2]], 0.05, o.top || color); if (!this.far) this.beam([a[0], h * 0.55, a[2]], [b[0], h * 0.55, b[2]], 0.035, color);
    return this;
  }
  /** a bulb-lit flag pole: pole, flag(s) */
  flag(x, z, h, color, o = {}) {
    this.cyl(x, 0, z, 0.04, 0.03, h, 4, o.pole || 0xdadada);
    const w = o.w || 0.9; const fh = o.h || 0.55; const y = h - fh * 0.1;
    this.quad([x, y - fh, z], [x + w, y - fh * 0.9, z], [x + w, y, z], [x, y, z], color, { dbl: true });
    if (o.stripe) this.quad([x, y - fh * 0.66, z + 0.002], [x + w, y - fh * 0.6, z + 0.002], [x + w, y - fh * 0.33, z + 0.002], [x, y - fh * 0.38, z + 0.002], o.stripe, { dbl: true });
    return this;
  }

  /* ---- animated parts */
  /** a child builder whose geometry is rotated/moved around `pivot` at runtime; finish() makes a named sub-group */
  part(name, pivot = [0, 0, 0]) {
    const p = new Builder({ rnd: this.rnd, far: this.far, name });
    p.pivot = this.P(pivot[0], pivot[1], pivot[2]); p.m = this.m.clone(); p.parts = [];
    this.parts.push(p);
    return p;
  }

  /** build the THREE objects of this builder (recursively for parts).  Geometry is shifted by -pivot; the object is placed at pivot - parentPivot. */
  _make(parentPivot) {
    const g = new T.Group(); g.name = this.name === 'root' ? 'model' : 'part:' + this.name;
    g.position.set(this.pivot[0] - parentPivot[0], this.pivot[1] - parentPivot[1], this.pivot[2] - parentPivot[2]);
    g.userData.pivot = this.pivot.slice();
    const mk = (nm, acc, mat) => {
      if (acc.empty) return;
      const geo = new T.BufferGeometry();
      const pos = new Float32Array(acc.p); for (let i = 0; i < pos.length; i += 3) { pos[i] -= this.pivot[0]; pos[i + 1] -= this.pivot[1]; pos[i + 2] -= this.pivot[2]; }
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new T.BufferAttribute(new Float32Array(acc.n), 3));
      geo.setAttribute('color', new T.BufferAttribute(new Float32Array(acc.c), 3));
      if (nm === 'sign' || nm === 'signLit') geo.setAttribute('uv', new T.BufferAttribute(new Float32Array(acc.u), 2));
      if (acc.ph) geo.setAttribute('aPh', new T.BufferAttribute(new Float32Array(acc.ph), 1));
      if (acc.d) geo.setAttribute('aDepth', new T.BufferAttribute(new Float32Array(acc.d), 1));
      geo.computeBoundingSphere(); geo.computeBoundingBox();
      const mesh = new T.Mesh(geo, mat); mesh.name = nm; g.add(mesh);
    };
    mk('solid', this.ch.solid, this.M.solid); mk('ground', this.ch.ground, this.M.ground); mk('fabric', this.ch.fabric, this.M.fabric); mk('lamp', this.ch.lamp, this.M.lamp); mk('sign', this.ch.sign, this.M.sign); mk('signLit', this.ch.signLit, this.M.signLit); mk('swing', this.ch.swing, this.M.swing);
    const pts = (name, arr, stride, mat, attrs) => {
      if (!arr.length) return;
      const n = arr.length / stride; const pos = new Float32Array(n * 3); const cc = new Float32Array(n * 3); const sz = new Float32Array(n); const ph = new Float32Array(n); const kd = new Float32Array(n);
      for (let i = 0; i < n; i++) { const o = i * stride; pos[i * 3] = arr[o] - this.pivot[0]; pos[i * 3 + 1] = arr[o + 1] - this.pivot[1]; pos[i * 3 + 2] = arr[o + 2] - this.pivot[2]; cc.set([arr[o + 3], arr[o + 4], arr[o + 5]], i * 3); sz[i] = arr[o + 6]; ph[i] = arr[o + 7]; if (stride > 8) kd[i] = arr[o + 8]; }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('aCol', new T.BufferAttribute(cc, 3));
      geo.setAttribute('aSize', new T.BufferAttribute(sz, 1)); geo.setAttribute('aPh', new T.BufferAttribute(ph, 1)); if (attrs) geo.setAttribute('aKind', new T.BufferAttribute(kd, 1)); else geo.setAttribute('aGain', new T.BufferAttribute(haloGain(pos, sz), 1));
      geo.computeBoundingSphere(); geo.computeBoundingBox();
      const pm = new T.Points(geo, mat); pm.name = name; pm.frustumCulled = true;
      const M = this.M; pm.onBeforeRender = (renderer, scene, camera) => M.feed(renderer, scene, camera);
      g.add(pm);
    };
    pts('bulbs', this.bulbs, 8, this.M.bulbs, false); pts('fx', this.fxp, 9, this.M.fx, true);
    const parts = {};
    for (const p of this.parts) { const pg = p._make(this.pivot); g.add(pg); parts[p.name] = pg; Object.assign(parts, pg.userData.parts || {}); }
    g.userData.parts = parts;
    return g;
  }

  /** the finished model group (contract in index.js); `meta` = { id, look, level, size: [w, d] } */
  finish(meta = {}) {
    const g = this._make([0, 0, 0]); g.name = meta.id || 'model';
    const M = this.M;
    let tris = 0; g.traverse((o) => { if (o.isMesh) tris += o.geometry.attributes.position.count / 3; });
    g.userData = Object.assign(g.userData, { kit: 'w3', id: meta.id, look: meta.look, level: meta.level, tris, bulbs: countBulbs(g), size: meta.size, height: meta.height, kind: meta.kind || 'static' });
    g.userData.setNight = (k) => { M.setNight(k); if (meta.onNight) meta.onNight(g, k); };
    const anim = meta.animate;
    g.userData.animate = (t, dt, nightK) => { M.tick(t); if (anim) anim(t, dt, g.userData.parts, nightK === undefined ? M.night.k : nightK); };
    g.userData.animated = !!anim;
    if (anim) anim(0, 0, g.userData.parts, 0);          // rest pose (the frozen far LOD is merged from here)
    return g;
  }
}
/** per-bulb halo gain: overlapping blooms add up, so a dense bulb row gets a weaker halo per bulb (the sum stays about constant; a lone bulb keeps its full bloom) */
export function haloGain(pos, sz) {
  const n = sz.length; const out = new Float32Array(n).fill(1); if (n < 2) return out;
  const cell = 1.0; const map = new Map(); const key = (x, y, z) => ((Math.floor(x / cell) + 4096) * 8192 + (Math.floor(z / cell) + 4096)) * 1024 + Math.floor(y / cell) + 256;
  for (let i = 0; i < n; i++) { const k = key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); const a = map.get(k); if (a) a.push(i); else map.set(k, [i]); }
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]; const y = pos[i * 3 + 1]; const z = pos[i * 3 + 2]; let m = 0; const R = 0.9;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const a = map.get(key(x + dx * cell, y + dy * cell, z + dz * cell)); if (!a) continue; for (const j of a) { if (j === i) continue; const d = Math.hypot(pos[j * 3] - x, pos[j * 3 + 1] - y, pos[j * 3 + 2] - z); if (d < R) m += 1 - d / R; } }
    out[i] = Math.max(0.28, Math.min(1, 1 / (1 + m * 0.55)));
  }
  return out;
}
function countBulbs(g) { let n = 0; g.traverse((o) => { if (o.isPoints && o.name === 'bulbs') n += o.geometry.attributes.position.count; }); return n; }

/* ------------------------------------------------------------------ shared dressing helpers (the "level" rules of DESIGN 3.2) */

/** model context from the build options */
export function makeCtx(opts, id) {
  const look = clamp(opts.look | 0, 0, 2); const level = clamp(opts.level | 0 || 1, 1, 4);
  const pal = PAL[look]; const rnd = mulberry((opts.seed | 0) * 7919 + (id ? id.length * 131 : 17));
  return { id, look, level, pal, L2: level >= 2, L3: level >= 3, L4: level >= 4, far: !!opts.far || opts.quality === 'low', quality: opts.quality || 'medium', seed: opts.seed | 0, rnd, trim: level >= 4 ? GOLD : pal.trim, bulb: pal.bulb, led: level >= 4 ? [GOLD, 0xfff0b0, GOLD] : pal.led };
}

/** the standard canopy edge dressing: a row of bulbs, L2 string lights + flags at the corners, L3 chasing LED outline, L4 gold trim + finials.  Edge runs x0 -> x1 at height y, depth z (front). */
export function dressEdge(b, ctx, x0, x1, y, z, o = {}) {
  const step = o.step || 0.34; const bsz = o.size || 0.15;
  b.bulbRow([x0, y, z], [x1, y, z], step, ctx.bulb, bsz);
  if (o.second) b.bulbRow([x0, y + 0.2, z - 0.1], [x1, y + 0.2, z - 0.1], step, ctx.bulb, bsz);
  if (ctx.L2) {
    const colors = ctx.look === 1 ? [0x41e8ff, 0xff3fc8, 0x8a5bff] : ctx.look === 2 ? [0x1f5fb8, 0xffffff, 0x1f5fb8] : [0xc8283a, 0xf6ead0, 0x2f6a4c, 0xf4c430];
    if (!o.noFlags) b.pennants([x0, y + 0.6, z + 0.3], [x1, y + 0.6, z + 0.3], Math.max(4, Math.round(Math.abs(x1 - x0) * 1.6)), colors, 0.34);
  }
  if (ctx.L3) {
    b.led([x0, y - 0.18, z + 0.04], [x1, y - 0.18, z + 0.04], 0.06, ctx.led[0], { chase: 0.3 });
    const n = Math.max(2, Math.round(Math.abs(x1 - x0) / 1.2));
    for (let i = 0; i < n; i++) { const t0 = lerp(x0, x1, i / n); const t1 = lerp(x0, x1, (i + 1) / n - 0.03); b.led([t0, y - 0.18, z + 0.04], [t1, y - 0.18, z + 0.04], 0.07, ctx.led[i % ctx.led.length], { chase: ((i % 9) + 1) / 10 }); }
  }
  if (ctx.L4) {
    b.beam([x0 - 0.1, y - 0.03, z + 0.04], [x1 + 0.1, y - 0.03, z + 0.04], 0.09, GOLD);
    b.sphere(x0 - 0.1, y + 0.05, z + 0.04, 0.16, GOLD, { seg: 6 }); b.sphere(x1 + 0.1, y + 0.05, z + 0.04, 0.16, GOLD, { seg: 6 });
  }
}

/** crowd barrier / forecourt dressing for L3+ : railings along the front of a w x d forecourt strip at z, plus two planters, and queue figures */
export function dressForecourt(b, ctx, x0, x1, zFront, o = {}) {
  if (ctx.L3) {
    b.railing([x0, 0, zFront], [x1, 0, zFront], 0.95, ctx.L4 ? GOLD : C.steel);
    const mid = (x0 + x1) / 2;
    if (o.planters !== false) { [x0 + 0.3, x1 - 0.3].forEach((px) => { b.cyl(px, 0, zFront - 0.3, 0.28, 0.22, 0.4, 6, 0x8a5a34); b.sphere(px, 0.62, zFront - 0.3, 0.3, 0x3b9a4c, { seg: 5 }); }); }
    if (o.figures !== false) { b.figure(mid - 0.6, zFront - 0.7, Math.PI); b.figure(mid + 0.5, zFront - 1.0, Math.PI); }
  }
}

/** slim plinth under every model so it never floats over the sloping asphalt: a darker apron down to y = -0.45 */
export function apron(b, ctx, w, d, o = {}) {
  b.box(0, -0.45, 0, w, 0.5, d, o.color || 0x3a3a40, { noTop: true, bottom: false });
  if (o.top) b.box(0, 0.0, 0, w, 0.08, d, o.top, { noBack: true });
}

/** palette helper for the second sign panel of a Look */
export function bannerFor(look) { return look === 1 ? 'banner' : 'banner'; }

/** a draped surface: a grid of `cell` m quads over [-hx, hx] x [-hz, hz] following the terrain (ly(x, z) = local terrain height), colour from colorFn(i, j, x, z) */
export function drape(b, hx, hz, ly, colorFn, cell = 3, lift = 0.07) {
  if (globalThis.__fouerNoFloors) return;                      // debug switch of the coverage measurement (flat plates / gravel off)
  const nx = Math.max(1, Math.round((2 * hx) / cell)); const nz = Math.max(1, Math.round((2 * hz) / cell)); const ao = b.ao; b.ao = false;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x0 = -hx + (2 * hx) * i / nx; const x1 = -hx + (2 * hx) * (i + 1) / nx; const z0 = -hz + (2 * hz) * j / nz; const z1 = -hz + (2 * hz) * (j + 1) / nz;
    b.quad([x0, ly(x0, z1) + lift, z1], [x1, ly(x1, z1) + lift, z1], [x1, ly(x1, z0) + lift, z0], [x0, ly(x0, z0) + lift, z0], colorFn(i, j, (x0 + x1) / 2, (z0 + z1) / 2));
  }
  b.ao = ao;
}

