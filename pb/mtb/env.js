/* Sky, sun, fog and weather: one set of shared uniforms that every material reads, a sky dome with animated clouds, and the player-choosable
 * time of day and weather (menu + in-game button later; Random is the default and the choice is stored). Weather only changes how the world
 * LOOKS and how much grip the ground gives: it never touches rewards. */
const THREE = window.THREE;

export const TIME_PRESETS = Object.freeze({ dawn: 6.5, morning: 9, noon: 13, evening: 18.8, dusk: 20.3, night: 22.5 });
export const WEATHER_IDS = Object.freeze(['clear', 'cloudy', 'fog', 'rain']);
const STORE = Object.freeze({ time: 'pb_mtb_time', weather: 'pb_mtb_weather' });
const RANDOM_TIMES = ['morning', 'noon', 'noon', 'evening', 'dawn'];             // night / dusk are choosable but not random (the forest is dark)
const RANDOM_WEATHER = ['clear', 'clear', 'clear', 'cloudy', 'fog', 'rain'];

const c = (r, g, b) => [r, g, b];
const KEYS = [
  { h: 5, el: -9, sun: c(0.45, 0.35, 0.5), i: 0.0, top: c(0.04, 0.07, 0.16), hor: c(0.28, 0.3, 0.42), amb: c(0.18, 0.22, 0.32), gnd: c(0.09, 0.09, 0.11), fog: c(0.28, 0.3, 0.4), dens: 0.00045, stars: 0.5 },
  { h: 6.5, el: 5, sun: c(1.0, 0.62, 0.38), i: 0.7, top: c(0.28, 0.42, 0.7), hor: c(0.98, 0.72, 0.55), amb: c(0.42, 0.48, 0.62), gnd: c(0.28, 0.24, 0.2), fog: c(0.86, 0.7, 0.62), dens: 0.00055, stars: 0 },
  { h: 9, el: 28, sun: c(1.0, 0.9, 0.72), i: 1.0, top: c(0.22, 0.46, 0.82), hor: c(0.74, 0.84, 0.92), amb: c(0.52, 0.62, 0.76), gnd: c(0.34, 0.3, 0.24), fog: c(0.72, 0.82, 0.9), dens: 0.0004, stars: 0 },
  { h: 13, el: 56, sun: c(1.0, 0.96, 0.86), i: 1.05, top: c(0.16, 0.4, 0.85), hor: c(0.68, 0.82, 0.95), amb: c(0.54, 0.66, 0.82), gnd: c(0.36, 0.32, 0.26), fog: c(0.7, 0.82, 0.93), dens: 0.00035, stars: 0 },
  { h: 17, el: 32, sun: c(1.0, 0.86, 0.62), i: 1.0, top: c(0.2, 0.42, 0.78), hor: c(0.9, 0.84, 0.76), amb: c(0.5, 0.57, 0.7), gnd: c(0.36, 0.3, 0.22), fog: c(0.86, 0.8, 0.7), dens: 0.0004, stars: 0 },
  { h: 18.8, el: 9, sun: c(1.0, 0.68, 0.36), i: 0.9, top: c(0.22, 0.36, 0.66), hor: c(1.0, 0.7, 0.46), amb: c(0.46, 0.48, 0.62), gnd: c(0.34, 0.26, 0.2), fog: c(0.92, 0.72, 0.55), dens: 0.0005, stars: 0 },
  { h: 20.3, el: -3, sun: c(0.9, 0.4, 0.3), i: 0.25, top: c(0.1, 0.14, 0.34), hor: c(0.8, 0.45, 0.42), amb: c(0.26, 0.28, 0.42), gnd: c(0.16, 0.13, 0.14), fog: c(0.6, 0.4, 0.42), dens: 0.00045, stars: 0.2 },
  { h: 22.5, el: -20, sun: c(0.45, 0.55, 0.8), i: 0.0, top: c(0.02, 0.04, 0.12), hor: c(0.1, 0.14, 0.28), amb: c(0.16, 0.2, 0.34), gnd: c(0.07, 0.08, 0.12), fog: c(0.1, 0.14, 0.26), dens: 0.0004, stars: 1 },
  { h: 29, el: -9, sun: c(0.45, 0.35, 0.5), i: 0.0, top: c(0.04, 0.07, 0.16), hor: c(0.28, 0.3, 0.42), amb: c(0.18, 0.22, 0.32), gnd: c(0.09, 0.09, 0.11), fog: c(0.28, 0.3, 0.4), dens: 0.00045, stars: 0.5 },
];
const WEATHER = Object.freeze({
  clear: { cloud: 0.28, sun: 1, fog: 1, grey: 0, wet: 0, rain: 0, amb: 1 },
  cloudy: { cloud: 0.82, sun: 0.42, fog: 1.5, grey: 0.45, wet: 0.1, rain: 0, amb: 1.12 },
  fog: { cloud: 0.7, sun: 0.3, fog: 6.5, grey: 0.6, wet: 0.3, rain: 0, amb: 1.15 },
  rain: { cloud: 1, sun: 0.2, fog: 2.6, grey: 0.7, wet: 1, rain: 1, amb: 1.1 },
});

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

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
    gnd: lerp3(a.gnd, b.gnd, s), fog: lerp3(a.fog, b.fog, s), dens: lerp(a.dens, b.dens, s), stars: lerp(a.stars, b.stars, s),
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
  let timeMode = params.time && (params.time === 'random' || timeIds.includes(params.time)) ? params.time : readChoice(STORE.time, timeIds, 'random');
  let weatherMode = params.weather && (params.weather === 'random' || WEATHER_IDS.includes(params.weather)) ? params.weather : readChoice(STORE.weather, WEATHER_IDS, 'random');
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  let timeId = timeMode === 'random' ? pick(RANDOM_TIMES) : timeMode;
  let weatherId = weatherMode === 'random' ? pick(RANDOM_WEATHER) : weatherMode;
  let hour = TIME_PRESETS[timeId];

  const u = {
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.3) }, uSunColor: { value: new THREE.Vector3(1, 1, 1) },
    uSkyTop: { value: new THREE.Vector3() }, uSkyHorizon: { value: new THREE.Vector3() }, uAmbSky: { value: new THREE.Vector3() }, uAmbGround: { value: new THREE.Vector3() },
    uFogColor: { value: new THREE.Vector3() }, uFogDensity: { value: 0.0004 }, uTime: { value: 0 }, uCloud: { value: 0.3 }, uWet: { value: 0 }, uStars: { value: 0 },
    uNight: { value: 0 }, uWind: { value: new THREE.Vector2(0.6, 0.25) }, uNoise: { value: noiseTexture },
  };
  const cur = { cloud: 0.3, sun: 1, fog: 1, grey: 0, wet: 0, rain: 0, amb: 1 };
  let target = WEATHER[weatherId];
  const state = { hour, timeId, weatherId, rain: 0 };

  function apply(dt, snap) {
    const k = snap ? 1 : Math.min(1, dt * 0.6);
    for (const key of Object.keys(cur)) cur[key] = lerp(cur[key], target[key], k);
    const kf = keyAt(hour);
    const grey = (col, g) => { const m = (col[0] + col[1] + col[2]) / 3; return [lerp(col[0], m * 0.92, g), lerp(col[1], m * 0.95, g), lerp(col[2], m, g)]; };
    const sky = grey(kf.top, cur.grey), hor = grey(kf.hor, cur.grey * 0.85), fog = grey(kf.fog, cur.grey * 0.8), amb = grey(kf.amb, cur.grey * 0.5), gnd = grey(kf.gnd, cur.grey * 0.3);
    u.uSkyTop.value.set(...sky); u.uSkyHorizon.value.set(...hor); u.uFogColor.value.set(...fog);
    u.uAmbSky.value.set(amb[0] * cur.amb, amb[1] * cur.amb, amb[2] * cur.amb); u.uAmbGround.value.set(...gnd);
    // sun (or the moon when the sun is down): direction, colour, strength
    const sunUp = kf.el > -2;
    let el = sunUp ? kf.el : 38, az;
    const phase = Math.PI * (((hour % 24) + 24) % 24 - 6) / 13.5;
    az = sunUp ? phase : Math.PI * 0.8;
    const dir = u.uSunDir.value;
    dir.set(Math.cos(az) * Math.cos(el * Math.PI / 180), Math.sin(el * Math.PI / 180), Math.sin(az) * Math.cos(el * Math.PI / 180)).normalize();
    const strength = sunUp ? kf.i * cur.sun : 0.26 * (1 - cur.grey * 0.4);
    const col = sunUp ? kf.sun : [0.52, 0.62, 0.9];
    u.uSunColor.value.set(col[0] * strength, col[1] * strength, col[2] * strength);
    u.uFogDensity.value = kf.dens * cur.fog;
    u.uCloud.value = cur.cloud; u.uWet.value = cur.wet; u.uStars.value = kf.stars * (1 - cur.cloud * 0.9);
    u.uNight.value = Math.min(1, Math.max(0, (6.5 - el) / 14)) * (sunUp ? 1 : 1);
    state.rain = cur.rain;
  }

  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }`,
    fragmentShader: `
      uniform vec3 uSunDir, uSunColor, uSkyTop, uSkyHorizon; uniform float uTime, uCloud, uStars, uNight; uniform vec2 uWind; uniform sampler2D uNoise;
      varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vDir);
        float up = max(d.y, 0.0);
        vec3 col = mix(uSkyHorizon, uSkyTop, pow(up, 0.5));
        // below the horizon: the same horizon colour (the fog colour), so the far hills melt into it
        col = mix(col, uSkyHorizon * 0.9, smoothstep(0.0, -0.25, d.y));
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        vec3 sunTint = uSunColor / max(max(uSunColor.r, max(uSunColor.g, uSunColor.b)), 0.001);
        col += sunTint * (pow(sd, 700.0) * 4.0 + pow(sd, 36.0) * 0.32 + pow(sd, 6.0) * 0.1) * smoothstep(-0.05, 0.1, uSunDir.y);
        // clouds: two noise layers on a plane above the viewer, drifting with the wind
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.22) * 0.55;
          vec2 w = uWind * uTime * 0.012;
          float n1 = texture2D(uNoise, uv * 0.35 + w).r, n2 = texture2D(uNoise, uv * 0.9 + w * 1.7).g;
          float n = n1 * 0.62 + n2 * 0.38;
          float cov = smoothstep(1.0 - uCloud * 0.85 - 0.12, 1.0 - uCloud * 0.85 + 0.2, n);
          cov *= smoothstep(0.0, 0.22, d.y);
          float lit = clamp(0.55 + 0.6 * dot(normalize(uSunDir.xz + 0.001), normalize(d.xz + 0.001)) * (1.0 - n * 0.4), 0.0, 1.2);
          vec3 cloudCol = mix(uSkyHorizon * 0.55 + vec3(0.1), vec3(1.0, 0.98, 0.94) * (0.55 + 0.55 * clamp(uSunDir.y * 2.2, 0.0, 1.0)), lit * 0.8) ;
          cloudCol = mix(cloudCol, cloudCol * (uSunColor * 0.6 + 0.5), 0.5);
          col = mix(col, cloudCol, cov * (0.88 - 0.25 * uCloud));
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
    setHour(h) { hour = h; state.hour = h; },
    getChoice: () => ({ timeMode, weatherMode, timeId, weatherId, hour }),
    /** Grip multiplier of the weather (rain and fog make the ground slick; never affects rewards). */
    gripScale: () => 1 - 0.28 * cur.wet,
  };
}
