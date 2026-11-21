/* Round 7: free 360-degree look-around (skiing, standing, riding a lift) and camera collision. One module for every camera.
 *
 *   createLook({ el, isTouchUi }) -> look       the input side: drags that turn the view, never the steering
 *     Mac      right-mouse / two-finger-click drag on the picture, or hold C and move the mouse; a sideways two-finger swipe (wheel)
 *     iPad     a one-finger (or two-finger) drag on the free part of the screen (the canvas: the pad and the buttons are their own
 *              elements and keep their touches)
 *     look.yaw / look.pitch   the offset (rad); look.step(dt, speed) eases it back behind the skier after LOOK.hold s without input,
 *              faster at speed (steering stays readable)
 *   applyLook(cam, pivot, look, mode)           the maths: 'orbit' = the camera circles the pivot (third person, lift chase), 'head' =
 *              the view turns round the eye (first person, the window of a cabin); pitch clamped
 *   createCameraGuard({ ground, obstacles })    camera collision: the line from the pivot (the skier) to the camera is walked; where it
 *              would enter the ground, a pylon, a tree or a building the camera is pulled in in front of it (never through geometry,
 *              never inside it), and it eases back out slowly once the view is clear.
 * Pure maths + DOM events, no THREE. */
export const LOOK = Object.freeze({ yawPerPx: 0.0085, pitchPerPx: 0.006, wheel: 0.004, hold: 0.9, back: 1.6, backFast: 5.5, pitchMin: -0.55, pitchMax: 1.0, key: 'KeyC' });

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function createLook({ el, win = window, accept = () => true } = {}) {
  const st = { yaw: 0, pitch: 0, idle: 99, dragging: 0, keyHeld: false, enabled: true };
  const pointers = new Map();
  function turn(dx, dy) {
    if (!st.enabled) return;
    st.yaw = wrap(st.yaw - dx * LOOK.yawPerPx);
    st.pitch = clamp(st.pitch + dy * LOOK.pitchPerPx, LOOK.pitchMin, LOOK.pitchMax);
    st.idle = 0;
  }
  if (el) {
    el.addEventListener('contextmenu', (e) => { if (accept(e)) e.preventDefault(); });
    el.addEventListener('pointerdown', (e) => {
      if (!accept(e)) return;                                        // the pad, the buttons, cards and the map keep their pointers
      const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
      if (!touch && e.button !== 2 && !st.keyHeld) return;           // the mouse: the right button (or C held)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { e.target.setPointerCapture(e.pointerId); } catch (error) { /* old browser */ }
      st.dragging = pointers.size;
    });
    el.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) { if (st.keyHeld && e.pointerType === 'mouse') turn(e.movementX || 0, e.movementY || 0); return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      const n = Math.max(1, pointers.size);                          // two fingers moving together count once
      turn(dx / n, dy / n);
    });
    const up = (e) => { if (!pointers.has(e.pointerId)) return; pointers.delete(e.pointerId); st.dragging = pointers.size; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up, true);
    el.addEventListener('wheel', (e) => { if (accept(e) && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.6) { e.preventDefault(); turn(e.deltaX * LOOK.wheel / LOOK.yawPerPx, 0); } }, { passive: false });
  }
  if (win) {
    win.addEventListener('keydown', (e) => { if (e.code === LOOK.key && !e.repeat && !(e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) st.keyHeld = true; });
    win.addEventListener('keyup', (e) => { if (e.code === LOOK.key) st.keyHeld = false; });
    win.addEventListener('blur', () => { st.keyHeld = false; pointers.clear(); st.dragging = 0; });
  }
  return {
    get yaw() { return st.yaw; }, get pitch() { return st.pitch; },
    get active() { return st.dragging > 0 || st.keyHeld || Math.abs(st.yaw) > 1e-3 || Math.abs(st.pitch) > 1e-3; },
    /** Eases the view back behind the skier after a short pause without input (faster at speed). */
    step(dt, speed = 0) {
      if (st.dragging || st.keyHeld) { st.idle = 0; return; }
      st.idle += dt;
      if (st.idle < LOOK.hold) return;
      const rate = LOOK.back + (LOOK.backFast - LOOK.back) * clamp(speed / 15, 0, 1);
      const k = 1 - Math.exp(-dt * rate);
      st.yaw -= st.yaw * k; st.pitch -= st.pitch * k;
      if (Math.abs(st.yaw) < 1e-3) st.yaw = 0;
      if (Math.abs(st.pitch) < 1e-3) st.pitch = 0;
    },
    /** Tests / flows: set the offset as a drag would. */
    turn,
    reset() { st.yaw = 0; st.pitch = 0; st.idle = 99; },
    setEnabled(v) { st.enabled = !!v; if (!v) { pointers.clear(); st.dragging = 0; } },
  };
}

