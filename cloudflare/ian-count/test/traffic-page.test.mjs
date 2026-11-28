import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOwn, ownFromDay, mergeLists, mergeSki } from '../../../traffic-details.js';

const own = (first_day, days) => ({ first_day, ts: Date.parse('2026-11-26T08:00:00Z'), days, live: { count: 0 } });
const day = (d, visits, views, pages = []) => ({ day: d, visits, views, details: { pages, entries: [{ name: '/', views: visits, visits }] } });
const old = (d, v, p) => ({ day: d, unique_visitors: v, pageviews: p, top_pages: [], details: { entries: [{ name: '/old', views: v, visits: v }] } });

test('the first (partial) day of the own counter stays GoatCounter, later days are its own', () => {
  assert.equal(ownFromDay(own('2026-11-25', []), '2026-11-27'), '2026-11-26');
  assert.equal(ownFromDay(own('2026-11-27', []), '2026-11-27'), '', 'today is the first day: nothing is "full" yet');
  assert.equal(ownFromDay(null, '2026-11-27'), '');
  const rows = [old('2026-11-24', 10, 30), old('2026-11-25', 11, 31), old('2026-11-26', 12, 32)];
  const merged = applyOwn(rows, own('2026-11-25', [day('2026-11-25', 5, 9), day('2026-11-26', 40, 99, [{ path: '/a', views: 3 }, { path: '/b', views: 7 }])]), '2026-11-27');
  assert.deepEqual(merged.rows.map((r) => [r.day, r.unique_visitors, r.source]), [['2026-11-24', 10, 'goatcounter'], ['2026-11-25', 11, 'goatcounter'], ['2026-11-26', 40, 'own']]);
  assert.deepEqual(merged.rows[2].top_pages.map((p) => p.path), ['/b', '/a']);
  assert.equal(merged.ownFrom, '2026-11-26');
});
test('a day the own counter has no row for is empty, not GoatCounter', () => {
  const merged = applyOwn([old('2026-11-26', 12, 32)], own('2026-11-25', []), '2026-11-27');
  assert.equal(merged.rows.length, 0);
});
test('Worker down or odd: the old rows come back unchanged', () => {
  const rows = [old('2026-11-26', 12, 32)];
  assert.deepEqual(applyOwn(rows, null, '2026-11-27').rows, rows);
  assert.deepEqual(applyOwn(rows, { first_day: '2026-11-20', days: 'nope' }, '2026-11-27').rows, rows);
});
test('own days merge with the same code as old ones', () => {
  const rows = [{ details: { entries: [{ name: '/', views: 2, visits: 2 }] } }, { details: { entries: [{ name: '/', views: 3, visits: 1 }] } }];
  assert.deepEqual(mergeLists(rows, 'entries'), [{ label: '/', views: 5, visits: 3 }]);
});
test('Ski Alpen days add up per resort, sorted by time', () => {
  const rows = [
    { day: '2026-11-26', details: { ski: [{ r: 'killy', views: 2, visits: 2, seconds: 600 }, { r: 'zermatt', views: 1, visits: 1, seconds: 100 }] } },
    { day: '2026-11-27', details: { ski: [{ r: 'zermatt', views: 3, visits: 2, seconds: 900 }] } },
    { day: '2026-11-20', details: { ski: [{ r: 'killy', views: 9, visits: 9, seconds: 9999 }] } },
    { day: '2026-11-27', details: {} },
  ];
  assert.deepEqual(mergeSki(rows, 7, '2026-11-26'), [{ r: 'zermatt', views: 4, visits: 3, seconds: 1000 }, { r: 'killy', views: 2, visits: 2, seconds: 600 }]);
  assert.equal(mergeSki(rows, 30).length, 2);
  assert.deepEqual(mergeSki([{ details: { ski: 'odd' } }, { details: null }], 7), []);
});
