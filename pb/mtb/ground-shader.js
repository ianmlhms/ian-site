/* The painted ground: one shader for every terrain tile.
 *
 * No photographs: the colour is a mix of five hand-drawn canvas textures (leaf litter, moss, trail dirt, sandstone, grass) selected by
 *   - the land-cover maps (meadow, rock, built-up, water; canopy cover, wetness),
 *   - the slope (steep = sandstone with horizontal strata read from the world height, moss on the ledges),
 *   - the carve coverage of the way network (trail bed, with a ragged leaf-littered edge),
 * then lit with soft banded "gouache" shading, drifting cloud shadows and dappled forest light, and fogged into the sky colour. */

export const PAINT_LIGHT_GLSL = `
  vec3 paintLight(vec3 albedo, vec3 N, float sunMul, float shade){
    float ndl = dot(N, normalize(uSunDir));
    float diff = smoothstep(-0.12, 0.85, ndl);
    float banded = floor(diff * 4.0 + 0.5) / 4.0;
    diff = mix(diff, banded, 0.22);
    vec3 amb = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5);
    vec3 light = amb * shade * 0.8 + uSunColor * diff * sunMul * 0.7;
    vec3 c = albedo * light;
    return c / (1.0 + c * 0.22) * 1.12;                    // soft shoulder: bright sunlit leaves roll off instead of clipping to neon
  }
  vec3 applyFog(vec3 col, float dist){
    float f = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
    return mix(col, uFogColor, clamp(f, 0.0, 1.0));
  }
`;

