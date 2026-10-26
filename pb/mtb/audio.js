/* MTB Mëllerdall audio: everything is synthesised with Web Audio (no samples, nothing is downloaded).
 *
 * Graph (steady state, 18 live nodes + the destination; everything else is a short one-shot that frees itself):
 *   pink noise loop (1 source) -> tyre bp | hiss hp | wind bp | brake bp | chain bp (+ triangle) | water lp -> layer gains ┐
 *   sawtooth (skid) -> gain ------------------------------------------------------------------------------------------------┤-> master -> compressor -> out
 *   one-shots (freewheel ticks, surface pulses, drips, birds, crickets, events) ----------------------------------------------┘
 * The context is created on the first user gesture (iOS autoplay), mute ramps the master gain in 50 ms, the arcade's global mute
 * (localStorage pb_muted and the `arcade:mute` window event) is honoured. update() only changes AudioParams (setTargetAtTime, no clicks);
 * a lookahead scheduler (setTimeout 25 ms, 100 ms ahead) places the pulse trains. Pure helpers (sanitizeFrame, computeTargets,
 * computeSchedule, smoothstep) are exported for the Node harness (harness-audio.js). */

/* ----------------------------------------------------------------------------------------------- constants */
const MASTER_LEVEL = 0.7;
const MUTE_RAMP_S = 0.05;              // master gain ramp on mute / unmute
const MUTE_SUSPEND_DELAY_MS = 300;     // suspend the context this long after muting (saves CPU on the iPad)
const SCHEDULER_INTERVAL_MS = 25;
const LOOKAHEAD_S = 0.1;
const BIRD_CURVE_POINTS = 12;
const MAX_PER_PASS = 8;                // hard cap of pulses one scheduler pass may create per train
const MAX_VOICES = 24;                 // simultaneous event voices
const EVENT_MIN_GAP_S = 0.06;          // same event at most once per 60 ms
const NOISE_SECONDS = 2;
const NOISE_SEAM_SECONDS = 0.1;        // equal-power crossfade that makes the loop seamless
const NOISE_RMS = 0.3;
const DEFAULT_DT = 1 / 60;
const MAX_DT = 0.1;
const MAX_SPEED = 26;
const MAX_CADENCE = 110;
const FAR_DISTANCE = Infinity;
const TAU = Math.PI * 2;

// time constants of the continuous layers (seconds): 0.05..0.15 as required, no audible zipper noise
const TC_TYRE = 0.06, TC_HISS = 0.1, TC_WIND = 0.12, TC_BRAKE = 0.05, TC_CHAIN = 0.08, TC_WATER = 0.15, TC_SKID = 0.06;
const TC_FILTER = 0.04;                // filter glides: a surface crossfade is ~3 x 40 ms = 120 ms

const TYRE_FULL_SPEED = 12;            // m/s where the tyre noise reaches full volume
const WET_TYRE_DAMP = 0.3;
const TYRE_GAIN_MAX = 0.9;
const WET_HISS_LEVEL = 0.1;
const RAIN_HISS_LEVEL = 0.2;
const SKID_FILTER_HZ = 320;
const BREEZE_LEVEL = 0.02;
const MENU_WIND_LEVEL = 0.15;
const WIND_SPEED_LEVEL = 0.45;
const WIND_RISE = Object.freeze([3, 17]);         // m/s: the wind starts to rise at 3 m/s and is fully there at 17 m/s (61 km/h): at 40 km/h it already roars, and its pitch climbs with the speed
const WIND_GUST_LEVEL = 0.22;
const BRAKE_LEVEL = 0.06;
const SKID_LEVEL = 0.03;
const CHAIN_LEVEL = 0.04;
const WATER_LEVEL = 0.5;
const PAUSED_AMBIENT = 0.3;            // paused: only the ambient layers, at 30 %
const MENU_AMBIENT = 0.4;              // riding === false: birds, wind (and weather) at a low level

const TICK_SPEED_MIN = 1.5;
const TICK_RATE_PER_MS = 9;            // pawl clicks per metre of travel
const TICK_RATE_MAX = 45;
const TICK_LEVEL = 0.07;
const PEDAL_ON = 0.1;
const DRIP_RATE_MAX = 10;
const DRIP_LEVEL = 0.04;

const BIRD_LEVEL = 0.05;
const BIRD_INTERVAL = Object.freeze({ riding: [1.5, 5], menu: [0.7, 2.2] });
const CRICKET_LEVEL = 0.03;
const CRICKET_INTERVAL = [0.5, 1.3];
const CRICKET_HZ = 4500;
const DAY_NIGHT_MAX = 0.3;             // birds only while night < 0.3
const NIGHT_MIN = 0.6;                 // crickets only while night > 0.6
const RAIN_SILENCES_BIRDS = 0.5;

const COMPRESSION_THUMP_RATE = 6;      // compression units / s that trigger a suspension thump
const COMPRESSION_THUMP_GAP_S = 0.12;
const COMPRESSION_THUMP_LEVEL = 0.12;

const SURFACE_NAMES = Object.freeze(['dirt', 'rock', 'roots', 'mud', 'leaves', 'wood', 'grass', 'water', 'road']);
const SURFACE_SET = new Set(SURFACE_NAMES);

/** per surface: bandpass centre / Q and level of the continuous tyre noise, plus the optional pulse train
 *  (pulse: baked buffer, rate = base + perMs * speed in Hz capped at max, gain, jitter) */
