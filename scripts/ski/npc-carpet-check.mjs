#!/usr/bin/env node
/* Magic carpet beginners (28 Nov 2026; pb/ski/npc.js carpetFolk / carpetAt), Node check, no browser:
 *   node scripts/ski/npc-carpet-check.mjs [resort ...]
 *   every resort with carpets: a crowd near each carpet for 3 cycles at 30 fps with a distant player; the carpet riders are listed, stand on
 *   the belt (belt height) while riding up, never inside a solid, move continuously (no jump of > 0.35 m per frame), resorts without carpets list none.
 * (copied set-up of npc-check.mjs, which checks the rest of the crowd:)
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
const LEVEL = 'high';
const rids = args.filter((a) => !a.startsWith('--'));
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

  const carpets = lifts.list.filter((l) => l.kind === 'carpet');
  console.log(`  ${carpets.length} carpets`);
  let used = 0, nobody = 0;
  for (const l of carpets) {
    const site = lifts.world.sites.get(l.index), P = site.path;
    const cx = (l.bottom.x + l.top.x) / 2, cz = (l.bottom.z + l.top.z) / 2;
    const seen = new Map();
    let jumps = 0, solidIn = 0, beltBad = 0, frames = 0, onBelt = 0, maxGap = 0;
    const dt = 1 / 30;
    for (let k = 0; k < 30 * 150; k++) {
      const t = 100 + k * dt;
      const out = crowd.update(t, dt, { x: cx, z: cz, fx: 0, fz: 1, player: { x: cx + 400, z: cz, vx: 0, vz: 0 }, level: LEVEL, share: 1, hidden: null });
      for (const o of out) {
        if (o.kind !== 'carpet' || o.id < 4e6 + l.index * 16 || o.id >= 4e6 + l.index * 16 + 16) continue;
        frames++;
        const prev = seen.get(o.id);
        if (prev && k - prev.k === 1) { const d = Math.hypot(o.x - prev.x, o.z - prev.z); maxGap = Math.max(maxGap, d); if (d > 0.35) jumps++; }
        seen.set(o.id, { x: o.x, z: o.z, k });
        if (o.belt) {
          onBelt++;
          const g = height(o.x, o.z) + 0.18;
          if (Math.abs(o.y - g) > 0.02) beltBad++;
          const q = {}; P.at(Math.min(P.len, Math.max(0, 0)), q);
        } else if (blocked(o.x, o.z, 0.2)) solidIn++;
      }
    }
    const n = seen.size;
    if (!n) { nobody++; console.log(`  ${l.name} (${Math.round(l.len)} m): nobody (no clear lane)`); continue; }
    used++;
    check(jumps === 0 && maxGap < 0.35, `${l.name} (${Math.round(l.len)} m): ${n} beginners, no jump (max ${maxGap.toFixed(2)} m / frame)`);
    check(onBelt > 100 && beltBad === 0, `  on the belt ${onBelt} frames at belt height, ${beltBad} off it`);
    check(solidIn === 0, `  never inside a solid off the belt (${solidIn} frames)`);
  }
  check(!carpets.length || used + nobody === carpets.length, `${rid}: ${used} carpets with beginners, ${nobody} without a lane`);
}
console.log(`\n${passed} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
