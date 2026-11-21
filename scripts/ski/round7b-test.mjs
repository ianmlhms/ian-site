#!/usr/bin/env node
/* Round 7-B checks without a browser (the pure modules on the real 5 m heights): EVERY lift of EVERY resort, all kinds.
 *   stations     both stations exist, of the lift's type
 *   boarding     the waiting spot is inside the boarding zone (and only that lift's), clear of every solid part, building and tree;
 *                the ride goes board -> ride -> alight -> done exactly once (no skip while boarding: one press = one boarding), the
 *                rider never jumps
 *   exit         outside every station footprint and building, out of every low lift lane, on walkable snow, facing downhill
 *                (or flat), 15 m clear ahead
 *   drag lifts   the skis stay on the track (within 3 cm of the snow, on the up lane beside the pylon line); the return loop exists
 *   envelope     the rider (on the ground and on the carrier) and every carrier of the loop never touch a pylon, a station part or
 *                a tree (minimum distance > 0)
 *   tunnels      underground funiculars run under the ground between their portals
 *   node scripts/ski/round7b-test.mjs [resort ...]    exit 0 = all green; prints a table per resort and lift kind */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../pb/ski');
const imp = (p) => import(path.join(root, p));
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { createSurface } = await imp('surface.js');
const { createScatter, BLOCK } = await imp('scatter.js');
const { createPisteSet } = await imp('pistes.js');
const { createLiftPath, liftClass } = await imp('lift-path.js');
const { createLiftSite, createLiftWorld, liftTreeGuard, frames, TREE_TOP } = await imp('lift-site.js');
const { createRide } = await imp('modes/liftride.js');
const { createLiftNet } = await imp('modes/freeride.js');
const { createParkLayout } = await imp('modes/park.js');

const TYPE_OF = { chair: 'platform', gondola: 'hall', cable: 'terminal', drag: 'hut', carpet: 'belt', train: 'rail' };
const SKIER_R = 0.35;
let fails = 0, checks = 0;
const failLines = [];
const ok = (cond, text) => { checks++; if (!cond) { fails++; failLines.push(text); if (failLines.length < 400) console.log(`  FAIL ${text}`); } return cond; };
const resorts = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(path.join(root, 'data')).filter((d) => fs.existsSync(path.join(root, 'data', d, 'resort.json')));
const table = [];

/** A carrier box (centre x, y = rope, z; heading) against a part box of a frame: overlap in the frame's plane and in height? */
function boxHitsPart(f, g0, p, cx, cz, heading, hw, hl, yLo, yHi, pad = 0) {
  if (!p.solid) return false;
  if (yHi < g0 + p.y0 - 5 * (p.y0 <= 0.05 && p.y0 >= -0.6 ? 1 : 0) || yLo > g0 + p.y1) return false;      // (ground parts reach down to the lowest ground)
  const l = f.toLocal(cx, cz, {});
  const c = Math.cos(heading), s = Math.sin(heading);
  const ca = Math.abs(c * f.fx + s * f.fz), cbb = Math.abs(c * f.rx + s * f.rz);      // |cos| / |sin| of the carrier axis in the frame
  const ea = ca * hl + cbb * hw + pad, eb = cbb * hl + ca * hw + pad;
  return l.a + ea > p.a0 && l.a - ea < p.a1 && l.b + eb > p.b0 && l.b - eb < p.b1;
}

