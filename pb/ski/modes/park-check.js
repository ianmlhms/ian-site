/* Node checks of the snow park (round 4A), used by pb/ski/harness.js (section E) and runnable alone:
 *   node pb/ski/modes/park-check.js [resort] [--trace]
 * A scripted rider takes every feature of the resort's park in its lane: each kicker straight, then with tricks (a 360 on M, a 720 +
 * grab and a backflip on L), every rail / box, and the halfpipe; it checks the air, the landing judgement, the slides and the score. */
import { SKI } from '../config.js';
import { createSkierState } from '../skier.js';
import { createParkLayout, stepPark, createTrickJudge } from './park.js';

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** A rider that holds a lane (v) down the park and asks for a trick in the air: { spin: rad wanted, flip: +-1, grab: bool }. */
export function parkRider(layout, plan) {
  const q = {};
  let airT = 0;
  return function drive(state) {
    layout.local(state.x, state.z, q);
    const step = plan.find((p) => q.s < p.until) || plan[plan.length - 1];
    const aim = layout.world(q.s + 10, step.v);
    const want = Math.atan2(aim.z - state.z, aim.x - state.x);
    const inp = { steer: 0, tuck: 0, brake: state.speed > (step.speed || 11) ? 1 : 0, push: state.speed < 4 ? 1 : 0, jump: false, trick: false, pitch: 0 };
    if (state.grounded || state.rail >= 0) {
      airT = 0;
      inp.steer = state.rail >= 0 ? (step.slide ? 1 : 0) : Math.max(-1, Math.min(1, wrap(want - state.heading) * 2.2));
      return inp;
    }
    airT += SKI.dt;
    const t = step.trick || {};
    if (t.spin && Math.abs(state.spin) < t.spin - 0.25) inp.steer = 1;
    else if (t.spin) inp.steer = 0;
    if (t.flip && Math.abs(state.flip) < Math.PI * 2 - 0.35) inp.pitch = t.flip;
    if (t.grab && airT > 0.1 && airT < 0.55) inp.trick = true;
    return inp;
  };
}

/** Rides one plan from the top of the park; returns { judge, events, crashes, airs, slides, finished }. */
export function rideParkPlan(layout, world, plan, { trace = false, maxT = 120 } = {}) {
  const top = layout.world(-4, plan[0].v);
  let s = createSkierState(top.x, top.z, layout.heading, world.height(top.x, top.z));
  const drive = parkRider(layout, plan);
  const judge = createTrickJudge(layout);
  const events = [];
  let crashes = 0, t = 0, airs = 0, slides = 0, maxAir = 0, airNow = 0;
  const q = {};
  while (t < maxT) {
    const inp = drive(s);
    const prev = s;
    s = stepPark(layout, prev, inp, world, SKI.dt);
    t += SKI.dt;
    if (!prev.grounded && s.grounded) airs++;
    if (prev.rail < 0 && s.rail >= 0) slides++;
    if (!s.grounded) { airNow += SKI.dt; maxAir = Math.max(maxAir, airNow); } else airNow = 0;
    if (prev.crash === 0 && s.crash > 0) crashes++;
    if (prev.crash > 0 && s.crash === 0) { const p = layout.world(layout.local(s.x, s.z, q).s, 0); s = createSkierState(p.x, p.z, layout.heading, world.height(p.x, p.z)); }
    for (const ev of judge.update(prev, s, SKI.dt)) { events.push({ ...ev, at: Math.round(layout.local(s.x, s.z, q).s) }); if (trace) console.log('     ', JSON.stringify(events[events.length - 1])); }
    if (layout.local(s.x, s.z, q).s > layout.len - 2) break;
  }
  const finished = layout.local(s.x, s.z, q).s > layout.len - 2;
  return { judge, events, crashes, airs, slides, maxAir, finished, t, points: judge.finish() };
}

