/* Station look (26 Nov 2026; Ian: "more beautiful the stations"): the geometry and the material of the merged station meshes of lifts.js.
 *   shapeGeometry(shape, w, h, d, inset)   a part's box drawn as a roof shape instead (centred like a BoxGeometry, x = along the line a,
 *                                          z = across it b): 'gableA' (ridge along a), 'gableB' (ridge along b), 'bevel' (the top face
 *                                          inset: a soft snow cap)
 *   mergeLit(parts)                        [geometry, colour, matrix, glow] -> one geometry with vertex colours and `aGlow` (> 0 lit in
 *                                          the evening: windows, lamps; -1 snow: kept a soft grey-blue in the evening shade)
 *   stationMaterial(env)                   the painted Lambert of the stations with the warm window / lamp glow of the village (env uGlow)
 * All station parts of a resort stay in the same merged chunks as before: no extra draw call for the glow or the shapes. */
const THREE = window.THREE;

/** Flat-shaded triangles (non-indexed): each face gets its own normal. */
function facets(tris) {
  const pos = new Float32Array(tris.length * 9), nrm = new Float32Array(tris.length * 9);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  tris.forEach(([A, B, C], k) => {
    e1.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]); e2.set(C[0] - A[0], C[1] - A[1], C[2] - A[2]);
    n.crossVectors(e1, e2).normalize();
    [A, B, C].forEach((P, j) => { pos.set(P, k * 9 + j * 3); nrm.set([n.x, n.y, n.z], k * 9 + j * 3); });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}
/** Two triangles of a quad A B C D (counter-clockwise seen from outside). */
const quad = (A, B, C, D) => [[A, B, C], [A, C, D]];

/** A prism over the triangle (-hz, -hy) (hz, -hy) (0, hy) in the z-y plane, along x (a gable roof with its ridge along x). */
function gableX(hx, hy, hz) {
  const P = (x, y, z) => [x, y, z];
  const l0 = P(-hx, -hy, -hz), l1 = P(-hx, -hy, hz), lt = P(-hx, hy, 0);
  const r0 = P(hx, -hy, -hz), r1 = P(hx, -hy, hz), rt = P(hx, hy, 0);
  return [
    [l0, l1, lt], [r0, rt, r1],                                   // the gable ends
    ...quad(l1, r1, rt, lt), ...quad(r0, l0, lt, rt),             // the two roof faces
    ...quad(l0, r0, r1, l1),                                      // the soffit (seen from under the eaves)
  ];
}

/** A box whose top face is inset by k (m) on every side. */
function bevel(hx, hy, hz, k) {
  const kx = Math.min(k, hx * 0.8), kz = Math.min(k, hz * 0.8);
  const b = [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]];
  const t = [[-hx + kx, hy, -hz + kz], [hx - kx, hy, -hz + kz], [hx - kx, hy, hz - kz], [-hx + kx, hy, hz - kz]];
  return [
    ...quad(t[0], t[3], t[2], t[1]), ...quad(b[0], b[1], b[2], b[3]),
    ...quad(b[0], t[0], t[1], b[1]), ...quad(b[1], t[1], t[2], b[2]), ...quad(b[2], t[2], t[3], b[3]), ...quad(b[3], t[3], t[0], b[0]),
  ];
}

/** Chairs round (26 Nov 2026): the outline (x, z) of a rounded slab in plan: a rectangle x0..x1 x -hz..hz whose +x end (round >= 1) and
 *  -x end (round 2) are half discs of radius hz (segs steps each); the same point count for any size (rings of one shell line up). */
