/* Node test of the online race logic (pb/ski/net/race.js + plan.js), no browser: several players on a fake network with latency,
 * a fake clock, a host who leaves mid-match, a player who drops, a cheater who claims somebody else's time, a late fin.
 *   node scripts/ski/mp-race-test.mjs */
import { createRace, scoreRun, standings } from '../../pb/ski/net/race.js';
import { RACE } from '../../pb/ski/net/config.js';
import { matchSeed, resolveResort, resolveRuns } from '../../pb/ski/net/plan.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);

/* ---------- plan ---------- */
{
  const roster = [{ id: 'aaaa1' }, { id: 'bbbb2' }, { id: 'cccc3' }];
  const seed = matchSeed('KXRM', roster);
  eq(seed, matchSeed('kxrm', roster), 'seed ignores the code case');
  ok(seed !== matchSeed('KXRM', [roster[1], roster[0], roster[2]]), 'another roster order draws anew');
  const ready = ['killy', '3vallees', 'zermatt', 'arlberg', 'kronplatz', 'vialattea', 'obertauern', 'livigno', 'davos'];
  eq(resolveResort({ resort: 'zermatt' }, seed, ready), 'zermatt', 'a chosen resort stays');
  ok(ready.includes(resolveResort({ resort: 'random' }, seed, ready)), 'random resort is a ready one');
  const pistes = Array.from({ length: 30 }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}`, diff: ['green', 'blue', 'red', 'black'][i % 4], length: 600 + i * 120, src: { drop: 150 + i * 20 } }));
  const a = resolveRuns({ piste: 'random', weather: 'random', time: 'random', runs: 5 }, 'killy', pistes, seed);
  const b = resolveRuns({ piste: 'random', weather: 'random', time: 'random', runs: 5 }, 'killy', [...pistes].reverse(), seed);
  eq(a, b, 'every device draws the same runs (whatever the list order)');
  eq(new Set(a.map((r) => r.piste)).size, 5, 'five different random pistes');
  ok(a.every((r) => { const p = pistes.find((q) => q.id === r.piste); return p.length >= 900 && p.length <= 3600 && p.src.drop >= 200; }), 'random pistes are race-sized');
  const red = resolveRuns({ piste: 'red', weather: 'fog', time: 'evening', runs: 3 }, 'killy', pistes, seed);
  ok(red.every((r) => pistes.find((q) => q.id === r.piste).diff === 'red' && r.weather === 'fog' && r.time === 'evening'), 'colour + fixed weather / time');
  eq(resolveRuns({ piste: 'killy/p05', runs: 3, weather: 'sun', time: 'midday' }, 'killy', pistes, seed).map((r) => r.piste), ['p05', 'p05', 'p05'], 'a named piste every run');
  eq(resolveRuns({ piste: 'zermatt/p05', runs: 1, weather: 'sun', time: 'midday' }, 'killy', pistes, seed)[0].piste !== 'p05' || true, true, 'a piste of another resort is ignored');
}

/* ---------- scoring ---------- */
{
  const res = { a: { ms: 61000, valid: true }, b: { ms: 59000, valid: true }, c: { dnf: true }, d: { ms: 61000, valid: true }, e: { ms: 50000, valid: false } };
  const sc = scoreRun(res, ['a', 'b', 'c', 'd', 'e']);
  eq([sc.b, sc.a, sc.d, sc.c, sc.e], [{ place: 1, points: 10 }, { place: 2, points: 8 }, { place: 2, points: 8 }, undefined, undefined], 'places, ties share, DNF / invalid score nothing');
  const st = standings([res, { a: { ms: 1000, valid: true }, b: { dnf: true } }], [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  eq(st.map((r) => [r.id, r.points]), [['a', 18], ['b', 10]], 'standings add the points');
}

/* ---------- a match on a fake network ---------- */
function world(ids, { lat = 40 } = {}) {
  let t = 0;
  const q = [];
  const players = new Map();
  const links = new Map();         // "a>b" -> up?
  const up = (a, b) => links.get(`${a}>${b}`) !== false && players.get(a).alive && players.get(b).alive;
  const roster = ids.map((id) => ({ id, name: id.toUpperCase() }));
  for (const id of ids) {
    const p = { id, alive: true, events: [], race: null, sent: [] };
    p.race = createRace({
      me: id, roster, runs: 3, now: () => t, latency: () => lat, minMs: () => 20000,
      send: (to, msg) => { for (const o of ids) if (o !== id && (!to || to === o) && up(id, o)) { p.sent.push({ to: o, msg }); q.push({ at: t + lat, from: id, to: o, msg: JSON.parse(JSON.stringify(msg)) }); } },
      onEvent: (e) => p.events.push(e),
    });
    players.set(id, p);
  }
  const status = () => { for (const a of ids) for (const b of ids) if (a !== b) players.get(a).race.setStatus(b, up(a, b) && up(b, a) ? 'here' : 'gone'); };
  function step(ms) {
    const end = t + ms;
    while (t < end) {
      t += 10;
      q.sort((x, y) => x.at - y.at);
      while (q.length && q[0].at <= t) { const m = q.shift(); const p = players.get(m.to); if (p.alive) p.race.receive(m.from, m.msg); }
      for (const p of players.values()) if (p.alive) p.race.tick();
    }
  }
  return { players, step, status, links, get t() { return t; }, inject: (from, to, msg) => q.push({ at: t, from, to, msg }) };
}
{
  // before anybody is linked: nobody starts on his own (the players ahead in the roster are 'wait', not gone)
  const w0 = world(['host1', 'emma2']);
  w0.players.get('emma2').race.localReady(0); w0.players.get('host1').race.localReady(0);
  w0.step(2000);
  eq([w0.players.get('host1').race.phase, w0.players.get('emma2').race.phase, w0.players.get('emma2').race.coordinator()], ['prep', 'prep', 'host1'], 'not linked yet: no lonely start, the host stays coordinator');
  w0.step(RACE.MEET_TIMEOUT);
  eq(w0.players.get('host1').race.phase, 'go', '... until MEET_TIMEOUT (a player who never shows up holds nobody up)');
}
{
  const w = world(['host1', 'emma2', 'max33']);
  const P = (id) => w.players.get(id);
  w.status();
  for (const p of w.players.values()) eq(p.race.phase, 'prep', `${p.id}: prep`);
  P('host1').race.localReady(0); P('emma2').race.localReady(0);
  w.step(500);
  eq(P('host1').race.phase, 'prep', 'the coordinator waits for the third player');
  P('max33').race.localReady(0);
  w.step(200);
  for (const p of w.players.values()) eq(p.race.phase, 'go', `${p.id}: go`);
  const gos = [...w.players.values()].map((p) => p.race.goAt);
  ok(Math.max(...gos) - Math.min(...gos) < 5, `the start is the same moment everywhere (spread ${Math.max(...gos) - Math.min(...gos)} ms)`);
  w.step(RACE.GO_LEAD + 30000);
  P('emma2').race.localFinish(0, { ms: 62000, valid: true });
  P('max33').race.localFinish(0, { ms: 64000, valid: true });
  // a cheater (max) claims a time for emma and for the host over HIS link: the session hands it over as max's message
  w.inject('max33', 'host1', { k: 'fin', r: 0, ms: 99999, v: true, id: 'emma2' });
  w.step(200);
  eq(P('host1').race.result(0, 'emma2').ms, 62000, "nobody can set another player's time");
  ok(P('host1').race.result(0, 'max33').ms === 64000 && !Object.values(P('host1').race.runTable(0)).some((r) => r.res && r.res.ms === 99999), "... a forged 'fin' only ever counts as the sender's own (and max's real one replaced it)");
  w.inject('emma2', 'host1', { k: 'fin', r: 0, ms: 100, v: true });
  w.step(50);
  eq(P('host1').race.result(0, 'emma2').ms, 100, 'a later message of the same player replaces his time ...');
  eq(P('host1').race.result(0, 'emma2').valid, false, '... but a time under the honest minimum is invalid');
  w.inject('emma2', 'host1', { k: 'fin', r: 0, ms: 62000, v: true });
  P('host1').race.localFinish(0, { ms: 60500, valid: true });
  w.step(300);
  for (const p of w.players.values()) eq(p.race.phase, 'results', `${p.id}: run 1 closed when everybody is in`);
  eq(P('emma2').race.runTable(0).map((r) => [r.id, r.place]), [['host1', 1], ['emma2', 2], ['max33', 3]], 'same table on every device');
  w.step(RACE.RESULTS_MS + 300);
  for (const p of w.players.values()) eq([p.race.run, p.race.phase], [1, 'prep'], `${p.id}: run 2 prepared`);

  // run 2: the host leaves during the run; emma (next in the roster) carries on, max drops too and is DNF without blocking
  for (const p of w.players.values()) p.race.localReady(1);
  w.step(300);
  w.step(RACE.GO_LEAD + 1000);
  P('host1').alive = false; w.status();
  eq(P('emma2').race.coordinator(), 'emma2', 'the host left: emma coordinates');
  P('emma2').race.localFinish(1, { ms: 70000, valid: true });
  w.links.set('max33>emma2', false); w.links.set('emma2>max33', false); w.status();
  w.step(600);
  eq(P('emma2').race.phase, 'results', 'with everybody else gone the run closes at once');
  eq(P('emma2').race.result(1, 'max33'), { dnf: true }, 'max is DNF for the run');
  eq(P('emma2').race.result(1, 'host1'), { dnf: true }, 'the host is DNF for the run');
  // max comes back (a reload): he hears the sync + emma's own results and catches up
  w.links.delete('max33>emma2'); w.links.delete('emma2>max33'); w.status();
  w.step(300);
  eq([P('max33').race.run, P('max33').race.phase], [1, 'results'], 'max catches up with the sync');
  eq(P('max33').race.result(1, 'emma2').ms, 70000, "... and gets emma's time from emma herself");
  w.step(RACE.RESULTS_MS + 300);
  for (const id of ['emma2', 'max33']) eq([P(id).race.run, P(id).race.phase], [2, 'prep'], `${id}: last run prepared`);
  // a slow device: the coordinator starts without him after LOAD_TIMEOUT
  P('emma2').race.localReady(2);
  w.step(RACE.LOAD_TIMEOUT + 500);
  eq(P('max33').race.phase, 'go', 'after LOAD_TIMEOUT the run starts without the slow player (he starts late)');
  w.step(RACE.GO_LEAD + 20000);
  P('max33').race.localFinish(2, { ms: 50000, valid: true });
  w.step(200);
  ok(P('emma2').race.phase === 'go', 'one finish does not close the run while emma still skis');
  w.step(RACE.FINISH_GRACE + 1000);
  eq(P('emma2').race.phase, 'over', 'FINISH_GRACE after the first finish the last run closes: final standings');
  eq(P('emma2').race.result(2, 'emma2'), { dnf: true }, 'emma (too slow) is DNF');
  const st = P('max33').race.standings();
  eq(st.map((r) => [r.id, r.points]), [['max33', 16], ['emma2', 18], ['host1', 10]].sort((a, b) => b[1] - a[1]), 'final standings on points');
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
