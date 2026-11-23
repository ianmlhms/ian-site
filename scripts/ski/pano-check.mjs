#!/usr/bin/env node
/* The printed piste map's projection (pb/ski/pano.js) against the baked data, every resort that is in pb/ski/data (Node, no browser):
 *   - resort.json has a panorama, panorama.webp has its size and is <= 300 KB
 *   - every piste (runs + network) and lift point lies on the page, >= 95 % of every resort's points are not hidden
 *     behind a ridge
 *   - taps: project -> unproject comes back within 20 m, for random visible points on pistes, at lift stations and anywhere in the box
 *   - the sky gives no ground point; python == js (pano_proj.py twin) when the venv is there (--python)
 *   node scripts/ski/pano-check.mjs [rid ...] [--data DIR] [--python] */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeGrid } from '../../pb/ski/codec.js';
import { unpackResort } from '../../pb/ski/linepack.js';
import { sampleBicubic } from '../../pb/ski/field.js';
import { createPano } from '../../pb/ski/pano.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dataArg = args.indexOf('--data');
const DATA = dataArg >= 0 ? args[dataArg + 1] : path.join(HERE, '../../pb/ski/data');
const ids = args.filter((a, i) => !a.startsWith('--') && i !== dataArg + 1 || (dataArg < 0 && !a.startsWith('--')));
const rids = ids.length ? ids : fs.readdirSync(DATA).filter((d) => fs.existsSync(path.join(DATA, d, 'resort.json'))).sort();
const MAX_BYTES = 300 * 1024, TAP_M = 20;
let bad = 0, count = 0;
const ok = (cond, text) => { count++; if (!cond) { bad++; console.log('  FAIL', text); } };
const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** [width, height] of a WebP (lossy VP8, or VP8X). */
function webpSize(buf) {
  const kind = buf.toString('latin1', 12, 16);
  if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  return [0, 0];
}

