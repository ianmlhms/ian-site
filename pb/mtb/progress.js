// MTB Mëllerdall progress model (pure ES module: no DOM, no THREE, no storage).
//
// The progress object IS the save record: short keys, strings and small integers only (ghosts are strings), so it
// can be sent to the game_saves table as it is. Everything is immutable: every function returns a new object and
// every input is validated and clamped by normalizeProgress at the boundary.
//
//   v   save version (1)                       tb  progress points, monotone (the server keeps the larger tb)
//   m   medals, 6 digits '0'..'3'              b   best ms per trail, base 36 joined by ',' ('' = none)
//   cp  {trail: 'split,split,...'} base 36     g   {trail: ghost string}, at most 3, go = their order (oldest first)
//   bk  bike   col  colour   hm  helmet        vp  viewpoint bitmask, base 36 (64 bits)
//   dy  [day number, best ms]  ds streak       dm  longest streak ever (feeds tb; ds can reset, tb must not drop)
//   st  {km (x10), rides, crashes, air (s)}    se  sparse settings (only keys the player changed)
//   n   player name (optional, 12 chars)       t   time of the last save, seconds
import { decodeGhost } from './ghost.js';

export const SAVE_VERSION = 1;
export const TRAIL_IDS = Object.freeze(['ernz-waldwee', 'hallerbach-flow', 'schiessentuempel', 'binzelt-rocks', 'waschbrunnen-black', 'maratoun']);
export const MARATHON_ID = 'maratoun';
export const BIKE_IDS = Object.freeze(['hardtail', 'trail', 'enduro', 'downhill']);
export const COLOUR_IDS = Object.freeze(['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'black', 'white']);
export const HELMET_IDS = Object.freeze(['plain', 'stripe', 'flame', 'gold']);
export const MEDAL_NAMES = Object.freeze(['none', 'bronze', 'silver', 'gold']);
export const MAX_MEDAL = 3;
export const BIKE_MEDAL_POINTS = Object.freeze({ hardtail: 0, trail: 3, enduro: 8, downhill: 14 });
export const COLOUR_POINTS_STEP = 2;     // colour k >= 2 needs COLOUR_POINTS_STEP * (k - 1) points
export const HELMET_POINTS_STEP = 4;     // helmet k needs HELMET_POINTS_STEP * k points
export const MAX_VIEWPOINTS = 64;
export const MAX_GHOSTS = 3;
export const GHOST_MAX_CHARS = 1800;
export const MAX_CHECKPOINTS = 24;
export const MIN_RUN_MS = 1000;
export const MAX_RUN_MS = 10_000_000;
export const SCORE_BASE = 10_000_000;
export const MAX_STREAK = 999;
export const MAX_DAY = 200_000;          // Luxembourg day number (days since 1970)
export const NAME_MAX = 12;
export const MAX_SAVE_TIME = 4_102_444_800;
export const DEFAULT_BIKE = 'hardtail';
export const DEFAULT_COLOUR = 'red';
export const DEFAULT_HELMET = 'plain';
export const DAILY_TIMES = Object.freeze(['morning', 'noon', 'evening', 'dawn']);
export const DAILY_WEATHER = Object.freeze([['clear', 4], ['cloudy', 2], ['fog', 1], ['rain', 2]]);
export const DAILY_GAME = 'mtb-daily';
export const SETTING_OPTIONS = Object.freeze({
  lang: Object.freeze(['lb', 'de', 'en', 'fr']),
  q: Object.freeze(['auto', 'low', 'medium', 'high']),
  time: Object.freeze(['random', 'morning', 'noon', 'evening', 'dawn']),
  weather: Object.freeze(['random', 'clear', 'cloudy', 'fog', 'rain']),
  season: Object.freeze(['auto', 'spring', 'summer', 'autumn', 'winter']),
  snd: Object.freeze([0, 1]),
  cam: Object.freeze([0, 1, 2]),
});
export const DEFAULT_SETTINGS = Object.freeze({ lang: 'en', q: 'auto', time: 'random', weather: 'random', season: 'auto', snd: 1, cam: 0 });
const STAT_LIMITS = Object.freeze({ km: 9_999_999, rides: 999_999, crashes: 999_999, air: 9_999_999 });
const VIEWPOINT_MASK = (1n << BigInt(MAX_VIEWPOINTS)) - 1n;
const TRAIL_COUNT = TRAIL_IDS.length;
const SPLIT_PATTERN = /^[0-9a-z]{1,6}$/;
const VIEWPOINT_PATTERN = /^[0-9a-z]{1,13}$/;
const MAX_FIELD_CHARS = 4096;
const DAY_MS = 86_400_000;

// ---- small helpers ----

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (record, key) => (isRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const toInt = (value, fallback, min, max) => (isFiniteNumber(value) ? Math.floor(clamp(value, min, max)) : fallback);
const shortText = (value) => (typeof value === 'string' ? value.slice(0, MAX_FIELD_CHARS) : '');
const trailIndex = (trailId) => TRAIL_IDS.indexOf(trailId);

/** A run time in whole ms, or null when it is not a finite number in [1000, 10 000 000). */
export function toRunMs(ms) {
  if (!isFiniteNumber(ms)) return null;
  const rounded = Math.round(ms);
  return rounded >= MIN_RUN_MS && rounded < MAX_RUN_MS ? rounded : null;
}

function parseBase36(text, maxLength) {
  if (typeof text !== 'string' || text.length === 0 || text.length > maxLength || !/^[0-9a-z]+$/.test(text)) return NaN;
  return parseInt(text, 36);
}

function parseBigBase36(text) {
  if (typeof text !== 'string' || !VIEWPOINT_PATTERN.test(text)) return 0n;
  let value = 0n;
  for (const char of text) value = value * 36n + BigInt(parseInt(char, 36));
  return value & VIEWPOINT_MASK;
}

function bigToBase36(value) {
  if (value === 0n) return '0';
  const digits = [];
  for (let rest = value; rest > 0n; rest /= 36n) digits.push(Number(rest % 36n).toString(36));
  return digits.reverse().join('');
}

// ---- medals, bests, points ----

const medalValues = (progress) => Array.from({ length: TRAIL_COUNT }, (_, i) => {
  const digit = Number(typeof progress?.m === 'string' ? progress.m[i] : 0);
  return Number.isInteger(digit) ? clamp(digit, 0, MAX_MEDAL) : 0;
});

function bestValues(progress) {
  const entries = typeof progress?.b === 'string' ? progress.b.slice(0, MAX_FIELD_CHARS).split(',') : [];
  return Array.from({ length: TRAIL_COUNT }, (_, i) => {
    const value = toRunMs(parseBase36(entries[i], 6));
    return value ?? 0;
  });
}

const encodeMedals = (medals) => medals.join('');
const encodeBests = (bests) => bests.map((ms) => (ms > 0 ? ms.toString(36) : '')).join(',');

export const medalPoints = (progress) => medalValues(progress).reduce((sum, value) => sum + value, 0);
export const medalOf = (progress, trailId) => medalValues(progress)[trailIndex(trailId)] ?? 0;
export const bestMs = (progress, trailId) => bestValues(progress)[trailIndex(trailId)] ?? 0;
export const bestTimes = (progress) => Object.fromEntries(bestValues(progress).map((ms, i) => [TRAIL_IDS[i], ms]));

// ---- viewpoints ----

export const viewpointCount = (vp) => {
  let bits = parseBigBase36(vp), count = 0;
  for (; bits > 0n; bits >>= 1n) count += Number(bits & 1n);
  return count;
};

export const hasViewpoint = (vp, index) =>
  Number.isInteger(index) && index >= 0 && index < MAX_VIEWPOINTS && ((parseBigBase36(vp) >> BigInt(index)) & 1n) === 1n;

/** vp with bit `index` set (a new string; an invalid index returns the cleaned input unchanged). */
export const withViewpoint = (vp, index) => {
  const bits = parseBigBase36(vp);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_VIEWPOINTS) return bigToBase36(bits);
  return bigToBase36(bits | (1n << BigInt(index)));
};

const mergeViewpoints = (a, b) => bigToBase36(parseBigBase36(a) | parseBigBase36(b));

// ---- unlock rules ----

export function isTrailUnlocked(progress, trailId) {
  const index = trailIndex(trailId);
  if (index < 0) return false;
  return index === 0 || medalValues(progress)[index - 1] >= 1;
}

export const unlockedTrails = (progress) => TRAIL_IDS.filter((id) => isTrailUnlocked(progress, id));

export function isBikeUnlocked(progress, bikeId) {
  const need = BIKE_MEDAL_POINTS[bikeId];
  return Object.hasOwn(BIKE_MEDAL_POINTS, bikeId) && medalPoints(progress) >= need;
}
export const unlockedBikes = (progress) => BIKE_IDS.filter((id) => isBikeUnlocked(progress, id));

const colourPoints = (index) => (index < 2 ? 0 : COLOUR_POINTS_STEP * (index - 1));
const helmetPoints = (index) => HELMET_POINTS_STEP * index;
export const unlockedColours = (progress) => COLOUR_IDS.filter((_, i) => medalPoints(progress) >= colourPoints(i));
export const unlockedHelmets = (progress) => HELMET_IDS.filter((_, i) => medalPoints(progress) >= helmetPoints(i));
export const isColourUnlocked = (progress, id) => unlockedColours(progress).includes(id);
export const isHelmetUnlocked = (progress, id) => unlockedHelmets(progress).includes(id);

const emptyUnlocks = () => ({ trails: [], bikes: [], colours: [], helmets: [] });
const added = (before, after) => after.filter((id) => !before.includes(id));

/** What `after` unlocked compared with `before`: { trails, bikes, colours, helmets } (ids), for the "unlocked!" toast. */
export function newUnlocks(before, after) {
  return {
    trails: added(unlockedTrails(before), unlockedTrails(after)),
    bikes: added(unlockedBikes(before), unlockedBikes(after)),
    colours: added(unlockedColours(before), unlockedColours(after)),
    helmets: added(unlockedHelmets(before), unlockedHelmets(after)),
  };
}

// ---- score <-> time, board ids ----

/** Arcade score for a run time (higher is better), or null when the time is not valid. */
export function timeScore(ms) {
  const valid = toRunMs(ms);
  return valid === null ? null : SCORE_BASE - valid;
}

/** Run time in ms for an arcade score, or null when the score is not one of ours. */
export function scoreTime(score) {
  return isFiniteNumber(score) && Number.isInteger(score) ? toRunMs(SCORE_BASE - score) : null;
}

/** Arcade board id of a trail: 'mtb-' + trail id (<= 48 chars, matches /^[a-z0-9-]{1,48}$/). */
export const boardId = (trailId) => `mtb-${trailId}`;

export function progressPoints(progress) {
  const trailsWithBest = bestValues(progress).filter((ms) => ms > 0).length;
  const streak = toInt(progress?.dm, 0, 0, MAX_STREAK);
  return medalPoints(progress) * 1000 + viewpointCount(progress?.vp) * 10 + trailsWithBest + streak;
}

/** Number for the plain arcade tile: medal points, viewpoints and the speed of the bests; monotone with progress. */
export function overallScore(progress) {
  const speed = bestValues(progress).reduce((sum, ms) => {
    const score = ms > 0 ? timeScore(ms) : null;
    return score === null ? sum : sum + Math.round(score / 100000);
  }, 0);
  return medalPoints(progress) * 10000 + viewpointCount(progress?.vp) * 100 + speed;
}

// ---- splits and ghosts ----

function parseSplits(text, limitMs) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_FIELD_CHARS) return null;
  const parts = text.split(',');
  if (parts.length > MAX_CHECKPOINTS) return null;
  const values = parts.map((part) => parseBase36(part, 6));
  const ascending = values.every((value, i) => Number.isInteger(value) && value >= 1 && value <= limitMs && (i === 0 || value > values[i - 1]));
  return ascending ? values : null;
}

