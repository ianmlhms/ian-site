#!/usr/bin/env node
/* Goals, badges and the daily challenge without a browser (pure modules): the lift index (complete, unique keys, append-only layout),
 * goals-data.js is what the baked data gives, goals of all 11 areas (counts, progress, monotone badges, silent retro check), the lift
 * bits, the daily challenge (same for everybody by date, Europe/Luxembourg day, all three types, streak rules, order of the combo),
 * the save normalisation. Cloud size lives in cloud-size-test.mjs.
 *   node scripts/ski/goals-check.mjs     exit 0 = all green */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../pb/ski');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { LIFT_INDEX } = await imp('modes/lift-index.js');
const { PISTE_INDEX } = await imp('modes/piste-index.js');
const { GOALS_DATA } = await imp('modes/goals-data.js');
const G = await imp('modes/goals.js');
const D = await imp('modes/daily.js');
const { hash5, starKey, STAR } = await imp('modes/challenges.js');
const { liftKey } = await imp('modes/goals-keys.js');
const { emptyProgress, normalize } = await imp('progress.js');
const { unpackResort } = await imp('linepack.js');

let fails = 0, checks = 0;
const ok = (cond, text) => { checks++; if (!cond) { fails++; console.log(`  FAIL ${text}`); } };
const run = (script) => spawnSync(process.execPath, [path.join(here, script), '--check'], { encoding: 'utf8' });

const resorts = fs.readdirSync(path.join(root, 'data')).filter((d) => fs.existsSync(path.join(root, 'data', d, 'resort.json'))).sort();
ok(resorts.length === Object.keys(GOALS_DATA).length, `goals-data covers all ${resorts.length} resorts`);
ok(run('lift_index.mjs').status === 0, 'lift index complete');
ok(run('piste_index.mjs').status === 0, 'piste index complete');
const gd = run('goals_data.mjs');
ok(gd.status === 0, `goals-data.js is what the baked data gives (${(gd.stdout || '').trim()})`);

