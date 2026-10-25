#!/usr/bin/env node
/* MTB Mëllerdall: save / progress / ghost tests.   node pb/mtb/harness-save.js [--verbose]
 * Pure Node, no browser: ghost.js, progress.js, save.js (persistence runs against a fake window / parent / storage).
 * Exit code 0 only when every check passes. */
import {
  encodeGhost, recordGhost, decodeGhost, ghostAt,
} from './ghost.js';
import {
  TRAIL_IDS, BIKE_IDS, COLOUR_IDS, HELMET_IDS, MARATHON_ID, createProgress, normalizeProgress, mergeProgress, recordRun, recordViewpoint,
  recordDaily, progressPoints, overallScore, isTrailUnlocked, isBikeUnlocked, unlockedBikes, unlockedColours, unlockedHelmets, newUnlocks,
  viewpointCount, hasViewpoint, withViewpoint, dayNumber, dailyChallenge, timeScore, scoreTime, boardId, medalPoints, bestMs, bestSplits,
  ghostFor, ghostOrder, addStats, withLoadout, withSettings, withName, settingsOf, SETTING_OPTIONS, MAX_GHOSTS,
} from './progress.js';
import {
  SAVE_LIMIT_BYTES, JSONB_LIMIT_BYTES, LOCAL_KEY, BACKUP_KEY, jsonbSize, saveSizes, serializeProgress, shrinkToFit, pickBest,
  createPersistence, loadInitialProgress, createScoreReporter, dailyRpc, SAVE_DELAY_MS, MAX_SAVE_WAIT_MS, RPC_TIMEOUT_MS,
} from './save.js';

const VERBOSE = process.argv.includes('--verbose');
const results = { pass: 0, fail: 0, failures: [] };
function check(name, ok, detail = '') {
  if (ok) { results.pass++; if (VERBOSE) console.log('  ok  ', name, detail); return; }
  results.fail++;
  results.failures.push(`${name}${detail ? ' :: ' + detail : ''}`);
  console.log('  FAIL', name, detail);
}
const section = (title) => console.log(`\n== ${title}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const quiet = (fn) => { const warn = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = warn; } };

// ---------------------------------------------------------------- helpers
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A synthetic run: speed varies smoothly, the lateral offset follows the track. Samples every ~100 ms (jittered). */
function synthRun(seconds, { seed = 1, speed = 6, lateralPeriodM = 160 } = {}) {
  const random = mulberry(seed);
  const end = seconds * 1000;
  const wave = Math.max(37, seconds / 20);   // pace changes get slower on long rides (climbs, not corners)
  const offset = (s) => 3.4 * Math.sin(2 * Math.PI * s / lateralPeriodM) + 1.2 * Math.sin(2 * Math.PI * s / (lateralPeriodM * 2.7));
  const samples = [];
  let t = 0, s = 0;
  samples.push({ t, s, o: offset(s) });
  while (t < end) {
    const step = Math.min(end - t, 80 + Math.floor(random() * 50));
    const sec = t / 1000;
    const v = speed * (1 + 0.25 * Math.sin(2 * Math.PI * sec / wave) + 0.12 * Math.sin(2 * Math.PI * sec / (wave * 1.65) + 1));
    s += v * step / 1000; t += step;
    samples.push({ t, s, o: offset(s) });
  }
  return { samples, sec: seconds };
}

function ghostError(samples, text) {
  const ghost = decodeGhost(text);
  if (!ghost) return { s: Infinity, o: Infinity };
  let es = 0, eo = 0;
  for (const sample of samples) {
    const at = ghostAt(ghost, sample.t);
    es = Math.max(es, Math.abs(at.s - sample.s));
    eo = Math.max(eo, Math.abs(at.o - sample.o));
  }
  return { s: es, o: eo };
}

const GHOST_A = encodeGhost(synthRun(400, { seed: 3 }).samples);
const GHOST_B = encodeGhost(synthRun(420, { seed: 4, speed: 7 }).samples);
const GHOST_C = encodeGhost(synthRun(900, { seed: 5 }).samples);
const GHOST_D = encodeGhost(synthRun(300, { seed: 6 }).samples);
const GHOST_MAX = encodeGhost(synthRun(1900, { seed: 7, speed: 5 }).samples);
const SPLITS = (n, end) => Array.from({ length: n }, (_, i) => Math.round(end * (i + 1) / (n + 1)));

/* ---------------------------------------------------------------- ghost */
section('ghost');
for (const [seconds, label] of [[60, '60 s'], [120, '2 min'], [400, '400 s'], [900, '15 min'], [2100, '35 min'], [2400, '40 min']]) {
  const { samples } = synthRun(seconds, { seed: seconds, speed: seconds > 1000 ? 4.8 : 6, lateralPeriodM: seconds > 1000 ? 220 : 160 });
  const text = recordGhost(samples);
  const err = ghostError(samples, text);
  check(`round trip ${label}: s error < 0.3 m`, err.s < 0.3, `${err.s.toFixed(3)} m`);
  check(`round trip ${label}: o error < 0.3 m`, err.o < 0.3, `${err.o.toFixed(3)} m`);
  const ghost = decodeGhost(text);
  check(`${label}: duration and last sample are the finish`, ghost.duration === Math.round(samples.at(-1).t)
    && Math.abs(ghost.s.at(-1) - samples.at(-1).s) <= 0.13, `${ghost.s.at(-1).toFixed(2)} vs ${samples.at(-1).s.toFixed(2)}`);
  if (seconds === 400 || seconds === 2100) check(`${label}: size < 1700 chars`, text.length < 1700, `${text.length} chars`);
  // monotone s, speed finite and non-negative
  let monotone = true, last = -1, fine = true;
  for (let t = -50; t <= ghost.duration + 50; t += 7) {
    const at = ghostAt(ghost, t);
    if (at.s < last - 1e-9) monotone = false;
    if (!(Number.isFinite(at.s) && Number.isFinite(at.o) && Number.isFinite(at.speed) && at.speed >= 0)) fine = false;
    last = at.s;
  }
  check(`${label}: ghostAt is monotone and finite`, monotone && fine);
}
{
  const { samples } = synthRun(400, { seed: 3 });
  const ghost = decodeGhost(GHOST_A);
  check('400 s run is about 1.5 kB', GHOST_A.length > 1300 && GHOST_A.length < 1700, `${GHOST_A.length}`);
  check('header is g1.<dt>.<T>.<body>', /^g1\.[0-9a-z]+\.[0-9a-z]+\.[0-9a-z]+$/.test(GHOST_A));
  check('encoding is deterministic', encodeGhost(samples) === GHOST_A);
  check('encode does not touch its input', same(samples, synthRun(400, { seed: 3 }).samples));
  const before = ghostAt(ghost, -100), start = ghostAt(ghost, 0), end = ghostAt(ghost, ghost.duration), after = ghostAt(ghost, ghost.duration + 99999);
  check('before 0 returns the first sample', before.s === ghost.s[0] && before.o === ghost.o[0] && start.s === ghost.s[0]);
  check('after the end holds the last sample', end.s === ghost.s.at(-1) && after.s === ghost.s.at(-1) && after.speed === 0);
  const mid = ghostAt(ghost, 200000);
  const truth = samples.reduce((best, sample) => (Math.abs(sample.t - 200000) < Math.abs(best.t - 200000) ? sample : best));
  check('speed is the derivative (within 1.5 m/s of the sampled slope)', Math.abs(mid.speed - 6) < 3, `${mid.speed.toFixed(2)} m/s`);
  check('position at 200 s matches the run', Math.abs(mid.s - truth.s) < 1.5, `${mid.s.toFixed(1)} vs ${truth.s.toFixed(1)}`);
  const clamped = encodeGhost([{ t: 0, s: 0, o: 99 }, { t: 10000, s: 50, o: -99 }, { t: 20000, s: 40, o: 0 }]);
  const cg = decodeGhost(clamped);
  check('lateral offset is clamped to +-7 m', cg.o[0] === 7 && cg.o.every((v) => v >= -7 && v <= 7), `${cg.o[0]}`);
  check('a decreasing s input is made monotone', cg.s.every((v, i) => i === 0 || v >= cg.s[i - 1]));
  const shortGhost = encodeGhost([{ t: 0, s: 0, o: 0 }, { t: 5000, s: 30, o: 1 }]);
  check('a 5 s run encodes at dt 500 ms', decodeGhost(shortGhost)?.dt === 500 && decodeGhost(shortGhost).s.length === 11);
  quiet(() => {
    check('too few samples encode to null', encodeGhost([{ t: 0, s: 0, o: 0 }]) === null && encodeGhost([]) === null && encodeGhost(null) === null);
    check('a 3 s run encodes to null', encodeGhost([{ t: 0, s: 0, o: 0 }, { t: 3000, s: 10, o: 0 }]) === null);
    check('NaN and junk samples are skipped', encodeGhost([{ t: NaN, s: 0, o: 0 }, null, 'x', { t: 0, s: 0, o: 0 }]) === null);
  });
  const bad = [
    undefined, null, 5, {}, '', 'g1', 'g1...', 'g2.8.' + GHOST_A.split('.').slice(2).join('.'), GHOST_A.slice(0, -1), GHOST_A + '0', GHOST_A.slice(0, -3),
    GHOST_A.replace(/\.[0-9a-z]+$/, '.' + 'A'.repeat(1503)), 'g1.8.ass8.' + 'x'.repeat(10), GHOST_A.replace('g1.', 'g1.0.'), GHOST_A.replace(/^g1\.[0-9a-z]+/, 'g1.zz'),
    GHOST_A.replace(/^(g1\.[0-9a-z]+)\.[0-9a-z]+/, '$1.0'), GHOST_A.replace(/^(g1\.[0-9a-z]+)\.[0-9a-z]+/, '$1.zzzzzzzz'), 'g1.8.ass8.' + '-'.repeat(1503),
    GHOST_A + '.extra', 'x'.repeat(100000), GHOST_A.toUpperCase(), 'g1.8.ass8', '__proto__',
  ];
  quiet(() => {
    bad.forEach((text, i) => {
      let result;
      try { result = decodeGhost(text); } catch (error) { result = 'THROWN ' + error.message; }
      check(`malformed ghost #${i} decodes to null`, result === null, String(result).slice(0, 60));
    });
  });
}

