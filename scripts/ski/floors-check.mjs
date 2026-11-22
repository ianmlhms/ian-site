/* R8d: every ski board's client floor (pb/ski/progress.js minRunMs of pistes.js createPiste's length) == its row in scripts/ski-v1.sql,
 * and every piste of every baked resort has exactly one row (plus one park row per resort with a park). Run after a bake / make_sql.py.
 *   node scripts/ski/floors-check.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', 'pb', 'ski');
const imp = (p) => import(path.join(root, p));
const { createPisteSet } = await imp('pistes.js');
const { minRunMs } = await imp('progress.js');
const { unpackResort } = await imp('linepack.js');

const sql = fs.readFileSync(path.join(here, '..', 'ski-v1.sql'), 'utf8');
const rows = new Map();
for (const m of sql.matchAll(/^\s*\('(ski-[^']+)', (\d+), (null|\d+)\)/gm)) rows.set(m[1], Number(m[2]));
let failed = 0, boards = 0;
const seen = new Set();
for (const rid of fs.readdirSync(path.join(root, 'data')).sort()) {
  const file = path.join(root, 'data', rid, 'resort.json');
  if (!fs.existsSync(file)) continue;
  const resort = unpackResort(JSON.parse(fs.readFileSync(file, 'utf8')));
  const set = createPisteSet(resort);
  let bad = 0;
  for (const p of set.list) {
    const board = `ski-${rid}-${p.id}`.slice(0, 48);
    seen.add(board); boards++;
    const want = minRunMs(p.length);
    if (rows.get(board) !== want) { bad++; if (bad <= 5) console.log(`  FAIL ${board}: client ${want} ms, SQL ${rows.get(board)}`); }
  }
  if (resort.park) { seen.add(`ski-${rid}-park`); if (!rows.has(`ski-${rid}-park`)) { bad++; console.log(`  FAIL ski-${rid}-park missing`); } }
  console.log(`${bad ? 'FAIL' : 'ok  '} ${rid}: ${set.list.length} pistes, ${bad} floors differ`);
  failed += bad;
}
const extra = [...rows.keys()].filter((b) => !seen.has(b));
if (extra.length) { failed += extra.length; console.log(`FAIL ${extra.length} SQL rows without a piste (e.g. ${extra.slice(0, 3).join(', ')})`); }
console.log(failed ? `\n${failed} FAILED` : `\nall ${boards} piste floors + parks agree (${rows.size} SQL rows)`);
process.exit(failed ? 1 : 0);
