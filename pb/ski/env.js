/* Sky, sun, fog, weather and time of day (the idea of pb/mtb/env.js, retuned for a winter day in the high Alps).
 * One set of shared uniforms that the painted materials read; the lights and THREE fog of the plain materials follow the same numbers.
 *   time:    morning (low sun from the south-east, cool shadows), midday (high, bright), evening (low gold light from the south-west)
 *   weather: sun, cloudy (flat white light, soft shadows), snow (snowfall, short sight), fog (a milky white-out a few hundred metres deep)
 * The player chooses both in the menu and in game ("Zoufälleg" = random is the default; the choice is stored per player). Weather never
 * changes a time or a score. */
import { shadowUniforms } from './shadows.js';
import { RANDOM_WEATHER, RANDOM_TIME } from './config.js';

const THREE = window.THREE;

export const TIME_IDS = Object.freeze(['morning', 'midday', 'evening']);
export const WEATHER_IDS = Object.freeze(['sun', 'cloudy', 'snow', 'fog']);
export const TIME_LABEL = Object.freeze({ random: 'Zoufälleg', morning: 'Moien', midday: 'Mëtteg', evening: 'Owend' });
export const WEATHER_LABEL = Object.freeze({ random: 'Zoufälleg', sun: 'Sonn', cloudy: 'Wolleken', snow: 'Schnéi', fog: 'Niwwel' });
export const WEATHER_ICON = Object.freeze({ sun: '☀️', cloudy: '☁️', snow: '🌨️', fog: '🌫️' });
export const TIME_ICON = Object.freeze({ morning: '🌅', midday: '🕛', evening: '🌇' });
const STORE = Object.freeze({ time: 'pb_ski_time', weather: 'pb_ski_weather' });
const DAY_KEYS = Object.freeze({ morning: 9.5, midday: 12.5, evening: 16.2 });       // the hour each look stands for (free ride day clock)

const c = (r, g, b) => [r, g, b];
/* sun azimuth (deg from north, clockwise) and elevation; colours are display values (the renderer does no sRGB conversion) */
const TIMES = Object.freeze({
  morning: { az: 128, el: 16, sun: c(1.0, 0.93, 0.84), i: 1.0, top: c(0.32, 0.5, 0.82), hor: c(0.86, 0.86, 0.9), amb: c(0.5, 0.62, 0.86), gnd: c(0.62, 0.64, 0.7), fog: c(0.78, 0.84, 0.94), glow: 0.5 },
  midday: { az: 182, el: 29, sun: c(1.0, 0.97, 0.9), i: 1.06, top: c(0.22, 0.44, 0.82), hor: c(0.74, 0.84, 0.95), amb: c(0.5, 0.62, 0.84), gnd: c(0.66, 0.68, 0.74), fog: c(0.74, 0.83, 0.95), glow: 0.1 },
  evening: { az: 236, el: 7, sun: c(1.0, 0.66, 0.4), i: 0.95, top: c(0.26, 0.36, 0.66), hor: c(1.0, 0.74, 0.56), amb: c(0.47, 0.56, 0.8), gnd: c(0.57, 0.56, 0.64), fog: c(0.92, 0.76, 0.7), glow: 1.0 },
});
/* cloud cover, sun share, fog density (1/m), greyness, ambient boost, snowfall, milky white-out */
const WEATHER = Object.freeze({
  sun: { cloud: 0.12, sun: 1, fog: 2.6e-5, grey: 0, amb: 1, snow: 0, milk: 0 },
  cloudy: { cloud: 1, sun: 0.22, fog: 5.5e-5, grey: 0.55, amb: 1.55, snow: 0, milk: 0.2 },
  snow: { cloud: 1, sun: 0.1, fog: 3.2e-4, grey: 0.72, amb: 1.75, snow: 1, milk: 0.55 },
  fog: { cloud: 0.9, sun: 0.14, fog: 2.1e-3, grey: 0.8, amb: 1.95, snow: 0.08, milk: 1 },     // bright alpine white-out: white-blue, never mud grey
});

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function readChoice(key, ids) {
  try { const v = localStorage.getItem(key); if (v === 'random' || ids.includes(v)) return v; } catch (error) { console.warn('[ski] storage blocked', error); }
  return 'random';
}
function writeChoice(key, value) {
  try { localStorage.setItem(key, value); } catch (error) { console.warn('[ski] could not store the choice', error); }
}

