/* Controls of Lux Drive. Keyboard (WASD / arrows, Space = the handbrake, R = back to the start, C = camera, T = time, G = weather,
 * M = the map, Esc = pause), touch for the iPad in landscape and the first gamepad.
 * Produces { throttle, brake, steer, handbrake } each frame.
 *
 * Touch: the left thumb steers on a wide pad (the wheel follows where the thumb is on the pad: the left third steers left, the
 * right third steers right, in between it is analog), the right thumb works three big pedals: gas, brake, handbrake.  Every
 * control owns its own pointers, so steering and gas work together (multi-touch).  Nothing on the page can scroll or zoom.
 * Adapted from the MTB engine (pb/mtb/input.js): a car has no jump and no separate brake pedals. */
const KEYS = {
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], handbrake: ['Space'],
};
const ACTION_KEYS = { KeyR: 'reset', KeyC: 'camera', KeyT: 'time', KeyG: 'weather', KeyM: 'map', Escape: 'menu', KeyP: 'menu', KeyH: 'help', Enter: 'confirm' };
const STICK_DEADZONE = 0.14;
const PAD_DEADZONE = 0.07;          // share of the half pad width in the middle where the wheel stays straight
const PAD_REACH = 0.82;             // share of the half pad width at which the wheel is at full lock
const PAD_CURVE = 1.35;             // > 1: fine control near the middle, full lock at the edge
const KNOB_TRAVEL = 0.42;           // share of the pad width the knob moves from the middle to the edge

export function createInput({ root, onAction, labels = {} }) {
  const down = new Set();
  const pointers = new Map();
  let usedTouch = false;
  let usedKeyboard = false;
  let blocked = false;               // true while a menu is open: the controls give zero
  const state = { throttle: 0, brake: 0, steer: 0, handbrake: false, source: 'none' };

  const onKey = (e, isDown) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    const code = e.code;
    if (Object.values(KEYS).some((list) => list.includes(code))) { e.preventDefault(); usedKeyboard = true; }
    if (isDown) { if (!down.has(code)) { down.add(code); if (ACTION_KEYS[code]) onAction(ACTION_KEYS[code], e); } } else down.delete(code);
  };
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  const releaseAll = () => { down.clear(); pointers.clear(); for (const node of ui.querySelectorAll('.on')) node.classList.remove('on'); };
  window.addEventListener('blur', () => releaseAll());
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  // ---- the touch overlay: the steering pad on the left, the pedals on the right
  const ui = document.createElement('div');
  ui.id = 'touchControls';
  ui.hidden = true;
  ui.innerHTML = `
    <div class="pad" data-pad="steer" role="group" aria-label="${labels.steer || 'Steer'}">
      <span class="arrow l">◀</span><div class="knob"></div><span class="arrow r">▶</span>
    </div>
    <div class="pedals">
      <button type="button" class="tbtn small" data-btn="handbrake" aria-label="${labels.handbrake || 'Handbrake'}"><i>P</i><small>${labels.handbrake || ''}</small></button>
      <button type="button" class="tbtn" data-btn="brake" aria-label="${labels.brake || 'Brake'}"><i>▮</i><small>${labels.brake || ''}</small></button>
      <button type="button" class="tbtn big" data-btn="throttle" aria-label="${labels.throttle || 'Accelerate'}"><i>▲</i><small>${labels.throttle || ''}</small></button>
    </div>`;
  root.appendChild(ui);
  const pad = ui.querySelector('.pad'), knob = ui.querySelector('.knob');

  const bindPointer = (el, kind) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (error) { /* a synthetic pointer (the tests) needs no capture */ }
      pointers.set(e.pointerId, { kind, x: e.clientX, y: e.clientY, el });
      usedTouch = true;
      el.classList.add('on');
    });
    el.addEventListener('pointermove', (e) => { const p = pointers.get(e.pointerId); if (p) { p.x = e.clientX; p.y = e.clientY; } });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (![...pointers.values()].some((p) => p.el === el)) el.classList.remove('on');
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    // a long press must not open the iOS context menu / selection loupe on a control
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  bindPointer(pad, 'steer');
  for (const b of ui.querySelectorAll('.tbtn')) bindPointer(b, b.dataset.btn);

  /** The wheel from the thumb position on the pad: analog, with a dead zone in the middle and full lock before the edge. */
  function padSteer(p) {
    const r = pad.getBoundingClientRect();
    const half = Math.max(1, r.width / 2);
    const u = (p.x - (r.left + half)) / half;                       // -1 .. 1 across the pad
    const a = Math.max(0, Math.abs(u) - PAD_DEADZONE) / (PAD_REACH - PAD_DEADZONE);
    return Math.sign(u) * Math.min(1, a) ** PAD_CURVE;
  }

  function readTouch() {
    let steer = 0, throttle = 0, brake = 0, handbrake = false;
    for (const p of pointers.values()) {
      if (p.kind === 'steer') steer = padSteer(p);
      else if (p.kind === 'throttle') throttle = 1;
      else if (p.kind === 'brake') brake = 1;
      else if (p.kind === 'handbrake') handbrake = true;
    }
    knob.style.transform = `translate(${steer * KNOB_TRAVEL * pad.clientWidth}px, 0)`;
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
      if (blocked) {
        Object.assign(state, { throttle: 0, brake: 0, steer: 0, handbrake: false });
        return state;
      }
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
    /** While blocked (a menu is open) the controls give zero and every held finger / key is forgotten. */
    setBlocked(v) { blocked = v; if (v) releaseAll(); },
    isTouch: () => usedTouch,
    anyPress: () => down.size > 0 || pointers.size > 0,
    setLabels(l) {
      ui.querySelector('[data-btn="handbrake"] small').textContent = l.handbrake;
      ui.querySelector('[data-btn="brake"] small').textContent = l.brake;
      ui.querySelector('[data-btn="throttle"] small').textContent = l.throttle;
      pad.setAttribute('aria-label', l.steer || 'Steer');
    },
    showTouchUi(v) { ui.hidden = !v; },
  };
}
