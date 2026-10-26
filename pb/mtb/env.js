/* Sky, sun / moon, fog and weather: one set of shared uniforms that every material reads, a sky dome with animated clouds, a moon and stars, the rider's lamp, and the
 * player-choosable time of day, weather and season (menu + in-game keys; Random is the default and the choice is stored). Weather only changes how the world LOOKS and
 * how much grip the ground gives: it never touches rewards.
 *   times:    dawn, morning, noon, evening, dusk (a low red sun, violet sky: NOT dark), night (moonlight + stars + the bike lamp)
 *   weather:  clear, cloudy, fog (milky valley mist, layered), rain (slate sky, streaks, wet ground, puddles)
 *   season:   summer, autumn (leaves turn, the floor turns copper, leaves fall) */
const THREE = window.THREE;

export const TIME_PRESETS = Object.freeze({ dawn: 6.5, morning: 9, noon: 13, evening: 18.8, dusk: 20.4, night: 23 });
export const WEATHER_IDS = Object.freeze(['clear', 'cloudy', 'fog', 'rain']);
export const SEASON_IDS = Object.freeze(['summer', 'autumn']);
const STORE = Object.freeze({ time: 'pb_mtb_time', weather: 'pb_mtb_weather', season: 'pb_mtb_season' });
const RANDOM_TIMES = ['morning', 'noon', 'noon', 'evening', 'dawn', 'dusk'];             // night is choosable but not random (the forest is dark)
const RANDOM_WEATHER = ['clear', 'clear', 'clear', 'cloudy', 'fog', 'rain'];
const RANDOM_SEASON = ['summer', 'summer', 'summer', 'autumn'];
const MOON_DIR = Object.freeze({ az: Math.PI * 0.8, el: 42 });
const MOON_COLOR = Object.freeze([0.5, 0.64, 1.0]);

