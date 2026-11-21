/* The match plan, resolved the same way on every device without a server: the lobby hands everybody the same settings and the same
 * roster (mp-gate.js ctx), so "random" (resort, piste, weather, time) is drawn from a seed of the lobby code + roster ids. A rematch
 * goes through the lobby again (new roster ids), so it draws anew. Pure module (the Node test imports it). */
import { RACE_PISTES } from './config.js';
import { RANDOM_WEATHER, RANDOM_TIME } from '../config.js';

export const WEATHERS = Object.freeze(['sun', 'cloudy', 'snow', 'fog']);
export const TIMES = Object.freeze(['morning', 'midday', 'evening']);
export const COLOURS = Object.freeze(['green', 'blue', 'red', 'black']);

/** FNV-1a, 32 bit */
export function hashStr(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/** A deterministic number in [0, 1) for (seed, salt...). */
export function draw(seed, ...salt) {
  let t = (hashStr(`${seed}|${salt.join('|')}`) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pickOf = (list, seed, ...salt) => list[Math.floor(draw(seed, ...salt) * list.length) % list.length];

export const matchSeed = (code, roster) => hashStr(`${String(code).toUpperCase()}|${roster.map((r) => r.id).join(',')}`);

/** The resort of the match (one resort per page life): the lobby's choice, or a ready one drawn from the seed. */
export function resolveResort(cfg, seed, readyIds) {
  if (readyIds.includes(cfg.resort)) return cfg.resort;
  return pickOf(readyIds, seed, 'resort');
}

const dropOf = (p) => (p.src ? p.src.drop : p.drop) || 0;
const flagOf = (p, k) => !!(p.src ? p.src[k] : p[k]);
/** Pistes that suit a race: length / drop window, named pistes only (no unnamed links, no ski routes), sorted by id (the same order on
 * every device). */
export function racePistes(list) {
  return list.filter((p) => p.length >= RACE_PISTES.minLength && p.length <= RACE_PISTES.maxLength && dropOf(p) >= RACE_PISTES.minDrop
    && !flagOf(p, 'link') && !flagOf(p, 'route'))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Round 7: the online free ride's shared weather and time of day (the lobby's choice, else drawn from the seed). */
export function resolveFree(cfg, seed) {
  return Object.freeze({
    weather: WEATHERS.includes(cfg.weather) ? cfg.weather : pickOf(RANDOM_WEATHER, seed, 'weather', 'free'),
    time: TIMES.includes(cfg.time) ? cfg.time : pickOf(RANDOM_TIME, seed, 'time', 'free'),
  });
}

/** One entry per run: { piste (id), weather, time }. cfg.piste = "<resort>/<id>" | a colour | "random". */
export function resolveRuns(cfg, rid, pisteList, seed) {
  const runs = Math.max(1, Math.min(5, Math.round(Number(cfg.runs)) || 1));
  const named = typeof cfg.piste === 'string' && cfg.piste.startsWith(`${rid}/`) ? cfg.piste.slice(rid.length + 1) : null;
  const fixed = named && pisteList.some((p) => p.id === named) ? named : null;
  const all = racePistes(pisteList);
  const byColour = COLOURS.includes(cfg.piste) ? all.filter((p) => p.diff === cfg.piste) : all;
  const pool = (byColour.length ? byColour : all.length ? all : [...pisteList]).map((p) => p.id);
  // a random piste per run, no repeat while the pool lasts (a seeded shuffle)
  const order = pool.map((id, i) => ({ id, k: draw(seed, 'piste', i, id) })).sort((a, b) => a.k - b.k).map((o) => o.id);
  return Object.freeze(Array.from({ length: runs }, (_, r) => Object.freeze({
    piste: fixed || order[r % order.length],
    weather: WEATHERS.includes(cfg.weather) ? cfg.weather : pickOf(RANDOM_WEATHER, seed, 'weather', r),
    time: TIMES.includes(cfg.time) ? cfg.time : pickOf(RANDOM_TIME, seed, 'time', r),
  })));
}
