/* Ski Alpen sound: everything is computed with our own code at run time (no samples, nothing is downloaded).
 *   The continuous layers play short loops from sound-bank.js (physical-model-ish noise shaping, rendered once after the first touch, two
 *   copies at different speeds where a repeat would show) through live filters that follow the skier; update() only moves AudioParams.
 *   wind      gusting spectrum + whistles, louder and brighter with speed; a low mountain wind always (more in snow / fog)
 *   carve     a crisp "shhh" with crystal crackle while the edges hold (edge x speed), off-piste a softer, duller powder hiss
 *   scrape    a grainy stick-slip scrape on hard snow while skidding or braking
 *   glide     the low hiss of skis running straight
 *   lift      motor drone + roller thumps along the line; at a station the bull-wheel machinery, a crowd murmur and a chair clack over the sheaves
 *   ambient   birds by time of day (morning finches / tits / robin, midday a few, evening thrush, the chough high up), a village murmur
 *   avalanche a rolling rumble while a slab flows (louder the closer and the more of it moves, R7-C2); the release: a crack and a heavy whump
 *   one-shots landing thump (light / heavy), crash, gondola door, countdown beeps and go, slalom gate tick, missed gate buzz, finish chime
 *   music     menu music (music.js, composed + rendered at run time) in the picker and the menus only, faded out when a ride starts,
 *             loaded after the first touch, own on / off (pb_ski_music, default on) next to the sound toggle
 * The context starts on the first user gesture (iOS) and is resumed after a lock / tab switch / interruption. The arcade's global mute
 * (localStorage pb_muted, the `arcade:mute` event and the bar's sound button) is honoured by everything including the music; setMuted() is
 * the in-game toggle (menu, M key). */
