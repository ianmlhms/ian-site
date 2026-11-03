/* The painted ground of Lux Drive: one shader for every terrain tile.  The road is not a mesh that lies on the ground:
 * the ground IS the road (the height function carves it in), and this shader only paints it - the tarmac, the kerb, the
 * pavement, the lane markings - over the land cover of the place.
 *
 * No photographs: the colours come from hand-drawn canvas textures (tarmac, slabs, cobbles, gravel, grass, leaf litter)
 * and from the land classes of the bake (meadow, forest, city, farmland, water), lit with the shared painted lighting
 * (soft banded gouache shading, drifting cloud shadows, the fog of the valleys). */
import { PAINT_LIGHT_GLSL } from './light-glsl.js';
import { ROAD } from './config.js';

export { PAINT_LIGHT_GLSL };

export const GROUND_VERTEX = `
  attribute vec4 aRoad;        // the offset from the centre line, the half width of the carriageway, the outer edge of the pavement, the distance along the centre line
  attribute vec4 aRoad2;       // the coverage of the road, the style of the markings, its material, how exactly the fine markings are drawn
  varying vec3 vWorld; varying vec3 vNormal; varying float vDist;
  varying vec4 vRoad; varying vec4 vRoad2;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz; vNormal = normal; vRoad = aRoad; vRoad2 = aRoad2;
    vec4 mv = viewMatrix * wp;
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

export const GROUND_FRAGMENT = `
  precision highp float;
  uniform sampler2D uAsphalt, uPavement, uCobble, uGravel, uStone, uGround, uLitter, uNoise, uClass, uCanopy;
  uniform vec2 uWorldSize;
  uniform vec2 uWind;
  uniform float uKerbWidth;
  varying vec3 vWorld; varying vec3 vNormal; varying float vDist;
  varying vec4 vRoad; varying vec4 vRoad2;
  ${PAINT_LIGHT_GLSL}

  void main(){
    vec3 N = normalize(vNormal);
    vec2 P = vWorld.xz;
    vec2 uv = clamp((P + 4.0) / uWorldSize, 0.0, 1.0);
    vec4 cls = texture2D(uClass, uv);          // R the open land, G the forest, B the city, A the water
    // the canopy grid is 16 m, the class grid 8 m: the half-texel offset puts the samples on the nodes
    vec4 can = texture2D(uCanopy, clamp((P + 8.0) / uWorldSize, 0.0, 1.0));    // R the canopy cover, G its height, B the parks, A the farmland
    vec4 nLo = texture2D(uNoise, P * 0.0063);
    vec4 nMid = texture2D(uNoise, P * 0.031 + 0.37);
    float near = 1.0 - smoothstep(160.0, 620.0, vDist);

    // ---- the land: the painted ground, tinted by the class of the place
    vec3 gTex = texture2D(uGround, P * 0.085).rgb;
    vec3 lTex = texture2D(uLitter, P * 0.13).rgb;
    vec3 meadow = gTex * vec3(0.70, 0.96, 0.55) * (0.88 + 0.24 * nMid.g);
    vec3 wood = lTex * vec3(0.92, 0.94, 0.78) * (0.82 + 0.30 * nLo.g);        // the forest floor: the leaf litter
    vec3 city = gTex * vec3(0.72, 0.70, 0.66) * (0.86 + 0.26 * nMid.r);       // the ground between the houses
    vec3 field = gTex * vec3(1.18, 1.06, 0.66) * (0.86 + 0.28 * nLo.b);       // the farmland: the crops
    // the rows of the fields, along a direction that turns slowly with the land
    float ang = nLo.a * 6.28318;
    vec2 dir = vec2(cos(ang), sin(ang));
    float row = sin(dot(P, dir) * 1.1) * 0.5 + 0.5;
    field *= 0.93 + 0.12 * row * near;
    vec3 water = vec3(0.20, 0.30, 0.36) * (0.9 + 0.2 * nMid.b);
    water += vec3(0.10, 0.13, 0.14) * (sin(P.x * 0.9 + uTime * 0.6) * sin(P.y * 0.7 - uTime * 0.4) * 0.5 + 0.5) * near;

    float open = cls.r, forest = cls.g, urban = cls.b, wetWater = cls.a;
    float farm = can.a, park = can.b;
    vec3 albedo = meadow;
    albedo = mix(albedo, meadow * vec3(1.08, 1.22, 0.86), park * 0.8);        // the parks are mown and brighter
    albedo = mix(albedo, field, farm);
    albedo = mix(albedo, wood, forest);
    albedo = mix(albedo, city, urban);
    albedo = mix(albedo, water, wetWater);

    // ---- the road: the tarmac, the kerb, the pavement and the markings
    float cov = vRoad2.x;
    float lat = vRoad.x, hw = vRoad.y, a0 = vRoad.z, s = vRoad.w;
    float lines = vRoad2.y, surface = vRoad2.z, mark = vRoad2.w;
    float al = abs(lat);
    float roadW = smoothstep(0.30, 0.62, cov);
    vec3 tar = texture2D(uAsphalt, P * 0.33).rgb;
    vec3 pave = texture2D(uPavement, P * 0.46).rgb;
    vec3 cob = texture2D(uCobble, P * 0.40).rgb;
    vec3 grav = texture2D(uGravel, P * 0.55).rgb;
    // the paved stone of the squares: the slow noise breaks the tiling up, a square is a calm surface
    vec3 stn = texture2D(uStone, P * 0.30).rgb * (0.93 + 0.14 * nLo.g);
    // the material of the way the node is on: 0 tarmac, 1 cobbles, 2 concrete, 3 gravel, 4 earth, 5 paved stone
    vec3 surf = surface < 0.5 ? tar : surface < 1.5 ? cob : surface < 2.5 ? pave : surface < 4.5 ? grav : stn;
    // the kerb belongs to the materials that have one (the tarmac, the cobbles, the concrete)
    float kerbW = (surface < 2.5) ? uKerbWidth : 0.0;
    float onCarriage = 1.0 - smoothstep(hw - 0.05, hw + 0.05, al);
    float onKerb = smoothstep(hw - 0.02, hw + 0.04, al) * (1.0 - smoothstep(hw + kerbW - 0.02, hw + kerbW + 0.04, al));
    float onPave = smoothstep(hw + kerbW - 0.02, hw + kerbW + 0.04, al) * (1.0 - smoothstep(a0 - 0.06, a0 + 0.06, al));
    // the lane markings: a dashed centre line (3 m of paint every 9 m), the edge lines of the big roads
    float dash = (lines > 0.5 && lines < 1.5) ? step(fract(s / 9.0), 0.34) : 1.0;
    float centre = (1.0 - smoothstep(0.05, 0.11, al)) * dash * step(0.5, lines);
    float edge = (lines > 0.5 && hw > 4.0) ? (1.0 - smoothstep(0.05, 0.11, abs(al - (hw - 0.5)))) : 0.0;
    float paint = clamp(centre + edge, 0.0, 1.0) * onCarriage * mark * near;

    albedo = mix(albedo, surf, roadW * onCarriage);
    albedo = mix(albedo, pave * 0.86, roadW * onKerb);                        // the kerb stone is darker than the slabs
    albedo = mix(albedo, pave, roadW * onPave);
    albedo = mix(albedo, vec3(0.84, 0.83, 0.76), paint * roadW);

    // ---- the weather: the rain darkens the tarmac and the ground
    float wetness = uWet * (0.55 + 0.45 * roadW);
    albedo *= 1.0 - 0.30 * wetness;

    // ---- light: the clouds drift over the land
    vec2 cw = P * 0.0019 + uWind * uTime * 0.0012;
    float cloudShadow = mix(1.0, smoothstep(0.38, 0.7, texture2D(uNoise, cw).b) * 0.55 + 0.45, uCloud * 0.8);
    float shade = 0.82 + 0.18 * smoothstep(0.1, 0.9, N.y);
    vec3 col = paintLightW(albedo, N, cloudShadow, shade, vWorld);
    // the wet tarmac holds the sky
    if (wetness > 0.02) {
      vec3 V = normalize(cameraPosition - vWorld);
      float fr = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
      col = mix(col, uFogColor * 0.95, wetness * (0.12 + 0.4 * fr) * roadW);
    }
    col = applyFogW(col, vDist, vWorld.y);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createGroundMaterial(THREE, env, textures, worldMaps, worldSize, cheap = false) {
  const uniforms = {
    ...env.uniforms,
    uAsphalt: { value: textures.asphalt }, uPavement: { value: textures.pavement }, uCobble: { value: textures.cobble },
    uGravel: { value: textures.gravel }, uStone: { value: textures.stone },
    uGround: { value: textures.ground }, uLitter: { value: textures.litter },
    uNoise: { value: textures.noise }, uClass: { value: worldMaps.class }, uCanopy: { value: worldMaps.canopy },
    uKerbWidth: { value: ROAD.kerbWidth },
    uWorldSize: { value: new THREE.Vector2(worldSize.width, worldSize.depth) },
  };
  return new THREE.ShaderMaterial({ uniforms, vertexShader: GROUND_VERTEX, fragmentShader: (cheap ? '#define LOW\n' : '') + GROUND_FRAGMENT, side: THREE.FrontSide });
}
