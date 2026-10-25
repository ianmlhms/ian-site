/* Controls. Keyboard (WASD / arrows, space = jump, R = back to the trail, C = camera), touch (a steering pad on the left thumb, pedal / brake / jump
 * buttons on the right, small and low so they never cover the trail) and the first gamepad. Produces { throttle, brake, steer, jump } each frame. */

const KEYS = {
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], jump: ['Space'],
};
const STEER_PAD_RADIUS = 70;           // px of travel for full steering
const STICK_DEADZONE = 0.14;

export function createInput({ root, onAction }) {
  const down = new Set();
  const touch = { steer: 0, throttle: 0, brake: 0, jump: false, active: false };
  const pointers = new Map();
  let usedTouch = false;
  let usedKeyboard = false;
  const state = { throttle: 0, brake: 0, steer: 0, jump: false, source: 'none' };

  const onKey = (e, isDown) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    const code = e.code;
    if (Object.values(KEYS).some((list) => list.includes(code))) { e.preventDefault(); usedKeyboard = true; }
    if (isDown) { if (!down.has(code)) { down.add(code); if (code === 'KeyR') onAction('reset'); if (code === 'KeyC') onAction('camera'); if (code === 'KeyT') onAction('time'); if (code === 'KeyG') onAction('weather'); if (code === 'KeyH') onAction('help'); } }
    else down.delete(code);
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
      <button type="button" class="tbtn" data-btn="jump" aria-label="Jump">⤒</button>
      <button type="button" class="tbtn" data-btn="brake" aria-label="Brake">■</button>
      <button type="button" class="tbtn big" data-btn="throttle" aria-label="Pedal">▶▶</button>
    </div>`;
  root.appendChild(ui);
  const pad = ui.querySelector('.pad'), knob = ui.querySelector('.knob');
  const bindPointer = (el, kind) => {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { kind, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY }); usedTouch = true; el.classList.add('on'); });
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
    return { steer: ax, throttle: g.buttons[7]?.value || (g.buttons[0]?.pressed ? 1 : 0), brake: g.buttons[6]?.value || (g.buttons[1]?.pressed ? 1 : 0), jump: !!g.buttons[2]?.pressed };
  }

  const isHeld = (k) => KEYS[k].some((c) => down.has(c));
  return {
    state, ui,
    /** Call once per frame. A scripted override (flows, harness) can replace the whole input with `override`. */
    read(override) {
      if (override) { Object.assign(state, override, { source: 'script' }); return state; }
      const t = readTouch(), p = readPad();
      const kThrottle = isHeld('throttle') ? 1 : 0, kBrake = isHeld('brake') ? 1 : 0, kSteer = (isHeld('right') ? 1 : 0) - (isHeld('left') ? 1 : 0);
      state.throttle = Math.max(kThrottle, t.throttle, p ? p.throttle : 0);
      state.brake = Math.max(kBrake, t.brake, p ? p.brake : 0);
      state.steer = Math.abs(t.steer) > Math.abs(kSteer) ? t.steer : (kSteer || (p ? p.steer : 0));
      state.jump = isHeld('jump') || t.jump || (p ? p.jump : false);
      state.source = usedTouch ? 'touch' : usedKeyboard ? 'keyboard' : 'none';
      return state;
    },
    isTouch: () => usedTouch,
    showTouchUi(v) { ui.hidden = !v; },
  };
}
