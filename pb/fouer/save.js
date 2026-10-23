// Save format v2 (DESIGN.md 8.3): strings and small integers only, `gi` is the only array. Every field is
// normalised and clamped at the boundary. The game_saves table rejects rows whose jsonb is over 8192 bytes, and
// jsonb stores numbers expensively (12 bytes per array element), so this module also estimates the jsonb size.
import { SAVE_VERSION, CASH_CAP, PITCH_COUNT, RULES, ITEM_BY_ID, ITEM_BY_INDEX, PITCHES, sizeFits, STAMPS_FOR_STATUE } from "./data.js";
import { createState, cleanName, popcount } from "./sim.js";

export const SAVE_LIMIT_BYTES = 3000;
export const JSONB_LIMIT_BYTES = 8192;
export const BACKUP_KEY = "pb_fouer_bak";
export const LG_LIMIT = 900;
const SAVE_DELAY_MS = 1200, MAX_SAVE_WAIT_MS = 5000, BACKUP_INTERVAL_MS = 60000;
const MAX_STAMP_YEARS = 12, STAMP_DAYS = 20, MIN_YEAR = 2000, MAX_YEAR = 2200;
const MAX_PIONEER_P = 20000, MAX_RB = 75, MAX_TIME = 4102444800, PITCH_MASK_LIMIT = 2 ** PITCH_COUNT - 1;
const MAX_DAY_NUMBER = 200000;   // Lux day number (days since 1970): Hämmi's daily present
const PITCH_CHARS = 3, VOUCHER_CHARS = RULES.voucherSlots, FLAG_MAX = 7;
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const BASE36 = /^[0-9a-z]*$/;

function number(value, fallback, min, max) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
const integer = (value, fallback, min, max) => Math.floor(number(value, fallback, min, max));
const base36 = (text, max) => typeof text === "string" && text.length > 0 && text.length <= 8 && BASE36.test(text)
  ? Math.min(max, parseInt(text, 36)) : 0;

/** Last giftIdsKept positive safe integers, duplicates dropped (same filter as IdleExtras.cleanGiftIds). */
export function cleanGiftIds(raw) {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter(id => Number.isSafeInteger(id) && id > 0);
  return [...new Set(ids)].slice(-RULES.giftIdsKept);
}

// ---- pitch, voucher and stamp strings ----

export function encodePitches(pitches) {
  return pitches.map(entry => entry
    ? ITEM_BY_ID[entry.k].idx.toString(36) + (entry.lv * RULES.lookCount + entry.look).toString(36) + entry.fl.toString(36)
    : "000").join("");
}

/** Unknown kinds, kinds that do not fit their pitch, surplus copies and ungranted specials become empty pitches. */
export function decodePitches(text, { pioneer, stampTotal }) {
  const copies = {};
  const pitches = [];
  for (let index = 0; index < PITCH_COUNT; index++) {
    const chunk = text.slice(index * PITCH_CHARS, (index + 1) * PITCH_CHARS);
    const item = ITEM_BY_INDEX[parseInt(chunk[0], 36)];
    const detail = parseInt(chunk[1], 36);
    let entry = null;
    const granted = item && (item.special === null || (item.special === "pioneer" && pioneer)
      || (item.special === "stamps" && stampTotal >= STAMPS_FOR_STATUE));
    if (granted && sizeFits(item.size, PITCHES[index].size) && (copies[item.id] ?? 0) < item.max) {
      copies[item.id] = (copies[item.id] ?? 0) + 1;
      const level = item.upgradeBase > 0 ? Math.min(RULES.maxLevel, Math.floor(detail / RULES.lookCount)) : 0;
      entry = { k: item.id, lv: level, look: detail % RULES.lookCount, fl: Math.min(FLAG_MAX, parseInt(chunk[2], 36)) };
    }
    pitches.push(entry);
  }
  return pitches;
}

export function encodeStamps(stamps) {
  return Object.entries(stamps).filter(([, mask]) => mask > 0).sort(([a], [b]) => a - b).slice(-MAX_STAMP_YEARS)
    .map(([year, mask]) => `${year}:${mask.toString(36)}`).join(",");
}

export function decodeStamps(text) {
  const stamps = {};
  if (typeof text !== "string" || text.length > 200) return stamps;
  for (const part of text.split(",").slice(0, MAX_STAMP_YEARS)) {
    const match = /^(\d{4}):([0-9a-z]{1,5})$/.exec(part);
    if (!match) continue;
    const year = Number(match[1]);
    const mask = Math.min(2 ** STAMP_DAYS - 1, parseInt(match[2], 36));
    if (year >= MIN_YEAR && year <= MAX_YEAR && mask > 0) stamps[year] = mask;
  }
  return stamps;
}

function decodeVouchers(text) {
  if (typeof text !== "string") return [];
  return [...text.slice(0, VOUCHER_CHARS)].map(char => ITEM_BY_INDEX[parseInt(char, 36)])
    .filter(item => item && item.special === null).map(item => item.id);
}

// ---- state <-> record ----

