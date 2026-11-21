/* Trees and boulders in the scene: instanced, painted (vertex colours + the shared light), two detail levels for the trees.
 * The instance lists are rebuilt from scatter.js blocks when the camera has moved REBUILD m (the blocks themselves are cached). */
import { BLOCK } from './scatter.js';
import { SHADOW_GLSL, instancedDepthMaterial } from './shadows.js';
import { FOG_GLSL } from './snow-shader.js';

const THREE = window.THREE;
const REBUILD = 30;

/* ---------------- geometry (pure arrays) ---------------- */
function pushCone(pos, nrm, col, cx, y0, y1, r, sides, colour, snow, rot = 0) {
  for (let i = 0; i < sides; i++) {
    const a0 = rot + i / sides * Math.PI * 2, a1 = rot + (i + 1) / sides * Math.PI * 2;
    const p0 = [Math.cos(a0) * r, y0, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, y0, Math.sin(a1) * r], tip = [0, y1, 0];
    const am = (a0 + a1) / 2, slope = r / (y1 - y0);
    const nn = [Math.cos(am), slope, Math.sin(am)];
    const l = Math.hypot(...nn);
    for (const p of [p0, tip, p1]) {
      pos.push(p[0] + cx, p[1], p[2]);
      nrm.push(nn[0] / l, nn[1] / l, nn[2] / l);
      const isTip = p === tip;
      col.push(colour[0], colour[1], colour[2], isTip ? snow * 0.6 : snow);
    }
  }
}
/* a spruce tier: a cone whose rim zig-zags (branch tips out, gaps in), the tips drooping a little: reads as a fir, not a party hat */
function pushTier(pos, nrm, col, y0, y1, r, tips, colour, snow, rot = 0, under = true) {
  const n = tips * 2;
  for (let i = 0; i < n; i++) {
    const a0 = rot + i / n * Math.PI * 2, a1 = rot + (i + 1) / n * Math.PI * 2;
    const r0 = i % 2 ? r * 0.62 : r, r1 = (i + 1) % 2 ? r * 0.62 : r;
    const d0 = i % 2 ? 0.12 : -0.18, d1 = (i + 1) % 2 ? 0.12 : -0.18;
    const p0 = [Math.cos(a0) * r0, y0 + d0, Math.sin(a0) * r0], p1 = [Math.cos(a1) * r1, y0 + d1, Math.sin(a1) * r1], tip = [0, y1, 0];
    const am = (a0 + a1) / 2, slope = r / (y1 - y0);
    const nn = [Math.cos(am), slope, Math.sin(am)];
    const l = Math.hypot(...nn);
    for (const p of [p0, tip, p1]) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(nn[0] / l, nn[1] / l, nn[2] / l);
      col.push(colour[0], colour[1], colour[2], p === tip ? snow * 0.5 : snow);
    }
    // underside (dark, no snow): closes the tier seen from below on steep slopes
    if (under) for (const p of [p0, p1, [0, y0 + 0.35, 0]]) { pos.push(p[0], p[1], p[2]); nrm.push(0, -1, 0); col.push(colour[0] * 0.6, colour[1] * 0.6, colour[2] * 0.6, 0); }
  }
}
function pushPrism(pos, nrm, col, y0, y1, r, sides, colour, rTop = r) {          // R7-D: rTop tapers it (a trunk)
  for (let i = 0; i < sides; i++) {
    const a0 = i / sides * Math.PI * 2, a1 = (i + 1) / sides * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const am = (a0 + a1) / 2, nx = Math.cos(am), nz = Math.sin(am);
    for (const [x, y, z] of [[c0 * r, y0, s0 * r], [c0 * rTop, y1, s0 * rTop], [c1 * rTop, y1, s1 * rTop], [c0 * r, y0, s0 * r], [c1 * rTop, y1, s1 * rTop], [c1 * r, y0, s1 * r]]) {
      pos.push(x, y, z); nrm.push(nx, 0, nz); col.push(colour[0], colour[1], colour[2], 0);
    }
  }
}
function build(fn) {
  const pos = [], nrm = [], col = [];
  fn(pos, nrm, col);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  return g;
}
const SPRUCE = [0.13, 0.27, 0.22], SPRUCE_DARK = [0.09, 0.2, 0.17], BARK = [0.3, 0.22, 0.17], LARCH = [0.44, 0.39, 0.35], LARCH_TWIG = [0.36, 0.31, 0.28];
/* ---- R7-D: near trees with branches (still one instanced draw call per kind; spruce ~230, larch ~330 triangles) ---- */
/** One triangle whose normal faces `ref` (outwards / up / down), the vertex normal softened towards `soft`; colours rgba (a = snow). */
function pushTri(pos, nrm, col, a, b, c, ref, soft, ca, cb = ca, cc = ca) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * ref[0] + ny * ref[1] + nz * ref[2] < 0) { [b, c] = [c, b]; [cb, cc] = [cc, cb]; nx = -nx; ny = -ny; nz = -nz; }
  const l = Math.hypot(nx, ny, nz) || 1;
  nx = nx / l + soft[0]; ny = ny / l + soft[1]; nz = nz / l + soft[2];
  const m = Math.hypot(nx, ny, nz) || 1;
  for (const [p, q] of [[a, ca], [b, cb], [c, cc]]) { pos.push(p[0], p[1], p[2]); nrm.push(nx / m, ny / m, nz / m); col.push(q[0], q[1], q[2], q[3]); }
}
/** A small seeded random: the trees look the same on every load. */
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const shadeOf = (c, k, snow) => [c[0] * k, c[1] * k, c[2] * k, snow];
/* A spruce / fir tier with real branches: every tip its own length and droop (a few long jagged ones), a shoulder between the trunk and
 * the tips (the branches go out, then hang), gaps tucked in between the tips, a dark underside. 5 triangles per tip. */
