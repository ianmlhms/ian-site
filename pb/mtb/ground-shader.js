/* The painted ground: one shader for every terrain tile (two flavours: full, and a cheaper one for the `low` quality).
 *
 * No photographs: the colour is a mix of hand-drawn canvas textures (leaf litter, moss, trail dirt, sandstone, grass) selected by
 *   - the land-cover maps (meadow, rock, built-up, water; canopy cover, wetness; field ids with their crop patterns and hedges),
 *   - the slope (steep = sandstone with horizontal strata read from the world height, moss on the ledges),
 *   - the carve coverage of the way network (trail bed, with a ragged leaf-littered edge) and of the stream channels (gravel bed, mossy banks),
 * then lit with soft banded "gouache" shading, drifting cloud shadows and dappled forest light, wet puddles in the rain, the rider's lamp at night, and fogged. */
import { PAINT_LIGHT_GLSL } from './light-glsl.js';

export { PAINT_LIGHT_GLSL };

export const GROUND_VERTEX = `
  attribute float aCover; attribute float aStream;
  varying vec3 vWorld; varying vec3 vNormal; varying float vCover; varying float vStream; varying float vDist;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz; vNormal = normal; vCover = aCover; vStream = aStream;
    vec4 mv = viewMatrix * wp;
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

export const GROUND_FRAGMENT = `
  precision highp float;
  uniform sampler2D uLitter, uMoss, uDirt, uRock, uNoise, uMapCover, uMapCanopy, uMapField;
  uniform float uTreeRadius;
  uniform vec2 uWorldSize, uWind;
  varying vec3 vWorld; varying vec3 vNormal; varying float vCover; varying float vStream; varying float vDist;
  ${PAINT_LIGHT_GLSL}
  float hash1(float n){ return fract(sin(n * 127.1) * 43758.5453); }

  // crop / pasture colour of a field, with its row pattern (the rows fade out with distance: they cannot be drawn by far tiles)
  vec3 fieldColor(float fid, vec2 P, vec4 nLo, vec4 nMid, float near){
    float h1 = hash1(fid), h2 = hash1(fid + 17.0), h3 = hash1(fid + 41.0);
    float ang = h2 * 3.14159;
    vec2 dir = vec2(cos(ang), sin(ang));
    float across = dot(P, dir), alongDir = dot(P, vec2(-dir.y, dir.x));
    vec3 c; float rows = 0.0, rowAmp = 0.0, spacing = 1.0;
    if (h1 < 0.30) { c = vec3(0.42, 0.54, 0.24); rowAmp = 0.05; spacing = 6.0; }                       // pasture, mown stripes
    else if (h1 < 0.46) { c = vec3(0.50, 0.58, 0.27); rowAmp = 0.045; spacing = 2.3; }                 // meadow: rough grass, not a mown lawn
    else if (h1 < 0.60) { c = vec3(0.76, 0.64, 0.32); rowAmp = 0.10; spacing = 0.8; }                  // ripe wheat
    else if (h1 < 0.70) { c = vec3(0.66, 0.64, 0.30); rowAmp = 0.09; spacing = 0.75; }                 // barley
    else if (h1 < 0.80) { c = vec3(0.47, 0.36, 0.25); rowAmp = 0.17; spacing = 1.1; }                  // ploughed
    else if (h1 < 0.90) { c = vec3(0.33, 0.50, 0.2); rowAmp = 0.12; spacing = 0.75; }                  // maize / green crop
    else { c = vec3(0.34, 0.5, 0.26); rowAmp = 0.05; spacing = 4.0; }                                  // clover
    c *= 0.93 + 0.14 * h3 + (nLo.g - 0.5) * 0.1;
    float s = sin(across * 6.2832 / spacing);
    c *= 1.0 + rowAmp * 0.6 * s * near;
    // a slightly darker headland along the field, from the noise
    c *= 0.97 + 0.06 * nMid.r;
    return c;
  }

  void main(){
    vec3 N = normalize(vNormal);
    vec2 P = vWorld.xz;
    vec2 mapUv = clamp(P / uWorldSize, 0.0, 1.0);
    vec4 mc = texture2D(uMapCover, mapUv);          // grass, built, water, rock
    vec4 mk = texture2D(uMapCanopy, mapUv);         // canopy cover, canopy height, wetness, farmland
    vec4 nLo = texture2D(uNoise, P * 0.0063);
    vec4 nMid = texture2D(uNoise, P * 0.031 + 0.37);
    vec4 nHi = texture2D(uNoise, P * 0.17 + 0.71);
    float near = 1.0 - smoothstep(180.0, 700.0, vDist);           // detail fades with distance (the fog takes over)
    float rowNear = (1.0 - smoothstep(25.0, 140.0, vDist)) * 0.45;      // crop rows are a hint, not a corduroy carpet
    #ifdef LOW
      vec2 warp = (nLo.rg - 0.5) * 2.0;
    #else
      vec2 warp = (nLo.rg - 0.5) * 2.4 + (nMid.gb - 0.5) * 0.9;
    #endif
    vec2 Q = P + warp;

    // detail normal: painterly bumps
    #ifndef LOW
      vec2 dn = texture2D(uNoise, P * 0.42).gb - 0.5;
      N = normalize(N + vec3(dn.x, 0.0, dn.y) * 0.34 * near);
    #endif

    // ---- materials
    float sideK = smoothstep(0.55, 0.9, 1.0 - N.y);
    #ifdef LOW
      sideK = 0.0;
    #endif
    vec2 Qs = vec2((vWorld.x + vWorld.z) * 0.7071, vWorld.y) + warp * 0.3;
    vec3 litter = texture2D(uLitter, Q * 0.31).rgb;
    #ifndef LOW
      litter = mix(litter, texture2D(uLitter, Qs * 0.31).rgb, sideK);
    #endif
    litter = mix(vec3(dot(litter, vec3(0.3, 0.59, 0.11))), litter, 0.74) * vec3(0.98, 0.96, 0.92);        // the painted litter is rich: calmer, browner
    litter *= (0.62 + 0.78 * texture2D(uLitter, Q * 0.047).r);
    litter = mix(litter, litter * vec3(0.95, 0.82, 0.68) + vec3(0.03, 0.0, -0.02), mk.r * 0.55);                     // dense canopy: a little cooler (not darker: the light comes through)
    litter = mix(litter, litter * vec3(1.18, 1.02, 0.78), nLo.b * 0.5 * (1.0 - mk.r));  // open ground: warmer
    litter = mix(litter, litter * vec3(1.45, 0.86, 0.46) + vec3(0.07, 0.0, -0.03), uSeason * 0.75 * (0.55 + 0.45 * nMid.g)); // autumn: the floor turns copper
    vec3 mossC = texture2D(uMoss, Q * 0.37).rgb;
    #ifndef LOW
      mossC = mix(mossC, texture2D(uMoss, Qs * 0.37).rgb, sideK);
    #endif
    mossC *= (0.7 + 0.6 * texture2D(uMoss, Q * 0.06).g);
    vec3 dirtC = texture2D(uDirt, Q * 0.62).rgb * (0.82 + 0.4 * nMid.g);
    // meadows: calm large-scale colour (no camouflage), the fields carry their own crop pattern
    vec4 mf = texture2D(uMapField, clamp((P + (nMid.rg - 0.5) * 9.0) / uWorldSize, 0.0, 1.0));      // field id / 255, leaf type, hedge, cliff hint (the lookup is warped a few metres: no stair-stepped field borders)
    float fid = floor(mf.r * 255.0 + 0.5);
    vec3 grassC = mix(vec3(0.43, 0.54, 0.25), vec3(0.5, 0.58, 0.27), smoothstep(0.35, 0.7, nLo.g)) * (0.9 + 0.2 * texture2D(uMoss, Q * 0.5).g * near + 0.0);
    if (fid > 0.5) {
      vec3 fc = fieldColor(fid, P, nLo, nMid, rowNear);
      grassC = mix(grassC, fc, 0.92);
    }
    grassC = mix(grassC, vec3(0.7, 0.62, 0.32), uSeason * 0.25);
    // sandstone: horizontal strata from the world height, vertical weathering streaks
    vec2 ruv = vec2((vWorld.x + vWorld.z) * 0.23, vWorld.y * 0.34);
    vec3 rockC = texture2D(uRock, ruv).rgb;
    float strata = sin(vWorld.y * 5.8 + nLo.r * 9.0) * 0.5 + 0.5;
    rockC *= mix(0.74, 1.12, strata) * (0.94 + 0.12 * sin(vWorld.y * 21.0 + nMid.r * 6.0));
    #ifndef LOW
      float streak = texture2D(uNoise, vec2((vWorld.x + vWorld.z) * 0.9, vWorld.y * 0.03)).g;
      rockC *= 1.0 - 0.34 * smoothstep(0.55, 0.9, streak);
    #endif
    rockC = mix(rockC, rockC * vec3(0.94, 0.9, 0.82) + vec3(0.04, 0.0, -0.03), nLo.g * 0.6);

    // ---- weights
    float steep = smoothstep(0.86, 0.60, N.y);                                      // 0 flat .. 1 cliff
    float rockW = clamp(steep + mc.a + mf.a * 0.7 * smoothstep(0.93, 0.75, N.y), 0.0, 1.0);
    float rockMoss = smoothstep(0.35, 0.75, mk.b * 0.9 + mk.r * 0.35 + (nHi.g - 0.5) * 0.9) * 0.85;
    float mossW = clamp(mk.b * 1.3 + (nMid.a - 0.5) * 0.8 - 0.2, 0.0, 1.0);
    mossW = smoothstep(0.45, 0.85, mossW) * 0.85 * (1.0 - smoothstep(0.35, 0.55, steep)) * (1.0 - mc.r);
    float ledgeMoss = smoothstep(0.62, 0.8, N.y) * smoothstep(0.18, 0.4, steep + mc.a) * smoothstep(0.35, 0.7, nHi.r + mk.b * 0.4);
    float grassW = smoothstep(0.35, 0.7, mc.r + (nMid.g - 0.5) * 0.25) * (1.0 - rockW);
    float edgeNoise = (nHi.r - 0.5) * 0.3 + (nMid.r - 0.5) * 0.2;
    float trailW = smoothstep(0.52 + edgeNoise, 0.78 + edgeNoise, vCover);
    float streamW = smoothstep(0.35, 0.8, vStream) * (1.0 - steep * 0.9);           // (a steep wall beside a stream is mossy rock, not gravel: the pool walls of the Schiessentuempel)
    float bankW = smoothstep(0.02, 0.3, vStream) * (1.0 - streamW);

    vec3 albedo = litter;
    albedo = mix(albedo, mossC, mossW * 0.9);
    albedo = mix(albedo, grassC, grassW);
    albedo = mix(albedo, mix(rockC, mossC * vec3(0.78, 0.92, 0.7), rockMoss * (1.0 - steep * 0.55)), rockW);
    albedo = mix(albedo, mossC * vec3(0.9, 1.0, 0.85), clamp(ledgeMoss, 0.0, 1.0) * 0.8 * (1.0 - trailW));
    // seen from afar the forest is its canopy, not its floor
    float farK = smoothstep(uTreeRadius * 0.55, uTreeRadius * 1.5, vDist) * mk.r * (1.0 - rockW * 0.8) * (1.0 - grassW);
    vec3 canopyC = mix(vec3(0.19, 0.31, 0.14), vec3(0.34, 0.46, 0.2), smoothstep(0.3, 0.8, nMid.g * 0.6 + nHi.b * 0.5));
    canopyC = mix(canopyC, vec3(0.36, 0.34, 0.14), smoothstep(0.78, 0.92, nLo.g) * 0.55);
    canopyC = mix(canopyC, mix(vec3(0.82, 0.55, 0.14), vec3(0.62, 0.26, 0.08), nMid.b), uSeason * smoothstep(0.25, 0.6, nLo.b + nHi.g * 0.3) * 0.85);
    albedo = mix(albedo, canopyC * (0.8 + 0.4 * texture2D(uMoss, Q * 0.2).g), farK);
    trailW *= 1.0 - smoothstep(110.0, 260.0, vDist);
    albedo = mix(albedo, dirtC * (1.0 - 0.32 * uWet), trailW);
    albedo = mix(albedo, vec3(0.6, 0.58, 0.54) * (0.8 + 0.4 * nHi.g), smoothstep(0.4, 0.8, mc.g));
    albedo = mix(albedo, mossC * vec3(0.55, 0.7, 0.55), smoothstep(0.4, 0.8, mc.b));        // mapped ponds: dark wet mud and moss (no blue paint on the slopes)
    // stream channel: dark wet gravel and stones on the bed, mossy banks
    vec3 bedC = mix(dirtC * vec3(0.55, 0.55, 0.5), rockC * 0.62, smoothstep(0.35, 0.7, nHi.g));
    albedo = mix(albedo, mossC * vec3(0.85, 1.0, 0.8), bankW * 0.75);
    albedo = mix(albedo, bedC * 0.78, streamW);
    // hedgerows: dense dark green on the marked field borders (the bushes stand on it)
    float hedge = step(0.5, mf.b);
    albedo = mix(albedo, vec3(0.2, 0.33, 0.14) * (0.8 + 0.4 * nHi.g), hedge * 0.55 * near);
    albedo *= 1.0 - 0.28 * uWet * (1.0 - trailW);

    // ---- rain: puddles on the flat ground and the trail (dark, reflecting the sky)
    float puddle = 0.0;
    #ifndef LOW
      float pn = texture2D(uNoise, P * 0.21).g * 0.6 + texture2D(uNoise, P * 0.63 + 0.2).b * 0.4;
      puddle = uWet * smoothstep(0.5, 0.66, pn + trailW * 0.1) * smoothstep(0.93, 0.99, N.y) * (0.45 + 0.55 * trailW) * (1.0 - streamW) * (1.0 - rockW) * (1.0 - grassW * 0.7) * near;
      albedo = mix(albedo, albedo * 0.45, puddle);
      N = normalize(mix(N, vec3(0.0, 1.0, 0.0), puddle));
    #endif

    // ---- light: cloud shadows drift over the land, forest light is dappled
    vec2 cw = P * 0.0019 + uWind * uTime * 0.0012;
    float cloudShadow = mix(1.0, smoothstep(0.38, 0.7, texture2D(uNoise, cw).b) * 0.55 + 0.45, uCloud * 0.8);
    float forest = mk.r * (1.0 - trailW * 0.8);
    float dapple = 0.0;
    #ifdef LOW
      dapple = smoothstep(0.46, 0.62, texture2D(uNoise, P * 0.21 + uWind * uTime * 0.004).g);
    #else
      dapple = smoothstep(0.46, 0.62, texture2D(uNoise, P * 0.21 + uWind * uTime * 0.004).g * 0.6 + texture2D(uNoise, P * 0.55 - uWind * uTime * 0.006).b * 0.4);
    #endif
    float sunY = clamp(uSunDir.y, 0.0, 1.0);
    float openSun = mix(1.0, dapple * (0.45 + 0.75 * sunY), forest);
    #ifdef LOW
      float sunMul = openSun;
    #else
      float sunMul = cloudShadow * openSun;
    #endif
    float shade = mix(1.0, 0.95, forest) * (0.8 + 0.2 * smoothstep(0.1, 0.9, N.y));
    vec3 col = paintLightW(albedo, N, sunMul, shade, vWorld);
    // puddle sheen: the sky and the sun in the water
    if (puddle > 0.01) {
      vec3 V = normalize(cameraPosition - vWorld);
      float fr = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
      col = mix(col, uFogColor * 0.9, puddle * (0.25 + 0.55 * fr));
    }
    col = pow(col, vec3(0.97));
    col = applyFogW(col, vDist, vWorld.y);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createGroundMaterial(THREE, env, textures, worldMaps, worldSize, cheap = false) {
  const uniforms = {
    ...env.uniforms,
    uLitter: { value: textures.litter }, uMoss: { value: textures.moss }, uDirt: { value: textures.dirt }, uRock: { value: textures.sandstone },
    uTreeRadius: { value: 150 }, uMapCover: { value: worldMaps.cover }, uMapCanopy: { value: worldMaps.canopy }, uMapField: { value: worldMaps.field },
    uWorldSize: { value: new THREE.Vector2(worldSize.width, worldSize.depth) },
  };
  return new THREE.ShaderMaterial({ uniforms, vertexShader: GROUND_VERTEX, fragmentShader: (cheap ? '#define LOW\n' : '') + GROUND_FRAGMENT, side: THREE.FrontSide });
}