/** Split times (ms, ascending) of the best run on a trail, [] when unknown. */
export const bestSplits = (progress, trailId) => parseSplits(own(progress?.cp, trailId), MAX_RUN_MS) ?? [];

/** Decoded ghost (see ghost.js) of the best run on a trail, or null. */
export const ghostFor = (progress, trailId) => {
  const text = own(progress?.g, trailId);
  return typeof text === 'string' ? decodeGhost(text) : null;
};

const ghostOrderIndices = (go) => [...shortText(go)].map(Number).filter((n, i, all) => Number.isInteger(n) && n >= 0 && n < TRAIL_COUNT && all.indexOf(n) === i);

/** Trail ids that hold a ghost, oldest first (the order lives in `go`, because jsonb does not keep key order). */
export function ghostOrder(progress) {
  const held = TRAIL_IDS.filter((id) => typeof own(progress?.g, id) === 'string');
  const ordered = ghostOrderIndices(progress?.go).map((i) => TRAIL_IDS[i]).filter((id) => held.includes(id));
  return [...held.filter((id) => !ordered.includes(id)), ...ordered];
}

// ---- normalisation ----

function cleanName(value) {
  if (typeof value !== 'string') return '';
  const text = value.slice(0, 64).replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  return [...text].slice(0, NAME_MAX).join('').trim();
}