/** A 256 x 256 tileable value-noise texture (RGBA: four independent octaves), shared by the sky, the snow and the trees. */
export function createNoiseTexture() {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const lattice = (seed, cells) => { const g = new Float32Array(cells * cells); let s = seed; for (let i = 0; i < g.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; g[i] = s / 4294967296; } return g; };
  const octave = [[7, 8], [13, 16], [29, 32], [41, 64]];
  const grids = octave.map(([seed, cells]) => ({ g: lattice(seed, cells), cells }));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      for (let k = 0; k < 4; k++) {
        const { g, cells } = grids[k];
        const fx = x / N * cells, fy = y / N * cells;
        const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
        const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty);
        const at = (i, j) => g[((j + cells) % cells) * cells + ((i + cells) % cells)];
        const v = (at(ix, iy) * (1 - ux) + at(ix + 1, iy) * ux) * (1 - uy) + (at(ix, iy + 1) * (1 - ux) + at(ix + 1, iy + 1) * ux) * uy;
        data[(y * N + x) * 4 + k] = Math.round(v * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Tileable value noise of one octave on an N x N raster (cells lattice cells across the tile), 0..1. */
function octave(N, cells, seed) {
  const g = new Float32Array(cells * cells);
  let s = seed;
  for (let i = 0; i < g.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; g[i] = s / 4294967296; }
  const out = new Float32Array(N * N);
  const k = cells / N;
  for (let y = 0; y < N; y++) {
    const fy = y * k, iy = Math.floor(fy), ty = fy - iy, uy = ty * ty * (3 - 2 * ty);
    const r0 = (iy % cells) * cells, r1 = ((iy + 1) % cells) * cells;
    for (let x = 0; x < N; x++) {
      const fx = x * k, ix = Math.floor(fx), tx = fx - ix, ux = tx * tx * (3 - 2 * tx);
      const c0 = ix % cells, c1 = (ix + 1) % cells;
      out[y * N + x] = (g[r0 + c0] * (1 - ux) + g[r0 + c1] * ux) * (1 - uy) + (g[r1 + c0] * (1 - ux) + g[r1 + c1] * ux) * uy;
    }
  }
  return out;
}

/** The fine detail of the painted ground (round 5), one tileable 256 x 256 RGBA texture with mipmaps and anisotropic filtering:
 *  RG = the slope (d/dx, d/dz) of a grainy snow surface (wind crust, small lumps): bends the light close by, so snow is never flat;
 *  B  = sparse sparkle grains; A = crags (ridged noise): breaks up rock faces and strata. Our own noise, no photo. */
export function createDetailTexture(anisotropy = 8) {
  const N = 256;
  const h1 = octave(N, 16, 11), h2 = octave(N, 32, 23), h3 = octave(N, 64, 37), h4 = octave(N, 128, 51);
  const c1 = octave(N, 8, 61), c2 = octave(N, 16, 73), c3 = octave(N, 32, 89), c4 = octave(N, 64, 97);
  const H = new Float32Array(N * N);
  for (let i = 0; i < H.length; i++) H[i] = h1[i] * 0.42 + h2[i] * 0.3 + h3[i] * 0.18 + h4[i] * 0.1;
  const data = new Uint8Array(N * N * 4);
  const ridge = (v) => 1 - Math.abs(2 * v - 1);
  let s = 977;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const dx = H[y * N + (x + 1) % N] - H[y * N + (x + N - 1) % N], dz = H[((y + 1) % N) * N + x] - H[((y + N - 1) % N) * N + x];
      data[i * 4] = clamp(127.5 + dx * 1500); data[i * 4 + 1] = clamp(127.5 + dz * 1500);
      data[i * 4 + 2] = rnd() > 0.965 ? clamp(120 + rnd() * 135) : 0;
      const crag = ridge(c1[i]) * 0.4 + ridge(c2[i]) * 0.3 + ridge(c3[i]) * 0.2 + ridge(c4[i]) * 0.1;
      data[i * 4 + 3] = clamp(crag * 255);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/** The far grid (40 m heights, the box + 14 km) as a normal map: RG = the ground normal's x / z, B = relief (0.5 flat, ridges brighter,
 *  hollows darker). Far terrain tiles are much coarser than 40 m; lit per pixel from this map the far mountains keep their ridges, gullies
 *  and faces at every Grafik level. Derived from the height data at load (about 10 ms), nothing shipped. */
export function createFarNormalTexture(far, spacing = 40) {
  const { nx, nz, data: h } = far;
  const px = new Uint8Array(nx * nz * 4);
  const st = spacing;                          // m between the grid's nodes (far.step is the height quantum, not this)
  for (let j = 0; j < nz; j++) {
    const jn = Math.max(0, j - 1), js = Math.min(nz - 1, j + 1);
    for (let i = 0; i < nx; i++) {
      const iw = Math.max(0, i - 1), ie = Math.min(nx - 1, i + 1);
      const c = h[j * nx + i], w = h[j * nx + iw], e = h[j * nx + ie], n = h[jn * nx + i], so = h[js * nx + i];
      const dx = (e - w) / ((ie - iw) * st), dz = (so - n) / ((js - jn) * st);
      const inv = 1 / Math.hypot(dx, 1, dz);
      const curve = (w + e + n + so - 4 * c) / st;                   // > 0 in a hollow, < 0 on a ridge
      const o = (j * nx + i) * 4;
      px[o] = Math.round(127.5 - dx * inv * 127); px[o + 1] = Math.round(127.5 - dz * inv * 127);
      px[o + 2] = Math.max(0, Math.min(255, Math.round(127.5 - curve * 190)));
      px[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(px, nx, nz, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

export function createEnv({ scene, noise, detail = null, params = {} }) {
  let timeMode = params.time && (params.time === 'random' || TIME_IDS.includes(params.time)) ? params.time : readChoice(STORE.time, TIME_IDS);
  let weatherMode = params.weather && (params.weather === 'random' || WEATHER_IDS.includes(params.weather)) ? params.weather : readChoice(STORE.weather, WEATHER_IDS);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  let timeId = timeMode === 'random' ? pick(RANDOM_TIME) : timeMode;
  let weatherId = weatherMode === 'random' ? pick(RANDOM_WEATHER) : weatherMode;
  const V = () => new THREE.Vector3();
  const u = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: V() }, uSkyTop: { value: V() }, uSkyHorizon: { value: V() },
    uAmbSky: { value: V() }, uAmbGround: { value: V() }, uFogColor: { value: V() }, uFogDensity: { value: 3e-5 },
    uTime: { value: 0 }, uCloud: { value: 0 }, uSnowfall: { value: 0 }, uGlow: { value: 0 }, uOvercast: { value: 0 }, uNoise: { value: noise },
    // round 5: fine ground detail, the far grid's normal map (same rectangle as uShadowRect), the weather's haze share
    uDetail: { value: detail || noise }, uFarN: { value: noise }, uFarNOn: { value: 0 }, uMilk: { value: 0 },
    // mountain shadows of the current time of day (baked, see scripts/ski/bake.py sun_shadows): a raster over the far grid
    uShadow: { value: noise }, uShadowOn: { value: 0 }, uShadowRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    ...shadowUniforms(),
  };
  let shadowUrl = null, shadowFor = null, shadowTarget = 0, sunScale = 1;
  const loader = new THREE.TextureLoader();
  function loadShadow() {
    if (!shadowUrl || shadowFor === timeId) return;
    const want = timeId;
    shadowFor = want;
    shadowTarget = 0;
    loader.load(shadowUrl(want), (tex) => {
      if (timeId !== want) { tex.dispose(); return; }
      tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.flipY = false;                               // row 0 of the raster is the north edge (z = rect.y): no flip
      const old = u.uShadow.value;
      u.uShadow.value = tex;
      if (old && old !== noise) old.dispose();
      shadowTarget = 1;
    }, undefined, (error) => console.warn('[ski] shadow raster failed', error && error.message));
  }
  // round 4A free ride: a day clock (hours) blends the light between the three times of day while the time choice is "random"
  let dayHour = null;
  const blendTimes = (h) => {
    const keys = [[DAY_KEYS.morning, TIMES.morning], [DAY_KEYS.midday, TIMES.midday], [DAY_KEYS.evening, TIMES.evening]];
    if (h <= keys[0][0]) return TIMES.morning;
    if (h >= keys[2][0]) return TIMES.evening;
    const i = h < keys[1][0] ? 0 : 1;
    const t = (h - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
    const a = keys[i][1], b = keys[i + 1][1], out = {};
    for (const k of Object.keys(a)) out[k] = Array.isArray(a[k]) ? lerp3(a[k], b[k], t) : lerp(a[k], b[k], t);
    return out;
  };
  let cur = { ...WEATHER[weatherId] };
  let curTime = { ...TIMES[timeId] };
  const state = { timeId, weatherId, timeMode, weatherMode, snowfall: 0 };

  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  scene.add(hemi, sun, sun.target);
  scene.fog = new THREE.FogExp2(0xffffff, 3e-5);

  function apply(dt, snap) {
    const k = snap ? 1 : Math.min(1, dt * 0.7);
    const tw = WEATHER[weatherId], tt = dayHour === null ? TIMES[timeId] : blendTimes(dayHour);
    for (const key of Object.keys(tw)) cur[key] = lerp(cur[key], tw[key], k);
    for (const key of Object.keys(tt)) curTime[key] = Array.isArray(tt[key]) ? lerp3(curTime[key], tt[key], k) : lerp(curTime[key], tt[key], k);
    const T = curTime;
    const grey = (col, g, dim = 1) => { const m = (col[0] + col[1] + col[2]) / 3; return [lerp(col[0], m * 0.97, g) * dim, lerp(col[1], m * 0.99, g) * dim, lerp(col[2], m * 1.02, g) * dim]; };
    const milk = (col, t) => lerp3(col, [0.9, 0.935, 0.985], t);          // the white-out: bright, a breath of blue
    const sky = milk(grey(T.top, cur.grey * 0.9), cur.milk * 0.8), hor = milk(grey(T.hor, cur.grey), cur.milk);
    u.uSkyTop.value.set(...sky); u.uSkyHorizon.value.set(...hor);
    const fog = milk(grey(T.fog, cur.grey), cur.milk);
    u.uFogColor.value.set(...fog);
    const amb = grey(T.amb, cur.grey * 0.95);                 // overcast light is neutral white, not sky blue
    u.uAmbSky.value.set(amb[0] * cur.amb, amb[1] * cur.amb, amb[2] * cur.amb);
    u.uAmbGround.value.set(...grey(T.gnd, cur.grey * 0.4));
    const az = T.az * Math.PI / 180, el = T.el * Math.PI / 180;
    u.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const si = T.i * cur.sun;
    u.uSunColor.value.set(T.sun[0] * si, T.sun[1] * si, T.sun[2] * si);
    u.uFogDensity.value = cur.fog;
    u.uCloud.value = cur.cloud; u.uSnowfall.value = cur.snow; u.uGlow.value = T.glow * (1 - cur.grey); u.uOvercast.value = cur.grey; u.uMilk.value = cur.milk;
    state.snowfall = cur.snow;
    u.uShadowOn.value = lerp(u.uShadowOn.value, shadowTarget, snap ? 1 : Math.min(1, dt * 2));
    hemi.color.setRGB(u.uAmbSky.value.x * 0.85, u.uAmbSky.value.y * 0.85, u.uAmbSky.value.z * 0.85);
    hemi.groundColor.setRGB(u.uAmbGround.value.x * 0.9, u.uAmbGround.value.y * 0.9, u.uAmbGround.value.z * 0.9);     // snow throws a lot of light back up
    sun.color.setRGB(u.uSunColor.value.x, u.uSunColor.value.y, u.uSunColor.value.z);
    hemi.intensity = Math.PI;                       // three r160 lights are physically based: x PI gives colour * cos as authored
    sun.intensity = Math.PI * 0.7 * sunScale;
    scene.fog.color.setRGB(fog[0], fog[1], fog[2]);
    scene.fog.density = cur.fog;
  }

  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }',
    fragmentShader: `
      uniform vec3 uSunDir, uSunColor, uSkyTop, uSkyHorizon, uFogColor; uniform float uTime, uCloud, uGlow, uOvercast, uFogDensity, uMilk; uniform sampler2D uNoise;
      varying vec3 vDir;
      // four octaves in one read: the channels of the noise texture hold 8, 16, 32 and 64 lattice cells
      float cloudField(vec2 p){ vec4 a = texture2D(uNoise, p); return a.r * 0.5 + a.g * 0.27 + a.b * 0.15 + a.a * 0.08; }
      void main(){
        vec3 d = normalize(vDir);
        float up = max(d.y, 0.0);
        float sd = max(dot(d, uSunDir), 0.0);
        float clear = 1.0 - uOvercast;
        // the painted gradient: a pale band at the horizon, the sky's blue, a deeper zenith
        vec3 col = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, 1.0, pow(up, 0.48)));
        col = mix(col, uSkyTop * vec3(0.8, 0.86, 0.96), pow(up, 1.5) * 0.5);
        // the sun: a wide warm glow (low sun), a halo, the disc
        col += uSunColor * (pow(sd, 5.0) * 0.2 * uGlow + pow(sd, 36.0) * 0.2 * clear + pow(sd, 420.0) * 0.5 * clear);
        col += vec3(1.0, 0.985, 0.95) * uOvercast * (pow(sd, 18.0) * 0.1 + pow(sd, 160.0) * 0.16);          // behind cloud: a pale bright patch
        float disc = smoothstep(0.99955, 0.99975, sd) * clear;
        col = mix(col, mix(uSunColor, vec3(1.0), 0.6), disc);
        // painted clouds on a flat layer: body from the noise, a crisp brushed edge, lit from the sun's side, grey-blue bellies
        vec2 cp = d.xz / max(d.y + 0.1, 0.07);
        vec2 wind = vec2(uTime * 0.0032, uTime * 0.0011);
        vec2 q = cp * 0.085 + wind;
        float fine = texture2D(uNoise, cp * 0.7 + wind * 4.0).g * 0.6 + texture2D(uNoise, cp * 2.9 + wind * 9.0).b * 0.4;     // small tufts: the edges are never the noise's own facets
        float n = cloudField(q) * 0.87 + fine * 0.13;
        float lo = 0.585 - uCloud * 0.36;
        float cover = (smoothstep(lo, lo + 0.075, n) * 0.7 + smoothstep(lo, lo + 0.22, n) * 0.3) * smoothstep(0.0, 0.13, d.y);
        vec2 toSun = uSunDir.xz / max(length(uSunDir.xz), 1e-3);
        float n2 = cloudField(q + toSun * 0.022) * 0.87 + fine * 0.13;
        float sunSide = clamp((n - n2) * 7.0 + 0.55, 0.0, 1.0);
        vec3 bright = mix(vec3(1.0, 0.995, 0.985), uSunColor, 0.35 * clear) * (0.93 + 0.07 * clear);
        vec3 belly = mix(uSkyHorizon * vec3(0.74, 0.78, 0.86), vec3(0.6, 0.66, 0.78), 0.45);
        float thick = smoothstep(lo + 0.05, lo + 0.34, n);
        vec3 cloud = mix(belly, bright, clamp(sunSide * (1.0 - 0.45 * thick) + 0.25 * (1.0 - thick), 0.0, 1.0));
        cloud = mix(cloud, mix(vec3(0.9, 0.92, 0.95), vec3(0.72, 0.75, 0.81), thick * (1.0 - sunSide * 0.6)), uOvercast * 0.85);   // overcast: a moving grey ceiling, never flat
        cloud += uSunColor * 0.22 * pow(sd, 6.0) * (1.0 - thick);                                              // thin edges glow near the sun
        col = mix(col, cloud, cover * (0.9 + 0.1 * uCloud));
        // haze near the horizon and below it: the colour the far mountains fade into; a white-out takes the whole sky
        float haze = 1.0 - smoothstep(-0.05, 0.2, d.y);
        vec3 hazeCol = uFogColor + uSunColor * pow(sd, 5.0) * 0.14;
        col = mix(col, hazeCol, clamp(haze * 0.92 + uMilk * 0.55 + min(uFogDensity * 900.0, 1.0) * 0.75, 0.0, 1.0));
        col += vec3(1.0, 0.985, 0.95) * uMilk * pow(sd, 10.0) * 0.1;                                          // the sun's glow through the fog
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  apply(0, true);

  function cycleTime() {
    const order = ['random', ...TIME_IDS];
    timeMode = order[(order.indexOf(timeMode) + 1) % order.length];
    setTime(timeMode);
    return timeMode;
  }
  function cycleWeather() {
    const order = ['random', ...WEATHER_IDS];
    weatherMode = order[(order.indexOf(weatherMode) + 1) % order.length];
    setWeather(weatherMode);
    return weatherMode;
  }
  /* save = false: a race sets the weather / time for everybody (pb/ski/net), the player's own stored choice stays */
  function setTime(mode, save = true) {
    timeMode = mode; if (save) writeChoice(STORE.time, mode);
    timeId = mode === 'random' ? pick(RANDOM_TIME) : mode;
    state.timeId = timeId; state.timeMode = mode;
    u.uShadowOn.value = 0;
    loadShadow();
  }
  function setWeather(mode, save = true) {
    weatherMode = mode; if (save) writeChoice(STORE.weather, mode);
    weatherId = mode === 'random' ? pick(RANDOM_WEATHER) : mode;
    state.weatherId = weatherId; state.weatherMode = mode;
  }

  return {
    u, state, sky, sun,
    update(dt, t, camera) {
      u.uTime.value = t;
      apply(dt, false);
      sky.position.copy(camera.position);
      sky.scale.setScalar(camera.far * 0.9);
      sun.position.copy(camera.position).addScaledVector(u.uSunDir.value, 100);
      sun.target.position.copy(camera.position);
    },
    snap() { apply(0, true); },
    cycleTime, cycleWeather, setTime, setWeather,
    /** urlOf(timeId) -> the shadow raster URL; rect = [x0, z0, width, depth] of the raster in world metres (pixel edges). */
    /** The far grid's normal map (createFarNormalTexture); its rectangle is the shadow rasters' (setShadows). */
    setFarNormals(tex) { u.uFarN.value = tex; u.uFarNOn.value = 1; },
    setShadows(urlOf, rect) { shadowUrl = urlOf; u.uShadowRect.value.set(rect[0], rect[1], rect[2], rect[3]); shadowFor = null; loadShadow(); },
    sunDir: () => (dayHour === null ? TIMES[timeId] : blendTimes(dayHour)),
    /** Round 4A free ride: the light follows this hour (null = the chosen time of day again); the shadow raster of the nearest time. */
    setDayHour(h) {
      dayHour = h === null || timeMode !== 'random' ? null : h;
      if (dayHour === null) return;
      const near = dayHour < (DAY_KEYS.morning + DAY_KEYS.midday) / 2 ? 'morning' : dayHour < (DAY_KEYS.midday + DAY_KEYS.evening) / 2 ? 'midday' : 'evening';
      if (near !== timeId) { timeId = near; state.timeId = near; loadShadow(); }
    },
    /** 0..1: how much sun reaches the skier (main.js marches a ray to the sun over the terrain); dims the sun on the plain materials. */
    setSunScale(k) { sunScale = sunScale + (k - sunScale) * 0.25; },
    /** 0..1: how strong the sun is now (weather share; shadows are skipped below 0.3). */
    sunStrength: () => cur.sun,
  };
}