function slabOutline(x0, x1, hz, round, segs) {
  const r = Math.max(0.05, Math.min(hz, (x1 - x0) / (round === 2 ? 2 : 1)));
  const pts = [];
  const arc = (cx, a0, a1) => { for (let k = 0; k <= segs; k++) { const t = a0 + (a1 - a0) * k / segs; pts.push([cx + Math.cos(t) * r, Math.sin(t) * hz * (r / Math.max(r, hz))]); } };
  if (round >= 1) arc(x1 - r, -Math.PI / 2, Math.PI / 2); else { pts.push([x1, -hz], [x1, hz]); }
  if (round === 2) arc(x0 + r, Math.PI / 2, Math.PI * 1.5); else { pts.push([x0, hz], [x0, -hz]); }
  return pts;
}

/** Turn every triangle to face away from c (the shapes here are convex: the right winding without bookkeeping). */
function outward(tris, c) {
  return tris.map(([A, B, C]) => {
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const m = [(A[0] + B[0] + C[0]) / 3 - c[0], (A[1] + B[1] + C[1]) / 3 - c[1], (A[2] + B[2] + C[2]) / 3 - c[2]];
    return n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0 ? [A, C, B] : [A, B, C];
  });
}

/** A chair terminal's shell (and its bands / snow): a rounded slab (slabOutline) extruded over -hy..hy whose top edge is chamfered by
 *  `chamfer` m (in and down) and set back `nose` m more at the front (-x): the sleek housing over the bull-wheel. form.open: the side
 *  walls only (a colour band round the shell), form.top: no bottom face (a snow cap). */
function shell(hx, hy, hz, { round = 1, segs = 5, chamfer = 0.4, nose = 0, open = false, top = false } = {}) {
  const c = Math.max(0, Math.min(chamfer, hz * 0.6, hy * 0.9)), n0 = Math.min(nose, hx);
  const lo = slabOutline(-hx, hx, hz, round, segs), hi = slabOutline(-hx + c + n0, hx - c, hz - c, round, segs);
  const yb = -hy, ym = hy - c, yt = hy, tris = [];
  const ring = (P, Q, y0, y1) => { for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; tris.push(...quad([P[i][0], y0, P[i][1]], [P[j][0], y0, P[j][1]], [Q[j][0], y1, Q[j][1]], [Q[i][0], y1, Q[i][1]])); } };
  if (c > 0.01 && !open) { ring(lo, lo, yb, ym); ring(lo, hi, ym, yt); } else ring(lo, lo, yb, yt);
  const fan = (P, y) => { for (let i = 1; i + 1 < P.length; i++) tris.push([[P[0][0], y, P[0][1]], [P[i][0], y, P[i][1]], [P[i + 1][0], y, P[i + 1][1]]]); };
  if (!open) { fan(c > 0.01 ? hi : lo, yt); if (!top) fan(lo, yb); }
  const cx = round === 2 ? 0 : -hx * 0.1;
  return outward(tris, [cx, open ? 0 : -hy * 0.2, 0]);
}

/** A rail bent round the bull-wheel: half an annulus (outer radius hz, `t` m wide) round (x = -hx, z = 0), from -z through +x to +z. */
function halfRing(hx, hy, hz, t = 0.16, segs = 8) {
  const ro = hz, ri = Math.max(0.05, hz - t), cx = -hx, tris = [];
  const P = (r, a, y) => [cx + Math.cos(a) * r, y, Math.sin(a) * r];
  for (let k = 0; k < segs; k++) {
    const a0 = -Math.PI / 2 + Math.PI * k / segs, a1 = -Math.PI / 2 + Math.PI * (k + 1) / segs;
    const q = [];
    q.push(...quad(P(ro, a0, -hy), P(ro, a1, -hy), P(ro, a1, hy), P(ro, a0, hy)));       // outer wall
    q.push(...quad(P(ri, a1, -hy), P(ri, a0, -hy), P(ri, a0, hy), P(ri, a1, hy)));       // inner wall
    q.push(...quad(P(ri, a0, hy), P(ro, a0, hy), P(ro, a1, hy), P(ri, a1, hy)));         // top
    q.push(...quad(P(ri, a1, -hy), P(ro, a1, -hy), P(ro, a0, -hy), P(ri, a0, -hy)));     // bottom
    tris.push(...q);
  }
  return tris.map(([A, B, C]) => [A, C, B]);
}

