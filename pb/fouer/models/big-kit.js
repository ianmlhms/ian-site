/* Schueberfouer Tycoon, W4a: private helpers of the big-ride models (wheel.js, towers.js).  W5 may consolidate this with kit.js.
 *
 * One lit material for everything (MeshLambert + vertex colours + two emissive hooks, see getMaterial) and one geometry builder that
 * writes position / normal / colour / emissive into ONE buffer per mesh, so a whole ride part is a single draw call.
 *
 *   const K = makeKit(THREE);               // cached per THREE
 *   const b = K.builder();                  // b.P = paint, b.L = bulbs / LEDs (emissive = own colour, always-on scale 0.45 + 0.55k),
 *                                           // b.G(hex) = night-only glow in a given colour (lit windows)
 *   b.P.box(...); b.P.tube(...); b.push(matrix) ... b.pop();
 *   const mesh = b.mesh('name');            // THREE.Mesh on the shared material
 *   K.dynamic(mesh.geometry, ranges)        // CPU "skinning": per-part rigid transforms (gondolas that stay upright, swing seats)
 *
 * Night convention (W2): setNight(k) sets the lamp scalar 0.45 + 0.55 k (always-on bulbs), a night-only window glow k, and a soft self-lit
 * paint k (the whole fair is lit by its own bulbs). */