const c = (r, g, b) => [r, g, b];
const KEYS = [
  { h: 5, el: -9, sun: c(0.45, 0.35, 0.5), i: 0.0, top: c(0.03, 0.05, 0.14), hor: c(0.12, 0.14, 0.26), amb: c(0.38, 0.48, 0.76), gnd: c(0.16, 0.2, 0.3), fog: c(0.1, 0.13, 0.24), dens: 0.0007, stars: 1, glow: 0.0, moon: 1 },
  { h: 6.5, el: 5, sun: c(1.0, 0.62, 0.38), i: 0.7, top: c(0.28, 0.42, 0.7), hor: c(0.98, 0.72, 0.55), amb: c(0.56, 0.6, 0.74), gnd: c(0.4, 0.34, 0.28), fog: c(0.86, 0.7, 0.62), dens: 0.0006, stars: 0, glow: 0.9, moon: 0 },
  { h: 9, el: 28, sun: c(1.0, 0.9, 0.72), i: 1.0, top: c(0.38, 0.55, 0.78), hor: c(0.76, 0.84, 0.9), amb: c(0.52, 0.62, 0.76), gnd: c(0.34, 0.3, 0.24), fog: c(0.72, 0.82, 0.9), dens: 0.0004, stars: 0, glow: 0.1, moon: 0 },
  { h: 13, el: 56, sun: c(1.0, 0.96, 0.86), i: 1.05, top: c(0.34, 0.52, 0.78), hor: c(0.72, 0.83, 0.92), amb: c(0.54, 0.66, 0.82), gnd: c(0.36, 0.32, 0.26), fog: c(0.7, 0.82, 0.93), dens: 0.00035, stars: 0, glow: 0.0, moon: 0 },
  { h: 17, el: 32, sun: c(1.0, 0.86, 0.62), i: 1.0, top: c(0.36, 0.5, 0.74), hor: c(0.9, 0.84, 0.76), amb: c(0.5, 0.57, 0.7), gnd: c(0.36, 0.3, 0.22), fog: c(0.86, 0.8, 0.7), dens: 0.0004, stars: 0, glow: 0.3, moon: 0 },
  { h: 18.8, el: 9, sun: c(1.0, 0.64, 0.3), i: 0.92, top: c(0.2, 0.34, 0.64), hor: c(1.0, 0.68, 0.42), amb: c(0.62, 0.58, 0.7), gnd: c(0.46, 0.34, 0.26), fog: c(0.94, 0.7, 0.5), dens: 0.0005, stars: 0, glow: 1.0, moon: 0 },
  { h: 20.4, el: 1.5, sun: c(1.0, 0.34, 0.26), i: 0.5, top: c(0.12, 0.13, 0.4), hor: c(1.0, 0.46, 0.38), amb: c(0.52, 0.46, 0.7), gnd: c(0.3, 0.22, 0.3), fog: c(0.72, 0.42, 0.5), dens: 0.00055, stars: 0.35, glow: 1.0, moon: 0.2 },
  { h: 21.8, el: -12, sun: c(0.6, 0.3, 0.4), i: 0.0, top: c(0.05, 0.07, 0.2), hor: c(0.3, 0.26, 0.44), amb: c(0.36, 0.42, 0.66), gnd: c(0.16, 0.17, 0.28), fog: c(0.2, 0.2, 0.36), dens: 0.0006, stars: 0.8, glow: 0.3, moon: 0.9 },
  { h: 23, el: -22, sun: c(0.45, 0.55, 0.8), i: 0.0, top: c(0.03, 0.05, 0.14), hor: c(0.12, 0.14, 0.26), amb: c(0.38, 0.48, 0.76), gnd: c(0.16, 0.2, 0.3), fog: c(0.1, 0.13, 0.24), dens: 0.0007, stars: 1, glow: 0.0, moon: 1 },
  { h: 29, el: -9, sun: c(0.45, 0.35, 0.5), i: 0.0, top: c(0.03, 0.05, 0.14), hor: c(0.12, 0.14, 0.26), amb: c(0.38, 0.48, 0.76), gnd: c(0.16, 0.2, 0.3), fog: c(0.1, 0.13, 0.24), dens: 0.0007, stars: 1, glow: 0.0, moon: 1 },
];
/* weather: cloud cover, sun share, distance fog multiplier, desaturation, brightness, wetness, rain, ambient multiplier, height-fog density / fall-off, fog tint towards milky white */
const WEATHER = Object.freeze({
  clear: { cloud: 0.28, sun: 1, fog: 1, grey: 0, dim: 1, wet: 0, rain: 0, amb: 1, hd: 0, milk: 0 },
  cloudy: { cloud: 1, sun: 0.14, fog: 0.55, grey: 0.62, dim: 0.95, wet: 0.08, rain: 0, amb: 1.75, hd: 0, milk: 0 },           // clear air, a flat grey-white sky, soft shadows: no haze at all
  fog: { cloud: 0.8, sun: 0.1, fog: 48, grey: 0.75, dim: 0.97, wet: 0.35, rain: 0, amb: 1.7, hd: 0.03, milk: 0.9 },       // soft white volume between the trunks: near things crisp, each tree row paler, the far ones gone
  rain: { cloud: 1, sun: 0.12, fog: 4.2, grey: 0.82, dim: 0.6, wet: 1, rain: 1, amb: 1.45, hd: 0.0012, milk: 0.1 },
});

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function keyAt(hour) {
  let h = ((hour % 24) + 24) % 24;
  if (h < KEYS[0].h) h += 24;
  let i = 0;
  while (i < KEYS.length - 2 && h >= KEYS[i + 1].h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (h - a.h) / (b.h - a.h)));
  const s = t * t * (3 - 2 * t);
  return {
    el: lerp(a.el, b.el, t), sun: lerp3(a.sun, b.sun, s), i: lerp(a.i, b.i, s), top: lerp3(a.top, b.top, s), hor: lerp3(a.hor, b.hor, s), amb: lerp3(a.amb, b.amb, s),
    gnd: lerp3(a.gnd, b.gnd, s), fog: lerp3(a.fog, b.fog, s), dens: lerp(a.dens, b.dens, s), stars: lerp(a.stars, b.stars, s), glow: lerp(a.glow, b.glow, s), moon: lerp(a.moon, b.moon, s),
  };
}

function readChoice(key, ids, fallback) {
  try { const v = localStorage.getItem(key); if (v === 'random' || ids.includes(v)) return v; } catch (error) { console.warn('[mtb] storage blocked', error); }
  return fallback;
}
function writeChoice(key, value) {
  try { localStorage.setItem(key, value); } catch (error) { console.warn('[mtb] could not store the choice', error); }
}

