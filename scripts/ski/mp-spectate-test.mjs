/* Node test of the spectator side of an online race (pb/ski/net/race.js `spectator`, net/splits.js), no browser: a spectator who comes
 * after the start gets the sync + everybody's results, never paces / reports / sends anything, is never in the standings, and a message
 * from him changes nothing on the racers' side.
 *   node scripts/ski/mp-spectate-test.mjs */
import { createRace } from '../../pb/ski/net/race.js';
import { RACE } from '../../pb/ski/net/config.js';
import { createSplits, gapText } from '../../pb/ski/net/splits.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);

/* ---------- splits ---------- */
{
  const sp = createSplits({ length: 1000 });
  eq(sp.marks, [200, 400, 600, 800], 'four splits at 20 / 40 / 60 / 80 %');
  sp.note('a', 10000, 150); sp.note('a', 20000, 410); sp.note('a', 31000, 650);
  sp.note('b', 12000, 220); sp.note('b', 25000, 450); sp.note('b', -5, 700); sp.note('b', NaN, 700);
  eq([sp.passed('a'), sp.passed('b')], [3, 2], 'splits passed (a bad number is ignored)');
  eq(sp.time('a', 0), 20000, 'the first state past the mark is the split');
  eq(sp.gap('b', 'a'), 5000, 'gap at the last split both passed (b: 25 s, a: 20 s at 400 m)');
  eq(sp.gap('a', 'a'), null, 'no gap to himself');
  eq(sp.gap('c', 'a'), null, 'nobody there yet: no gap');
  eq(gapText(1340), '+1.3', 'gap text');
  eq(gapText(-400), '−0.4', 'negative gap text');
}

/* ---------- a spectator on a fake network ---------- */
function world(ids, { lat = 40 } = {}) {
  let t = 0;
  const q = [], players = new Map();
  const roster = ids.map((id) => ({ id, name: id.toUpperCase() }));
  const specSent = [];
  const spec = { on: false, race: null };
  const deliver = (from, to, msg) => { q.push({ at: t + lat, from, to, msg: JSON.parse(JSON.stringify(msg)) }); };
  for (const id of ids) {
    const p = { id, race: null };
    p.race = createRace({
      me: id, roster, runs: 2, now: () => t, latency: () => lat, minMs: () => 20000,
      send: (to, msg) => { for (const o of [...ids, 'spec9']) if (o !== id && (!to || to === o) && (o !== 'spec9' || spec.on)) deliver(id, o, msg); },
    });
    players.set(id, p);
  }
  spec.race = createRace({ me: 'spec9', roster, runs: 2, now: () => t, latency: () => lat, minMs: () => 20000, spectator: true, send: (to, msg) => specSent.push({ to, msg }) });
  for (const a of ids) for (const b of ids) if (a !== b) players.get(a).race.setStatus(b, 'here');
  function step(ms) {
    const end = t + ms;
    while (t < end) {
      t += 10;
      q.sort((x, y) => x.at - y.at);
      while (q.length && q[0].at <= t) { const m = q.shift(); if (m.to === 'spec9') spec.race.receive(m.from, m.msg); else players.get(m.to).race.receive(m.from, m.msg); }
      for (const p of players.values()) p.race.tick();
      spec.race.tick();
    }
  }
  /* the spectator's link opens: every racer welcomes him; the spectator sees every racer as here */
  function join() {
    spec.on = true;
    for (const id of ids) spec.race.setStatus(id, 'here');
    for (const p of players.values()) p.race.welcomeSpectator('spec9');
  }
  return { players, spec, step, join, specSent, inject: (from, to, msg) => q.push({ at: t, from, to, msg }), get t() { return t; } };
}
{
  const w = world(['host1', 'emma2', 'max33']);
  const P = (id) => w.players.get(id).race, S = w.spec.race;
  for (const id of ['host1', 'emma2', 'max33']) P(id).localReady(0);
  w.step(300);
  eq(P('host1').phase, 'go', 'the race is running');
  w.step(RACE.GO_LEAD + 12000);
  eq([S.run, S.phase], [0, 'prep'], 'the spectator knows nothing before he joins');
  w.join();
  w.step(200);
  eq([S.run, S.phase], [0, 'go'], "the coordinator's sync takes him to the running run");
  ok(S.goAt !== null && Math.abs(S.goAt - P('host1').goAt) < 60, `... with the same start time (${Math.round(S.goAt - P('host1').goAt)} ms apart)`);
  P('emma2').localFinish(0, { ms: 62000, valid: true });
  P('max33').localFinish(0, { ms: 64000, valid: true });
  w.step(200);
  eq(S.result(0, 'emma2').ms, 62000, "he hears a racer's own finish");
  P('host1').localFinish(0, { ms: 60500, valid: true });
  w.step(RACE.RESULTS_MS * 0.5);
  eq(S.phase, 'results', 'the run closes for him too');
  eq(S.runTable(0).map((r) => [r.id, r.place]), [['host1', 1], ['emma2', 2], ['max33', 3]], 'the same table as the racers');
  eq(S.standings().map((r) => r.id), P('host1').standings().map((r) => r.id), 'the same standings');
  ok(!S.standings().some((r) => r.id === 'spec9') && !S.runTable(0).some((r) => r.id === 'spec9'), 'he is not in the standings or in the table');
  w.step(RACE.RESULTS_MS + 400);
  eq([S.run, S.phase, P('emma2').run], [1, 'prep', 1], 'he follows into the next run');
  for (const id of ['host1', 'emma2', 'max33']) P(id).localReady(1);
  w.step(RACE.GO_LEAD + 500);
  eq(S.phase, 'go', 'run 2: go');
  ok(S.result(1, 'spec9') === null, 'no result of his own, ever');
  eq(w.specSent.length, 0, 'the spectator never sent a single race message');
}
{
  // he is the last one left: he never starts / ends / advances anything on his own
  const w = world(['host1', 'emma2']);
  w.join();
  for (const id of ['host1', 'emma2']) w.spec.race.setStatus(id, 'gone');
  w.step(RACE.LOAD_TIMEOUT * 2 + RACE.RESULTS_MS);
  eq([w.spec.race.run, w.spec.race.phase, w.specSent.length], [0, 'prep', 0], 'alone, he still never paces the race (no go, no end, no next)');
}
{
  // a message from a spectator changes nothing on the racers' side (not in the roster: ignored)
  const w = world(['host1', 'emma2']);
  const P = (id) => w.players.get(id).race;
  w.join();
  for (const id of ['host1', 'emma2']) P(id).localReady(0);
  w.step(RACE.GO_LEAD + 500);
  for (const m of [{ k: 'fin', r: 0, ms: 21000, v: true }, { k: 'dnf', r: 0 }, { k: 'go', r: 0, at: 1, now: 1 }, { k: 'end', r: 0 }, { k: 'sync', r: 1, ph: 'go', at: 1, now: 1 }, { k: 'next', r: 1 }, { k: 'rdy', r: 0 }]) w.inject('spec9', 'host1', m);
  w.step(100);
  eq([P('host1').run, P('host1').phase, P('host1').result(0, 'spec9'), P('host1').result(0, 'emma2')], [0, 'go', null, null], 'fin / dnf / go / end / sync / next from a spectator: nothing happens');
  P('host1').setStatus('spec9', 'here');
  eq(P('host1').status('spec9'), undefined, 'a spectator has no race status');
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
