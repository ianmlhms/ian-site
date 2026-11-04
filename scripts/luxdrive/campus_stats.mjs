/* Campus Geesseknäppchen: builds the campus models in Node (no browser) and prints the triangles per mesh and per building.
 *   node scripts/luxdrive/campus_stats.mjs <dtm.json> [dump.json]
 * dtm.json: { x0, z0, step, w, h, v } the LiDAR terrain model of the campus (4 m grid) - the land the game's own surface follows closely.
 * dump.json (optional): the triangles of the models (x y z r g b per vertex) for the desk renderer of the work folder. */
import fs from 'node:fs';
import { CAMPUS_BUILDERS } from '../../pb/lux-drive/campus.js';

const [dtmFile, dumpFile] = process.argv.slice(2);
if (!dtmFile) throw new Error('usage: campus_stats.mjs <dtm.json> [dump.json]');
const dtm = JSON.parse(fs.readFileSync(dtmFile, 'utf8'));
const ground = (x, z) => {
  const gx = Math.min(dtm.w - 1.001, Math.max(0, (x - dtm.x0) / dtm.step)), gz = Math.min(dtm.h - 1.001, Math.max(0, (z - dtm.z0) / dtm.step));
  const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
  const at = (i, j) => dtm.v[j * dtm.w + i];
  return at(ix, iz) * (1 - fx) * (1 - fz) + at(ix + 1, iz) * fx * (1 - fz) + at(ix, iz + 1) * (1 - fx) * fz + at(ix + 1, iz + 1) * fx * fz;
};
let total = 0;
const dump = [];
for (const b of CAMPUS_BUILDERS) {
  const t0 = performance.now();
  const model = b.build({ ground });
  const tri = model.soup.triangleCount;
  total += tri;
  console.log(`${b.id.padEnd(16)} ${String(tri).padStart(7)} triangles  ${model.soup.vertexCount} vertices  ${(performance.now() - t0).toFixed(0)} ms`);
  if (dumpFile) dump.push({ id: b.id, pos: Array.from(model.soup.pos, (v) => Math.round(v * 100) / 100), col: Array.from(model.soup.col, (v) => Math.round(v * 100) / 100), idx: model.soup.idx });
}
console.log(`campus total ${total} triangles in ${CAMPUS_BUILDERS.length} meshes`);
if (dumpFile) fs.writeFileSync(dumpFile, JSON.stringify(dump));
