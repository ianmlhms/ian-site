import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDay } from '../src/agg.js';

const T = Date.parse('2026-11-25T10:00:00Z');
const session = (o) => ({ sid: 's1', first_ts: T, last_ts: T, views: 1, events: 0, entry: '/', exit: '/', trail: '/', org: '', org_kind: '', provider: 'POST', country: 'LU', region: 'Luxembourg',
  browser: 'Safari', bver: '18', os: 'iPadOS', osver: '18.6', device: 'tablet', screen: '820x1180', dpr: 2, lang: 'lb', tz: 'Europe/Luxembourg', ref: '', ...o });

test('counts visits, views, depth, durations, steps, hours and the breakdowns', () => {
  const sessions = [
    session({ sid: 'a', views: 3, trail: '/\n/a\n/a\n/b', exit: '/b', last_ts: T + 400_000, ref: 'google.com', org: 'Manpower', org_kind: 'company' }),
    session({ sid: 'b', views: 1, device: 'phone', screen: '390x800', os: 'iOS', osver: '18.1', browser: 'Chrome', bver: '130' }),
    session({ sid: 'c', views: 6, trail: '/', last_ts: T + 4_000_000, lang: 'de' }),
  ];
  const hits = [{ sid: 'a', hour: 11, path: '/', kind: 'view' }, { sid: 'a', hour: 11, path: '/a', kind: 'view' }, { sid: 'b', hour: 11, path: '/', kind: 'view' },
    { sid: 'a', hour: 11, path: '/a', kind: 'event', name: 'win' }];
  const day = aggregateDay(sessions, hits, 7);
  assert.equal(day.visits, 3);
  assert.equal(day.views, 10);
  const d = day.details;
  assert.equal(d.bots, 7);
  assert.equal(d.events, 0);
  assert.deepEqual(d.depth, { 3: 1, 1: 1, '5+': 1 });
  assert.deepEqual(d.durations, { '5-15 min': 1, '<10 s': 1, '> 1 h': 1 });
  assert.deepEqual(d.steps.map((s) => s.name).sort(), ['/ -> /a', '/a -> /b']);
  assert.equal(d.hours[11][0], 3);
  assert.equal(d.hours[11][1], 3);
  assert.deepEqual(d.pages[0], { path: '/', views: 2, visits: 2 });
  assert.deepEqual(d.event_names, [{ name: 'win', views: 1, visits: 1 }]);
  assert.deepEqual(d.companies.map((c) => c.name), ['Manpower']);
  assert.deepEqual(d.refs.map((c) => c.name), ['google.com']);
  assert.deepEqual(d.devices.map((c) => c.name).sort(), ['phone', 'tablet']);
  assert.deepEqual(d.screens.map((c) => c.name).sort(), ['phone', 'tablet / small laptop']);
  assert.equal(d.screen_sizes.find((x) => x.name === '820x1180 @2x').visits, 2);
  assert.equal(d.average_seconds, Math.round((400 + 0 + 4000) / 3));
  assert.equal(d.one_page_visits, 1);
});
test('an empty day is all zeros', () => {
  const day = aggregateDay([], [], 0);
  assert.deepEqual([day.visits, day.views, day.details.pages, day.details.hours.length], [0, 0, [], 24]);
});

test('Ski Alpen: opens, visits and seconds per resort, a view lasts until the visit\'s next view or its last ping', () => {
  const sessions = [session({ sid: 'a', last_ts: T + 700_000 }), session({ sid: 'b', last_ts: T + 120_000 }), session({ sid: 'c', last_ts: T + 9_000_000 })];
  const view = (sid, path, ts) => ({ sid, hour: 11, path, kind: 'view', ts });
  const hits = [
    view('a', '/pb/ski.html', T), view('a', '/pb/ski.html?r=killy', T + 60_000), view('a', '/pb/ski.html?r=zermatt', T + 360_000),   // killy 300 s, zermatt until the last ping (340 s)
    view('b', '/pb/ski.html?r=killy', T), { sid: 'b', hour: 11, path: '', kind: 'event', name: 'win', ts: T + 10_000 },               // 120 s
    view('c', '/pb/ski.html?r=livigno', T), view('c', '/pb/ski.html?r=livigno', T + 3_600_000),                                       // gap capped at 1800 s, last capped at 7200 s
  ];
  const { ski } = aggregateDay(sessions, hits).details;
  assert.deepEqual(ski, [
    { r: 'livigno', views: 2, visits: 1, seconds: 1800 + 5400 },
    { r: 'zermatt', views: 1, visits: 1, seconds: 340 },
    { r: 'killy', views: 2, visits: 2, seconds: 420 },
  ].sort((x, y) => y.seconds - x.seconds));
  assert.deepEqual(aggregateDay([session({})], [{ sid: 's1', hour: 1, path: '/pb/ski.html?r=killy', kind: 'view' }]).details.ski, [{ r: 'killy', views: 1, visits: 1, seconds: 0 }], 'no ts: no time');
});
