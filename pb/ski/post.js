/* The picture pipeline (round 5): the scene is drawn into an offscreen target at an INTERNAL resolution (multisampled where WebGL 2 gives
 * it), then one full-screen pass puts it on the canvas at the screen's own resolution: edge antialiasing (FXAA, for what MSAA cannot see:
 * alpha-tested trees, thin lines in shaders), a gentle sharpen that makes the upscale crisp, a touch of grade and a dither against banding
 * in the sky. The HUD is DOM, so it is always sharp.
 *
 * Dynamic resolution: the internal pixel ratio moves between a floor and a ceiling per Grafik level (config.js QUALITY.res) so the frame
 * rate holds. The controller only knows frame times (Safari has no GPU timer): frames over budget that are NOT explained by our own
 * JavaScript (cpuMs) step the resolution down fast; a calm stretch tries one step up, and a step up that fails is remembered (the retry
 * wait doubles), so it does not saw. Steps are ~9 % apart, each a re-allocation of the target (rare, a few ms). */
const THREE = window.THREE;

const STEP = 1.09;                 // ratio between two resolution steps
const BUDGET_MS = 1000 / 60;
const OVER = 1.17;                 // smoothed frame time above budget x this = too slow
const CALM = 1.07;                 // ... below budget x this = on the display's beat
const CPU_SHARE = 0.72;            // our own JS takes more than this share of the frame: the GPU is not the limit, resolution will not help
const DOWN_AFTER_MS = 450, UP_AFTER_MS = 2600, RETRY_MS = 12000, RETRY_MAX_MS = 90000;

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FRAG = `
  uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uSharpen, uGrade;
  varying vec2 vUv;
  float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
  void main(){
    vec3 m = texture2D(tSrc, vUv).rgb;
    vec3 nw = texture2D(tSrc, vUv + vec2(-0.5, -0.5) * uTexel).rgb, ne = texture2D(tSrc, vUv + vec2(0.5, -0.5) * uTexel).rgb;
    vec3 sw = texture2D(tSrc, vUv + vec2(-0.5, 0.5) * uTexel).rgb, se = texture2D(tSrc, vUv + vec2(0.5, 0.5) * uTexel).rgb;
    float lM = luma(m), lNW = luma(nw), lNE = luma(ne), lSW = luma(sw), lSE = luma(se);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    float contrast = lMax - lMin;
    vec3 col = m;
    if (contrast > max(0.035, lMax * 0.11)) {                      // an edge: blend along it (FXAA, the short console form)
      vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
      float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
      dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -8.0, 8.0) * uTexel;
      vec3 a = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
      vec3 b = a * 0.5 + 0.25 * (texture2D(tSrc, vUv - dir * 0.5).rgb + texture2D(tSrc, vUv + dir * 0.5).rgb);
      float lB = luma(b);
      col = (lB < lMin || lB > lMax) ? a : b;
    } else {
      // flat or textured area: unsharp mask with the four diagonal taps (never on the hard edges: no halos, no jaggies back)
      col += (m - (nw + ne + sw + se) * 0.25) * uSharpen;
    }
    // grade: a little more depth in the darks and a little more colour (snow stays white: the curve is pinned at 0 and 1)
    float l = luma(col);
    col = mix(vec3(l), col, 1.0 + 0.1 * uGrade);
    col = mix(col, col * col * (3.0 - 2.0 * col), 0.16 * uGrade);
    // dither: half a step of noise hides the 8-bit bands of the sky gradient and the fog
    float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    gl_FragColor = vec4(col + (n - 0.5) / 255.0, 1.0);
  }`;

