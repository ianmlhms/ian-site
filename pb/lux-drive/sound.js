/* The sound of Lux Drive: everything is synthesised with WebAudio (no sample files).
 *   the engine   a sawtooth and a square one octave up through a low-pass; the pitch follows the rpm of an imaginary
 *                gearbox (sound-model.js), the brightness and the volume follow the throttle
 *   the tyres    band-passed noise that rises with the slip (the squeal) and a low rolling roar that grows with the speed
 *   the thud     a short low sine plus a puff of noise when the car hits a wall, a tree or a lamp post
 *   the rain     a loop of filtered noise whose level follows the rain of the weather
 * The AudioContext is only created on the first user gesture (iOS refuses it before) and the mute switch is remembered
 * by the caller.  A wrong call never stops the game: a failed audio start is logged and the game stays silent. */
import { createGearbox, firingHz, squealLevel, thudLevel, rollLevel } from './sound-model.js';

const MASTER_GAIN = 0.55;
const ENGINE_GAIN = 0.16;
const NOISE_SECONDS = 2;
const GESTURES = ['pointerdown', 'touchend', 'keydown', 'mousedown'];
const PARAM_TAU = 0.04;               // s: the time constant of every smoothed parameter (no clicks)

export function createSound({ muted = false } = {}) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let ctx = null, graph = null;
  let isMuted = muted;
  let lastHits = null;
  const gearbox = createGearbox();
  const info = { gear: 1, rpm: 850, load: 0, squeal: 0, roll: 0, rain: 0, thuds: 0 };

  const noiseBuffer = (seconds) => {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 1234567;                                   // a fixed seed: the same rain every time, and no Math.random in the loop
    for (let i = 0; i < data.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; data[i] = (seed / 4294967296) * 2 - 1; }
    return buffer;
  };
  const noiseSource = (buffer) => { const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = true; s.start(); return s; };
  const gainNode = (value) => { const g = ctx.createGain(); g.gain.value = value; return g; };
  const filter = (type, frequency, q = 0.7) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = frequency; f.Q.value = q; return f; };

  function build() {
    const master = gainNode(isMuted ? 0 : MASTER_GAIN);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    master.connect(analyser);
    master.connect(ctx.destination);

    // the engine
    const saw = ctx.createOscillator(); saw.type = 'sawtooth';
    const square = ctx.createOscillator(); square.type = 'square';
    const sawGain = gainNode(0.6), squareGain = gainNode(0.22);
    const engineLow = filter('lowpass', 600, 0.9);
    const engineOut = gainNode(0);
    saw.connect(sawGain).connect(engineLow);
    square.connect(squareGain).connect(engineLow);
    engineLow.connect(engineOut).connect(master);
    saw.start(); square.start();

    // the tyres
    const noise = noiseBuffer(NOISE_SECONDS);
    const squealBand = filter('bandpass', 1900, 9);
    const squealOut = gainNode(0);
    noiseSource(noise).connect(squealBand).connect(squealOut).connect(master);
    const rollLow = filter('lowpass', 420, 0.5);
    const rollOut = gainNode(0);
    noiseSource(noise).connect(rollLow).connect(rollOut).connect(master);

    // the rain
    const rainHigh = filter('highpass', 900, 0.4), rainBand = filter('bandpass', 4200, 0.35);
    const rainOut = gainNode(0);
    noiseSource(noise).connect(rainHigh).connect(rainBand).connect(rainOut).connect(master);

    graph = { master, analyser, saw, square, engineLow, engineOut, squealBand, squealOut, rollLow, rollOut, rainOut, noise };
  }

  /** Called from the first user gesture: iOS Safari only lets an AudioContext start inside one. */
  function unlock() {
    if (ctx || !AudioCtx) { if (ctx && ctx.state === 'suspended') ctx.resume().catch((e) => console.warn('[luxdrive] audio resume', e)); return; }
    try {
      ctx = new AudioCtx();
      build();
      ctx.resume().catch((e) => console.warn('[luxdrive] audio resume', e));
    } catch (error) {
      console.warn('[luxdrive] audio could not start, the game stays silent', error);
      ctx = null; graph = null;
    }
  }
  const onGesture = () => { unlock(); if (ctx && ctx.state === 'running') for (const g of GESTURES) window.removeEventListener(g, onGesture, true); };
  for (const g of GESTURES) window.addEventListener(g, onGesture, true);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {}); else ctx.resume().catch(() => {});
  });

  const ramp = (param, value) => param.setTargetAtTime(value, ctx.currentTime, PARAM_TAU);

  function thud(strength) {
    const t = ctx.currentTime;
    const body = ctx.createOscillator(); body.type = 'sine';
    body.frequency.setValueAtTime(115, t); body.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    const bodyGain = gainNode(0);
    bodyGain.gain.setValueAtTime(0.9 * strength, t); bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    body.connect(bodyGain).connect(graph.master);
    body.start(t); body.stop(t + 0.32);
    const puff = ctx.createBufferSource(); puff.buffer = graph.noise;
    const puffLow = filter('lowpass', 520, 0.6);
    const puffGain = gainNode(0);
    puffGain.gain.setValueAtTime(0.5 * strength, t); puffGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    puff.connect(puffLow).connect(puffGain).connect(graph.master);
    puff.start(t, 0, 0.2);
    info.thuds += 1;
  }

  return {
    get running() { return !!ctx && ctx.state === 'running'; },
    get started() { return !!ctx; },
    get muted() { return isMuted; },
    /** Mute or unmute (the setting of the player). */
    setMuted(value) {
      isMuted = !!value;
      if (graph) ramp(graph.master.gain, isMuted ? 0 : MASTER_GAIN);
    },
    /** For the flows and the tests: the last values that were sent to the audio graph, and the level at the output. */
    debug() {
      let level = 0;
      if (graph) { const buf = new Uint8Array(graph.analyser.fftSize); graph.analyser.getByteTimeDomainData(buf); for (const b of buf) level = Math.max(level, Math.abs(b - 128) / 128); }
      return { ...info, state: ctx ? ctx.state : 'none', muted: isMuted, level };
    },
    /**
     * Every frame.  `car` is the state of the car, `drive` = { throttle } of the pedal, `rain` 0..1, `active` false while a menu is up
     * (the engine falls silent, the rain stays).
     */
    update(dt, car, drive, rain, active) {
      if (!graph) return;
      const g = gearbox.update(dt, car.speed, active ? drive.throttle : 0);
      const squeal = active ? squealLevel(car.slip, car.speed, car.grounded) : 0;
      const roll = active ? rollLevel(car.speed, car.surface) : 0;
      Object.assign(info, { gear: g.gear, rpm: g.rpm, load: g.load, squeal, roll, rain });
      const hz = firingHz(g.rpm);
      ramp(graph.saw.frequency, hz); ramp(graph.square.frequency, hz * 2);
      ramp(graph.engineLow.frequency, 380 + g.rpm * 0.16 + g.load * 1500);
      ramp(graph.engineOut.gain, active ? ENGINE_GAIN * (0.45 + 0.55 * g.load) * (0.7 + 0.3 * (g.rpm / 6200)) : 0);
      ramp(graph.squealBand.frequency, 1500 + Math.abs(car.speed) * 18);
      ramp(graph.squealOut.gain, squeal * 0.16);
      ramp(graph.rollLow.frequency, 300 + Math.abs(car.speed) * 14 * (car.surface === 'asphalt' ? 1 : 1.8));
      ramp(graph.rollOut.gain, roll * 0.1);
      ramp(graph.rainOut.gain, rain * (active ? 0.07 : 0.045));
      // a collision: the car counts its hits, a new count is a thud (the first frame only reads the count)
      if (lastHits === null) lastHits = car.hits || 0;
      if ((car.hits || 0) !== lastHits) {
        lastHits = car.hits || 0;
        const strength = thudLevel(car.lastHitSpeed || 0);
        if (strength > 0 && !isMuted) thud(Math.min(1, strength));
      }
    },
    unlock,
  };
}