function cleanSettings(raw) {
  const settings = {};
  for (const [key, options] of Object.entries(SETTING_OPTIONS)) {
    const value = own(raw, key);
    if (options.includes(value)) settings[key] = value;
  }
  return settings;
}

function cleanStats(raw) {
  return Object.fromEntries(Object.entries(STAT_LIMITS).map(([key, max]) => [key, toInt(own(raw, key), 0, 0, max)]));
}

function cleanDaily(raw) {
  if (!Array.isArray(raw) || raw.length !== 2) return [0, 0];
  const day = toInt(raw[0], 0, 0, MAX_DAY);
  const ms = isFiniteNumber(raw[1]) ? toRunMs(raw[1]) : null;
  return day > 0 && ms !== null ? [day, ms] : [0, 0];
}

function cleanSplitsFor(raw, bests) {
  const cp = {};
  TRAIL_IDS.forEach((id, i) => {
    if (bests[i] <= 0) return;
    const values = parseSplits(own(raw, id), bests[i]);
    if (values) cp[id] = values.map((value) => value.toString(36)).join(',');
  });
  return cp;
}

function cleanGhosts(rawGhosts, rawOrder, bests) {
  const valid = TRAIL_IDS.filter((id, i) => {
    const text = own(rawGhosts, id);
    return bests[i] > 0 && typeof text === 'string' && text.length <= GHOST_MAX_CHARS && decodeGhost(text) !== null;
  });
  const ordered = ghostOrderIndices(rawOrder).map((i) => TRAIL_IDS[i]).filter((id) => valid.includes(id));
  const oldestFirst = [...valid.filter((id) => !ordered.includes(id)), ...ordered].slice(-MAX_GHOSTS);
  return {
    g: Object.fromEntries(oldestFirst.map((id) => [id, rawGhosts[id]])),
    go: oldestFirst.map((id) => trailIndex(id)).join(''),
  };
}

