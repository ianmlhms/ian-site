/* Shared by Ski Alpen (pb/ski/main.js) and MTB Mëllerdall (pb/mtb/main.js).
 * The Grafik level controller (28 Nov 2026; Ian, school iPad: "I pick Héich and within ~20 s it drops to Niddreg by itself").
 *
 * Rules:
 *  - A MANUAL pick (Niddreg / Mëttel / Héich) is final: the controller never changes it. When the frames are really bad for a while it
 *    asks for ONE hint per page life ("Ze lues? ..."), nothing more.
 *  - "Automatesch" adapts ONE level at a time (Héich -> Mëttel -> Niddreg, never a jump), with hysteresis: a level goes down only after
 *    DOWN_AFTER_S of sustained slow frames (the median of the last WINDOW_S, so one-off spikes do not count) while the dynamic resolution
 *    can not help any more (post.js at its floor, or the frame is our own JavaScript); it goes back up after UP_AFTER_S on the display's
 *    beat with the resolution at its ceiling. An up step that fails soon after is remembered (its retry wait doubles).
 *  - Grace: nothing is judged for a few seconds after a load, a teleport / resort switch, a run start, a level change (settle()).
 *  - The display's beat: frames can never come faster than the display (or a 30 fps cap: iOS Low Power Mode, the flows' power mode).
 *    Frames are judged against target = max(1/60 s, beat): a 120 Hz iPad Pro is fine at 60 fps, a 30 fps-capped iPad at 30 fps.
 *    The beat is learnt from every frame, also the cheap ones (loading, picker, map: idleFrame()): enough frames under 25 ms = 60 Hz
 *    or faster; many frames and none under 25 ms = a 30 fps cap. Until then 60 Hz is assumed.
 * Pure module (no DOM, no THREE): node scripts/ski/quality-ctl-test.mjs. */
export const LEVEL_ORDER = Object.freeze(['low', 'medium', 'high']);

export const QCTL = Object.freeze({
  WINDOW_S: 2,            // the median of this many seconds of frames is what counts
  HITCH_MS: 250,          // a frame longer than this is a hitch (tab switch, a tile burst), never the steady state
  SLOW: 1.3,              // median above target x this = slow (60 Hz: > 21.7 ms = under 46 fps; 30 fps cap: > 43 ms)
  HINT: 1.5,              // manual level: median above target x this (60 Hz: > 25 ms = under 40 fps) ...
  HINT_AFTER_S: 8,        // ... for this long: the one hint
  DOWN_AFTER_S: 4,        // Automatesch: this long slow (and the resolution can't help) = one level down
  MIN_GAP_S: 8,           // at least this long between two level changes
  GOOD: 1.1,              // p90 under target x this = on the beat
  UP_AFTER_S: 15,         // Automatesch: this long on the beat at the resolution's ceiling = try one level up
  FAILED_WITHIN_S: 30,    // a down step this soon after an up step = that up step failed
  RETRY_S: 60, RETRY_MAX_S: 480,
  SETTLE_S: 5,            // grace after a level change
  BEAT_FAST_MS: 12.5, BEAT_60_MS: 25,
  BEAT_PROOF: 24,         // frames under 25 ms that prove a 60 Hz (or faster) display
  BEAT_CAP_AFTER: 150,    // frames seen with none under 25 ms: a 30 fps cap
});

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };

