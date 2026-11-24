/* Distant forests: painted tree cards (billboards that turn round their trunk) from the edge of the instanced 3D trees out to a few km,
 * placed from the land-cover raster (forest = spruce / pine, open stands = larch), so a forest reads as a forest from the far side of the
 * valley instead of a dark stain on the snow. One instanced draw call; the cards are painted on a canvas at load (our own drawing: a snowy
 * spruce, a darker spruce, a bare larch), shaded from the sun's side, sunk a little into the ground (the far terrain is coarser).
 * Instances are generated per 320 m block (cached, time-sliced) and re-collected when the camera has moved REBUILD m. */
import { hash2 } from './noise.js';
import { FOG_GLSL } from './snow-shader.js';
import { liftTreeGuard } from './lift-site.js';
import { createLiftPath } from './lift-path.js';

const THREE = typeof window !== 'undefined' ? window.THREE : null;     // R8c: the Node checks import farTreesOfBlock
export const BLOCK = 320;
const CELL = 10;                 // the class raster's cell
const REBUILD = 70;
const CAP = 90000;
const KEEP_FOREST = 0.85, KEEP_SCRUB = 0.3;

/* ring per quality level: inner = a little inside the 3D trees' radius, outer = where the cards stop, thin = from here the cards thin out
 * (and grow, so the forest keeps its tone) */
export const FAR_FOREST = Object.freeze({
  low: { outer: 1600, thin: 850, keep: 0.45 },          // R8c: triangle budget (Niddreg / Mëttel <= 450k in every village)
  medium: { outer: 2500, thin: 1350, keep: 0.66 },
  high: { outer: 4200, thin: 2200, keep: 1 },
});

