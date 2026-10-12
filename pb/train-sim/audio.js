/* Lokféierer: procedural train audio (C). Create only after a user gesture.
 * TS.audio.create(opts?) -> { update, horn, doorChime, doorOpen, doorClose, gong, announce, brakeSqueal, signalBell, clack, setMuted, master, ctx, resume, dispose }
 * opts.context lets tests pass an OfflineAudioContext. Everything routes through one master gain. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});

  const MASTER_LEVEL = 0.8;
  const CAB_CUTOFF = 1250, OPEN_CUTOFF = 16000;
  const RAIL_LENGTH = { rail: 25, tram: 18, hst: 140 };
  const WHINE_SCALE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];
  const PROFILES = {
    electric: { base: 262, stepW: 1.25, steps: 15, slope: 22, whine: 1.0, hum: 1.0, humBase: 78, fan: 1.0 },
    tram: { base: 330, stepW: 0.9, steps: 12, slope: 60, whine: 0.62, hum: 0.5, humBase: 95, fan: 0.4 },
    hst: { base: 392, stepW: 2.6, steps: 13, slope: 17, whine: 0.38, hum: 0.8, humBase: 58, fan: 1.2 },
  };
  const HORNS = { diesel: [220, 277.2], electric: [440, 554.4], hst: [392, 493.9] };
  const GONG_NOTES = [784, 659.3, 523.3];
  const SPEECH_LANG = { lb: ['lb-LU', 'lb', 'de-LU', 'de-DE', 'de'], de: ['de-DE', 'de'], fr: ['fr-FR', 'fr'], en: ['en-GB', 'en-US', 'en'] };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fin = (v, d) => (Number.isFinite(v) ? v : d);

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

    // ---------------------------------------------------------- node helpers
    const gain = (v) => { const g = ctx.createGain(); g.gain.value = v == null ? 0 : v; return g; };
    const filt = (type, f, q) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q != null) n.Q.value = q; return n; };
    const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
    const to = (param, v, tc) => param.setTargetAtTime(fin(v, 0), now(), tc == null ? 0.1 : tc);

    function noiseBuffer(kind, seconds) {
      const len = Math.floor(sr * seconds), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
      if (kind === 'white') for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      else if (kind === 'pink') {
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        }
      } else if (kind === 'brown') {
        let last = 0;
        for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
      } else if (kind === 'drops') {
        for (let i = 0; i < len; i++) d[i] = Math.random() < 0.0035 ? (Math.random() * 2 - 1) * (0.4 + Math.random() * 0.6) : 0;
      }
      // fade the loop seam
      const f = Math.floor(sr * 0.02);
      for (let i = 0; i < f; i++) { const k = i / f; d[i] *= k; d[len - 1 - i] *= k; }
      return buf;
    }
    const BUF = { white: noiseBuffer('white', 2), pink: noiseBuffer('pink', 4), brown: noiseBuffer('brown', 4), drops: noiseBuffer('drops', 3) };
    function loop(kind) {
      const s = ctx.createBufferSource(); s.buffer = BUF[kind]; s.loop = true; s.start(0, Math.random() * (BUF[kind].duration - 0.1)); return s;
    }
    const sources = []; // everything started once; stopped in dispose
    const keep = (n) => { sources.push(n); return n; };

    // ---------------------------------------------------------- output chain
    const master = gain(0);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 3.5; comp.attack.value = 0.006; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    let muted = false;
    if (opts.context) master.gain.value = MASTER_LEVEL; else { master.gain.setValueAtTime(0, now()); master.gain.linearRampToValueAtTime(MASTER_LEVEL, now() + 0.4); }

    const sceneIn = gain(1), tunnelGain = gain(1), camLP = filt('lowpass', OPEN_CUTOFF, 0.5);
    sceneIn.connect(tunnelGain); tunnelGain.connect(camLP); camLP.connect(master);
    const announceBus = gain(0.9); announceBus.connect(master);

    // tunnel / hall reverb from a generated impulse response
    const reverbIn = gain(1), reverbOut = gain(0.8), conv = ctx.createConvolver();
    (function buildImpulse() {
      const secs = 2.4, len = Math.floor(sr * secs), ir = ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch); let lp = 0;
        for (let i = 0; i < len; i++) {
          const t = i / len, env = Math.pow(1 - t, 3.2), a = 0.9 - 0.8 * t;
          lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
          d[i] = lp * env * 3.2;
        }
      }
      conv.buffer = ir;
    })();
    reverbIn.connect(conv); conv.connect(reverbOut); reverbOut.connect(master);
    const tunnelSend = gain(0); camLP.connect(tunnelSend); tunnelSend.connect(reverbIn);
    const gongSend = gain(0.28); announceBus.connect(gongSend); gongSend.connect(reverbIn);

    // ---------------------------------------------------------- rolling noise
    const rumbleLP = filt('lowpass', 120, 0.7), gRumble = gain(0), bridgeBP = filt('bandpass', 150, 4), gBridge = gain(0);
    const rumbleSrc = keep(loop('brown')); const rumbleHP = filt('highpass', 40, 0.7); rumbleSrc.connect(rumbleLP); rumbleLP.connect(rumbleHP); rumbleHP.connect(gRumble); gRumble.connect(sceneIn);
    const rumbleSrc2 = keep(loop('brown')); rumbleSrc2.connect(bridgeBP); bridgeBP.connect(gBridge); gBridge.connect(sceneIn);
    const roarBP = filt('bandpass', 400, 0.6), gRoar = gain(0);
    const roarSrc = keep(loop('pink')); roarSrc.connect(roarBP); roarBP.connect(gRoar); gRoar.connect(sceneIn);
    const hissBP = filt('bandpass', 2600, 0.7), gHiss = gain(0);
    const hissSrc = keep(loop('white')); hissSrc.connect(hissBP); hissBP.connect(gHiss); gHiss.connect(sceneIn);
    const windBP = filt('bandpass', 600, 0.55), windLP = filt('lowpass', 3000, 0.5), gWind = gain(0);
    const windSrc = keep(loop('pink')); windSrc.connect(windBP); windBP.connect(windLP); windLP.connect(gWind); gWind.connect(sceneIn);

    // ---------------------------------------------------------- diesel engine
    const dLP = filt('lowpass', 420, 0.6), dOut = filt('lowpass', 1700, 0.4), gDiesel = gain(0);
    const dA = keep(osc('sawtooth', 35)), dB = keep(osc('triangle', 70)), dC = keep(osc('sawtooth', 17.5));
    const gDA = gain(0.4), gDB = gain(0.3), gDC = gain(0.02);
    dA.connect(gDA); dB.connect(gDB); dC.connect(gDC); gDA.connect(dLP); gDB.connect(dLP); gDC.connect(dLP);
    const dHP = filt('highpass', 45, 0.7), bodyBP1 = filt('bandpass', 170, 1.0), bodyBP2 = filt('bandpass', 330, 1.3), gBody1 = gain(1.7), gBody2 = gain(1.3);
    dLP.connect(dHP); dHP.connect(dOut);
    gDA.connect(bodyBP1); gDB.connect(bodyBP1); gDA.connect(bodyBP2); bodyBP1.connect(gBody1); bodyBP2.connect(gBody2); gBody1.connect(dOut); gBody2.connect(dOut);
    const knockBP = filt('bandpass', 650, 1.1), knockAM = gain(0.5), knockLfo = keep(osc('square', 35)), knockLfoG = gain(0.5), knockLP = filt('lowpass', 260, 0.5);
    const knockSrc = keep(loop('white')); knockSrc.connect(knockBP); knockBP.connect(knockAM);
    knockLfo.connect(knockLP); knockLP.connect(knockLfoG); knockLfoG.connect(knockAM.gain);
    const gKnock = gain(0.55); knockAM.connect(gKnock); gKnock.connect(dOut);
    const jitterLfo = keep(osc('sine', 0.9)), jitterG = gain(0.6); jitterLfo.connect(jitterG); jitterG.connect(dA.frequency); jitterG.connect(dB.frequency);
    const transOsc = keep(osc('sine', 200)), gTrans = gain(0); transOsc.connect(gTrans); gTrans.connect(dOut);
    const chugAM = gain(0.78), chugLfo = keep(osc('sine', 10)), chugLfoG = gain(0.22);
    chugLfo.connect(chugLfoG); chugLfoG.connect(chugAM.gain);
    dOut.connect(chugAM); chugAM.connect(gDiesel); gDiesel.connect(sceneIn);
    let rpm = 650;

    // ---------------------------------------------------------- electric / tram / hst traction
    const wA = keep(osc('triangle', 262)), wB = keep(osc('sine', 265)), w2 = keep(osc('sine', 524));
    const gWA = gain(0.5), gWB = gain(0.4), gW2 = gain(0.12), whineLP = filt('lowpass', 4200, 0.5), gWhine = gain(0);
    wA.connect(gWA); wB.connect(gWB); w2.connect(gW2); gWA.connect(whineLP); gWB.connect(whineLP); gW2.connect(whineLP); const flutterAM = gain(1); whineLP.connect(flutterAM); flutterAM.connect(gWhine); gWhine.connect(sceneIn);
    const flutter = keep(osc('sine', 7.5)), flutterG = gain(0.06); flutter.connect(flutterG); flutterG.connect(flutterAM.gain);
    const humOsc = keep(osc('sawtooth', 80)), humSub = keep(osc('sine', 40)), humLP = filt('lowpass', 330, 0.7), gHum = gain(0), gHumSub = gain(0.5);
    humOsc.connect(humLP); humSub.connect(gHumSub); gHumSub.connect(humLP); humLP.connect(gHum); gHum.connect(sceneIn);
    const fanLP = filt('lowpass', 520, 0.5), gFan = gain(0);
    const fanSrc = keep(loop('pink')); fanSrc.connect(fanLP); fanLP.connect(gFan); gFan.connect(sceneIn);
    const gearA = keep(osc('triangle', 200)), gearB = keep(osc('sine', 400)), gearLP = filt('lowpass', 2400, 0.6), gGear = gain(0), gGearB = gain(0.4);
    gearA.connect(gearLP); gearB.connect(gGearB); gGearB.connect(gearLP); gearLP.connect(gGear); gGear.connect(sceneIn);
    const hstBand = filt('bandpass', 240, 0.9), gHst = gain(0);
    const hstSrc = keep(loop('pink')); hstSrc.connect(hstBand); hstBand.connect(gHst); gHst.connect(sceneIn);

    // ---------------------------------------------------------- squeal (flange + brake)
    const sq1 = keep(osc('triangle', 2600)), sq2 = keep(osc('sine', 3350)), sq3 = keep(osc('triangle', 1930));
    const sqNoiseBP = filt('bandpass', 3300, 14), sqLP = filt('lowpass', 6200, 0.5), gSq = gain(0), gSqN = gain(0.35);
    const sqLfo = keep(osc('sine', 6.3)), sqLfoG = gain(60); sqLfo.connect(sqLfoG); sqLfoG.connect(sq1.frequency); sqLfoG.connect(sq2.frequency);
    const sqSrc = keep(loop('white')); sqSrc.connect(sqNoiseBP); sqNoiseBP.connect(gSqN);
    const gSq1 = gain(0.5), gSq2 = gain(0.3), gSq3 = gain(0.25);
    sq1.connect(gSq1); sq2.connect(gSq2); sq3.connect(gSq3); gSq1.connect(sqLP); gSq2.connect(sqLP); gSq3.connect(sqLP); gSqN.connect(sqLP); sqLP.connect(gSq); gSq.connect(sceneIn);
    let manualSqueal = { level: 0, until: 0 };

    // ---------------------------------------------------------- rain + cab ambience (bypass the cab filter)
    const rainBus = gain(0); rainBus.connect(master);
    const rainHP = filt('highpass', 700, 0.5), rainBP = filt('bandpass', 4200, 0.35), gRainHiss = gain(0.7);
    const rainSrc = keep(loop('pink')); rainSrc.connect(rainHP); rainHP.connect(rainBP); rainBP.connect(gRainHiss); gRainHiss.connect(rainBus);
    const dropBP = filt('bandpass', 3300, 1.2), gDrops = gain(0.9);
    const dropSrc = keep(loop('drops')); dropSrc.connect(dropBP); dropBP.connect(gDrops); gDrops.connect(rainBus);
    const cabLP = filt('lowpass', 300, 0.5), gCab = gain(0);
    const cabSrc = keep(loop('pink')); cabSrc.connect(cabLP); cabLP.connect(gCab); gCab.connect(master);

    [chugLfo, gearA, gearB, dA, dB, dC, knockLfo, jitterLfo, transOsc, wA, wB, w2, flutter, humOsc, humSub, sq1, sq2, sq3, sqLfo].forEach((o) => o.start());

    // ---------------------------------------------------------- one-shot helpers
    function burst(o) {
      const t = o.t == null ? now() : o.t, s = ctx.createBufferSource(); s.buffer = BUF[o.kind || 'white']; s.start(t, Math.random() * 0.8);
      const f = filt(o.type || 'bandpass', o.f, o.q == null ? 1 : o.q); const g = gain(0);
      if (o.f2) { f.frequency.setValueAtTime(o.f, t); f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur); }
      const peak = o.vol, atk = o.atk == null ? 0.006 : o.atk, hold = o.hold || 0;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + atk); if (hold) g.gain.setValueAtTime(peak, t + atk + hold);
      g.gain.exponentialRampToValueAtTime(0.0005, t + atk + hold + o.dur);
      s.connect(f); f.connect(g); g.connect(o.dest || sceneIn);
      s.stop(t + atk + hold + o.dur + 0.05);
      s.onended = () => { try { s.disconnect(); f.disconnect(); g.disconnect(); } catch (e) { /* already gone */ } };
    }
    function tone(o) {
      const t = o.t == null ? now() : o.t, os = osc(o.type || 'sine', o.f), g = gain(0);
      if (o.f2) { os.frequency.setValueAtTime(o.f, t); os.frequency.exponentialRampToValueAtTime(o.f2, t + (o.atk == null ? 0.004 : o.atk) + (o.hold || 0) + o.dur); }
      const atk = o.atk == null ? 0.004 : o.atk;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.vol, t + atk);
      if (o.hold) g.gain.setValueAtTime(o.vol, t + atk + o.hold);
      g.gain.exponentialRampToValueAtTime(0.0005, t + atk + (o.hold || 0) + o.dur);
      let tail = g;
      if (o.lp) { const l = filt('lowpass', o.lp, 0.6); os.connect(l); l.connect(g); tail = l; } else os.connect(g);
      g.connect(o.dest || sceneIn); os.start(t); os.stop(t + atk + (o.hold || 0) + o.dur + 0.05);
      os.onended = () => { try { os.disconnect(); g.disconnect(); if (tail !== g) tail.disconnect(); } catch (e) { /* already gone */ } };
    }
    function strike(t, f, vol, decay, ratios, amps, dest) {
      ratios.forEach((r, i) => tone({ t, f: f * r, vol: vol * amps[i], dur: decay / (1 + i * 0.45), atk: 0.002, dest }));
    }

    // ---------------------------------------------------------- state
    let bellLevel = 1, kind = 'electric', hornVoice = null, hornSound = 'electric', bellUntil = 0, crossTimer = null, jointAccum = 0, jointNext = 0, lastUpdate = 0, rainLevel = 0, disposed = false;
    let lastSpeed = 0;

    // ---------------------------------------------------------- update (per frame)
    const update = guard('update', function (p) {
      p = p || {};
      const t = now(), v = Math.max(0, fin(p.speedMs, 0)), lever = fin(p.lever, 0), acc = fin(p.accelMs2, 0);
      kind = p.sound || kind;
      const cab = p.camera === 'cab', tunnel = !!p.inTunnel, bridge = !!p.onBridge;
      const dt = lastUpdate ? clamp(t - lastUpdate, 0, 0.25) : 0.016; lastUpdate = t; lastSpeed = v;
      const profile = PROFILES[kind];

      // camera + tunnel mix
      to(camLP.frequency, cab ? CAB_CUTOFF : OPEN_CUTOFF, 0.12);
      to(sceneIn.gain, cab ? 0.78 : 1, 0.15);
      to(tunnelGain.gain, tunnel ? 1.45 : 1, 0.35);
      to(tunnelSend.gain, tunnel ? 0.5 : 0, 0.4);
      to(gCab.gain, cab ? 0.05 : 0, 0.3);

      // wheel-rail rumble, roar, hiss, wind
      const vn = clamp(v / 35, 0, 1.4);
      to(gRumble.gain, 0.26 * Math.pow(vn, 0.85) * (bridge ? 1.35 : 1), 0.12);
      to(rumbleLP.frequency, 90 + v * 11, 0.15);
      to(gBridge.gain, bridge ? 0.5 * Math.min(1, v / 14) : 0, 0.25);
      to(gRoar.gain, 0.34 * Math.pow(clamp(v / 45, 0, 1.5), 1.1), 0.12);
      to(roarBP.frequency, 280 + v * 14, 0.15);
      to(gHiss.gain, 0.08 * Math.pow(clamp(v / 70, 0, 1.4), 2), 0.15);
      to(hissBP.frequency, 2000 + v * 18, 0.2);
      const windK = kind === 'hst' ? 0.42 : 0.18;
      to(gWind.gain, windK * Math.pow(clamp(v / 90, 0, 1.4), 2.2), 0.2);
      to(windBP.frequency, 350 + v * 9, 0.2);

      // diesel
      const isDiesel = kind === 'diesel';
      const throttle = lever > 0 ? clamp(lever / 5, 0, 1) : 0, load = clamp(throttle * (acc > -0.05 ? 1 : 0.4), 0, 1);
      const rpmTarget = 650 + 820 * load + 330 * clamp(v / 25, 0, 1);
      rpm += (rpmTarget - rpm) * (1 - Math.exp(-dt / (rpmTarget > rpm ? 0.7 : 1.1)));
      const fire = (rpm / 60) * 3;
      to(dA.frequency, fire, 0.05); to(dB.frequency, fire * 2, 0.05); to(dC.frequency, fire * 0.5, 0.05); to(knockLfo.frequency, fire, 0.05);
      to(dLP.frequency, 330 + rpm * 0.45, 0.12);
      to(chugLfo.frequency, fire / 3, 0.1);
      to(gDiesel.gain, isDiesel ? 0.2 + 0.26 * load + 0.05 * clamp(v / 25, 0, 1) : 0, 0.18);
      to(gKnock.gain, 1.2 + 1.0 * load, 0.2);
      to(transOsc.frequency, 150 + v * 11, 0.1);
      to(gTrans.gain, isDiesel ? 0.018 * (0.3 + load) * clamp(v / 6, 0, 1) : 0, 0.2);

      // electric-family whine + hum
      const eTraction = !!profile;
      if (eTraction) {
        const idx = Math.min(profile.steps - 1, Math.floor(v / profile.stepW)), topV = profile.steps * profile.stepW;
        const stepped = profile.base * Math.pow(2, WHINE_SCALE[Math.min(idx, WHINE_SCALE.length - 1)] / 12);
        const topF = profile.base * Math.pow(2, WHINE_SCALE[Math.min(profile.steps - 1, WHINE_SCALE.length - 1)] / 12);
        let f = v < topV ? stepped : topF + (v - topV) * profile.slope;
        const power = lever > 0 ? 0.55 + 0.09 * lever : lever < 0 ? 0.2 + 0.03 * Math.min(8, -lever) : 0.035;
        if (lever < 0) f *= 0.8;
        const fadeIn = clamp(v / 0.6, 0, 1);
        const tc = v < topV && lever >= 0 ? 0.014 : 0.06;
        [wA, wB].forEach((o, i) => to(o.frequency, f * (i ? 1.006 : 1), tc));
        to(w2.frequency, f * 2.005, tc);
        to(gWhine.gain, 0.2 * profile.whine * power * fadeIn, 0.1);
        to(whineLP.frequency, 2600 + f * 1.5, 0.2);
        to(humOsc.frequency, profile.humBase + v * 2.1, 0.2);
        to(humSub.frequency, (profile.humBase + v * 2.1) * 0.5, 0.2);
        to(gHum.gain, 0.15 * profile.hum * (0.45 + 0.55 * clamp(v / 12, 0, 1)) * (0.8 + 0.2 * Math.max(0, lever) / 5), 0.2);
        const gearF = (kind === 'hst' ? 150 + v * 8 : 130 + v * 17);
        to(gearA.frequency, gearF, 0.1); to(gearB.frequency, gearF * 2.02, 0.1);
        to(gGear.gain, 0.05 * profile.hum * clamp(v / 6, 0, 1) * (lever > 0 ? 1 : lever < 0 ? 0.6 : 0.4), 0.2);
        to(gFan.gain, 0.07 * profile.fan * (0.5 + clamp(v / 40, 0, 1)), 0.3);
        to(gHst.gain, kind === 'hst' ? 0.18 * (0.35 + 0.65 * clamp(v / 70, 0, 1)) : 0, 0.3);
        to(hstBand.frequency, 180 + v * 4, 0.3);
      } else { to(gWhine.gain, 0, 0.1); to(gHum.gain, 0, 0.1); to(gGear.gain, 0, 0.1); to(gFan.gain, 0, 0.2); to(gHst.gain, 0, 0.2); }

      // squeal: brake near standstill, flange in tight curves
      const brakeAuto = lever < 0 && v > 0.15 && v < 2.3 ? clamp(v / 0.5, 0, 1) * (1 - v / 2.3) * Math.min(1, -lever / 3) * 0.4 : 0;
      const curv = Math.abs(fin(p.curvature, 0)), flange = clamp((curv * 1000 - 1.6) / 3, 0, 1) * clamp(v / 12, 0, 1) * (kind === 'tram' ? 0.4 : 0.3);
      const man = t < manualSqueal.until ? manualSqueal.level * (v > 2.4 ? (manualSqueal.level >= 0.5 ? 0.35 : 0) : 1) : 0;
      const sqLevel = Math.max(brakeAuto, flange, man);
      const sqPitch = brakeAuto >= flange ? 1800 + 1300 * clamp(v / 2.3, 0, 1) : 1700 + 700 * clamp(curv * 700, 0, 1);
      to(sq1.frequency, sqPitch, 0.1); to(sq2.frequency, sqPitch * 1.29, 0.1); to(sq3.frequency, sqPitch * 0.74, 0.1); to(sqNoiseBP.frequency, sqPitch * 1.25, 0.1);
      to(gSq.gain, sqLevel * 0.55, 0.07);

      // rain: roof drumming in the cab, hiss outside, nothing in tunnels
      rainLevel = tunnel ? 0 : p.rain === true ? 1 : clamp(fin(Number(p.rain), 0), 0, 1);
      to(rainBus.gain, rainLevel * (cab ? 0.24 : 0.13), 0.4);
      to(rainBP.frequency, cab ? 1500 : 4200, 0.3); to(rainBP.Q, cab ? 0.5 : 0.35, 0.3); to(gDrops.gain, cab ? 1.3 : 0.7, 0.3);

      // rail joints: ka-dunk rhythm follows the speed; rare + soft on welded high-speed track
      const railLen = kind === 'hst' ? RAIL_LENGTH.hst : kind === 'tram' ? RAIL_LENGTH.tram : RAIL_LENGTH.rail;
      if (v > 1.2) {
        jointAccum += v * dt;
        if (jointAccum >= railLen && t >= jointNext) {
          jointAccum = jointAccum % railLen;
          const vol = (kind === 'hst' ? 0.28 : 1) * (0.35 + 0.65 * clamp(v / 28, 0, 1)) * (bridge ? 1.4 : 1);
          jointHit(t, vol, v);
          jointNext = t + 0.12;
        }
      } else jointAccum = 0;
    });

    // ---------------------------------------------------------- rail joints
    function axleHit(t, vol) {
      const pitch = 0.9 + Math.random() * 0.2;
      burst({ t, f: 1700 * pitch, q: 1.4, vol: 0.34 * vol, dur: 0.035, atk: 0.0015 });
      burst({ t, f: 520 * pitch, q: 3, vol: 0.18 * vol, dur: 0.12, atk: 0.002 });
      tone({ t, f: 130 * pitch, f2: 58, vol: 0.5 * vol, dur: 0.11, atk: 0.002 });
    }
    function jointHit(t, vol, v) {
      const gap = clamp(2.5 / Math.max(v, 3), 0.05, 0.3), second = clamp(17 / Math.max(v, 3), 0.25, 1.2);
      axleHit(t, vol); axleHit(t + gap, vol * 0.85);
      if (second < 1.2 && vol > 0.3) { axleHit(t + second, vol * 0.55); axleHit(t + second + gap, vol * 0.5); }
    }
    const clack = guard('clack', function (vol) { jointHit(now(), vol == null ? 0.8 : vol, 22); });

    // ---------------------------------------------------------- horn / bell
    function tramDing(t) { strike(t, 1050, 0.3, 0.7, [1, 2.01, 2.92, 4.1, 5.6], [1, 0.5, 0.32, 0.18, 0.1]); }
    const horn = guard('horn', function (down) {
      const t = now();
      if (down) {
        if (hornVoice) return;
        hornSound = kind;
        if (kind === 'tram') {
          tramDing(t);
          const timer = setInterval(() => { try { tramDing(now()); } catch (e) { /* ctx closed */ } }, 270);
          hornVoice = { stop() { clearInterval(timer); } };
          return;
        }
        const set = HORNS[kind] || HORNS.electric, out = gain(0), growl = gain(0.8), growLfo = osc('sine', 29), growG = gain(0.22), lp = filt('lowpass', 2600, 0.7), formant = filt('bandpass', 1050, 1.6), gForm = gain(0.45), nodes = [out, growl, growG, lp, formant, gForm], oscs = [growLfo];
        growLfo.connect(growG); growG.connect(growl.gain); growLfo.start(t);
        set.forEach((f) => {
          [1, 1.0035].forEach((det, i) => {
            const o = osc('sawtooth', f * 0.955); o.frequency.setValueAtTime(f * 0.955, t); o.frequency.exponentialRampToValueAtTime(f * det, t + 0.1);
            const g = gain(i ? 0.35 : 0.5); o.connect(g); g.connect(lp); g.connect(formant); o.start(t); oscs.push(o); nodes.push(g);
          });
        });
        formant.connect(gForm); gForm.connect(out); lp.connect(out); out.connect(growl); growl.connect(sceneIn);
        out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.15, t + 0.05);
        burst({ t, f: 1800, q: 0.8, vol: 0.05, dur: 0.12, atk: 0.01 });
        hornVoice = { stop() { const e = now(); out.gain.cancelScheduledValues(e); out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), e); out.gain.exponentialRampToValueAtTime(0.0002, e + 0.28); oscs.forEach((o) => { o.stop(e + 0.32); }); setTimeout(() => nodes.forEach((n) => { try { n.disconnect(); } catch (e2) { /* gone */ } }), 500); } };
      } else if (hornVoice) { hornVoice.stop(); hornVoice = null; }
    });

    const signalBell = guard('signalBell', function (seconds, level) {
      const t = now();
      if (level != null) bellLevel = clamp(fin(level, 1), 0, 1);
      bellUntil = Math.max(bellUntil, t + (seconds > 0 ? seconds : 1.2));
      if (crossTimer) return;
      let flip = 0;
      const ring = () => {
        if (disposed || now() > bellUntil) { clearInterval(crossTimer); crossTimer = null; return; }
        flip ^= 1; strike(now(), flip ? 1900 : 2150, 0.22 * bellLevel, 0.14, [1, 2.76, 5.4], [1, 0.4, 0.15]);
      };
      ring(); crossTimer = setInterval(ring, 150);
    });

    // ---------------------------------------------------------- doors
    const doorOpen = guard('doorOpen', function () {
      const t = now();
      tone({ t, f: 120, f2: 62, vol: 0.32, dur: 0.14 });
      burst({ t: t + 0.02, f: 3300, q: 0.45, vol: 0.2, atk: 0.03, hold: 0.35, dur: 0.45 });
      burst({ t: t + 0.05, f: 900, f2: 1500, q: 0.6, vol: 0.1, atk: 0.05, hold: 0.25, dur: 0.4 });
      tone({ t: t + 0.2, f: 150, f2: 235, type: 'sawtooth', vol: 0.05, atk: 0.1, hold: 0.55, dur: 0.15, lp: 520 });
      burst({ t: t + 0.2, kind: 'brown', f: 380, type: 'lowpass', q: 0.5, vol: 0.18, atk: 0.1, hold: 0.55, dur: 0.15 });
      tone({ t: t + 1.0, f: 95, f2: 55, vol: 0.28, dur: 0.12 });
    });
    const doorClose = guard('doorClose', function () {
      const t = now();
      burst({ t, f: 3000, q: 0.45, vol: 0.15, atk: 0.02, hold: 0.15, dur: 0.3 });
      tone({ t: t + 0.1, f: 230, f2: 150, type: 'sawtooth', vol: 0.05, atk: 0.1, hold: 0.55, dur: 0.15, lp: 520 });
      burst({ t: t + 0.1, kind: 'brown', f: 380, type: 'lowpass', q: 0.5, vol: 0.18, atk: 0.1, hold: 0.55, dur: 0.15 });
      tone({ t: t + 0.85, f: 105, f2: 48, vol: 0.5, dur: 0.14 });
      burst({ t: t + 0.85, f: 1100, type: 'lowpass', q: 0.7, vol: 0.2, dur: 0.07, atk: 0.002 });
      burst({ t: t + 0.92, f: 3000, q: 2, vol: 0.06, dur: 0.04, atk: 0.001 });
    });
    const doorChime = guard('doorChime', function () {
      const t = now();
      for (let i = 0; i < 3; i++) {
        const s = t + i * 0.27;
        tone({ t: s, f: 1000, vol: 0.22, hold: 0.14, dur: 0.03, atk: 0.008 });
        tone({ t: s, f: 2000, vol: 0.04, hold: 0.12, dur: 0.03, atk: 0.008 });
      }
    });

    // ---------------------------------------------------------- gong + speech
    const gong = guard('gong', function () {
      const t = now();
      GONG_NOTES.forEach((f, i) => strike(t + i * 0.55, f, 0.24, 1.9, [1, 2, 2.76, 4.07], [1, 0.4, 0.18, 0.08], announceBus));
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

    const brakeSqueal = guard('brakeSqueal', function (level) {
      const l = clamp(fin(level, 0), 0, 1) * 0.5;
      manualSqueal = { level: l, until: now() + 0.4 };
      to(sq1.frequency, 2500, 0.05); to(sq2.frequency, 3200, 0.05); to(sqNoiseBP.frequency, 3100, 0.05);
      to(gSq.gain, l * 0.55, 0.05);
    });

    const setMuted = guard('setMuted', function (m) {
      muted = !!m;
      master.gain.cancelScheduledValues(now());
      master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, now(), 0.04);
      if (muted) { try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* none */ } }
    });
    const resume = () => {
      if (opts.context) return undefined;
      try { if (ctx.state === 'suspended' && ctx.resume) { const r = ctx.resume(); if (r && r.catch) r.catch((e) => console.warn('[Lokféierer] audio resume failed', e)); return r; } } catch (e) { console.warn('[Lokféierer] audio resume failed', e); }
      return undefined;
    };
    resume();

    const dispose = guard('dispose', function () {
      disposed = true;
      if (hornVoice) hornVoice.stop();
      clearInterval(crossTimer);
      sources.forEach((s) => { try { s.stop(); } catch (e) { /* not started */ } });
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* none */ }
      if (ctx.close && !opts.context) ctx.close();
    });

    return { update, horn, doorChime, doorOpen, doorClose, gong, announce, brakeSqueal, signalBell, clack, setMuted, master, ctx, resume, dispose };
  }

  TS.audio = { create };
})();
