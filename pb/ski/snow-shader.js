/* The painted ground: snow in gouache light (warm lit side, blue shade, a few soft bands), groomed corduroy along the piste, wind-blown
 * powder off it, grey-brown rock with strata where the mountain is too steep to hold snow, darker snow under the trees, trodden snow in the
 * villages, frozen snow-covered lakes. All colours are ours: no photo or satellite texture anywhere.
 *   aInfo  = (piste, forest, rock, water - built) from the tile builder
 *   aExtra = (groom direction x, z: the nearest piste line; terrain occlusion -1 ridge .. 1 hollow; 0)
 * Light: sun (N.L, the baked mountain shadows, the near shadow map on Mëttel / Héich) + sky ambient darkened in hollows (the occlusion).
 * Round 5: a fine detail texture bends the light close by (grain, wind crust; env.js createDetailTexture, mipmapped + anisotropic, so it
 * neither shimmers nor blurs), the far grid's normal map lights the distant mountains per pixel (ridges, gullies and faces stay crisp on
 * coarse far tiles), corduroy is faded by its own pixel footprint (no moire), a low-sun sheen and sparkling grains on Mëttel / Héich,
 * craggy rock, a light-blue aerial haze that grows with distance.
 * `cheap` = the Niddreg variant (no sparkle, no sheen, no shadow map, fewer noise reads). */
import { SHADOW_GLSL } from './shadows.js';

const THREE = window.THREE;

/** Shared GLSL: the fog of every painted material (weather fog + a blue aerial perspective that grows with distance, so depth reads). */
export const FOG_GLSL = `
  uniform float uFarEnd;
  vec3 applyFog(vec3 col, float dist, vec3 fogCol, float density){
    float f = 1.0 - exp(-pow(density * dist, 2.0));
    float aerial = (1.0 - exp(-dist * 0.000062)) * 0.6;
    // round 7 (A): the last stretch before the end of the drawn terrain melts into the horizon haze (the sky's colour there): no hard
    // edge of the world against the sky
    float farEnd = uFarEnd > 0.0 ? smoothstep(uFarEnd * 0.62, uFarEnd * 0.97, dist) : 0.0;
    return mix(col, fogCol, clamp(max(max(f, aerial), farEnd), 0.0, 1.0));
  }`;

