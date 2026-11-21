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
  return { v: SAVE_VERSION, best: {}, ghosts: {}, runs: {}, stars: {}, park: {}, last: null, ghostOrder: [] };
}

export function normalize(raw) {
  const p = emptyProgress();
  if (!raw || typeof raw !== 'object' || raw.v !== SAVE_VERSION) return p;
  for (const [k, v] of Object.entries(raw.best || {})) if (Number.isFinite(v) && v > 0) p.best[k] = Math.round(v);
  for (const [k, v] of Object.entries(raw.ghosts || {})) if (typeof v === 'string' && v.length < 40000) p.ghosts[k] = v;
  for (const [k, v] of Object.entries(raw.runs || {})) if (Number.isInteger(v) && v > 0) p.runs[k] = v;
  if (raw.stars && typeof raw.stars === 'object') p.stars = { ...raw.stars };
  if (raw.park && typeof raw.park === 'object') p.park = { ...raw.park };
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
