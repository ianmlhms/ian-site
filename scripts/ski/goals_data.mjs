#!/usr/bin/env node
/* Goals data (pb/ski/modes/goals-data.js), generated from the baked resorts. Per resort:
 *   pd   one character per position of modes/piste-index.js: g / b / r / k = a piste that counts for the goals (>= 400 m, not a variant
 *        line), '-' = not counted (or a dead index entry)
 *   ld   one character per position of modes/lift-index.js: '1' = a lift the game lets you ride (the runtime lift list, no carpets)
 *   dn   discovered cells needed for "Ganz Gebitt entdeckt": 75 % of the 100 m cells within 150 m of a piste or a lift
 *   pk   1 when the resort has a snow park
 *   top  the highest lift top station in m ("Héchste Punkt": the skier must come within 25 m of it, height only)
 *   dp   daily candidates, pistes: [index position, name, ★2 time in ms] (blue / red / black, 700-3500 m, no variant / route, <= 16)
 *   dc   daily candidates, lift + run combos: [lift position, piste position] (the piste starts within 160 m of the lift's top station)
 *   nm   names of those combos: { l<lift position>: name, p<piste position>: name }
 * Run after piste_index.mjs and lift_index.mjs (it fails when an index is incomplete), then python3 scripts/game_importmap.py:
 *     node scripts/ski/goals_data.mjs            (writes the file)
 *     node scripts/ski/goals_data.mjs --check    (exit 1 when the file is not what the baked data gives: scripts/ski/goals-check.mjs does this) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../pb/ski');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { unpackResort } = await imp('linepack.js');
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { createPisteSet } = await imp('pistes.js');
const { createLiftNet } = await imp('modes/freeride.js');
const { hash5, challengeFor } = await imp('modes/challenges.js');
const { liftKey } = await imp('modes/goals-keys.js');
const { PISTE_INDEX } = await imp('modes/piste-index.js');
const { LIFT_INDEX } = await imp('modes/lift-index.js');

const CELL = 100, NEAR = 150, DISC_SHARE = 0.75, MIN_LEN = 400;
const DIFF_CH = { green: 'g', blue: 'b', red: 'r', black: 'k' };
const hashOf = (text) => hash5(text);
const positions = (text) => new Map((text.match(/.{5}/g) || []).map((k, i) => [k, i]));
const short = (name) => String(name).replace(/\s+/g, ' ').trim();

const out = {};
for (const rid of fs.readdirSync(path.join(root, 'data')).sort()) {
  const dir = path.join(root, 'data', rid);
  if (!fs.existsSync(path.join(dir, 'resort.json'))) continue;
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network) });
  const pistes = createPisteSet(resort);
  const net = createLiftNet(resort, (x, z) => field.farHeight(x, z), pistes);
  const pPos = positions(PISTE_INDEX[rid] || ''), lPos = positions(LIFT_INDEX[rid] || '');
  const pd = new Array(pPos.size).fill('-'), ld = new Array(lPos.size).fill('0');
  const counted = [];
  for (const p of pistes.list) {
    const pos = pPos.get(hashOf(p.id));
    if (pos === undefined) throw new Error(`${rid}: piste ${p.id} is not in the piste index (run scripts/ski/piste_index.mjs)`);
    if (p.length >= MIN_LEN && !(p.src && p.src.variant) && DIFF_CH[p.diff]) { pd[pos] = DIFF_CH[p.diff]; counted.push({ p, pos }); }
  }
  const lifts = [];
  for (const l of net.list) {
    if (l.kind === 'carpet') continue;
    const k = liftKey(resort.lifts[l.index]);
    const pos = k ? lPos.get(k) : undefined;
    if (pos === undefined) throw new Error(`${rid}: lift ${l.name} is not in the lift index (run scripts/ski/lift_index.mjs)`);
    ld[pos] = '1';
    lifts.push({ l, pos });
  }
  // discovery target: cells within NEAR m of a piste line or a lift
  const nx = Math.ceil(resort.width / CELL), nz = Math.ceil(resort.depth / CELL);
  const near = new Set();
  const mark = (x, z) => {
    for (let j = Math.floor((z - NEAR) / CELL); j <= Math.floor((z + NEAR) / CELL); j++) for (let i = Math.floor((x - NEAR) / CELL); i <= Math.floor((x + NEAR) / CELL); i++) {
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const cx = Math.max(i * CELL, Math.min(x, (i + 1) * CELL)), cz = Math.max(j * CELL, Math.min(z, (j + 1) * CELL));
      if (Math.hypot(cx - x, cz - z) <= NEAR) near.add(j * nx + i);
    }
  };
  for (const p of pistes.list) { const q = {}; for (let s = 0; s <= p.length; s += 60) { p.at(s, q); mark(q.x, q.z); } }
  for (const { l } of lifts) { const pts = resort.lifts[l.index].pts; for (let k = 2; k < pts.length; k += 2) { const n = Math.max(1, Math.ceil(Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]) / 60)); for (let t = 0; t <= n; t++) mark(pts[k - 2] + (pts[k] - pts[k - 2]) * t / n, pts[k - 1] + (pts[k + 1] - pts[k - 1]) * t / n); } }
  const dn = Math.round(near.size * DISC_SHARE);
  const top = Math.round(Math.max(...lifts.map(({ l }) => l.top.y)));
  // daily candidates
  const pool = counted.filter(({ p }) => p.diff !== 'green' && p.length >= 700 && p.length <= 3500 && !(p.src && (p.src.variant || p.src.route)) && !p.src.slalom && p.name.length <= 28 && !/^\d/.test(p.name))
    .sort((a, b) => hashOf(a.p.id + '/daily') < hashOf(b.p.id + '/daily') ? -1 : 1).slice(0, 12);
  const dp = pool.map(({ p, pos }) => [pos, short(p.name), challengeFor(p, (x, z) => field.farHeight(x, z)).targetMs]);
  const dc = [];
  for (const { l, pos: lp } of lifts) {
    if (l.kind === 'drag' || l.tunnel || l.top.y - l.bottom.y < 150) continue;
    for (const { p, pos: pp } of counted) {
      if (p.diff === 'green' || p.length < 700 || p.length > 3500 || (p.src && (p.src.variant || p.src.route))) continue;
      if (Math.hypot(p.top.x - l.top.x, p.top.z - l.top.z) < 160 && Math.abs(p.src.top - l.top.y) < 60) dc.push([lp, pp, hashOf(`${rid}${lp}${pp}`)]);
    }
  }
  dc.sort((a, b) => (a[2] < b[2] ? -1 : 1));
  const combos = dc.slice(0, 8).map(([a, b]) => [a, b]);
  // the names of the combos' lifts and pistes (they may not be in the candidate lists above)
  const pname = new Map(pistes.list.map((p) => [pPos.get(hashOf(p.id)), short(p.name)]));
  const lname = new Map(lifts.map(({ l, pos }) => [pos, short(l.name)]));
  const dn2 = {};
  for (const [a, b] of combos) { dn2[`l${a}`] = lname.get(a); dn2[`p${b}`] = pname.get(b); }
  out[rid] = { pd: pd.join(''), ld: ld.join(''), dn, top, pk: resort.park ? 1 : 0, dp, dc: combos, nm: dn2 };
  console.log(`${rid}: pistes counted ${counted.length}/${pistes.list.length}, lifts ${lifts.length}, dn ${dn}, top ${top}, daily ${dp.length} pistes / ${combos.length} combos`);
}
const file = path.join(root, 'modes', 'goals-data.js');
const body = Object.entries(out).map(([rid, v]) => `  ${JSON.stringify(rid)}: ${JSON.stringify(v)},`).join('\n');
const text = `/* GENERATED by scripts/ski/goals_data.mjs (after piste_index.mjs + lift_index.mjs): what counts for the goals of each ski area and the
 * candidates of the daily challenge. See the header of the generator for the fields. Positions are those of piste-index.js / lift-index.js. */
export const GOALS_DATA = Object.freeze({
${body}
});
`;
if (process.argv.includes('--check')) {
  const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text;
  console.log(same ? 'goals-data.js is current' : 'goals-data.js is out of date (run scripts/ski/goals_data.mjs)');
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(file, text);
console.log(`goals-data.js: ${fs.statSync(file).size} bytes`);
