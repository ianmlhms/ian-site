/* The painted material of the buildings: everything is drawn in the fragment shader from the surface info of the
 * mesh (building-mesh.js): rendered walls with a grid of windows, shutters and a door (lit from inside at night),
 * slate and tile roofs in staggered rows, tar on the flat roofs, damp streaks low on the walls.  No picture files.
 *
 * The style of the façade comes from the bake (the OSM says what the building is for, the height says how big it is):
 * a house of the old town has shutters, small windows and a shop below; an office of Kirchberg has bands of glass
 * and the metal of the frame; a shed has nothing but a corrugated wall; a church is dressed stone.
 *
 * This is the MTB town material, cut down to the three surfaces the LOD2 buildings have and adapted to the
 * Luxembourgish palette. */
import { PAINT_LIGHT_GLSL } from './light-glsl.js';

const THREE = window.THREE;
const LITE_DETAIL = 0.5;            // uDetail at low quality: see the `rich` switch of the fragment shader

const VERTEX = `
  attribute vec3 color; attribute vec4 aInfo; attribute vec2 aGeo; attribute vec2 aStyle;
  varying vec3 vN; varying vec3 vC; varying vec3 vWorld; varying vec4 vInfo; varying vec2 vGeo; varying float vDist;
  varying vec2 vStyle;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal); vC = color; vWorld = wp.xyz; vInfo = aInfo; vGeo = aGeo; vStyle = aStyle;
    vec4 mv = viewMatrix * wp; vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAGMENT = `
  precision highp float;
  uniform float uDetail;                                           // 1 = everything, 0.5 = LITE (low quality): windows and doors, no shutters / sills / lintels / bars / rails
  uniform sampler2D uNoise;
  varying vec3 vN; varying vec3 vC; varying vec3 vWorld; varying vec4 vInfo; varying vec2 vGeo; varying float vDist;
  varying vec2 vStyle;
  ${PAINT_LIGHT_GLSL}
  float h1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
  float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main(){
    vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
    vec3 P = vWorld;
    float kind = vInfo.z, seed = vInfo.w;
    float rich = step(0.75, uDetail);                               // the small parts that cost fragment time: only at medium and high quality
    vec2 gp = vInfo.xy * 0.5 + seed * 13.0;                         // the noise in the surface's own coordinates (no stretched streaks on the walls)
    float grain = texture2D(uNoise, gp).g;
    float grain2 = texture2D(uNoise, gp * 0.21 + 0.3).b;
    vec3 albedo = vC;
    float glow = 0.0;
    // the style of the façade: the kind and the bit "there is a shop on the ground floor"
    float style = mod(vStyle.x, 8.0);
    float shop = step(0.5, vStyle.x - style);
    float levels = max(1.0, vStyle.y);
    bool isHouse = style < 0.5;                                     // the shutters and the door belong to the houses
    bool isOffice = style > 1.5 && style < 2.5;                     // an office: a stone base and bands of glass
    bool isModern = style > 3.5 && style < 4.5;                     // a tower: glass from the ground up
    bool isShed = style > 2.5 && style < 3.5;                       // a shed: a corrugated metal wall
    bool isStone = style > 4.5 && style < 5.5;                      // a church: dressed stone
    bool isTown = style > 5.5;                                      // the 19th-century stone façade of the old town and the stone city
    if (kind < 0.5) {                                              // the wall
      float len = max(vGeo.x, 0.5), eave = vGeo.y, v = vInfo.y;
      if (isOffice || isModern) {
        // A modern façade: the glass between the stone spandrels, the mullions of the metal frame.
        // The height of the band is the height of the storey, so the tower is striped by its own floors.
        float bandH = eave / levels;
        float bi = floor(v / bandH);
        float bf = fract(v / bandH);
        float base = isOffice ? step(3.6, v) : 1.0;                 // an office on a street stands on stone
        float glass = step(0.18, bf) * step(bf, 0.84) * base;
        float mu = abs(fract(vInfo.x / 1.7) - 0.5) * 1.7;
        float mull = (1.0 - smoothstep(0.05, 0.10, mu)) * glass;
        float frame = (1.0 - smoothstep(0.02, 0.06, min(bf - 0.18, 0.84 - bf))) * glass;
        vec3 sky = vec3(0.38, 0.48, 0.56);
        vec3 glassCol = mix(sky * 0.70, sky * 1.12, h2(vec2(floor(vInfo.x / 1.7) + bi * 7.0, seed * 23.0)));
        albedo = mix(albedo, glassCol, glass * 0.9);
        albedo = mix(albedo, vec3(0.36, 0.38, 0.40), clamp(mull + frame, 0.0, 1.0));
        albedo *= 0.94 + 0.10 * grain;
        // the offices are lit at night, one window here and there
        glow = glass * step(0.88, h2(vec2(floor(vInfo.x / 1.7), bi * 3.0 + seed * 31.0))) * (1.0 - mull - frame) * 0.6;
      } else if (isShed) {
        // A shed: a corrugated metal wall and a strip of high windows.
        float corr = 0.5 + 0.5 * sin(vInfo.x * 9.0);
        albedo *= 0.88 + 0.16 * corr;
        float strip = step(2.8, v) * step(v, 3.8) * step(0.25, fract(vInfo.x / 3.2));
        albedo = mix(albedo, vec3(0.32, 0.40, 0.45), strip * 0.75);
        albedo = mix(albedo, albedo * vec3(0.8, 0.78, 0.76), 1.0 - smoothstep(0.0, 1.2, v));
      } else if (isStone) {
        // A church: dressed stone with tall narrow windows between the buttresses.
        albedo *= 0.94 + 0.12 * grain;
        float bay = 3.2;
        float dx = abs(fract(vInfo.x / bay) - 0.5) * bay;
        float head = 4.4 - dx * dx * 1.6;                          // the round head of the window
        float win = step(dx, 0.42) * step(1.6, v) * step(v, min(head, eave - 0.8));
        albedo = mix(albedo, vec3(0.10, 0.13, 0.16), win * 0.85);
        albedo = mix(albedo, albedo * 0.84, step(dx, 0.24) * 0.6);  // the buttress between the bays
      } else if (isTown) {
        // The stone façade of the 19th / early 20th century: a rusticated ground floor (or a shopfront), tall windows with stone
        // frames, a lintel and a sill, a string course between the floors, a wrought-iron rail on the first floor, a cornice.
        albedo *= 0.94 + 0.12 * grain;
        albedo *= 1.0 - 0.16 * smoothstep(0.55, 0.9, grain2) * (1.0 - smoothstep(0.0, 4.0, v));      // the damp streaks low on the wall
        float floors = max(1.0, floor(eave / 3.4 + 0.5));
        float fh = eave / floors;                                    // the real floor height of this wall
        float row = floor(v / fh), ly = v - row * fh;                // the floor and the height inside it
        vec3 stoneCol = clamp(albedo * 1.07 + vec3(0.035), 0.0, 1.0);                                  // the dressed stone of frames and bands
        float cornice = step(eave - 0.55, v);
        float cornShadow = step(eave - 0.95, v) * (1.0 - cornice);
        float course = step(ly, 0.13) * step(0.5, row) * (1.0 - cornice);                             // the string course
        albedo = mix(albedo, stoneCol, clamp(cornice + course, 0.0, 1.0));
        albedo *= 1.0 - 0.2 * cornShadow;
        albedo = mix(albedo, albedo * vec3(0.8, 0.78, 0.76), 1.0 - smoothstep(0.2, 0.7, v));          // the plinth
        if (uDetail > 0.25 && eave > 2.2 && vDist < 140.0) {
          float cells = max(1.0, floor(len / 2.6 + 0.5)), cw = len / cells;
          float cu = vInfo.x / cw, fi = floor(cu), dx = (fract(cu) - 0.5) * cw;
          float fx = abs(dx);
          float groundRow = step(row, 0.5);
          float shopFloor = shop * groundRow * step(0.25, v);
          float topRow = step(floors - 1.5, row);                                                    // the top floor under the cornice has lower windows
          float winH = mix(1.95, 1.55, topRow);
          float wy = ly - 0.5;                                                                        // the sill is half a metre over the floor
          float present = step(h2(vec2(fi + row * 5.0, seed * 17.0)), 0.97);
          float hasRow = step(0.0, row) * step(row, floors - 0.999) * step(0.3, v) * (1.0 - shopFloor) * present;
          float inner = step(fx, 0.5) * step(0.0, wy) * step(wy, winH);
          float surround = step(fx, 0.66) * step(-0.16, wy) * step(wy, winH + 0.22) * (1.0 - inner);
          float lintel = step(winH, wy) * step(wy, winH + 0.22) * step(fx, 0.72);
          albedo = mix(albedo, stoneCol, clamp(surround + lintel, 0.0, 1.0) * hasRow * rich);
          float bars = (step(abs(fx - 0.25), 0.02) + step(abs(wy - winH * 0.62), 0.03)) * rich;       // the glazing bars
          vec3 glass = mix(vec3(0.07, 0.1, 0.14), vec3(0.36, 0.46, 0.56), smoothstep(0.0, winH, wy));
          albedo = mix(albedo, mix(glass, vec3(0.88, 0.88, 0.84), clamp(bars, 0.0, 1.0) * 0.8), inner * hasRow);
          float lit = step(0.6, h2(vec2(fi + row * 3.0, seed * 7.0)));
          glow = inner * hasRow * lit * (1.0 - clamp(bars, 0.0, 1.0));
          // the wrought-iron rail of the first floor, in front of the tall windows
          float rail = step(abs(row - 1.0), 0.5) * step(0.32, wy) * step(wy, 0.95) * step(fx, 0.85) * hasRow * step(0.5, h1(seed * 19.0));
          float railBars = step(0.5, fract(vInfo.x * 5.0)) * 0.55 + step(abs(wy - 0.9), 0.04) * 0.6;
          albedo = mix(albedo, vec3(0.1, 0.11, 0.12), rail * clamp(railBars, 0.0, 1.0) * step(0.45, wy) * 0.85 * rich);
          // the ground floor: grooves of the rustication, a door, or the shopfront
          float groove = groundRow * step(abs(fract(v / 0.55) - 0.5), 0.02) * (1.0 - shopFloor);
          albedo *= 1.0 - 0.1 * groove;
          float doorCell = floor(mod(seed * 97.0, cells));
          float isDoor = groundRow * step(abs(fi - doorCell), 0.5) * (1.0 - shopFloor);
          float door = isDoor * step(fx, 0.6) * step(0.0, v) * step(v, 2.5);
          albedo = mix(albedo, mix(vec3(0.25, 0.16, 0.1), vec3(0.14, 0.22, 0.2), step(0.5, h1(seed * 53.0))), door * 0.95);
          albedo = mix(albedo, stoneCol, isDoor * step(fx, 0.75) * step(fx, 0.75) * step(2.5, v) * step(v, 2.75));
          if (shopFloor > 0.5) {
            float bay = 2.6;
            float bx = abs(fract(vInfo.x / bay) - 0.5) * bay;
            float pier = step(bx, 1.0);
            float riser = step(v, 0.7) * pier;
            float sign = step(3.0, v) * step(v, 3.45) * pier;
            albedo = mix(albedo, vec3(0.12, 0.16, 0.2), pier * step(0.8, v) * step(v, 3.0) * 0.92);
            albedo = mix(albedo, vec3(0.42, 0.4, 0.36), riser * 0.9);
            albedo = mix(albedo, mix(vec3(0.55, 0.2, 0.18), vec3(0.14, 0.3, 0.26), step(0.5, h1(seed * 71.0))), sign * 0.85);
            glow += pier * step(0.8, v) * step(v, 3.0) * step(0.55, h2(vec2(floor(vInfo.x / bay), seed * 41.0))) * 0.6;
          }
        }
      } else {
        // The house: a plinth, the windows, the shutters, the door.
        albedo *= 0.9 + 0.2 * grain;
        albedo = mix(albedo, albedo * vec3(0.6, 0.58, 0.56), 1.0 - smoothstep(0.3, 0.75, v));
        albedo *= 1.0 - 0.18 * smoothstep(0.55, 0.9, grain2) * (1.0 - smoothstep(0.0, 5.0, v));        // the damp streaks low on the wall
        if (uDetail > 0.25 && eave > 2.2 && vDist < 140.0) {
          float cells = max(1.0, floor(len / 2.7)), cw = len / cells;
          float cu = vInfo.x / cw, fi = floor(cu), dx = (fract(cu) - 0.5) * cw;
          float rowH = 2.75, row = floor((v - 0.05) / rowH), rows = floor((eave - 0.3) / rowH);
          float vc = (row + 0.5) * rowH + 0.35;
          float hasRow = step(0.0, row) * step(row, rows - 0.999);
          float present = step(h2(vec2(fi + row * 5.0, seed * 17.0)), 0.9);
          // The ground floor of a building with a business in it is a shop: no windows of the house, but a
          // shopfront with its window and its sign board.
          float shopFloor = shop * step(v, 3.4) * step(0.25, v);
          float doorCell = floor(mod(seed * 97.0, cells));
          float isDoor = step(row, 0.5) * step(abs(fi - doorCell), 0.5) * hasRow * (isHouse ? 1.0 : 0.0) * (1.0 - shopFloor);
          float fx = abs(dx), fy = abs(v - vc);
          float inner = step(fx, 0.42) * step(fy, 0.62), frame = step(fx, 0.52) * step(fy, 0.72) * (1.0 - inner);
          float shut = step(0.55, h2(vec2(fi * 3.0 + row, seed * 5.0))) * step(0.52, fx) * step(fx, 0.82) * step(fy, 0.72)
                     * (isHouse ? 1.0 : 0.0) * (1.0 - shopFloor) * rich;
          float on = hasRow * present * (1.0 - isDoor) * (1.0 - shopFloor);
          vec3 glass = mix(vec3(0.07, 0.1, 0.14), vec3(0.34, 0.44, 0.54), smoothstep(-0.6, 0.6, v - vc));
          vec3 shutterCol = mix(vec3(0.2, 0.36, 0.24), mix(vec3(0.42, 0.2, 0.16), vec3(0.3, 0.34, 0.4), step(0.5, h1(seed * 31.0))), step(0.45, h1(seed * 13.0)));
          float bars = (step(fx, 0.025) + step(fy, 0.025)) * rich;
          albedo = mix(albedo, vec3(0.93, 0.92, 0.88), frame * on);
          albedo = mix(albedo, shutterCol, shut * on);
          albedo = mix(albedo, mix(glass, vec3(0.9, 0.9, 0.86), clamp(bars, 0.0, 1.0)), inner * on);
          float lit = step(0.55, h2(vec2(fi + row * 3.0, seed * 7.0)));
          glow = inner * on * lit * (1.0 - clamp(bars, 0.0, 1.0));
          float door = isDoor * step(fx, 0.55) * step(0.0, v) * step(v, 2.15);
          albedo = mix(albedo, mix(vec3(0.34, 0.2, 0.12), vec3(0.2, 0.3, 0.22), step(0.5, h1(seed * 53.0))), door);
          albedo = mix(albedo, vec3(0.78, 0.76, 0.7), isDoor * step(fx, 0.62) * step(v, 0.12) * step(0.0, v) * (1.0 - door));          // the door step
          if (shopFloor > 0.5) {
            // The shopfront: a window between the piers, a stall riser and a sign board over it.
            float bay = 2.4;
            float bx = abs(fract(vInfo.x / bay) - 0.5) * bay;
            float pier = step(bx, 0.95);
            float riser = step(v, 0.8) * pier;
            float sign = step(2.9, v) * step(v, 3.25) * pier;
            albedo = mix(albedo, vec3(0.13, 0.17, 0.21), pier * step(0.85, v) * (1.0 - riser) * 0.92);
            albedo = mix(albedo, vec3(0.45, 0.42, 0.38), riser * 0.85);
            albedo = mix(albedo, vec3(0.62, 0.26, 0.22), sign * 0.75);
            glow += pier * step(0.85, v) * step(0.72, h2(vec2(floor(vInfo.x / bay), seed * 41.0))) * 0.5;
          }
        }
      }
    } else if (kind < 1.5) {                                        // the slate and tile roofs in staggered rows
      float rowH2 = 0.21, tw = 0.32;
      float rr = floor(vInfo.y / rowH2), off = mod(rr, 2.0) * 0.5;
      float tx = fract(vInfo.x / tw + off), ty = fract(vInfo.y / rowH2);
      float groove = clamp(step(tx, 0.06) + step(ty, 0.09), 0.0, 1.0);
      float tint = h2(vec2(rr, floor(vInfo.x / tw + off)));
      albedo = vC * (0.82 + 0.34 * tint) * (1.0 - 0.38 * groove * step(vDist, 90.0));
      albedo = mix(albedo, vec3(0.2, 0.3, 0.14), smoothstep(0.55, 0.85, grain) * 0.3 * (1.0 - N.y));
    } else {                                                        // the flat roof: tar and gravel
      albedo = vC * (0.8 + 0.4 * grain);
    }
    float sunMul = mix(1.0, 0.8, uCloud * 0.6);
    vec3 col = paintLightW(albedo * (1.0 - 0.2 * uWet), N, sunMul, 1.15, P);
    col += vec3(1.0, 0.76, 0.4) * glow * uNight * 0.9;
    col = pow(col, vec3(0.97));
    gl_FragColor = vec4(applyFogW(col, vDist, P.y), 1.0);
  }
`;

export function createBuildingMaterial(env, noiseTexture, quality) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...env.uniforms,
      uNoise: { value: noiseTexture },
      // low quality is LITE, not plain: the windows and the doors of the near houses stay (a street of blank boxes was the bug); only the small parts go
      uDetail: { value: quality && quality.id === 'low' ? LITE_DETAIL : 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.DoubleSide,
  });
}
