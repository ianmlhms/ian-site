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
  float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

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
    vec3 city = mix(grav * 0.86, pave * 0.78, 0.45) * (0.94 + 0.08 * nMid.r);
    // the farmland: painted parcels of crops (young wheat, ripe grain, ploughed earth, rape, stubble).  The parcel is a slow
    // noise cut into bands, so it reads as a patchwork of fields from above and never as one grey-brown wash.
    float lum = dot(gTex, vec3(0.30, 0.59, 0.11));
    float detail = clamp(0.90 + 0.26 * (lum / 0.45 - 1.0), 0.72, 1.18);
    // the parcels: rectangles of 70-120 m, turned by a different angle in every kilometre block, each with its own crop
    vec2 blk = floor(P / 900.0);
    float ba = hash21(blk) * 3.14159;
    vec2 R = vec2(cos(ba) * P.x + sin(ba) * P.y, -sin(ba) * P.x + cos(ba) * P.y);
    vec2 cellSize = vec2(78.0, 128.0) * (0.8 + 0.5 * hash21(blk + 3.1));
    vec2 cellF = R / cellSize;
    vec2 cid = floor(cellF);
    float pick = hash21(cid + blk * 17.0);
    float pid = floor(pick * 4.999);
    vec3 crop = pid < 0.5 ? vec3(0.44, 0.58, 0.26) : pid < 1.5 ? vec3(0.80, 0.68, 0.26) : pid < 2.5 ? vec3(0.55, 0.40, 0.27) : pid < 3.5 ? vec3(0.52, 0.66, 0.26) : vec3(0.72, 0.62, 0.32);
    vec3 field = crop * detail * (0.94 + 0.12 * nMid.b);
    // a hedge / grass strip along some of the borders of the parcels
    vec2 inCell = fract(cellF) * cellSize;
    float edgeD = min(min(inCell.x, cellSize.x - inCell.x), min(inCell.y, cellSize.y - inCell.y));
    float hedge = (1.0 - smoothstep(0.6, 1.8, edgeD)) * step(0.55, hash21(cid + 7.7)) * near;
    field = mix(field, vec3(0.30, 0.42, 0.20), hedge * 0.7);
    // the rows of the fields, along a direction that turns slowly with the land (the ploughed earth shows them strongest)
    float ang = nLo.a * 6.28318;
    vec2 dir = vec2(cos(ang), sin(ang));
    float row = sin(dot(P, dir) * 1.1) * 0.5 + 0.5;
    float plough = pid > 1.5 && pid < 2.5 ? 1.0 : 0.0;
    field *= 1.0 - (0.05 + 0.10 * plough) * (1.0 - row) * near;
    vec3 water = vec3(0.20, 0.30, 0.36) * (0.9 + 0.2 * nMid.b);
    water += vec3(0.10, 0.13, 0.14) * (sin(P.x * 0.9 + uTime * 0.6) * sin(P.y * 0.7 - uTime * 0.4) * 0.5 + 0.5) * near;

    float open = cls.r, forest = cls.g, urban = cls.b, wetWater = cls.a;
    float farm = can.a, park = can.b;
    vec3 albedo = meadow;
    albedo = mix(albedo, meadow * vec3(1.06, 1.16, 0.84), park * 0.8);        // the parks are mown and brighter
    // the parks: mown lawn, a slightly richer green with soft mowing stripes and large calm patches (no two lawns alike)
    float mow = sin(dot(P, vec2(0.66, 0.34)) * 1.55) * 0.5 + 0.5;
    albedo *= 1.0 + park * near * ((mow - 0.5) * 0.07 + (nLo.b - 0.5) * 0.10);
    albedo = mix(albedo, field, farm);
    albedo = mix(albedo, wood, forest);
    // The hard ground is a calm light grey-beige and it has a CLEAN border: the class weight is a blurred 24 m / 72 m cover, and mixed straight into the
    // lawn it made a wide smoky brown-grey penumbra beside every wall (the dark blotches).  The weight is sharpened to a band of a few metres.
    float urbanW = smoothstep(0.42, 0.62, urban);
    albedo = mix(albedo, city, urbanW);
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
    // the grain of the tarmac is a stone chip: from a distance it averages to the plain colour (from above the 3 m tile would show as a pattern), and a
    // very slow noise keeps a long road from being one flat grey
    vec3 tar = mix(texture2D(uAsphalt, P * 0.33).rgb, vec3(0.248, 0.252, 0.263), smoothstep(30.0, 110.0, vDist)) * (0.965 + 0.07 * nMid.g);
    vec3 cob = texture2D(uCobble, P * 0.40).rgb;
    // the paved stone of the squares: the slow noise breaks the tiling up, a square is a calm surface
    vec3 stn = texture2D(uStone, P * 0.30).rgb * (0.93 + 0.14 * nLo.g);
    // the material of the way the node is on: 0 tarmac, 1 cobbles, 2 concrete, 3 gravel, 4 earth, 5 paved stone
    vec3 surf = surface < 0.5 ? tar : surface < 1.5 ? cob : surface < 2.5 ? pave : surface < 4.5 ? grav : stn;
    // the kerb belongs to the materials that have one (the tarmac, the cobbles, the concrete)
    float kerbW = (surface < 2.5) ? uKerbWidth : 0.0;
    float onCarriage = 1.0 - smoothstep(-aaC, aaC, sdC);
    // The narrow service ways between the houses are tarmac of 3-5 m: their border is the zero of a distance interpolated on a 2-4 m lattice (angular), and the dark tar beside a pale wall
    // read as a blotch.  They get a soft border (a wider blend, so the angles round off) and a calmer, lighter grey.  Streets of 6 m and more are not touched.
    float minorW = (1.0 - smoothstep(2.4, 3.4, hw)) * step(surface, 0.5) * step(0.5, roadW);
    onCarriage = mix(onCarriage, 1.0 - smoothstep(-0.5, 0.5, sdC), minorW);
    surf = mix(surf, mix(surf, vec3(0.40, 0.40, 0.40) * (0.96 + 0.08 * nMid.g), 0.55), minorW);
    float onKerb = smoothstep(-aaC, aaC, sdC) * (1.0 - smoothstep(kerbW - aaC, kerbW + aaC, sdC));
    float onPave = smoothstep(kerbW - aaC, kerbW + aaC, sdC) * (1.0 - smoothstep(-aaP, aaP, sdP));
    // A kerb and a pavement lie on level ground: on a ramp steeper than 1.3 m/m (the foot of a retaining wall, a cutting beside a junction) the slab texture is a stretched
    // stripe with ragged teeth along the lattice, so the ramp keeps the paint of the land and only the carriageway stays painted.
    float levelK = smoothstep(0.30, 0.62, N.y);
    onKerb *= levelK; onPave *= levelK;
    // the lane markings: a dashed centre line (3 m of paint every 9 m), the edge lines of the big roads.
    // A paved area (a square, a footpath) carries NO markings: the paint of a square would make it a street.
    // The markings are cut before a junction (mark is 0 there): a dash that ends in the crossing street is a fragment.
    float markOn = smoothstep(0.5, 0.9, mark);
    float dash = (lines > 0.5 && lines < 1.5) ? step(fract(s / 9.0), 0.34) : 1.0;
    float centre = (1.0 - smoothstep(0.05, 0.11, al)) * dash * step(0.5, lines) * step(lines, 2.5);
    // Where two ways meet at a shallow angle the offset lat of the nearest way is interpolated between vertices that belong to DIFFERENT ways: its gradient is no longer 1 per metre
    // (a true offset from a centre line has a gradient of exactly 1) and the zero of lat wobbles.  The centre line fades out there: it ends cleanly instead of wobbling.
    vec2 Jx = dFdx(P), Jy = dFdy(P), sl = vec2(dFdx(lat), dFdy(lat));           // the world gradient of lat from its screen derivatives: M g = sl with the rows Jx, Jy of M
    float detJ = Jx.x * Jy.y - Jx.y * Jy.x;
    float latSlope = abs(detJ) > 1e-9 ? length(vec2(Jy.y * sl.x - Jx.y * sl.y, -Jy.x * sl.x + Jx.x * sl.y)) / abs(detJ) : 1.0;
    centre *= 1.0 - smoothstep(1.3, 1.9, latSlope);
    // The edge line is the contour sdC = -EDGE_INSET of the union of the carriageways, NOT the offset (lat, hw) of the nearest road: that offset
    // jumps where the nearest road changes, and the line broke into ragged pieces at bends, junctions and cuttings.  The contour of the union is
    // continuous: it follows the carriageway round a corner and never crosses the mouth of a side street.  The width is constant on screen
    // (fwidth), so the line stays one clean stroke from the driver's seat and from afar.
    float edgeGate = step(0.5, lines) * step(lines, 2.5) * smoothstep(3.6, 4.4, hw);
    float edgeHalf = max(0.07, aaC * 0.9);
    float edge = edgeGate * (1.0 - smoothstep(edgeHalf * 0.5, edgeHalf * 1.5, abs(sdC + 0.5)));
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
    // the shadow of a cloud is a soft 30 % dip, not the 55 % that read as dark blotches drifting over the lawns and the city
    float cloudShadow = mix(1.0, smoothstep(0.30, 0.78, texture2D(uNoise, cw).b) * 0.30 + 0.70, uCloud * 0.8);
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
