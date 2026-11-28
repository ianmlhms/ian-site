/* Cloud save of the Ski Alpen progress (round 4A): the arcade's game_saves row "ski" (pixelbreak-records.js: {__pbSave} from the game ->
 * localStorage pb_save_ski + the game_saves upsert when signed in; window.__pbSave injected at open; {__pbWantSave} -> {__pbLoadSave}).
 * The full local save (pb_ski_save: ghosts, run counts) stays on the device; the cloud gets a compact record (well under the 8 KB jsonb
 * limit of game_saves even with every star of all five resorts):
 *   { v: 1, tb: total stars (monotone: the game_saves_keep_progress trigger keeps the save with more), s: { <resort>: "hhhhhm..." }
 *     (5 characters of piste-id hash + the star mask digit per piste), p: { <resort>: best park points }, b: { <resort>: "hhhhhtttttt..." }
 *     (best times in ms, base 36, dropped first when the record would not fit)
 *     round 9: s3: { <resort>: 3-bit masks by piste-index position } (+ s2: packed hashes of pistes the index lacks) replace s when the plain text would pass LIMIT; the order of what is dropped is in encodeCloud, x: { o: metres off the piste, t: top speed in
 *     0.1 m/s, k: the picked ski type } (round 6: the ski unlocks; an old game ignores it, an old record without it reads as zero) }
 *     28 Nov 2026: g: { <resort>: goal bit mask } (reached goals = badges, modes/goals.js), l: { <resort>: lifts ridden, one bit per position of
 *     modes/lift-index.js, base64 }, y: [last daily day, streak, best streak] (modes/daily.js); all tiny, an old game ignores them, an old record
 *     reads as nothing yet. Only `l` can be dropped (before the stars); the badges in `g` and `y` always stay.
 * Merging is always a union: stars OR-ed, park points and times keep the better one. Nothing is ever taken away from a player.
 * Test mode (window.__pbTestMode): nothing is sent or applied (the arcade keeps test saves apart). Standalone: local only. */
import { cleanMask, starCount, totalStars } from './challenges.js';
import { mergeRle, rleIntervals } from './discovery.js';
import { PISTE_INDEX } from './piste-index.js';
import { cleanLifts, mergeLifts } from './goals.js';
import { dailyCloud, decodeDailyCloud, mergeDaily } from './daily.js';

export const CLOUD_VERSION = 1;
const LIMIT = 7000;                 // bytes of JSON (game_saves: jsonb <= 8192)
const SAVE_DELAY_MS = 1500;
const HASH = 5, TIME = 6;
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);


/* ---------------- compact star packing (format "s2") ----------------
 * The old text "hhhhhm" costs 6 bytes per starred piste: with every star of 8+ resorts (~1,700 pistes and growing) it passes the
 * 8,192-byte jsonb limit of game_saves. s2 per resort = base64url of a bit stream: k (5 bits), count (Elias-gamma of count + 1), then the
 * piste hashes sorted ascending as Golomb-Rice gaps (unary quotient, k low bits) and a mask (1 bit "all three stars", else 3 bits).
 * Lossless, ~20 bits per piste instead of 48. Only written when the old text would not fit; decodeCloud reads both. */
const HASH_SPACE = 36 ** HASH;                                  // hash5 values < 60,466,176
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const MAX_PACKED_CHARS = 4000, MAX_PACKED_PISTES = 6000;

function packStars(entries) {                                   // entries: [[hashInt, mask], ...] (any order)
  const sorted = [...entries].sort((a, b) => a[0] - b[0]);
  const gaps = sorted.map(([h], i) => h - (i ? sorted[i - 1][0] : -1) - 1);
  let k = 0, best = Infinity;
  for (let c = 0; c < 27; c++) {
    const bits = gaps.reduce((n, g) => n + (g >> c) + 1 + c, 0);
    if (bits < best) { best = bits; k = c; }
  }
  const bits = [];
  const put = (value, width) => { for (let i = width - 1; i >= 0; i--) bits.push((value >> i) & 1); };
  put(k, 5);
  const n1 = sorted.length + 1, len = 31 - Math.clz32(n1);
  put(0, len); put(n1, len + 1);                                // Elias-gamma
  sorted.forEach(([, mask], i) => {
    for (let q = gaps[i] >> k; q > 0; q--) bits.push(1);
    bits.push(0);
    put(gaps[i] & ((1 << k) - 1), k);
    if (mask === 7) bits.push(1); else { bits.push(0); put(mask, 3); }
  });
  let out = '';
  for (let i = 0; i < bits.length; i += 6) {
    let v = 0;
    for (let j = 0; j < 6; j++) v = (v << 1) | (bits[i + j] || 0);
    out += B64[v];
  }
  return out;
}

