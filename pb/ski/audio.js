/* Ski Alpen sound: everything is synthesised with Web Audio at run time (our own; no samples, nothing is downloaded).
 *   wind      band-passed noise, louder and brighter with speed, gusting; a low mountain wind always (more in snow / fog)
 *   carve     a crisp "shhh" while the edges hold (edge x speed), off-piste a softer, duller powder hiss
 *   scrape    a grainy scrape while skidding or braking (amplitude-modulated noise)
 *   glide     the low hiss of skis running straight
 *   lift hum  motor and bull-wheel drone with a slow roller clack, by the distance to the nearest lift station / line
 *   ambient   birds below the tree line in sun, a distant village murmur near the houses
 *   one-shots landing thump, crash tumble, countdown beeps and go, slalom gate tick, missed gate buzz, finish chime
 * The context starts on the first user gesture (iOS). The arcade's global mute (localStorage pb_muted, the `arcade:mute` event and the
 * bar's sound button) is honoured; setMuted() is the in-game toggle (menu, M key). update() only moves AudioParams (setTargetAtTime). */
const MASTER = 0.65;
const TC = 0.08;                       // s: time constant of the continuous layers
const NOISE_S = 2.5;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function createAudio({ win = window } = {}) {
  let ctx = null, master = null, muted = readMuted();
  let layers = null;
  let birdAt = 0, clackAt = 0;
  const last = { liftNear: 0 };

  function readMuted() { try { return win.localStorage.getItem('pb_muted') === '1'; } catch (error) { return false; } }

  function noiseBuffer(c, pink) {
    const n = Math.floor(c.sampleRate * NOISE_S);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (pink) { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; } else d[i] = w * 0.5;
    }
    const fade = Math.floor(c.sampleRate * 0.05);              // a seamless loop: crossfade the end into the start
    for (let i = 0; i < fade; i++) { const t = i / fade; d[n - fade + i] = d[n - fade + i] * (1 - t) + d[i] * t; }
    return buf;
  }

  function loop(buf, rate = 1) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    s.start(0, Math.random() * NOISE_S);
    return s;
  }
  function filter(type, f, q = 0.7) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  function gain(v = 0) { const g = ctx.createGain(); g.gain.value = v; return g; }

  function build() {
    const AC = win.AudioContext || win.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3.5;
    master = gain(muted ? 0 : MASTER);
    master.connect(comp); comp.connect(ctx.destination);
    const white = noiseBuffer(ctx, false), pink = noiseBuffer(ctx, true);
    const chain = (src, nodes, out) => { let n = src; for (const x of nodes) { n.connect(x); n = x; } n.connect(out); return out; };
    // wind
    const windBp = filter('bandpass', 400, 0.6), windG = gain(0);
    chain(loop(pink, 0.9), [windBp], windG); windG.connect(master);
    const airLp = filter('lowpass', 500), airG = gain(0);                    // the mountain's own wind, always a little
    chain(loop(pink, 0.6), [airLp], airG); airG.connect(master);
    // carve: crisp high band; powder: dull low band
    const carveBp = filter('bandpass', 3200, 0.9), carveHs = filter('highshelf', 5000), carveG = gain(0);
    carveHs.gain.value = 4;
    chain(loop(white, 1.0), [carveBp, carveHs], carveG); carveG.connect(master);
    const powderLp = filter('lowpass', 900), powderG = gain(0);
    chain(loop(pink, 1.3), [powderLp], powderG); powderG.connect(master);
    // scrape: grainy mid band, amplitude-modulated by a fast square LFO
    const scrapeBp = filter('bandpass', 900, 1.6), scrapeG = gain(0), scrapeAm = gain(0.6);
    const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = 27;
    const amDepth = gain(0.4); am.connect(amDepth); amDepth.connect(scrapeAm.gain); am.start();
    chain(loop(white, 0.8), [scrapeBp, scrapeAm], scrapeG); scrapeG.connect(master);
    // glide
    const glideLp = filter('lowpass', 1400), glideG = gain(0);
    chain(loop(white, 0.7), [glideLp], glideG); glideG.connect(master);
    // lift hum: two saws through a lowpass, slow wobble
    const humLp = filter('lowpass', 260, 1.2), humG = gain(0);
    for (const [f, v] of [[49, 0.6], [98.5, 0.35], [147, 0.15]]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const g = gain(v); o.connect(g); g.connect(humLp); o.start(); }
    humLp.connect(humG); humG.connect(master);
    // village murmur: very low band-passed pink noise
    const villBp = filter('bandpass', 380, 0.9), villG = gain(0);
    chain(loop(pink, 0.5), [villBp], villG); villG.connect(master);
    layers = { windBp, windG, airG, airLp, carveBp, carveG, powderG, powderLp, scrapeBp, scrapeG, glideG, humG, villG, am };
    return true;
  }

  function ensure() {
    if (!ctx && !build()) return;
    if (ctx.state === 'suspended' && !muted) ctx.resume().catch((error) => console.warn('[ski] audio resume failed', error));
  }
  const gesture = () => ensure();
  for (const ev of ['pointerdown', 'keydown', 'touchend']) win.addEventListener(ev, gesture, { passive: true });
  win.addEventListener('arcade:mute', (e) => setMuted(!!(e.detail && e.detail.muted), false));

  function set(param, v, tc = TC) { param.setTargetAtTime(v, ctx.currentTime, tc); }

  function setMuted(next, store = true) {
    muted = next;
    if (store) { try { win.localStorage.setItem('pb_muted', next ? '1' : '0'); } catch (error) { console.warn('[ski] could not store mute', error); } }
    if (!ctx) return;
    set(master.gain, next ? 0 : MASTER, 0.03);
    if (next) setTimeout(() => { if (muted && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 300);
    else ctx.resume().catch(() => {});
  }

  /* ---------------- one-shots ---------------- */
  function tone(f0, f1, dur, type = 'sine', vol = 0.3, delay = 0) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = gain(0);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function noiseHit(dur, f, vol, delay = 0, type = 'lowpass') {
    const t = ctx.currentTime + delay;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const fl = filter(type, f, 0.8), g = gain(vol);
    s.connect(fl); fl.connect(g); g.connect(master); s.start(t);
  }
  function bird(t0) {
    // a short song: 3-6 quick FM chirps
    const n = 3 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 1800;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.07 + Math.random() * 0.06);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(base * (1 + Math.random() * 0.3), t);
      o.frequency.exponentialRampToValueAtTime(base * (0.6 + Math.random() * 0.5), t + 0.06);
      const g = gain(0);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.07);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; o.connect(g); g.connect(pan); pan.connect(master); } else { o.connect(g); g.connect(master); }
      o.start(t); o.stop(t + 0.1);
    }
  }

  const EVENTS = {
    land: (o) => { const k = clamp((o && o.impact) || 0.5, 0.2, 1); tone(110, 42, 0.22, 'sine', 0.45 * k); noiseHit(0.18, 700, 0.35 * k); },
    crash: () => { noiseHit(0.5, 900, 0.5); tone(90, 35, 0.3, 'sine', 0.5); tone(80, 30, 0.25, 'sine', 0.35, 0.28); noiseHit(0.35, 600, 0.3, 0.3); noiseHit(0.6, 1500, 0.18, 0.55, 'bandpass'); },
    avalanche: () => { noiseHit(3.6, 200, 0.6); noiseHit(2.6, 480, 0.32, 0.35); tone(48, 30, 3.2, 'sine', 0.4); noiseHit(1.2, 1400, 0.12, 0.1, 'bandpass'); },        // round 7: a deep rumble
    count: () => tone(660, 660, 0.14, 'triangle', 0.22),
    go: () => tone(990, 990, 0.38, 'triangle', 0.28),
    gate: () => tone(1320, 1500, 0.09, 'triangle', 0.12),
    miss: () => tone(180, 150, 0.25, 'square', 0.08),
    finish: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.35, 'triangle', 0.18, i * 0.11)); },
    click: () => tone(1800, 1600, 0.03, 'square', 0.04),
  };

  return {
    isMuted: () => muted,
    setMuted,
    resume: ensure,
    event(name, opts) { if (!ctx || muted) return; const fn = EVENTS[name]; if (fn) { try { fn(opts); } catch (error) { console.warn('[ski] sound event failed', name, error); } } },
    /**
     * f = { riding, paused, speed (m/s), edge (-1..1), slip, brake, grounded, piste (0..1 under the skis), lift (m to the nearest lift
     * part, or Infinity), village (0..1 houses near), forest (0..1), altitude (m), weather ('sun'|'cloudy'|'snow'|'fog'), dt }
     */
    update(f) {
      if (!ctx || !layers) return;
      const L = layers;
      const live = f.riding && !f.paused ? 1 : 0;
      const v = f.speed || 0;
      const g = f.grounded ? 1 : 0;
      const windy = f.weather === 'snow' || f.weather === 'fog' ? 1.6 : f.weather === 'cloudy' ? 1.2 : 1;
      // wind by speed (it roars from ~60 km/h), gusting
      const wv = smooth(3, 22, v);
      const tt = ctx.currentTime;
      const gust = 0.82 + 0.18 * Math.sin(tt * 0.71) * Math.sin(tt * 0.23 + 1.3) + 0.08 * Math.sin(tt * 2.9);
      set(L.windG.gain, live * (0.02 + 0.5 * wv * wv) * gust, 0.15);
      set(L.windBp.frequency, 300 + 1100 * wv, 0.2);
      set(L.airG.gain, (live ? 0.05 : 0.08) * windy * (0.7 + 0.6 * (0.5 + 0.5 * Math.sin(tt * 0.31) * Math.sin(tt * 0.13))), 0.6);
      set(L.airLp.frequency, 350 + 250 * (0.5 + 0.5 * Math.sin(tt * 0.17)), 0.8);
      // edges
      const sp = smooth(2, 16, v) * g * live;
      const carve = clamp(Math.abs(f.edge || 0) * 1.4, 0, 1) * (1 - clamp((f.slip || 0) * 2, 0, 1));
      const piste = clamp(f.piste == null ? 1 : f.piste, 0, 1);
      set(L.carveG.gain, sp * carve * 0.32 * (0.35 + 0.65 * piste));
      set(L.carveBp.frequency, 2200 + 1800 * smooth(4, 25, v));
      set(L.powderG.gain, sp * (1 - piste) * (0.12 + 0.25 * carve));
      set(L.powderLp.frequency, 500 + 900 * smooth(3, 20, v));
      const scrape = clamp((f.slip || 0) * 2.2 + (f.brake || 0) * 0.9, 0, 1) * smooth(1, 10, v) * g * live;
      set(L.scrapeG.gain, scrape * 0.4 * (0.5 + 0.5 * piste));
      set(L.scrapeBp.frequency, 700 + 500 * smooth(2, 18, v));
      L.am.frequency.setTargetAtTime(18 + v * 1.6, ctx.currentTime, 0.1);
      set(L.glideG.gain, sp * 0.08 * (1 - carve * 0.6));
      // lift hum: audible within ~150 m, with a clack now and then close by
      const liftK = Number.isFinite(f.lift) ? clamp(1 - f.lift / 160, 0, 1) : 0;
      set(L.humG.gain, liftK * liftK * 0.16, 0.3);
      const now = ctx.currentTime;
      if (liftK > 0.5 && now > clackAt) { clackAt = now + 1.6 + Math.random() * 2.5; noiseHit(0.05, 2400, 0.08 * liftK, 0, 'bandpass'); noiseHit(0.05, 2000, 0.06 * liftK, 0.09, 'bandpass'); }
      // ambience: village murmur near houses, birds below the tree line in fair weather
      set(L.villG.gain, clamp(f.village || 0, 0, 1) * 0.06, 0.8);
      const birdy = (f.altitude || 3000) < 2200 && (f.weather === 'sun' || f.weather === 'cloudy') ? clamp((f.forest || 0) * 1.5 + (f.village || 0), 0, 1) : 0;
      if (birdy > 0.15 && now > birdAt) { birdAt = now + (3 + Math.random() * 7) / birdy; bird(now + 0.05); }
      last.liftNear = liftK;
    },
  };
}