for (const rid of resorts) {
  const t0 = Date.now();
  const dir = path.join(root, 'data', rid);
  const resort = JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8'));
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`)))));
  const surface = createSurface(field);
  const H = (x, z) => surface.height(x, z);
  const buildings = JSON.parse(fs.readFileSync(path.join(dir, 'buildings.json'), 'utf8'));
  const pistes = createPisteSet(resort);
  const net = createLiftNet(resort, field.farHeight, pistes);             // as the game: the far grid for the layout
  const world = net.setBuildings(buildings);
  const scatter = createScatter(field, { guard: liftTreeGuard(resort, createLiftPath, field.farHeight) });
  const tree = (x, z) => !!scatter.hit(x, z, 0.4, -1e9, 1);
  const starts = pistes.list.map((p) => p.top);
  const kept = buildings.filter((_, i) => world.keepBuilding(i)).length;
  const per = {};
  const K = (k) => (per[k] = per[k] || { lifts: 0, stations: 0, rides: 0, exits: 0, minPylon: Infinity, minTree: Infinity, minStation: Infinity, dragSki: 0, loops: 0, tunnels: 0, fails: 0 });
  const failsBefore = fails;
  // trees near a point (for the envelope checks): from the scatter's blocks
  const treesNear = (x, z, r) => {
    const out = [];
    for (let bz = Math.floor((z - r) / BLOCK); bz <= Math.floor((z + r) / BLOCK); bz++) for (let bx = Math.floor((x - r) / BLOCK); bx <= Math.floor((x + r) / BLOCK); bx++) {
      const t = scatter.treeBlock(bx, bz);
      for (let i = 0; i < t.length; i += 6) if (Math.abs(t[i] - x) < r && Math.abs(t[i + 2] - z) < r) out.push([t[i], t[i + 1], t[i + 2], t[i + 3]]);
    }
    return out;
  };
  const pylonsNear = (x, z, r) => {
    const out = [];
    for (const [, site] of world.sites) {
      const p = site.path;
      if (Math.hypot(p.cx - x, p.cz - z) > p.radius + r) continue;
      for (const sp of p.supports) if (sp.tower) { const q = p.at(sp.s, {}); if (Math.hypot(q.x - x, q.z - z) < r) out.push({ x: q.x, z: q.z, top: sp.y + 0.55 }); }
    }
    return out;
  };
  const framesNear = (x, z, r) => {
    const out = [];
    for (const [, site] of visWorld.sites) for (const f of frames(site)) if (Math.hypot(f.x - x, f.z - z) < r + 60) out.push(f);
    return out;
  };
  /** The envelope check of one box (carrier or rider) against pylons, station parts and trees: returns the clearances. */
  function envelope(cx, cz, heading, hw, hl, yLo, yHi, ignorePylon = null) {
    let pyl = Infinity, st = Infinity, tr = Infinity;
    const rr = Math.hypot(hw, hl);
    for (const py of pylonsNear(cx, cz, rr + 3)) {
      if (yLo > py.top || py === ignorePylon) continue;
      // in the box frame: distance from the column axis to the box, minus the column radius
      const dx = py.x - cx, dz = py.z - cz, c = Math.cos(heading), s = Math.sin(heading);
      const a = Math.abs(dx * c + dz * s) - hl, b = Math.abs(-dx * s + dz * c) - hw;
      const d = Math.hypot(Math.max(0, a), Math.max(0, b)) - 0.45;
      pyl = Math.min(pyl, a < 0 && b < 0 ? -1 : d);
    }
    for (const f of framesNear(cx, cz, rr)) {
      const g0 = field.farHeight(f.x, f.z) * 0 + H(f.x, f.z);
      for (const p of f.parts) if (boxHitsPart(f, g0, p, cx, cz, heading, hw, hl, yLo, yHi)) {
        st = Math.min(st, -1);
        if (process.env.R7B_DEBUG && !envelope.told) { envelope.told = true; const l = f.toLocal(cx, cz, {}); console.log('    hit part', JSON.stringify({ ...p, col: p.col.toString(16) }), 'at a', l.a.toFixed(2), 'b', l.b.toFixed(2), 'y', (yLo - g0).toFixed(2), (yHi - g0).toFixed(2), 'hw', hw.toFixed(2), 'hl', hl.toFixed(2), 'which', f.which); }
      }
    }
    for (const [tx, ty, tz, sc] of treesNear(cx, cz, rr + 4)) {
      if (yLo > ty + 10 * sc || yHi < ty) continue;
      const crown = 2.3 * sc * Math.max(0, Math.min(1, (ty + 10 * sc - yLo) / (10 * sc)));      // the cone narrows upwards
      const d = Math.hypot(tx - cx, tz - cz) - rr - Math.max(0.3, crown);
      tr = Math.min(tr, d);
    }
    return { pyl, st, tr };
  }

  // what lifts.js draws: the 5 m heights, the same pruning
  const visPaths = new Map();
  resort.lifts.forEach((src, i) => { const q = createLiftPath(src, (x, z) => field.height(x, z)); if (q) visPaths.set(i, q); });
  const visWorld = createLiftWorld(visPaths);
  for (const [index, site] of world.sites) {
    envelope.told = false; envelope.toldTree = false;
    const src = resort.lifts[index];
    const fp = site.path;                                   // far-grid layout (the game's lift net)
    const p = visPaths.get(index);                                         // what lifts.js draws (the 5 m heights)
    const kind = p.kind, k = K(kind + (p.sub ? ':' + p.sub : '') + (p.tunnel ? ':tunnel' : ''));
    const name = `${rid} #${index} ${src.name || src.type} (${kind}${p.sub ? '/' + p.sub : ''})`;
    k.lifts++;
    // stations
    const vis = visWorld.sites.get(index);
    const both = vis.ends.length === 2 && vis.ends.every((e) => e.parts.length > 0 && e.type === TYPE_OF[kind]);
    if (ok(both, `${name}: both stations (${vis.ends.map((e) => `${e.type}/${e.parts.length}`).join(', ')})`)) k.stations += 2;
    // the carriers' loop: every carrier position (2 m apart) clear of pylons (other than the one it passes under), stations, trees
    if (kind !== 'carpet' && !(kind === 'drag' && p.sub === 'rope')) {
      const cb = p.carrier;
      const step = 2;
      for (let u = 0; u < p.loopLen; u += step) {
        const w = p.loopAt(u, {});
        if (kind === 'train') {
          if (p.tunnel && w.s > 20 && w.s < p.len - 20) continue;                 // underground: the tube, no trees
          const e = envelope(w.x, w.z, w.heading, cb.hw, cb.hl, w.y, w.y + cb.top);
          k.minStation = Math.min(k.minStation, e.st); k.minTree = Math.min(k.minTree, e.tr);
          continue;
        }
        const e = envelope(w.x, w.z, w.heading, cb.hw + cb.drop * 0.035, cb.hl, w.y - cb.drop, w.y + cb.top * 0.5);
        k.minPylon = Math.min(k.minPylon, e.pyl); k.minStation = Math.min(k.minStation, e.st); k.minTree = Math.min(k.minTree, e.tr);
        if (e.pyl <= 0 || e.st <= 0 || e.tr <= 0) { ok(false, `${name}: a carrier at u ${u.toFixed(0)} / ${p.loopLen.toFixed(0)} (s ${w.s.toFixed(0)}) touches a ${e.pyl <= 0 ? 'pylon' : e.st <= 0 ? 'station part' : 'tree'}`); break; }
      }
      // the return loop: carriers on the down lane, and the loop closes
      if (!p.shuttle) {
        const down = p.loopAt(p.len + Math.PI * p.wheelR + p.len / 2, {}), a = p.loopAt(p.loopLen - 0.01, {}), b = p.loopAt(0, {});
        if (ok(!down.up && Math.hypot(a.x - b.x, a.z - b.z) < 0.2, `${name}: the loop returns on the other side and closes`)) k.loops++;
        if (kind === 'drag') {
          const q = p.at(p.len / 2, {});
          const lat = (down.x - q.x) * -q.dz + (down.z - q.z) * q.dx;
          ok(lat < -1, `${name}: the empty bars come back down on the return rope (${lat.toFixed(1)} m beside the pylon line)`);
        }
      }
    }
    // tunnels
    if (p.tunnel) {
      let under = 0, n = 0;
      for (let s = p.len * 0.1; s <= p.len * 0.9; s += 5) { n++; if (p.cableY(s) + 5.7 < p.ground(s)) under++; }
      if (ok(under >= n * 0.85 && vis.portals.length === 2, `${name}: underground (${under} of ${n} points with the vault under the ground), ${vis.portals.length} portals`)) k.tunnels++;
    }
    // the ride (rideable lifts)
    const lift = net.byIndex.get(index);
    if (!lift) continue;
    k.rides++;
    const zoneOk = site.inZone(site.wait.x, site.wait.z) && world.boardingAt(site.wait.x, site.wait.z) === index;
    ok(zoneOk, `${name}: the waiting spot is in its own boarding zone (found ${world.boardingAt(site.wait.x, site.wait.z)})`);
    ok(!world.hit(site.wait.x, site.wait.z, SKIER_R, H(site.wait.x, site.wait.z), H) && !world.inBuilding(site.wait.x, site.wait.z, 0.3) && !tree(site.wait.x, site.wait.z), `${name}: the waiting spot is clear (no part, building or tree)`);
    // outside the zone: no boarding
    const out = site.bottom.toWorld(site.zone.a0 - 6, site.zone.b1 + 6, {});
    ok(world.boardingAt(out.x, out.z) !== index, `${name}: 6 m outside the zone: no boarding`);
    const ride = createRide({ lift, path: p, site: vis, height: H, exitAt: () => world.exitOf(index, H, tree, starts) });
    ok(ride.skip() === false, `${name}: no skip while boarding (one press = one boarding)`);
    let prev = null, worst = 0, steps = 0, phases = [], minP = Infinity, minS = Infinity, minT = Infinity, dragWorst = 0, dragLat = Infinity;
    while (!ride.done && steps < 400000) {
      ride.step(1 / 60); steps++;
      if (phases[phases.length - 1] !== ride.phase) phases.push(ride.phase);
      const w = ride.where();
      if (prev) worst = Math.max(worst, Math.hypot(w.x - prev.x, w.z - prev.z));
      prev = { x: w.x, z: w.z };
      if (steps % 3) continue;
      // the rider's envelope: on the ground a skier (0.35 m, 1.8 m tall); on a chair / in a cabin the carrier's own box
      const onC = w.onCarrier;
      if (!onC || kind === 'drag' || kind === 'carpet') {
        const e = envelope(w.x, w.z, w.heading, SKIER_R, kind === 'drag' && onC ? 0.85 : SKIER_R, w.y, w.y + 1.8);
        minP = Math.min(minP, e.pyl); minS = Math.min(minS, e.st); minT = Math.min(minT, e.tr);
      } else if (kind !== 'train' || !p.tunnel) {
        const cb = p.carrier;
        const e = envelope(w.cx, w.cz, w.heading, cb.hw + cb.drop * 0.035, cb.hl, kind === 'train' ? w.cy : w.cy - cb.drop, kind === 'train' ? w.cy + cb.top : w.cy + cb.top * 0.5);
        minP = Math.min(minP, e.pyl); minS = Math.min(minS, e.st); minT = Math.min(minT, e.tr);
      }
      if (kind === 'drag' && onC && ride.phase === 'ride') {
        dragWorst = Math.max(dragWorst, Math.abs(w.y - H(w.x, w.z)));
        const q = p.at(w.s, {});
        dragLat = Math.min(dragLat, (w.x - q.x) * -q.dz + (w.z - q.z) * q.dx);
      }
    }
    ok(ride.done && phases.join() === 'board,ride,alight,done', `${name}: one boarding, one ride, off at the top (${phases.join(' > ')})`);
    ok(worst < 1.2, `${name}: no jump (worst ${worst.toFixed(2)} m per frame at x4)`);
    ok(minP > 0 && minS > 0 && minT > 0, `${name}: the rider never touches a pylon (${minP.toFixed(2)} m), a station part (${minS === Infinity ? 'none near' : minS.toFixed(2)}), a tree (${minT === Infinity ? 'none near' : minT.toFixed(2)} m)`);
    k.minPylon = Math.min(k.minPylon, minP); k.minTree = Math.min(k.minTree, minT); k.minStation = Math.min(k.minStation, minS);
    if (kind === 'drag') {
      const want = p.sub === 'rope' ? p.side - 0.45 : p.side;
      if (ok(dragWorst <= 0.03 && Math.abs(dragLat - want) < 0.05, `${name}: skis on the track (${(dragWorst * 100).toFixed(1)} cm off the snow, ${dragLat.toFixed(2)} m beside the pylon line)`)) k.dragSki++;
    }
    // the exit
    const ex = ride.exit;
    const g = (x, z) => H(x, z);
    const ahead = g(ex.x + Math.cos(ex.heading) * 15, ex.z + Math.sin(ex.heading) * 15), back = g(ex.x - Math.cos(ex.heading) * 15, ex.z - Math.sin(ex.heading) * 15);
    const sl = Math.hypot(g(ex.x + 2, ex.z) - g(ex.x - 2, ex.z), g(ex.x, ex.z + 2) - g(ex.x, ex.z - 2)) / 4;
    const a = field.attrs(ex.x, ex.z, {});
    let clear = true;
    for (let m = 0; m <= 15; m += 1) {
      const x = ex.x + Math.cos(ex.heading) * m, z = ex.z + Math.sin(ex.heading) * m;
      if (world.inStation(x, z, 0.5) || world.inBuilding(x, z, 0.5) || world.hit(x, z, SKIER_R, H(x, z), H) || world.inLowLane(x, z, H, 2.5) || tree(x, z)) clear = false;
    }
    const good = !ex.fallback && !world.inStation(ex.x, ex.z, 1.5) && !world.inBuilding(ex.x, ex.z, 1.5) && !world.inLowLane(ex.x, ex.z, H, 3) && sl < 0.75 && a.water < 0.3 && ahead < back + 0.5 && clear;
    if (ok(good, `${name}: exit ${ex.dist.toFixed(0)} m out, outside stations / buildings / lanes, slope ${sl.toFixed(2)}, water ${a.water.toFixed(2)}, ${ahead < back + 0.5 ? 'downhill' : 'UPHILL'}, ${clear ? '15 m clear' : 'BLOCKED ahead'}${ex.fallback ? ', FALLBACK' : ''}`)) k.exits++;
  }
  for (const [kk, v] of Object.entries(per)) table.push({ rid, kind: kk, ...v });
  console.log(`${rid}: ${world.sites.size} lifts drawn, ${net.list.length} ridden, ${kept} of ${buildings.length} buildings kept, ${fails - failsBefore} fails (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
const f2 = (v) => (v === Infinity ? '-' : v.toFixed(2));
console.log('\nresort     kind               lifts stations rides exits  loops tunnels drag-ski  min pylon  min station  min tree');
for (const r of table) console.log(`${r.rid.padEnd(11)}${r.kind.padEnd(19)}${String(r.lifts).padStart(5)}${String(r.stations).padStart(9)}${String(r.rides).padStart(6)}${String(r.exits).padStart(6)}${String(r.loops).padStart(7)}${String(r.tunnels).padStart(8)}${String(r.dragSki).padStart(9)}${f2(r.minPylon).padStart(11)}${f2(r.minStation).padStart(13)}${f2(r.minTree).padStart(10)}`);
console.log(`\n${checks - fails} / ${checks} checks green`);
if (process.env.R7B_JSON) fs.writeFileSync(process.env.R7B_JSON, JSON.stringify({ table, fails: failLines }, null, 1));
process.exit(fails ? 1 : 0);
