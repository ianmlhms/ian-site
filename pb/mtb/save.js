// MTB Mëllerdall persistence (adapted from pb/fouer/save.js, own copy, nothing imported from fouer).
//   - size guard: the game_saves table rejects rows whose jsonb is over 8192 bytes, so a save is estimated before it
//     is sent and shrunk deterministically (ghosts, then splits) when needed; medals, bests and unlocks never go
//   - pickBest: merge the injected, local, cloud and backup copies with mergeProgress
//   - createPersistence: debounced save, parent postMessage protocol (__pbSave / __pbWantSave / __pbLoadSave),
//     pagehide flush, arcade tile score, test mode. All DOM access goes through `env`, so Node tests use fakes.
//   - createScoreReporter / dailyRpc: leaderboard boards per trail and the daily challenge RPC bridge
import {
  SAVE_VERSION, TRAIL_IDS, DAILY_GAME, normalizeProgress, mergeProgress, overallScore, timeScore, boardId, toRunMs, ghostOrder,
} from './progress.js';

export { boardId, timeScore, scoreTime, overallScore } from './progress.js';

export const SAVE_LIMIT_BYTES = 7000;
export const JSONB_LIMIT_BYTES = 8192;
export const LOCAL_KEY = 'pb_mtb_save';
export const BACKUP_KEY = 'pb_mtb_bak';
export const SAVE_DELAY_MS = 1200;
export const MAX_SAVE_WAIT_MS = 5000;
export const BACKUP_INTERVAL_MS = 60000;
export const RPC_TIMEOUT_MS = 10000;
export const BOARD_NAME_PREFIX = 'MTB Mëllerdall · ';
export const BOARD_FORMAT = 'mtb';
const BOARD_NAME_MAX = 80;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// ---- size guard ----

