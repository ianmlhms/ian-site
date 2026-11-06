/* The material of the real façades and roofs (houses17): the cleaned-up ACT photo, lit and fogged exactly like the painted
 * buildings (light-glsl.js), so a photo wall sits in the painted world.  At night the dark panes (the windows of the photo)
 * light up here and there, like the painted windows next door. */
import { PAINT_LIGHT_GLSL } from './light-glsl.js';

const THREE = window.THREE;

const VERTEX = `
  varying vec3 vN; varying vec3 vWorld; varying vec2 vUv; varying float vDist;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal); vWorld = wp.xyz; vUv = uv;
    vec4 mv = viewMatrix * wp; vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAGMENT = `
  precision highp float;
  uniform sampler2D uMap;
  varying vec3 vN; varying vec3 vWorld; varying vec2 vUv; varying float vDist;
  ${PAINT_LIGHT_GLSL}
  float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main(){
    vec3 N = normalize(vN);
    vec3 albedo = texture2D(uMap, vUv).rgb;
    float sunMul = mix(1.0, 0.8, uCloud * 0.6);
    vec3 col = paintLightW(albedo * (1.0 - 0.2 * uWet), N, sunMul, 1.15, vWorld);
    // the night: a dark pixel of the photo is a pane; one window in three is lit (cells of ~1.4 m x 3 m along the wall)
    float pane = 1.0 - smoothstep(0.16, 0.3, dot(albedo, vec3(0.299, 0.587, 0.114)));
    vec2 cell = floor(vec2(dot(vWorld.xz, vec2(-N.z, N.x)) / 1.4, vWorld.y / 3.0));
    float lit = step(0.66, h2(cell + floor(vWorld.xz / 97.0)));
    col += vec3(1.0, 0.76, 0.4) * pane * lit * uNight * 0.8 * (1.0 - step(0.5, abs(N.y)));      // (walls only: the roof photos have no windows)
    col = pow(col, vec3(0.97));
    gl_FragColor = vec4(applyFogW(col, vDist, vWorld.y), 1.0);
  }
`;

/** One material per atlas page (the page is its texture). */
export function createFacadeMaterial(env, texture) {
  return new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms, uMap: { value: texture } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    // in front of the painted wall by a few centimetres AND pulled forward in depth: no z-fight far away (24-bit depth)
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
}
