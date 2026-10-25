/* Controls. Keyboard (WASD / arrows, S = both brakes, Q = rear, E = front, Space = crouch / pop / pump, R back on the trail, C camera, T time, G weather, V season, M sound, Esc menu),
 * touch (a steering pad under the left thumb; brake, jump and a big pedal button under the right one, together under 15 % of the screen) and the first gamepad.
 * Produces { throttle, brake, brakeF, brakeR, steer, jump } each frame (brakeF / brakeR are always set: one blended brake input is split like the physics expects). */
import { PLAY } from './config.js';

const KEYS = {
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], brakeR: ['KeyQ'], brakeF: ['KeyE'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], jump: ['Space'],
};
const ACTION_KEYS = { KeyR: 'reset', KeyC: 'camera', KeyT: 'time', KeyG: 'weather', KeyV: 'season', KeyM: 'sound', Escape: 'menu', KeyP: 'menu', KeyH: 'help', Enter: 'confirm' };
const STEER_PAD_RADIUS = 70;           // px of travel for full steering
const STICK_DEADZONE = 0.14;

export function createInput({ root, onAction, labels = {} }) {
  const down = new Set();
  const pointers = new Map();
  let usedTouch = false;
  let usedKeyboard = false;
  const state = { throttle: 0, brake: 0, brakeF: 0, brakeR: 0, steer: 0, jump: false, source: 'none' };

  const onKey = (e, isDown) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    const code = e.code;
    if (Object.values(KEYS).some((list) => list.includes(code))) { if (code !== 'Space' || !(e.target && e.target.tagName === 'BUTTON')) e.preventDefault(); usedKeyboard = true; }
    if (isDown) { if (!down.has(code)) { down.add(code); if (ACTION_KEYS[code]) onAction(ACTION_KEYS[code], e); } } else down.delete(code);
  };
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => down.clear());

  // ---- touch overlay
  const ui = document.createElement('div');
  ui.id = 'touchControls';
  ui.innerHTML = `
    <div class="pad" data-pad="steer"><div class="knob"></div><span class="lbl">◀ ▶</span></div>
    <div class="btns">
      <button type="button" class="tbtn" data-btn="jump" aria-label="${labels.jump || 'Jump'}">⤒<small>${labels.jump || ''}</small></button>
      <button type="button" class="tbtn" data-btn="brake" aria-label="${labels.brake || 'Brake'}">■<small>${labels.brake || ''}</small></button>
      <button type="button" class="tbtn big" data-btn="throttle" aria-label="${labels.pedal || 'Pedal'}">▶▶<small>${labels.pedal || ''}</small></button>
    </div>`;
  root.appendChild(ui);
  const pad = ui.querySelector('.pad'), knob = ui.querySelector('.knob');
  const bindPointer = (el, kind) => {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (error) { /* synthetic pointer (tests): no capture needed */ } pointers.set(e.pointerId, { kind, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY }); usedTouch = true; el.classList.add('on'); });
    const move = (e) => { const p = pointers.get(e.pointerId); if (p) { p.x = e.clientX; p.y = e.clientY; } };
    const up = (e) => { pointers.delete(e.pointerId); el.classList.remove('on'); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  };
  bindPointer(pad, 'steer');
  for (const b of ui.querySelectorAll('.tbtn')) bindPointer(b, b.dataset.btn);

  function readTouch() {
    let steer = 0, throttle = 0, brake = 0, jump = false;
    for (const p of pointers.values()) {
      if (p.kind === 'steer') steer = Math.max(-1, Math.min(1, (p.x - p.x0) / STEER_PAD_RADIUS));
      else if (p.kind === 'throttle') throttle = 1;
      else if (p.kind === 'brake') brake = 1;
      else if (p.kind === 'jump') jump = true;
    }
    knob.style.transform = `translateX(${steer * 46}px)`;
    return { steer, throttle, brake, jump };
  }

  function readPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const g = pads && [...pads].find((p) => p && p.connected);
    if (!g) return null;
    const ax = Math.abs(g.axes[0]) > STICK_DEADZONE ? g.axes[0] : 0;
    return { steer: ax, throttle: g.buttons[7]?.value || (g.buttons[0]?.pressed ? 1 : 0), brakeF: g.buttons[6]?.value || 0, brakeR: g.buttons[1]?.pressed ? 1 : 0, jump: !!g.buttons[2]?.pressed };
  }

  const isHeld = (k) => KEYS[k].some((c) => down.has(c));
  const bb = PLAY.brakeBlend;
  return {
    state, ui,
    /** Call once per frame. A scripted override (flows, harness) can replace the whole input with `override`. */
    read(override) {
      if (override) { Object.assign(state, override, { source: 'script' }); if (state.brakeF === undefined || state.brakeR === undefined) { const b = state.brake || 0; state.brakeF = b * bb.front; state.brakeR = b * bb.rear; } return state; }
      const t = readTouch(), p = readPad();
      const kThrottle = isHeld('throttle') ? 1 : 0, kBrake = isHeld('brake') ? 1 : 0, kSteer = (isHeld('right') ? 1 : 0) - (isHeld('left') ? 1 : 0);
      const blend = Math.max(kBrake, t.brake);
      state.throttle = Math.max(kThrottle, t.throttle, p ? p.throttle : 0);
      state.brakeF = Math.max(blend * bb.front, isHeld('brakeF') ? 1 : 0, p ? p.brakeF : 0);
      state.brakeR = Math.max(blend * bb.rear, isHeld('brakeR') ? 1 : 0, p ? p.brakeR : 0);
      state.brake = Math.max(blend, state.brakeF, state.brakeR);
      state.steer = Math.abs(t.steer) > Math.abs(kSteer) ? t.steer : (kSteer || (p ? p.steer : 0));
      state.jump = isHeld('jump') || t.jump || (p ? p.jump : false);
      state.source = usedTouch ? 'touch' : usedKeyboard ? 'keyboard' : 'none';
      return state;
    },
    isTouch: () => usedTouch,
    anyPress: () => down.size > 0 || pointers.size > 0,
    setLabels(l) { ui.querySelector('[data-btn="jump"] small').textContent = l.jump; ui.querySelector('[data-btn="brake"] small').textContent = l.brake; ui.querySelector('[data-btn="throttle"] small').textContent = l.pedal; },
    showTouchUi(v) { ui.hidden = !v; },
  };
}
