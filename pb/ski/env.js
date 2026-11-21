/* Sky, sun, fog, weather and time of day (the idea of pb/mtb/env.js, retuned for a winter day in the high Alps).
 * One set of shared uniforms that the painted materials read; the lights and THREE fog of the plain materials follow the same numbers.
 *   time:    morning (low sun from the south-east, cool shadows), midday (high, bright), evening (low gold light from the south-west)
 *   weather: sun, cloudy (flat white light, soft shadows), snow (snowfall, short sight), fog (a milky white-out a few hundred metres deep)
 * The player chooses both in the menu and in game ("Zoufälleg" = random is the default; the choice is stored per player). Weather never
 * changes a time or a score. */
const THREE = window.THREE;

export const TIME_IDS = Object.freeze(['morning', 'midday', 'evening']);
export const WEATHER_IDS = Object.freeze(['sun', 'cloudy', 'snow', 'fog']);
export const TIME_LABEL = Object.freeze({ random: 'Zoufälleg', morning: 'Moien', midday: 'Mëtteg', evening: 'Owend' });
export const WEATHER_LABEL = Object.freeze({ random: 'Zoufälleg', sun: 'Sonn', cloudy: 'Wolleken', snow: 'Schnéi', fog: 'Niwwel' });
export const WEATHER_ICON = Object.freeze({ sun: '☀️', cloudy: '☁️', snow: '🌨️', fog: '🌫️' });
export const TIME_ICON = Object.freeze({ morning: '🌅', midday: '🕛', evening: '🌇' });
const STORE = Object.freeze({ time: 'pb_ski_time', weather: 'pb_ski_weather' });
const RANDOM_WEATHER = ['sun', 'sun', 'sun', 'cloudy', 'snow', 'fog'];
const RANDOM_TIME = ['morning', 'midday', 'midday', 'evening'];