function parseInput(raw) {
  if (typeof raw !== 'string') return raw;
  if (raw.length > 100_000) return null;
  try { return JSON.parse(raw); } catch (error) { console.warn('[mtb] progress is not valid JSON', error.message); return null; }
}

/** Fresh progress: nothing done, the first trail open, hardtail in red. */
export function createProgress() {
  return {
    v: SAVE_VERSION, tb: 0, m: '000000', b: ',,,,,', cp: {}, g: {}, go: '',
    bk: DEFAULT_BIKE, col: DEFAULT_COLOUR, hm: DEFAULT_HELMET, vp: '0', dy: [0, 0], ds: 0, dm: 0,
    st: { km: 0, rides: 0, crashes: 0, air: 0 }, se: {}, t: 0,
  };
}

/**
 * Validate and clamp EVERY field of untrusted input (an object or a JSON string) into a fresh progress object.
 * Unknown keys and trail ids are dropped, `tb` is recomputed, a selected bike/colour/helmet that is not unlocked
 * falls back to the default. Never throws.
 */
export function normalizeProgress(raw) {
  const data = parseInput(raw);
  const medals = Array.from({ length: TRAIL_COUNT }, (_, i) => {
    const text = shortText(own(data, 'm'));
    const digit = Number(text[i]);
    return Number.isInteger(digit) ? clamp(digit, 0, MAX_MEDAL) : 0;
  });
  const bests = bestValues({ b: shortText(own(data, 'b')) });
  const { g, go } = cleanGhosts(own(data, 'g'), own(data, 'go'), bests);
  const points = medals.reduce((sum, value) => sum + value, 0);
  const pick = (key, ids, isOpen, fallback) => {
    const value = own(data, key);
    return ids.includes(value) && isOpen(value, points) ? value : fallback;
  };
  const ds = toInt(own(data, 'ds'), 0, 0, MAX_STREAK);
  const progress = {
    v: SAVE_VERSION, tb: 0,
    m: encodeMedals(medals), b: encodeBests(bests), cp: cleanSplitsFor(own(data, 'cp'), bests), g, go,
    bk: pick('bk', BIKE_IDS, (id, p) => p >= BIKE_MEDAL_POINTS[id], DEFAULT_BIKE),
    col: pick('col', COLOUR_IDS, (id, p) => p >= colourPoints(COLOUR_IDS.indexOf(id)), DEFAULT_COLOUR),
    hm: pick('hm', HELMET_IDS, (id, p) => p >= helmetPoints(HELMET_IDS.indexOf(id)), DEFAULT_HELMET),
    vp: bigToBase36(parseBigBase36(own(data, 'vp'))),
    dy: cleanDaily(own(data, 'dy')), ds, dm: Math.max(ds, toInt(own(data, 'dm'), 0, 0, MAX_STREAK)),
    st: cleanStats(own(data, 'st')), se: cleanSettings(own(data, 'se')),
    t: toInt(own(data, 't'), 0, 0, MAX_SAVE_TIME),
  };
  const name = cleanName(own(data, 'n'));
  const withName = name ? { ...progress, n: name } : progress;
  return { ...withName, tb: progressPoints(withName) };
}