const real = {};
for (const rid of resorts) {
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(root, 'data', rid, 'resort.json'), 'utf8')));
  real[rid] = resort;
  const keys = resort.lifts.map(liftKey).filter(Boolean);
  ok(new Set(keys).size === keys.length && keys.length === resort.lifts.length, `${rid}: every lift has a unique key (${keys.length})`);
  const hashes = resort.pistes.map((p) => hash5(p.id));
  ok(new Set(hashes).size === hashes.length, `${rid}: piste hashes are unique`);
  const d = GOALS_DATA[rid];
  ok(d.pd.length === PISTE_INDEX[rid].length / 5 && d.ld.length === LIFT_INDEX[rid].length / 5, `${rid}: pd / ld are aligned with the indexes`);
  const goals = G.areaGoals(rid);
  ok(goals.length >= 7 && goals.some((g) => g.def.id === 'lifts') && goals.some((g) => g.def.id === 'disc') && goals.some((g) => g.def.id === 'top'), `${rid}: ${goals.length} goals (${goals.map((g) => g.def.id).join(' ')})`);
  // every daily candidate resolves to a real piste / lift
  const pById = new Map(resort.pistes.map((p) => [hash5(p.id), p]));
  const lByKey = new Map(resort.lifts.map((l) => [liftKey(l), l]));
  ok(d.dp.length >= 8 && d.dp.every(([pos, name, ms]) => pById.has(G.pisteHashAt(rid, pos)) && pById.get(G.pisteHashAt(rid, pos)).name.replace(/\s+/g, ' ').trim() === name && ms >= 10000 && ms <= 1200000), `${rid}: daily pistes resolve to real pistes with a sane time`);
  ok(d.dc.length >= 4 && d.dc.every(([lp, pp]) => lByKey.has(G.liftKeyAt(rid, lp)) && pById.has(G.pisteHashAt(rid, pp)) && d.nm[`l${lp}`] && d.nm[`p${pp}`]), `${rid}: daily combos resolve (${d.dc.length})`);

  // everything done step by step: the goals appear one after the other and a badge is never lost
  let p = emptyProgress();
  ok(G.goalProgress(p, rid).every((r) => !r.done && r.have === 0), `${rid}: nothing done on a fresh save`);
  for (const l of resort.lifts) p = G.markLift(p, rid, l);
  const lr = G.liftsRidden(p, rid);
  ok(lr.have === lr.need && lr.need === d.ld.split('').filter((c) => c === '1').length, `${rid}: every counted lift ridden: ${lr.have} / ${lr.need}`);
  const c1 = G.checkGoals(p, rid);
  ok(c1.gained.length === 1 && c1.gained[0].id === 'lifts' && c1.progress.goals[rid] === 1, `${rid}: riding every lift gives exactly the lifts badge`);
  ok(G.checkGoals(c1.progress, rid).progress === c1.progress, `${rid}: checking again changes nothing (the same object)`);
  const stars = {};
  for (let i = 0; i < d.pd.length; i++) if (d.pd[i] !== '-') stars[`${rid}/${G.pisteHashAt(rid, i)}`] = STAR.finish;
  const afterBlack = { ...c1.progress, stars: Object.fromEntries(Object.entries(stars).filter(([k]) => { const i = G.pistePos(rid, k.split('/')[1]); return d.pd[i] === 'k'; })) };
  const cb = G.checkGoals(afterBlack, rid);
  ok(!G.areaGoals(rid).some((g) => g.def.id === 'black') || (cb.gained.some((g) => g.id === 'black') && !cb.gained.some((g) => g.id === 'pistes')), `${rid}: all black pistes = the black badge, not "All Pisten"`);
  const all = G.checkGoals({ ...c1.progress, stars }, rid);
  ok(all.gained.some((g) => g.id === 'pistes'), `${rid}: every counted piste finished = "All Pisten"`);
  // lost fog / lifts never take a badge: a progress with the mask but nothing else still shows it done
  const lost = { ...emptyProgress(), goals: { [rid]: all.progress.goals[rid] } };
  const rows = G.goalProgress(lost, rid);
  ok(rows.filter((r) => (all.progress.goals[rid] & r.bit)).every((r) => r.done && r.have === r.need), `${rid}: badges stay when the fog, the stars and the lifts are gone`);
  ok(G.badgeCount(lost, rid).earned === G.areaGoals(rid).filter((g) => all.progress.goals[rid] & g.def.bit).length, `${rid}: badge count`);
  // discovery, top, park
  const disc = G.checkGoals({ ...emptyProgress() }, rid, { discCount: d.dn });
  ok(disc.gained.some((g) => g.id === 'disc'), `${rid}: discovering ${d.dn} cells = the discovery badge`);
  ok(!G.atTop(rid, d.top - 60) && G.atTop(rid, d.top - 10) && !G.atTop(rid, NaN), `${rid}: highest point ${d.top} m`);
  ok(G.checkGoals(emptyProgress(), rid, { top: true }).gained.some((g) => g.id === 'top'), `${rid}: the top badge from the event`);
  const pk = G.checkGoals({ ...emptyProgress(), park: { [rid]: 5200 } }, rid);
  ok(pk.gained.map((g) => g.id).sort().join() === 'park,parkpts', `${rid}: a park run of 5,200 = both park badges`);
}
// the lifts text
{
  const rid = 'killy', l0 = real[rid].lifts[0], l7 = real[rid].lifts[7];
  let p = G.markLift(emptyProgress(), rid, l7);
  ok(p.lifts.killy.length === 2 && G.liftsRidden(p, rid).have === 1, 'lift bit 7 sits in the second character');
  ok(G.markLift(p, rid, l7) === p, 'a lift ridden twice changes nothing');
  p = G.markLift(p, rid, l0);
  ok(G.liftsRidden(p, rid).have === 2 && G.mergeLifts(G.markLift(emptyProgress(), rid, l0).lifts.killy, G.markLift(emptyProgress(), rid, l7).lifts.killy) === p.lifts.killy, 'two lifts, and the union of two saves is the same text');
  ok(G.markLift(emptyProgress(), rid, { osm: 'does-not-exist' }) !== undefined && G.liftsRidden(G.markLift(emptyProgress(), rid, { name: 'no osm' }), rid).have === 0, 'a lift without an index entry is ignored');
}
// retro: an old save earns its badges silently, in every area at once
{
  const stars = {};
  for (const rid of resorts) for (let i = 0; i < GOALS_DATA[rid].pd.length; i++) if (GOALS_DATA[rid].pd[i] === 'k') stars[`${rid}/${G.pisteHashAt(rid, i)}`] = 7;
  const r = G.checkAll({ ...emptyProgress(), stars });
  ok(r.gained.filter((g) => g.id === 'black').length === resorts.length && G.badgeTotals(r.progress).earned >= resorts.length, `checkAll: the black badge in all ${resorts.length} areas`);
  ok(G.checkAll(r.progress).progress === r.progress, 'checkAll twice changes nothing');
}
// the daily challenge
{
  const a = D.dailyFor('2026-12-01'), b = D.dailyFor('2026-12-01');
  ok(JSON.stringify(a) === JSON.stringify(b) && a.day === '2026-12-01', 'the same date gives the same challenge (same for everybody)');
  const types = new Set(), rids = new Set(), texts = [];
  for (let i = 0; i < 400; i++) {
    const day = D.dayAfter('2026-11-28', i), ch = D.dailyFor(day);
    ok(!!ch && !!GOALS_DATA[ch.rid], `${day}: a challenge in a real area`);
    types.add(ch.type); rids.add(ch.rid);
    if (ch.type === 'time') ok(ch.pisteKey.length === 5 && ch.targetMs > 0 && !!ch.pisteName, `${day}: time challenge complete`);
    if (ch.type === 'combo') ok(ch.liftKey.length === 5 && ch.pisteKey.length === 5 && !!ch.liftName && !!ch.pisteName, `${day}: combo complete`);
    if (ch.type === 'stars') ok(ch.n >= 4 && ch.n <= 8, `${day}: star count 4..8`);
    if (i < 6) texts.push(D.dailyText(ch, ch.rid));
  }
  ok(types.size === 3 && rids.size === resorts.length, `400 days: all three types (${[...types]}) and all ${rids.size} areas come up`);
  console.log(`  info next days: ${texts.join(' | ')}`);
  // the day is the date in Luxembourg
  ok(D.dayOf(new Date('2026-11-28T22:30:00Z')) === '2026-11-28' && D.dayOf(new Date('2026-11-28T23:30:00Z')) === '2026-11-29', 'winter: the day turns at 23:00 UTC (CET)');
  ok(D.dayOf(new Date('2026-07-01T21:30:00Z')) === '2026-07-01' && D.dayOf(new Date('2026-07-01T22:30:00Z')) === '2026-07-02', 'summer: the day turns at 22:00 UTC (CEST)');
  ok(D.dayNumber('1970-01-02') === 1 && D.dayNumber('nonsense') === 0 && D.dayAfter('2026-12-31', 1) === '2027-01-01', 'day numbers');
  // events and the streak
  const find = (type, from = '2026-11-28') => { for (let i = 0; i < 200; i++) { const ch = D.dailyFor(D.dayAfter(from, i)); if (ch.type === type) return ch; } return null; };
  const t = find('time'), s = find('stars'), c = find('combo');
  let p = emptyProgress();
  let r = D.dailyEvent(p, t, { t: 'finish', rid: t.rid === 'killy' ? 'laax' : 'killy', key: t.pisteKey, ms: 1000, valid: true });
  ok(!r.done && r.progress === p, 'time: the wrong area does not count');
  r = D.dailyEvent(p, t, { t: 'finish', rid: t.rid, key: t.pisteKey, ms: t.targetMs + 1, valid: true });
  ok(!r.done, 'time: one millisecond too slow does not count');
  r = D.dailyEvent(p, t, { t: 'finish', rid: t.rid, key: t.pisteKey, ms: t.targetMs, valid: false });
  ok(!r.done, 'time: an invalid run does not count');
  r = D.dailyEvent(p, t, { t: 'finish', rid: t.rid, key: t.pisteKey, ms: t.targetMs, valid: true });
  ok(r.done && D.dailyDone(r.progress, t.day) && D.streakNow(r.progress, t.day) === 1, 'time: under the time = done, streak 1');
  ok(!D.dailyEvent(r.progress, t, { t: 'finish', rid: t.rid, key: t.pisteKey, ms: 1, valid: true }).done, 'a day completes once (no second streak step)');
  // stars add up over several runs
  let q = emptyProgress();
  q = D.dailyEvent(q, s, { t: 'stars', rid: s.rid, n: s.n - 1 }).progress;
  ok(D.dailyProgress(q, s).have === s.n - 1 && !D.dailyDone(q, s.day), 'stars: n - 1 stars are not enough');
  const q2 = D.dailyEvent(q, s, { t: 'stars', rid: s.rid, n: 1 });
  ok(q2.done && D.dailyDone(q2.progress, s.day), 'stars: the last star completes it');
  // the combo needs the lift first
  let w = D.dailyEvent(emptyProgress(), c, { t: 'finish', rid: c.rid, key: c.pisteKey, ms: 99999, valid: true });
  ok(!w.done, 'combo: the run before the lift does not count');
  w = D.dailyEvent(emptyProgress(), c, { t: 'lift', rid: c.rid, key: 'zzzzz' });
  ok(w.progress === w.progress && D.dailyProgress(w.progress, c).step === 0, 'combo: another lift does not count');
  w = D.dailyEvent(emptyProgress(), c, { t: 'lift', rid: c.rid, key: c.liftKey });
  ok(D.dailyProgress(w.progress, c).step === 1 && !w.done, 'combo: the lift is step 1');
  const w2 = D.dailyEvent(w.progress, c, { t: 'finish', rid: c.rid, key: c.pisteKey, ms: 99999, valid: true });
  ok(w2.done, 'combo: lift, then the run = done');
  // yesterday's counters never carry over
  ok(D.dailyProgress(w.progress, D.dailyFor(D.dayAfter(c.day, 1))).have === 0 || D.dailyFor(D.dayAfter(c.day, 1)).type === 'time', 'counters belong to their day');
  // the streak over days
  let sp = emptyProgress();
  const finishDay = (day) => { const ch = D.dailyFor(day); const ev = ch.type === 'time' ? { t: 'finish', rid: ch.rid, key: ch.pisteKey, ms: ch.targetMs, valid: true } : ch.type === 'stars' ? { t: 'stars', rid: ch.rid, n: ch.n } : null; if (ch.type === 'combo') { sp = D.dailyEvent(sp, ch, { t: 'lift', rid: ch.rid, key: ch.liftKey }).progress; return D.dailyEvent(sp, ch, { t: 'finish', rid: ch.rid, key: ch.pisteKey, ms: 1, valid: true }); } return D.dailyEvent(sp, ch, ev); };
  const days = [0, 1, 2].map((i) => D.dayAfter('2026-12-10', i));
  for (const day of days) { const r2 = finishDay(day); ok(r2.done, `${day}: completed`); sp = r2.progress; }
  ok(D.streakNow(sp, days[2]) === 3 && sp.daily.best === 3, 'three days in a row: streak 3');
  ok(D.streakNow(sp, D.dayAfter(days[2], 1)) === 3, 'the day after: the streak is still alive (3)');
  ok(D.streakNow(sp, D.dayAfter(days[2], 2)) === 0 && sp.daily.best === 3, 'two days later: shown 0, the best stays 3');
  const gap = finishDay(D.dayAfter(days[2], 3));
  ok(gap.done && gap.progress.daily.streak === 1 && gap.progress.daily.best === 3, 'after a gap the streak starts at 1 again');
  // cloud
  ok(JSON.stringify(D.dailyCloud(sp)) === JSON.stringify([D.dayNumber(days[2]), 3, 3]) && D.dailyCloud(emptyProgress()) === null, 'cloud record y = [last, streak, best]');
  ok(D.decodeDailyCloud([5, 9, 3]) === null && D.decodeDailyCloud('x') === null && D.decodeDailyCloud([5, 2, 3]).streak === 2, 'forged y rejected');
}
// the save
{
  const p = normalize({ v: 1, goals: { killy: 5, bad: -1, '!!': 3 }, lifts: { killy: 'AB', x: '<<' }, daily: { d: '2026-11-28', n: 3, s: 1, last: 5, streak: 2, best: 4 } });
  ok(JSON.stringify(p.goals) === '{"killy":5}' && JSON.stringify(p.lifts) === '{"killy":"AB"}' && p.daily.streak === 2, 'normalize keeps good goals / lifts / daily, drops bad ones');
  ok(normalize({ v: 1 }).daily.last === 0 && JSON.stringify(normalize({ v: 1 }).goals) === '{}', 'an old save has empty goals');
}
console.log(fails ? `${fails} of ${checks} FAILED` : `all ${checks} goals checks passed`);
process.exit(fails ? 1 : 0);