/** [[hashInt, mask], ...] of a packed text, or null when it is malformed (bounded: text <= MAX_PACKED_CHARS, <= MAX_PACKED_PISTES). */
function unpackStars(text) {
  if (typeof text !== 'string' || !text || text.length > MAX_PACKED_CHARS) return null;
  const bits = [];
  for (const ch of text) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    for (let j = 5; j >= 0; j--) bits.push((v >> j) & 1);
  }
  let pos = 0;
  const get = () => (pos < bits.length ? bits[pos++] : -1);
  const read = (width) => { let v = 0; for (let i = 0; i < width; i++) { const b = get(); if (b < 0) return -1; v = (v << 1) | b; } return v; };
  const k = read(5);
  if (k < 0 || k > 26) return null;
  let zeros = 0;
  for (let b = get(); b === 0; b = get()) if (++zeros > 14) return null;
  const n1 = zeros ? (1 << zeros) | read(zeros) : 1;
  const count = n1 - 1;
  if (count < 0 || count > MAX_PACKED_PISTES) return null;
  const out = [];
  let prev = -1;
  for (let i = 0; i < count; i++) {
    let q = 0, b = get();
    for (; b === 1; b = get()) if (++q > HASH_SPACE >> k) return null;
    if (b !== 0) return null;
    const low = read(k);
    if (low < 0) return null;
    const h = prev + 1 + (q << k) + low;
    const all = get();
    const mask = all === 1 ? 7 : all === 0 ? read(3) : -1;
    if (h >= HASH_SPACE || !(mask > 0 && mask < 8)) return null;
    out.push([h, mask]);
    prev = h;
  }
  return out;
}

/* ---------------- indexed stars (format "s3", the smallest) ----------------
 * piste-index.js (append-only, scripts/ski/piste_index.mjs) lists every piste hash of a resort in a fixed order; s3 = per resort one 3-bit
 * star mask per position, two positions per base64 character (~0.5 byte per piste: every star of 2,000 pistes = ~1 KB). Pistes that the
 * index does not know yet (a new resort / bake before the generator ran) go to the packed s2 text instead. */
const indexMaps = new Map();
function indexOf(rid) {
  if (!indexMaps.has(rid)) {
    const text = PISTE_INDEX[rid] || '', map = new Map();
    for (let i = 0; i + HASH <= text.length; i += HASH) map.set(text.slice(i, i + HASH), i / HASH);
    indexMaps.set(rid, map);
  }
  return indexMaps.get(rid);
}
function indexedStars(rid, entries) {                           // entries: [[hash5, mask]] -> { text, rest }
  const map = indexOf(rid), masks = [], rest = [];
  for (const [h, m] of entries) { const pos = map.get(h); if (pos === undefined) rest.push([parseInt(h, 36), m]); else masks[pos] = m; }
  let text = '';
  for (let i = 0; i < masks.length; i += 2) text += B64[((masks[i] || 0) << 3) | (masks[i + 1] || 0)];
  return { text, rest };
}
function unindexStars(rid, text) {                              // [[hash5, mask]] (unknown resort / positions past the index are skipped)
  const index = PISTE_INDEX[rid];
  if (typeof text !== 'string' || !index || text.length > MAX_PACKED_CHARS) return [];
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const v = B64.indexOf(text[i]);
    if (v < 0) return [];
    for (const [pos, m] of [[2 * i, v >> 3], [2 * i + 1, v & 7]]) if (m > 0 && (pos + 1) * HASH <= index.length) out.push([index.slice(pos * HASH, (pos + 1) * HASH), m]);
  }
  return out;
}