function pushSpruceTier(pos, nrm, col, rnd, { y0, y1, r, tips, colour, snow, rot, jag = 0.18 }) {
  const A = [0, y1, 0], T = [], M = [];
  for (let i = 0; i < tips; i++) {
    const a = rot + (i + (rnd() - 0.5) * 0.35) / tips * Math.PI * 2;
    const long = rnd() < jag ? 1.22 : 1;
    const ri = r * (0.84 + 0.3 * rnd()) * long, droop = 0.16 + 0.34 * rnd() + (long > 1 ? 0.2 : 0);
    T.push([Math.cos(a) * ri, y0 - droop, Math.sin(a) * ri, a, ri]);
    const ym = y0 - droop + (y1 - y0 + droop) * 0.5 + (y1 - y0) * 0.16;          // above the straight line apex -> tip: the shoulder
    M.push([Math.cos(a) * ri * 0.5, ym, Math.sin(a) * ri * 0.5]);
  }
  const cTip = () => shadeOf(colour, 1.05 + 0.14 * rnd(), snow * (0.5 + 0.4 * rnd()));
  const cA = shadeOf(colour, 0.82, snow * 0.6), cM = shadeOf(colour, 0.96, snow), cG = shadeOf(colour, 0.78, snow * 0.7), cU = shadeOf(colour, 0.55, 0);
  const C = [0, y0 + 0.45, 0];
  for (let i = 0; i < tips; i++) {
    const j = (i + 1) % tips, t0 = T[i], t1 = T[j], m0 = M[i], m1 = M[j];
    const ga = (t0[3] + t1[3]) / 2 + (j === 0 ? Math.PI : 0), gr = 0.56 * (t0[4] + t1[4]) / 2;
    const G = [Math.cos(ga) * gr, y0 + 0.22 + (y1 - y0) * 0.1, Math.sin(ga) * gr];
    const out0 = [Math.cos(t0[3]), 0.6, Math.sin(t0[3])], outG = [Math.cos(ga), 0.6, Math.sin(ga)];
    const soft0 = [Math.cos(t0[3]) * 0.45, 0.25, Math.sin(t0[3]) * 0.45], softG = [Math.cos(ga) * 0.45, 0.25, Math.sin(ga) * 0.45];
    pushTri(pos, nrm, col, A, m0, m1, [0, 1, 0], [0, 0.3, 0], cA, cM, cM);
    pushTri(pos, nrm, col, m0, t0, G, out0, soft0, cM, cTip(), cG);
    pushTri(pos, nrm, col, m0, G, m1, outG, softG, cM, cG, cM);
    pushTri(pos, nrm, col, m1, G, t1, outG, softG, cM, cG, cTip());
    pushTri(pos, nrm, col, C, t0, t1, [0, -1, 0], [0, -0.3, 0], cU);           // underside: closes the tier seen from below on steep slopes
  }
}
/* One bare larch branch: a drooping spray of twigs, wide at the end (the snow shows through between the branches), both faces. 8 triangles. */
function pushLarchBranch(pos, nrm, col, rnd, y, a, L, colour, snow) {
  const ca = Math.cos(a), sa = Math.sin(a), px = -sa, pz = ca;
  const droop = 0.32 + 0.3 * rnd(), w = 0.34 + 0.16 * rnd();
  const P = (d, h, s) => [ca * d + px * s, y + h, sa * d + pz * s];
  const B = P(0.1, 0, 0), ML = P(L * 0.5, 0.1, -w * 0.45), MR = P(L * 0.5, 0.1, w * 0.45);
  const TL = P(L * 0.95, -droop, -w), TR = P(L * 0.95, -droop, w), TT = P(L * 1.08, -droop - 0.22, 0);
  const top = shadeOf(colour, 0.95 + 0.15 * rnd(), snow), tip = shadeOf(colour, 1.12, snow * 0.4), under = shadeOf(colour, 0.62, 0);
  for (const [face, c0, c1] of [[1, top, tip], [-1, under, under]]) {
    const ref = [0, face, 0], soft = [ca * 0.3, 0.3 * face, sa * 0.3];
    pushTri(pos, nrm, col, B, ML, MR, ref, soft, c0);
    pushTri(pos, nrm, col, ML, TL, TT, ref, soft, c0, c1, c1);
    pushTri(pos, nrm, col, ML, TT, MR, ref, soft, c0, c1, c0);
    pushTri(pos, nrm, col, MR, TT, TR, ref, soft, c0, c1, c1);
  }
}
const spruceNear = () => build((p, n, c) => {
  const rnd = seeded(7);
  pushPrism(p, n, c, -0.3, 2.2, 0.21, 5, BARK, 0.15);                               // the trunk shows under the lowest skirt
  const tiers = [[1.15, 3.3, 2.35, 9, 0.3], [2.3, 4.6, 2.05, 9, 0.22], [3.5, 5.8, 1.72, 8, 0.18], [4.7, 7.0, 1.36, 7, 0.12], [5.9, 8.25, 1.0, 6, 0.1], [7.05, 9.35, 0.64, 5, 0]];
  tiers.forEach(([y0, y1, r, tips, jag], k) => pushSpruceTier(p, n, c, rnd, { y0, y1, r, tips, jag, colour: k % 2 ? SPRUCE : SPRUCE_DARK, snow: 0.7 + k * 0.05, rot: k * 0.9 + rnd() }));
  pushCone(p, n, c, 0, 9.0, 10.1, 0.18, 3, SPRUCE, 0.5);                            // the leader
});
/* far trees (round 5): two stacked cones each, so a far spruce still has a skirt and a top and a far larch stays slim (a single cone read
 * as a party hat); R7-D: the far skirt zig-zags too (no underside), so the near / far switch keeps the silhouette */
