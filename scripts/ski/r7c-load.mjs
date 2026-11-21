/* Round 7-C: load one resort in Node like the game does (every tile, the trees, the buildings): shared by the R7-C checks and the debug
 * map below.   node scripts/ski/r7c-load.mjs <resort> [lift name]   prints the obstacle map round the first lift (b building, s station,
 * l lift line, t tree, r rock, w water, u built, . open). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.window = globalThis.window || {};
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'pb', 'ski');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);

export async function loadResort(rid) {
  const { decodeGrid, decodeRle } = await imp('codec.js');
  const { createField, createPisteNet } = await imp('field.js');
  const { createSurface } = await imp('surface.js');
  const { createScatter } = await imp('scatter.js');
  const { createPisteSet } = await imp('pistes.js');
  const { createLiftNet } = await imp('modes/freeride.js');
  const { createParkLayout } = await imp('modes/park.js');
  const { createObstacles } = await imp('modes/clear.js');
  const dir = path.join(root, 'data', rid);
  const resort = JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8'));
  const far = decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 'far.bin'))));
  const classes = decodeRle(new Uint8Array(fs.readFileSync(path.join(dir, 'classes.bin'))));
  const field = createField({ resort, far, classes, net: createPisteNet(resort.network), park: createParkLayout(resort.park) });
  for (const [tx, tz] of resort.tiles.list) field.addTile(tx, tz, decodeGrid(new Uint8Array(fs.readFileSync(path.join(dir, 't', `${tx}_${tz}.bin`)))));
  const surface = createSurface(field);
  const height = (x, z) => surface.height(x, z);
  const scatter = createScatter(field);
  const pistes = createPisteSet(resort);
  const lifts = createLiftNet(resort, (x, z) => field.farHeight(x, z), pistes);
  const obs = createObstacles({ resort, field, scatter, density: 0.8 });
  const buildings = JSON.parse(fs.readFileSync(path.join(dir, 'buildings.json'), 'utf8'));
  obs.setBuildings(buildings);
  return { rid, resort, field, surface, height, scatter, pistes, lifts, obs, buildings, imp };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rid = process.argv[2] || 'killy';
  const w = await loadResort(rid);
  const { firstLift, liftSpot } = await imp('modes/clear.js');
  const l = process.argv[3] ? w.lifts.list.find((q) => q.name === process.argv[3]) : firstLift(rid, w.lifts, w.resort.places);
  const b = l.bottom, d = Math.hypot(l.top.x - b.x, l.top.z - b.z);
  console.log(l.name, Math.round(b.x), Math.round(b.z), 'up the line', ((l.top.x - b.x) / d).toFixed(2), ((l.top.z - b.z) / d).toFixed(2), '(x right, z down; X = bottom)');
  for (let j = -40; j <= 40; j += 4) {
    let row = '';
    for (let i = -48; i <= 48; i += 3) {
      if (Math.abs(i) < 2 && Math.abs(j) < 2) { row += 'X'; continue; }
      const why = w.obs.blocked(b.x + i, b.z + j, 0.5);
      row += why ? ({ building: 'b', station: 's', lift: 'l', tree: 't', rock: 'r', water: 'w', built: 'u', edge: 'e' })[why] : '.';
    }
    console.log(row);
  }
  console.log(liftSpot(l, w.obs, w.height));
}
