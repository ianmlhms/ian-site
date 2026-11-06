/* The material of the retaining walls (look11): the masonry is drawn in the fragment shader from the wall's own coordinates, not from the geometry.
 *
 * Luxembourg's retaining walls are dressed sandstone (the warm ochre-grey of the Luxembourg sandstone of the old town and the Pétrusse), grey limestone
 * rubble, or poured concrete with formwork panels, each under a thin pale coping.  The courses are LEVEL in world height (a real wall is laid level, the
 * courses of the old flat quads ran parallel to the sloping top and the foot, so a wall on a slope was striped diagonally: the "diamond facets"); the
 * joints are staggered along the wall (aWall.x is the distance along it).  The faces carry smooth normals (wall-view.js), so a curved wall shades
 * like a curved wall and not like a row of panels.
 *
 * aWall: x = metres along the wall, y = the kind (WALL_KIND), z = the height of the foot of the face there (the damp band at the foot). */
import { PAINT_LIGHT_GLSL } from './light-glsl.js';

const THREE = window.THREE;

/** The kinds of surface of a wall (aWall.y). */
export const WALL_KIND = Object.freeze({ sandstone: 0, limestone: 1, concrete: 2, coping: 3, back: 4 });

const VERTEX = `
  attribute vec3 color; attribute vec3 aWall;
  varying vec3 vN; varying vec3 vC; varying vec3 vWorld; varying vec3 vWall; varying float vDist;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal); vC = color; vWorld = wp.xyz; vWall = aWall;
    vec4 mv = viewMatrix * wp; vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = `
  precision highp float;
  uniform sampler2D uNoise;
  varying vec3 vN; varying vec3 vC; varying vec3 vWorld; varying vec3 vWall; varying float vDist;
  ${PAINT_LIGHT_GLSL}
  float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  // a joint line of width w (m) at the integer values of t, anti-aliased by its own screen-space width (fades out where it would shimmer)
  float joint(float t, float w, float scale){
    float d = abs(fract(t) - 0.5) * 2.0;                       // 1 on the joint, 0 mid-block
    float aa = fwidth(t) * 2.0;
    float line = smoothstep(1.0 - w / scale - aa, 1.0 - w / scale + aa * 0.5, d);
    return line * (1.0 - smoothstep(0.18, 0.45, aa));
  }
  void main(){
    vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
    float kind = vWall.y, u = vWall.x, y = vWorld.y;
    float above = max(0.0, y - vWall.z);                        // metres above the foot of the face
    float grain = texture2D(uNoise, vec2(u * 0.37, y * 0.37)).g;
    float grain2 = texture2D(uNoise, vec2(u * 0.061 + 0.3, y * 0.083)).b;
    vec3 albedo = vC;
    if (kind < 2.5) {
      bool concrete = kind > 1.5;
      bool lime = kind > 0.5 && kind < 1.5;
      // the courses: dressed sandstone 0.36 m, limestone rubble 0.27 m (and shorter, more varied blocks), concrete a formwork panel of 2.4 x 0.6 m
      float courseH = concrete ? 0.6 : lime ? 0.27 : 0.36;
      float row = floor(y / courseH);
      float blockL = concrete ? 2.4 : (lime ? 0.48 : 0.82) * (0.8 + 0.45 * h2(vec2(row, 3.7)));
      float shift = concrete ? 0.0 : h2(vec2(row, 9.1)) * blockL;  // the joints of one course are staggered against the next
      float bu = (u + shift) / blockL;
      float block = floor(bu);
      float tint = h2(vec2(block, row + 17.0 * kind));
      if (concrete) {
        albedo *= 0.95 + 0.05 * tint + 0.10 * (grain2 - 0.5);
        float mortar = max(joint(bu, 0.03, blockL), joint(y / courseH, 0.012, courseH) * 0.45);
        albedo *= 1.0 - 0.28 * mortar;
      } else {
        albedo *= (lime ? 0.84 : 0.88) + (lime ? 0.30 : 0.22) * tint;
        albedo *= 0.92 + 0.16 * grain;
        float mortar = max(joint(bu, lime ? 0.035 : 0.022, blockL), joint(y / courseH, lime ? 0.035 : 0.025, courseH));
        albedo = mix(albedo, vec3(0.44, 0.42, 0.38), mortar * 0.85);
      }
      // the damp of the foot and the darker stain under the coping where the rain runs off
      albedo *= 1.0 - 0.16 * (1.0 - smoothstep(0.0, 0.9, above)) * (0.6 + 0.4 * grain2);
    } else if (kind < 3.5) {
      albedo *= 0.94 + 0.10 * grain;                            // the coping: plain pale concrete
    } else {
      albedo *= 0.85 + 0.15 * grain;                            // the back of the block (only seen where the ground behind it falls away)
    }
    vec3 c = paintLightW(albedo * (1.0 - 0.2 * uWet), N, mix(1.0, 0.8, uCloud * 0.6), 1.15, vWorld);
    gl_FragColor = vec4(applyFogW(pow(c, vec3(0.97)), vDist, vWorld.y), 1.0);
  }
`;

/** The wall material (one for all the walls): the shared painted lighting, the noise texture of the env for the grain. */
export function createWallMaterial(env) {
  return new THREE.ShaderMaterial({ uniforms: { ...env.uniforms }, vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide });
}
