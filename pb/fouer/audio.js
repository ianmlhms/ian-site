/* Schueberfouer Tycoon W6 "Audio": the procedural fair soundscape (DESIGN section 5, "Sound"). Nothing is downloaded: every sound is synthesised with
 * WebAudio (same approach as pb/train-sim/audio.js).
 *
 * Graph:  voices (max 6 nearest attractions, each through an equal-power PannerNode) ----> voiceBus ┐
 *         ambient bed (crowd murmur + laughter blips, generator hum, rain on canvas, tram, distant fireworks) -> ambientBus ┤-> master -> limiter -> out
 *         UI blips (sfx.js) + one-shots (eat, bleat, shutter, game stalls) -----------------------------------> sfxBus ┘
 * The context is created on the first tap (iOS), the arcade's mute (localStorage pb_muted + the `arcade:mute` event) and the game's own switch
 * (pb_fouer_sound) both silence it and suspend the context. Ambient is 30 % in the builder view, full in the walk; the attraction voices follow the
 * listener (the walker, or the point the builder camera looks at).
 * Pure helpers at the top (no WebAudio, harness-tested): organPhrase, voiceKindFor, pickVoices, voiceGain. */

const KEY = "pb_fouer_sound";
const MUTED_KEY = "pb_muted";
export const MAX_VOICES = 6;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const midiToHz = m => 440 * Math.pow(2, (m - 69) / 12);
const readFlag = (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (error) { return fallback; } };

/** which voice an attraction makes */
const KIND = {
  kanner: "organ", gold: "organ", kette: "organ", bayern: "organ", happy: "organ", wheel: "calliope",
  musik: "dance", break: "dance", takeoff: "dance",
  scooter: "scooter", maus: "coaster", looping: "coaster", alpina: "coaster", splash: "splash", geister: "ghost",
  jules: "tower", hangover: "tower", booster: "tower", infinity: "tower",
  schiess: "shoot", lukas: "lukas", lous: "lous",
  kachel: "fryer", fritten: "fryer", wurscht: "fryer", crepes: "fryer", waffel: "fryer", mandel: "fryer", zocker: "fryer", fesch: "fryer", tent: "band",
};
export const voiceKindFor = id => KIND[id] ?? null;
/** loudness and reach of a voice kind: { gain, ref (metres where it is at full volume), reach (silent beyond) } */
const VOICE = {
  organ: { gain: 0.5, ref: 9, reach: 70 }, calliope: { gain: 0.38, ref: 14, reach: 80 }, dance: { gain: 0.42, ref: 10, reach: 75 },
  scooter: { gain: 0.5, ref: 9, reach: 55 }, coaster: { gain: 0.55, ref: 14, reach: 90 }, splash: { gain: 0.5, ref: 12, reach: 75 },
  ghost: { gain: 0.45, ref: 9, reach: 55 }, tower: { gain: 0.5, ref: 16, reach: 95 }, shoot: { gain: 0.5, ref: 5, reach: 36 },
  lukas: { gain: 0.5, ref: 5, reach: 36 }, lous: { gain: 0.35, ref: 5, reach: 30 }, fryer: { gain: 0.3, ref: 3.5, reach: 24 }, band: { gain: 0.5, ref: 9, reach: 60 },
};
/** how loud a voice is at distance d (inverse distance, 0 beyond its reach): the same curve the PannerNode uses, for the picking and the tests */
export function voiceGain(kind, d) {
  const v = VOICE[kind]; if (!v) return 0;
  if (d >= v.reach) return 0;
  return v.gain * v.ref / (v.ref + 1.4 * Math.max(0, d - v.ref)) * (1 - Math.pow(d / v.reach, 3));
}
/** the nearest voices that are audible: candidates = [{ id, kind, x, z }] -> at most `max` of them, loudest first */
export function pickVoices(candidates, listener, max = MAX_VOICES) {
  return candidates.map(c => ({ ...c, level: voiceGain(c.kind, Math.hypot(c.x - listener.x, c.z - listener.z)) }))
    .filter(c => c.level > 0.012).sort((a, b) => b.level - a.level).slice(0, max);
}

