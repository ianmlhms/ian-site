/* Sun shadows near the skier (Mëttel / Héich): THREE renders the sun's shadow map (terrain, trees, buildings, lifts and the skier cast
 * into it; the instanced trees bring their own depth material), and every painted material samples it itself through the GLSL below
 * (R8d: a 3 x 3 B-spline PCF, was 2 x 2 bilinear; with a normal offset, faded out at the edge of the shadow box). The box follows the camera, a little ahead of it,
 * snapped to whole texels so the shadow edges do not crawl. Beyond the box the baked mountain shadows (env.js uShadow) take over.
 * Niddreg has no shadow map: blob shadows under the skier and the near trees instead (skier-model.js, scatter-view.js). */
const THREE = window.THREE;

/* per quality level: shadow map size (texels) and half width of the box (m) */
export const SHADOW_SPEC = Object.freeze({
  low: null,
  medium: { size: 1024, half: 95, depth: 1600 },
  high: { size: 2048, half: 150, depth: 2200 },
});

/** Uniforms shared by the painted materials (merged into env.u). */
export function shadowUniforms() {
  return {
    uSunMap: { value: null }, uSunMatrix: { value: new THREE.Matrix4() }, uSunMapOn: { value: 0 }, uSunTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    uSunNormalBias: { value: 0.25 }, uSunL: { value: new THREE.Vector3(0, 1, 0) },
  };
}

/** GLSL: sunMapShadow(worldPos, worldNormal) -> 1 lit .. 0 in shadow (1 outside the box or with shadows off). Needs #include <packing>. */
export const SHADOW_GLSL = `
  uniform sampler2D uSunMap; uniform mat4 uSunMatrix; uniform float uSunMapOn, uSunNormalBias; uniform vec2 uSunTexel; uniform vec3 uSunL;
  float sunTap(vec2 uv, float z){ return step(z, unpackRGBAToDepth(texture2D(uSunMap, uv))); }
  float sunMapShadow(vec3 wp, vec3 n){
    if (uSunMapOn < 0.5) return 1.0;
    // round 7: the offsets grow where the sun grazes the surface (a low sun on the snow drew dark acne streaks)
    float graze = 1.0 - clamp(dot(n, uSunL), 0.0, 1.0);
    vec4 sc = uSunMatrix * vec4(wp + n * uSunNormalBias * (1.0 + 2.5 * graze), 1.0);
    vec3 c = sc.xyz / sc.w;
    if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
    float z = c.z - 0.0006 - 0.0014 * graze * graze;
    // R8d (QA: stair-step shadow edges at the stations): a 3 x 3 tap quadratic B-spline (the 2 x 2 bilinear PCF averaged over a texel):
    //      smooth edges instead of the texel staircase; separable weights round the nearest texel centre
    vec2 size = 1.0 / uSunTexel;
    vec2 t = c.xy * size - 0.5;
    vec2 i0 = floor(t + 0.5), d = t - i0;
    vec2 wm = 0.5 * (0.5 - d) * (0.5 - d), wp = 0.5 * (0.5 + d) * (0.5 + d), w0 = 0.75 - d * d;
    vec2 b = (i0 + 0.5) * uSunTexel, e = uSunTexel;
    float s = wm.y * (wm.x * sunTap(b + vec2(-e.x, -e.y), z) + w0.x * sunTap(b + vec2(0.0, -e.y), z) + wp.x * sunTap(b + vec2(e.x, -e.y), z))
            + w0.y * (wm.x * sunTap(b + vec2(-e.x, 0.0), z) + w0.x * sunTap(b, z) + wp.x * sunTap(b + vec2(e.x, 0.0), z))
            + wp.y * (wm.x * sunTap(b + vec2(-e.x, e.y), z) + w0.x * sunTap(b + vec2(0.0, e.y), z) + wp.x * sunTap(b + vec2(e.x, e.y), z));
    float edge = smoothstep(0.0, 0.12, min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y)));
    return mix(1.0, s, edge);
  }`;

/** Depth material for the instanced scatter meshes (same vertex transform as their colour material). */
export function instancedDepthMaterial(vertexBody) {
  return new THREE.ShaderMaterial({
    vertexShader: vertexBody,
    fragmentShader: '#include <packing>\nvoid main(){ gl_FragColor = packDepthToRGBA(gl_FragCoord.z); }',
  });
}

export function createShadows({ renderer, sun, u }) {
  let spec = null;
  const snap = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const sunDir = new THREE.Vector3();
  const blank = (() => { const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; return t; })();
  u.uSunMap.value = blank;

  function setLevel(level) {
    spec = SHADOW_SPEC[level] || null;
    renderer.shadowMap.enabled = !!spec;
    renderer.shadowMap.type = THREE.BasicShadowMap;          // we filter ourselves; three's Lambert receivers (skier, lifts) get the plain lookup
    renderer.shadowMap.autoUpdate = true;
    sun.castShadow = !!spec;
    if (spec) {
      if (sun.shadow.map && sun.shadow.mapSize.x !== spec.size) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      sun.shadow.mapSize.set(spec.size, spec.size);
      const cam = sun.shadow.camera;
      cam.left = -spec.half; cam.right = spec.half; cam.top = spec.half; cam.bottom = -spec.half;
      cam.near = 1; cam.far = spec.depth * 2;
      cam.updateProjectionMatrix();
      sun.shadow.bias = -0.0008;
      sun.shadow.normalBias = 0.04;
      u.uSunTexel.value.set(1 / spec.size, 1 / spec.size);
      u.uSunNormalBias.value = spec.half * 2 / spec.size * 1.6;
    }
    u.uSunMapOn.value = 0;
    renderer.shadowMap.needsUpdate = true;
  }

  /** Places the box in front of the camera (snapped to texels in the light's frame); call before render. */
  function update(camera, sunDirection, sunStrength) {
    if (!spec) { u.uSunMapOn.value = 0; return; }
    camera.getWorldDirection(fwd);
    fwd.y = 0; if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0); fwd.normalize();
    snap.copy(camera.position).addScaledVector(fwd, spec.half * 0.55);
    // snap the centre to whole texels along the light's two screen axes
    sunDir.copy(sunDirection).normalize();
    u.uSunL.value.copy(sunDir);
    const texel = spec.half * 2 / spec.size;
    const right = new THREE.Vector3().crossVectors(sunDir, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, sunDir).normalize();
    const a = Math.round(snap.dot(right) / texel) * texel - snap.dot(right);
    const b = Math.round(snap.dot(up) / texel) * texel - snap.dot(up);
    snap.addScaledVector(right, a).addScaledVector(up, b);
    sun.target.position.copy(snap);
    sun.position.copy(snap).addScaledVector(sunDir, spec.depth);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    const on = sunStrength > 0.3;                 // fog / thick cloud: no visible sun shadows, no shadow pass
    sun.castShadow = on;
    u.uSunMatrix.value = sun.shadow.matrix;      // the same object: three updates it during the shadow pass of this very frame
    if (sun.shadow.map) u.uSunMap.value = sun.shadow.map.texture;
    u.uSunMapOn.value = on && sun.shadow.map ? 1 : 0;
  }
  return { setLevel, update, get on() { return !!spec; } };
}