/** spec = QUALITY[level].res: { start, min, max, samples, sharpen, supersample } (pixel ratios against CSS pixels). */
export function createPost({ renderer, spec }) {
  let cfg = spec, cssW = 1, cssH = 1, ratio = spec.start, target = null, dynamic = true;
  const material = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2(1, 1) }, uSharpen: { value: 0.4 }, uGrade: { value: 1 } },
    vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, fog: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  renderer.info.autoReset = false;                   // two render calls a frame: the numbers of a frame are reset by hand below

  const screenRatio = () => Math.min(window.devicePixelRatio || 1, 2);
  const limits = () => {
    const top = Math.min(cfg.max, Math.max(screenRatio(), cfg.supersample || 1));    // never more than the screen can show (Héich may supersample a 1x screen)
    return { top, floor: Math.min(cfg.min, top) };
  };
  // controller state
  const ctl = { ema: BUDGET_MS, cpu: 0, over: 0, calm: 0, failedAt: Infinity, retryAt: 0, upAt: -1e9, retryWait: RETRY_MS, sum: 0, n: 0, changes: 0 };

  function allocate() {
    const w = Math.max(2, Math.round(cssW * ratio)), h = Math.max(2, Math.round(cssH * ratio));
    if (target && target.samples === cfg.samples) target.setSize(w, h);
    else {
      if (target) target.dispose();
      target = new THREE.WebGLRenderTarget(w, h, { samples: cfg.samples, depthBuffer: true, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    }
    material.uniforms.tSrc.value = target.texture;
    material.uniforms.uTexel.value.set(1 / w, 1 / h);
    // the more the picture is stretched, the more the sharpen may do
    material.uniforms.uSharpen.value = cfg.sharpen * Math.min(1.6, Math.max(0.6, screenRatio() / ratio));
  }
  function setRatio(next) {
    const { top, floor } = limits();
    const r = Math.min(top, Math.max(floor, next));
    if (Math.abs(r - ratio) < 1e-3 && target) return false;
    ratio = r;
    allocate();
    ctl.changes++;
    return true;
  }

  return {
    /** The canvas takes the screen's resolution (CSS size x device pixel ratio, at most 2); the scene target the internal one. */
    setSize(w, h) {
      cssW = w; cssH = h;
      renderer.setPixelRatio(screenRatio());
      renderer.setSize(w, h, false);
      const { top, floor } = limits();
      ratio = Math.min(top, Math.max(floor, ratio));
      allocate();
    },
    setSpec(next) {
      cfg = next;
      ctl.failedAt = Infinity; ctl.retryAt = 0; ctl.retryWait = RETRY_MS; ctl.over = 0; ctl.calm = 0;
      const { top, floor } = limits();
      ratio = Math.min(top, Math.max(floor, cfg.start));
      allocate();
    },
    render(scene, camera) {
      renderer.info.reset();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCam);
    },
    /** Once a frame while the game runs: frameMs = time since the last frame, cpuMs = our own JavaScript in it. */
    tick(frameMs, cpuMs) {
      if (frameMs > 250) return;                                  // a hitch (tab switch, a tile burst): not the steady state
      ctl.ema += (frameMs - ctl.ema) * 0.12; ctl.cpu += (cpuMs - ctl.cpu) * 0.12;
      ctl.sum += ratio; ctl.n++;
      if (!dynamic) return;
      const now = performance.now();
      const { top, floor } = limits();
      const gpuBound = ctl.cpu < ctl.ema * CPU_SHARE;
      if (ctl.ema > BUDGET_MS * OVER && gpuBound) { ctl.over += frameMs; ctl.calm = 0; }
      else if (ctl.ema < BUDGET_MS * CALM) { ctl.calm += frameMs; ctl.over = Math.max(0, ctl.over - frameMs); }
      else { ctl.over = Math.max(0, ctl.over - frameMs * 0.5); ctl.calm = 0; }
      if (ctl.over > DOWN_AFTER_MS && ratio > floor + 1e-3) {
        if (now < ctl.upAt + 6000) { ctl.failedAt = ratio; ctl.retryAt = now + ctl.retryWait; ctl.retryWait = Math.min(RETRY_MAX_MS, ctl.retryWait * 2); }   // the last step up was too much
        setRatio(ratio / (ctl.ema > BUDGET_MS * 1.7 ? STEP * STEP : STEP));
        ctl.over = 0; ctl.calm = 0; ctl.ema = BUDGET_MS * 1.05;
      } else if (ctl.calm > UP_AFTER_MS && ratio < top - 1e-3) {
        const next = Math.min(top, ratio * STEP);
        if (next < ctl.failedAt - 1e-3 || now > ctl.retryAt) { setRatio(next); ctl.upAt = now; }
        ctl.calm = 0;
      }
    },
    setDynamic(on) { dynamic = on; },
    /** The internal pixel ratio (point sprites size themselves by it). */
    ratio: () => ratio,
    atFloor: () => ratio <= limits().floor + 1e-3,
    stats: () => ({ ratio: +ratio.toFixed(3), average: ctl.n ? +(ctl.sum / ctl.n).toFixed(3) : ratio, width: target ? target.width : 0, height: target ? target.height : 0, samples: cfg.samples, screen: screenRatio(), changes: ctl.changes, frameEma: +ctl.ema.toFixed(1), cpuEma: +ctl.cpu.toFixed(1) }),
    resetStats() { ctl.sum = 0; ctl.n = 0; },
  };
}
