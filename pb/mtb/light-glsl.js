/* The shared painted lighting, written once as a GLSL chunk that every material includes (ground, trees, rocks, water, rider, effects):
 *   - gouache sun (soft bands, shoulder instead of clipping), sky / ground ambient;
 *   - the rider's bike lamp (a spot cone + a warm glow around the rider, on at dusk and at night);
 *   - fog: distance fog plus a HEIGHT fog that pools in the valleys (mist layering through the trees).
 * The chunk declares the uniforms every material shares (they all come from env.js), so a material must NOT declare them again. */
export const COMMON_UNIFORMS_GLSL = `
  uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround, uFogColor, uLampPos, uLampDir, uLampColor;
  uniform float uFogDensity, uFogBase, uFogHD, uFogHF, uLampOn, uWet, uCloud, uSeason, uNight, uTime, uRain;
`;

export const PAINT_LIGHT_GLSL = `
  ${COMMON_UNIFORMS_GLSL}
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
  // the rider's lamp: a spot cone along the bars plus a soft warm glow around the rider
  vec3 lampLight(vec3 P, vec3 N){
    if (uLampOn < 0.01) return vec3(0.0);
    vec3 d = uLampPos - P;
    float dist = length(d);
    vec3 L = d / max(dist, 0.001);
    float cone = dot(-L, normalize(uLampDir));
    float spot = smoothstep(0.80, 0.955, cone);
    float atten = 1.0 / (1.0 + 0.012 * dist * dist);
    float ndl = clamp(dot(N, L) * 0.75 + 0.25, 0.0, 1.0);
    float glow = 0.22 / (1.0 + 0.5 * dist * dist);
    return uLampColor * uLampOn * (spot * atten * 2.4 * ndl + glow);
  }
  vec3 paintLightW(vec3 albedo, vec3 N, float sunMul, float shade, vec3 P){
    return paintLight(albedo, N, sunMul, shade) + albedo * lampLight(P, N);
  }
  // bump mapping from the luminance of the painted albedo (screen-space derivatives: no height map files). lum = luminance at this texel, k = strength.
  vec3 bumpNormal(vec3 N, vec3 P, float lum, float k){
    vec3 dpx = dFdx(P), dpy = dFdy(P);
    float dlx = dFdx(lum), dly = dFdy(lum);
    vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
    float det = dot(dpx, r1);
    vec3 grad = sign(det) * (dlx * r1 + dly * r2);
    return normalize(abs(det) * N - k * grad);
  }
  vec3 applyFog(vec3 col, float dist){
    float f = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
    return mix(col, uFogColor, clamp(f, 0.0, 1.0));
  }
  // distance fog + height fog (denser low in the valley than up on the rim), along the ray from the camera to the point
  vec3 applyFogW(vec3 col, float dist, float worldY){
    float f = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
    float yMid = 0.5 * (cameraPosition.y + worldY) - uFogBase;
    float hf = 1.0 - exp(-dist * uFogHD * exp(-max(yMid, 0.0) * uFogHF));
    return mix(col, uFogColor, clamp(max(f, hf), 0.0, 1.0));
  }
`;