/* ---------------------------------------------------------------- progress: defaults, hostility */
section('progress: defaults and hostile input');
const FRESH = createProgress();
check('defaults round trip through normalize', same(normalizeProgress(FRESH), FRESH));
check('defaults survive JSON text', same(normalizeProgress(JSON.stringify(FRESH)), FRESH));
check('defaults are tiny', bytes(FRESH) < 200, `${bytes(FRESH)} bytes`);
check('createProgress returns fresh objects', createProgress() !== createProgress() && createProgress().st !== createProgress().st);
check('defaults: first trail open, others locked', isTrailUnlocked(FRESH, TRAIL_IDS[0]) && TRAIL_IDS.slice(1).every((id) => !isTrailUnlocked(FRESH, id)));
check('defaults: tb is 0, score is 0', FRESH.tb === 0 && progressPoints(FRESH) === 0 && overallScore(FRESH) === 0);

const POLLUTION = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted2":1}},"m":"3333333","g":{"__proto__":"x"},"se":{"__proto__":{"q":"high"},"lang":"__proto__"}}');
const HOSTILE = [
  ['undefined', undefined], ['null', null], ['number', 7], ['NaN', NaN], ['string junk', 'hello'], ['array', [1, 2, 3]], ['empty object', {}],
  ['broken json', '{"v":1,'], ['huge json text', '{"x":"' + 'a'.repeat(200000) + '"}'], ['prototype pollution', POLLUTION],
  ['huge numbers', { v: 1, tb: 1e308, ds: 1e308, dm: -1e308, t: 1e308, st: { km: Infinity, rides: -5, crashes: NaN, air: 1e300 }, dy: [1e308, 1e308], vp: 1e308 }],
  ['wrong types', { m: 5, b: {}, cp: 'x', g: [], go: 12, bk: {}, col: 7, hm: null, vp: [], dy: 'x', ds: '5', dm: [], st: 'x', se: 5, n: 99, t: 'now' }],
  ['100 kB strings', { m: '3'.repeat(100000), b: 'z,'.repeat(50000), vp: 'z'.repeat(100000), n: 'x'.repeat(100000), go: '1'.repeat(100000), g: { [TRAIL_IDS[0]]: 'g1.' + 'x'.repeat(100000) }, cp: { [TRAIL_IDS[0]]: '1,'.repeat(50000) } }],
  ['bad medals', { m: '9abc-1' }], ['bad bests', { b: '-5,zzzzzz,0,1,,Z,1,2,3' }], ['unknown trails', { cp: { nope: '1,2' }, g: { nope: GHOST_A } }],
  ['locked loadout', { bk: 'downhill', col: 'white', hm: 'gold' }], ['bad settings', { se: { q: 'ultra', lang: 'xx', snd: 5, cam: 1.5, time: 3, weather: [], season: {}, extra: 1 } }],
  ['ghost without best', { g: { [TRAIL_IDS[0]]: GHOST_A }, go: '0' }], ['control chars name', { n: '\u0000<b>Ian</b>\n\t"x"' }],
  ['daily nonsense', { dy: [-5, -5], ds: -1 }], ['daily float', { dy: [12.5, 99999.5] }], ['negative stats', { st: { km: -1, rides: 1.9, crashes: '3', air: null } }],
  ['viewpoint garbage', { vp: '!!!' }], ['nested depth bomb', JSON.parse('{"a":'.repeat(500) + '1' + '}'.repeat(500))],
];
const ALLOWED_KEYS = new Set(['v', 'tb', 'm', 'b', 'cp', 'g', 'go', 'bk', 'col', 'hm', 'vp', 'dy', 'ds', 'dm', 'st', 'se', 'n', 't']);
function cleanProblems(p) {
  const problems = [];
  const keys = Object.keys(p);
  if (!keys.every((k) => ALLOWED_KEYS.has(k))) problems.push('unknown key');
  if (p.v !== 1) problems.push('v');
  if (!Number.isSafeInteger(p.tb) || p.tb < 0 || p.tb !== progressPoints(p)) problems.push('tb');
  if (!/^[0-3]{6}$/.test(p.m)) problems.push('m');
  if (!/^([0-9a-z]{0,6},){5}[0-9a-z]{0,6}$/.test(p.b)) problems.push('b');
  if (Object.keys(p.cp).some((k) => !TRAIL_IDS.includes(k) || !/^[0-9a-z]{1,6}(,[0-9a-z]{1,6}){0,23}$/.test(p.cp[k]))) problems.push('cp');
  if (Object.keys(p.g).length > MAX_GHOSTS || Object.keys(p.g).some((k) => !TRAIL_IDS.includes(k) || decodeGhost(p.g[k]) === null)) problems.push('g');
  if (!/^[0-5]{0,3}$/.test(p.go) || p.go.length !== Object.keys(p.g).length) problems.push('go');
  if (!BIKE_IDS.includes(p.bk) || !COLOUR_IDS.includes(p.col) || !HELMET_IDS.includes(p.hm)) problems.push('loadout');
  if (!unlockedBikes(p).includes(p.bk) || !unlockedColours(p).includes(p.col) || !unlockedHelmets(p).includes(p.hm)) problems.push('loadout locked');
  if (!/^[0-9a-z]{1,13}$/.test(p.vp) || viewpointCount(p.vp) > 64) problems.push('vp');
  if (!Array.isArray(p.dy) || p.dy.length !== 2 || !p.dy.every(Number.isSafeInteger) || p.dy.some((x) => x < 0)) problems.push('dy');
  if (!(Number.isInteger(p.ds) && p.ds >= 0 && p.ds <= 999 && Number.isInteger(p.dm) && p.dm >= p.ds && p.dm <= 999)) problems.push('ds');
  if (!Object.values(p.st).every((x) => Number.isSafeInteger(x) && x >= 0) || Object.keys(p.st).join() !== 'km,rides,crashes,air') problems.push('st');
  if (!Object.entries(p.se).every(([k, v]) => SETTING_OPTIONS[k]?.includes(v))) problems.push('se');
  if ('n' in p && !(typeof p.n === 'string' && [...p.n].length <= 12 && p.n.length > 0 && !/[\u0000-\u001f<>&"'`\\]/.test(p.n))) problems.push('n');
  if (!Number.isSafeInteger(p.t) || p.t < 0) problems.push('t');
  if (bytes(p) > SAVE_LIMIT_BYTES) problems.push('size');
  return problems;
}
for (const [label, raw] of HOSTILE) {
  let normalized;
  try { normalized = quiet(() => normalizeProgress(raw)); } catch (error) { check(`hostile "${label}" does not throw`, false, error.message); continue; }
  const problems = cleanProblems(normalized);
  check(`hostile "${label}" normalises to a clean save`, problems.length === 0, problems.join(','));
  check(`hostile "${label}": normalize is idempotent`, same(quiet(() => normalizeProgress(normalized)), normalized));
}
check('prototype pollution did not happen', ({}).polluted === undefined && ({}).polluted2 === undefined && Object.getPrototypeOf(normalizeProgress(POLLUTION).se) === Object.prototype);
check('"__proto__" setting value is rejected', !('lang' in normalizeProgress(POLLUTION).se));
check('medals beyond 6 digits are dropped', normalizeProgress(POLLUTION).m === '333333');
check('huge numbers clamp, Infinity / NaN fall back to 0', normalizeProgress(HOSTILE[10][1]).ds === 999 && normalizeProgress(HOSTILE[10][1]).st.km === 0 && normalizeProgress(HOSTILE[10][1]).st.air === 9999999 && normalizeProgress(HOSTILE[10][1]).t === 4102444800 && normalizeProgress(HOSTILE[10][1]).vp === '0');
check('locked loadout falls back to defaults', same([normalizeProgress({ bk: 'downhill', col: 'white', hm: 'gold' }).bk, normalizeProgress({ bk: 'downhill', col: 'white', hm: 'gold' }).col], ['hardtail', 'red']));
check('earned loadout is kept', normalizeProgress({ m: '333333', bk: 'downhill', col: 'white', hm: 'gold' }).bk === 'downhill');
check('name is cleaned and cut at 12', normalizeProgress({ n: '  Ian <b> the Great Rider' }).n === 'Ian b the Gr');
check('ghost without a best time is dropped', Object.keys(normalizeProgress(HOSTILE[19][1]).g).length === 0);
check('tb is recomputed, never trusted', normalizeProgress({ tb: 999999, m: '100000', b: 'ass8,,,,,' }).tb === 1000 + 1);
check('a huge JSON text is refused', quiet(() => normalizeProgress('{"m":"' + '1'.repeat(200000) + '"}')).m === '000000');

/* ---------------------------------------------------------------- unlock rules */
section('unlock rules');
const withMedals = (m) => normalizeProgress({ m });
check('trail chain: a bronze opens the next trail', isTrailUnlocked(withMedals('100000'), TRAIL_IDS[1]) && !isTrailUnlocked(withMedals('100000'), TRAIL_IDS[2]));
check('trail chain: a gap does not open later trails', !isTrailUnlocked(withMedals('010000'), TRAIL_IDS[1]) && isTrailUnlocked(withMedals('010000'), TRAIL_IDS[2]));
check('trail chain: all bronze opens the marathon', isTrailUnlocked(withMedals('111110'), MARATHON_ID) && !isTrailUnlocked(withMedals('111100'), MARATHON_ID));
check('unknown trail is locked', !isTrailUnlocked(FRESH, 'nope'));
const pointsOf = (points) => withMedals([...Array(6)].map((_, i) => Math.max(0, Math.min(3, points - 3 * i))).join(''));
check('bike thresholds 3 / 8 / 14', [[2, 'trail', false], [3, 'trail', true], [7, 'enduro', false], [8, 'enduro', true], [13, 'downhill', false], [14, 'downhill', true]]
  .every(([points, bike, expected]) => medalPoints(pointsOf(points)) === points && isBikeUnlocked(pointsOf(points), bike) === expected));
check('hardtail is always unlocked, unknown bike never', isBikeUnlocked(FRESH, 'hardtail') && !isBikeUnlocked(FRESH, 'tank') && !isBikeUnlocked(FRESH, '__proto__'));
check('unlockedBikes at 0 / 3 / 14 / 18', same([0, 3, 14, 18].map((p) => unlockedBikes(pointsOf(p)).length), [1, 2, 4, 4]));
check('colours: red and blue open, then one per 2 points', unlockedColours(FRESH).join() === 'red,blue'
  && unlockedColours(pointsOf(2)).length === 3 && unlockedColours(pointsOf(12)).length === 8 && unlockedColours(pointsOf(11)).length === 7);
check('helmets: one per 4 points', same([0, 3, 4, 8, 12, 18].map((p) => unlockedHelmets(pointsOf(p)).length), [1, 1, 2, 3, 4, 4]));
{
  const before = FRESH;
  const after = withMedals('300000');
  const unlocks = newUnlocks(before, after);
  check('newUnlocks: first gold opens trail 2, trail bike, 2 colours, a helmet', same(unlocks.trails, [TRAIL_IDS[1]]) && same(unlocks.bikes, ['trail'])
    && same(unlocks.colours, ['green']) && same(unlocks.helmets, []), JSON.stringify(unlocks));
  check('newUnlocks: nothing new for the same progress', newUnlocks(after, after).trails.length === 0 && newUnlocks(after, after).bikes.length === 0);
  check('newUnlocks: never reports a lock', newUnlocks(after, before).trails.length === 0 && newUnlocks(after, before).colours.length === 0);
}

/* ---------------------------------------------------------------- recording */
section('recording runs, viewpoints, daily');
let run = recordRun(FRESH, { trailId: TRAIL_IDS[0], ms: 421000, checkpointsMs: SPLITS(8, 421000), ghostText: GHOST_A, medal: 2 });
check('first run is a best and a new medal', run.isBest && run.newMedal && bestMs(run.progress, TRAIL_IDS[0]) === 421000 && run.progress.m === '200000');
check('first run unlocks the next trail', same(run.unlocks.trails, [TRAIL_IDS[1]]));
check('first run keeps its ghost and splits', ghostFor(run.progress, TRAIL_IDS[0])?.duration === decodeGhost(GHOST_A).duration && bestSplits(run.progress, TRAIL_IDS[0]).length === 8);
check('input progress is not mutated', same(FRESH, createProgress()));
const slower = recordRun(run.progress, { trailId: TRAIL_IDS[0], ms: 430000, checkpointsMs: SPLITS(8, 430000), ghostText: GHOST_B, medal: 1 });
check('slower run changes nothing', !slower.isBest && !slower.newMedal && same(slower.progress, run.progress));
const slowerGold = recordRun(run.progress, { trailId: TRAIL_IDS[0], ms: 430000, ghostText: GHOST_B, medal: 3 });
check('slower run with a better medal raises only the medal', !slowerGold.isBest && slowerGold.newMedal && slowerGold.progress.m === '300000'
  && bestMs(slowerGold.progress, TRAIL_IDS[0]) === 421000 && slowerGold.progress.g[TRAIL_IDS[0]] === GHOST_A);
const faster = recordRun(run.progress, { trailId: TRAIL_IDS[0], ms: 400000, checkpointsMs: SPLITS(5, 400000), ghostText: GHOST_B, medal: 1 });
check('faster run replaces time, splits and ghost; medal stays', faster.isBest && !faster.newMedal && faster.progress.m === '200000'
  && bestMs(faster.progress, TRAIL_IDS[0]) === 400000 && bestSplits(faster.progress, TRAIL_IDS[0]).length === 5 && faster.progress.g[TRAIL_IDS[0]] === GHOST_B);
const noGhost = recordRun(run.progress, { trailId: TRAIL_IDS[0], ms: 400000, medal: 2 });
check('a new best without ghost or splits drops the stale ones', noGhost.isBest && !(TRAIL_IDS[0] in noGhost.progress.g) && !(TRAIL_IDS[0] in noGhost.progress.cp) && noGhost.progress.go === '');
quiet(() => {
  check('invalid runs are ignored', [{ trailId: 'nope', ms: 5000 }, { trailId: TRAIL_IDS[0], ms: 10 }, { trailId: TRAIL_IDS[0], ms: NaN }, { trailId: TRAIL_IDS[0], ms: 1e9 }, {}, undefined]
    .every((args) => { const r = recordRun(run.progress, args); return !r.isBest && same(r.progress, run.progress); }));
  const bad = recordRun(FRESH, { trailId: TRAIL_IDS[0], ms: 300000, checkpointsMs: [5, 3, 9], ghostText: 'g1.junk', medal: 99 });
  check('bad splits / ghost are dropped, medal is clamped, the time is kept', bad.isBest && bestMs(bad.progress, TRAIL_IDS[0]) === 300000
    && !(TRAIL_IDS[0] in bad.progress.cp) && !(TRAIL_IDS[0] in bad.progress.g) && bad.progress.m === '300000');
});
{
  // ghosts for the 3 most recent bests only
  let progress = FRESH;
  const ghosts = [GHOST_A, GHOST_B, GHOST_C, GHOST_D];
  TRAIL_IDS.slice(0, 4).forEach((id, i) => { progress = recordRun(progress, { trailId: id, ms: 300000 + i * 1000, checkpointsMs: SPLITS(6, 300000), ghostText: ghosts[i], medal: 1 }).progress; });
  check('only the 3 most recent bests keep a ghost', same(ghostOrder(progress), TRAIL_IDS.slice(1, 4)) && Object.keys(progress.g).length === 3, ghostOrder(progress).join());
  check('the oldest ghost was dropped, its best time stays', !(TRAIL_IDS[0] in progress.g) && bestMs(progress, TRAIL_IDS[0]) === 300000);
  const reorder = recordRun(progress, { trailId: TRAIL_IDS[1], ms: 290000, ghostText: GHOST_D, medal: 1 }).progress;
  check('a new best on an old ghost trail moves it to the newest', ghostOrder(reorder).at(-1) === TRAIL_IDS[1] && Object.keys(reorder.g).length === 3);
  const viaJson = normalizeProgress(JSON.parse(JSON.stringify(reorder)));
  check('ghost order survives a JSON round trip', same(ghostOrder(viaJson), ghostOrder(reorder)));
  check('ghost order survives jsonb key re-ordering', same(ghostOrder(normalizeProgress({ ...reorder, g: Object.fromEntries(Object.entries(reorder.g).reverse()) })), ghostOrder(reorder)));
}
{
  let r = recordViewpoint(FRESH, 5);
  check('viewpoint 5 is new', r.isNew && r.count === 1 && hasViewpoint(r.progress.vp, 5) && !hasViewpoint(r.progress.vp, 4));
  r = recordViewpoint(r.progress, 5);
  check('viewpoint 5 again is not new', !r.isNew && r.count === 1);
  r = recordViewpoint(r.progress, 63);
  check('viewpoint 63 (top bit) is exact', r.isNew && r.count === 2 && hasViewpoint(r.progress.vp, 63) && hasViewpoint(r.progress.vp, 5));
  quiet(() => check('invalid viewpoint indices are ignored', [-1, 64, 1.5, NaN, '3', null].every((i) => !recordViewpoint(r.progress, i).isNew)));
  let vp = '0';
  for (let i = 0; i < 64; i++) vp = withViewpoint(vp, i);
  check('all 64 viewpoints: count 64, 13 base-36 chars, every bit set', viewpointCount(vp) === 64 && vp.length <= 13 && Array.from({ length: 64 }, (_, i) => hasViewpoint(vp, i)).every(Boolean), vp);
  check('withViewpoint is pure and idempotent', withViewpoint('0', 3) === withViewpoint(withViewpoint('0', 3), 3) && viewpointCount('0') === 0);
  check('a corrupt vp counts as none', viewpointCount('???') === 0 && viewpointCount('') === 0 && viewpointCount(null) === 0);
}
{
  const d1 = recordDaily(FRESH, { day: 20000, ms: 200000 });
  check('first daily: best, streak 1', d1.isBest && d1.streak === 1 && same(d1.progress.dy, [20000, 200000]));
  const d1b = recordDaily(d1.progress, { day: 20000, ms: 210000 });
  check('same day slower: unchanged', !d1b.isBest && same(d1b.progress, d1.progress));
  const d1c = recordDaily(d1.progress, { day: 20000, ms: 190000 });
  check('same day faster: better time, streak unchanged', d1c.isBest && d1c.streak === 1 && d1c.progress.dy[1] === 190000);
  const d2 = recordDaily(d1.progress, { day: 20001, ms: 250000 });
  check('next day extends the streak', d2.streak === 2 && d2.progress.dm === 2 && same(d2.progress.dy, [20001, 250000]));
  const d4 = recordDaily(d2.progress, { day: 20004, ms: 250000 });
  check('a gap resets the streak, the longest stays', d4.streak === 1 && d4.progress.dm === 2);
  check('an older day changes nothing', same(recordDaily(d2.progress, { day: 19990, ms: 100000 }).progress, d2.progress));
  quiet(() => check('invalid daily results are ignored', [{ day: 0, ms: 5000 }, { day: 1.5, ms: 5000 }, { day: 2e6, ms: 5000 }, { day: 20000, ms: 5 }, { day: 20000, ms: NaN }, {}].every((a) => same(recordDaily(FRESH, a).progress, FRESH))));
  check('a streak reset does not lower tb', d4.progress.tb >= d2.progress.tb);
  const capped = recordDaily(normalizeProgress({ dy: [100, 5000], ds: 999 }), { day: 101, ms: 6000 });
  check('streak is capped at 999', capped.progress.ds === 999);
}
check('stats: addStats adds, ignores negatives, caps', (() => {
  const s = addStats(addStats(FRESH, { km: 25, rides: 1, crashes: 2, air: 7 }), { km: -5, rides: 1.9, crashes: NaN, air: 1e12 });
  return s.st.km === 25 && s.st.rides === 2 && s.st.crashes === 2 && s.st.air === 9999999;
})());
check('loadout / settings / name setters', (() => {
  const gold = normalizeProgress({ m: '333333' });
  const picked = withLoadout(gold, { bk: 'downhill', col: 'purple', hm: 'gold' });
  const refused = withLoadout(FRESH, { bk: 'downhill', col: 'purple', hm: 'gold' });
  const set = withSettings(FRESH, { q: 'high', lang: 'xx', snd: 0 });
  return picked.bk === 'downhill' && picked.col === 'purple' && refused.bk === 'hardtail' && refused.col === 'red' && set.se.q === 'high' && !('lang' in set.se)
    && settingsOf(set).snd === 0 && settingsOf(FRESH).q === 'auto' && withName(FRESH, 'Quinn').n === 'Quinn' && !('n' in withName(withName(FRESH, 'Quinn'), '  '));
})());

/* ---------------------------------------------------------------- merge */
section('merge');
function randomProgress(seed) {
  const random = mulberry(seed);
  let p = createProgress();
  const ghosts = [GHOST_A, GHOST_B, GHOST_C, GHOST_D, null];
  const runs = Math.floor(random() * 12);
  for (let i = 0; i < runs; i++) {
    const id = TRAIL_IDS[Math.floor(random() * TRAIL_IDS.length)];
    const ms = 200000 + Math.floor(random() * 90) * 1000;
    p = recordRun(p, { trailId: id, ms, checkpointsMs: random() < 0.7 ? SPLITS(5 + Math.floor(random() * 10), ms) : undefined, ghostText: ghosts[Math.floor(random() * ghosts.length)], medal: Math.floor(random() * 4) }).progress;
  }
  for (let i = Math.floor(random() * 20); i > 0; i--) p = recordViewpoint(p, Math.floor(random() * 64)).progress;
  if (random() < 0.7) p = recordDaily(p, { day: 20000 + Math.floor(random() * 5), ms: 100000 + Math.floor(random() * 90000) }).progress;
  if (random() < 0.5) p = recordDaily(p, { day: 20003 + Math.floor(random() * 4), ms: 100000 + Math.floor(random() * 90000) }).progress;
  p = addStats(p, { km: Math.floor(random() * 5000), rides: Math.floor(random() * 50), crashes: Math.floor(random() * 90), air: Math.floor(random() * 900) });
  if (random() < 0.5) p = withSettings(p, { q: SETTING_OPTIONS.q[Math.floor(random() * 4)], cam: Math.floor(random() * 3) });
  if (random() < 0.5) p = withLoadout(p, { bk: BIKE_IDS[Math.floor(random() * 4)], col: COLOUR_IDS[Math.floor(random() * 8)], hm: HELMET_IDS[Math.floor(random() * 4)] });
  if (random() < 0.3) p = withName(p, 'Rider' + seed);
  return normalizeProgress({ ...p, t: 1700000000 + Math.floor(random() * 100000) });
}
const NUMERIC = ['m', 'b', 'vp', 'st', 'ds', 'dy', 'dm', 'tb'];
let fuzzOk = { commutative: 0, medals: 0, bests: 0, points: 0, idempotent: 0, ghosts: 0, clean: 0, viewpoints: 0, total: 0 };
for (let seed = 1; seed <= 300; seed++) {
  const a = randomProgress(seed), b = randomProgress(seed * 7919 + 13);
  const ab = mergeProgress(a, b), ba = mergeProgress(b, a);
  fuzzOk.total++;
  if (NUMERIC.every((k) => same(ab[k], ba[k]))) fuzzOk.commutative++; else if (VERBOSE) console.log('   not commutative', seed, NUMERIC.filter((k) => !same(ab[k], ba[k])));
  const ma = a.m, mb = b.m;
  if ([...ab.m].every((d, i) => d >= ma[i] && d >= mb[i])) fuzzOk.medals++;
  const bestOf = (p) => TRAIL_IDS.map((id) => bestMs(p, id));
  const ba_ = bestOf(a), bb_ = bestOf(b), bm = bestOf(ab);
  if (bm.every((v, i) => v > 0 === (ba_[i] > 0 || bb_[i] > 0) && (ba_[i] === 0 || v <= ba_[i]) && (bb_[i] === 0 || v <= bb_[i]))) fuzzOk.bests++;
  if (ab.tb >= a.tb && ab.tb >= b.tb && ab.tb === progressPoints(ab)) fuzzOk.points++;
  if (comparable(mergeProgress(ab, ab)) === comparable(ab) && comparable(mergeProgress(a, a)) === comparable(a)) fuzzOk.idempotent++;
  const ghostsOk = Object.keys(ab.g).length <= 3 && Object.keys(ab.g).every((id) => {
    const best = bestMs(ab, id);
    return (bestMs(a, id) === best && a.g[id] === ab.g[id]) || (bestMs(b, id) === best && b.g[id] === ab.g[id]);
  }) && Object.keys(ab.cp).every((id) => (bestMs(a, id) === bestMs(ab, id) && a.cp[id] === ab.cp[id]) || (bestMs(b, id) === bestMs(ab, id) && b.cp[id] === ab.cp[id]));
  if (ghostsOk) fuzzOk.ghosts++;
  if (cleanProblems(ab).length === 0) fuzzOk.clean++;
  if (viewpointCount(ab.vp) >= Math.max(viewpointCount(a.vp), viewpointCount(b.vp))) fuzzOk.viewpoints++;
}
function comparable(p) { return JSON.stringify({ ...p, t: 0 }); }
for (const key of Object.keys(fuzzOk)) if (key !== 'total') check(`merge fuzz (${fuzzOk.total} pairs): ${key}`, fuzzOk[key] === fuzzOk.total, `${fuzzOk[key]}/${fuzzOk.total}`);
{
  const a = recordRun(FRESH, { trailId: TRAIL_IDS[0], ms: 400000, ghostText: GHOST_A, checkpointsMs: SPLITS(4, 400000), medal: 1 }).progress;
  const b = recordRun(FRESH, { trailId: TRAIL_IDS[0], ms: 380000, ghostText: GHOST_B, checkpointsMs: SPLITS(6, 380000), medal: 3 }).progress;
  const m = mergeProgress(a, b);
  check('merge: the faster side owns ghost and splits', bestMs(m, TRAIL_IDS[0]) === 380000 && m.g[TRAIL_IDS[0]] === GHOST_B && bestSplits(m, TRAIL_IDS[0]).length === 6 && m.m === '300000');
  const stale = mergeProgress(recordRun(FRESH, { trailId: TRAIL_IDS[0], ms: 380000, medal: 1 }).progress, a);
  check('merge: a slower side never gives its ghost to a faster best', !(TRAIL_IDS[0] in stale.g) && bestMs(stale, TRAIL_IDS[0]) === 380000);
  const lostBest = mergeProgress(createProgress(), a);
  check('merging with an empty save keeps everything', comparable(lostBest) === comparable(a));
  const x = normalizeProgress({ dy: [20005, 100000], ds: 3, dm: 3 }), y = normalizeProgress({ dy: [20003, 90000], ds: 7, dm: 7 });
  const dm = mergeProgress(x, y);
  check('daily: the later day wins with its own streak; longest streak max', same(dm.dy, [20005, 100000]) && dm.ds === 3 && dm.dm === 7 && same(mergeProgress(y, x).dy, dm.dy));
  const s1 = normalizeProgress({ dy: [20005, 100000], ds: 3 }), s2 = normalizeProgress({ dy: [20005, 90000], ds: 4 });
  check('daily: same day takes the lower time and the larger streak', same(mergeProgress(s1, s2).dy, [20005, 90000]) && mergeProgress(s1, s2).ds === 4);
  const old = withSettings(withName(FRESH, 'Old'), { q: 'low', snd: 0 }), young = { ...withSettings(FRESH, { q: 'high', cam: 2 }), t: 99 };
  const sm = mergeProgress({ ...old, t: 10 }, young);
  check('settings: union, a clash follows the newer save', sm.se.q === 'high' && sm.se.snd === 0 && sm.se.cam === 2 && sm.n === 'Old');
  check('settings: the clash flips with the timestamps', mergeProgress({ ...old, t: 100 }, young).se.q === 'low');
  const lockedPick = mergeProgress(normalizeProgress({ m: '333333', bk: 'downhill', t: 1 }), normalizeProgress({ t: 5 }));
  check('selection comes from the newer save', lockedPick.bk === 'hardtail' && lockedPick.m === '333333');
  const kept = mergeProgress(normalizeProgress({ m: '333333', bk: 'downhill', t: 9 }), normalizeProgress({ t: 5 }));
  check('selection of the newer save is kept when unlocked', kept.bk === 'downhill');
  check('merge does not mutate its inputs', (() => { const snapshot = JSON.stringify([a, b]); mergeProgress(a, b); return JSON.stringify([a, b]) === snapshot; })());
  check('merge normalises hostile input', quiet(() => cleanProblems(mergeProgress(POLLUTION, HOSTILE[10][1]))).length === 0);
}

/* ---------------------------------------------------------------- daily challenge, score, days */
section('daily challenge, score, day numbers');
{
  const open = TRAIL_IDS.slice(0, 5);
  const picks = new Set(), weather = {}, times = new Set();
  let deterministic = true, valid = true, noMarathon = true, onlyUnlocked = true;
  for (let day = 20000; day < 22000; day++) {
    const c = dailyChallenge(day, TRAIL_IDS);
    const again = dailyChallenge(day, [...TRAIL_IDS].reverse());
    if (!same(c, dailyChallenge(day, TRAIL_IDS)) || !same(c, again)) deterministic = false;
    if (c.trailId === MARATHON_ID) noMarathon = false;
    const subset = dailyChallenge(day, open.slice(0, 2));
    if (!open.slice(0, 2).includes(subset.trailId)) onlyUnlocked = false;
    if (!['morning', 'noon', 'evening', 'dawn'].includes(c.time) || !['clear', 'cloudy', 'fog', 'rain'].includes(c.weather) || !Number.isInteger(c.seed) || c.seed < 0 || c.seed >= 2 ** 32) valid = false;
    picks.add(c.trailId); times.add(c.time); weather[c.weather] = (weather[c.weather] ?? 0) + 1;
  }
  check('daily challenge is deterministic (also for any input order)', deterministic);
  check('daily challenge fields are valid', valid);
  check('daily challenge never picks the marathon', noMarathon);
  check('daily challenge only picks offered (unlocked) trails', onlyUnlocked);
  check('daily challenge covers all 5 normal trails and all 4 times', picks.size === 5 && times.size === 4, [...picks].join());
  const total = Object.values(weather).reduce((a, b) => a + b, 0);
  const share = (k) => weather[k] / total;
  check('weather weights are about clear 4 / cloudy 2 / fog 1 / rain 2', Math.abs(share('clear') - 4 / 9) < 0.04 && Math.abs(share('cloudy') - 2 / 9) < 0.04
    && Math.abs(share('fog') - 1 / 9) < 0.04 && Math.abs(share('rain') - 2 / 9) < 0.04, JSON.stringify(weather));
  check('marathon-only or empty offer falls back to the first trail', dailyChallenge(5, [MARATHON_ID]).trailId === TRAIL_IDS[0] && dailyChallenge(5, []).trailId === TRAIL_IDS[0]
    && dailyChallenge(5, ['x']).trailId === TRAIL_IDS[0] && dailyChallenge(NaN, 'junk').trailId === TRAIL_IDS[0]);
  check('different days differ', new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(dailyChallenge(20000 + i, TRAIL_IDS)))).size > 20);
  const locked = dailyChallenge(21000, TRAIL_IDS.slice(0, 1));
  check('with only the first trail unlocked the daily is that trail', locked.trailId === TRAIL_IDS[0]);
}
check('dayNumber: a plain day', dayNumber(new Date('2026-10-25T12:00:00Z')) === Date.UTC(2026, 9, 25) / 86400000);
check('dayNumber: Luxembourg midnight (summer time)', dayNumber(new Date('2026-07-01T21:59:00Z')) === Date.UTC(2026, 6, 1) / 86400000
  && dayNumber(new Date('2026-07-01T22:00:00Z')) === Date.UTC(2026, 6, 2) / 86400000);
check('dayNumber: Luxembourg midnight (winter time)', dayNumber(new Date('2026-12-01T22:59:00Z')) === Date.UTC(2026, 11, 1) / 86400000
  && dayNumber(new Date('2026-12-01T23:00:00Z')) === Date.UTC(2026, 11, 2) / 86400000);
check('dayNumber: other time zone', dayNumber(new Date('2026-10-25T01:00:00Z'), 'UTC') === Date.UTC(2026, 9, 25) / 86400000 && Number.isInteger(dayNumber()));
check('timeScore <-> scoreTime round trip', [1000, 59999, 421000, 2100123, 9999999].every((ms) => scoreTime(timeScore(ms)) === ms && timeScore(ms) === 10_000_000 - ms));
check('faster time = higher score', timeScore(300000) > timeScore(310000));
check('timeScore / scoreTime reject out-of-range values', [999, 10_000_000, -1, NaN, Infinity, '5000', null].every((v) => timeScore(v) === null) && [0, 9_999_001, 1.5, NaN, 'x', 10_000_000].every((v) => scoreTime(v) === null));
check('board ids match the arcade pattern', TRAIL_IDS.every((id) => /^[a-z0-9-]{1,48}$/.test(boardId(id)) && boardId(id).startsWith('mtb-')) && boardId(TRAIL_IDS[0]) === 'mtb-ernz-waldwee');
{
  let p = FRESH, last = overallScore(p);
  let monotone = true;
  const steps = [
    (q) => recordRun(q, { trailId: TRAIL_IDS[0], ms: 400000, medal: 1 }).progress, (q) => recordRun(q, { trailId: TRAIL_IDS[0], ms: 390000, medal: 1 }).progress,
    (q) => recordViewpoint(q, 3).progress, (q) => recordRun(q, { trailId: TRAIL_IDS[0], ms: 380000, medal: 2 }).progress,
    (q) => recordRun(q, { trailId: TRAIL_IDS[1], ms: 500000, medal: 3 }).progress, (q) => recordViewpoint(q, 40).progress,
  ];
  for (const step of steps) { p = step(p); const now = overallScore(p); if (!(now >= last)) monotone = false; last = now; }
  check('overallScore is monotone with progress', monotone && last > 0, String(last));
  check('overallScore formula', overallScore(normalizeProgress({ m: '230000', b: 'ass8,,,,,', vp: withViewpoint('0', 1) })) === 5 * 10000 + 100 + Math.round(timeScore(parseInt('ass8', 36)) / 100000));
  check('overallScore is a safe integer', Number.isSafeInteger(overallScore(normalizeProgress({ m: '333333', vp: 'zzzzzzzzzzzzz' }))));
}

/* ---------------------------------------------------------------- worst-case save, size guard */
section('size guard');
function worstCase() {
  let p = FRESH;
  TRAIL_IDS.forEach((id, i) => {
    p = recordRun(p, { trailId: id, ms: 9_000_000 - i * 1000, checkpointsMs: Array.from({ length: 24 }, (_, k) => 8_000_000 + k * 40_000 + i), ghostText: GHOST_MAX, medal: 3 }).progress;
  });
  for (let i = 0; i < 64; i++) p = recordViewpoint(p, i).progress;
  p = recordDaily(recordDaily(p, { day: 20000, ms: 123456 }).progress, { day: 20001, ms: 123456 }).progress;
  p = addStats(p, { km: 9_999_999, rides: 999_999, crashes: 999_999, air: 9_999_999 });
  p = withSettings(p, { lang: 'lb', q: 'medium', time: 'evening', weather: 'rain', season: 'autumn', snd: 1, cam: 2 });
  p = withLoadout(p, { bk: 'downhill', col: 'white', hm: 'gold' });
  p = withName(p, 'WWWWWWWWWWWW');
  return { ...p, t: 4_000_000_000 };
}
{
  const worst = worstCase();
  const sizes = saveSizes(worst);
  check('worst case: all six trails attempted, only 3 ghosts survive', Object.keys(worst.g).length === 3 && worst.m === '333333' && Object.keys(worst.cp).length === 6, `${Object.keys(worst.g).length} ghosts`);
  check('worst case: 24 splits per trail kept', TRAIL_IDS.every((id) => bestSplits(worst, id).length === 24));
  check(`worst case: JSON < ${SAVE_LIMIT_BYTES} bytes`, sizes.json < SAVE_LIMIT_BYTES, `${sizes.json} bytes`);
  check(`worst case: jsonb estimate < ${JSONB_LIMIT_BYTES}`, sizes.jsonb < JSONB_LIMIT_BYTES, `${sizes.jsonb} bytes`);
  check('worst case: all 64 viewpoints, name and settings present', viewpointCount(worst.vp) === 64 && worst.n === 'WWWWWWWWWWWW' && Object.keys(worst.se).length === 7);
  const json = serializeProgress(worst);
  check('serializeProgress returns the JSON text unchanged when it fits', json === JSON.stringify(worst) && same(shrinkToFit(worst), worst));
  check('serialized worst case round trips', same(normalizeProgress(json), worst));
  console.log(`   worst case: ${sizes.json} bytes JSON, ${sizes.jsonb} bytes jsonb`);

  const sizeAfterShrink = (limit) => shrinkToFit(worst, { jsonLimit: limit, jsonbLimit: 1e9 });
  const newestGhost = ghostOrder(worst).at(-1);
  const oldestGhost = ghostOrder(worst)[0];
  const cut1 = sizeAfterShrink(sizes.json - 100);
  check('shrink 1: the oldest ghost goes first', !(oldestGhost in cut1.g) && Object.keys(cut1.g).length === 2 && Object.keys(cut1.cp).length === 6);
  const cut2 = sizeAfterShrink(sizes.json - 1800 - 100);
  check('shrink 2: then the second ghost', Object.keys(cut2.g).length === 1 && newestGhost in cut2.g && Object.keys(cut2.cp).length === 6);
  const cut3 = sizeAfterShrink(sizes.json - 3500 - 100);
  check('shrink 3: then the splits of unfocused trails (deterministic order)', Object.keys(cut3.g).length === 1 && Object.keys(cut3.cp).length < 6 && newestGhost in cut3.cp);
  const tiny = shrinkToFit(worst, { jsonLimit: 1, jsonbLimit: 1 });
  for (const [label, shrunk] of [['light', cut1], ['medium', cut2], ['heavy', cut3], ['everything', tiny]]) {
    check(`shrink (${label}) keeps medals, bests, unlocks, viewpoints, streaks, settings`, shrunk.m === worst.m && shrunk.b === worst.b && shrunk.vp === worst.vp && shrunk.bk === worst.bk && shrunk.col === worst.col && shrunk.hm === worst.hm
      && same(shrunk.dy, worst.dy) && shrunk.dm === worst.dm && same(shrunk.se, worst.se) && same(shrunk.st, worst.st) && shrunk.tb === worst.tb);
  }
  check('shrink (everything) leaves no ghost and no splits', Object.keys(tiny.g).length === 0 && Object.keys(tiny.cp).length === 0 && tiny.go === '');
  check('shrink is deterministic and does not mutate', same(sizeAfterShrink(3000), sizeAfterShrink(3000)) && same(worst, worstCase()));
  check('shrink returns a new object', shrinkToFit(worst) !== worst && sizeAfterShrink(2000) !== worst);
  check('shrink output is itself clean', [cut1, cut2, cut3, tiny].every((p) => cleanProblems(p).length === 0));
  let threw = null;
  try { serializeProgress(worst, { jsonLimit: 100, jsonbLimit: 1e9 }); } catch (error) { threw = error; }
  check('serializeProgress throws a descriptive error when even the shrunk save is too large', threw instanceof Error && /too large/.test(threw.message) && /bytes/.test(threw.message), threw?.message);
  const shrunkJson = serializeProgress(worst, { jsonLimit: 4000, jsonbLimit: 1e9 });
  check('serializeProgress shrinks instead of throwing when it can', bytes(JSON.parse(shrunkJson)) <= 4000 && JSON.parse(shrunkJson).m === worst.m);
  let jsonbThrew = false;
  try { serializeProgress(worst, { jsonLimit: 1e9, jsonbLimit: 100 }); } catch { jsonbThrew = true; }
  check('the jsonb limit is enforced separately', jsonbThrew);
}
check('jsonbSize: matches the fouer estimator on known shapes', jsonbSize({}) === 8 && jsonbSize([]) === 8 && jsonbSize({ a: 'x' }) >= 8 + 8 + 2 && jsonbSize({ n: 1 }) > jsonbSize({}));
check('jsonbSize: a 1600-element integer array = 19208 bytes (fouer calibration)', jsonbSize(Array.from({ length: 1600 }, () => 1)) === 19208, String(jsonbSize(Array.from({ length: 1600 }, () => 1))));
check('jsonbSize counts utf-8 bytes', jsonbSize('ë') === 4 + 2 && jsonbSize({ 'ë': 0 }) >= jsonbSize({ e: 0 }));

/* ---------------------------------------------------------------- pickBest */
section('pickBest');
{
  const a = recordRun(FRESH, { trailId: TRAIL_IDS[0], ms: 400000, medal: 1 }).progress;
  const b = recordRun(FRESH, { trailId: TRAIL_IDS[1], ms: 500000, medal: 2 }).progress;
  const merged = pickBest([a, JSON.stringify(b), null, undefined, 'garbage', { v: 2 }, { hello: 1 }, [], 5]);
  check('pickBest merges objects and JSON strings, skips junk', merged && merged.m === '120000' && bestMs(merged, TRAIL_IDS[0]) === 400000 && bestMs(merged, TRAIL_IDS[1]) === 500000);
  quiet(() => check('pickBest returns null when nothing decodes', pickBest([null, 'x', { v: 2 }, undefined]) === null && pickBest([]) === null && pickBest(undefined) === null));
  check('pickBest of one source is that source normalised', same(pickBest([a]), a));
  check('pickBest result is clean even for hostile sources', cleanProblems(quiet(() => pickBest([POLLUTION, { v: 1, ...HOSTILE[11][1] }]))).length === 0);
}

/* ---------------------------------------------------------------- persistence with fakes */
section('persistence');
function fakeEnv({ testMode = false, standalone = false, injected = undefined, storageData = {}, withArcade = true, throwingStorage = false } = {}) {
  const listeners = {};
  const clock = { now: 1_800_000_000_000, timers: [], nextId: 1 };
  const posted = [];
  const store = new Map(Object.entries(storageData));
  const storage = throwingStorage ? { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }
    : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
  const scores = [];
  const win = {
    __pbTestMode: testMode, __pbSave: injected,
    Arcade: withArcade ? { score: (v) => scores.push(v) } : undefined,
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn); },
  };
  const parent = standalone ? win : { postMessage: (message, origin) => posted.push({ message, origin }) };
  win.parent = parent;
  const env = {
    win, parent, storage, origin: 'https://ian.lu', now: () => clock.now,
    setTimeout: (fn, ms) => { const id = clock.nextId++; clock.timers.push({ id, at: clock.now + ms, fn }); return id; },
    clearTimeout: (id) => { clock.timers = clock.timers.filter((t) => t.id !== id); },
  };
  const advance = (ms) => {
    const target = clock.now + ms;
    for (;;) {
      const due = clock.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      clock.timers = clock.timers.filter((t) => t !== due);
      clock.now = due.at; due.fn();
    }
    clock.now = target;
  };
  const emit = (type, event = {}) => (listeners[type] ?? []).slice().forEach((fn) => fn(event));
  return { env, win, parent, posted, store, scores, advance, emit, clock, listeners, pendingTimers: () => clock.timers.length };
}
{
  let state = recordRun(FRESH, { trailId: TRAIL_IDS[0], ms: 400000, ghostText: GHOST_A, medal: 1 }).progress;
  const errors = [];
  const f = fakeEnv();
  const loaded = [];
  const p = createPersistence({ getState: () => state, onState: (s) => { state = s; loaded.push(s); }, onError: (m) => errors.push(m), env: f.env });
  check('creation asks the parent for the cloud save exactly once', f.posted.length === 1 && same(f.posted[0].message, { __pbWantSave: 1 }));
  check('creation publishes the arcade score', f.scores.length === 1 && f.scores[0] === overallScore(state));
  p.scheduleSave(); p.scheduleSave();
  check('scheduleSave does not post before the debounce', f.posted.length === 1 && f.pendingTimers() === 2);
  f.advance(SAVE_DELAY_MS - 1);
  check('nothing is posted just before 1.2 s', f.posted.length === 1);
  f.advance(1);
  check('the save is posted after 1.2 s', f.posted.length === 2 && f.posted[1].message.__pbSave === 1 && f.pendingTimers() === 0);
  const record = f.posted[1].message.data;
  check('posted record is the normalised save with a timestamp', record.v === 1 && record.m === '100000' && record.t === 1_800_000_000 + Math.floor(SAVE_DELAY_MS / 1000) && cleanProblems(record).length === 0, JSON.stringify(record).slice(0, 80));
  check('local copy was written under pb_mtb_save, backup under pb_mtb_bak', same(JSON.parse(f.store.get(LOCAL_KEY)), record) && f.store.has(BACKUP_KEY));
  check('arcade score unchanged = not published again', f.scores.length === 1);
  p.scheduleSave(); f.advance(SAVE_DELAY_MS + 10);
  check('an unchanged save is not posted again', f.posted.length === 2);
  // max wait: keep rescheduling every second; deadline at 5 s forces a push
  state = recordViewpoint(state, 1).progress;
  const base = f.posted.length;
  for (let i = 0; i < 5; i++) { p.scheduleSave(); f.advance(1000); }
  check('a stream of changes still saves within the 5 s maximum wait', f.posted.length === base + 1, `${f.posted.length - base} posts`);
  check('the arcade score follows the state', f.scores.at(-1) === overallScore(state) && f.scores.length === 2);
  // incoming cloud save: better in one trail, worse in another
  const cloud = recordRun(recordRun(FRESH, { trailId: TRAIL_IDS[0], ms: 450000, medal: 3 }).progress, { trailId: TRAIL_IDS[1], ms: 600000, medal: 1 }).progress;
  const foreign = { source: {} };
  f.emit('message', { source: foreign, data: { __pbLoadSave: 1, data: cloud } });
  check('a message from another window is ignored', loaded.length === 0);
  f.emit('message', { source: f.parent, data: { hello: 1 } });
  f.emit('message', { source: f.parent, data: null });
  f.emit('message', { source: f.parent, data: [] });
  check('unrelated messages from the parent are ignored', loaded.length === 0);
  f.emit('message', { source: f.parent, data: { __pbLoadSave: 1, data: cloud } });
  check('a cloud save is merged into the state', loaded.length === 1 && state.m === '310000' && bestMs(state, TRAIL_IDS[0]) === 400000 && bestMs(state, TRAIL_IDS[1]) === 600000 && hasViewpoint(state.vp, 1));
  check('the merged state is scheduled for saving', f.pendingTimers() === 2);
  const posts = f.posted.length;
  f.advance(SAVE_DELAY_MS + 1);
  check('merged progress flows back to the parent', f.posted.length === posts + 1 && f.posted.at(-1).message.data.m === '310000');
  f.emit('message', { source: f.parent, data: { __pbLoadSave: 1, data: cloud } });
  check('the same cloud save again changes nothing', loaded.length === 1 && f.pendingTimers() === 0);
  quiet(() => {
    f.emit('message', { source: f.parent, data: { __pbLoadSave: 1, data: 'garbage' } });
    f.emit('message', { source: f.parent, data: { __pbLoadSave: 1, data: { v: 9 } } });
    f.emit('message', { source: f.parent, data: { __pbLoadSave: 1, data: null } });
    check('garbage cloud saves are ignored', loaded.length === 1);
  });
  f.emit('message', { source: f.parent, data: { __pbLoadSave: 1, data: JSON.stringify(recordViewpoint(createProgress(), 9).progress) } });
  check('a cloud save as JSON text works too', loaded.length === 2 && hasViewpoint(state.vp, 9) && hasViewpoint(state.vp, 1));
  // pagehide
  state = recordViewpoint(state, 20).progress;
  p.scheduleSave();
  const before = f.posted.length;
  f.emit('pagehide');
  check('pagehide flushes immediately and clears the timers', f.posted.length === before + 1 && f.posted.at(-1).message.data.vp === state.vp && f.pendingTimers() === 0);
  p.destroy();
  check('destroy removes the listeners and the timers', (f.listeners.message ?? []).length === 0 && (f.listeners.pagehide ?? []).length === 0 && f.pendingTimers() === 0);
  check('no errors were reported', errors.length === 0, errors.join('|'));
}
{
  // the backup is written at most once per minute
  let state = FRESH;
  const f = fakeEnv();
  const p = createPersistence({ getState: () => state, onState: () => {}, onError: () => {}, env: f.env });
  p.pushSave();
  const first = f.store.get(BACKUP_KEY);
  state = recordViewpoint(state, 2).progress; f.advance(1000); p.pushSave();
  check('backup is not rewritten within a minute (first fresh save, later changes are local-only)', f.store.get(BACKUP_KEY) === first && JSON.parse(f.store.get(LOCAL_KEY)).vp === state.vp);
  state = recordViewpoint(state, 3).progress; f.advance(61000); p.pushSave();
  check('backup is rewritten after a minute', JSON.parse(f.store.get(BACKUP_KEY)).vp === state.vp);
}
{
  // test mode: no cloud, no merge, no storage
  let state = normalizeProgress({ m: '333333' });
  let calls = 0;
  const f = fakeEnv({ testMode: true });
  const p = createPersistence({ getState: () => state, onState: () => { calls++; }, onError: () => {}, env: f.env });
  check('test mode: no __pbWantSave', f.posted.length === 0);
  p.scheduleSave(); f.advance(10000); p.pushSave(); f.emit('pagehide');
  check('test mode: nothing is posted or stored', f.posted.length === 0 && f.store.size === 0);
  f.emit('message', { source: f.parent, data: { __pbLoadSave: 1, data: recordViewpoint(FRESH, 1).progress } });
  check('test mode: an incoming cloud save is ignored', calls === 0 && p.applyIncoming(recordViewpoint(FRESH, 1).progress) === false);
  check('test mode: the arcade score is still offered (the host drops it)', f.scores.length >= 1);
  const f2 = fakeEnv({ testMode: true, injected: { v: 1, m: '300000' }, storageData: { [LOCAL_KEY]: JSON.stringify(normalizeProgress({ m: '030000' })) } });
  check('test mode: start-up uses only the injected test save', loadInitialProgress(f2.env).m === '300000');
}
{
  // start-up merge of injected / local / backup, hostile storage
  const a = recordRun(FRESH, { trailId: TRAIL_IDS[0], ms: 400000, medal: 1 }).progress;
  const b = recordViewpoint(FRESH, 7).progress;
  const c = recordRun(FRESH, { trailId: TRAIL_IDS[1], ms: 500000, medal: 2 }).progress;
  const f = fakeEnv({ injected: a, storageData: { [LOCAL_KEY]: JSON.stringify(b), [BACKUP_KEY]: JSON.stringify(c) } });
  const initial = loadInitialProgress(f.env);
  check('start-up merges the injected save, the local copy and the backup', initial.m === '120000' && hasViewpoint(initial.vp, 7));
  check('start-up with nothing returns null', loadInitialProgress(fakeEnv().env) === null);
  quiet(() => check('start-up survives throwing storage and junk', loadInitialProgress(fakeEnv({ throwingStorage: true, injected: a }).env).m === '100000'
    && loadInitialProgress(fakeEnv({ storageData: { [LOCAL_KEY]: '{{{' }, injected: undefined }).env) === null));
  // injected save as JSON string
  check('the injected save may be a JSON string', loadInitialProgress(fakeEnv({ injected: JSON.stringify(a) }).env).m === '100000');
}
{
  // standalone page: no parent
  let state = recordViewpoint(FRESH, 4).progress;
  const f = fakeEnv({ standalone: true });
  const p = createPersistence({ getState: () => state, onState: () => {}, env: f.env });
  p.pushSave();
  check('standalone: saves to localStorage only, never posts', f.posted.length === 0 && JSON.parse(f.store.get(LOCAL_KEY)).vp === state.vp);
  f.emit('message', { source: f.win, data: { __pbLoadSave: 1, data: recordViewpoint(FRESH, 9).progress } });
  check('standalone: messages from the own window are not trusted', hasViewpoint(state.vp, 9) === false);
  const noArcade = fakeEnv({ standalone: true, withArcade: false });
  check('standalone without Arcade does not throw', (() => { try { createPersistence({ getState: () => state, onState: () => {}, env: noArcade.env }).pushSave(); return true; } catch { return false; } })());
}
{
  // errors are reported once and never swallowed silently
  const errors = [];
  const f = fakeEnv();
  const p = createPersistence({ getState: () => { throw new Error('boom'); }, onState: () => {}, onError: (m) => errors.push(m), env: f.env });
  const ok = quiet(() => p.pushSave());
  check('a failing getState is reported, pushSave returns false', ok === false && errors.length >= 1);
  const count = errors.length;
  quiet(() => { p.pushSave(); p.pushSave(); });
  check('the same error is reported only once in a row', errors.length === count);
  const f2 = fakeEnv({ throwingStorage: true });
  const p2 = createPersistence({ getState: () => FRESH, onState: () => {}, env: f2.env });
  check('throwing storage does not stop the cloud post', quiet(() => p2.pushSave()) === true && f2.posted.some((m) => m.message.__pbSave === 1));
}