// ---- merge: never lose progress ----

const emptyOr = (value) => (value > 0 ? value : Infinity);

function mergeDaily(a, b) {
  const [dayA, msA] = a.dy, [dayB, msB] = b.dy;
  if (dayA !== dayB) {
    const later = dayA > dayB ? a : b;
    return { dy: [...later.dy], ds: later.ds };
  }
  const best = Math.min(emptyOr(msA), emptyOr(msB));
  return { dy: [dayA, Number.isFinite(best) ? best : 0], ds: Math.max(a.ds, b.ds) };
}

/** Which side owns the best run of a trail: 'a', 'b' or null. A tie goes to the side that holds a ghost, then to a. */
function bestOwner(a, b, trailId, index) {
  const bestA = bestValues(a)[index], bestB = bestValues(b)[index];
  if (bestA === 0 && bestB === 0) return null;
  if (bestB === 0 || (bestA > 0 && bestA < bestB)) return 'a';
  if (bestA === 0 || bestB < bestA) return 'b';
  return typeof own(b.g, trailId) === 'string' && typeof own(a.g, trailId) !== 'string' ? 'b' : 'a';
}

/**
 * Merge two progress objects (either order) into a new one that loses nothing: medals max, best times min over
 * times > 0, viewpoints OR, counters max, daily: the later day wins (same day: the lower time, the larger streak),
 * the longest streak max. The ghost and the splits of a trail come from the side that owns its best time (the
 * ghost of a slower run is stale and never survives); the ghost order puts the older save's ghosts first.
 * Selection (bike, colour, helmet), name and settings come from the save with the larger `t` (a tie goes to `b`);
 * a setting only one side has is kept, a setting both have follows the newer side. The result is normalised, so
 * a selection that is not unlocked falls back to the default and `tb` is recomputed.
 */
export function mergeProgress(a, b) {
  const left = normalizeProgress(a), right = normalizeProgress(b);
  const newer = right.t >= left.t ? right : left;
  const older = newer === right ? left : right;
  const medalsA = medalValues(left), medalsB = medalValues(right);
  const bestsA = bestValues(left), bestsB = bestValues(right);
  const owners = TRAIL_IDS.map((id, i) => bestOwner(left, right, id, i));
  const sources = { a: left, b: right };
  const cp = {}, ghosts = {};
  TRAIL_IDS.forEach((id, i) => {
    const owner = owners[i];
    if (!owner) return;
    const other = owner === 'a' ? right : left;
    const splits = own(sources[owner].cp, id) ?? (bestsA[i] === bestsB[i] ? own(other.cp, id) : undefined);
    if (splits) cp[id] = splits;
    const ghost = own(sources[owner].g, id);
    if (typeof ghost === 'string') ghosts[id] = ghost;
  });
  const order = [...ghostOrder(older), ...ghostOrder(newer)].filter((id, i, all) => all.lastIndexOf(id) === i && Object.hasOwn(ghosts, id));
  const merged = {
    v: SAVE_VERSION, tb: 0,
    m: encodeMedals(medalsA.map((value, i) => Math.max(value, medalsB[i]))),
    b: encodeBests(bestsA.map((value, i) => { const best = Math.min(emptyOr(value), emptyOr(bestsB[i])); return Number.isFinite(best) ? best : 0; })),
    cp, g: ghosts, go: order.map((id) => trailIndex(id)).join(''),
    bk: newer.bk, col: newer.col, hm: newer.hm,
    vp: mergeViewpoints(left.vp, right.vp),
    ...mergeDaily(left, right), dm: Math.max(left.dm, right.dm),
    st: Object.fromEntries(Object.keys(STAT_LIMITS).map((key) => [key, Math.max(left.st[key], right.st[key])])),
    se: { ...older.se, ...newer.se },
    t: Math.max(left.t, right.t),
  };
  const name = newer.n || older.n || '';
  return normalizeProgress(name ? { ...merged, n: name } : merged);
}

