/* Schueberfouer Tycoon, W3: the shared materials of every fair model (one set per page, created lazily).
 *
 *   const M = getMaterials();      // { solid, lamp, sign, signLit, bulbs, fx, atlas, U, setNight(k), tick(t) }
 *
 *   solid    MeshLambert, vertex colours (painted bodies, roofs, fabric)
 *   lamp     MeshBasic, vertex colours: LED strips, tube lights, lit windows.  Night convention of W2: `color` scalar = 0.45 + 0.55 k.  Vertices that carry
 *            an `aPh` phase attribute > 0 CHASE (a travelling pulse, L3 "LED outline chasing colours") in the vertex shader, no CPU per frame
 *   sign     MeshLambert + the shared sign atlas (unlit painted panels)
 *   signLit  same atlas + emissive map: lit sign panels, glow with k
 *   fabric   MeshLambert, vertex colours: tent canvas (hall tents).  Bright white by day (HDR albedo), glows warm from inside at night (emissive follows k)
 *   bulbs    Points shader: warm bare bulbs (2.5 px minimum; at night a big saturated bloom halo sized in WORLD metres and attenuated with distance, twinkle/chase through `aPh`),
 *            premultiplied blending (alpha = hard core only, the halo is purely additive), one draw call per merged batch
 *   fx       Points shader: steam / fog / sparks animated entirely in the vertex shader
 * All Points share the uniform objects in M.U (uT, uNight, uScale, uFogD); `onBeforeRender` of the Points meshes feeds uScale / uFogD. */
import { createAtlas } from './atlas.js';

let SET = null;
const CFG = { haloK: 11, haloI: 0.5, wall: 0.55, lampGain: 0.45, fabric: 0.62 };   // look constants (tunable at runtime through M.cfg for the screenshot sessions)
const T = globalThis.THREE;

const POINT_VERT = (extra) => `
uniform float uScale; uniform float uNight; uniform float uT; uniform float uFogD; uniform float uHaloK; uniform float uHaloI;
attribute vec3 aCol; attribute float aSize; attribute float aPh; ${extra.attrs}
varying vec3 vCol; varying float vA; varying float vHalo; varying float vCore;
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
  float core = aSize * uScale / dist;                        // px diameter of the physical bulb
  // polish 2: the bloom shrinks from far above (builder / wheel view: strings of bulbs were big white blobs) and big lamps (flood masts, pylons) bloom relatively less
  float farK = smoothstep(14.0, 100.0, dist);
  float kEff = uHaloK * mix(1.0, 0.3, farK) * clamp(0.16 / max(aSize, 0.01), 0.35, 1.0);
  float spr = core * (1.0 + kEff * uNight);                  // sprite = bulb + bloom, in world metres, so it shrinks with distance like a real glow
  float hOnly = step(aPh, -0.5);                             // aPh = -1: a harvested halo point (big rides): bloom only, invisible by day
  core *= mix(1.0, 0.3, hOnly);
  float fogH = exp(-uFogD * uFogD * dist * dist * 0.35);     // lights shine through the haze
  float px = clamp(spr, 2.6 + 3.4 * uNight, mix(58.0, 24.0, farK));
  vCore = clamp(core / px, 0.06, 1.0);
  vCol = aCol * tw * (0.8 + 1.2 * uNight) * mix(fog, fogH, uNight) * mix(1.0, uNight, hOnly);
  vA = clamp(core / 2.6, 0.6, 1.0);
  // a far bulb squeezed into the minimum sprite must not outshine a near one: energy follows the covered area
  vHalo = aGain * (0.4 + 0.6 * smoothstep(3.0, 22.0, dist)) * mix(1.0, 0.6, farK) * mix(1.0, 0.5, hOnly) * uNight * uHaloI * fogH * tw * clamp(spr / px, 0.0, 1.0) * (0.55 + 0.45 * smoothstep(2.0, 14.0, px));
  gl_PointSize = px;`;