for (const rid of rids) {
  const dir = path.join(DATA, rid);
  const resort = unpackResort(JSON.parse(fs.readFileSync(path.join(dir, 'resort.json'), 'utf8')));
  if (!resort.panorama) { ok(false, `${rid}: no panorama in resort.json (run scripts/ski/panorama.py ${rid})`); continue; }
  const far = decodeGrid(fs.readFileSync(path.join(dir, 'far.bin')));
  const { margin, step } = resort.far;
  const height = (x, z) => sampleBicubic(far, (x + margin) / step, (z + margin) / step);
  const pano = createPano({ panorama: resort.panorama, height });
  const file = fs.readFileSync(path.join(dir, resort.panorama.file));
  ok(file.length <= MAX_BYTES, `${rid}: panorama.webp ${(file.length / 1024).toFixed(0)} KB`);
  const [ww, wh] = webpSize(file);
  ok(ww === resort.panorama.w && wh === resort.panorama.h, `${rid}: panorama.webp is ${ww}x${wh}, resort.json says ${resort.panorama.w}x${resort.panorama.h}`);

  let inside = 0, seen = 0, total = 0, worst = { f: 1, name: '' };
  const visit = (pts) => {
    let n = 0, vis = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const [X, Y] = pano.project(pts[i], pts[i + 1]), isIn = pano.inside(X, Y), isSeen = isIn && !pano.hidden(pts[i], pts[i + 1]);
      n++; if (isIn) inside++; if (isSeen) { seen++; vis++; }
    }
    total += n;
    return vis / Math.max(1, n);
  };
  for (const p of resort.pistes) { const line = p.line.filter((_, i) => (i >> 1) % 4 === 0); const f = visit(line); if (f < worst.f) worst = { f, name: p.id }; }
  for (const n of resort.network) if (!n.a) visit(n.p);
  for (const l of resort.lifts) visit(l.pts);
  ok(inside === total, `${rid}: ${total - inside} of ${total} piste / lift points off the page`);
  ok(seen / total >= 0.95, `${rid}: only ${(100 * seen / total).toFixed(1)} % of the piste / lift points visible`);

  const rand = rng(7), errs = { piste: [], lift: [], box: [] };
  const trip = (kind, x, z) => {
    const [X, Y] = pano.project(x, z);
    if (!pano.inside(X, Y) || pano.hidden(x, z, height(x, z), -0.5)) return;                 // strictly in sight (a hidden piste point: map.js takes the line)
    const w = pano.unproject(X, Y);
    errs[kind].push(w ? Math.hypot(w[0] - x, w[1] - z) : 1e9);
  };
  for (let i = 0; i < 1500; i++) { const p = resort.pistes[Math.floor(rand() * resort.pistes.length)], j = 2 * Math.floor(rand() * (p.line.length / 2)); trip('piste', p.line[j], p.line[j + 1]); }
  for (const l of resort.lifts) { trip('lift', l.pts[0], l.pts[1]); trip('lift', l.pts[l.pts.length - 2], l.pts[l.pts.length - 1]); }
  for (let i = 0; i < 1500; i++) trip('box', rand() * resort.width, rand() * resort.depth);
  const stat = (a) => { const s = [...a].sort((p, q) => p - q); return { n: s.length, p99: s[Math.floor(s.length * 0.99)] ?? 0, max: s[s.length - 1] ?? 0, over: s.filter((v) => v > TAP_M).length }; };
  const st = Object.fromEntries(Object.entries(errs).map(([k, a]) => [k, stat(a)]));
  ok(st.piste.n > 800 && st.piste.over === 0, `${rid}: ${st.piste.over} of ${st.piste.n} piste taps more than ${TAP_M} m off (max ${st.piste.max.toFixed(0)} m)`);
  ok(st.lift.over === 0, `${rid}: ${st.lift.over} of ${st.lift.n} lift station taps more than ${TAP_M} m off (max ${st.lift.max.toFixed(0)} m)`);
  ok(st.box.over <= st.box.n * 0.02, `${rid}: ${st.box.over} of ${st.box.n} taps anywhere more than ${TAP_M} m off`);
  ok(pano.unproject(resort.panorama.w / 2, 2) === null, `${rid}: the top of the page is sky`);
  if (args.includes('--python')) {
    const pts = []; for (let i = 0; i < 60; i++) pts.push([rand() * resort.width, rand() * resort.depth]);
    const code = `import sys,json;sys.path.insert(0,${JSON.stringify(HERE)})
from pano_proj import *
import numpy as np
d=${JSON.stringify(dir)};f=load_far(d);c=json.load(open(d+'/resort.json'))['panorama']['cam'];P=np.array(json.loads(sys.argv[1]));X,Y=Projection(c).px(P[:,0],P[:,1],f(P[:,0],P[:,1]));print(json.dumps(list(zip(X.tolist(),Y.tolist()))))`;
    const py = JSON.parse(execFileSync(path.join(process.env.HOME, 'Library/Caches/luxtram-work/.venv/bin/python'), ['-c', code, JSON.stringify(pts)]).toString());
    const diff = Math.max(...pts.map(([x, z], i) => { const [X, Y] = pano.project(x, z); return Math.hypot(X - py[i][0], Y - py[i][1]); }));
    ok(diff < 0.3, `${rid}: python and js project up to ${diff.toFixed(2)} px apart`);
    console.log(`  ${rid}: python == js within ${diff.toFixed(4)} px`);
  }
  console.log(`${rid}: ${resort.panorama.w}x${resort.panorama.h}, ${(file.length / 1024).toFixed(0)} KB, ${total} points: ${(100 * inside / total).toFixed(1)} % on the page, ${(100 * seen / total).toFixed(2)} % visible (least: ${worst.name} ${(100 * worst.f).toFixed(0)} %); taps back within ${st.piste.max.toFixed(1)} m (pistes), ${st.lift.max.toFixed(1)} m (stations), ${st.box.p99.toFixed(1)} m (99 % of the box)`);
}
console.log(bad ? `FAIL ${bad} of ${count}` : `PASS ${count}`);
process.exit(bad ? 1 : 0);