/** Compact cloud record of a progress (pure). `report` (optional array) receives what had to be dropped to stay under the limit. */
export function encodeCloud(progress, report = []) {
  const s = {}, b = {}, p = {};
  for (const [k, v] of Object.entries(progress.stars || {})) {
    const m = cleanMask(v), cut = k.indexOf('/');
    if (!m || cut < 1 || k.length - cut - 1 !== HASH) continue;
    const rid = k.slice(0, cut);
    s[rid] = (s[rid] || '') + k.slice(cut + 1) + m;
  }
  for (const [rid, pts] of Object.entries(progress.park || {})) if (Number.isFinite(pts) && pts > 0) p[rid] = Math.round(pts);
  const times = progress.bestHash || {};
  for (const [k, ms] of Object.entries(times)) {
    const cut = k.indexOf('/');
    if (cut < 1 || !(ms > 0) || ms >= 36 ** TIME) continue;
    const rid = k.slice(0, cut);
    b[rid] = (b[rid] || '') + k.slice(cut + 1) + Math.round(ms).toString(36).padStart(TIME, '0');
  }
  const st = progress.stats || {};
  const rec = { v: CLOUD_VERSION, tb: totalStars(progress), s, p, b, x: { o: Math.round(st.off || 0), t: Math.round((st.top || 0) * 10), k: typeof progress.ski === 'string' ? progress.ski : 'allmountain' } };
  // round 7-C: the discovered map cells per resort (run-length text, modes/discovery.js) and the Lawin challenges won; an old game
  // ignores `d`, an old record has none (= nothing discovered there yet). Dropped resort by resort (largest first) after the times.
  const d = {};
  for (const [rid, text] of Object.entries(progress.disc || {})) if (typeof text === 'string' && text) d[rid] = text;
  const w = {};
  for (const [rid, m] of Object.entries(progress.lawin || {})) if (Number.isInteger(m) && m > 0) w[rid] = m;
  const g = {}, l = {};
  for (const [rid, m] of Object.entries(progress.goals || {})) if (/^[a-z0-9]{1,16}$/.test(rid) && Number.isInteger(m) && m > 0 && m < 4096) g[rid] = m;
  for (const [rid, text] of Object.entries(progress.lifts || {})) if (/^[a-z0-9]{1,16}$/.test(rid) && cleanLifts(text)) l[rid] = text;
  const y = dailyCloud(progress);
  if (Object.keys(g).length) rec.g = g;
  if (Object.keys(l).length) rec.l = l;
  if (y) rec.y = y;
  if (Object.keys(d).length) rec.d = d;
  if (Object.keys(w).length) rec.w = w;
  const size = () => JSON.stringify(rec).length;
  // round 9: 1. too big -> the stars move to the packed format s2 (lossless; old games read v1 without `s`: no stars shown, nothing lost
  // server-side because the keep-progress trigger compares `tb`). 2. best times (the boards keep them), 3. discovered cells resort by
  // resort (largest first, the fog grid is the biggest part), 4. Lawin bits, 5. park points, 6. ridden lifts (28 Nov), 7. stars of the least-starred resorts. Badges (g) and the daily streak (y) never go.
  if (size() > LIMIT) {
    const s2 = {}, s3 = {};
    for (const [rid, text] of Object.entries(s)) {
      const entries = [];
      for (let i = 0; i + HASH < text.length; i += HASH + 1) entries.push([text.slice(i, i + HASH), Number(text[i + HASH])]);
      const { text: packed, rest } = indexedStars(rid, entries);
      if (packed) s3[rid] = packed;
      if (rest.length) s2[rid] = packStars(rest);
    }
    if (Object.keys(s3).length) rec.s3 = s3;
    if (Object.keys(s2).length) rec.s2 = s2;
    rec.s = {};
  }
  const drop = (what, fn) => { fn(); report.push(what); };
  if (size() > LIMIT && rec.b) drop('best times', () => { delete rec.b; });
  while (rec.d && size() > LIMIT) {
    const big = Object.keys(rec.d).sort((a, b) => rec.d[b].length - rec.d[a].length)[0];
    drop(`discovered map of ${big}`, () => { delete rec.d[big]; });
    if (!Object.keys(rec.d).length) delete rec.d;
  }
  if (size() > LIMIT && rec.w) drop('Lawin wins', () => { delete rec.w; });
  if (size() > LIMIT) drop('park points', () => { rec.p = {}; });
  if (size() > LIMIT && rec.l) drop('ridden lifts', () => { delete rec.l; });
  const starText = (rid) => ((rec.s3 || {})[rid] || '') + ((rec.s2 || {})[rid] || '');
  while (size() > LIMIT && new Set([...Object.keys(rec.s3 || {}), ...Object.keys(rec.s2 || {})]).size) {
    const least = [...new Set([...Object.keys(rec.s3 || {}), ...Object.keys(rec.s2 || {})])].sort((a, b) => starText(a).length - starText(b).length)[0];
    drop(`stars of ${least}`, () => { if (rec.s3) delete rec.s3[least]; if (rec.s2) delete rec.s2[least]; });
  }
  return rec;
}