// ---- recording ----

const replaceAt = (text, index, value) => text.slice(0, index) + value + text.slice(index + 1);

function cleanSplitsInput(checkpointsMs, runMs) {
  if (!Array.isArray(checkpointsMs) || checkpointsMs.length === 0 || checkpointsMs.length > MAX_CHECKPOINTS) return null;
  const values = checkpointsMs.map((value) => (isFiniteNumber(value) ? Math.round(value) : NaN));
  const ok = values.every((value, i) => value >= 1 && value <= runMs && (i === 0 || value > values[i - 1]));
  return ok ? values.map((value) => value.toString(36)).join(',') : null;
}

/**
 * Record a finished run. Returns { progress, isBest, newMedal, unlocks }. The medal is max(old, new); the best
 * time, the best run's splits (`cp`) and its ghost are replaced only by a new best. The ghost is kept for the 3
 * trails with the most recent bests; a new best without a valid ghost removes the stale ghost of the old best.
 * An invalid trail id or time returns the progress unchanged.
 */
export function recordRun(progress, { trailId, ms, checkpointsMs, ghostText, medal } = {}) {
  const base = normalizeProgress(progress);
  const unchanged = { progress: base, isBest: false, newMedal: false, unlocks: emptyUnlocks() };
  const index = trailIndex(trailId);
  const time = toRunMs(ms);
  if (index < 0 || time === null) { console.warn('[mtb] ignored an invalid run', trailId, ms); return unchanged; }
  const bests = bestValues(base), medals = medalValues(base);
  const isBest = bests[index] === 0 || time < bests[index];
  const medalValue = toInt(medal, 0, 0, MAX_MEDAL);
  const newMedal = medalValue > medals[index];
  if (!isBest && !newMedal) return unchanged;
  const draft = { ...base, m: replaceAt(base.m, index, String(Math.max(medals[index], medalValue))) };
  if (isBest) {
    const splits = cleanSplitsInput(checkpointsMs, time);
    const hasGhost = typeof ghostText === 'string' && ghostText.length <= GHOST_MAX_CHARS && decodeGhost(ghostText) !== null;
    const order = ghostOrder(base).filter((id) => id !== trailId);
    const { [trailId]: oldSplits, ...otherSplits } = base.cp;
    const { [trailId]: oldGhost, ...otherGhosts } = base.g;
    draft.b = encodeBests(bests.map((value, i) => (i === index ? time : value)));
    draft.cp = splits ? { ...otherSplits, [trailId]: splits } : otherSplits;
    draft.g = hasGhost ? { ...otherGhosts, [trailId]: ghostText } : otherGhosts;
    draft.go = (hasGhost ? [...order, trailId] : order).map((id) => trailIndex(id)).join('');
  }
  const result = normalizeProgress(draft);
  return { progress: result, isBest, newMedal, unlocks: newUnlocks(base, result) };
}

/** Record a viewpoint (0..63) found in free ride: { progress, isNew, count }. */
export function recordViewpoint(progress, index) {
  const base = normalizeProgress(progress);
  const valid = Number.isInteger(index) && index >= 0 && index < MAX_VIEWPOINTS;
  if (!valid) { console.warn('[mtb] ignored an invalid viewpoint', index); return { progress: base, isNew: false, count: viewpointCount(base.vp) }; }
  if (hasViewpoint(base.vp, index)) return { progress: base, isNew: false, count: viewpointCount(base.vp) };
  const result = normalizeProgress({ ...base, vp: withViewpoint(base.vp, index) });
  return { progress: result, isNew: true, count: viewpointCount(result.vp) };
}

