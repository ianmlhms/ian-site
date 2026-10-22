// Schueberfouer Tycoon W5: a handful of tiny procedural UI sounds (coin, build, upgrade, star). The big procedural soundscape
// (crowd, rides, tram) is W6. The AudioContext is created on the first tap, nothing is downloaded, the arcade's mute
// (localStorage pb_muted) and the game's own switch (pb_fouer_sound) both silence it.
const KEY = "pb_fouer_sound";
const MUTED_KEY = "pb_muted";

function readFlag(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (error) { return fallback; }
}

export function createSfx() {
  let context = null;
  let master = null;
  let enabled = readFlag(KEY, "1") !== "0";
  let lastCoin = 0;
  const muted = () => readFlag(MUTED_KEY, "0") === "1";

  function ensure() {
    if (context || typeof window === "undefined") return context;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      context = new Ctor();
      master = context.createGain(); master.gain.value = 0.22;
      const limiter = context.createDynamicsCompressor();
      master.connect(limiter); limiter.connect(context.destination);
    } catch (error) { console.warn("[fouer] audio unavailable", error.message); context = null; }
    return context;
  }
  function tone(freq, at, length, { type = "sine", gain = 0.5, slide = 0 } = {}) {
    const c = ensure(); if (!c || !enabled || muted()) return;
    if (c.state === "suspended") c.resume().catch(() => {});
    const t0 = c.currentTime + at;
    const osc = c.createOscillator(); const amp = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + length);
    amp.gain.setValueAtTime(0.0001, t0); amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012); amp.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
    osc.connect(amp); amp.connect(master); osc.start(t0); osc.stop(t0 + length + 0.05);
  }
  return {
    get enabled() { return enabled; },
    setEnabled(on) { enabled = Boolean(on); try { localStorage.setItem(KEY, enabled ? "1" : "0"); } catch (error) { /* storage blocked */ } if (enabled) ensure(); },
    /** call from a user gesture so iOS lets the context start */
    unlock() { const c = ensure(); if (c && c.state === "suspended") c.resume().catch(() => {}); },
    click() { tone(520, 0, 0.06, { type: "triangle", gain: 0.25 }); },
    coin() { const now = performance.now(); if (now - lastCoin < 140) return; lastCoin = now; tone(1318, 0, 0.09, { type: "square", gain: 0.12 }); tone(1760, 0.07, 0.16, { type: "square", gain: 0.1 }); },
    build() { tone(196, 0, 0.12, { type: "triangle", gain: 0.5, slide: 0.6 }); tone(392, 0.1, 0.1, { type: "triangle", gain: 0.4 }); tone(523, 0.19, 0.1, { type: "triangle", gain: 0.4 }); tone(784, 0.28, 0.28, { type: "triangle", gain: 0.45 }); },
    upgrade() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.2, { type: "triangle", gain: 0.4 })); },
    star() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.09, 0.32, { type: "triangle", gain: 0.42 })); },
    error() { tone(160, 0, 0.18, { type: "sawtooth", gain: 0.25, slide: 0.7 }); },
  };
}
