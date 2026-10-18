/* Kart Lëtzebuerg — input: keyboard, gamepad and touch (floating steering stick + buttons). */
(function () {
  'use strict';
  const KL = window.KL;
  const { clamp } = KL;
  const keys = new Set();
  const touch = { steer: 0, drift: false, item: false, brake: false, gas: false, pointers: new Map() };
  const handlers = {};
  let autoGas = true, enabled = true;
  const emit = (n, a) => (handlers[n] || []).forEach((f) => f(a));

  const MAP = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down',
    ' ': 'drift', Shift: 'drift', e: 'item', E: 'item', Enter: 'item', Control: 'item', x: 'item', X: 'item' };
  function onKey(e, down) {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const a = MAP[e.key];
    if (a) { if (down) keys.add(a); else keys.delete(a); if (enabled) e.preventDefault(); if (down && !e.repeat && a === 'item') emit('itemkey'); return; }
    if (!down || e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'r') emit('reset'); else if (k === 'p' || e.key === 'Escape') emit('pause'); else if (k === 'c') emit('weather'); else if (k === 'm') emit('mute'); else if (k === 'b' || k === 'v') emit('rear', true);
  }
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => { onKey(e, false); if (e.key.toLowerCase() === 'b' || e.key.toLowerCase() === 'v') emit('rear', false); });
  window.addEventListener('blur', () => keys.clear());

  /* ---- touch ---- */
  function bindTouch(root) {
    const pad = root.querySelector('#steerPad'), knob = root.querySelector('#steerKnob'), base = root.querySelector('#steerBase');
    let padId = null, ox = 0, oy = 0;
    const R = 62;
    if (pad) {
      pad.addEventListener('pointerdown', (e) => {
        if (padId !== null) return;
        padId = e.pointerId; try { pad.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already-released pointer */ } const r = pad.getBoundingClientRect(); ox = e.clientX; oy = e.clientY;
        if (base) { base.style.left = ox - r.left + 'px'; base.style.top = oy - r.top + 'px'; base.classList.add('on'); }
        if (knob) { knob.style.transform = 'translate(0,0)'; }
        touch.steer = 0; e.preventDefault();
      });
      pad.addEventListener('pointermove', (e) => {
        if (e.pointerId !== padId) return;
        const dx = clamp(e.clientX - ox, -R, R);
        const v = dx / R; touch.steer = Math.sign(v) * Math.pow(Math.abs(v), 1.15);
        if (knob) knob.style.transform = `translate(${dx}px,0)`;
        e.preventDefault();
      });
      const end = (e) => { if (e.pointerId !== padId) return; padId = null; touch.steer = 0; if (base) base.classList.remove('on'); };
      pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end); pad.addEventListener('lostpointercapture', end);
    }
    root.querySelectorAll('[data-input]').forEach((b) => {
      const name = b.dataset.input; const ids = new Set();
      const set = (v) => { if (name === 'item') { if (v) emit('itemkey'); touch.item = v; } else touch[name] = v; b.classList.toggle('held', v); };
      b.addEventListener('pointerdown', (e) => { ids.add(e.pointerId); try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } set(true); e.preventDefault(); });
      const up = (e) => { ids.delete(e.pointerId); if (!ids.size) set(false); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] || 0, b = (i) => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
      return { steer: Math.abs(ax) > 0.12 ? ax : 0, gas: Math.max(b(0), b(7)), brake: Math.max(b(1), b(6)), drift: b(5) > 0.4 || b(2) > 0.4, item: b(3) > 0.4 || b(4) > 0.4, dpad: (b(15) - b(14)) };
    }
    return null;
  }

  let prevPadItem = false;
  KL.input = {
    bindTouch, on(n, f) { (handlers[n] = handlers[n] || []).push(f); },
    setAutoGas(v) { autoGas = !!v; }, get autoGas() { return autoGas; }, setEnabled(v) { enabled = v; if (!v) keys.clear(); },
    anyTouch() { return touch.steer !== 0 || touch.drift || touch.item || touch.brake || touch.gas; },
    read(out) {
      out = out || {};
      const gp = gamepad();
      let steer = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
      let gas = keys.has('up') ? 1 : 0, brake = keys.has('down') ? 1 : 0;
      let drift = keys.has('drift'), item = keys.has('item');
      if (touch.steer) steer = touch.steer;
      if (touch.gas) gas = 1; if (touch.brake) brake = 1; if (touch.drift) drift = true; if (touch.item) item = true;
      if (gp) { if (gp.steer) steer = gp.steer; gas = Math.max(gas, gp.gas); brake = Math.max(brake, gp.brake); drift = drift || gp.drift; if (gp.item && !prevPadItem) emit('itemkey'); prevPadItem = gp.item; item = item || gp.item; }
      if (autoGas && !gp && (document.documentElement.classList.contains('kl-touch'))) { if (!brake) gas = 1; }
      out.steer = clamp(steer, -1, 1); out.gas = gas; out.brake = brake; out.drift = drift; out.item = item;
      return out;
    },
    /* touch devices: show the on-screen controls (also toggled when a touch is seen) */
  };
})();