function seeded(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const CHORDS = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]];        // I IV V I (semitones above the tonic)
/** an 8-bar waltz phrase (3/4): the carousel organ tune. Notes { beat (from the start), midi, dur (beats), kind: 'mel' | 'bass' | 'chord' }. Deterministic per seed. */
export function organPhrase(seed, tonic = 60) {
  const rnd = seeded(seed + 17);
  const notes = [];
  let degree = Math.floor(rnd() * 3) * 2;
  for (let bar = 0; bar < 8; bar++) {
    const chord = CHORDS[[0, 1, 2, 3, 0, 1, 2, 3][bar]];
    const beat0 = bar * 3;
    notes.push({ beat: beat0, midi: tonic - 12 + chord[0], dur: 0.9, kind: "bass" });
    notes.push({ beat: beat0 + 1, midi: tonic + chord[0] + 4, dur: 0.5, kind: "chord" }, { beat: beat0 + 1, midi: tonic + chord[1], dur: 0.5, kind: "chord" }, { beat: beat0 + 1, midi: tonic + chord[2], dur: 0.5, kind: "chord" });
    notes.push({ beat: beat0 + 2, midi: tonic + chord[0] + 4, dur: 0.5, kind: "chord" }, { beat: beat0 + 2, midi: tonic + chord[1], dur: 0.5, kind: "chord" }, { beat: beat0 + 2, midi: tonic + chord[2], dur: 0.5, kind: "chord" });
    // melody: three notes a bar, a random walk on the scale that likes the chord tones, a rest on the last bar's end
    const pattern = rnd() < 0.5 ? [1, 0.5, 0.5, 1] : [1.5, 0.5, 1];
    let at = 0;
    for (const dur of pattern) {
      if (at >= 3) break;
      const step = Math.floor(rnd() * 5) - 2;
      degree = clamp(degree + step, -2, 9);
      const note = tonic + 12 + Math.floor(degree / 7) * 12 + MAJOR[((degree % 7) + 7) % 7];
      if (!(bar === 7 && at > 1.5)) notes.push({ beat: beat0 + at, midi: note, dur: dur * 0.92, kind: "mel" });
      at += dur;
    }
  }
  notes.sort((a, b) => a.beat - b.beat);               // the scheduler walks the list in time order
  return { notes, beats: 24, bpm: 118 };
}

