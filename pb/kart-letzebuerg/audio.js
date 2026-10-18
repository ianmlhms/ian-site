/* Kart Lëtzebuerg — all sound is generated with WebAudio (original, no samples). The context starts on the first user gesture. */
(function () {
  'use strict';
  const KL = window.KL;
  const { clamp } = KL;

  KL.Audio = class GameAudio {
    constructor() { this.ctx = null; this.muted = false; this.master = null; this.eng = null; this.last = {}; }
    start() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      try { this.ctx = new C(); } catch (e) { return; }
      const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.55; this.master.connect(c.destination);
      // noise buffer
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      // engine
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 1.2;
      const eg = c.createGain(); eg.gain.value = 0; lp.connect(eg); eg.connect(this.master);
      const o1 = c.createOscillator(), o2 = c.createOscillator(), g2 = c.createGain(); o1.type = 'sawtooth'; o2.type = 'square'; g2.gain.value = 0.35;
      o1.connect(lp); o2.connect(g2); g2.connect(lp); o1.start(); o2.start();
      this.eng = { o1, o2, lp, eg };
      // drift screech
      const n = c.createBufferSource(); n.buffer = buf; n.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 3.2;
      const sg = c.createGain(); sg.gain.value = 0; n.connect(bp); bp.connect(sg); sg.connect(this.master); n.start();
      this.screech = { bp, sg };
      // wind / rain bed
      const n2 = c.createBufferSource(); n2.buffer = buf; n2.loop = true; const lp2 = c.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 900;
      const wg = c.createGain(); wg.gain.value = 0; n2.connect(lp2); lp2.connect(wg); wg.connect(this.master); n2.start(); this.wind = { wg, lp2 };
    }
    setMuted(m) { this.muted = !!m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.02); }
    /* continuous sounds, called every frame */
    update(k, opts) {
      if (!this.ctx || !k) return;
      const c = this.ctx, t = c.currentTime;
      const sp = k.speed, f = 48 + sp * 5.2 + (k.boostT > 0 ? 22 : 0) + (k.grounded ? 0 : 14);
      this.eng.o1.frequency.setTargetAtTime(f, t, 0.05); this.eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
      this.eng.lp.frequency.setTargetAtTime(380 + sp * 38 + (k.boostT > 0 ? 500 : 0), t, 0.08);
      const run = opts && opts.racing ? 1 : 0.6;
      this.eng.eg.gain.setTargetAtTime((0.05 + clamp(sp / 31, 0, 1) * 0.1) * run * (opts && opts.paused ? 0 : 1), t, 0.06);
      const drifting = k.drift.state === 2 && k.grounded;
      this.screech.sg.gain.setTargetAtTime((drifting ? 0.07 + k.drift.level * 0.015 : (k.surf === 1 && sp > 8 && k.grounded ? 0.03 : 0)) * (opts && opts.paused ? 0 : 1), t, 0.05);
      this.screech.bp.frequency.setTargetAtTime(drifting ? 1500 + k.drift.charge * 220 : 700, t, 0.1);
      const w = opts && opts.rain ? 0.05 : clamp(sp / 41, 0, 1) * 0.025;
      this.wind.wg.gain.setTargetAtTime(w * (opts && opts.paused ? 0 : 1), t, 0.2); this.wind.lp2.frequency.setTargetAtTime(opts && opts.rain ? 3500 : 500 + sp * 20, t, 0.2);
    }
    silence() { if (!this.ctx) return; const t = this.ctx.currentTime; this.eng.eg.gain.setTargetAtTime(0, t, 0.05); this.screech.sg.gain.setTargetAtTime(0, t, 0.05); this.wind.wg.gain.setTargetAtTime(0, t, 0.05); }
    tone(freq, dur, type, vol, slide, delay) {
      if (!this.ctx || this.muted) return;
      const c = this.ctx, t = c.currentTime + (delay || 0), o = c.createOscillator(), g = c.createGain();
      o.type = type || 'triangle'; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    }
    noise(dur, f0, f1, vol, type, delay) {
      if (!this.ctx || this.muted) return;
      const c = this.ctx, t = c.currentTime + (delay || 0), s = c.createBufferSource(); s.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
      const g = c.createGain(); g.gain.setValueAtTime(vol || 0.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
    }
    throttle(name, gap) { const n = performance.now(); if (this.last[name] && n - this.last[name] < gap) return false; this.last[name] = n; return true; }
    /* one-shot effects; `near` is true when the event concerns the player (louder) */
    sfx(name, p) {
      if (!this.ctx) return;
      const v = p && p.near === false ? 0.45 : 1;
      switch (name) {
        case 'beep': this.tone(p && p.high ? 880 : 440, p && p.high ? 0.5 : 0.22, 'square', 0.16); break;
        case 'box': this.tone(660, 0.1, 'triangle', 0.14 * v); this.tone(880, 0.1, 'triangle', 0.14 * v, 0, 0.07); this.tone(1320, 0.16, 'triangle', 0.12 * v, 0, 0.14); break;
        case 'itemget': this.tone(523, 0.08, 'square', 0.1); this.tone(784, 0.14, 'square', 0.1, 0, 0.08); break;
        case 'roll': if (this.throttle('roll', 70)) this.tone(500 + Math.random() * 500, 0.05, 'square', 0.05); break;
        case 'shoot': this.noise(0.28, 2800, 300, 0.2 * v, 'bandpass'); this.tone(300, 0.2, 'sawtooth', 0.07 * v, 0.4); break;
        case 'drop': this.tone(180, 0.18, 'sine', 0.2 * v, 0.5); this.noise(0.12, 900, 300, 0.1 * v); break;
        case 'boost': case 'pad': this.noise(0.7, 400, 3500, 0.22 * v, 'bandpass'); this.tone(220, 0.5, 'sawtooth', 0.09 * v, 3); break;
        case 'miniturbo': this.noise(0.55, 600, 4000, 0.2 * v, 'bandpass'); this.tone(330 * (1 + 0.25 * (p.level || 1)), 0.3, 'square', 0.07 * v, 1.8); break;
        case 'driftlevel': this.tone(700 + 250 * (p.level || 1), 0.09, 'square', 0.08); break;
        case 'hit': this.noise(0.4, 1600, 120, 0.35 * v); this.tone(380, 0.5, 'sawtooth', 0.14 * v, 0.2); break;
        case 'boom': this.noise(0.8, 2500, 80, 0.5 * v); this.tone(110, 0.6, 'sine', 0.3 * v, 0.3); break;
        case 'bump': if (this.throttle('bump', 120)) { this.noise(0.12, 900, 200, 0.2 * v); this.tone(150, 0.1, 'square', 0.08 * v, 0.5); } break;
        case 'wall': if (this.throttle('wall', 160)) this.noise(0.18, 1400, 250, 0.22 * v, 'lowpass'); break;
        case 'land': this.noise(0.15, 700, 120, 0.2 * v); break;
        case 'shield': this.tone(500, 0.4, 'sine', 0.12, 2); this.tone(750, 0.4, 'sine', 0.1, 2, 0.06); break;
        case 'shieldpop': this.noise(0.25, 3000, 600, 0.2 * v, 'highpass'); this.tone(900, 0.2, 'square', 0.08 * v, 0.3); break;
        case 'comet': this.tone(900, 1.4, 'sawtooth', 0.1, 0.25); this.noise(1.2, 3000, 200, 0.18, 'bandpass'); break;
        case 'go': this.tone(880, 0.55, 'square', 0.18); this.tone(1320, 0.55, 'square', 0.1); break;
        case 'lap': this.tone(660, 0.12, 'triangle', 0.14); this.tone(880, 0.12, 'triangle', 0.14, 0, 0.1); this.tone(1100, 0.2, 'triangle', 0.14, 0, 0.2); break;
        case 'finish': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.16, 0, i * 0.13)); break;
        case 'rescue': this.tone(600, 0.3, 'sine', 0.1, 0.4); break;
        case 'click': this.tone(520, 0.05, 'square', 0.06); break;
        case 'rocketstart': this.noise(0.6, 500, 3000, 0.25, 'bandpass'); break;
      }
    }
  };
})();
