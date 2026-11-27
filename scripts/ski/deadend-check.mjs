#!/usr/bin/env node
/* Dead-end check (Ian, Via Lattea Cesana: "there is no other way to come down than take that lift"): can a player who skis and rides
 * from the resort's first lift get back from everywhere he can reach, without a teleport?
 * The graph (the game's own data and rules, Node, no browser):
 *   lift bottom -> top (every rideable lift, modes/freeride.js createLiftNet), top -> bottom where the lift rides down (lift-path.js
 *   canRideDown: chairs, gondolas, cable cars, trains; lift-site.js site.down);
 *   along every piste (points every STEP m, the bake orients them downhill);
 *   a station or piste point -> another piste's point / a station: skating / walking within SKATE m (JOIN m piste to piste; at most
 *   CLIMB m + GRADE x the distance up: a herringbone across a station area / a village), or skiing off the piste
 *   down to it within OFF m (at least 8 m lower, not steeper than 40 degrees on average).
 * Start: the first lift's bottom (config FIRST_LIFT, else the spawn) + the ski-bus valley lifts (config BUS_AREAS: reached by bus).
 * Reports: dead ends = reached from the start but no way back to it (a lift top with no piste and no ride down, a piste ending far from
 * any lift, a corner of the network); islands = never reached without a teleport (listed, not a failure: the map teleport goes there).
 *   node scripts/ski/deadend-check.mjs [resort ...] [--verbose]     exit 1 when a resort has a dead end */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../pb/ski');
const imp = (p) => import(path.join(root, p));
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { unpackResort } = await imp('linepack.js');
const { createPisteSet } = await imp('pistes.js');
const { createLiftNet } = await imp('modes/freeride.js');
const { createParkLayout } = await imp('modes/park.js');
const { firstLift } = await imp('modes/clear.js');
const { busLifts } = await imp('modes/explore.js');

export const DEADEND = Object.freeze({ VILLAGE: 700, STEP: 25, SKATE: 250, CLIMB: 4, GRADE: 0.18, OFF: 250, OFF_DROP: 8, OFF_SLOPE: 0.84, JOIN: 90 });
const { VILLAGE, STEP, SKATE, CLIMB, GRADE, OFF, OFF_DROP, OFF_SLOPE, JOIN } = DEADEND;
/** Piste ends the OSM data leaves in a dead end (no lift, no mapped village there; deadend-check 26 Nov 2026): the map teleport. */
const KNOWN = new Set(['killy:Col Pers', 'killy:Génépy (Blo)', 'killy:Golf', 'killy:Leisse (Schwaarz)', '3vallees:Plan du Vah', 'zermatt:Moos (Blo)',
  'zermatt:Verbindung → Theodulo - Plan Maison', 'arlberg:Vorderes Maroital', 'arlberg:Rendl Talabfahrt', 'arlberg:Erzberg', 'arlberg:Gamshang',
  'kronplatz:Ried (Rout)', 'kronplatz:Lumen', 'vialattea:46 bassa', 'obertauern:Verbindung → Kehrkopf (Variante)', 'obertauern:Verbindung → Monte Flu-Bahn',
  'davos:Müli', 'laax:Flims Oberdorf']);
const args = process.argv.slice(2), verbose = args.includes('--verbose');
const ALL = ['killy', '3vallees', 'zermatt', 'arlberg', 'kronplatz', 'vialattea', 'obertauern', 'livigno', 'davos', 'laax', 'soelden'];
const resorts = args.filter((a) => !a.startsWith('--')).length ? args.filter((a) => !a.startsWith('--')) : ALL;
let failed = 0;

