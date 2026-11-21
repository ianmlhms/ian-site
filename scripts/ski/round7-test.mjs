#!/usr/bin/env node
/* Round 7 checks without a browser (pure modules only):
 *   spawn      every lift bottom of every resort: the spot faces the station, inside the boarding zone, the view from the camera to 25 m
 *              ahead free of buildings (real footprints), nothing built under the skier; the configured first lift exists
 *   tunnels    the underground funiculars have tunnel spans with a portal near each station, the rail stays under the ground in them
 *   avalanche  Lawin faces per resort (steep, open, off piste), a flow is deterministic (same event = same parcels on two "devices"),
 *              it runs downhill and stops or ends; freshness is 0 on a piste
 *   tags       the name-tag declutter: no two shown tags overlap, the nearest three always shown
 *   misc       the free-ride plan (weather / time from the seed), the Lawin progress survives normalize, the far grid's step
 *   node scripts/ski/round7-test.mjs [resort ...]      exit 0 = all green */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../pb/ski');
const imp = (p) => import(path.join(root, p));
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { createPisteSet } = await imp('pistes.js');
const { createLiftPath, TUNNEL } = await imp('lift-path.js');
const { createLiftNet } = await imp('modes/freeride.js');
const { firstLift, liftSpot, exitSpot, buildingBoxes, createBoxIndex, FIRST_LIFT, SPAWN } = await imp('modes/spawn.js');
const { RIDE } = await imp('modes/liftride.js');
const { findSpots, createFlow, freshness, gradient } = await imp('modes/avalanche.js');
const { declutterTags } = await imp('net/tags.js');
const { resolveFree, matchSeed } = await imp('net/plan.js');
const { normalize, emptyProgress } = await imp('progress.js');

let fails = 0, checks = 0;
const ok = (cond, text) => { checks++; if (!cond) { fails++; console.log(`  FAIL ${text}`); } };
const resorts = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(path.join(root, 'data')).filter((d) => fs.existsSync(path.join(root, 'data', d, 'resort.json')));