export const GROUND_VERTEX = `
  attribute float aCover;
  varying vec3 vWorld; varying vec3 vNormal; varying float vCover; varying float vDist;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz; vNormal = normal; vCover = aCover;
    vec4 mv = viewMatrix * wp;
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

export const GROUND_FRAGMENT = `
  precision highp float;
  uniform sampler2D uLitter, uMoss, uDirt, uRock, uNoise, uMapCover, uMapCanopy;
  uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround, uFogColor;
  uniform float uFogDensity, uTime, uWet, uNight, uCloud, uTreeRadius;
  uniform vec2 uWorldSize, uWind;
  varying vec3 vWorld; varying vec3 vNormal; varying float vCover; varying float vDist;
  ${PAINT_LIGHT_GLSL}
  void main(){
    vec3 N = normalize(vNormal);
    vec2 P = vWorld.xz;
    vec2 mapUv = clamp(P / uWorldSize, 0.0, 1.0);
    vec4 mc = texture2D(uMapCover, mapUv);          // grass, built, water, rock
    vec4 mk = texture2D(uMapCanopy, mapUv);         // canopy cover, canopy height, wetness, farmland
    vec4 nLo = texture2D(uNoise, P * 0.0063);
    vec4 nMid = texture2D(uNoise, P * 0.031 + 0.37);
    vec4 nHi = texture2D(uNoise, P * 0.17 + 0.71);
    vec2 warp = (nLo.rg - 0.5) * 2.4 + (nMid.gb - 0.5) * 0.9;
    vec2 Q = P + warp;
    float near = 1.0 - smoothstep(180.0, 700.0, vDist);           // detail fades with distance (the fog takes over)

    // detail normal: painterly bumps
    vec2 dn = texture2D(uNoise, P * 0.42).gb - 0.5;
    N = normalize(N + vec3(dn.x, 0.0, dn.y) * 0.34 * near);

    // ---- materials
    // steep ground is mapped from the side (x+z, y) so the paint does not smear down the slope
    float sideK = smoothstep(0.55, 0.9, 1.0 - N.y);
    vec2 Qs = vec2((vWorld.x + vWorld.z) * 0.7071, vWorld.y) + warp * 0.3;
    vec3 litterTop = texture2D(uLitter, Q * 0.31).rgb, litterSide = texture2D(uLitter, Qs * 0.31).rgb;
    vec3 litter = mix(litterTop, litterSide, sideK) * (0.62 + 0.78 * texture2D(uLitter, Q * 0.047).r);
    litter = mix(litter, litter * vec3(0.78, 0.82, 0.74), mk.r * 0.55);                 // dense canopy: cooler, darker floor
    litter = mix(litter, litter * vec3(1.18, 1.02, 0.78), nLo.b * 0.5 * (1.0 - mk.r));  // open ground: warmer
    vec3 mossC = mix(texture2D(uMoss, Q * 0.37).rgb, texture2D(uMoss, Qs * 0.37).rgb, sideK) * (0.7 + 0.6 * texture2D(uMoss, Q * 0.06).g);
    vec3 grassC = mix(vec3(0.4, 0.5, 0.22), vec3(0.58, 0.58, 0.28), nMid.r) * (0.62 + 0.75 * texture2D(uMoss, Q * 0.5).g);
    grassC = mix(grassC, vec3(0.76, 0.7, 0.34), mk.a * 0.6 * step(0.5, nLo.g));         // farmland: patches of stubble
    vec3 dirtC = texture2D(uDirt, Q * 0.62).rgb * (0.82 + 0.4 * nMid.g);
    // sandstone: horizontal strata from the world height, vertical weathering streaks
    vec2 ruv = vec2((vWorld.x + vWorld.z) * 0.23, vWorld.y * 0.34);
    vec3 rockC = texture2D(uRock, ruv).rgb;
    float strata = sin(vWorld.y * 5.8 + nLo.r * 9.0) * 0.5 + 0.5;
    rockC *= mix(0.74, 1.12, strata) * (0.94 + 0.12 * sin(vWorld.y * 21.0 + nMid.r * 6.0));
    float streak = texture2D(uNoise, vec2((vWorld.x + vWorld.z) * 0.9, vWorld.y * 0.03)).g;
    rockC *= 1.0 - 0.34 * smoothstep(0.55, 0.9, streak);
    rockC = mix(rockC, rockC * vec3(0.94, 0.9, 0.82) + vec3(0.04, 0.0, -0.03), nLo.g * 0.6);

    // ---- weights
    float steep = smoothstep(0.86, 0.60, N.y);                                      // 0 flat .. 1 cliff
    float rockW = clamp(steep + mc.a, 0.0, 1.0);
    float rockMoss = smoothstep(0.35, 0.75, mk.b * 0.9 + mk.r * 0.35 + (nHi.g - 0.5) * 0.9) * 0.85;       // the sandstone of the gorges is mostly green
    float mossW = clamp(mk.b * 1.35 + (nMid.a - 0.5) * 1.0 + mk.r * 0.3 + 0.08, 0.0, 1.0);
    mossW = smoothstep(0.4, 0.78, mossW) * (1.0 - smoothstep(0.35, 0.55, steep)) * (1.0 - mc.r);
    float ledgeMoss = smoothstep(0.55, 0.86, N.y) * steep * 0.0 + smoothstep(0.62, 0.8, N.y) * smoothstep(0.18, 0.4, steep + mc.a) * smoothstep(0.35, 0.7, nHi.r + mk.b * 0.4);
    float grassW = smoothstep(0.35, 0.7, mc.r + (nMid.g - 0.5) * 0.25) * (1.0 - rockW);
    float edgeNoise = (nHi.r - 0.5) * 0.3 + (nMid.r - 0.5) * 0.2;
    float trailW = smoothstep(0.52 + edgeNoise, 0.78 + edgeNoise, vCover);

    vec3 albedo = litter;
    albedo = mix(albedo, mossC, mossW * 0.9);
    albedo = mix(albedo, grassC, grassW);
    albedo = mix(albedo, mix(rockC, mossC * vec3(0.78, 0.92, 0.7), rockMoss * (1.0 - steep * 0.55)), rockW);
    albedo = mix(albedo, mossC * vec3(0.9, 1.0, 0.85), clamp(ledgeMoss, 0.0, 1.0) * 0.8 * (1.0 - trailW));
    // seen from afar the forest is its canopy, not its floor: painted leaf blotches (the trees themselves are only drawn within uTreeRadius)
    float farK = smoothstep(uTreeRadius * 0.55, uTreeRadius * 1.5, vDist) * mk.r * (1.0 - rockW * 0.8) * (1.0 - grassW);
    vec3 canopyC = mix(vec3(0.15, 0.25, 0.12), vec3(0.3, 0.4, 0.17), smoothstep(0.3, 0.8, nMid.g * 0.6 + nHi.b * 0.5));
    canopyC = mix(canopyC, vec3(0.36, 0.34, 0.14), smoothstep(0.78, 0.92, nLo.g) * 0.55);       // a few golden / spruce-dark patches
    albedo = mix(albedo, canopyC * (0.8 + 0.4 * texture2D(uMoss, Q * 0.2).g), farK);
    trailW *= 1.0 - smoothstep(110.0, 260.0, vDist);                                   // a 1 m path cannot be drawn by far, coarse tiles
    albedo = mix(albedo, dirtC * (1.0 - 0.32 * uWet), trailW);
    albedo = mix(albedo, vec3(0.6, 0.58, 0.54) * (0.8 + 0.4 * nHi.g), smoothstep(0.4, 0.8, mc.g));          // built-up ground
    albedo = mix(albedo, vec3(0.16, 0.3, 0.34), smoothstep(0.4, 0.8, mc.b));
    albedo *= 1.0 - 0.28 * uWet * (1.0 - trailW);                                      // wet ground is darker

    // ---- light: cloud shadows drift over the land, forest light is dappled
    vec2 cw = P * 0.0019 + uWind * uTime * 0.0012;
    float cloudShadow = mix(1.0, smoothstep(0.38, 0.7, texture2D(uNoise, cw).b) * 0.55 + 0.45, uCloud * 0.8);
    float forest = mk.r * (1.0 - trailW * 0.8);
    float dapple = smoothstep(0.46, 0.62, texture2D(uNoise, P * 0.21 + uWind * uTime * 0.004).g * 0.6 + texture2D(uNoise, P * 0.55 - uWind * uTime * 0.006).b * 0.4);
    float sunY = clamp(uSunDir.y, 0.0, 1.0);
    float openSun = mix(1.0, dapple * (0.35 + 0.75 * sunY), forest);
    float sunMul = cloudShadow * openSun;
    float shade = mix(1.0, 0.92, forest) * (0.78 + 0.22 * smoothstep(0.1, 0.9, N.y));
    vec3 col = paintLight(albedo, N, sunMul, shade);
    col = pow(col, vec3(0.97));
    col = applyFog(col, vDist);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createGroundMaterial(THREE, env, textures, worldMaps, worldSize) {
  const uniforms = {
    ...env.uniforms,
    uLitter: { value: textures.litter }, uMoss: { value: textures.moss }, uDirt: { value: textures.dirt }, uRock: { value: textures.sandstone },
    uTreeRadius: { value: 150 }, uMapCover: { value: worldMaps.cover }, uMapCanopy: { value: worldMaps.canopy }, uWorldSize: { value: new THREE.Vector2(worldSize.width, worldSize.depth) },
  };
  return new THREE.ShaderMaterial({ uniforms, vertexShader: GROUND_VERTEX, fragmentShader: GROUND_FRAGMENT, side: THREE.FrontSide });
}