const TYRE_PROFILES = Object.freeze({
  dirt: { freq: 450, q: 0.35, gain: 0.5 },                                                          // brown-ish, lowpassed ~900 Hz
  rock: { freq: 1800, q: 0.9, gain: 0.45, pulse: { buffer: 'crackle', base: 6, perMs: 2.2, max: 40, gain: 0.22, jitter: 0.9 } },
  roots: { freq: 350, q: 0.5, gain: 0.25, pulse: { buffer: 'thump', base: 0, perMs: 1.4, max: 18, gain: 0.45, jitter: 0.25, wetDamp: 0.5 } },
  mud: { freq: 250, q: 0.6, gain: 0.55, wobble: 0.3 },                                              // squelchy low band, slow wobble
  leaves: { freq: 3200, q: 0.35, gain: 0.35, pulse: { buffer: 'rustle', base: 8, perMs: 1.5, max: 30, gain: 0.12, jitter: 0.9 } },
  wood: { freq: 300, q: 1.2, gain: 0.2, pulse: { buffer: 'clunk', base: 0, perMs: 1.2, max: 16, gain: 0.5, jitter: 0.05, wetDamp: 0.5 } },
  grass: { freq: 700, q: 0.3, gain: 0.2 },                                                          // airy, quiet
  water: { freq: 1500, q: 0.6, gain: 0.8, speedBias: 0.6 },                                         // splash, louder with speed
  road: { freq: 700, q: 1.0, gain: 0.45 },                                                          // smooth hum
});

/* ----------------------------------------------------------------------------------------------- pure helpers */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const finite = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const num = (v, fallback, lo, hi) => clamp(finite(v, fallback), lo, hi);
const lerp = (a, b, t) => a + (b - a) * t;
const isFiniteNumber = v => typeof v === 'number' && Number.isFinite(v);

/** Hermite smoothstep; x may be +-Infinity */
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Any object (or nothing) -> a complete, clamped, frozen frame. Missing / NaN / wrong-typed fields get defaults. */
export function sanitizeFrame(frame) {
  const f = frame && typeof frame === 'object' ? frame : {};
  const fall = typeof f.fallDistance === 'number' && !Number.isNaN(f.fallDistance) ? Math.max(0, f.fallDistance) : FAR_DISTANCE;
  return Object.freeze({
    dt: num(f.dt, DEFAULT_DT, 0, MAX_DT),
    speed: num(f.speed, 0, 0, MAX_SPEED),
    grounded: f.grounded === undefined ? true : Boolean(f.grounded),
    surface: SURFACE_SET.has(f.surface) ? f.surface : 'dirt',
    pedal: num(f.pedal, 0, 0, 1),
    cadence: num(f.cadence, 0, 0, MAX_CADENCE),
    brakeFront: num(f.brakeFront, 0, 0, 1),
    brakeRear: num(f.brakeRear, 0, 0, 1),
    skid: num(f.skid, 0, 0, 1),
    wet: num(f.wet, 0, 0, 1),
    rain: num(f.rain, 0, 0, 1),
    night: num(f.night, 0, 0, 1),
    wind: num(f.wind, 0, 0, 1),
    fallDistance: fall,
    waterSize: num(f.waterSize, 0, 0, 1),
    compression: num(f.compression, 0, 0, 1),
    paused: Boolean(f.paused),
    riding: f.riding === undefined ? true : Boolean(f.riding),
  });
}

/** How loud the ambient layers are (1 riding, 0.4 in the menu, 0.3 paused) and whether the mechanical layers run */
function levels(s) {
  return { mech: s.riding && !s.paused ? 1 : 0, amb: s.paused ? PAUSED_AMBIENT : s.riding ? 1 : MENU_AMBIENT };
}

/** The AudioParam targets of every continuous layer for a sanitised frame at animation time t (seconds). Pure; all values finite. */
export function computeTargets(s, t) {
  const { mech, amb } = levels(s);
  const grounded = s.grounded ? 1 : 0;
  const speedN = smoothstep(0, TYRE_FULL_SPEED, s.speed);
  const profile = TYRE_PROFILES[s.surface];

  // tyres: surface profile, skid pulls the band down into a rubbery scrub, wet takes the edge off
  const speedLaw = profile.speedBias ? (1 - profile.speedBias) + profile.speedBias * speedN : 1;
  const wobble = profile.wobble ? 1 + profile.wobble * Math.sin(TAU * 1.3 * t) : 1;
  const tyre = {
    gain: Math.min(TYRE_GAIN_MAX, profile.gain * speedN * speedLaw * grounded * mech * (1 - WET_TYRE_DAMP * s.wet) * (1 + 0.6 * s.skid)),
    freq: lerp(profile.freq, SKID_FILTER_HZ, 0.6 * s.skid) * wobble,
    q: lerp(profile.q, 0.6, s.skid),
  };

  // hiss: rain (ambient) plus the wet-ground hiss of the tyres (mechanical)
  const hiss = {
    gain: clamp(s.rain * RAIN_HISS_LEVEL * amb + s.wet * speedN * grounded * mech * WET_HISS_LEVEL, 0, 0.3),
    freq: 1000 + 800 * s.wet,
  };

  // wind: silent below 4 m/s (apart from a faint breeze and the gusts), strong from 17 m/s on; a calm constant bed in the menu
  const wind = {
    gain: (s.riding
      ? BREEZE_LEVEL + WIND_SPEED_LEVEL * smoothstep(WIND_RISE[0], WIND_RISE[1], s.speed) + WIND_GUST_LEVEL * s.wind
      : MENU_WIND_LEVEL + 0.1 * s.wind) * amb,
    freq: 250 + 1300 * smoothstep(0, WIND_RISE[1] + 1, s.speed) + 500 * s.wind,
  };

  // brake squeal: 3-4 kHz with a slow wobble, louder with speed
  const brake = Math.max(s.brakeFront, s.brakeRear);
  const brakeFx = {
    gain: BRAKE_LEVEL * brake * smoothstep(TICK_SPEED_MIN, 8, s.speed) * grounded * mech,
    freq: 3000 + 700 * s.brakeFront + 350 * Math.sin(TAU * 0.9 * t) + 150 * Math.sin(TAU * 2.3 * t),
  };

  const skid = {
    gain: SKID_LEVEL * s.skid * smoothstep(1, 5, s.speed) * grounded * mech,
    freq: 108 + 6 * Math.sin(TAU * 7 * t),
  };

  // chain whir while pedalling: pitch follows the cadence
  const pedalling = s.pedal > PEDAL_ON ? smoothstep(PEDAL_ON, 0.5, s.pedal) : 0;
  const chain = {
    gain: CHAIN_LEVEL * pedalling * smoothstep(5, 40, s.cadence) * grounded * mech,
    freq: 1200 + 20 * s.cadence,
    toneHz: 100 + 3.5 * s.cadence,
  };

  // waterfall / stream: audible from 160 m, loud at 10 m; a stream (small waterSize) babbles through a wobbling low-pass
  const babble = (1 - s.waterSize) * (0.3 * Math.sin(TAU * 3.1 * t) + 0.15 * Math.sin(TAU * 5.7 * t));
  const water = {
    gain: WATER_LEVEL * s.waterSize * (1 - smoothstep(10, 160, s.fallDistance)) * amb,
    freq: lerp(1100, 2600, s.waterSize) * (1 + babble),
  };

  return { tyre, hiss, wind, brake: brakeFx, skid, chain, water };
}

