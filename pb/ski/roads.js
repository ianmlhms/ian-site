/* Village streets (roads.json from scripts/ski/bake.py: the OSM roads inside the villages and next to their houses, never on a piste),
 * drawn as ploughed winter roads: packed, slightly dirty snow with a subtle crown, soft worn tyre ruts that wander with the bends, low
 * lumpy ploughed banks that run out into the field, fillets at the junctions, dead ends that melt into the snow, trodden paths to the
 * houses. The network itself (joined ways, ends, paths) is street-net.js; here it is put on the ground and painted.
 *
 * Streets round (Ian: "bobsled channels"): the street used to be lit by its own little light, brighter and bluer than the field, with a
 * white glowing rim and a ring of tyre marks round every dead end. Now
 *   - the light is the ground's own (snow-shader.js SNOW_LIGHT_GLSL + the mountain shadows + the sun's shadow map), so a street lies in
 *     the shade of a house like the snow beside it; only the dirt and the relief (banks, ruts: bent normals) are the street's
 *   - every pixel knows up to SEGS segments of the net (a float texture, read with the cell's four segment numbers), so bends, ends and
 *     junctions come out of ONE signed distance to the street's edge: no shards where streets meet, no rings
 *   - a vertex carries 24 bytes (was 76).
 * Round 7 (A): drawn ON THE PHYSICS LATTICE: every 2.5 m cell a street touches is emitted with the ground's own two triangles
 * (surface.js diagonalIsMain, the same node heights) a hair above it: the banks are painted relief, never geometry, so the skis stand on
 * exactly what is drawn. */
import { FOG_GLSL, SNOW_LIGHT_GLSL } from './snow-shader.js';
import { SHADOW_GLSL } from './shadows.js';
import { diagonalIsMain } from './surface.js';
import { gpuOnly } from './gpu-mem.js';
import { BANK, PATH_MAX, SEGS, STRIDE, buildStreets, packSegments, pickSegments } from './street-net.js';

export { MAX_GRADE, decodeRoads, gentleRoads, housesOnStreets, roundRoads } from './street-net.js';

const THREE = window.THREE;
const CELL = 640;                      // round 7 (A): smaller merge cells: the far streets drop out (triangles)
const LIFT = 0.006;                    // R8 (QA: the skis sank into the street): a hair over the ground, the polygon offset does the rest; m above the ground; far away the vertex shader pulls the street towards the camera instead
const TEX_W = 2048;                    // texels per row of the segment texture (two texels a segment)