const BULB_FRAG = `
varying vec3 vCol; varying float vA; varying float vHalo; varying float vCore;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float cr = clamp(vCore, 0.06, 1.0) * mix(0.62, 0.9, vHalo);
  float core = smoothstep(cr + 0.08, cr - 0.06, d);
  float halo = (exp(-d * d * 7.0) * 0.85 + exp(-d * 2.6) * 0.3 * (1.0 - d)) * vHalo * step(d, 1.0);
  vec3 hot = mix(vCol, vec3(1.0, 0.97, 0.9) * max(vCol.r, max(vCol.g, vCol.b)), 0.42 * vHalo);
  vec3 rgb = hot * core * vA + vCol * halo * 1.15;
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
  const lmDefault = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, T.RGBAFormat); lmDefault.needsUpdate = true;
  /* uLM = the baked night light map (glow.js): rgb = sqrt(light / LM_RANGE) over the fair, uLMR = (u0, w0, 1/du, 1/dw) in game metres, uLMP = (strength, fadeLo, fadeHi, baseY): light on walls fades with height above baseY */
  const U = {
    uT: { value: 0 }, uNight: { value: 0 }, uScale: { value: 900 }, uFogD: { value: 0.0004 }, uSwing: { value: 0.35 }, uHaloK: { value: 0 }, uHaloI: { value: 1 },
    uLampGain: { value: 1 }, uLM: { value: lmDefault }, uLMR: { value: new T.Vector4(0, 0, 1, 1) }, uLMP: { value: new T.Vector4(0, 2, 12, 0) }, uSat: { value: 1.12 },
  };
  /** wrap a lit material: day saturation boost + the night light map (light that the fair's bulbs cast on the painted surfaces).  Chains an existing onBeforeCompile. */
  const patchLit = (mat, key) => {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, rr) => {
      if (prev) prev(sh, rr);
      sh.uniforms.uLM = U.uLM; sh.uniforms.uLMR = U.uLMR; sh.uniforms.uLMP = U.uLMP; sh.uniforms.uSat = U.uSat;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef USE_INSTANCING\nvWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uLM; uniform vec4 uLMR; uniform vec4 uLMP; uniform float uSat; varying vec3 vWP;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), diffuseColor.rgb, uSat);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ vec3 lmE = texture2D(uLM, (vWP.xz - uLMR.xy) * uLMR.zw).rgb; vec3 lmL = lmE * lmE * 4.0; float lmH = 1.0 - smoothstep(uLMP.y, uLMP.z, vWP.y - uLMP.w); totalEmissiveRadiance += (diffuseColor.rgb * 0.8 + vec3(0.07, 0.05, 0.03)) * lmL * (uLMP.x * lmH); }');
    };
    const pk = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
    mat.customProgramCacheKey = () => pk + '|' + key + '-lm1';
    return mat;
  };

  const solid = new T.MeshLambertMaterial({ vertexColors: true, name: 'fouer-solid' });
  solid.emissive = new T.Color(0x000000);
  patchLit(solid, 'solid');
  // tent canvas: HDR white albedo by day, translucent warm glow from inside by night
  const fabric = new T.MeshLambertMaterial({ vertexColors: true, name: 'fouer-fabric', side: T.DoubleSide });
  fabric.emissive = new T.Color(0x000000);
  patchLit(fabric, 'fabric');

  const lamp = new T.MeshBasicMaterial({ vertexColors: true, name: 'fouer-lamp' });
  lamp.color.setScalar(0.45);
  lamp.onBeforeCompile = (sh) => {
    sh.uniforms.uT = U.uT; sh.uniforms.uLampGain = U.uLampGain;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPh; uniform float uT; uniform float uLampGain;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\nif (aPh > 0.0) { float k = 0.5 + 0.5 * sin(uT * 4.0 - aPh * 25.0); vColor *= 0.22 + 1.1 * k; }\nvColor *= uLampGain;\n#endif');
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
  patchLit(swing, 'swing');
  const sign = new T.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, name: 'fouer-sign' });
  const signLit = new T.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, emissive: 0xffffff, emissiveMap: atlas.texture, emissiveIntensity: 0.2, name: 'fouer-sign-lit' });
  patchLit(sign, 'sign'); patchLit(signLit, 'signlit');

  const pointBase = { transparent: true, depthWrite: false, depthTest: true, fog: false, blending: T.CustomBlending, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor, blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneMinusSrcAlphaFactor, toneMapped: true };
  const bulbs = new T.ShaderMaterial(Object.assign({ name: 'fouer-bulbs', uniforms: U, vertexShader: POINT_VERT({ attrs: 'attribute float aGain;', pre: '', body: BULB_BODY }), fragmentShader: BULB_FRAG }, pointBase));
  const fx = new T.ShaderMaterial(Object.assign({
    name: 'fouer-fx', uniforms: U,
    vertexShader: POINT_VERT({ attrs: 'attribute float aKind;', pre: '', body: FX_BODY }),
    fragmentShader: FX_FRAG,
  }, pointBase));

  const night = { k: 0 };
  const SET_ = {
    T, atlas, U, cfg: CFG, lmDefault, solid, fabric, lamp, sign, signLit, swing, bulbs, fx, night, patchLit,
    setNight(k) {
      k = Math.max(0, Math.min(1, k)); night.k = k; U.uNight.value = k;
      lamp.color.setScalar(0.45 + 0.55 * k);                  // contract of W2: 0.45 + 0.55 k (the HDR gain below makes the lit LEDs blaze on top)
      U.uLampGain.value = 1 + CFG.lampGain * k;
      U.uHaloK.value = CFG.haloK; U.uHaloI.value = CFG.haloI; U.uSat.value = 1.16 - 0.08 * k; U.uLMP.value.x = CFG.wall * k;
      signLit.emissiveIntensity = 0.2 + 1.2 * k;
      fabric.color.setRGB(1 - 0.12 * k, 1 - 0.38 * k, 1 - 0.68 * k);                    // canvas lit from inside: the cold moon light on it turns warm
      fabric.emissive.setRGB(CFG.fabric * k + 0.03 * (1 - k), CFG.fabric * 0.58 * k + 0.03 * (1 - k), CFG.fabric * 0.26 * k + 0.028 * (1 - k));
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
    all: () => [solid, fabric, lamp, sign, signLit, swing, bulbs, fx],
  };
  SET = SET_;
  return SET;
}

export const isFairMaterial = (m) => !!SET && SET.all().includes(m);
