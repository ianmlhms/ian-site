/* Schueberfouer Tycoon, polish wave "Glow & density": the night light of the fair.
 *
 * The real Schueberfouer is a blaze: thousands of bulbs with halos, saturated colour washing over facades and falling on the asphalt.  Three pieces make our
 * night read like that without a single dynamic light:
 *   1. BULB HALOS: the shared `bulbs` Points material (models/materials.js) draws every bulb as a hard core + an additive bloom sized in world metres
 *      (distance attenuated, chasing / twinkling in the vertex shader).  Models register bulbs the way they always did (Builder.bulb / bulbRow / bulbRing);
 *      big rides (own emissive material, big-kit.js) get their halo points harvested from their lamp vertices: `attachHalos(group)`.
 *   2. A BAKED LIGHT MAP: every registered bulb splats a gaussian (wider and weaker the higher it hangs) into one small RGBA8 texture covering the fair
 *      (0.5-0.75 m / texel, sqrt encoded).  The painted materials (solid / fabric / sign / signLit / big-lit) read it by WORLD position and add
 *      `albedo x light x heightFade` as emissive, so light falls on stall walls, tent canvas and ride bases.  Zero extra draw calls.
 *   3. A GROUND OVERLAY: one additive mesh draped on the terrain (2.5 m grid, only cells that actually receive light) shows the same light map on the asphalt.
 *
 *   const glow = createGlow({ T, root: renderer.gameRoot, groundY, fieldPoly, quality });
 *   glow.setLightsFrom(object3D)      // (re)bake from every `bulbs` Points below object3D (game-frame world matrices); debounced bake in update()
 *   glow.setLights(Float32Array)      // raw: [x, y, z, r, g, b, w] * n, w = strength (a 0.14 m bulb = 1)
 *   glow.addLight(x, y, z, hex, w)    // a free light (lamp post, sign) before the next bake
 *   glow.attachHalos(group)           // harvest the lamp vertices of a big-kit ride into halo Points children (idempotent), returns the number of points
 *   glow.setNight(k)  glow.update(dt)  glow.setQuality(q)  glow.stats()  glow.dispose()
 */
import { getMaterials } from '../models/materials.js';
import { makeHalos } from '../models/halos.js';

const RES = { low: 0.8, medium: 0.6, high: 0.5 };
const LM_RANGE = 4;                 // decoded light = enc^2 * LM_RANGE
const MARGIN = 18;
const CFG = { amp: 0.014, ground: 0.55 };   // light amplitude per bulb unit, ground overlay strength (tunable through glow.tune for the screenshot sessions)
const SIGMA0 = 1.7;                 // gaussian width (m) of a light at the ground
const SIGMA_PER_M = 0.3;            // plus this per metre of hanging height

