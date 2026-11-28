/* Roof check (lift fixes, 28 Nov 2026): per station end the main roof state after the neighbour pruning: a roof / gable / shell that was
 * flattened to a slab (shift), cut, or is missing altogether.  node scripts/ski/roof-check.mjs <resort|all> [--verbose]
 * Prints FLAT (a drawn gable / shell lower than half its designed height), NOROOF (no live roof, gable or shell on the end), and a count. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
globalThis.window = globalThis.window || {};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../pb/ski');
const imp = (p) => import(path.join(root, p));
const { decodeGrid, decodeRle } = await imp('codec.js');
const { createField, createPisteNet } = await imp('field.js');
const { createLiftPath } = await imp('lift-path.js');
const { createLiftWorld } = await imp('lift-site.js');
const { createParkLayout } = await imp('modes/park.js');
const { unpackResort } = await imp('linepack.js');
const { createPisteSet } = await imp('pistes.js');
const { createLiftNet } = await imp('modes/freeride.js');
const arg = process.argv[2] || 'all';
const verbose = process.argv.includes('--verbose');
const detail = (process.argv.find((a) => a.startsWith('--detail=')) || '').slice(9).split(',').filter(Boolean).map(Number);
const rids = arg === 'all' ? fs.readdirSync(path.join(root, 'data')).filter((d) => fs.existsSync(path.join(root, 'data', d, 'resort.json'))) : [arg];
let flat = 0, noroof = 0, ends = 0;
const all = [];
for (const rid of rids) {
  const dir = path.join(root, 'data', rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`)))));
  createLiftNet(resort, field.farHeight, createPisteSet(resort));           // the game's FIRST world: the pruning is decided on the far grid, the 5 m world repeats it
  const paths = new Map();
  resort.lifts.forEach((src, i) => { const q = createLiftPath(src, (x, z) => field.height(x, z)); if (q) paths.set(i, q); });
  const world = createLiftWorld(paths);
  for (const [i, site] of world.sites) for (const f of site.ends) {
    ends++;
    const name = `${rid} #${i} ${resort.lifts[i].name} ${f.which ? 'top' : 'bottom'} ${f.type}`;
    const roofy = (p) => !p.deck && !p.cut && !p.hide && (p.roof || p.shape === 'gableA' || p.shape === 'gableB' || (p.shape === 'shell' && p.shell));
    if (detail.includes(i)) for (const p of f.parts) if (!p.deck && (p.roof || p.shape || p.cut)) console.log('  ', name, JSON.stringify({ shape: p.shape, roof: p.roof, shell: p.shell, hide: p.hide, cut: p.cut, solid: p.solid, shift: p.shift, a: [p.a0, p.a1].map((v) => +v.toFixed(1)), b: [p.b0, p.b1].map((v) => +v.toFixed(1)), y: [p.y0, p.y1].map((v) => +v.toFixed(2)) }));
    const live = f.parts.filter(roofy);
    all.push({ f, name, live, rid });
    if (!live.length) continue;
    for (const p of live) if ((p.shape === 'gableA' || p.shape === 'gableB' || p.shape === 'shell') && p.shift && p.shift[1] - p.shift[0] < -0.45) { flat++; console.log('FLAT', name, `h ${(p.y1 - p.y0).toFixed(2)} (dropped ${(p.shift[0] - p.shift[1]).toFixed(2)})`); }
    if (verbose) console.log('ok', name, live.map((p) => `${p.shape || 'roof'}:${(p.y1 - p.y0).toFixed(2)}`).join(' '));
  }
}
// an end with no roof of its own is fine when another lift's end of the same station stands within 16 m with one (a shared mid-station)
const centre = (f) => f.toWorld(0, 0, {});
for (const e of all) {
  if (e.live.length || / (belt|hut)$/.test(e.name)) continue;
  const c = centre(e.f);
  const mate = all.find((o) => o !== e && o.rid === e.rid && o.live.length && o.f !== e.f && Math.hypot(centre(o.f).x - c.x, centre(o.f).z - c.z) < 16);
  if (mate) { if (verbose) console.log('shared', e.name, '<-', mate.name); continue; }
  noroof++; console.log('NOROOF', e.name);
}
console.log(`roof-check: ${ends} ends, ${flat} flattened, ${noroof} without a roof`);
process.exit(flat || noroof ? 1 : 0);