/** The progress parts of a cloud record: { stars, park, bestHash } (keys "<resort>/<hash5>"), or null when it is not a ski record. */
export function decodeCloud(raw) {
  let data = raw;
  if (typeof raw === 'string') { try { data = JSON.parse(raw); } catch (error) { console.warn('[ski] cloud save is not JSON', error.message); return null; } }
  if (!isRecord(data) || data.v !== CLOUD_VERSION) return null;
  const stars = {}, park = {}, bestHash = {};
  for (const [rid, text] of Object.entries(isRecord(data.s) ? data.s : {})) {
    if (typeof text !== 'string' || !/^[a-z0-9]{1,16}$/.test(rid)) continue;
    for (let i = 0; i + HASH < text.length + 0; i += HASH + 1) {
      const m = Number(text[i + HASH]);
      if (Number.isInteger(m) && m > 0 && m < 8) stars[`${rid}/${text.slice(i, i + HASH)}`] = m;
    }
  }
  // s3 (indexed, round 9) and s2 (packed): at most 16 resorts each, bounded texts
  for (const [rid, text] of Object.entries(isRecord(data.s3) ? data.s3 : {}).slice(0, 16)) {
    if (!/^[a-z0-9]{1,16}$/.test(rid)) continue;
    for (const [h, m] of unindexStars(rid, text)) stars[`${rid}/${h}`] = m;
  }
  // s2 (packed, round 9): at most 16 resorts, each bounded text; a malformed one is skipped
  for (const [rid, text] of Object.entries(isRecord(data.s2) ? data.s2 : {}).slice(0, 16)) {
    if (!/^[a-z0-9]{1,16}$/.test(rid)) continue;
    const entries = unpackStars(text);
    if (!entries) continue;
    for (const [h, m] of entries) stars[`${rid}/${h.toString(36).padStart(HASH, '0')}`] = m;
  }
  for (const [rid, pts] of Object.entries(isRecord(data.p) ? data.p : {})) if (Number.isFinite(pts) && pts > 0) park[rid] = Math.round(pts);
  for (const [rid, text] of Object.entries(isRecord(data.b) ? data.b : {})) {
    if (typeof text !== 'string') continue;
    for (let i = 0; i + HASH + TIME <= text.length; i += HASH + TIME) {
      const ms = parseInt(text.slice(i + HASH, i + HASH + TIME), 36);
      if (ms > 0) bestHash[`${rid}/${text.slice(i, i + HASH)}`] = ms;
    }
  }
  const x = isRecord(data.x) ? data.x : {};
  const stats = { off: Number.isFinite(x.o) && x.o > 0 ? Math.min(1e8, Math.round(x.o)) : 0, top: Number.isFinite(x.t) && x.t > 0 ? Math.min(60, x.t / 10) : 0 };
  const ski = typeof x.k === 'string' && /^[a-z]{2,16}$/.test(x.k) ? x.k : null;
  const disc = {}, lawin = {};
  // security (R8b): the discovery grid d = { rid: run-length text } is checked like s / b: at most 16 resorts, rid [a-z0-9]{1,16}, a
  // string of base-36 runs (discovery.js rleIntervals: <= MAX_RLE characters, every cell index < MAX_CELLS), else dropped
  for (const [rid, text] of Object.entries(isRecord(data.d) ? data.d : {}).slice(0, 16)) if (/^[a-z0-9]{1,16}$/.test(rid) && typeof text === 'string' && rleIntervals(text).length) disc[rid] = text;
  for (const [rid, m] of Object.entries(isRecord(data.w) ? data.w : {}).slice(0, 16)) if (/^[a-z0-9]{1,16}$/.test(rid) && Number.isInteger(m) && m > 0 && m < 256) lawin[rid] = m;
  // 28 Nov 2026: goals (badges), lifts ridden, the daily streak; each checked like the rest (at most 16 resorts, bounded values)
  const goals = {}, lifts = {};
  for (const [rid, m] of Object.entries(isRecord(data.g) ? data.g : {}).slice(0, 16)) if (/^[a-z0-9]{1,16}$/.test(rid) && Number.isInteger(m) && m > 0 && m < 4096) goals[rid] = m;
  for (const [rid, text] of Object.entries(isRecord(data.l) ? data.l : {}).slice(0, 16)) if (/^[a-z0-9]{1,16}$/.test(rid) && cleanLifts(text)) lifts[rid] = text;
  return { stars, park, bestHash, stats, ski, disc, lawin, goals, lifts, daily: decodeDailyCloud(data.y) };
}

