#!/usr/bin/env node
/* The other skiers (pb/ski/npc.js), Node checks over EVERY resort (no browser):
 *   node scripts/ski/npc-check.mjs [resort ...] [--level low|medium|high] [--spots N]
 *   where      at N spots per resort (the first lift's boarding zone, lift tops, piste middles, village streets) the crowd is run for 20 s
 *              of game time at 30 fps with a player skiing down the nearest piste: every listed skier on his piste (inside its half
 *              width), every queue at its lift's bottom station (not in the boarding zone, the gate, the belt or the lane), every
 *              walker on his street
 *   never      inside a house, a station part, a pylon, a tree or a race net; a skier never in a station footprint; no two closer
 *              than their bodies; never inside the player (the bump of collide() is soft: he is pushed out, never a crash)
 *   lifts      every carrier keeps its id (npc.js carrierId over lifts.js's lattice) from the bottom to the top; riders <= seats, seated
 *              inside the chair's width / standing inside the cabin; the same carrier gives the same riders (deterministic)
 *   seed       the same seed gives the same positions frame by frame; another seed other positions
 *   challenge  with a running challenge's corridor (corridorOf) nobody is listed in it and nobody skis its piste
 *   time       the update's CPU time (Node, unthrottled) per frame
 * Exit code 1 on a failed check. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', 'pb', 'ski');
const imp = (p) => import(path.join(root, p));
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { createSurface } = await imp('surface.js');
const { createScatter } = await imp('scatter.js');
const { createPisteSet } = await imp('pistes.js');
const { createLiftNet } = await imp('modes/freeride.js');
const { createParkLayout } = await imp('modes/park.js');
const { firstLift } = await imp('modes/clear.js');
const { unpackResort } = await imp('linepack.js');
const { housesOnStreets, decodeRoads } = await imp('roads.js');
const { buildingBoxes, createBoxIndex } = await imp('look.js');
const { liftTreeGuard } = await imp('lift-site.js');
const { createLiftPath, chairWidth, carrierBox } = await imp('lift-path.js');
const { createCrowd, corridorOf, carrierId, strHash, POSE, BOARD_POSE } = await imp('npc.js');
const { NPC } = await imp('config.js');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LEVEL = opt('--level', 'high'), SPOTS = Number(opt('--spots', '8'));
const rids = args.filter((a, i) => !a.startsWith('--') && !['--level', '--spots'].includes(args[i - 1]));
const ALL = ['killy', '3vallees', 'zermatt', 'arlberg', 'kronplatz', 'vialattea', 'obertauern', 'livigno', 'davos', 'laax', 'soelden'];
let failed = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`); return ok; };
const summary = [];

for (const rid of rids.length ? rids : ALL) {
  const T0 = Date.now();
  console.log(`\n== ${rid}`);
  const dir = path.join(root, 'data', rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`)))));
  const surface = createSurface(field);
  const height = (x, z) => surface.height(x, z);
  const scatter = createScatter(field, { guard: liftTreeGuard(resort, createLiftPath, field.farHeight) });
  const pistes = createPisteSet(resort);
  const lifts = createLiftNet(resort, (x, z) => field.farHeight(x, z), pistes);
  // like main.js: the stations replace the OSM station buildings, a house a street runs through is not drawn
  const buildingRows = JSON.parse(fs.readFileSync(path.join(dir, 'buildings.json'), 'utf8'));
  const liftWorld = lifts.setBuildings(buildingRows);
  const roadRows = decodeRoads(JSON.parse(fs.readFileSync(path.join(dir, 'roads.json'), 'utf8')));
  const onStreet = housesOnStreets(buildingRows, roadRows);
  const drawn = buildingRows.filter((_, i) => liftWorld.keepBuilding(i) && !onStreet.has(i));
  const boxIndex = createBoxIndex(buildingBoxes(drawn));
  const density = 1;                                                      // Héich's trees (the most)
  const blocked = (x, z, r) => !!(scatter.hit(x, z, r, -1e9, density) || lifts.world.hit(x, z, r) || boxIndex.hit(x, z, r));
  const deck = (x, z) => lifts.world.deckTop(x, z, (gx, gz) => field.height(gx, gz));
  const standY = (x, z) => Math.max(height(x, z), deck(x, z));
  const make = (seed) => { const c = createCrowd({ resort, pistes, liftNet: lifts, height, standY, seed }); c.setBlocked(blocked); c.setRoads(roadRows); return c; };
  const seed = strHash(rid);
  const crowd = make(seed);
  const nets = crowd.netIndex();

  // ---- the spots: the first lift, lift tops, piste middles, a village street ----
  const spots = [];
  const first = firstLift(rid, lifts, resort.places);
  { const w = lifts.boardAt(first); spots.push({ name: `first lift ${first.name}`, x: w.x, z: w.z }); }
  let rs = 99;
  const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
  const bigLifts = lifts.list.filter((l) => l.kind === 'chair' || l.kind === 'gondola');
  for (let i = 0; i < Math.max(1, SPOTS / 4); i++) { const l = bigLifts[Math.floor(rnd() * bigLifts.length)]; if (l) spots.push({ name: `top of ${l.name}`, x: l.top.x, z: l.top.z }); }
  for (let i = 0; i < Math.max(1, SPOTS / 4); i++) { const l = bigLifts[Math.floor(rnd() * bigLifts.length)]; if (l) { const w = lifts.boardAt(l); spots.push({ name: `bottom of ${l.name}`, x: w.x + 6, z: w.z + 6 }); } }
  const busy = pistes.list.filter((p) => p.diff === 'blue' || p.diff === 'green');
  for (let i = 0; i < Math.max(2, SPOTS / 2); i++) { const p = busy[Math.floor(rnd() * busy.length)] || pistes.list[0]; const a = p.at(p.length * (0.2 + rnd() * 0.6), {}); spots.push({ name: `on ${p.name}`, x: a.x, z: a.z }); }
  const town = (resort.places || []).find((p) => p.kind === 'town' || p.kind === 'village');
  if (town) spots.push({ name: `in ${town.name}`, x: town.x, z: town.z });

  // ---- run the crowd at each spot ----
  const bad = { piste: [], solid: [], station: [], overlap: [], player: [], zone: [], queue: [], walk: [] };
  let frames = 0, ms = 0, maxListed = 0, kinds = { ski: 0, queue: 0, walk: 0, line: 0 }, poses = new Set(), bumps = 0, minPair = Infinity, minPlayer = Infinity;
  const DT = 1 / 30, FR = 600;
  const zoneOf = new Map(lifts.list.map((l) => [l.index, lifts.world.sites.get(l.index)]));
  for (const sp of spots) {
    crowd.reset();
    // the player: from the spot down the nearest piste at 9 m/s (a real skier's pace), or standing (village)
    const n = pistes.nearest(sp.x, sp.z, 300);
    let player = { x: sp.x, z: sp.z, vx: 0, vz: 0, heading: 0, speed: 0, y: height(sp.x, sp.z), crash: 0, ride: '' };
    let ps = n ? n.proj.s : 0;
    const t0 = 1000 + rnd() * 500;
    for (let f = 0; f < FR; f++) {
      const t = t0 + f * DT;
      if (n && !sp.name.startsWith('in ')) {
        const before = n.piste.at(ps, {});
        ps = Math.min(n.piste.length, ps + 9 * DT);
        const a = n.piste.at(ps, {});
        const vx = (a.x - before.x) / DT, vz = (a.z - before.z) / DT;
        const next = { ...player, x: a.x, z: a.z, vx, vz, speed: Math.hypot(vx, vz), heading: Math.atan2(vz, vx) };
        const out = crowd.collide(player, next);
        if (out !== next) bumps++;
        player = out;
      }
      const t1 = performance.now();
      const list = crowd.update(t, DT, { x: player.x, z: player.z, player, level: LEVEL, share: 1, bandBudget: 400 });
      ms += performance.now() - t1; frames++;
      maxListed = Math.max(maxListed, list.length);
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        kinds[o.kind]++; poses.add(o.poseA); poses.add(o.poseB);
        const tag = `${sp.name} t${f}: ${o.kind} ${o.id} at ${o.x.toFixed(1)},${o.z.toFixed(1)}`;
        if (o.kind === 'ski') {
          const pr = o.piste.project(o.x, o.z, o.s, 60, {});
          if (pr.dist > o.piste.halfWidth + 0.3) bad.piste.push(`${tag} ${pr.dist.toFixed(1)} m off ${o.piste.id} (hw ${o.piste.halfWidth})`);
          if (lifts.world.inStation(o.x, o.z, 0)) { bad.station.push(tag); if (process.env.NPC_DEBUG) { const st = o.st; const pr = o.piste.project(o.x, o.z, o.s, 60, {}); console.log('DBG', o.piste.id, 's', o.s.toFixed(1), 'off', o.off.toFixed(2), 'proj', pr.off.toFixed(2), pr.s.toFixed(1), 'av', st.av.toFixed(2), 'stop', o.stop, 'solid?', crowd.solid(o.x, o.z, 0.45)); } }
          if (lifts.world.boardingAt(o.x, o.z) !== null) bad.zone.push(tag);
        }
        if (o.kind === 'queue') {
          const site = zoneOf.get(Math.floor((o.id - 2e6) / 64));
          if (!site) bad.queue.push(`${tag} no lift`);
          else {
            const l = site.bottom.toLocal(o.x, o.z, {}), bOut = site.path.side + site.path.carrier.hw + 0.6;
            if (site.inZone(o.x, o.z) || l.b < bOut + 0.5 || Math.hypot(o.x - site.wait.x, o.z - site.wait.z) > 25) bad.queue.push(`${tag} b ${l.b.toFixed(1)} (lane to ${bOut.toFixed(1)}), ${Math.hypot(o.x - site.wait.x, o.z - site.wait.z).toFixed(0)} m from the zone`);
            if (lifts.world.boardingAt(o.x, o.z) !== null) bad.zone.push(tag);
          }
        }
        if (o.kind === 'walk' && blocked(o.x, o.z, 0.3)) bad.walk.push(tag);
        // (lift lines: they walk under a chair station's canopy to the loading line, so the parts count at their height)
        const stationHit = o.kind === 'line' ? lifts.world.hit(o.x, o.z, 0.3, o.y + 0.05, height, 1.6) : lifts.world.hit(o.x, o.z, 0.3);
        if (scatter.hit(o.x, o.z, 0.3, -1e9, density) || stationHit || boxIndex.hit(o.x, o.z, 0.2) || nets.near(o.x, o.z, 0.5)) bad.solid.push(tag);
        for (let j = i + 1; j < list.length; j++) {
          const q = list[j], d = Math.hypot(q.x - o.x, q.z - o.z);
          minPair = Math.min(minPair, d);
          // (lift lines: a group side by side at its chair's loading line / the door 0.38 m, passing in the line 0.6 m: queue-check.mjs)
          const lim = o.kind === 'line' && q.kind === 'line' ? (Math.floor(o.id / 8) === Math.floor(q.id / 8) ? 0.38 : 0.6) : NPC.bodyR * 2 - 0.05;
          if (d < lim) bad.overlap.push(`${tag} vs ${q.kind} ${q.id}: ${d.toFixed(2)} m`);
        }
        const dp = Math.hypot(player.x - o.x, player.z - o.z);
        minPlayer = Math.min(minPlayer, dp);
        // (lift lines stand between ropes: this scripted player skis straight through a maze, the bump pushes him out)
        if (dp < NPC.bodyR + NPC.playerR - 0.12 && o.kind !== 'line') bad.player.push(`${tag}: ${dp.toFixed(2)} m from the player`);
      }
    }
  }
  const show = (k) => (bad[k].length ? ` e.g. ${bad[k].slice(0, 2).join(' | ')}` : '');
  const total = kinds.ski + kinds.queue + kinds.walk + kinds.line;
  check(total > 0 && kinds.ski > 0, `${spots.length} spots x ${FR} frames (${LEVEL}): ${kinds.ski} skier, ${kinds.queue} queue, ${kinds.walk} walker, ${kinds.line} lift-line draws, up to ${maxListed} at once, poses ${[...poses].sort((a, b) => a - b).join(',')}`);
  // (lift lines: whole mazes up to `lines`, the nearest one always: a 6-seater's full maze ~45)
  check(maxListed <= NPC.levels[LEVEL].skiers + NPC.levels[LEVEL].queue + NPC.levels[LEVEL].walkers + Math.max(NPC.levels[LEVEL].lines, 48), `never more than the level's cap (${maxListed})`);
  check(!bad.piste.length, `every skier inside his piste's half width (${bad.piste.length} out)${show('piste')}`);
  check(!bad.solid.length, `never in a house, station part, pylon, tree or race net (${bad.solid.length})${show('solid')}`);
  check(!bad.station.length && !bad.zone.length, `no skier in a station footprint / boarding zone (${bad.station.length} / ${bad.zone.length})${show('station')}${show('zone')}`);
  check(!bad.queue.length, `every queue at its station, out of the zone, the gate, the belt and the lane (${bad.queue.length})${show('queue')}`);
  check(!bad.walk.length, `every walker on a clear street (${bad.walk.length})${show('walk')}`);
  check(!bad.overlap.length, `no two skiers inside each other (closest pair ${minPair.toFixed(2)} m, ${bad.overlap.length} overlaps)${show('overlap')}`);
  check(!bad.player.length, `nobody inside the player (closest ${minPlayer.toFixed(2)} m, ${bumps} soft bumps)${show('player')}`);
  const perFrame = ms / frames;
  check(perFrame < 1.5, `update ${perFrame.toFixed(3)} ms / frame (Node, unthrottled; first bands built in it)`);

  // ---- determinism ----
  {
    const run = (c, sd) => {
      const out = [];
      const sp = spots[0];
      for (let f = 0; f < 120; f++) {
        const list = c.update(500 + f * DT, DT, { x: sp.x, z: sp.z, player: null, level: LEVEL, share: 1, bandBudget: 1e9 });
        out.push(list.map((o) => `${o.id}:${o.x.toFixed(3)},${o.z.toFixed(3)},${o.heading.toFixed(3)}`).join(';'));
      }
      return out.join('|');
    };
    const a = run(make(seed)), b = run(make(seed)), c = run(make(seed + 1));
    check(a === b && a.length > 0, `the same seed: the same positions frame by frame (${a.split('|')[0].split(';').length} listed)`);
    check(a !== c, 'another seed: other positions');
  }

  // ---- lifts: carrier ids along the loop, riders ----
  {
    let carriers = 0, idBreaks = 0, seatBad = 0, riderTotal = 0, riderDet = 0, over = 0, boardRiders = 0, chairRiders = 0;
    for (const l of lifts.list) {
      const p = lifts.paths.get(l.index);
      if (!p || p.shuttle || !(p.spec.gap > 0) || p.kind === 'carpet' || (p.kind === 'drag' && p.sub === 'rope')) continue;
      const offset = (l.index * 7.31) % 50, gap = p.spec.gap;           // lifts.js createLifts: l.offset, the lattice of its loop
      const at = (t) => { const A = t * p.spec.speed + offset, ph = ((A % gap) + gap) % gap, out = []; for (let u = ph; u < p.loopLen - 1e-6; u += gap) out.push({ u, id: carrierId(u, A, gap) }); return out; };
      let prev = at(0);
      for (let t = 0.5; t <= 40; t += 0.5) {
        const now = at(t);
        for (const c of prev) {
          if (c.u + p.spec.speed * 0.5 >= p.loopLen - 1e-3) continue;      // went round the bottom wheel
          const nx = now.find((q) => Math.abs(q.u - (c.u + p.spec.speed * 0.5)) < 1e-3);
          if (!nx || nx.id !== c.id) idBreaks++;
        }
        prev = now;
      }
      for (const c of at(10)) {
        if (c.u > p.len) continue;
        carriers++;
        const n = crowd.riders(l.index, c.id, p.kind, p.seats, p.sub, 1);
        const rows = crowd.riderBuf.slice(0, n).map((r) => ({ ...r }));
        const again = crowd.riders(l.index, c.id, p.kind, p.seats, p.sub, 1);
        if (again !== n || crowd.riderBuf.slice(0, n).some((r, i) => r.b !== rows[i].b || r.outfit !== rows[i].outfit)) riderDet++;
        riderTotal += n;
        if (p.kind === 'chair') {
          if (n > (p.seats || 4)) over++;
          chairRiders += n;
          const W = chairWidth(p.seats);
          for (const r of rows) { if (Math.abs(r.b) > W / 2 - 0.1 || r.pose % BOARD_POSE !== POSE.sit) seatBad++; if (r.pose >= BOARD_POSE) boardRiders++; }
          const bs = rows.map((r) => r.b).sort((x, y) => x - y);
          for (let i = 1; i < bs.length; i++) if (bs[i] - bs[i - 1] < 0.4) seatBad++;
        } else if (p.kind === 'gondola') {
          const box = carrierBox('gondola', p.seats, p.sub);
          for (const r of rows) if (Math.abs(r.b) > box.hw - 0.15 || Math.abs(r.a) > box.hl - 0.1) seatBad++;
        } else if (p.kind === 'drag' && n > 1) over++;
      }
    }
    check(idBreaks === 0, `every loop carrier keeps its id round the up lane and the top (${idBreaks} breaks over 40 s)`);
    check(seatBad === 0 && over === 0 && riderDet === 0, `riders: ${riderTotal} on ${carriers} carriers going up, ${seatBad} badly seated, ${over} over the seats, ${riderDet} not deterministic`);
    // 28 Nov 2026: some ride a snowboard (seated with the board, BOARD_POSE + sit): about NPC.boardShare of the chair riders
    check(!chairRiders || (boardRiders > chairRiders * 0.1 && boardRiders < chairRiders * 0.32), `snowboarders on the chairs: ${boardRiders} of ${chairRiders}`);
    // the jig-back cable cars carry a crowd too
    const cab = lifts.list.find((l) => l.kind === 'cable');
    if (cab) { const p = lifts.paths.get(cab.index); const n = crowd.riders(cab.index, 0, 'cable', p.seats, p.sub, 1); const box = carrierBox('cable'); check(n >= 4 && crowd.riderBuf.slice(0, n).every((r) => Math.abs(r.a) < box.hl && Math.abs(r.b) < box.hw), `cable car ${cab.name}: ${n} standing inside the cabin`); }
  }

  // ---- a running challenge: nobody in its corridor, nobody on its piste ----
  {
    const p = busy[3] || pistes.list[0];
    const hidden = corridorOf(p, 2, p.length - 20);
    let inside = 0, onIt = 0, listed = 0;
    crowd.reset();
    for (let f = 0; f < 240; f++) {
      const a = p.at(Math.min(p.length, (f / 240) * p.length), {});
      const list = crowd.update(2000 + f * DT, DT, { x: a.x, z: a.z, player: null, level: LEVEL, share: 1, hidden, skipPiste: p, bandBudget: 400 });
      listed += list.length;
      for (const o of list) { if (hidden(o.x, o.z)) inside++; if (o.piste === p) onIt++; }
    }
    check(inside === 0 && onIt === 0, `challenge on ${p.name}: ${inside} listed in its corridor, ${onIt} skiing it (${listed} draws around it)`);
  }
  summary.push(`${rid}: ${(Date.now() - T0) / 1000 | 0} s, ${perFrame.toFixed(3)} ms/frame, max ${maxListed}`);
}
console.log(`\n${summary.join('\n')}\nnpc-check: ${passed} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
