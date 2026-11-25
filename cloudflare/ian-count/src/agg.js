// One day's breakdowns from its sessions and hits, in the same shape as site_traffic.details (see scripts/fetch_visitors.py),
// so traffic-details.js merges both kinds of days with the same code. Pure: rows in, plain object out (test/agg.test.mjs).
// A single pass over the rows (not one GROUP BY per list): the free plan counts every row a query scans.
import { luxHour, screenClass } from './parse.js';

export const MAX_PAGES_PER_DAY = 200;
export const MAX_LABELS_PER_DAY = 25;
const DURATION_STEPS = [[10, '<10 s'], [60, '10-60 s'], [300, '1-5 min'], [900, '5-15 min'], [3600, '15-60 min']];

const tally = () => new Map();
function add(map, label, views, sid) {
  if (label === '' || label === null || label === undefined) return;
  const entry = map.get(label) ?? { views: 0, sids: new Set() };
  entry.views += views;
  entry.sids.add(sid);
  map.set(label, entry);
}
const top = (map, key, limit) => [...map]
  .map(([label, { views, sids }]) => ({ [key]: label, views, visits: sids.size }))
  .sort((a, b) => b.visits - a.visits || b.views - a.views || String(a[key]).localeCompare(String(b[key])))
  .slice(0, limit);

/** sessions: rows of the sessions table (sid, first_ts, last_ts, views, events, entry, exit, trail, ...); hits: {sid, hour, path, kind, name}. */
export function aggregateDay(sessions, hits, bots = 0) {
  const lists = Object.fromEntries(['refs', 'browsers', 'browser_versions', 'systems', 'system_versions', 'countries', 'regions',
    'devices', 'screens', 'screen_sizes', 'languages', 'timezones', 'providers', 'companies', 'entries', 'exits', 'steps'].map((k) => [k, tally()]));
  const durations = {}, depth = {};
  const hours = Array.from({ length: 24 }, () => ({ views: 0, sids: new Set() }));
  let views = 0, events = 0, totalSeconds = 0, onePage = 0;

  for (const s of sessions) {
    const sv = Math.max(0, s.views);
    views += sv;
    events += s.events;
    const trail = s.trail ? s.trail.split('\n').filter(Boolean) : [];
    const label = {
      refs: s.ref, browsers: s.browser, browser_versions: s.bver ? `${s.browser} ${s.bver}` : s.browser, systems: s.os,
      system_versions: s.osver ? `${s.os} ${s.osver}` : s.os, countries: s.country || '?', regions: s.region ? `${s.country}-${s.region}` : '',
      devices: s.device, screens: screenClass(Number(String(s.screen).split('x')[0])),
      screen_sizes: s.screen && s.screen !== '0x0' ? `${s.screen}${s.dpr ? ` @${s.dpr}x` : ''}` : '',
      languages: s.lang, timezones: s.tz, providers: s.provider, companies: s.org_kind === 'company' ? s.org : '',
      entries: s.entry, exits: s.exit,
    };
    for (const [name, value] of Object.entries(label)) add(lists[name], value, sv, s.sid);
    trail.slice(1).forEach((after, i) => { if (trail[i] !== after) add(lists.steps, `${trail[i].slice(0, 70)} -> ${after.slice(0, 70)}`, 1, s.sid); });
    const seconds = Math.max(0, Math.round((s.last_ts - s.first_ts) / 1000));
    totalSeconds += seconds;
    const key = sv > 4 ? '5+' : String(Math.max(1, sv));
    depth[key] = (depth[key] ?? 0) + 1;
    if (sv <= 1) onePage += 1;
    const bucket = DURATION_STEPS.find(([limit]) => seconds < limit)?.[1] ?? '> 1 h';
    durations[bucket] = (durations[bucket] ?? 0) + 1;
    hours[luxHour(s.first_ts)].sids.add(s.sid);
  }

  const pages = tally(), eventNames = tally();
  for (const hit of hits) {
    if (hit.kind === 'event') { add(eventNames, hit.name, 1, hit.sid); continue; }
    if (hit.kind !== 'view') continue;
    add(pages, hit.path, 1, hit.sid);
    if (hit.hour >= 0 && hit.hour < 24) hours[hit.hour].views += 1;
  }
  const visits = sessions.length;
  return {
    visits, views,
    details: {
      bots, events,
      pages_per_visit: visits ? Math.round((100 * views) / visits) / 100 : 0,
      one_page_visits: onePage,
      average_seconds: visits ? Math.round(totalSeconds / visits) : 0,
      durations, depth,
      pages: top(pages, 'path', MAX_PAGES_PER_DAY),
      event_names: top(eventNames, 'name', MAX_LABELS_PER_DAY),
      hours: hours.map((h) => [h.views, h.sids.size]),
      ...Object.fromEntries(Object.entries(lists).map(([k, map]) => [k, top(map, 'name', MAX_LABELS_PER_DAY)])),
    },
  };
}
