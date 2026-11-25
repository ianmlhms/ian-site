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
