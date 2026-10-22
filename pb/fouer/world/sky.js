/* Schueberfouer Tycoon, W2: sky, sun / moon, time of day and weather (DESIGN 4.5).
 *
 *   const env = createEnv({ T, scene, renderer, world, quality });
 *   env.setWeather('random' | 'clear' | 'cloudy' | 'rain' | 'fog');   env.setTime('random' | 'morning' | 'noon' | 'evening' | 'night' | 'live');
 *   env.update(dt, camera);  env.getState() -> { weatherMode, timeMode, weather, hour, sunElevation, night }
 * Both choices are player-chosen (a menu and the in-game button, stage.js) and remembered per device in localStorage (pb_fouer_weather / pb_fouer_time),
 * Random is the default: a random start, then a slow day drift (12 real minutes = 24 h) and a weather change every 4-8 minutes.  They are visual only.
 * Draw calls: the sky dome (gradient + sun / moon / stars / procedural clouds in one fragment shader) and one fullscreen rain overlay.
 * Lights: one hemisphere + one directional (sun by day, a blue moon by night), exponential fog tinted to the horizon, no real-time shadows. */
import { COS, SIN } from './frame.js';

const DEG = Math.PI / 180;
const LAT = 49.61 * DEG;
const WEATHERS = ['clear', 'cloudy', 'rain', 'fog'];
const TIMES = { morning: 8, noon: 13, evening: 19.5, night: 22.5 };
const KEYS = { weather: 'pb_fouer_weather', time: 'pb_fouer_time' };
const SOLAR_NOON = 13.62;          // Luxembourg, CEST, late August
const DAY_SECONDS = 720;           // Random: one day = 12 minutes
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* sun elevation keyframes: [elevation deg, zenith, horizon, sun colour, sun intensity, hemisphere sky, hemisphere ground, hemisphere intensity, fog colour, exposure] */
const KF = [
  [-20, '#050a1a', '#0e1830', '#4466aa', 0.0, '#26396a', '#161c26', 0.95, '#101a2e', 1.25],
  [-9, '#0a1634', '#2a315a', '#7a7fbb', 0.0, '#34477a', '#1c222c', 0.85, '#2a3152', 1.15],
  [-3, '#1c3260', '#d9806f', '#ff8a5a', 0.6, '#52628f', '#2b2a2c', 0.62, '#c98a86', 1.05],
  [2, '#365f9c', '#ffb680', '#ffa760', 1.7, '#7390b8', '#4a4036', 0.85, '#f1b896', 1.0],
  [9, '#4a82c4', '#e8d3bd', '#ffd3a0', 2.5, '#97b8de', '#6c6a54', 1.0, '#dcd2c6', 0.98],
  [24, '#3a78c4', '#bfd7ec', '#fff0dc', 3.0, '#a9c6e8', '#77775f', 1.1, '#cadae6', 0.95],
  [55, '#2d6fc2', '#b4d3ee', '#fff7ea', 3.2, '#b0cdea', '#7d7d63', 1.15, '#c3d7ea', 0.93],
];
const KFC = KF.map((k) => ({ e: k[0], zenith: new Float32Array(3), horizon: new Float32Array(3), sun: new Float32Array(3), sunI: k[4], hemiSky: new Float32Array(3), hemiGround: new Float32Array(3), hemiI: k[7], fog: new Float32Array(3), exposure: k[9], hex: k }));

/* weather targets: cloud cover, cloud darkness, rain, fog, wet ground, sun scale, extra haze */
const WX = {
  clear: { cover: 0.2, dark: 0, rain: 0, fog: 0, wet: 0, sun: 1, haze: 0 },
  cloudy: { cover: 0.74, dark: 0.35, rain: 0, fog: 0.12, wet: 0, sun: 0.42, haze: 0.2 },
  rain: { cover: 0.96, dark: 0.78, rain: 1, fog: 0.4, wet: 1, sun: 0.16, haze: 0.45 },
  fog: { cover: 0.62, dark: 0.28, rain: 0, fog: 1, wet: 0.25, sun: 0.2, haze: 0.8 },
};

