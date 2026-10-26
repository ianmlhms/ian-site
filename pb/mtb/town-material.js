/* The painted material of every built thing (houses, church, castles), all drawn in the fragment shader from the surface info of the mesh (mesh-builder.js KIND): rendered walls with a grid of
 * windows, shutters and a door (lit from inside at night), slate and tile roofs in staggered rows, dressed sandstone in courses for the castles, white trim, dark glass. No picture files. */
import { PAINT_LIGHT_GLSL } from './light-glsl.js';

const THREE = window.THREE;

const VERTEX = `
  attribute vec3 color; attribute vec4 aInfo; attribute vec2 aGeo;
  varying vec3 vN; varying vec3 vC; varying vec3 vWorld; varying vec4 vInfo; varying vec2 vGeo; varying float vDist;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal); vC = color; vWorld = wp.xyz; vInfo = aInfo; vGeo = aGeo;
    vec4 mv = viewMatrix * wp; vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAGMENT = `
  precision highp float;
  uniform float uDetail;
  uniform sampler2D uNoise;
  varying vec3 vN; varying vec3 vC; varying vec3 vWorld; varying vec4 vInfo; varying vec2 vGeo; varying float vDist;
  ${PAINT_LIGHT_GLSL}
  float h1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
  float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main(){
    vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
    vec3 P = vWorld;
    float kind = vInfo.z, seed = vInfo.w;
    vec2 gp = vInfo.xy * 0.5 + seed * 13.0;                         // noise in the surface's own coordinates (no stretched streaks on walls)
    float grain = texture2D(uNoise, gp).g;
    float grain2 = texture2D(uNoise, gp * 0.21 + 0.3).b;
    vec3 albedo = vC;
    float glow = 0.0;
    if (kind < 0.5) {                                              // rendered wall: plinth, windows, shutters, door
      float len = max(vGeo.x, 0.5), eave = vGeo.y, v = vInfo.y;
      albedo *= 0.9 + 0.2 * grain;
      albedo = mix(albedo, albedo * vec3(0.6, 0.58, 0.56), 1.0 - smoothstep(0.3, 0.75, v));
      albedo *= 1.0 - 0.18 * smoothstep(0.55, 0.9, grain2) * (1.0 - smoothstep(0.0, 5.0, v));        // damp streaks low on the wall
      if (uDetail > 0.5 && eave > 2.2 && vDist < 140.0) {
        float cells = max(1.0, floor(len / 2.7)), cw = len / cells;
        float cu = vInfo.x / cw, fi = floor(cu), dx = (fract(cu) - 0.5) * cw;
        float rowH = 2.75, row = floor((v - 0.05) / rowH), rows = floor((eave - 0.3) / rowH);
        float vc = (row + 0.5) * rowH + 0.35;
        float hasRow = step(0.0, row) * step(row, rows - 0.999);
        float present = step(h2(vec2(fi + row * 5.0, seed * 17.0)), 0.9);
        float doorCell = floor(mod(seed * 97.0, cells));
        float isDoor = step(row, 0.5) * step(abs(fi - doorCell), 0.5) * hasRow;
        float fx = abs(dx), fy = abs(v - vc);
        float inner = step(fx, 0.42) * step(fy, 0.62), frame = step(fx, 0.52) * step(fy, 0.72) * (1.0 - inner);
        float shut = step(0.55, h2(vec2(fi * 3.0 + row, seed * 5.0))) * step(0.52, fx) * step(fx, 0.82) * step(fy, 0.72);
        float on = hasRow * present * (1.0 - isDoor);
        vec3 glass = mix(vec3(0.07, 0.1, 0.14), vec3(0.34, 0.44, 0.54), smoothstep(-0.6, 0.6, v - vc));
        vec3 shutterCol = mix(vec3(0.2, 0.36, 0.24), mix(vec3(0.42, 0.2, 0.16), vec3(0.3, 0.34, 0.4), step(0.5, h1(seed * 31.0))), step(0.45, h1(seed * 13.0)));
        float bars = step(fx, 0.025) + step(fy, 0.025);
        albedo = mix(albedo, vec3(0.93, 0.92, 0.88), frame * on);
        albedo = mix(albedo, shutterCol, shut * on);
        albedo = mix(albedo, mix(glass, vec3(0.9, 0.9, 0.86), clamp(bars, 0.0, 1.0)), inner * on);
        float lit = step(0.55, h2(vec2(fi + row * 3.0, seed * 7.0)));
        glow = inner * on * lit * (1.0 - clamp(bars, 0.0, 1.0));
        float door = isDoor * step(fx, 0.55) * step(0.0, v) * step(v, 2.15);
        albedo = mix(albedo, mix(vec3(0.34, 0.2, 0.12), vec3(0.2, 0.3, 0.22), step(0.5, h1(seed * 53.0))), door);
        albedo = mix(albedo, vec3(0.78, 0.76, 0.7), isDoor * step(fx, 0.62) * step(v, 0.12) * step(0.0, v) * (1.0 - door));          // the door step
      }
    } else if (kind < 1.5 || kind > 6.5 && kind < 7.5) {          // slate / tile roof, staggered rows
      float rowH2 = 0.21, tw = 0.32;
      float rr = floor(vInfo.y / rowH2), off = mod(rr, 2.0) * 0.5;
      float tx = fract(vInfo.x / tw + off), ty = fract(vInfo.y / rowH2);
      float groove = clamp(step(tx, 0.06) + step(ty, 0.09), 0.0, 1.0);
      float tint = h2(vec2(rr, floor(vInfo.x / tw + off)));
      albedo = vC * (0.82 + 0.34 * tint) * (1.0 - 0.38 * groove * step(vDist, 90.0));
      albedo = mix(albedo, vec3(0.2, 0.3, 0.14), smoothstep(0.55, 0.85, grain) * 0.3 * (1.0 - N.y));
    } else if (kind < 2.5) {                                       // stone (chimneys, plinths)
      albedo = vC * (0.85 + 0.3 * grain);
    } else if (kind < 3.5) {                                       // flat roof: tar and gravel
      albedo = vC * (0.8 + 0.4 * grain);
    } else if (kind < 4.5) {                                       // dressed sandstone in courses (the castles)
      float course = 0.46, rr = floor(vInfo.y / course);
      float bw = 0.85 + 0.55 * h1(rr * 1.7);
      float bx = vInfo.x / bw + h1(rr * 3.1) * 5.0, bi = floor(bx);
      float joint = clamp(step(fract(bx), 0.035) + step(fract(vInfo.y / course), 0.06), 0.0, 1.0);
      float bt = h2(vec2(bi, rr));
      albedo = vC * (0.74 + 0.46 * bt) * (1.0 - 0.42 * joint);
      albedo *= 0.86 + 0.28 * grain;
      float streak = texture2D(uNoise, vec2(vInfo.x * 0.4, vInfo.y * 0.03) + seed * 7.0).g;
      albedo *= 1.0 - 0.32 * smoothstep(0.55, 0.9, streak);
      albedo = mix(albedo, vec3(0.4, 0.45, 0.3), smoothstep(0.6, 0.9, grain2) * 0.38 * (0.4 + 0.6 * (1.0 - N.y)));        // lichen and moss
      albedo = mix(albedo, albedo * vec3(0.78, 0.76, 0.74), smoothstep(0.62, 0.9, texture2D(uNoise, gp * 0.5 + 0.6).r) * 0.5);
    } else if (kind < 5.5) {                                       // dark openings: arrow slits, windows of the ruin
      albedo = vC;
    } else if (kind < 6.5) {                                       // white trim
      albedo = vC;
    } else if (kind > 9.5 && kind < 10.5) {                        // church wall: a plinth and a row of tall arched windows with stone surrounds
      float len = max(vGeo.x, 0.5), v = vInfo.y;
      albedo *= 0.92 + 0.16 * grain;
      albedo = mix(albedo, albedo * vec3(0.66, 0.64, 0.6), 1.0 - smoothstep(0.4, 1.0, v));
      float cells = max(1.0, floor(len / 4.6)), cw = len / cells;
      float dx = (fract(vInfo.x / cw) - 0.5) * cw, vy = v - 5.0;
      float rect = step(abs(dx), 0.62) * step(2.1, v) * step(v, 5.0);
      float arch = step(length(vec2(dx, v - 5.0)), 0.62) * step(5.0, v);
      float win = clamp(rect + arch, 0.0, 1.0);
      float rr = step(abs(dx), 0.8) * step(1.9, v) * step(v, 5.0) + step(length(vec2(dx, v - 5.0)), 0.8) * step(5.0, v);
      albedo = mix(albedo, vec3(0.8, 0.76, 0.64), clamp(rr, 0.0, 1.0) * (1.0 - win));
      albedo = mix(albedo, mix(vec3(0.07, 0.1, 0.15), vec3(0.3, 0.4, 0.5), smoothstep(2.0, 5.6, v)), win * step(vDist, 160.0));
      glow = win * step(0.5, h2(vec2(floor(vInfo.x / cw), 3.0)));
    } else if (kind > 7.5 && kind < 8.5) {                         // dormer front: white frame around dark glass
      float fx = abs(vInfo.x - vGeo.x * 0.5), fy = abs(vInfo.y - vGeo.y * 0.5);
      float inner = step(fx, vGeo.x * 0.5 - 0.14) * step(fy, vGeo.y * 0.5 - 0.14);
      float bars = step(abs(vInfo.x - vGeo.x * 0.5), 0.03);
      albedo = mix(vec3(0.92, 0.91, 0.86), mix(vec3(0.08, 0.11, 0.15), vec3(0.9, 0.9, 0.86), bars), inner);
      glow = inner * (1.0 - bars) * step(0.5, h1(seed * 9.0));
    } else {
      albedo = vC;
    }
    float sunMul = mix(1.0, 0.8, uCloud * 0.6);
    vec3 col = paintLightW(albedo * (1.0 - 0.2 * uWet), N, sunMul, 1.2, P);
    col += vec3(1.0, 0.76, 0.4) * glow * uNight * 0.9;
    col = pow(col, vec3(0.97));
    gl_FragColor = vec4(applyFogW(col, vDist, P.y), 1.0);
  }
`;

export function createTownMaterial(env, quality) {
  return new THREE.ShaderMaterial({ uniforms: { ...env.uniforms, uDetail: { value: quality && quality.id === 'low' ? 0 : 1 } }, vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide });
}
