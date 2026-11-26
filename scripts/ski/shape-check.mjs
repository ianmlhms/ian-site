/* Chairs round dev check: every station-mesh.js shape is wound outward (positive signed volume about its own inside) and stays inside its
 * box.  node scripts/ski/shape-check.mjs */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.window = globalThis; globalThis.self = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(root, 'assets/vendor/three/three-0.160.0.min.js'), 'utf8'));
const { shapeGeometry } = await import(path.join(root, 'pb/ski/station-mesh.js'));
const T = globalThis.THREE;
let bad = 0;
const CASES = [['shell', 12, 1.6, 8, { round: 1, segs: 5, chamfer: 0.5, nose: 1 }], ['shell', 12, 0.4, 8, { round: 1, open: true }],
  ['shell', 12, 0.3, 8, { round: 1, top: true, chamfer: 0.2 }], ['shell', 5, 0.7, 5, { round: 2, chamfer: 0.3 }], ['halfRing', 3, 0.15, 6, { t: 0.15 }], ['rim', 5, 0.3, 5, { t: 0.25 }],
  ['strut', 2, 3, 0.3, {}], ['strut', 0.3, 3, 2, { axis: 'z', flip: true }], ['wedge', 4, 0.6, 3, {}], ['monoA', 3, 0.5, 3, {}], ['gableA', 3, 1, 3, null], ['bevel', 3, 1, 3, null]];
for (const [s, w, h, d, form] of CASES) {
  const g = shapeGeometry(s, w, h, d, 0.4, form);
  g.computeBoundingBox();
  const p = g.attributes.position.array, bb = g.boundingBox;
  // signed volume about the box centre, and per-face: the normal must point away from the part's middle line (x, z: centre; y: own)
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const a = new T.Vector3(p[i], p[i + 1], p[i + 2]), b = new T.Vector3(p[i + 3], p[i + 4], p[i + 5]), c = new T.Vector3(p[i + 6], p[i + 7], p[i + 8]);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  const inBox = bb.min.x >= -w / 2 - 1e-4 && bb.max.x <= w / 2 + 1e-4 && bb.min.y >= -h / 2 - 1e-4 && bb.max.y <= h / 2 + 1e-4 && bb.min.z >= -d / 2 - 1e-4 && bb.max.z <= d / 2 + 1e-4;
  const ok = v > 0 && inBox;
  if (!ok) bad++;
  console.log(`${ok ? 'ok ' : 'BAD'} ${s} ${JSON.stringify(form)} tris ${p.length / 9} volume ${v.toFixed(2)} (box ${(w * h * d).toFixed(2)}) in box ${inBox}`);
}
process.exit(bad ? 1 : 0);