/**
 * Record a finished daily challenge for Luxembourg day `day`: { progress, isBest, streak }. A new day extends the
 * streak when it is the day after the last one played, otherwise the streak restarts at 1; the same day only
 * improves the time; an older day changes nothing.
 */
export function recordDaily(progress, { day, ms } = {}) {
  const base = normalizeProgress(progress);
  const time = toRunMs(ms);
  const unchanged = { progress: base, isBest: false, streak: base.ds };
  if (!Number.isInteger(day) || day < 1 || day > MAX_DAY || time === null) { console.warn('[mtb] ignored an invalid daily result', day, ms); return unchanged; }
  const [lastDay, lastBest] = base.dy;
  if (day < lastDay) return unchanged;
  if (day === lastDay) {
    const isBest = lastBest === 0 || time < lastBest;
    if (!isBest) return unchanged;
    const result = normalizeProgress({ ...base, dy: [day, time], ds: Math.max(1, base.ds) });
    return { progress: result, isBest: true, streak: result.ds };
  }
  const streak = lastDay > 0 && day === lastDay + 1 ? Math.min(MAX_STREAK, base.ds + 1) : 1;
  const result = normalizeProgress({ ...base, dy: [day, time], ds: streak });
  return { progress: result, isBest: true, streak: result.ds };
}

// ---- small immutable setters ----

/** Add to the lifetime counters: { km (x10), rides, crashes, air (s) } deltas (negative or invalid ones are ignored). */
export function addStats(progress, delta = {}) {
  const base = normalizeProgress(progress);
  const st = Object.fromEntries(Object.entries(STAT_LIMITS).map(([key, max]) => {
    const add = isFiniteNumber(own(delta, key)) ? Math.max(0, Math.floor(delta[key])) : 0;
    return [key, Math.min(max, base.st[key] + add)];
  }));
  return normalizeProgress({ ...base, st });
}

/** Change bike / colour / helmet; a choice that is not unlocked is ignored (the old one stays). */
export function withLoadout(progress, { bk, col, hm } = {}) {
  const base = normalizeProgress(progress);
  const next = {
    ...base,
    bk: isBikeUnlocked(base, bk) ? bk : base.bk,
    col: isColourUnlocked(base, col) ? col : base.col,
    hm: isHelmetUnlocked(base, hm) ? hm : base.hm,
  };
  return normalizeProgress(next);
}

/** Change settings: only known keys with allowed values are taken. */
export const withSettings = (progress, patch) => {
  const base = normalizeProgress(progress);
  return normalizeProgress({ ...base, se: { ...base.se, ...cleanSettings(patch) } });
};

/** All settings with the defaults filled in (the stored `se` is sparse). */
export const settingsOf = (progress) => ({ ...DEFAULT_SETTINGS, ...normalizeProgress(progress).se });

export const withName = (progress, name) => {
  const { n, ...rest } = normalizeProgress(progress);
  return normalizeProgress({ ...rest, n: cleanName(name) });
};

// ---- daily challenge ----

/** Luxembourg day number (days since 1970-01-01) of a date, via Intl like pixelbreak-records.js. */
export function dayNumber(date = new Date(), tz = 'Europe/Luxembourg') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return Math.floor(Date.UTC(value.year, value.month - 1, value.day) / DAY_MS);
}

function hash32(n) {
  let h = (Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The daily challenge of a day: { trailId, time, weather, seed }, deterministic from the day number. The trail is
 * picked from the offered ids (the caller passes the player's unlocked trails), never the marathon (30+ min) and
 * never an unknown id; with nothing eligible the first trail is used.
 */
export function dailyChallenge(day, trailIds = TRAIL_IDS) {
  const dayInt = Math.floor(Number(day)) || 0;
  const eligible = TRAIL_IDS.filter((id) => id !== MARATHON_ID && Array.isArray(trailIds) && trailIds.includes(id));
  const pool = eligible.length > 0 ? eligible : [TRAIL_IDS[0]];
  const seed = hash32(dayInt);
  const random = mulberry32(seed);
  const trailId = pool[Math.floor(random() * pool.length)];
  const time = DAILY_TIMES[Math.floor(random() * DAILY_TIMES.length)];
  const total = DAILY_WEATHER.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  const weather = (DAILY_WEATHER.find(([, weight]) => (roll -= weight) < 0) ?? DAILY_WEATHER[0])[0];
  return { trailId, time, weather, seed };
}