export function encodeSave(state) {
  return { v: SAVE_VERSION, tb: Math.floor(state.tb), c: Math.floor(state.c), t: state.t,
    p: encodePitches(state.pitches), pu: state.pu.toString(36), rb: state.rb, pi: state.pi, mg: state.mg,
    vo: state.vo.map(id => ITEM_BY_ID[id].idx.toString(36)).join(""), lg: state.lg, st: encodeStamps(state.st),
    gi: [...state.gi], n: state.n, tu: state.tu, ea: state.ea, fw: state.fw, hd: state.hd };
}

export function parseRaw(raw) {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch (error) { console.warn("[fouer] save is not valid JSON", error.message); return null; }
}

/** What a stored blob is: a v2 save, a pioneer stub, an old v1 park, nothing, or garbage. */
export function classifyRaw(raw) {
  const data = parseRaw(raw);
  if (data === undefined || data === null) return "empty";
  if (!isRecord(data)) return "invalid";
  if (data.v === SAVE_VERSION) return data.stub === 1 ? "stub" : "v2";
  if (data.version === 1) return "v1";
  return "invalid";
}

/** Validate and clamp a stored v2 record into a state, or return null when it is not a usable v2 save. */
export function decodeSave(raw) {
  const data = parseRaw(raw);
  if (!isRecord(data) || data.v !== SAVE_VERSION || data.stub === 1) return null;
  if (typeof data.tb !== "number" || !Number.isFinite(data.tb) || data.tb < 0) return null;
  if (typeof data.p !== "string" || data.p.length !== PITCH_COUNT * PITCH_CHARS || !BASE36.test(data.p)) return null;
  const fresh = createState();
  const st = decodeStamps(data.st);
  const pi = data.pi === 1 ? 1 : 0;
  const stampTotal = Math.max(0, ...Object.values(st).map(popcount));
  return { ...fresh, v: SAVE_VERSION, tb: Math.floor(Math.min(CASH_CAP, data.tb)),
    c: integer(data.c, fresh.c, 0, CASH_CAP), t: integer(data.t, 0, 0, MAX_TIME),
    pitches: decodePitches(data.p, { pioneer: pi === 1, stampTotal }),
    pu: base36(data.pu, PITCH_MASK_LIMIT), rb: integer(data.rb, 0, 0, MAX_RB), pi,
    mg: integer(data.mg, 0, 0, MAX_PIONEER_P), vo: decodeVouchers(data.vo),
    lg: typeof data.lg === "string" && data.lg.length <= LG_LIMIT && /^L1\|[0-9a-z|]*$/.test(data.lg) ? data.lg : "",
    st, gi: cleanGiftIds(data.gi), n: cleanName(data.n), tu: integer(data.tu, 0, 0, RULES.tutorialDone),
    ea: typeof data.ea === "string" && /^[a-z0-9]{0,32}$/.test(data.ea) ? data.ea : "",
    fw: Number.isInteger(data.fw) && data.fw >= MIN_YEAR && data.fw <= MAX_YEAR ? data.fw : 0,
    hd: integer(data.hd, 0, 0, MAX_DAY_NUMBER) };
}

// ---- size guard ----