const spruceFar = () => build((p, n, c) => { pushTier(p, n, c, 0.7, 6.4, 2.2, 5, SPRUCE_DARK, 0.62, 0, false); pushTier(p, n, c, 3.9, 9.6, 1.3, 4, SPRUCE, 0.8, 0.6, false); });
/* a larch in winter: a straight tapering trunk to the top and whorls of bare drooping branches, airy: the snow behind shows through */
const larchNear = () => build((p, n, c) => {
  const rnd = seeded(11);
  pushPrism(p, n, c, -0.3, 10.6, 0.2, 5, BARK, 0.05);
  for (let k = 0; k < 8; k++) {
    const y = 1.8 + k * 1.05, L = 1.6 * (1 - k / 9) + 0.32, n5 = k < 6 ? 5 : 4;
    for (let b = 0; b < n5; b++) pushLarchBranch(p, n, c, rnd, y + (rnd() - 0.5) * 0.3, k * 2.4 + (b + (rnd() - 0.5) * 0.5) / n5 * Math.PI * 2, L * (0.85 + 0.3 * rnd()), b % 2 ? LARCH_TWIG : LARCH, 0.22);
  }
  pushCone(p, n, c, 0, 9.9, 11.0, 0.22, 3, LARCH_TWIG, 0.2);
});
const larchFar = () => build((p, n, c) => { pushPrism(p, n, c, -0.3, 3.0, 0.16, 4, BARK); pushCone(p, n, c, 0, 1.6, 7.0, 1.25, 5, LARCH_TWIG, 0.25); pushCone(p, n, c, 0, 4.6, 10.0, 0.75, 5, LARCH, 0.3, 0.6); });
/** R7-D: the tree geometries (the look checks count their triangles). */
export const TREE_GEOMETRY = Object.freeze({ spruceNear, spruceFar, larchNear, larchFar });

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 0.78 + 0.32 * Math.abs(Math.sin(x * 3.1 + z * 2.3) * Math.cos(y * 2.7 + x));
    pos.setXYZ(i, x * k * 1.15, y * k * 0.8, z * k);
  }
  g.computeVertexNormals();
  const n = g.attributes.normal;
  const col = [];
  for (let i = 0; i < pos.count; i++) col.push(0.4, 0.37, 0.35, Math.max(0, n.getY(i) - 0.35) * 1.6);
  const ig = new THREE.InstancedBufferGeometry();
  ig.setAttribute('position', g.attributes.position);
  ig.setAttribute('normal', g.attributes.normal);
  ig.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  ig.setIndex(g.index);
  return ig;
}

