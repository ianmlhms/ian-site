/* The painted ground: snow in gouache light (warm lit side, blue shade, a few soft bands), groomed corduroy on the pistes, wind-blown
 * drifts and glints off them, grey-brown rock with strata where the mountain is too steep to hold snow, darker snow under the trees,
 * trodden snow in the villages, frozen lakes. All colours are ours: no photo or satellite texture anywhere.
 * aInfo = (piste, forest, rock, built + 2 * water) from the tile builder. `cheap` = the low-quality variant (no glints, one noise read less). */
const THREE = window.THREE;

export function createSnowMaterial(env, { cheap = false, treeRadius = 400, forest = null } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...env.u, uTreeRadius: { value: treeRadius }, uForestTex: { value: forest ? forest.texture : env.u.uNoise.value }, uForestSize: { value: new THREE.Vector2(forest ? forest.width : 1, forest ? forest.depth : 1) }, uForestOn: { value: forest ? 1 : 0 } },
    defines: cheap ? { CHEAP: 1 } : {},
    vertexShader: `
      attribute vec4 aInfo;
      varying vec3 vWorld; varying vec3 vNormal; varying vec4 vInfo; varying float vDist;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vNormal = normal; vInfo = aInfo;
        vec4 mv = viewMatrix * w;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround, uFogColor; uniform float uFogDensity, uTime, uOvercast, uSnowfall, uTreeRadius, uShadowOn; uniform sampler2D uNoise, uShadow, uForestTex; uniform vec4 uShadowRect; uniform vec2 uForestSize; uniform float uForestOn;
      varying vec3 vWorld; varying vec3 vNormal; varying vec4 vInfo; varying float vDist;
      float band(float x){ return mix(x, floor(x * 4.0 + 0.5) / 4.0, 0.22); }
      vec3 snowShade(vec3 shade){ return mix(vec3(0.78), vec3(0.84, 0.9, 1.0), 0.75) * (shade * 0.95 + 0.12); }
      void main(){
        vec3 N = normalize(vNormal);
        float piste = clamp(vInfo.x, 0.0, 1.0), forest = clamp(vInfo.y, 0.0, 1.0), rockCls = clamp(vInfo.z, 0.0, 1.0);
        float built = clamp(mod(vInfo.w, 2.0), 0.0, 1.0), water = clamp(floor(vInfo.w * 0.5 + 0.01), 0.0, 1.0);
        float near = 1.0 - smoothstep(25.0, 140.0, vDist);
        vec2 wp = vWorld.xz;
        vec4 nA = texture2D(uNoise, wp * 0.013);
        vec4 nB = texture2D(uNoise, wp * 0.071 + 0.3);
        // fall line (downhill) for the drift streaks
        vec2 fall = N.xz / max(length(N.xz), 1e-3);
        vec2 across = vec2(-fall.y, fall.x);
        // corduroy: grooves along the fall line, drawn as two world-axis stripe sets blended by the fall direction (a groove direction
        // taken from the faceted normals swirls; this one stays straight), faded out where a pixel spans several grooves (no moire)
        float px = wp.x * 7.0 + nA.r * 2.0, pz = wp.y * 7.0 + nA.r * 2.0;
        float wx = fall.y * fall.y, wz = fall.x * fall.x;
        float aa = clamp(1.4 - max(fwidth(px), fwidth(pz)) * 0.9, 0.0, 1.0) * (1.0 - smoothstep(10.0, 55.0, vDist));
        float cord = (sin(px) * wx + sin(pz) * wz) * aa * smoothstep(0.03, 0.1, length(N.xz));   // no grooves on the flat (no fall line to follow)
        float drift = nB.g - 0.5;
        vec3 Nb = N;
        Nb.xz += vec2(wx, wz) * cord * 0.035 * piste + fall * drift * 0.22 * (1.0 - piste) * (0.4 + 0.6 * near);
        Nb = normalize(Nb);
        // light: soft gouache ramp with a brushed edge, a few bands
        float nl = dot(Nb, uSunDir);
        float sunVis = mix(1.0, texture2D(uShadow, (wp - uShadowRect.xy) / uShadowRect.zw).r, uShadowOn);    // in a ridge's shadow?
        float lit = band(smoothstep(-0.06 + (nA.a - 0.5) * 0.12, 0.6, nl) * sunVis);
        float sky = 0.5 + 0.5 * Nb.y;
        vec3 shade = mix(uAmbGround, uAmbSky, sky);
        // snow: blue-grey in the shade (the sky's light), warm white in the sun; never brighter than paper white
        vec3 shadeC = mix(vec3(0.78), vec3(0.84, 0.9, 1.0), 0.75) * (shade * 0.95 + 0.12);
        vec3 litC = shadeC * 0.3 + uSunColor * 0.76;
        vec3 snow = mix(shadeC, litC, lit);
        snow *= 0.96 + 0.06 * nA.b;
        // groomed: smoother, a touch brighter, faint corduroy shading, a soft packed-snow edge line
        float edgeLine = smoothstep(0.25, 0.5, piste) * (1.0 - smoothstep(0.5, 0.8, piste));
        snow = mix(snow, snow * (1.0 + 0.04 * cord), piste);
        snow *= 1.0 - 0.05 * edgeLine;
        // off-piste: wind texture, ski-track-free powder
        snow *= 1.0 - (1.0 - piste) * 0.04 * smoothstep(0.3, 0.8, nB.r);
        // under the trees: blue-grey dappled shade, needle litter
        float under = forest * (0.55 + 0.45 * nB.a);
        snow = mix(snow, snow * vec3(0.78, 0.82, 0.9), under * 0.55);
        // villages: trodden, ploughed snow and wet tracks
        snow = mix(snow, snow * vec3(0.82, 0.8, 0.8) * (0.9 + 0.12 * nA.g), built * 0.7);
        // frozen lakes: flat, slightly icy blue
        snow = mix(snow, snow * vec3(0.9, 0.95, 1.02), water * 0.6);
        // rock where it is too steep for snow (strata in the height), more of it in the mapped rock areas
        float slope = 1.0 - N.y;
        // winter: snow sticks to everything below ~40 degrees; the mapped rock areas show their rock a little earlier (~35 degrees)
        float rockAmt = smoothstep(0.31, 0.42, slope + (nA.g - 0.5) * 0.12);
        rockAmt = max(rockAmt, rockCls * smoothstep(0.24, 0.35, slope + (nB.b - 0.5) * 0.16) * 0.85);
        rockAmt *= 1.0 - piste;
        float sPhase = vWorld.y * 0.55 + nA.r * 4.0;
        float strata = 0.5 + 0.5 * sin(sPhase) * clamp(1.2 - fwidth(sPhase) * 0.8, 0.0, 1.0);   // bands only where a pixel can show them
        vec3 rockCol = mix(vec3(0.46, 0.43, 0.41), vec3(0.62, 0.57, 0.52), strata * 0.6 + nB.r * 0.4);
        float rockLit = band(smoothstep(-0.2, 0.75, dot(N, uSunDir)) * sunVis);
        rockCol = rockCol * (shade * 0.8 + uSunColor * rockLit * 0.9);
        // snow caught on ledges of the rock
        rockAmt *= 1.0 - 0.75 * smoothstep(0.45, 0.8, nB.g * 0.6 + nA.b * 0.4) * smoothstep(0.55, 0.3, slope);   // snow lying on ledges and in gullies
        vec3 col = mix(snow, rockCol, rockAmt);
        // forests beyond the instanced trees: painted canopy from the land-cover raster (crisp at any distance): dark crowns in a stipple,
        // snow between them, fading in where the instanced trees end
        float fRaster = uForestOn > 0.5 ? texture2D(uForestTex, wp / uForestSize).r : forest;
        float canopy = fRaster * smoothstep(uTreeRadius * 0.75, uTreeRadius * 1.0, vDist) * (1.0 - piste);
        float crowns = smoothstep(0.3, 0.62, texture2D(uNoise, wp * 0.16).g * 0.7 + nB.a * 0.3);
        vec3 green = mix(vec3(0.07, 0.13, 0.11), vec3(0.14, 0.2, 0.17), nA.g);
        vec3 canopyCol = green * (shade * 0.7 + uSunColor * smoothstep(-0.2, 0.7, nl) * sunVis * 0.5);
        col = mix(col, canopyCol, canopy * (0.5 + 0.42 * crowns));
        #ifndef CHEAP
        // glints: tiny bright sparkles in the sun, close by
        vec4 nC = texture2D(uNoise, wp * 1.7 + floor(uTime * 0.0) );
        float glint = step(0.985, nC.r) * near * lit * (1.0 - rockAmt) * (1.0 - uOvercast);
        col += glint * 0.35;
        #endif
        // aerial perspective + weather fog
        float f = 1.0 - exp(-pow(uFogDensity * vDist, 2.0));
        float aerial = (1.0 - exp(-vDist * 0.000045)) * 0.38;
        col = mix(col, uFogColor, clamp(max(f, aerial), 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}