const c = (r, g, b) => [r, g, b];
/* sun azimuth (deg from north, clockwise) and elevation; colours are display values (the renderer does no sRGB conversion) */
const TIMES = Object.freeze({
  morning: { az: 128, el: 16, sun: c(1.0, 0.93, 0.84), i: 1.0, top: c(0.32, 0.5, 0.82), hor: c(0.86, 0.86, 0.9), amb: c(0.5, 0.62, 0.86), gnd: c(0.62, 0.64, 0.7), fog: c(0.78, 0.84, 0.94), glow: 0.5 },
  midday: { az: 182, el: 29, sun: c(1.0, 0.97, 0.9), i: 1.06, top: c(0.22, 0.44, 0.82), hor: c(0.74, 0.84, 0.95), amb: c(0.5, 0.62, 0.84), gnd: c(0.66, 0.68, 0.74), fog: c(0.74, 0.83, 0.95), glow: 0.1 },
  evening: { az: 236, el: 7, sun: c(1.0, 0.66, 0.4), i: 0.95, top: c(0.26, 0.36, 0.66), hor: c(1.0, 0.74, 0.56), amb: c(0.56, 0.54, 0.76), gnd: c(0.6, 0.52, 0.56), fog: c(0.92, 0.76, 0.7), glow: 1.0 },
});
/* cloud cover, sun share, fog density (1/m), greyness, ambient boost, snowfall, milky white-out */
const WEATHER = Object.freeze({
  sun: { cloud: 0.12, sun: 1, fog: 2.6e-5, grey: 0, amb: 1, snow: 0, milk: 0 },
  cloudy: { cloud: 1, sun: 0.22, fog: 5.5e-5, grey: 0.55, amb: 1.55, snow: 0, milk: 0.2 },
  snow: { cloud: 1, sun: 0.1, fog: 3.2e-4, grey: 0.72, amb: 1.6, snow: 1, milk: 0.55 },
  fog: { cloud: 0.9, sun: 0.12, fog: 2.4e-3, grey: 0.82, amb: 1.7, snow: 0.08, milk: 1 },
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

export function createEnv({ scene, noise, params = {} }) {
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
    const tw = WEATHER[weatherId], tt = TIMES[timeId];
    for (const key of Object.keys(tw)) cur[key] = lerp(cur[key], tw[key], k);
    for (const key of Object.keys(tt)) curTime[key] = Array.isArray(tt[key]) ? lerp3(curTime[key], tt[key], k) : lerp(curTime[key], tt[key], k);
    const T = curTime;
    const grey = (col, g, dim = 1) => { const m = (col[0] + col[1] + col[2]) / 3; return [lerp(col[0], m * 0.97, g) * dim, lerp(col[1], m * 0.99, g) * dim, lerp(col[2], m * 1.02, g) * dim]; };
    const milk = (col, t) => lerp3(col, [0.88, 0.9, 0.93], t);
    const sky = milk(grey(T.top, cur.grey * 0.9), cur.milk * 0.8), hor = milk(grey(T.hor, cur.grey), cur.milk);
    u.uSkyTop.value.set(...sky); u.uSkyHorizon.value.set(...hor);
    const fog = milk(grey(T.fog, cur.grey), cur.milk);
    u.uFogColor.value.set(...fog);
    const amb = grey(T.amb, cur.grey * 0.6);
    u.uAmbSky.value.set(amb[0] * cur.amb, amb[1] * cur.amb, amb[2] * cur.amb);
    u.uAmbGround.value.set(...grey(T.gnd, cur.grey * 0.4));
    const az = T.az * Math.PI / 180, el = T.el * Math.PI / 180;
    u.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const si = T.i * cur.sun;
    u.uSunColor.value.set(T.sun[0] * si, T.sun[1] * si, T.sun[2] * si);
    u.uFogDensity.value = cur.fog;
    u.uCloud.value = cur.cloud; u.uSnowfall.value = cur.snow; u.uGlow.value = T.glow * (1 - cur.grey); u.uOvercast.value = cur.grey;
    state.snowfall = cur.snow;
    hemi.color.setRGB(u.uAmbSky.value.x * 0.85, u.uAmbSky.value.y * 0.85, u.uAmbSky.value.z * 0.85);
    hemi.groundColor.setRGB(u.uAmbGround.value.x * 0.9, u.uAmbGround.value.y * 0.9, u.uAmbGround.value.z * 0.9);     // snow throws a lot of light back up
    sun.color.setRGB(u.uSunColor.value.x, u.uSunColor.value.y, u.uSunColor.value.z);
    hemi.intensity = Math.PI;                       // three r160 lights are physically based: x PI gives colour * cos as authored
    sun.intensity = Math.PI * 0.7;
    scene.fog.color.setRGB(fog[0], fog[1], fog[2]);
    scene.fog.density = cur.fog;
  }

  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }',
    fragmentShader: `
      uniform vec3 uSunDir, uSunColor, uSkyTop, uSkyHorizon, uFogColor; uniform float uTime, uCloud, uGlow, uOvercast, uFogDensity; uniform sampler2D uNoise;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float up = max(d.y, 0.0);
        vec3 col = mix(uSkyHorizon, uSkyTop, pow(up, 0.55));
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (pow(sd, 900.0) * 3.0 + pow(sd, 12.0) * 0.18 * (1.0 - uOvercast) + pow(sd, 3.0) * 0.12 * uGlow);
        // painted clouds: two noise octaves projected on a flat layer, drifting
        vec2 cp = d.xz / max(d.y + 0.08, 0.06) * 0.22 + vec2(uTime * 0.0035, uTime * 0.0012);
        float n = texture2D(uNoise, cp).r * 0.62 + texture2D(uNoise, cp * 2.7).g * 0.38;
        float cover = smoothstep(0.62 - uCloud * 0.5, 0.86 - uCloud * 0.32, n) * smoothstep(-0.02, 0.18, d.y);
        vec3 cloud = mix(vec3(0.97, 0.97, 0.99), uSkyHorizon * 0.92, 0.25 + 0.4 * uOvercast) + uSunColor * 0.12 * pow(sd, 4.0);
        col = mix(col, cloud, cover * (0.85 + 0.15 * uCloud));
        // haze near the horizon and below it: the colour the far mountains fog into
        float haze = 1.0 - smoothstep(-0.05, 0.22, d.y);
        col = mix(col, uFogColor, clamp(haze + uOvercast * 0.25 + min(uFogDensity * 1200.0, 1.0) * 0.9, 0.0, 1.0));
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
  function setTime(mode) {
    timeMode = mode; writeChoice(STORE.time, mode);
    timeId = mode === 'random' ? pick(RANDOM_TIME) : mode;
    state.timeId = timeId; state.timeMode = mode;
  }
  function setWeather(mode) {
    weatherMode = mode; writeChoice(STORE.weather, mode);
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
  };
}
