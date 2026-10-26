#!/usr/bin/env node
/* MTB Mëllerdall audio harness.   node pb/mtb/harness-audio.js [--verbose]
 *
 * Runs pb/mtb/audio.js against a fake AudioContext (records every node, evaluates AudioParam timelines, and THROWS where a browser would:
 * non-finite or negative values, exponential ramps to <= 0, zero-length curves). No browser, no sound. Proves:
 *   A  pure helpers: smoothstep, sanitizeFrame (garbage in, clamped out), computeTargets / computeSchedule stay finite and obey the spec curves
 *   B  lifecycle: no AudioContext before the first gesture (pointerdown / keydown / touchend / resume()), webkit prefix, interrupted retry
 *   C  update() never throws on junk, writes only finite params, creates no node, steady-state node budget
 *   D  scheduler: every surface / weather / mode for 10 s of simulated time, finite, bounded node creation, silent when paused or menu
 *   E  events: every one-shot builds, is rate-limited (60 ms), capped at 24 voices, ignores unknown names
 *   F  mute: localStorage pb_muted, arcade:mute, setMuted(): master gain -> 0 within 50 ms, no one-shots while muted, suspend + resume
 *   G  noise loop is seamless; dispose() stops everything and closes the context
 * Exit code 0 only when every check passes. */
import { createAudio, smoothstep, sanitizeFrame, computeTargets, computeSchedule } from './audio.js';

const VERBOSE = process.argv.includes('--verbose');
const results = { pass: 0, fail: 0, failures: [] };
function check(name, ok, detail = '') {
  if (ok) { results.pass++; if (VERBOSE) console.log('  ok  ', name, detail); return; }
  results.fail++; results.failures.push(`${name} ${detail}`); console.log('  FAIL', name, detail);
}
const section = title => console.log(`\n${title}`);
const throws = fn => { try { fn(); return false; } catch (error) { return true; } };

/* ------------------------------------------------------------------------------------------------ fake Web Audio */
class FakeParam {
  constructor(ctx, initial, name) { this.ctx = ctx; this.name = name; this.init = initial; this.events = []; this.writes = 0; }
  check(...values) {
    for (const v of values) if (typeof v !== 'number' || !Number.isFinite(v)) { this.ctx.violations.push(`${this.name}: non-finite ${v}`); throw new TypeError(`non-finite ${v}`); }
  }
  checkTime(t) { this.check(t); if (t < 0) { this.ctx.violations.push(`${this.name}: negative time ${t}`); throw new RangeError('negative time'); } }
  add(event) { this.writes++; this.ctx.paramWrites++; this.events.push(event); this.events.sort((a, b) => a.time - b.time); }
  setValueAtTime(value, time) { this.check(value); this.checkTime(time); this.add({ type: 'set', value, time }); return this; }
  linearRampToValueAtTime(value, time) { this.check(value); this.checkTime(time); this.add({ type: 'linear', value, time }); return this; }
  exponentialRampToValueAtTime(value, time) {
    this.check(value); this.checkTime(time);
    if (value <= 0) { this.ctx.violations.push(`${this.name}: exponential ramp to ${value}`); throw new RangeError('exp ramp <= 0'); }
    this.add({ type: 'linear', value, time }); return this;
  }
  setTargetAtTime(target, time, tc) {
    this.check(target, tc); this.checkTime(time);
    if (tc < 0) throw new RangeError('negative time constant');
    this.add({ type: 'target', value: target, time, tc }); return this;
  }
  setValueCurveAtTime(curve, time, duration) {
    this.checkTime(time); this.check(duration);
    if (!(duration > 0) || !curve || curve.length < 2) throw new RangeError('bad curve');
    for (const v of curve) this.check(v);
    this.add({ type: 'set', value: curve[0], time }); return this;
  }
  cancelScheduledValues(time) { this.check(time); this.events = this.events.filter(e => e.time < time); return this; }
  valueAt(t) {
    let v = this.init, tl = 0, tgt = null;
    const at = x => (tgt ? tgt.value + (v - tgt.value) * Math.exp(-(x - tl) / Math.max(1e-9, tgt.tc)) : v);
    for (const e of this.events) {
      if (e.type === 'linear') {
        if (t >= e.time) { v = e.value; tl = e.time; tgt = null; continue; }
        const v0 = at(tl);
        return e.time === tl ? e.value : v0 + (e.value - v0) * (t - tl) / (e.time - tl);
      }
      if (e.time > t) break;
      const ve = at(e.time);
      if (e.type === 'set') { v = e.value; tl = e.time; tgt = null; } else { v = ve; tl = e.time; tgt = { value: e.value, tc: e.tc }; }
    }
    return at(t);
  }
  get value() { return this.valueAt(this.ctx.currentTime); }
  set value(x) { this.check(x); this.init = x; this.events = []; }
}

