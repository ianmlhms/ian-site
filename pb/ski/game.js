/* One run on one piste (pure, no THREE / DOM): the clock, the invisible checkpoints a run must pass, the slalom gates (+5 s per missed
 * gate), the finish, the respawn point after a crash, and the ghost recording. Modes: MODES.run (timed) and MODES.free (no clock: the
 * piste is only the guide line); 'challenge', 'park' and 'race' are the hooks for the next rounds (they fall back to 'free' here).
 * update() returns a list of events: { type: 'checkpoint' | 'gate' | 'missed-gate' | 'finish' | 'invalid' | 'offpiste' } */
import { PLAY, SKI, MODES } from './config.js';
import { minRunMs } from './progress.js';

export function createRun({ piste, mode = MODES.run }) {
  const timed = mode === MODES.run;
  const checkpoints = timed ? piste.checkpoints().map((s) => ({ s, passed: false })) : [];
  const gates = timed ? piste.slalomGates().map((g) => ({ ...g, result: null })) : [];
  const proj = {};
  const tmp = {};
  const samples = [];
  let hint = 0, best = 0, elapsed = 0, penalty = 0, finished = null, sampleT = 0, offFor = 0;
  const run = {
    piste, mode, timed, checkpoints, gates,
    get elapsed() { return elapsed; }, get penalty() { return penalty; }, get progress() { return best; }, get finished() { return finished; },
    get ms() { return Math.round(elapsed * 1000 + penalty); },
    proj,
  };

  /** Advance with the skier state after a physics frame (dt s). */
  run.update = function update(state, dt) {
    const events = [];
    if (finished) return events;
    piste.project(state.x, state.z, hint, 220, proj);
    hint = proj.s;
    if (proj.dist < piste.halfWidth + PLAY.checkpointSlack) best = Math.max(best, proj.s);
    if (!timed) {
      offFor = proj.dist > SKI.offPisteLimit ? offFor + dt : 0;
      if (offFor > 0.5) { offFor = 0; events.push({ type: 'offpiste' }); }
      return events;
    }
    elapsed += dt;
    for (const c of checkpoints) {
      if (c.passed) continue;
      piste.at(c.s, tmp);
      if (Math.hypot(state.x - tmp.x, state.z - tmp.z) < piste.halfWidth + PLAY.checkpointSlack) { c.passed = true; events.push({ type: 'checkpoint', s: c.s }); }
    }
    for (let i = 0; i < gates.length; i++) {
      const g = gates[i];
      if (g.result !== null || proj.s < g.s) continue;
      if (proj.s > g.s + 25) { g.result = false; penalty += PLAY.slalomMiss; events.push({ type: 'missed-gate', index: i }); continue; }
      // crossing the gate line: passed when the skier is outside the inner pole and within 4 m + slack beyond it
      const side = Math.sign(g.off);
      const out = side * proj.off - Math.abs(g.off);
      const ok = out > -0.8 && out < 4 + 3;
      g.result = ok;
      if (!ok) penalty += PLAY.slalomMiss;
      events.push({ type: ok ? 'gate' : 'missed-gate', index: i });
    }
    sampleT += dt;
    if (sampleT >= PLAY.ghostEvery) { sampleT = 0; samples.push({ t: elapsed * 1000, s: proj.s, o: proj.off }); }
    offFor = proj.dist > SKI.offPisteLimit ? offFor + dt : 0;
    if (offFor > 0.5) { offFor = 0; events.push({ type: 'offpiste' }); }
    if (proj.s > piste.length - 6 && proj.dist < piste.halfWidth + PLAY.finishRadius) {
      for (const g of gates) if (g.result === null) { g.result = false; penalty += PLAY.slalomMiss; }
      samples.push({ t: elapsed * 1000, s: piste.length, o: proj.off });
      const missed = checkpoints.filter((c) => !c.passed).length;
      const ms = run.ms;
      const valid = missed === 0 && ms >= minRunMs(piste.length);
      finished = { ms, raw: Math.round(elapsed * 1000), penalty, missedGates: gates.filter((g) => g.result === false).length, gates: gates.length, missedCheckpoints: missed, valid };
      events.push({ type: valid ? 'finish' : 'invalid', ...finished });
    }
    return events;
  };

  /** Where to put the skier back after a crash or off-piste: on the line, a little behind the furthest point reached, facing down. */
  run.respawnPoint = function respawnPoint() {
    const p = piste.at(Math.max(2, best - 18), {});
    return { x: p.x, z: p.z, heading: Math.atan2(p.dz, p.dx), s: p.s };
  };
  run.samples = () => samples;
  return run;
}