/** The segments as a float texture: texel 2 n = (ax, az, bx, bz), texel 2 n + 1 = (strength + ruts at a, at b, half width, street). */
function segTexture(net) {
  const texels = Math.max(1, net.count * 2), h = Math.ceil(texels / TEX_W);
  const px = new Float32Array(TEX_W * h * 4);
  px.set(net.data.subarray(0, net.count * STRIDE));
  const tex = new THREE.DataTexture(px, TEX_W, h, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function material(env, segs) {
  return new THREE.ShaderMaterial({
    uniforms: { ...env.u, uSegs: { value: segs } },
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide,
    transparent: true, depthWrite: false,          // R8c (3V QA: sawtooth street edges, faceted banks): the bank fades into the snow
    vertexShader: `
      attribute vec4 aSeg;
      flat varying vec4 vSeg; varying vec3 vW; varying vec3 vN; varying float vDist;
      void main(){ vSeg = aSeg; vW = position; vN = normal; vec4 mv = viewMatrix * vec4(position, 1.0); vDist = -mv.z;
        // round 7: exact close by; farther away (coarser terrain tiles) pulled along the view ray towards the camera so it stays on top
        mv.xyz *= 1.0 - clamp((vDist - 40.0) * 0.00004, 0.0, 0.05);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      #include <packing>
      uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround, uFogColor; uniform float uFogDensity, uOvercast, uShadowOn, uMilk, uSnowfall;
      uniform sampler2D uNoise, uDetail, uShadow; uniform vec4 uShadowRect; uniform highp sampler2D uSegs;
      flat varying vec4 vSeg; varying vec3 vW; varying vec3 vN; varying float vDist;
      ${SHADOW_GLSL}
      ${FOG_GLSL}
      ${SNOW_LIGHT_GLSL}
      vec4 segTexel(int n){ return texelFetch(uSegs, ivec2(n % ${TEX_W}, n / ${TEX_W}), 0); }
      // the ploughed bank's cross section over the distance to the street's edge: a steep inner side, a long outer one
      float bankAt(float e){ return smoothstep(-0.3, 0.42, e) * (1.0 - smoothstep(0.45, ${BANK.toFixed(2)}, e)); }
      float wheel(float x){ return exp(-x * x * 9.0); }
      // the worn wheel tracks over the distance to the centre line: one lane on narrow streets, two on the others (metres, not shares)
      float wheels(float c, float hw){ c = abs(c); return hw > 2.75 ? max(wheel(c - hw * 0.5 + 0.74), wheel(c - hw * 0.5 - 0.74)) : wheel(c - 0.76); }

      float accE = 1e3, accF = 0.0, accPath = 0.0, accHw = 3.0, rut = 0.0; vec2 accG = vec2(1.0, 0.0), accDir = vec2(0.0), rutN = vec2(0.0);
      vec2 wander;                                              // m: how far the wheel tracks wander here (two sets of tracks)
      float curD = 1e3, curT = 0.0, curOver = 0.0; vec2 curV = vec2(1.0, 0.0), curDir = vec2(1.0, 0.0); vec4 curQ = vec4(0.0);
      // One street done: into the union (rounded corners where streets cross, a plain minimum where they run on), its ruts on top.
      void fold(){
        float hw = curQ.z;
        vec2 fa = floor(curQ.xy + 0.001), ra = (curQ.xy - fa) / 0.9;
        float f = mix(fa.x, fa.y, curT) * 0.01, r = mix(ra.x, ra.y, curT);
        float path = step(hw, ${PATH_MAX.toFixed(2)});
        float e = curD - hw + (1.0 - f) * (1.0 - f) * (hw + ${(BANK + 0.7).toFixed(2)});
        vec2 g = curV / max(curD, 1e-3);
        float k = max(0.01, (path > 0.5 ? 0.9 : 2.6) * (1.0 - abs(dot(curDir, accDir))));
        float h = clamp(0.5 + 0.5 * (accE - e) / k, 0.0, 1.0);
        accE = mix(accE, e, h) - k * h * (1.0 - h);
        accG = mix(accG, g, h); accF = mix(accF, f, h); accPath = mix(accPath, path, h); accHw = mix(accHw, hw, h);
        if (h > 0.5) accDir = curDir;
        float w = (1.0 - path) * r * f * (1.0 - smoothstep(0.15, 1.2, curOver)) * step(e, 0.0);
        if (w > 0.01) {
          float side = curDir.x * curV.y - curDir.y * curV.x < 0.0 ? -1.0 : 1.0, c = curD * side;
          float a = wheels(c + wander.x, hw), b = 0.6 * wheels(c + wander.y, hw);
          rut = max(rut, w * max(a, b));
          vec2 across = vec2(-curDir.y, curDir.x);
          rutN += across * w * (wheels(c + wander.x + 0.08, hw) - wheels(c + wander.x - 0.08, hw));
        }
      }
      void main(){
        vec2 p = vW.xz;
        vec4 nA = texture2D(uNoise, p * 0.013), nB = texture2D(uNoise, p * 0.071 + 0.3), nL = texture2D(uNoise, p * 0.0021 + 0.7);
        vec4 d1 = texture2D(uDetail, p * 0.43), d2 = texture2D(uDetail, p * 0.115 + 0.37);
        wander = (vec2(nA.r, nA.b) - 0.5) * vec2(1.3, 2.2) + (nB.g - 0.5) * 0.35;
        float road = -1.0;
        for (int i = 0; i < ${SEGS}; i++) {
          int n = int(vSeg[i] + 0.5) * 2;
          vec4 s = segTexel(n), q = segTexel(n + 1);
          vec2 ab = s.zw - s.xy, ap = p - s.xy;
          float L = max(length(ab), 1e-3), tt = dot(ap, ab) / (L * L), t = clamp(tt, 0.0, 1.0);
          vec2 v = ap - ab * t;
          float d = length(v);
          if (q.w != road) { if (road >= 0.0) fold(); road = q.w; curD = 1e3; }
          if (d < curD) { curD = d; curV = v; curT = t; curOver = max(-tt, tt - 1.0) * L; curDir = ab / L; curQ = q; }
        }
        fold();
        float nearK = 1.0 - smoothstep(14.0, 70.0, vDist), midK = 1.0 - smoothstep(90.0, 320.0, vDist);
        // ---- the signed distance to the street's edge, ragged like a plough leaves it
        float ragged = (nB.r - 0.5) * 0.75 + (d2.a - 0.5) * 0.35;
        float e = accE + ragged * (1.0 - 0.55 * accPath) - 0.12 * accPath;
        vec3 V = normalize(cameraPosition - vW);
        float fresh = clamp(uSnowfall, 0.0, 1.0);               // it snows: a thin new layer over the dirt
        // ---- relief: the bank (its height changes along the street, lumps), the ruts, the crown
        float lump = smoothstep(0.2, 0.8, nB.b * 0.55 + d2.b * 0.45);
        float ploughed = smoothstep(0.35, 0.95, accF);          // no bank any more where a dead end runs out
        float bankH = mix(0.4, 0.2, accPath) * (0.35 + 0.95 * lump) * ploughed;
        // the bank stands up: what the eye sees here is the point where its ray meets the bank (offset along the distance to the edge)
        float lean = dot(accG, V.xz) / max(V.y, 0.22) * nearK;
        float e0 = e;
        for (int i = 0; i < 2; i++) e = e0 + clamp(lean * bankAt(e) * bankH, -0.8, 0.8);
        float street = 1.0 - smoothstep(-0.4, 0.2, e);
        float bank = bankAt(e) * ploughed * (1.0 - 0.5 * accPath);
        vec3 N0 = normalize(vN); N0 *= sign(N0.y + 1e-4);
        vec3 N = N0;
        N.xz -= accG * ((bankAt(e + 0.07) - bankAt(e - 0.07)) / 0.14) * bankH * 1.15 * midK;
        N.xz += accG * 0.07 * clamp(1.0 + accE / accHw, 0.0, 1.0) * street * (1.0 - accPath);
        N.xz -= rutN * 0.3 * nearK * (1.0 - 0.6 * fresh);
        N.xz += (d2.rg - 0.5) * (0.95 * bank + 0.16 * street) * midK + (d1.rg - 0.5) * (0.3 * bank + 0.05 + 0.3 * accPath) * nearK;
        N = normalize(N);
        // ---- light: the ground's own
        vec2 fuv = (p - uShadowRect.xy) / uShadowRect.zw;
        float sunVis = mix(1.0, texture2D(uShadow, fuv).r, uShadowOn);
        sunVis = min(sunVis, sunMapShadow(vW + vec3(d2.r - 0.5, 0.0, d1.g - 0.5) * 0.5, N0));       // a little ragged: no texel steps along a street
        // the bank on the sun's side throws a short shadow on the street (and the far one on the field)
        float flat2 = max(length(uSunDir.xz), 1e-3), reach = clamp(bankH * flat2 / max(uSunDir.y, 0.08), 0.0, 1.3);
        float away = dot(accG, uSunDir.xz) / flat2;
        float thrown = smoothstep(0.1, 0.7, away) * smoothstep(-reach - 0.25, -reach * 0.35, e) * (1.0 - smoothstep(0.0, 0.3, e))
          + smoothstep(0.1, 0.7, -away) * smoothstep(0.45, 0.8, e) * (1.0 - smoothstep(0.6 + reach * 0.5, 0.95 + reach, e));
        sunVis *= 1.0 - 0.75 * thrown * ploughed * (1.0 - accPath) * midK;
        float lit = snowBand(smoothstep(-0.06 + (nA.a - 0.5) * 0.12, 0.6, dot(N, uSunDir)) * sunVis);
        float foot = smoothstep(-0.75, -0.05, e) * (1.0 - smoothstep(0.0, 0.45, e)) * ploughed * (1.0 - accPath);      // where the bank meets the street
        vec3 shade, shadeC, litC;
        snowLight(N.y, 0.35 * foot, shade, shadeC, litC);
        vec3 snow = mix(shadeC, litC, lit) * (0.955 + 0.05 * nA.b + 0.035 * (nL.r - 0.5));
        // ---- the surface: packed snow, greyer and warmer where more cars drive, cleaner patches, sand and grit close by
        float busy = smoothstep(2.0, 4.2, accHw);
        float dirt = clamp(0.3 + 0.25 * busy + 0.9 * (nA.g - 0.5) + 0.5 * (nB.a - 0.5), 0.0, 1.0) * (1.0 - 0.6 * fresh);
        vec3 packed = snow * mix(vec3(0.95, 0.948, 0.945), vec3(0.835, 0.825, 0.805), dirt);
        float worn = rut * (0.55 + 0.45 * smoothstep(0.3, 0.65, nA.g * 0.75 + nB.g * 0.25)) * (1.0 - 0.55 * fresh);
        packed *= mix(vec3(1.0), vec3(0.79, 0.785, 0.775), worn * mix(0.8, 1.0, busy) * mix(0.6, 1.0, midK));
        // on the through roads the tracks are worn down to wet asphalt here and there
        float bare = smoothstep(0.4, 1.1, worn + 0.4 * (nB.a - 0.5)) * smoothstep(3.2, 4.0, accHw) * smoothstep(0.45, 0.6, nL.g * 0.4 + nA.g * 0.6);
        packed = mix(packed, snow * vec3(0.5, 0.485, 0.47), bare * 0.5);
        packed *= 1.0 + (d1.b - 0.5) * 0.1 * nearK * (1.0 - 0.5 * fresh) + (d2.b - 0.5) * 0.07 * midK;
        packed = mix(packed, snow * vec3(0.875, 0.872, 0.868) * (1.0 + ((d1.a - 0.5) * 0.3 + (d1.b - 0.5) * 0.25) * nearK), accPath);      // a trodden path: footprints
        // the bank: white snow, a little of the street's dirt thrown up its inner side
        float splash = (1.0 - smoothstep(0.0, 0.8, e)) * (0.35 + 0.65 * d2.b) * (1.0 - accPath);
        vec3 bankC = snow * mix(vec3(1.0), vec3(0.84, 0.82, 0.79), splash * 0.75 * (1.0 - 0.6 * fresh));
        vec3 col = mix(bankC, packed, street);
        // relief reads in the shade and under clouds too: the sky is brighter on the sun's side; the crest catches light, the foot none
        col *= 1.0 + clamp(dot(N.xz - N0.xz, uSunDir.xz / flat2), -0.6, 0.6) * mix(0.3, 0.12, lit) + 0.035 * bank * (1.0 - lit) - 0.1 * foot * midK;
        // ---- how much of it lies over the field: all of the street, the bank fading out, nothing at a dead end
        float cover = max(street, (1.0 - smoothstep(0.4, ${BANK.toFixed(2)}, e + (nB.a - 0.5) * 0.3)) * (1.0 - accPath) * (0.35 + 0.65 * midK));
        cover *= smoothstep(0.0, 0.75, accF + (nB.r + d2.a - 1.0) * 0.5 * (1.0 - accF));
        if (cover < 0.004) discard;
        gl_FragColor = vec4(applyFog(col, vDist, snowFogColor(V), uFogDensity), cover);
      }`,
  });
}

const LAT = 2.5;
/* R8c (QA: 494-645k triangles in the villages; the streets were 40-90k of them): two levels per render cell. Near (FINE_RADIUS m from
 * the camera to the cell) the street on the 2.5 m physics lattice as before (skis on it); farther a COARSE copy on a 10 m lattice (1/16 of
 * the triangles; the vertex shader's pull towards the camera keeps it on top of the far, coarser terrain tiles). */
const LAT_FAR = 10;
const FINE_KEEP = 300;                 // R8d: m beyond the fine radius before a cell's fine lattice is dropped (no rebuild back and forth)
const FINE_BUILDS = 1;                 // fine cells built per update at most
export const FINE_RADIUS = Object.freeze({ low: 90, medium: 200, high: 480 });          // R8d: main.js passes the level; streets round: 150 / 360 / 650 -> 90 / 200 / 480 (the wider banks' triangles)

/** One render cell's lattice (lat m): { pos, nrm, seg } of the lattice cells its streets touch. segs = the segment numbers near it;
 *  ground = true: the ground's own triangle split. */
function buildLattice(net, segs, x0, z0, lat, height, ground) {
  const cands = new Map();                    // lattice cell key -> segment numbers
  const n = Math.round(CELL / lat), I0 = Math.round(x0 / lat), J0 = Math.round(z0 / lat), D = net.data;
  for (const s of segs) {
    const o = s * STRIDE, ax = D[o], az = D[o + 1], bx = D[o + 2], bz = D[o + 3], hw = D[o + 6];
    if (ground !== s < net.far) continue;                                      // the fine net near, its coarse copy (no paths) far
    const reach = hw + BANK + lat * 0.71, L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1e-9;
    const i0 = Math.max(I0, Math.floor((Math.min(ax, bx) - reach) / lat)), i1 = Math.min(I0 + n - 1, Math.floor((Math.max(ax, bx) + reach) / lat));
    const j0 = Math.max(J0, Math.floor((Math.min(az, bz) - reach) / lat)), j1 = Math.min(J0 + n - 1, Math.floor((Math.max(az, bz) + reach) / lat));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * lat, cz = (j + 0.5) * lat;
      const t = Math.max(0, Math.min(1, ((cx - ax) * (bx - ax) + (cz - az) * (bz - az)) / L2));
      if (Math.hypot(cx - ax - (bx - ax) * t, cz - az - (bz - az) * t) > reach) continue;
      const key = (i - I0) * n + (j - J0); let a = cands.get(key); if (!a) cands.set(key, (a = [])); a.push(s);
    }
  }
  const hCache = new Map();
  const hAt = (i, j) => { const key = (i - I0 + 4) * 8192 + (j - J0 + 4); let h = hCache.get(key); if (h === undefined) { h = height(i * lat, j * lat) + LIFT; hCache.set(key, h); } return h; };
  const pos = [], nrm = [], seg = [];
  for (const [key, list] of cands) {
    const i = I0 + Math.floor(key / n), j = J0 + (key % n);
    const four = pickSegments(net, list, i * lat, j * lat, lat);
    if (!four) continue;
    const corner = { a: [i, j], b: [i + 1, j], c: [i, j + 1], d: [i + 1, j + 1] };
    const tri = !ground || diagonalIsMain(i, j) ? ['a', 'd', 'b', 'a', 'c', 'd'] : ['a', 'c', 'b', 'b', 'c', 'd'];      // the ground's own split (surface.js)
    for (const q of tri) {
      const [ii, jj] = corner[q];
      pos.push(ii * lat, hAt(ii, jj), jj * lat);
      const nx = hAt(ii - 1, jj) - hAt(ii + 1, jj), nz = hAt(ii, jj - 1) - hAt(ii, jj + 1), nl = Math.hypot(nx, 2 * lat, nz);
      nrm.push((nx / nl) * 127, ((2 * lat) / nl) * 127, (nz / nl) * 127, 0);                       // smooth: the ground's slope at the node
      seg.push(...four);
    }
  }
  return { pos, nrm, seg };
}

/** roads = decodeRoads(roads.json); height(x, z) = the PHYSICS ground (surface.height: exact at the lattice nodes); level = quality;
 *  ground(x, z) = the same ground without the small drifts, cheap anywhere (the net asks for it all over the resort: through `height` that
 *  would build a physics block per house: 2.6 s in Kronplatz); boxes / boxIndex = the drawn houses (look.js): the trodden paths to their doors. */
/** R8f (memory: Zermatt's streets cost ~75 MB of the page and ~55 MB of GPU when the whole resort's coarse lattice was built at the
 *  start): the coarse 10 m lattice is built per render cell too, when the camera comes within the street radius (COARSE_BUILDS a frame,
 *  nearest first), and dropped beyond the radius + COARSE_KEEP m. upload(object) puts a new mesh on the GPU at once (gpu-mem.js). */
const COARSE_KEEP = 800;
const COARSE_BUILDS = 2;
export function createRoads({ scene, roads, env, height, ground = height, level = 'medium', upload = null, boxes = null, boxIndex = null }) {
  const t0 = performance.now();
  const streets = buildStreets(roads, ground, { boxes, boxIndex });
  const net = packSegments(streets);
  // the render cells a street passes (bounding boxes of its segments + its reach) and the segments of each
  const keys = new Map();
  for (let s = 0; s < net.count; s++) {
    const o = s * STRIDE, ax = net.data[o], az = net.data[o + 1], bx = net.data[o + 2], bz = net.data[o + 3], reach = net.data[o + 6] + BANK + LAT_FAR;
    for (let ci = Math.floor((Math.min(ax, bx) - reach) / CELL); ci <= Math.floor((Math.max(ax, bx) + reach) / CELL); ci++) {
      for (let cj = Math.floor((Math.min(az, bz) - reach) / CELL); cj <= Math.floor((Math.max(az, bz) + reach) / CELL); cj++) {
        const key = ci + ',' + cj;
        let c = keys.get(key);
        if (!c) keys.set(key, (c = { x0: ci * CELL, z0: cj * CELL, segs: [] }));
        c.segs.push(s);
      }
    }
  }
  const mat = material(env, segTexture(net));
  const group = new THREE.Group();
  group.name = 'ski-roads';
  const SegArray = net.count < 65536 ? Uint16Array : Float32Array;
  const mesh = (c) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(Int8Array.from(c.nrm), 4, true));
    g.setAttribute('aSeg', new THREE.BufferAttribute(SegArray.from(c.seg), 4));
    g.computeBoundingSphere();
    gpuOnly(g);                                                          // R8f: drawn only (ground-check opens the page with keep=1)
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = false;
    if (upload) upload(m);
    group.add(m);
    return m;
  };
  // coarse / fine: null = not built, false = no street cell there, else the mesh
  const list = [...keys.values()].map((c) => ({ ...c, fine: null, coarse: null }));
  scene.add(group);
  let fineR = FINE_RADIUS[level] || FINE_RADIUS.medium;
  const tris = (m) => (m ? m.geometry.attributes.position.count / 3 : 0);
  const stats = { cells: list.length, fineBuilt: 0, coarseBuilt: 0, triangles: 0, netMs: Math.round(performance.now() - t0) };
  /** One render cell's lattice (lat m): its mesh, or false when no street cell of it is drawn. */
  function buildCell(c, lat, ground) {
    const f = buildLattice(net, c.segs, c.x0, c.z0, lat, height, ground);
    return f.pos.length ? mesh(f) : false;
  }
  function dropMesh(m) { group.remove(m); m.geometry.dispose(); }
  function dropFine(c) { if (c.fine) { dropMesh(c.fine); stats.fineBuilt--; } c.fine = null; }
  function dropCoarse(c) { if (c.coarse) { dropMesh(c.coarse); stats.coarseBuilt--; } c.coarse = null; }
  const dist = (c, px, pz) => { const dx = Math.max(c.x0 - px, 0, px - c.x0 - CELL), dz = Math.max(c.z0 - pz, 0, pz - c.z0 - CELL); return Math.hypot(dx, dz); };
  return {
    group, count: roads.length, cells: list.length, stats, paths: streets.filter((s) => s.hw < PATH_MAX).map((s) => s.pts),
    update(px, pz, radius) {
      let t = 0, built = 0, coarseBuilt = 0;
      // the nearest cells first (a jump: the street under the skier before the far ones)
      const order = list.map((c) => [dist(c, px, pz), c]).sort((a, b) => a[0] - b[0]);
      for (const [d, c] of order) {
        if (d < fineR && c.fine === null && built < FINE_BUILDS) { c.fine = buildCell(c, LAT, true); built++; if (c.fine) stats.fineBuilt++; }
        else if (d > fineR + FINE_KEEP && c.fine !== null) dropFine(c);
        if (d < radius && c.coarse === null && coarseBuilt < COARSE_BUILDS) { c.coarse = buildCell(c, LAT_FAR, false); coarseBuilt++; if (c.coarse) stats.coarseBuilt++; }
        else if (d > radius + COARSE_KEEP && c.coarse !== null) dropCoarse(c);
        const nearCell = d < fineR && !!c.fine;
        if (c.fine) c.fine.visible = nearCell;
        if (c.coarse) c.coarse.visible = !nearCell && d < radius;
        t += (nearCell ? tris(c.fine) : 0) + (!nearCell && d < radius ? tris(c.coarse) : 0);
      }
      stats.triangles = t;
    },
    setLevel(next) { fineR = FINE_RADIUS[next] || FINE_RADIUS.medium; },
  };
}
