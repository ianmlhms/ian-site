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
function pushTier(pos, nrm, col, y0, y1, r, tips, colour, snow, rot = 0) {
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
    for (const p of [p0, p1, [0, y0 + 0.35, 0]]) { pos.push(p[0], p[1], p[2]); nrm.push(0, -1, 0); col.push(colour[0] * 0.6, colour[1] * 0.6, colour[2] * 0.6, 0); }
  }
}
function pushPrism(pos, nrm, col, y0, y1, r, sides, colour) {
  for (let i = 0; i < sides; i++) {
    const a0 = i / sides * Math.PI * 2, a1 = (i + 1) / sides * Math.PI * 2;
    const x0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r, x1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
    const am = (a0 + a1) / 2, nx = Math.cos(am), nz = Math.sin(am);
    for (const [x, y, z] of [[x0, y0, z0], [x0, y1, z0], [x1, y1, z1], [x0, y0, z0], [x1, y1, z1], [x1, y0, z1]]) {
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
const spruceNear = () => build((p, n, c) => {
  pushPrism(p, n, c, -0.3, 1.8, 0.2, 5, BARK);
  const tiers = [[0.9, 3.6, 2.25, 8], [2.4, 5.0, 1.9, 8], [3.8, 6.4, 1.55, 7], [5.2, 7.8, 1.2, 7], [6.6, 9.6, 0.8, 6]];
  tiers.forEach(([y0, y1, r, tips], k) => pushTier(p, n, c, y0, y1, r, tips, k % 2 ? SPRUCE : SPRUCE_DARK, 0.72 + k * 0.05, k * 0.9));
});
const spruceFar = () => build((p, n, c) => { pushCone(p, n, c, 0, 0.6, 9.4, 2.0, 5, SPRUCE_DARK, 0.7); });
/* a larch in winter: a straight trunk and thin layered tiers of bare twigs (open, so the snow behind shows through the gaps) */
const larchNear = () => build((p, n, c) => {
  pushPrism(p, n, c, -0.3, 10.2, 0.17, 5, BARK);
  for (let k = 0; k < 9; k++) {                      // many slim whorls of drooping bare twigs: a narrow, see-through winter larch
    const y = 1.9 + k * 0.88, r = 1.3 * (1 - k / 10) + 0.18;
    pushTier(p, n, c, y - 0.35, y + 0.75, r, 5, k % 2 ? LARCH_TWIG : LARCH, 0.2, k * 1.3);
  }
});
const larchFar = () => build((p, n, c) => { pushCone(p, n, c, 0, 1.0, 9.6, 1.8, 5, LARCH, 0.2); });

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
