/* The material of the built parts (trams, poles, platforms, street lights): vertex colours with the shared painted lighting,
 * plain or instanced (one draw call for all the sections of all the trams), and a night glow: a face with glow > 0 keeps its
 * colour at night (the lit windows of a tram, the head of a street lamp).  The painted look: no textures. */
import { PAINT_LIGHT_GLSL } from './light-glsl.js';

const THREE = window.THREE;
const VERTEX = `
  attribute vec3 color; attribute float glow;
  varying vec3 vN; varying vec3 vC; varying vec3 vWorld; varying float vDist; varying float vGlow;
  void main(){
    mat4 M = modelMatrix;
    #ifdef USE_INSTANCING
      M = modelMatrix * instanceMatrix;
    #endif
    vec4 wp = M * vec4(position, 1.0);
    vN = normalize(mat3(M) * normal); vC = color; vGlow = glow; vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp; vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAGMENT = `
  precision highp float;
  varying vec3 vN; varying vec3 vC; varying vec3 vWorld; varying float vDist; varying float vGlow;
  ${PAINT_LIGHT_GLSL}
  void main(){
    vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
    vec3 c = paintLightW(vC * (1.0 - 0.2 * uWet), N, mix(1.0, 0.8, uCloud * 0.6), 1.15, vWorld);
    // a lit window / lamp: at night it keeps (and warms) its colour instead of going dark
    // (a bright glowing face - a lamp head, a destination board - keeps its colour; a dark one - a window - shows the warm light inside)
    float bright = max(vC.r, max(vC.g, vC.b));
    vec3 lit = bright > 0.5 ? vC * vec3(1.35, 1.2, 0.9) : vec3(0.95, 0.80, 0.48) * 0.72;
    c = mix(c, max(c, lit), vGlow * uNight);
    gl_FragColor = vec4(applyFogW(pow(c, vec3(0.97)), vDist, vWorld.y), 1.0);
  }
`;

/** options.offset: a polygon offset (negative pulls the surface towards the camera: a track bed over the ground). */
export function createPartMaterial(env, { offset = 0 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...env.uniforms }, vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide,
    polygonOffset: offset !== 0, polygonOffsetFactor: offset, polygonOffsetUnits: offset,
  });
}