export function createGlow({ T, root, groundY, fieldPoly, quality = 'medium' }) {
  const M = getMaterials();
  const U = M.U;
  let res = RES[quality] || RES.medium;
  const poly = fieldPoly && fieldPoly.length ? fieldPoly : [[13, 1], [292, 1], [292, 138], [13, 138]];
  const u0 = Math.min(...poly.map((p) => p[0])) - MARGIN; const u1 = Math.max(...poly.map((p) => p[0])) + MARGIN;
  const w0 = Math.min(...poly.map((p) => p[1])) - MARGIN; const w1 = Math.max(...poly.map((p) => p[1])) + MARGIN;
  const cu = (u0 + u1) / 2; const cw = (w0 + w1) / 2;
  const baseY = groundY(cu, cw);
  let nx = 0; let ny = 0; let acc = null; let data = null; let tex = null; let kernels = null;
  let lights = new Float32Array(0); const extra = []; let pending = null; let dirtyT = 0; let night = 0; let baked = 0; let lastMs = 0; let lightCount = 0;
  let groundOn = quality !== 'low';             // polish 2: the additive ground overlay is skipped on low (the light map still lights the painted surfaces)

  /* ---- ground overlay */
  const group = new T.Group(); group.name = 'fouer-glow'; root.add(group);
  const CELL = 6;                      // polish 2: 6 m (was 4): the overlay reads the light map per fragment, the grid only says where light exists (-3k triangles at night)
  const gx = Math.ceil((u1 - u0) / CELL); const gz = Math.ceil((w1 - w0) / CELL);
  const gpos = new Float32Array((gx + 1) * (gz + 1) * 3);
  for (let j = 0; j <= gz; j++) for (let i = 0; i <= gx; i++) { const u = u0 + i * CELL; const w = w0 + j * CELL; const o = (j * (gx + 1) + i) * 3; gpos[o] = u; gpos[o + 1] = groundY(u, w) + 0.1; gpos[o + 2] = w; }
  const gidx = new Uint32Array(gx * gz * 6);
  const ggeo = new T.BufferGeometry();
  ggeo.setAttribute('position', new T.BufferAttribute(gpos, 3)); ggeo.setIndex(new T.BufferAttribute(gidx, 1)); ggeo.setDrawRange(0, 0);
  ggeo.boundingSphere = new T.Sphere(new T.Vector3(cu, baseY, cw), Math.hypot(u1 - u0, w1 - w0) / 2 + 20);
  const gmat = new T.ShaderMaterial({
    name: 'fouer-glow-ground', transparent: true, depthWrite: false, depthTest: true, fog: false, toneMapped: true,
    blending: T.CustomBlending, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { uLM: U.uLM, uLMR: U.uLMR, uK: { value: 0 } },
    vertexShader: 'varying vec3 vW; void main() { vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uLM; uniform vec4 uLMR; uniform float uK; varying vec3 vW;
      void main() { vec3 e = texture2D(uLM, (vW.xz - uLMR.xy) * uLMR.zw).rgb; vec3 L = e * e * ${LM_RANGE.toFixed(1)} * uK;
        gl_FragColor = vec4(L, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const gmesh = new T.Mesh(ggeo, gmat); gmesh.frustumCulled = false; gmesh.renderOrder = 4; gmesh.name = 'fouer-glow-ground'; gmesh.visible = false;
  group.add(gmesh);

  /* ---- light map */
  function alloc() {
    nx = Math.ceil((u1 - u0) / res); ny = Math.ceil((w1 - w0) / res);
    acc = new Float32Array(nx * ny * 3); data = new Uint8Array(nx * ny * 4);
    if (tex) tex.dispose();
    tex = new T.DataTexture(data, nx, ny, T.RGBAFormat); tex.magFilter = T.LinearFilter; tex.minFilter = T.LinearFilter; tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping; tex.generateMipmaps = false; tex.needsUpdate = true;
    U.uLM.value = tex; U.uLMR.value.set(u0, w0, 1 / (nx * res), 1 / (ny * res)); U.uLMP.value.w = baseY;
    kernels = new Map();
  }
  alloc();
  function kernel(sig) {
    const q = Math.max(0, Math.min(11, Math.round((sig - 1.5) / 0.8))); let k = kernels.get(q);
    if (k) return k;
    const s = (1.5 + q * 0.8) / res; const r = Math.ceil(s * 2.6); const n = 2 * r + 1; const a = new Float32Array(n * n);
    let sum = 0; for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i + j * j) / (2 * s * s)); a[(j + r) * n + i + r] = v; sum += v; }
    // normalise so that the PEAK is 1: a wider light is dimmer through the height term, not through the area
    k = { r, n, a, s }; kernels.set(q, k); return k;
  }

  function bake() {
    const t0 = performance.now();
    acc.fill(0);
    const L = lights; const n = L.length / 7; lightCount = n;
    for (let i = 0; i < n; i++) {
      const o = i * 7; const x = L[o]; const y = L[o + 1]; const z = L[o + 2]; const w = L[o + 6];
      const h = Math.max(0, y - groundY(x, z));
      const sig = SIGMA0 + SIGMA_PER_M * h; const amp = w * CFG.amp / (1 + 0.035 * h * h);
      const k = kernel(sig); const cx = Math.round((x - u0) / res); const cy = Math.round((z - w0) / res);
      const ia = Math.max(0, cx - k.r); const ib = Math.min(nx - 1, cx + k.r); const ja = Math.max(0, cy - k.r); const jb = Math.min(ny - 1, cy + k.r);
      const cr = L[o + 3] * amp; const cg = L[o + 4] * amp; const cb = L[o + 5] * amp;
      for (let j = ja; j <= jb; j++) {
        let ko = (j - cy + k.r) * k.n + (ia - cx + k.r); let ao = (j * nx + ia) * 3;
        for (let ii = ia; ii <= ib; ii++, ko++, ao += 3) { const v = k.a[ko]; acc[ao] += cr * v; acc[ao + 1] += cg * v; acc[ao + 2] += cb * v; }
      }
    }
    // soft clip to [0, LM_RANGE), sqrt encode
    for (let p = 0, q = 0; p < nx * ny * 3; p += 3, q += 4) {
      for (let c = 0; c < 3; c++) { const v = acc[p + c]; const s = LM_RANGE * (1 - Math.exp(-v / LM_RANGE)); data[q + c] = Math.min(255, Math.round(Math.sqrt(s / LM_RANGE) * 255)); }
      data[q + 3] = 255;
    }
    tex.needsUpdate = true;
    // ground overlay: only the cells that receive any light
    let tri = 0; const thr = 6;
    for (let j = 0; j < gz; j++) for (let i = 0; i < gx; i++) {
      const tu = Math.min(nx - 1, Math.max(0, Math.floor((u0 + (i + 0.5) * CELL - u0) / res))); const tv = Math.min(ny - 1, Math.max(0, Math.floor(((w0 + (j + 0.5) * CELL) - w0) / res)));
      let on = false; for (let dj = -2; dj <= 2 && !on; dj++) for (let di = -2; di <= 2; di++) { const a = Math.min(nx - 1, Math.max(0, tu + di)); const b = Math.min(ny - 1, Math.max(0, tv + dj)); const q = (b * nx + a) * 4; if (data[q] > thr || data[q + 1] > thr || data[q + 2] > thr) { on = true; break; } }
      if (!on) continue;
      const a0 = j * (gx + 1) + i; const a1 = a0 + 1; const b0 = a0 + gx + 1; const b1 = b0 + 1;
      gidx[tri++] = a0; gidx[tri++] = b0; gidx[tri++] = a1; gidx[tri++] = a1; gidx[tri++] = b0; gidx[tri++] = b1;
    }
    ggeo.index.needsUpdate = true; ggeo.setDrawRange(0, tri); gmesh.userData.tris = tri / 3;
    baked++; lastMs = performance.now() - t0;
  }

  /* ---- collecting lights from a scene branch */
  const v = new T.Vector3();
  function collect(obj, out) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isPoints || o.material !== M.bulbs || !o.visible) return;
      let vis = true; for (let p = o.parent; p; p = p.parent) { if (p.visible === false) { vis = false; break; } if (p === obj) break; }
      if (!vis) return;
      const g = o.geometry.attributes; const pos = g.position; const col = g.aCol; const sz = g.aSize; const e = o.matrixWorld.elements;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
        const wgt = sz.getX(i) / 0.14;
        out.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14], col.getX(i), col.getY(i), col.getZ(i), Math.min(8, wgt));
      }
    });
    return out;
  }

  /** big-kit builds its halo points itself (models/halos.js, in Builder.mesh); this only catches meshes that were built without (idempotent) */
  function attachHalos(group_) {
    let total = 0;
    group_.traverse((m) => { if (m.isMesh && m.userData.glowHalos === undefined && m.geometry && m.geometry.attributes.aEm) { const pm = makeHalos(T, m); total += pm ? pm.geometry.attributes.position.count : 0; m.userData.glowHalos = m.userData.glowHalos || 0; } });
    return total;
  }

  const api = {
    group, texture: () => tex, baseY, bounds: { u0, u1, w0, w1 },
    setLights(arr) { lights = arr instanceof Float32Array ? arr : Float32Array.from(arr); pending = null; bake(); },
    addLight(x, y, z, hex, w = 1) { const c = new T.Color(hex); extra.push(x, y, z, c.r, c.g, c.b, w); },
    /** schedule a (debounced) bake from every bulb below `obj`; call again whenever the models changed */
    setLightsFrom(obj, now = false) { pending = obj; dirtyT = now ? 99 : 0; },
    attachHalos,
    /** screenshot-session tuning: glow.tune({ amp, ground, wall, haloK, haloI, lampGain, fabric }) */
    tune(o) { ['amp', 'ground'].forEach((k) => { if (o[k] !== undefined) CFG[k] = o[k]; }); ['wall', 'haloK', 'haloI', 'lampGain', 'fabric'].forEach((k) => { if (o[k] !== undefined) M.cfg[k] = o[k]; }); M.setNight(M.night.k); api.setNight(night); if (o.amp !== undefined && lights.length) bake(); return Object.assign({}, CFG, M.cfg); },
    setNight(k) { night = k; gmat.uniforms.uK.value = k * CFG.ground; gmesh.visible = groundOn && k > 0.01 && ggeo.drawRange.count > 0; },
    update(dt) {
      if (pending) { dirtyT += dt; if (dirtyT > 0.35) { const out = []; collect(pending, out); extra.forEach((e) => out.push(e)); pending = null; lights = Float32Array.from(out); bake(); gmesh.visible = groundOn && night > 0.01 && ggeo.drawRange.count > 0; } }
    },
    setQuality(q) { groundOn = q !== 'low'; gmesh.visible = groundOn && night > 0.01 && ggeo.drawRange.count > 0; const r = RES[q] || RES.medium; if (r !== res) { res = r; alloc(); if (lights.length) bake(); } },
    stats: () => ({ lights: lightCount, bakes: baked, lastBakeMs: +lastMs.toFixed(1), texture: `${nx}x${ny}`, groundTris: Math.round(ggeo.drawRange.count / 3), res }),
    dispose() { root.remove(group); ggeo.dispose(); gmat.dispose(); if (tex) tex.dispose(); tex = null; U.uLM.value = M.lmDefault; U.uLMP.value.x = 0; },
  };
  return api;
}
