import { MAX_LEVEL, META, clamp } from "./content.js";
import { cleanMeta, metaReward } from "./simulation.js";

export function totalStars(stars = {}) {
  return Object.values(stars).reduce((sum, value) => sum + clamp(Math.floor(Number(value) || 0), 0, 3), 0);
}

export function cleanProgress(save) {
  const safe = save || {};                 // a default only covers undefined, not null
  const stars = Object.fromEntries(Object.entries(safe.stars || {}).map(([key, value]) => [key, clamp(Math.floor(Number(value) || 0), 0, 3)]));
  return {
    v: 1,
    level: clamp(Math.floor(Number(safe.level) || 1), 1, MAX_LEVEL),
    stars,
    kills: Math.max(0, Math.floor(Number(safe.kills) || 0)),
    meta: cleanMeta(safe.meta),
  };
}

export function isStrictlyMoreProgress(candidate, current) {
  if (!candidate || candidate.v !== 1) return false;
  const incoming = cleanProgress(candidate);
  const local = cleanProgress(current);
  if (incoming.level !== local.level) return incoming.level > local.level;
  if (totalStars(incoming.stars) !== totalStars(local.stars)) return totalStars(incoming.stars) > totalStars(local.stars);
  return incoming.kills > local.kills;
}

export function completeLevel(progress, level, stars, kills) {
  const clean = cleanProgress(progress);
  const priorStars = clean.stars[level] || 0;
  const bestStars = Math.max(priorStars, stars);
  const firstClear = priorStars === 0;
  const reward = firstClear ? metaReward(level, bestStars) : Math.max(1, bestStars - priorStars);
  return {
    ...clean,
    level: Math.max(clean.level, Math.min(MAX_LEVEL, level + 1)),
    stars: { ...clean.stars, [level]: bestStars },
    kills: clean.kills + Math.max(0, Math.floor(kills)),
    meta: { ...clean.meta, shards: clean.meta.shards + reward },
  };
}

export function metaSummary(meta) {
  const clean = cleanMeta(meta);
  return Object.keys(META).map((key) => ({ key, level: clean.upgrades[key], ...META[key] }));
}