/* ---------------------------------------------------------------- score reporter */
section('score reporter');
{
  const calls = [];
  const arcade = { setBoard: (spec) => calls.push(['board', spec]), score: (v) => calls.push(['score', v]) };
  const names = { 'ernz-waldwee': 'Ernz Waldwee' };
  const reporter = createScoreReporter({ arcade, trailName: (id) => names[id] ?? id });
  check('submitRun sets the board and then scores timeScore(ms)', reporter.submitRun('ernz-waldwee', 421000) === true && calls.length === 2
    && same(calls[0], ['board', { id: 'mtb-ernz-waldwee', name: 'MTB Mëllerdall · Ernz Waldwee', format: 'mtb' }]) && same(calls[1], ['score', 10_000_000 - 421000]));
  calls.length = 0;
  reporter.submitRun('maratoun', 2100000, 'Maratoun');
  check('the caller may pass the display name', calls[0][1].name === 'MTB Mëllerdall · Maratoun');
  calls.length = 0;
  check('selectBoard only sets the board', reporter.selectBoard('binzelt-black', 'Binzelt') === true && calls.length === 1 && calls[0][1].id === 'mtb-binzelt-black');
  calls.length = 0;
  check('selectBoard(null) clears the board', reporter.selectBoard(null) === true && same(calls, [['board', null]]));
  calls.length = 0;
  quiet(() => check('invalid trail / time submit nothing', [['nope', 5000], ['maratoun', 12], ['maratoun', NaN], [undefined, 5000]].every(([id, ms]) => reporter.submitRun(id, ms) === false) && calls.length === 0));
  check('board names stay within the 80 char limit', (() => { calls.length = 0; reporter.submitRun('maratoun', 5000, 'x'.repeat(500)); return calls[0][1].name.length <= 80; })());
  const none = createScoreReporter({});
  check('a missing arcade (standalone page) is harmless', none.submitRun('maratoun', 5000) === false && none.selectBoard('maratoun') === false && createScoreReporter().submitRun('maratoun', 5000) === false);
  const broken = createScoreReporter({ arcade: { setBoard() { throw new Error('x'); }, score() { throw new Error('y'); } } });
  quiet(() => check('a throwing arcade is caught', broken.submitRun('maratoun', 5000) === false && broken.selectBoard('maratoun') === false));
}