/** The checks; `check(ok, msg)` from the harness. */
export function runParkChecks({ resort, world, check, trace = false }) {
  const layout = createParkLayout(resort.park);
  if (!check(!!layout, `park: ${resort.park ? resort.park.name : 'none'} in resort.json`)) return;
  console.log(`      ${layout.name}: ${Math.round(layout.len)} m, kickers ${layout.kickers.map((k) => k.size).join(' ')}, ${layout.rails.filter((r) => r.kind === 'rail').length} rails, ${layout.rails.filter((r) => r.kind === 'box').length} boxes, halfpipe ${layout.pipe ? Math.round(layout.pipe.s1 - layout.pipe.s0) + ' m' : 'no'}`);
  // 1 straight airs off every kicker (no tricks): clean landings, no falls
  for (const k of layout.kickers) {
    const r = rideParkPlan(layout, world, [{ v: k.v, until: k.end + 2, speed: k.size === 'L' ? 12.5 : k.size === 'M' ? 11 : 10 }, { v: k.v, until: 1e9 }], { trace });
    const ev = r.events.filter((e) => e.at >= k.s0 && e.at < k.end + 25);
    check(r.crashes === 0 && r.maxAir > (k.size === 'S' ? 0.35 : k.size === 'M' ? 0.6 : 0.9), `kicker ${k.size} at ${k.s0} m straight: air ${r.maxAir.toFixed(2)} s, ${r.crashes} falls${ev.length ? ', ' + ev.map((e) => e.name).join(', ') : ''}`);
  }
  // 2 tricks: a 360 off the first M, a 720 grab and a backflip off L kickers
  const M = layout.kickers.find((k) => k.size === 'M'), Ls = layout.kickers.filter((k) => k.size === 'L');
  const trickRuns = [];
  if (M) trickRuns.push([M, { spin: Math.PI * 2 }, 11, /360/]);
  if (Ls[0]) trickRuns.push([Ls[0], { spin: Math.PI * 4, grab: true }, 12.5, /720 Grab/]);
  if (Ls[1] || Ls[0]) trickRuns.push([Ls[1] || Ls[0], { flip: -1 }, 12.5, /Backflip/]);
  for (const [k, trick, speed, name] of trickRuns) {
    const r = rideParkPlan(layout, world, [{ v: k.v, until: k.s0 + k.run + 2, speed }, { v: k.v, until: k.end + 8, speed, trick }, { v: k.v, until: 1e9 }], { trace });
    const ev = r.events.find((e) => e.type === 'trick' && name.test(e.name) && e.at > k.s0 && e.at < k.end + 25);
    check(!!ev && r.crashes === 0, `kicker ${k.size} at ${k.s0} m: ${ev ? `${ev.name} ${ev.quality} +${ev.points}` : 'no ' + name} (${r.crashes} falls, air ${r.maxAir.toFixed(2)} s)`);
  }
  // 3 rails and boxes: the rider slides each one (straight, then across)
  for (const rail of layout.rails) {
    const r = rideParkPlan(layout, world, [{ v: rail.v, until: rail.s1 + 4, speed: 8, slide: rail.id % 2 === 1 }, { v: rail.v, until: 1e9 }], { trace });
    const ev = r.events.find((e) => e.type === 'trick' && /slide|50-50/.test(e.name) && e.at > rail.s0 && e.at < rail.s1 + 20);
    check(r.slides > 0 && !!ev && r.crashes === 0, `${rail.kind} at ${Math.round(rail.s0)} m: ${ev ? `${ev.name} +${ev.points}` : 'no slide'} (${r.crashes} falls)`);
  }
  // 4 the halfpipe: carving wall to wall gives air out of it
  if (layout.pipe) {
    const p = layout.pipe;
    const plan = [{ v: 0, until: p.s0, speed: 10 }];
    for (let s = p.s0, side = 1; s < p.s1; s += 20, side = -side) plan.push({ v: side * (layout.deck + 1), until: s + 20, speed: 14, trick: { spin: Math.PI } });
    plan.push({ v: 0, until: 1e9 });
    const r = rideParkPlan(layout, world, plan, { trace });
    const ev = r.events.filter((e) => e.type === 'trick' && e.at > p.s0 - 4);
    check(ev.length >= 1, `halfpipe: ${ev.length} airs judged (${ev.map((e) => `${e.name} ${e.quality}`).join(', ')}), ${r.crashes} falls, best air ${r.maxAir.toFixed(2)} s`);
  }
  // 5 a whole run with tricks scores and finishes
  const lane = (k) => k.v;
  const plan = [];
  for (const k of layout.kickers) plan.push({ v: lane(k), until: k.s0 + k.run + 2, speed: k.size === 'L' ? 12.5 : 11 }, { v: lane(k), until: k.end + 6, speed: 11, trick: k.size === 'S' ? { spin: Math.PI } : k.size === 'M' ? { spin: Math.PI * 2, grab: true } : { spin: Math.PI * 3 } });
  plan.push({ v: 0, until: 1e9 });
  const run = rideParkPlan(layout, world, plan, { trace });
  check(run.finished && run.points > 500, `a whole park run: ${run.points} points, ${run.events.filter((e) => e.type === 'trick').length} tricks, ${run.crashes} falls, ${run.t.toFixed(0)} s`);
  return layout;
}
