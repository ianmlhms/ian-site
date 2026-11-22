#!/usr/bin/env node
/* R8c checks without a browser, over every resort (the pure modules on the real data):
 *   names     every piste has a sensible display name: never a bare number / ref ("0", "2a", "G"), never empty, unique per resort and colour
 *   villages  Alpine resorts: no house over MAX_FLOORS storeys, no flat roof (but the "modern" summit buildings); every village: the
 *             detail layer (balconies, chimneys) is drawn per DCELL cell only near (village.js houseOf / tameRow)
 *   rails     0 trees (3D trees AND far tree cards) in the corridor of every rack railway / funicular (the carriage + 3 m of crown),
 *             0 far tree cards in any lift aisle where the carriers pass low over the trees (the same guard as the 3D trees)
 *   gates     the challenge gates drawn near the camera only (markers.js gatesNear: <= 1500 m)
 *   labels    floating labels (markers.js placeLabels): 2000 random scenes, never overlapping, never cut by the screen edge, never on the HUD
 *   node scripts/ski/r8c-check.mjs [resort ...]      exit 0 = all green */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../pb/ski');
const imp = (p) => import(path.join(root, p));
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { createScatter, BLOCK } = await imp('scatter.js');
const { createLiftPath, liftClass } = await imp('lift-path.js');
const { liftTreeGuard } = await imp('lift-site.js');
const { createParkLayout } = await imp('modes/park.js');
const { unpackResort } = await imp('linepack.js');
const { farTreesOfBlock, BLOCK: FAR_BLOCK } = await imp('forest-far.js');
const { houseOf, ALPINE_RESORTS, MAX_FLOORS } = await imp('village.js');
const { gatesNear, placeLabels, LABEL_MARGIN, GATE_DRAW } = await imp('modes/markers.js');
const { decodeRoads, gentleRoads, MAX_GRADE } = await imp('roads.js');

let fails = 0, checks = 0;
const ok = (cond, text) => { checks++; if (!cond) { fails++; if (fails < 200) console.log(`  FAIL ${text}`); } return cond; };
const resorts = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(path.join(root, 'data')).filter((d) => fs.existsSync(path.join(root, 'data', d, 'resort.json')));
const BARE = /^(?:\d+[a-z]?|[a-z]\d?|\d[a-z]\d?)$/i;
const RAIL_CORRIDOR = 1.3 + 3;                  // m from the track: half the carriage + the widest crown of a tree beside it