/** A NEW progress with a decoded cloud record merged in (stars OR-ed, the better park score and time). */
export function mergeCloud(progress, cloud) {
  if (!cloud) return progress;
  const stars = { ...progress.stars };
  for (const [k, m] of Object.entries(cloud.stars)) stars[k] = cleanMask(stars[k]) | m;
  const park = { ...progress.park };
  for (const [rid, pts] of Object.entries(cloud.park)) park[rid] = Math.max(park[rid] || 0, pts);
  const bestHash = { ...(progress.bestHash || {}) };
  for (const [k, ms] of Object.entries(cloud.bestHash)) if (!(bestHash[k] > 0) || ms < bestHash[k]) bestHash[k] = ms;
  const mine = progress.stats || { off: 0, top: 0 }, theirs = cloud.stats || { off: 0, top: 0 };
  const stats = { off: Math.max(mine.off || 0, theirs.off || 0), top: Math.max(mine.top || 0, theirs.top || 0) };
  const disc = { ...(progress.disc || {}) };
  for (const [rid, text] of Object.entries(cloud.disc || {})) disc[rid] = disc[rid] ? mergeRle(disc[rid], text) : text;
  const lawin = { ...(progress.lawin || {}) };
  for (const [rid, m] of Object.entries(cloud.lawin || {})) lawin[rid] = (lawin[rid] || 0) | m;
  const goals = { ...(progress.goals || {}) };
  for (const [rid, m] of Object.entries(cloud.goals || {})) goals[rid] = (goals[rid] || 0) | m;
  const lifts = { ...(progress.lifts || {}) };
  for (const [rid, text] of Object.entries(cloud.lifts || {})) lifts[rid] = mergeLifts(lifts[rid], text);
  return { ...progress, stars, park, bestHash, stats, disc, lawin, goals, lifts, daily: mergeDaily(progress, cloud.daily) };
}

/** Did the merge add anything? (stars, park points, times) */
export function cloudGain(before, after) {
  const count = (p) => totalStars(p) * 1e6 + Object.values(p.park || {}).reduce((a, b) => a + b, 0) + ((p.stats && p.stats.off) || 0) * 1e-3 + ((p.stats && p.stats.top) || 0) * 1e-6;
  const extra = (p) => JSON.stringify(p.disc || {}) + JSON.stringify(p.lawin || {}) + JSON.stringify(p.goals || {}) + JSON.stringify(p.lifts || {}) + JSON.stringify(dailyCloud(p));
  return count(after) !== count(before) || Object.keys(after.bestHash || {}).length !== Object.keys(before.bestHash || {}).length || extra(after) !== extra(before);
}

export const starTotalOf = (stars) => Object.values(stars).reduce((n, m) => n + starCount(cleanMask(m)), 0);

/** The persistence bridge: { request(), push(progress), destroy() }. onIncoming(decoded) is called with a cloud record to merge. */
export function createCloudSave({ win = window, onIncoming }) {
  const parent = win.parent;
  const standalone = !parent || parent === win;
  const testMode = () => win.__pbTestMode === true;
  // LOW 4: the arcade frame is same-origin: only talk to (and listen to) our own origin, never '*'
  const origin = (win.location && win.location.origin) || '';
  const target = origin && origin !== 'null' ? origin : '*';
  let timer = 0, lastJson = '', pending = null;
  function send() {
    timer = 0;
    if (!pending || standalone || testMode()) return;
    const dropped = [];
    const rec = encodeCloud(pending, dropped);
    pending = null;
    if (dropped.length) console.warn('[ski] cloud save over the limit, not saved:', dropped.join(', '));
    const json = JSON.stringify(rec);
    if (json === lastJson) return;
    if (json.length > LIMIT) { console.warn('[ski] cloud save too large, not sent', json.length); return; }
    try { parent.postMessage({ __pbSave: 1, data: rec }, target); lastJson = json; } catch (error) { console.warn('[ski] could not send the cloud save', error); }
  }
  const onMessage = (event) => {
    if (standalone || event.source !== parent || (target !== '*' && event.origin !== origin) || !isRecord(event.data) || event.data.__pbLoadSave !== 1 || testMode()) return;
    const decoded = decodeCloud(event.data.data);
    if (decoded) onIncoming(decoded);
  };
  win.addEventListener('message', onMessage);
  const flush = () => { if (pending) { clearTimeout(timer); send(); } };
  win.addEventListener('pagehide', flush);
  return {
    /** The save the arcade injected at open (its local copy of the last record), and the cloud copy asked for. */
    start() {
      if (testMode()) return;
      const injected = decodeCloud(win.__pbSave);
      if (injected) onIncoming(injected);
      if (!standalone) { try { parent.postMessage({ __pbWantSave: 1 }, target); } catch (error) { console.warn('[ski] could not ask for the cloud save', error); } }
    },
    push(progress) { pending = progress; clearTimeout(timer); timer = setTimeout(send, SAVE_DELAY_MS); },
    flush,
    destroy() { win.removeEventListener('message', onMessage); win.removeEventListener('pagehide', flush); clearTimeout(timer); },
  };
}