const kits = new WeakMap();
const LAMP_DIFFUSE = 0.3;     // a bulb is mostly emissive: its lit-paint part stays small so the colour stays saturated
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
export function rng(seed) { let s = (seed | 0) + 0x6d2b79f5; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function makeKit(T) {
  if (kits.has(T)) return kits.get(T);
  const kit = createKit(T);
  kits.set(T, kit);
  return kit;
}

function createKit(T) {
  const colorCache = new Map();
  const rgb = (c) => {
    if (Array.isArray(c)) return c;
    let v = colorCache.get(c);
    if (!v) { const k = new T.Color(c); v = [k.r, k.g, k.b]; colorCache.set(c, v); }
    return v;
  };
  const mixRgb = (a, b, t) => { const x = rgb(a); const y = rgb(b); return [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]; };
  const scaleRgb = (a, k) => { const x = rgb(a); return [x[0] * k, x[1] * k, x[2] * k]; };

  /* ---------------------------------------------------------------- material (shared by every big ride) */
  const uniforms = { uLamp: { value: 0.45 }, uNight: { value: 0 }, uGlow: { value: 0 } };
  const material = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
  material.name = 'fouer-big-lit';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLamp = uniforms.uLamp; shader.uniforms.uNight = uniforms.uNight; shader.uniforms.uGlow = uniforms.uGlow;
    shader.vertexShader = 'attribute vec4 aEm; varying vec4 vEm;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vEm = aEm;');
    shader.fragmentShader = 'uniform float uLamp; uniform float uNight; uniform float uGlow; varying vec4 vEm;\n' + shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n totalEmissiveRadiance += vEm.rgb * mix(uNight, uLamp, vEm.a) + diffuseColor.rgb * uGlow * vec3(1.0, 0.94, 0.84);');
  };
  material.customProgramCacheKey = () => 'fouer-big-lit-v1';
  const lineMaterial = new T.LineBasicMaterial({ vertexColors: true });
  lineMaterial.name = 'fouer-big-lines';
  const setNight = (k) => {
    uniforms.uNight.value = k; uniforms.uLamp.value = 0.45 + 0.55 * k; uniforms.uGlow.value = 0.1 + 0.18 * k;
    lineMaterial.color.setScalar(0.55 + 0.3 * k);
  };

  /* ---------------------------------------------------------------- builder */
  const v3 = (x, y, z) => [x, y, z];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  class Bucket {
    constructor(b, mode, emCol) { this.b = b; this.mode = mode; this.emCol = emCol ? rgb(emCol) : null; }
    /** one triangle; na/nb/nc optional smooth normals; winding is corrected to match the normals */
    tri(a, b, c, col, na, nb, nc, cb, cc) {
      const B = this.b;
      let n = cross(sub(b, a), sub(c, a)); const l = len(n);
      if (l < 1e-12) return this;
      n = [n[0] / l, n[1] / l, n[2] / l];
      let n0 = na || n; let n1 = nb || n; let n2 = nc || n;
      if (na && dot(n, add(add(na, nb || na), nc || na)) < 0) { const t = b; b = c; c = t; const tn = n1; n1 = n2; n2 = tn; const tc = cb; cb = cc; cc = tc; }
      const c0 = rgb(col); const c1 = cb ? rgb(cb) : c0; const c2 = cc ? rgb(cc) : c0;
      B._vert(a, n0, c0, this); B._vert(b, n1, c1, this); B._vert(c, n2, c2, this);
      return this;
    }
    /** quad a b c d (any winding), flat normal; set two = true for a visible back side with a flipped normal */
    quad(a, b, c, d, col, cb, cc, cd) {
      this.tri(a, b, c, col, null, null, null, cb, cc);
      this.tri(a, c, d, col, null, null, null, cc, cd);
      return this;
    }
    /** a flat ribbon between p and q, width w, facing the normal n (one quad; the material is double sided) */
    ribbon(p, q, w, n, col) {
      const d = norm(sub(q, p)); let s = cross(d, n); const sl = len(s); if (sl < 1e-6) s = cross(d, [0, 1, 0]); s = mul(norm(s), w / 2);
      return this.quad(add(p, s), sub(p, s), sub(q, s), add(q, s), col);
    }
    box(cx, cy, cz, sx, sy, sz, col, skip = 0) {
      const x0 = cx - sx / 2; const x1 = cx + sx / 2; const y0 = cy - sy / 2; const y1 = cy + sy / 2; const z0 = cz - sz / 2; const z1 = cz + sz / 2;
      const p = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      const face = (bit, i, j, k, l) => { if (!(skip & bit)) this.quad(p[i], p[j], p[k], p[l], col); };
      face(1, 4, 5, 6, 7);   // +z
      face(2, 1, 0, 3, 2);   // -z
      face(4, 5, 1, 2, 6);   // +x
      face(8, 0, 4, 7, 3);   // -x
      face(16, 7, 6, 2, 3);  // +y
      face(32, 0, 1, 5, 4);  // -y
      return this;
    }
    /** a tube / prism / cone between a and b.  o: sides, r1 (end radius), flat, caps, th0, colEnd */
    tube(a, b, r, col, o = {}) {
      const sides = o.sides || 6; const r1 = o.r1 === undefined ? r : o.r1; const th0 = o.th0 || 0;
      const axis = norm(sub(b, a));
      const ref = Math.abs(axis[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
      const u = norm(cross(axis, ref)); const v = cross(axis, u);
      const dir = (k) => { const t = th0 + (k / sides) * Math.PI * 2; return add(mul(u, Math.cos(t)), mul(v, Math.sin(t))); };
      const colB = o.colEnd || col;
      for (let k = 0; k < sides; k++) {
        const d0 = dir(k); const d1 = dir(k + 1);
        const p00 = add(a, mul(d0, r)); const p10 = add(a, mul(d1, r)); const p01 = add(b, mul(d0, r1)); const p11 = add(b, mul(d1, r1));
        if (o.flat) {
          const mid = norm(add(d0, d1));
          this.tri(p00, p10, p11, col, mid, mid, mid, col, colB); this.tri(p00, p11, p01, col, mid, mid, mid, colB, colB);
        } else {
          this.tri(p00, p10, p11, col, d0, d1, d1, col, colB); this.tri(p00, p11, p01, col, d0, d1, d0, colB, colB);
        }
      }
      if (o.caps) { this.disc(b, axis, r1, colB, sides, th0); if (o.caps === 2) this.disc(a, mul(axis, -1), r, col, sides, th0); }
      return this;
    }
    /** a square beam (flat sides) of thickness t between a and b */
    beam(a, b, t, col, o = {}) { return this.tube(a, b, t * Math.SQRT1_2, col, Object.assign({ sides: 4, flat: true, th0: Math.PI / 4 }, o, o.r1 !== undefined ? { r1: o.r1 * Math.SQRT1_2 } : {})); }
    /** a tube with alternating (optionally spiralling) bands: rowLen = band length, spiral = bands shifted per side (in rows) */
    stripedTube(a, b, r, c1, c2, o = {}) {
      const sides = o.sides || 8; const rowLen = o.rowLen || 0.7; const spiral = o.spiral === undefined ? 0.5 : o.spiral; const r1 = o.r1 === undefined ? r : o.r1;
      const axis = sub(b, a); const L = len(axis); const ax = norm(axis);
      const ref = Math.abs(ax[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
      const u = norm(cross(ax, ref)); const v = cross(ax, u);
      const rows = Math.max(1, Math.round(L / rowLen));
      const dir = (k) => { const t = (k / sides) * Math.PI * 2; return add(mul(u, Math.cos(t)), mul(v, Math.sin(t))); };
      for (let i = 0; i < rows; i++) {
        const t0 = i / rows; const t1 = (i + 1) / rows;
        const q0 = add(a, mul(axis, t0)); const q1 = add(a, mul(axis, t1));
        const ra = lerp(r, r1, t0); const rb = lerp(r, r1, t1);
        for (let k = 0; k < sides; k++) {
          const d0 = dir(k); const d1 = dir(k + 1);
          // diagonal bands: the band boundaries run along the quad diagonals, so the two triangles of a quad can differ
          const bandA = spiral ? i - k - 1 : i; const bandB = spiral ? i - k : i;
          const colA = ((bandA % 2) + 2) % 2 === 0 ? c1 : c2; const colB = ((bandB % 2) + 2) % 2 === 0 ? c1 : c2;
          this.tri(add(q0, mul(d0, ra)), add(q0, mul(d1, ra)), add(q1, mul(d1, rb)), colA, d0, d1, d1);
          this.tri(add(q0, mul(d0, ra)), add(q1, mul(d1, rb)), add(q1, mul(d0, rb)), colB, d0, d1, d0);
        }
      }
      return this;
    }
    disc(c, n, r, col, sides = 12, th0 = 0, colEdge) {
      const nn = norm(n); const ref = Math.abs(nn[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
      const u = norm(cross(nn, ref)); const v = cross(nn, u);
      const pt = (k) => { const t = th0 + (k / sides) * Math.PI * 2; return add(c, add(mul(u, Math.cos(t) * r), mul(v, Math.sin(t) * r))); };
      for (let k = 0; k < sides; k++) this.tri(c, pt(k), pt(k + 1), col, nn, nn, nn, col, colEdge || col);
      return this;
    }
    /** flat annulus */
    ring(c, n, r0, r1, col, sides = 24, th0 = 0, colOuter) {
      const nn = norm(n); const ref = Math.abs(nn[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
      const u = norm(cross(nn, ref)); const v = cross(nn, u);
      const pt = (k, r) => { const t = th0 + (k / sides) * Math.PI * 2; return add(c, add(mul(u, Math.cos(t) * r), mul(v, Math.sin(t) * r))); };
      for (let k = 0; k < sides; k++) {
        const a = pt(k, r0); const b2 = pt(k + 1, r0); const c2 = pt(k + 1, r1); const d = pt(k, r1);
        this.tri(a, b2, c2, col, nn, nn, nn, col, colOuter || col); this.tri(a, c2, d, col, nn, nn, nn, colOuter || col, colOuter || col);
      }
      return this;
    }
    sphere(c, r, col, ws = 10, hs = 6) {
      for (let j = 0; j < hs; j++) {
        const t0 = (j / hs) * Math.PI; const t1 = ((j + 1) / hs) * Math.PI;
        for (let i = 0; i < ws; i++) {
          const p0 = (i / ws) * Math.PI * 2; const p1 = ((i + 1) / ws) * Math.PI * 2;
          const P = (t, p) => [Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p)];
          const a = P(t0, p0); const b2 = P(t0, p1); const c2 = P(t1, p1); const d = P(t1, p0);
          const at = (n) => add(c, mul(n, r));
          if (j > 0) this.tri(at(a), at(b2), at(c2), col, a, b2, c2);
          if (j < hs - 1) this.tri(at(a), at(c2), at(d), col, a, c2, d);
        }
      }
      return this;
    }
    /** a flat ellipse (fan) with semi axes ax1, ax2 (vectors) around c */
    fan(c, ax1, ax2, col, sides = 14) {
      const pt = (q) => { const t = (q / sides) * Math.PI * 2; return add(c, add(mul(ax1, Math.cos(t)), mul(ax2, Math.sin(t)))); };
      for (let q = 0; q < sides; q++) this.tri(c, pt(q), pt(q + 1), col);
      return this;
    }
    /** vertical cylinder / cone / frustum on the y axis */
    cylY(cx, y0, cz, r0, r1, h, col, sides = 12, o = {}) {
      return this.tube([cx, y0, cz], [cx, y0 + h, cz], r0, col, Object.assign({ sides, r1 }, o));
    }
  }

  class Builder {
    constructor() {
      this.pos = []; this.nrm = []; this.col = []; this.em = [];
      this.stack = []; this.m = new T.Matrix4(); this.nm = new T.Matrix3(); this.identity = true;
      this.P = new Bucket(this, -1); this.L = new Bucket(this, 1);
      this.lineP = []; this.lineC = [];
    }
    get count() { return this.pos.length / 3; }
    /** a glow bucket: emissive is the given colour, night-only (lit windows) */
    G(hex) { return new Bucket(this, 0, hex); }
    /** a lamp bucket with its own emissive colour (always-on scale) */
    LC(hex) { return new Bucket(this, 1, hex); }
    _setM() { this.identity = false; this.nm.getNormalMatrix(this.m); }
    push(matrix) { this.stack.push(this.m.clone()); this.m.multiply(matrix); this._setM(); return this; }
    pop() { this.m = this.stack.pop(); this._setM(); this.identity = this.stack.length === 0; return this; }
    /** push translate(p) * rotateY(ry) * rotateX(rx) * rotateZ(rz) * scale(s) */
    place(p, ry = 0, rx = 0, rz = 0, s = 1) {
      const m = new T.Matrix4(); const q = new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz, 'YXZ'));
      m.compose(new T.Vector3(p[0], p[1], p[2]), q, new T.Vector3(s, s, s));
      return this.push(m);
    }
    _vert(p, n, c, bucket) {
      let x = p[0]; let y = p[1]; let z = p[2]; let nx = n[0]; let ny = n[1]; let nz = n[2];
      if (!this.identity) {
        const e = this.m.elements;
        x = e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12]; y = e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13]; z = e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14];
        const m3 = this.nm.elements;
        nx = m3[0] * n[0] + m3[3] * n[1] + m3[6] * n[2]; ny = m3[1] * n[0] + m3[4] * n[1] + m3[7] * n[2]; nz = m3[2] * n[0] + m3[5] * n[1] + m3[8] * n[2];
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      }
      this.pos.push(x, y, z); this.nrm.push(nx, ny, nz);
      if (bucket.mode === 1 && !bucket.emCol) this.col.push(c[0] * LAMP_DIFFUSE, c[1] * LAMP_DIFFUSE, c[2] * LAMP_DIFFUSE); else this.col.push(c[0], c[1], c[2]);
      if (bucket.mode < 0) this.em.push(0, 0, 0, 0);
      else if (bucket.mode === 1 && !bucket.emCol) this.em.push(c[0], c[1], c[2], 1);
      else this.em.push(bucket.emCol[0], bucket.emCol[1], bucket.emCol[2], bucket.mode);
    }
    /** a line segment (cables); transformed by the current matrix */
    line(a, b, col) {
      const c = rgb(col); const e = this.m.elements; const id = this.identity;
      for (const p of [a, b]) {
        if (id) this.lineP.push(p[0], p[1], p[2]);
        else this.lineP.push(e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12], e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13], e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14]);
        this.lineC.push(c[0], c[1], c[2]);
      }
      return this;
    }
    geometry() {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.nrm, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(this.col, 3));
      g.setAttribute('aEm', new T.Float32BufferAttribute(this.em, 4));
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    }
    mesh(name) {
      const mesh = new T.Mesh(this.geometry(), material);
      mesh.name = name || 'fouer-big'; mesh.matrixAutoUpdate = true;
      mesh.userData.tris = this.count / 3;
      return mesh;
    }
    lines(name) {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.lineP, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(this.lineC, 3));
      g.computeBoundingSphere();
      const l = new T.LineSegments(g, lineMaterial); l.name = name || 'fouer-big-lines';
      return l;
    }
    get hasLines() { return this.lineP.length > 0; }
  }

  /* ---------------------------------------------------------------- CPU skinning for rigid parts */
  function dynamic(geometry, ranges, extraBoundsRadius, boundsCenter) {
    const pos = geometry.attributes.position; const nrm = geometry.attributes.normal;
    pos.setUsage(T.DynamicDrawUsage); nrm.setUsage(T.DynamicDrawUsage);
    const bp = pos.array.slice(); const bn = nrm.array.slice();
    const nm = new T.Matrix3();
    if (extraBoundsRadius) { geometry.boundingSphere = new T.Sphere(boundsCenter ? new T.Vector3(boundsCenter[0], boundsCenter[1], boundsCenter[2]) : geometry.boundingSphere.center.clone(), extraBoundsRadius); }
    return {
      count: ranges.length, ranges,
      set(i, m) {
        const [s, n] = ranges[i]; const e = m.elements; nm.getNormalMatrix(m); const f = nm.elements;
        const P = pos.array; const N = nrm.array;
        for (let v = s; v < s + n; v++) {
          const o = v * 3; const x = bp[o]; const y = bp[o + 1]; const z = bp[o + 2];
          P[o] = e[0] * x + e[4] * y + e[8] * z + e[12]; P[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; P[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          const a = bn[o]; const bb = bn[o + 1]; const c = bn[o + 2];
          N[o] = f[0] * a + f[3] * bb + f[6] * c; N[o + 1] = f[1] * a + f[4] * bb + f[7] * c; N[o + 2] = f[2] * a + f[5] * bb + f[8] * c;
        }
      },
      commit() { pos.needsUpdate = true; nrm.needsUpdate = true; },
    };
  }

  /** rewrite colour + emissive of lamp vertices [start, start + n) (LED chase) */
  function setLamp(geometry, start, n, c) {
    const col = geometry.attributes.color; const em = geometry.attributes.aEm; const ca = col.array; const ea = em.array;
    for (let v = start; v < start + n; v++) { ca[v * 3] = c[0] * LAMP_DIFFUSE; ca[v * 3 + 1] = c[1] * LAMP_DIFFUSE; ca[v * 3 + 2] = c[2] * LAMP_DIFFUSE; ea[v * 4] = c[0]; ea[v * 4 + 1] = c[1]; ea[v * 4 + 2] = c[2]; }
  }
  function lampDynamic(geometry) { geometry.attributes.color.setUsage(T.DynamicDrawUsage); geometry.attributes.aEm.setUsage(T.DynamicDrawUsage); return { commit() { geometry.attributes.color.needsUpdate = true; geometry.attributes.aEm.needsUpdate = true; } }; }

  return {
    T, material, lineMaterial, uniforms, setNight, rgb, mixRgb, scaleRgb, dynamic, setLamp, lampDynamic,
    builder: () => new Builder(),
    math: { v3, sub, add, mul, cross, dot, len, norm, lerp3 },
  };
}

/* ------------------------------------------------------------------ small shared props (wheel + towers) */
const GOLD_ = 0xf0c24a;
export function glassWin(b, p, q, h) {
  const g = b.G([1, 0.8, 0.45]);
  g.quad([p[0], p[1] - h / 2, p[2]], [q[0], q[1] - h / 2, q[2]], [q[0], q[1] + h / 2, q[2]], [p[0], p[1] + h / 2, p[2]], 0x24424a);
}
export function bulb(b, p, s, col) {
  b.L.quad([p[0] - s / 2, p[1], p[2]], [p[0] + s / 2, p[1], p[2]], [p[0] + s / 2, p[1] + s, p[2]], [p[0] - s / 2, p[1] + s, p[2]], col);
  b.L.quad([p[0], p[1], p[2] - s / 2], [p[0], p[1], p[2] + s / 2], [p[0], p[1] + s, p[2] + s / 2], [p[0], p[1] + s, p[2] - s / 2], col);
}
export function flag(b, x, z, pal) {
  const P = b.P; const d = x > 0 ? -1 : 1;           // the flag streams toward the pitch centre, so it never leaves the pitch
  P.tube([x, 0.3, z], [x, 7.2, z], 0.07, 0xcfd3d6, { sides: 4, flat: true });
  const y = 6.4; const w = 1.5 * d; const h = 0.3;
  P.quad([x, y, z], [x + w, y - 0.05, z + 0.15], [x + w, y - h - 0.05, z + 0.15], [x, y - h, z], 0xe3242b);
  P.quad([x, y - h, z], [x + w, y - h - 0.05, z + 0.15], [x + w, y - 2 * h - 0.05, z + 0.15], [x, y - 2 * h, z], 0xffffff);
  P.quad([x, y - 2 * h, z], [x + w, y - 2 * h - 0.05, z + 0.15], [x + w, y - 3 * h - 0.05, z + 0.15], [x, y - 3 * h, z], 0x62c1e6);
}
/** Hämmi, the game's own sheep: white fluffy body, dark face, red-white-light-blue ribbon (own design) */
export function sheep(b, x, z, ry, gold) {
  const P = b.P;
  P.box(x, 0.55, z, 1.9, 0.5, 1.9, gold ? GOLD_ : 0x8a4a3a, 32);
  b.place([x, 0.85, z], ry);
  const wool = 0xf7f4ec;
  for (const [px, py, pz, r] of [[0, 0.95, 0, 0.5], [0.28, 0.85, 0.25, 0.4], [-0.28, 0.85, 0.25, 0.4], [0.28, 0.85, -0.25, 0.4], [-0.28, 0.85, -0.25, 0.4], [0, 1.15, 0.05, 0.35]]) P.sphere([px, py, pz], r, wool, 8, 5);
  P.sphere([0, 1.12, 0.62], 0.26, 0x2d2a2a, 8, 5);
  for (const sx of [-1, 1]) { P.sphere([sx * 0.26, 1.28, 0.58], 0.1, 0x2d2a2a, 6, 4); for (const sz of [-0.3, 0.3]) P.tube([sx * 0.25, 0.55, sz], [sx * 0.25, 0.0, sz], 0.07, 0x2d2a2a, { sides: 4 }); }
  P.tube([-0.25, 0.9, 0.5], [0.25, 0.9, 0.5], 0.09, 0xe3242b, { sides: 5 }); P.tube([-0.2, 0.82, 0.52], [0.2, 0.82, 0.52], 0.07, 0x62c1e6, { sides: 5 });
  b.pop();
}


/* ------------------------------------------------------------------ model wrapper (shared by wheel.js / towers.js) */

/** Wrap two LOD sub-groups into the model contract.
 *  parts: { id, near, far, animateNear(t, dt, k), animateFar(t, dt, k), onNight(k), footprint:{x,z}, extra } */
export function finishModel(T, kit, spec) {
  const group = new T.Group(); group.name = spec.id;
  const near = spec.near; const far = spec.far;
  if (near) { near.name = 'near'; group.add(near); }
  if (far) { far.name = 'far'; group.add(far); }
  const ud = group.userData;
  ud.lod = near ? 1 : 0; ud.animated = true; ud.footprint = spec.footprint; ud.lodDistance = spec.lodDistance || 80; ud.t = 0; ud.height = spec.height;
  const applyLod = () => { if (near) near.visible = ud.lod === 1; if (far) far.visible = ud.lod === 0 || !near; };
  applyLod();
  ud.setLOD = (level) => { ud.lod = near && level ? 1 : 0; applyLod(); };
  ud.setAnimated = (on) => { ud.animated = !!on; };
  ud.nightK = 0;
  ud.setNight = (k) => { ud.nightK = k; kit.setNight(k); if (spec.onNight) spec.onNight(k); };
  ud.animate = (t, dt, k = ud.nightK) => {
    ud.t = t;
    if (k !== ud.nightK) ud.setNight(k);
    if (!ud.animated) return;
    if (ud.lod === 1 && spec.animateNear) spec.animateNear(t, dt, k);
    else if (spec.animateFar) spec.animateFar(t, dt, k);
  };
  ud.stats = () => {
    let tris = 0; let draws = 0;
    group.traverse((o) => {
      if (!o.visible && o !== group) return;
      let p = o.parent; let vis = true; while (p && p !== group) { if (!p.visible) vis = false; p = p.parent; }
      if (!vis) return;
      if (o.isMesh) { draws++; tris += o.geometry.attributes.position.count / 3; } else if (o.isLineSegments) draws++;
    });
    return { tris: Math.round(tris), draws };
  };
  ud.uniforms = kit.uniforms; ud.lineMaterial = kit.lineMaterial;
  ud.dispose = () => { group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); };
  Object.assign(ud, spec.extra || {});
  // first pose (t = 0, rest): places the CPU-skinned parts and the lamp colours
  if (spec.animateNear && near) spec.animateNear(0, 0, 0);
  if (spec.animateFar) spec.animateFar(0, 0, 0);
  return group;
}