/** What the lookahead scheduler has to place for a sanitised frame: pulse trains (freewheel, surface, drips) and the birdsong mode. */
export function computeSchedule(s) {
  const { mech, amb } = levels(s);
  const tickActive = mech > 0 && s.speed > TICK_SPEED_MIN && s.pedal < PEDAL_ON;
  const freewheel = tickActive
    ? { rate: Math.min(s.speed * TICK_RATE_PER_MS, TICK_RATE_MAX), gain: TICK_LEVEL * (0.4 + 0.6 * smoothstep(TICK_SPEED_MIN, 12, s.speed)) }
    : null;

  const profile = TYRE_PROFILES[s.surface];
  let surface = null;
  if (mech > 0 && s.grounded && profile.pulse && s.speed > 1) {
    const p = profile.pulse;
    const wetDamp = p.wetDamp ? 1 - p.wetDamp * s.wet : 1 - 0.3 * s.wet;
    surface = {
      buffer: p.buffer, jitter: p.jitter,
      rate: Math.min(p.base + p.perMs * s.speed, p.max),
      gain: p.gain * smoothstep(0, TYRE_FULL_SPEED, s.speed) * wetDamp,
    };
  }

  const drips = s.rain > 0.05 ? { rate: s.rain * DRIP_RATE_MAX, gain: DRIP_LEVEL * s.rain * amb } : null;

  let song = null;
  if (s.rain <= RAIN_SILENCES_BIRDS) {
    if (s.night < DAY_NIGHT_MAX) song = { kind: 'birds', gain: BIRD_LEVEL * (s.paused ? PAUSED_AMBIENT : 1), menu: !s.riding };
    else if (s.night > NIGHT_MIN) song = { kind: 'crickets', gain: CRICKET_LEVEL * (s.paused ? PAUSED_AMBIENT : 1), menu: !s.riding };
  }
  return { freewheel, surface, drips, song };
}

/* ----------------------------------------------------------------------------------------------- buffers */
function fillPinkNoise(data, sampleRate, random) {
  // Paul Kellet's filter, generated a seam longer than needed, then the tail is crossfaded (equal power) into the head: the loop is seamless
  const length = data.length;
  const seam = Math.min(Math.floor(sampleRate * NOISE_SEAM_SECONDS), length >> 1);
  const raw = new Float32Array(length + seam);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
  }
  for (let i = 0; i < length; i++) data[i] = raw[i];
  for (let i = 0; i < seam; i++) {
    const a = (i / seam) * Math.PI / 2;
    data[i] = raw[i] * Math.sin(a) + raw[length + i] * Math.cos(a);
  }
  let sum = 0;
  for (let i = 0; i < length; i++) sum += data[i] * data[i];
  const scale = NOISE_RMS / Math.max(1e-6, Math.sqrt(sum / length));
  for (let i = 0; i < length; i++) data[i] = clamp(data[i] * scale, -1, 1);
}

/** Short percussive buffers, baked once: each is [seconds, (t, i, random) -> sample] */
const BAKED = Object.freeze({
  click: [0.012, (t, _i, r) => (Math.sin(TAU * 2200 * t) * Math.exp(-t / 0.002) * 0.7 + (r() * 2 - 1) * Math.exp(-t / 0.0015) * 0.5)],
  thump: [0.16, (t, _i, r) => (Math.sin(TAU * (80 - 220 * t) * t) * Math.exp(-t / 0.04) * 0.9 + (r() * 2 - 1) * Math.exp(-t / 0.006) * 0.15)],
  clunk: [0.14, (t, _i, r) => (Math.sin(TAU * 300 * t) * Math.exp(-t / 0.03) * 0.7 + Math.sin(TAU * 470 * t) * Math.exp(-t / 0.02) * 0.3 + (r() * 2 - 1) * Math.exp(-t / 0.004) * 0.3)],
  crackle: [0.018, (t, _i, r) => (r() * 2 - 1) * Math.exp(-t / 0.003)],
  rustle: [0.035, (t, _i, r) => (r() * 2 - 1) * Math.sin(Math.PI * t / 0.035) * 0.6],
  drip: [0.05, t => Math.sin(TAU * (2600 + 1200 * t / 0.05) * t) * Math.exp(-t / 0.012)],
});