const MASTER = 0.65;
const TC = 0.08;                       // s: time constant of the continuous layers
const MUSIC_LEVEL = 0.7;               // x the loop's RMS 0.1, through the master gain
const MUSIC_KEY = 'pb_ski_music';
const BANK_DELAY_MS = 1800, MUSIC_DELAY_MS = 2600;      // after the first touch: the sound bank, then the menu music (only if a menu is still up)
/* which bird phrases sing at which time of day, and the seconds between songs (the phrases themselves: sound-bank.js birdPhrases) */
const BIRD_PLANS = {
  morning: { phrases: ['finch', 'tit', 'robin', 'peep', 'tit', 'finch'], gap: [2.5, 6] },
  midday: { phrases: ['tit', 'peep', 'finch'], gap: [6, 15] },
  evening: { phrases: ['thrush', 'robin', 'thrush', 'peep'], gap: [4, 10] },
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function createAudio({ win = window } = {}) {
  let ctx = null, master = null, muted = readMuted(), musicOn = readMusic();
  let layers = null, bank = null;
  const bufs = new Map();
  let birdAt = 0, clackAt = 0;
  const last = { liftNear: 0, stationNear: 0, rumble: 0 };
  let wantMenu = false, musicState = 'idle', musicBuf = null, musicSrc = null, musicG = null, musicStopT = 0;

  function readMuted() { try { return win.localStorage.getItem('pb_muted') === '1'; } catch (error) { return false; } }
  function readMusic() { try { return win.localStorage.getItem(MUSIC_KEY) !== '0'; } catch (error) { return true; } }

  function filter(type, f, q = 0.7) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  function gain(v = 0) { const g = ctx.createGain(); g.gain.value = v; return g; }

  /** A bank buffer as an AudioBuffer (made once, at its own sample rate: the browser resamples while playing). */
  function bufferOf(name) {
    let b = bufs.get(name);
    if (!b) {
      const rec = bank.get(name);
      b = ctx.createBuffer(1, rec.data.length, rec.sr); b.copyToChannel(rec.data, 0); bufs.set(name, b);
    }
    return b;
  }
  /** A looping source into `dest`, from a random spot, `level` and `rate` (a second copy at another rate = no audible repeat). */
  function loop(name, dest, { rate = 1, level = 1 } = {}) {
    const s = ctx.createBufferSource(); s.buffer = bufferOf(name); s.loop = true; s.playbackRate.value = rate;
    if (level !== 1) { const g = gain(level); s.connect(g); g.connect(dest); } else s.connect(dest);
    s.start(0, Math.random() * s.buffer.duration);
    return s;
  }
  /** A one-shot from the bank; false when it is not ready yet (the caller falls back to the plain synthesis). */
  function shot(name, { vol = 1, rate = 1, pan = 0, delay = 0 } = {}) {
    if (!bank || !bufs.has(name)) return false;
    const s = ctx.createBufferSource(); s.buffer = bufs.get(name); s.playbackRate.value = rate;
    const g = gain(vol); s.connect(g);
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(master); } else g.connect(master);
    s.start(ctx.currentTime + delay);
    return true;
  }

  function build() {
    const AC = win.AudioContext || win.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3.5;
    master = gain(muted ? 0 : MASTER);
    master.connect(comp); comp.connect(ctx.destination);
    musicG = gain(0); musicG.connect(master);
    // the graph is built at once (filters + gains, silent); the sources join one by one as their buffers are made (loadBank)
    const into = (node, g) => { node.connect(g); g.connect(master); return node; };
    const windBp = filter('bandpass', 400, 0.6), windG = gain(0); into(windBp, windG);
    const airLp = filter('lowpass', 500), airG = gain(0); into(airLp, airG);               // the mountain's own wind, always a little
    const carveBp = filter('bandpass', 3200, 0.9), carveHs = filter('highshelf', 5000), carveG = gain(0);
    carveHs.gain.value = 4; carveBp.connect(carveHs); into(carveHs, carveG);
    const powderLp = filter('lowpass', 900), powderG = gain(0); into(powderLp, powderG);
    const scrapeBp = filter('bandpass', 900, 1.6), scrapeAm = gain(0.75), scrapeG = gain(0);
    const am = ctx.createOscillator(); am.type = 'triangle'; am.frequency.value = 27;       // a mild stick-slip on top of the grain train
    const amDepth = gain(0.25); am.connect(amDepth); amDepth.connect(scrapeAm.gain); am.start();
    scrapeBp.connect(scrapeAm); into(scrapeAm, scrapeG);
    const glideLp = filter('lowpass', 1400), glideG = gain(0); into(glideLp, glideG);
    const humLp = filter('lowpass', 700, 0.8), humG = gain(0); into(humLp, humG);
    const machLp = filter('lowpass', 900, 0.7), machG = gain(0); into(machLp, machG);
    const stationLp = filter('lowpass', 2600, 0.6), stationG = gain(0); into(stationLp, stationG);      // the crowd at a station: near, bright
    const villLp = filter('lowpass', 650, 0.7), villG = gain(0); into(villLp, villG);                    // the village: far, dull
    const rumLp = filter('lowpass', 160, 0.9), rumLp2 = filter('lowpass', 420, 0.5), rumG = gain(0);
    rumLp.connect(rumLp2); into(rumLp2, rumG);
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 36;
    const subWob = ctx.createOscillator(); subWob.frequency.value = 0.7; const subDepth = gain(6); subWob.connect(subDepth); subDepth.connect(sub.frequency);
    const subG = gain(0); sub.connect(subG); subG.connect(master); sub.start(); subWob.start();
    layers = {
      windBp, windG, airG, airLp, carveBp, carveG, powderG, powderLp, scrapeBp, scrapeG, glideG, humG, machG, stationG, villG, am, rumG, rumLp, subG,
      into: { windBp, airLp, carveBp, powderLp, scrapeBp, glideLp, humLp, machLp, stationLp, villLp, rumLp },
    };
    unlock();
    setTimeout(loadBank, BANK_DELAY_MS);          // the first touch is often the tap that starts a ride: let that start finish first
    return true;
  }

  /** iOS: a silent one-sample buffer played inside the first gesture unlocks output for good. */
  function unlock() {
    try { const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0); } catch (error) { /* no unlock needed */ }
  }

  /** The bank is a module of its own (not in the first-play download): fetched after the first touch, its buffers made one per tick. */
  function loadBank() {
    import('./sound-bank.js').then((m) => {
      if (!ctx) return;
      bank = m.createBank();
      const I = layers.into;
      const jobs = [
        () => { loop('carve', I.carveBp, { level: 0.75 }); loop('carve', I.carveBp, { rate: 0.91, level: 0.75 }); },
        () => { loop('powder', I.powderLp, { rate: 1.1, level: 0.8 }); loop('powder', I.powderLp, { rate: 0.9, level: 0.8 }); },
        () => loop('scrape', I.scrapeBp),
        () => loop('glide', I.glideLp),
        () => { loop('wind', I.windBp, { rate: 1.0, level: 0.8 }); loop('wind', I.windBp, { rate: 0.82, level: 0.8 }); loop('air', I.airLp); },
        () => { loop('hum', I.humLp); loop('machine', I.machLp); },
        () => { loop('crowd', I.stationLp); loop('crowd', I.villLp, { rate: 0.8 }); },
        () => loop('rumble', I.rumLp),
        () => { for (const n of ['landLight', 'landHeavy', 'clack0', 'clack1', 'clack2', 'door']) bufferOf(n); },
        () => { const b = bank.birds(); for (const k of Object.keys(b)) { const d = b[k], buf = ctx.createBuffer(1, d.length, 32000); buf.copyToChannel(d, 0); bufs.set('bird:' + k, buf); } },
      ];
      const run = (k) => {
        if (!ctx) return;
        if (k >= jobs.length) { layers.ready = true; return; }
        try { jobs[k](); } catch (error) { console.warn('[ski] sound layer failed', k, error); }
        setTimeout(() => run(k + 1), 0);
      };
      run(0);
    }).catch((error) => console.warn('[ski] sound bank failed', error));
  }

  function ensure() {
    if (!ctx && !build()) return;
    // 'suspended' (autoplay rule / muted) and 'interrupted' (iOS: a call, the lock screen, the tab in the background)
    if (ctx.state !== 'running' && !muted) ctx.resume().catch(() => { /* needs a gesture: the next touch resumes it */ });
  }
  const gesture = () => ensure();
  for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) win.addEventListener(ev, gesture, { passive: true });
  win.addEventListener('arcade:mute', (e) => setMuted(!!(e.detail && e.detail.muted), false));
  // back from another tab / the lock screen: iOS may have suspended or interrupted the context; try at once, a touch does it otherwise
  win.addEventListener('pageshow', () => { if (ctx) ensure(); });
  win.addEventListener('focus', () => { if (ctx) ensure(); });
  if (win.document && win.document.addEventListener) win.document.addEventListener('visibilitychange', () => { if (ctx && !win.document.hidden) ensure(); });

  function set(param, v, tc = TC) { param.setTargetAtTime(v, ctx.currentTime, tc); }

  function setMuted(next, store = true) {
    muted = next;
    if (store) { try { win.localStorage.setItem('pb_muted', next ? '1' : '0'); } catch (error) { console.warn('[ski] could not store mute', error); } }
    if (!ctx) return;
    set(master.gain, next ? 0 : MASTER, 0.03);
    if (next) setTimeout(() => { if (muted && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 300);
    else ctx.resume().catch(() => {});
  }

  /* ---------------- menu music ---------------- */
  function loadMusic() {
    if (musicState !== 'idle' || !ctx) return;
    musicState = 'loading';
    setTimeout(() => {
      if (!ctx || !(wantMenu && musicOn)) { musicState = 'idle'; return; }
      importMusic();
    }, MUSIC_DELAY_MS);
  }
  function importMusic() {
    import('./music.js').then((m) => {
      const steps = m.renderMusicSteps(m.MUSIC_RATE);
      const next = () => {
        let r;
        try { r = steps.next(); } catch (error) { musicState = 'failed'; console.warn('[ski] music failed', error); return; }
        if (!r.done) { setTimeout(next, 4); return; }
        const v = r.value, b = ctx.createBuffer(2, v.length, m.MUSIC_RATE);
        b.copyToChannel(v.left, 0); b.copyToChannel(v.right, 1);
        musicBuf = b; musicState = 'ready'; syncMusic();
      };
      next();
    }).catch((error) => { musicState = 'failed'; console.warn('[ski] music module failed', error); });
  }
  function syncMusic() {
    if (!ctx || !musicG) return;
    if (wantMenu && musicOn) {
      if (!musicBuf) { loadMusic(); return; }
      clearTimeout(musicStopT); musicStopT = 0;
      if (!musicSrc) { musicSrc = ctx.createBufferSource(); musicSrc.buffer = musicBuf; musicSrc.loop = true; musicSrc.connect(musicG); musicSrc.start(0); }
      set(musicG.gain, MUSIC_LEVEL, 0.9);
    } else if (musicSrc && !musicStopT) {
      set(musicG.gain, 0, 0.45);                                          // fades out in about 1.5 s
      musicStopT = setTimeout(() => { musicStopT = 0; if (musicSrc && !(wantMenu && musicOn)) { try { musicSrc.stop(); } catch (error) { /* already stopped */ } musicSrc.disconnect(); musicSrc = null; } }, 3200);
    }
  }
  function setMusic(next, store = true) {
    musicOn = !!next;
    if (store) { try { win.localStorage.setItem(MUSIC_KEY, musicOn ? '1' : '0'); } catch (error) { console.warn('[ski] could not store music choice', error); } }
    syncMusic();
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
  /** A chair grip clattering over the sheaves: one of three variants, a little different in pitch each time. */
  function clack(vol) {
    if (!shot('clack' + Math.floor(Math.random() * 3), { vol, rate: 0.92 + Math.random() * 0.2, pan: Math.random() * 0.8 - 0.4 })) { noiseHit(0.05, 2400, 0.32 * vol, 0, 'bandpass'); noiseHit(0.05, 2000, 0.24 * vol, 0.09, 'bandpass'); }
  }
  function bird(f) {
    const plan = BIRD_PLANS[f.time] || BIRD_PLANS.midday;
    const high = (f.altitude || 0) > 1700 && Math.random() < 0.3;
    const name = high ? 'chough' : plan.phrases[Math.floor(Math.random() * plan.phrases.length)];
    shot('bird:' + name, { vol: (high ? 0.07 : 0.06) * (0.6 + 0.7 * Math.random()), rate: 0.92 + Math.random() * 0.2, pan: Math.random() * 1.6 - 0.8, delay: 0.05 });
  }

  const EVENTS = {
    land: (o) => {
      const k = clamp((o && o.impact) || 0.5, 0.2, 1);
      if (!shot(k > 0.55 ? 'landHeavy' : 'landLight', { vol: 0.35 + 0.35 * k, rate: 0.95 + Math.random() * 0.1 })) { tone(110, 42, 0.22, 'sine', 0.45 * k); noiseHit(0.18, 700, 0.35 * k); }
    },
    crash: () => {
      shot('landHeavy', { vol: 0.5, rate: 0.9 });
      noiseHit(0.5, 900, 0.5); tone(90, 35, 0.3, 'sine', 0.5); tone(80, 30, 0.25, 'sine', 0.35, 0.28); noiseHit(0.35, 600, 0.3, 0.3); noiseHit(0.6, 1500, 0.18, 0.55, 'bandpass');
    },
    door: (o) => { if (!shot('door', { vol: 0.22, rate: o && o.shut ? 0.88 : 1, pan: (o && o.pan) || 0 })) { noiseHit(0.4, 700, 0.15, 0, 'bandpass'); tone(110, 80, 0.15, 'sine', 0.25, 0.55); } },
    clack: (o) => clack((o && o.vol) || 0.5),
    count: () => tone(660, 660, 0.14, 'triangle', 0.22),
    go: () => tone(990, 990, 0.38, 'triangle', 0.28),
    gate: () => tone(1320, 1500, 0.09, 'triangle', 0.12),
    miss: () => tone(180, 150, 0.25, 'square', 0.08),
    finish: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.35, 'triangle', 0.18, i * 0.11)); },
    click: () => tone(1800, 1600, 0.03, 'square', 0.04),
    avalanche: (o) => { const k = clamp((o && o.near) || 0.6, 0.25, 1); noiseHit(0.12, 2600, 0.5 * k, 0, 'highpass'); tone(70, 28, 0.9, 'sine', 0.6 * k, 0.05); noiseHit(1.4, 220, 0.6 * k, 0.08); },
  };

  return {
    isMuted: () => muted,
    isMusicOn: () => musicOn,
    setMusic,
    /** The picker / the menus are up (true) or a ride is on (false): the menu music follows. Cheap enough to call every few frames. */
    scene(menu) { const m = !!menu; if (m === wantMenu && !(m && musicOn && !musicSrc && musicState === 'idle')) return; wantMenu = m; syncMusic(); },
    /** Tests: the avalanche rumble's target level (0..1) of the last update. */
    get rumble() { return last.rumble; },
    /** Tests / flows: what the sound engine is doing. */
    debug: () => ({ state: ctx ? ctx.state : 'none', muted, ready: !!(layers && layers.ready), bank: !!bank, music: { on: musicOn, state: musicState, playing: !!musicSrc, level: musicG ? musicG.gain.value : 0, menu: wantMenu }, last: { ...last } }),
    /** Tests: the context (an offline one in the render script). */
    get context() { return ctx; },
    setMuted,
    resume: ensure,
    event(name, opts) { if (!ctx || muted) return; const fn = EVENTS[name]; if (fn) { try { fn(opts); } catch (error) { console.warn('[ski] sound event failed', name, error); } } },
    /**
     * f = { riding, paused, speed (m/s), edge (-1..1), slip, brake, grounded, piste (0..1 under the skis), lift (m to the nearest lift
     * part, or Infinity), station (m to the nearest lift station, or Infinity), village (0..1 houses near), forest (0..1), altitude (m),
     * weather ('sun'|'cloudy'|'snow'|'fog'), time ('morning'|'midday'|'evening'), dt }
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
      set(L.scrapeG.gain, scrape * 0.28 * (0.5 + 0.5 * piste));
      set(L.scrapeBp.frequency, (700 + 500 * smooth(2, 18, v)) * (0.65 + 0.55 * piste));      // hard groomed snow rings higher than off-piste
      L.am.frequency.setTargetAtTime(18 + v * 1.6, ctx.currentTime, 0.1);
      set(L.glideG.gain, sp * 0.08 * (1 - carve * 0.6));
      // lift: the line drones within ~150 m; a station (<~90 m) adds the bull wheel's machinery, a crowd and the chairs clacking over the sheaves
      const liftK = Number.isFinite(f.lift) ? clamp(1 - f.lift / 160, 0, 1) : 0;
      const stK = Number.isFinite(f.station) ? clamp(1 - f.station / 90, 0, 1) : 0;
      set(L.humG.gain, liftK * liftK * 0.16, 0.3);
      set(L.machG.gain, stK * stK * 0.2, 0.3);
      set(L.stationG.gain, stK * stK * 0.07, 0.5);
      const now = ctx.currentTime;
      if (stK > 0.2 && now > clackAt) { clackAt = now + 1.1 + Math.random() * 1.7; clack(0.35 * stK); }
      else if (liftK > 0.5 && now > clackAt) { clackAt = now + 1.6 + Math.random() * 2.5; clack(0.18 * liftK); }
      // ambience: village murmur near houses, birds by the time of day in fair weather (the chough on the high slopes)
      set(L.villG.gain, clamp(f.village || 0, 0, 1) * 0.06, 0.8);
      const alt = f.altitude || 0, fair = f.weather === 'sun' || f.weather === 'cloudy';
      const birdy = alt < 2200 && fair ? clamp((f.forest || 0) * 1.5 + (f.village || 0), 0, 1) : alt >= 1700 && alt < 3000 && f.weather === 'sun' ? 0.2 : 0;
      if (birdy > 0.15 && now > birdAt) {
        const plan = BIRD_PLANS[f.time] || BIRD_PLANS.midday;
        birdAt = now + (plan.gap[0] + Math.random() * (plan.gap[1] - plan.gap[0])) / birdy;
        bird(f);
      }
      last.liftNear = liftK; last.stationNear = stK;
      // the avalanche: f.avalanche = 0..1 (avalanche.js loudness: how much flows, how near)
      const av = clamp(f.avalanche || 0, 0, 1);
      set(L.rumG.gain, av * 0.9, 0.25);
      set(L.rumLp.frequency, 110 + 160 * av, 0.4);
      set(L.subG.gain, av * av * 0.35, 0.3);
      last.rumble = av;
    },
  };
}
