/* A racer's run as received (28 Nov 2026; online race replay of the winner). The states of the OTHER racers already arrive over the
 * links (the unreliable stream, net/wire.js packState: 16 numbers); a small log keeps them per racer for the current run so that «Replay»
 * can show the winner's run too. Nothing more is sent, nothing is uploaded. Pure (Node tests import it).
 *   - 8 samples per second at most, timed by the SENDER's clock (m.t: no network jitter in the replay), one Float32 row of 17 numbers
 *     [t, 16 wire numbers]; the table grows by doubling from 20 s and stops after MAX_S: ~80 KB for a 150 s run
 *   - starts when the racer moves (the countdown's standing states are left out), ends at his first state with the finished flag
 *   - logToClip() turns it into a replay clip with the SAME recorder code the own run uses (replay.js createRecorder). */
export const LOG = Object.freeze({ HZ: 8, MAX_S: 150, ROW: 17, WIRE: 16, FIRST_S: 20 });
const FINISHED = 2;

export function createSampleLog() {
  let rows = new Float32Array(LOG.ROW * LOG.HZ * LOG.FIRST_S), n = 0, lastT = -1e9, started = false, done = false, t0 = 0;
  return {
    get count() { return n; },
    get done() { return done; },
    get bytes() { return rows.byteLength; },
    /** t = the sender's clock (ms), a = the wire array; false when it was not kept. */
    push(t, a) {
      if (done || !Number.isFinite(t) || !Array.isArray(a) || a.length < LOG.WIRE) return false;
      for (let i = 0; i < LOG.WIRE; i++) if (typeof a[i] !== 'number' || !Number.isFinite(a[i])) return false;
      const moving = a[4] > 0.5 || a[12] > 0;                         // speed / progress
      if (!started) { if (!moving) return false; started = true; t0 = t; }
      if (t < lastT || t - lastT < 1000 / LOG.HZ - 6) return false;
      if ((t - t0) / 1000 > LOG.MAX_S) { done = true; return false; }
      if ((n + 1) * LOG.ROW > rows.length) { const bigger = new Float32Array(rows.length * 2); bigger.set(rows); rows = bigger; }
      const o = n * LOG.ROW;
      rows[o] = (t - t0) / 1000;
      for (let i = 0; i < LOG.WIRE; i++) rows[o + 1 + i] = a[i];
      n++; lastT = t;
      if ((a[8] | 0) & FINISHED) done = true;
      return true;
    },
    /** The row i as a wire array (16 numbers) with its time (s). */
    row(i) { const o = i * LOG.ROW; return { t: rows[o], a: Array.from(rows.subarray(o + 1, o + 1 + LOG.WIRE)) }; },
    clear() { n = 0; lastT = -1e9; started = false; done = false; },
  };
}

/** A replay clip (replay.js format) from a log, or null when it is shorter than minSeconds. unpack = net/wire.js unpackState, makeRecorder = replay.js createRecorder. */
export function logToClip(log, { unpack, makeRecorder, minSeconds = 2 }) {
  if (!log || log.count < 4) return null;
  const last = log.row(log.count - 1), seconds = last.t + 2;
  if (last.t < minSeconds) return null;
  const rec = makeRecorder({ seconds, hz: 20 });
  let prev = 0, template = null;
  for (let i = 0; i < log.count; i++) {
    const r = log.row(i), st = unpack(r.a);
    if (!st) continue;
    template = st;
    rec.push(st, i ? Math.max(0.06, r.t - prev) : 0.001);
    prev = r.t;
  }
  return template ? rec.snapshot(seconds, template) : null;
}
