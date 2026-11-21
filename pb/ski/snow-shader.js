/* The painted ground: snow in gouache light (warm lit side, blue shade, a few soft bands), groomed corduroy along the piste, wind-blown
 * powder off it, grey-brown rock with strata where the mountain is too steep to hold snow, darker snow under the trees, trodden snow in the
 * villages, frozen snow-covered lakes. All colours are ours: no photo or satellite texture anywhere.
 *   aInfo  = (piste, forest, rock, water - built) from the tile builder
 *   aExtra = (groom direction x, z: the nearest piste line; terrain occlusion -1 ridge .. 1 hollow; 0)
 * Light: sun (N.L, the baked mountain shadows, the near shadow map on Mëttel / Héich) + sky ambient darkened in hollows (the occlusion).
 * `cheap` = the Niddreg variant (no glints, no shadow map, one noise read less). */
import { SHADOW_GLSL } from './shadows.js';

const THREE = window.THREE;

/** Shared GLSL: the fog of every painted material (weather fog + a blue aerial perspective far away). */
export const FOG_GLSL = `
  vec3 applyFog(vec3 col, float dist, vec3 fogCol, float density){
    float f = 1.0 - exp(-pow(density * dist, 2.0));
    float aerial = (1.0 - exp(-dist * 0.000045)) * 0.38;
    return mix(col, fogCol, clamp(max(f, aerial), 0.0, 1.0));
  }`;