const utf8 = (text) => new TextEncoder().encode(text).length;
const byteCompare = (a, b) => {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return x.length - y.length;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/** Stored size of an integer as a PostgreSQL numeric inside jsonb: 4-byte header + 2-byte numeric header + 2 bytes per
 * base-10000 digit group (trailing zero groups are not stored). Non-integers are costed generously. */
function numericBytes(value) {
  if (!Number.isInteger(value)) return 4 + 2 + 2 * (Math.ceil(String(Math.abs(value)).replace('.', '').length / 4) + 2);
  const text = String(Math.abs(value));
  const groups = [];
  for (let end = text.length; end > 0; end -= 4) groups.unshift(text.slice(Math.max(0, end - 4), end));
  while (groups.length && Number(groups[groups.length - 1]) === 0) groups.pop();
  return 4 + 2 + 2 * groups.length;
}

/** Replay of how PostgreSQL lays out a jsonb value (copy of the estimator in pb/fouer/save.js): 4-byte varlena header,
 * container header plus 4-byte entries, keys sorted by length then bytes, strings unpadded, numerics and containers
 * aligned to 4 bytes. */
export function jsonbSize(value) {
  let length = 4;
  const align = () => { length = Math.ceil(length / 4) * 4; };
  const write = (node) => {
    if (node === null || typeof node === 'boolean') return;
    if (typeof node === 'string') { length += utf8(node); return; }
    if (typeof node === 'number') { align(); length += numericBytes(node); return; }
    align();
    if (Array.isArray(node)) {
      length += 4 + 4 * node.length;
      node.forEach(write);
      return;
    }
    const keys = Object.keys(node).sort(byteCompare);
    length += 4 + 8 * keys.length;
    keys.forEach((key) => { length += utf8(key); });
    keys.forEach((key) => write(node[key]));
  };
  write(value);
  return length;
}

export const saveSizes = (progress) => ({ json: utf8(JSON.stringify(progress)), jsonb: jsonbSize(progress) });
const DEFAULT_LIMITS = Object.freeze({ jsonLimit: SAVE_LIMIT_BYTES, jsonbLimit: JSONB_LIMIT_BYTES });
export const fitsLimits = (progress, { jsonLimit, jsonbLimit } = DEFAULT_LIMITS) => {
  const sizes = saveSizes(progress);
  return sizes.json <= jsonLimit && sizes.jsonb < jsonbLimit;
};

const withoutKey = (record, key) => Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
const dropGhost = (progress, trailId) => normalizeProgress({ ...progress, g: withoutKey(progress.g, trailId) });
const dropSplits = (progress, trailId) => normalizeProgress({ ...progress, cp: withoutKey(progress.cp, trailId) });

/**
 * A NEW progress that fits the size limits, shrunk in a fixed order: the ghosts oldest first (the newest one is
 * kept as long as possible), then the splits of every trail but the newest ghost's trail, then that ghost, then its
 * splits. Medals, best times, viewpoints, daily data, stats and settings are never touched. When even that is not
 * enough the smallest version is returned (serializeProgress then throws).
 */
export function shrinkToFit(progress, limits = DEFAULT_LIMITS) {
  let current = normalizeProgress(progress);
  if (fitsLimits(current, limits)) return current;
  const order = ghostOrder(current);
  const focus = order.length ? order[order.length - 1] : null;
  const steps = [
    ...order.slice(0, -1).map((id) => (p) => dropGhost(p, id)),
    ...TRAIL_IDS.filter((id) => id !== focus).map((id) => (p) => dropSplits(p, id)),
    ...(focus ? [(p) => dropGhost(p, focus), (p) => dropSplits(p, focus)] : []),
  ];
  for (const step of steps) {
    current = step(current);
    if (fitsLimits(current, limits)) return current;
  }
  return current;
}

/** JSON text of a save, shrunk to fit; throws a descriptive Error when even the shrunk save is over the limits. */
export function serializeProgress(progress, limits = DEFAULT_LIMITS) {
  const record = shrinkToFit(progress, limits);
  const json = JSON.stringify(record);
  const sizes = saveSizes(record);
  if (!fitsLimits(record, limits)) {
    throw new Error(`MTB save is too large (${sizes.json} bytes, jsonb about ${sizes.jsonb}; limits ${limits.jsonLimit} / ${limits.jsonbLimit}) even without ghosts. Progress was not sent.`);
  }
  return json;
}

// ---- decode and merge ----

export function parseRaw(raw) {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch (error) { console.warn('[mtb] save is not valid JSON', error.message); return null; }
}

/** Normalised progress of one stored blob (object or JSON text), or null when it is not an MTB v1 save. */
export function decodeProgress(raw) {
  const data = parseRaw(raw);
  if (!isRecord(data) || data.v !== SAVE_VERSION) return null;
  return normalizeProgress(data);
}

/** Merge of every usable source (injected save, local copy, cloud, backup), or null when none decodes. */
export function pickBest(sources) {
  const list = Array.isArray(sources) ? sources : [];
  return list.map(decodeProgress).filter(Boolean).reduce((best, progress) => (best ? mergeProgress(best, progress) : progress), null);
}

const comparableKey = (progress) => JSON.stringify({ ...normalizeProgress(progress), t: 0 });

// ---- persistence ----

export function browserEnv(win = globalThis) {
  const storage = (() => {
    try { return win.localStorage ?? null; } catch (error) { console.warn('[mtb] localStorage is unavailable', error.message); return null; }
  })();
  const origin = (() => {
    try { return new URL(win.document.baseURI).origin; } catch { return win.location?.origin ?? '*'; }
  })();
  return {
    win, parent: win.parent, storage, origin, now: () => Date.now(),
    setTimeout: (fn, ms) => win.setTimeout(fn, ms), clearTimeout: (id) => win.clearTimeout(id),
  };
}

function readStorage(storage, key) {
  if (!storage) return null;
  try { return storage.getItem(key); } catch (error) { console.warn(`[mtb] could not read ${key}`, error.message); return null; }
}

/** Progress at start-up: injected window.__pbSave, local copy and backup merged (test mode: only the injected test save). */
export function loadInitialProgress(env = browserEnv()) {
  const { win, storage } = env;
  if (win.__pbTestMode === true) return pickBest([win.__pbSave]);
  return pickBest([win.__pbSave, readStorage(storage, LOCAL_KEY), readStorage(storage, BACKUP_KEY)]);
}

/** publishOverall: also post the medals-and-viewpoints number to the plain `mtb` arcade board (default). The game turns it off: its header and leaderboard show the trail times, and a trail board must never receive that number. */
export function createPersistence({ getState, onState, onError = () => {}, env = browserEnv(), publishOverall = true }) {
  const { win, parent, storage } = env;
  const isStandalone = !parent || parent === win;
  let timer = null, deadline = null, lastKey = null, lastError = null, lastBackup = -Infinity, lastScore = null;
  const isTestMode = () => win.__pbTestMode === true;
  const report = (message, cause) => {
    console.warn(`[mtb] ${message}`, cause ?? '');
    if (message !== lastError) onError(message);
    lastError = message;
  };
  const clearTimers = () => {
    env.clearTimeout(timer); env.clearTimeout(deadline);
    timer = deadline = null;
  };
  const publishScore = (progress) => {
    if (!publishOverall) return;
    const score = overallScore(progress);
    if (score === lastScore) return;
    lastScore = score;
    try { win.Arcade?.score(score); } catch (error) { console.warn('[mtb] could not publish the arcade score', error.message); }
  };
  const writeStorage = (key, json) => {
    if (!storage) return false;
    try { storage.setItem(key, json); return true; } catch (error) { console.warn(`[mtb] could not write ${key}`, error.message); return false; }
  };
  function writeBackup(json) {
    if (env.now() - lastBackup < BACKUP_INTERVAL_MS) return;
    if (writeStorage(BACKUP_KEY, json)) lastBackup = env.now();
  }
  function pushSave() {
    clearTimers();
    try {
      const state = getState();
      publishScore(state);
      if (isTestMode()) return true;
      const json = serializeProgress({ ...normalizeProgress(state), t: Math.floor(env.now() / 1000) });
      const record = JSON.parse(json);
      const key = JSON.stringify({ ...record, t: 0 });
      if (key === lastKey) return true;
      writeStorage(LOCAL_KEY, json);
      if (!isStandalone) parent.postMessage({ __pbSave: 1, data: record }, '*');
      writeBackup(json);
      lastKey = key; lastError = null;
      return true;
    } catch (error) { report('Could not save your ride.', error); return false; }
  }
  function scheduleSave() {
    try { publishScore(getState()); } catch (error) { report('Could not read the ride state.', error); return; }
    env.clearTimeout(timer);
    timer = env.setTimeout(pushSave, SAVE_DELAY_MS);
    if (deadline === null) deadline = env.setTimeout(pushSave, MAX_SAVE_WAIT_MS);
  }
  function applyIncoming(raw) {
    // Arcade test mode keeps its injected save: a cloud save must not replace it.
    if (isTestMode()) return false;
    const incoming = decodeProgress(raw);
    if (!incoming) {
      if (raw != null) console.warn('[mtb] ignored an unreadable cloud save');
      return false;
    }
    const current = getState();
    const merged = mergeProgress(current, incoming);
    if (comparableKey(merged) === comparableKey(current)) return false;
    onState(merged);
    scheduleSave();
    return true;
  }
  function receiveSave(event) {
    if (isStandalone || event.source !== parent || !isRecord(event.data)) return;
    if (event.data.__pbLoadSave === 1) applyIncoming(event.data.data);
  }
  win.addEventListener('message', receiveSave);
  win.addEventListener('pagehide', pushSave);
  try { publishScore(getState()); } catch (error) { report('Could not read the ride state.', error); }
  try { if (!isStandalone && !isTestMode()) parent.postMessage({ __pbWantSave: 1 }, '*'); }
  catch (error) { report('Could not request cloud progress. Your local ride is still open.', error); }
  return {
    applyIncoming, pushSave, scheduleSave, receiveSave,
    destroy() {
      clearTimers();
      win.removeEventListener('message', receiveSave);
      win.removeEventListener('pagehide', pushSave);
    },
  };
}

// ---- leaderboards ----

const boardName = (trailName, trailId) => {
  const name = typeof trailName === 'string' && trailName.trim() ? trailName.trim() : trailId;
  return (BOARD_NAME_PREFIX + name).slice(0, BOARD_NAME_MAX);
};

/**
 * Reporter for the arcade tile. The caller decides when a run is a personal best; this only names the right board
 * and sends timeScore(ms). `trailName(id)` (or a third argument) gives the display name. Without an `arcade`
 * (standalone page) every call is a harmless no-op returning false.
 */
/** minMsFor(trailId) = the shortest believable time of a trail (game.js minRunMs): anything faster is never posted. */
export function createScoreReporter({ arcade, trailName = (id) => id, minMsFor = () => 0 } = {}) {
  const available = () => Boolean(arcade && typeof arcade.setBoard === 'function' && typeof arcade.score === 'function');
  const nameFor = (trailId, name) => boardName(name ?? trailName(trailId), trailId);
  function selectBoard(trailId, name) {
    if (!available()) return false;
    try {
      if (trailId === null) { arcade.setBoard(null); return true; }
      if (!TRAIL_IDS.includes(trailId)) { console.warn('[mtb] unknown trail for the leaderboard', trailId); return false; }
      arcade.setBoard({ id: boardId(trailId), name: nameFor(trailId, name), format: BOARD_FORMAT });
      return true;
    } catch (error) { console.warn('[mtb] could not select the leaderboard', error.message); return false; }
  }
  function submitRun(trailId, ms, name) {
    if (!available()) return false;
    const score = timeScore(ms);
    if (score === null || !TRAIL_IDS.includes(trailId)) { console.warn('[mtb] ignored an invalid leaderboard run', trailId, ms); return false; }
    if (ms < minMsFor(trailId)) { console.warn('[mtb] ignored an impossible leaderboard time', trailId, ms); return false; }
    if (!selectBoard(trailId, name)) return false;
    try { arcade.score(score); return true; } catch (error) { console.warn('[mtb] could not submit the run', error.message); return false; }
  }
  return { submitRun, selectBoard };
}

// ---- daily challenge RPC (same bridge as pb/paket-express/daily.js) ----

/** { board(), submit(ms), destroy() } over parent.postMessage({__pbRpc}) / {__pbRpcRes}; rejects with Error('signed-out') standalone. */
export function dailyRpc(env = browserEnv()) {
  const { win, parent } = env;
  const pending = new Map();
  let nextId = 0;
  const onMessage = (event) => {
    if (!parent || event.source !== parent || event.origin !== env.origin) return;
    const response = isRecord(event.data) ? event.data.__pbRpcRes : null;
    const request = isRecord(response) ? pending.get(response.id) : null;
    if (!request) return;
    env.clearTimeout(request.timer);
    pending.delete(response.id);
    if (response.error) request.reject(new Error(String(response.error)));
    else request.resolve(response.data);
  };
  win.addEventListener('message', onMessage);
  function rpc(fn, args) {
    return new Promise((resolve, reject) => {
      if (!parent || parent === win) { reject(new Error('signed-out')); return; }
      const id = `mtb-${++nextId}`;
      const timer = env.setTimeout(() => { pending.delete(id); reject(new Error('RPC timeout')); }, RPC_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      try { parent.postMessage({ __pbRpc: { id, fn, args } }, env.origin); }
      catch (error) { env.clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  return {
    board: () => rpc('daily_board', { p_game: DAILY_GAME }),
    submit(ms) {
      const valid = toRunMs(ms);
      if (valid === null) return Promise.reject(new Error('invalid-time'));
      return rpc('submit_daily_score', { p_game: DAILY_GAME, p_score: timeScore(valid) });
    },
    destroy() {
      win.removeEventListener('message', onMessage);
      for (const [id, request] of pending) { env.clearTimeout(request.timer); request.reject(new Error('closed')); pending.delete(id); }
    },
  };
}