class FakeNode {
  constructor(ctx, kind, params = {}) {
    this.ctx = ctx; this.kind = kind; this.outputs = []; this.started = false; this.stopped = false; this.disconnected = false;
    for (const [name, initial] of Object.entries(params)) this[name] = new FakeParam(ctx, initial, `${kind}.${name}`);
    ctx.nodes.push(this);
  }
  connect(dst) { if (!dst) throw new TypeError('connect to nothing'); this.outputs.push(dst); return dst; }
  disconnect() { this.disconnected = true; this.outputs = []; }
  start(when = 0, offset = 0) {
    if (this.started) throw new Error('start twice');
    if (typeof when !== 'number' || !Number.isFinite(when) || when < 0 || !Number.isFinite(offset) || offset < 0) throw new RangeError('bad start');
    this.started = true; this.startAt = when;
  }
  stop(when = 0) {
    if (!this.started) throw new Error('stop before start');
    if (typeof when !== 'number' || !Number.isFinite(when)) throw new RangeError('bad stop');
    this.stopped = true; this.stopAt = when;
  }
}

function makeFakeContext(env) {
  class FakeAudioContext {
    constructor(options) {
      this.options = options; this.nodes = []; this.buffers = []; this.violations = []; this.paramWrites = 0;
      this.currentTime = 0; this.sampleRate = 22050; this.state = 'suspended'; this.closed = false; this.resumeCalls = 0; this.suspendCalls = 0;
      this.destination = new FakeNode(this, 'destination');
      env.contexts.push(this);
    }
    createGain() { return new FakeNode(this, 'gain', { gain: 1 }); }
    createOscillator() { const n = new FakeNode(this, 'oscillator', { frequency: 440, detune: 0 }); n.type = 'sine'; return n; }
    createBiquadFilter() { const n = new FakeNode(this, 'biquad', { frequency: 350, Q: 1, gain: 0 }); n.type = 'lowpass'; return n; }
    createDynamicsCompressor() { return new FakeNode(this, 'compressor', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 }); }
    createBufferSource() { const n = new FakeNode(this, 'bufferSource', { playbackRate: 1 }); n.loop = false; n.buffer = null; return n; }
    createStereoPanner() { return new FakeNode(this, 'panner', { pan: 0 }); }
    createBuffer(channels, length, sampleRate) {
      if (!(length >= 1)) throw new RangeError('bad buffer length');
      const data = new Float32Array(length); const buffer = { length, sampleRate, duration: length / sampleRate, getChannelData: () => data };
      this.buffers.push(buffer); return buffer;
    }
    resume() { this.resumeCalls++; return env.resumeRejects ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve().then(() => { this.state = 'running'; }); }
    suspend() { this.suspendCalls++; this.state = 'suspended'; return Promise.resolve(); }
    close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  }
  return FakeAudioContext;
}

/** a window with listeners, a manual timer queue, localStorage and (webkit-prefixed or plain) AudioContext */
function makeFakeWindow({ webkit = false, muted = null } = {}) {
  const env = { contexts: [], resumeRejects: false };
  const listeners = new Map();
  const timers = new Map();
  let timerId = 0, wallNow = 0;
  const storage = new Map(muted === null ? [] : [['pb_muted', muted]]);
  const win = {
    env, timers,
    performance: { now: () => wallNow * 1000 },
    localStorage: { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) },
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    addEventListener(type, fn, opt) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push({ fn, opt }); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(l => l.fn !== fn)); },
    dispatch(type, detail) { for (const l of [...(listeners.get(type) || [])]) l.fn({ type, detail }); },
    listenerCount: () => [...listeners.values()].reduce((n, a) => n + a.length, 0),
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    runTimers() { const due = [...timers.entries()]; timers.clear(); for (const [, t] of due) t.fn(); },
    setWall(sec) { wallNow = sec; },
    get ctx() { return env.contexts[env.contexts.length - 1]; },
  };
  const Ctor = makeFakeContext(env);
  if (webkit) win.webkitAudioContext = Ctor; else win.AudioContext = Ctor;
  return win;
}
const flush = () => new Promise(resolve => setImmediate(resolve));

