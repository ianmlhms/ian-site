/* The race of a match (pure: no DOM, no network; the Node test drives several of these against each other).
 *
 * Every player skis his OWN run with the normal physics and the normal clock: his time is measured on his own device, from his own
 * start, and only he reports it (a 'fin' that arrives over HIS link; the session never hands one player's message on as another's).
 * Nobody can set another player's time, not even the coordinator.
 *
 * The coordinator (the first player of the lobby's roster order who is here; normally the host) only paces the match:
 *   prep    everybody loads the piste of this run and says 'rdy'; once all players who are here are ready (or after LOAD_TIMEOUT)
 *           the coordinator sends 'go' with a start time GO_LEAD ahead, in its own clock (receivers convert with the link latency)
 *   go      3-2-1 and the run; 'fin' / 'dnf' from each player. The run is closed ('end') when every player who is not gone has a
 *           result, FINISH_GRACE after the first finish (or FINISH_GRACE_SHARE of the winner's time), or at HARD_CAP
 *   results the table of the run for RESULTS_MS, then 'next' (or, after the last run, the final standings: 'over')
 * If the coordinator goes, the next player in roster order simply carries on with what he knows (all of it: every player hears
 * every message). Control messages only ever move a player forward (run, phase), so a late or doubled message is harmless.
 * A player who (re)joins gets a 'sync' from the coordinator and the results of everybody (each player re-sends his own). */
import { RACE } from './config.js';

const PHASES = Object.freeze(['prep', 'go', 'results', 'over']);
const order = (phase) => PHASES.indexOf(phase);

/** Points and places of one run: valid finishers sorted by time (equal times share a place). */
export function scoreRun(result, ids) {
  const done = ids.filter((id) => result[id] && result[id].valid).sort((a, b) => result[a].ms - result[b].ms);
  const out = {};
  let place = 0;
  done.forEach((id, i) => {
    if (i === 0 || result[id].ms !== result[done[i - 1]].ms) place = i + 1;
    out[id] = { place, points: RACE.POINTS[place - 1] || 0 };
  });
  return out;
}