/* ------------------------------------------------------------------------------------------------ the engine */
export function createAudio({ game = null, r = null, world = null, env = null, tram = null, rects = [], items = null, crowd = null, getListener = null } = {}) {
  let ctx = null, master = null, limiter = null, ambientBus = null, voiceBus = null, sfxBus = null;
  let white = null, brown = null;
  let enabled = readFlag(KEY, "1") !== "0";
  let mode = "builder";
  let lastTick = 0, voiceClock = 0, tramClock = 0, laughClock = 3, fireClock = 4, rainClock = 0;
  const voices = new Map();            // pitch index -> voice
  const ambient = {};                  // the continuous layers
  const tramState = { mode: "idle", dwellFlag: false, bellUntil: 0 };
  const counters = { voicesBuilt: 0, oneShots: 0, errors: 0 };
  const muted = () => readFlag(MUTED_KEY, "0") === "1";
  const silent = () => !enabled || muted();

  /* ---------------------------------------------------------------- context */
  function ensure() {
    if (ctx || typeof window === "undefined") return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor({ latencyHint: "interactive" });
      master = ctx.createGain(); master.gain.value = 0;
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -12; limiter.knee.value = 8; limiter.ratio.value = 14; limiter.attack.value = 0.004; limiter.release.value = 0.22;
      master.connect(limiter); limiter.connect(ctx.destination);
      ambientBus = ctx.createGain(); voiceBus = ctx.createGain(); sfxBus = ctx.createGain();
      ambientBus.gain.value = 0.3; voiceBus.gain.value = 0.35; sfxBus.gain.value = 0.45;
      ambientBus.connect(master); voiceBus.connect(master); sfxBus.connect(master);
      white = noiseBuffer(ctx, "white", 3); brown = noiseBuffer(ctx, "brown", 4);
      buildAmbient();
      applyMute();
    } catch (error) { console.warn("[fouer] audio unavailable", error.message); ctx = null; counters.errors++; }
    return ctx;
  }
  function applyMute() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(silent() ? 0 : 0.8, t, 0.08);
    if (silent()) setTimeout(() => { if (silent() && ctx && ctx.state === "running") ctx.suspend().catch(() => {}); }, 400);
    else if (ctx.state === "suspended") ctx.resume().catch(() => {});
  }
  function unlock() {
    const c = ensure();
    if (c && c.state === "suspended" && !silent()) c.resume().catch(() => {});
    return c;
  }
  if (typeof window !== "undefined") {
    window.addEventListener("arcade:mute", () => applyMute());
    document.addEventListener("visibilitychange", () => { if (!document.hidden && ctx && !silent() && ctx.state !== "running") ctx.resume().catch(() => {}); });
    window.addEventListener("storage", event => { if (event.key === MUTED_KEY || event.key === KEY) applyMute(); });
  }

  function noiseBuffer(c, kind, seconds) {
    const length = Math.floor(c.sampleRate * seconds);
    const buffer = c.createBuffer(1, length, c.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "brown") { last = (last + 0.02 * w) / 1.02; data[i] = last * 3.5; } else data[i] = w;
    }
    return buffer;
  }
  function noiseSource(buffer, offset = true) {
    const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = true;
    s.start(0, offset ? Math.random() * buffer.duration : 0);
    return s;
  }
  const filt = (type, freq, q = 0.7) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; };
  const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const chain = (...nodes) => { for (let i = 0; i + 1 < nodes.length; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; };

  /* ---------------------------------------------------------------- one-shot synthesis helpers */
  function burst(dest, t, { dur = 0.05, f = 2000, q = 1, type = "bandpass", peak = 0.5, buffer = white, decay = null } = {}) {
    const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = true;
    const flt = filt(type, f, q), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.006, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + (decay ?? dur));
    chain(s, flt, g, dest); s.start(t, Math.random() * 2); s.stop(t + (decay ?? dur) + 0.05);
  }
  function tone(dest, t, { f = 440, dur = 0.2, type = "sine", peak = 0.3, slideTo = null, attack = 0.01, vibrato = 0 } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (vibrato) { const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.5; lg.gain.value = f * vibrato; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.05); }
    chain(o, g, dest); o.start(t); o.stop(t + dur + 0.05);
  }
  /** a struck bell: inharmonic partials with their own decays (the tram bell and the Lukas bell) */
  function bell(dest, t, f = 1020, peak = 0.25, dur = 1.1) {
    [[1, 1, 1], [2.756, 0.55, 0.6], [5.404, 0.3, 0.4], [1.0035, 0.6, 0.9]].forEach(([ratio, amp, d]) => tone(dest, t, { f: f * ratio, dur: dur * d, peak: peak * amp, attack: 0.002 }));
  }
  /** a breathy laugh: formant-filtered sawtooth pulses with falling pitch */
  function laugh(dest, t, base = 260, pulses = 4, peak = 0.12) {
    for (let i = 0; i < pulses; i++) {
      const at = t + i * 0.14, f = base * (1 - i * 0.05);
      const o = ctx.createOscillator(), g = ctx.createGain(), f1 = filt("bandpass", 820, 4), f2 = filt("bandpass", 1350, 5), mix = gain(1);
      o.type = "sawtooth"; o.frequency.setValueAtTime(f * 1.15, at); o.frequency.exponentialRampToValueAtTime(f * 0.85, at + 0.1);
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak * (1 - i * 0.12), at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.115);
      o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(dest); o.start(at); o.stop(at + 0.14); void mix;
    }
  }
  function scream(dest, t, dur = 1.4, peak = 0.18, base = 880) {
    [1, 1.51].forEach((k, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = filt("bandpass", 1800, 3), lfo = ctx.createOscillator(), lg = ctx.createGain();
      o.type = i ? "triangle" : "sawtooth"; o.frequency.setValueAtTime(base * k, t); o.frequency.linearRampToValueAtTime(base * k * 1.7, t + dur * 0.55); o.frequency.linearRampToValueAtTime(base * k * 1.35, t + dur);
      lfo.frequency.value = 7; lg.gain.value = 40; lfo.connect(lg); lg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak * (i ? 0.6 : 1), t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      chain(o, f, g, dest); o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    });
  }

  /* ---------------------------------------------------------------- ambient bed */
  function buildAmbient() {
    // crowd murmur: two bands of brown noise with slow swells
    const m1 = noiseSource(brown), m2 = noiseSource(brown);
    const murmur = gain(0.0), low = chain(m1, filt("lowpass", 700, 0.5), gain(0.7)), mid = chain(m2, filt("bandpass", 1100, 0.6), gain(0.5));
    low.connect(murmur); mid.connect(murmur); murmur.connect(ambientBus);
    const swell = ctx.createOscillator(), swellG = gain(0.12); swell.frequency.value = 0.13; swell.connect(swellG); swellG.connect(murmur.gain); swell.start();
    ambient.murmur = murmur;
    // generator hum (50 Hz + harmonics) and a faint electrical buzz
    const hum = gain(0.0);
    [[50, "sawtooth", 0.5], [100, "sine", 0.35], [150, "sine", 0.15]].forEach(([f, type, a]) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; const g = gain(a); chain(o, g, hum); o.start(); });
    const humLow = filt("lowpass", 380, 0.7); hum.disconnect(); hum.connect(humLow); humLow.connect(ambientBus);
    ambient.hum = hum;
    // rain on canvas: hissing noise plus patter
    const rainSrc = noiseSource(white), rain = gain(0.0);
    chain(rainSrc, filt("highpass", 1200, 0.5), filt("lowpass", 7500, 0.5), rain); rain.connect(ambientBus);
    ambient.rain = rain;
    // wind for the rides (the wheel's top, the coaster front seat): filtered brown noise, level set by ride.js
    const windSrc = noiseSource(brown), wind = gain(0.0); chain(windSrc, filt("bandpass", 520, 0.5), wind); wind.connect(master);
    ambient.wind = wind;
    // tram: rumble + whine, positioned (panner) at the tram
    const tramSrc = noiseSource(brown), tramGain = gain(0.0), panner = makePanner(14, 120);
    chain(tramSrc, filt("lowpass", 240, 0.8), tramGain, panner);
    const whine = ctx.createOscillator(), whineG = gain(0.0); whine.type = "sawtooth"; whine.frequency.value = 180; chain(whine, filt("lowpass", 600, 0.5), whineG, panner); whine.start();
    panner.connect(ambientBus);
    ambient.tram = { gain: tramGain, whine, whineG, panner };
  }
  function makePanner(ref, max) {
    const p = ctx.createPanner();
    p.panningModel = "equalpower"; p.distanceModel = "inverse"; p.refDistance = ref; p.maxDistance = max; p.rolloffFactor = 1.3;
    return p;
  }
  const setPos = (p, x, y, z) => {
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
  };

  /* ---------------------------------------------------------------- attraction voices */
  function makeVoice(kind, index, id, x, y, z) {
    const spec = VOICE[kind];
    const panner = makePanner(spec.ref, spec.reach);
    setPos(panner, x, y, z);
    const out = gain(0.0001);
    panner.connect(out); out.connect(voiceBus);
    const stoppers = [];
    const track = node => { stoppers.push(node); return node; };
    const rnd = seeded(index * 97 + 5);
    const v = { kind, index, id, panner, out, x, z, level: 0, born: ctx.currentTime, next: ctx.currentTime + 0.05, rnd, beat: 0, tick: () => {}, stop() { stoppers.forEach(n => { try { n.stop(); } catch (error) { /* ended */ } }); try { out.disconnect(); panner.disconnect(); } catch (error) { /* ignore */ } } };
    const cycle = items && items.cycleOf ? items.cycleOf(index) : 45;
    switch (kind) {
      case "organ": case "calliope": case "band": {
        const phrase = organPhrase(index * 13 + 3, kind === "calliope" ? 67 : kind === "band" ? 55 : 60);
        const bpm = kind === "calliope" ? 84 : kind === "band" ? 108 : phrase.bpm, beatSec = 60 / bpm;
        const entry = filt("lowpass", kind === "band" ? 1800 : 2600, 0.6), tail = gain(1);
        entry.connect(tail); tail.connect(panner);
        let t0 = ctx.currentTime + 0.1, cursor = 0;
        const playNote = (n, at) => {
          const f = midiToHz(n.midi), len = n.dur * beatSec;
          const loud = n.kind === "mel" ? 0.17 : n.kind === "bass" ? 0.2 : 0.075;
          const types = kind === "band" ? ["sawtooth", "square"] : kind === "calliope" ? ["triangle", "sine"] : ["square", "sawtooth"];
          types.forEach((type, k) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = type; o.frequency.value = f * (k ? 1.004 : 0.997);
            g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(loud * (k ? 0.5 : 0.7), at + 0.014); g.gain.setValueAtTime(loud * (k ? 0.5 : 0.7) * 0.8, at + Math.max(0.02, len * 0.7)); g.gain.exponentialRampToValueAtTime(0.0001, at + len + 0.08);
            if (n.kind === "mel") { const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.2; lg.gain.value = f * 0.006; lfo.connect(lg); lg.connect(o.frequency); lfo.start(at); lfo.stop(at + len + 0.1); }
            chain(o, g, entry); o.start(at); o.stop(at + len + 0.12);
          });
        };
        v.tick = () => {
          const now = ctx.currentTime;
          while (t0 + phrase.notes[cursor % phrase.notes.length].beat * beatSec + Math.floor(cursor / phrase.notes.length) * phrase.beats * beatSec < now + 0.4) {
            const n = phrase.notes[cursor % phrase.notes.length];
            const at = t0 + (n.beat + Math.floor(cursor / phrase.notes.length) * phrase.beats) * beatSec;
            if (at >= now - 0.05) playNote(n, Math.max(at, now));
            cursor++;
          }
        };
        if (kind === "band") { const crowdN = noiseSource(brown); const cg = gain(0.1); chain(crowdN, filt("bandpass", 900, 0.5), cg, panner); stoppers.push(crowdN); }
        break;
      }
      case "dance": {
        const bpm = 126, beat = 60 / bpm;
        const head = filt("lowpass", 1500, 0.8), tail = gain(1); head.connect(tail); tail.connect(panner);
        let step = 0, t0 = ctx.currentTime + 0.1;
        const BASS = [38, 38, 41, 43, 38, 38, 36, 43];
        v.tick = () => {
          const now = ctx.currentTime;
          while (t0 + step * beat / 2 < now + 0.4) {
            const at = Math.max(t0 + step * beat / 2, now);
            if (step % 2 === 0) tone(head, at, { f: 150, slideTo: 45, dur: 0.16, peak: 0.55, attack: 0.003 });
            else burst(head, at, { f: 7500, q: 0.8, type: "highpass", peak: 0.08, dur: 0.04 });
            tone(head, at, { f: midiToHz(BASS[(step >> 1) % BASS.length] + (step % 4 === 3 ? 12 : 0)), type: "sawtooth", dur: beat * 0.45, peak: 0.16 });
            if (step % 2 === 1 || step % 4 === 0) tone(head, at, { f: midiToHz(66 + [0, 3, 7, 10, 7, 3][step % 6]), type: "square", dur: beat * 0.3, peak: 0.05 });
            step++;
          }
        };
        break;
      }
      case "scooter": {
        const head = gain(1); head.connect(panner);
        const buzz = ctx.createOscillator(), bg = gain(0.035); buzz.type = "sawtooth"; buzz.frequency.value = 118; chain(buzz, filt("bandpass", 600, 1.5), bg, head); buzz.start(); track(buzz);
        v.tick = () => {
          const now = ctx.currentTime;
          if (v.next < now + 0.3) {
            const at = Math.max(v.next, now);
            if (rnd() < 0.6) tone(head, at, { f: 700 + rnd() * 500, slideTo: 180, dur: 0.1, type: "sawtooth", peak: 0.14 });
            else { burst(head, at, { f: 380, q: 0.9, peak: 0.45, dur: 0.07 }); tone(head, at, { f: 95, slideTo: 55, dur: 0.1, peak: 0.3 }); }
            v.next = at + 0.18 + rnd() * 0.9;
          }
        };
        break;
      }
      case "coaster": case "splash": case "tower": {
        const head = gain(1); head.connect(panner);
        const rattle = noiseSource(brown), rg = gain(0.0), rf = filt("bandpass", kind === "tower" ? 500 : 260, 0.9); chain(rattle, rf, rg, head); track(rattle);
        const lfo = ctx.createOscillator(), lg = gain(0.04); lfo.frequency.value = kind === "tower" ? 0.4 : 5.4; lfo.connect(lg); lg.connect(rg.gain); lfo.start(); track(lfo);
        const P = Math.max(18, cycle);
        v.tick = () => {
          const now = ctx.currentTime;
          const phase = ((now - v.born) % P) / P;
          // rumble climbs through the cycle, peaks at the drop
          const swell = kind === "tower" ? Math.max(0, Math.sin(phase * Math.PI * 2 - 0.4)) : 0.35 + 0.65 * Math.sin(Math.min(1, phase * 1.7) * Math.PI);
          rg.gain.setTargetAtTime(0.07 + 0.16 * swell, now, 0.2);
          if (v.next < now + 0.2) {
            const at = Math.max(v.next, now);
            const screams = kind === "tower" ? 1 : 2;
            if (rnd() < 0.8) scream(head, at, 1.1 + rnd() * 0.8, 0.12 + 0.08 * rnd(), 760 + rnd() * 420);
            if (rnd() < 0.5 && screams > 1) scream(head, at + 0.15, 0.9, 0.09, 1100);
            if (kind === "splash" && rnd() < 0.6) burst(head, at + 0.9, { f: 900, q: 0.5, peak: 0.5, dur: 0.6, type: "lowpass" });
            if (kind === "tower") burst(head, at, { f: 3200, q: 0.5, type: "highpass", peak: 0.3, dur: 0.5 });
            v.next = at + P * (0.35 + rnd() * 0.25);
          }
        };
        break;
      }
      case "ghost": {
        const head = gain(1); head.connect(panner);
        [55, 58.3].forEach(f => { const o = ctx.createOscillator(), g = gain(0.09); o.type = "sine"; o.frequency.value = f; chain(o, g, head); o.start(); track(o); });
        v.tick = () => {
          const now = ctx.currentTime;
          if (v.next < now + 0.3) {
            const at = Math.max(v.next, now);
            if (rnd() < 0.5) tone(head, at, { f: 170, slideTo: 80, dur: 0.9, type: "sawtooth", peak: 0.07 });
            else laugh(head, at, 140, 5, 0.1);
            v.next = at + 2.5 + rnd() * 4;
          }
        };
        break;
      }
      case "shoot": {
        const head = gain(1); head.connect(panner);
        v.tick = () => {
          const now = ctx.currentTime;
          if (v.next < now + 0.25) {
            const at = Math.max(v.next, now);
            burst(head, at, { f: 1900, q: 0.8, peak: 0.7, dur: 0.03 }); burst(head, at, { f: 260, q: 1, peak: 0.5, dur: 0.07 });
            if (rnd() < 0.5) tone(head, at + 0.09, { f: 1900 + rnd() * 700, dur: 0.22, peak: 0.08, attack: 0.002 });
            v.next = at + 0.6 + rnd() * 1.8;
          }
        };
        break;
      }
      case "lukas": {
        const head = gain(1); head.connect(panner);
        v.tick = () => {
          const now = ctx.currentTime;
          if (v.next < now + 0.3) {
            const at = Math.max(v.next, now);
            burst(head, at, { f: 130, q: 0.8, peak: 0.8, dur: 0.12, type: "lowpass" });
            if (rnd() < 0.55) { [0, 1, 2, 3, 4, 5].forEach(k => tone(head, at + 0.12 + k * 0.045, { f: 600 + k * 190, dur: 0.07, peak: 0.07, type: "triangle" })); bell(head, at + 0.42, 1500, 0.22, 0.9); }
            v.next = at + 3.5 + rnd() * 5;
          }
        };
        break;
      }
      case "lous": {
        const head = gain(1); head.connect(panner);
        v.tick = () => {
          const now = ctx.currentTime;
          if (v.next < now + 0.25) {
            const at = Math.max(v.next, now);
            tone(head, at, { f: midiToHz(72 + MAJOR[Math.floor(rnd() * 7)]), dur: 0.35, peak: 0.1, type: "triangle", attack: 0.004 });
            if (rnd() < 0.3) burst(head, at + 0.1, { f: 2400, q: 1, peak: 0.1, dur: 0.5, decay: 0.6 });
            v.next = at + 0.6 + rnd() * 1.6;
          }
        };
        break;
      }
      case "fryer": default: {
        const head = gain(1); head.connect(panner);
        const fry = noiseSource(white), fg = gain(0.0), crackle = gain(1); chain(fry, filt("highpass", 3800, 0.5), filt("lowpass", 9000, 0.5), fg, head); track(fry);
        const lfo = ctx.createOscillator(), lg = gain(0.03); lfo.frequency.value = 9; lfo.connect(lg); lg.connect(fg.gain); lfo.start(); track(lfo); void crackle;
        fg.gain.value = 0.1;
        v.tick = () => {
          const now = ctx.currentTime;
          if (v.next < now + 0.2) { const at = Math.max(v.next, now); burst(head, at, { f: 4200 + rnd() * 2500, q: 1.5, peak: 0.18, dur: 0.02 }); v.next = at + 0.05 + rnd() * 0.25; }
        };
        break;
      }
    }
    return v;
  }
  function syncVoices(listener, builderScale) {
    const cands = [];
    if (game) {
      game.state.pitches.forEach((entry, i) => {
        if (!entry) return;
        const kind = voiceKindFor(entry.k); if (!kind) return;
        const rect = rects[i];
        cands.push({ id: entry.k, kind, index: i, x: rect.u, z: rect.w, y: (rect.y ?? 0) + (VOICE[kind].ref > 8 ? 6 : 3) });
      });
    }
    const picked = pickVoices(cands, listener);
    const keep = new Set(picked.map(p => p.index));
    for (const [index, v] of voices) {
      if (!keep.has(index)) { v.out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2); const dead = v; voices.delete(index); setTimeout(() => dead.stop(), 900); }
    }
    for (const p of picked) {
      let v = voices.get(p.index);
      if (!v) { try { v = makeVoice(p.kind, p.index, p.id, p.x, p.y, p.z); voices.set(p.index, v); counters.voicesBuilt++; } catch (error) { counters.errors++; console.warn("[fouer] voice failed", p.kind, error.message); continue; } }
      v.level = p.level;
      v.out.gain.setTargetAtTime(VOICE[p.kind].gain * builderScale, ctx.currentTime, 0.35);
    }
  }

  /* ---------------------------------------------------------------- the tram */
  function updateTram(dt) {
    if (!tram || !world) return;
    const st = tram.debug.state();
    const a = ambient.tram;
    const c = st.visible ? tram.track.at(st.pos) : null;
    if (c) { const g = world.toGame(c.x, c.z); setPos(a.panner, g[0], 2, g[1]); }
    const moving = st.visible && st.v > 0.05;
    const v = clamp(st.v / 5.4, 0, 1);
    a.gain.gain.setTargetAtTime(moving ? 0.1 + 0.45 * v : 0.0, ctx.currentTime, 0.4);
    a.whineG.gain.setTargetAtTime(moving ? 0.018 + 0.04 * v : 0, ctx.currentTime, 0.4);
    a.whine.frequency.setTargetAtTime(120 + 320 * v, ctx.currentTime, 0.3);
    const t = ctx.currentTime;
    if (st.mode !== tramState.mode) {
      if (st.mode === "dwell") { tramState.dwellFlag = true; const dest = a.panner; bell(dest, t + 0.05, 880, 0.5, 1.4); bell(dest, t + 0.62, 660, 0.5, 1.8); }
      if (tramState.mode === "dwell" && st.mode === "run") { for (let k = 0; k < 4; k++) bell(a.panner, t + 0.05 + k * 0.27, 1020, 0.45, 0.7); }
      tramState.mode = st.mode;
    }
    if (st.mode === "run" && st.v > 1 && Math.floor(t / 4) !== Math.floor((t - dt) / 4) && Math.random() < 0.3) { bell(a.panner, t, 1020, 0.3, 0.6); bell(a.panner, t + 0.27, 1020, 0.3, 0.6); }
  }

  /* ---------------------------------------------------------------- update */
  function update(dt) {
    if (!ctx || silent()) return;
    if (ctx.state === "suspended") return;
    const L = getListener ? getListener() : null;
    if (!L) return;
    const t = ctx.currentTime;
    const walkMode = mode === "walk";
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = L.x; l.positionY.value = L.y; l.positionZ.value = L.z;
      l.forwardX.value = L.fx; l.forwardY.value = L.fy; l.forwardZ.value = L.fz; l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { l.setPosition(L.x, L.y, L.z); l.setOrientation(L.fx, L.fy, L.fz, 0, 1, 0); }
    const bedScale = walkMode ? 1 : 0.3;
    ambientBus.gain.setTargetAtTime(bedScale, t, 0.4);
    const zoom = walkMode ? 1 : clamp(1.15 - (L.dist ?? 150) / 230, 0.25, 1);
    voiceBus.gain.setTargetAtTime(walkMode ? 1 : 0.5 * zoom, t, 0.4);
    // crowd murmur follows how many guests are around; the generator hum is steady
    const near = crowd ? (walkMode ? crowd.stats.near : Math.min(40, crowd.stats.active)) : 20;
    const lambda = game ? game.info().lambda : 10;
    ambient.murmur.gain.setTargetAtTime(0.1 + 0.34 * clamp(near / 45, 0, 1) + 0.04 * clamp(lambda / 200, 0, 1), t, 0.6);
    ambient.hum.gain.setTargetAtTime(0.05, t, 0.6);
    const weather = env ? env.getState() : null;
    const rain = weather ? clamp(weather.rain ?? (weather.weather === "rain" ? 1 : 0), 0, 1) : 0;
    ambient.rain.gain.setTargetAtTime(0.12 * rain, t, 0.8);
    rainClock -= dt;
    if (rain > 0.2 && rainClock <= 0) { rainClock = 0.04 + Math.random() * 0.1; burst(ambientBus, t, { f: 2600 + Math.random() * 2200, q: 2, peak: 0.1 * rain, dur: 0.012 }); }
    // laughter and shrieks around the listener
    laughClock -= dt;
    if (laughClock <= 0 && near > 4) {
      laughClock = 2.5 + Math.random() * 6 / Math.max(0.3, clamp(near / 40, 0.3, 1));
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const out = p ?? ambientBus; if (p) { p.pan.value = (Math.random() * 2 - 1) * 0.8; p.connect(ambientBus); }
      const kid = Math.random() < 0.35;
      if (kid) tone(out, t, { f: 1500 + Math.random() * 500, slideTo: 2600, dur: 0.26, peak: 0.05, type: "triangle", vibrato: 0.02 });
      else laugh(out, t, 210 + Math.random() * 140, 3 + Math.floor(Math.random() * 3), 0.07);
      if (p) setTimeout(() => { try { p.disconnect(); } catch (error) { /* ignore */ } }, 1500);
    }
    // distant fireworks on the last night(s)
    if (game && game.events && game.events.fireworks && game.events.fireworks.live) {
      fireClock -= dt;
      if (fireClock <= 0) { fireClock = 2.5 + Math.random() * 3.5; const at = t + 0.1; burst(ambientBus, at, { f: 120, q: 0.6, type: "lowpass", peak: 0.5, dur: 0.5 }); for (let k = 0; k < 6; k++) burst(ambientBus, at + 0.4 + Math.random() * 0.5, { f: 2500 + Math.random() * 2000, q: 1, peak: 0.05, dur: 0.03 }); }
    }
    // attraction voices (re-picked 4x a second) and their sequencers (every frame)
    voiceClock -= dt;
    if (voiceClock <= 0) { voiceClock = 0.25; syncVoices(L, 1); }
    for (const v of voices.values()) { try { v.tick(); } catch (error) { counters.errors++; } }
    tramClock -= dt;
    if (tramClock <= 0) { tramClock = 0.1; updateTram(0.1); }
    lastTick = t;
  }

  /* ---------------------------------------------------------------- one-shots (all through the sfx bus, never positional) */
  const oneShot = fn => { if (silent()) return; const c = unlock(); if (!c) return; counters.oneShots++; try { fn(c.currentTime + 0.01); } catch (error) { counters.errors++; console.warn("[fouer] sound failed", error.message); } };
  const api = {
    get enabled() { return enabled; },
    get context() { return ctx; },
    get sfxBus() { return sfxBus; },
    get muted() { return silent(); },
    ensure, unlock, update,
    setEnabled(on) { enabled = Boolean(on); try { localStorage.setItem(KEY, enabled ? "1" : "0"); } catch (error) { /* storage blocked */ } if (enabled) ensure(); applyMute(); },
    setMode(m) { mode = m; },
    /** ride wind, 0..1 (ride.js) */
    setWind(level) { if (ctx && ambient.wind) ambient.wind.gain.setTargetAtTime(clamp(level, 0, 1) * 0.34, ctx.currentTime, 0.3); },
    get mode() { return mode; },
    /** UI blips use this (sfx.js) */
    tone(freq, at, length, opts) { if (silent()) return; const c = unlock(); if (!c) return; tone(sfxBus, c.currentTime + at, { f: freq, dur: length, type: opts.type, peak: opts.gain, slideTo: opts.slide ? freq * opts.slide : null, attack: 0.012 }); },
    eat() { oneShot(t => { [0, 0.22, 0.46, 0.7].forEach(k => burst(sfxBus, t + k, { f: 2400 + k * 500, q: 1.2, peak: 0.4, dur: 0.06 })); tone(sfxBus, t + 0.9, { f: 330, slideTo: 440, dur: 0.3, peak: 0.07, vibrato: 0.01 }); }); },
    bleat() { oneShot(t => { const o = ctx.createOscillator(), g = ctx.createGain(), f1 = filt("bandpass", 900, 3), f2 = filt("bandpass", 1500, 4), lfo = ctx.createOscillator(), lg = gain(75); o.type = "sawtooth"; o.frequency.setValueAtTime(340, t); o.frequency.linearRampToValueAtTime(270, t + 0.75); lfo.frequency.value = 27; lfo.connect(lg); lg.connect(o.frequency); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.06); g.gain.setValueAtTime(0.2, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8); o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(sfxBus); o.start(t); lfo.start(t); o.stop(t + 0.9); lfo.stop(t + 0.9); }); },
    shutter() { oneShot(t => { burst(sfxBus, t, { f: 3800, q: 1, peak: 0.5, dur: 0.012 }); burst(sfxBus, t + 0.07, { f: 2400, q: 1, peak: 0.4, dur: 0.02 }); }); },
    playGame(item) { oneShot(t => { if (item === "schiess") [0, 0.35, 0.8].forEach(k => { burst(sfxBus, t + k, { f: 1900, q: 0.8, peak: 0.8, dur: 0.03 }); burst(sfxBus, t + k, { f: 260, q: 1, peak: 0.5, dur: 0.08 }); }); else if (item === "lukas") { burst(sfxBus, t, { f: 130, q: 0.8, peak: 0.9, dur: 0.14, type: "lowpass" }); [0, 1, 2, 3, 4, 5, 6].forEach(k => tone(sfxBus, t + 0.14 + k * 0.05, { f: 600 + k * 170, dur: 0.07, peak: 0.1, type: "triangle" })); bell(sfxBus, t + 0.5, 1500, 0.35, 1.1); } else [0, 0.12, 0.26].forEach((k, i) => tone(sfxBus, t + k, { f: midiToHz(72 + [0, 4, 7][i]), dur: 0.3, peak: 0.16, type: "triangle" })); }); },
    /** the ride cabin: a soft wooden clunk and a bell when the wheel starts / stops */
    clunk() { oneShot(t => { burst(sfxBus, t, { f: 180, q: 1, peak: 0.7, dur: 0.14, type: "lowpass" }); bell(sfxBus, t + 0.12, 1250, 0.25, 0.9); }); },
    stats() {
      return { state: ctx ? ctx.state : "none", enabled, muted: silent(), mode, voices: [...voices.values()].map(v => ({ kind: v.kind, index: v.index, level: +v.level.toFixed(3) })), ambient: Object.keys(ambient),
        built: counters.voicesBuilt, oneShots: counters.oneShots, errors: counters.errors, time: ctx ? ctx.currentTime : 0, sampleRate: ctx ? ctx.sampleRate : 0 };
    },
    dispose() { for (const v of voices.values()) v.stop(); voices.clear(); if (ctx) ctx.close().catch(() => {}); ctx = null; },
  };
  void lastTick; void TAU;
  return api;
}
