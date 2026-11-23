/* One run on one piste (pure, no THREE / DOM): the clock, the invisible checkpoints a run must pass, the slalom gates (+5 s per missed
 * gate), the finish, the respawn point after a crash, and the ghost recording. Modes: MODES.run (timed) and MODES.free (no clock: the
 * piste is only the guide line); 'challenge', 'park' and 'race' are the hooks for the next rounds (they fall back to 'free' here).
 * update() returns a list of events: { type: 'checkpoint' | 'gate' | 'missed-gate' | 'finish' | 'invalid' | 'offpiste' } */
import { PLAY, SKI, MODES, COURSE } from './config.js';
import { minRunMs } from './progress.js';

const RESPAWN_WALL = 45, RESPAWN_SKIP = 40;      // deg, m (respawnPoint after a landing crash)
const xz = (p) => [p.x, p.z];

export function createRun({ piste, mode = MODES.run, startS = 2, finishS: finishIn = null }) {      // R8b: finishS = clear.js courseFinish      // R7-C: startS = the start gate on open snow (clear.js courseGate)
  const timed = mode === MODES.run;
  const checkpoints = timed ? piste.checkpoints().map((s) => ({ s, passed: false })) : [];
  const gates = timed ? piste.slalomGates().map((g) => ({ ...g, result: null })) : [];
  const proj = {};
  const tmp = {};
  const samples = [];
  let hint = startS, best = startS, elapsed = 0, penalty = 0, finished = null, sampleT = 0, offFor = 0;
  const finishS = Math.max(startS + 30, finishIn !== null ? finishIn : piste.length - COURSE.finishBack);      // R7-C: the finish line (the line's end; R8b: on open snow)
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
    if (proj.dist > 300) piste.project(state.x, state.z, null, 0, proj);     // R7-C: lost the line (a jump, a respawn): the whole piste
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
    if (proj.s >= finishS && proj.dist < piste.halfWidth + PLAY.finishRadius) {
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

  /** Where to put the skier back after a crash or off-piste: on the line, a little behind the furthest point reached, facing down.
   *  Cleanup round (the cliff routes: Killy Col Pers, Arlberg Wöster-Bockbachtal / Kuhtäli): after a LANDING crash (a drop off a
   *  rock band or a steep pitch onto its run-out) on the line where he landed, not 10 m back (that was on top of the drop again: up to
   *  3.8 s to get going, a second crash at the same cliff), moved down the line off any wall steeper than RESPAWN_WALL deg (by at most
   *  RESPAWN_SKIP m; slopeAt(x, z) = the slope in deg, optional). */
  run.respawnPoint = function respawnPoint({ landed = false, slopeAt = null } = {}) {
    // R7-C: where the skier was when on the course (never far back to the start because the furthest point was lost)
    const here = proj.dist !== undefined && proj.dist < piste.halfWidth + 80 ? proj.s : best;
    let s = Math.max(startS, Math.min(best, here) - 10);
    if (landed) {
      s = Math.max(startS, Math.min(Math.max(best, here), finishS - 5));
      const end = Math.min(finishS - 5, s + RESPAWN_SKIP);
      if (slopeAt) while (s < end && slopeAt(...xz(piste.at(s, tmp))) >= RESPAWN_WALL) s += 2;
    }
    const p = piste.at(s, {});
    return { x: p.x, z: p.z, heading: Math.atan2(p.dz, p.dx), s: p.s };
  };
  run.samples = () => samples;
  run.startS = startS; run.finishS = finishS;
  return run;
}
