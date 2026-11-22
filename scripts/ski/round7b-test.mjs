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
 *   launch fix   (Ian, Tignes Champagny: "no real station, can't ride") every drawn lift is rideable; each end keeps its type's main
 *                parts (chair canopy + hut, hall / rail roof, terminal roof + machine house, drag hut + wheel mast; a roof may be
 *                missing only in a shared station where a neighbour's roof stands within 30 m); no part floats (every kept part stands
 *                on the ground or on one that does), every bull-wheel is held, no part is bigger than a station; the boarding zone is
 *                marked and can be reached over the snow (a clear 12 m way in from at least one side)
 *   chairs       (after launch) boarded through a gate that is open while he passes, detachable ones (4+ seats) over a loading belt,
 *                the chair comes up behind him (never in front of / through him) and he sits within 0.3 s of its arrival
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
const { createLiftSite, createLiftWorld, liftTreeGuard, frames, TREE_TOP, standingParts, wheelHeld } = await imp('lift-site.js');
const { createRide } = await imp('modes/liftride.js');
const { createLiftNet } = await imp('modes/freeride.js');
const { createParkLayout } = await imp('modes/park.js');
const { unpackResort } = await imp('linepack.js');
const { createSkierState, stepSkier } = await imp('skier.js');
const { SKI } = await imp('config.js');

let GROUND = null;
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
  let y0 = g0 + p.y0;
  if (p.y0 <= 0.05 && p.y0 >= -0.6 && GROUND) {                // ground parts reach down to the lowest ground under them (lifts.js)
    for (const [a, b] of [[p.a0, p.b0], [p.a1, p.b0], [p.a0, p.b1], [p.a1, p.b1], [(p.a0 + p.a1) / 2, (p.b0 + p.b1) / 2]]) { const w = f.toWorld(a, b, {}); y0 = Math.min(y0, GROUND(w.x, w.z) - 0.3); }
  }
  if (yHi < y0 || yLo > g0 + p.y1) return false;
  const l = f.toLocal(cx, cz, {});
  const c = Math.cos(heading), s = Math.sin(heading);
  const ca = Math.abs(c * f.fx + s * f.fz), cbb = Math.abs(c * f.rx + s * f.rz);      // |cos| / |sin| of the carrier axis in the frame
  const ea = ca * hl + cbb * hw + pad, eb = cbb * hl + ca * hw + pad;
  if (!(l.a + ea > p.a0 && l.a - ea < p.a1 && l.b + eb > p.b0 && l.b - eb < p.b1)) return false;
  // separating axis test on the carrier's own two axes too (exact for two rectangles)
  const ua = c * f.fx + s * f.fz, ub = c * f.rx + s * f.rz;            // the carrier's travel axis in the frame
  const pa = (p.a0 + p.a1) / 2 - l.a, pb = (p.b0 + p.b1) / 2 - l.b, ha = (p.a1 - p.a0) / 2, hb = (p.b1 - p.b0) / 2;
  for (const [ax, ay, e] of [[ua, ub, hl], [-ub, ua, hw]]) {
    const d = Math.abs(pa * ax + pb * ay), r = Math.abs(ax) * ha + Math.abs(ay) * hb + e + pad;
    if (d >= r) return false;
  }
  return true;
}

