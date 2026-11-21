/* Controls (the pattern of pb/mtb/input.js).
 *   keyboard: A D / left right steer, Space tuck, S / down snowplough, W / up skate, E jump, R back to the piste, G weather, T time,
 *             M piste map, Esc menu
 *   touch:    a steering pad under the left thumb (drag left / right), Tuck, Brake and Jump buttons under the right thumb; together
 *             well under 15 % of the screen, nothing in the middle, every target >= 44 px
 *   gamepad:  left stick steer, A / RT tuck, B / LT brake, X jump, up on the stick skates
 * read() returns { steer, tuck, brake, push, jump, source } each frame. */
const KEYS = { left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], tuck: ['Space'], brake: ['KeyS', 'ArrowDown'], push: ['KeyW', 'ArrowUp'], jump: ['KeyE', 'KeyJ'] };
const ACTION_KEYS = { KeyR: 'reset', KeyG: 'weather', KeyT: 'time', KeyM: 'map', KeyN: 'mute', Escape: 'menu', Enter: 'confirm' };
const PAD_RADIUS = 60;
const DEADZONE = 0.14;

export function createInput({ root, onAction }) {
  const down = new Set();
  const pointers = new Map();
  let usedTouch = false, usedKeyboard = false, enabled = true;
  const state = { steer: 0, tuck: 0, brake: 0, push: 0, jump: false, source: 'none' };

  const onKey = (e, isDown) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    const code = e.code;
    const control = Object.values(KEYS).some((l) => l.includes(code));
    if (control && enabled) { if (!(code === 'Space' && e.target && e.target.tagName === 'BUTTON')) e.preventDefault(); usedKeyboard = true; }
    if (isDown) { if (!down.has(code)) { down.add(code); if (ACTION_KEYS[code]) onAction(ACTION_KEYS[code], e); } } else down.delete(code);
  };
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => { down.clear(); pointers.clear(); });

  const ui = document.createElement('div');
  ui.id = 'touchControls';
  ui.innerHTML = `
    <div class="pad" data-k="steer" aria-label="Steieren"><div class="knob"></div><span class="lbl">◀ ▶</span></div>
    <div class="btns">
      <button type="button" class="tbtn" data-k="jump" aria-label="Sprangen">⤒<small>Sprong</small></button>
      <button type="button" class="tbtn" data-k="brake" aria-label="Bremsen">⋀<small>Bremsen</small></button>
      <button type="button" class="tbtn big" data-k="tuck" aria-label="Hocken">⬇<small>Hocken</small></button>
    </div>`;
  root.appendChild(ui);
  const knob = ui.querySelector('.knob');
  const bind = (el, kind) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (error) { /* synthetic pointer (tests) */ }
      pointers.set(e.pointerId, { kind, x0: e.clientX, x: e.clientX }); usedTouch = true; el.classList.add('on');
    });
    el.addEventListener('pointermove', (e) => { const p = pointers.get(e.pointerId); if (p) p.x = e.clientX; });
    const up = (e) => { pointers.delete(e.pointerId); el.classList.remove('on'); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  };
  for (const el of ui.querySelectorAll('[data-k]')) bind(el, el.dataset.k);

  function readTouch() {
    const t = { steer: 0, tuck: 0, brake: 0, jump: false };
    for (const p of pointers.values()) {
      if (p.kind === 'steer') t.steer = Math.max(-1, Math.min(1, (p.x - p.x0) / PAD_RADIUS));
      else if (p.kind === 'tuck') t.tuck = 1;
      else if (p.kind === 'brake') t.brake = 1;
      else if (p.kind === 'jump') t.jump = true;
    }
    knob.style.transform = `translateX(${t.steer * 40}px)`;
    return t;
  }
  function readPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const g = pads && [...pads].find((p) => p && p.connected);
    if (!g) return null;
    const ax = Math.abs(g.axes[0]) > DEADZONE ? g.axes[0] : 0;
    const ay = g.axes[1] || 0;
    return { steer: ax, tuck: Math.max(g.buttons[7]?.value || 0, g.buttons[0]?.pressed ? 1 : 0), brake: Math.max(g.buttons[6]?.value || 0, g.buttons[1]?.pressed ? 1 : 0), jump: !!g.buttons[2]?.pressed, push: ay < -0.5 ? 1 : 0 };
  }
  const held = (k) => KEYS[k].some((c) => down.has(c));
  return {
    state, ui,
    /** One frame of input; a scripted override (flows, bot) replaces everything. */
    read(override) {
      if (override) { Object.assign(state, override, { source: 'script' }); return state; }
      if (!enabled) { Object.assign(state, { steer: 0, tuck: 0, brake: 0, push: 0, jump: false }); return state; }
      const t = readTouch(), p = readPad();
      const k = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
      state.steer = Math.abs(t.steer) > Math.abs(k) ? t.steer : (k || (p ? p.steer : 0));
      state.tuck = Math.max(held('tuck') ? 1 : 0, t.tuck, p ? p.tuck : 0);
      state.brake = Math.max(held('brake') ? 1 : 0, t.brake, p ? p.brake : 0);
      state.push = Math.max(held('push') ? 1 : 0, p ? p.push : 0);
      state.jump = held('jump') || t.jump || (p ? p.jump : false);
      state.source = usedTouch ? 'touch' : usedKeyboard ? 'keyboard' : 'none';
      return state;
    },
    setEnabled(v) { enabled = v; if (!v) { pointers.clear(); } },
    isTouch: () => usedTouch,
    showTouch(v) { ui.hidden = !v; },
  };
}
