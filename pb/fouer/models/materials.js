/* Schueberfouer Tycoon, W3: the shared materials of every fair model (one set per page, created lazily).
 *
 *   const M = getMaterials();      // { solid, lamp, sign, signLit, bulbs, fx, atlas, U, setNight(k), tick(t) }
 *
 *   solid    MeshLambert, vertex colours (painted bodies, roofs, fabric)
 *   lamp     MeshBasic, vertex colours: LED strips, tube lights, lit windows.  Night convention of W2: `color` scalar = 0.45 + 0.55 k.  Vertices that carry
 *            an `aPh` phase attribute > 0 CHASE (a travelling pulse, L3 "LED outline chasing colours") in the vertex shader, no CPU per frame
 *   sign     MeshLambert + the shared sign atlas (unlit painted panels)
 *   signLit  same atlas + emissive map: lit sign panels, glow with k
 *   bulbs    Points shader: warm bare bulbs (2.5 px minimum, halo at night, twinkle/chase through `aPh`), premultiplied blending, one draw call per fair
 *   fx       Points shader: steam / fog / sparks animated entirely in the vertex shader
 * All Points share the uniform objects in M.U (uT, uNight, uScale, uFogD); `onBeforeRender` of the Points meshes feeds uScale / uFogD. */
import { createAtlas } from './atlas.js';

let SET = null;
const T = globalThis.THREE;

const POINT_VERT = (extra) => `
uniform float uScale; uniform float uNight; uniform float uT; uniform float uFogD;
attribute vec3 aCol; attribute float aSize; attribute float aPh; ${extra.attrs}
varying vec3 vCol; varying float vA; varying float vHalo;
void main() {
  vec3 p = position;
  ${extra.pre}
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(0.5, -mv.z);
  float fog = exp(-uFogD * uFogD * dist * dist);
  ${extra.body}
}`;

const BULB_BODY = `
  float tw = 1.0;
  if (aPh > 0.0) tw = 0.3 + 0.7 * step(0.0, sin(uT * 5.0 - aPh * 30.0));
  float px = aSize * uScale / dist * (1.0 + 1.1 * uNight);
  vCol = aCol * tw * fog * (0.8 + 1.3 * uNight);
  vA = clamp(px / 2.6, 0.6, 1.0);
  vHalo = uNight * fog;
  gl_PointSize = clamp(px, 2.6 + 3.4 * uNight, 30.0);`;
