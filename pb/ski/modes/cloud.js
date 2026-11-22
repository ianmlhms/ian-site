/* Cloud save of the Ski Alpen progress (round 4A): the arcade's game_saves row "ski" (pixelbreak-records.js: {__pbSave} from the game ->
 * localStorage pb_save_ski + the game_saves upsert when signed in; window.__pbSave injected at open; {__pbWantSave} -> {__pbLoadSave}).
 * The full local save (pb_ski_save: ghosts, run counts) stays on the device; the cloud gets a compact record (well under the 8 KB jsonb
 * limit of game_saves even with every star of all five resorts):
 *   { v: 1, tb: total stars (monotone: the game_saves_keep_progress trigger keeps the save with more), s: { <resort>: "hhhhhm..." }
 *     (5 characters of piste-id hash + the star mask digit per piste), p: { <resort>: best park points }, b: { <resort>: "hhhhhtttttt..." }
 *     (best times in ms, base 36, dropped first when the record would not fit), x: { o: metres off the piste, t: top speed in
 *     0.1 m/s, k: the picked ski type } (round 6: the ski unlocks; an old game ignores it, an old record without it reads as zero) }
 * Merging is always a union: stars OR-ed, park points and times keep the better one. Nothing is ever taken away from a player.
 * Test mode (window.__pbTestMode): nothing is sent or applied (the arcade keeps test saves apart). Standalone: local only. */
import { cleanMask, starCount, totalStars } from './challenges.js';

export const CLOUD_VERSION = 1;
const LIMIT = 7000;                 // bytes of JSON (game_saves: jsonb <= 8192)
const SAVE_DELAY_MS = 1500;
const HASH = 5, TIME = 6;
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Compact cloud record of a progress (pure). */
export function encodeCloud(progress) {
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
  if (JSON.stringify(rec).length > LIMIT) delete rec.b;            // best times go first (the boards keep them anyway)
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
  return { stars, park, bestHash, stats, ski };
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
  return { ...progress, stars, park, bestHash, stats };
}

/** Did the merge add anything? (stars, park points, times) */
export function cloudGain(before, after) {
  const count = (p) => totalStars(p) * 1e6 + Object.values(p.park || {}).reduce((a, b) => a + b, 0) + ((p.stats && p.stats.off) || 0) * 1e-3 + ((p.stats && p.stats.top) || 0) * 1e-6;
  return count(after) !== count(before) || Object.keys(after.bestHash || {}).length !== Object.keys(before.bestHash || {}).length;
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
    const rec = encodeCloud(pending);
    pending = null;
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
