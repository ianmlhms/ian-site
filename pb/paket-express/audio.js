/* Audio is constructed only inside an explicit user gesture; every source goes through master. */
(function (P) {
  'use strict';
  P.createAudio = function () {
    const Context = window.AudioContext || window.webkitAudioContext, ctx = new Context(), master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    const engineGain = ctx.createGain(), filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 500; filter.Q.value = .65; engineGain.gain.value = 0; filter.connect(engineGain); engineGain.connect(master);
    const saw = ctx.createOscillator(), square = ctx.createOscillator(), squareGain = ctx.createGain(); saw.type = 'sawtooth'; square.type = 'square'; squareGain.gain.value = .18;
    saw.connect(filter); square.connect(squareGain); squareGain.connect(filter); saw.start(); square.start();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), data = buffer.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(), noiseGain = ctx.createGain(); noise.buffer = buffer; noise.loop = true; noiseGain.gain.value = .16; noise.connect(noiseGain); noiseGain.connect(filter); noise.start();
    const screechFilter = ctx.createBiquadFilter(), screechGain = ctx.createGain(); screechFilter.type = 'bandpass'; screechFilter.frequency.value = 1800; screechFilter.Q.value = 2.7; screechGain.gain.value = 0; noise.connect(screechFilter); screechFilter.connect(screechGain); screechGain.connect(master);
    const hornFilter = ctx.createBiquadFilter(), hornGain = ctx.createGain(); hornFilter.type = 'bandpass'; hornFilter.frequency.value = 700; hornFilter.Q.value = .7; hornGain.gain.value = 0; hornFilter.connect(hornGain); hornGain.connect(master);
    const horns = [ctx.createOscillator(),ctx.createOscillator()]; horns.forEach((o,i) => { o.type = i ? 'sawtooth' : 'square'; o.frequency.value = i ? 498 : 410; o.connect(hornFilter); o.start(); });
    let gear = 1, shiftUntil = 0, held = false;
    function horn(value, spec) { held = value; const deep = spec.id === 'bus' ? .65 : 1; horns[0].frequency.setTargetAtTime(410 * deep,ctx.currentTime,.02); horns[1].frequency.setTargetAtTime(498 * deep,ctx.currentTime,.02); hornGain.gain.setTargetAtTime(value ? .085 : 0,ctx.currentTime,value ? .015 : .055); }
    function chime(frequency = 880, duration = .3, type = 'sine') {
      const o = ctx.createOscillator(), g = ctx.createGain(), time = ctx.currentTime; o.type = type; o.frequency.value = frequency;
      g.gain.setValueAtTime(0,time); g.gain.linearRampToValueAtTime(.12,time + .01); g.gain.exponentialRampToValueAtTime(.001,time + duration); o.connect(g); g.connect(master); o.start(); o.stop(time + duration + .02); o.onended = () => { o.disconnect(); g.disconnect(); };
    }
    function trafficHorn(kind) {
      const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = kind === 'bus' || kind === 'truck' ? 275 : 540;
      g.gain.setValueAtTime(.018,t); g.gain.exponentialRampToValueAtTime(.001,t+.26); o.connect(g);g.connect(master);o.start();o.stop(t+.27);o.onended=()=>{o.disconnect();g.disconnect();};
    }
    function thud() {
      const source = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); source.buffer = buffer; f.type = 'lowpass'; f.frequency.value = 150; g.gain.setValueAtTime(.3,ctx.currentTime); g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime + .18); source.connect(f); f.connect(g); g.connect(master); source.start(); source.stop(ctx.currentTime + .2); source.onended = () => { source.disconnect(); f.disconnect(); g.disconnect(); };
    }
    function update(player, spec, active, muted, drift) {
      master.gain.setTargetAtTime(muted || !active ? 0 : .5,ctx.currentTime,.025);
      const nextGear = Math.max(1,Math.min(5,1 + Math.floor(player.speed / spec.speed * 5)));
      if (nextGear !== gear) { gear = nextGear; shiftUntil = ctx.currentTime + .14; }
      const rev = 48 + (player.speed / spec.speed * 5 - gear + 1) * 85, rpm = Math.max(38, rev) * (spec.id === 'bus' ? .58 : spec.id === 'van' ? .8 : 1) * (ctx.currentTime < shiftUntil ? .78 : 1);
      saw.frequency.setTargetAtTime(rpm,ctx.currentTime,.1); square.frequency.setTargetAtTime(rpm * .502,ctx.currentTime,.1); filter.frequency.setTargetAtTime(320 + rpm * 6,ctx.currentTime,.13);
      engineGain.gain.setTargetAtTime(active ? .014 + Math.min(1,player.speed / 8) * .025 : 0,ctx.currentTime,.08);
      screechGain.gain.setTargetAtTime(player.speed > 5.56 ? Math.min(.085,Math.max(0,(player.tyreSlip || 0)-.065) * .22) : 0,ctx.currentTime,.06);
      if (!active && held) horn(false,spec);
    }
    return { ctx, master, horn, trafficHorn, chime, thud, update, get gear() { return gear; }, get hornHeld() { return held; } };
  };
})(window.PX);