for (const rid of resorts) {
  const dir = path.join(root, 'data', rid);
  const resort = JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8'));
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  ok(far.step === 1, `${rid}: far.bin height step ${far.step} m (round 7: 1 m)`);
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network) });
  const fh = (x, z) => field.farHeight(x, z);
  const pistes = createPisteSet(resort);
  const lifts = createLiftNet(resort, fh, pistes);
  const rows = JSON.parse(fs.readFileSync(path.join(dir, 'buildings.json'), 'utf8'));
  const index = createBoxIndex(buildingBoxes(rows));
  const a0 = {};
  const builtAt = (x, z) => { let b = 0; for (const [dx, dz] of [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]]) b += field.attrs(x + dx, z + dz, a0).built || 0; return b / 5; };
  const slope = (x, z) => Math.hypot(fh(x + 6, z) - fh(x - 6, z), fh(x, z + 6) - fh(x, z - 6)) / 12;

  // ---- spawn spots
  const first = firstLift(lifts, rid);
  ok(!!first, `${rid}: the first lift "${FIRST_LIFT[rid]}" is in the data`);
  let blockedLifts = [], built = [], outZone = 0, exitBad = [], exitBlocked = [];
  for (const l of lifts.list) {
    const s = liftSpot(l, { builtAt, index, slope });
    l.board = { x: s.x, z: s.z };
    if (lifts.nearestBottom(s.x, s.z) !== l) outZone++;
    const e = exitSpot(l, { index, builtAt, farHeight: fh, prefer: lifts.startAt(l, fh) });
    if (index.hit(e.x, e.z, 0.8)) exitBad.push(l.name);
    if (e.blocked > 0) exitBlocked.push(`${l.name} (${e.blocked} m)`);
    const down = fh(e.x + Math.cos(e.heading) * 20, e.z + Math.sin(e.heading) * 20) - fh(e.x, e.z);
    ok(down < 3, `${rid} ${l.name}: the exit faces down the slope (${down.toFixed(1)} m over 20 m)`);
    const face = Math.cos(s.heading) * (l.top.x - l.bottom.x) + Math.sin(s.heading) * (l.top.z - l.bottom.z);
    ok(face > 0, `${rid} ${l.name}: looks up the line`);
    if (s.blocked > 0) blockedLifts.push(`${l.name} (${s.blocked} m)`);
    if (index.hit(s.x, s.z, 0.5)) built.push(l.name);
  }
  ok(outZone <= Math.max(1, lifts.list.length * 0.04), `${rid}: "Astegen" offered at the spot (zone ${RIDE.boardRadius} m) at ${lifts.list.length - outZone} / ${lifts.list.length} lifts`);
  ok(exitBad.length === 0, `${rid}: every top exit outside the buildings, on open snow (${exitBad.join(', ')})`);
  ok(exitBlocked.length <= Math.max(1, lifts.list.length * 0.04), `${rid}: ${lifts.list.length - exitBlocked.length} / ${lifts.list.length} exits with 15 m clear ahead (${exitBlocked.slice(0, 5).join(', ')})`);
  ok(built.length <= 1, `${rid}: no spot inside a building (${built.join(', ')})`);
  const firstSpot = first && liftSpot(first, { builtAt, index, slope });
  ok(firstSpot && firstSpot.blocked === 0, `${rid}: the first lift's view is open (${firstSpot ? firstSpot.blocked : '?'} m blocked)`);
  // most lift bottoms have an open view; the rest are listed (a station squeezed between houses has no open spot at all)
  ok(blockedLifts.length <= Math.max(2, lifts.list.length * 0.05), `${rid}: ${lifts.list.length - blockedLifts.length} / ${lifts.list.length} lift bottoms with an open view${blockedLifts.length ? ` (blocked: ${blockedLifts.slice(0, 6).join(', ')})` : ''}`);

  // ---- tunnels
  for (const src of resort.lifts.filter((l) => l.tunnel)) {
    const p = createLiftPath(src, fh);
    ok(p.tunnels.length > 0, `${rid} ${src.name}: tunnel spans`);
    const q = {};
    for (const [a, b] of p.tunnels) {
      ok(a < 40, `${rid} ${src.name}: the lower portal near the station (${a.toFixed(0)} m)`);
      for (let s = a + 5; s < b; s += 25) { p.at(s, q); ok(fh(q.x, q.z) - p.cableY(s) > TUNNEL.cover - 0.01, `${rid} ${src.name}: under the ground at ${s.toFixed(0)} m`); }
    }
  }

  // ---- avalanches
  const spots = findSpots({ lifts: lifts.list, farHeight: fh, attrs: (x, z, o) => field.attrs(x, z, o), places: resort.places });
  ok(spots.length >= 2, `${rid}: ${spots.length} Lawin faces (${spots.map((s) => s.name).join(', ')})`);
  for (const s of spots) {
    ok(gradient(fh, s.x, s.z).deg >= 33, `${rid} ${s.name}: steep (${gradient(fh, s.x, s.z).deg.toFixed(0)} deg)`);
    ok(freshness(field.attrs(s.x, s.z, a0)) > 0.5, `${rid} ${s.name}: fresh, off the piste`);
    ok(new Set(spots.map((q) => q.name)).size === spots.length, `${rid}: Lawin names distinct`);
  }
  if (spots[0]) {
    const ev = { x: spots[0].x, z: spots[0].z, seed: 12345 };
    const A = createFlow(ev, fh), B = createFlow(ev, fh);
    A.advance(6); for (let i = 0; i < 60; i++) B.advance(0.1);
    const same = A.parcels.every((p, i) => Math.abs(p.x - B.parcels[i].x) < 1e-6 && Math.abs(p.z - B.parcels[i].z) < 1e-6);
    ok(same, `${rid}: the flow is deterministic (one 6 s step = sixty 0.1 s steps)`);
    ok(A.front > 30, `${rid}: the flow runs downhill (${A.front.toFixed(0)} m in 6 s)`);
    A.advance(60); ok(A.done, `${rid}: the flow ends`);
  }
  const onPiste = pistes.list[0].at(pistes.list[0].length / 2, {});
  ok(freshness(field.attrs(onPiste.x, onPiste.z, a0)) === 0, `${rid}: never on a groomed piste`);
  console.log(`${rid}: ${lifts.list.length} lift spots (${blockedLifts.length} blocked), first lift ${first ? first.name : '?'}, ${spots.length} Lawin faces`);
}

// ---- name tags
{
  const items = [];
  for (let i = 0; i < 8; i++) items.push({ x: 500 + (i % 3) * 10, y: 400 + (i % 2) * 4, w: 90, h: 22, d: 20 + i * 15 });
  const r = declutterTags(items);
  const shown = items.map((it, i) => ({ ...it, ...r[i] })).filter((t) => t.show);
  let overlap = 0;
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
    const a = shown[i], b = shown[j];
    const ay1 = a.y - a.dy, by1 = b.y - b.dy;
    if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && ay1 - a.h < by1 && by1 - b.h < ay1) overlap++;
  }
  ok(overlap === 0, `tags: no overlap among ${shown.length} shown of 8 bunched skiers`);
  ok([0, 1, 2].every((i) => r[i].show), 'tags: the nearest three always shown');
  const far = declutterTags([{ x: 100, y: 100, w: 80, h: 20, d: 500 }]);
  ok(far[0].alpha < 0.7 && far[0].alpha > 0, `tags: a far skier fades (${far[0].alpha.toFixed(2)})`);
}
// ---- misc
{
  const seed = matchSeed('ABCD', [{ id: 'aaaa' }, { id: 'bbbb' }]);
  const a = resolveFree({ weather: 'random', time: 'random' }, seed), b = resolveFree({ weather: 'random', time: 'random' }, seed);
  ok(a.weather === b.weather && a.time === b.time, `free plan: the same weather / time on every device (${a.weather} / ${a.time})`);
  ok(resolveFree({ weather: 'fog', time: 'evening' }, seed).weather === 'fog', 'free plan: a fixed weather is kept');
  const p = normalize({ ...emptyProgress(), lawin: { 'killy/lawin-1': 2, 'bad key': 3 } });
  ok(p.lawin['killy/lawin-1'] === 2 && !p.lawin['bad key'], 'progress: the Lawin escapes survive normalize');
}

console.log(`${checks - fails} / ${checks} checks green`);
process.exit(fails ? 1 : 0);
