// Schueberfouer Tycoon: the handful of tiny UI sounds (coin, build, upgrade, star, error). W6 folded this into audio.js: the AudioContext, the master
// gain / limiter and the mute switches (the arcade's `pb_muted`, the game's own `pb_fouer_sound`) live there, so the blips share the one context with
// the fair soundscape. Without an audio engine (tests, old callers) a tiny private one is created, as in W5.
import { createAudio } from "./audio.js";

export function createSfx(audio = null) {
  const engine = audio ?? createAudio();
  let lastCoin = 0;
  const tone = (freq, at, length, opts = {}) => engine.tone(freq, at, length, { type: "sine", gain: 0.5, slide: 0, ...opts });
  return {
    get enabled() { return engine.enabled; },
    setEnabled: on => engine.setEnabled(on),
    /** call from a user gesture so iOS lets the context start */
    unlock: () => engine.unlock(),
    click() { tone(520, 0, 0.06, { type: "triangle", gain: 0.25 }); },
    coin() { const now = performance.now(); if (now - lastCoin < 140) return; lastCoin = now; tone(1318, 0, 0.09, { type: "square", gain: 0.12 }); tone(1760, 0.07, 0.16, { type: "square", gain: 0.1 }); },
    build() { tone(196, 0, 0.12, { type: "triangle", gain: 0.5, slide: 0.6 }); tone(392, 0.1, 0.1, { type: "triangle", gain: 0.4 }); tone(523, 0.19, 0.1, { type: "triangle", gain: 0.4 }); tone(784, 0.28, 0.28, { type: "triangle", gain: 0.45 }); },
    upgrade() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.2, { type: "triangle", gain: 0.4 })); },
    star() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.09, 0.32, { type: "triangle", gain: 0.42 })); },
    error() { tone(160, 0, 0.18, { type: "sawtooth", gain: 0.25, slide: 0.7 }); },
  };
}