for (const rid of resorts) {
  const t0 = Date.now();
  const dir = path.join(root, 'data', rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));      // R7-D: packed piste lines
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`)))));
  const surface = createSurface(field);
  const H = (x, z) => surface.height(x, z);
  GROUND = (x, z) => field.height(x, z);
  const buildings = JSON.parse(fs.readFileSync(path.join(dir, 'buildings.json'), 'utf8'));
  const pistes = createPisteSet(resort);
  const net = createLiftNet(resort, field.farHeight, pistes);             // as the game: the far grid for the layout
  const world = net.setBuildings(buildings);
  const scatter = createScatter(field, { guard: liftTreeGuard(resort, createLiftPath, field.farHeight) });
  const tree = (x, z) => !!scatter.hit(x, z, 0.4, -1e9, 1);
  const starts = pistes.list;
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
    for (const [, site] of visWorld.sites) {                  // R8: the drawn pylons (5 m heights), like the carriers they are checked against
      const p = site.path;
      if (Math.hypot(p.cx - x, p.cz - z) > p.radius + r) continue;
      for (const sp of p.supports) if (sp.tower) { const q = p.at(sp.s, {}); if (Math.hypot(q.x - x, q.z - z) < r) out.push({ x: q.x, z: q.z, top: sp.y + 0.55 }); }
    }
    return out;
  };
  // R8 (early QA: the Flexenbahn line ran into a 4-storey block): the KEPT buildings (village.js draws them) with their roof tops
  const bGrid = new Map();
  buildings.forEach((b, i) => {
    if (!world.keepBuilding(i)) return;
    const [cx, cz, L, Wd, ang, eave, ridge, ground] = b, r = Math.hypot(L, Wd) / 2;
    const item = { cx, cz, c: Math.cos(ang), s: Math.sin(ang), hl: L / 2, hw: Wd / 2, top: (ground || 0) + Math.max(eave || 0, ridge || 0), name: i };
    for (let j = Math.floor((cz - r) / 50); j <= Math.floor((cz + r) / 50); j++) for (let k = Math.floor((cx - r) / 50); k <= Math.floor((cx + r) / 50); k++) { const key = k * 100003 + j; if (!bGrid.has(key)) bGrid.set(key, []); bGrid.get(key).push(item); }
  });
  const buildingUnder = (x, z, rr, yLo) => {
    for (const b of bGrid.get(Math.floor(x / 50) * 100003 + Math.floor(z / 50)) || []) {
      if (yLo > b.top) continue;
      const dx = x - b.cx, dz = z - b.cz, u = Math.abs(dx * b.c + dz * b.s) - b.hl, v = Math.abs(-dx * b.s + dz * b.c) - b.hw;
      if (Math.hypot(Math.max(0, u), Math.max(0, v)) < rr) return b;
    }
    return null;
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
        if (process.env.R7B_DEBUG && !envelope.told) { envelope.told = true; const l = f.toLocal(cx, cz, {}); console.log('    hit part', envelope.ctx || '', JSON.stringify({ ...p, col: p.col.toString(16) }), 'at a', l.a.toFixed(2), 'b', l.b.toFixed(2), 'y', (yLo - g0).toFixed(2), (yHi - g0).toFixed(2), 'hw', hw.toFixed(2), 'hl', hl.toFixed(2), 'which', f.which); }
      }
    }
    for (const [tx, ty, tz, sc] of treesNear(cx, cz, rr + 4)) {
      if (yLo > ty + 10 * sc || yHi < ty) continue;
      const crown = 2.3 * sc * Math.max(0, Math.min(1, (ty + 10 * sc - yLo) / (10 * sc)));      // the cone narrows upwards
      const dx = tx - cx, dz = tz - cz, c = Math.cos(heading), s = Math.sin(heading);
      const a = Math.abs(dx * c + dz * s) - hl, b = Math.abs(-dx * s + dz * c) - hw;
      const d = Math.hypot(Math.max(0, a), Math.max(0, b)) - Math.max(0.3, crown);
      tr = Math.min(tr, a < 0 && b < 0 ? -1 : d);
      if (process.env.R7B_DEBUG && d <= 0 && !envelope.toldTree) { envelope.toldTree = true; console.log('    tree', tx.toFixed(1), tz.toFixed(1), 'y', ty.toFixed(1), 'scale', sc.toFixed(2), 'box', cx.toFixed(1), cz.toFixed(1), 'a', a.toFixed(2), 'b', b.toFixed(2), 'crown', crown.toFixed(2), 'yLo', yLo.toFixed(1)); }
    }
    return { pyl, st, tr };
  }

  // what lifts.js draws: the 5 m heights, the same pruning
  const visPaths = new Map();
  resort.lifts.forEach((src, i) => { const q = createLiftPath(src, (x, z) => field.height(x, z)); if (q) visPaths.set(i, q); });
  const visWorld = createLiftWorld(visPaths);
  for (const [index, site] of world.sites) {
    envelope.told = false; envelope.toldTree = false; envelope.ctx = 'loop';
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
    ok(!!net.byIndex.get(index), `${name}: rideable (every drawn lift is)`);
    for (const e of vis.ends) {
      const where = `${name} ${e.which ? 'top' : 'bottom'}`;
      const live = e.parts.filter((q) => !q.cut), standing = standingParts(e);
      const floating = live.filter((q) => !standing.has(q));
      ok(!floating.length, `${where}: no floating part (${floating.length} of ${live.length} stand on nothing)`);
      ok(wheelHeld(vis, e), `${where}: the bull-wheel is held (canopy, roof, mast or a column)`);
      const big = live.filter((q) => q.a1 - q.a0 > 60 || q.b1 - q.b0 > 30 || q.y1 - q.y0 > 25 || q.y1 > 26);
      ok(!big.length, `${where}: no part bigger than a station (${big.length})`);
      const has = (f) => live.some(f);
      const sharedRoof = () => { for (const [j, o] of visWorld.sites) { if (j === index) continue; for (const oe of o.ends) if (Math.hypot(oe.x - e.x, oe.z - e.z) < 30 && oe.parts.some((q) => q.roof && !q.cut)) return true; } return false; };
      const roofOk = has((q) => q.roof) || sharedRoof();
      const need = e.type === 'platform' ? [['canopy', roofOk], ['hut', has((q) => q.hut)]]
        : e.type === 'hall' || e.type === 'rail' ? [['roof', roofOk]]
          : e.type === 'terminal' ? [['roof', roofOk], ['machine house', has((q) => q.building) || sharedRoof()]]
            : e.type === 'hut' ? [['wheel mast', has((q) => q.post || q.mount)], ...(e.which === 0 && p.sub !== 'rope' ? [['hut', has((q) => q.hut)]] : [])] : [];
      for (const [what, there] of need) ok(there, `${where}: the ${e.type} has its ${what}`);
    }
    if (net.byIndex.get(index) && kind !== 'carpet') ok(vis.bottom.parts.some((q) => q.zoneMark), `${name}: the boarding zone is marked`);
    {
      // reachable: a clear 12 m way into the waiting spot from at least one side (no solid part, building, tree; walkable)
      let way = false;
      for (let k2 = 0; k2 < 24 && !way; k2++) {
        const h = (k2 / 24) * Math.PI * 2;
        let clear = true;
        for (let m = 1; m <= 12 && clear; m += 0.5) {
          const x = site.wait.x + Math.cos(h) * m, z = site.wait.z + Math.sin(h) * m;
          if (world.hit(x, z, SKIER_R, H(x, z), H) || world.inBuilding(x, z, 0.3) || tree(x, z)) clear = false;
        }
        const ex = site.wait.x + Math.cos(h) * 12, ez = site.wait.z + Math.sin(h) * 12;
        const sl = Math.hypot(H(ex + 2, ez) - H(ex - 2, ez), H(ex, ez + 2) - H(ex, ez - 2)) / 4;
        if (clear && sl < 0.7) way = true;
      }
      ok(way, `${name}: the boarding zone can be reached over the snow`);
    }
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
        const hb = buildingUnder(w.x, w.z, Math.max(cb.hw, cb.hl), w.y - cb.drop);
        if (hb) { ok(false, `${name}: a carrier at u ${u.toFixed(0)} (s ${w.s.toFixed(0)}) runs into a kept building (#${hb.name}, roof ${(hb.top - (w.y - cb.drop)).toFixed(1)} m over its bottom)`); break; }
        k.minPylon = Math.min(k.minPylon, e.pyl); k.minStation = Math.min(k.minStation, e.st); k.minTree = Math.min(k.minTree, e.tr);
        if (e.pyl <= 0 || e.st <= 0 || e.tr <= 0) { ok(false, `${name}: a carrier at u ${u.toFixed(0)} / ${p.loopLen.toFixed(0)} (s ${w.s.toFixed(0)}) touches a ${e.pyl <= 0 ? 'pylon' : e.st <= 0 ? 'station part' : 'tree'}`); break; }
      }
      // the return loop: carriers on the down lane, and the loop closes
      if (!p.shuttle) {
        const down = p.loopAt(p.len + Math.PI * p.wheelR + p.len / 2, {}), a = p.loopAt(p.loopLen - 0.01, {}), b = p.loopAt(0, {});
        if (ok(!down.up && Math.hypot(a.x - b.x, a.z - b.z) < 0.2, `${name}: the loop returns on the other side and closes`)) k.loops++;
        if (kind === 'drag') {
          const q = p.at(p.len / 2, {});
          const lat = p.sign * ((down.x - q.x) * -q.dz + (down.z - q.z) * q.dx);
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
    let worstAt = '';
    let prev = null, worst = 0, steps = 0, phases = [], minP = Infinity, minS = Infinity, minT = Infinity, dragWorst = 0, dragLat = Infinity;
    // after launch (Ian, 3V Tovets): chairs are boarded through an opening gate (detachable: onto a loading belt), the chair comes up
    // behind him and he sits as it arrives
    const CP = ride.chairPlan, CS = vis.chair, FB = vis.bottom, uLoadT = p.upU(ride.s);
    let gateBad = null, behindBad = null, tSit = null, tChair = null;
    if (kind === 'chair') {
      ok(!!CP && !!CS, `${name}: boarded through the chair plan`);
      if (CS && CS.detach) ok(FB.parts.some((q) => q.belt && !q.cut), `${name}: the loading belt is there (${p.seats}-seater)`);
      if (CS) ok(FB.parts.filter((q) => q.gateLeaf && !q.cut).length === 2, `${name}: the gate's two leaves are there`);
    }
    while (!ride.done && steps < 400000) {
      ride.step(1 / 60); steps++;
      if (phases[phases.length - 1] !== ride.phase) phases.push(ride.phase);
      const w = ride.where();
      if (CP && CS) {
        const l = FB.toLocal(w.x, w.z, {});
        if (ride.phase === 'board' && !gateBad && Math.abs(l.a - CS.aGate) < CS.gateHalf + 0.3 && Math.abs(l.b - CS.bGate) < 0.5 && ride.gate < 0.95) gateBad = `${ride.gate.toFixed(2)} open at t ${ride.t.toFixed(2)}`;
        if (tSit === null && w.pose === 'sit') tSit = ride.t;
        if (tChair === null && ride.carrierU !== null && ride.carrierU >= uLoadT - 0.02) tChair = ride.t;
        if (ride.phase === 'board' && !behindBad && ride.t < CP.tSit0 && Math.abs(l.b - CS.bRider) < 0.5) {
          const lc = FB.toLocal(w.cx, w.cz, {});
          if (Math.abs(lc.b - CS.bRider) < 1.6 && lc.a < l.a + 0.8 && lc.a > l.a - 6) behindBad = `chair ${(lc.a - l.a).toFixed(2)} m behind him at t ${ride.t.toFixed(2)}`;
        }
      }
      if (prev) { const j = Math.hypot(w.x - prev.x, w.z - prev.z); if (j > worst) { worst = j; worstAt = `${ride.phase} s ${w.s === undefined ? '-' : w.s.toFixed(0)} pose ${w.pose}`; } }
      prev = { x: w.x, z: w.z };
      if (steps % 3) continue;
      // the rider's envelope: on the ground a skier (0.35 m, 1.8 m tall); on a chair / in a cabin the carrier's own box
      const onC = w.onCarrier;
      envelope.ctx = `${ride.phase} pose ${w.pose}`;
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
        dragLat = Math.min(dragLat, p.sign * ((w.x - q.x) * -q.dz + (w.z - q.z) * q.dx));
      }
    }
    ok(ride.done && phases.join() === 'board,ride,alight,done', `${name}: one boarding, one ride, off at the top (${phases.join(' > ')})`);
    if (CP && CS) {
      ok(!gateBad, `${name}: through the gate only when it is open${gateBad ? ` (${gateBad})` : ''}`);
      ok(!behindBad, `${name}: his chair comes up behind him${behindBad ? ` (${behindBad})` : ''}`);
      ok(tSit !== null && tChair !== null && Math.abs(tSit - tChair) <= 0.3, `${name}: sits as the chair arrives (sit ${tSit === null ? '-' : tSit.toFixed(2)} s, chair ${tChair === null ? '-' : tChair.toFixed(2)} s)`);
    }
    ok(worst < 1.2, `${name}: no jump (worst ${worst.toFixed(2)} m per frame at x4, ${worstAt})`);
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
    const good = !ex.fallback && !world.inStation(ex.x, ex.z, 1.5) && !world.inBuilding(ex.x, ex.z, 1.5) && !world.inLowLane(ex.x, ex.z, H, 3) && sl < 1.0 && a.water < 0.3 && ahead < back + 0.5 && clear;
    if (ok(good, `${name}: exit ${ex.dist.toFixed(0)} m out, outside stations / buildings / lanes, slope ${sl.toFixed(2)}, water ${a.water.toFixed(2)}, ${ahead < back + 0.5 ? 'downhill' : 'UPHILL'}, ${clear ? '15 m clear' : 'BLOCKED ahead'}${ex.fallback ? ', FALLBACK' : ''}`)) k.exits++;
    // R8 (early QA, Zermatt / Arlberg: summit exits where he slid off a cliff): a gentle spot (<= 25 deg, <= 31 on the tightest summits),
    // no drop ahead (the ground over the next 40 m never falls steeper than 40 deg on average from the spot), and the physics: standing
    // there 5 s without input he stays at 0 km/h; pushing off and letting run for 6 s (light brake) he does not crash
    let drop = 0;
    for (let m = 5; m <= 40; m += 5) drop = Math.max(drop, (g(ex.x, ex.z) - g(ex.x + Math.cos(ex.heading) * m, ex.z + Math.sin(ex.heading) * m)) / m);
    ok(sl <= (ex.steep ? 0.6 : 0.47) + 1e-9 && drop <= 0.84, `${name}: exit slope ${sl.toFixed(2)} (<= ${ex.steep ? 0.6 : 0.47}), steepest drop ahead ${drop.toFixed(2)} (<= 0.84)`);
    const W = { height: H, normal: (x, z, o) => surface.normal(x, z, o), snow: () => 1, hit: () => null };
    let st = createSkierState(ex.x, ex.z, ex.heading, H(ex.x, ex.z));
    const none = { steer: 0, tuck: 0, brake: 0, push: 0, jump: false };
    for (let i = 0; i < 5 / SKI.dt; i++) st = stepSkier(st, none, W);
    ok(st.speed < 0.05 && Math.hypot(st.x - ex.x, st.z - ex.z) < 0.1 && st.crash === 0, `${name}: 5 s at the exit with no input: ${(st.speed * 3.6).toFixed(1)} km/h, moved ${Math.hypot(st.x - ex.x, st.z - ex.z).toFixed(2)} m`);
    let crashed = false, vmax = 0;
    for (let i = 0; i < 6 / SKI.dt; i++) { st = stepSkier(st, i < 1 / SKI.dt ? { ...none, push: 1 } : { ...none, brake: 0.4 }, W); crashed = crashed || st.crash > 0; vmax = Math.max(vmax, st.speed); }
    ok(!crashed && vmax < 16, `${name}: off from the exit (push, then a light brake, 6 s): ${crashed ? 'CRASH' : 'no crash'}, top ${(vmax * 3.6).toFixed(0)} km/h`);
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