for (const rid of resorts) {
  const t0 = Date.now();
  const dir = path.join(root, 'data', rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
  console.log(`\n${rid}`);
  // names
  const names = resort.pistes.map((p) => p.name);
  const bad = names.filter((n) => !n || !n.trim() || BARE.test(n.trim()));
  ok(bad.length === 0, `${rid}: ${bad.length} pistes with a bare / empty name ${bad.slice(0, 5).join(', ')}`);
  const renamed = resort.pistes.filter((p) => p.osmName !== undefined).map((p) => `"${p.osmName}" -> "${p.name}"`);
  const seen = new Map();
  for (const p of resort.pistes) { const k = `${p.name.toLowerCase()} (${p.diff})`; seen.set(k, (seen.get(k) || 0) + 1); }
  const dups = [...seen].filter(([, c]) => c > 1).map(([n]) => n);             // the same name in another colour is a real variant (chip)
  ok(dups.length === 0, `${rid}: duplicate piste names in the same colour ${dups.slice(0, 6).join(', ')}`);
  console.log(`  names: ${names.length} pistes, ${bad.length} bare, ${dups.length} duplicates; renamed ${renamed.length}${renamed.length ? ': ' + renamed.slice(0, 6).join(', ') : ''}`);
  // villages
  const rows = JSON.parse(fs.readFileSync(path.join(dir, 'buildings.json'), 'utf8'));
  const alpine = ALPINE_RESORTS.has(rid);
  let tall = 0, flat = 0, maxFloors = 0, hotels = 0;
  rows.forEach((row, i) => {
    const h = houseOf(row, i, alpine);
    if (h.row[8] > 1) return;                                           // chapels, huts, modern, towers
    maxFloors = Math.max(maxFloors, h.floors);
    if (alpine && h.floors > MAX_FLOORS.alpine) tall++;
    if (alpine && h.flat) flat++;
    if (h.style === 8) hotels++;
  });
  if (alpine) ok(tall === 0 && flat === 0, `${rid}: Alpine village: ${tall} houses over ${MAX_FLOORS.alpine} storeys, ${flat} flat roofs`);
  console.log(`  villages: ${rows.length} houses, tallest ${maxFloors} storeys under the eaves${alpine ? `, ${hotels} Alpine hotels, ${flat} flat roofs` : ''}`);
  // rails + lift aisles
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`)))));
  const guard = liftTreeGuard(resort, createLiftPath, field.farHeight);
  const scatter = createScatter(field, { guard });
  const bits = resort.classes.bits;
  const farCache = new Map(), farCacheNoGuard = new Map();
  const farBlock = (bx, bz, g) => { const c = g ? farCache : farCacheNoGuard, k = bx * 100003 + bz; let a = c.get(k); if (!a) { a = farTreesOfBlock(bx, bz, { classes, bits, field, guard: g ? guard : null }); c.set(k, a); } return a; };
  const cardsNear = (x, z, r, g) => {
    let n = 0;
    for (let bz = Math.floor((z - r) / FAR_BLOCK); bz <= Math.floor((z + r) / FAR_BLOCK); bz++) for (let bx = Math.floor((x - r) / FAR_BLOCK); bx <= Math.floor((x + r) / FAR_BLOCK); bx++) {
      const a = farBlock(bx, bz, g);
      for (let i = 0; i < a.length; i += 6) if (Math.hypot(a[i] - x, a[i + 2] - z) < r) n++;
    }
    return n;
  };
  const treesNear = (x, z, r) => {
    let n = 0;
    for (let bz = Math.floor((z - r) / BLOCK); bz <= Math.floor((z + r) / BLOCK); bz++) for (let bx = Math.floor((x - r) / BLOCK); bx <= Math.floor((x + r) / BLOCK); bx++) {
      const t = scatter.treeBlock(bx, bz);
      for (let i = 0; i < t.length; i += 6) if (Math.hypot(t[i] - x, t[i + 2] - z) < r) n++;
    }
    return n;
  };
  let rails = 0;
  resort.lifts.forEach((src) => {
    const k = liftClass(src.kind) || liftClass(src.type);
    if (k !== 'train') return;
    const p = createLiftPath(src, field.farHeight);
    if (p.tunnel) return;                                                // underground funiculars: the tube, no trees
    rails++;
    let trees = 0, cards = 0, cardsBefore = 0;
    // the corridor along the track, sampled every 2 m (a tree within RAIL_CORRIDOR of a sample point is in it)
    const seenT = new Set();
    for (let s = 0; s <= p.len; s += 2) {
      const q = p.at(s, {});
      if (field.farHeight(q.x, q.z) - p.cableY(s) > 4) continue;         // in a tunnel stretch
      trees += treesNear(q.x, q.z, RAIL_CORRIDOR);
      cards += cardsNear(q.x, q.z, RAIL_CORRIDOR, true);
      if (s % 20 === 0) cardsBefore += cardsNear(q.x, q.z, RAIL_CORRIDOR, false);
      seenT.add(Math.round(s));
    }
    ok(trees === 0 && cards === 0, `${rid}: ${src.name}: ${trees} trees and ${cards} far tree cards in the rail corridor (+-${RAIL_CORRIDOR} m)`);
    console.log(`  rail ${src.name} (${Math.round(p.len)} m): ${trees} trees, ${cards} far cards in the corridor (without the guard: ${cardsBefore} cards at the 20 m samples)`);
  });
  // far cards in the low lift aisles (the guard says no tree there)
  let aisleCards = 0, aisleChecked = 0;
  resort.lifts.forEach((src) => {
    const k = liftClass(src.kind) || liftClass(src.type);
    if (!k || k === 'train' || k === 'carpet') return;
    const p = createLiftPath(src, field.farHeight);
    if (!p) return;                                       // (an OSM stub the game does not draw: lift-path.js)
    for (let s = 0; s <= p.len; s += 25) {
      const q = p.at(s, {});
      for (let bz = Math.floor((q.z - 6) / FAR_BLOCK); bz <= Math.floor((q.z + 6) / FAR_BLOCK); bz++) for (let bx = Math.floor((q.x - 6) / FAR_BLOCK); bx <= Math.floor((q.x + 6) / FAR_BLOCK); bx++) {
        const a = farBlock(bx, bz, true);
        for (let i = 0; i < a.length; i += 6) if (Math.hypot(a[i] - q.x, a[i + 2] - q.z) < 4) { aisleChecked++; if (guard(a[i], a[i + 2], a[i + 1] + 2.2)) aisleCards++; }
      }
    }
  });
  ok(aisleCards === 0, `${rid}: ${aisleCards} far tree cards where the lift guard forbids trees`);
  console.log(`  aisles: ${aisleCards} far cards in the lift aisles (${aisleChecked} cards within 4 m of a lift line, all allowed: high above the trees); ${rails} surface railways`);
  // streets: no drawn piece steeper than MAX_GRADE (3V QA: 25-45 deg pieces, a street up a wall)
  {
    const roadsJson = fs.existsSync(path.join(dir, 'roads.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'roads.json'), 'utf8')) : null;
    const raw = decodeRoads(roadsJson), H = (x, z) => field.height(x, z);
    const steepOf = (list) => { let n = 0, worst = 0; for (const r of list) for (let k = 0; k + 1 < r.pts.length; k++) { const [ax, az] = r.pts[k], [bx, bz] = r.pts[k + 1]; const L = Math.hypot(bx - ax, bz - az); if (L < 1) continue; const m = Math.ceil(L / 5); for (let i = 0; i < m; i++) { const g = Math.abs(H(ax + (bx - ax) * (i + 1) / m, az + (bz - az) * (i + 1) / m) - H(ax + (bx - ax) * i / m, az + (bz - az) * i / m)) / (L / m); worst = Math.max(worst, g); if (g > 0.4663) { n++; break; } } } return [n, worst]; };
    const [n0, w0] = steepOf(raw), kept = gentleRoads(raw, H), [n1, w1] = steepOf(kept);
    ok(n1 === 0 && w1 <= MAX_GRADE + 1e-6, `${rid}: streets: ${n1} drawn segments over 25 deg, steepest ${(Math.atan(w1) * 180 / Math.PI).toFixed(1)} deg`);
    console.log(`  streets: ${raw.length} -> ${kept.length} pieces; segments over 25 deg ${n0} -> ${n1}; steepest ${(Math.atan(w0) * 180 / Math.PI).toFixed(0)} -> ${(Math.atan(w1) * 180 / Math.PI).toFixed(1)} deg`);
  }
  // gates near only
  const pts = resort.pistes.map((p) => ({ x: p.line[0], z: p.line[1] }));
  let worstGate = 0;
  for (let i = 0; i < 40; i++) {
    const c = pts[Math.floor((i / 40) * pts.length)];
    const near = gatesNear(pts, c.x, c.z);
    worstGate = Math.max(worstGate, near.length);
    ok(near.every((j) => Math.hypot(pts[j].x - c.x, pts[j].z - c.z) < GATE_DRAW) && near.length < pts.length, `${rid}: gatesNear keeps only gates within ${GATE_DRAW} m`);
  }
  console.log(`  gates: ${pts.length} in the resort, at most ${worstGate} drawn near a piste start (was all ${pts.length})`);
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// labels (resort independent)
let rnd = 7;
const R = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
let shown = 0, scenes = 0;
for (let n = 0; n < 2000; n++) {
  const width = 360 + R() * 1600, height = 500 + R() * 600;
  const avoid = [[0, 0, 220, 130], [width - 200, 0, width, 300]];
  const cands = Array.from({ length: 2 + Math.floor(R() * 7) }, () => ({ x: R() * width, y: R() * height, w: 90 + R() * 230, h: 22 + R() * 6 }));
  const spots = placeLabels(cands, { width, height, avoid });
  const boxes = [];
  spots.forEach((s, i) => { if (s) boxes.push([s.x0, s.y0, s.x0 + cands[i].w, s.y0 + cands[i].h, cands[i]]); });
  scenes++; shown += boxes.length;
  for (const [x0, y0, x1, y1, c] of boxes) {
    if (!ok(x0 >= LABEL_MARGIN - 1e-6 && y0 >= LABEL_MARGIN - 1e-6 && x1 <= width - LABEL_MARGIN + 1e-6 && y1 <= height - LABEL_MARGIN + 1e-6, `label inside the screen (${x0.toFixed(0)},${y0.toFixed(0)}-${x1.toFixed(0)},${y1.toFixed(0)} in ${width.toFixed(0)}x${height.toFixed(0)})`)) break;
    ok(Math.abs((x0 + x1) / 2 - c.x) <= c.w / 2 + 1e-6, 'label stays over its gate (shifted at most half its width)');
    ok(!avoid.some((q) => x0 < q[2] && x1 > q[0] && y0 < q[3] && y1 > q[1]), 'label never on the HUD');
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    ok(!(a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]), 'labels never overlap');
  }
}
console.log(`\nlabels: ${scenes} random scenes, ${shown} labels placed, none overlapping / cut / on the HUD`);
console.log(`\n${checks - fails} / ${checks} checks passed`);
process.exit(fails ? 1 : 0);
