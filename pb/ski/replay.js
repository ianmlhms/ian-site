/* Replay (28 Nov 2026): a rolling recorder of the player's skier state (fixed memory) and the playback of such a clip with five cameras.
 *
 * Recorder: a ring of RECORD.seconds at RECORD.hz. A frame is the skier STATE (every number / boolean / short string field of the
 * physics state, the key list is read from the first state, so a new field of the skier model is recorded without a change here). The
 * ring is allocated once (about 0.25 MB), nothing grows with the playing time. A jump of the position (teleport, lift, respawn) is a
 * "cut": playback never interpolates across it.
 * Playback: sample(t) rebuilds a state object that skier.pose() / spray / the first-person camera take like a live one, so the skier
 * model API stays generic (whatever pose() reads from the state is replayed).
 * Cameras: follow (the normal chase camera, own instance), tv (a tripod beside the line that pans with him and is set up again when
 * he has passed), low (a low tracking camera beside the skis), top (from above), fp (his helmet: main.js drives firstperson.js).
 * The bar (DOM): play / pause, scrub, 0.25x / 0.5x / 1x, the camera choice, close. Luxembourgish texts. */
import { createChaseCamera } from './camera.js';

export const RECORD = Object.freeze({ seconds: 90, hz: 20, cutDistance: 25 });
export const CLIP_MIN_S = 2;
export const FREE_CLIP_S = 30;                    // the free ride's "Lescht 30 s"
export const CAMS = Object.freeze([
  { id: 'follow', label: 'Hannendrun' }, { id: 'tv', label: 'TV' }, { id: 'low', label: 'Niddreg' }, { id: 'top', label: 'Vun uewen' }, { id: 'fp', label: 'Helm' },
]);
export const SPEEDS = Object.freeze([0.25, 0.5, 1]);
const ANGLE_KEYS = new Set(['heading']);
const MAX_STRINGS = 12;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);

/** The rolling recorder: push(state, dt) every physics frame, snapshot(seconds) = a copy of the last seconds as a clip. */
export function createRecorder({ seconds = RECORD.seconds, hz = RECORD.hz } = {}) {
  const cap = Math.ceil(seconds * hz), step = 1 / hz;
  let keys = null, types = null, K = 0, data = null;
  const times = new Float64Array(cap), cuts = new Uint8Array(cap);
  const strings = [];
  let head = 0, count = 0, clock = 0, lastT = -1e9, lastX = 0, lastY = 0, lastZ = 0, forceCut = true;
  const stringIndex = (s) => { let i = strings.indexOf(s); if (i < 0) { if (strings.length >= MAX_STRINGS) return 0; strings.push(s); i = strings.length - 1; } return i; };

  function init(state) {
    keys = []; types = [];
    for (const k of Object.keys(state)) {
      const t = typeof state[k];
      if (t === 'number') { keys.push(k); types.push('n'); } else if (t === 'boolean') { keys.push(k); types.push('b'); } else if (t === 'string') { keys.push(k); types.push('s'); }
    }
    K = keys.length;
    data = new Float32Array(cap * K);
    strings.length = 0; strings.push('');
  }
  return {
    get count() { return count; },
    get seconds() { return count > 1 ? (clock - times[(head - count + cap) % cap]) : 0; },
    get capacity() { return cap; },
    get bytes() { return data ? data.byteLength + times.byteLength + cuts.byteLength : 0; },
    /** Forget everything (a new run). */
    reset() { head = 0; count = 0; clock = 0; lastT = -1e9; forceCut = true; },
    /** The next frame starts a new piece: playback does not interpolate across it. */
    cut() { forceCut = true; },
    /** dt = simulated seconds since the last call. Returns true when a frame was written. */
    push(state, dt) {
      if (!state) return false;
      if (!keys) init(state);
      clock += dt;
      if (clock - lastT < step) return false;
      const jumped = Math.hypot(state.x - lastX, state.z - lastZ) > RECORD.cutDistance || Math.abs(state.y - lastY) > 40;
      const base = head * K;
      for (let i = 0; i < K; i++) {
        const v = state[keys[i]];
        data[base + i] = types[i] === 's' ? stringIndex(v) : types[i] === 'b' ? (v ? 1 : 0) : (Number.isFinite(v) ? v : 0);
      }
      times[head] = clock; cuts[head] = forceCut || jumped || count === 0 ? 1 : 0;
      forceCut = false; lastT = clock; lastX = state.x; lastY = state.y; lastZ = state.z;
      head = (head + 1) % cap; count = Math.min(count + 1, cap);
      return true;
    },
    /** A copy of the newest `maxSeconds` as a clip { n, duration, keys, types, strings, times (from 0), data, cuts, template }, or null when shorter than CLIP_MIN_S. */
    snapshot(maxSeconds, template) {
      if (!count) return null;
      const newest = times[(head - 1 + cap) % cap];
      let n = 0;
      while (n < count && newest - times[(head - 1 - n + cap * 2) % cap] <= maxSeconds) n++;
      if (n < 2 || times[(head - 1 + cap) % cap] - times[(head - n + cap) % cap] < CLIP_MIN_S) return null;
      const t0 = times[(head - n + cap) % cap];
      const clip = { n, keys: keys.slice(), types: types.slice(), strings: strings.slice(), times: new Float64Array(n), data: new Float32Array(n * K), cuts: new Uint8Array(n), template: { ...template }, K };
      for (let i = 0; i < n; i++) {
        const src = (head - n + i + cap * 2) % cap;
        clip.times[i] = times[src] - t0;
        clip.cuts[i] = cuts[src];
        clip.data.set(data.subarray(src * K, src * K + K), i * K);
      }
      clip.cuts[0] = 1;
      clip.duration = clip.times[n - 1];
      return clip;
    },
  };
}