const BULB_FRAG = `
varying vec3 vCol; varying float vA; varying float vHalo;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float cr = mix(0.5, 0.26, clamp(vHalo, 0.0, 1.0));
  float core = smoothstep(cr + 0.1, cr - 0.08, d);
  float halo = exp(-d * d * 5.5) * vHalo * 0.7;
  vec3 rgb = vCol * (core * vA + halo);
  gl_FragColor = vec4(rgb, core * vA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const FX_BODY = `
  float steam = aKind < 0.5 ? 1.0 : 0.0;
  float spd = steam > 0.5 ? 0.2 : 0.8;
  float t = fract(uT * spd + aPh);
  if (steam > 0.5) { p.y += t * 2.2; p.x += sin(aPh * 40.0 + t * 3.0) * 0.3 * t; p.z += cos(aPh * 23.0 + t * 2.0) * 0.25 * t; }
  else { p.y += t * 1.8 - t * t * 2.4; p.x += sin(aPh * 61.0) * 1.1 * t; p.z += cos(aPh * 37.0) * 1.1 * t; }
  vec4 mv2 = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv2;
  dist = max(0.5, -mv2.z);
  float sz = aSize * (steam > 0.5 ? 0.6 + 1.5 * t : 1.0 - 0.6 * t);
  float px = sz * uScale / dist;
  vA = (steam > 0.5 ? 0.42 * smoothstep(0.0, 0.12, t) * (1.0 - t) : 1.0 - t) * fog;
  vCol = aCol * (steam > 0.5 ? (0.72 + 0.4 * uNight) : (1.0 + 0.8 * uNight));
  vHalo = steam > 0.5 ? 0.0 : uNight;
  gl_PointSize = clamp(px, 1.0, 120.0);`;
const FX_FRAG = `
varying vec3 vCol; varying float vA; varying float vHalo;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float soft = smoothstep(1.0, 0.0, d);
  float a = soft * vA;
  gl_FragColor = vec4(vCol * a * (1.0 + vHalo), a * (vHalo > 0.0 ? 0.35 : 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function getMaterials() {
  if (SET) return SET;
  const atlas = createAtlas(T);
  const U = { uT: { value: 0 }, uNight: { value: 0 }, uScale: { value: 900 }, uFogD: { value: 0.0004 }, uSwing: { value: 0.35 } };

  const solid = new T.MeshLambertMaterial({ vertexColors: true, name: 'fouer-solid' });
  solid.emissive = new T.Color(0x000000);

  const lamp = new T.MeshBasicMaterial({ vertexColors: true, name: 'fouer-lamp' });
  lamp.color.setScalar(0.45);
  lamp.onBeforeCompile = (sh) => {
    sh.uniforms.uT = U.uT;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPh; uniform float uT;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\nif (aPh > 0.0) { float k = 0.5 + 0.5 * sin(uT * 4.0 - aPh * 25.0); vColor *= 0.22 + 1.1 * k; }\n#endif');
  };
  lamp.customProgramCacheKey = () => 'fouer-lamp-chase';

  // chair-swing chains + seats: every vertex carries its depth below the attachment point (aDepth); the vertex shader swings it outward by U.uSwing (radians)
  const swing = new T.MeshLambertMaterial({ vertexColors: true, name: 'fouer-swing' });
  swing.emissive = new T.Color(0x000000);
  swing.onBeforeCompile = (sh) => {
    sh.uniforms.uSwing = U.uSwing;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aDepth; uniform float uSwing;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvec2 rd = normalize(transformed.xz + vec2(1e-4, 0.0)); transformed.xz += rd * aDepth * sin(uSwing); transformed.y += aDepth * (cos(uSwing) - 1.0);');
  };
  swing.customProgramCacheKey = () => 'fouer-swing';
  const sign = new T.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, name: 'fouer-sign' });
  const signLit = new T.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, emissive: 0xffffff, emissiveMap: atlas.texture, emissiveIntensity: 0.2, name: 'fouer-sign-lit' });

  const pointBase = { transparent: true, depthWrite: false, depthTest: true, fog: false, blending: T.CustomBlending, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor, blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneMinusSrcAlphaFactor, toneMapped: true };
  const bulbs = new T.ShaderMaterial(Object.assign({ name: 'fouer-bulbs', uniforms: U, vertexShader: POINT_VERT({ attrs: '', pre: '', body: BULB_BODY }), fragmentShader: BULB_FRAG }, pointBase));
  const fx = new T.ShaderMaterial(Object.assign({
    name: 'fouer-fx', uniforms: U,
    vertexShader: POINT_VERT({ attrs: 'attribute float aKind;', pre: '', body: FX_BODY }),
    fragmentShader: FX_FRAG,
  }, pointBase));

  const night = { k: 0 };
  const SET_ = {
    T, atlas, U, solid, lamp, sign, signLit, swing, bulbs, fx, night,
    setNight(k) {
      k = Math.max(0, Math.min(1, k)); night.k = k; U.uNight.value = k;
      lamp.color.setScalar(0.45 + 0.55 * k);
      signLit.emissiveIntensity = 0.2 + 0.95 * k;
      const day = 0.05 * (1 - k); solid.emissive.setRGB(0.055 * k + day, 0.034 * k + day, 0.016 * k + day * 0.9); swing.emissive.copy(solid.emissive);   // a little fill by day (the real fair is high key), the fair's own warm light by night       // the fair's own light washes the painted bodies a little
    },
    tick(t) { U.uT.value = t; },
    /** called by every Points mesh before it is drawn: pixel scale and fog density follow the view */
    feed(renderer, scene, camera) {
      const h = renderer.domElement ? renderer.domElement.height : 800;
      U.uScale.value = h / (2 * Math.tan((camera.fov || 32) * Math.PI / 360));
      U.uFogD.value = scene && scene.fog && scene.fog.density !== undefined ? scene.fog.density : 0.0004;
    },
    atlasStats: () => atlas.stats(),
    all: () => [solid, lamp, sign, signLit, swing, bulbs, fx],
  };
  SET = SET_;
  return SET;
}

export const isFairMaterial = (m) => !!SET && SET.all().includes(m);
