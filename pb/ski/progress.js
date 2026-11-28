/* The player's progress on this device (localStorage 'pb_ski_save'): best time and ghost per piste, runs per piste, the last resort and
 * piste, and room for the next rounds (stars per piste for the challenges, snowpark points). Pure helpers + a tiny store; every update
 * returns a NEW object (the stored one is never mutated). Leaderboard ids: 'ski-<resort>-<piste>' (the arcade's sub-board rule).
 * Times are milliseconds, lower is better (pixelbreak.html lowerIsBetter + scripts/ski-v1.sql). */
import { SAVE_KEY, GAME_ID, PLAY } from './config.js';

export const SAVE_VERSION = 1;
const MAX_GHOSTS = 40;
const BOARD_PREFIX = 'Ski Alpen · ';

export const pisteKey = (resortId, pisteId) => `${resortId}/${pisteId}`;
export const boardId = (resortId, pisteId) => `${GAME_ID}-${resortId}-${pisteId}`.slice(0, 48);
export const boardName = (pisteName, resortShort) => `${BOARD_PREFIX}${pisteName} (${resortShort})`.slice(0, 80);
/** The fastest time a run of this length can honestly take (ms); a faster one is never saved, ghosted or posted. */
export const minRunMs = (length) => Math.floor(length / PLAY.maxRunSpeed) * 1000;

export function emptyProgress() {
  // stars: { "<resort>/<hash5>": mask } and bestHash (the best times under the same short keys, for the cloud record): modes/challenges.js
  // park: { <resort>: best park points } (round 4A)
  // stats: { off: metres skied off the piste, top: top speed m/s } and ski: the picked ski type (round 6, modes/skis.js)
  return { v: SAVE_VERSION, best: {}, ghosts: {}, runs: {}, stars: {}, park: {}, bestHash: {}, last: null, ghostOrder: [], stats: { off: 0, top: 0 }, ski: 'allmountain', disc: {}, lawin: {}, goals: {}, lifts: {}, daily: { d: '', n: 0, s: 0, last: 0, streak: 0, best: 0 } };
}

export function normalize(raw) {
  const p = emptyProgress();
  if (!raw || typeof raw !== 'object' || raw.v !== SAVE_VERSION) return p;
  for (const [k, v] of Object.entries(raw.best || {})) if (Number.isFinite(v) && v > 0) p.best[k] = Math.round(v);
  for (const [k, v] of Object.entries(raw.ghosts || {})) if (typeof v === 'string' && v.length < 40000) p.ghosts[k] = v;
  for (const [k, v] of Object.entries(raw.runs || {})) if (Number.isInteger(v) && v > 0) p.runs[k] = v;
  for (const [k, v] of Object.entries(raw.stars && typeof raw.stars === 'object' ? raw.stars : {})) if (Number.isInteger(v) && v > 0 && v < 8) p.stars[k] = v;
  for (const [k, v] of Object.entries(raw.park && typeof raw.park === 'object' ? raw.park : {})) if (Number.isFinite(v) && v > 0) p.park[k] = Math.round(v);
  for (const [k, v] of Object.entries(raw.bestHash && typeof raw.bestHash === 'object' ? raw.bestHash : {})) if (Number.isFinite(v) && v > 0) p.bestHash[k] = Math.round(v);
  if (raw.stats && typeof raw.stats === 'object') p.stats = { off: Number.isFinite(raw.stats.off) && raw.stats.off > 0 ? Math.round(raw.stats.off) : 0, top: Number.isFinite(raw.stats.top) && raw.stats.top > 0 ? Math.min(60, raw.stats.top) : 0 };
  if (typeof raw.ski === 'string' && /^[a-z]{2,16}$/.test(raw.ski)) p.ski = raw.ski;
  if (raw.goofy === true) p.goofy = true;                  // 28 Nov 2026: snowboard stance, goofy = the right foot forward (absent = regular)
  // round 7-C: discovered cells per resort (modes/discovery.js run-length text) and the Lawin challenges won (bit mask per resort)
  for (const [k, v] of Object.entries(raw.disc && typeof raw.disc === 'object' ? raw.disc : {})) if (/^[a-z0-9]{1,16}$/.test(k) && typeof v === 'string' && v.length <= 12000 && /^[0-9a-z,]*$/.test(v)) p.disc[k] = v;
  for (const [k, v] of Object.entries(raw.lawin && typeof raw.lawin === 'object' ? raw.lawin : {})) if (/^[a-z0-9]{1,16}$/.test(k) && Number.isInteger(v) && v > 0 && v < 256) p.lawin[k] = v;
  // 28 Nov 2026 (goals, badges, daily challenge; modes/goals.js, modes/daily.js): reached goals (bit mask per resort), lifts ridden (one bit
  // per position of modes/lift-index.js, base64) and the daily challenge state
  for (const [k, v] of Object.entries(raw.goals && typeof raw.goals === 'object' ? raw.goals : {})) if (/^[a-z0-9]{1,16}$/.test(k) && Number.isInteger(v) && v > 0 && v < 4096) p.goals[k] = v;
  for (const [k, v] of Object.entries(raw.lifts && typeof raw.lifts === 'object' ? raw.lifts : {})) if (/^[a-z0-9]{1,16}$/.test(k) && typeof v === 'string' && v.length <= 400 && /^[A-Za-z0-9_-]+$/.test(v)) p.lifts[k] = v;
  if (raw.daily && typeof raw.daily === 'object') {
    const d = raw.daily, int = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : 0);
    p.daily = { d: typeof d.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.d) ? d.d : '', n: int(d.n, 1000), s: int(d.s, 1), last: int(d.last, 100000), streak: int(d.streak, 100000), best: int(d.best, 100000) };
  }
  if (raw.last && typeof raw.last.resort === 'string') p.last = { resort: raw.last.resort, piste: typeof raw.last.piste === 'string' ? raw.last.piste : null };
  p.ghostOrder = Array.isArray(raw.ghostOrder) ? raw.ghostOrder.filter((k) => p.ghosts[k]) : Object.keys(p.ghosts);
  return p;
}