function bakeBuffer(ctx, spec, random) {
  const [seconds, fn] = spec;
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = clamp(fn(i / ctx.sampleRate, i, random), -1, 1);
  return buffer;
}

/* ----------------------------------------------------------------------------------------------- engine */
/**
 * createAudio({ win, random?, now? }) -> { resume, update, event, setMuted, isMuted, dispose, getStats }
 * `random` / `now` are optional hooks for tests (Math.random, wall clock in seconds).
 */
export function createAudio(opts = {}) {
  const win = opts.win ?? (typeof window !== 'undefined' ? window : null);
  const random = opts.random ?? Math.random;
  const clock = opts.now ?? (() => ((win && win.performance && win.performance.now) ? win.performance.now() : Date.now()) / 1000);
  const setTimer = (fn, ms) => (win && win.setTimeout ? win.setTimeout(fn, ms) : setTimeout(fn, ms));
  const clearTimer = id => (win && win.clearTimeout ? win.clearTimeout(id) : clearTimeout(id));

  let ctx = null;
  let graph = null;              // the live nodes, built once
  let buffers = null;            // baked one-shot buffers
  let muted = readMutedFlag();
  let disposed = false;
  let state = sanitizeFrame(null);
  let animT = 0;                 // accumulated animation time for the wobbles
  let schedulerTimer = null;
  let muteTimer = null;
  let lastCompression = 0;
  let lastThumpAt = -Infinity;
  const paramCache = new Map();  // AudioParam -> last target (skip no-op updates)
  const voices = [];             // live event voices
  const lastEventAt = new Map(); // event name -> wall-clock seconds
  const warned = new Set();
  const next = { tick: 0, pulse: 0, drip: 0, song: 0 };
  const stats = { voicesStarted: 0, voicesDropped: 0, eventsRateLimited: 0, errors: 0 };

  /* ----------------------------------------------------------- small utilities */
  function readMutedFlag() {
    try { return Boolean(win && win.localStorage && win.localStorage.getItem('pb_muted') === '1'); } catch (error) { return false; }
  }
  function warnOnce(key, error) {
    stats.errors++;
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[mtb] audio: ${key}`, error && error.message ? error.message : error);
  }
  /** Smoothly move an AudioParam to `value` (no clicks); unchanged / non-finite targets are skipped. */
  function setTarget(param, value, tc) {
    if (!isFiniteNumber(value)) return;
    const prev = paramCache.get(param);
    if (prev !== undefined && Math.abs(prev - value) <= 1e-5 * Math.max(1, Math.abs(value))) return;
    paramCache.set(param, value);
    param.setTargetAtTime(value, ctx.currentTime, tc);
  }

  /* ----------------------------------------------------------- context + graph */
  function createContext() {
    const Ctor = win && (win.AudioContext || win.webkitAudioContext);
    if (!Ctor) { warnOnce('no Web Audio available', null); return; }
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
      graph = buildGraph(ctx);
      buffers = {};
      for (const [name, spec] of Object.entries(BAKED)) buffers[name] = bakeBuffer(ctx, spec, random);
      const t = ctx.currentTime;
      for (const key of Object.keys(next)) next[key] = t + (key === 'song' ? 1 + random() * 2 : 0);
      applyMasterGain();
      if (muted) scheduleMuteSuspend();
      schedulerTick();
    } catch (error) {
      warnOnce('could not create the AudioContext', error);
      teardownContext();
    }
  }

  function buildGraph(c) {
    const master = c.createGain();
    master.gain.value = 0;                          // fades in by applyMasterGain()
    const compressor = c.createDynamicsCompressor();
    compressor.threshold.value = -14; compressor.knee.value = 24; compressor.ratio.value = 6;
    compressor.attack.value = 0.005; compressor.release.value = 0.25;
    master.connect(compressor); compressor.connect(c.destination);

    const noiseBuffer = c.createBuffer(1, Math.floor(c.sampleRate * NOISE_SECONDS), c.sampleRate);
    fillPinkNoise(noiseBuffer.getChannelData(0), c.sampleRate, random);
    const pink = c.createBufferSource();
    pink.buffer = noiseBuffer; pink.loop = true;

    const layer = (type, freq, q) => {
      const filter = c.createBiquadFilter();
      filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
      const gain = c.createGain();
      gain.gain.value = 0;
      pink.connect(filter); filter.connect(gain); gain.connect(master);
      return { filter, gain };
    };
    const tyre = layer('bandpass', TYRE_PROFILES.dirt.freq, TYRE_PROFILES.dirt.q);
    const hiss = layer('highpass', 1000, 0.7);
    const wind = layer('bandpass', 300, 0.4);
    const brake = layer('bandpass', 3400, 14);
    const chain = layer('bandpass', 1500, 0.9);
    const water = layer('lowpass', 1800, 0.7);

    const chainTone = c.createOscillator();         // faint triangle through the chain band-pass
    chainTone.type = 'triangle'; chainTone.frequency.value = 150;
    chainTone.connect(chain.filter);

    const skidTone = c.createOscillator();          // rubbery scrub: low sawtooth
    skidTone.type = 'sawtooth'; skidTone.frequency.value = 108;
    const skidGain = c.createGain();
    skidGain.gain.value = 0;
    skidTone.connect(skidGain); skidGain.connect(master);

    pink.start(0, random() * noiseBuffer.duration);
    chainTone.start(); skidTone.start();
    const all = [master, compressor, pink, tyre.filter, tyre.gain, hiss.filter, hiss.gain, wind.filter, wind.gain, brake.filter, brake.gain,
      chain.filter, chain.gain, water.filter, water.gain, chainTone, skidTone, skidGain];
    return { master, compressor, pink, noiseBuffer, tyre, hiss, wind, brake, chain, water, chainTone, skidTone, skidGain, all };
  }

  function teardownContext() {
    if (schedulerTimer !== null) { clearTimer(schedulerTimer); schedulerTimer = null; }
    if (muteTimer !== null) { clearTimer(muteTimer); muteTimer = null; }
    const old = ctx;
    ctx = null;
    if (graph) {
      for (const node of graph.all) {
        try { if (typeof node.stop === 'function') node.stop(); } catch (error) { /* already stopped */ }
        try { node.disconnect(); } catch (error) { /* already disconnected */ }
      }
    }
    for (const v of voices) safeDisconnect(v.out);
    voices.length = 0;
    graph = null; buffers = null;
    paramCache.clear();
    if (old && typeof old.close === 'function') {
      try { const p = old.close(); if (p && p.catch) p.catch(() => {}); } catch (error) { /* already closed */ }
    }
  }
  function safeDisconnect(node) { try { node.disconnect(); } catch (error) { /* gone */ } }

  /** master gain: 0 when muted, MASTER_LEVEL otherwise, linear ramp in 50 ms (no click) */
  function applyMasterGain() {
    if (!ctx || !graph) return;
    const t = ctx.currentTime;
    const gain = graph.master.gain;
    gain.cancelScheduledValues(t);
    gain.setValueAtTime(finite(gain.value, 0), t);
    gain.linearRampToValueAtTime(muted ? 0 : MASTER_LEVEL, t + MUTE_RAMP_S);
  }

  function tryResume() {
    if (!ctx || ctx.state === 'running') return;
    try {
      const p = ctx.resume();
      if (p && p.catch) p.catch(error => warnOnce('resume refused (will retry on the next gesture)', error));
    } catch (error) { warnOnce('resume failed', error); }
  }

  /* ----------------------------------------------------------- public: resume / mute */
  function resume() {
    if (disposed) return;
    if (!ctx) createContext();
    if (ctx && !muted) tryResume();                 // 'suspended' / 'interrupted' (iOS): retried on every gesture
  }

  /** a muted game suspends its context shortly after the ramp (CPU); unmuting resumes it */
  function scheduleMuteSuspend() {
    if (muteTimer !== null) clearTimer(muteTimer);
    muteTimer = setTimer(() => {
      muteTimer = null;
      if (muted && ctx && ctx.state === 'running') { try { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); } catch (error) { /* ignore */ } }
    }, MUTE_SUSPEND_DELAY_MS);
  }

  function setMuted(value) {
    const flag = Boolean(value);
    if (flag === muted && (!ctx || !graph)) return;
    muted = flag;
    if (disposed) return;
    if (muteTimer !== null) { clearTimer(muteTimer); muteTimer = null; }
    if (!ctx) return;
    applyMasterGain();
    if (muted) scheduleMuteSuspend();
    else tryResume();
  }
  const isMuted = () => muted;
  const isRunning = () => Boolean(ctx && graph && ctx.state === 'running');

  /* ----------------------------------------------------------- public: update (every frame) */
  function update(frame) {
    if (disposed) return;
    const s = sanitizeFrame(frame);
    state = s;
    animT += s.dt;
    if (!ctx || !graph) return;
    try {
      applyTargets(computeTargets(s, animT));
      detectSuspensionThump(s);
    } catch (error) { warnOnce('update failed', error); }
  }

  function applyTargets(t) {
    const g = graph;
    setTarget(g.tyre.gain.gain, t.tyre.gain, TC_TYRE);
    setTarget(g.tyre.filter.frequency, t.tyre.freq, TC_FILTER);
    setTarget(g.tyre.filter.Q, t.tyre.q, TC_FILTER);
    setTarget(g.hiss.gain.gain, t.hiss.gain, TC_HISS);
    setTarget(g.hiss.filter.frequency, t.hiss.freq, TC_HISS);
    setTarget(g.wind.gain.gain, t.wind.gain, TC_WIND);
    setTarget(g.wind.filter.frequency, t.wind.freq, TC_WIND);
    setTarget(g.brake.gain.gain, t.brake.gain, TC_BRAKE);
    setTarget(g.brake.filter.frequency, t.brake.freq, TC_BRAKE);
    setTarget(g.chain.gain.gain, t.chain.gain, TC_CHAIN);
    setTarget(g.chain.filter.frequency, t.chain.freq, TC_CHAIN);
    setTarget(g.chainTone.frequency, t.chain.toneHz, TC_CHAIN);
    setTarget(g.skidGain.gain, t.skid.gain, TC_SKID);
    setTarget(g.skidTone.frequency, t.skid.freq, TC_SKID);
    setTarget(g.water.gain.gain, t.water.gain, TC_WATER);
    setTarget(g.water.filter.frequency, t.water.freq, TC_WATER);
  }

  /** fast compression change -> one tiny low thump (the suspension bottoming out) */
  function detectSuspensionThump(s) {
    const rate = (s.compression - lastCompression) / Math.max(s.dt, 1 / 240);
    lastCompression = s.compression;
    if (muted || !isRunning() || !s.riding || s.paused || !s.grounded || rate < COMPRESSION_THUMP_RATE) return;
    const wall = clock();
    if (wall - lastThumpAt < COMPRESSION_THUMP_GAP_S) return;
    lastThumpAt = wall;
    playBuffer('thump', ctx.currentTime, COMPRESSION_THUMP_LEVEL * clamp(rate / 20, 0.3, 1), 1.4);
  }

  /* ----------------------------------------------------------- one-shot building blocks */
  /** a baked buffer through its own gain, frees itself when it has played */
  function playBuffer(name, when, gain, rate = 1) {
    const src = ctx.createBufferSource();
    src.buffer = buffers[name];
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = clamp(gain, 0, 1);
    src.connect(g); g.connect(graph.master);
    src.onended = () => { safeDisconnect(src); safeDisconnect(g); };
    src.start(when);
  }

  /** gain envelope: 0 -> peak (attack), held, then an exponential-ish decay (setTargetAtTime). Returns the time it is silent. */
  function envelope(param, t, peak, attack, hold, tail) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + attack);
    if (hold > 0) param.setValueAtTime(peak, t + attack + hold);
    param.setTargetAtTime(0, t + attack + hold, Math.max(0.001, tail / 3));
    return t + attack + hold + tail * 1.5 + 0.02;
  }

  /** an oscillator note into a voice. o: { type, freq, freqEnd?, t, attack?, hold?, tail, level } */
  function addTone(voice, o) {
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, o.t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, o.t + (o.sweep ?? ((o.attack ?? 0.004) + (o.hold ?? 0) + o.tail)));
    const g = ctx.createGain();
    const end = envelope(g.gain, o.t, o.level, o.attack ?? 0.004, o.hold ?? 0, o.tail);
    osc.connect(g); g.connect(voice.out);
    osc.start(o.t); osc.stop(end);
    voice.end = Math.max(voice.end, end);
  }

  /** a filtered noise burst into a voice. o: { filter, freq, freqEnd?, q, t, attack?, hold?, tail, level } */
  function addNoise(voice, o) {
    const src = ctx.createBufferSource();
    src.buffer = graph.noiseBuffer; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filter ?? 'bandpass'; f.Q.value = o.q ?? 0.8;
    f.frequency.setValueAtTime(o.freq, o.t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, o.t + (o.sweep ?? ((o.attack ?? 0.004) + (o.hold ?? 0) + o.tail)));
    const g = ctx.createGain();
    const end = envelope(g.gain, o.t, o.level, o.attack ?? 0.004, o.hold ?? 0, o.tail);
    src.connect(f); f.connect(g); g.connect(voice.out);
    src.start(o.t, random() * (graph.noiseBuffer.duration - 0.5)); src.stop(end);
    voice.end = Math.max(voice.end, end);
  }

  /* ----------------------------------------------------------- voices (event sounds, max 24) */
  function reapVoices(now) {
    for (let i = voices.length - 1; i >= 0; i--) {
      if (voices[i].end + 0.1 < now) { safeDisconnect(voices[i].out); voices.splice(i, 1); }
    }
  }
  /** drop the oldest of the quietest voices (fade out in 20 ms) */
  function dropOneVoice(now) {
    const sorted = voices.map(v => v.level).sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    let victim = null;
    for (const v of voices) if (v.level <= median && (victim === null || v.start < victim.start)) victim = v;
    if (!victim) return;
    victim.out.gain.cancelScheduledValues(now);
    victim.out.gain.setTargetAtTime(0, now, 0.01);
    victim.end = Math.min(victim.end, now + 0.05);
    stats.voicesDropped++;
    voices.splice(voices.indexOf(victim), 1);
    setTimer(() => safeDisconnect(victim.out), 120);
  }
  function beginVoice(level) {
    const now = ctx.currentTime;
    reapVoices(now);
    while (voices.length >= MAX_VOICES) dropOneVoice(now);
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(graph.master);
    const voice = { out, level, start: now, end: now, t0: now + 0.005 };
    voices.push(voice);
    stats.voicesStarted++;
    return voice;
  }

  /* ----------------------------------------------------------- public: events */
  const MAJOR_ARPEGGIO = [523.25, 659.25, 783.99, 1046.5, 1318.5];

  const EVENTS = {
    land(d) {
      const impact = clamp(num(d.impact, 4, 0, 14) / 14, 0, 1), quality = num(d.quality, 0, 0, 1);
      const v = beginVoice(0.25 + 0.55 * impact), t = v.t0;
      addTone(v, { freq: 120 - 45 * impact, freqEnd: 42, t, attack: 0.003, tail: 0.12 + 0.18 * impact, level: 0.25 + 0.55 * impact });
      addNoise(v, { filter: 'lowpass', freq: 500 + 900 * (1 - impact), q: 0.7, t, tail: 0.1 + 0.08 * impact, level: 0.05 + 0.2 * impact });
      if (quality > 0.8) addNoise(v, { filter: 'bandpass', freq: 5200, q: 0.7, t: t + 0.01, attack: 0.01, tail: 0.14, level: 0.07 * quality });
    },
    jump() {
      const v = beginVoice(0.12), t = v.t0;
      addNoise(v, { filter: 'bandpass', freq: 600, freqEnd: 1800, q: 0.8, t, attack: 0.04, tail: 0.14, level: 0.08 });
      addTone(v, { type: 'triangle', freq: 300, freqEnd: 520, t, tail: 0.08, level: 0.05 });
    },
    crash(d) {
      const sev = num(d.severity, 0.6, 0, 1);
      const v = beginVoice(0.4 + 0.3 * sev), t = v.t0;
      [0, 0.15, 0.32, 0.5].forEach((offset, i) => {
        addTone(v, { freq: 95 - 12 * i, freqEnd: 38, t: t + offset, attack: 0.003, tail: 0.14, level: (0.35 + 0.25 * sev) * (1 - 0.18 * i) });
        addNoise(v, { filter: 'lowpass', freq: 700, q: 0.7, t: t + offset, tail: 0.1, level: 0.12 * (1 - 0.15 * i) });
      });
      for (let i = 0; i < 5; i++) {                  // clatter
        addNoise(v, { filter: 'bandpass', freq: 900 + random() * 1800, q: 1.2, t: t + random() * 0.55, attack: 0.002, tail: 0.04, level: 0.07 * (0.5 + sev * 0.5) });
      }
    },
    checkpoint(d) {
      const ratio = d.better === false ? 0.89 : 1;     // slightly lower when it is not a record
      const v = beginVoice(0.2), t = v.t0, bright = d.better === true;
      addTone(v, { type: 'triangle', freq: 880 * ratio, t, hold: 0.06, tail: 0.06, level: 0.16 });
      addTone(v, { type: 'triangle', freq: 1320 * ratio, t: t + 0.12, hold: 0.06, tail: 0.06, level: 0.16 });
      if (bright) addTone(v, { freq: 2640, t: t + 0.12, tail: 0.12, level: 0.05 });
    },
    countdown() {
      const v = beginVoice(0.2);
      addTone(v, { type: 'triangle', freq: 440, t: v.t0, hold: 0.1, tail: 0.05, level: 0.2 });
    },
    go() {
      const v = beginVoice(0.25);
      addTone(v, { type: 'triangle', freq: 880, t: v.t0, hold: 0.3, tail: 0.1, level: 0.22 });
      addTone(v, { freq: 1760, t: v.t0, hold: 0.2, tail: 0.1, level: 0.05 });
    },
    medal(d) {
      const tier = Math.round(num(d.tier, 1, 1, 3));
      const v = beginVoice(0.25 + 0.05 * tier), t = v.t0, level = 0.7 + 0.15 * tier;
      MAJOR_ARPEGGIO.slice(0, 4).forEach((hz, i) => {
        const last = i === 3, at = t + i * 0.09;
        addTone(v, { type: 'square', freq: hz, t: at, hold: last ? 0.3 : 0.05, tail: 0.04, level: 0.045 * level });
        addTone(v, { type: 'triangle', freq: hz, t: at, hold: last ? 0.3 : 0.05, tail: 0.04, level: 0.14 * level });
      });
      if (tier >= 3) {                               // gold: sparkle tail
        addNoise(v, { filter: 'highpass', freq: 6500, q: 0.7, t: t + 0.3, attack: 0.02, hold: 0.1, tail: 0.3, level: 0.05 });
        [0.34, 0.45, 0.56].forEach((o, i) => addTone(v, { freq: 2637 * (1 + 0.25 * i), t: t + o, tail: 0.1, level: 0.04 }));
      }
    },
    finish() {
      const v = beginVoice(0.25), t = v.t0;
      [523.25, 659.25, 783.99].forEach((hz, i) => addTone(v, { type: 'triangle', freq: hz, t: t + i * 0.1, hold: i === 2 ? 0.15 : 0.04, tail: 0.06, level: 0.17 }));
    },
    collect() {
      const v = beginVoice(0.18), t = v.t0;
      addTone(v, { freq: 1318.5, t, tail: 0.1, level: 0.14 });
      addTone(v, { type: 'triangle', freq: 1318.5, t, tail: 0.1, level: 0.06 });
      addTone(v, { freq: 1760, t: t + 0.08, tail: 0.22, level: 0.14 });
      addTone(v, { type: 'triangle', freq: 1760, t: t + 0.08, tail: 0.22, level: 0.06 });
    },
    unlock() {
      const v = beginVoice(0.25), t = v.t0;
      MAJOR_ARPEGGIO.forEach((hz, i) => addTone(v, { type: 'triangle', freq: hz, t: t + i * 0.08, hold: i === 4 ? 0.35 : 0.03, tail: i === 4 ? 0.2 : 0.05, level: 0.15 }));
    },
    ui(d) {
      const v = beginVoice(0.08), t = v.t0;
      if (d.kind === 'back') addTone(v, { freq: 900, t, tail: 0.03, level: 0.08 });
      else if (d.kind === 'toggle') addTone(v, { freq: 1200, freqEnd: 1800, t, tail: 0.035, level: 0.08 });
      else addTone(v, { freq: 1500, t, tail: 0.025, level: 0.08 });
    },
    respawn() {
      const v = beginVoice(0.15), t = v.t0;
      addNoise(v, { filter: 'bandpass', freq: 300, freqEnd: 3500, q: 1.1, t, attack: 0.05, tail: 0.3, level: 0.12 });
      addTone(v, { freq: 300, freqEnd: 1200, t, tail: 0.25, level: 0.04 });
    },
  };

  function event(name, data) {
    if (disposed || !isRunning() || muted) return;
    const handler = Object.prototype.hasOwnProperty.call(EVENTS, name) ? EVENTS[name] : null;
    if (!handler) { warnOnce(`unknown event "${String(name)}"`, null); return; }
    const wall = clock();
    const last = lastEventAt.get(name);
    if (last !== undefined && wall - last < EVENT_MIN_GAP_S) { stats.eventsRateLimited++; return; }
    lastEventAt.set(name, wall);
    try { handler(data && typeof data === 'object' ? data : {}); } catch (error) { warnOnce(`event "${name}" failed`, error); }
  }

  /* ----------------------------------------------------------- lookahead scheduler */
  function schedulerTick() {
    schedulerTimer = null;
    if (disposed || !ctx || !graph) return;
    try { if (ctx.state === 'running') runScheduler(ctx.currentTime); } catch (error) { warnOnce('scheduler failed', error); }
    if (!disposed && ctx) schedulerTimer = setTimer(schedulerTick, SCHEDULER_INTERVAL_MS);
  }

  /** place the events of one pulse train that fall before `horizon`; `rate` 0/undefined means the train is off */
  function runTrain(key, rate, jitter, now, horizon, play) {
    if (!isFiniteNumber(rate) || rate <= 0 || muted) { next[key] = Math.max(next[key], now); return; }
    next[key] = Math.max(next[key], now);          // a clock that fell behind (throttled tab) is skipped, never burst-played
    let guard = MAX_PER_PASS;
    while (next[key] < horizon && guard-- > 0) {
      play(next[key]);
      next[key] += (1 / rate) * (1 + jitter * (random() * 2 - 1) * 0.9);
    }
  }

  function runScheduler(now) {
    reapVoices(now);
    const plan = computeSchedule(state);
    const horizon = now + LOOKAHEAD_S;

    const fw = plan.freewheel;
    runTrain('tick', fw ? fw.rate : 0, 0.1, now, horizon, t => playBuffer('click', t, fw.gain * (0.75 + 0.25 * random()), 0.9 + 0.2 * random()));

    const sf = plan.surface;
    runTrain('pulse', sf ? sf.rate : 0, sf ? sf.jitter : 0, now, horizon, t => playBuffer(sf.buffer, t, sf.gain * (0.7 + 0.3 * random()), 0.85 + 0.3 * random()));

    const dr = plan.drips;
    runTrain('drip', dr ? dr.rate : 0, 0.8, now, horizon, t => playBuffer('drip', t, dr.gain * (0.5 + 0.5 * random()), 0.7 + 0.9 * random()));

    scheduleSong(plan.song, now, horizon);
  }

  function scheduleSong(song, now, horizon) {
    if (!song || muted) { next.song = Math.max(next.song, now + 0.5); return; }
    if (next.song > horizon) return;
    const at = Math.max(next.song, now);
    const [lo, hi] = song.kind === 'birds' ? (song.menu ? BIRD_INTERVAL.menu : BIRD_INTERVAL.riding) : CRICKET_INTERVAL;
    if (song.kind === 'birds') scheduleChirp(at, song.gain);
    else scheduleCricket(at, song.gain);
    next.song = at + lo + random() * (hi - lo);
  }

  /** one bird call: 2-4 sine glides (2.5-5 kHz, 40-120 ms) with a tiny vibrato in the frequency curve, randomly panned */
  function scheduleChirp(t, level) {
    const notes = 2 + Math.floor(random() * 3);
    const pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = random() * 1.6 - 0.8; pan.connect(graph.master); }
    let at = t;
    for (let i = 0; i < notes; i++) {
      const dur = 0.04 + random() * 0.08;
      const f0 = 2500 + random() * 2500, f1 = 2500 + random() * 2500;
      const curve = new Float32Array(BIRD_CURVE_POINTS);
      for (let k = 0; k < BIRD_CURVE_POINTS; k++) {
        const u = k / (BIRD_CURVE_POINTS - 1);
        curve[k] = lerp(f0, f1, u) * (1 + 0.012 * Math.sin(TAU * 30 * u * dur));
      }
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueCurveAtTime(curve, at, dur);
      const g = ctx.createGain();
      const end = envelope(g.gain, at, level * (0.7 + 0.3 * random()), 0.008, Math.max(0, dur - 0.02), 0.02);
      osc.connect(g); g.connect(pan ?? graph.master);
      osc.start(at); osc.stop(end);
      at += dur + 0.03 + random() * 0.05;
    }
    if (pan) setTimer(() => safeDisconnect(pan), Math.ceil((at - t + 0.3) * 1000));
  }

  /** one cricket chirp: three pulses of a quiet 4.5 kHz sine */
  function scheduleCricket(t, level) {
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.08;
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.setValueAtTime(CRICKET_HZ * (1 + 0.01 * i), at);
      const g = ctx.createGain();
      const end = envelope(g.gain, at, level, 0.005, 0.02, 0.015);
      osc.connect(g); g.connect(graph.master);
      osc.start(at); osc.stop(end);
    }
  }

  /* ----------------------------------------------------------- lifecycle */
  const GESTURES = ['pointerdown', 'keydown', 'touchend'];
  const GESTURE_OPTIONS = { passive: true, capture: true };
  const onGesture = () => resume();
  const onMuteEvent = e => {
    if (e && e.detail && typeof e.detail.muted === 'boolean') setMuted(e.detail.muted);
    else setMuted(readMutedFlag());
  };
  const onVisible = () => { if (win && win.document && !win.document.hidden) resume(); };

  if (win && typeof win.addEventListener === 'function') {
    for (const type of GESTURES) win.addEventListener(type, onGesture, GESTURE_OPTIONS);
    win.addEventListener('arcade:mute', onMuteEvent);
    if (win.document && typeof win.document.addEventListener === 'function') win.document.addEventListener('visibilitychange', onVisible);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (win && typeof win.removeEventListener === 'function') {
      for (const type of GESTURES) win.removeEventListener(type, onGesture, GESTURE_OPTIONS);
      win.removeEventListener('arcade:mute', onMuteEvent);
      if (win.document && typeof win.document.removeEventListener === 'function') win.document.removeEventListener('visibilitychange', onVisible);
    }
    teardownContext();
  }

  function getStats() {
    return Object.freeze({
      ...stats, voices: voices.length, hasContext: Boolean(ctx), state: ctx ? ctx.state : 'none',
      steadyNodes: graph ? graph.all.length : 0, muted,
    });
  }

  return { resume, update, event, setMuted, isMuted, dispose, getStats };
}