/** The standings over all runs so far: points, then runs finished, then the total of the valid times. */
export function standings(results, roster) {
  const ids = roster.map((r) => r.id);
  const rows = roster.map((r) => ({ id: r.id, name: r.name, points: 0, finished: 0, totalMs: 0, runs: [] }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  results.forEach((res, i) => {
    if (!res) return;
    const sc = scoreRun(res, ids);
    for (const id of ids) {
      const row = byId.get(id), r = res[id] || null;
      row.runs[i] = r ? { ...r, ...(sc[id] || { place: 0, points: 0 }) } : null;
      if (sc[id]) { row.points += sc[id].points; row.finished++; row.totalMs += r.ms; }
    }
  });
  return rows.sort((a, b) => b.points - a.points || b.finished - a.finished || a.totalMs - b.totalMs || ids.indexOf(a.id) - ids.indexOf(b.id));
}

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/**
 * me, roster [{id, name}] (lobby order), runs = number of runs, now() = local ms, send(to | null, msg) (null = everybody),
 * latency(id) = one-way ms estimate of that link, minMs(run) = the fastest honest time of that run's piste, onEvent(e).
 */
export function createRace({ me, roster, runs, now, send, latency = () => 0, minMs = () => 0, onEvent = () => {}, restore = null }) {
  const ids = roster.map((r) => r.id);
  const rank = (id) => ids.indexOf(id);
  const status = new Map(ids.map((id) => [id, id === me ? 'here' : 'wait']));
  const s = {
    run: 0, phase: 'prep', prepAt: now(), ready: new Set(), goAt: null, endAt: 0, firstAt: 0, winnerMs: 0,
    results: Array.from({ length: runs }, () => ({})), started: -1,
  };
  if (restore && isInt(restore.run, 0, runs - 1) && PHASES.includes(restore.phase)) {
    s.run = restore.run; s.phase = restore.phase === 'go' ? 'prep' : restore.phase;     // a reload mid-run: wait for the coordinator's sync
    s.started = Number.isInteger(restore.started) ? restore.started : -1;
    if (Array.isArray(restore.results)) restore.results.slice(0, runs).forEach((r, i) => { if (r && typeof r === 'object') s.results[i] = { ...r }; });
  }
  const emit = (type, extra = {}) => onEvent({ type, run: s.run, ...extra });

  /* the first player in roster order who is here, or not met yet ('wait': nobody starts a match on his own before the players
   * ahead of him in the roster had their chance to connect; the session turns a 'wait' that never shows up into 'gone') */
  function coordinator() { return ids.find((id) => status.get(id) === 'here' || status.get(id) === 'wait') || me; }
  const isCoord = () => coordinator() === me;
  /* a control message counts when its sender is the coordinator I see, or ranks before it (it may know better) */
  const trusted = (from) => rank(from) >= 0 && rank(from) <= rank(coordinator());

  /* ---------- phase changes (local) ---------- */
  function enterPrep(run) {
    Object.assign(s, { run, phase: 'prep', prepAt: now(), ready: new Set(), goAt: null, endAt: 0, firstAt: 0, winnerMs: 0 });
    emit('prepare');
  }
  function enterGo(goAt) {
    s.phase = 'go'; s.goAt = goAt;
    emit('go', { goAt });
  }
  function enterEnd() {
    const res = s.results[s.run];
    for (const id of ids) if (!res[id]) res[id] = { dnf: true };
    s.endAt = now();
    s.phase = s.run >= runs - 1 ? 'over' : 'results';
    emit(s.phase === 'over' ? 'over' : 'end');
  }
  /* bring this player up to (run, phase) of a trusted message */
  function catchUp(run, phase, goAt) {
    if (run > s.run || (run === s.run && order(phase) > order(s.phase) && s.phase === 'prep' && phase !== 'prep')) {
      if (run > s.run) enterPrep(run);
      if (phase === 'go') enterGo(goAt);
      else if (phase === 'results' || phase === 'over') enterEnd();
      return;
    }
    if (run === s.run && s.phase === 'go' && (phase === 'results' || phase === 'over')) enterEnd();
  }
  const localTime = (from, at, sentNow) => now() + (Number(at) - Number(sentNow)) - latency(from);

  /* ---------- the coordinator's duties ---------- */
  function sendGo() {
    const goAt = now() + RACE.GO_LEAD;
    send(null, { k: 'go', r: s.run, at: goAt, now: now() });
    enterGo(goAt);
  }
  function tick() {
    if (!isCoord()) return;
    const t = now();
    if (s.phase === 'prep') {
      const here = ids.filter((id) => status.get(id) === 'here');
      const unmet = ids.some((id) => status.get(id) === 'wait');
      const allReady = here.every((id) => s.ready.has(id)) && !unmet;
      const waited = t - s.prepAt, limit = unmet ? RACE.MEET_TIMEOUT : RACE.LOAD_TIMEOUT;
      if ((allReady && s.ready.has(me)) || (waited > limit && s.ready.has(me)) || waited > limit * 1.5) sendGo();
    } else if (s.phase === 'go') {
      const res = s.results[s.run];
      const open = ids.filter((id) => !res[id] && status.get(id) !== 'gone' && status.get(id) !== 'wait');
      const grace = s.firstAt ? Math.max(RACE.FINISH_GRACE, s.winnerMs * RACE.FINISH_GRACE_SHARE) : Infinity;
      if (t > s.goAt && (!open.length || t > s.firstAt + grace || t > s.goAt + RACE.HARD_CAP)) {
        send(null, { k: 'end', r: s.run });
        enterEnd();
      }
    } else if (s.phase === 'results' && t > s.endAt + RACE.RESULTS_MS) {
      send(null, { k: 'next', r: s.run + 1 });
      enterPrep(s.run + 1);
    }
  }

  /* ---------- results ---------- */
  function noteFinish(id, r, entry) {
    const res = s.results[r];
    res[id] = entry;
    if (r === s.run && entry.valid && (!s.firstAt || entry.ms < s.winnerMs)) { if (!s.firstAt) s.firstAt = now(); s.winnerMs = s.winnerMs ? Math.min(s.winnerMs, entry.ms) : entry.ms; }
    emit('standings');
  }
  function cleanResult(m, r) {
    if (m.k === 'dnf') return { dnf: true };
    const ms = Math.round(Number(m.ms));
    if (!Number.isFinite(ms) || ms <= 0 || ms > RACE.MAX_MS) return null;
    const valid = m.v === true && ms >= minMs(r);
    return { ms, valid, pen: Math.max(0, Math.round(Number(m.pen) || 0)) };
  }

  /* ---------- messages from a peer (from = the owner of the link it came over) ---------- */
  function receive(from, m) {
    if (rank(from) < 0 || from === me || !m || typeof m !== 'object') return;
    const r = m.r;
    if (!isInt(r, 0, runs - 1)) return;
    switch (m.k) {
      case 'rdy':
        if (r === s.run) s.ready.add(from);
        break;
      case 'fin': case 'dnf': {
        if (r > s.run) break;                                    // a time for a run that has not started here: impossible
        const entry = cleanResult(m, r);
        if (!entry) break;
        const old = s.results[r][from];
        if (old && !old.dnf && entry.dnf) break;                 // a time stays a time
        noteFinish(from, r, entry);
        break;
      }
      case 'go':
        if (trusted(from)) catchUp(r, 'go', localTime(from, m.at, m.now));
        break;
      case 'end':
        if (trusted(from)) catchUp(r, r >= runs - 1 ? 'over' : 'results');
        break;
      case 'next':
        if (trusted(from) && r === s.run + 1 && (s.phase === 'results')) enterPrep(r);
        else if (trusted(from) && r > s.run + 1) enterPrep(r);
        break;
      case 'sync':
        if (trusted(from) && PHASES.includes(m.ph)) catchUp(r, m.ph, m.ph === 'go' ? localTime(from, m.at, m.now) : null);
        break;
      default:
    }
  }

  /** a peer's state as the session sees it: 'here' (link open, packets), 'away' (link open, silent), 'gone', 'wait' (not met yet) */
  function setStatus(id, st) {
    if (rank(id) < 0 || id === me || status.get(id) === st) return;
    const was = status.get(id);
    status.set(id, st);
    if (st === 'here' && was !== 'away') welcome(id);
    emit('status', { id, status: st });
  }
  /* somebody (re)joined: tell him where the match stands and what I know about myself */
  function welcome(id) {
    if (isCoord()) send(id, { k: 'sync', r: s.run, ph: s.phase, at: s.goAt, now: now() });
    if (s.ready.has(me) && s.phase === 'prep') send(id, { k: 'rdy', r: s.run });
    s.results.forEach((res, r) => {
      const mine = res[me];
      if (!mine) return;
      send(id, mine.dnf ? { k: 'dnf', r } : { k: 'fin', r, ms: mine.ms, v: mine.valid, pen: mine.pen || 0 });
    });
  }

  return {
    get run() { return s.run; }, get phase() { return s.phase; }, get goAt() { return s.goAt; }, get runs() { return runs; },
    get started() { return s.started; },
    status: (id) => status.get(id),
    isReady: (id) => s.ready.has(id),
    coordinator, isCoord, tick, receive, setStatus,
    /** the local piste of this run is loaded and the skier stands at the start */
    localReady(run) {
      if (run !== s.run || s.phase !== 'prep') return;
      s.ready.add(me);
      send(null, { k: 'rdy', r: run });
    },
    /** the local skier passed his GO in this run (a reload after this = DNF, not a second try) */
    localStarted(run) { s.started = run; emit('save'); },
    /** the local run ended: result { ms, valid, penalty } or null (gave up / closed / too late) */
    localFinish(run, result) {
      if (!isInt(run, 0, runs - 1) || s.results[run][me]) return;
      const entry = result ? { ms: Math.round(result.ms), valid: !!result.valid && result.ms >= minMs(run), pen: Math.round(result.penalty || 0) } : { dnf: true };
      send(null, entry.dnf ? { k: 'dnf', r: run } : { k: 'fin', r: run, ms: entry.ms, v: entry.valid, pen: entry.pen });
      noteFinish(me, run, entry);
    },
    result: (run, id) => s.results[run] && s.results[run][id] || null,
    standings: () => standings(s.results.slice(0, s.run + 1), roster),
    runTable(run) {
      const res = s.results[run] || {}, sc = scoreRun(res, ids);
      return roster.map((r) => ({ id: r.id, name: r.name, res: res[r.id] || null, ...(sc[r.id] || { place: 0, points: 0 }) }))
        .sort((a, b) => (a.place || 99) - (b.place || 99) || (a.res && !a.res.dnf ? 0 : 1) - (b.res && !b.res.dnf ? 0 : 1) || rank(a.id) - rank(b.id));
    },
    snapshot: () => ({ run: s.run, phase: s.phase, started: s.started, results: s.results.map((r) => ({ ...r })) }),
  };
}
