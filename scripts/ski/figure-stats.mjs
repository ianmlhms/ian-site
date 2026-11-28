#!/usr/bin/env node
/* Developer tool (28 Nov 2026, skier look round): the skier figure's budget in Node with the real three.js r160: triangles / vertices /
 * bones per detail (full = the player + ghost + online friends, mid = the near other skiers, low = the crowd), the NPC pose texture size,
 * and the gear groups. Same numbers as the game builds (skier-model.js + npc-view.js bakeFigure).
 *   node scripts/ski/figure-stats.mjs [--json]          (three.js from ~/Library/Caches/ski-work/three-0.160.0.min.js or SKI_THREE=) */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const file = process.env.SKI_THREE || path.join(os.homedir(), 'Library', 'Caches', 'ski-work', 'three-0.160.0.min.js');
const mod = { exports: {} };
new Function('exports', 'module', fs.readFileSync(file, 'utf8'))(mod.exports, mod);
const ctx2d = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, set fillStyle(v) {}, createLinearGradient: () => ({ addColorStop() {} }), beginPath() {}, arc() {}, fill() {} };
globalThis.window = { THREE: mod.exports };
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { createSkierModel } = await import(pathToFileURL(path.join(REPO, 'pb/ski/skier-model.js')).href);
const { bakeFigure } = await import(pathToFileURL(path.join(REPO, 'pb/ski/npc-view.js')).href);

const out = {};
for (const detail of ['full', 'mid', 'low']) {
  const m = createSkierModel({ detail });
  let tris = 0, verts = 0, bones = 0;
  m.root.traverse((o) => { if (o.isMesh && o.geometry.userData.slots && !o.isSkinnedMesh) { bones++; tris += o.geometry.index.count / 3; verts += o.geometry.attributes.position.count; } });
  const s = createSkierModel({ detail, skinned: true });
  let skinTris = 0;
  s.root.traverse((o) => { if (o.isSkinnedMesh) skinTris = o.geometry.index.count / 3; });
  out[detail] = { triangles: tris, vertices: verts, bones, skinnedTriangles: skinTris };
}
for (const detail of ['mid', 'low']) {
  const f = bakeFigure(detail);
  out[detail].bakedTriangles = f.triangles;
  out[detail].poseTexMB = +((f.tex.image.width * f.tex.image.height * f.tex.image.data.BYTES_PER_ELEMENT * 4) / 1048576).toFixed(2);
}
if (process.argv.includes('--json')) console.log(JSON.stringify(out));
else for (const [k, v] of Object.entries(out)) console.log(k.padEnd(5), JSON.stringify(v));