/** Rebuild the state at clip time t into `out` (a reused object that starts as the clip's template). Returns the frame index (the left one). */
export function sampleClip(clip, t, out, hint = 0) {
  const { n, K, keys, types, times, data, cuts, strings } = clip;
  const tt = clamp(t, 0, clip.duration);
  let i = clamp(hint, 0, n - 2);
  while (i > 0 && times[i] > tt) i--;
  while (i < n - 2 && times[i + 1] <= tt) i++;
  const span = times[i + 1] - times[i];
  let k = span > 1e-6 ? clamp((tt - times[i]) / span, 0, 1) : 0;
  if (cuts[i + 1]) k = 0;                                   // do not blend across a teleport
  const a = i * K, b = (i + 1) * K;
  for (let j = 0; j < K; j++) {
    const key = keys[j], va = data[a + j], vb = data[b + j];
    if (types[j] === 'n') out[key] = ANGLE_KEYS.has(key) ? va + wrap(vb - va) * k : va + (vb - va) * k;
    else if (types[j] === 'b') out[key] = (k < 0.5 ? va : vb) > 0.5;
    else out[key] = strings[k < 0.5 ? va : vb] || '';
  }
  return i;
}

/** The replay controller + bar. Everything the loop needs: active, state, cam, update(dt), camera(dt, time), sprayAmount. */
export function createReplay({ root, surface, onClose = () => {}, onToast = () => {} }) {
  const chase = createChaseCamera(surface);
  const out = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: 60 };
  const state = {};
  let clip = null, t = 0, playing = false, speed = 1, cam = 'follow', frameHint = 0, needSnap = true, scrubbing = false, bar = null, lastIndex = -1, stepped = 0;
  const tv = { has: false, px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, side: 1 };
  const low = { has: false, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 };
  const top = { has: false, x: 0, z: 0, yaw: 0, tx: 0, tz: 0 };

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const ground = (x, z) => surface.height(x, z);
  const dirOf = (s) => { const hv = Math.hypot(s.vx || 0, s.vz || 0); const yaw = hv > 1.5 ? Math.atan2(s.vz, s.vx) : s.heading; return { fx: Math.cos(yaw), fz: Math.sin(yaw), yaw, speed: hv }; };

  function snapCameras() { needSnap = true; tv.has = false; low.has = false; top.has = false; }
  function sync() {
    if (!bar) return;
    bar.play.textContent = playing ? '⏸' : '▶';
    bar.play.setAttribute('aria-label', playing ? 'Paus' : 'Ofspillen');
    if (!scrubbing) bar.scrub.value = String(Math.round(clip.duration > 0 ? (t / clip.duration) * 1000 : 0));
    bar.time.textContent = `${fmt(t)} / ${fmt(clip.duration)}`;
    for (const b of bar.cams.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === cam);
    for (const b of bar.speeds.querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.v) === speed);
    document.documentElement.dataset.skiReplayCam = cam;
    document.documentElement.dataset.skiReplayPlaying = playing ? '1' : '0';
  }
  function seek(sec) {
    const was = t;
    t = clamp(sec, 0, clip.duration);
    if (Math.abs(t - was) > 0.4) snapCameras();
    lastIndex = sampleClip(clip, t, state, frameHint); frameHint = lastIndex;
  }
  function setCam(id) { if (!CAMS.some((c) => c.id === id)) return; cam = id; snapCameras(); sync(); }
  function setSpeed(v) { speed = SPEEDS.includes(v) ? v : 1; sync(); }
  function toggle() { if (!playing && t >= clip.duration - 0.02) seek(0); playing = !playing; sync(); }

  function build() {
    const el = document.createElement('div');
    el.className = 'rpbar';
    el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Replay');
    el.innerHTML = `<div class="rprow"><b class="rptitle">Replay</b><button type="button" class="btn rpplay" data-r="play" aria-label="Paus">⏸</button>
      <input type="range" class="rpscrub" min="0" max="1000" value="0" aria-label="Positioun"><span class="rptime">0:00 / 0:00</span><button type="button" class="btn rpclose" data-r="close">Zou</button></div>
      <div class="rprow"><div class="seg rpcams" aria-label="Kamera">${CAMS.map((c) => `<button type="button" data-v="${c.id}">${c.label}</button>`).join('')}</div>
      <div class="seg rpspeeds" aria-label="Geschwindegkeet">${SPEEDS.map((s) => `<button type="button" data-v="${s}">${s === 0.25 ? '¼' : s === 0.5 ? '½' : '1'}×</button>`).join('')}</div></div>`;
    root.appendChild(el);
    const q = (s) => el.querySelector(s);
    const b = { el, play: q('.rpplay'), scrub: q('.rpscrub'), time: q('.rptime'), cams: q('.rpcams'), speeds: q('.rpspeeds') };
    b.play.addEventListener('click', toggle);
    q('.rpclose').addEventListener('click', () => api.close());
    b.cams.addEventListener('click', (e) => { const x = e.target.closest('button'); if (x) setCam(x.dataset.v); });
    b.speeds.addEventListener('click', (e) => { const x = e.target.closest('button'); if (x) setSpeed(Number(x.dataset.v)); });
    b.scrub.addEventListener('pointerdown', () => { scrubbing = true; });
    const endScrub = () => { scrubbing = false; sync(); };
    b.scrub.addEventListener('pointerup', endScrub); b.scrub.addEventListener('pointercancel', endScrub); b.scrub.addEventListener('change', endScrub);
    b.scrub.addEventListener('input', () => { scrubbing = true; seek((Number(b.scrub.value) / 1000) * clip.duration); stepped = 0; sync(); });
    return b;
  }
  const onKey = (e) => {
    if (!clip) return;
    const code = e.code;
    if (code === 'Space' || code === 'KeyK') { e.preventDefault(); toggle(); }
    else if (code === 'ArrowLeft') { e.preventDefault(); seek(t - 1); sync(); }
    else if (code === 'ArrowRight') { e.preventDefault(); seek(t + 1); sync(); }
    else if (code >= 'Digit1' && code <= 'Digit5') setCam(CAMS[Number(code.slice(5)) - 1].id);
  };

  // ---- the cameras (pure maths on the replayed state) ----
  function camTv(s, dt) {
    const d = dirOf(s);
    const gone = tv.has && ((s.x - tv.px) * d.fx + (s.z - tv.pz) * d.fz > 24 || Math.hypot(s.x - tv.px, s.z - tv.pz) > 80);
    if (!tv.has || gone) {
      const ahead = 30 + d.speed * 0.9;
      const bx = s.x + d.fx * ahead, bz = s.z + d.fz * ahead;
      const sx = -d.fz, sz = d.fx;
      const hl = ground(bx + sx * 15, bz + sz * 15), hr = ground(bx - sx * 15, bz - sz * 15);
      tv.side = hl <= hr ? 1 : -1;                                      // the downhill side: nothing between the camera and the line
      tv.px = bx + sx * 15 * tv.side; tv.pz = bz + sz * 15 * tv.side;
      tv.py = ground(tv.px, tv.pz) + 2.6;
      if (!tv.has) { tv.tx = s.x; tv.ty = s.y + 1; tv.tz = s.z; }
      tv.has = true;
    }
    const k = needSnap ? 1 : ease(6, dt);
    tv.tx += (s.x - tv.tx) * k; tv.ty += (s.y + 1 - tv.ty) * k; tv.tz += (s.z - tv.tz) * k;      // the pan
    const dist = Math.hypot(tv.tx - tv.px, tv.tz - tv.pz);
    out.x = tv.px; out.y = Math.max(tv.py, ground(tv.px, tv.pz) + 1.2); out.z = tv.pz; out.tx = tv.tx; out.ty = tv.ty; out.tz = tv.tz;
    out.fov = clamp(2 * Math.atan(5 / Math.max(dist, 6)) * 180 / Math.PI, 16, 52);                   // zoom: he stays about the same size
  }
  function camLow(s, dt) {
    const d = dirOf(s);
    const wx = s.x - d.fx * 5.2 - d.fz * 2.2, wz = s.z - d.fz * 5.2 + d.fx * 2.2;
    if (!low.has) { low.x = wx; low.z = wz; low.tx = s.x; low.tz = s.z; low.has = true; }
    const k = needSnap ? 1 : ease(7, dt);
    low.x += (wx - low.x) * k; low.z += (wz - low.z) * k; low.tx += (s.x - low.tx) * k; low.tz += (s.z - low.tz) * k;
    const gy = ground(low.x, low.z);
    out.x = low.x; out.z = low.z; out.y = Math.max(gy + 0.6, Math.min(s.y, gy + 2.5) - 0.3);
    out.tx = low.tx; out.tz = low.tz; out.ty = Math.max(s.y, ground(low.tx, low.tz)) + 0.7; out.fov = 76;
  }
  function camTop(s, dt) {
    const d = dirOf(s);
    if (!top.has) { top.yaw = d.yaw; top.x = s.x; top.z = s.z; top.has = true; }
    const k = needSnap ? 1 : ease(3, dt);
    top.yaw += wrap(d.yaw - top.yaw) * k;
    top.x += (s.x - top.x) * (needSnap ? 1 : ease(8, dt)); top.z += (s.z - top.z) * (needSnap ? 1 : ease(8, dt));
    const gy = Math.max(s.y, ground(top.x, top.z));
    out.x = top.x - Math.cos(top.yaw) * 7; out.z = top.z - Math.sin(top.yaw) * 7; out.y = gy + 26;
    out.tx = top.x + Math.cos(top.yaw) * 2; out.tz = top.z + Math.sin(top.yaw) * 2; out.ty = gy; out.fov = 52;
  }

  const api = {
    get active() { return !!clip; },
    get state() { return state; },
    get cam() { return cam; },
    get playing() { return playing; },
    get speed() { return speed; },
    get time() { return t; },
    get duration() { return clip ? clip.duration : 0; },
    get bar() { return bar; },
    /** 1 while the replayed skier moves (the spray works), else 0. */
    get sprayAmount() { return clip && playing ? 1 : 0; },
    /** Time step the world effects (spray) take for this frame. */
    effectDt(dt) { return clip && playing ? dt * speed : 0; },
    open(newClip, { camera = 'follow', paused = false } = {}) {
      if (clip || !newClip) return false;
      clip = newClip;
      Object.keys(state).forEach((k) => { delete state[k]; });
      Object.assign(state, clip.template);
      t = 0; playing = !paused; speed = 1; cam = CAMS.some((c) => c.id === camera) ? camera : 'follow'; frameHint = 0; lastIndex = -1; scrubbing = false;
      bar = build();
      seek(0); snapCameras(); sync();
      window.addEventListener('keydown', onKey, true);
      document.documentElement.dataset.skiReplay = '1';
      return true;
    },
    /** Advance the clip by one frame (call once per frame while active). */
    update(dt) {
      if (!clip) return;
      if (playing) {
        const was = lastIndex;
        t += dt * speed;
        if (t >= clip.duration) { t = clip.duration; playing = false; }
        lastIndex = sampleClip(clip, t, state, frameHint); frameHint = lastIndex;
        if (lastIndex !== was && was >= 0) { for (let i = was + 1; i <= lastIndex; i++) if (clip.cuts[i]) { snapCameras(); break; } }
        stepped++;
        if (stepped % 3 === 0 || !playing) sync();
      }
    },
    /** The replay camera for the current mode (null for 'fp': main.js asks firstperson.js with this state). */
    camera(dt, time = 0) {
      if (!clip || cam === 'fp') { needSnap = false; return null; }
      const s = state;
      if (cam === 'follow') {
        if (needSnap) chase.snap(s);
        const c = chase.update(s, needSnap ? 0.0001 : dt, time);
        needSnap = false;
        return c;
      }
      if (cam === 'tv') camTv(s, dt); else if (cam === 'low') camLow(s, dt); else camTop(s, dt);
      needSnap = false;
      out.y = Math.max(out.y, ground(out.x, out.z) + 0.5);
      return out;
    },
    setCam, setSpeed, seek: (sec) => { seek(sec); sync(); }, toggle,
    close() {
      if (!clip) return;
      clip = null; playing = false;
      window.removeEventListener('keydown', onKey, true);
      if (bar) { bar.el.remove(); bar = null; }
      delete document.documentElement.dataset.skiReplay; delete document.documentElement.dataset.skiReplayCam; delete document.documentElement.dataset.skiReplayPlaying;
      onClose();
    },
  };
  void onToast;
  return api;
}
