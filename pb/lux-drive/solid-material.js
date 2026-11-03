/* A plain vertex-colour material with the shared painted lighting, for small built things (the bridge railing, signposts). */
import { PAINT_LIGHT_GLSL } from './light-glsl.js';

const THREE = window.THREE;
const VERTEX = `
  attribute vec3 color; varying vec3 vN; varying vec3 vC; varying vec3 vWorld; varying float vDist;
  void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vC = color; vWorld = wp.xyz; vec4 mv = viewMatrix * wp; vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }
`;
const FRAGMENT = `
  precision highp float; varying vec3 vN; varying vec3 vC; varying vec3 vWorld; varying float vDist;
  ${PAINT_LIGHT_GLSL}
  void main(){ vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N; vec3 c = paintLightW(vC * (1.0 - 0.2 * uWet), N, mix(1.0, 0.8, uCloud * 0.6), 1.15, vWorld); gl_FragColor = vec4(applyFogW(pow(c, vec3(0.97)), vDist, vWorld.y), 1.0); }
`;
export function createSolidMaterial(env) {
  return new THREE.ShaderMaterial({ uniforms: { ...env.uniforms }, vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide });
}