for (const rid of resorts) {
  const dir = path.join(root, 'data', rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`)))));
  const H = (x, z) => field.height(x, z);                                     // the 5 m heights (the far grid is 40 m: +-10 m on steeps)
  const pistes = createPisteSet(resort);
  const lifts = createLiftNet(resort, field.farHeight, pistes);              // as the game
  // ---- nodes
  const nodes = [];                        // { x, z, y, kind: 'bottom' | 'top' | 'piste', lift?, piste?, k?, last? }
  const add = (n) => { n.id = nodes.length; nodes.push(n); return n.id; };
  const B = new Map(), T = new Map();
  for (const l of lifts.list) {
    B.set(l.index, add({ kind: 'bottom', lift: l, x: l.bottom.x, z: l.bottom.z, y: l.bottom.y }));
    T.set(l.index, add({ kind: 'top', lift: l, x: l.top.x, z: l.top.z, y: l.top.y }));
  }
  const runs = [];
  for (const p of resort.pistes) {
    const L = p.line, pts = [];
    let acc = STEP;
    for (let i = 0; i + 1 < L.length; i += 2) {
      if (i) acc += Math.hypot(L[i] - L[i - 2], L[i + 1] - L[i - 1]);
      if (acc >= STEP || i + 2 >= L.length) { acc = 0; pts.push(add({ kind: 'piste', piste: p, x: L[i], z: L[i + 1], y: H(L[i], L[i + 1]) })); }
    }
    nodes[pts[pts.length - 1]].last = true;
    nodes[pts[0]].first = true;
    runs.push(pts);
  }
  // ---- edges
  const out = nodes.map(() => []);
  const edge = (a, b, why) => { if (a !== b) out[a].push([b, why]); };
  for (const l of lifts.list) { edge(B.get(l.index), T.get(l.index), 'up'); if (l.down) edge(T.get(l.index), B.get(l.index), 'down'); }
  for (const pts of runs) for (let k = 0; k + 1 < pts.length; k++) edge(pts[k], pts[k + 1], 'piste');
  // a grid for the near tests
  const G = 100, grid = new Map(), gk = (i, j) => i * 100003 + j;
  for (const n of nodes) { const k = gk(Math.floor(n.x / G), Math.floor(n.z / G)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n); }
  const near = (n, r) => { const res = []; for (let j = Math.floor((n.z - r) / G); j <= Math.floor((n.z + r) / G); j++) for (let i = Math.floor((n.x - r) / G); i <= Math.floor((n.x + r) / G); i++) for (const m of grid.get(gk(i, j)) || []) if (m !== n && Math.hypot(m.x - n.x, m.z - n.z) <= r) res.push(m); return res; };
  for (const n of nodes) {
    for (const m of near(n, OFF)) {
      if (m.kind === 'piste' && n.kind === 'piste' && m.piste === n.piste) continue;
      const d = Math.hypot(m.x - n.x, m.z - n.z), dy = m.y - n.y;
      const reach = n.kind === 'piste' && m.kind === 'piste' ? JOIN : SKATE;
      if (d <= reach && dy <= CLIMB + GRADE * d) edge(n.id, m.id, 'skate');
      else if (dy <= -OFF_DROP && -dy / Math.max(1, d) <= OFF_SLOPE) edge(n.id, m.id, 'off');
    }
  }
  // ---- reach from the start, and back to it
  const first = firstLift(rid, lifts, resort.places, null);
  const starts = [first, ...busLifts(rid, lifts)].filter(Boolean).map((l) => B.get(l.index));
  const bfs = (from, adj) => { const seen = new Uint8Array(nodes.length); const q = [...from]; for (const s of q) seen[s] = 1; while (q.length) { const a = q.pop(); for (const [b] of adj[a]) if (!seen[b]) { seen[b] = 1; q.push(b); } } return seen; };
  const fwd = bfs(starts, out);
  const inc = nodes.map(() => []);
  out.forEach((es, a) => { for (const [b, why] of es) inc[b].push([a, why]); });
  const back = bfs(starts, inc);
  // ---- report
  const label = (n) => (n.kind === 'piste' ? `piste "${n.piste.name}"${n.last ? ' (end)' : n.first ? ' (start)' : ''}` : `${n.kind} of lift #${n.lift.index} "${n.lift.name}" (${n.lift.kind}${n.lift.down ? ', rides down' : ''})`);
  const dead = nodes.filter((n) => fwd[n.id] && !back[n.id]);
  // group the dead nodes into connected pockets (by the edges among them)
  const pocket = new Map();
  for (const n of dead) {
    if (pocket.has(n.id)) continue;
    const id = pocket.size, q = [n.id];
    pocket.set(n.id, id);
    while (q.length) { const a = q.pop(); for (const [b] of [...out[a], ...inc[a]]) if (!pocket.has(b) && fwd[b] && !back[b]) { pocket.set(b, id); q.push(b); } }
  }
  const pockets = new Map();
  for (const n of dead) { const id = pocket.get(n.id); if (!pockets.has(id)) pockets.set(id, []); pockets.get(id).push(n); }
  // a valley run that ends in a village with no lift there (Courchevel Saint-Bon, Klösterle, Serneus): real ski areas bring you back by
  // bus; in the game the map teleport does (listed as info, not a failure)
  const villages = (resort.places || []).filter((q) => q.kind === 'village' || q.kind === 'town' || q.kind === 'hamlet' || q.kind === 'suburb');
  const inVillage = (n) => villages.some((v) => Math.hypot(v.x - n.x, v.z - n.z) < VILLAGE);
  const busEnds = [];
  // (a village pocket may hold its nursery drag lifts / carpets: Klosters Selfranga)
  for (const [id, list] of [...pockets]) if (list.every((n) => n.kind === 'piste' || n.lift.kind === 'drag' || n.lift.kind === 'carpet') && list.some((n) => (n.last || n.kind !== 'piste') && inVillage(n))) { busEnds.push(list); pockets.delete(id); }
  // what the data still has (OSM pistes ending where no lift / village is mapped, listed in the HANDOFF): reported, not a failure;
  // anything NEW (a lift top with no way on, a new pocket, a lift with no way back down) fails
  const known = [];
  for (const [id, list] of [...pockets]) if (list.every((n) => n.kind === 'piste') && list.some((n) => KNOWN.has(`${rid}:${n.piste.name}`))) { known.push(list); pockets.delete(id); }
  const liftsOut = lifts.list.filter((l) => !fwd[B.get(l.index)] && !fwd[T.get(l.index)]);
  const pistesOut = runs.filter((pts) => !pts.some((i) => fwd[i]));
  // lift tops with no way on but the lift itself (no piste, no station, no ride down): a trap even inside the network
  const traps = lifts.list.filter((l) => !out[T.get(l.index)].some(([b, why]) => why !== 'down'));
  const tops = traps.filter((l) => !l.down);
  // Ian's Cesana case: up a lift and no way back down to its bottom (its valley / village) without a teleport
  const noReturn = lifts.list.filter((l) => fwd[B.get(l.index)] && !bfs([T.get(l.index)], out)[B.get(l.index)]);
  const ok = pockets.size === 0 && noReturn.length === 0 && tops.every((l) => !fwd[T.get(l.index)]);
  if (!ok) failed++;
  console.log(`\n${rid}: ${lifts.list.length} lifts (${lifts.list.filter((l) => l.down).length} ride down), ${runs.length} pistes, start "${first ? first.name : '-'}"${starts.length > 1 ? ` + ${starts.length - 1} bus` : ''}: ${ok ? 'OK' : 'DEAD ENDS'}`);
  console.log(`  reached ${fwd.reduce((a, b) => a + b, 0)} of ${nodes.length} places; dead-end pockets ${pockets.size}; tops whose only way on is down the lift ${traps.length} (${traps.filter((l) => l.down).length} ride down)`);
  for (const [, list] of pockets) {
    const tl = list.filter((n) => n.kind !== 'piste'), pl = [...new Set(list.filter((n) => n.kind === 'piste').map((n) => n.piste.name))];
    const at = list[0];
    console.log(`  DEAD END at ${Math.round(at.x)},${Math.round(at.z)} (${Math.round(at.y)} m): ${tl.map(label).join('; ')}${tl.length && pl.length ? '; ' : ''}${pl.length ? `pistes ${pl.slice(0, 6).map((s) => `"${s}"`).join(', ')}${pl.length > 6 ? ` +${pl.length - 6}` : ''}` : ''}`);
  }
  for (const list of known) { const n = list.find((q) => q.last) || list[0]; console.log(`  known dead end (data, HANDOFF): ${[...new Set(list.map((q) => `"${q.piste.name}"`))].join(', ')} ending at ${Math.round(n.x)},${Math.round(n.z)} (${Math.round(n.y)} m)`); }
  if (busEnds.length) console.log(`  valley runs ending in a village without a lift (bus / map teleport, info): ${busEnds.map((l) => `"${l.find((n) => n.last).piste.name}"`).join(', ')}`);
  for (const l of noReturn) console.log(`  NO WAY BACK DOWN: from the top of lift #${l.index} "${l.name}" (${l.kind}) to its bottom ${Math.round(l.bottom.x)},${Math.round(l.bottom.z)} (${Math.round(l.bottom.y)} m)`);
  for (const l of tops) if (fwd[T.get(l.index)]) console.log(`  TRAP: top of lift #${l.index} "${l.name}" (${l.kind}) has no piste, no station and no ride down`);
  if (liftsOut.length || pistesOut.length) console.log(`  islands (only by teleport, info): ${liftsOut.length} lifts${liftsOut.length ? ` [${liftsOut.slice(0, 8).map((l) => l.name).join(', ')}${liftsOut.length > 8 ? ' ...' : ''}]` : ''}, ${pistesOut.length} pistes${pistesOut.length ? ` [${pistesOut.slice(0, 6).map((p) => nodes[p[0]].piste.name).join(', ')}${pistesOut.length > 6 ? ' ...' : ''}]` : ''}`);
  if (process.env.DEADEND_LIFT) for (const name of process.env.DEADEND_LIFT.split(',')) {
    const l = lifts.list.find((q) => q.name === name);
    if (!l) continue;
    for (const [w, id] of [['bottom', B.get(l.index)], ['top', T.get(l.index)]]) {
      const n = nodes[id];
      console.log(`  ? ${l.name} ${w} ${Math.round(n.x)},${Math.round(n.z)},${Math.round(n.y)} fwd ${fwd[id]} back ${back[id]} out: ${out[id].map(([b, why]) => `${why}->${label(nodes[b])}@${Math.round(Math.hypot(nodes[b].x - n.x, nodes[b].z - n.z))}m/${Math.round(nodes[b].y - n.y)}`).slice(0, 8).join(' | ')}`);
      const cand = near(n, 400).filter((m) => m.kind !== 'piste' || m.first || m.last).sort((a, b) => Math.hypot(a.x - n.x, a.z - n.z) - Math.hypot(b.x - n.x, b.z - n.z)).slice(0, 6);
      console.log(`      near: ${cand.map((m) => `${label(m)}@${Math.round(Math.hypot(m.x - n.x, m.z - n.z))}m/${Math.round(m.y - n.y)} back ${back[m.id]}`).join(' | ')}`);
    }
  }
  if (process.env.DEADEND_PISTE) for (const name of process.env.DEADEND_PISTE.split(',')) {
    const pts = runs.find((r) => nodes[r[0]].piste.name === name);
    if (!pts) continue;
    const n = nodes[pts[pts.length - 1]];
    const cand = near(n, 600).filter((m) => m.kind !== 'piste' || m.piste !== n.piste).filter((m) => back[m.id]).sort((a, b) => Math.hypot(a.x - n.x, a.z - n.z) - Math.hypot(b.x - n.x, b.z - n.z)).slice(0, 5);
    console.log(`  ? ${name} end ${Math.round(n.x)},${Math.round(n.z)},${Math.round(n.y)}: nearest with a way back: ${cand.map((m) => `${label(m)}@${Math.round(Math.hypot(m.x - n.x, m.z - n.z))}m/${Math.round(m.y - n.y)}`).join(' | ')}`);
  }
  if (verbose) for (const l of traps) console.log(`  (top served only by the lift itself: #${l.index} "${l.name}"${l.down ? ', rides down' : ''})`);
  if (rid === 'vialattea') {
    // Ian's report: up "Cesana-Ski Lodge 1" (#38) and back down to Cesana without a teleport
    const l = lifts.list.find((q) => q.baseName === 'Cesana-Ski Lodge 1');
    const fromTop = l ? bfs([T.get(l.index)], out) : null;
    const good = !!l && l.down && fromTop[B.get(l.index)] === 1 && back[T.get(l.index)] === 1;
    if (!good) failed++;
    console.log(`  Cesana-Ski Lodge 1: ${good ? 'OK, rides down from the middle station to Cesana' : 'FAIL: no way back down to Cesana'}`);
  }
}
console.log(failed ? `\n${failed} FAIL` : '\nall resorts: no dead end');
if (failed) process.exit(1);
