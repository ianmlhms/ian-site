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

/** The geometry of a shaped part (w along a = local x, h = y, d along b = local z), centred on the origin. */
export function shapeGeometry(shape, w, h, d, inset = 0.4) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  if (shape === 'gableA') return facets(gableX(hx, hy, hz));
  if (shape === 'gableB') {                                       // the same prism turned a quarter: ridge along z
    const tris = gableX(hz, hy, hx).map((t) => t.map(([x, y, z]) => [z, y, -x]));
    return facets(tris);
  }
  if (shape === 'bevel') return facets(bevel(hx, hy, hz, inset));
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