const utf8 = text => new TextEncoder().encode(text).length;
const byteCompare = (a, b) => {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return x.length - y.length;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/** Stored size of an integer as a PostgreSQL numeric inside jsonb: 4-byte header + 2-byte numeric header + 2 bytes per
 * base-10000 digit group (trailing zero groups are not stored). Non-integers are rare here and costed generously. */
function numericBytes(value) {
  if (!Number.isInteger(value)) return 4 + 2 + 2 * (Math.ceil(String(Math.abs(value)).replace(".", "").length / 4) + 2);
  const text = String(Math.abs(value));
  const groups = [];
  for (let end = text.length; end > 0; end -= 4) groups.unshift(text.slice(Math.max(0, end - 4), end));
  while (groups.length && Number(groups.at(-1)) === 0) groups.pop();
  return 4 + 2 + 2 * groups.length;
}

/** Exact replay of how PostgreSQL lays out a jsonb value (see convertJsonbValue): 4-byte varlena header, container
 * header plus 4-byte entries, keys sorted by length then bytes, strings unpadded, numerics and containers aligned to
 * 4 bytes. Calibrated on live pg_column_size() results (a 1600-element integer array = 19,208 bytes). */
export function jsonbSize(value) {
  let length = 4;
  const align = () => { length = Math.ceil(length / 4) * 4; };
  const write = node => {
    if (node === null || typeof node === "boolean") return;
    if (typeof node === "string") { length += utf8(node); return; }
    if (typeof node === "number") { align(); length += numericBytes(node); return; }
    align();
    if (Array.isArray(node)) {
      length += 4 + 4 * node.length;
      node.forEach(write);
      return;
    }
    const keys = Object.keys(node).sort(byteCompare);
    length += 4 + 8 * keys.length;
    keys.forEach(key => { length += utf8(key); });
    keys.forEach(key => write(node[key]));
  };
  write(value);
  return length;
}

/** JSON text of a save, refusing anything over the 3000-byte budget or the jsonb estimate limit. */
export function serializeSave(state) {
  const record = encodeSave(state);
  const json = JSON.stringify(record);
  const bytes = utf8(json), jsonb = jsonbSize(record);
  if (bytes > SAVE_LIMIT_BYTES || jsonb >= JSONB_LIMIT_BYTES) {
    throw new Error(`Fouer save is too large (${bytes} bytes, jsonb about ${jsonb}). Progress was not sent.`);
  }
  return json;
}

export const saveSizes = state => {
  const record = encodeSave(state);
  return { json: utf8(JSON.stringify(record)), jsonb: jsonbSize(record) };
};

// ---- merge: higher lifetime value wins, a tie goes to the later save ----

export function isNewer(candidate, current) {
  return candidate.tb > current.tb || (candidate.tb === current.tb && candidate.t > current.t);
}
export const mergeSaves = (a, b) => isNewer(b, a) ? b : a;

/** Best usable v2 state among raw sources (local, cloud, backup). Returns null when none decodes. */
export function pickBest(sources) {
  return sources.map(decodeSave).filter(Boolean).reduce((best, state) => best ? mergeSaves(best, state) : state, null);
}

// ---- persistence (adapted from pb/park/save.js; DOM-optional through `env`) ----

export function browserEnv(win = globalThis) {
  const storage = (() => {
    try { return win.localStorage ?? null; } catch (error) { console.warn("[fouer] localStorage is unavailable", error.message); return null; }
  })();
  return { win, parent: win.parent, storage, now: () => Date.now(),
    setTimeout: (fn, ms) => win.setTimeout(fn, ms), clearTimeout: id => win.clearTimeout(id) };
}

export function readBackup(storage) {
  if (!storage) return null;
  try { return decodeSave(storage.getItem(BACKUP_KEY)); }
  catch (error) { console.warn("[fouer] could not read the backup", error.message); return null; }
}

export function createPersistence({ getState, onState, onError, env = browserEnv() }) {
  const { win, parent, storage } = env;
  let timer = null, deadline = null, lastKey = null, lastError = null, lastBackup = -Infinity;
  const isTestMode = () => win.__pbTestMode === true;
  const report = (message, cause) => {
    console.warn(`[fouer] ${message}`, cause ?? "");
    if (message !== lastError) onError(message);
    lastError = message;
  };
  const clearTimers = () => {
    env.clearTimeout(timer); env.clearTimeout(deadline);
    timer = deadline = null;
  };
  const publishScore = state => {
    win.score = Math.floor(state.tb);
    win.Arcade?.score(win.score);
  };
  function writeBackup(json) {
    if (!storage || env.now() - lastBackup < BACKUP_INTERVAL_MS) return;
    try { storage.setItem(BACKUP_KEY, json); lastBackup = env.now(); }
    catch (error) { console.warn("[fouer] could not write the backup", error.message); }
  }
  function pushSave() {
    clearTimers();
    try {
      const state = getState();
      publishScore(state);
      if (isTestMode()) return true;
      const json = serializeSave(state);
      const record = JSON.parse(json);
      const key = JSON.stringify({ ...record, t: 0 });
      if (key === lastKey) return true;
      if (parent && parent !== win) parent.postMessage({ __pbSave: 1, data: record }, "*");
      writeBackup(json);
      lastKey = key; lastError = null;
      return true;
    } catch (error) { report("Could not save this fair.", error); return false; }
  }
  function scheduleSave() {
    try { publishScore(getState()); } catch (error) { report("Could not read the fair state.", error); return; }
    env.clearTimeout(timer);
    timer = env.setTimeout(pushSave, SAVE_DELAY_MS);
    if (deadline === null) deadline = env.setTimeout(pushSave, MAX_SAVE_WAIT_MS);
  }
  function applyIncoming(raw) {
    // Arcade test mode keeps its injected, fully unlocked save: a later cloud save must not replace it.
    if (isTestMode()) return false;
    const incoming = decodeSave(raw);
    if (!incoming) {
      if (raw != null && classifyRaw(raw) === "invalid") console.warn("[fouer] ignored an unreadable cloud save");
      return false;
    }
    if (!isNewer(incoming, getState())) return false;
    onState(incoming);
    scheduleSave();
    return true;
  }
  function receiveSave(event) {
    if (event.source !== parent || !isRecord(event.data)) return;
    if (event.data.__pbLoadSave === 1) applyIncoming(event.data.data);
  }
  win.addEventListener("message", receiveSave);
  win.addEventListener("pagehide", pushSave);
  try { publishScore(getState()); } catch (error) { report("Could not read the fair state.", error); }
  try { if (parent && parent !== win) parent.postMessage({ __pbWantSave: 1 }, "*"); }
  catch (error) { report("Could not request cloud progress. Your local fair is still open.", error); }
  return { applyIncoming, pushSave, scheduleSave, receiveSave, destroy() {
    clearTimers();
    win.removeEventListener("message", receiveSave);
    win.removeEventListener("pagehide", pushSave);
  } };
}
