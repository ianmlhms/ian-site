/* Ride sounds on top of audio.js (same AudioContext, same sfx bus, same mute): a speed-driven bed (machinery hum + air rush) and one-shots (whoosh, thud,
 * bump, splash, scream, door bang, scare sting, electric crackle, chain clank). The attraction's own organ / beat / rattle voices keep playing through
 * audio.js's positional voices (the camera sits on the ride, so they are loud and right). Everything is procedural; every call is a no-op when muted. */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createRideSound(audio) {
  let noise = null, noiseCtx = null, bed = null, mus = null;
  const ctx = () => (audio && !audio.muted ? audio.context : null);
  const out = c => audio.sfxBus || c.destination;
  function noiseBuf(c) {
    if (noise && noiseCtx === c) return noise;
    const len = Math.floor(c.sampleRate * 2), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noise = buf; noiseCtx = c; return buf;
  }
  function burst(c, t, { f = 1500, q = 1, type = "bandpass", peak = 0.5, dur = 0.2, attack = 0.005, slideTo = null } = {}) {
    const s = c.createBufferSource(); s.buffer = noiseBuf(c); s.loop = true;
    const flt = c.createBiquadFilter(), g = c.createGain();
    flt.type = type; flt.frequency.setValueAtTime(f, t); flt.Q.value = q;
    if (slideTo) flt.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt); flt.connect(g); g.connect(out(c)); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  function tone(c, t, { f = 440, dur = 0.3, type = "sine", peak = 0.2, slideTo = null, attack = 0.01 } = {}) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out(c)); o.start(t); o.stop(t + dur + 0.05);
  }
  const guard = fn => (...args) => { const c = ctx(); if (!c) return; try { fn(c, c.currentTime + 0.005, ...args); } catch (error) { console.warn("[fouer] ride sound failed", error.message); } };

  const api = {
    /** start the bed: kind picks the hum pitch (the machine) */
    startBed: guard((c, t, kind = "hum") => {
      api.stopBed();
      const pitch = { carousel: 62, swing: 55, curve: 80, boats: 58, dance: 70, tower: 48, drop: 40, arm: 52, coaster: 90, flume: 45, ghost: 38, scooter: 120 }[kind] ?? 60;
      const o = c.createOscillator(), o2 = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
      o.type = "sawtooth"; o2.type = "square"; o.frequency.value = pitch; o2.frequency.value = pitch * 1.5; lp.type = "lowpass"; lp.frequency.value = 260;
      g.gain.value = 0; o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(out(c)); o.start(t); o2.start(t);
      const s = c.createBufferSource(); s.buffer = noiseBuf(c); s.loop = true;
      const bp = c.createBiquadFilter(), ag = c.createGain(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 0.7; ag.gain.value = 0;
      s.connect(bp); bp.connect(ag); ag.connect(out(c)); s.start(t, Math.random());
      bed = { o, o2, lp, g, s, bp, ag, pitch, c };
    }),
    /** speed01 0..1 (how fast the machine goes), air01 0..1 (the rush of air) */
    setBed(speed01, air01) {
      if (!bed || !ctx()) return;
      const c = bed.c, t = c.currentTime;
      bed.g.gain.setTargetAtTime(0.012 + 0.05 * clamp(speed01, 0, 1), t, 0.2);
      bed.o.frequency.setTargetAtTime(bed.pitch * (0.7 + 0.8 * clamp(speed01, 0, 1)), t, 0.25); bed.o2.frequency.setTargetAtTime(bed.pitch * 1.5 * (0.7 + 0.8 * clamp(speed01, 0, 1)), t, 0.25);
      bed.ag.gain.setTargetAtTime(0.5 * clamp(air01, 0, 1) ** 1.5, t, 0.25); bed.bp.frequency.setTargetAtTime(500 + 1800 * clamp(air01, 0, 1), t, 0.25);
    },
    stopBed() {
      if (!bed) return;
      const b = bed; bed = null;
      try { const t = b.c.currentTime; b.g.gain.setTargetAtTime(0, t, 0.1); b.ag.gain.setTargetAtTime(0, t, 0.1); setTimeout(() => { try { b.o.stop(); b.o2.stop(); b.s.stop(); } catch (error) { /* already stopped */ } }, 600); } catch (error) { /* context gone */ }
    },
    whoosh: guard((c, t, dur = 1.3, power = 1) => { burst(c, t, { f: 300, q: 0.9, peak: 0.55 * power, dur, attack: dur * 0.5, slideTo: 3200 }); burst(c, t + dur * 0.3, { f: 900, q: 0.5, type: "highpass", peak: 0.25 * power, dur: dur * 0.9, attack: dur * 0.3 }); }),
    thud: guard((c, t, power = 1) => { tone(c, t, { f: 120, slideTo: 38, dur: 0.45, peak: 0.7 * power, type: "sine" }); burst(c, t, { f: 260, q: 0.8, type: "lowpass", peak: 0.7 * power, dur: 0.3 }); }),
    bump: guard((c, t, power = 0.7) => { tone(c, t, { f: 170, slideTo: 60, dur: 0.22, peak: 0.55 * power, type: "triangle" }); burst(c, t, { f: 1200, q: 1.1, peak: 0.45 * power, dur: 0.09 }); tone(c, t + 0.02, { f: 520, slideTo: 330, dur: 0.12, peak: 0.12 * power, type: "square" }); }),
    splash: guard((c, t, power = 1) => { burst(c, t, { f: 1800, q: 0.5, type: "lowpass", peak: 0.9 * power, dur: 1.4, attack: 0.03, slideTo: 380 }); burst(c, t + 0.05, { f: 4200, q: 0.7, type: "highpass", peak: 0.5 * power, dur: 0.8 }); for (let i = 0; i < 6; i++) tone(c, t + 0.1 + Math.random() * 0.7, { f: 500 + Math.random() * 600, slideTo: 1400 + Math.random() * 900, dur: 0.08, peak: 0.07, type: "sine" }); }),
    scream: guard((c, t, dur = 1.4, peak = 0.18, base = 880) => {
      [1, 1.51].forEach((k, i) => {
        const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
        f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 3; o.type = i ? "triangle" : "sawtooth";
        o.frequency.setValueAtTime(base * k, t); o.frequency.linearRampToValueAtTime(base * k * 1.7, t + dur * 0.55); o.frequency.linearRampToValueAtTime(base * k * 1.35, t + dur);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak * (i ? 0.6 : 1), t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(f); f.connect(g); g.connect(out(c)); o.start(t); o.stop(t + dur + 0.05);
      });
    }),
    bang: guard((c, t, power = 1) => { burst(c, t, { f: 420, q: 0.7, peak: 0.9 * power, dur: 0.22 }); tone(c, t, { f: 95, slideTo: 40, dur: 0.5, peak: 0.6 * power, type: "triangle" }); burst(c, t + 0.1, { f: 2400, q: 1.5, peak: 0.25 * power, dur: 0.15 }); }),
    creak: guard((c, t, dur = 0.9) => { tone(c, t, { f: 180, slideTo: 420, dur, peak: 0.12, type: "sawtooth", attack: dur * 0.4 }); tone(c, t + 0.05, { f: 188, slideTo: 380, dur, peak: 0.08, type: "square", attack: dur * 0.4 }); }),
    sting: guard((c, t, power = 1) => { [523, 554, 740, 1109].forEach((f, i) => tone(c, t + i * 0.012, { f, slideTo: f * 0.94, dur: 0.9, peak: 0.16 * power, type: "sawtooth", attack: 0.004 })); burst(c, t, { f: 3000, q: 0.8, peak: 0.4 * power, dur: 0.25 }); }),
    zap: guard((c, t, power = 1) => { for (let i = 0; i < 5; i++) burst(c, t + i * 0.025, { f: 3800 + Math.random() * 2500, q: 2, type: "bandpass", peak: 0.3 * power, dur: 0.05 }); tone(c, t, { f: 1700, slideTo: 300, dur: 0.18, peak: 0.1 * power, type: "square" }); }),
    clank: guard((c, t, power = 1) => { burst(c, t, { f: 1100, q: 4, peak: 0.45 * power, dur: 0.07 }); tone(c, t, { f: 240, slideTo: 150, dur: 0.12, peak: 0.2 * power, type: "triangle" }); }),
    bell: guard((c, t) => { [[1, 0.3], [2.76, 0.16], [5.4, 0.08]].forEach(([r, a]) => tone(c, t, { f: 980 * r, dur: 1.2, peak: a, attack: 0.002 })); }),
    horn: guard((c, t) => { tone(c, t, { f: 330, dur: 0.35, peak: 0.12, type: "square", attack: 0.02 }); tone(c, t + 0.02, { f: 415, dur: 0.35, peak: 0.1, type: "square", attack: 0.02 }); }),
    /** a fairground dance loop (kick, clap, hats, bass, arp; 126 bpm, Am F C G) scheduled a quarter second ahead: call tickMusic() every frame */
    startMusic: guard((c, t) => { mus = { next: t + 0.05, step: 0 }; }),
    stopMusic() { mus = null; },
    tickMusic() {
      const c = ctx(); if (!mus || !c) return;
      if (mus.next < c.currentTime - 0.4) mus.next = c.currentTime + 0.02;
      const dur = 60 / 126 / 4;
      while (mus.next < c.currentTime + 0.25) {
        const t = mus.next, k = mus.step % 16, bar = Math.floor(mus.step / 16) % 4, root = [55, 43.65, 65.41, 49][bar];
        try {
          if (k % 4 === 0) { tone(c, t, { f: 150, slideTo: 42, dur: 0.22, peak: 0.5, type: "sine", attack: 0.003 }); }
          if (k === 4 || k === 12) burst(c, t, { f: 1500, q: 0.8, peak: 0.2, dur: 0.12 });
          if (k % 2 === 1 || k % 4 === 2) burst(c, t, { f: 7000, q: 1, type: "highpass", peak: 0.07, dur: 0.04 });
          if (k % 4 !== 0) tone(c, t, { f: root * [1, 1, 2, 1, 1.5, 1, 2, 1][k % 8], dur: dur * 0.9, peak: 0.12, type: "sawtooth", attack: 0.004 });
          if (k % 2 === 0) tone(c, t, { f: root * 4 * [1, 1.2, 1.5, 2, 1.5, 1.2, 1, 0.75][(k / 2) % 8], dur: dur * 1.6, peak: 0.035, type: "square", attack: 0.004 });
        } catch (error) { mus = null; return; }
        mus.next += dur; mus.step++;
      }
    },
    dispose() { api.stopBed(); api.stopMusic(); },
  };
  return api;
}
