// One day's breakdowns from its sessions and hits, in the same shape as site_traffic.details (see scripts/fetch_visitors.py),
// so traffic-details.js merges both kinds of days with the same code. Pure: rows in, plain object out (test/agg.test.mjs).
// A single pass over the rows (not one GROUP BY per list): the free plan counts every row a query scans.
import { luxHour, screenClass } from './parse.js';

export const MAX_PAGES_PER_DAY = 200;
export const MAX_LABELS_PER_DAY = 25;
export const MAX_SKI_RESORTS = 40;
export const MAX_SKI_GAP_SECONDS = 1800;       // a view that is followed by another one: at most this long (the tab may have been hidden)
export const MAX_SKI_LAST_SECONDS = 7200;      // the last view of a visit lasts until the visit's last ping (pings stop after an hour)
const SKI_PATH = /^\/pb\/ski\.html\?r=([a-z0-9_-]{1,20})$/;
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

/** Ski Alpen per resort: views of '/pb/ski.html?r=<resort>', sessions that opened it and the seconds spent there. A view lasts until the
 * same visit's next view (capped), the last one until the visit's last ping. Needs hit.ts; rows without it add no time. Pure. */
export function skiByResort(sessions, hits) {
  const lastTs = new Map(sessions.map((s) => [s.sid, s.last_ts]));
  const bySid = new Map();
  for (const hit of hits) {
    if (hit.kind !== 'view') continue;
    const list = bySid.get(hit.sid) ?? [];
    list.push(hit);
    bySid.set(hit.sid, list);
  }
  const resorts = new Map();
  for (const [sid, list] of bySid) {
    list.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    list.forEach((hit, i) => {
      const resort = SKI_PATH.exec(hit.path)?.[1];
      if (!resort) return;
      const next = list[i + 1];
      const seconds = !Number.isFinite(hit.ts) ? 0 : next && Number.isFinite(next.ts)
        ? Math.min(MAX_SKI_GAP_SECONDS, (next.ts - hit.ts) / 1000)
        : Math.min(MAX_SKI_LAST_SECONDS, Math.max(0, ((lastTs.get(sid) ?? hit.ts) - hit.ts) / 1000));
      const entry = resorts.get(resort) ?? { views: 0, sids: new Set(), seconds: 0 };
      entry.views += 1;
      entry.sids.add(sid);
      entry.seconds += seconds;
      resorts.set(resort, entry);
    });
  }
  return [...resorts].map(([r, e]) => ({ r, views: e.views, visits: e.sids.size, seconds: Math.round(e.seconds) }))
    .sort((a, b) => b.seconds - a.seconds || b.views - a.views || a.r.localeCompare(b.r)).slice(0, MAX_SKI_RESORTS);
}

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
      ski: skiByResort(sessions, hits),
      event_names: top(eventNames, 'name', MAX_LABELS_PER_DAY),
      hours: hours.map((h) => [h.views, h.sids.size]),
      ...Object.fromEntries(Object.entries(lists).map(([k, map]) => [k, top(map, 'name', MAX_LABELS_PER_DAY)])),
    },
  };
}