/** the "nearest N animate, the nearest within `distance` get the full model" rule.  entries: THREE.Group models; cameraPos: Vector3-like */
export function updateLODs(models, cameraPos, { nearN = 3, distance = 80, world = true } = {}) {
  const ranked = models.map((g) => { const p = g.getWorldPosition ? g.getWorldPosition(new g.position.constructor()) : g.position; return { g, d: Math.hypot(p.x - cameraPos.x, p.z - cameraPos.z) + Math.abs((g.userData.height || 0) * 0.15) }; }).sort((a, b) => a.d - b.d);
  ranked.forEach((e, i) => {
    const ud = e.g.userData;
    const lodNear = e.d < (ud.lod === 1 ? distance * 1.1 : distance);   // hysteresis
    ud.setLOD(lodNear ? 1 : 0);
    ud.setAnimated(i < nearN);
  });
  return ranked.map((e) => ({ id: e.g.name, d: Math.round(e.d), lod: e.g.userData.lod, animated: e.g.userData.animated }));
}

/** a square lattice mast between y0 and y1 (width w0 -> w1), chords as beams, one diagonal + one tie ribbon per face and panel.
 *  o: cx, cz, y0, y1, w0, w1, panel, chord, brace, chordCol, braceCol, chordBucket, braceBucket, ties */