/** level: the level running now; manual: the player's own pick (true) or Automatesch (false). now() in ms. */
export function createQualityControl({ level = 'medium', manual = false, now = () => performance.now() } = {}) {
  const st = {
    level, manual, settleUntil: 0, lastChange: -1e9, lastUp: -1e9,
    frames: [], times: [], slowFor: 0, hintFor: 0, goodFor: 0, hinted: false, lastT: null,
    fast: 0, sixty: 0, seen: 0, beat: 1000 / 60,
    retryAt: {}, retryWait: {},
  };
  const target = () => Math.max(1000 / 60, st.beat);

  function learnBeat(ms) {
    if (!(ms > 0) || ms > QCTL.HITCH_MS) return;
    st.seen++;
    if (ms < QCTL.BEAT_FAST_MS) st.fast++;
    if (ms < QCTL.BEAT_60_MS) st.sixty++;
    if (st.fast >= QCTL.BEAT_PROOF) st.beat = 1000 / 120;
    else if (st.sixty >= QCTL.BEAT_PROOF) st.beat = 1000 / 60;
    else if (st.seen >= QCTL.BEAT_CAP_AFTER && st.sixty < 3) st.beat = 1000 / 30;
  }
  function resetJudgement() { st.frames.length = 0; st.times.length = 0; st.slowFor = 0; st.hintFor = 0; st.goodFor = 0; st.lastT = null; }
  const order = (l) => LEVEL_ORDER.indexOf(l);

  return {
    /** The player picked (manual) or chose Automatesch; level = what runs now. */
    setMode(isManual, lvl) { st.manual = !!isManual; st.level = lvl; st.hinted = false; resetJudgement(); this.settle(QCTL.SETTLE_S * 1000); },
    /** The level was applied (by us or by a recovery): judge it afresh after the grace. */
    setLevel(lvl) { st.level = lvl; st.lastChange = now(); resetJudgement(); this.settle(QCTL.SETTLE_S * 1000); },
    /** No judgement for this long (load, teleport, run start ...). */
    settle(ms) { st.settleUntil = Math.max(st.settleUntil, now() + ms); resetJudgement(); },
    /** A frame in which no 3D scene was drawn (loading, picker, map): only the display's beat is learnt. */
    idleFrame(ms) { learnBeat(ms); },
    /**
     * A frame of the running game. limited: the resolution can't help any more (post.js at its floor, or CPU-bound); atTop: the
     * resolution sits at its ceiling. Returns null or { type: 'down' | 'up', level } (Automatesch) / { type: 'hint', level } (manual).
     */
    frame(ms, { limited = true, atTop = false } = {}) {
      learnBeat(ms);
      const t = now();
      if (!(ms > 0) || ms > QCTL.HITCH_MS || t < st.settleUntil) return null;
      const dt = st.lastT === null ? 0 : Math.min(0.25, (t - st.lastT) / 1000);
      st.lastT = t;
      st.frames.push(ms); st.times.push(t);
      while (st.times.length && t - st.times[0] > QCTL.WINDOW_S * 1000) { st.times.shift(); st.frames.shift(); }
      if (st.times.length < 2 || t - st.times[0] < QCTL.WINDOW_S * 1000 * 0.9) return null;      // a full window first
      const T = target(), med = median(st.frames);
      const slow = med > T * QCTL.SLOW;
      if (st.manual) {
        st.hintFor = med > T * QCTL.HINT && limited ? st.hintFor + dt : Math.max(0, st.hintFor - dt);
        if (!st.hinted && st.hintFor >= QCTL.HINT_AFTER_S && st.level !== 'low') { st.hinted = true; return { type: 'hint', level: st.level }; }
        return null;
      }
      st.slowFor = slow && limited ? st.slowFor + dt : Math.max(0, st.slowFor - dt);
      const good = pct(st.frames, 0.9) <= T * QCTL.GOOD && atTop;
      st.goodFor = good ? st.goodFor + dt : Math.max(0, st.goodFor - dt * 2);
      const gapOk = t - st.lastChange >= QCTL.MIN_GAP_S * 1000;
      const i = order(st.level);
      if (st.slowFor >= QCTL.DOWN_AFTER_S && gapOk && i > 0) {
        if (t - st.lastUp < QCTL.FAILED_WITHIN_S * 1000) {                     // the last step up was too much: wait longer before the next try
          const up = st.level, wait = Math.min(QCTL.RETRY_MAX_S, (st.retryWait[up] || QCTL.RETRY_S / 2) * 2);
          st.retryWait[up] = wait; st.retryAt[up] = t + wait * 1000;
        }
        return { type: 'down', level: LEVEL_ORDER[i - 1] };
      }
      if (st.goodFor >= QCTL.UP_AFTER_S && gapOk && i < LEVEL_ORDER.length - 1) {
        const up = LEVEL_ORDER[i + 1];
        if (t < (st.retryAt[up] || 0)) return null;
        st.lastUp = t;
        return { type: 'up', level: up };
      }
      return null;
    },
    get beat() { return st.beat; },
    get target() { return target(); },
    get manual() { return st.manual; },
    get level() { return st.level; },
    stats: () => ({ level: st.level, manual: st.manual, beat: +st.beat.toFixed(2), target: +target().toFixed(2), median: +median(st.frames).toFixed(1), slowFor: +st.slowFor.toFixed(2), goodFor: +st.goodFor.toFixed(2), hintFor: +st.hintFor.toFixed(2), hinted: st.hinted, seen: st.seen, sixty: st.sixty, settling: now() < st.settleUntil }),
  };
}