/** Round 7: the park cut-outs (modes/views.js createParkBodies): oriented rects where the terrain is not drawn (the bodies are). */
export function parkUniforms() {
  const T = window.THREE;
  return { uParkO: { value: new T.Vector4(0, 0, 1, 0) }, uParkRect: { value: Array.from({ length: 8 }, () => new T.Vector4()) }, uParkN: { value: 0 } };
}
export function createSnowMaterial(env, { cheap = false, treeRadius = 400, forest = null, lodScale = 1, body = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...env.u, uTreeRadius: { value: treeRadius }, uForestTex: { value: forest ? forest.texture : env.u.uNoise.value },
      uForestSize: { value: new THREE.Vector2(forest ? forest.width : 1, forest ? forest.depth : 1) }, uForestOn: { value: forest ? 1 : 0 },
      uFarFrom: { value: 1200 * lodScale },          // from here the far grid's normal map takes over from the (coarser and coarser) mesh normals
    },
    defines: { ...(cheap ? { CHEAP: 1 } : {}), ...(body ? { PARK_BODY: 1 } : {}) },
    extensions: { derivatives: true },
    vertexShader: `
      attribute vec4 aInfo; attribute vec4 aExtra;
      varying vec3 vWorld; varying vec3 vNormal; varying vec4 vInfo; varying vec4 vExtra; varying float vDist;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vNormal = normal; vInfo = aInfo; vExtra = aExtra;
        vec4 mv = viewMatrix * w;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      #include <packing>
      uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround, uFogColor; uniform float uFogDensity, uTime, uOvercast, uSnowfall, uTreeRadius, uShadowOn, uFarNOn, uFarFrom, uMilk;
      uniform sampler2D uNoise, uShadow, uForestTex, uDetail, uFarN; uniform vec4 uShadowRect; uniform vec2 uForestSize; uniform float uForestOn;
      varying vec3 vWorld; varying vec3 vNormal; varying vec4 vInfo; varying vec4 vExtra; varying float vDist;
      ${cheap ? '' : SHADOW_GLSL}
      ${FOG_GLSL}
      float band(float x){ return mix(x, floor(x * 4.0 + 0.5) / 4.0, 0.22); }
      uniform vec4 uParkO; uniform vec4 uParkRect[8]; uniform float uParkN;
      void main(){
        vec2 wp = vWorld.xz;
        #ifndef PARK_BODY
        if (uParkN > 0.5) {                       // round 7: the park's real kicker / pipe bodies are drawn here instead of the terrain
          vec2 pr = wp - uParkO.xy;
          float ps = dot(pr, uParkO.zw), pv = dot(pr, vec2(-uParkO.w, uParkO.z));
          for (int i = 0; i < 8; i++) { if (float(i) >= uParkN) break; vec4 q = uParkRect[i]; if (ps > q.x && ps < q.y && pv > q.z && pv < q.w) discard; }
        }
        #endif
        vec3 V = normalize(cameraPosition - vWorld);
        // ---- the ground normal: the mesh close by, the far grid's normal map (40 m, per pixel) where the tiles get coarse
        vec2 fuv = (wp - uShadowRect.xy) / uShadowRect.zw;
        vec4 fn = texture2D(uFarN, fuv);
        vec3 Nf = vec3(fn.r * 2.0 - 1.0, 0.0, fn.g * 2.0 - 1.0);
        Nf.y = sqrt(max(1.0 - dot(Nf.xz, Nf.xz), 0.03));
        float farMix = uFarNOn * smoothstep(uFarFrom, uFarFrom * 2.0, vDist);
        vec3 N = normalize(mix(normalize(vNormal), Nf, farMix));
        float relief = clamp((fn.b - 0.5) * 2.0, -1.0, 1.0) * farMix;        // > 0 on ridges and edges, < 0 in gullies
        float piste = clamp(vInfo.x, 0.0, 1.0), forest = clamp(vInfo.y, 0.0, 1.0), rockCls = clamp(vInfo.z, 0.0, 1.0);
        float built = clamp(-vInfo.w, 0.0, 1.0), waterSoft = clamp(vInfo.w, 0.0, 1.0), water = smoothstep(0.4, 0.9, waterSoft);
        float occ = vExtra.z;
        float near = 1.0 - smoothstep(25.0, 140.0, vDist);
        vec4 nA = texture2D(uNoise, wp * 0.013);
        vec4 nB = texture2D(uNoise, wp * 0.071 + 0.3);
        vec4 nL = texture2D(uNoise, wp * 0.0021 + 0.7);                  // big soft patches: the snow is never one flat white
        vec4 d1 = texture2D(uDetail, wp * 0.43);                         // grain: 2.3 m repeat
        vec4 d2 = texture2D(uDetail, wp * 0.057 + 0.21);                 // lumps, wind crust, crags: 17.5 m
        vec4 d3 = texture2D(uDetail, wp * 0.0093 + 0.6);                 // big crags and drifts: 107 m (reads from across the valley)
        vec2 fall = N.xz / max(length(N.xz), 1e-3);
        // ---- corduroy: grooves along the nearest piste line (the way the groomer drove), in lanes of one groomer width (~5 m) whose
        //      phase and depth differ a little. Faded by the groove's own footprint on the screen (fwidth of its phase): crisp close by,
        //      a clean even tone where a pixel spans a groove; no moire, no shimmer.
        vec2 g = vExtra.xy; g /= max(length(g), 1e-3);
        vec2 acr = vec2(-g.y, g.x);
        float across = dot(wp, acr);
        float lane = floor(across / 5.2);
        float laneR = fract(sin(lane * 12.9898) * 43758.5453);
        float gp = across * 34.0 + laneR * 3.0 + nA.r * 0.6;
        float gw = fwidth(across) * 34.0;
        float aa = clamp(1.0 - gw * 0.4, 0.0, 1.0); aa *= aa * (1.0 - smoothstep(70.0, 160.0, vDist));
        float onPiste = smoothstep(0.25, 0.7, piste);
        float cordS = sin(gp), cordC = cos(gp);
        float cord = cordS * aa * (0.5 + 0.35 * laneR) * onPiste;
        float laneEdge = (1.0 - smoothstep(0.0, 0.35, abs(fract(across / 5.2) - 0.5) * 2.0 - 0.65)) * aa;  // a faint ridge between groomer passes
        // ---- normal detail: corduroy ridges on the piste; grain, lumps and wind ripples (sastrugi: long, along the wind) off it
        vec2 wind = vec2(0.8, 0.6);
        #ifdef CHEAP
        vec4 nW = d2.abgr;                                                   // Niddreg: one noise read less
        #else
        vec4 nW = texture2D(uNoise, vec2(dot(wp, wind) * 0.09, dot(wp, vec2(-wind.y, wind.x)) * 0.022) + 0.1);
        #endif
        float drift = (nB.g - 0.5) * 0.6 + (nW.r - 0.5) * 0.8;
        float nearK = 1.0 - smoothstep(12.0, 80.0, vDist), midK = 1.0 - smoothstep(150.0, 700.0, vDist);
        vec2 grain = (d1.rg - 0.5) * nearK * 0.9 + (d2.rg - 0.5) * midK * 1.1;
        float soft = (1.0 - water) * (1.0 - 0.72 * piste);                    // the groomer irons the piste flat: little grain there
        vec3 Nb = N;
        Nb.xz += acr * cordC * aa * (0.5 + 0.35 * laneR) * onPiste * 0.085
          + fall * drift * 0.2 * (1.0 - piste) * (1.0 - water) * (0.35 + 0.65 * near)
          + grain * soft * 0.3;
        Nb = normalize(Nb);
        // ---- light
        float nl = dot(Nb, uSunDir);
        float sunVis = mix(1.0, texture2D(uShadow, fuv).r, uShadowOn);                                         // in a ridge's shadow?
        #ifndef CHEAP
        sunVis = min(sunVis, sunMapShadow(vWorld, N));                                                         // trees, houses, the skier, small ridges
        #endif
        float lit = band(smoothstep(-0.06 + (nA.a - 0.5) * 0.12, 0.6, nl) * sunVis);
        float sky = 0.5 + 0.5 * Nb.y;
        float ao = clamp(occ - relief * 0.9, -0.7, 1.0);
        vec3 shade = mix(uAmbGround, uAmbSky, sky) * (1.0 - 0.32 * max(ao, 0.0) + 0.09 * max(-ao, 0.0));
        // snow: clear blue in the shade (the sky's light), warm white in the sun; never brighter than paper white
        float blue = (0.72 + 0.25 * max(ao, 0.0)) * (1.0 - 0.6 * uOvercast);
        vec3 shadeC = mix(vec3(0.8), vec3(0.79, 0.895, 1.04), blue) * (shade * 0.95 + 0.12);   // overcast light is whiter
        float top = max(shadeC.r, max(shadeC.g, shadeC.b));
        shadeC *= mix(1.0, 0.97 / top, smoothstep(0.9, 1.15, top));              // bright overcast light: a soft shoulder, hue kept, no cyan clip
        vec3 litC = max(shadeC * 1.02, shadeC * vec3(0.3, 0.28, 0.24) + uSunColor * vec3(0.775, 0.79, 0.815));   // a weak sun (fog, cloud) never makes the lit side darker than the shade
        vec3 snow = mix(shadeC, litC, lit);
        snow *= 0.955 + 0.05 * nA.b + 0.035 * (nL.r - 0.5);
        // ---- groomed: smooth, compact, a touch greyer-blue than powder, corduroy shading (lit ridges, shaded grooves), lane ridges,
        //      a soft packed edge line
        float edgeLine = smoothstep(0.25, 0.5, piste) * (1.0 - smoothstep(0.5, 0.8, piste));
        vec3 packed = snow * vec3(0.97, 0.982, 1.0) * (1.0 + 0.03 * cord + 0.014 * laneEdge) * (0.99 + 0.02 * (nL.g - 0.5));
        snow = mix(snow, packed, piste);
        snow *= 1.0 - 0.05 * edgeLine;
        // ---- off-piste: wind-scoured crusts (a little greyer) and fresh powder pillows (brighter), small lumps close by
        float crust = smoothstep(0.55, 0.85, nW.g * 0.7 + nB.r * 0.3);
        float off = (1.0 - piste) * (1.0 - water);
        snow *= 1.0 - off * (0.05 * crust - 0.025 * smoothstep(0.4, 0.8, nL.b));
        snow *= 1.0 + off * (d2.a - 0.5) * 0.05 * midK;
        // ---- under the trees: blue-grey dappled shade, needle litter
        float under = forest * (0.55 + 0.45 * nB.a);
        snow = mix(snow, snow * vec3(0.8, 0.84, 0.92), under * 0.5);
        // ---- villages: trodden, ploughed snow and wet tracks
        snow = mix(snow, snow * vec3(0.9, 0.9, 0.92) * (0.92 + 0.1 * nA.g), built * 0.6);
        // ---- frozen lakes: dead flat, snow drifted in long streaks over grey-blue ice, a few pressure cracks, a darker icy shore
        float iceShow = smoothstep(0.44, 0.72, nL.a * 0.6 + texture2D(uNoise, wp * 0.006 + 0.4).b * 0.4) * smoothstep(0.75, 1.0, waterSoft);
        float crack = 1.0 - smoothstep(0.0, 0.02, abs(texture2D(uNoise, wp * 0.0045 + 0.2).g - 0.5));
        vec3 ice = mix(vec3(0.62, 0.71, 0.8), vec3(0.74, 0.8, 0.87), nB.r) * (shade * 0.75 + uSunColor * lit * 0.45);
        float shore = smoothstep(0.08, 0.35, waterSoft) * (1.0 - smoothstep(0.45, 0.8, waterSoft));
        vec3 lake = mix(snow * vec3(0.94, 0.965, 1.0), ice, iceShow * 0.62);
        lake = mix(lake, lake * vec3(0.8, 0.86, 0.92), crack * 0.35 * aa + shore * 0.5);
        snow = mix(snow, lake, smoothstep(0.05, 0.3, waterSoft));
        // ---- bare rock: the baked winter rock (aInfo.z, from the 5 m terrain: steepness, ridges, aspect, height, strata; right at every
        //      distance) and, near by or outside the baked box, whatever is too steep for snow by the normal (far away the normal map's
        //      40 m faces are smoother than the real ones: their threshold is lower). Flat bits inside the rock (ledges) keep their snow.
        float slope = 1.0 - N.y;
        float farK = smoothstep(250.0, 3000.0, vDist);
        float crag = d2.a * (1.0 - farK) + d3.a * farK;                         // craggy breakup at the scale the distance can show
        float s0 = mix(0.30, mix(0.2, 0.26, farMix), farK) - relief * 0.04;    // the normal map shows the real 40 m faces: no lowered threshold there
        float rockSteep = smoothstep(s0, s0 + 0.1, slope + (nA.g - 0.5) * 0.1 + (crag - 0.5) * 0.07);
        float ledge = mix(0.09, mix(0.015, 0.04, farMix), farK);
        // the baked share of rock in this spot, painted as crisp patches of that share (thresholded by the crags), not as a grey blend
        float rockBaked = smoothstep(-0.1, 0.1, rockCls - (0.22 + 0.56 * crag)) * smoothstep(ledge, ledge + 0.08, slope + (nB.b - 0.5) * 0.06);
        float rockAmt = max(rockSteep, rockBaked) * (1.0 - piste) * (1.0 - water);
        // round 7 (A): far away a winter mountain reads white: only the steepest faces stay rock, and what remains is lighter (snow
        // dusted); this was a grey-white striping at 5-15 km
        float farRock = smoothstep(2500.0, 9000.0, vDist);
        rockAmt *= mix(1.0, smoothstep(0.42, 0.6, slope), farRock);
        // strata: grey layers of ~8 m (light and dark), snow in broken lines on some layers' ledges; less snow the steeper
        float sPhase = vWorld.y * 0.12 + nA.r * 2.0 + nB.g * 1.2 + nL.g * 2.0;
        float sFw = fwidth(sPhase);
        float sAA = (1.0 - smoothstep(0.1, 0.32, sFw)) * (1.0 - smoothstep(900.0, 2600.0, vDist));     // round 7: gone before they alias (no crawl)
        float lineAA = 1.0 - smoothstep(0.03, 0.1, sFw);                                                // the thin snow lines go first
        float sLayer = fract(sPhase);
        float steepK = smoothstep(mix(0.22, 0.1, farK), mix(0.42, 0.25, farK), slope);                                 // layers only on real faces: gentle rock is blotchy
        float strata = 0.5 + 0.5 * sin(sPhase * 6.2832) * sAA * steepK;
        // rock colour: cool grey to warm grey-brown by layer and patch, darker in the cracks between the crags, lighter on their edges
        vec3 rockCol = mix(vec3(0.3, 0.305, 0.33), vec3(0.58, 0.55, 0.52), strata * 0.35 + nB.r * 0.4 + crag * 0.25);
        rockCol = mix(rockCol, rockCol * vec3(1.06, 0.99, 0.9), smoothstep(0.5, 0.8, nL.b));        // warmer faces here and there
        rockCol *= (0.9 + 0.2 * nL.b) * (0.84 + 0.3 * smoothstep(0.25, 0.8, crag));
        // rock is lit by its own rougher normal: the crags catch the sun and throw small shadows
        vec3 Nr = normalize(N + vec3(d3.r - 0.5, 0.0, d3.g - 0.5) * (0.5 + 0.4 * farK) + vec3(d2.r - 0.5, 0.0, d2.g - 0.5) * 0.7 * midK);
        float rockLit = band(smoothstep(-0.2, 0.75, dot(Nr, uSunDir)) * sunVis);
        rockCol = rockCol * (shade * vec3(0.74, 0.8, 0.9) * (1.0 - 0.25 * max(ao, 0.0)) + uSunColor * rockLit * 0.95);
        float snowLine = smoothstep(0.8, 0.88, sLayer) * (1.0 - smoothstep(0.9, 0.98, sLayer)) * smoothstep(0.45, 0.65, nB.a) * sAA * lineAA * steepK * (1.0 - smoothstep(0.35, 0.7, slope));
        float snowPatch = smoothstep(0.5, 0.78, nB.g * 0.6 + nA.b * 0.4) * (1.0 - smoothstep(0.22, 0.5, slope));     // snow patches in the hollows
        float snowLedge = (1.0 - smoothstep(0.34, 0.52, crag)) * (1.0 - smoothstep(0.3, 0.62, slope)) * 0.45;                 // snow lying in the cracks and on the ledges between crags
        // snow streaks down the gullies, long along the fall line (they read at every distance, unlike the thin strata lines)
        vec2 acrossFall = vec2(-fall.y, fall.x);
        float streakN = texture2D(uNoise, vec2(dot(wp, acrossFall) * 0.021, dot(wp, fall) * 0.0032) + 0.55).g * 0.75 + nL.r * 0.25;
        float streak = smoothstep(0.56, 0.7, streakN - relief * 0.12) * steepK * (1.0 - smoothstep(0.4, 0.8, slope));
        rockAmt *= 1.0 - clamp(snowLine * 0.85 + snowPatch * 0.8 + streak * 0.85 + snowLedge, 0.0, 1.0);
        rockAmt = smoothstep(0.22, 0.7, rockAmt);                                // a crisp painted edge between snow and rock, no grey mush
        vec3 col = mix(snow, rockCol, rockAmt);
        // ---- forests beyond the instanced trees: a dark underlay where the far tree cards stand (forest-far.js draws the trees)
        float fRaster = uForestOn > 0.5 ? texture2D(uForestTex, wp / uForestSize).r : forest;
        float canopy = fRaster * smoothstep(uTreeRadius * 0.7, uTreeRadius * 1.0, vDist) * (1.0 - piste);
        vec3 green = mix(vec3(0.11, 0.17, 0.16), vec3(0.2, 0.25, 0.24), nA.g);
        vec3 canopyCol = green * (shade * 0.75 + uSunColor * smoothstep(-0.2, 0.7, nl) * sunVis * 0.45);
        col = mix(col, canopyCol, canopy * 0.3);
        #ifndef CHEAP
        // sheen: packed and wind-polished snow shines towards a low sun; sparkle: single grains flash as the view moves over them
        float clearSun = lit * (1.0 - rockAmt) * (1.0 - uOvercast);
        vec3 Hh = normalize(uSunDir + V);
        float ndh = max(dot(Nb, Hh), 0.0);
        col += uSunColor * (pow(ndh, 70.0) * 0.26 + pow(ndh, 12.0) * 0.05) * clearSun * (0.55 + 0.45 * piste);
        vec4 sA = texture2D(uDetail, wp * 0.9 + 0.13), sB = texture2D(uDetail, wp * 0.23 + 0.57);
        vec3 gA = normalize(N + vec3(sA.r - 0.5, 0.0, sA.g - 0.5) * 5.0), gB = normalize(N + vec3(sB.r - 0.5, 0.0, sB.g - 0.5) * 5.0);
        float spark = sA.b * pow(max(dot(gA, Hh), 0.0), 24.0) * 3.2 + sB.b * pow(max(dot(gB, Hh), 0.0), 24.0) * 2.2 * (1.0 - smoothstep(30.0, 90.0, vDist));
        col += vec3(1.0, 0.98, 0.94) * spark * clearSun * (1.0 - 0.45 * piste);
        #endif
        // fog and haze: brighter towards the sun (light scattered forward), the same glow as the sky's horizon
        vec3 fogC = uFogColor + uSunColor * pow(max(dot(-V, uSunDir), 0.0), 5.0) * 0.14 + vec3(1.0, 0.985, 0.95) * uMilk * pow(max(dot(-V, uSunDir), 0.0), 10.0) * 0.1;
        // round 7 (A): the far grid ends 14 km outside the resort: its last 3.5 km fade into the haze (never a cut edge)
        vec2 er = min(wp - uShadowRect.xy, uShadowRect.xy + uShadowRect.zw - wp);
        float edgeFade = 1.0 - smoothstep(0.0, 3500.0, min(er.x, er.y));
        col = mix(col, fogC, edgeFade * smoothstep(1500.0, 6000.0, vDist));
        gl_FragColor = vec4(applyFog(col, vDist, fogC, uFogDensity), 1.0);
      }`,
  });
}
