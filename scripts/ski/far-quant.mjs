/* Re-quantises a baked far.bin (MBG1) to a coarser height step without a rebake (round 7: first play <= 4 MB).
 * node scripts/ski/far-quant.mjs <rid|all> [step=1.0]
 * The far grid is the scenery beyond the 5 m tiles: a 1 m height step costs ~2 bits less per node than 0.25 m (-29 % bytes) and the
 * bicubic sampling smooths the +-0.5 m rounding away. bake.py FAR_QUANT writes the same step on the next bake. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGrid } from '../../pb/ski/codec.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '../../pb/ski/data');

/** The browser codec's inverse (scripts/ski/codec.py encode): planar prediction, 8 x 8 blocks, 4-bit width, zigzag residuals, LSB first. */
export function encodeGrid(data, nx, nz, step, h0) {
  const q = new Int32Array(nx * nz);
  for (let i = 0; i < q.length; i++) q[i] = Math.round((data[i] - h0) / step);
  const out = [];
  let acc = 0n, nacc = 0n;
  const put = (v, w) => { acc |= BigInt(v) << nacc; nacc += BigInt(w); while (nacc >= 8n) { out.push(Number(acc & 255n)); acc >>= 8n; nacc -= 8n; } };
  for (let by = 0; by < nz; by += 8) for (let bx = 0; bx < nx; bx += 8) {
    const zz = [];
    let mx = 0;
    for (let y = by; y < Math.min(nz, by + 8); y++) for (let x = bx; x < Math.min(nx, bx + 8); x++) {
      let p;
      if (!y && !x) p = 0; else if (!y) p = q[x - 1]; else if (!x) p = q[(y - 1) * nx]; else p = q[y * nx + x - 1] + q[(y - 1) * nx + x] - q[(y - 1) * nx + x - 1];
      const r = q[y * nx + x] - p, z = r >= 0 ? 2 * r : -2 * r - 1;
      zz.push(z); if (z > mx) mx = z;
    }
    const w = mx ? Math.floor(Math.log2(mx)) + 1 : 0;
    if (w > 15) throw new Error(`residual too large (${w} bits) at block ${bx},${by}`);
    put(w, 4);
    if (w) for (const z of zz) put(z, w);
  }
  if (nacc > 0n) out.push(Number(acc & 255n));
  const head = Buffer.alloc(18);
  head.write('MBG1', 0, 'latin1'); head.writeUInt16LE(nx, 4); head.writeUInt16LE(nz, 6); head.writeFloatLE(step, 8); head.writeFloatLE(h0, 12); head.writeUInt8(8, 16); head.writeUInt8(0, 17);
  return Buffer.concat([head, Buffer.from(out)]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const which = process.argv[2] || 'all';
  const step = Number(process.argv[3]) || 1.0;
  const rids = which === 'all' ? fs.readdirSync(DATA).filter((d) => fs.existsSync(path.join(DATA, d, 'far.bin'))) : [which];
  for (const rid of rids) {
    const file = path.join(DATA, rid, 'far.bin');
    const before = fs.readFileSync(file);
    const g = decodeGrid(new Uint8Array(before));
    if (Math.abs(g.step - step) < 1e-6) { console.log(`${rid}: already ${step} m`); continue; }
    const blob = encodeGrid(g.data, g.nx, g.nz, step, Math.floor(g.h0));
    const back = decodeGrid(new Uint8Array(blob));
    let worst = 0;
    for (let i = 0; i < back.data.length; i++) worst = Math.max(worst, Math.abs(back.data[i] - g.data[i]));
    if (worst > step / 2 + 1e-3) throw new Error(`${rid}: round trip off by ${worst} m`);
    fs.writeFileSync(file, blob);
    console.log(`${rid}: far.bin ${(before.length / 1e6).toFixed(2)} -> ${(blob.length / 1e6).toFixed(2)} MB (step ${g.step} -> ${step} m, worst ${worst.toFixed(2)} m)`);
  }
}