/** cam = { x, y, z, tx, ty, tz } (changed in place), pivot = { x, y, z }, look = { yaw, pitch }, mode 'orbit' | 'head'. */
export function applyLook(cam, pivot, look, mode = 'orbit') {
  if (!look || (Math.abs(look.yaw) < 1e-4 && Math.abs(look.pitch) < 1e-4)) return cam;
  if (mode === 'head') {
    const dx = cam.tx - cam.x, dy = cam.ty - cam.y, dz = cam.tz - cam.z;
    const h = Math.hypot(dx, dz), d = Math.hypot(h, dy) || 1;
    const yaw = Math.atan2(dz, dx) + look.yaw, pitch = clamp(Math.atan2(dy, h) + look.pitch, -1.35, 1.35);
    cam.tx = cam.x + Math.cos(yaw) * Math.cos(pitch) * d; cam.tz = cam.z + Math.sin(yaw) * Math.cos(pitch) * d; cam.ty = cam.y + Math.sin(pitch) * d;
    return cam;
  }
  const vx = cam.x - pivot.x, vy = cam.y - pivot.y, vz = cam.z - pivot.z;
  const h = Math.hypot(vx, vz), d = Math.hypot(h, vy) || 1;
  const yaw = Math.atan2(vz, vx) + look.yaw, elev = clamp(Math.atan2(vy, h) + look.pitch, -0.12, 1.3);
  cam.x = pivot.x + Math.cos(yaw) * Math.cos(elev) * d; cam.z = pivot.z + Math.sin(yaw) * Math.cos(elev) * d; cam.y = pivot.y + Math.sin(elev) * d;
  cam.tx = pivot.x; cam.ty = pivot.y; cam.tz = pivot.z;
  return cam;
}

/**
 * Camera collision. ground(x, z) = the snow; blocked(x, y, z) = true inside an obstacle (pylon, tree, building, station). guard(cam, pivot,
 * dt) pulls the camera in front of the first obstacle on the line pivot -> camera, keeps at least minDist, eases back out (outRate m/s).
 */
export function createCameraGuard({ ground, blocked = () => false, clearance = 0.45, minDist = 1.1, outRate = 4, step = 0.35 }) {
  let dist = null;
  return {
    get dist() { return dist; },
    reset() { dist = null; },
    guard(cam, pivot, dt) {
      const vx = cam.x - pivot.x, vy = cam.y - pivot.y, vz = cam.z - pivot.z;
      const full = Math.hypot(vx, vy, vz);
      if (full < 1e-3) return cam;
      let free = full;
      for (let t = step; t <= full; t += step) {
        const k = t / full, x = pivot.x + vx * k, y = pivot.y + vy * k, z = pivot.z + vz * k;
        if (y < ground(x, z) + clearance || blocked(x, y, z)) { free = Math.max(minDist, t - step * 1.5); break; }
      }
      dist = dist === null || free < dist ? free : Math.min(free, dist + outRate * dt);
      if (dist < full) { const k = dist / full; cam.x = pivot.x + vx * k; cam.y = pivot.y + vy * k; cam.z = pivot.z + vz * k; }
      return cam;
    },
  };
}