/* ---------------- material ---------------- */
const SCATTER_VERTEX = `
      attribute vec4 color; attribute vec4 aInst; attribute float aSeed;
      varying vec4 vCol; varying vec3 vN; varying float vDist; varying float vSeed; varying float vH; varying vec2 vXZ; varying vec3 vW;
      void main(){
        float a = aSeed * 6.2831;
        float c = cos(a), s = sin(a);
        vec3 p = position * aInst.w;
        p.xz = mat2(c, -s, s, c) * p.xz;
        vec3 n = normal; n.xz = mat2(c, -s, s, c) * n.xz;
        vec4 w = vec4(p + aInst.xyz, 1.0);
        vCol = color; vN = n; vSeed = aSeed; vH = position.y; vXZ = w.xz; vW = w.xyz;
        vec4 mv = viewMatrix * w; vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`;
function scatterMaterial(env, cheap) {
  return new THREE.ShaderMaterial({
    uniforms: env.u,
    defines: cheap ? { CHEAP: 1 } : {},
    vertexShader: SCATTER_VERTEX,
    fragmentShader: `
      #include <packing>
      ${SHADOW_GLSL}
      ${FOG_GLSL}
      uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround, uFogColor; uniform float uFogDensity, uShadowOn; uniform sampler2D uShadow; uniform vec4 uShadowRect;
      varying vec4 vCol; varying vec3 vN; varying float vDist; varying float vSeed; varying float vH; varying vec2 vXZ; varying vec3 vW;
      void main(){
        vec3 N = normalize(vN);
        float nl = dot(N, uSunDir);
        float vis = mix(1.0, texture2D(uShadow, (vXZ - uShadowRect.xy) / uShadowRect.zw).r, uShadowOn);
        #ifndef CHEAP
        vis = min(vis, sunMapShadow(vW, N));
        #endif
        float lit = smoothstep(-0.15, 0.7, nl) * vis;
        lit = mix(lit, floor(lit * 3.0 + 0.5) / 3.0, 0.3);
        vec3 amb = mix(uAmbGround, uAmbSky, 0.5 + 0.5 * N.y) * (0.72 + 0.28 * smoothstep(0.0, 8.0, vH));     // darker deep inside / low in the crown
        vec3 base = vCol.rgb * (0.86 + 0.28 * vSeed);
        // snow resting on the upward faces
        float snow = vCol.a * smoothstep(0.15, 0.55, N.y + (fract(vSeed * 37.0 + vH * 0.7) - 0.5) * 0.35);
        base = mix(base, vec3(0.93, 0.95, 1.0), snow);
        vec3 col = base * (amb * 0.62 + uSunColor * lit * 0.85);
        gl_FragColor = vec4(applyFog(col, vDist, uFogColor, uFogDensity), 1.0);
      }`,
  });
}