const DOME_VERT = `
varying vec3 vDir;
void main() { vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }`;
const DOME_FRAG = `
varying vec3 vDir;
uniform vec3 uSun; uniform vec3 uMoon; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunCol; uniform vec3 uFog;
uniform float uTime; uniform float uCover; uniform float uDark; uniform float uNight; uniform float uSunVis; uniform float uHaze; uniform float uSunI;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = pow(clamp(h, 0.0, 1.0), 0.45);
  vec3 col = mix(uHorizon, uZenith, t);
  col = mix(col, uFog, uHaze * (1.0 - smoothstep(0.0, 0.55, h)));
  float sd = max(dot(d, uSun), 0.0);
  float glow = pow(sd, 5.0) * 0.22 + pow(sd, 60.0) * 0.55;
  col += uSunCol * glow * uSunVis * (1.0 - uHaze * 0.7);
  float disc = smoothstep(0.99935, 0.99965, dot(d, uSun)) * uSunVis;
  // stars
  float stars = 0.0;
  if (uNight > 0.01 && h > 0.0) {
    vec3 sp = d * 120.0; vec3 cell = floor(sp); float r = hash3(cell);
    if (r > 0.9965) { vec3 f = fract(sp) - 0.5; float dd = length(f); stars = smoothstep(0.35, 0.0, dd) * (0.5 + 0.5 * hash3(cell + 3.1)) * (0.75 + 0.25 * sin(uTime * 2.0 + r * 80.0)); }
    stars *= uNight * smoothstep(0.0, 0.12, h);
  }
  col += vec3(stars);
  // moon
  float md = dot(d, uMoon);
  col += vec3(0.82, 0.88, 1.0) * (smoothstep(0.99955, 0.99975, md) * 1.4 + pow(max(md, 0.0), 50.0) * 0.12) * uNight;
  // clouds on a plane above the player
  float cl = 0.0; vec3 clCol = vec3(1.0);
  if (h > 0.0) {
    vec2 p = d.xz / (h + 0.16) * 1.15 + vec2(uTime * 0.012, uTime * 0.005);
    float n = fbm(p * 1.1);
    float lo = 0.84 - uCover * 0.62; float hi = lo + 0.2;
    cl = smoothstep(lo, hi, n);
    float n2 = fbm(p * 1.1 + uSun.xz * 0.09);
    float lit = clamp(0.62 + (n - n2) * 3.2, 0.0, 1.0);
    vec3 litC = mix(vec3(0.97, 0.96, 0.95), uSunCol, 0.35 * smoothstep(0.0, 0.6, uSunI / 3.0));
    litC = mix(litC, uFog * 1.1, clamp(1.0 - uSunI / 2.0, 0.0, 0.8));
    vec3 shadeC = mix(vec3(0.5, 0.56, 0.68), uHorizon * 0.7, 0.3) * (1.0 - uDark * 0.55);
    clCol = mix(shadeC, litC, lit) * mix(1.0, 0.42, uDark);
    clCol *= mix(1.0, 0.14, uNight);
    clCol += uSunCol * 0.12 * pow(sd, 8.0) * uSunVis;
    cl *= smoothstep(0.0, 0.09, h);
  }
  col = mix(col, clCol, cl * 0.96);
  col += uSunCol * disc * 4.0 * (1.0 - cl);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const RAIN_VERT = `varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const RAIN_FRAG = `
varying vec2 vUv; uniform float uTime; uniform float uRain; uniform float uAspect; uniform float uNight; uniform vec3 uTint;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float layer(vec2 uv, float cols, float speed, float len, float seed) {
  uv.x += uv.y * 0.18;                                   // wind: streaks lean
  vec2 g = vec2(uv.x * cols, uv.y * 3.0 + uTime * speed);
  vec2 id = floor(g); vec2 f = fract(g);
  float r = hash(id + seed);
  float x = abs(f.x - 0.2 - 0.6 * hash(id + seed + 9.0));
  float on = step(0.45, r);
  float y = smoothstep(0.0, len, f.y) * (1.0 - smoothstep(len, len * 2.2, f.y));
  return on * smoothstep(0.05, 0.0, x) * y;
}
void main() {
  if (uRain < 0.01) discard;
  vec2 uv = vec2(vUv.x * uAspect, vUv.y);
  float a = layer(uv, 70.0, 5.0, 0.22, 1.0) * 0.55 + layer(uv * 1.0 + 0.3, 110.0, 7.5, 0.16, 5.0) * 0.4 + layer(uv + 0.7, 40.0, 3.8, 0.3, 11.0) * 0.7;
  a *= uRain;
  vec3 c = mix(vec3(0.78, 0.84, 0.92), uTint, uNight);
  gl_FragColor = vec4(c, a * 0.34 * mix(1.0, 0.7, uNight));
}`;