/** A slanted strut inside its box: from the bottom of the -x end to the top of the +x end (flip: the other diagonal), t m thick in x,
 *  the full depth in z (axis 'z': the slant across z instead, the full width in x). */
function strut(hx, hy, hz, { t = 0.22, flip = false, axis = 'x' } = {}) {
  const L = axis === 'z' ? hz : hx, W = axis === 'z' ? hx : hz, tt = Math.min(t, L);
  const s = flip ? -1 : 1;
  // the parallelogram in (u = along the slant axis, y): bottom edge at u = -L .. -L + tt, top edge at u = L - tt .. L (mirrored by flip)
  const pts = [[-L, -hy], [-L + tt, -hy], [L, hy], [L - tt, hy]].map(([u, y]) => [u * s, y]);
  const V = (u, y, w) => (axis === 'z' ? [w, y, u] : [u, y, w]);
  const [a, b, c, d] = pts, tris = [];
  const face = (w) => [[V(a[0], a[1], w), V(b[0], b[1], w), V(c[0], c[1], w)], [V(a[0], a[1], w), V(c[0], c[1], w), V(d[0], d[1], w)]];
  tris.push(...face(-W), ...face(W));
  const side = (p, q) => quad(V(p[0], p[1], -W), V(q[0], q[1], -W), V(q[0], q[1], W), V(p[0], p[1], W));
  tris.push(...side(a, b), ...side(b, c), ...side(c, d), ...side(d, a));
  return tris;
}

/** A ramp: the top face falls from hy at -z to -hy + lip at +z (`lip` m of the low edge stays), the box below. */
function wedgeZ(hx, hy, hz, lip = 0.06) {
  const yl = -hy + Math.min(lip, hy * 2);
  const b = [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]];
  const t = [[-hx, hy, -hz], [hx, hy, -hz], [hx, yl, hz], [-hx, yl, hz]];
  return [
    ...quad(t[0], t[3], t[2], t[1]), ...quad(b[0], b[1], b[2], b[3]),
    ...quad(b[0], t[0], t[1], b[1]), ...quad(b[1], t[1], t[2], b[2]), ...quad(b[2], t[2], t[3], b[3]), ...quad(b[3], t[3], t[0], b[0]),
  ];
}

