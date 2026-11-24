/* Cleanup round (23 Nov 2026): the cliff routes. A scripted challenge ride down a piste with the GAME's crash handling (main.js: the
 * tumble of SKI.crashSeconds, then respawn() at run.respawnPoint(), standing, facing down the line), not ride-probe's "clear the crash
 * and go on". Per landing crash: where (s), how long the fall was (s, m), and how long it cost: from the crash until he is moving again
 * (>= 5 m/s) past the point where he crashed. A respawn that drops him over the same cliff again counts as a repeat.
 *   node scripts/ski/cliff-check.mjs                       the three cliff routes (Killy col-pers, Arlberg woster-bockbachtal, kuhtali)
 *   node scripts/ski/cliff-check.mjs <resort> [piste ...]   other pistes
 * Checks (exit 1): every ride finishes; a cliff crash costs <= RECOVER_MAX s; never the same cliff twice. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'pb', 'ski');
const imp = (p) => import(path.join(root, p));
const { unpackResort } = await imp('linepack.js');
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { createSurface } = await imp('surface.js');
const { createPisteSet } = await imp('pistes.js');
const { createSkierState, stepSkier, launchState, rollOn } = await imp('skier.js');
const { SKI, MODES } = await imp('config.js');
const { createParkLayout } = await imp('modes/park.js');
const { createCourse } = await imp('modes/course.js');
const { createRun } = await imp('game.js');
const { skiParams } = await imp('modes/skis.js');

const RECOVER_MAX = 2;          // s from a cliff crash until he skis on below it (the tumble is SKI.landingCrashSeconds of that)
const MAX_T = 1500;
const DEFAULT = { killy: ['col-pers'], arlberg: ['woster-bockbachtal', 'kuhtali'], davos: ['teufi', 'muli', 'gipfel-nord-kreuzweg'] };
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

function load(rid) {
  const dir = path.join(root, 'data', rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
  const field = createField({ resort, far: decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin')))), classes: decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin')))), net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`))), 0, true));
  const surface = createSurface(field);
  const world = { height: (x, z) => surface.height(x, z), normal: (x, z, o) => surface.normal(x, z, o), snow: (x, z) => Math.min(1, surface.info(x, z, 0) * 1.25), hit: () => null, ski: skiParams('allmountain', true) };
  return { resort, surface, world, pistes: createPisteSet(resort) };
}

/** The slope in degrees (main.js slopeDeg). */
const slopeOf = (surface) => (x, z) => { const n = surface.normal(x, z, {}); return Math.acos(Math.min(1, n.y)) * 180 / Math.PI; };

/** One challenge ride with the game's crash -> respawn. Returns { done, t, crashes: [{ s, air, drop, cost, repeat }] }. */
function ride({ surface, world }, piste, { tuck, weave }) {
  const slopeAt = slopeOf(surface);
  const course = createCourse({ piste, startS: 2 });
  const run = createRun({ piste, mode: MODES.run, startS: 2, finishS: course.finishS });
  const a = piste.at(2, {});
  let s = launchState(createSkierState(a.x, a.z, Math.atan2(a.dz, a.dx), surface.height(a.x, a.z)), a);
  const proj = {}, q = {};
  let t = 0, best = 0, airT = 0, takeoffY = s.y, open = null;
  const crashes = [];
  while (t < MAX_T && !run.finished) {
    piste.project(s.x, s.z, best, 150, proj);
    best = Math.max(best, proj.s);
    piste.at(proj.s + 12 + s.speed * 0.9, q);
    const side = weave ? Math.sin(best / 38) * weave : 0;
    const err = wrap(Math.atan2(q.z - q.dx * side - s.z, q.x + q.dz * side - s.x) - s.heading);
    const prev = s;
    s = course.collide(prev, stepSkier(prev, { steer: Math.max(-1, Math.min(1, err * 2.4)), tuck: tuck ? 1 : 0, brake: 0, push: s.speed < 3 ? 1 : 0, jump: false }, world));
    t += SKI.dt;
    if (prev.grounded && !s.grounded) { airT = 0; takeoffY = prev.y; }
    if (!s.grounded) airT += SKI.dt;
    if (s.crash > 0 && prev.crash === 0) {
      const here = run.proj.s ?? best;
      const repeat = crashes.some((c) => c.kind === 'landing' && Math.abs(c.s - here) < 60);
      crashes.push({ kind: s.crashKind, s: Math.round(here), air: +prev.air.toFixed(2), drop: +(takeoffY - s.y).toFixed(1), at: t, cost: null, repeat });
      open = crashes[crashes.length - 1];
    }
    run.update(s, SKI.dt);
    if (prev.crash > 0 && s.crash === 0) {
      // main.js: if (wasCrash && game.state.crash === 0) respawn('') -> placeAt(clearSpot(run.respawnPoint({ landed, slopeAt })))
      const r = run.respawnPoint({ landed: s.crashKind === 'landing', at: s, slopeAt });      // (not in the park: main.js)
      const landed = s.crashKind === 'landing';
      s = createSkierState(r.x, r.z, r.heading, surface.height(r.x, r.z));
      if (landed) s = rollOn(s);
    }
    if (open && s.crash === 0 && s.speed >= 5 && (run.proj.s ?? 0) > open.s) { open.cost = +(t - open.at).toFixed(2); open = null; }
  }
  if (open) open.cost = Infinity;
  return { done: !!run.finished, t, crashes };
}

const args = process.argv.slice(2);
const targets = args.length ? { [args[0]]: args.slice(1) } : DEFAULT;
let fails = 0, rides = 0;
for (const [rid, ids] of Object.entries(targets)) {
  const R = load(rid);
  const list = ids.length ? ids.map((id) => R.pistes.byId.get(id)).filter(Boolean) : R.pistes.list;
  for (const p of list) {
    for (const [style, o] of [['line upright', { tuck: 0, weave: 0 }], ['line tucked', { tuck: 1, weave: 0 }], ['S tucked', { tuck: 1, weave: 8 }]]) {
      const r = ride(R, p, o);
      rides++;
      const cliffs = r.crashes.filter((c) => c.kind === 'landing');
      const slow = cliffs.filter((c) => c.cost > RECOVER_MAX), rep = cliffs.filter((c) => c.repeat);
      const bad = !r.done || slow.length || rep.length;
      if (bad) fails++;
      console.log(`${bad ? 'FAIL' : 'ok  '} ${rid} ${p.id.padEnd(22)} ${style.padEnd(12)} ${r.done ? `${r.t.toFixed(1)} s` : 'DNF'}  crashes ${r.crashes.length}${r.crashes.length ? ': ' + r.crashes.map((c) => `${c.kind} s ${c.s} after ${c.air} s / ${c.drop} m, back in ${c.cost} s${c.repeat ? ' REPEAT' : ''}`).join('; ') : ''}`);
    }
  }
}
console.log(`cliff-check: ${rides} rides, ${fails} failed`);
process.exit(fails ? 1 : 0);