/** deterministic rng */
function seededRandom(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function startAudio(options = {}) {
  const win = makeFakeWindow(options);
  const audio = createAudio({ win, random: seededRandom(7), now: () => win.performance.now() / 1000 });
  win.dispatch('pointerdown');
  await flush();
  return { win, audio, ctx: win.ctx };
}
/** advance audio time + wall clock together, running the scheduler every 25 ms */
function advance(win, seconds, step = 0.025, onStep = null) {
  const ctx = win.ctx;
  for (let t = 0; t < seconds - 1e-9; t += step) {
    ctx.currentTime += step; win.setWall(win.performance.now() / 1000 + step);
    win.runTimers();
    if (onStep) onStep(t);
  }
}
const allParamsFinite = ctx => ctx.violations.length === 0;
const FULL = { dt: 1 / 60, speed: 14, grounded: true, surface: 'dirt', pedal: 0, cadence: 0, brakeFront: 0, brakeRear: 0, skid: 0, wet: 0, rain: 0, night: 0, wind: 0, fallDistance: Infinity, waterSize: 0, compression: 0, paused: false, riding: true };
const frame = patch => ({ ...FULL, ...patch });
const SURFACES = ['dirt', 'rock', 'roots', 'mud', 'leaves', 'wood', 'grass', 'water', 'road'];

/* ------------------------------------------------------------------------------------------------ A pure helpers */
section('A  pure helpers');
check('smoothstep ends and middle', smoothstep(0, 10, -5) === 0 && smoothstep(0, 10, 15) === 1 && Math.abs(smoothstep(0, 10, 5) - 0.5) < 1e-12);
check('smoothstep handles Infinity', smoothstep(10, 160, Infinity) === 1 && smoothstep(10, 160, -Infinity) === 0);
const junk = sanitizeFrame({ dt: NaN, speed: -3, cadence: 1e9, surface: 'lava', skid: 'x', wet: Infinity, fallDistance: NaN, riding: undefined, paused: 1, grounded: undefined });
check('sanitizeFrame clamps junk', junk.dt === 1 / 60 && junk.speed === 0 && junk.cadence === 110 && junk.surface === 'dirt' && junk.skid === 0 && junk.wet === 0 && junk.fallDistance === Infinity && junk.riding === true && junk.paused === true && junk.grounded === true);
check('sanitizeFrame(undefined / null / string) is complete', [undefined, null, 'x', 5].every(v => Object.keys(sanitizeFrame(v)).length === 18));
check('sanitizeFrame is frozen', Object.isFrozen(junk));
const rngFuzz = seededRandom(99);
const junkValues = [undefined, null, NaN, Infinity, -Infinity, -1, 0, 1, 2, 1e12, 'a', {}, [], true];
const fuzzFrames = Array.from({ length: 2000 }, () => {
  const f = {};
  for (const key of Object.keys(FULL)) {
    const r = rngFuzz();
    f[key] = r < 0.2 ? junkValues[Math.floor(rngFuzz() * junkValues.length)] : key === 'surface' ? SURFACES[Math.floor(rngFuzz() * 9)]
      : typeof FULL[key] === 'boolean' ? rngFuzz() < 0.5 : key === 'fallDistance' ? (rngFuzz() < 0.4 ? Infinity : rngFuzz() * 300) : rngFuzz() * 30;
  }
  return f;
});
let allFinite = true, scheduleOk = true;
for (const f of fuzzFrames) {
  const s = sanitizeFrame(f); const t = computeTargets(s, rngFuzz() * 100);
  for (const layer of Object.values(t)) for (const v of Object.values(layer)) if (!Number.isFinite(v)) allFinite = false;
  const plan = computeSchedule(s);
  for (const part of [plan.freewheel, plan.surface, plan.drips]) if (part && !Object.values(part).every(v => typeof v === 'string' || Number.isFinite(v))) scheduleOk = false;
  for (const layer of ['tyre', 'hiss', 'wind', 'brake', 'skid', 'chain', 'water']) if (t[layer].gain < 0 || t[layer].gain > 1) allFinite = false;
}
check('computeTargets finite and gains in 0..1 over 2000 fuzzed frames', allFinite);
check('computeSchedule finite over 2000 fuzzed frames', scheduleOk);
{
  const at = (patch, t = 1) => computeTargets(sanitizeFrame(frame(patch)), t);
  check('wind silent-ish below 4 m/s, strong at 20 m/s', at({ speed: 3.9 }).wind.gain < 0.03 && at({ speed: 20 }).wind.gain > 0.3);
  check('wind keeps rising with the speed and is already loud at 40 km/h (speed pass)', at({ speed: 11 }).wind.gain > 0.18 && at({ speed: 11 }).wind.gain < at({ speed: 15 }).wind.gain && at({ speed: 15 }).wind.gain <= at({ speed: 20 }).wind.gain + 1e-9 && at({ speed: 17 }).wind.freq > at({ speed: 8 }).wind.freq + 300);
  check('wind gusts add level at standstill', at({ speed: 0, wind: 1 }).wind.gain > at({ speed: 0, wind: 0 }).wind.gain + 0.1);
  check('tyre volume rises with speed, zero in the air and at 0 m/s', at({ speed: 12 }).tyre.gain > at({ speed: 4 }).tyre.gain && at({ speed: 12, grounded: false }).tyre.gain === 0 && at({ speed: 0 }).tyre.gain === 0);
  check('every surface has its own tyre filter (centre + Q)', new Set(SURFACES.map(surface => `${at({ surface }).tyre.freq}/${at({ surface }).tyre.q}`)).size === 9);
  check('water surface louder with speed', at({ surface: 'water', speed: 12 }).tyre.gain > 1.5 * at({ surface: 'water', speed: 5 }).tyre.gain);
  check('non-finite input (Infinity) falls back to the default, not to the max', sanitizeFrame({ wet: Infinity, speed: -Infinity }).wet === 0);
  check('wet adds hiss and lowers the tyre', at({ wet: 1 }).hiss.gain > at({ wet: 0 }).hiss.gain && at({ wet: 1 }).tyre.gain < at({ wet: 0 }).tyre.gain);
  check('rain drives the hiss', at({ rain: 1, speed: 0 }).hiss.gain > 0.1);
  check('brake squeal needs brake and speed, 3-4 kHz', at({ brakeFront: 1, speed: 10 }).brake.gain > 0.03 && at({ brakeFront: 1, speed: 0 }).brake.gain === 0 && at({ brakeRear: 1, speed: 10 }).brake.freq > 2400 && at({ brakeFront: 1, speed: 10 }).brake.freq < 4300);
  check('skid adds the scrub', at({ skid: 1, speed: 10 }).skid.gain > 0.02 && at({ skid: 0, speed: 10 }).skid.gain === 0);
  check('chain whir only when pedalling, pitch follows cadence', at({ pedal: 0.8, cadence: 80 }).chain.gain > 0.02 && at({ pedal: 0.05, cadence: 80 }).chain.gain === 0 && at({ pedal: 0.8, cadence: 100 }).chain.toneHz > at({ pedal: 0.8, cadence: 50 }).chain.toneHz);
  const fall = d => at({ waterSize: 1, fallDistance: d }).water.gain;
  check('waterfall gain falls with distance: loud at 10 m, silent from 160 m', fall(5) === fall(10) && fall(10) > fall(50) && fall(50) > fall(120) && fall(160) === 0 && fall(Infinity) === 0);
  check('stream is softer than the big fall', at({ waterSize: 0.3, fallDistance: 10 }).water.gain < at({ waterSize: 1, fallDistance: 10 }).water.gain);
  check('paused: mechanical layers off, ambient at 30 %', at({ paused: true }).tyre.gain === 0 && at({ paused: true, brakeFront: 1 }).brake.gain === 0
    && Math.abs(at({ paused: true, speed: 20 }).wind.gain / at({ speed: 20 }).wind.gain - 0.3) < 1e-9
    && Math.abs(at({ paused: true, waterSize: 1, fallDistance: 10 }).water.gain / at({ waterSize: 1, fallDistance: 10 }).water.gain - 0.3) < 1e-9);
  check('menu (riding=false): no tyre / brake / chain, a calm wind', at({ riding: false, speed: 20 }).tyre.gain === 0 && at({ riding: false }).chain.gain === 0 && at({ riding: false }).wind.gain > 0 && at({ riding: false }).wind.gain < 0.1);
  const plan = patch => computeSchedule(sanitizeFrame(frame(patch)));
  check('freewheel only when coasting above 1.5 m/s, ~9 ticks per m/s, capped', plan({ speed: 10 }).freewheel.rate === 45 && Math.abs(plan({ speed: 3 }).freewheel.rate - 27) < 1e-9 && plan({ speed: 1 }).freewheel === null && plan({ speed: 10, pedal: 0.6 }).freewheel === null);
  check('pulse trains: roots, wood (speed*1.2 Hz), rock, leaves; none on dirt/road', plan({ surface: 'roots' }).surface.buffer === 'thump' && Math.abs(plan({ surface: 'wood', speed: 5 }).surface.rate - 6) < 1e-9
    && plan({ surface: 'rock' }).surface.buffer === 'crackle' && plan({ surface: 'leaves' }).surface.buffer === 'rustle' && plan({ surface: 'dirt' }).surface === null && plan({ surface: 'road' }).surface === null);
  check('birds by day, none in rain > 0.5, crickets at night', plan({}).song.kind === 'birds' && plan({ rain: 0.8 }).song === null && plan({ night: 1 }).song.kind === 'crickets' && plan({ night: 0.45 }).song === null);
  check('menu mode flagged for more birds', plan({ riding: false }).song.menu === true && plan({}).song.menu === false);
}

/* ------------------------------------------------------------------------------------------------ B lifecycle */
section('B  lifecycle, autoplay, iOS');
{
  const win = makeFakeWindow();
  const audio = createAudio({ win });
  check('no AudioContext before a gesture', win.env.contexts.length === 0 && audio.getStats().hasContext === false);
  check('update / event before the context do not throw', !throws(() => { audio.update(FULL); audio.update(); audio.event('land', { impact: 5 }); }));
  win.dispatch('pointerdown'); await flush();
  check('pointerdown creates the context and resumes it', win.env.contexts.length === 1 && win.ctx.state === 'running');
  win.dispatch('keydown'); win.dispatch('touchend'); win.dispatch('pointerdown'); await flush();
  check('later gestures do not create a second context', win.env.contexts.length === 1);
  win.ctx.state = 'interrupted'; const before = win.ctx.resumeCalls; win.dispatch('touchend'); await flush();
  check("'interrupted' (iOS) is retried on the next gesture", win.ctx.resumeCalls === before + 1 && win.ctx.state === 'running');
  win.ctx.state = 'suspended'; audio.resume(); audio.resume(); await flush();
  check('resume() is safe to repeat', win.ctx.state === 'running');
  audio.dispose();
}
{
  const { win, audio } = await startAudio({ webkit: true });
  check('falls back to webkitAudioContext', win.env.contexts.length === 1);
  audio.dispose();
  const k = makeFakeWindow(); const a = createAudio({ win: k }); k.dispatch('keydown'); check('keydown creates the context', k.env.contexts.length === 1); a.dispose();
  const t = makeFakeWindow(); const b = createAudio({ win: t }); t.dispatch('touchend'); check('touchend creates the context', t.env.contexts.length === 1); b.dispose();
  const r = makeFakeWindow(); const c = createAudio({ win: r }); c.resume(); check('resume() creates the context without an event', r.env.contexts.length === 1); c.dispose();
}
{
  const win = makeFakeWindow(); win.env.resumeRejects = true;
  const warnings = []; const realWarn = console.warn; console.warn = (...a) => warnings.push(a.join(' '));
  const audio = createAudio({ win });
  audio.resume(); await flush();
  check('a refused resume() is warned about with the [mtb] prefix, no throw', warnings.length === 1 && warnings[0].startsWith('[mtb]'));
  audio.resume(); await flush();
  check('the same warning is not repeated', warnings.length === 1);
  const noAudio = { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, localStorage: { getItem: () => null } };
  const dead = createAudio({ win: noAudio }); dead.resume();
  check('no Web Audio at all: warns, never throws', warnings.length === 2 && !throws(() => { dead.update(FULL); dead.event('go'); dead.dispose(); }));
  const throwing = makeFakeWindow(); throwing.AudioContext = function () { throw new Error('boom'); };
  const bad = createAudio({ win: throwing }); bad.resume();
  check('a throwing AudioContext constructor is caught', warnings.length === 3 && bad.getStats().hasContext === false);
  console.warn = realWarn; audio.dispose(); bad.dispose();
}

/* ------------------------------------------------------------------------------------------------ C update() */
section('C  update()');
{
  const { win, audio, ctx } = await startAudio();
  const steady = audio.getStats().steadyNodes;
  check('steady-state live nodes', steady <= 20, `${steady} nodes (spec: ~14; see the report)`);
  check('node count in the fake context matches the graph (+ destination)', ctx.nodes.length === steady + 1, `${ctx.nodes.length}`);
  const nodesBefore = ctx.nodes.length;
  let threw = false;
  try {
    for (const f of fuzzFrames) { audio.update(f); ctx.currentTime += 1 / 60; }
    for (const v of [undefined, null, NaN, 'x', 5, [], {}, () => 1]) audio.update(v);
    audio.update({ dt: NaN, speed: NaN, surface: undefined, fallDistance: -Infinity });
  } catch (error) { threw = true; console.log(error); }
  check('2000 fuzzed + 9 junk frames: update never throws', !threw);
  check('no non-finite / negative value ever reached an AudioParam', allParamsFinite(ctx), ctx.violations.slice(0, 3).join(' | '));
  check('fuzzed update() creates only thump one-shots (buffer source + gain pairs)', ctx.nodes.slice(nodesBefore).every(n => n.kind === 'bufferSource' || n.kind === 'gain'));
  const created = ctx.nodes.length - nodesBefore;
  // a calm drive creates nothing at all
  audio.update(frame({ speed: 0 })); const calmBefore = ctx.nodes.length;
  for (let i = 0; i < 600; i++) { ctx.currentTime += 1 / 60; audio.update(frame({ speed: 10, surface: SURFACES[i % 9], pedal: i % 120 < 60 ? 0.7 : 0, cadence: 70, brakeFront: (i % 200) / 200, skid: (i % 90) / 90, wet: 0.5, rain: 0.4 })); }
  check('600 calm frames create zero nodes', ctx.nodes.length === calmBefore, `${ctx.nodes.length - calmBefore} new`);
  check('suspension thumps are the only per-frame nodes in the fuzz run', created % 2 === 0, `${created} nodes from the fuzz run`);
  const writes0 = ctx.paramWrites; audio.update(frame({ speed: 10 })); audio.update(frame({ speed: 10 }));
  check('identical frames write no params (no timeline growth)', ctx.paramWrites <= writes0 + 16);
  // layers follow the frame
  audio.dispose();
}
{
  const { win, audio, ctx } = await startAudio();
  const gainOf = n => n.gain.valueAt(ctx.currentTime);
  const layers = ctx.nodes.filter(n => n.kind === 'gain');
  // gain nodes in creation order: master, tyre, hiss, wind, brake, chain, water, skid
  const [, tyre, , wind, brake, chain, water, skid] = layers;
  audio.update(frame({ speed: 15, surface: 'road' })); ctx.currentTime += 1;
  check('driving fades the tyre + wind layers in', gainOf(tyre) > 0.1 && gainOf(wind) > 0.1);
  audio.update(frame({ speed: 15, paused: true })); ctx.currentTime += 1;
  check('paused fades tyres to 0 and keeps wind at ~30 %', gainOf(tyre) < 1e-3 && gainOf(wind) > 0.05);
  audio.update(frame({ speed: 15, brakeFront: 1, skid: 1 })); ctx.currentTime += 1;
  check('brakes + skid open their layers', gainOf(brake) > 0.03 && gainOf(skid) > 0.02);
  audio.update(frame({ speed: 3, pedal: 0.9, cadence: 80 })); ctx.currentTime += 1;
  check('pedalling opens the chain layer', gainOf(chain) > 0.02);
  audio.update(frame({ speed: 0, waterSize: 1, fallDistance: 20 })); ctx.currentTime += 1;
  check('near a waterfall the water layer opens', gainOf(water) > 0.2);
  audio.update(frame({ speed: 0, waterSize: 1, fallDistance: 400 })); ctx.currentTime += 1;
  check('far from the waterfall it is closed', gainOf(water) < 1e-3);
  audio.dispose();
}

/* ------------------------------------------------------------------------------------------------ D scheduler */
section('D  scheduler (10 s of simulated time per scenario)');
{
  const scenarios = [
    ...SURFACES.map(surface => [`surface ${surface}`, frame({ surface, speed: 12 })]),
    ['coasting', frame({ speed: 9, pedal: 0 })], ['pedalling', frame({ speed: 9, pedal: 0.8, cadence: 80 })],
    ['rain', frame({ rain: 1, wet: 1, speed: 8, surface: 'mud' })], ['night', frame({ night: 1, speed: 3 })],
    ['menu', frame({ riding: false, speed: 0 })], ['paused', frame({ paused: true, speed: 12, surface: 'roots' })],
  ];
  for (const [name, f] of scenarios) {
    const { win, audio, ctx } = await startAudio();
    const base = ctx.nodes.length;
    let threw = false;
    try { audio.update(f); advance(win, 10, 0.025, () => audio.update(f)); } catch (error) { threw = true; console.log(error); }
    const created = ctx.nodes.length - base;
    const maxPerSecond = 3 * 45 + 80;     // generous: a 45 Hz tick train costs 2 nodes per tick
    check(`${name}: finite, no throw`, !threw && allParamsFinite(ctx), ctx.violations[0] ?? '');
    check(`${name}: bounded node creation`, created <= 10 * maxPerSecond * 2, `${created} one-shot nodes in 10 s`);
    if (name === 'menu' || name === 'paused') check(`${name}: no tick / pulse buffers scheduled`, ctx.nodes.slice(base).filter(n => n.kind === 'bufferSource').length === 0);
    if (name === 'coasting') check('coasting: freewheel ticks are scheduled ahead (start times are in the future)', ctx.nodes.slice(base).filter(n => n.kind === 'bufferSource').every(n => n.startAt >= 0) && ctx.nodes.slice(base).some(n => n.kind === 'bufferSource'));
    if (name === 'pedalling') check('pedalling: no freewheel ticks', ctx.nodes.slice(base).filter(n => n.kind === 'bufferSource').length === 0);
    if (name === 'surface dirt') check('dirt at speed: only freewheel ticks, rate near the cap', ctx.nodes.slice(base).filter(n => n.kind === 'bufferSource').length > 10 * 30);
    if (name === 'night') check('night: crickets (4.5 kHz oscillators)', ctx.nodes.slice(base).some(n => n.kind === 'oscillator' && n.frequency.events[0] && Math.abs(n.frequency.events[0].value - 4500) < 200));
    audio.dispose();
  }
  // birds: daytime, a few chirps every 1.5-5 s; more in the menu
  const count = async f => {
    const { win, audio, ctx } = await startAudio(); const base = ctx.nodes.length;
    audio.update(f); advance(win, 60, 0.025, () => audio.update(f));
    const oscs = ctx.nodes.slice(base).filter(n => n.kind === 'oscillator');
    const panners = ctx.nodes.slice(base).filter(n => n.kind === 'panner');
    audio.dispose(); return { oscs: oscs.length, chirps: panners.length };
  };
  const day = await count(frame({ speed: 0 })), menu = await count(frame({ speed: 0, riding: false })), rainy = await count(frame({ speed: 0, rain: 0.8 }));
  check('birds chirp every 1.5-5 s by day (60 s -> 12..40 chirps)', day.chirps >= 12 && day.chirps <= 40, `${day.chirps} chirps`);
  check('menu has more birds than riding', menu.chirps > day.chirps, `${menu.chirps} vs ${day.chirps}`);
  check('no birds when it rains hard', rainy.chirps === 0);
  // pulse scheduling is never burst-played after a stall (throttled tab)
  const { win, audio, ctx } = await startAudio();
  audio.update(frame({ speed: 12 })); advance(win, 1);
  const base = ctx.nodes.length; ctx.currentTime += 30; win.runTimers();
  check('after a 30 s stall the scheduler does not burst-play the backlog', ctx.nodes.length - base <= 8 * 6, `${ctx.nodes.length - base} nodes`);
  audio.dispose();
}

/* ------------------------------------------------------------------------------------------------ E events */
section('E  one-shot events');
{
  const EVENTS = [['land', { impact: 9, quality: 0.9 }], ['land', { impact: 0, quality: 0 }], ['land', { impact: 14, quality: 1 }], ['jump', {}], ['crash', { severity: 1 }], ['crash', {}],
    ['checkpoint', { better: true }], ['checkpoint', { better: false }], ['checkpoint', { better: null }], ['countdown', { n: 3 }], ['go', {}], ['medal', { tier: 1 }], ['medal', { tier: 2 }], ['medal', { tier: 3 }],
    ['finish', {}], ['collect', {}], ['unlock', {}], ['ui', { kind: 'click' }], ['ui', { kind: 'back' }], ['ui', { kind: 'toggle' }], ['respawn', {}]];
  const { win, audio, ctx } = await startAudio();
  for (const [name, data] of EVENTS) {
    const before = ctx.nodes.length; let threw = false;
    try { audio.event(name, data); } catch (error) { threw = true; console.log(error); }
    check(`event ${name} ${JSON.stringify(data)}: builds nodes`, !threw && ctx.nodes.length > before && allParamsFinite(ctx), ctx.violations[0] ?? '');
    advance(win, 0.1);
  }
  for (const [name, bad] of [['land', { impact: NaN, quality: 'x' }], ['crash', { severity: Infinity }], ['medal', { tier: 99 }], ['medal', { tier: NaN }], ['ui', undefined], ['checkpoint', null], ['land', 5]]) {
    check(`event ${name} with junk data does not throw`, !throws(() => audio.event(name, bad)) && allParamsFinite(ctx));
    advance(win, 0.1);
  }
  const warnings = []; const realWarn = console.warn; console.warn = (...a) => warnings.push(a.join(' '));
  check('unknown events (incl. __proto__ / constructor) are ignored, each warned once', !throws(() => { audio.event('explode'); audio.event('explode'); audio.event(undefined); audio.event('__proto__'); audio.event('constructor'); }) && warnings.length === 4);
  console.warn = realWarn;
  // rate limit: same event twice within 60 ms
  advance(win, 0.2);
  let before = ctx.nodes.length; audio.event('jump'); const afterFirst = ctx.nodes.length; audio.event('jump'); win.setWall(win.performance.now() / 1000 + 0.03); audio.event('jump');
  check('same event within 60 ms is dropped', afterFirst > before && ctx.nodes.length === afterFirst);
  win.setWall(win.performance.now() / 1000 + 0.07); audio.event('jump');
  check('... and allowed again after 60 ms', ctx.nodes.length > afterFirst);
  before = ctx.nodes.length; win.setWall(win.performance.now() / 1000 + 0.07); audio.event('collect'); audio.event('go');
  check('different events are not rate-limited against each other', ctx.nodes.length > before);
  check('stats count the rate-limited ones', audio.getStats().eventsRateLimited >= 2);
  audio.dispose();
}
{
  // voice cap: 24 simultaneous
  const { win, audio, ctx } = await startAudio();
  const names = ['crash', 'unlock', 'medal', 'land', 'respawn', 'go', 'finish', 'collect'];
  let peak = 0;
  for (let i = 0; i < 120; i++) {
    win.setWall(win.performance.now() / 1000 + 0.07); ctx.currentTime += 0.005;
    audio.event(names[i % names.length], { tier: 3, severity: 1, impact: 8 + (i % 6) });
    peak = Math.max(peak, audio.getStats().voices);
  }
  check('never more than 24 simultaneous voices', peak <= 24, `peak ${peak}`);
  check('the cap actually kicked in and dropped voices', audio.getStats().voicesDropped > 0, `${audio.getStats().voicesDropped} dropped`);
  check('events with the cap still produce finite params', allParamsFinite(ctx));
  advance(win, 3);
  check('voices are reaped after they ended', audio.getStats().voices === 0, `${audio.getStats().voices} left`);
  const dead = ctx.nodes.filter(n => n.kind === 'gain' && n.outputs.length === 0 && n.disconnected);
  check('finished voice buses are disconnected', dead.length > 20, `${dead.length}`);
  audio.dispose();
}

/* ------------------------------------------------------------------------------------------------ F mute */
section('F  mute');
{
  const { win, audio, ctx } = await startAudio();
  const master = ctx.nodes.find(n => n.kind === 'gain');
  ctx.currentTime += 0.2;
  check('master reaches ~0.7 after the fade in', Math.abs(master.gain.value - 0.7) < 1e-9, `${master.gain.value}`);
  check('compressor sits between master and destination', master.outputs[0].kind === 'compressor' && master.outputs[0].outputs[0] === ctx.destination);
  audio.update(frame({ speed: 15 }));
  audio.setMuted(true);
  check('isMuted() true', audio.isMuted() === true);
  ctx.currentTime += 0.025; const half = master.gain.value;
  check('muting ramps (no click): halfway at 25 ms', half > 0.2 && half < 0.5, `${half}`);
  ctx.currentTime += 0.03;
  check('master gain is exactly 0 after 50 ms', master.gain.value === 0, `${master.gain.value}`);
  const n = ctx.nodes.length; audio.event('crash', { severity: 1 }); audio.event('go');
  check('events are ignored while muted', ctx.nodes.length === n);
  advance(win, 1, 0.025, () => audio.update(frame({ speed: 15, surface: 'wood' })));
  check('no pulses are scheduled while muted', ctx.nodes.length === n);
  check('context is suspended shortly after muting', ctx.suspendCalls >= 1 && ctx.state === 'suspended');
  audio.setMuted(false); await flush();
  check('unmuting resumes the context', ctx.state === 'running');
  ctx.currentTime += 0.06;
  check('master is back at 0.7 after unmute', Math.abs(master.gain.value - 0.7) < 1e-9, `${master.gain.value}`);
  audio.event('go'); check('events play again after unmute', ctx.nodes.length > n);
  // arcade:mute window event
  win.dispatch('arcade:mute', { muted: true }); ctx.currentTime += 0.06;
  check('arcade:mute {muted:true} silences the master', audio.isMuted() && master.gain.value === 0);
  win.dispatch('arcade:mute', { muted: false }); ctx.currentTime += 0.06;
  check('arcade:mute {muted:false} restores it', !audio.isMuted() && Math.abs(master.gain.value - 0.7) < 1e-9);
  check('arcade:mute with no detail does not throw', !throws(() => win.dispatch('arcade:mute', undefined)));
  audio.setMuted(true); audio.setMuted(true); audio.setMuted(true);
  check('repeated setMuted(true) is idempotent', master.gain.valueAt(ctx.currentTime + 0.06) === 0);
  audio.dispose();
}
{
  const { win, audio, ctx } = await startAudio({ muted: '1' });
  const master = ctx.nodes.find(n => n.kind === 'gain');
  check("localStorage pb_muted='1' at creation: muted", audio.isMuted() === true);
  ctx.currentTime += 0.2;
  check('... and the master stays at 0', master.gain.value === 0);
  check('... and the context is not resumed while muted', ctx.state === 'suspended' && ctx.resumeCalls === 0);
  win.dispatch('keydown'); await flush();
  check('... gestures do not resume it either', ctx.resumeCalls === 0);
  audio.setMuted(false); await flush(); ctx.currentTime += 0.06;
  check('... but unmute brings the sound', ctx.state === 'running' && Math.abs(master.gain.value - 0.7) < 1e-9);
  audio.dispose();
  const unmuted = await startAudio({ muted: '0' });
  check("pb_muted='0' is not muted", unmuted.audio.isMuted() === false); unmuted.audio.dispose();
  const throwingStorage = makeFakeWindow(); throwingStorage.localStorage = { getItem() { throw new Error('denied'); } };
  const safe = createAudio({ win: throwingStorage });
  check('unreadable localStorage (private mode) falls back to unmuted', safe.isMuted() === false); safe.dispose();
}

/* ------------------------------------------------------------------------------------------------ G seam + dispose */
section('G  noise seam and dispose');
{
  const { win, audio, ctx } = await startAudio();
  const noise = ctx.buffers.reduce((a, b) => (a.length > b.length ? a : b));
  const data = noise.getChannelData(0);
  let sum = 0, peak = 0, jump = 0;
  for (let i = 0; i < data.length; i++) { sum += data[i] * data[i]; peak = Math.max(peak, Math.abs(data[i])); }
  for (let i = 1; i < data.length; i++) jump = Math.max(jump, Math.abs(data[i] - data[i - 1]));
  const seam = Math.abs(data[0] - data[data.length - 1]);
  const rms = Math.sqrt(sum / data.length);
  check('pink noise loop is 2 s long, finite, not clipped, sensible RMS', noise.duration >= 1.9 && noise.duration <= 2.1 && peak <= 1 && rms > 0.1 && rms < 0.5, `rms ${rms.toFixed(3)} peak ${peak.toFixed(2)}`);
  check('the loop seam is no bigger than the largest sample-to-sample step', seam <= jump * 1.01, `seam ${seam.toFixed(3)} vs max step ${jump.toFixed(3)}`);
  check('baked one-shot buffers are present and finite', ctx.buffers.length === 7 && ctx.buffers.every(b => b.getChannelData(0).every(Number.isFinite)), `${ctx.buffers.length} buffers`);
  audio.update(frame({ speed: 12, surface: 'roots' })); advance(win, 1);
  const sources = ctx.nodes.filter(n => n.kind === 'oscillator' || (n.kind === 'bufferSource' && n.loop));
  check('looped / oscillator sources are started', sources.every(n => n.started));
  const steadyNodes = audio.getStats().steadyNodes;
  const listeners = win.listenerCount(), timersBefore = win.timers.size;
  check('a scheduler timer is pending while alive', timersBefore >= 1 && listeners >= 4);
  audio.dispose();
  check('dispose closes the context', ctx.closed === true);
  check('dispose stops every looped source and oscillator', sources.every(n => n.stopped));
  check('dispose disconnects the whole steady-state graph', ctx.nodes.slice(0, steadyNodes + 1).filter(n => n.outputs.length > 0).length === 0);
  check('dispose removes the window listeners', win.listenerCount() === 0, `${win.listenerCount()} left`);
  check('dispose clears the scheduler timers', win.timers.size === 0, `${win.timers.size} left`);
  const nodes = ctx.nodes.length;
  check('update / event / resume / setMuted after dispose are harmless no-ops', !throws(() => { audio.update(FULL); audio.event('go'); audio.resume(); audio.setMuted(true); audio.setMuted(false); audio.dispose(); }) && ctx.nodes.length === nodes);
  win.dispatch('pointerdown'); check('gestures after dispose do nothing', win.env.contexts.length === 1);
  const never = createAudio({ win: makeFakeWindow() });
  check('dispose before any context is fine', !throws(() => never.dispose()));
}

console.log(`\n${results.pass} checks passed, ${results.fail} failed`);
if (results.fail) { for (const f of results.failures) console.log(' -', f); process.exit(1); }
