/* The daily challenge "Dagesfuerderung" (28 Nov 2026; pure: no THREE, no DOM).
 * One challenge per day, the same for everybody: the seed is the date in Europe/Luxembourg. The candidates come from modes/goals-data.js
 * (generated: pistes with their ★2 time, lift + run combos), the pick is a hash of the date, so nothing is stored on a server.
 *   time   a given piste under a given time (the ★2 time of that piste, a valid run on the reference ski)
 *   stars  N new stars in a given ski area (counted from the star gains of that day)
 *   combo  ride a given lift, then finish a given piste (a valid run), in that order
 * Saved: progress.daily = { d: day of the counters, n: stars won that day, s: 1 once the combo lift was ridden, last: day number of the last
 * completed day, streak, best }. Cloud record `y` = [last, streak, best] (merge: the later last wins). The streak counts consecutive
 * days: finishing today after yesterday = +1, a gap starts again at 1; the shown streak is 0 once a whole day was missed. */
import { hashString } from './challenges.js';
import { GOALS_DATA } from './goals-data.js';
import { pisteHashAt, liftKeyAt } from './goals.js';

const TZ = 'Europe/Luxembourg';
export const STAR_CHOICES = [4, 5, 6, 7, 8];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

let fmt = null;
/** 'YYYY-MM-DD' of a date in Luxembourg (Intl; a browser without the zone falls back to the local date). */
export function dayOf(date = new Date()) {
  try {
    fmt = fmt || new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    const text = fmt.format(date);
    if (DAY_RE.test(text)) return text;
  } catch (error) { console.warn('[ski] daily: no time zone support, using the device date', error.message); }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
/** Days since 1970-01-01 of a 'YYYY-MM-DD' (0 for bad text). */
export function dayNumber(day) {
  if (typeof day !== 'string' || !DAY_RE.test(day)) return 0;
  const [y, m, d] = day.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
export const dayAfter = (day, n) => new Date((dayNumber(day) + n) * 86400000).toISOString().slice(0, 10);

/** The challenge of a day: { day, type, rid, n?, pisteKey?, pisteName?, targetMs?, liftKey?, liftName? } (null when no data). */
export function dailyFor(day) {
  const ids = Object.keys(GOALS_DATA).sort();
  if (!ids.length || !DAY_RE.test(day)) return null;
  const h = hashString(`ski-daily/${day}`);
  const rid = ids[h % ids.length], d = GOALS_DATA[rid];
  const type = ['time', 'stars', 'combo'][(h >>> 11) % 3];
  const pick = (h >>> 3) >>> 0;
  if (type === 'time' && d.dp.length) {
    const [pos, name, ms] = d.dp[pick % d.dp.length];
    return { day, type, rid, pisteKey: pisteHashAt(rid, pos), pisteName: name, targetMs: ms };
  }
  if (type === 'combo' && d.dc.length) {
    const [lp, pp] = d.dc[pick % d.dc.length];
    return { day, type, rid, liftKey: liftKeyAt(rid, lp), liftName: d.nm[`l${lp}`] || '', pisteKey: pisteHashAt(rid, pp), pisteName: d.nm[`p${pp}`] || '' };
  }
  return { day, type: 'stars', rid, n: STAR_CHOICES[(h >>> 17) % STAR_CHOICES.length] };
}

const fmtTime = (ms) => { const s = ms / 1000, m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
/** The challenge in plain Luxembourgish; `area` = the name of the ski area. */
export function dailyText(ch, area) {
  if (!ch) return '';
  if (ch.type === 'time') return `${ch.pisteName} (${area}) ënner ${fmtTime(ch.targetMs)} fueren`;
  if (ch.type === 'combo') return `Mam Lift ${ch.liftName} erop, dann d'Pist ${ch.pisteName} erof (${area})`;
  return `${ch.n} nei Stären zu ${area} huelen`;
}

const emptyDaily = () => ({ d: '', n: 0, s: 0, last: 0, streak: 0, best: 0 });
export const dailyOf = (progress) => ({ ...emptyDaily(), ...(progress && progress.daily ? progress.daily : {}) });
/** The streak to show: still alive when the last completed day is today or yesterday. */
export function streakNow(progress, day) {
  const dl = dailyOf(progress), today = dayNumber(day);
  return dl.last >= today - 1 && dl.last > 0 && dl.last <= today ? dl.streak : 0;
}
export const dailyDone = (progress, day) => dailyOf(progress).last === dayNumber(day) && dayNumber(day) > 0;
/** How far today's challenge is: { done, have, need, step } (stars: n of N; combo: step 0 / 1 / 2). */
export function dailyProgress(progress, ch) {
  const dl = dailyOf(progress), today = dayNumber(ch.day), done = dl.last === today;
  const same = dl.d === ch.day;
  if (ch.type === 'stars') return { done, have: done ? ch.n : same ? Math.min(dl.n, ch.n) : 0, need: ch.n, step: 0 };
  if (ch.type === 'combo') return { done, have: done ? 2 : same && dl.s ? 1 : 0, need: 2, step: done ? 2 : same && dl.s ? 1 : 0 };
  return { done, have: done ? 1 : 0, need: 1, step: 0 };
}

/** One game event into today's challenge: { progress (NEW or the same), done (true only on the event that completed it) }.
 *  ev = { t: 'finish', rid, key, ms, valid } | { t: 'stars', rid, n } | { t: 'lift', rid, key } */
export function dailyEvent(progress, ch, ev) {
  if (!ch || !ev || ev.rid !== ch.rid) return { progress, done: false };
  let dl = dailyOf(progress);
  const today = dayNumber(ch.day);
  if (dl.last === today) return { progress, done: false };
  let complete = false, changed = false;
  if (dl.d !== ch.day) { dl = { ...dl, d: ch.day, n: 0, s: 0 }; changed = true; }
  if (ev.t === 'lift' && ch.type === 'combo' && ev.key === ch.liftKey && !dl.s) { dl = { ...dl, s: 1 }; changed = true; }
  else if (ev.t === 'stars' && ch.type === 'stars' && ev.n > 0) { dl = { ...dl, n: dl.n + ev.n }; changed = true; complete = dl.n >= ch.n; }
  else if (ev.t === 'finish' && ev.valid && ev.key === ch.pisteKey) {
    if (ch.type === 'time' && ev.ms > 0 && ev.ms <= ch.targetMs) complete = true;
    if (ch.type === 'combo' && dl.s) complete = true;
  }
  if (complete) {
    const streak = dl.last === today - 1 && dl.last > 0 ? dl.streak + 1 : 1;
    dl = { ...dl, last: today, streak, best: Math.max(dl.best, streak) };
    changed = true;
  }
  return changed ? { progress: { ...progress, daily: dl }, done: complete } : { progress, done: false };
}

/** Cloud record `y` = [last, streak, best] (null when nothing was ever completed). */
export function dailyCloud(progress) {
  const dl = dailyOf(progress);
  return dl.last > 0 ? [dl.last, dl.streak, dl.best] : null;
}
export function decodeDailyCloud(y) {
  if (!Array.isArray(y) || y.length !== 3) return null;
  const [last, streak, best] = y;
  const ok = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
  return ok(last, 100000) && last > 0 && ok(streak, 100000) && ok(best, 100000) && best >= streak ? { last, streak, best } : null;
}
/** Merge a cloud copy into the local progress.daily (the later completed day wins; equal: the longer streak); never loses a best. */
export function mergeDaily(progress, cloud) {
  if (!cloud) return progress.daily;
  const dl = dailyOf(progress);
  const later = cloud.last > dl.last || (cloud.last === dl.last && cloud.streak > dl.streak);
  const merged = { ...dl, best: Math.max(dl.best, cloud.best) };
  if (later) { merged.last = cloud.last; merged.streak = cloud.streak; }
  return merged;
}