/** A wheel rim seen from below and the side: a flat ring (outer radius hx = hz, `t` m wide), segs steps round. */
function rimRing(hx, hy, t = 0.22, segs = 14) {
  const ro = hx, ri = Math.max(0.05, hx - t), tris = [];
  const P = (r, a, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
  for (let k = 0; k < segs; k++) {
    const a0 = 2 * Math.PI * k / segs, a1 = 2 * Math.PI * (k + 1) / segs;
    tris.push(...quad(P(ro, a0, -hy), P(ro, a1, -hy), P(ro, a1, hy), P(ro, a0, hy)));
    tris.push(...quad(P(ri, a1, -hy), P(ri, a0, -hy), P(ri, a0, hy), P(ri, a1, hy)));
    tris.push(...quad(P(ri, a0, hy), P(ro, a0, hy), P(ro, a1, hy), P(ri, a1, hy)));
    tris.push(...quad(P(ri, a1, -hy), P(ro, a1, -hy), P(ro, a0, -hy), P(ri, a0, -hy)));
  }
  return tris.map(([A, B, C]) => [A, C, B]);
}
export { rimRing };

/** The geometry of a shaped part (w along a = local x, h = y, d along b = local z), centred on the origin. form: the shape's options
 *  (shell: round, segs, chamfer, nose, open, top; halfRing: t, segs; strut: t, flip, axis; wedge: lip). */
export function shapeGeometry(shape, w, h, d, inset = 0.4, form = null) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  if (shape === 'gableA') return facets(gableX(hx, hy, hz));
  if (shape === 'gableB') {                                       // the same prism turned a quarter: ridge along z
    const tris = gableX(hz, hy, hx).map((t) => t.map(([x, y, z]) => [z, y, -x]));
    return facets(tris);
  }
  if (shape === 'bevel') return facets(bevel(hx, hy, hz, inset));
  if (shape === 'shell') return facets(shell(hx, hy, hz, form || {}));
  if (shape === 'rim') return facets(rimRing(hx, hy, form && form.t, form && form.segs));
  if (shape === 'halfRing') return facets(halfRing(hx, hy, hz, form && form.t, form && form.segs));
  if (shape === 'strut') return facets(strut(hx, hy, hz, form || {}));
  if (shape === 'wedge') return facets(outward(wedgeZ(hx, hy, hz, form && form.lip), [0, -hy * 0.5, 0]));
  if (shape === 'monoA') {                                        // a shed roof: its top falls from hy at -x to -hy + 0.08 at +x
    const yl = -hy + Math.min(0.08, h);
    const b = [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]];
    const t = [[-hx, hy, -hz], [hx, yl, -hz], [hx, yl, hz], [-hx, hy, hz]];
    const tris = [...quad(t[0], t[3], t[2], t[1]), ...quad(b[0], b[1], b[2], b[3]),
      ...quad(b[0], t[0], t[1], b[1]), ...quad(b[1], t[1], t[2], b[2]), ...quad(b[2], t[2], t[3], b[3]), ...quad(b[3], t[3], t[0], b[0])];
    return facets(outward(tris, [0, -hy * 0.5, 0]));
  }
  return new THREE.BoxGeometry(w, h, d);
}

/** Merge [geometry, colour, matrix, glow] parts into one geometry (position, normal, colour, aGlow). The parts' geometries are disposed. */
export function mergeLit(parts) {
  let count = 0;
  const flat = parts.map(([geo, colour, matrix, glow]) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (matrix) g.applyMatrix4(matrix);
    count += g.attributes.position.count;
    return [g, new THREE.Color(colour), glow || 0];
  });
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), col = new Float32Array(count * 3), glw = new Float32Array(count);
  let o = 0;
  for (const [g, c, glow] of flat) {
    const P = g.attributes.position.array, N = g.attributes.normal.array, n = g.attributes.position.count;
    pos.set(P, o * 3); nrm.set(N, o * 3);
    for (let i = 0; i < n; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; glw[o + i] = glow; }
    o += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aGlow', new THREE.BufferAttribute(glw, 1));
  out.computeBoundingSphere();
  return out;
}

/** The stations' material: vertex-coloured Lambert (lit by the sun and sky like the carriers), windows and lamps glow warm with the
 *  env's evening glow (env.u.uGlow, as the village windows), snow keeps the soft shade of the village roofs under a low sun. */
export function stationMaterial(env) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const u = env && env.u ? env.u : { uGlow: { value: 0 }, uSunColor: { value: new THREE.Vector3(1, 1, 1) }, uOvercast: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = u.uGlow; sh.uniforms.uSunColor = u.uSunColor; sh.uniforms.uOvercast = u.uOvercast;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uGlow, uOvercast;\nuniform vec3 uSunColor;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vGlow > 0.0) totalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * (vGlow * uGlow);`)
      .replace('#include <opaque_fragment>', `
        if (vGlow < -0.5) {
          float evK = smoothstep(0.72, 0.5, uSunColor.b / max(uSunColor.r, 1e-3)) * (1.0 - uOvercast);
          // (the village roofs' evening shade, village.js: the light soft grey-blue of the snow, never the saturated slate of the sky)
          float L = dot(outgoingLight, vec3(0.3, 0.59, 0.11));
          vec3 lift = vec3(min(L * 1.55, 0.86)) * vec3(0.95, 0.98, 1.04);
          outgoingLight = mix(outgoingLight, max(outgoingLight, lift), evK);
        }
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'ski-station-lit';
  return mat;
}