export function createEnv({ T, scene, renderer, world, quality = 'medium', initial = {} }) {
  const hexes = (c) => { const k = new T.Color(c); return [k.r, k.g, k.b]; };
  KFC.forEach((k) => { k.zenith.set(hexes(k.hex[1])); k.horizon.set(hexes(k.hex[2])); k.sun.set(hexes(k.hex[3])); k.hemiSky.set(hexes(k.hex[5])); k.hemiGround.set(hexes(k.hex[6])); k.fog.set(hexes(k.hex[8])); });

  /* ---- lights + fog */
  const hemi = new T.HemisphereLight(0xcfe3ff, 0x707060, 1.1); scene.add(hemi);
  const sunLight = new T.DirectionalLight(0xfff0d8, 3); sunLight.position.set(-100, 200, 60); scene.add(sunLight); scene.add(sunLight.target);
  const fog = new T.FogExp2(0xbcd0e0, 0.0005); scene.fog = fog;

  /* ---- sky dome (one draw call, follows the camera) */
  const domeMat = new T.ShaderMaterial({
    vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, side: T.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: true,
    uniforms: {
      uSun: { value: new T.Vector3(0, 1, 0) }, uMoon: { value: new T.Vector3(0, -1, 0) }, uZenith: { value: new T.Color() }, uHorizon: { value: new T.Color() }, uSunCol: { value: new T.Color() }, uFog: { value: new T.Color() },
      uTime: { value: 0 }, uCover: { value: 0.2 }, uDark: { value: 0 }, uNight: { value: 0 }, uSunVis: { value: 1 }, uHaze: { value: 0 }, uSunI: { value: 3 },
    },
  });
  const dome = new T.Mesh(new T.SphereGeometry(1, 28, 14), domeMat);
  dome.scale.setScalar(9000); dome.renderOrder = -100; dome.frustumCulled = false; dome.name = 'fouer-sky';
  scene.add(dome);

  /* ---- rain: one fullscreen overlay */
  const rainMat = new T.ShaderMaterial({
    vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uRain: { value: 0 }, uAspect: { value: 1 }, uNight: { value: 0 }, uTint: { value: new T.Color(0.5, 0.55, 0.7) } },
  });
  const rainMesh = new T.Mesh(new T.PlaneGeometry(2, 2), rainMat);
  rainMesh.frustumCulled = false; rainMesh.renderOrder = 1000; rainMesh.name = 'fouer-rain'; rainMesh.visible = false;
  scene.add(rainMesh);

  /* ---- state */
  const readPref = (k, ok, dflt) => { try { const v = localStorage.getItem(KEYS[k]); return ok.includes(v) ? v : dflt; } catch (e) { return dflt; } };
  const WEATHER_MODES = ['random', ...WEATHERS]; const TIME_MODES = ['random', 'morning', 'noon', 'evening', 'night', 'live'];
  const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const S = {
    weatherMode: initial.weather || (WEATHER_MODES.includes(qs.get('fouerWeather')) ? qs.get('fouerWeather') : readPref('weather', WEATHER_MODES, 'random')),
    timeMode: initial.time || (TIME_MODES.includes(qs.get('fouerTimeMode')) ? qs.get('fouerTimeMode') : readPref('time', TIME_MODES, 'random')),
    hour: 17, weather: 'clear', cur: Object.assign({}, WX.clear), nextWeatherIn: 0, time: 0, hourFrozen: false, night: 0, sunEl: 30, listeners: [],
    rng: Math.random,
  };
  if (qs.get('fouerTime') && Number.isFinite(Number(qs.get('fouerTime')))) { S.timeMode = 'fixed'; S.hour = Number(qs.get('fouerTime')) % 24; }
  const pickWeather = (avoid) => { const w = [['clear', 0.4], ['cloudy', 0.3], ['rain', 0.16], ['fog', 0.14]].filter((e) => e[0] !== avoid); const tot = w.reduce((a, e) => a + e[1], 0); let r = S.rng() * tot; for (const e of w) { r -= e[1]; if (r <= 0) return e[0]; } return w[0][0]; };
  function applyModes(first) {
    if (S.timeMode === 'random') { if (first) S.hour = S.rng() * 24; } else if (S.timeMode === 'live') S.hour = luxHour(); else if (TIMES[S.timeMode] !== undefined) S.hour = TIMES[S.timeMode];
    if (S.weatherMode === 'random') { S.weather = first ? pickWeather() : S.weather; S.nextWeatherIn = 240 + S.rng() * 240; } else S.weather = S.weatherMode;
  }
  function luxHour() {
    try { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Luxembourg', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()); return Number(p.find((x) => x.type === 'hour').value) + Number(p.find((x) => x.type === 'minute').value) / 60; } catch (e) { const d = new Date(); return d.getHours() + d.getMinutes() / 60; }
  }
  applyModes(true);
  S.cur = Object.assign({}, WX[S.weather]);

  /* ---- sun / moon geometry in the game frame (u = COS e + SIN n, w = SIN e - COS n, y up) */
  function sunVector(hour, decl) {
    const H = (hour - SOLAR_NOON) * 15 * DEG;
    const sinEl = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H);
    const el = Math.asin(clamp(sinEl, -1, 1));
    const cosAz = (Math.sin(decl) - sinEl * Math.sin(LAT)) / (Math.cos(el) * Math.cos(LAT) + 1e-9);
    let az = Math.acos(clamp(cosAz, -1, 1)); if (H > 0) az = 2 * Math.PI - az;       // from north, clockwise
    const e = Math.sin(az) * Math.cos(el); const n = Math.cos(az) * Math.cos(el);
    return { el, v: [COS * e + SIN * n, Math.sin(el), SIN * e - COS * n] };
  }
  const DECL = 10.5 * DEG;       // about 24 August
  const tmp = new T.Color();
  function sample(el) {
    const e = el / DEG;
    let i = 0; while (i < KFC.length - 2 && e > KFC[i + 1].e) i++;
    const a = KFC[i]; const b = KFC[i + 1]; const t = clamp((e - a.e) / (b.e - a.e), 0, 1);
    const mix3 = (x, y) => [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)];
    return { zenith: mix3(a.zenith, b.zenith), horizon: mix3(a.horizon, b.horizon), sun: mix3(a.sun, b.sun), sunI: lerp(a.sunI, b.sunI, t), hemiSky: mix3(a.hemiSky, b.hemiSky), hemiGround: mix3(a.hemiGround, b.hemiGround), hemiI: lerp(a.hemiI, b.hemiI, t), fog: mix3(a.fog, b.fog), exposure: lerp(a.exposure, b.exposure, t) };
  }
  const wetMats = [];
  const wetBase = new Map();
  function collectWet() {
    wetMats.length = 0;
    world.glacis.chunks.forEach((c) => { if (c.mat) wetMats.push(c.mat); });
    wetMats.push(world.glacis.ground.matSurface);
    const far = world.glacis.root.getObjectByName('fouer-far-terrain'); if (far) wetMats.push(far.material);
    wetMats.forEach((m) => wetBase.set(m, m.color.clone()));
  }
  collectWet();

  function apply() {
    const sv = sunVector(S.hour, DECL);
    S.sunEl = sv.el / DEG;
    const k = sample(sv.el);
    const wx = S.cur;
    const dayK = smooth(-6, 4, S.sunEl);                       // 0 deep night .. 1 day
    const night = 1 - smooth(-5, 5, S.sunEl);                   // lights on below ~+4 deg, fully on at -5
    S.night = night;
    const sunScale = lerp(1, wx.sun, 1);
    sunLight.position.set(sv.v[0] * 400, Math.max(sv.v[1], 0.02) * 400, sv.v[2] * 400);
    tmp.setRGB(k.sun[0], k.sun[1], k.sun[2]);
    // by day the sun; as the sun sets the (blue) moon takes the directional light
    const moonV = [-sv.v[0], Math.max(0.35, -sv.v[1] * 0.6 + 0.35), -sv.v[2]];
    const moonK = smooth(-2, -10, S.sunEl);
    const sunI = k.sunI * sunScale * smooth(-4, 3, S.sunEl);
    sunLight.color.setRGB(lerp(tmp.r, 0.55, moonK), lerp(tmp.g, 0.65, moonK), lerp(tmp.b, 1.0, moonK));
    if (moonK > 0.5) sunLight.position.set(moonV[0] * 400, moonV[1] * 400, moonV[2] * 400);
    sunLight.intensity = lerp(sunI, 0.9 * (1 - wx.dark * 0.5), moonK);
    hemi.color.setRGB(k.hemiSky[0], k.hemiSky[1], k.hemiSky[2]); hemi.groundColor.setRGB(k.hemiGround[0], k.hemiGround[1], k.hemiGround[2]);
    hemi.intensity = k.hemiI * lerp(1, 1.18, wx.cover) * lerp(1, 0.9, wx.dark);
    // fog: horizon-coloured, denser with the weather; a faint evening haze
    const fogCol = [lerp(k.fog[0], 0.55, wx.haze * 0.25), lerp(k.fog[1], 0.58, wx.haze * 0.25), lerp(k.fog[2], 0.62, wx.haze * 0.25)];
    const dim = lerp(1, 0.78, wx.dark);
    fog.color.setRGB(fogCol[0] * dim, fogCol[1] * dim, fogCol[2] * dim);
    fog.density = lerp(0.0003, 0.0006, wx.fog) + wx.fog * wx.fog * 0.0021 + wx.haze * 0.0002;
    const u = domeMat.uniforms;
    u.uSun.value.set(sv.v[0], sv.v[1], sv.v[2]).normalize(); u.uMoon.value.set(-sv.v[0], Math.max(0.3, -sv.v[1] * 0.5 + 0.3), -sv.v[2]).normalize();
    u.uZenith.value.setRGB(k.zenith[0] * dim, k.zenith[1] * dim, k.zenith[2] * dim); u.uHorizon.value.setRGB(k.horizon[0] * dim, k.horizon[1] * dim, k.horizon[2] * dim);
    u.uSunCol.value.setRGB(k.sun[0], k.sun[1], k.sun[2]); u.uFog.value.copy(fog.color);
    u.uCover.value = wx.cover; u.uDark.value = wx.dark; u.uNight.value = night; u.uSunVis.value = smooth(-3, 1, S.sunEl) * (1 - wx.dark * 0.8); u.uHaze.value = wx.haze; u.uSunI.value = sunI;
    renderer.toneMappingExposure = k.exposure * lerp(1, 1.08, wx.cover);
    scene.background = null;
    // wet ground: darker, a little cooler
    wetMats.forEach((m) => { const b = wetBase.get(m); const f = 1 - 0.3 * wx.wet; m.color.setRGB(b.r * f, b.g * f * 1.01, b.b * f * 1.03); });
    rainMat.uniforms.uRain.value = wx.rain; rainMesh.visible = wx.rain > 0.02; rainMat.uniforms.uNight.value = night;
    world.setNight(night);
    S.listeners.forEach((f) => f(api.getState()));
  }

  let lastNight = -1;
  const api = {
    WEATHERS, TIMES, WEATHER_MODES, TIME_MODES,
    getState() { return { weatherMode: S.weatherMode, timeMode: S.timeMode, weather: S.weather, hour: S.hour, sunElevation: S.sunEl, night: S.night, rain: S.cur.rain, fog: S.cur.fog, cover: S.cur.cover, quality }; },
    onChange(f) { S.listeners.push(f); return () => { S.listeners = S.listeners.filter((q) => q !== f); }; },
    setWeather(mode, persist = true) {
      if (!WEATHER_MODES.includes(mode)) return;
      S.weatherMode = mode; S.weather = mode === 'random' ? pickWeather(S.weather) : mode; S.nextWeatherIn = 240 + S.rng() * 240;
      if (persist) { try { localStorage.setItem(KEYS.weather, mode); } catch (e) { /* storage blocked */ } }
      api.snapWeather(false); apply();
    },
    setTime(mode, persist = true) {
      if (!TIME_MODES.includes(mode)) return;
      const was = S.timeMode; S.timeMode = mode;
      if (mode === 'random') { if (was !== 'random') S.hour = S.hour; } else if (mode === 'live') S.hour = luxHour(); else S.hour = TIMES[mode];
      if (persist) { try { localStorage.setItem(KEYS.time, mode); } catch (e) { /* storage blocked */ } }
      apply();
    },
    /** debug: jump to an hour (the mode becomes a frozen custom time, not persisted) */
    setHour(h) { S.timeMode = 'fixed'; S.hour = ((h % 24) + 24) % 24; apply(); },
    /** debug: force a weather now, without the cross-fade */
    snapWeather(instant = true) { if (instant) S.cur = Object.assign({}, WX[S.weather]); },
    setWeatherNow(name) { if (!WX[name]) return; S.weatherMode = name; S.weather = name; S.cur = Object.assign({}, WX[name]); apply(); },
    update(dt, camera) {
      S.time += dt;
      if (S.timeMode === 'random') S.hour = (S.hour + dt * 24 / DAY_SECONDS) % 24;
      else if (S.timeMode === 'live') S.hour = luxHour();
      if (S.weatherMode === 'random') { S.nextWeatherIn -= dt; if (S.nextWeatherIn <= 0) { S.weather = pickWeather(S.weather); S.nextWeatherIn = 240 + S.rng() * 240; } }
      const tgt = WX[S.weather]; const a = 1 - Math.exp(-dt * 0.32);
      let moved = false;
      for (const key of Object.keys(tgt)) { const d = tgt[key] - S.cur[key]; if (Math.abs(d) > 0.0005) { S.cur[key] += d * a; moved = true; } }
      domeMat.uniforms.uTime.value = S.time; rainMat.uniforms.uTime.value = S.time;
      if (camera) { dome.position.copy(camera.position); rainMat.uniforms.uAspect.value = camera.aspect; }
      // the day drift changes the light a little every frame: re-apply at ~10 Hz while anything moves
      S.acc = (S.acc || 0) + dt;
      if (S.acc > 0.1 || moved) { if (S.acc > 0.1 || lastNight < 0) { S.acc = 0; apply(); lastNight = S.night; } }
    },
    sunLight, hemi, fog, dome,
    dispose() { scene.remove(hemi, sunLight, sunLight.target, dome, rainMesh); domeMat.dispose(); rainMat.dispose(); dome.geometry.dispose(); rainMesh.geometry.dispose(); },
  };
  apply();
  return api;
}