/** A finished run: returns { progress, improved }. A ghost string is kept for the best run only (at most MAX_GHOSTS pistes, oldest out). */
export function recordRun(progress, key, ms, ghost) {
  const prev = progress.best[key];
  const improved = !(prev > 0) || ms < prev;
  const next = { ...progress, best: { ...progress.best }, ghosts: { ...progress.ghosts }, runs: { ...progress.runs, [key]: (progress.runs[key] || 0) + 1 }, ghostOrder: [...progress.ghostOrder] };
  if (improved) {
    next.best[key] = ms;
    if (ghost) {
      next.ghosts[key] = ghost;
      next.ghostOrder = next.ghostOrder.filter((k) => k !== key).concat(key);
      while (next.ghostOrder.length > MAX_GHOSTS) delete next.ghosts[next.ghostOrder.shift()];
    }
  }
  return { progress: next, improved };
}

export const withLast = (progress, resort, piste) => ({ ...progress, last: { resort, piste } });

export function createStore() {
  let progress = emptyProgress();
  try { progress = normalize(JSON.parse(localStorage.getItem(SAVE_KEY) || 'null')); } catch (error) { console.warn('[ski] save unreadable, starting fresh', error); }
  return {
    get: () => progress,
    set(next) {
      progress = next;
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(next)); } catch (error) { console.warn('[ski] could not save', error); }
      return progress;
    },
  };
}

/** m:ss.mmm */
export function formatTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), t = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(t).padStart(3, '0')}`;
}
/** m:ss.t (HUD, ticks every 100 ms) */
export function formatClock(ms) {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), t = Math.floor((ms % 1000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${t}`;
}

/** Arcade leaderboards: select the piste's board, post a time (ms, lower is better). */
export function createBoards(arcade) {
  const ok = () => Boolean(arcade && typeof arcade.setBoard === 'function' && typeof arcade.score === 'function');
  return {
    select(resortId, piste, resortShort) {
      if (!ok()) return false;
      try { arcade.setBoard({ id: boardId(resortId, piste.id), name: boardName(piste.name, resortShort), format: 'ski' }); return true; } catch (error) { console.warn('[ski] board select failed', error.message); return false; }
    },
    clear() { if (ok()) { try { arcade.setBoard(null); } catch (error) { console.warn('[ski] board clear failed', error.message); } } },
    submit(resortId, piste, resortShort, ms) {
      if (!ok() || !Number.isFinite(ms) || ms < minRunMs(piste.length)) return false;
      try { this.select(resortId, piste, resortShort); arcade.score(Math.round(ms)); return true; } catch (error) { console.warn('[ski] board submit failed', error.message); return false; }
    },
  };
}