export function latticeMast(b, o) {
  const cx = o.cx || 0; const cz = o.cz || 0; const panel = o.panel || 2.4; const chord = o.chord || 0.2; const brace = o.brace || 0.1;
  const cB = o.chordBucket || b.P; const bB = o.braceBucket || b.P; const bc = o.braceCol === undefined ? o.chordCol : o.braceCol;
  const n = Math.max(1, Math.round((o.y1 - o.y0) / panel)); const wAt = (t) => lerp(o.w0, o.w1, t);
  const SX = [-1, 1, 1, -1]; const SZ = [-1, -1, 1, 1]; const NORM = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
  const corner = (k, y, w) => [cx + SX[k] * w / 2, y, cz + SZ[k] * w / 2];
  for (let k = 0; k < 4; k++) cB.beam(corner(k, o.y0, o.w0), corner(k, o.y1, o.w1), chord, o.chordCol);
  for (let j = 0; j < n; j++) {
    const ta = j / n; const tb = (j + 1) / n; const ya = lerp(o.y0, o.y1, ta); const yb = lerp(o.y0, o.y1, tb); const wa = wAt(ta); const wb = wAt(tb);
    for (let f = 0; f < 4; f++) {
      const f2 = (f + 1) % 4;
      const a = corner(f, ya, wa); const bb = corner(f2, ya, wa); const c = corner(f, yb, wb); const d = corner(f2, yb, wb);
      if ((j + f) % 2 === 0) bB.ribbon(a, d, brace, NORM[f], bc); else bB.ribbon(bb, c, brace, NORM[f], bc);
      if (o.ties !== false) bB.ribbon(c, d, brace, NORM[f], bc);
    }
  }
  return b;
}
