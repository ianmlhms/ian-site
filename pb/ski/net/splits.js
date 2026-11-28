/* Split times of a race for the spectators (pure: no DOM, no network). A racer's state carries his progress (metres along the piste);
 * the first state at or past 20 / 40 / 60 / 80 % of the piste gives his split time (ms since the start of the run). The table shows the
 * gap to the leader at the last split both have passed. Nothing here ever decides a result: official times are the racers' own 'fin'. */
import { SPEC } from './config.js';

export function createSplits({ length, count = SPEC.SPLITS }) {
  const marks = Array.from({ length: count }, (_, i) => Math.round((length * (i + 1)) / (count + 1)));
  const times = new Map();                  // id -> [ms | undefined, ...]
  return {
    marks,
    reset() { times.clear(); },
    /** a state of `id`: progress (m) reached at `elapsed` ms after the start */
    note(id, elapsed, progress) {
      if (!Number.isFinite(elapsed) || !Number.isFinite(progress) || elapsed < 0) return;
      let t = times.get(id);
      if (!t) { t = []; times.set(id, t); }
      for (let k = 0; k < marks.length; k++) if (t[k] === undefined && progress >= marks[k]) t[k] = Math.round(elapsed);
    },
    /** how many splits `id` has passed */
    passed(id) { const t = times.get(id) || []; let n = 0; while (n < marks.length && t[n] !== undefined) n++; return n; },
    time(id, k) { const t = times.get(id); return t ? t[k] : undefined; },
    /** gap (ms) of `id` to `leader` at the last split they both passed, or null (none yet / same racer) */
    gap(id, leader) {
      if (id === leader) return null;
      const n = Math.min(this.passed(id), this.passed(leader));
      if (n < 1) return null;
      return this.time(id, n - 1) - this.time(leader, n - 1);
    },
  };
}

/** "+1.3" / "-0.4" seconds with one decimal (Luxembourg uses the point in the game's times as well) */
export const gapText = (ms) => `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(1)}`;