/* Niddreg: a soft blue-grey blob under each near tree (and rock), stretched away from the sun, laid onto the slope. */
const BLOB_VERTEX = `
  attribute vec4 aInst; attribute vec3 aNrm;
  uniform vec3 uSunDir;
  varying vec2 vUv; varying float vDist;
  void main(){
    vec3 n = normalize(aNrm);
    vec2 away = -uSunDir.xz / max(length(uSunDir.xz), 1e-3);
    float stretch = 1.0 + 1.4 * (1.0 - smoothstep(0.1, 0.9, uSunDir.y));
    vec2 q = position.xz * aInst.w * 0.32;
    vec2 d2 = q + away * dot(q, away) * (stretch - 1.0) + away * aInst.w * 0.16 * stretch;
    vec3 p = aInst.xyz + vec3(d2.x, 0.12 - dot(d2, n.xz) / max(n.y, 0.25), d2.y);      // on the plane of the slope
    vUv = position.xz;
    vec4 mv = viewMatrix * vec4(p, 1.0); vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
function blobMaterial(env) {
  return new THREE.ShaderMaterial({
    uniforms: env.u, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: BLOB_VERTEX,
    fragmentShader: `
      uniform float uOvercast;
      varying vec2 vUv; varying float vDist;
      void main(){
        float r = length(vUv);
        float a = (1.0 - smoothstep(0.35, 1.0, r)) * (0.3 - 0.2 * uOvercast) * (1.0 - smoothstep(60.0, 90.0, vDist));
        gl_FragColor = vec4(0.28, 0.34, 0.5, a);
      }`,
  });
}
function blobGeometry() {
  const g = new THREE.InstancedBufferGeometry();
  const pos = [], idx = [];
  const n = 10;
  pos.push(0, 0, 0);
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pos.push(Math.cos(a), 0, Math.sin(a)); idx.push(0, 1 + ((i + 1) % n), 1 + i); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function instanced(geometry, material, capacity) {
  const inst = new Float32Array(capacity * 4), seed = new Float32Array(capacity);
  geometry.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.instanceCount = 0;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, inst, seed, capacity, count: 0 };
}

export function createScatterView({ scene, scatter, env, quality, normalAt }) {
  let material = scatterMaterial(env, quality.cheapSnow);
  const depthMaterial = instancedDepthMaterial(SCATTER_VERTEX);
  const cap = 26000;
  const sets = {
    spruceNear: instanced(spruceNear(), material, 6000), spruceFar: instanced(spruceFar(), material, cap),
    larchNear: instanced(larchNear(), material, 4000), larchFar: instanced(larchFar(), material, cap),
    rocks: instanced(rockGeometry(), material, 4000),
  };
  for (const k of ['spruceNear', 'larchNear', 'rocks', 'spruceFar', 'larchFar']) { sets[k].mesh.castShadow = true; sets[k].mesh.customDepthMaterial = depthMaterial; }
  // blob shadows (Niddreg only)
  const blobGeo = blobGeometry();
  const BLOB_CAP = 3000;
  const blobInst = new Float32Array(BLOB_CAP * 4), blobNrm = new Float32Array(BLOB_CAP * 3);
  blobGeo.setAttribute('aInst', new THREE.InstancedBufferAttribute(blobInst, 4).setUsage(THREE.DynamicDrawUsage));
  blobGeo.setAttribute('aNrm', new THREE.InstancedBufferAttribute(blobNrm, 3).setUsage(THREE.DynamicDrawUsage));
  blobGeo.instanceCount = 0;
  const blobs = new THREE.Mesh(blobGeo, blobMaterial(env));
  blobs.frustumCulled = false; blobs.renderOrder = 2;
  const group = new THREE.Group();
  group.name = 'ski-scatter';
  for (const s of Object.values(sets)) group.add(s.mesh);
  group.add(blobs);
  scene.add(group);
  const nrm = { x: 0, y: 1, z: 0 };
  let last = { x: 1e9, z: 1e9 };
  let q = quality;
  const stats = { trees: 0, near: 0, rocks: 0 };

  function put(set, x, y, z, scale, seed) {
    if (set.count >= set.capacity) return;
    const i = set.count++;
    set.inst[i * 4] = x; set.inst[i * 4 + 1] = y; set.inst[i * 4 + 2] = z; set.inst[i * 4 + 3] = scale; set.seed[i] = seed;
  }
  function commit(set) {
    const g = set.mesh.geometry;
    g.instanceCount = set.count;
    const a = g.getAttribute('aInst'), b = g.getAttribute('aSeed');
    a.clearUpdateRanges ? a.clearUpdateRanges() : null;
    a.needsUpdate = true; b.needsUpdate = true;
  }

  const pending = [];
  const pendingKeys = new Set();
  let dirty = false, sinceRebuild = 0;
  /** Only blocks that are already generated are drawn; missing ones are queued and generated within a time budget per frame. */
  const ready = (bx, bz) => {
    if (scatter.has(bx, bz)) return true;
    const k = bx + ',' + bz;
    if (!pendingKeys.has(k)) { pendingKeys.add(k); pending.push([bx, bz]); }
    return false;
  };

  function rebuild(px, pz) {
    for (const s of Object.values(sets)) s.count = 0;
    pending.length = 0; pendingKeys.clear();
    const R = q.treeRadius, near2 = q.treeNear * q.treeNear, R2 = R * R;
    const b0x = Math.floor((px - R) / BLOCK), b1x = Math.floor((px + R) / BLOCK);
    const b0z = Math.floor((pz - R) / BLOCK), b1z = Math.floor((pz + R) / BLOCK);
    for (let bz = b0z; bz <= b1z; bz++) {
      for (let bx = b0x; bx <= b1x; bx++) {
        const cx = Math.max(bx * BLOCK, Math.min(px, (bx + 1) * BLOCK)) - px, cz = Math.max(bz * BLOCK, Math.min(pz, (bz + 1) * BLOCK)) - pz;
        if (cx * cx + cz * cz > R2) continue;
        if (!ready(bx, bz)) continue;
        const t = scatter.treeBlock(bx, bz);
        for (let i = 0; i < t.length; i += 6) {
          if (t[i + 5] > q.treeDensity) continue;
          const dx = t[i] - px, dz = t[i + 2] - pz, d2 = dx * dx + dz * dz;
          if (d2 > R2) continue;
          const larch = t[i + 4] > 0.5;
          put(d2 < near2 ? (larch ? sets.larchNear : sets.spruceNear) : (larch ? sets.larchFar : sets.spruceFar), t[i], t[i + 1], t[i + 2], t[i + 3], t[i + 5]);
        }
      }
    }
    const RR = q.rockRadius, RR2 = RR * RR;
    for (let bz = Math.floor((pz - RR) / BLOCK); bz <= Math.floor((pz + RR) / BLOCK); bz++) {
      for (let bx = Math.floor((px - RR) / BLOCK); bx <= Math.floor((px + RR) / BLOCK); bx++) {
        if (!ready(bx, bz)) continue;
        const r = scatter.rockBlock(bx, bz);
        for (let i = 0; i < r.length; i += 5) {
          const dx = r[i] - px, dz = r[i + 2] - pz;
          if (dx * dx + dz * dz < RR2) put(sets.rocks, r[i], r[i + 1], r[i + 2], r[i + 3], r[i + 4]);
        }
      }
    }
    for (const s of Object.values(sets)) commit(s);
    // blobs under the near trees and rocks (Niddreg: there is no shadow map)
    let nb = 0;
    if (q.cheapSnow && normalAt) {
      for (const set of [sets.spruceNear, sets.larchNear, sets.rocks]) {
        const rock = set === sets.rocks;
        for (let i = 0; i < set.count && nb < BLOB_CAP; i++) {
          const x = set.inst[i * 4], z = set.inst[i * 4 + 2];
          const dx = x - px, dz = z - pz;
          if (dx * dx + dz * dz > 85 * 85) continue;
          normalAt(x, z, nrm);
          blobInst[nb * 4] = x; blobInst[nb * 4 + 1] = set.inst[i * 4 + 1] + (rock ? 0 : 0.25); blobInst[nb * 4 + 2] = z; blobInst[nb * 4 + 3] = set.inst[i * 4 + 3] * (rock ? 2.2 : 9);
          blobNrm[nb * 3] = nrm.x; blobNrm[nb * 3 + 1] = nrm.y; blobNrm[nb * 3 + 2] = nrm.z;
          nb++;
        }
      }
    }
    blobGeo.instanceCount = nb;
    blobGeo.getAttribute('aInst').needsUpdate = true; blobGeo.getAttribute('aNrm').needsUpdate = true;
    blobs.visible = nb > 0;
    stats.trees = sets.spruceNear.count + sets.spruceFar.count + sets.larchNear.count + sets.larchFar.count;
    stats.near = sets.spruceNear.count + sets.larchNear.count;
    stats.rocks = sets.rocks.count;
    last = { x: px, z: pz };
  }

  return {
    group, stats,
    /** budgetMs: wall-clock time for generating missing blocks this frame (Infinity on the loading screen). */
    update(px, pz, force = false, budgetMs = 2.5, dt = 0.016) {
      sinceRebuild += dt;
      if (force || Math.hypot(px - last.x, pz - last.z) > REBUILD) rebuild(px, pz);
      if (!pending.length) return;
      const t0 = performance.now();
      // nearest first
      pending.sort((a, b) => Math.hypot(a[0] * BLOCK + 40 - px, a[1] * BLOCK + 40 - pz) - Math.hypot(b[0] * BLOCK + 40 - px, b[1] * BLOCK + 40 - pz));
      while (pending.length && performance.now() - t0 < budgetMs) { const [bx, bz] = pending.shift(); scatter.treeBlock(bx, bz); scatter.rockBlock(bx, bz); dirty = true; }
      if (dirty && (!pending.length || sinceRebuild > 0.6)) { dirty = false; sinceRebuild = 0; rebuild(px, pz); }
    },
    pending: () => pending.length,
    setQuality(next) {
      if (next.cheapSnow !== q.cheapSnow) { material.dispose(); material = scatterMaterial(env, next.cheapSnow); for (const st of Object.values(sets)) st.mesh.material = material; }
      q = next; last = { x: 1e9, z: 1e9 };
    },
    invalidate() { last = { x: 1e9, z: 1e9 }; },
  };
}