/* ---------------------------------------------------------------- daily RPC */
section('daily RPC');
{
  const f = fakeEnv();
  const rpc = dailyRpc(f.env);
  const pendingBoard = rpc.board();
  const request = f.posted.at(-1);
  check('board() posts {__pbRpc:{id,fn,args}} to the page origin', request.origin === 'https://ian.lu' && request.message.__pbRpc.fn === 'daily_board' && same(request.message.__pbRpc.args, { p_game: 'mtb-daily' }) && typeof request.message.__pbRpc.id === 'string');
  f.emit('message', { source: f.parent, origin: 'https://ian.lu', data: { __pbRpcRes: { id: request.message.__pbRpc.id, data: [{ rank: 1 }] } } });
  const board = await pendingBoard;
  check('a matching answer resolves the promise', same(board, [{ rank: 1 }]) && f.pendingTimers() === 0);
  const pendingSubmit = rpc.submit(421000);
  const submit = f.posted.at(-1).message.__pbRpc;
  check('submit(ms) calls submit_daily_score with the score', submit.fn === 'submit_daily_score' && same(submit.args, { p_game: 'mtb-daily', p_score: 10_000_000 - 421000 }));
  f.emit('message', { source: f.parent, origin: 'https://evil.example', data: { __pbRpcRes: { id: submit.id, data: 'x' } } });
  f.emit('message', { source: {}, origin: 'https://ian.lu', data: { __pbRpcRes: { id: submit.id, data: 'x' } } });
  f.emit('message', { source: f.parent, origin: 'https://ian.lu', data: { __pbRpcRes: { id: 'unknown', data: 'x' } } });
  check('answers from another origin / window / id are ignored', f.pendingTimers() === 1);
  f.emit('message', { source: f.parent, origin: 'https://ian.lu', data: { __pbRpcRes: { id: submit.id, error: 'not allowed' } } });
  let rejected = null;
  try { await pendingSubmit; } catch (error) { rejected = error; }
  check('an error answer rejects with its message', rejected?.message === 'not allowed');
  const slow = rpc.board();
  f.advance(RPC_TIMEOUT_MS - 1);
  let timedOut = null;
  f.advance(1);
  try { await slow; } catch (error) { timedOut = error; }
  check('no answer within 10 s rejects with a timeout', timedOut?.message === 'RPC timeout' && f.pendingTimers() === 0);
  let invalid = null;
  try { await rpc.submit(12); } catch (error) { invalid = error; }
  check('an invalid time is rejected before any message is sent', invalid?.message === 'invalid-time');
  const open = rpc.board();
  rpc.destroy();
  let closed = null;
  try { await open; } catch (error) { closed = error; }
  check('destroy rejects pending calls and removes the listener', closed?.message === 'closed' && (f.listeners.message ?? []).length === 0);
  const alone = dailyRpc(fakeEnv({ standalone: true }).env);
  let signedOut = null;
  try { await alone.board(); } catch (error) { signedOut = error; }
  let signedOutSubmit = null;
  try { await alone.submit(421000); } catch (error) { signedOutSubmit = error; }
  check('standalone: rejects with Error("signed-out")', signedOut?.message === 'signed-out' && signedOutSubmit?.message === 'signed-out');
  const throwing = fakeEnv();
  throwing.parent.postMessage = () => { throw new Error('blocked'); };
  const blocked = dailyRpc(throwing.env);
  let blockedError = null;
  try { await blocked.board(); } catch (error) { blockedError = error; }
  check('a throwing postMessage rejects and leaves no timer behind', blockedError?.message === 'blocked' && throwing.pendingTimers() === 0);
}

/* ---------------------------------------------------------------- summary */
console.log(`\n${results.pass} passed, ${results.fail} failed`);
if (results.fail) {
  console.log('Failures:');
  for (const failure of results.failures) console.log('  - ' + failure);
  process.exit(1);
}