export function createSnowMaterial(env, { cheap = false, treeRadius = 400, forest = null } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...env.u, uTreeRadius: { value: treeRadius }, uForestTex: { value: forest ? forest.texture : env.u.uNoise.value }, uForestSize: { value: new THREE.Vector2(forest ? forest.width : 1, forest ? forest.depth : 1) }, uForestOn: { value: forest ? 1 : 0 } },
    defines: cheap ? { CHEAP: 1 } : {},
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
      uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround, uFogColor; uniform float uFogDensity, uTime, uOvercast, uSnowfall, uTreeRadius, uShadowOn;
      uniform sampler2D uNoise, uShadow, uForestTex; uniform vec4 uShadowRect; uniform vec2 uForestSize; uniform float uForestOn;
      varying vec3 vWorld; varying vec3 vNormal; varying vec4 vInfo; varying vec4 vExtra; varying float vDist;
      ${cheap ? '' : SHADOW_GLSL}
      ${FOG_GLSL}
      float band(float x){ return mix(x, floor(x * 4.0 + 0.5) / 4.0, 0.22); }
      void main(){
        vec3 N = normalize(vNormal);
        float piste = clamp(vInfo.x, 0.0, 1.0), forest = clamp(vInfo.y, 0.0, 1.0), rockCls = clamp(vInfo.z, 0.0, 1.0);
        float built = clamp(-vInfo.w, 0.0, 1.0), waterSoft = clamp(vInfo.w, 0.0, 1.0), water = smoothstep(0.4, 0.9, waterSoft);
        float occ = vExtra.z;
        float near = 1.0 - smoothstep(25.0, 140.0, vDist);
        vec2 wp = vWorld.xz;
        vec4 nA = texture2D(uNoise, wp * 0.013);
        vec4 nB = texture2D(uNoise, wp * 0.071 + 0.3);
        vec4 nL = texture2D(uNoise, wp * 0.0021 + 0.7);                  // big soft patches: the snow is never one flat white
        vec2 fall = N.xz / max(length(N.xz), 1e-3);
        // ---- corduroy: grooves along the nearest piste line (the way the groomer drove), in lanes of one groomer width (~5 m) whose
        //      phase and depth differ a little; faded out where a pixel spans several grooves (no moire), and with distance
        vec2 g = vExtra.xy; g /= max(length(g), 1e-3);
        vec2 acr = vec2(-g.y, g.x);
        float across = dot(wp, acr), along = dot(wp, g);
        float lane = floor(across / 5.2);
        float laneR = fract(sin(lane * 12.9898) * 43758.5453);
        float gp = across * 24.0 + laneR * 3.0 + nA.r * 0.6;
        float aa = clamp(1.3 - fwidth(gp) * 0.8, 0.0, 1.0) * (1.0 - smoothstep(6.0, 32.0, vDist));
        float cord = sin(gp) * aa * (0.45 + 0.35 * laneR) * smoothstep(0.25, 0.7, piste);
        float laneEdge = (1.0 - smoothstep(0.0, 0.35, abs(fract(across / 5.2) - 0.5) * 2.0 - 0.65)) * aa;  // a faint ridge between groomer passes
        // ---- normal detail: corduroy on the piste, wind ripples (sastrugi: long, along the wind) off it
        vec2 wind = vec2(0.8, 0.6);
        vec4 nW = texture2D(uNoise, vec2(dot(wp, wind) * 0.09, dot(wp, vec2(-wind.y, wind.x)) * 0.022) + 0.1);
        float drift = (nB.g - 0.5) * 0.6 + (nW.r - 0.5) * 0.8;
        vec3 Nb = N;
        Nb.xz += acr * cord * 0.05 * piste + fall * drift * 0.2 * (1.0 - piste) * (1.0 - water) * (0.35 + 0.65 * near);
        Nb = normalize(Nb);
        // ---- light
        float nl = dot(Nb, uSunDir);
        float sunVis = mix(1.0, texture2D(uShadow, (wp - uShadowRect.xy) / uShadowRect.zw).r, uShadowOn);    // in a ridge's shadow?
        #ifndef CHEAP
        sunVis = min(sunVis, sunMapShadow(vWorld, N));                                                         // trees, houses, the skier, small ridges
        #endif
        float lit = band(smoothstep(-0.06 + (nA.a - 0.5) * 0.12, 0.6, nl) * sunVis);
        float sky = 0.5 + 0.5 * Nb.y;
        float ao = clamp(occ, -0.6, 1.0);
        vec3 shade = mix(uAmbGround, uAmbSky, sky) * (1.0 - 0.32 * max(ao, 0.0) + 0.08 * max(-ao, 0.0));
        // snow: blue-grey in the shade (the sky's light), warm white in the sun; never brighter than paper white
        vec3 shadeC = mix(vec3(0.8), vec3(0.84, 0.9, 1.0), (0.6 + 0.25 * max(ao, 0.0)) * (1.0 - 0.55 * uOvercast)) * (shade * 0.95 + 0.12);   // overcast light is whiter
        float top = max(shadeC.r, max(shadeC.g, shadeC.b));
        shadeC *= mix(1.0, 0.97 / top, smoothstep(0.9, 1.15, top));              // bright overcast light: a soft shoulder, hue kept, no cyan clip
        vec3 litC = max(shadeC * 1.02, shadeC * 0.3 + uSunColor * 0.76);         // a weak sun (fog, cloud) never makes the lit side darker than the shade
        vec3 snow = mix(shadeC, litC, lit);
        snow *= 0.955 + 0.05 * nA.b + 0.035 * (nL.r - 0.5);
        // ---- groomed: smooth, compact, a touch greyer-blue than powder, corduroy shading, lane ridges, a soft packed edge line
        float edgeLine = smoothstep(0.25, 0.5, piste) * (1.0 - smoothstep(0.5, 0.8, piste));
        vec3 packed = snow * vec3(0.975, 0.985, 1.0) * (1.0 + 0.03 * cord + 0.012 * laneEdge) * (0.99 + 0.02 * (nL.g - 0.5));
        snow = mix(snow, packed, piste);
        snow *= 1.0 - 0.045 * edgeLine;
        // ---- off-piste: wind-scoured crusts (a little greyer) and fresh powder pillows (brighter)
        float crust = smoothstep(0.55, 0.85, nW.g * 0.7 + nB.r * 0.3);
        snow *= 1.0 - (1.0 - piste) * (1.0 - water) * (0.045 * crust - 0.02 * smoothstep(0.4, 0.8, nL.b));
        // ---- under the trees: blue-grey dappled shade, needle litter
        float under = forest * (0.55 + 0.45 * nB.a);
        snow = mix(snow, snow * vec3(0.8, 0.84, 0.92), under * 0.5);
        // ---- villages: trodden, ploughed snow and wet tracks
        snow = mix(snow, snow * vec3(0.9, 0.9, 0.92) * (0.92 + 0.1 * nA.g), built * 0.6);
        // ---- frozen lakes: dead flat, snow drifted in long streaks over grey-blue ice, a few pressure cracks, a darker icy shore
        float iceShow = smoothstep(0.52, 0.78, nL.a * 0.6 + texture2D(uNoise, wp * 0.006 + 0.4).b * 0.4) * smoothstep(0.75, 1.0, waterSoft);
        float crack = 1.0 - smoothstep(0.0, 0.02, abs(texture2D(uNoise, wp * 0.0045 + 0.2).g - 0.5));
        vec3 ice = mix(vec3(0.62, 0.71, 0.8), vec3(0.74, 0.8, 0.87), nB.r) * (shade * 0.75 + uSunColor * lit * 0.45);
        float shore = smoothstep(0.08, 0.35, waterSoft) * (1.0 - smoothstep(0.45, 0.8, waterSoft));
        vec3 lake = mix(snow * vec3(0.94, 0.965, 1.0), ice, iceShow * 0.45);
        lake = mix(lake, lake * vec3(0.8, 0.86, 0.92), crack * 0.35 * aa + shore * 0.35);
        snow = mix(snow, lake, smoothstep(0.05, 0.3, waterSoft));
        // ---- rock where it is too steep for snow (strata in the height), more of it in the mapped rock areas
        float slope = 1.0 - N.y;
        float rockAmt = smoothstep(0.31, 0.42, slope + (nA.g - 0.5) * 0.12);
        rockAmt = max(rockAmt, rockCls * smoothstep(0.24, 0.35, slope + (nB.b - 0.5) * 0.16) * 0.85);
        rockAmt *= (1.0 - piste) * (1.0 - water);
        float sPhase = vWorld.y * 0.55 + nA.r * 4.0;
        float strata = 0.5 + 0.5 * sin(sPhase) * clamp(1.2 - fwidth(sPhase) * 0.8, 0.0, 1.0);
        vec3 rockCol = mix(vec3(0.44, 0.41, 0.39), vec3(0.62, 0.57, 0.52), strata * 0.6 + nB.r * 0.4);
        float rockLit = band(smoothstep(-0.2, 0.75, dot(N, uSunDir)) * sunVis);
        rockCol = rockCol * (shade * 0.8 * (1.0 - 0.25 * max(ao, 0.0)) + uSunColor * rockLit * 0.9);
        rockAmt *= 1.0 - 0.75 * smoothstep(0.45, 0.8, nB.g * 0.6 + nA.b * 0.4) * smoothstep(0.55, 0.3, slope);   // snow on ledges and in gullies
        vec3 col = mix(snow, rockCol, rockAmt);
        // ---- forests beyond the instanced trees: a dark underlay where the far tree cards stand (forest-far.js draws the trees)
        float fRaster = uForestOn > 0.5 ? texture2D(uForestTex, wp / uForestSize).r : forest;
        float canopy = fRaster * smoothstep(uTreeRadius * 0.7, uTreeRadius * 1.0, vDist) * (1.0 - piste);
        vec3 green = mix(vec3(0.11, 0.17, 0.16), vec3(0.2, 0.25, 0.24), nA.g);
        vec3 canopyCol = green * (shade * 0.75 + uSunColor * smoothstep(-0.2, 0.7, nl) * sunVis * 0.45);
        col = mix(col, canopyCol, canopy * 0.3);
        #ifndef CHEAP
        // glints: tiny bright sparkles in the sun, close by, more on powder than on the piste
        vec4 nC = texture2D(uNoise, wp * 1.7);
        float glint = step(0.983 + 0.008 * piste, nC.r) * near * lit * (1.0 - rockAmt) * (1.0 - uOvercast);
        col += glint * 0.35;
        #endif
        gl_FragColor = vec4(applyFog(col, vDist, uFogColor, uFogDensity), 1.0);
      }`,
  });
}
