/* The material of the real roofs (houses17): the cleaned-up ACT photo from above, lit and fogged exactly like the painted
 * buildings (light-glsl.js), so a photo roof sits in the painted world (night included: the roof photo is only a colour map). */
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
  void main(){
    vec3 N = normalize(vN);
    vec3 albedo = texture2D(uMap, vUv).rgb;
    float sunMul = mix(1.0, 0.8, uCloud * 0.6);
    vec3 col = paintLightW(albedo * (1.0 - 0.2 * uWet), N, sunMul, 1.15, vWorld);
    col = pow(col, vec3(0.97));
    gl_FragColor = vec4(applyFogW(col, vDist, vWorld.y), 1.0);
  }
`;

/** One material per atlas page (the page is its texture). */
export function createRoofMaterial(env, texture) {
  return new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms, uMap: { value: texture } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    // over the painted roof by a few centimetres AND pulled forward in depth: no z-fight far away (24-bit depth)
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
}
