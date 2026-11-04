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
  attribute vec4 aRoad3;       // the signed distance to the union of the carriageways, to the union of the pavements, the fade of the paint
  varying vec3 vWorld; varying vec3 vNormal; varying float vDist;
  varying vec4 vRoad; varying vec4 vRoad2; varying vec4 vRoad3;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz; vNormal = normal; vRoad = aRoad; vRoad2 = aRoad2; vRoad3 = aRoad3;
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
  uniform float uTreeRadius;
  varying vec3 vWorld; varying vec3 vNormal; varying float vDist;
  varying vec4 vRoad; varying vec4 vRoad2; varying vec4 vRoad3;
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
    vec3 pave = texture2D(uPavement, P * 0.46).rgb;
    vec3 grav = texture2D(uGravel, P * 0.55).rgb;
    // the meadow: a calm olive green (the colour of the MTB meadow), not a bright lawn
    vec3 meadow = gTex * vec3(0.70, 0.86, 0.52) * (0.90 + 0.20 * nMid.g);
    vec3 wood = lTex * vec3(0.92, 0.94, 0.78) * (0.82 + 0.30 * nLo.g);        // the forest floor: the leaf litter
    // the wood seen from afar is its canopy, not its floor (the MTB paints it the same way)
    vec3 canopy = mix(vec3(0.19, 0.31, 0.14), vec3(0.32, 0.44, 0.19), smoothstep(0.3, 0.8, nLo.g * 0.6 + nMid.b * 0.5));
    // the ground between the houses: HARD ground (gravel and slabs), never a lawn
    vec3 city = mix(grav * 0.74, pave * 0.60, 0.35) * (0.88 + 0.16 * nMid.r);
    // the farmland: painted parcels of crops (young wheat, ripe grain, ploughed earth, rape, stubble).  The parcel is a slow
    // noise cut into bands, so it reads as a patchwork of fields from above and never as one grey-brown wash.
    float lum = dot(gTex, vec3(0.30, 0.59, 0.11));
    float detail = clamp(0.90 + 0.26 * (lum / 0.45 - 1.0), 0.72, 1.18);
    float parcel = texture2D(uNoise, P * 0.0021 + 0.11).r * 4.999;
    float pid = floor(parcel);
    float pmix = smoothstep(0.90, 1.0, fract(parcel));
    vec3 crop0 = pid < 0.5 ? vec3(0.40, 0.57, 0.22) : pid < 1.5 ? vec3(0.73, 0.65, 0.31) : pid < 2.5 ? vec3(0.49, 0.37, 0.25) : pid < 3.5 ? vec3(0.55, 0.67, 0.28) : vec3(0.67, 0.59, 0.37);
    float pid1 = min(pid + 1.0, 4.0);
    vec3 crop1 = pid1 < 0.5 ? vec3(0.40, 0.57, 0.22) : pid1 < 1.5 ? vec3(0.73, 0.65, 0.31) : pid1 < 2.5 ? vec3(0.49, 0.37, 0.25) : pid1 < 3.5 ? vec3(0.55, 0.67, 0.28) : vec3(0.67, 0.59, 0.37);
    vec3 field = mix(crop0, crop1, pmix) * detail * (0.94 + 0.12 * nMid.b);
    // the rows of the fields, along a direction that turns slowly with the land (the ploughed earth shows them strongest)
    float ang = nLo.a * 6.28318;
    vec2 dir = vec2(cos(ang), sin(ang));
    float row = sin(dot(P, dir) * 1.1) * 0.5 + 0.5;
    float plough = pid < 2.5 && pid > 1.5 ? 1.0 : 0.0;
    field *= 1.0 - (0.05 + 0.10 * plough) * (1.0 - row) * near;
    vec3 water = vec3(0.20, 0.30, 0.36) * (0.9 + 0.2 * nMid.b);
    water += vec3(0.10, 0.13, 0.14) * (sin(P.x * 0.9 + uTime * 0.6) * sin(P.y * 0.7 - uTime * 0.4) * 0.5 + 0.5) * near;

    float open = cls.r, forest = cls.g, urban = cls.b, wetWater = cls.a;
    float farm = can.a, park = can.b;
    vec3 albedo = meadow;
    albedo = mix(albedo, meadow * vec3(1.06, 1.16, 0.84), park * 0.8);        // the parks are mown and brighter
    albedo = mix(albedo, field, farm);
    albedo = mix(albedo, wood, forest);
    albedo = mix(albedo, city, urban);
    albedo = mix(albedo, water, wetWater);
    // The trees of the view only reach so far: beyond them the wood is its canopy.  Without this the forest is a
    // brown litter floor under green blobs, and the land reads as a blotch of brown patches.
    float farK = smoothstep(uTreeRadius * 0.62, uTreeRadius * 1.05, vDist) * forest * (1.0 - urban);
    albedo = mix(albedo, canopy * (0.85 + 0.30 * nLo.g), farK);

    // ---- the road: the tarmac, the kerb, the pavement and the markings
    float lat = vRoad.x, hw = vRoad.y, a0 = vRoad.z, s = vRoad.w;
    float lines = vRoad2.y, surface = vRoad2.z, mark = vRoad2.w;
    float al = abs(lat);
    // The edges of the paint are the zero of the signed distance to the UNION of the carriageways / pavements (aRoad3):
    // the lattice interpolates a continuous distance into a straight edge of constant width, per pixel.  The offset of
    // the one nearest road (lat, hw) is only for the markings.  The edge is one pixel wide (fwidth), never a staircase.
    float sdC = vRoad3.x, sdP = vRoad3.y;
    float roadW = smoothstep(0.0, 0.5, vRoad3.z);
    float aaC = max(fwidth(sdC), 0.04), aaP = max(fwidth(sdP), 0.04);
    vec3 tar = texture2D(uAsphalt, P * 0.33).rgb;
    vec3 cob = texture2D(uCobble, P * 0.40).rgb;
    // the paved stone of the squares: the slow noise breaks the tiling up, a square is a calm surface
    vec3 stn = texture2D(uStone, P * 0.30).rgb * (0.93 + 0.14 * nLo.g);
    // the material of the way the node is on: 0 tarmac, 1 cobbles, 2 concrete, 3 gravel, 4 earth, 5 paved stone
    vec3 surf = surface < 0.5 ? tar : surface < 1.5 ? cob : surface < 2.5 ? pave : surface < 4.5 ? grav : stn;
    // the kerb belongs to the materials that have one (the tarmac, the cobbles, the concrete)
    float kerbW = (surface < 2.5) ? uKerbWidth : 0.0;
    float onCarriage = 1.0 - smoothstep(-aaC, aaC, sdC);
    float onKerb = smoothstep(-aaC, aaC, sdC) * (1.0 - smoothstep(kerbW - aaC, kerbW + aaC, sdC));
    float onPave = smoothstep(kerbW - aaC, kerbW + aaC, sdC) * (1.0 - smoothstep(-aaP, aaP, sdP));
    // the lane markings: a dashed centre line (3 m of paint every 9 m), the edge lines of the big roads.
    // A paved area (a square, a footpath) carries NO markings: the paint of a square would make it a street.
    // The markings are cut before a junction (mark is 0 there): a dash that ends in the crossing street is a fragment.
    float markOn = smoothstep(0.5, 0.9, mark);
    float dash = (lines > 0.5 && lines < 1.5) ? step(fract(s / 9.0), 0.34) : 1.0;
    float centre = (1.0 - smoothstep(0.05, 0.11, al)) * dash * step(0.5, lines) * step(lines, 2.5);
    float edge = (lines > 0.5 && lines < 2.5 && hw > 4.0) ? (1.0 - smoothstep(0.05, 0.11, abs(al - (hw - 0.5)))) : 0.0;
    float paint = clamp(centre + edge, 0.0, 1.0) * onCarriage * markOn * near;

    albedo = mix(albedo, surf, roadW * onCarriage);
    albedo = mix(albedo, pave * 0.80, roadW * onKerb);                        // the kerb stone is darker than the slabs
    albedo = mix(albedo, pave * 0.82, roadW * onPave);
    albedo = mix(albedo, vec3(0.84, 0.83, 0.76), paint * roadW);

    // ---- the weather: the rain darkens the tarmac and the ground
    float onRoadAny = roadW * max(onCarriage, max(onKerb, onPave));
    float wetness = uWet * (0.55 + 0.45 * onRoadAny);
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
      col = mix(col, uFogColor * 0.95, wetness * (0.12 + 0.4 * fr) * onRoadAny);
    }
    col = applyFogW(col, vDist, vWorld.y);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createGroundMaterial(THREE, env, textures, worldMaps, worldSize, cheap = false, treeRadius = 150) {
  const uniforms = {
    ...env.uniforms,
    uAsphalt: { value: textures.asphalt }, uPavement: { value: textures.pavement }, uCobble: { value: textures.cobble },
    uGravel: { value: textures.gravel }, uStone: { value: textures.stone },
    uGround: { value: textures.ground }, uLitter: { value: textures.litter },
    uNoise: { value: textures.noise }, uClass: { value: worldMaps.class }, uCanopy: { value: worldMaps.canopy },
    uKerbWidth: { value: ROAD.kerbWidth },
    uTreeRadius: { value: treeRadius },
    uWorldSize: { value: new THREE.Vector2(worldSize.width, worldSize.depth) },
  };
  return new THREE.ShaderMaterial({ uniforms, vertexShader: GROUND_VERTEX, fragmentShader: (cheap ? '#define LOW\n' : '') + GROUND_FRAGMENT, side: THREE.FrontSide });
}