export function createEnv({ noiseTexture, params = {} }) {
  const timeIds = Object.keys(TIME_PRESETS);
  const choose = (param, ids, key, fallback) => (param && (param === 'random' || ids.includes(param)) ? param : readChoice(key, ids, fallback));
  let timeMode = choose(params.time, timeIds, STORE.time, 'random');
  let weatherMode = choose(params.weather, WEATHER_IDS, STORE.weather, 'random');
  let seasonMode = choose(params.season, SEASON_IDS, STORE.season, 'random');
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  let timeId = timeMode === 'random' ? pick(RANDOM_TIMES) : timeMode;
  let weatherId = weatherMode === 'random' ? pick(RANDOM_WEATHER) : weatherMode;
  let seasonId = seasonMode === 'random' ? pick(RANDOM_SEASON) : seasonMode;
  let hour = TIME_PRESETS[timeId];

  const V = () => new THREE.Vector3();
  const u = {
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.3) }, uSunColor: { value: V() },
    uSkyTop: { value: V() }, uSkyHorizon: { value: V() }, uAmbSky: { value: V() }, uAmbGround: { value: V() },
    uFogColor: { value: V() }, uFogDensity: { value: 0.0004 }, uFogBase: { value: 0 }, uFogHD: { value: 0 }, uFogHF: { value: 0.045 },
    uTime: { value: 0 }, uCloud: { value: 0.3 }, uWet: { value: 0 }, uRain: { value: 0 }, uStars: { value: 0 }, uNight: { value: 0 }, uGlow: { value: 0 }, uOvercast: { value: 0 },
    uSeason: { value: 0 }, uWind: { value: new THREE.Vector2(0.6, 0.25) }, uNoise: { value: noiseTexture },
    uMoon: { value: V() }, uSkyPaint: { value: noiseTexture }, uLampPos: { value: V() }, uLampDir: { value: new THREE.Vector3(1, -0.1, 0) }, uLampColor: { value: new THREE.Vector3(1.0, 0.86, 0.62) }, uLampOn: { value: 0 },
  };
  const cur = { cloud: 0.3, sun: 1, fog: 1, grey: 0, dim: 1, wet: 0, rain: 0, amb: 1, hd: 0, milk: 0, season: seasonId === 'autumn' ? 1 : 0 };
  let target = WEATHER[weatherId];
  let seasonTarget = seasonId === 'autumn' ? 1 : 0;
  const state = { hour, timeId, weatherId, seasonId, rain: 0, night: 0, lamp: 0 };
  const sunTmp = new THREE.Vector3(), moonTmp = new THREE.Vector3();

  function apply(dt, snap) {
    const k = snap ? 1 : Math.min(1, dt * 0.6);
    for (const key of Object.keys(target)) cur[key] = lerp(cur[key], target[key], k);
    cur.season = lerp(cur.season, seasonTarget, snap ? 1 : Math.min(1, dt * 0.4));
    const kf = keyAt(hour);
    const grey = (col, g, dim = 1) => { const m = (col[0] + col[1] + col[2]) / 3; return [lerp(col[0], m * 0.92, g) * dim, lerp(col[1], m * 0.95, g) * dim, lerp(col[2], m, g) * dim]; };
    const milk = (col, t) => lerp3(col, [0.82, 0.85, 0.86].map((v) => v * (0.35 + 0.65 * smooth(-12, 12, kf.el))), t);
    const night = smooth(4, -12, kf.el);
    const dim = lerp(1, cur.dim, 1 - night * 0.5);
    const sky = grey(kf.top, cur.grey, dim * (cur.rain > 0.5 ? 0.9 : 1)), hor = grey(kf.hor, cur.grey * 0.85, dim);
    const fog = milk(grey(kf.fog, cur.grey * 0.8, dim), cur.milk), amb = grey(kf.amb, cur.grey * 0.5, 1), gnd = grey(kf.gnd, cur.grey * 0.3);
    u.uSkyTop.value.set(...sky); u.uSkyHorizon.value.set(...hor); u.uFogColor.value.set(...fog);
    u.uAmbSky.value.set(amb[0] * cur.amb * (0.78 + 0.22 * dim), amb[1] * cur.amb * (0.78 + 0.22 * dim), amb[2] * cur.amb * (0.78 + 0.22 * dim)); u.uAmbGround.value.set(...gnd);
    // sun and moon, blended: the sun fades with its strength, the moon takes over
    const phase = Math.PI * (((hour % 24) + 24) % 24 - 6) / 13.5;
    const elR = Math.max(-0.2, kf.el) * Math.PI / 180;
    sunTmp.set(Math.cos(phase) * Math.cos(elR), Math.sin(elR), Math.sin(phase) * Math.cos(elR)).normalize();
    const mElR = MOON_DIR.el * Math.PI / 180;
    moonTmp.set(Math.cos(MOON_DIR.az) * Math.cos(mElR), Math.sin(mElR), Math.sin(MOON_DIR.az) * Math.cos(mElR));
    const sunS = kf.i * cur.sun * smooth(-3, 2, kf.el);
    const moonS = 0.62 * kf.moon * (1 - cur.grey * 0.45);
    const total = sunS + moonS + 1e-5;
    u.uSunDir.value.copy(sunTmp).multiplyScalar(sunS / total).addScaledVector(moonTmp, moonS / total).normalize();
    u.uSunColor.value.set(kf.sun[0] * sunS + MOON_COLOR[0] * moonS, kf.sun[1] * sunS + MOON_COLOR[1] * moonS, kf.sun[2] * sunS + MOON_COLOR[2] * moonS);
    u.uMoon.value.copy(moonTmp).multiplyScalar(kf.moon);
    u.uFogDensity.value = kf.dens * cur.fog;
    u.uFogHD.value = cur.hd * (night > 0.5 ? 0.6 : 1); u.uFogHF.value = 0.05;
    u.uCloud.value = cur.cloud; u.uWet.value = cur.wet; u.uRain.value = cur.rain; u.uStars.value = kf.stars * (1 - cur.cloud * 0.9);
    u.uNight.value = night; u.uGlow.value = kf.glow * (1 - cur.grey * 0.7); u.uOvercast.value = cur.cloud * cur.grey; u.uSeason.value = cur.season;
    // the bike lamp: on from dusk, at night, and a little in thick fog or heavy rain
    const lamp = Math.max(smooth(0.45, -1, kf.el) * 0.9 + night * 0.1, (cur.fog > 6 || cur.rain > 0.5) ? 0.3 * (1 - smooth(10, 40, kf.el) * 0.7) : 0);
    u.uLampOn.value = Math.min(1, lamp);
    state.rain = cur.rain; state.night = night; state.lamp = u.uLampOn.value; state.sunUp = kf.el > 0;
  }

  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }`,
    fragmentShader: `
      uniform vec3 uSunDir, uSunColor, uSkyTop, uSkyHorizon, uMoon, uFogColor; uniform float uTime, uCloud, uStars, uNight, uGlow, uOvercast, uRain; uniform vec2 uWind; uniform sampler2D uNoise, uSkyPaint;
      varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vDir);
        float up = max(d.y, 0.0);
        vec3 col = mix(uSkyHorizon, uSkyTop, pow(up, 0.62));
        col = mix(col, vec3(dot(col, vec3(0.33))), 0.12 * (1.0 - up));            // a calmer haze near the horizon
        // below the horizon: the same horizon colour (the fog colour), so the far hills melt into it
        col = mix(col, uSkyHorizon * 0.9, smoothstep(0.0, -0.25, d.y));
        vec3 sd3 = normalize(uSunDir);
        float sd = max(dot(d, sd3), 0.0);
        vec3 sunTint = uSunColor / max(max(uSunColor.r, max(uSunColor.g, uSunColor.b)), 0.001);
        float sunUp = smoothstep(-0.05, 0.1, uSunDir.y);
        float sunAmt = (1.0 - uNight) * (1.0 - uOvercast * 0.85);
        col += sunTint * (pow(sd, 700.0) * 4.0 + pow(sd, 36.0) * 0.32 + pow(sd, 6.0) * 0.1) * sunUp * sunAmt;
        // sunrise / sunset: a wide glow along the horizon on the side of the sun
        vec2 sh = normalize(sd3.xz + 0.0001), dh = normalize(d.xz + 0.0001);
        float side = pow(max(dot(sh, dh), 0.0), 2.5);
        float band = smoothstep(0.42, 0.0, d.y) * smoothstep(-0.12, 0.02, d.y);
        col = mix(col, mix(uSkyHorizon, sunTint * 1.05, 0.55), uGlow * band * (0.25 + 0.75 * side) * (1.0 - uOvercast));
        // overcast: a flat slate sky, lighter at the horizon (rain: darker)
        vec3 slate = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, 0.7, up));
        col = mix(col, slate * (1.0 - 0.18 * uRain), uOvercast * 0.7);
        // the moon: a pale disc with a halo
        float md = max(dot(d, normalize(uMoon + vec3(0.0, 0.0001, 0.0))), 0.0);
        float moonOn = step(0.01, length(uMoon)) * (1.0 - uOvercast * 0.8) * smoothstep(0.0, 0.08, d.y);
        col += vec3(0.86, 0.92, 1.0) * (smoothstep(0.99935, 0.99965, md) * 1.3 + pow(md, 160.0) * 0.28 + pow(md, 14.0) * 0.06) * moonOn * length(uMoon);
        // clouds: a painted cloud tile on a plane above the viewer, drifting with the wind (white tops, lilac-grey undersides); more cover = a lower threshold
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.22) * 0.5;
          vec2 w = uWind * uTime * 0.006;
          vec3 pc = texture2D(uSkyPaint, uv * 0.85 + w).rgb;
          vec3 pc2 = texture2D(uSkyPaint, uv * 0.37 + w * 0.6 + 0.43).rgb;
          float cl = smoothstep(0.64 - uCloud * 0.34, 0.9 - uCloud * 0.34, pc.r * 0.7 + pc2.r * 0.3);
          cl *= smoothstep(0.0, 0.2, d.y);
          float lit = clamp(0.55 + 0.6 * dot(normalize(uSunDir.xz + 0.001), normalize(d.xz + 0.001)), 0.0, 1.2);
          vec3 cloudCol = pc * mix(vec3(0.5, 0.55, 0.7), vec3(1.0, 0.98, 0.94) * (0.7 + 0.45 * clamp(uSunDir.y * 2.2, 0.0, 1.0)), lit * 0.8 * (1.0 - uNight));
          cloudCol = mix(cloudCol, cloudCol * (uSunColor * 0.6 + 0.5), 0.5) * (1.0 - 0.75 * uNight);
          cloudCol = mix(cloudCol, uSkyHorizon * (0.6 - 0.18 * uRain), uOvercast * 0.65);
          col = mix(col, cloudCol, cl * (0.95 - 0.2 * uCloud) * (1.0 - smoothstep(0.35, 0.0, d.y) * 0.5));
        }
        // stars
        if (uStars > 0.01 && d.y > 0.0) {
          vec2 sp = floor(d.xz / (d.y + 0.3) * 120.0);
          float s = step(0.9965, hash(sp)) * uStars * smoothstep(0.0, 0.25, d.y);
          col += vec3(s) * (0.6 + 0.4 * hash(sp + 3.0));
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  sky.name = 'mtb-sky';

  apply(0, true);

  return {
    uniforms: u, sky, state,
    update(dt, camera, elapsed) {
      u.uTime.value = elapsed;
      if (camera) { sky.position.copy(camera.position); sky.scale.setScalar(camera.far * 0.9); }
      apply(dt, false);
    },
    snap() { apply(0, true); },
    setTime(id) {
      timeMode = id; writeChoice(STORE.time, id);
      timeId = id === 'random' ? pick(RANDOM_TIMES) : id; hour = TIME_PRESETS[timeId]; state.timeId = timeId; state.hour = hour;
    },
    setWeather(id) {
      weatherMode = id; writeChoice(STORE.weather, id);
      weatherId = id === 'random' ? pick(RANDOM_WEATHER) : id; target = WEATHER[weatherId]; state.weatherId = weatherId;
    },
    setSeason(id) {
      seasonMode = id; writeChoice(STORE.season, id);
      seasonId = id === 'random' ? pick(RANDOM_SEASON) : id; seasonTarget = seasonId === 'autumn' ? 1 : 0; state.seasonId = seasonId;
    },
    setHour(h) { hour = h; state.hour = h; },
    /** The height fog pools below this level (set every frame to the ground under the camera): valleys are misty, the rim stays clear. */
    setFogBase(y) { u.uFogBase.value = y - 3; },
    /** The bike lamp: world position and direction (from the rider model). */
    setLamp(pos, dir) { u.uLampPos.value.copy(pos); u.uLampDir.value.copy(dir); },
    getChoice: () => ({ timeMode, weatherMode, seasonMode, timeId, weatherId, seasonId, hour }),
    /** Grip multiplier of the weather (rain and fog make the ground slick; never affects rewards). */
    gripScale: () => 1 - 0.28 * cur.wet,
  };
}