function paintAtlas() {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // 1, 2: spruces (snowy / dark): tiers of drooping branches, snow on their tops
  const spruce = (ox, dark) => {
    const cx = ox + 64, base = 250, top = 8;
    g.fillStyle = '#4a3a2e'; g.fillRect(cx - 4, base - 26, 8, 26);
    const tiers = 9;
    for (let k = 0; k < tiers; k++) {
      const t = k / (tiers - 1);
      const y0 = base - 18 - t * (base - 40 - top);
      const half = 56 * (1 - t) + 7;
      const yTop = y0 - 46 * (1 - t * 0.35);
      g.fillStyle = dark ? (k % 2 ? '#183026' : '#1d382d') : (k % 2 ? '#20402f' : '#264a37');
      g.beginPath();
      g.moveTo(cx - half, y0 + 6);
      for (let s = -half; s <= half; s += 9) g.lineTo(cx + s, y0 + 4 + rnd() * 7);      // ragged branch tips
      g.lineTo(cx + half, y0 + 6);
      g.lineTo(cx, yTop);
      g.closePath(); g.fill();
      // snow lying on the tier (upper side), lumpy
      g.fillStyle = dark ? 'rgba(236,242,250,0.72)' : 'rgba(244,248,255,0.95)';
      g.beginPath();
      g.moveTo(cx - half * 0.9, y0 - 1);
      for (let s = -half * 0.9; s <= half * 0.9; s += 7) g.lineTo(cx + s, y0 - 3 - rnd() * 5 - (1 - Math.abs(s) / half) * 8);
      g.lineTo(cx + half * 0.55, y0 - 10 - 12 * (1 - t));
      g.lineTo(cx, yTop + 6);
      g.lineTo(cx - half * 0.6, y0 - 8 - 10 * (1 - t));
      g.closePath(); g.fill();
    }
    g.fillStyle = dark ? '#1a3329' : '#2a4d3a';
    g.beginPath(); g.moveTo(cx - 5, 30); g.lineTo(cx, top); g.lineTo(cx + 5, 30); g.closePath(); g.fill();
  };
  // 3: larch in winter: straight trunk, thin layered twigs, copper-grey haze, a little snow
  const larch = (ox) => {
    const cx = ox + 64, base = 250, top = 12;
    g.strokeStyle = '#4b3b31'; g.lineWidth = 5; g.beginPath(); g.moveTo(cx, base); g.lineTo(cx, top); g.stroke();
    for (let k = 0; k < 34; k++) {
      const t = k / 33;
      const y = base - 30 - t * (base - 50 - top);
      const half = 46 * (1 - t) + 6;
      g.strokeStyle = k % 3 ? 'rgba(112,98,88,0.9)' : 'rgba(136,120,104,0.85)';
      g.lineWidth = 2.2;
      for (const sgn of [-1, 1]) {
        g.beginPath(); g.moveTo(cx, y); g.quadraticCurveTo(cx + sgn * half * 0.6, y - 2, cx + sgn * half * (0.75 + rnd() * 0.3), y + 5 + rnd() * 4); g.stroke();
      }
    }
    g.fillStyle = 'rgba(128,114,102,0.22)';
    g.beginPath(); g.moveTo(cx - 50, base - 30); g.lineTo(cx, top + 10); g.lineTo(cx + 50, base - 30); g.closePath(); g.fill();
  };
  spruce(0, false); spruce(128, true); larch(256);
  // 4: a pine-ish rounded crown (lower slopes)
  {
    const cx = 384 + 64;
    g.fillStyle = '#4a3a2e'; g.fillRect(cx - 4, 170, 8, 80);
    for (let k = 0; k < 26; k++) {
      const a = rnd() * Math.PI * 2, r = rnd() * 36;
      const x = cx + Math.cos(a) * r * 1.1, y = 110 + Math.sin(a) * r * 1.5 - 10;
      g.fillStyle = k % 2 ? '#22412f' : '#1b3628';
      g.beginPath(); g.ellipse(x, y, 22, 14, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(244,248,255,0.85)';
      g.beginPath(); g.ellipse(x, y - 8, 15, 5, 0, 0, Math.PI * 2); g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

function material(env, atlas) {
  return new THREE.ShaderMaterial({
    uniforms: { ...env.u, uAtlas: { value: atlas } },
    alphaToCoverage: true,
    extensions: { derivatives: true },
    vertexShader: `
      attribute vec4 aInst; attribute vec2 aKind;
      uniform vec3 uSunDir;
      varying vec2 vUv; varying float vDist; varying float vSide; varying float vSeed; varying vec2 vXZ;
      void main(){
        vec3 base = aInst.xyz;
        vec3 toCam = cameraPosition - base; toCam.y = 0.0;
        vec3 fwd = normalize(toCam + vec3(1e-4, 0.0, 0.0));
        vec3 right = vec3(fwd.z, 0.0, -fwd.x);
        float s = aInst.w;
        float w = s * (aKind.x > 1.5 ? 6.2 : 5.4), h = s * 12.0;
        vec3 p = base + right * (position.x * w) + vec3(0.0, position.y * h, 0.0);
        vUv = vec2(0.25 * (aKind.x + position.x + 0.5), position.y);
        // which side of the card faces the sun (screen right or left), and how much the sun is behind the tree
        vSide = dot(right, normalize(vec3(uSunDir.x, 0.0, uSunDir.z))) * (1.0 - 0.6 * uSunDir.y);
        vSeed = aKind.y; vXZ = base.xz;
        vec4 mv = viewMatrix * vec4(p, 1.0); vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uAtlas, uShadow; uniform vec4 uShadowRect; uniform float uShadowOn;
      uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround, uFogColor; uniform float uFogDensity;
      varying vec2 vUv; varying float vDist; varying float vSide; varying float vSeed; varying vec2 vXZ;
      ${FOG_GLSL}
      void main(){
        vec4 t = texture2D(uAtlas, vUv);                  // the canvas atlas is flipY (its top row = v 1): no second flip (the far trees stood on their tips, QA 23 Nov)
        // alpha sharpening: crisp silhouettes at every mip level (no fizzle, no thinning far away)
        float a = (t.a - 0.45) / max(fwidth(t.a), 1e-4) + 0.5;
        if (a < 0.03) discard;                            // round 5: the edge goes out as coverage (MSAA + alpha to coverage): smooth silhouettes
        float u = fract(vUv.x * 4.0) * 2.0 - 1.0;
        float snow = smoothstep(0.75, 0.9, max(t.r, max(t.g, t.b)));
        float vis = mix(1.0, texture2D(uShadow, (vXZ - uShadowRect.xy) / uShadowRect.zw).r, uShadowOn);
        float lit = clamp(0.45 + 0.55 * u * vSide, 0.0, 1.0) * vis;
        vec3 amb = mix(uAmbGround, uAmbSky, 0.6 + 0.4 * snow);
        vec3 col = t.rgb * (0.88 + 0.24 * vSeed) * (amb * 0.66 + uSunColor * lit * 0.62);
        gl_FragColor = vec4(applyFog(col, vDist, uFogColor, uFogDensity), clamp(a, 0.0, 1.0));
      }`,
  });
}

/** The far tree cards of one BLOCK (pure): Float32Array [x, y, z, scale, kind, seed] * n. guard(x, z, y) = true: no tree there (R8c: the
 *  lift aisles of lift-site.js; the cards stood in the Gornergrat Bahn's corridor and in every chair lift's aisle beyond the 3D trees). */
export function farTreesOfBlock(bx, bz, { classes, bits, field, guard = null }) {
  const out = [];
  const n = BLOCK / CELL, cnx = classes.nx, cnz = classes.nz;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const ci = bx * n + i, cj = bz * n + j;
      if (ci < 0 || cj < 0 || ci >= cnx || cj >= cnz) continue;
      const v = classes.data[cj * cnx + ci];
      if (v & (bits.piste | bits.built | bits.water | bits.rock)) continue;
      const forest = v & bits.forest, scrub = v & bits.scrub;
      if (!forest && !scrub) continue;
      for (let t = 0; t < 2; t++) {                      // up to two trees per 10 m cell in a full forest
        const r = hash2(ci, cj, 41 + t * 17);
        if (r > (forest ? KEEP_FOREST : KEEP_SCRUB) * (t ? 0.75 : 1)) continue;
        const x = (ci + 0.1 + 0.8 * hash2(ci, cj, 42 + t * 17)) * CELL, z = (cj + 0.1 + 0.8 * hash2(ci, cj, 43 + t * 17)) * CELL;
        const ground = field.baseHeight(x, z);
        if (guard && guard(x, z, ground)) continue;
        const y = ground - 2.2;
        const larch = scrub || (hash2(ci, cj, 44 + t * 17) < 0.3 && y < 2250);
        const k = larch ? 2 : y < 1850 && hash2(ci, cj, 45 + t * 17) < 0.3 ? 3 : hash2(ci, cj, 46 + t * 17) < 0.5 ? 1 : 0;
        const s = 0.9 + 0.5 * hash2(ci, cj, 47 + t * 17) + (y < 1900 ? 0.2 : 0);
        out.push(x, y, z, s, k, hash2(ci, cj, 48 + t * 17));
      }
    }
  }
  return new Float32Array(out);
}

export function createFarForest({ scene, env, classes, resort, field, quality }) {
  const bits = resort.classes.bits;
  const cnx = classes.nx, cnz = classes.nz;
  const blocks = new Map();
  const key = (bx, bz) => bx * 100003 + bz;
  const atlas = paintAtlas();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const inst = new Float32Array(CAP * 4), kind = new Float32Array(CAP * 2);
  geo.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 2).setUsage(THREE.DynamicDrawUsage));
  geo.instanceCount = 0;
  const mesh = new THREE.Mesh(geo, material(env, atlas));
  mesh.frustumCulled = false;
  mesh.name = 'ski-far-forest';
  scene.add(mesh);
  let q = quality, ring = FAR_FOREST[quality.cheapSnow ? 'low' : quality.treeRadius < 450 ? 'medium' : 'high'];
  env.u.uForestOuter.value = ring.outer;                  // the ground paints the forests beyond the cards (snow-shader.js)
  let last = { x: 1e9, z: 1e9 };
  const pending = [], pendingKeys = new Set(), stale = [];
  const stats = { cards: 0, blocks: 0 };

  const guard = liftTreeGuard(resort, createLiftPath, field.farHeight);       // R8c: the lift aisles (the same guard as scatter.js)
  function genBlock(bx, bz) {
    const arr = farTreesOfBlock(bx, bz, { classes, bits, field, guard });
    blocks.set(key(bx, bz), arr);
    if (blocks.size > 1500) blocks.delete(blocks.keys().next().value);
    return arr;
  }

  const keepAt = (d) => ring.keep * (d < ring.thin ? 1 : Math.max(0.3, ring.thin / d));   // the share of the trees kept at d m

  function rebuild(px, pz) {
    pending.length = 0; pendingKeys.clear();
    const R = ring.outer, R2 = R * R, inner = q.treeRadius * 0.9, inner2 = inner * inner;
    let n = 0, wanted = 0;
    const near = [];                                     // the blocks of this ring with trees ready
    const b0x = Math.floor((px - R) / BLOCK), b1x = Math.floor((px + R) / BLOCK), b0z = Math.floor((pz - R) / BLOCK), b1z = Math.floor((pz + R) / BLOCK);
    for (let bz = b0z; bz <= b1z; bz++) {
      for (let bx = b0x; bx <= b1x; bx++) {
        const cx = Math.max(bx * BLOCK, Math.min(px, (bx + 1) * BLOCK)) - px, cz = Math.max(bz * BLOCK, Math.min(pz, (bz + 1) * BLOCK)) - pz;
        if (cx * cx + cz * cz > R2) continue;
        const fx = Math.max(Math.abs(bx * BLOCK - px), Math.abs((bx + 1) * BLOCK - px)), fz = Math.max(Math.abs(bz * BLOCK - pz), Math.abs((bz + 1) * BLOCK - pz));
        if (fx * fx + fz * fz < inner2) continue;            // the whole block lies inside the 3D trees
        const arr = blocks.get(key(bx, bz));
        if (!arr) { const k = key(bx, bz); if (!pendingKeys.has(k)) { pendingKeys.add(k); pending.push([bx, bz]); } continue; }
        if (!arr.length) continue;
        near.push(arr);
        // how many cards this block asks for (its middle's distance is close enough for the sum)
        const mid = Math.hypot((bx + 0.5) * BLOCK - px, (bz + 0.5) * BLOCK - pz);
        wanted += (arr.length / 6) * keepAt(Math.min(R, Math.max(inner, mid)));
      }
    }
    // Laax (24 Nov): more trees in the ring than cards: the rows were filled from the north until CAP and every forest south of that stood
    // bare (grey snow). Now the whole ring thins evenly (each card a little bigger), no forest goes missing.
    const thin = Math.min(1, (CAP * 0.97) / Math.max(1, wanted));
    for (const arr of near) {
      for (let i = 0; i < arr.length && n < CAP; i += 6) {
        const dx = arr[i] - px, dz = arr[i + 2] - pz, d2 = dx * dx + dz * dz;
        if (d2 < inner2 || d2 > R2) continue;
        const keep = keepAt(Math.sqrt(d2)) * thin;
        if (arr[i + 5] > keep) continue;
        inst[n * 4] = arr[i]; inst[n * 4 + 1] = arr[i + 1]; inst[n * 4 + 2] = arr[i + 2]; inst[n * 4 + 3] = arr[i + 3] / Math.sqrt(Math.max(0.35, keep / ring.keep));
        kind[n * 2] = arr[i + 4]; kind[n * 2 + 1] = arr[i + 5];
        n++;
      }
    }
    geo.instanceCount = n;
    geo.getAttribute('aInst').needsUpdate = true; geo.getAttribute('aKind').needsUpdate = true;
    stats.cards = n; stats.wanted = Math.round(wanted); stats.thin = thin; stats.blocks = blocks.size;
    last = { x: px, z: pz };
  }

  return {
    mesh, stats,
    update(px, pz, budgetMs = 2) {
      if (Math.hypot(px - last.x, pz - last.z) > REBUILD) rebuild(px, pz);
      if (!pending.length) {
        if (!stale.length) return;
        const t0 = performance.now();
        while (stale.length && performance.now() - t0 < budgetMs) { const [bx, bz] = stale.shift(); genBlock(bx, bz); }
        if (!stale.length) rebuild(px, pz);
        return;
      }
      pending.sort((a, b) => Math.hypot(a[0] * BLOCK + 160 - px, a[1] * BLOCK + 160 - pz) - Math.hypot(b[0] * BLOCK + 160 - px, b[1] * BLOCK + 160 - pz));
      const t0 = performance.now();
      while (pending.length && performance.now() - t0 < budgetMs) { const [bx, bz] = pending.shift(); pendingKeys.delete(key(bx, bz)); genBlock(bx, bz); }
      if (!pending.length) rebuild(px, pz);
      else if (pending.length % 8 === 0) rebuild(px, pz);
    },
    setQuality(next) { q = next; ring = FAR_FOREST[next.cheapSnow ? 'low' : next.treeRadius < 450 ? 'medium' : 'high']; env.u.uForestOuter.value = ring.outer; last = { x: 1e9, z: 1e9 }; },
    /** A height tile arrived: the blocks under it get their trees again (new ground heights). */
    invalidate(x0, z0, x1, z1) {
      for (let bz = Math.floor(z0 / BLOCK); bz <= Math.floor(z1 / BLOCK); bz++) {
        for (let bx = Math.floor(x0 / BLOCK); bx <= Math.floor(x1 / BLOCK); bx++) if (blocks.has(key(bx, bz))) stale.push([bx, bz]);    // redone in update(), drawn meanwhile
      }
    },
  };
}
