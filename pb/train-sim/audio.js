/* Zuchsimulator: procedural vehicle audio (v3, redesign). Create only after a user gesture.
 * TS.audio.create(opts?) -> { update, horn, doorChime, doorOpen, doorClose, gong, announce, announceClips, stopClips, brakeSqueal, signalBell, clack, setMuted, master, ctx, resume, dispose, stats }
 * opts.context lets tests pass an OfflineAudioContext. Everything routes through one master gain -> limiter.
 *
 * update(p): speedMs, lever, accelMs2, sound ('diesel'|'electric'|'tram'|'hst'), train (id), camera ('cab'|'inside'|other = outside), curvature, inTunnel, onBridge,
 *            rain (bool|0..1), weather, doorsOpen01, parkingBrake, traction (0..1), timeScale, cars, carLength.
 *
 * Voices (per vehicle, all synthesised, no downloads):
 *  - IGBT inverter traction (Luxtram CAF Urbos, EMU, KISS, IC loco, high-speed): the real mechanism. The motor frequency fm follows the speed; below a
 *    changeover speed the inverter switches at a fixed carrier (asynchronous PWM, with the 2*fm sidebands that make the low-speed "wobble"), above it the
 *    pulse count P is locked to fm (tone = P*fm), and every time the tone would pass the upper limit the inverter drops to the next lower P. That gives
 *    the rising tone with sudden step-downs everybody knows. Plus motor magnetic hum (slot harmonics), gear mesh whine, cooling blowers, 100 Hz transformer
 *    hum on the 25 kV AC vehicles, and an inverter "contactor" thunk when power is first applied.
 *  - Diesel railcar: six-cylinder underfloor engine as a firing-pulse train with body formants, cycle roughness, injector clatter and a 4-speed mechanical gearbox
 *    (rpm saw-tooth, clutch-open drop and clunk at every shift).
 *  - Wheel/rail rolling (grooved rail on the tram, ballast on rail), aero + pantograph wind, flange squeal in curves, brake squeal, pneumatic hiss (apply / release /
 *    emergency), pad rub, final clunk at standstill, parking brake, compressor cycling, HVAC, rain / snow / wipers, tunnel thump, jointed-track and points clatter.
 *  - Perspective: cab / saloon ('inside') / outside change filtering + per-group levels. Announcement bus is ducked against the vehicle when a clip plays. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});

  const MASTER_LEVEL = 0.63;
  const SPEECH_LANG = { lb: ['lb-LU', 'lb', 'de-LU', 'de-DE', 'de'], de: ['de-DE', 'de'], fr: ['fr-FR', 'fr'], en: ['en-GB', 'en-US', 'en'] };
  const MAX_TRANSIENT = 90;       // hard cap on simultaneously alive one-shot nodes groups (hits, hisses): protects slow devices
  const DT_MIN = 0.02;            // update throttle (s)

  /* Vehicle table. igbt: k = motor electrical Hz per m/s, fc = asynchronous carrier, fHigh = highest synchronous tone, Ps = pulse counts (descending). */
  const VEH = {
    tram: { fam: 'igbt', k: 5.8, fc: 1700, fHigh: 2300, Ps: [63, 45, 33, 27, 21], tone: 0.55, hum: 0.8, gearK: 44, gear: 0.55, trafo: 0, fan: 0.55, aux: 'screw', rollK: 1.3, hiss: 0.0, grit: 1.0, joint: 0, wind: 0.5, rcrit: 80, cars: 5, carLen: 9, level: 0.61, beep: 'tram', horn: 'tram', amb: 'city', bogieSpacing: 2.2 },
    emu: { fam: 'igbt', k: 4.6, fc: 1050, fHigh: 1450, Ps: [27, 21, 15, 11, 9, 7], tone: 0.55, hum: 0.8, gearK: 40, gear: 0.5, trafo: 0.9, fan: 0.75, aux: 'piston', rollK: 1.0, hiss: 0.8, grit: 0.4, joint: 0.28, wind: 0.8, rcrit: 330, cars: 2, carLen: 26, level: 0.6, beep: 'pip', horn: 'emu', amb: 'country', bogieSpacing: 2.5 },
    kiss: { fam: 'igbt', k: 4.2, fc: 900, fHigh: 1250, Ps: [21, 15, 11, 9, 7, 5], tone: 0.6, hum: 1.0, gearK: 36, gear: 0.5, trafo: 1.0, fan: 0.85, aux: 'piston', rollK: 1.05, hiss: 0.8, grit: 0.4, joint: 0.22, wind: 0.9, rcrit: 380, cars: 4, carLen: 26, level: 0.5, beep: 'pip', horn: 'kiss', amb: 'country', bogieSpacing: 2.5 },
    ic: { fam: 'igbt', k: 3.3, fc: 750, fHigh: 1050, Ps: [15, 11, 9, 7, 5], tone: 0.62, hum: 1.25, gearK: 30, gear: 0.7, trafo: 1.5, fan: 1.3, aux: 'piston', rollK: 1.15, hiss: 0.9, grit: 0.4, joint: 0.2, wind: 1.0, rcrit: 450, cars: 7, carLen: 25, level: 0.41, beep: 'beep', horn: 'ic', amb: 'country', bogieSpacing: 2.6 },
    hst: { fam: 'igbt', k: 2.5, fc: 820, fHigh: 1100, Ps: [21, 15, 11, 9, 7, 5], tone: 0.42, hum: 0.9, gearK: 26, gear: 0.4, trafo: 1.1, fan: 1.0, aux: 'screw', rollK: 1.1, hiss: 1.2, grit: 0.3, joint: 0.06, wind: 1.7, rcrit: 1500, cars: 8, carLen: 21.5, level: 0.36, beep: 'bing', horn: 'hst', amb: 'country', bogieSpacing: 3.0 },
    railcar: { fam: 'diesel', rollK: 1.0, hiss: 0.6, grit: 0.55, joint: 0.5, wind: 0.6, rcrit: 280, cars: 1, carLen: 22, level: 0.62, aux: 'piston', beep: 'buzz', horn: 'diesel', amb: 'country', bogieSpacing: 2.6 },
  };
  const HORNS = {
    diesel: { f: [311, 392], bright: 0.8, level: 1.0 },
    emu: { f: [392, 494], bright: 1.0, level: 1.0 },
    kiss: { f: [349, 440], bright: 1.0, level: 1.0 },
    ic: { f: [311, 392], bright: 0.9, level: 1.1 },
    hst: { f: [466, 587], bright: 1.15, level: 1.0 },
  };
  /* camera perspectives: per-group level + low-pass of the whole scene */
  const PERSP = {
    outside: { lp: 16000, tract: 0.9, mech: 0.8, roll: 1.0, aero: 1.0, aux: 0.2, eng: 1.0, brk: 1.0, doors: 0.6, announce: 0.5, rain: 1.0 },
    cab: { lp: 4200, tract: 0.55, mech: 0.7, roll: 0.6, aero: 0.45, aux: 0.7, eng: 0.8, brk: 0.7, doors: 0.45, announce: 0.4, rain: 0.9 },
    saloon: { lp: 3300, tract: 0.4, mech: 0.45, roll: 0.7, aero: 0.3, aux: 1.0, eng: 0.55, brk: 0.55, doors: 0.7, announce: 1.0, rain: 0.85 },
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (x) => { const c = clamp(x, 0, 1); return c * c * (3 - 2 * c); };

  function resolveVehicle(p, prev) {
    const id = p.train, snd = p.sound;
    if (snd === 'tram' || id === 'tram') return 'tram';
    if (snd === 'diesel' || id === 'railcar') return 'railcar';
    if (snd === 'hst' || id === 'hst') return 'hst';
    if (id === 'kiss' || id === 'ic' || id === 'emu') return id;
    return snd ? 'emu' : prev || 'emu';
  }

  function create(opts) {
    opts = opts || {};
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!opts.context && !Ctx) { console.warn('[Lokféierer] audio: Web Audio not supported'); return null; }
    const ctx = opts.context || new Ctx();
    const sr = ctx.sampleRate;
    const now = () => ctx.currentTime;
    const warned = {};
    const guard = (name, fn) => function () {
      try { return fn.apply(null, arguments); } catch (e) { if (!warned[name]) { warned[name] = 1; console.warn('[Lokféierer] audio ' + name + ' failed', e); } return undefined; }
    };
    const dbg = { mute: new Set() };   // test hook: solo / mute groups
    const count = { created: 0, live: 0, livePeak: 0, shots: 0, dropped: 0 };

    // ---------------------------------------------------------- node helpers
    const gain = (v) => { const g = ctx.createGain(); g.gain.value = v == null ? 0 : v; count.created++; return g; };
    const filt = (type, f, q) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q != null) n.Q.value = q; count.created++; return n; };
    const osc = (type, f) => { const o = ctx.createOscillator(); if (type) o.type = type; o.frequency.value = f; count.created++; return o; };
    const lastSet = new WeakMap();
    function set(param, v, tc, rel) {
      v = fin(v, 0);
      const l = lastSet.get(param);
      if (l !== undefined && Math.abs(l - v) <= (rel == null ? 0.0015 : rel) * Math.abs(l) + 1e-5) return;
      lastSet.set(param, v);
      param.setTargetAtTime(v, now(), tc == null ? 0.1 : tc);
    }
    function wave(harm) {   // harm: [amp of harmonic 1, 2, 3 ...]
      const re = new Float32Array(harm.length + 1), im = new Float32Array(harm.length + 1);
      for (let i = 0; i < harm.length; i++) im[i + 1] = harm[i];
      return ctx.createPeriodicWave(re, im);
    }
    const harmAt = (n, list, fn) => { const a = new Array(n).fill(0); list.forEach(([h, v]) => { if (h <= n) a[h - 1] = v; }); if (fn) for (let i = 0; i < n; i++) a[i] += fn(i + 1); return a; };

    /* seamless looping noise: the tail is cross-faded into the head */
    function noiseBuffer(kind, seconds, extra) {
      const len = Math.floor(sr * seconds), fade = Math.floor(sr * 0.25), total = len + fade, raw = new Float32Array(total);
      if (kind === 'white') for (let i = 0; i < total; i++) raw[i] = Math.random() * 2 - 1;
      else if (kind === 'pink') {
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < total; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        }
      } else if (kind === 'brown') {
        let last = 0;
        for (let i = 0; i < total; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; raw[i] = last * 3.5; }
      } else if (kind === 'drops') {   // random micro-clicks, density per second in `extra`
        const p = (extra || 120) / sr;
        for (let i = 0; i < total; i++) if (Math.random() < p) { const a = (Math.random() * 2 - 1) * (0.35 + Math.random() * 0.65); raw[i] += a; raw[i + 1] = (raw[i + 1] || 0) - a * 0.6; }
      }
      const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = raw[i];
      for (let i = 0; i < fade; i++) { const w = i / fade; d[i] = raw[i] * Math.sin(w * Math.PI / 2) + raw[len + i] * Math.cos(w * Math.PI / 2); }
      return buf;
    }
    const BUF = { white: noiseBuffer('white', 3), pink: noiseBuffer('pink', 8), brown: noiseBuffer('brown', 6), drops: noiseBuffer('drops', 4, 70), dense: noiseBuffer('drops', 4, 900) };
    const sources = [];
    const keep = (n) => { sources.push(n); return n; };
    function loop(kind) {
      const s = ctx.createBufferSource(); s.buffer = BUF[kind]; s.loop = true; count.created++;
      s.start(0, Math.random() * (BUF[kind].duration - 0.1)); keep(s); return s;
    }

    /* synthesised one-shot sample (damped sinusoids + noise tick) */
    function synthHit(spec) {
      const dur = spec.dur || 0.3, len = Math.floor(sr * dur), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
      (spec.modes || []).forEach((m) => {
        const w = 2 * Math.PI * m.f / sr, ph = Math.random() * 6.28, f2 = m.f2 || m.f;
        let phase = ph;
        for (let i = 0; i < len; i++) { const t = i / sr, f = lerp(m.f, f2, Math.min(1, t / (m.dec * 2))); phase += 2 * Math.PI * f / sr; d[i] += m.amp * Math.sin(phase) * Math.exp(-t / m.dec) * (m.atk ? Math.min(1, t / m.atk) : 1); void w; }
      });
      (spec.noise || []).forEach((nz) => {
        let lp = 0; const a = nz.lp == null ? 1 : nz.lp;
        for (let i = 0; i < len; i++) { const t = i / sr; lp += a * ((Math.random() * 2 - 1) - lp); d[i] += nz.amp * lp * Math.exp(-t / nz.dec); }
      });
      let pk = 0; for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(d[i]));
      const k = pk > 0 ? 0.9 / pk : 1; for (let i = 0; i < len; i++) d[i] *= k;
      const f = Math.min(len, Math.floor(sr * 0.004)); for (let i = 0; i < f; i++) d[len - 1 - i] *= i / f;
      return buf;
    }
    const jit = () => 1 + (Math.random() - 0.5) * 0.12;
    const HITS = {
      dak: [0, 1, 2].map(() => synthHit({ dur: 0.32, modes: [{ f: 1750 * jit(), dec: 0.02, amp: 0.5 }, { f: 640 * jit(), dec: 0.07, amp: 0.55 }, { f: 280 * jit(), dec: 0.1, amp: 0.4 }, { f: 100 * jit(), f2: 62, dec: 0.12, amp: 0.8 }], noise: [{ dec: 0.006, amp: 0.7, lp: 0.7 }] })),
      tok: [0, 1].map(() => synthHit({ dur: 0.3, modes: [{ f: 980 * jit(), dec: 0.025, amp: 0.45 }, { f: 420 * jit(), dec: 0.06, amp: 0.55 }, { f: 120 * jit(), f2: 70, dec: 0.11, amp: 0.8 }], noise: [{ dec: 0.008, amp: 0.5, lp: 0.4 }] })),
      frog: [0, 1].map(() => synthHit({ dur: 0.28, modes: [{ f: 2300 * jit(), dec: 0.015, amp: 0.55 }, { f: 900 * jit(), dec: 0.04, amp: 0.6 }, { f: 150 * jit(), f2: 80, dec: 0.1, amp: 0.7 }], noise: [{ dec: 0.01, amp: 0.9, lp: 0.8 }] })),
      thud: synthHit({ dur: 0.4, modes: [{ f: 78, f2: 40, dec: 0.16, amp: 1 }, { f: 160, f2: 90, dec: 0.08, amp: 0.4 }], noise: [{ dec: 0.03, amp: 0.4, lp: 0.12 }] }),
      clunk: synthHit({ dur: 0.45, modes: [{ f: 62, f2: 36, dec: 0.2, amp: 1 }, { f: 210, dec: 0.05, amp: 0.45 }, { f: 760, dec: 0.025, amp: 0.3 }], noise: [{ dec: 0.012, amp: 0.55, lp: 0.35 }] }),
      latch: synthHit({ dur: 0.2, modes: [{ f: 1450, dec: 0.012, amp: 0.55 }, { f: 3100, dec: 0.008, amp: 0.3 }, { f: 520, dec: 0.03, amp: 0.45 }], noise: [{ dec: 0.004, amp: 0.8, lp: 0.9 }] }),
      contactor: synthHit({ dur: 0.35, modes: [{ f: 420, dec: 0.04, amp: 0.6 }, { f: 90, f2: 60, dec: 0.1, amp: 0.8 }, { f: 1500, dec: 0.01, amp: 0.3 }], noise: [{ dec: 0.005, amp: 0.8, lp: 0.5 }] }),
    };
    /* bells / chimes: modal synthesis. partials: [ratio, amp, decay seconds] */
    function modalBuffer(f0, partials, dur, tick) {
      const len = Math.floor(sr * dur), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
      partials.forEach(([r, a, dec]) => {
        const f = f0 * r; if (f > sr * 0.45) return;
        const w = 2 * Math.PI * f / sr, ph = Math.random() * 6.28;
        for (let i = 0; i < len; i++) d[i] += a * Math.sin(w * i + ph) * Math.exp(-(i / sr) / dec);
      });
      if (tick) { let lp = 0; for (let i = 0; i < Math.floor(sr * 0.012); i++) { lp += 0.8 * ((Math.random() * 2 - 1) - lp); d[i] += tick * lp * Math.exp(-i / (sr * 0.003)); } }
      let pk = 0; for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(d[i]));
      const k = pk > 0 ? 0.9 / pk : 1; for (let i = 0; i < len; i++) d[i] *= k;
      const f = Math.floor(sr * 0.01); for (let i = 0; i < f; i++) d[len - 1 - i] *= i / f;
      return buf;
    }
    const BELL_PARTIALS = [[1, 1, 0.55], [1.0035, 0.55, 0.5], [2.756, 0.55, 0.34], [5.404, 0.28, 0.2], [8.933, 0.14, 0.12], [0.5, 0.18, 0.7]];   // cup-bell inharmonic series
    const BELLS = { tram: [modalBuffer(1020, BELL_PARTIALS, 1.1, 0.5), modalBuffer(1090, BELL_PARTIALS, 1.1, 0.5)], crossing: [modalBuffer(1850, [[1, 1, 0.1], [2.76, 0.4, 0.06], [5.4, 0.18, 0.03]], 0.4, 0.4)], chime: modalBuffer(523.3, [[1, 1, 1.1], [2, 0.32, 0.7], [3, 0.1, 0.4], [4.07, 0.06, 0.25]], 2.6, 0.12) };

    // ---------------------------------------------------------- transient playback
    const queueCap = () => count.live >= MAX_TRANSIENT;
    function track(src, nodes) {
      count.live++; count.shots++; count.livePeak = Math.max(count.livePeak, count.live);
      src.onended = () => { count.live--; nodes.forEach((n) => { try { n.disconnect(); } catch (e) { /* gone */ } }); };
    }
    function play(buf, o) {   // o: t, vol, rate, dest, lp (cutoff)
      if (!buf || queueCap()) { count.dropped++; return; }
      const t = Math.max(o.t == null ? now() : o.t, now()), s = ctx.createBufferSource(), g = gain(o.vol == null ? 1 : o.vol); count.created++;
      s.buffer = buf; s.playbackRate.value = o.rate || 1;
      const nodes = [s, g];
      if (o.lp) { const l = filt('lowpass', o.lp, 0.6); s.connect(l); l.connect(g); nodes.push(l); } else s.connect(g);
      g.connect(o.dest || shotBus); track(s, nodes); s.start(t);
    }
    function burst(o) {   // filtered noise burst with an envelope
      if (queueCap()) { count.dropped++; return; }
      const t = Math.max(o.t == null ? now() : o.t, now()), s = ctx.createBufferSource(); count.created++; s.buffer = BUF[o.kind || 'white']; s.start(t, Math.random() * 1.5);
      const f = filt(o.type || 'bandpass', o.f, o.q == null ? 1 : o.q), g = gain(0);
      if (o.f2) { f.frequency.setValueAtTime(o.f, t); f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.atk || 0.006) + (o.hold || 0) + o.dur); }
      const atk = o.atk == null ? 0.006 : o.atk, hold = o.hold || 0;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.vol, t + atk); if (hold) g.gain.setValueAtTime(o.vol, t + atk + hold);
      g.gain.exponentialRampToValueAtTime(0.0005, t + atk + hold + o.dur);
      s.connect(f); f.connect(g); g.connect(o.dest || shotBus);
      track(s, [s, f, g]); s.stop(t + atk + hold + o.dur + 0.05);
    }
    function tone(o) {   // enveloped oscillator
      if (queueCap()) { count.dropped++; return; }
      const t = Math.max(o.t == null ? now() : o.t, now()), os = osc(o.type || 'sine', o.f), g = gain(0), atk = o.atk == null ? 0.004 : o.atk, hold = o.hold || 0;
      if (o.f2) { os.frequency.setValueAtTime(o.f, t); os.frequency.exponentialRampToValueAtTime(o.f2, t + atk + hold + o.dur); }
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.vol, t + atk);
      if (hold) g.gain.setValueAtTime(o.vol, t + atk + hold);
      g.gain.exponentialRampToValueAtTime(0.0005, t + atk + hold + o.dur);
      const nodes = [os, g]; let head = os;
      if (o.lp) { const l = filt('lowpass', o.lp, 0.6); os.connect(l); head = l; nodes.push(l); }
      head.connect(g); g.connect(o.dest || shotBus); track(os, nodes); os.start(t); os.stop(t + atk + hold + o.dur + 0.05);
    }

    // ---------------------------------------------------------- output chain: groups -> perspective -> scene -> master -> limiter
    const master = gain(0);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -9; limiter.knee.value = 4; limiter.ratio.value = 14; limiter.attack.value = 0.003; limiter.release.value = 0.14;
    const clip = ctx.createWaveShaper();
    (function () { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 1.15) / Math.tanh(1.15); } clip.curve = c; })();
    master.connect(limiter); limiter.connect(clip); clip.connect(ctx.destination);
    let muted = false;
    if (opts.context) master.gain.value = MASTER_LEVEL; else { master.gain.setValueAtTime(0, now()); master.gain.linearRampToValueAtTime(MASTER_LEVEL, now() + 0.4); }

    const duck = gain(1);                  // vehicle level while an announcement plays
    const vehTrim = gain(1);               // per-vehicle loudness calibration
    const sceneIn = gain(1), tunnelGain = gain(1), camLP = filt('lowpass', 16000, 0.5), camBody = filt('lowshelf', 150, 0);
    sceneIn.connect(vehTrim); vehTrim.connect(tunnelGain); tunnelGain.connect(camBody); camBody.connect(camLP); camLP.connect(duck); duck.connect(master);
    const G = {};     // group buses, level set from the perspective table every update
    ['tract', 'mech', 'roll', 'aero', 'aux', 'eng', 'brk', 'amb'].forEach((k) => { G[k] = gain(1); G[k].connect(sceneIn); });
    const wxBus = gain(1), wxFilter = filt('lowpass', 9000, 0.5); wxBus.connect(wxFilter); wxFilter.connect(duck);
    const doorBus = gain(1); doorBus.connect(sceneIn);
    const shotBus = gain(1); shotBus.connect(sceneIn);
    const announceBus = gain(0.9), announceLP = filt('lowpass', 12000, 0.5); announceBus.connect(announceLP); announceLP.connect(master);

    const reverbIn = gain(1), reverbOut = gain(0.8), conv = ctx.createConvolver();
    (function buildImpulse() {
      const secs = 2.2, len = Math.floor(sr * secs), ir = ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch); let lp = 0;
        for (let i = 0; i < len; i++) { const t = i / len, env = Math.pow(1 - t, 3.2), a = 0.9 - 0.8 * t; lp = lp * a + (Math.random() * 2 - 1) * (1 - a); d[i] = lp * env * 3.0; }
      }
      conv.buffer = ir;
    })();
    reverbIn.connect(conv); conv.connect(reverbOut); reverbOut.connect(master);
    const tunnelSend = gain(0); camLP.connect(tunnelSend); tunnelSend.connect(reverbIn);
    const gongSend = gain(0.25); announceBus.connect(gongSend); gongSend.connect(reverbIn);
    const hornSend = gain(0.08); shotBus.connect(hornSend); hornSend.connect(reverbIn);

    /* gated voice: only connected to its group while audible (an unconnected branch costs no CPU) */
    function gated(out, dest) {
      let on = false, quietSince = 0;
      return {
        out, active: () => on,
        level(l, tNow) {
          if (l > 0.004) { quietSince = 0; if (!on) { out.connect(dest); on = true; } } else if (on) { if (!quietSince) quietSince = tNow; else if (tNow - quietSince > 0.8) { try { out.disconnect(); } catch (e) { /* gone */ } on = false; quietSince = 0; } }
        },
        force(v) { if (v && !on) { out.connect(dest); on = true; } else if (!v && on) { try { out.disconnect(); } catch (e) { /* gone */ } on = false; } },
      };
    }

    // ---------------------------------------------------------- rolling (wheel / rail), aero, grit, bridge
    const roll = (function () {
      const out = gain(1);
      const rumLP = filt('lowpass', 100, 0.7), gRum = gain(0), rumSrc = loop('brown'); rumSrc.connect(rumLP); rumLP.connect(gRum); gRum.connect(out);
      const roarBP = filt('bandpass', 450, 0.7), gRoar = gain(0), roarSrc = loop('pink'); roarSrc.connect(roarBP); roarBP.connect(gRoar); gRoar.connect(out);
      const roar2BP = filt('bandpass', 1300, 0.8), gRoar2 = gain(0), roar2Src = loop('pink'); roar2Src.connect(roar2BP); roar2BP.connect(gRoar2); gRoar2.connect(out);
      const hissBP = filt('bandpass', 3200, 0.8), gHiss = gain(0), hissSrc = loop('white'); hissSrc.connect(hissBP); hissBP.connect(gHiss); gHiss.connect(out);
      const gritBP = filt('bandpass', 1100, 0.9), gGrit = gain(0), gritSrc = loop('drops'); gritSrc.connect(gritBP); gritBP.connect(gGrit); gGrit.connect(out);
      const brBP = filt('bandpass', 170, 4), gBr = gain(0), brSrc = loop('brown'); brSrc.connect(brBP); brBP.connect(gBr); gBr.connect(out);
      const flBP = filt('bandpass', 700, 1.4), gFl = gain(0), flSrc = loop('pink'); flSrc.connect(flBP); flBP.connect(gFl); gFl.connect(out);   // flange growl in curves
      return {
        out,
        update(v, o) {
          const vn = clamp(v / 35, 0, 1.5);
          set(gRum.gain, 0.34 * Math.pow(vn, 0.9) * o.rollK, 0.12);
          set(rumLP.frequency, 70 + v * 9, 0.15);
          set(gRoar.gain, 0.5 * o.rollK * Math.pow(clamp(v / 30, 0, 2), 1.4), 0.12);
          set(roarBP.frequency, 330 + v * 12, 0.15);
          set(gRoar2.gain, 0.2 * o.rollK * Math.pow(clamp(v / 40, 0, 2), 1.6), 0.12);
          set(roar2BP.frequency, 900 + v * 16, 0.15);
          set(gHiss.gain, 0.09 * o.hiss * Math.pow(clamp(v / 60, 0, 1.6), 2.2), 0.15);
          set(hissBP.frequency, 2400 + v * 18, 0.2);
          set(gGrit.gain, 0.2 * o.grit * clamp(v / 10, 0, 1) * (0.4 + 0.6 * clamp(v / 25, 0, 1)), 0.15);
          set(gritBP.frequency, 800 + v * 25, 0.2);
          set(gBr.gain, o.bridge ? 0.55 * Math.min(1, v / 14) : 0, 0.25);
          set(gFl.gain, o.flange * 0.35, 0.12); set(flBP.frequency, 520 + o.flange * 300 + v * 6, 0.15);
        },
      };
    })();
    const aeroV = (function () {
      const out = gain(1);
      const bp = filt('bandpass', 600, 0.55), lp = filt('lowpass', 3200, 0.5), g = gain(0), buf = gain(1), src = loop('pink');
      src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(buf); buf.connect(out);
      const bufLfo = keep(osc('sine', 0.35)), bufG = gain(0.18); bufLfo.connect(bufG); bufG.connect(buf.gain); bufLfo.start();   // slow buffeting
      const hp = filt('highpass', 1800, 0.6), gP = gain(0), pSrc = loop('white'); pSrc.connect(hp); hp.connect(gP); gP.connect(out);   // roof / pantograph hiss
      return { out, update(v, wind) { set(g.gain, 0.2 * wind * Math.pow(clamp(v / 90, 0, 1.6), 2.2), 0.2); set(bp.frequency, 350 + v * 9, 0.2); set(gP.gain, 0.05 * wind * Math.pow(clamp(v / 80, 0, 1.6), 2.6), 0.2); } };
    })();
    const rollG = gated(roll.out, G.roll), aeroG = gated(aeroV.out, G.aero);

    // ---------------------------------------------------------- IGBT inverter traction (lazy per vehicle)
    const igbtVoices = {};
    function buildIgbt(key, prof) {
      const out = gain(1), outMech = gain(1);      // out -> tract group, outMech -> mech group (attached only while the vehicle is active)
      const bus = filt('lowpass', 7000, 0.5); bus.connect(out);
      const modes = prof.Ps.map((P) => {
        const h = new Array(P + 2).fill(0); h[P - 3] = 0.52; h[P - 1] = 1; h[P + 1] = 0.52;   // harmonics P-2, P, P+2 of the motor frequency
        const wv = wave(h);
        const a = keep(osc(null, 50)), b = keep(osc(null, 50)); a.setPeriodicWave(wv); b.setPeriodicWave(wv);
        const gb = gain(0.55), g = gain(0); a.connect(g); b.connect(gb); gb.connect(g); g.connect(bus); a.start(); b.start();
        return { P, a, b, g };
      });
      // asynchronous PWM: carrier + 2*fm sidebands
      const c0 = keep(osc('sine', prof.fc)), c1 = keep(osc('sine', prof.fc)), c2 = keep(osc('sine', prof.fc)), c3 = keep(osc('triangle', prof.fc * 0.5));
      const gAsync = gain(0), gc0 = gain(0.8), gc1 = gain(0.5), gc2 = gain(0.5), gc3 = gain(0.18);
      c0.connect(gc0); c1.connect(gc1); c2.connect(gc2); c3.connect(gc3); [gc0, gc1, gc2, gc3].forEach((n) => n.connect(gAsync)); gAsync.connect(bus);
      const jit0 = keep(osc('sine', 3.1)), jitG = gain(prof.fc * 0.012); jit0.connect(jitG); jitG.connect(c0.frequency);   // carrier spreading
      [c0, c1, c2, c3, jit0].forEach((o) => o.start());
      // motor magnetic hum on the electrical frequency (slot harmonics)
      const humO = keep(osc(null, 40)); humO.setPeriodicWave(wave(harmAt(14, [[2, 0.55], [4, 0.3], [6, 0.8], [8, 0.2], [12, 0.35]])));
      const humLP = filt('lowpass', 1500, 0.6), gHum = gain(0); humO.connect(humLP); humLP.connect(gHum); gHum.connect(out); humO.start();
      // gear mesh
      const gm = keep(osc('sine', 200)), gm2 = keep(osc('sine', 400)), gmG = gain(0), gm2G = gain(0.35), gmLP = filt('lowpass', 2600, 0.6);
      gm.connect(gmG); gm2.connect(gm2G); gm2G.connect(gmG); gmG.connect(gmLP); gmLP.connect(outMech); gm.start(); gm2.start();
      // blowers
      const fanBP = filt('bandpass', 300, 0.6), gFan = gain(0), fanSrc = loop('pink'); fanSrc.connect(fanBP); fanBP.connect(gFan); gFan.connect(out);
      const fan2 = filt('bandpass', 900, 1.2), gFan2 = gain(0); fanSrc.connect(fan2); fan2.connect(gFan2); gFan2.connect(out);
      // 100 Hz transformer hum (25 kV 50 Hz vehicles)
      const trO = keep(osc(null, 100)); trO.setPeriodicWave(wave([1, 0.55, 0.75, 0.3, 0.42, 0.18, 0.2, 0.1]));
      const trLP = filt('lowpass', 700, 0.7), gTr = gain(0); trO.connect(trLP); trLP.connect(gTr); gTr.connect(out); trO.start();
      const trWob = keep(osc('sine', 0.21)), trWobG = gain(0.5); trWob.connect(trWobG); trWobG.connect(trO.detune); trWob.start();
      return { out, outMech, bus, modes, c0, c1, c2, c3, gAsync, humO, gHum, gm, gm2, gmG, fanBP, gFan, gFan2, gTr, state: { mode: -2 }, prof, attached: false };
    }
    function attachIgbt(key, vo) {
      Object.keys(igbtVoices).forEach((k) => { const o = igbtVoices[k]; if (k !== key && o.attached) { try { o.out.disconnect(); o.outMech.disconnect(); } catch (e) { /* gone */ } o.attached = false; } });
      if (vo && !vo.attached) { vo.out.connect(G.tract); vo.outMech.connect(G.mech); vo.attached = true; }
    }
    function detachAllIgbt() { attachIgbt(null, null); }
    function igbtUpdate(vo, v, pow, regen) {
      const prof = vo.prof, fm = prof.k * v, tc = 0.03;
      // pick the PWM mode with hysteresis
      let m = vo.state.mode;
      const th = prof.Ps.map((P) => prof.fHigh / P), startSync = prof.fc / prof.Ps[0];
      const want = (f) => { if (f < startSync) return -1; let i = 0; while (i < th.length - 1 && f >= th[i]) i++; return i; };
      const hys = 0.04;
      if (m === -2) m = want(fm);
      else { const up = want(fm * (1 - hys)), dn = want(fm * (1 + hys)); if (up > m) m = up; else if (dn < m) m = dn; }
      vo.state.mode = m;
      const lvl = 0.11 * prof.tone * pow * smooth(v / 0.7);
      vo.modes.forEach((md, i) => { set(md.a.frequency, Math.max(fm, 0.5), tc); set(md.b.frequency, Math.max(fm * 1.0035, 0.5), tc); set(md.g.gain, i === m ? lvl : 0, 0.012, 0.01); });
      const asy = m === -1 ? lvl * 1.15 : 0;
      set(vo.gAsync.gain, asy, 0.012, 0.01);
      set(vo.c0.frequency, prof.fc, 0.05); set(vo.c1.frequency, prof.fc + 2 * fm, tc); set(vo.c2.frequency, Math.max(60, Math.abs(prof.fc - 2 * fm)), tc); set(vo.c3.frequency, prof.fc * 0.5 + fm, tc);
      set(vo.humO.frequency, Math.max(fm, 0.5), tc);
      set(vo.gHum.gain, 0.085 * prof.hum * (0.1 + 0.9 * pow) * smooth(v / 1.5), 0.12);
      const gmf = prof.gearK * v + 20; set(vo.gm.frequency, gmf, 0.05); set(vo.gm2.frequency, gmf * 2.01, 0.05);
      set(vo.gmG.gain, 0.03 * prof.gear * smooth(v / 4) * (0.3 + 0.7 * Math.max(pow, regen * 0.7)), 0.15);
      const fanL = clamp(0.2 + 0.6 * Math.max(pow, regen) + 0.25 * clamp(v / 40, 0, 1), 0, 1);
      set(vo.gFan.gain, 0.07 * prof.fan * fanL, 0.4); set(vo.fanBP.frequency, 240 + 320 * fanL, 0.4);
      set(vo.gFan2.gain, 0.03 * prof.fan * fanL * fanL, 0.4);
      set(vo.gTr.gain, 0.05 * prof.trafo * (0.7 + 0.3 * pow), 0.3);
    }

    // ---------------------------------------------------------- diesel engine + 4-speed gearbox (lazy)
    let diesel = null;
    const GEAR_RPM = [255, 150, 99, 70];   // engine rpm per m/s in each gear (1st..4th)
    function buildDiesel() {
      const out = gain(1);
      const f0 = 30;
      const pulse = keep(osc(null, f0)); pulse.setPeriodicWave(wave(harmAt(36, [], (n) => 1 / Math.pow(n, 1.0))));
      const pulseB = keep(osc(null, f0)); pulseB.setPeriodicWave(wave(harmAt(36, [], (n) => 0.5 / Math.pow(n, 1.2))));
      const sub = keep(osc('sine', f0 / 2));
      const body = filt('lowpass', 600, 0.8), b1 = filt('peaking', 150, 1.2), b2 = filt('peaking', 330, 1.6), b3 = filt('peaking', 90, 1.0);
      b1.gain.value = 8; b2.gain.value = 5; b3.gain.value = 6;
      const gP = gain(0.55), gPB = gain(0.25), gSub = gain(0.5);
      pulse.connect(gP); pulseB.connect(gPB); sub.connect(gSub); gP.connect(body); gPB.connect(body); gSub.connect(body);
      body.connect(b3); b3.connect(b1); b1.connect(b2);
      const rough = gain(0.82), roughLfo = keep(osc('sine', 5)), roughG = gain(0.15), rough2 = keep(osc('sine', 2.5)), rough2G = gain(0.1);
      roughLfo.connect(roughG); roughG.connect(rough.gain); rough2.connect(rough2G); rough2G.connect(rough.gain);
      b2.connect(rough);
      const lope = loop('pink'), lopeLP = filt('lowpass', 5, 0.5), lopeG = gain(0); lope.connect(lopeLP); lopeLP.connect(lopeG); lopeG.gain.value = 22; lopeG.connect(pulse.detune); lopeG.connect(pulseB.detune); // irregular firing
      const clatBP = filt('bandpass', 1800, 0.9), clatAM = gain(0), clatSrc = loop('white'), clatPulse = keep(osc(null, f0)); clatPulse.setPeriodicWave(wave(harmAt(30, [], () => 0.5)));
      clatSrc.connect(clatBP); clatBP.connect(clatAM); clatPulse.connect(clatAM.gain);
      const gClat = gain(0.12), clatLP = filt('lowpass', 3500, 0.5); clatAM.connect(clatLP); clatLP.connect(gClat);
      const gEng = gain(0); rough.connect(gEng); gClat.connect(gEng); gEng.connect(out);
      const exh = filt('lowpass', 200, 0.6), exhSrc = loop('brown'), gExh = gain(0.2); exhSrc.connect(exh); exh.connect(gExh); gExh.connect(out);
      const tw = keep(osc('sine', 300)), twG = gain(0), twLP = filt('lowpass', 1800, 0.6); tw.connect(twLP); twLP.connect(twG); twG.connect(out);
      const radBP = filt('lowpass', 420, 0.5), gRad = gain(0.02), radSrc = loop('pink'); radSrc.connect(radBP); radBP.connect(gRad); gRad.connect(out);
      [pulse, pulseB, sub, roughLfo, rough2, clatPulse, tw].forEach((o) => o.start());
      return { out, pulse, pulseB, sub, body, gEng, gClat, clatBP, twG, tw, roughLfo, rough2, clatPulse, b1, b2, gP, gPB, gExh, exh, st: { rpm: 650, gear: 0, shiftUntil: 0, shiftTarget: 0, throttle: 0 } };
    }
    function dieselUpdate(d, v, throttle, dt, t) {
      const s = d.st, idle = 640;
      // gearbox: automatic up/down shifts, clutch open during a shift (rpm collapses to the new gear's)
      let shifting = t < s.shiftUntil;
      if (!shifting) {
        if (throttle > 0.15 && s.gear < 3 && s.rpm > 1760) { s.gear++; s.shiftUntil = t + 0.55; s.shiftTarget = Math.max(idle + 80, v * GEAR_RPM[s.gear]); shifting = true; play(HITS.clunk, { t, vol: 0.18, rate: 1.1, dest: G.mech }); }
        else if (s.gear > 0 && v * GEAR_RPM[s.gear] < 820) { s.gear--; s.shiftUntil = t + 0.4; s.shiftTarget = Math.min(1900, v * GEAR_RPM[s.gear] + 100); shifting = true; }
      }
      if (v < 0.3 && throttle < 0.05) s.gear = 0;
      const slip = idle + 1050 * throttle * clamp(1 - v / 3.2, 0, 1);
      let target = shifting ? s.shiftTarget : (throttle > 0.05 ? Math.max(idle, v * GEAR_RPM[s.gear], slip) : idle + clamp(v * 6, 0, 120));
      target = clamp(target, idle, 1950);
      const up = target > s.rpm;
      s.rpm += (target - s.rpm) * (1 - Math.exp(-dt / (shifting ? 0.3 : up ? 0.55 : 0.45)));
      const load = shifting ? 0 : throttle * (up || s.rpm < target + 150 ? 1 : 0.6);
      s.throttle = load;
      const fire = (s.rpm / 60) * 3;
      set(d.pulse.frequency, fire, 0.04); set(d.pulseB.frequency, fire, 0.04); set(d.sub.frequency, fire * 0.5, 0.04); set(d.clatPulse.frequency, fire, 0.04);
      set(d.roughLfo.frequency, fire / 3, 0.1); set(d.rough2.frequency, fire / 6, 0.1);
      set(d.body.frequency, 260 + s.rpm * 0.25 + load * 260, 0.1);
      set(d.gEng.gain, 0.45 * (0.12 + 0.09 * load + 0.04 * clamp((s.rpm - idle) / 1300, 0, 1)), 0.12);
      set(d.gClat.gain, 0.12 + 0.55 * load + 0.1 * clamp((s.rpm - idle) / 1300, 0, 1), 0.12);
      set(d.clatBP.frequency, 1400 + s.rpm * 0.6, 0.15);
      set(d.gExh.gain, 0.04 + 0.08 * load, 0.15); set(d.exh.frequency, 140 + load * 160, 0.15);
      set(d.tw.frequency, (s.rpm / 60) * 27, 0.06); set(d.twG.gain, 0.006 * (0.3 + load) * smooth(v / 3), 0.2);
    }

    // ---------------------------------------------------------- squeal (flange + brake)
    const squeal = (function () {
      const out = gain(1), amp = gain(0.5);
      const o1 = keep(osc('sine', 2800)), o2 = keep(osc('sine', 5600)), o3 = keep(osc('sine', 8400)), g1 = gain(0.5), g2 = gain(0.22), g3 = gain(0.1);
      o1.connect(g1); o2.connect(g2); o3.connect(g3); [g1, g2, g3].forEach((g) => g.connect(amp));
      const nz = filt('bandpass', 3300, 14), gN = gain(0.4), nSrc = loop('white'); nSrc.connect(nz); nz.connect(gN); gN.connect(amp);
      const wan = loop('pink'), wanLP = filt('lowpass', 3, 0.5), wanG1 = gain(70), wanG2 = gain(140); wan.connect(wanLP); wanLP.connect(wanG1); wanLP.connect(wanG2); wanG1.connect(o1.frequency); wanG2.connect(o2.frequency);
      const fl = loop('pink'), flLP = filt('lowpass', 12, 0.5), flG = gain(0.45); fl.connect(flLP); flLP.connect(flG); flG.connect(amp.gain);     // stick-slip flutter
      const lp = filt('lowpass', 7500, 0.5), gOut = gain(0); amp.connect(lp); lp.connect(gOut); gOut.connect(out);
      [o1, o2, o3].forEach((o) => o.start());
      return { out, o1, o2, o3, nz, gOut, lp };
    })();
    const squealG = gated(squeal.out, G.brk);
    let manualSqueal = { level: 0, until: 0 };
    const squealState = { stopRoll: 0, stopSqueal: 0, wasMoving: false };

    // ---------------------------------------------------------- aux: HVAC, compressor, ambience (static) + lazy compressor
    const hvac = (function () {
      const out = gain(1), bp = filt('bandpass', 520, 0.45), g = gain(0.034), src = loop('pink'); src.connect(bp); bp.connect(g); g.connect(out);
      const h = keep(osc(null, 118)); h.setPeriodicWave(wave([1, 0.4, 0.15])); const hg = gain(0.012), hl = filt('lowpass', 500, 0.5); h.connect(hl); hl.connect(hg); hg.connect(out); h.start();
      return { out };
    })();
    hvac.out.connect(G.aux);
    const amb = (function () {
      const out = gain(0), lp = filt('lowpass', 800, 0.5), src = loop('pink'), g = gain(1); src.connect(lp); lp.connect(g); g.connect(out);
      const lfo = keep(osc('sine', 0.13)), lg = gain(0.3); lfo.connect(lg); lg.connect(g.gain); lfo.start();
      out.connect(G.amb); return { out, lp };
    })();
    let comp = null;
    function buildComp(style) {
      const out = gain(0);
      if (style === 'piston') {
        const pls = keep(osc(null, 6.5)); pls.setPeriodicWave(wave(harmAt(10, [], (n) => 0.9 / n)));
        const am = gain(0.08), s1 = keep(osc('sine', 92)), s2 = keep(osc('triangle', 184)), gA = gain(0.5), gB = gain(0.18), nBP = filt('bandpass', 620, 0.8), nSrc = loop('pink'), gNz = gain(0.35);
        pls.connect(am.gain); s1.connect(gA); s2.connect(gB); gA.connect(am); gB.connect(am); nSrc.connect(nBP); nBP.connect(gNz); gNz.connect(am); am.connect(out);
        [pls, s1, s2].forEach((o) => o.start()); return { out, style, pls, s1, s2 };
      }
      const s1 = keep(osc('sawtooth', 160)), lp = filt('lowpass', 900, 0.8), s2 = keep(osc('sine', 320)), nBP = filt('bandpass', 1400, 0.9), nSrc = loop('pink'), gN = gain(0.25), g2 = gain(0.3);
      s1.connect(lp); s2.connect(g2); g2.connect(lp); nSrc.connect(nBP); nBP.connect(gN); lp.connect(out); gN.connect(out);
      s1.start(); s2.start(); return { out, style, s1, s2, lp };
    }
    const compState = { on: false, until: 0, next: -1, started: 0 };

    // ---------------------------------------------------------- rain, snow, wipers
    const wx = (function () {
      const out = gain(1);
      const hp = filt('highpass', 1600, 0.5), bp = filt('bandpass', 4200, 0.4), gH = gain(0.55), src = loop('pink'); src.connect(hp); hp.connect(bp); bp.connect(gH); gH.connect(out);
      const dBP = filt('bandpass', 2600, 1.0), gD = gain(0.9), dSrc = loop('drops'); dSrc.connect(dBP); dBP.connect(gD); gD.connect(out);
      const rBP = filt('bandpass', 750, 0.8), gR = gain(0.5), rSrc = loop('dense'); rSrc.connect(rBP); rBP.connect(gR); gR.connect(out);   // roof drumming
      return { out, bp, gH, gD, gR, dBP, rBP };
    })();
    const wxG = gated(wx.out, wxBus);
    let nextWipe = 0, wipeDir = 1;

    // ---------------------------------------------------------- state
    let kindKey = 'emu', hornVoice = null, bellHeld = false, bellNext = 0, bellVariant = 0, crossUntil = 0, crossLevel = 1, crossNext = 0, crossFlip = 0, disposed = false;
    let lastUpdate = 0, lastLever = 0, lastSpeed = 0, lastTrac = 0, lastPark = null, lastTunnel = false, tunnelStamp = 0, joint = { acc: 0, next: 0, nextPoints: 800, pending: [] };
    let curP = { lever: 0, speed: 0 }, perspNow = 'outside', persp = Object.assign({}, PERSP.outside), brakeHissAt = 0, parkAt = 0, lastBrakePct = 0, stopAt = 0, wasBraking = false;

    // ---------------------------------------------------------- hits on the track (joints, points, bridges)
    function axleOffsets(prof, v, cars, carLen) {
      const out = [], spacing = prof.bogieSpacing, n = Math.max(1, Math.min(10, cars));
      for (let c = 0; c < n; c++) { out.push(c * carLen + carLen * 0.17); out.push(c * carLen + carLen * 0.83); }
      const pairs = v < 22;   // two axles per bogie are audibly separate at low speed, one thump at speed
      const res = [];
      out.forEach((d) => { res.push(d); if (pairs) res.push(d + spacing); });
      return res;
    }
    function queueJointPassage(prof, v, vol, kind, cars, carLen) {
      const offs = axleOffsets(prof, Math.max(v, 3), cars, carLen), base = now() + 0.005;
      offs.forEach((d, i) => { if (joint.pending.length < 80) joint.pending.push({ t: base + d / Math.max(v, 3), vol: vol * (1 - 0.35 * (i / offs.length)), kind }); });
    }
    function flushHits(t) {
      if (!joint.pending.length) return;
      const keepP = [];
      joint.pending.forEach((h) => {
        if (h.t <= t + 0.04) {
          const pool = HITS[h.kind] || HITS.dak, buf = Array.isArray(pool) ? pool[Math.floor(Math.random() * pool.length)] : pool;
          play(buf, { t: h.t, vol: h.vol * 0.55, rate: 0.9 + Math.random() * 0.2, dest: G.roll });
        } else if (h.t < t + 12) keepP.push(h);
      });
      joint.pending = keepP;
    }

    // ---------------------------------------------------------- compressor + wipers + bell scheduler (audio-time, no timers)
    function tick(t, v, o) {
      flushHits(t);
      // tram bell held: ding-ding at ~3.6 Hz
      if (bellHeld) {
        while (bellNext < t + 0.06) {
          const pool = BELLS.tram; play(pool[bellVariant++ % pool.length], { t: Math.max(bellNext, t), vol: 0.34, rate: 0.985 + Math.random() * 0.03, dest: shotBus });
          bellNext += 0.27;
        }
      }
      // level crossing bell
      if (t < crossUntil) {
        while (crossNext < t + 0.06) { play(BELLS.crossing[0], { t: Math.max(crossNext, t), vol: 0.3 * crossLevel, rate: (crossFlip ^= 1) ? 1 : 0.84, dest: shotBus }); crossNext += 0.33; }
      }
      // compressor cycling
      const prof = VEH[kindKey];
      if (compState.next < 0) compState.next = t + rnd(5, 14);
      if (!compState.on && t >= compState.next) {
        compState.on = true; compState.started = t; compState.until = t + rnd(11, 24);
        if (!comp || comp.style !== prof.aux) { if (comp) { try { comp.out.disconnect(); } catch (e) { /* none */ } } comp = buildComp(prof.aux); }
        comp.out.connect(G.aux); comp.out.gain.cancelScheduledValues(t); comp.out.gain.setValueAtTime(0, t); comp.out.gain.linearRampToValueAtTime(prof.aux === 'piston' ? 0.13 : 0.1, t + 1.1);
        if (comp.pls) { comp.pls.frequency.setValueAtTime(2.2, t); comp.pls.frequency.linearRampToValueAtTime(6.5, t + 1.2); }
        if (comp.s1 && comp.style === 'screw') { comp.s1.frequency.setValueAtTime(60, t); comp.s1.frequency.exponentialRampToValueAtTime(160, t + 1.2); }
      } else if (!compState.on && compState.detachAt && t >= compState.detachAt) { compState.detachAt = 0; try { comp.out.disconnect(); } catch (e) { /* gone */ } }
      else if (compState.on && t >= compState.until) {
        compState.on = false; compState.next = t + rnd(40, 110);
        comp.out.gain.cancelScheduledValues(t); comp.out.gain.setValueAtTime(comp.out.gain.value, t); comp.out.gain.linearRampToValueAtTime(0, t + 0.5);
        compState.detachAt = t + 1.2;
        burst({ t: t + 0.3, f: 3600, q: 0.7, vol: 0.1, atk: 0.01, hold: 0.25, dur: 0.7, dest: G.aux });   // unloader / air dryer blow-off
      }
      // wipers (cab view, rain or snow)
      if (o.wipers && t >= nextWipe) {
        wipeDir *= -1; nextWipe = t + 1.5 + Math.random() * 0.1;
        burst({ t, f: 1500, f2: 900, q: 0.8, vol: 0.05, atk: 0.04, hold: 0.12, dur: 0.18, dest: wxBus });
        play(HITS.thud, { t: t + 0.32, vol: 0.05, rate: 2.2, dest: wxBus });
      }
    }

    // ---------------------------------------------------------- brake / parking / stop sounds
    function brakeHiss(t, dur, vol, f) { burst({ t, f: f || 3800, q: 0.55, vol, atk: 0.012, dur, hold: dur * 0.3, dest: G.brk }); burst({ t: t + 0.01, f: (f || 3800) * 0.38, q: 0.6, vol: vol * 0.55, atk: 0.02, dur: dur * 0.9, hold: dur * 0.2, dest: G.brk }); }
    function parkApply(t, big) { brakeHiss(t, big ? 1.05 : 0.7, 0.14, 3000); play(HITS.clunk, { t: t + 0.08, vol: 0.34, rate: 0.9, dest: G.brk }); }
    function parkRelease(t) { brakeHiss(t, 0.55, 0.12, 4200); play(HITS.latch, { t: t + 0.04, vol: 0.2, rate: 0.7, dest: G.brk }); play(HITS.thud, { t: t + 0.1, vol: 0.18, rate: 1.2, dest: G.brk }); }

    // ---------------------------------------------------------- update (per frame)
    const update = guard('update', function (p) {
      if (disposed) return;
      p = p || {};
      const t = now(), dtRaw = lastUpdate ? t - lastUpdate : 0.016;
      if (lastUpdate && dtRaw < DT_MIN) return;
      const dt = clamp(dtRaw, 0.001, 0.25); lastUpdate = t;
      const v = Math.max(0, fin(p.speedMs, 0)), lever = fin(p.lever, 0), ts = clamp(fin(p.timeScale, 1), 1, 2.5);
      kindKey = resolveVehicle(p, kindKey);
      const prof = VEH[kindKey], vEff = v * ts;
      const camera = p.camera === 'cab' ? 'cab' : p.camera === 'inside' ? 'saloon' : 'outside'; perspNow = camera;
      const tunnel = !!p.inTunnel, bridge = !!p.onBridge, doors = clamp(fin(p.doorsOpen01, 0), 0, 1);
      const weather = p.weather || (p.rain ? 'rain' : 'clear');
      const target = PERSP[camera];
      // perspective: smooth the table
      Object.keys(target).forEach((k) => { persp[k] = lerp(persp[k], target[k], 1 - Math.exp(-dt / 0.15)); });
      // open doors let the outside in (saloon strongly, cab a little)
      const leak = camera === 'saloon' ? doors : camera === 'cab' ? doors * 0.3 : 0;
      const pr = (k) => lerp(persp[k], PERSP.outside[k], leak * 0.6);
      const snow = weather === 'snow', fog = weather === 'fog';
      const wxMuff = snow ? 0.6 : fog ? 0.8 : 1;
      set(camLP.frequency, Math.min(persp.lp * (leak > 0 ? 1 + leak * 1.2 : 1), 16000) * wxMuff, 0.15, 0.01);
      set(camBody.gain, camera === 'outside' ? 0 : 2.5, 0.2);
      set(tunnelGain.gain, tunnel ? 1.3 : 1, 0.35); set(tunnelSend.gain, tunnel ? 0.42 : 0, 0.4);
      set(vehTrim.gain, prof.level, 0.3);
      const gv = { tract: pr('tract'), mech: pr('mech'), roll: pr('roll') * (snow ? 0.75 : 1), aero: pr('aero'), aux: pr('aux'), eng: pr('eng'), brk: pr('brk'), amb: 1 };
      Object.keys(gv).forEach((k) => set(G[k].gain, dbg.mute.has(k) ? 0 : gv[k], 0.1));
      set(doorBus.gain, dbg.mute.has('doors') ? 0 : persp.doors, 0.1); set(shotBus.gain, dbg.mute.has('shots') ? 0 : 1, 0.1);
      set(announceBus.gain, 0.9 * persp.announce, 0.15); set(announceLP.frequency, camera === 'outside' ? 5200 : camera === 'cab' ? 3600 : 12000, 0.2);

      // ----- demands
      const tracFrac = p.traction != null ? clamp(fin(p.traction, 0), 0, 1) : (lever > 0 ? clamp(lever / 5, 0, 1) : 0);
      const parked = !!p.parkingBrake;
      const powTraction = tracFrac > 0.02 ? 0.4 + 0.6 * tracFrac : 0;
      const regenFade = lever < 0 ? smooth((v - (kindKey === 'tram' ? 1.2 : 2.2)) / (kindKey === 'tram' ? 2.0 : 3.5)) : 0;
      const regen = lever < 0 ? Math.min(1, -lever / 3) * (lever <= -8 ? 0.35 : 1) * regenFade : 0;
      const pow = Math.max(powTraction, regen * 0.85, 0.03 * smooth(v / 2));
      const eTraction = prof.fam === 'igbt';
      const flangeRaw = clamp((prof.rcrit * Math.abs(fin(p.curvature, 0)) - 0.6) / 1.6, 0, 1);
      const flange = flangeRaw * clamp(v / 4, 0, 1) * (v > 22 ? 0.6 : 1);

      // rolling + aero
      rollG.level(1, t); aeroG.level(1, t);
      roll.update(vEff, { rollK: prof.rollK * (tunnel ? 1.15 : 1), hiss: prof.hiss, grit: prof.grit, bridge, flange });
      aeroV.update(vEff, prof.wind * (tunnel ? 1.5 : 1));
      // traction
      if (eTraction) {
        const vo = igbtVoices[kindKey] || (igbtVoices[kindKey] = buildIgbt(kindKey, prof));
        attachIgbt(kindKey, vo);
        igbtUpdate(vo, v, pow, regen);
        if (diesel && diesel.out) diesel.gate.force(false);
      }
      if (!eTraction) {
        if (!diesel) { diesel = buildDiesel(); diesel.gate = gated(diesel.out, G.eng); }
        detachAllIgbt(); diesel.gate.force(true);
        dieselUpdate(diesel, v, tracFrac > 0.02 ? 0.35 + 0.65 * tracFrac : 0, dt, t);
      }
      // contactor thunk when power comes on from standstill (electric)
      if (eTraction && tracFrac > 0.06 && lastTrac <= 0.06 && v < 0.6) { play(HITS.contactor, { t, vol: 0.3, dest: G.tract }); }
      lastTrac = tracFrac;

      // ----- brake system
      const brakeLevel = p.brakePct != null ? clamp(fin(p.brakePct, 0), 0, 1) : (lever < 0 ? clamp(-lever / 8, 0, 1) : 0);
      if (lever < lastLever && lever < 0 && t - brakeHissAt > 0.2) { const steps = Math.min(4, lastLever - lever); brakeHissAt = t; brakeHiss(t, 0.1 + 0.07 * steps, 0.07 + 0.03 * steps, 4200); }
      if (lever > lastLever && lastLever < 0 && t - brakeHissAt > 0.2) { const sev = Math.min(1, (-lastLever) / 5); brakeHissAt = t; brakeHiss(t, 0.5 + 1.1 * sev * (0.5 + 0.5 * Math.min(1, lastBrakePct * 3 + 0.2)), 0.05 + 0.08 * sev, 3200); }
      lastLever = lever; lastBrakePct = brakeLevel;
      if (lastPark !== null && parked && !lastPark) parkApply(t, v < 0.1);
      else if (lastPark !== null && !parked && lastPark) parkRelease(t);
      lastPark = parked;
      // standstill clunk: the last jerk of the friction brake
      const moving = v > 0.4;
      if (squealState.wasMoving && v < 0.06 && (lever < 0 || brakeLevel > 0.05) && t - stopAt > 1.5) { stopAt = t; play(HITS.clunk, { t, vol: kindKey === 'tram' ? 0.4 : 0.3, rate: kindKey === 'tram' ? 1 : 0.8, dest: G.brk }); brakeHiss(t + 0.12, 0.45, 0.07, 3600); }
      // brake squeal: some stops only. chosen at the start of each brake application
      if (!moving && v < 0.06) squealState.stopRoll = 0;
      if (lever < 0 && v > 2.4 && !squealState.stopRoll) { squealState.stopRoll = 1; squealState.stopSqueal = Math.random() < 0.5 ? rnd(0.35, 1) : 0; }
      squealState.wasMoving = v > 0.3 || (squealState.wasMoving && v > 0.06);
      const lowSpeed = clamp(v / 0.5, 0, 1) * (1 - clamp((v - 1.2) / 1.8, 0, 1));
      const brakeSq = lever < 0 && v > 0.12 && v < 3.0 ? lowSpeed * Math.min(1, -lever / 3) * squealState.stopSqueal * 0.55 : 0;
      const man = t < manualSqueal.until ? manualSqueal.level : 0;
      const flangeSq = flange * (kindKey === 'tram' ? 0.5 : 0.35);
      const sqLevel = Math.max(brakeSq, flangeSq, man);
      const brakePitch = 1900 + 1500 * clamp(v / 2.6, 0, 1), flangePitch = (kindKey === 'tram' ? 2900 : 2400) + 500 * clamp(Math.abs(fin(p.curvature, 0)) * prof.rcrit, 0, 2);
      const sqF = brakeSq >= flangeSq ? brakePitch : flangePitch;
      squealG.level(sqLevel, t);
      if (squealG.active()) { set(squeal.o1.frequency, sqF, 0.08); set(squeal.o2.frequency, sqF * 2.01, 0.08); set(squeal.o3.frequency, sqF * 3.02, 0.08); set(squeal.nz.frequency, sqF * 1.2, 0.08); set(squeal.gOut.gain, sqLevel * 0.2, 0.07); set(squeal.lp.frequency, kindKey === 'tram' ? 8200 : 6200, 0.2); }
      // pad rub (low speed, braking)
      // (modelled inside the squeal bus' noise; plain hiss events above carry the pneumatics)

      // ----- tunnel pressure thump
      if (tunnel !== lastTunnel && vEff > 4 && t - tunnelStamp > 1) { tunnelStamp = t; const k = clamp(vEff / 30, 0.2, 1.3); burst({ t, kind: 'brown', type: 'lowpass', f: 90, q: 0.5, vol: 0.5 * k, atk: 0.04, hold: 0.1, dur: 0.6, dest: shotBus }); burst({ t, f: 700, f2: 300, q: 0.5, vol: 0.12 * k, atk: 0.06, dur: 0.7, dest: shotBus }); }
      lastTunnel = tunnel;

      // ----- track hits: joints (rare, welded), tram street crossings / rail points
      const cars = Math.max(1, Math.round(fin(p.cars, prof.cars))), carLen = fin(p.carLength, prof.carLen);
      if (vEff > 1.2) {
        const railLen = kindKey === 'hst' ? 140 : 25;
        joint.acc += vEff * dt;
        if (prof.joint > 0 || bridge) {
          if (joint.acc >= railLen && t >= joint.next && !(prof.joint > 0 && bridge === false && prof.joint < 0.01)) {
            joint.acc %= railLen;
            const jl = (bridge ? Math.max(prof.joint, 0.3) * 1.5 : prof.joint) * (0.3 + 0.7 * clamp(vEff / 28, 0, 1));
            if (jl > 0.03) { queueJointPassage(prof, vEff, jl, kindKey === 'tram' ? 'tok' : 'dak', cars, carLen); joint.next = t + 0.12; }
          }
        } else joint.acc = 0;
        joint.nextPoints -= vEff * dt;
        if (joint.nextPoints <= 0) {
          joint.nextPoints = kindKey === 'tram' ? rnd(160, 420) : rnd(500, 1500);
          const pl = (kindKey === 'tram' ? 0.45 : 0.6) * clamp(vEff / 14, 0.4, 1);
          queueJointPassage(prof, vEff, pl, 'frog', cars, carLen);
        }
      } else joint.acc = 0;

      // ----- rain / snow
      const rainK = tunnel ? 0 : p.rain === true ? 1 : clamp(fin(Number(p.rain), 0), 0, 1) * 1;
      const snowK = !tunnel && snow ? 0.35 : 0;
      const wxLevel = Math.max(rainK, 0);
      wxG.level(wxLevel + snowK, t);
      set(wxBus.gain, (wxLevel * (camera === 'outside' ? 0.12 : camera === 'cab' ? 0.2 : 0.17) + snowK * 0.05) * persp.rain, 0.4);
      set(wxFilter.frequency, camera === 'outside' ? 9000 : 3200, 0.3);
      set(wx.bp.frequency, camera === 'outside' ? 4200 : 1700, 0.3); set(wx.gH.gain, camera === 'outside' ? 0.65 : 0.3, 0.3); set(wx.gD.gain, camera === 'outside' ? 0.7 : 1.1, 0.3); set(wx.gR.gain, camera === 'outside' ? 0.15 : 0.9, 0.3);
      const wipers = camera === 'cab' && !tunnel && (weather === 'rain' || weather === 'snow' || rainK > 0.3);
      // ambience: street / countryside + station murmur with open doors
      const ambLvl = (prof.amb === 'city' ? 0.04 : 0.012) * (camera === 'outside' ? 1 : 0.5) + 0.06 * doors * (camera === 'cab' ? 0.4 : 1);
      set(amb.out.gain, tunnel ? 0 : ambLvl * (v < 1 ? 1.2 : 0.6), 0.5);

      // ----- aux
      tick(t, vEff, { wipers });
      lastSpeed = v;
    });

    // ---------------------------------------------------------- horn / bell
    function startHorn() {
      const t = now(); let v = lastSpeed;
      if (kindKey === 'tram') {
        if (v < 8.5) { bellHeld = true; bellNext = t; hornVoice = { stop() { bellHeld = false; } }; return; }
        // electronic two-tone warning horn at speed
        const out = gain(0), lp = filt('lowpass', 2600, 0.7), nodes = [out, lp], oscs = [];
        [660, 880].forEach((f) => { const o = osc(null, f); o.setPeriodicWave(wave([1, 0.35, 0.5, 0.15, 0.25, 0.08, 0.12])); o.frequency.setValueAtTime(f * 0.97, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05); const g = gain(0.5); o.connect(g); g.connect(lp); o.start(t); oscs.push(o); nodes.push(g); });
        lp.connect(out); out.connect(shotBus); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.2, t + 0.04);
        hornVoice = { stop() { const e = now(); out.gain.cancelScheduledValues(e); out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), e); out.gain.exponentialRampToValueAtTime(0.0002, e + 0.15); oscs.forEach((o) => { try { o.stop(e + 0.2); } catch (x) { /* gone */ } }); oscs[0].onended = () => nodes.forEach((n) => { try { n.disconnect(); } catch (x) { /* gone */ } }); } };
        return;
      }
      const set1 = HORNS[VEH[kindKey].horn] || HORNS.emu, out = gain(0), lp = filt('lowpass', 2300 * set1.bright, 0.6), form = filt('peaking', 1150, 1.1), br = filt('bandpass', 2400, 1.5), gbr = gain(0.04), nSrc = ctx.createBufferSource();
      form.gain.value = 5; const nodes = [out, lp, form, br, gbr, nSrc], oscs = [];
      nSrc.buffer = BUF.white; nSrc.loop = true; count.created++; nSrc.connect(br); br.connect(gbr); gbr.connect(out); nSrc.start(t, Math.random());
      const hw = wave([1, 0.62, 0.85, 0.4, 0.5, 0.26, 0.3, 0.16, 0.18, 0.1, 0.1, 0.06]);
      set1.f.forEach((f, ni) => {
        [1, 1.0042].forEach((det, i) => {
          const o = osc(null, f); o.setPeriodicWave(hw); o.frequency.setValueAtTime(f * 0.955, t); o.frequency.exponentialRampToValueAtTime(f * det, t + 0.09);
          const g = gain(ni ? 0.36 : 0.42); if (i) g.gain.value *= 0.55; o.connect(g); g.connect(lp); g.connect(form); o.start(t); oscs.push(o); nodes.push(g);
        });
      });
      const vib = osc('sine', 5.2), vibG = gain(3); vib.connect(vibG); oscs.forEach((o) => vibG.connect(o.detune)); vib.start(t); oscs.push(vib); nodes.push(vib, vibG);   // 3 cents of vibrato
      form.connect(out); lp.connect(out); out.connect(shotBus);
      out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.17 * set1.level, t + 0.07);
      hornVoice = { stop() { const e = now(); out.gain.cancelScheduledValues(e); out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), e); out.gain.exponentialRampToValueAtTime(0.0002, e + 0.22); oscs.forEach((o) => { try { if (o.type !== 'sine' || o.frequency.value > 30) o.frequency.setTargetAtTime(o.frequency.value * 0.985, e, 0.06); o.stop(e + 0.26); } catch (x) { /* gone */ } }); try { nSrc.stop(e + 0.26); } catch (x) { /* gone */ } oscs[0].onended = () => nodes.forEach((n) => { try { n.disconnect(); } catch (x) { /* gone */ } }); } };
    }
    const horn = guard('horn', function (down) {
      if (down) { if (hornVoice) return; startHorn(); } else if (hornVoice) { hornVoice.stop(); hornVoice = null; }
    });
    const signalBell = guard('signalBell', function (seconds, level) {
      const t = now();
      if (level != null) crossLevel = clamp(fin(level, 1), 0, 1);
      crossUntil = Math.max(crossUntil, t + (seconds > 0 ? seconds : 1.2));
      if (crossNext < t) crossNext = t;
    });
    const clack = guard('clack', function (vol) { queueJointPassage(VEH[kindKey], 20, vol == null ? 0.8 : vol, 'dak', VEH[kindKey].cars, VEH[kindKey].carLen); });

    // ---------------------------------------------------------- doors
    const BEEPS = {
      tram: { f: 2450, n: 8, gaps: [0.34, 0.31, 0.28, 0.25, 0.22, 0.19, 0.17], hold: 0.07, vol: 0.2, h2: 0.25 },
      pip: { f: 1318, n: 6, pairs: [1.0, 0.794], gap: 0.3, hold: 0.12, vol: 0.2, h2: 0.12 },
      beep: { f: 1900, n: 9, gap: 0.2, hold: 0.09, vol: 0.19, h2: 0.2 },
      bing: { f: 880, n: 3, pairs: [1, 1.26, 1.5], gap: 0.45, hold: 0.25, vol: 0.2, h2: 0.08, soft: true },
      buzz: { f: 880, n: 3, gap: 0.5, hold: 0.28, vol: 0.12, h2: 0.0, saw: true },
    };
    const doorChime = guard('doorChime', function () {
      const t = now(), b = BEEPS[VEH[kindKey].beep] || BEEPS.beep; let s = t;
      for (let i = 0; i < b.n; i++) {
        const f = b.f * (b.pairs ? b.pairs[i % b.pairs.length] : 1);
        tone({ t: s, f, f2: b.saw ? undefined : f * 1.012, vol: b.vol, hold: b.hold, dur: b.soft ? 0.3 : 0.035, atk: b.soft ? 0.01 : 0.006, type: b.saw ? 'sawtooth' : 'sine', lp: b.saw ? 1800 : undefined, dest: doorBus });
        if (b.h2) tone({ t: s, f: f * 2, vol: b.vol * b.h2, hold: b.hold * 0.8, dur: 0.03, atk: 0.006, dest: doorBus });
        s += b.gaps ? b.gaps[Math.min(i, b.gaps.length - 1)] : b.gap;
      }
    });
    function slide(t, open, tram, dur) {
      const dir = open ? 1 : -1;
      burst({ t: t + 0.05, kind: 'pink', f: open ? 700 : 1700, f2: open ? 1700 : 700, q: 0.55, vol: tram ? 0.1 : 0.13, atk: 0.2, hold: dur - 0.5, dur: 0.3, dest: doorBus });
      tone({ t: t + 0.08, f: (tram ? 430 : 230) * (open ? 1 : 1.5), f2: (tram ? 430 : 230) * (open ? 1.5 : 1), type: 'sawtooth', vol: tram ? 0.05 : 0.035, atk: 0.25, hold: dur - 0.6, dur: 0.25, lp: tram ? 1400 : 700, dest: doorBus });
      void dir;
    }
    const doorOpen = guard('doorOpen', function () {
      const t = now(), tram = kindKey === 'tram', pneu = !tram;
      play(HITS.latch, { t, vol: 0.34, rate: 0.9, dest: doorBus });
      if (pneu) burst({ t: t + 0.02, f: 3500, q: 0.5, vol: 0.15, atk: 0.01, hold: 0.12, dur: 0.35, dest: doorBus });
      slide(t + 0.15, true, tram, 1.7);
      play(HITS.thud, { t: t + 1.95, vol: 0.4, rate: 1.1, dest: doorBus }); play(HITS.latch, { t: t + 1.97, vol: 0.14, rate: 0.7, dest: doorBus });
    });
    const doorClose = guard('doorClose', function () {
      const t = now(), tram = kindKey === 'tram';
      slide(t + 0.05, false, tram, 1.7);
      play(HITS.thud, { t: t + 1.78, vol: 0.45, rate: 0.95, dest: doorBus }); play(HITS.latch, { t: t + 1.8, vol: 0.3, rate: 1, dest: doorBus });
      if (!tram) burst({ t: t + 1.85, f: 3200, q: 0.8, vol: 0.1, atk: 0.005, hold: 0.04, dur: 0.22, dest: doorBus });
      tone({ t: t + 1.9, f: tram ? 190 : 140, f2: 90, vol: 0.12, dur: 0.12, dest: doorBus });
    });

    // ---------------------------------------------------------- gong + speech
    const gong = guard('gong', function () {
      const t = now(), rates = [1.5, 1.2599, 1];
      rates.forEach((r, i) => play(BELLS.chime, { t: t + i * 0.55, vol: 0.34, rate: r, dest: announceBus }));
    });
    const announce = function (text, lang) {
      try {
        if (muted || !text || typeof window === 'undefined' || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') return;
        const synth = window.speechSynthesis, wanted = SPEECH_LANG[lang] || SPEECH_LANG.en, voices = synth.getVoices ? synth.getVoices() : [];
        const u = new window.SpeechSynthesisUtterance(String(text));
        let chosen = null, chosenLang = '';
        for (const code of wanted) {
          const hit = voices.find((vo) => vo.lang && vo.lang.toLowerCase().replace('_', '-').startsWith(code.toLowerCase()));
          if (hit) { chosen = hit; chosenLang = hit.lang; break; }
        }
        u.lang = chosen ? chosenLang : (lang === 'lb' ? 'de-DE' : wanted[0]);
        if (chosen) u.voice = chosen;
        u.rate = 0.95; u.pitch = 1; u.volume = 0.9;
        synth.cancel(); synth.speak(u);
      } catch (e) { console.warn('[Lokféierer] audio announce failed', e); }
    };

    /* Pre-rendered announcements (data/luxtram/voice, made by scripts/gen_luxtram_voice.py): decoded once, played through the PA chain
     * (band-limited, lightly compressed + saturated like a tram loudspeaker) into the announcement bus; the vehicle sound is ducked while a clip plays.
     * announceClips(urls, fallbackText, lang, delayS): resolves true when the clips play; when one is missing or cannot be decoded it speaks the fallback text instead. */
    const clipCache = new Map();
    const paIn = gain(1), paHP = filt('highpass', 280, 0.7), paLP = filt('lowpass', 4800, 0.7), paPeak = filt('peaking', 1800, 0.9), paComp = ctx.createDynamicsCompressor(), paShape = ctx.createWaveShaper();
    paPeak.gain.value = 3; paComp.threshold.value = -26; paComp.ratio.value = 4; paComp.knee.value = 6; paComp.attack.value = 0.004; paComp.release.value = 0.12;
    (function () { const n = 512, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 1.6) / Math.tanh(1.6); } paShape.curve = c; })();
    paIn.connect(paHP); paHP.connect(paLP); paLP.connect(paPeak); paPeak.connect(paComp); paComp.connect(paShape); paShape.connect(announceBus);
    let clipSources = [], clipToken = 0;
    function loadClip(url) {
      if (clipCache.has(url)) return clipCache.get(url);
      const p = (typeof fetch !== 'function' ? Promise.resolve(null) : fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).then((ab) => {
        if (!ab) return null;
        return new Promise((resolve) => {
          try { const r = ctx.decodeAudioData(ab, (b) => resolve(b), () => resolve(null)); if (r && r.then) r.then(resolve, () => resolve(null)); } catch (e) { resolve(null); }   // callback form for older Safari
        });
      })).catch(() => null);
      clipCache.set(url, p);
      return p;
    }
    function duckTo(level, tc) { try { duck.gain.cancelScheduledValues(now()); duck.gain.setTargetAtTime(level, now(), tc); } catch (e) { /* closed */ } }
    function stopClips() {
      clipToken++;
      clipSources.forEach((n) => { try { n.stop(); n.disconnect(); } catch (e) { /* already ended */ } });
      clipSources = [];
      duckTo(1, 0.3);
    }
    const announceClips = async function (urls, fallbackText, lang, delayS) {
      try {
        if (muted || !urls || !urls.length) return false;
        stopClips();
        const token = clipToken;
        const bufs = await Promise.all(urls.map(loadClip));
        if (token !== clipToken || muted) return false;
        if (bufs.some((b) => !b)) { announce(fallbackText, lang); return false; }
        const start = now() + Math.max(0.05, fin(delayS, 0)); let at = start;
        bufs.forEach((b) => {
          const src = ctx.createBufferSource(); src.buffer = b; src.connect(paIn); count.created++;
          src.onended = () => { clipSources = clipSources.filter((x) => x !== src); try { src.disconnect(); } catch (e) { /* gone */ } };
          src.start(at); clipSources.push(src); at += b.duration + 0.22;
        });
        // duck the vehicle (-5 dB) from just before the first clip to just after the last
        const d = duck.gain; d.cancelScheduledValues(now()); d.setTargetAtTime(1, now(), 0.01); d.setTargetAtTime(0.56, Math.max(now(), start - 0.1), 0.15); d.setTargetAtTime(1, at, 0.5);
        return true;
      } catch (e) { console.warn('[Lokféierer] audio announce clips failed', e); return false; }
    };

    const brakeSqueal = guard('brakeSqueal', function (level) {
      const l = clamp(fin(level, 0), 0, 1);
      manualSqueal = { level: l * 0.6, until: now() + 0.5 };
      brakeHiss(now(), 1.3, 0.2 * l, 3400);                          // emergency valve dump
      play(HITS.clunk, { t: now() + 0.03, vol: 0.3 * l, dest: G.brk });
    });

    const setMuted = guard('setMuted', function (m) {
      muted = !!m;
      master.gain.cancelScheduledValues(now());
      master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, now(), 0.04);
      if (muted) { stopClips(); try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* none */ } }
    });
    const resume = () => {
      if (opts.context) return undefined;
      try { if (ctx.state === 'suspended' && ctx.resume) { const r = ctx.resume(); if (r && r.catch) r.catch((e) => console.warn('[Lokféierer] audio resume failed', e)); return r; } } catch (e) { console.warn('[Lokféierer] audio resume failed', e); }
      return undefined;
    };
    resume();

    const stats = () => ({ created: count.created, live: count.live, livePeak: count.livePeak, shots: count.shots, dropped: count.dropped, pending: joint.pending.length, sources: sources.length, state: ctx.state, vehicle: kindKey, perspective: perspNow });
    const dispose = guard('dispose', function () {
      disposed = true;
      if (hornVoice) hornVoice.stop();
      bellHeld = false; crossUntil = 0;
      sources.forEach((s) => { try { s.stop(); } catch (e) { /* not started */ } });
      stopClips();
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* none */ }
      if (ctx.close && !opts.context) ctx.close();
    });

    const debugMute = (list) => { dbg.mute = new Set(list || []); };
    return { debugMute, update, horn, doorChime, doorOpen, doorClose, gong, announce, announceClips, stopClips, brakeSqueal, signalBell, clack, setMuted, master, ctx, resume, dispose, stats };
  }

  TS.audio = { create };
})();
