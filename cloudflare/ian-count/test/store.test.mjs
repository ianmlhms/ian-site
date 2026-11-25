import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from '../src/store.js';
import { SCHEMA } from '../src/schema.js';
import { luxDay, luxHour } from '../src/parse.js';
import { makeSql } from './sql-adapter.mjs';

const T0 = Date.parse('2026-11-25T10:00:00Z');
const hit = (over = {}) => {
  const ts = over.ts ?? T0;
  return { kind: 'view', sid: 'sid-aaaaaaaa', path: '/', name: '', title: '', ts, day: luxDay(ts), hour: luxHour(ts), country: 'LU', region: 'Luxembourg',
    provider: 'POST Luxembourg', browser: 'Safari', bver: '18', os: 'iPadOS', osver: '18.6', device: 'tablet', w: 820, h: 1180, dpr: 2, lang: 'lb', tz: 'Europe/Luxembourg',
    ref: '', org: '', orgKind: '', ...over };
};
const make = (options = {}) => {
  const clock = { now: T0 };
  const sql = makeSql();
  const store = new Store(sql, { now: () => clock.now, ...options });   
  store.init(SCHEMA);
  return { store, sql, clock };
};

test('schema.js is generated from schema.sql', () => {
  assert.equal(SCHEMA, readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
});

test('a visit: views, pings, events and the trail are kept on one session row', () => {
  const { store, clock } = make();
  store.record(hit({ sid: 'visit-one-aa', path: '/', ref: 'google.com', org: 'Manpower', orgKind: 'company' }));
  store.record(hit({ sid: 'visit-one-aa', path: '/about.html', ts: T0 + 20_000 }));
  store.record(hit({ sid: 'visit-one-aa', kind: 'event', name: 'win', path: '/about.html', ts: T0 + 25_000 }));
  store.record({ kind: 'ping', sid: 'visit-one-aa', ts: T0 + 90_000, day: luxDay(T0) });
  clock.now = T0 + 91_000;
  const stats = store.stats('2026-11-25', '2026-11-25', '2026-11-25');
  const [day] = stats.days;
  assert.equal(day.visits, 1);
  assert.equal(day.views, 2);
  assert.equal(day.details.events, 1);
  assert.deepEqual(day.details.entries, [{ name: '/', views: 2, visits: 1 }]);
  assert.deepEqual(day.details.exits.map((e) => e.name), ['/about.html']);
  assert.deepEqual(day.details.steps.map((e) => e.name), ['/ -> /about.html']);
  assert.deepEqual(day.details.companies.map((e) => e.name), ['Manpower']);
  assert.equal(day.details.average_seconds, 90);
  assert.equal(day.details.durations['1-5 min'], 1);
  assert.equal(day.details.pages.find((p) => p.path === '/about.html').views, 1);
  assert.equal(day.details.hours[11][0], 3 - 1);                 // 11:00 CET: 2 views (the event is not a view)
  assert.equal(stats.live.count, 1);
  assert.equal(stats.live.sessions[0].path, '/about.html');
  assert.equal(stats.recent[0].who, 'Manpower');
  assert.deepEqual(stats.recent[0].pages, ['/', '/about.html']);
  assert.equal(JSON.stringify(stats).includes('visit-one-aa'), false, 'no session id leaves the counter');
});

test('two tabs on one network are two visits', () => {
  const { store } = make();
  store.record(hit({ sid: 'ipad-one-aaa' }));
  store.record(hit({ sid: 'ipad-two-aaa' }));
  assert.equal(store.stats('2026-11-25', '2026-11-25', '2026-11-25').days[0].visits, 2);
});

test('a ping writes one row and never a hits row', () => {
  const { store, sql } = make();
  store.record(hit({ sid: 'ping-sid-aaa' }));
  const before = sql.db.prepare('SELECT COUNT(*) n FROM hits').get().n;
  store.record({ kind: 'ping', sid: 'ping-sid-aaa', ts: T0 + 30_000, day: luxDay(T0) });
  assert.equal(sql.db.prepare('SELECT COUNT(*) n FROM hits').get().n, before);
  assert.equal(sql.db.prepare('SELECT last_ts FROM sessions').get().last_ts, T0 + 30_000);
});

test('test- sessions are ignored by the statistics and purged by the alarm', () => {
  const { store, sql, clock } = make();
  store.record(hit({ sid: 'test-abcdefgh' }));
  store.record(hit({ sid: 'real-abcdefgh' }));
  const stats = store.stats('2026-11-25', '2026-11-25', '2026-11-25');
  assert.equal(stats.days[0].visits, 1);
  assert.equal(stats.live.count, 1);
  assert.equal(stats.recent.length, 1);
  clock.now = T0 + 11 * 60_000;
  store.purge('2026-11-25');
  assert.equal(sql.db.prepare("SELECT COUNT(*) n FROM sessions WHERE sid LIKE 'test-%'").get().n, 0);
  assert.equal(sql.db.prepare("SELECT COUNT(*) n FROM hits WHERE sid LIKE 'test-%'").get().n, 0);
  assert.equal(sql.db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1);
});

test('the daily write cap stops counting and says so; midnight lifts it', () => {
  const { store, sql } = make({ cap: 12 });
  const results = Array.from({ length: 10 }, (_, i) => store.record(hit({ sid: `cap-sid-${i}aaaa` })));
  assert.ok(results.includes('capped'), results.join());
  const rows = sql.db.prepare('SELECT COUNT(*) n FROM hits').get().n;
  assert.ok(rows < 10);
  assert.equal(store.recordBot('2026-11-25'), 'capped');
  assert.equal(store.stats('2026-11-25', '2026-11-25', '2026-11-25').capped, true);
  assert.equal(sql.db.prepare("SELECT capped FROM days WHERE day='2026-11-25'").get().capped, 1);
  const tomorrow = T0 + 86_400_000;
  assert.equal(store.record(hit({ ts: tomorrow, sid: 'new-day-aaaaa' })), 'ok');
});

test('finished days roll up once, are read from daily and the raw rows can go', () => {
  const { store, sql, clock } = make({ rawDays: 1 });
  store.record(hit({ sid: 'day-one-aaaa', path: '/a' }));
  store.recordBot('2026-11-25');
  const day2 = T0 + 86_400_000;
  store.record(hit({ sid: 'day-two-aaaa', path: '/b', ts: day2 }));              // first call after midnight triggers the roll-up
  assert.equal(sql.db.prepare("SELECT rolled FROM days WHERE day='2026-11-25'").get().rolled, 1);
  const stats = store.stats('2026-11-25', '2026-11-26', '2026-11-26');
  assert.deepEqual(stats.days.map((d) => [d.day, d.visits]), [['2026-11-25', 1], ['2026-11-26', 1]]);
  assert.equal(stats.days[0].details.bots, 1);
  assert.equal(stats.first_day, '2026-11-25');
  const day4 = T0 + 3 * 86_400_000;
  clock.now = day4;
  store.record(hit({ sid: 'day-four-aaa', ts: day4 }));
  store.purge('2026-11-28');
  assert.equal(sql.db.prepare("SELECT COUNT(*) n FROM hits WHERE day = '2026-11-25'").get().n, 0);
  assert.equal(store.stats('2026-11-25', '2026-11-25', '2026-11-28').days[0].visits, 1, 'the daily totals stay');
});

test('stats of long ranges read only daily rows plus today', () => {
  const { store, sql } = make();
  for (let d = 0; d < 5; d += 1) store.record(hit({ sid: `long-${d}-aaaaaa`, ts: T0 + d * 86_400_000 }));
  const reads = [];
  const original = sql.exec.bind(sql);
  sql.exec = (q, ...b) => { reads.push(q); return original(q, ...b); };
  store.stats('2026-11-25', '2026-11-29', '2026-11-29');
  assert.ok(reads.filter((q) => /FROM hits/.test(q)).length <= 1, 'raw hits scanned at most for today');
});

test('the write counter is saved by views and stays near the truth', () => {
  const { store, sql } = make({ cap: 1e9 });
  for (let i = 0; i < 40; i += 1) store.record(hit({ sid: `est-${i}-aaaaaaa` }));
  const [, saved] = sql.db.prepare("SELECT v FROM meta WHERE k='cap'").get().v.split(':');
  const real = sql.db.prepare('SELECT COUNT(*) n FROM hits').get().n + sql.db.prepare('SELECT COUNT(*) n FROM sessions').get().n;
  assert.ok(Number(saved) >= real && Number(saved) < real * 3, `${saved} vs ${real}`);
});
