/* Controls of Lux Drive. Keyboard (WASD / arrows, Space = the handbrake, R = back to the start, C = camera, T = time, G = weather, M = sound, Esc = the menu),
 * touch (a steering pad under the left thumb; the brake and the throttle under the right one, together under 15 % of the screen) and the first gamepad.
 * Produces { throttle, brake, steer, handbrake } each frame.
 * Adapted from the MTB engine (pb/mtb/input.js): a car has no jump and no separate brake pedals. */
const KEYS = {
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], handbrake: ['Space'],
};
const ACTION_KEYS = { KeyR: 'reset', KeyC: 'camera', KeyT: 'time', KeyG: 'weather', KeyM: 'sound', Escape: 'menu', KeyP: 'menu', KeyH: 'help', Enter: 'confirm' };
const STEER_PAD_RADIUS = 70;           // px of travel for full steering
const STICK_DEADZONE = 0.14;

export function createInput({ root, onAction, labels = {} }) {
  const down = new Set();
  const pointers = new Map();
  let usedTouch = false;
  let usedKeyboard = false;
  const state = { throttle: 0, brake: 0, steer: 0, handbrake: false, source: 'none' };

  const onKey = (e, isDown) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    const code = e.code;
    if (Object.values(KEYS).some((list) => list.includes(code))) { e.preventDefault(); usedKeyboard = true; }
    if (isDown) { if (!down.has(code)) { down.add(code); if (ACTION_KEYS[code]) onAction(ACTION_KEYS[code], e); } } else down.delete(code);
  };
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => down.clear());

  // ---- the touch overlay: the steering pad on the left, the pedals on the right
  const ui = document.createElement('div');
  ui.id = 'touchControls';
  ui.innerHTML = `
    <div class="pad" data-pad="steer"><div class="knob"></div><span class="lbl">◀ ▶</span></div>
    <div class="btns">
      <button type="button" class="tbtn" data-btn="handbrake" aria-label="${labels.handbrake || 'Handbrake'}">⊘<small>${labels.handbrake || ''}</small></button>
      <button type="button" class="tbtn" data-btn="brake" aria-label="${labels.brake || 'Brake'}">■<small>${labels.brake || ''}</small></button>
      <button type="button" class="tbtn big" data-btn="throttle" aria-label="${labels.throttle || 'Accelerate'}">▶▶<small>${labels.throttle || ''}</small></button>
    </div>`;
  root.appendChild(ui);
  const pad = ui.querySelector('.pad'), knob = ui.querySelector('.knob');
  const bindPointer = (el, kind) => {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (error) { /* a synthetic pointer (the tests) needs no capture */ } pointers.set(e.pointerId, { kind, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY }); usedTouch = true; el.classList.add('on'); });
    const move = (e) => { const p = pointers.get(e.pointerId); if (p) { p.x = e.clientX; p.y = e.clientY; } };
    const up = (e) => { pointers.delete(e.pointerId); el.classList.remove('on'); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  };
  bindPointer(pad, 'steer');
  for (const b of ui.querySelectorAll('.tbtn')) bindPointer(b, b.dataset.btn);

  function readTouch() {
    let steer = 0, throttle = 0, brake = 0, handbrake = false;
    for (const p of pointers.values()) {
      if (p.kind === 'steer') steer = Math.max(-1, Math.min(1, (p.x - p.x0) / STEER_PAD_RADIUS));
      else if (p.kind === 'throttle') throttle = 1;
      else if (p.kind === 'brake') brake = 1;
      else if (p.kind === 'handbrake') handbrake = true;
    }
    knob.style.transform = `translateX(${steer * 46}px)`;
    return { steer, throttle, brake, handbrake };
  }

  function readPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const g = pads && [...pads].find((p) => p && p.connected);
    if (!g) return null;
    const ax = Math.abs(g.axes[0]) > STICK_DEADZONE ? g.axes[0] : 0;
    return { steer: ax, throttle: g.buttons[7]?.value || (g.buttons[0]?.pressed ? 1 : 0), brake: g.buttons[6]?.value || 0, handbrake: !!g.buttons[1]?.pressed };
  }

  const isHeld = (k) => KEYS[k].some((c) => down.has(c));
  return {
    state, ui,
    /** Call once per frame. A scripted override (the flows, the harness) can replace the whole input with `override`. */
    read(override) {
      if (override) { Object.assign(state, override, { source: 'script' }); return state; }
      const t = readTouch(), p = readPad();
      const kThrottle = isHeld('throttle') ? 1 : 0, kBrake = isHeld('brake') ? 1 : 0;
      const kSteer = (isHeld('right') ? 1 : 0) - (isHeld('left') ? 1 : 0);
      state.throttle = Math.max(kThrottle, t.throttle, p ? p.throttle : 0);
      state.brake = Math.max(kBrake, t.brake, p ? p.brake : 0);
      state.steer = Math.abs(t.steer) > Math.abs(kSteer) ? t.steer : (kSteer || (p ? p.steer : 0));
      state.handbrake = isHeld('handbrake') || t.handbrake || (p ? p.handbrake : false);
      state.source = usedTouch ? 'touch' : usedKeyboard ? 'keyboard' : 'none';
      return state;
    },
    isTouch: () => usedTouch,
    anyPress: () => down.size > 0 || pointers.size > 0,
    setLabels(l) {
      ui.querySelector('[data-btn="handbrake"] small').textContent = l.handbrake;
      ui.querySelector('[data-btn="brake"] small').textContent = l.brake;
      ui.querySelector('[data-btn="throttle"] small').textContent = l.throttle;
    },
    showTouchUi(v) { ui.hidden = !v; },
  };
}
