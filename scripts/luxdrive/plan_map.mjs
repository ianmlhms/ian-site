/* Plan view of the shipped data around a point: LOD2 footprints (with ids), road ways (names), bridge decks.
 * A tool for placing landmarks on the real data (the raw LiDAR / LOD2 are not needed).
 *   node scripts/luxdrive/plan_map.mjs <cx> <cz> <halfSize m> <out.svg> [--ids]
 * The svg is x east, z south, 1 px per 0.5 m at most.  Needs only the files in pb/lux-drive/data. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBuildings } from '../../pb/lux-drive/world-data.js';
import { decodeRoads } from '../../pb/lux-drive/roads.js';
import { decodeDecks } from '../../pb/lux-drive/decks.js';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../pb/lux-drive/data');
const read = (n) => new Uint8Array(fs.readFileSync(path.join(DATA, n)));
const [cx, cz, half, out] = [Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4]), process.argv[5]];
const showIds = process.argv.includes('--ids');
if (!(half > 0) || !out) throw new Error('usage: plan_map.mjs <cx> <cz> <half> <out.svg> [--ids]');

const buildings = decodeBuildings(read('buildings.bin'));
const roads = decodeRoads(read('roads.bin'), JSON.parse(fs.readFileSync(path.join(DATA, 'names.json'), 'utf8')));
const decks = decodeDecks(read('decks.bin'));
const S = 1000 / (2 * half);
const X = (x) => ((x - (cx - half)) * S).toFixed(1), Z = (z) => ((z - (cz - half)) * S).toFixed(1);
const inside = (x, z) => Math.abs(x - cx) < half * 1.2 && Math.abs(z - cz) < half * 1.2;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#f4f1ea"/>`;
// 50 m grid
for (let g = Math.ceil((cx - half) / 50) * 50; g < cx + half; g += 50) svg += `<line x1="${X(g)}" y1="0" x2="${X(g)}" y2="1000" stroke="#ddd"/><text x="${X(g)}" y="10" font-size="9" fill="#999">${g}</text>`;
for (let g = Math.ceil((cz - half) / 50) * 50; g < cz + half; g += 50) svg += `<line y1="${Z(g)}" x1="0" y2="${Z(g)}" x2="1000" stroke="#ddd"/><text y="${Z(g)}" x="2" font-size="9" fill="#999">${g}</text>`;
for (const r of roads) {
  if (!r.pts.some((p) => inside(p[0], p[1]))) continue;
  const col = r.bridge ? '#c33' : r.tunnel ? '#a6a' : '#777';
  svg += `<polyline fill="none" stroke="${col}" stroke-opacity=".6" stroke-width="${Math.max(1, r.width * S)}" points="${r.pts.map((p) => `${X(p[0])},${Z(p[1])}`).join(' ')}"/>`;
  if (r.name && half < 400) { const m = r.pts[r.pts.length >> 1]; svg += `<text x="${X(m[0])}" y="${Z(m[1])}" font-size="9" fill="#06c">${r.name}</text>`; }
}
for (const b of buildings) {
  let sx = 0, sz = 0; const n = b.pts.length / 2;
  for (let i = 0; i < n; i++) { sx += b.pts[2 * i]; sz += b.pts[2 * i + 1]; }
  sx /= n; sz /= n;
  if (!inside(sx, sz)) continue;
  const pts = []; for (let i = 0; i < n; i++) pts.push(`${X(b.pts[2 * i])},${Z(b.pts[2 * i + 1])}`);
  svg += `<polygon points="${pts.join(' ')}" fill="#d9b99b" fill-opacity=".7" stroke="#744" stroke-width=".6"/>`;
  if (showIds) svg += `<text x="${X(sx)}" y="${Z(sz)}" font-size="8" fill="#400" text-anchor="middle">${b.id}·${b.ridge.toFixed(0)}</text>`;
}
for (const d of decks) {
  if (!d.pts.some((p) => inside(p[0], p[1]))) continue;
  svg += `<polyline fill="none" stroke="#0a6" stroke-width="${Math.max(1.5, d.width * S)}" stroke-opacity=".5" points="${d.pts.map((p) => `${X(p[0])},${Z(p[1])}`).join(' ')}"/>`;
  const m = d.pts[d.pts.length >> 1]; svg += `<text x="${X(m[0])}" y="${Z(m[1])}" font-size="10" fill="#063">deck${d.id} w${d.width.toFixed(1)} y${d.tops[d.tops.length >> 1].toFixed(0)}</text>`;
}
fs.writeFileSync(out, svg + '</svg>');
