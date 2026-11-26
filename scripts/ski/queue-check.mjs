/* Lift lines (26 Nov 2026): the queue mazes and the people in them, in Node (the game's own code: lift-site.js, lift-queue.js).
 *   node scripts/ski/queue-check.mjs [resort,resort ...] [--verbose]
 * Per resort: which busy lifts got a maze (the rest: why not, --verbose), each maze clear of the stations / lanes / pylons / kept houses
 * (lift-site.js decides), every lane slot a body clear of the ropes; the line run for 90 s per maze: nobody inside a rope / post /
 * station part, nobody on top of anybody (closer than 0.75 m, 0.6 m passing; one group side by side at a chair's loading line / a cabin's door: 0.38 m),
 * the riders a carrier takes = the group that walked to it, the chair gate open while they pass, deterministic; a player hold: no new
 * group in the zone while he stands there, the carriers passing meanwhile go up empty. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../pb/ski');
const imp = (p) => import(path.join(root, p));
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { createParkLayout } = await imp('modes/park.js');
const { unpackResort } = await imp('linepack.js');
const { createPisteSet } = await imp('pistes.js');
const { createLiftNet } = await imp('modes/freeride.js');
const { mazeSpec, createQueueSim, laneAt, mazeWhy } = await imp('lift-queue.js');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const list = (args.find((a) => !a.startsWith('--')) || 'killy,3vallees,zermatt,arlberg,kronplatz,vialattea,obertauern,livigno,davos,laax').split(',');
let fails = 0;
const fail = (m) => { fails++; console.log('  FAIL', m); };
const totals = { made: 0, eligible: 0 };
for (const rid of list) {
  const dir = path.join(root, 'data', rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`)))));
  const pistes = createPisteSet(resort);
  const net = createLiftNet(resort, field.farHeight, pistes);
  const bfile = path.join(dir, 'buildings.json');
  if (fs.existsSync(bfile)) { const b = JSON.parse(fs.readFileSync(bfile, 'utf8')); net.setBuildings(Array.isArray(b) ? b : b.rows || b.b || []); }
  const world = net.world;
  let eligible = 0, made = 0;
  const byKind = {};
  const seed = 12345;
  const g = (x, z) => field.farHeight(x, z);
  for (const [index, site] of world.sites) {
    if (!net.byIndex.get(index)) continue;
    if (!mazeSpec(site.path)) continue;
    eligible++;
    const m = site.queue;
    if (!m) { if (verbose) console.log(`  no maze: #${index} ${site.path.src.name} ${site.key}${site.path.seats ? ' ' + site.path.seats : ''}`); continue; }
    made++; byKind[site.key] = (byKind[site.key] || 0) + 1;
    // every lane slot: a body (0.45 m) clear of the ropes / posts / station parts
    const q = {};
    for (const lane of m.lanes) for (let d = 0.45; d < lane.len - 0.2; d += 0.5) {
      laneAt(lane, d, q);
      if (world.hit(q.x, q.z, 0.42)) { fail(`${rid} #${index} ${site.path.src.name}: lane ${lane.i} at ${d.toFixed(1)} m touches a part`); break; }
    }
    // the line over 90 s (lifts.js's own clock: A = t x speed + offset; jig-back: its cycle)
    const sim = createQueueSim(site, seed, index), sim2 = createQueueSim(site, seed, index);
    const out = [], out2 = [];
    const speed = site.path.spec.speed, gap = site.path.spec.gap, off = (index * 7.31) % 50;
    const uLoad = site.path.upU(site.boardS);
    const clockAt = (t) => {
      if (m.loop) return { phi: (uLoad - (t * speed + off)) / gap };
      const T = (site.path.docks[1] - site.path.docks[0]) / (speed * 4), cyc = 2 * (T + 8), v = t + off;
      return { c: Math.floor(v / cyc), u: ((v % cyc) + cyc) % cyc, dwell: 8 };
    };
    let bad = 0, overlap = 0, gateSeen = 0, maxN = 0;
    const walked = new Map();
    for (let t = 0; t < 90; t += 0.1) {
      sim.people(clockAt(t), 1, '', out);
      sim2.people(clockAt(t), 1, '', out2);
      if (out.length !== out2.length || out.some((o, i) => o.id !== out2[i].id || Math.abs(o.x - out2[i].x) > 1e-9)) { fail(`${rid} #${index}: not deterministic`); break; }
      maxN = Math.max(maxN, out.length);
      if (sim.gate > 0.5) gateSeen++;
      for (const o of out) {
        if (world.hit(o.x, o.z, 0.3, g(o.x, o.z) + 0.05, g, 1.6)) { bad++; if (verbose && bad < 4) console.log(`    hit #${index} t=${t.toFixed(1)} id ${o.id} m${o.m} moving ${o.moving}`); }
        if (m.loop) { if (!walked.has(o.k)) walked.set(o.k, new Set()); walked.get(o.k).add(o.m); }
      }
      for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
        const d = Math.hypot(out[i].x - out[j].x, out[i].z - out[j].z);
        const lim = out[i].k === out[j].k ? 0.38 : out[i].moving || out[j].moving ? 0.6 : 0.75;      // (passing: closer)
        if (d < lim) { overlap++; if (verbose && overlap < 4) console.log(`    overlap #${index} t=${t.toFixed(1)} ${out[i].id}/${out[j].id} d=${d.toFixed(2)} moving ${out[i].moving}${out[j].moving}`); }
      }
    }
    // the riders of a carrier = the group that walked to it
    let mism = 0;
    if (m.loop) {
      const c = clockAt(80).phi;
      for (let n = Math.floor(c) + 2; n > Math.floor(c) - 3; n--) { const gr = sim.groupOf(n, 1); if (gr && walked.has(gr.k) && walked.get(gr.k).size !== gr.n) mism++; }
    }
    // a hold: the player stands in the zone from t = 100 s to 120 s: nobody walks into the zone meanwhile, the carriers go up empty
    let holdBad = 0;
    if (m.loop) {
      const z = site.zone, l = {};
      for (let t = 100; t < 120; t += 0.1) {
        sim.people(clockAt(t), 1, 'zone', out);
        if (t < 100 + sim.P + 0.6) continue;                   // (the ones at the line already go on)
        for (const o of out) { site.bottom.toLocal(o.x, o.z, l); if (l.a > z.a0 && l.a < z.a1 && l.b > z.b0 && l.b < z.b1) holdBad++; }
      }
      sim.people(clockAt(120), 1, '', out);
      // the carriers that reached the line between the zone's last group and the end of the hold went up empty
      for (let n = Math.floor(clockAt(100 + sim.Xzone + 0.2).phi); n >= Math.ceil(clockAt(120).phi); n--) if (sim.groupOf(n, 1)) holdBad++;
    }
    if (bad) fail(`${rid} #${index} ${site.path.src.name}: ${bad} person-frames inside a part`);
    if (overlap) fail(`${rid} #${index} ${site.path.src.name}: ${overlap} overlaps`);
    if (mism) fail(`${rid} #${index} ${site.path.src.name}: ${mism} groups != riders`);
    if (holdBad) fail(`${rid} #${index} ${site.path.src.name}: ${holdBad} in the zone / on his carrier during a hold`);
    if (site.key === 'chair' && !gateSeen) fail(`${rid} #${index} ${site.path.src.name}: the gate never opened`);
    if (verbose) console.log(`  #${index} ${site.path.src.name} ${site.key}${site.path.sub ? '/' + site.path.sub : ''}${site.path.seats ? ' ' + site.path.seats : ''}: lanes ${m.npcLanes}+1, ${m.len.toFixed(1)} m, rise ${(m.ground.hi - m.ground.lo).toFixed(2)} m, people <= ${maxN}`);
  }
  totals.made += made; totals.eligible += eligible;
  console.log(`${rid}: mazes ${made} / ${eligible} busy lifts ${JSON.stringify(byKind)}`);
}
console.log(`total mazes ${totals.made} / ${totals.eligible}; tries refused (all worlds, every length): ${JSON.stringify(mazeWhy)}`);
console.log(fails ? `queue-check: ${fails} FAIL` : 'queue-check: all OK');
process.exit(fails ? 1 : 0);
