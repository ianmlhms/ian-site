/* Burger-Restaurant sounds: a few short synthesized blips (no files). Follows the arcade mute (Arcade.onMute), starts only
 * after the first tap (browsers block audio before) and stays silent while the page is hidden. The coin sound on a sale
 * comes from the arcade itself (it blips when the score rises), so it is not doubled here. */
const SOUNDS = Object.freeze({
  start:[{f:180, d:0.07, type:"triangle", v:0.08}],
  ready:[{f:880, d:0.08, v:0.06}, {f:1175, d:0.12, at:0.08, v:0.06}],
  board:[{f:420, d:0.06, type:"triangle", v:0.09}],
  tray:[{f:520, d:0.05, v:0.06}, {f:780, d:0.07, at:0.05, v:0.06}],
  topping:[{f:640, d:0.04, type:"triangle", v:0.06}],
  toss:[{f:240, d:0.12, type:"sawtooth", v:0.04, to:120}],
  burnt:[{f:150, d:0.25, type:"sawtooth", v:0.05, to:90}],
  refused:[{f:200, d:0.09, type:"square", v:0.03}],
  walkout:[{f:392, d:0.12, v:0.06}, {f:262, d:0.2, at:0.12, v:0.06}],
  boost:[{f:330, d:0.25, type:"sawtooth", v:0.04, to:990}],
  dayEnd:[{f:523, d:0.1, v:0.07}, {f:659, d:0.1, at:0.1, v:0.07}, {f:784, d:0.22, at:0.2, v:0.07}],
});

export function createAudio() {
  let context = null;
  let isMuted = false;

  const unlock = () => {
    try {
      if (!context) context = new (window.AudioContext || window.webkitAudioContext)();
      if (context.state === "suspended") context.resume();
    } catch (error) {
      console.warn("[Burger] audio unavailable", error);
    }
  };
  document.addEventListener("pointerdown", unlock, {capture:true});
  document.addEventListener("keydown", unlock, {capture:true});
  if (window.Arcade?.onMute) window.Arcade.onMute((muted) => { isMuted = !!muted; });

  function play(name) {
    const notes = SOUNDS[name];
    if (!notes || isMuted || !context || context.state !== "running" || document.hidden) return;
    const now = context.currentTime;
    notes.forEach(({f, d, at = 0, type = "sine", v = 0.06, to}) => {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f, now + at);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, now + at + d);
      gain.gain.setValueAtTime(v, now + at);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + d);
      osc.connect(gain).connect(context.destination);
      osc.start(now + at);
      osc.stop(now + at + d + 0.02);
    });
  }

  return {play, isMuted:() => isMuted};
}
